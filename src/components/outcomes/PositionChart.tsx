/**
 * PositionChart
 *
 * Price line chart with decision badge overlays and optional holdings area.
 *
 * Features:
 * - Stock price line over time
 * - Entry price reference line (dashed)
 * - Decision markers: buy (green ▲), sell (red ▼), add (green +), trim (red −)
 * - Execution markers: smaller dots on the price line
 * - Holdings overlay: shares area on secondary Y axis (when data available)
 * - Hover tooltips with decision details + position size
 */

import { useMemo, useState } from 'react'
import {
  ComposedChart, Line, Area, XAxis, YAxis, Tooltip, ReferenceLine,
  ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { format, parseISO } from 'date-fns'
import type { PositionLifecycle, PositionEvent, PricePoint, HoldingsTimePoint } from '../../hooks/usePositionLifecycle'

export type OverlayField = 'shares' | 'weight' | 'active_weight'

/** Benchmark weight for this asset, expressed as a percentage of the
 *  portfolio. Missing / null is treated as 0 when computing active
 *  weight — positions in the portfolio that aren't in the benchmark
 *  have an active weight equal to their full portfolio weight. */
interface PositionChartProps {
  lifecycle: PositionLifecycle
  priceHistory: PricePoint[]
  holdingsHistory?: HoldingsTimePoint[]
  overlayField?: OverlayField
  /** Per-asset benchmark weight (percent). Used for the active-weight
   *  overlay: active = portfolio_weight − benchmark_weight. Pass null or
   *  undefined when the asset has no benchmark entry; the chart treats
   *  that as 0 (off-benchmark exposure). */
  benchmarkWeightPct?: number | null
  /** Called when the user clicks an annotation marker on the chart —
   *  the PM wants to isolate that specific historical trade in the
   *  Decisions list. */
  onSelectEvent?: (sourceId: string, sourceType: 'trade_queue_item' | 'portfolio_trade_event') => void
  /** Asset symbol used in the marker tooltip ("Decision: Add AAPL")
   *  so the chart immediately reads as a decision point in context.
   *  Optional — if omitted the tooltip falls back to action only. */
  symbol?: string | null
  height?: number
  className?: string
}

const OVERLAY_CONFIG: Record<OverlayField, { dataKey: string; label: string; color: string; formatter: (v: number) => string }> = {
  shares:        { dataKey: 'shares',     label: 'Shares',      color: '#8b5cf6', formatter: (v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : `${v}` },
  weight:        { dataKey: 'weightPct',  label: 'Weight %',    color: '#6366f1', formatter: (v) => `${v.toFixed(1)}%` },
  active_weight: { dataKey: 'activeWt',   label: 'Active Wt %', color: '#ec4899', formatter: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` },
}

const ACTION_CONFIG: Record<string, { color: string; symbol: string; label: string }> = {
  buy:       { color: '#22c55e', symbol: '▲', label: 'Buy' },
  add:       { color: '#22c55e', symbol: '+', label: 'Add' },
  sell:      { color: '#ef4444', symbol: '▼', label: 'Sell' },
  trim:      { color: '#ef4444', symbol: '−', label: 'Trim' },
  initiate:  { color: '#22c55e', symbol: '▲', label: 'Initiate' },
  exit:      { color: '#ef4444', symbol: '▼', label: 'Exit' },
  reduce:    { color: '#f59e0b', symbol: '−', label: 'Reduce' },
  increase:  { color: '#3b82f6', symbol: '+', label: 'Increase' },
}

function getActionConfig(action: string) {
  return ACTION_CONFIG[action] || { color: '#6b7280', symbol: '●', label: action }
}

export function PositionChart({ lifecycle, priceHistory, holdingsHistory, overlayField = 'shares', benchmarkWeightPct, onSelectEvent, symbol, height = 220, className }: PositionChartProps) {
  const hasHoldings = holdingsHistory && holdingsHistory.length > 0
  const overlayCfg = hasHoldings ? OVERLAY_CONFIG[overlayField] : null

  // Track which marker the cursor is currently over so DecisionDot
  // can paint a highlighted ring while the rest stay quiet. Keyed by
  // the source event id so the highlight survives Recharts re-renders
  // (cx/cy change on resize).
  const [hoveredMarkerId, setHoveredMarkerId] = useState<string | null>(null)

  // Merge price history with events and holdings
  const chartData = useMemo(() => {
    if (priceHistory.length === 0) return []

    // Build event map by date
    const eventsByDate = new Map<string, PositionEvent[]>()
    for (const evt of lifecycle.timeline) {
      const dateKey = evt.date.slice(0, 10)
      const list = eventsByDate.get(dateKey) || []
      list.push(evt)
      eventsByDate.set(dateKey, list)
    }

    // Build holdings map by date
    const holdingsByDate = new Map<string, HoldingsTimePoint>()
    if (holdingsHistory) {
      for (const h of holdingsHistory) {
        holdingsByDate.set(h.date, h)
      }
    }

    // Track last-known shares AND weight for step interpolation. Holdings
    // snapshots aren't taken every day, so without carry-forward the
    // shares/weight/active-weight overlays go blank on any day without a
    // snapshot — makes the line look broken. Forward-fill until the next
    // known snapshot overrides it.
    let lastShares: number | null = null
    let lastWeightPct: number | null = null
    // Missing benchmark weight is treated as 0 — an asset outside the
    // benchmark has an active weight equal to its portfolio weight.
    const benchWt = benchmarkWeightPct != null && Number.isFinite(benchmarkWeightPct)
      ? benchmarkWeightPct
      : 0

    return priceHistory.map(p => {
      const events = eventsByDate.get(p.date) || []
      const decisions = events.filter(e => e.type === 'decision' && e.stage === 'approved')
      const executions = events.filter(e => e.type === 'execution')

      // Holdings: use exact match or carry forward last known
      const holding = holdingsByDate.get(p.date)
      if (holding) {
        lastShares = holding.shares
        if (holding.weightPct != null) lastWeightPct = holding.weightPct
      }
      const shares = holding?.shares ?? lastShares
      const weightPct = holding?.weightPct ?? lastWeightPct
      // Active weight = portfolio weight − benchmark weight. Null only
      // when we have no portfolio weight yet (pre-entry).
      const activeWt = weightPct != null ? weightPct - benchWt : null

      // Source id for click-to-isolate. Prefer decisions since those
      // are what the Decisions list keys on (trade_queue_item_id).
      const selectableEvent = decisions[0] || executions[0] || null

      return {
        date: p.date,
        price: p.close,
        shares: shares,
        weightPct: weightPct,
        activeWt: activeWt,
        decisionAction: decisions[0]?.action || null,
        decisionPrice: decisions[0]?.price || null,
        decisionUser: decisions[0]?.userName || null,
        execAction: executions[0]?.action || null,
        execPrice: executions[0]?.price || null,
        execShares: executions[0]?.sharesDelta || null,
        eventSourceId: selectableEvent?.sourceId ?? null,
        eventSourceType: selectableEvent?.sourceType ?? null,
        events,
      }
    })
  }, [priceHistory, lifecycle.timeline, holdingsHistory, benchmarkWeightPct])

  if (chartData.length === 0) {
    return (
      <div className={`flex items-center justify-center text-[11px] text-gray-400 ${className || ''}`} style={{ height }}>
        No price history available
      </div>
    )
  }

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={chartData} margin={{ top: 8, right: hasHoldings ? 48 : 8, bottom: 4, left: 0 }}>
          {/* SVG defs — drop-shadow filter used by the floating
              decision-marker label so it lifts off the chart. */}
          <defs>
            <filter id="decisionTooltipShadow" x="-10%" y="-10%" width="120%" height="120%">
              <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor="#000" floodOpacity="0.12" />
            </filter>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />

          <XAxis
            dataKey="date"
            tick={{ fontSize: 9, fill: '#9ca3af' }}
            tickFormatter={(d: string) => format(parseISO(d), 'MMM yy')}
            interval="preserveStartEnd"
            minTickGap={40}
          />

          {/* Left Y axis: Price */}
          <YAxis
            yAxisId="price"
            tick={{ fontSize: 9, fill: '#9ca3af' }}
            tickFormatter={(v: number) => `$${v.toFixed(0)}`}
            domain={['auto', 'auto']}
            width={48}
          />

          {/* Right Y axis: overlay field (only when holdings data exists) */}
          {hasHoldings && overlayCfg && (
            <YAxis
              yAxisId="overlay"
              orientation="right"
              tick={{ fontSize: 9, fill: overlayCfg.color }}
              tickFormatter={overlayCfg.formatter}
              domain={overlayField === 'active_weight' ? ['auto', 'auto'] : [0, 'auto']}
              width={44}
            />
          )}

          <Tooltip content={<ChartTooltip hasHoldings={!!hasHoldings} overlayField={overlayField} symbol={symbol} />} />

          {/* Entry price reference line */}
          {lifecycle.avgEntryPrice != null && (
            <ReferenceLine
              yAxisId="price"
              y={lifecycle.avgEntryPrice}
              stroke="#6366f1"
              strokeDasharray="4 4"
              strokeWidth={1}
              label={{
                value: `Entry $${lifecycle.avgEntryPrice.toFixed(2)}`,
                position: 'insideTopRight',
                fill: '#6366f1',
                fontSize: 9,
              }}
            />
          )}

          {/* Holdings overlay area (behind price line) */}
          {hasHoldings && overlayCfg && (
            <Area
              yAxisId="overlay"
              type="stepAfter"
              dataKey={overlayCfg.dataKey}
              fill={overlayCfg.color}
              fillOpacity={0.08}
              stroke={overlayCfg.color}
              strokeWidth={1}
              strokeOpacity={0.3}
              isAnimationActive={false}
            />
          )}

          {/* Price line */}
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="price"
            stroke="#3b82f6"
            strokeWidth={1.5}
            dot={<DecisionDot
              onSelectEvent={onSelectEvent}
              hoveredMarkerId={hoveredMarkerId}
              onMarkerHover={setHoveredMarkerId}
              symbol={symbol}
            />}
            activeDot={{ r: 4, fill: '#3b82f6' }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-1 px-2">
        <div className="flex items-center gap-1.5 text-[9px] text-gray-400">
          <span className="w-4 h-0.5 bg-blue-500 inline-block" /> Price
        </div>
        {hasHoldings && overlayCfg && (
          <div className="flex items-center gap-1.5 text-[9px] text-gray-400">
            <span className="w-4 h-2 inline-block rounded-sm" style={{ backgroundColor: `${overlayCfg.color}15`, border: `1px solid ${overlayCfg.color}40` }} /> {overlayCfg.label}
          </div>
        )}
        {lifecycle.avgEntryPrice != null && (
          <div className="flex items-center gap-1.5 text-[9px] text-gray-400">
            <span className="w-4 h-0 border-t border-dashed border-indigo-500 inline-block" /> Avg Entry
          </div>
        )}
        <div className="flex items-center gap-1.5 text-[9px] text-gray-400">
          <span className="text-green-500 font-bold">▲</span> Buy/Add
        </div>
        <div className="flex items-center gap-1.5 text-[9px] text-gray-400">
          <span className="text-red-500 font-bold">▼</span> Sell/Trim
        </div>
      </div>
    </div>
  )
}

// ── Custom dot that shows decision / execution markers ──
//
//  Markers live *off* the price line (above for bullish, below for
//  bearish) so they don't obscure price movement near the event.
//  A short connector line (not full crosshair) visually links the
//  marker to its price point — subtle enough to not compete with the
//  price line. A transparent hit target around the marker makes it
//  easy to hover/click, and clicking fires `onSelectEvent` so the
//  parent can isolate that trade in the decision list.

function DecisionDot(props: any) {
  const { cx, cy, payload, onSelectEvent, hoveredMarkerId, onMarkerHover, symbol } = props
  if (!payload) return null

  const hasDecision = payload.decisionAction
  const hasExec = payload.execAction && !hasDecision

  if (!hasDecision && !hasExec) return null

  const action = hasDecision ? payload.decisionAction : payload.execAction
  const cfg = getActionConfig(action)
  const isBullish = action === 'buy' || action === 'add' || action === 'initiate' || action === 'increase'

  // Compact marker — small enough to sit clear of the price line
  // without obscuring it, generous-enough hit target so the cursor
  // doesn't have to land precisely. The visible decision dot is
  // radius 7; the invisible hit zone extends to radius 13.
  const offset = hasDecision ? 16 : 12
  const markerY = isBullish ? cy - offset : cy + offset
  const markerRadius = hasDecision ? 7 : 5
  const hitRadius = markerRadius + 6

  const eventId = payload.eventSourceId as string | null
  const isHovered = !!eventId && hoveredMarkerId === eventId

  const canSelect = !!onSelectEvent && !!eventId
  const handleClick = () => {
    if (!canSelect) return
    onSelectEvent(eventId, payload.eventSourceType)
  }
  const handleEnter = () => {
    if (eventId && onMarkerHover) onMarkerHover(eventId)
  }
  const handleLeave = () => {
    if (onMarkerHover) onMarkerHover(null)
  }

  // ── Floating label that appears on hover ───────────────────────
  // Positioned above the marker for bullish actions, below for
  // bearish — opposite the marker's own offset so the label always
  // points back to the price line. Width is computed from the
  // string so the rect sizes itself; rendered in SVG (no
  // foreignObject) so it lives inside the chart's clipping region
  // and never escapes the panel.
  const kind = hasDecision ? 'Decision' : 'Execution'
  const labelText = `${kind}: ${cfg.label}${symbol ? ` ${symbol}` : ''}`
  const subText = (() => {
    const parts: string[] = []
    const price = hasDecision ? payload.decisionPrice : payload.execPrice
    if (price != null) parts.push(`$${Number(price).toFixed(2)}`)
    if (payload.date) {
      try { parts.push(format(parseISO(payload.date), 'MMM d, yyyy')) } catch { /* ignore */ }
    }
    if (hasDecision && payload.decisionUser) parts.push(`by ${payload.decisionUser}`)
    if (!hasDecision && payload.execShares != null) {
      const sd = Number(payload.execShares)
      parts.push(`${sd > 0 ? '+' : ''}${sd.toLocaleString()} shs`)
    }
    return parts.join(' · ')
  })()
  // Approximate text widths — SVG <text> is the source of truth, but
  // we need a width to size the background rect. 6.6px/char for the
  // 11px headline; 5.4px/char for the 9px subline. Caps at 240px.
  const labelWidth = Math.min(240, Math.max(labelText.length * 6.6, subText.length * 5.4) + 16)
  const labelHeight = subText ? 30 : 18
  const labelY = isBullish
    ? markerY - markerRadius - 8 - labelHeight
    : markerY + markerRadius + 8

  return (
    <g
      style={canSelect ? { cursor: 'pointer' } : undefined}
      onClick={handleClick}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {/* Connector — short segment from price line toward the marker. */}
      <line
        x1={cx}
        y1={isBullish ? cy - 3 : cy + 3}
        x2={cx}
        y2={isBullish ? markerY + markerRadius : markerY - markerRadius}
        stroke={cfg.color}
        strokeWidth={1}
        strokeDasharray="2 2"
        opacity={isHovered ? 0.9 : 0.45}
        pointerEvents="none"
      />

      {/* Hover ring — soft halo around the marker when the cursor is
          on its hit zone. Helps the user know the dot is interactive
          before they click. */}
      {isHovered && (
        <circle
          cx={cx}
          cy={markerY}
          r={markerRadius + 4}
          fill={cfg.color}
          opacity={0.18}
          pointerEvents="none"
        />
      )}

      {/* Primary marker */}
      {hasDecision && (
        <>
          <circle
            cx={cx}
            cy={markerY}
            r={markerRadius}
            fill="white"
            stroke={cfg.color}
            strokeWidth={isHovered ? 2.5 : 1.75}
          />
          <text
            x={cx}
            y={markerY + 3}
            textAnchor="middle"
            fill={cfg.color}
            fontSize={9}
            fontWeight="bold"
            pointerEvents="none"
          >
            {cfg.symbol}
          </text>
        </>
      )}

      {hasExec && (
        <circle
          cx={cx}
          cy={markerY}
          r={markerRadius}
          fill={cfg.color}
          stroke="white"
          strokeWidth={isHovered ? 2 : 1.5}
        />
      )}

      {/* Floating label — appears on hover, points back at the
          marker via the connector. Positioned opposite the marker's
          own offset (above for bullish, below for bearish). */}
      {isHovered && (
        <g pointerEvents="none">
          <rect
            x={cx - labelWidth / 2}
            y={labelY}
            width={labelWidth}
            height={labelHeight}
            rx={4}
            ry={4}
            fill="white"
            stroke={cfg.color}
            strokeWidth={1}
            filter="url(#decisionTooltipShadow)"
          />
          <text
            x={cx}
            y={labelY + 12}
            textAnchor="middle"
            fontSize={11}
            fontWeight={600}
            fill="#111827"
          >
            {labelText}
          </text>
          {subText && (
            <text
              x={cx}
              y={labelY + 24}
              textAnchor="middle"
              fontSize={9}
              fill="#6b7280"
            >
              {subText}
            </text>
          )}
        </g>
      )}

      {/* Generous hit target — bigger than the visible marker so the
          cursor doesn't have to land precisely. */}
      <circle
        cx={cx}
        cy={markerY}
        r={hitRadius}
        fill="transparent"
        stroke="transparent"
      />
    </g>
  )
}

// ── Tooltip ──

function ChartTooltip({ active, payload, hasHoldings, overlayField }: any) {
  if (!active || !payload || payload.length === 0) return null

  const data = payload[0]?.payload
  if (!data) return null

  // Suppress the Recharts tooltip when the user is over a decision /
  // execution marker — the marker has its own SVG floating label with
  // richer info. Without this, hovering the marker fires both popups
  // and they overlap.
  if (data.decisionAction || data.execAction) return null

  const cfg = overlayField ? OVERLAY_CONFIG[overlayField as OverlayField] : null

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-2 max-w-60">
      <div className="flex items-center justify-between gap-4">
        <span className="text-[10px] text-gray-500">{format(parseISO(data.date), 'MMM d, yyyy')}</span>
        <span className="text-[11px] font-semibold text-gray-900 tabular-nums">${data.price?.toFixed(2)}</span>
      </div>
      {hasHoldings && cfg && data[cfg.dataKey] != null && (
        <div className="text-[10px] mt-1" style={{ color: cfg.color }}>
          {cfg.label}: <span className="font-semibold">{cfg.formatter(data[cfg.dataKey])}</span>
          {overlayField === 'shares' && data.weightPct != null && (
            <span className="text-gray-400 ml-2">{data.weightPct.toFixed(2)}% wt</span>
          )}
          {overlayField === 'weight' && data.shares != null && data.shares > 0 && (
            <span className="text-gray-400 ml-2">{data.shares.toLocaleString()} shs</span>
          )}
        </div>
      )}
    </div>
  )
}
