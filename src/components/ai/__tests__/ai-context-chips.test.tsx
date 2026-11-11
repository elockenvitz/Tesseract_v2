/**
 * The indicator row, and the one thing it must never do: claim a subject the
 * reader has walked away from.
 *
 * The engagement target is frozen at the last engagement and is never
 * cleared, so a row that read it unconditionally announced "AAPL" over an
 * MSFT thread. That is the same defect the bound-object header was fixed for,
 * and this row would have reintroduced it one band lower on the screen.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AiContextChips } from '../AiContextChips'

const AAPL_TARGET = {
  objectType: 'asset', objectId: 'a1', label: 'AAPL - Apple Inc.',
  symbol: 'AAPL', portfolioName: 'Growth Composite',
  issue: { title: 'Price target expired' },
}

describe('AiContextChips', () => {
  it('names the active object', () => {
    render(<AiContextChips subject={{ type: 'asset', id: 'a1', label: 'AAPL - Apple Inc.' }} />)
    expect(screen.getByTestId('ai-context-chips')).toBeTruthy()
    expect(screen.getByText('AAPL')).toBeTruthy()
    expect(screen.getByText('Asset')).toBeTruthy()
  })

  it('takes the ticker, portfolio and reason from the target while it is current', () => {
    render(
      <AiContextChips
        subject={{ type: 'asset', id: 'a1', label: 'AAPL - Apple Inc.' }}
        target={AAPL_TARGET}
      />,
    )
    expect(screen.getByText('Growth Composite')).toBeTruthy()
    expect(screen.getByText('Price target expired')).toBeTruthy()
  })

  it('drops the target entirely once the reader has moved on', () => {
    /* Standing on MSFT with an AAPL engagement still in hand. */
    render(
      <AiContextChips
        subject={{ type: 'asset', id: 'a2', label: 'MSFT - Microsoft Corporation' }}
        target={AAPL_TARGET}
      />,
    )
    expect(screen.getByText('MSFT')).toBeTruthy()
    expect(screen.queryByText('AAPL')).toBeNull()
    expect(screen.queryByText('Growth Composite')).toBeNull()
    expect(screen.queryByText('Price target expired')).toBeNull()
  })

  it('shows the target when there is no subject to contradict it', () => {
    /* A reader on a dashboard binds nothing; absent is agreement. */
    render(<AiContextChips target={AAPL_TARGET} />)
    expect(screen.getByText('AAPL')).toBeTruthy()
  })

  it('renders nothing at all when nothing is bound', () => {
    const { container } = render(<AiContextChips />)
    expect(container.firstChild).toBeNull()
  })

  it('shortens a tab title instead of printing both halves', () => {
    render(<AiContextChips subject={{ type: 'portfolio', id: 'p1', label: 'Growth Composite - Equity' }} />)
    expect(screen.getByText('Growth Composite')).toBeTruthy()
    expect(screen.getByText('Portfolio')).toBeTruthy()
  })

  it('gives the reason more room in research mode than on the rail', () => {
    const rail = render(
      <AiContextChips subject={{ type: 'asset', id: 'a1', label: 'AAPL' }} target={AAPL_TARGET} mode="compact" />,
    )
    const railClass = rail.getByText('Price target expired').className
    rail.unmount()

    const wide = render(
      <AiContextChips subject={{ type: 'asset', id: 'a1', label: 'AAPL' }} target={AAPL_TARGET} mode="research" />,
    )
    const wideClass = wide.getByText('Price target expired').className

    expect(railClass).toContain('max-w-[9rem]')
    expect(wideClass).toContain('max-w-[22rem]')
  })

  it('is display only: no control, no handler, nothing to click', () => {
    /* The model's context is assembled server-side from the conversation's
       tags. A chip that could set context would be a second source of truth
       for what the model was told. */
    const { container } = render(
      <AiContextChips subject={{ type: 'asset', id: 'a1', label: 'AAPL' }} target={AAPL_TARGET} />,
    )
    expect(container.querySelectorAll('button')).toHaveLength(0)
    expect(container.querySelectorAll('a')).toHaveLength(0)
    expect(container.querySelectorAll('input')).toHaveLength(0)
  })
})
