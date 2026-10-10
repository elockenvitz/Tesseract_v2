/**
 * The Investment Snapshot — the Asset page's landing.
 *
 * What is asserted here is the surface's own decisions, not the helpers it
 * composes (those have their own suites and the read is a single bounded
 * query, so it is mocked):
 *
 *   - the one selector genuinely governs every domain, which is the only
 *     thing that makes this a page rather than three widgets
 *   - absent data says it is absent, in every domain, with no fabrication
 *   - Decision Memory reports only what is on record and infers nothing
 *   - no second definition of weight is introduced here
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AssetWorkspaceData } from '../../../hooks/useAssetWorkspace'

const BASE: AssetWorkspaceData = {
  sections: [], evidence: [], caseWrittenAt: null, coreSections: [],
  history: [], spot: null, ladder: null, target: null,
  positions: [], liveIdeas: [], decisions: [],
}

let data: AssetWorkspaceData = BASE
let ratings: { id: string }[] = []
let consensus: { value: string; count: number; percentage: number }[] = []
let books: { id: string; name: string; role: string | null }[] = []

vi.mock('../../../hooks/useAssetWorkspace', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../hooks/useAssetWorkspace')>()
  return { ...actual, useAssetWorkspace: () => ({ data, isLoading: false, error: null }) }
})
vi.mock('../../../hooks/useAnalystRatings', () => ({
  useAnalystRatings: () => ({ ratings, consensus, isLoading: false }),
}))
vi.mock('../../../hooks/useDesktopPortfolio', () => ({
  usePortfolioList: () => ({ portfolios: books, isLoading: false }),
}))
/* Coverage is presentation over a prop; the Snapshot passes it straight through. */
vi.mock('../../coverage/CoverageDisplay', () => ({
  CoverageDisplay: ({ coverage }: { coverage: unknown[] }) =>
    <div data-testid="coverage">{coverage.length} covering</div>,
}))
/* The ladder visual has its own suite and needs a sized container. */
vi.mock('../../portfolio-v2/PortfolioVisual', async importOriginal => {
  const actual = await importOriginal<typeof import('../../portfolio-v2/PortfolioVisual')>()
  return { ...actual, FrameworkScale: () => <div data-testid="ladder" /> }
})

import { InvestmentSnapshot } from '../InvestmentSnapshot'

const ASSET = { id: 'a-1', symbol: 'AAPL', company_name: 'Apple Inc.' }

const position = (over: Partial<AssetWorkspaceData['positions'][number]> = {}) => ({
  portfolioId: 'p-growth', portfolioName: 'Large Cap Growth',
  shares: 150, price: 170, marketValue: 25_500, weightPct: 25.3,
  avgCost: 165.2, unrealisedGain: 2_020, unrealisedPct: 6.23,
  asOf: '2025-08-01', ...over,
})

function renderSnapshot(props: Partial<React.ComponentProps<typeof InvestmentSnapshot>> = {}) {
  return render(
    <InvestmentSnapshot
      asset={ASSET}
      coverage={[]}
      currentQuote={{ price: 336.64, timestamp: '2026-10-09T20:00:00Z' }}
      onOpenSubPage={() => {}}
      {...props}
    />,
  )
}

beforeEach(() => {
  data = { ...BASE }
  ratings = []
  consensus = []
  books = []
})

describe('the one selector governs every domain', () => {
  beforeEach(() => {
    data = {
      ...BASE,
      positions: [position()],
      liveIdeas: [{ id: 'i-1', action: 'buy', stage: 'ready_to_recommend', rationale: 'Add to AAPL', portfolioName: 'Large Cap Growth' }],
      decisions: [],
    }
    books = [
      { id: 'p-growth', name: 'Large Cap Growth', role: 'pm' },
      { id: 'p-value', name: 'Large Cap Value', role: 'analyst' },
    ]
  })

  it('defaults to organization-wide, which is a real state and not "unset"', () => {
    renderSnapshot()
    expect(screen.getByTestId('investment-snapshot')).toHaveAttribute('data-portfolio', 'all')
    expect(screen.getByText(/Held · 1 book/i)).toBeInTheDocument()
  })

  it('marks which books hold the name, as a word rather than a 1/0', async () => {
    renderSnapshot()
    await userEvent.click(screen.getByTestId('snapshot-book-filter').querySelector('button')!)
    const growth = screen.getByRole('option', { name: /Large Cap Growth/ })
    const value = screen.getByRole('option', { name: /Large Cap Value/ })
    expect(growth).toHaveTextContent('held')
    // A book that does not hold it carries no badge at all -- "0" would read
    // as a count of zero somethings.
    expect(value.textContent).toBe('Large Cap Value')
  })

  it('narrows POSITION and ACTIVE WORK together when a book is chosen', async () => {
    renderSnapshot()
    await userEvent.click(screen.getByTestId('snapshot-book-filter').querySelector('button')!)
    await userEvent.click(screen.getByRole('option', { name: /Large Cap Value/ }))

    // Position: an honest fact, not an empty card.
    expect(screen.getByText(/Large Cap Value does not hold AAPL/)).toBeInTheDocument()
    // Active work: the same scope, in the same breath.
    expect(screen.getByText(/Nothing open in Large Cap Value/)).toBeInTheDocument()
  })

  it('does not let the header contradict the position panel', async () => {
    renderSnapshot()
    await userEvent.click(screen.getByTestId('snapshot-book-filter').querySelector('button')!)
    await userEvent.click(screen.getByRole('option', { name: /Large Cap Value/ }))

    /*
     * The chip reported the ORGANISATION-WIDE truth while a non-holding book
     * was selected, so "Held · 3 books" sat directly above "Large Cap Value
     * does not hold AAPL". Both true, and together unreadable.
     */
    expect(screen.getByText(/Not held in Large Cap Value/i)).toBeInTheDocument()
    expect(screen.queryByText(/^Held · /i)).not.toBeInTheDocument()
  })
})

describe('absent data says it is absent', () => {
  it('states every domain is empty rather than rendering blank cards', () => {
    renderSnapshot()
    expect(screen.getByText(/No core investment case has been written for AAPL/)).toBeInTheDocument()
    expect(screen.getByText(/No research is on record either/)).toBeInTheDocument()
    expect(screen.getByText(/Nothing open\./)).toBeInTheDocument()
    expect(screen.getByText(/Not held in any book you can see/)).toBeInTheDocument()
    expect(screen.getByText(/No decision has been recorded against AAPL yet/)).toBeInTheDocument()
    expect(screen.getByText(/No coverage assigned/)).toBeInTheDocument()
  })

  it('shows a weightless position as shares, and says why there is no weight', () => {
    data = { ...BASE, positions: [position({ weightPct: null, avgCost: null, unrealisedGain: null, unrealisedPct: null })] }
    renderSnapshot()
    expect(screen.getByText(/market value could not be derived, so no weight is shown/)).toBeInTheDocument()
    expect(screen.getByText(/No average cost on record/)).toBeInTheDocument()
  })

  it('names the price basis, and never presents a stale close as "current"', () => {
    renderSnapshot({ currentQuote: null })
    data = { ...BASE, spot: 330.32 }
    renderSnapshot({ currentQuote: null })
    expect(screen.getAllByText(/Last close/).length).toBeGreaterThan(0)
  })

  it('reports the n behind a rating instead of a bare consensus', () => {
    ratings = [{ id: 'r-1' }]
    consensus = [{ value: 'UW', count: 1, percentage: 100 }]
    renderSnapshot()
    // One analyst is not "the firm's view", so the count travels with it.
    expect(screen.getByText(/1 of 1 analyst/)).toBeInTheDocument()
  })
})

describe('Decision Memory is reserved, and invents nothing', () => {
  it('says so plainly when nothing is on record', () => {
    renderSnapshot()
    expect(screen.getByText(/reserved — arriving next/)).toBeInTheDocument()
    expect(screen.getByText(/infers nothing from them/)).toBeInTheDocument()
  })

  it('lists only decisions that already carry a decided date', () => {
    data = {
      ...BASE,
      decisions: [
        { id: 'd-1', status: 'accepted', action: 'buy', decidedAt: '2026-05-04', portfolioId: 'p-growth', portfolioName: 'Large Cap Growth', decisionNote: null },
        { id: 'd-2', status: 'pending', action: 'sell', decidedAt: null, portfolioId: 'p-growth', portfolioName: 'Large Cap Growth', decisionNote: null },
      ],
    }
    renderSnapshot()
    // The undecided one belongs to Active Work, not to memory.
    expect(screen.getByText(/buy · Large Cap Growth/)).toBeInTheDocument()
    expect(screen.queryByText(/sell · Large Cap Growth/)).not.toBeInTheDocument()
  })
})

describe('no second definition of weight is introduced', () => {
  const SRC = readFileSync(
    path.join(process.cwd(), 'src/components/asset/InvestmentSnapshot.tsx'), 'utf8',
  ).split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')

  it('reads positions through the canonical workspace hook', () => {
    expect(SRC).toContain("from '../../hooks/useAssetWorkspace'")
  })

  it('computes no weight, market value or NAV of its own', () => {
    /*
     * The Asset page shipped weight-at-cost beside weight-at-market once
     * already. Every figure here must arrive derived; a division or a sum
     * over positions in this file is the start of the second opinion.
     */
    /*
     * Targets DERIVATION, not mention. `weightPct={position.weightPct}` is a
     * prop pass-through and must stay legal — the first version of this gate
     * forbade any `weightPct =` and so failed on the very file it guards,
     * which would have taught the next reader to delete it.
     */
    expect(SRC).not.toMatch(/\b(const|let|var)\s+(weightPct|marketValue|nav|bookValue|totalValue)\b/)
    expect(SRC).not.toMatch(/\bshares\s*\*/)
    expect(SRC).not.toMatch(/\/\s*(total|nav|bookValue|totalValue)\b/)
    expect(SRC).not.toMatch(/\.reduce\([^)]*\bmarketValue\b/)
  })

  it('does not reach for the dead rating-consensus hook', () => {
    // `useRatingConsensus` has no importers and its RPC is called nowhere
    // else; a landing page must not headline an unexercised server function.
    expect(SRC).not.toContain('useRatingConsensus')
  })
})
