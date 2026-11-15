/**
 * A Supabase client that records what was asked of it instead of asking it.
 *
 * ── Why this exists ─────────────────────────────────────────────────────
 *
 * `hooks/useAI` is the largest write path in the AI surface and had no test
 * of its own: every suite that needed it mocked it, so a defect in what it
 * sends to the database had nowhere to be caught. One duly appeared -- a
 * context change that deleted the rows discovery depends on -- and the only
 * honest way to pin it is to assert on the statements the hook builds.
 *
 * So this is not a Supabase emulator and does not try to be. It is a
 * recorder: every `from(...)` chain is captured as one `Statement`, with its
 * table, its verb, its filters in order and its payload, and resolves with
 * whatever `rows` holds for that table. Assertions are then about what WOULD
 * have reached the database, which is the claim worth making -- "no DELETE
 * was issued" read off the source text is not evidence.
 *
 * ── Using it ────────────────────────────────────────────────────────────
 *
 * The mock has to be registered in the test file, because `vi.mock` is
 * hoisted and module-scoped. An async factory with a dynamic import keeps
 * this module's state shared with the test:
 *
 *     vi.mock('../../lib/supabase', async () => {
 *       const { recorder } = await import('../../test/supabase-recorder')
 *       return { supabase: recorder }
 *     })
 *
 * Then `resetRecorder()` in `beforeEach`, `rows.set(table, [...])` to say
 * what a select returns, and `statements` to assert on.
 */

/** One statement the subject built, as the recorder saw it. */
export interface Statement {
  table: string
  op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' | null
  /** In the order they were applied: `['eq', 'conversation_id', 'c1']`. */
  filters: [string, string, unknown][]
  payload: unknown
}

/** Every statement built since the last reset, in order. */
export const statements: Statement[] = []

/** What a select on a table resolves with. Absent means an empty list. */
export const rows = new Map<string, unknown[]>()

export function resetRecorder(): void {
  statements.length = 0
  rows.clear()
}

/** The statements issued against one table, optionally for one verb. */
export function statementsFor(table: string, op?: Statement['op']): Statement[] {
  return statements.filter(s => s.table === table && (op === undefined || s.op === op))
}

function builder(table: string) {
  const rec: Statement = { table, op: null, filters: [], payload: null }
  let one = false
  const self: Record<string, unknown> = {}
  const chain = () => self
  const filter = (name: string) => (column: string, value: unknown) => {
    rec.filters.push([name, column, value])
    return chain()
  }
  Object.assign(self, {
    /* `??=` so a `.delete().select()` stays a delete: the verb is the first
       one named, and PostgREST chains a select onto a write to echo rows. */
    select: () => { rec.op ??= 'select'; return chain() },
    insert: (p: unknown) => { rec.op ??= 'insert'; rec.payload = p; return chain() },
    upsert: (p: unknown) => { rec.op ??= 'upsert'; rec.payload = p; return chain() },
    update: (p: unknown) => { rec.op ??= 'update'; rec.payload = p; return chain() },
    delete: () => { rec.op ??= 'delete'; return chain() },
    eq: filter('eq'),
    neq: filter('neq'),
    gt: filter('gt'),
    gte: filter('gte'),
    lt: filter('lt'),
    lte: filter('lte'),
    like: filter('like'),
    ilike: filter('ilike'),
    in: filter('in'),
    is: filter('is'),
    contains: filter('contains'),
    or: (expr: string) => { rec.filters.push(['or', '', expr]); return chain() },
    order: () => chain(),
    limit: () => chain(),
    range: () => chain(),
    /* Recorded the same way; only the resolved shape differs, because a
       `.single()` caller reads `data.id` rather than `data[0].id`. */
    single: () => { one = true; return chain() },
    maybeSingle: () => { one = true; return chain() },
    /*
     * Thenable rather than a promise, so the statement is recorded at the
     * moment it is awaited and `await q`, `q.then(cb)` and
     * `q.then(cb).catch(cb)` all work. The hook uses more than one of those
     * shapes, and a stub that supports only one silently drops half the
     * statements it exists to record.
     */
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      statements.push(rec)
      const list = rows.get(table) ?? []
      const data = one ? (list[0] ?? null) : list
      return Promise.resolve(resolve({ data, error: null })).then(undefined, reject)
    },
    catch: () => Promise.resolve(),
  })
  return self
}

/** A stand-in for the `supabase` export, with no network and no auth. */
export const recorder = {
  from: (table: string) => builder(table),
  auth: {
    getSession: async () => ({ data: { session: { access_token: 'recorder-token' } } }),
    getUser: async () => ({ data: { user: { id: 'u1' } } }),
  },
  /* A no-op channel, because a hook that subscribes on mount must not throw
     in a test that is not about realtime. */
  channel: () => ({
    on: () => ({ subscribe: () => ({}) }),
    subscribe: () => ({}),
  }),
  removeChannel: () => {},
}
