import { useState, useEffect } from 'react'
import { clsx } from 'clsx'
import { Loader2, Check, Edit2, Users, ChevronDown, X } from 'lucide-react'
import { useAnalystRatings, useRatingScales, type AnalystRating, type ConvictionLevel } from '../../hooks/useAnalystRatings'
import { useAuth } from '../../hooks/useAuth'
import { useRatingDivergence } from '../../hooks/useRatingDivergence'
import { DivergenceBadge } from './DivergenceBadge'
import { InconsistencyBadge } from './InconsistencyBadge'
import type { ViewScope } from '../../hooks/useExpectedValue'

interface AnalystRatingsSectionProps {
  assetId: string
  className?: string
  isEditable?: boolean
  currentPrice?: number
  /** Currently selected view scope (firm or specific user) */
  viewScope?: ViewScope
  /**
   * User IDs whose ratings the current user can see.
   * Filters the divergence badge to only accessible analysts.
   */
  accessibleUserIds?: string[]
  /** When true, hides the internal header (for use as an embedded field) */
  embedded?: boolean
  /** When true, shows firm consensus. False hides it (e.g. individual analyst view). */
  showConsensus?: boolean
}

const CONVICTION_OPTIONS: { value: ConvictionLevel; label: string; color: string; dot: string }[] = [
  { value: 'low', label: 'Low', color: 'text-gray-500 dark:text-gray-400', dot: 'bg-gray-400' },
  { value: 'medium', label: 'Med', color: 'text-blue-600 dark:text-blue-400', dot: 'bg-blue-500' },
  { value: 'high', label: 'High', color: 'text-green-600 dark:text-green-400', dot: 'bg-green-500' },
]

const getConvictionConfig = (level: ConvictionLevel | null) =>
  CONVICTION_OPTIONS.find(o => o.value === level)

export function AnalystRatingsSection({ assetId, className, isEditable = false, currentPrice, viewScope, accessibleUserIds, embedded = false, showConsensus = true }: AnalystRatingsSectionProps) {
  const { user } = useAuth()
  const {
    ratings,
    myRating,
    otherRatings,
    consensus,
    isLoading,
    saveRating
  } = useAnalystRatings({ assetId })

  const {
    scales,
    defaultScale,
    getRatingLabel,
    getRatingColor,
    isLoading: scalesLoading
  } = useRatingScales()

  const {
    hasCrossViewDivergence,
    ratingBreakdown,
    hasEVInconsistency,
    isSuppressed,
    myDirection,
    evReturn,
    conflictDescription,
    canSuppress,
    suppress24h,
    isSuppressing,
  } = useRatingDivergence({ assetId, currentPrice, viewScope, accessibleUserIds })

  const [isEditing, setIsEditing] = useState(false)
  const [selectedValue, setSelectedValue] = useState(myRating?.rating_value || '')
  const [selectedScaleId, setSelectedScaleId] = useState(myRating?.rating_scale_id || defaultScale?.id || '')
  const [selectedConviction, setSelectedConviction] = useState<ConvictionLevel | null>(myRating?.conviction || null)
  const [notes, setNotes] = useState(myRating?.notes || '')

  // Get current scale values
  const currentScale = scales.find(s => s.id === selectedScaleId) || defaultScale
  const scaleValues = currentScale?.values || []

  // Handle save
  const handleSave = async () => {
    // If editing an existing rating, allow saving with just conviction/notes changes
    const effectiveValue = selectedValue || myRating?.rating_value
    const effectiveScaleId = selectedScaleId || myRating?.rating_scale_id
    if (!effectiveValue || !effectiveScaleId) return

    await saveRating.mutateAsync({
      ratingValue: effectiveValue,
      ratingScaleId: effectiveScaleId,
      conviction: selectedConviction,
      notes: notes || undefined,
      source: 'manual'
    })

    setIsEditing(false)
  }

  // Start editing with current values
  const startEditing = () => {
    setSelectedValue(myRating?.rating_value || '')
    setSelectedScaleId(myRating?.rating_scale_id || defaultScale?.id || '')
    setSelectedConviction(myRating?.conviction || null)
    setNotes(myRating?.notes || '')
    setIsEditing(true)
  }

  const cancelEditing = () => {
    setIsEditing(false)
    // Reset to saved values
    setSelectedValue(myRating?.rating_value || '')
    setSelectedScaleId(myRating?.rating_scale_id || defaultScale?.id || '')
    setSelectedConviction(myRating?.conviction || null)
    setNotes(myRating?.notes || '')
  }

  // Listen for external edit trigger from ActionLoopModule
  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail?.assetId === assetId && isEditable) startEditing()
    }
    window.addEventListener('actionloop-edit-rating', handler)
    return () => window.removeEventListener('actionloop-edit-rating', handler)
  }, [assetId, isEditable])

  // Can save: either new rating with value selected, or existing rating (conviction/notes-only edit is fine)
  const canSave = (!!selectedValue && !!selectedScaleId) || (!!myRating && !!(selectedValue || myRating.rating_value))

  if (isLoading || scalesLoading) {
    return (
      <div className={clsx('bg-white rounded-lg border border-gray-200 p-4', className)}>
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        </div>
      </div>
    )
  }

  return (
    <div className={clsx(
      'bg-white rounded-lg',
      !embedded && 'border border-gray-200',
      className
    )}>
      {!embedded && (
        <div className="px-4 py-3 border-b border-gray-100">
          <h4 className="text-sm font-medium text-gray-900">Rating</h4>
        </div>
      )}

      <div className={clsx('space-y-4', !embedded && 'p-4')}>
        {/* Consensus View — only in aggregated view */}
        {showConsensus && consensus.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Users className="w-3.5 h-3.5" />
              <span>Firm Consensus ({ratings.length} analyst{ratings.length !== 1 ? 's' : ''})</span>
              {hasCrossViewDivergence && <DivergenceBadge breakdown={ratingBreakdown} />}
            </div>
            <div className="flex flex-wrap gap-2">
              {consensus.map(({ value, count, percentage }) => {
                const color = myRating?.rating_scale_id
                  ? getRatingColor(myRating.rating_scale_id, value)
                  : '#6b7280'
                const label = myRating?.rating_scale_id
                  ? getRatingLabel(myRating.rating_scale_id, value)
                  : value

                return (
                  <div
                    key={value}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm"
                    style={{
                      backgroundColor: `${color}15`,
                      color: color
                    }}
                  >
                    <span className="font-medium">{label}</span>
                    <span className="text-xs opacity-75">
                      {count} ({Math.round(percentage)}%)
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* My Rating */}
        {isEditable && (
          <div className={clsx(showConsensus && consensus.length > 0 && 'border-t border-gray-100 pt-4')}>
            {isEditing ? (
              <div className="space-y-3">
                {/* Scale and Rating inline */}
                <div className="flex flex-wrap items-center gap-3">
                  {/* Scale selector (if multiple scales available) */}
                  {scales.length > 1 && (
                    <select
                      value={selectedScaleId}
                      onChange={(e) => {
                        setSelectedScaleId(e.target.value)
                        setSelectedValue('') // Reset value when scale changes
                      }}
                      className="px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    >
                      {scales.map(scale => (
                        <option key={scale.id} value={scale.id}>
                          {scale.name}
                        </option>
                      ))}
                    </select>
                  )}

                  {/* Rating value buttons */}
                  <div className="flex flex-wrap gap-1.5">
                    {scaleValues.map(({ value, label, color }) => (
                      <button
                        key={value}
                        onClick={() => setSelectedValue(value)}
                        className={clsx(
                          'px-2.5 py-1 text-sm font-medium rounded-full border-2 transition-all',
                          selectedValue === value
                            ? 'border-current shadow-sm'
                            : 'border-transparent hover:border-gray-200'
                        )}
                        style={{
                          backgroundColor: selectedValue === value ? `${color}20` : `${color}10`,
                          color: color
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Conviction level */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Conviction</span>
                  <div className="flex items-center gap-1">
                    {CONVICTION_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setSelectedConviction(selectedConviction === opt.value ? null : opt.value)}
                        className={clsx(
                          'px-2.5 py-1 text-xs font-medium rounded-full border transition-all flex items-center gap-1.5',
                          selectedConviction === opt.value
                            ? 'border-current bg-white dark:bg-gray-800 shadow-sm'
                            : 'border-transparent hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400'
                        )}
                      >
                        <span className={clsx('inline-block h-1.5 w-1.5 rounded-full', selectedConviction === opt.value ? opt.dot : 'bg-gray-300')} />
                        <span className={selectedConviction === opt.value ? opt.color : undefined}>{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Notes and Save inline */}
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Notes (optional)"
                    className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                  <button
                    onClick={cancelEditing}
                    className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
                    title="Cancel"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={!canSave || saveRating.isPending}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saveRating.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                    Save
                  </button>
                </div>
              </div>
            ) : myRating ? (
              // Display current rating with conviction and edit button
              <div className="flex items-center gap-2">
                <div
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium"
                  style={{
                    backgroundColor: `${getRatingColor(myRating.rating_scale_id, myRating.rating_value)}20`,
                    color: getRatingColor(myRating.rating_scale_id, myRating.rating_value)
                  }}
                >
                  {getRatingLabel(myRating.rating_scale_id, myRating.rating_value)}
                </div>
                {myRating.conviction && (() => {
                  const cc = getConvictionConfig(myRating.conviction)
                  return cc ? (
                    <span className={clsx('inline-flex items-center gap-1 text-xs font-medium', cc.color)}>
                      <span className={clsx('inline-block h-1.5 w-1.5 rounded-full', cc.dot)} />
                      {cc.label}
                    </span>
                  ) : null
                })()}
                {hasEVInconsistency && !isSuppressed && myDirection && evReturn != null && conflictDescription && (
                  <InconsistencyBadge
                    direction={myDirection}
                    evReturn={evReturn}
                    conflictDescription={conflictDescription}
                    canSuppress={canSuppress}
                    onSuppress={suppress24h}
                    isSuppressing={isSuppressing}
                  />
                )}
                <button
                  onClick={startEditing}
                  className="p-1 text-gray-400 hover:text-gray-600 rounded"
                  title="Edit rating"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
              </div>
            ) : (
              // No rating yet — show "Set Rating" button
              <button
                onClick={startEditing}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-500 hover:text-gray-700 border border-dashed border-gray-300 hover:border-gray-400 rounded-lg transition-colors"
              >
                <Edit2 className="w-3.5 h-3.5" />
                Set Rating
              </button>
            )}
          </div>
        )}

        {/* Other Analysts' Ratings */}
        {otherRatings.length > 0 && !isEditable && (
          <div className="space-y-2">
            <span className="text-xs text-gray-500">Individual Ratings</span>
            <div className="space-y-1">
              {otherRatings.map(rating => (
                <div
                  key={rating.id}
                  className="flex items-center justify-between py-1"
                >
                  <span className="text-sm text-gray-600">
                    {rating.user?.full_name || 'Unknown'}
                  </span>
                  <div className="flex items-center gap-2">
                    <span
                      className="text-sm font-medium px-2 py-0.5 rounded"
                      style={{
                        backgroundColor: `${getRatingColor(rating.rating_scale_id, rating.rating_value)}15`,
                        color: getRatingColor(rating.rating_scale_id, rating.rating_value)
                      }}
                    >
                      {getRatingLabel(rating.rating_scale_id, rating.rating_value)}
                    </span>
                    {rating.conviction && (() => {
                      const cc = getConvictionConfig(rating.conviction)
                      return cc ? (
                        <span className={clsx('inline-flex items-center gap-1 text-[11px] font-medium', cc.color)}>
                          <span className={clsx('inline-block h-1.5 w-1.5 rounded-full', cc.dot)} />
                          {cc.label}
                        </span>
                      ) : null
                    })()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {ratings.length === 0 && !isEditable && (
          <p className="text-sm text-gray-500 text-center py-2">
            No ratings yet
          </p>
        )}
      </div>
    </div>
  )
}
