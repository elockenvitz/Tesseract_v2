import { sliceWindow } from '../mobile/explore-spark'

/**
 * How a name has moved since somebody staked a view on it.
 *
 * ── The defect this is shaped to make unrepresentable ─────────────────────
 *
 * A displayed move and the chart beside it can come from different windows,
 * and when they do the card states a number the picture does not show. The
 * Explore pass hit this on news — a story published yesterday has one close
 * inside its own window, so the line silently fell back to a year of history
 * while the caption still read `PUBLISHED · 1Y · -1%`.
 *
 * Ideas have the same shape and a worse consequence: "+15% since this idea"
 * is an assessment of a colleague's judgment. Getting its window wrong is not
 * a cosmetic error.
 *
 * So the delta is not a number this module returns beside some points. It is a
 * field that EXISTS ONLY WHEN THE POINTS REACH THE ANCHOR:
 *
 *   `sinceIdea: null`  — the series does not reach the idea's date. There is
 *                        no "since this idea" to state, and no field to render
 *                        one from.
 *   `sinceIdea: {...}`  — the window genuinely opens at the idea, and the
 *                        percentage is computed from the first and last of the
 *                        very same points the caller draws.
 *
 * A caller cannot show an unanchored delta by mistake, because there is
 * nothing to read. That is the `CardResult` pattern this codebase already uses
 * for suppression, applied to a window.
 *
 * ── Why `sliceWindow` and not a local filter ──────────────────────────────
 *
 * Because it already exists, is already tested, and already decides the one
 * hard case: what to do when the cache does not reach back far enough. It
 * falls back to the full series and reports `anchored: false` so the caption
 * can drop its claim. Writing a second filter here would be a second answer to
 * that question, and the two would drift the first time either was touched.
 * It is consumed, not modified — see the header of `explore-spark`.
 */

export interface PricePointish {
  date: string
  close: number
}

export interface SinceIdea {
  /** Percent change across the drawn window. Sign carried, not absolute. */
  changePct: number
  /** First close inside the window. */
  fromPrice: number
  /** Last close in the series. */
  toPrice: number
  /** ISO date the window actually opens at — the first point drawn. */
  fromDate: string
  /**
   * Trading days of path behind the claim.
   *
   * Exposed so a caller can decline to make much of a five-point window
   * without re-deriving it from the array it was handed.
   */
  points: number
}

export interface IdeaPerformance {
  /**
   * Exactly the points a chart should draw. Never a different slice from the
   * one the numbers came from.
   */
  points: PricePointish[]
  /** True when `points` genuinely begins at or after the idea's date. */
  anchored: boolean
  /**
   * The claim, or null when it cannot be made honestly.
   *
   * Null in three cases, all of them real: no series, a series that does not
   * reach the idea, or a window too short to be a path.
   */
  sinceIdea: SinceIdea | null
  /**
   * What the drawn window actually covers, for the chart's own caption.
   *
   * Always safe to render. Says "Since this idea" only when `anchored`, and
   * plain "Recent" otherwise — which is the honest description of a fallback.
   */
  windowLabel: string
}

/** Two points is the minimum that is a path rather than a pair of dots. */
const MIN_POINTS = 2

/**
 * How long after the idea the first cached close may fall and still count.
 *
 * ── The hole `sliceWindow` alone leaves, and why it is ours to close ──────
 *
 * `sliceWindow` keeps every point at or after the anchor and reports
 * `anchored: true` whenever two survive. When the anchor is NEWER than the
 * series it correctly falls back. When the anchor is OLDER than the entire
 * series every point survives, so it reports `anchored: true` — and the window
 * it describes begins wherever the cache happens to begin, not at the anchor.
 *
 * For Explore that is harmless: its anchors are recent (a story's publication,
 * a coverage date) and sit comfortably inside a year of closes. For an idea it
 * is the whole failure mode. `price_history_cache` holds about 260 trading
 * days and `PROPOSAL_DAYS_BACK` is 365, so a genuinely old proposal has an
 * anchor the cache cannot reach — and the card would draw eight months of
 * somebody else's window under the words "since this idea".
 *
 * So this is an ADDITIONAL test, in the Ideas module, over a shared primitive
 * that is correct for its own callers. `explore-spark` is not changed.
 *
 * The grace exists because an idea posted on a Friday evening has its first
 * close on the Monday, and a strict comparison would call that unanchored. Five
 * days covers a weekend plus a market holiday either side of it.
 */
const ANCHOR_GRACE_DAYS = 5
const DAY_MS = 86_400_000

/**
 * Whether the cached series actually reaches back to the idea.
 *
 * Separate from "did the slice keep enough points", which is what
 * `sliceWindow` answers. Both have to be true before a card may say "since".
 */
function seriesCoversAnchor(series: PricePointish[], createdAt: string): boolean {
  const anchor = new Date(createdAt).getTime()
  const firstCached = new Date(series[0]?.date ?? '').getTime()
  if (!Number.isFinite(anchor) || !Number.isFinite(firstCached)) return false
  return firstCached <= anchor + ANCHOR_GRACE_DAYS * DAY_MS
}

/**
 * A window this short is a fortnight of noise, not a verdict on a thesis.
 *
 * Distinct from `IDEA_MIN_AGE_DAYS`, which asks whether the IDEA is old enough
 * to have a path. This asks whether the CACHE actually held one — a six-month
 * old idea on a name with four cached closes passes the first test and fails
 * this one.
 */
const MIN_POINTS_FOR_CLAIM = 4

export function ideaPerformance(
  series: PricePointish[] | null | undefined,
  createdAt: string | null | undefined,
): IdeaPerformance {
  const points = series ?? []

  if (points.length < MIN_POINTS) {
    return { points, anchored: false, sinceIdea: null, windowLabel: 'Recent' }
  }

  const { points: windowed, anchored: sliceAnchored } = sliceWindow(points, createdAt ?? null)

  // Both conditions, not either: the slice has to have kept a drawable window
  // AND the cache has to actually reach the idea. See `ANCHOR_GRACE_DAYS`.
  const anchored = sliceAnchored && !!createdAt && seriesCoversAnchor(points, createdAt)

  if (!anchored) {
    /**
     * The fallback is still a chart, just not this one's chart.
     *
     * Returning nothing would leave a card that has a perfectly good recent
     * path unable to draw it. What it loses is the ANCHOR and the delta — the
     * two things that would have been false.
     */
    return { points: windowed, anchored: false, sinceIdea: null, windowLabel: 'Recent' }
  }

  const first = windowed[0]
  const last = windowed[windowed.length - 1]

  if (
    windowed.length < MIN_POINTS_FOR_CLAIM ||
    !Number.isFinite(first?.close) ||
    !Number.isFinite(last?.close) ||
    first.close <= 0
  ) {
    // Anchored, drawable, but too thin to put a percentage on. The chart still
    // says "since this idea" because that is what it draws; the number does
    // not appear, because four closes is not a return.
    return { points: windowed, anchored: true, sinceIdea: null, windowLabel: 'Since this idea' }
  }

  return {
    points: windowed,
    anchored: true,
    sinceIdea: {
      changePct: ((last.close - first.close) / first.close) * 100,
      fromPrice: first.close,
      toPrice: last.close,
      fromDate: first.date,
      points: windowed.length,
    },
    windowLabel: 'Since this idea',
  }
}

/**
 * The gap between a price and a target, as a percentage of the price.
 *
 * Signed against the STANCE rather than against the arithmetic: on a sell or a
 * trim, a target below the current price is the thesis working, and rendering
 * that as "-18%" would show a red number on an idea that is going right.
 * `towardTargetPct` is therefore "how far the price has to travel in the
 * direction this idea wants", and is positive whenever the target is still
 * ahead of the price in that direction.
 */
export function targetGapPct(
  referencePrice: number | null | undefined,
  targetPrice: number | null | undefined,
  direction: 'increase' | 'decrease',
): number | null {
  if (referencePrice == null || targetPrice == null) return null
  if (!Number.isFinite(referencePrice) || !Number.isFinite(targetPrice)) return null
  if (referencePrice <= 0 || targetPrice <= 0) return null
  const raw = ((targetPrice - referencePrice) / referencePrice) * 100
  return direction === 'decrease' ? -raw : raw
}

/**
 * How much of the journey to the target has already happened, 0–1.
 *
 * Only defined when the idea has a starting price to measure from, which means
 * an anchored window. Returns null otherwise rather than measuring progress
 * from today, which would always be zero and would render as a bar that never
 * fills.
 */
export function targetProgress(
  fromPrice: number | null | undefined,
  currentPrice: number | null | undefined,
  targetPrice: number | null | undefined,
): number | null {
  if (fromPrice == null || currentPrice == null || targetPrice == null) return null
  const span = targetPrice - fromPrice
  if (!Number.isFinite(span) || Math.abs(span) < 1e-9) return null
  const travelled = (currentPrice - fromPrice) / span
  // Clamped, because a price through its target is 100% of the way there and a
  // price that has gone backwards is 0% — not -40%, which would draw a bar
  // extending off the left of its own track.
  return Math.max(0, Math.min(1, travelled))
}
