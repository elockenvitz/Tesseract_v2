import { useMemo } from 'react'
import { clsx } from 'clsx'
import {
  Trophy,
  Target,
  TrendingUp,
  TrendingDown,
  Users,
  Award,
  ChevronRight
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

interface TeamPerformanceSummaryProps {
  assetId: string
  className?: string
  onNavigateToUser?: (userId: string) => void
}

interface AnalystMetrics {
  userId: string
  userName: string
  hitRate: number | null
  avgAccuracy: number | null
  totalTargets: number
  hitTargets: number
  missedTargets: number
}

// Calculate tier from score
function getTier(score: number | null): { label: string; color: string; bgColor: string } {
  if (score === null) return { label: 'N/A', color: 'text-gray-500', bgColor: 'bg-gray-100' }
  if (score >= 80) return { label: 'Excellent', color: 'text-green-700', bgColor: 'bg-green-100' }
  if (score >= 70) return { label: 'Good', color: 'text-blue-700', bgColor: 'bg-blue-100' }
  if (score >= 60) return { label: 'Average', color: 'text-yellow-700', bgColor: 'bg-yellow-100' }
  return { label: 'Developing', color: 'text-gray-600', bgColor: 'bg-gray-100' }
}

export function TeamPerformanceSummary({
  assetId,
  className,
  onNavigateToUser
}: TeamPerformanceSummaryProps) {
  // Fetch team performance from price_target_outcomes
  const { data, isLoading } = useQuery({
    queryKey: ['team-performance-summary', assetId],
    queryFn: async () => {
      // Get all outcomes for this asset
      const { data: outcomes, error } = await supabase
        .from('price_target_outcomes')
        .select(`
          id,
          user_id,
          status,
          accuracy_pct
        `)
        .eq('asset_id', assetId)

      if (error) throw error

      if (!outcomes || outcomes.length === 0) return null

      // Get user info for analysts with outcomes
      const userIds = [...new Set(outcomes.map(o => o.user_id))]
      const { data: users } = await supabase
        .from('users')
        .select('id, first_name, last_name')
        .in('id', userIds)

      const userMap = new Map(
        (users || []).map(u => [
          u.id,
          `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'Unknown'
        ])
      )

      // Calculate metrics per analyst
      const analystMetrics = new Map<string, AnalystMetrics>()

      for (const outcome of outcomes) {
        const existing = analystMetrics.get(outcome.user_id) || {
          userId: outcome.user_id,
          userName: userMap.get(outcome.user_id) || 'Unknown',
          hitRate: null,
          avgAccuracy: null,
          totalTargets: 0,
          hitTargets: 0,
          missedTargets: 0,
          accuracies: [] as number[]
        }

        existing.totalTargets++
        if (outcome.status === 'hit') existing.hitTargets++
        if (outcome.status === 'missed') existing.missedTargets++
        if (outcome.accuracy_pct !== null) {
          (existing as any).accuracies.push(Number(outcome.accuracy_pct))
        }

        analystMetrics.set(outcome.user_id, existing as any)
      }

      // Calculate final metrics
      const analysts: AnalystMetrics[] = []
      for (const [userId, metrics] of analystMetrics) {
        const resolved = metrics.hitTargets + metrics.missedTargets
        const hitRate = resolved > 0 ? (metrics.hitTargets / resolved) * 100 : null
        const accuracies = (metrics as any).accuracies || []
        const avgAccuracy = accuracies.length > 0
          ? accuracies.reduce((a: number, b: number) => a + b, 0) / accuracies.length
          : null

        analysts.push({
          userId,
          userName: metrics.userName,
          hitRate,
          avgAccuracy,
          totalTargets: metrics.totalTargets,
          hitTargets: metrics.hitTargets,
          missedTargets: metrics.missedTargets
        })
      }

      // Sort by hit rate (best first)
      analysts.sort((a, b) => {
        if (a.hitRate === null) return 1
        if (b.hitRate === null) return -1
        return b.hitRate - a.hitRate
      })

      // Calculate team averages
      const validHitRates = analysts.filter(a => a.hitRate !== null).map(a => a.hitRate!)
      const validAccuracies = analysts.filter(a => a.avgAccuracy !== null).map(a => a.avgAccuracy!)

      const teamHitRate = validHitRates.length > 0
        ? validHitRates.reduce((a, b) => a + b, 0) / validHitRates.length
        : null

      const teamAccuracy = validAccuracies.length > 0
        ? validAccuracies.reduce((a, b) => a + b, 0) / validAccuracies.length
        : null

      const totalTargets = analysts.reduce((sum, a) => sum + a.totalTargets, 0)
      const totalHits = analysts.reduce((sum, a) => sum + a.hitTargets, 0)

      return {
        analysts,
        teamHitRate,
        teamAccuracy,
        totalTargets,
        totalHits,
        totalAnalysts: analysts.length
      }
    },
    enabled: !!assetId,
    staleTime: 5 * 60 * 1000
  })

  if (isLoading) {
    return (
      <div className={clsx('bg-white rounded-lg border border-gray-200 p-4', className)}>
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-200 rounded w-1/3" />
          <div className="h-16 bg-gray-100 rounded" />
        </div>
      </div>
    )
  }

  if (!data || data.totalTargets === 0) {
    return (
      <div className={clsx('bg-white rounded-lg border border-gray-200 p-4', className)}>
        <div className="text-center py-6 text-gray-500">
          <Trophy className="w-8 h-8 mx-auto mb-2 text-gray-400" />
          <p className="text-sm">No performance data yet</p>
          <p className="text-xs mt-1">Track record builds as price targets reach their evaluation date</p>
        </div>
      </div>
    )
  }

  const teamTier = getTier(data.teamHitRate)

  return (
    <div className={clsx('bg-white rounded-lg border border-gray-200', className)}>
      <div className="px-4 py-3 border-b border-gray-100">
        <h4 className="text-sm font-medium text-gray-900 flex items-center gap-2">
          <Trophy className="w-4 h-4 text-yellow-500" />
          Team Track Record
        </h4>
      </div>

      <div className="p-4">
        {/* Team Summary */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            {/* Hit Rate Circle */}
            <div className="relative w-16 h-16">
              <svg className="w-16 h-16 transform -rotate-90">
                <circle
                  cx="32"
                  cy="32"
                  r="28"
                  stroke="currentColor"
                  strokeWidth="6"
                  fill="none"
                  className="text-gray-200"
                />
                <circle
                  cx="32"
                  cy="32"
                  r="28"
                  stroke={data.teamHitRate && data.teamHitRate >= 70 ? '#22c55e' : '#3b82f6'}
                  strokeWidth="6"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={175.9}
                  strokeDashoffset={175.9 - ((data.teamHitRate || 0) / 100) * 175.9}
                  className="transition-all duration-500"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-sm font-bold text-gray-900">
                  {data.teamHitRate?.toFixed(0) || '—'}%
                </span>
              </div>
            </div>

            <div>
              <div className="text-sm font-medium text-gray-900">Team Hit Rate</div>
              <div className="flex items-center gap-2 mt-1">
                <Users className="w-3 h-3 text-gray-400" />
                <span className="text-xs text-gray-500">
                  {data.totalAnalysts} analyst{data.totalAnalysts !== 1 ? 's' : ''} • {data.totalTargets} targets
                </span>
              </div>
            </div>
          </div>

          <div className={clsx('px-3 py-1 rounded-full text-xs font-medium', teamTier.bgColor, teamTier.color)}>
            {teamTier.label}
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="text-center p-2 bg-gray-50 rounded-lg">
            <div className="text-lg font-bold text-green-600">{data.totalHits}</div>
            <div className="text-xs text-gray-500">Hit</div>
          </div>
          <div className="text-center p-2 bg-gray-50 rounded-lg">
            <div className="text-lg font-bold text-red-500">
              {data.totalTargets - data.totalHits - (data.analysts.reduce((s, a) => s + (a.totalTargets - a.hitTargets - a.missedTargets), 0))}
            </div>
            <div className="text-xs text-gray-500">Missed</div>
          </div>
          <div className="text-center p-2 bg-gray-50 rounded-lg">
            <div className="text-lg font-bold text-blue-600">
              {data.teamAccuracy?.toFixed(0) || '—'}%
            </div>
            <div className="text-xs text-gray-500">Avg Accuracy</div>
          </div>
        </div>

        {/* Analyst Leaderboard */}
        {data.analysts.length > 1 && (
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
              Analyst Rankings
            </div>
            <div className="space-y-1">
              {data.analysts.slice(0, 5).map((analyst, index) => (
                <div
                  key={analyst.userId}
                  onClick={() => onNavigateToUser?.(analyst.userId)}
                  className={clsx(
                    'flex items-center justify-between p-2 rounded-lg',
                    onNavigateToUser ? 'cursor-pointer hover:bg-gray-50' : '',
                    index === 0 && analyst.hitRate !== null && 'bg-yellow-50'
                  )}
                >
                  <div className="flex items-center gap-2">
                    {/* Rank Badge */}
                    <div className={clsx(
                      'w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium',
                      index === 0 ? 'bg-yellow-400 text-yellow-900' :
                      index === 1 ? 'bg-gray-300 text-gray-700' :
                      index === 2 ? 'bg-amber-600 text-white' :
                      'bg-gray-100 text-gray-600'
                    )}>
                      {index + 1}
                    </div>

                    <span className="text-sm text-gray-900">{analyst.userName}</span>
                  </div>

                  <div className="flex items-center gap-3 text-xs">
                    <span className={clsx(
                      'font-medium',
                      analyst.hitRate && analyst.hitRate >= 70 ? 'text-green-600' :
                      analyst.hitRate && analyst.hitRate >= 50 ? 'text-blue-600' :
                      'text-gray-600'
                    )}>
                      {analyst.hitRate?.toFixed(0) || '—'}% hit
                    </span>
                    <span className="text-gray-400">
                      {analyst.totalTargets} tgt{analyst.totalTargets !== 1 ? 's' : ''}
                    </span>
                    {onNavigateToUser && (
                      <ChevronRight className="w-3 h-3 text-gray-400" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
