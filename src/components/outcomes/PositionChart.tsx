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

import { useMemo } from 'react'
import {
  ComposedChart, Line, Area, XAxis, YAxis, Tooltip, ReferenceLine,
  ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { format, parseISO } from 'date-fns'
import type { PositionLifecycle, PositionEvent, PricePoint, HoldingsTimePoint } from '../../hooks/usePositionLifecycle'

export type OverlayField = 'shares' | 'weight' | 'active_weight'

interface PositionChartProps {
  lifecycle: PositionLifecycle
  priceHistory: PricePoint[]
  holdingsHistory?: HoldingsTimePoint[]
  overlayField?: OverlayField
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

export function PositionChart({ lifecycle, priceHistory, holdingsHistory, overlayField = 'shares', height = 220, className }: PositionChartProps) {
  const hasHoldings = holdingsHistory && holdingsHistory.length > 0
  const overlayCfg = hasHoldings ? OVERLAY_CONFIG[overlayField] : null

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

    // Track last known shares for step interpolation
    let lastShares: number | null = null

    return priceHistory.map(p => {
      const events = eventsByDate.get(p.date) || []
      const decisions = events.filter(e => e.type === 'decision' && e.stage === 'approved')
      const executions = events.filter(e => e.type === 'execution')

      // Holdings: use exact match or carry forward last known
      const holding = holdingsByDate.get(p.date)
      if (holding) lastShares = holding.shares
      const shares = holding?.shares ?? lastShares
      const weightPct = holding?.weightPct ?? null
      // Active weight = weight - benchmark weight (placeholder: just weight for now, benchmark TBD)
      const activeWt = weightPct != null ? weightPct : null

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
        events,
      }
    })
  }, [priceHistory, lifecycle.timeline, holdingsHistory])

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

          <Tooltip content={<ChartTooltip hasHoldings={!!hasHoldings} overlayField={overlayField} />} />

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
            dot={<DecisionDot />}
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

// ── Custom dot that shows decision markers ──

function DecisionDot(props: any) {
  const { cx, cy, payload } = props
  if (!payload) return null

  const hasDecision = payload.decisionAction
  const hasExec = payload.execAction && !hasDecision

  if (!hasDecision && !hasExec) return null

  const action = hasDecision ? payload.decisionAction : payload.execAction
  const cfg = getActionConfig(action)
  const isBullish = action === 'buy' || action === 'add' || action === 'initiate' || action === 'increase'
  const size = hasDecision ? 14 : 10

  return (
    <g>
      <line x1={cx} y1={cy - size} x2={cx} y2={cy + size} stroke={cfg.color} strokeWidth={0.5} strokeDasharray="2 2" opacity={0.5} />

      {hasDecision && (
        <>
          <circle cx={cx} cy={isBullish ? cy - 16 : cy + 16} r={8} fill="white" stroke={cfg.color} strokeWidth={1.5} />
          <text
            x={cx}
            y={isBullish ? cy - 12 : cy + 20}
            textAnchor="middle"
            fill={cfg.color}
            fontSize={11}
            fontWeight="bold"
          >
            {cfg.symbol}
          </text>
        </>
      )}

      {hasExec && (
        <circle cx={cx} cy={cy} r={4} fill={cfg.color} stroke="white" strokeWidth={1.5} />
      )}
    </g>
  )
}

// ── Tooltip ──

function ChartTooltip({ active, payload, hasHoldings, overlayField }: any) {
  if (!active || !payload || payload.length === 0) return null

  const data = payload[0]?.payload
  if (!data) return null

  const events: PositionEvent[] = data.events || []
  const cfg = overlayField ? OVERLAY_CONFIG[overlayField as OverlayField] : null

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-2.5 max-w-72">
      <div className="flex items-center justify-between gap-4 mb-1">
        <span className="text-[10px] text-gray-500">{format(parseISO(data.date), 'MMM d, yyyy')}</span>
        <span className="text-[11px] font-semibold text-gray-900">${data.price?.toFixed(2)}</span>
      </div>

      {/* Holdings overlay info */}
      {hasHoldings && cfg && data[cfg.dataKey] != null && (
        <div className="text-[10px] mb-1" style={{ color: cfg.color }}>
          {cfg.label}: <span className="font-semibold">{cfg.formatter(data[cfg.dataKey])}</span>
          {/* Show additional context */}
          {overlayField === 'shares' && data.weightPct != null && (
            <span className="text-gray-400 ml-2">{data.weightPct.toFixed(2)}% wt</span>
          )}
          {overlayField === 'weight' && data.shares != null && data.shares > 0 && (
            <span className="text-gray-400 ml-2">{data.shares.toLocaleString()} shs</span>
          )}
        </div>
      )}

      {events.length > 0 && (
        <div className="border-t border-gray-100 pt-1.5 mt-1 space-y-1">
          {events.map((evt: PositionEvent, i: number) => {
            const cfg = getActionConfig(evt.action)
            return (
              <div key={i} className="flex items-center gap-1.5">
                <span className="font-bold text-[10px]" style={{ color: cfg.color }}>{cfg.symbol}</span>
                <span className="text-[10px] text-gray-700 font-medium">{cfg.label}</span>
                <span className="text-[9px] text-gray-400">
                  {evt.type === 'decision' ? 'decision' : 'executed'}
                </span>
                {evt.price && (
                  <span className="text-[10px] text-gray-500 ml-auto">@ ${evt.price.toFixed(2)}</span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
