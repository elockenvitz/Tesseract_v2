/**
 * A PM who proposes and executes their own trade MADE a recommendation, and
 * the Spine now records that too — not just the ruling on it.
 *
 * ── The gap ───────────────────────────────────────────────────────────────
 *
 * `createSelfProposedAcceptedDR` writes both halves of the chain in a single
 * INSERT: `requested_by` is the recommendation, `reviewed_by` is the decision
 * on it. Only the second half was emitted, so the Spine held a
 * `decision.recorded` whose recommendation had no event — a ruling on
 * nothing. A reader walking Research -> Idea -> Recommendation -> Decision ->
 * Trade backwards from the trade stopped at the decision.
 *
 * ── What the production evidence does and does not show ───────────────────
 *
 * Measured read-only on 2026-11-16. `recommendation.submitted` has ZERO rows
 * in `memory_events` against 53 proposals and 113 decision requests.
 *
 * It does NOT follow that the analyst submission path is broken, and this
 * suite does not claim it. `submitRecommendation` freezes a
 * `trade_proposal_versions` row at Step 2b, BEFORE the request exists, and
 * throws if that insert fails — so a decision request created by that path
 * cannot exist without a version row. `trade_proposal_versions` is EMPTY:
 * 0 rows, all time, against 53 proposals, with the table and its policies
 * applied on 2026-10-03. So no live decision request was created by that path
 * at all, and zero events is what that implies rather than a missed emit.
 *
 * What IS provable, and what this suite covers: of the four decision requests
 * created with a proposal since the writer reached main (2026-10-03), two
 * were resolved through Trade Lab Execute and each produced a
 * `decision.recorded` with no recommendation event before it. That is this
 * function's call site, and it is a real present-tense gap.
 *
 * Runs the real `executeSimVariants` over the recording double shared with
 * the sibling, identity and decision-recorded suites.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type Op = [string, unknown[]]
const db = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; ops: Op[] }>,
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
          data = { id: 'dr-self-1' }
        } else if (table === 'decision_requests' && has(call.ops, 'maybeSingle')) {
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
          data = []
        } else if (table === 'portfolios') data = { holdings_source: 'live_feed' }
        else if (table === 'trade_queue_items' && has(call.ops, 'insert')) data = { id: 'tq-adhoc-1' }
        else if (has(call.ops, 'select') && !has(call.ops, 'single') && !has(call.ops, 'maybeSingle')) data = []
        return Promise.resolve({ data, error: null }).then(resolve)
      }
      return chain
    },
  },
}))

/**
 * ONE ordered log, not two. The order of the two emits is a property of the
 * fix — a ruling must never be recorded before the recommendation it rules on
 * — and two separate arrays cannot express it.
 */
const memory = vi.hoisted(() => ({ events: [] as Array<Record<string, unknown>> }))

vi.mock('../../memory/lifecycle-events', () => ({
  recordRecommendationSubmitted: vi.fn(async (input: Record<string, unknown>) => {
    memory.events.push({ ...input, __type: 'recommendation.submitted' })
    return { written: true, duplicate: false }
  }),
  recordDecisionRecorded: vi.fn(async (input: Record<string, unknown>) => {
    memory.events.push({ ...input, __type: 'decision.recorded' })
    return { written: true, duplicate: false }
  }),
  recordExecutionRecorded: vi.fn(async () => ({ written: true, duplicate: false })),
  recordDecisionReverted: vi.fn(async () => ({ written: true, duplicate: false })),
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
import {
  resolveOrganizationIdForPortfolio,
  recordRecommendationSubmitted,
} from '../../memory/lifecycle-events'

/** An ad-hoc variant: no proposal, no decision request. Case C. */
const variant = (over: Record<string, unknown> = {}) => ({
  id: 'v-1', portfolio_id: 'p1', asset_id: 'a-aapl', action: 'add',
  sizing_input: '+1', sizing_spec: { kind: 'target_weight' }, notes: null,
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

const selfProposed = () => memory.events.filter(e => e.provenance === 'ui:trade-lab:self-proposed')
const recommendations = () => memory.events.filter(e => e.__type === 'recommendation.submitted')
const decisions = () => memory.events.filter(e => e.__type === 'decision.recorded')

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
  memory.events.length = 0
  vi.mocked(resolveOrganizationIdForPortfolio).mockResolvedValue('org-1')
  vi.mocked(recordRecommendationSubmitted).mockImplementation(async (input) => {
    memory.events.push({ ...input, __type: 'recommendation.submitted' })
    return { written: true, duplicate: false }
  })
})

describe('a self-proposed recommendation is recorded, not only the ruling on it', () => {
  it('emits recommendation.submitted for the request it created already resolved', async () => {
    await executeSimVariants({ variants: [variant()], portfolioId: 'p1', context: ctx })

    // The row really was inserted already resolved — otherwise this suite
    // would certify an emit for a path that no longer behaves as described.
    const insert = selfProposedInsert()
    expect(insert, 'the self-proposed INSERT must happen').toBeDefined()
    expect(insert!.status).toBe('accepted')
    expect(insert!.requested_by).toBe('u1')
    expect(insert!.reviewed_by).toBe('u1')

    expect(recommendations()).toHaveLength(1)
    expect(recommendations()[0]).toMatchObject({
      organizationId: 'org-1',
      actorId: 'u1',
      decisionRequestId: 'dr-self-1',
      tradeQueueItemId: 'tq-1',
      portfolioId: 'p1',
      provenance: 'ui:trade-lab:self-proposed',
    })
  })

  it('records the recommendation BEFORE the decision on it', async () => {
    await executeSimVariants({ variants: [variant()], portfolioId: 'p1', context: ctx })

    // Both emits are non-fatal, so either can be lost on its own. Losing the
    // decision leaves a recommendation awaiting a ruling, which is a true
    // statement about an incomplete record. The reverse leaves a ruling on
    // nothing, which is the defect this fixes.
    const order = selfProposed().map(e => e.__type)
    expect(order).toEqual(['recommendation.submitted', 'decision.recorded'])
  })

  it('both events name the SAME decision request, so the chain actually links', async () => {
    await executeSimVariants({ variants: [variant()], portfolioId: 'p1', context: ctx })

    // Two events about one act are only useful if a reader can join them.
    // Different ids here would record a recommendation and a decision that
    // happen to be adjacent, which is not the same claim.
    expect(recommendations()[0].decisionRequestId).toBe(decisions()[0].decisionRequestId)
    expect(recommendations()[0].decisionRequestId).toBe('dr-self-1')
  })

  it('carries the action and sizing actually inserted, not a restatement', async () => {
    await executeSimVariants({ variants: [variant()], portfolioId: 'p1', context: ctx })

    const insert = selfProposedInsert()!
    const event = recommendations()[0]

    // Each of these is read from the `row` object the INSERT was built from,
    // so agreement is true by CONSTRUCTION rather than by coincidence — and
    // that is the point: the row and the event cannot drift apart because
    // there is only one source. What this test still catches is a field
    // omitted, renamed, or wired to the wrong property.
    expect(event.action).toBe(insert.requested_action)
    expect(event.weight).toBe(insert.sizing_weight)
    expect(event.shares).toBe(insert.sizing_shares)
    expect(event.sizingMode).toBe(insert.sizing_mode)
    expect(event.assetId).toBe('a-aapl')
  })

  it('points at NO proposal and NO frozen version, because neither exists', async () => {
    await executeSimVariants({ variants: [variant()], portfolioId: 'p1', context: ctx })

    const event = recommendations()[0]

    // This path creates no `trade_proposals` row and freezes no version. A
    // reader must be able to tell "self-proposed, nothing frozen" from
    // "submitted with an immutable snapshot"; a placeholder id would destroy
    // exactly that distinction and point at a row that does not exist.
    expect(event.proposalId).toBeNull()
    expect(event.proposalVersionId).toBeNull()
    expect(selfProposedInsert()!.proposal_id).toBeUndefined()
  })

  it('carries no rationale, because the note is boilerplate this code wrote', async () => {
    await executeSimVariants({ variants: [variant()], portfolioId: 'p1', context: ctx })

    // `decision_note: 'Self-proposed via Trade Lab Execute'` is a string the
    // code composed, not a reason the PM gave. Carrying it would be a
    // fabricated rationale in the permanent record.
    const event = recommendations()[0]
    expect(JSON.stringify(event)).not.toMatch(/Self-proposed via Trade Lab Execute/)
    expect(Object.keys(event)).not.toContain('rationale')
    expect(Object.keys(event)).not.toContain('decisionNote')
  })

  it('does NOT emit a recommendation when an existing request is resolved instead', async () => {
    // Case A: the variant names a decision request, so `markDRAccepted` runs
    // and this function is never reached. That request's recommendation was
    // recorded when the analyst submitted it; emitting here would record the
    // same recommendation twice, from a PM who did not make it.
    await executeSimVariants({
      variants: [variant({ decision_request_id: 'dr-existing' })],
      portfolioId: 'p1',
      context: ctx,
    })

    expect(recommendations()).toHaveLength(0)
    expect(decisions().map(d => d.provenance)).toEqual(['ui:trade-lab'])
  })

  it('REGRESSION: the decision event the previous fix added is still emitted', async () => {
    await executeSimVariants({ variants: [variant()], portfolioId: 'p1', context: ctx })

    // Adding an event must not displace one. This is the assertion that
    // fails if the new emit is wired in place of, rather than before, the
    // existing one.
    expect(decisions()).toHaveLength(1)
    expect(decisions()[0]).toMatchObject({
      decisionRequestId: 'dr-self-1',
      status: 'accepted',
      provenance: 'ui:trade-lab:self-proposed',
    })
    expect(decisions()[0].reviewedAt).toBe(selfProposedInsert()!.reviewed_at)
  })

  it('skips BOTH events rather than guessing when no organisation resolves', async () => {
    vi.mocked(resolveOrganizationIdForPortfolio).mockResolvedValue(null)

    await executeSimVariants({ variants: [variant()], portfolioId: 'p1', context: ctx })

    // An org-less event is a tenancy violation waiting to be read by the
    // wrong person. The organisation is derived server-side from the
    // portfolio and is never taken from the caller.
    expect(memory.events).toHaveLength(0)
    expect(selfProposedInsert(), 'the trade must still commit').toBeDefined()
  })

  it('a failed recommendation write does not block the decision or the trade', async () => {
    vi.mocked(recordRecommendationSubmitted).mockRejectedValue(new Error('spine down'))

    // The writers are documented non-fatal: a lost history write must never
    // undo a committed trade. If this throws, a Spine outage becomes an
    // execution outage.
    await expect(
      executeSimVariants({ variants: [variant()], portfolioId: 'p1', context: ctx }),
    ).resolves.toBeDefined()

    expect(selfProposedInsert(), 'the decision request must still exist').toBeDefined()
  })

  it('two ad-hoc variants record two recommendations, not one', async () => {
    // Negative control for the dedupe key. Each variant is its own
    // recommendation; a key that collapsed them would under-count the act.
    await executeSimVariants({
      variants: [variant(), variant({ id: 'v-2', asset_id: 'a-msft' })],
      portfolioId: 'p1',
      context: ctx,
    })

    expect(recommendations().length).toBeGreaterThanOrEqual(2)
    expect(recommendations().length).toBe(decisions().length)
  })
})

/**
 * A ratchet on the DEFECT CLASS, not on this instance of it.
 *
 * Both production gaps in this area were the same thing: a new write path
 * that creates a decision entity, added without its memory emit. The suite
 * above proves the one path that exists today behaves correctly; it cannot
 * say anything about the next one somebody adds.
 *
 * This is a source-level assertion, which is weaker than a behavioural one
 * and is used deliberately: the subject is a path that does not exist yet, so
 * there is no behaviour to drive. It is a tripwire that makes the next unwired
 * INSERT visible in review, NOT a proof that any path emits — that is the
 * suite above. It carries a self-test, because a scanner that silently
 * matches nothing reports a clean sweep of an empty set.
 */
describe('RATCHET: an INSERT that creates a decision request must emit', () => {
  const readSource = () =>
    readFileSync(resolve(__dirname, '../execute-sim-variants-service.ts'), 'utf8')

  /** Line indices of every `.from('decision_requests')` followed by `.insert`. */
  const drInsertSites = (src: string) => {
    const lines = src.split('\n')
    const sites: number[] = []
    lines.forEach((line, i) => {
      if (!/\.from\('decision_requests'\)/.test(line)) return
      // The insert sits within the next few chained lines.
      if (lines.slice(i, i + 4).some(l => /\.insert\(/.test(l))) sites.push(i)
    })
    return sites
  }

  it('finds exactly the one known INSERT site, and it is inside the self-proposed writer', () => {
    const src = readSource()
    const sites = drInsertSites(src)

    // If this count changes, a new already-resolved decision request is being
    // created somewhere and needs its own emit and its own test. Failing here
    // is the intended behaviour, not a maintenance chore.
    expect(sites, 'a NEW decision_requests INSERT appeared in this service').toHaveLength(1)

    const before = src.split('\n').slice(0, sites[0]).join('\n')
    expect(before).toMatch(/async function createSelfProposedAcceptedDR\(/)
  })

  it('that writer emits BOTH halves of the chain', () => {
    const fn = readSource().split('async function createSelfProposedAcceptedDR(')[1]
      .split('\n/**')[0]

    expect(fn).toMatch(/recordRecommendationSubmitted\(/)
    expect(fn).toMatch(/recordDecisionRecorded\(/)

    // And in that order — the behavioural test above owns this property; this
    // only guards against the call being deleted outright.
    expect(fn.indexOf('recordRecommendationSubmitted('))
      .toBeLessThan(fn.indexOf('recordDecisionRecorded('))
  })

  it('SELF-TEST: the scanner actually matches, and is not fooled by a read', () => {
    // Matches a real insert...
    expect(drInsertSites([
      "  await supabase", "    .from('decision_requests')", '    .insert({ a: 1 })',
    ].join('\n'))).toHaveLength(1)

    // ...and not a read of the same table, which is what a looser regex on
    // the table name alone would have swept up.
    expect(drInsertSites([
      "  await supabase", "    .from('decision_requests')", "    .select('id')", '    .eq(\'id\', x)',
    ].join('\n'))).toHaveLength(0)

    // ...and not an insert into a different table.
    expect(drInsertSites([
      "    .from('trade_queue_items')", '    .insert({})',
    ].join('\n'))).toHaveLength(0)
  })
})
