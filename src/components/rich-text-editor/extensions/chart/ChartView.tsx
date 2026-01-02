import React, { useState, useCallback, useMemo } from 'react'
import { NodeViewWrapper, NodeViewProps } from '@tiptap/react'
import { useQuery } from '@tanstack/react-query'
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend, ComposedChart,
  ReferenceLine
} from 'recharts'
import {
  TrendingUp, TrendingDown, BarChart3, Activity, Settings, RefreshCw,
  Maximize2, Minimize2, X, Clock, ChevronDown, MoreHorizontal
} from 'lucide-react'
import { clsx } from 'clsx'
import { format, subDays, subMonths, startOfYear } from 'date-fns'
import { financialDataService } from '../../../../lib/financial-data/browser-client'
import { ChartDataAdapter } from '../../../charts/utils/dataAdapter'
import type { ChartDataPoint } from '../../../charts/types'
import type { ChartType, ChartStyle, ChartTimeframe } from '../ChartExtension'

// Chart type icons and colors
const CHART_TYPE_CONFIG: Record<ChartType, { icon: React.ComponentType<{ className?: string }>; color: string; label: string }> = {
  price: { icon: TrendingUp, color: 'text-blue-600 bg-blue-50', label: 'Price' },
  volume: { icon: BarChart3, color: 'text-emerald-600 bg-emerald-50', label: 'Volume' },
  performance: { icon: Activity, color: 'text-purple-600 bg-purple-50', label: 'Performance' },
  comparison: { icon: TrendingUp, color: 'text-amber-600 bg-amber-50', label: 'Comparison' },
  technicals: { icon: Activity, color: 'text-violet-600 bg-violet-50', label: 'Technicals' }
}

const TIMEFRAME_OPTIONS: { value: ChartTimeframe; label: string }[] = [
  { value: '1D', label: '1D' },
  { value: '5D', label: '5D' },
  { value: '1M', label: '1M' },
  { value: '3M', label: '3M' },
  { value: '6M', label: '6M' },
  { value: '1Y', label: '1Y' },
  { value: 'YTD', label: 'YTD' }
]

const INDICATOR_COLORS = {
  sma20: '#3b82f6',
  sma50: '#10b981',
  sma200: '#ef4444',
  ema12: '#8b5cf6',
  ema26: '#ec4899'
}

interface ChartViewProps extends NodeViewProps {}

export function ChartView({ node, updateAttributes, deleteNode, selected }: ChartViewProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [localTimeframe, setLocalTimeframe] = useState<ChartTimeframe>(node.attrs.timeframe || '1M')

  const {
    chartType,
    chartStyle,
    symbol,
    assetName,
    comparisonSymbols,
    timeframe,
    indicators,
    height,
    showVolume,
    showGrid,
    showLegend,
    title,
    isLive,
    embeddedAt
  } = node.attrs

  // Fetch quote data
  const { data: quoteData, isLoading, error, refetch } = useQuery({
    queryKey: ['embedded-chart', symbol, localTimeframe],
    queryFn: async () => {
      if (!symbol) return null
      const quote = await financialDataService.getQuote(symbol)
      return quote
    },
    enabled: !!symbol && isLive,
    refetchInterval: isLive ? 60000 : false,
    staleTime: 30000
  })

  // Fetch comparison quotes if needed
  const { data: comparisonData } = useQuery({
    queryKey: ['embedded-chart-comparison', comparisonSymbols],
    queryFn: async () => {
      if (!comparisonSymbols?.length) return []
      const quotes = await Promise.all(
        comparisonSymbols.map((s: string) => financialDataService.getQuote(s))
      )
      return quotes
    },
    enabled: chartType === 'comparison' && comparisonSymbols?.length > 0
  })

  // Generate chart data
  const chartData = useMemo(() => {
    if (!quoteData) return []

    let days = 30
    switch (localTimeframe) {
      case '1D': days = 1; break
      case '5D': days = 5; break
      case '1M': days = 30; break
      case '3M': days = 90; break
      case '6M': days = 180; break
      case '1Y': days = 365; break
      case 'YTD':
        const now = new Date()
        days = Math.floor((now.getTime() - startOfYear(now).getTime()) / (1000 * 60 * 60 * 24))
        break
    }

    const data = ChartDataAdapter.generateHistoricalData(symbol, quoteData, days)

    // For performance chart, convert to percentage change
    if (chartType === 'performance') {
      const baseValue = data[0]?.value || 100
      return data.map(d => ({
        ...d,
        value: ((d.value - baseValue) / baseValue) * 100
      }))
    }

    // For volume chart
    if (chartType === 'volume') {
      return ChartDataAdapter.formatVolumeData(data)
    }

    return data
  }, [quoteData, symbol, localTimeframe, chartType])

  // Handle timeframe change
  const handleTimeframeChange = useCallback((tf: ChartTimeframe) => {
    setLocalTimeframe(tf)
    updateAttributes({ timeframe: tf })
  }, [updateAttributes])

  // Handle delete
  const handleDelete = useCallback(() => {
    deleteNode()
  }, [deleteNode])

  // Toggle expanded view
  const toggleExpanded = useCallback(() => {
    setIsExpanded(!isExpanded)
  }, [isExpanded])

  const chartConfig = CHART_TYPE_CONFIG[chartType as ChartType] || CHART_TYPE_CONFIG.price
  const ChartIcon = chartConfig.icon

  // Calculate price change
  const priceChange = useMemo(() => {
    if (!quoteData) return { value: 0, percent: 0, isPositive: true }
    const change = quoteData.regularMarketChange || 0
    const percent = quoteData.regularMarketChangePercent || 0
    return {
      value: change,
      percent: percent,
      isPositive: change >= 0
    }
  }, [quoteData])

  // Render the chart content
  const renderChart = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center h-full">
          <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      )
    }

    if (!symbol) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-gray-500 text-sm gap-2">
          <TrendingUp className="h-8 w-8 text-gray-300" />
          <span>No symbol specified</span>
          <span className="text-xs text-gray-400">Use .chart.price.AAPL to specify a symbol</span>
        </div>
      )
    }

    if (error || !chartData.length) {
      return (
        <div className="flex items-center justify-center h-full text-gray-500 text-sm">
          {error ? 'Failed to load chart data' : 'No data available'}
        </div>
      )
    }

    const chartHeight = isExpanded ? 400 : (height || 200)
    const dataKey = chartType === 'volume' ? 'volume' : 'value'
    const strokeColor = priceChange.isPositive ? '#10b981' : '#ef4444'
    const fillColor = priceChange.isPositive ? '#10b98120' : '#ef444420'

    return (
      <ResponsiveContainer width="100%" height={chartHeight}>
        {chartStyle === 'bar' || chartType === 'volume' ? (
          <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />}
            <XAxis
              dataKey="date"
              tickFormatter={(date) => format(new Date(date), localTimeframe === '1D' ? 'HH:mm' : 'MMM d')}
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              axisLine={{ stroke: '#e5e7eb' }}
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              axisLine={{ stroke: '#e5e7eb' }}
              tickFormatter={(v) => chartType === 'volume' ? `${(v / 1000000).toFixed(1)}M` : v.toFixed(0)}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
              labelFormatter={(date) => format(new Date(date), 'MMM d, yyyy HH:mm')}
              formatter={(value: number) => [
                chartType === 'volume' ? `${(value / 1000000).toFixed(2)}M` : value.toFixed(2),
                chartType === 'volume' ? 'Volume' : 'Price'
              ]}
            />
            {embeddedAt && (
              <ReferenceLine
                x={embeddedAt}
                stroke="#6366f1"
                strokeWidth={2}
                strokeDasharray="4 4"
                label={{ value: 'Embedded', position: 'top', fill: '#6366f1', fontSize: 10 }}
              />
            )}
            <Bar dataKey={dataKey} fill={strokeColor} radius={[2, 2, 0, 0]} />
          </BarChart>
        ) : chartStyle === 'area' ? (
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />}
            <XAxis
              dataKey="date"
              tickFormatter={(date) => format(new Date(date), localTimeframe === '1D' ? 'HH:mm' : 'MMM d')}
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              axisLine={{ stroke: '#e5e7eb' }}
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              axisLine={{ stroke: '#e5e7eb' }}
              domain={['auto', 'auto']}
              tickFormatter={(v) => chartType === 'performance' ? `${v.toFixed(1)}%` : `$${v.toFixed(0)}`}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
              labelFormatter={(date) => format(new Date(date), 'MMM d, yyyy')}
              formatter={(value: number) => [
                chartType === 'performance' ? `${value.toFixed(2)}%` : `$${value.toFixed(2)}`,
                symbol
              ]}
            />
            {embeddedAt && (
              <ReferenceLine
                x={embeddedAt}
                stroke="#6366f1"
                strokeWidth={2}
                strokeDasharray="4 4"
                label={{ value: 'Embedded', position: 'top', fill: '#6366f1', fontSize: 10 }}
              />
            )}
            <Area
              type="monotone"
              dataKey="value"
              stroke={strokeColor}
              fill={fillColor}
              strokeWidth={2}
            />
            {/* Technical indicators */}
            {indicators?.includes('sma20') && (
              <Area type="monotone" dataKey="sma20" stroke={INDICATOR_COLORS.sma20} fill="none" strokeWidth={1} dot={false} />
            )}
            {indicators?.includes('sma50') && (
              <Area type="monotone" dataKey="sma50" stroke={INDICATOR_COLORS.sma50} fill="none" strokeWidth={1} dot={false} />
            )}
          </AreaChart>
        ) : (
          <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />}
            <XAxis
              dataKey="date"
              tickFormatter={(date) => format(new Date(date), localTimeframe === '1D' ? 'HH:mm' : 'MMM d')}
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              axisLine={{ stroke: '#e5e7eb' }}
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              axisLine={{ stroke: '#e5e7eb' }}
              domain={['auto', 'auto']}
              tickFormatter={(v) => chartType === 'performance' ? `${v.toFixed(1)}%` : `$${v.toFixed(0)}`}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
              labelFormatter={(date) => format(new Date(date), 'MMM d, yyyy')}
              formatter={(value: number) => [
                chartType === 'performance' ? `${value.toFixed(2)}%` : `$${value.toFixed(2)}`,
                symbol
              ]}
            />
            {embeddedAt && (
              <ReferenceLine
                x={embeddedAt}
                stroke="#6366f1"
                strokeWidth={2}
                strokeDasharray="4 4"
                label={{ value: 'Embedded', position: 'top', fill: '#6366f1', fontSize: 10 }}
              />
            )}
            {showLegend && <Legend />}
            <Line
              type="monotone"
              dataKey="value"
              stroke={strokeColor}
              strokeWidth={2}
              dot={false}
              name={symbol}
            />
            {/* Technical indicators */}
            {indicators?.includes('sma20') && (
              <Line type="monotone" dataKey="sma20" stroke={INDICATOR_COLORS.sma20} strokeWidth={1} dot={false} name="SMA 20" />
            )}
            {indicators?.includes('sma50') && (
              <Line type="monotone" dataKey="sma50" stroke={INDICATOR_COLORS.sma50} strokeWidth={1} dot={false} name="SMA 50" />
            )}
          </LineChart>
        )}
      </ResponsiveContainer>
    )
  }

  return (
    <NodeViewWrapper
      className={clsx(
        'chart-wrapper my-3 rounded-lg border transition-all overflow-hidden',
        selected ? 'border-primary-300 ring-2 ring-primary-100' : 'border-gray-200',
        'hover:border-gray-300 bg-white'
      )}
      data-drag-handle
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className={clsx('p-1.5 rounded-md', chartConfig.color)}>
            <ChartIcon className="h-4 w-4" />
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900">{symbol || 'No Symbol'}</span>
            {assetName && (
              <span className="text-sm text-gray-500 hidden sm:inline">{assetName}</span>
            )}
            {quoteData && (
              <span className={clsx(
                'flex items-center gap-1 text-sm font-medium',
                priceChange.isPositive ? 'text-emerald-600' : 'text-red-600'
              )}>
                {priceChange.isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {priceChange.percent.toFixed(2)}%
              </span>
            )}
          </div>
          <span className={clsx(
            'px-1.5 py-0.5 text-[10px] font-medium rounded',
            chartConfig.color
          )}>
            {chartConfig.label}
          </span>
          {isLive && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-green-100 text-green-700">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              Live
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Timeframe selector */}
          <div className="flex items-center gap-0.5 bg-white rounded-md border border-gray-200 p-0.5">
            {TIMEFRAME_OPTIONS.map((tf) => (
              <button
                key={tf.value}
                onClick={() => handleTimeframeChange(tf.value)}
                className={clsx(
                  'px-2 py-1 text-xs font-medium rounded transition-colors',
                  localTimeframe === tf.value
                    ? 'bg-primary-100 text-primary-700'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                )}
              >
                {tf.label}
              </button>
            ))}
          </div>

          {/* Refresh button */}
          <button
            onClick={() => refetch()}
            className="p-1.5 rounded-md hover:bg-gray-200 text-gray-500 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>

          {/* Expand button */}
          <button
            onClick={toggleExpanded}
            className="p-1.5 rounded-md hover:bg-gray-200 text-gray-500 transition-colors"
            title={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>

          {/* Delete button */}
          <button
            onClick={handleDelete}
            className="p-1.5 rounded-md hover:bg-red-100 text-gray-400 hover:text-red-600 transition-colors"
            title="Remove chart"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Chart content */}
      <div
        className="p-2"
        style={{ height: isExpanded ? 420 : (height || 220) }}
      >
        {renderChart()}
      </div>

      {/* Footer with price info */}
      {(quoteData || embeddedAt) && (
        <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-t border-gray-100 text-xs text-gray-500">
          <div className="flex items-center gap-4">
            {quoteData && (
              <>
                <span>
                  <span className="text-gray-400">Price:</span>{' '}
                  <span className="font-medium text-gray-700">${quoteData.regularMarketPrice?.toFixed(2)}</span>
                </span>
                <span>
                  <span className="text-gray-400">Change:</span>{' '}
                  <span className={clsx('font-medium', priceChange.isPositive ? 'text-emerald-600' : 'text-red-600')}>
                    {priceChange.isPositive ? '+' : ''}{priceChange.value.toFixed(2)} ({priceChange.percent.toFixed(2)}%)
                  </span>
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            {embeddedAt && (
              <div className="flex items-center gap-1 text-primary-500">
                <span className="w-1.5 h-1.5 rounded-full bg-primary-500" />
                <span>Embedded {format(new Date(embeddedAt), 'MMM d, yyyy h:mm a')}</span>
              </div>
            )}
            {quoteData && (
              <div className="flex items-center gap-1 text-gray-400">
                <Clock className="h-3 w-3" />
                <span>Updated just now</span>
              </div>
            )}
          </div>
        </div>
      )}
    </NodeViewWrapper>
  )
}

export default ChartView
