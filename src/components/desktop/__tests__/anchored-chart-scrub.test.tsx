/**
 * A chart that answers to the pointer says so, and names what it shows.
 *
 * ── What was reported ─────────────────────────────────────────────────────
 *
 * "In the asset workspace, im seeing some charts that are not interactive
 * like in a research tile."
 *
 * MEASURED: the chart WAS interactive. It has scrubbed on `pointermove` since
 * it landed. The only sign of it was `cursor-crosshair`, which a reader sees
 * after they are already over the line and never while deciding whether to
 * try, and the rail's charts beside it carry a visible `5D 1M 3M ALL` and so
 * read as controls. The 427px workspace chart read as a picture.
 *
 * ── Two defects, not one ──────────────────────────────────────────────────
 *
 * 1. NO AFFORDANCE. Fixed with a hint that states what this chart actually
 *    does, and that goes quiet once the reader is doing it.
 *
 *    NOT a range selector. This window is anchored at a review date and
 *    changing its range would destroy the claim the chart makes, which is
 *    why it never had one and should not get one.
 *
 * 2. THE SCRUB NAMED NO DAY. The readout moved a real price under the
 *    pointer and the line beside it kept saying "from <anchor>", so the
 *    reader saw a number they could not place. `AnchoredWindow` carried only
 *    `from` and `to`, and the per-point dates were thrown away at the slice.
 *
 *    A date interpolated between the ends is NOT available: these are trading
 *    days, unevenly spaced across weekends and holidays, so an index-derived
 *    date would be a figure with no source. The window now carries the dates
 *    it already had in hand.
 *
 * ── GATES, each proven by injecting its own defect ────────────────────────
 *
 * - hint rendered unconditionally -> `withdraws the hint` and `brings it
 *   back` fail
 * - readout reverted to the anchor phrase -> `names the trading day the
 *   series holds` fails
 * - `dates` interpolated evenly between `from` and `to` instead of carried
 *   -> three cases fail, including the readout naming Oct 3, a Saturday
 */
import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { AnchoredPriceChart } from '../AnchoredPriceChart'
import { anchoredWindow } from '../../../lib/market-data/anchored-window'

/** Trading days: note the weekend gap, which is why no date is derivable. */
const HISTORY = [
  { date: '2026-10-01', close: 100 },
  { date: '2026-10-02', close: 104 },
  { date: '2026-10-05', close: 110 },
  { date: '2026-10-06', close: 108 },
]

const draw = () => {
  const w = anchoredWindow(HISTORY, '2026-10-01')!
  const { container } = render(
    <AnchoredPriceChart
      w={w}
      caption="Price since your review"
      meta="4d"
      anchorTick="reviewed"
      testId="chart"
      readoutTestId="readout"
    />,
  )
  const svg = container.querySelector('svg')!
  return { container, w, svg }
}

/**
 * Put a pointer on the plot, which takes two things jsdom does not give.
 *
 * 1. A BOX WITH WIDTH. `indexAtClientX` returns null on a zero-width box by
 *    design, documented in `scrub.ts`: a chart that snapped to index 0 there
 *    would read out a year-old price as the one under the finger. jsdom
 *    performs no layout, so every rect is zero-wide and the real guard fires.
 *    Stubbing the rect on this one element is what lets the scrub be tested
 *    at all; the arithmetic itself is `scrub.test.ts`'s concern.
 *
 * 2. `pointerType: 'mouse'`. The chart ignores touch deliberately -- a finger
 *    on a plot is a scroll, not a scrub -- and `fireEvent.pointerMove` sends
 *    no pointer type, so the guard rejected every move. My first draft of
 *    these cases asserted against a pointer that never landed.
 */
const PLOT = { left: 0, width: 400 }
const scrub = (svg: SVGSVGElement, clientX: number) => {
  svg.getBoundingClientRect = () => ({
    left: PLOT.left, width: PLOT.width, right: PLOT.width, top: 0, bottom: 166,
    height: 166, x: PLOT.left, y: 0, toJSON: () => ({}),
  }) as DOMRect
  fireEvent.pointerMove(svg, { clientX, pointerType: 'mouse' })
}

describe('the window carries the day of every close', () => {
  it('pairs each date with its own price, in order', () => {
    const w = anchoredWindow(HISTORY, '2026-10-01')!
    expect(w.dates).toEqual(['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06'])
    expect(w.dates).toHaveLength(w.series.length)
  })

  /**
   * THE anti-vacuity case. The gap between Oct 2 and Oct 5 is a weekend, so
   * index 2 of four evenly spaced points would land on Oct 3 and be wrong.
   * This is what forbids deriving the date rather than carrying it.
   */
  it('keeps the real trading days, which are not evenly spaced', () => {
    const w = anchoredWindow(HISTORY, '2026-10-01')!
    const gap = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000
    expect(gap(w.dates[1], w.dates[2])).toBe(3)
    expect(gap(w.dates[0], w.dates[1])).toBe(1)
  })

  it('slices the dates with the series when the window is anchored later', () => {
    const w = anchoredWindow(HISTORY, '2026-10-05')!
    expect(w.dates).toEqual(['2026-10-05', '2026-10-06'])
    expect(w.series).toEqual([110, 108])
  })
})

describe('the chart says it can be scrubbed, then stops saying it', () => {
  /** THE case for the affordance. */
  it('shows the hint before the reader touches it', () => {
    const { container } = draw()
    expect(container.querySelector('[data-chart-scrub-hint]')).toBeTruthy()
  })

  it('withdraws the hint while the reader is scrubbing', () => {
    const { container, svg } = draw()
    scrub(svg, 200)
    expect(container.querySelector('[data-chart-scrub-hint]')).toBeNull()
  })

  it('brings it back when the pointer leaves', () => {
    const { container, svg } = draw()
    scrub(svg, 200)
    expect(container.querySelector('[data-chart-scrub-hint]')).toBeNull()
    fireEvent.pointerLeave(svg)
    expect(container.querySelector('[data-chart-scrub-hint]')).toBeTruthy()
  })

  /**
   * The touch case, asserted so the hint is never made to lie. A finger on a
   * plot is a scroll gesture, the chart ignores it, and a hint that vanished
   * under a thumb would be reporting a scrub that is not happening.
   */
  it('keeps the hint under a touch, which does not scrub', () => {
    const { container, svg } = draw()
    svg.getBoundingClientRect = () => ({
      left: 0, width: 400, right: 400, top: 0, bottom: 166,
      height: 166, x: 0, y: 0, toJSON: () => ({}),
    }) as DOMRect
    fireEvent.pointerMove(svg, { clientX: 200, pointerType: 'touch' })
    expect(container.querySelector('[data-chart-scrub-hint]')).toBeTruthy()
  })

  /**
   * NOT a range selector, asserted so one is never added here: the window is
   * anchored at a review and a reader who changed its range would be reading
   * a different claim from the one the caption makes.
   */
  it('offers no range control, because the window is anchored', () => {
    const { container } = draw()
    for (const label of ['5D', '1M', '3M', 'ALL']) {
      expect(container.textContent).not.toContain(label)
    }
  })
})

describe('the readout names the day it is showing', () => {
  it('states the anchor while nothing is picked', () => {
    const { container } = draw()
    expect(container.querySelector('[data-chart-readout-when]')?.textContent)
      .toContain('reviewed')
  })

  /**
   * THE case for defect 2, and the reason the dates had to be carried.
   *
   * Halfway across a 400px box over four closes picks index 2, whose real
   * trading day is Oct 5. Oct 1 to Oct 6 split evenly at the halfway point
   * would read Oct 3 or Oct 4 -- the weekend -- so this asserts the readout
   * is naming the date the series HOLDS and not one derived from the span.
   *
   * The expected string is built with the component's own formatter because
   * the claim under test is WHICH day, not how a locale prints it.
   */
  const asDay = (iso: string) =>
    new Date(Date.parse(iso))
      .toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

  it('names the trading day the series holds, not one split from the span', () => {
    const { container, svg } = draw()
    scrub(svg, 200)
    const when = container.querySelector('[data-chart-readout-when]')?.textContent ?? ''
    expect(when).not.toContain('reviewed')
    expect(when).toBe(asDay('2026-10-05'))
    for (const weekend of ['2026-10-03', '2026-10-04']) {
      expect(when).not.toBe(asDay(weekend))
    }
  })

  it('returns to the anchor when the pointer leaves', () => {
    const { container, svg } = draw()
    scrub(svg, 200)
    fireEvent.pointerLeave(svg)
    expect(container.querySelector('[data-chart-readout-when]')?.textContent)
      .toContain('reviewed')
  })

  /**
   * A window that never reached its anchor must not grow a claim it refused.
   * The axis says "over the window shown"; the readout has to agree with it.
   */
  it('refuses the anchor phrase on a window that does not reach it', () => {
    const w = anchoredWindow(HISTORY, '2026-09-01')!
    expect(w.reachesAnchor).toBe(false)
    const { container } = render(
      <AnchoredPriceChart w={w} caption="Price over available history" meta="5d"
        anchorTick="reviewed" />,
    )
    expect(container.querySelector('[data-chart-readout-when]')?.textContent)
      .not.toContain('reviewed')
  })
})
