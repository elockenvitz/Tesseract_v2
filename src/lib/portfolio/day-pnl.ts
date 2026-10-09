/**
 * Summing a day's P&L over holdings we may not be able to price.
 *
 * ── Why this is a function and not two reduces ────────────────────────────
 *
 * It was two reduces — `PositionsTab` and `OverviewTab` each wrote
 * `rows.reduce((s, r) => s + (q?.change ?? 0) * shares, 0)`. That could not
 * fail and could not be right: a holding whose quote carried no previous
 * close contributed a confident 0, so a book with no usable quotes reported
 * a session P&L of exactly $0.00 and both tabs presented it as the day's
 * result. A fabricated aggregate is worse than a blank one, because a blank
 * one is obviously missing.
 *
 * The rule is small enough to inline and important enough not to, for three
 * reasons: it is the arithmetic behind an investor-facing number, it has to
 * be identical on both tabs or they contradict each other, and inlined it
 * cannot be tested without mounting either tab.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 *
 * Sum what is priced. Count what is not. Report no total at all when nothing
 * is priced — `0` is a legitimate total only when something was actually
 * measured and it came to zero.
 *
 * ── Why the market value travels with the P&L ─────────────────────────────
 *
 * Because the percentage has to agree with the figure above it. The first
 * version summed only priced holdings and then divided by the WHOLE book's
 * NAV, which is a subset over a superset: a $3,000 gain on $100k of priced
 * holdings read as +2.68% rather than +3.09% because $15k of unpriced
 * holdings sat in the denominator contributing nothing to the numerator.
 * Quietly understating a return is the same class of error as inventing a
 * zero — the figure looks measured and is not. So the priced market value is
 * accumulated in the same pass as the P&L and is the only denominator
 * `dayReturnPct` will accept.
 */

export interface DayPnlEntry {
  /** This holding's P&L for the day, or null where it could not be computed. */
  pnl: number | null | undefined
  /** Its current market value. Used only to build the return's denominator. */
  marketValue?: number | null
}

export interface DayPnlTotal {
  /** The sum over priced holdings, or null when none could be priced. */
  total: number | null
  /** How many holdings had no usable day change. The total excludes them. */
  unpricedCount: number
  /** How many contributed to the total. */
  pricedCount: number
  /**
   * Closing market value of the priced holdings ONLY.
   *
   * The denominator `dayReturnPct` needs, so the percentage covers exactly
   * the holdings the P&L covers. Unpriced holdings are absent from both.
   */
  pricedMarketValue: number
}

/**
 * @param entries one per holding.
 *
 * A genuine 0 (cash, or a stock that truly closed flat) is a value and is
 * counted as priced. Only null means "we could not say".
 */
export function sumDayPnl(entries: Iterable<DayPnlEntry>): DayPnlTotal {
  let total = 0
  let priced = 0
  let unpriced = 0
  let pricedMarketValue = 0
  for (const e of entries) {
    const v = e?.pnl
    if (v == null || !Number.isFinite(v)) { unpriced++; continue }
    total += v
    priced++
    const mv = e.marketValue
    if (mv != null && Number.isFinite(mv)) pricedMarketValue += mv
  }
  return {
    total: priced > 0 ? total : null,
    unpricedCount: unpriced,
    pricedCount: priced,
    pricedMarketValue,
  }
}

/**
 * The day's return against the NAV the PRICED holdings started from.
 *
 * `pricedClosingNav` must be `pricedMarketValue` from the same `sumDayPnl`
 * call that produced `total` — pass the whole book's NAV and the percentage
 * silently understates itself by the share of the book that is unpriced.
 *
 * Null in, null out — a return on a total nobody could compute is not a
 * number. Also null when the derived opening NAV is not positive, which
 * would otherwise divide a real P&L by zero or by a negative.
 */
export function dayReturnPct(total: number | null, pricedClosingNav: number): number | null {
  if (total == null) return null
  const openingNav = pricedClosingNav - total
  if (!(openingNav > 0)) return null
  return (total / openingNav) * 100
}
