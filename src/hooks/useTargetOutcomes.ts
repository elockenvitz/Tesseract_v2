import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export type OutcomeStatus = 'pending' | 'hit' | 'missed' | 'expired' | 'cancelled'

export interface TargetOutcome {
  id: string
  price_target_id: string
  asset_id: string
  user_id: string
  scenario_id: string | null
  target_price: number
  target_date: string
  target_set_date: string
  scenario_type: string | null
  status: OutcomeStatus
  hit_date: string | null
  hit_price: number | null
  price_at_expiry: number | null
  accuracy_pct: number | null
  days_to_hit: number | null
  overshoot_pct: number | null
  evaluated_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
  // Joined data
  user?: {
    id: string
    first_name: string | null
    last_name: string | null
    full_name?: string
  }
  scenario?: {
    id: string
    name: string
    color: string | null
  }
  price_target?: {
    id: string
    price: number
    timeframe: string | null
    reasoning: string | null
  }
}

export interface OutcomeSummary {
  total: number
  pending: number
  hit: number
  missed: number
  expired: number
  hitRate: number | null
  avgAccuracy: number | null
  avgDaysToHit: number | null
}

// Helper to compute full name
const getFullName = (user: { first_name?: string | null; last_name?: string | null } | null) => {
  if (!user) return 'Unknown User'
  const parts = [user.first_name, user.last_name].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : 'Unknown User'
}

interface UseTargetOutcomesOptions {
  assetId: string
  userId?: string
  status?: OutcomeStatus | 'all'
  scenarioType?: string
}

export function useTargetOutcomes({
  assetId,
  userId,
  status = 'all',
  scenarioType
}: UseTargetOutcomesOptions) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch outcomes
  const {
    data: outcomes,
    isLoading,
    error,
    refetch
  } = useQuery({
    queryKey: ['target-outcomes', assetId, userId, status, scenarioType],
    queryFn: async () => {
      let query = supabase
        .from('price_target_outcomes')
        .select(`
          *,
          user:users!price_target_outcomes_user_id_fkey(id, first_name, last_name),
          scenario:scenarios!price_target_outcomes_scenario_id_fkey(id, name, color),
          price_target:analyst_price_targets!price_target_outcomes_price_target_id_fkey(id, price, timeframe, reasoning)
        `)
        .eq('asset_id', assetId)
        .order('target_date', { ascending: false })

      if (userId) {
        query = query.eq('user_id', userId)
      }

      if (status !== 'all') {
        query = query.eq('status', status)
      }

      if (scenarioType) {
        query = query.eq('scenario_type', scenarioType)
      }

      const { data, error } = await query

      if (error) throw error

      return (data || []).map(o => ({
        ...o,
        target_price: Number(o.target_price),
        hit_price: o.hit_price ? Number(o.hit_price) : null,
        price_at_expiry: o.price_at_expiry ? Number(o.price_at_expiry) : null,
        accuracy_pct: o.accuracy_pct ? Number(o.accuracy_pct) : null,
        overshoot_pct: o.overshoot_pct ? Number(o.overshoot_pct) : null,
        user: o.user ? { ...o.user, full_name: getFullName(o.user) } : undefined
      })) as TargetOutcome[]
    },
    enabled: !!assetId,
    staleTime: 30000, // 30 seconds
    gcTime: 5 * 60 * 1000 // 5 minutes
  })

  // Calculate summary statistics
  const summary: OutcomeSummary = {
    total: outcomes?.length || 0,
    pending: outcomes?.filter(o => o.status === 'pending').length || 0,
    hit: outcomes?.filter(o => o.status === 'hit').length || 0,
    missed: outcomes?.filter(o => o.status === 'missed').length || 0,
    expired: outcomes?.filter(o => o.status === 'expired').length || 0,
    hitRate: null,
    avgAccuracy: null,
    avgDaysToHit: null
  }

  // Calculate hit rate (hit / (hit + missed))
  const resolved = summary.hit + summary.missed
  if (resolved > 0) {
    summary.hitRate = (summary.hit / resolved) * 100
  }

  // Calculate average accuracy for resolved outcomes
  const accuracies = outcomes?.filter(o => o.accuracy_pct !== null).map(o => o.accuracy_pct!) || []
  if (accuracies.length > 0) {
    summary.avgAccuracy = accuracies.reduce((a, b) => a + b, 0) / accuracies.length
  }

  // Calculate average days to hit
  const daysToHit = outcomes?.filter(o => o.days_to_hit !== null).map(o => o.days_to_hit!) || []
  if (daysToHit.length > 0) {
    summary.avgDaysToHit = daysToHit.reduce((a, b) => a + b, 0) / daysToHit.length
  }

  // Update outcome status manually
  const updateOutcome = useMutation({
    mutationFn: async ({
      outcomeId,
      status,
      hitDate,
      hitPrice,
      priceAtExpiry,
      notes
    }: {
      outcomeId: string
      status: OutcomeStatus
      hitDate?: string
      hitPrice?: number
      priceAtExpiry?: number
      notes?: string
    }) => {
      // Calculate accuracy if we have hit price
      let accuracy: number | null = null
      let overshoot: number | null = null
      let daysToHit: number | null = null

      const outcome = outcomes?.find(o => o.id === outcomeId)
      if (outcome && hitPrice !== undefined) {
        const pctDiff = Math.abs(outcome.target_price - hitPrice) / outcome.target_price * 100
        accuracy = Math.max(0, 100 - pctDiff)
        overshoot = ((hitPrice - outcome.target_price) / outcome.target_price) * 100
      }

      if (outcome && hitDate) {
        const setDate = new Date(outcome.target_set_date)
        const achieveDate = new Date(hitDate)
        daysToHit = Math.floor((achieveDate.getTime() - setDate.getTime()) / (1000 * 60 * 60 * 24))
      }

      const { data, error } = await supabase
        .from('price_target_outcomes')
        .update({
          status,
          hit_date: hitDate || null,
          hit_price: hitPrice || null,
          price_at_expiry: priceAtExpiry || null,
          accuracy_pct: accuracy,
          overshoot_pct: overshoot,
          days_to_hit: daysToHit,
          notes: notes || null,
          evaluated_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', outcomeId)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['target-outcomes', assetId] })
      queryClient.invalidateQueries({ queryKey: ['analyst-performance'] })
    }
  })

  // Evaluate outcome against current price
  const evaluateOutcome = useMutation({
    mutationFn: async ({
      outcomeId,
      currentPrice,
      currentDate = new Date().toISOString().split('T')[0]
    }: {
      outcomeId: string
      currentPrice: number
      currentDate?: string
    }) => {
      const outcome = outcomes?.find(o => o.id === outcomeId)
      if (!outcome) throw new Error('Outcome not found')

      const targetDate = new Date(outcome.target_date)
      const today = new Date(currentDate)

      // Determine if target was hit
      // For Bull/Base: hit if current price >= target
      // For Bear: hit if current price <= target
      const isBearish = outcome.scenario_type?.toLowerCase() === 'bear'
      const isHit = isBearish
        ? currentPrice <= outcome.target_price
        : currentPrice >= outcome.target_price

      let newStatus: OutcomeStatus = outcome.status

      if (outcome.status === 'pending') {
        if (isHit) {
          newStatus = 'hit'
        } else if (today >= targetDate) {
          newStatus = 'expired'
        }
      }

      // Calculate metrics
      const pctDiff = Math.abs(outcome.target_price - currentPrice) / outcome.target_price * 100
      const accuracy = Math.max(0, 100 - pctDiff)
      const overshoot = ((currentPrice - outcome.target_price) / outcome.target_price) * 100

      const setDate = new Date(outcome.target_set_date)
      const daysElapsed = Math.floor((today.getTime() - setDate.getTime()) / (1000 * 60 * 60 * 24))

      const updateData: any = {
        evaluated_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      if (newStatus !== outcome.status) {
        updateData.status = newStatus
        if (newStatus === 'hit') {
          updateData.hit_date = currentDate
          updateData.hit_price = currentPrice
          updateData.accuracy_pct = accuracy
          updateData.overshoot_pct = overshoot
          updateData.days_to_hit = daysElapsed
        } else if (newStatus === 'expired') {
          updateData.price_at_expiry = currentPrice
          updateData.accuracy_pct = accuracy
          updateData.overshoot_pct = overshoot
        }
      }

      const { data, error } = await supabase
        .from('price_target_outcomes')
        .update(updateData)
        .eq('id', outcomeId)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['target-outcomes', assetId] })
      queryClient.invalidateQueries({ queryKey: ['analyst-performance'] })
    }
  })

  // Group outcomes by user
  const outcomesByUser = (outcomes || []).reduce((acc, o) => {
    const userId = o.user_id
    if (!acc[userId]) {
      acc[userId] = []
    }
    acc[userId].push(o)
    return acc
  }, {} as Record<string, TargetOutcome[]>)

  // Group outcomes by scenario
  const outcomesByScenario = (outcomes || []).reduce((acc, o) => {
    const scenario = o.scenario_type || 'Unknown'
    if (!acc[scenario]) {
      acc[scenario] = []
    }
    acc[scenario].push(o)
    return acc
  }, {} as Record<string, TargetOutcome[]>)

  return {
    outcomes: outcomes || [],
    summary,
    outcomesByUser,
    outcomesByScenario,
    isLoading,
    error,
    refetch,
    updateOutcome,
    evaluateOutcome
  }
}
