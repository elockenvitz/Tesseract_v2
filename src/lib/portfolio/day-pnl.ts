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
 */

export interface DayPnlTotal {
  /** The sum over priced holdings, or null when none could be priced. */
  total: number | null
  /** How many holdings had no usable day change. The total excludes them. */
  unpricedCount: number
  /** How many contributed to the total. */
  pricedCount: number
}

/**
 * @param values one per holding: a P&L figure, or null where unknown.
 *
 * A genuine 0 (cash, or a stock that truly closed flat) is a value and is
 * counted as priced. Only null means "we could not say".
 */
export function sumDayPnl(values: Iterable<number | null | undefined>): DayPnlTotal {
  let total = 0
  let priced = 0
  let unpriced = 0
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) { unpriced++; continue }
    total += v
    priced++
  }
  return {
    total: priced > 0 ? total : null,
    unpricedCount: unpriced,
    pricedCount: priced,
  }
}

/**
 * The day's return against the NAV it started from.
 *
 * Null in, null out — a return on a total nobody could compute is not a
 * number. Also null when the derived opening NAV is not positive, which
 * would otherwise divide a real P&L by zero or by a negative.
 */
export function dayReturnPct(total: number | null, closingNav: number): number | null {
  if (total == null) return null
  const openingNav = closingNav - total
  if (!(openingNav > 0)) return null
  return (total / openingNav) * 100
}
