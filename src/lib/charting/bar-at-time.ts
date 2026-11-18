/**
 * Which bar the cursor is over.
 *
 * ── Why this is not `data.find(b => b.time === t)` ───────────────────────
 *
 * `xToTime` inverts a pixel into a continuous timestamp, and a bar occupies
 * a RANGE of pixels. The exact timestamp under the cursor is almost never a
 * bar's own timestamp, so an equality match reports nothing for every pixel
 * but one per bar, and a readout built on it would flicker between a row of
 * numbers and an empty row as the cursor moved.
 *
 * ── Why nearest, and not "the bar whose span contains t" ─────────────────
 *
 * Containment needs a bar width, and the width is not in the data: it is the
 * interval, which is resampled for 15m/30m/1wk/1mo and therefore not a
 * constant the series carries. Nearest-by-time needs nothing but the
 * timestamps, and at the only place the two disagree -- the boundary between
 * two bars -- they disagree by half a pixel.
 *
 * ── Why binary search ────────────────────────────────────────────────────
 *
 * This runs on every mousemove over the canvas. The ALL view is five
 * thousand daily bars, so a linear scan is five thousand comparisons per
 * frame at up to 120 frames a second. The series is sorted ascending
 * already, which is the only thing a binary search needs.
 */

/** The least a bar must have for this to place it. */
export interface TimedBar {
  time: number
}

/**
 * The bar nearest `time`, or null.
 *
 * Null when the series is empty, when `time` is not a number, or when the
 * cursor is further from the series than `maxDistance` seconds -- the last
 * so that panning into empty canvas past the final bar reports nothing
 * rather than clamping to the last bar and quietly asserting that the
 * cursor is over a bar it is nowhere near.
 */
export function barAtTime<T extends TimedBar>(
  bars: readonly T[],
  time: number | null,
  maxDistance = Number.POSITIVE_INFINITY,
): T | null {
  if (time == null || !Number.isFinite(time) || bars.length === 0) return null

  let lo = 0
  let hi = bars.length - 1

  // Outside the series entirely: answer with an endpoint, subject to the
  // distance check below.
  if (time <= bars[lo].time) return withinReach(bars[lo], time, maxDistance)
  if (time >= bars[hi].time) return withinReach(bars[hi], time, maxDistance)

  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (bars[mid].time === time) return bars[mid]
    if (bars[mid].time < time) lo = mid
    else hi = mid
  }

  // `lo` and `hi` now straddle `time`. Ties go to the earlier bar, so the
  // readout does not jump forward half a bar early.
  const nearer = time - bars[lo].time <= bars[hi].time - time ? bars[lo] : bars[hi]
  return withinReach(nearer, time, maxDistance)
}

function withinReach<T extends TimedBar>(bar: T, time: number, maxDistance: number): T | null {
  return Math.abs(bar.time - time) <= maxDistance ? bar : null
}

/**
 * How far from a bar the cursor may be and still be considered over it,
 * given the bar size.
 *
 * One whole bar either side. Tighter than that and the readout blinks out
 * between bars on a sparse series; looser and it keeps reporting the last
 * bar well into empty canvas.
 */
export function reachForInterval(intervalSeconds: number): number {
  return Number.isFinite(intervalSeconds) && intervalSeconds > 0
    ? intervalSeconds
    : Number.POSITIVE_INFINITY
}

/** Seconds per bar for the interval strings this chart asks for. */
export function secondsForInterval(interval: string): number {
  const table: Record<string, number> = {
    '1m': 60, '5m': 300, '15m': 900, '30m': 1800,
    '1h': 3600, '2h': 7200, '4h': 14_400,
    '1d': 86_400, '1wk': 604_800, '1mo': 2_592_000,
  }
  return table[interval] ?? 0
}
