/**
 * useSimulationShare Hook
 *
 * React hook wrapping the simulation share service for UI components.
 * Provides queries and mutations for sharing simulations with other users.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from './useAuth'
import { useToast } from '../components/common/Toast'
import {
  shareSimulation,
  revokeShare,
  updateShareAccess,
  getSharedWithMe,
  getMyShares,
  checkShareAccess,
  getSharedSimulation,
  type SimulationShareAccess,
  type SimulationShareMode,
  type SharedSimulationListItem,
} from '../lib/services/simulation-share-service'

interface UseSimulationShareOptions {
  onShareCreated?: () => void
  onShareRevoked?: () => void
}

export function useSimulationShare(options: UseSimulationShareOptions = {}) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const toast = useToast()

  const invalidateQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['shared-with-me'] })
    queryClient.invalidateQueries({ queryKey: ['my-shares'] })
    queryClient.invalidateQueries({ queryKey: ['simulation-share-access'] })
  }

  // ============================================================
  // Queries
  // ============================================================

  // Get simulations shared with me
  const sharedWithMeQuery = useQuery({
    queryKey: ['shared-with-me', user?.id],
    queryFn: () => (user?.id ? getSharedWithMe(user.id) : Promise.resolve([])),
    enabled: !!user?.id,
  })

  // Get shares I've created
  const mySharesQuery = useQuery({
    queryKey: ['my-shares', user?.id],
    queryFn: () => (user?.id ? getMyShares(user.id) : Promise.resolve([])),
    enabled: !!user?.id,
  })

  // ============================================================
  // Mutations
  // ============================================================

  // Share a simulation
  const shareMutation = useMutation({
    mutationFn: async (params: {
      simulationId: string
      recipientIds: string[]
      accessLevel: SimulationShareAccess
      shareMode: SimulationShareMode
      message?: string
    }) => {
      if (!user?.id) throw new Error('Not authenticated')
      return shareSimulation({
        ...params,
        actorId: user.id,
      })
    },
    onSuccess: (_, variables) => {
      invalidateQueries()
      const count = variables.recipientIds.length
      toast.success(
        `Simulation shared with ${count} ${count === 1 ? 'person' : 'people'}`
      )
      options.onShareCreated?.()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to share simulation'
      )
    },
  })

  // Revoke a share
  const revokeMutation = useMutation({
    mutationFn: async (shareId: string) => {
      if (!user?.id) throw new Error('Not authenticated')
      return revokeShare({ shareId, actorId: user.id })
    },
    onSuccess: () => {
      invalidateQueries()
      toast.success('Access revoked')
      options.onShareRevoked?.()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to revoke access'
      )
    },
  })

  // Update share access level
  const updateAccessMutation = useMutation({
    mutationFn: async (params: {
      shareId: string
      accessLevel: SimulationShareAccess
    }) => {
      if (!user?.id) throw new Error('Not authenticated')
      return updateShareAccess({
        ...params,
        actorId: user.id,
      })
    },
    onSuccess: () => {
      invalidateQueries()
      toast.success('Access level updated')
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to update access'
      )
    },
  })

  return {
    // Queries
    sharedWithMe: sharedWithMeQuery.data || [],
    isLoadingSharedWithMe: sharedWithMeQuery.isLoading,
    refetchSharedWithMe: sharedWithMeQuery.refetch,

    myShares: mySharesQuery.data || [],
    isLoadingMyShares: mySharesQuery.isLoading,
    refetchMyShares: mySharesQuery.refetch,

    // Mutations
    shareSimulation: shareMutation.mutate,
    shareSimulationAsync: shareMutation.mutateAsync,
    isSharing: shareMutation.isPending,

    revokeShare: revokeMutation.mutate,
    revokeShareAsync: revokeMutation.mutateAsync,
    isRevoking: revokeMutation.isPending,

    updateShareAccess: updateAccessMutation.mutate,
    isUpdatingAccess: updateAccessMutation.isPending,

    // Combined loading state
    isLoading:
      sharedWithMeQuery.isLoading ||
      mySharesQuery.isLoading ||
      shareMutation.isPending ||
      revokeMutation.isPending,
  }
}

/**
 * Hook to check if user has share access to a specific simulation
 */
export function useSimulationShareAccess(simulationId: string | undefined) {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['simulation-share-access', simulationId, user?.id],
    queryFn: () =>
      simulationId && user?.id
        ? checkShareAccess(simulationId, user.id)
        : Promise.resolve({ hasAccess: false, accessLevel: null, shareMode: null }),
    enabled: !!simulationId && !!user?.id,
    staleTime: 60000, // 1 minute
  })
}

/**
 * Hook to get a specific shared simulation by share ID
 */
export function useSharedSimulation(shareId: string | undefined) {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['shared-simulation', shareId, user?.id],
    queryFn: () =>
      shareId && user?.id
        ? getSharedSimulation(shareId, user.id)
        : Promise.resolve(null),
    enabled: !!shareId && !!user?.id,
  })
}

// Re-export types for convenience
export type { SimulationShareAccess, SimulationShareMode, SharedSimulationListItem }
