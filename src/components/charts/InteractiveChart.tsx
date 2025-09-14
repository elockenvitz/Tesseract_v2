import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
  Brush
} from 'recharts'
import {
  ZoomIn,
  ZoomOut,
  Move,
  TrendingUp,
  Minus,
  Plus,
  BarChart3,
  Activity,
  Target,
  MousePointer,
  Settings
} from 'lucide-react'
import type { ChartProps, ChartDataPoint, Annotation, TechnicalIndicator, ChartConfig } from './types'
import { ChartUtils } from './utils/chartUtils'
import { TechnicalIndicators } from './utils/indicators'

const defaultConfig: ChartConfig = {
  height: 400,
  margin: { top: 20, right: 30, bottom: 20, left: 20 },
  theme: 'light',
  showGrid: true,
  showLegend: true,
  showTooltip: true,
  enableZoom: true,
  enablePan: true,
  enableCrosshair: true,
  enableAnnotations: true
}

export function InteractiveChart({
  data,
  type = 'line',
  config = {},
  indicators = [],
  annotations = [],
  onDataPointClick,
  onAnnotationCreate,
  onAnnotationUpdate,
  onAnnotationDelete,
  className = ''
}: ChartProps) {
  const chartConfig = { ...defaultConfig, ...config }
  const containerRef = useRef<HTMLDivElement>(null)
  const [isZooming, setIsZooming] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const [isAnnotating, setIsAnnotating] = useState(false)
  const [annotationMode, setAnnotationMode] = useState<'percentage' | 'trend' | 'line' | null>(null)
  const [selectedRange, setSelectedRange] = useState<{ start: number; end: number } | null>(null)
  const [zoomDomain, setZoomDomain] = useState<{ start: number; end: number } | null>(null)
  const [chartAnnotations, setChartAnnotations] = useState<Annotation[]>(annotations)
  const [activeIndicators, setActiveIndicators] = useState<TechnicalIndicator[]>(indicators)
  const [hoveredPoint, setHoveredPoint] = useState<ChartDataPoint | null>(null)
  const [crosshairPosition, setCrosshairPosition] = useState<{ x: number; y: number } | null>(null)

  // Process data with indicators
  const processedData = useMemo(() => {
    let result = [...data]

    // Add technical indicators to data
    activeIndicators.forEach(indicator => {
      if (!indicator.visible) return

      switch (indicator.type) {
        case 'sma':
          const smaData = TechnicalIndicators.sma(data, indicator.period || 20)
          smaData.forEach((sma, index) => {
            const dataIndex = result.length - smaData.length + index
            if (dataIndex >= 0 && dataIndex < result.length) {
              result[dataIndex] = { ...result[dataIndex], [`sma${indicator.period}`]: sma.value }
            }
          })
          break

        case 'ema':
          const emaData = TechnicalIndicators.ema(data, indicator.period || 20)
          emaData.forEach((ema, index) => {
            const dataIndex = result.length - emaData.length + index
            if (dataIndex >= 0 && dataIndex < result.length) {
              result[dataIndex] = { ...result[dataIndex], [`ema${indicator.period}`]: ema.value }
            }
          })
          break

        case 'bollinger':
          const bollinger = TechnicalIndicators.bollingerBands(data, indicator.period || 20)
          bollinger.middle.forEach((mid, index) => {
            const dataIndex = result.length - bollinger.middle.length + index
            if (dataIndex >= 0 && dataIndex < result.length) {
              result[dataIndex] = {
                ...result[dataIndex],
                bollingerMiddle: mid.value,
                bollingerUpper: bollinger.upper[index]?.value,
                bollingerLower: bollinger.lower[index]?.value
              }
            }
          })
          break
      }
    })

    return result
  }, [data, activeIndicators])

  // Filter data based on zoom domain
  const displayData = useMemo(() => {
    if (!zoomDomain) return processedData

    const startIndex = Math.max(0, zoomDomain.start)
    const endIndex = Math.min(processedData.length - 1, zoomDomain.end)

    return processedData.slice(startIndex, endIndex + 1)
  }, [processedData, zoomDomain])

  // Custom tooltip
  const CustomTooltip = useCallback(({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload as ChartDataPoint

      return (
        <div className="bg-white border border-gray-300 rounded-lg shadow-lg p-3 text-sm">
          <div className="font-semibold text-gray-900 mb-2">
            {ChartUtils.formatDate(label, '%Y-%m-%d %H:%M')}
          </div>

          {/* OHLC Data */}
          {data.open !== undefined && (
            <div className=\"space-y-1 mb-2\">
              <div className=\"flex justify-between gap-4\">
                <span className=\"text-gray-600\">Open:</span>
                <span className=\"font-medium\">{ChartUtils.formatPrice(data.open)}</span>
              </div>
              <div className=\"flex justify-between gap-4\">
                <span className=\"text-gray-600\">High:</span>
                <span className=\"font-medium text-green-600\">{ChartUtils.formatPrice(data.high || 0)}</span>
              </div>
              <div className=\"flex justify-between gap-4\">
                <span className=\"text-gray-600\">Low:</span>
                <span className=\"font-medium text-red-600\">{ChartUtils.formatPrice(data.low || 0)}</span>
              </div>
              <div className=\"flex justify-between gap-4\">
                <span className=\"text-gray-600\">Close:</span>
                <span className=\"font-medium\">{ChartUtils.formatPrice(data.close || data.value)}</span>
              </div>
            </div>
          )}

          {/* Simple Price Data */}
          {data.open === undefined && (
            <div className=\"flex justify-between gap-4 mb-2\">
              <span className=\"text-gray-600\">Price:</span>
              <span className=\"font-medium\">{ChartUtils.formatPrice(data.value)}</span>
            </div>
          )}

          {/* Volume */}
          {data.volume !== undefined && (
            <div className=\"flex justify-between gap-4 mb-2\">
              <span className=\"text-gray-600\">Volume:</span>
              <span className=\"font-medium\">{ChartUtils.formatVolume(data.volume)}</span>
            </div>
          )}

          {/* Technical Indicators */}
          {activeIndicators.map(indicator => {
            if (!indicator.visible) return null
            const key = `${indicator.type}${indicator.period || ''}`
            const value = data[key as keyof ChartDataPoint]
            if (value === undefined) return null

            return (
              <div key={indicator.id} className=\"flex justify-between gap-4\">
                <span className=\"text-gray-600\">{indicator.name}:</span>
                <span className=\"font-medium\" style={{ color: indicator.color }}>
                  {ChartUtils.formatPrice(value as number)}
                </span>
              </div>
            )
          })}
        </div>
      )
    }
    return null
  }, [activeIndicators])

  // Handle zoom
  const handleZoom = useCallback((domain: any) => {
    if (domain && domain.startIndex !== undefined && domain.endIndex !== undefined) {
      setZoomDomain({ start: domain.startIndex, end: domain.endIndex })
    }
  }, [])

  // Reset zoom
  const resetZoom = useCallback(() => {
    setZoomDomain(null)
    setSelectedRange(null)
  }, [])

  // Handle mouse events for annotations
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!annotationMode) return

    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return

    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    // Start annotation creation
    setIsAnnotating(true)
  }, [annotationMode])

  // Add/Remove Technical Indicators
  const addIndicator = useCallback((type: TechnicalIndicator['type'], period?: number) => {
    const newIndicator: TechnicalIndicator = {
      id: `${type}_${Date.now()}`,
      name: `${type.toUpperCase()}${period ? `(${period})` : ''}`,
      type,
      period,
      color: type === 'sma' ? '#3b82f6' : type === 'ema' ? '#ef4444' : '#8b5cf6',
      visible: true
    }

    setActiveIndicators(prev => [...prev, newIndicator])
  }, [])

  const removeIndicator = useCallback((id: string) => {
    setActiveIndicators(prev => prev.filter(ind => ind.id !== id))
  }, [])

  const toggleIndicator = useCallback((id: string) => {
    setActiveIndicators(prev =>
      prev.map(ind =>
        ind.id === id ? { ...ind, visible: !ind.visible } : ind
      )
    )
  }, [])

  // Render chart based on type
  const renderChart = () => {
    const commonProps = {
      data: displayData,
      margin: chartConfig.margin,
      onMouseDown: handleMouseDown
    }

    switch (type) {
      case 'area':
        return (
          <AreaChart {...commonProps}>
            <CartesianGrid strokeDasharray=\"3 3\" stroke={chartConfig.theme === 'dark' ? '#374151' : '#e5e7eb'} />
            <XAxis
              dataKey=\"timestamp\"
              tickFormatter={(value) => ChartUtils.formatDate(value, '%m/%d')}
              stroke={chartConfig.theme === 'dark' ? '#9ca3af' : '#6b7280'}
            />
            <YAxis
              tickFormatter={(value) => ChartUtils.formatPrice(value)}
              stroke={chartConfig.theme === 'dark' ? '#9ca3af' : '#6b7280'}
            />
            {chartConfig.showTooltip && <Tooltip content={CustomTooltip} />}
            <Area
              type=\"monotone\"
              dataKey=\"value\"
              stroke=\"#3b82f6\"
              fill=\"#3b82f6\"
              fillOpacity={0.3}
              strokeWidth={2}
            />

            {/* Render active indicators */}
            {activeIndicators.map(indicator => {
              if (!indicator.visible) return null
              const dataKey = `${indicator.type}${indicator.period || ''}`

              return (
                <Line
                  key={indicator.id}
                  type=\"monotone\"
                  dataKey={dataKey}
                  stroke={indicator.color}
                  strokeWidth={1}
                  dot={false}
                  strokeDasharray={indicator.type === 'sma' ? '5,5' : undefined}
                />
              )
            })}

            {/* Add brush for zoom */}
            {chartConfig.enableZoom && (
              <Brush
                dataKey=\"timestamp\"
                height={30}
                stroke=\"#3b82f6\"
                onChange={handleZoom}
              />
            )}
          </AreaChart>
        )

      case 'bar':
        return (
          <BarChart {...commonProps}>
            <CartesianGrid strokeDasharray=\"3 3\" />
            <XAxis
              dataKey=\"timestamp\"
              tickFormatter={(value) => ChartUtils.formatDate(value, '%m/%d')}
            />
            <YAxis tickFormatter={(value) => ChartUtils.formatPrice(value)} />
            {chartConfig.showTooltip && <Tooltip content={CustomTooltip} />}
            <Bar dataKey=\"value\" fill=\"#3b82f6\" />
          </BarChart>
        )

      default:
        return (
          <LineChart {...commonProps}>
            <CartesianGrid
              strokeDasharray=\"3 3\"
              stroke={chartConfig.theme === 'dark' ? '#374151' : '#e5e7eb'}
            />
            <XAxis
              dataKey=\"timestamp\"
              tickFormatter={(value) => ChartUtils.formatDate(value, '%m/%d')}
              stroke={chartConfig.theme === 'dark' ? '#9ca3af' : '#6b7280'}
            />
            <YAxis
              tickFormatter={(value) => ChartUtils.formatPrice(value)}
              stroke={chartConfig.theme === 'dark' ? '#9ca3af' : '#6b7280'}
            />
            {chartConfig.showTooltip && <Tooltip content={CustomTooltip} />}

            {/* Main price line */}
            <Line
              type=\"monotone\"
              dataKey={displayData[0]?.close !== undefined ? 'close' : 'value'}
              stroke=\"#1f2937\"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: '#3b82f6' }}
            />

            {/* Render active indicators */}
            {activeIndicators.map(indicator => {
              if (!indicator.visible) return null

              const dataKey = `${indicator.type}${indicator.period || ''}`

              return (
                <Line
                  key={indicator.id}
                  type=\"monotone\"
                  dataKey={dataKey}
                  stroke={indicator.color}
                  strokeWidth={1}
                  dot={false}
                  strokeDasharray={indicator.type === 'sma' ? '5,5' : undefined}
                />
              )
            })}

            {/* Bollinger Bands */}
            {activeIndicators.some(ind => ind.type === 'bollinger' && ind.visible) && (
              <>
                <Line
                  type=\"monotone\"
                  dataKey=\"bollingerUpper\"
                  stroke=\"#8b5cf6\"
                  strokeWidth={1}
                  dot={false}
                  strokeDasharray=\"3,3\"
                />
                <Line
                  type=\"monotone\"
                  dataKey=\"bollingerLower\"
                  stroke=\"#8b5cf6\"
                  strokeWidth={1}
                  dot={false}
                  strokeDasharray=\"3,3\"
                />
              </>
            )}

            {/* Add brush for zoom */}
            {chartConfig.enableZoom && (
              <Brush
                dataKey=\"timestamp\"
                height={30}
                stroke=\"#3b82f6\"
                onChange={handleZoom}
              />
            )}
          </LineChart>
        )
    }
  }

  return (
    <div className={`w-full ${className}`}>
      {/* Chart Controls */}
      <div className=\"flex items-center justify-between mb-4 p-3 bg-gray-50 rounded-lg\">
        <div className=\"flex items-center space-x-2\">
          {/* Chart Type Controls */}
          <div className=\"flex items-center space-x-1 border-r border-gray-300 pr-2 mr-2\">
            <button
              onClick={() => {}}
              className={`p-1 rounded ${type === 'line' ? 'bg-blue-100 text-blue-600' : 'text-gray-600 hover:bg-gray-200'}`}
              title=\"Line Chart\"
            >
              <Activity className=\"h-4 w-4\" />
            </button>
            <button
              onClick={() => {}}
              className={`p-1 rounded ${type === 'area' ? 'bg-blue-100 text-blue-600' : 'text-gray-600 hover:bg-gray-200'}`}
              title=\"Area Chart\"
            >
              <BarChart3 className=\"h-4 w-4\" />
            </button>
          </div>

          {/* Zoom Controls */}
          <button
            onClick={() => setIsZooming(!isZooming)}
            className={`p-1 rounded ${isZooming ? 'bg-blue-100 text-blue-600' : 'text-gray-600 hover:bg-gray-200'}`}
            title=\"Zoom Mode\"
          >
            <ZoomIn className=\"h-4 w-4\" />
          </button>
          <button
            onClick={resetZoom}
            className=\"p-1 rounded text-gray-600 hover:bg-gray-200\"
            title=\"Reset Zoom\"
          >
            <ZoomOut className=\"h-4 w-4\" />
          </button>

          {/* Annotation Controls */}
          <div className=\"border-l border-gray-300 pl-2 ml-2 flex items-center space-x-1\">
            <button
              onClick={() => setAnnotationMode(annotationMode === 'percentage' ? null : 'percentage')}
              className={`p-1 rounded ${annotationMode === 'percentage' ? 'bg-green-100 text-green-600' : 'text-gray-600 hover:bg-gray-200'}`}
              title=\"Percentage Change\"
            >
              <span className=\"text-xs font-semibold\">%</span>
            </button>
            <button
              onClick={() => setAnnotationMode(annotationMode === 'trend' ? null : 'trend')}
              className={`p-1 rounded ${annotationMode === 'trend' ? 'bg-purple-100 text-purple-600' : 'text-gray-600 hover:bg-gray-200'}`}
              title=\"Trend Line\"
            >
              <TrendingUp className=\"h-4 w-4\" />
            </button>
            <button
              onClick={() => setAnnotationMode(annotationMode === 'line' ? null : 'line')}
              className={`p-1 rounded ${annotationMode === 'line' ? 'bg-indigo-100 text-indigo-600' : 'text-gray-600 hover:bg-gray-200'}`}
              title=\"Horizontal Line\"
            >
              <Minus className=\"h-4 w-4\" />
            </button>
          </div>
        </div>

        {/* Technical Indicators */}
        <div className=\"flex items-center space-x-2\">
          <div className=\"text-sm text-gray-600\">Indicators:</div>
          <button
            onClick={() => addIndicator('sma', 20)}
            className=\"px-2 py-1 text-xs bg-blue-100 text-blue-600 rounded hover:bg-blue-200\"
          >
            + SMA(20)
          </button>
          <button
            onClick={() => addIndicator('ema', 12)}
            className=\"px-2 py-1 text-xs bg-red-100 text-red-600 rounded hover:bg-red-200\"
          >
            + EMA(12)
          </button>
          <button
            onClick={() => addIndicator('bollinger', 20)}
            className=\"px-2 py-1 text-xs bg-purple-100 text-purple-600 rounded hover:bg-purple-200\"
          >
            + BB(20)
          </button>
        </div>
      </div>

      {/* Active Indicators List */}
      {activeIndicators.length > 0 && (
        <div className=\"flex items-center space-x-2 mb-4 p-2 bg-gray-50 rounded\">
          <div className=\"text-sm text-gray-600\">Active:</div>
          {activeIndicators.map(indicator => (
            <div key={indicator.id} className=\"flex items-center space-x-1\">
              <button
                onClick={() => toggleIndicator(indicator.id)}
                className={`px-2 py-1 text-xs rounded ${
                  indicator.visible
                    ? 'bg-gray-200 text-gray-700'
                    : 'bg-gray-100 text-gray-400'
                }`}
                style={{
                  borderLeft: `3px solid ${indicator.visible ? indicator.color : '#d1d5db'}`
                }}
              >
                {indicator.name}
              </button>
              <button
                onClick={() => removeIndicator(indicator.id)}
                className=\"text-red-500 hover:text-red-700\"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Chart Container */}
      <div
        ref={containerRef}
        className=\"w-full\"
        style={{ height: chartConfig.height }}
      >
        <ResponsiveContainer width=\"100%\" height=\"100%\">
          {renderChart()}
        </ResponsiveContainer>
      </div>

      {/* Chart Statistics */}
      {displayData.length > 0 && (
        <div className=\"mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 p-3 bg-gray-50 rounded-lg text-sm\">
          <div>
            <div className=\"text-gray-600\">Period</div>
            <div className=\"font-medium\">
              {ChartUtils.formatDate(displayData[0].timestamp, '%m/%d')} - {ChartUtils.formatDate(displayData[displayData.length - 1].timestamp, '%m/%d')}
            </div>
          </div>
          <div>
            <div className=\"text-gray-600\">Change</div>
            <div className={`font-medium ${
              (displayData[displayData.length - 1]?.value || 0) >= (displayData[0]?.value || 0)
                ? 'text-green-600'
                : 'text-red-600'
            }`}>
              {ChartUtils.formatPercentage(
                TechnicalIndicators.percentageChange(
                  displayData[0]?.value || 0,
                  displayData[displayData.length - 1]?.value || 0
                )
              )}
            </div>
          </div>
          <div>
            <div className=\"text-gray-600\">Volatility</div>
            <div className=\"font-medium\">
              {ChartUtils.formatPercentage(TechnicalIndicators.volatility(displayData) * 100)}
            </div>
          </div>
          <div>
            <div className=\"text-gray-600\">Points</div>
            <div className=\"font-medium\">{displayData.length}</div>
          </div>
        </div>
      )}
    </div>
  )
}