import { useState } from 'react'
import { clsx } from 'clsx'
import { Loader2, Check, Edit2, Users, ChevronDown } from 'lucide-react'
import { useAnalystRatings, useRatingScales, type AnalystRating } from '../../hooks/useAnalystRatings'
import { useAuth } from '../../hooks/useAuth'

interface AnalystRatingsSectionProps {
  assetId: string
  className?: string
  isEditable?: boolean
  /** When true, hides the internal header (for use as an embedded field) */
  embedded?: boolean
}

export function AnalystRatingsSection({ assetId, className, isEditable = false, embedded = false }: AnalystRatingsSectionProps) {
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

  const [isEditing, setIsEditing] = useState(false)
  const [selectedValue, setSelectedValue] = useState(myRating?.rating_value || '')
  const [selectedScaleId, setSelectedScaleId] = useState(myRating?.rating_scale_id || defaultScale?.id || '')
  const [notes, setNotes] = useState(myRating?.notes || '')

  // Get current scale values
  const currentScale = scales.find(s => s.id === selectedScaleId) || defaultScale
  const scaleValues = currentScale?.values || []

  // Handle save
  const handleSave = async () => {
    if (!selectedValue || !selectedScaleId) return

    await saveRating.mutateAsync({
      ratingValue: selectedValue,
      ratingScaleId: selectedScaleId,
      notes: notes || undefined,
      source: 'manual'
    })

    setIsEditing(false)
  }

  // Start editing with current values
  const startEditing = () => {
    setSelectedValue(myRating?.rating_value || '')
    setSelectedScaleId(myRating?.rating_scale_id || defaultScale?.id || '')
    setNotes(myRating?.notes || '')
    setIsEditing(true)
  }

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
        {/* Consensus View */}
        {consensus.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Users className="w-3.5 h-3.5" />
              <span>Firm Consensus ({ratings.length} analyst{ratings.length !== 1 ? 's' : ''})</span>
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
          <div className="border-t border-gray-100 pt-4">
            {isEditing || !myRating ? (
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

                {/* Notes and Save inline */}
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Notes (optional)"
                    className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                  {(isEditing && myRating) && (
                    <button
                      onClick={() => setIsEditing(false)}
                      className="px-2 py-1.5 text-sm text-gray-500 hover:text-gray-700"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    onClick={handleSave}
                    disabled={!selectedValue || !selectedScaleId || saveRating.isPending}
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
            ) : (
              // Display current rating with edit button
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
                <button
                  onClick={startEditing}
                  className="p-1 text-gray-400 hover:text-gray-600 rounded"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
              </div>
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
                  <span
                    className="text-sm font-medium px-2 py-0.5 rounded"
                    style={{
                      backgroundColor: `${getRatingColor(rating.rating_scale_id, rating.rating_value)}15`,
                      color: getRatingColor(rating.rating_scale_id, rating.rating_value)
                    }}
                  >
                    {getRatingLabel(rating.rating_scale_id, rating.rating_value)}
                  </span>
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
