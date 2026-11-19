/**
 * Corporate-action adjustment for a price series.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * On the ALL view, AAPL fell from about 650 to about 93 in June 2014 and from
 * about 410 to about 103 in August 2020. Neither happened. They are the 7:1
 * and the 4:1 split, drawn as price collapses, on a chart an analyst is
 * expected to read a trend off.
 *
 * ── The one rule ─────────────────────────────────────────────────────────
 *
 * Every figure in a bar is adjusted by the SAME factor, or none of them is.
 *
 * The tempting shortcut is to put a provider's adjusted close in the `close`
 * field and leave the open, high and low as published. That does not produce
 * an adjusted series; it produces a series of candles whose bodies and wicks
 * are arithmetic nonsense -- a 7:1 split would give every pre-split bar a
 * close at one seventh of its own low. Worse, a provider's "adjusted close"
 * is normally adjusted for DIVIDENDS as well as splits, so the shortcut
 * mixes two different adjustments into one candle.
 *
 * So the factors come from the corporate actions themselves, and they are
 * applied to open, high, low and close together.
 *
 * ── Where the factors come from ──────────────────────────────────────────
 *
 * Yahoo's chart response carries `events.splits` -- the real ratios, as
 * published, because `yahoo-chart-proxy` already requests
 * `events=div|split`. Nothing here infers a factor from a price jump. A
 * ratio this module did not read from a provider does not exist, which is
 * also why there is no dividend adjustment in here: the factor for a
 * dividend depends on the price it was paid against, and reconstructing one
 * from a close is exactly the fabrication this product cannot afford.
 */

/** What was done to the bars. Mirrors `contracts.ts` `barAdjustment`. */
export type PriceBasis = 'raw' | 'split_adjusted' | 'split_and_dividend_adjusted' | 'unknown'

/** A share split, as a provider published it. */
export interface SplitEvent {
  /** The ex-date, `YYYY-MM-DD` in UTC. The first session quoted post-split. */
  date: string
  /** New shares per old share. A 7:1 split is 7; a 1:10 reverse split is 0.1. */
  factor: number
  /** The ratio as published, for display. */
  ratio: string
}

/** The least a bar needs for this module to adjust it. */
export interface AdjustableBar {
  /** `YYYY-MM-DD`, or unix seconds as a string. Both appear in `CandlestickData`. */
  time: string
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

/**
 * The UTC calendar date a bar belongs to.
 *
 * `CandlestickData.time` is a `YYYY-MM-DD` string for daily and coarser bars
 * and unix seconds for intraday ones, so both are handled. UTC on purpose:
 * the daily form IS a UTC calendar date, and reading it in the host's zone
 * moves it a day west of Greenwich -- the defect already fixed once in
 * `lib/charting/bar-format.ts`.
 */
export function barDate(time: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}/.test(time)) return time.slice(0, 10)
  const seconds = Number(time)
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

/**
 * Split events out of a Yahoo chart payload.
 *
 * Yahoo keys each split by a bucket timestamp and carries the event's own
 * instant in `date`. The two differ -- on a monthly series the key is the
 * start of the month and `date` is the session the split took effect -- so
 * `date` is what is read. Using the key would adjust a whole month of
 * pre-split sessions onto the wrong side of the boundary.
 *
 * A row whose ratio is unusable is dropped rather than defaulted to 1. A
 * factor of 1 is a claim that a split had no effect, and silently adjusting
 * nothing is how a chart ends up stating a collapse that did not happen.
 */
export function parseYahooSplits(payload: unknown): SplitEvent[] {
  const events = (payload as { chart?: { result?: Array<{ events?: { splits?: unknown } }> } })
    ?.chart?.result?.[0]?.events?.splits
  if (!events || typeof events !== 'object') return []

  const out: SplitEvent[] = []
  for (const raw of Object.values(events as Record<string, unknown>)) {
    const row = raw as { date?: unknown; numerator?: unknown; denominator?: unknown; splitRatio?: unknown }
    const seconds = Number(row?.date)
    const numerator = Number(row?.numerator)
    const denominator = Number(row?.denominator)
    if (!Number.isFinite(seconds) || seconds <= 0) continue
    if (!Number.isFinite(numerator) || numerator <= 0) continue
    if (!Number.isFinite(denominator) || denominator <= 0) continue

    const factor = numerator / denominator
    // A factor of exactly 1 is not a split. Keeping it would add a no-op
    // boundary that the basis detector below would then try to measure.
    if (!Number.isFinite(factor) || factor <= 0 || factor === 1) continue

    out.push({
      date: new Date(seconds * 1000).toISOString().slice(0, 10),
      factor,
      ratio: typeof row?.splitRatio === 'string' && row.splitRatio
        ? row.splitRatio
        : `${numerator}:${denominator}`,
    })
  }

  out.sort((a, b) => a.date.localeCompare(b.date))
  return out
}

/**
 * The factor a bar on `date` must be divided by to be stated in today's
 * shares.
 *
 * Every split whose ex-date is STRICTLY AFTER the bar's own date. Strictly,
 * because the ex-date's own session is already quoted post-split: including
 * it would divide the first post-split bar a second time and plant a new
 * cliff one day after the one being removed.
 */
export function cumulativeSplitFactor(splits: readonly SplitEvent[], date: string): number {
  let factor = 1
  for (const split of splits) {
    if (split.date > date) factor *= split.factor
  }
  return factor
}

/**
 * The series restated in today's shares.
 *
 * Open, high, low and close are all divided by the same factor, so the
 * candle keeps its shape and `low <= close <= high` survives. Volume is
 * MULTIPLIED: a 7:1 split turns one old share into seven, so a pre-split day
 * on which a million old shares changed hands is seven million in today's
 * terms, and leaving volume alone would draw a 7x collapse in the volume
 * pane right where the price cliff used to be.
 *
 * Bars are returned in the same order, and a series with no splits in it is
 * returned with its own objects untouched.
 */
export function applySplitAdjustment<T extends AdjustableBar>(
  bars: readonly T[],
  splits: readonly SplitEvent[],
): T[] {
  if (splits.length === 0) return bars.slice()

  return bars.map(bar => {
    const date = barDate(bar.time)
    const factor = date === null ? 1 : cumulativeSplitFactor(splits, date)
    if (factor === 1) return bar

    return {
      ...bar,
      open: bar.open / factor,
      high: bar.high / factor,
      low: bar.low / factor,
      close: bar.close / factor,
      ...(bar.volume === undefined ? {} : { volume: bar.volume * factor }),
    }
  })
}

/** What a basis measurement concluded, and what it measured. */
export interface BasisReading {
  basis: PriceBasis
  /**
   * Why, in one phrase, for a log or a tooltip. Never shown as a price.
   */
  evidence: string
  /** The split the reading was taken across, when there was one. */
  across?: SplitEvent
}

/**
 * The smallest split this will take a reading from.
 *
 * A single session can move 10% on its own, so a ratio near 1.2 is not
 * separable from an ordinary gap. 1.25 keeps the two hypotheses -- "the
 * series stepped by the split factor" and "the series did not step" -- far
 * enough apart that a real day's move cannot flip the answer. Every split
 * this product has had to draw (2:1, 4:1, 7:1) clears it comfortably.
 */
const MIN_MEASURABLE_FACTOR = 1.25

/**
 * Whether a delivered series is already split-adjusted, measured rather than
 * assumed.
 *
 * ── Why this is measured ─────────────────────────────────────────────────
 *
 * The basis used to come from a table keyed by provider name. That table was
 * WRONG for Yahoo: it declared `raw`, and the header therefore told every
 * reader "raw prices · not split-adjusted" above a series that is in fact
 * adjusted. Measured on 2026-11-18 against the live payload, AAPL's daily
 * closes run 23.06 on 2014-06-06 to 23.42 on 2014-06-09, straight through a
 * 7:1 split -- continuous, so adjusted.
 *
 * A hard-coded table also cannot notice the day a provider changes what it
 * sends. This can, because it reads the series it is describing.
 *
 * ── How ──────────────────────────────────────────────────────────────────
 *
 * Take the bar before the ex-date and the first bar on or after it. If the
 * series is raw, their closes differ by the split factor. If it is adjusted,
 * they differ by an ordinary day's move. The two are compared on equal
 * footing -- whichever hypothesis is closer wins -- so neither is the
 * default.
 *
 * It answers `unknown` whenever it cannot see a boundary to measure: no
 * splits, none inside the window, or no bar on one side. `unknown` is
 * flagged to the reader exactly as `raw` is, so an unmeasurable series is
 * never quietly presented as a safe one.
 */
export function detectSplitBasis(
  bars: readonly AdjustableBar[],
  splits: readonly SplitEvent[],
): BasisReading {
  if (splits.length === 0) {
    return { basis: 'unknown', evidence: 'no split in this window to measure across' }
  }

  // The largest split in the window gives the cleanest separation.
  const candidates = splits
    .filter(s => s.factor >= MIN_MEASURABLE_FACTOR)
    .sort((a, b) => b.factor - a.factor)
  if (candidates.length === 0) {
    return { basis: 'unknown', evidence: 'no split large enough to measure across' }
  }

  for (const split of candidates) {
    let before: AdjustableBar | null = null
    let onOrAfter: AdjustableBar | null = null

    for (const bar of bars) {
      const date = barDate(bar.time)
      if (date === null || !Number.isFinite(bar.close) || bar.close <= 0) continue
      if (date < split.date) {
        // The latest bar before the boundary.
        if (before === null || date > (barDate(before.time) ?? '')) before = bar
      } else if (onOrAfter === null || date < (barDate(onOrAfter.time) ?? '9999')) {
        onOrAfter = bar
      }
    }

    if (!before || !onOrAfter) continue

    const step = before.close / onOrAfter.close
    const asRaw = Math.abs(step / split.factor - 1)
    const asAdjusted = Math.abs(step - 1)

    return {
      basis: asRaw < asAdjusted ? 'raw' : 'split_adjusted',
      evidence:
        `closes step ${step.toFixed(2)}x across the ${split.ratio} on ${split.date}` +
        ` (${split.factor.toFixed(2)}x would be unadjusted)`,
      across: split,
    }
  }

  return { basis: 'unknown', evidence: 'the window does not straddle a split' }
}
