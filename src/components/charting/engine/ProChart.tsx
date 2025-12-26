import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import {
  OHLC,
  ChartTheme,
  ChartType,
  ViewState,
  ChartDimensions,
  defaultLightTheme,
  defaultDimensions
} from './types'
import { ChartTransform } from './transform'
import { ChartRenderer, IndicatorRenderConfig, LineStyle } from './renderer'
import { SubPanelRenderer, SubPanelData } from './SubPanelRenderer'
import { chartDataService, timeframeToParams, CandlestickData } from '../../../lib/chartData'
import {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateStochastic,
  calculateATR,
  calculateVWAP,
  calculateOBV,
  calculateADX,
  IndicatorConfig
} from './indicators'
import {
  AnnotationRenderer,
  ChartEvent,
  Annotation
} from './annotations'

export type TimeFrame = '1D' | '1W' | '1M' | '3M' | '6M' | '1Y' | '5Y' | 'ALL' | 'CUSTOM'

// Custom date range for the chart
export interface CustomDateRange {
  startDate: Date
  endDate: Date
  interval: '1m' | '5m' | '15m' | '30m' | '1h' | '1d' | '1wk' | '1mo'
}

// Indicator types available for the chart
export type IndicatorType = 'sma' | 'ema' | 'rsi' | 'macd' | 'bollinger' | 'stochastic' | 'atr' | 'vwap' | 'obv' | 'adx'

// Colors for different indicators
const INDICATOR_COLORS: Record<string, string> = {
  sma: '#f59e0b',      // Amber
  sma_10: '#f59e0b',
  sma_20: '#3b82f6',   // Blue
  sma_50: '#10b981',   // Green
  sma_200: '#ef4444',  // Red
  ema: '#8b5cf6',      // Purple
  ema_12: '#8b5cf6',
  ema_26: '#ec4899',   // Pink
  vwap: '#06b6d4',     // Cyan
  bollinger: '#9333ea', // Purple
  rsi: '#8b5cf6',
  macd: '#2563eb',
  stochastic: '#2563eb',
  atr: '#f97316',
  obv: '#22c55e',
  adx: '#ef4444'
}

// Comparison symbol configuration
export interface CompareSymbol {
  symbol: string
  companyName?: string
  color?: string
  lineWidth?: number
  lineStyle?: LineStyle
}

// Display modes for comparison
export type DisplayMode = 'absolute' | 'indexed' | 'relative'

// Main symbol style configuration
export interface MainSymbolStyle {
  color?: string
  lineWidth?: number
  lineStyle?: LineStyle
}

interface ProChartProps {
  symbol: string
  chartType: ChartType
  timeFrame: TimeFrame
  customRange?: CustomDateRange
  showVolume?: boolean
  theme?: ChartTheme
  indicators?: IndicatorType[]
  events?: ChartEvent[]
  annotations?: Annotation[]
  compareSymbols?: CompareSymbol[]
  displayMode?: DisplayMode
  indexBase?: number
  selectedLine?: string | null // Currently selected line symbol
  mainSymbolStyle?: MainSymbolStyle // Styling for main symbol
  onCrosshairMove?: (price: number | null, time: number | null) => void
  onContextMenu?: (e: React.MouseEvent, chartTime: number, chartPrice: number) => void
  onLineContextMenu?: (e: React.MouseEvent, symbol: string, isMainSymbol: boolean) => void
  onLineClick?: (symbol: string, isMainSymbol: boolean) => void // Left-click on line to select
}

// Convert API data to OHLC format
function convertToOHLC(data: CandlestickData[]): OHLC[] {
  return data.map(d => ({
    time: typeof d.time === 'string' && !isNaN(Number(d.time))
      ? Number(d.time)
      : new Date(d.time).getTime() / 1000,
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
    volume: d.volume
  }))
}

export function ProChart({
  symbol,
  chartType,
  timeFrame,
  customRange,
  showVolume = false,
  theme = defaultLightTheme,
  indicators = [],
  events = [],
  annotations = [],
  compareSymbols = [],
  displayMode = 'absolute',
  indexBase = 100,
  selectedLine = null,
  mainSymbolStyle,
  onCrosshairMove,
  onContextMenu,
  onLineContextMenu,
  onLineClick
}: ProChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<ChartRenderer | null>(null)
  const transformRef = useRef<ChartTransform | null>(null)
  const subPanelRendererRef = useRef<SubPanelRenderer | null>(null)
  const annotationRendererRef = useRef<AnnotationRenderer | null>(null)
  const lastHistoricalFetchRef = useRef<number>(0) // Timestamp of last historical fetch

  const [dimensions, setDimensions] = useState<ChartDimensions>(defaultDimensions)
  const [data, setData] = useState<OHLC[]>([])
  const [compareData, setCompareData] = useState<Map<string, OHLC[]>>(new Map())
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ViewState>({
    startTime: 0,
    endTime: 0,
    minPrice: 0,
    maxPrice: 100,
    autoScalePrice: true
  })

  // Track the current interval for loading more data
  const [currentInterval, setCurrentInterval] = useState<string>('1d')

  // Separate indicators into main chart overlays and sub-panels
  const mainChartIndicators: IndicatorType[] = useMemo(() =>
    indicators.filter(i => ['sma', 'ema', 'bollinger', 'vwap'].includes(i)),
    [indicators]
  )

  const subPanelIndicators: IndicatorType[] = useMemo(() =>
    indicators.filter(i => ['rsi', 'macd', 'stochastic', 'atr', 'obv', 'adx'].includes(i)),
    [indicators]
  )

  // Calculate indicator data
  const indicatorData = useMemo(() => {
    if (data.length === 0) return { main: [], subPanels: [] }

    const main: IndicatorRenderConfig[] = []
    const subPanels: SubPanelData[] = []

    // Main chart indicators
    for (const indicator of mainChartIndicators) {
      switch (indicator) {
        case 'sma':
          // Add multiple SMAs with different periods
          main.push({
            type: 'line',
            data: calculateSMA(data, 20),
            color: INDICATOR_COLORS.sma_20,
            label: 'SMA 20'
          })
          main.push({
            type: 'line',
            data: calculateSMA(data, 50),
            color: INDICATOR_COLORS.sma_50,
            label: 'SMA 50'
          })
          break
        case 'ema':
          main.push({
            type: 'line',
            data: calculateEMA(data, 12),
            color: INDICATOR_COLORS.ema_12,
            label: 'EMA 12'
          })
          main.push({
            type: 'line',
            data: calculateEMA(data, 26),
            color: INDICATOR_COLORS.ema_26,
            label: 'EMA 26'
          })
          break
        case 'bollinger':
          main.push({
            type: 'bollinger',
            data: calculateBollingerBands(data, 20, 2),
            label: 'Bollinger Bands'
          })
          break
        case 'vwap':
          main.push({
            type: 'line',
            data: calculateVWAP(data),
            color: INDICATOR_COLORS.vwap,
            label: 'VWAP'
          })
          break
      }
    }

    // Sub-panel indicators
    for (const indicator of subPanelIndicators) {
      switch (indicator) {
        case 'rsi':
          subPanels.push({
            config: { id: 'rsi', type: 'rsi', height: 0.15, title: 'RSI (14)', range: [0, 100] },
            data: calculateRSI(data, 14)
          })
          break
        case 'macd':
          subPanels.push({
            config: { id: 'macd', type: 'macd', height: 0.15, title: 'MACD (12, 26, 9)' },
            data: calculateMACD(data, 12, 26, 9)
          })
          break
        case 'stochastic':
          subPanels.push({
            config: { id: 'stochastic', type: 'stochastic', height: 0.15, title: 'Stochastic (14, 3)', range: [0, 100] },
            data: calculateStochastic(data, 14, 3)
          })
          break
        case 'atr':
          subPanels.push({
            config: { id: 'atr', type: 'custom', height: 0.12, title: 'ATR (14)' },
            data: calculateATR(data, 14)
          })
          break
        case 'obv':
          subPanels.push({
            config: { id: 'obv', type: 'custom', height: 0.12, title: 'OBV' },
            data: calculateOBV(data)
          })
          break
        case 'adx':
          subPanels.push({
            config: { id: 'adx', type: 'custom', height: 0.12, title: 'ADX (14)' },
            data: calculateADX(data, 14)
          })
          break
      }
    }

    return { main, subPanels }
  }, [data, mainChartIndicators, subPanelIndicators])

  // Interaction state
  const [isDragging, setIsDragging] = useState(false)
  const [dragMode, setDragMode] = useState<'pan' | 'zoom-price' | 'zoom-time'>('pan')
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, viewStart: 0, viewEnd: 0, minPrice: 0, maxPrice: 0 })
  const [crosshair, setCrosshair] = useState<{ x: number; y: number } | null>(null)
  const [cursorStyle, setCursorStyle] = useState('crosshair')
  const [hoveredLine, setHoveredLine] = useState<string | null>(null) // symbol of hovered line

  // Device pixel ratio for sharp rendering
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1

  // Create a stable key for customRange to ensure useEffect triggers on changes
  const customRangeKey = customRange
    ? `${customRange.startDate.getTime()}-${customRange.endDate.getTime()}-${customRange.interval}`
    : null

  // Fetch data when symbol or timeframe changes
  useEffect(() => {
    if (!symbol) return

    console.log('ProChart useEffect triggered:', {
      symbol,
      timeFrame,
      customRangeKey,
      hasCustomRange: !!customRange
    })

    const fetchData = async () => {
      setIsLoading(true)
      setError(null)
      lastHistoricalFetchRef.current = 0 // Reset historical fetch tracking

      try {
        let rawData: CandlestickData[]
        let interval: string

        if (timeFrame === 'CUSTOM' && customRange) {
          // Use custom date range
          interval = customRange.interval
          setCurrentInterval(interval)

          console.log('ProChart: Fetching custom range:', {
            symbol: symbol.toUpperCase(),
            start: customRange.startDate.toISOString(),
            end: customRange.endDate.toISOString(),
            interval,
            startTimestamp: Math.floor(customRange.startDate.getTime() / 1000),
            endTimestamp: Math.floor(customRange.endDate.getTime() / 1000)
          })

          rawData = await chartDataService.getCustomRangeData(
            symbol.toUpperCase(),
            customRange.startDate,
            customRange.endDate,
            interval
          )
          console.log('ProChart: Custom range data returned:', rawData.length, 'points')
        } else {
          // Use preset timeframe
          const params = timeframeToParams[timeFrame] || { interval: '1d', range: '1mo' }
          interval = params.interval
          setCurrentInterval(interval)

          rawData = await chartDataService.getChartData({
            symbol: symbol.toUpperCase(),
            interval: params.interval as any,
            range: params.range as any
          })
        }

        if (rawData.length === 0) {
          setError('No data available for this symbol')
          setData([])
        } else {
          const ohlcData = convertToOHLC(rawData)
          setData(ohlcData)

          // Calculate initial view
          const timeRange = ChartTransform.calculateTimeRange(ohlcData)
          const priceRange = ChartTransform.calculatePriceRange(ohlcData)

          // Minimal padding on the right (just enough for the last candle to be fully visible)
          // Use ~1 candle width worth of padding based on data density
          const avgCandleWidth = ohlcData.length > 1
            ? (timeRange.end - timeRange.start) / ohlcData.length
            : 0
          const rightPadding = avgCandleWidth * 2 // 2 candle widths of padding

          setView({
            startTime: timeRange.start,
            endTime: timeRange.end + rightPadding,
            minPrice: priceRange.min,
            maxPrice: priceRange.max,
            autoScalePrice: true
          })
        }
      } catch (err) {
        setError('Failed to load chart data')
        console.error('Chart data fetch error:', err)
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
    // customRangeKey is derived from customRange and ensures the effect triggers on changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeFrame, customRangeKey, customRange])

  // Fetch comparison symbol data
  useEffect(() => {
    if (compareSymbols.length === 0) {
      setCompareData(new Map())
      return
    }

    const fetchCompareData = async () => {
      const newCompareData = new Map<string, OHLC[]>()

      for (const compare of compareSymbols) {
        try {
          let rawData: CandlestickData[]

          if (timeFrame === 'CUSTOM' && customRange) {
            rawData = await chartDataService.getCustomRangeData(
              compare.symbol.toUpperCase(),
              customRange.startDate,
              customRange.endDate,
              customRange.interval
            )
          } else {
            const params = timeframeToParams[timeFrame] || { interval: '1d', range: '1mo' }
            rawData = await chartDataService.getChartData({
              symbol: compare.symbol.toUpperCase(),
              interval: params.interval as any,
              range: params.range as any
            })
          }

          if (rawData.length > 0) {
            newCompareData.set(compare.symbol, convertToOHLC(rawData))
          }
        } catch (err) {
          console.error(`Failed to load comparison data for ${compare.symbol}:`, err)
        }
      }

      setCompareData(newCompareData)
    }

    fetchCompareData()
  }, [compareSymbols, timeFrame, customRange])

  // Transform data based on display mode
  const transformedData = useMemo(() => {
    if (data.length === 0) return { main: data, compare: new Map<string, OHLC[]>() }

    if (displayMode === 'absolute') {
      return { main: data, compare: compareData }
    }

    // For indexed/relative modes, find common starting time across all series
    // Use the LATEST first timestamp so all series have data at that point
    let commonStartTime = data[0]?.time || 0
    compareData.forEach((compData) => {
      if (compData.length > 0 && compData[0].time > commonStartTime) {
        commonStartTime = compData[0].time
      }
    })

    // Helper to find close price at or after a given time
    const findCloseAtTime = (series: OHLC[], targetTime: number): number => {
      const point = series.find(d => d.time >= targetTime)
      return point?.close || series[0]?.close || 1
    }

    // Get base close prices at the common start time
    const mainBaseClose = findCloseAtTime(data, commonStartTime)

    // Index mode: normalize to indexBase (default 100) at common start
    if (displayMode === 'indexed') {
      const indexedMain = data.map(d => ({
        ...d,
        open: (d.open / mainBaseClose) * indexBase,
        high: (d.high / mainBaseClose) * indexBase,
        low: (d.low / mainBaseClose) * indexBase,
        close: (d.close / mainBaseClose) * indexBase
      }))

      const indexedCompare = new Map<string, OHLC[]>()
      compareData.forEach((compData, sym) => {
        const compBaseClose = findCloseAtTime(compData, commonStartTime)
        indexedCompare.set(sym, compData.map(d => ({
          ...d,
          open: (d.open / compBaseClose) * indexBase,
          high: (d.high / compBaseClose) * indexBase,
          low: (d.low / compBaseClose) * indexBase,
          close: (d.close / compBaseClose) * indexBase
        })))
      })

      return { main: indexedMain, compare: indexedCompare }
    }

    // Relative mode: show % change from common start
    if (displayMode === 'relative') {
      const relativeMain = data.map(d => ({
        ...d,
        open: ((d.open - mainBaseClose) / mainBaseClose) * 100,
        high: ((d.high - mainBaseClose) / mainBaseClose) * 100,
        low: ((d.low - mainBaseClose) / mainBaseClose) * 100,
        close: ((d.close - mainBaseClose) / mainBaseClose) * 100
      }))

      const relativeCompare = new Map<string, OHLC[]>()
      compareData.forEach((compData, sym) => {
        const compBaseClose = findCloseAtTime(compData, commonStartTime)
        relativeCompare.set(sym, compData.map(d => ({
          ...d,
          open: ((d.open - compBaseClose) / compBaseClose) * 100,
          high: ((d.high - compBaseClose) / compBaseClose) * 100,
          low: ((d.low - compBaseClose) / compBaseClose) * 100,
          close: ((d.close - compBaseClose) / compBaseClose) * 100
        })))
      })

      return { main: relativeMain, compare: relativeCompare }
    }

    return { main: data, compare: compareData }
  }, [data, compareData, displayMode, indexBase])

  // Helper function to calculate distance from point to line segment
  const distanceToLineSegment = useCallback((px: number, py: number, x1: number, y1: number, x2: number, y2: number): number => {
    const dx = x2 - x1
    const dy = y2 - y1
    const lengthSquared = dx * dx + dy * dy

    if (lengthSquared === 0) {
      // Segment is a point
      return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2)
    }

    // Project point onto line segment
    let t = ((px - x1) * dx + (py - y1) * dy) / lengthSquared
    t = Math.max(0, Math.min(1, t)) // Clamp to segment

    const closestX = x1 + t * dx
    const closestY = y1 + t * dy

    return Math.sqrt((px - closestX) ** 2 + (py - closestY) ** 2)
  }, [])

  // Helper function to detect which line is near a given point
  const detectLineAtPoint = useCallback((x: number, y: number): string | null => {
    if (!transformRef.current || data.length === 0) return null

    const threshold = 10 // pixels threshold for line detection

    // Helper to check if click is near any segment of a line
    const isNearLine = (lineData: OHLC[]): boolean => {
      // Filter to visible data only for performance
      const visibleData = lineData.filter(d =>
        d.time >= view.startTime && d.time <= view.endTime
      )

      for (let i = 0; i < visibleData.length - 1; i++) {
        const x1 = transformRef.current!.timeToX(visibleData[i].time)
        const y1 = transformRef.current!.priceToY(visibleData[i].close)
        const x2 = transformRef.current!.timeToX(visibleData[i + 1].time)
        const y2 = transformRef.current!.priceToY(visibleData[i + 1].close)

        const dist = distanceToLineSegment(x, y, x1, y1, x2, y2)
        if (dist < threshold) return true
      }
      return false
    }

    // Helper to check if click is near any candlestick/bar
    const isNearCandle = (candleData: OHLC[]): boolean => {
      const visibleData = candleData.filter(d =>
        d.time >= view.startTime && d.time <= view.endTime
      )

      // Calculate candle width based on visible data
      const candleWidth = visibleData.length > 1
        ? Math.abs(transformRef.current!.timeToX(visibleData[1].time) - transformRef.current!.timeToX(visibleData[0].time)) * 0.8
        : 10

      for (const candle of visibleData) {
        const candleX = transformRef.current!.timeToX(candle.time)
        const highY = transformRef.current!.priceToY(candle.high)
        const lowY = transformRef.current!.priceToY(candle.low)

        // Check if click is within candle horizontal bounds (with threshold)
        if (x >= candleX - candleWidth / 2 - threshold && x <= candleX + candleWidth / 2 + threshold) {
          // Check if click is within candle vertical bounds (wick from low to high)
          if (y >= highY - threshold && y <= lowY + threshold) {
            return true
          }
        }
      }
      return false
    }

    // Check main symbol - use candle detection for candlestick/bar charts, line detection for others
    if (chartType === 'candlestick' || chartType === 'bar') {
      if (isNearCandle(transformedData.main)) {
        return symbol
      }
    } else {
      if (isNearLine(transformedData.main)) {
        return symbol
      }
    }

    // Check comparison lines (always rendered as lines)
    for (const cs of compareSymbols) {
      const compData = transformedData.compare.get(cs.symbol)
      if (!compData || compData.length === 0) continue

      if (isNearLine(compData)) {
        return cs.symbol
      }
    }

    return null
  }, [data, symbol, compareSymbols, transformedData, view.startTime, view.endTime, distanceToLineSegment, chartType])

  // Calculate comparison symbol lines (after transformedData is available)
  const comparisonLines: IndicatorRenderConfig[] = useMemo(() => {
    const lines: IndicatorRenderConfig[] = []

    compareSymbols.forEach((compare) => {
      const compData = transformedData.compare.get(compare.symbol)
      if (compData && compData.length > 0) {
        // Create line data from close prices
        const lineData = compData.map(d => ({
          time: d.time,
          value: d.close
        }))
        lines.push({
          type: 'line',
          data: lineData,
          color: compare.color || '#666666',
          lineWidth: compare.lineWidth || 2,
          lineStyle: compare.lineStyle || 'solid',
          label: compare.symbol
        })
      }
    })

    return lines
  }, [compareSymbols, transformedData.compare])

  // Handle resize
  useEffect(() => {
    if (!containerRef.current) return

    const updateSize = () => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      setDimensions({
        ...defaultDimensions,
        width: rect.width,
        height: rect.height
      })
    }

    updateSize()

    const resizeObserver = new ResizeObserver(updateSize)
    resizeObserver.observe(containerRef.current)

    return () => resizeObserver.disconnect()
  }, [])

  // Calculate main chart height based on sub-panels
  const mainChartHeightRatio = useMemo(() => {
    if (indicatorData.subPanels.length === 0) return 1
    // Reserve space for sub-panels (each takes ~15% max, limit to 45% total)
    const subPanelRatio = Math.min(0.45, indicatorData.subPanels.length * 0.15)
    return 1 - subPanelRatio
  }, [indicatorData.subPanels.length])

  // Initialize canvas and renderer
  useEffect(() => {
    if (!canvasRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas size for high DPI
    canvas.width = dimensions.width * dpr
    canvas.height = dimensions.height * dpr
    canvas.style.width = `${dimensions.width}px`
    canvas.style.height = `${dimensions.height}px`

    // Adjust dimensions for main chart (leave room for sub-panels)
    const mainChartDimensions: ChartDimensions = {
      ...dimensions,
      height: dimensions.height * mainChartHeightRatio
    }

    // Create transform and renderer
    const transform = new ChartTransform(mainChartDimensions, view)
    const renderer = new ChartRenderer(ctx, theme, transform, dpr)
    const subPanelRenderer = new SubPanelRenderer(ctx, theme, transform, dpr)
    const annotationRenderer = new AnnotationRenderer(ctx, theme, transform, dpr)

    transformRef.current = transform
    rendererRef.current = renderer
    subPanelRendererRef.current = subPanelRenderer
    annotationRendererRef.current = annotationRenderer
  }, [dimensions, dpr, theme, mainChartHeightRatio])

  // Render chart
  useEffect(() => {
    if (!rendererRef.current || !transformRef.current || data.length === 0) return

    // Adjust dimensions for main chart
    const mainChartDimensions: ChartDimensions = {
      ...dimensions,
      height: dimensions.height * mainChartHeightRatio
    }

    transformRef.current.setView(view)
    transformRef.current.setDimensions(mainChartDimensions)
    rendererRef.current.setTransform(transformRef.current)
    rendererRef.current.setTheme(theme)

    // Use transformed data for rendering (handles indexed/relative modes)
    const renderData = transformedData.main

    // Filter visible data
    const visibleData = renderData.filter(
      d => d.time >= view.startTime && d.time <= view.endTime
    )

    // Render main chart with indicators and comparison lines
    rendererRef.current.renderWithIndicators(
      visibleData,
      chartType,
      showVolume,
      [...indicatorData.main, ...comparisonLines],
      crosshair || undefined,
      mainSymbolStyle
    )

    // Render events and annotations
    if (annotationRendererRef.current && (events.length > 0 || annotations.length > 0)) {
      annotationRendererRef.current.setTheme(theme)
      annotationRendererRef.current.setTransform(transformRef.current)
      annotationRendererRef.current.render(events, annotations)
    }

    // Render sub-panels
    if (subPanelRendererRef.current && indicatorData.subPanels.length > 0) {
      subPanelRendererRef.current.setTheme(theme)
      subPanelRendererRef.current.setMainTransform(transformRef.current)

      const mainChartBottom = dimensions.height * mainChartHeightRatio
      subPanelRendererRef.current.renderSubPanels(
        indicatorData.subPanels,
        mainChartBottom,
        dimensions.height
      )
    }

    // Draw selection dots on the selected line
    if (selectedLine && rendererRef.current) {
      if (selectedLine === symbol) {
        // Main symbol selected - draw dots on main data
        rendererRef.current.drawSelectionDots(transformedData.main, mainSymbolStyle?.color || '#3b82f6')
      } else {
        // Comparison symbol selected - find its data and color
        const compareSymbol = compareSymbols.find(cs => cs.symbol === selectedLine)
        const compareData = transformedData.compare.get(selectedLine)
        if (compareData && compareData.length > 0) {
          rendererRef.current.drawSelectionDots(compareData, compareSymbol?.color || '#666666')
        }
      }
    }
  }, [data, view, dimensions, chartType, showVolume, theme, crosshair, indicatorData, mainChartHeightRatio, events, annotations, transformedData, comparisonLines, selectedLine, symbol, compareSymbols, mainSymbolStyle])

  // Auto-scale price when view changes
  useEffect(() => {
    if (!view.autoScalePrice || data.length === 0) return

    // Use transformed data for auto-scaling in indexed/relative modes
    const scaleData = transformedData.main
    const visibleData = scaleData.filter(
      d => d.time >= view.startTime && d.time <= view.endTime
    )

    // Also include comparison data in the price range
    let allVisibleData = [...visibleData]
    transformedData.compare.forEach((compData) => {
      const visibleCompData = compData.filter(
        d => d.time >= view.startTime && d.time <= view.endTime
      )
      allVisibleData = allVisibleData.concat(visibleCompData)
    })

    if (allVisibleData.length > 0) {
      const priceRange = ChartTransform.calculatePriceRange(allVisibleData)
      setView(v => ({
        ...v,
        minPrice: priceRange.min,
        maxPrice: priceRange.max
      }))
    }
  }, [view.startTime, view.endTime, data, view.autoScalePrice, transformedData])

  // Load more historical data when panning past available data
  useEffect(() => {
    if (data.length === 0 || isLoadingMore || isLoading) return

    // Debounce: don't fetch again within 2 seconds
    const now = Date.now()
    if (now - lastHistoricalFetchRef.current < 2000) return

    // Get the earliest data point time
    const earliestDataTime = Math.min(...data.map(d => d.time))

    // Check if view has panned past the earliest data (with a small buffer)
    const viewRange = view.endTime - view.startTime
    const loadThreshold = earliestDataTime + viewRange * 0.2 // Load when 20% past visible

    if (view.startTime < loadThreshold) {
      // Mark fetch time
      lastHistoricalFetchRef.current = now
      // Calculate how much more data to fetch
      // Duration based on interval type
      let durationSeconds: number
      switch (currentInterval) {
        case '1m':
          durationSeconds = 60 * 60 * 24 // 1 day of 1m data
          break
        case '5m':
          durationSeconds = 60 * 60 * 24 * 5 // 5 days of 5m data
          break
        case '15m':
          durationSeconds = 60 * 60 * 24 * 7 // 1 week of 15m data
          break
        case '30m':
          durationSeconds = 60 * 60 * 24 * 14 // 2 weeks of 30m data
          break
        case '60m':
        case '1h':
          durationSeconds = 60 * 60 * 24 * 30 // 1 month of hourly data
          break
        case '1d':
          durationSeconds = 60 * 60 * 24 * 365 // 1 year of daily data
          break
        case '1wk':
          durationSeconds = 60 * 60 * 24 * 365 * 2 // 2 years of weekly data
          break
        case '1mo':
          durationSeconds = 60 * 60 * 24 * 365 * 5 // 5 years of monthly data
          break
        default:
          durationSeconds = 60 * 60 * 24 * 30 // Default: 1 month
      }

      const loadMoreData = async () => {
        setIsLoadingMore(true)
        try {
          const moreData = await chartDataService.getHistoricalData(
            symbol.toUpperCase(),
            currentInterval,
            earliestDataTime,
            durationSeconds
          )

          if (moreData.length > 0) {
            const moreOHLC = convertToOHLC(moreData)

            // Merge with existing data, avoiding duplicates
            setData(prevData => {
              const existingTimes = new Set(prevData.map(d => d.time))
              const newPoints = moreOHLC.filter(d => !existingTimes.has(d.time))

              if (newPoints.length > 0) {
                // Combine and sort by time
                const combined = [...newPoints, ...prevData]
                combined.sort((a, b) => a.time - b.time)
                return combined
              }
              return prevData
            })
          }
        } catch (err) {
          console.error('Failed to load more historical data:', err)
        } finally {
          setIsLoadingMore(false)
        }
      }

      loadMoreData()
    }
  }, [view.startTime, view.endTime, data, isLoadingMore, isLoading, symbol, currentInterval])

  // Mouse handlers
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect || !transformRef.current) return

    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const area = transformRef.current.chartArea
    const dims = transformRef.current.getDimensions()

    // Determine drag mode based on click location
    let mode: 'pan' | 'zoom-price' | 'zoom-time' = 'pan'

    // Check if clicking on price axis (right side)
    if (x > area.x + area.width && x <= dims.width) {
      mode = 'zoom-price'
    }
    // Check if clicking on time axis (bottom)
    else if (y > area.y + area.height && y <= dims.height) {
      mode = 'zoom-time'
    }

    setIsDragging(true)
    setDragMode(mode)
    setDragStart({
      x,
      y,
      viewStart: view.startTime,
      viewEnd: view.endTime,
      minPrice: view.minPrice,
      maxPrice: view.maxPrice
    })
  }, [view])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect || !transformRef.current) return

    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const area = transformRef.current.chartArea
    const dims = transformRef.current.getDimensions()

    // Update cursor style based on position (only when not dragging)
    if (!isDragging) {
      let cursor = 'crosshair'
      // On price axis (right side) - show vertical resize cursor
      if (x > area.x + area.width && x <= dims.width && y >= area.y && y <= area.y + area.height) {
        cursor = 'ns-resize'
      }
      // On time axis (bottom) - show horizontal resize cursor
      else if (y > area.y + area.height && y <= dims.height && x >= area.x && x <= area.x + area.width) {
        cursor = 'ew-resize'
      }
      // In chart area - show crosshair
      else if (x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height) {
        cursor = 'crosshair'
      } else {
        cursor = 'default'
      }
      setCursorStyle(cursor)
    }

    // Update crosshair
    if (x >= area.x && x <= area.x + area.width &&
        y >= area.y && y <= area.y + area.height) {
      setCrosshair({ x, y })

      if (onCrosshairMove) {
        const price = transformRef.current.yToPrice(y)
        const time = transformRef.current.xToTime(x)
        onCrosshairMove(price, time)
      }
    } else {
      setCrosshair(null)
      if (onCrosshairMove) {
        onCrosshairMove(null, null)
      }
    }

    // Handle dragging
    if (isDragging) {
      const dx = x - dragStart.x
      const dy = y - dragStart.y

      if (dragMode === 'pan') {
        // Pan mode: shift view in both axes
        const timeRange = dragStart.viewEnd - dragStart.viewStart
        const timeDelta = -(dx / area.width) * timeRange

        const priceRange = dragStart.maxPrice - dragStart.minPrice
        const priceDelta = (dy / area.height) * priceRange

        setView(v => ({
          ...v,
          startTime: dragStart.viewStart + timeDelta,
          endTime: dragStart.viewEnd + timeDelta,
          minPrice: dragStart.minPrice + priceDelta,
          maxPrice: dragStart.maxPrice + priceDelta,
          autoScalePrice: false
        }))
      } else if (dragMode === 'zoom-price') {
        // Zoom price axis: drag up to zoom in, down to zoom out
        const zoomFactor = 1 + (dy / 100) // Sensitivity factor
        const priceRange = dragStart.maxPrice - dragStart.minPrice
        const newPriceRange = priceRange * zoomFactor

        // Keep the center price fixed
        const centerPrice = (dragStart.maxPrice + dragStart.minPrice) / 2
        const newMinPrice = centerPrice - newPriceRange / 2
        const newMaxPrice = centerPrice + newPriceRange / 2

        // Clamp to prevent inverting or extreme zoom
        if (newPriceRange > 0.001 && newPriceRange < priceRange * 10) {
          setView(v => ({
            ...v,
            minPrice: newMinPrice,
            maxPrice: newMaxPrice,
            autoScalePrice: false
          }))
        }
      } else if (dragMode === 'zoom-time') {
        // Zoom time axis: drag left to zoom in, right to zoom out
        const zoomFactor = 1 + (dx / 100) // Sensitivity factor
        const timeRange = dragStart.viewEnd - dragStart.viewStart
        const newTimeRange = timeRange * zoomFactor

        // Keep the center time fixed
        const centerTime = (dragStart.viewEnd + dragStart.viewStart) / 2
        const newStartTime = centerTime - newTimeRange / 2
        const newEndTime = centerTime + newTimeRange / 2

        // Clamp to prevent inverting or extreme zoom
        if (newTimeRange > 60 && newTimeRange < timeRange * 10) { // At least 1 minute
          setView(v => ({
            ...v,
            startTime: newStartTime,
            endTime: newEndTime
          }))
        }
      }
    }
  }, [isDragging, dragStart, dragMode, onCrosshairMove])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
    setDragMode('pan')
  }, [])

  const handleMouseLeave = useCallback(() => {
    // Only clear crosshair when leaving, don't cancel drag
    // Drag will be handled by window-level events
    setCrosshair(null)
    if (onCrosshairMove) {
      onCrosshairMove(null, null)
    }
  }, [onCrosshairMove])

  // Click handler for line selection (left-click)
  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!transformRef.current || !onLineClick) return

    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return

    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const area = transformRef.current.chartArea

    // Only handle clicks within the chart area
    if (x >= area.x && x <= area.x + area.width &&
        y >= area.y && y <= area.y + area.height) {
      const lineSymbol = detectLineAtPoint(x, y)
      if (lineSymbol) {
        const isMainSymbol = lineSymbol === symbol
        onLineClick(lineSymbol, isMainSymbol)
      }
    }
  }, [onLineClick, detectLineAtPoint, symbol])

  // Context menu handler for right-click annotations
  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!transformRef.current) return

    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return

    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const area = transformRef.current.chartArea

    // Only show context menu if clicking within the chart area
    if (x >= area.x && x <= area.x + area.width &&
        y >= area.y && y <= area.y + area.height) {
      e.preventDefault()

      // Check if clicking on a line
      const lineSymbol = detectLineAtPoint(x, y)
      if (lineSymbol && onLineContextMenu) {
        const isMainSymbol = lineSymbol === symbol
        onLineContextMenu(e, lineSymbol, isMainSymbol)
        return
      }

      // Otherwise show annotation context menu
      if (onContextMenu) {
        const chartTime = transformRef.current.xToTime(x)
        const chartPrice = transformRef.current.yToPrice(y)
        onContextMenu(e, chartTime, chartPrice)
      }
    }
  }, [onContextMenu, onLineContextMenu, detectLineAtPoint, symbol])

  // Handle window-level mouse events for dragging outside canvas
  useEffect(() => {
    if (!isDragging) return

    const handleWindowMouseMove = (e: MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect || !transformRef.current) return

      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const area = transformRef.current.chartArea

      const dx = x - dragStart.x
      const dy = y - dragStart.y

      if (dragMode === 'pan') {
        const timeRange = dragStart.viewEnd - dragStart.viewStart
        const timeDelta = -(dx / area.width) * timeRange
        const priceRange = dragStart.maxPrice - dragStart.minPrice
        const priceDelta = (dy / area.height) * priceRange

        setView(v => ({
          ...v,
          startTime: dragStart.viewStart + timeDelta,
          endTime: dragStart.viewEnd + timeDelta,
          minPrice: dragStart.minPrice + priceDelta,
          maxPrice: dragStart.maxPrice + priceDelta,
          autoScalePrice: false
        }))
      } else if (dragMode === 'zoom-price') {
        const zoomFactor = 1 + (dy / 100)
        const priceRange = dragStart.maxPrice - dragStart.minPrice
        const newPriceRange = priceRange * zoomFactor
        const centerPrice = (dragStart.maxPrice + dragStart.minPrice) / 2
        const newMinPrice = centerPrice - newPriceRange / 2
        const newMaxPrice = centerPrice + newPriceRange / 2

        if (newPriceRange > 0.001 && newPriceRange < priceRange * 10) {
          setView(v => ({
            ...v,
            minPrice: newMinPrice,
            maxPrice: newMaxPrice,
            autoScalePrice: false
          }))
        }
      } else if (dragMode === 'zoom-time') {
        const zoomFactor = 1 + (dx / 100)
        const timeRange = dragStart.viewEnd - dragStart.viewStart
        const newTimeRange = timeRange * zoomFactor
        const centerTime = (dragStart.viewEnd + dragStart.viewStart) / 2
        const newStartTime = centerTime - newTimeRange / 2
        const newEndTime = centerTime + newTimeRange / 2

        if (newTimeRange > 60 && newTimeRange < timeRange * 10) {
          setView(v => ({
            ...v,
            startTime: newStartTime,
            endTime: newEndTime
          }))
        }
      }
    }

    const handleWindowMouseUp = () => {
      setIsDragging(false)
      setDragMode('pan')
    }

    window.addEventListener('mousemove', handleWindowMouseMove)
    window.addEventListener('mouseup', handleWindowMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove)
      window.removeEventListener('mouseup', handleWindowMouseUp)
    }
  }, [isDragging, dragStart, dragMode])

  // Wheel handler for zooming
  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()

    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect || !transformRef.current) return

    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const area = transformRef.current.chartArea

    // Check if in chart area
    if (x < area.x || x > area.x + area.width ||
        y < area.y || y > area.y + area.height) {
      return
    }

    const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9

    // Get the time/price at mouse position
    const mouseTime = transformRef.current.xToTime(x)
    const mousePrice = transformRef.current.yToPrice(y)

    setView(v => {
      // Zoom time axis around mouse position
      const timeRange = v.endTime - v.startTime
      const newTimeRange = timeRange * zoomFactor

      const mouseTimeRatio = (mouseTime - v.startTime) / timeRange
      const newStartTime = mouseTime - mouseTimeRatio * newTimeRange
      const newEndTime = newStartTime + newTimeRange

      // Zoom price axis around mouse position (if shift is held)
      let newMinPrice = v.minPrice
      let newMaxPrice = v.maxPrice
      let autoScale = v.autoScalePrice

      if (e.shiftKey) {
        const priceRange = v.maxPrice - v.minPrice
        const newPriceRange = priceRange * zoomFactor

        const mousePriceRatio = (mousePrice - v.minPrice) / priceRange
        newMinPrice = mousePrice - mousePriceRatio * newPriceRange
        newMaxPrice = newMinPrice + newPriceRange
        autoScale = false
      }

      return {
        ...v,
        startTime: newStartTime,
        endTime: newEndTime,
        minPrice: newMinPrice,
        maxPrice: newMaxPrice,
        autoScalePrice: autoScale
      }
    })
  }, [])

  // Reset view to fit all data
  const resetView = useCallback(() => {
    if (data.length === 0) return

    const timeRange = ChartTransform.calculateTimeRange(data)
    const priceRange = ChartTransform.calculatePriceRange(data)

    // Minimal padding on the right (2 candle widths)
    const avgCandleWidth = data.length > 1
      ? (timeRange.end - timeRange.start) / data.length
      : 0
    const rightPadding = avgCandleWidth * 2

    setView({
      startTime: timeRange.start,
      endTime: timeRange.end + rightPadding,
      minPrice: priceRange.min,
      maxPrice: priceRange.max,
      autoScalePrice: true
    })
  }, [data])

  // Zoom controls
  const zoomIn = useCallback(() => {
    setView(v => {
      const center = (v.startTime + v.endTime) / 2
      const halfRange = (v.endTime - v.startTime) / 4
      return {
        ...v,
        startTime: center - halfRange,
        endTime: center + halfRange
      }
    })
  }, [])

  const zoomOut = useCallback(() => {
    setView(v => {
      const center = (v.startTime + v.endTime) / 2
      const halfRange = (v.endTime - v.startTime)
      return {
        ...v,
        startTime: center - halfRange,
        endTime: center + halfRange
      }
    })
  }, [])

  return (
    <div ref={containerRef} className="relative w-full h-full">
      {/* Zoom controls */}
      <div className="absolute top-2 right-2 z-10 flex items-center space-x-1">
        <button
          onClick={zoomIn}
          className="p-1.5 bg-white/90 hover:bg-white border border-gray-200 rounded text-gray-600 hover:text-gray-900 transition-colors"
          title="Zoom In"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
          </svg>
        </button>
        <button
          onClick={zoomOut}
          className="p-1.5 bg-white/90 hover:bg-white border border-gray-200 rounded text-gray-600 hover:text-gray-900 transition-colors"
          title="Zoom Out"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM7 10h6" />
          </svg>
        </button>
        <button
          onClick={resetView}
          className="p-1.5 bg-white/90 hover:bg-white border border-gray-200 rounded text-gray-600 hover:text-gray-900 transition-colors"
          title="Reset View"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-20">
          <div className="flex items-center space-x-2">
            <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-gray-600">Loading chart data...</span>
          </div>
        </div>
      )}

      {/* Loading more data indicator (subtle) */}
      {isLoadingMore && !isLoading && (
        <div className="absolute top-2 left-2 z-10 flex items-center space-x-1 px-2 py-1 bg-blue-50/90 border border-blue-200 rounded text-xs text-blue-600">
          <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span>Loading more data...</span>
        </div>
      )}

      {/* Legend showing comparison symbols and display mode */}
      {(compareSymbols.length > 0 || displayMode !== 'absolute') && !isLoading && data.length > 0 && (
        <div className="absolute top-2 left-2 z-10 bg-white/95 border border-gray-200 rounded-lg shadow-sm px-3 py-2 text-xs">
          {displayMode !== 'absolute' && (
            <div className="text-gray-500 mb-1 font-medium">
              {displayMode === 'indexed' ? `Indexed to ${indexBase}` : '% Change'}
            </div>
          )}
          <div className="flex items-center gap-2">
            <span
              className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
                selectedLine === symbol
                  ? 'bg-blue-100 ring-1 ring-blue-400'
                  : 'hover:bg-gray-100'
              }`}
              onClick={() => onLineClick?.(symbol, true)}
            >
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: mainSymbolStyle?.color || '#3b82f6' }}
              />
              <span className="text-gray-700 font-medium">{symbol}</span>
            </span>
            {compareSymbols.map((cs) => (
              <span
                key={cs.symbol}
                className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
                  selectedLine === cs.symbol
                    ? 'bg-blue-100 ring-1 ring-blue-400'
                    : 'hover:bg-gray-100'
                }`}
                onClick={() => onLineClick?.(cs.symbol, false)}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: cs.color || '#666666' }}
                />
                <span className="text-gray-700">{cs.symbol}</span>
                {!compareData.has(cs.symbol) && (
                  <span className="text-gray-400 ml-1">(loading...)</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Error overlay */}
      {error && !isLoading && (
        <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-20">
          <div className="text-center">
            <svg className="w-12 h-12 text-gray-300 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-gray-500">{error}</p>
          </div>
        </div>
      )}

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        className="block"
        style={{ cursor: cursorStyle }}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
        onContextMenu={handleContextMenu}
      />

      {/* No data message */}
      {!isLoading && !error && data.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
            </svg>
            <p className="text-gray-500">Select a symbol to view chart</p>
          </div>
        </div>
      )}
    </div>
  )
}
