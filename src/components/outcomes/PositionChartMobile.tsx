/**
 * PositionChartMobile — the Outcomes position chart at phone width.
 *
 * Same data as `PositionChart` (both plot `buildPositionChartData`) and the
 * same Recharts drawing, with a phone interaction layer on top:
 *
 * - Scrub: a finger drag moves a crosshair and a tooltip (date, price, the
 *   selected metric). Lifting the finger clears it. A plain tap pins the
 *   tooltip until the next tap anywhere else.
 * - Marker taps: a tap within MARKER_HIT_RADIUS of a decision / execution
 *   marker selects it, even though the drawn marker stays small.
 * - Price is primary: the price axis is on the right in full ink; the
 *   secondary metric is a faint area in the lower part of the plot with a
 *   two-tick axis in its own colour and unit.
 * - Metric: Shares / Weight / Active weight, each on its own scale and unit.
 *   A metric with no history is disabled and says so.
 * - Range: 3M · 6M · 1Y · All, offered only where the data is longer than
 *   the range, defaulting to the shortest one that shows entry → latest.
 *
 * Geometry comes from Recharts itself. The line's dot renderer is called for
 * every point with its drawn (cx, cy), and those are recorded, so the
 * crosshair and the tap targets sit exactly where Recharts drew — nothing
 * here re-derives Recharts' scales.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ComposedChart, Line, Area, XAxis, YAxis, ReferenceLine, CartesianGrid } from 'recharts'
import { clsx } from 'clsx'
import { format, parseISO } from 'date-fns'
import type { PositionLifecycle, PricePoint, HoldingsTimePoint } from '../../hooks/usePositionLifecycle'
import { DecisionDot } from './PositionChart'
import { knownBenchmarkWeightPct, type BenchmarkWeight } from '../../lib/holdings/benchmark-membership'
import {
  buildPositionChartData, getActionConfig, markerGeometry,
  METRICS, METRIC_ORDER, MARKER_HIT_RADIUS, PLOT_HEIGHT,
  availableRanges, defaultRange, metricAvailability, rangeCutoff,
  type ChartRange, type OverlayField, type PositionChartRow,
} from './position-chart-model'

/** Horizontal travel, in px, after which a touch is a scrub and not a tap. */
const TAP_SLOP = 8

const MARGIN = { top: 14, right: 4, bottom: 8, left: 4 }
const PRICE_AXIS_WIDTH = 46
const METRIC_AXIS_WIDTH = 42
const TOOLTIP_WIDTH = 168
/** Share of the plot height the secondary metric may rise to. */
const METRIC_BAND = 0.42

const PRICE_COLOR = '#2563eb'
const ENTRY_COLOR = '#6366f1'

function niceStep(raw: number) {
  if (!(raw > 0)) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / mag
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag
}

/** Price domain padded off the data (entry line included) and 2–4 ticks kept
 *  clear of the plot edges so no label is cut in half. */
function priceScale(values: number[]) {
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = hi - lo
  const pad = span > 0 ? span * 0.1 : Math.max(Math.abs(hi) * 0.02, 0.5)
  const domain: [number, number] = [lo - pad, hi + pad]
  const step = niceStep((domain[1] - domain[0]) / 3.5)
  const edge = (domain[1] - domain[0]) * 0.06
  const ticks: number[] = []
  for (let t = Math.ceil(domain[0] / step) * step; t <= domain[1]; t += step) {
    if (t - domain[0] >= edge && domain[1] - t >= edge) ticks.push(Number(t.toFixed(6)))
  }
  const decimals = step < 1 ? 2 : 0
  return { domain, ticks, tick: (v: number) => `$${v.toFixed(decimals)}` }
}

/** Secondary scale: the metric occupies the lower METRIC_BAND of the plot. */
function metricScale(values: number[]) {
  const lo = Math.min(0, ...values)
  const hi = Math.max(0, ...values)
  const span = hi - lo || Math.abs(hi) || 1
  const domain: [number, number] = [lo, lo + span / METRIC_BAND]
  const ticks = Array.from(new Set([hi, ...(lo < 0 ? [lo] : [])])).filter(v => v !== 0 || lo < 0)
  return { domain, ticks: ticks.length ? ticks : [hi] }
}

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => setWidth(el.clientWidth)
    read()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', read)
      return () => window.removeEventListener('resize', read)
    }
    const observer = new ResizeObserver(read)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

export interface PositionChartMobileProps {
  lifecycle: PositionLifecycle
  priceHistory: PricePoint[]
  holdingsHistory?: HoldingsTimePoint[]
  /** The asset's benchmark weight; null/undefined while unknown (loading or
   *  failed). Active weight is drawn only from a known weight. */
  benchmark?: BenchmarkWeight | null
  benchmarkLoading?: boolean
  /** Offered beside "Benchmark data unavailable". */
  onRetryBenchmark?: () => void
  onSelectEvent?: (sourceId: string, sourceType: 'trade_queue_item' | 'portfolio_trade_event') => void
  symbol?: string | null
  /** Controlled so the choice outlives the chart being hidden. */
  metric: OverlayField
  onMetricChange: (metric: OverlayField) => void
  /** null = the default range for this data. */
  range: ChartRange | null
  onRangeChange: (range: ChartRange) => void
}

type Point = { cx: number; cy: number }

export function PositionChartMobile({
  lifecycle, priceHistory, holdingsHistory, benchmark, benchmarkLoading = false, onRetryBenchmark, onSelectEvent, symbol,
  metric, onMetricChange, range, onRangeChange,
}: PositionChartMobileProps) {
  const [plotRef, width] = useElementWidth<HTMLDivElement>()
  const rootRef = useRef<HTMLDivElement>(null)
  const benchmarkWeightPct = knownBenchmarkWeightPct(benchmark)

  const allRows = useMemo(
    () => buildPositionChartData(lifecycle, priceHistory, holdingsHistory, benchmarkWeightPct),
    [lifecycle, priceHistory, holdingsHistory, benchmarkWeightPct],
  )
  const availability = useMemo(() => metricAvailability(allRows), [allRows])
  const ranges = useMemo(() => availableRanges(allRows), [allRows])
  const effectiveRange: ChartRange = range && ranges.includes(range) ? range : defaultRange(allRows, lifecycle)

  const rows = useMemo(() => {
    if (effectiveRange === 'All' || allRows.length < 2) return allRows
    const cutoff = rangeCutoff(allRows, effectiveRange)
    const cropped = allRows.filter(r => r.date >= cutoff)
    return cropped.length >= 2 ? cropped : allRows
  }, [allRows, effectiveRange])

  const metricOn = availability[metric]
  const cfg = METRICS[metric]
  const data = useMemo(() => rows.map((r, idx) => ({ ...r, idx })), [rows])

  const price = useMemo(() => {
    const values = rows.map(r => r.price).filter((v): v is number => v != null && Number.isFinite(v))
    if (lifecycle.avgEntryPrice != null) values.push(lifecycle.avgEntryPrice)
    return values.length ? priceScale(values) : null
  }, [rows, lifecycle.avgEntryPrice])

  const secondary = useMemo(() => {
    if (!metricOn) return null
    const values = rows.map(r => r[cfg.key]).filter((v): v is number => v != null && Number.isFinite(v))
    return values.length ? metricScale(values) : null
  }, [rows, cfg.key, metricOn])

  // ── Recorded geometry ────────────────────────────────────────────────
  const pointsRef = useRef<Array<Point | undefined>>([])
  pointsRef.current.length = data.length

  const renderDot = useCallback((props: { cx?: number; cy?: number; index: number; key?: string; payload?: PositionChartRow }) => {
    if (props.cx != null && props.cy != null && Number.isFinite(props.cx) && Number.isFinite(props.cy)) {
      pointsRef.current[props.index] = { cx: props.cx, cy: props.cy }
    }
    // Marker taps are handled by the scrub layer; the drawn marker is visual.
    const { key, ...dotProps } = props
    return <DecisionDot key={key ?? `dot-${props.index}`} {...dotProps} symbol={symbol} />
  }, [symbol])

  // ── Scrub / tap ──────────────────────────────────────────────────────
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const gesture = useRef<{ startX: number; startY: number; moved: boolean } | null>(null)

  // A new range or metric redraws the points; a pinned tooltip would be stale.
  useEffect(() => { setActiveIndex(null) }, [effectiveRange, metric, rows])

  const nearestIndex = (x: number) => {
    let best: number | null = null
    let bestDist = Infinity
    pointsRef.current.forEach((p, i) => {
      if (!p) return
      const d = Math.abs(p.cx - x)
      if (d < bestDist) { bestDist = d; best = i }
    })
    return best
  }

  const markerAt = (x: number, y: number) => {
    let hit: PositionChartRow | null = null
    let bestDist = Infinity
    data.forEach((row, i) => {
      const p = pointsRef.current[i]
      if (!p || !row.eventSourceId) return
      const g = markerGeometry(row, p.cx, p.cy)
      if (!g) return
      const d = Math.hypot(g.x - x, g.y - y)
      if (d <= MARKER_HIT_RADIUS && d < bestDist) { bestDist = d; hit = row }
    })
    return hit as PositionChartRow | null
  }

  const local = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const { x, y } = local(e)
    gesture.current = { startX: x, startY: y, moved: false }
    setActiveIndex(nearestIndex(x))
    try { e.currentTarget.setPointerCapture?.(e.pointerId) } catch { /* not supported */ }
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    if (!g) return
    const { x } = local(e)
    if (Math.abs(x - g.startX) > TAP_SLOP) g.moved = true
    setActiveIndex(nearestIndex(x))
  }
  const onPointerUp = () => {
    const g = gesture.current
    gesture.current = null
    if (!g) return
    if (g.moved) { setActiveIndex(null); return }
    const hit = markerAt(g.startX, g.startY)
    if (hit && onSelectEvent && hit.eventSourceId && hit.eventSourceType) {
      setActiveIndex(null)
      onSelectEvent(hit.eventSourceId, hit.eventSourceType)
    }
    // Otherwise a plain tap: the tooltip stays until the next tap elsewhere.
  }
  const onPointerCancel = () => {
    // The browser took the gesture over (a vertical page scroll).
    gesture.current = null
    setActiveIndex(null)
  }

  useEffect(() => {
    if (activeIndex == null) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setActiveIndex(null)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [activeIndex])

  // ── Render ───────────────────────────────────────────────────────────
  const chart = useMemo(() => {
    if (!width || !price || data.length === 0) return null
    const n = data.length
    return (
      <ComposedChart width={width} height={PLOT_HEIGHT} data={data} margin={MARGIN}>
        <CartesianGrid stroke="#eef0f3" vertical={false} horizontalValues={price.ticks} />
        <XAxis dataKey="idx" type="number" domain={n > 1 ? [0, n - 1] : [-1, 1]} allowDataOverflow hide />
        <YAxis
          yAxisId="price"
          orientation="right"
          width={PRICE_AXIS_WIDTH}
          domain={price.domain}
          allowDataOverflow
          ticks={price.ticks}
          tickFormatter={price.tick}
          tick={{ fontSize: 11, fill: '#374151' }}
          axisLine={false}
          tickLine={false}
        />
        {secondary && (
          <YAxis
            yAxisId="metric"
            orientation="left"
            width={METRIC_AXIS_WIDTH}
            domain={secondary.domain}
            allowDataOverflow
            ticks={secondary.ticks}
            tickFormatter={cfg.tick}
            tick={{ fontSize: 10, fill: cfg.color }}
            axisLine={false}
            tickLine={false}
          />
        )}
        {secondary && (
          <Area
            yAxisId="metric"
            type="stepAfter"
            dataKey={cfg.key}
            fill={cfg.color}
            fillOpacity={0.1}
            stroke={cfg.color}
            strokeOpacity={0.45}
            strokeWidth={1}
            isAnimationActive={false}
            connectNulls
          />
        )}
        {lifecycle.avgEntryPrice != null && (
          // No in-plot label: "Entry $…" sat on the line and ran off the
          // edge at this width. The legend names the line and its price.
          <ReferenceLine yAxisId="price" y={lifecycle.avgEntryPrice} stroke={ENTRY_COLOR} strokeDasharray="4 4" strokeWidth={1} />
        )}
        <Line
          yAxisId="price"
          type="monotone"
          dataKey="price"
          stroke={PRICE_COLOR}
          strokeWidth={2}
          dot={renderDot}
          activeDot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    )
  }, [width, price, data, secondary, cfg, lifecycle.avgEntryPrice, renderDot])

  const active = activeIndex != null ? data[activeIndex] : null
  const activePoint = activeIndex != null ? pointsRef.current[activeIndex] : undefined
  const tooltipLeft = activePoint
    ? Math.min(Math.max(activePoint.cx - TOOLTIP_WIDTH / 2, 0), Math.max(0, width - TOOLTIP_WIDTH))
    : 0

  const firstDate = rows[0]?.date
  const midDate = rows[Math.floor((rows.length - 1) / 2)]?.date
  const lastDate = rows[rows.length - 1]?.date
  const spanDays = firstDate && lastDate ? (parseISO(lastDate).getTime() - parseISO(firstDate).getTime()) / 86_400_000 : 0
  const axisDate = (d?: string) => (d ? format(parseISO(d), spanDays > 200 ? 'MMM yy' : 'MMM d') : '')

  const unavailable = METRIC_ORDER.filter(m => !availability[m])
  // Weight history exists but the benchmark weight is unknown: the only
  // thing standing between the reader and Active weight is benchmark data.
  const benchmarkBlocks = availability.weight && benchmarkWeightPct == null
  const benchmarkNote = benchmarkLoading ? 'Loading benchmark data…' : 'Benchmark data unavailable'
  const note = !metricOn
    ? metric === 'active_weight' && benchmarkBlocks
      ? `${benchmarkNote} — showing price only.`
      : `No ${cfg.label.toLowerCase()} history for this position — showing price only.`
    : !availability.weight || !availability.shares
      ? `${unavailable.map(m => METRICS[m].label).join(' and ')} ${unavailable.length > 1 ? 'aren’t' : 'isn’t'} available for this position.`
      : benchmarkBlocks
        ? benchmarkNote
        : null

  return (
    <div ref={rootRef} data-slot="position-chart-mobile" className="w-full min-w-0 pt-3 pb-3">
      {/* Controls */}
      <div className="px-3 space-y-2">
        <div role="radiogroup" aria-label="Position metric" className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-gray-100 dark:bg-gray-900">
          {METRIC_ORDER.map(m => {
            const on = metric === m
            const ok = availability[m]
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!ok}
                onClick={() => onMetricChange(m)}
                className={clsx(
                  'min-h-[40px] min-w-0 px-1 rounded-md text-[13px] font-medium truncate transition-colors',
                  on && ok && 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white',
                  on && !ok && 'bg-white/60 text-gray-400 dark:bg-gray-700/60',
                  !on && ok && 'text-gray-600 active:bg-white/60 dark:text-gray-300',
                  !ok && 'text-gray-300 line-through decoration-gray-300 dark:text-gray-600',
                )}
              >
                {METRICS[m].short}
              </button>
            )
          })}
        </div>

        {ranges.length > 1 && (
          <div role="radiogroup" aria-label="Chart range" className="flex items-center gap-1">
            {ranges.map(r => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={effectiveRange === r}
                onClick={() => onRangeChange(r)}
                className={clsx(
                  'h-9 min-w-[44px] px-2 rounded-md text-[13px] font-medium tabular-nums transition-colors',
                  effectiveRange === r
                    ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                    : 'text-gray-600 active:bg-gray-100 dark:text-gray-300 dark:active:bg-gray-700',
                )}
              >
                {r}
              </button>
            ))}
          </div>
        )}

        {note && (
          <p data-slot="metric-unavailable" className="flex flex-wrap items-center gap-x-2 text-[12px] leading-snug text-gray-500 dark:text-gray-400">
            <span>{note}</span>
            {benchmarkBlocks && !benchmarkLoading && onRetryBenchmark && (
              <button
                type="button"
                onClick={onRetryBenchmark}
                className="min-h-[32px] font-medium text-primary-600 dark:text-primary-400"
              >
                Retry
              </button>
            )}
          </p>
        )}
      </div>

      {/* Plot + scrub layer */}
      <div ref={plotRef} className="relative mt-2 w-full min-w-0 overflow-hidden" style={{ height: PLOT_HEIGHT }}>
        {chart}
        <div
          data-slot="chart-scrub-layer"
          className="absolute inset-0 select-none"
          style={{ touchAction: 'pan-y' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        />
        {active && activePoint && (
          <>
            <div
              data-slot="chart-crosshair"
              className="pointer-events-none absolute w-px bg-gray-400/80"
              style={{ left: activePoint.cx, top: MARGIN.top, bottom: MARGIN.bottom }}
            />
            <div
              className="pointer-events-none absolute w-2.5 h-2.5 -ml-[5px] -mt-[5px] rounded-full border-2 border-white"
              style={{ left: activePoint.cx, top: activePoint.cy, backgroundColor: PRICE_COLOR }}
            />
            <div
              role="status"
              data-slot="chart-tooltip"
              className="pointer-events-none absolute top-1 rounded-lg border border-gray-200 bg-white/95 px-2.5 py-2 shadow-md dark:border-gray-700 dark:bg-gray-800/95"
              style={{ left: tooltipLeft, width: TOOLTIP_WIDTH }}
            >
              <div className="text-[12px] font-medium text-gray-500 dark:text-gray-400">{format(parseISO(active.date), 'MMM d, yyyy')}</div>
              <div className="mt-0.5 flex items-baseline justify-between gap-2">
                <span className="text-[12px] text-gray-500 dark:text-gray-400">Price</span>
                <span data-slot="tooltip-price" className="text-[14px] font-semibold tabular-nums text-gray-900 dark:text-white">
                  {active.price != null ? `$${active.price.toFixed(2)}` : '—'}
                </span>
              </div>
              {metricOn && (
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12px]" style={{ color: cfg.color }}>{cfg.label}</span>
                  <span data-slot="tooltip-metric" className="text-[13px] font-medium tabular-nums text-gray-800 dark:text-gray-100">
                    {active[cfg.key] != null ? cfg.format(active[cfg.key] as number) : '—'}
                  </span>
                </div>
              )}
              {(active.decisionAction || active.execAction) && (
                <div className="mt-1 text-[12px] font-medium" style={{ color: getActionConfig((active.decisionAction || active.execAction) as string).color }}>
                  {getActionConfig((active.decisionAction || active.execAction) as string).label}
                  {' · '}{active.decisionAction ? 'Decision' : 'Execution'}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Dates under the plot, pinned to its edges so none is clipped. */}
      <div
        className="flex justify-between text-[11px] tabular-nums text-gray-500 dark:text-gray-400"
        style={{ paddingLeft: MARGIN.left + (secondary ? METRIC_AXIS_WIDTH : 0), paddingRight: MARGIN.right + PRICE_AXIS_WIDTH }}
      >
        <span>{axisDate(firstDate)}</span>
        {rows.length > 2 && <span>{axisDate(midDate)}</span>}
        <span>{axisDate(lastDate)}</span>
      </div>

      {/* Legend — wraps to a second row on purpose rather than truncating. */}
      <div data-slot="chart-legend" className="mt-2 px-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-600 dark:text-gray-300">
        <span className="inline-flex items-center gap-1.5"><span className="w-4 h-0.5 rounded" style={{ backgroundColor: PRICE_COLOR }} />Price</span>
        {secondary && (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-2.5 rounded-sm" style={{ backgroundColor: `${cfg.color}26`, border: `1px solid ${cfg.color}73` }} />
            {cfg.label}
            {metric === 'active_weight' && benchmark?.status === 'not_member' && <span className="text-gray-400">(not in benchmark)</span>}
          </span>
        )}
        {lifecycle.avgEntryPrice != null && (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-4 border-t border-dashed" style={{ borderColor: ENTRY_COLOR }} />
            Avg entry ${lifecycle.avgEntryPrice.toFixed(2)}
          </span>
        )}
        <span className="inline-flex items-center gap-1"><span className="text-green-500 font-bold">▲</span>Buy/Add</span>
        <span className="inline-flex items-center gap-1"><span className="text-red-500 font-bold">▼</span>Sell/Trim</span>
      </div>
    </div>
  )
}
