/**
 * useActionLoop — Unified hook for ActionLoopModule.
 *
 * Provides view-scoped trade ideas, recent decisions, and Td/Tr timestamps
 * for follow-up detection. Suppression and follow-up detection are handled
 * by useActionLoopFollowups (which consumes latestDecision + researchTimestamp).
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAssetRevisions, type RevisionRow } from './useAssetRevisions'
import type { TradeAction, TradeStage, TradeOutcome, DecisionOutcome } from '../types/trading'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActionLoopIdea {
  id: string
  rationale: string
  action: TradeAction
  stage: TradeStage
  urgency: string
  proposed_weight: number | null
  proposed_shares: number | null
  created_by: string | null
  updated_at: string
  portfolio: { id: string; name: string } | null
  creator: { id: string; first_name: string | null; last_name: string | null } | null
}

export interface ActionLoopDecision {
  id: string
  action: TradeAction
  outcome: TradeOutcome | null
  decision_outcome: DecisionOutcome | null
  outcome_at: string | null
  decided_at: string | null
  proposed_weight: number | null
  proposed_shares: number | null
  rationale: string
  portfolio: { id: string; name: string } | null
  created_by: string | null
}

export interface LatestDecisionInfo {
  action: TradeAction
  date: string
  portfolio: string
}

export interface FollowUpState {
  latestDecision: LatestDecisionInfo | null
  researchTimestamp: string | null
}

interface UseActionLoopOptions {
  assetId: string
  viewFilter: 'aggregated' | string
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useActionLoop({ assetId, viewFilter }: UseActionLoopOptions) {
  const isAggregated = viewFilter === 'aggregated'
  const LIMIT = 5

  // ---- Active ideas (view-scoped) ----
  const { data: ideasData, isLoading: ideasLoading } = useQuery({
    queryKey: ['action-loop-ideas', assetId, viewFilter],
    queryFn: async () => {
      let query = supabase
        .from('trade_queue_items')
        .select(`
          id, rationale, action, stage, urgency,
          proposed_weight, proposed_shares, created_by, updated_at,
          portfolios:portfolio_id (id, name),
          users:created_by (id, first_name, last_name)
        `)
        .eq('asset_id', assetId)
        .eq('visibility_tier', 'active')
        .is('outcome', null)
        .order('updated_at', { ascending: false })
        .limit(LIMIT + 1)

      if (!isAggregated) {
        query = query.eq('created_by', viewFilter)
      }

      const { data, error } = await query
      if (error) throw error

      return (data || []).map((row: any) => ({
        id: row.id,
        rationale: row.rationale || '',
        action: row.action,
        stage: row.stage,
        urgency: row.urgency,
        proposed_weight: row.proposed_weight,
        proposed_shares: row.proposed_shares,
        created_by: row.created_by,
        updated_at: row.updated_at,
        portfolio: row.portfolios || null,
        creator: row.users || null,
      })) as ActionLoopIdea[]
    },
    enabled: !!assetId,
    staleTime: 30_000,
  })

  const ideas = useMemo(() => ideasData?.slice(0, LIMIT) ?? [], [ideasData])
  const hasMoreIdeas = (ideasData?.length ?? 0) > LIMIT
  const activeCount = ideas.length

  // ---- Recent decisions (view-scoped) ----
  const { data: decisionsData, isLoading: decisionsLoading } = useQuery({
    queryKey: ['action-loop-decisions', assetId, viewFilter],
    queryFn: async () => {
      // Two queries: items with outcome, items with decision_outcome
      let q1 = supabase
        .from('trade_queue_items')
        .select(`
          id, action, outcome, decision_outcome, outcome_at, decided_at,
          proposed_weight, proposed_shares, rationale, created_by,
          portfolios:portfolio_id (id, name)
        `)
        .eq('asset_id', assetId)
        .not('outcome', 'is', null)
        .order('outcome_at', { ascending: false, nullsFirst: false })
        .limit(LIMIT + 1)

      let q2 = supabase
        .from('trade_queue_items')
        .select(`
          id, action, outcome, decision_outcome, outcome_at, decided_at,
          proposed_weight, proposed_shares, rationale, created_by,
          portfolios:portfolio_id (id, name)
        `)
        .eq('asset_id', assetId)
        .not('decision_outcome', 'is', null)
        .order('decided_at', { ascending: false, nullsFirst: false })
        .limit(LIMIT + 1)

      if (!isAggregated) {
        q1 = q1.eq('created_by', viewFilter)
        q2 = q2.eq('created_by', viewFilter)
      }

      const [{ data: d1, error: e1 }, { data: d2, error: e2 }] = await Promise.all([q1, q2])
      if (e1) throw e1
      if (e2) throw e2

      const map = new Map<string, any>()
      for (const row of [...(d1 || []), ...(d2 || [])]) {
        if (!map.has(row.id)) map.set(row.id, row)
      }

      return Array.from(map.values())
        .map((row: any) => ({
          id: row.id,
          action: row.action,
          outcome: row.outcome,
          decision_outcome: row.decision_outcome,
          outcome_at: row.outcome_at,
          decided_at: row.decided_at,
          proposed_weight: row.proposed_weight,
          proposed_shares: row.proposed_shares,
          rationale: row.rationale || '',
          portfolio: row.portfolios || null,
          created_by: row.created_by,
        } as ActionLoopDecision))
        .sort((a, b) => {
          const dateA = a.outcome_at || a.decided_at || ''
          const dateB = b.outcome_at || b.decided_at || ''
          return dateB.localeCompare(dateA)
        })
    },
    enabled: !!assetId,
    staleTime: 60_000,
  })

  const decisions = useMemo(() => decisionsData?.slice(0, LIMIT) ?? [], [decisionsData])
  const hasMoreDecisions = (decisionsData?.length ?? 0) > LIMIT

  // ---- Revisions (for follow-up detection) ----
  const { revisions } = useAssetRevisions(assetId)

  // ---- Td: latest decision timestamp ----
  const latestDecisionInfo = useMemo<LatestDecisionInfo | null>(() => {
    if (!decisionsData || decisionsData.length === 0) return null

    let latest: ActionLoopDecision | null = null
    let latestDate = ''

    for (const dec of decisionsData) {
      const d = dec.outcome_at || dec.decided_at || ''
      if (d > latestDate) {
        latestDate = d
        latest = dec
      }
    }

    if (!latest || !latestDate) return null

    return {
      action: latest.action,
      date: latestDate,
      portfolio: latest.portfolio?.name || 'Unknown',
    }
  }, [decisionsData])

  // ---- Tr: latest research update timestamp ----
  const researchTimestamp = useMemo<string | null>(() => {
    if (!revisions || revisions.length === 0) return null

    const RESEARCH_CATEGORIES = new Set(['thesis', 'valuation_targets', 'risks_to_thesis'])

    const relevant = revisions.filter((rev: RevisionRow) => {
      if (!isAggregated && rev.actor_user_id !== viewFilter) return false
      return rev.events.some(e => RESEARCH_CATEGORIES.has(e.category))
    })

    if (relevant.length === 0) return null

    let maxDate = ''
    for (const rev of relevant) {
      if (rev.last_activity_at > maxDate) maxDate = rev.last_activity_at
    }
    return maxDate || null
  }, [revisions, isAggregated, viewFilter])

  // Follow-up state (Td/Tr only — detection/suppression is in useActionLoopFollowups)
  const followUp: FollowUpState = {
    latestDecision: latestDecisionInfo,
    researchTimestamp,
  }

  const isLoading = ideasLoading && decisionsLoading

  return {
    ideas,
    ideasLoading,
    hasMoreIdeas,
    activeCount,
    decisions,
    decisionsLoading,
    hasMoreDecisions,
    followUp,
    isLoading,
  }
}
