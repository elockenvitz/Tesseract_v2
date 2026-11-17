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

/** A bar size that must be built rather than requested. */
export type ResampleTarget = '15m' | '30m' | '1wk' | '1mo'

/** A bar size EODHD actually publishes. */
export type ResampleBase = '5m' | '1d'

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
  '15m': { base: '5m', target: '15m', baseBarsPerTarget: 3 },
  '1wk': { base: '1d', target: '1wk', baseBarsPerTarget: 5 },
  '30m': { base: '5m', target: '30m', baseBarsPerTarget: 6 },
  '1mo': { base: '1d', target: '1mo', baseBarsPerTarget: 21 },
}

/**
 * The plan for an interval, or null when the provider can serve it directly.
 *
 * Returning null is the common case and means "ask for it as asked".
 */
export function resamplePlanFor(interval: string): ResamplePlan | null {
  return PLANS[interval as ResampleTarget] ?? null
}

/** Seconds per bucket, for the clock-aligned intraday targets. */
const INTRADAY_BUCKET_SECONDS: Partial<Record<ResampleTarget, number>> = {
  '15m': 15 * 60,
  '30m': 30 * 60,
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
  return target === '1wk' ? weekStartKey(candle.time) : monthStartKey(candle.time)
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
