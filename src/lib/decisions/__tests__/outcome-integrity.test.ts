/**
 * The three integrity gaps the outcome rule exposed.
 *
 *   1. detail-modal "Defer" wrote an outcome for a decision nobody made;
 *   2. reverting an accepted trade left the idea claiming that outcome;
 *   3. the simulation Trade List stamped outcomes in bulk, around the service.
 *
 * Each is tested through the real service function rather than a re-statement
 * of its logic, with supabase mocked at the client boundary — a test that
 * re-implements the rule proves only that I can write it twice.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── A recording fake of the query builder ─────────────────────────────────
//
// Captures every table/verb/payload so a test can assert what was NOT written
// as easily as what was. The negative assertions are the point here: the bugs
// were all "and it also wrote this".

interface Write { table: string; verb: 'update' | 'insert'; payload: any }

const writes: Write[] = []
const reads: Record<string, any[]> = {}

function builder(table: string) {
  const result = (rows: any[]) => ({ data: rows, error: null })
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    not: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve({ data: (reads[table] ?? [])[0] ?? null, error: null }),
    single: () => Promise.resolve({ data: (reads[table] ?? [])[0] ?? null, error: null }),
    update: (payload: any) => { writes.push({ table, verb: 'update', payload }); return chain },
    insert: (payload: any) => { writes.push({ table, verb: 'insert', payload }); return chain },
    then: (res: any) => Promise.resolve(result(reads[table] ?? [])).then(res),
  }
  return chain
}

vi.mock('../../supabase', () => ({
  supabase: {
    from: (table: string) => builder(table),
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u-1', email: 'a@b.c' } } }) },
    rpc: () => Promise.resolve({ data: true, error: null }),
  },
}))

/*
 * This suite is about outcome integrity, not about obligations.
 *
 * `snoozeTradeIdea` and `moveTradeIdea` now also keep a revisit obligation
 * in step, and the thin supabase stub below does not model
 * `memory_obligations` — so every case printed a TypeError warning from the
 * obligation writer. That warning is correct behaviour (the writer degrades
 * rather than failing a portfolio action) but it was eighteen lines of noise
 * across two suites, which is how a real warning gets missed.
 *
 * Mocked rather than silenced: the writer's own guarantees are tested in
 * lib/memory/__tests__/due-obligations.test.ts against a fake that models
 * the real constraints, and `lifecycle-memory-wiring.test.ts` asserts the
 * services call it. Nothing is lost here by stubbing it.
 */
vi.mock('../../memory/obligation-writer', () => ({
  syncIdeaRevisitObligation: vi.fn(async () => ({ obligationId: 'ob-test', action: 'superseded' })),
  syncDecisionRevisitObligation: vi.fn(async () => ({ obligationId: 'ob-test', action: 'superseded' })),
  clearIdeaRevisitObligation: vi.fn(async () => ({ obligationId: null, action: 'unchanged' })),
}))

vi.mock('../../audit', () => ({
  emitAuditEvent: vi.fn(() => Promise.resolve()),
  checkIdempotency: vi.fn(() => Promise.resolve(false)),
  getChangedFields: vi.fn(() => []),
  createStateSnapshot: vi.fn(() => ({})),
  SYSTEM_ACTORS: {},
}))

vi.mock('../../services/decision-snapshot-service', () => ({
  captureDecisionPriceSnapshot: vi.fn(() => Promise.resolve()),
  outcomeToSnapshotType: vi.fn(() => 'decision'),
}))

import { snoozeTradeIdea, reconcileOutcomeAfterRevert, moveTradeIdea } from '../../services/trade-idea-service'

const ctx = {
  actorId: 'u-1',
  actorName: 'Analyst',
  actorRole: 'pm' as const,
  requestId: 'req-1',
  uiSource: 'modal' as const,
}

const IDEA = 'tq-1'

const idea = (over: Record<string, unknown> = {}) => ({
  id: IDEA,
  stage: 'ready_to_recommend',
  outcome: null,
  status: 'idea',
  action: 'buy',
  asset_id: 'a-1',
  portfolio_id: 'pf-1',
  visibility_tier: 'active',
  rationale: 'Why now',
  thesis_text: 'The thesis',
  assets: { symbol: 'AMZN' },
  ...over,
})

beforeEach(() => {
  writes.length = 0
  for (const k of Object.keys(reads)) delete reads[k]
  reads.trade_queue_items = [idea()]
  reads.decision_requests = []
  reads.accepted_trades = []
})

const wrote = (table: string) => writes.filter((w) => w.table === table).map((w) => w.payload)

// ── 1. SNOOZE ─────────────────────────────────────────────────────────────

describe('snooze is not a decision', () => {
  it('sets revisit_at', async () => {
    await snoozeTradeIdea({ tradeId: IDEA, revisitAt: '2026-11-01T00:00:00Z', context: ctx })
    expect(wrote('trade_queue_items')[0]).toMatchObject({ revisit_at: '2026-11-01T00:00:00Z' })
  })

  it('writes NO outcome, status or stage', async () => {
    // The whole bug: this used to write outcome='deferred', which
    // `isTerminalIdea` reads as an end state, so parking an idea concluded it.
    await snoozeTradeIdea({ tradeId: IDEA, revisitAt: '2026-11-01T00:00:00Z', context: ctx })

    const payload = wrote('trade_queue_items')[0]
    for (const forbidden of ['outcome', 'outcome_at', 'outcome_by', 'status', 'stage', 'deferred_until']) {
      expect(payload).not.toHaveProperty(forbidden)
    }
  })

  it('never consults decision_requests or accepted_trades', async () => {
    // It is not asking permission, because it is not recording a decision.
    await snoozeTradeIdea({ tradeId: IDEA, revisitAt: null, context: ctx })
    expect(writes.some((w) => w.table === 'decision_requests')).toBe(false)
  })

  it('leaves the idea ineligible for an outcome', async () => {
    await snoozeTradeIdea({ tradeId: IDEA, revisitAt: '2026-11-01T00:00:00Z', context: ctx })
    // Nothing was decided, so recording an outcome is still refused.
    await expect(
      moveTradeIdea({ tradeId: IDEA, target: { stage: 'ready_to_recommend', outcome: 'executed' }, context: ctx }),
    ).rejects.toThrow(/no recommendation has been submitted/i)
  })

  it('accepts an open-ended snooze', async () => {
    await snoozeTradeIdea({ tradeId: IDEA, revisitAt: null, context: ctx })
    expect(wrote('trade_queue_items')[0]).toMatchObject({ revisit_at: null })
  })
})

// ── 2. REVERT ─────────────────────────────────────────────────────────────

describe('revert reconciles the outcome', () => {
  it('clears the outcome when nothing supports it any more', async () => {
    // The production shape: request reset to pending by revert, trade
    // deactivated, but the idea still reading `executed`.
    reads.trade_queue_items = [idea({ outcome: 'executed', status: 'executed' })]
    reads.decision_requests = [{ status: 'pending', created_at: '2026-04-02T10:00:00Z' }]
    reads.accepted_trades = [{ is_active: false, reverted_at: '2026-04-02T10:00:00Z' }]

    const { cleared } = await reconcileOutcomeAfterRevert(IDEA, ctx)

    expect(cleared).toBe(true)
    const payload = wrote('trade_queue_items')[0]
    expect(payload.outcome).toBeNull()
    expect(payload.outcome_at).toBeNull()
    expect(payload.outcome_by).toBeNull()
    // The legacy mirror has to come back too, or isTerminalIdea keeps reading
    // the idea as finished from `status` alone.
    expect(payload.status).not.toBe('executed')
    expect(payload.approved_at).toBeNull()
    expect(payload.executed_at).toBeNull()
  })

  it('does NOT clear when a decision still stands', async () => {
    // Reverting ONE of several trades, or a simulation promotion whose
    // decision request this revert never touched. Blanking the outcome here
    // would destroy a correct record.
    reads.trade_queue_items = [idea({ outcome: 'executed', status: 'executed' })]
    reads.decision_requests = [{ status: 'accepted', created_at: '2026-04-01T10:00:00Z' }]
    reads.accepted_trades = [{ is_active: false, reverted_at: '2026-04-02T10:00:00Z' }]

    const { cleared } = await reconcileOutcomeAfterRevert(IDEA, ctx)
    expect(cleared).toBe(false)
    expect(wrote('trade_queue_items')).toHaveLength(0)
  })

  it('does NOT clear when another accepted trade is still live', async () => {
    reads.trade_queue_items = [idea({ outcome: 'executed', status: 'executed' })]
    reads.decision_requests = [{ status: 'pending', created_at: '2026-04-02T10:00:00Z' }]
    reads.accepted_trades = [
      { is_active: false, reverted_at: '2026-04-02T10:00:00Z' },
      { is_active: true, reverted_at: null },
    ]

    expect((await reconcileOutcomeAfterRevert(IDEA, ctx)).cleared).toBe(false)
  })

  it('is a no-op on an idea that had no outcome', async () => {
    reads.trade_queue_items = [idea({ outcome: null })]
    expect((await reconcileOutcomeAfterRevert(IDEA, ctx)).cleared).toBe(false)
    expect(wrote('trade_queue_items')).toHaveLength(0)
  })

  it('leaves the reopened idea ineligible, then decidable again', async () => {
    // 4 and 5 of the required sequence, in one test because the second only
    // means anything given the first.
    reads.trade_queue_items = [idea({ outcome: null, status: 'idea' })]
    reads.decision_requests = [{ status: 'pending', created_at: '2026-04-02T10:00:00Z' }]
    reads.accepted_trades = [{ is_active: false, reverted_at: '2026-04-02T10:00:00Z' }]

    await expect(
      moveTradeIdea({ tradeId: IDEA, target: { stage: 'ready_to_recommend', outcome: 'executed' }, context: ctx }),
    ).rejects.toThrow(/awaiting a decision/i)

    // A new decision is recorded on the reopened request…
    reads.decision_requests = [
      { status: 'pending', created_at: '2026-04-02T10:00:00Z' },
      { status: 'accepted', created_at: '2026-04-03T10:00:00Z' },
    ]
    // …and the outcome can now be written. The overwrite guard does not fire,
    // because reconcile cleared the stale one.
    await moveTradeIdea({
      tradeId: IDEA,
      target: { stage: 'ready_to_recommend', outcome: 'executed' },
      context: ctx,
    })
    const payloads = wrote('trade_queue_items')
    expect(payloads[payloads.length - 1]).toMatchObject({ outcome: 'executed' })
  })

  it('would still be blocked if the stale outcome had NOT been cleared', () => {
    // Why clearing matters rather than just being tidy: the overwrite guard
    // refuses to change an existing outcome, so a reopened idea carrying the
    // old one can never be decided again.
    reads.trade_queue_items = [idea({ outcome: 'executed' })]
    reads.decision_requests = [{ status: 'accepted', created_at: '2026-04-03T10:00:00Z' }]

    return expect(
      moveTradeIdea({ tradeId: IDEA, target: { stage: 'ready_to_recommend', outcome: 'rejected' }, context: ctx }),
    ).rejects.toThrow(/already been decided/i)
  })
})

// ── 3. NO PATH FABRICATES AN OUTCOME ──────────────────────────────────────

describe('every outcome write goes through the gate', () => {
  it('refuses an outcome on an idea with no decision', async () => {
    await expect(
      moveTradeIdea({ tradeId: IDEA, target: { stage: 'ready_to_recommend', outcome: 'executed' }, context: ctx }),
    ).rejects.toThrow()
    expect(wrote('trade_queue_items')).toHaveLength(0)
  })

  it('allows it for a legitimate accepted-trade promotion', async () => {
    // Simulation promotion creates the accepted_trade first and never makes a
    // decision request. That must keep working.
    reads.accepted_trades = [{ is_active: true, reverted_at: null }]
    await moveTradeIdea({
      tradeId: IDEA,
      target: { stage: 'ready_to_recommend', outcome: 'executed' },
      context: ctx,
    })
    expect(wrote('trade_queue_items')[0]).toMatchObject({ outcome: 'executed' })
  })

  it('still allows a plain stage move with no outcome', async () => {
    // The gate is on outcomes, not on movement.
    reads.trade_queue_items = [idea({ stage: 'exploring' })]
    await moveTradeIdea({ tradeId: IDEA, target: { stage: 'researching' }, context: ctx })
    expect(wrote('trade_queue_items')[0]).toMatchObject({ stage: 'researching' })
    expect(wrote('trade_queue_items')[0].outcome).toBeUndefined()
  })
})
