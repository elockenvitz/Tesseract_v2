/**
 * Coverage research gaps as ordinary Research tiles.
 *
 * A fresh account (Bogey Cap, 2026-09-15) covers fifty names with nothing
 * written. Research must look like Research: the same tiles, geometry, rail and
 * detail, with research on record first and generated work filling only the
 * capacity it left -- capped so fifty identical gaps are a handful of tiles.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import type { CoverageResearchCandidate } from '../../../lib/research/coverage-research-gaps'
import type { ResearchFraming } from '../../../lib/research/case-state'
import type { ResearchSubject } from '../../../lib/desktop-research'

const DAY = 86_400_000
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString()

const env = vi.hoisted(() => ({
  gaps: { status: 'ready', candidates: [] as unknown[], coveredCount: 0 } as { status: string; candidates: unknown[]; coveredCount: number },
  scan: [] as unknown[],
  opened: [] as Array<{ target: Record<string, unknown>; rail: Array<{ id: string }> }>,
  assetOpened: [] as Array<Record<string, unknown>>,
}))

vi.mock('../../../hooks/useCoverageResearchGaps', () => ({ useCoverageResearchGaps: () => env.gaps }))
vi.mock('../../../hooks/useDesktopResearch', () => ({
  useResearchScan: () => ({ subjects: env.scan, isLoading: false }),
  useResearchExposure: () => ({}),
  useResearchDetail: () => ({ detail: { sections: [], evidence: [] }, isLoading: false }),
}))
vi.mock('../../contributions', () => ({ ThesisContainer: () => null }))
vi.mock('../../../lib/dashboard/focus', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../lib/dashboard/focus')>()
  return { ...actual, openDashboardFocus: (r: unknown) => { env.opened.push(r as (typeof env.opened)[number]); return true } }
})
vi.mock('../../../lib/desktop-asset', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../lib/desktop-asset')>()
  return { ...actual, openAsset: (r: unknown) => { env.assetOpened.push(r as Record<string, unknown>); return true } }
})

import { ResearchWorkspace } from '../ResearchWorkspace'
import {
  withCoverageSubjects, subjectFromCoverage, stateOf, RESEARCH_FEED_CAPACITY, GENERATED_PER_STRUCTURAL_GAP,
} from '../../../lib/desktop-research'

const PRIORITY: Record<ResearchFraming, number> = { new_evidence: 1, price_move: 2, no_case: 3, incomplete_case: 4, long_silence: 5 }

function candidate(symbol: string, framing: ResearchFraming = 'no_case', over: Partial<CoverageResearchCandidate> = {}): CoverageResearchCandidate {
  const assetId = `a-${symbol.toLowerCase()}`
  const anchored = framing !== 'no_case'
  return {
    id: `coverage-research:${assetId}`, assetId, symbol, companyName: `${symbol} Inc`,
    coverage: 'own', framing, priority: PRIORITY[framing], score: 0.55,
    headline: 'x', body: 'x', prompt: 'What best describes this position?',
    facts: {
      missingSections: framing === 'incomplete_case' ? ['where_different', 'risks_to_thesis'] : framing === 'no_case' ? ['thesis', 'where_different', 'risks_to_thesis'] : [],
      presentSections: framing === 'no_case' ? [] : framing === 'incomplete_case' ? ['thesis'] : ['thesis', 'where_different', 'risks_to_thesis'],
      movePct: framing === 'price_move' ? 18.2 : null,
      evidenceSince: framing === 'new_evidence' ? [{ id: 'n1', at: daysAgo(2), authorId: null, title: 'Q3 read', kind: 'note' }] as never : [],
      evidenceCount: framing === 'new_evidence' ? 1 : 0,
      daysSinceReview: anchored ? (framing === 'long_silence' ? 120 : 20) : null,
      daysSinceWritten: anchored ? (framing === 'long_silence' ? 120 : 20) : null,
      anchoredOn: anchored ? 'written' : null,
      caseWrittenAt: anchored ? daysAgo(framing === 'long_silence' ? 120 : 20) : null,
      reviewAnchor: anchored ? daysAgo(20) : null,
    },
    exposure: { held: false, weightPct: null, portfolioId: null, portfolioName: null, portfolioCount: 0 },
    liveIdeas: [],
    open: { assetId, symbol, companyName: `${symbol} Inc`, focus: 'research', origin: 'coverage-research', issue: 'x' },
    insight: {} as never,
    ...over,
  }
}

const scanned = (symbol: string, over: Partial<ResearchSubject> = {}): ResearchSubject => ({
  assetId: `a-${symbol.toLowerCase()}`, symbol, companyName: `${symbol} Inc`,
  thesisUpdatedAt: daysAgo(30), daysSinceReview: 30, sectionCount: 3, coreSectionCount: 3,
  coreSections: ['thesis', 'where_different', 'risks_to_thesis'], evidenceCount: 3,
  newestEvidenceAt: daysAgo(2), newSinceReview: 1, ...over,
})

const fifty = () => Array.from({ length: 50 }, (_, i) => candidate(`N${String(i).padStart(2, '0')}`))
const tiles = () => screen.queryAllByTestId('research-tile')

beforeEach(() => {
  env.gaps = { status: 'ready', candidates: [], coveredCount: 0 }
  env.scan = []
  env.opened.length = 0
  env.assetOpened.length = 0
})

describe('a coverage gap is an ordinary Research subject', () => {
  it.each([
    ['new_evidence', 'evidence-since-review'],
    ['price_move', 'moved-since-review'],
    ['no_case', 'no-thesis'],
    ['incomplete_case', 'incomplete-thesis'],
    ['long_silence', 'stale'],
  ] as const)('%s becomes %s', (framing, state) => {
    expect(stateOf(subjectFromCoverage(candidate('X', framing)))).toBe(state)
  })

  it('leaves the scan’s own subjects on the scan’s rule', () => {
    // No thesis and no evidence on a scanned subject still reads as before.
    expect(stateOf(scanned('S', { thesisUpdatedAt: null, daysSinceReview: null, evidenceCount: 0, coreSections: [], coreSectionCount: 0, newSinceReview: 0 }))).toBe('thin')
  })
})

describe('a fresh account', () => {
  it('shows a few normal no-thesis tiles, not fifty, and no special layout', () => {
    env.gaps = { status: 'ready', candidates: fifty(), coveredCount: 50 }
    render(<ResearchWorkspace />)
    expect(tiles()).toHaveLength(GENERATED_PER_STRUCTURAL_GAP)
    for (const t of tiles()) expect(t).toHaveAttribute('data-state', 'no-thesis')
    // The ordinary gallery, with its ordinary heading and count.
    const gallery = screen.getByTestId('desktop-gallery')
    expect(within(gallery).getByRole('heading', { name: 'Research' })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/covered names need|View all|Start with these|Your coverage/)
    expect(document.querySelector('[data-testid^="coverage-gap"]')).toBeNull()
  })

  it('draws a generated no-thesis tile exactly like any no-thesis tile', () => {
    env.gaps = { status: 'ready', candidates: [candidate('AMZN', 'no_case', { exposure: { held: true, weightPct: 5.4, portfolioId: 'p', portfolioName: 'Tech', portfolioCount: 1 } })], coveredCount: 1 }
    render(<ResearchWorkspace />)
    const tile = tiles()[0]
    expect(tile).toHaveTextContent('No thesis on file')
    for (const part of ['Thesis', 'Where we differ', 'Risks to thesis']) expect(tile).toHaveTextContent(part)
    expect(tile).toHaveTextContent('5.4% held')
    expect(tile).toHaveTextContent('Nothing on file yet')
    expect(document.body.textContent).not.toContain('What best describes this position?')
  })

  it('waits for coverage work instead of announcing an empty lens', () => {
    env.gaps = { status: 'loading', candidates: [], coveredCount: 0 }
    render(<ResearchWorkspace />)
    expect(screen.queryByText(/No recorded evidence yet/)).not.toBeInTheDocument()
  })
})

describe('order, capacity and diversity', () => {
  it('keeps research on record first and never generates a name it already has', () => {
    env.scan = [scanned('GOOGL')]
    env.gaps = { status: 'ready', candidates: [candidate('GOOGL', 'new_evidence'), candidate('AAPL')], coveredCount: 2 }
    render(<ResearchWorkspace />)
    expect(tiles().map(t => within(t).getByText(/^[A-Z]+$/).textContent)).toEqual(['GOOGL', 'AAPL'])
  })

  it('generates nothing when research on record fills the field', () => {
    const real = Array.from({ length: RESEARCH_FEED_CAPACITY }, (_, i) => scanned(`R${i}`))
    expect(withCoverageSubjects(real, fifty())).toHaveLength(RESEARCH_FEED_CAPACITY)
    expect(withCoverageSubjects(real, fifty()).some(s => s.generated)).toBe(false)
  })

  it('lets events through and caps each structural gap', () => {
    const pool = [
      ...Array.from({ length: 10 }, (_, i) => candidate(`NC${i}`, 'no_case')),
      ...Array.from({ length: 3 }, (_, i) => candidate(`MV${i}`, 'price_move')),
      ...Array.from({ length: 6 }, (_, i) => candidate(`IN${i}`, 'incomplete_case')),
      ...Array.from({ length: 2 }, (_, i) => candidate(`ST${i}`, 'long_silence')),
    ]
    const states = withCoverageSubjects([], pool).map(stateOf)
    expect(states).toEqual([
      'moved-since-review', 'moved-since-review', 'moved-since-review',
      'no-thesis', 'no-thesis', 'no-thesis', 'no-thesis',
      'incomplete-thesis', 'incomplete-thesis', 'incomplete-thesis', 'incomplete-thesis',
      'stale',
    ])
  })

  it('breaks ties on an open idea, then on how much is held', () => {
    const out = withCoverageSubjects([], [
      candidate('BBB', 'no_case', { exposure: { held: true, weightPct: 5, portfolioId: 'p', portfolioName: 'X', portfolioCount: 1 } }),
      candidate('AAA'),
      candidate('CCC', 'no_case', { liveIdeas: [{ id: 'i', action: 'buy' }] }),
    ])
    expect(out.map(s => s.symbol)).toEqual(['CCC', 'BBB', 'AAA'])
  })
})

describe('generated tiles navigate like every Research tile', () => {
  it('expands into the deck with the rail, and the detail offers to write the case', () => {
    env.gaps = { status: 'ready', candidates: [candidate('AMZN'), candidate('TSLA', 'price_move')], coveredCount: 2 }
    const { unmount } = render(<ResearchWorkspace />)
    fireEvent.click(tiles()[0])
    const req = env.opened[env.opened.length - 1]
    expect(req.target).toMatchObject({ originLens: 'research', workspaceLens: 'research', objectId: 'a-tsla' })
    expect(req.rail.map(r => r.id)).toEqual(['a-tsla', 'a-amzn'])
    unmount()

    render(<ResearchWorkspace focusObjectId="a-amzn" />)
    const detail = screen.getByTestId('research-detail')
    fireEvent.click(within(detail).getByRole('button', { name: /Write the case/ }))
    expect(env.assetOpened[env.assetOpened.length - 1]).toMatchObject({ assetId: 'a-amzn', focus: 'research' })
  })

  it('draws the move and what an incomplete case is missing', () => {
    env.gaps = { status: 'ready', candidates: [candidate('TSLA', 'price_move'), candidate('NKE', 'incomplete_case')], coveredCount: 2 }
    render(<ResearchWorkspace />)
    const [moved, incomplete] = tiles()
    expect(moved).toHaveAttribute('data-state', 'moved-since-review')
    expect(moved).toHaveTextContent('+18.2')
    expect(incomplete).toHaveAttribute('data-state', 'incomplete-thesis')
    expect(incomplete).toHaveTextContent('Incomplete thesis')
    expect(incomplete).toHaveTextContent('written')
  })
})

describe('scope', () => {
  it('leaves Today and Ideas unwired, and the queue UI is gone', () => {
    for (const file of ['src/components/today/TodayPage.tsx', 'src/components/ideas-v2/IdeasWorkspace.tsx']) {
      expect(readFileSync(path.join(process.cwd(), file), 'utf8'), file).not.toMatch(/useCoverageResearchGaps|withCoverageSubjects/)
    }
    expect(existsSync(path.join(process.cwd(), 'src/components/research-v2/CoverageGapQueue.tsx'))).toBe(false)
    expect(existsSync(path.join(process.cwd(), 'src/lib/research/coverage-gap-queue.ts'))).toBe(false)
  })
})
