/**
 * Which mark is under the cursor, and what part of it.
 *
 * ── Why this did not exist ────────────────────────────────────────────────
 *
 * `ProChart` hit-tests price LINES (`detectLineAtPoint`) but has never
 * hit-tested annotations. `ChartingPage` has a `selectedAnnotation` state
 * that nothing could ever set to a value -- only `deleteAnnotation` wrote to
 * it, and only ever `null`. So a drawn mark was permanent furniture: it
 * could not be picked up, moved, or removed except by clearing the whole
 * panel.
 *
 * ── Pixels are the unit of "near" ────────────────────────────────────────
 *
 * Tolerance has to be in pixels, not in price or in seconds. Six seconds is
 * most of the chart at one zoom level and invisible at another, and a
 * tolerance expressed in dollars would make a $900 stock's lines
 * untouchable and a $3 stock's lines impossible to miss. So annotations are
 * projected FORWARD into pixel space and compared there, which is also the
 * space the reader is actually pointing in.
 *
 * ── Handles before bodies ────────────────────────────────────────────────
 *
 * A press within reach of an endpoint grabs the endpoint; anywhere else on
 * the mark grabs the whole mark. Handles are tested first and with a
 * slightly larger tolerance, because the alternative -- dragging the entire
 * trend line when the reader meant to adjust one end -- destroys the other
 * end's position, which is information they chose.
 */
import type { Annotation } from '../../components/charting/engine/annotations'

/** The forward half of `ChartTransform`: chart space into pixels. */
export interface Plotter {
  timeToX(time: number): number
  priceToY(price: number): number
}

export interface Pixel {
  x: number
  y: number
}

/**
 * What a press landed on.
 *
 * `'start'` and `'end'` name the mark's own first and second point, in the
 * order it was drawn -- NOT left and right. A ray drawn right-to-left has
 * its `start` on the right, and renaming them by screen position would
 * reverse which end a drag reshapes.
 */
export type HitPart = 'body' | 'start' | 'end'

export interface Hit {
  id: string
  part: HitPart
}

/** How near a press must be to a mark's line to count, in pixels. */
export const BODY_TOLERANCE = 6
/** The same for an endpoint handle. Larger, so a handle wins a tie. */
export const HANDLE_TOLERANCE = 9

/**
 * The topmost mark under the press, or null.
 *
 * LAST drawn wins, because that is the one on top: `AnnotationRenderer`
 * paints the array in order, so the final element is the one the reader can
 * actually see at an overlap. Picking the first would hand them whichever
 * mark happens to be buried.
 *
 * Invisible and locked marks are skipped. A locked mark is not selectable by
 * design -- that is what locking it means -- and selecting something that
 * cannot be seen would move a mark the reader has no way to watch.
 */
export function hitTest(
  annotations: readonly Annotation[],
  at: Pixel,
  plot: Plotter,
): Hit | null {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const a = annotations[i]
    if (a.visible === false || a.locked) continue
    const part = hitOne(a, at, plot)
    if (part) return { id: a.id, part }
  }
  return null
}

/** Which part of ONE mark a press landed on, or null. */
export function hitOne(a: Annotation, at: Pixel, plot: Plotter): HitPart | null {
  switch (a.type) {
    case 'horizontal-line': {
      /* A price level spans the whole plot, so only the y distance matters. */
      const y = plot.priceToY(a.price as number)
      return Math.abs(at.y - y) <= BODY_TOLERANCE ? 'body' : null
    }
    case 'vertical-line': {
      const x = plot.timeToX(a.time as number)
      return Math.abs(at.x - x) <= BODY_TOLERANCE ? 'body' : null
    }
    case 'text': {
      /*
       * A text note has no measurable extent without a canvas to measure
       * the glyphs, so its anchor gets a fixed grab box. Deliberately
       * generous: a note is a small target and the alternative is a mark
       * the reader cannot pick up at all.
       */
      const p = { x: plot.timeToX(a.time), y: plot.priceToY(a.price) }
      return Math.abs(at.x - p.x) <= 24 && Math.abs(at.y - p.y) <= 12 ? 'body' : null
    }
    case 'trend-line':
    case 'arrow':
    case 'ray': {
      const s = { x: plot.timeToX(a.startTime as number), y: plot.priceToY(a.startPrice as number) }
      const e = { x: plot.timeToX(a.endTime as number), y: plot.priceToY(a.endPrice as number) }
      const handle = nearestHandle(at, s, e)
      if (handle) return handle
      /*
       * A ray is tested as an infinite half-line beyond its second point,
       * because that is what the renderer draws. Testing only the segment
       * would leave the visible projection unclickable -- the part of a ray
       * a reader is most likely to aim at.
       */
      const d = a.type === 'ray' ? distanceToRay(at, s, e) : distanceToSegment(at, s, e)
      return d <= BODY_TOLERANCE ? 'body' : null
    }
    case 'rectangle': {
      const s = { x: plot.timeToX(a.startTime), y: plot.priceToY(a.startPrice) }
      const e = { x: plot.timeToX(a.endTime), y: plot.priceToY(a.endPrice) }
      const handle = nearestHandle(at, s, e)
      if (handle) return handle
      return insideBox(at, s, e, BODY_TOLERANCE) ? 'body' : null
    }
    case 'ellipse': {
      const s = { x: plot.timeToX(a.startTime), y: plot.priceToY(a.startPrice) }
      const e = { x: plot.timeToX(a.endTime), y: plot.priceToY(a.endPrice) }
      const handle = nearestHandle(at, s, e)
      if (handle) return handle
      return insideEllipse(at, s, e, BODY_TOLERANCE) ? 'body' : null
    }
    case 'fibonacci': {
      const s = { x: plot.timeToX(a.startTime), y: plot.priceToY(a.startPrice) }
      const e = { x: plot.timeToX(a.endTime), y: plot.priceToY(a.endPrice) }
      const handle = nearestHandle(at, s, e)
      if (handle) return handle
      /* Horizontal within the span, at each level between the two anchors. */
      const left = Math.min(s.x, e.x)
      const right = Math.max(s.x, e.x)
      if (at.x < left - BODY_TOLERANCE || at.x > right + BODY_TOLERANCE) return null
      for (const level of a.levels) {
        const y = s.y + (e.y - s.y) * level
        if (Math.abs(at.y - y) <= BODY_TOLERANCE) return 'body'
      }
      return null
    }
    default:
      return null
  }
}

/** The closer endpoint, if the press is within reach of either. */
function nearestHandle(at: Pixel, start: Pixel, end: Pixel): HitPart | null {
  const ds = Math.hypot(at.x - start.x, at.y - start.y)
  const de = Math.hypot(at.x - end.x, at.y - end.y)
  if (ds > HANDLE_TOLERANCE && de > HANDLE_TOLERANCE) return null
  /* A tie goes to `start`, arbitrarily but deterministically: two handles
     within a pixel of each other is a zero-length mark, and either answer
     reshapes it the same way. */
  return ds <= de ? 'start' : 'end'
}

/** Perpendicular distance to a finite segment, in pixels. */
export function distanceToSegment(p: Pixel, a: Pixel, b: Pixel): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  /* A degenerate segment is a point; without this the division below is
     0/0 and every press reads as a hit at NaN <= tolerance (false), which
     would make a zero-length mark silently unselectable. */
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  /* Clamped projection: past either end, the nearest point IS that end. */
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** As above, but the line continues forever beyond `b`. */
export function distanceToRay(p: Pixel, a: Pixel, b: Pixel): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  /* Clamped at the origin only. */
  const t = Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq)
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

function insideBox(p: Pixel, a: Pixel, b: Pixel, pad: number): boolean {
  return (
    p.x >= Math.min(a.x, b.x) - pad &&
    p.x <= Math.max(a.x, b.x) + pad &&
    p.y >= Math.min(a.y, b.y) - pad &&
    p.y <= Math.max(a.y, b.y) + pad
  )
}

function insideEllipse(p: Pixel, a: Pixel, b: Pixel, pad: number): boolean {
  const cx = (a.x + b.x) / 2
  const cy = (a.y + b.y) / 2
  const rx = Math.abs(b.x - a.x) / 2 + pad
  const ry = Math.abs(b.y - a.y) / 2 + pad
  if (rx <= 0 || ry <= 0) return false
  const nx = (p.x - cx) / rx
  const ny = (p.y - cy) / ry
  return nx * nx + ny * ny <= 1
}
