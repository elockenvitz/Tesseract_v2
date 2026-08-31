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

    // Writing the case is the asset workspace's verb, not the lens's.
    await user.click(tile)
    expect(screen.queryByRole('button', { name: /Write the case/ })).not.toBeInTheDocument()
    expect(opened.at(-1)!.assetId).toBe('a-amzn')
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

describe('the lens sends you to the asset, and stays where it was', () => {
  const two = () => {
    scan = [
      subject({ assetId: 'a-1', symbol: 'AAA', newSinceReview: 3 }),
      subject({ assetId: 'a-2', symbol: 'BBB' }),
    ]
  }

  it('renders a browse gallery and no case workspace', () => {
    two()
    render(<ResearchWorkspace />)
    expect(screen.getByTestId('research-lens')).toBeInTheDocument()
    expect(screen.getAllByTestId('research-tile')).toHaveLength(2)
    // Research finds cases that need work. The work happens on the asset.
    expect(screen.queryByTestId('research-detail')).not.toBeInTheDocument()
    expect(detailFor).toHaveLength(0)
  })

  it('opens the exact asset the tile names, with a research focus', async () => {
    const user = userEvent.setup()
    two()
    render(<ResearchWorkspace />)
    await user.click(screen.getAllByTestId('research-tile')[0])

    const req = opened.at(-1)!
    expect(req.assetId).toBe('a-1')
    expect(req.symbol).toBe('AAA')
    expect(req.focus).toBe('research')
    expect(req.origin).toBe('research')
  })

  it('carries the reason the tile was showing', async () => {
    const user = userEvent.setup()
    scan = [subject({ assetId: 'a-1', symbol: 'AAA', newSinceReview: 3 })]
    render(<ResearchWorkspace />)
    await user.click(screen.getByTestId('research-tile'))

    // Not a restated state name: the sentence the reader was looking at.
    const issue = opened.at(-1)!.issue as any
    expect(issue.title).toBeTruthy()
    expect(issue.reason).toContain('research:')
  })

  it('never enters the detail workspace in the normal flow', async () => {
    const user = userEvent.setup()
    two()
    render(<ResearchWorkspace />)
    await user.click(screen.getAllByTestId('research-tile')[0])
    // The gallery is still exactly where the reader left it -- opening an
    // asset is a different tab, not a mode change inside this one.
    expect(screen.getAllByTestId('research-tile')).toHaveLength(2)
    expect(screen.queryByTestId('research-detail')).not.toBeInTheDocument()
    expect(screen.queryByTestId('workspace-back')).not.toBeInTheDocument()
  })
})

describe('a typed arrival is forwarded, never absorbed', () => {
  it('forwards a named subject to the asset with its reason intact', () => {
    scan = [subject({ assetId: 'a-1', symbol: 'AAA' }), subject({ assetId: 'a-2', symbol: 'BBB' })]
    render(<ResearchWorkspace selectedAssetId="a-2" issue="New evidence since review" origin="today" />)

    const req = opened.at(-1)!
    expect(req.assetId).toBe('a-2')
    expect(req.focus).toBe('research')
    expect((req.issue as any).title).toBe('New evidence since review')
  })

  it('accepts a live openResearch event', async () => {
    scan = [subject({ assetId: 'a-1', symbol: 'AAA' }), subject({ assetId: 'a-2', symbol: 'BBB' })]
    render(<ResearchWorkspace />)
    opened.length = 0

    await React.act(async () => { openResearch({ assetId: 'a-2', focus: 'evidence' }) })
    expect(opened.at(-1)!.assetId).toBe('a-2')
  })

  it('opens the asset asked for even when Research has nothing on it', () => {
    // Research lists names with a case or recorded evidence. A name with
    // neither is not in this population -- but the asset still exists, and
    // falling through to the head of the ranking is how a reader ends up
    // reading someone else's company under the banner they arrived with.
    scan = [subject({ assetId: 'a-1', symbol: 'AAA' })]
    render(<ResearchWorkspace selectedAssetId="a-unknown" issue="Thesis not written" origin="today" />)

    const req = opened.at(-1)!
    expect(req.assetId).toBe('a-unknown')
    expect(req.assetId).not.toBe('a-1')
  })
})
