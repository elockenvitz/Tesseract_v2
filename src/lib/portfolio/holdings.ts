/**
 * What a book actually holds, and what each line weighs.
 *
 * ── Two holdings tables, one of them nearly empty ─────────────────────────
 *
 * Production carries both:
 *
 *   portfolio_holdings            1086 rows / 36 portfolios — shares, price,
 *                                 cost, date. NO weight column.
 *   portfolio_holdings_positions  1058 rows / 28 portfolios — weight_pct,
 *                                 market_value, cost_basis, sector, tied to
 *                                 portfolio_holdings_snapshots.
 *
 * The second is richer and looks canonical, and `useAssetPortfolioWeights`
 * calls it the book of record. But in the reviewing organisation it covers
 * ONE of nine portfolios. Reading it alone would show eight empty books.
 *
 * So `portfolio_holdings` is the canonical table here and weight is DERIVED,
 * which is what the legacy PortfolioTab and PositionsTab already do. Where a
 * snapshot weight also exists the two can disagree; this module does not
 * silently merge them, and the difference is reported rather than averaged.
 *
 * ── portfolio_holdings is the CURRENT WORKING BOOK ────────────────────────
 *
 * UNIQUE is (portfolio_id, asset_id) — one live row per position, and no row
 * means not held. See migration 20260907100000.
 *
 * It used to be UNIQUE (portfolio_id, asset_id, date), so a book uploaded
 * twice carried one row per asset per upload and summing raw rows reported
 * double its real NAV. `workingBookRows` was the fix for that, and on the current
 * schema it is a no-op the database already guarantees. It stays because
 * callers also feed it fixtures and merged result sets, and because a
 * duplicate reaching a denominator is the failure this module exists to
 * prevent.
 *
 * `date` is now PROVENANCE: when that one line last changed. It is not the
 * book's as-of — that is `portfolios.book_as_of` — and nothing here may
 * filter on it. A book whose AAPL moved today and whose other names moved in
 * May has many dates in it and every position is current.
 *
 * ── Cash is a book line, not a position ───────────────────────────────────
 *
 * Three of the nine portfolios here are 100% CASH_USD. Cash has a value and a
 * weight and no other financial property: no price to compare, no thesis to
 * review, no target to miss. Classification goes through the shared
 * `isCashLine` predicate rather than a fourth local copy of the symbol list.
 */

import { isCashLine } from '../signals/instruments'
import { workingBookRows } from '../holdings/working-book'

// Re-exported so the surfaces that build books from this module keep a single
// import. The definition lives in lib/holdings/working-book.ts, which is the
// one name for this idea after four.
export { workingBookRows }

export interface HoldingRow {
  portfolio_id: string
  asset_id: string
  shares: number | string | null
  price: number | string | null
  cost: number | string | null
  date: string | null
  assets?: { id?: string; symbol?: string | null; company_name?: string | null; sector?: string | null; industry?: string | null } | null
}

export interface Position {
  portfolioId: string
  assetId: string
  symbol: string | null
  companyName: string | null
  sector: string | null
  shares: number
  price: number
  /** Per-share average cost. Meaningless for cash, which is held at par. */
  avgCost: number | null
  marketValue: number
  /** Percent of the book's market value. Derived, never read from a column. */
  weightPct: number
  /** The upload this line came from. Weights are only as current as the book. */
  asOf: string | null
  isCash: boolean
}

export interface Book {
  portfolioId: string
  positions: Position[]
  /** Sum of market value across every current line, cash included. */
  totalValue: number
  cashValue: number
  cashPct: number
  /** Priceable lines only — cash is not a position. */
  positionCount: number
  /** Newest upload date across the book. */
  asOf: string | null
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}


/**
 * Build one book from raw rows.
 *
 * Rows for other portfolios are ignored rather than silently mixed in — an
 * asset can sit in several books at very different weights (AAPL is 25.3% of
 * Large Cap Growth and 4.0% of Vision Fund 5K), so a position is identified by
 * (asset, portfolio) and never by asset alone.
 */
export function buildBook(portfolioId: string, rows: readonly HoldingRow[]): Book {
  const mine = workingBookRows(rows).filter(r => r.portfolio_id === portfolioId)

  const priced = mine.map(r => {
    const symbol = r.assets?.symbol ?? null
    const shares = num(r.shares)
    const price = num(r.price)
    return { row: r, symbol, shares, price, marketValue: shares * price }
  })

  const totalValue = priced.reduce((s, p) => s + p.marketValue, 0)
  const cashValue = priced
    .filter(p => isCashLine(p.symbol))
    .reduce((s, p) => s + p.marketValue, 0)

  const positions: Position[] = priced.map(p => {
    const isCash = isCashLine(p.symbol)
    return {
      portfolioId,
      assetId: p.row.asset_id,
      symbol: p.symbol,
      companyName: p.row.assets?.company_name ?? null,
      sector: p.row.assets?.sector ?? null,
      shares: p.shares,
      price: p.price,
      // Cash is held at par, and on real uploads `cost` on a cash line is the
      // total balance rather than a per-share figure -- reading it produced a
      // ten-quadrillion-dollar cost basis. Null means "not a meaningful
      // number", which is the truth, rather than zero.
      avgCost: isCash ? null : (num(p.row.cost) || null),
      marketValue: p.marketValue,
      weightPct: totalValue > 0 ? (p.marketValue / totalValue) * 100 : 0,
      asOf: p.row.date ?? null,
      isCash,
    }
  }).sort((a, b) => b.weightPct - a.weightPct || a.assetId.localeCompare(b.assetId))

  return {
    portfolioId,
    positions,
    totalValue,
    cashValue,
    cashPct: totalValue > 0 ? (cashValue / totalValue) * 100 : 0,
    positionCount: positions.filter(p => !p.isCash).length,
    asOf: mine.reduce<string | null>((m, r) => (r.date && (!m || r.date > m) ? r.date : m), null),
  }
}

/**
 * What each asset weighs, per portfolio, across every book in `rows`.
 *
 * Keyed `assetId -> portfolioId -> weightPct`. Two levels deliberately: a flat
 * asset->weight map is the shape that lets one book's weight be shown against
 * another book's position, and the same asset genuinely carries different
 * weights in different books.
 */
export function weightsByAsset(rows: readonly HoldingRow[]): Map<string, Map<string, number>> {
  const byPortfolio = new Map<string, HoldingRow[]>()
  for (const r of workingBookRows(rows)) {
    const list = byPortfolio.get(r.portfolio_id) ?? []
    list.push(r)
    byPortfolio.set(r.portfolio_id, list)
  }

  const out = new Map<string, Map<string, number>>()
  for (const [pid, list] of byPortfolio) {
    for (const p of buildBook(pid, list).positions) {
      const perPortfolio = out.get(p.assetId) ?? new Map<string, number>()
      perPortfolio.set(pid, p.weightPct)
      out.set(p.assetId, perPortfolio)
    }
  }
  return out
}

/**
 * The largest weight this asset carries in any book the caller can see.
 *
 * For surfaces that are asset-centred rather than book-centred (Research asks
 * "does this name matter enough to review?"). Summing across books would be
 * meaningless -- 25% of one fund plus 4% of another is not 29% of anything --
 * so the answer is the biggest single-book stake, and callers that need the
 * breakdown read `weightsByAsset` instead.
 */
export function largestWeightByAsset(rows: readonly HoldingRow[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [assetId, perPortfolio] of weightsByAsset(rows)) {
    const max = Math.max(...perPortfolio.values())
    if (Number.isFinite(max) && max > 0) out[assetId] = max
  }
  return out
}

/** Unrealised gain on a priceable line. Null where cost is unknown or it is cash. */
export function unrealised(p: Position): { gain: number; pct: number } | null {
  if (p.isCash || !p.avgCost || p.avgCost <= 0 || p.shares <= 0) return null
  const costBasis = p.shares * p.avgCost
  if (costBasis <= 0) return null
  const gain = p.marketValue - costBasis
  return { gain, pct: (gain / costBasis) * 100 }
}
