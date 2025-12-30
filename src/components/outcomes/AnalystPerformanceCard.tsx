import React from 'react'
import { clsx } from 'clsx'
import {
  Target,
  TrendingUp,
  TrendingDown,
  Clock,
  Award,
  BarChart3,
  ArrowUp,
  ArrowDown,
  Minus,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertCircle
} from 'lucide-react'
import { useAnalystPerformance, PeriodType } from '../../hooks/useAnalystPerformance'

interface AnalystPerformanceCardProps {
  userId?: string // If not provided, shows current user
  assetId?: string // If not provided, shows overall performance
  periodType?: PeriodType
  compact?: boolean
  className?: string
}

// Performance tier calculation
function getPerformanceTier(score: number | null): {
  label: string
  color: string
  bgColor: string
} {
  if (score === null) return { label: 'N/A', color: 'text-gray-500', bgColor: 'bg-gray-100' }
  if (score >= 90) return { label: 'Elite', color: 'text-purple-700', bgColor: 'bg-purple-100' }
  if (score >= 80) return { label: 'Excellent', color: 'text-green-700', bgColor: 'bg-green-100' }
  if (score >= 70) return { label: 'Good', color: 'text-blue-700', bgColor: 'bg-blue-100' }
  if (score >= 60) return { label: 'Average', color: 'text-yellow-700', bgColor: 'bg-yellow-100' }
  return { label: 'Needs Work', color: 'text-red-700', bgColor: 'bg-red-100' }
}

// Circular progress indicator
function CircularProgress({
  value,
  size = 80,
  strokeWidth = 8,
  color = '#3b82f6',
  label,
  sublabel
}: {
  value: number | null
  size?: number
  strokeWidth?: number
  color?: string
  label?: string
  sublabel?: string
}) {
  const radius = (size - strokeWidth) / 2
  const circumference = radius * 2 * Math.PI
  const percent = value !== null ? Math.min(100, Math.max(0, value)) : 0
  const offset = circumference - (percent / 100) * circumference

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="transform -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          fill="none"
          className="text-gray-200 dark:text-gray-700"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-500 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold text-gray-900 dark:text-white">
          {value !== null ? `${value.toFixed(0)}%` : '—'}
        </span>
        {label && (
          <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
        )}
      </div>
    </div>
  )
}

// Stat item component
function StatItem({
  icon: Icon,
  label,
  value,
  subvalue,
  trend,
  iconColor = 'text-gray-400'
}: {
  icon: React.ElementType
  label: string
  value: string | number
  subvalue?: string
  trend?: 'up' | 'down' | 'neutral'
  iconColor?: string
}) {
  return (
    <div className="flex items-start gap-3">
      <div className={clsx('p-2 rounded-lg bg-gray-100 dark:bg-gray-800', iconColor)}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold text-gray-900 dark:text-white">
            {value}
          </span>
          {trend && (
            <span className={clsx(
              'flex items-center text-xs',
              trend === 'up' ? 'text-green-600' : trend === 'down' ? 'text-red-600' : 'text-gray-400'
            )}>
              {trend === 'up' && <ArrowUp className="w-3 h-3" />}
              {trend === 'down' && <ArrowDown className="w-3 h-3" />}
              {trend === 'neutral' && <Minus className="w-3 h-3" />}
            </span>
          )}
        </div>
        {subvalue && (
          <div className="text-xs text-gray-500 dark:text-gray-400">{subvalue}</div>
        )}
      </div>
    </div>
  )
}

export function AnalystPerformanceCard({
  userId,
  assetId,
  periodType = 'all_time',
  compact = false,
  className
}: AnalystPerformanceCardProps) {
  const { performance, isLoading, error, refreshPerformance } = useAnalystPerformance({
    userId,
    assetId,
    periodType
  })

  if (isLoading) {
    return (
      <div className={clsx('bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-6', className)}>
        <div className="animate-pulse space-y-4">
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 bg-gray-200 dark:bg-gray-700 rounded-full" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
              <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 bg-gray-200 dark:bg-gray-700 rounded" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={clsx('bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-6', className)}>
        <div className="text-center py-4 text-red-500">
          <AlertCircle className="w-8 h-8 mx-auto mb-2" />
          <p>Failed to load performance data</p>
        </div>
      </div>
    )
  }

  if (!performance) {
    return (
      <div className={clsx('bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-6', className)}>
        <div className="text-center py-8">
          <Target className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400">No performance data available</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
            Start setting price targets to build your track record
          </p>
        </div>
      </div>
    )
  }

  const tier = getPerformanceTier(performance.overall_score)
  const biasDirection = performance.bullish_bias !== null
    ? performance.bullish_bias > 0 ? 'bullish' : performance.bullish_bias < 0 ? 'bearish' : 'neutral'
    : 'neutral'

  if (compact) {
    return (
      <div className={clsx('bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4', className)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CircularProgress
              value={performance.hit_rate}
              size={48}
              strokeWidth={4}
              color={performance.hit_rate && performance.hit_rate >= 70 ? '#22c55e' : '#3b82f6'}
            />
            <div>
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                {performance.user?.full_name || 'Your Performance'}
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span>{performance.total_targets} targets</span>
                <span>•</span>
                <span className={tier.color}>{tier.label}</span>
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {performance.overall_score?.toFixed(0) || '—'}
            </div>
            <div className="text-xs text-gray-500">Score</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={clsx('bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700', className)}>
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Award className="w-5 h-5 text-yellow-500" />
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">
                {performance.user?.full_name || 'Your Track Record'}
              </h3>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {assetId ? 'Asset Performance' : 'Overall Performance'} • {periodType.replace('_', ' ')}
              </div>
            </div>
          </div>
          <button
            onClick={() => refreshPerformance.mutate()}
            disabled={refreshPerformance.isPending}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title="Refresh performance data"
          >
            <RefreshCw className={clsx('w-4 h-4', refreshPerformance.isPending && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Main Score Section */}
      <div className="p-6">
        <div className="flex items-center gap-6 mb-6">
          {/* Overall Score Circle */}
          <CircularProgress
            value={performance.overall_score}
            size={100}
            strokeWidth={10}
            color={tier.color.replace('text-', '#').replace('-700', '')}
            label="Score"
          />

          {/* Hit Rate & Accuracy */}
          <div className="flex-1 space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-gray-600 dark:text-gray-400">Hit Rate</span>
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  {performance.hit_rate?.toFixed(1) || '—'}%
                </span>
              </div>
              <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded-full transition-all duration-500"
                  style={{ width: `${performance.hit_rate || 0}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-gray-600 dark:text-gray-400">Avg Accuracy</span>
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  {performance.avg_accuracy?.toFixed(1) || '—'}%
                </span>
              </div>
              <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-500"
                  style={{ width: `${performance.avg_accuracy || 0}%` }}
                />
              </div>
            </div>
          </div>

          {/* Tier Badge */}
          <div className={clsx('px-4 py-2 rounded-lg text-center', tier.bgColor)}>
            <div className={clsx('text-lg font-bold', tier.color)}>{tier.label}</div>
            <div className="text-xs text-gray-600 dark:text-gray-400">Performance Tier</div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatItem
            icon={Target}
            label="Total Targets"
            value={performance.total_targets}
            subvalue={`${performance.hit_targets} hit, ${performance.missed_targets} missed`}
            iconColor="text-blue-500"
          />

          <StatItem
            icon={CheckCircle}
            label="Hit Targets"
            value={performance.hit_targets}
            subvalue={`${((performance.hit_targets / Math.max(1, performance.hit_targets + performance.missed_targets)) * 100).toFixed(0)}% of resolved`}
            iconColor="text-green-500"
          />

          <StatItem
            icon={Clock}
            label="Avg Days to Hit"
            value={performance.avg_days_to_hit?.toFixed(0) || '—'}
            subvalue="days average"
            iconColor="text-amber-500"
          />

          <StatItem
            icon={biasDirection === 'bullish' ? TrendingUp : biasDirection === 'bearish' ? TrendingDown : Minus}
            label="Bias"
            value={performance.bullish_bias !== null ? `${performance.bullish_bias > 0 ? '+' : ''}${performance.bullish_bias.toFixed(1)}%` : '—'}
            subvalue={biasDirection === 'bullish' ? 'Bullish tendency' : biasDirection === 'bearish' ? 'Bearish tendency' : 'Neutral'}
            trend={biasDirection === 'bullish' ? 'up' : biasDirection === 'bearish' ? 'down' : 'neutral'}
            iconColor={biasDirection === 'bullish' ? 'text-green-500' : biasDirection === 'bearish' ? 'text-red-500' : 'text-gray-500'}
          />
        </div>
      </div>

      {/* Scenario Breakdown */}
      {performance.scenario_breakdown && Object.keys(performance.scenario_breakdown).length > 0 && (
        <div className="px-6 pb-6">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="w-4 h-4 text-gray-400" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Scenario Breakdown
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {Object.entries(performance.scenario_breakdown).map(([scenario, metrics]) => {
              const isBull = scenario.toLowerCase().includes('bull')
              const isBear = scenario.toLowerCase().includes('bear')
              const color = isBull ? '#22c55e' : isBear ? '#ef4444' : '#3b82f6'

              return (
                <div
                  key={scenario}
                  className="p-3 rounded-lg border border-gray-200 dark:border-gray-700"
                  style={{ borderLeftColor: color, borderLeftWidth: 3 }}
                >
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{scenario}</div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-lg font-bold text-gray-900 dark:text-white">
                      {metrics.hit_rate?.toFixed(0) || '—'}%
                    </span>
                    <span className="text-xs text-gray-500">hit rate</span>
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {metrics.count} targets • {metrics.avg_accuracy?.toFixed(0) || '—'}% avg accuracy
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Pending Targets */}
      {performance.pending_targets > 0 && (
        <div className="px-6 pb-6 border-t border-gray-200 dark:border-gray-700 pt-4">
          <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
            <Clock className="w-4 h-4" />
            <span>{performance.pending_targets} targets still pending evaluation</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default AnalystPerformanceCard
