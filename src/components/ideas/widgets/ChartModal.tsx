import React, { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { clsx } from 'clsx'
import {
  X, TrendingUp, TrendingDown, BarChart3, Maximize2, Minimize2,
  ExternalLink
} from 'lucide-react'
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { financialDataService } from '../../../lib/financial-data/browser-client'
import { ChartDataAdapter } from '../../charts/utils/dataAdapter'

interface ChartModalProps {
  symbol: string
  companyName?: string
  isOpen: boolean
  onClose: () => void
  onNavigateToAsset?: (symbol: string) => void
}

type Timeframe = '1D' | '5D' | '1M' | '3M' | '6M' | '1Y' | 'YTD'

const timeframes: { value: Timeframe; label: string; days: number }[] = [
  { value: '1D', label: '1D', days: 1 },
  { value: '5D', label: '5D', days: 5 },
  { value: '1M', label: '1M', days: 30 },
  { value: '3M', label: '3M', days: 90 },
  { value: '6M', label: '6M', days: 180 },
  { value: '1Y', label: '1Y', days: 365 },
  { value: 'YTD', label: 'YTD', days: -1 } // Special case
]

export function ChartModal({
  symbol,
  companyName,
  isOpen,
  onClose,
  onNavigateToAsset
}: ChartModalProps) {
  const [selectedTimeframe, setSelectedTimeframe] = useState<Timeframe>('1Y')
  const [isExpanded, setIsExpanded] = useState(false)

  // Fetch quote data
  const { data: quote, isLoading } = useQuery({
    queryKey: ['chart-modal-quote', symbol],
    queryFn: async () => {
      try {
        return await financialDataService.getQuote(symbol)
      } catch {
        return null
      }
    },
    enabled: isOpen,
    staleTime: 60000
  })

  // Generate chart data based on timeframe
  const chartData = useMemo(() => {
    if (!quote) return []

    let days: number
    if (selectedTimeframe === 'YTD') {
      days = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / (1000 * 60 * 60 * 24))
    } else if (selectedTimeframe === '1D') {
      // For 1D, use intraday data
      return ChartDataAdapter.generateIntradayData(quote, 24)
    } else {
      days = timeframes.find(t => t.value === selectedTimeframe)?.days || 365
    }

    return ChartDataAdapter.generateHistoricalData(symbol, quote, days)
  }, [symbol, quote, selectedTimeframe])

  // Calculate stats
  const stats = useMemo(() => {
    if (chartData.length < 2) return null

    const firstValue = chartData[0]?.value || 0
    const lastValue = chartData[chartData.length - 1]?.value || 0
    const change = lastValue - firstValue
    const changePercent = (change / firstValue) * 100

    const high = Math.max(...chartData.map(d => d.value))
    const low = Math.min(...chartData.map(d => d.value))

    return {
      change,
      changePercent,
      high,
      low,
      isPositive: change >= 0
    }
  }, [chartData])

  // Close on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = ''
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const chartColor = stats?.isPositive ? '#10b981' : '#ef4444'
  const chartColorLight = stats?.isPositive ? '#d1fae5' : '#fee2e2'

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className={clsx(
          'relative bg-white rounded-xl shadow-2xl overflow-hidden transition-all duration-200',
          isExpanded ? 'w-full h-full max-w-none max-h-none m-0' : 'w-full max-w-2xl'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">${symbol}</h2>
              {companyName && (
                <p className="text-sm text-gray-500">{companyName}</p>
              )}
            </div>

            {quote && (
              <div className="flex items-center gap-4 ml-4 pl-4 border-l border-gray-300">
                <span className="text-lg font-semibold">${quote.price.toFixed(2)}</span>
                {stats && (
                  <span className={clsx(
                    'flex items-center text-sm font-medium',
                    stats.isPositive ? 'text-green-600' : 'text-red-600'
                  )}>
                    {stats.isPositive ? <TrendingUp className="h-4 w-4 mr-1" /> : <TrendingDown className="h-4 w-4 mr-1" />}
                    {stats.isPositive ? '+' : ''}{stats.changePercent.toFixed(2)}%
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {onNavigateToAsset && (
              <button
                onClick={() => onNavigateToAsset(symbol)}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                title="View full details"
              >
                <ExternalLink className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              title={isExpanded ? 'Minimize' : 'Maximize'}
            >
              {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <button
              onClick={onClose}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Timeframe selector */}
        <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-100 bg-white">
          {timeframes.map(tf => (
            <button
              key={tf.value}
              onClick={() => setSelectedTimeframe(tf.value)}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                selectedTimeframe === tf.value
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              )}
            >
              {tf.label}
            </button>
          ))}
        </div>

        {/* Chart */}
        <div className={clsx('p-4', isExpanded ? 'h-[calc(100%-180px)]' : 'h-80')}>
          {isLoading ? (
            <div className="w-full h-full flex items-center justify-center">
              <div className="animate-pulse text-gray-400">Loading chart data...</div>
            </div>
          ) : chartData.length === 0 ? (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-center text-gray-400">
                <BarChart3 className="h-12 w-12 mx-auto mb-2" />
                <p>No data available</p>
              </div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={`gradient-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={chartColor} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={chartColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  tickFormatter={(date) => {
                    const d = new Date(date)
                    if (selectedTimeframe === '1D') {
                      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    }
                    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
                  }}
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  tickLine={false}
                  axisLine={{ stroke: '#e5e7eb' }}
                  minTickGap={50}
                />
                <YAxis
                  domain={['auto', 'auto']}
                  tickFormatter={(value) => `$${value.toFixed(0)}`}
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  tickLine={false}
                  axisLine={false}
                  width={50}
                />
                <Tooltip
                  formatter={(value: number) => [`$${value.toFixed(2)}`, 'Price']}
                  labelFormatter={(date) => new Date(date).toLocaleDateString([], {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric'
                  })}
                  contentStyle={{
                    backgroundColor: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                  }}
                />
                {stats && (
                  <ReferenceLine
                    y={chartData[0]?.value}
                    stroke="#9ca3af"
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
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Stats footer */}
        {stats && (
          <div className="grid grid-cols-4 gap-4 px-4 py-3 bg-gray-50 border-t border-gray-200">
            <div>
              <p className="text-xs text-gray-500">Period Change</p>
              <p className={clsx('text-sm font-medium', stats.isPositive ? 'text-green-600' : 'text-red-600')}>
                {stats.isPositive ? '+' : ''}{stats.change.toFixed(2)} ({stats.isPositive ? '+' : ''}{stats.changePercent.toFixed(2)}%)
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Period High</p>
              <p className="text-sm font-medium text-gray-900">${stats.high.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Period Low</p>
              <p className="text-sm font-medium text-gray-900">${stats.low.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Data Points</p>
              <p className="text-sm font-medium text-gray-900">{chartData.length}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}

// Button component that opens the chart modal
interface ChartButtonProps {
  symbol: string
  companyName?: string
  onNavigateToAsset?: (symbol: string) => void
  className?: string
  size?: 'sm' | 'md'
}

export function ChartButton({
  symbol,
  companyName,
  onNavigateToAsset,
  className,
  size = 'sm'
}: ChartButtonProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation()
          setIsOpen(true)
        }}
        className={clsx(
          'text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors',
          size === 'sm' ? 'p-1.5' : 'p-2',
          className
        )}
        title={`View ${symbol} chart`}
      >
        <BarChart3 className={size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'} />
      </button>

      <ChartModal
        symbol={symbol}
        companyName={companyName}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onNavigateToAsset={onNavigateToAsset}
      />
    </>
  )
}

export default ChartModal
