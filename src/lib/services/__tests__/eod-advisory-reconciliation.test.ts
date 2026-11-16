/**
 * What an EOD holdings upload can and cannot prove about one trade.
 *
 * ── The product rule ────────────────────────────────────────────────────
 *
 * An EOD holdings match is NOT proof of an individual trade fill. The upload
 * reports positions. A position agreeing with what a trade expected is equally
 * consistent with that trade having filled, with a different trade on the same
 * name having filled, and with the desk having done nothing while Tesseract's
 * own pilot-policy apply moved the number at approval time.
 *
 * That last case is not hypothetical, it is the normal case: every production
 * portfolio is `manual_eod`, and `finalizeTradeForHoldingsSource` applies an
 * approved trade to the model book immediately, writing a
 * `pm_assumed_execution` evidence row. The upload then arrives and is compared
 * against a previous snapshot that `applyTradeToHoldings` already wrote the
 * trade into.
 *
 * So for a trade this application applied itself, the comparison is a REVIEW
 * ITEM, not a verdict: it is recorded, it surfaces a mismatch, and it claims
 * neither that the fill happened nor that it did not.
 *
 * ── What these tests hold ───────────────────────────────────────────────
 *
 * 1. The comparison RUNS for an already-applied trade. (The service header
 *    used to claim such trades were filtered out. They never were.)
 * 2. A matching position does not become a fill confirmation.
 * 3. A mismatch still surfaces.
 * 4. `reconciliation_status` is not overwritten for a self-applied trade,
 *    because `pro-forma-baseline-service` reads that column as "not yet in
 *    holdings" and would add the shares a second time.
 * 5. Nothing in this path touches holdings at all.
 * 6. A trade the DESK executed is still a verdict, because the upload is an
 *    independent measurement of it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Op = [string, unknown[]]

const db = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; ops: Op[] }>,
  rpc: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  holdingsSource: 'manual_eod' as string,
  /** The trade in the reconciliation window. SHOP, taken to 9,890 shares. */
  trades: [] as Array<Record<string, unknown>>,
  /** Positions in the NEW snapshot — what the EOD upload says. */
  actual: [] as Array<Record<string, unknown>>,
  /**
   * Positions in the PREVIOUS snapshot — the comparison baseline.
   *
   * For a self-applied trade this already contains the trade, because
   * `applyTradeToHoldings` upserts into the latest snapshot's positions when
   * the PM approves. The fixtures below say so explicitly.
   */
  previous: [] as Array<Record<string, unknown>>,
  /** `portfolio_trade_events` rows, i.e. the execution evidence. */
  evidence: [] as Array<Record<string, unknown>>,
  /** Rows written to `trade_reconciliations`. */
  comparisons: [] as Array<Record<string, unknown>>,
  /** Updates applied to `accepted_trades`. */
  tradeUpdates: [] as Array<Record<string, unknown>>,
}))

const has = (ops: Op[], name: string) => ops.some(([op]) => op === name)
const argsOf = (ops: Op[], name: string) => ops.find(([op]) => op === name)?.[1]

vi.mock('../../supabase', () => ({
  supabase: {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      db.rpc.push({ fn, args })
      return { data: null, error: null }
    },
    from: (table: string) => {
      const call = { table, ops: [] as Op[] }
      db.calls.push(call)
      const chain: Record<string, unknown> = {}
      for (const op of [
        'select', 'insert', 'update', 'delete', 'upsert', 'eq', 'neq', 'in',
        'is', 'not', 'gt', 'gte', 'lt', 'lte', 'order', 'limit', 'maybeSingle', 'single',
      ]) {
        chain[op] = (...args: unknown[]) => { call.ops.push([op, args]); return chain }
      }
      chain.then = (resolve: (v: unknown) => unknown) => {
        let data: unknown = null

        if (table === 'portfolios') {
          data = { holdings_source: db.holdingsSource }
        } else if (table === 'portfolio_holdings_snapshots' && has(call.ops, 'single')) {
          // Step 2: the snapshot that just landed.
          data = { id: 'snap-new', snapshot_date: '2026-11-16' }
        } else if (table === 'portfolio_holdings_snapshots') {
          // Step 3: the previous snapshot, read with maybeSingle.
          data = { id: 'snap-prev', snapshot_date: '2026-11-15', created_at: '2026-11-15T21:00:00Z' }
        } else if (table === 'portfolio_holdings_positions') {
          // Distinguished by WHICH snapshot the caller asked for, which is
          // the only thing that separates these two reads.
          const eqArgs = call.ops.filter(([op]) => op === 'eq').map(([, a]) => a)
          const forNew = eqArgs.some(a => a[1] === 'snap-new')
          data = forNew ? db.actual : db.previous
        } else if (table === 'accepted_trades' && has(call.ops, 'update')) {
          db.tradeUpdates.push(argsOf(call.ops, 'update')![0] as Record<string, unknown>)
          data = null
        } else if (table === 'accepted_trades') {
          data = db.trades
        } else if (table === 'portfolio_trade_events') {
          data = db.evidence
        } else if (table === 'trade_reconciliations' && has(call.ops, 'upsert')) {
          const rows = argsOf(call.ops, 'upsert')![0] as Array<Record<string, unknown>>
          db.comparisons.push(...rows)
          data = null
        }

        return Promise.resolve({ data, error: null }).then(resolve)
      }
      return chain
    },
  },
}))

import { reconcilePortfolioSnapshot } from '../trade-reconciliation-service'

/** The trade: SHOP taken to 9,890 shares from a 12,000 base. */
const SHOP_TRADE = {
  id: 'at-1',
  asset_id: 'a-shop',
  target_shares: 9890,
  delta_shares: -2110,
  created_at: '2026-11-16T09:00:00Z',
  is_active: true,
}

const evidenceRow = (origin: string) => ({
  metadata: { origin, accepted_trade_id: 'at-1' },
  detected_by_system: origin === 'paper_execute',
  source_type: origin === 'paper_execute' ? 'holdings_diff' : 'manual',
})

const run = () => reconcilePortfolioSnapshot('p1', 'snap-new')

beforeEach(() => {
  db.calls = []; db.rpc = []; db.comparisons = []; db.tradeUpdates = []
  db.holdingsSource = 'manual_eod'
  db.trades = [{ ...SHOP_TRADE }]
  /*
   * The baseline ALREADY holds 9,890 — the pilot apply wrote the trade into
   * the latest snapshot's positions when the PM approved it. This is the
   * single most important thing about these fixtures.
   */
  db.previous = [{ asset_id: 'a-shop', shares: 9890 }]
  db.actual = [{ asset_id: 'a-shop', shares: 9890 }]
  db.evidence = [evidenceRow('pm_assumed_execution')]
})

describe('an assumed execution IS compared against the upload', () => {
  it('writes a comparison row for it', async () => {
    /*
     * The service header used to say trades already applied to the model book
     * were "skipped here by the reconciliation_status='pending' filter". There
     * is no such filter: the selection is on `is_active` and `created_at`.
     * The comparison was always running, and a reader who believed the comment
     * would go looking for a fix instead of for this row.
     */
    const result = await run()
    expect(result.reconciled).toBe(1)
    expect(db.comparisons).toHaveLength(1)
    expect(db.comparisons[0].accepted_trade_id).toBe('at-1')
  })

  it('records WHY the comparison is not a verdict, on the row itself', async () => {
    await run()
    expect(String(db.comparisons[0].notes)).toContain('cannot confirm or deny')
  })
})

describe('a matching position does not become a fill confirmation', () => {
  it('never claims the fill was confirmed', async () => {
    // The positions agree exactly. That is the case most likely to be
    // mistaken for proof, and it is the weakest: the number agrees because
    // Tesseract itself put it there.
    await run()
    const detail = db.tradeUpdates[0].reconciliation_detail as Record<string, unknown>
    expect(detail.confirms_fill).toBe(false)
    expect(detail.advisory).toBe(true)
    expect(detail.evidence_grade).toBe('assumed')
  })

  it('records that the baseline contains the trade being measured', async () => {
    await run()
    const detail = db.tradeUpdates[0].reconciliation_detail as Record<string, unknown>
    expect(detail.baseline_includes_this_trade).toBe(true)
  })

  it('writes no broker-confirmed evidence, and no evidence at all', async () => {
    /*
     * Reconciliation is a read-and-compare. If a match could mint an
     * execution event the system would be manufacturing a fill out of its own
     * bookkeeping, which is the fiction this whole lane is about.
     */
    await run()
    const eventWrites = db.calls.filter(c =>
      c.table === 'portfolio_trade_events'
      && (has(c.ops, 'insert') || has(c.ops, 'upsert') || has(c.ops, 'update')))
    expect(eventWrites).toHaveLength(0)
  })
})

describe('a mismatch still surfaces', () => {
  it('produces a non-matched comparison when the upload disagrees', async () => {
    // The desk did not trade: the book still holds the pre-trade 12,000.
    db.actual = [{ asset_id: 'a-shop', shares: 12000 }]
    await run()
    expect(db.comparisons[0].status).not.toBe('matched')
    expect(db.comparisons[0].actual_shares).toBe(12000)
    expect(db.comparisons[0].expected_shares).toBe(9890)
    expect(db.comparisons[0].delta_shares).toBe(2110)
  })

  it('still refuses to call that a denied fill', async () => {
    /*
     * A mismatch is a review item for the same reason a match is. The
     * baseline includes our own apply, so `deriveStatus` cannot reach its
     * "did not move at all" branch, and the discrepancy could as easily be a
     * second trade on the name or a late upload.
     */
    db.actual = [{ asset_id: 'a-shop', shares: 12000 }]
    await run()
    const detail = db.tradeUpdates[0].reconciliation_detail as Record<string, unknown>
    expect(detail.advisory).toBe(true)
    expect(detail.confirms_fill).toBe(false)
    expect(String(detail.advisory_note)).toContain('positions, not fills')
  })
})

describe('the already-applied shares are never applied again', () => {
  it('calls no holdings RPC', async () => {
    await run()
    expect(db.rpc).toHaveLength(0)
  })

  it('writes nothing to portfolio_holdings', async () => {
    await run()
    expect(db.calls.filter(c => c.table === 'portfolio_holdings')).toHaveLength(0)
  })

  it('leaves reconciliation_status alone, so pro-forma cannot double-count', async () => {
    /*
     * `fetchPendingCommitments` selects
     * `reconciliation_status='pending' AND is_active` as the L1 layer of
     * commitments NOT yet in holdings, and adds their shares on top of live
     * holdings — with no `execution_status` filter. Writing any status here
     * for a trade whose shares are already in L0 risks exactly that; writing
     * `pending` guarantees it.
     */
    await run()
    expect(db.tradeUpdates).toHaveLength(1)
    expect(db.tradeUpdates[0]).not.toHaveProperty('reconciliation_status')
  })

  it('still stamps reconciled_at, because the comparison did run', async () => {
    await run()
    expect(db.tradeUpdates[0].reconciled_at).toBeTruthy()
  })
})

describe('a desk-executed trade is still a verdict', () => {
  beforeEach(() => {
    /*
     * An attestation means the fill happened away from the app, so Tesseract
     * never incremented holdings for it: the baseline does NOT contain it, and
     * the upload is an independent measurement. That is the one grade where
     * the comparison genuinely decides something.
     */
    db.evidence = [evidenceRow('trader_attested')]
    db.previous = [{ asset_id: 'a-shop', shares: 12000 }]
    db.actual = [{ asset_id: 'a-shop', shares: 9890 }]
  })

  it('mirrors the comparison onto the trade', async () => {
    await run()
    expect(db.tradeUpdates[0].reconciliation_status).toBe('matched')
  })

  it('is not marked advisory', async () => {
    await run()
    const detail = db.tradeUpdates[0].reconciliation_detail as Record<string, unknown>
    expect(detail.advisory).toBe(false)
    expect(detail.baseline_includes_this_trade).toBe(false)
  })

  it('still does not claim the fill was confirmed', async () => {
    // A person's word is not a counterparty record, and a position agreeing
    // with it is not one either.
    await run()
    const detail = db.tradeUpdates[0].reconciliation_detail as Record<string, unknown>
    expect(detail.confirms_fill).toBe(false)
  })
})

describe('an ungradeable trade fails closed', () => {
  it('is advisory when no evidence is readable', async () => {
    /*
     * No evidence row, or an RLS denial on the evidence table, both arrive
     * here as an empty read. The wrong direction to be wrong in is recording
     * a verdict nothing earned, so an absent grade is treated as advisory.
     */
    db.evidence = []
    await run()
    const detail = db.tradeUpdates[0].reconciliation_detail as Record<string, unknown>
    expect(detail.advisory).toBe(true)
    expect(detail.evidence_grade).toBeNull()
    expect(db.tradeUpdates[0]).not.toHaveProperty('reconciliation_status')
  })
})

describe('portfolios that never enter this path', () => {
  it('a paper portfolio is left entirely alone', async () => {
    db.holdingsSource = 'paper'
    const result = await run()
    expect(result.reconciled).toBe(0)
    expect(db.comparisons).toHaveLength(0)
    expect(db.tradeUpdates).toHaveLength(0)
  })

  it('a live_feed portfolio is left entirely alone', async () => {
    // Unchanged behaviour: this function has always gated on manual_eod.
    db.holdingsSource = 'live_feed'
    const result = await run()
    expect(result.reconciled).toBe(0)
    expect(db.comparisons).toHaveLength(0)
  })
})
