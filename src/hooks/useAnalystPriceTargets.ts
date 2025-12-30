import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export type TimeframeType = 'preset' | 'date' | 'custom'

export interface AnalystPriceTarget {
  id: string
  asset_id: string
  scenario_id: string
  user_id: string
  price: number
  timeframe: string | null
  timeframe_type: TimeframeType
  target_date: string | null // ISO date string
  is_rolling: boolean
  reasoning: string | null
  probability: number | null
  is_official: boolean
  created_at: string
  updated_at: string
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
    is_default: boolean
  }
  coverage?: {
    role: string | null
    is_active: boolean
  }
}

export interface PriceTargetHistory {
  id: string
  price_target_id: string
  field_name: string
  old_value: string | null
  new_value: string | null
  changed_by: string | null
  changed_at: string
  user?: {
    id: string
    first_name: string | null
    last_name: string | null
    full_name?: string
  }
}

// Helper to compute full name
const getFullName = (user: { first_name?: string | null; last_name?: string | null } | null) => {
  if (!user) return 'Unknown User'
  const parts = [user.first_name, user.last_name].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : 'Unknown User'
}

interface UseAnalystPriceTargetsOptions {
  assetId: string
  scenarioId?: string // Filter by specific scenario
  userId?: string // Filter by specific user
  officialOnly?: boolean // Only show official (covering analyst) targets
}

export function useAnalystPriceTargets({
  assetId,
  scenarioId,
  userId,
  officialOnly = false
}: UseAnalystPriceTargetsOptions) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch price targets
  const {
    data: priceTargets,
    isLoading,
    error,
    refetch
  } = useQuery({
    queryKey: ['analyst-price-targets', assetId, scenarioId, userId, officialOnly],
    queryFn: async () => {
      let query = supabase
        .from('analyst_price_targets')
        .select(`
          *,
          user:users!analyst_price_targets_user_id_fkey(id, first_name, last_name),
          scenario:scenarios!analyst_price_targets_scenario_id_fkey(id, name, color, is_default)
        `)
        .eq('asset_id', assetId)
        .order('updated_at', { ascending: false })

      if (scenarioId) {
        query = query.eq('scenario_id', scenarioId)
      }

      if (userId) {
        query = query.eq('user_id', userId)
      }

      if (officialOnly) {
        query = query.eq('is_official', true)
      }

      const { data, error } = await query

      if (error) throw error

      // Fetch coverage data for each user to get their role
      const userIds = [...new Set((data || []).map(pt => pt.user_id))]
      const { data: coverageData } = await supabase
        .from('coverage')
        .select('user_id, role, is_active')
        .eq('asset_id', assetId)
        .eq('is_active', true)
        .in('user_id', userIds)

      const coverageMap = new Map(
        (coverageData || []).map(c => [c.user_id, { role: c.role, is_active: c.is_active }])
      )

      return (data || []).map(pt => ({
        ...pt,
        price: Number(pt.price),
        probability: pt.probability ? Number(pt.probability) : null,
        // Ensure new timeframe fields have correct types/defaults
        timeframe_type: (pt.timeframe_type || 'preset') as TimeframeType,
        target_date: pt.target_date || null,
        is_rolling: pt.is_rolling === true, // Ensure boolean
        user: pt.user ? { ...pt.user, full_name: getFullName(pt.user) } : undefined,
        coverage: coverageMap.get(pt.user_id)
      })) as AnalystPriceTarget[]
    },
    enabled: !!assetId,
    staleTime: Infinity, // Never refetch automatically
    gcTime: 30 * 60 * 1000
  })

  // Get current user's price targets
  const myPriceTargets = priceTargets?.filter(pt => pt.user_id === user?.id) || []

  // Get other users' price targets
  const otherPriceTargets = priceTargets?.filter(pt => pt.user_id !== user?.id) || []

  // Group price targets by scenario
  const priceTargetsByScenario = (priceTargets || []).reduce((acc, pt) => {
    const scenarioName = pt.scenario?.name || 'Unknown'
    if (!acc[scenarioName]) {
      acc[scenarioName] = []
    }
    acc[scenarioName].push(pt)
    return acc
  }, {} as Record<string, AnalystPriceTarget[]>)

  // Group price targets by user
  const priceTargetsByUser = (priceTargets || []).reduce((acc, pt) => {
    const userId = pt.user_id
    if (!acc[userId]) {
      acc[userId] = []
    }
    acc[userId].push(pt)
    return acc
  }, {} as Record<string, AnalystPriceTarget[]>)

  // Check if user is a covering analyst
  const checkIsCoveringAnalyst = async (checkUserId: string): Promise<boolean> => {
    const { data } = await supabase
      .from('coverage')
      .select('id')
      .eq('asset_id', assetId)
      .eq('user_id', checkUserId)
      .eq('is_active', true)
      .maybeSingle()

    return !!data
  }

  // Save or update a price target
  const savePriceTarget = useMutation({
    mutationFn: async ({
      scenarioId,
      price,
      timeframe,
      timeframeType,
      targetDate,
      isRolling,
      reasoning,
      probability
    }: {
      scenarioId: string
      price: number
      timeframe?: string
      timeframeType?: TimeframeType
      targetDate?: string // ISO date string
      isRolling?: boolean
      reasoning?: string
      probability?: number
    }) => {
      if (!user) throw new Error('Not authenticated')

      // Check if user is a covering analyst
      const isCovering = await checkIsCoveringAnalyst(user.id)

      // Check if target already exists
      const { data: existing } = await supabase
        .from('analyst_price_targets')
        .select('id')
        .eq('scenario_id', scenarioId)
        .eq('user_id', user.id)
        .maybeSingle()

      const targetData = {
        price,
        timeframe: timeframe || '12 months',
        timeframe_type: timeframeType || 'preset',
        target_date: targetDate || null,
        is_rolling: isRolling ?? false,
        reasoning: reasoning || null,
        probability: probability || null,
        is_official: isCovering,
        updated_at: new Date().toISOString()
      }

      if (existing) {
        // Update existing
        const { data, error } = await supabase
          .from('analyst_price_targets')
          .update(targetData)
          .eq('id', existing.id)
          .select(`
            *,
            user:users!analyst_price_targets_user_id_fkey(id, first_name, last_name),
            scenario:scenarios!analyst_price_targets_scenario_id_fkey(id, name, color, is_default)
          `)
          .single()

        if (error) throw error
        return {
          ...data,
          price: Number(data.price),
          user: data.user ? { ...data.user, full_name: getFullName(data.user) } : undefined
        } as AnalystPriceTarget
      } else {
        // Create new
        const { data, error } = await supabase
          .from('analyst_price_targets')
          .insert({
            asset_id: assetId,
            scenario_id: scenarioId,
            user_id: user.id,
            ...targetData
          })
          .select(`
            *,
            user:users!analyst_price_targets_user_id_fkey(id, first_name, last_name),
            scenario:scenarios!analyst_price_targets_scenario_id_fkey(id, name, color, is_default)
          `)
          .single()

        if (error) throw error
        return {
          ...data,
          price: Number(data.price),
          user: data.user ? { ...data.user, full_name: getFullName(data.user) } : undefined
        } as AnalystPriceTarget
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analyst-price-targets', assetId] })
    }
  })

  // Delete a price target
  const deletePriceTarget = useMutation({
    mutationFn: async (priceTargetId: string) => {
      const { error } = await supabase
        .from('analyst_price_targets')
        .delete()
        .eq('id', priceTargetId)
        .eq('user_id', user?.id) // Can only delete own targets

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analyst-price-targets', assetId] })
    }
  })

  // Get price target for specific scenario and user
  const getPriceTarget = (targetScenarioId: string, targetUserId?: string) => {
    const uid = targetUserId || user?.id
    return priceTargets?.find(pt => pt.scenario_id === targetScenarioId && pt.user_id === uid)
  }

  return {
    priceTargets: priceTargets || [],
    myPriceTargets,
    otherPriceTargets,
    priceTargetsByScenario,
    priceTargetsByUser,
    isLoading,
    error,
    refetch,
    savePriceTarget,
    deletePriceTarget,
    getPriceTarget
  }
}

// Hook for fetching price target history
export function usePriceTargetHistory(priceTargetId: string | undefined) {
  const { data: history, isLoading, error } = useQuery({
    queryKey: ['price-target-history', priceTargetId],
    queryFn: async () => {
      if (!priceTargetId) return []

      const { data, error } = await supabase
        .from('analyst_price_target_history')
        .select(`
          *,
          user:users!analyst_price_target_history_changed_by_fkey(id, first_name, last_name)
        `)
        .eq('price_target_id', priceTargetId)
        .order('changed_at', { ascending: false })

      if (error) throw error
      return (data || []).map(h => ({
        ...h,
        user: h.user ? { ...h.user, full_name: getFullName(h.user) } : undefined
      })) as PriceTargetHistory[]
    },
    enabled: !!priceTargetId
  })

  return {
    history: history || [],
    isLoading,
    error
  }
}
