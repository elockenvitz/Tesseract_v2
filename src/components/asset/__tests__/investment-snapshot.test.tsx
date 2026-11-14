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
// No userEvent here any more: the only interaction this suite ever drove was
// the book/org selector, and there is no longer a control to drive.
import { render, screen, within } from '@testing-library/react'
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
/*
 * The briefing runs a model call and has its own suite
 * (`asset-briefing-wiring.test.tsx`). Stubbed here so these stay tests of the
 * snapshot -- but stubbed to render the asset it was handed, so the test below
 * can still prove the snapshot mounts it against the right asset.
 */
vi.mock('../AssetBriefingSection', () => ({
  AssetBriefingSection: ({ assetId, symbol }: { assetId: string; symbol: string | null }) =>
    <div data-testid="briefing" data-asset={assetId} data-symbol={symbol ?? ''} />,
}))

import { InvestmentSnapshot } from '../InvestmentSnapshot'
/* Rendered directly in one case, to stand in for the no-rows callers. */
import { DecisionMemorySummary } from '../DecisionMemorySummary'

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

/*
 * ── This block used to be "the one selector governs every domain" ────────
 *
 * Four cases asserted that a book picker at the top of the Overview narrowed
 * the position, the queue and the held chip together, and that the chip could
 * not contradict the panel below it. Every one of them was true and every one
 * of them is now moot: the selector is gone.
 *
 * It was removed because an Overview is the answer you get BEFORE you have
 * asked a question. Handing a reader a scope control on arrival asks them to
 * configure the page before it will tell them anything, and the setting they
 * nearly always want is the one it already defaulted to. The narrowing it
 * offered survives where it belongs — Work and Decisions scope themselves —
 * and the fact it was really being used for ("which books hold this, and how
 * much") is now stated outright, one row per book.
 *
 * Kept, inverted, rather than deleted: the subject is still "what scope does
 * this surface speak in", and the answer must stay "all of them".
 */
describe('the Overview speaks for the whole organisation, with nothing to set', () => {
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

  it('offers no scope control at all', () => {
    renderSnapshot()
    expect(screen.queryByTestId('snapshot-book-filter')).toBeNull()
    expect(screen.queryByText(/Organization-wide/i)).toBeNull()
  })

  it('still declares the scope it is speaking in', () => {
    // `data-portfolio` is read by other suites and by the layout guards; the
    // surface says "all" because that is now the only thing it can say.
    renderSnapshot()
    expect(screen.getByTestId('investment-snapshot')).toHaveAttribute('data-portfolio', 'all')
  })

  it('counts no books in a chip — it names them', () => {
    // "Held · 1 book" was the least useful form of the fact. The row says
    // which book and what weight.
    renderSnapshot()
    expect(screen.queryByText(/Held · 1 book/i)).toBeNull()
    expect(screen.getByTestId('snapshot-exposure')).toHaveTextContent('Large Cap Growth')
  })

  it('draws no coverage roster, because the asset header already does', () => {
    renderSnapshot()
    expect(screen.queryByText(/No coverage assigned/)).toBeNull()
  })

  it('shows the work owed in every book, not one', () => {
    // Each row names its own book, so there is nothing to disambiguate by
    // filtering the list down to one of them.
    renderSnapshot()
    expect(screen.getByTestId('snapshot-needs-decision')).toHaveTextContent('Add to AAPL')
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
    /* "No coverage assigned" was asserted here. The Overview no longer draws
       a coverage roster at all — the asset's own sticky header renders it
       from the same prop, and this page was the second copy. */
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

  it('mounts the briefing against the asset the page is showing', () => {
    /*
     * The briefing's own behaviour is tested in `asset-briefing-wiring`. What
     * only this suite can prove is that the snapshot mounts it for THIS asset:
     * a briefing handed the wrong id would be a confident answer about a
     * different company, which is the worst failure the feature has.
     */
    renderSnapshot()
    const briefing = screen.getByTestId('briefing')
    expect(briefing.getAttribute('data-asset')).toBe(ASSET.id)
    expect(briefing.getAttribute('data-symbol')).toBe(ASSET.symbol)
  })

  it('states the position with what the strip cannot carry, not a copy of it', () => {
    /*
     * ── A reversal, recorded ───────────────────────────────────────────
     *
     * This case asserted the OPPOSITE: that the Overview never restates the
     * rating, because the header strip owns it and is sticky. That was a
     * de-dup made in this same lane, and it was overruled on the product
     * call that "Our view" must open by saying where the firm lands rather
     * than dropping the reader into one analyst's prose.
     *
     * The de-dup argument is answered rather than abandoned. What this line
     * adds is what the strip has no room for: the CONVICTION behind the
     * rating, and whether the firm is of one mind, which is the fact that
     * decides what the rating is worth. The n is still never suppressed.
     *
     * The target is still not restated here, and "Our rating" as a labelled
     * field is still gone. Those halves of the original subject stand.
     */
    ratings = [
      { id: 'r-1', rating_value: 'UW', conviction: 'high' },
      { id: 'r-2', rating_value: 'Buy', conviction: 'low' },
    ] as never
    consensus = [{ value: 'UW', count: 1, percentage: 50 }]
    renderSnapshot()
    const line = screen.getByTestId('snapshot-position-line')
    expect(line).toHaveTextContent('UW')
    expect(line).toHaveTextContent('high conviction')
    expect(line).toHaveTextContent('1 of 2 analysts')
    expect(line).toHaveTextContent(/1 does not/)
    expect(screen.queryByText('Our rating')).not.toBeInTheDocument()
  })

  it('claims no conviction when the analysts holding the rating disagree on it', () => {
    /*
     * A modal conviction across analysts who recorded different ones is a
     * number nobody holds. The surface states it only when it is unanimous
     * among the holders of the dominant rating.
     */
    ratings = [
      { id: 'r-1', rating_value: 'Buy', conviction: 'high' },
      { id: 'r-2', rating_value: 'Buy', conviction: 'low' },
    ] as never
    consensus = [{ value: 'Buy', count: 2, percentage: 100 }]
    renderSnapshot()
    const line = screen.getByTestId('snapshot-position-line')
    expect(line).toHaveTextContent('Buy')
    expect(line.textContent ?? '').not.toMatch(/conviction/)
  })

  it('says plainly when nobody has rated it, with the way to fix that', () => {
    ratings = []
    consensus = []
    renderSnapshot()
    expect(screen.getByTestId('snapshot-position-line'))
      .toHaveTextContent(/Nobody has rated .* yet/)
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
    /*
     * This used to assert the caveat PARAGRAPH. The subject — the Overview
     * never lets an unobserved execution read as an observed one — is
     * unchanged; WHERE and HOW the qualification is stated moved twice.
     *
     * The paragraph read "1 of 2 execution is not evidenced by an observed
     * fill (backfilled)." — written in the grammar of the execution-proof
     * model, broken English on the singular, and the third statement of one
     * fact. It is gone from the rows view. The headline now carries the
     * count as a clause and the row carries the grade in plain words beside
     * the trade it concerns.
     */
    const block = screen.getByTestId('snapshot-decision-history')
    expect(block).toHaveTextContent('no record of the fill')
    expect(block).toHaveTextContent('not confirmed')
    expect(block.textContent ?? '').not.toMatch(/all observed/)
    // And not in the engineering vocabulary.
    expect(block.textContent ?? '').not.toMatch(/evidenced by an observed fill/)
  })

  it('keeps the paragraph for the callers that have no row to put it on', () => {
    // The phone's Snapshot band draws counts without rows; the caveat is
    // the only place the grade can be stated there.
    timelineEvents = [
      { id: 'x1', type: 'trade_executed', phase: 'execution', timestamp: '2026-06-02',
        title: 'Add', subtitle: null, actor: null, portfolio: null, sizing: null,
        rationale: null, sourceRef: { type: 'trade_event', id: 'x1' },
        executionProof: 'assumed', provenance: { table: 'e', rowId: 'x1' },
        disposition: 'positive' },
    ] as never
    render(<DecisionMemorySummary assetId="a-1" symbol="AMZN" />)
    expect(screen.getByTestId('decision-memory-unobserved-caveat').textContent)
      .toMatch(/not\s+evidenced by an observed fill/)
  })
})

/**
 * Decision history carries the decision record, and only that.
 *
 * A price target expiring is not something anybody decided. On the demo AMZN
 * three of them arrived at the top of the block and pushed every actual
 * trade off the bottom — and because `summariseDecisionMemory` counts them
 * as REVIEWED, the chip row read "3 Reviewed · 2 Executed", more reviews
 * than there were decisions to review.
 *
 * They are still on the History page. The vocabulary lives in
 * `DECISION_RECORD_TYPES`, beside the event types.
 */
describe('Decision history holds only the decision record', () => {
  beforeEach(() => { timelineEvents = []; timelineError = false })

  const anyEvent = (id: string, type: string, phase: string, ts: string, title: string) => ({
    id, type, phase, timestamp: ts, title, subtitle: null, actor: null,
    portfolio: null, sizing: null, rationale: null,
    sourceRef: { type: 'trade_event', id }, executionProof: null,
    provenance: { table: 't', rowId: id }, disposition: 'neutral',
  })

  it('leaves a scored price target to the History page', () => {
    timelineEvents = [
      anyEvent('o1', 'outcome_evaluated', 'review', '2026-08-31', 'Price target expired — $180.00'),
      anyEvent('t1', 'trade_executed', 'execution', '2026-03-02', 'Opened position'),
    ] as never
    renderSnapshot()
    const block = screen.getByTestId('snapshot-decision-history')
    expect(block).not.toHaveTextContent('Price target expired')
    // And the trade it was burying is on screen.
    expect(block).toHaveTextContent('Opened position')
  })

  it('does not count a scored target as a decision review', () => {
    // The chips are off under `showRecent`, so this asserts the count that
    // survives: a name with ONLY scored targets has no decision record.
    timelineEvents = [
      anyEvent('o1', 'outcome_evaluated', 'review', '2026-08-31', 'Price target hit — $180.00'),
      anyEvent('o2', 'outcome_evaluated', 'review', '2026-07-31', 'Price target missed — $120.00'),
    ] as never
    renderSnapshot()
    expect(screen.getByTestId('decision-memory-summary-empty')).toBeInTheDocument()
  })

  it('leaves a thesis change to Research', () => {
    timelineEvents = [
      anyEvent('m1', 'thesis_changed', 'review', '2026-08-31', 'Thesis changed'),
      anyEvent('t1', 'trade_executed', 'execution', '2026-03-02', 'Opened position'),
    ] as never
    renderSnapshot()
    expect(screen.getByTestId('snapshot-decision-history')).not.toHaveTextContent('Thesis changed')
  })

  it('says nothing about evidence when the fill was actually observed', () => {
    /*
     * An observed fill is the expectation. Labelling it puts a badge on
     * every row, and a page where every row carries a badge has taught the
     * reader to stop reading them — which is precisely how the one row that
     * SHOULD be flagged gets missed.
     */
    timelineEvents = [
      { ...anyEvent('t1', 'trade_executed', 'execution', '2026-03-02', 'Opened position'),
        executionProof: 'verified' },
    ] as never
    renderSnapshot()
    const row = within(screen.getByTestId('decision-memory-recent')).getAllByRole('listitem')[0]
    expect(row).toHaveTextContent('Opened position')
    expect(row.textContent ?? '').not.toMatch(/\(/)
  })

  it('keeps a decision review, which is a judgment on a decision', () => {
    timelineEvents = [
      anyEvent('r1', 'review_recorded', 'review', '2026-08-31', 'Decision reviewed'),
    ] as never
    renderSnapshot()
    expect(screen.getByTestId('snapshot-decision-history')).toHaveTextContent('Decision reviewed')
  })
})

/**
 * "Decision history" shows the history.
 *
 * Measured on AMZN before this: the block ran a headline, a four-chip count
 * row, an unobserved-fill caveat, an access caveat, a "Latest:" line and a
 * link — six lines ABOUT a record and one line OF it, in a card whose title
 * promises the record.
 *
 * The headline stays and still leads, because the argument in
 * `DecisionMemorySummary`'s header holds: four executions in a row say
 * nothing about what is waiting. What changed is that the counts stop being
 * the whole content.
 */
describe('Decision history draws the record', () => {
  beforeEach(() => { timelineEvents = []; timelineError = false })

  const ev = (id: string, ts: string, title: string, extra: Record<string, unknown> = {}) => ({
    id, type: 'trade_executed', phase: 'execution', timestamp: ts,
    title, subtitle: null, actor: null, portfolio: null, sizing: null,
    rationale: null, sourceRef: { type: 'trade_event', id },
    executionProof: 'verified', provenance: { table: 'e', rowId: id },
    disposition: 'positive', ...extra,
  })

  it('lists the recent events, newest first, with their dates', () => {
    timelineEvents = [
      ev('e3', '2026-06-05', 'Trimmed to 2%'),
      ev('e2', '2026-05-01', 'Added 1.5%'),
      ev('e1', '2026-03-02', 'Opened position'),
    ] as never
    renderSnapshot()
    const rows = within(screen.getByTestId('decision-memory-recent')).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Trimmed to 2%')
    expect(rows[2]).toHaveTextContent('Opened position')
    // A dated record, not a list of titles.
    expect(rows[0].textContent ?? '').toMatch(/2026/)
  })

  it('stops at three and leaves the rest to the full history', () => {
    timelineEvents = [
      ev('e4', '2026-06-06', 'Fourth'), ev('e3', '2026-06-05', 'Third'),
      ev('e2', '2026-06-04', 'Second'), ev('e1', '2026-06-03', 'First'),
    ] as never
    renderSnapshot()
    expect(within(screen.getByTestId('decision-memory-recent')).getAllByRole('listitem'))
      .toHaveLength(3)
    expect(screen.getByTestId('snapshot-decision-history')).not.toHaveTextContent('First')
  })

  it('drops the count chips, which the rows now carry as dated facts', () => {
    timelineEvents = [ev('e1', '2026-06-05', 'Opened position')] as never
    renderSnapshot()
    expect(screen.queryByTestId('memory-chip-executed')).toBeNull()
    // The state of play survives — it is the one count that is not a tally.
    expect(screen.getByTestId('snapshot-decision-history')).toHaveTextContent(/executed/i)
  })

  it('offers one way through to the full record, not two', () => {
    timelineEvents = [ev('e1', '2026-06-05', 'Opened position')] as never
    renderSnapshot()
    const block = screen.getByTestId('snapshot-decision-history')
    const through = within(block).getAllByRole('button', { name: /history/i })
    expect(through).toHaveLength(1)
    expect(screen.queryByTestId('decision-memory-open-timeline')).toBeNull()
  })

  it('does not label the furthest-by-phase event as the latest one', () => {
    /*
     * `furthest` is by PHASE and the line calling it "Latest:" was naming a
     * different fact. Under the rows it is suppressed outright, and the rows
     * above ARE in date order, so nothing on this block claims to be the
     * latest while being chosen some other way.
     */
    timelineEvents = [
      ev('e2', '2026-06-05', 'Recommendation filed', { type: 'proposal_submitted', phase: 'exploratory', executionProof: null }),
      ev('e1', '2026-03-02', 'Opened position'),
    ] as never
    renderSnapshot()
    expect(screen.getByTestId('snapshot-decision-history').textContent ?? '')
      .not.toMatch(/Latest:/)
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

  it('shows a request from any book, because there is no book to choose', () => {
    /*
     * Was "scopes the queue to the chosen book": pick a book that owes
     * nothing and the block disappears. With the selector gone there is no
     * choice to honour, and the inverse property is what must hold — a
     * request owed in ANY book reaches the reader. Each row still names its
     * own book, so nothing is ambiguous.
     */
    data = { ...BASE, decisions: [request({ decisionNote: 'Growth only' })] }
    renderSnapshot()
    expect(screen.getByTestId('snapshot-needs-decision')).toHaveTextContent('Growth only')
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

  it('shows the viewer\'s own rating when it differs, and leaves the firm\'s to the strip', () => {
    /*
     * Was `expect(getByText(/Firm Buy · 2 of 3/))` beside the "You Hold"
     * chip. The subject — firm and personal are never merged into one figure
     * — is unchanged; WHERE the firm half is stated is what moved.
     *
     * The header context strip states the consensus and its n, permanently
     * and a couple of hundred pixels above this, so printing it again here
     * was the same fact twice in one eyeful — and on a name with no rating,
     * which is most of them, it was a labelled blank holding the top of the
     * rail. `asset-context-strip.test.tsx` guards the non-merging up there.
     *
     * What this page must still do is show the reader's OWN view when it
     * diverges, because that is precisely the thing the strip does not say.
     */
    ratings = [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }]
    consensus = [{ value: 'Buy', count: 2, percentage: 66 }]
    myRating = { rating_value: 'Hold' }
    renderSnapshot({ contributions: [], currentUserId: 'me' })
    /*
     * This was a "You Hold" chip in the right rail. The rail is gone; the
     * fact moved into the position line, where a divergence reads as a
     * disagreement with the firm rather than as a status field about you.
     * The subject is unchanged: the two are never merged into one figure.
     */
    const line = screen.getByTestId('snapshot-position-line')
    expect(line).toHaveTextContent('You rate it Hold')
    expect(line).toHaveTextContent('Buy')
    expect(line.textContent ?? '').not.toMatch(/Firm Buy/)
  })

  it('says nothing at all about rating when the reader agrees with the firm', () => {
    // No divergence, nothing the strip has not already said: no rail entry,
    // not an empty one.
    ratings = [{ id: 'r1' }, { id: 'r2' }]
    consensus = [{ value: 'Buy', count: 2, percentage: 100 }]
    myRating = { rating_value: 'Buy' }
    renderSnapshot({ contributions: [], currentUserId: 'me' })
    expect(screen.queryByText('Your rating')).toBeNull()
    expect(screen.queryByText(/No firm rating/)).toBeNull()
  })

  it('counts the viewer\'s own case sections and flags where analysts differ', () => {
    data = {
      ...BASE,
      caseWrittenAt: '2026-01-01T00:00:00Z',
      coreSections: ['thesis', 'risks_to_thesis'],
      sections: [
        { section: 'thesis', content: 'We think LLY wins.', supportingDetail: null, updatedAt: '2026-01-01T00:00:00Z', authorName: 'Me' },
        /* The second analyst's row. It is what "2 views" counts now: see
           below. */
        { section: 'thesis', content: 'The pipeline is thinner than that.', supportingDetail: null, updatedAt: '2026-01-01T00:00:00Z', authorName: 'Other' },
      ],
    }
    renderSnapshot({
      currentUserId: 'me',
      contributions: [
        contrib({ section: 'thesis', created_by: 'me' }),
        contrib({ section: 'thesis', created_by: 'other' }),
        contrib({ section: 'risks_to_thesis', created_by: 'me' }),
      ],
    })
    /*
     * Two of the four assertions here were the right rail: "2 of 3 case
     * sections" and "1 section with differing views". The rail is gone, on
     * the call that a progress bar over your own filing, printed next to
     * the filing, answers nobody's question.
     *
     * The two that survive are the ones ON the prose, and they carry the
     * whole subject of this case: the reader can see which section is
     * theirs, and which section more than one analyst has written. The
     * divergence is now stated where it happened rather than counted in a
     * sidebar.
     *
     * WHAT CHANGED UNDER THEM. "2 views" used to be counted off the
     * `contributions` prop, because the block rendered only the first
     * workspace row per section and so could not count its own content. It
     * now renders EVERY row, and the count is the number of views actually
     * drawn. That is the honest number: a contribution the org scope
     * excludes is not a view the reader can read. So the fixture grows the
     * second thesis row that the real query returns, rather than claiming
     * two views and showing one.
     *
     * "You" is still contributions-derived, because WHOSE a view is comes
     * from the author id, which the workspace rows do not carry. Both
     * sections the reader wrote are marked, so this counts them.
     */
    expect(screen.getAllByText('You')).toHaveLength(2)
    expect(screen.getByRole('button', { name: /2 views/ })).toBeInTheDocument()
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
    // The rail's "1 of 3 case sections" went with the rail. The subject of
    // this case was never the count: it is that one author is not a
    // consensus, and that nothing on the page claims a divergence that does
    // not exist. Both negatives stand unchanged.
    expect(screen.queryByText(/differing views/)).toBeNull()
    expect(screen.queryByText(/2 views/)).toBeNull()
    expect(screen.getByTestId('snapshot-our-view')).toHaveTextContent('We think LLY wins')
  })

  it('invites a view when nothing is written, without faking one', () => {
    /*
     * This asserted the rail's "You haven't recorded your own view →".
     * That prompt went with the rail, and it is a real loss on one narrow
     * case: a name where the firm HAS a written case and the reader has
     * not contributed to it now gets no personal nudge. Flagged rather than
     * smuggled back in, because a one-line rail for one prompt is the thing
     * that was just removed.
     *
     * What the case was protecting is intact and is what it asserts now:
     * an empty case states its own emptiness and offers the way to fill it,
     * and the page never fabricates a view on the reader's behalf.
     */
    renderSnapshot({ contributions: [], currentUserId: 'me' })
    const block = screen.getByTestId('snapshot-our-view')
    expect(block).toHaveTextContent(/No core investment case has been written/)
    expect(within(block).getByRole('button', { name: /Write the investment case/ }))
      .toBeInTheDocument()
  })
})
