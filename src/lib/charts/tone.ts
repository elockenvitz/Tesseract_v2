/**
 * Which way a price moved, in colour.
 *
 * ── Why this is one shared value and not a per-lens choice ───────────────
 *
 * Two chart implementations already share `indexAtClientX` from this
 * directory, because a point picked on one surface and a point picked on
 * another must resolve identically. The same argument applies to the ink: a
 * price falling on Today and a price falling on Ideas are the same fact, and
 * a reader moving between lenses should not have to relearn what the colour
 * means. It lives beside the scrub mapping for that reason.
 *
 * ── A decision that was made twice, both times as a refusal ──────────────
 *
 * Ideas' system file said colour had three jobs and direction was not one:
 * "a sell is a stance, not a warning... there is no green anywhere: a price
 * that rose is not a grade". Today's visual file said the same thing with a
 * sharper example: these lines were once green on a rise and red on a fall,
 * and a stale thesis on a name that fell "looked like a failure" while one on
 * a name that rose "looked like a success".
 *
 * The half of that about JUDGEMENT is right and is enforced elsewhere: a
 * stance takes no colour, a conviction is not graded, a maturity is not a
 * traffic light, and a thesis nobody has revisited is equally overdue whether
 * the price went up or down.
 *
 * The half about the PRICE confused a judgement with a fact. Which way a
 * price moved is not a verdict on anybody's work; it is the most-read number
 * on the card, and every instrument a professional actually uses encodes it
 * exactly this way. Refusing it did not make the surfaces more rigorous. It
 * made them grey, and they were reported as looking rudimentary until the
 * refusal was lifted.
 *
 * ── The collision Today was right to worry about ─────────────────────────
 *
 * Today runs a severity palette on the same cards -- rose for a break, amber
 * for something going stale -- and its old comment warned that "rose would
 * say broken". That risk is real and it is handled by SHAPE and PLACE rather
 * than by refusing the hue: severity is small-caps text in the card's chrome,
 * direction is a plotted line and the figure directly above it. What must
 * never happen is a severity badge taking its colour from the tape, or a
 * price line taking its colour from the severity -- those stay independent.
 *
 * Spend this on a price series, its fill, its end marker, and the return
 * measured from the mark the caption names. Nowhere else. If a value is an
 * opinion rather than an observation, it does not get this colour.
 */
export const MOVE = {
  up: 'text-emerald-600 dark:text-emerald-400',
  down: 'text-rose-600 dark:text-rose-500',
} as const

/** The tone for a signed move, so no caller re-derives the comparison. */
export const moveTone = (pct: number) => (pct >= 0 ? MOVE.up : MOVE.down)
