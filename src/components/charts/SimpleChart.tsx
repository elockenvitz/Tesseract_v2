import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts'
import { BarChart3 } from 'lucide-react'
import { usePriceHistory } from '../../hooks/usePriceHistory'

interface SimpleChartProps {
  symbol: string
  height?: number
  className?: string
}

export function SimpleChart({ symbol, height = 400, className = '' }: SimpleChartProps) {
  // Real closes, one request supplying both the line and the price beside it.
  // This drew ChartDataAdapter.generateHistoricalData — a seeded random walk —
  // next to a genuine quote, so the number was real and the shape invented.
  const { data: history, isLoading } = usePriceHistory(symbol, '1M')
  const chartData = history?.points ?? []

  if (isLoading) {
    return (
      <div className={`w-full ${className}`} style={{ height }}>
        <div className="animate-pulse bg-gray-200 rounded-lg h-full flex items-center justify-center">
          <div className="text-gray-500 dark:text-gray-400">Loading chart data...</div>
        </div>
      </div>
    )
  }

  if (chartData.length === 0) {
    return (
      <div className={`w-full ${className}`} style={{ height }}>
        <div className="bg-gray-50 rounded-lg h-full flex items-center justify-center dark:bg-gray-900">
          <div className="text-center">
            <BarChart3 className="h-12 w-12 text-gray-400 mx-auto mb-2" />
            <div className="text-gray-500 dark:text-gray-400">No chart data available</div>
            <div className="text-sm text-gray-400">Financial data for {symbol} could not be loaded</div>
          </div>
        </div>
      </div>
    )
  }

  const formatPrice = (value: number) => `$${value.toFixed(2)}`
  const formatDate = (dateStr: string | number) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString()
  }

  return (
    <div className={`w-full space-y-4 ${className}`}>
      {/* Chart Header */}
      <div className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-lg dark:border-gray-700 dark:bg-gray-800">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{symbol}</h3>
          <div className="text-sm text-gray-500 dark:text-gray-400">30-Day Price Chart</div>
        </div>
        <div className="text-sm">
          <div>
            <span className="text-gray-600 dark:text-gray-400">Current:</span>
            <span className="ml-1 font-medium">${(history?.currentPrice ?? 0).toFixed(2)}</span>
          </div>
          {/* The move over the 30 days being drawn, so the figure and the line
              describe the same period. */}
          <div className={`${(history?.windowChange ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {(history?.windowChange ?? 0) >= 0 ? '+' : ''}${(history?.windowChange ?? 0).toFixed(2)}
            ({(history?.windowChange ?? 0) >= 0 ? '+' : ''}{(history?.windowChangePercent ?? 0).toFixed(2)}%)
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 dark:border-gray-700 dark:bg-gray-800">
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="timestamp"
              tickFormatter={formatDate}
              stroke="#6b7280"
            />
            <YAxis
              tickFormatter={formatPrice}
              stroke="#6b7280"
            />
            <Tooltip
              formatter={(value: number) => [formatPrice(value), 'Price']}
              labelFormatter={formatDate}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: '#3b82f6' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Chart Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-3 bg-gray-50 rounded-lg text-sm dark:bg-gray-900">
        <div>
          <div className="text-gray-600 dark:text-gray-400">Period</div>
          <div className="font-medium">30 Days</div>
        </div>
        <div>
          <div className="text-gray-600 dark:text-gray-400">Change</div>
          <div className={`font-medium ${
            (chartData[chartData.length - 1]?.value || 0) >= (chartData[0]?.value || 0)
              ? 'text-green-600'
              : 'text-red-600'
          }`}>
            {(() => {
              const firstValue = chartData[0]?.value || 0
              const lastValue = chartData[chartData.length - 1]?.value || 0
              const change = ((lastValue - firstValue) / firstValue) * 100
              return `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`
            })()}
          </div>
        </div>
        <div>
          <div className="text-gray-600 dark:text-gray-400">High</div>
          <div className="font-medium">
            ${Math.max(...chartData.map(d => d.value)).toFixed(2)}
          </div>
        </div>
        <div>
          <div className="text-gray-600 dark:text-gray-400">Low</div>
          <div className="font-medium">
            ${Math.min(...chartData.map(d => d.value)).toFixed(2)}
          </div>
        </div>
      </div>
    </div>
  )
}