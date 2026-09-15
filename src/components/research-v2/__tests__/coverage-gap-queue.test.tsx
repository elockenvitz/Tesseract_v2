/**
 * Research's coverage-gap queue.
 *
 * A fresh account (Bogey Cap, 2026-09-15) covers fifty names with nothing
 * written, so the shared source returns fifty "no thesis" candidates. Research
 * must state that once and show where to start -- not mount fifty cards -- and
 * real research on record must still lead.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { CoverageResearchCandidate } from '../../../lib/research/coverage-research-gaps'
import type { ResearchFraming } from '../../../lib/research/case-state'

const gapsRef = vi.hoisted(() => ({
  value: { status: 'ready', candidates: [] as unknown[], coveredCount: 0 } as { status: string; candidates: unknown[]; coveredCount: number },
}))
const scanRef = vi.hoisted(() => ({ subjects: [] as unknown[] }))
const opened = vi.hoisted(() => [] as unknown[])

vi.mock('../../../hooks/useCoverageResearchGaps', () => ({ useCoverageResearchGaps: () => gapsRef.value }))
vi.mock('../../../hooks/useDesktopResearch', () => ({
  useResearchScan: () => ({ subjects: scanRef.subjects, isLoading: false }),
  useResearchExposure: () => ({}),
  useResearchDetail: () => ({ detail: undefined, isLoading: false }),
}))
vi.mock('../../../lib/desktop-asset', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../lib/desktop-asset')>()
  return { ...actual, openAsset: (r: unknown) => { opened.push(r); return true } }
})
vi.mock('../../../lib/dashboard/focus', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../lib/dashboard/focus')>()
  return { ...actual, openDashboardFocus: () => true }
})

import { CoverageGapQueue } from '../CoverageGapQueue'
import { ResearchWorkspace } from '../ResearchWorkspace'
import { buildGapQueue, gapDetail, gapSummary, GAP_ACTION } from '../../../lib/research/coverage-gap-queue'

const PRIORITY: Record<ResearchFraming, number> = { new_evidence: 1, price_move: 2, no_case: 3, incomplete_case: 4, long_silence: 5 }

function candidate(symbol: string, framing: ResearchFraming = 'no_case', over: Partial<CoverageResearchCandidate> = {}): CoverageResearchCandidate {
  const assetId = `a-${symbol.toLowerCase()}`
  return {
    id: `coverage-research:${assetId}`, assetId, symbol, companyName: `${symbol} Inc`,
    coverage: 'own', framing, priority: PRIORITY[framing], score: 0.55,
    headline: `${symbol} has no investment thesis`, body: 'x', prompt: 'What best describes this position?',
    facts: {
      missingSections: framing === 'incomplete_case' ? ['where_different', 'risks_to_thesis'] : ['thesis', 'where_different', 'risks_to_thesis'],
      presentSections: [], movePct: framing === 'price_move' ? -18.2 : null,
      evidenceSince: framing === 'new_evidence' ? [{ id: 'n', at: '2026-09-10', authorId: null, title: null, kind: 'note' }] as never : [],
      evidenceCount: 0, daysSinceReview: framing === 'long_silence' ? 120 : null, daysSinceWritten: null,
      anchoredOn: framing === 'no_case' ? null : 'written', caseWrittenAt: null, reviewAnchor: null,
    },
    exposure: { held: true, weightPct: 2, portfolioId: 'p1', portfolioName: 'Tech & Consumer Growth', portfolioCount: 1 },
    liveIdeas: [],
    open: { assetId, symbol, companyName: `${symbol} Inc`, focus: 'research', origin: 'coverage-research', issue: 'x' },
    insight: {} as never,
    ...over,
  }
}

const fifty = () => Array.from({ length: 50 }, (_, i) =>
  candidate(`N${String(i).padStart(2, '0')}`, 'no_case', { score: 0.55 + (50 - i) / 1000 }))

beforeEach(() => {
  opened.length = 0
  scanRef.subjects = []
  gapsRef.value = { status: 'ready', candidates: [], coveredCount: 0 }
})

describe('the queue model', () => {
  it('states fifty identical gaps once, and queues the top eight', () => {
    const q = buildGapQueue(fifty())
    expect(q.summary).toBe('50 covered names need a thesis')
    expect(q.groups).toHaveLength(1)
    expect(q.groups[0]).toMatchObject({ label: 'No thesis', total: 50 })
    expect(q.groups[0].rows).toHaveLength(8)
    expect(q.hidden).toBe(42)
  })

  it('groups a mix in the canonical order, with counts', () => {
    const q = buildGapQueue([
      candidate('STL', 'long_silence'), candidate('INC', 'incomplete_case'), candidate('NOC', 'no_case'),
      candidate('MOV', 'price_move'), candidate('EVI', 'new_evidence'),
    ])
    expect(q.summary).toBe('5 covered names need research')
    expect(q.counts.map(c => c.label)).toEqual(['New evidence', 'Price moved since review', 'No thesis', 'Incomplete thesis', 'Stale'])
    expect(q.groups.map(g => g.rows[0].symbol)).toEqual(['EVI', 'MOV', 'NOC', 'INC', 'STL'])
  })

  it('breaks ties on an open idea, then on how much is held, then the ticker', () => {
    const q = buildGapQueue([
      candidate('BBB', 'no_case', { exposure: { held: true, weightPct: 5, portfolioId: 'p', portfolioName: 'X', portfolioCount: 1 } }),
      candidate('AAA'),
      candidate('CCC', 'no_case', { liveIdeas: [{ id: 'i', action: 'buy' }] }),
    ])
    expect(q.groups[0].rows.map(r => r.symbol)).toEqual(['CCC', 'BBB', 'AAA'])
  })

  it('writes the gap for Research, never with the phone prompt', () => {
    expect(gapDetail(candidate('A', 'new_evidence'))).toBe('1 new item since the thesis was written')
    expect(gapDetail(candidate('A', 'price_move'))).toBe('Down 18.2% since the thesis was written')
    expect(gapDetail(candidate('A', 'no_case'))).toBe('Nothing written yet')
    expect(gapDetail(candidate('A', 'incomplete_case'))).toBe('Missing where we differ, risks to thesis')
    expect(gapDetail(candidate('A', 'long_silence'))).toBe('Not reviewed in 120 days')
    expect(gapSummary([candidate('A', 'long_silence')])).toBe('1 covered name has not been reviewed in 90+ days')
    expect(Object.values(GAP_ACTION)).toEqual(['Review evidence', 'Revisit thesis', 'Write thesis', 'Finish thesis', 'Review thesis'])
  })
})

describe('the queue on screen', () => {
  it('mounts eight rows for fifty candidates, and the rest only when asked', () => {
    render(<CoverageGapQueue candidates={fifty()} />)
    expect(screen.getByTestId('coverage-gap-summary')).toHaveTextContent('50 covered names need a thesis')
    expect(screen.getAllByTestId('coverage-gap-row')).toHaveLength(8)
    fireEvent.click(screen.getByTestId('coverage-gap-view-all'))
    expect(screen.getAllByTestId('coverage-gap-row')).toHaveLength(50)
    fireEvent.click(screen.getByRole('button', { name: 'Show top 8' }))
    expect(screen.getAllByTestId('coverage-gap-row')).toHaveLength(8)
  })

  it('labels groups only when there is more than one kind of gap', () => {
    const { unmount } = render(<CoverageGapQueue candidates={fifty()} />)
    expect(screen.getByTestId('coverage-gap-group')).not.toHaveTextContent('No thesis')
    unmount()
    render(<CoverageGapQueue candidates={[candidate('EVI', 'new_evidence'), candidate('NOC')]} />)
    expect(screen.getAllByTestId('coverage-gap-group').map(g => g.firstElementChild?.textContent)).toEqual(['New evidence1', 'No thesis1'])
    expect(screen.getByTestId('coverage-gap-counts')).toHaveTextContent('1 new evidence · 1 no thesis')
  })

  it('shows symbol, company, the gap and its context, with one action into the asset’s Research view', () => {
    const amzn = candidate('AMZN', 'no_case', {
      companyName: 'Amazon.com, Inc.',
      exposure: { held: true, weightPct: 5.384, portfolioId: 'p1', portfolioName: 'Tech & Consumer Growth', portfolioCount: 1 },
      liveIdeas: [{ id: 'i1', action: 'add' }],
    })
    render(<CoverageGapQueue candidates={[amzn]} />)
    const row = screen.getByTestId('coverage-gap-row')
    expect(row).toHaveTextContent('AMZN')
    expect(row).toHaveTextContent('Amazon.com, Inc.')
    expect(row).toHaveTextContent('Nothing written yet')
    expect(row).toHaveTextContent('5.4% of Tech & Consumer Growth · 1 open idea')
    const actions = within(row).getAllByRole('button')
    expect(actions).toHaveLength(1)
    fireEvent.click(actions[0])
    expect(opened).toEqual([expect.objectContaining({ assetId: 'a-amzn', focus: 'research' })])
    expect(document.body.textContent).not.toContain('What best describes this position?')
  })
})

describe('in the Research lens', () => {
  const subject = (assetId: string, symbol: string) => ({
    assetId, symbol, companyName: `${symbol} Inc`, coreSections: ['thesis', 'where_different', 'risks_to_thesis'],
    sectionCount: 3, evidenceCount: 2, newSinceReview: 1, newestEvidenceAt: '2026-09-10T00:00:00Z', newestEvidenceTitle: 'Q3 read',
    thesisUpdatedAt: '2026-06-01T00:00:00Z', daysSinceReview: 100,
  })

  it('is the lens on a fresh account, as a summary and eight rows', () => {
    gapsRef.value = { status: 'ready', candidates: fifty(), coveredCount: 50 }
    render(<ResearchWorkspace />)
    expect(screen.getByTestId('coverage-gap-summary')).toHaveTextContent('50 covered names need a thesis')
    expect(screen.getAllByTestId('coverage-gap-row')).toHaveLength(8)
    expect(screen.queryAllByTestId('research-tile')).toHaveLength(0)
    expect(screen.queryByText('No recorded evidence yet')).not.toBeInTheDocument()
  })

  it('keeps research on record first, and does not repeat its names in the queue', () => {
    scanRef.subjects = [subject('a-googl', 'GOOGL')]
    gapsRef.value = { status: 'ready', candidates: [candidate('GOOGL', 'new_evidence'), candidate('AAPL')], coveredCount: 2 }
    render(<ResearchWorkspace />)
    const tile = screen.getByTestId('research-tile')
    const queue = screen.getByTestId('coverage-gap-queue')
    expect(tile.compareDocumentPosition(queue) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(queue).getAllByTestId('coverage-gap-row').map(r => r.getAttribute('data-asset'))).toEqual(['a-aapl'])
  })

  it('waits for the gaps rather than claiming nothing is on record', () => {
    gapsRef.value = { status: 'loading', candidates: [], coveredCount: 0 }
    render(<ResearchWorkspace />)
    expect(screen.queryByText('No recorded evidence yet')).not.toBeInTheDocument()
  })

  it('says the coverage could not be loaded when the source failed', () => {
    gapsRef.value = { status: 'error', candidates: [], coveredCount: 0 }
    render(<ResearchWorkspace />)
    expect(screen.getByTestId('coverage-gap-error')).toHaveTextContent('Your coverage could not be loaded')
  })

  it('says covered names have no gaps when that is true', () => {
    gapsRef.value = { status: 'ready', candidates: [], coveredCount: 12 }
    render(<ResearchWorkspace />)
    expect(screen.getByText('Your 12 covered names have no open research gaps.')).toBeInTheDocument()
  })
})

describe('scope', () => {
  it('leaves Today and Ideas unwired', () => {
    for (const file of ['src/components/today/TodayPage.tsx', 'src/components/ideas-v2/IdeasWorkspace.tsx']) {
      expect(readFileSync(path.join(process.cwd(), file), 'utf8'), file).not.toMatch(/useCoverageResearchGaps|CoverageGapQueue/)
    }
  })
})
