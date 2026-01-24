import React, { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { clsx } from 'clsx'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot
} from 'recharts'
import { TrendingUp, TrendingDown, BarChart3, Loader2 } from 'lucide-react'
import { financialDataService } from '../../lib/financial-data/browser-client'
import { ChartDataAdapter } from '../charts/utils/dataAdapter'

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
  eventDate?: string  // ISO date string for when an event occurred (e.g., trade idea created)
  eventLabel?: string // Label for the event
}

export function ReelsChartPanel({
  symbol,
  companyName,
  onOpenFullChart,
  eventDate,
  eventLabel
}: ReelsChartPanelProps) {
  const [selectedTimeframe, setSelectedTimeframe] = useState<Timeframe>('1Y')

  // Fetch quote data
  const { data: quote, isLoading: quoteLoading } = useQuery({
    queryKey: ['reels-chart-quote', symbol],
    queryFn: async () => {
      try {
        return await financialDataService.getQuote(symbol)
      } catch {
        return null
      }
    },
    staleTime: 60000
  })

  // Generate chart data based on timeframe
  const chartData = useMemo(() => {
    if (!quote) return []

    const days = timeframes.find(t => t.value === selectedTimeframe)?.days || 365

    if (selectedTimeframe === '1D') {
      return ChartDataAdapter.generateIntradayData(quote, 24)
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
      <div className="flex items-center justify-between px-2 py-2 bg-white border-b border-gray-200 rounded-t-xl relative z-30">
        <div className="flex items-center gap-3">
          <div>
            <h3 className="text-lg font-bold text-gray-900">${symbol}</h3>
            {companyName && (
              <p className="text-xs text-gray-500">{companyName}</p>
            )}
          </div>

          {quote && stats && (
            <div className="flex items-center gap-2 pl-3 border-l border-gray-200">
              <span className="text-lg font-semibold text-gray-900">
                ${quote.price.toFixed(2)}
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
            className="flex items-center gap-1.5 px-3 py-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors text-sm"
            title="Open full chart"
          >
            <BarChart3 className="h-4 w-4" />
            <span>Full Chart</span>
          </button>
        )}
      </div>

      {/* Timeframe selector */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 bg-gray-50 border-b border-gray-200 relative z-30 overflow-x-auto">
        {timeframes.map(tf => (
          <button
            key={tf.value}
            onClick={(e) => {
              e.stopPropagation()
              setSelectedTimeframe(tf.value)
            }}
            className={clsx(
              'px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap',
              selectedTimeframe === tf.value
                ? 'bg-primary-100 text-primary-700'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            )}
          >
            {tf.label}
          </button>
        ))}
      </div>

      {/* Chart container */}
      <div className="flex-1 relative bg-white rounded-b-xl overflow-hidden border border-t-0 border-gray-200">
        {quoteLoading ? (
          <div className="w-full h-full flex items-center justify-center">
            <Loader2 className="h-8 w-8 text-gray-400 animate-spin" />
          </div>
        ) : chartData.length === 0 ? (
          <div className="w-full h-full flex items-center justify-center text-gray-400">
            No data available
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 25, right: 10, left: 0, bottom: 0 }}>
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
                axisLine={{ stroke: '#e5e7eb' }}
                minTickGap={40}
              />
              <YAxis
                domain={['auto', 'auto']}
                tickFormatter={(value) => `$${value.toFixed(0)}`}
                tick={{ fontSize: 10, fill: '#9ca3af' }}
                tickLine={false}
                axisLine={false}
                width={45}
              />
              <Tooltip
                formatter={(value: number) => [`$${value.toFixed(2)}`, 'Price']}
                labelFormatter={(timestamp) => new Date(timestamp).toLocaleDateString([], {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric'
                })}
                contentStyle={{
                  backgroundColor: 'white',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  color: '#1f2937',
                  fontSize: '12px',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                }}
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
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

export default ReelsChartPanel
