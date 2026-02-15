/**
 * useActionLoopItems — Data hook for the "Needs Attention" engine.
 *
 * Gathers workflow state for 6 triggers, calls the pure evaluator,
 * applies per-type suppression, and exposes a dismiss mutation.
 * Also computes a WorkflowSummary for the summary strip.
 *
 * Queries:
 *   1. Active ideas for this asset (view-scoped)
 *   2. Lab variants + proposals to detect unsimulated ideas
 *   3. Items at 'deciding' stage with no decision (stalled proposals)
 *   4. Items with decision_outcome='accepted' but no execution
 *   5. Items with outcome (completed executions, for workflow summary)
 *   6. Expected return (via useExpectedValue)
 *   7. Thesis contribution staleness (asset_contributions)
 *   8. Rating changes without follow-up (analyst_rating_history)
 *   9. Suppressions (from asset_followup_suppressions)
 */

import { useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../hooks/useAuth'
import { useExpectedValue, type ViewScope } from '../../../hooks/useExpectedValue'
import {
  evaluateActionLoop,
  computeWorkflowSummary,
  type ActionItem,
  type ActionItemType,
  type WorkflowSummary,
} from './assetActionLoopEvaluator'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UseActionLoopItemsOptions {
  assetId: string
  viewFilter: 'aggregated' | string
  currentPrice?: number
}

interface UseActionLoopItemsResult {
  items: ActionItem[]
  itemCount: number
  redCount: number
  orangeCount: number
  workflowSummary: WorkflowSummary | null
  isLoading: boolean
  dismiss: (type: ActionItemType) => Promise<void>
  isDismissing: boolean
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useActionLoopItems({
  assetId,
  viewFilter,
  currentPrice,
}: UseActionLoopItemsOptions): UseActionLoopItemsResult {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const isAggregated = viewFilter === 'aggregated'
  const viewUserId = isAggregated ? null : viewFilter

  // ---- EV data (Trigger A1) ----
  const viewScope: ViewScope = useMemo(() => {
    if (isAggregated) return { type: 'firm' }
    return { type: 'user', userId: viewFilter }
  }, [isAggregated, viewFilter])

  const { expectedReturn, hasData: hasEVData } = useExpectedValue({
    assetId,
    currentPrice,
    viewScope,
  })

  // ---- Workflow state (Triggers P1–P3, A1, + summary data) ----
  const { data: workflowData, isLoading: workflowLoading } = useQuery({
    queryKey: ['action-loop-items', assetId, viewFilter],
    queryFn: async () => {
      // --- Active ideas ---
      let ideaQ = supabase
        .from('trade_queue_items')
        .select('id, action, rationale, stage, created_by')
        .eq('asset_id', assetId)
        .eq('visibility_tier', 'active')
        .is('outcome', null)

      // --- Items at 'deciding' stage with no decision (P1) ---
      let stalledQ = supabase
        .from('trade_queue_items')
        .select('id, action, updated_at, created_by, portfolios:portfolio_id (id, name)')
        .eq('asset_id', assetId)
        .eq('visibility_tier', 'active')
        .eq('stage', 'deciding')
        .is('decision_outcome', null)

      // --- Items with accepted decision but no execution (P3) ---
      let unexecQ = supabase
        .from('trade_queue_items')
        .select('id, action, decided_at, created_by, portfolios:portfolio_id (id, name)')
        .eq('asset_id', assetId)
        .eq('visibility_tier', 'active')
        .eq('decision_outcome', 'accepted')
        .is('outcome', null)

      // --- Items with completed outcome (for workflow summary) ---
      let completedQ = supabase
        .from('trade_queue_items')
        .select('id', { count: 'exact', head: true })
        .eq('asset_id', assetId)
        .not('outcome', 'is', null)

      // View-scope all queries
      if (!isAggregated) {
        ideaQ = ideaQ.eq('created_by', viewFilter)
        stalledQ = stalledQ.eq('created_by', viewFilter)
        unexecQ = unexecQ.eq('created_by', viewFilter)
        completedQ = completedQ.eq('created_by', viewFilter)
      }

      const [ideasRes, stalledRes, unexecRes, completedRes] = await Promise.all([
        ideaQ, stalledQ, unexecQ, completedQ,
      ])

      if (ideasRes.error) throw ideasRes.error
      if (stalledRes.error) throw stalledRes.error
      if (unexecRes.error) throw unexecRes.error

      const ideas = ideasRes.data || []

      // --- Detect unsimulated ideas (P2) ---
      let unsimulatedIdeas = ideas
      let simulatedIdeaCount = 0
      if (ideas.length > 0) {
        const ideaIds = ideas.map(i => i.id)

        const [variantsRes, proposalsRes] = await Promise.all([
          supabase
            .from('lab_variants')
            .select('trade_queue_item_id')
            .in('trade_queue_item_id', ideaIds),
          supabase
            .from('trade_proposals')
            .select('trade_queue_item_id')
            .in('trade_queue_item_id', ideaIds)
            .eq('is_active', true),
        ])

        const simulatedIds = new Set([
          ...(variantsRes.data?.map(v => v.trade_queue_item_id) ?? []),
          ...(proposalsRes.data?.map(p => p.trade_queue_item_id) ?? []),
        ])

        unsimulatedIdeas = ideas.filter(i => !simulatedIds.has(i.id))
        simulatedIdeaCount = ideas.length - unsimulatedIdeas.length
      }

      // --- Compute days pending for stalled proposals ---
      const now = Date.now()
      const stalledProposals = (stalledRes.data || []).map((item: any) => ({
        id: item.id,
        action: item.action as string,
        portfolio: (item.portfolios as any)?.name || 'Unknown',
        daysPending: Math.floor(
          (now - new Date(item.updated_at).getTime()) / (1000 * 60 * 60 * 24),
        ),
      }))

      const unexecutedApprovals = (unexecRes.data || []).map((item: any) => ({
        id: item.id,
        action: item.action as string,
        portfolio: (item.portfolios as any)?.name || 'Unknown',
      }))

      return {
        activeIdeaCount: ideas.length,
        simulatedIdeaCount,
        unsimulatedIdeas: unsimulatedIdeas.map(i => ({
          id: i.id,
          action: i.action as string,
          rationale: (i.rationale as string) || '',
        })),
        stalledProposals,
        unexecutedApprovals,
        completedExecutionCount: completedRes.count ?? 0,
      }
    },
    enabled: !!assetId,
    staleTime: 60_000,
  })

  // ---- R1: Thesis staleness ----
  const { data: thesisDaysStale, isLoading: thesisLoading } = useQuery({
    queryKey: ['action-loop-thesis-stale', assetId, viewFilter],
    queryFn: async () => {
      let q = supabase
        .from('asset_contributions')
        .select('updated_at, created_by')
        .eq('asset_id', assetId)
        .eq('section', 'thesis')
        .eq('is_archived', false)
        .order('updated_at', { ascending: false })
        .limit(1)

      if (!isAggregated) {
        q = q.eq('created_by', viewFilter)
      }

      const { data, error } = await q
      if (error) throw error
      if (!data || data.length === 0) return null

      const updatedAt = new Date(data[0].updated_at)
      const daysSince = Math.floor(
        (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60 * 24),
      )
      return daysSince
    },
    enabled: !!assetId,
    staleTime: 120_000,
  })

  // ---- R2: Rating changes without follow-up ----
  const { data: ratingChanges, isLoading: ratingsLoading } = useQuery({
    queryKey: ['action-loop-rating-followup', assetId, viewFilter],
    queryFn: async () => {
      let ratingsQ = supabase
        .from('analyst_ratings')
        .select('id, user_id, updated_at')
        .eq('asset_id', assetId)

      if (!isAggregated) {
        ratingsQ = ratingsQ.eq('user_id', viewFilter)
      }

      const { data: ratings, error: ratingsErr } = await ratingsQ
      if (ratingsErr) throw ratingsErr
      if (!ratings || ratings.length === 0) return []

      const ratingIds = ratings.map(r => r.id)
      const { data: history, error: histErr } = await supabase
        .from('analyst_rating_history')
        .select('id, rating_id, field_name, old_value, new_value, changed_by, changed_at')
        .in('rating_id', ratingIds)
        .eq('field_name', 'rating_value')
        .order('changed_at', { ascending: false })
        .limit(5)

      if (histErr) throw histErr
      if (!history || history.length === 0) return []

      const results = await Promise.all(
        history.map(async (h) => {
          let followupQ = supabase
            .from('trade_queue_items')
            .select('id')
            .eq('asset_id', assetId)
            .gte('created_at', h.changed_at)
            .limit(1)

          if (!isAggregated) {
            followupQ = followupQ.eq('created_by', viewFilter)
          }

          const { data: followups } = await followupQ
          if ((followups?.length ?? 0) > 0) return null

          const daysSince = Math.floor(
            (Date.now() - new Date(h.changed_at).getTime()) / (1000 * 60 * 60 * 24),
          )

          return {
            ratingId: h.rating_id,
            oldValue: h.old_value || '?',
            newValue: h.new_value || '?',
            changedAt: h.changed_at,
            changedBy: h.changed_by || '',
            daysSince,
          }
        }),
      )

      return results.filter(Boolean) as NonNullable<typeof results[number]>[]
    },
    enabled: !!assetId,
    staleTime: 120_000,
  })

  // ---- Suppressions ----
  const { data: suppressions } = useQuery({
    queryKey: ['action-loop-suppressions', assetId, user?.id, viewUserId],
    queryFn: async () => {
      if (!user) return []

      let query = supabase
        .from('asset_followup_suppressions')
        .select('followup_type, suppressed_until')
        .eq('user_id', user.id)
        .eq('asset_id', assetId)

      if (viewUserId) {
        query = query.eq('view_user_id', viewUserId)
      } else {
        query = query.is('view_user_id', null)
      }

      const { data, error } = await query
      if (error) throw error
      return data || []
    },
    enabled: !!user && !!assetId,
    staleTime: 60_000,
  })

  const isSuppressed = useCallback(
    (type: ActionItemType): boolean => {
      if (!suppressions) return false
      const row = suppressions.find(s => s.followup_type === type)
      if (!row?.suppressed_until) return false
      return new Date(row.suppressed_until) > new Date()
    },
    [suppressions],
  )

  // ---- Evaluate + filter ----
  const allItems = useMemo(() => {
    if (!workflowData) return []
    return evaluateActionLoop({
      expectedReturn,
      hasEVData,
      activeIdeaCount: workflowData.activeIdeaCount,
      unsimulatedIdeas: workflowData.unsimulatedIdeas,
      stalledProposals: workflowData.stalledProposals,
      unexecutedApprovals: workflowData.unexecutedApprovals,
      thesisDaysStale: thesisDaysStale ?? null,
      ratingChangesWithoutFollowup: ratingChanges ?? [],
    })
  }, [workflowData, expectedReturn, hasEVData, thesisDaysStale, ratingChanges])

  const items = useMemo(
    () => allItems.filter(item => !item.dismissible || !isSuppressed(item.type)),
    [allItems, isSuppressed],
  )

  const redCount = useMemo(
    () => items.filter(i => i.severity === 'red').length,
    [items],
  )
  const orangeCount = useMemo(
    () => items.filter(i => i.severity === 'orange').length,
    [items],
  )

  // ---- Workflow summary ----
  const workflowSummary = useMemo<WorkflowSummary | null>(() => {
    if (!workflowData) return null
    return computeWorkflowSummary({
      thesisDaysStale: thesisDaysStale ?? null,
      activeIdeaCount: workflowData.activeIdeaCount,
      simulatedIdeaCount: workflowData.simulatedIdeaCount,
      stalledProposalCount: workflowData.stalledProposals.length,
      unexecutedApprovalCount: workflowData.unexecutedApprovals.length,
      completedExecutionCount: workflowData.completedExecutionCount,
    })
  }, [workflowData, thesisDaysStale])

  // ---- Dismiss mutation ----
  const dismissMutation = useMutation({
    mutationFn: async (type: ActionItemType) => {
      if (!user) throw new Error('Not authenticated')

      const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

      let query = supabase
        .from('asset_followup_suppressions')
        .select('id')
        .eq('user_id', user.id)
        .eq('asset_id', assetId)
        .eq('followup_type', type)

      if (viewUserId) {
        query = query.eq('view_user_id', viewUserId)
      } else {
        query = query.is('view_user_id', null)
      }

      const { data: existing } = await query.maybeSingle()

      if (existing) {
        const { error } = await supabase
          .from('asset_followup_suppressions')
          .update({ suppressed_until: until, updated_at: new Date().toISOString() })
          .eq('id', existing.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('asset_followup_suppressions')
          .insert({
            user_id: user.id,
            asset_id: assetId,
            view_user_id: viewUserId,
            followup_type: type,
            suppressed_until: until,
          })
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['action-loop-suppressions', assetId, user?.id],
      })
    },
  })

  const isLoading = workflowLoading || thesisLoading || ratingsLoading

  return {
    items,
    itemCount: items.length,
    redCount,
    orangeCount,
    workflowSummary,
    isLoading,
    dismiss: useCallback(
      (type: ActionItemType) => dismissMutation.mutateAsync(type),
      [dismissMutation],
    ),
    isDismissing: dismissMutation.isPending,
  }
}
