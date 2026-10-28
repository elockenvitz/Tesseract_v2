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

  // Coverage backfill. Placed after real findings by TodayPage regardless of
  // score; these only order the backfill against itself if anything sorts it.
  COVERAGE_NEW_EVIDENCE:      { tier: 3, base: 0.30 },
  COVERAGE_PRICE_MOVE:        { tier: 3, base: 0.28 },
  COVERAGE_NO_THESIS:         { tier: 4, base: 0.20 },
  COVERAGE_INCOMPLETE_THESIS: { tier: 4, base: 0.18 },
  COVERAGE_STALE_THESIS:      { tier: 4, base: 0.16 },
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

/**
 * Findings that are framework decay when capital is behind them and coverage
 * housekeeping when it is not.
 *
 * ── Why a tier move and not just a lower score ────────────────────────────
 *
 * Tier is a hard partition and score only orders within it, so a demotion
 * that stays inside tier 1 still competes for tier-1 slots. WMT's thesis was
 * 373 days old on a name the book does not hold, the price had moved -0.3%,
 * and dropping its severity moved it from #3 to #4 on Today -- still one of
 * four slots on the most prominent surface in the product, still describing
 * nothing that happened.
 *
 * An aged case on a name nobody owns is the same claim `COVERAGE_STALE_THESIS`
 * already makes, and that sits at tier 4. So it lands there: reported, counted
 * as evaluated, visible in Also watching, and not interrupting anybody.
 */
const HOUSEKEEPING_WHEN_UNHELD: Record<string, TodayTier> = {
  THESIS_STALE: 4,
}

export function tierFor(item: DecisionItem): { tier: TodayTier; base: number } {
  const mapped = item.titleKey ? TIER[item.titleKey] : undefined
  const { base } = mapped ?? UNTIERED
  /* Only where the evaluator actually answered. `undefined` means it was
     never asked, and silently demoting every evaluator that has not been
     taught to answer would be a regression across the whole surface. */
  const demoted = item.titleKey && item.context.held === false
    ? HOUSEKEEPING_WHEN_UNHELD[item.titleKey]
    : undefined
  const tier = demoted ?? (mapped ?? UNTIERED).tier

  const severity = SEVERITY_WEIGHT[item.severity] ?? 0

  // Materiality: how much of the book this concerns. Mobile's banding is used
  // unchanged so "3% is meaningfully bigger than 0.8%" means the same thing on
  // both products.
  //
  // `held` was `!!portfolioId || !!assetId`, which is true of every finding
  // that names a security and therefore could never be false -- a thesis on a
  // name the book does not own scored as a real position. An evaluator that
  // knows the answer now states it, and the id fallback is kept only for the
  // evaluators that do not: a portfolio id IS a book, and the alternative
  // would silently demote every finding nobody has taught to answer yet.
  const weight = item.context.proposedWeight ?? null
  const materiality = materialityBand(
    weight,
    item.context.held ?? !!item.context.portfolioId,
  )

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
 * Finite is a product promise, not a performance concern. Anything beyond the
 * limit is real and is reported as evaluated-but-not-surfaced rather than
 * hidden.
 *
 * TWENTY, and the arithmetic is still the grid's. The lead takes eight
 * columns and #2 rides the four beside it; every tile after that is a third
 * of a row, so a clean field needs the remainder to be a multiple of three.
 * 1 + 1 + 18 does that, the same way 1 + 1 + 6 did at eight.
 *
 * It went 4 -> 8 -> 20 for the same reason each time, and the reason is not
 * "more is better". Four was the approved composition, one featured plus
 * three supporting, and on a real desk it left findings the reader WANTED
 * sitting under "Also watching" -- a summary line, not a surface. Eight
 * cleared the fold and stopped there, which made Today a page that ends: a
 * reader who had worked through it had no way to keep going except to leave.
 *
 * Twenty is a page you can scroll through. It is still finite, still ranked,
 * and nothing is promoted to fill it -- a desk with six real findings shows
 * six. The cost of a high limit is paid in rows that do not exist, not in
 * invented content, which is why the number can be generous.
 */
export const TODAY_LIMIT = 20

export interface TodaySelection {
  surfaced: TodayItem[]
  /** Ranked below the cut, or suppressed. Shown quietly, never as tiles. */
  alsoWatching: TodayItem[]
  /** How many candidates the engine produced before the cut. */
  evaluated: number
}

/**
 * One name, one tile — enforced at the cut, not just in the ordering.
 *
 * `diversify` pushes a repeat as late as it can, which is the whole answer
 * while the pool is larger than the surface. It is not an answer when the
 * desk has fewer findings than there are slots: with seven findings and eight
 * tiles, NKE's two open ideas BOTH surfaced, as #5 and #7 -- same ticker,
 * same fund, same sentence, because there was room for them.
 *
 * A second tile about a name the reader has already seen is worth less than
 * an empty cell, so the repeat drops to Also watching, where its count still
 * shows and nothing is hidden. Findings with no object -- an overdue
 * deliverable carries no asset -- are never repeats and always keep their
 * slot.
 */
function objectKey(item: TodayItem): string | null {
  return item.source.context.assetId ?? item.ticker ?? null
}

/**
 * The cut itself: at most `limit` tiles, at most one per name.
 *
 * Exported because the page performs its own cut -- it expands rollups and
 * diversifies before slicing -- and a rule that lives only in `selectToday`
 * is a rule the production surface does not have. That is exactly how NKE
 * reached the live field twice while `selectToday`'s tests were green.
 */
export function cutToday(
  ordered: readonly TodayItem[], limit: number,
): { surfaced: TodayItem[]; overflow: TodayItem[] } {
  const surfaced: TodayItem[] = []
  const overflow: TodayItem[] = []
  const seen = new Set<string>()

  for (const item of ordered) {
    const key = objectKey(item)
    if (surfaced.length >= limit || (key && seen.has(key))) {
      overflow.push(item)
      continue
    }
    if (key) seen.add(key)
    surfaced.push(item)
  }

  return { surfaced, overflow }
}

export function selectToday(items: TodayItem[]): TodaySelection {
  const ranked = [...items].sort(compareTodayItems)
  const { surfaced, overflow } = cutToday(ranked, TODAY_LIMIT)
  return { surfaced, alsoWatching: overflow, evaluated: ranked.length }
}
