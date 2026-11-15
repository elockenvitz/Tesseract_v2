/**
 * A committed trade keeps its link to the simulated line that produced it.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * Three write paths set `accepted_trades.lab_variant_id` -- `executeSimVariants`
 * and both promote paths in `accepted-trade-service` -- and all three then
 * removed the `lab_variants` row they had just pointed at. The FK is
 * `ON DELETE SET NULL`, so each one erased the link in the same operation
 * that wrote it.
 *
 * Measured on production 2026-11-15:
 *
 *     accepted_trades                                    53
 *       carrying a lab_variant_id                         0
 *     accepted_trades WHERE source = 'simulation'        10
 *       carrying a lab_variant_id                         0
 *     lab_variants                                       21
 *       carrying a decision_request_id                    0
 *
 * So ten trades assert in an enum that they came from a simulation while the
 * typed edge that would make that traceable is empty. The column was written
 * on every Trade Lab execute and survived none of them.
 *
 * ── What the fix is ──────────────────────────────────────────────────────
 *
 * `archiveCommittedVariant` sets `visibility_tier = 'archive'` instead of
 * deleting. `getVariantsForLab` filters `visibility_tier = 'active'` unless
 * asked otherwise, so the variant still leaves the Lab's working set and
 * nothing the user sees changes -- but the FK never fires.
 *
 * `deleteVariant` stays a hard delete for the case it is for: the user
 * removing a line they did not take. Nothing points at that.
 *
 * ── What these tests assert ──────────────────────────────────────────────
 *
 * That the executing pipelines call the ARCHIVING function and never the
 * deleting one, over a recording double; and separately that the archive
 * itself issues an UPDATE to 'archive' rather than a DELETE, and refuses to
 * report success when RLS declines silently.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Op = [string, unknown[]]

const db = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; ops: Op[] }>,
  /** What a select on `lab_variants` returns for the variant being retired. */
  variant: null as Record<string, unknown> | null,
  /** Rows the archiving UPDATE reports back. Empty array = RLS declined. */
  updateReturns: [{ id: 'v-1' }] as Array<{ id: string }>,
}))

const has = (ops: Op[], name: string) => ops.some(([op]) => op === name)

vi.mock('../../supabase', () => ({
  supabase: {
    rpc: async () => ({ data: null, error: null }),
    from: (table: string) => {
      const call = { table, ops: [] as Op[] }
      db.calls.push(call)
      const chain: Record<string, unknown> = {}
      for (const op of ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'in', 'is',
                        'not', 'order', 'limit', 'maybeSingle', 'single']) {
        chain[op] = (...args: unknown[]) => { call.ops.push([op, args]); return chain }
      }
      chain.then = (resolve: (v: unknown) => unknown) => {
        let data: unknown = null
        if (table === 'lab_variants' && has(call.ops, 'update')) {
          data = db.updateReturns[0] ?? null
        } else if (table === 'lab_variants' && has(call.ops, 'select')) {
          data = db.variant
        }
        return Promise.resolve({ data, error: null }).then(resolve)
      }
      return chain
    },
  },
}))

vi.mock('../../audit/emit', () => ({ emitAuditEvent: vi.fn(async () => {}) }))

/** The audit emitter lives behind a couple of names across the repo; stub
 *  whichever this module actually imports without caring which. */
vi.mock('../audit-service', () => ({ emitAuditEvent: vi.fn(async () => {}) }))

const ctx = {
  actorId: 'u1', actorName: 'Pilot', actorRole: 'pm',
  requestId: 'req-1', uiSource: 'test', actorEmail: 'pm@test.invalid',
} as never

const labVariantOps = () =>
  db.calls.filter(c => c.table === 'lab_variants').flatMap(c => c.ops.map(([op]) => op))

beforeEach(() => {
  db.calls.length = 0
  db.variant = { id: 'v-1', lab_id: 'lab-1', asset_id: 'a-1', visibility_tier: 'active' }
  db.updateReturns = [{ id: 'v-1' }]
})

describe('retiring a committed variant', () => {
  it('updates it to archive instead of deleting it', async () => {
    const { archiveCommittedVariant } = await import('../intent-variant-service')
    await archiveCommittedVariant('v-1', ctx)

    const ops = labVariantOps()
    // The whole point: no DELETE reaches `lab_variants`, so the
    // ON DELETE SET NULL on accepted_trades.lab_variant_id never fires.
    expect(ops).not.toContain('delete')
    expect(ops).toContain('update')
  })

  it('sets the tier to archive, not trash', async () => {
    const { archiveCommittedVariant } = await import('../intent-variant-service')
    await archiveCommittedVariant('v-1', ctx)

    const update = db.calls
      .filter(c => c.table === 'lab_variants')
      .flatMap(c => c.ops)
      .find(([op]) => op === 'update')
    // `trash` is what the user's own "remove from lab" means. An executed
    // variant is finished, not discarded, and the distinction is the only
    // thing that tells the two apart later.
    expect((update?.[1][0] as Record<string, unknown>).visibility_tier).toBe('archive')
  })

  it('is idempotent — a second pass does not re-archive', async () => {
    db.variant = { id: 'v-1', lab_id: 'lab-1', asset_id: 'a-1', visibility_tier: 'archive' }

    const { archiveCommittedVariant } = await import('../intent-variant-service')
    await archiveCommittedVariant('v-1', ctx)

    // The background cleanup can run twice for one execute.
    expect(labVariantOps()).not.toContain('update')
  })

  it('throws when RLS declines the update without an error', async () => {
    db.updateReturns = []

    const { archiveCommittedVariant } = await import('../intent-variant-service')
    // A silent no-row update would leave the variant sitting in the working
    // set after its trade committed. The caller treats this as non-fatal and
    // logs it, so the trade still stands — but it must not read as success.
    await expect(archiveCommittedVariant('v-1', ctx)).rejects.toThrow(/affected no rows/)
  })

  it('does nothing when the variant is already gone', async () => {
    db.variant = null

    const { archiveCommittedVariant } = await import('../intent-variant-service')
    await expect(archiveCommittedVariant('v-1', ctx)).resolves.toBeUndefined()
    expect(labVariantOps()).not.toContain('update')
  })
})

describe('the executing pipelines retire rather than delete', () => {
  it('no committing path still imports the deleting function', async () => {
    /* Structural, and the one assertion here that is: the three write paths
     * that set `lab_variant_id` must not reach `deleteVariant`. Driving all
     * three pipelines end to end needs three separate module graphs; this
     * catches a regression in any of them in one place. */
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const read = (p: string) =>
      readFileSync(path.join(process.cwd(), 'src', 'lib', 'services', p), 'utf8')

    for (const file of ['execute-sim-variants-service.ts', 'accepted-trade-service.ts']) {
      const src = read(file)
      // It sets the provenance. The two files name the variant differently
      // (`v` in the execute pipeline, `variant` in the promote paths), so
      // match either rather than pinning a local variable name.
      expect(src).toMatch(/lab_variant_id:\s*(v|variant)\.id/)
      // ...so it must not be the thing that destroys it.
      expect(src).not.toMatch(/\bawait deleteVariant\(/)
      expect(src).toContain('archiveCommittedVariant')
    }
  })
})
