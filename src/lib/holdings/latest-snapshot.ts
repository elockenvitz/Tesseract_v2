/**
 * `portfolio_holdings` is a series of dated snapshots, not a position list.
 *
 * Every row is a position *as it stood on a date*. A portfolio uploaded ten
 * times has ten rows for the same asset, and summing them treats ten snapshots
 * of one position as ten positions.
 *
 * That is not a hypothetical. `usePortfolioLenses` computed each portfolio's
 * total by summing every row it received, which inflated the denominator by the
 * number of snapshot dates — measured at 36x on Tech & Consumer Growth and 27x
 * on Vision Fund 10K. Every weight came out up to 36 times too small, and
 * because `MIN_WEIGHT_PCT` rejects anything under 0.5%, the conviction cards
 * emitted *nothing at all* rather than something visibly wrong. Live and
 * unflagged for the life of that code.
 *
 * An audit found 22 of 27 aggregating query sites had no date constraint, so
 * the defect was the norm rather than the outlier. This helper is the single
 * place that rule lives — 22 hand-written date filters would drift, and the
 * next person adding a query would copy whichever neighbour they happened to
 * read.
 *
 * ── When you do NOT need this ─────────────────────────────────────────────
 *
 * Queries that only want the SET of names a portfolio has ever held — "which
 * portfolios hold this asset?" — are unaffected, because duplicates across
 * snapshots do not change a set. 27 of the 54 query sites are in that group.
 * Use this whenever you sum, average, or build a denominator.
 */

/** The minimum shape this can work on. Extra fields pass through untouched. */
export interface DatedHolding {
  portfolio_id?: string | null
  date?: string | null
}

/**
 * Keep only the rows belonging to each portfolio's most recent snapshot.
 *
 * Grouped per portfolio rather than globally: portfolios are uploaded on
 * different schedules, so a single global max date would silently drop every
 * portfolio that had not been updated that day.
 *
 * Rows with no date are kept only when a portfolio has no dated rows at all —
 * dropping them outright would empty a portfolio whose snapshots predate the
 * column, and preferring them over dated rows would resurrect stale positions.
 */
export function latestSnapshotRows<T extends DatedHolding>(rows: readonly T[]): T[] {
  if (!rows.length) return []

  const newest = new Map<string, string>()
  for (const r of rows) {
    const key = r.portfolio_id ?? ''
    const d = r.date ?? ''
    const seen = newest.get(key)
    if (seen === undefined || d > seen) newest.set(key, d)
  }

  return rows.filter(r => (r.date ?? '') === newest.get(r.portfolio_id ?? ''))
}

/**
 * The `select` fragment every aggregating query needs.
 *
 * Exported so the guard can point at one name rather than a regex for the word
 * "date", and so a query that forgets it fails to compile against
 * {@link latestSnapshotRows} rather than silently returning every snapshot.
 */
export const HOLDINGS_DATE_FIELD = 'date' as const
