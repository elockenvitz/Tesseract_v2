import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { clsx } from 'clsx'
import {
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Customized
} from 'recharts'
import {
  TrendingUp,
  TrendingDown,
  ChevronDown,
  AlertTriangle,
  CheckCircle,
  Clock,
  GitBranch,
  Minus,
  BarChart3
} from 'lucide-react'
import {
  usePriceTargetChart,
  useChartAnalysts,
  ChartTimeframe,
  TargetViewMode,
  ChartTarget
} from '../../hooks/usePriceTargetChart'
import { ProbabilityDistributionModal } from './ProbabilityDistributionModal'

interface PriceTargetChartProps {
  assetId: string
  symbol: string
  className?: string
  height?: number
  selectedUserId?: string // Filter to show only this user's targets
  onTargetClick?: (target: ChartTarget) => void
  onAddTarget?: (price: number, scenarioId?: string) => void
  onUpdateProbabilities?: (updates: Array<{ targetId: string; probability: number }>) => Promise<void>
}

// Annotation info for when user clicks on a set/renewed marker
interface SelectedAnnotation {
  type: 'set' | 'renewed'
  timestamp: number
  priceAtEvent: number
  target: ChartTarget
}

// Timeframe options matching target horizons
const TIMEFRAMES: { value: ChartTimeframe; label: string }[] = [
  { value: '1M', label: '1M' },
  { value: '3M', label: '3M' },
  { value: '6M', label: '6M' },
  { value: '1Y', label: '1Y' },
  { value: '2Y', label: '2Y' },
  { value: '5Y', label: '5Y' },
  { value: '10Y', label: '10Y' }
]

// Chart display modes
type ChartDisplayMode = 'projection' | 'levels'

// Status badge component
function StatusBadge({ status }: { status: ChartTarget['status'] }) {
  const config = {
    pending: { icon: Clock, color: 'text-amber-600 bg-amber-50', label: 'Active' },
    hit: { icon: CheckCircle, color: 'text-green-600 bg-green-50', label: 'Hit' },
    missed: { icon: AlertTriangle, color: 'text-red-600 bg-red-50', label: 'Missed' },
    expired: { icon: AlertTriangle, color: 'text-gray-600 bg-gray-50', label: 'Expired' },
    cancelled: { icon: Minus, color: 'text-gray-400 bg-gray-50', label: 'Cancelled' }
  }

  const { icon: Icon, color, label } = config[status]

  return (
    <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', color)}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  )
}

export function PriceTargetChart({
  assetId,
  symbol,
  className,
  height = 480,
  selectedUserId: propSelectedUserId,
  onTargetClick,
  onAddTarget,
  onUpdateProbabilities
}: PriceTargetChartProps) {
  const [timeframe, setTimeframe] = useState<ChartTimeframe>('1Y')
  const [viewMode, setViewMode] = useState<TargetViewMode>('all')
  const [internalSelectedUserId, setInternalSelectedUserId] = useState<string>()
  const [hoveredTarget, setHoveredTarget] = useState<string | null>(null)
  const [selectedTarget, setSelectedTarget] = useState<ChartTarget | null>(null)
  const [selectedAnnotation, setSelectedAnnotation] = useState<SelectedAnnotation | null>(null)
  const [showProbabilityModal, setShowProbabilityModal] = useState(false)
  const [chartDisplayMode, setChartDisplayMode] = useState<ChartDisplayMode>('projection')
  const [showDistribution, setShowDistribution] = useState(false)
  const [yZoom, setYZoom] = useState(0) // continuous zoom: 0 = auto, positive = zoom out, negative = zoom in

  // Y-axis drag-to-zoom
  const chartWrapperRef = useRef<HTMLDivElement>(null)
  const yDragRef = useRef<{ startY: number; startZoom: number } | null>(null)

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!yDragRef.current) return
      const deltaY = e.clientY - yDragRef.current.startY
      // Dragging down = zoom out (positive), dragging up = zoom in (negative)
      // Scale: ~100px of drag = 1 zoom unit
      setYZoom(yDragRef.current.startZoom + deltaY / 80)
    }
    const handleMouseUp = () => {
      if (yDragRef.current) {
        yDragRef.current = null
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  const handleYAxisMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    yDragRef.current = { startY: e.clientY, startZoom: yZoom }
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
  }, [yZoom])

  const handleYAxisDoubleClick = useCallback(() => {
    setYZoom(0)
  }, [])

  // Stable unique ID for SVG gradient to avoid conflicts when multiple charts exist
  const gradientId = useMemo(() => `distGradient-${assetId}-${propSelectedUserId || 'all'}`, [assetId, propSelectedUserId])

  // Use prop user ID if provided, otherwise use internal state
  const effectiveUserId = propSelectedUserId || internalSelectedUserId
  const effectiveViewMode = propSelectedUserId ? 'single' : viewMode

  // Get chart analysts for the dropdown (only when not filtering by prop)
  const analysts = useChartAnalysts(assetId)

  // Get chart data
  const {
    historicalPrices,
    priceTargets,
    currentPrice,
    priceChange,
    priceChangePercent,
    riskRewardRatio,
    loading,
    fetching,
    error
  } = usePriceTargetChart({
    assetId,
    symbol,
    timeframe,
    viewMode: effectiveViewMode,
    selectedUserId: effectiveUserId,
    coveringOnly: effectiveViewMode === 'covering'
  })

  // Transform historical data for Recharts - use timestamps for proper time scaling
  const chartData = useMemo(() => {
    // Convert historical data with timestamps
    const historical = historicalPrices.map(d => ({
      timestamp: new Date(d.time).getTime(),
      date: d.time,
      price: d.close,
      high: d.high,
      low: d.low,
      open: d.open,
      volume: d.volume,
      isProjection: false
    }))

    return historical
  }, [historicalPrices])


  // Get today's timestamp
  const todayTimestamp = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return today.getTime()
  }, [])

  // Filter targets to only those with future target dates
  const futureTargets = useMemo(() => {
    return priceTargets.filter(t => {
      if (!t.targetDate) return false
      const targetTs = new Date(t.targetDate).getTime()
      return targetTs > todayTimestamp
    })
  }, [priceTargets, todayTimestamp])

  // Calculate X-axis domain to include future target dates
  const xAxisDomain = useMemo(() => {
    if (chartData.length === 0) return [Date.now() - 365 * 24 * 60 * 60 * 1000, Date.now()]

    const historicalMin = chartData[0]?.timestamp || Date.now()
    const historicalMax = chartData[chartData.length - 1]?.timestamp || Date.now()

    // Find the furthest future target date
    const futureTargetTimestamps = futureTargets.map(t => new Date(t.targetDate!).getTime())

    const maxTimestamp = futureTargetTimestamps.length > 0
      ? Math.max(historicalMax, ...futureTargetTimestamps)
      : historicalMax

    // Add some padding to the right for labels
    const padding = (maxTimestamp - historicalMin) * 0.08

    return [historicalMin, maxTimestamp + padding]
  }, [chartData, futureTargets])

  // Generate x-axis ticks including future dates
  const xAxisTicks = useMemo(() => {
    if (chartData.length === 0) return []

    const ticks: number[] = []
    const [minTs, maxTs] = xAxisDomain
    const range = maxTs - minTs

    // Generate roughly 6-8 ticks across the range
    const tickInterval = range / 7

    for (let ts = minTs; ts <= maxTs; ts += tickInterval) {
      ticks.push(ts)
    }

    // Add today if not already included
    if (!ticks.some(t => Math.abs(t - todayTimestamp) < tickInterval / 2)) {
      ticks.push(todayTimestamp)
    }

    // Sort ticks
    ticks.sort((a, b) => a - b)

    return ticks
  }, [chartData, xAxisDomain, todayTimestamp])

  // Calculate Y-axis domain to include all price targets
  // yZoom: 0 = auto, negative = zoom in (tighter), positive = zoom out (wider)
  const yAxisDomain = useMemo(() => {
    if (chartData.length === 0) return [0, 100]

    const prices = chartData.map(d => d.price).filter((p): p is number => p !== null)
    const targetPrices = priceTargets.map(t => t.price)
    const allPrices = [...prices, ...targetPrices]

    if (allPrices.length === 0) return [0, 100]

    const min = Math.min(...allPrices)
    const max = Math.max(...allPrices)
    const range = max - min
    // Base 15% padding, scaled by zoom level (each step is ~30% more/less padding)
    const zoomMultiplier = Math.pow(1.3, yZoom)
    const padding = range * 0.15 * zoomMultiplier
    // Round domain bounds to clean numbers for nicer tick marks
    const rawMin = Math.max(0, min - padding)
    const rawMax = max + padding
    // Round to nearest reasonable increment based on price magnitude
    const step = range > 100 ? 10 : range > 20 ? 5 : range > 5 ? 1 : 0.5
    const cleanMin = Math.floor(rawMin / step) * step
    const cleanMax = Math.ceil(rawMax / step) * step

    return [cleanMin, cleanMax]
  }, [chartData, priceTargets, yZoom])

  // Group targets by scenario for display
  const targetsByScenario = useMemo(() => {
    const grouped = new Map<string, ChartTarget[]>()
    priceTargets.forEach(target => {
      const key = target.scenarioName
      if (!grouped.has(key)) {
        grouped.set(key, [])
      }
      grouped.get(key)!.push(target)
    })
    return grouped
  }, [priceTargets])

  // EV, horizon, and distribution summary computations
  const { evPrice, evReturn, hasEVData } = useMemo(() => {
    const withProb = priceTargets.filter(t => t.probability != null && t.probability > 0 && t.price > 0)
    if (withProb.length === 0 || currentPrice <= 0) return { evPrice: null, evReturn: null, hasEVData: false }
    const totalProb = withProb.reduce((s, t) => s + t.probability!, 0)
    const ev = withProb.reduce((s, t) => s + t.price * t.probability!, 0) / totalProb
    return { evPrice: ev, evReturn: (ev - currentPrice) / currentPrice, hasEVData: true }
  }, [priceTargets, currentPrice])

  const horizonYears = useMemo(() => {
    const baseTarget = priceTargets.find(t => t.scenarioName.toLowerCase() === 'base')
    const refTarget = baseTarget || priceTargets.find(t => t.targetDate)
    if (!refTarget?.targetDate) return null
    const diffMs = new Date(refTarget.targetDate).getTime() - Date.now()
    if (diffMs <= 0) return null
    return diffMs / (365.25 * 24 * 60 * 60 * 1000)
  }, [priceTargets])

  const annualizedReturn = useMemo(() => {
    if (evReturn == null || horizonYears == null) return null
    if (horizonYears >= 0.9 && horizonYears <= 1.1) return null
    if (1 + evReturn <= 0) return null
    return Math.pow(1 + evReturn, 1 / horizonYears) - 1
  }, [evReturn, horizonYears])

  const distributionSummary = useMemo(() => {
    if (!hasEVData || currentPrice <= 0) return null
    const withProb = priceTargets.filter(t => t.probability != null && t.probability > 0 && t.price > 0)
    if (withProb.length < 2) return null

    const totalProb = withProb.reduce((s, t) => s + t.probability!, 0)
    let bullContrib = 0
    let bearContrib = 0
    withProb.forEach(t => {
      const normProb = t.probability! / totalProb
      const ret = (t.price - currentPrice) / currentPrice
      if (ret > 0) bullContrib += normProb * ret
      else bearContrib += normProb * ret
    })

    const netSkew = bullContrib + bearContrib
    let skewText: string
    if (netSkew > 0.05) skewText = 'Bull-skewed'
    else if (netSkew < -0.05) skewText = 'Bear-skewed'
    else skewText = 'Balanced'

    let horizonText = ''
    if (horizonYears != null) {
      if (horizonYears < 1) horizonText = `${Math.round(horizonYears * 12)}mo horizon`
      else if (horizonYears < 1.5) horizonText = '1Y horizon'
      else horizonText = `${horizonYears.toFixed(1)}Y horizon`
    }

    let maxContrib = 0
    let driverName = ''
    withProb.forEach(t => {
      const normProb = t.probability! / totalProb
      const contrib = Math.abs(normProb * ((t.price - currentPrice) / currentPrice))
      if (contrib > maxContrib) {
        maxContrib = contrib
        driverName = t.scenarioName
      }
    })

    const parts = [skewText]
    if (horizonText) parts.push(horizonText)
    if (driverName) parts.push(`${driverName}-driven`)
    return parts.join(' \u00b7 ')
  }, [priceTargets, currentPrice, hasEVData, horizonYears])

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null

    const data = payload[0].payload
    const date = new Date(label)

    return (
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 text-sm">
        <div className="font-medium text-gray-900 dark:text-white mb-2">
          {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
        <div className="space-y-1 text-gray-600 dark:text-gray-400">
          <div className="flex justify-between gap-4">
            <span>Price:</span>
            <span className="font-medium text-gray-900 dark:text-white">${data.price?.toFixed(2)}</span>
          </div>
          {data.high && (
            <div className="flex justify-between gap-4">
              <span>High:</span>
              <span className="text-green-600">${data.high?.toFixed(2)}</span>
            </div>
          )}
          {data.low && (
            <div className="flex justify-between gap-4">
              <span>Low:</span>
              <span className="text-red-600">${data.low?.toFixed(2)}</span>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Target line tooltip
  const TargetTooltip = ({ target }: { target: ChartTarget }) => (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-4 min-w-64">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: target.scenarioColor }}
          />
          <span className="font-medium text-gray-900 dark:text-white">
            {target.scenarioName}
          </span>
        </div>
        <StatusBadge status={target.status} />
      </div>

      <div className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        ${target.price.toFixed(2)}
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between text-gray-600 dark:text-gray-400">
          <span>Analyst:</span>
          <span className="font-medium text-gray-900 dark:text-white flex items-center gap-1">
            {target.isCovering && (
              <span className="w-2 h-2 rounded-full bg-yellow-400" title="Covering" />
            )}
            {target.userName}
          </span>
        </div>
        {target.timeframe && (
          <div className="flex justify-between text-gray-600 dark:text-gray-400">
            <span>Timeframe:</span>
            <span className="text-gray-900 dark:text-white">{target.timeframe}</span>
          </div>
        )}
        {target.targetDate && (
          <div className="flex justify-between text-gray-600 dark:text-gray-400">
            <span>Target Date:</span>
            <span className="text-gray-900 dark:text-white">
              {new Date(target.targetDate).toLocaleDateString()}
            </span>
          </div>
        )}
        {target.probability && (
          <div className="flex justify-between text-gray-600 dark:text-gray-400">
            <span>Probability:</span>
            <span className="text-gray-900 dark:text-white">{target.probability}%</span>
          </div>
        )}
        {currentPrice > 0 && (
          <div className="flex justify-between text-gray-600 dark:text-gray-400">
            <span>vs Current:</span>
            <span className={clsx(
              'font-medium',
              target.price > currentPrice ? 'text-green-600' : 'text-red-600'
            )}>
              {target.price > currentPrice ? '+' : ''}
              {(((target.price - currentPrice) / currentPrice) * 100).toFixed(1)}%
            </span>
          </div>
        )}
      </div>

      {target.reasoning && (
        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Reasoning:</div>
          <div className="text-sm text-gray-700 dark:text-gray-300 line-clamp-3">
            {target.reasoning}
          </div>
        </div>
      )}
    </div>
  )

  // Only show skeleton on initial load (no data yet)
  const isInitialLoad = loading && historicalPrices.length === 0

  if (isInitialLoad) {
    return (
      <div className={clsx('bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-6', className)}>
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
          <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={clsx('bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-6', className)}>
        <div className="text-center py-8 text-red-500">
          <AlertTriangle className="w-8 h-8 mx-auto mb-2" />
          <p>Failed to load chart data</p>
          <p className="text-sm text-gray-500 mt-1">{error.message}</p>
        </div>
      </div>
    )
  }

  return (
    <div className={clsx('bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 relative', className)}>
      {/* Loading overlay for refetching (only when changing timeframe, not initial load) */}
      {fetching && !loading && (
        <div className="absolute inset-0 bg-white/50 dark:bg-gray-900/50 z-10 flex items-center justify-center rounded-lg pointer-events-none">
          <div className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
            <div className="w-4 h-4 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-gray-600 dark:text-gray-400">Loading...</span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Left: Price Info */}
          <div className="flex items-center gap-4">
            {/* Current Price - secondary */}
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Current</div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white">
                ${currentPrice.toFixed(2)}
              </div>
              <div className={clsx(
                'flex items-center gap-1 text-xs',
                priceChange >= 0 ? 'text-green-600' : 'text-red-600'
              )}>
                {priceChange >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                <span>{priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)} ({priceChangePercent >= 0 ? '+' : ''}{priceChangePercent.toFixed(2)}%)</span>
              </div>
            </div>

            {/* EV + Expected Return - primary */}
            {hasEVData && evPrice != null && evReturn != null && (
              <>
                <div className="w-px h-10 bg-gray-200 dark:bg-gray-700" />
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Expected Value</div>
                  <div className="text-2xl font-bold text-gray-900 dark:text-white">
                    ${evPrice.toFixed(2)}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={clsx('text-sm font-semibold', evReturn >= 0 ? 'text-green-600' : 'text-red-600')}>
                      {evReturn >= 0 ? '+' : ''}{(evReturn * 100).toFixed(1)}%
                    </span>
                    {annualizedReturn != null && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        ({annualizedReturn >= 0 ? '+' : ''}{(annualizedReturn * 100).toFixed(1)}%/yr)
                      </span>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Risk/Return - clickable to show probability distribution (only in individual view) */}
            {riskRewardRatio !== null && onUpdateProbabilities && (
              <button
                type="button"
                onClick={() => setShowProbabilityModal(true)}
                className="px-3 py-1 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-left"
              >
                <div className="text-xs text-gray-500 dark:text-gray-400">Risk/Return</div>
                <div className="font-semibold text-gray-900 dark:text-white flex items-center gap-1">
                  {riskRewardRatio.toFixed(2)}x
                  <span className="text-xs text-primary-600 dark:text-primary-400">{'\u2192'}</span>
                </div>
              </button>
            )}
            {/* Risk/Return - display only (in aggregated/other user views) */}
            {riskRewardRatio !== null && !onUpdateProbabilities && (
              <div className="px-3 py-1 bg-gray-100 dark:bg-gray-800 rounded-lg">
                <div className="text-xs text-gray-500 dark:text-gray-400">Risk/Return</div>
                <div className="font-semibold text-gray-900 dark:text-white">
                  {riskRewardRatio.toFixed(2)}x
                </div>
              </div>
            )}
          </div>

          {/* Right: Controls */}
          <div className="flex items-center gap-3">
            {/* Chart Display Mode Toggle */}
            <div className="flex items-center border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setChartDisplayMode('projection')}
                className={clsx(
                  'px-2.5 py-1.5 text-sm font-medium transition-colors flex items-center gap-1.5',
                  chartDisplayMode === 'projection'
                    ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                )}
                title="Projection view - lines to future targets"
              >
                <GitBranch className="w-4 h-4" />
                <span className="hidden sm:inline">Projection</span>
              </button>
              <button
                type="button"
                onClick={() => setChartDisplayMode('levels')}
                className={clsx(
                  'px-2.5 py-1.5 text-sm font-medium transition-colors flex items-center gap-1.5',
                  chartDisplayMode === 'levels'
                    ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                )}
                title="Levels view - horizontal price levels"
              >
                <Minus className="w-4 h-4" />
                <span className="hidden sm:inline">Levels</span>
              </button>
            </div>

            {/* Distribution Toggle */}
            <button
              type="button"
              onClick={() => setShowDistribution(!showDistribution)}
              className={clsx(
                'px-2.5 py-1.5 text-sm font-medium transition-colors flex items-center gap-1.5 border rounded-lg',
                showDistribution
                  ? 'bg-primary-100 dark:bg-primary-900/30 border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-400'
                  : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              )}
              title="Toggle probability distribution"
            >
              <BarChart3 className="w-4 h-4" />
              <span className="hidden sm:inline">Distribution</span>
            </button>


            {/* Timeframe Selector */}
            <div className="flex items-center border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
              {TIMEFRAMES.map(tf => (
                <button
                  type="button"
                  key={tf.value}
                  onClick={(e) => {
                    e.preventDefault()
                    setTimeframe(tf.value)
                  }}
                  className={clsx(
                    'px-3 py-1.5 text-sm font-medium transition-colors',
                    timeframe === tf.value
                      ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                  )}
                >
                  {tf.label}
                </button>
              ))}
            </div>

            {/* View Mode Dropdown - hide when user is provided via prop */}
            {!propSelectedUserId && (
              <div className="relative">
                <select
                  value={viewMode}
                  onChange={(e) => {
                    setViewMode(e.target.value as TargetViewMode)
                    if (e.target.value !== 'single') setInternalSelectedUserId(undefined)
                  }}
                  className="appearance-none pl-3 pr-8 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 cursor-pointer"
                >
                  <option value="all">All Targets</option>
                  <option value="covering">Covering Only</option>
                  <option value="byScenario">By Scenario</option>
                  {analysts.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.name} {a.isCovering ? '(Covering)' : ''}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
            )}

          </div>
        </div>
        {distributionSummary && (
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            {distributionSummary}
          </div>
        )}
      </div>

      {/* Chart */}
      <div className="p-4 relative" ref={chartWrapperRef}>
        {/* Y-axis drag overlay — covers the left margin + Y-axis label area */}
        <div
          className="absolute top-4 left-4 bottom-4 z-10"
          style={{ width: 80, cursor: 'ns-resize' }}
          onMouseDown={handleYAxisMouseDown}
          onDoubleClick={handleYAxisDoubleClick}
          title="Drag to adjust Y-axis scale · Double-click to reset"
        />
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={chartData} margin={{ top: 20, right: showDistribution ? 280 : 80, left: 20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.5} />

            <XAxis
              dataKey="timestamp"
              type="number"
              scale="time"
              domain={xAxisDomain}
              ticks={xAxisTicks}
              tickFormatter={(value) => {
                const date = new Date(value)
                // Show year for dates not in current year
                const isCurrentYear = date.getFullYear() === new Date().getFullYear()
                if (isCurrentYear) {
                  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                }
                return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
              }}
              stroke="#9ca3af"
              fontSize={12}
            />

            <YAxis
              domain={yAxisDomain}
              tickFormatter={(value) => `$${value.toFixed(0)}`}
              stroke="#9ca3af"
              fontSize={12}
              width={60}
            />

            <Tooltip content={<CustomTooltip />} />

            {/* Price Line */}
            <Area
              type="monotone"
              dataKey="price"
              stroke="#3b82f6"
              strokeWidth={2}
              fill="#3b82f6"
              fillOpacity={0.1}
              dot={false}
              activeDot={{ r: 4, fill: '#3b82f6' }}
            />

            {/* Current Price Line */}
            <ReferenceLine
              y={currentPrice}
              stroke="#6b7280"
              strokeDasharray="5 5"
              strokeWidth={1}
              label={{
                value: `Current $${currentPrice.toFixed(0)}`,
                position: 'left',
                fill: '#6b7280',
                fontSize: 10
              }}
            />

            {/* Today/Now vertical line */}
            <ReferenceLine
              x={todayTimestamp}
              stroke="#3b82f6"
              strokeWidth={2}
              strokeDasharray="4 4"
              label={{
                value: 'Now',
                position: 'top',
                fill: '#3b82f6',
                fontSize: 11,
                fontWeight: 600
              }}
            />

            {/* Projection lines from current price to each future target - using custom SVG */}
            <Customized
              component={(props: any) => {
                const { xAxisMap, yAxisMap } = props
                if (!xAxisMap || !yAxisMap) return null

                const xAxis = xAxisMap[0]
                const yAxis = yAxisMap[0]
                if (!xAxis || !yAxis || !xAxis.scale || !yAxis.scale) return null

                const lastPrice = currentPrice || (historicalPrices.length > 0 ? historicalPrices[historicalPrices.length - 1].close : 0)

                // Calculate the starting point (today at current price)
                const x1 = xAxis.scale(todayTimestamp)
                const y1 = yAxis.scale(lastPrice)

                // Get price at a specific timestamp from chartData
                const getPriceAtTimestamp = (ts: number): number | null => {
                  // Find the closest data point
                  let closest = chartData[0]
                  let minDiff = Math.abs(chartData[0]?.timestamp - ts)

                  for (const d of chartData) {
                    const diff = Math.abs(d.timestamp - ts)
                    if (diff < minDiff) {
                      minDiff = diff
                      closest = d
                    }
                  }

                  // Only return if within 3 days (for daily data)
                  if (minDiff < 3 * 24 * 60 * 60 * 1000 && closest?.price) {
                    return closest.price
                  }
                  return null
                }

                // Collect annotation events from all targets
                const annotations: Array<{
                  id: string
                  timestamp: number
                  type: 'set' | 'updated'
                  target: ChartTarget
                  price: number
                }> = []

                priceTargets.forEach(target => {
                  // Add "set" annotation for created_at
                  const createdTs = new Date(target.createdAt).getTime()
                  const createdPrice = getPriceAtTimestamp(createdTs)
                  if (createdPrice && createdTs >= xAxisDomain[0] && createdTs <= todayTimestamp) {
                    annotations.push({
                      id: `${target.id}-created`,
                      timestamp: createdTs,
                      type: 'set',
                      target,
                      price: createdPrice
                    })
                  }

                  // Add "updated" annotation if updatedAt differs from createdAt by more than 1 hour
                  if (target.updatedAt && target.createdAt) {
                    const updatedTs = new Date(target.updatedAt).getTime()
                    const createdTsCheck = new Date(target.createdAt).getTime()
                    const diffHours = Math.abs(updatedTs - createdTsCheck) / (1000 * 60 * 60)

                    if (diffHours > 1 && updatedTs >= xAxisDomain[0] && updatedTs <= todayTimestamp) {
                      const updatedPrice = getPriceAtTimestamp(updatedTs)
                      if (updatedPrice) {
                        annotations.push({
                          id: `${target.id}-updated`,
                          timestamp: updatedTs,
                          type: 'updated',
                          target,
                          price: updatedPrice
                        })
                      }
                    }
                  }
                })

                // Sort by timestamp
                annotations.sort((a, b) => a.timestamp - b.timestamp)

                if (isNaN(x1) || isNaN(y1)) return null

                return (
                  <g className="chart-overlays">
                    {/* Target set/update annotations on historical price line */}
                    {annotations.map((ann, idx) => {
                      const x = xAxis.scale(ann.timestamp)
                      const y = yAxis.scale(ann.price)

                      if (isNaN(x) || isNaN(y)) return null

                      const isSelected = selectedAnnotation?.timestamp === ann.timestamp &&
                                         selectedAnnotation?.target.id === ann.target.id

                      const handleAnnotationClick = () => {
                        if (isSelected) {
                          setSelectedAnnotation(null)
                          setSelectedTarget(null)
                        } else {
                          setSelectedAnnotation({
                            type: ann.type === 'set' ? 'set' : 'renewed',
                            timestamp: ann.timestamp,
                            priceAtEvent: ann.price,
                            target: ann.target
                          })
                          setSelectedTarget(ann.target)
                        }
                      }

                      return (
                        <g key={ann.id}>
                          {/* Vertical line from price to annotation */}
                          <line
                            x1={x}
                            y1={y - 8}
                            x2={x}
                            y2={y - 24}
                            stroke={ann.target.scenarioColor}
                            strokeWidth={isSelected ? 2.5 : 1.5}
                            strokeOpacity={isSelected ? 1 : 0.6}
                          />
                          {/* Small triangle marker pointing down at the price */}
                          <polygon
                            points={`${x},${y - 5} ${x - 5},${y - 12} ${x + 5},${y - 12}`}
                            fill={ann.target.scenarioColor}
                            stroke="#fff"
                            strokeWidth={isSelected ? 2 : 1}
                            style={{ cursor: 'pointer' }}
                            onClick={handleAnnotationClick}
                          />
                          {/* Label above */}
                          <text
                            x={x}
                            y={y - 28}
                            textAnchor="middle"
                            fill={ann.target.scenarioColor}
                            fontSize={isSelected ? 12 : 11}
                            fontWeight={isSelected ? 700 : 500}
                            style={{ cursor: 'pointer' }}
                            onClick={handleAnnotationClick}
                          >
                            {ann.type === 'set' ? 'Set' : 'Renewed'}
                          </text>
                        </g>
                      )
                    })}

                    {/* Projection Mode: Show lines from current price to future targets */}
                    {chartDisplayMode === 'projection' && (
                      <>
                        {/* Single starting dot at current price */}
                        <circle
                          cx={x1}
                          cy={y1}
                          r={6}
                          fill="#3b82f6"
                          stroke="#fff"
                          strokeWidth={2}
                        />

                        {/* Projection lines and end dots for each future target */}
                        {futureTargets.map(target => {
                          const targetTs = new Date(target.targetDate!).getTime()
                          const x2 = xAxis.scale(targetTs)
                          const y2 = yAxis.scale(target.price)

                          if (isNaN(x2) || isNaN(y2)) return null

                          const isHovered = hoveredTarget === target.id
                          const isSelected = selectedTarget?.id === target.id
                          const strokeWidth = isHovered || isSelected ? 3 : 2
                          const strokeOpacity = isHovered || isSelected ? 1 : 0.7

                          const handleProjectionClick = () => {
                            if (selectedTarget?.id === target.id) {
                              setSelectedTarget(null)
                            } else {
                              setSelectedTarget(target)
                            }
                            setSelectedAnnotation(null)
                          }

                          return (
                            <g key={`projection-${target.id}`}>
                              {/* Projection line */}
                              <line
                                x1={x1}
                                y1={y1}
                                x2={x2}
                                y2={y2}
                                stroke={target.scenarioColor}
                                strokeWidth={strokeWidth}
                                strokeOpacity={strokeOpacity}
                                strokeDasharray="8 4"
                              />
                              {/* End dot (at target price) - clickable */}
                              <circle
                                cx={x2}
                                cy={y2}
                                r={isHovered || isSelected ? 10 : 7}
                                fill={target.scenarioColor}
                                stroke="#fff"
                                strokeWidth={2}
                                style={{ cursor: 'pointer' }}
                                onMouseEnter={() => setHoveredTarget(target.id)}
                                onMouseLeave={() => setHoveredTarget(null)}
                                onClick={handleProjectionClick}
                              />
                              {/* Price label at end */}
                              <text
                                x={x2 + 14}
                                y={y2 + 4}
                                fill={target.scenarioColor}
                                fontSize={13}
                                fontWeight={600}
                                style={{ cursor: 'pointer' }}
                                onClick={handleProjectionClick}
                              >
                                ${target.price.toFixed(0)} {target.scenarioName}
                              </text>
                            </g>
                          )
                        })}
                      </>
                    )}

                    {/* Levels Mode: Show horizontal lines at each price target level */}
                    {chartDisplayMode === 'levels' && (
                      <>
                        {priceTargets.map(target => {
                          const y = yAxis.scale(target.price)
                          const xStart = xAxis.scale(xAxisDomain[0])
                          const xEnd = xAxis.scale(xAxisDomain[1])

                          if (isNaN(y) || isNaN(xStart) || isNaN(xEnd)) return null

                          const isHovered = hoveredTarget === target.id
                          const isSelected = selectedTarget?.id === target.id
                          const strokeWidth = isHovered || isSelected ? 3 : 2
                          const strokeOpacity = isHovered || isSelected ? 1 : 0.6

                          const handleLevelClick = () => {
                            if (selectedTarget?.id === target.id) {
                              setSelectedTarget(null)
                            } else {
                              setSelectedTarget(target)
                            }
                            setSelectedAnnotation(null)
                          }

                          return (
                            <g key={`level-${target.id}`}>
                              {/* Horizontal price level line */}
                              <line
                                x1={xStart}
                                y1={y}
                                x2={xEnd - 80}
                                y2={y}
                                stroke={target.scenarioColor}
                                strokeWidth={strokeWidth}
                                strokeOpacity={strokeOpacity}
                                strokeDasharray="6 3"
                                style={{ cursor: 'pointer' }}
                                onMouseEnter={() => setHoveredTarget(target.id)}
                                onMouseLeave={() => setHoveredTarget(null)}
                                onClick={handleLevelClick}
                              />
                              {/* Dot at the right end */}
                              <circle
                                cx={xEnd - 80}
                                cy={y}
                                r={isHovered || isSelected ? 8 : 6}
                                fill={target.scenarioColor}
                                stroke="#fff"
                                strokeWidth={2}
                                style={{ cursor: 'pointer' }}
                                onMouseEnter={() => setHoveredTarget(target.id)}
                                onMouseLeave={() => setHoveredTarget(null)}
                                onClick={handleLevelClick}
                              />
                              {/* Price label */}
                              <text
                                x={xEnd - 65}
                                y={y + 4}
                                fill={target.scenarioColor}
                                fontSize={13}
                                fontWeight={600}
                                style={{ cursor: 'pointer' }}
                                onClick={handleLevelClick}
                              >
                                ${target.price.toFixed(0)} {target.scenarioName}
                              </text>
                              {/* Probability badge if set */}
                              {target.probability && target.probability > 0 && (
                                <g>
                                  <rect
                                    x={xStart + 5}
                                    y={y - 11}
                                    width={34}
                                    height={18}
                                    rx={3}
                                    fill={target.scenarioColor}
                                    fillOpacity={0.9}
                                  />
                                  <text
                                    x={xStart + 22}
                                    y={y + 2}
                                    textAnchor="middle"
                                    fill="#fff"
                                    fontSize={11}
                                    fontWeight={600}
                                  >
                                    {target.probability}%
                                  </text>
                                </g>
                              )}
                            </g>
                          )
                        })}
                      </>
                    )}

                    {/* Distribution Panel - rendered inside the chart for exact Y alignment */}
                    {showDistribution && (() => {
                      const totalProb = priceTargets.reduce((sum, t) => sum + (t.probability || 0), 0)
                      const xEnd = xAxis.scale(xAxisDomain[1])

                      if (isNaN(xEnd)) return null

                      // Distribution starts after the chart area
                      const distStartX = xEnd + 15
                      const distWidth = 200
                      const distEndX = distStartX + distWidth

                      if (totalProb === 0) {
                        // No probabilities set
                        const yCenter = yAxis.scale((yAxisDomain[0] + yAxisDomain[1]) / 2)
                        return (
                          <g>
                            <text
                              x={distStartX + distWidth / 2}
                              y={yCenter - 10}
                              textAnchor="middle"
                              fontSize={11}
                              fill="#9ca3af"
                            >
                              No probabilities
                            </text>
                            <text
                              x={distStartX + distWidth / 2}
                              y={yCenter + 10}
                              textAnchor="middle"
                              fontSize={10}
                              fill="#9ca3af"
                            >
                              set
                            </text>
                          </g>
                        )
                      }

                      // Calculate expected price
                      const expectedPrice = priceTargets.reduce((sum, t) => sum + t.price * (t.probability || 0), 0) / totalProb

                      // Calculate variance
                      const [minPrice, maxPrice] = yAxisDomain
                      const priceRange = maxPrice - minPrice
                      const variance = priceTargets.reduce((sum, t) => sum + (t.probability || 0) * Math.pow(t.price - expectedPrice, 2), 0) / totalProb
                      const stdDev = Math.sqrt(variance) || priceRange * 0.15

                      // Generate distribution curve using the EXACT yAxis.scale
                      const numPoints = 100
                      const points: { price: number; y: number; density: number }[] = []

                      for (let i = 0; i <= numPoints; i++) {
                        const price = minPrice + (i / numPoints) * priceRange
                        const density = Math.exp(-Math.pow(price - expectedPrice, 2) / (2 * stdDev * stdDev))
                        const y = yAxis.scale(price)
                        if (!isNaN(y)) {
                          points.push({ price, y, density })
                        }
                      }

                      const maxDensity = Math.max(...points.map(p => p.density), 0.01)

                      // Convert density to X - use most of the width for the curve
                      const curveWidth = distWidth - 60
                      const densityToX = (density: number) => {
                        return distStartX + (density / maxDensity) * curveWidth
                      }

                      // Generate curve path
                      const curvePath = points.map((p, i) => {
                        const x = densityToX(p.density)
                        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${p.y.toFixed(2)}`
                      }).join(' ')

                      // Filled area
                      const firstY = points[0]?.y || 0
                      const lastY = points[points.length - 1]?.y || 0
                      const areaPath = `${curvePath} L ${distStartX} ${lastY.toFixed(2)} L ${distStartX} ${firstY.toFixed(2)} Z`

                      // Sort targets for gradient
                      const sortedTargets = [...priceTargets].sort((a, b) => a.price - b.price)

                      return (
                        <g>
                          {/* Gradient */}
                          <defs>
                            <linearGradient id={gradientId} x1="0%" y1="100%" x2="0%" y2="0%">
                              {sortedTargets.map((target) => {
                                const position = ((target.price - minPrice) / priceRange) * 100
                                return (
                                  <stop
                                    key={target.id}
                                    offset={`${Math.max(0, Math.min(100, position))}%`}
                                    stopColor={target.scenarioColor}
                                    stopOpacity={0.4}
                                  />
                                )
                              })}
                            </linearGradient>
                          </defs>

                          {/* Filled area */}
                          <path d={areaPath} fill={`url(#${gradientId})`} style={onUpdateProbabilities ? { cursor: 'pointer' } : undefined} onClick={onUpdateProbabilities ? () => setShowProbabilityModal(true) : undefined} />

                          {/* Curve line */}
                          <path
                            d={curvePath}
                            fill="none"
                            stroke="#4f46e5"
                            strokeWidth={2}
                            style={onUpdateProbabilities ? { cursor: 'pointer' } : undefined}
                            onClick={onUpdateProbabilities ? () => setShowProbabilityModal(true) : undefined}
                          />

                          {/* Current price line */}
                          <line
                            x1={distStartX}
                            y1={yAxis.scale(currentPrice)}
                            x2={distStartX + curveWidth}
                            y2={yAxis.scale(currentPrice)}
                            stroke="#6b7280"
                            strokeWidth={1.5}
                            strokeDasharray="3 2"
                          />

                          {/* Target markers - using EXACT same yAxis.scale */}
                          {priceTargets.map(target => {
                            const y = yAxis.scale(target.price) // Exact same Y as chart dots
                            const prob = target.probability || 0
                            const closestPoint = points.reduce((prev, curr) =>
                              Math.abs(curr.price - target.price) < Math.abs(prev.price - target.price) ? curr : prev
                            )
                            const x = densityToX(closestPoint?.density || 0)

                            if (isNaN(y)) return null

                            return (
                              <g key={`dist-${target.id}`} style={{ cursor: onUpdateProbabilities ? 'pointer' : undefined }} onClick={onUpdateProbabilities ? () => setShowProbabilityModal(true) : undefined}>
                                {/* Horizontal connector line */}
                                <line
                                  x1={x}
                                  y1={y}
                                  x2={distEndX - 5}
                                  y2={y}
                                  stroke={target.scenarioColor}
                                  strokeWidth={1}
                                  strokeOpacity={0.4}
                                  strokeDasharray="2 2"
                                />
                                {/* Dot on curve - exact Y alignment */}
                                <circle
                                  cx={x}
                                  cy={y}
                                  r={9}
                                  fill={target.scenarioColor}
                                  stroke="#fff"
                                  strokeWidth={2}
                                />
                                {/* Price label */}
                                <text
                                  x={distEndX}
                                  y={y + 4}
                                  textAnchor="start"
                                  fontSize={13}
                                  fontWeight={600}
                                  fill={target.scenarioColor}
                                >
                                  ${target.price.toFixed(0)}
                                </text>
                                {/* Probability inside dot */}
                                {prob > 0 && (
                                  <text
                                    x={x}
                                    y={y + 4}
                                    textAnchor="middle"
                                    fontSize={10}
                                    fontWeight={700}
                                    fill="#fff"
                                  >
                                    {prob}
                                  </text>
                                )}
                              </g>
                            )
                          })}

                          {/* Expected value line */}
                          <g>
                            <line
                              x1={distStartX}
                              y1={yAxis.scale(expectedPrice)}
                              x2={distStartX + curveWidth}
                              y2={yAxis.scale(expectedPrice)}
                              stroke="#4f46e5"
                              strokeWidth={2}
                              strokeDasharray="4 2"
                            />
                            <text
                              x={distStartX + 3}
                              y={yAxis.scale(expectedPrice) - 6}
                              textAnchor="start"
                              fontSize={13}
                              fontWeight={600}
                              fill="#4f46e5"
                            >
                              E[V] ${expectedPrice.toFixed(0)}
                            </text>
                          </g>
                        </g>
                      )
                    })()}
                  </g>
                )
              }}
            />

          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Selected Target Detail Panel */}
      {selectedTarget && (
        <div className="mx-4 mb-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          {/* Annotation Event Header - show when clicking on a Set/Renewed marker */}
          {selectedAnnotation && (
            <div className="mb-4 pb-4 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={clsx(
                    'px-2 py-1 rounded text-xs font-semibold',
                    selectedAnnotation.type === 'set'
                      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                      : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                  )}
                >
                  {selectedAnnotation.type === 'set' ? 'Target Set' : 'Target Renewed'}
                </span>
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {new Date(selectedAnnotation.timestamp).toLocaleDateString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric'
                  })}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {symbol} Price at {selectedAnnotation.type === 'set' ? 'Set' : 'Renewal'}
                  </div>
                  <div className="font-semibold text-gray-900 dark:text-white">
                    ${selectedAnnotation.priceAtEvent.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Target Price</div>
                  <div className="font-semibold" style={{ color: selectedTarget.scenarioColor }}>
                    ${selectedTarget.price.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Implied Move at {selectedAnnotation.type === 'set' ? 'Set' : 'Renewal'}
                  </div>
                  <div className={clsx(
                    'font-semibold',
                    selectedTarget.price > selectedAnnotation.priceAtEvent ? 'text-green-600' : 'text-red-600'
                  )}>
                    {selectedTarget.price > selectedAnnotation.priceAtEvent ? '+' : ''}
                    {(((selectedTarget.price - selectedAnnotation.priceAtEvent) / selectedAnnotation.priceAtEvent) * 100).toFixed(1)}%
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {symbol} Since Then
                  </div>
                  <div className={clsx(
                    'font-semibold',
                    currentPrice > selectedAnnotation.priceAtEvent ? 'text-green-600' : 'text-red-600'
                  )}>
                    {currentPrice > selectedAnnotation.priceAtEvent ? '+' : ''}
                    {(((currentPrice - selectedAnnotation.priceAtEvent) / selectedAnnotation.priceAtEvent) * 100).toFixed(1)}%
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-start gap-4">
            <div
              className="w-4 h-4 rounded-full flex-shrink-0 mt-1"
              style={{ backgroundColor: selectedTarget.scenarioColor }}
            />
            <div className="flex-1">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xl font-bold text-gray-900 dark:text-white">
                  ${selectedTarget.price.toFixed(2)}
                </span>
                {/* vs Current - prominent display next to price */}
                <span className={clsx(
                  'text-xl font-bold',
                  selectedTarget.price > currentPrice ? 'text-green-600' : 'text-red-600'
                )}>
                  ({selectedTarget.price > currentPrice ? '+' : ''}
                  {(((selectedTarget.price - currentPrice) / currentPrice) * 100).toFixed(1)}%)
                </span>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {selectedTarget.scenarioName}
                </span>
                <StatusBadge status={selectedTarget.status} />

                {/* Metadata inline with badge */}
                <span className="text-xs text-gray-400 dark:text-gray-500">·</span>
                <span className="text-xs text-gray-600 dark:text-gray-400">
                  Set {new Date(selectedTarget.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500">·</span>
                <span className="text-xs text-gray-600 dark:text-gray-400 flex items-center gap-1">
                  {selectedTarget.timeframe || 'N/A'}
                  {selectedTarget.isRolling ? (
                    <span className="text-[10px] px-1 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded">Rolling</span>
                  ) : (
                    <span className="text-[10px] px-1 py-0.5 bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded">Fixed</span>
                  )}
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500">·</span>
                <span className="text-xs text-gray-600 dark:text-gray-400">
                  {selectedTarget.isRolling ? (
                    <span className="text-blue-600 dark:text-blue-400">No expiry</span>
                  ) : selectedTarget.targetDate ? (
                    <>Exp {new Date(selectedTarget.targetDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</>
                  ) : (
                    'No expiry'
                  )}
                </span>
                {selectedTarget.probability ? (
                  <>
                    <span className="text-xs text-gray-400 dark:text-gray-500">·</span>
                    <span className="text-xs text-gray-700 dark:text-gray-300"><span className="text-gray-400 dark:text-gray-500">Prob </span><span className="font-medium">{selectedTarget.probability}%</span></span>
                  </>
                ) : null}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                by {selectedTarget.userName}
                {selectedTarget.isCovering && (
                  <span className="ml-2 px-1.5 py-0.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 text-xs rounded">
                    Covering
                  </span>
                )}
              </div>
              {selectedTarget.reasoning && (
                <p className="text-sm text-gray-700 dark:text-gray-300 mt-1.5 leading-snug">
                  {selectedTarget.reasoning}
                </p>
              )}
            </div>
          </div>
        </div>
      )}


      {/* Probability Distribution Modal */}
      <ProbabilityDistributionModal
        isOpen={showProbabilityModal}
        onClose={() => setShowProbabilityModal(false)}
        targets={priceTargets}
        currentPrice={currentPrice}
        onSave={onUpdateProbabilities}
        isEditable={!!onUpdateProbabilities}
      />

    </div>
  )
}

export default PriceTargetChart
