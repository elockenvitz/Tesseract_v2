/**
 * usePositionLifecycle
 *
 * Chains all decisions + trade events for an (asset, portfolio) pair
 * into a position lifecycle timeline.
 *
 * A position is the continuous story of holding an asset in a portfolio:
 *   Entry (buy) → Adds → Trims → Exit (sell all)
 *
 * Computes:
 * - Timeline of events (decisions + executions) in chronological order
 * - Entry price (weighted average from buys/adds)
 * - Realized P&L (from trims/sells)
 * - Unrealized P&L (remaining position at current price)
 * - Blended return
 * - Position size over time
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { chartDataService } from '../lib/chartData'
import { differenceInDays, parseISO } from 'date-fns'

// ─── Types ────────────────────────────────────────────────────

export interface PositionEvent {
  id: string
  date: string
  type: 'decision' | 'execution'
  action: string // buy, sell, add, trim
  /** Price at the time of this event */
  price: number | null
  /** Share delta (positive for buys/adds, negative for sells/trims) */
  sharesDelta: number | null
  /** Cumulative shares after this event */
  sharesAfter: number | null
  /** Source: decision_id or event_id */
  sourceId: string
  sourceType: 'trade_queue_item' | 'portfolio_trade_event'
  /** For decisions: the stage */
  stage?: string
  /** For executions: match method */
  matchMethod?: string
  /** Who made the decision or execution */
  userName: string | null
}

export interface PositionLifecycle {
  assetId: string
  assetSymbol: string
  assetName: string | null
  portfolioId: string
  portfolioName: string | null
  /** All events in chronological order */
  timeline: PositionEvent[]
  /** Weighted average entry price across all buys/adds */
  avgEntryPrice: number | null
  /** Current market price */
  currentPrice: number | null
  /** Days since first entry */
  holdingDays: number | null
  /** Is the position still open? */
  isOpen: boolean
  /** Current shares held (0 if fully closed) */
  currentShares: number
  // ── P&L ──
  /** Realized P&L from trims/exits (dollar amount) */
  realizedPnl: number | null
  /** Unrealized P&L on remaining position */
  unrealizedPnl: number | null
  /** Total P&L (realized + unrealized) */
  totalPnl: number | null
  /** Total return % (total P&L / total cost basis) */
  totalReturnPct: number | null
  /** Annualized return % */
  annualizedReturnPct: number | null
  // ── Decision-level scores ──
  /** Each decision scored independently */
  decisionScores: DecisionScore[]
}

export interface DecisionScore {
  decisionId: string
  action: string
  decisionDate: string
  decisionPrice: number | null
  currentPrice: number | null
  /** Price move since this specific decision (directional) */
  movePct: number | null
  /** Was the direction right? */
  correct: boolean | null
  /** Days since decision */
  daysSince: number
}

// ─── Price history for chart ──────────────────────────────────

export interface PricePoint {
  date: string
  close: number
}

export function usePositionPriceHistory(symbol: string | null) {
  return useQuery({
    queryKey: ['position-price-history', symbol],
    queryFn: async (): Promise<PricePoint[]> => {
      if (!symbol) return []

      // Try DB cache first
      const { data, error } = await supabase
        .from('price_history_cache')
        .select('date, close')
        .eq('symbol', symbol)
        .order('date', { ascending: true })

      if (!error && data && data.length > 0) {
        return data.map(d => ({
          date: d.date,
          close: Number(d.close),
        }))
      }

      // Fallback: fetch from Yahoo Finance via chartDataService
      const candles = await chartDataService.getChartData({
        symbol,
        interval: '1d',
        range: '2y',
      })

      return candles
        .filter(c => c.close > 0)
        .map(c => ({
          date: typeof c.time === 'string' ? c.time : new Date(Number(c.time) * 1000).toISOString().slice(0, 10),
          close: c.close,
        }))
    },
    enabled: !!symbol,
    staleTime: 5 * 60 * 1000,
  })
}

// ─── Holdings time series for chart overlay ───────────────────

export interface HoldingsTimePoint {
  date: string
  shares: number
  marketValue: number | null
  weightPct: number | null
}

/**
 * Fetches daily holdings for a specific asset in a portfolio over time.
 * Used to overlay share count / weight on the price chart.
 */
export function useHoldingsTimeSeries(portfolioId: string | null, symbol: string | null) {
  return useQuery({
    queryKey: ['holdings-time-series', portfolioId, symbol],
    queryFn: async (): Promise<HoldingsTimePoint[]> => {
      if (!portfolioId || !symbol) return []

      const { data, error } = await supabase
        .from('portfolio_holdings_positions')
        .select(`
          shares, market_value, weight_pct,
          snapshot:snapshot_id(snapshot_date)
        `)
        .eq('portfolio_id', portfolioId)
        .eq('symbol', symbol)
        .order('created_at', { ascending: true })

      if (error) throw error
      if (!data || data.length === 0) return []

      return data
        .filter((d: any) => d.snapshot?.snapshot_date)
        .map((d: any) => ({
          date: d.snapshot.snapshot_date,
          shares: Number(d.shares),
          marketValue: d.market_value != null ? Number(d.market_value) : null,
          weightPct: d.weight_pct != null ? Number(d.weight_pct) : null,
        }))
        .sort((a: HoldingsTimePoint, b: HoldingsTimePoint) => a.date.localeCompare(b.date))
    },
    enabled: !!portfolioId && !!symbol,
    staleTime: 5 * 60 * 1000,
  })
}

// ─── Main hook ────────────────────────────────────────────────

interface UsePositionLifecycleOptions {
  assetId: string | null
  portfolioId: string | null
}

export function usePositionLifecycle({ assetId, portfolioId }: UsePositionLifecycleOptions) {
  return useQuery({
    queryKey: ['position-lifecycle', assetId, portfolioId],
    queryFn: async (): Promise<PositionLifecycle | null> => {
      if (!assetId || !portfolioId) return null

      // Parallel fetch: decisions, trade events, asset info, decision snapshots
      const [decisionsRes, eventsRes, assetRes, snapshotsRes] = await Promise.all([
        // All approved/executed decisions for this asset+portfolio
        supabase
          .from('trade_queue_items')
          .select(`
            id, created_at, approved_at, action, status,
            visibility_tier, deleted_at,
            proposed_shares, proposed_weight,
            created_by_user:created_by(first_name, last_name)
          `)
          .eq('asset_id', assetId)
          .eq('portfolio_id', portfolioId)
          .in('status', ['approved', 'executed', 'rejected', 'cancelled'])
          .order('approved_at', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: true }),

        // All trade events for this asset+portfolio
        supabase
          .from('portfolio_trade_events')
          .select(`
            id, event_date, action_type, source_type,
            quantity_delta, quantity_before, quantity_after,
            market_value_before, market_value_after,
            linked_trade_idea_id,
            created_by_user:created_by(first_name, last_name)
          `)
          .eq('asset_id', assetId)
          .eq('portfolio_id', portfolioId)
          .order('event_date', { ascending: true }),

        // Asset info
        supabase
          .from('assets')
          .select('id, symbol, company_name, current_price')
          .eq('id', assetId)
          .single(),

        // Decision price snapshots
        supabase
          .from('decision_price_snapshots')
          .select('trade_queue_item_id, snapshot_price, snapshot_at')
          .eq('asset_id', assetId)
          .eq('snapshot_type', 'approval'),
      ])

      const asset = assetRes.data
      if (!asset) return null

      const currentPrice = asset.current_price ? Number(asset.current_price) : null
      const symbol = asset.symbol || '?'
      const assetName = asset.company_name || null

      // Build snapshot price map
      const snapshotMap = new Map<string, number>()
      for (const s of snapshotsRes.data || []) {
        snapshotMap.set(s.trade_queue_item_id, Number(s.snapshot_price))
      }

      // Portfolio name
      const { data: portfolioData } = await supabase
        .from('portfolios')
        .select('name')
        .eq('id', portfolioId)
        .single()

      const portfolioName = portfolioData?.name || null

      // ── Build timeline ──
      const timeline: PositionEvent[] = []
      const decisionScores: DecisionScore[] = []

      const userName = (u: any) => u ? [u.first_name, u.last_name].filter(Boolean).join(' ') || null : null

      // Add decisions
      for (const d of decisionsRes.data || []) {
        let effectiveStage = d.status as string
        if (effectiveStage === 'executed') effectiveStage = 'approved'
        if (effectiveStage === 'approved' && (d.visibility_tier === 'archive' || d.visibility_tier === 'trash' || d.deleted_at)) {
          effectiveStage = 'cancelled'
        }

        const price = snapshotMap.get(d.id) || null
        const eventDate = d.approved_at || d.created_at

        timeline.push({
          id: `dec-${d.id}`,
          date: eventDate,
          type: 'decision',
          action: d.action || 'unknown',
          price,
          sharesDelta: d.proposed_shares ? Number(d.proposed_shares) : null,
          sharesAfter: null, // computed below from executions
          sourceId: d.id,
          sourceType: 'trade_queue_item',
          stage: effectiveStage,
          userName: userName(d.created_by_user),
        })

        // Decision-level scoring (only for approved decisions)
        if (effectiveStage === 'approved' && price != null) {
          const daysSince = differenceInDays(new Date(), parseISO(eventDate))
          const isBullish = d.action === 'buy' || d.action === 'add'
          let movePct: number | null = null
          let correct: boolean | null = null

          if (currentPrice != null) {
            const rawMove = (currentPrice - price) / price * 100
            movePct = isBullish ? rawMove : -rawMove
            correct = movePct > 0
          }

          decisionScores.push({
            decisionId: d.id,
            action: d.action,
            decisionDate: eventDate,
            decisionPrice: price,
            currentPrice,
            movePct,
            correct,
            daysSince,
          })
        }
      }

      // Add executions
      for (const e of eventsRes.data || []) {
        const execPrice = deriveExecPrice(e)

        timeline.push({
          id: `exec-${e.id}`,
          date: e.event_date,
          type: 'execution',
          action: e.action_type,
          price: execPrice,
          sharesDelta: e.quantity_delta ? Number(e.quantity_delta) : null,
          sharesAfter: e.quantity_after ? Number(e.quantity_after) : null,
          sourceId: e.id,
          sourceType: 'portfolio_trade_event',
          matchMethod: e.linked_trade_idea_id ? 'linked' : 'standalone',
          userName: userName(e.created_by_user),
        })
      }

      // Sort by date
      timeline.sort((a, b) => a.date.localeCompare(b.date))

      // ── Compute position metrics from executions ──
      let totalSharesBought = 0
      let totalCostBasis = 0
      let totalSharesSold = 0
      let totalSaleProceeds = 0
      let currentShares = 0

      for (const evt of timeline) {
        if (evt.type !== 'execution') continue

        const delta = evt.sharesDelta || 0
        const price = evt.price || 0

        if (delta > 0) {
          // Buy/add
          totalSharesBought += delta
          totalCostBasis += delta * price
          currentShares += delta
        } else if (delta < 0) {
          // Sell/trim
          const soldShares = Math.abs(delta)
          totalSharesSold += soldShares
          totalSaleProceeds += soldShares * price
          currentShares += delta // negative
        }

        // Also use sharesAfter if available (more reliable)
        if (evt.sharesAfter != null) {
          currentShares = evt.sharesAfter
        }
      }

      currentShares = Math.max(0, currentShares)
      const isOpen = currentShares > 0
      const avgEntryPrice = totalSharesBought > 0 ? totalCostBasis / totalSharesBought : null

      // Realized P&L: sale proceeds - cost basis of sold shares
      const avgCostPerShare = totalSharesBought > 0 ? totalCostBasis / totalSharesBought : 0
      const realizedPnl = totalSharesSold > 0 ? totalSaleProceeds - (totalSharesSold * avgCostPerShare) : null

      // Unrealized P&L on remaining
      const unrealizedPnl = currentShares > 0 && currentPrice != null && avgEntryPrice != null
        ? currentShares * (currentPrice - avgEntryPrice)
        : null

      const totalPnl = (realizedPnl || 0) + (unrealizedPnl || 0)
      const totalCost = totalCostBasis > 0 ? totalCostBasis : null
      const totalReturnPct = totalCost != null && totalCost > 0
        ? (totalPnl / totalCost) * 100
        : null

      // Holding days
      const firstEntry = timeline.find(e => e.type === 'execution' && (e.sharesDelta || 0) > 0)
      const holdingDays = firstEntry ? differenceInDays(new Date(), parseISO(firstEntry.date)) : null

      // Annualized return
      const annualizedReturnPct = totalReturnPct != null && holdingDays != null && holdingDays > 0
        ? (Math.pow(1 + totalReturnPct / 100, 365 / holdingDays) - 1) * 100
        : null

      return {
        assetId,
        assetSymbol: symbol,
        assetName,
        portfolioId,
        portfolioName,
        timeline,
        avgEntryPrice,
        currentPrice,
        holdingDays,
        isOpen,
        currentShares,
        realizedPnl,
        unrealizedPnl,
        totalPnl,
        totalReturnPct,
        annualizedReturnPct,
        decisionScores,
      }
    },
    enabled: !!assetId && !!portfolioId,
    staleTime: 2 * 60 * 1000,
  })
}

// ─── Helpers ──────────────────────────────────────────────────

function deriveExecPrice(evt: any): number | null {
  const mvBefore = evt.market_value_before != null ? Number(evt.market_value_before) : null
  const mvAfter = evt.market_value_after != null ? Number(evt.market_value_after) : null
  const qtyBefore = evt.quantity_before != null ? Number(evt.quantity_before) : null
  const qtyAfter = evt.quantity_after != null ? Number(evt.quantity_after) : null
  const qtyDelta = evt.quantity_delta != null ? Number(evt.quantity_delta) : null

  // Best: derive from market value change / quantity change
  if (mvBefore != null && mvAfter != null && qtyDelta != null && qtyDelta !== 0) {
    return Math.abs((mvAfter - mvBefore) / qtyDelta)
  }

  // Fallback: market value / quantity at a point in time
  if (mvAfter != null && qtyAfter != null && qtyAfter > 0) {
    return mvAfter / qtyAfter
  }
  if (mvBefore != null && qtyBefore != null && qtyBefore > 0) {
    return mvBefore / qtyBefore
  }

  return null
}
