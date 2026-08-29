import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ScenarioLadder } from '../ScenarioLadder'

/**
 * Market context on the framework's axis, and never mistakable for it.
 *
 * The card's claim is about the analyst's own cases. "The price is 29% above
 * your highest case" says nothing about whether that is remarkable — a name
 * whose bull case is $180 and which has traded $86–$242 this year has spent
 * months outside the ladder; one that has traded $170–$185 has just broken out.
 * The 52-week range is what tells those apart.
 *
 * What it must never do is read as two more scenarios. These pin the
 * distinction structurally rather than by looking at colours: the cases are
 * buttons with dots and a selection, the range is inert.
 */

const CASES = [
  { name: 'Bear', price: 90, probability: null, timeframe: '12 months' },
  { name: 'Base', price: 120, probability: null, timeframe: '12 months' },
  { name: 'Bull', price: 180, probability: null, timeframe: '12 months' },
]
const PRICE = 232.99

const ladder = (range52w?: { low: number; high: number } | null) => {
  const { container } = render(
    <ScenarioLadder price={PRICE} cases={CASES} expected={null} range52w={range52w} />,
  )
  return container
}
const ticks = (c: HTMLElement) => [...c.querySelectorAll('[data-testid="ladder-52w"]')]
const labels = (c: HTMLElement) => [...c.querySelectorAll('[data-testid="ladder-52w-label"]')]

describe('the range renders only when it is a range', () => {
  it('draws nothing at all when no range is known', () => {
    // The common case: only a minority of assets carry any cached history, and
    // `range52wFrom` returns null rather than a partial answer.
    for (const absent of [undefined, null]) {
      const c = ladder(absent)
      expect(ticks(c)).toHaveLength(0)
      expect(labels(c)).toHaveLength(0)
      expect(c.querySelector('[data-testid="ladder-52w-span"]')).toBeNull()
    }
  })

  it('refuses a degenerate range rather than asserting a flat year', () => {
    // `range52wFrom` needs two closes and they can still be equal. "52W LOW
    // $180 · 52W HIGH $180" would claim a year of flat trading nobody measured.
    expect(ticks(ladder({ low: 180, high: 180 }))).toHaveLength(0)
    expect(ticks(ladder({ low: 200, high: 100 }))).toHaveLength(0)
  })

  it('refuses numbers that are not numbers', () => {
    expect(ticks(ladder({ low: NaN, high: 242 }))).toHaveLength(0)
    expect(ticks(ladder({ low: 0, high: 242 }))).toHaveLength(0)
  })

  it('draws both ends when the range is real', () => {
    const c = ladder({ low: 86, high: 242 })
    expect(ticks(c)).toHaveLength(2)
    expect(ticks(c).map(t => t.getAttribute('data-bound'))).toEqual(['low', 'high'])
    expect(c.querySelector('[data-testid="ladder-52w-span"]')).toBeTruthy()
  })
})

describe('the range is not a scenario', () => {
  it('adds no case dot, no label and no tap target', () => {
    const bare = ladder(null)
    const withRange = ladder({ low: 86, high: 242 })
    // The cases are unchanged in number and in kind.
    expect(withRange.querySelectorAll('[data-testid="ladder-dot"]')).toHaveLength(
      bare.querySelectorAll('[data-testid="ladder-dot"]').length)
    expect(withRange.querySelectorAll('[data-testid="ladder-dot-label"]')).toHaveLength(
      bare.querySelectorAll('[data-testid="ladder-dot-label"]').length)
  })

  it('offers nothing to press', () => {
    const c = ladder({ low: 86, high: 242 })
    for (const n of [...ticks(c), ...labels(c)]) {
      expect(n.tagName).not.toBe('BUTTON')
      expect(n.querySelector('button')).toBeNull()
      // Hidden from assistive tech: it is context around the claim, and reading
      // "52W low 86" between the cases would put it in the ladder's own list.
      expect(n.getAttribute('aria-hidden')).toBe('true')
    }
  })

  /**
   * Weight is the hierarchy. The cases are 9px bold over 11px bold; the range
   * is 8px medium over 10px medium in the muted grey.
   */
  it('sets the range lighter and smaller than a case', () => {
    const c = ladder({ low: 86, high: 242 })
    const rangeText = labels(c)[0].innerHTML
    expect(rangeText).toContain('text-[8px]')
    expect(rangeText).toContain('font-medium')
    expect(rangeText).not.toContain('font-bold')

    const caseLabel = c.querySelector('[data-testid="ladder-dot-label"]')!.innerHTML
    expect(caseLabel).toContain('font-bold')
  })
})

describe('two names, or one caption', () => {
  it('names both ends when they are far enough apart', () => {
    const c = ladder({ low: 86, high: 242 })
    expect(labels(c)).toHaveLength(2)
    expect(labels(c).map(l => l.getAttribute('data-bound'))).toEqual(['low', 'high'])
    expect(c.textContent).toContain('52W')
    expect(c.textContent).toContain('52W')
    expect(c.textContent).toContain('$86')
    expect(c.textContent).toContain('$242')
  })

  /**
   * The collision the six-case fixture caught.
   *
   * On a ladder running 205–500, a range of 142–260 puts the low in the
   * compressed left margin and the high inside the modelled band — about 9% of
   * the axis apart, where two labels need about 17%. They rendered as
   * "52W LOV52W HIGH". Placing them around the CASE labels could never fix it,
   * because the collision is between the two of them.
   */
  it('falls back to one caption when the ends cannot both be named', () => {
    const { container } = render(
      <ScenarioLadder
        price={150}
        cases={[
          { name: 'Bear', price: 205, probability: 12, timeframe: '6 months' },
          { name: 'Base', price: 230, probability: 19, timeframe: '6 months' },
          { name: 'Bull', price: 285, probability: 62, timeframe: '12 months' },
          { name: 'Bull', price: 345, probability: 15, timeframe: '12 months' },
          { name: 'Uber bull', price: 500, probability: 7, timeframe: '12 months' },
        ]}
        expected={null}
        range52w={{ low: 142, high: 260 }}
      />,
    )
    // Both ticks still draw — the positions are the information.
    expect(ticks(container)).toHaveLength(2)
    // One label, carrying both numbers.
    expect(labels(container)).toHaveLength(1)
    expect(labels(container)[0].getAttribute('data-bound')).toBe('range')
    expect(container.textContent).toContain('52W $142–$260')
    // And neither endpoint stack is drawn. Checked structurally: the caption
    // itself contains the string "52W", so a text assertion cannot tell them
    // apart — `data-bound` can.
    expect(container.querySelector('[data-bound="low"][data-testid="ladder-52w-label"]')).toBeNull()
    expect(container.querySelector('[data-bound="high"][data-testid="ladder-52w-label"]')).toBeNull()
  })

  /**
   * No two labels of any kind may overlap, which is the property every earlier
   * fix in this component moved instead of removing.
   *
   * Positions are read off the inline styles rather than measured: jsdom has no
   * layout, and the placement is arithmetic the component does itself.
   */
  it('never puts two labels on the same side and row at the same place', () => {
    const c = ladder({ low: 86, high: 242 })
    const all = [...c.querySelectorAll('[data-testid="ladder-dot-label"], [data-testid="ladder-52w-label"]')]
    const seen = new Map<string, number[]>()
    for (const n of all) {
      const style = (n as HTMLElement).style
      const left = parseFloat(style.left)
      // `translate(-50%, Ypx)` or `translate(calc(-50% + Npx), Ypx)`.
      const y = /,\s*(-?\d+(?:\.\d+)?)px\)/.exec(style.transform)?.[1] ?? '0'
      const lane = seen.get(y) ?? []
      for (const other of lane) {
        // 12% of the axis is about 41px, comfortably wider than any label here.
        expect(Math.abs(other - left), `labels at y=${y}px`).toBeGreaterThan(12)
      }
      lane.push(left)
      seen.set(y, lane)
    }
  })
})

describe('the price pill keeps its distance', () => {
  it('is still the only pill, and still not a case', () => {
    const c = ladder({ low: 86, high: 242 })
    expect(screen.getByText(/232\.99/)).toBeTruthy()
    // The tape mark is inert for the same reason the range is: comparing the
    // price with itself is not a comparison.
    expect(c.querySelector('[data-testid="ladder-tape"]')!.tagName).not.toBe('BUTTON')
  })
})
