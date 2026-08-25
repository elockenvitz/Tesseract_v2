import { DAY_MS } from '../signals/thresholds'
import type { FeedCategory } from './feed-categories'
import type { ComposedExploreItem, ExploreItem } from './explore-item'

/**
 * How Explore decides what to show, and in what order.
 *
 * ── Not a re-sorted Curate ────────────────────────────────────────────────
 *
 * Curate ranks by consequence: the most important unresolved thing first, and
 * a strong second place is genuinely second. Explore ranks by interestingness,
 * and interestingness is not a total order — the fourth-most-consequential
 * scenario gap is not the fourth-most-interesting thing on a desk, it is the
 * fourth time the reader has been told the same sort of news.
 *
 * So importance enters as a bounded term rather than as the sort key, and the
 * arrangement does most of the work. A reader opening Explore with no objective
 * should meet a cross-section of their investment world in two scrolls, not the
 * Curate queue with smaller type.
 *
 * ── Diversity here is much stronger than in Curate ────────────────────────
 *
 * Curate's rule is a run cap with a narrow substitution window, because there
 * the cost of moving a card down is real. Explore's cost is the opposite: the
 * cost of NOT moving something down is a page that looks like one story told
 * six times. So this uses repulsion rather than a cap — every candidate is
 * scored against what has already been placed, across five axes at once, and
 * the penalties decay with distance. The result is that near-duplicates drift
 * apart naturally instead of being forbidden at a hard boundary.
 *
 * ── Deterministic ─────────────────────────────────────────────────────────
 *
 * Greedy selection over a stable sort, with `now` passed in and every tie
 * broken on the item id. No seed, no shuffle, no clock of its own. The same
 * candidates produce the same page, which is what makes it testable and what
 * lets a reader build a mental map of their own Explore.
 *
 * Pure — no React, no Supabase. The gallery imports it directly.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Relevance
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How interesting each family is before anything else is known about it.
 *
 * Not the Curate tiers, and deliberately flatter than them. Curate's ordering
 * says a decision mismatch outranks a colleague's trade idea, which is true of
 * urgency and false of interest — a new idea from someone whose work you follow
 * is one of the more interesting things that can appear on a discovery page.
 * The spread here is narrow on purpose so the other dimensions can matter.
 */
const CATEGORY_INTEREST: Record<FeedCategory, number> = {
  decisions: 0.85,
  research: 0.80,
  ideas: 0.75,
  news: 0.55,
  workflow: 0.45,
}

/** Freshness decays over this window and then contributes nothing. */
const FRESHNESS_DAYS = 21
const FRESHNESS_WEIGHT = 0.30

/**
 * Bounded, so recency cannot become reverse chronology.
 *
 * A useful research update from yesterday should be more discoverable than a
 * trivial news item from five minutes ago, which is only possible if freshness
 * is a term rather than the sort. Three weeks is roughly the horizon over which
 * "recently" stops meaning anything on a research desk.
 */
export function freshness(occurredAt: string | null | undefined, now: number): number {
  if (!occurredAt) return 0
  const t = new Date(occurredAt).getTime()
  if (!Number.isFinite(t)) return 0
  const ageDays = (now - t) / DAY_MS
  if (ageDays <= 0) return 1
  if (ageDays >= FRESHNESS_DAYS) return 0
  return 1 - ageDays / FRESHNESS_DAYS
}

/**
 * Position size, banded — the same shape as Curate's, for the same reason.
 *
 * A 25% holding is more interesting than a 0.4% one, and not sixty times more.
 */
export function materiality(item: ExploreItem): number {
  const w = item.portfolio?.weightPct
  if (w == null || !Number.isFinite(w)) return item.symbol ? 0.35 : 0.25
  if (w < 1) return 0.3
  if (w < 3) return 0.5
  if (w < 5) return 0.65
  if (w < 10) return 0.85
  return 1
}

const WEIGHTS = {
  category: 0.34,
  freshness: FRESHNESS_WEIGHT,
  materiality: 0.20,
  /**
   * Curate's ranking, capped hard.
   *
   * Enough that a genuine bear-case breach outshines a routine one; not enough
   * to reassemble the Curate order inside Explore, which would make the second
   * mode pointless.
   */
  importance: 0.16,
} as const

/**
 * A small, deliberate thumb on the scale for things that are not problems.
 *
 * Curate surfaces breaches, gaps, staleness and overdue work, because that is
 * its job. If Explore inherits that distribution unchanged it reads as a wall
 * of warnings, and the impression a discovery surface leaves is "everything is
 * broken" rather than "investment thinking is happening here". A thesis
 * strengthened or a target raised is genuinely interesting and structurally
 * rarer, so it gets a nudge rather than a category of its own.
 */
const POSITIVE_BONUS = 0.06

export function scoreExplore(item: ExploreItem, now: number): number {
  const s =
    CATEGORY_INTEREST[item.category] * WEIGHTS.category +
    freshness(item.occurredAt, now) * WEIGHTS.freshness +
    materiality(item) * WEIGHTS.materiality +
    Math.min(Math.max(item.importance ?? 0, 0), 1) * WEIGHTS.importance +
    (item.positive ? POSITIVE_BONUS : 0)
  return Math.min(s, 1)
}

// ─────────────────────────────────────────────────────────────────────────────
// Deduplication
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One artifact, one preview.
 *
 * Several adapters can legitimately represent the same underlying thing: a
 * thesis update is both a research item and team activity; an idea is both a
 * post and an entry in someone's activity; a market template and a news story
 * can describe the same event on the same name.
 *
 * Keeps the HIGHEST-SCORING representation rather than the first, so the
 * richest preview wins — a research tile with an author and a metric beats the
 * same artifact rendered as a bare activity line. Ties break on id so the
 * choice is stable.
 */
export function dedupeExplore(items: ExploreItem[], now: number): ExploreItem[] {
  const best = new Map<string, { item: ExploreItem; score: number }>()
  for (const item of items) {
    const score = scoreExplore(item, now)
    const prev = best.get(item.dedupeKey)
    if (!prev || score > prev.score || (score === prev.score && item.id < prev.item.id)) {
      best.set(item.dedupeKey, { item, score })
    }
  }
  // Sorted by id so the map's insertion order cannot leak into the result.
  return [...best.values()].map(b => b.item).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// ─────────────────────────────────────────────────────────────────────────────
// Diversity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How much a repeat costs, and how far the memory of it reaches.
 *
 * Five axes, because a page can be monotonous in five different ways and
 * fixing only one of them is why "diverse by signal type" still produced six
 * AAPL tiles. The ticker penalty is the heaviest: the detail page is where all
 * of one name's context converges, and Explore's job is the opposite.
 *
 * `reach` is how many placed items back the penalty still applies, decaying
 * linearly, so an item is nudged away from its neighbours rather than banned.
 */
const REPULSION: { of: (i: ExploreItem) => string | null; weight: number; reach: number }[] = [
  { of: i => (i.symbol ? i.symbol.toUpperCase() : null), weight: 0.55, reach: 6 },
  { of: i => i.category, weight: 0.30, reach: 4 },
  { of: i => i.subtype, weight: 0.22, reach: 4 },
  { of: i => i.source?.label ?? null, weight: 0.18, reach: 4 },
  { of: i => i.portfolio?.name ?? null, weight: 0.12, reach: 3 },
]

/** Penalty for placing `item` given what came before, most recent last. */
export function repulsion(item: ExploreItem, placed: ExploreItem[]): number {
  let penalty = 0
  for (const axis of REPULSION) {
    const key = axis.of(item)
    if (!key) continue
    for (let back = 1; back <= axis.reach; back++) {
      const other = placed[placed.length - back]
      if (!other) break
      if (axis.of(other) !== key) continue
      // Linear decay: adjacent costs the full weight, `reach` away costs almost
      // nothing. Accumulates across matches, so three of a kind hurts more.
      penalty += axis.weight * (1 - (back - 1) / axis.reach)
    }
  }
  return penalty
}

/**
 * The floor that stops diversity producing nonsense.
 *
 * A genuinely strong item may be pushed down the page but must never be pushed
 * below something trivial: an item can only be displaced by a candidate whose
 * raw score is within this of its own. Without it a workflow reminder could
 * lead the page purely for being the only thing of its kind.
 */
const MIN_COMPETITIVE = 0.22

/**
 * Arrange candidates for breadth, deterministically.
 *
 * Greedy: at each position, take the highest `score - repulsion` among the
 * candidates that are still competitive on raw score with the current leader.
 * Ties break on id.
 */
export function diversifyExplore(items: ExploreItem[], now: number): ComposedExploreItem[] {
  const scored = items
    .map(item => ({ item, score: scoreExplore(item, now) }))
    .sort((a, b) => (b.score - a.score) || (a.item.id < b.item.id ? -1 : 1))

  const out: ComposedExploreItem[] = []
  const placed: ExploreItem[] = []
  const pool = [...scored]

  while (pool.length) {
    const leader = pool[0].score
    let bestIndex = 0
    let bestValue = -Infinity
    for (let i = 0; i < pool.length; i++) {
      // Sorted by score, so once a candidate is out of contention every
      // candidate after it is too.
      if (pool[i].score < leader - MIN_COMPETITIVE) break
      const value = pool[i].score - repulsion(pool[i].item, placed)
      // Strict `>` keeps the earlier (higher-scoring, then lower-id) candidate
      // on a tie, which is what makes this reproducible.
      if (value > bestValue) { bestValue = value; bestIndex = i }
    }
    const chosen = pool.splice(bestIndex, 1)[0]
    placed.push(chosen.item)
    /**
     * Placed at the neutral size. Width is decided elsewhere, and that is the
     * point.
     *
     * This function used to end by calling `assignEmphasis`, which read an
     * item's INDEX in the arrangement it had just produced. Composition is
     * about what is interesting and in what order; width is about what a card
     * has to show. Deciding both here meant an item's size was a side effect of
     * the diversity pass — the same signal wide on one page and narrow on the
     * next, for reasons no reader could name from looking at it.
     *
     * `explore-layout` now owns size and packing, from the item itself. See
     * `exploreCardSize`.
     */
    out.push({ item: chosen.item, emphasis: 'standard', score: chosen.score })
  }

  return out
}

/**
 * The whole pipeline, in the order the brief specifies.
 *
 * dedupe → score → diversify. Sizing and packing follow in `explore-layout`,
 * which reads the items rather than this function's output order. Filtering by
 * category happens BEFORE
 * composition, so a filtered Explore is composed from what survives rather than
 * being the mixed page with rows hidden — otherwise the diversity penalties
 * would be computed against items the reader cannot see.
 */
export function composeExplore(
  candidates: ExploreItem[],
  options: { now: number; category?: FeedCategory | null; limit?: number },
): ComposedExploreItem[] {
  const { now, category = null, limit = 60 } = options
  const eligible = category ? candidates.filter(c => c.category === category) : candidates
  return diversifyExplore(dedupeExplore(eligible, now), now).slice(0, limit)
}
