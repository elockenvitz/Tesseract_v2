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

      // Fallback: fetch from Yahoo Finance. Trimmed to 1y because the
      // Outcomes chart only goes ~180 days back and the longer range
      // adds proportional payload + parse time. Anything beyond a year
      // would be padded with forward-fills anyway.
      const candles = await chartDataService.getChartData({
        symbol,
        interval: '1d',
        range: '1y',
      })

      const points = candles
        .filter(c => c.close > 0)
        .map(c => ({
          date: typeof c.time === 'string' ? c.time : new Date(Number(c.time) * 1000).toISOString().slice(0, 10),
          close: c.close,
        }))

      // Write the results back to price_history_cache so the next
      // load (and useHoldingsTimeSeries, which reads the same cache
      // for its weight overlay) hit the DB instead of round-tripping
      // to Yahoo. Fire-and-forget — we already have the data we need
      // for this render.
      if (points.length > 0) {
        void supabase
          .from('price_history_cache')
          .upsert(
            points.map(p => ({
              symbol,
              date: p.date,
              close: p.close,
              source: 'yahoo_finance',
            })),
            { onConflict: 'symbol,date' },
          )
          .then(({ error: upErr }) => {
            if (upErr) console.warn('[priceHistory] failed to cache Yahoo result:', upErr.message)
          })
      }

      return points
    },
    enabled: !!symbol,
    staleTime: 15 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
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
export function useHoldingsTimeSeries(
  portfolioId: string | null,
  symbol: string | null,
  assetId: string | null,
) {
  return useQuery({
    queryKey: ['holdings-time-series', portfolioId, symbol, assetId],
    queryFn: async (): Promise<HoldingsTimePoint[]> => {
      if (!portfolioId || !symbol || !assetId) return []

      // Fire all 4 reads in parallel — they're independent of each
      // other. Sequential awaits cost 4× the wire latency (~800ms) for
      // no reason.
      const [currentHoldingRowsRes, eventsRes, allHoldingsRes, priceRowsRes] = await Promise.all([
        supabase
          .from('portfolio_holdings')
          .select('shares, price, date')
          .eq('portfolio_id', portfolioId)
          .eq('asset_id', assetId)
          .order('date', { ascending: false })
          .limit(1),
        supabase
          .from('portfolio_trade_events')
          .select('event_date, quantity_delta')
          .eq('portfolio_id', portfolioId)
          .eq('asset_id', assetId)
          .order('event_date', { ascending: true }),
        supabase
          .from('portfolio_holdings')
          .select('shares, price')
          .eq('portfolio_id', portfolioId),
        supabase
          .from('price_history_cache')
          .select('date, close')
          .eq('symbol', symbol)
          .order('date', { ascending: true }),
      ])

      const currentHoldingRows = currentHoldingRowsRes.data
      const currentShares = currentHoldingRows?.[0]?.shares != null
        ? Number(currentHoldingRows[0].shares)
        : 0
      const currentPrice = currentHoldingRows?.[0]?.price != null
        ? Number(currentHoldingRows[0].price)
        : null

      const events = eventsRes.data
      const eventList = (events || []).filter(e => e.event_date)

      const allHoldings = allHoldingsRes.data
      const aum = (allHoldings || []).reduce(
        (sum, h) => sum + (Number(h.shares) || 0) * (Number(h.price) || 0),
        0,
      )

      const priceRows = priceRowsRes.data
      const priceByDate = new Map<string, number>()
      for (const p of priceRows || []) {
        priceByDate.set(String(p.date), Number(p.close))
      }
      // Forward-fill helper: pick the last close on or before `date`.
      const sortedPriceDates = (priceRows || []).map(p => String(p.date)).sort()
      const priceOnOrBefore = (date: string): number | null => {
        // Binary search for the largest priceDate <= date.
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

      // Helper to convert (shares, date) → HoldingsTimePoint with
      // price-aware market value + weight.
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

      // 5. No events → flat series at current shares for ~180 days back.
      //    Without a leading-edge point the chart only has "today" data
      //    and Recharts can't draw a line.
      const today = new Date().toISOString().slice(0, 10)
      const back180 = (() => {
        const d = new Date()
        d.setUTCDate(d.getUTCDate() - 180)
        return d.toISOString().slice(0, 10)
      })()

      if (eventList.length === 0) {
        return [
          buildPoint(back180, currentShares),
          buildPoint(today, currentShares),
        ]
      }

      // 6. Replay events in reverse to reconstruct shares at each
      //    boundary. `sharesAfterEvent[i]` is the position size
      //    immediately after event i fired; `sharesBeforeFirstEvent`
      //    is the position before the first event ever (typically 0
      //    for a position opened by a buy/initiate).
      const sharesAfterEvent: number[] = new Array(eventList.length)
      let running = currentShares
      for (let i = eventList.length - 1; i >= 0; i--) {
        sharesAfterEvent[i] = running
        running -= Number(eventList[i].quantity_delta) || 0
      }
      const sharesBeforeFirstEvent = running

      // 7. Build the time series:
      //    a) leading-edge point ~180 days before the first event
      //    b) one point per event date with post-event shares
      //    c) a "today" point with current shares so the chart anchors
      //       cleanly on the right edge
      const points: HoldingsTimePoint[] = []
      const firstEventDate = new Date(String(eventList[0].event_date))
      const leadEdge = new Date(firstEventDate)
      leadEdge.setUTCDate(leadEdge.getUTCDate() - 180)
      points.push(buildPoint(leadEdge.toISOString().slice(0, 10), sharesBeforeFirstEvent))

      // Collapse multiple events on the same day into a single point
      // (the latest sharesAfterEvent value for that date wins).
      const sharesByEventDate = new Map<string, number>()
      eventList.forEach((evt, i) => {
        sharesByEventDate.set(String(evt.event_date), sharesAfterEvent[i])
      })
      for (const [date, shares] of sharesByEventDate) {
        points.push(buildPoint(date, shares))
      }

      // Anchor today only if the latest event isn't already today —
      // duplicate dates make Recharts angry.
      const latestEventDate = String(eventList[eventList.length - 1].event_date)
      if (latestEventDate < today) {
        points.push(buildPoint(today, currentShares))
      }

      points.sort((a, b) => a.date.localeCompare(b.date))
      return points
    },
    enabled: !!portfolioId && !!symbol && !!assetId,
    staleTime: 15 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
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
