/**
 * Exploring a number without committing to it.
 *
 * ── Why one model for three controls ──────────────────────────────────────
 *
 * The target tuner, the case editor and the size explorer are the same
 * interaction wearing three different sets of labels: there is a number of
 * record, the reader drags it somewhere else to see what that would mean, and
 * then either commits or does not. Each had implemented that separately, and
 * each got a different part of it wrong — one wrote through on every drag, one
 * had no way back to the recorded value, none of them said which number the
 * reader was currently looking at.
 *
 * That last one is the whole complaint. "The target manipulation concept is
 * strong but the current execution is difficult to understand" is what happens
 * when a control shows one number and the reader cannot tell whether it is the
 * market price, the saved view, or the thing they just dragged to.
 *
 * ── The three values, always distinguishable ──────────────────────────────
 *
 *   REFERENCE  what the market says      — never editable, context only
 *   RECORDED   what the firm has saved   — the number of record
 *   PROPOSED   what the reader is trying — exists only while exploring
 *
 * `proposed` is null until somebody moves something. That is deliberate: a
 * control with a proposed value equal to the recorded one is visually
 * indistinguishable from one that has never been touched, and the difference
 * matters for whether Save should do anything.
 *
 * Pure — no React, no persistence. The components render it; the callers save
 * it through whatever infrastructure already owns that number.
 */

export interface Exploration {
  /** The market price, or whatever the proposal is measured against. */
  reference: number | null
  /** The saved value. Null when nothing has ever been recorded. */
  recorded: number | null
  /** What the reader is trying. Null when they are not exploring. */
  proposed: number | null
}

export function beginExploration(recorded: number | null, reference: number | null): Exploration {
  return { reference, recorded, proposed: null }
}

/**
 * The value a control should currently display.
 *
 * Proposed wins while exploring, then the recorded value, then the reference.
 * The fallback to reference is what gives a name with no target a sensible
 * place for the slider to start: the market price, which is the only number
 * anyone has.
 */
export function displayedValue(e: Exploration): number | null {
  return e.proposed ?? e.recorded ?? e.reference
}

/** Which of the three the reader is looking at. Drives the label. */
export function displayedKind(e: Exploration): 'proposed' | 'recorded' | 'reference' | 'none' {
  if (e.proposed != null) return 'proposed'
  if (e.recorded != null) return 'recorded'
  if (e.reference != null) return 'reference'
  return 'none'
}

/**
 * Whether there is anything to save.
 *
 * A proposal identical to the recorded value is not a change, and offering to
 * save it invites a write that records nothing and stamps an audit row saying
 * somebody made a decision.
 */
export function isDirty(e: Exploration): boolean {
  if (e.proposed == null) return false
  if (e.recorded == null) return true
  return !nearlyEqual(e.proposed, e.recorded)
}

/**
 * Percentage from the reference to a value.
 *
 * Null rather than zero when there is no reference: a card that cannot compute
 * upside must say so, not claim the upside is flat. That distinction is the
 * same one `price-availability` draws, for the same reason.
 */
export function upsidePct(value: number | null, reference: number | null): number | null {
  if (value == null || reference == null || !Number.isFinite(reference) || reference <= 0) return null
  return ((value - reference) / reference) * 100
}

/** Absolute change in points, for values that ARE percentages (weights). */
export function pointsChange(value: number | null, from: number | null): number | null {
  if (value == null || from == null) return null
  return value - from
}

/** Stop exploring and go back to the number of record. */
export function resetExploration(e: Exploration): Exploration {
  return { ...e, proposed: null }
}

export function propose(e: Exploration, value: number): Exploration {
  if (!Number.isFinite(value)) return e
  return { ...e, proposed: value }
}

/**
 * Commit: the proposal becomes the record.
 *
 * Returns the new state AND the value to persist, so a caller cannot
 * accidentally save one thing and display another.
 */
export function commitExploration(e: Exploration): { next: Exploration; saved: number } | null {
  if (!isDirty(e) || e.proposed == null) return null
  return { next: { ...e, recorded: e.proposed, proposed: null }, saved: e.proposed }
}

/**
 * Float comparison with a tolerance suited to money and percentages.
 *
 * A slider that steps in cents produces values like 210.00000000000003, and
 * `!==` on those makes Save permanently enabled on a control nobody touched.
 */
export function nearlyEqual(a: number, b: number, epsilon = 1e-6): boolean {
  return Math.abs(a - b) <= epsilon * Math.max(1, Math.abs(a), Math.abs(b))
}

/**
 * A sensible range for a slider around a set of reference points.
 *
 * ── Why the bounds are derived rather than fixed ──────────────────────────
 *
 * A fixed ±50% window is wrong at both ends: on a name trading at $3 it offers
 * a resolution nobody needs, and on one whose bull case is 4× the price it puts
 * the case off the end of the track. So the range covers every number the
 * reader can already see — price, recorded target, every case — with headroom,
 * which guarantees that dragging can always REACH the values the card is
 * talking about.
 */
export function sliderRange(
  points: (number | null | undefined)[],
  padding = 0.35,
): { min: number; max: number; step: number } {
  const vals = points.filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0)
  if (!vals.length) return { min: 0, max: 100, step: 1 }
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const span = hi - lo || hi * 0.5 || 1
  const padded = span * (1 + padding * 2)

  /**
   * Step and bounds are derived TOGETHER, and the bounds snap to the step.
   *
   * An `<input type="range">` quantises to `min + n * step`, so a range whose
   * minimum is 9.2483 puts every reachable value on that offset grid — and a
   * reader who types 225, or drags to what looks like 225, gets 224.9483. The
   * number they see is then not the number that saves, which is the exact
   * failure this whole control exists to prevent.
   *
   * Snapping `min` down to a multiple of the step makes every round number in
   * the range reachable, which is what people actually aim for.
   */
  const step = niceStep(padded / 300)

  /**
   * Headroom is relative as well as span-based.
   *
   * Span padding alone is too tight when the known levels sit close together:
   * a $182 price with a $210 target gives a 28-point span, so a 35% pad tops
   * the track out at $220 and the reader simply cannot propose $225. The
   * control's whole purpose is exploring values nobody has recorded yet, so
   * the range has to extend beyond the ones that have been.
   *
   * A quarter above the highest level and a quarter below the lowest is
   * scale-invariant, so it behaves the same on a $3 name and a $3,000 one.
   */
  const rawMin = Math.min(lo - span * padding, lo * 0.75)
  const rawMax = Math.max(hi + span * padding, hi * 1.25)
  return {
    min: Math.max(0, Math.floor(rawMin / step) * step),
    max: Math.ceil(rawMax / step) * step,
    step,
  }
}

/** The nearest 1/2/5 x 10^n at or below `raw`. Round numbers, at any scale. */
function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1
  const exp = Math.floor(Math.log10(raw))
  const mag = Math.pow(10, exp)
  const norm = raw / mag
  const mult = norm >= 5 ? 5 : norm >= 2 ? 2 : 1
  return mult * mag
}

/**
 * Parse what somebody typed into a price or percentage field.
 *
 * Tolerant of the things people actually type — currency symbols, thousands
 * separators, a stray percent sign — and strict about the result: anything
 * that does not resolve to a finite positive number is rejected rather than
 * coerced, because `Number('')` is 0 and a target of zero is a real value that
 * nobody meant to enter.
 */
export function parseNumericEntry(raw: string): number | null {
  const cleaned = raw.replace(/[$€£¥,\s%]/g, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}
