/**
 * useActionLoopFollowups — Follow-up detection and primary insight for ActionLoopModule.
 *
 * Computes three follow-up types:
 * F1: Decision-research gap — a decision was made but research hasn't been updated since
 * F2: High EV, no active idea — EV suggests strong return but no trade idea exists
 * F3: Rating-EV mismatch — analyst rating direction conflicts with probability-weighted EV
 *
 * Also selects a single "Primary Insight" (the most important signal to surface
 * in the collapsed summary strip).
 *
 * Per-type 24-hour suppression via asset_followup_suppressions.followup_type.
 */

import { useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useExpectedValue, type ViewScope } from './useExpectedValue'
import { useRatingDivergence } from './useRatingDivergence'
import type { LatestDecisionInfo, ActionLoopIdea } from './useActionLoop'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FollowupType = 'decision_research_gap' | 'high_ev_no_idea' | 'rating_ev_mismatch'

export interface FollowupItem {
  type: FollowupType
  /** Short headline for the row */
  headline: string
  /** Longer description */
  detail: string
  /** CTA label */
  ctaLabel: string
  /** CTA action key for the parent to handle */
  ctaAction: 'update_rating' | 'update_targets' | 'update_thesis' | 'create_idea' | 'open_trade_lab'
  /** Whether this item is currently suppressed */
  isSuppressed: boolean
}

export interface PrimaryInsight {
  text: string
  tone: 'amber' | 'blue' | 'neutral'
}

interface UseActionLoopFollowupsOptions {
  assetId: string
  viewFilter: 'aggregated' | string
  currentPrice?: number
  accessibleUserIds?: string[]
  /** Already computed from useActionLoop */
  latestDecisionInfo: LatestDecisionInfo | null
  researchTimestamp: string | null
  /** Active ideas from useActionLoop */
  ideas: ActionLoopIdea[]
  activeCount: number
}

interface UseActionLoopFollowupsResult {
  followups: FollowupItem[]
  /** Visible (non-suppressed) follow-ups */
  visibleFollowups: FollowupItem[]
  followupCount: number
  primaryInsight: PrimaryInsight | null
  suppress24h: (type: FollowupType) => Promise<void>
  isSuppressing: boolean
}

// ---------------------------------------------------------------------------
// EV thresholds
// ---------------------------------------------------------------------------

/** Minimum absolute EV return to trigger F2 (high EV, no idea) */
const HIGH_EV_THRESHOLD = 0.15 // 15%

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useActionLoopFollowups({
  assetId,
  viewFilter,
  currentPrice,
  accessibleUserIds,
  latestDecisionInfo,
  researchTimestamp,
  ideas,
  activeCount,
}: UseActionLoopFollowupsOptions): UseActionLoopFollowupsResult {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const isAggregated = viewFilter === 'aggregated'
  const viewUserId = isAggregated ? null : viewFilter

  // ---- View scope for EV and rating hooks ----
  const viewScope: ViewScope = useMemo(() => {
    if (isAggregated) return { type: 'firm' }
    return { type: 'user', userId: viewFilter }
  }, [isAggregated, viewFilter])

  // ---- EV data (for F2 + F3) ----
  const { expectedReturn, hasData: hasEVData } = useExpectedValue({
    assetId,
    currentPrice,
    viewScope,
  })

  // ---- Rating divergence (for F3) ----
  const {
    hasEVInconsistency,
    conflictDescription,
    evReturn,
  } = useRatingDivergence({
    assetId,
    currentPrice,
    viewScope,
    accessibleUserIds,
  })

  // ---- Suppressions query (all types for this asset+view) ----
  const { data: suppressions } = useQuery({
    queryKey: ['followup-suppressions', assetId, user?.id, viewUserId],
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

  const isSuppressedByType = useCallback((type: FollowupType): boolean => {
    if (!suppressions) return false
    const row = suppressions.find(s => s.followup_type === type)
    if (!row?.suppressed_until) return false
    return new Date(row.suppressed_until) > new Date()
  }, [suppressions])

  // ---- Suppress mutation ----
  const suppressMutation = useMutation({
    mutationFn: async (type: FollowupType) => {
      if (!user) throw new Error('Not authenticated')

      const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

      // Check-then-upsert
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
        queryKey: ['followup-suppressions', assetId, user?.id],
      })
    },
  })

  // ---- F1: Decision-research gap ----
  const f1 = useMemo<FollowupItem | null>(() => {
    if (!latestDecisionInfo) return null
    const Td = latestDecisionInfo.date
    if (!Td) return null
    if (researchTimestamp && researchTimestamp >= Td) return null

    const actionLabel = latestDecisionInfo.action.charAt(0).toUpperCase() + latestDecisionInfo.action.slice(1)

    return {
      type: 'decision_research_gap' as const,
      headline: 'Research may need updating',
      detail: `A ${actionLabel.toLowerCase()} was executed in ${latestDecisionInfo.portfolio}. Rating, targets, or thesis may be stale.`,
      ctaLabel: 'Update thesis',
      ctaAction: 'update_thesis',
      isSuppressed: isSuppressedByType('decision_research_gap'),
    }
  }, [latestDecisionInfo, researchTimestamp, isSuppressedByType])

  // ---- F2: High EV, no active idea ----
  const f2 = useMemo<FollowupItem | null>(() => {
    if (!hasEVData || expectedReturn == null) return null
    if (Math.abs(expectedReturn) < HIGH_EV_THRESHOLD) return null
    if (activeCount > 0) return null // Already has active ideas

    const evPct = (expectedReturn * 100).toFixed(0)
    const direction = expectedReturn > 0 ? 'upside' : 'downside'

    return {
      type: 'high_ev_no_idea' as const,
      headline: `${evPct}% expected ${direction}, no active idea`,
      detail: `Probability-weighted EV implies ${evPct}% return but no trade idea is active. Consider creating one.`,
      ctaLabel: 'New idea',
      ctaAction: 'create_idea',
      isSuppressed: isSuppressedByType('high_ev_no_idea'),
    }
  }, [hasEVData, expectedReturn, activeCount, isSuppressedByType])

  // ---- F3: Rating-EV mismatch ----
  const f3 = useMemo<FollowupItem | null>(() => {
    if (!hasEVInconsistency) return null

    return {
      type: 'rating_ev_mismatch' as const,
      headline: 'Rating and EV diverge',
      detail: conflictDescription || 'Rating direction conflicts with probability-weighted expected value.',
      ctaLabel: 'Update rating',
      ctaAction: 'update_rating',
      isSuppressed: isSuppressedByType('rating_ev_mismatch'),
    }
  }, [hasEVInconsistency, conflictDescription, isSuppressedByType])

  // ---- Aggregate follow-ups ----
  const followups = useMemo<FollowupItem[]>(() => {
    const items: FollowupItem[] = []
    if (f1) items.push(f1)
    if (f3) items.push(f3) // F3 before F2 (more actionable)
    if (f2) items.push(f2)
    return items
  }, [f1, f2, f3])

  const visibleFollowups = useMemo(
    () => followups.filter(f => !f.isSuppressed),
    [followups]
  )

  // ---- Primary Insight ----
  // Priority: F1 > F3 > F2 > neutral fallback based on state
  const primaryInsight = useMemo<PrimaryInsight | null>(() => {
    // If there's a visible F1
    if (f1 && !f1.isSuppressed) {
      return { text: f1.headline, tone: 'amber' }
    }
    // If there's a visible F3
    if (f3 && !f3.isSuppressed) {
      return { text: f3.headline, tone: 'amber' }
    }
    // If there's a visible F2
    if (f2 && !f2.isSuppressed) {
      return { text: f2.headline, tone: 'blue' }
    }
    // Neutral fallbacks
    if (activeCount > 0) {
      return { text: `${activeCount} active idea${activeCount > 1 ? 's' : ''} in progress`, tone: 'neutral' }
    }
    return null
  }, [f1, f2, f3, activeCount])

  return {
    followups,
    visibleFollowups,
    followupCount: visibleFollowups.length,
    primaryInsight,
    suppress24h: useCallback((type: FollowupType) => suppressMutation.mutateAsync(type), [suppressMutation]),
    isSuppressing: suppressMutation.isPending,
  }
}
