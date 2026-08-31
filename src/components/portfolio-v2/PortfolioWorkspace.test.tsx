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

  it('cannot carry a position across a book switch', async () => {
    const user = userEvent.setup()
    render(<PortfolioWorkspace selectedPortfolioId="p1" selectedAssetId="a-aapl" />)
    expect(screen.getByTestId('position-detail')).toBeInTheDocument()

    // The book control belongs to browsing the book, so changing books means
    // returning to it first. A position is (asset, portfolio): there is now no
    // state in which one book's line could appear under another book's name.
    await user.click(screen.getByTestId('workspace-back'))
    await user.click(screen.getByRole('button', { name: /Large Cap Growth/ }))
    await user.click(screen.getByRole('option', { name: 'Vision Fund 5K' }))

    expect(screen.queryByTestId('position-detail')).not.toBeInTheDocument()
    expect(detailRequestedFor.every(k => k.startsWith('p1:'))).toBe(true)
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

  it('lands on the book, not inside a position', () => {
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    expect(screen.getByTestId('workspace-browse')).toBeInTheDocument()
    expect(screen.queryByTestId('position-detail')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('position-tile')).toHaveLength(2)
    // Ranking says what to look at first. It does not say what to open.
    expect(detailRequestedFor).toHaveLength(0)
    // The intermediate grid, and its per-tile CTA, are gone.
    expect(screen.queryByRole('button', { name: 'Full book' })).not.toBeInTheDocument()
  })

  it('gives the opened position the whole canvas, and enriches only it', async () => {
    const user = userEvent.setup()
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    await user.click(screen.getAllByTestId('position-tile')[0])

    expect(screen.getByTestId('position-detail')).toBeInTheDocument()
    expect(screen.queryAllByTestId('position-tile')).toHaveLength(0)
    expect(new Set(detailRequestedFor)).toEqual(new Set(['p1:a-1']))
  })

  it('keeps the book map out of the position workspace', () => {
    render(<PortfolioWorkspace selectedPortfolioId="p1" selectedAssetId="a-1" />)
    // A book-level answer pinned above a position-level question is the
    // stacked-overview problem in miniature.
    expect(screen.queryByTestId('book-map')).not.toBeInTheDocument()
  })

  it('returns to the book by name, then opens a different position', async () => {
    const user = userEvent.setup()
    render(<PortfolioWorkspace selectedPortfolioId="p1" selectedAssetId="a-1" />)
    await user.click(screen.getByRole('button', { name: /Large Cap Growth/ }))
    expect(screen.getAllByTestId('position-tile')).toHaveLength(2)

    await user.click(screen.getAllByTestId('position-tile')[1])
    expect(screen.getByTestId('position-detail')).toBeInTheDocument()
    expect(detailRequestedFor).toContain('p1:a-2')
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
    expect(tab.data.issue).toBe('Core thesis not written')

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
    // Stated on the tile and again in the workspace it opened.
    expect(screen.getByTestId('position-tile'))
      .toHaveTextContent('100.0% of the book is in cash')
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

/**
 * The all-red screen.
 *
 * Large Cap Core rendered four unwritten cases and one real framework break in
 * the same rose, so the screen said every position was equally broken. These
 * assertions reproduce that exact book and require the two classes to be
 * visually distinguishable in every place they appear.
 */
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
      const badge = within(row).getByText('Core thesis not written')
      expect(pill(badge)).toMatch(/amber/)
      expect(pill(badge)).not.toMatch(/rose/)
    }
  })

  it('keeps the real framework break red', () => {
    largeCapCore()
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    const row = screen.getAllByTestId('position-tile')
      .find(t => t.getAttribute('data-gap') === 'below-bear')!
    const badge = within(row).getByText('Spot below bear case')
    expect(pill(badge)).toMatch(/rose/)
    expect(pill(badge)).not.toMatch(/amber/)
  })

  it('gives the book map one colour per position, not one for the book', () => {
    largeCapCore()
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    const cells = [...screen.getByTestId('book-map').children] as HTMLElement[]
    expect(cells).toHaveLength(5)
    expect(cells.filter(c => c.className.includes('rose'))).toHaveLength(1)
    expect(cells.filter(c => c.className.includes('amber'))).toHaveLength(4)
  })

  it('sizes book-map segments by weight, never by severity', () => {
    largeCapCore()
    render(<PortfolioWorkspace selectedPortfolioId="p1" />)
    const cells = [...screen.getByTestId('book-map').children] as HTMLElement[]
    const byLabel = Object.fromEntries(cells.map(c => [c.getAttribute('title')!.split(' ·')[0], c.style.width]))
    // JNJ is the widest at 28.2% and is amber; AAPL is the narrowest of the
    // five at 15.2% and is red. Geometry did not follow the colour.
    expect(parseFloat(byLabel.JNJ)).toBeGreaterThan(parseFloat(byLabel.AAPL))
    expect(parseFloat(byLabel.JNJ)).toBeCloseTo(28.2, 0)
    expect(parseFloat(byLabel.AAPL)).toBeCloseTo(15.2, 0)
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

  it('shows the same severity in the workspace as in the scan', async () => {
    const user = userEvent.setup()
    largeCapCore()
    render(<PortfolioWorkspace selectedPortfolioId="p1" selectedAssetId="a-jnj" />)
    const detailEl = screen.getByTestId('position-detail')
    expect(pill(within(detailEl).getByText('Core thesis not written'))).toMatch(/amber/)

    await user.click(screen.getByTestId('workspace-back'))
    await user.click(screen.getAllByTestId('position-tile')
      .find(t => within(t).queryAllByText('AAPL').length > 0)!)
    expect(pill(within(screen.getByTestId('position-detail')).getByText('Spot below bear case')))
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
    const badge = within(screen.getAllByTestId('position-tile')[0]).getByText('Decision open')
    expect(badge.className).toMatch(/amber/)
    expect(badge.className).not.toMatch(/rose|violet/)
  })
})
