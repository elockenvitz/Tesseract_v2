/**
 * A successful Approve & Execute must leave the idea terminal.
 *
 * ── The production failure this reproduces ───────────────────────────────
 *
 * GOOGL, 2026-10-05 14:45Z. Every write in the pilot contract landed: the
 * accepted trade reached `complete`/`matched`, holdings moved 11,000 →
 * 10,490, one `pm_assumed_execution` event, `decision.recorded` and
 * `execution.recorded` both present. And the idea stayed
 * `status=deciding, outcome=NULL`, with `updated_at` 21 seconds BEFORE the
 * approval — so `trade_queue_items` was never written at all. SHOP showed
 * the identical signature on 2026-10-04.
 *
 * ── Why the existing suite did not catch it ──────────────────────────────
 *
 * `pilot-assumed-execution.test.ts` mocks `moveTradeIdea`, so its
 * `fanIn.status === 'concluded'` assertion proves the fan-in CALLS the
 * mover, not that the mover writes. Every gate inside `moveTradeIdea` —
 * which is where this fails — was unreachable from that file.
 *
 * So this file runs the REAL `moveTradeIdea` and the REAL
 * `fetchOutcomeEligibility` over a double carrying the exact GOOGL
 * topology: one idea, one portfolio, ZERO `trade_idea_portfolios` rows, a
 * decision request just moved to `accepted`, and a live accepted trade.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type Op = [string, unknown[]]

const store = vi.hoisted(() => ({
  /**
   * `trade_queue_items`, exactly as production carried GOOGL at the moment
   * the fan-in ran.
   */
  idea: {
    id: 'tqi-googl',
    stage: 'ready_to_recommend',
    outcome: null as string | null,
    status: 'deciding',
    visibility_tier: 'active',
    action: 'sell',
    organization_id: 'org-1',
    portfolio_id: 'pf-1',
    created_by: 'user-pm',
    assigned_to: null as string | null,
  } as Record<string, unknown>,
  /** ZERO rows — the GOOGL and SHOP topology. Nobody fanned the idea out. */
  tracks: [] as Array<{ portfolio_id: string; decision_outcome: string | null }>,
  /** The decision request, already moved to `accepted` by the accept path. */
  requests: [{ status: 'accepted', created_at: '2026-10-05T14:45:39Z' }] as Array<Record<string, unknown>>,
  /** The committed trade, live and un-reverted. */
  trades: [{ is_active: true, reverted_at: null }] as Array<Record<string, unknown>>,
  /** Every UPDATE applied to trade_queue_items, so we can see what landed. */
  ideaUpdates: [] as Array<Record<string, unknown>>,
  /** Prior `move_stage` audit rows, for the idempotency probe. */
  auditMoves: [] as Array<Record<string, unknown>>,
  /** Set to simulate RLS filtering the UPDATE to zero rows. */
  updateAffectsZeroRows: false,
  /**
   * Whether `valid_outcome_in_deciding_only` is still in place.
   *
   *   CHECK ((outcome IS NULL) OR (stage = 'deciding'::trade_stage))
   *
   * This is the production constraint, and it is the root cause. It predates
   * the canonical stage vocabulary and pins terminality to the LEGACY stage
   * name, so an idea at `ready_to_recommend` can never carry an outcome.
   * Production proves it: all 21 ideas with an outcome are at `deciding`,
   * none at `ready_to_recommend`.
   *
   * Default true, because that is what production enforces today. The double
   * accepted every update before this flag existed, which is precisely why
   * the suite passed while the write failed in the browser — the same
   * vacuity that hid the unique-index violation one release ago.
   */
  legacyOutcomeConstraint: true,
}))

/**
 * `valid_outcome_in_deciding_only`, enforced in the double.
 *
 * Returns the PostgREST-shaped error Postgres produces, named, so a fix
 * cannot satisfy the test by inventing its own message.
 */
const outcomeConstraintViolation = (
  next: Record<string, unknown>,
): { code: string; message: string } | null => {
  if (!store.legacyOutcomeConstraint) return null
  const outcome = next.outcome
  if (outcome == null) return null
  if (next.stage === 'deciding') return null
  return {
    code: '23514',
    message:
      'new row for relation "trade_queue_items" violates check constraint '
      + '"valid_outcome_in_deciding_only"',
  }
}

const has = (ops: Op[], name: string) => ops.some(([op]) => op === name)
const arg0 = (ops: Op[], n: string) =>
  ops.find(([o]) => o === n)?.[1][0] as Record<string, unknown> | undefined

vi.mock('../../supabase', () => ({
  supabase: {
    rpc: async () => ({ data: null, error: null }),
    from: (table: string) => {
      const call = { table, ops: [] as Op[] }
      const chain: Record<string, unknown> = {}
      for (const op of [
        'select', 'insert', 'update', 'delete', 'eq', 'neq', 'in', 'is', 'not',
        'lte', 'gte', 'contains', 'order', 'limit', 'maybeSingle', 'single',
      ]) {
        chain[op] = (...args: unknown[]) => { call.ops.push([op, args]); return chain }
      }
      chain.then = (resolve: (v: unknown) => unknown) => {
        let data: unknown = null

        if (table === 'trade_queue_items' && has(call.ops, 'update')) {
          const u = arg0(call.ops, 'update')!
          store.ideaUpdates.push(u)
          // The CHECK constraint sees the row AFTER the update is applied.
          const violation = outcomeConstraintViolation({ ...store.idea, ...u })
          if (violation) return Promise.resolve({ data: null, error: violation }).then(resolve)
          /*
           * A PostgREST UPDATE with no `.select()` reports NO error when RLS
           * filters it to zero rows. That is the shape the fan-in read-back
           * was built to catch, so the double has to be able to produce it.
           */
          if (!store.updateAffectsZeroRows) Object.assign(store.idea, u)
          data = null
        } else if (table === 'trade_queue_items') {
          // `getTradeIdea` uses `.single()`; the fan-in read-back uses
          // `.maybeSingle()`. Both read the same row.
          data = { ...store.idea }
        } else if (table === 'trade_idea_portfolios') {
          data = has(call.ops, 'update') ? [] : store.tracks
        } else if (table === 'decision_requests') {
          data = store.requests
        } else if (table === 'accepted_trades') {
          data = store.trades
        } else if (table === 'audit_events') {
          data = store.auditMoves
        } else if (has(call.ops, 'select') && !has(call.ops, 'single') && !has(call.ops, 'maybeSingle')) {
          data = []
        }
        return Promise.resolve({ data, error: null }).then(resolve)
      }
      return chain
    },
  },
}))

// Side-effects of a successful move, stubbed so the test is about the write.
vi.mock('../../audit/audit-service', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  emitAuditEvent: vi.fn(async () => {}),
}))
vi.mock('../../memory/obligations', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  clearIdeaRevisitObligation: vi.fn(async () => {}),
}))

import { resolveIdeaAfterDecision } from '../decision-fan-in'
import { emitAuditEvent } from '../../audit/audit-service'

const context = {
  actorId: 'user-pm',
  actorName: 'PM',
  actorRole: 'pm',
  // Unique per click in every production call site (`accept-${id}-${Date.now()}`).
  requestId: 'accept-dr-1-1760000000000',
} as never

beforeEach(() => {
  store.idea = {
    id: 'tqi-googl',
    stage: 'ready_to_recommend',
    outcome: null,
    status: 'deciding',
    visibility_tier: 'active',
    action: 'sell',
    organization_id: 'org-1',
    portfolio_id: 'pf-1',
    created_by: 'user-pm',
    assigned_to: null,
  }
  store.tracks = []
  store.requests = [{ status: 'accepted', created_at: '2026-10-05T14:45:39Z' }]
  store.trades = [{ is_active: true, reverted_at: null }]
  store.ideaUpdates = []
  store.auditMoves = []
  store.updateAffectsZeroRows = false
  // Default to what production enforces today. Without this reset, the first
  // describe that clears it leaks `false` into every later test — which it
  // did, and which silently turned the observability assertions into
  // assertions about a successful conclusion.
  store.legacyOutcomeConstraint = true
  vi.clearAllMocks()
  // `clearAllMocks` clears calls but keeps implementations, so a test that
  // installs a throwing `emitAuditEvent` would otherwise poison the rest.
  vi.mocked(emitAuditEvent).mockImplementation(async () => null)
})

describe('the production constraint is the root cause', () => {
  /*
   * These run with `legacyOutcomeConstraint` left at its default — i.e.
   * against the database as it stands today — and reproduce GOOGL exactly.
   * They are the regression: if the migration is ever reverted, these start
   * failing and say why in the message.
   */
  it('rejects the conclusion, naming the constraint', async () => {
    const result = await resolveIdeaAfterDecision({
      tradeQueueItemId: 'tqi-googl', outcome: 'executed', context, note: 'n',
    })
    expect(result.status).toBe('failed')
    if (result.status !== 'failed') return
    expect(result.reason).toContain('valid_outcome_in_deciding_only')
  })

  it('leaves the idea exactly as production found GOOGL and SHOP', async () => {
    await resolveIdeaAfterDecision({
      tradeQueueItemId: 'tqi-googl', outcome: 'executed', context, note: 'n',
    })
    expect(store.idea.outcome).toBeNull()
    expect(store.idea.status).toBe('deciding')
    expect(store.idea.stage).toBe('ready_to_recommend')
  })

  it('collides because the mover writes FINAL_STAGE with the outcome', async () => {
    /*
     * The precise collision. `moveTradeIdea` always writes
     * `stage: FINAL_STAGE` alongside the outcome — not the stage the row
     * already has — so every conclusion presents the database with
     * (ready_to_recommend, executed), which is the one pair the constraint
     * forbids. That is why all 21 decided rows in production sit at
     * `deciding` and none at `ready_to_recommend`: the app only started
     * failing when the canonical stage vocabulary shipped.
     */
    await resolveIdeaAfterDecision({
      tradeQueueItemId: 'tqi-googl', outcome: 'executed', context, note: 'n',
    })
    expect(store.ideaUpdates).toHaveLength(1)
    expect(store.ideaUpdates[0]).toMatchObject({
      stage: 'ready_to_recommend',
      outcome: 'executed',
    })
  })
})

describe('the exact GOOGL topology concludes the idea', () => {
  /*
   * With `valid_outcome_at_final_stage` in place — the migration in
   * supabase/migrations/20261005120000_outcome_allowed_at_final_stage.sql,
   * which widens the constraint to accept the canonical final stage.
   *
   * This is the canonical expected result the remediation was asked for:
   * accepted trade → execution evidence → decision accepted → idea
   * outcome='executed' → idea leaves the active pipeline, with
   * stage='ready_to_recommend' preserved.
   */
  beforeEach(() => { store.legacyOutcomeConstraint = false })

  it('concludes with outcome=executed', async () => {
    const result = await resolveIdeaAfterDecision({
      tradeQueueItemId: 'tqi-googl',
      outcome: 'executed',
      context,
      note: 'All portfolios resolved — trade idea concluded after approval',
    })
    expect(result).toEqual({ status: 'concluded', outcome: 'executed' })
  })

  it('writes outcome=executed to the row', async () => {
    await resolveIdeaAfterDecision({
      tradeQueueItemId: 'tqi-googl', outcome: 'executed', context, note: 'n',
    })
    expect(store.idea.outcome).toBe('executed')
  })

  it('preserves stage=ready_to_recommend — terminality is outcome-based', async () => {
    await resolveIdeaAfterDecision({
      tradeQueueItemId: 'tqi-googl', outcome: 'executed', context, note: 'n',
    })
    // `stage` is MATURITY. Concluding a decision must not rewrite how far the
    // research got, and `ready_to_recommend` is deliberately its last value.
    expect(store.idea.stage).toBe('ready_to_recommend')
  })

  it('leaves the active pipeline', async () => {
    await resolveIdeaAfterDecision({
      tradeQueueItemId: 'tqi-googl', outcome: 'executed', context, note: 'n',
    })
    // Any non-null outcome removes the idea from every active surface.
    expect(store.idea.outcome).not.toBeNull()
    expect(store.idea.status).toBe('executed')
  })

  it('writes exactly once', async () => {
    await resolveIdeaAfterDecision({
      tradeQueueItemId: 'tqi-googl', outcome: 'executed', context, note: 'n',
    })
    expect(store.ideaUpdates).toHaveLength(1)
  })
})

describe('failure observability, separately', () => {
  // Constraint out of the way, so these isolate the OTHER failure modes
  // rather than all reporting the same constraint error.
  beforeEach(() => { store.legacyOutcomeConstraint = false })

  it('reports a silent zero-row update instead of claiming success', async () => {
    store.updateAffectsZeroRows = true
    const result = await resolveIdeaAfterDecision({
      tradeQueueItemId: 'tqi-googl', outcome: 'executed', context, note: 'n',
    })
    expect(result.status).toBe('failed')
    if (result.status !== 'failed') return
    expect(result.reason).toMatch(/unchanged|permission/i)
  })

  it('reports a missing idea link rather than silently doing nothing', async () => {
    const result = await resolveIdeaAfterDecision({
      tradeQueueItemId: null, outcome: 'executed', context, note: 'n',
    })
    expect(result.status).toBe('failed')
  })

  it('keeps the idea open when another portfolio still owes a decision', async () => {
    store.tracks = [
      { portfolio_id: 'pf-1', decision_outcome: 'accepted' },
      { portfolio_id: 'pf-2', decision_outcome: null },
    ]
    const result = await resolveIdeaAfterDecision({
      tradeQueueItemId: 'tqi-googl', outcome: 'executed', context, note: 'n',
    })
    expect(result).toEqual({ status: 'still_open', openPortfolioIds: ['pf-2'] })
    expect(store.ideaUpdates).toHaveLength(0)
  })
})

describe('a failed conclusion leaves a durable record', () => {
  /*
   * The reason used to go to `console.error` and nowhere else. A browser
   * console is not a record: the SHOP and GOOGL diagnosis had to be
   * reconstructed from constraint definitions days later because the
   * database held a stranded idea and no statement of why.
   */
  /**
   * Only the failure note.
   *
   * `moveTradeIdea` emits its own `set_outcome` event through the same
   * function, so an unscoped assertion here would pass on the mover's event
   * and prove nothing about this one.
   */
  const failureEvents = () =>
    vi.mocked(emitAuditEvent).mock.calls
      .map(c => c[0])
      .filter(e => e.action.type === 'conclude_failed')

  it('writes an audit event naming the reason', async () => {
    await resolveIdeaAfterDecision({
      tradeQueueItemId: 'tqi-googl', outcome: 'executed', context, note: 'n',
    })
    const events = failureEvents()
    expect(events).toHaveLength(1)
    expect(events[0].entity.id).toBe('tqi-googl')
    expect(String(events[0].metadata?.reason)).toContain('valid_outcome_in_deciding_only')
  })

  it('records that the trade itself DID commit', async () => {
    // Without this the event reads like a lost trade, and the first thing a
    // reader would do is go looking for one.
    await resolveIdeaAfterDecision({
      tradeQueueItemId: 'tqi-googl', outcome: 'executed', context, note: 'n',
    })
    const e = failureEvents()[0]
    expect(e.metadata?.trade_committed).toBe(true)
    expect(e.metadata?.intended_outcome).toBe('executed')
  })

  it('writes nothing when the conclusion succeeds', async () => {
    store.legacyOutcomeConstraint = false
    await resolveIdeaAfterDecision({
      tradeQueueItemId: 'tqi-googl', outcome: 'executed', context, note: 'n',
    })
    expect(failureEvents()).toHaveLength(0)
  })

  it('never lets the audit write fail the operation', async () => {
    // Reject only the conclude_failed write, leaving the mover's own event
    // alone — otherwise this would be testing the mover's error handling.
    vi.mocked(emitAuditEvent).mockImplementation(async (p) => {
      if (p.action.type === 'conclude_failed') throw new Error('audit down')
      return null
    })
    const result = await resolveIdeaAfterDecision({
      tradeQueueItemId: 'tqi-googl', outcome: 'executed', context, note: 'n',
    })
    // Still a clean `failed` result, not a thrown audit error on top of it.
    expect(result.status).toBe('failed')
    if (result.status !== 'failed') return
    expect(result.reason).toContain('valid_outcome_in_deciding_only')
  })

  it('does not record a still_open result as a failure', async () => {
    // `still_open` is a correct outcome, not a defect, and recording it
    // would turn an ordinary multi-portfolio idea into a false alarm.
    store.tracks = [{ portfolio_id: 'pf-2', decision_outcome: null }]
    await resolveIdeaAfterDecision({
      tradeQueueItemId: 'tqi-googl', outcome: 'executed', context, note: 'n',
    })
    expect(failureEvents()).toHaveLength(0)
  })
})

describe('the fix ships as a migration', () => {
  const sql = readFileSync(
    resolve(__dirname, '../../../../supabase/migrations/20261005120000_outcome_allowed_at_final_stage.sql'),
    'utf8',
  )

  it('replaces the constraint rather than dropping the rule', () => {
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS valid_outcome_in_deciding_only')
    expect(sql).toContain('ADD CONSTRAINT valid_outcome_at_final_stage')
  })

  it('accepts the canonical final stage', () => {
    expect(sql).toContain("stage = 'ready_to_recommend'::trade_stage")
  })

  it('still accepts the legacy stage, for the 21 rows already decided', () => {
    expect(sql).toContain("stage = 'deciding'::trade_stage")
  })

  it('keeps the rule it is widening — an outcome needs a mature idea', () => {
    // Not a bare DROP. An outcome on an idea nobody developed is a data
    // error, and removing the constraint entirely would permit it silently,
    // so the replacement must still constrain something.
    expect(sql).toMatch(/outcome IS NULL/)
    expect(sql).toMatch(/CHECK\s*\(/)
  })

  it('does not touch stage', () => {
    // Terminality is outcome-based; `ready_to_recommend` stays the last
    // maturity value.
    expect(sql).not.toMatch(/UPDATE\s+public\.trade_queue_items/i)
    expect(sql).not.toMatch(/SET\s+stage/i)
  })
})
