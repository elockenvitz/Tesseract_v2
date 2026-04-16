/**
 * Trade Reconciliation Service
 *
 * Compute per-trade reconciliations when a new holdings snapshot lands. For
 * each pending accepted_trade in the reconciliation window, compare the
 * trade's expected ending shares against the asset's actual shares in the
 * new snapshot and produce a trade_reconciliations row + update the trade's
 * summary fields.
 *
 * Scope:
 *   - `live_feed` portfolios — the primary use case. Trades stay pending
 *     until a holdings file lands and reconciles them.
 *   - `manual_eod` portfolios — accepted as a fallback for any historical
 *     pending trades that pre-date the auto-apply fix. New manual_eod trades
 *     are matched immediately on create (see finalizeTradeForHoldingsSource)
 *     and so are skipped here by the reconciliation_status='pending' filter.
 *   - `paper` portfolios — never enter this path. Auto-applied + matched on
 *     create.
 *
 *   - Uses trade.target_shares as the authoritative expected (set by the
 *     Lab promotion path). Trades without target_shares fall back to
 *     previous + delta_shares.
 *   - Reconciliation is per-trade, not per-asset. If an asset has multiple
 *     trades in one window, each trade is reconciled independently against
 *     the same actual shares.
 *
 * Also exposes:
 *   - `markStaleAcceptedTrades` — sweeper that flags pending trades whose
 *     `last_activity_at` is older than the portfolio's inactivity window.
 *   - `recordReconciliationRun` — wraps a reconciliation pass with a
 *     `reconciliation_runs` audit row.
 */

import { supabase } from '../supabase'
import type { ReconciliationStatus } from '../../types/trading'

// ---------------------------------------------------------------------------
// Tolerance
// ---------------------------------------------------------------------------

/**
 * A diff within tolerance is treated as a match. Equity fills rarely come in
 * on the exact share count — lot sizes, rounding, and fractional settlements
 * all produce small deltas that aren't meaningful deviations.
 */
function tolerance(expected: number): number {
  // 0.5 shares or 0.5% of expected, whichever is larger.
  return Math.max(0.5, Math.abs(expected) * 0.005)
}

function deriveStatus(
  expected: number,
  actual: number,
  previous: number | null,
): ReconciliationStatus {
  const tol = tolerance(expected)
  const delta = actual - expected
  const absDelta = Math.abs(delta)

  // Happy path: ended up where we wanted.
  if (absDelta <= tol) return 'matched'

  // Didn't move at all — previous snapshot still accurate.
  if (previous != null && Math.abs(actual - previous) <= tol) return 'unmatched'

  // Moved in the expected direction but fell short.
  if (previous != null) {
    const expectedDelta = expected - previous
    const actualDelta = actual - previous
    const sameDirection = Math.sign(expectedDelta) === Math.sign(actualDelta)
    const magnitudesSmaller = Math.abs(actualDelta) < Math.abs(expectedDelta)
    if (sameDirection && magnitudesSmaller) return 'partial'
  }

  // Everything else: deviated.
  return 'deviated'
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReconciliationRow {
  id: string
  portfolio_id: string
  accepted_trade_id: string
  asset_id: string
  snapshot_id: string
  previous_snapshot_id: string | null
  expected_shares: number
  actual_shares: number
  previous_shares: number | null
  delta_shares: number
  deviation_pct: number | null
  status: ReconciliationStatus
  computed_at: string
  notes: string | null
}

export interface ReconcileResult {
  reconciled: number
  skipped: number
  byStatus: Record<ReconciliationStatus, number>
}

// ---------------------------------------------------------------------------
// Core entry point
// ---------------------------------------------------------------------------

/**
 * Run reconciliation for a newly landed EOD snapshot.
 *
 * Safe to call from client code. Only reconciles trades on manual_eod
 * portfolios. Idempotent via the (accepted_trade_id, snapshot_id) unique
 * constraint — calling it twice for the same snapshot upserts rather than
 * duplicating.
 */
export async function reconcilePortfolioSnapshot(
  portfolioId: string,
  snapshotId: string,
): Promise<ReconcileResult> {
  const empty: ReconcileResult = {
    reconciled: 0,
    skipped: 0,
    byStatus: { pending: 0, matched: 0, partial: 0, deviated: 0, unmatched: 0 },
  }

  // 1) Gate on holdings_source — only manual_eod portfolios get reconciled here.
  const { data: portfolio, error: pErr } = await supabase
    .from('portfolios')
    .select('holdings_source')
    .eq('id', portfolioId)
    .single()
  if (pErr || !portfolio) {
    console.warn('[Reconciliation] Failed to read portfolio holdings_source', pErr)
    return empty
  }
  if ((portfolio as any).holdings_source !== 'manual_eod') return empty

  // 2) Fetch the new snapshot (for snapshot_date) and its positions.
  const { data: newSnap, error: sErr } = await supabase
    .from('portfolio_holdings_snapshots')
    .select('id, snapshot_date')
    .eq('id', snapshotId)
    .single()
  if (sErr || !newSnap) {
    console.warn('[Reconciliation] Snapshot not found', snapshotId, sErr)
    return empty
  }

  const { data: newPositions } = await supabase
    .from('portfolio_holdings_positions')
    .select('asset_id, shares')
    .eq('snapshot_id', snapshotId)

  const actualByAsset = new Map<string, number>()
  for (const p of newPositions || []) {
    if ((p as any).asset_id) actualByAsset.set((p as any).asset_id, Number((p as any).shares) || 0)
  }

  // 3) Previous snapshot (if any).
  const { data: prevSnap } = await supabase
    .from('portfolio_holdings_snapshots')
    .select('id, snapshot_date, created_at')
    .eq('portfolio_id', portfolioId)
    .lt('snapshot_date', (newSnap as any).snapshot_date)
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  // If there's no previous snapshot, we can't establish a reconciliation
  // window. First upload: skip — nothing to diff against.
  if (!prevSnap) return empty

  const prevSnapshotId = (prevSnap as any).id as string

  const { data: prevPositions } = await supabase
    .from('portfolio_holdings_positions')
    .select('asset_id, shares')
    .eq('snapshot_id', prevSnapshotId)

  const previousByAsset = new Map<string, number>()
  for (const p of prevPositions || []) {
    if ((p as any).asset_id) previousByAsset.set((p as any).asset_id, Number((p as any).shares) || 0)
  }

  // 4) Accepted trades created within the reconciliation window.
  // Using created_at > prev.created_at rather than snapshot_date so we don't
  // miss trades accepted on the same date as the prev snapshot.
  const { data: trades, error: tErr } = await supabase
    .from('accepted_trades')
    .select('id, asset_id, target_shares, delta_shares, created_at, is_active')
    .eq('portfolio_id', portfolioId)
    .eq('is_active', true)
    .gt('created_at', (prevSnap as any).created_at)
  if (tErr) {
    console.warn('[Reconciliation] Failed to fetch trades', tErr)
    return empty
  }
  if (!trades || trades.length === 0) return empty

  // 5) Build reconciliation rows.
  const rows: Array<Partial<ReconciliationRow>> = []
  const perTradeSummary: Array<{ id: string; status: ReconciliationStatus; detail: any }> = []
  const counts: ReconcileResult = {
    reconciled: 0,
    skipped: 0,
    byStatus: { pending: 0, matched: 0, partial: 0, deviated: 0, unmatched: 0 },
  }

  for (const t of trades as any[]) {
    const assetId = t.asset_id as string

    // Expected ending shares. Prefer target_shares (authoritative absolute
    // from the Lab promotion path). Fall back to previous + delta_shares if
    // only delta is set. If neither, skip — can't compute.
    let expected: number | null = null
    if (t.target_shares != null) {
      expected = Number(t.target_shares)
    } else if (t.delta_shares != null) {
      const prev = previousByAsset.get(assetId) ?? 0
      expected = prev + Number(t.delta_shares)
    }
    if (expected == null) {
      counts.skipped++
      continue
    }

    const actual = actualByAsset.get(assetId) ?? 0
    const previous = previousByAsset.get(assetId) ?? null
    const status = deriveStatus(expected, actual, previous)
    const delta = actual - expected
    const deviationPct = Math.abs(expected) > 0 ? Math.abs(delta) / Math.abs(expected) : null

    rows.push({
      portfolio_id: portfolioId,
      accepted_trade_id: t.id as string,
      asset_id: assetId,
      snapshot_id: snapshotId,
      previous_snapshot_id: prevSnapshotId,
      expected_shares: expected,
      actual_shares: actual,
      previous_shares: previous,
      delta_shares: delta,
      deviation_pct: deviationPct,
      status,
    })
    perTradeSummary.push({
      id: t.id as string,
      status,
      detail: {
        actual_shares: actual,
        previous_shares: previous,
        expected_shares: expected,
        delta_shares: delta,
        deviation_pct: deviationPct,
        snapshot_id: snapshotId,
      },
    })
    counts.reconciled++
    counts.byStatus[status]++
  }

  if (rows.length === 0) return counts

  // 6) Upsert reconciliation rows. ON CONFLICT on (accepted_trade_id,
  // snapshot_id) replaces an existing row — supports re-running reconciliation
  // if the snapshot gets re-imported.
  const { error: insErr } = await supabase
    .from('trade_reconciliations')
    .upsert(rows as any[], { onConflict: 'accepted_trade_id,snapshot_id' })
  if (insErr) {
    console.warn('[Reconciliation] Failed to upsert reconciliation rows', insErr)
    return counts
  }

  // 7) Mirror the summary onto accepted_trades for fast filtering.
  // One UPDATE per trade — acceptable for typical daily volumes.
  const now = new Date().toISOString()
  for (const s of perTradeSummary) {
    await supabase
      .from('accepted_trades')
      .update({
        reconciliation_status: s.status,
        reconciled_at: now,
        reconciliation_detail: s.detail,
        updated_at: now,
      })
      .eq('id', s.id)
  }

  return counts
}

// ---------------------------------------------------------------------------
// Reconciliation run audit
// ---------------------------------------------------------------------------

/**
 * Record a `reconciliation_runs` audit row for a completed reconciliation
 * pass. The run is inserted with `started_at` = now minus the elapsed cost
 * (caller tracks their own start time) and `completed_at` = now.
 *
 * Safe to call after `reconcilePortfolioSnapshot` succeeds. Non-fatal if the
 * insert fails — the reconciliation itself is already persisted.
 */
export async function recordReconciliationRun(params: {
  portfolioId: string
  result: ReconcileResult
  holdingsUploadId?: string | null
  startedAt?: string
  reviewerId?: string | null
  notes?: string | null
}): Promise<{ id: string } | null> {
  const startedAt = params.startedAt ?? new Date().toISOString()
  const completedAt = new Date().toISOString()

  const { data, error } = await supabase
    .from('reconciliation_runs')
    .insert({
      portfolio_id: params.portfolioId,
      holdings_upload_id: params.holdingsUploadId ?? null,
      started_at: startedAt,
      completed_at: completedAt,
      matched_count: params.result.byStatus.matched || 0,
      partial_count: params.result.byStatus.partial || 0,
      deviated_count: params.result.byStatus.deviated || 0,
      unmatched_count: params.result.byStatus.unmatched || 0,
      reviewer_id: params.reviewerId ?? null,
      notes: params.notes ?? null,
    })
    .select('id')
    .single()

  if (error) {
    console.warn('[Reconciliation] Failed to record reconciliation_runs row', error)
    return null
  }
  return data as { id: string }
}

// ---------------------------------------------------------------------------
// Staleness sweeper
// ---------------------------------------------------------------------------

export interface StaleSweepResult {
  scanned: number
  flagged: number
}

/**
 * Flag pending accepted_trades whose `last_activity_at` is older than the
 * portfolio's `reconciliation_inactivity_days` window. Flag only — the row's
 * `reconciliation_status` stays 'pending'; the PM decides whether to mark it
 * partial / unmatched / continue working.
 *
 * Idempotent: rows that are already flagged are skipped. Callers can pass a
 * single `portfolioId` to sweep just one portfolio, or omit it to sweep every
 * portfolio the caller has RLS visibility into.
 *
 * Intended to be called on demand (e.g., when the Trade Book loads) or from
 * a future scheduled edge function. Client-side sweeping is safe because
 * RLS scopes the UPDATE to portfolios the user can already write.
 */
export async function markStaleAcceptedTrades(
  portfolioId?: string,
): Promise<StaleSweepResult> {
  const result: StaleSweepResult = { scanned: 0, flagged: 0 }

  // 1) Load portfolio(s) + their inactivity window.
  let portfoliosQuery = supabase
    .from('portfolios')
    .select('id, reconciliation_inactivity_days, holdings_source')
  if (portfolioId) portfoliosQuery = portfoliosQuery.eq('id', portfolioId)

  const { data: portfolios, error: pErr } = await portfoliosQuery
  if (pErr || !portfolios) {
    console.warn('[Staleness] Failed to load portfolios', pErr)
    return result
  }

  for (const p of portfolios as any[]) {
    // Paper portfolios auto-match on create; they never accumulate stale
    // pending rows. Skip.
    if (p.holdings_source === 'paper') continue

    const days = Number(p.reconciliation_inactivity_days) || 5
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

    // 2) Find pending, active, unflagged trades past the cutoff.
    const { data: stale, error: sErr } = await supabase
      .from('accepted_trades')
      .select('id')
      .eq('portfolio_id', p.id)
      .eq('is_active', true)
      .eq('reconciliation_status', 'pending')
      .is('staleness_flagged_at', null)
      .lt('last_activity_at', cutoff)

    if (sErr) {
      console.warn('[Staleness] Failed to scan portfolio', p.id, sErr)
      continue
    }

    result.scanned += stale?.length || 0
    if (!stale || stale.length === 0) continue

    const now = new Date().toISOString()
    const ids = (stale as any[]).map(r => r.id)
    const { error: uErr } = await supabase
      .from('accepted_trades')
      // last_activity_at is explicitly preserved so the sweeper does not
      // reset the staleness clock on the row it just flagged (the UPDATE
      // trigger only bumps activity when the field is NOT DISTINCT from OLD).
      .update({ staleness_flagged_at: now, last_activity_at: now })
      .in('id', ids)

    if (uErr) {
      console.warn('[Staleness] Failed to flag stale rows', uErr)
      continue
    }
    result.flagged += ids.length
  }

  return result
}
