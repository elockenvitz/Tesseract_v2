/**
 * Bar sizes a provider does not publish, built from ones it does.
 *
 * ── The defect this closes ────────────────────────────────────────────────
 *
 * EODHD publishes `1m`, `5m`, `1h` and `1d`. The Charting page offers fifteen
 * frequency options, and seven of them ask for `15m`, `30m`, `1wk` or `1mo`.
 * Routing the entitled account to EODHD therefore broke those seven — Weekly,
 * Monthly, Quarterly, Yearly, 10 Min, 15 Min and 30 Min — along with four of
 * the ten `timeframeToParams` presets (`1W`, `5Y`, `10Y`, `ALL`). They had
 * worked on Yahoo, which does publish those sizes.
 *
 * ── Why aggregating is not fabricating ───────────────────────────────────
 *
 * A weekly bar IS its daily bars combined: the week's open is Monday's open,
 * its high is the highest day's high, its low the lowest day's low, its close
 * Friday's close, its volume the sum. Nothing is invented, interpolated or
 * carried forward, and no bar is emitted for a bucket with no data in it. The
 * provenance is unchanged — every figure still traces to an EODHD daily bar —
 * so the delivery badge beside the chart stays truthful.
 *
 * That is a different act from the one the adapter refuses. Drawing a 5m
 * series and *labelling* it 15m would misstate the bar width; drawing the
 * same request from a different provider would silently change the feed.
 * Combining real bars into the size that was asked for does neither.
 *
 * ── Why buckets are aligned to the clock, not to the first bar ───────────
 *
 * Bucketing from whichever bar happens to be first makes the output depend on
 * the window requested: pan the chart by one bar and every boundary moves, so
 * the same instant belongs to a different candle than it did a moment ago.
 * Aligning to absolute time instead means a given instant always lands in the
 * same bucket, and the bars are stable across windows, ranges and refetches.
 */
import type { Candle } from './eodhd-series'

/**
 * A bar size that must be built rather than requested.
 *
 * ── The six added after the first four ───────────────────────────────────
 *
 * The first version of this module covered the sizes EODHD routing had
 * BROKEN. It left alone six Charting options that were wrong in a quieter
 * way: they had never asked for their own size at all.
 *
 *   '3 Min'     asked for 5m    // its comment read "Closest available"
 *   '10 Min'    asked for 15m   // its comment read "Closest available"
 *   '120 Min'   asked for 1h    // its comment read "Will aggregate"
 *   '240 Min'   asked for 1h    // its comment read "Will aggregate"
 *   'Quarterly' asked for 1mo   // its comment read "Will aggregate"
 *   'Yearly'    asked for 1mo   // its comment read "Will aggregate"
 *
 * The aggregation those comments promised was never written. Picking
 * "240 Min" drew HOURLY bars, and the frequency control went on reading
 * 240 Min. That is the one thing this module exists to prevent: a chart
 * whose bar width is not the width it claims. Where every surfaced figure
 * has to trace to its source, a mislabelled bar size is a provenance
 * failure rather than a cosmetic one -- a reader measuring a move against
 * the wrong bar width draws the wrong conclusion with nothing on screen to
 * show why.
 *
 * All six are exact multiples of a published size, so all six are now built
 * rather than substituted. 'Tick' is the one that cannot be: EODHD
 * publishes no tick stream, and a 1m bar is not a tick at any multiple, so
 * that option is removed from the page instead of being quietly served
 * minute bars.
 */
export type ResampleTarget =
  | '3m'
  | '10m'
  | '15m'
  | '30m'
  | '2h'
  | '4h'
  | '1wk'
  | '1mo'
  | '1q'
  | '1y'

/** A bar size EODHD actually publishes. */
export type ResampleBase = '1m' | '5m' | '1h' | '1d'

export interface ResamplePlan {
  /** The interval to ask the provider for. */
  base: ResampleBase
  /** The interval to build from it. */
  target: ResampleTarget
  /**
   * Roughly how many base bars make one target bar. Used only to size the
   * fetch window, never to pad a bucket that came back short.
   */
  baseBarsPerTarget: number
}

const PLANS: Record<ResampleTarget, ResamplePlan> = {
  /*
   * Each base is the LARGEST published size that divides the target exactly.
   * 10m is built from 5m rather than 1m because two bars cost a tenth of the
   * rows of ten, and both give the identical bar: the high of two 5m highs is
   * the high of the ten 1m highs they were themselves built from.
   */
  '3m': { base: '1m', target: '3m', baseBarsPerTarget: 3 },
  '10m': { base: '5m', target: '10m', baseBarsPerTarget: 2 },
  '15m': { base: '5m', target: '15m', baseBarsPerTarget: 3 },
  '30m': { base: '5m', target: '30m', baseBarsPerTarget: 6 },
  '2h': { base: '1h', target: '2h', baseBarsPerTarget: 2 },
  '4h': { base: '1h', target: '4h', baseBarsPerTarget: 4 },
  '1wk': { base: '1d', target: '1wk', baseBarsPerTarget: 5 },
  '1mo': { base: '1d', target: '1mo', baseBarsPerTarget: 21 },
  /*
   * A quarter and a year are built from DAILY bars, not from monthly ones.
   *
   * 1mo is itself a resampled size here, and resampling a resampling would
   * mean the quarter inherited whatever the month's bucketing decided. Going
   * straight to the daily bars keeps one aggregation step between the
   * provider's figures and the drawn candle, which is what makes the
   * provenance statement "every figure is an EODHD daily bar" literally true.
   */
  '1q': { base: '1d', target: '1q', baseBarsPerTarget: 63 },
  '1y': { base: '1d', target: '1y', baseBarsPerTarget: 252 },
}

/**
 * The plan for an interval, or null when the provider can serve it directly.
 *
 * Returning null is the common case and means "ask for it as asked".
 */
export function resamplePlanFor(interval: string): ResamplePlan | null {
  return PLANS[interval as ResampleTarget] ?? null
}

/**
 * Seconds per bucket, for the clock-aligned intraday targets.
 *
 * 2h and 4h align to the UTC clock like the rest, so a 4h bucket starts at
 * 00:00, 04:00, 08:00 and so on. That does not line up with any one market's
 * session open, and it is still the right choice for the reason given at the
 * top of this file: an alignment derived from the session would depend on
 * which exchange the symbol trades on, and an alignment derived from the
 * first bar in the window would move every boundary when the chart is panned.
 * A stable bucket that a reader can reason about beats a flattering one.
 */
const INTRADAY_BUCKET_SECONDS: Partial<Record<ResampleTarget, number>> = {
  '3m': 3 * 60,
  '10m': 10 * 60,
  '15m': 15 * 60,
  '30m': 30 * 60,
  '2h': 2 * 60 * 60,
  '4h': 4 * 60 * 60,
}

/**
 * Whether a candle's `time` is an intraday instant rather than a date.
 *
 * `toCandles` emits `YYYY-MM-DD` for daily bars and unix seconds for intraday
 * ones, and the output has to keep whichever convention the target implies.
 */
function isInstant(time: string): boolean {
  return /^-?\d+$/.test(time)
}

/** A candle's position on the timeline, in seconds, for sorting and bucketing. */
function secondsOf(time: string): number {
  if (isInstant(time)) return Number(time)
  const parsed = Date.parse(`${time}T00:00:00Z`)
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : Number.NaN
}

/** The UTC Monday of a date's week, as `YYYY-MM-DD`. */
function weekStartKey(time: string): string {
  const seconds = secondsOf(time)
  const date = new Date(seconds * 1000)
  // getUTCDay: 0 = Sunday. Shift so Monday is the first day of the week, and
  // Sunday closes the one before it rather than opening a new one.
  const dayFromMonday = (date.getUTCDay() + 6) % 7
  const monday = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() - dayFromMonday,
  ))
  return monday.toISOString().slice(0, 10)
}

/** The first of a date's month, as `YYYY-MM-DD`. */
function monthStartKey(time: string): string {
  // Sliced rather than parsed: a dated bar is already `YYYY-MM-DD`, and
  // re-deriving it through a Date risks a timezone shifting the month.
  if (!isInstant(time)) return `${time.slice(0, 7)}-01`
  const date = new Date(secondsOf(time) * 1000)
  return `${date.toISOString().slice(0, 7)}-01`
}

/** The first of a date's calendar quarter, as `YYYY-MM-DD`. */
function quarterStartKey(time: string): string {
  const ymd = isInstant(time)
    ? new Date(secondsOf(time) * 1000).toISOString().slice(0, 10)
    : time
  const month = Number(ymd.slice(5, 7))
  /* Calendar quarters, so Q1 opens in January -- not a fiscal year, which
     differs per company and would make one chart's quarters disagree with
     another's for no reason a reader could see. */
  const start = Math.floor((month - 1) / 3) * 3 + 1
  return `${ymd.slice(0, 4)}-${String(start).padStart(2, '0')}-01`
}

/** The first of a date's calendar year, as `YYYY-MM-DD`. */
function yearStartKey(time: string): string {
  const ymd = isInstant(time)
    ? new Date(secondsOf(time) * 1000).toISOString().slice(0, 10)
    : time
  return `${ymd.slice(0, 4)}-01-01`
}

/**
 * The bucket a candle belongs to: a key to group by, and the `time` the
 * resulting bar carries.
 */
function bucketOf(candle: Candle, target: ResampleTarget): string | null {
  const seconds = secondsOf(candle.time)
  if (!Number.isFinite(seconds)) return null

  const bucketSeconds = INTRADAY_BUCKET_SECONDS[target]
  if (bucketSeconds) {
    // Clock-aligned, so 09:30 opens a 15m and a 30m bucket alike and the
    // boundaries do not move when the window does.
    return String(Math.floor(seconds / bucketSeconds) * bucketSeconds)
  }
  /*
   * Switched on explicitly rather than falling through to a month.
   *
   * The previous shape was `target === '1wk' ? week : month`, which was
   * correct while those were the only two dated targets -- and would have
   * silently bucketed a quarter and a year BY MONTH the moment they were
   * added, producing twelve bars a year under a label reading Yearly. That
   * is the same class of defect this change exists to remove, so the
   * fall-through is gone.
   */
  switch (target) {
    case '1wk':
      return weekStartKey(candle.time)
    case '1mo':
      return monthStartKey(candle.time)
    case '1q':
      return quarterStartKey(candle.time)
    case '1y':
      return yearStartKey(candle.time)
    default:
      /* An intraday target with no entry in the seconds table. Dropping the
         bar is better than filing it under a size it does not belong to. */
      return null
  }
}

/**
 * Combine base bars into the requested size.
 *
 * Input need not be sorted; output is ascending by time. A bucket with no
 * bars produces no candle — a market holiday is an absent week, not a flat
 * one, and a zero-volume doji drawn across a closed market is a lie that
 * looks like data.
 */
export function resampleCandles(
  candles: readonly Candle[],
  target: ResampleTarget,
): Candle[] {
  if (candles.length === 0) return []

  const ordered = [...candles]
    .filter(c => Number.isFinite(secondsOf(c.time)))
    .sort((a, b) => secondsOf(a.time) - secondsOf(b.time))

  const buckets = new Map<string, Candle>()

  for (const candle of ordered) {
    const key = bucketOf(candle, target)
    if (key === null) continue

    const existing = buckets.get(key)
    if (!existing) {
      /*
       * The bucket's `time` is the bucket, not this bar's own timestamp.
       * Using the first bar's time would put a Tuesday stamp on a week whose
       * Monday was a holiday, and two windows would then disagree about when
       * the same week began.
       */
      buckets.set(key, {
        time: key,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume ?? 0,
      })
      continue
    }

    // Open stays the first bar's open; close follows the last. Ordering above
    // is what makes both true.
    existing.high = Math.max(existing.high, candle.high)
    existing.low = Math.min(existing.low, candle.low)
    existing.close = candle.close
    existing.volume = (existing.volume ?? 0) + (candle.volume ?? 0)
  }

  return [...buckets.values()].sort((a, b) => secondsOf(a.time) - secondsOf(b.time))
}
