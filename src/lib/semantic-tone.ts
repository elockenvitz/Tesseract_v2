/**
 * What a colour is allowed to mean.
 *
 * ── The mistake this exists to stop happening a third time ────────────────
 *
 * Today shipped with four stale theses rendered in red, which told the reader
 * that four routine reviews were four emergencies. The fix there was to colour
 * by what a finding IS rather than by the evaluator's severity score, and the
 * vocabulary below is the result.
 *
 * Portfolio then made the same mistake independently: five positions, four of
 * them merely missing a written case and one genuinely trading through its own
 * bear case, all rendered rose. The screen said every position was equally
 * broken. It had the same fix available and did not use it, because the
 * vocabulary lived inside a Today component rather than anywhere a second
 * surface would find it.
 *
 * So it lives here. One definition, four meanings:
 *
 *   critical  something in the investment framework is actually broken, or
 *             capital is genuinely at risk. A price outside the case that was
 *             written for it. Never "work is outstanding".
 *   review    something needs attention, completion or a decision. A case
 *             nobody has written, a review nobody has done, evidence nobody
 *             has read. Important, frequently urgent, NOT broken.
 *   info      ordinary context worth noticing and nothing more.
 *   neutral   present, unremarkable, healthy. Deliberately quiet: a green
 *             badge on every aligned position is decoration, and it dilutes
 *             the two tones that carry meaning.
 *
 * ── Severity is not importance ───────────────────────────────────────────
 *
 * These are orthogonal, and conflating them is the other half of the bug. A
 * 28.2% position with no written case is the most IMPORTANT thing on the
 * screen and is still only `review`; it is not broken, it is unfinished.
 * Ranking answers "what first", tone answers "how bad" — and neither is
 * allowed to be computed from the other.
 */

export type SemanticTone = 'critical' | 'review' | 'info' | 'neutral'

/** Pill / badge: tinted ground, readable text, hairline border. */
export const TONE_PILL: Record<SemanticTone, string> = {
  critical: 'text-rose-700 bg-rose-50 border-rose-200 dark:text-rose-300 dark:bg-rose-950/40 dark:border-rose-900/50',
  review: 'text-amber-800 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/40 dark:border-amber-900/50',
  info: 'text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-300 dark:bg-blue-950/40 dark:border-blue-900/50',
  neutral: 'text-gray-600 bg-gray-100 border-gray-200 dark:text-gray-400 dark:bg-white/[0.06] dark:border-white/10',
}

/**
 * Condition as ink on a label, with no chip around it.
 *
 * The lightest treatment that still reads, and the one the desktop field
 * uses. `TONE_PILL` remains for the places a filled chip is genuinely right --
 * a lone badge on a phone tile, where there is nothing else to carry the
 * state -- but a desktop gallery of them reads as a queue of tagged records
 * rather than a set of investment objects.
 */
export const TONE_INK: Record<SemanticTone, string> = {
  critical: 'text-rose-700 dark:text-rose-400',
  review: 'text-amber-700 dark:text-amber-500',
  info: 'text-blue-700 dark:text-blue-400',
  neutral: 'text-gray-500',
}

/**
 * Solid fill, for area marks that carry no text of their own.
 *
 * Separate from the pill because a 6%-wide map segment tinted at pill strength
 * reads as grey. `neutral` is a real fill rather than a tint, so a healthy book
 * is legible without being celebrated.
 */
export const TONE_FILL: Record<SemanticTone, string> = {
  critical: 'bg-rose-500/85 text-white',
  review: 'bg-amber-400/90 text-amber-950',
  info: 'bg-blue-500/70 text-white',
  neutral: 'bg-gray-300 text-gray-700 dark:bg-white/20 dark:text-gray-200',
}

/** Left rule or hairline accent, for chrome that must not shout. */
export const TONE_ACCENT: Record<SemanticTone, string> = {
  critical: 'border-rose-300 dark:border-rose-900/60',
  review: 'border-amber-300 dark:border-amber-900/60',
  info: 'border-blue-300 dark:border-blue-900/60',
  neutral: 'border-gray-200 dark:border-white/10',
}
