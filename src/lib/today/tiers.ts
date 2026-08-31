/**
 * Today — tier-first ordering.
 *
 * ── Why this is a new map rather than a reuse of mobile's ─────────────────
 *
 * `lib/signals/feed-priority.ts` has the ranking discipline this product
 * should have everywhere: tier is a hard partition, score only orders within
 * it, and recency is a bounded modifier that can never reorder tiers. Desktop
 * lost that by flattening onto one `sortScore`, so a fresh workflow nudge
 * could outrank a position whose framework had broken.
 *
 * But mobile's `TIER` record is keyed on `SignalType` — its own card
 * vocabulary — and `priorityFor` requires a fully-populated mobile
 * `PriorityInput`. Desktop items are `DecisionItem`s keyed on evaluator
 * `titleKey`. Adding desktop keys to mobile's record would edit a file mobile
 * owns and is explicitly out of scope; building a fake `SignalType` for each
 * evaluator would be worse, because the tier would then be decided by a
 * translation nobody could read.
 *
 * So the MAP is desktop's and the SCORING is mobile's: `materialityBand`,
 * `deviationBand` and `recencyBoost` are imported unchanged and are pure
 * functions over plain numbers. Nothing about mobile's behaviour changes.
 *
 * The later unification — one tier vocabulary both products key into — is real
 * and is noted here rather than attempted in a stage about building a surface.
 */

import { materialityBand, recencyBoost } from '../signals/feed-priority'
import type { DecisionItem } from '../../engine/decisionEngine/types'
import type { TodayItem, TodayTier } from './types'

/**
 * Where each evaluator sits, and the base score it carries within its tier.
 *
 * The tier boundaries mirror mobile's meaning so the two products describe the
 * same idea:
 *   0  capital is committed and reality disagrees with intent
 *   1  the framework behind a position has decayed or been contradicted
 *   2  a person is blocked on an answer
 *   3  workflow: something is unfinished
 *   4  informational: nothing is wrong, it is simply unclaimed
 *
 * Note what is NOT here: age. A 200-day-old stale thesis and a 95-day-old one
 * are the same tier; age moves the score inside it. That is the whole point of
 * the partition.
 */
const TIER: Record<string, { tier: TodayTier; base: number }> = {
  EXECUTION_NOT_CONFIRMED:    { tier: 0, base: 1.00 },

  RATING_NO_FOLLOWUP:         { tier: 1, base: 0.80 },
  THESIS_STALE:               { tier: 1, base: 0.70 },

  PROPOSAL_AWAITING_DECISION: { tier: 2, base: 0.90 },

  IDEA_NOT_SIMULATED:         { tier: 3, base: 0.60 },
  OVERDUE_DELIVERABLE:        { tier: 3, base: 0.55 },

  HIGH_EV_NO_IDEA:            { tier: 4, base: 0.40 },
}

/** Anything an evaluator adds later ranks as informational until mapped. */
const UNTIERED = { tier: 4 as TodayTier, base: 0.1 }

/**
 * Severity nudges the score inside a tier; it never crosses one.
 *
 * The engine's severity already encodes how bad a given finding is relative to
 * others of its own kind — `thesisStale` reddens past 180 days — so it is the
 * right within-tier tiebreaker and the wrong partition.
 */
const SEVERITY_WEIGHT: Record<string, number> = {
  red: 0.30, orange: 0.20, yellow: 0.12, blue: 0.04, gray: 0,
}

export function tierFor(item: DecisionItem): { tier: TodayTier; base: number } {
  const mapped = item.titleKey ? TIER[item.titleKey] : undefined
  const { tier, base } = mapped ?? UNTIERED

  const severity = SEVERITY_WEIGHT[item.severity] ?? 0

  // Materiality: how much of the book this concerns. Mobile's banding is used
  // unchanged so "3% is meaningfully bigger than 0.8%" means the same thing on
  // both products. `held` is true when the item concerns a real position.
  const weight = item.context.proposedWeight ?? null
  const materiality = materialityBand(weight, !!item.context.portfolioId || !!item.context.assetId)

  // Recency as a bounded modifier, never the sort key — an old unresolved
  // high-impact item loses this component and keeps everything else.
  const recency = item.createdAt ? recencyBoost(Date.parse(item.createdAt), Date.now()) : 0

  return { tier, base: base + severity + materiality * 0.25 + recency }
}

/**
 * Order for the surface: tier ascending, score descending, id for stability.
 *
 * The id tiebreak matters more than it looks. Without it two items with equal
 * tier and equal score can swap between renders, and a "most important thing"
 * that changes on refresh is not one.
 */
export function compareTodayItems(a: TodayItem, b: TodayItem): number {
  if (a.tier !== b.tier) return a.tier - b.tier
  if (b.score !== a.score) return b.score - a.score
  return a.id.localeCompare(b.id)
}

/**
 * How many items Today shows.
 *
 * Finite is a product promise, not a performance concern. Four is the number
 * the approved composition uses: one featured plus three supporting. Anything
 * beyond it is real and is reported as evaluated-but-not-surfaced rather than
 * hidden.
 */
export const TODAY_LIMIT = 4

export interface TodaySelection {
  surfaced: TodayItem[]
  /** Ranked below the cut, or suppressed. Shown quietly, never as tiles. */
  alsoWatching: TodayItem[]
  /** How many candidates the engine produced before the cut. */
  evaluated: number
}

export function selectToday(items: TodayItem[]): TodaySelection {
  const ranked = [...items].sort(compareTodayItems)
  return {
    surfaced: ranked.slice(0, TODAY_LIMIT),
    alsoWatching: ranked.slice(TODAY_LIMIT),
    evaluated: ranked.length,
  }
}
