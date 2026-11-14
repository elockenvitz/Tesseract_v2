import React from 'react'
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
 * The prefix the expiry list is cached under.
 *
 * Exported so that every writer which can change whether a target is expired
 * names this key through one spelling. The whole point of the lesson learned
 * one table over: a literal repeated at twelve call sites goes green in eleven
 * of them and silently stale in the twelfth.
 */
export const EXPIRED_TARGETS_KEY = ['expired-targets'] as const

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
    queryKey: [...EXPIRED_TARGETS_KEY, user?.id],
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
        queryClient.invalidateQueries({ queryKey: EXPIRED_TARGETS_KEY })
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
 * Run the expiry sweep once per session.
 *
 * ── Why this is a hook of its own ────────────────────────────────────────
 *
 * `check_and_expire_user_targets` is the ONLY thing in this product that ever
 * moves a price target from pending to expired. Verified against production:
 * there is no cron job for it (`cron.job` holds five entries, none of them
 * this), and `useCheckExpiredTargets` had exactly one caller -- a mount
 * effect inside the amber "Price Targets Expired" banner.
 *
 * So the expiry of a horizon was a side effect of rendering the banner that
 * announced it. Removing that banner from the canonical Asset page would have
 * silently stopped targets expiring at all, which is a far worse defect than
 * the duplicate presentation being removed. The sweep is therefore separated
 * from the presentation and kept, and the banner is the only thing that went.
 *
 * ── Once per session, not once per mount ─────────────────────────────────
 *
 * The guard is module scope rather than a ref. The sweep is a read-then-write
 * loop over the caller's pending outcomes; the banner's own ref stopped
 * StrictMode double-invoking ONE instance, and the asset page mounts the
 * price-target container in more than one place. Three expired AMZN targets
 * came back as six notifications the last time two executions overlapped.
 * The database now takes rows with SKIP LOCKED and folds duplicate alerts
 * onto one key, which is where that had to be fixed; this stops the app
 * asking for the same work twice in the first place.
 */
let sweptThisSession = false

export function useExpirySweepOnce() {
  const { checkExpiredTargets } = useCheckExpiredTargets()
  const { user } = useAuth()

  React.useEffect(() => {
    /* No authenticated caller, no sweep: the RPC refuses a user id that is
       not `auth.uid()`, so firing early would only produce a 42501. */
    if (!user?.id || sweptThisSession) return
    sweptThisSession = true
    checkExpiredTargets()
  }, [user?.id])
}

/** Reset the once-per-session guard. For tests, and for nothing else. */
export function resetExpirySweepForTests() {
  sweptThisSession = false
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
