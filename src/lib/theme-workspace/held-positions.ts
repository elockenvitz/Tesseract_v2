/**
 * Which of a theme's names the firm actually owns, and in which books.
 *
 * ── Why this is a pure function and not part of the component ─────────────
 *
 * Because it is arithmetic over snapshot data, and that arithmetic is the
 * documented recurring defect in this codebase. `portfolio_holdings` is a
 * DATED table -- UNIQUE is (portfolio_id, asset_id, date) -- so a book
 * uploaded twice carries one row per asset per upload. Anything that sums raw
 * rows reports a multiple of the truth, and it looks right because it is the
 * right shape.
 *
 * So every number here comes out of `weightsByAsset`, which reduces to the
 * newest row per (portfolio, asset) first. Nothing in this file touches
 * `shares` or `price` directly.
 *
 * ── The one number that is NOT a sum ──────────────────────────────────────
 *
 * `topWeightPct` is the largest single-book stake, never a total. 25% of one
 * fund plus 4% of another is not 29% of anything: the denominators are
 * different books. The same reasoning is written out in
 * `largestWeightByAsset`, which this agrees with by construction -- it is the
 * max over the same per-book map.
 */

import { currentRows, weightsByAsset, type HoldingRow } from '../portfolio/holdings'

export interface HeldBook {
  portfolioId: string
  /** Null when the caller did not join `portfolios`, or cannot see the book. */
  name: string | null
  weightPct: number
}

export interface HeldName {
  assetId: string
  books: HeldBook[]
  /** Largest single-book weight. See the note above: never a sum. */
  topWeightPct: number
}

export interface HeldSummary {
  /** One entry per theme asset held somewhere, heaviest stake first. */
  names: HeldName[]
  /** Theme assets with no position in any book the reader can see. */
  unheldAssetIds: string[]
  /** Distinct books holding at least one of the theme's names. */
  bookCount: number
}

/**
 * Book names, taken from wherever the caller joined them.
 *
 * Reduced through `currentRows` for the same reason the weights are: a
 * superseded row carries a name too, and reading names off raw rows would
 * resurrect a book whose only current rows the reader cannot see.
 */
function bookNames(rows: readonly HoldingRow[]): Map<string, string | null> {
  const out = new Map<string, string | null>()
  for (const row of currentRows(rows)) {
    if (out.get(row.portfolio_id)) continue
    out.set(row.portfolio_id, row.portfolios?.name ?? null)
  }
  return out
}

/**
 * Split a theme's assets into held and not, with each held name's books.
 *
 * `rows` is every line of every book that holds any of these assets, which is
 * what `useHoldingsForAssets` returns -- the whole book, not just the matching
 * lines, because a weight's denominator is the book.
 *
 * `themeAssetIds` is the filter. Rows for names outside the theme are present
 * in `rows` on purpose (they are the rest of the book) and must not appear in
 * the result.
 */
export function heldNames(
  rows: readonly HoldingRow[],
  themeAssetIds: readonly string[],
): HeldSummary {
  const wanted = new Set(themeAssetIds.filter(Boolean))
  const weights = weightsByAsset(rows)
  const names = bookNames(rows)

  const held: HeldName[] = []
  const unheldAssetIds: string[] = []
  const books = new Set<string>()

  for (const assetId of wanted) {
    const perBook = weights.get(assetId)
    if (!perBook || perBook.size === 0) { unheldAssetIds.push(assetId); continue }

    const entries: HeldBook[] = []
    for (const [portfolioId, weightPct] of perBook) {
      /* A zero weight is not a holding. `buildBook` derives weight from
         market value, so a line sold down to zero shares comes through at 0
         rather than disappearing, and listing it would claim a position the
         firm no longer has. */
      if (!Number.isFinite(weightPct) || weightPct <= 0) continue
      entries.push({ portfolioId, name: names.get(portfolioId) ?? null, weightPct })
      books.add(portfolioId)
    }

    if (entries.length === 0) { unheldAssetIds.push(assetId); continue }

    entries.sort((a, b) => b.weightPct - a.weightPct)
    held.push({
      assetId,
      books: entries,
      topWeightPct: entries[0].weightPct,
    })
  }

  // Heaviest stake first: the question Overview answers is what the firm has
  // most at risk in this theme, not which name sorts first alphabetically.
  held.sort((a, b) => b.topWeightPct - a.topWeightPct)
  unheldAssetIds.sort()

  return { names: held, unheldAssetIds, bookCount: books.size }
}
