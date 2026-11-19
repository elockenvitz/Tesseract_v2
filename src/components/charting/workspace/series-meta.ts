/**
 * What the chart knows about the series it just drew, stated for a reader.
 *
 * ── Why a chart needs this at all ─────────────────────────────────────────
 *
 * Opening Charting showed a symbol, a company name and a line. No last
 * price. No change. No interval. No provider. No indication of how old the
 * last bar was, or on what basis the prices were computed. A reader could
 * not tell a live series from a three-day-old cached one, and the two look
 * identical.
 *
 * ── The adjustment basis, which is not a detail ───────────────────────────
 *
 * A raw series draws a stock split as a price collapse. AAPL's 7:1 in 2014
 * and 4:1 in 2020 appear as falls from about 650 to 93 and from about 410 to
 * 103, and an analyst who draws a trend line across either is measuring a
 * fiction.
 *
 * The basis therefore travels WITH the series, measured from the provider's
 * own corporate actions by `lib/market-data/price-adjustment.ts` and set in
 * `lib/chartData.ts`. This module does not decide it; it states it, beside
 * the prices, and warns when the basis is one that can mislead.
 *
 * An earlier version of this file decided the basis from a table keyed by
 * provider name, and that table was wrong: it declared Yahoo `raw` when
 * Yahoo's chart series is in fact split-adjusted, so the header warned every
 * reader about a hazard that was not there while saying nothing useful about
 * the feed that does have it. A name is a guess. The series is the evidence.
 */

/** What a provider did to the bars before it sent them. */
export type Adjustment = 'raw' | 'split_adjusted' | 'split_and_dividend_adjusted' | 'unknown'

export interface SeriesMeta {
  /**
   * The instrument these numbers describe.
   *
   * Carried so the reader of this struct can check it against the symbol it
   * is about to print beside. The alternative -- clearing the meta on every
   * symbol change -- depends on the clear winning a race against the fetch,
   * and losing that race puts one instrument's last price next to another
   * instrument's name, which is the single worst thing this header could do.
   */
  symbol: string
  /** The last close in the window, or null for an empty series. */
  last: number | null
  /** The close before it, so a change can be computed honestly. */
  previous: number | null
  /** Unix seconds of the last bar. */
  lastBarTime: number | null
  /** How many bars were drawn. */
  bars: number
  /** The bar size, as the provider was asked for it. */
  interval: string
  /** Which feed answered. */
  provider: string
  adjustment: Adjustment
  /**
   * What the basis conclusion rests on, in one phrase.
   *
   * Carried so a reader who wants to know WHY the chart claims to be
   * split-adjusted can be shown the measurement instead of being asked to
   * trust the badge. Never rendered as a price.
   */
  adjustmentEvidence?: string
  /** How many corporate actions fall inside the drawn window. */
  splits?: number
}

export interface ChangeReading {
  absolute: number
  percent: number
  direction: 'up' | 'down' | 'flat'
}

/**
 * The move from the previous close to the last.
 *
 * Null rather than zero when it cannot be computed. A chart with one bar has
 * no change to report, and printing `0.00 (0.00%)` would state that the
 * price did not move, which is a different claim from "there is nothing to
 * compare it to".
 */
export function readChange(meta: SeriesMeta): ChangeReading | null {
  const { last, previous } = meta
  if (last == null || previous == null) return null
  if (!Number.isFinite(last) || !Number.isFinite(previous) || previous === 0) return null
  const absolute = last - previous
  return {
    absolute,
    percent: (absolute / Math.abs(previous)) * 100,
    direction: absolute > 0 ? 'up' : absolute < 0 ? 'down' : 'flat',
  }
}

/**
 * How old the last bar is, in words.
 *
 * Deliberately coarse. A cache can be minutes or days behind, and the
 * difference a reader needs is "this is now" against "this is not now" --
 * not a figure precise enough to be mistaken for a timestamp.
 */
export function freshnessLabel(lastBarTime: number | null, now: number = Date.now()): string {
  if (lastBarTime == null || !Number.isFinite(lastBarTime)) return 'no data'
  const ageSeconds = Math.max(0, now / 1000 - lastBarTime)
  if (ageSeconds < 120) return 'just now'
  if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)}m ago`
  if (ageSeconds < 86_400) return `${Math.floor(ageSeconds / 3600)}h ago`
  const days = Math.floor(ageSeconds / 86_400)
  return days === 1 ? '1 day ago' : `${days} days ago`
}

/**
 * How the basis should be stated beside the prices.
 *
 * `raw` gets the longest label of the four on purpose: it is the one that
 * can mislead, and the reader has to be able to see it without hovering.
 */
export function adjustmentLabel(adjustment: Adjustment): string {
  switch (adjustment) {
    case 'raw': return 'raw prices · not split-adjusted'
    case 'split_adjusted': return 'split-adjusted'
    case 'split_and_dividend_adjusted': return 'split and dividend adjusted'
    default: return 'adjustment unknown'
  }
}

/** Whether the basis is one a reader should be warned about rather than
    merely informed of. */
export function adjustmentIsHazardous(adjustment: Adjustment): boolean {
  return adjustment === 'raw' || adjustment === 'unknown'
}

/*
 * `adjustmentForProvider` was here, and it is deliberately gone.
 *
 * It mapped a provider's NAME to an adjustment basis, and it got Yahoo
 * wrong -- returning 'raw' for a series that is split-adjusted, which put a
 * hazard warning on the one feed that does not have the hazard. The basis
 * now arrives on the series, measured from the provider's published
 * corporate actions. See `lib/market-data/price-adjustment.ts`
 * (`detectSplitBasis`) and `lib/chartData.ts` (`normaliseYahooSeries`).
 *
 * Nothing should reintroduce a provider-to-basis table. If a feed's basis
 * cannot be measured, `unknown` is the honest answer and it is flagged to
 * the reader exactly as `raw` is.
 */
