import { useState, useMemo } from 'react'
import { clsx } from 'clsx'
import { Loader2, Plus, Edit2, Check, X, TrendingUp, Users, ChevronDown, ChevronRight } from 'lucide-react'
import {
  useAnalystEstimates,
  useEstimateMetrics,
  useEstimateConsensus,
  type AnalystEstimate
} from '../../hooks/useAnalystEstimates'
import { useAuth } from '../../hooks/useAuth'

interface AnalystEstimatesSectionProps {
  assetId: string
  className?: string
  isEditable?: boolean
}

// Get current fiscal year
const getCurrentFiscalYear = () => {
  const now = new Date()
  // Assuming fiscal year follows calendar year for simplicity
  return now.getFullYear()
}

// Format value based on metric format
const formatValue = (value: number, format: string, currency = 'USD') => {
  switch (format) {
    case 'currency':
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(value)
    case 'percent':
      return `${value.toFixed(1)}%`
    case 'ratio':
      return value.toFixed(2)
    default:
      return value >= 1000
        ? new Intl.NumberFormat('en-US', {
            notation: 'compact',
            maximumFractionDigits: 1
          }).format(value)
        : value.toFixed(2)
  }
}

// Estimate row component
interface EstimateRowProps {
  metricKey: string
  metricLabel: string
  metricFormat: string
  fiscalYear: number
  fiscalQuarter?: number
  estimate?: AnalystEstimate
  consensusValue?: number
  analystCount?: number
  isEditable: boolean
  onSave: (value: number) => Promise<void>
  isSaving: boolean
}

function EstimateRow({
  metricKey,
  metricLabel,
  metricFormat,
  fiscalYear,
  fiscalQuarter,
  estimate,
  consensusValue,
  analystCount,
  isEditable,
  onSave,
  isSaving
}: EstimateRowProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [value, setValue] = useState(estimate?.value?.toString() || '')

  const handleSave = async () => {
    const numValue = parseFloat(value)
    if (isNaN(numValue)) return

    await onSave(numValue)
    setIsEditing(false)
  }

  const periodLabel = fiscalQuarter
    ? `Q${fiscalQuarter} FY${fiscalYear.toString().slice(-2)}`
    : `FY${fiscalYear.toString().slice(-2)}`

  return (
    <div className="flex items-center py-2 border-b border-gray-100 last:border-0">
      {/* Metric & Period */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900">{metricLabel}</span>
          <span className="text-xs text-gray-500">{periodLabel}</span>
        </div>
        {/* Consensus indicator */}
        {consensusValue !== undefined && analystCount !== undefined && analystCount > 1 && (
          <div className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
            <Users className="w-3 h-3" />
            <span>
              Consensus: {formatValue(consensusValue, metricFormat)} ({analystCount})
            </span>
          </div>
        )}
      </div>

      {/* Value */}
      <div className="flex items-center gap-2">
        {isEditing ? (
          <div className="flex items-center gap-1">
            <input
              type="number"
              step="0.01"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave()
                if (e.key === 'Escape') setIsEditing(false)
              }}
            />
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="p-1 text-green-600 hover:bg-green-50 rounded"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={() => setIsEditing(false)}
              className="p-1 text-gray-400 hover:bg-gray-100 rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <>
            {estimate ? (
              <span className="text-sm font-medium text-gray-900">
                {formatValue(estimate.value, metricFormat, estimate.currency)}
              </span>
            ) : (
              <span className="text-sm text-gray-400">—</span>
            )}
            {isEditable && (
              <button
                onClick={() => {
                  setValue(estimate?.value?.toString() || '')
                  setIsEditing(true)
                }}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// Main component
export function AnalystEstimatesSection({
  assetId,
  className,
  isEditable = false
}: AnalystEstimatesSectionProps) {
  const { user } = useAuth()
  const currentFY = getCurrentFiscalYear()
  const nextFY = currentFY + 1

  const [expandedMetrics, setExpandedMetrics] = useState<Record<string, boolean>>({
    eps: true,
    revenue: true
  })

  // Fetch estimates
  const {
    estimates,
    myEstimates,
    isLoading,
    saveEstimate
  } = useAnalystEstimates({ assetId })

  // Fetch metrics
  const {
    metrics,
    defaultMetrics,
    getMetricByKey,
    isLoading: metricsLoading
  } = useEstimateMetrics()

  // Group estimates by metric
  const estimatesByMetricAndPeriod = useMemo(() => {
    const result: Record<string, Record<string, AnalystEstimate[]>> = {}

    estimates.forEach(est => {
      const periodKey = est.fiscal_quarter
        ? `${est.fiscal_year}Q${est.fiscal_quarter}`
        : `FY${est.fiscal_year}`

      if (!result[est.metric_key]) {
        result[est.metric_key] = {}
      }
      if (!result[est.metric_key][periodKey]) {
        result[est.metric_key][periodKey] = []
      }
      result[est.metric_key][periodKey].push(est)
    })

    return result
  }, [estimates])

  // Calculate simple consensus (mean) for a period
  const getConsensus = (metricKey: string, periodKey: string) => {
    const periodEstimates = estimatesByMetricAndPeriod[metricKey]?.[periodKey] || []
    if (periodEstimates.length === 0) return { value: undefined, count: 0 }

    const sum = periodEstimates.reduce((acc, e) => acc + e.value, 0)
    return {
      value: sum / periodEstimates.length,
      count: periodEstimates.length
    }
  }

  // Get my estimate for a specific metric/period
  const getMyEstimate = (metricKey: string, fiscalYear: number, fiscalQuarter?: number) => {
    return myEstimates.find(e =>
      e.metric_key === metricKey &&
      e.fiscal_year === fiscalYear &&
      e.fiscal_quarter === (fiscalQuarter ?? null)
    )
  }

  // Handle save
  const handleSave = async (
    metricKey: string,
    fiscalYear: number,
    value: number,
    fiscalQuarter?: number
  ) => {
    await saveEstimate.mutateAsync({
      metricKey,
      periodType: fiscalQuarter ? 'quarterly' : 'annual',
      fiscalYear,
      fiscalQuarter,
      value,
      source: 'manual'
    })
  }

  // Toggle metric expansion
  const toggleMetric = (metricKey: string) => {
    setExpandedMetrics(prev => ({
      ...prev,
      [metricKey]: !prev[metricKey]
    }))
  }

  if (isLoading || metricsLoading) {
    return (
      <div className={clsx('bg-white rounded-lg border border-gray-200 p-4', className)}>
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        </div>
      </div>
    )
  }

  // Periods to show
  const periods = [
    { fiscalYear: currentFY, label: `FY${currentFY.toString().slice(-2)}` },
    { fiscalYear: nextFY, label: `FY${nextFY.toString().slice(-2)}` }
  ]

  // Metrics to show (default ones first)
  const metricsToShow = defaultMetrics.length > 0 ? defaultMetrics : metrics.slice(0, 3)

  return (
    <div className={clsx('bg-white rounded-lg border border-gray-200', className)}>
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-gray-900 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-gray-500" />
            Estimates
          </h4>
          {estimates.length > 0 && (
            <span className="text-xs text-gray-500">
              {new Set(estimates.map(e => e.user_id)).size} analyst{new Set(estimates.map(e => e.user_id)).size !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      <div className="divide-y divide-gray-100">
        {metricsToShow.map(metric => {
          const isExpanded = expandedMetrics[metric.key] ?? false

          return (
            <div key={metric.key}>
              {/* Metric header */}
              <button
                onClick={() => toggleMetric(metric.key)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
              >
                <span className="text-sm font-medium text-gray-900">{metric.label}</span>
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                )}
              </button>

              {/* Metric estimates */}
              {isExpanded && (
                <div className="px-4 pb-3">
                  {periods.map(period => {
                    const periodKey = `FY${period.fiscalYear}`
                    const consensus = getConsensus(metric.key, periodKey)
                    const myEstimate = getMyEstimate(metric.key, period.fiscalYear)

                    return (
                      <EstimateRow
                        key={periodKey}
                        metricKey={metric.key}
                        metricLabel={metric.label}
                        metricFormat={metric.format}
                        fiscalYear={period.fiscalYear}
                        estimate={myEstimate}
                        consensusValue={consensus.value}
                        analystCount={consensus.count}
                        isEditable={isEditable}
                        onSave={(value) => handleSave(metric.key, period.fiscalYear, value)}
                        isSaving={saveEstimate.isPending}
                      />
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Empty state */}
      {metricsToShow.length === 0 && (
        <div className="p-4 text-sm text-gray-500 text-center">
          No estimate metrics configured
        </div>
      )}
    </div>
  )
}
