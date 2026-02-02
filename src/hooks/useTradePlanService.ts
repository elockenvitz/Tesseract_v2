/**
 * useTradePlanService Hook
 *
 * React hook wrapping the trade plan service for UI components.
 * Provides mutation functions for plan creation, approval, and submission.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from './useAuth'
import { useToast } from '../components/common/Toast'
import {
  createTradePlanFromView,
  submitForApproval,
  approvePlan,
  sendToDesk,
  acknowledgeDeskReceipt,
  getPlanWithDetails,
  getPlansForPortfolio,
  getPendingApprovals,
  deletePlan,
  type TradePlan,
  type TradePlanWithDetails,
  type TradePlanStatus,
} from '../lib/services/trade-plan-service'
import type { ActionContext, UISource } from '../types/trading'

interface UseTradePlanServiceOptions {
  portfolioId?: string
  onPlanCreated?: (plan: TradePlan) => void
  onPlanSubmitted?: () => void
  onPlanApproved?: () => void
  onPlanRejected?: () => void
  onPlanSent?: (deskReference: string) => void
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

export function useTradePlanService(options: UseTradePlanServiceOptions = {}) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const toast = useToast()

  const invalidateQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['trade-plans'] })
    queryClient.invalidateQueries({ queryKey: ['pending-approvals'] })
    queryClient.invalidateQueries({ queryKey: ['audit-events'] })
  }

  // ============================================================
  // Queries
  // ============================================================

  // Get plans for a portfolio
  const plansQuery = useQuery({
    queryKey: ['trade-plans', options.portfolioId],
    queryFn: () =>
      options.portfolioId
        ? getPlansForPortfolio(options.portfolioId)
        : Promise.resolve([]),
    enabled: !!options.portfolioId,
  })

  // Get pending approvals for current user
  const pendingApprovalsQuery = useQuery({
    queryKey: ['pending-approvals', user?.id],
    queryFn: () => (user?.id ? getPendingApprovals(user.id) : Promise.resolve([])),
    enabled: !!user?.id,
  })

  // ============================================================
  // Mutations
  // ============================================================

  // Create plan from view
  const createPlanM = useMutation({
    mutationFn: async (params: {
      viewId: string
      name: string
      description?: string
      uiSource?: UISource
    }) => {
      if (!user?.id) throw new Error('Not authenticated')
      return createTradePlanFromView({
        viewId: params.viewId,
        name: params.name,
        description: params.description,
        context: buildActionContext(user, params.uiSource),
      })
    },
    onSuccess: (plan) => {
      invalidateQueries()
      toast.success('Trade plan created')
      options.onPlanCreated?.(plan)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create plan')
    },
  })

  // Submit for approval
  const submitM = useMutation({
    mutationFn: async (params: {
      planId: string
      note?: string
      uiSource?: UISource
    }) => {
      if (!user?.id) throw new Error('Not authenticated')
      await submitForApproval({
        planId: params.planId,
        note: params.note,
        context: buildActionContext(user, params.uiSource),
      })
    },
    onSuccess: () => {
      invalidateQueries()
      toast.success('Plan submitted for approval')
      options.onPlanSubmitted?.()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to submit plan')
    },
  })

  // Approve plan
  const approveM = useMutation({
    mutationFn: async (params: {
      planId: string
      note?: string
      uiSource?: UISource
    }) => {
      if (!user?.id) throw new Error('Not authenticated')
      await approvePlan({
        planId: params.planId,
        action: 'approve',
        note: params.note,
        context: buildActionContext(user, params.uiSource),
      })
    },
    onSuccess: () => {
      invalidateQueries()
      toast.success('Plan approved')
      options.onPlanApproved?.()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to approve plan')
    },
  })

  // Reject plan
  const rejectM = useMutation({
    mutationFn: async (params: {
      planId: string
      note?: string
      uiSource?: UISource
    }) => {
      if (!user?.id) throw new Error('Not authenticated')
      await approvePlan({
        planId: params.planId,
        action: 'reject',
        note: params.note,
        context: buildActionContext(user, params.uiSource),
      })
    },
    onSuccess: () => {
      invalidateQueries()
      toast.warning('Plan rejected')
      options.onPlanRejected?.()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to reject plan')
    },
  })

  // Send to desk
  const sendToDeskM = useMutation({
    mutationFn: async (params: { planId: string; uiSource?: UISource }) => {
      if (!user?.id) throw new Error('Not authenticated')
      return sendToDesk({
        planId: params.planId,
        context: buildActionContext(user, params.uiSource),
      })
    },
    onSuccess: (deskReference) => {
      invalidateQueries()
      toast.success(`Plan sent to desk: ${deskReference}`)
      options.onPlanSent?.(deskReference)
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to send plan to desk'
      )
    },
  })

  // Acknowledge desk receipt
  const acknowledgeM = useMutation({
    mutationFn: async (params: {
      planId: string
      note?: string
      uiSource?: UISource
    }) => {
      if (!user?.id) throw new Error('Not authenticated')
      await acknowledgeDeskReceipt(
        params.planId,
        params.note,
        buildActionContext(user, params.uiSource)
      )
    },
    onSuccess: () => {
      invalidateQueries()
      toast.success('Receipt acknowledged')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to acknowledge')
    },
  })

  // Delete plan
  const deletePlanM = useMutation({
    mutationFn: async (params: { planId: string; uiSource?: UISource }) => {
      if (!user?.id) throw new Error('Not authenticated')
      await deletePlan(params.planId, buildActionContext(user, params.uiSource))
    },
    onSuccess: () => {
      invalidateQueries()
      toast.success('Plan moved to trash')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete plan')
    },
  })

  return {
    // Queries
    plans: plansQuery.data || [],
    isLoadingPlans: plansQuery.isLoading,
    pendingApprovals: pendingApprovalsQuery.data || [],
    isLoadingPendingApprovals: pendingApprovalsQuery.isLoading,
    refetchPlans: plansQuery.refetch,
    refetchPendingApprovals: pendingApprovalsQuery.refetch,

    // Create
    createPlan: createPlanM.mutate,
    createPlanAsync: createPlanM.mutateAsync,
    isCreatingPlan: createPlanM.isPending,

    // Submit for approval
    submitForApproval: submitM.mutate,
    isSubmitting: submitM.isPending,

    // Approve/Reject
    approvePlan: approveM.mutate,
    isApproving: approveM.isPending,
    rejectPlan: rejectM.mutate,
    isRejecting: rejectM.isPending,

    // Send to desk
    sendToDesk: sendToDeskM.mutate,
    sendToDeskAsync: sendToDeskM.mutateAsync,
    isSendingToDesk: sendToDeskM.isPending,

    // Acknowledge
    acknowledge: acknowledgeM.mutate,
    isAcknowledging: acknowledgeM.isPending,

    // Delete
    deletePlan: deletePlanM.mutate,
    isDeleting: deletePlanM.isPending,

    // Combined loading state
    isLoading:
      plansQuery.isLoading ||
      pendingApprovalsQuery.isLoading ||
      createPlanM.isPending ||
      submitM.isPending ||
      approveM.isPending ||
      rejectM.isPending ||
      sendToDeskM.isPending,
  }
}

/**
 * Hook for getting a single plan with details
 */
export function useTradePlan(planId: string | undefined) {
  return useQuery({
    queryKey: ['trade-plan', planId],
    queryFn: () => (planId ? getPlanWithDetails(planId) : Promise.resolve(null)),
    enabled: !!planId,
  })
}

/**
 * Hook for getting plans by status
 */
export function useTradePlansByStatus(
  portfolioId: string | undefined,
  status: TradePlanStatus | TradePlanStatus[]
) {
  return useQuery({
    queryKey: ['trade-plans', portfolioId, status],
    queryFn: () =>
      portfolioId
        ? getPlansForPortfolio(portfolioId, { status })
        : Promise.resolve([]),
    enabled: !!portfolioId,
  })
}
