/**
 * The phone opens the Decision Inbox as a pane, not a squeezed desktop drawer.
 *
 * ── What was wrong at 390px ───────────────────────────────────────────────
 *
 * The phone mounted the desktop drawer unchanged: a 60% bottom drawer with
 * the Pipeline still showing above it, a header with a half/full toggle, the
 * four status tabs and the All / For Me / Sent by Me filter on one line
 * (~560px of controls), and cards laid out as a single sentence of inline
 * pills. The phone base layer then gives every button a 44px minimum, so each
 * tab and filter segment became a block, and the row collided and overflowed.
 *
 * The panel is rendered for real with the inbox body stubbed, because the
 * claim is about the panel's shape and what it hands the body. The body's
 * layout is asserted on source, like the neighbouring inbox test, because
 * rendering it needs the whole decision-request data layer.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const inboxProps: Array<Record<string, unknown>> = []
const lastInboxProps = () => inboxProps[inboxProps.length - 1]

vi.mock('../../trading/DecisionInbox', () => ({
  DecisionInbox: (props: Record<string, unknown>) => {
    inboxProps.push(props)
    return <div data-testid="inbox-body" />
  },
}))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../../contexts/OrganizationContext', () => ({ useOrganization: () => ({ currentOrgId: 'o1' }) }))

import { DecisionInboxPanel } from '../../trading/DecisionInboxPanel'

function Harness({ variant }: { variant?: 'drawer' | 'sheet' }) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div data-testid="board" className="relative">
      <DecisionInboxPanel variant={variant} collapsed={collapsed} onToggleCollapsed={() => setCollapsed(c => !c)} />
    </div>
  )
}

beforeEach(() => { inboxProps.length = 0 })

describe('phone: the open inbox is a full-height pane', () => {
  it('covers its container rather than sitting in a partial drawer', () => {
    const { getByTestId } = render(<Harness variant="sheet" />)
    const pane = getByTestId('board').firstElementChild as HTMLElement
    expect(pane.className).toContain('inset-0')
    expect(pane.className).not.toContain('h-[60%]')
    expect(pane.className).not.toContain('bottom-0')
  })

  it('has a compact header with a clear close control and no fullscreen toggle', () => {
    render(<Harness variant="sheet" />)
    expect(screen.getByRole('heading', { name: 'Decision Inbox' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close Decision Inbox' })).toBeTruthy()
    expect(screen.queryByTitle('Fullscreen')).toBeNull()
    expect(screen.queryByTitle('Exit fullscreen')).toBeNull()
  })

  it('closes through the same toggle the board owns, and returns to the strip', () => {
    const { getByTestId } = render(<Harness variant="sheet" />)
    fireEvent.click(screen.getByRole('button', { name: 'Close Decision Inbox' }))
    const pane = getByTestId('board').firstElementChild as HTMLElement
    expect(pane.className).toContain('bottom-0')
    expect(pane.className).toContain('h-10')
    expect(screen.queryByRole('button', { name: 'Close Decision Inbox' })).toBeNull()
  })

  it('asks the inbox body for its compact layout', () => {
    render(<Harness variant="sheet" />)
    expect(lastInboxProps()?.compact).toBe(true)
    expect(lastInboxProps()?.panelMode).toBe(true)
  })
})

describe('desktop: the drawer is unchanged', () => {
  it('is still the bottom drawer with its fullscreen toggle', () => {
    const { getByTestId } = render(<Harness />)
    const pane = getByTestId('board').firstElementChild as HTMLElement
    expect(pane.className).toContain('bottom-0')
    expect(pane.className).toContain('h-[60%]')
    expect(pane.className).not.toContain('inset-0')
    expect(screen.getByTitle('Fullscreen')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Close Decision Inbox' })).toBeNull()
  })

  it('does not ask the inbox body for the compact layout', () => {
    render(<Harness />)
    expect(lastInboxProps()?.compact).toBe(false)
  })
})

describe('the phone shell uses the sheet', () => {
  const mobile = readFileSync(path.join(process.cwd(), 'src/components/mobile/MobilePipeline.tsx'), 'utf8')
  it('mounts the canonical panel as a sheet', () => {
    expect(mobile).toMatch(/<DecisionInboxPanel\s+variant="sheet"/)
  })
})

describe('the inbox body lays out for a phone when compact', () => {
  const inbox = readFileSync(path.join(process.cwd(), 'src/components/trading/DecisionInbox.tsx'), 'utf8')

  it('lets the status tabs scroll sideways instead of colliding', () => {
    expect(inbox).toContain('compact ? "px-2 gap-1 overflow-x-auto no-scrollbar')
    expect(inbox).toContain("compact && 'shrink-0 whitespace-nowrap h-11 px-2.5 no-touch-target'")
  })

  it('puts the ownership filter on its own row, never beside the tabs', () => {
    expect(inbox).toContain("{!compact && activeTab === 'needs_decision' && buckets.needs_decision.length > 0 && renderWaitingFilter()}")
    expect(inbox).toMatch(/\{compact && activeTab === 'needs_decision'[^\n]*\n\s*<div className="flex-shrink-0 px-3 py-2[^"]*">\s*\{renderWaitingFilter\(\)\}/)
    expect(inbox).toContain('compact ? "grid grid-cols-3 w-full" : "flex items-center ml-auto"')
  })

  it('leads each idea with action and symbol and gives the rationale room', () => {
    expect(inbox).toContain('{compact ? renderCompactIdeaHeader(group, isExpanded) : (')
    const header = inbox.slice(inbox.indexOf('const renderCompactIdeaHeader'), inbox.indexOf('\n  return ('))
    expect(header.indexOf('{group.action}')).toBeLessThan(header.indexOf('{contextText}'))
    expect(header.indexOf('{group.symbol}')).toBeLessThan(header.indexOf('{contextText}'))
    expect(header).toContain('line-clamp-3')
    expect(header).not.toContain('italic truncate')
  })

  it('wraps the portfolio sentence and drops status to its own line', () => {
    expect(inbox).toContain('compact ? "flex-col items-start" : "items-center justify-between"')
    expect(inbox).toContain('compact && "flex-wrap gap-y-1 text-[13px]"')
  })

  it('gives Accept / Reject / Defer full-width, touch-sized buttons', () => {
    expect(inbox).toContain('? "grid grid-cols-3 gap-2 [&>button]:h-11 [&>button]:justify-center')
    expect(inbox).toContain('compact && "gap-2 [&>button]:flex-1 [&>button]:h-11')
  })

  it('threads compact to both card kinds', () => {
    expect(inbox).toMatch(/<PortfolioRow\s+key=\{req\.id\}\s+compact=\{compact\}/)
    expect(inbox).toMatch(/<PairPortfolioGroupRow\s+key=\{portfolioId\}\s+compact=\{compact\}/)
  })
})
