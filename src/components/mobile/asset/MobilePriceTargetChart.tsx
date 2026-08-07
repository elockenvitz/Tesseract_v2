import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import {
  Area,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Maximize2, X } from 'lucide-react'
import { usePriceTargetChart } from '../../../hooks/usePriceTargetChart'
import { MobileCaseTargets } from './MobileCaseTargets'

interface MobilePriceTargetChartProps {
  assetId: string
  symbol: string
  viewFilter?: 'aggregated' | string
}

const TIMEFRAMES = ['1M', '3M', '6M', '1Y', '2Y', '5Y'] as const
type Timeframe = (typeof TIMEFRAMES)[number]

/** Scenario ordering, as the case is argued rather than alphabetical. */
const ORDER = ['Bull', 'Base', 'Bear']

/**
 * Real price history with the case's targets drawn across it.
 *
 * Prices come from usePriceTargetChart, the same hook the desktop chart uses,
 * which fetches actual candles from Yahoo. That matters: the feed's chart
 * panel builds its series with ChartDataAdapter.generateHistoricalData, a
 * seeded random walk anchored to the current quote. Plotting real price
 * targets over invented prices would show a picture of analysis that never
 * happened.
 *
 * Targets collapse to one line per scenario — the average across analysts —
 * rather than a line each. A phone-width chart with a dozen labelled lines is
 * unreadable, and what the reader needs here is where the three cases sit
 * relative to the price, not who set which.
 */
export function MobilePriceTargetChart({
  assetId,
  symbol,
  viewFilter = 'aggregated',
}: MobilePriceTargetChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('1Y')
  const [fullscreen, setFullscreen] = useState(false)

  const { historicalPrices, priceTargets, currentPrice, priceChangePercent, loading, error } =
    usePriceTargetChart({ assetId, symbol, timeframe: timeframe as any })

  const series = useMemo(
    () =>
      (historicalPrices ?? []).map(d => ({
        t: new Date(d.time).getTime(),
        price: d.close,
      })),
    [historicalPrices]
  )

  // One line per scenario. Several analysts can hold a view on the same
  // scenario, and drawing each would crowd the plot without adding meaning at
  // this size.
  const scenarioLines = useMemo(() => {
    const groups = new Map<string, { name: string; color: string; prices: number[] }>()
    for (const t of priceTargets ?? []) {
      if (t.status === 'cancelled' || !Number.isFinite(t.price)) continue
      const key = t.scenarioName || 'Target'
      if (!groups.has(key)) {
        groups.set(key, { name: key, color: t.scenarioColor || '#6b7280', prices: [] })
      }
      groups.get(key)!.prices.push(t.price)
    }
    return [...groups.values()]
      .map(g => ({
        name: g.name,
        color: g.color,
        price: g.prices.reduce((sum, p) => sum + p, 0) / g.prices.length,
        count: g.prices.length,
      }))
      .sort((a, b) => {
        const ai = ORDER.indexOf(a.name)
        const bi = ORDER.indexOf(b.name)
        if (ai === -1 && bi === -1) return b.price - a.price
        if (ai === -1) return 1
        if (bi === -1) return -1
        return ai - bi
      })
  }, [priceTargets])

  // The axis must cover both the price history and every target, or a target
  // above the range would be silently clipped off the top of the chart.
  const domain = useMemo(() => {
    const values = series.map(p => p.price).filter(Number.isFinite)
    for (const line of scenarioLines) values.push(line.price)
    if (!values.length) return null
    const lo = Math.min(...values)
    const hi = Math.max(...values)
    const pad = (hi - lo) * 0.08 || Math.max(hi * 0.05, 1)
    return [lo - pad, hi + pad] as [number, number]
  }, [series, scenarioLines])

  if (loading) {
    return <div className="h-56 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
  }

  // No fabricated fallback: an empty series means the price feed failed, and
  // an invented line under real targets would be worse than no chart.
  if (error || !series.length) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-center">
        <p className="text-sm text-gray-400">Price history unavailable for {symbol}.</p>
      </div>
    )
  }

  const up = (priceChangePercent ?? 0) >= 0
  const lineColor = up ? '#10b981' : '#ef4444'

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
      <div className="flex items-baseline gap-2 px-3 pt-2.5">
        <span className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">
          ${currentPrice?.toFixed(2)}
        </span>
        <span
          className={clsx(
            'text-xs font-semibold tabular-nums',
            up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
          )}
        >
          {up ? '+' : ''}
          {priceChangePercent?.toFixed(2)}%
        </span>
        <button
          type="button"
          onClick={() => setFullscreen(true)}
          className="ml-auto h-8 w-8 flex items-center justify-center rounded-lg text-gray-400 active:bg-gray-100 dark:active:bg-gray-800 no-touch-target"
          aria-label="Expand chart"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>

      <div className="h-48 px-1 pt-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={series} margin={{ top: 4, right: 44, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`mptc-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={lineColor} stopOpacity={0.25} />
                <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
              </linearGradient>
            </defs>

            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={formatTick(timeframe)}
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              tickLine={false}
              axisLine={false}
              minTickGap={28}
            />
            {/* Y axis hidden, as on the feed charts: the values that matter are
                labelled directly on the target lines. */}
            <YAxis domain={domain ?? ['dataMin', 'dataMax']} hide />

            <Area
              type="monotone"
              dataKey="price"
              stroke={lineColor}
              strokeWidth={1.75}
              fill={`url(#mptc-${symbol})`}
              isAnimationActive={false}
              dot={false}
            />

            {scenarioLines.map(line => (
              <ReferenceLine
                key={line.name}
                y={line.price}
                stroke={line.color}
                strokeDasharray="4 3"
                strokeWidth={1.25}
                label={{
                  value: `$${line.price.toFixed(0)}`,
                  position: 'right',
                  fill: line.color,
                  fontSize: 10,
                  fontWeight: 700,
                }}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <TimeframeBar value={timeframe} onChange={setTimeframe} />

      <div className="border-t border-gray-100 dark:border-gray-800">
        <MobileCaseTargets
          assetId={assetId}
          currentPrice={currentPrice ?? null}
          viewFilter={viewFilter}
        />
      </div>

      {fullscreen && (
        <FullscreenChart
          symbol={symbol}
          series={series}
          domain={domain}
          lineColor={lineColor}
          scenarioLines={scenarioLines}
          timeframe={timeframe}
          onTimeframe={setTimeframe}
          onClose={() => setFullscreen(false)}
        />
      )}
    </div>
  )
}


function TimeframeBar({
  value,
  onChange,
}: {
  value: Timeframe
  onChange: (tf: Timeframe) => void
}) {
  return (
    <div className="flex items-center gap-1 px-2 py-1.5 border-t border-gray-100 dark:border-gray-800">
      {TIMEFRAMES.map(tf => (
        <button
          key={tf}
          type="button"
          onClick={() => onChange(tf)}
          aria-pressed={tf === value}
          className={clsx(
            'flex-1 h-8 rounded-lg text-xs font-semibold transition-colors no-touch-target',
            tf === value
              ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
              : 'text-gray-500 dark:text-gray-400 active:bg-gray-100 dark:active:bg-gray-800'
          )}
        >
          {tf}
        </button>
      ))}
    </div>
  )
}

/**
 * The chart given the whole screen.
 *
 * Inside a scrolling column a chart competes with everything else for height,
 * and no amount of tuning gives it the aspect ratio a price series wants. Full
 * screen it gets priced axis labels, a crosshair tooltip and room for the
 * target lines to sit apart from one another.
 */
function FullscreenChart({
  symbol,
  series,
  domain,
  lineColor,
  scenarioLines,
  timeframe,
  onTimeframe,
  onClose,
}: {
  symbol: string
  series: { t: number; price: number }[]
  domain: [number, number] | null
  lineColor: string
  scenarioLines: { name: string; color: string; price: number; count: number }[]
  timeframe: Timeframe
  onTimeframe: (tf: Timeframe) => void
  onClose: () => void
}) {
  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[90] flex flex-col bg-white dark:bg-gray-900">
      <div className="flex-shrink-0 flex items-center gap-2 px-3 h-14 pt-safe border-b border-gray-200 dark:border-gray-700">
        <span className="text-base font-bold text-gray-900 dark:text-white">{symbol}</span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto h-10 w-10 flex items-center justify-center rounded-full text-gray-500 dark:text-gray-400 no-touch-target"
          aria-label="Close chart"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 min-h-0 px-1 py-2">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={series} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
            <defs>
              <linearGradient id={'mptc-full-' + symbol} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={lineColor} stopOpacity={0.25} />
                <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={formatTick(timeframe)}
              tick={{ fontSize: 11, fill: '#9ca3af' }}
              tickLine={false}
              axisLine={false}
              minTickGap={36}
            />
            {/* Full screen has room for prices on the axis, which the inline
                chart does not. */}
            <YAxis
              domain={domain ?? ['dataMin', 'dataMax']}
              orientation="right"
              tick={{ fontSize: 11, fill: '#9ca3af' }}
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={(v: number) => '$' + v.toFixed(0)}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
              labelFormatter={(t: number) => new Date(t).toLocaleDateString()}
              formatter={(v: number) => ['$' + v.toFixed(2), 'Price']}
            />
            <Area
              type="monotone"
              dataKey="price"
              stroke={lineColor}
              strokeWidth={2}
              fill={'url(#mptc-full-' + symbol + ')'}
              isAnimationActive={false}
              dot={false}
            />
            {scenarioLines.map(line => (
              <ReferenceLine
                key={line.name}
                y={line.price}
                stroke={line.color}
                strokeDasharray="4 3"
                strokeWidth={1.5}
                label={{
                  value: line.name + ' $' + line.price.toFixed(0),
                  position: 'insideTopRight',
                  fill: line.color,
                  fontSize: 11,
                  fontWeight: 700,
                }}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="flex-shrink-0 pb-safe">
        <TimeframeBar value={timeframe} onChange={onTimeframe} />
      </div>
    </div>,
    document.body
  )
}

/**
 * Tick labels sized to the span. A year of daily candles labelled with full
 * dates overlaps into unreadability at phone width, so short ranges show the
 * day and long ranges the month or year.
 */
function formatTick(timeframe: Timeframe) {
  return (value: number) => {
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return ''
    if (timeframe === '1M' || timeframe === '3M') {
      return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    }
    if (timeframe === '5Y' || timeframe === '2Y') {
      return d.toLocaleDateString(undefined, { year: '2-digit', month: 'short' })
    }
    return d.toLocaleDateString(undefined, { month: 'short' })
  }
}
