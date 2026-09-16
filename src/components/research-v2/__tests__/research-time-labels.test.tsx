/**
 * Research never says "review" unless the date is a recorded review.
 *
 * The scan's clock is the newest save of a core thesis section -- an edit.
 * A generated coverage subject counts from its case's anchor, which is a
 * recorded research review only when the shared rule anchored on one, and
 * otherwise the case being written. Tiles, rail, detail, chart and Ask AI
 * must all name each date for what it is.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { CoverageResearchCandidate } from '../../../lib/research/coverage-research-gaps'
import type { ResearchFraming } from '../../../lib/research/case-state'
import type { ResearchSubject } from '../../../lib/desktop-research'

const DAY = 86_400_000
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString()
const closes = (days: number) => Array.from({ length: days + 1 }, (_, i) => ({
  date: new Date(Date.now() - (days - i) * DAY).toISOString().slice(0, 10),
  close: 100 + i,
}))

const env = vi.hoisted(() => ({
  gaps: { status: 'ready', candidates: [] as unknown[], coveredCount: 0 },
  scan: [] as unknown[],
  detail: { sections: [], evidence: [] } as Record<string, unknown>,
}))

vi.mock('../../../hooks/useCoverageResearchGaps', () => ({ useCoverageResearchGaps: () => env.gaps }))
vi.mock('../../../hooks/useDesktopResearch', () => ({
  useResearchScan: () => ({ subjects: env.scan, isLoading: false }),
  useResearchExposure: () => ({ exposure: {}, settled: true }),
  useResearchDetail: () => ({ detail: env.detail, isLoading: false }),
}))

/* The review recorder needs auth and org context this suite does not stand up.
   What it writes is covered in lib/memory/__tests__/thesis-review. */
vi.mock('../../../hooks/useThesisReview', () => ({
  useThesisReviews: () => new Map(),
  useRecordThesisReview: () => ({ record: vi.fn(), isPending: false, isDone: false, error: null }),
}))

/* Same reason: the view cursor needs auth and org context this suite does not
   stand up. Its behaviour is covered in lib/attention-state/__tests__. */
vi.mock('../../../hooks/useObjectViewCursor', () => ({
  useRecordObjectView: () => ({ previous: null, ready: true }),
}))
vi.mock('../../contributions', () => ({ ThesisContainer: () => null }))
vi.mock('../../../lib/dashboard/focus', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../lib/dashboard/focus')>()
  return { ...actual, openDashboardFocus: () => true }
})

import { ResearchWorkspace, toRailCard } from '../ResearchWorkspace'
import { PriceSinceReview, anchoredWindow } from '../ResearchVisual'
import { subjectFromCoverage, targetFor, seedPromptFor, whyItMatters, issueFor } from '../../../lib/desktop-research'

/** Wording that claims a review happened. Calls to action ("Review thesis", "Review due") are not claims. */
const CLAIMS_REVIEW = /since (the )?(last )?review|last review|last reviewed|reviewed \d+d? ago|unreviewed/i

const scanned = (over: Partial<ResearchSubject> = {}): ResearchSubject => ({
  assetId: 'a-amzn', symbol: 'AMZN', companyName: 'Amazon.com',
  thesisUpdatedAt: daysAgo(140), daysSinceReview: 140,
  sectionCount: 3, coreSectionCount: 3, coreSections: ['thesis', 'where_different', 'risks_to_thesis'],
  evidenceCount: 2, newestEvidenceAt: daysAgo(200), newSinceReview: 0, ...over,
})

function candidate(framing: ResearchFraming, anchoredOn: 'reviewed' | 'written', ageDays: number, writtenDays = ageDays): CoverageResearchCandidate {
  return {
    id: 'coverage-research:a-nke', assetId: 'a-nke', symbol: 'NKE', companyName: 'Nike',
    coverage: 'own', framing, priority: 5, score: 0.5, headline: 'x', body: 'x', prompt: 'x',
    facts: {
      missingSections: [], presentSections: ['thesis', 'where_different', 'risks_to_thesis'],
      movePct: framing === 'price_move' ? 18.2 : null, evidenceSince: [], evidenceCount: 0,
      daysSinceReview: ageDays, daysSinceWritten: writtenDays, anchoredOn,
      caseWrittenAt: daysAgo(writtenDays), reviewAnchor: daysAgo(ageDays),
    },
    exposure: { held: false, weightPct: null, portfolioId: null, portfolioName: null, portfolioCount: 0 },
    liveIdeas: [],
    open: { assetId: 'a-nke', symbol: 'NKE', companyName: 'Nike', focus: 'research', origin: 'coverage-research', issue: 'x' },
    insight: {} as never,
  }
}

const tile = () => screen.getByTestId('research-tile')
const detailPane = () => screen.getByTestId('research-detail')
const aiLabels = (s: ResearchSubject) => (targetFor(s)!.contextChips ?? []).map(c => c.label)

beforeEach(() => {
  env.gaps = { status: 'ready', candidates: [], coveredCount: 0 }
  env.scan = []
  env.detail = { sections: [], evidence: [], history: closes(300) }
})

describe('an edited thesis (every scan subject)', () => {
  it('says update on the tile, the detail, the chart and in Ask AI', () => {
    const s = scanned()
    env.scan = [s]
    const view = render(<ResearchWorkspace />)
    expect(tile()).toHaveTextContent('140d since update')
    expect(tile()).toHaveTextContent('since the thesiswas last updated')
    expect(tile().textContent).not.toMatch(CLAIMS_REVIEW)
    view.unmount()

    render(<ResearchWorkspace focusObjectId="a-amzn" selectedAssetId="a-amzn" />)
    const pane = detailPane()
    expect(within(pane).getByText('Last updated')).toBeInTheDocument()
    expect(within(pane).getByText('updated 140d ago')).toBeInTheDocument()
    expect(within(pane).getByText('Since the thesis was last updated')).toBeInTheDocument()
    expect(within(pane).getAllByText('Price since the last update').length).toBeGreaterThan(0)
    expect(within(pane).getAllByText('LAST UPDATE').length).toBeGreaterThan(0)
    expect(pane.textContent).not.toMatch(CLAIMS_REVIEW)

    expect(whyItMatters(s)).toBe('Thesis last updated 140 days ago.')
    expect(aiLabels(s)).toContain('Last updated')
    expect(seedPromptFor(s)).toMatch(/was last updated 140 days ago/)
    expect(`${aiLabels(s).join(' ')} ${seedPromptFor(s)}`).not.toMatch(CLAIMS_REVIEW)
  })
})

describe('a generated coverage tile: thesis written, never reviewed', () => {
  it('says written, like the Today tile for the same case, everywhere Research shows it', () => {
    const c = candidate('long_silence', 'written', 140)
    const s = subjectFromCoverage(c)
    env.gaps = { status: 'ready', candidates: [c], coveredCount: 1 }
    const view = render(<ResearchWorkspace />)
    expect(tile()).toHaveTextContent('140d since written')
    expect(tile()).toHaveTextContent('since the thesiswas written')
    expect(tile().textContent).not.toMatch(CLAIMS_REVIEW)
    view.unmount()

    render(<ResearchWorkspace focusObjectId="a-nke" selectedAssetId="a-nke" />)
    const pane = detailPane()
    expect(within(pane).getByText('Last written')).toBeInTheDocument()
    expect(within(pane).getByText('Since the thesis was written')).toBeInTheDocument()
    expect(within(pane).getAllByText('Price since the thesis was written').length).toBeGreaterThan(0)
    expect(pane.textContent).not.toMatch(CLAIMS_REVIEW)

    expect(aiLabels(s)).toContain('Last written')
    expect(seedPromptFor(s)).toMatch(/was last written 140 days ago/)
  })

  it('names a move since the thesis was written on the tile and the rail', () => {
    const c = candidate('price_move', 'written', 60)
    const s = subjectFromCoverage(c)
    env.gaps = { status: 'ready', candidates: [c], coveredCount: 1 }
    render(<ResearchWorkspace />)
    expect(issueFor(s)).toBe('Moved since thesis')
    expect(tile()).toHaveTextContent('since the thesiswas written')
    expect(toRailCard(s).figureLabel).toBe('since written')
    expect(tile().textContent).not.toMatch(CLAIMS_REVIEW)
  })
})

describe('a genuine recorded review', () => {
  it('keeps review wording for the age, and names the chart by the thesis date it starts from', () => {
    // Reviewed 30 days ago; the case itself was last written 200 days ago.
    const c = candidate('long_silence', 'reviewed', 30, 200)
    const s = subjectFromCoverage(c)
    env.gaps = { status: 'ready', candidates: [c], coveredCount: 1 }
    const view = render(<ResearchWorkspace />)
    expect(tile()).toHaveTextContent('30d since review')
    expect(tile()).toHaveTextContent('since the thesiswas last reviewed')
    view.unmount()

    render(<ResearchWorkspace focusObjectId="a-nke" selectedAssetId="a-nke" />)
    const pane = detailPane()
    expect(within(pane).getByText('Last review')).toBeInTheDocument()
    expect(within(pane).getByText('reviewed 30d ago')).toBeInTheDocument()
    // The chart starts at the thesis date (written), not at the review.
    expect(within(pane).getAllByText('Price since the thesis was written').length).toBeGreaterThan(0)

    expect(aiLabels(s)).toContain('Last review')
    expect(seedPromptFor(s)).toMatch(/was last reviewed 30 days ago/)

    const moved = subjectFromCoverage(candidate('price_move', 'reviewed', 30, 200))
    expect(issueFor(moved)).toBe('Moved since review')
    expect(toRailCard(moved).figureLabel).toBe('since review')
  })
})

describe('the price chart', () => {
  const chartText = (kind: 'reviewed' | 'written' | 'updated', historyDays: number, anchorDays: number) => {
    const w = anchoredWindow(closes(historyDays), daysAgo(anchorDays))!
    const { container, unmount } = render(<PriceSinceReview w={w} since={kind} />)
    const text = container.textContent ?? ''
    unmount()
    return text
  }

  it('names the start event it was given, and a review only when that is a review', () => {
    const updated = chartText('updated', 200, 100)
    expect(updated).toContain('Price since the last update')
    expect(updated).toContain('since update · ')
    expect(updated).toContain('LAST UPDATE')
    expect(updated).not.toMatch(CLAIMS_REVIEW)

    const written = chartText('written', 200, 100)
    expect(written).toContain('Price since the thesis was written')
    expect(written).toContain('WRITTEN')
    expect(written).not.toMatch(CLAIMS_REVIEW)

    const reviewed = chartText('reviewed', 200, 100)
    expect(reviewed).toContain('Price since the last review')
    expect(reviewed).toContain('LAST REVIEW')
  })

  it('falls back to the history it measured, naming the real start date it could not reach', () => {
    const short = chartText('updated', 30, 100)
    expect(short).toContain('Price over available history')
    expect(short).toContain('History does not reach the update date, so this is not a since update move.')
    expect(short).not.toMatch(/review/i)
  })
})
