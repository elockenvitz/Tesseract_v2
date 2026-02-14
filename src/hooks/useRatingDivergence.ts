/**
 * useRatingDivergence — Combined divergence detection for analyst ratings.
 *
 * Returns state for two independent warning badges:
 * A) Cross-view divergence: analysts disagree on the rating (>1 unique value)
 *    — filtered to only analysts the current user can access
 * B) Rating-vs-EV inconsistency: selected view's rating direction conflicts
 *    with that view's probability-weighted EV return
 *    — scoped to the currently selected view (firm or user)
 *
 * Both are useMemo-derived — no async in the detection path.
 *
 * Suppressions are view-scoped: a user can only suppress the warning for
 * their own user-scoped view (not firm, not another user's view).
 */

import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useAnalystRatings, useRatingScales } from './useAnalystRatings'
import { useExpectedValue, type ViewScope } from './useExpectedValue'
import { getRatingDirection, isDirectionConflict, type RatingDirection } from '../lib/rating-direction'

interface UseRatingDivergenceOptions {
  assetId: string
  currentPrice?: number
  /** Currently selected view scope. Defaults to { type: 'user' } (current user). */
  viewScope?: ViewScope
  /**
   * User IDs the current user has access to see.
   * Used to filter the divergence badge — only show ratings from accessible analysts.
   * If undefined/empty, all ratings returned by useAnalystRatings are shown
   * (server-side RLS is the final gate).
   */
  accessibleUserIds?: string[]
}

interface RatingBreakdownEntry {
  value: string
  label: string
  color: string
  analysts: string[]
}

interface UseRatingDivergenceResult {
  // Badge A: cross-view divergence
  hasCrossViewDivergence: boolean
  ratingBreakdown: RatingBreakdownEntry[]

  // Badge B: rating vs EV inconsistency
  hasEVInconsistency: boolean
  isSuppressed: boolean
  myDirection: RatingDirection | null
  evReturn: number | null
  conflictDescription: string | null

  // Permissions
  /** True when the user can suppress (own user-scoped view only) */
  canSuppress: boolean

  // Actions
  suppress24h: () => Promise<void>
  isSuppressing: boolean
}

export function useRatingDivergence({
  assetId,
  currentPrice,
  viewScope,
  accessibleUserIds,
}: UseRatingDivergenceOptions): UseRatingDivergenceResult {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Resolve effective view scope
  const effectiveScope: ViewScope = viewScope ?? { type: 'user', userId: user?.id }

  // For EV mismatch, determine which user's rating to check:
  // - firm scope: check current user's rating against firm EV
  // - user scope: check that user's rating against that user's EV
  const ratingUserId = effectiveScope.type === 'firm'
    ? user?.id
    : effectiveScope.userId

  const { ratings, myRating } = useAnalystRatings({ assetId })
  const { scales, getRatingLabel, getRatingColor } = useRatingScales()
  const { expectedReturn, hasData: hasEVData } = useExpectedValue({
    assetId,
    currentPrice,
    viewScope: effectiveScope,
  })

  // The rating to check for EV mismatch — may differ from `myRating` when viewing another user's scope
  const viewRating = useMemo(() => {
    if (!ratingUserId) return undefined
    return ratings.find(r => r.user_id === ratingUserId)
  }, [ratings, ratingUserId])

  // ---- Can this user suppress? ----
  // Only allowed for own user-scoped view
  const canSuppress = !!(
    user &&
    effectiveScope.type === 'user' &&
    effectiveScope.userId === user.id
  )

  // ---- Suppression state ----
  // Query scoped to (user_id, asset_id, view_scope_type, view_scope_user_id)
  const scopeType = effectiveScope.type
  const scopeUserId = effectiveScope.type === 'user' ? effectiveScope.userId : null

  const { data: suppression } = useQuery({
    queryKey: ['rating-ev-suppressions', assetId, user?.id, scopeType, scopeUserId],
    queryFn: async () => {
      if (!user) return null
      let query = supabase
        .from('rating_ev_suppressions')
        .select('suppressed_until')
        .eq('user_id', user.id)
        .eq('asset_id', assetId)
        .eq('view_scope_type', scopeType)

      if (scopeUserId) {
        query = query.eq('view_scope_user_id', scopeUserId)
      } else {
        query = query.is('view_scope_user_id', null)
      }

      const { data, error } = await query.maybeSingle()
      if (error) throw error
      return data
    },
    enabled: !!user && !!assetId,
    staleTime: 60_000,
  })

  const isSuppressed = useMemo(() => {
    if (!suppression?.suppressed_until) return false
    return new Date(suppression.suppressed_until) > new Date()
  }, [suppression])

  const suppressMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('Not authenticated')
      if (!canSuppress) throw new Error('Cannot suppress in this view scope')

      const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

      // Upsert with the scoped key.
      // Since we have partial unique indexes (NULL-aware), we do a manual
      // select-then-insert/update to avoid Supabase upsert NULL limitations.
      let query = supabase
        .from('rating_ev_suppressions')
        .select('id')
        .eq('user_id', user.id)
        .eq('asset_id', assetId)
        .eq('view_scope_type', 'user')
        .eq('view_scope_user_id', user.id)

      const { data: existing } = await query.maybeSingle()

      if (existing) {
        const { error } = await supabase
          .from('rating_ev_suppressions')
          .update({ suppressed_until: until })
          .eq('id', existing.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('rating_ev_suppressions')
          .insert({
            user_id: user.id,
            asset_id: assetId,
            view_scope_type: 'user',
            view_scope_user_id: user.id,
            suppressed_until: until,
          })
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['rating-ev-suppressions', assetId, user?.id],
      })
    },
  })

  // ---- Badge A: cross-view divergence ----
  // Filter to accessible analysts only (prevents leaking hidden users' ratings)
  const accessibleRatings = useMemo(() => {
    if (!accessibleUserIds || accessibleUserIds.length === 0) return ratings
    return ratings.filter(r => accessibleUserIds.includes(r.user_id))
  }, [ratings, accessibleUserIds])

  const { hasCrossViewDivergence, ratingBreakdown } = useMemo(() => {
    if (accessibleRatings.length <= 1) {
      return { hasCrossViewDivergence: false, ratingBreakdown: [] as RatingBreakdownEntry[] }
    }

    const uniqueValues = new Set(accessibleRatings.map((r) => r.rating_value))
    if (uniqueValues.size <= 1) {
      return { hasCrossViewDivergence: false, ratingBreakdown: [] as RatingBreakdownEntry[] }
    }

    // Build breakdown: group by value
    const byValue = new Map<string, string[]>()
    for (const r of accessibleRatings) {
      const arr = byValue.get(r.rating_value) || []
      arr.push(r.user?.full_name || 'Unknown')
      byValue.set(r.rating_value, arr)
    }

    // Use the first rating's scale for label/color lookup
    const scaleId = accessibleRatings[0]?.rating_scale_id

    const breakdown: RatingBreakdownEntry[] = Array.from(byValue.entries()).map(
      ([value, analysts]) => ({
        value,
        label: scaleId ? getRatingLabel(scaleId, value) : value,
        color: scaleId ? getRatingColor(scaleId, value) : '#6b7280',
        analysts,
      })
    )

    return { hasCrossViewDivergence: true, ratingBreakdown: breakdown }
  }, [accessibleRatings, getRatingLabel, getRatingColor])

  // ---- Badge B: rating vs EV inconsistency ----
  // Uses the selected view's rating and EV, NOT always the current user's
  const { hasEVInconsistency, myDirection, conflictDescription } = useMemo(() => {
    const none = { hasEVInconsistency: false, myDirection: null as RatingDirection | null, conflictDescription: null as string | null }

    if (!viewRating || !hasEVData || expectedReturn == null || !currentPrice || currentPrice <= 0) {
      return none
    }

    // Find scale values for direction mapping
    const scale = scales.find((s) => s.id === viewRating.rating_scale_id)
    const scaleValues = scale?.values || []

    const direction = getRatingDirection(viewRating.rating_value, scaleValues)

    // Fail closed: if direction is unknown (custom scale without metadata), show no badge
    if (direction === null) return none

    const conflict = isDirectionConflict(direction, expectedReturn)

    if (!conflict) return { ...none, myDirection: direction }

    const evPct = (expectedReturn * 100).toFixed(1)
    const label = scale
      ? scale.values.find((v) => v.value === viewRating.rating_value)?.label || viewRating.rating_value
      : viewRating.rating_value

    const dirWord = direction === 'positive' ? 'positive' : direction === 'negative' ? 'negative' : 'neutral'

    // Adjust description based on view scope
    const ownerPrefix = effectiveScope.type === 'firm'
      ? 'The firm'
      : viewRating.user_id === user?.id
        ? 'Your'
        : `${viewRating.user?.full_name || 'This analyst'}'s`
    const desc = `${ownerPrefix} ${label} rating implies a ${dirWord} outlook, but the probability-weighted EV implies ${evPct}% return.`

    return { hasEVInconsistency: true, myDirection: direction, conflictDescription: desc }
  }, [viewRating, hasEVData, expectedReturn, currentPrice, scales, effectiveScope, user])

  return {
    hasCrossViewDivergence,
    ratingBreakdown,
    hasEVInconsistency,
    isSuppressed,
    myDirection: myDirection ?? null,
    evReturn: expectedReturn,
    conflictDescription,
    canSuppress,
    suppress24h: () => suppressMutation.mutateAsync(),
    isSuppressing: suppressMutation.isPending,
  }
}
