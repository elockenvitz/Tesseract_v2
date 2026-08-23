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
  return { ...r, onOpenDetails, seed: () => fireEvent.click(slot(r.container, 'ladder-seed')) }
}

describe('it shows no case value nobody has chosen', () => {
  it('starts every rung empty, whatever the price history says', () => {
    // A price rendered in the case slot of a ladder IS a target as far as
    // anybody reading the card is concerned, and a 10px grey caption does not
    // undo three numbers set in bold. On a card whose entire subject is an
    // absence, filling that absence with plausible numbers is the one thing it
    // must not do.
    const { container } = view()
    expect(all(container, 'ladder-value').map(n => n.textContent))
      .toEqual(['Set a price', 'Set a price', 'Set a price'])
    expect(all(container, 'ladder-chg')).toHaveLength(0)
  })

  it('offers no verdict over numbers nobody chose', () => {
    const { container } = view()
    expect(slot(container, 'ladder-skew')).toBeNull()
  })

  it('says only that nothing is on record', () => {
    const { container } = view()
    expect(slot(container, 'ladder-note').textContent).toBe('No target on record')
  })

  it('still shows the traded range, which claims nothing about a view', () => {
    // A fact about the market, labelled as one, in a slot that never holds a
    // case — and the cheapest reality check there is when pricing from nothing.
    const { container } = view()
    expect(slot(container, 'ladder-52w').textContent).toContain('$150.00')
    expect(slot(container, 'ladder-52w').textContent).toContain('$260.00')
  })

  it('marks an empty rung as unmistakably empty, not as a figure', () => {
    const { container } = view()
    expect(inRow(container, 'Bull', 'ladder-value').className).not.toMatch(/font-bold/)
  })
})

describe('the range fills the rungs only when asked', () => {
  it('offers the starting point as a choice', () => {
    const { container } = view()
    expect(slot(container, 'ladder-seed')).toBeTruthy()
    expect(slot(container, 'ladder-hint')).toBeNull()
  })

  it('fills every rung from the range on request', () => {
    // The same numbers the card used to show on sight. The difference is
    // entirely that a person asked for them, which is what stops a suggestion
    // being read as a record.
    const { container, seed } = view()
    seed()
    expect(all(container, 'ladder-value').map(n => n.textContent))
      .toEqual(['$260.00', '$200.00', '$150.00'])
  })

  it('judges the ladder once the reader owns it', () => {
    // Bull 260, price 200, Bear 150 → 60 up over 50 down.
    const { container, seed } = view()
    seed()
    expect(slot(container, 'ladder-skew').textContent).toMatch(/1\.2×/)
  })

  it('stops offering the range once the rungs are filled', () => {
    const { container, seed } = view()
    seed()
    expect(slot(container, 'ladder-seed')).toBeNull()
    expect(slot(container, 'ladder-hint').textContent).toMatch(/Tap a case to record it/)
  })

  it('offers nothing to fill from when there is no price history', () => {
    const { container } = view({ range52w: null })
    expect(slot(container, 'ladder-seed')).toBeNull()
    expect(slot(container, 'ladder-52w')).toBeNull()
    expect(slot(container, 'ladder-hint')).toBeTruthy()
  })

  it('shows each filled rung with its distance from today', () => {
    const { container, seed } = view()
    seed()
    expect(inRow(container, 'Bull', 'ladder-chg').textContent).toBe('+30%')
    expect(inRow(container, 'Bear', 'ladder-chg').textContent).toBe('-25%')
  })

  it('calls a filled base case neutral rather than a gain', () => {
    // It sits at the last close, so it renders 0% — and green there reads as a
    // gain on a card whose subject is that nobody has claimed one.
    const { container, seed } = view()
    seed()
    const base = inRow(container, 'Base', 'ladder-chg')
    expect(base.textContent).toBe('at the price')
    expect(base.className).not.toMatch(/emerald/)
  })

  it('withholds the ratio when the price sits outside the filled ladder', () => {
    // A ratio needs the price between the ends. Outside them it is not a reward
    // against a risk, and a number would be arithmetic pretending to be a
    // judgement.
    const { container, seed } = view({ currentPrice: 300 })
    seed()
    expect(slot(container, 'ladder-skew')).toBeNull()
  })
})

describe('what the range spreads across the rungs, when asked', () => {
  it('takes the ends from the range and the base from the last close', () => {
    // The midpoint would be a computed opinion. "It is worth roughly what it
    // trades at" is the honest null hypothesis somebody is about to argue with.
    expect(seedLadder(200, { low: 150, high: 260 }))
      .toEqual({ Bull: 260, Base: 200, Bear: 150 })
  })

  it('has nothing to spread without price history', () => {
    expect(seedLadder(200, null)).toEqual({ Bull: null, Base: null, Bear: null })
  })

  it('leaves the base empty when there is no price either', () => {
    expect(seedLadder(null, { low: 150, high: 260 }).Base).toBeNull()
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

  it('shows the horizon on every rung', () => {
    // A price with no expiry cannot go stale, cannot be checked and cannot be
    // wrong, so a card offering to record one owes the reader the date.
    const { container } = view()
    expect(all(container, 'ladder-horizon').map(n => n.textContent)).toEqual(['12M', '12M', '12M'])
  })
})

describe('every row opens the full editor', () => {
  it('passes a null price for a rung nobody has filled', () => {
    // The card does not invent a number to fill the argument, and it does not
    // smuggle one into the drawer either.
    const { container, onOpenDetails } = view()
    fireEvent.click(row(container, 'Bull'))
    expect(onOpenDetails).toHaveBeenCalledWith('Bull', null, DEFAULT_LADDER_HORIZON)
  })

  it('passes the price once the reader has put one there', () => {
    const { container, onOpenDetails, seed } = view()
    seed()
    fireEvent.click(row(container, 'Bear'))
    expect(onOpenDetails).toHaveBeenCalledWith('Bear', 150, DEFAULT_LADDER_HORIZON)
  })

  it('opens on the rung that was tapped', () => {
    const { container, onOpenDetails, seed } = view()
    seed()
    fireEvent.click(row(container, 'Bull'))
    expect(onOpenDetails).toHaveBeenCalledWith('Bull', 260, DEFAULT_LADDER_HORIZON)
  })

  it('makes the whole row the target, not a word inside it', () => {
    // One action per row means the row is the button — nothing competing for
    // the same tap on a 34px line.
    const { container } = view()
    expect(row(container, 'Bull').tagName).toBe('BUTTON')
  })
})
