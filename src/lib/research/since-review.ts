/**
 * How far the price has travelled since the case was last written.
 *
 * ── Why this is not the chart's return ────────────────────────────────────
 *
 * `PriceContext` leads with the return across the WINDOW THE READER SELECTED,
 * measured from the series end. That is a fact about the chart. "Since the case
 * was last written" is a fact about the CASE, and the two must not be the same
 * number: a reader who taps 1M to look at something specific has changed the
 * chart, not changed when the case was written.
 *
 * So this is computed once, from the anchor, and travels with the card. Tapping
 * a range chip cannot move it. That is the same separation the Ideas family
 * already draws between `sinceIdea` and the selected horizon, and the reason it
 * is drawn again here rather than reached for from the chart.
 *
 * ── Why the anchored window is not reused wholesale ───────────────────────
 *
 * `ideaPerformance` SLICES the series to the anchor, because an idea card draws
 * only its own window. A Research card draws the shared `PricePane` — the whole
 * series, with every horizon chip available — and puts a marker where the case
 * was written. Slicing here would silently take the 5Y and ALL chips away from
 * a name whose case is six months old, which is the opposite of what the
 * reader wants when asking "what has this done since".
 *
 * What IS reused is the part that decides whether the claim may be made at all:
 * `seriesCoversAnchor`, exported from `idea-performance` rather than restated.
 * Its five-day forward grace covers an anchor that lands on a Friday evening.
 * `BASELINE_TOLERANCE_DAYS` bounds the other direction — a close from long
 * before the anchor is not a baseline FOR the anchor.
 *
 * ── Pure ──────────────────────────────────────────────────────────────────
 *
 * No React, no Supabase. See `case-state.ts`.
 */

import { seriesCoversAnchor, type PricePointish } from '../signals/idea-performance'
import { BASELINE_TOLERANCE_DAYS, DAY_MS } from '../signals/thresholds'

export interface SinceReview {
  /** Signed percent from the baseline close to the last close. Never absolute. */
  changePct: number
  /** The close the claim is measured from. */
  fromPrice: number
  /** ISO date of that close — at or before the anchor, within tolerance. */
  fromDate: string
  /** The last close in the series. */
  toPrice: number
  /** ISO date of the last close. Never "today". */
  toDate: string
}

/**
 * The since-review return, or null when it cannot be stated honestly.
 *
 * Null in every case where a number would be invented rather than measured:
 *
 *   - no anchor (the case has never been written)
 *   - no series at all — COIN and TGT are both anchored and have zero cached
 *     closes, and are the real names this protects
 *   - the cache does not reach back to the anchor
 *   - the nearest close at or before the anchor is more than
 *     `BASELINE_TOLERANCE_DAYS` before it
 *
 * A caller cannot render a fabricated delta by mistake, because there is
 * nothing to read. Same `CardResult` discipline the contract uses for
 * suppression, applied to a metric.
 */
export function sinceReview(
  series: readonly PricePointish[] | null | undefined,
  reviewAnchor: string | null | undefined,
): SinceReview | null {
  if (!reviewAnchor) return null

  const anchorMs = new Date(reviewAnchor).getTime()
  if (!Number.isFinite(anchorMs)) return null

  // Ascending by date, which is what `useSymbolHistory` already returns and
  // what `seriesCoversAnchor` reads position 0 of. Copied rather than sorted in
  // place: this must not mutate the array the chart is drawing from.
  const points = (series ?? []).filter(p => Number.isFinite(Number(p?.close)) && Number(p.close) > 0)
  if (points.length < 2) return null

  if (!seriesCoversAnchor(points as PricePointish[], reviewAnchor)) return null

  // The nearest close AT OR BEFORE the anchor. Walking backwards from the end
  // rather than scanning forwards, because the array is ascending.
  let base: PricePointish | null = null
  for (let i = points.length - 1; i >= 0; i--) {
    const t = new Date(points[i].date).getTime()
    if (Number.isFinite(t) && t <= anchorMs) { base = points[i]; break }
  }
  if (!base) return null

  // A close from long before the anchor is not a baseline for it.
  if (anchorMs - new Date(base.date).getTime() > BASELINE_TOLERANCE_DAYS * DAY_MS) return null

  const last = points[points.length - 1]
  if (last.date === base.date) return null

  return {
    changePct: ((last.close - base.close) / base.close) * 100,
    fromPrice: base.close,
    fromDate: base.date,
    toPrice: last.close,
    toDate: last.date,
  }
}

/**
 * The metric as a card shows it: a signed percentage, and nothing else.
 *
 * Formatted here so every surface that renders it agrees on precision and on
 * the sign character. Direction is carried by the sign and by the word; it is
 * never carried by a colour — see `EvidencePane` and `PriceContext`.
 */
export function formatSinceReview(v: SinceReview): string {
  const sign = v.changePct >= 0 ? '+' : '−'
  return `${sign}${Math.abs(v.changePct).toFixed(1)}%`
}
