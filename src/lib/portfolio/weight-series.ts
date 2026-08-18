/**
 * A portfolio's weight in one name, as a series rather than a number.
 *
 * ── The thing this exists to make true ────────────────────────────────────
 *
 * A book is not a list of positions, it is a list of positions AT A PRICE, and
 * both sides move. Shares change when somebody trades; weights change every
 * day the market opens, because the numerator and the denominator both reprice.
 * A product that only knows the weight on upload days cannot answer "was this
 * always a 6% position, or did it become one" — which is a different question
 * from "how big is it", and usually the more interesting one.
 *
 * ── Carrying SHARES forward is legitimate. Carrying PRICES forward is not ──
 *
 * This distinction is the whole design.
 *
 * A position persists until it is traded. If the last upload says 12,000
 * shares, then absent a later upload the book still holds 12,000 shares
 * tomorrow — that is a fact about the world, not an assumption.
 *
 * A price does no such thing. Yesterday's close is not today's price, and
 * marking an unpriced holding at its last known value while its neighbours
 * reprice does not merely make one number stale — it corrupts the DENOMINATOR,
 * so every other weight in the book comes out wrong in a direction nobody can
 * see. That is the `createPlaceholderQuote` defect with a portfolio attached:
 * the fabricated value is the freshest-looking thing in the calculation.
 *
 * So a day is priced or it is skipped. `minPricedPct` is the gate, the skipped
 * days are returned with their coverage rather than silently dropped, and the
 * caller is expected to show that number.
 *
 * ── What this produces against the database as it stands ──────────────────
 *
 * Very little, and that is the correct output rather than a bug. Measured
 * 2026-08-18: `price_history_cache` covers 5–7 of the 35–92 names each book
 * holds, so no date clears a 95% gate and the daily path yields nothing. The
 * snapshot path yields what genuinely exists — and exactly four books in the
 * database have more than one snapshot date, the best of them four.
 *
 * The gap is an ingestion gap: daily closes for every held name. Nothing in
 * this file can invent it, and the honest failure is an empty series with a
 * stated reason rather than a smooth line built from carried-forward marks.
 */

/** One holding row as uploaded: shares and the price they were marked at. */
export interface PositionRow {
  assetId: string
  date: string
  shares: number
  price: number
}

export interface DailyClose {
  /** ISO date. */
  date: string
  close: number
}

export type MarkSource = 'snapshot' | 'daily'

export interface WeightPoint {
  date: string
  /** The subject's weight in the book, percent. */
  weightPct: number
  /** The book's total value on that date. */
  totalValue: number
  /** Share of book value that was priced for this date, percent. */
  pricedPct: number
  /** Where the marks came from. Never mixed within a point. */
  marked: MarkSource
}

export interface SkippedDate {
  date: string
  pricedPct: number
  reason: 'insufficient_price_coverage' | 'partial_snapshot'
  /** For a partial snapshot: names present vs the book's usual count. */
  names?: number
  expectedNames?: number
}

export interface WeightSeries {
  points: WeightPoint[]
  /** Days that could not be priced well enough, with their coverage. */
  skipped: SkippedDate[]
  /** Distinct names in the book on the most recent snapshot. */
  bookNames: number
  /** How many of those have any daily closes at all. */
  pricedNames: number
}

export interface BuildOptions {
  /** Every holding row for the book, across every snapshot date. */
  rows: PositionRow[]
  /** The name the series is about. */
  subjectAssetId: string
  /**
   * Daily closes per asset. Supply to get a daily series; omit for the
   * snapshot-only series, which is all today's data supports.
   */
  closesByAsset?: Map<string, DailyClose[]>
  /**
   * Share of book value that must be priced before a day is emitted.
   *
   * 95, not 100: a book carrying a tiny unpriced residual — a cash line, a
   * delisted stub — should not lose its whole series to it, and a 5% error
   * band on the denominator is visible in the coverage figure the caller
   * renders. Below that the weight is not worth the pixels.
   */
  minPricedPct?: number
}

const DEFAULT_MIN_PRICED_PCT = 95

/** Latest snapshot date at or before `date`. Shares persist; prices do not. */
function sharesAsOf(
  byDate: Map<string, Map<string, number>>,
  sortedDates: string[],
  date: string,
): Map<string, number> | null {
  let found: string | null = null
  for (const d of sortedDates) {
    if (d <= date) found = d
    else break
  }
  return found ? byDate.get(found) ?? null : null
}

export function buildWeightSeries({
  rows, subjectAssetId, closesByAsset, minPricedPct = DEFAULT_MIN_PRICED_PCT,
}: BuildOptions): WeightSeries {
  const clean = rows.filter(r =>
    r.assetId && r.date &&
    Number.isFinite(r.shares) && Number.isFinite(r.price) && r.price > 0)

  // Shares per asset per snapshot date. Summed, because a book can hold one
  // name in two lots and they are one position.
  const sharesByDate = new Map<string, Map<string, number>>()
  const priceByDate = new Map<string, Map<string, number>>()
  for (const r of clean) {
    const s = sharesByDate.get(r.date) ?? new Map<string, number>()
    s.set(r.assetId, (s.get(r.assetId) ?? 0) + r.shares)
    sharesByDate.set(r.date, s)

    const p = priceByDate.get(r.date) ?? new Map<string, number>()
    p.set(r.assetId, r.price)
    priceByDate.set(r.date, p)
  }

  const allDates = [...sharesByDate.keys()].sort()

  /**
   * Drop partial uploads. They are not small books, they are fragments.
   *
   * Vision Fund 10K carries four snapshot dates and only two are the book:
   * 25 names, 26 names, then 1 name and 2 names. Those last two are corrections
   * or single-position uploads, and treating one as a snapshot makes its lone
   * holding 100% of the portfolio — a denominator collapse that produces a
   * confident, catastrophic weight rather than a visible error.
   *
   * 60% of the largest snapshot: generous enough to survive a genuine
   * concentration or a book that trimmed a dozen names, tight enough that a
   * one-line upload never becomes a data point.
   */
  const nameCounts = new Map(allDates.map(d => [d, sharesByDate.get(d)!.size]))
  const fullest = Math.max(...nameCounts.values(), 0)
  const partialSkips: SkippedDate[] = []
  const snapshotDates = allDates.filter(d => {
    const n = nameCounts.get(d) ?? 0
    if (fullest > 0 && n < fullest * 0.6) {
      partialSkips.push({ date: d, pricedPct: 100, reason: 'partial_snapshot', names: n, expectedNames: fullest })
      return false
    }
    return true
  })
  const lastShares = snapshotDates.length
    ? sharesByDate.get(snapshotDates[snapshotDates.length - 1])!
    : new Map<string, number>()

  const bookNames = lastShares.size
  const pricedNames = closesByAsset
    ? [...lastShares.keys()].filter(id => (closesByAsset.get(id)?.length ?? 0) > 0).length
    : 0

  // ── Snapshot series ──────────────────────────────────────────────────────
  // Every name in a snapshot carries its own upload price, so coverage is 100%
  // by construction and the weights are internally consistent. This is the
  // only series today's data actually supports.
  const points: WeightPoint[] = []
  for (const date of snapshotDates) {
    const shares = sharesByDate.get(date)!
    const prices = priceByDate.get(date)!
    let total = 0
    let subject = 0
    for (const [assetId, n] of shares) {
      const v = n * (prices.get(assetId) ?? 0)
      total += v
      if (assetId === subjectAssetId) subject = v
    }
    if (total <= 0) continue
    points.push({
      date,
      weightPct: (subject / total) * 100,
      totalValue: total,
      pricedPct: 100,
      marked: 'snapshot',
    })
  }

  if (!closesByAsset || closesByAsset.size === 0) {
    return { points, skipped: partialSkips, bookNames, pricedNames }
  }

  // ── Daily series ─────────────────────────────────────────────────────────
  // Every date any held name has a close for, from the first snapshot onward.
  // Shares come from the latest snapshot at or before that date.
  const closeLookup = new Map<string, Map<string, number>>()
  const tradingDates = new Set<string>()
  for (const [assetId, series] of closesByAsset) {
    for (const c of series) {
      if (!Number.isFinite(c.close) || c.close <= 0) continue
      tradingDates.add(c.date)
      const m = closeLookup.get(c.date) ?? new Map<string, number>()
      m.set(assetId, c.close)
      closeLookup.set(c.date, m)
    }
  }

  const firstSnapshot = snapshotDates[0]
  const daily: WeightPoint[] = []
  const skipped: SkippedDate[] = [...partialSkips]

  for (const date of [...tradingDates].sort()) {
    if (firstSnapshot && date < firstSnapshot) continue
    const shares = sharesAsOf(sharesByDate, snapshotDates, date)
    if (!shares) continue

    // The denominator needs a reference value for coverage. Value each name at
    // its close where there is one, and at its last SNAPSHOT price only to
    // measure what is missing — never to build the weight.
    const closes = closeLookup.get(date) ?? new Map<string, number>()
    const fallback = priceByDate.get(
      [...snapshotDates].reverse().find(d => d <= date) ?? snapshotDates[0],
    ) ?? new Map<string, number>()

    let priced = 0
    let unpriced = 0
    let subject = 0
    for (const [assetId, n] of shares) {
      const close = closes.get(assetId)
      if (close != null) {
        const v = n * close
        priced += v
        if (assetId === subjectAssetId) subject = v
      } else {
        unpriced += n * (fallback.get(assetId) ?? 0)
      }
    }

    const reference = priced + unpriced
    const pricedPct = reference > 0 ? (priced / reference) * 100 : 0

    if (pricedPct < minPricedPct) {
      skipped.push({ date, pricedPct, reason: 'insufficient_price_coverage' })
      continue
    }
    // The denominator is the PRICED book only. Adding a carried-forward
    // residual here is exactly the corruption this file exists to prevent.
    if (priced <= 0) continue
    daily.push({
      date,
      weightPct: (subject / priced) * 100,
      totalValue: priced,
      pricedPct,
      marked: 'daily',
    })
  }

  // Daily wins where it exists — it is the finer series and it is genuinely
  // marked. Snapshot points survive only on dates the daily path could not
  // reach, so the two are never averaged together.
  const dailyDates = new Set(daily.map(p => p.date))
  const merged = [...daily, ...points.filter(p => !dailyDates.has(p.date))]
    .sort((a, b) => a.date.localeCompare(b.date))

  return { points: merged, skipped, bookNames, pricedNames }
}
