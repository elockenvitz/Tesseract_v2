/**
 * Focused test for the Portfolio workspace.
 *
 * The data hooks are mocked — they are reads, and the model has its own suite.
 * What this file is for is the surface's own decisions: that selecting a book
 * scopes the holdings, that the same asset in two books never shares a weight,
 * that a visual only appears when the data supports it, that the navigator
 * survives selection, and that every route out goes through a seam another
 * stage already owns rather than a second navigation system.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { buildBook, type HoldingRow } from '../../lib/portfolio/holdings'
import { EMPTY_FRAME, type PositionFrame } from '../../lib/desktop-portfolio'
import type { CurrentLadder } from '../../lib/signals/current-ladder'

const DAY = 86_400_000
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString()

const row = (over: Partial<HoldingRow> & { symbol?: string } = {}): HoldingRow => ({
  portfolio_id: 'p1', asset_id: 'a-aapl',
  shares: 100, price: 200, cost: 150, date: '2026-01-01',
  assets: { symbol: over.symbol ?? 'AAPL', company_name: 'Apple Inc.', sector: 'Technology' },
  ...over,
})

const ladder = (cases: [string, number][]): CurrentLadder => ({
  assetId: 'a-aapl', symbol: 'AAPL', companyName: 'Apple Inc.',
  cases: cases.map(([name, price], i) => ({
    scenarioId: `s${i}`, name, price, probability: null, timeframe: null,
    reasoning: null, id: `t${i}`, userId: null,
  })),
  updatedAt: daysAgo(30), valid: cases.length >= 2, reason: '',
})

/* ------------------------------------------------------------------ mocks */

let portfolios: { id: string; name: string; role: 'pm' | 'analyst' | null }[] = []
let rowsByBook: Record<string, HoldingRow[]> = {}
let frames: Record<string, PositionFrame> = {}
let detail: any = { sections: [], alsoHeldIn: [] }
const bookRequestedFor: string[] = []
const detailRequestedFor: string[] = []

vi.mock('../../hooks/useDesktopPortfolio', () => ({
  usePortfolioList: () => ({ portfolios, isLoading: false }),
  useBook: (id: string | null) => {
    if (id) bookRequestedFor.push(id)
    // Deliberately built from the SAME raw rows the real hook would receive,
    // so the book-scoping assertions exercise the real derivation.
    return { book: id ? buildBook(id, rowsByBook[id] ?? []) : null, isLoading: false }
  },
  useBookFrames: () => frames,
  usePositionDetail: (p: any) => {
    if (p) detailRequestedFor.push(`${p.portfolioId}:${p.assetId}`)
    return { detail: p ? detail : undefined, isLoading: false }
  },
}))

const openEngagement = vi.fn()
vi.mock('../../lib/engagement', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/engagement')>()
  return {
    ...actual,
    askAI: (t: any) => openEngagement('ai', t),
    discuss: (t: any) => openEngagement('discuss', t),
  }
})

import { PortfolioWorkspace } from './PortfolioWorkspace'

const tabEvents: CustomEvent[] = []
const typedEvents: CustomEvent[] = []
const onTab = (e: Event) => tabEvents.push(e as CustomEvent)
const onResearch = (e: Event) => typedEvents.push(e as CustomEvent)
const onIdea = (e: Event) => typedEvents.push(e as CustomEvent)

beforeEach(() => {
  portfolios = [{ id: 'p1', name: 'Large Cap Growth', role: 'pm' }]
  rowsByBook = {}
  frames = {}
  detail = { sections: [], alsoHeldIn: [] }
  bookRequestedFor.length = 0
  detailRequestedFor.length = 0
  tabEvents.length = 0
  typedEvents.length = 0
  openEngagement.mockClear()
  window.addEventListener('decision-engine-action', onTab)
  window.addEventListener('tesseract:open-research', onResearch)
  window.addEventListener('tesseract:open-idea', onIdea)
})
afterEach(() => {
  window.removeEventListener('decision-engine-action', onTab)
  window.removeEventListener('tesseract:open-research', onResearch)
  window.removeEventListener('tesseract:open-idea', onIdea)
})

/* ------------------------------------------------------------------ specs */

describe('portfolio selection scopes the book', () => {
  beforeEach(() => {
    portfolios = [
      { id: 'p1', name: 'Large Cap Growth', role: 'pm' },
      { id: 'p2', name: 'Vision Fund 5K', role: 'analyst' },
    ]
    // AAPL is three quarters of p1 and a tenth of p2 — the real shape.
    const shared: HoldingRow[] = [
      row({ portfolio_id: 'p1', asset_id: 'a-aapl', shares: 100, price: 300 }),
      row({ portfolio_id: 'p1', asset_id: 'a-x', symbol: 'XXX', shares: 100, price: 100 }),
      row({ portfolio_id: 'p2', asset_id: 'a-aapl', shares: 100, price: 300 }),
      row({ portfolio_id: 'p2', asset_id: 'a-y', symbol: 'YYY', shares: 2700, price: 100 }),
    ]
    rowsByBook = { p1: shared, p2: shared }
  })

  it('shows only the selected book’s holdings', () => {
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    const tiles = screen.getAllByTestId('position-tile')
    expect(tiles).toHaveLength(2)
    // The book map labels its cells too, so scope to the tiles themselves.
    const symbols = tiles.map(t => within(t).getAllByText(/^[A-Z]{3,5}$/)[0].textContent)
    expect(symbols).toContain('XXX')
    expect(symbols).not.toContain('YYY')
  })

  it('never shows one book’s weight under another book’s name', async () => {
    const user = userEvent.setup()
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    expect(screen.getByText('75.0%')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Large Cap Growth/ }))
    await user.click(screen.getByRole('option', { name: 'Vision Fund 5K' }))

    // Same asset, different book, different number.
    expect(screen.getByText('10.0%')).toBeInTheDocument()
    expect(screen.queryByText('75.0%')).not.toBeInTheDocument()
  })

  it('drops the selected position when the book changes', async () => {
    const user = userEvent.setup()
    render(<PortfolioWorkspace selectedPortfolioId="p1" selectedAssetId="a-aapl" />)
    expect(screen.getByTestId('position-detail')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Large Cap Growth/ }))
    await user.click(screen.getByRole('option', { name: 'Vision Fund 5K' }))
    // A position is (asset, portfolio); carrying the asset across books would
    // show p1's line under p2's name.
    expect(screen.queryByTestId('position-detail')).not.toBeInTheDocument()
  })

  it('does not spend UI on a selector when there is one book', () => {
    portfolios = [{ id: 'p1', name: 'Large Cap Growth', role: 'pm' }]
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    expect(screen.queryByRole('button', { name: /Large Cap Growth/ })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Large Cap Growth' })).toBeInTheDocument()
  })
})

describe('the scan leads with the gap, not the holding', () => {
  it('puts an open decision above a larger aligned position', () => {
    rowsByBook = { p1: [
      row({ asset_id: 'a-big', symbol: 'BIG', shares: 900, price: 100 }),
      row({ asset_id: 'a-small', symbol: 'SML', shares: 100, price: 100 }),
    ] }
    frames = {
      'a-big': { ...EMPTY_FRAME, thesisUpdatedAt: daysAgo(5), daysSinceReview: 5 },
      'a-small': { ...EMPTY_FRAME, liveIdea: { id: 'i1', action: 'sell', stage: 'deciding', awaitingDecision: true } },
    }
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    const tiles = screen.getAllByTestId('position-tile')
    expect(tiles[0]).toHaveAttribute('data-gap', 'decision-open')
    expect(within(tiles[0]).getByText('SML')).toBeInTheDocument()
  })

  it('states what share of the book the gaps account for', () => {
    rowsByBook = { p1: [
      row({ asset_id: 'a-1', symbol: 'AAA', shares: 250, price: 100 }),
      row({ asset_id: 'a-2', symbol: 'BBB', shares: 750, price: 100 }),
    ] }
    frames = { 'a-2': { ...EMPTY_FRAME, thesisUpdatedAt: daysAgo(5), daysSinceReview: 5 } }
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    const line = screen.getByText(/framework is missing, stale or broken/).closest('span')!
    // The header states the capital behind the gaps, not just how many there are.
    expect(line).toHaveTextContent('25.0%')
    expect(line).toHaveTextContent('1 position')
  })

  it('does not draw a book map for a single line', () => {
    rowsByBook = { p1: [row({ asset_id: 'a-cash', symbol: 'CASH_USD', shares: 100, price: 1 })] }
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    expect(screen.queryByTestId('book-map')).not.toBeInTheDocument()
  })

  it('says the book is empty rather than rendering a bare header', () => {
    rowsByBook = { p1: [] }
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    expect(screen.getByText(/no holdings on record/)).toBeInTheDocument()
  })
})

describe('visuals appear only where the data supports them', () => {
  const withLadder = (cases: [string, number][] | null, price = 400) => {
    rowsByBook = { p1: [row({ price, shares: 100 })] }
    frames = { 'a-aapl': {
      ...EMPTY_FRAME,
      thesisUpdatedAt: daysAgo(10), daysSinceReview: 10,
      ladder: cases ? ladder(cases) : null,
    } }
  }

  it('draws the framework scale from a valid ladder', () => {
    withLadder([['Bear', 100], ['Base', 200], ['Bull', 300]])
    render(<PortfolioWorkspace selectedPortfolioId="p1" selectedAssetId="a-aapl" />)
    expect(screen.getByTestId('framework-scale')).toBeInTheDocument()
    expect(screen.getByText('Bear')).toBeInTheDocument()
    expect(screen.getByText('Bull')).toBeInTheDocument()
  })

  it('draws nothing rather than a range from one rung', () => {
    withLadder([['Bull', 300]])
    render(<PortfolioWorkspace selectedPortfolioId="p1" selectedAssetId="a-aapl" />)
    expect(screen.queryByTestId('framework-scale')).not.toBeInTheDocument()
  })

  it('draws nothing when there is no ladder at all', () => {
    withLadder(null)
    render(<PortfolioWorkspace selectedPortfolioId="p1" selectedAssetId="a-aapl" />)
    expect(screen.queryByTestId('framework-scale')).not.toBeInTheDocument()
  })

  it('omits unrealised entirely when no cost is on record', () => {
    rowsByBook = { p1: [row({ cost: null })] }
    render(<PortfolioWorkspace selectedPortfolioId="p1" selectedAssetId="a-aapl" />)
    expect(screen.queryByText('Unrealised')).not.toBeInTheDocument()
    expect(screen.getByText(/No average cost on record/)).toBeInTheDocument()
  })

  it('never labels an unrealised figure as portfolio P&L', () => {
    rowsByBook = { p1: [row({ cost: 150 })] }
    render(<PortfolioWorkspace selectedPortfolioId="p1" selectedAssetId="a-aapl" />)
    expect(screen.getByText('Unrealised')).toBeInTheDocument()
    //  so "Unrealised" does not match the ban on "realised".
    expect(screen.queryByText(/P&L|Realised|Return since inception/i)).not.toBeInTheDocument()
  })
})

describe('selecting a position keeps the book', () => {
  beforeEach(() => {
    rowsByBook = { p1: [
      row({ asset_id: 'a-1', symbol: 'AAA', shares: 500, price: 100 }),
      row({ asset_id: 'a-2', symbol: 'BBB', shares: 500, price: 100 }),
    ] }
  })

  it('shows a navigator beside the position, not the position alone', async () => {
    const user = userEvent.setup()
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    await user.click(screen.getAllByTestId('position-tile')[0].querySelector('button')!)
    expect(screen.getByTestId('position-detail')).toBeInTheDocument()
    expect(screen.getAllByTestId('position-nav-tile')).toHaveLength(2)
  })

  it('enriches only the selected position', async () => {
    const user = userEvent.setup()
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    expect(detailRequestedFor).toHaveLength(0)
    await user.click(screen.getAllByTestId('position-tile')[0].querySelector('button')!)
    expect(new Set(detailRequestedFor)).toEqual(new Set(['p1:a-1']))
  })

  it('switches position without abandoning the workspace', async () => {
    const user = userEvent.setup()
    render(<PortfolioWorkspace selectedPortfolioId="p1" selectedAssetId="a-1" />)
    await user.click(screen.getAllByTestId('position-nav-tile')[1])
    expect(screen.getByTestId('position-detail')).toBeInTheDocument()
    expect(detailRequestedFor).toContain('p1:a-2')
  })

  it('can return to the whole book', async () => {
    const user = userEvent.setup()
    render(<PortfolioWorkspace selectedPortfolioId="p1" selectedAssetId="a-1" />)
    await user.click(screen.getByRole('button', { name: 'Full book' }))
    expect(screen.queryByTestId('position-detail')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('position-tile')).toHaveLength(2)
  })
})

describe('every route out reuses a seam another stage owns', () => {
  it('opens Research on the exact asset, with the issue and focus', async () => {
    const user = userEvent.setup()
    rowsByBook = { p1: [row({ asset_id: 'a-aapl', shares: 100, price: 200 })] }
    frames = {}   // no thesis -> Write the case -> Research
    render(<PortfolioWorkspace selectedPortfolioId="p1" selectedAssetId="a-aapl" />)
    await user.click(screen.getByRole('button', { name: /Write the case/ }))

    const tab = tabEvents.at(-1)!.detail
    expect(tab.id).toBe('research-v2')
    expect(tab.data.selectedAssetId).toBe('a-aapl')
    expect(tab.data.focus).toBe('thesis')
    expect(tab.data.origin).toBe('portfolio')
    expect(tab.data.issue).toBe('No written thesis')

    const typed = typedEvents.at(-1)!.detail
    expect(typed).toMatchObject({ assetId: 'a-aapl', focus: 'thesis', origin: 'portfolio' })
  })

  it('opens Ideas V2 on the exact idea, never the legacy pipeline', async () => {
    const user = userEvent.setup()
    rowsByBook = { p1: [row({ asset_id: 'a-aapl', shares: 100, price: 200 })] }
    frames = { 'a-aapl': {
      ...EMPTY_FRAME,
      liveIdea: { id: 'idea-9', action: 'sell', stage: 'deciding', awaitingDecision: true },
    } }
    render(<PortfolioWorkspace selectedPortfolioId="p1" selectedAssetId="a-aapl" />)
    await user.click(screen.getByRole('button', { name: /Review the decision/ }))

    const tab = tabEvents.at(-1)!.detail
    expect(tab.id).toBe('ideas-v2')
    expect(tab.data.selectedIdeaId).toBe('idea-9')
    expect(tabEvents.some(e => e.detail?.type === 'trade-queue')).toBe(false)

    expect(typedEvents.at(-1)!.detail).toMatchObject({ ideaId: 'idea-9', origin: 'portfolio' })
  })

  it('reuses one fixed tab rather than opening one per click', async () => {
    const user = userEvent.setup()
    rowsByBook = { p1: [row({ asset_id: 'a-aapl', shares: 100, price: 200 })] }
    render(<PortfolioWorkspace selectedPortfolioId="p1" selectedAssetId="a-aapl" />)
    const btn = screen.getByRole('button', { name: /Write the case/ })
    await user.click(btn)
    await user.click(btn)
    expect(new Set(tabEvents.map(e => e.detail.id))).toEqual(new Set(['research-v2']))
  })
})

describe('Ask AI and Team reuse the shared seam', () => {
  it('binds the position, the book and the issue', async () => {
    const user = userEvent.setup()
    rowsByBook = { p1: [row({ asset_id: 'a-aapl', shares: 100, price: 200 })] }
    render(<PortfolioWorkspace selectedPortfolioId="p1" selectedAssetId="a-aapl" />)
    await user.click(screen.getByRole('button', { name: /Ask AI/ }))

    const [view, target] = openEngagement.mock.calls[0]
    expect(view).toBe('ai')
    expect(target.objectType).toBe('asset')
    expect(target.objectId).toBe('a-aapl')
    expect(target.portfolioId).toBe('p1')
    expect(target.portfolioName).toBe('Large Cap Growth')
    expect(target.issue.reason).toBe('portfolio:no-framework')
  })

  it('offers no Ask AI on a cash line', () => {
    rowsByBook = { p1: [row({ asset_id: 'a-cash', symbol: 'CASH_USD', shares: 100, price: 1 })] }
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    expect(screen.queryByRole('button', { name: /Ask AI/ })).not.toBeInTheDocument()
    expect(screen.getByText(/100\.0% of the book is in cash/)).toBeInTheDocument()
  })
})

describe('authority is read, not assumed', () => {
  const withOpenIdea = () => {
    rowsByBook = { p1: [row({ asset_id: 'a-aapl', shares: 100, price: 200 })] }
    frames = { 'a-aapl': {
      ...EMPTY_FRAME,
      liveIdea: { id: 'i1', action: 'sell', stage: 'deciding', awaitingDecision: true },
    } }
  }

  it('offers the decision verb to a PM on this book', () => {
    portfolios = [{ id: 'p1', name: 'Large Cap Growth', role: 'pm' }]
    withOpenIdea()
    render(<PortfolioWorkspace selectedPortfolioId="p1" selectedAssetId="a-aapl" />)
    expect(screen.getByRole('button', { name: /Decide in Ideas/ })).toBeInTheDocument()
  })

  it('does not offer it to an analyst, and says who can', () => {
    portfolios = [{ id: 'p1', name: 'Large Cap Growth', role: 'analyst' }]
    withOpenIdea()
    render(<PortfolioWorkspace selectedPortfolioId="p1" selectedAssetId="a-aapl" />)
    expect(screen.queryByRole('button', { name: /Decide in Ideas/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Open in Ideas/ })).toBeInTheDocument()
    expect(screen.getByText(/Only a portfolio manager on this book/)).toBeInTheDocument()
  })
})

describe('missing data is omitted, never faked', () => {
  it('names the other books that hold the asset without giving them a weight', () => {
    rowsByBook = { p1: [row({ asset_id: 'a-aapl', shares: 100, price: 200 })] }
    detail = {
      sections: [],
      alsoHeldIn: [{ portfolioId: 'p2', portfolioName: 'Vision Fund 5K', shares: 14_468 }],
    }
    render(<PortfolioWorkspace selectedPortfolioId="p1" selectedAssetId="a-aapl" />)
    const module = screen.getByText('Also held in').closest('section')!
    expect(within(module).getByText('Vision Fund 5K')).toBeInTheDocument()
    expect(within(module).getByText('14,468 sh')).toBeInTheDocument()
    // This book's 100% must not appear against another book's name.
    expect(within(module).queryByText(/%/)).not.toBeInTheDocument()
  })

  it('says the case is unwritten rather than rendering a blank module', () => {
    rowsByBook = { p1: [row({ asset_id: 'a-aapl', shares: 100, price: 200 })] }
    render(<PortfolioWorkspace selectedPortfolioId="p1" selectedAssetId="a-aapl" />)
    expect(screen.getByText(/No core thesis has been written for AAPL/)).toBeInTheDocument()
  })

  it('shows no idea module when the book has no track on the name', () => {
    rowsByBook = { p1: [row({ asset_id: 'a-aapl', shares: 100, price: 200 })] }
    render(<PortfolioWorkspace selectedPortfolioId="p1" selectedAssetId="a-aapl" />)
    expect(screen.queryByText('Idea')).not.toBeInTheDocument()
  })
})
