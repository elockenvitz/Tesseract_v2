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
let myRating: { rating_value: string } | undefined
let books: { id: string; name: string; role: string | null }[] = []

vi.mock('../../../hooks/useAssetWorkspace', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../hooks/useAssetWorkspace')>()
  return { ...actual, useAssetWorkspace: () => ({ data, isLoading: false, error: null }) }
})
/*
 * Increment 2B put the real Decision Memory on this surface, so the Snapshot
 * now renders `DecisionMemorySummary`, which reads
 * `useAssetDecisionTimeline`. Unmocked it reaches Supabase and throws, and
 * because it is rendered inside the composition that failure took down all
 * ten tests in this file rather than the two about Decision Memory.
 */
let timelineEvents: any[] = []
let timelineError = false
vi.mock('../../../hooks/useAssetDecisionTimeline', () => ({
  useAssetDecisionTimeline: () => ({
    events: timelineEvents,
    allEvents: timelineEvents,
    phaseCounts: { all: timelineEvents.length, exploratory: 0, formal: 0, execution: 0, review: 0 },
    isLoading: false,
    isError: timelineError,
  }),
}))

vi.mock('../../../hooks/useAnalystRatings', () => ({
  useAnalystRatings: () => ({ ratings, consensus, myRating, isLoading: false }),
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
  myRating = undefined
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
    /*
     * "Needs a decision" narrows with it, and when the chosen book has nothing
     * owed the block is ABSENT rather than a card announcing emptiness — the
     * page only spends space on something a reader can act on.
     */
    expect(screen.queryByTestId('snapshot-needs-decision')).toBeNull()
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
    /* Nothing is owed, so the actionable block is absent rather than empty. */
    expect(screen.queryByTestId('snapshot-needs-decision')).toBeNull()
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

  it('does not restate the price the Asset Page header already owns', () => {
    /*
     * The Snapshot used to print a price-basis line ("Quote as of …" / "Last
     * close $X") directly under a sticky header that states the price and its
     * as-of. Two surfaces, one number. The header owns it; the Snapshot no
     * longer repeats it in any form.
     */
    data = { ...BASE, spot: 330.32 }
    renderSnapshot({ currentQuote: null })
    expect(screen.queryByText(/Last close/)).toBeNull()
    expect(screen.queryByText(/Quote as of/)).toBeNull()
    expect(screen.queryByText(/Live quote/)).toBeNull()
  })

  it('no longer repeats the rating the persistent header strip now owns', () => {
    // UX1b de-dup: rating (with its analyst count) and target moved to the
    // header strip. The Overview must not restate them. The "n behind a rating"
    // guarantee now lives in asset-context-strip.test.tsx.
    ratings = [{ id: 'r-1' }]
    consensus = [{ value: 'UW', count: 1, percentage: 100 }]
    renderSnapshot()
    expect(screen.queryByText(/of 1 analyst/)).not.toBeInTheDocument()
    expect(screen.queryByText('Our rating')).not.toBeInTheDocument()
  })
})

/*
 * This block used to assert the placeholder -- "reserved -- arriving next"
 * and "infers nothing from them". Increment 2B shipped the real thing, so
 * asserting the placeholder would now be asserting that the feature has NOT
 * arrived. Rewritten to the current contract rather than deleted, because
 * what it was protecting still matters: this panel must invent nothing.
 */
describe('Decision Memory invents nothing', () => {
  beforeEach(() => { timelineEvents = []; timelineError = false })

  it('says plainly when nothing is on record', () => {
    renderSnapshot()
    expect(screen.getByTestId('decision-memory-summary-empty')).toBeInTheDocument()
    // And it names the security rather than saying "this one".
    expect(screen.getByTestId('decision-memory-summary-empty').textContent)
      .toMatch(/No decision has been recorded/)
  })

  it('does NOT report an empty history when the read failed', () => {
    timelineError = true
    renderSnapshot()
    expect(screen.getByTestId('decision-memory-summary-error')).toBeInTheDocument()
    expect(screen.queryByTestId('decision-memory-summary-empty')).not.toBeInTheDocument()
  })

  it('never claims an execution was observed when it was not', () => {
    timelineEvents = [
      { id: 'x1', type: 'trade_executed', phase: 'execution', timestamp: '2026-06-02',
        title: 'Add', subtitle: null, actor: null, portfolio: null, sizing: null,
        rationale: null, sourceRef: { type: 'trade_event', id: 'x1' },
        executionProof: 'assumed', provenance: { table: 'e', rowId: 'x1' },
        disposition: 'positive' },
    ]
    renderSnapshot()
    expect(screen.getByTestId('decision-memory-unobserved-caveat').textContent)
      .toMatch(/not\s+evidenced by an observed fill/)
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

describe('the decision queue lists only outstanding obligations', () => {
  const request = (over: Partial<AssetWorkspaceData['decisions'][number]> = {}) => ({
    id: `d-${Math.random().toString(36).slice(2)}`,
    status: 'pending',
    action: 'buy',
    decidedAt: null,
    portfolioId: 'p-growth',
    portfolioName: 'Large Cap Growth',
    decisionNote: null,
    ideaId: null,
    ...over,
  })
  const idea = (over: Partial<AssetWorkspaceData['liveIdeas'][number]> = {}) => ({
    id: 'i-1', action: 'buy', stage: 'ready_to_recommend',
    rationale: 'Add to AAPL before the print', portfolioName: 'Large Cap Growth',
    ...over,
  })

  it('keeps a genuinely pending request', () => {
    data = { ...BASE, decisions: [request({ decisionNote: 'Please size this up' })] }
    renderSnapshot()
    expect(screen.getByTestId('snapshot-needs-decision')).toBeInTheDocument()
    expect(screen.getByText('Please size this up')).toBeInTheDocument()
  })

  /*
   * The withdrawal case is the one that shipped broken: the requester withdrew,
   * so nobody ever ruled and `reviewed_at` stayed null — and a queue keyed only
   * on that listed it as "Awaiting decision" under its own note saying there
   * was no active recommendation. 29 of 111 production requests are withdrawn.
   */
  it.each([
    ['withdrawn', 'withdrawn'],
    ['canceled', 'canceled'],
    ['cancelled', 'cancelled'],
    ['completed', 'completed'],
  ])('drops a %s request even though nobody ruled on it', (_label, status) => {
    data = { ...BASE, decisions: [request({ status, decisionNote: 'No active recommendation' })] }
    renderSnapshot()
    expect(screen.queryByTestId('snapshot-needs-decision')).toBeNull()
    expect(screen.queryByText('No active recommendation')).toBeNull()
  })

  it('drops a request a PM actually ruled on', () => {
    data = {
      ...BASE,
      decisions: [request({ status: 'accepted', decidedAt: '2026-02-01T00:00:00Z', decisionNote: 'Ruled' })],
    }
    renderSnapshot()
    expect(screen.queryByTestId('snapshot-needs-decision')).toBeNull()
  })

  it('does not hide a pending request just because another was withdrawn', () => {
    data = {
      ...BASE,
      decisions: [
        request({ status: 'withdrawn', decisionNote: 'Withdrawn during cleanup' }),
        request({ status: 'pending', decisionNote: 'Still waiting on the PM' }),
      ],
    }
    renderSnapshot()
    expect(screen.getByText('Still waiting on the PM')).toBeInTheDocument()
    expect(screen.queryByText('Withdrawn during cleanup')).toBeNull()
  })

  it('counts an idea and its own pending request as ONE item, titled from the idea', () => {
    data = {
      ...BASE,
      liveIdeas: [idea()],
      decisions: [request({ ideaId: 'i-1', decisionNote: null })],
    }
    renderSnapshot()
    // One row, not two: the request is the further-along state and represents
    // the pair, but it borrows the idea's words since it has none of its own.
    expect(screen.getAllByText('Add to AAPL before the print')).toHaveLength(1)
    expect(screen.getByText('Awaiting decision')).toBeInTheDocument()
    expect(screen.queryByText('ready to recommend')).toBeNull()
  })

  it('still lists an idea that has no request of its own', () => {
    data = { ...BASE, liveIdeas: [idea({ id: 'i-2' })], decisions: [] }
    renderSnapshot()
    expect(screen.getByText('Add to AAPL before the print')).toBeInTheDocument()
    expect(screen.getByText('ready to recommend')).toBeInTheDocument()
  })

  /*
   * `ideaId` is optional, so "unknown relationship" and "no relationship" are
   * the same value. The rule has to be: an unknown id suppresses NOTHING. A
   * set built from missing ids that collapsed to `undefined` would hide every
   * idea at once.
   */
  it.each([['null', null], ['undefined', undefined]])(
    'with a %s ideaId, suppresses nothing and still lists the request',
    (_label, ideaId) => {
      data = {
        ...BASE,
        liveIdeas: [idea({ id: 'i-1' }), idea({ id: 'i-2', rationale: 'Second idea' })],
        decisions: [request({ ideaId: ideaId as any, decisionNote: 'Unlinked request' })],
      }
      renderSnapshot()
      expect(screen.getByText('Unlinked request')).toBeInTheDocument()
      expect(screen.getByText('Add to AAPL before the print')).toBeInTheDocument()
      expect(screen.getByText('Second idea')).toBeInTheDocument()
    },
  )

  it('only suppresses the idea it actually names', () => {
    data = {
      ...BASE,
      liveIdeas: [idea({ id: 'i-1' }), idea({ id: 'i-2', rationale: 'Untouched idea' })],
      decisions: [request({ ideaId: 'i-1', decisionNote: 'Linked to i-1' })],
    }
    renderSnapshot()
    expect(screen.getByText('Linked to i-1')).toBeInTheDocument()
    expect(screen.getByText('Untouched idea')).toBeInTheDocument()
    // i-1's own row is represented by the request, not twice.
    expect(screen.queryByText('Add to AAPL before the print')).toBeNull()
  })

  it('keeps multiple independent pending requests distinguishable', () => {
    data = {
      ...BASE,
      decisions: [
        request({ decisionNote: 'First obligation' }),
        request({ decisionNote: 'Second obligation' }),
      ],
    }
    renderSnapshot()
    expect(screen.getByText('First obligation')).toBeInTheDocument()
    expect(screen.getByText('Second obligation')).toBeInTheDocument()
    expect(screen.getAllByText('Awaiting decision')).toHaveLength(2)
  })

  it('a withdrawn request cannot reappear just because its ideaId is missing', () => {
    data = {
      ...BASE,
      liveIdeas: [idea({ id: 'i-1' })],
      decisions: [request({ status: 'withdrawn', ideaId: undefined as any, decisionNote: 'Withdrawn, unlinked' })],
    }
    renderSnapshot()
    expect(screen.queryByText('Withdrawn, unlinked')).toBeNull()
    // and it must not have suppressed the live idea on its way out
    expect(screen.getByText('Add to AAPL before the print')).toBeInTheDocument()
  })

  it('a withdrawn request does not suppress the idea it names', () => {
    data = {
      ...BASE,
      liveIdeas: [idea({ id: 'i-1' })],
      decisions: [request({ status: 'withdrawn', ideaId: 'i-1', decisionNote: 'Withdrawn' })],
    }
    renderSnapshot()
    expect(screen.queryByText('Withdrawn')).toBeNull()
    // The idea is still live work even though a request against it was pulled.
    expect(screen.getByText('Add to AAPL before the print')).toBeInTheDocument()
  })

  it('scopes the queue to the chosen book', async () => {
    books = [
      { id: 'p-growth', name: 'Large Cap Growth', role: 'pm' },
      { id: 'p-value', name: 'Large Cap Value', role: 'analyst' },
    ]
    data = { ...BASE, decisions: [request({ decisionNote: 'Growth only' })] }
    renderSnapshot()
    await userEvent.click(screen.getByTestId('snapshot-book-filter').querySelector('button')!)
    await userEvent.click(screen.getByRole('option', { name: /Large Cap Value/ }))
    expect(screen.queryByTestId('snapshot-needs-decision')).toBeNull()
  })
})

describe('personal vs firm distinction (Phase 3)', () => {
  const contrib = (over: { section: string; created_by: string }) => ({
    id: `${over.section}-${over.created_by}`,
    section: over.section,
    content: 'We think this name is mispriced.',
    created_by: over.created_by,
    is_archived: false,
  }) as any

  it('states the firm rating and the viewer\'s own when they differ — never merged', () => {
    ratings = [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }]
    consensus = [{ value: 'Buy', count: 2, percentage: 66 }]
    myRating = { rating_value: 'Hold' }
    renderSnapshot({ contributions: [], currentUserId: 'me' })
    expect(screen.getByText(/Firm Buy · 2 of 3/)).toBeInTheDocument()
    expect(screen.getByText(/You Hold/)).toBeInTheDocument()
  })

  it('counts the viewer\'s own case sections and flags where analysts differ', () => {
    data = {
      ...BASE,
      caseWrittenAt: '2026-01-01T00:00:00Z',
      coreSections: ['thesis', 'risks_to_thesis'],
      sections: [{ section: 'thesis', content: 'We think LLY wins.', supportingDetail: null, updatedAt: '2026-01-01T00:00:00Z', authorName: 'Me' }],
    }
    renderSnapshot({
      currentUserId: 'me',
      contributions: [
        contrib({ section: 'thesis', created_by: 'me' }),
        contrib({ section: 'thesis', created_by: 'other' }),
        contrib({ section: 'risks_to_thesis', created_by: 'me' }),
      ],
    })
    expect(screen.getByText(/2 of 3 case sections/)).toBeInTheDocument()
    expect(screen.getByText(/1 section with differing views/)).toBeInTheDocument()
    expect(screen.getByText('You')).toBeInTheDocument()
    expect(screen.getByText(/2 views/)).toBeInTheDocument()
  })

  it('never invents a unanimous firm thesis — a single author shows no divergence', () => {
    data = {
      ...BASE,
      caseWrittenAt: '2026-01-01T00:00:00Z',
      coreSections: ['thesis'],
      sections: [{ section: 'thesis', content: 'We think LLY wins.', supportingDetail: null, updatedAt: '2026-01-01T00:00:00Z', authorName: 'Me' }],
    }
    renderSnapshot({
      currentUserId: 'me',
      contributions: [contrib({ section: 'thesis', created_by: 'me' })],
    })
    expect(screen.getByText(/1 of 3 case sections/)).toBeInTheDocument()
    expect(screen.queryByText(/differing views/)).toBeNull()
    expect(screen.queryByText(/2 views/)).toBeNull()
  })

  it('invites a view when the viewer has written nothing, without faking one', () => {
    renderSnapshot({ contributions: [], currentUserId: 'me' })
    expect(screen.getByText(/You haven't recorded your own view/)).toBeInTheDocument()
  })
})
