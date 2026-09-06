/**
 * The current working book, from raw `portfolio_holdings` rows.
 *
 * ── One name, after four ──────────────────────────────────────────────────
 *
 * This replaces `latestSnapshotRows`, `currentRows`, `currentHoldings` and a
 * hand-written copy in the portfolio detail page. They existed because the
 * table used to be UNIQUE (portfolio_id, asset_id, date) and every surface
 * that summed it had to reduce first — so each lane wrote its own reduction,
 * and two of them disagreed about what "current" meant:
 *
 *   currentRows          newest row per (portfolio, asset)
 *   latestSnapshotRows   every row on the portfolio's newest DATE
 *
 * Both were correct readings of a dated table. They returned different books
 * the moment a writer touched one asset without touching the rest, which is
 * how Mobile and Desktop came to disagree by up to 49x on the same portfolio.
 * Keeping four names for one idea is what let that difference survive review
 * for as long as it did.
 *
 * ── What it does now ──────────────────────────────────────────────────────
 *
 * `portfolio_holdings` is the working book: UNIQUE (portfolio_id, asset_id),
 * one live row per position, no row means not held (migration
 * 20260907100000). So on data that came from the database this is a no-op,
 * and it is kept for the inputs that did not:
 *
 *   - fixtures and hand-built arrays in tests
 *   - result sets merged from more than one query
 *   - anything a future caller assembles by hand
 *
 * A duplicate reaching a denominator is the failure this module exists to
 * prevent. It is cheap to keep and expensive to discover missing.
 *
 * ── What it must never become again ───────────────────────────────────────
 *
 * A date filter. `date` on a row is provenance — when that one line last
 * changed — and a book whose AAPL moved today and whose other 34 names last
 * moved in May has 35 dates in it with all 35 positions current. The book's
 * as-of is `portfolios.book_as_of`, which is not derivable from these rows.
 * `scripts/holdings-collapse-audit.mjs` fails the build on a date predicate.
 */

/** The minimum shape this can work on. Extra fields pass through untouched. */
export interface WorkingBookRow {
  portfolio_id?: string | null
  asset_id?: string | null
  date?: string | null
}

/**
 * One row per (portfolio, asset).
 *
 * Keyed on the pair, never on the asset alone: the same name is held in
 * several books at very different weights — AAPL is 25.3% of Large Cap Growth
 * and 4.0% of Vision Fund 5K — so collapsing on asset would merge two
 * positions into whichever arrived first.
 *
 * Where a duplicate does appear the newer `date` wins, so the survivor is the
 * later state of that position rather than whichever the query happened to
 * return first. Comparing dates rather than trusting arrival order is what
 * makes the answer stable across callers that order their queries differently.
 */
export function workingBookRows<T extends WorkingBookRow>(rows: readonly T[] | null | undefined): T[] {
  if (!rows?.length) return []

  const held = new Map<string, T>()
  for (const r of rows) {
    if (!r) continue
    // A row with no asset cannot be a position. Passed through under a key of
    // its own rather than dropped, because several callers select only
    // `portfolio_id` to answer "which books hold this name" and dropping
    // those would turn a membership question into an empty answer.
    const key = r.asset_id
      ? `${r.portfolio_id ?? ''}:${r.asset_id}`
      : ` ${held.size}`
    const seen = held.get(key)
    if (!seen || (r.date ?? '') > (seen.date ?? '')) held.set(key, r)
  }
  return [...held.values()]
}
