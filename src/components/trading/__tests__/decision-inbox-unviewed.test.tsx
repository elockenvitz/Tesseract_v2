/**
 * The Decision Inbox strip stays amber while a pending decision is unviewed.
 *
 * Reported on a phone: the strip was amber on the first visit to the Pipeline,
 * and after leaving and coming back — without ever opening the inbox — it was
 * neutral, with no "1 pending" badge either.
 *
 * The panel learns its count from the inbox's `onPendingCountChange`, fired in
 * the inbox's effect. The panel also reset that count in an effect keyed on
 * `portfolioId`, which runs on mount — and React runs a child's effects before
 * its parent's. With the requests cached, the inbox reported first and the
 * reset wiped it; the inbox only reports on change, so it never reported again.
 *
 * The stub below reports from a mount effect, exactly as the cached inbox does,
 * so the ordering under test is the real one.
 */
import { useEffect, useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const inbox = vi.hoisted(() => ({ count: 1 }))

vi.mock('../DecisionInbox', () => ({
  DecisionInbox: ({ onPendingCountChange }: { onPendingCountChange?: (n: number) => void }) => {
    useEffect(() => { onPendingCountChange?.(inbox.count) }, [onPendingCountChange])
    return <div data-testid="inbox-body" />
  },
}))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../../contexts/OrganizationContext', () => ({ useOrganization: () => ({ currentOrgId: 'o1' }) }))

import { DecisionInboxPanel } from '../DecisionInboxPanel'

/** The phone Pipeline's wiring: a sheet, controlled, no `pendingCount` fallback. */
function Pipeline({ portfolioId }: { portfolioId?: string }) {
  const [collapsed, setCollapsed] = useState(true)
  return (
    <div className="relative">
      <DecisionInboxPanel variant="sheet" portfolioId={portfolioId} collapsed={collapsed} onToggleCollapsed={() => setCollapsed(c => !c)} />
    </div>
  )
}

const strip = () => screen.getByText('Decision Inbox').closest('[role="button"]') as HTMLElement
const isAmber = () => strip().className.includes('bg-amber-50')

beforeEach(() => {
  localStorage.clear()
  inbox.count = 1
})
afterEach(cleanup)

describe('an unviewed pending decision', () => {
  it('shows amber and the badge on the first visit', () => {
    render(<Pipeline />)
    expect(isAmber()).toBe(true)
    expect(screen.getByText('1 pending')).toBeTruthy()
  })

  it('still shows amber after leaving the Pipeline and coming back, without opening the inbox', () => {
    const first = render(<Pipeline />)
    expect(isAmber()).toBe(true)
    first.unmount()

    render(<Pipeline />)
    expect(isAmber()).toBe(true)
    expect(screen.getByText('1 pending')).toBeTruthy()
  })

  it('stays amber across several return visits', () => {
    for (let i = 0; i < 3; i++) {
      const visit = render(<Pipeline />)
      expect(isAmber()).toBe(true)
      visit.unmount()
    }
  })
})

describe('once viewed', () => {
  it('goes neutral after the inbox is opened and closed, and stays neutral on return', () => {
    const first = render(<Pipeline />)
    fireEvent.click(strip())
    fireEvent.click(screen.getByRole('button', { name: 'Close Decision Inbox' }))
    expect(isAmber()).toBe(false)
    // The count is still shown; it is just no longer new.
    expect(screen.getByText('1 pending')).toBeTruthy()
    first.unmount()

    render(<Pipeline />)
    expect(isAmber()).toBe(false)
  })

  it('turns amber again when a new decision arrives', () => {
    const first = render(<Pipeline />)
    fireEvent.click(strip())
    fireEvent.click(screen.getByRole('button', { name: 'Close Decision Inbox' }))
    first.unmount()

    inbox.count = 2
    render(<Pipeline />)
    expect(isAmber()).toBe(true)
    expect(screen.getByText('2 pending')).toBeTruthy()
  })
})

describe('switching portfolio', () => {
  it('does not carry one portfolio’s count into another', () => {
    const { rerender } = render(<Pipeline portfolioId="p1" />)
    expect(screen.getByText('1 pending')).toBeTruthy()
    inbox.count = 0
    rerender(<Pipeline portfolioId="p2" />)
    expect(screen.queryByText('1 pending')).toBeNull()
    expect(isAmber()).toBe(false)
  })
})
