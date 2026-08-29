import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'

import { ScenarioLadder } from '../ScenarioLadder'

/**
 * The 52-week ends read as BOUNDS, and the axis settles rather than snapping.
 *
 * Two separate properties, both about the same late-arriving input:
 *
 *   A. the low and high labels are edge-aligned to their own ticks, so the
 *      pair frames the range instead of floating like two more markers;
 *   B. the domain includes the 52-week range, which resolves after first
 *      paint, so every mark's position changes once — and that change must be
 *      continuous, not a jump, and must never alter the card's height.
 */

const CASES = [
  { name: 'Bear', price: 90, probability: null, timeframe: '12 months' },
  { name: 'Base', price: 120, probability: null, timeframe: '12 months' },
  { name: 'Bull', price: 180, probability: null, timeframe: '12 months' },
]
const px = (el: Element) => parseFloat((el as HTMLElement).style.left)
const label = (c: HTMLElement, bound: string) =>
  c.querySelector(`[data-testid="ladder-52w-label"][data-bound="${bound}"]`) as HTMLElement | null
const tick = (c: HTMLElement, bound: string) =>
  c.querySelector(`[data-testid="ladder-52w"][data-bound="${bound}"]`) as HTMLElement

describe('A. the 52-week labels frame the range', () => {
  const draw = () => render(
    <ScenarioLadder price={232.99} cases={CASES} expected={null}
      range52w={{ low: 86, high: 242 }} />,
  ).container

  it('anchors the low label to the left of its own tick', () => {
    const c = draw()
    const l = label(c, 'low')!
    expect(l.className).toContain('items-start')
    expect(l.className).toContain('text-left')
    // Spreads inward only: its left edge sits ON the tick.
    expect(l.style.transform).toContain('translate(0')
  })

  it('anchors the high label to the right of its own tick', () => {
    const c = draw()
    const h = label(c, 'high')!
    expect(h.className).toContain('items-end')
    expect(h.className).toContain('text-right')
    expect(h.style.transform).toContain('translate(-100%')
  })

  /** A case dot is centred; the difference in alignment is itself the signal. */
  it('does not centre them the way a case is centred', () => {
    const c = draw()
    expect(label(c, 'low')!.className).not.toContain('items-center')
    expect(label(c, 'high')!.className).not.toContain('items-center')
  })

  /**
   * THE constraint on all of this: the labels moved, the VALUES did not. The
   * ticks stay at their quantitative positions on the shared linear scale.
   */
  it('leaves the underlying quantitative positions untouched', () => {
    const c = draw()
    const lo = px(tick(c, 'low'))
    const hi = px(tick(c, 'high'))
    const dots = [...c.querySelectorAll('[data-testid="ladder-dot"]')].map(px)
    const tape = px(c.querySelector('[data-testid="ladder-tape"]')!)

    // One ruler: $156 of market range against $90 of case range.
    const perDollarMarket = (hi - lo) / (242 - 86)
    const perDollarCases = (Math.max(...dots) - Math.min(...dots)) / (180 - 90)
    expect(Math.abs(perDollarMarket - perDollarCases) / perDollarCases).toBeLessThan(0.02)
    // And the tape is still on the same ruler.
    const perDollarTape = (tape - Math.min(...dots)) / (232.99 - 90)
    expect(Math.abs(perDollarTape - perDollarCases) / perDollarCases).toBeLessThan(0.02)
  })
})

describe('B. the ladder is stable while the 52-week range loads', () => {
  const withoutRange = () => render(
    <ScenarioLadder price={232.99} cases={CASES} expected={null} range52w={null} />,
  )

  /** A card exists without history. The range is context, not a precondition. */
  it('draws a complete ladder before any range arrives', () => {
    const { container } = withoutRange()
    expect(container.querySelectorAll('[data-testid="ladder-dot"]')).toHaveLength(3)
    expect(container.querySelector('[data-testid="ladder-tape"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="ladder-52w"]')).toBeNull()
  })

  /**
   * The card must not resize when the range lands. The axis box is
   * `min-h-[140px] max-h-[220px] flex-1` and carries no dependency on the
   * range, so nothing below the ladder moves.
   */
  it('keeps the same axis container geometry before and after', () => {
    const before = withoutRange().container.querySelector('[data-testid="scenario-ladder"]')!
      .querySelector('.relative')!.className
    const after = render(
      <ScenarioLadder price={232.99} cases={CASES} expected={null}
        range52w={{ low: 86, high: 242 }} />,
    ).container.querySelector('[data-testid="scenario-ladder"]')!
      .querySelector('.relative')!.className
    expect(after).toBe(before)
    expect(before).toContain('min-h-[140px]')
    expect(before).toContain('max-h-[220px]')
  })

  /**
   * The domain DOES widen — that is correct, the range is part of the scale —
   * so the movement is made continuous instead of being a single-frame snap.
   */
  it('transitions every price-positioned mark rather than snapping', () => {
    const { container } = render(
      <ScenarioLadder price={232.99} cases={CASES} expected={null}
        range52w={{ low: 86, high: 242 }} />,
    )
    for (const sel of ['ladder-tape', 'ladder-modelled', 'ladder-52w', 'ladder-now-leader']) {
      const el = container.querySelector(`[data-testid="${sel}"]`)!
      expect(el.className, sel).toContain('transition-[left,width]')
      // Respects a reader who has asked for less motion.
      expect(el.className, sel).toContain('motion-reduce:transition-none')
    }
  })

  it('moves the marks when the range arrives, and only then', () => {
    const noRange = withoutRange().container
    const withRange = render(
      <ScenarioLadder price={232.99} cases={CASES} expected={null}
        range52w={{ low: 86, high: 242 }} />,
    ).container
    // The domain widened, so positions differ — this is the movement being
    // smoothed, and the test exists so nobody "fixes" it by freezing the scale.
    expect(px(noRange.querySelector('[data-testid="ladder-tape"]')!))
      .not.toBeCloseTo(px(withRange.querySelector('[data-testid="ladder-tape"]')!), 1)
  })
})
