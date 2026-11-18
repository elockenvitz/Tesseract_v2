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
 * `chartData.ts` maps Yahoo's `indicators.quote[0].close`, which is the RAW
 * close. It never reads `indicators.adjclose`. So the series is not adjusted
 * for splits, and on a long window that is not a nuance -- it is a chart
 * that states things that did not happen. AAPL on the ALL view falls from
 * about 650 to about 93 in 2014 and from about 410 to about 103 in 2020:
 * the 7:1 and the 4:1 split, drawn as two catastrophic declines. An analyst
 * who draws a trend line across either is measuring a fiction.
 *
 * Correcting the series is a market-data change -- the open, high and low
 * must be scaled by the same split factor as the close, and Yahoo's
 * `adjclose` adjusts for dividends too, so pairing it with a raw open would
 * corrupt every candle. That is its own piece of work.
 *
 * What this module does is refuse to let the surface stay silent about it.
 * A series whose basis is `raw` says so, and says it where the prices are.
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

/**
 * What the named feed's candle path actually returns, as of this change.
 *
 * Read from the two mapping sites rather than assumed:
 *
 *   yahoo   `lib/chartData.ts` maps `indicators.quote[0].close`. The
 *           response also carries `indicators.adjclose`, and nothing reads
 *           it. Raw.
 *   eodhd   `lib/market-data/eodhd-series.ts` `toCandles` maps `bar.close`.
 *           The `eod` endpoint also returns `adjusted_close`, and
 *           `eodhd-adapter.ts` already declares `barAdjustment: 'raw'` for
 *           exactly this reason. Raw.
 *
 * An unrecognised provider is 'unknown', NOT 'raw'. Guessing 'raw' for a
 * feed nobody has checked would put a specific, confident claim on screen
 * that no one verified -- and 'unknown' is flagged to the reader just the
 * same, so nothing is lost by being honest about not knowing.
 */
export function adjustmentForProvider(provider: string): Adjustment {
  switch (provider.toLowerCase()) {
    case 'yahoo':
    case 'eodhd':
      return 'raw'
    default:
      return 'unknown'
  }
}
