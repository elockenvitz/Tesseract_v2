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

/*
 * The tile sparkline's closes, for the same reason as `useDayPerformance`
 * above: the real hook reaches for a QueryClient this suite does not stand up.
 *
 * A rising year of dated closes, so the position tiles that now draw a price
 * -- the compact card, and the hero of a position with no written case --
 * render a real line rather than nothing.
 */
const A_YEAR_RISING: { date: Date; value: number }[] = Array.from({ length: 300 }, (_, i) => ({
  date: new Date(Date.now() - (299 - i) * 86_400_000),
  value: 100 + i * 0.08,
}))
/** Per test, so a case can say "this name has no stored closes". */
let tileCloses: { date: Date; value: number }[] = A_YEAR_RISING

vi.mock('../../hooks/useTileCloses', () => ({
  useTileCloses: () => ({ data: tileCloses, isLoading: false }),
}))

vi.mock('../../hooks/useDesktopPortfolio', () => ({
  usePortfolioList: () => ({ portfolios, isLoading: false }),
  useBook: (id: string | null) => {
    if (id) bookRequestedFor.push(id)
    // Deliberately built from the SAME raw rows the real hook would receive,
    // so the book-scoping assertions exercise the real derivation.
    return { book: id ? buildBook(id, rowsByBook[id] ?? []) : null, isLoading: false }
  },
  // The hook reports whether the frames are still in flight, so the gallery
  // can wait for them rather than drawing short tiles and re-laying them out.
  useBookFrames: () => ({ frames, pending: false }),
  /*
   * The benchmark strip renders nothing under four names, and every book in
   * these fixtures is smaller than that -- so returning an empty set keeps
   * these cases about what they are about (book scoping, gap ordering) while
   * still exercising the real component path. `ActiveWeights` has its own
   * coverage where the population is large enough to draw.
   */
  useActiveWeights: () => ({ state: 'loading', rows: [] }),
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
  tileCloses = A_YEAR_RISING
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

/*
 * ── The big tiles are two columns, and the chart gets the width ───────────
 *
 * They were one stacked column: the weight figure, a sentence, the standing
 * window, and at the bottom a weight BAR restating the figure at the top of
 * the same card. The price chart, where it appeared at all, was squeezed under
 * all of it and unreadable.
 *
 * The record now reads down the left; the right column carries the two things
 * a reader compares across positions -- what it weighs, at the top, and what
 * the price did, filling the rest.
 */
describe('a big position tile puts the weight above the price', () => {
  const held = () => {
    rowsByBook = { p1: [row({ asset_id: 'a-1', symbol: 'AAA', shares: 100, price: 100 })] }
    frames = { 'a-1': { ...EMPTY_FRAME } }
  }

  it('draws the price chart, not a weight bar, on the widest tile', () => {
    held()
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    const tile = screen.getAllByTestId('position-tile')[0]
    expect(tile.getAttribute('data-size')).toMatch(/hero|large/)

    // The chart is the shared one -- the same object Decisions draws.
    expect(within(tile).getByTestId('price-since-fill')).toBeInTheDocument()
    // With its axes and its horizon ladder, which the sparkline stub had not.
    expect(within(tile).getByTestId('price-axes')).toBeInTheDocument()
    expect(within(tile).getByTestId('price-ranges')).toBeInTheDocument()

    // The weight is still stated, once, as a figure.
    expect(within(tile).getByTestId('position-weight')).toBeInTheDocument()
    // And the bar that restated it is gone: that is the room the chart has.
    expect(within(tile).queryByText('Weight, against the whole book')).toBeNull()
  })

  it('names the chart for what it is, not for its window', () => {
    held()
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    const tile = screen.getAllByTestId('position-tile')[0]
    expect(within(tile).getByTestId('price-since-fill')).toHaveTextContent(/price chart/i)
    // The caption used to describe the window the ALL chip already names.
    expect(tile.textContent).not.toMatch(/price over available history/i)
  })

  it('still draws nothing where the name has no stored closes', () => {
    // A position whose symbol the product holds no prices for must not get an
    // invented line, and the tile must not collapse around the gap.
    tileCloses = []
    held()
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    const tile = screen.getAllByTestId('position-tile')[0]
    expect(within(tile).queryByTestId('price-since-fill')).toBeNull()
    expect(within(tile).getByTestId('position-weight')).toBeInTheDocument()
  })
})

/*
 * ── The card says each fact once, and the chart reaches the bottom ────────
 *
 * `whyItMatters` is written to stand alone, which is right in a rail card or a
 * detail header where it is the only description. On a tile it is not alone:
 * the ticker is the headline and the weight is the figure beside it, so
 * "5.6% of the book in GOOGL, with no thesis behind it" is three facts the
 * reader has already read, set as prose. That is how a card looks full of
 * content and says nothing.
 */
describe('the tile drops prose that only restates itself', () => {
  it('says nothing in words where the figures already said it', () => {
    rowsByBook = { p1: [row({ asset_id: 'a-1', symbol: 'GOOGL', shares: 100, price: 100 })] }
    frames = { 'a-1': { ...EMPTY_FRAME } }   // no framework
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    const tile = screen.getAllByTestId('position-tile')[0]

    // The sentence that repeated the ticker, the weight and the absent case.
    expect(tile.textContent).not.toMatch(/with no thesis behind it/i)
    // What it says instead: the absence, once.
    expect(within(tile).getByText('Nothing written')).toBeInTheDocument()
    // And the weight is still there, as the figure.
    expect(within(tile).getByTestId('position-weight')).toBeInTheDocument()
  })

  it('keeps prose that carries something the figures do not', () => {
    // Spot outside the written case: how far outside is not on the card
    // anywhere else, so the sentence stays.
    rowsByBook = { p1: [row({ asset_id: 'a-1', symbol: 'AAA', shares: 100, price: 400 })] }
    frames = { 'a-1': { ...EMPTY_FRAME, ladder: ladder([['Bear', 100], ['Bull', 200]]) } }
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    const tile = screen.getAllByTestId('position-tile')[0]
    expect(tile.textContent).toMatch(/above your bull case/i)
  })

  it('lets the chart take the height the other column does not use', () => {
    rowsByBook = { p1: [row({ asset_id: 'a-1', symbol: 'GOOGL', shares: 100, price: 100 })] }
    frames = { 'a-1': { ...EMPTY_FRAME } }
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    const chart = within(screen.getAllByTestId('position-tile')[0])
      .getByTestId('price-since-fill')

    /*
     * Fill mode, asserted structurally: the row is as tall as its taller
     * column, so a FIXED height left dead space under the chart on exactly
     * the cards whose other column says least. The chart has to grow into it.
     */
    expect(chart.className).toMatch(/h-full/)
    expect(within(chart).getByTestId('price-axes').className).toMatch(/flex-1/)
  })
})

/*
 * ── The card is never split left/right ────────────────────────────────────
 *
 * It was, for three passes. Splitting gave the chart half the width and left
 * the record in a narrow column that wrapped more -- worse for both, since a
 * price line wants width and a short run of facts does not want a column. It
 * also produced the dead space that took three attempts to chase: whichever
 * column was shorter left a void beside the other, and which one that was
 * depended on the name.
 *
 * Stacked, neither can happen, and there is no condition to get wrong.
 */
describe('the card stacks, and the chart runs full width', () => {
  it('holds no side-by-side columns, whatever the case says', () => {
    for (const frame of [
      { ...EMPTY_FRAME },                                                   // nothing written
      { ...EMPTY_FRAME, ladder: ladder([['Bear', 100], ['Bull', 200]]) },   // a written case
      { ...EMPTY_FRAME, thesisUpdatedAt: daysAgo(40), daysSinceReview: 40 },// a review date
    ]) {
      rowsByBook = { p1: [row({ asset_id: 'a-1', symbol: 'NVDA', shares: 100, price: 150 })] }
      frames = { 'a-1': frame as PositionFrame }
      const { unmount } = render(<PortfolioWorkspace selectedPortfolioId="p1" />)
      const tile = screen.getAllByTestId('position-tile')[0]
      // The two-column grid this lens used to build.
      expect(tile.innerHTML).not.toMatch(/minmax\(0,1fr\)_minmax\(0,1fr\)/)
      unmount()
    }
  })

  it('still says the absence, and still draws the price', () => {
    rowsByBook = { p1: [row({ asset_id: 'a-1', symbol: 'NVDA', shares: 100, price: 100 })] }
    frames = { 'a-1': { ...EMPTY_FRAME } }
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    const tile = screen.getAllByTestId('position-tile')[0]
    expect(within(tile).getByText('Nothing written')).toBeInTheDocument()
    expect(within(tile).getByTestId('price-since-fill')).toBeInTheDocument()
  })

  it('puts the case objects on one row rather than stacking them', () => {
    // A review date and a written ladder both present: they sit side by side
    // across the width instead of becoming two more short lines.
    rowsByBook = { p1: [row({ asset_id: 'a-1', symbol: 'AAA', shares: 100, price: 150 })] }
    frames = { 'a-1': {
      ...EMPTY_FRAME,
      thesisUpdatedAt: daysAgo(40), daysSinceReview: 40,
      ladder: ladder([['Bear', 100], ['Bull', 200]]),
    } }
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    const tile = screen.getAllByTestId('position-tile')[0]
    expect(tile.innerHTML).toMatch(/flex-wrap/)
  })
})

/*
 * ── The weight is the corner, and the rest is behind it ───────────────────
 *
 * "6.4%" answers one question and raises three: how many dollars, how does it
 * compare to the index, how many shares. All four on the card buries the one
 * that matters; none of them sends the reader to the detail pane for a number
 * they wanted in passing.
 */
describe('the weight opens the size behind it', () => {
  const held = () => {
    rowsByBook = { p1: [row({ asset_id: 'a-1', symbol: 'AAA', shares: 100, price: 250 })] }
    frames = { 'a-1': { ...EMPTY_FRAME } }
  }

  it('states the weight in the corner, labelled weight', () => {
    held()
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    const chip = within(screen.getAllByTestId('position-tile')[0])
      .getByTestId('position-weight')
    expect(chip).toHaveTextContent('100.0%')
    expect(chip).toHaveTextContent(/weight/i)
    // "of the book" was the old wording and the old place.
    expect(chip.textContent).not.toMatch(/of (the|this) book/i)
  })

  it('reveals the dollars and the shares on a click, and opens no record', async () => {
    const user = userEvent.setup()
    held()
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    const tile = screen.getAllByTestId('position-tile')[0]

    expect(screen.queryByTestId('position-weight-detail')).toBeNull()
    await user.click(within(tile).getByTestId('position-weight'))

    /*
     * Found on `screen`, not inside the tile: the panel renders through a
     * portal into `document.body`. `DesktopTile`'s shell carries
     * `overflow-hidden` -- it is what keeps the rounded corners -- so a panel
     * positioned inside it was clipped, and on a compact card the reader got
     * the top two rows and nothing else.
     */
    const panel = screen.getByTestId('position-weight-detail')
    expect(panel).toHaveTextContent(/market value/i)
    expect(panel).toHaveTextContent(/shares/i)
    expect(panel).toHaveTextContent(/active weight/i)

    // Reading a number is not a decision to leave the gallery.
    expect(opened).toHaveLength(0)
  })

  it('says there is no benchmark rather than printing a zero index weight', async () => {
    const user = userEvent.setup()
    held()
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    await user.click(within(screen.getAllByTestId('position-tile')[0]).getByTestId('position-weight'))
    /*
     * `useActiveWeights` is mocked to 'loading' in this suite, so no comparison
     * is available. An index weight of zero for a name the file does not hold
     * is not the same as a name the index holds at zero, and this lens is
     * careful about that distinction elsewhere.
     */
    expect(screen.getByTestId('position-weight-detail')).toHaveTextContent(/no benchmark/i)
  })
})
