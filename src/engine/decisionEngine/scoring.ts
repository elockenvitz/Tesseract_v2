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

  // Age factor
  score += computeAge(item, now) * 50

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
