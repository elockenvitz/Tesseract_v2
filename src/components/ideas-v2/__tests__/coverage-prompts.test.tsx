/**
 * A thin Ideas field, filled from the reader's own coverage.
 *
 * Bogey Cap graduates with one genuine idea and five seeded demo rows. The
 * lens must show the reader's work first, stop showing the tour, and fill the
 * rest of the field with names they cover and have no idea on -- as ordinary
 * Ideas tiles, suggesting only, creating nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import type { CoverageResearchCandidate } from '../../../lib/research/coverage-research-gaps'
import type { ResearchFraming } from '../../../lib/research/case-state'
import type { IdeaRow } from '../../../lib/desktop-ideas'

const DAY = 86_400_000
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString()

const env = vi.hoisted(() => ({
  scan: [] as unknown[],
  gaps: { status: 'ready', candidates: [] as unknown[], coveredCount: 0 },
  graduated: true,
  opened: [] as Array<Record<string, unknown>>,
}))

vi.mock('../../../hooks/useDesktopIdeas', () => ({
  useIdeaScan: () => ({ ideas: env.scan, isLoading: false, error: null }),
  useScanExposure: () => ({ exposure: {}, settled: true }),
  useScanFramework: () => ({}),
  useScanOpenPrice: () => ({}),
  useIdeaDetail: () => ({ detail: undefined, isLoading: false }),
}))
vi.mock('../../../hooks/useCoverageResearchGaps', () => ({ useCoverageResearchGaps: () => env.gaps }))
vi.mock('../../../hooks/usePilotMode', () => ({ usePilotMode: () => ({ hasGraduated: env.graduated }) }))
vi.mock('../../../hooks/useDesktopResearch', () => ({ useHasResearch: () => false }))
vi.mock('../DecisionModule', () => ({ DecisionModule: () => null }))
vi.mock('../../../hooks/useIdeaDecision', () => ({ useIdeaDecision: () => ({ decision: undefined, isLoading: false }) }))
vi.mock('../../../lib/dashboard/focus', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../lib/dashboard/focus')>()
  return { ...actual, openDashboardFocus: (r: unknown) => { env.opened.push(r as Record<string, unknown>); return true } }
})

import { IdeasWorkspace } from '../IdeasWorkspace'
import { IDEAS_PROMPT_LIMIT, IDEAS_PROMPT_CAPS } from '../../../lib/desktop-ideas'

const BOOK = 'Tech & Consumer Growth'
const held = (weightPct: number) => ({ held: true, weightPct, portfolioId: 'p1', portfolioName: BOOK, portfolioCount: 1 })
const PRIORITY: Record<ResearchFraming, number> = { new_evidence: 1, price_move: 2, no_case: 3, incomplete_case: 4, long_silence: 5 }

function candidate(symbol: string, framing: ResearchFraming = 'no_case', over: Partial<CoverageResearchCandidate> = {}): CoverageResearchCandidate {
  const assetId = `a-${symbol.toLowerCase()}`
  const anchored = framing !== 'no_case'
  return {
    id: `coverage-research:${assetId}`, assetId, symbol, companyName: `${symbol} Inc`,
    coverage: 'own', framing, priority: PRIORITY[framing], score: 0.5,
    headline: 'x', body: 'x', prompt: 'x',
    facts: {
      missingSections: framing === 'incomplete_case' ? ['risks_to_thesis'] : framing === 'no_case' ? ['thesis', 'where_different', 'risks_to_thesis'] : [],
      presentSections: framing === 'no_case' ? [] : ['thesis'],
      movePct: framing === 'price_move' ? -16.4 : null,
      evidenceSince: framing === 'new_evidence' ? [{ id: 'n1', at: daysAgo(2), authorId: null, title: 'Q3 read', kind: 'note' }] as never : [],
      evidenceCount: framing === 'new_evidence' ? 1 : 0,
      daysSinceReview: anchored ? 120 : null, daysSinceWritten: anchored ? 120 : null,
      anchoredOn: anchored ? 'written' : null,
      caseWrittenAt: anchored ? daysAgo(120) : null, reviewAnchor: anchored ? daysAgo(120) : null,
    },
    exposure: { held: false, weightPct: null, portfolioId: null, portfolioName: null, portfolioCount: 0 },
    liveIdeas: [],
    open: { assetId, symbol, companyName: null, focus: 'research', origin: 'coverage-research', issue: 'x' },
    insight: {} as never,
    ...over,
  }
}

const idea = (symbol: string, over: Partial<IdeaRow> = {}): IdeaRow => ({
  id: `idea-${symbol}`, assetId: `a-${symbol.toLowerCase()}`, symbol, companyName: `${symbol} Inc`,
  direction: 'buy', stage: 'idea', maturity: 'researching', conviction: null,
  thesis: `${symbol} claim`, urgency: null, proposedWeight: null,
  portfolioId: 'p1', portfolioName: BOOK, createdBy: 'u1', authorName: 'Eric',
  createdAt: daysAgo(1), updatedAt: daysAgo(1), decisionOutcome: null, ...over,
})

/** Bogey Cap on graduation day: one genuine idea, five seeded demo rows. */
const bogeyIdeas = () => [
  idea('LLY'),
  ...['MSFT', 'NVDA', 'AMZN', 'META', 'AAPL'].map(s => idea(s, { isPilotSeed: true })),
]

/** Its coverage: three held names with nothing open, and a long tail. */
const bogeyCoverage = () => [
  candidate('TSLA', 'no_case', { exposure: held(3.2) }),
  candidate('SBUX', 'no_case', { exposure: held(2.3) }),
  candidate('MELI', 'no_case', { exposure: held(2.1) }),
  ...Array.from({ length: 46 }, (_, i) => candidate(`U${String(i).padStart(2, '0')}`)),
]

const tiles = () => screen.queryAllByTestId('idea-tile')
const tickers = () => tiles().map(t => t.getAttribute('aria-label')?.split(',')[0])

beforeEach(() => {
  env.scan = bogeyIdeas()
  env.gaps = { status: 'ready', candidates: bogeyCoverage(), coveredCount: 49 }
  env.graduated = true
  env.opened.length = 0
})

describe('a graduated account', () => {
  it('drops the seeded demo tickers and leads with the reader’s own idea', () => {
    render(<IdeasWorkspace />)
    expect(tickers()[0]).toBe('LLY')
    for (const demo of ['MSFT', 'NVDA', 'META', 'AAPL']) {
      expect(tickers()).not.toContain(demo)
    }
  })

  it('keeps the seeded ideas while the pilot is still running', () => {
    env.graduated = false
    render(<IdeasWorkspace />)
    expect(tickers()).toEqual(expect.arrayContaining(['LLY', 'MSFT', 'NVDA', 'META', 'AAPL']))
  })

  it('fills the rest of the field with coverage prompts, exposure first', () => {
    render(<IdeasWorkspace />)
    // One real idea, then held names by weight, then bare coverage to its cap.
    expect(tickers().slice(0, 4)).toEqual(['LLY', 'TSLA', 'SBUX', 'MELI'])
    expect(tiles().length).toBeLessThanOrEqual(1 + IDEAS_PROMPT_LIMIT)
    // Fifty candidates are not fifty tiles.
    expect(screen.getAllByTestId('idea-suggested').length).toBeLessThanOrEqual(IDEAS_PROMPT_LIMIT)
    const bare = tickers().filter(t => t?.startsWith('U'))
    expect(bare.length).toBeLessThanOrEqual(IDEAS_PROMPT_CAPS['no_case:unheld'])
  })

  it('never suggests a name any idea already concerns, seeded ones included', () => {
    env.gaps = {
      status: 'ready', coveredCount: 4,
      candidates: [candidate('AMZN', 'price_move', { exposure: held(5.4) }), candidate('TSLA', 'no_case', { exposure: held(3.2) })],
    }
    render(<IdeasWorkspace />)
    // AMZN has a seeded idea: hidden from the field, but the work exists.
    expect(tickers().filter(t => t === 'AMZN')).toHaveLength(0)
    expect(tickers()).toContain('TSLA')
  })
})

describe('a prompt is a suggestion, not an idea', () => {
  it('says why the name is worth thinking about, without claiming a stance or a stage', () => {
    render(<IdeasWorkspace />)
    const tsla = tiles()[1]
    expect(within(tsla).getByTestId('idea-suggested')).toHaveTextContent('Suggested')
    expect(tsla).toHaveTextContent('Position without an idea')
    expect(tsla).toHaveTextContent('A 3.2% position in Tech & Consumer Growth with no active idea and no written thesis.')
    // No stance, no maturity, and no complaint about an object that does not
    // exist yet.
    expect(tsla.textContent).not.toMatch(/researching|thesis forming|\bbuy\b|no cases|no target|0d open/i)
    expect(tsla).toHaveTextContent('Your coverage · in Tech & Consumer Growth · 3.2% held')
  })

  it('emphasises the change where something changed', () => {
    env.scan = [idea('LLY')]
    env.gaps = {
      status: 'ready', coveredCount: 2,
      candidates: [
        candidate('NKE', 'new_evidence', { exposure: held(1.4) }),
        candidate('ORCL', 'price_move'),
      ],
    }
    render(<IdeasWorkspace />)
    expect(tiles()[1]).toHaveTextContent('NKE has new evidence since the case was written and no active idea, on a 1.4% position in Tech & Consumer Growth.')
    expect(tiles()[2]).toHaveTextContent('ORCL has moved -16.4% since the case was written, with no active idea.')
  })

  it('opens the existing capture form on that asset and creates nothing', () => {
    const captures: Array<Record<string, unknown>> = []
    const listener = (e: Event) => captures.push((e as CustomEvent).detail)
    window.addEventListener('openThoughtsCapture', listener)
    render(<IdeasWorkspace />)
    fireEvent.click(within(tiles()[1]).getByTestId('idea-quick-open'))
    window.removeEventListener('openThoughtsCapture', listener)

    expect(captures).toEqual([{
      contextType: 'asset', contextId: 'a-tsla', contextTitle: 'TSLA', captureType: 'trade_idea',
    }])
    // It does not open a detail pane for an object that does not exist.
    expect(env.opened).toHaveLength(0)
    expect(within(tiles()[1]).getByTestId('idea-quick-open')).toHaveTextContent('Start an idea')
  })
})

describe('real ideas are never displaced', () => {
  it('ranks every real idea above every prompt, whatever the prompt carries', () => {
    env.scan = [idea('LLY', { maturity: 'researching', createdAt: daysAgo(400), updatedAt: daysAgo(400) })]
    env.gaps = {
      status: 'ready', coveredCount: 1,
      candidates: [candidate('TSLA', 'new_evidence', { exposure: held(9.9) })],
    }
    render(<IdeasWorkspace />)
    expect(tickers()).toEqual(['LLY', 'TSLA'])
  })

  it('shows no prompts once the field is full of real work', () => {
    env.scan = Array.from({ length: 8 }, (_, i) => idea(`R${i}`))
    render(<IdeasWorkspace />)
    expect(screen.queryAllByTestId('idea-suggested')).toHaveLength(0)
    expect(tiles()).toHaveLength(8)
  })

  it('waits for the coverage scan instead of announcing an empty lens', () => {
    env.scan = []
    env.gaps = { status: 'loading', candidates: [], coveredCount: 0 }
    render(<IdeasWorkspace />)
    expect(screen.queryByText('No open ideas')).not.toBeInTheDocument()
  })
})
