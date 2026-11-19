/**
 * A vertical pan may not throw the data off the chart.
 *
 * The defect these cover: one ordinary diagonal drag moved the price window
 * from roughly 300..550 to 950..1200 while every bar sat below 400, leaving
 * a blank chart and no clue which way the data had gone.
 */
import { describe, expect, it } from 'vitest'
import { MIN_VISIBLE_FRACTION, clampPriceWindow } from '../pan-bounds'

/* Bars between 300 and 400; a 250-high window, so the margin is 50. */
const DATA = { min: 300, max: 400 }
const H = 250
const MARGIN = H * MIN_VISIBLE_FRACTION

describe('a pan that still sees the data is left alone', () => {
  it('does not touch a window sitting over the bars', () => {
    const w = { min: 290, max: 540 }
    expect(clampPriceWindow(w, DATA)).toEqual(w)
  })

  it('allows panning right up to the limit', () => {
    const w = { min: DATA.max - MARGIN, max: DATA.max - MARGIN + H }
    expect(clampPriceWindow(w, DATA)).toEqual(w)
  })
})

describe('a pan that would lose the data is pulled back', () => {
  it('stops the window drifting above the bars', () => {
    /* The reported case: data under 400, window dragged to 950..1200. */
    const out = clampPriceWindow({ min: 950, max: 1200 }, DATA)
    expect(out.min).toBe(DATA.max - MARGIN)
    expect(out.max).toBe(DATA.max - MARGIN + H)
  })

  it('stops the window drifting below the bars', () => {
    const out = clampPriceWindow({ min: -900, max: -650 }, DATA)
    expect(out.max).toBe(DATA.min + MARGIN)
    expect(out.min).toBe(DATA.min + MARGIN - H)
  })

  it('shifts, never resizes: a pan must not become a zoom', () => {
    const out = clampPriceWindow({ min: 950, max: 1200 }, DATA)
    expect(out.max - out.min).toBe(H)
  })

  it('leaves at least the stated fraction of the window on data', () => {
    for (const w of [{ min: 950, max: 1200 }, { min: -900, max: -650 }]) {
      const out = clampPriceWindow(w, DATA)
      const overlap = Math.min(out.max, DATA.max) - Math.max(out.min, DATA.min)
      expect(overlap).toBeGreaterThanOrEqual(H * MIN_VISIBLE_FRACTION - 1e-9)
    }
  })
})

describe('it refuses to clamp against something it cannot measure', () => {
  it('passes the window through when there is no data extent', () => {
    const w = { min: 950, max: 1200 }
    expect(clampPriceWindow(w, { min: 400, max: 400 })).toEqual(w)
  })

  it('passes the window through when the extent is not finite', () => {
    const w = { min: 950, max: 1200 }
    expect(clampPriceWindow(w, { min: NaN, max: 400 })).toEqual(w)
    expect(clampPriceWindow(w, { min: 300, max: Infinity })).toEqual(w)
  })

  it('passes a degenerate window through rather than pinning it to a price', () => {
    const w = { min: 500, max: 500 }
    expect(clampPriceWindow(w, DATA)).toEqual(w)
  })
})
