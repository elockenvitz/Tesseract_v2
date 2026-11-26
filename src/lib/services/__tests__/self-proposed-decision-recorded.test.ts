/**
 * A PM who proposes and executes their own trade made a decision, and the
 * Spine now records it.
 *
 * ── The gap, root-caused record by record ────────────────────────────────
 *
 * `createSelfProposedAcceptedDR` is the ONLY insert in the codebase that
 * creates an already-resolved decision request: `status: 'accepted'`,
 * `reviewed_by` and `reviewed_at` in one statement. Every other decision
 * writer resolves an existing row by UPDATE, and the memory emit was added to
 * the update paths — so this one was never wired.
 *
 * It is cases B and C of Trade Lab Execute: a logged idea with no pending
 * decision request, or an ad-hoc line the PM typed straight into the Lab.
 * Case A (`markDRAccepted`) resolves an existing request and did emit.
 *
 * Measured against production on 2026-11-15. Of the four decision requests
 * resolved since `memory_events` was created (2026-09-16), exactly two carry
 * a `decision.recorded` event, and the split is total:
 *
 *   decision_note                           reviewed_at vs created_at  event
 *   'Accepted via Trade Lab Execute'        61s later                    yes
 *   'Accepted via Trade Lab Execute'        1 day later                  yes
 *   'Self-proposed via Trade Lab Execute'   257ms EARLIER                no
 *   'Self-proposed via Trade Lab Execute'    80ms EARLIER                no
 *
 * Both misses carry the note only this function writes, and both have a
 * `reviewed_at` PRECEDING their own `created_at` — the client-minted `now`
 * against the column default — which is only possible for a row inserted
 * already resolved.
 *
 * Ruled out by the same evidence, not by assumption: it is not an RLS
 * refusal, not a lost client write, and not a status that should stay silent,
 * because the same actor's `execution.recorded` event landed moments later in
 * both cases. The cause is one unwired call site, which is why no trigger on
 * `accepted_trades` was added.
 *
 * Runs the real `executeSimVariants` over the recording double used by the
 * sibling and identity suites.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Op = [string, unknown[]]
const db = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; ops: Op[] }>,
  /** Pending DRs the "is there an existing request" lookup should find. */
  existingPendingDr: null as string | null,
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
        else if (table === 'decision_requests' && has(call.ops, 'insert')) {
          // The self-proposed insert. Returns the new id, as `.select('id')`.
          data = { id: 'dr-self-1' }
        } else if (table === 'decision_requests' && has(call.ops, 'maybeSingle')) {
          // Two different lookups land here.
          //
          // By id: "the request this variant names — does it still exist and
          // is it still open?" It does, so answer as production would. Saying
          // null here would send a case-A variant down the self-proposed path
          // and make this suite certify behaviour the product does not have.
          //
          // By proposal/TQI: "is there any open request for this variant?"
          // Null by default, which is exactly what makes a variant ad-hoc and
          // sends it down the path under test.
          const byId = call.ops.find(([op, a]) => op === 'eq' && a[0] === 'id')
          if (byId) data = { id: byId[1][1], status: 'pending' }
          else data = db.existingPendingDr ? { id: db.existingPendingDr, status: 'pending' } : null
        } else if (table === 'decision_requests' && has(call.ops, 'single')) {
          const byId = call.ops.find(([op, a]) => op === 'eq' && a[0] === 'id')
          data = {
            id: byId ? byId[1][1] : 'dr-self-1', portfolio_id: 'p1',
            trade_queue_item_id: 'tq-1', proposal_id: null,
          }
        } else if (table === 'decision_requests' && has(call.ops, 'select')
                   && call.ops.some(([op, a]) => op === 'in' && a[0] === 'status')) {
          data = [] // no siblings
        }
        // The proposal and frozen version the self-proposed path now writes
        // before the request. Keyed on `insert` so the lookups that precede
        // them still return null and drive the create branch.
        else if (table === 'trade_proposals' && has(call.ops, 'insert')) {
          data = { id: 'tp-self-1', proposal_type: 'pm_initiated' }
        } else if (table === 'trade_proposal_versions' && has(call.ops, 'insert')) {
          data = { id: 'tpv-self-1', proposal_id: 'tp-self-1', version_number: 1 }
        } else if (table === 'portfolios') data = { holdings_source: 'live_feed' }
        else if (table === 'trade_queue_items' && has(call.ops, 'insert')) data = { id: 'tq-adhoc-1' }
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

/** An ad-hoc variant: no proposal, no decision request. Case C. */
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

const selfProposedEvents = () =>
  memory.decisions.filter(d => d.provenance === 'ui:trade-lab:self-proposed')

/** The payload of the INSERT that created the decision request. */
const selfProposedInsert = () => {
  for (const call of db.calls) {
    if (call.table !== 'decision_requests') continue
    const insert = call.ops.find(([op]) => op === 'insert')
    if (insert) return insert[1][0] as Record<string, unknown>
  }
  return undefined
}

beforeEach(() => {
  db.calls.length = 0
  db.existingPendingDr = null
  memory.decisions.length = 0
  vi.mocked(resolveOrganizationIdForPortfolio).mockResolvedValue('org-1')
})

describe('a self-proposed accepted decision is recorded', () => {
  it('emits decision.recorded for the request it created already resolved', async () => {
    await executeSimVariants({ variants: [variant()], portfolioId: 'p1', context: ctx })

    // The row really was inserted already resolved — otherwise this test
    // would be asserting an emit for a path that no longer behaves the way
    // the defect described.
    const insert = selfProposedInsert()
    expect(insert, 'the self-proposed INSERT must happen').toBeDefined()
    expect(insert!.status).toBe('accepted')
    expect(insert!.reviewed_at).toBeTruthy()
    expect(insert!.decision_note).toBe('Self-proposed via Trade Lab Execute')

    // ...and the decision is now in the Spine. This is the whole defect.
    expect(selfProposedEvents()).toHaveLength(1)
    expect(selfProposedEvents()[0]).toMatchObject({
      organizationId: 'org-1',
      actorId: 'u1',
      decisionRequestId: 'dr-self-1',
      status: 'accepted',
      portfolioId: 'p1',
      provenance: 'ui:trade-lab:self-proposed',
    })
  })

  it('identifies the event by the reviewed_at the INSERT wrote', async () => {
    await executeSimVariants({ variants: [variant()], portfolioId: 'p1', context: ctx })

    // Reproducible from the canonical row afterwards, which is the property
    // the whole dedupe fix turns on. A fresh clock reading at emit time would
    // be unmatchable by any later reconciler.
    const insert = selfProposedInsert()!
    expect(selfProposedEvents()[0].reviewedAt).toBe(insert.reviewed_at)
  })

  it('carries no rationale, because the note is boilerplate this code wrote', async () => {
    await executeSimVariants({ variants: [variant()], portfolioId: 'p1', context: ctx })

    const event = selfProposedEvents()[0]
    expect(Object.keys(event)).not.toContain('decisionNote')
    expect(JSON.stringify(event)).not.toMatch(/Self-proposed via Trade Lab Execute/)
  })

  it('is distinguishable from the path that resolves an existing request', async () => {
    // Provenance, not just presence. `markDRAccepted` emits
    // `ui:trade-lab`; the orphan scan emits `ui:trade-lab:sibling`. A reader
    // asking "did a PM decide this, or did they propose and decide at once"
    // can only answer from the provenance, and the two are genuinely
    // different acts.
    await executeSimVariants({ variants: [variant()], portfolioId: 'p1', context: ctx })

    expect(memory.decisions.map(d => d.provenance)).toEqual(['ui:trade-lab:self-proposed'])
  })

  it('does not emit a self-proposed event when an existing request is resolved instead', async () => {
    // Case A. The variant names a decision request, so `markDRAccepted` runs
    // and this function is never reached. Emitting both would record two
    // decisions for one act.
    await executeSimVariants({
      variants: [variant({ decision_request_id: 'dr-existing' })],
      portfolioId: 'p1',
      context: ctx,
    })

    expect(selfProposedEvents()).toHaveLength(0)
    expect(memory.decisions.map(d => d.provenance)).toEqual(['ui:trade-lab'])
  })

  it('skips the event rather than guessing when no organisation resolves', async () => {
    vi.mocked(resolveOrganizationIdForPortfolio).mockResolvedValue(null)

    await executeSimVariants({ variants: [variant()], portfolioId: 'p1', context: ctx })

    // An org-less event is a tenancy violation waiting to be read by the
    // wrong person. The decision request must still be created.
    expect(selfProposedEvents()).toHaveLength(0)
    expect(selfProposedInsert()).toBeDefined()
  })
})
