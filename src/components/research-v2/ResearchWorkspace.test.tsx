/**
 * Focused test for the Research workspace's composition and its persistence.
 *
 * The data hooks are mocked — they are thin reads and the domain layer has its
 * own suite. What this file is for is the surface's own decisions: what the
 * scan shows, that selecting keeps the list beside the case, that arriving
 * from elsewhere selects the right subject and carries its reason, and that
 * nothing claims a since-review number the data cannot support.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import type { ResearchSubject } from '../../lib/desktop-research'

const DAY = 86_400_000
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString()

const subject = (over: Partial<ResearchSubject> = {}): ResearchSubject => ({
  assetId: 'a-amzn', symbol: 'AMZN', companyName: 'Amazon.com',
  thesisUpdatedAt: daysAgo(30), daysSinceReview: 30,
  sectionCount: 3, coreSectionCount: 3,
  coreSections: ['thesis', 'where_different', 'risks_to_thesis'],
  evidenceCount: 4,
  newestEvidenceAt: daysAgo(40), newSinceReview: 0,
  ...over,
})

let scan: ResearchSubject[] = []
let exposure: Record<string, number> = {}
let detail: any = { sections: [], evidence: [] }
const detailFor: string[] = []

vi.mock('../../hooks/useDesktopResearch', () => ({
  useResearchScan: () => ({ subjects: scan, isLoading: false }),
  useResearchExposure: () => exposure,
  useResearchDetail: (s: ResearchSubject | null) => {
    if (s) detailFor.push(s.assetId)
    return { detail: s ? detail : undefined, isLoading: false }
  },
}))

/**
 * The Asset page's real editor, stubbed only so this suite can assert that
 * Research MOUNTS it rather than growing its own. If Research ever forks a
 * contribution form, this stub stops being rendered and the tests below fail.
 */
const thesisContainerFor: string[] = []
vi.mock('../contributions', () => ({
  ThesisContainer: ({ assetId }: { assetId: string }) => {
    thesisContainerFor.push(assetId)
    return <div data-testid="real-thesis-editor" data-asset={assetId} />
  },
}))

/**
 * What the lens asked the shell to open.
 *
 * The seam is real -- only the window dispatch is stubbed -- so a test that
 * passes here proves the descriptor the shell would actually receive.
 */
const opened: any[] = []
vi.mock('../../lib/desktop-asset', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/desktop-asset')>()
  return { ...actual, openAsset: (r: any) => { opened.push(r); return true } }
})

const openEngagement = vi.fn()
vi.mock('../../lib/engagement', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/engagement')>()
  return { ...actual, askAI: (t: any) => openEngagement('ai', t), discuss: (t: any) => openEngagement('discuss', t) }
})

import { ResearchWorkspace } from './ResearchWorkspace'
import { openResearch } from '../../lib/desktop-research'

beforeEach(() => {
  scan = []
  exposure = {}
  detail = { sections: [], evidence: [] }
  detailFor.length = 0
  thesisContainerFor.length = 0
  opened.length = 0
  openEngagement.mockClear()
})
afterEach(() => { vi.useRealTimers() })

describe('the scan', () => {
  it('leads with the subject whose evidence has moved past the case', () => {
    scan = [
      subject({ assetId: 'a-1', symbol: 'AAA', daysSinceReview: 400 }),
      subject({ assetId: 'a-2', symbol: 'BBB', newSinceReview: 2 }),
    ]
    render(<ResearchWorkspace />)
    const tiles = screen.getAllByTestId('research-tile')
    expect(tiles[0]).toHaveAttribute('data-state', 'evidence-since-review')
    expect(within(tiles[0]).getByText('BBB')).toBeInTheDocument()
  })

  it('leads an arrival tile with what arrived, never a bare age', () => {
    scan = [subject({ newSinceReview: 3 })]
    render(<ResearchWorkspace />)
    const tile = screen.getByTestId('research-tile')
    expect(tile).toHaveTextContent('3')
    expect(tile).toHaveTextContent('research items arrived')
    expect(tile).toHaveTextContent('after the case was written')
  })

  it('says the core thesis is missing without implying no research exists', async () => {
    const user = userEvent.setup()
    scan = [subject({
      thesisUpdatedAt: null, daysSinceReview: null,
      evidenceCount: 6, sectionCount: 2, coreSectionCount: 0, coreSections: [],
    })]
    render(<ResearchWorkspace />)
    expect(screen.getByText('Core thesis not written')).toBeInTheDocument()

    // The NVDA shape: peripheral sections and evidence are on record, and the
    // sentence must name them rather than reading as "we hold nothing".
    const tile = screen.getByTestId('research-tile')
    expect(tile).toHaveTextContent('6 research items')
    expect(tile).toHaveTextContent('2 supporting sections')

    // The focused workspace names the verb; the Asset page performs it.
    await user.click(tile)
    expect(screen.getAllByRole('button', { name: /Write the case/ }).length).toBeGreaterThan(0)
  })

  it('shows weight only where the name is actually held', () => {
    scan = [subject({ assetId: 'a-1', symbol: 'AAA' }), subject({ assetId: 'a-2', symbol: 'BBB' })]
    exposure = { 'a-1': 4.25 }
    render(<ResearchWorkspace />)
    expect(screen.getAllByText('4.3%')).not.toHaveLength(0)
    expect(screen.queryByText('0.0%')).not.toBeInTheDocument()
  })

  it('says nothing is on record rather than rendering an empty grid', () => {
    render(<ResearchWorkspace />)
    expect(screen.getByText(/No recorded evidence yet/)).toBeInTheDocument()
  })
})

describe('a tile opens a focused workspace, not the Research product', () => {
  const two = () => {
    scan = [
      subject({ assetId: 'a-1', symbol: 'AAA', newSinceReview: 3 }),
      subject({ assetId: 'a-2', symbol: 'BBB' }),
    ]
  }

  it('lands in the gallery with nothing open and nothing fetched', () => {
    two()
    render(<ResearchWorkspace />)
    expect(screen.getAllByTestId('research-tile')).toHaveLength(2)
    expect(screen.queryByTestId('research-detail')).not.toBeInTheDocument()
    expect(detailFor).toHaveLength(0)
  })

  it('opens the workspace for the subject clicked, and only that one', async () => {
    const user = userEvent.setup()
    two()
    render(<ResearchWorkspace />)
    await user.click(screen.getAllByTestId('research-tile')[0])

    expect(screen.getByTestId('research-detail')).toBeInTheDocument()
    expect(new Set(detailFor)).toEqual(new Set(['a-1']))
    // Opening is a state of this tab; the gallery is not shown alongside.
    expect(screen.queryAllByTestId('research-tile')).toHaveLength(0)
  })

  it('returns to the scan', async () => {
    const user = userEvent.setup()
    two()
    render(<ResearchWorkspace selectedAssetId="a-1" />)
    await user.click(screen.getByRole('button', { name: /All research/ }))
    expect(screen.getAllByTestId('research-tile')).toHaveLength(2)
  })

  it('does not reproduce the product it sits above', async () => {
    const user = userEvent.setup()
    two()
    render(<ResearchWorkspace />)
    await user.click(screen.getAllByTestId('research-tile')[0])
    // Writing the case is the Asset page's job. Mounting its editor here was
    // the Dashboard rebuilding the product underneath it.
    expect(screen.queryByTestId('real-thesis-editor')).not.toBeInTheDocument()
    expect(thesisContainerFor).toHaveLength(0)
  })

  it('hands off to the asset explicitly, carrying the reason', async () => {
    const user = userEvent.setup()
    scan = [subject({ assetId: 'a-1', symbol: 'AAA', newSinceReview: 3 })]
    render(<ResearchWorkspace selectedAssetId="a-1" issue="New evidence since review" origin="today" />)
    await user.click(screen.getByRole('button', { name: /Asset page/ }))

    const req = opened.at(-1)!
    expect(req.assetId).toBe('a-1')
    expect(req.focus).toBe('research')
    expect(req.origin).toBe('research')
    expect(req.issue).toBe('New evidence since review')
  })

  it('sends an authoring state to the asset rather than editing in place', async () => {
    const user = userEvent.setup()
    scan = [subject({
      assetId: 'a-1', symbol: 'AAA',
      thesisUpdatedAt: null, daysSinceReview: null,
      coreSectionCount: 0, coreSections: [], evidenceCount: 4,
    })]
    render(<ResearchWorkspace selectedAssetId="a-1" />)
    await user.click(screen.getAllByRole('button', { name: /Write the case/ })[0])
    expect(opened.at(-1)!.assetId).toBe('a-1')
    expect(screen.queryByTestId('real-thesis-editor')).not.toBeInTheDocument()
  })
})

describe('a typed arrival opens the right subject, or says it cannot', () => {
  it('opens the named subject and shows why the user was sent', () => {
    scan = [subject({ assetId: 'a-1', symbol: 'AAA' }), subject({ assetId: 'a-2', symbol: 'BBB' })]
    render(<ResearchWorkspace selectedAssetId="a-2" issue="New evidence since review" origin="today" />)
    expect(screen.getByTestId('research-detail')).toBeInTheDocument()
    expect(screen.getByText(/Opened from Dashboard/)).toBeInTheDocument()
    expect(detailFor).toContain('a-2')
  })

  it('accepts a live openResearch event', async () => {
    scan = [subject({ assetId: 'a-1', symbol: 'AAA' }), subject({ assetId: 'a-2', symbol: 'BBB' })]
    render(<ResearchWorkspace />)
    expect(screen.queryByTestId('research-detail')).not.toBeInTheDocument()

    await React.act(async () => { openResearch({ assetId: 'a-2' }) })
    expect(detailFor).toContain('a-2')
  })

  it('never substitutes another subject for one it has nothing on', () => {
    // Research lists names with a case or recorded evidence. Falling through
    // to the head of the ranking would open a different company under the
    // banner naming the one that was asked for.
    scan = [subject({ assetId: 'a-1', symbol: 'AAA' })]
    render(<ResearchWorkspace selectedAssetId="a-unknown" issue="Thesis not written" origin="today" />)
    expect(screen.getByText(/Nothing on record for that name yet/)).toBeInTheDocument()
    expect(detailFor).toHaveLength(0)
  })

  it('still offers the asset when the subject is not in this population', async () => {
    const user = userEvent.setup()
    scan = [subject({ assetId: 'a-1', symbol: 'AAA' })]
    render(<ResearchWorkspace selectedAssetId="a-unknown" />)
    await user.click(screen.getByRole('button', { name: /Open the asset anyway/ }))
    expect(opened.at(-1)!.assetId).toBe('a-unknown')
  })
})
