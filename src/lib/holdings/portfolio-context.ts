import { isCashLine } from '../signals/instruments'
import { latestSnapshotRows, type DatedHolding } from './latest-snapshot'

/**
 * What is true about ONE asset in ONE book, right now.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Research attention is about an asset. Capital attention is not: AAPL at 15%
 * of Large Cap Core and AAPL at 0.4% of Vision Fund 10K are two different
 * situations with two different answers, and an asset-keyed derivation can only
 * describe one of them. Everything a Portfolio signal wants to say — is this
 * held, how much of the book is it, is that number worth printing, when was the
 * book true — is a statement about a PAIR.
 *
 * ── Why it is pure ────────────────────────────────────────────────────────
 *
 * No React and no Supabase, for the same reason `holdings-context` and
 * `latest-snapshot` are pure: the interesting part is the rule, and a rule that
 * can only be exercised through a mocked client is a rule nothing tests. The
 * ordering defect that made every weight up to 36x too small lived for the life
 * of its code precisely because it was only expressible as a chained query.
 *
 * ── The one calculation ───────────────────────────────────────────────────
 *
 * `usePortfolioLenses` already derives weights this way and its four lenses
 * agree because they share the locals inside one closure. Anything outside that
 * closure — the scenario cards, active risk, any future Portfolio family — had
 * to rewrite the same four steps, and an audit found 22 of 27 aggregating query
 * sites had already drifted on step one. This is that closure, extracted, so
 * the next caller inherits the rule instead of re-deriving it.
 */

/** A `portfolio_holdings` row. Only the fields the derivation reads. */
export interface HoldingRow extends DatedHolding {
  portfolio_id?: string | null
  asset_id?: string | null
  shares?: number | string | null
  price?: number | string | null
  /** Either shape the existing queries produce. */
  assets?: { symbol?: string | null; company_name?: string | null; asset_type?: string | null } | null
  portfolios?: { id?: string | null; name?: string | null } | null
}

/**
 * The floor under a "% of the book" claim.
 *
 * A two-position portfolio makes every position look enormous, so the size that
 * would justify a card is an artifact of the list length rather than a fact
 * about the desk. Measured: Vision Fund 10K's latest snapshot holds 2 positions
 * against 29 distinct assets across all of its dates.
 *
 * Lifted from `usePortfolioLenses`, which is where this rule was written and
 * where the number came from.
 */
export const MIN_POSITIONS_FOR_WEIGHT = 5

/**
 * One asset, one book, as of that book's latest snapshot.
 *
 * Produced only for positions that are actually held. Absence IS the not-held
 * answer — there is no `held: false` record, because a falsy record is what
 * gets rendered as "0.0%" by the next person to touch it.
 */
export interface PortfolioPositionContext {
  portfolioId: string
  portfolioName: string | null
  assetId: string
  symbol: string | null

  /** Always true. Present so a reader of the type does not have to infer it. */
  held: true

  shares: number | null
  price: number | null
  /** `shares × price`, or null when either half is missing. */
  marketValue: number | null

  /**
   * Share of the book, or null.
   *
   * ── Three states, and why two of them are not zero ──────────────────────
   *
   *   number  the weight is measured and the book can support the claim
   *   null    the position is real and its share is NOT knowable
   *   absent  (no context at all) the asset is not in this book
   *
   * Null happens for two different honest reasons — the row has no shares or
   * no price, or the book has too few positions for a percentage to mean
   * anything — and `weightIsMeaningful` plus `positionCount` say which. What it
   * never means is zero. `materialityBand` already treats null-and-held as its
   * own band rather than as the bottom one, for exactly this reason.
   */
  weightPct: number | null
  /** Whether this book can support a precise share claim at all. */
  weightIsMeaningful: boolean
  /** Current positions in this book. The reason `weightIsMeaningful` is false. */
  positionCount: number

  /**
   * The date of the snapshot this came from. ISO, or null.
   *
   * Never `Date.now()`. A card that shows a book number must be able to say
   * when the book was true, and stamping it with the current time rendered as
   * "book Aug 18" on weights from an April snapshot.
   */
  asOf: string | null

  /**
   * Cash and cash equivalents.
   *
   * Kept, not dropped. Cash is real capital and belongs in the denominator —
   * excluding it would inflate every other weight in the book. What it is
   * excluded from is being the SUBJECT of a price-shaped claim, which is the
   * caller's decision and is why this is a flag rather than a filter. See
   * `isCashLine`, which is the one classifier; this does not add another.
   */
  isCash: boolean

  /**
   * The compound identity. `portfolioId:assetId`.
   *
   * Asset id alone is what Research dedupes on and it is right there — one
   * case, one asset. It is wrong here, and silently: two books with opposite
   * problems in the same name would collapse into whichever was ranked first.
   */
  key: string
}

/** A book's own current state, kept so callers do not recount it. */
export interface BookTotals {
  portfolioId: string
  portfolioName: string | null
  /** Σ(shares × price) over the latest snapshot, cash included. */
  totalValue: number
  positionCount: number
  asOf: string | null
  weightIsMeaningful: boolean
}

export interface CurrentBook {
  /** Every held (portfolio, asset) pair, in no particular order. */
  positions: PortfolioPositionContext[]
  /** By `key`, for a direct lookup. */
  byKey: Map<string, PortfolioPositionContext>
  /** By asset, because most callers arrive holding an asset id. */
  byAsset: Map<string, PortfolioPositionContext[]>
  byPortfolio: Map<string, BookTotals>
  /** The newest snapshot date seen anywhere in the set. ISO, or null. */
  asOf: string | null
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * The identity a capital-oriented signal dedupes on.
 *
 * Three parts, deliberately: the same book and asset can carry more than one
 * kind of capital problem — the price has left the framework AND nobody wrote
 * the thesis — and those are different findings that a future precedence rule
 * has to be able to tell apart before it collapses them.
 */
export function portfolioIssueKey(
  portfolioId: string,
  assetId: string,
  issueType: string,
): string {
  return `${portfolioId}:${assetId}:${issueType}`
}

/**
 * Current book context for every held (portfolio, asset) pair in `rows`.
 *
 * `rows` must be the raw `portfolio_holdings` result — every date. The date
 * rule is applied here rather than trusted from the caller, because trusting
 * the caller is what produced 22 of 27 drifted query sites.
 */
export function currentBook(rows: readonly HoldingRow[]): CurrentBook {
  const empty: CurrentBook = {
    positions: [], byKey: new Map(), byAsset: new Map(), byPortfolio: new Map(), asOf: null,
  }
  if (!rows.length) return empty

  // Step one, and the one that has been got wrong repeatedly: only the latest
  // snapshot per portfolio is the current book. Summing across dates treats N
  // snapshots of one position as N positions — measured at 36x inflation on
  // Tech & Consumer Growth and 27x on Vision Fund 10K.
  const current = latestSnapshotRows(rows)
  if (!current.length) return empty

  const value = (h: HoldingRow): number | null => {
    const s = num(h.shares)
    const p = num(h.price)
    if (s == null || p == null) return null
    return s * p
  }

  /**
   * One row per (portfolio, asset).
   *
   * The date filter has already removed the other snapshots; this guards a
   * book listing one name twice on the same date, which would otherwise count
   * the position twice in its own denominator.
   */
  const deduped = new Map<string, HoldingRow>()
  for (const h of current) {
    const portfolioId = h.portfolio_id ?? h.portfolios?.id ?? null
    if (!portfolioId || !h.asset_id) continue
    const key = `${portfolioId}:${h.asset_id}`
    if (!deduped.has(key)) deduped.set(key, h)
  }

  const byPortfolio = new Map<string, BookTotals>()
  for (const h of deduped.values()) {
    const portfolioId = (h.portfolio_id ?? h.portfolios?.id) as string
    const existing = byPortfolio.get(portfolioId) ?? {
      portfolioId,
      portfolioName: h.portfolios?.name ?? null,
      totalValue: 0,
      positionCount: 0,
      asOf: h.date ?? null,
      weightIsMeaningful: false,
    }
    // Cash counts toward the denominator. It is capital the book is holding,
    // and leaving it out would overstate every other position's share.
    existing.totalValue += value(h) ?? 0
    existing.positionCount += 1
    if (!existing.portfolioName && h.portfolios?.name) existing.portfolioName = h.portfolios.name
    if ((h.date ?? '') > (existing.asOf ?? '')) existing.asOf = h.date ?? existing.asOf
    byPortfolio.set(portfolioId, existing)
  }
  for (const book of byPortfolio.values()) {
    book.weightIsMeaningful = book.positionCount >= MIN_POSITIONS_FOR_WEIGHT
      && book.totalValue > 0
  }

  const positions: PortfolioPositionContext[] = []
  for (const h of deduped.values()) {
    const portfolioId = (h.portfolio_id ?? h.portfolios?.id) as string
    const assetId = h.asset_id as string
    const book = byPortfolio.get(portfolioId)!
    const mv = value(h)
    const symbol = h.assets?.symbol ?? null

    positions.push({
      portfolioId,
      portfolioName: book.portfolioName,
      assetId,
      symbol,
      held: true,
      shares: num(h.shares),
      price: num(h.price),
      marketValue: mv,
      // Null unless BOTH the position is measurable and the book can carry the
      // claim. A number here is a number a card may print.
      weightPct: book.weightIsMeaningful && mv != null && book.totalValue > 0
        ? (mv / book.totalValue) * 100
        : null,
      weightIsMeaningful: book.weightIsMeaningful,
      positionCount: book.positionCount,
      asOf: book.asOf,
      isCash: isCashLine(symbol, h.assets?.asset_type),
      key: `${portfolioId}:${assetId}`,
    })
  }

  const byKey = new Map(positions.map(p => [p.key, p]))
  const byAsset = new Map<string, PortfolioPositionContext[]>()
  for (const p of positions) {
    const list = byAsset.get(p.assetId) ?? []
    list.push(p)
    byAsset.set(p.assetId, list)
  }
  // Heaviest first within an asset, so a caller taking `[0]` gets the book the
  // position matters most in rather than whichever row arrived first.
  for (const list of byAsset.values()) {
    list.sort((a, b) => (b.weightPct ?? -1) - (a.weightPct ?? -1))
  }

  const dates = positions.map(p => p.asOf).filter(Boolean) as string[]
  const asOf = dates.length ? dates.sort()[dates.length - 1] : null

  return { positions, byKey, byAsset, byPortfolio, asOf }
}

/**
 * The book a capital claim about this asset should name.
 *
 * The heaviest measurable one, else the first held one. Never a sum across
 * books: a name at 8% of one book and 3% of another is not an 11% position in
 * anything, and there is no portfolio that number describes.
 */
export function primaryBookFor(
  book: CurrentBook,
  assetId: string,
): PortfolioPositionContext | null {
  const list = book.byAsset.get(assetId)
  return list?.length ? list[0] : null
}
