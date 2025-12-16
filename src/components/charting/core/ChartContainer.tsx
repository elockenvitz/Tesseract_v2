import { useEffect, useRef, useState, useCallback } from 'react'
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickSeries,
  LineSeries,
  AreaSeries,
  BarSeries,
  HistogramSeries,
  ColorType,
  CrosshairMode,
  Time,
  CandlestickData as LWCandlestickData,
  LineData,
  HistogramData
} from 'lightweight-charts'
import { chartDataService, timeframeToParams, CandlestickData } from '../../../lib/chartData'

export type ChartType = 'candlestick' | 'line' | 'bar' | 'area'
export type TimeFrame = '1D' | '1W' | '1M' | '3M' | '6M' | '1Y' | '5Y' | 'ALL'

interface ChartContainerProps {
  symbol: string
  chartType: ChartType
  timeFrame: TimeFrame
  indicators?: string[]
  height?: number
  onCrosshairMove?: (price: number | null, time: string | null) => void
}

// Color schemes
const colors = {
  background: '#ffffff',
  text: '#333333',
  grid: '#f0f0f0',
  upColor: '#22c55e',
  downColor: '#ef4444',
  wickUpColor: '#22c55e',
  wickDownColor: '#ef4444',
  lineColor: '#2563eb',
  areaTopColor: 'rgba(37, 99, 235, 0.4)',
  areaBottomColor: 'rgba(37, 99, 235, 0.0)',
  volumeUp: 'rgba(34, 197, 94, 0.5)',
  volumeDown: 'rgba(239, 68, 68, 0.5)',
  crosshair: '#9ca3af'
}

export function ChartContainer({
  symbol,
  chartType,
  timeFrame,
  indicators = [],
  height,
  onCrosshairMove
}: ChartContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const mainSeriesRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | ISeriesApi<'Area'> | ISeriesApi<'Bar'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const isChartReady = useRef(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chartData, setChartData] = useState<CandlestickData[]>([])

  // Create chart instance
  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: colors.background },
        textColor: colors.text
      },
      grid: {
        vertLines: {
          color: colors.grid,
          visible: true
        },
        horzLines: {
          color: colors.grid,
          visible: true
        }
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: colors.crosshair,
          width: 1,
          style: 3,
          labelBackgroundColor: '#6b7280'
        },
        horzLine: {
          color: colors.crosshair,
          width: 1,
          style: 3,
          labelBackgroundColor: '#6b7280'
        }
      },
      rightPriceScale: {
        borderColor: colors.grid,
        scaleMargins: {
          top: 0.1,
          bottom: 0.2
        }
      },
      timeScale: {
        borderColor: colors.grid,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 20, // Allow scrolling into future
        shiftVisibleRangeOnNewBar: false // Don't auto-scroll when new data arrives
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true
      },
      handleScale: {
        axisPressedMouseMove: {
          time: true,
          price: true // Enable Y-axis scaling by dragging
        },
        mouseWheel: true,
        pinch: true
      }
    })

    chartRef.current = chart
    isChartReady.current = true

    // Handle crosshair movement
    chart.subscribeCrosshairMove((param) => {
      if (onCrosshairMove) {
        if (param.time && param.seriesData.size > 0) {
          const data = param.seriesData.get(mainSeriesRef.current!)
          if (data) {
            const price = 'close' in data ? (data as any).close : (data as any).value
            onCrosshairMove(price, String(param.time))
          }
        } else {
          onCrosshairMove(null, null)
        }
      }
    })

    // Handle resize
    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight
        })
      }
    }

    window.addEventListener('resize', handleResize)
    handleResize()

    // Use ResizeObserver for container size changes
    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(containerRef.current)

    return () => {
      isChartReady.current = false
      window.removeEventListener('resize', handleResize)
      resizeObserver.disconnect()
      chart.remove()
      chartRef.current = null
      mainSeriesRef.current = null
      volumeSeriesRef.current = null
    }
  }, [])

  // Create/update series based on chart type
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !isChartReady.current) return

    // Remove existing series safely
    try {
      if (mainSeriesRef.current) {
        chart.removeSeries(mainSeriesRef.current)
        mainSeriesRef.current = null
      }
    } catch (e) {
      // Series may have been removed already
      mainSeriesRef.current = null
    }

    try {
      if (volumeSeriesRef.current) {
        chart.removeSeries(volumeSeriesRef.current)
        volumeSeriesRef.current = null
      }
    } catch (e) {
      // Series may have been removed already
      volumeSeriesRef.current = null
    }

    // Create main series based on chart type (v5 API)
    try {
      switch (chartType) {
        case 'candlestick':
          mainSeriesRef.current = chart.addSeries(CandlestickSeries, {
            upColor: colors.upColor,
            downColor: colors.downColor,
            wickUpColor: colors.wickUpColor,
            wickDownColor: colors.wickDownColor,
            borderVisible: false
          })
          break
        case 'line':
          mainSeriesRef.current = chart.addSeries(LineSeries, {
            color: colors.lineColor,
            lineWidth: 2
          })
          break
        case 'area':
          mainSeriesRef.current = chart.addSeries(AreaSeries, {
            topColor: colors.areaTopColor,
            bottomColor: colors.areaBottomColor,
            lineColor: colors.lineColor,
            lineWidth: 2
          })
          break
        case 'bar':
          mainSeriesRef.current = chart.addSeries(BarSeries, {
            upColor: colors.upColor,
            downColor: colors.downColor
          })
          break
      }

      // Add volume series if we have volume indicator
      if (indicators.includes('volume')) {
        volumeSeriesRef.current = chart.addSeries(HistogramSeries, {
          priceFormat: {
            type: 'volume'
          },
          priceScaleId: 'volume'
        })

        chart.priceScale('volume').applyOptions({
          scaleMargins: {
            top: 0.8,
            bottom: 0
          }
        })
      }

      // Update data if we have it
      if (chartData.length > 0) {
        updateSeriesData(chartData)
      }
    } catch (e) {
      console.error('Error creating chart series:', e)
    }
  }, [chartType, indicators])

  // Fetch data when symbol or timeframe changes
  useEffect(() => {
    if (!symbol) return

    const fetchData = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const params = timeframeToParams[timeFrame] || { interval: '1d', range: '1mo' }
        const data = await chartDataService.getChartData({
          symbol: symbol.toUpperCase(),
          interval: params.interval as any,
          range: params.range as any
        })

        if (data.length === 0) {
          setError('No data available for this symbol')
        } else {
          setChartData(data)
          updateSeriesData(data)
        }
      } catch (err) {
        setError('Failed to load chart data')
        console.error('Chart data fetch error:', err)
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [symbol, timeFrame])

  const updateSeriesData = useCallback((data: CandlestickData[]) => {
    if (!mainSeriesRef.current || !isChartReady.current || data.length === 0) return

    // Determine if we're using intraday or daily data
    const isIntraday = !isNaN(Number(data[0].time))

    if (chartType === 'candlestick' || chartType === 'bar') {
      const candleData: LWCandlestickData<Time>[] = data.map(d => ({
        time: (isIntraday ? Number(d.time) : d.time) as Time,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close
      }))
      mainSeriesRef.current.setData(candleData)
    } else {
      // Line or area chart - use close prices
      const lineData: LineData<Time>[] = data.map(d => ({
        time: (isIntraday ? Number(d.time) : d.time) as Time,
        value: d.close
      }))
      mainSeriesRef.current.setData(lineData)
    }

    // Update volume data
    if (volumeSeriesRef.current && data[0]?.volume !== undefined) {
      const volumeData: HistogramData<Time>[] = data.map((d, i) => ({
        time: (isIntraday ? Number(d.time) : d.time) as Time,
        value: d.volume || 0,
        color: i > 0 && d.close >= data[i - 1].close ? colors.volumeUp : colors.volumeDown
      }))
      volumeSeriesRef.current.setData(volumeData)
    }

    // Fit content
    if (chartRef.current && isChartReady.current) {
      chartRef.current.timeScale().fitContent()
    }
  }, [chartType])

  // Manual zoom controls
  const zoomIn = useCallback(() => {
    if (chartRef.current && isChartReady.current) {
      const timeScale = chartRef.current.timeScale()
      const currentRange = timeScale.getVisibleLogicalRange()
      if (currentRange) {
        const center = (currentRange.from + currentRange.to) / 2
        const newHalfRange = (currentRange.to - currentRange.from) / 4
        timeScale.setVisibleLogicalRange({
          from: center - newHalfRange,
          to: center + newHalfRange
        })
      }
    }
  }, [])

  const zoomOut = useCallback(() => {
    if (chartRef.current && isChartReady.current) {
      const timeScale = chartRef.current.timeScale()
      const currentRange = timeScale.getVisibleLogicalRange()
      if (currentRange) {
        const center = (currentRange.from + currentRange.to) / 2
        const newHalfRange = (currentRange.to - currentRange.from)
        timeScale.setVisibleLogicalRange({
          from: center - newHalfRange,
          to: center + newHalfRange
        })
      }
    }
  }, [])

  const resetZoom = useCallback(() => {
    if (chartRef.current && isChartReady.current) {
      chartRef.current.timeScale().fitContent()
    }
  }, [])

  return (
    <div className="relative w-full h-full flex flex-col">
      {/* Chart controls */}
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
          onClick={resetZoom}
          className="p-1.5 bg-white/90 hover:bg-white border border-gray-200 rounded text-gray-600 hover:text-gray-900 transition-colors"
          title="Reset Zoom"
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

      {/* Chart container */}
      <div ref={containerRef} className="flex-1 w-full" />
    </div>
  )
}
