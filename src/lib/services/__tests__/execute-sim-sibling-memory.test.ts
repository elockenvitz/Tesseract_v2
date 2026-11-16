/**
 * Trade Lab Execute records EVERY decision it resolves, not just one.
 *
 * ── The gap ──────────────────────────────────────────────────────────────
 *
 * `executeSimVariants` resolves decision requests by two routes:
 *
 *   markDRAccepted              one DR, the one the variant named
 *                               -> emits `decision.recorded`
 *   resolveOrphanedIdeaArtifacts  every OTHER pending DR for the same
 *                               (idea, portfolio), bulk UPDATE to
 *                               'accepted', linked to the same trade
 *                               -> emitted NOTHING
 *
 * So a PM clicking Execute on an idea that three portfolios had pending
 * resolved three recommendations and the Spine recorded one. The two rows
 * do not disagree about the decision — both say `accepted` — but the
 * history says one decision was made where three were, and the two silent
 * ones are exactly the ones a reviewer would later fail to find.
 *
 * Measured in production on 2026-11-15 against the live database: of the 4
 * decision requests resolved since `memory_events` was created
 * (2026-09-16), 2 carry a `decision.recorded` event and 2 do not. This path
 * is a proven structural gap. It is NOT proven to be the cause of those
 * particular two — their `decision_note` is user-authored, so they came
 * through an inbox accept rather than Trade Lab — which is why the fix
 * ships alongside `capture-reconciliation.ts`: the next miss should be
 * countable rather than re-derived from scratch.
 *
 * Runs the real `executeSimVariants` over the same recording double used by
 * `execute-sim-variants-link.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Op = [string, unknown[]]
const db = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; ops: Op[] }>,
  /** Pending sibling DRs the orphan scan should find. */
  siblings: [] as Array<{ id: string; proposal_id: string | null }>,
}))

const has = (ops: Op[], name: string) => ops.some(([op]) => op === name)

vi.mock('../../supabase', () => ({
  supabase: {
    // The audit emitter calls `rpc`. Without it the double throws and the
    // run fills with `supabase.rpc is not a function`, which is noise that
    // could hide a real failure in the same output.
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
          // The orphan scan. Returns the configured siblings.
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
import { resolveOrganizationIdForPortfolio } from '../../memory/lifecycle-events'

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

const siblingEvents = () =>
  memory.decisions.filter(d => d.provenance === 'ui:trade-lab:sibling')

beforeEach(() => {
  db.calls.length = 0
  db.siblings.length = 0
  memory.decisions.length = 0
  vi.mocked(resolveOrganizationIdForPortfolio).mockResolvedValue('org-1')
})

describe('every resolved sibling decision is recorded', () => {
  it('emits one event per sibling, not one per batch', async () => {
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

    // The whole defect: three recommendations were resolved to `accepted`
    // and the Spine used to hear about none of them.
    expect(siblingEvents().map(e => e.decisionRequestId))
      .toEqual(['dr-sib-1', 'dr-sib-2', 'dr-sib-3'])
  })

  it('records the trade the sibling was resolved against', async () => {
    db.siblings.push({ id: 'dr-sib-1', proposal_id: 'prop-1' })

    await executeSimVariants({
      variants: [variant({ decision_request_id: 'dr-primary' })],
      portfolioId: 'p1',
      context: ctx,
    })

    expect(siblingEvents()[0]).toMatchObject({
      organizationId: 'org-1',
      actorId: 'u1',
      status: 'accepted',
      tradeQueueItemId: 'tq-1',
      portfolioId: 'p1',
      proposalId: 'prop-1',
      acceptedTradeId: 'at-for-dr-primary',
      provenance: 'ui:trade-lab:sibling',
    })
  })

  it('carries no rationale', async () => {
    db.siblings.push({ id: 'dr-sib-1', proposal_id: null })

    await executeSimVariants({
      variants: [variant({ decision_request_id: 'dr-primary' })],
      portfolioId: 'p1',
      context: ctx,
    })

    // `resolveOrphanedIdeaArtifacts` writes a `decision_note` that the CODE
    // composed ("Resolved by Trade Lab Execute..."), not a reason anybody
    // gave. Carrying it into the event would make the Spine assert it knows
    // why, which is the one thing this module must never do.
    const event = siblingEvents()[0]
    expect(Object.keys(event)).not.toContain('decisionNote')
    expect(JSON.stringify(event)).not.toMatch(/Resolved by Trade Lab Execute/)
  })

  it('emits nothing when there are no siblings', async () => {
    await executeSimVariants({
      variants: [variant({ decision_request_id: 'dr-primary' })],
      portfolioId: 'p1',
      context: ctx,
    })
    expect(siblingEvents()).toHaveLength(0)
  })

  it('skips the events rather than guessing when no organisation resolves', async () => {
    db.siblings.push({ id: 'dr-sib-1', proposal_id: null })
    vi.mocked(resolveOrganizationIdForPortfolio).mockResolvedValue(null)

    await executeSimVariants({
      variants: [variant({ decision_request_id: 'dr-primary' })],
      portfolioId: 'p1',
      context: ctx,
    })

    // An org-less event is a tenancy violation waiting to be read by the
    // wrong person. No org means no event, and no event must never mean no
    // trade — so this must not throw either.
    expect(siblingEvents()).toHaveLength(0)
  })

  it('does not fail the execute when a sibling event cannot be written', async () => {
    db.siblings.push({ id: 'dr-sib-1', proposal_id: null })
    const { recordDecisionRecorded } = await import('../../memory/lifecycle-events')
    vi.mocked(recordDecisionRecorded).mockRejectedValueOnce(new Error('spine down'))

    // A committed trade must not be undone by a failed history write. The
    // whole function is inside a try/catch for this reason.
    await expect(executeSimVariants({
      variants: [variant({ decision_request_id: 'dr-primary' })],
      portfolioId: 'p1',
      context: ctx,
    })).resolves.toBeDefined()
  })
})
