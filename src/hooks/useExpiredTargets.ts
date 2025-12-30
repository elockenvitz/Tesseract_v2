import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export interface ExpiredTarget {
  asset_id: string
  asset_name: string
  asset_symbol: string
  scenario_type: string
  expired_price: number
  expired_date: string
  expired_at: string
}

/**
 * Hook to fetch expired price targets that need replacement
 */
export function useExpiredTargets() {
  const { user } = useAuth()

  const {
    data: expiredTargets,
    isLoading,
    error,
    refetch
  } = useQuery({
    queryKey: ['expired-targets', user?.id],
    queryFn: async () => {
      if (!user?.id) return []

      const { data, error } = await supabase
        .rpc('get_user_expired_targets', { p_user_id: user.id })

      if (error) throw error
      return (data || []) as ExpiredTarget[]
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: true
  })

  return {
    expiredTargets: expiredTargets || [],
    hasExpiredTargets: (expiredTargets?.length || 0) > 0,
    expiredCount: expiredTargets?.length || 0,
    isLoading,
    error,
    refetch
  }
}

/**
 * Hook to check and process expired targets for the current user
 * Call this on login or periodically
 */
export function useCheckExpiredTargets() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const checkMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) return 0

      const { data, error } = await supabase
        .rpc('check_and_expire_user_targets', { p_user_id: user.id })

      if (error) throw error
      return data as number
    },
    onSuccess: (expiredCount) => {
      if (expiredCount > 0) {
        // Invalidate queries to refresh data
        queryClient.invalidateQueries({ queryKey: ['expired-targets'] })
        queryClient.invalidateQueries({ queryKey: ['notifications'] })
        queryClient.invalidateQueries({ queryKey: ['price-targets'] })
        queryClient.invalidateQueries({ queryKey: ['analyst-price-targets'] })
      }
    }
  })

  return {
    checkExpiredTargets: checkMutation.mutate,
    isChecking: checkMutation.isPending,
    lastCheckResult: checkMutation.data,
    error: checkMutation.error
  }
}

/**
 * Group expired targets by asset for easier display
 */
export function useExpiredTargetsByAsset() {
  const { expiredTargets, ...rest } = useExpiredTargets()

  const groupedByAsset = expiredTargets.reduce((acc, target) => {
    const key = target.asset_id
    if (!acc[key]) {
      acc[key] = {
        assetId: target.asset_id,
        assetName: target.asset_name,
        assetSymbol: target.asset_symbol,
        scenarios: []
      }
    }
    acc[key].scenarios.push({
      scenarioType: target.scenario_type,
      expiredPrice: target.expired_price,
      expiredDate: target.expired_date,
      expiredAt: target.expired_at
    })
    return acc
  }, {} as Record<string, {
    assetId: string
    assetName: string
    assetSymbol: string
    scenarios: {
      scenarioType: string
      expiredPrice: number
      expiredDate: string
      expiredAt: string
    }[]
  }>)

  return {
    ...rest,
    expiredTargets,
    groupedByAsset: Object.values(groupedByAsset)
  }
}
