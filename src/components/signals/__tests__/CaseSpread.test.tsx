import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'

import { CaseSpread } from '../CaseSpread'

/**
 * The card has to state a conclusion, not present data.
 *
 * Three earlier controls — a slider, draggable chart bands, a probability
 * distribution — all answered "how do I change a number" and none answered
 * "should I". These assert the argument the card makes.
 */

const LADDER = [
  { id: 'bear', name: 'Bear', price: 140 },
  { id: 'base', name: 'Base', price: 210 },
  { id: 'bull', name: 'Bull', price: 300 },
]

const slot = (c: HTMLElement, n: string) => c.querySelector(`[data-slot="${n}"]`) as HTMLElement
const view = (price: number | null, cases = LADDER, onEditCase = vi.fn()) =>
  ({ ...render(<CaseSpread cases={cases} currentPrice={price} onEditCase={onEditCase} />), onEditCase })

describe('it names where the price sits, in the reader\'s own cases', () => {
  it('says which two cases the price is between', () => {
    // "Above your Bull case" is a fact somebody can act on. "The 94th
    // percentile of your distribution" is a statistic about a chart.
    const { container } = view(240)
    expect(slot(container, 'spread-finding').textContent).toBe('Between Base and Bull.')
  })

  it('says plainly when every case is behind the price', () => {
    const { container } = view(320)
    expect(slot(container, 'spread-finding').textContent).toMatch(/above Bull/)
  })

  it('says plainly when the price is under the worst case', () => {
    const { container } = view(120)
    expect(slot(container, 'spread-finding').textContent).toMatch(/below Bear/)
  })
})

describe('the asymmetry is the argument', () => {
  it('measures both distances from TODAY, not from the base case', () => {
    /**
     * The reader owns the position at the current price. Measuring from the
     * base case would describe a trade nobody is in.
     */
    const { container } = view(200)
    const skew = slot(container, 'spread-skew').textContent ?? ''
    expect(skew).toContain('-30%')  // 140 from 200
    expect(skew).toContain('+50%')  // 300 from 200
  })

  it('states reward per unit of risk', () => {
    // 50 up, 30 down => 1.7x. The number that drives the decision.
    const { container } = view(200)
    expect(slot(container, 'spread-skew').textContent).toContain('1.7×')
  })

  it('withholds the ratio when the price is outside the ladder', () => {
    // A ratio with a non-negative downside is not a ratio. The sentence says
    // it in words instead.
    const { container } = view(320)
    expect(slot(container, 'spread-skew').textContent).not.toContain('×')
  })
})

describe('editing follows assessment', () => {
  it('opens the full editor rather than an input', () => {
    /**
     * In-place number entry handled the one field a card has room for and none
     * of the others. Somebody who has just been told their reward:risk is 0.6x
     * is usually rewriting the argument — the horizon, the reasoning — not
     * nudging a figure.
     */
    const { container, onEditCase } = view(200)
    fireEvent.click(container.querySelector('[data-case-id="bull"]')!)
    expect(onEditCase).toHaveBeenCalledWith('bull')
    expect(container.querySelector('[data-slot="value-input"]')).toBeNull()
  })
})

describe('it declines to argue when it cannot', () => {
  it('renders nothing without a current price', () => {
    // Every number here is relative to where the name trades today.
    const { container } = view(null)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing with a single case', () => {
    // One case has no spread to be asymmetric about.
    const { container } = view(200, [LADDER[0]])
    expect(container.firstChild).toBeNull()
  })
})

describe('the expected value', () => {
  it('averages the cases when nobody has stated a probability', () => {
    /**
     * An average, said to be an average. The earlier version invented 33% on
     * each case, which produces a number somebody quotes later without its
     * caveat — an average is plainly an average.
     */
    const { container } = view(200)
    // (140 + 210 + 300) / 3 = 216.67
    expect(slot(container, 'spread-ev').textContent).toContain('$216.67')
    expect(slot(container, 'spread-ev').textContent).toContain('unweighted')
  })

  it('uses the analyst weights when every case carries one', () => {
    const weighted = [
      { id: 'bear', name: 'Bear', price: 140, probability: 20 },
      { id: 'base', name: 'Base', price: 210, probability: 60 },
      { id: 'bull', name: 'Bull', price: 300, probability: 20 },
    ]
    const { container } = view(200, weighted)
    // 28 + 126 + 60 = 214
    expect(slot(container, 'spread-ev').textContent).toContain('$214.00')
    expect(slot(container, 'spread-ev').textContent).toContain('your weights')
  })

  it('states the EV against the current price', () => {
    // An EV below the price is the whole argument for trimming.
    const { container } = view(250)
    expect(slot(container, 'spread-ev').textContent).toContain('-13%')
  })

  it('falls back to an average when only some cases are weighted', () => {
    // A partial set of probabilities is not a distribution, and normalising
    // over it would silently redistribute the missing weight.
    const partial = [
      { id: 'bear', name: 'Bear', price: 140, probability: 20 },
      { id: 'base', name: 'Base', price: 210 },
      { id: 'bull', name: 'Bull', price: 300 },
    ]
    const { container } = view(200, partial as any)
    expect(slot(container, 'spread-ev').textContent).toContain('unweighted')
  })
})
