/**
 * AnalystScorecardCard
 *
 * Expanded analyst scorecard showing performance across three dimensions:
 * 1. Price Targets — hit rate, accuracy, scenario breakdown
 * 2. Ratings — directional accuracy of recommendations
 * 3. Decisions — approval rate, executed decision hit rate
 */

import { clsx } from 'clsx'
import {
  Target, TrendingUp, TrendingDown, Award, BarChart3,
  CheckCircle, XCircle, Clock, Minus, ThumbsUp, ThumbsDown,
  Star, ArrowUp, ArrowDown,
} from 'lucide-react'
import { useAnalystScorecard, type AnalystScorecardData } from '../../hooks/useScorecards'

interface AnalystScorecardCardProps {
  userId: string
  compact?: boolean
  anonymize?: boolean
  className?: string
}

function getTier(score: number | null): { label: string; color: string; bgColor: string } {
  if (score === null) return { label: 'N/A', color: 'text-gray-500', bgColor: 'bg-gray-100' }
  if (score >= 90) return { label: 'Elite', color: 'text-purple-700', bgColor: 'bg-purple-100' }
  if (score >= 80) return { label: 'Excellent', color: 'text-green-700', bgColor: 'bg-green-100' }
  if (score >= 70) return { label: 'Good', color: 'text-blue-700', bgColor: 'bg-blue-100' }
  if (score >= 60) return { label: 'Average', color: 'text-yellow-700', bgColor: 'bg-yellow-100' }
  return { label: 'Developing', color: 'text-red-700', bgColor: 'bg-red-100' }
}

function MetricBar({ value, label, color = 'bg-blue-500' }: { value: number | null; label: string; color?: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-gray-500">{label}</span>
        <span className="text-[11px] font-semibold text-gray-900">
          {value != null ? `${value.toFixed(0)}%` : '—'}
        </span>
      </div>
      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={clsx('h-full rounded-full transition-all duration-500', color)}
          style={{ width: `${value || 0}%` }}
        />
      </div>
    </div>
  )
}

function StatPill({ icon: Icon, label, value, iconColor }: {
  icon: React.ElementType
  label: string
  value: string | number
  iconColor?: string
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
      <Icon className={clsx('w-3.5 h-3.5', iconColor || 'text-gray-400')} />
      <div>
        <div className="text-[10px] text-gray-500">{label}</div>
        <div className="text-sm font-semibold text-gray-900">{value}</div>
      </div>
    </div>
  )
}

export function AnalystScorecardCard({
  userId,
  compact = false,
  anonymize = false,
  className,
}: AnalystScorecardCardProps) {
  const { data: scorecard, isLoading, error } = useAnalystScorecard({ userId })

  if (isLoading) {
    return (
      <div className={clsx('bg-white rounded-lg border border-gray-200 p-5', className)}>
        <div className="animate-pulse space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gray-200 rounded-full" />
            <div className="flex-1 space-y-2">
              <div className="h-3 bg-gray-200 rounded w-1/3" />
              <div className="h-4 bg-gray-200 rounded w-1/2" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3].map(i => <div key={i} className="h-14 bg-gray-200 rounded" />)}
          </div>
        </div>
      </div>
    )
  }

  if (error || !scorecard) {
    return (
      <div className={clsx('bg-white rounded-lg border border-gray-200 p-5', className)}>
        <div className="text-center py-6">
          <Target className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No performance data</p>
          <p className="text-[10px] text-gray-400 mt-1">Set price targets and ratings to build a track record</p>
        </div>
      </div>
    )
  }

  const tier = getTier(scorecard.compositeScore)
  const displayName = anonymize ? 'Analyst' : scorecard.userName

  if (compact) {
    return (
      <div className={clsx('bg-white rounded-lg border border-gray-200 p-4', className)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative w-11 h-11">
              <svg className="w-11 h-11 transform -rotate-90">
                <circle cx="22" cy="22" r="18" stroke="currentColor" strokeWidth="4" fill="none" className="text-gray-200" />
                <circle
                  cx="22" cy="22" r="18"
                  stroke={scorecard.compositeScore && scorecard.compositeScore >= 70 ? '#22c55e' : '#3b82f6'}
                  strokeWidth="4" fill="none" strokeLinecap="round"
                  strokeDasharray={113}
                  strokeDashoffset={113 - ((scorecard.compositeScore || 0) / 100) * 113}
                  className="transition-all duration-500"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[10px] font-bold text-gray-900">
                  {scorecard.compositeScore?.toFixed(0) || '—'}
                </span>
              </div>
            </div>
            <div>
              <div className="text-sm font-medium text-gray-900">{displayName}</div>
              <div className="flex items-center gap-2 text-[10px] text-gray-500">
                <span>{scorecard.priceTargets.total} targets</span>
                <span>·</span>
                <span>{scorecard.ratings.totalRated} ratings</span>
                <span>·</span>
                <span className={tier.color}>{tier.label}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            {scorecard.priceTargets.hitRate != null && (
              <div className="text-center">
                <div className="font-semibold text-gray-900">{scorecard.priceTargets.hitRate.toFixed(0)}%</div>
                <div className="text-gray-400">PT Hit</div>
              </div>
            )}
            {scorecard.ratings.directionalHitRate != null && (
              <div className="text-center">
                <div className="font-semibold text-gray-900">{scorecard.ratings.directionalHitRate.toFixed(0)}%</div>
                <div className="text-gray-400">Rating</div>
              </div>
            )}
            {scorecard.decisions.executedHitRate != null && (
              <div className="text-center">
                <div className="font-semibold text-gray-900">{scorecard.decisions.executedHitRate.toFixed(0)}%</div>
                <div className="text-gray-400">Decisions</div>
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
            <Award className="w-5 h-5 text-yellow-500" />
            <div>
              <h3 className="font-semibold text-gray-900">{displayName}</h3>
              <div className="text-[11px] text-gray-400">Analyst Performance</div>
            </div>
          </div>
          <div className={clsx('px-3 py-1 rounded-full text-xs font-medium', tier.bgColor, tier.color)}>
            {tier.label} · {scorecard.compositeScore?.toFixed(0) || '—'}
          </div>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* ── Price Targets ── */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Target className="w-4 h-4 text-blue-500" />
            <span className="text-[12px] font-semibold text-gray-700">Price Targets</span>
            <span className="text-[10px] text-gray-400 ml-auto">{scorecard.priceTargets.total} total</span>
          </div>

          <div className="grid grid-cols-4 gap-2 mb-3">
            <StatPill icon={CheckCircle} label="Hit" value={scorecard.priceTargets.hit} iconColor="text-green-500" />
            <StatPill icon={XCircle} label="Missed" value={scorecard.priceTargets.missed} iconColor="text-red-500" />
            <StatPill icon={Clock} label="Pending" value={scorecard.priceTargets.pending} iconColor="text-amber-500" />
            <StatPill
              icon={scorecard.priceTargets.bullishBias != null && scorecard.priceTargets.bullishBias > 0 ? ArrowUp : scorecard.priceTargets.bullishBias != null && scorecard.priceTargets.bullishBias < 0 ? ArrowDown : Minus}
              label="Bias"
              value={scorecard.priceTargets.bullishBias != null ? `${scorecard.priceTargets.bullishBias > 0 ? '+' : ''}${scorecard.priceTargets.bullishBias.toFixed(1)}%` : '—'}
              iconColor={scorecard.priceTargets.bullishBias != null && scorecard.priceTargets.bullishBias > 0 ? 'text-green-500' : scorecard.priceTargets.bullishBias != null && scorecard.priceTargets.bullishBias < 0 ? 'text-red-500' : 'text-gray-400'}
            />
          </div>

          <div className="space-y-2">
            <MetricBar value={scorecard.priceTargets.hitRate} label="Hit Rate" color="bg-green-500" />
            <MetricBar value={scorecard.priceTargets.avgAccuracy} label="Avg Accuracy" color="bg-blue-500" />
          </div>

          {/* Scenario Breakdown */}
          {scorecard.priceTargets.scenarioBreakdown && Object.keys(scorecard.priceTargets.scenarioBreakdown).length > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {Object.entries(scorecard.priceTargets.scenarioBreakdown).map(([scenario, metrics]) => {
                const isBull = scenario.toLowerCase().includes('bull')
                const isBear = scenario.toLowerCase().includes('bear')
                return (
                  <div
                    key={scenario}
                    className="p-2 rounded border border-gray-100 text-center"
                    style={{ borderLeftWidth: 3, borderLeftColor: isBull ? '#22c55e' : isBear ? '#ef4444' : '#3b82f6' }}
                  >
                    <div className="text-[9px] text-gray-400 uppercase tracking-wide">{scenario}</div>
                    <div className="text-sm font-bold text-gray-900">{metrics.hit_rate?.toFixed(0) || '—'}%</div>
                    <div className="text-[9px] text-gray-400">{metrics.count} targets</div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Ratings Accuracy ── */}
        {scorecard.ratings.totalRated > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Star className="w-4 h-4 text-amber-500" />
              <span className="text-[12px] font-semibold text-gray-700">Ratings Accuracy</span>
              <span className="text-[10px] text-gray-400 ml-auto">{scorecard.ratings.totalRated} rated</span>
            </div>

            <MetricBar value={scorecard.ratings.directionalHitRate} label="Directional Hit Rate" color="bg-amber-500" />

            <div className="flex items-center gap-3 mt-2 text-[11px]">
              <span className="text-green-600 font-medium">
                {scorecard.ratings.directionalCorrect} correct
              </span>
              <span className="text-red-500 font-medium">
                {scorecard.ratings.totalRated - scorecard.ratings.directionalCorrect} wrong
              </span>
            </div>
          </div>
        )}

        {/* ── Decision Outcomes ── */}
        {scorecard.decisions.totalProposed > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 className="w-4 h-4 text-indigo-500" />
              <span className="text-[12px] font-semibold text-gray-700">Decision Outcomes</span>
              <span className="text-[10px] text-gray-400 ml-auto">{scorecard.decisions.totalProposed} proposed</span>
            </div>

            <div className="grid grid-cols-3 gap-2 mb-3">
              <StatPill icon={ThumbsUp} label="Approved" value={scorecard.decisions.approved} iconColor="text-green-500" />
              <StatPill icon={ThumbsDown} label="Rejected" value={scorecard.decisions.rejected} iconColor="text-red-500" />
              <StatPill
                icon={TrendingUp}
                label="Approval Rate"
                value={scorecard.decisions.approvalRate != null ? `${scorecard.decisions.approvalRate.toFixed(0)}%` : '—'}
                iconColor="text-blue-500"
              />
            </div>

            {scorecard.decisions.executedTotal > 0 && (
              <MetricBar
                value={scorecard.decisions.executedHitRate}
                label="Executed Decision Hit Rate"
                color="bg-indigo-500"
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
