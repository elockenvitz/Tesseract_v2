/**
 * useTradeLabService Hook
 *
 * React hook wrapping the trade lab service for UI components.
 * Provides mutation functions for views and drafts with automatic cache invalidation.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from './useAuth'
import { useToast } from '../components/common/Toast'
import {
  getOrCreateMyDraftsView,
  getViewsForSimulation,
  createSharedView,
  addViewMember,
  removeViewMember,
  getDraftsForSimulation,
  upsertDraft,
  moveDraftToView,
  deleteDraft,
  reorderDrafts,
  linkIdeaToLab,
  unlinkIdeaFromLab,
  getIdeaExpressionCount,
  type TradeLabView,
  type TradeLabViewRole,
  type TradeLabDraftWithDetails,
} from '../lib/services/trade-lab-service'
import type { ActionContext, UISource, TradeAction } from '../types/trading'

interface UseTradeLabServiceOptions {
  simulationId?: string
  onViewCreated?: () => void
  onDraftCreated?: () => void
  onDraftDeleted?: () => void
}

/**
 * Build ActionContext from user and UI source
 */
function buildActionContext(user: any, uiSource?: UISource): ActionContext {
  return {
    actorId: user?.id || '',
    actorName:
      [user?.first_name, user?.last_name].filter(Boolean).join(' ') ||
      user?.email ||
      '',
    actorEmail: user?.email,
    actorRole: (user?.role as 'analyst' | 'pm' | 'admin' | 'system') || 'analyst',
    requestId: crypto.randomUUID(),
    uiSource,
  }
}

export function useTradeLabService(options: UseTradeLabServiceOptions = {}) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const toast = useToast()

  const invalidateQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['trade-lab-views'] })
    queryClient.invalidateQueries({ queryKey: ['trade-lab-drafts'] })
    queryClient.invalidateQueries({ queryKey: ['simulation'] })
    queryClient.invalidateQueries({ queryKey: ['simulations'] })
  }

  // ============================================================
  // Queries
  // ============================================================

  // Get views for a simulation
  const viewsQuery = useQuery({
    queryKey: ['trade-lab-views', options.simulationId],
    queryFn: () =>
      options.simulationId
        ? getViewsForSimulation(options.simulationId)
        : Promise.resolve([]),
    enabled: !!options.simulationId,
  })

  // Get drafts for a simulation
  const draftsQuery = useQuery({
    queryKey: ['trade-lab-drafts', options.simulationId],
    queryFn: () =>
      options.simulationId
        ? getDraftsForSimulation(options.simulationId)
        : Promise.resolve([]),
    enabled: !!options.simulationId,
  })

  // ============================================================
  // Mutations
  // ============================================================

  // Get or create My Drafts view
  const ensureMyDraftsM = useMutation({
    mutationFn: async (simulationId: string) => {
      if (!user?.id) throw new Error('Not authenticated')
      return getOrCreateMyDraftsView(simulationId, user.id)
    },
    onSuccess: () => {
      invalidateQueries()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to create My Drafts view'
      )
    },
  })

  // Create shared view
  const createViewM = useMutation({
    mutationFn: async (params: {
      simulationId: string
      name: string
      description?: string
      members?: Array<{ userId: string; role: TradeLabViewRole }>
      uiSource?: UISource
    }) => {
      if (!user?.id) throw new Error('Not authenticated')
      return createSharedView({
        simulationId: params.simulationId,
        viewType: 'shared',
        name: params.name,
        description: params.description,
        members: params.members,
        context: buildActionContext(user, params.uiSource),
      })
    },
    onSuccess: () => {
      invalidateQueries()
      toast.success('View created')
      options.onViewCreated?.()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create view')
    },
  })

  // Add member to view
  const addMemberM = useMutation({
    mutationFn: async (params: {
      viewId: string
      userId: string
      role: TradeLabViewRole
      uiSource?: UISource
    }) => {
      if (!user?.id) throw new Error('Not authenticated')
      await addViewMember(
        params.viewId,
        params.userId,
        params.role,
        buildActionContext(user, params.uiSource)
      )
    },
    onSuccess: () => {
      invalidateQueries()
      toast.success('Member added')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to add member')
    },
  })

  // Remove member from view
  const removeMemberM = useMutation({
    mutationFn: async (params: {
      viewId: string
      userId: string
      uiSource?: UISource
    }) => {
      if (!user?.id) throw new Error('Not authenticated')
      await removeViewMember(
        params.viewId,
        params.userId,
        buildActionContext(user, params.uiSource)
      )
    },
    onSuccess: () => {
      invalidateQueries()
      toast.success('Member removed')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to remove member')
    },
  })

  // Upsert draft (create or update)
  const upsertDraftM = useMutation({
    mutationFn: async (params: {
      id?: string
      simulationId: string
      viewId?: string | null
      tradeQueueItemId?: string | null
      assetId: string
      action: TradeAction
      shares?: number | null
      weight?: number | null
      price?: number | null
      sortOrder?: number
      uiSource?: UISource
    }) => {
      if (!user?.id) throw new Error('Not authenticated')
      return upsertDraft({
        ...params,
        context: buildActionContext(user, params.uiSource),
      })
    },
    onSuccess: (data, variables) => {
      invalidateQueries()
      if (!variables.id) {
        // Only show toast for new drafts, not autosave updates
        options.onDraftCreated?.()
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to save draft')
    },
  })

  // Move draft to view
  const moveDraftM = useMutation({
    mutationFn: async (params: {
      draftId: string
      targetViewId: string
      uiSource?: UISource
    }) => {
      if (!user?.id) throw new Error('Not authenticated')
      await moveDraftToView({
        draftId: params.draftId,
        targetViewId: params.targetViewId,
        context: buildActionContext(user, params.uiSource),
      })
    },
    onSuccess: () => {
      invalidateQueries()
      toast.success('Draft moved')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to move draft')
    },
  })

  // Delete draft
  const deleteDraftM = useMutation({
    mutationFn: async (params: { draftId: string; uiSource?: UISource }) => {
      if (!user?.id) throw new Error('Not authenticated')
      await deleteDraft(params.draftId, buildActionContext(user, params.uiSource))
    },
    onSuccess: () => {
      invalidateQueries()
      options.onDraftDeleted?.()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete draft')
    },
  })

  // Reorder drafts
  const reorderDraftsM = useMutation({
    mutationFn: async (params: {
      simulationId: string
      viewId: string | null
      orderedDraftIds: string[]
      uiSource?: UISource
    }) => {
      if (!user?.id) throw new Error('Not authenticated')
      await reorderDrafts(
        params.simulationId,
        params.viewId,
        params.orderedDraftIds,
        buildActionContext(user, params.uiSource)
      )
    },
    onSuccess: () => {
      invalidateQueries()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to reorder drafts')
    },
  })

  // Link idea to lab
  const linkIdeaM = useMutation({
    mutationFn: async (params: {
      simulationId: string
      tradeQueueItemId: string
      uiSource?: UISource
    }) => {
      if (!user?.id) throw new Error('Not authenticated')
      await linkIdeaToLab(
        params.simulationId,
        params.tradeQueueItemId,
        buildActionContext(user, params.uiSource)
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-expression-counts'] })
      queryClient.invalidateQueries({ queryKey: ['simulation-included-ideas'] })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to link idea')
    },
  })

  // Unlink idea from lab
  const unlinkIdeaM = useMutation({
    mutationFn: async (params: {
      simulationId: string
      tradeQueueItemId: string
      uiSource?: UISource
    }) => {
      if (!user?.id) throw new Error('Not authenticated')
      await unlinkIdeaFromLab(
        params.simulationId,
        params.tradeQueueItemId,
        buildActionContext(user, params.uiSource)
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-expression-counts'] })
      queryClient.invalidateQueries({ queryKey: ['simulation-included-ideas'] })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to unlink idea')
    },
  })

  return {
    // Queries
    views: viewsQuery.data || [],
    isLoadingViews: viewsQuery.isLoading,
    drafts: draftsQuery.data || [],
    isLoadingDrafts: draftsQuery.isLoading,
    refetchViews: viewsQuery.refetch,
    refetchDrafts: draftsQuery.refetch,

    // View mutations
    ensureMyDrafts: ensureMyDraftsM.mutate,
    ensureMyDraftsAsync: ensureMyDraftsM.mutateAsync,

    createView: createViewM.mutate,
    createViewAsync: createViewM.mutateAsync,
    isCreatingView: createViewM.isPending,

    addMember: addMemberM.mutate,
    removeMember: removeMemberM.mutate,

    // Draft mutations
    upsertDraft: upsertDraftM.mutate,
    upsertDraftAsync: upsertDraftM.mutateAsync,
    isSavingDraft: upsertDraftM.isPending,

    moveDraft: moveDraftM.mutate,
    isMovingDraft: moveDraftM.isPending,

    deleteDraft: deleteDraftM.mutate,
    isDeletingDraft: deleteDraftM.isPending,

    reorderDrafts: reorderDraftsM.mutate,

    // Idea links
    linkIdea: linkIdeaM.mutate,
    unlinkIdea: unlinkIdeaM.mutate,

    // Combined loading state
    isLoading:
      viewsQuery.isLoading ||
      draftsQuery.isLoading ||
      createViewM.isPending ||
      upsertDraftM.isPending ||
      moveDraftM.isPending ||
      deleteDraftM.isPending,
  }
}

/**
 * Hook for getting expression count for a trade idea
 */
export function useIdeaExpressionCount(tradeQueueItemId: string | undefined) {
  return useQuery({
    queryKey: ['idea-expression-count', tradeQueueItemId],
    queryFn: () =>
      tradeQueueItemId
        ? getIdeaExpressionCount(tradeQueueItemId)
        : Promise.resolve({ count: 0, labNames: [] }),
    enabled: !!tradeQueueItemId,
    staleTime: 30000,
  })
}
