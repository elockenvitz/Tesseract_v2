/**
 * Where a drawn mark actually goes.
 *
 * ── The defect this closes ────────────────────────────────────────────────
 *
 * `ChartingPage.createAnnotation(type, time, price)` took ONE point — the
 * right-click location — and invented the other end arithmetically:
 *
 *     case 'trend-line':
 *     case 'ray':
 *       return { ..., startTime: time, startPrice: price,
 *                endTime: time + 86400 * 30, endPrice: price * 1.05 }
 *
 * So every trend line was exactly thirty days long and rose exactly 5%.
 * Every rectangle was thirty days wide and 5% deep. Every fibonacci retraced
 * exactly 20% over sixty days. The numbers are not a default a reader can
 * correct, because nothing could be dragged afterwards: the mark could only
 * be deleted and stamped again, identically.
 *
 * A trend line whose slope the analyst did not choose is not a weak feature,
 * it is a false statement drawn on a price series. This module takes the two
 * points the analyst actually indicated and builds the mark between them.
 *
 * ── Two points, in the order they were drawn ──────────────────────────────
 *
 * `from` is where the drag began and `to` is where it ended, and for a line
 * that ORDER IS MEANING: a ray extends beyond its second point, so dragging
 * right-to-left aims it into the past deliberately. Spans are therefore not
 * silently sorted. Rectangles and fibonacci retracements are different —
 * their corners have no order — so those ARE normalised, which is what lets
 * a rectangle drawn upward and one drawn downward compare equal.
 *
 * ── Pure ─────────────────────────────────────────────────────────────────
 *
 * Time and price in, annotation out. No canvas, no DOM, no clock, no ids
 * generated here: the caller supplies `id`, so a test can assert on a whole
 * annotation and a future persistence path can keep a database id stable.
 */
import type {
  Annotation,
  AnnotationStyle,
  AnnotationType,
} from '../../components/charting/engine/annotations'
import { DEFAULT_FIBONACCI_LEVELS } from '../../components/charting/engine/annotations'

/** A point in chart space, never in pixels. */
export interface ChartPoint {
  /** Unix seconds, matching `OHLC.time`. */
  time: number
  price: number
}

/**
 * How many points the analyst has to give before a mark can exist.
 *
 * A horizontal line needs a price and a vertical line needs a time, so one
 * click is the whole gesture and a drag would be theatre. Everything else
 * spans two points. Exported because the surface has to know whether to
 * start a drag or commit immediately, and a second copy of this knowledge in
 * the page would be the thing that drifts.
 */
export const POINTS_REQUIRED: Record<AnnotationType, 1 | 2> = {
  'horizontal-line': 1,
  'vertical-line': 1,
  text: 1,
  'trend-line': 2,
  ray: 2,
  rectangle: 2,
  ellipse: 2,
  fibonacci: 2,
  arrow: 2,
}

export function isTwoPointTool(type: AnnotationType): boolean {
  return POINTS_REQUIRED[type] === 2
}

/**
 * A drag shorter than this is a click, in pixels.
 *
 * Without a floor, a two-point tool plus an unsteady hand produces a mark
 * with zero or near-zero extent: a trend line of no length and no slope,
 * invisible but present, and selectable only by accident. The caller
 * measures in pixels because that is where the tremor is -- a two-pixel
 * wobble is a different number of seconds at every zoom level.
 */
export const MIN_DRAG_PIXELS = 4

/**
 * Build the mark the analyst drew.
 *
 * `to` is ignored for a one-point type, so a caller that always passes both
 * does not have to branch. Returns null for an unknown type rather than
 * guessing a fallback: the old code silently turned anything unrecognised
 * into a horizontal line, which put a price level on the chart that nobody
 * asked for.
 */
export function annotationFromPoints(
  type: AnnotationType,
  from: ChartPoint,
  to: ChartPoint,
  style: AnnotationStyle,
  id: string,
): Annotation | null {
  switch (type) {
    /* ---------------------------------------------------- one-point marks */
    case 'horizontal-line':
      /* No label. The old code baked `$${price.toFixed(2)}` into the text,
         which hardcodes a currency the asset may not quote in and freezes a
         figure that the renderer can read off `price` itself. */
      return { id, type, style, price: from.price }
    case 'vertical-line':
      return { id, type, style, time: from.time }
    case 'text':
      return { id, type, style, time: from.time, price: from.price, text: '', anchor: 'left' }

    /* ------------------------------------- two-point marks, order PRESERVED */
    case 'trend-line':
    case 'ray':
    case 'arrow':
      return {
        id,
        type,
        style,
        startTime: from.time,
        startPrice: from.price,
        endTime: to.time,
        endPrice: to.price,
      }

    /* ----------------------------- two-point marks, corners NORMALISED */
    case 'rectangle':
    case 'ellipse': {
      const s = normalizeSpan(from, to)
      return {
        id,
        type,
        style,
        startTime: s.startTime,
        startPrice: s.startPrice,
        endTime: s.endTime,
        endPrice: s.endPrice,
      }
    }
    case 'fibonacci': {
      /*
       * Normalised in TIME only.
       *
       * A retracement's prices are its anchors: 0 sits at the first price
       * the analyst picked and 1 at the second, so a fib drawn downward
       * measures a decline and must not be flipped into a rally. Only the
       * left-to-right ordering is tidied.
       */
      const [startTime, endTime] =
        from.time <= to.time ? [from.time, to.time] : [to.time, from.time]
      return {
        id,
        type,
        style,
        startTime,
        startPrice: from.price,
        endTime,
        endPrice: to.price,
        levels: [...DEFAULT_FIBONACCI_LEVELS],
      }
    }
    default:
      return null
  }
}

/** Lower-left to upper-right, for marks whose corners carry no order. */
export function normalizeSpan(
  a: ChartPoint,
  b: ChartPoint,
): { startTime: number; startPrice: number; endTime: number; endPrice: number } {
  return {
    startTime: Math.min(a.time, b.time),
    endTime: Math.max(a.time, b.time),
    startPrice: Math.min(a.price, b.price),
    endPrice: Math.max(a.price, b.price),
  }
}

/**
 * Was that gesture a drag or a click?
 *
 * Measured in pixels, by the caller, for the reason given on
 * `MIN_DRAG_PIXELS`. Chebyshev rather than Euclidean distance: a horizontal
 * wobble and a diagonal one of the same visual size should read the same,
 * and it avoids a square root on every mouse move.
 */
export function isDrag(
  fromPx: { x: number; y: number },
  toPx: { x: number; y: number },
  minPixels: number = MIN_DRAG_PIXELS,
): boolean {
  return (
    Math.abs(toPx.x - fromPx.x) >= minPixels || Math.abs(toPx.y - fromPx.y) >= minPixels
  )
}

/**
 * Move a whole mark by a delta in CHART space.
 *
 * Time and price, not pixels, because the caller converts once at the start
 * of the drag: converting per-frame would accumulate the rounding of every
 * intermediate position, and a mark dragged in a circle would not come back
 * to where it started.
 *
 * A one-point mark moves along the axis it describes and ignores the other
 * delta entirely. A horizontal line dragged diagonally changes its PRICE
 * and nothing else -- it has no horizontal position to change, and pretending
 * otherwise would quietly convert a drag into no movement at all.
 */
export function moveAnnotation(
  a: Annotation,
  deltaTime: number,
  deltaPrice: number,
): Annotation {
  switch (a.type) {
    case 'horizontal-line':
      return { ...a, price: (a.price as number) + deltaPrice }
    case 'vertical-line':
      return { ...a, time: (a.time as number) + deltaTime }
    case 'text':
      return { ...a, time: a.time + deltaTime, price: a.price + deltaPrice }
    case 'trend-line':
    case 'ray':
    case 'arrow':
    case 'rectangle':
    case 'ellipse':
    case 'fibonacci':
      return {
        ...a,
        startTime: (a.startTime as number) + deltaTime,
        startPrice: (a.startPrice as number) + deltaPrice,
        endTime: (a.endTime as number) + deltaTime,
        endPrice: (a.endPrice as number) + deltaPrice,
      }
    default:
      return a
  }
}

/**
 * Drag ONE end of a two-point mark to a new place.
 *
 * `end` here is the mark's own first or second point in the order it was
 * drawn, not its left or right. Reshaping a right-to-left ray by its
 * `start` must move the end on the right, because that is the one the
 * reader grabbed.
 *
 * A one-point mark has no ends, so it is returned untouched rather than
 * being reinterpreted as a move: a caller that hit-tested a handle on a
 * horizontal line has a bug, and silently moving the line would hide it.
 *
 * Rectangles and ellipses are NOT re-normalised here. Dragging the lower
 * corner above the upper one has to be allowed to pass through the inverted
 * state while the mouse is down, or the shape would flip and then fight the
 * cursor. The caller normalises on release.
 */
export function reshapeAnnotation(
  a: Annotation,
  which: 'start' | 'end',
  to: ChartPoint,
): Annotation {
  switch (a.type) {
    case 'trend-line':
    case 'ray':
    case 'arrow':
    case 'rectangle':
    case 'ellipse':
    case 'fibonacci':
      return which === 'start'
        ? { ...a, startTime: to.time, startPrice: to.price }
        : { ...a, endTime: to.time, endPrice: to.price }
    default:
      return a
  }
}

/**
 * Tidy a mark after a reshape, if its kind has no inherent point order.
 *
 * Applied on release, for the reason given on `reshapeAnnotation`. Only
 * rectangles and ellipses: a line's direction is meaning, and a fibonacci's
 * price anchors are meaning, so neither is sorted.
 */
export function settleAnnotation(a: Annotation): Annotation {
  if (a.type !== 'rectangle' && a.type !== 'ellipse') return a
  const s = normalizeSpan(
    { time: a.startTime, price: a.startPrice },
    { time: a.endTime, price: a.endPrice },
  )
  return { ...a, ...s }
}
