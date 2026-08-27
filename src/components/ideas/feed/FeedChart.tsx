/**
 * FeedChart — Inline chart for feed cards.
 *
 * Always shows timeframe selector and expand-to-charting button.
 */

import React, { useId, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { BarChart3, Maximize2 } from 'lucide-react'
import { financialDataService } from '../../../lib/financial-data/browser-client'
import { usePriceHistory, timeframeForDays } from '../../../hooks/usePriceHistory'
import { ChartScrubSurface } from '../../charts/ChartScrubSurface'

type Timeframe = '1W' | '1M' | '3M' | '6M' | '1Y'

const TIMEFRAMES: { value: Timeframe; label: string; days: number }[] = [
  { value: '1W', label: '1W', days: 7 },
  { value: '1M', label: '1M', days: 30 },
  { value: '3M', label: '3M', days: 90 },
  { value: '6M', label: '6M', days: 180 },
  { value: '1Y', label: '1Y', days: 365 },
]

interface FeedChartProps {
  symbol: string
  height?: number
  showTimeframes?: boolean
  defaultTimeframe?: Timeframe
  /** Called when user clicks expand — opens charting tab */
  onExpand?: (symbol: string) => void
  className?: string
}

/** Shared quote hook — cards use this for MetricRow + chart data */
export function useFeedQuote(symbol: string | undefined) {
  return useQuery({
    queryKey: ['feed-chart-quote', symbol],
    queryFn: async () => {
      if (!symbol) return null
      try { return await financialDataService.getQuote(symbol) } catch { return null }
    },
    enabled: !!symbol,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
}

export const FeedChart = React.memo(function FeedChart({
  symbol,
  height = 140,
  showTimeframes = true,
  defaultTimeframe = '3M',
  onExpand,
  className,
}: FeedChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>(defaultTimeframe)
  /**
   * A gradient id per mounted chart, not per symbol.
   *
   * It was `fcg-${symbol}-${timeframe}`, and a feed routinely carries two
   * cards about the same name — a signal and the idea it came from. Two
   * identical ids in one document means every reference resolves to the FIRST
   * definition, so a falling chart filled with the rising colour of whichever
   * card mounted earlier. `useId` is unique per instance by construction.
   */
  const gradientId = useId().replace(/:/g, '')

  // Real closes. This drew ChartDataAdapter.generateHistoricalData — a seeded
  // random walk anchored to the quote — so only the final point was ever real.
  const days = TIMEFRAMES.find(t => t.value === timeframe)?.days || 90
  const { data: history, isLoading } = usePriceHistory(symbol, timeframeForDays(days))
  const chartData = history?.points ?? []

  const stats = useMemo(() => {
    if (chartData.length < 2) return null
    const first = chartData[0]?.value || 0
    const last = chartData[chartData.length - 1]?.value || 0
    return { isPositive: last >= first }
  }, [chartData])

  const chartColor = stats?.isPositive ? '#10b981' : '#ef4444'

  if (isLoading) return <div className={clsx('animate-pulse bg-gray-50 rounded dark:bg-gray-900', className)} style={{ height }} />
  if (chartData.length === 0) return <div className={className} style={{ height: 0 }} />

  return (
    <div className={clsx('group/chart relative', className)}>
      {/* Controls bar — timeframes + expand */}
      <div className="flex items-center justify-between px-3 pb-0.5">
        {showTimeframes ? (
          <div className="flex items-center gap-0.5">
            {TIMEFRAMES.map(tf => (
              <button key={tf.value} onClick={e => { e.stopPropagation(); setTimeframe(tf.value) }}
                className={clsx('px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors',
                  timeframe === tf.value ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-300 dark:hover:bg-gray-700')}>
                {tf.label}
              </button>
            ))}
          </div>
        ) : <div />}

        {onExpand && (
          <button
            onClick={e => { e.stopPropagation(); onExpand(symbol) }}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors opacity-0 group-hover/chart:opacity-100 dark:hover:text-gray-200 dark:hover:bg-gray-700"
            title="Open in Charting"
          >
            <Maximize2 className="w-3 h-3" />
            Expand
          </button>
        )}
      </div>

      {/* Chart.

          `ChartScrubSurface` owns every touch over the plot: Recharts' own
          touch path leaves its tooltip frozen on the last point after the
          finger lifts, because the only thing that clears it is a `mouseleave`
          a finger never sends. It also gates inspection behind a press-and-
          hold, so scrolling the feed past a card no longer drags a crosshair. */}
      <ChartScrubSurface className="px-2" style={{ height }} resetKey={`${symbol}:${timeframe}`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 2, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={chartColor} stopOpacity={0.3} />
                <stop offset="95%" stopColor={chartColor} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" tickFormatter={d => new Date(d).toLocaleDateString([], { month: 'short' })}
              tick={{ fontSize: 9, fill: '#d1d5db' }} tickLine={false} axisLine={false} minTickGap={50} />
            <YAxis domain={['auto', 'auto']} tick={{ fontSize: 9, fill: '#d1d5db' }} tickLine={false} axisLine={false}
              tickFormatter={v => `$${v.toFixed(0)}`} width={36} />
            <Tooltip formatter={(v: number) => [`$${v.toFixed(2)}`, 'Price']} labelFormatter={d => new Date(d).toLocaleDateString()}
              contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '11px', boxShadow: '0 2px 4px rgba(0,0,0,0.08)', padding: '6px 10px' }} />
            <ReferenceLine y={chartData[0]?.value} stroke="#e5e7eb" strokeDasharray="2 2" strokeWidth={1} />
            <Area type="monotone" dataKey="value" stroke={chartColor} strokeWidth={2} fill={`url(#${gradientId})`} dot={false} activeDot={{ r: 4, fill: chartColor }} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartScrubSurface>
    </div>
  )
})
