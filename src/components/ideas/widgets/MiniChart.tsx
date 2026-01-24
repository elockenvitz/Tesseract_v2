import React, { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts'
import { TrendingUp, TrendingDown, Minus, BarChart3 } from 'lucide-react'
import { clsx } from 'clsx'
import { financialDataService } from '../../../lib/financial-data/browser-client'
import { ChartDataAdapter } from '../../charts/utils/dataAdapter'

interface MiniChartProps {
  symbol: string
  height?: number
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
  // Fetch current quote
  const { data: quote, isLoading } = useQuery({
    queryKey: ['mini-chart-quote', symbol],
    queryFn: async () => {
      try {
        const quote = await financialDataService.getQuote(symbol)
        return quote
      } catch {
        return null
      }
    },
    staleTime: 60000,
    refetchOnWindowFocus: false
  })

  // Generate chart data
  const chartData = useMemo(() => {
    if (!quote) return []
    return ChartDataAdapter.generateHistoricalData(symbol, quote, days)
  }, [symbol, quote, days])

  const isPositive = quote ? quote.change >= 0 : true
  const chartColor = isPositive ? '#10b981' : '#ef4444'

  if (isLoading) {
    return (
      <div className={clsx('animate-pulse', className)}>
        <div className="h-[60px] bg-gray-100 rounded" />
      </div>
    )
  }

  if (!quote || chartData.length === 0) {
    return (
      <div className={clsx(
        'flex items-center justify-center h-[60px] bg-gray-50 rounded text-gray-400',
        className
      )}>
        <BarChart3 className="h-5 w-5 mr-2" />
        <span className="text-xs">No data</span>
      </div>
    )
  }

  return (
    <div className={clsx('space-y-1', className)}>
      {/* Price and change */}
      {(showPrice || showChange) && (
        <div className="flex items-center justify-between text-sm">
          {showPrice && (
            <span className="font-semibold text-gray-900">
              ${quote.price.toFixed(2)}
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
              {isPositive ? '+' : ''}{quote.changePercent.toFixed(2)}%
            </span>
          )}
        </div>
      )}

      {/* Sparkline chart */}
      <div style={{ height }}>
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
