/**
 * Ordering instrument search results so the ticker you typed comes first.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * The symbol search asks PostgREST for
 *
 *   .or(`symbol.ilike.%Q%,company_name.ilike.%Q%`).limit(10)
 *
 * and renders the rows in whatever order they come back. A substring buried
 * in a company NAME therefore outranks an exact ticker. Measured against the
 * live corpus:
 *
 *   "CAT"  ->  ZOOM  (Zoom Video Communi-CAT-ions)   Caterpillar 2nd
 *   "MS"   ->  META  (Meta Platfor-MS)               MSFT        2nd
 *   "V"    ->  CASH_USD (Cash & Equi-V-alents)       Visa        5th
 *
 * On a terminal whose whole interaction is "type the ticker, press enter",
 * that is not cosmetic: it selects the wrong instrument.
 *
 * ── Why ordering alone does not fix it ───────────────────────────────────
 *
 * `.limit(10)` is applied by the DATABASE, before anything here can see the
 * rows. For a one-letter query like "V" the `%v%` pattern matches hundreds of
 * assets, and the ten that come back are an arbitrary ten -- Visa may not be
 * among them at all. Re-sorting a page that never contained the answer
 * cannot produce the answer.
 *
 * So the caller issues a second, narrow query for `symbol.ilike.Q%` and
 * merges it in. That prefix query is what GUARANTEES the ticker is present;
 * this module is what puts it first. Both halves are needed, and a test here
 * covers the ranking half while `rankInstruments` is handed the merged set.
 *
 * ── The tiers ────────────────────────────────────────────────────────────
 *
 * Deliberately coarse, because a score people cannot predict is worse on a
 * terminal than a plain rule they can:
 *
 *   0  symbol is exactly the query
 *   1  symbol starts with the query
 *   2  company name starts with the query
 *   3  symbol contains the query
 *   4  company name contains the query
 *
 * Symbol-contains outranks name-starts-with only at tier 3 vs 2 -- a name
 * that OPENS with what you typed ("Micro..." for "micro") is a better guess
 * than a ticker with those letters somewhere in the middle.
 *
 * Ties break alphabetically by symbol, so the list is stable between
 * keystrokes rather than reshuffling on identical input.
 */

/** The shape the search returns. Kept structural so both call sites fit. */
export interface RankableInstrument {
  id: string
  symbol: string
  company_name: string | null
}

export const RANK_EXACT_SYMBOL = 0
export const RANK_SYMBOL_PREFIX = 1
export const RANK_NAME_PREFIX = 2
export const RANK_SYMBOL_CONTAINS = 3
export const RANK_NAME_CONTAINS = 4
/** Matched neither field -- should not happen, but must not rank first. */
export const RANK_NONE = 5

/**
 * Which tier a row falls in. Exported so a test can pin the tiers
 * themselves, not merely the order they happen to produce.
 */
export function rankOf(item: RankableInstrument, query: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return RANK_NONE
  const symbol = (item.symbol ?? '').toLowerCase()
  const name = (item.company_name ?? '').toLowerCase()

  if (symbol === q) return RANK_EXACT_SYMBOL
  if (symbol.startsWith(q)) return RANK_SYMBOL_PREFIX
  if (name.startsWith(q)) return RANK_NAME_PREFIX
  if (symbol.includes(q)) return RANK_SYMBOL_CONTAINS
  if (name.includes(q)) return RANK_NAME_CONTAINS
  return RANK_NONE
}

/**
 * Merge, de-duplicate and order instrument search results.
 *
 * De-duplication is by `id` and keeps the FIRST occurrence, so the caller
 * may pass the prefix results ahead of the broad ones without producing a
 * row twice. Identity is the id for the same reason it is in the recents
 * list: two organizations can hold different assets under one symbol.
 *
 * An empty query returns the input de-duplicated and otherwise untouched --
 * there is nothing to rank against, and inventing an order would be worse
 * than leaving the caller's.
 */
export function rankInstruments<T extends RankableInstrument>(
  items: T[],
  query: string,
  limit = 10,
): T[] {
  const seen = new Set<string>()
  const unique: T[] = []
  for (const item of items) {
    if (!item || !item.id || seen.has(item.id)) continue
    seen.add(item.id)
    unique.push(item)
  }

  const q = query.trim()
  if (!q) return unique.slice(0, limit)

  return unique
    .map((item, index) => ({ item, rank: rankOf(item, q), index }))
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank
      const bySymbol = (a.item.symbol ?? '').localeCompare(b.item.symbol ?? '')
      if (bySymbol !== 0) return bySymbol
      /* Last resort: the order they arrived, so the sort is total and the
         list cannot reshuffle on identical input. */
      return a.index - b.index
    })
    .map(entry => entry.item)
    .slice(0, limit)
}
