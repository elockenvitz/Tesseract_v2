/**
 * The portfolio on a phone Pipeline card opens Trade Lab for that idea and
 * that portfolio — through the same `openTradeLab` hand-off Decision Inbox and
 * the desktop board use — without also opening the card.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { PipelineCard } from '../MobilePipeline'
import { OPEN_TRADE_LAB_EVENT } from '../../../lib/trade-lab/open-trade-lab'

const row = (over: Record<string, unknown> = {}) => ({
  kind: 'single',
  id: 'tq-1',
  item: {
    id: 'tq-1',
    action: 'buy',
    assets: { symbol: 'NVDA', company_name: 'NVIDIA' },
    portfolio_id: 'p-1',
    portfolios: { id: 'p-1', name: 'Growth Fund' },
    users: { first_name: 'Dana', last_name: 'Analyst' },
    ...over,
  },
}) as never

const seen: CustomEvent[] = []
const listener = (e: Event) => { seen.push(e as CustomEvent); e.preventDefault() }

afterEach(() => {
  window.removeEventListener(OPEN_TRADE_LAB_EVENT, listener)
  seen.length = 0
})

describe('the card portfolio', () => {
  it('is a control naming the portfolio, with the analyst outside it', () => {
    const { container } = render(<PipelineCard row={row()} onOpen={vi.fn()} />)
    const link = container.querySelector('[data-slot="pipeline-card-portfolio"]') as HTMLButtonElement
    expect(link.tagName).toBe('BUTTON')
    expect(link.textContent).toBe('Growth Fund')
    expect(link.getAttribute('aria-label')).toBe('Open Growth Fund in Trade Lab')
    expect(link.textContent).not.toContain('Dana')
    expect(container.textContent).toContain('Dana Analyst')
  })

  it('opens Trade Lab scoped to this idea and this portfolio, and not the card', () => {
    window.addEventListener(OPEN_TRADE_LAB_EVENT, listener)
    const onOpen = vi.fn()
    const { container } = render(<PipelineCard row={row()} onOpen={onOpen} />)
    fireEvent.click(container.querySelector('[data-slot="pipeline-card-portfolio"]')!)
    expect(seen).toHaveLength(1)
    expect(seen[0].detail).toEqual({ portfolioId: 'p-1', tradeQueueItemId: 'tq-1' })
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('still opens the card from anywhere else on it', () => {
    const onOpen = vi.fn()
    const { getByText } = render(<PipelineCard row={row()} onOpen={onOpen} />)
    fireEvent.click(getByText('NVDA'))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('is plain text when the idea has no portfolio', () => {
    const { container } = render(<PipelineCard row={row({ portfolio_id: null, portfolios: null })} onOpen={vi.fn()} />)
    expect(container.querySelector('[data-slot="pipeline-card-portfolio"]')).toBeNull()
    expect(container.textContent).toContain('No portfolio')
  })
})
