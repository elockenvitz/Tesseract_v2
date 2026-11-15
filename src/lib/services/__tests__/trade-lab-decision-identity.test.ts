/**
 * Trade Lab's two decision paths identify their events by the write that
 * resolved the request.
 *
 * ── Why this file exists separately from the sibling test ────────────────
 *
 * `execute-sim-sibling-memory.test.ts` proves the sibling path emits at all.
 * This proves both Trade Lab paths emit with the right IDENTITY, which is a
 * different failure and was a live one.
 *
 * `markDRAccepted` is the worst case in the codebase for the key that was
 * replaced. The ordering is:
 *
 *   1. markDRAccepted              UPDATE status='accepted', reviewed_at=now
 *                                  -> emits decision.recorded
 *   2. createAcceptedTrade         the trade is created HERE, afterwards
 *   3. linkDecisionRequestToTrade  UPDATE accepted_trade_id=<the trade>
 *
 * The old key was `decision.recorded:<drId>:<status>:<acceptedTradeId>`, read
 * at step 1 when the value is still null. So the event was keyed `no-trade`
 * while the row it describes acquired a real trade id at step 3, and nothing
 * reading the database afterwards could rebuild that key. A backfill would
 * have appended a second event for a decision already recorded, into an
 * append-only table, and reported it as a repair.
 *
 * `reviewed_at` is written by the statement at step 1 and nothing moves it,
 * so the identity survives steps 2 and 3. These tests assert that against
 * the UPDATE payloads the service actually sends.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Op = [string, unknown[]]
const db = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; ops: Op[] }>,
  siblings: [] as Array<{ id: string; proposal_id: string | null }>,
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
        if (table === 'trade_batches' && has(call.ops, 'insert')) data = { id: 'b-1', portfolio_id: 'p1' }
        else if (table === 'decision_requests' && has(call.ops, 'insert')) data = { id: 'dr-new' }
        else if (table === 'decision_requests' && has(call.ops, 'maybeSingle')) {
          const byId = call.ops.find(([op, a]) => op === 'eq' && a[0] === 'id')
          data = byId ? { id: byId[1][1], status: 'pending' } : null
        } else if (table === 'decision_requests' && has(call.ops, 'single')) {
          const byId = call.ops.find(([op, a]) => op === 'eq' && a[0] === 'id')
          data = {
            id: byId ? byId[1][1] : 'dr-new', portfolio_id: 'p1',
            trade_queue_item_id: 'tq-1', proposal_id: null,
          }
        } else if (table === 'decision_requests' && has(call.ops, 'select')
                   && call.ops.some(([op, a]) => op === 'in' && a[0] === 'status')) {
          data = db.siblings
        } else if (table === 'portfolios') data = { holdings_source: 'live_feed' }
        else if (has(call.ops, 'select') && !has(call.ops, 'single') && !has(call.ops, 'maybeSingle')) data = []
        return Promise.resolve({ data, error: null }).then(resolve)
      }
      return chain
    },
  },
}))

const memory = vi.hoisted(() => ({ decisions: [] as Array<Record<string, unknown>> }))

vi.mock('../../memory/lifecycle-events', () => ({
  recordDecisionRecorded: vi.fn(async (input: Record<string, unknown>) => {
    memory.decisions.push(input)
    return { written: true, duplicate: false }
  }),
  recordExecutionRecorded: vi.fn(async () => ({ written: true, duplicate: false })),
  recordDecisionReverted: vi.fn(async () => ({ written: true, duplicate: false })),
  recordRecommendationSubmitted: vi.fn(async () => ({ written: true, duplicate: false })),
  resolveOrganizationIdForPortfolio: vi.fn(async () => 'org-1'),
}))

vi.mock('../accepted-trade-service', () => ({
  createAcceptedTrade: vi.fn(async (input: { decision_request_id: string; asset_id: string }) => ({
    id: `at-for-${input.decision_request_id}`, asset_id: input.asset_id,
  })),
}))
vi.mock('../intent-variant-service', () => ({
  deleteVariant: vi.fn(async () => {}),
  archiveCommittedVariant: vi.fn(async () => {}),
}))

import { executeSimVariants } from '../execute-sim-variants-service'

const variant = (over: Record<string, unknown> = {}) => ({
  id: 'v-1', portfolio_id: 'p1', asset_id: 'a-aapl', action: 'add',
  sizing_input: '+1', sizing_spec: null, notes: null,
  computed: {
    target_weight: 3, target_shares: 100, delta_weight: 1, delta_shares: 30,
    notional_value: 6000, price_used: 200,
    price_as_of: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
    price_basis: 'stored_close',
  },
  trade_queue_item_id: 'tq-1', proposal_id: null, decision_request_id: null,
  asset: { symbol: 'AAPL' },
  ...over,
}) as never

const ctx = { actorId: 'u1', actorName: 'Pilot' } as never

/**
 * Every `reviewed_at` this run wrote to `decision_requests`, paired with the
 * ids the statement targeted. Read from the recorded ops, so it reflects what
 * the service sent rather than what the test hoped it sent.
 */
function reviewedAtWrites(): Array<{ ids: string[]; reviewedAt: string }> {
  const out: Array<{ ids: string[]; reviewedAt: string }> = []
  for (const call of db.calls) {
    if (call.table !== 'decision_requests') continue
    const update = call.ops.find(([op]) => op === 'update')
    if (!update) continue
    const payload = update[1][0] as Record<string, unknown>
    if (typeof payload.reviewed_at !== 'string') continue
    const ids: string[] = []
    for (const [op, args] of call.ops) {
      if (op === 'eq' && args[0] === 'id') ids.push(args[1] as string)
      if (op === 'in' && args[0] === 'id') ids.push(...(args[1] as string[]))
    }
    out.push({ ids, reviewedAt: payload.reviewed_at })
  }
  return out
}

const eventFor = (drId: string) =>
  memory.decisions.find(d => d.decisionRequestId === drId)

beforeEach(() => {
  db.calls.length = 0
  db.siblings.length = 0
  memory.decisions.length = 0
})

describe('markDRAccepted — the path whose identity used to be unreproducible', () => {
  it('identifies the event by the reviewed_at it wrote', async () => {
    await executeSimVariants({
      variants: [variant({ decision_request_id: 'dr-primary' })],
      portfolioId: 'p1',
      context: ctx,
    })

    const write = reviewedAtWrites().find(w => w.ids.includes('dr-primary'))
    expect(write, 'markDRAccepted must stamp reviewed_at').toBeDefined()

    const event = eventFor('dr-primary')
    expect(event).toBeDefined()
    expect(event!.reviewedAt).toBe(write!.reviewedAt)
  })

  it('the identity does not depend on the trade, which does not exist yet', async () => {
    await executeSimVariants({
      variants: [variant({ decision_request_id: 'dr-primary' })],
      portfolioId: 'p1',
      context: ctx,
    })

    // The ordering that made the old key unsound, asserted rather than
    // asserted-about: at the moment of the emit this path knows no trade id,
    // and `linkDecisionRequestToTrade` writes one afterwards. An identity
    // built from it would describe a row state that lasted milliseconds.
    const event = eventFor('dr-primary')!
    expect(event.acceptedTradeId ?? null).toBeNull()
    expect(event.reviewedAt).toBeTruthy()

    const linked = db.calls.some(c =>
      c.table === 'decision_requests' &&
      c.ops.some(([op, args]) =>
        op === 'update' && 'accepted_trade_id' in (args[0] as Record<string, unknown>)),
    )
    expect(linked, 'the trade link is written in a later statement').toBe(true)
  })
})

describe('resolveOrphanedIdeaArtifacts — one bulk write, one instant, N events', () => {
  it('gives every sibling the instant its own row records', async () => {
    db.siblings.push(
      { id: 'dr-sib-1', proposal_id: 'prop-1' },
      { id: 'dr-sib-2', proposal_id: null },
      { id: 'dr-sib-3', proposal_id: 'prop-3' },
    )

    await executeSimVariants({
      variants: [variant({ decision_request_id: 'dr-primary' })],
      portfolioId: 'p1',
      context: ctx,
    })

    const bulk = reviewedAtWrites().find(w => w.ids.includes('dr-sib-2'))
    expect(bulk, 'the orphan scan must stamp reviewed_at').toBeDefined()

    for (const id of ['dr-sib-1', 'dr-sib-2', 'dr-sib-3']) {
      const event = eventFor(id)
      expect(event, `no event for ${id}`).toBeDefined()
      expect(event!.reviewedAt, `wrong identity for ${id}`).toBe(bulk!.reviewedAt)
    }
  })

  it('siblings and the primary are distinct decisions, so distinct events', async () => {
    db.siblings.push({ id: 'dr-sib-1', proposal_id: null })

    await executeSimVariants({
      variants: [variant({ decision_request_id: 'dr-primary' })],
      portfolioId: 'p1',
      context: ctx,
    })

    // Four recommendations resolved by one click are four decisions. They
    // share an instant but not a request, and the request is the first
    // component of the key, so nothing collapses.
    const ids = memory.decisions.map(d => d.decisionRequestId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('dr-primary')
    expect(ids).toContain('dr-sib-1')
  })

  it('no decision event is emitted without an identity', async () => {
    db.siblings.push({ id: 'dr-sib-1', proposal_id: null })

    await executeSimVariants({
      variants: [variant({ decision_request_id: 'dr-primary' })],
      portfolioId: 'p1',
      context: ctx,
    })

    // A null identity keys the event `...:no-instant`, which cannot tell two
    // resolutions of one request apart. No Trade Lab path has an excuse for
    // it: both write the column in the same statement they emit for.
    expect(memory.decisions.length).toBeGreaterThan(0)
    for (const d of memory.decisions) {
      expect(d.reviewedAt, `${d.decisionRequestId} has no identity`).toBeTruthy()
    }
  })
})
