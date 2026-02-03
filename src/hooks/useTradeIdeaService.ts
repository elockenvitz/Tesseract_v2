/**
 * useTradeIdeaService Hook
 *
 * React hook wrapping the trade idea service for UI components.
 * Provides mutation functions with automatic cache invalidation.
 *
 * Uses the new stage/outcome/visibility_tier model:
 * - Stage: idea → discussing → simulating → deciding
 * - Outcome: executed | rejected | deferred (only in deciding stage)
 * - Visibility: active | trash | archive
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from './useAuth'
import { useToast } from '../components/common/Toast'
import {
  moveTradeIdea,
  deleteTradeIdea,
  restoreTradeIdea,
  archiveTradeIdea,
  bulkMoveTradeIdeas,
  movePairTrade as movePairTradeService,
  createTradeIdea,
  createPairTrade as createPairTradeService,
  updateTradeIdea,
  // Legacy exports for backwards compatibility
  moveTrade as moveTradeL,
  deleteTrade as deleteTradeL,
  restoreTrade as restoreTradeL,
} from '../lib/services/trade-idea-service'
import type {
  TradeQueueStatus,
  TradeStage,
  TradeOutcome,
  ActionContext,
  MoveTarget,
  UISource,
} from '../types/trading'

interface UseTradeIdeaServiceOptions {
  onMoveSuccess?: () => void
  onDeleteSuccess?: () => void
  onRestoreSuccess?: () => void
  onArchiveSuccess?: () => void
  onCreateSuccess?: () => void
  onCreatePairTradeSuccess?: () => void
  onUpdateSuccess?: () => void
}

/**
 * Build ActionContext from user and UI source
 */
function buildActionContext(
  user: any,
  uiSource?: UISource
): ActionContext {
  return {
    actorId: user?.id || '',
    actorName: [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.email || '',
    actorEmail: user?.email,
    actorRole: (user?.role as 'analyst' | 'pm' | 'admin' | 'system') || 'analyst',
    requestId: crypto.randomUUID(),
    uiSource,
  }
}

/**
 * Map legacy status to new stage/outcome
 */
function statusToTarget(status: TradeQueueStatus): MoveTarget {
  switch (status) {
    case 'executed':
    case 'approved':
      return { stage: 'deciding', outcome: 'executed' }
    case 'rejected':
      return { stage: 'deciding', outcome: 'rejected' }
    case 'cancelled':
      return { stage: 'deciding', outcome: 'deferred' }
    case 'deleted':
      throw new Error('Use deleteTradeIdea instead')
    default:
      return { stage: status as TradeStage }
  }
}

export function useTradeIdeaService(options: UseTradeIdeaServiceOptions = {}) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const toast = useToast()

  const invalidateQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
    queryClient.invalidateQueries({ queryKey: ['trade-detail'] })
    queryClient.invalidateQueries({ queryKey: ['pair-trades'] })
    queryClient.invalidateQueries({ queryKey: ['audit-events'] })
  }

  // Move trade mutation - supports both legacy status and new stage/outcome
  const moveTradeM = useMutation({
    mutationFn: async (params: {
      tradeId: string
      // New API: stage + optional outcome
      stage?: TradeStage
      outcome?: TradeOutcome
      // Legacy API: targetStatus (backwards compatible)
      targetStatus?: TradeQueueStatus
      uiSource?: UISource
      note?: string
    }) => {
      if (!user?.id) throw new Error('Not authenticated')

      const context = buildActionContext(user, params.uiSource)

      // Determine target from params
      let target: MoveTarget
      if (params.stage) {
        // New API
        target = { stage: params.stage, outcome: params.outcome }
      } else if (params.targetStatus) {
        // Legacy API
        target = statusToTarget(params.targetStatus)
      } else {
        throw new Error('Must provide either stage or targetStatus')
      }

      await moveTradeIdea({
        tradeId: params.tradeId,
        target,
        context,
        note: params.note,
      })
    },
    // Optimistic update for instant UI feedback
    onMutate: async (params) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['trade-queue-items'] })

      // Snapshot previous value
      const previousItems = queryClient.getQueryData(['trade-queue-items'])

      // Determine new status
      const newStatus = params.targetStatus || params.stage

      // Optimistically update the cache
      queryClient.setQueriesData({ queryKey: ['trade-queue-items'] }, (old: any) => {
        if (!old) return old
        return old.map((item: any) =>
          item.id === params.tradeId
            ? { ...item, status: newStatus, workflow_stage: params.stage || newStatus }
            : item
        )
      })

      return { previousItems }
    },
    onError: (error, params, context) => {
      // Rollback on error
      if (context?.previousItems) {
        queryClient.setQueryData(['trade-queue-items'], context.previousItems)
      }
      toast.error(error instanceof Error ? error.message : 'Failed to move trade')
    },
    onSettled: () => {
      // Always refetch after error or success to ensure consistency
      invalidateQueries()
      options.onMoveSuccess?.()
    },
  })

  // Delete trade mutation
  const deleteTradeM = useMutation({
    mutationFn: async (params: {
      tradeId: string
      reason?: string
      uiSource?: UISource
    }) => {
      if (!user?.id) throw new Error('Not authenticated')

      await deleteTradeIdea({
        tradeId: params.tradeId,
        context: buildActionContext(user, params.uiSource),
        reason: params.reason,
      })
    },
    onSuccess: () => {
      invalidateQueries()
      toast.success('Trade moved to trash')
      options.onDeleteSuccess?.()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete trade')
    },
  })

  // Restore trade mutation
  const restoreTradeM = useMutation({
    mutationFn: async (params: {
      tradeId: string
      targetStage?: TradeStage
      uiSource?: UISource
    }) => {
      if (!user?.id) throw new Error('Not authenticated')

      await restoreTradeIdea({
        tradeId: params.tradeId,
        context: buildActionContext(user, params.uiSource),
        targetStage: params.targetStage,
      })
    },
    onSuccess: () => {
      invalidateQueries()
      toast.success('Trade restored')
      options.onRestoreSuccess?.()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to restore trade')
    },
  })

  // Archive trade mutation (permanent)
  const archiveTradeM = useMutation({
    mutationFn: async (params: {
      tradeId: string
      reason?: string
      uiSource?: UISource
    }) => {
      if (!user?.id) throw new Error('Not authenticated')

      await archiveTradeIdea({
        tradeId: params.tradeId,
        context: buildActionContext(user, params.uiSource),
        reason: params.reason,
      })
    },
    onSuccess: () => {
      invalidateQueries()
      toast.success('Trade archived')
      options.onArchiveSuccess?.()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to archive trade')
    },
  })

  // Defer trade mutation (with optional resurface date)
  const deferTradeM = useMutation({
    mutationFn: async (params: {
      tradeId: string
      deferredUntil?: string | null
      uiSource?: UISource
    }) => {
      if (!user?.id) throw new Error('Not authenticated')

      await moveTradeIdea({
        tradeId: params.tradeId,
        target: {
          stage: 'deciding',
          outcome: 'deferred',
          deferredUntil: params.deferredUntil || null,
        },
        context: buildActionContext(user, params.uiSource),
      })
    },
    onSuccess: () => {
      invalidateQueries()
      toast.success('Trade deferred')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to defer trade')
    },
  })

  // Bulk move mutation
  const bulkMoveM = useMutation({
    mutationFn: async (params: {
      tradeIds: string[]
      stage?: TradeStage
      outcome?: TradeOutcome
      targetStatus?: TradeQueueStatus
      uiSource?: UISource
    }) => {
      if (!user?.id) throw new Error('Not authenticated')

      // Determine target
      let target: MoveTarget
      if (params.stage) {
        target = { stage: params.stage, outcome: params.outcome }
      } else if (params.targetStatus) {
        target = statusToTarget(params.targetStatus)
      } else {
        throw new Error('Must provide either stage or targetStatus')
      }

      return bulkMoveTradeIdeas({
        tradeIds: params.tradeIds,
        target,
        context: buildActionContext(user, params.uiSource),
      })
    },
    // Optimistic update for instant UI feedback
    onMutate: async (params) => {
      await queryClient.cancelQueries({ queryKey: ['trade-queue-items'] })
      const previousItems = queryClient.getQueryData(['trade-queue-items'])
      const newStatus = params.targetStatus || params.stage
      const tradeIdSet = new Set(params.tradeIds)

      queryClient.setQueriesData({ queryKey: ['trade-queue-items'] }, (old: any) => {
        if (!old) return old
        return old.map((item: any) =>
          tradeIdSet.has(item.id)
            ? { ...item, status: newStatus, workflow_stage: params.stage || newStatus }
            : item
        )
      })

      return { previousItems }
    },
    onError: (error, params, context) => {
      if (context?.previousItems) {
        queryClient.setQueryData(['trade-queue-items'], context.previousItems)
      }
      toast.error(error instanceof Error ? error.message : 'Bulk move failed')
    },
    onSettled: (result) => {
      invalidateQueries()
      if (result && result.failed.length === 0) {
        toast.success(`Moved ${result.succeeded.length} trades`)
      } else if (result) {
        toast.warning(
          `Moved ${result.succeeded.length} trades. ${result.failed.length} failed.`
        )
      }
    },
  })

  // Move pair trade mutation
  const movePairTradeM = useMutation({
    mutationFn: async (params: {
      pairTradeId: string
      stage?: TradeStage
      outcome?: TradeOutcome
      targetStatus?: TradeQueueStatus
      uiSource?: UISource
      note?: string
    }) => {
      if (!user?.id) throw new Error('Not authenticated')

      // Determine target
      let target: MoveTarget
      if (params.stage) {
        target = { stage: params.stage, outcome: params.outcome }
      } else if (params.targetStatus) {
        target = statusToTarget(params.targetStatus)
      } else {
        throw new Error('Must provide either stage or targetStatus')
      }

      await movePairTradeService({
        pairTradeId: params.pairTradeId,
        target,
        context: buildActionContext(user, params.uiSource),
        note: params.note,
      })
    },
    // Optimistic update for instant UI feedback
    onMutate: async (params) => {
      await queryClient.cancelQueries({ queryKey: ['pair-trades'] })
      const previousItems = queryClient.getQueryData(['pair-trades'])
      const newStatus = params.targetStatus || params.stage

      queryClient.setQueriesData({ queryKey: ['pair-trades'] }, (old: any) => {
        if (!old) return old
        return old.map((item: any) =>
          item.id === params.pairTradeId
            ? { ...item, status: newStatus, workflow_stage: params.stage || newStatus }
            : item
        )
      })

      return { previousItems }
    },
    onError: (error, params, context) => {
      if (context?.previousItems) {
        queryClient.setQueryData(['pair-trades'], context.previousItems)
      }
      toast.error(error instanceof Error ? error.message : 'Failed to move pair trade')
    },
    onSettled: () => {
      invalidateQueries()
    },
  })

  // Create trade mutation
  const createTradeM = useMutation({
    mutationFn: async (params: {
      portfolioId: string
      assetId: string
      action: string
      proposedWeight?: number | null
      proposedShares?: number | null
      targetPrice?: number | null
      urgency: string
      rationale?: string
      sharingVisibility?: 'private' | 'portfolio' | 'team' | 'public'
      assignedTo?: string | null // Co-analyst
      uiSource?: UISource
      // Provenance
      originType?: string
      originEntityType?: string | null
      originEntityId?: string | null
      originRoute?: string
      originMetadata?: Record<string, unknown>
      // Context tags - entity-based categorization
      contextTags?: Array<{
        entity_type: string
        entity_id: string
        display_name: string
      }>
    }) => {
      if (!user?.id) throw new Error('Not authenticated')

      return createTradeIdea({
        portfolioId: params.portfolioId,
        assetId: params.assetId,
        action: params.action,
        proposedWeight: params.proposedWeight,
        proposedShares: params.proposedShares,
        targetPrice: params.targetPrice,
        urgency: params.urgency,
        rationale: params.rationale,
        sharingVisibility: params.sharingVisibility,
        assignedTo: params.assignedTo,
        context: buildActionContext(user, params.uiSource),
        // Provenance
        originType: params.originType,
        originEntityType: params.originEntityType,
        originEntityId: params.originEntityId,
        originRoute: params.originRoute,
        originMetadata: params.originMetadata,
        // Context tags
        contextTags: params.contextTags,
      })
    },
    onSuccess: () => {
      invalidateQueries()
      toast.success('Trade idea created')
      options.onCreateSuccess?.()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create trade idea')
    },
  })

  // Create pair trade mutation
  const createPairTradeM = useMutation({
    mutationFn: async (params: {
      portfolioId: string
      name?: string
      description?: string
      rationale?: string
      urgency: string
      legs: Array<{
        assetId: string
        action: string
        legType: 'long' | 'short'
        proposedWeight?: number | null
        proposedShares?: number | null
        targetPrice?: number | null
      }>
      uiSource?: UISource
    }) => {
      if (!user?.id) throw new Error('Not authenticated')

      return createPairTradeService({
        portfolioId: params.portfolioId,
        name: params.name,
        description: params.description,
        rationale: params.rationale,
        urgency: params.urgency,
        legs: params.legs,
        context: buildActionContext(user, params.uiSource),
      })
    },
    onSuccess: () => {
      invalidateQueries()
      toast.success('Pair trade created')
      options.onCreatePairTradeSuccess?.()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create pair trade')
    },
  })

  // Update trade mutation - for editing trade details
  const updateTradeM = useMutation({
    mutationFn: async (params: {
      tradeId: string
      updates: {
        rationale?: string | null
        proposedWeight?: number | null
        proposedShares?: number | null
        targetPrice?: number | null
        stopLoss?: number | null
        takeProfit?: number | null
        conviction?: 'low' | 'medium' | 'high' | null
        timeHorizon?: 'short' | 'medium' | 'long' | null
        urgency?: string
        sharingVisibility?: 'private' | 'portfolio' | 'team' | 'public' | null
        contextTags?: Array<{
          entity_type: string
          entity_id: string
          display_name: string
        }> | null
      }
      uiSource?: UISource
    }) => {
      if (!user?.id) throw new Error('Not authenticated')

      await updateTradeIdea({
        tradeId: params.tradeId,
        updates: params.updates,
        context: buildActionContext(user, params.uiSource),
      })
    },
    onSuccess: () => {
      invalidateQueries()
      toast.success('Trade idea updated')
      options.onUpdateSuccess?.()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update trade idea')
    },
  })

  // Set outcome - convenience wrapper for moving to deciding with outcome
  const setOutcomeM = useMutation({
    mutationFn: async (params: {
      tradeId: string
      outcome: TradeOutcome
      note?: string
      uiSource?: UISource
    }) => {
      if (!user?.id) throw new Error('Not authenticated')

      await moveTradeIdea({
        tradeId: params.tradeId,
        target: { stage: 'deciding', outcome: params.outcome },
        context: buildActionContext(user, params.uiSource),
        note: params.note,
      })
    },
    onSuccess: () => {
      invalidateQueries()
      options.onMoveSuccess?.()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to set outcome')
    },
  })

  return {
    // Single trade operations
    moveTrade: moveTradeM.mutate,
    moveTradeAsync: moveTradeM.mutateAsync,
    isMoving: moveTradeM.isPending,

    deleteTrade: deleteTradeM.mutate,
    deleteTradeAsync: deleteTradeM.mutateAsync,
    isDeleting: deleteTradeM.isPending,

    restoreTrade: restoreTradeM.mutate,
    restoreTradeAsync: restoreTradeM.mutateAsync,
    isRestoring: restoreTradeM.isPending,

    archiveTrade: archiveTradeM.mutate,
    archiveTradeAsync: archiveTradeM.mutateAsync,
    isArchiving: archiveTradeM.isPending,

    deferTrade: deferTradeM.mutate,
    deferTradeAsync: deferTradeM.mutateAsync,
    isDefering: deferTradeM.isPending,

    // Outcome operations
    setOutcome: setOutcomeM.mutate,
    setOutcomeAsync: setOutcomeM.mutateAsync,
    isSettingOutcome: setOutcomeM.isPending,

    // Create operations
    createTrade: createTradeM.mutate,
    createTradeAsync: createTradeM.mutateAsync,
    isCreating: createTradeM.isPending,

    createPairTrade: createPairTradeM.mutate,
    createPairTradeAsync: createPairTradeM.mutateAsync,
    isCreatingPairTrade: createPairTradeM.isPending,

    // Update operations
    updateTrade: updateTradeM.mutate,
    updateTradeAsync: updateTradeM.mutateAsync,
    isUpdating: updateTradeM.isPending,

    // Bulk operations
    bulkMove: bulkMoveM.mutate,
    bulkMoveAsync: bulkMoveM.mutateAsync,
    isBulkMoving: bulkMoveM.isPending,

    // Pair trade operations
    movePairTrade: movePairTradeM.mutate,
    movePairTradeAsync: movePairTradeM.mutateAsync,
    isMovingPairTrade: movePairTradeM.isPending,

    // Combined loading state
    isLoading:
      moveTradeM.isPending ||
      deleteTradeM.isPending ||
      restoreTradeM.isPending ||
      setOutcomeM.isPending ||
      createTradeM.isPending ||
      createPairTradeM.isPending ||
      updateTradeM.isPending ||
      bulkMoveM.isPending ||
      movePairTradeM.isPending,
  }
}
