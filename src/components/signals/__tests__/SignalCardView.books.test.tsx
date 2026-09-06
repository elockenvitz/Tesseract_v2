import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { SignalCardView } from '../SignalCardView'
import { buildCrowdingCard } from '../../../lib/signals/builders/legacy-kinds'
import type { CardResult, SignalCard } from '../../../lib/signals/contract'

/**
 * The count is a door, not a label.
 *
 * The builders decide the WORDING (`N portfolios`) and hand over a payload;
 * this asserts the other half — that the payload lands on the one disclosure
 * `SignalCardView` already has, and that a card gets no second way to show a
 * list of books. A builder emitting a perfect `portfolios` array that nothing
 * renders is the state this stage started in.
 */

const unwrap = (r: CardResult): SignalCard => {
  if (!r.ok) throw new Error(`suppressed: ${r.reason}`)
  return r.card
}

const CROWDED = unwrap(buildCrowdingCard({
  asOf: new Date(Date.now() - 30 * 86_400_000).toISOString(),
  assetId: 'a1', symbol: 'AAPL', companyName: 'Apple',
  portfolioCount: 3,
  totalValue: 4_043_921,
  maxWeightPct: 25.32,
  portfolioNames: ['Large Cap Growth', 'Large Cap Core', 'Vision Fund 5K'],
  weightsByPortfolio: [
    { id: 'p1', name: 'Large Cap Growth', weightPct: 25.32, valueUsd: 26_325 },
    { id: 'p2', name: 'Large Cap Core', weightPct: 15.22, valueUsd: 17_550 },
    { id: 'p3', name: 'Vision Fund 5K', weightPct: 4.00, valueUsd: 4_000_371 },
  ],
} as never))

const mount = (card: SignalCard = CROWDED, onOpenPortfolio = vi.fn()) => {
  const r = render(
    <SignalCardView card={card} onAction={vi.fn()} onOpen={vi.fn()} onOpenPortfolio={onOpenPortfolio} />,
  )
  return { ...r, onOpenPortfolio }
}

describe('the count opens the disclosure the card already had', () => {
  it('renders the count as the trigger, closed', () => {
    mount()
    const trigger = screen.getByRole('button', { name: /3 portfolios/ })
    expect(trigger).toHaveAttribute('data-slot', 'context-disclose')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('portfolio-disclosure')).toBeNull()
  })

  it('opens the shared sheet, with every book in it', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: /3 portfolios/ }))
    // `document`, not the card's container: the sheet is a portal that rises
    // OVER the card rather than expanding inside it, which is the reason a
    // 48-character book name costs the collapsed row nothing.
    const rows = document.querySelectorAll('[data-slot="portfolio-row"]')
    expect(rows).toHaveLength(3)
    // Not a truncated list with a remainder line — the sheet scrolls.
    expect(document.body.textContent).not.toMatch(/\+\s*\d+ more/)
  })

  it('labels every figure it shows', () => {
    // 25.3% beside $26k with no labels asks the reader which is which, and
    // this card's whole point is that the two rank differently.
    mount()
    fireEvent.click(screen.getByRole('button', { name: /3 portfolios/ }))
    const first = document.querySelector('[data-slot="portfolio-row"]')!
    expect(first.querySelector('[data-slot="pf-weight"]')?.textContent).toMatch(/Portfolio.*25\.3%/)
    expect(first.querySelector('[data-slot="pf-value"]')?.textContent).toMatch(/Value/)
  })

  it('gives each row a way out to the book itself', () => {
    const { onOpenPortfolio } = mount()
    fireEvent.click(screen.getByRole('button', { name: /3 portfolios/ }))
    const open = document.querySelectorAll('[data-slot="portfolio-open"]')
    expect(open.length).toBe(3)
    fireEvent.click(open[0])
    expect(onOpenPortfolio).toHaveBeenCalled()
  })

  it('closes on a second press, leaving the row as it was', () => {
    mount()
    const trigger = screen.getByRole('button', { name: /3 portfolios/ })
    fireEvent.click(trigger)
    fireEvent.click(trigger)
    expect(document.querySelectorAll('[data-slot="portfolio-row"]')).toHaveLength(0)
    expect(screen.getByRole('button', { name: /3 portfolios/ })).toBeInTheDocument()
  })
})

describe('the collapsed row', () => {
  it('does not print the book names beside the count', () => {
    const { container } = mount()
    const row = container.querySelector('[data-slot="context-disclose"]')!
      .closest('div')!.parentElement!
    expect(row.textContent).not.toMatch(/Large Cap Growth|Vision Fund/)
  })

  it('leaves the names untouched once the sheet is open', () => {
    // The disclosure is an overlay; the row underneath it does not change,
    // which is why a 48-character book name costs the card nothing.
    const { container } = mount()
    const row = container.querySelector('[data-slot="context-disclose"]')!
      .closest('div')!.parentElement!
    const before = row.textContent
    fireEvent.click(screen.getByRole('button', { name: /3 portfolios/ }))
    expect(row.textContent).toBe(before)
  })
})
