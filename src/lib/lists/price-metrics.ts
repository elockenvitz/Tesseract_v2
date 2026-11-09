import type { PricePoint } from '../../components/signals/PriceContext'

/**
 * What a list row may say about a price series, and what it must refuse to say.
 *
 * ── Why this is pure and separate from the fetch ──────────────────────────
 *
 * Every figure the Market column shows — the 1-month move, the 6-month move,
 * the sparkline's shape, the as-of stamp — comes through here, so there is one
 * arithmetic and one set of refusals. The previous version of that column
 * computed its own 1-month change inline in a comparator and drew a sparkline
 * that auto-scaled to its own extremes, which is how a 2% drift and a 30%
 * drawdown came to look identical.
 *
 * ── The three refusals ────────────────────────────────────────────────────
 *
 * 1. NOT ENOUGH LOOKBACK. A "6M" return needs six months of series behind it.
 *    A name backfilled three weeks ago has closes, and dividing its first by
 *    its last produces a number — a number that is not a six-month return. It
 *    returns null instead, and the cell shows nothing.
 *
 * 2. A DISCONTINUITY. `price_history_cache` stores no split factor and no
 *    adjustment flag; the repo's own data-platform notes put it plainly —
 *    "two closes spanning a split are genuinely incomparable today". So a
 *    single-session move past `DISCONTINUITY` is treated as a break in the
 *    series rather than as a return, and any window spanning it is refused.
 *    This does NOT claim a split happened: a 40% gap is equally consistent
 *    with a collapse, and the point is only that the two ends cannot be
 *    compared. Callers surface it as "not comparable", never as "stale".
 *
 * 3. A CLOSE IS NOT A QUOTE. `latestClose` returns its date with it so the
 *    caller can stamp it. See `price-snapshot.ts`, which owns that rule for
 *    the rest of the product; this module follows it rather than restating it.
 */

/** Calendar days per named window. Trading days are not evenly spaced. */
export const WINDOW_DAYS = { '1M': 31, '3M': 93, '6M': 186, '1Y': 366 } as const
export type WindowKey = keyof typeof WINDOW_DAYS

/**
 * A one-session move this large is read as a break in the series.
 *
 * 35% because real single-day equity moves above it are rare enough that
 * refusing them costs little, while the smallest common split (3-for-2, −33%)
 * sits just under — so the threshold catches 2:1 and wider, which is the
 * overwhelming majority, without firing on ordinary earnings gaps.
 *
 * Deliberately not tuned finer. Without a split table this is a heuristic,
 * and a heuristic that refuses to compare is safe in a way that one asserting
 * a corporate action is not.
 */
const DISCONTINUITY = 0.35

const dayOf = (iso: string) => Date.parse(`${iso.slice(0, 10)}T12:00:00Z`)

/** Ascending, finite, positive. Callers may hand us anything. */
export function clean(points: PricePoint[] | null | undefined): PricePoint[] {
  if (!points?.length) return []
  return points
    .filter(p => p && Number.isFinite(p.close) && p.close > 0 && Number.isFinite(dayOf(p.date)))
    .sort((a, b) => dayOf(a.date) - dayOf(b.date))
}

export interface LatestClose { close: number; date: string }

export function latestClose(points: PricePoint[] | null | undefined): LatestClose | null {
  const s = clean(points)
  if (!s.length) return null
  const last = s[s.length - 1]
  return { close: last.close, date: last.date }
}

/** Whole days between a close's date and now. A Friday close on Monday is 3. */
export function closeAgeDays(date: string | null | undefined, now = Date.now()): number | null {
  if (!date) return null
  const t = dayOf(date)
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.floor((now - t) / 86_400_000))
}

/** The slice of the series inside `days` of its own last observation. */
export function windowSlice(points: PricePoint[] | null | undefined, days: number): PricePoint[] {
  const s = clean(points)
  if (s.length < 2) return []
  const floor = dayOf(s[s.length - 1].date) - days * 86_400_000
  return s.filter(p => dayOf(p.date) >= floor)
}

/** True when any adjacent pair in the slice gaps past the threshold. */
export function hasDiscontinuity(points: PricePoint[] | null | undefined): boolean {
  const s = clean(points)
  for (let i = 1; i < s.length; i++) {
    const prev = s[i - 1].close
    if (!prev) continue
    if (Math.abs(s[i].close - prev) / prev > DISCONTINUITY) return true
  }
  return false
}

export type ReturnRefusal = 'no-series' | 'short-lookback' | 'not-comparable'
export interface WindowReturn {
  pct: number | null
  /** Why there is no number, when there is no number. */
  refused: ReturnRefusal | null
  /** Closes actually used, so a caller can draw exactly what it quoted. */
  slice: PricePoint[]
  /**
   * The two observations the percentage is measured between.
   *
   * The slice already carries them at its ends, but a caller that wants to
   * STAMP the figure — "measured from the close of 3 Jul to the close of 1
   * Oct" — should not have to know that, and a caller reading `slice[0]`
   * when the return was refused would stamp a number that was never
   * quoted. Null whenever `pct` is null.
   */
  from: PricePoint | null
  to: PricePoint | null
}

/**
 * The return over a named window, or the reason there isn't one.
 *
 * The lookback test compares the series' FIRST observation against the window
 * floor with a week of slack: a 6-month window over a series that starts five
 * months and three weeks ago is honest; one over six weeks of data is not.
 */
export function windowReturn(
  points: PricePoint[] | null | undefined,
  window: WindowKey,
): WindowReturn {
  const days = WINDOW_DAYS[window]
  const s = clean(points)
  if (s.length < 2) return { pct: null, refused: 'no-series', slice: [], from: null, to: null }

  const lastT = dayOf(s[s.length - 1].date)
  const firstT = dayOf(s[0].date)
  const SLACK = 7 * 86_400_000
  if (lastT - firstT + SLACK < days * 86_400_000) {
    return { pct: null, refused: 'short-lookback', slice: [], from: null, to: null }
  }

  const slice = windowSlice(s, days)
  if (slice.length < 2) return { pct: null, refused: 'short-lookback', slice: [], from: null, to: null }
  if (hasDiscontinuity(slice)) return { pct: null, refused: 'not-comparable', slice, from: null, to: null }

  const a = slice[0]
  const b = slice[slice.length - 1]
  if (!a.close) return { pct: null, refused: 'no-series', slice, from: null, to: null }
  return { pct: ((b.close - a.close) / a.close) * 100, refused: null, slice, from: a, to: b }
}

export type YtdRefusal = 'no-series' | 'no-baseline' | 'stale-series' | 'not-comparable'

export interface YtdReturn {
  pct: number | null
  refused: YtdRefusal | null
  /** The close measured FROM: the last one before January 1. */
  baseline: PricePoint | null
  /** The close measured TO: the newest one held. */
  latest: PricePoint | null
  /** The calendar year the figure describes, whether or not there is one. */
  year: number
}

/**
 * Year-to-date price return, or the reason there is none.
 *
 * ── Why this cannot reuse `windowReturn` ────────────────────────────────
 *
 * Every other window on this module is "N days back from the last close",
 * and its base is the first observation INSIDE that window. Year-to-date is
 * a different question with a different base: the move since the market
 * last closed in the previous year. Those two differ by a whole session,
 * and in a year that opened with a gap they differ by the entire gap.
 *
 * Taking the first close OF the year instead — which is what a naive
 * `windowSlice(points, daysSinceJan1)` produces — silently answers "the
 * move since the first session of the year", which is not the number
 * anybody means by YTD and is not labelled as such either.
 *
 * So the baseline is selected explicitly, and when the series does not
 * reach back across the boundary the answer is a refusal rather than the
 * closest available number. A YTD computed from a March baseline is not a
 * worse YTD; it is a different statistic wearing its name.
 *
 * The year comes from `now`, never from the data: a cache whose newest
 * close is from last December must say so rather than report that
 * December's move as this year's.
 */
export function ytdReturn(points: PricePoint[] | null | undefined, now = Date.now()): YtdReturn {
  const year = new Date(now).getUTCFullYear()
  const jan1 = Date.UTC(year, 0, 1)
  const s = clean(points)
  if (s.length < 2) return { pct: null, refused: 'no-series', baseline: null, latest: null, year }

  const latest = s[s.length - 1]
  if (dayOf(latest.date) < jan1) {
    return { pct: null, refused: 'stale-series', baseline: null, latest, year }
  }

  /* The LAST close before the boundary, which is the one the market set. */
  let baseline: PricePoint | null = null
  for (const p of s) {
    if (dayOf(p.date) < jan1) baseline = p
    else break
  }
  if (!baseline) return { pct: null, refused: 'no-baseline', baseline: null, latest, year }

  const span = s.filter(p => dayOf(p.date) >= dayOf(baseline!.date))
  if (hasDiscontinuity(span)) {
    return { pct: null, refused: 'not-comparable', baseline, latest, year }
  }

  return {
    pct: ((latest.close - baseline.close) / baseline.close) * 100,
    refused: null,
    baseline,
    latest,
    year,
  }
}

/**
 * A sparkline's path in PERCENTAGE-RETURN space, indexed to its first close.
 *
 * ── Why not price space ───────────────────────────────────────────────────
 *
 * Because a sparkline drawn to its own min and max is a shape with no scale.
 * Every row fills its box top to bottom whatever happened, so a name that
 * drifted 2% and one that fell 30% draw the same picture, and the column
 * becomes decoration — which is what it was.
 *
 * Indexing to the first close puts the row on one axis — percent change over
 * the window — so the zero line is a real reference and the caller can state
 * the range it drew. The vertical range itself is per security (`localDomain`);
 * cross-security comparison is the job of the 1M and 6M numbers beside it.
 */
export function returnPath(points: PricePoint[], days: number): number[] {
  const slice = windowSlice(points, days)
  if (slice.length < 2) return []
  const base = slice[0].close
  if (!base) return []
  return slice.map(p => ((p.close - base) / base) * 100)
}

/**
 * One security's own vertical range, for a sparkline that shows its PATH.
 *
 * ── Why this is not the shared domain ─────────────────────────────────────
 *
 * The shared domain was built so two rows could be compared by eye. It does
 * that, and the cost is that it is set by the loudest name on screen: with a
 * +180% security in the list, everything else is drawn inside a few pixels
 * and the column becomes a row of flat lines. Comparability was already
 * available — 1M and 6M sit right beside the shape as exact, comparable
 * numbers — so the sparkline's job is the one thing those cannot show:
 * the SHAPE of how the name got there.
 *
 * `MIN_RANGE` is the guard against the opposite failure. Fitting a security
 * that moved 0.3% to the full box draws noise as if it were a trend, so the
 * domain never narrows below ±3%: a genuinely quiet name reads as quiet.
 */
const MIN_RANGE = 3

export function localDomain(path: number[]): { lo: number; hi: number } {
  let lo = Infinity
  let hi = -Infinity
  for (const v of path) {
    if (!Number.isFinite(v)) continue
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { lo: -MIN_RANGE, hi: MIN_RANGE }
  // Always include zero: the line starts there, and a baseline the path
  // never crosses is a baseline the reader cannot place.
  lo = Math.min(lo, 0)
  hi = Math.max(hi, 0)
  const pad = Math.max((hi - lo) * 0.18, MIN_RANGE - (hi - lo) / 2, 0.5)
  return { lo: lo - pad, hi: hi + pad }
}
