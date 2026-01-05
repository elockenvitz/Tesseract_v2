import { useMemo } from 'react'
import { clsx } from 'clsx'
import { Users, TrendingUp, BarChart3, Loader2 } from 'lucide-react'
import { useAnalystRatings, useRatingScales } from '../../hooks/useAnalystRatings'
import { useAnalystEstimates, useEstimateMetrics } from '../../hooks/useAnalystEstimates'

interface FirmConsensusPanelProps {
  assetId: string
  className?: string
}

// Get current fiscal year
const getCurrentFiscalYear = () => new Date().getFullYear()

// Format value based on metric format
const formatValue = (value: number, format: string) => {
  switch (format) {
    case 'currency':
      return value >= 1000000000
        ? `$${(value / 1000000000).toFixed(1)}B`
        : value >= 1000000
        ? `$${(value / 1000000).toFixed(1)}M`
        : `$${value.toFixed(2)}`
    case 'percent':
      return `${(value * 100).toFixed(1)}%`
    default:
      return value >= 1000
        ? `${(value / 1000).toFixed(1)}K`
        : value.toFixed(2)
  }
}

export function FirmConsensusPanel({ assetId, className }: FirmConsensusPanelProps) {
  const currentFY = getCurrentFiscalYear()
  const nextFY = currentFY + 1

  // Rating data
  const { ratings, consensus: ratingConsensus, isLoading: ratingsLoading } = useAnalystRatings({ assetId })
  const { getRatingLabel, getRatingColor, defaultScale } = useRatingScales()

  // Estimate data
  const { estimates, isLoading: estimatesLoading } = useAnalystEstimates({ assetId })
  const { metrics, getMetricByKey } = useEstimateMetrics()

  // Calculate estimate consensus by metric and period
  const estimateConsensus = useMemo(() => {
    const result: Record<string, {
      metricKey: string
      label: string
      format: string
      periods: Record<string, { mean: number; count: number }>
    }> = {}

    estimates.forEach(est => {
      const metric = getMetricByKey(est.metric_key)
      if (!metric) return

      if (!result[est.metric_key]) {
        result[est.metric_key] = {
          metricKey: est.metric_key,
          label: metric.label,
          format: metric.format,
          periods: {}
        }
      }

      const periodKey = `FY${est.fiscal_year}`
      if (!result[est.metric_key].periods[periodKey]) {
        result[est.metric_key].periods[periodKey] = { mean: 0, count: 0 }
      }

      // Running average
      const p = result[est.metric_key].periods[periodKey]
      p.mean = (p.mean * p.count + est.value) / (p.count + 1)
      p.count++
    })

    return result
  }, [estimates, getMetricByKey])

  // Get dominant rating
  const dominantRating = ratingConsensus[0]

  // Key metrics to show (EPS and Revenue)
  const keyMetrics = ['eps', 'revenue'].filter(key => estimateConsensus[key])

  const isLoading = ratingsLoading || estimatesLoading
  const hasData = ratings.length > 0 || estimates.length > 0

  if (isLoading) {
    return (
      <div className={clsx('bg-white rounded-lg border border-gray-200 p-4', className)}>
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        </div>
      </div>
    )
  }

  if (!hasData) {
    return null
  }

  return (
    <div className={clsx('bg-white rounded-lg border border-gray-200', className)}>
      <div className="px-4 py-3 border-b border-gray-100">
        <h4 className="text-sm font-medium text-gray-900 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-gray-500" />
          Firm Consensus
        </h4>
      </div>

      <div className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Rating Consensus */}
          {dominantRating && defaultScale && (
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">
                Rating
              </div>
              <div
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold"
                style={{
                  backgroundColor: `${getRatingColor(defaultScale.id, dominantRating.value)}20`,
                  color: getRatingColor(defaultScale.id, dominantRating.value)
                }}
              >
                {getRatingLabel(defaultScale.id, dominantRating.value)}
              </div>
              <div className="flex items-center justify-center gap-1 mt-2 text-xs text-gray-500">
                <Users className="w-3 h-3" />
                <span>
                  {dominantRating.count}/{ratings.length} analysts
                  ({Math.round(dominantRating.percentage)}%)
                </span>
              </div>
            </div>
          )}

          {/* Key Estimates */}
          {keyMetrics.map(metricKey => {
            const data = estimateConsensus[metricKey]
            if (!data) return null

            const fyData = data.periods[`FY${currentFY}`]
            const nfyData = data.periods[`FY${nextFY}`]

            return (
              <div key={metricKey} className="text-center p-3 bg-gray-50 rounded-lg">
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">
                  {data.label}
                </div>
                <div className="space-y-1">
                  {fyData && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">FY{String(currentFY).slice(-2)}</span>
                      <span className="font-semibold text-gray-900">
                        {formatValue(fyData.mean, data.format)}
                      </span>
                    </div>
                  )}
                  {nfyData && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">FY{String(nextFY).slice(-2)}</span>
                      <span className="font-semibold text-gray-900">
                        {formatValue(nfyData.mean, data.format)}
                      </span>
                    </div>
                  )}
                </div>
                {(fyData || nfyData) && (
                  <div className="flex items-center justify-center gap-1 mt-2 text-xs text-gray-500">
                    <Users className="w-3 h-3" />
                    <span>
                      {Math.max(fyData?.count || 0, nfyData?.count || 0)} analysts
                    </span>
                  </div>
                )}
              </div>
            )
          })}

          {/* Show placeholder if only rating but no estimates */}
          {dominantRating && keyMetrics.length === 0 && (
            <div className="col-span-2 text-center p-3 bg-gray-50 rounded-lg text-sm text-gray-500">
              No estimate data yet
            </div>
          )}
        </div>

        {/* Additional metrics if available */}
        {Object.keys(estimateConsensus).length > 2 && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Object.entries(estimateConsensus)
                .filter(([key]) => !['eps', 'revenue'].includes(key))
                .slice(0, 4)
                .map(([key, data]) => {
                  const fyData = data.periods[`FY${currentFY}`] || data.periods[`FY${nextFY}`]
                  if (!fyData) return null

                  return (
                    <div key={key} className="text-center">
                      <div className="text-xs text-gray-500 mb-1">{data.label}</div>
                      <div className="text-sm font-medium text-gray-900">
                        {formatValue(fyData.mean, data.format)}
                      </div>
                    </div>
                  )
                })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
