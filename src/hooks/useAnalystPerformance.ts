import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export type PeriodType = 'monthly' | 'quarterly' | 'yearly' | 'all_time'

export interface ScenarioMetrics {
  hit_rate: number | null
  count: number
  avg_accuracy: number | null
}

export interface AnalystPerformance {
  id: string
  user_id: string
  asset_id: string | null
  period_type: PeriodType
  period_start: string
  period_end: string
  total_targets: number
  hit_targets: number
  missed_targets: number
  pending_targets: number
  hit_rate: number | null
  avg_accuracy: number | null
  avg_days_to_hit: number | null
  bullish_bias: number | null
  scenario_breakdown: Record<string, ScenarioMetrics> | null
  overall_score: number | null
  created_at: string
  updated_at: string
  // Joined data
  user?: {
    id: string
    first_name: string | null
    last_name: string | null
    full_name?: string
  }
}

export interface PerformanceLeaderboardEntry {
  userId: string
  userName: string
  hitRate: number
  avgAccuracy: number
  totalTargets: number
  overallScore: number
  rank: number
}

// Helper to compute full name
const getFullName = (user: { first_name?: string | null; last_name?: string | null } | null) => {
  if (!user) return 'Unknown User'
  const parts = [user.first_name, user.last_name].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : 'Unknown User'
}

interface UseAnalystPerformanceOptions {
  userId?: string
  assetId?: string
  periodType?: PeriodType
}

export function useAnalystPerformance({
  userId,
  assetId,
  periodType = 'all_time'
}: UseAnalystPerformanceOptions = {}) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Default to current user if no userId provided
  const targetUserId = userId || user?.id

  // Fetch performance snapshot
  const {
    data: performance,
    isLoading,
    error,
    refetch
  } = useQuery({
    queryKey: ['analyst-performance', targetUserId, assetId, periodType],
    queryFn: async () => {
      if (!targetUserId) return null

      // First try to get existing snapshot
      let query = supabase
        .from('analyst_performance_snapshots')
        .select(`
          *,
          user:users!analyst_performance_snapshots_user_id_fkey(id, first_name, last_name)
        `)
        .eq('user_id', targetUserId)
        .eq('period_type', periodType)

      if (assetId) {
        query = query.eq('asset_id', assetId)
      } else {
        query = query.is('asset_id', null)
      }

      const { data, error } = await query.maybeSingle()

      if (error && error.code !== 'PGRST116') throw error

      // If no snapshot exists, calculate from outcomes
      if (!data) {
        return await calculatePerformanceFromOutcomes(targetUserId, assetId)
      }

      return {
        ...data,
        hit_rate: data.hit_rate ? Number(data.hit_rate) : null,
        avg_accuracy: data.avg_accuracy ? Number(data.avg_accuracy) : null,
        avg_days_to_hit: data.avg_days_to_hit ? Number(data.avg_days_to_hit) : null,
        bullish_bias: data.bullish_bias ? Number(data.bullish_bias) : null,
        overall_score: data.overall_score ? Number(data.overall_score) : null,
        user: data.user ? { ...data.user, full_name: getFullName(data.user) } : undefined
      } as AnalystPerformance
    },
    enabled: !!targetUserId,
    staleTime: 60000, // 1 minute
    gcTime: 5 * 60 * 1000 // 5 minutes
  })

  // Calculate performance directly from outcomes (fallback)
  async function calculatePerformanceFromOutcomes(
    userId: string,
    assetId?: string
  ): Promise<AnalystPerformance | null> {
    let query = supabase
      .from('price_target_outcomes')
      .select('*')
      .eq('user_id', userId)

    if (assetId) {
      query = query.eq('asset_id', assetId)
    }

    const { data: outcomes, error } = await query

    if (error) throw error
    if (!outcomes || outcomes.length === 0) return null

    const total = outcomes.length
    const hit = outcomes.filter(o => o.status === 'hit').length
    const missed = outcomes.filter(o => o.status === 'missed').length
    const pending = outcomes.filter(o => o.status === 'pending').length

    const resolved = hit + missed
    const hitRate = resolved > 0 ? (hit / resolved) * 100 : null

    const accuracies = outcomes
      .filter(o => o.accuracy_pct !== null)
      .map(o => Number(o.accuracy_pct))
    const avgAccuracy = accuracies.length > 0
      ? accuracies.reduce((a, b) => a + b, 0) / accuracies.length
      : null

    const daysToHit = outcomes
      .filter(o => o.days_to_hit !== null)
      .map(o => Number(o.days_to_hit))
    const avgDaysToHit = daysToHit.length > 0
      ? daysToHit.reduce((a, b) => a + b, 0) / daysToHit.length
      : null

    const overshoots = outcomes
      .filter(o => o.overshoot_pct !== null)
      .map(o => Number(o.overshoot_pct))
    const bullishBias = overshoots.length > 0
      ? overshoots.reduce((a, b) => a + b, 0) / overshoots.length
      : null

    // Calculate scenario breakdown
    const scenarioBreakdown: Record<string, ScenarioMetrics> = {}
    const byScenario = outcomes.reduce((acc, o) => {
      const scenario = o.scenario_type || 'Unknown'
      if (!acc[scenario]) acc[scenario] = []
      acc[scenario].push(o)
      return acc
    }, {} as Record<string, typeof outcomes>)

    for (const [scenario, items] of Object.entries(byScenario)) {
      const sHit = items.filter(o => o.status === 'hit').length
      const sMissed = items.filter(o => o.status === 'missed').length
      const sResolved = sHit + sMissed
      const sAccuracies = items
        .filter(o => o.accuracy_pct !== null)
        .map(o => Number(o.accuracy_pct))

      scenarioBreakdown[scenario] = {
        hit_rate: sResolved > 0 ? (sHit / sResolved) * 100 : null,
        count: items.length,
        avg_accuracy: sAccuracies.length > 0
          ? sAccuracies.reduce((a, b) => a + b, 0) / sAccuracies.length
          : null
      }
    }

    // Calculate overall score (weighted combination)
    const overallScore = hitRate !== null && avgAccuracy !== null
      ? hitRate * 0.6 + avgAccuracy * 0.4
      : null

    // Fetch user info
    const { data: userData } = await supabase
      .from('users')
      .select('id, first_name, last_name')
      .eq('id', userId)
      .single()

    return {
      id: '',
      user_id: userId,
      asset_id: assetId || null,
      period_type: 'all_time',
      period_start: '1900-01-01',
      period_end: '2100-12-31',
      total_targets: total,
      hit_targets: hit,
      missed_targets: missed,
      pending_targets: pending,
      hit_rate: hitRate,
      avg_accuracy: avgAccuracy,
      avg_days_to_hit: avgDaysToHit,
      bullish_bias: bullishBias,
      scenario_breakdown: scenarioBreakdown,
      overall_score: overallScore,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      user: userData ? { ...userData, full_name: getFullName(userData) } : undefined
    }
  }

  // Refresh performance snapshot
  const refreshPerformance = useMutation({
    mutationFn: async () => {
      if (!targetUserId) throw new Error('No user ID')

      // Call the database function to update performance
      const { error } = await supabase.rpc('update_analyst_performance', {
        p_user_id: targetUserId,
        p_asset_id: assetId || null
      })

      if (error) {
        // If function doesn't exist, calculate manually
        console.warn('update_analyst_performance function not available:', error)
        return await calculatePerformanceFromOutcomes(targetUserId, assetId)
      }

      return null
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analyst-performance', targetUserId] })
    }
  })

  return {
    performance,
    isLoading,
    error,
    refetch,
    refreshPerformance
  }
}

// Hook for fetching leaderboard across all analysts
interface UsePerformanceLeaderboardOptions {
  assetId?: string
  limit?: number
}

export function usePerformanceLeaderboard({
  assetId,
  limit = 10
}: UsePerformanceLeaderboardOptions = {}) {
  const {
    data: leaderboard,
    isLoading,
    error,
    refetch
  } = useQuery({
    queryKey: ['performance-leaderboard', assetId, limit],
    queryFn: async () => {
      // Get all performance snapshots
      let query = supabase
        .from('analyst_performance_snapshots')
        .select(`
          *,
          user:users!analyst_performance_snapshots_user_id_fkey(id, first_name, last_name)
        `)
        .eq('period_type', 'all_time')
        .not('hit_rate', 'is', null)
        .order('overall_score', { ascending: false, nullsFirst: false })
        .limit(limit)

      if (assetId) {
        query = query.eq('asset_id', assetId)
      } else {
        query = query.is('asset_id', null)
      }

      const { data, error } = await query

      if (error) throw error

      return (data || []).map((entry, index) => ({
        userId: entry.user_id,
        userName: entry.user ? getFullName(entry.user) : 'Unknown',
        hitRate: entry.hit_rate ? Number(entry.hit_rate) : 0,
        avgAccuracy: entry.avg_accuracy ? Number(entry.avg_accuracy) : 0,
        totalTargets: entry.total_targets || 0,
        overallScore: entry.overall_score ? Number(entry.overall_score) : 0,
        rank: index + 1
      })) as PerformanceLeaderboardEntry[]
    },
    staleTime: 60000, // 1 minute
    gcTime: 5 * 60 * 1000 // 5 minutes
  })

  return {
    leaderboard: leaderboard || [],
    isLoading,
    error,
    refetch
  }
}
