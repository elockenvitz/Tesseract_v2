/**
 * Pro Forma Baseline Service
 *
 * Read-only. Produces the "what would the book look like with all pending
 * commitments applied" view that the Trade Lab sim table uses as its
 * baseline (Layer 2 in the design).
 *
 *   L0 = the latest portfolio_holdings_snapshot's positions
 *   L1 = pending accepted_trades (reconciliation_status='pending', is_active)
 *   L2 = L0 + L1   ← what this service returns
 *
 * Execution-mode semantics (via portfolios.holdings_source):
 *   - 'paper'      → pilot mode. Execute auto-applies to holdings and marks
 *                    reconciliation_status='matched' in the same flow, so L1
 *                    is always empty and L2 ≡ L0.
 *   - 'manual_eod' → ALSO pilot-like. Manual EOD uploads are not an automated
 *                    feed, so trades auto-apply on accept and L1 stays empty.
 *                    A future per-portfolio toggle could opt into reconciliation
 *                    here for clients who want the audit trail.
 *   - 'live_feed'  → feed mode. THIS is where L1 accumulates until the next
 *                    reconciliation pass against an incoming holdings file.
 *                    Pro-forma baseline / Committed section / reconciliation
 *                    subtab are scoped to this mode.
 *
 * Callers should treat L2 as the source of truth for "current weight" in any
 * Trade Lab UI. Use getProFormaBaseline() for the merged view, or the layer
 * helpers if you need to render the diff (e.g. the "N pending commitments"
 * side panel).
 */

import { supabase } from '../supabase'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HoldingsSource = 'paper' | 'manual_eod' | 'live_feed'

/** A single line in the L0 holdings layer (latest snapshot positions). */
export interface BaselinePosition {
  asset_id: string
  symbol: string
  shares: number
  price: number | null
  market_value: number | null
  weight_pct: number | null
  sector: string | null
}

/**
 * A pending committed trade (L1). Slimmed down — callers that need full
 * accepted_trade joins should query accepted-trade-service directly.
 */
export interface PendingCommitment {
  id: string
  asset_id: string
  symbol: string
  action: 'buy' | 'sell' | 'add' | 'trim'
  delta_weight: number | null
  delta_shares: number | null
  target_weight: number | null
  target_shares: number | null
  notional_value: number | null
  last_activity_at: string
  staleness_flagged_at: string | null
  created_at: string
}

/**
 * A merged baseline row — the L2 view. One row per asset that appears in
 * either L0 or L1 (or both).
 *
 * `live_*` fields come from L0 (last snapshot).
 * `pro_forma_*` fields are the result of applying L1 on top.
 * `pending_count` tells the UI how many L1 rows touch this asset.
 */
export interface ProFormaPosition {
  asset_id: string
  symbol: string
  sector: string | null
  // L0 — what the book actually shows today
  live_shares: number
  live_weight_pct: number | null
  live_market_value: number | null
  // L2 — what it would show after applying pending commitments
  pro_forma_shares: number
  pro_forma_weight_pct: number | null
  // Diff
  delta_shares: number
  delta_weight_pct: number | null
  // Source
  pending_count: number
  pending_commitment_ids: string[]
}

export interface ProFormaBaseline {
  portfolio_id: string
  holdings_source: HoldingsSource
  /** True when the portfolio is in pilot mode and L1 is structurally empty. */
  is_pilot: boolean
  /** Snapshot id used for L0, or null if the portfolio has no snapshots yet. */
  snapshot_id: string | null
  snapshot_date: string | null
  /** L0 — raw positions from the latest snapshot. */
  live_positions: BaselinePosition[]
  /** L1 — pending unreconciled commitments. */
  pending_commitments: PendingCommitment[]
  /** L2 — merged pro-forma view, one row per asset touched by L0 ∪ L1. */
  pro_forma_positions: ProFormaPosition[]
  /** Convenience aggregate. */
  total_market_value: number | null
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function fetchPortfolioMode(portfolioId: string): Promise<HoldingsSource> {
  const { data, error } = await supabase
    .from('portfolios')
    .select('holdings_source')
    .eq('id', portfolioId)
    .single()
  if (error) throw error
  return (data?.holdings_source as HoldingsSource) || 'paper'
}

async function fetchLatestSnapshot(portfolioId: string): Promise<{
  id: string
  snapshot_date: string
  total_market_value: number | null
} | null> {
  const { data, error } = await supabase
    .from('portfolio_holdings_snapshots')
    .select('id, snapshot_date, total_market_value')
    .eq('portfolio_id', portfolioId)
    .order('snapshot_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data || null
}

async function fetchSnapshotPositions(snapshotId: string): Promise<BaselinePosition[]> {
  const { data, error } = await supabase
    .from('portfolio_holdings_positions')
    .select('asset_id, symbol, shares, price, market_value, weight_pct, sector')
    .eq('snapshot_id', snapshotId)
  if (error) throw error
  return (data || []).map(p => ({
    asset_id: p.asset_id,
    symbol: p.symbol,
    shares: Number(p.shares ?? 0),
    price: p.price != null ? Number(p.price) : null,
    market_value: p.market_value != null ? Number(p.market_value) : null,
    weight_pct: p.weight_pct != null ? Number(p.weight_pct) : null,
    sector: p.sector ?? null,
  }))
}

async function fetchPendingCommitments(portfolioId: string): Promise<PendingCommitment[]> {
  const { data, error } = await supabase
    .from('accepted_trades')
    .select(`
      id, asset_id, action, delta_weight, delta_shares, target_weight, target_shares,
      notional_value, last_activity_at, staleness_flagged_at, created_at,
      asset:assets(symbol)
    `)
    .eq('portfolio_id', portfolioId)
    .eq('reconciliation_status', 'pending')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data || []).map((r: any) => ({
    id: r.id,
    asset_id: r.asset_id,
    symbol: r.asset?.symbol ?? '?',
    action: r.action,
    delta_weight: r.delta_weight != null ? Number(r.delta_weight) : null,
    delta_shares: r.delta_shares != null ? Number(r.delta_shares) : null,
    target_weight: r.target_weight != null ? Number(r.target_weight) : null,
    target_shares: r.target_shares != null ? Number(r.target_shares) : null,
    notional_value: r.notional_value != null ? Number(r.notional_value) : null,
    last_activity_at: r.last_activity_at,
    staleness_flagged_at: r.staleness_flagged_at,
    created_at: r.created_at,
  }))
}

/**
 * Merge L0 + L1 into the L2 pro-forma view.
 *
 * Sizing precedence (per accepted_trade):
 *   1. If `target_shares` is set → use as absolute share count
 *   2. Else if `delta_shares` is set → apply as +/− to live shares
 *   3. Else if `target_weight` is set → no share math possible from weight
 *      alone; we still record the weight delta but leave share math at 0
 *   4. Else if `delta_weight` is set → same — weight-only delta
 *
 * Weight math mirrors share math when prices are known; otherwise we sum
 * weight deltas directly.
 */
function mergeBaselineLayers(
  live: BaselinePosition[],
  pending: PendingCommitment[],
): ProFormaPosition[] {
  const byAsset = new Map<string, ProFormaPosition>()

  // Seed from L0.
  for (const p of live) {
    byAsset.set(p.asset_id, {
      asset_id: p.asset_id,
      symbol: p.symbol,
      sector: p.sector,
      live_shares: p.shares,
      live_weight_pct: p.weight_pct,
      live_market_value: p.market_value,
      pro_forma_shares: p.shares,
      pro_forma_weight_pct: p.weight_pct,
      delta_shares: 0,
      delta_weight_pct: 0,
      pending_count: 0,
      pending_commitment_ids: [],
    })
  }

  // Apply L1.
  for (const c of pending) {
    let row = byAsset.get(c.asset_id)
    if (!row) {
      row = {
        asset_id: c.asset_id,
        symbol: c.symbol,
        sector: null,
        live_shares: 0,
        live_weight_pct: 0,
        live_market_value: 0,
        pro_forma_shares: 0,
        pro_forma_weight_pct: 0,
        delta_shares: 0,
        delta_weight_pct: 0,
        pending_count: 0,
        pending_commitment_ids: [],
      }
      byAsset.set(c.asset_id, row)
    }

    // Share math
    if (c.target_shares != null) {
      const ds = c.target_shares - row.pro_forma_shares
      row.pro_forma_shares = c.target_shares
      row.delta_shares += ds
    } else if (c.delta_shares != null) {
      row.pro_forma_shares += c.delta_shares
      row.delta_shares += c.delta_shares
    }

    // Weight math (independent of share math — accepted_trades may have
    // either, both, or just one). We sum signed weight deltas; absolute
    // targets overwrite the running pro-forma weight directly.
    if (c.target_weight != null) {
      const dw = c.target_weight - (row.pro_forma_weight_pct ?? 0)
      row.pro_forma_weight_pct = c.target_weight
      row.delta_weight_pct = (row.delta_weight_pct ?? 0) + dw
    } else if (c.delta_weight != null) {
      row.pro_forma_weight_pct = (row.pro_forma_weight_pct ?? 0) + c.delta_weight
      row.delta_weight_pct = (row.delta_weight_pct ?? 0) + c.delta_weight
    }

    row.pending_count += 1
    row.pending_commitment_ids.push(c.id)
  }

  return Array.from(byAsset.values())
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the full pro-forma baseline for a portfolio.
 *
 * In pilot mode (`holdings_source='paper'`), pending_commitments will be
 * empty by construction — Execute auto-reconciles in the same transaction.
 * Callers can rely on `is_pilot` to decide whether to render the
 * "Pro forma — N pending" badge or the simpler "Live holdings" badge.
 */
export async function getProFormaBaseline(portfolioId: string): Promise<ProFormaBaseline> {
  const [holdingsSource, snapshot] = await Promise.all([
    fetchPortfolioMode(portfolioId),
    fetchLatestSnapshot(portfolioId),
  ])

  // Both 'paper' and 'manual_eod' auto-reflect on accept (see
  // finalizeTradeForHoldingsSource in accepted-trade-service). Only
  // 'live_feed' accumulates a pending L1 layer.
  const isPilot = holdingsSource === 'paper' || holdingsSource === 'manual_eod'

  const [livePositions, pendingCommitments] = await Promise.all([
    snapshot ? fetchSnapshotPositions(snapshot.id) : Promise.resolve([] as BaselinePosition[]),
    fetchPendingCommitments(portfolioId),
  ])

  const proFormaPositions = mergeBaselineLayers(livePositions, pendingCommitments)

  return {
    portfolio_id: portfolioId,
    holdings_source: holdingsSource,
    is_pilot: isPilot,
    snapshot_id: snapshot?.id ?? null,
    snapshot_date: snapshot?.snapshot_date ?? null,
    live_positions: livePositions,
    pending_commitments: pendingCommitments,
    pro_forma_positions: proFormaPositions,
    total_market_value: snapshot?.total_market_value != null
      ? Number(snapshot.total_market_value)
      : null,
  }
}

/**
 * Convenience: just the L1 pending commitments. Used by the Trade Lab
 * "Committed today" left-panel section to render rows without computing the
 * full L2 merge.
 */
export async function getPendingCommitments(portfolioId: string): Promise<PendingCommitment[]> {
  return fetchPendingCommitments(portfolioId)
}

/**
 * Convenience: just the L0 → L2 merged positions, no L1 array. Used by the
 * Holdings Simulation Table when it only needs the baseline values.
 */
export async function getProFormaPositions(portfolioId: string): Promise<ProFormaPosition[]> {
  const baseline = await getProFormaBaseline(portfolioId)
  return baseline.pro_forma_positions
}

/**
 * Quick check used by the Trade Lab header badge. Returns the count of
 * pending L1 rows without fetching positions.
 */
export async function getPendingCommitmentCount(portfolioId: string): Promise<number> {
  const { count, error } = await supabase
    .from('accepted_trades')
    .select('id', { count: 'exact', head: true })
    .eq('portfolio_id', portfolioId)
    .eq('reconciliation_status', 'pending')
    .eq('is_active', true)
  if (error) throw error
  return count ?? 0
}
