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

/*
 * The day panel is its own module and its own query. These cases are about
 * book scoping and gap ordering; without a mock the real hook reaches for a
 * QueryClient that this suite does not stand up, and every one of them fails
 * on infrastructure rather than on what it is testing. `DayPanel` renders
 * nothing for null, so the surface under test is unchanged.
 */
vi.mock('../../hooks/useDayPerformance', () => ({
  useDayPerformance: () => null,
}))

vi.mock('../../hooks/useDesktopPortfolio', () => ({
  usePortfolioList: () => ({ portfolios, isLoading: false }),
  useBook: (id: string | null) => {
    if (id) bookRequestedFor.push(id)
    // Deliberately built from the SAME raw rows the real hook would receive,
    // so the book-scoping assertions exercise the real derivation.
    return { book: id ? buildBook(id, rowsByBook[id] ?? []) : null, isLoading: false }
  },
  useBookFrames: () => frames,
  /*
   * The benchmark strip renders nothing under four names, and every book in
   * these fixtures is smaller than that -- so returning an empty set keeps
   * these cases about what they are about (book scoping, gap ordering) while
   * still exercising the real component path. `ActiveWeights` has its own
   * coverage where the population is large enough to draw.
   */
  useActiveWeights: () => [],
  usePositionDetail: (p: any) => {
    if (p) detailRequestedFor.push(`${p.portfolioId}:${p.assetId}`)
    return { detail: p ? detail : undefined, isLoading: false }
  },
}))

/** What the lens asked the deck to expand. The seam itself is real. */
const opened: any[] = []
vi.mock('../../lib/dashboard/focus', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/dashboard/focus')>()
  return { ...actual, openDashboardFocus: (r: any) => { opened.push(r); return true } }
})

const deepOpened: any[] = []
vi.mock('../../lib/desktop-asset', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/desktop-asset')>()
  return { ...actual, openAsset: (r: any) => { deepOpened.push(r); return true } }
})

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
  opened.length = 0
  deepOpened.length = 0
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
    const rows = screen.getAllByTestId('position-tile')
    expect(rows).toHaveLength(2)
    const symbols = rows.map(r => within(r).getAllByText(/^[A-Z]{3,5}$/)[0].textContent)
    expect(symbols).toContain('XXX')
    expect(symbols).not.toContain('YYY')
  })

  it('never shows one book’s weight under another book’s name', async () => {
    const user = userEvent.setup()
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    const aapl = () => screen.getAllByTestId('position-tile')
      .find(r => within(r).queryByText('AAPL'))!
    expect(aapl()).toHaveTextContent('75.0%')

    await user.click(screen.getByRole('button', { name: /Large Cap Growth/ }))
    await user.click(screen.getByRole('option', { name: 'Vision Fund 5K' }))

    // Same asset, different book, different number.
    expect(aapl()).toHaveTextContent('10.0%')
    expect(aapl()).not.toHaveTextContent('75.0%')
  })

  it('sends the book the reader was actually looking at', async () => {
    const user = userEvent.setup()
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    await user.click(screen.getByRole('button', { name: /Large Cap Growth/ }))
    await user.click(screen.getByRole('option', { name: 'Vision Fund 5K' }))

    // A position is (asset, portfolio). Expanding from the second book must
    // carry the second book, never the one the reader started in.
    await user.click(screen.getAllByTestId('position-tile')[0])
    expect(opened.at(-1)!.target.portfolioId).toBe('p2')
    expect(opened.at(-1)!.backLabel).toBe('Vision Fund 5K')
  })

  it('does not spend UI on a selector when there is one book', () => {
    portfolios = [{ id: 'p1', name: 'Large Cap Growth', role: 'pm' }]
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    expect(screen.queryByRole('button', { name: /Large Cap Growth/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: 'Large Cap Growth' }).length)
      .toBeGreaterThan(0)
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
    const rows = screen.getAllByTestId('position-tile')
    expect(rows[0]).toHaveAttribute('data-gap', 'decision-open')
    expect(within(rows[0]).getByText('SML')).toBeInTheDocument()
  })

  it('states what share of the book the gaps account for', () => {
    rowsByBook = { p1: [
      row({ asset_id: 'a-1', symbol: 'AAA', shares: 250, price: 100 }),
      row({ asset_id: 'a-2', symbol: 'BBB', shares: 750, price: 100 }),
    ] }
    frames = { 'a-2': { ...EMPTY_FRAME, thesisUpdatedAt: daysAgo(5), daysSinceReview: 5 } }
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    // The header states the capital behind the work, split by severity.
    const line = screen.getByText(/needs framework work/).closest('span')!
    expect(line).toHaveTextContent('25.0%')
    expect(screen.queryByText(/trading outside its own case/)).not.toBeInTheDocument()
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

describe('a position expands into the deck, in place', () => {
  beforeEach(() => {
    rowsByBook = { p1: [
      row({ asset_id: 'a-1', symbol: 'AAA', shares: 500, price: 100 }),
      row({ asset_id: 'a-2', symbol: 'BBB', shares: 500, price: 100 }),
    ] }
  })

  it('draws the book and opens nothing', () => {
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    expect(screen.getByTestId('portfolio-lens')).toBeInTheDocument()
    expect(screen.getAllByTestId('position-tile')).toHaveLength(2)
    expect(screen.queryByTestId('position-detail')).not.toBeInTheDocument()
    expect(detailRequestedFor).toHaveLength(0)
    expect(opened).toHaveLength(0)
  })

  it('names the book as the origin, because that is where Back goes', async () => {
    const user = userEvent.setup()
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    await user.click(screen.getAllByTestId('position-tile')[0])

    const req = opened.at(-1)!
    expect(req.target.objectId).toBe('a-1')
    expect(req.target.originLens).toBe('portfolio')
    expect(req.target.portfolioId).toBe('p1')
    // Not "Portfolio": the reader returns to a named book.
    expect(req.backLabel).toBe('Large Cap Growth')
  })

  it('hands over the rest of the book as rail cards', async () => {
    const user = userEvent.setup()
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    await user.click(screen.getAllByTestId('position-tile')[0])

    const rail = opened.at(-1)!.rail
    expect(rail.length).toBeGreaterThan(0)
    // Weight leads, because materiality is what makes a framework state worth
    // reading at all.
    expect(rail[0].figure).toMatch(/%$/)
    expect(rail[0].detail).toBeTruthy()
  })

  it('renders only the workspace when the deck expands it', () => {
    render(<PortfolioWorkspace selectedPortfolioId="p1" focusObjectId="a-1" />)
    expect(screen.getByTestId('position-detail')).toBeInTheDocument()
    expect(screen.queryAllByTestId('position-tile')).toHaveLength(0)
    expect(new Set(detailRequestedFor)).toEqual(new Set(['p1:a-1']))
  })

  it('keeps the book map out of the position workspace', () => {
    render(<PortfolioWorkspace selectedPortfolioId="p1" focusObjectId="a-1" />)
    expect(screen.queryByTestId('book-map')).not.toBeInTheDocument()
  })

  it('hands off to the asset with this book as its context', async () => {
    const user = userEvent.setup()
    render(<PortfolioWorkspace selectedPortfolioId="p1" focusObjectId="a-1" />)
    await user.click(screen.getByRole('button', { name: /Open full asset/ }))

    const req = deepOpened.at(-1)!
    expect(req.assetId).toBe('a-1')
    expect(req.focus).toBe('position')
    expect(req.portfolioId).toBe('p1')
  })

  it('never opens a position the book does not hold', () => {
    render(<PortfolioWorkspace selectedPortfolioId="p1" focusObjectId="a-not-here" />)
    // A book that does not hold the name has nothing to say about it, and
    // opening its top position instead would be a lie.
    expect(screen.queryByTestId('position-detail')).not.toBeInTheDocument()
  })
})

describe('severity is visible, and means one thing', () => {
  // The real Large Cap Core shape: four no-case names and AAPL below its bear.
  const largeCapCore = () => {
    rowsByBook = { p1: [
      row({ asset_id: 'a-jnj', symbol: 'JNJ', shares: 282, price: 100 }),
      row({ asset_id: 'a-msft', symbol: 'MSFT', shares: 217, price: 100 }),
      row({ asset_id: 'a-jpm', symbol: 'JPM', shares: 177, price: 100 }),
      row({ asset_id: 'a-pg', symbol: 'PG', shares: 172, price: 100 }),
      row({ asset_id: 'a-aapl', symbol: 'AAPL', shares: 152, price: 100 }),
    ] }
    frames = { 'a-aapl': {
      ...EMPTY_FRAME,
      thesisUpdatedAt: daysAgo(149), daysSinceReview: 149,
      ladder: ladder([['Bear', 205], ['Base', 230], ['Bull', 285]]),
    } }
  }

  const pill = (el: HTMLElement) => el.className

  it('paints the four unwritten cases amber, not red', () => {
    largeCapCore()
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    for (const sym of ['JNJ', 'MSFT', 'JPM', 'PG']) {
      const row = screen.getAllByTestId('position-tile')
        .find(t => within(t).queryAllByText(sym).length > 0)!
      expect(row).toHaveAttribute('data-gap', 'no-framework')
      const badge = within(row).getByText('No thesis on file')
      expect(pill(badge)).toMatch(/amber/)
      expect(pill(badge)).not.toMatch(/rose/)
    }
  })

  it('keeps the real framework break red', () => {
    largeCapCore()
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    const row = screen.getAllByTestId('position-tile')
      .find(t => t.getAttribute('data-gap') === 'below-bear')!
    const badge = within(row).getByText('Below bear case')
    expect(pill(badge)).toMatch(/rose/)
    expect(pill(badge)).not.toMatch(/amber/)
  })

  it('no longer draws the book map, and keeps what it was legending', () => {
    /*
     * ── Why two guards were deleted rather than updated ──────────────────
     *
     * They pinned real properties -- one colour per position, geometry from
     * weight and never from severity -- and both held right up to the day the
     * strip was removed. It was removed because a reader asked what it was
     * for: "I don't understand the yellow and red position bar and what
     * that's supposed to be helping with."
     *
     * The honest answer was: not much. Its dominant feature was always a cash
     * block taking half the width, its second a run of amber whose length
     * restated a number printed directly underneath it, and the one thing
     * worth seeing -- a position trading outside its own case -- was a sliver.
     * Three horizontal strips stack in this header now, and it was the only
     * one that could not be read.
     *
     * What it legended is exact and stays, in the words that were doing the
     * work. That is what this guard now protects.
     */
    largeCapCore()
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    expect(screen.queryByTestId('book-map')).toBeNull()
    expect(screen.getByText(/needs framework work/)).toBeInTheDocument()
    expect(screen.getByText(/trading outside its own case/)).toBeInTheDocument()
  })

  it('splits the summary by severity instead of collapsing it', () => {
    largeCapCore()
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    const work = screen.getByText(/needs framework work/).closest('span')!
    const broken = screen.getByText(/trading outside its own case/).closest('span')!
    expect(work).toHaveTextContent('84.8%')
    expect(broken).toHaveTextContent('15.2%')
    // The old sentence fused all three concepts into one number.
    expect(screen.queryByText(/missing, stale or broken/)).not.toBeInTheDocument()
  })

  it('does not re-rank the book to spread the colours', () => {
    largeCapCore()
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    // Same tier, so size still decides: the 28.2% amber leads the 15.2% red.
    const order = screen.getAllByTestId('position-tile').map(t => t.getAttribute('data-gap'))
    expect(order[0]).toBe('no-framework')
    expect(order.at(-1)).toBe('below-bear')
  })

  it('shows the same severity in the workspace as on the tile', () => {
    largeCapCore()
    const { rerender } = render(<PortfolioWorkspace selectedPortfolioId="p1" focusObjectId="a-jnj" />)
    expect(pill(within(screen.getByTestId('position-detail')).getByText('No thesis on file')))
      .toMatch(/amber/)

    rerender(<PortfolioWorkspace selectedPortfolioId="p1" focusObjectId="a-aapl" />)
    expect(pill(within(screen.getByTestId('position-detail')).getByText('Below bear case')))
      .toMatch(/rose/)
  })

  it('keeps an aligned position quiet rather than celebrating it', () => {
    rowsByBook = { p1: [row({ asset_id: 'a-1', symbol: 'AAA', shares: 100, price: 100 })] }
    frames = { 'a-1': { ...EMPTY_FRAME, thesisUpdatedAt: daysAgo(5), daysSinceReview: 5 } }
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    const badge = within(screen.getAllByTestId('position-tile')[0]).getByText('Aligned')
    expect(badge.className).not.toMatch(/rose|amber|emerald|green/)
  })

  it('treats an open decision as work, not as a break', () => {
    rowsByBook = { p1: [row({ asset_id: 'a-1', symbol: 'AAA', shares: 100, price: 100 })] }
    frames = { 'a-1': {
      ...EMPTY_FRAME,
      liveIdea: { id: 'i1', action: 'sell', stage: 'deciding', awaitingDecision: true },
    } }
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    const badge = within(screen.getAllByTestId('position-tile')[0]).getByText('Decision pending')
    expect(badge.className).toMatch(/amber/)
    expect(badge.className).not.toMatch(/rose|violet/)
  })
})
