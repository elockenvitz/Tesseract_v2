/**
 * The Decision Recorded handoff on a phone: the context section is named
 * Decision context and starts shut, and Stay in Trade Lab reads as a control
 * without competing with View in Trade Book. Desktop keeps its labels and its
 * quiet secondary link.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

const viewport = vi.hoisted(() => ({ isMobile: true }))

vi.mock('../../../hooks/useMediaQuery', () => ({ useIsMobile: () => viewport.isMobile }))
vi.mock('../../../contexts/OrganizationContext', () => ({ useOrganization: () => ({ currentOrgId: 'org1' }) }))
vi.mock('../../../lib/pilot/pilot-telemetry', () => ({ logPilotEvent: vi.fn() }))

import { DecisionConfirmationModal, type DecisionRecord } from '../DecisionConfirmationModal'

const THESIS = 'Services margin keeps compounding through the cycle.'

const record: DecisionRecord = {
  decisions: [{
    tradeId: 't1', symbol: 'AAPL', companyName: 'Apple Inc', action: 'add',
    deltaWeight: 1, targetWeight: 3, deltaShares: 120, notional: 27_000,
    priceAtAcceptance: 225, sizingInput: '+1', acceptanceNote: null,
    thesis: THESIS, whyNow: null, beforeWeight: 2, afterWeight: 3,
  }],
  portfolioName: 'Tech & Consumer Growth',
  portfolioId: 'p1',
  recordedAt: new Date().toISOString(),
  batchId: 'b1',
}

function mount() {
  return render(<DecisionConfirmationModal record={record} onClose={vi.fn()} onViewTradeBook={vi.fn()} />)
}

const stay = () => screen.getByRole('button', { name: 'Stay in Trade Lab' })

afterEach(() => { cleanup(); viewport.isMobile = true })

describe('Decision Recorded on a phone', () => {
  it('names the collapsed section Decision context and keeps it shut', () => {
    const { container } = mount()
    const toggle = container.querySelector('[data-slot="decision-captured-toggle"]') as HTMLElement
    expect(toggle.textContent).toContain('Decision context')
    expect(toggle.textContent).not.toContain('What was captured')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText(THESIS)).toBeNull()
  })

  it('still opens to the same context on tap', () => {
    const { container } = mount()
    fireEvent.click(container.querySelector('[data-slot="decision-captured-toggle"]') as HTMLElement)
    expect(screen.getByText(THESIS)).toBeTruthy()
  })

  it('keeps the execution summary and the pinned primary action', () => {
    const { container } = mount()
    expect(screen.getByText('What was executed')).toBeTruthy()
    expect(container.querySelector('[data-slot="decision-view-trade-book"]')).not.toBeNull()
  })

  it('gives Stay in Trade Lab legible, text-only styling', () => {
    mount()
    const cls = stay().className
    expect(cls).toContain('text-gray-600')
    expect(cls).toContain('font-medium')
    expect(cls).toContain('underline')
    expect(cls).not.toContain('text-gray-400')
    // Still secondary: no fill, no border, not the Button component.
    expect(cls).not.toMatch(/\bbg-|\bborder\b|shadow/)
  })
})

describe('Decision Recorded on desktop', () => {
  it('is unchanged: What was captured, open, quiet Stay link', () => {
    viewport.isMobile = false
    mount()
    expect(screen.getByText('What was captured')).toBeTruthy()
    expect(screen.queryByText('Decision context')).toBeNull()
    expect(screen.getByText(THESIS)).toBeTruthy()
    const cls = stay().className
    expect(cls).toContain('text-[12px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300')
    expect(cls).not.toContain('underline')
  })
})
