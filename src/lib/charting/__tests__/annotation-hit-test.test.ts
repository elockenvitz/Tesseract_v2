/**
 * Which mark is under the cursor, and what part of it.
 *
 * None of this was reachable before: ProChart hit-tests price lines but has
 * never hit-tested annotations, and `ChartingPage.selectedAnnotation` could
 * only ever be set to null. A drawn mark was permanent furniture.
 */
import { describe, expect, it } from 'vitest'
import {
  BODY_TOLERANCE,
  distanceToRay,
  distanceToSegment,
  HANDLE_TOLERANCE,
  hitOne,
  hitTest,
  type Plotter,
} from '../annotation-hit-test'
import {
  DEFAULT_ANNOTATION_STYLE,
  DEFAULT_FIBONACCI_LEVELS,
  type Annotation,
} from '../../../components/charting/engine/annotations'

/**
 * A projector chosen so pixels and chart units are easy to hold in the head:
 * time 1000 sits at x=0 and each second is one pixel; price 500 sits at y=0
 * and each unit of price is one pixel DOWNWARD (price falls as y rises, as
 * on a real chart).
 */
const plot: Plotter = {
  timeToX: time => time - 1000,
  priceToY: price => 500 - price,
}
const px = (x: number, y: number) => ({ x, y })

const S = DEFAULT_ANNOTATION_STYLE
const line = (over: Partial<Annotation> = {}): Annotation =>
  ({
    id: 'l1',
    type: 'trend-line',
    style: S,
    startTime: 1100, // x = 100
    startPrice: 400, // y = 100
    endTime: 1300, // x = 300
    endPrice: 200, // y = 300
    ...over,
  }) as Annotation

describe('a trend line', () => {
  it('is hit along its body', () => {
    /* The segment runs (100,100) to (300,300): its midpoint is (200,200). */
    expect(hitOne(line(), px(200, 200), plot)).toBe('body')
  })

  it('is missed just beyond the tolerance', () => {
    /* Perpendicular to a 45-degree line: offset both axes to clear it. */
    expect(hitOne(line(), px(200, 200 + BODY_TOLERANCE * 2), plot)).toBeNull()
  })

  it('is not hit past either end', () => {
    expect(hitOne(line(), px(20, 20), plot)).toBeNull()
    expect(hitOne(line(), px(400, 400), plot)).toBeNull()
  })

  it('gives its endpoints as handles', () => {
    expect(hitOne(line(), px(100, 100), plot)).toBe('start')
    expect(hitOne(line(), px(300, 300), plot)).toBe('end')
  })

  it('prefers the handle to the body where they overlap', () => {
    /*
     * A press two pixels from the endpoint is also within reach of the body.
     * It must grab the END, because dragging the whole line instead would
     * destroy the far end's position -- which the analyst chose.
     */
    expect(hitOne(line(), px(298, 298), plot)).toBe('end')
  })

  it('names the ends in the order drawn, not left to right', () => {
    /* Drawn right to left: `start` is now the RIGHTMOST point. */
    const rightToLeft = line({ startTime: 1300, startPrice: 200, endTime: 1100, endPrice: 400 })
    expect(hitOne(rightToLeft, px(300, 300), plot)).toBe('start')
    expect(hitOne(rightToLeft, px(100, 100), plot)).toBe('end')
  })
})

describe('a ray continues past its second point', () => {
  const ray = line({ type: 'ray' })

  it('is hit on the projection beyond the end', () => {
    /*
     * The visible projection is the part of a ray a reader is most likely
     * to aim at. Testing only the segment would leave it unclickable.
     */
    expect(hitOne(ray, px(500, 500), plot)).toBe('body')
  })

  it('is still not hit behind its origin', () => {
    expect(hitOne(ray, px(20, 20), plot)).toBeNull()
  })

  it('differs from a trend line on exactly that point', () => {
    expect(hitOne(line(), px(500, 500), plot)).toBeNull()
  })
})

describe('one-point marks', () => {
  it('hits a horizontal line anywhere along its price', () => {
    const h = { id: 'h', type: 'horizontal-line', style: S, price: 350 } as Annotation
    /* y = 500 - 350 = 150, at any x. */
    expect(hitOne(h, px(5, 150), plot)).toBe('body')
    expect(hitOne(h, px(900, 150), plot)).toBe('body')
    expect(hitOne(h, px(400, 150 + BODY_TOLERANCE * 2), plot)).toBeNull()
  })

  it('hits a vertical line anywhere along its time', () => {
    const v = { id: 'v', type: 'vertical-line', style: S, time: 1250 } as Annotation
    expect(hitOne(v, px(250, 10), plot)).toBe('body')
    expect(hitOne(v, px(250, 480), plot)).toBe('body')
    expect(hitOne(v, px(250 + BODY_TOLERANCE * 2, 300), plot)).toBeNull()
  })

  it('never reports a handle on a mark with no ends', () => {
    /* A caller that reshaped on a phantom handle would move the line and
       hide its own bug. */
    const h = { id: 'h', type: 'horizontal-line', style: S, price: 350 } as Annotation
    expect(hitOne(h, px(0, 150), plot)).toBe('body')
  })
})

describe('shapes', () => {
  const box = (type: 'rectangle' | 'ellipse') =>
    ({
      id: 'b', type, style: S,
      startTime: 1100, startPrice: 200, // x=100, y=300
      endTime: 1300, endPrice: 400,     // x=300, y=100
    }) as Annotation

  it('hits inside a rectangle', () => {
    expect(hitOne(box('rectangle'), px(200, 200), plot)).toBe('body')
  })

  it('misses outside a rectangle', () => {
    expect(hitOne(box('rectangle'), px(400, 200), plot)).toBeNull()
  })

  it('gives a rectangle its corner handles', () => {
    expect(hitOne(box('rectangle'), px(100, 300), plot)).toBe('start')
    expect(hitOne(box('rectangle'), px(300, 100), plot)).toBe('end')
  })

  it('hits inside an ellipse but not in the corner it does not fill', () => {
    /*
     * The distinction a bounding-box test would lose: the corner of the
     * enclosing box is outside the ellipse drawn in it.
     */
    expect(hitOne(box('ellipse'), px(200, 200), plot)).toBe('body')
    expect(hitOne(box('ellipse'), px(108, 292), plot)).toBeNull()
    /* ...while the same corner IS inside the rectangle. */
    expect(hitOne(box('rectangle'), px(108, 292), plot)).toBe('body')
  })
})

describe('a fibonacci is hit on any of its levels', () => {
  const fib = {
    id: 'f', type: 'fibonacci', style: S,
    startTime: 1100, startPrice: 400, // x=100, y=100
    endTime: 1300, endPrice: 300,     // x=300, y=200
    levels: [...DEFAULT_FIBONACCI_LEVELS],
  } as Annotation

  it('hits the 0.5 level, which sits between the anchors', () => {
    /* y from 100 to 200, so 0.5 is y=150. */
    expect(hitOne(fib, px(200, 150), plot)).toBe('body')
  })

  it('hits the 0.618 level', () => {
    expect(hitOne(fib, px(200, 100 + 0.618 * 100), plot)).toBe('body')
  })

  it('misses between two levels', () => {
    /* 0.5 is at y=150 and 0.618 at y=161.8; y=156 clears both by >6px?
       No -- so pick a genuine gap: between 0 (y=100) and 0.236 (y=123.6). */
    expect(hitOne(fib, px(200, 112), plot)).toBeNull()
  })

  it('misses outside the time span even on a level', () => {
    /* A retracement is drawn only between its anchors. */
    expect(hitOne(fib, px(600, 150), plot)).toBeNull()
  })
})

describe('choosing between overlapping marks', () => {
  it('picks the LAST drawn, which is the one on top', () => {
    /*
     * `AnnotationRenderer` paints the array in order, so the final element
     * is the one the reader can actually see at an overlap. Picking the
     * first would hand them a buried mark.
     */
    const under = line({ id: 'under' })
    const over = line({ id: 'over' })
    expect(hitTest([under, over], px(200, 200), plot)?.id).toBe('over')
  })

  it('skips a locked mark', () => {
    const locked = line({ id: 'locked', locked: true })
    const free = line({ id: 'free' })
    expect(hitTest([free, locked], px(200, 200), plot)?.id).toBe('free')
    expect(hitTest([locked], px(200, 200), plot)).toBeNull()
  })

  it('skips an invisible mark', () => {
    /* Selecting something that cannot be seen would move a mark the reader
       has no way to watch. */
    expect(hitTest([line({ visible: false })], px(200, 200), plot)).toBeNull()
  })

  it('returns null on empty space', () => {
    expect(hitTest([line()], px(800, 50), plot)).toBeNull()
    expect(hitTest([], px(200, 200), plot)).toBeNull()
  })
})

describe('the distance primitives', () => {
  it('measures perpendicular distance to a segment', () => {
    expect(distanceToSegment(px(0, 10), px(0, 0), px(100, 0))).toBeCloseTo(10, 10)
    expect(distanceToSegment(px(50, 10), px(0, 0), px(100, 0))).toBeCloseTo(10, 10)
  })

  it('clamps a segment at both ends', () => {
    /* Beyond the end, the nearest point IS the end: distance from (110,0)
       to the segment ending at (100,0) is 10, not 0. */
    expect(distanceToSegment(px(110, 0), px(0, 0), px(100, 0))).toBeCloseTo(10, 10)
    expect(distanceToSegment(px(-10, 0), px(0, 0), px(100, 0))).toBeCloseTo(10, 10)
  })

  it('clamps a ray at its origin only', () => {
    expect(distanceToRay(px(110, 0), px(0, 0), px(100, 0))).toBeCloseTo(0, 10)
    expect(distanceToRay(px(-10, 0), px(0, 0), px(100, 0))).toBeCloseTo(10, 10)
  })

  it('treats a degenerate segment as a point instead of dividing by zero', () => {
    /*
     * Without the guard this is 0/0: every comparison against the tolerance
     * then reads false, and a zero-length mark becomes silently
     * unselectable -- impossible to remove except by clearing the panel.
     */
    const d = distanceToSegment(px(3, 4), px(0, 0), px(0, 0))
    expect(Number.isNaN(d)).toBe(false)
    expect(d).toBeCloseTo(5, 10)
  })
})

describe('the tolerances', () => {
  it('gives a handle more reach than a body, so it wins a tie', () => {
    expect(HANDLE_TOLERANCE).toBeGreaterThan(BODY_TOLERANCE)
  })
})
