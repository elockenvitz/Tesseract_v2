import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

import { CaseLadderBuilder, seedLadder, DEFAULT_LADDER_HORIZON } from '../CaseLadderBuilder'

const slot = (c: HTMLElement, n: string) => c.querySelector(`[data-slot="${n}"]`) as HTMLElement
const all = (c: HTMLElement, n: string) => [...c.querySelectorAll(`[data-slot="${n}"]`)] as HTMLElement[]
const inRow = (c: HTMLElement, rung: string, n: string) =>
  c.querySelector(`[data-rung="${rung}"] [data-slot="${n}"]`) as HTMLElement
const row = (c: HTMLElement, rung: string) =>
  c.querySelector(`[data-slot="ladder-row"][data-rung="${rung}"]`) as HTMLElement

const view = (over: Partial<Parameters<typeof CaseLadderBuilder>[0]> = {}) => {
  const onOpenDetails = vi.fn()
  const r = render(
    <CaseLadderBuilder
      currentPrice={200}
      range52w={{ low: 150, high: 260 }}
      onOpenDetails={onOpenDetails}
      {...over}
    />,
  )
  return { ...r, onOpenDetails }
}

describe('it suggests from evidence, never from a rule of thumb', () => {
  it('takes the ends from the 52-week range and the base from the last close', () => {
    // The one honest suggestion. A percentage rule would be a number this app
    // invented and could not later be told apart from the analyst's own work.
    expect(seedLadder(200, { low: 150, high: 260 }))
      .toEqual({ Bull: 260, Base: 200, Bear: 150 })
  })

  it('offers no ends at all when there is no price history', () => {
    // A row with no price is a correct statement about what is known.
    expect(seedLadder(200, null)).toEqual({ Bull: null, Base: 200, Bear: null })
  })

  it('offers no base when there is no price either', () => {
    expect(seedLadder(null, { low: 150, high: 260 }).Base).toBeNull()
  })

  it('says the numbers are suggestions, not somebody’s view', () => {
    const { container } = view()
    expect(slot(container, 'ladder-note').textContent).toMatch(/Suggested from the 52-week range/)
  })

  it('says plainly that nothing is on record when it cannot suggest', () => {
    const { container } = view({ range52w: null, currentPrice: null })
    expect(slot(container, 'ladder-note').textContent).toBe('No target on record')
    expect(slot(container, 'ladder-52w')).toBeNull()
  })

  it('shows the traded range beside the suggestion it came from', () => {
    const { container } = view()
    expect(slot(container, 'ladder-52w').textContent).toContain('$150.00')
    expect(slot(container, 'ladder-52w').textContent).toContain('$260.00')
  })
})

describe('the card states the ladder and writes nothing', () => {
  it('shows three rungs, high to low', () => {
    const { container } = view()
    expect(all(container, 'ladder-row').map(r => r.getAttribute('data-rung')))
      .toEqual(['Bull', 'Base', 'Bear'])
  })

  it('has no field, no horizon picker and no save button', () => {
    // An input, a selector and a commit button in a 172px pane was reported as
    // "getting too busy" — and the quick save wrote nulls for the horizon,
    // probability and reasoning it had no room to collect.
    const { container } = view()
    expect(container.querySelector('input')).toBeNull()
    expect(slot(container, 'ladder-save')).toBeNull()
    expect(all(container, 'ladder-horizon-option')).toHaveLength(0)
  })

  it('shows each rung’s price and its distance from today', () => {
    const { container } = view()
    expect(inRow(container, 'Bull', 'ladder-value').textContent).toBe('$260.00')
    expect(inRow(container, 'Bull', 'ladder-chg').textContent).toBe('+30%')
    expect(inRow(container, 'Bear', 'ladder-chg').textContent).toBe('-25%')
  })

  it('shows the horizon on every rung', () => {
    // A price with no expiry cannot go stale, cannot be checked and cannot be
    // wrong, so a card offering to record one owes the reader the date.
    const { container } = view()
    expect(all(container, 'ladder-horizon').map(n => n.textContent)).toEqual(['12M', '12M', '12M'])
  })

  it('calls the base case neutral rather than a gain', () => {
    // Suggested at the last close, so it renders 0% — and green there reads as
    // a gain on a card whose subject is that nobody has claimed one.
    const { container } = view()
    const base = inRow(container, 'Base', 'ladder-chg')
    expect(base.textContent).toBe('at the price')
    expect(base.className).not.toMatch(/emerald/)
  })

  it('invites a price on a rung it cannot suggest one for', () => {
    const { container } = view({ range52w: null })
    expect(inRow(container, 'Bull', 'ladder-value').textContent).toBe('Set a price')
    expect(inRow(container, 'Bull', 'ladder-chg')).toBeNull()
  })
})

describe('it judges the ladder before the reader records it', () => {
  it('shows the reward:risk the recorded ladder will be judged by', () => {
    // Bull 260, price 200, Bear 150 → 60 up over 50 down.
    const { container } = view()
    expect(slot(container, 'ladder-skew').textContent).toMatch(/1\.2×/)
  })

  it('withholds the ratio when the price is outside the ladder', () => {
    // A ratio needs the price between the ends. Outside them it is not a
    // reward against a risk, and a number would be arithmetic pretending to be
    // a judgement.
    const { container } = view({ currentPrice: 300 })
    expect(slot(container, 'ladder-skew')).toBeNull()
  })

  it('withholds the ratio when an end cannot be suggested', () => {
    const { container } = view({ range52w: null })
    expect(slot(container, 'ladder-skew')).toBeNull()
  })

  it('always says what a tap does', () => {
    const { container } = view()
    expect(slot(container, 'ladder-hint').textContent).toMatch(/Tap a case to record it/)
  })
})

describe('every row opens the full editor', () => {
  it('passes the rung, its suggested price and the horizon', () => {
    const { container, onOpenDetails } = view()
    fireEvent.click(row(container, 'Bull'))
    expect(onOpenDetails).toHaveBeenCalledWith('Bull', 260, DEFAULT_LADDER_HORIZON)
  })

  it('opens on the rung that was tapped', () => {
    const { container, onOpenDetails } = view()
    fireEvent.click(row(container, 'Bear'))
    expect(onOpenDetails).toHaveBeenCalledWith('Bear', 150, DEFAULT_LADDER_HORIZON)
  })

  it('passes a null price for a rung it could not suggest one for', () => {
    // The drawer decides what to do with that; the card does not invent a
    // number to fill the argument.
    const { container, onOpenDetails } = view({ range52w: null, currentPrice: null })
    fireEvent.click(row(container, 'Base'))
    expect(onOpenDetails).toHaveBeenCalledWith('Base', null, DEFAULT_LADDER_HORIZON)
  })

  it('makes the whole row the target, not a word inside it', () => {
    // One action per row means the row is the button — nothing competing for
    // the same tap on a 34px line.
    const { container } = view()
    expect(row(container, 'Bull').tagName).toBe('BUTTON')
  })
})
