import React from 'react'
import { useQuery } from '@tanstack/react-query'
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
import { financialDataService } from '../../lib/financial-data/browser-client'
import { ChartDataAdapter } from './utils/dataAdapter'

interface SimpleChartProps {
  symbol: string
  height?: number
  className?: string
}

export function SimpleChart({ symbol, height = 400, className = '' }: SimpleChartProps) {
  // Fetch current quote
  const { data: currentQuote, isLoading } = useQuery({
    queryKey: ['simple-chart-quote', symbol],
    queryFn: async () => {
      const quote = await financialDataService.getQuote(symbol)
      return quote
    },
    refetchInterval: 30000,
    staleTime: 15000
  })

  // Generate chart data
  const chartData = React.useMemo(() => {
    if (!currentQuote) return []
    return ChartDataAdapter.generateHistoricalData(symbol, currentQuote, 30)
  }, [symbol, currentQuote])

  if (isLoading) {
    return (
      <div className={`w-full ${className}`} style={{ height }}>
        <div className="animate-pulse bg-gray-200 rounded-lg h-full flex items-center justify-center">
          <div className="text-gray-500">Loading chart data...</div>
        </div>
      </div>
    )
  }

  if (!currentQuote || chartData.length === 0) {
    return (
      <div className={`w-full ${className}`} style={{ height }}>
        <div className="bg-gray-50 rounded-lg h-full flex items-center justify-center">
          <div className="text-center">
            <BarChart3 className="h-12 w-12 text-gray-400 mx-auto mb-2" />
            <div className="text-gray-500">No chart data available</div>
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
      <div className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-lg">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{symbol}</h3>
          <div className="text-sm text-gray-500">30-Day Price Chart</div>
        </div>
        <div className="text-sm">
          <div>
            <span className="text-gray-600">Current:</span>
            <span className="ml-1 font-medium">${currentQuote.price.toFixed(2)}</span>
          </div>
          <div className={`${currentQuote.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {currentQuote.change >= 0 ? '+' : ''}${currentQuote.change.toFixed(2)}
            ({currentQuote.change >= 0 ? '+' : ''}{currentQuote.changePercent.toFixed(2)}%)
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-3 bg-gray-50 rounded-lg text-sm">
        <div>
          <div className="text-gray-600">Period</div>
          <div className="font-medium">30 Days</div>
        </div>
        <div>
          <div className="text-gray-600">Change</div>
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
          <div className="text-gray-600">High</div>
          <div className="font-medium">
            ${Math.max(...chartData.map(d => d.value)).toFixed(2)}
          </div>
        </div>
        <div>
          <div className="text-gray-600">Low</div>
          <div className="font-medium">
            ${Math.min(...chartData.map(d => d.value)).toFixed(2)}
          </div>
        </div>
      </div>
    </div>
  )
}