/**
 * A self-proposed trade cannot be committed without freezing what was
 * recommended.
 *
 * ── The bypass this closes ────────────────────────────────────────────────
 *
 * `submitRecommendation` freezes a `trade_proposal_versions` row at Step 2b,
 * before the decision request exists, and throws if that write fails — so a
 * request created by the analyst path cannot exist without a version.
 *
 * `createSelfProposedAcceptedDR` is the other writer, and it bypassed all of
 * that. It inserted an already-accepted decision request with no
 * `proposal_id`, no `proposal_version_id` and no `submission_snapshot`, so the
 * recommendation half of the row preserved nothing at all.
 *
 * ── What the production evidence shows ────────────────────────────────────
 *
 * Measured read-only on 2026-11-26. Of the 13 decision requests created since
 * the version-freeze writer reached production (migration 20260930170100),
 * nine carry no frozen version. Attributed by signature, they are exactly two
 * writers and no others:
 *
 *   7   pilot seed            `submission_snapshot` carries a `pilot_seed` key
 *   2   THIS path             `decision_note = 'Self-proposed via Trade Lab
 *                             Execute'`, no proposal, no snapshot
 *
 * Zero come from the analyst path. The seed's seven are fixed by migration
 * `20261120010000_pilot_seed_freezes_reasoning.sql`; these two are this
 * function, and they are the reason this suite exists.
 *
 * ── What was and was not wrong ────────────────────────────────────────────
 *
 * Nothing was ever displayed falsely. `resolveHistoricalRecommendation`
 * resolves such a row to tier `'none'` with `reasoningUnavailable: true`, and
 * it refuses to fall back to current idea state. The loss is narrower and
 * permanent: the variant is deleted on execute and the idea's thesis,
 * conviction and target keep moving, so the investment case behind those two
 * decisions can never be reconstructed. This suite is about the write, not the
 * render.
 *
 * ── Scope ─────────────────────────────────────────────────────────────────
 *
 * Only what is specific to this path. Versioning itself — dedupe on retry, a
 * revision versioning up, version 1 surviving version 2, throwing rather than
 * returning a partial row — is proven in
 * `src/lib/recommendations/__tests__/recommendation-version.test.ts` and is
 * not re-proven here against a double of itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Op = [string, unknown[]]
const db = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; ops: Op[] }>,
  /** Set to make the version INSERT fail, for the partial-failure proofs. */
  versionInsertError: null as { message: string } | null,
  /** Set to make the proposal INSERT fail. */
  proposalInsertError: null as { message: string } | null,
  /** An existing version returned by the fingerprint pre-check. */
  existingVersion: null as Record<string, unknown> | null,
}))

const has = (ops: Op[], name: string) => ops.some(([op]) => op === name)
const eqArg = (ops: Op[], col: string) =>
  ops.find(([op, a]) => op === 'eq' && a[0] === col)?.[1][1]

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
        let error: unknown = null

        if (table === 'trade_batches' && has(call.ops, 'insert')) {
          data = { id: 'b-1', portfolio_id: 'p1' }
        } else if (table === 'trade_proposals' && has(call.ops, 'insert')) {
          if (db.proposalInsertError) error = db.proposalInsertError
          else data = { id: 'tp-self-1', proposal_type: 'pm_initiated' }
        } else if (table === 'trade_proposal_versions' && has(call.ops, 'insert')) {
          if (db.versionInsertError) error = db.versionInsertError
          else data = { id: 'tpv-self-1', proposal_id: 'tp-self-1', version_number: 1 }
        } else if (table === 'trade_proposal_versions' && has(call.ops, 'maybeSingle')) {
          // Serves both the fingerprint pre-check and nextVersionNumber.
          data = db.existingVersion
        } else if (table === 'decision_requests' && has(call.ops, 'insert')) {
          data = { id: 'dr-self-1' }
        } else if (table === 'decision_requests' && has(call.ops, 'maybeSingle')) {
          const byId = eqArg(call.ops, 'id')
          data = byId ? { id: byId, status: 'pending' } : null
        } else if (table === 'decision_requests' && has(call.ops, 'single')) {
          const byId = eqArg(call.ops, 'id')
          data = {
            id: byId ?? 'dr-self-1', portfolio_id: 'p1',
            trade_queue_item_id: 'tq-1', proposal_id: null,
          }
        } else if (table === 'portfolios') {
          data = { holdings_source: 'live_feed' }
        } else if (table === 'trade_queue_items' && has(call.ops, 'insert')) {
          data = { id: 'tq-adhoc-1' }
        } else if (table === 'trade_queue_items' && has(call.ops, 'maybeSingle')) {
          // The idea state the freeze reads. Deliberately populated: an empty
          // idea would let a test pass while capturing nothing.
          data = {
            asset_id: 'a-aapl', stage: 'ready_to_recommend',
            thesis_text: 'Services margin inflects', rationale: 'Mix shift',
            conviction: 'high', target_price: 260, stop_loss: null,
            take_profit: null, time_horizon: '12m',
          }
        } else if (has(call.ops, 'select') && !has(call.ops, 'single') && !has(call.ops, 'maybeSingle')) {
          data = []
        }
        return Promise.resolve({ data, error }).then(resolve)
      }
      return chain
    },
  },
}))

vi.mock('../../memory/lifecycle-events', () => ({
  recordRecommendationSubmitted: vi.fn(async () => ({ written: true, duplicate: false })),
  recordDecisionRecorded: vi.fn(async () => ({ written: true, duplicate: false })),
  recordExecutionRecorded: vi.fn(async () => ({ written: true, duplicate: false })),
  recordDecisionReverted: vi.fn(async () => ({ written: true, duplicate: false })),
  resolveOrganizationIdForPortfolio: vi.fn(async () => 'org-1'),
}))

const createdTrades = vi.hoisted(() => ({ list: [] as Array<Record<string, unknown>> }))
vi.mock('../accepted-trade-service', () => ({
  createAcceptedTrade: vi.fn(async (input: Record<string, unknown>) => {
    createdTrades.list.push(input)
    return { id: `at-for-${input.decision_request_id}`, asset_id: input.asset_id }
  }),
}))
vi.mock('../intent-variant-service', () => ({
  deleteVariant: vi.fn(async () => {}),
  archiveCommittedVariant: vi.fn(async () => {}),
}))

import { executeSimVariants } from '../execute-sim-variants-service'

/** An ad-hoc variant: no proposal, no decision request. Case C. */
const variant = (over: Record<string, unknown> = {}) => ({
  id: 'v-1', portfolio_id: 'p1', asset_id: 'a-aapl', action: 'add',
  sizing_input: '+1', sizing_spec: { kind: 'target_weight' }, notes: 'Adding on the print',
  lab_id: 'lab-1',
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

/** Every `decision_requests` INSERT payload the run issued. */
const requestInserts = () =>
  db.calls
    .filter(c => c.table === 'decision_requests')
    .map(c => c.ops.find(([op]) => op === 'insert')?.[1][0] as Record<string, unknown> | undefined)
    .filter((r): r is Record<string, unknown> => !!r)

const versionInserts = () =>
  db.calls
    .filter(c => c.table === 'trade_proposal_versions')
    .map(c => c.ops.find(([op]) => op === 'insert')?.[1][0] as Record<string, unknown> | undefined)
    .filter((r): r is Record<string, unknown> => !!r)

const proposalInserts = () =>
  db.calls
    .filter(c => c.table === 'trade_proposals')
    .map(c => c.ops.find(([op]) => op === 'insert')?.[1][0] as Record<string, unknown> | undefined)
    .filter((r): r is Record<string, unknown> => !!r)

beforeEach(() => {
  db.calls.length = 0
  db.versionInsertError = null
  db.proposalInsertError = null
  db.existingVersion = null
  createdTrades.list.length = 0
})

describe('a self-proposed decision freezes what it recommended', () => {
  it('writes the version, then names it on the request', async () => {
    await executeSimVariants({ variants: [variant()], portfolioId: 'p1', context: ctx })

    expect(versionInserts()).toHaveLength(1)
    expect(requestInserts()).toHaveLength(1)

    // The request must point at the version, not merely coexist with one.
    // This is the invariant: an actionable recommendation retains its
    // reasoning THROUGH a versioned record it actually references.
    const request = requestInserts()[0]
    expect(request.proposal_version_id).toBe('tpv-self-1')
    expect(request.proposal_id).toBe('tp-self-1')
    expect(request.status).toBe('accepted')
  })

  it('freezes the reasoning, not just the sizing', async () => {
    await executeSimVariants({ variants: [variant()], portfolioId: 'p1', context: ctx })

    // `submission_snapshot` froze sizing and identity and never held
    // reasoning. If the version carried only sizing too, the fix would be
    // cosmetic — so assert the thinking is in there.
    const version = versionInserts()[0]
    expect(version.thesis_text).toBe('Services margin inflects')
    expect(version.rationale).toBe('Mix shift')
    expect(version.conviction).toBe('high')
    expect(version.target_price).toBe(260)
    expect(version.time_horizon).toBe('12m')

    // And the sizing as submitted, from the variant rather than re-read.
    expect(version.action).toBe('add')
    expect(version.weight).toBe(3)
    expect(version.shares).toBe(100)
    expect(version.notes).toBe('Adding on the print')
  })

  it('labels the proposal pm_initiated, so a PM proposal stays distinguishable', async () => {
    await executeSimVariants({ variants: [variant()], portfolioId: 'p1', context: ctx })

    // The old code distinguished a self-proposed decision by the ABSENCE of a
    // version. Now that one exists, the distinction has to be carried by
    // something true instead.
    expect(proposalInserts()[0].proposal_type).toBe('pm_initiated')
  })

  it('carries the tenancy the version table RLS requires', async () => {
    await executeSimVariants({ variants: [variant()], portfolioId: 'p1', context: ctx })

    const version = versionInserts()[0]
    expect(version.organization_id).toBe('org-1')
    expect(version.portfolio_id).toBe('p1')
    expect(version.created_by).toBe('u1')
  })
})

describe('a failed freeze cannot produce an actionable unversioned request', () => {
  it('a failed version write commits NO request and NO trade', async () => {
    db.versionInsertError = { message: 'permission denied for table trade_proposal_versions' }

    const result = await executeSimVariants({
      variants: [variant()], portfolioId: 'p1', context: ctx,
    })

    // This is the whole point of the ordering. The variant fails; it does not
    // half-succeed into a committed trade whose decision cannot say what was
    // recommended.
    expect(requestInserts()).toHaveLength(0)
    expect(createdTrades.list).toHaveLength(0)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].symbol).toBe('AAPL')
    expect(result.trades ?? []).toHaveLength(0)
  })

  it('a failed proposal write commits NO request and NO trade either', async () => {
    db.proposalInsertError = { message: 'permission denied for table trade_proposals' }

    const result = await executeSimVariants({
      variants: [variant()], portfolioId: 'p1', context: ctx,
    })

    // The proposal is upstream of the version, so its failure must stop the
    // same way. Without this, a proposal failure would reach the version
    // writer with an undefined proposal id.
    expect(versionInserts()).toHaveLength(0)
    expect(requestInserts()).toHaveLength(0)
    expect(createdTrades.list).toHaveLength(0)
    expect(result.failures).toHaveLength(1)
  })

  it('one variant failing to freeze does not block the others from freezing', async () => {
    // Each variant is committed independently, so a batch must not become
    // all-or-nothing. What must hold is that every request that IS written
    // names a version.
    await executeSimVariants({
      variants: [variant(), variant({ id: 'v-2', asset_id: 'a-msft', asset: { symbol: 'MSFT' } })],
      portfolioId: 'p1',
      context: ctx,
    })

    expect(requestInserts()).toHaveLength(2)
    for (const request of requestInserts()) {
      expect(request.proposal_version_id).toBe('tpv-self-1')
    }
  })
})

describe('the version lands on the right lineage', () => {
  it('an inbox-promoted variant reuses its proposal rather than minting a parallel one', async () => {
    await executeSimVariants({
      variants: [variant({ proposal_id: 'tp-existing' })],
      portfolioId: 'p1',
      context: ctx,
    })

    // A variant promoted from a submitted recommendation already has a
    // proposal. Creating a second one would start a parallel version 1 and
    // split the history of a single idea across two lineages.
    expect(proposalInserts()).toHaveLength(0)
    expect(versionInserts()[0].proposal_id).toBe('tp-existing')
    expect(requestInserts()[0].proposal_id).toBe('tp-existing')
  })

  it('resolving an EXISTING pending request freezes nothing new', async () => {
    // Case A: the variant names a decision request, so `markDRAccepted` runs
    // and this function is never reached. That request already carries the
    // version frozen when the analyst submitted it. Freezing again here would
    // mint a version for a recommendation the PM did not make.
    await executeSimVariants({
      variants: [variant({ decision_request_id: 'dr-existing' })],
      portfolioId: 'p1',
      context: ctx,
    })

    expect(versionInserts()).toHaveLength(0)
    expect(proposalInserts()).toHaveLength(0)
    expect(requestInserts()).toHaveLength(0)
  })
})

describe('every decision request this path can write names a version', () => {
  it.each([
    ['ad-hoc, no idea and no proposal', { trade_queue_item_id: null, proposal_id: null }],
    ['logged idea, no proposal', { trade_queue_item_id: 'tq-1', proposal_id: null }],
    ['promoted from a proposal', { trade_queue_item_id: 'tq-1', proposal_id: 'tp-existing' }],
    ['trim rather than add', { action: 'trim' }],
    ['no note from the PM', { notes: null }],
  ])('%s', async (_label, over) => {
    // The census. Every shape of variant that reaches
    // `createSelfProposedAcceptedDR` must produce a request carrying a
    // version id — not just the happy ad-hoc case the other tests drive.
    await executeSimVariants({ variants: [variant(over)], portfolioId: 'p1', context: ctx })

    const inserts = requestInserts()
    expect(inserts).toHaveLength(1)
    expect(inserts[0].proposal_version_id, 'request must name a frozen version').toBeTruthy()
    expect(inserts[0].proposal_id, 'request must name a proposal').toBeTruthy()
  })
})
