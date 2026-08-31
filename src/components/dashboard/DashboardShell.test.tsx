/**
 * Browse, focus, deep — three states, one tab.
 *
 * The bug this suite exists to prevent: a Dashboard action that navigates.
 * Clicking an issue must move between two states of the SAME Dashboard tab;
 * only an explicit "Open full Asset" may open a top-level work tab.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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
      'data-selected':
        props.selectedAssetId ?? props.selectedIdeaId ?? props.selectedDecisionId ?? '',
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
import { openDashboardFocus } from '../../lib/dashboard/focus'

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

describe('focus is a state of this tab, not a destination', () => {
  it('enters Focus Mode on the lens that owns the issue', async () => {
    render(<DashboardShell />)
    await React.act(async () => {
      openDashboardFocus({
        lens: 'research', objectType: 'asset', objectId: 'a-tgt',
        symbol: 'TGT', issue: 'Thesis may be stale', origin: 'today',
      })
    })

    const lens = screen.getByTestId('lens-research')
    expect(lens).toHaveAttribute('data-selected', 'a-tgt')
    expect(lens).toHaveAttribute('data-issue', 'Thesis may be stale')
  })

  it('creates no tab', async () => {
    render(<DashboardShell />)
    await React.act(async () => {
      openDashboardFocus({
        lens: 'research', objectType: 'asset', objectId: 'a-tgt', origin: 'today',
      })
    })
    // The shell channel is how tabs get made. Nothing is put on it.
    expect(tabEvents).toHaveLength(0)
  })

  it('routes each object type to its own lens', async () => {
    render(<DashboardShell />)
    for (const [lens, id] of [
      ['ideas', 'i-1'], ['portfolio', 'a-1'], ['decisions', 'd-1'],
    ] as const) {
      await React.act(async () => {
        openDashboardFocus({ lens, objectType: 'asset', objectId: id })
      })
      expect(screen.getByTestId(`lens-${lens}`)).toBeInTheDocument()
    }
    expect(tabEvents).toHaveLength(0)
  })

  it('carries book context into the Portfolio lens', async () => {
    render(<DashboardShell />)
    await React.act(async () => {
      openDashboardFocus({
        lens: 'portfolio', objectType: 'position', objectId: 'a-jnj',
        portfolioId: 'p-lcc', portfolioName: 'Large Cap Core',
        issue: 'Core thesis not written', origin: 'today',
      })
    })
    const lens = screen.getByTestId('lens-portfolio')
    expect(lens).toHaveAttribute('data-book', 'p-lcc')
    expect(lens).toHaveAttribute('data-selected', 'a-jnj')
  })

  it('clears the focus when the reader chooses a lens by hand', async () => {
    const user = userEvent.setup()
    render(<DashboardShell />)
    await React.act(async () => {
      openDashboardFocus({ lens: 'research', objectType: 'asset', objectId: 'a-tgt' })
    })
    expect(screen.getByTestId('lens-research')).toHaveAttribute('data-selected', 'a-tgt')

    // Choosing Portfolio is a decision to browse, not a request to keep
    // reading somebody else's issue.
    await user.click(screen.getByRole('button', { name: /Portfolio/i }))
    await user.click(screen.getByRole('button', { name: /Research/i }))
    expect(screen.getByTestId('lens-research')).toHaveAttribute('data-selected', '')
  })

  it('ignores a focus request with nothing to focus', async () => {
    render(<DashboardShell />)
    expect(openDashboardFocus({ objectId: '' } as any)).toBe(false)
    expect(openDashboardFocus({ lens: 'research' } as any)).toBe(false)
    expect(screen.getByTestId('lens-today')).toBeInTheDocument()
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
