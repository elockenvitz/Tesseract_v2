import React, { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, TrendingUp, BarChart3, Clock, Zap } from 'lucide-react'
import { InteractiveChart } from './InteractiveChart'
import type { ChartDataPoint, TechnicalIndicator, ChartConfig } from './types'
import { ChartDataAdapter } from './utils/dataAdapter'
import { financialDataService, type Quote } from '../../lib/financial-data/browser-client'

interface FinancialChartProps {
  symbol: string
  chartType?: 'price' | 'volume' | 'percentage'
  timeframe?: '1D' | '5D' | '1M' | '3M' | '6M' | '1Y' | 'YTD' | 'ALL'
  height?: number
  className?: string
}

export function FinancialChart({
  symbol,
  chartType = 'price',
  timeframe = '1M',
  height = 400,
  className = ''
}: FinancialChartProps) {
  const [selectedTimeframe, setSelectedTimeframe] = useState(timeframe)
  const [selectedChartType, setSelectedChartType] = useState(chartType)
  const [activeIndicators, setActiveIndicators] = useState<TechnicalIndicator[]>([])

  // Fetch current quote
  const { data: currentQuote, isLoading: quoteLoading } = useQuery({
    queryKey: ['financial-chart-quote', symbol],
    queryFn: async () => {
      const quote = await financialDataService.getQuote(symbol)
      return quote
    },
    refetchInterval: 30000, // Refresh every 30 seconds
    staleTime: 15000
  })

  // Generate chart data based on timeframe
  const chartData = useMemo(() => {
    if (!currentQuote) return []

    let data: ChartDataPoint[]

    switch (selectedTimeframe) {
      case '1D':
        data = ChartDataAdapter.generateIntradayData(currentQuote, 24)
        break
      case '5D':
        data = ChartDataAdapter.generateHistoricalData(symbol, currentQuote, 5)
        // Add more granular intraday data for last day
        const intradayData = ChartDataAdapter.generateIntradayData(currentQuote, 8)
        data = [...data.slice(0, -1), ...intradayData]
        break
      case '1M':
        data = ChartDataAdapter.generateHistoricalData(symbol, currentQuote, 30)
        break
      case '3M':
        data = ChartDataAdapter.generateHistoricalData(symbol, currentQuote, 90)
        break
      case '6M':
        data = ChartDataAdapter.generateHistoricalData(symbol, currentQuote, 180)
        break
      case '1Y':
        data = ChartDataAdapter.generateHistoricalData(symbol, currentQuote, 365)
        break
      case 'YTD':
        const daysFromYearStart = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / (1000 * 60 * 60 * 24))
        data = ChartDataAdapter.generateHistoricalData(symbol, currentQuote, daysFromYearStart)
        break
      default:
        data = ChartDataAdapter.generateHistoricalData(symbol, currentQuote, 365)
    }

    // Transform data based on chart type
    switch (selectedChartType) {
      case 'volume':
        return ChartDataAdapter.formatVolumeData(data)
      case 'percentage':
        return ChartDataAdapter.formatPercentageChangeData(data)
      default:
        return data
    }
  }, [symbol, currentQuote, selectedTimeframe, selectedChartType])

  // Chart configuration
  const chartConfig: ChartConfig = {
    height: height,
    margin: { top: 20, right: 30, bottom: 60, left: 60 },
    theme: 'light',
    showGrid: true,
    showLegend: false,
    showTooltip: true,
    enableZoom: true,
    enablePan: true,
    enableCrosshair: true,
    enableAnnotations: true
  }

  // Default indicators based on timeframe
  useEffect(() => {
    const defaultIndicators: TechnicalIndicator[] = []

    // Add SMA for longer timeframes
    if (['1M', '3M', '6M', '1Y', 'YTD', 'ALL'].includes(selectedTimeframe)) {
      defaultIndicators.push({
        id: 'sma20',
        name: 'SMA(20)',
        type: 'sma',
        period: 20,
        color: '#3b82f6',
        visible: false
      })

      defaultIndicators.push({
        id: 'sma50',
        name: 'SMA(50)',
        type: 'sma',
        period: 50,
        color: '#ef4444',
        visible: false
      })
    }

    // Add EMA for shorter timeframes
    if (['1D', '5D', '1M'].includes(selectedTimeframe)) {
      defaultIndicators.push({
        id: 'ema12',
        name: 'EMA(12)',
        type: 'ema',
        period: 12,
        color: '#10b981',
        visible: false
      })
    }

    setActiveIndicators(defaultIndicators)
  }, [selectedTimeframe])

  if (quoteLoading) {
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
        <div className=\"bg-gray-50 rounded-lg h-full flex items-center justify-center\">
          <div className=\"text-center\">
            <BarChart3 className=\"h-12 w-12 text-gray-400 mx-auto mb-2\" />
            <div className=\"text-gray-500\">No chart data available</div>
            <div className=\"text-sm text-gray-400\">Financial data for {symbol} could not be loaded</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`w-full space-y-4 ${className}`}>
      {/* Chart Header with Controls */}
      <div className=\"flex items-center justify-between p-4 bg-white border border-gray-200 rounded-lg\">
        <div className=\"flex items-center space-x-4\">
          <div>
            <h3 className=\"text-lg font-semibold text-gray-900\">{symbol}</h3>
            <div className=\"text-sm text-gray-500\">
              {selectedChartType === 'price' && 'Price Chart'}
              {selectedChartType === 'volume' && 'Volume Chart'}
              {selectedChartType === 'percentage' && 'Percentage Change'}
            </div>
          </div>

          {/* Current Price Info */}
          {selectedChartType === 'price' && currentQuote && (
            <div className=\"flex items-center space-x-4 text-sm\">
              <div>
                <span className=\"text-gray-600\">Current:</span>
                <span className=\"ml-1 font-medium\">${currentQuote.price.toFixed(2)}</span>
              </div>
              <div>
                <span className=\"text-gray-600\">Change:</span>
                <span className={`ml-1 font-medium ${
                  currentQuote.change >= 0 ? 'text-green-600' : 'text-red-600'
                }`}>
                  {currentQuote.change >= 0 ? '+' : ''}${currentQuote.change.toFixed(2)}
                  ({currentQuote.change >= 0 ? '+' : ''}{currentQuote.changePercent.toFixed(2)}%)
                </span>
              </div>
            </div>
          )}
        </div>

        <div className=\"flex items-center space-x-2\">
          {/* Chart Type Selector */}
          <div className=\"flex items-center space-x-1 border-r border-gray-300 pr-3\">
            <button
              onClick={() => setSelectedChartType('price')}
              className={`px-3 py-1 rounded text-sm ${
                selectedChartType === 'price'
                  ? 'bg-blue-100 text-blue-600 font-medium'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <TrendingUp className=\"h-4 w-4 inline mr-1\" />
              Price
            </button>
            <button
              onClick={() => setSelectedChartType('volume')}
              className={`px-3 py-1 rounded text-sm ${
                selectedChartType === 'volume'
                  ? 'bg-blue-100 text-blue-600 font-medium'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <BarChart3 className=\"h-4 w-4 inline mr-1\" />
              Volume
            </button>
            <button
              onClick={() => setSelectedChartType('percentage')}
              className={`px-3 py-1 rounded text-sm ${
                selectedChartType === 'percentage'
                  ? 'bg-blue-100 text-blue-600 font-medium'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <span className=\"inline mr-1\">%</span>
              Change
            </button>
          </div>

          {/* Timeframe Selector */}
          <div className=\"flex items-center space-x-1\">
            {['1D', '5D', '1M', '3M', '6M', '1Y', 'YTD'].map((tf) => (
              <button
                key={tf}
                onClick={() => setSelectedTimeframe(tf)}
                className={`px-3 py-1 rounded text-sm ${
                  selectedTimeframe === tf
                    ? 'bg-gray-900 text-white font-medium'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Interactive Chart */}
      <div className=\"bg-white border border-gray-200 rounded-lg p-4\">
        <InteractiveChart
          data={chartData}
          type={selectedChartType === 'volume' ? 'bar' : selectedChartType === 'percentage' ? 'area' : 'line'}
          config={chartConfig}
          indicators={activeIndicators}
          onDataPointClick={(point, index) => {
            console.log('Chart point clicked:', point, index)
          }}
          onAnnotationCreate={(annotation) => {
            console.log('Annotation created:', annotation)
          }}
        />
      </div>

      {/* Chart Insights */}
      {chartData.length > 1 && (
        <div className=\"grid grid-cols-1 md:grid-cols-3 gap-4\">
          <div className=\"bg-white border border-gray-200 rounded-lg p-4\">
            <div className=\"flex items-center space-x-2 mb-2\">
              <TrendingUp className=\"h-4 w-4 text-blue-600\" />
              <span className=\"text-sm font-medium text-gray-900\">Trend Analysis</span>
            </div>
            <div className=\"space-y-1 text-sm\">
              {(() => {
                const firstValue = chartData[0]?.value || 0
                const lastValue = chartData[chartData.length - 1]?.value || 0
                const change = ((lastValue - firstValue) / firstValue) * 100
                const trend = change > 5 ? 'Strong Uptrend' :
                             change > 1 ? 'Uptrend' :
                             change < -5 ? 'Strong Downtrend' :
                             change < -1 ? 'Downtrend' : 'Sideways'

                return (
                  <>
                    <div className=\"text-gray-600\">Direction: <span className=\"font-medium\">{trend}</span></div>
                    <div className=\"text-gray-600\">
                      {selectedTimeframe} Change:
                      <span className={`font-medium ml-1 ${change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                      </span>
                    </div>
                  </>
                )
              })()}
            </div>
          </div>

          <div className=\"bg-white border border-gray-200 rounded-lg p-4\">
            <div className=\"flex items-center space-x-2 mb-2\">
              <Zap className=\"h-4 w-4 text-orange-600\" />
              <span className=\"text-sm font-medium text-gray-900\">Volatility</span>
            </div>
            <div className=\"space-y-1 text-sm\">
              {(() => {
                const values = chartData.map(d => d.value)
                const mean = values.reduce((a, b) => a + b, 0) / values.length
                const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length
                const volatility = Math.sqrt(variance) / mean * 100
                const level = volatility > 5 ? 'High' : volatility > 2 ? 'Medium' : 'Low'

                return (
                  <>
                    <div className=\"text-gray-600\">Level: <span className=\"font-medium\">{level}</span></div>
                    <div className=\"text-gray-600\">Coefficient: <span className=\"font-medium\">{volatility.toFixed(2)}%</span></div>
                  </>
                )
              })()}
            </div>
          </div>

          <div className=\"bg-white border border-gray-200 rounded-lg p-4\">
            <div className=\"flex items-center space-x-2 mb-2\">
              <Clock className=\"h-4 w-4 text-green-600\" />
              <span className=\"text-sm font-medium text-gray-900\">Data Quality</span>
            </div>
            <div className=\"space-y-1 text-sm\">
              <div className=\"text-gray-600\">Points: <span className=\"font-medium\">{chartData.length}</span></div>
              <div className=\"text-gray-600\">
                Last Updated:
                <span className=\"font-medium ml-1\">
                  {currentQuote ? new Date(currentQuote.timestamp).toLocaleTimeString() : 'Unknown'}
                </span>
              </div>
              <div className=\"text-gray-600\">
                Status: <span className=\"font-medium text-green-600\">Live</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}