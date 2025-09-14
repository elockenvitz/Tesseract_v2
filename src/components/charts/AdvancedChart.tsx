import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
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
  ResponsiveContainer,
  ReferenceLine,
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
  MousePointer,
  Settings,
  Target,
  Maximize2
} from 'lucide-react'
import { financialDataService } from '../../lib/financial-data/browser-client'
import { ChartDataAdapter } from './utils/dataAdapter'
import { TechnicalIndicators } from './utils/indicators'

interface AdvancedChartProps {
  symbol: string
  height?: number
  className?: string
  symbols?: string[] // Support for multiple series
}

type ChartMetric = 'price' | 'volume' | 'percentage' | 'rsi' | 'macd'
type ChartType = 'line' | 'area' | 'bar' | 'candlestick'
type DateRangeType = '1D' | '1W' | '1M' | '3M' | '6M' | '1Y' | 'YTD' | '5Y' | 'MAX' | 'CUSTOM'

interface ChartAnnotation {
  id: string
  type: 'horizontal' | 'vertical' | 'trend' | 'rectangle' | 'text' | 'fibRetracement'
  x1: number
  y1: number
  x2?: number
  y2?: number
  text?: string
  color: string
  strokeWidth?: number
  isDashed?: boolean
  isVisible: boolean
}

interface ChartStatistic {
  id: string
  name: string
  value: number | string
  visible: boolean
  color?: string
}

export function AdvancedChart({ symbol, symbols = [], height = 500, className = '' }: AdvancedChartProps) {
  console.log('🚨 AdvancedChart component rendering with symbol:', symbol)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [isAxisDragging, setIsAxisDragging] = useState<'x' | 'y' | null>(null)

  // Chart configuration state
  const [chartType, setChartType] = useState<ChartType>('line')
  const [selectedMetric, setSelectedMetric] = useState<ChartMetric>('price')
  const [dateRange, setDateRange] = useState<DateRangeType>('1M')
  const [customDateRange, setCustomDateRange] = useState<{
    start: string;
    end: string;
    frequency: 'daily' | 'weekly' | 'monthly'
  }>({
    start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0],
    frequency: 'daily'
  })
  const [showCustomDatePicker, setShowCustomDatePicker] = useState(false)
  const [zoom, setZoom] = useState({ start: 0, end: 100 })
  const [yScale, setYScale] = useState<{ min?: number; max?: number }>({})

  // Multiple series support
  const [activeSeries, setActiveSeries] = useState<string[]>(['price'])
  const [seriesColors] = useState<Record<string, string>>({
    'price': '#3b82f6',
    'volume': '#ef4444',
    'marketCap': '#10b981',
    'open': '#f59e0b',
    'high': '#8b5cf6',
    'low': '#ec4899',
    'close': '#06b6d4',
    'change': '#84cc16',
    'changePercent': '#f97316',
    'dayHigh': '#f43f5e',
    'dayLow': '#14b8a6',
    'previousClose': '#a855f7'
  })

  // Interactive elements
  const [annotations, setAnnotations] = useState<ChartAnnotation[]>([])
  const [statistics, setStatistics] = useState<ChartStatistic[]>([])
  const [selectedTechnicalIndicators, setSelectedTechnicalIndicators] = useState<string[]>([])
  const [isAnnotationMode, setIsAnnotationMode] = useState(false)
  const [annotationTool, setAnnotationTool] = useState<ChartAnnotation['type'] | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [drawingStart, setDrawingStart] = useState<{ x: number; y: number } | null>(null)
  const [previewAnnotation, setPreviewAnnotation] = useState<ChartAnnotation | null>(null)
  const [showSeriesManager, setShowSeriesManager] = useState(false)
  const [newSeriesSymbol, setNewSeriesSymbol] = useState('')

  // Dropdown states
  const [showSeriesDropdown, setShowSeriesDropdown] = useState(false)
  const [showIndicatorsDropdown, setShowIndicatorsDropdown] = useState(false)
  const [seriesSearchTerm, setSeriesSearchTerm] = useState('')
  const [indicatorsSearchTerm, setIndicatorsSearchTerm] = useState('')

  // Available options
  const availableSeries = [
    { id: 'price', name: 'Price', description: 'Current stock price' },
    { id: 'volume', name: 'Volume', description: 'Trading volume' },
    { id: 'marketCap', name: 'Market Cap', description: 'Market capitalization' },
    { id: 'open', name: 'Open Price', description: 'Opening price' },
    { id: 'high', name: 'High Price', description: 'Daily high price' },
    { id: 'low', name: 'Low Price', description: 'Daily low price' },
    { id: 'close', name: 'Close Price', description: 'Closing price' },
    { id: 'change', name: 'Price Change', description: 'Price change in dollars' },
    { id: 'changePercent', name: 'Change %', description: 'Price change percentage' },
    { id: 'dayHigh', name: 'Day High', description: 'Highest price today' },
    { id: 'dayLow', name: 'Day Low', description: 'Lowest price today' },
    { id: 'previousClose', name: 'Previous Close', description: 'Previous closing price' }
  ]

  const availableIndicators = [
    { id: 'sma20', name: 'SMA(20)', category: 'Moving Averages' },
    { id: 'sma50', name: 'SMA(50)', category: 'Moving Averages' },
    { id: 'sma200', name: 'SMA(200)', category: 'Moving Averages' },
    { id: 'ema20', name: 'EMA(20)', category: 'Moving Averages' },
    { id: 'ema50', name: 'EMA(50)', category: 'Moving Averages' },
    { id: 'rsi', name: 'RSI', category: 'Momentum' },
    { id: 'macd', name: 'MACD', category: 'Momentum' },
    { id: 'bb', name: 'Bollinger Bands', category: 'Volatility' },
    { id: 'stoch', name: 'Stochastic', category: 'Momentum' },
    { id: 'williams', name: 'Williams %R', category: 'Momentum' },
    { id: 'cci', name: 'CCI', category: 'Momentum' },
    { id: 'atr', name: 'ATR', category: 'Volatility' },
  ]

  // Filtering functions
  const filteredSeries = availableSeries.filter(series =>
    series.name.toLowerCase().includes(seriesSearchTerm.toLowerCase()) ||
    series.description.toLowerCase().includes(seriesSearchTerm.toLowerCase())
  )

  const filteredIndicators = availableIndicators.filter(indicator =>
    indicator.name.toLowerCase().includes(indicatorsSearchTerm.toLowerCase()) ||
    indicator.category.toLowerCase().includes(indicatorsSearchTerm.toLowerCase())
  )

  // Toggle functions
  const toggleSeries = (seriesId: string) => {
    setActiveSeries(prev =>
      prev.includes(seriesId)
        ? prev.filter(s => s !== seriesId)
        : [...prev, seriesId]
    )
  }

  const toggleIndicator = (indicatorId: string) => {
    setSelectedTechnicalIndicators(prev =>
      prev.includes(indicatorId)
        ? prev.filter(id => id !== indicatorId)
        : [...prev, indicatorId]
    )
  }

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('.series-dropdown') && showSeriesDropdown) {
        setShowSeriesDropdown(false)
      }
      if (!target.closest('.indicators-dropdown') && showIndicatorsDropdown) {
        setShowIndicatorsDropdown(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showSeriesDropdown, showIndicatorsDropdown])

  // Fetch financial data
  const { data: currentQuote, isLoading } = useQuery({
    queryKey: ['advanced-chart-quote', symbol],
    queryFn: async () => {
      const quote = await financialDataService.getQuote(symbol)
      return quote
    },
    refetchInterval: 30000,
    staleTime: 15000
  })

  // Calculate days based on date range
  const getDaysFromRange = useCallback((range: DateRangeType): number => {
    const now = new Date()
    switch (range) {
      case '1D': return 1
      case '1W': return 7
      case '1M': return 30
      case '3M': return 90
      case '6M': return 180
      case '1Y': return 365
      case 'YTD':
        const yearStart = new Date(now.getFullYear(), 0, 1)
        return Math.floor((now.getTime() - yearStart.getTime()) / (1000 * 60 * 60 * 24))
      case '5Y': return 365 * 5
      case 'MAX': return 365 * 10 // 10 years as max
      case 'CUSTOM':
        const start = new Date(customDateRange.start)
        const end = new Date(customDateRange.end)
        return Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
      default: return 30
    }
  }, [customDateRange])

  // Generate chart data based on selected metric and date range
  const rawChartData = useMemo(() => {
    if (!currentQuote) return []

    const days = getDaysFromRange(dateRange)
    return ChartDataAdapter.generateHistoricalData(symbol, currentQuote, days)
  }, [symbol, currentQuote, dateRange, getDaysFromRange])

  // Process data based on selected metric
  const chartData = useMemo(() => {
    if (!rawChartData.length) return []

    let processedData = [...rawChartData]

    switch (selectedMetric) {
      case 'volume':
        processedData = processedData.map(d => ({ ...d, value: d.volume || 0 }))
        break
      case 'percentage':
        const baseValue = rawChartData[0]?.value || 0
        processedData = processedData.map(d => ({
          ...d,
          value: ((d.value - baseValue) / baseValue) * 100
        }))
        break
      case 'rsi':
        const rsiData = TechnicalIndicators.rsi(rawChartData)
        processedData = rsiData.map(d => ({ ...d, value: d.rsi || 0 }))
        break
      case 'macd':
        const macdResult = TechnicalIndicators.macd(rawChartData)
        processedData = macdResult.macd.map(d => ({ ...d, value: d.macd || 0 }))
        break
      default: // price
        break
    }

    // Add technical indicators
    selectedTechnicalIndicators.forEach(indicator => {
      if (indicator.startsWith('sma')) {
        const period = parseInt(indicator.replace('sma', ''))
        const smaData = TechnicalIndicators.sma(rawChartData, period)
        smaData.forEach((sma, index) => {
          const dataIndex = processedData.length - smaData.length + index
          if (dataIndex >= 0 && dataIndex < processedData.length) {
            processedData[dataIndex][`sma${period}`] = sma.value
          }
        })
      }
    })

    return processedData
  }, [rawChartData, selectedMetric, selectedTechnicalIndicators])

  // Calculate proper Y-axis domain - moved here to avoid hooks ordering violation
  const calculateYAxisDomain = useCallback(() => {
    const currentDisplayData = chartData.slice(
      Math.floor((chartData.length * zoom.start) / 100),
      Math.ceil((chartData.length * zoom.end) / 100)
    )

    if (currentDisplayData.length === 0) return ['auto', 'auto']

    const values = currentDisplayData.map(d => d.value).filter(v => !isNaN(v))
    if (values.length === 0) return ['auto', 'auto']

    const dataMin = Math.min(...values)
    const dataMax = Math.max(...values)

    if (yScale.min !== undefined && yScale.max !== undefined) {
      return [yScale.min, yScale.max]
    }

    const range = dataMax - dataMin
    const padding = range * 0.05 // 5% padding

    // Don't go below 0 unless data has negative values
    const minValue = dataMin >= 0 ? Math.max(0, dataMin - padding) : dataMin - padding
    const maxValue = dataMax + padding

    return [minValue, maxValue]
  }, [chartData, yScale, zoom])

  // Calculate statistics
  useEffect(() => {
    if (chartData.length === 0) return

    const values = chartData.map(d => d.value)
    const firstValue = values[0]
    const lastValue = values[values.length - 1]
    const minValue = Math.min(...values)
    const maxValue = Math.max(...values)
    const change = ((lastValue - firstValue) / firstValue) * 100

    const newStatistics: ChartStatistic[] = [
      { id: 'current', name: 'Current', value: lastValue.toFixed(2), visible: true, color: '#3b82f6' },
      { id: 'change', name: 'Change', value: `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`, visible: true, color: change >= 0 ? '#10b981' : '#ef4444' },
      { id: 'high', name: 'High', value: maxValue.toFixed(2), visible: true, color: '#10b981' },
      { id: 'low', name: 'Low', value: minValue.toFixed(2), visible: true, color: '#ef4444' },
      { id: 'points', name: 'Data Points', value: chartData.length.toString(), visible: true, color: '#6b7280' }
    ]

    setStatistics(newStatistics)
  }, [chartData])

  // Mouse event handlers for dragging
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Prevent text selection during drag
    e.preventDefault()
    e.stopPropagation()

    if (isAnnotationMode) return

    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return

    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    // Disable user selection during drag
    document.body.style.userSelect = 'none'
    document.body.style.webkitUserSelect = 'none'

    // Check if clicking on axis areas
    if (x < 60) {
      setIsAxisDragging('y')
      setDragStart({ x, y })
    } else if (y > height - 60) {
      setIsAxisDragging('x')
      setDragStart({ x, y })
    } else {
      setIsDragging(true)
      setDragStart({ x, y })
    }
  }, [isAnnotationMode, height])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragStart) return

    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return

    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const deltaX = x - dragStart.x
    const deltaY = y - dragStart.y

    if (isAxisDragging === 'x') {
      // X-axis scaling - much smoother sensitivity
      const sensitivity = 0.02 // Reduced from 0.1
      const zoomChange = deltaX * sensitivity
      setZoom(prev => ({
        start: Math.max(0, Math.min(95, prev.start + zoomChange)),
        end: Math.max(5, Math.min(100, prev.end - zoomChange))
      }))
    } else if (isAxisDragging === 'y') {
      // Y-axis scaling - smoother with better bounds
      const values = chartData.map(d => d.value).filter(v => !isNaN(v))
      if (values.length === 0) return

      const dataMin = Math.min(...values)
      const dataMax = Math.max(...values)
      const range = dataMax - dataMin
      const sensitivity = range * 0.0002 // Much more sensitive and smooth
      const scaleChange = deltaY * sensitivity

      setYScale(prev => {
        const currentMin = prev.min !== undefined ? prev.min : Math.max(0, dataMin - range * 0.05)
        const currentMax = prev.max !== undefined ? prev.max : dataMax + range * 0.05

        const newMin = currentMin + scaleChange
        const newMax = currentMax - scaleChange

        // Ensure min doesn't go below 0 unless data has negative values
        const finalMin = dataMin >= 0 ? Math.max(0, newMin) : newMin

        // Ensure reasonable bounds
        if (newMax <= finalMin || newMax - finalMin < range * 0.1) {
          return prev // Don't update if bounds are unreasonable
        }

        return { min: finalMin, max: newMax }
      })
    } else if (isDragging) {
      // Chart area panning - smoother interaction
      const xSensitivity = 0.01 // Reduced from 0.05
      const ySensitivity = 0.0001 // Reduced for smoother feel

      setZoom(prev => {
        const xChange = deltaX * xSensitivity
        const newStart = Math.max(0, prev.start - xChange)
        const newEnd = Math.min(100, prev.end - xChange)

        // Maintain minimum zoom window
        if (newEnd - newStart < 5) {
          return prev
        }

        return { start: newStart, end: newEnd }
      })

      const values = chartData.map(d => d.value).filter(v => !isNaN(v))
      if (values.length === 0) return

      const dataMin = Math.min(...values)
      const range = Math.max(...values) - dataMin
      const yChange = deltaY * range * ySensitivity

      setYScale(prev => {
        const currentMin = prev.min !== undefined ? prev.min : Math.max(0, dataMin - range * 0.05)
        const currentMax = prev.max !== undefined ? prev.max : Math.max(...values) + range * 0.05

        const newMin = currentMin - yChange
        const newMax = currentMax - yChange

        // Ensure min doesn't go below 0 unless data has negative values
        const finalMin = dataMin >= 0 ? Math.max(0, newMin) : newMin

        return { min: finalMin, max: newMax }
      })
    }
  }, [dragStart, isAxisDragging, isDragging, chartData])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
    setIsAxisDragging(null)
    setDragStart(null)

    // Re-enable user selection
    document.body.style.userSelect = ''
    document.body.style.webkitUserSelect = ''
  }, [])

  // Add technical indicator
  const addTechnicalIndicator = useCallback((indicator: string) => {
    if (!selectedTechnicalIndicators.includes(indicator)) {
      setSelectedTechnicalIndicators(prev => [...prev, indicator])
    }
  }, [selectedTechnicalIndicators])

  // Remove technical indicator
  const removeTechnicalIndicator = useCallback((indicator: string) => {
    setSelectedTechnicalIndicators(prev => prev.filter(ind => ind !== indicator))
  }, [])

  // Reset zoom and scale
  const resetView = useCallback(() => {
    setZoom({ start: 0, end: 100 })
    setYScale({})
  }, [])

  // Add series to chart
  const addSeries = useCallback((newSeriesId: string) => {
    if (newSeriesId && !activeSeries.includes(newSeriesId)) {
      setActiveSeries(prev => [...prev, newSeriesId])
      setNewSeriesSymbol('')
      setShowSeriesManager(false)
    }
  }, [activeSeries])

  // Remove series from chart
  const removeSeries = useCallback((symbolToRemove: string) => {
    if (activeSeries.length > 1) { // Keep at least one series
      setActiveSeries(prev => prev.filter(s => s !== symbolToRemove))
    }
  }, [activeSeries])

  // Get series name from ID
  const getSeriesName = useCallback((seriesId: string) => {
    const series = availableSeries.find(s => s.id === seriesId)
    return series ? series.name : seriesId
  }, [])

  // Enter annotation mode for interactive drawing
  const enterAnnotationMode = useCallback((type: ChartAnnotation['type']) => {
    setIsAnnotationMode(true)
    setAnnotationTool(type)
    setIsDrawing(false)
    setDrawingStart(null)
    setPreviewAnnotation(null)
  }, [])

  // Exit annotation mode
  const exitAnnotationMode = useCallback(() => {
    setIsAnnotationMode(false)
    setAnnotationTool(null)
    setIsDrawing(false)
    setDrawingStart(null)
    setPreviewAnnotation(null)
  }, [])

  // Convert screen coordinates to chart coordinates
  const screenToChartCoords = useCallback((screenX: number, screenY: number) => {
    const chartRect = containerRef.current?.getBoundingClientRect()
    if (!chartRect) return { x: 0, y: 0 }

    // Account for chart margins
    const marginLeft = 60
    const marginTop = 20
    const marginRight = 60
    const marginBottom = 60

    const chartWidth = chartRect.width - marginLeft - marginRight
    const chartHeight = height - marginTop - marginBottom

    const relativeX = screenX - chartRect.left - marginLeft
    const relativeY = screenY - chartRect.top - marginTop

    // Convert to percentage of chart area
    const xPercent = Math.max(0, Math.min(100, (relativeX / chartWidth) * 100))
    const yPercent = Math.max(0, Math.min(100, (relativeY / chartHeight) * 100))

    return {
      x: relativeX,
      y: relativeY,
      xPercent,
      yPercent
    }
  }, [height])

  // Handle chart click during annotation mode
  const handleChartClick = useCallback((e: React.MouseEvent) => {
    if (!isAnnotationMode || !annotationTool) return

    const coords = screenToChartCoords(e.clientX, e.clientY)

    if (annotationTool === 'horizontal') {
      // For horizontal line, create immediately on click
      const newAnnotation: ChartAnnotation = {
        id: `annotation_${Date.now()}`,
        type: 'horizontal',
        x1: 0,
        y1: coords.y,
        x2: containerRef.current?.getBoundingClientRect().width || 0,
        y2: coords.y,
        color: '#6366f1',
        strokeWidth: 2,
        isDashed: false,
        isVisible: true
      }
      setAnnotations(prev => [...prev, newAnnotation])
      exitAnnotationMode()
    } else if (annotationTool === 'vertical') {
      // For vertical line, create immediately on click
      const newAnnotation: ChartAnnotation = {
        id: `annotation_${Date.now()}`,
        type: 'vertical',
        x1: coords.x,
        y1: 0,
        x2: coords.x,
        y2: height,
        color: '#6366f1',
        strokeWidth: 2,
        isDashed: false,
        isVisible: true
      }
      setAnnotations(prev => [...prev, newAnnotation])
      exitAnnotationMode()
    } else if (annotationTool === 'trend') {
      // For trend line, need two points
      if (!isDrawing) {
        // First click - start drawing
        setIsDrawing(true)
        setDrawingStart({ x: coords.x, y: coords.y })
      } else {
        // Second click - finish trend line
        if (drawingStart) {
          const newAnnotation: ChartAnnotation = {
            id: `annotation_${Date.now()}`,
            type: 'trend',
            x1: drawingStart.x,
            y1: drawingStart.y,
            x2: coords.x,
            y2: coords.y,
            color: '#6366f1',
            strokeWidth: 2,
            isDashed: false,
            isVisible: true
          }
          setAnnotations(prev => [...prev, newAnnotation])
        }
        exitAnnotationMode()
      }
    } else if (annotationTool === 'text') {
      // For text annotation, prompt for text input
      const text = prompt('Enter annotation text:')
      if (text) {
        const newAnnotation: ChartAnnotation = {
          id: `annotation_${Date.now()}`,
          type: 'text',
          x1: coords.x,
          y1: coords.y,
          text: text,
          color: '#6366f1',
          strokeWidth: 1,
          isDashed: false,
          isVisible: true
        }
        setAnnotations(prev => [...prev, newAnnotation])
      }
      exitAnnotationMode()
    }
  }, [isAnnotationMode, annotationTool, isDrawing, drawingStart, screenToChartCoords, exitAnnotationMode, height])

  // Handle mouse move for preview
  const handleChartMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isAnnotationMode || !annotationTool) return

    const coords = screenToChartCoords(e.clientX, e.clientY)

    if (annotationTool === 'horizontal') {
      // Show horizontal line preview
      setPreviewAnnotation({
        id: 'preview',
        type: 'horizontal',
        x1: 0,
        y1: coords.y,
        x2: containerRef.current?.getBoundingClientRect().width || 0,
        y2: coords.y,
        color: '#6366f1aa',
        strokeWidth: 1,
        isDashed: true,
        isVisible: true
      })
    } else if (annotationTool === 'vertical') {
      // Show vertical line preview
      setPreviewAnnotation({
        id: 'preview',
        type: 'vertical',
        x1: coords.x,
        y1: 0,
        x2: coords.x,
        y2: height,
        color: '#6366f1aa',
        strokeWidth: 1,
        isDashed: true,
        isVisible: true
      })
    } else if (annotationTool === 'trend' && isDrawing && drawingStart) {
      // Show trend line preview from start to current position
      setPreviewAnnotation({
        id: 'preview',
        type: 'trend',
        x1: drawingStart.x,
        y1: drawingStart.y,
        x2: coords.x,
        y2: coords.y,
        color: '#6366f1aa',
        strokeWidth: 1,
        isDashed: true,
        isVisible: true
      })
    }
  }, [isAnnotationMode, annotationTool, isDrawing, drawingStart, screenToChartCoords, height])

  // Handle escape key to exit annotation mode
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isAnnotationMode) {
        exitAnnotationMode()
      }
    }

    document.addEventListener('keydown', handleKeyPress)
    return () => document.removeEventListener('keydown', handleKeyPress)
  }, [isAnnotationMode, exitAnnotationMode])

  // Delete annotation
  const deleteAnnotation = useCallback((id: string) => {
    setAnnotations(prev => prev.filter(a => a.id !== id))
  }, [])

  // Toggle annotation visibility
  const toggleAnnotationVisibility = useCallback((id: string) => {
    setAnnotations(prev => prev.map(a =>
      a.id === id ? { ...a, isVisible: !a.isVisible } : a
    ))
  }, [])

  // Format value based on metric
  const formatValue = useCallback((value: number) => {
    switch (selectedMetric) {
      case 'volume':
        return `${(value / 1000000).toFixed(1)}M`
      case 'percentage':
        return `${value.toFixed(2)}%`
      case 'rsi':
        return value.toFixed(1)
      case 'macd':
        return value.toFixed(3)
      default:
        return `$${value.toFixed(2)}`
    }
  }, [selectedMetric])

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white border border-gray-300 rounded-lg shadow-lg p-3 text-sm">
          <div className="font-semibold text-gray-900 mb-2">
            {new Date(label).toLocaleDateString()}
          </div>
          {payload.map((entry: any, index: number) => (
            <div key={index} className="flex justify-between gap-4">
              <span className="text-gray-600">{entry.name}:</span>
              <span className="font-medium" style={{ color: entry.color }}>
                {formatValue(entry.value)}
              </span>
            </div>
          ))}
        </div>
      )
    }
    return null
  }

  if (isLoading) {
    console.log('🔄 AdvancedChart is in loading state')
    return (
      <div className={`w-full ${className}`} style={{ height }}>
        <div className="animate-pulse bg-blue-100 border-2 border-blue-300 rounded-lg h-full flex items-center justify-center">
          <div className="text-blue-600 text-lg font-semibold">Loading advanced chart for {symbol}...</div>
        </div>
      </div>
    )
  }

  console.log('📊 Chart data length:', chartData.length, 'currentQuote:', !!currentQuote)

  const displayData = chartData.slice(
    Math.floor((chartData.length * zoom.start) / 100),
    Math.ceil((chartData.length * zoom.end) / 100)
  )


  console.log('🎯 AdvancedChart rendering main chart UI')

  return (
    <div className={`w-full space-y-4 ${className}`}>
      {/* Advanced Chart Controls */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Left Controls */}
          <div className="flex items-center space-x-4">
            {/* Series Dropdown */}
            <div className="relative series-dropdown">
              <button
                onClick={() => setShowSeriesDropdown(!showSeriesDropdown)}
                className="px-3 py-1 text-sm bg-blue-100 text-blue-600 rounded hover:bg-blue-200 flex items-center"
                title="Add Series"
              >
                + Series ▼
              </button>

              {showSeriesDropdown && (
                <div className="absolute top-full mt-1 left-0 z-50 bg-white border border-gray-300 rounded-lg shadow-lg w-72">
                  <div className="p-3">
                    <input
                      type="text"
                      value={seriesSearchTerm}
                      onChange={(e) => setSeriesSearchTerm(e.target.value)}
                      placeholder="Search series..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
                    />
                    <div className="max-h-60 overflow-y-auto">
                      {filteredSeries.map(series => (
                        <label key={series.id} className="flex items-center space-x-2 py-2 px-2 hover:bg-gray-50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={activeSeries.includes(series.id)}
                            onChange={() => toggleSeries(series.id)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <div className="flex-1">
                            <span className="text-sm font-medium">{series.name}</span>
                            <div className="text-xs text-gray-500">{series.description}</div>
                          </div>
                        </label>
                      ))}
                      {filteredSeries.length === 0 && (
                        <div className="text-gray-500 text-sm py-2 px-2">No series found</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Chart Type Selector */}
            <div className="flex items-center space-x-1 border-r border-gray-300 pr-3">
              <button
                onClick={() => setChartType('line')}
                className={`p-2 rounded ${chartType === 'line' ? 'bg-blue-100 text-blue-600' : 'text-gray-600 hover:bg-gray-100'}`}
                title="Line Chart"
              >
                <Activity className="h-4 w-4" />
              </button>
              <button
                onClick={() => setChartType('area')}
                className={`p-2 rounded ${chartType === 'area' ? 'bg-blue-100 text-blue-600' : 'text-gray-600 hover:bg-gray-100'}`}
                title="Area Chart"
              >
                <BarChart3 className="h-4 w-4" />
              </button>
              <button
                onClick={() => setChartType('bar')}
                className={`p-2 rounded ${chartType === 'bar' ? 'bg-blue-100 text-blue-600' : 'text-gray-600 hover:bg-gray-100'}`}
                title="Bar Chart"
              >
                <BarChart3 className="h-4 w-4" />
              </button>
            </div>

            {/* Date Range Selector */}
            <div className="flex items-center space-x-1">
              {['1D', '1W', '1M', '3M', '6M', '1Y', 'YTD', '5Y'].map((range) => (
                <button
                  key={range}
                  onClick={() => setDateRange(range as DateRangeType)}
                  className={`px-3 py-1 rounded text-sm ${
                    dateRange === range
                      ? 'bg-gray-900 text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {range}
                </button>
              ))}
              <div className="relative">
                <button
                  onClick={() => {
                    setDateRange('CUSTOM')
                    setShowCustomDatePicker(!showCustomDatePicker)
                  }}
                  className={`px-3 py-1 rounded text-sm ${
                    dateRange === 'CUSTOM'
                      ? 'bg-gray-900 text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Custom ▼
                </button>

                {/* Custom Date Dropdown */}
                {showCustomDatePicker && (
                  <div className="absolute top-full mt-1 left-0 z-50 bg-white border border-gray-300 rounded-lg shadow-lg p-4 min-w-80">
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                          <input
                            type="date"
                            value={customDateRange.start}
                            onChange={(e) => setCustomDateRange(prev => ({ ...prev, start: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                          <input
                            type="date"
                            value={customDateRange.end}
                            onChange={(e) => setCustomDateRange(prev => ({ ...prev, end: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Frequency</label>
                        <select
                          value={customDateRange.frequency}
                          onChange={(e) => setCustomDateRange(prev => ({ ...prev, frequency: e.target.value as 'daily' | 'weekly' | 'monthly' }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="daily">Daily</option>
                          <option value="weekly">Weekly</option>
                          <option value="monthly">Monthly</option>
                        </select>
                      </div>

                      <div className="flex justify-end space-x-2 pt-2">
                        <button
                          onClick={() => setShowCustomDatePicker(false)}
                          className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => setShowCustomDatePicker(false)}
                          className="px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                        >
                          Apply
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Technical Indicators Dropdown */}
            <div className="relative indicators-dropdown">
              <button
                onClick={() => setShowIndicatorsDropdown(!showIndicatorsDropdown)}
                className="px-3 py-1 text-sm border border-gray-300 rounded-md hover:bg-gray-50 flex items-center"
                title="Add Indicators"
              >
                Indicators ▼
              </button>

              {showIndicatorsDropdown && (
                <div className="absolute top-full mt-1 left-0 z-50 bg-white border border-gray-300 rounded-lg shadow-lg w-80">
                  <div className="p-3">
                    <input
                      type="text"
                      value={indicatorsSearchTerm}
                      onChange={(e) => setIndicatorsSearchTerm(e.target.value)}
                      placeholder="Search indicators..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
                    />
                    <div className="max-h-60 overflow-y-auto">
                      {filteredIndicators.reduce((acc, indicator) => {
                        const category = indicator.category;
                        if (!acc.categories.includes(category)) {
                          acc.categories.push(category);
                          acc.items.push(
                            <div key={category} className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-3 first:mt-0">
                              {category}
                            </div>
                          );
                        }
                        acc.items.push(
                          <label key={indicator.id} className="flex items-center space-x-2 py-2 px-2 hover:bg-gray-50 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedTechnicalIndicators.includes(indicator.id)}
                              onChange={() => toggleIndicator(indicator.id)}
                              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm">{indicator.name}</span>
                          </label>
                        );
                        return acc;
                      }, { categories: [], items: [] }).items}
                      {filteredIndicators.length === 0 && (
                        <div className="text-gray-500 text-sm py-2 px-2">No indicators found</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Controls */}
          <div className="flex items-center space-x-2">
            {/* View Controls */}
            <button
              onClick={resetView}
              className="p-2 rounded text-gray-600 hover:bg-gray-100"
              title="Reset View"
            >
              <Maximize2 className="h-4 w-4" />
            </button>

            {/* Annotation Tools */}
            <div className="flex items-center space-x-1 border-l border-gray-300 pl-3">
              <button
                onClick={() => enterAnnotationMode('horizontal')}
                className={`p-2 rounded text-gray-600 hover:bg-gray-100 ${annotationTool === 'horizontal' ? 'bg-blue-100 text-blue-600' : ''}`}
                title="Add Horizontal Line - Click to place"
              >
                <Minus className="h-4 w-4" />
              </button>
              <button
                onClick={() => enterAnnotationMode('vertical')}
                className={`p-2 rounded text-gray-600 hover:bg-gray-100 ${annotationTool === 'vertical' ? 'bg-blue-100 text-blue-600' : ''}`}
                title="Add Vertical Line - Click to place"
              >
                <div className="h-4 w-4 flex items-center justify-center">|</div>
              </button>
              <button
                onClick={() => enterAnnotationMode('trend')}
                className={`p-2 rounded text-gray-600 hover:bg-gray-100 ${annotationTool === 'trend' ? 'bg-blue-100 text-blue-600' : ''}`}
                title="Add Trend Line - Click two points"
              >
                <TrendingUp className="h-4 w-4" />
              </button>
              <button
                onClick={() => enterAnnotationMode('text')}
                className={`p-2 rounded text-gray-600 hover:bg-gray-100 ${annotationTool === 'text' ? 'bg-blue-100 text-blue-600' : ''}`}
                title="Add Text"
              >
                <Target className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Active Technical Indicators */}
      {selectedTechnicalIndicators.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h4 className="font-medium text-gray-900 mb-3">Active Indicators</h4>
          <div className="flex flex-wrap gap-2">
            {selectedTechnicalIndicators.map(indicator => (
              <div key={indicator} className="flex items-center bg-gray-100 rounded px-2 py-1">
                <span className="text-xs text-gray-700">{indicator.toUpperCase()}</span>
                <button
                  onClick={() => removeTechnicalIndicator(indicator)}
                  className="ml-1 text-red-500 hover:text-red-700"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}


      {/* Series Manager */}
      {showSeriesManager && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h4 className="font-medium text-gray-900 mb-3">Manage Series</h4>

          {/* Add New Series */}
          <div className="flex items-center space-x-2 mb-3">
            <input
              type="text"
              value={newSeriesSymbol}
              onChange={(e) => setNewSeriesSymbol(e.target.value.toUpperCase())}
              placeholder="Enter symbol (e.g., AAPL)"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              onKeyPress={(e) => e.key === 'Enter' && addSeries(newSeriesSymbol)}
            />
            <button
              onClick={() => addSeries(newSeriesSymbol)}
              className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
            >
              Add
            </button>
          </div>

          {/* Active Series List */}
          <div className="space-y-2">
            {activeSeries.map((seriesId) => (
              <div key={seriesId} className="flex items-center justify-between bg-gray-50 rounded px-3 py-2">
                <div className="flex items-center space-x-2">
                  <div
                    className="w-4 h-4 rounded"
                    style={{ backgroundColor: seriesColors[seriesId] || '#6b7280' }}
                  />
                  <span className="font-medium text-gray-900">{getSeriesName(seriesId)}</span>
                </div>
                {activeSeries.length > 1 && (
                  <button
                    onClick={() => removeSeries(seriesId)}
                    className="text-red-500 hover:text-red-700 text-sm"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Interactive Chart */}
      <div
        ref={containerRef}
        className="bg-white border border-gray-200 rounded-lg p-4 cursor-move select-none"
        style={{ userSelect: 'none', WebkitUserSelect: 'none', MozUserSelect: 'none' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div className="mb-4 text-sm text-gray-600">
          <div className="flex justify-between">
            <span>💡 Drag axes to scale • Drag chart to pan • Use controls above</span>
            <span>Zoom: {zoom.start.toFixed(0)}% - {zoom.end.toFixed(0)}%</span>
          </div>
        </div>

        {/* Annotation Mode Status Bar */}
        {isAnnotationMode && (
          <div className="bg-blue-100 border border-blue-300 rounded-lg p-3 mb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                <span className="text-blue-800 font-medium">
                  {annotationTool === 'horizontal' && 'Click on chart to place horizontal line'}
                  {annotationTool === 'vertical' && 'Click on chart to place vertical line'}
                  {annotationTool === 'trend' && !isDrawing && 'Click first point for trend line'}
                  {annotationTool === 'trend' && isDrawing && 'Click second point to complete trend line'}
                  {annotationTool === 'text' && 'Click on chart to place text annotation'}
                </span>
              </div>
              <button
                onClick={exitAnnotationMode}
                className="text-blue-600 hover:text-blue-800 font-medium"
              >
                Cancel (ESC)
              </button>
            </div>
          </div>
        )}

        <div className="relative">
          {/* Interactive overlay for annotations */}
          {isAnnotationMode && (
            <div
              className="absolute inset-0 z-10 cursor-crosshair"
              onClick={handleChartClick}
              onMouseMove={handleChartMouseMove}
              style={{ backgroundColor: 'transparent' }}
            />
          )}

          {/* Preview annotation overlay */}
          {previewAnnotation && (
            <div className="absolute inset-0 z-5 pointer-events-none">
              <svg width="100%" height="100%" style={{ position: 'absolute', top: 0, left: 0 }}>
                {previewAnnotation.type === 'horizontal' && (
                  <line
                    x1={0}
                    y1={previewAnnotation.y1}
                    x2="100%"
                    y2={previewAnnotation.y2}
                    stroke={previewAnnotation.color}
                    strokeWidth={previewAnnotation.strokeWidth}
                    strokeDasharray={previewAnnotation.isDashed ? "5,5" : "none"}
                  />
                )}
                {previewAnnotation.type === 'vertical' && (
                  <line
                    x1={previewAnnotation.x1}
                    y1={0}
                    x2={previewAnnotation.x2}
                    y2="100%"
                    stroke={previewAnnotation.color}
                    strokeWidth={previewAnnotation.strokeWidth}
                    strokeDasharray={previewAnnotation.isDashed ? "5,5" : "none"}
                  />
                )}
                {previewAnnotation.type === 'trend' && (
                  <line
                    x1={previewAnnotation.x1}
                    y1={previewAnnotation.y1}
                    x2={previewAnnotation.x2}
                    y2={previewAnnotation.y2}
                    stroke={previewAnnotation.color}
                    strokeWidth={previewAnnotation.strokeWidth}
                    strokeDasharray={previewAnnotation.isDashed ? "5,5" : "none"}
                  />
                )}
              </svg>
            </div>
          )}

        <ResponsiveContainer width="100%" height={height}>
          {chartType === 'area' ? (
            <AreaChart data={displayData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={(value) => new Date(value).toLocaleDateString()}
                stroke="#6b7280"
              />
              <YAxis
                tickFormatter={formatValue}
                stroke="#6b7280"
                domain={calculateYAxisDomain()}
              />
              <Tooltip content={CustomTooltip} />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#3b82f6"
                fill="#3b82f6"
                fillOpacity={0.3}
                strokeWidth={2}
              />
              {/* Technical Indicators */}
              {selectedTechnicalIndicators.map(indicator => (
                <Line
                  key={indicator}
                  type="monotone"
                  dataKey={indicator}
                  stroke={indicator.includes('20') ? '#ef4444' : '#10b981'}
                  strokeWidth={1}
                  dot={false}
                  strokeDasharray="5,5"
                />
              ))}
            </AreaChart>
          ) : chartType === 'bar' ? (
            <BarChart data={displayData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={(value) => new Date(value).toLocaleDateString()}
                stroke="#6b7280"
              />
              <YAxis
                tickFormatter={formatValue}
                stroke="#6b7280"
                domain={calculateYAxisDomain()}
              />
              <Tooltip content={CustomTooltip} />
              <Bar dataKey="value" fill="#3b82f6" />
            </BarChart>
          ) : (
            <LineChart data={displayData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={(value) => new Date(value).toLocaleDateString()}
                stroke="#6b7280"
              />
              <YAxis
                tickFormatter={formatValue}
                stroke="#6b7280"
                domain={calculateYAxisDomain()}
              />
              <Tooltip content={CustomTooltip} />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: '#3b82f6' }}
              />
              {/* Technical Indicators */}
              {selectedTechnicalIndicators.map(indicator => (
                <Line
                  key={indicator}
                  type="monotone"
                  dataKey={indicator}
                  stroke={indicator.includes('20') ? '#ef4444' : '#10b981'}
                  strokeWidth={1}
                  dot={false}
                  strokeDasharray="5,5"
                />
              ))}
              {/* Annotations as Reference Lines */}
              {annotations.filter(a => a.isVisible).map(annotation => {
                if (annotation.type === 'horizontal') {
                  return (
                    <ReferenceLine
                      key={annotation.id}
                      y={annotation.y1}
                      stroke={annotation.color}
                      strokeDasharray={annotation.isDashed ? "5,5" : undefined}
                      strokeWidth={annotation.strokeWidth || 2}
                    />
                  )
                }
                if (annotation.type === 'vertical') {
                  return (
                    <ReferenceLine
                      key={annotation.id}
                      x={annotation.x1}
                      stroke={annotation.color}
                      strokeDasharray={annotation.isDashed ? "5,5" : undefined}
                      strokeWidth={annotation.strokeWidth || 2}
                    />
                  )
                }
                return null
              })}
            </LineChart>
          )}
        </ResponsiveContainer>

          {/* Permanent annotations overlay */}
          {annotations.length > 0 && (
            <div className="absolute inset-0 z-3 pointer-events-none">
              <svg width="100%" height="100%" style={{ position: 'absolute', top: 0, left: 0 }}>
                {annotations.map((annotation) => {
                  if (!annotation.isVisible) return null

                  return (
                    <g key={annotation.id}>
                      {annotation.type === 'horizontal' && (
                        <line
                          x1={0}
                          y1={annotation.y1}
                          x2="100%"
                          y2={annotation.y2}
                          stroke={annotation.color}
                          strokeWidth={annotation.strokeWidth}
                          strokeDasharray={annotation.isDashed ? "5,5" : "none"}
                        />
                      )}
                      {annotation.type === 'vertical' && (
                        <line
                          x1={annotation.x1}
                          y1={0}
                          x2={annotation.x2}
                          y2="100%"
                          stroke={annotation.color}
                          strokeWidth={annotation.strokeWidth}
                          strokeDasharray={annotation.isDashed ? "5,5" : "none"}
                        />
                      )}
                      {annotation.type === 'trend' && (
                        <line
                          x1={annotation.x1}
                          y1={annotation.y1}
                          x2={annotation.x2}
                          y2={annotation.y2}
                          stroke={annotation.color}
                          strokeWidth={annotation.strokeWidth}
                          strokeDasharray={annotation.isDashed ? "5,5" : "none"}
                        />
                      )}
                      {annotation.type === 'text' && annotation.text && (
                        <text
                          x={annotation.x1}
                          y={annotation.y1}
                          fill={annotation.color}
                          fontSize="12"
                          fontWeight="bold"
                        >
                          {annotation.text}
                        </text>
                      )}
                    </g>
                  )
                })}
              </svg>
            </div>
          )}
        </div>
      </div>

      {/* Statistics Panel */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 p-4 bg-gray-50 rounded-lg">
        {statistics.filter(stat => stat.visible).map(stat => (
          <div key={stat.id} className="text-center">
            <div className="text-xs text-gray-600 uppercase tracking-wide">{stat.name}</div>
            <div className="text-lg font-semibold" style={{ color: stat.color }}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* Annotations Manager */}
      {annotations.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h4 className="font-medium text-gray-900 mb-3">Annotations ({annotations.length})</h4>
          <div className="space-y-2">
            {annotations.map(annotation => (
              <div key={annotation.id} className="flex items-center justify-between bg-gray-50 rounded px-3 py-2">
                <div className="flex items-center space-x-3">
                  <div
                    className="w-3 h-3 rounded"
                    style={{ backgroundColor: annotation.color }}
                  />
                  <span className="text-sm text-gray-700 capitalize">
                    {annotation.type} {annotation.text && `- ${annotation.text}`}
                  </span>
                  <button
                    onClick={() => toggleAnnotationVisibility(annotation.id)}
                    className={`text-xs px-2 py-1 rounded ${
                      annotation.isVisible
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {annotation.isVisible ? 'Visible' : 'Hidden'}
                  </button>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="color"
                    value={annotation.color}
                    onChange={(e) => setAnnotations(prev => prev.map(a =>
                      a.id === annotation.id ? { ...a, color: e.target.value } : a
                    ))}
                    className="w-6 h-6 rounded border"
                  />
                  <button
                    onClick={() => deleteAnnotation(annotation.id)}
                    className="text-red-500 hover:text-red-700 text-sm"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}