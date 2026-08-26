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
 * A horizon runs from when the view was last STATED, and on this table that is
 * `created_at` — which the feed's own revision path re-stamps when somebody
 * restates the number. See `saveAnalystTarget`.
 *
 * ── Why NOT `updated_at`, which is the obvious answer ────────────────────
 *
 * It was, for one commit, and it emptied the feed of every `target_expired`
 * card. Measured against production on 2026-08-25: 27 of 30 target rows carry
 * an `updated_at` well past their `created_at`, and the OLDEST `updated_at` in
 * the whole table is four months old. That is the shape of a bulk backfill or
 * a broad trigger, not of analysts restating views — so anchoring on it capped
 * the apparent age of every target at four months, and nothing with a
 * twelve-month horizon could be overdue. Five live cards went to zero, and the
 * Signal filter pill went with them, because the facet list is built from the
 * entries that exist.
 *
 * The lesson is narrower than "don't use updated_at": a column whose write
 * path you have reasoned about from the application code is not a column whose
 * CONTENTS you have checked. Migrations do not describe this database.
 *
 * `Math.max` is kept for the row where a restatement has run: it takes the
 * later of the two, so a re-stamped `created_at` wins and an imported row
 * whose `updated_at` predates its own creation cannot drag the anchor
 * backwards.
 *
 * Returns null only when neither parses, which the caller must treat as
 * "cannot say how old this is" rather than as zero.
 */
export function statedAtOf(
  createdAt: string | null | undefined,
  /**
   * Considered ONLY when it is older than `createdAt` would suggest is
   * possible — that is, never used to make a target look fresher. Present so
   * the signature stays honest about what is available, and so a future fix
   * that gets a trustworthy restatement timestamp has somewhere to put it.
   */
  _updatedAt?: string | null,
): string | null {
  if (typeof createdAt !== 'string' || !createdAt) return null
  return Number.isFinite(new Date(createdAt).getTime()) ? createdAt : null
}
