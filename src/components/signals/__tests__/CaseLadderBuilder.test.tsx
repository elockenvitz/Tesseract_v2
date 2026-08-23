import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

import { CaseLadderBuilder, seedLadder } from '../CaseLadderBuilder'

const slot = (c: HTMLElement, n: string) => c.querySelector(`[data-slot="${n}"]`) as HTMLElement
const all = (c: HTMLElement, n: string) => [...c.querySelectorAll(`[data-slot="${n}"]`)] as HTMLElement[]
const price = (c: HTMLElement, rung: string) =>
  c.querySelector(`[data-slot="ladder-price"][data-rung="${rung}"]`) as HTMLInputElement

const view = (over: Partial<Parameters<typeof CaseLadderBuilder>[0]> = {}) => {
  const onSaveLadder = vi.fn()
  const onOpenDetails = vi.fn()
  const r = render(
    <CaseLadderBuilder
      symbol="AAPL"
      currentPrice={200}
      range52w={{ low: 150, high: 260 }}
      onSaveLadder={onSaveLadder}
      onOpenDetails={onOpenDetails}
      {...over}
    />,
  )
  return { ...r, onSaveLadder, onOpenDetails }
}

describe('it seeds from evidence, never from a rule of thumb', () => {
  it('takes the ends from the 52-week range and the base from the last close', () => {
    // The one honest seed. A percentage rule would be a number this app
    // invented and then stored under somebody's name.
    expect(seedLadder(200, { low: 150, high: 260 }))
      .toEqual({ Bull: '260', Base: '200', Bear: '150' })
  })

  it('leaves every row empty when there is no price history', () => {
    // A blank field is a correct statement about what is known. Inventing a
    // spread here is exactly what the card exists to stop.
    expect(seedLadder(200, null)).toEqual({ Bull: '', Base: '', Bear: '' })
  })

  it('leaves the base empty when there is no price either', () => {
    expect(seedLadder(null, { low: 150, high: 260 }).Base).toBe('')
  })

  it('says the seed is the range, not somebody’s view', () => {
    const { container } = view()
    expect(slot(container, 'ladder-note').textContent).toMatch(/52-week range/)
  })

  it('stops calling it a seed once the reader has typed', () => {
    const { container } = view()
    fireEvent.change(price(container, 'Bull'), { target: { value: '300' } })
    expect(slot(container, 'ladder-note').textContent).not.toMatch(/52-week range/)
  })

  it('renders three rows with nothing in them when there is no range', () => {
    const { container } = view({ range52w: null })
    expect(all(container, 'ladder-row')).toHaveLength(3)
    expect(price(container, 'Bull').value).toBe('')
    expect(slot(container, 'ladder-52w')).toBeNull()
  })
})

describe('it judges the ladder while it is being typed', () => {
  it('shows the same reward:risk the saved ladder will be judged by', () => {
    // Bull 260, price 200, Bear 150 → 60 up over 50 down.
    const { container } = view()
    expect(slot(container, 'ladder-skew').textContent).toMatch(/1\.2×/)
  })

  it('updates the ratio as a rung changes', () => {
    const { container } = view()
    fireEvent.change(price(container, 'Bull'), { target: { value: '300' } })
    expect(slot(container, 'ladder-skew').textContent).toMatch(/2\.0×/)
  })

  it('withholds the ratio when the price is outside the ladder', () => {
    // A ratio needs the price between the ends. Outside them it is not a
    // reward against a risk, and a number here would be arithmetic pretending
    // to be a judgement.
    const { container } = view({ currentPrice: 300 })
    expect(slot(container, 'ladder-skew')).toBeNull()
  })

  it('withholds the ratio while an end is missing', () => {
    const { container } = view()
    fireEvent.change(price(container, 'Bear'), { target: { value: '' } })
    expect(slot(container, 'ladder-skew')).toBeNull()
  })

  it('calls the base case neutral rather than a gain', () => {
    // Seeded at the last close, so it renders 0% — and green there reads as a
    // gain on a card whose subject is that nobody has claimed one.
    const { container } = view()
    const base = container.querySelector('[data-rung="Base"] [data-slot="ladder-chg"]')!
    expect(base.textContent).toBe('at the price')
    expect(base.className).not.toMatch(/emerald/)
  })

  it('marks a rung below the price as a loss and above it as a gain', () => {
    const { container } = view()
    const chg = (r: string) => container.querySelector(`[data-rung="${r}"] [data-slot="ladder-chg"]`)!
    expect(chg('Bull').textContent).toBe('+30%')
    expect(chg('Bull').className).toMatch(/emerald/)
    expect(chg('Bear').textContent).toBe('-25%')
    expect(chg('Bear').className).toMatch(/rose/)
  })
})

describe('it writes the whole ladder at once', () => {
  it('saves every filled rung with the chosen horizon', () => {
    const { container, onSaveLadder } = view()
    fireEvent.click(all(container, 'ladder-horizon-option')[1]) // 6 months
    fireEvent.click(slot(container, 'ladder-save'))
    expect(onSaveLadder).toHaveBeenCalledWith(
      [{ name: 'Bull', price: 260 }, { name: 'Base', price: 200 }, { name: 'Bear', price: 150 }],
      '6 months',
    )
  })

  it('defaults to twelve months', () => {
    const { container, onSaveLadder } = view()
    fireEvent.click(slot(container, 'ladder-save'))
    expect(onSaveLadder.mock.calls[0][1]).toBe('12 months')
  })

  it('skips rungs the reader left blank and says how many will be written', () => {
    const { container, onSaveLadder } = view()
    fireEvent.change(price(container, 'Bear'), { target: { value: '' } })
    expect(slot(container, 'ladder-save').textContent).toBe('Save 2 cases')
    fireEvent.click(slot(container, 'ladder-save'))
    expect(onSaveLadder.mock.calls[0][0]).toEqual(
      [{ name: 'Bull', price: 260 }, { name: 'Base', price: 200 }],
    )
  })

  it('cannot be saved when nothing is filled in', () => {
    const { container, onSaveLadder } = view({ range52w: null, currentPrice: null })
    const save = slot(container, 'ladder-save') as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.click(save)
    expect(onSaveLadder).not.toHaveBeenCalled()
  })

  it('ignores a rung that is not a positive number', () => {
    const { container, onSaveLadder } = view()
    fireEvent.change(price(container, 'Bear'), { target: { value: '-4' } })
    fireEvent.click(slot(container, 'ladder-save'))
    expect(onSaveLadder.mock.calls[0][0].map((r: any) => r.name)).toEqual(['Bull', 'Base'])
  })

  it('does not write anything before Save is pressed', () => {
    // The whole point of the rewrite: the old control committed each number
    // before the next one existed, so the spread could never be reconsidered.
    const { container, onSaveLadder } = view()
    fireEvent.change(price(container, 'Bull'), { target: { value: '400' } })
    fireEvent.click(all(container, 'ladder-horizon-option')[0])
    expect(onSaveLadder).not.toHaveBeenCalled()
  })
})

describe('the details a row cannot hold', () => {
  it('opens the full editor for the rung, with its price', () => {
    const { container, onOpenDetails } = view()
    fireEvent.click(container.querySelector('[data-rung="Bull"] [data-slot="ladder-details"]')!)
    expect(onOpenDetails).toHaveBeenCalledWith('Bull', 260)
  })

  it('opens it from the case name too', () => {
    const { container, onOpenDetails } = view()
    fireEvent.click(container.querySelector('[data-rung="Bear"] [data-slot="ladder-name"]')!)
    expect(onOpenDetails).toHaveBeenCalledWith('Bear', 150)
  })

  it('passes a null price for a rung with nothing in it', () => {
    const { container, onOpenDetails } = view({ range52w: null, currentPrice: null })
    fireEvent.click(container.querySelector('[data-rung="Base"] [data-slot="ladder-name"]')!)
    expect(onOpenDetails).toHaveBeenCalledWith('Base', null)
  })

  it('offers no details affordance when the caller cannot act on it', () => {
    const { container } = view({ onOpenDetails: undefined })
    expect(all(container, 'ladder-details')).toHaveLength(0)
  })
})
