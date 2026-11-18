/**
 * A mark goes where it was drawn.
 *
 * The defect under test: `ChartingPage.createAnnotation` derived the second
 * point from the first by arithmetic, so every trend line was 30 days long
 * and +5%, every rectangle 30 days by -5%, every fibonacci 60 days by -20%.
 * These cases assert the two points the analyst indicated survive, and that
 * the places where order carries meaning keep it.
 */
import { describe, expect, it } from 'vitest'
import {
  annotationFromPoints,
  isDrag,
  isTwoPointTool,
  MIN_DRAG_PIXELS,
  moveAnnotation,
  normalizeSpan,
  POINTS_REQUIRED,
  reshapeAnnotation,
  settleAnnotation,
  type ChartPoint,
} from '../annotation-geometry'
import {
  DEFAULT_ANNOTATION_STYLE,
  DEFAULT_FIBONACCI_LEVELS,
  type AnnotationType,
} from '../../../components/charting/engine/annotations'

const S = DEFAULT_ANNOTATION_STYLE
/* Two points a human would plausibly drag between: six weeks apart, down 12%. */
const A: ChartPoint = { time: 1_762_000_000, price: 243.5 }
const B: ChartPoint = { time: 1_765_600_000, price: 214.28 }

const build = (type: AnnotationType, from = A, to = B) =>
  annotationFromPoints(type, from, to, S, 'ann-1')

const ALL_TYPES: AnnotationType[] = [
  'horizontal-line', 'vertical-line', 'trend-line', 'ray',
  'rectangle', 'ellipse', 'fibonacci', 'text', 'arrow',
]

describe('the drawn points are the points kept', () => {
  it.each(['trend-line', 'ray', 'arrow'] as const)(
    'gives a %s exactly the two ends it was dragged between',
    type => {
      const a = build(type) as unknown as Record<string, number>
      expect(a.startTime).toBe(A.time)
      expect(a.startPrice).toBe(A.price)
      expect(a.endTime).toBe(B.time)
      expect(a.endPrice).toBe(B.price)
    },
  )

  it('no longer invents a 30-day, +5% end point', () => {
    /*
     * The exact arithmetic of the old code, asserted as absent. Were someone
     * to reintroduce a derived end point, this is the shape it would take.
     */
    const a = build('trend-line') as unknown as Record<string, number>
    expect(a.endTime).not.toBe(A.time + 86_400 * 30)
    expect(a.endPrice).not.toBeCloseTo(A.price * 1.05, 6)
  })

  it('draws a downward trend line as downward', () => {
    /* The old code could only ever produce a rising line. */
    const a = build('trend-line') as unknown as Record<string, number>
    expect(a.endPrice).toBeLessThan(a.startPrice)
  })
})

describe('order carries meaning for a ray, and none for a box', () => {
  it('keeps a right-to-left ray aimed into the past', () => {
    /*
     * A ray extends beyond its SECOND point, so reversing the drag reverses
     * where it projects. Sorting the span would silently turn a ray aimed at
     * history into one aimed at the future.
     */
    const a = build('ray', B, A) as unknown as Record<string, number>
    expect(a.startTime).toBe(B.time)
    expect(a.endTime).toBe(A.time)
  })

  it.each(['rectangle', 'ellipse'] as const)(
    'makes a %s drawn in any direction compare equal',
    type => {
      const downRight = build(type, A, B)
      const upLeft = build(type, B, A)
      expect(downRight).toEqual(upLeft)
    },
  )

  it('orders a box lower-left to upper-right', () => {
    const a = build('rectangle') as unknown as Record<string, number>
    expect(a.startTime).toBeLessThan(a.endTime)
    expect(a.startPrice).toBeLessThan(a.endPrice)
  })
})

describe('a fibonacci keeps its anchors but tidies its direction', () => {
  it('leaves a retracement measuring a decline', () => {
    /*
     * Level 0 sits at the first price picked and 1 at the second. Flipping
     * the prices would turn a measured decline into a measured rally, which
     * is the opposite claim.
     */
    const a = build('fibonacci') as unknown as Record<string, number>
    expect(a.startPrice).toBe(A.price)
    expect(a.endPrice).toBe(B.price)
    expect(a.startPrice).toBeGreaterThan(a.endPrice)
  })

  it('still reads left to right when drawn right to left', () => {
    const a = build('fibonacci', B, A) as unknown as Record<string, number>
    expect(a.startTime).toBe(A.time)
    expect(a.endTime).toBe(B.time)
    /* ...while the price anchors stay in the drawn order. */
    expect(a.startPrice).toBe(B.price)
    expect(a.endPrice).toBe(A.price)
  })

  it('carries the default levels, by value not by reference', () => {
    const a = build('fibonacci') as { levels: number[] }
    expect(a.levels).toEqual(DEFAULT_FIBONACCI_LEVELS)
    /* A shared array would let one mark's edit rewrite every other mark. */
    expect(a.levels).not.toBe(DEFAULT_FIBONACCI_LEVELS)
  })
})

describe('one-point marks take only the point they need', () => {
  it('puts a horizontal line at the price and ignores the second point', () => {
    const a = build('horizontal-line') as unknown as Record<string, unknown>
    expect(a.price).toBe(A.price)
    expect(a.time).toBeUndefined()
    expect(a.endPrice).toBeUndefined()
  })

  it('puts a vertical line at the time', () => {
    const a = build('vertical-line') as unknown as Record<string, unknown>
    expect(a.time).toBe(A.time)
    expect(a.price).toBeUndefined()
  })

  it('does not bake a dollar label into a horizontal line', () => {
    /*
     * The old code set `label: `$${price.toFixed(2)}``, which hardcodes a
     * currency the asset may not quote in -- a pence-quoted holding got a
     * dollar sign on a hundredfold-wrong number -- and freezes a figure the
     * renderer can read off `price` itself.
     */
    const a = build('horizontal-line') as unknown as Record<string, unknown>
    expect(a.label).toBeUndefined()
    expect(JSON.stringify(a)).not.toContain('$')
  })

  it('starts a text note empty rather than with the word "Note"', () => {
    /*
     * A placeholder that is real content means an accidental click leaves a
     * mark reading "Note" on the chart, indistinguishable from a deliberate
     * one. Empty is a state the surface can treat as unfinished.
     */
    const a = build('text') as { text: string }
    expect(a.text).toBe('')
  })
})

describe('the shape of the tool table', () => {
  it('classifies every annotation type', () => {
    /* A type absent from the table reads as undefined, which is neither 1
       nor 2, and the surface would then never start a drag for it. */
    for (const type of ALL_TYPES) {
      expect(POINTS_REQUIRED[type], type).toBeGreaterThanOrEqual(1)
      expect(POINTS_REQUIRED[type], type).toBeLessThanOrEqual(2)
    }
    expect(Object.keys(POINTS_REQUIRED).sort()).toEqual([...ALL_TYPES].sort())
  })

  it('agrees with isTwoPointTool', () => {
    for (const type of ALL_TYPES) {
      expect(isTwoPointTool(type), type).toBe(POINTS_REQUIRED[type] === 2)
    }
  })

  it('builds something for every type it claims to know', () => {
    /* The old default branch turned an unrecognised type into a horizontal
       line, putting an unasked-for price level on the chart. */
    for (const type of ALL_TYPES) {
      expect(build(type), type).not.toBeNull()
    }
    expect(annotationFromPoints('not-a-tool' as AnnotationType, A, B, S, 'x')).toBeNull()
  })

  it('uses the id it was given and never generates one', () => {
    expect(build('trend-line')!.id).toBe('ann-1')
  })
})

describe('a click is not a drag', () => {
  it('rejects a wobble below the floor', () => {
    expect(isDrag({ x: 100, y: 100 }, { x: 102, y: 101 })).toBe(false)
  })

  it('accepts a movement at the floor, on either axis alone', () => {
    const p = { x: 100, y: 100 }
    expect(isDrag(p, { x: 100 + MIN_DRAG_PIXELS, y: 100 })).toBe(true)
    expect(isDrag(p, { x: 100, y: 100 + MIN_DRAG_PIXELS })).toBe(true)
  })

  it('measures distance in both directions', () => {
    const p = { x: 100, y: 100 }
    expect(isDrag(p, { x: 100 - MIN_DRAG_PIXELS, y: 100 })).toBe(true)
    expect(isDrag(p, { x: 100, y: 100 - MIN_DRAG_PIXELS })).toBe(true)
  })

  it('treats a horizontal and a diagonal wobble of the same size alike', () => {
    /* Chebyshev, not Euclidean: 3px across and 3px diagonally are both
       under a 4px floor, where a Euclidean test would pass the diagonal. */
    const p = { x: 0, y: 0 }
    expect(isDrag(p, { x: 3, y: 0 })).toBe(false)
    expect(isDrag(p, { x: 3, y: 3 })).toBe(false)
  })
})

describe('normalizeSpan', () => {
  it('is idempotent', () => {
    const once = normalizeSpan(A, B)
    const twice = normalizeSpan(
      { time: once.startTime, price: once.startPrice },
      { time: once.endTime, price: once.endPrice },
    )
    expect(twice).toEqual(once)
  })

  it('survives a zero-extent span without inverting it', () => {
    const s = normalizeSpan(A, A)
    expect(s.startTime).toBe(s.endTime)
    expect(s.startPrice).toBe(s.endPrice)
  })
})

describe('moving a mark', () => {
  it('shifts both ends of a line by the same delta, preserving its slope', () => {
    const before = build('trend-line')!
    const after = moveAnnotation(before, 100, -5) as unknown as Record<string, number>
    const b = before as unknown as Record<string, number>
    expect(after.startTime).toBe(b.startTime + 100)
    expect(after.endTime).toBe(b.endTime + 100)
    expect(after.startPrice).toBe(b.startPrice - 5)
    expect(after.endPrice).toBe(b.endPrice - 5)
    /* The claim the mark makes about the shape of the move is unchanged. */
    expect(after.endPrice - after.startPrice).toBeCloseTo(b.endPrice - b.startPrice, 10)
    expect(after.endTime - after.startTime).toBe(b.endTime - b.startTime)
  })

  it('moves a horizontal line in price only', () => {
    /*
     * A price level has no horizontal position to change. Requiring the
     * time delta to be zero before moving it would turn a diagonal drag
     * into no movement at all.
     */
    const a = moveAnnotation(build('horizontal-line')!, 999_999, 10) as unknown as Record<string, number>
    expect(a.price).toBe(A.price + 10)
    expect(a.time).toBeUndefined()
  })

  it('moves a vertical line in time only', () => {
    const a = moveAnnotation(build('vertical-line')!, 60, 999) as unknown as Record<string, number>
    expect(a.time).toBe(A.time + 60)
    expect(a.price).toBeUndefined()
  })

  it('moves a text note on both axes', () => {
    const a = moveAnnotation(build('text')!, 60, 2) as unknown as Record<string, number>
    expect(a.time).toBe(A.time + 60)
    expect(a.price).toBe(A.price + 2)
  })

  it('does not mutate the mark it was given', () => {
    const before = build('trend-line')!
    const snapshot = JSON.stringify(before)
    moveAnnotation(before, 100, 100)
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('returns to the start after equal and opposite moves', () => {
    /*
     * Why the delta is in CHART space and not pixels: converting per frame
     * would accumulate each intermediate rounding, and a mark dragged in a
     * circle would not come home.
     */
    const before = build('trend-line')!
    const there = moveAnnotation(before, 500, 12.5)
    const back = moveAnnotation(there, -500, -12.5)
    expect(back).toEqual(before)
  })

  it('keeps a fibonacci ladder intact through a move', () => {
    const a = moveAnnotation(build('fibonacci')!, 60, 1) as unknown as { levels: number[] }
    expect(a.levels).toEqual(DEFAULT_FIBONACCI_LEVELS)
  })
})

describe('reshaping one end', () => {
  const T = { time: 1_770_000_000, price: 99 }

  it('moves the grabbed end and leaves the other alone', () => {
    const before = build('trend-line')!
    const b = before as unknown as Record<string, number>
    const a = reshapeAnnotation(before, 'end', T) as unknown as Record<string, number>
    expect(a.endTime).toBe(T.time)
    expect(a.endPrice).toBe(T.price)
    expect(a.startTime).toBe(b.startTime)
    expect(a.startPrice).toBe(b.startPrice)
  })

  it('reshapes by the mark\'s own start, not by whichever end looks left', () => {
    /*
     * A right-to-left ray has its `start` on the right. Grabbing `start`
     * must move the right-hand end, because that is the one the reader took
     * hold of.
     */
    const rtl = annotationFromPoints('ray', B, A, S, 'r')!
    const a = reshapeAnnotation(rtl, 'start', T) as unknown as Record<string, number>
    expect(a.startTime).toBe(T.time)
    expect(a.endTime).toBe(A.time)
  })

  it('leaves a one-point mark untouched rather than treating it as a move', () => {
    /* A caller that hit-tested a handle on a horizontal line has a bug;
       silently moving the line would hide it. */
    const h = build('horizontal-line')!
    expect(reshapeAnnotation(h, 'start', T)).toEqual(h)
  })

  it('allows a box to pass through an inverted state mid-drag', () => {
    /*
     * Normalising on every frame would flip the shape and then fight the
     * cursor. The caller settles it on release instead.
     */
    const box = build('rectangle')!
    const dragged = reshapeAnnotation(box, 'start', { time: 1_790_000_000, price: 900 })
    const d = dragged as unknown as Record<string, number>
    expect(d.startTime).toBeGreaterThan(d.endTime)
  })
})

describe('settling a mark on release', () => {
  it('normalises an inverted rectangle', () => {
    const inverted = reshapeAnnotation(build('rectangle')!, 'start', { time: 1_790_000_000, price: 900 })
    const settled = settleAnnotation(inverted) as unknown as Record<string, number>
    expect(settled.startTime).toBeLessThan(settled.endTime)
    expect(settled.startPrice).toBeLessThan(settled.endPrice)
  })

  it('leaves a line alone, because its direction is meaning', () => {
    const ray = annotationFromPoints('ray', B, A, S, 'r')!
    expect(settleAnnotation(ray)).toEqual(ray)
  })

  it('leaves a fibonacci alone, because its price anchors are meaning', () => {
    /* Sorting them would turn a measured decline into a measured rally. */
    const fib = build('fibonacci')!
    expect(settleAnnotation(fib)).toEqual(fib)
  })

  it('is idempotent on an already-settled box', () => {
    const once = settleAnnotation(build('rectangle')!)
    expect(settleAnnotation(once)).toEqual(once)
  })
})
