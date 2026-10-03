/**
 * Tier-aware scoring for the Global Decision Engine.
 *
 * Sort priority: tier → severity → age, with deterministic tiebreakers.
 *
 * Tier weights dominate so capital-tier items always rank above
 * coverage-tier items regardless of severity. Within a tier,
 * severity and age provide the ordering.
 */

import type { DecisionItem, DecisionTier, DecisionSeverity, DecisionCategory } from './types'

// ---------------------------------------------------------------------------
// Weight tables
// ---------------------------------------------------------------------------

export const TIER_WEIGHT: Record<DecisionTier, number> = {
  capital: 30000,
  integrity: 20000,
  coverage: 10000,
}

export const SEVERITY_WEIGHT: Record<DecisionSeverity, number> = {
  red: 10000,
  orange: 7000,
  yellow: 5000,
  blue: 3000,
  gray: 1000,
}

export const CATEGORY_WEIGHT: Record<DecisionCategory, number> = {
  process: 2000,
  project: 1500,
  risk: 1200,
  alpha: 800,
  catalyst: 600,
  prompt: 1000,
}

/**
 * The user asked for this one.
 *
 * Every other producer infers that something needs attention. A
 * `READY_TO_REVISIT` candidate exists because a person set a date and asked
 * to be shown it, and that is better evidence of relevance than any
 * heuristic in this file.
 *
 * Sized DELIBERATELY SMALL: 1500 is less than one severity step (2000
 * between yellow and orange) and a twentieth of a tier step. So an
 * explicitly parked idea outranks an inferred finding of the same severity
 * and tier, and loses to anything genuinely more serious. It cannot promote
 * a coverage item above a capital one, and it cannot put a quiet reminder
 * above a red reconciliation break.
 *
 * "Memory candidate always first" would have been the easy rule and the
 * wrong one — the feed has to stay about what matters, not about what the
 * newest subsystem produced.
 */
export const USER_REQUESTED_BONUS = 1500

/**
 * Per deterministic change found while the work was parked.
 *
 * Capped at three, so the most this contributes is 900 — still under one
 * severity step. Something that moved while you were away is more worth
 * your attention than something that did not, but "four facts" is not
 * evidence of importance, only of activity.
 */
export const EVIDENCE_BONUS = 300
export const MAX_EVIDENCE_COUNTED = 3

// ---------------------------------------------------------------------------
// Deterministic tiebreaker
// ---------------------------------------------------------------------------

/**
 * Stable string key for deterministic ordering when scores are equal.
 * Sorted lexicographically ascending so earlier titleKeys / tickers / ids
 * appear first (consistent across runs).
 */
function tiebreaker(item: DecisionItem): string {
  return [
    item.titleKey ?? '',
    item.context.assetTicker ?? '',
    item.id,
  ].join(':')
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function computeAge(item: DecisionItem, now: Date): number {
  if (!item.createdAt) return 0
  const created = new Date(item.createdAt)
  return Math.max(0, Math.floor((now.getTime() - created.getTime()) / 86400000))
}

export function computeSortScore(item: DecisionItem, now: Date): number {
  // Tier (dominant)
  let score = TIER_WEIGHT[item.decisionTier ?? 'coverage']

  // Severity
  score += SEVERITY_WEIGHT[item.severity]

  // Category (action items only)
  if (item.surface === 'action') {
    score += CATEGORY_WEIGHT[item.category] || 0
  }

  // Age factor. For a parked item `createdAt` is when it was PARKED, so
  // overdue magnitude is already priced here and needs no second term.
  score += computeAge(item, now) * 50

  // Explicit user intent, and evidence that something moved. Both are
  // additive and both are small — see the constants above for why.
  if (item.userRequested) score += USER_REQUESTED_BONUS
  if (item.evidenceCount) {
    score += Math.min(item.evidenceCount, MAX_EVIDENCE_COUNTED) * EVIDENCE_BONUS
  }

  return score
}

/**
 * Compare function for deterministic descending sort.
 * Primary: sortScore desc. Tiebreaker: lexicographic asc on composite key.
 */
export function compareItems(a: DecisionItem, b: DecisionItem): number {
  if (b.sortScore !== a.sortScore) return b.sortScore - a.sortScore
  // Deterministic tiebreaker
  const ta = tiebreaker(a)
  const tb = tiebreaker(b)
  if (ta < tb) return -1
  if (ta > tb) return 1
  return 0
}
