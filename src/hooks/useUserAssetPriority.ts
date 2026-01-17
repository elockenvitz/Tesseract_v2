import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

// Priority types
export type Priority = 'critical' | 'high' | 'medium' | 'low' | 'none'

// Priority numeric values for averaging
const PRIORITY_VALUES: Record<Priority, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  none: 0
}

// Reverse mapping from numeric to priority
const VALUE_TO_PRIORITY: Record<number, Priority> = {
  4: 'critical',
  3: 'high',
  2: 'medium',
  1: 'low',
  0: 'none'
}

export interface UserAssetPriority {
  id: string
  asset_id: string
  user_id: string
  priority: Priority
  reason: string | null
  created_at: string
  updated_at: string
  user?: {
    id: string
    first_name: string | null
    last_name: string | null
  }
}

export interface FirmPriority {
  priority: Priority
  numericValue: number
  contributorCount: number
  contributors: Array<{
    userId: string
    name: string
    priority: Priority
    isCovering: boolean
  }>
}

/**
 * Calculate firm priority as the average of covering analysts' priorities
 */
function calculateFirmPriority(
  priorities: UserAssetPriority[],
  coveringAnalystIds: Set<string>
): FirmPriority {
  // Filter to only covering analysts
  const coveringPriorities = priorities.filter(p => coveringAnalystIds.has(p.user_id))

  if (coveringPriorities.length === 0) {
    return {
      priority: 'none',
      numericValue: 0,
      contributorCount: 0,
      contributors: []
    }
  }

  // Calculate average
  const sum = coveringPriorities.reduce((acc, p) => acc + PRIORITY_VALUES[p.priority], 0)
  const avg = sum / coveringPriorities.length

  // Round to nearest priority level
  const roundedValue = Math.round(avg)
  const clampedValue = Math.max(0, Math.min(4, roundedValue))

  // Build contributors list
  const contributors = coveringPriorities.map(p => ({
    userId: p.user_id,
    name: p.user ? `${p.user.first_name || ''} ${p.user.last_name || ''}`.trim() || 'Unknown' : 'Unknown',
    priority: p.priority,
    isCovering: true
  }))

  return {
    priority: VALUE_TO_PRIORITY[clampedValue] || 'none',
    numericValue: avg,
    contributorCount: coveringPriorities.length,
    contributors
  }
}

export function useUserAssetPriority(assetId: string | undefined) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch all priorities for this asset (for aggregation)
  const { data: allPriorities = [], isLoading: isLoadingAll } = useQuery({
    queryKey: ['asset-priorities', assetId],
    queryFn: async (): Promise<UserAssetPriority[]> => {
      if (!assetId) return []

      const { data, error } = await supabase
        .from('user_asset_priorities')
        .select(`
          *,
          user:users!user_asset_priorities_user_id_fkey(id, first_name, last_name)
        `)
        .eq('asset_id', assetId)

      if (error) throw error
      return (data || []) as UserAssetPriority[]
    },
    enabled: !!assetId
  })

  // Fetch covering analysts for this asset
  const { data: coveringAnalysts = [] } = useQuery({
    queryKey: ['asset-coverage-ids', assetId],
    queryFn: async () => {
      if (!assetId) return []

      const { data, error } = await supabase
        .from('coverage')
        .select('user_id')
        .eq('asset_id', assetId)
        .eq('is_active', true)

      if (error) throw error
      return (data || []).map(c => c.user_id).filter(Boolean) as string[]
    },
    enabled: !!assetId,
    staleTime: 5 * 60 * 1000 // 5 minutes
  })

  const coveringAnalystIds = new Set(coveringAnalysts)

  // Get current user's priority
  const myPriority = user?.id
    ? allPriorities.find(p => p.user_id === user.id)
    : undefined

  // Calculate firm priority (average of covering analysts)
  const firmPriority = calculateFirmPriority(allPriorities, coveringAnalystIds)

  // Check if current user is a covering analyst
  const isCoveringAnalyst = user?.id ? coveringAnalystIds.has(user.id) : false

  // Mutation to set/update priority
  const setPriorityMutation = useMutation({
    mutationFn: async ({
      priority,
      reason
    }: {
      priority: Priority
      reason?: string
    }) => {
      if (!assetId || !user?.id) throw new Error('Missing asset or user')

      const { data, error } = await supabase
        .from('user_asset_priorities')
        .upsert({
          asset_id: assetId,
          user_id: user.id,
          priority,
          reason: reason || null,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'asset_id,user_id'
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-priorities', assetId] })
    }
  })

  // Mutation to remove priority
  const removePriorityMutation = useMutation({
    mutationFn: async () => {
      if (!assetId || !user?.id) throw new Error('Missing asset or user')

      const { error } = await supabase
        .from('user_asset_priorities')
        .delete()
        .eq('asset_id', assetId)
        .eq('user_id', user.id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-priorities', assetId] })
    }
  })

  return {
    // Current user's priority
    myPriority: myPriority?.priority || null,
    myPriorityReason: myPriority?.reason || null,

    // Firm priority (average of covering analysts)
    firmPriority,

    // All priorities for display
    allPriorities,

    // Covering analyst info
    coveringAnalystIds,
    isCoveringAnalyst,

    // Loading states
    isLoading: isLoadingAll,

    // Mutations
    setPriority: (priority: Priority, reason?: string) =>
      setPriorityMutation.mutateAsync({ priority, reason }),
    removePriority: () => removePriorityMutation.mutateAsync(),

    // Mutation states
    isSaving: setPriorityMutation.isPending,
    isRemoving: removePriorityMutation.isPending
  }
}

/**
 * Hook to get priorities for multiple assets (for tables/lists)
 */
export function useUserAssetPriorities(assetIds: string[]) {
  const { user } = useAuth()

  const { data: priorities = [], isLoading } = useQuery({
    queryKey: ['user-asset-priorities-batch', assetIds.sort().join(','), user?.id],
    queryFn: async () => {
      if (!user?.id || assetIds.length === 0) return []

      const { data, error } = await supabase
        .from('user_asset_priorities')
        .select('asset_id, priority')
        .eq('user_id', user.id)
        .in('asset_id', assetIds)

      if (error) throw error
      return data || []
    },
    enabled: !!user?.id && assetIds.length > 0
  })

  // Create a map for quick lookup
  const priorityMap = new Map(priorities.map(p => [p.asset_id, p.priority as Priority]))

  return {
    getPriority: (assetId: string): Priority | null => priorityMap.get(assetId) || null,
    priorities,
    isLoading
  }
}

/**
 * Hook to get firm priorities for multiple assets (for tables/lists)
 */
export function useFirmAssetPriorities(assetIds: string[]) {
  const { data: allPriorities = [], isLoading: isLoadingPriorities } = useQuery({
    queryKey: ['firm-asset-priorities-batch', assetIds.sort().join(',')],
    queryFn: async () => {
      if (assetIds.length === 0) return []

      const { data, error } = await supabase
        .from('user_asset_priorities')
        .select(`
          asset_id,
          user_id,
          priority
        `)
        .in('asset_id', assetIds)

      if (error) throw error
      return data || []
    },
    enabled: assetIds.length > 0
  })

  // Fetch coverage for all assets
  const { data: allCoverage = [], isLoading: isLoadingCoverage } = useQuery({
    queryKey: ['assets-coverage-batch', assetIds.sort().join(',')],
    queryFn: async () => {
      if (assetIds.length === 0) return []

      const { data, error } = await supabase
        .from('coverage')
        .select('asset_id, user_id')
        .in('asset_id', assetIds)
        .eq('is_active', true)

      if (error) throw error
      return data || []
    },
    enabled: assetIds.length > 0
  })

  // Build coverage map
  const coverageMap = new Map<string, Set<string>>()
  allCoverage.forEach(c => {
    if (!coverageMap.has(c.asset_id)) {
      coverageMap.set(c.asset_id, new Set())
    }
    if (c.user_id) {
      coverageMap.get(c.asset_id)!.add(c.user_id)
    }
  })

  // Group priorities by asset
  const prioritiesByAsset = new Map<string, Array<{ user_id: string; priority: Priority }>>()
  allPriorities.forEach(p => {
    if (!prioritiesByAsset.has(p.asset_id)) {
      prioritiesByAsset.set(p.asset_id, [])
    }
    prioritiesByAsset.get(p.asset_id)!.push({
      user_id: p.user_id,
      priority: p.priority as Priority
    })
  })

  // Calculate firm priority for each asset
  const getFirmPriority = (assetId: string): Priority | null => {
    const assetPriorities = prioritiesByAsset.get(assetId) || []
    const coveringIds = coverageMap.get(assetId) || new Set()

    // Filter to covering analysts only
    const coveringPriorities = assetPriorities.filter(p => coveringIds.has(p.user_id))

    if (coveringPriorities.length === 0) return null

    // Calculate average
    const sum = coveringPriorities.reduce((acc, p) => acc + PRIORITY_VALUES[p.priority], 0)
    const avg = sum / coveringPriorities.length
    const roundedValue = Math.round(avg)
    const clampedValue = Math.max(0, Math.min(4, roundedValue))

    return VALUE_TO_PRIORITY[clampedValue] || 'none'
  }

  return {
    getFirmPriority,
    isLoading: isLoadingPriorities || isLoadingCoverage
  }
}
