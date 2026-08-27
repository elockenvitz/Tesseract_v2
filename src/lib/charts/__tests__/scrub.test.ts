import { describe, expect, it } from 'vitest'

import { clampPercent, edgeAlignedTranslate, indexAtClientX } from '../scrub'

/**
 * The wrong-dot arithmetic, tested where it is cheap to test.
 *
 * Every one of these cases is one a browser makes awkward to reach and a chart
 * hits in production: a plot with no width because it is offscreen, a pointer
 * dragged past the edge, a series with a single close.
 */
describe('indexAtClientX', () => {
  const box = { left: 100, width: 300 }

  it('maps the left edge to the first point and the right edge to the last', () => {
    expect(indexAtClientX(100, box, 10)).toBe(0)
    expect(indexAtClientX(400, box, 10)).toBe(9)
  })

  it('maps the midpoint to the middle of the series', () => {
    // Ten points across 300px: the midpoint rounds to index 4 or 5, and either
    // is a real close. What matters is that it is neither end.
    const mid = indexAtClientX(250, box, 10)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(9)
  })

  it('holds the end point when the pointer is dragged past the plot', () => {
    // A finger that leaves the chart sideways must keep the last point, not
    // run off into a negative index and drop the crosshair.
    expect(indexAtClientX(-500, box, 10)).toBe(0)
    expect(indexAtClientX(5_000, box, 10)).toBe(9)
  })

  it('refuses a box with no width rather than snapping to the first close', () => {
    // Every element in jsdom, and any plot that is display:none or not yet
    // laid out. Returning 0 here would read out a price from the start of the
    // window as if it were the one under the finger.
    expect(indexAtClientX(200, { left: 0, width: 0 }, 10)).toBeNull()
  })

  it('refuses a series too short to have a second point', () => {
    expect(indexAtClientX(200, box, 1)).toBeNull()
    expect(indexAtClientX(200, box, 0)).toBeNull()
  })

  it('refuses a non-finite position instead of producing NaN', () => {
    // An x of NaN renders the crosshair at x="NaN", which drops it silently.
    expect(indexAtClientX(Number.NaN, box, 10)).toBeNull()
  })
})

describe('clampPercent', () => {
  it('keeps a label inside the plot it annotates', () => {
    expect(clampPercent(0, 14, 86)).toBe(14)
    expect(clampPercent(100, 14, 86)).toBe(86)
    expect(clampPercent(50, 14, 86)).toBe(50)
  })

  it('falls back to the lower bound rather than emitting NaN', () => {
    expect(clampPercent(Number.NaN, 14, 86)).toBe(14)
  })
})

describe('edgeAlignedTranslate', () => {
  it('tucks the marker fully inside at both extremes', () => {
    // The default read-out of a price chart is the LAST close, at 100%. A
    // centred dot there is half outside the plot and clipped into something
    // that reads as a rendering fault.
    expect(edgeAlignedTranslate(100)).toBe('-100%')
    expect(edgeAlignedTranslate(0)).toBe('0')
  })

  it('centres it everywhere else', () => {
    expect(edgeAlignedTranslate(50)).toBe('-50%')
  })
})
