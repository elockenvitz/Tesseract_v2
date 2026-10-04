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
  /** Rows portfolio_trade_events returns for this trade: the evidence. */
  evidence: [] as Array<{ metadata: Record<string, unknown> }>,
}))

/** Evidence as it would exist after a system-applied (observed) execution. */
const OBSERVED_EVIDENCE = [{ metadata: { origin: 'paper_execute', accepted_trade_id: 'at-1' } }]
/** Evidence as it would exist after a trader attested execution. */
const ATTESTED_EVIDENCE = [{ metadata: { origin: 'trader_attested', accepted_trade_id: 'at-1' } }]

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
        } else if (table === 'portfolio_trade_events' && has(call.ops, 'select')) {
          data = db.evidence
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
  updateExecutionStatus,
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
  db.evidence = []
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

/*
 * Reversal is covered by "reverting against execution evidence" below.
 *
 * An earlier version of this block gated on `execution_status === 'complete'`,
 * which is what Slice 1 shipped. That gate was wrong — a status can be set by
 * hand — so the cases moved to the evidence-based block rather than being
 * kept here in two versions that disagree about the rule.
 */

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
// Trader attestation produces evidence, not just a status
// ───────────────────────────────────────────────────────────────────────────

/** A sized trade sitting unexecuted, as Slice 1 now leaves a refused apply. */
const PENDING_SIZED_TRADE = {
  id: 'at-1',
  portfolio_id: 'p1',
  asset_id: 'a-aapl',
  action: 'add',
  execution_status: 'in_progress',
  delta_shares: 539,
  target_shares: 11039,
  price_at_acceptance: 308.33,
  source: 'inbox',
  decision_request_id: 'dr-1',
  trade_queue_item_id: 'tq-1',
  batch_id: null,
}

const evidenceInserts = () =>
  db.calls.filter(c => c.table === 'portfolio_trade_events' && has(c.ops, 'insert'))

const evidenceRow = () => arg0(evidenceInserts()[0]?.ops ?? [], 'insert')

describe('a trader marking a manual_eod trade complete', () => {
  beforeEach(() => { db.tradeRow = { ...PENDING_SIZED_TRADE } })

  it('writes canonical execution evidence, not only a status', async () => {
    await updateExecutionStatus('at-1', 'complete', null, { actorId: 'u-trader' } as never)
    expect(evidenceInserts()).toHaveLength(1)
    expect(evidenceRow()?.quantity_delta).toBe(539)
  })

  it('marks that evidence as attested, not observed', async () => {
    // The whole point of the provenance split: the system did not watch
    // this happen, a person said it happened.
    await updateExecutionStatus('at-1', 'complete', null, { actorId: 'u-trader' } as never)
    const row = evidenceRow()
    expect(row?.source_type).toBe('manual')
    expect(row?.detected_by_system).toBe(false)
    expect((row?.metadata as Record<string, unknown>)?.origin).toBe('trader_attested')
  })

  it('emits execution.recorded with attested provenance', async () => {
    await updateExecutionStatus('at-1', 'complete', null, { actorId: 'u-trader' } as never)
    expect(memory.execution).toHaveLength(1)
    expect(memory.execution[0].provenance).toBe('attested:trader')
  })

  it('still flips the status, because the claim is now backed', async () => {
    await updateExecutionStatus('at-1', 'complete', null, { actorId: 'u-trader' } as never)
    const u = db.calls
      .filter(c => c.table === 'accepted_trades' && has(c.ops, 'update'))
      .map(c => arg0(c.ops, 'update'))[0]
    expect(u?.execution_status).toBe('complete')
    expect(u?.execution_completed_at).toBeTruthy()
  })

  it('refuses to complete a trade nobody can size', async () => {
    // An execution with no quantity is not evidence of anything. The trade
    // can still be cancelled or corrected — it cannot be called executed.
    db.tradeRow = { ...PENDING_SIZED_TRADE, delta_shares: null, target_shares: null }
    await expect(
      updateExecutionStatus('at-1', 'complete', null, { actorId: 'u-trader' } as never),
    ).rejects.toThrow(/no executable share quantity/i)
  })

  it('leaves the status alone when it refuses', async () => {
    db.tradeRow = { ...PENDING_SIZED_TRADE, delta_shares: null, target_shares: null }
    await updateExecutionStatus('at-1', 'complete', null, { actorId: 'u-trader' } as never)
      .catch(() => {})
    const statusWrites = db.calls.filter(
      c => c.table === 'accepted_trades'
        && has(c.ops, 'update')
        && arg0(c.ops, 'update')?.execution_status === 'complete',
    )
    expect(statusWrites).toHaveLength(0)
    expect(memory.execution).toHaveLength(0)
    expect(evidenceInserts()).toHaveLength(0)
  })

  it('writes no evidence and no event for in_progress', async () => {
    // Starting work is not executing. Only completion attests.
    await updateExecutionStatus('at-1', 'in_progress', null, { actorId: 'u-trader' } as never)
    expect(evidenceInserts()).toHaveLength(0)
    expect(memory.execution).toHaveLength(0)
  })

  it('does not double-record a trade the system already executed', async () => {
    // Idempotency against the observed path: the trade is already evidenced,
    // so no second row is written.
    db.evidence = OBSERVED_EVIDENCE
    await updateExecutionStatus('at-1', 'complete', null, { actorId: 'u-trader' } as never)
    expect(evidenceInserts()).toHaveLength(0)
  })

  it('does not double-record on a repeated attestation', async () => {
    db.evidence = ATTESTED_EVIDENCE
    await updateExecutionStatus('at-1', 'complete', null, { actorId: 'u-trader' } as never)
    expect(evidenceInserts()).toHaveLength(0)
  })

  it('keys its memory event on the trade id, so retries collapse', async () => {
    await updateExecutionStatus('at-1', 'complete', null, { actorId: 'u-trader' } as never)
    db.evidence = ATTESTED_EVIDENCE
    await updateExecutionStatus('at-1', 'complete', null, { actorId: 'u-trader' } as never)
    expect(new Set(memory.execution.map(e => e.acceptedTradeId)).size).toBe(1)
  })
})

describe('the observed path keeps its own provenance', () => {
  it('labels a system-applied execution as observed', async () => {
    await createAcceptedTrade(SIZED_INPUT)
    expect(String(memory.execution[0].provenance)).toMatch(/^observed:holdings-apply/)
  })

  it('still marks its evidence detected_by_system', async () => {
    await createAcceptedTrade(SIZED_INPUT)
    const row = evidenceRow()
    expect(row?.source_type).toBe('holdings_diff')
    expect(row?.detected_by_system).toBe(true)
    expect((row?.metadata as Record<string, unknown>)?.origin).toBe('paper_execute')
  })
})

/**
 * The pilot's third grade of proof.
 *
 * Under the pilot contract a PM's approval produces execution evidence
 * labelled `pm_assumed_execution`: nothing observed a fill and nobody
 * attested to one: a decision implied it. Two consequences have to hold,
 * and they pull in opposite directions.
 */
describe('pm-assumed execution evidence', () => {
  const PM_ASSUMED_EVIDENCE = [
    { metadata: { origin: 'pm_assumed_execution', accepted_trade_id: 'at-1' } },
  ]

  it('IS reversible — the app moved those shares, so the app takes them back', async () => {
    /*
     * The opposite of the attested case, and for a mechanical reason rather
     * than a credibility one. An attested execution happened at the desk, so
     * our holdings were never incremented by it. An assumed execution went
     * through `apply_trade_to_holdings` exactly like an observed one. If
     * `pm_assumed` were left out of the system-applied set, a revert would
     * silently strand the position it was supposed to remove.
     */
    db.tradeRow = { ...PENDING_SIZED_TRADE, execution_status: 'complete' }
    db.evidence = PM_ASSUMED_EVIDENCE

    await revertAcceptedTrade('at-1', 'approved in error', { actorId: 'u1' } as never)

    const mutations = db.calls.filter(
      c => c.table === 'portfolio_holdings' && (has(c.ops, 'update') || has(c.ops, 'delete')),
    )
    expect(mutations.length).toBeGreaterThan(0)
  })

  it('does not suppress a later trader attestation', async () => {
    /*
     * `emitAttestedExecutionEvent` used to return early on ANY existing
     * evidence row. Under the pilot every accept writes one immediately, so
     * a trader confirming the real fill would have been told "already
     * evidenced" and their attestation would never have been recorded — the
     * assumption permanently crowding out the fact.
     */
    db.tradeRow = { ...PENDING_SIZED_TRADE, execution_status: 'not_started' }
    db.evidence = PM_ASSUMED_EVIDENCE
    const before = db.calls.filter(c => c.table === 'portfolio_trade_events' && has(c.ops, 'insert')).length

    await updateExecutionStatus('at-1', 'complete', 'filled at the desk', { actorId: 'u1' } as never)

    const after = db.calls.filter(c => c.table === 'portfolio_trade_events' && has(c.ops, 'insert')).length
    expect(after).toBeGreaterThan(before)
  })

  it('a second attestation is still a no-op', async () => {
    // The double-click case the idempotency guard actually exists for.
    db.tradeRow = { ...PENDING_SIZED_TRADE, execution_status: 'not_started' }
    db.evidence = [{ metadata: { origin: 'trader_attested', accepted_trade_id: 'at-1' } }]
    const before = db.calls.filter(c => c.table === 'portfolio_trade_events' && has(c.ops, 'insert')).length

    await updateExecutionStatus('at-1', 'complete', 'again', { actorId: 'u1' } as never)

    const after = db.calls.filter(c => c.table === 'portfolio_trade_events' && has(c.ops, 'insert')).length
    expect(after).toBe(before)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Reversal follows evidence, never status
// ───────────────────────────────────────────────────────────────────────────

describe('reverting against execution evidence', () => {
  /**
   * The regression this slice exists to prevent.
   *
   * Slice 1 left a priced-but-refused trade at not_started, which made the
   * execution dropdown reachable on manual_eod for the first time. A trader
   * could then walk it to 'complete' by hand. Because the revert gate keyed
   * on `execution_status === 'complete'`, reverting it called
   * reverseTradeOnHoldings on a trade whose delta_shares were populated but
   * whose holdings were never applied — subtracting 539 shares the portfolio
   * never gained.
   */
  it('performs ZERO holdings mutation for a manually completed trade with no evidence', async () => {
    db.tradeRow = {
      ...PENDING_SIZED_TRADE,
      execution_status: 'complete', // set by hand
      price_at_acceptance: null, // the apply was refused
    }
    db.evidence = [] // nothing ever executed

    await revertAcceptedTrade('at-1', 'never actually traded', { actorId: 'u1' } as never)

    const mutations = db.calls.filter(
      c => c.table === 'portfolio_holdings' && (has(c.ops, 'update') || has(c.ops, 'delete')),
    )
    expect(mutations).toHaveLength(0)
  })

  it('performs ZERO holdings mutation when the evidence is only attested', async () => {
    // The desk moved these shares, not the app. The app's holdings were
    // never incremented, so they must not be decremented; the next EOD
    // upload carries the reality.
    db.tradeRow = { ...PENDING_SIZED_TRADE, execution_status: 'complete' }
    db.evidence = ATTESTED_EVIDENCE

    await revertAcceptedTrade('at-1', 'attested in error', { actorId: 'u1' } as never)

    const mutations = db.calls.filter(
      c => c.table === 'portfolio_holdings' && (has(c.ops, 'update') || has(c.ops, 'delete')),
    )
    expect(mutations).toHaveLength(0)
  })

  it('DOES reverse when the system applied the trade itself', async () => {
    db.tradeRow = { ...PENDING_SIZED_TRADE, execution_status: 'complete' }
    db.evidence = OBSERVED_EVIDENCE

    await revertAcceptedTrade('at-1', 'wrong size', { actorId: 'u1' } as never)

    const write = db.calls.find(c => c.table === 'portfolio_holdings' && has(c.ops, 'update'))
    expect(write, 'expected a holdings reversal write').toBeTruthy()
    expect(arg0(write!.ops, 'update')?.shares).toBe(10500) // 11039 - 539
  })

  it('still withdraws the decision in every case', async () => {
    db.tradeRow = { ...PENDING_SIZED_TRADE, execution_status: 'complete' }
    db.evidence = []
    await revertAcceptedTrade('at-1', 'x', { actorId: 'u1' } as never)
    const soft = db.calls.find(
      c => c.table === 'accepted_trades'
        && has(c.ops, 'update')
        && arg0(c.ops, 'update')?.is_active === false,
    )
    expect(soft).toBeTruthy()
  })
})

// ───────────────────────────────────────────────────────────────────────────
// The code may not write a status the database will reject
// ───────────────────────────────────────────────────────────────────────────

/*
 * `accepted_trades.execution_status` is TEXT with a CHECK constraint, not an
 * enum, and the constraint lives in production — no migration in this repo
 * defines it. Verified against production on 2026-10-02:
 *
 *   accepted_trades_execution_status_check
 *     CHECK (execution_status = ANY (ARRAY['not_started','in_progress',
 *                                          'complete','cancelled']))
 *
 * The danger this pins down: writing a value outside that set does not
 * degrade, it throws, at the moment a PM clicks. `useOutcomes.mapExecStatus`
 * carries a `case 'failed'` arm, which reads as though 'failed' were a state
 * this system has — it is not, nothing writes it, and it must not be written
 * until the constraint is widened first.
 *
 * So: the TypeScript union is the contract, and it must not drift ahead of
 * the database. Widening the union without the migration breaks here.
 */
const PRODUCTION_CHECK_VALUES = ['not_started', 'in_progress', 'complete', 'cancelled']

describe('execution_status values the database will accept', () => {
  const tradingTypes = () =>
    readFileSync(path.join(process.cwd(), 'src', 'types', 'trading.ts'), 'utf8')

  const unionMembers = () => {
    const src = tradingTypes()
    const start = src.indexOf('export type ExecutionStatus')
    expect(start, 'ExecutionStatus union not found').toBeGreaterThan(-1)
    const line = src.slice(start, src.indexOf('\n', start))
    return [...line.matchAll(/'([a-z_]+)'/g)].map(m => m[1])
  }

  it('the TypeScript union matches the production CHECK exactly', () => {
    expect(unionMembers().sort()).toEqual([...PRODUCTION_CHECK_VALUES].sort())
  })

  it("does not include 'failed' — it is not a state this system has", () => {
    expect(unionMembers()).not.toContain('failed')
  })

  it('every literal the service writes is one the database accepts', () => {
    // Catches a hand-written literal that bypasses the typed signature.
    const service = readFileSync(
      path.join(process.cwd(), 'src', 'lib', 'services', 'accepted-trade-service.ts'),
      'utf8',
    )
    const written = [...service.matchAll(/execution_status:\s*'([a-z_]+)'/g)].map(m => m[1])
    expect(written.length, 'expected the service to write this column').toBeGreaterThan(0)
    for (const value of written) {
      expect(PRODUCTION_CHECK_VALUES, `service writes execution_status '${value}'`).toContain(value)
    }
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
