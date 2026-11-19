/**
 * Where the time axis puts its labels and its grid lines.
 *
 * ── The defect this replaces ──────────────────────────────────────────────
 *
 * The renderer chose a unit from a range table: two years or more got year
 * boundaries, six months to two years got quarters or months, one to six
 * months got MONTH boundaries, and anything shorter fell through to a
 * fixed-interval grid.
 *
 * The table picks a unit; what a reader sees is a COUNT, and the two are not
 * the same question. A one-month window contains one month boundary. So the
 * default Charting view -- AAPL, 1M -- drew a time axis carrying the single
 * word "Nov 1" beneath thirty days of price, and a single vertical grid line
 * down the middle of the canvas, which read as a rendering artifact rather
 * than as a date. Measured in the browser on the running app before this
 * change: one label, one line.
 *
 * The same table starves the 6M view (six labels for a hundred and eighty
 * days) and over-fills nothing, because every one of its branches errs the
 * same way.
 *
 * ── What this does instead ────────────────────────────────────────────────
 *
 * Keeps calendar alignment, which was the good idea in the original: a label
 * on the 1st of the month and on the 1st of January is worth more than one
 * at an arbitrary offset, because a reader can place it without arithmetic.
 *
 * Changes the SELECTION. Candidates run from coarse to fine, and the chosen
 * one is the coarsest that yields at least `min` labels without exceeding
 * `max`. A window too short for any calendar unit falls through to the
 * intraday steps, and a window too short even for those gets evenly spaced
 * times rather than an empty axis.
 *
 * ── Why it is here and not in the renderer ────────────────────────────────
 *
 * The renderer draws on a canvas, which jsdom cannot produce, so anything
 * inside it is untestable without a browser. This is arithmetic over two
 * numbers. It follows `drawing-gesture.ts` out of the component for exactly
 * the same reason, and is asserted the same way.
 */

const MINUTE = 60
const HOUR = 3600
const DAY = 86_400

/** How many labels the axis is aiming for. */
export interface GridOptions {
  /** Fewer than this and the axis is not telling the reader much. */
  min?: number
  /** More than this and the labels collide. */
  max?: number
}

export const DEFAULT_MIN_LABELS = 4
export const DEFAULT_MAX_LABELS = 12

/**
 * A calendar step, coarse to fine.
 *
 * `years` and `months` cannot be expressed in seconds -- months differ in
 * length and years differ in whether they have a 29th of February -- so they
 * step through `Date` rather than by addition. Everything from a week down is
 * a fixed number of seconds and is aligned by rounding up to the next whole
 * multiple, which is what makes a daily grid land on midnight.
 */
type Step =
  | { unit: 'year'; every: number }
  | { unit: 'month'; every: number }
  | { unit: 'seconds'; every: number }

const STEPS: readonly Step[] = [
  { unit: 'year', every: 10 },
  { unit: 'year', every: 5 },
  { unit: 'year', every: 2 },
  { unit: 'year', every: 1 },
  { unit: 'month', every: 6 },
  { unit: 'month', every: 3 },
  { unit: 'month', every: 1 },
  { unit: 'seconds', every: DAY * 7 },
  { unit: 'seconds', every: DAY * 2 },
  { unit: 'seconds', every: DAY },
  { unit: 'seconds', every: HOUR * 12 },
  { unit: 'seconds', every: HOUR * 6 },
  { unit: 'seconds', every: HOUR * 2 },
  { unit: 'seconds', every: HOUR },
  { unit: 'seconds', every: MINUTE * 30 },
  { unit: 'seconds', every: MINUTE * 15 },
  { unit: 'seconds', every: MINUTE * 5 },
  { unit: 'seconds', every: MINUTE },
]

/** Every time this step lands on inside the window, in order. */
export function timesForStep(startTime: number, endTime: number, step: Step): number[] {
  const out: number[] = []
  if (!(endTime > startTime)) return out

  if (step.unit === 'seconds') {
    /* A cap before the loop, not inside it. A one-minute step over a ten-year
       window is five million iterations, and the caller only ever wants to
       know that the count is "too many" -- so stop as soon as it is. */
    if ((endTime - startTime) / step.every > DEFAULT_MAX_LABELS * 50) {
      return new Array(DEFAULT_MAX_LABELS * 50 + 1).fill(0)
    }
    let t = Math.ceil(startTime / step.every) * step.every
    while (t <= endTime) {
      out.push(t)
      t += step.every
    }
    return out
  }

  /*
   * ── UTC, deliberately, and not the reader's zone ──────────────────────
   *
   * A daily bar's timestamp is a calendar date parsed to UTC midnight:
   * `2026-11-09` is 2026-11-09T00:00:00Z. If this walked LOCAL months, a
   * grid line for "1 November" would land at local midnight -- five hours
   * away from the bar it is meant to sit on, in New York -- and the line
   * would miss the bar by that much.
   *
   * It also made this function internally inconsistent: the seconds steps
   * below a week align with `Math.ceil(t / every) * every`, which is UTC.
   * So a 1M view (weekly step) agreed with the data and a 1Y view (quarterly
   * step) did not, for no reason a reader could see.
   */
  const from = new Date(startTime * 1000)
  const cursor = step.unit === 'year'
    // Align down to a multiple of `every` years, so a 10-year step lands on
    // 2020 and 2030 rather than on whatever year the window happens to open.
    ? new Date(Date.UTC(Math.floor(from.getUTCFullYear() / step.every) * step.every, 0, 1))
    : new Date(Date.UTC(
        from.getUTCFullYear(),
        Math.floor(from.getUTCMonth() / step.every) * step.every,
        1,
      ))

  // Guard against a window far in the past producing an unbounded walk.
  for (let i = 0; i < 2000; i++) {
    const t = Math.floor(cursor.getTime() / 1000)
    if (t > endTime) break
    if (t >= startTime) out.push(t)
    if (step.unit === 'year') cursor.setUTCFullYear(cursor.getUTCFullYear() + step.every)
    else cursor.setUTCMonth(cursor.getUTCMonth() + step.every)
  }
  return out
}

/**
 * The times the axis should label, and the grid should line.
 *
 * Returns the coarsest step that puts at least `min` marks in the window
 * without exceeding `max`. Labels and grid lines share this deliberately:
 * they answered the same question before and disagreed about it, because the
 * grid read `getTimeGridInterval` while the labels walked calendar
 * boundaries -- so a line could appear where no label did, and did.
 */
export function calendarGridTimes(
  startTime: number,
  endTime: number,
  options: GridOptions = {},
): number[] {
  const min = options.min ?? DEFAULT_MIN_LABELS
  const max = options.max ?? DEFAULT_MAX_LABELS
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) return []

  let best: number[] = []
  for (const step of STEPS) {
    const times = timesForStep(startTime, endTime, step)
    if (times.length > max) break
    best = times
    if (times.length >= min) return times
  }

  /*
   * Nothing on the calendar fits -- a window of seconds, or one so wide that
   * even a ten-year step is too dense, which cannot happen but is cheaper to
   * handle than to reason about. An axis with no labels at all is strictly
   * worse than evenly spaced ones, so space them evenly.
   */
  if (best.length >= min) return best
  const span = endTime - startTime
  const evenly: number[] = []
  for (let i = 1; i < min + 1; i++) evenly.push(startTime + (span * i) / (min + 1))
  return best.length > evenly.length ? best : evenly
}
