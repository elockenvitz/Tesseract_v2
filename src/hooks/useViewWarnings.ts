/**
 * useViewWarnings — Unified integrity-warning system for the asset page.
 *
 * Composes existing badge logic (divergence, EV mismatch) with new
 * revision-aware rules (W3-W5) into a single queryable structure so
 * the header indicator and individual tile badges stay in sync.
 *
 * All warnings are real-time computed — nothing is logged to Evolution.
 */

import { useMemo } from 'react'
import { useAssetRevisions, type RevisionRow } from './useAssetRevisions'
import { useRatingDivergence } from './useRatingDivergence'
import { useExpectedValue, type ViewScope } from './useExpectedValue'
import { useAnalystRatings } from './useAnalystRatings'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WarningSeverity = 'warning' | 'info'
export type WarningTile = 'rating' | 'targets' | 'risks' | 'evolution' | 'other'

export interface WarningItem {
  id: string
  severity: WarningSeverity
  tile: WarningTile
  title: string
  message: string
  anchorId: string
  actions?: { label: string; fn: () => void }[]
}

export interface ViewWarningsResult {
  all: WarningItem[]
  byTile: Record<string, WarningItem[]>
  count: number
  countBySeverity: { warning: number; info: number }
}

// ---------------------------------------------------------------------------
// Helpers for revision-based warnings
// ---------------------------------------------------------------------------

/**
 * From revision events up to a given revision, reconstruct the latest
 * field_key → value map for a specific view scope.
 */
function deriveStateUpToRevision(
  revisions: RevisionRow[],
  scopeType: 'firm' | 'user',
  scopeUserId: string | null | undefined,
  upToRevisionId: string
): Map<string, string> {
  const state = new Map<string, string>()

  // revisions come newest-first from the hook; we need oldest-first
  const sorted = [...revisions]
    .filter(r => {
      if (r.view_scope_type !== scopeType) return false
      if (scopeType === 'user' && r.view_scope_user_id !== scopeUserId) return false
      return true
    })
    .sort((a, b) => new Date(a.last_activity_at).getTime() - new Date(b.last_activity_at).getTime())

  for (const rev of sorted) {
    for (const evt of rev.events) {
      if (evt.after_value != null) {
        state.set(evt.field_key, evt.after_value)
      }
    }
    if (rev.id === upToRevisionId) break
  }
  return state
}

/**
 * Find the two most recent distinct published revisions in the same view scope.
 * Returns [current, previous] or nulls if insufficient history.
 */
function findCurrentAndPreviousRevision(
  revisions: RevisionRow[],
  scopeType: 'firm' | 'user',
  scopeUserId: string | null | undefined
): [RevisionRow | null, RevisionRow | null] {
  const scoped = revisions
    .filter(r => {
      if (r.view_scope_type !== scopeType) return false
      if (scopeType === 'user' && r.view_scope_user_id !== scopeUserId) return false
      return true
    })
    // newest-first (already from hook, but be safe)
    .sort((a, b) => new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime())

  if (scoped.length < 2) return [scoped[0] ?? null, null]
  return [scoped[0], scoped[1]]
}

/**
 * Compute expected return from a state map + current price.
 * Looks for targets.*.price and targets.*.prob keys.
 */
function computeEVReturnFromState(
  state: Map<string, string>,
  currentPrice: number
): number | null {
  const targets: { price: number; prob: number }[] = []

  // Group by scenario: targets.{scenario}.price / targets.{scenario}.prob
  const scenarios = new Map<string, { price?: number; prob?: number }>()

  for (const [key, val] of state) {
    const parts = key.split('.')
    if (parts[0] !== 'targets' || parts.length < 3) continue
    const scenario = parts[1]
    const metric = parts[2]
    if (!scenarios.has(scenario)) scenarios.set(scenario, {})
    const s = scenarios.get(scenario)!
    if (metric === 'price') s.price = parseFloat(val)
    if (metric === 'prob' || metric === 'probability') s.prob = parseFloat(val)
  }

  for (const s of scenarios.values()) {
    if (s.price && s.price > 0 && s.prob != null && s.prob > 0) {
      targets.push({ price: s.price, prob: s.prob })
    }
  }

  if (targets.length === 0 || currentPrice <= 0) return null

  const totalProb = targets.reduce((sum, t) => sum + t.prob, 0)
  if (totalProb <= 0) return null

  const ev = targets.reduce((sum, t) => sum + t.price * t.prob, 0) / totalProb
  return (ev - currentPrice) / currentPrice
}

/**
 * Extract rating value from a state map.
 * Looks for rating.*.value field_key.
 */
function getRatingValueFromState(state: Map<string, string>): string | null {
  for (const [key, val] of state) {
    if (key.startsWith('rating.') && key.endsWith('.value')) {
      return val
    }
  }
  return null
}

/**
 * Check whether any event in the revision modified a risks_to_thesis field.
 */
function hasRisksChange(revision: RevisionRow): boolean {
  return revision.events.some(e => e.category === 'risks_to_thesis')
}

/**
 * Check whether any event in the revision modified a valuation_targets field
 * (price or probability).
 */
function hasTargetChange(revision: RevisionRow): boolean {
  return revision.events.some(
    e => e.category === 'valuation_targets' &&
      (e.field_key.endsWith('.price') || e.field_key.endsWith('.prob') || e.field_key.endsWith('.probability'))
  )
}

/**
 * Check whether any event in the revision modified a rating field.
 */
function hasRatingChangeInRevision(revision: RevisionRow): boolean {
  return revision.events.some(e => e.category === 'rating')
}

/**
 * Extract bear probability from a state map.
 * Looks for targets.bear.prob or targets.bear.probability.
 */
function getBearProbFromState(state: Map<string, string>): number | null {
  for (const [key, val] of state) {
    if (
      (key === 'targets.bear.prob' || key === 'targets.bear.probability') &&
      val != null
    ) {
      return parseFloat(val)
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// MAIN HOOK
// ---------------------------------------------------------------------------

interface UseViewWarningsOptions {
  assetId: string
  viewScope?: ViewScope
  currentPrice?: number
  accessibleUserIds?: string[]
}

export function useViewWarnings({
  assetId,
  viewScope,
  currentPrice,
  accessibleUserIds,
}: UseViewWarningsOptions): ViewWarningsResult {
  // ---- Existing badge logic (reuse, don't duplicate) ----
  const {
    hasCrossViewDivergence,
    ratingBreakdown,
    hasEVInconsistency,
    isSuppressed: evSuppressed,
    myDirection,
    evReturn,
    conflictDescription,
  } = useRatingDivergence({ assetId, currentPrice, viewScope, accessibleUserIds })

  // ---- Current EV for this view ----
  const { expectedReturn: currentEVReturn } = useExpectedValue({
    assetId,
    currentPrice,
    viewScope,
  })

  // ---- Current rating (for comparison) ----
  const { ratings } = useAnalystRatings({ assetId })

  // ---- Revision history ----
  const { revisions } = useAssetRevisions(assetId)

  // Resolve scope params
  const scopeType = viewScope?.type ?? 'user'
  const scopeUserId = viewScope?.type === 'user' ? viewScope.userId : null

  // For rating comparison we need the rating of the user whose view we're in
  const viewRatingValue = useMemo(() => {
    if (scopeType === 'firm') return null // firm scope doesn't have a single rating
    const r = ratings.find(r => r.user_id === scopeUserId)
    return r?.rating_value ?? null
  }, [ratings, scopeType, scopeUserId])

  // ---- Build warnings ----
  const warnings = useMemo<WarningItem[]>(() => {
    const items: WarningItem[] = []

    // W1 — Cross-view divergence (from existing badge)
    if (hasCrossViewDivergence) {
      const analystCount = ratingBreakdown.reduce((sum, b) => sum + b.analysts.length, 0)
      items.push({
        id: 'divergence',
        severity: 'warning',
        tile: 'rating',
        title: 'Rating divergence',
        message: `${analystCount} analysts have differing ratings on this asset.`,
        anchorId: 'asset-warning-anchor-rating',
      })
    }

    // W2 — EV mismatch (from existing badge, respect suppression)
    if (hasEVInconsistency && !evSuppressed) {
      items.push({
        id: 'ev-mismatch',
        severity: 'warning',
        tile: 'rating',
        title: 'EV conflict',
        message: conflictDescription || 'Rating direction conflicts with expected value.',
        anchorId: 'asset-warning-anchor-rating',
      })
    }

    // --- Revision-based warnings (W3, W4, W5) ---
    // Only compute if we have at least 2 revisions in scope and a current price
    const [currentRev, previousRev] = findCurrentAndPreviousRevision(
      revisions, scopeType, scopeUserId
    )

    if (currentRev && previousRev && currentPrice && currentPrice > 0) {
      const previousState = deriveStateUpToRevision(
        revisions, scopeType, scopeUserId, previousRev.id
      )
      const currentState = deriveStateUpToRevision(
        revisions, scopeType, scopeUserId, currentRev.id
      )

      // W3 — Large EV shift without rating change
      const prevEV = computeEVReturnFromState(previousState, currentPrice)
      const currEV = currentEVReturn ?? computeEVReturnFromState(currentState, currentPrice)

      if (prevEV != null && currEV != null) {
        const evShift = Math.abs(currEV - prevEV)
        // 15 percentage points = 0.15
        if (evShift >= 0.15) {
          // Check if rating changed between previous and current
          const prevRating = getRatingValueFromState(previousState)
          const currRating = viewRatingValue ?? getRatingValueFromState(currentState)

          // If rating unchanged (or both null), fire W3
          if (prevRating != null && currRating != null && prevRating === currRating) {
            items.push({
              id: 'ev-shift-no-rating',
              severity: 'warning',
              tile: 'targets',
              title: 'EV shift, rating unchanged',
              message: 'EV shifted materially since last revision, but rating unchanged.',
              anchorId: 'asset-warning-anchor-targets',
            })
          }
        }
      }

      // W4 — Rating change without target change
      if (hasRatingChangeInRevision(currentRev) && !hasTargetChange(currentRev)) {
        items.push({
          id: 'rating-no-target',
          severity: 'info',
          tile: 'rating',
          title: 'Rating changed, no target update',
          message: 'Rating changed without adjustment to valuation assumptions.',
          anchorId: 'asset-warning-anchor-rating',
        })
      }

      // W5 — Risks updated without bear probability adjustment
      if (hasRisksChange(currentRev)) {
        const prevBear = getBearProbFromState(previousState)
        const currBear = getBearProbFromState(currentState)

        if (prevBear != null && currBear != null && prevBear === currBear) {
          items.push({
            id: 'risks-no-bear-adj',
            severity: 'info',
            tile: 'risks',
            title: 'Risks updated, bear unchanged',
            message: 'Risks updated but downside probability unchanged.',
            anchorId: 'asset-warning-anchor-risks',
          })
        }
      }
    }

    return items
  }, [
    hasCrossViewDivergence,
    ratingBreakdown,
    hasEVInconsistency,
    evSuppressed,
    conflictDescription,
    revisions,
    scopeType,
    scopeUserId,
    currentPrice,
    currentEVReturn,
    viewRatingValue,
  ])

  // ---- Derived outputs ----
  const byTile = useMemo(() => {
    const map: Record<string, WarningItem[]> = {}
    for (const w of warnings) {
      if (!map[w.tile]) map[w.tile] = []
      map[w.tile].push(w)
    }
    return map
  }, [warnings])

  const countBySeverity = useMemo(() => {
    let warning = 0
    let info = 0
    for (const w of warnings) {
      if (w.severity === 'warning') warning++
      else info++
    }
    return { warning, info }
  }, [warnings])

  return {
    all: warnings,
    byTile,
    count: warnings.length,
    countBySeverity,
  }
}
