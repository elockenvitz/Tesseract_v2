/**
 * The arithmetic behind the feed's price preview.
 *
 * ── Why this is a module and not inline in the component ──────────────────
 *
 * Three of the four things here are claims about a security — where the scale
 * starts and ends, whether a declared target was crossed and when, how long the
 * drawn window actually is. A wrong scale makes a flat line look like a trend;
 * a wrong crossing date asserts an event that did not happen. Those are
 * assertable in a unit test and a `<path>` is not.
 *
 * ── What the data actually is ─────────────────────────────────────────────
 *
 * `price_history_cache` holds `symbol, date, close` and nothing else. There is
 * no open, no intraday high or low, and no volume, so nothing downstream may
 * draw a candle, a range bar or a volume pane — and the extremes computed here
 * are extremes OF CLOSES and are named that way. The feed reads it through
 * `usePriceHistory` at 60 points per symbol, which is about three trading
 * months, so a window label is derived from the dates present rather than
 * assumed to be a year.
 *
 * Pure: no React, no Supabase, no clock. Every number is read off the series
 * the caller already has.
 */

export interface ClosePoint { date: string; close: number }

export interface PriceScale {
  /** Bottom and top of the drawn box. */
  lo: number
  hi: number
  /** Extremes of the CLOSES — not intraday highs and lows, which we do not have. */
  high: number
  low: number
  /**
   * Whether the reference shares the drawn scale.
   *
   * False means it is off the box and is indicated at the edge instead. See
   * `REFERENCE_ROOM` for why both cases exist.
   */
  referenceInScale: boolean
  /** Which way it is off, when it is off. */
  referenceSide: 'above' | 'below' | null
}

/**
 * How far outside the closes a reference may sit and still join the scale.
 *
 * ── The defect this number exists to prevent ──────────────────────────────
 *
 * The reference used to join the domain unconditionally, on the reasoning that
 * a target drawn outside the box is invisible. True, and the cost was worse: a
 * stale target 3x the price turned a year of real movement into a horizontal
 * line at the bottom of the frame. The card whose entire point is "this target
 * is far from the price" was the card that destroyed the price series.
 *
 * Both failures are the same mistake — one axis asked to carry two quantities
 * of different magnitude. So the reference joins the scale while it costs the
 * series little, and is shown at the edge with its real distance when it would
 * cost a lot. At this half-a-span bound the series still occupies about 60% of
 * the box in the worst in-scale case, and about 86% once the reference steps
 * outside.
 */
const REFERENCE_ROOM = 0.5

/** Breathing room so the line never runs along the edge of its own box. */
const PAD = 0.08

export function priceScale(closes: number[], reference: number | null): PriceScale {
  const low = Math.min(...closes)
  const high = Math.max(...closes)
  // A perfectly flat series has no span to pad; give it one so it draws down
  // the middle instead of dividing by zero.
  const span = high - low || Math.max(high * 0.02, 0.01)
  const pad = span * PAD

  let lo = low - pad
  let hi = high + pad
  let referenceInScale = false
  let referenceSide: 'above' | 'below' | null = null

  if (reference != null && Number.isFinite(reference) && reference > 0) {
    const room = span * REFERENCE_ROOM
    if (reference >= low - room && reference <= high + room) {
      referenceInScale = true
      lo = Math.min(lo, reference - pad)
      hi = Math.max(hi, reference + pad)
    } else {
      referenceSide = reference > high ? 'above' : 'below'
    }
  }

  return { lo, hi, high, low, referenceInScale, referenceSide }
}

export interface Crossing {
  index: number
  date: string
  /** Which way the price went through it. */
  direction: 'up' | 'down'
}

/**
 * The first time the drawn series passes through the reference.
 *
 * Measured against the side the WINDOW OPENS ON, which is the whole discipline
 * here: a series that begins already past its target has no crossing to report,
 * because the crossing happened before the data starts and this function has no
 * way to know when. Claiming one would be inventing the date.
 */
export function firstCrossing(series: ClosePoint[], reference: number | null): Crossing | null {
  if (reference == null || !Number.isFinite(reference) || reference <= 0) return null

  // Where the window opens. A close sitting exactly ON the reference is not a
  // side, so the opening side is the first one that is.
  let openSide = 0
  let start = 0
  for (let i = 0; i < series.length; i++) {
    const s = Math.sign(series[i].close - reference)
    if (s !== 0) { openSide = s; start = i; break }
  }
  if (openSide === 0) return null

  for (let i = start + 1; i < series.length; i++) {
    const side = Math.sign(series[i].close - reference)
    if (side !== 0 && side !== openSide) {
      return { index: i, date: series[i].date, direction: side > 0 ? 'up' : 'down' }
    }
  }
  return null
}

/**
 * What to call the window, from the dates in it.
 *
 * Not a constant: this feed reads 60 closes, which is about three months, and
 * a chart captioned "1Y" over three months of data is a false statement about
 * the evidence. Change the fetch depth and this follows on its own.
 */
export function periodLabel(firstDate: string, lastDate: string): string {
  const days = calendarDaysBetween(firstDate, lastDate)
  if (days <= 0) return ''
  if (days >= 330) {
    const years = Math.round(days / 365.25)
    return years >= 2 ? `${years}Y` : '1Y'
  }
  if (days >= 25) return `${Math.max(1, Math.round(days / 30.44))}M`
  return `${days}D`
}

export function calendarDaysBetween(a: string, b: string): number {
  const t0 = Date.parse(a)
  const t1 = Date.parse(b)
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return 0
  return Math.round((t1 - t0) / 86_400_000)
}

/**
 * Evenly spaced indices for the date axis, ends included.
 *
 * Four by default: enough to say when the movement happened, few enough that
 * the labels do not collide at a feed's column width.
 */
export function axisTickIndices(length: number, count = 4): number[] {
  if (length <= 0) return []
  if (length <= count) return Array.from({ length }, (_, i) => i)
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    out.push(Math.round((i / (count - 1)) * (length - 1)))
  }
  return [...new Set(out)]
}

/** Percentage change between two prices, or null when it cannot be stated. */
export function changePct(from: number, to: number): number | null {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0) return null
  return ((to - from) / from) * 100
}

/**
 * Date formatting for the axis, keyed on how long the window is.
 *
 * A three-month window wants a day; a multi-year one wants a month and year.
 * `en-US` explicitly, so the label does not depend on the reader's locale in a
 * product where two people compare screens.
 */
export function axisDateLabel(date: string, spanDays: number): string {
  const d = new Date(date)
  if (!Number.isFinite(d.getTime())) return ''
  // UTC because the dates are trading DAYS, not instants. Rendering them in the
  // reader's zone slides a close onto the previous day west of Greenwich.
  return spanDays >= 330
    ? d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
