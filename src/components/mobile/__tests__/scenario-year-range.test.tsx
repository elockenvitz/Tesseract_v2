/**
 * The 52-week marks, and the window they are allowed to claim.
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 *
 * There is no 52-week column anywhere in the database -- checked across
 * `information_schema` for `%52%`, `%week_high%`, `%week_low%` and
 * `%fifty_two%`, and the answer was nothing. The figure is DERIVED, from
 * `price_history_cache`, which is a cache: queried on 2026-10-28, the
 * deepest symbol (AAPL) held 361 closes ending 2026-10-01, and most symbols
 * held far fewer.
 *
 * So the risk this file exists for is not a layout bug. It is a number with
 * the words "52-week high" under it that was computed over eight months of
 * closes ending a month ago. That is a provenance failure, and in this
 * codebase a figure that cannot be traced to what produced it does not get
 * surfaced.
 *
 * `fitsTheLabel` is the gate, and what follows is the proof it closes on
 * each of its three reasons independently -- a gate that only ever fires on
 * one of its terms is three-quarters decoration.
 *
 * GEOMETRY is not asserted: jsdom performs no layout. The positions were
 * measured in the running app.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ExploreVisualBlock } from '../ExploreVisual'
import { fitsTheLabel, type YearRange } from '../../../lib/market-data/daily-closes'
import type { ExploreVisual } from '../../../lib/mobile/explore-visual'

const NOW = Date.UTC(2026, 9, 28)   // 2026-10-28
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString().slice(0, 10)

/** A window that passes every term, so each failure below is one variable. */
const GOOD: YearRange = {
  low: 199, high: 284, from: day(360), to: day(3), points: 250,
}

describe('a window may only be called 52 week when it is one', () => {
  it('accepts a full, dense, current year', () => {
    expect(fitsTheLabel(GOOD, NOW)).toBe(true)
  })

  it.each([
    ['a half year of span', { ...GOOD, from: day(200) }],
    ['a sparse year', { ...GOOD, points: 40 }],
    ['a year that stopped four months ago', { ...GOOD, to: day(120) }],
    ['a flat window with no extremes', { ...GOOD, low: 199, high: 199 }],
    ['an unparseable date', { ...GOOD, from: 'not-a-date' }],
  ])('rejects %s', (_why, y) => {
    expect(fitsTheLabel(y as YearRange, NOW)).toBe(false)
  })

  /* Each term alone. A gate that passes because one clause is doing all the
     work would survive the cases above if they overlapped. */
  it('closes on span, density and staleness independently', () => {
    /* Span is measured `to - from`, and `GOOD.to` is day(3), so the
       boundary sits at day(302)/day(303) rather than at day(300). */
    expect(fitsTheLabel({ ...GOOD, from: day(302) }, NOW)).toBe(false)
    expect(fitsTheLabel({ ...GOOD, from: day(303) }, NOW)).toBe(true)
    expect(fitsTheLabel({ ...GOOD, points: 179 }, NOW)).toBe(false)
    expect(fitsTheLabel({ ...GOOD, points: 180 }, NOW)).toBe(true)
    expect(fitsTheLabel({ ...GOOD, to: day(46) }, NOW)).toBe(false)
    expect(fitsTheLabel({ ...GOOD, to: day(45) }, NOW)).toBe(true)
  })
})

const RANGE: ExploreVisual = {
  kind: 'scenario_range',
  low: 220, high: 260, current: 275,
  cases: [{ label: 'Bear', price: 220 }, { label: 'Bull', price: 260 }],
}

const draw = (year: YearRange | null, fill = true) =>
  render(<ExploreVisualBlock visual={RANGE} density="tile" fill={fill} year={year} now={NOW} />).container

describe('the axis draws the year only when it has earned the label', () => {
  it('draws the span, both end marks and both labels for a good window', () => {
    const c = draw(GOOD)
    expect(c.querySelector('[data-scenario-year]')).toBeTruthy()
    expect(c.querySelectorAll('[data-scenario-year-mark]')).toHaveLength(2)
    expect([...c.querySelectorAll('[data-scenario-year-label]')].map(e => e.textContent))
      .toEqual(['52w low $199', '52w high $284'])
  })

  it('names the window it actually used, on the mark itself', () => {
    /* The number is derived and the source is a cache. A reader who wants to
       know what produced it should not have to ask. */
    const title = draw(GOOD).querySelector('[data-scenario-year-label]')?.getAttribute('title')
    expect(title).toContain(GOOD.from)
    expect(title).toContain(GOOD.to)
  })

  it('draws nothing at all when the window cannot carry the words', () => {
    const c = draw({ ...GOOD, points: 40 })
    expect(c.querySelector('[data-scenario-year]')).toBeNull()
    expect(c.querySelector('[data-scenario-year-label]')).toBeNull()
    /* And the card is still a card -- the axis it drew before is intact. */
    expect(c.querySelector('[data-scenario-band]')).toBeTruthy()
    expect(c.querySelector('[data-scenario-current]')).toBeTruthy()
  })

  it('draws nothing on a phone, where four more marks do not fit', () => {
    const c = draw(GOOD, false)
    expect(c.querySelector('[data-scenario-year]')).toBeNull()
  })
})

describe('the scale opens to hold the year rather than clamping it', () => {
  /*
   * The modelled range is the scale, padded a third at each end, and a mark
   * outside it is clamped to 2%/98% so a breach still lands on the card.
   *
   * That clamp is right for the LAST PRICE -- a marker pinned past the end
   * of the band is the finding. It is wrong for the year: a 52-week high
   * clamped to the right edge says "the high is right here" when it is
   * somewhere off the picture, which is a false statement about a real
   * number rather than a compressed true one.
   */
  it('places the year inside the drawing, not pinned to its edge', () => {
    const wide: YearRange = { ...GOOD, low: 120, high: 400 }
    const c = draw(wide)
    const marks = [...c.querySelectorAll('[data-scenario-year-mark]')] as HTMLElement[]
    const left = marks.map(m => parseFloat(m.style.left))
    /* Not at the clamp rails. The domain opened; it did not squash. */
    expect(left[0]).toBeGreaterThan(0)
    expect(left[0]).toBeLessThan(12)
    expect(left[1]).toBeGreaterThan(88)
    expect(left[1]).toBeLessThan(100)
    /* And the cases are still inside it, in order. */
    const cases = [...c.querySelectorAll('[data-scenario-case]')]
      .map(e => parseFloat((e.parentElement as HTMLElement).style.left))
    expect(cases[0]).toBeLessThan(cases[1])
    expect(cases[0]).toBeGreaterThan(left[0])
    expect(cases[1]).toBeLessThan(left[1])
  })

  it('leaves the modelled scale alone when there is no year to hold', () => {
    /* The breach must still read as a breach: with no year, the last price
       at 275 against a 220-260 band is past the end and clamps to 98%. */
    const c = draw(null)
    const cur = c.querySelector('[data-scenario-current]')!.closest('button') as HTMLElement
    expect(parseFloat(cur.style.left)).toBe(98)
  })
})
