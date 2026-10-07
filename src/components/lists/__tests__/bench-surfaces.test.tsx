/**
 * What the workbench is allowed to say.
 *
 * The bench was designed from a prototype that assumed data we do not store —
 * a price at the moment the case was written, share and dollar sizing, a
 * sentence interpreting whether the thesis still held. The risk this file exists
 * for is not a layout bug: it is the surface quietly presenting a number or a
 * conclusion that nothing in the database supports, which looks exactly like a
 * working feature.
 *
 * So these tests assert absence as hard as presence, and they assert that Work
 * reorganises around what is actually open rather than rendering a decision
 * layout for every name.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  WorkSurface, MarketSurface, BenchSpine, BenchHeader,
  type BenchIdea, type ReviewControl,
} from '../ListBenchViews'

const review: ReviewControl = { isDone: false, isPending: false, onRecord: vi.fn() }

const idea = (over: Partial<BenchIdea> = {}): BenchIdea => ({
  direction: 'buy',
  stage: 'ready_to_recommend',
  portfolioName: 'Core Equity',
  proposedWeight: 3.2,
  rationale: 'Mix shift is structural, not cyclical.',
  authorName: 'A. Analyst',
  createdAt: '2026-09-28T10:00:00Z',
  conviction: 'high',
  ...over,
})

const caseRow = (content: string) => ({
  key: 'thesis',
  row: { content, authorName: 'A. Analyst' },
})

const note = (over: Partial<{ id: string; title: string; isNewSinceReview: boolean }> = {}) => ({
  id: over.id ?? 'n1',
  title: over.title ?? 'Q3 beat on gross margin',
  content: 'Gross margin 240bps ahead.',
  authorName: 'A. Analyst',
  createdAt: '2026-10-02T10:00:00Z',
  isNewSinceReview: over.isNewSinceReview ?? false,
})

const workProps = {
  idea: null as BenchIdea | null,
  tier: 'clear' as const,
  stateLabel: null,
  secondary: null,
  changes: [],
  caseWrittenAt: null,
  leadCase: null,
  weightPct: null,
  target: null,
  upsidePct: null,
  review,
  onGoToCase: vi.fn(),
}

describe('Work reorganises around what is actually open', () => {
  it('states the decision when an idea is awaiting one', () => {
    render(<WorkSurface {...workProps} idea={idea()} tier="decision" weightPct={1.1} />)
    expect(screen.getByTestId('bench-work-idea')).toBeInTheDocument()
    expect(screen.getByText('BUY')).toBeInTheDocument()
    // The desk's words, not the database's.
    expect(screen.queryByText(/ready_to_recommend/)).not.toBeInTheDocument()
  })

  it('does NOT render a decision layout for a name with no idea', () => {
    render(<WorkSurface {...workProps} leadCase={caseRow('Compounder at a discount.')} />)
    expect(screen.queryByTestId('bench-work-idea')).not.toBeInTheDocument()
    // No empty Current → Proposed frame, which is the failure this guards: a
    // decision surface rendered for a name that has no decision pending.
    expect(screen.queryByText('Proposed')).not.toBeInTheDocument()
    expect(screen.getByTestId('bench-work-clear')).toBeInTheDocument()
  })

  it('leads with unanswered evidence over a case that merely looks old', () => {
    render(
      <WorkSurface
        {...workProps}
        tier="evidence"
        stateLabel="Unreviewed research"
        leadCase={caseRow('Compounder at a discount.')}
        caseWrittenAt="2026-08-01T10:00:00Z"
        changes={[note({ isNewSinceReview: true }), note({ id: 'n2' })]}
      />,
    )
    expect(screen.getByTestId('bench-work-unread')).toBeInTheDocument()
    expect(screen.getByText('1 new since the case was written')).toBeInTheDocument()
  })

  it('asks for the case when there is none to review against', () => {
    render(<WorkSurface {...workProps} tier="gap" changes={[note()]} />)
    expect(screen.getByTestId('bench-work-no-case')).toBeInTheDocument()
    expect(screen.getByText('No thesis on file')).toBeInTheDocument()
  })

  it('offers the three verdicts through the canonical writer, not a fourth option', async () => {
    const onRecord = vi.fn()
    render(
      <WorkSurface
        {...workProps}
        tier="evidence"
        leadCase={caseRow('Compounder.')}
        changes={[note({ isNewSinceReview: true })]}
        review={{ isDone: false, isPending: false, onRecord }}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Still holds' }))
    expect(onRecord).toHaveBeenCalledWith('holds')
    for (const label of ['Still holds', 'Changed', 'Needs work']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })
})

describe('the decision states only what is stored', () => {
  it('shows current → proposed when both weights exist, as a change', () => {
    render(<WorkSurface {...workProps} idea={idea({ proposedWeight: 3.2 })} tier="decision" weightPct={1.2} />)
    expect(screen.getByText('1.20%')).toBeInTheDocument()
    expect(screen.getByText('3.20%')).toBeInTheDocument()
    expect(screen.getByText('+200 bps')).toBeInTheDocument()
  })

  it('says "not sized" rather than inventing a proposed weight', () => {
    render(<WorkSurface {...workProps} idea={idea({ proposedWeight: null })} tier="decision" weightPct={1.2} />)
    expect(screen.getByText('not sized')).toBeInTheDocument()
    expect(screen.queryByText(/bps/)).not.toBeInTheDocument()
  })

  it('never offers shares or a dollar amount, which need a book value we do not read', () => {
    render(<WorkSurface {...workProps} idea={idea()} tier="decision" weightPct={1.2} />)
    expect(screen.queryByText(/\bsh\b/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^\$[\d,]{4,}/)).not.toBeInTheDocument()
  })

  it('does not take the decision itself — it opens where the decision is made', async () => {
    const onOpenAsset = vi.fn()
    render(
      <WorkSurface {...workProps} idea={idea()} tier="decision" weightPct={1.2}
        onOpenAsset={onOpenAsset} />,
    )
    // No Accept/Reject on a list surface: accepting is PM-gated and needs a
    // sizing decision this surface cannot honestly collect.
    expect(screen.queryByRole('button', { name: /^(Accept|Approve|Reject)/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Review the recommendation/ }))
    expect(onOpenAsset).toHaveBeenCalled()
  })
})

describe('Market reports the record, not an interpretation of it', () => {
  const marketProps = {
    closes: [100, 102, 98, 94],
    spot: 94,
    target: 130,
    upsidePct: 38.3,
    weightPct: 1.2,
    bookName: 'Core Equity',
    ratingValue: null,
    ratingColor: null,
    conviction: null,
    changes: [note({ isNewSinceReview: true })],
    caseWrittenAt: '2026-08-01T10:00:00Z',
    idea: null,
  }

  it('dates the events around the move without pricing them', () => {
    render(<MarketSurface {...marketProps} />)
    expect(screen.getByText('Case written')).toBeInTheDocument()
    expect(screen.getByText('Q3 beat on gross margin')).toBeInTheDocument()
    // The prototype put a price against each event. We store no history deep
    // enough to read one, so no event may carry a number.
    const timeline = screen.getByText('What happened around it').parentElement!
    expect(timeline.textContent).not.toMatch(/\$\d/)
  })

  it('says so plainly when there is no price history', () => {
    render(<MarketSurface {...marketProps} closes={null} />)
    expect(screen.getByText('No price history on file.')).toBeInTheDocument()
  })

  it('never states a conclusion about the thesis', () => {
    render(<MarketSurface {...marketProps} />)
    const text = screen.getByTestId('bench-market').textContent ?? ''
    for (const phrase of ['cheaper, not broken', 'thesis is', 'still holds', 'does it matter']) {
      expect(text.toLowerCase()).not.toContain(phrase.toLowerCase())
    }
  })
})

describe('the universe stays available while a security is engaged', () => {
  const entries = [
    { assetId: 'a1', symbol: 'TGT', tier: 'decision' as const },
    { assetId: 'a2', symbol: 'AAPL', tier: 'clear' as const },
    { assetId: 'a3', symbol: 'NKE', tier: 'evidence' as const },
  ]

  it('lists every name and marks the engaged one', () => {
    render(<BenchSpine entries={entries} activeAssetId="a2" onSelect={vi.fn()} />)
    for (const e of entries) expect(screen.getByText(e.symbol)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'AAPL' })).toHaveAttribute('aria-current', 'true')
  })

  it('moves to another name without leaving the bench', async () => {
    const onSelect = vi.fn()
    render(<BenchSpine entries={entries} activeAssetId="a2" onSelect={onSelect} />)
    await userEvent.click(screen.getByRole('button', { name: 'NKE' }))
    expect(onSelect).toHaveBeenCalledWith('a3')
  })

  it('offers a way back to the universe', async () => {
    const onClose = vi.fn()
    render(
      <BenchHeader symbol="TGT" companyName="Target Corp" why={null}
        mode="overview" onModeChange={vi.fn()} onClose={onClose} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Back to the universe' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('states why the reader is here only from a stored state', () => {
    render(
      <BenchHeader symbol="TGT" why={{ tone: 'decide', text: 'Awaiting a decision' }}
        mode="work" onModeChange={vi.fn()} onClose={vi.fn()} />,
    )
    expect(screen.getByText('Awaiting a decision')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Work' })).toHaveAttribute('aria-selected', 'true')
  })
})
