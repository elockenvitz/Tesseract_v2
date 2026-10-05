/**
 * The PM must see the consequence before causing it.
 *
 * Under the pilot contract, approving moves the modeled book on click —
 * no OMS, no broker, no queue. The share count is the thing that actually
 * moves it, and the PM never saw a share count: they approved a WEIGHT and
 * the quantity was derived afterwards, out of sight.
 *
 * These assert the rendered strip, not the component's internals, because
 * "the PM can see it" is the requirement.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { ApproveExecutePreview } from '../ApproveExecutePreview'
import { currentBook, type HoldingRow } from '../../../lib/holdings/portfolio-context'

afterEach(cleanup)

const ASSET = 'a-shop'

/** The live SHOP book: 12,000 sh @ $82.40 of a $34,779,457.07 portfolio. */
const BOOK = currentBook([
  { portfolio_id: 'p1', asset_id: ASSET, shares: 12000, price: 82.4, date: '2026-09-29' },
  { portfolio_id: 'p1', asset_id: 'a-2', shares: 100000, price: 337.905707, date: '2026-09-29' },
] as unknown as HoldingRow[])

const mount = (over: Partial<Parameters<typeof ApproveExecutePreview>[0]> = {}) =>
  render(
    <ApproveExecutePreview
      book={BOOK}
      portfolioId="p1"
      assetId={ASSET}
      symbol="SHOP"
      sizingInput="-0.5"
      action="sell"
      isModified={false}
      analystWeight={-0.5}
      {...over}
    />,
  )

describe('what the PM sees before approving', () => {
  it('states the concrete trade as a share count and a direction', () => {
    mount()
    // The number that moves the book, which was previously invisible.
    expect(screen.getByText(/Sell 2,110 SHOP/)).toBeTruthy()
  })

  it('shows the dollar amount and the price it was valued at', () => {
    mount()
    expect(screen.getByText(/\$173\.9K/)).toBeTruthy()
    // With cents. A share price rendered as "$82" misstates the basis the
    // share count was derived from.
    expect(screen.getByText(/@ \$82\.40/)).toBeTruthy()
  })

  it('shows the position now and the position after', () => {
    // JSX splits these across text nodes, so read the rendered text as the
    // PM reads it: as one line.
    const { container } = mount()
    const text = (container.textContent ?? '').replace(/\s+/g, ' ')
    // Position now, position after, and the signed change between them.
    expect(text).toMatch(/12,000 sh/)
    expect(text).toMatch(/2\.84%/)
    expect(text).toMatch(/9,890 sh/)
    expect(text).toMatch(/2\.34%/)
    expect(text).toMatch(/-0\.50%/)
    // Before, then after — in that order, so the arrow reads correctly.
    expect(text.indexOf('12,000 sh')).toBeLessThan(text.indexOf('9,890 sh'))
  })

  it('names the valuation date, so the book can be dated', () => {
    mount()
    expect(screen.getByText(/book of 2026-09-29/)).toBeTruthy()
  })

  it('discloses the pilot assumption in plain words', () => {
    mount()
    expect(screen.getByText(/updates Tesseract's modeled holdings immediately/)).toBeTruthy()
    expect(screen.getByText(/pilot\s+assumes execution; there is no broker confirmation/)).toBeTruthy()
  })

  it('says when the PM changed the analyst’s number', () => {
    mount({ isModified: true, analystWeight: -0.25, sizingInput: '-0.5' })
    expect(screen.getByText(/Modified from the analyst's -0\.25%/)).toBeTruthy()
  })

  it('does not claim a modification when there is none', () => {
    mount()
    expect(screen.queryByText(/Modified from the analyst/)).toBeNull()
  })
})

describe('when the trade cannot be sized, it says so instead of guessing', () => {
  it('refuses to preview an unheld asset', () => {
    mount({ assetId: 'never-held' })
    expect(screen.getByText(/Share quantity not previewable/)).toBeTruthy()
    expect(screen.getByText(/Not currently held/)).toBeTruthy()
  })

  it('does not imply the trade will execute anyway', () => {
    mount({ assetId: 'never-held' })
    expect(screen.getByText(/execution only follows if it can be sized/)).toBeTruthy()
  })

  it('shows no fabricated share count', () => {
    mount({ assetId: 'never-held' })
    expect(screen.queryByText(/Sell|Buy/)).toBeNull()
  })

  it('refuses an instruction it cannot execute rather than approximating', () => {
    mount({ sizingInput: 'pair' })
    expect(screen.getByText(/Share quantity not previewable/)).toBeTruthy()
  })

  it('refuses before the book has loaded', () => {
    mount({ book: undefined })
    expect(screen.getByText(/Reading the current book/)).toBeTruthy()
  })
})
