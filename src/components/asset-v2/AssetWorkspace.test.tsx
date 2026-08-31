/**
 * The canonical Asset workspace.
 *
 * This is where the behaviour that used to be asserted against Research detail
 * and Portfolio position detail now lives, because that is where it moved: one
 * destination, one thesis editor, one definition of weight.
 *
 * The read is mocked -- it is a single bounded query and the helpers it
 * composes have their own suites. What is asserted here is the surface's own
 * decisions: which object is on screen, how the composition answers the
 * question the reader arrived with, what it refuses to invent, and that the
 * engagement seam carries real context.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AssetWorkspaceData } from '../../hooks/useAssetWorkspace'

const DAY = 86_400_000
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString()
const dateAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10)

const BASE: AssetWorkspaceData = {
  sections: [], evidence: [], caseWrittenAt: null, coreSections: [],
  history: [], spot: null, ladder: null, target: null,
  positions: [], liveIdeas: [], decisions: [],
}

let data: AssetWorkspaceData = BASE
const readFor: { assetId: string | null; focus: string }[] = []

vi.mock('../../hooks/useAssetWorkspace', async importOriginal => {
  const actual = await importOriginal<typeof import('../../hooks/useAssetWorkspace')>()
  return {
    ...actual,
    useAssetWorkspace: (assetId: string | null, _symbol: string | null, focus: string) => {
      readFor.push({ assetId, focus })
      return { data, isLoading: false, error: null }
    },
  }
})

/** The Asset page's own contribution editor, stubbed to prove it is MOUNTED. */
const editorFor: string[] = []
vi.mock('../contributions', () => ({
  ThesisContainer: ({ assetId }: { assetId: string }) => {
    editorFor.push(assetId)
    return <div data-testid="real-thesis-editor" data-asset={assetId} />
  },
}))

const openEngagement = vi.fn()
vi.mock('../../lib/engagement', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/engagement')>()
  return {
    ...actual,
    askAI: (t: any) => openEngagement('ai', t),
    discuss: (t: any) => openEngagement('discuss', t),
  }
})

import { AssetWorkspacePane } from './AssetWorkspace'

const asset = { id: 'a-1', symbol: 'AAPL', company_name: 'Apple Inc.' }

const section = (over: any = {}) => ({
  section: 'thesis', content: 'Services mix is under-modelled.',
  supportingDetail: null, updatedAt: daysAgo(30), authorName: 'John Park', ...over,
})

const position = (over: any = {}) => ({
  portfolioId: 'p1', portfolioName: 'Large Cap Core',
  shares: 1000, price: 160, marketValue: 160_000,
  weightPct: 28.2, avgCost: 120, unrealisedGain: 40_000, unrealisedPct: 33.3,
  asOf: dateAgo(2), ...over,
})

const ladder = (bear: number, bull: number) => ({
  assetId: 'a-1', symbol: 'AAPL', companyName: 'Apple Inc.',
  cases: [{ name: 'Bear', price: bear }, { name: 'Bull', price: bull }],
  updatedAt: daysAgo(20), valid: true, reason: '',
} as any)

beforeEach(() => {
  data = { ...BASE }
  readFor.length = 0
  editorFor.length = 0
  openEngagement.mockClear()
})

/* ------------------------------------------------------------- identity */

describe('the object is unmistakable', () => {
  it('leads with the ticker, the company and today', () => {
    data = { ...BASE, spot: 162.4 }
    render(<AssetWorkspacePane asset={asset} />)
    expect(screen.getByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('Apple Inc.')).toBeInTheDocument()
    expect(screen.getByText('Spot')).toBeInTheDocument()
  })

  it('names the book only when the reader arrived through one', () => {
    data = { ...BASE, positions: [position()] }
    const { rerender } = render(<AssetWorkspacePane asset={asset} />)
    // An asset opened on its own terms is not "in" a book; it is held by some.
    expect(screen.queryByText('Weight')).not.toBeInTheDocument()

    rerender(<AssetWorkspacePane asset={asset} focus="position" portfolioId="p1" />)
    expect(screen.getByText('Weight')).toBeInTheDocument()
    expect(screen.getAllByText('Large Cap Core').length).toBeGreaterThan(0)
  })

  it('credits the surface that sent the reader, and its reason', () => {
    render(
      <AssetWorkspacePane
        asset={asset}
        focus="research"
        origin="research"
        issue={{ title: 'New evidence since review', detail: 'Two notes arrived.' }}
      />,
    )
    expect(screen.getByText(/Opened from Research/)).toBeInTheDocument()
    expect(screen.getByText(/New evidence since review/)).toBeInTheDocument()
    expect(screen.getByText('Two notes arrived.')).toBeInTheDocument()
  })
})

/* ----------------------------------------------------------------- case */

describe('the case is the object, and its absence is a finding', () => {
  it('sets the written case in the lead type, unboxed', () => {
    data = { ...BASE, sections: [section()], coreSections: ['thesis'], caseWrittenAt: daysAgo(30) }
    render(<AssetWorkspacePane asset={asset} />)
    const heading = screen.getByText('The case')
    expect(heading.closest('[data-testid="desktop-section"]')).not.toBeNull()
    expect(heading.closest('[data-testid="desktop-module"]')).toBeNull()
    expect(screen.getByText('Services mix is under-modelled.')).toBeInTheDocument()
  })

  it('states a missing case at the size of a finding, with what does exist', () => {
    // The JNJ shape: a large position and nothing written against it.
    data = { ...BASE, positions: [position({ weightPct: 28.2 })], evidence: [] }
    render(<AssetWorkspacePane asset={asset} focus="position" portfolioId="p1" />)
    expect(screen.getByText(/No core investment case has been written/)).toBeInTheDocument()
    expect(screen.getByText(/28.2% of its value/)).toBeInTheDocument()
    // No fabricated modules to fill the space.
    expect(screen.queryByText('Framework')).not.toBeInTheDocument()
  })

  it('names the evidence that exists when the case does not', () => {
    // The CROX shape: research on record, no core case.
    data = {
      ...BASE,
      evidence: [
        { id: 'n1', title: 'Channel checks', content: null, createdAt: daysAgo(5), authorName: null, isShared: true, isNewSinceReview: false },
        { id: 'n2', title: 'Q3 print', content: null, createdAt: daysAgo(9), authorName: null, isShared: true, isNewSinceReview: false },
      ],
    }
    render(<AssetWorkspacePane asset={asset} focus="research" />)
    expect(screen.getByText(/No core investment case has been written/)).toBeInTheDocument()
    expect(screen.getByText(/2 research items exist against it/)).toBeInTheDocument()
  })

  it('mounts the canonical editor rather than growing its own', async () => {
    const user = userEvent.setup()
    data = { ...BASE, sections: [section()], coreSections: ['thesis'], caseWrittenAt: daysAgo(30) }
    render(<AssetWorkspacePane asset={asset} />)
    await user.click(screen.getByRole('button', { name: /Edit/ }))

    expect(screen.getAllByTestId('real-thesis-editor')).toHaveLength(1)
    expect(editorFor).toEqual(['a-1'])
  })

  it('offers to write the case when there is none', () => {
    render(<AssetWorkspacePane asset={asset} focus="research" />)
    expect(screen.getByRole('button', { name: /Write the case/ })).toBeInTheDocument()
  })
})

/* ------------------------------------------------------------- research */

describe('research focus: what changed since we wrote it', () => {
  it('separates what arrived from what the case was written against', () => {
    data = {
      ...BASE,
      sections: [section()], coreSections: ['thesis'], caseWrittenAt: daysAgo(30),
      evidence: [
        { id: 'n1', title: 'Q3 print', content: 'Beat', createdAt: daysAgo(2), authorName: null, isShared: true, isNewSinceReview: true },
        { id: 'n2', title: 'Channel checks', content: null, createdAt: daysAgo(200), authorName: null, isShared: true, isNewSinceReview: false },
      ],
    }
    render(<AssetWorkspacePane asset={asset} focus="research" />)

    const arrived = screen.getByText('New since the case was written').closest('section')!
    expect(within(arrived).getByText('Q3 print')).toBeInTheDocument()
    expect(within(arrived).queryByText('Channel checks')).not.toBeInTheDocument()

    const onRecord = screen.getByText('Evidence on record').closest('section')!
    expect(within(onRecord).getByText('Channel checks')).toBeInTheDocument()
  })

  it('refuses to claim a since-case move the series cannot support', () => {
    data = {
      ...BASE,
      sections: [section({ updatedAt: daysAgo(300) })],
      coreSections: ['thesis'], caseWrittenAt: daysAgo(300),
      // History starts well after the case was written.
      history: [
        { date: dateAgo(30), close: 100 },
        { date: dateAgo(1), close: 130 },
      ],
    }
    render(<AssetWorkspacePane asset={asset} focus="research" />)
    expect(screen.queryByText(/since review/i)).not.toBeInTheDocument()
  })

  it('says plainly that no reviewed-unchanged record exists', () => {
    data = { ...BASE, sections: [section()], coreSections: ['thesis'], caseWrittenAt: daysAgo(200) }
    render(<AssetWorkspacePane asset={asset} focus="research" />)
    expect(screen.getByText(/no separate/i)).toBeInTheDocument()
    // And therefore no button pretending one can be written.
    expect(screen.queryByRole('button', { name: /mark.*reviewed|confirm review/i }))
      .not.toBeInTheDocument()
  })
})

/* ------------------------------------------------------------- position */

describe('position context is one book, without hiding the others', () => {
  it('shows the arrived-from book as the primary position', () => {
    data = {
      ...BASE,
      positions: [
        position({ portfolioId: 'p2', portfolioName: 'Vision Fund', weightPct: 40 }),
        position({ portfolioId: 'p1', portfolioName: 'Large Cap Core', weightPct: 28.2 }),
      ],
    }
    render(<AssetWorkspacePane asset={asset} focus="position" portfolioId="p1" />)
    // Not the largest stake: the book the reader was actually looking at.
    expect(screen.getByText('Position · Large Cap Core')).toBeInTheDocument()
    expect(screen.getByText('Also held in')).toBeInTheDocument()
  })

  it('gives every other book its own weight, never this one’s', () => {
    data = {
      ...BASE,
      positions: [
        position({ portfolioId: 'p1', portfolioName: 'Large Cap Core', weightPct: 28.2 }),
        position({ portfolioId: 'p2', portfolioName: 'Vision Fund', weightPct: 4.0 }),
      ],
    }
    render(<AssetWorkspacePane asset={asset} focus="position" portfolioId="p1" />)
    const also = screen.getByText('Also held in').closest('section')!
    expect(within(also).getByText('4.0%')).toBeInTheDocument()
    expect(within(also).queryByText('28.2%')).toBeNull()
  })

  it('shows shares rather than a fabricated zero when no weight exists', () => {
    data = { ...BASE, positions: [position({ weightPct: null })] }
    render(<AssetWorkspacePane asset={asset} focus="position" portfolioId="p1" />)
    expect(screen.getByText(/could not be derived/)).toBeInTheDocument()
    expect(screen.queryByText('0.0%')).not.toBeInTheDocument()
    expect(screen.getByText('1,000')).toBeInTheDocument()
  })

  it('omits unrealised entirely when no cost is on record', () => {
    data = { ...BASE, positions: [position({ avgCost: null, unrealisedGain: null, unrealisedPct: null })] }
    render(<AssetWorkspacePane asset={asset} focus="position" portfolioId="p1" />)
    expect(screen.queryByText('Unrealised')).not.toBeInTheDocument()
    expect(screen.getByText(/No average cost on record/)).toBeInTheDocument()
  })

  it('never calls an unrealised figure portfolio P&L', () => {
    data = { ...BASE, positions: [position()] }
    render(<AssetWorkspacePane asset={asset} focus="position" portfolioId="p1" />)
    expect(screen.getByText('Unrealised')).toBeInTheDocument()
    expect(screen.queryByText(/^P&L$/)).not.toBeInTheDocument()
  })
})

/* ------------------------------------------------------------ framework */

describe('the framework is real or absent', () => {
  it('draws the ladder against today when both exist', () => {
    data = { ...BASE, ladder: ladder(120, 200), spot: 160, positions: [position()] }
    render(<AssetWorkspacePane asset={asset} focus="position" portfolioId="p1" />)
    expect(screen.getByText('Framework')).toBeInTheDocument()
  })

  it('draws nothing when there is no ladder', () => {
    data = { ...BASE, spot: 160, positions: [position()] }
    render(<AssetWorkspacePane asset={asset} focus="position" portfolioId="p1" />)
    expect(screen.queryByText('Framework')).not.toBeInTheDocument()
  })

  it('calls a position below its own bear case a break', () => {
    data = {
      ...BASE,
      sections: [section()], coreSections: ['thesis'], caseWrittenAt: daysAgo(10),
      ladder: ladder(180, 260), spot: 160, positions: [position()],
    }
    render(<AssetWorkspacePane asset={asset} focus="position" portfolioId="p1" />)
    expect(screen.getByText('Spot below bear case')).toBeInTheDocument()
  })

  it('claims no framework gap for a name nobody owns', () => {
    data = { ...BASE, ladder: ladder(180, 260), spot: 160, positions: [] }
    render(<AssetWorkspacePane asset={asset} />)
    // A book that holds nothing cannot have a broken framework.
    expect(screen.queryByText('Spot below bear case')).not.toBeInTheDocument()
  })
})

/* ----------------------------------------------------------- engagement */

describe('Ask AI and Team bind to the asset', () => {
  it('carries the asset, the book and the reason into the target', async () => {
    const user = userEvent.setup()
    data = { ...BASE, spot: 160, positions: [position()] }
    render(
      <AssetWorkspacePane
        asset={asset} focus="position" portfolioId="p1"
        issue={{ title: 'Spot below bear case', reason: 'portfolio:below-bear' }}
        origin="portfolio"
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Ask AI' }))

    const [view, target] = openEngagement.mock.calls[0]
    expect(view).toBe('ai')
    expect(target.objectType).toBe('asset')
    expect(target.objectId).toBe('a-1')
    expect(target.portfolioId).toBe('p1')
    expect(target.issue.reason).toBe('portfolio:below-bear')
    // Structured context, not a hand-written prompt.
    expect(target.contextChips.map((c: any) => c.label)).toContain('Weight')
  })

  it('offers Team, because an asset can hold a thread', async () => {
    const user = userEvent.setup()
    render(<AssetWorkspacePane asset={asset} />)
    await user.click(screen.getByRole('button', { name: 'Team' }))
    expect(openEngagement.mock.calls[0][0]).toBe('discuss')
  })
})

/* --------------------------------------------------------- composition */

describe('one page that adapts, never a sub-navigation', () => {
  it('fetches deeper history only where a chart is shown', () => {
    render(<AssetWorkspacePane asset={asset} />)
    expect(readFor.at(-1)!.focus).toBe('overview')

    readFor.length = 0
    render(<AssetWorkspacePane asset={asset} focus="research" />)
    expect(readFor.at(-1)!.focus).toBe('research')
  })

  it('hands off to ideas and decisions rather than absorbing them', () => {
    data = {
      ...BASE,
      liveIdeas: [{ id: 'i-1', action: 'trim', stage: 'deciding', rationale: 'Valuation', portfolioName: 'LCC' }],
      decisions: [{ id: 'd-1', status: 'accepted', action: 'trim', decidedAt: daysAgo(10), portfolioId: 'p1', portfolioName: 'LCC', decisionNote: null }],
    }
    render(<AssetWorkspacePane asset={asset} />)
    expect(screen.getByText('Live ideas')).toBeInTheDocument()
    expect(screen.getByText(/An idea is its own object/)).toBeInTheDocument()
    expect(screen.getByText('Recent decisions')).toBeInTheDocument()
    expect(screen.getByText(/kept in Decisions/)).toBeInTheDocument()
    // No decision widget, no idea workspace, no second Decision Memory.
    expect(screen.queryByRole('button', { name: /Accept|Decline/ })).not.toBeInTheDocument()
  })

  it('offers a quiet way back to the legacy page', async () => {
    const user = userEvent.setup()
    const onOpenLegacy = vi.fn()
    render(<AssetWorkspacePane asset={asset} onOpenLegacy={onOpenLegacy} />)
    await user.click(screen.getByRole('button', { name: /Full asset page/ }))
    expect(onOpenLegacy).toHaveBeenCalled()
  })

  it('ranks nothing: a page about one object does not order the others', () => {
    data = { ...BASE, positions: [position()] }
    render(<AssetWorkspacePane asset={asset} />)
    expect(screen.queryByTestId('research-tile')).not.toBeInTheDocument()
    expect(screen.queryByTestId('position-tile')).not.toBeInTheDocument()
  })
})
