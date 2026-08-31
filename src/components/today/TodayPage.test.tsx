/**
 * Focused test for the Today surface's composition and states.
 *
 * The engine and the durable-state hook are mocked: both are already covered
 * by their own tests, and what this file is for is the page's own decisions —
 * how many tiles it shows, which one is featured, what it says it did not
 * show, and what a quiet morning looks like.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import type { DecisionItem } from '../../engine/decisionEngine/types'

const engine = { action: [] as DecisionItem[], intel: [] as DecisionItem[] }
let suppressed = new Set<string>()
const dismissForMe = vi.fn()
const snoozeForMe = vi.fn()

vi.mock('../../engine/decisionEngine', () => ({
  useDecisionEngine: () => ({
    selectForDashboard: () => engine,
    isLoading: false,
  }),
}))

vi.mock('../../engine/decisionEngine/dispatchDecisionAction', () => ({
  dispatchDecisionAction: vi.fn(),
}))

/**
 * Enrichment is mocked and its input captured.
 *
 * The property that matters is SCOPE: the hook must be handed only what
 * surfaced, never the whole candidate pool -- that is the difference between
 * four symbols of price history and the entire book's.
 */
const enrichedWith: string[][] = []
vi.mock('../../hooks/useTodayEnrichment', () => ({
  useTodayEnrichment: (items: { ticker: string | null }[]) => {
    enrichedWith.push(items.map(i => i.ticker ?? '?'))
    return {}
  },
}))

vi.mock('../../hooks/useAttentionState', () => ({
  useAttentionState: () => ({
    suppressedKeys: suppressed,
    dismissForMe,
    snoozeForMe,
    isLoading: false,
  }),
}))

const { TodayPage } = await import('./TodayPage')

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}><TodayPage /></QueryClientProvider>,
  )
}

const stale = (n: number, over: Partial<DecisionItem> = {}): DecisionItem => ({
  id: `thesis-stale-${n}`,
  surface: 'action',
  severity: 'orange',
  category: 'risk',
  title: 'Thesis May Be Stale',
  titleKey: 'THESIS_STALE',
  description: 'Research thesis has not been updated recently.',
  chips: [{ label: 'Ticker', value: `TCK${n}` }, { label: 'Age', value: `${100 + n}d` }],
  context: { assetId: `a-${n}`, assetTicker: `TCK${n}` },
  ctas: [{ label: 'Update Thesis', actionKey: 'OPEN_ASSET_UPDATE_THESIS', kind: 'primary' }],
  sortScore: 0,
  ...over,
} as DecisionItem)

beforeEach(() => {
  engine.action = []
  engine.intel = []
  suppressed = new Set()
  dismissForMe.mockClear()
  snoozeForMe.mockClear()
  enrichedWith.length = 0
})

describe('TodayPage', () => {
  it('features exactly one item and ranks the rest as supporting', () => {
    engine.action = [stale(1), stale(2), stale(3)]
    renderPage()

    expect(screen.getByText('Featured')).toBeInTheDocument()
    expect(screen.getByText('Supporting priorities')).toBeInTheDocument()

    const tiles = screen.getAllByTestId('today-tile')
    expect(tiles).toHaveLength(3)
    expect(tiles[0]).toHaveAttribute('data-rank', '1')
    expect(tiles.map(t => t.getAttribute('data-rank'))).toEqual(['1', '2', '3'])
  })

  it('puts the highest tier first, whatever order the engine returned', () => {
    // A workflow item listed first must not lead a capital-at-risk one.
    engine.action = [
      stale(1, { id: 'w', titleKey: 'OVERDUE_DELIVERABLE', severity: 'red' }),
      stale(2, { id: 'x', titleKey: 'EXECUTION_NOT_CONFIRMED', severity: 'red' }),
    ]
    renderPage()
    expect(screen.getAllByTestId('today-tile')[0]).toHaveAttribute('data-tier', '0')
  })

  it('stays finite and reports what it chose not to show', () => {
    engine.action = Array.from({ length: 7 }, (_, i) => stale(i))
    renderPage()

    expect(screen.getAllByTestId('today-tile')).toHaveLength(4)
    expect(screen.getByText(/3 ranked below the cut/)).toBeInTheDocument()
    expect(screen.getByText(/deliberately did not interrupt you/)).toBeInTheDocument()
  })

  it('shows a single item without an empty supporting section', () => {
    engine.action = [stale(1)]
    renderPage()
    expect(screen.getAllByTestId('today-tile')).toHaveLength(1)
    expect(screen.queryByText('Supporting priorities')).not.toBeInTheDocument()
  })

  it('suppresses before the cut, so a dismissal does not waste a slot', () => {
    engine.action = Array.from({ length: 5 }, (_, i) => stale(i))
    suppressed = new Set(['decision:thesis-stale-0'])
    renderPage()

    expect(screen.getAllByTestId('today-tile')).toHaveLength(4)
    expect(screen.queryByText('TCK0')).not.toBeInTheDocument()
    expect(screen.getByText(/1 dismissed or snoozed by you/)).toBeInTheDocument()
  })

  it('shows a deliberate cleared state, not an empty query', () => {
    renderPage()
    expect(screen.getByText("You're current.")).toBeInTheDocument()
    expect(screen.getByText(/Seven evaluators ran/)).toBeInTheDocument()
    expect(screen.getByText(/Watching theses, proposals, ratings and deliverables/)).toBeInTheDocument()
    expect(screen.queryAllByTestId('today-tile')).toHaveLength(0)
  })

  it('says the work was done when everything was handled by the user', () => {
    engine.action = [stale(1)]
    suppressed = new Set(['decision:thesis-stale-1'])
    renderPage()
    expect(screen.getByText("You're current.")).toBeInTheDocument()
    // The cleared state distinguishes "nothing was found" from "you dealt
    // with it" -- a quiet morning you earned should not read like an empty one.
    expect(screen.getByText(/handled by you/)).toBeInTheDocument()
  })

  it('enriches only what surfaced, never the whole candidate pool', () => {
    engine.action = Array.from({ length: 9 }, (_, i) => stale(i))
    renderPage()
    // 9 candidates, 4 slots -- the hook must see 4.
    expect(enrichedWith[enrichedWith.length - 1]).toHaveLength(4)
  })

  it('diversifies the supporting slots when a comparable alternative exists', () => {
    engine.action = [
      stale(1), stale(2), stale(3), stale(4),
      stale(9, {
        id: 'clov', titleKey: 'PROPOSAL_AWAITING_DECISION', severity: 'red',
        title: 'Proposal Awaiting Decision',
        chips: [{ label: 'Ticker', value: 'CLOV' }, { label: 'Open', value: '62d' }],
        context: { assetId: 'c1', assetTicker: 'CLOV', tradeIdeaId: 't1' },
      }),
    ]
    renderPage()
    const tickers = screen.getAllByTestId('today-tile')
      .map(t => t.querySelector('.font-black')?.textContent)
    // #1 is still the highest-ranked stale thesis; CLOV breaks the saturation.
    expect(tickers).toContain('CLOV')
    expect(tickers.filter(t => t?.startsWith('TCK'))).toHaveLength(3)
  })

  it('mixes intel into the same ranked surface rather than a second list', () => {
    engine.action = [stale(1)]
    engine.intel = [stale(2, {
      id: 'ev', surface: 'intel', titleKey: 'HIGH_EV_NO_IDEA', severity: 'blue',
      chips: [{ label: 'Ticker', value: 'EVX' }, { label: 'EV', value: '30% upside' }],
    })]
    renderPage()
    const tiles = screen.getAllByTestId('today-tile')
    expect(tiles).toHaveLength(2)
    // intel is tier 4, so it ranks below the tier-1 stale thesis
    expect(tiles[1]).toHaveAttribute('data-tier', '4')
  })
})
