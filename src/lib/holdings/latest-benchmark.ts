/**
 * Keep only each portfolio's newest benchmark file. The correctness backstop,
 * not the mechanism for narrowing the read.
 *
 * ── The trap sprang ──────────────────────────────────────────────────────
 *
 * This was written while the table still held exactly one file per portfolio,
 * when `UNIQUE (portfolio_id, asset_id)` made a second date impossible and
 * every read site selected `asset_id, weight` with no date predicate and was
 * accidentally correct. The prediction was that relaxing the constraint for
 * historical active weights would make those sites silently sum or overwrite
 * across dates — `docs/handoff.md` §5c, the distinct-vs-current collapse,
 * which had already inflated portfolio denominators by up to 36x in
 * `usePortfolioLenses`.
 *
 * The constraint was relaxed. The prediction was right and this helper did
 * its job: no read site produced a wrong number.
 *
 * What it could not do, because it runs in the browser, is stop those sites
 * TRANSFERRING the history they then discarded. The table reached 33 dates and
 * the largest portfolio's read reached 2.46 MB to use 76 KB of it — a 33x
 * amplification that grew by one date a day and accounted for most of one
 * day's PostgREST egress.
 *
 * So the read is narrowed server-side now, by
 * `lib/holdings/benchmark-latest-query`, and this stays as the backstop
 * underneath it: cheap once the payload is already one date, and the reason a
 * mistake there is a performance regression rather than a wrong number.
 *
 * ── Why per portfolio, not globally ───────────────────────────────────────
 *
 * Benchmark files arrive per portfolio and can be refreshed on different days.
 * A single global max date would silently drop every portfolio whose file had
 * not been refreshed that morning — the same reasoning as
 * `latestSnapshotRows`, and the same shape of bug if it were skipped.
 */

/** The minimum shape this works on. Extra fields pass through untouched. */
export interface DatedBenchmarkWeight {
  portfolio_id?: string | null
  as_of_date?: string | null
}

/**
 * Keep only the rows belonging to each portfolio's newest benchmark file.
 *
 * Rows with no `as_of_date` are kept only when a portfolio has no dated rows
 * at all. Dropping them outright would empty a portfolio whose file predates
 * the column; preferring them over dated rows would resurrect a stale index.
 */
export function latestBenchmarkRows<T extends DatedBenchmarkWeight>(rows: readonly T[]): T[] {
  if (!rows.length) return []

  const newest = new Map<string, string>()
  for (const r of rows) {
    const key = r.portfolio_id ?? ''
    const d = r.as_of_date ?? ''
    const seen = newest.get(key)
    if (seen === undefined || d > seen) newest.set(key, d)
  }

  return rows.filter(r => (r.as_of_date ?? '') === newest.get(r.portfolio_id ?? ''))
}
