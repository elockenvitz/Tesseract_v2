/**
 * The pilot execution contract, end to end.
 *
 * ── The contract ─────────────────────────────────────────────────────────
 *
 * Tesseract has no OMS/EMS/broker integration, so for the pilot a PM's
 * approval is taken as sufficient cause to move the modeled book:
 *
 *   recommendation → Approve & Execute → sizing from the book's own
 *   valuation → pm_assumed_execution evidence → holdings move once →
 *   accepted trade complete → idea leaves the pipeline → execution.recorded
 *
 * What it does NOT do is collapse the distinction the Execution Truth work
 * established. `complete` is still earned by evidence, not asserted. The
 * only thing the pilot changes is that a decision reliably PRODUCES that
 * evidence, and that the evidence says honestly where it came from.
 *
 * ── Why this file does not mock the middle ───────────────────────────────
 *
 * The defect that prompted all of this was invisible precisely because
 * every layer looked right on its own: the accept wrote a trade, the RPC
 * returned without error, the status logic was correct given its inputs.
 * Only the composition was broken — the sizing never ran, so the RPC got
 * nulls and declined.
 *
 * So the real `resolveAcceptSizingBasis`, `currentBook`, `normalizeSizing`,
 * `computeAcceptSizing`, `createAcceptedTrade`,
 * `finalizeTradeForHoldingsSource` and `resolveIdeaAfterDecision` all run
 * here over a Supabase double that behaves like the database: the holdings
 * RPC enforces the same "no shares, no apply" contract the real one does,
 * and writes land in a store the assertions read back.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Op = [string, unknown[]]

const store = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; ops: Op[] }>,
  rpc: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  /** portfolio_holdings, the SHOP book as production carried it. */
  holdings: [] as Array<Record<string, unknown>>,
  /** trade_idea_portfolios rows for the idea. */
  tracks: [] as Array<{ portfolio_id: string; decision_outcome: string | null }>,
  /** The trade_queue_items row, as the fan-in read-back sees it. */
  idea: { id: 'tqi-1', outcome: null as string | null },
  /** Whether moveTradeIdea actually writes. False simulates a silent no-op. */
  moveWrites: true,
  /** Evidence rows written by the run. */
  events: [] as Array<Record<string, unknown>>,
  /** Successive updates applied to the accepted trade. */
  tradeUpdates: [] as Array<Record<string, unknown>>,
  /** The inserted accepted_trades row, so UPDATE returns a merged row as the real `.select()` would. */
  tradeRow: { id: 'at-1' } as Record<string, unknown>,
  /** The price_history_cache close, for the unheld-asset path. */
  cachedClose: null as number | null,
  holdingsSource: 'manual_eod',
}))

const memory = vi.hoisted(() => ({ execution: [] as Array<Record<string, unknown>> }))
const moves = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }))

const has = (ops: Op[], name: string) => ops.some(([op]) => op === name)
/** The last trade update. `Array.prototype.at` is outside this project's lib target. */
const lastUpdate = () => store.tradeUpdates[store.tradeUpdates.length - 1]
const arg0 = (ops: Op[], n: string) => ops.find(([o]) => o === n)?.[1][0] as Record<string, unknown> | undefined

vi.mock('../../supabase', () => ({
  supabase: {
    /**
     * `apply_trade_to_holdings`, reproducing the guard order that made the
     * original defect silent: the missing-shares check RETURNS `applied:
     * false` and comes BEFORE the price check, so an unsized trade never
     * raises and never reaches the price guard.
     */
    rpc: async (fn: string, args: Record<string, unknown>) => {
      store.rpc.push({ fn, args })
      if (fn !== 'apply_trade_to_holdings') return { data: null, error: null }
      const target = args.p_target_shares as number | null
      const delta = args.p_delta_shares as number | null
      if (target == null && delta == null) {
        return { data: { shares_before: 0, shares_after: 0, price_used: 0, applied: false }, error: null }
      }
      const price = args.p_price as number
      if (price == null || price <= 0) return { data: null, error: { message: 'price must be positive' } }
      const before = 12000
      const after = target ?? before + (delta ?? 0)
      return {
        data: { shares_before: before, shares_after: after, price_used: price, applied: true },
        error: null,
      }
    },
    from: (table: string) => {
      const call = { table, ops: [] as Op[] }
      store.calls.push(call)
      const chain: Record<string, unknown> = {}
      for (const op of ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'in', 'is', 'not', 'lte', 'order', 'limit', 'maybeSingle', 'single']) {
        chain[op] = (...args: unknown[]) => { call.ops.push([op, args]); return chain }
      }
      chain.then = (resolve: (v: unknown) => unknown) => {
        let data: unknown = null
        if (table === 'portfolios') {
          data = { holdings_source: store.holdingsSource, organization_id: 'org-1' }
        } else if (table === 'portfolio_holdings') {
          data = has(call.ops, 'maybeSingle') ? { id: 'h-1', shares: 12000 } : store.holdings
        } else if (table === 'price_history_cache') {
          data = store.cachedClose == null ? null : { close: store.cachedClose, date: '2026-09-29' }
        } else if (table === 'trade_idea_portfolios') {
          data = has(call.ops, 'update') ? [] : store.tracks
        } else if (table === 'trade_queue_items') {
          data = { outcome: store.idea.outcome }
        } else if (table === 'portfolio_trade_events') {
          if (has(call.ops, 'insert')) {
            store.events.push(arg0(call.ops, 'insert')!)
            data = null
          } else {
            data = store.events.map(e => ({ metadata: e.metadata }))
          }
        } else if (table === 'accepted_trades' && has(call.ops, 'insert')) {
          store.tradeRow = { id: 'at-1', ...arg0(call.ops, 'insert') }
          data = store.tradeRow
        } else if (table === 'accepted_trades' && has(call.ops, 'update')) {
          const u = arg0(call.ops, 'update')!
          store.tradeUpdates.push(u)
          // The real `.update(...).select(TRADE_SELECT)` returns the WHOLE
          // row, not just the changed columns. Merging matters: the service
          // returns this object, so a double that dropped the insert columns
          // would make a correctly-sized trade look unsized.
          store.tradeRow = { ...store.tradeRow, ...u }
          data = store.tradeRow
        } else if (table === 'accepted_trades') {
          data = store.tradeRow
        } else if (has(call.ops, 'select') && !has(call.ops, 'single') && !has(call.ops, 'maybeSingle')) {
          data = []
        }
        return Promise.resolve({ data, error: null }).then(resolve)
      }
      return chain
    },
  },
}))

vi.mock('../../memory/lifecycle-events', () => ({
  recordExecutionRecorded: vi.fn(async (i: Record<string, unknown>) => { memory.execution.push(i) }),
  recordDecisionReverted: vi.fn(async () => {}),
  resolveOrganizationIdForPortfolio: vi.fn(async () => 'org-1'),
}))
vi.mock('../decision-request-service', () => ({ updateDecisionRequest: vi.fn(async () => {}) }))
vi.mock('../intent-variant-service', () => ({ deleteVariant: vi.fn(async () => {}) }))
/**
 * `moveTradeIdea` is mocked, but it WRITES — so the fan-in's read-back
 * verification runs for real against the result. Setting `moveWrites`
 * false reproduces the silent no-op that left a production idea stranded:
 * the call resolves, nothing changes, and nothing throws.
 */
vi.mock('../trade-idea-service', () => ({
  moveTradeIdea: vi.fn(async (args: Record<string, unknown>) => {
    moves.calls.push(args)
    if (store.moveWrites) {
      store.idea.outcome = (args.target as { outcome?: string })?.outcome ?? null
    }
  }),
  reconcileOutcomeAfterRevert: vi.fn(async () => {}),
}))

import { acceptFromInboxToAcceptedTrade, EXECUTION_ORIGIN } from '../accepted-trade-service'

/** The live SHOP book: 12,000 sh @ $82.40 in a $34,779,457.07 portfolio. */
const SHOP_BOOK = [
  { portfolio_id: 'p1', asset_id: 'a-shop', shares: 12000, price: 82.4, date: '2026-09-29' },
  { portfolio_id: 'p1', asset_id: 'a-other', shares: 100000, price: 337.905707, date: '2026-09-29' },
]

const REQUEST = {
  id: 'dr-1',
  portfolio_id: 'p1',
  trade_queue_item_id: 'tqi-1',
  proposal_id: 'prop-1',
  requested_action: 'sell',
  sizing_weight: -0.5,
  context_note: 'Too much weight here',
  trade_queue_item: { id: 'tqi-1', assets: { id: 'a-shop', symbol: 'SHOP' }, action: 'sell' },
} as never

const CONTEXT = { actorId: 'u-1', actorName: 'PM' } as never

const accept = (sizingInput = '-0.5') =>
  acceptFromInboxToAcceptedTrade({ decisionRequest: REQUEST, sizingInput, context: CONTEXT } as never)

beforeEach(() => {
  store.calls = []; store.rpc = []; store.events = []; store.tradeUpdates = []
  store.tradeRow = { id: 'at-1' }
  store.holdings = [...SHOP_BOOK]
  store.tracks = []
  store.idea = { id: 'tqi-1', outcome: null }
  store.moveWrites = true
  store.cachedClose = null
  store.holdingsSource = 'manual_eod'
  memory.execution = []
  moves.calls = []
})

describe('approve → assumed execution, end to end', () => {
  it('sizes the approval from the book instead of passing a bare string', async () => {
    const trade = await accept()
    // The defect: these were all null, so the RPC had nothing to apply.
    expect(trade.delta_shares).toBe(-2110)
    expect(trade.target_shares).toBe(9890)
    expect(trade.price_at_acceptance).toBe(82.4)
    expect(trade.notional_value).toBeGreaterThan(0)
  })

  it('reaches the holdings RPC with real quantities', async () => {
    await accept()
    const apply = store.rpc.find(r => r.fn === 'apply_trade_to_holdings')
    expect(apply).toBeTruthy()
    expect(apply!.args.p_delta_shares).toBe(-2110)
    expect(apply!.args.p_price).toBe(82.4)
  })

  it('moves holdings exactly once', async () => {
    await accept()
    expect(store.rpc.filter(r => r.fn === 'apply_trade_to_holdings')).toHaveLength(1)
  })

  it('writes exactly one evidence row, provenanced as pm-assumed', async () => {
    await accept()
    expect(store.events).toHaveLength(1)
    const ev = store.events[0]
    expect((ev.metadata as Record<string, unknown>).origin).toBe(EXECUTION_ORIGIN.pmAssumed)
    expect((ev.metadata as Record<string, unknown>).accepted_trade_id).toBe('at-1')
  })

  it('does not claim the system observed a fill', async () => {
    await accept()
    const ev = store.events[0]
    // Nobody watched this happen. `manual` + detected_by_system:false is the
    // table's existing way of saying so, and it is what keeps a future
    // broker-confirmed fill distinguishable from a pilot assumption.
    expect(ev.detected_by_system).toBe(false)
    expect(ev.source_type).toBe('manual')
    expect((ev.metadata as Record<string, unknown>).origin).not.toBe(EXECUTION_ORIGIN.observed)
  })

  it('reaches complete and matched through the normal machinery', async () => {
    await accept()
    const final = lastUpdate()
    expect(final.execution_status).toBe('complete')
    expect(final.reconciliation_status).toBe('matched')
  })

  it('emits execution.recorded, separately from the decision', async () => {
    await accept()
    expect(memory.execution).toHaveLength(1)
    // `decision.recorded` is emitted by decision-request-service, which is
    // mocked here — the point is that THIS path emits only the execution
    // event. One decision does not become one event that means both.
    expect(memory.execution[0]).toMatchObject({ acceptedTradeId: 'at-1' })
  })

  it('concludes the idea so it leaves the active pipeline', async () => {
    const trade = await accept()
    expect(trade.fanIn.status).toBe('concluded')
    expect(store.idea.outcome).toBe('executed')
    // Any non-null outcome removes the idea from every active surface.
    // `stage` must NOT move: it measures research maturity, not decisions.
    expect((moves.calls[0].target as Record<string, unknown>).stage).toBe('ready_to_recommend')
    expect((moves.calls[0].target as Record<string, unknown>).outcome).toBe('executed')
  })
})

describe('refusal is visible, and never fabricated sizing', () => {
  it('records the decision but not an execution when the book cannot price it', async () => {
    store.holdings = [{ portfolio_id: 'p1', asset_id: 'a-other', shares: 1, price: 10, date: '2026-09-29' }]
    store.cachedClose = null // and no close to fall back on
    const trade = await accept()

    expect(trade.delta_shares).toBeNull()
    expect(store.events).toHaveLength(0)
    expect(memory.execution).toHaveLength(0)
    const final = lastUpdate()
    expect(final.execution_status).toBe('not_started')
  })

  it('says WHY on the trade, not a generic placeholder', async () => {
    store.holdings = [{ portfolio_id: 'p1', asset_id: 'a-other', shares: 1, price: 10, date: '2026-09-29' }]
    store.cachedClose = null
    await accept()
    expect(String(lastUpdate().execution_note)).toMatch(/No price for SHOP/i)
  })

  it('refuses the pair placeholder rather than inventing a quantity', async () => {
    const trade = await accept('pair')
    expect(trade.delta_shares).toBeNull()
    expect(store.events).toHaveLength(0)
  })

  it('still records the decision when execution is refused', async () => {
    store.holdings = []
    const trade = await accept()
    // The decision happened. Losing it because the book could not be priced
    // would be far worse than withholding the execution.
    expect(trade.id).toBe('at-1')
  })
})

describe('the lifecycle transition is observable', () => {
  it('reports failure when the write silently does not land', async () => {
    // Exactly the production shape: moveTradeIdea resolves, nothing throws,
    // and trade_queue_items is unchanged. Previously this was a
    // console.error at best and invisible at worst.
    store.moveWrites = false
    const trade = await accept()
    expect(trade.fanIn.status).toBe('failed')
    if (trade.fanIn.status !== 'failed') return
    expect(trade.fanIn.reason).toMatch(/not concluded/i)
  })

  it('leaves the idea live while another portfolio still owes a decision', async () => {
    store.tracks = [
      { portfolio_id: 'p1', decision_outcome: 'accepted' },
      { portfolio_id: 'p2', decision_outcome: null },
    ]
    const trade = await accept()
    expect(trade.fanIn.status).toBe('still_open')
    expect(store.idea.outcome).toBeNull()
    expect(moves.calls).toHaveLength(0)
  })

  it('concludes once every track is resolved', async () => {
    store.tracks = [
      { portfolio_id: 'p1', decision_outcome: 'accepted' },
      { portfolio_id: 'p2', decision_outcome: 'rejected' },
    ]
    const trade = await accept()
    expect(trade.fanIn.status).toBe('concluded')
    expect(store.idea.outcome).toBe('executed')
  })

  it('a refused execution does not stop the decision concluding the idea', async () => {
    // The PM decided. That is true whether or not we could execute it.
    store.holdings = []
    const trade = await accept()
    expect(trade.fanIn.status).toBe('concluded')
  })
})
