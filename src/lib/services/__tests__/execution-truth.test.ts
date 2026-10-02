/**
 * Tesseract may only claim execution when execution is proven.
 *
 * ── What was wrong ───────────────────────────────────────────────────────
 *
 * `finalizeTradeForHoldingsSource` ran its completion stamp unconditionally.
 * It flipped `execution_status='complete'`, `execution_completed_at`,
 * `executed_by`, `reconciliation_status='matched'` and `reconciled_at` on
 * every create for every paper/manual_eod portfolio — which is all 37
 * portfolios in production — regardless of what the holdings apply did.
 *
 * Three different non-executions were therefore recorded as
 * executed-and-reconciled:
 *
 *   1. No share sizing. `apply_trade_to_holdings` checks for missing shares
 *      BEFORE its price guard and RETURNs `applied: false` rather than
 *      raising, so nothing threw. This is every Decision Inbox accept,
 *      which passes no share columns at all — and also the Trade Book
 *      correction and ad-hoc paths.
 *   2. A price the RPC refused. That one raises, and the exception was
 *      caught by the outer handler, which returned the un-finalized trade:
 *      truthful by accident, and invisible to the PM.
 *   3. A failed `portfolio_trade_events` insert, caught and ignored while
 *      the completion stamp proceeded anyway.
 *
 * Case 1 was the P0. `reconciliation_status='matched'` was the worse half,
 * because the reconciler skips trades with no share columns — so nothing
 * downstream would ever revisit a stamp it did not earn. The append-only
 * `execution.recorded` memory event fired on the same unconditional path,
 * permanently asserting an execution that never happened.
 *
 * ── Why these are behavioural, not source, assertions ────────────────────
 *
 * The defect was not a missing branch anybody could read — it was a branch
 * whose condition was never consulted. So these run the real
 * `createAcceptedTrade` over a recording Supabase double and assert on the
 * UPDATE payload it produces and the memory events it emits. The non-vacuity
 * check is in the commit: restoring the unconditional stamp fails cases 2-7
 * and 9.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Op = [string, unknown[]]

const db = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; ops: Op[] }>,
  rpc: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  // Knobs the tests set.
  holdingsSource: 'manual_eod' as string,
  applyData: null as unknown,
  applyError: null as { message: string } | null,
  eventInsertThrows: false,
  tradeRow: { id: 'at-1' } as Record<string, unknown>,
  holdingRow: { id: 'h-1', shares: 11039 } as Record<string, unknown> | null,
}))

const memory = vi.hoisted(() => ({ execution: [] as Array<Record<string, unknown>> }))

const has = (ops: Op[], name: string) => ops.some(([op]) => op === name)
const arg0 = (ops: Op[], name: string) =>
  ops.find(([op]) => op === name)?.[1][0] as Record<string, unknown> | undefined

vi.mock('../../supabase', () => ({
  supabase: {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      db.rpc.push({ fn, args })
      if (db.applyError) return { data: null, error: db.applyError }
      return { data: db.applyData, error: null }
    },
    from: (table: string) => {
      const call = { table, ops: [] as Op[] }
      db.calls.push(call)
      const chain: Record<string, unknown> = {}
      for (const op of [
        'select', 'insert', 'update', 'delete', 'upsert', 'eq', 'neq', 'in',
        'is', 'not', 'order', 'limit', 'maybeSingle', 'single',
      ]) {
        chain[op] = (...args: unknown[]) => { call.ops.push([op, args]); return chain }
      }
      chain.then = (resolve: (v: unknown) => unknown) => {
        if (table === 'portfolio_trade_events' && db.eventInsertThrows) {
          return Promise.resolve({ data: null, error: { message: 'rls refused' } }).then(resolve)
        }
        let data: unknown = null
        if (table === 'portfolios') {
          data = { holdings_source: db.holdingsSource, organization_id: 'org-1' }
        } else if (table === 'portfolio_holdings' && has(call.ops, 'maybeSingle')) {
          // A real holding for today, so a reversal that is supposed to
          // happen reaches its write instead of early-returning.
          data = db.holdingRow
        } else if (table === 'accepted_trades' && has(call.ops, 'insert')) {
          data = { ...db.tradeRow, ...arg0(call.ops, 'insert') }
        } else if (table === 'accepted_trades' && has(call.ops, 'update')) {
          data = { ...db.tradeRow, ...arg0(call.ops, 'update') }
        } else if (table === 'accepted_trades') {
          data = db.tradeRow
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
  recordExecutionRecorded: vi.fn(async (input: Record<string, unknown>) => {
    memory.execution.push(input)
  }),
  recordDecisionReverted: vi.fn(async () => {}),
  resolveOrganizationIdForPortfolio: vi.fn(async () => 'org-1'),
}))

const drUpdates = vi.hoisted(() => ({ calls: [] as Array<[string, Record<string, unknown>]> }))
vi.mock('../decision-request-service', () => ({
  updateDecisionRequest: vi.fn(async (id: string, input: Record<string, unknown>) => {
    drUpdates.calls.push([id, input])
  }),
}))
vi.mock('../intent-variant-service', () => ({ deleteVariant: vi.fn(async () => {}) }))
vi.mock('../trade-idea-service', () => ({
  moveTradeIdea: vi.fn(async () => {}),
  reconcileOutcomeAfterRevert: vi.fn(async () => {}),
}))

import {
  createAcceptedTrade,
  revertAcceptedTrade,
  acceptFromInboxToAcceptedTrade,
} from '../accepted-trade-service'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** The sizing an Inbox accept supplies: a string, and nothing else. */
const INBOX_INPUT = {
  portfolio_id: 'p1',
  asset_id: 'a-aapl',
  action: 'add' as const,
  sizing_input: '+0.5',
  source: 'inbox' as const,
  accepted_by: 'u1',
}

/** The sizing a Trade Lab execute supplies: fully computed numbers. */
const SIZED_INPUT = {
  ...INBOX_INPUT,
  source: 'simulation' as const,
  target_shares: 11039,
  delta_shares: 539,
  price_at_acceptance: 308.33,
  target_weight: 7.75,
  delta_weight: 0.5,
  notional_value: 166189.86,
}

const APPLIED = { shares_before: 10500, shares_after: 11039, applied: true }
const NOT_APPLIED = { shares_before: 0, shares_after: 0, applied: false }

/** The payload of the UPDATE that records the execution outcome. */
const outcomeUpdate = () => {
  const updates = db.calls.filter(c => c.table === 'accepted_trades' && has(c.ops, 'update'))
  return arg0(updates[0]?.ops ?? [], 'update')
}

beforeEach(() => {
  db.calls = []
  db.rpc = []
  db.holdingsSource = 'manual_eod'
  db.applyData = APPLIED
  db.applyError = null
  db.eventInsertThrows = false
  db.tradeRow = { id: 'at-1' }
  db.holdingRow = { id: 'h-1', shares: 11039 }
  memory.execution = []
  drUpdates.calls = []
  vi.clearAllMocks()
})

// ───────────────────────────────────────────────────────────────────────────
// 1. The honest success case still works
// ───────────────────────────────────────────────────────────────────────────

describe('a sized trade that really applies', () => {
  it('is recorded as complete and matched', async () => {
    await createAcceptedTrade(SIZED_INPUT)
    const u = outcomeUpdate()
    expect(u?.execution_status).toBe('complete')
    expect(u?.reconciliation_status).toBe('matched')
    expect(u?.execution_completed_at).toBeTruthy()
    expect(u?.executed_by).toBe('u1')
    expect(u?.reconciled_at).toBeTruthy()
  })

  it('emits execution.recorded, because the portfolio did change', async () => {
    await createAcceptedTrade(SIZED_INPUT)
    expect(memory.execution).toHaveLength(1)
    expect(memory.execution[0].acceptedTradeId).toBe('at-1')
  })

  it('writes the execution evidence row Outcomes reads', async () => {
    await createAcceptedTrade(SIZED_INPUT)
    const events = db.calls.filter(c => c.table === 'portfolio_trade_events' && has(c.ops, 'insert'))
    expect(events).toHaveLength(1)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 2-4. Nothing to execute: the decision stands, the execution does not
// ───────────────────────────────────────────────────────────────────────────

describe('an accept with no executable share quantity', () => {
  beforeEach(() => { db.applyData = NOT_APPLIED })

  it('still records the decision', async () => {
    const trade = await createAcceptedTrade(INBOX_INPUT)
    // The row exists and carries the PM's sizing. Execution failing is not
    // a reason to lose the decision.
    const insert = arg0(
      db.calls.find(c => c.table === 'accepted_trades' && has(c.ops, 'insert'))!.ops,
      'insert',
    )
    expect(insert?.sizing_input).toBe('+0.5')
    expect(trade.id).toBe('at-1')
  })

  it('does NOT claim execution', async () => {
    await createAcceptedTrade(INBOX_INPUT)
    const u = outcomeUpdate()
    expect(u?.execution_status).toBe('not_started')
    expect(u?.execution_status).not.toBe('complete')
  })

  it('does NOT claim reconciliation', async () => {
    // The worse half of the original bug: the reconciler skips unsized
    // trades, so a 'matched' stamp here would never be revisited.
    await createAcceptedTrade(INBOX_INPUT)
    const u = outcomeUpdate()
    expect(u?.reconciliation_status).toBeUndefined()
    expect(u?.reconciled_at).toBeUndefined()
  })

  it('invents no execution timestamp and no executor', async () => {
    await createAcceptedTrade(INBOX_INPUT)
    const u = outcomeUpdate()
    expect(u?.execution_completed_at).toBeUndefined()
    expect(u?.executed_by).toBeUndefined()
  })

  it('writes no execution evidence row', async () => {
    await createAcceptedTrade(INBOX_INPUT)
    const events = db.calls.filter(c => c.table === 'portfolio_trade_events' && has(c.ops, 'insert'))
    expect(events).toHaveLength(0)
  })

  it('leaves the failure observable rather than only in the console', async () => {
    await createAcceptedTrade(INBOX_INPUT)
    expect(String(outcomeUpdate()?.execution_note)).toMatch(/awaiting execution/i)
  })

  it('is the same for a malformed sizing string', async () => {
    // The Inbox path never parses the string, so "2.5x" arrives exactly as
    // an empty one does: no share columns. What must not vary is the claim.
    await createAcceptedTrade({ ...INBOX_INPUT, sizing_input: '2.5x' })
    expect(outcomeUpdate()?.execution_status).toBe('not_started')
  })

  it('is the same for a pair leg whose sizing is the word "pair"', async () => {
    await createAcceptedTrade({ ...INBOX_INPUT, sizing_input: 'pair' })
    expect(outcomeUpdate()?.execution_status).toBe('not_started')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 5-6. The apply refuses or throws
// ───────────────────────────────────────────────────────────────────────────

describe('an accept whose holdings apply is refused', () => {
  beforeEach(() => {
    db.applyError = { message: 'price is required and must be positive (got 0)' }
  })

  it('preserves the decision instead of throwing it away', async () => {
    // A price the market has not supplied yet is not a reason to refuse to
    // record what the PM decided.
    await expect(createAcceptedTrade({ ...SIZED_INPUT, price_at_acceptance: null })).resolves.toBeTruthy()
  })

  it('does not mark the trade complete', async () => {
    await createAcceptedTrade({ ...SIZED_INPUT, price_at_acceptance: null })
    const u = outcomeUpdate()
    expect(u?.execution_status).toBe('not_started')
    expect(u?.reconciliation_status).toBeUndefined()
  })

  it('records the refusal reason on the trade', async () => {
    await createAcceptedTrade({ ...SIZED_INPUT, price_at_acceptance: null })
    expect(String(outcomeUpdate()?.execution_note)).toMatch(/could not be applied.*price is required/i)
  })

  it('emits no execution event', async () => {
    await createAcceptedTrade({ ...SIZED_INPUT, price_at_acceptance: null })
    expect(memory.execution).toHaveLength(0)
  })
})

describe('an accept whose evidence row cannot be written', () => {
  it('stays complete, because the shares really moved', async () => {
    // Holdings moved; only the Outcomes-facing evidence row failed. That is
    // an execution with missing paperwork, not a non-execution.
    db.eventInsertThrows = true
    await createAcceptedTrade(SIZED_INPUT)
    expect(outcomeUpdate()?.execution_status).toBe('complete')
    expect(memory.execution).toHaveLength(1)
  })

  it('but says so on the trade, rather than swallowing it', async () => {
    db.eventInsertThrows = true
    await createAcceptedTrade(SIZED_INPUT)
    expect(String(outcomeUpdate()?.execution_note)).toMatch(/evidence row could not be written/i)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 7 + 11. Retry and idempotency
// ───────────────────────────────────────────────────────────────────────────

describe('retrying an accept', () => {
  it('applies holdings once per create, never twice for one call', async () => {
    await createAcceptedTrade(SIZED_INPUT)
    expect(db.rpc.filter(r => r.fn === 'apply_trade_to_holdings')).toHaveLength(1)
  })

  it('keys the execution event on the trade id, so a retry collapses to one', async () => {
    // The Spine dedupes on `execution.recorded:<acceptedTradeId>`. Two
    // creates that resolve to the same trade id must not be able to assert
    // two executions.
    await createAcceptedTrade(SIZED_INPUT)
    await createAcceptedTrade(SIZED_INPUT)
    expect(new Set(memory.execution.map(e => e.acceptedTradeId)).size).toBe(1)
  })

  it('does not move holdings on the attempt that could not execute', async () => {
    // The retry-after-failure shape: the first attempt must leave nothing
    // behind for a second to double.
    db.applyData = NOT_APPLIED
    await createAcceptedTrade(INBOX_INPUT)
    const events = db.calls.filter(c => c.table === 'portfolio_trade_events' && has(c.ops, 'insert'))
    expect(events).toHaveLength(0)
    expect(memory.execution).toHaveLength(0)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 9. The memory event is gated on evidence
// ───────────────────────────────────────────────────────────────────────────

describe('execution.recorded', () => {
  it('is emitted when holdings moved', async () => {
    await createAcceptedTrade(SIZED_INPUT)
    expect(memory.execution).toHaveLength(1)
  })

  it('is NOT emitted when the apply wrote nothing', async () => {
    db.applyData = NOT_APPLIED
    await createAcceptedTrade(INBOX_INPUT)
    expect(memory.execution).toHaveLength(0)
  })

  it('is NOT emitted for a live_feed portfolio, where fills arrive later', async () => {
    db.holdingsSource = 'live_feed'
    await createAcceptedTrade(SIZED_INPUT)
    expect(memory.execution).toHaveLength(0)
  })

  it('does not even attempt the apply for live_feed', async () => {
    db.holdingsSource = 'live_feed'
    await createAcceptedTrade(SIZED_INPUT)
    expect(db.rpc).toHaveLength(0)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 12. Revert tells the two realities apart
// ───────────────────────────────────────────────────────────────────────────

describe('reverting', () => {
  it('does NOT reverse holdings for a decision that never executed', async () => {
    // Subtracting a position the portfolio never gained is how a truthful
    // pending state turns into a wrong one.
    db.tradeRow = {
      id: 'at-1', portfolio_id: 'p1', asset_id: 'a-aapl',
      execution_status: 'not_started', delta_shares: 539, source: 'inbox',
      decision_request_id: null, trade_queue_item_id: null,
    }
    await revertAcceptedTrade('at-1', 'mistake', { actorId: 'u1' } as never)
    const holdingWrites = db.calls.filter(
      c => c.table === 'portfolio_holdings' && (has(c.ops, 'update') || has(c.ops, 'delete')),
    )
    expect(holdingWrites).toHaveLength(0)
  })

  it('still soft-deletes the trade, because the decision is withdrawn', async () => {
    db.tradeRow = {
      id: 'at-1', portfolio_id: 'p1', asset_id: 'a-aapl',
      execution_status: 'not_started', delta_shares: null, source: 'inbox',
      decision_request_id: null, trade_queue_item_id: null,
    }
    await revertAcceptedTrade('at-1', 'mistake', { actorId: 'u1' } as never)
    const soft = db.calls.find(
      c => c.table === 'accepted_trades'
        && has(c.ops, 'update')
        && arg0(c.ops, 'update')?.is_active === false,
    )
    expect(soft).toBeTruthy()
  })

  it('DOES reverse holdings for a decision that executed', async () => {
    db.tradeRow = {
      id: 'at-1', portfolio_id: 'p1', asset_id: 'a-aapl',
      execution_status: 'complete', delta_shares: 539, source: 'inbox',
      decision_request_id: null, trade_queue_item_id: null,
    }
    await revertAcceptedTrade('at-1', 'wrong size', { actorId: 'u1' } as never)
    // The arithmetic, not merely that the table was read: 11039 - 539.
    const write = db.calls.find(c => c.table === 'portfolio_holdings' && has(c.ops, 'update'))
    expect(write, 'expected a holdings reversal write').toBeTruthy()
    expect(arg0(write!.ops, 'update')?.shares).toBe(10500)
  })

  /*
   * Guards the harness, not the product. The "never executed" case above
   * asserts an ABSENCE, which would also hold if the double simply never let
   * any reversal reach its write — as it did on the first run of this file,
   * where `reverseTradeOnHoldings` bailed at "no holding row for today" and
   * the test passed for the wrong reason.
   */
  it('(harness) a reversal can reach its write, so the absence above means something', async () => {
    db.tradeRow = {
      id: 'at-1', portfolio_id: 'p1', asset_id: 'a-aapl',
      execution_status: 'complete', delta_shares: 539, source: 'inbox',
      decision_request_id: null, trade_queue_item_id: null,
    }
    await revertAcceptedTrade('at-1', 'x', { actorId: 'u1' } as never)
    expect(db.calls.some(c => c.table === 'portfolio_holdings' && has(c.ops, 'update'))).toBe(true)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 8. Accepted with modification: two different numbers, both kept
// ───────────────────────────────────────────────────────────────────────────

describe('the analyst recommended +100bps and the PM decided +50bps', () => {
  const request = {
    id: 'dr-1',
    portfolio_id: 'p1',
    trade_queue_item_id: 'tq-1',
    proposal_id: 'prop-1',
    requested_action: 'add',
    sizing_weight: 1, // the analyst's +100bps
    context_note: null,
    trade_queue_item: { assets: { id: 'a-aapl' }, thesis_text: null, rationale: null },
  } as never

  it('commits the PM amount, not the analyst amount', async () => {
    db.applyData = NOT_APPLIED
    await acceptFromInboxToAcceptedTrade({
      decisionRequest: request,
      sizingInput: '0.5',
      context: { actorId: 'u1' } as never,
    })
    const insert = arg0(
      db.calls.find(c => c.table === 'accepted_trades' && has(c.ops, 'insert'))!.ops,
      'insert',
    )
    expect(insert?.sizing_input).toBe('0.5')
    expect(insert?.sizing_input).not.toBe('1')
  })

  it('marks the decision as modified, so the difference survives', async () => {
    db.applyData = NOT_APPLIED
    await acceptFromInboxToAcceptedTrade({
      decisionRequest: request,
      sizingInput: '0.5',
      context: { actorId: 'u1' } as never,
    })
    expect(drUpdates.calls[0][1].status).toBe('accepted_with_modification')
  })

  it('keeps the PM decision even though execution could not occur', async () => {
    // The whole point of the slice: a decision is not rolled back because
    // the system could not execute it.
    db.applyData = NOT_APPLIED
    await acceptFromInboxToAcceptedTrade({
      decisionRequest: request,
      sizingInput: '0.5',
      context: { actorId: 'u1' } as never,
    })
    expect(drUpdates.calls[0][1].status).toBe('accepted_with_modification')
    expect(drUpdates.calls[0][1].acceptedTradeId).toBe('at-1')
    // …and the execution is still honestly pending.
    expect(outcomeUpdate()?.execution_status).toBe('not_started')
  })

  it('records plain acceptance when the PM takes the analyst number', async () => {
    db.applyData = NOT_APPLIED
    await acceptFromInboxToAcceptedTrade({
      decisionRequest: request,
      sizingInput: '1',
      context: { actorId: 'u1' } as never,
    })
    expect(drUpdates.calls[0][1].status).toBe('accepted')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 13. Outcomes cannot read a pending execution as a completed one
// ───────────────────────────────────────────────────────────────────────────

describe('Outcomes eligibility', () => {
  /*
   * `useOutcomes` maps `accepted_trades.execution_status` onto the badge the
   * Outcomes feed renders, and 'complete' is the ONLY value that may become
   * 'executed'. Before this slice that was a distinction without a
   * difference, because every accept wrote 'complete'. Now that an
   * unexecuted accept rests at 'not_started', this mapping is what keeps the
   * feed honest — so it is pinned.
   *
   * A source assertion because the mapper is module-private and the
   * surrounding hook needs React Query; the mapping table is the whole
   * behaviour.
   */
  const mapper = () => {
    const src = readFileSync(
      path.join(process.cwd(), 'src', 'hooks', 'useOutcomes.ts'),
      'utf8',
    )
    const start = src.indexOf('function mapExecStatus')
    expect(start, 'mapExecStatus not found').toBeGreaterThan(-1)
    return src.slice(start, src.indexOf('\n}', start))
  }

  it("maps 'not_started' to pending, never to executed", () => {
    expect(mapper()).toMatch(/case 'not_started': return 'pending'/)
  })

  it("lets only 'complete' become 'executed'", () => {
    const executedCases = mapper()
      .split('\n')
      .filter(l => l.includes("'executed'"))
    expect(executedCases).toHaveLength(1)
    expect(executedCases[0]).toContain("case 'complete'")
  })

  it('defaults an unknown status to pending rather than executed', () => {
    expect(mapper()).toMatch(/default: return 'pending'/)
  })
})
