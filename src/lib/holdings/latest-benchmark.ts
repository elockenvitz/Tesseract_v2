/**
 * `portfolio_benchmark_weights` is about to become a dated series, and every
 * existing read of it assumes it is not.
 *
 * ── The trap, stated before it springs ────────────────────────────────────
 *
 * Today the table holds exactly one file: SPY, as_of 2026-08-14, 483 names,
 * one copy per portfolio. A `UNIQUE (portfolio_id, asset_id)` constraint makes
 * a second date impossible, so every read site selects `asset_id, weight` with
 * no date predicate and is accidentally correct.
 *
 * The moment that constraint is relaxed to allow history — which is what
 * historical active weights require — those five call sites silently start
 * summing or overwriting across dates. That is not a hypothetical failure
 * mode; it is `docs/handoff.md` §5c, the distinct-vs-current collapse, which
 * already inflated portfolio denominators by up to 36x in `usePortfolioLenses`
 * and made every conviction card emit nothing rather than something visibly
 * wrong.
 *
 * So this helper exists BEFORE the migration rather than after it. Applied
 * today it is a no-op, because there is one date; applied after the migration
 * it is the only thing standing between the feed and the same defect a third
 * time.
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
