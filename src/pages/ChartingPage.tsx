import { useState, useCallback, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  LineChart, Search, Plus, ChevronDown, TrendingUp, TrendingDown,
  BarChart3, CandlestickChart, Activity, Layers, Settings, Maximize2,
  Download, Share2, Star, Clock, Grid3X3, LayoutGrid, Calendar, X,
  DollarSign, BarChart2, PieChart, Percent, TrendingUp as TrendIcon,
  Minus, ArrowRight, Square, Circle, Type, MousePointer, Trash2, Lock, Unlock, Move
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { ProChart, ChartType, TimeFrame, IndicatorType, CustomDateRange } from '../components/charting'
import { Annotation, AnnotationType } from '../components/charting/engine/annotations'

// Metric types for charting
type MetricType = 'price' | 'volume' | 'market_cap' | 'pe_ratio' | 'eps' | 'revenue' | 'dividend_yield'

// Display modes for comparison
type DisplayMode = 'absolute' | 'indexed' | 'relative'

// Default index base value
const DEFAULT_INDEX_BASE = 100

// Colors for comparison symbols (different from main chart's blue)
const COMPARISON_COLORS = [
  '#dc2626', // red
  '#16a34a', // green
  '#9333ea', // purple
  '#ea580c', // orange
  '#0891b2', // cyan
  '#be185d', // pink
  '#854d0e', // amber
  '#6366f1', // indigo
]

const displayModeOptions: { value: DisplayMode; label: string; description: string }[] = [
  { value: 'absolute', label: 'Absolute', description: 'Show actual stock prices' },
  { value: 'indexed', label: 'Indexed', description: 'All stocks start at 100' },
  { value: 'relative', label: '% Change', description: 'Show % change from start (0%)' },
]

const metricOptions: { value: MetricType; label: string; icon: any; description: string }[] = [
  { value: 'price', label: 'Price', icon: DollarSign, description: 'Stock price (OHLC)' },
  { value: 'volume', label: 'Volume', icon: BarChart2, description: 'Trading volume' },
  { value: 'market_cap', label: 'Market Cap', icon: PieChart, description: 'Market capitalization' },
  { value: 'pe_ratio', label: 'P/E Ratio', icon: Percent, description: 'Price to earnings ratio' },
  { value: 'eps', label: 'EPS', icon: TrendIcon, description: 'Earnings per share' },
  { value: 'revenue', label: 'Revenue', icon: BarChart2, description: 'Quarterly revenue' },
  { value: 'dividend_yield', label: 'Div Yield', icon: Percent, description: 'Dividend yield %' },
]

// Annotation tool options for context menu
const annotationTools: { type: AnnotationType; label: string; icon: any }[] = [
  { type: 'horizontal-line', label: 'Horizontal Line', icon: Minus },
  { type: 'vertical-line', label: 'Vertical Line', icon: Minus },
  { type: 'trend-line', label: 'Trend Line', icon: TrendIcon },
  { type: 'ray', label: 'Ray', icon: ArrowRight },
  { type: 'rectangle', label: 'Rectangle', icon: Square },
  { type: 'ellipse', label: 'Ellipse', icon: Circle },
  { type: 'fibonacci', label: 'Fibonacci', icon: Layers },
  { type: 'text', label: 'Text', icon: Type },
  { type: 'arrow', label: 'Arrow', icon: ArrowRight },
]

// Helper to create a new annotation at the given coordinates
function createAnnotation(type: AnnotationType, time: number, price: number): Annotation {
  const id = `annotation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  const defaultStyle = {
    color: '#2563eb',
    lineWidth: 2,
    lineStyle: 'solid' as const,
    fillColor: '#2563eb',
    fillOpacity: 0.1,
    fontSize: 12
  }

  switch (type) {
    case 'horizontal-line':
      return { id, type, style: defaultStyle, price, label: `$${price.toFixed(2)}` }
    case 'vertical-line':
      return { id, type, style: defaultStyle, time }
    case 'trend-line':
    case 'ray':
      return { id, type, style: defaultStyle, startTime: time, startPrice: price, endTime: time + 86400 * 30, endPrice: price * 1.05 }
    case 'rectangle':
    case 'ellipse':
      return { id, type, style: { ...defaultStyle, fillOpacity: 0.2 }, startTime: time, startPrice: price, endTime: time + 86400 * 30, endPrice: price * 0.95 }
    case 'fibonacci':
      return { id, type, style: defaultStyle, startTime: time, startPrice: price, endTime: time + 86400 * 60, endPrice: price * 0.8, levels: [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] }
    case 'text':
      return { id, type, style: { ...defaultStyle, fontSize: 14 }, time, price, text: 'Note', anchor: 'left' }
    case 'arrow':
      return { id, type, style: defaultStyle, startTime: time, startPrice: price, endTime: time + 86400 * 15, endPrice: price * 1.03 }
    default:
      return { id, type: 'horizontal-line', style: defaultStyle, price }
  }
}

interface ChartingPageProps {
  onItemSelect?: (item: any) => void
}

type ViewMode = 'single' | 'grid'

interface ChartPanel {
  id: string
  symbol: string
  companyName?: string
  chartType: ChartType
  timeFrame: TimeFrame
  customRange?: CustomDateRange
  indicators: string[]
  metric: MetricType
  annotations: Annotation[]
  // Track selected frequency for highlighting
  selectedFreq?: {
    frequencyKey: string
    interval: string
    isIntraday: boolean
  }
  // Main symbol styling
  mainSymbolStyle?: {
    color?: string
    lineWidth?: number
    lineStyle?: LineStyleOption
  }
  // Comparison symbols
  compareSymbols?: { symbol: string; companyName?: string; color?: string; lineWidth?: number; lineStyle?: LineStyleOption }[]
  // Display mode: absolute prices, indexed, or relative to first symbol
  displayMode?: DisplayMode
  // Base value for indexed mode (default 100)
  indexBase?: number
}

// Context menu state
interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  chartX: number  // Position in chart coordinates (time)
  chartY: number  // Position in chart coordinates (price)
}

// Line context menu state
interface LineContextMenuState {
  visible: boolean
  x: number
  y: number
  symbol: string
  isMainSymbol: boolean
}

// Line style type (matching renderer)
type LineStyleOption = 'solid' | 'dashed' | 'dotted'

const LINE_COLORS = [
  { value: '#dc2626', label: 'Red' },
  { value: '#16a34a', label: 'Green' },
  { value: '#2563eb', label: 'Blue' },
  { value: '#9333ea', label: 'Purple' },
  { value: '#ea580c', label: 'Orange' },
  { value: '#0891b2', label: 'Cyan' },
  { value: '#be185d', label: 'Pink' },
  { value: '#854d0e', label: 'Amber' },
]

const LINE_WIDTHS = [1, 2, 3, 4]
const LINE_STYLES: { value: LineStyleOption; label: string }[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
]

// Frequency/Interval configuration
type FrequencyType =
  | 'tick' | '1min' | '3min' | '5min' | '10min' | '15min' | '30min' | '60min' | '120min' | '240min'
  | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'

interface FrequencyConfig {
  label: string
  intervals: string[]
  apiInterval: string // Yahoo Finance interval mapping
}

const historicalFrequencies: Record<string, FrequencyConfig> = {
  daily: { label: 'Daily', intervals: ['3M', '6M', '1Y', '2Y', '3Y', '5Y'], apiInterval: '1d' },
  weekly: { label: 'Weekly', intervals: ['1Y', '2Y', '3Y', '4Y', '5Y', '10Y'], apiInterval: '1wk' },
  monthly: { label: 'Monthly', intervals: ['5Y', '10Y', '15Y', '20Y', '25Y', '30Y'], apiInterval: '1mo' },
  quarterly: { label: 'Quarterly', intervals: ['10Y', '20Y', '30Y', '40Y', '50Y'], apiInterval: '1mo' }, // Will aggregate
  yearly: { label: 'Yearly', intervals: ['10Y', '20Y', '30Y', '40Y', '50Y'], apiInterval: '1mo' } // Will aggregate
}

const intradayFrequencies: Record<string, FrequencyConfig> = {
  tick: { label: 'Tick', intervals: ['1D', '2D', '3D', '4D', '5D', '10D'], apiInterval: '1m' },
  '1min': { label: '1 Min', intervals: ['1D', '2D', '3D', '4D', '5D'], apiInterval: '1m' },
  '3min': { label: '3 Min', intervals: ['1D', '2D', '3D', '4D', '5D', '10D'], apiInterval: '5m' }, // Closest available
  '5min': { label: '5 Min', intervals: ['1D', '2D', '3D', '4D', '5D', '10D'], apiInterval: '5m' },
  '10min': { label: '10 Min', intervals: ['3D', '4D', '5D', '10D', '20D', '30D'], apiInterval: '15m' }, // Closest available
  '15min': { label: '15 Min', intervals: ['3D', '4D', '5D', '10D', '20D', '30D'], apiInterval: '15m' },
  '30min': { label: '30 Min', intervals: ['10D', '20D', '30D', '60D', '3M', '6M'], apiInterval: '30m' },
  '60min': { label: '60 Min', intervals: ['10D', '20D', '30D', '60D', '3M', '6M'], apiInterval: '1h' },
  '120min': { label: '120 Min', intervals: ['10D', '20D', '30D', '60D', '3M', '6M'], apiInterval: '1h' }, // Will aggregate
  '240min': { label: '240 Min', intervals: ['10D', '20D', '30D', '60D', '3M', '6M'], apiInterval: '1h' } // Will aggregate
}

// Convert interval string to days/months for date calculation
function parseIntervalToDays(interval: string): number {
  const value = parseInt(interval)
  if (interval.endsWith('D')) return value
  if (interval.endsWith('M')) return value * 30
  if (interval.endsWith('Y')) return value * 365
  return 30 // Default
}


// Get fresh default state (no persistence)
function getDefaultChartingState(): {
  panels: ChartPanel[]
  activePanel: string
  viewMode: ViewMode
} {
  return {
    panels: [{ id: '1', symbol: '', companyName: '', chartType: 'line' as ChartType, timeFrame: '1M' as TimeFrame, indicators: [] as string[], metric: 'price' as MetricType, annotations: [] as Annotation[], compareSymbols: [], displayMode: 'absolute' as DisplayMode, indexBase: DEFAULT_INDEX_BASE }],
    activePanel: '1',
    viewMode: 'single' as ViewMode
  }
}

export function ChartingPage({ onItemSelect }: ChartingPageProps) {
  // Always start with fresh default state
  const [initialState] = useState(() => getDefaultChartingState())

  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>(initialState.viewMode)
  const [panels, setPanels] = useState<ChartPanel[]>(initialState.panels)
  const [activePanel, setActivePanel] = useState(initialState.activePanel)
  const [showIndicatorMenu, setShowIndicatorMenu] = useState(false)
  const [showFreqPicker, setShowFreqPicker] = useState(false)
  const [showCustomDatePicker, setShowCustomDatePicker] = useState(false)
  const [showMetricMenu, setShowMetricMenu] = useState(false)
  const [showCompareMenu, setShowCompareMenu] = useState(false)
  const [compareSearchQuery, setCompareSearchQuery] = useState('')
  const [showDisplayModeMenu, setShowDisplayModeMenu] = useState(false)

  // Context menu state for right-click annotations
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    chartX: 0,
    chartY: 0
  })
  const [selectedAnnotation, setSelectedAnnotation] = useState<string | null>(null)

  // Line context menu state for formatting lines
  const [lineContextMenu, setLineContextMenu] = useState<LineContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    symbol: '',
    isMainSymbol: false
  })

  // Selected line state for left-click selection
  const [selectedLine, setSelectedLine] = useState<string | null>(null)

  // Custom date picker state
  const [customStartDate, setCustomStartDate] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 1)
    return d.toISOString().split('T')[0]
  })
  const [customEndDate, setCustomEndDate] = useState(() => new Date().toISOString().split('T')[0])
  const [customInterval, setCustomInterval] = useState<CustomDateRange['interval']>('1d')


  // Search assets
  const { data: searchResults = [] } = useQuery({
    queryKey: ['asset-search', searchQuery],
    queryFn: async () => {
      if (!searchQuery || searchQuery.length < 1) return []
      const { data, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name')
        .or(`symbol.ilike.%${searchQuery}%,company_name.ilike.%${searchQuery}%`)
        .limit(10)
      if (error) throw error
      return data || []
    },
    enabled: searchQuery.length >= 1
  })

  // Search assets for comparison
  const { data: compareSearchResults = [] } = useQuery({
    queryKey: ['asset-compare-search', compareSearchQuery],
    queryFn: async () => {
      if (!compareSearchQuery || compareSearchQuery.length < 1) return []
      const { data, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name')
        .or(`symbol.ilike.%${compareSearchQuery}%,company_name.ilike.%${compareSearchQuery}%`)
        .limit(10)
      if (error) throw error
      return data || []
    },
    enabled: compareSearchQuery.length >= 1
  })

  const timeFrames: TimeFrame[] = ['1D', '1W', '1M', '3M', '6M', '1Y', '5Y', 'ALL']

  const chartTypes: { value: ChartType; label: string; icon: any }[] = [
    { value: 'line', label: 'Line', icon: LineChart },
    { value: 'candlestick', label: 'Candlestick', icon: CandlestickChart },
    { value: 'bar', label: 'Bar', icon: BarChart3 },
    { value: 'area', label: 'Area', icon: Activity }
  ]

  const indicators = [
    { id: 'sma', name: 'SMA', category: 'Moving Averages' },
    { id: 'ema', name: 'EMA', category: 'Moving Averages' },
    { id: 'bollinger', name: 'Bollinger Bands', category: 'Moving Averages' },
    { id: 'rsi', name: 'RSI', category: 'Oscillators' },
    { id: 'macd', name: 'MACD', category: 'Oscillators' },
    { id: 'stochastic', name: 'Stochastic', category: 'Oscillators' },
    { id: 'volume', name: 'Volume', category: 'Volume' },
    { id: 'obv', name: 'OBV', category: 'Volume' },
    { id: 'vwap', name: 'VWAP', category: 'Volume' },
    { id: 'atr', name: 'ATR', category: 'Volatility' },
    { id: 'adx', name: 'ADX', category: 'Trend' },
    { id: 'ichimoku', name: 'Ichimoku Cloud', category: 'Trend' }
  ]

  const updatePanel = useCallback((panelId: string, updates: Partial<ChartPanel>) => {
    setPanels(prev => prev.map(p => p.id === panelId ? { ...p, ...updates } : p))
  }, [])

  const addPanel = () => {
    const newId = String(Date.now())
    setPanels([...panels, {
      id: newId,
      symbol: '',
      companyName: '',
      chartType: 'line',
      timeFrame: '1M',
      indicators: [],
      metric: 'price',
      annotations: [],
      compareSymbols: [],
      displayMode: 'absolute',
      indexBase: DEFAULT_INDEX_BASE
    }])
    setActivePanel(newId)
  }

  // Context menu handlers
  const handleChartContextMenu = useCallback((e: React.MouseEvent, chartTime: number, chartPrice: number) => {
    e.preventDefault()
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      chartX: chartTime,
      chartY: chartPrice
    })
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu(prev => ({ ...prev, visible: false }))
  }, [])

  const addAnnotation = useCallback((type: AnnotationType) => {
    const panel = panels.find(p => p.id === activePanel)
    if (!panel) return

    const newAnnotation: Annotation = createAnnotation(type, contextMenu.chartX, contextMenu.chartY)

    updatePanel(activePanel, {
      annotations: [...panel.annotations, newAnnotation]
    })
    closeContextMenu()
  }, [activePanel, panels, contextMenu])

  const deleteAnnotation = useCallback((annotationId: string) => {
    const panel = panels.find(p => p.id === activePanel)
    if (!panel) return

    updatePanel(activePanel, {
      annotations: panel.annotations.filter(a => a.id !== annotationId)
    })
    setSelectedAnnotation(null)
  }, [activePanel, panels])

  const clearAllAnnotations = useCallback(() => {
    updatePanel(activePanel, { annotations: [] })
    closeContextMenu()
  }, [activePanel])

  // Line context menu handlers
  const handleLineContextMenu = useCallback((e: React.MouseEvent, symbol: string, isMainSymbol: boolean) => {
    e.preventDefault()
    setLineContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      symbol,
      isMainSymbol
    })
  }, [])

  const closeLineContextMenu = useCallback(() => {
    setLineContextMenu(prev => ({ ...prev, visible: false }))
  }, [])

  // Close line context menu when clicking outside
  useEffect(() => {
    if (!lineContextMenu.visible) return

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      // Check if click is inside the context menu
      if (target.closest('[data-line-context-menu]')) return
      closeLineContextMenu()
    }

    // Use mousedown so it fires before contextmenu
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [lineContextMenu.visible, closeLineContextMenu])

  // Handle left-click on line to select it
  const handleLineClick = useCallback((symbol: string, isMainSymbol: boolean) => {
    // Toggle selection - if already selected, deselect; otherwise select
    setSelectedLine(prev => prev === symbol ? null : symbol)
  }, [])

  const updateCompareSymbolStyle = useCallback((symbolToUpdate: string, updates: { color?: string; lineWidth?: number; lineStyle?: LineStyleOption }) => {
    setPanels(prev => prev.map(p => {
      if (p.id !== activePanel || !p.compareSymbols) return p
      return {
        ...p,
        compareSymbols: p.compareSymbols.map(cs =>
          cs.symbol === symbolToUpdate ? { ...cs, ...updates } : cs
        )
      }
    }))
  }, [activePanel])

  const updateMainSymbolStyle = useCallback((updates: { color?: string; lineWidth?: number; lineStyle?: LineStyleOption }) => {
    setPanels(prev => prev.map(p => {
      if (p.id !== activePanel) return p
      return {
        ...p,
        mainSymbolStyle: { ...(p.mainSymbolStyle || {}), ...updates }
      }
    }))
  }, [activePanel])

  const removePanel = (panelId: string) => {
    if (panels.length > 1) {
      const newPanels = panels.filter(p => p.id !== panelId)
      setPanels(newPanels)
      if (activePanel === panelId) {
        setActivePanel(newPanels[0].id)
      }
    }
  }

  const selectAsset = (asset: { id: string; symbol: string; company_name: string }) => {
    updatePanel(activePanel, { symbol: asset.symbol, companyName: asset.company_name })
    setSearchQuery('')
  }

  const addCompareSymbol = (asset: { id: string; symbol: string; company_name: string }) => {
    const panel = panels.find(p => p.id === activePanel)
    if (!panel) return

    // Don't add if it's the main symbol or already in comparison
    if (asset.symbol === panel.symbol) return
    if (panel.compareSymbols?.some(s => s.symbol === asset.symbol)) return

    const usedColors = panel.compareSymbols?.map(s => s.color) || []
    const nextColor = COMPARISON_COLORS.find(c => !usedColors.includes(c)) || COMPARISON_COLORS[0]

    updatePanel(activePanel, {
      compareSymbols: [
        ...(panel.compareSymbols || []),
        { symbol: asset.symbol, companyName: asset.company_name, color: nextColor }
      ]
    })
    setCompareSearchQuery('')
  }

  const removeCompareSymbol = (symbol: string) => {
    const panel = panels.find(p => p.id === activePanel)
    if (!panel) return

    updatePanel(activePanel, {
      compareSymbols: panel.compareSymbols?.filter(s => s.symbol !== symbol) || []
    })
  }

  const setDisplayMode = (mode: DisplayMode) => {
    updatePanel(activePanel, { displayMode: mode })
    setShowDisplayModeMenu(false)
  }

  const toggleIndicator = (indicatorId: string) => {
    const panel = panels.find(p => p.id === activePanel)
    if (!panel) return

    const newIndicators = panel.indicators.includes(indicatorId)
      ? panel.indicators.filter(i => i !== indicatorId)
      : [...panel.indicators, indicatorId]

    updatePanel(activePanel, { indicators: newIndicators })
  }

  const applyFrequencySelection = (frequencyKey: string, intervalStr: string, isIntraday: boolean) => {
    const freqConfig = isIntraday
      ? intradayFrequencies[frequencyKey]
      : historicalFrequencies[frequencyKey]

    if (!freqConfig) {
      console.error('No frequency config found for:', frequencyKey)
      return
    }

    const days = parseIntervalToDays(intervalStr)
    const endDate = new Date()
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000)

    console.log('applyFrequencySelection:', {
      frequencyKey,
      intervalStr,
      isIntraday,
      days,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      apiInterval: freqConfig.apiInterval,
      activePanel,
      currentSymbol: currentPanel.symbol
    })

    updatePanel(activePanel, {
      timeFrame: 'CUSTOM',
      customRange: {
        startDate,
        endDate,
        interval: freqConfig.apiInterval as CustomDateRange['interval']
      },
      selectedFreq: {
        frequencyKey,
        interval: intervalStr,
        isIntraday
      }
    })
    setShowFreqPicker(false)
  }

  const applyCustomDateRange = () => {
    const startDate = new Date(customStartDate)
    const endDate = new Date(customEndDate)

    if (startDate >= endDate) {
      alert('Start date must be before end date')
      return
    }

    updatePanel(activePanel, {
      timeFrame: 'CUSTOM',
      customRange: {
        startDate,
        endDate,
        interval: customInterval
      },
      selectedFreq: undefined  // Clear freq selection when using custom date picker
    })
    setShowCustomDatePicker(false)
  }

  const currentPanel = panels.find(p => p.id === activePanel) || panels[0]

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden">
      {/* Header Toolbar */}
      <div className="bg-gray-50 border-b border-gray-200 px-4 py-2">
        <div className="flex items-center justify-between">
          {/* Left: Symbol Search & Info */}
          <div className="flex items-center space-x-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search symbol..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-1.5 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              {/* Search Results Dropdown */}
              {searchQuery && searchResults.length > 0 && (
                <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-xl z-50 max-h-64 overflow-auto">
                  {searchResults.map((asset: any) => (
                    <button
                      key={asset.id}
                      onClick={() => selectAsset(asset)}
                      className="w-full px-3 py-2 text-left hover:bg-gray-100 transition-colors flex items-center justify-between"
                    >
                      <span className="font-medium text-gray-900">{asset.symbol}</span>
                      <span className="text-xs text-gray-500 truncate ml-2">{asset.company_name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {currentPanel.symbol && (
              <div className="flex items-center space-x-3">
                <span className="text-lg font-bold text-gray-900">{currentPanel.symbol}</span>
                <span className="text-sm text-gray-500">{currentPanel.companyName}</span>
              </div>
            )}
          </div>

          {/* Right: Time Frame + Chart Type & Actions */}
          <div className="flex items-center space-x-2">
            {/* Time Frame Selector */}
          <div className="flex items-center space-x-1 bg-gray-200 rounded-lg p-1">
            {timeFrames.map((tf) => (
              <button
                key={tf}
                onClick={() => updatePanel(activePanel, { timeFrame: tf, customRange: undefined, selectedFreq: undefined })}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                  currentPanel.timeFrame === tf && !currentPanel.selectedFreq
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-300'
                }`}
              >
                {tf}
              </button>
            ))}

            {/* Freq Button (inside selector) */}
            <div className="relative">
              <button
                onClick={() => setShowFreqPicker(!showFreqPicker)}
                className={`px-2 py-1 text-xs font-medium rounded transition-colors flex items-center space-x-1 ${
                  showFreqPicker || currentPanel.selectedFreq
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-300'
                }`}
              >
                <Clock className="w-3 h-3" />
                <span>Freq</span>
              </button>

              {/* Frequency Picker Dropdown */}
              {showFreqPicker && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowFreqPicker(false)} />
                  <div className="absolute left-0 top-full mt-2 bg-gradient-to-b from-white to-gray-50 border border-gray-200 rounded-xl shadow-2xl z-50 p-4 backdrop-blur-sm">
                    {/* Long Term Section */}
                    <div className="mb-4">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-1.5 h-4 bg-gradient-to-b from-emerald-500 to-emerald-600 rounded-full" />
                        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Long Term</span>
                      </div>
                      <div className="bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden">
                        <table className="w-full">
                          <tbody>
                            {Object.entries(historicalFrequencies).map(([key, config], idx) => (
                              <tr key={key} className={idx % 2 === 0 ? 'bg-gray-50/50' : 'bg-white'}>
                                <td className="py-1.5 pl-3 pr-4 text-xs font-medium text-gray-600 whitespace-nowrap">
                                  {config.label}
                                </td>
                                {config.intervals.map((interval) => {
                                  const isSelected = currentPanel.selectedFreq?.frequencyKey === key &&
                                    currentPanel.selectedFreq?.interval === interval &&
                                    !currentPanel.selectedFreq?.isIntraday
                                  return (
                                    <td key={interval} className="py-1 px-0.5">
                                      <button
                                        onClick={() => applyFrequencySelection(key, interval, false)}
                                        className={`w-full px-2.5 py-1 text-xs font-medium rounded-md transition-all duration-150 text-center border ${
                                          isSelected
                                            ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                            : 'bg-gradient-to-b from-gray-50 to-gray-100 hover:from-emerald-50 hover:to-emerald-100 hover:text-emerald-700 text-gray-600 border-gray-200 hover:border-emerald-300 hover:shadow-sm'
                                        }`}
                                      >
                                        {interval}
                                      </button>
                                    </td>
                                  )
                                })}
                                {Array.from({ length: 6 - config.intervals.length }).map((_, i) => (
                                  <td key={`empty-${i}`} className="py-1 px-0.5" />
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Short Term Section */}
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-1.5 h-4 bg-gradient-to-b from-blue-500 to-blue-600 rounded-full" />
                        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Short Term</span>
                      </div>
                      <div className="bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden">
                        <table className="w-full">
                          <tbody>
                            {Object.entries(intradayFrequencies).map(([key, config], idx) => (
                              <tr key={key} className={idx % 2 === 0 ? 'bg-gray-50/50' : 'bg-white'}>
                                <td className="py-1.5 pl-3 pr-4 text-xs font-medium text-gray-600 whitespace-nowrap">
                                  {config.label}
                                </td>
                                {config.intervals.map((interval) => {
                                  const isSelected = currentPanel.selectedFreq?.frequencyKey === key &&
                                    currentPanel.selectedFreq?.interval === interval &&
                                    currentPanel.selectedFreq?.isIntraday
                                  return (
                                    <td key={interval} className="py-1 px-0.5">
                                      <button
                                        onClick={() => applyFrequencySelection(key, interval, true)}
                                        className={`w-full px-2.5 py-1 text-xs font-medium rounded-md transition-all duration-150 text-center border ${
                                          isSelected
                                            ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                            : 'bg-gradient-to-b from-gray-50 to-gray-100 hover:from-blue-50 hover:to-blue-100 hover:text-blue-700 text-gray-600 border-gray-200 hover:border-blue-300 hover:shadow-sm'
                                        }`}
                                      >
                                        {interval}
                                      </button>
                                    </td>
                                  )
                                })}
                                {Array.from({ length: 6 - config.intervals.length }).map((_, i) => (
                                  <td key={`empty-${i}`} className="py-1 px-0.5" />
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Custom Date Range Button */}
            <div className="relative">
              <button
                onClick={() => setShowCustomDatePicker(!showCustomDatePicker)}
                className={`px-2 py-1 text-xs font-medium rounded transition-colors flex items-center space-x-1 ${
                  currentPanel.timeFrame === 'CUSTOM' && !currentPanel.selectedFreq
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-300'
                }`}
              >
                <Calendar className="w-3 h-3" />
                <span>Custom</span>
              </button>

              {/* Custom Date Picker Dropdown */}
              {showCustomDatePicker && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowCustomDatePicker(false)} />
                  <div className="absolute right-0 top-full mt-2 w-72 bg-white border border-gray-200 rounded-lg shadow-xl z-50 p-4">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-medium text-gray-900 text-sm">Custom Date Range</h3>
                      <button
                        onClick={() => setShowCustomDatePicker(false)}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="space-y-3">
                      {/* Start Date */}
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Start Date
                        </label>
                        <input
                          type="date"
                          value={customStartDate}
                          onChange={(e) => setCustomStartDate(e.target.value)}
                          className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      {/* End Date */}
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          End Date
                        </label>
                        <input
                          type="date"
                          value={customEndDate}
                          onChange={(e) => setCustomEndDate(e.target.value)}
                          className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      {/* Interval/Frequency */}
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Frequency
                        </label>
                        <select
                          value={customInterval}
                          onChange={(e) => setCustomInterval(e.target.value as CustomDateRange['interval'])}
                          className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="1m">1 Minute</option>
                          <option value="5m">5 Minutes</option>
                          <option value="15m">15 Minutes</option>
                          <option value="30m">30 Minutes</option>
                          <option value="1h">1 Hour</option>
                          <option value="1d">Daily</option>
                          <option value="1wk">Weekly</option>
                          <option value="1mo">Monthly</option>
                        </select>
                      </div>

                      {/* Apply Button */}
                      <button
                        onClick={applyCustomDateRange}
                        className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded transition-colors"
                      >
                        Apply
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

            {/* Chart Type Selector */}
            <div className="flex items-center space-x-1 bg-gray-200 rounded-lg p-1">
              {chartTypes.map((ct) => {
                const Icon = ct.icon
                return (
                  <button
                    key={ct.value}
                    onClick={() => updatePanel(activePanel, { chartType: ct.value })}
                    title={ct.label}
                    className={`p-1.5 rounded transition-colors ${
                      currentPanel.chartType === ct.value
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-300'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </button>
                )
              })}
            </div>

            {/* Metric Selector */}
            <div className="relative">
              <button
                onClick={() => setShowMetricMenu(!showMetricMenu)}
                className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  showMetricMenu ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600 hover:text-gray-900'
                }`}
              >
                {(() => {
                  const metric = metricOptions.find(m => m.value === currentPanel.metric)
                  const Icon = metric?.icon || DollarSign
                  return <Icon className="w-4 h-4" />
                })()}
                <span>{metricOptions.find(m => m.value === currentPanel.metric)?.label || 'Price'}</span>
                <ChevronDown className="w-3 h-3" />
              </button>

              {showMetricMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowMetricMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-xl z-50">
                    <div className="p-2">
                      <div className="text-xs font-medium text-gray-500 uppercase px-2 py-1">Select Metric</div>
                      {metricOptions.map((metric) => {
                        const Icon = metric.icon
                        const isSelected = currentPanel.metric === metric.value
                        return (
                          <button
                            key={metric.value}
                            onClick={() => {
                              updatePanel(activePanel, { metric: metric.value })
                              setShowMetricMenu(false)
                            }}
                            className={`w-full flex items-center space-x-3 px-3 py-2 rounded-md transition-colors ${
                              isSelected ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-100 text-gray-700'
                            }`}
                          >
                            <Icon className="w-4 h-4" />
                            <div className="text-left">
                              <div className="text-sm font-medium">{metric.label}</div>
                              <div className="text-xs text-gray-500">{metric.description}</div>
                            </div>
                            {isSelected && <div className="ml-auto w-2 h-2 bg-blue-600 rounded-full" />}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Indicators */}
            <div className="relative">
              <button
                onClick={() => setShowIndicatorMenu(!showIndicatorMenu)}
                className="flex items-center space-x-1 px-3 py-1.5 bg-gray-200 text-gray-600 hover:text-gray-900 rounded-lg text-sm transition-colors"
              >
                <Layers className="w-4 h-4" />
                <span>Indicators</span>
                {currentPanel.indicators.length > 0 && (
                  <span className="bg-blue-600 text-white text-xs px-1.5 rounded-full">
                    {currentPanel.indicators.length}
                  </span>
                )}
              </button>

              {showIndicatorMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowIndicatorMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-xl z-50 max-h-80 overflow-auto">
                    {['Moving Averages', 'Oscillators', 'Volume', 'Volatility', 'Trend'].map((category) => (
                      <div key={category}>
                        <div className="px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide bg-gray-50">
                          {category}
                        </div>
                        {indicators.filter(i => i.category === category).map((indicator) => (
                          <button
                            key={indicator.id}
                            onClick={() => toggleIndicator(indicator.id)}
                            className="w-full px-3 py-2 text-left hover:bg-gray-100 transition-colors flex items-center justify-between"
                          >
                            <span className="text-sm text-gray-700">{indicator.name}</span>
                            {currentPanel.indicators.includes(indicator.id) && (
                              <span className="w-2 h-2 bg-blue-500 rounded-full" />
                            )}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Compare Symbols */}
            <div className="relative">
              <button
                onClick={() => setShowCompareMenu(!showCompareMenu)}
                className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  showCompareMenu || (currentPanel.compareSymbols?.length || 0) > 0
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-600 hover:text-gray-900'
                }`}
              >
                <TrendingUp className="w-4 h-4" />
                <span>Compare</span>
                {(currentPanel.compareSymbols?.length || 0) > 0 && (
                  <span className="bg-white/20 text-white text-xs px-1.5 rounded-full">
                    {currentPanel.compareSymbols?.length}
                  </span>
                )}
              </button>

              {showCompareMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowCompareMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-xl z-50">
                    <div className="p-3 border-b border-gray-100">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                          type="text"
                          placeholder="Add symbol to compare..."
                          value={compareSearchQuery}
                          onChange={(e) => setCompareSearchQuery(e.target.value)}
                          className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          autoFocus
                        />
                      </div>
                      {compareSearchQuery && compareSearchResults.length > 0 && (
                        <div className="mt-2 max-h-40 overflow-auto border border-gray-200 rounded-lg">
                          {compareSearchResults.map((asset: any) => (
                            <button
                              key={asset.id}
                              onClick={() => addCompareSymbol(asset)}
                              disabled={asset.symbol === currentPanel.symbol || currentPanel.compareSymbols?.some(s => s.symbol === asset.symbol)}
                              className="w-full px-3 py-2 text-left hover:bg-gray-100 transition-colors flex items-center justify-between disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <span className="font-medium text-gray-900">{asset.symbol}</span>
                              <span className="text-xs text-gray-500 truncate ml-2">{asset.company_name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Current comparisons */}
                    {currentPanel.compareSymbols && currentPanel.compareSymbols.length > 0 && (
                      <div className="p-2">
                        <div className="text-xs font-medium text-gray-500 uppercase px-2 py-1">Comparing</div>
                        {currentPanel.compareSymbols.map((s) => (
                          <div
                            key={s.symbol}
                            className="flex items-center justify-between px-2 py-1.5 hover:bg-gray-50 rounded"
                          >
                            <div className="flex items-center space-x-2">
                              <span className="text-sm font-medium text-gray-700">{s.symbol}</span>
                              <span className="text-xs text-gray-400">{s.companyName}</span>
                            </div>
                            <button
                              onClick={() => removeCompareSymbol(s.symbol)}
                              className="text-gray-400 hover:text-red-500 p-1"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Display Mode */}
                    <div className="p-2 border-t border-gray-100">
                      <div className="text-xs font-medium text-gray-500 uppercase px-2 py-1">Display Mode</div>
                      <div className="flex gap-1 px-2">
                        {displayModeOptions.map((mode) => (
                          <button
                            key={mode.value}
                            onClick={() => setDisplayMode(mode.value)}
                            className={`flex-1 px-2 py-1.5 text-xs font-medium rounded transition-colors ${
                              currentPanel.displayMode === mode.value
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                            title={mode.description}
                          >
                            {mode.label}
                          </button>
                        ))}
                      </div>
                      {/* Index base input - shown when Indexed mode is selected */}
                      {currentPanel.displayMode === 'indexed' && (
                        <div className="mt-2 px-2">
                          <label className="flex items-center gap-2 text-xs text-gray-600">
                            <span>Index to:</span>
                            <input
                              type="number"
                              value={currentPanel.indexBase || DEFAULT_INDEX_BASE}
                              onChange={(e) => updatePanel(activePanel, { indexBase: Number(e.target.value) || DEFAULT_INDEX_BASE })}
                              className="w-20 px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                              min="1"
                              step="1"
                            />
                            <span className="text-gray-400">at start</span>
                          </label>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* View Mode Toggle */}
            <div className="flex items-center space-x-1 bg-gray-200 rounded-lg p-1">
              <button
                onClick={() => setViewMode('single')}
                title="Single Chart"
                className={`p-1.5 rounded transition-colors ${
                  viewMode === 'single'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-300'
                }`}
              >
                <Maximize2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('grid')}
                title="Grid View"
                className={`p-1.5 rounded transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-300'
                }`}
              >
                <Grid3X3 className="w-4 h-4" />
              </button>
            </div>

            {/* Add Panel */}
            <button
              onClick={addPanel}
              className="p-1.5 bg-gray-200 text-gray-600 hover:text-gray-900 rounded-lg transition-colors"
              title="Add Chart Panel"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Panel Tabs (if multiple panels) */}
      {panels.length > 1 && (
        <div className="bg-gray-100 border-b border-gray-200 px-4 py-1 flex items-center space-x-1">
          {panels.map((panel) => (
            <div
              key={panel.id}
              className={`flex items-center space-x-2 px-3 py-1 rounded-t text-sm cursor-pointer transition-colors ${
                activePanel === panel.id
                  ? 'bg-white text-gray-900 border-t border-l border-r border-gray-200'
                  : 'bg-gray-200 text-gray-600 hover:text-gray-900'
              }`}
              onClick={() => setActivePanel(panel.id)}
            >
              <span>{panel.symbol || 'New Chart'}</span>
              {panels.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    removePanel(panel.id)
                  }}
                  className="text-gray-400 hover:text-red-500"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Main Chart Area */}
      <div className="flex-1 flex overflow-hidden" onClick={() => { closeContextMenu(); closeLineContextMenu(); }}>
        {/* Chart Canvas */}
        <div className="flex-1 overflow-hidden">
          {viewMode === 'single' ? (
            <div className="h-full bg-white">
              {currentPanel.symbol ? (
                <ProChart
                  symbol={currentPanel.symbol}
                  chartType={currentPanel.chartType}
                  timeFrame={currentPanel.timeFrame}
                  customRange={currentPanel.customRange}
                  showVolume={currentPanel.indicators.includes('volume')}
                  indicators={currentPanel.indicators.filter(i => i !== 'volume') as IndicatorType[]}
                  annotations={currentPanel.annotations}
                  compareSymbols={currentPanel.compareSymbols}
                  displayMode={currentPanel.displayMode}
                  indexBase={currentPanel.indexBase}
                  selectedLine={selectedLine}
                  mainSymbolStyle={currentPanel.mainSymbolStyle}
                  onContextMenu={handleChartContextMenu}
                  onLineContextMenu={handleLineContextMenu}
                  onLineClick={handleLineClick}
                />
              ) : (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center">
                    <LineChart className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-500 mb-2">No Symbol Selected</h3>
                    <p className="text-gray-400 text-sm">
                      Search for a symbol above
                    </p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="h-full grid grid-cols-2 gap-px bg-gray-200">
              {panels.map((panel) => (
                <div
                  key={panel.id}
                  onClick={() => setActivePanel(panel.id)}
                  className={`bg-white transition-colors cursor-pointer relative ${
                    activePanel === panel.id
                      ? 'ring-2 ring-inset ring-blue-500'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  {panel.symbol ? (
                    <ProChart
                      symbol={panel.symbol}
                      chartType={panel.chartType}
                      timeFrame={panel.timeFrame}
                      customRange={panel.customRange}
                      showVolume={panel.indicators.includes('volume')}
                      indicators={panel.indicators.filter(i => i !== 'volume') as IndicatorType[]}
                      annotations={panel.annotations}
                      compareSymbols={panel.compareSymbols}
                      displayMode={panel.displayMode}
                      indexBase={panel.indexBase}
                      selectedLine={panel.id === activePanel ? selectedLine : null}
                      mainSymbolStyle={panel.mainSymbolStyle}
                      onContextMenu={panel.id === activePanel ? handleChartContextMenu : undefined}
                      onLineContextMenu={panel.id === activePanel ? handleLineContextMenu : undefined}
                      onLineClick={panel.id === activePanel ? handleLineClick : undefined}
                    />
                  ) : (
                    <div className="h-full flex items-center justify-center">
                      <div className="text-center">
                        <Plus className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                        <p className="text-sm text-gray-400">Add Symbol</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right-Click Context Menu for Annotations */}
      {contextMenu.visible && (
        <>
          <div className="fixed inset-0 z-50" onClick={closeContextMenu} />
          <div
            className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-xl py-2 min-w-[200px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {/* Drawing Tools Section */}
            <div className="px-3 py-1.5 text-xs font-medium text-gray-500 uppercase tracking-wide">
              Add Annotation
            </div>
            {annotationTools.map((tool) => {
              const Icon = tool.icon
              return (
                <button
                  key={tool.type}
                  onClick={() => addAnnotation(tool.type)}
                  className="w-full flex items-center space-x-3 px-3 py-2 hover:bg-gray-100 transition-colors text-left"
                >
                  <Icon className="w-4 h-4 text-gray-500" />
                  <span className="text-sm text-gray-700">{tool.label}</span>
                </button>
              )
            })}

            {/* Divider */}
            <div className="my-2 border-t border-gray-200" />

            {/* Actions */}
            {currentPanel.annotations.length > 0 && (
              <>
                <button
                  onClick={clearAllAnnotations}
                  className="w-full flex items-center space-x-3 px-3 py-2 hover:bg-red-50 transition-colors text-left text-red-600"
                >
                  <Trash2 className="w-4 h-4" />
                  <span className="text-sm">Clear All Annotations</span>
                </button>
              </>
            )}

            {/* Price/Time at cursor */}
            <div className="px-3 py-2 text-xs text-gray-500 border-t border-gray-200 mt-2">
              <div>Price: ${contextMenu.chartY.toFixed(2)}</div>
              <div>Time: {new Date(contextMenu.chartX * 1000).toLocaleDateString()}</div>
            </div>
          </div>
        </>
      )}

      {/* Right-Click Context Menu for Line Formatting */}
      {lineContextMenu.visible && (
          <div
            data-line-context-menu
            className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-xl py-2 min-w-[220px]"
            style={{ left: lineContextMenu.x, top: lineContextMenu.y }}
          >
            {/* Header */}
            <div className="px-3 py-1.5 text-xs font-medium text-gray-500 uppercase tracking-wide border-b border-gray-100 mb-1">
              Format: {lineContextMenu.symbol}
            </div>

            {/* Color Selection */}
            <div className="px-3 py-2">
              <div className="text-xs font-medium text-gray-600 mb-2">Color</div>
              <div className="flex flex-wrap gap-1.5">
                {LINE_COLORS.map((color) => {
                  const currentStyle = lineContextMenu.isMainSymbol
                    ? currentPanel.mainSymbolStyle
                    : currentPanel.compareSymbols?.find(cs => cs.symbol === lineContextMenu.symbol)
                  const defaultColor = lineContextMenu.isMainSymbol ? '#3b82f6' : '#666666'
                  const isSelected = (currentStyle?.color || defaultColor) === color.value
                  return (
                    <button
                      key={color.value}
                      onClick={() => {
                        if (lineContextMenu.isMainSymbol) {
                          updateMainSymbolStyle({ color: color.value })
                        } else {
                          updateCompareSymbolStyle(lineContextMenu.symbol, { color: color.value })
                        }
                      }}
                      className={`w-6 h-6 rounded-full border-2 transition-all ${
                        isSelected ? 'border-gray-800 scale-110' : 'border-transparent hover:scale-110'
                      }`}
                      style={{ backgroundColor: color.value }}
                      title={color.label}
                    />
                  )
                })}
              </div>
            </div>

            {/* Line Width */}
            <div className="px-3 py-2 border-t border-gray-100">
              <div className="text-xs font-medium text-gray-600 mb-2">Line Width</div>
              <div className="flex gap-1">
                {LINE_WIDTHS.map((width) => {
                  const currentStyle = lineContextMenu.isMainSymbol
                    ? currentPanel.mainSymbolStyle
                    : currentPanel.compareSymbols?.find(cs => cs.symbol === lineContextMenu.symbol)
                  const isSelected = (currentStyle?.lineWidth || 2) === width
                  return (
                    <button
                      key={width}
                      onClick={() => {
                        if (lineContextMenu.isMainSymbol) {
                          updateMainSymbolStyle({ lineWidth: width })
                        } else {
                          updateCompareSymbolStyle(lineContextMenu.symbol, { lineWidth: width })
                        }
                      }}
                      className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors ${
                        isSelected
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {width}px
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Line Style */}
            <div className="px-3 py-2 border-t border-gray-100">
              <div className="text-xs font-medium text-gray-600 mb-2">Line Style</div>
              <div className="flex gap-1">
                {LINE_STYLES.map((style) => {
                  const currentStyle = lineContextMenu.isMainSymbol
                    ? currentPanel.mainSymbolStyle
                    : currentPanel.compareSymbols?.find(cs => cs.symbol === lineContextMenu.symbol)
                  const isSelected = (currentStyle?.lineStyle || 'solid') === style.value
                  return (
                    <button
                      key={style.value}
                      onClick={() => {
                        if (lineContextMenu.isMainSymbol) {
                          updateMainSymbolStyle({ lineStyle: style.value })
                        } else {
                          updateCompareSymbolStyle(lineContextMenu.symbol, { lineStyle: style.value })
                        }
                      }}
                      className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors ${
                        isSelected
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {style.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Remove Line - only for comparison symbols */}
            {!lineContextMenu.isMainSymbol && (
              <div className="px-3 py-2 border-t border-gray-100">
                <button
                  onClick={() => {
                    removeCompareSymbol(lineContextMenu.symbol)
                    closeLineContextMenu()
                  }}
                  className="w-full py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded transition-colors"
                >
                  Remove from Chart
                </button>
              </div>
            )}
          </div>
      )}
    </div>
  )
}
