/**
 * The framework band — does the axis name the lines it is drawn under?
 *
 * This object carries the whole finding on three of Today's four tiles, and
 * it was unreadable for a reason that no test could have caught by looking
 * at the markup alone: the labels were a `justify-between` row, so they were
 * spread evenly across the band WHEREVER the rungs actually sat. Measured on
 * AMZN at 1920x889, the bull rung was at 55% of the band with "BULL 180"
 * printed at 100%. Every label named a line it was nowhere near.
 *
 * So the property under test is positional, not textual: a label's offset
 * must equal its own rung's offset.
 */

import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import type { TodayVisual as Visual } from '../../lib/today'
import { VISUAL_SLOT } from '../../lib/today'
import { TodayVisual } from './TodayVisual'

const scenario = (
  cases: { name: string; price: number }[],
  spot: number,
): Visual => ({
  archetype: 'scenario',
  caption: 'Price against the framework',
  window: `${cases.length} cases`,
  scenario: { cases, spot },
})

/** The three-rung framework most desks actually write. */
const THREE = [
  { name: 'Bear', price: 90 },
  { name: 'Base', price: 120 },
  { name: 'Bull', price: 180 },
]

/** The scale the band is drawn on, from the component's own construction. */
function offsets(cases: { name: string; price: number }[], spot: number) {
  const prices = cases.map(c => c.price)
  const lo = Math.min(Math.min(...prices), spot) * 0.94
  const hi = Math.max(Math.max(...prices), spot) * 1.06
  const span = (hi - lo) || 1
  return (p: number) => ((p - lo) / span) * 100
}

/** `left: 31.4%` -> 31.4, to compare against the scale above. */
const pct = (el: Element) => parseFloat((el as HTMLElement).style.left)

describe('the framework band names the lines it draws', () => {
  it('puts each rung label at its own rung, not at an even interval', () => {
    const at = offsets(THREE, 248)
    const { container } = render(<TodayVisual visual={scenario(THREE, 248)} />)

    const labels = [...container.querySelectorAll('[data-testid="scenario-rung-label"]')]
    expect(labels).toHaveLength(3)

    for (const c of THREE) {
      const label = labels.find(l => l.getAttribute('data-rung') === c.name)!
      expect(label, `no label for ${c.name}`).toBeDefined()
      expect(pct(label)).toBeCloseTo(at(c.price), 1)
    }

    // The failure this replaces: evenly spread, so the last label sits hard
    // against the right edge whatever the bull case is worth. With a spot
    // well above bull, the bull rung is nowhere near 100%.
    const bull = labels.find(l => l.getAttribute('data-rung') === 'Bull')!
    expect(pct(bull)).toBeLessThan(90)
  })

  it('drops a label that would collide rather than printing two on top of each other', () => {
    // Four cases, two of them close: AAPL printed "BEBAR5Sa0B310" where
    // BEAR 205 and BASE 230 overlapped.
    const four = [
      { name: 'Bear', price: 205 },
      { name: 'Base', price: 230 },
      { name: 'Bull', price: 285 },
      { name: 'Uber Bull', price: 500 },
    ]
    const { container } = render(<TodayVisual visual={scenario(four, 330)} />)
    const labels = [...container.querySelectorAll('[data-testid="scenario-rung-label"]')]
    const names = labels.map(l => l.getAttribute('data-rung'))

    // The extremes are what an axis is for; a crowded middle rung yields.
    expect(names).toContain('Bear')
    expect(names).toContain('Uber Bull')
    expect(names).not.toContain('Base')

    // Whatever survives must clear its neighbour, or the drop achieved
    // nothing. 15% is the wide-column gap the component applies.
    const xs = labels.map(pct).sort((a, b) => a - b)
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(15)
  })

  it('still draws every rung as a line, so nothing is hidden from the chart', () => {
    const four = [
      { name: 'Bear', price: 205 },
      { name: 'Base', price: 230 },
      { name: 'Bull', price: 285 },
      { name: 'Uber Bull', price: 500 },
    ]
    const { container } = render(<TodayVisual visual={scenario(four, 330)} />)
    // One `i` per case, plus the spot mark.
    expect(container.querySelectorAll('[data-testid="scenario-band"] i')).toHaveLength(5)
  })

  it('holds one fixed slot whatever it draws', () => {
    const wide = render(<TodayVisual visual={scenario(THREE, 248)} />)
    const tight = render(<TodayVisual visual={scenario(THREE, 248)} compact />)
    const h = (c: HTMLElement) => (c.querySelector('[data-archetype]') as HTMLElement).style.height
    expect(h(wide.container)).toBe(`${VISUAL_SLOT.featured}px`)
    expect(h(tight.container)).toBe(`${VISUAL_SLOT.compact}px`)
  })
})
