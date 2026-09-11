/**
 * The chart's claims, not its pixels.
 *
 * Three of these are statements about a security — where the scale sits, when a
 * target was crossed, how long the window is — and a wrong one is a false claim
 * on a card, not a cosmetic defect.
 */

import { describe, it, expect } from 'vitest'
import {
  axisDateLabel, axisTickIndices, changePct, firstCrossing, periodLabel, priceScale,
} from '../price-chart'

const at = (...closes: number[]) =>
  closes.map((close, i) => ({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, close }))

describe('priceScale', () => {
  it('pads the closes so the line never runs along the frame', () => {
    const s = priceScale([100, 120], null)
    expect(s.low).toBe(100)
    expect(s.high).toBe(120)
    expect(s.lo).toBeLessThan(100)
    expect(s.hi).toBeGreaterThan(120)
  })

  /** A nearby target belongs on the axis — the whole point is the distance. */
  it('takes a nearby reference into the scale', () => {
    const s = priceScale([100, 120], 130)
    expect(s.referenceInScale).toBe(true)
    expect(s.hi).toBeGreaterThan(130)
    expect(s.referenceSide).toBeNull()
  })

  /**
   * The defect this pins. A stale target three times the price used to join the
   * domain and squash a year of movement into a horizontal line — the card
   * about a distant target destroying the evidence for it.
   */
  it('leaves a distant reference off the scale rather than flattening the series', () => {
    const s = priceScale([100, 120], 400)
    expect(s.referenceInScale).toBe(false)
    expect(s.referenceSide).toBe('above')
    // The drawn box is still about the prices: the 20-point span keeps most of it.
    expect(s.hi - s.lo).toBeLessThan(30)
  })

  it('marks a distant reference below the series as below', () => {
    const s = priceScale([100, 120], 10)
    expect(s.referenceInScale).toBe(false)
    expect(s.referenceSide).toBe('below')
  })

  it('gives a flat series a span to draw in', () => {
    const s = priceScale([50, 50, 50], null)
    expect(s.hi).toBeGreaterThan(s.lo)
  })
})

describe('firstCrossing', () => {
  it('finds the first pass through the reference and says which way', () => {
    const c = firstCrossing(at(90, 95, 105, 130), 100)
    expect(c).toEqual({ index: 2, date: '2026-01-03', direction: 'up' })
  })

  it('reads a fall through the reference as a downward crossing', () => {
    const c = firstCrossing(at(130, 120, 90), 100)
    expect(c?.direction).toBe('down')
    expect(c?.index).toBe(2)
  })

  /**
   * The claim this refuses to invent. A window that opens past its target
   * crossed it before the data starts, and this function cannot know when.
   */
  it('reports nothing when the window opens already beyond the reference', () => {
    expect(firstCrossing(at(130, 140, 150), 100)).toBeNull()
  })

  it('reports nothing without a reference', () => {
    expect(firstCrossing(at(90, 110), null)).toBeNull()
  })

  /** Only the FIRST one: a marker per oscillation is noise, not an event. */
  it('reports only the first crossing when the price oscillates', () => {
    expect(firstCrossing(at(90, 110, 90, 110), 100)?.index).toBe(1)
  })

  /**
   * A close sitting exactly ON the level is not a side, so the baseline is the
   * first close that has one. A window that opens at the target and leaves it
   * has no side to have crossed FROM, and reports nothing rather than calling
   * the departure an event.
   */
  it('takes the opening side from the first close that has one', () => {
    expect(firstCrossing(at(100, 100, 90), 100)).toBeNull()
    expect(firstCrossing(at(100, 100, 90, 110), 100)?.index).toBe(3)
  })
})

describe('periodLabel', () => {
  it('names the window from its own dates', () => {
    // 60 trading closes is what the feed fetches, and lands near three months.
    expect(periodLabel('2026-01-02', '2026-03-30')).toBe('3M')
    expect(periodLabel('2025-04-01', '2026-03-30')).toBe('1Y')
    expect(periodLabel('2026-03-01', '2026-03-15')).toBe('14D')
  })

  it('says nothing for a window with no length', () => {
    expect(periodLabel('2026-03-01', '2026-03-01')).toBe('')
  })
})

describe('axisTickIndices', () => {
  it('spaces four ticks across the series, ends included', () => {
    expect(axisTickIndices(60)).toEqual([0, 20, 39, 59])
  })

  it('does not repeat an index on a short series', () => {
    expect(axisTickIndices(3)).toEqual([0, 1, 2])
  })
})

describe('changePct', () => {
  it('states the change between two prices', () => {
    expect(changePct(100, 118.4)).toBeCloseTo(18.4, 5)
  })

  it('refuses to divide by a price that is not one', () => {
    expect(changePct(0, 10)).toBeNull()
  })
})

describe('axisDateLabel', () => {
  /** Trading DAYS: rendering them in the reader's zone slides one back a day. */
  it('reads a date as the day it is, not the reader s timezone', () => {
    expect(axisDateLabel('2026-01-01', 90)).toBe('Jan 1')
  })

  it('drops the day on a multi-year window', () => {
    expect(axisDateLabel('2026-01-01', 400)).toBe('Jan 26')
  })
})
