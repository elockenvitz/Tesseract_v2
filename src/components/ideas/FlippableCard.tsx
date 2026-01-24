import React, { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { clsx } from 'clsx'
import {
  X, TrendingUp, TrendingDown, BarChart3, RotateCcw
} from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { financialDataService } from '../../lib/financial-data/browser-client'
import { ChartDataAdapter } from '../charts/utils/dataAdapter'

interface FlippableCardProps {
  children: React.ReactNode
  symbol?: string
  companyName?: string
  isFlipped: boolean
  onFlip: () => void
  className?: string
  size?: 'small' | 'medium' | 'large'
}

type Timeframe = '1M' | '3M' | '6M' | '1Y'

const timeframes: { value: Timeframe; label: string; days: number }[] = [
  { value: '1M', label: '1M', days: 30 },
  { value: '3M', label: '3M', days: 90 },
  { value: '6M', label: '6M', days: 180 },
  { value: '1Y', label: '1Y', days: 365 },
]

export function FlippableCard({
  children,
  symbol,
  companyName,
  isFlipped,
  onFlip,
  className,
  size = 'medium'
}: FlippableCardProps) {
  const [selectedTimeframe, setSelectedTimeframe] = useState<Timeframe>('1Y')

  // Fetch quote data only when flipped
  const { data: quote, isLoading } = useQuery({
    queryKey: ['flippable-chart-quote', symbol],
    queryFn: async () => {
      if (!symbol) return null
      try {
        return await financialDataService.getQuote(symbol)
      } catch {
        return null
      }
    },
    enabled: isFlipped && !!symbol,
    staleTime: 60000
  })

  // Generate chart data
  const chartData = useMemo(() => {
    if (!quote || !symbol) return []
    const days = timeframes.find(t => t.value === selectedTimeframe)?.days || 365
    return ChartDataAdapter.generateHistoricalData(symbol, quote, days)
  }, [symbol, quote, selectedTimeframe])

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

  const chartColor = stats?.isPositive ? '#10b981' : '#ef4444'

  // Container height based on card size
  const containerHeight = size === 'large' ? 'min-h-72' : size === 'medium' ? 'h-64' : 'h-56'

  return (
    <div className={clsx('w-full', containerHeight, className)} style={{ perspective: '1000px' }}>
      <div
        className="relative w-full h-full transition-transform duration-500"
        style={{
          transformStyle: 'preserve-3d',
          transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)'
        }}
      >
        {/* Front side */}
        <div
          className="absolute inset-0 w-full h-full"
          style={{
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden'
          }}
        >
          {children}
        </div>

        {/* Back side - Chart */}
        <div
          className={clsx(
            'absolute inset-0 bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden flex flex-col',
            size === 'small' ? 'p-2' : size === 'medium' ? 'p-3' : 'p-4'
          )}
          style={{
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)'
          }}
        >
        {/* Header */}
        <div className="flex items-center justify-between mb-2 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900">${symbol}</span>
            {quote && (
              <span className="text-sm text-gray-600">${quote.price.toFixed(2)}</span>
            )}
            {stats && (
              <span className={clsx(
                'flex items-center text-xs font-medium',
                stats.isPositive ? 'text-green-600' : 'text-red-600'
              )}>
                {stats.isPositive ? <TrendingUp className="h-3 w-3 mr-0.5" /> : <TrendingDown className="h-3 w-3 mr-0.5" />}
                {stats.isPositive ? '+' : ''}{stats.changePercent.toFixed(1)}%
              </span>
            )}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onFlip()
            }}
            className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
            title="Flip back"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>

        {/* Timeframe selector */}
        <div className="flex items-center gap-1 mb-2 flex-shrink-0">
          {timeframes.map(tf => (
            <button
              key={tf.value}
              onClick={(e) => {
                e.stopPropagation()
                setSelectedTimeframe(tf.value)
              }}
              className={clsx(
                'px-2 py-0.5 rounded text-xs font-medium transition-colors',
                selectedTimeframe === tf.value
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-500 hover:bg-gray-100'
              )}
            >
              {tf.label}
            </button>
          ))}
        </div>

        {/* Chart - fills remaining space */}
        <div
          className="w-full"
          style={{ height: `calc(100% - ${size === 'small' ? '56px' : size === 'medium' ? '80px' : '96px'})` }}
        >
          {isLoading ? (
            <div className="w-full h-full flex items-center justify-center">
              <div className="animate-pulse text-gray-400 text-sm">Loading chart...</div>
            </div>
          ) : chartData.length === 0 ? (
            <div className="w-full h-full flex items-center justify-center text-gray-400 flex-col gap-2">
              <BarChart3 className="h-8 w-8" />
              <span className="text-xs">No data for {symbol}</span>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id={`gradient-flip-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={chartColor} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={chartColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  tickFormatter={(date) => {
                    const d = new Date(date)
                    return d.toLocaleDateString([], { month: 'short' })
                  }}
                  tick={{ fontSize: 9, fill: '#9ca3af' }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={40}
                />
                <YAxis
                  domain={['auto', 'auto']}
                  tick={{ fontSize: 9, fill: '#9ca3af' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `$${v.toFixed(0)}`}
                  width={35}
                />
                <Tooltip
                  formatter={(value: number) => [`$${value.toFixed(2)}`, 'Price']}
                  labelFormatter={(date) => new Date(date).toLocaleDateString()}
                  contentStyle={{
                    backgroundColor: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    fontSize: '12px',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                  }}
                />
                <ReferenceLine
                  y={chartData[0]?.value}
                  stroke="#9ca3af"
                  strokeDasharray="2 2"
                  strokeWidth={1}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={chartColor}
                  strokeWidth={1.5}
                  fill={`url(#gradient-flip-${symbol})`}
                  dot={false}
                  activeDot={{ r: 3, fill: chartColor }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Stats footer */}
        {stats && size !== 'small' && (
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100 text-xs text-gray-500">
            <span>
              {selectedTimeframe}:
              <span className={clsx('ml-1 font-medium', stats.isPositive ? 'text-green-600' : 'text-red-600')}>
                {stats.isPositive ? '+' : ''}{stats.change.toFixed(2)}
              </span>
            </span>
            {companyName && (
              <span className="truncate max-w-[120px]">{companyName}</span>
            )}
          </div>
        )}
        </div>
      </div>
    </div>
  )
}

export default FlippableCard
