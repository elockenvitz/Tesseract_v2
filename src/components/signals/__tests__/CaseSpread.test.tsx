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
const view = (price: number | null, cases = LADDER, onSave = vi.fn()) =>
  ({ ...render(<CaseSpread cases={cases} currentPrice={price} onSave={onSave} />), onSave })

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
  it('lets the reader tap the number they disagree with', () => {
    // No mode and no selection — the value is already in front of them,
    // because it is part of the argument the card just made.
    const { container, onSave } = view(200)
    fireEvent.click(container.querySelector('[data-case-id="bull"]')!)
    const input = slot(container, 'value-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '340' } })
    fireEvent.blur(input)
    expect(onSave).toHaveBeenCalledWith('bull', 340)
  })

  it('recomputes the argument from the edited value', () => {
    const { container } = view(200)
    fireEvent.click(container.querySelector('[data-case-id="bull"]')!)
    const input = slot(container, 'value-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '400' } })
    fireEvent.blur(input)
    // 100 up on 30 down is 3.3x, not the 1.7x it showed before.
    expect(slot(container, 'spread-skew').textContent).toContain('3.3×')
  })

  it('ignores an entry that is not a price', () => {
    const { container, onSave } = view(200)
    fireEvent.click(container.querySelector('[data-case-id="bull"]')!)
    const input = slot(container, 'value-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'abc' } })
    fireEvent.blur(input)
    expect(onSave).not.toHaveBeenCalled()
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
