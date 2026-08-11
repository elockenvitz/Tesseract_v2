import { useState, useMemo } from 'react'
import { clsx } from 'clsx'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot
} from 'recharts'
import { TrendingUp, TrendingDown, BarChart3, Loader2 } from 'lucide-react'
import { usePriceHistory } from '../../hooks/usePriceHistory'

type Timeframe = '1D' | '5D' | '1M' | '3M' | '6M' | '1Y' | '5Y' | 'MAX'

const timeframes: { value: Timeframe; label: string; days: number }[] = [
  { value: '1D', label: '1D', days: 1 },
  { value: '5D', label: '5D', days: 5 },
  { value: '1M', label: '1M', days: 30 },
  { value: '3M', label: '3M', days: 90 },
  { value: '6M', label: '6M', days: 180 },
  { value: '1Y', label: '1Y', days: 365 },
  { value: '5Y', label: '5Y', days: 1825 },
  { value: 'MAX', label: 'MAX', days: 3650 },
]

interface ReelsChartPanelProps {
  symbol: string
  companyName?: string
  onOpenFullChart?: (symbol: string) => void
  /** Suppresses the panel's own symbol/price row. Set when the surrounding
   *  tile already shows that information, so the chart gets the height back
   *  instead of the card carrying two headers. */
  hideHeader?: boolean
  eventDate?: string  // ISO date string for when an event occurred (e.g., trade idea created)
  eventLabel?: string // Label for the event
}

export function ReelsChartPanel({
  symbol,
  companyName,
  onOpenFullChart,
  hideHeader = false,
  eventDate,
  eventLabel
}: ReelsChartPanelProps) {
  const [selectedTimeframe, setSelectedTimeframe] = useState<Timeframe>('1Y')
  /** Point under the finger while scrubbing; null when not scrubbing. */
  const [scrub, setScrub] = useState<{ value: number; timestamp: number } | null>(null)

  // The separate getQuote fetch that used to live here is gone. It was a
  // second round trip to the same upstream, on its own cache, feeding a price
  // rendered next to a line drawn from different data — so the two could
  // disagree by a tick and make a correct chart look broken. One request now
  // supplies both.
  //
  // Real closes from Yahoo, via the chart proxy.
  //
  // This used to call ChartDataAdapter.generateHistoricalData — a seeded
  // random walk anchored to the current quote — and generateIntradayData,
  // which is a plain Math.random() walk. The line looked plausible and had
  // never had anything to do with the security. That is a correctness problem
  // in a finance product rather than a cosmetic one, and the scrub readout
  // made it worse by turning an ambiguous squiggle into a precise claim about
  // a price nobody ever traded at.
  const { data: history, isLoading: historyLoading } = usePriceHistory(symbol, selectedTimeframe)
  const chartData = history?.points ?? []

  // Calculate stats
  const stats = useMemo(() => {
    if (chartData.length < 2) return null

    const firstValue = chartData[0]?.value || 0
    const lastValue = chartData[chartData.length - 1]?.value || 0
    const change = lastValue - firstValue
    const changePercent = (change / firstValue) * 100

    return {
      change,
      changePercent,
      isPositive: change >= 0
    }
  }, [chartData])

  // Chart colors
  const chartColor = stats?.isPositive ? '#10b981' : '#ef4444'

  // Find event data point if eventDate is provided
  const eventDataPoint = useMemo(() => {
    if (!eventDate || chartData.length === 0) return null

    const eventTime = new Date(eventDate).getTime()

    // Find the closest data point to the event date
    let closestPoint = chartData[0]
    let closestDiff = Math.abs(chartData[0].timestamp - eventTime)

    for (const point of chartData) {
      const diff = Math.abs(point.timestamp - eventTime)
      if (diff < closestDiff) {
        closestDiff = diff
        closestPoint = point
      }
    }

    // Only show if the event is within the chart's time range
    const chartStart = chartData[0].timestamp
    const chartEnd = chartData[chartData.length - 1].timestamp

    if (eventTime >= chartStart && eventTime <= chartEnd) {
      return closestPoint
    }

    return null
  }, [eventDate, chartData])

  return (
    <div className="w-full h-full flex flex-col">
      {/* Header with symbol info */}
      {!hideHeader && (
      <div className="flex items-center justify-between px-2 py-2 bg-white border-b border-gray-200 rounded-t-xl relative z-30 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center gap-3">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">${symbol}</h3>
            {companyName && (
              <p className="text-xs text-gray-500 dark:text-gray-400">{companyName}</p>
            )}
          </div>

          {/* Same source as the line and the scrub readout — see the note on
              the scrub row. A separately-fetched quote here would drift from
              the series and look like a broken chart. */}
          {history?.currentPrice != null && stats && (
            <div className="flex items-center gap-2 pl-3 border-l border-gray-200 dark:border-gray-700">
              <span className="text-lg font-semibold text-gray-900 dark:text-white">
                ${history.currentPrice.toFixed(2)}
              </span>
              <span className={clsx(
                'flex items-center text-sm font-medium',
                stats.isPositive ? 'text-green-600' : 'text-red-600'
              )}>
                {stats.isPositive ? (
                  <TrendingUp className="h-4 w-4 mr-0.5" />
                ) : (
                  <TrendingDown className="h-4 w-4 mr-0.5" />
                )}
                {stats.isPositive ? '+' : ''}{stats.changePercent.toFixed(2)}%
              </span>
            </div>
          )}
        </div>

        {/* Open full chart button */}
        {onOpenFullChart && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onOpenFullChart(symbol)
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors text-sm dark:hover:text-white dark:hover:bg-gray-700 dark:text-gray-400"
            title="Open full chart"
          >
            <BarChart3 className="h-4 w-4" />
            <span>Full Chart</span>
          </button>
        )}
      </div>
      )}

      {/* Timeframe selector */}
      <div className={clsx("flex items-center justify-between gap-0.5 px-2 py-0.5 bg-gray-50 border-b border-gray-200 relative z-30 dark:border-gray-700 dark:bg-gray-900", hideHeader && "rounded-t-xl border-t")}>
        {timeframes.map(tf => (
          <button
            key={tf.value}
            onClick={(e) => {
              e.stopPropagation()
              setSelectedTimeframe(tf.value)
            }}
            className={clsx(
              'px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors whitespace-nowrap no-touch-target',
              selectedTimeframe === tf.value
                ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-700 dark:text-gray-400'
            )}
          >
            {tf.label}
          </button>
        ))}
      </div>

      {/* Scrub readout.

          Yahoo's behaviour: dragging the chart changes the price *above* it
          rather than raising a tooltip box over the series. A floating box is
          the worst possible place to put this — it sits exactly where your
          finger is, covering the part of the line you are interrogating, and
          it moves while you read it.

          The row is always rendered, so revealing a value costs no layout
          shift; it shows the live quote at rest and the point under the finger
          while scrubbing. */}
      <div className={clsx(
        'flex-shrink-0 flex items-baseline gap-2 px-2.5 h-7 bg-white border-x border-gray-200 dark:border-gray-700 dark:bg-gray-800',
        !scrub && 'text-gray-400',
      )}>
        {(() => {
          // At rest this is the series' own last value, not a separately
          // fetched quote. Two fetches with independent caches drift, and the
          // symptom is a header price that disagrees with where the line ends
          // — which reads as the chart being wrong.
          const shown = scrub?.value ?? history?.currentPrice ?? null
          if (shown == null) return null
          // Change is measured against the start of the visible window, so it
          // answers "what has it done over this period", which is the question
          // the chart is already asking.
          const base = chartData[0]?.value
          const delta = base ? ((shown - base) / base) * 100 : null
          return (
            <>
              <span className="text-sm font-semibold text-gray-900 dark:text-white tabular-nums">
                ${shown.toFixed(2)}
              </span>
              {delta != null && (
                <span className={clsx(
                  'text-[11px] font-medium tabular-nums',
                  delta >= 0 ? 'text-green-600' : 'text-red-600',
                )}>
                  {delta >= 0 ? '+' : ''}{delta.toFixed(2)}%
                </span>
              )}
              <span className="ml-auto text-[10px] text-gray-400 tabular-nums">
                {scrub
                  ? new Date(scrub.timestamp).toLocaleDateString([], {
                      month: 'short', day: 'numeric',
                      ...(selectedTimeframe === '1D' ? { hour: 'numeric', minute: '2-digit' } : {}),
                    })
                  : selectedTimeframe}
              </span>
            </>
          )
        })()}
      </div>

      {/* Chart container.

          Touch-end lives here rather than on the chart: Recharts' categorical
          charts expose mouse handlers but not touch ones, so without this the
          readout stayed frozen on the last point after the finger lifted. */}
      <div
        className="flex-1 relative bg-white rounded-b-xl overflow-hidden border border-t-0 border-gray-200 dark:border-gray-700 dark:bg-gray-800"
        onTouchEnd={() => setScrub(null)}
        onTouchCancel={() => setScrub(null)}
      >
        {historyLoading ? (
          <div className="w-full h-full flex items-center justify-center">
            <Loader2 className="h-8 w-8 text-gray-400 animate-spin" />
          </div>
        ) : chartData.length === 0 ? (
          <div className="w-full h-full flex items-center justify-center text-gray-400">
            No data available
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              margin={{ top: 12, right: 0, left: 0, bottom: 0 }}
              onMouseMove={(state: any) => {
                const p = state?.activePayload?.[0]?.payload
                if (p && typeof p.value === 'number') {
                  setScrub({ value: p.value, timestamp: p.timestamp })
                }
              }}
              onMouseLeave={() => setScrub(null)}
            >
              <defs>
                <linearGradient id={`gradient-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={chartColor} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={chartColor} stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="timestamp"
                tickFormatter={(timestamp) => {
                  const d = new Date(timestamp)
                  if (selectedTimeframe === '1D') {
                    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  }
                  if (selectedTimeframe === '5D' || selectedTimeframe === '1M') {
                    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
                  }
                  return d.toLocaleDateString([], { month: 'short', year: '2-digit' })
                }}
                tick={{ fontSize: 10, fill: '#9ca3af' }}
                tickLine={false}
                axisLine={false}
                  minTickGap={56}
                  interval="preserveStartEnd"
              />
              {/* Hidden Y axis, Yahoo-style: the price is already the headline
                    above, so dropping the gutter gives the series the full
                    width — which is what makes the shape readable at this
                    size. Still auto-scales to the data. */}
                <YAxis domain={['auto', 'auto']} hide />
              {/* Crosshair only — the readout lives above the plot. Recharts
                  still needs a Tooltip mounted to compute the active point and
                  draw the cursor; rendering null content is what removes the
                  box without losing either. */}
              <Tooltip
                cursor={{ stroke: '#9ca3af', strokeWidth: 1, strokeDasharray: '3 3' }}
                content={() => null}
                isAnimationActive={false}
              />
              {stats && (
                <ReferenceLine
                  y={chartData[0]?.value}
                  stroke="#d1d5db"
                  strokeDasharray="3 3"
                  strokeWidth={1}
                />
              )}
              <Area
                type="monotone"
                dataKey="value"
                stroke={chartColor}
                strokeWidth={2}
                fill={`url(#gradient-${symbol})`}
                dot={false}
                activeDot={{ r: 4, fill: chartColor }}
              />
              {/* Event marker (e.g., when trade idea was created) */}
              {eventDataPoint && (
                <>
                  <ReferenceLine
                    x={eventDataPoint.timestamp}
                    stroke="#8b5cf6"
                    strokeDasharray="4 4"
                    strokeWidth={2}
                    label={{
                      value: eventLabel || 'Event',
                      position: 'top',
                      fill: '#8b5cf6',
                      fontSize: 11,
                      fontWeight: 600
                    }}
                  />
                  <ReferenceDot
                    x={eventDataPoint.timestamp}
                    y={eventDataPoint.value}
                    r={6}
                    fill="#8b5cf6"
                    stroke="#fff"
                    strokeWidth={2}
                  />
                </>
              )}

              {/* The point under the finger. Without it the crosshair says
                  which x you are on but not where the series actually sits at
                  that x, which is the number the readout above is quoting. */}
              {scrub && (
                <ReferenceDot
                  x={scrub.timestamp}
                  y={scrub.value}
                  r={4}
                  fill={chartColor}
                  stroke="#fff"
                  strokeWidth={2}
                  isFront
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

export default ReelsChartPanel
