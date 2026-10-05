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
  /**
   * Rows standing in for `idx_accepted_trades_unique_open`.
   *
   * The double previously accepted every insert, which is exactly why the
   * production failure got through: the real database allows ONE active,
   * non-complete accepted trade per (portfolio_id, asset_id), and no test
   * could reproduce that. Each entry is a live open trade.
   */
  openTrades: [] as Array<{ portfolio_id: string; asset_id: string }>,
}))

/**
 * The partial unique index, enforced in the double.
 *
 *   UNIQUE (portfolio_id, asset_id)
 *   WHERE is_active = true AND execution_status <> 'complete'
 *
 * Returns the PostgREST-shaped error Postgres produces, including the index
 * name — the code matches on that name, so a double that invented its own
 * message would prove nothing.
 */
const uniqueOpenViolation = (row: Record<string, unknown>) => {
  const clash = store.openTrades.some(
    t => t.portfolio_id === row.portfolio_id && t.asset_id === row.asset_id,
  )
  if (!clash) return null
  return {
    code: '23505',
    message:
      'duplicate key value violates unique constraint "idx_accepted_trades_unique_open"',
  }
}

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
          const row = arg0(call.ops, 'insert')!
          const violation = uniqueOpenViolation(row)
          if (violation) return Promise.resolve({ data: null, error: violation }).then(resolve)
          // A successful insert of a non-complete trade now occupies the slot.
          store.openTrades.push({
            portfolio_id: row.portfolio_id as string,
            asset_id: row.asset_id as string,
          })
          store.tradeRow = { id: 'at-1', ...row }
          data = store.tradeRow
        } else if (table === 'accepted_trades' && has(call.ops, 'update')) {
          const u = arg0(call.ops, 'update')!
          store.tradeUpdates.push(u)
          // Completing or deactivating a trade releases its slot, exactly as
          // the index's WHERE clause does.
          if (u.execution_status === 'complete' || u.is_active === false) {
            const row = store.tradeRow
            store.openTrades = store.openTrades.filter(
              t => !(t.portfolio_id === row.portfolio_id && t.asset_id === row.asset_id),
            )
          }
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
const drUpdates = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }))
vi.mock('../decision-request-service', () => ({
  updateDecisionRequest: vi.fn(async (_id: string, input: Record<string, unknown>) => {
    drUpdates.calls.push(input)
  }),
}))
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
import { rejectFromInbox } from '../inbox-accept-pipeline'
import { isApproveExecuteError, type ApproveExecuteError } from '../../decisions/approve-errors'

/** Calls to the holdings RPC that actually carried a quantity to apply. */
const appliedCalls = () =>
  store.rpc.filter(r =>
    r.fn === 'apply_trade_to_holdings'
    && (r.args.p_target_shares != null || r.args.p_delta_shares != null))

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

/** The error an approval threw. Typed, so assertions need no casts. */
const caught = async (sizingInput = '-0.5'): Promise<Error> => {
  try {
    await accept(sizingInput)
  } catch (e) {
    return e as Error
  }
  throw new Error('expected the approval to be refused, but it succeeded')
}

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
  store.openTrades = []
  memory.execution = []
  moves.calls = []
  drUpdates.calls = []
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
  /*
   * These previously asserted that a refused approval still CREATED an
   * accepted trade, parked at `not_started` with the reason on
   * `execution_note`. That was the behaviour, and it was the bug: the row
   * held the one-open-trade slot for a trade that could never execute, so
   * the next recommendation on the name failed on the unique index. The
   * assertions now pin the opposite, which is the fix.
   */
  it('names the exact obstacle, not a generic placeholder', async () => {
    store.holdings = [{ portfolio_id: 'p1', asset_id: 'a-other', shares: 1, price: 10, date: '2026-09-29' }]
    store.cachedClose = null // and no close to fall back on
    await expect(accept()).rejects.toThrow(/No price for SHOP/i)
  })

  it('refuses the pair placeholder rather than inventing a quantity', async () => {
    await expect(accept('pair')).rejects.toThrow(/not a sizing instruction/i)
    expect(store.events).toHaveLength(0)
  })

  it('mutates no holdings when the sizing is refused', async () => {
    store.holdings = []
    await accept().catch(() => {})
    expect(appliedCalls()).toHaveLength(0)
  })
})

/**
 * One open trade per name — the invariant, and what happens when it binds.
 *
 * `idx_accepted_trades_unique_open` allows a single active, non-complete
 * accepted trade per (portfolio_id, asset_id). Production hit it on the
 * first real Approve & Execute: a stranded SHOP row from an earlier test
 * still held the slot, and the PM was shown
 * `duplicate key value violates unique constraint "..."`.
 *
 * The invariant is correct and stays. These pin the behaviour around it.
 */
describe('the one-open-trade-per-name invariant', () => {
  it('refuses in product language, never raw Postgres', async () => {
    store.openTrades = [{ portfolio_id: 'p1', asset_id: 'a-shop' }]
    await expect(accept()).rejects.toThrow(/SHOP already has an open trade/)
  })

  it('names how to clear the blockage', async () => {
    store.openTrades = [{ portfolio_id: 'p1', asset_id: 'a-shop' }]
    await expect(accept()).rejects.toThrow(/Complete, cancel or revert/)
  })

  it('never leaks the constraint name or error code to the PM', async () => {
    store.openTrades = [{ portfolio_id: 'p1', asset_id: 'a-shop' }]
    const err = await caught()
    expect(err.message).not.toMatch(/23505|duplicate key|unique constraint|idx_/)
  })

  it('is typed, so a caller can branch without matching on prose', async () => {
    store.openTrades = [{ portfolio_id: 'p1', asset_id: 'a-shop' }]
    const err = await caught()
    expect(isApproveExecuteError(err)).toBe(true)
    expect((err as ApproveExecuteError).kind).toBe('open_trade_exists')
  })

  it('does not reuse or overwrite the existing trade', async () => {
    // It belongs to a different decision. Silently repurposing it would
    // lose that decision's link to what was actually committed.
    store.openTrades = [{ portfolio_id: 'p1', asset_id: 'a-shop' }]
    await accept().catch(() => {})
    expect(store.tradeUpdates).toHaveLength(0)
  })

  it('leaves the conflict without touching holdings or evidence', async () => {
    store.openTrades = [{ portfolio_id: 'p1', asset_id: 'a-shop' }]
    await accept().catch(() => {})
    expect(appliedCalls()).toHaveLength(0)
    expect(store.events).toHaveLength(0)
    expect(memory.execution).toHaveLength(0)
  })

  it('an open trade on a DIFFERENT name does not block', async () => {
    store.openTrades = [{ portfolio_id: 'p1', asset_id: 'some-other-asset' }]
    const trade = await accept()
    expect(trade.delta_shares).toBe(-2110)
  })

  it('completing releases the slot, so the next recommendation executes', async () => {
    // The normal pilot flow: approve → complete → slot free. This is why a
    // successfully executed prior recommendation can never block a later
    // one on the same name.
    await accept()
    expect(store.openTrades).toHaveLength(0)
    store.tradeUpdates = []
    store.events = []
    const second = await accept()
    expect(second.delta_shares).toBe(-2110)
    expect(lastUpdate().execution_status).toBe('complete')
  })
})

describe('an unsizable approval occupies nothing', () => {
  it('creates no accepted_trades row at all', async () => {
    // The production defect: it used to create one with null quantities,
    // which then held the open-trade slot for a trade that could never
    // execute, permanently blocking the name.
    store.holdings = []
    await accept().catch(() => {})
    const inserts = store.calls.filter(c => c.table === 'accepted_trades' && has(c.ops, 'insert'))
    expect(inserts).toHaveLength(0)
    expect(store.openTrades).toHaveLength(0)
  })

  it('refuses with the exact obstacle, typed', async () => {
    store.holdings = []
    const err = await caught()
    expect(isApproveExecuteError(err)).toBe(true)
    expect((err as ApproveExecuteError).kind).toBe('unsizable')
  })

  it('does not mark the recommendation accepted', async () => {
    // Approve & Execute is one promise. Recording the decision with no
    // trade behind it would assert a commitment that does not exist — and
    // would let the idea conclude as `executed` when nothing executed.
    store.holdings = []
    await accept().catch(() => {})
    expect(drUpdates.calls).toHaveLength(0)
  })

  it('does not conclude the idea', async () => {
    store.holdings = []
    await accept().catch(() => {})
    expect(moves.calls).toHaveLength(0)
    expect(store.idea.outcome).toBeNull()
  })

  it('writes nothing at all — no holdings, evidence or memory', async () => {
    store.holdings = []
    await accept().catch(() => {})
    expect(appliedCalls()).toHaveLength(0)
    expect(store.events).toHaveLength(0)
    expect(memory.execution).toHaveLength(0)
  })

  it('leaves a later valid approval possible', async () => {
    // Nothing was stranded, so once the book can price the name the same
    // recommendation approves normally.
    store.holdings = []
    await accept().catch(() => {})
    store.holdings = [...SHOP_BOOK]
    const trade = await accept()
    expect(trade.delta_shares).toBe(-2110)
    expect(lastUpdate().execution_status).toBe('complete')
  })
})

describe('rejection decides without executing', () => {
  const reject = () =>
    rejectFromInbox({ decisionRequest: REQUEST, reason: 'too expensive', context: CONTEXT } as never)

  it('moves no holdings', async () => {
    await reject()
    expect(appliedCalls()).toHaveLength(0)
  })

  it('writes no execution evidence', async () => {
    await reject()
    expect(store.events).toHaveLength(0)
  })

  it('emits no execution event', async () => {
    await reject()
    expect(memory.execution).toHaveLength(0)
  })

  it('concludes the idea as rejected when every track is resolved', async () => {
    store.tracks = [{ portfolio_id: 'p1', decision_outcome: 'rejected' }]
    const r = await reject()
    expect(r.status).toBe('concluded')
    expect(store.idea.outcome).toBe('rejected')
  })

  it('leaves the idea live while another portfolio still owes a decision', async () => {
    // Iterative reject: the analyst can revise sizing and resubmit.
    store.tracks = [
      { portfolio_id: 'p1', decision_outcome: 'rejected' },
      { portfolio_id: 'p2', decision_outcome: null },
    ]
    const r = await reject()
    expect(r.status).toBe('still_open')
    expect(store.idea.outcome).toBeNull()
  })

  it('does not move the stage when it concludes', async () => {
    store.tracks = [{ portfolio_id: 'p1', decision_outcome: 'rejected' }]
    await reject()
    expect((moves.calls[0].target as Record<string, unknown>).stage).toBe('ready_to_recommend')
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

  it('a refused approval concludes nothing', async () => {
    /*
     * This previously asserted the opposite — that the idea concluded even
     * when execution was refused — on the reasoning that the PM had still
     * decided. Under Approve & Execute that is wrong: the decision and the
     * execution are one promise, and concluding the idea as `executed`
     * while no trade exists would be the exact false terminal outcome the
     * contract forbids. The approval fails whole.
     */
    store.holdings = []
    await accept().catch(() => {})
    expect(moves.calls).toHaveLength(0)
    expect(store.idea.outcome).toBeNull()
  })
})
