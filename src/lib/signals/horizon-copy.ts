/**
 * A stored horizon, put in front of a noun.
 *
 * `analyst_price_targets.timeframe` holds a noun phrase — "6 months", "12
 * months" — because that is how it is entered and how it reads alone. Dropped
 * in front of a noun it needs the attributive form, and two surfaces were
 * printing the stored string straight through: "A 6 months view, written 14
 * months ago" on the horizon pane, and "outlived its 6 months horizon" in the
 * card headline.
 *
 * Only the plural-unit case is touched. A timeframe somebody typed as "H1 2027"
 * or as a date passes through unchanged rather than being guessed at — this is
 * a hyphen, not a parser.
 */
export function attributiveHorizon(timeframe: string): string {
  return timeframe.replace(/^(\d+)\s+(month|year|week|day)s\b/i, '$1-$2')
}

/**
 * When a target's horizon starts counting.
 *
 * A horizon runs from when the view was last STATED, which is not when the row
 * was first inserted. Measuring from `created_at` makes an expired target
 * permanently expired: restating it writes `updated_at` and leaves `created_at`
 * alone, so the age the lens computes never moves and the card returns saying
 * exactly what it said before the reader answered it.
 *
 * The newer of the two, rather than `updated_at ?? created_at`, because a
 * backfilled or imported row can carry an `updated_at` that predates its own
 * creation — and a horizon anchored before the target existed would make a
 * fresh view look ancient.
 *
 * Returns null only when neither parses, which the caller must treat as "cannot
 * say how old this is" rather than as zero.
 */
export function statedAtOf(
  createdAt: string | null | undefined,
  updatedAt?: string | null,
): string | null {
  const times = [createdAt, updatedAt]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .map(v => [v, new Date(v).getTime()] as const)
    .filter(([, t]) => Number.isFinite(t))
  if (!times.length) return null
  return times.reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0]
}
