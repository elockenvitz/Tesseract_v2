/**
 * Today — diversity after priority.
 *
 * ── The problem this solves ───────────────────────────────────────────────
 *
 * With object-level expansion working, a real account produced:
 *
 *   #1 TGT  thesis may be stale
 *   #2 LLY  thesis may be stale
 *   #3 AMZN thesis may be stale
 *   #4 WMT  thesis may be stale
 *
 * Every one of those is correctly ranked. The set is still wrong, because it
 * answers "which are the four oldest stale theses" when the surface promises
 * "the four things most worth your morning". A finite set saturated by one
 * evaluator tells the reader one thing about their book; four different kinds
 * of finding tell them four.
 *
 * ── The discipline, borrowed from mobile ──────────────────────────────────
 *
 * `lib/signals/feed-priority.ts::diversify` solves the same problem for a
 * scrolling feed with a run rule: break a run of the same kind, but only when
 * the alternative is close enough on score that promoting it cannot smuggle
 * junk upward. Two guards do that work — a score tolerance and a tier reach.
 *
 * Today's shape is different enough that the mechanism is not: a feed cares
 * about consecutive runs, a four-slot surface cares about total share. So the
 * run rule becomes a cap, and the two guards carry over unchanged in spirit.
 *
 * ── The three rules ───────────────────────────────────────────────────────
 *
 * 1. #1 IS NEVER TOUCHED. The highest-ranked item is the highest-ranked item;
 *    a surface whose lead changes for the sake of variety has stopped being a
 *    priority surface.
 *
 * 2. From slot 2 on, an evaluator that already holds MAX_PER_KEY of the
 *    surfaced set yields to the best alternative — but only if that
 *    alternative is materially comparable.
 *
 * 3. "Materially comparable" is the whole safety property. The alternative
 *    must be within TIER_REACH tiers of the candidate it displaces and within
 *    SCORE_TOLERANCE of its score. A tier-3 workflow nudge therefore cannot
 *    displace a tier-1 framework decay: the tier gap alone disqualifies it.
 *    When nothing qualifies, the rank order stands and the set stays
 *    saturated — which is the correct answer when the book really does only
 *    have one kind of problem.
 */

import type { TodayItem } from './types'

/** How many surfaced slots one evaluator may hold before yielding. */
export const MAX_PER_KEY = 2

/**
 * How far down the tiers an alternative may reach to break saturation.
 *
 * One. A framework gap (tier 1) can yield to someone-is-waiting (tier 2), but
 * not to a workflow chore (tier 3). This is the rule that stops variety from
 * becoming noise.
 */
export const TIER_REACH = 1

/**
 * How much score an alternative may give up.
 *
 * Wider than mobile's 0.15 because desktop scores cluster: within one tier the
 * spread across evaluators is mostly severity and materiality, so a stricter
 * floor would never fire and the rule would be decorative.
 */
export const SCORE_TOLERANCE = 0.35

/** What counts as "the same kind of finding" for saturation. */
function keyOf(item: TodayItem): string {
  return item.source.titleKey ?? item.state
}

/**
 * The object a finding is about, for OBJECT saturation.
 *
 * A real account surfaced two COIN proposals — same asset, two portfolios.
 * Both are genuine, separate decisions, so neither is wrong to exist. But two
 * tiles headed COIN read as a duplicate and spend two of four slots telling
 * the reader about one name, which is the same waste the evaluator cap exists
 * to prevent. One object holds one slot while an alternative qualifies; the
 * others fall to Also watching, where the count still shows.
 */
function objectOf(item: TodayItem): string | null {
  return item.source.context.assetId ?? item.ticker ?? null
}

export const MAX_PER_OBJECT = 1

/**
 * Reorder ranked candidates so a finite set is not needlessly saturated.
 *
 * Input MUST already be ranked (tier-first). Output is a permutation — nothing
 * is added, removed, or scored again. The finite cut still happens afterwards,
 * so this changes WHICH items surface, never how many.
 */
export function diversify(ranked: readonly TodayItem[], limit: number): TodayItem[] {
  if (ranked.length < 3) return [...ranked]

  const pool = [...ranked]
  const out: TodayItem[] = []
  const held = new Map<string, number>()
  const heldObj = new Map<string, number>()

  const take = (index: number) => {
    const [item] = pool.splice(index, 1)
    out.push(item)
    held.set(keyOf(item), (held.get(keyOf(item)) ?? 0) + 1)
    const o = objectOf(item)
    if (o) heldObj.set(o, (heldObj.get(o) ?? 0) + 1)
  }

  /** Would taking this item exceed either cap? */
  const saturated = (item: TodayItem) => {
    const o = objectOf(item)
    return (held.get(keyOf(item)) ?? 0) >= MAX_PER_KEY
      || (!!o && (heldObj.get(o) ?? 0) >= MAX_PER_OBJECT)
  }

  // Rule 1: the lead is the lead.
  take(0)

  while (pool.length && out.length < limit) {
    const head = pool[0]

    if (!saturated(head)) {
      take(0)
      continue
    }

    // Rule 2 + 3: look for a materially comparable alternative that is neither
    // the same kind of finding nor about the same object.
    const alt = pool.findIndex(candidate => {
      if (saturated(candidate)) return false
      if (candidate.tier - head.tier > TIER_REACH) return false
      return candidate.score >= head.score - SCORE_TOLERANCE
    })

    // No qualifying alternative: rank order stands. Saturation is the honest
    // answer when the book genuinely has one kind of problem.
    take(alt > 0 ? alt : 0)
  }

  // Anything not surfaced keeps its ranked order for "Also watching".
  return [...out, ...pool]
}
