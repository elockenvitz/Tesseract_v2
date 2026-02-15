/**
 * useActionLoopCards — Data hook for the prescriptive Action Loop.
 *
 * Gathers workflow state for 4 triggers, calls the pure evaluator,
 * applies per-type suppression, and exposes a dismiss mutation.
 *
 * Queries:
 *   1. Active ideas for this asset (view-scoped)
 *   2. Lab variants + proposals to detect unsimulated ideas
 *   3. Items at 'deciding' stage with no decision (stalled proposals)
 *   4. Items with decision_outcome='accepted' but no execution
 *   5. Expected return (via useExpectedValue)
 *   6. Suppressions (from asset_followup_suppressions)
 */

import { useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useExpectedValue, type ViewScope } from './useExpectedValue'
import {
  evaluateActionLoop,
  STALLED_DAYS_THRESHOLD,
  type ActionCard,
  type CardType,
} from '../lib/assetActionLoopEvaluator'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UseActionLoopCardsOptions {
  assetId: string
  viewFilter: 'aggregated' | string
  currentPrice?: number
}

interface UseActionLoopCardsResult {
  cards: ActionCard[]
  cardCount: number
  isLoading: boolean
  dismiss: (type: CardType) => Promise<void>
  isDismissing: boolean
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useActionLoopCards({
  assetId,
  viewFilter,
  currentPrice,
}: UseActionLoopCardsOptions): UseActionLoopCardsResult {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const isAggregated = viewFilter === 'aggregated'
  const viewUserId = isAggregated ? null : viewFilter

  // ---- EV data (Trigger A) ----
  const viewScope: ViewScope = useMemo(() => {
    if (isAggregated) return { type: 'firm' }
    return { type: 'user', userId: viewFilter }
  }, [isAggregated, viewFilter])

  const { expectedReturn, hasData: hasEVData } = useExpectedValue({
    assetId,
    currentPrice,
    viewScope,
  })

  // ---- Workflow state (Triggers A–D) ----
  const { data: workflowData, isLoading } = useQuery({
    queryKey: ['action-loop-cards', assetId, viewFilter],
    queryFn: async () => {
      // --- Active ideas ---
      let ideaQ = supabase
        .from('trade_queue_items')
        .select('id, action, rationale, stage, created_by')
        .eq('asset_id', assetId)
        .eq('visibility_tier', 'active')
        .is('outcome', null)

      // --- Items at 'deciding' stage with no decision (Trigger C) ---
      let stalledQ = supabase
        .from('trade_queue_items')
        .select('id, action, updated_at, created_by, portfolios:portfolio_id (id, name)')
        .eq('asset_id', assetId)
        .eq('visibility_tier', 'active')
        .eq('stage', 'deciding')
        .is('decision_outcome', null)

      // --- Items with accepted decision but no execution (Trigger D) ---
      let unexecQ = supabase
        .from('trade_queue_items')
        .select('id, action, decided_at, created_by, portfolios:portfolio_id (id, name)')
        .eq('asset_id', assetId)
        .eq('visibility_tier', 'active')
        .eq('decision_outcome', 'accepted')
        .is('outcome', null)

      // View-scope all queries
      if (!isAggregated) {
        ideaQ = ideaQ.eq('created_by', viewFilter)
        stalledQ = stalledQ.eq('created_by', viewFilter)
        unexecQ = unexecQ.eq('created_by', viewFilter)
      }

      const [ideasRes, stalledRes, unexecRes] = await Promise.all([
        ideaQ, stalledQ, unexecQ,
      ])

      if (ideasRes.error) throw ideasRes.error
      if (stalledRes.error) throw stalledRes.error
      if (unexecRes.error) throw unexecRes.error

      const ideas = ideasRes.data || []

      // --- Detect unsimulated ideas (Trigger B) ---
      let unsimulatedIdeas = ideas
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
        unsimulatedIdeas: unsimulatedIdeas.map(i => ({
          id: i.id,
          action: i.action as string,
          rationale: (i.rationale as string) || '',
        })),
        stalledProposals,
        unexecutedApprovals,
      }
    },
    enabled: !!assetId,
    staleTime: 60_000,
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
    (type: CardType): boolean => {
      if (!suppressions) return false
      const row = suppressions.find(s => s.followup_type === type)
      if (!row?.suppressed_until) return false
      return new Date(row.suppressed_until) > new Date()
    },
    [suppressions],
  )

  // ---- Evaluate + filter ----
  const allCards = useMemo(() => {
    if (!workflowData) return []
    return evaluateActionLoop({
      expectedReturn,
      hasEVData,
      activeIdeaCount: workflowData.activeIdeaCount,
      unsimulatedIdeas: workflowData.unsimulatedIdeas,
      stalledProposals: workflowData.stalledProposals,
      unexecutedApprovals: workflowData.unexecutedApprovals,
    })
  }, [workflowData, expectedReturn, hasEVData])

  const cards = useMemo(
    () => allCards.filter(c => !isSuppressed(c.type)),
    [allCards, isSuppressed],
  )

  // ---- Dismiss mutation ----
  const dismissMutation = useMutation({
    mutationFn: async (type: CardType) => {
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

  return {
    cards,
    cardCount: cards.length,
    isLoading,
    dismiss: useCallback(
      (type: CardType) => dismissMutation.mutateAsync(type),
      [dismissMutation],
    ),
    isDismissing: dismissMutation.isPending,
  }
}
