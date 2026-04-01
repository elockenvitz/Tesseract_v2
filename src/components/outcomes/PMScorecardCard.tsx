/**
 * PMScorecardCard
 *
 * Portfolio Manager scorecard showing:
 * 1. Execution rate — decisions approved vs actually executed
 * 2. Timing — average lag from decision to execution, delay cost
 * 3. Results — directional hit rate of PM decisions
 */

import { clsx } from 'clsx'
import {
  Briefcase, Timer, TrendingUp, TrendingDown,
  CheckCircle, Clock, AlertCircle, ArrowUpRight, ArrowDownRight,
  Activity, Target,
} from 'lucide-react'
import { usePMScorecard, type PMScorecardData } from '../../hooks/useScorecards'

interface PMScorecardCardProps {
  userId: string
  portfolioId?: string
  compact?: boolean
  className?: string
}

function getTier(hitRate: number | null): { label: string; color: string; bgColor: string } {
  if (hitRate === null) return { label: 'N/A', color: 'text-gray-500', bgColor: 'bg-gray-100' }
  if (hitRate >= 80) return { label: 'Excellent', color: 'text-green-700', bgColor: 'bg-green-100' }
  if (hitRate >= 65) return { label: 'Good', color: 'text-blue-700', bgColor: 'bg-blue-100' }
  if (hitRate >= 50) return { label: 'Average', color: 'text-yellow-700', bgColor: 'bg-yellow-100' }
  return { label: 'Below Avg', color: 'text-red-700', bgColor: 'bg-red-100' }
}

function MetricRow({ label, value, subtext, icon: Icon, iconColor }: {
  label: string
  value: string
  subtext?: string
  icon: React.ElementType
  iconColor?: string
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className={clsx('p-2 rounded-lg bg-gray-50', iconColor || 'text-gray-400')}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1">
        <div className="text-[11px] text-gray-500">{label}</div>
        <div className="text-sm font-semibold text-gray-900">{value}</div>
      </div>
      {subtext && (
        <span className="text-[10px] text-gray-400">{subtext}</span>
      )}
    </div>
  )
}

export function PMScorecardCard({
  userId,
  portfolioId,
  compact = false,
  className,
}: PMScorecardCardProps) {
  const { data: scorecard, isLoading, error } = usePMScorecard({ userId, portfolioId })

  if (isLoading) {
    return (
      <div className={clsx('bg-white rounded-lg border border-gray-200 p-5', className)}>
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-200 rounded w-1/3" />
          <div className="space-y-2">
            {[1, 2, 3].map(i => <div key={i} className="h-10 bg-gray-200 rounded" />)}
          </div>
        </div>
      </div>
    )
  }

  if (error || !scorecard) {
    return (
      <div className={clsx('bg-white rounded-lg border border-gray-200 p-5', className)}>
        <div className="text-center py-6">
          <Briefcase className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No PM performance data</p>
          <p className="text-[10px] text-gray-400 mt-1">Approve decisions to build a track record</p>
        </div>
      </div>
    )
  }

  const tier = getTier(scorecard.directionalHitRate)

  if (compact) {
    return (
      <div className={clsx('bg-white rounded-lg border border-gray-200 p-4', className)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Briefcase className="w-5 h-5 text-violet-500" />
            <div>
              <div className="text-sm font-medium text-gray-900">{scorecard.userName}</div>
              <div className="flex items-center gap-2 text-[10px] text-gray-500">
                {scorecard.portfolioName && <span>{scorecard.portfolioName}</span>}
                <span>{scorecard.totalDecisions} decisions</span>
                <span>·</span>
                <span className={tier.color}>{tier.label}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            <div className="text-center">
              <div className="font-semibold text-gray-900">{scorecard.executionRate?.toFixed(0) || '—'}%</div>
              <div className="text-gray-400">Exec Rate</div>
            </div>
            {scorecard.directionalHitRate != null && (
              <div className="text-center">
                <div className="font-semibold text-gray-900">{scorecard.directionalHitRate.toFixed(0)}%</div>
                <div className="text-gray-400">Hit Rate</div>
              </div>
            )}
            {scorecard.avgExecutionLagDays != null && (
              <div className="text-center">
                <div className="font-semibold text-gray-900">{scorecard.avgExecutionLagDays.toFixed(1)}d</div>
                <div className="text-gray-400">Avg Lag</div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={clsx('bg-white rounded-lg border border-gray-200', className)}>
      {/* Header */}
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Briefcase className="w-5 h-5 text-violet-500" />
            <div>
              <h3 className="font-semibold text-gray-900">{scorecard.userName}</h3>
              <div className="text-[11px] text-gray-400">
                PM Performance{scorecard.portfolioName ? ` · ${scorecard.portfolioName}` : ''}
              </div>
            </div>
          </div>
          <div className={clsx('px-3 py-1 rounded-full text-xs font-medium', tier.bgColor, tier.color)}>
            {tier.label}
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* ── Execution ── */}
        <div>
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Execution</div>
          <div className="grid grid-cols-3 gap-2">
            <div className="p-3 bg-gray-50 rounded-lg text-center">
              <div className="text-lg font-bold text-gray-900">{scorecard.totalDecisions}</div>
              <div className="text-[10px] text-gray-500">Decisions</div>
            </div>
            <div className="p-3 bg-green-50 rounded-lg text-center">
              <div className="text-lg font-bold text-green-700">{scorecard.decisionsExecuted}</div>
              <div className="text-[10px] text-gray-500">Executed</div>
            </div>
            <div className="p-3 bg-amber-50 rounded-lg text-center">
              <div className="text-lg font-bold text-amber-700">{scorecard.decisionsPending}</div>
              <div className="text-[10px] text-gray-500">Pending</div>
            </div>
          </div>

          {scorecard.executionRate != null && (
            <div className="mt-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-gray-500">Execution Rate</span>
                <span className="text-[11px] font-semibold text-gray-900">{scorecard.executionRate.toFixed(0)}%</span>
              </div>
              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                  style={{ width: `${scorecard.executionRate}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* ── Timing ── */}
        <div>
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Timing</div>
          <MetricRow
            icon={Timer}
            label="Average Execution Lag"
            value={scorecard.avgExecutionLagDays != null ? `${scorecard.avgExecutionLagDays.toFixed(1)} days` : '—'}
            iconColor="text-amber-500"
          />
          <MetricRow
            icon={Activity}
            label="Estimated Delay Cost"
            value={scorecard.totalDelayCostBps != null ? `${scorecard.totalDelayCostBps > 0 ? '+' : ''}${scorecard.totalDelayCostBps.toFixed(1)} bps` : '—'}
            subtext="avg per trade"
            iconColor={scorecard.totalDelayCostBps != null && scorecard.totalDelayCostBps > 0 ? 'text-red-500' : 'text-green-500'}
          />
        </div>

        {/* ── Results ── */}
        <div>
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Results</div>
          <div className="flex items-center gap-4 mb-3">
            <div className="flex items-center gap-1.5">
              <ArrowUpRight className="w-4 h-4 text-green-500" />
              <span className="text-sm font-semibold text-green-700">{scorecard.decisionsPositive}</span>
              <span className="text-[10px] text-gray-400">helped</span>
            </div>
            <div className="flex items-center gap-1.5">
              <ArrowDownRight className="w-4 h-4 text-red-500" />
              <span className="text-sm font-semibold text-red-600">{scorecard.decisionsNegative}</span>
              <span className="text-[10px] text-gray-400">hurt</span>
            </div>
          </div>

          {scorecard.directionalHitRate != null && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-gray-500">Directional Hit Rate</span>
                <span className={clsx('text-[11px] font-semibold',
                  scorecard.directionalHitRate >= 60 ? 'text-green-700' : 'text-red-600'
                )}>
                  {scorecard.directionalHitRate.toFixed(0)}%
                </span>
              </div>
              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={clsx(
                    'h-full rounded-full transition-all duration-500',
                    scorecard.directionalHitRate >= 60 ? 'bg-green-500' : 'bg-red-500'
                  )}
                  style={{ width: `${scorecard.directionalHitRate}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
