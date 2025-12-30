import React, { useState, useMemo } from 'react'
import { clsx } from 'clsx'
import { DollarSign, Clock, Edit2, Check, X, Trash2, MessageSquare, Calendar, RefreshCw, RotateCcw, AlertTriangle } from 'lucide-react'
import type { AnalystPriceTarget, TimeframeType } from '../../hooks/useAnalystPriceTargets'

// Calculate expiration date from created_at + timeframe
function calculateExpirationDate(createdAt: string, timeframe: string | null): Date | null {
  if (!timeframe || !createdAt) return null

  const baseDate = new Date(createdAt)
  const tf = timeframe.toLowerCase()

  if (tf.includes('3 month')) {
    baseDate.setMonth(baseDate.getMonth() + 3)
  } else if (tf.includes('6 month')) {
    baseDate.setMonth(baseDate.getMonth() + 6)
  } else if (tf.includes('12 month') || tf.includes('1 year')) {
    baseDate.setFullYear(baseDate.getFullYear() + 1)
  } else if (tf.includes('18 month')) {
    baseDate.setMonth(baseDate.getMonth() + 18)
  } else if (tf.includes('24 month') || tf.includes('2 year')) {
    baseDate.setFullYear(baseDate.getFullYear() + 2)
  } else {
    // Try to parse custom format like "11 months"
    const match = timeframe.match(/(\d+)\s*month/i)
    if (match) {
      baseDate.setMonth(baseDate.getMonth() + parseInt(match[1]))
    } else {
      return null
    }
  }

  return baseDate
}

// Calculate remaining time until expiration
function getTimeRemaining(expirationDate: Date): { text: string; isExpired: boolean; isUrgent: boolean } {
  const now = new Date()
  const diffMs = expirationDate.getTime() - now.getTime()
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays < 0) {
    return { text: 'Expired', isExpired: true, isUrgent: true }
  }

  if (diffDays === 0) {
    return { text: 'Expires today', isExpired: false, isUrgent: true }
  }

  if (diffDays === 1) {
    return { text: '1 day remaining', isExpired: false, isUrgent: true }
  }

  if (diffDays < 7) {
    return { text: `${diffDays} days remaining`, isExpired: false, isUrgent: true }
  }

  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7)
    return { text: `${weeks} week${weeks > 1 ? 's' : ''} remaining`, isExpired: false, isUrgent: diffDays < 14 }
  }

  const months = Math.floor(diffDays / 30)
  if (months < 12) {
    return { text: `${months} month${months > 1 ? 's' : ''} remaining`, isExpired: false, isUrgent: false }
  }

  const years = Math.floor(months / 12)
  const remainingMonths = months % 12
  if (remainingMonths === 0) {
    return { text: `${years} year${years > 1 ? 's' : ''} remaining`, isExpired: false, isUrgent: false }
  }
  return { text: `${years}y ${remainingMonths}m remaining`, isExpired: false, isUrgent: false }
}

interface PriceTargetCardProps {
  scenario: {
    id: string
    name: string
    color: string | null
    is_default: boolean
  }
  priceTarget?: AnalystPriceTarget
  isEditable?: boolean
  onSave?: (data: {
    price: number
    timeframe?: string
    timeframeType?: TimeframeType
    targetDate?: string
    isRolling?: boolean
    reasoning?: string
    probability?: number
  }) => Promise<void>
  onDelete?: () => Promise<void>
  compact?: boolean
  showReasoning?: boolean
  className?: string
  /** Sum of probabilities from other scenarios (for validation that total doesn't exceed 100%) */
  otherScenariosProbabilitySum?: number
}

const PRESET_TIMEFRAMES = [
  { value: '3 months', label: '3 months' },
  { value: '6 months', label: '6 months' },
  { value: '12 months', label: '12 months' },
  { value: '18 months', label: '18 months' },
  { value: '24 months', label: '24 months' }
]

export function PriceTargetCard({
  scenario,
  priceTarget,
  isEditable = false,
  onSave,
  onDelete,
  compact = false,
  showReasoning = true,
  className,
  otherScenariosProbabilitySum = 0
}: PriceTargetCardProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [price, setPrice] = useState('')
  const [timeframeType, setTimeframeType] = useState<TimeframeType>('preset')
  const [timeframe, setTimeframe] = useState('12 months')
  const [targetDate, setTargetDate] = useState('')
  const [isRolling, setIsRolling] = useState(false)
  const [customTimeframe, setCustomTimeframe] = useState('')
  const [reasoning, setReasoning] = useState('')
  const [probability, setProbability] = useState<string>('')
  const [isSaving, setIsSaving] = useState(false)

  // Calculate max allowed probability (100 minus what others have)
  const maxProbability = Math.max(0, 100 - otherScenariosProbabilitySum)
  const currentProbability = probability ? parseFloat(probability) : 0
  const totalProbability = otherScenariosProbabilitySum + currentProbability
  const isProbabilityValid = totalProbability <= 100

  // Calculate expiration info for fixed targets
  // Use updated_at as base since saving restarts the timer
  const expirationInfo = useMemo(() => {
    if (!priceTarget) return null
    if (priceTarget.is_rolling) return null
    if (priceTarget.timeframe_type === 'date' && priceTarget.target_date) {
      const expDate = new Date(priceTarget.target_date)
      return {
        date: expDate,
        formattedDate: expDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        ...getTimeRemaining(expDate)
      }
    }
    if (priceTarget.timeframe_type === 'preset' || !priceTarget.timeframe_type) {
      // Use updated_at for Fixed targets - saving restarts the timer
      const baseDate = priceTarget.updated_at || priceTarget.created_at
      const expDate = calculateExpirationDate(baseDate, priceTarget.timeframe)
      if (!expDate) return null
      return {
        date: expDate,
        formattedDate: expDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        ...getTimeRemaining(expDate)
      }
    }
    return null
  }, [priceTarget])

  // Calculate preview expiration for edit mode
  // Always calculate from NOW since saving will restart the timer
  const editExpirationPreview = useMemo(() => {
    if (isRolling) return null
    if (timeframeType === 'date' && targetDate) {
      const expDate = new Date(targetDate)
      return {
        formattedDate: expDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        ...getTimeRemaining(expDate)
      }
    }
    if (timeframeType === 'preset') {
      // Always calculate from NOW - saving restarts the timer
      const expDate = calculateExpirationDate(new Date().toISOString(), timeframe)
      if (!expDate) return null
      return {
        formattedDate: expDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        ...getTimeRemaining(expDate)
      }
    }
    return null
  }, [isRolling, timeframeType, targetDate, timeframe])

  // Sync state from priceTarget when entering edit mode
  const startEditing = () => {
    setPrice(priceTarget?.price?.toString() || '')
    setTimeframeType(priceTarget?.timeframe_type || 'preset')
    setTimeframe(priceTarget?.timeframe || '12 months')
    setTargetDate(priceTarget?.target_date || '')
    setIsRolling(priceTarget?.is_rolling ?? false)
    setCustomTimeframe(priceTarget?.timeframe_type === 'custom' ? priceTarget?.timeframe || '' : '')
    setReasoning(priceTarget?.reasoning || '')
    setProbability(priceTarget?.probability?.toString() || '')
    setIsEditing(true)
  }

  const handleSave = async () => {
    if (!onSave || !price || !isProbabilityValid) return

    setIsSaving(true)
    try {
      await onSave({
        price: parseFloat(price),
        timeframe: timeframeType === 'custom' ? customTimeframe : timeframe,
        timeframeType,
        targetDate: timeframeType === 'date' ? targetDate : undefined,
        isRolling: timeframeType === 'preset' ? isRolling : false,
        reasoning: reasoning || undefined,
        probability: probability ? parseFloat(probability) : undefined
      })
      setIsEditing(false)
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setIsEditing(false)
  }

  // Calculate display timeframe
  const getDisplayTimeframe = () => {
    if (!priceTarget) return null
    if (priceTarget.timeframe_type === 'date' && priceTarget.target_date) {
      return new Date(priceTarget.target_date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      })
    }
    if (priceTarget.is_rolling) {
      return `${priceTarget.timeframe} (rolling)`
    }
    return priceTarget.timeframe
  }

  const scenarioColor = scenario.color || '#6b7280'

  if (compact) {
    return (
      <div
        className={clsx(
          'rounded-lg border p-3',
          'bg-white dark:bg-gray-800',
          'border-gray-200 dark:border-gray-700',
          className
        )}
        style={{ borderLeftColor: scenarioColor, borderLeftWidth: '3px' }}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
            {scenario.name}
          </span>
          {priceTarget ? (
            <span className="text-lg font-bold text-gray-900 dark:text-white">
              ${priceTarget.price.toFixed(2)}
            </span>
          ) : (
            <span className="text-sm text-gray-400 dark:text-gray-500">—</span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className={clsx(
        'rounded-lg border p-4',
        'bg-white dark:bg-gray-800',
        'border-gray-200 dark:border-gray-700',
        className
      )}
      style={{ borderTopColor: scenarioColor, borderTopWidth: '3px' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: scenarioColor }}
          />
          <span className="font-medium text-gray-900 dark:text-white">
            {scenario.name}
          </span>
          {!scenario.is_default && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
              Custom
            </span>
          )}
        </div>
        {isEditable && priceTarget && !isEditing && (
          <div className="flex items-center gap-1">
            <button
              onClick={startEditing}
              className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              title="Edit"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
            {onDelete && (
              <button
                onClick={onDelete}
                className="p-1 text-gray-400 hover:text-red-500"
                title="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      {isEditing ? (
        <div className="space-y-3">
          {/* Price input */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Price Target
            </label>
            <div className="relative">
              <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full pl-7 pr-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                placeholder="0.00"
                step="0.01"
              />
            </div>
          </div>

          {/* Timeframe Type Selector */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Time Horizon
            </label>
            <div className="flex rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden">
              <button
                type="button"
                onClick={() => setTimeframeType('preset')}
                className={clsx(
                  'flex-1 px-3 py-1.5 text-xs font-medium transition-colors',
                  timeframeType === 'preset'
                    ? 'bg-primary-600 text-white'
                    : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
                )}
              >
                Preset
              </button>
              <button
                type="button"
                onClick={() => setTimeframeType('date')}
                className={clsx(
                  'flex-1 px-3 py-1.5 text-xs font-medium transition-colors border-l border-gray-300 dark:border-gray-600',
                  timeframeType === 'date'
                    ? 'bg-primary-600 text-white'
                    : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
                )}
              >
                Date
              </button>
              <button
                type="button"
                onClick={() => setTimeframeType('custom')}
                className={clsx(
                  'flex-1 px-3 py-1.5 text-xs font-medium transition-colors border-l border-gray-300 dark:border-gray-600',
                  timeframeType === 'custom'
                    ? 'bg-primary-600 text-white'
                    : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
                )}
              >
                Custom
              </button>
            </div>
          </div>

          {/* Timeframe Options based on type */}
          {timeframeType === 'preset' && (
            <div className="space-y-2">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Timeframe
                </label>
                <select
                  value={timeframe}
                  onChange={(e) => setTimeframe(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  {PRESET_TIMEFRAMES.map(tf => (
                    <option key={tf.value} value={tf.value}>{tf.label}</option>
                  ))}
                </select>
              </div>

              {/* Rolling/Fixed Selector */}
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Expiration Behavior
                </label>
                <div className="flex rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setIsRolling(false)}
                    className={clsx(
                      'flex-1 px-3 py-1.5 text-xs font-medium transition-colors flex items-center justify-center gap-1.5',
                      !isRolling
                        ? 'bg-primary-600 text-white'
                        : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
                    )}
                  >
                    <RotateCcw className="w-3 h-3" />
                    Fixed
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsRolling(true)}
                    className={clsx(
                      'flex-1 px-3 py-1.5 text-xs font-medium transition-colors border-l border-gray-300 dark:border-gray-600 flex items-center justify-center gap-1.5',
                      isRolling
                        ? 'bg-primary-600 text-white'
                        : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
                    )}
                  >
                    <RefreshCw className="w-3 h-3" />
                    Rolling
                  </button>
                </div>
                {isRolling ? (
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
                    Target is always {timeframe} from now (never expires)
                  </p>
                ) : editExpirationPreview ? (
                  <div className={clsx(
                    'mt-1.5 p-2 rounded-md text-[10px]',
                    editExpirationPreview.isExpired
                      ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                      : editExpirationPreview.isUrgent
                        ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
                        : 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                  )}>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        {editExpirationPreview.isUrgent && <AlertTriangle className="w-3 h-3" />}
                        Expires: {editExpirationPreview.formattedDate}
                      </span>
                      <span className="font-medium">{editExpirationPreview.text}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
                    Target expires after {timeframe} from set date
                  </p>
                )}
              </div>
            </div>
          )}

          {timeframeType === 'date' && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Target Date
              </label>
              <div className="relative">
                <Calendar className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
            </div>
          )}

          {timeframeType === 'custom' && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Custom Timeframe
              </label>
              <input
                type="text"
                value={customTimeframe}
                onChange={(e) => setCustomTimeframe(e.target.value)}
                placeholder="e.g., End of 2025, Q2 2026"
                className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
          )}

          {/* Probability input */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Probability (%)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={probability}
                onChange={(e) => {
                  const val = e.target.value
                  if (val === '' || (parseFloat(val) >= 0 && parseFloat(val) <= 100)) {
                    setProbability(val)
                  }
                }}
                className={clsx(
                  'w-24 px-3 py-1.5 text-sm border rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white',
                  !isProbabilityValid
                    ? 'border-red-500 dark:border-red-500'
                    : 'border-gray-300 dark:border-gray-600'
                )}
                placeholder="0"
                min="0"
                max={maxProbability}
                step="1"
              />
              <span className="text-xs text-gray-500 dark:text-gray-400">%</span>
              {otherScenariosProbabilitySum > 0 && (
                <span className={clsx(
                  'text-xs',
                  isProbabilityValid
                    ? 'text-gray-500 dark:text-gray-400'
                    : 'text-red-600 dark:text-red-400'
                )}>
                  (Total: {totalProbability.toFixed(0)}% / 100%)
                </span>
              )}
            </div>
            {!isProbabilityValid && (
              <p className="text-[10px] text-red-600 dark:text-red-400 mt-1">
                Total probability cannot exceed 100%. Max for this scenario: {maxProbability.toFixed(0)}%
              </p>
            )}
            {isProbabilityValid && otherScenariosProbabilitySum > 0 && (
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
                Other scenarios: {otherScenariosProbabilitySum.toFixed(0)}% allocated
              </p>
            )}
          </div>

          {/* Reasoning textarea */}
          {showReasoning && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Reasoning (optional)
              </label>
              <textarea
                value={reasoning}
                onChange={(e) => setReasoning(e.target.value)}
                className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none"
                rows={2}
                placeholder="Key drivers for this scenario..."
              />
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={handleCancel}
              className="px-3 py-1 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
              disabled={isSaving}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!price || isSaving || !isProbabilityValid}
              className="px-3 py-1 text-xs bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              {isSaving ? (
                <>Saving...</>
              ) : (
                <>
                  <Check className="w-3 h-3" />
                  Save
                </>
              )}
            </button>
          </div>
        </div>
      ) : priceTarget ? (
        <div className="space-y-2">
          {/* Price display */}
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-gray-900 dark:text-white">
              ${priceTarget.price.toFixed(2)}
            </span>
            {priceTarget.is_rolling ? (
              <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                <RefreshCw className="w-3 h-3" />
                {priceTarget.timeframe} (rolling)
              </span>
            ) : expirationInfo ? (
              <span className={clsx(
                'text-xs flex items-center gap-1',
                expirationInfo.isExpired
                  ? 'text-red-600 dark:text-red-400'
                  : expirationInfo.isUrgent
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-gray-500 dark:text-gray-400'
              )}>
                {expirationInfo.isUrgent && <AlertTriangle className="w-3 h-3" />}
                {priceTarget.timeframe_type === 'date' ? (
                  <Calendar className="w-3 h-3" />
                ) : (
                  <Clock className="w-3 h-3" />
                )}
                {expirationInfo.text}
              </span>
            ) : getDisplayTimeframe() && (
              <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {getDisplayTimeframe()}
              </span>
            )}
          </div>

          {/* Expiration date for fixed targets */}
          {!priceTarget.is_rolling && expirationInfo && (
            <div className={clsx(
              'text-[10px] px-2 py-1 rounded flex items-center justify-between',
              expirationInfo.isExpired
                ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                : expirationInfo.isUrgent
                  ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
                  : 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
            )}>
              <span>Expires: {expirationInfo.formattedDate}</span>
              {expirationInfo.isExpired && (
                <span className="font-medium">Target needs update</span>
              )}
            </div>
          )}

          {/* Probability display */}
          {priceTarget.probability !== null && priceTarget.probability !== undefined && (
            <div className="text-xs text-gray-600 dark:text-gray-400 flex items-center gap-1">
              <span className="font-medium">{priceTarget.probability}%</span>
              <span>probability</span>
            </div>
          )}

          {/* Reasoning */}
          {showReasoning && priceTarget.reasoning && (
            <div className="flex items-start gap-1.5 mt-2">
              <MessageSquare className="w-3 h-3 text-gray-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2">
                {priceTarget.reasoning}
              </p>
            </div>
          )}
        </div>
      ) : isEditable ? (
        <button
          onClick={startEditing}
          className="w-full py-4 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 border border-dashed border-gray-300 dark:border-gray-600 rounded-md hover:border-gray-400 dark:hover:border-gray-500 transition-colors"
        >
          + Add Price Target
        </button>
      ) : (
        <div className="py-4 text-center text-sm text-gray-400 dark:text-gray-500">
          No target set
        </div>
      )}
    </div>
  )
}
