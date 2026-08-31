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
  sectionCount: 3, coreSectionCount: 3, evidenceCount: 4,
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
    const tiles = screen.getAllByTestId('research-scan-tile')
    expect(tiles[0]).toHaveAttribute('data-state', 'evidence-since-review')
    expect(within(tiles[0]).getByText('BBB')).toBeInTheDocument()
  })

  it('gives every tile a reason, never a bare age', () => {
    scan = [subject({ newSinceReview: 3 })]
    render(<ResearchWorkspace />)
    expect(screen.getByText(/3 research items arrived after the case was last written/))
      .toBeInTheDocument()
  })

  it('says the core thesis is missing without implying no research exists', () => {
    scan = [subject({
      thesisUpdatedAt: null, daysSinceReview: null,
      evidenceCount: 6, sectionCount: 2, coreSectionCount: 0,
    })]
    render(<ResearchWorkspace />)
    expect(screen.getByText('Core thesis not written')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Write the case/ })).toBeInTheDocument()

    // The NVDA shape: peripheral sections and evidence are on record, and the
    // sentence must name them rather than reading as "we hold nothing".
    const why = screen.getByText(/core thesis has not been written/)
    expect(why).toHaveTextContent('6 research items')
    expect(why).toHaveTextContent('2 supporting sections')
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

describe('selecting keeps the list', () => {
  it('replaces the grid with a navigator beside the case, not with the case alone', async () => {
    const user = userEvent.setup()
    scan = [
      subject({ assetId: 'a-1', symbol: 'AAA', newSinceReview: 1 }),
      subject({ assetId: 'a-2', symbol: 'BBB' }),
    ]
    render(<ResearchWorkspace />)
    await user.click(screen.getAllByRole('button', { name: /Review new evidence/ })[0])

    expect(screen.getByTestId('research-detail')).toBeInTheDocument()
    // Both subjects remain reachable without going back.
    expect(screen.getAllByTestId('research-nav-tile')).toHaveLength(2)
  })

  it('only loads the deep read for the one selected subject', async () => {
    const user = userEvent.setup()
    scan = [subject({ assetId: 'a-1', symbol: 'AAA' }), subject({ assetId: 'a-2', symbol: 'BBB' })]
    render(<ResearchWorkspace />)
    expect(detailFor).toHaveLength(0)

    await user.click(screen.getAllByTestId('research-scan-tile')[0]
      .querySelector('button')!)
    expect(new Set(detailFor)).toEqual(new Set(['a-1']))
  })

  it('can return to the full scan', async () => {
    const user = userEvent.setup()
    scan = [subject({ assetId: 'a-1', symbol: 'AAA' })]
    render(<ResearchWorkspace />)
    await user.click(screen.getAllByRole('button', { name: /Read the case/ })[0])
    await user.click(screen.getByRole('button', { name: 'Full scan' }))
    expect(screen.queryByTestId('research-detail')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('research-scan-tile')).toHaveLength(1)
  })
})

describe('arriving from another surface', () => {
  it('selects the named subject and shows why the user was sent', () => {
    scan = [subject({ assetId: 'a-1', symbol: 'AAA' }), subject({ assetId: 'a-2', symbol: 'BBB', newSinceReview: 1 })]
    render(<ResearchWorkspace selectedAssetId="a-2" issue="New evidence since review" />)
    expect(screen.getByTestId('research-detail')).toBeInTheDocument()
    expect(screen.getByText(/Opened from Today/)).toBeInTheDocument()
    expect(detailFor).toContain('a-2')
  })

  it('accepts a live openResearch event', async () => {
    scan = [subject({ assetId: 'a-1', symbol: 'AAA' }), subject({ assetId: 'a-2', symbol: 'BBB' })]
    render(<ResearchWorkspace />)
    expect(screen.queryByTestId('research-detail')).not.toBeInTheDocument()

    await React.act(async () => { openResearch({ assetId: 'a-2', focus: 'evidence' }) })
    expect(screen.getByTestId('research-detail')).toBeInTheDocument()
    expect(detailFor).toContain('a-2')
  })

  it('drops the arrival reason once the user picks a different subject', async () => {
    const user = userEvent.setup()
    scan = [subject({ assetId: 'a-1', symbol: 'AAA' }), subject({ assetId: 'a-2', symbol: 'BBB' })]
    render(<ResearchWorkspace selectedAssetId="a-2" issue="New evidence since review" />)
    expect(screen.getByText(/Opened from Today/)).toBeInTheDocument()

    await user.click(screen.getAllByTestId('research-nav-tile')[0])
    // Someone else's reason does not describe the subject you chose yourself.
    expect(screen.queryByText(/Opened from Today/)).not.toBeInTheDocument()
  })
})

describe('the case, and what arrived after it', () => {
  it('separates evidence that post-dates the case from the rest', () => {
    scan = [subject({ assetId: 'a-1', symbol: 'AAA', newSinceReview: 1 })]
    detail = {
      sections: [{ section: 'thesis', content: 'AWS reacceleration is under-modelled.', supportingDetail: null, updatedAt: daysAgo(30), authorName: 'John Park' }],
      evidence: [
        { id: 'n1', title: 'Q3 print', content: 'Beat', createdAt: daysAgo(2), authorName: null, isShared: true, isNewSinceReview: true },
        { id: 'n2', title: 'Channel checks', content: 'Flat', createdAt: daysAgo(200), authorName: null, isShared: true, isNewSinceReview: false },
      ],
    }
    render(<ResearchWorkspace selectedAssetId="a-1" />)

    const fresh = screen.getByText('New since review').closest('section')!
    expect(within(fresh).getByText('Q3 print')).toBeInTheDocument()
    expect(within(fresh).queryByText('Channel checks')).not.toBeInTheDocument()
    expect(within(fresh).getByText(/is not recorded/)).toBeInTheDocument()
  })

  it('says the case is unwritten rather than rendering a blank module', () => {
    scan = [subject({ assetId: 'a-1', symbol: 'AAA', thesisUpdatedAt: null, daysSinceReview: null, evidenceCount: 2 })]
    render(<ResearchWorkspace selectedAssetId="a-1" />)
    expect(screen.getByText(/No core thesis has been written for AAA/)).toBeInTheDocument()
  })

  it('renders no price module at all when history cannot support one', () => {
    scan = [subject({ assetId: 'a-1', symbol: 'AAA' })]
    detail = { sections: [], evidence: [], history: undefined }
    render(<ResearchWorkspace selectedAssetId="a-1" />)
    expect(screen.queryByText(/Price since last review/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Price over available history/)).not.toBeInTheDocument()
  })

  it('will not claim a since-review move from history that starts after the review', () => {
    scan = [subject({ assetId: 'a-1', symbol: 'AAA', thesisUpdatedAt: daysAgo(300), daysSinceReview: 300 })]
    detail = {
      sections: [], evidence: [],
      history: Array.from({ length: 60 }, (_, i) => ({
        date: new Date(Date.now() - (60 - i) * DAY).toISOString().slice(0, 10),
        close: 100 + i,
      })),
    }
    render(<ResearchWorkspace selectedAssetId="a-1" />)
    expect(screen.getByText('Price over available history')).toBeInTheDocument()
    expect(screen.queryByText('Price since last review')).not.toBeInTheDocument()
    expect(screen.getByText(/does not reach the review date/)).toBeInTheDocument()
  })

  it('does claim it when the series actually reaches the anchor', () => {
    scan = [subject({ assetId: 'a-1', symbol: 'AAA' })]
    detail = {
      sections: [], evidence: [],
      history: Array.from({ length: 120 }, (_, i) => ({
        date: new Date(Date.now() - (120 - i) * DAY).toISOString().slice(0, 10),
        close: 100 + i,
      })),
    }
    render(<ResearchWorkspace selectedAssetId="a-1" />)
    expect(screen.getByText('Price since last review')).toBeInTheDocument()
    expect(screen.getByText('LAST REVIEW')).toBeInTheDocument()
  })
})

describe('engagement goes through the shared seam', () => {
  it('asks AI about the object with its issue bound', async () => {
    const user = userEvent.setup()
    scan = [subject({ assetId: 'a-1', symbol: 'AAA', newSinceReview: 2 })]
    render(<ResearchWorkspace />)
    await user.click(screen.getAllByRole('button', { name: /Ask AI/ })[0])

    expect(openEngagement).toHaveBeenCalledTimes(1)
    const [view, target] = openEngagement.mock.calls[0]
    expect(view).toBe('ai')
    expect(target.objectType).toBe('asset')
    expect(target.objectId).toBe('a-1')
    expect(target.issue.reason).toBe('research:evidence-since-review')
  })

  it('offers Team on the case, where a thread can actually attach', async () => {
    const user = userEvent.setup()
    scan = [subject({ assetId: 'a-1', symbol: 'AAA' })]
    render(<ResearchWorkspace selectedAssetId="a-1" />)
    await user.click(screen.getByRole('button', { name: 'Team' }))
    expect(openEngagement.mock.calls.at(-1)![0]).toBe('discuss')
  })
})

describe('the action loop completes in place', () => {
  const noCase = () => subject({
    assetId: 'a-1', symbol: 'AAA',
    thesisUpdatedAt: null, daysSinceReview: null,
    sectionCount: 1, coreSectionCount: 0, evidenceCount: 2,
  })
  const staleCase = () => subject({ assetId: 'a-1', symbol: 'AAA', daysSinceReview: 300 })

  it('Write the case opens the real editor, bound to this asset', async () => {
    const user = userEvent.setup()
    scan = [noCase()]
    render(<ResearchWorkspace selectedAssetId="a-1" />)
    expect(screen.queryByTestId('real-thesis-editor')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Write the case/ }))
    expect(screen.getByTestId('real-thesis-editor')).toHaveAttribute('data-asset', 'a-1')
  })

  it('Review thesis opens the same editor on an existing case', async () => {
    const user = userEvent.setup()
    scan = [staleCase()]
    detail = {
      sections: [{ section: 'thesis', content: 'Still bullish.', supportingDetail: null, updatedAt: daysAgo(300), authorName: 'Dan' }],
      evidence: [],
    }
    render(<ResearchWorkspace selectedAssetId="a-1" />)
    await user.click(screen.getByRole('button', { name: /Review thesis/ }))
    expect(screen.getByTestId('real-thesis-editor')).toBeInTheDocument()
  })

  it('mounts exactly one editor, and never its own', async () => {
    const user = userEvent.setup()
    scan = [noCase()]
    render(<ResearchWorkspace selectedAssetId="a-1" />)
    await user.click(screen.getByRole('button', { name: /Write the case/ }))

    expect(screen.getAllByTestId('real-thesis-editor')).toHaveLength(1)
    expect(thesisContainerFor).toEqual(['a-1'])
    // No hand-rolled form snuck in beside it.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('states the review-date limitation instead of faking a review event', async () => {
    const user = userEvent.setup()
    scan = [staleCase()]
    render(<ResearchWorkspace selectedAssetId="a-1" />)
    await user.click(screen.getByRole('button', { name: /Review thesis/ }))

    expect(screen.getByText(/only thing that moves the review date/)).toBeInTheDocument()
    // There is no reviewed_at column, so there must be no button claiming one.
    expect(screen.queryByRole('button', { name: /mark.*reviewed|confirm review/i }))
      .not.toBeInTheDocument()
  })

  it('closes the editor when a different subject is selected', async () => {
    const user = userEvent.setup()
    scan = [noCase(), subject({ assetId: 'a-2', symbol: 'BBB' })]
    render(<ResearchWorkspace selectedAssetId="a-1" />)
    await user.click(screen.getByRole('button', { name: /Write the case/ }))
    expect(screen.getByTestId('real-thesis-editor')).toBeInTheDocument()

    await user.click(screen.getAllByTestId('research-nav-tile')[1])
    expect(screen.queryByTestId('real-thesis-editor')).not.toBeInTheDocument()
  })

  it('opens editing straight away when Today sends focus:thesis', () => {
    scan = [staleCase()]
    render(<ResearchWorkspace selectedAssetId="a-1" focus="thesis" issue="Thesis not reviewed" />)
    // The sender asked for the case to be worked on; making the user click
    // again would waste the hand-off.
    expect(screen.getByTestId('real-thesis-editor')).toBeInTheDocument()
    expect(screen.getByText(/Opened from Today/)).toBeInTheDocument()
  })

  it('does not open an editor for states that are not authoring', async () => {
    const user = userEvent.setup()
    scan = [subject({ assetId: 'a-1', symbol: 'AAA', newSinceReview: 2 })]
    detail = {
      sections: [{ section: 'thesis', content: 'Bullish.', supportingDetail: null, updatedAt: daysAgo(30), authorName: 'Dan' }],
      evidence: [{ id: 'n1', title: 'Q3', content: 'Beat', createdAt: daysAgo(2), authorName: null, isShared: true, isNewSinceReview: true }],
    }
    render(<ResearchWorkspace selectedAssetId="a-1" />)
    await user.click(screen.getByRole('button', { name: /Review new evidence/ }))
    expect(screen.queryByTestId('real-thesis-editor')).not.toBeInTheDocument()
  })

  it('still lets a current case be edited on demand', async () => {
    const user = userEvent.setup()
    scan = [subject({ assetId: 'a-1', symbol: 'AAA' })]
    detail = {
      sections: [{ section: 'thesis', content: 'Bullish.', supportingDetail: null, updatedAt: daysAgo(30), authorName: 'Dan' }],
      evidence: [],
    }
    render(<ResearchWorkspace selectedAssetId="a-1" />)
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByTestId('real-thesis-editor')).toBeInTheDocument()
  })

  it('keeps Ask AI and Team bound to the selected asset while editing', async () => {
    const user = userEvent.setup()
    scan = [noCase()]
    render(<ResearchWorkspace selectedAssetId="a-1" />)
    await user.click(screen.getByRole('button', { name: /Write the case/ }))

    await user.click(screen.getByRole('button', { name: /Ask AI/ }))
    expect(openEngagement.mock.calls.at(-1)![1].objectId).toBe('a-1')
    await user.click(screen.getByRole('button', { name: 'Team' }))
    expect(openEngagement.mock.calls.at(-1)![1].objectId).toBe('a-1')
  })
})
