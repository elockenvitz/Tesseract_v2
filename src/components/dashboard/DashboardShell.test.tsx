/**
 * Browse, focus, deep — three states, one tab.
 *
 * The bug this suite exists to prevent: a Dashboard action that navigates.
 * Clicking an issue must move between two states of the SAME Dashboard tab;
 * only an explicit "Open full Asset" may open a top-level work tab.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'

/**
 * Each lens is stubbed, and reports what it was handed through data
 * attributes rather than a captured array.
 *
 * `vi.mock` factories are hoisted above every top-level binding, so each builds
 * its stub inline; reading the DOM avoids needing shared mutable state up here
 * at all.
 */
const stub = vi.hoisted(() => (lens: string) => (props: any) =>
  ({
    type: 'div',
    key: null,
    ref: null,
    props: {
      'data-testid': `lens-${lens}`,
      'data-selected': props.focusObjectId ?? '',
      'data-book': props.selectedPortfolioId ?? '',
      'data-issue': props.issue ?? '',
    },
    $$typeof: Symbol.for('react.element'),
  }) as any)

vi.mock('../today/TodayPage', () => ({ TodayPage: stub('today') }))
vi.mock('../ideas-v2/IdeasWorkspace', () => ({ IdeasWorkspace: stub('ideas') }))
vi.mock('../research-v2/ResearchWorkspace', () => ({ ResearchWorkspace: stub('research') }))
vi.mock('../portfolio-v2/PortfolioWorkspace', () => ({ PortfolioWorkspace: stub('portfolio') }))
vi.mock('../decisions-v2/DecisionsWorkspace', () => ({ DecisionsWorkspace: stub('decisions') }))

import { DashboardShell } from './DashboardShell'
import { openDashboardFocus, type RailCard } from '../../lib/dashboard/focus'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const tabEvents: CustomEvent[] = []
const capture = (e: Event) => tabEvents.push(e as CustomEvent)

beforeEach(() => {
  tabEvents.length = 0
  window.addEventListener('decision-engine-action', capture)
})
afterEach(() => window.removeEventListener('decision-engine-action', capture))

describe('one Dashboard, five lenses', () => {
  it('opens on Today and offers all five', () => {
    render(<DashboardShell />)
    expect(screen.getByTestId('lens-today')).toBeInTheDocument()
    for (const l of ['today', 'ideas', 'research', 'portfolio', 'decisions']) {
      expect(screen.getByRole('button', { name: new RegExp(l, 'i') })).toBeInTheDocument()
    }
  })

  it('mounts one lens at a time', async () => {
    const user = userEvent.setup()
    render(<DashboardShell />)
    await user.click(screen.getByRole('button', { name: /Research/i }))
    expect(screen.getByTestId('lens-research')).toBeInTheDocument()
    expect(screen.queryByTestId('lens-today')).not.toBeInTheDocument()
  })

  it('opens a saved v2 session on its own lens', () => {
    render(<DashboardShell initialLens="portfolio" selectedPortfolioId="p1" />)
    expect(screen.getByTestId('lens-portfolio')).toHaveAttribute('data-book', 'p1')
  })
})

const card = (id: string, over: Partial<RailCard> = {}): RailCard => ({
  id, workspaceLens: 'research', objectType: 'asset',
  symbol: id.toUpperCase(), reason: 'Thesis may be stale',
  figure: '247d', figureLabel: 'since the case', detail: 'Nobody has revisited it.',
  ...over,
})

const fromToday = (objectId = 'a-tgt', rail = [card('a-amzn'), card('a-wmt')]) =>
  openDashboardFocus({
    target: {
      originLens: 'today', workspaceLens: 'research', objectType: 'asset',
      objectId, symbol: 'TGT', issue: 'Thesis may be stale', origin: 'today',
    },
    backLabel: 'Today',
    rail,
  })

describe('expanding a card, in this tab', () => {
  it('expands the card and keeps the deck it came from alive', async () => {
    render(<DashboardShell />)
    await React.act(async () => { fromToday() })

    // The workspace that answers the issue is research-shaped...
    expect(screen.getByTestId('lens-research')).toHaveAttribute('data-selected', 'a-tgt')
    // ...and the deck underneath is still Today, still mounted, so its scroll
    // and selection survive the return.
    expect(screen.getByTestId('lens-today')).toBeInTheDocument()
    expect(screen.getByTestId('dashboard-browse')).toHaveAttribute('aria-hidden', 'true')
  })

  it('creates no tab', async () => {
    render(<DashboardShell />)
    await React.act(async () => { fromToday() })
    expect(tabEvents).toHaveLength(0)
  })

  it('names Back for the deck, never for the workspace', async () => {
    render(<DashboardShell />)
    await React.act(async () => { fromToday() })
    // The bug this fixes: a research-shaped workspace offering "All research"
    // to a reader who was never in Research.
    expect(screen.getByTestId('workspace-back')).toHaveTextContent('Today')
    expect(screen.getByTestId('workspace-back')).not.toHaveTextContent(/research/i)
  })

  it('returns to the deck it came from', async () => {
    const user = userEvent.setup()
    render(<DashboardShell />)
    await React.act(async () => { fromToday() })
    await user.click(screen.getByTestId('workspace-back'))

    expect(screen.queryByTestId('dashboard-focus')).not.toBeInTheDocument()
    expect(screen.getByTestId('dashboard-browse')).not.toHaveAttribute('aria-hidden')
    expect(screen.getByTestId('lens-today')).toBeInTheDocument()
  })

  it('carries book context into a portfolio-origin deck', async () => {
    render(<DashboardShell />)
    await React.act(async () => {
      openDashboardFocus({
        target: {
          originLens: 'portfolio', workspaceLens: 'portfolio', objectType: 'position',
          objectId: 'a-jnj', portfolioId: 'p-lcc', portfolioName: 'Large Cap Core',
          issue: 'Core thesis not written', origin: 'portfolio',
        },
        backLabel: 'Large Cap Core',
        rail: [card('a-aapl', { workspaceLens: 'portfolio', objectType: 'position' })],
      })
    })
    const focus = within(screen.getByTestId('dashboard-focus'))
    const lens = focus.getByTestId('lens-portfolio')
    expect(lens).toHaveAttribute('data-book', 'p-lcc')
    expect(lens).toHaveAttribute('data-selected', 'a-jnj')
    expect(screen.getByTestId('workspace-back')).toHaveTextContent('Large Cap Core')
  })

  it('refuses a request that names no card or no deck', () => {
    render(<DashboardShell />)
    expect(openDashboardFocus({ target: { objectId: '' } } as any)).toBe(false)
    expect(openDashboardFocus({ target: { objectId: 'x' } } as any)).toBe(false)
    expect(screen.queryByTestId('dashboard-focus')).not.toBeInTheDocument()
  })
})

describe('rotating through the work', () => {
  it('swaps the expanded card in place, without a tab', async () => {
    const user = userEvent.setup()
    render(<DashboardShell />)
    await React.act(async () => { fromToday() })

    await user.click(screen.getAllByTestId('rail-card')[0])
    expect(screen.getByTestId('lens-research')).toHaveAttribute('data-selected', 'a-amzn')
    expect(tabEvents).toHaveLength(0)
  })

  it('never lets the latest card become the new origin', async () => {
    const user = userEvent.setup()
    render(<DashboardShell />)
    await React.act(async () => { fromToday() })

    await user.click(screen.getAllByTestId('rail-card')[0])   // AMZN
    await user.click(screen.getAllByTestId('rail-card')[0])   // WMT
    expect(screen.getByTestId('lens-research')).toHaveAttribute('data-selected', 'a-wmt')
    // Two rotations later, Back still means the deck the reader started in.
    expect(screen.getByTestId('workspace-back')).toHaveTextContent('Today')
    expect(screen.getByTestId('lens-today')).toBeInTheDocument()
  })

  it('never shows the expanded card as a peer', async () => {
    render(<DashboardShell />)
    await React.act(async () => {
      fromToday('a-tgt', [card('a-tgt'), card('a-amzn')])
    })
    // Duplicating it would print the same identity, issue and metric twice.
    const ids = screen.getAllByTestId('rail-card').map(el => el.textContent)
    expect(ids.some(t => t?.includes('A-TGT'))).toBe(false)
  })

  it('leaves the deck when the reader chooses a lens by hand', async () => {
    const user = userEvent.setup()
    render(<DashboardShell />)
    await React.act(async () => { fromToday() })

    // An explicit navigation, so the stale workspace does not survive it.
    await user.click(screen.getByRole('button', { name: /Decisions/i }))
    expect(screen.queryByTestId('dashboard-focus')).not.toBeInTheDocument()
    expect(screen.getByTestId('lens-decisions')).toBeInTheDocument()
  })
})

describe('the rail is a deck, not a sidebar', () => {
  it('sits on the left of the work surface', async () => {
    render(<DashboardShell />)
    await React.act(async () => { fromToday() })
    const deck = screen.getByTestId('work-deck')
    const rail = screen.getByTestId('work-rail')
    const surface = screen.getByTestId('work-surface')
    // Document order inside a flex row is left-to-right.
    expect(deck.firstElementChild).toBe(rail)
    expect(rail.compareDocumentPosition(surface) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps its column at laptop width', () => {
    // The rail is core to the interaction, not decoration: hiding it below
    // 2xl would remove the deck on the viewport most readers actually use.
    const rail = readFileSync(join(process.cwd(), 'src/components/dashboard/WorkDeck.tsx'), 'utf8')
    expect(rail).toContain('lg:block')
    expect(rail).not.toContain('2xl:block')
  })

  it('carries a reason and a figure, not four text rows', async () => {
    render(<DashboardShell />)
    await React.act(async () => { fromToday() })
    const first = screen.getAllByTestId('rail-card')[0]
    expect(first).toHaveTextContent('Thesis may be stale')
    expect(first).toHaveTextContent('247d')
    expect(first).toHaveTextContent('Nobody has revisited it.')
  })

  it('is reachable by keyboard', async () => {
    const user = userEvent.setup()
    render(<DashboardShell />)
    await React.act(async () => { fromToday() })

    screen.getByTestId('workspace-back').focus()
    await user.tab()
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('lens-research')).toHaveAttribute('data-selected', 'a-amzn')
  })
})

describe('the lens bar is navigation, not a second heading', () => {
  it('marks the current lens for assistive technology', async () => {
    const user = userEvent.setup()
    render(<DashboardShell />)
    await user.click(screen.getByRole('button', { name: /Decisions/i }))
    expect(screen.getByRole('button', { name: /Decisions/i }))
      .toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: /Today/i }))
      .not.toHaveAttribute('aria-current')
  })

  it('names itself', () => {
    render(<DashboardShell />)
    expect(screen.getByRole('navigation', { name: /Dashboard lenses/i })).toBeInTheDocument()
  })
})
