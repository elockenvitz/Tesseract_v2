/**
 * useTradeLab Hook
 *
 * Composite React hook for Trade Lab functionality.
 * Provides lab, view, and draft management with automatic cache invalidation.
 *
 * Architecture:
 * - ONE Trade Lab per Portfolio
 * - Views: My Drafts | Shared | Portfolio Working Set
 * - Drafts: Trade ideas being composed, autosave-enabled
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from './useAuth'
import { useToast } from '../components/common/Toast'
import * as tradeLabService from '../lib/services/trade-lab-service'
import * as tradePlanService from '../lib/services/trade-plan-service'
import type { ActionContext, UISource, TradeAction } from '../types/trading'

// ============================================================================
// Helper
// ============================================================================

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

// ============================================================================
// Main Hook: useTradeLab
// ============================================================================

interface UseTradeLabOptions {
  portfolioId?: string
}

export function useTradeLab(options: UseTradeLabOptions = {}) {
  const { portfolioId } = options
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const toast = useToast()

  const invalidateLab = () => {
    queryClient.invalidateQueries({ queryKey: ['trade-lab', portfolioId] })
    queryClient.invalidateQueries({ queryKey: ['trade-lab-views'] })
    queryClient.invalidateQueries({ queryKey: ['trade-lab-drafts'] })
    queryClient.invalidateQueries({ queryKey: ['trade-plans'] })
  }

  // ============================================================
  // Lab Query (one per portfolio)
  // ============================================================

  const labQuery = useQuery({
    queryKey: ['trade-lab', portfolioId],
    queryFn: () =>
      portfolioId
        ? tradeLabService.getOrCreateTradeLab(portfolioId)
        : Promise.resolve(null),
    enabled: !!portfolioId,
    staleTime: 5 * 60 * 1000, // Lab rarely changes
  })

  // ============================================================
  // Views Query
  // ============================================================

  const viewsQuery = useQuery({
    queryKey: ['trade-lab-views', labQuery.data?.id],
    queryFn: () =>
      labQuery.data?.id
        ? tradeLabService.getViewsForLab(labQuery.data.id)
        : Promise.resolve([]),
    enabled: !!labQuery.data?.id,
  })

  // Computed view helpers
  const privateView = viewsQuery.data?.find(
    (v) => v.view_type === 'private' && v.owner_id === user?.id
  )
  const portfolioView = viewsQuery.data?.find(
    (v) => v.view_type === 'portfolio'
  )
  const sharedViews = viewsQuery.data?.filter((v) => v.view_type === 'shared') || []

  // Legacy aliases for backwards compatibility
  const myDraftsView = privateView
  const portfolioWorkingSet = portfolioView

  // ============================================================
  // Mutations
  // ============================================================

  // Ensure My Drafts exists
  const ensureMyDraftsM = useMutation({
    mutationFn: async () => {
      if (!labQuery.data?.id || !user?.id) throw new Error('Not ready')
      return tradeLabService.getOrCreateMyDraftsView(labQuery.data.id, user.id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-lab-views'] })
    },
  })

  // Ensure Portfolio Working Set exists
  const ensurePWSM = useMutation({
    mutationFn: async () => {
      if (!labQuery.data?.id) throw new Error('Lab not ready')
      return tradeLabService.getOrCreatePortfolioWorkingSet(labQuery.data.id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-lab-views'] })
    },
  })

  // Create shared view
  const createSharedViewM = useMutation({
    mutationFn: (params: {
      name: string
      description?: string
      members?: Array<{ userId: string; role: tradeLabService.TradeLabViewRole }>
      uiSource?: UISource
    }) => {
      if (!labQuery.data?.id || !user) throw new Error('Not ready')
      return tradeLabService.createSharedView({
        labId: labQuery.data.id,
        viewType: 'shared',
        name: params.name,
        description: params.description,
        members: params.members,
        context: buildActionContext(user, params.uiSource),
      })
    },
    onSuccess: () => {
      invalidateLab()
      toast.success('Shared view created')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create view')
    },
  })

  // Add member to view
  const addMemberM = useMutation({
    mutationFn: (params: {
      viewId: string
      userId: string
      role: tradeLabService.TradeLabViewRole
      uiSource?: UISource
    }) => {
      if (!user) throw new Error('Not authenticated')
      return tradeLabService.addViewMember(
        params.viewId,
        params.userId,
        params.role,
        buildActionContext(user, params.uiSource)
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-lab-views'] })
      toast.success('Member added')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to add member')
    },
  })

  // Remove member from view
  const removeMemberM = useMutation({
    mutationFn: (params: { viewId: string; userId: string; uiSource?: UISource }) => {
      if (!user) throw new Error('Not authenticated')
      return tradeLabService.removeViewMember(
        params.viewId,
        params.userId,
        buildActionContext(user, params.uiSource)
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-lab-views'] })
      toast.success('Member removed')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to remove member')
    },
  })

  // Delete view
  const deleteViewM = useMutation({
    mutationFn: (params: { viewId: string; uiSource?: UISource }) => {
      if (!user) throw new Error('Not authenticated')
      return tradeLabService.deleteView(
        params.viewId,
        buildActionContext(user, params.uiSource)
      )
    },
    onSuccess: () => {
      invalidateLab()
      toast.success('View deleted')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete view')
    },
  })

  return {
    // Lab
    lab: labQuery.data,
    isLoadingLab: labQuery.isLoading,

    // Views (new names)
    views: viewsQuery.data || [],
    isLoadingViews: viewsQuery.isLoading,
    privateView,
    portfolioView,
    sharedViews,
    // Legacy aliases
    myDraftsView,
    portfolioWorkingSet,

    // Mutations (new names)
    ensurePrivateView: ensureMyDraftsM.mutate,
    ensurePrivateViewAsync: ensureMyDraftsM.mutateAsync,
    ensurePortfolioView: ensurePWSM.mutate,
    createSharedView: createSharedViewM.mutate,
    createSharedViewAsync: createSharedViewM.mutateAsync,
    isCreatingView: createSharedViewM.isPending,
    addMember: addMemberM.mutate,
    removeMember: removeMemberM.mutate,
    deleteView: deleteViewM.mutate,
    // Legacy aliases
    ensureMyDrafts: ensureMyDraftsM.mutate,
    ensureMyDraftsAsync: ensureMyDraftsM.mutateAsync,
    ensurePortfolioWorkingSet: ensurePWSM.mutate,

    // Refetch
    refetch: invalidateLab,
  }
}

// ============================================================================
// Hook: useViewDrafts
// ============================================================================

interface UseViewDraftsOptions {
  viewId?: string
  labId?: string
}

export function useViewDrafts(options: UseViewDraftsOptions = {}) {
  const { viewId, labId } = options
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const toast = useToast()

  // ============================================================
  // Query
  // ============================================================

  const draftsQuery = useQuery({
    queryKey: ['trade-lab-drafts', viewId || labId],
    queryFn: () => {
      if (viewId) {
        return tradeLabService.getDraftsForView(viewId)
      } else if (labId) {
        return tradeLabService.getDraftsForLab(labId)
      }
      return Promise.resolve([])
    },
    enabled: !!(viewId || labId),
  })

  // ============================================================
  // Mutations
  // ============================================================

  // Upsert draft (create or update)
  const upsertDraftM = useMutation({
    mutationFn: (params: {
      id?: string
      assetId: string
      action: TradeAction
      shares?: number | null
      weight?: number | null
      price?: number | null
      notes?: string | null
      tags?: string[] | null
      sortOrder?: number
      tradeQueueItemId?: string | null
      uiSource?: UISource
    }) => {
      if (!user || !labId) throw new Error('Not ready')
      return tradeLabService.upsertDraft({
        id: params.id,
        labId,
        viewId: viewId || null,
        assetId: params.assetId,
        action: params.action,
        shares: params.shares,
        weight: params.weight,
        price: params.price,
        notes: params.notes,
        tags: params.tags,
        sortOrder: params.sortOrder,
        tradeQueueItemId: params.tradeQueueItemId,
        context: buildActionContext(user, params.uiSource),
      })
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['trade-lab-drafts'] })
      queryClient.invalidateQueries({ queryKey: ['trade-lab-views'] }) // For draft counts
      // Only toast for new drafts, not autosave updates
      if (!variables.id) {
        // New draft created
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to save draft')
    },
  })

  // Move draft to view
  const moveDraftM = useMutation({
    mutationFn: (params: {
      draftId: string
      targetViewId: string
      uiSource?: UISource
    }) => {
      if (!user) throw new Error('Not authenticated')
      return tradeLabService.moveDraftToView({
        draftId: params.draftId,
        targetViewId: params.targetViewId,
        context: buildActionContext(user, params.uiSource),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-lab-drafts'] })
      queryClient.invalidateQueries({ queryKey: ['trade-lab-views'] })
      toast.success('Draft moved')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to move draft')
    },
  })

  // Delete draft
  const deleteDraftM = useMutation({
    mutationFn: (params: { draftId: string; uiSource?: UISource }) => {
      if (!user) throw new Error('Not authenticated')
      return tradeLabService.deleteDraft(
        params.draftId,
        buildActionContext(user, params.uiSource)
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-lab-drafts'] })
      queryClient.invalidateQueries({ queryKey: ['trade-lab-views'] })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete draft')
    },
  })

  // Reorder drafts
  const reorderDraftsM = useMutation({
    mutationFn: (params: { orderedDraftIds: string[]; uiSource?: UISource }) => {
      if (!user || !labId) throw new Error('Not ready')
      return tradeLabService.reorderDrafts(
        labId,
        viewId || null,
        params.orderedDraftIds,
        buildActionContext(user, params.uiSource)
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-lab-drafts'] })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to reorder drafts')
    },
  })

  return {
    drafts: draftsQuery.data || [],
    isLoading: draftsQuery.isLoading,

    // Mutations
    upsertDraft: upsertDraftM.mutate,
    upsertDraftAsync: upsertDraftM.mutateAsync,
    isSaving: upsertDraftM.isPending,
    moveDraft: moveDraftM.mutate,
    deleteDraft: deleteDraftM.mutate,
    reorderDrafts: reorderDraftsM.mutate,

    // Refetch
    refetch: draftsQuery.refetch,
  }
}

// ============================================================================
// Hook: useWorkbench - Auto-save Drafts with Debounce
// ============================================================================

interface DraftChange {
  id?: string
  assetId: string
  action: TradeAction
  shares?: number | null
  weight?: number | null
  price?: number | null
  notes?: string | null
  tags?: string[] | null
  tradeQueueItemId?: string | null
  sortOrder?: number
}

interface UseWorkbenchOptions {
  viewId?: string
  labId?: string
  debounceMs?: number // Default 2000ms
}

export function useWorkbench(options: UseWorkbenchOptions = {}) {
  const { viewId, labId, debounceMs = 2000 } = options
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const toast = useToast()

  // Refs for debounce (UniversalNoteEditor pattern)
  const autosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingChangesRef = useRef<Map<string, DraftChange>>(new Map())

  // State
  const [isSaving, setIsSaving] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // Query for drafts
  const draftsQuery = useQuery({
    queryKey: ['trade-lab-drafts', viewId || labId],
    queryFn: () => {
      if (viewId) {
        return tradeLabService.getDraftsForView(viewId)
      } else if (labId) {
        return tradeLabService.getDraftsForLab(labId)
      }
      return Promise.resolve([])
    },
    enabled: !!(viewId || labId),
  })

  // Build action context
  const context = useMemo(() => {
    if (!user) return null
    return buildActionContext(user)
  }, [user])

  // Save all pending changes
  const saveChanges = useCallback(async () => {
    if (!context || !labId || pendingChangesRef.current.size === 0) return

    setIsSaving(true)
    try {
      const changes = Array.from(pendingChangesRef.current.values())

      // Save all changes in parallel
      await Promise.all(
        changes.map((change) =>
          tradeLabService.upsertDraft({
            id: change.id,
            labId,
            viewId: viewId || null,
            assetId: change.assetId,
            action: change.action,
            shares: change.shares,
            weight: change.weight,
            price: change.price,
            notes: change.notes,
            tags: change.tags,
            tradeQueueItemId: change.tradeQueueItemId,
            sortOrder: change.sortOrder,
            context,
          })
        )
      )

      // Clear pending changes and update state
      pendingChangesRef.current.clear()
      setHasUnsavedChanges(false)
      setLastSavedAt(new Date())

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['trade-lab-drafts'] })
      queryClient.invalidateQueries({ queryKey: ['trade-lab-views'] })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save drafts')
    } finally {
      setIsSaving(false)
    }
  }, [context, labId, viewId, queryClient, toast])

  // Debounced save trigger
  const triggerAutosave = useCallback(() => {
    if (autosaveTimeoutRef.current) clearTimeout(autosaveTimeoutRef.current)
    autosaveTimeoutRef.current = setTimeout(() => saveChanges(), debounceMs)
  }, [saveChanges, debounceMs])

  // Queue change for auto-save
  const queueChange = useCallback(
    (draftKey: string, change: DraftChange) => {
      pendingChangesRef.current.set(draftKey, change)
      setHasUnsavedChanges(true)
      triggerAutosave()
    },
    [triggerAutosave]
  )

  // Force immediate save
  const saveNow = useCallback(async () => {
    if (autosaveTimeoutRef.current) clearTimeout(autosaveTimeoutRef.current)
    await saveChanges()
  }, [saveChanges])

  // Clear drafts mutation
  const clearDraftsMutation = useMutation({
    mutationFn: async () => {
      if (!viewId || !context) throw new Error('View ID and context required')
      return tradeLabService.clearDraftsForView(viewId, context)
    },
    onSuccess: () => {
      pendingChangesRef.current.clear()
      setHasUnsavedChanges(false)
      queryClient.invalidateQueries({ queryKey: ['trade-lab-drafts'] })
      queryClient.invalidateQueries({ queryKey: ['trade-lab-views'] })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to clear drafts')
    },
  })

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current)
      }
    }
  }, [])

  return {
    drafts: draftsQuery.data || [],
    isLoading: draftsQuery.isLoading,
    isSaving,
    lastSavedAt,
    hasUnsavedChanges,
    queueChange,
    saveNow,
    clearDrafts: clearDraftsMutation.mutate,
    clearDraftsAsync: clearDraftsMutation.mutateAsync,
    isClearingDrafts: clearDraftsMutation.isPending,
    refetch: draftsQuery.refetch,
  }
}

// ============================================================================
// Hook: useTradePlans
// ============================================================================

interface UseTradePlansOptions extends tradePlanService.ListPlansParams {}

export function useTradePlans(options: UseTradePlansOptions = {}) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const toast = useToast()

  // ============================================================
  // Query
  // ============================================================

  const plansQuery = useQuery({
    queryKey: ['trade-plans', options],
    queryFn: () => tradePlanService.listPlans(options),
    enabled: true,
  })

  // ============================================================
  // Mutations
  // ============================================================

  // Create plan from view
  const createPlanM = useMutation({
    mutationFn: (params: {
      viewId: string
      name: string
      description?: string
      uiSource?: UISource
    }) => {
      if (!user) throw new Error('Not authenticated')
      return tradePlanService.createTradePlanFromView({
        viewId: params.viewId,
        name: params.name,
        description: params.description,
        context: buildActionContext(user, params.uiSource),
      })
    },
    onSuccess: (plan) => {
      queryClient.invalidateQueries({ queryKey: ['trade-plans'] })
      toast.success(`Plan "${plan.name}" created`)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create plan')
    },
  })

  // Submit for approval
  const submitForApprovalM = useMutation({
    mutationFn: (params: { planId: string; note?: string; uiSource?: UISource }) => {
      if (!user) throw new Error('Not authenticated')
      return tradePlanService.submitForApproval({
        planId: params.planId,
        note: params.note,
        context: buildActionContext(user, params.uiSource),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-plans'] })
      toast.success('Plan submitted for approval')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to submit plan')
    },
  })

  // Approve plan
  const approvePlanM = useMutation({
    mutationFn: (params: { planId: string; note?: string; uiSource?: UISource }) => {
      if (!user) throw new Error('Not authenticated')
      return tradePlanService.approvePlan({
        planId: params.planId,
        action: 'approve',
        note: params.note,
        context: buildActionContext(user, params.uiSource),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-plans'] })
      toast.success('Plan approved')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to approve plan')
    },
  })

  // Reject plan
  const rejectPlanM = useMutation({
    mutationFn: (params: { planId: string; note?: string; uiSource?: UISource }) => {
      if (!user) throw new Error('Not authenticated')
      return tradePlanService.approvePlan({
        planId: params.planId,
        action: 'reject',
        note: params.note,
        context: buildActionContext(user, params.uiSource),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-plans'] })
      toast.warning('Plan rejected')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to reject plan')
    },
  })

  // Send to desk
  const sendToDeskM = useMutation({
    mutationFn: (params: { planId: string; uiSource?: UISource }) => {
      if (!user) throw new Error('Not authenticated')
      return tradePlanService.sendToDesk({
        planId: params.planId,
        context: buildActionContext(user, params.uiSource),
      })
    },
    onSuccess: (deskRef) => {
      queryClient.invalidateQueries({ queryKey: ['trade-plans'] })
      toast.success(`Plan sent to desk: ${deskRef}`)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to send to desk')
    },
  })

  return {
    plans: plansQuery.data || [],
    isLoading: plansQuery.isLoading,

    // Mutations
    createPlan: createPlanM.mutate,
    createPlanAsync: createPlanM.mutateAsync,
    isCreating: createPlanM.isPending,
    submitForApproval: submitForApprovalM.mutate,
    approvePlan: approvePlanM.mutate,
    rejectPlan: rejectPlanM.mutate,
    sendToDesk: sendToDeskM.mutate,
    sendToDeskAsync: sendToDeskM.mutateAsync,

    // Refetch
    refetch: plansQuery.refetch,
  }
}

// ============================================================================
// Hook: useTradePlanHistory
// ============================================================================

interface UseTradePlanHistoryOptions extends tradePlanService.ListPlansParams {}

export function useTradePlanHistory(options: UseTradePlanHistoryOptions = {}) {
  const { user } = useAuth()

  // My plans
  const myPlansQuery = useQuery({
    queryKey: ['trade-plans', 'mine', options],
    queryFn: () =>
      user?.id
        ? tradePlanService.getMyPlans(user.id, options)
        : Promise.resolve([]),
    enabled: !!user?.id,
  })

  // Collaborative plans
  const collaborativePlansQuery = useQuery({
    queryKey: ['trade-plans', 'collaborative', options],
    queryFn: () =>
      user?.id
        ? tradePlanService.getCollaborativePlans(user.id, options)
        : Promise.resolve([]),
    enabled: !!user?.id,
  })

  // Pending approvals
  const pendingApprovalsQuery = useQuery({
    queryKey: ['trade-plans', 'pending-approvals'],
    queryFn: () =>
      user?.id
        ? tradePlanService.getPendingApprovals(user.id)
        : Promise.resolve([]),
    enabled: !!user?.id,
  })

  return {
    myPlans: myPlansQuery.data || [],
    isLoadingMyPlans: myPlansQuery.isLoading,
    collaborativePlans: collaborativePlansQuery.data || [],
    isLoadingCollaborative: collaborativePlansQuery.isLoading,
    pendingApprovals: pendingApprovalsQuery.data || [],
    isLoadingPending: pendingApprovalsQuery.isLoading,
    isLoading:
      myPlansQuery.isLoading ||
      collaborativePlansQuery.isLoading ||
      pendingApprovalsQuery.isLoading,
  }
}

// ============================================================================
// Hook: useTradePlan (single plan)
// ============================================================================

export function useTradePlan(planId: string | undefined) {
  return useQuery({
    queryKey: ['trade-plan', planId],
    queryFn: () =>
      planId
        ? tradePlanService.getPlanWithDetails(planId)
        : Promise.resolve(null),
    enabled: !!planId,
  })
}

// ============================================================================
// Hook: usePlanStats
// ============================================================================

export function usePlanStats(portfolioId: string | undefined) {
  return useQuery({
    queryKey: ['trade-plan-stats', portfolioId],
    queryFn: () =>
      portfolioId
        ? tradePlanService.getPlanStats(portfolioId)
        : Promise.resolve({
            total: 0,
            draft: 0,
            pending: 0,
            approved: 0,
            sent: 0,
            acknowledged: 0,
            rejected: 0,
          }),
    enabled: !!portfolioId,
  })
}

// ============================================================================
// Hook: useAllTradeLabs (for portfolio list view)
// ============================================================================

export function useAllTradeLabs() {
  return useQuery({
    queryKey: ['trade-labs'],
    queryFn: () => tradeLabService.getTradeLabsForUser(),
  })
}
