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

import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
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

// ─── Chart bundle (shared single round-trip) ─────────────────
//
// One RPC returning everything the Outcomes chart needs:
// price history + lifecycle source rows + holdings replay inputs.
// All three existing hooks (lifecycle/price/holdings) read from this
// bundle so the price line and shares overlay land together instead
// of sequentially. Yahoo fallback runs inside the queryFn on a cold
// cache so the bundle's priceHistory is always populated by the time
// React Query resolves.

interface ChartBundle {
  decisions: any[]
  events: any[]
  asset: { id: string; symbol: string; company_name: string | null; current_price: number | null } | null
  portfolio: { id: string; name: string | null } | null
  snapshots: { trade_queue_item_id: string; snapshot_price: number; snapshot_at: string }[]
  priceHistory: { date: string; close: number }[]
  currentHolding: { shares: number | null; price: number | null; date: string | null } | null
  portfolioAum: number
  holdingsEvents: { event_date: string; quantity_delta: number | null }[]
}

export function useChartBundle(
  assetId: string | null,
  portfolioId: string | null,
  symbol: string | null,
) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['position-chart-bundle', assetId, portfolioId, symbol],
    queryFn: async (): Promise<ChartBundle> => {
      const { data, error } = await supabase.rpc('position_chart_payload', {
        p_asset_id: assetId,
        p_portfolio_id: portfolioId,
        p_symbol: symbol,
      })
      if (error) throw error

      const bundle = (data || {}) as ChartBundle
      bundle.decisions = bundle.decisions || []
      bundle.events = bundle.events || []
      bundle.snapshots = bundle.snapshots || []
      bundle.priceHistory = bundle.priceHistory || []
      bundle.holdingsEvents = bundle.holdingsEvents || []
      bundle.portfolioAum = Number(bundle.portfolioAum || 0)
      return bundle
    },
    enabled: !!assetId && !!portfolioId,
    staleTime: 2 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: keepPreviousData,
    retry: 1,
  })

  // Cold-cache Yahoo fallback runs AS A SIDE EFFECT after the RPC
  // resolves — never on the critical path. Previously this was awaited
  // inside queryFn, blocking the entire bundle (decisions/events/
  // holdings/AUM) on a 1-3s outbound HTTPS call when price_history_cache
  // was empty. Now lifecycle markers and the shares overlay paint as
  // soon as the RPC returns; the price line streams in via setQueryData
  // when Yahoo answers.
  useEffect(() => {
    const bundle = query.data
    if (!bundle || !symbol) return
    if (bundle.priceHistory.length > 0) return
    let cancelled = false
    void (async () => {
      try {
        const candles = await chartDataService.getChartData({
          symbol,
          interval: '1d',
          range: '1y',
        })
        if (cancelled) return
        const points = candles
          .filter(c => c.close > 0)
          .map(c => ({
            date: typeof c.time === 'string' ? c.time : new Date(Number(c.time) * 1000).toISOString().slice(0, 10),
            close: c.close,
          }))
        if (points.length === 0) return
        queryClient.setQueryData<ChartBundle>(
          ['position-chart-bundle', assetId, portfolioId, symbol],
          (prev) => (prev ? { ...prev, priceHistory: points } : prev),
        )
        void supabase
          .from('price_history_cache')
          .upsert(
            points.map(p => ({ symbol, date: p.date, close: p.close, source: 'yahoo_finance' })),
            { onConflict: 'symbol,date' },
          )
          .then(({ error: upErr }) => {
            if (upErr) console.warn('[chartBundle] failed to cache Yahoo result:', upErr.message)
          })
      } catch (err) {
        console.warn('[chartBundle] Yahoo fallback failed:', err)
      }
    })()
    return () => { cancelled = true }
  }, [query.data, symbol, assetId, portfolioId, queryClient])

  return query
}

export function usePositionPriceHistory(
  symbol: string | null,
  assetId?: string | null,
  portfolioId?: string | null,
) {
  // Preferred path: bundle (warm cache hit + no extra round-trip).
  // Both assetId and portfolioId are needed for the bundle key.
  const bundleQ = useChartBundle(assetId ?? null, portfolioId ?? null, symbol)
  const fromBundle = useMemo<PricePoint[]>(
    () => (bundleQ.data?.priceHistory || []).map(p => ({ date: p.date, close: Number(p.close) })),
    [bundleQ.data],
  )

  // Standalone path for callers that don't have an asset/portfolio
  // context (none today, but the hook is exported). Skipped when the
  // bundle is in flight or has data.
  const standaloneEnabled = !!symbol && (!assetId || !portfolioId)
  const standaloneQ = useQuery({
    queryKey: ['position-price-history', symbol],
    queryFn: async (): Promise<PricePoint[]> => {
      if (!symbol) return []
      const { data, error } = await supabase
        .from('price_history_cache')
        .select('date, close')
        .eq('symbol', symbol)
        .order('date', { ascending: true })
      if (!error && data && data.length > 0) {
        return data.map(d => ({ date: d.date, close: Number(d.close) }))
      }
      const candles = await chartDataService.getChartData({ symbol, interval: '1d', range: '1y' })
      const points = candles
        .filter(c => c.close > 0)
        .map(c => ({
          date: typeof c.time === 'string' ? c.time : new Date(Number(c.time) * 1000).toISOString().slice(0, 10),
          close: c.close,
        }))
      if (points.length > 0) {
        void supabase
          .from('price_history_cache')
          .upsert(
            points.map(p => ({ symbol, date: p.date, close: p.close, source: 'yahoo_finance' })),
            { onConflict: 'symbol,date' },
          )
      }
      return points
    },
    enabled: standaloneEnabled,
    staleTime: 15 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  })

  if (standaloneEnabled) {
    return standaloneQ
  }
  return { ...bundleQ, data: fromBundle }
}

// ─── Holdings time series for chart overlay ───────────────────

export interface HoldingsTimePoint {
  date: string
  shares: number
  marketValue: number | null
  weightPct: number | null
}

/**
 * Synthesizes a daily holdings time series for a specific asset in a
 * portfolio. Drives the shares / weight / active-weight overlays on
 * the position chart.
 *
 * Strategy: replay portfolio_trade_events backwards from current
 * shares to reconstruct the share count at every event boundary, then
 * pad ~180 days of leading edge so the chart looks like the portfolio
 * has been running. This works even when no portfolio_holdings_positions
 * snapshots exist (typical for pilot orgs and freshly-created portfolios).
 *
 * Weight is computed at each point as `shares * price / current_aum`,
 * using the cached close price for that date (or carried-forward last
 * close). AUM is approximated as today's portfolio market value — for
 * portfolios with many other trades this drifts, but the visual story
 * of "what does THIS trade do to my exposure?" stays accurate because
 * the asset's own contribution moves correctly.
 */
// Pure: rebuild the daily holdings time series from already-fetched
// bundle data. Same algorithm as the prior queryFn (replay events
// backwards from current shares, leading-edge point, today anchor),
// just without the network calls.
export function buildHoldingsSeriesFromBundle(
  bundle: ChartBundle | null | undefined,
): HoldingsTimePoint[] {
  if (!bundle) return []

  const currentShares = bundle.currentHolding?.shares != null ? Number(bundle.currentHolding.shares) : 0
  const currentPrice = bundle.currentHolding?.price != null ? Number(bundle.currentHolding.price) : null
  const eventList = (bundle.holdingsEvents || []).filter(e => e.event_date)
  const aum = bundle.portfolioAum || 0

  const priceRows = bundle.priceHistory || []
  const priceByDate = new Map<string, number>()
  for (const p of priceRows) {
    priceByDate.set(String(p.date), Number(p.close))
  }
  const sortedPriceDates = priceRows.map(p => String(p.date)).sort()
  const priceOnOrBefore = (date: string): number | null => {
    let lo = 0
    let hi = sortedPriceDates.length - 1
    let best: string | null = null
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1
      if (sortedPriceDates[mid] <= date) {
        best = sortedPriceDates[mid]
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return best ? priceByDate.get(best) ?? null : null
  }

  const buildPoint = (date: string, shares: number): HoldingsTimePoint => {
    const price = priceOnOrBefore(date) ?? currentPrice ?? 0
    const marketValue = shares * price
    const weightPct = aum > 0 ? (marketValue / aum) * 100 : null
    return {
      date,
      shares,
      marketValue: price > 0 ? marketValue : null,
      weightPct,
    }
  }

  const today = new Date().toISOString().slice(0, 10)
  const back180 = (() => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - 180)
    return d.toISOString().slice(0, 10)
  })()

  if (eventList.length === 0) {
    return [buildPoint(back180, currentShares), buildPoint(today, currentShares)]
  }

  const sharesAfterEvent: number[] = new Array(eventList.length)
  let running = currentShares
  for (let i = eventList.length - 1; i >= 0; i--) {
    sharesAfterEvent[i] = running
    running -= Number(eventList[i].quantity_delta) || 0
  }
  const sharesBeforeFirstEvent = running

  const points: HoldingsTimePoint[] = []
  const firstEventDate = new Date(String(eventList[0].event_date))
  const leadEdge = new Date(firstEventDate)
  leadEdge.setUTCDate(leadEdge.getUTCDate() - 180)
  points.push(buildPoint(leadEdge.toISOString().slice(0, 10), sharesBeforeFirstEvent))

  const sharesByEventDate = new Map<string, number>()
  eventList.forEach((evt, i) => {
    sharesByEventDate.set(String(evt.event_date), sharesAfterEvent[i])
  })
  for (const [date, shares] of sharesByEventDate) {
    points.push(buildPoint(date, shares))
  }

  const latestEventDate = String(eventList[eventList.length - 1].event_date)
  if (latestEventDate < today) {
    points.push(buildPoint(today, currentShares))
  }

  points.sort((a, b) => a.date.localeCompare(b.date))
  return points
}

export function useHoldingsTimeSeries(
  portfolioId: string | null,
  symbol: string | null,
  assetId: string | null,
) {
  const bundleQ = useChartBundle(assetId, portfolioId, symbol)
  const data = useMemo(() => buildHoldingsSeriesFromBundle(bundleQ.data), [bundleQ.data])
  return { ...bundleQ, data }
}

// ─── Main hook ────────────────────────────────────────────────

interface UsePositionLifecycleOptions {
  assetId: string | null
  portfolioId: string | null
  /** Required to share the bundle round-trip with the chart panel.
   *  Without it, the bundle key wouldn't match the chart's, and we'd
   *  fire two separate RPCs for the same data. */
  symbol?: string | null
}

// Pure: build the lifecycle from bundle source rows. Same algorithm as
// the prior queryFn (timeline merge of decisions + executions, P&L
// rollup, decision-level scoring), just without the network calls.
export function buildLifecycleFromBundle(
  bundle: ChartBundle | null | undefined,
  assetId: string | null,
  portfolioId: string | null,
): PositionLifecycle | null {
  if (!bundle || !bundle.asset || !assetId || !portfolioId) return null

  const asset = bundle.asset
  const currentPrice = asset.current_price != null ? Number(asset.current_price) : null
  const symbol = asset.symbol || '?'
  const assetName = asset.company_name || null
  const portfolioName = bundle.portfolio?.name ?? null

  const snapshotMap = new Map<string, number>()
  for (const s of bundle.snapshots || []) {
    snapshotMap.set(s.trade_queue_item_id, Number(s.snapshot_price))
  }

  const timeline: PositionEvent[] = []
  const decisionScores: DecisionScore[] = []

  const userName = (u: any) => (u ? [u.first_name, u.last_name].filter(Boolean).join(' ') || null : null)

  for (const d of bundle.decisions || []) {
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
      sharesAfter: null,
      sourceId: d.id,
      sourceType: 'trade_queue_item',
      stage: effectiveStage,
      userName: userName(d.created_by_user),
    })

    if (effectiveStage === 'approved' && price != null) {
      const daysSince = differenceInDays(new Date(), parseISO(eventDate))
      const isBullish = d.action === 'buy' || d.action === 'add'
      let movePct: number | null = null
      let correct: boolean | null = null

      if (currentPrice != null) {
        const rawMove = ((currentPrice - price) / price) * 100
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

  for (const e of bundle.events || []) {
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

  timeline.sort((a, b) => a.date.localeCompare(b.date))

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
      totalSharesBought += delta
      totalCostBasis += delta * price
      currentShares += delta
    } else if (delta < 0) {
      const soldShares = Math.abs(delta)
      totalSharesSold += soldShares
      totalSaleProceeds += soldShares * price
      currentShares += delta
    }
    if (evt.sharesAfter != null) {
      currentShares = evt.sharesAfter
    }
  }

  currentShares = Math.max(0, currentShares)
  const isOpen = currentShares > 0
  const avgEntryPrice = totalSharesBought > 0 ? totalCostBasis / totalSharesBought : null

  const avgCostPerShare = totalSharesBought > 0 ? totalCostBasis / totalSharesBought : 0
  const realizedPnl = totalSharesSold > 0 ? totalSaleProceeds - totalSharesSold * avgCostPerShare : null

  const unrealizedPnl =
    currentShares > 0 && currentPrice != null && avgEntryPrice != null
      ? currentShares * (currentPrice - avgEntryPrice)
      : null

  const totalPnl = (realizedPnl || 0) + (unrealizedPnl || 0)
  const totalCost = totalCostBasis > 0 ? totalCostBasis : null
  const totalReturnPct = totalCost != null && totalCost > 0 ? (totalPnl / totalCost) * 100 : null

  const firstEntry = timeline.find(e => e.type === 'execution' && (e.sharesDelta || 0) > 0)
  const holdingDays = firstEntry ? differenceInDays(new Date(), parseISO(firstEntry.date)) : null

  const annualizedReturnPct =
    totalReturnPct != null && holdingDays != null && holdingDays > 0
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
}

export function usePositionLifecycle({ assetId, portfolioId, symbol }: UsePositionLifecycleOptions) {
  const bundleQ = useChartBundle(assetId, portfolioId, symbol ?? null)
  const data = useMemo(
    () => buildLifecycleFromBundle(bundleQ.data, assetId, portfolioId),
    [bundleQ.data, assetId, portfolioId],
  )
  return { ...bundleQ, data }
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
