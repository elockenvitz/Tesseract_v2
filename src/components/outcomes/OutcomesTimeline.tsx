import React, { useState, useMemo } from 'react'
import { clsx } from 'clsx'
import {
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Calendar,
  Target,
  TrendingUp,
  TrendingDown,
  Filter,
  User,
  ChevronDown,
  ChevronRight,
  Minus
} from 'lucide-react'
import { useTargetOutcomes, TargetOutcome, OutcomeStatus } from '../../hooks/useTargetOutcomes'

interface OutcomesTimelineProps {
  assetId: string
  userId?: string // Filter by specific user
  className?: string
  maxItems?: number
}

type FilterStatus = 'all' | OutcomeStatus

// Status configuration
const statusConfig: Record<OutcomeStatus, {
  icon: React.ElementType
  label: string
  color: string
  bgColor: string
  borderColor: string
}> = {
  pending: {
    icon: Clock,
    label: 'Pending',
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-50 dark:bg-amber-900/20',
    borderColor: 'border-amber-300 dark:border-amber-700'
  },
  hit: {
    icon: CheckCircle,
    label: 'Hit',
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-50 dark:bg-green-900/20',
    borderColor: 'border-green-300 dark:border-green-700'
  },
  missed: {
    icon: XCircle,
    label: 'Missed',
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-50 dark:bg-red-900/20',
    borderColor: 'border-red-300 dark:border-red-700'
  },
  expired: {
    icon: AlertTriangle,
    label: 'Expired',
    color: 'text-gray-600 dark:text-gray-400',
    bgColor: 'bg-gray-50 dark:bg-gray-800',
    borderColor: 'border-gray-300 dark:border-gray-700'
  },
  cancelled: {
    icon: Minus,
    label: 'Cancelled',
    color: 'text-gray-400 dark:text-gray-500',
    bgColor: 'bg-gray-50 dark:bg-gray-800',
    borderColor: 'border-gray-200 dark:border-gray-700'
  }
}

// Timeline item component
function TimelineItem({
  outcome,
  isLast
}: {
  outcome: TargetOutcome
  isLast: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const config = statusConfig[outcome.status]
  const Icon = config.icon

  const resolvedDate = outcome.hit_date || outcome.evaluated_at
  const displayDate = resolvedDate ? new Date(resolvedDate) : new Date(outcome.target_date)

  const priceChange = outcome.hit_price !== null && outcome.target_price
    ? ((outcome.hit_price - outcome.target_price) / outcome.target_price) * 100
    : null

  return (
    <div className="relative">
      {/* Connector line */}
      {!isLast && (
        <div className="absolute left-4 top-10 w-0.5 h-full bg-gray-200 dark:bg-gray-700" />
      )}

      <div className="flex gap-4">
        {/* Status icon */}
        <div className={clsx(
          'relative z-10 flex items-center justify-center w-8 h-8 rounded-full border-2',
          config.bgColor,
          config.borderColor
        )}>
          <Icon className={clsx('w-4 h-4', config.color)} />
        </div>

        {/* Content */}
        <div className="flex-1 pb-6">
          <div
            className={clsx(
              'p-4 rounded-lg border cursor-pointer transition-all hover:shadow-sm',
              config.bgColor,
              config.borderColor
            )}
            onClick={() => setExpanded(!expanded)}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Scenario badge */}
                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                    style={{
                      backgroundColor: outcome.scenario?.color ? `${outcome.scenario.color}20` : '#e5e7eb',
                      color: outcome.scenario?.color || '#6b7280'
                    }}
                  >
                    {outcome.scenario?.name || outcome.scenario_type || 'Unknown'}
                  </span>

                  {/* Status */}
                  <span className={clsx('text-xs font-medium', config.color)}>
                    {config.label}
                  </span>

                  {/* Accuracy badge for resolved */}
                  {outcome.accuracy_pct !== null && (
                    <span className={clsx(
                      'text-xs font-medium px-1.5 py-0.5 rounded',
                      outcome.accuracy_pct >= 90 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                      outcome.accuracy_pct >= 70 ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                      'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                    )}>
                      {outcome.accuracy_pct.toFixed(0)}% accurate
                    </span>
                  )}
                </div>

                {/* Target price */}
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-lg font-bold text-gray-900 dark:text-white">
                    ${outcome.target_price.toFixed(2)}
                  </span>
                  {outcome.hit_price && (
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      <span className="mx-1">→</span>
                      <span className={clsx(
                        'font-medium',
                        priceChange !== null && priceChange >= 0 ? 'text-green-600' : 'text-red-600'
                      )}>
                        ${outcome.hit_price.toFixed(2)}
                      </span>
                    </span>
                  )}
                </div>

                {/* Analyst */}
                <div className="mt-1 flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400">
                  <User className="w-3 h-3" />
                  <span>{outcome.user?.full_name || 'Unknown Analyst'}</span>
                </div>
              </div>

              {/* Date & expand */}
              <div className="flex items-center gap-2 text-right">
                <div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    {displayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                  {outcome.days_to_hit !== null && (
                    <div className="text-xs text-gray-500">
                      {outcome.days_to_hit} days to hit
                    </div>
                  )}
                </div>
                {expanded ? (
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                )}
              </div>
            </div>

            {/* Expanded content */}
            {expanded && (
              <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                  <div>
                    <div className="text-gray-500 dark:text-gray-400">Target Set</div>
                    <div className="font-medium text-gray-900 dark:text-white">
                      {new Date(outcome.target_set_date).toLocaleDateString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500 dark:text-gray-400">Target Date</div>
                    <div className="font-medium text-gray-900 dark:text-white">
                      {new Date(outcome.target_date).toLocaleDateString()}
                    </div>
                  </div>
                  {outcome.price_at_expiry !== null && (
                    <div>
                      <div className="text-gray-500 dark:text-gray-400">Price at Expiry</div>
                      <div className="font-medium text-gray-900 dark:text-white">
                        ${outcome.price_at_expiry.toFixed(2)}
                      </div>
                    </div>
                  )}
                  {outcome.overshoot_pct !== null && (
                    <div>
                      <div className="text-gray-500 dark:text-gray-400">Overshoot</div>
                      <div className={clsx(
                        'font-medium',
                        outcome.overshoot_pct > 0 ? 'text-green-600' : outcome.overshoot_pct < 0 ? 'text-red-600' : 'text-gray-600'
                      )}>
                        {outcome.overshoot_pct > 0 ? '+' : ''}{outcome.overshoot_pct.toFixed(1)}%
                      </div>
                    </div>
                  )}
                </div>

                {/* Price target reasoning if available */}
                {outcome.price_target?.reasoning && (
                  <div>
                    <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Reasoning</div>
                    <p className="text-sm text-gray-700 dark:text-gray-300">
                      {outcome.price_target.reasoning}
                    </p>
                  </div>
                )}

                {/* Notes */}
                {outcome.notes && (
                  <div>
                    <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Notes</div>
                    <p className="text-sm text-gray-700 dark:text-gray-300">
                      {outcome.notes}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function OutcomesTimeline({
  assetId,
  userId,
  className,
  maxItems = 20
}: OutcomesTimelineProps) {
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')
  const [filterScenario, setFilterScenario] = useState<string>('all')

  const { outcomes, summary, outcomesByScenario, isLoading, error } = useTargetOutcomes({
    assetId,
    userId,
    status: filterStatus === 'all' ? 'all' : filterStatus
  })

  // Get unique scenarios for filter
  const scenarios = useMemo(() => {
    return Object.keys(outcomesByScenario).sort()
  }, [outcomesByScenario])

  // Filter and sort outcomes
  const filteredOutcomes = useMemo(() => {
    let result = outcomes

    if (filterScenario !== 'all') {
      result = result.filter(o => o.scenario_type === filterScenario)
    }

    // Sort by most recent first
    result = [...result].sort((a, b) => {
      const dateA = a.hit_date || a.evaluated_at || a.target_date
      const dateB = b.hit_date || b.evaluated_at || b.target_date
      return new Date(dateB).getTime() - new Date(dateA).getTime()
    })

    return result.slice(0, maxItems)
  }, [outcomes, filterScenario, maxItems])

  if (isLoading) {
    return (
      <div className={clsx('bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-6', className)}>
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex gap-4">
              <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded-full" />
              <div className="flex-1 h-24 bg-gray-200 dark:bg-gray-700 rounded" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={clsx('bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-6', className)}>
        <div className="text-center py-4 text-red-500">
          <AlertTriangle className="w-8 h-8 mx-auto mb-2" />
          <p>Failed to load outcomes</p>
        </div>
      </div>
    )
  }

  return (
    <div className={clsx('bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700', className)}>
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Calendar className="w-5 h-5 text-gray-400" />
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">
                Outcomes Timeline
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {summary.total} total • {summary.hit} hit • {summary.missed} missed • {summary.pending} pending
              </p>
            </div>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3">
            {/* Status filter */}
            <div className="relative">
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
                className="appearance-none pl-8 pr-8 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 cursor-pointer"
              >
                <option value="all">All Status</option>
                <option value="hit">Hit</option>
                <option value="missed">Missed</option>
                <option value="pending">Pending</option>
                <option value="expired">Expired</option>
              </select>
              <Filter className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>

            {/* Scenario filter */}
            {scenarios.length > 1 && (
              <div className="relative">
                <select
                  value={filterScenario}
                  onChange={(e) => setFilterScenario(e.target.value)}
                  className="appearance-none pl-3 pr-8 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 cursor-pointer"
                >
                  <option value="all">All Scenarios</option>
                  {scenarios.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      {summary.hitRate !== null && (
        <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-around text-center">
            <div>
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                {summary.hitRate.toFixed(0)}%
              </div>
              <div className="text-xs text-gray-500">Hit Rate</div>
            </div>
            {summary.avgAccuracy !== null && (
              <div>
                <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {summary.avgAccuracy.toFixed(0)}%
                </div>
                <div className="text-xs text-gray-500">Avg Accuracy</div>
              </div>
            )}
            {summary.avgDaysToHit !== null && (
              <div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white">
                  {summary.avgDaysToHit.toFixed(0)}
                </div>
                <div className="text-xs text-gray-500">Avg Days to Hit</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="p-4">
        {filteredOutcomes.length > 0 ? (
          <div className="space-y-0">
            {filteredOutcomes.map((outcome, index) => (
              <TimelineItem
                key={outcome.id}
                outcome={outcome}
                isLast={index === filteredOutcomes.length - 1}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <Target className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500 dark:text-gray-400">No outcomes found</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
              {filterStatus !== 'all' || filterScenario !== 'all'
                ? 'Try adjusting your filters'
                : 'Price target outcomes will appear here'}
            </p>
          </div>
        )}
      </div>

      {/* Show more indicator */}
      {outcomes.length > maxItems && (
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 text-center">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            Showing {maxItems} of {outcomes.length} outcomes
          </span>
        </div>
      )}
    </div>
  )
}

export default OutcomesTimeline
