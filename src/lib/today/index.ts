/**
 * Today — the production surface's domain layer.
 *
 * Real evaluator output in, a finite ranked set of visually-typed items out.
 * No new queries, no schema change, no second ranking engine.
 */

export type {
  TodayTier,
  TodayArchetype,
  TodayMetric,
  TodayVisual,
  TodayItem,
} from './types'
export { TIER_NAMES } from './types'

export {
  tierFor,
  compareTodayItems,
  selectToday,
  TODAY_LIMIT,
} from './tiers'
export type { TodaySelection } from './tiers'

export { adaptDecisionItem, visualFor, targetFor } from './adapt'

export { expandToObjects, isAggregate } from './expand'
export type { AggregateNote, ExpandedCandidates } from './expand'

export { diversify, MAX_PER_KEY, TIER_REACH, SCORE_TOLERANCE } from './diversity'
export { applyEnrichment, priceWindowSince, windowLabel } from './enrich'
export type { TodayEnrichment, EnrichmentMap, PriceWindow } from './enrich'
