import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { clsx } from 'clsx'
import { X, TrendingUp, TrendingDown, AlertTriangle, GripVertical, Plus, Check } from 'lucide-react'
import type { ChartTarget } from '../../hooks/usePriceTargetChart'

interface ScenarioData {
  id: string
  targetId: string
  name: string
  color: string
  price: number
  originalPrice: number
  percentChange: number
  probability: number
  isNew?: boolean
}

interface PriceChange {
  targetId: string
  scenarioId: string
  scenarioName: string
  oldPrice: number
  newPrice: number
  timeframe?: string
  reasoning?: string
}

// Interactive Probability Distribution Curve Component with draggable markers
function InteractiveDistributionChart({
  scenarios,
  probabilities,
  prices,
  currentPrice,
  onPriceChange,
  isEditable
}: {
  scenarios: ScenarioData[]
  probabilities: Record<string, number>
  prices: Record<string, number>
  currentPrice: number
  onPriceChange: (targetId: string, newPrice: number) => void
  isEditable: boolean
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [hoveringId, setHoveringId] = useState<string | null>(null)
  const [dragStartX, setDragStartX] = useState<number | null>(null)
  const [pendingDragId, setPendingDragId] = useState<string | null>(null)

  // Minimum pixels to move before drag activates (more deliberate)
  const DRAG_THRESHOLD = 8

  const width = 800
  const height = 320
  const padding = { top: 40, right: 60, bottom: 70, left: 60 }
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom

  // Sort scenarios by price
  const sortedScenarios = useMemo(() => {
    return [...scenarios].map(s => ({
      ...s,
      price: prices[s.targetId] ?? s.price
    })).sort((a, b) => a.price - b.price)
  }, [scenarios, prices])

  // Get scenario data with probabilities
  const scenarioWithProbs = sortedScenarios.map(s => ({
    ...s,
    prob: probabilities[s.targetId] || 0
  }))

  // Calculate price range with some padding
  const allPrices = sortedScenarios.map(s => s.price).concat(currentPrice)
  const minScenarioPrice = Math.min(...allPrices)
  const maxScenarioPrice = Math.max(...allPrices)
  const priceSpread = Math.max(maxScenarioPrice - minScenarioPrice, currentPrice * 0.1)

  // Extend the range beyond the scenarios for the tails
  const minPrice = minScenarioPrice - priceSpread * 0.4
  const maxPrice = maxScenarioPrice + priceSpread * 0.4
  const priceRange = maxPrice - minPrice

  // Convert price to x coordinate
  const priceToX = useCallback((price: number) => {
    return padding.left + ((price - minPrice) / priceRange) * chartWidth
  }, [minPrice, priceRange, chartWidth])

  // Convert x coordinate to price
  const xToPrice = useCallback((x: number) => {
    return minPrice + ((x - padding.left) / chartWidth) * priceRange
  }, [minPrice, priceRange, chartWidth])

  // Calculate the probability-weighted mean (expected value)
  const totalProb = scenarioWithProbs.reduce((sum, s) => sum + s.prob, 0)
  const expectedPrice = totalProb > 0
    ? scenarioWithProbs.reduce((sum, s) => sum + s.price * s.prob, 0) / totalProb
    : currentPrice

  // Generate a single smooth probability distribution
  const generateDistributionCurve = useMemo(() => {
    const numPoints = 300
    const points: { price: number; x: number; density: number }[] = []

    if (totalProb === 0) {
      for (let i = 0; i <= numPoints; i++) {
        const price = minPrice + (i / numPoints) * priceRange
        points.push({ price, x: priceToX(price), density: 0.1 })
      }
      return points
    }

    const variance = scenarioWithProbs.reduce((sum, s) => {
      return sum + s.prob * Math.pow(s.price - expectedPrice, 2)
    }, 0) / totalProb
    const stdDev = Math.sqrt(variance) || priceSpread * 0.25

    for (let i = 0; i <= numPoints; i++) {
      const price = minPrice + (i / numPoints) * priceRange
      const density = Math.exp(-Math.pow(price - expectedPrice, 2) / (2 * stdDev * stdDev))
      points.push({ price, x: priceToX(price), density })
    }

    return points
  }, [scenarioWithProbs, minPrice, priceRange, totalProb, expectedPrice, priceSpread, priceToX])

  const maxDensity = Math.max(...generateDistributionCurve.map(p => p.density), 0.01)

  const densityToY = (density: number) => {
    return padding.top + chartHeight - (density / maxDensity) * chartHeight
  }

  const curvePath = generateDistributionCurve.map((p, i) => {
    const y = densityToY(p.density)
    return `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${y.toFixed(2)}`
  }).join(' ')

  const areaPath = `${curvePath} L ${priceToX(maxPrice).toFixed(2)} ${densityToY(0).toFixed(2)} L ${priceToX(minPrice).toFixed(2)} ${densityToY(0).toFixed(2)} Z`

  const getScenarioDensity = (price: number) => {
    const closest = generateDistributionCurve.reduce((prev, curr) =>
      Math.abs(curr.price - price) < Math.abs(prev.price - price) ? curr : prev
    )
    return closest.density
  }

  // Handle mouse/touch drag with threshold for deliberate dragging
  const handleDragStart = (e: React.MouseEvent | React.TouchEvent, targetId: string) => {
    if (!isEditable) return
    e.preventDefault()

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    setDragStartX(clientX)
    setPendingDragId(targetId)
  }

  const handleDragMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!svgRef.current) return

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX

    // If we have a pending drag, check if we've exceeded the threshold
    if (pendingDragId && dragStartX !== null) {
      const deltaX = Math.abs(clientX - dragStartX)
      if (deltaX >= DRAG_THRESHOLD) {
        // Threshold exceeded - activate the drag
        setDraggingId(pendingDragId)
        setPendingDragId(null)
        setDragStartX(null)
      } else {
        // Haven't moved enough yet - don't do anything
        return
      }
    }

    // Only process if we're actively dragging
    if (!draggingId) return

    const svg = svgRef.current
    const rect = svg.getBoundingClientRect()

    // Convert screen coordinates to SVG coordinates
    const scaleX = width / rect.width
    const svgX = (clientX - rect.left) * scaleX

    // Clamp to chart bounds
    const clampedX = Math.max(padding.left, Math.min(padding.left + chartWidth, svgX))
    const newPrice = xToPrice(clampedX)

    // Round to nearest $5 for more deliberate increments
    const roundedPrice = Math.round(newPrice / 5) * 5

    onPriceChange(draggingId, Math.max(5, roundedPrice))
  }, [draggingId, pendingDragId, dragStartX, xToPrice, onPriceChange, chartWidth, DRAG_THRESHOLD])

  const handleDragEnd = useCallback(() => {
    setDraggingId(null)
    setPendingDragId(null)
    setDragStartX(null)
  }, [])

  useEffect(() => {
    // Listen when we have a pending drag (waiting for threshold) or active drag
    if (draggingId || pendingDragId) {
      window.addEventListener('mousemove', handleDragMove)
      window.addEventListener('mouseup', handleDragEnd)
      window.addEventListener('touchmove', handleDragMove)
      window.addEventListener('touchend', handleDragEnd)
      return () => {
        window.removeEventListener('mousemove', handleDragMove)
        window.removeEventListener('mouseup', handleDragEnd)
        window.removeEventListener('touchmove', handleDragMove)
        window.removeEventListener('touchend', handleDragEnd)
      }
    }
  }, [draggingId, pendingDragId, handleDragMove, handleDragEnd])

  const gradientId = 'distributionGradient-interactive'

  // Generate price axis ticks
  const priceTicks = useMemo(() => {
    const tickCount = 6
    const ticks = []
    for (let i = 0; i <= tickCount; i++) {
      const price = minPrice + (i / tickCount) * priceRange
      ticks.push({ price, x: priceToX(price) })
    }
    return ticks
  }, [minPrice, priceRange, priceToX])

  return (
    <div className="relative bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
      <svg
        ref={svgRef}
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
        className={clsx("overflow-visible", draggingId && "cursor-grabbing")}
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            {sortedScenarios.map((scenario) => {
              const position = ((scenario.price - minPrice) / priceRange) * 100
              return (
                <stop
                  key={scenario.id}
                  offset={`${Math.max(0, Math.min(100, position))}%`}
                  stopColor={scenario.color}
                  stopOpacity={0.4}
                />
              )
            })}
          </linearGradient>
        </defs>

        {/* Grid lines */}
        <g className="text-gray-300 dark:text-gray-600">
          {[0.25, 0.5, 0.75].map(fraction => (
            <line
              key={fraction}
              x1={padding.left}
              y1={padding.top + chartHeight * (1 - fraction)}
              x2={padding.left + chartWidth}
              y2={padding.top + chartHeight * (1 - fraction)}
              stroke="currentColor"
              strokeDasharray="3 3"
              strokeOpacity={0.4}
            />
          ))}
          {/* Vertical grid lines at price ticks */}
          {priceTicks.map((tick, i) => (
            <line
              key={i}
              x1={tick.x}
              y1={padding.top}
              x2={tick.x}
              y2={padding.top + chartHeight}
              stroke="currentColor"
              strokeDasharray="3 3"
              strokeOpacity={0.2}
            />
          ))}
        </g>

        {/* Filled area under curve with gradient */}
        <path d={areaPath} fill={`url(#${gradientId})`} />

        {/* Main distribution curve */}
        <path
          d={curvePath}
          fill="none"
          stroke="#4f46e5"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Current price vertical line */}
        <line
          x1={priceToX(currentPrice)}
          y1={padding.top}
          x2={priceToX(currentPrice)}
          y2={padding.top + chartHeight}
          stroke="#6b7280"
          strokeWidth={2}
          strokeDasharray="6 4"
        />
        <text
          x={priceToX(currentPrice)}
          y={padding.top - 12}
          textAnchor="middle"
          className="text-[11px] fill-gray-600 dark:fill-gray-300 font-semibold"
        >
          Current ${currentPrice.toFixed(2)}
        </text>

        {/* Expected value line */}
        {totalProb > 0 && (
          <>
            <line
              x1={priceToX(expectedPrice)}
              y1={densityToY(maxDensity * 0.95)}
              x2={priceToX(expectedPrice)}
              y2={padding.top + chartHeight}
              stroke="#4f46e5"
              strokeWidth={2}
              strokeDasharray="8 4"
            />
            <text
              x={priceToX(expectedPrice)}
              y={densityToY(maxDensity) - 12}
              textAnchor="middle"
              className="text-[11px] fill-indigo-600 dark:fill-indigo-400 font-bold"
            >
              E[V] ${expectedPrice.toFixed(2)}
            </text>
          </>
        )}

        {/* Draggable scenario markers */}
        {sortedScenarios.map((scenario) => {
          const prob = probabilities[scenario.targetId] || 0
          const x = priceToX(scenario.price)
          const density = getScenarioDensity(scenario.price)
          const y = densityToY(density)
          const isDragging = draggingId === scenario.targetId
          const isPending = pendingDragId === scenario.targetId
          const isHovering = hoveringId === scenario.targetId
          const priceChanged = scenario.price !== scenario.originalPrice
          const isActive = isDragging || isPending

          return (
            <g key={scenario.id}>
              {/* Vertical line to x-axis */}
              <line
                x1={x}
                y1={y}
                x2={x}
                y2={padding.top + chartHeight}
                stroke={scenario.color}
                strokeWidth={isActive || isHovering ? 2.5 : 1.5}
                strokeOpacity={0.6}
                strokeDasharray="3 3"
              />

              {/* Draggable marker area (larger hit area) */}
              {isEditable && (
                <rect
                  x={x - 25}
                  y={y - 25}
                  width={50}
                  height={50}
                  fill="transparent"
                  className={isDragging ? "cursor-grabbing" : "cursor-grab"}
                  onMouseDown={(e) => handleDragStart(e, scenario.targetId)}
                  onTouchStart={(e) => handleDragStart(e, scenario.targetId)}
                  onMouseEnter={() => !isActive && setHoveringId(scenario.targetId)}
                  onMouseLeave={() => !isActive && setHoveringId(null)}
                />
              )}

              {/* Main dot on curve */}
              <circle
                cx={x}
                cy={y}
                r={isActive || isHovering ? 14 : 12}
                fill={scenario.color}
                stroke={isPending ? '#3b82f6' : priceChanged ? '#fbbf24' : '#fff'}
                strokeWidth={isPending ? 4 : priceChanged ? 3 : 2}
                className={clsx(isEditable && "pointer-events-none")}
              />

              {/* Drag indicator icon - show when hovering or actively dragging */}
              {isEditable && (isHovering || isActive) && (
                <g transform={`translate(${x - 6}, ${y - 6})`}>
                  <rect x="0" y="0" width="12" height="12" fill={scenario.color} rx="2" />
                  <line x1="3" y1="4" x2="9" y2="4" stroke="white" strokeWidth="1.5" />
                  <line x1="3" y1="8" x2="9" y2="8" stroke="white" strokeWidth="1.5" />
                </g>
              )}

              {/* Probability label inside dot (when not hovering or active) */}
              {!isHovering && !isActive && (
                <text
                  x={x}
                  y={y + 4}
                  textAnchor="middle"
                  className="text-[10px] fill-white font-bold pointer-events-none"
                >
                  {prob}
                </text>
              )}

              {/* Labels below x-axis */}
              <text
                x={x}
                y={padding.top + chartHeight + 18}
                textAnchor="middle"
                className="text-[11px] font-semibold pointer-events-none"
                fill={scenario.color}
              >
                {scenario.name}
                {scenario.isNew && ' (new)'}
              </text>
              <text
                x={x}
                y={padding.top + chartHeight + 34}
                textAnchor="middle"
                className={clsx(
                  "text-[11px] font-medium pointer-events-none",
                  priceChanged ? "fill-amber-600 dark:fill-amber-400" : "fill-gray-600 dark:fill-gray-300"
                )}
              >
                ${scenario.price.toFixed(2)}
                {priceChanged && ' ✎'}
              </text>
              <text
                x={x}
                y={padding.top + chartHeight + 50}
                textAnchor="middle"
                className="text-[10px] font-medium pointer-events-none"
                fill={scenario.color}
              >
                {prob}%
              </text>
            </g>
          )
        })}

        {/* X-axis line */}
        <line
          x1={padding.left}
          y1={padding.top + chartHeight}
          x2={padding.left + chartWidth}
          y2={padding.top + chartHeight}
          stroke="#9ca3af"
          strokeWidth={1}
        />

        {/* Price axis ticks */}
        {priceTicks.map((tick, i) => (
          <g key={i}>
            <line
              x1={tick.x}
              y1={padding.top + chartHeight}
              x2={tick.x}
              y2={padding.top + chartHeight + 5}
              stroke="#9ca3af"
              strokeWidth={1}
            />
          </g>
        ))}

        {/* Y-axis label */}
        <text
          x={18}
          y={padding.top + chartHeight / 2}
          textAnchor="middle"
          className="text-[10px] fill-gray-400"
          transform={`rotate(-90, 18, ${padding.top + chartHeight / 2})`}
        >
          Probability Density
        </text>

        {/* X-axis label */}
        <text
          x={padding.left + chartWidth / 2}
          y={height - 8}
          textAnchor="middle"
          className="text-[10px] fill-gray-400"
        >
          Price Target
        </text>

        {/* Drag instruction */}
        {isEditable && (
          <text
            x={width - padding.right}
            y={padding.top - 12}
            textAnchor="end"
            className="text-[9px] fill-gray-400 italic"
          >
            Drag markers to adjust prices
          </text>
        )}
      </svg>
    </div>
  )
}

// Price change confirmation form
function PriceChangeForm({
  changes,
  onUpdateChange,
  onConfirm,
  onCancel,
  isSaving
}: {
  changes: PriceChange[]
  onUpdateChange: (index: number, field: 'timeframe' | 'reasoning', value: string) => void
  onConfirm: () => void
  onCancel: () => void
  isSaving: boolean
}) {
  const timeframeOptions = [
    '3 Months',
    '6 Months',
    '12 Months',
    '18 Months',
    '24 Months'
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
        <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
        <p className="text-sm text-amber-800 dark:text-amber-200">
          You've changed {changes.length} price target{changes.length > 1 ? 's' : ''}. Please confirm the details below.
        </p>
      </div>

      <div className="space-y-4 max-h-[300px] overflow-y-auto">
        {changes.map((change, index) => (
          <div
            key={change.targetId}
            className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="font-medium text-gray-900 dark:text-white">
                {change.scenarioName}
              </span>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-500 line-through">${change.oldPrice.toFixed(2)}</span>
                <span className="text-gray-400">→</span>
                <span className="text-amber-600 dark:text-amber-400 font-semibold">
                  ${change.newPrice.toFixed(2)}
                </span>
                <span className={clsx(
                  'text-xs px-1.5 py-0.5 rounded',
                  change.newPrice > change.oldPrice
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                )}>
                  {change.newPrice > change.oldPrice ? '+' : ''}
                  {(((change.newPrice - change.oldPrice) / change.oldPrice) * 100).toFixed(1)}%
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Timeframe
                </label>
                <select
                  value={change.timeframe || ''}
                  onChange={(e) => onUpdateChange(index, 'timeframe', e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                >
                  <option value="">Keep existing</option>
                  {timeframeOptions.map(tf => (
                    <option key={tf} value={tf}>{tf}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Reasoning (optional)
                </label>
                <input
                  type="text"
                  value={change.reasoning || ''}
                  onChange={(e) => onUpdateChange(index, 'reasoning', e.target.value)}
                  placeholder="Why this change?"
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
          disabled={isSaving}
        >
          Back
        </button>
        <button
          onClick={onConfirm}
          disabled={isSaving}
          className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <Check className="w-4 h-4" />
          {isSaving ? 'Saving...' : 'Confirm Changes'}
        </button>
      </div>
    </div>
  )
}

interface ProbabilityDistributionModalProps {
  isOpen: boolean
  onClose: () => void
  targets: ChartTarget[]
  currentPrice: number
  onSave?: (updates: Array<{
    targetId: string
    probability: number
    price?: number
    timeframe?: string
    reasoning?: string
  }>) => Promise<void>
  isEditable?: boolean
}

export function ProbabilityDistributionModal({
  isOpen,
  onClose,
  targets,
  currentPrice,
  onSave,
  isEditable = false
}: ProbabilityDistributionModalProps) {
  const [probabilities, setProbabilities] = useState<Record<string, number>>({})
  const [prices, setPrices] = useState<Record<string, number>>({})
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>({}) // Text input values
  const [isSaving, setIsSaving] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [priceChanges, setPriceChanges] = useState<PriceChange[]>([])

  // Initialize state from targets
  useEffect(() => {
    if (isOpen) {
      const initialProbs: Record<string, number> = {}
      const initialPrices: Record<string, number> = {}
      const initialPriceInputs: Record<string, string> = {}
      targets.forEach(t => {
        initialProbs[t.id] = t.probability || 0
        initialPrices[t.id] = t.price
        initialPriceInputs[t.id] = t.price.toString()
      })
      setProbabilities(initialProbs)
      setPrices(initialPrices)
      setPriceInputs(initialPriceInputs)
      setShowConfirmation(false)
      setPriceChanges([])
    }
  }, [isOpen, targets])

  // Build scenario data with current prices
  const scenarioData = useMemo((): ScenarioData[] => {
    const scenarioMap = new Map<string, ScenarioData>()

    targets.forEach(target => {
      const key = target.scenarioName
      if (!scenarioMap.has(key)) {
        const currentTargetPrice = prices[target.id] ?? target.price
        const percentChange = currentPrice > 0
          ? ((currentTargetPrice - currentPrice) / currentPrice) * 100
          : 0

        scenarioMap.set(key, {
          id: target.scenarioId,
          targetId: target.id,
          name: target.scenarioName,
          color: target.scenarioColor,
          price: currentTargetPrice,
          originalPrice: target.price,
          percentChange,
          probability: probabilities[target.id] ?? target.probability ?? 0
        })
      }
    })

    return Array.from(scenarioMap.values()).sort((a, b) => a.price - b.price)
  }, [targets, currentPrice, probabilities, prices])

  const totalProbability = useMemo(() => {
    return Object.values(probabilities).reduce((sum, p) => sum + (p || 0), 0)
  }, [probabilities])

  const isValid = totalProbability <= 100

  const expectedValue = useMemo(() => {
    if (totalProbability === 0) return currentPrice

    let weightedSum = 0
    let totalWeight = 0

    scenarioData.forEach(scenario => {
      const prob = probabilities[scenario.targetId] || 0
      if (prob > 0) {
        weightedSum += scenario.price * prob
        totalWeight += prob
      }
    })

    return totalWeight > 0 ? weightedSum / totalWeight : currentPrice
  }, [scenarioData, probabilities, currentPrice, totalProbability])

  const expectedReturn = currentPrice > 0
    ? ((expectedValue - currentPrice) / currentPrice) * 100
    : 0

  // Check if any prices have changed
  const hasChangedPrices = useMemo(() => {
    return targets.some(t => {
      const currentTargetPrice = prices[t.id]
      return currentTargetPrice !== undefined && currentTargetPrice !== t.price
    })
  }, [targets, prices])

  const handleProbabilityChange = (targetId: string, value: number) => {
    setProbabilities(prev => ({
      ...prev,
      [targetId]: Math.max(0, Math.min(100, value))
    }))
  }

  const handlePriceChange = (targetId: string, newPrice: number) => {
    setPrices(prev => ({
      ...prev,
      [targetId]: newPrice
    }))
    // Also update the input field to stay in sync (e.g., from chart drag)
    setPriceInputs(prev => ({
      ...prev,
      [targetId]: newPrice.toString()
    }))
  }

  const handlePriceInputChange = (targetId: string, value: string) => {
    // Always update the text input to allow clearing/typing
    setPriceInputs(prev => ({
      ...prev,
      [targetId]: value
    }))

    // Only update the actual price if it's a valid positive number
    const numValue = parseFloat(value)
    if (!isNaN(numValue) && numValue > 0) {
      setPrices(prev => ({
        ...prev,
        [targetId]: numValue
      }))
    }
  }

  const normalizeProbabilities = () => {
    if (totalProbability === 0) return

    const scale = 100 / totalProbability
    setProbabilities(prev => {
      const normalized: Record<string, number> = {}
      Object.keys(prev).forEach(key => {
        normalized[key] = Math.round((prev[key] || 0) * scale)
      })
      return normalized
    })
  }

  const handleSaveClick = () => {
    if (!isValid) return

    // Check for price changes
    const changes: PriceChange[] = []
    targets.forEach(t => {
      const newPrice = prices[t.id]
      if (newPrice !== undefined && newPrice !== t.price) {
        changes.push({
          targetId: t.id,
          scenarioId: t.scenarioId,
          scenarioName: t.scenarioName,
          oldPrice: t.price,
          newPrice: newPrice,
          timeframe: undefined,
          reasoning: undefined
        })
      }
    })

    if (changes.length > 0) {
      setPriceChanges(changes)
      setShowConfirmation(true)
    } else {
      // No price changes, save directly
      handleConfirmSave()
    }
  }

  const handleUpdatePriceChange = (index: number, field: 'timeframe' | 'reasoning', value: string) => {
    setPriceChanges(prev => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: value || undefined }
      return updated
    })
  }

  const handleConfirmSave = async () => {
    if (!onSave) return

    setIsSaving(true)
    try {
      const updates = targets.map(t => {
        const priceChange = priceChanges.find(pc => pc.targetId === t.id)
        return {
          targetId: t.id,
          probability: probabilities[t.id] || 0,
          price: prices[t.id] !== t.price ? prices[t.id] : undefined,
          timeframe: priceChange?.timeframe,
          reasoning: priceChange?.reasoning
        }
      })
      await onSave(updates)
      onClose()
    } finally {
      setIsSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Larger modal */}
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-w-5xl w-full max-h-[95vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              Probability Distribution
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {isEditable
                ? 'Adjust probabilities and drag price targets to new levels'
                : 'View scenario probabilities and price targets'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(95vh-180px)]">
          {showConfirmation ? (
            <PriceChangeForm
              changes={priceChanges}
              onUpdateChange={handleUpdatePriceChange}
              onConfirm={handleConfirmSave}
              onCancel={() => setShowConfirmation(false)}
              isSaving={isSaving}
            />
          ) : (
            <>
              {/* Expected Value Summary */}
              <div className="bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-800/50 rounded-xl p-5">
                <div className="grid grid-cols-4 gap-6 text-center">
                  <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Current Price</div>
                    <div className="text-xl font-bold text-gray-900 dark:text-white">
                      ${currentPrice.toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Expected Value</div>
                    <div className={clsx(
                      'text-xl font-bold',
                      expectedReturn >= 0 ? 'text-green-600' : 'text-red-600'
                    )}>
                      ${expectedValue.toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Expected Return</div>
                    <div className={clsx(
                      'text-xl font-bold flex items-center justify-center gap-1',
                      expectedReturn >= 0 ? 'text-green-600' : 'text-red-600'
                    )}>
                      {expectedReturn >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                      {expectedReturn >= 0 ? '+' : ''}{expectedReturn.toFixed(1)}%
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Total Probability</div>
                    <div className={clsx(
                      'text-xl font-bold',
                      totalProbability > 100 ? 'text-red-600' : totalProbability === 100 ? 'text-green-600' : 'text-gray-900 dark:text-white'
                    )}>
                      {totalProbability}%
                    </div>
                  </div>
                </div>
              </div>

              {/* Large Interactive Distribution Chart */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Distribution Chart
                  </div>
                  {hasChangedPrices && (
                    <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
                      Prices modified
                    </span>
                  )}
                </div>
                <InteractiveDistributionChart
                  scenarios={scenarioData}
                  probabilities={probabilities}
                  prices={prices}
                  currentPrice={currentPrice}
                  onPriceChange={handlePriceChange}
                  isEditable={isEditable}
                />
              </div>

              {/* Scenario Controls - Grid layout */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Price Targets */}
                <div className="space-y-3">
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Price Targets
                  </div>
                  <div className="space-y-2">
                    {scenarioData.map(scenario => {
                      const priceChanged = scenario.price !== scenario.originalPrice
                      return (
                        <div
                          key={scenario.id}
                          className={clsx(
                            "flex items-center gap-3 p-3 rounded-lg border",
                            priceChanged
                              ? "bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800"
                              : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700"
                          )}
                        >
                          <div
                            className="w-3 h-3 rounded-full flex-shrink-0"
                            style={{ backgroundColor: scenario.color }}
                          />
                          <span className="text-sm font-medium text-gray-700 dark:text-gray-300 min-w-[80px]">
                            {scenario.name}
                          </span>
                          <div className="flex items-center gap-2 flex-1">
                            <span className="text-gray-400">$</span>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={priceInputs[scenario.targetId] ?? scenario.price}
                              onChange={(e) => handlePriceInputChange(scenario.targetId, e.target.value)}
                              disabled={!isEditable}
                              className={clsx(
                                "w-24 px-2 py-1.5 text-sm text-right border rounded-md",
                                "bg-white dark:bg-gray-900 text-gray-900 dark:text-white",
                                priceChanged
                                  ? "border-amber-400 dark:border-amber-600"
                                  : "border-gray-300 dark:border-gray-600",
                                !isEditable && "opacity-60 cursor-not-allowed"
                              )}
                            />
                          </div>
                          <span className={clsx(
                            'text-sm font-medium min-w-[60px] text-right',
                            scenario.percentChange >= 0 ? 'text-green-600' : 'text-red-600'
                          )}>
                            {scenario.percentChange >= 0 ? '+' : ''}{scenario.percentChange.toFixed(1)}%
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Probability Sliders */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Probabilities
                    </div>
                    {isEditable && totalProbability !== 100 && totalProbability > 0 && (
                      <button
                        type="button"
                        onClick={normalizeProbabilities}
                        className="text-xs px-2 py-1 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 rounded hover:bg-primary-200 dark:hover:bg-primary-900/50"
                      >
                        Normalize to 100%
                      </button>
                    )}
                  </div>
                  <div className="space-y-3">
                    {scenarioData.map(scenario => {
                      const prob = probabilities[scenario.targetId] || 0
                      return (
                        <div key={scenario.id} className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div
                                className="w-3 h-3 rounded-full"
                                style={{ backgroundColor: scenario.color }}
                              />
                              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                {scenario.name}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                value={prob}
                                onChange={(e) => handleProbabilityChange(scenario.targetId, parseFloat(e.target.value) || 0)}
                                disabled={!isEditable}
                                className="w-16 px-2 py-1 text-sm text-right border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white disabled:opacity-60"
                                min="0"
                                max="100"
                              />
                              <span className="text-sm text-gray-500 dark:text-gray-400 w-4">%</span>
                            </div>
                          </div>
                          {isEditable && (
                            <input
                              type="range"
                              value={prob}
                              onChange={(e) => handleProbabilityChange(scenario.targetId, parseFloat(e.target.value))}
                              className="w-full h-2 rounded-lg appearance-none cursor-pointer"
                              style={{
                                background: `linear-gradient(to right, ${scenario.color} 0%, ${scenario.color} ${prob}%, #e5e7eb ${prob}%, #e5e7eb 100%)`
                              }}
                              min="0"
                              max="100"
                            />
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {!isValid && (
                    <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-red-700 dark:text-red-400">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                      <span className="text-sm">Total exceeds 100%. Reduce values or normalize.</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Summary Table */}
              <div className="space-y-3">
                <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Expected Value Contribution
                </div>
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-800">
                      <tr>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Scenario</th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Target</th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">vs Current</th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Probability</th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Contribution</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {scenarioData.map(scenario => {
                        const prob = probabilities[scenario.targetId] || 0
                        const contribution = (prob / 100) * scenario.percentChange

                        return (
                          <tr key={scenario.id} className="bg-white dark:bg-gray-900">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div
                                  className="w-2.5 h-2.5 rounded-full"
                                  style={{ backgroundColor: scenario.color }}
                                />
                                <span className="font-medium text-gray-900 dark:text-white">
                                  {scenario.name}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right text-gray-900 dark:text-white font-medium">
                              ${scenario.price.toFixed(2)}
                            </td>
                            <td className={clsx(
                              'px-4 py-3 text-right font-medium',
                              scenario.percentChange >= 0 ? 'text-green-600' : 'text-red-600'
                            )}>
                              {scenario.percentChange >= 0 ? '+' : ''}{scenario.percentChange.toFixed(1)}%
                            </td>
                            <td className="px-4 py-3 text-right text-gray-900 dark:text-white">
                              {prob}%
                            </td>
                            <td className={clsx(
                              'px-4 py-3 text-right font-semibold',
                              contribution >= 0 ? 'text-green-600' : 'text-red-600'
                            )}>
                              {contribution >= 0 ? '+' : ''}{contribution.toFixed(2)}%
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot className="bg-gray-50 dark:bg-gray-800">
                      <tr>
                        <td colSpan={3} className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                          Total Expected Return
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium text-gray-900 dark:text-white">
                          {totalProbability}%
                        </td>
                        <td className={clsx(
                          'px-4 py-2.5 text-right font-bold',
                          expectedReturn >= 0 ? 'text-green-600' : 'text-red-600'
                        )}>
                          {expectedReturn >= 0 ? '+' : ''}{expectedReturn.toFixed(2)}%
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {isEditable && onSave && !showConfirmation && (
          <div className="flex items-center justify-between p-5 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              {hasChangedPrices && (
                <span className="text-amber-600 dark:text-amber-400">
                  Price changes will require confirmation
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveClick}
                disabled={!isValid || isSaving}
                className="px-5 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {isSaving ? 'Saving...' : hasChangedPrices ? 'Review & Save' : 'Save Changes'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ProbabilityDistributionModal
