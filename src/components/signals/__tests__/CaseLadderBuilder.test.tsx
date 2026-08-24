import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

import { CaseLadderBuilder, DEFAULT_LADDER_HORIZON } from '../CaseLadderBuilder'

const slot = (c: HTMLElement, n: string) => c.querySelector(`[data-slot="${n}"]`) as HTMLElement
const all = (c: HTMLElement, n: string) => [...c.querySelectorAll(`[data-slot="${n}"]`)] as HTMLElement[]
const inRow = (c: HTMLElement, rung: string, n: string) =>
  c.querySelector(`[data-rung="${rung}"] [data-slot="${n}"]`) as HTMLElement
const row = (c: HTMLElement, rung: string) =>
  c.querySelector(`[data-slot="ladder-row"][data-rung="${rung}"]`) as HTMLElement

const view = (over: Partial<Parameters<typeof CaseLadderBuilder>[0]> = {}) => {
  const onOpenDetails = vi.fn()
  const r = render(
    <CaseLadderBuilder range52w={{ low: 150, high: 260 }} onOpenDetails={onOpenDetails} {...over} />,
  )
  return { ...r, onOpenDetails }
}

describe('the card holds no price of its own', () => {
  it('shows no figure on any rung', () => {
    // Two attempts put prices here and both were wrong the same way. A price
    // rendered in the case slot of a ladder IS a target as far as anybody
    // reading the card is concerned — on a card whose own headline says the
    // name has no target on record.
    const { container } = view()
    expect(all(container, 'ladder-value').map(n => n.textContent))
      .toEqual(['Set a price', 'Set a price', 'Set a price'])
  })

  it('offers no shortcut that fills them either', () => {
    // `Use 52w range` was the opt-in version, and still the wrong shape: a
    // second decision on a card with one thing to offer, producing numbers
    // nobody would have typed.
    const { container } = view()
    expect(slot(container, 'ladder-seed')).toBeNull()
    expect(container.querySelector('input')).toBeNull()
    expect(slot(container, 'ladder-save')).toBeNull()
  })

  it('draws no conclusion, having no numbers to draw one from', () => {
    const { container } = view()
    expect(slot(container, 'ladder-skew')).toBeNull()
    expect(all(container, 'ladder-chg')).toHaveLength(0)
  })

  it('does not style the empty rung as a figure', () => {
    const { container } = view()
    expect(inRow(container, 'Bull', 'ladder-value').className).not.toMatch(/font-bold/)
  })

  it('says only that nothing is on record', () => {
    const { container } = view()
    expect(slot(container, 'ladder-note').textContent).toBe('No target on record')
  })
})

describe('the range is context, not a case', () => {
  it('shows what the market has already paid', () => {
    // A fact, labelled as one, in a slot that never holds a case — and the
    // cheapest reality check there is when pricing a name from nothing.
    const { container } = view()
    expect(slot(container, 'ladder-52w').textContent).toContain('$150.00')
    expect(slot(container, 'ladder-52w').textContent).toContain('$260.00')
  })

  it('says nothing where there is no price history', () => {
    const { container } = view({ range52w: null })
    expect(slot(container, 'ladder-52w')).toBeNull()
    expect(all(container, 'ladder-row')).toHaveLength(3)
  })
})

describe('the rows read as one list', () => {
  it('shows three rungs, high to low', () => {
    const { container } = view()
    expect(all(container, 'ladder-row').map(r => r.getAttribute('data-rung')))
      .toEqual(['Bull', 'Base', 'Bear'])
  })

  it('keeps them adjacent rather than spread down the pane', () => {
    // The block was `flex-1`, so the pane's spare height opened up between the
    // last rung and the line under it and the rows read as scattered.
    const { container } = view()
    expect(slot(container, 'ladder-rows').className).toContain('shrink-0')
    expect(slot(container, 'ladder-rows').className).not.toContain('flex-1')
  })

  it('shows the horizon on every rung', () => {
    // A price with no expiry cannot go stale, cannot be checked and cannot be
    // wrong, so a card offering to record one owes the reader the date.
    const { container } = view()
    expect(all(container, 'ladder-horizon').map(n => n.textContent)).toEqual(['12M', '12M', '12M'])
  })

  it('always says what a tap does', () => {
    const { container } = view()
    expect(slot(container, 'ladder-hint').textContent).toMatch(/Tap a case to record it/)
  })
})

describe('every row opens the full editor', () => {
  it('passes the rung it was tapped on, and the horizon', () => {
    const { container, onOpenDetails } = view()
    fireEvent.click(row(container, 'Bull'))
    expect(onOpenDetails).toHaveBeenCalledWith('Bull', DEFAULT_LADDER_HORIZON)
  })

  it('opens on whichever rung was tapped', () => {
    const { container, onOpenDetails } = view()
    fireEvent.click(row(container, 'Bear'))
    expect(onOpenDetails).toHaveBeenCalledWith('Bear', DEFAULT_LADDER_HORIZON)
  })

  it('passes no price, because it has none to pass', () => {
    const { container, onOpenDetails } = view()
    fireEvent.click(row(container, 'Base'))
    expect(onOpenDetails.mock.calls[0]).toHaveLength(2)
  })

  it('makes the whole row the target, not a word inside it', () => {
    // One action per row means the row is the button — nothing competing for
    // the same tap on a 30px line.
    const { container } = view()
    expect(row(container, 'Bull').tagName).toBe('BUTTON')
  })
})
