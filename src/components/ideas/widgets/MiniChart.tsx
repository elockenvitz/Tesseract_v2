import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts'
import { TrendingUp, TrendingDown, Minus, BarChart3 } from 'lucide-react'
import { clsx } from 'clsx'
import { usePriceHistory, timeframeForDays } from '../../../hooks/usePriceHistory'

interface MiniChartProps {
  symbol: string
  /** px number or CSS length (e.g. '100%') to stretch inside a flex parent */
  height?: number | string
  days?: number
  showPrice?: boolean
  showChange?: boolean
  className?: string
}

export function MiniChart({
  symbol,
  height = 60,
  days = 7,
  showPrice = true,
  showChange = true,
  className
}: MiniChartProps) {
  // Real closes, one request supplying both the line and the price beside it.
  // This drew ChartDataAdapter.generateHistoricalData — a seeded random walk —
  // next to a genuine quote, so the number was real and the shape was invented.
  const { data: history, isLoading } = usePriceHistory(symbol, timeframeForDays(days))
  const chartData = history?.points ?? []
  const quote = history?.currentPrice ?? null

  // Coloured by the move across the window being drawn, not the day's change.
  // A seven-day line tinted by today's direction contradicts itself whenever
  // the two disagree.
  const isPositive = (history?.windowChange ?? 0) >= 0
  const chartColor = isPositive ? '#10b981' : '#ef4444'

  if (isLoading) {
    return (
      <div className={clsx('animate-pulse', className)}>
        <div className="h-[60px] bg-gray-100 rounded dark:bg-gray-800" />
      </div>
    )
  }

  if (!quote || chartData.length === 0) {
    return (
      <div className={clsx(
        'flex items-center justify-center h-[60px] bg-gray-50 rounded text-gray-400 dark:bg-gray-900',
        className
      )}>
        <BarChart3 className="h-5 w-5 mr-2" />
        <span className="text-xs">No data</span>
      </div>
    )
  }

  return (
    <div
      className={clsx('flex flex-col', className)}
      style={{ height }}
    >
      {/* Price and change */}
      {(showPrice || showChange) && (
        <div className="flex items-center justify-between text-sm flex-shrink-0 mb-1">
          {showPrice && (
            <span className="font-semibold text-gray-900 dark:text-white">
              ${quote.toFixed(2)}
            </span>
          )}
          {showChange && (
            <span className={clsx(
              'flex items-center text-xs font-medium',
              isPositive ? 'text-green-600' : 'text-red-600'
            )}>
              {isPositive ? (
                <TrendingUp className="h-3 w-3 mr-0.5" />
              ) : (
                <TrendingDown className="h-3 w-3 mr-0.5" />
              )}
              {isPositive ? '+' : ''}{(history?.windowChangePercent ?? 0).toFixed(2)}%
            </span>
          )}
        </div>
      )}

      {/* Sparkline chart — fills remaining space */}
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <YAxis domain={['dataMin', 'dataMax']} hide />
            <Line
              type="monotone"
              dataKey="value"
              stroke={chartColor}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default MiniChart
