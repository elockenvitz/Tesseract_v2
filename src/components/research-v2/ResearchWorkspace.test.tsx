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
 * What the lens asked the deck to expand.
 *
 * The seam is real; only the window dispatch is stubbed, so a passing test
 * proves the request the Dashboard shell would actually receive.
 */
const opened: any[] = []
vi.mock('../../lib/dashboard/focus', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/dashboard/focus')>()
  return { ...actual, openDashboardFocus: (r: any) => { opened.push(r); return true } }
})

const deepOpened: any[] = []
vi.mock('../../lib/desktop-asset', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/desktop-asset')>()
  return { ...actual, openAsset: (r: any) => { deepOpened.push(r); return true } }
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
  deepOpened.length = 0
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
    expect(tile).toHaveTextContent('new notes since')
    expect(tile).toHaveTextContent('the thesis was written')
  })

  it('says the core thesis is missing without implying no research exists', async () => {
    const user = userEvent.setup()
    scan = [subject({
      thesisUpdatedAt: null, daysSinceReview: null,
      evidenceCount: 6, sectionCount: 2, coreSectionCount: 0, coreSections: [],
    })]
    render(<ResearchWorkspace />)
    expect(screen.getByText('No thesis on file')).toBeInTheDocument()

    const tile = screen.getByTestId('research-tile')
    // The missing structure is drawn: three named parts, each with a dash.
    for (const part of ['Thesis', 'Where we differ', 'Risks to thesis']) {
      expect(tile).toHaveTextContent(part)
    }
    // And what IS on file is named, so the card never reads as "we hold
    // nothing on this name".
    expect(tile).toHaveTextContent('6 research on file')

    // The tile is a choice; the verb belongs to the expanded workspace.
    await user.click(tile)
    expect(opened.at(-1)!.target.objectId).toBe('a-amzn')
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

describe('a tile expands into the deck, in place', () => {
  const two = () => {
    scan = [
      subject({ assetId: 'a-1', symbol: 'AAA', newSinceReview: 3 }),
      subject({ assetId: 'a-2', symbol: 'BBB' }),
    ]
  }

  it('draws the field and opens nothing', () => {
    two()
    render(<ResearchWorkspace />)
    expect(screen.getAllByTestId('research-tile')).toHaveLength(2)
    expect(screen.queryByTestId('research-detail')).not.toBeInTheDocument()
    expect(detailFor).toHaveLength(0)
    expect(opened).toHaveLength(0)
  })

  it('asks the deck to expand the exact card, with Research as the origin', async () => {
    const user = userEvent.setup()
    two()
    render(<ResearchWorkspace />)
    await user.click(screen.getAllByTestId('research-tile')[0])

    const req = opened.at(-1)!
    expect(req.target.objectId).toBe('a-1')
    expect(req.target.originLens).toBe('research')
    expect(req.target.workspaceLens).toBe('research')
    expect(req.backLabel).toBe('Research')
    expect(req.target.issue).toBeTruthy()
  })

  it('hands the surrounding work over with the request', () => {
    // Built from the population already loaded. The deck runs no query of its
    // own to draw a rail.
    scan = [
      subject({ assetId: 'a-1', symbol: 'AAA', newSinceReview: 3 }),
      subject({ assetId: 'a-2', symbol: 'BBB' }),
      subject({ assetId: 'a-3', symbol: 'CCC' }),
    ]
    render(<ResearchWorkspace />)
    screen.getAllByTestId('research-tile')[0].click()

    const rail = opened.at(-1)!.rail
    expect(rail.length).toBeGreaterThan(0)
    expect(rail.every((c: any) => c.workspaceLens === 'research')).toBe(true)
    // A card, not a list row: a reason, a figure and a line of substance.
    expect(rail[0].reason).toBeTruthy()
    expect(rail[0].detail).toBeTruthy()
  })

  it('renders only the workspace when the deck expands it', () => {
    two()
    render(<ResearchWorkspace focusObjectId="a-1" />)
    expect(screen.getByTestId('research-detail')).toBeInTheDocument()
    // The field is the deck's business, and the deck keeps it alive itself.
    expect(screen.queryAllByTestId('research-tile')).toHaveLength(0)
    expect(new Set(detailFor)).toEqual(new Set(['a-1']))
  })

  it('does not reproduce the product it sits above', () => {
    two()
    render(<ResearchWorkspace focusObjectId="a-1" />)
    expect(screen.queryByTestId('real-thesis-editor')).not.toBeInTheDocument()
    expect(thesisContainerFor).toHaveLength(0)
  })

  it('hands off to the asset explicitly, carrying the reason', async () => {
    const user = userEvent.setup()
    scan = [subject({ assetId: 'a-1', symbol: 'AAA', newSinceReview: 3 })]
    render(<ResearchWorkspace focusObjectId="a-1" selectedAssetId="a-1" issue="New research" origin="today" />)
    await user.click(screen.getByRole('button', { name: /Open full asset/ }))

    const req = deepOpened.at(-1)!
    expect(req.assetId).toBe('a-1')
    expect(req.focus).toBe('research')
    expect(req.issue).toBe('New research')
  })
})

describe('a typed arrival expands the right card, or says it cannot', () => {
  it('shows why the user was sent', () => {
    scan = [subject({ assetId: 'a-1', symbol: 'AAA' }), subject({ assetId: 'a-2', symbol: 'BBB' })]
    render(<ResearchWorkspace focusObjectId="a-2" selectedAssetId="a-2" issue="New research" origin="today" />)
    expect(screen.getByTestId('research-detail')).toBeInTheDocument()
    expect(screen.getByText(/Opened from Dashboard/)).toBeInTheDocument()
  })

  it('asks the deck to expand what a live openResearch event names', async () => {
    scan = [subject({ assetId: 'a-1', symbol: 'AAA' }), subject({ assetId: 'a-2', symbol: 'BBB' })]
    render(<ResearchWorkspace />)
    opened.length = 0

    await React.act(async () => { openResearch({ assetId: 'a-2' }) })
    expect(opened.at(-1)!.target.objectId).toBe('a-2')
  })

  it('never substitutes another subject for one it has nothing on', () => {
    // Falling through to the head of the ranking would open a different
    // company under the banner naming the one that was asked for.
    scan = [subject({ assetId: 'a-1', symbol: 'AAA' })]
    render(<ResearchWorkspace focusObjectId="a-unknown" issue="Thesis not written" origin="today" />)
    expect(screen.getByText(/Nothing on record for that name yet/)).toBeInTheDocument()
    expect(detailFor).toHaveLength(0)
  })

  it('still offers the asset when the subject is not in this population', async () => {
    const user = userEvent.setup()
    scan = [subject({ assetId: 'a-1', symbol: 'AAA' })]
    render(<ResearchWorkspace focusObjectId="a-unknown" />)
    await user.click(screen.getByRole('button', { name: /Open the asset anyway/ }))
    expect(deepOpened.at(-1)!.assetId).toBe('a-unknown')
  })
})
