/**
 * The PARKED asset workspace.
 *
 * The component is experimental and nothing routes to it -- the existing Asset
 * page is canonical. The suite is kept because the modules it covers are the
 * ones intended to move into that page later, and a covered module is far
 * cheaper to move than an uncovered one.
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

/*
 * The review map the page now joins in, which reads org context this suite
 * does not stand up.
 *
 * Empty is the honest default here: every case below is about what the page
 * SAYS about a case and its evidence, and no review recorded means the state
 * falls back to the written date -- exactly what these cases already assumed
 * when the field was simply never set.
 *
 * The parity that field exists for is asserted where it can fail for one
 * reason: `src/lib/memory/__tests__/review-state-parity.test.ts`, which also
 * pins that this file keeps reading the canonical map rather than a second
 * calculation of its own.
 */
/*
 * The last two are for `ThesisVerdictBar`, which the header now renders.
 *
 * The record call is captured rather than stubbed blind, so a case can assert
 * that pressing an answer reaches the mutation with the right outcome -- the
 * whole point of putting the verdict on this surface.
 */
const recordVerdict = vi.fn()
vi.mock('../../hooks/useThesisReview', () => ({
  useThesisReviews: () => new Map<string, string>(),
  useRecordThesisReview: () => ({
    record: recordVerdict, isPending: false, pendingOutcome: null,
  }),
  useCurrentThesisConclusion: () => ({ current: null }),
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

/**
 * jsdom implements no scrolling, so `scrollIntoView` does not exist on an
 * element -- not as a no-op, as an absent property. The header's primary
 * action calls it, so without this every case that presses that button fails
 * with a TypeError that says nothing about the behaviour under test.
 *
 * Installed here rather than inside one case so it is clearly the harness
 * standing in for the browser, and the ids it records are available to any
 * case that wants to assert where a control actually points.
 */
const scrolledTo: string[] = []
Object.defineProperty(Element.prototype, 'scrollIntoView', {
  configurable: true, writable: true,
  value: function (this: Element) { scrolledTo.push(this.id) },
})

beforeEach(() => {
  data = { ...BASE }
  readFor.length = 0
  editorFor.length = 0
  scrolledTo.length = 0
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
        issue={{ title: 'New research', detail: 'Two notes arrived.' }}
      />,
    )
    expect(screen.getByText(/Opened from Research/)).toBeInTheDocument()
    expect(screen.getByText(/New research/)).toBeInTheDocument()
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
    expect(screen.getByText('Below bear case')).toBeInTheDocument()
  })

  it('claims no framework gap for a name nobody owns', () => {
    data = { ...BASE, ladder: ladder(180, 260), spot: 160, positions: [] }
    render(<AssetWorkspacePane asset={asset} />)
    // A book that holds nothing cannot have a broken framework.
    expect(screen.queryByText('Below bear case')).not.toBeInTheDocument()
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
        issue={{ title: 'Below bear case', reason: 'portfolio:below-bear' }}
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

  /*
   * ── Rewritten: an asset can hold a thread, but not an audience ──────────
   *
   * This pressed "Team" and asserted it raised a `discuss` request, on the
   * premise in its own title -- that an asset can hold a thread. The database
   * never stopped it and still would not.
   *
   * What stops it is that `messages` SELECT is `organization_id =
   * current_org_id()` and the table carries no participant column, so a
   * thread on an asset is readable by every member of the organisation. A
   * reader who wants to discuss a name with one team and not another is
   * describing a conversation with a membership list, which Direct Messages
   * already is. Posts keep their threads, because org-wide is the audience
   * they were published to; a shared record has no audience to inherit.
   *
   * Ask AI is asserted alongside, so this cannot pass by the control row
   * having disappeared for some unrelated reason.
   */
  it('offers no Team control, because an asset thread has no audience', () => {
    render(<AssetWorkspacePane asset={asset} />)
    expect(screen.queryByRole('button', { name: 'Team' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ask AI/ })).toBeInTheDocument()
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

/* ------------------------------------------------- understand → decide */

const pendingDecision = (over: any = {}) => ({
  id: 'd1', status: 'pending', action: 'Add in Large Cap Core', decidedAt: null,
  portfolioId: 'p1', portfolioName: 'Large Cap Core', decisionNote: 'Raising to target on the print.', ...over,
})

describe('the decision band turns understanding into a decision', () => {
  it('shows nothing when no request is waiting — the hero collapses', () => {
    data = { ...BASE, positions: [position()], decisions: [] }
    render(<AssetWorkspacePane asset={asset} portfolioId="p1" />)
    expect(screen.queryByTestId('decision-band')).not.toBeInTheDocument()
  })

  it('does not appear for a decision that is already made', () => {
    data = { ...BASE, decisions: [pendingDecision({ status: 'approved', decidedAt: daysAgo(1) })] }
    render(<AssetWorkspacePane asset={asset} />)
    expect(screen.queryByTestId('decision-band')).not.toBeInTheDocument()
  })

  it('frames a pending request against our view and the book, with an elevated CTA', () => {
    data = { ...BASE, positions: [position()], target: 200, spot: 160, decisions: [pendingDecision()] }
    render(<AssetWorkspacePane asset={asset} portfolioId="p1" />)
    const band = screen.getByTestId('decision-band')
    expect(within(band).getByText(/Add in Large Cap Core/)).toBeInTheDocument()
    expect(within(band).getByTestId('decision-cta')).toHaveTextContent('Decide')
    expect(within(band).getByTestId('against-view')).toHaveTextContent(/Target.*to spot/)
    expect(within(band).getByTestId('against-book')).toHaveTextContent(/Large Cap Core carries 28\.20%/)
  })

  it('shows reward-to-risk only when the ladder and spot that derive it exist, and states its inputs', () => {
    // bear 120, bull 260, spot 160 -> (260-160)/(160-120) = 2.5:1
    data = { ...BASE, target: 200, spot: 160, ladder: ladder(120, 260), decisions: [pendingDecision()] }
    const { rerender } = render(<AssetWorkspacePane asset={asset} />)
    const view = screen.getByTestId('against-view')
    expect(view).toHaveTextContent(/reward-to-risk 2\.5:1/)
    expect(view).toHaveTextContent(/bear .* spot .* bull/)

    // No ladder -> the ratio is omitted, never invented.
    data = { ...BASE, target: 200, spot: 160, ladder: null, decisions: [pendingDecision()] }
    rerender(<AssetWorkspacePane asset={{ ...asset, id: 'a-2' }} />)
    expect(screen.getByTestId('against-view')).not.toHaveTextContent(/reward-to-risk/)
  })

  it('hands off to the decision workflow rather than deciding inline', async () => {
    const spy = vi.spyOn(window, 'dispatchEvent')
    data = { ...BASE, decisions: [pendingDecision()],
      liveIdeas: [{ id: 'i1', action: 'add', stage: 'deciding', rationale: null, portfolioName: 'Large Cap Core' }] }
    render(<AssetWorkspacePane asset={asset} />)
    await userEvent.click(screen.getByTestId('decision-cta'))
    const fired = spy.mock.calls.some(([e]: any) => e?.type === 'decision-engine-action')
    expect(fired).toBe(true)
    spy.mockRestore()
  })
})

/* ------------------------------------------------------ one vertical read */

/**
 * The page reads top to bottom, the way an answer is read.
 *
 * ── What it was ───────────────────────────────────────────────────────────
 *
 * `DesktopColumns` -- a 1.62fr lead beside a 300px-minimum context gutter.
 * MEASURED live at a 1440px pane: the grid resolved to `831px 513px`, and the
 * sections split across it so The case and Framework sat at x=472 while
 * Price, Research status, Evidence on record and Largest position sat at
 * x=1336. Reading the page meant going down one column and back up the
 * other, and nothing said which order the halves were in.
 *
 * ── Why this reverses a recorded decision ─────────────────────────────────
 *
 * The pass that introduced two columns had a reason, quoted in
 * `convergence.test.ts`: half-width modules auto-placed into a grid "stack
 * down the left and leave the right empty whenever the data is sparse, which
 * is what left these pages using a quarter of the canvas". That reason is
 * about CANVAS USE. This is a different question, and the trade is
 * deliberate: an asset workspace is read at a fixed measure, and spending
 * canvas to get that is the choice. The four lens detail panes are unchanged
 * and still iterate through `DETAILS` in that guard, which is why this file
 * is not in it.
 *
 * jsdom performs no layout, so the geometry is in the commit message and
 * these cases assert the STRUCTURE that produces it: one stack, every
 * section a direct child of it, in the order the focus rule chose.
 */
describe('the workspace is one column, not a mosaic', () => {
  const populated = () => ({
    ...BASE,
    sections: [section()], coreSections: ['thesis'], caseWrittenAt: daysAgo(30),
    spot: 162, target: 200, ladder: ladder(120, 260),
    positions: [position()],
    evidence: [{ id: 'e1', title: 'A note', createdAt: daysAgo(40), authorName: 'A', isShared: true }],
    liveIdeas: [{ id: 'i1', action: 'add', stage: 'deciding', rationale: null, portfolioName: 'Large Cap Core' }],
    history: [{ date: dateAgo(3), close: 160 }, { date: dateAgo(1), close: 162 }],
  } as AssetWorkspaceData)

  const panels = (root: HTMLElement) => [
    ...root.querySelectorAll('[data-testid="desktop-section"],[data-testid="desktop-module"]'),
  ]

  /** THE case: one parent for every panel on the page. */
  it('hangs every section off a single stack', () => {
    data = populated()
    render(<AssetWorkspacePane asset={asset} />)
    const found = panels(screen.getByTestId('asset-workspace'))
    expect(found.length).toBeGreaterThan(3)
    const parents = new Set(found.map(p => p.parentElement))
    expect(parents.size).toBe(1)
  })

  /**
   * ── Rewritten from `100ch`, with the reason ─────────────────────────────
   *
   * This case pinned `max-w-[100ch]` one commit ago. At 1920 that resolved to
   * an 863px column inside a 1504px pane, which left 313px of nothing on EACH
   * side -- measured. More of the pane was margin than the sidebar beside it
   * is wide, and that was reported as the pane wasting its space.
   *
   * What the case is actually FOR survives unchanged: a cap exists, it is
   * centred, and the grid does not come back. Only the number moved, so the
   * assertion is now written against "a cap in the 120-160ch range" rather
   * than one exact value -- pinning the literal is what made a deliberate
   * widening look like a regression.
   */
  it('caps the measure instead of filling the canvas', () => {
    data = populated()
    render(<AssetWorkspacePane asset={asset} />)
    const stack = panels(screen.getByTestId('asset-workspace'))[0].parentElement!
    // The two halves of "reads like an answer": a measure cap, and centred
    // in whatever width it is given.
    const cap = stack.className.match(/max-w-\[(\d+)ch\]/)
    expect(cap, stack.className).not.toBeNull()
    const ch = Number(cap![1])
    // Wide enough not to letterbox a 1500px pane, and still a cap: an
    // uncapped column would run prose the full width of a 4K display.
    expect(ch).toBeGreaterThanOrEqual(120)
    expect(ch).toBeLessThanOrEqual(160)
    expect(stack.className).toMatch(/\bmx-auto\b/)
    expect(stack.className).toMatch(/flex-col/)
    // The grid it replaced must not come back on this surface.
    expect(stack.className).not.toMatch(/\bgrid\b/)
  })

  /**
   * The focus rule is unchanged, and this is what proves it survived: it
   * produced a lead list and a context list, and concatenating them has to
   * leave what led still leading.
   */
  it('keeps the focus order, lead first', () => {
    data = populated()
    render(<AssetWorkspacePane asset={asset} focus="research" />)
    const ids = panels(screen.getByTestId('asset-workspace'))
      .map(p => p.id || p.getAttribute('data-module'))
    // Research leads with the case; price and the position are context.
    expect(ids.indexOf('the-case')).toBe(0)
    expect(ids.indexOf('the-case')).toBeLessThan(ids.indexOf('evidence'))
  })

  it('reorders for a position focus without hiding anything', () => {
    data = populated()
    render(<AssetWorkspacePane asset={asset} focus="position" portfolioId="p1" />)
    const ids = panels(screen.getByTestId('asset-workspace'))
      .map(p => p.id || p.getAttribute('data-module'))
    // The framework leads here, because it is the only thing that can say the
    // position is wrong. The case still follows it rather than disappearing.
    expect(ids[0]).toBe('framework')
    expect(ids).toContain('the-case')
  })
})

/* --------------------------------------------------- the one thing to do */

/**
 * The action row has a shape.
 *
 * `IdeaDetail`, `ResearchDetail` and `PositionDetail` each open with one solid
 * primary and then go quiet. This row opened with "Ask AI" -- amber, quiet --
 * then Team, then Full asset page: three quiet controls and no answer to
 * "what am I meant to do with this", on a surface the reader reached FROM a
 * finding.
 *
 * The verb is `primaryActionFor`, the research vocabulary `ResearchDetail`
 * already calls, so the two cannot drift into two verb lists.
 */
describe('the action row leads with the one thing to do', () => {
  const firstAction = () => {
    const row = screen.getByText('Ask AI').closest('div')!
    return row.querySelector('button')!
  }

  it('offers a solid primary before anything quiet', () => {
    data = { ...BASE, sections: [section()], coreSections: ['thesis'], caseWrittenAt: daysAgo(400) }
    render(<AssetWorkspacePane asset={asset} />)
    const first = firstAction()
    // A case written 400 days ago is stale, and the desk's verb for that is
    // Review thesis. Taken from the shared model, not spelled here.
    expect(first).toHaveTextContent('Review thesis')
    expect(first.className).toMatch(/bg-blue-700/)
    // Ask AI is still there, and still after it.
    expect(first).not.toHaveTextContent('Ask AI')
  })

  it('says Write the case when there is none', () => {
    // `stateOf` reaches `no-thesis` only where research EXISTS and no thesis
    // was written from it. With nothing at all the state is `thin`, and the
    // desk's verb for that is Add evidence -- the shared model's answer, not
    // this surface's, which is the point of taking the verb from it.
    data = { ...BASE, evidence: [{ id: 'e1', title: 'A note', createdAt: daysAgo(10), authorName: 'A', isShared: true }] } as AssetWorkspaceData
    render(<AssetWorkspacePane asset={asset} />)
    expect(firstAction()).toHaveTextContent('Write the case')
  })

  it('says Add evidence when the record is empty', () => {
    data = { ...BASE }
    render(<AssetWorkspacePane asset={asset} />)
    expect(firstAction()).toHaveTextContent('Add evidence')
  })

  /**
   * THE case against a dead control. The two non-case targets are both
   * conditional -- `new-since-review` renders only when evidence arrived
   * after the case, `evidence` only when any is on record -- so the verb and
   * the thing it scrolls to can disagree. A button that scrolls to nothing is
   * the failure the panes' overflow icons were removed for.
   */
  it('never points at a section that did not render', async () => {
    // Thin: the verb is Add evidence, and there is no evidence section.
    data = { ...BASE, sections: [section()], coreSections: ['thesis'], caseWrittenAt: daysAgo(2), evidence: [] }
    render(<AssetWorkspacePane asset={asset} />)
    expect(firstAction()).toHaveTextContent('Add evidence')
    await userEvent.click(firstAction())
    expect(scrolledTo).toHaveLength(1)
    // Whatever it pointed at has to be ON the page.
    expect(document.getElementById(scrolledTo[0])).not.toBeNull()
    // And here specifically, the fallback is what kept it alive.
    expect(scrolledTo[0]).toBe('the-case')
  })

  /** The counter-check: the fallback must not swallow a target that DID render. */
  it('points at the arrival section when that is what the verb names', async () => {
    data = {
      ...BASE,
      sections: [section({ updatedAt: daysAgo(60) })], coreSections: ['thesis'],
      caseWrittenAt: daysAgo(60),
      // `isNewSinceReview` is the hook's own flag, not a date comparison the
      // pane makes -- which is why the fixture has to set it rather than
      // relying on the createdAt being later than the written date.
      evidence: [{ id: 'e1', title: 'Arrived after', createdAt: daysAgo(5), authorName: 'A', isShared: true, isNewSinceReview: true }],
    } as AssetWorkspaceData
    render(<AssetWorkspacePane asset={asset} />)
    expect(firstAction()).toHaveTextContent('Review new evidence')
    await userEvent.click(firstAction())
    expect(scrolledTo).toEqual(['new-since-review'])
  })

  it('opens the editor itself where the verb is to write', async () => {
    // Research on record, no thesis written from it: `no-thesis`, the one
    // state where this surface can answer its own verb.
    data = { ...BASE, evidence: [{ id: 'e1', title: 'A note', createdAt: daysAgo(10), authorName: 'A', isShared: true }] } as AssetWorkspaceData
    render(<AssetWorkspacePane asset={asset} />)
    expect(screen.queryByTestId('real-thesis-editor')).toBeNull()
    await userEvent.click(firstAction())
    // This surface CAN author, which `ResearchDetail` cannot -- its own
    // comment says authoring "happens on the Asset page". So the primary does
    // the thing rather than handing off to it.
    expect(screen.getByTestId('real-thesis-editor')).toBeInTheDocument()
  })
})

/**
 * The header reads like the other three lens panes.
 *
 * ── What it looked like instead ───────────────────────────────────────────
 *
 * One left-justified run: the primary, Ask AI, Team and Full asset page all
 * packed against the left edge, with the stats block floating far away on the
 * right. `IdeaDetail`, `ResearchDetail` and `PositionDetail` all use three
 * groups -- the step, the verdict, the tools -- and this is the surface a
 * reader reaches FROM one of them, so it was the odd one out.
 *
 * And it had no verdict at all, which is the part that mattered: a reader who
 * opened a name from a finding could read the case and had no way to record
 * what they concluded about it.
 */
describe('the header carries the step, the verdict and the tools', () => {
  const actionRow = () => screen.getByText('Ask AI').closest('div')!

  /** THE case for the verdict: it exists here at all. */
  it('offers the three answers when there is a case to judge', () => {
    data = { ...BASE, sections: [section()], coreSections: ['thesis'], caseWrittenAt: daysAgo(400) }
    render(<AssetWorkspacePane asset={asset} />)
    expect(screen.getByText('Does the case still hold?')).toBeInTheDocument()
    for (const outcome of ['holds', 'changed', 'needs_work']) {
      expect(
        document.querySelector(`[data-slot="research-review-${outcome}"]`),
        outcome,
      ).not.toBeNull()
    }
  })

  /** The opposite injection: nothing to conclude about an unwritten thesis. */
  it('offers no verdict on a name with no case written', () => {
    data = { ...BASE, evidence: [{ id: 'e1', title: 'A note', createdAt: daysAgo(10), authorName: 'A', isShared: true }] } as AssetWorkspaceData
    render(<AssetWorkspacePane asset={asset} />)
    expect(screen.queryByText('Does the case still hold?')).toBeNull()
    /*
     * And the primary is still there, so this is a gated verdict and not a
     * header that failed to render.
     *
     * "Write the case" and not "Add evidence": `stateOf` reads research on
     * record with no thesis as `no-thesis`, and reserves `thin` for a record
     * that is empty on both counts. Asserted from the shared model's real
     * answer rather than from what the fixture looks like it should mean.
     */
    expect(actionRow().querySelector('button')).toHaveTextContent('Write the case')
  })

  it('records the answer the reader presses', async () => {
    recordVerdict.mockClear()
    data = { ...BASE, sections: [section()], coreSections: ['thesis'], caseWrittenAt: daysAgo(400) }
    render(<AssetWorkspacePane asset={asset} />)
    await userEvent.click(
      document.querySelector('[data-slot="research-review-changed"]') as HTMLElement,
    )
    expect(recordVerdict).toHaveBeenCalledWith('changed')
  })

  /**
   * The tools go right, which is what the user could see was wrong: the row
   * was one left-packed run. `justify-end` inside a `flex-1` sibling is what
   * pushes the group, and the primary's own `flex-1` is what keeps the
   * verdict centred between them.
   */
  it('pushes the tools to the right rather than packing them left', () => {
    data = { ...BASE, sections: [section()], coreSections: ['thesis'], caseWrittenAt: daysAgo(400) }
    render(<AssetWorkspacePane asset={asset} />)
    const tools = screen.getByText('Ask AI').parentElement!
    expect(tools.className).toMatch(/justify-end/)
    expect(tools.className).toMatch(/flex-1/)
    // The primary's group takes the opposite half. Both `flex-1` or the
    // middle group is not centred -- measured 170px off on the research pane
    // when only one side had it.
    const primaryGroup = actionRow().querySelector('button')!.parentElement!
    expect(primaryGroup.className).toMatch(/flex-1/)
  })

  /**
   * Smaller, and the reason is that it shares a row with the verdict now: at
   * `py-2.5 text-[13px]` it was a 42px slab of saturated blue over a page
   * whose job is to be read.
   */
  it('keeps the primary the same height as the controls beside it', () => {
    data = { ...BASE, sections: [section()], coreSections: ['thesis'], caseWrittenAt: daysAgo(400) }
    render(<AssetWorkspacePane asset={asset} />)
    const primary = actionRow().querySelector('button')!
    expect(primary.className).toMatch(/py-1\.5/)
    expect(primary.className).toMatch(/text-\[12px\]/)
    // The slab it replaced, gone rather than merely overridden.
    expect(primary.className).not.toMatch(/py-2\.5/)
    expect(primary.className).not.toMatch(/px-4/)
    // Still the solid primary, not demoted to a text button.
    expect(primary.className).toMatch(/bg-blue-600/)
  })
})
