/**
 * The asset workspace: parked as a page, live as the Dashboard's work pane.
 *
 * No asset TAB routes to it -- the existing Asset page is canonical, and a
 * convergence test holds that line. `AssetWorkspacePane`, which is what every
 * case here renders, is a different matter: the Dashboard mounts it as its
 * right-hand work pane through `DashboardNext` and `IdeasWorkPane`, so this
 * suite covers a surface users read today, not only modules intended to move
 * into the Asset page later. The file header on the component itself has the
 * longer version, and what it cost to get wrong.
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
/** Flipped by the one case that needs the skeleton, reset in `beforeEach`. */
let loading = false
const readFor: { assetId: string | null; focus: string }[] = []

vi.mock('../../hooks/useAssetWorkspace', async importOriginal => {
  const actual = await importOriginal<typeof import('../../hooks/useAssetWorkspace')>()
  return {
    ...actual,
    useAssetWorkspace: (assetId: string | null, _symbol: string | null, focus: string) => {
      readFor.push({ assetId, focus })
      return { data, isLoading: loading, error: null }
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

/*
 * The navigation seam the header's verb now goes through.
 *
 * `openAsset` dispatches window events a real tab host listens for. Nothing
 * in this suite mounts that host, so without the mock the press is a silent
 * no-op and a case asserting the destination could not tell the difference
 * between "navigated to research" and "did nothing at all". Captured, not
 * stubbed blind, because the destination IS the behaviour under test.
 */
const opened: any[] = []
vi.mock('../../lib/desktop-asset', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/desktop-asset')>()
  return {
    ...actual,
    openAsset: (req: any) => { opened.push(req); return true },
  }
})

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
  loading = false
  readFor.length = 0
  editorFor.length = 0
  scrolledTo.length = 0
  opened.length = 0
  openEngagement.mockClear()
  recordVerdict.mockClear()
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

  /**
   * ── Rewritten, with the reason ──────────────────────────────────────────
   *
   * This asserted three strings printed in the band: "Opened from Research",
   * the issue title, and the issue detail as a paragraph of its own. All
   * three said why the reader was here, in three places, directly above a
   * work pane that ALSO drew a "why you are here" strip with the same
   * sentence in it. Four statements of one fact across two stacked panes.
   *
   * The band now carries one of them, behind a question mark beside the
   * ticker, and the pane's strip is gone for an asset selection. What the
   * case is FOR survives: the reader can still find out why they were sent.
   * It is asserted through the control that holds it rather than through
   * text that is printed unconditionally.
   */
  it('keeps why the reader was sent, one press from the ticker', async () => {
    const user = userEvent.setup()
    render(
      <AssetWorkspacePane
        asset={asset}
        focus="research"
        origin="research"
        why={{ headline: 'New research', reason: 'Two notes arrived.' }}
      />,
    )
    // Not printed until asked for: that is the whole point of the control.
    expect(screen.queryByText('Two notes arrived.')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Why you are here' }))
    expect(screen.getByText('New research')).toBeInTheDocument()
    expect(screen.getByText('Two notes arrived.')).toBeInTheDocument()
  })

  /** The band that said it unconditionally, gone rather than merely moved. */
  it('no longer prints the provenance line in the header', () => {
    render(
      <AssetWorkspacePane
        asset={asset}
        origin="research"
        issue={{ title: 'New research', detail: 'Two notes arrived.' }}
      />,
    )
    expect(screen.queryByText(/Opened from/)).not.toBeInTheDocument()
    expect(screen.queryByText('Two notes arrived.')).not.toBeInTheDocument()
  })

  /** And no control at all where nothing sent the reader. */
  it('shows no question mark on a direct open', () => {
    render(<AssetWorkspacePane asset={asset} />)
    expect(screen.queryByRole('button', { name: 'Why you are here' })).toBeNull()
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
    /*
     * Renamed from "Full asset page" to "Overview", with the reason: the
     * primary beside it now opens that same tab, so two controls read as one
     * destination. The label says what this one does DIFFERENTLY -- it lands
     * on the overview where the verb lands on research.
     */
    await user.click(screen.getByRole('button', { name: /Overview/ }))
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
   * ── The column is the ONLY measure ──────────────────────────────────────
   *
   * The case above caps the stack, and for a while the written case was
   * capped a SECOND time inside it: the stack at `max-w-[140ch]` and the
   * prose at `max-w-[90ch]`. Those numbers do not compare, because `ch`
   * resolves against each element's own font size -- 140ch at the stack's
   * size is about 1,100px and 90ch at the case's 15px about 700px -- so the
   * case ran to roughly 64% of its column and stopped, with the right third
   * of every section blank. Reported from the running page as the text
   * wrapping two thirds of the way across.
   *
   * jsdom performs no layout, so this asserts the fact that produced it: no
   * element inside the case carries a `ch` cap of its own. A cap belongs to
   * the column, where one number governs the whole surface.
   */
  it('does not cap the written case a second time inside the column', () => {
    data = populated()
    render(<AssetWorkspacePane asset={asset} />)
    const theCase = screen.getByTestId('asset-workspace').querySelector('#the-case')
    expect(theCase, 'the case section did not render').not.toBeNull()
    const capped = [...theCase!.querySelectorAll<HTMLElement>('[class*="max-w-"]')]
      .filter(el => /max-w-\[\d+ch\]/.test(el.className))
      .map(el => el.className.match(/max-w-\[\d+ch\]/)![0])
    expect(capped, `a ch measure cap is back inside the case: ${capped.join(', ')}`).toEqual([])
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
describe('the action row names the one thing to do, and goes there', () => {
  /*
   * ── Found by its slot, not by its position ──────────────────────────────
   *
   * This helper was `firstAction()`: the first `<button>` inside the row
   * holding "Ask AI". That found the primary only because the primary was
   * FIRST in the row, which is the thing the reader objected to -- the verb
   * sat at the left-hand end of the band. It is now last, inside a
   * right-aligned group, so a positional lookup would silently start
   * asserting against "Ask AI" and every case below would pass while testing
   * the wrong control.
   *
   * `data-slot="asset-primary"` is declared by the component for exactly
   * this, so the cases no longer pin an ordering nobody asked for.
   */
  const primaryButton = () => screen.getByTestId('asset-workspace')
    .querySelector<HTMLButtonElement>('[data-slot="asset-primary"]')!

  it('is the only filled control on the band', () => {
    data = { ...BASE, sections: [section()], coreSections: ['thesis'], caseWrittenAt: daysAgo(400) }
    render(<AssetWorkspacePane asset={asset} />)
    const primary = primaryButton()
    // A case written 400 days ago is stale, and the desk's verb for that is
    // Review thesis. Taken from the shared model, not spelled here.
    expect(primary).toHaveTextContent('Review thesis')
    expect(primary.className).toMatch(/bg-blue-600/)
    /*
     * What makes it the primary is now this, and not its size. It was a 42px
     * slab, then a 32px one, and was still reported as too large; it is down
     * to the quiet controls' own scale. If being filled stops being true the
     * band has no primary at all, which is why the negative half is asserted
     * against its actual siblings rather than assumed.
     */
    const siblings = [...primary.parentElement!.querySelectorAll('button')]
      .filter(b => b !== primary)
    expect(siblings.length).toBeGreaterThan(0)
    for (const quiet of siblings) expect(quiet.className).not.toMatch(/bg-blue/)
  })

  it('says Write the case when there is none', () => {
    // `stateOf` reaches `no-thesis` only where research EXISTS and no thesis
    // was written from it. With nothing at all the state is `thin`, and the
    // desk's verb for that is Add evidence -- the shared model's answer, not
    // this surface's, which is the point of taking the verb from it.
    data = { ...BASE, evidence: [{ id: 'e1', title: 'A note', createdAt: daysAgo(10), authorName: 'A', isShared: true }] } as AssetWorkspaceData
    render(<AssetWorkspacePane asset={asset} />)
    expect(primaryButton()).toHaveTextContent('Write the case')
  })

  it('says Add evidence when the record is empty', () => {
    data = { ...BASE }
    render(<AssetWorkspacePane asset={asset} />)
    expect(primaryButton()).toHaveTextContent('Add evidence')
  })

  /**
   * ── THE case, re-aimed at the real destination ──────────────────────────
   *
   * Three cases here used to assert `scrollIntoView`: the verb moved this
   * same pane to a section a few hundred pixels below the button. They
   * existed to stop a verb pointing at a section that had not rendered -- a
   * control that scrolls to nothing.
   *
   * The verb no longer scrolls. It opens the Asset page, which is where all
   * seven of these verbs are actually carried out. The equivalent failure is
   * therefore a press that navigates nowhere, or navigates without saying
   * which asset -- and that is what these three now assert. The subject is
   * unchanged: the primary must do something real, at the object it names.
   */
  it('opens the asset instead of moving this page', async () => {
    data = { ...BASE, sections: [section()], coreSections: ['thesis'], caseWrittenAt: daysAgo(400) }
    render(<AssetWorkspacePane asset={asset} />)
    await userEvent.click(primaryButton())
    expect(opened).toHaveLength(1)
    expect(opened[0].assetId).toBe('a-1')
    expect(opened[0].symbol).toBe('AAPL')
    // The old behaviour, now explicitly forbidden: a press that only scrolls
    // is the complaint this change answers, and it must not come back.
    expect(scrolledTo).toEqual([])
  })

  it('lands on the part of the asset the verb is about', async () => {
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
    expect(primaryButton()).toHaveTextContent('Review new evidence')
    await userEvent.click(primaryButton())
    // Every verb is a thing done to the case, and research is where the case
    // and the evidence under it both live. Landing at the top of the asset
    // page would make the reader hunt for what the verb just named.
    expect(opened[0].focus).toBe('research')
  })

  it('carries the book the reader arrived through', async () => {
    data = { ...BASE, positions: [position()] }
    render(
      <AssetWorkspacePane asset={asset} portfolioId="p1" portfolioName="Large Cap Core" />,
    )
    await userEvent.click(primaryButton())
    // Arriving from a book and losing it on the way to the asset page is the
    // same context loss the Ask AI seam is asserted against elsewhere.
    expect(opened[0].portfolioId).toBe('p1')
    expect(opened[0].portfolioName).toBe('Large Cap Core')
  })

  /**
   * ── Authoring in place is not lost ──────────────────────────────────────
   *
   * A case here used to press the header's verb in the `no-thesis` state and
   * assert the in-pane editor mounted: this surface CAN author, so the verb
   * did the thing rather than handing off.
   *
   * The header's verb now leaves, consistently, whatever the verb is -- a
   * button that sometimes navigates and sometimes opens an editor is worse
   * than either. What this case protects is that leaving did not take the
   * in-place editor with it: the case section keeps its own control, so a
   * reader who wants to stay still writes here in one press.
   */
  it('still writes in place from the case itself, not only away', async () => {
    data = { ...BASE, evidence: [{ id: 'e1', title: 'A note', createdAt: daysAgo(10), authorName: 'A', isShared: true }] } as AssetWorkspaceData
    render(<AssetWorkspacePane asset={asset} />)
    expect(screen.queryByTestId('real-thesis-editor')).toBeNull()

    // The header's verb reads the same words in this state, so the section's
    // own control has to be reached past it rather than by label alone.
    const inCase = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .filter(b => b.dataset.slot !== 'asset-primary' && /Write the case/.test(b.textContent ?? ''))
    expect(inCase).toHaveLength(1)
    await userEvent.click(inCase[0])
    expect(screen.getByTestId('real-thesis-editor')).toBeInTheDocument()
    // And pressing it did NOT navigate. Writing here means staying here.
    expect(opened).toEqual([])
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
  /*
   * Was `actionRow().querySelector('button')`, which meant "the row's first
   * button" and only ever found the primary because the primary led the row.
   * It is now last, in the right-aligned group, so the lookup goes through
   * the slot the component declares. Same subject, a handle that does not
   * depend on the ordering this change deliberately altered.
   */
  const primaryButton = () => screen.getByTestId('asset-workspace')
    .querySelector<HTMLButtonElement>('[data-slot="asset-primary"]')!

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
    expect(primaryButton()).toHaveTextContent('Write the case')
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
   * ── Three groups became two, and the verb crossed the row ───────────────
   *
   * This case asserted a three-group row -- step, verdict, tools -- with
   * `flex-1` on BOTH outer groups to centre the middle one, and the primary
   * in the left group.
   *
   * The reader asked for the verb on the right. There is no left group left
   * to balance against, so a second `flex-1` would now centre nothing; the
   * verdict simply starts the row and one right-aligned group holds the
   * tools AND the verb. What the case is for is unchanged and is the half
   * that was actually wrong before: nothing in this row packs against the
   * left edge except the verdict.
   */
  it('puts the verb and the tools together, at the right', () => {
    data = { ...BASE, sections: [section()], coreSections: ['thesis'], caseWrittenAt: daysAgo(400) }
    render(<AssetWorkspacePane asset={asset} />)
    const tools = screen.getByText('Ask AI').parentElement!
    expect(tools.className).toMatch(/justify-end/)
    expect(tools.className).toMatch(/flex-1/)
    // The verb is INSIDE that group now, not in a left-hand one of its own.
    // This is the user's actual complaint, and it cannot pass if the primary
    // goes back to leading the row.
    expect(tools.contains(primaryButton())).toBe(true)
    // Last within it, after the quiet controls rather than before them.
    const inGroup = [...tools.querySelectorAll('button')]
    expect(inGroup.indexOf(primaryButton())).toBeGreaterThan(0)
  })

  /**
   * Two bands, with the question on the ticker's own line.
   *
   * ── What the three bands cost ───────────────────────────────────────────
   *
   * The header stacked a ticker row, a context line and an action row. The
   * verdict -- the one question this surface asks -- opened the third of
   * them, so it sat below two rows of description, and the tools sat below
   * it again. Measured on the running app: the band was 146px of a sticky
   * element, the verdict's top edge at y=256 and the tools at y=256.
   *
   * The verdict joins the ticker row and the tools join the context line.
   * Measured after: 107px, the verdict at y=179 and the tools at y=229.
   * Reported as: centre it in the top banner and raise it, and raise the Ask
   * AI and Review thesis buttons.
   *
   * ── Why both halves are pinned ──────────────────────────────────────────
   *
   * Either one alone leaves the band standing. The verdict could move up and
   * the tools keep a row of their own, which is two bands and no height
   * back; or the tools could move up and the verdict keep one, which is the
   * same thing with the question buried instead of the controls.
   */
  it('carries the verdict on the ticker row and the tools on the context line', () => {
    data = { ...BASE, sections: [section()], coreSections: ['thesis'], caseWrittenAt: daysAgo(400) }
    render(<AssetWorkspacePane asset={asset} />)

    const header = screen.getByText('AAPL').closest('[class*="sticky"]')!
    const verdict = header.querySelector('[data-slot="research-thesis-review"]')!
    const tickerRow = screen.getByText('AAPL').parentElement!.parentElement!

    // The verdict shares the ticker's row, rather than opening one below it.
    expect(tickerRow.contains(verdict)).toBe(true)

    /*
     * And it is centred BY that row, not by a margin: both groups beside it
     * carry `flex-1` on the same basis, so the free space splits evenly and
     * the bar lands on the header's midline whatever the ticker and the
     * stats measure. `mx-auto` against one `ml-auto` neighbour puts it a
     * third of the way across, which is what centring it by hand gets you.
     */
    const sides = [...tickerRow.children].filter(c => c !== verdict)
    expect(sides).toHaveLength(2)
    for (const side of sides) {
      expect(side.className).toMatch(/\bflex-1\b/)
      expect(side.className).toMatch(/basis-\[11rem\]/)
    }

    // The tools ride the context line, which is the row the state label is
    // on -- so there is no third band left for them to be in.
    const tools = screen.getByText('Ask AI').parentElement!
    const contextRow = tools.parentElement!
    expect(contextRow).not.toBe(tickerRow)

    /*
     * Two bands under the sticky header and no more, and they are these two.
     * The length alone would pass on a header that dropped the context line
     * and kept an action band, which is the shape this replaced.
     */
    expect([...header.children]).toEqual([tickerRow, contextRow])
  })

  /**
   * ── Stated as a relationship, because the literals keep moving ──────────
   *
   * Rewritten rather than dropped; what it asserts has not changed.
   *
   * It pinned `py-1.5 text-[12px]`, then `px-2.5 py-1 text-[11px]`, each time
   * naming the exact literal of the day. The subject was never a particular
   * number -- it is that the primary is not a slab and is still the primary
   * -- and pinning the number meant the case broke on every legitimate pass
   * over the type scale while never once catching a slab.
   *
   * So it reads the quiet controls' own size out of the band and compares.
   * That survives a scale change and still fails on the thing it is for.
   *
   * The floor clause is the other half: 11px is now where labels and
   * captions live, so a verb set there is not quiet, it is a caption.
   */
  it('keeps the primary no larger than the controls beside it', () => {
    data = { ...BASE, sections: [section()], coreSections: ['thesis'], caseWrittenAt: daysAgo(400) }
    render(<AssetWorkspacePane asset={asset} />)
    const primary = primaryButton()
    const sizeOf = (el: Element) => Number(el.className.match(/text-\[(\d+)px\]/)?.[1] ?? NaN)

    const neighbours = [...primary.parentElement!.querySelectorAll('button')]
      .filter(b => b !== primary)
      .map(sizeOf)
      .filter(n => Number.isFinite(n))
    /* Without this the comparison below passes on an empty band, which is
       the one state where the question is meaningless. */
    expect(neighbours.length).toBeGreaterThan(0)

    expect(sizeOf(primary)).toBeLessThanOrEqual(Math.max(...neighbours))
    // Not a caption either: the floor of the scale is for labels.
    expect(sizeOf(primary)).toBeGreaterThanOrEqual(13)
    // Every block size it has already been, gone rather than overridden.
    expect(primary.className).not.toMatch(/py-2\.5/)
    expect(primary.className).not.toMatch(/px-4/)
    // Still the solid primary, not demoted to a text button.
    expect(primary.className).toMatch(/bg-blue-600/)
  })

  /**
   * ── One top pane, and it stays put ──────────────────────────────────────
   *
   * Two faults the reader reported together. The header was one of two
   * stacked bands -- a 25px strip holding a single `?` sat on top of it --
   * and it scrolled away with the page, so the ticker, the verdict and the
   * verb all left the screen as soon as the reader started reading.
   *
   * `sticky top-0` on the header, and the `?` folded into it beside the
   * ticker. The strip above is gone (asserted from the Ideas pane's side in
   * `work-pane-back`), so this is the only top pane and it is the one that
   * holds.
   */
  it('anchors the header so the verb survives scrolling', () => {
    data = { ...BASE, sections: [section()], coreSections: ['thesis'], caseWrittenAt: daysAgo(400) }
    render(<AssetWorkspacePane asset={asset} why={{ headline: 'Stale', reason: null }} />)
    // The band that carries the ticker, which is the one that must hold.
    const header = screen.getByText('AAPL').closest('[class*="sticky"]')!
    expect(header).not.toBeNull()
    expect(header.className).toMatch(/\bsticky\b/)
    expect(header.className).toMatch(/\btop-0\b/)
    // Above the page's own content, or it scrolls under nothing and the
    // sections draw straight over it.
    expect(header.className).toMatch(/\bz-\d+/)
    // Opaque, for the same reason: a transparent sticky band shows the text
    // passing beneath it.
    expect(header.className).toMatch(/\bbg-/)
    // And the verb and the question mark are both inside it, so the one
    // anchored band is the one that holds everything the reader needs.
    expect(header.contains(primaryButton())).toBe(true)
    expect(header.querySelector('[data-slot="work-why-toggle"]')).not.toBeNull()
  })

  /**
   * ── And `sticky top-0` was not enough, which is the real lesson ─────────
   *
   * The case above passed for weeks while the header scrolled away in the
   * running app, because `sticky` is only half the mechanism. The other half
   * is WHICH box it sticks to: the nearest scrolling ancestor. This pane's
   * root declared `overflow-y-auto`, so the header was pinned to a box that
   * never scrolled -- measured live on the running page, `scrollHeight 1169
   * === clientHeight 1169`. The scrollport was its 726px parent, one level up
   * in `IdeasWorkPane`, and the header was not attached to that.
   *
   * `h-full` was the latent second half of the same fault. Sticky is also
   * confined to its containing block, so a root capped at the scrollport's
   * height would release the header about a third of the way down a 1169px
   * page. `min-h-full` keeps the ground reaching the bottom on a short name
   * while letting the box grow, which is what a MINIMUM is for.
   *
   * jsdom does no layout, so neither of those is observable as a pixel. What
   * IS observable is the ancestry, and the ancestry is the mechanism: between
   * the header and the root there must be no second scrollport, or the pin
   * goes to the wrong box again. That is what this asserts, and it is why the
   * case above cannot be the only one.
   */
  it('scopes the header to the page scroller rather than a box of its own', () => {
    data = { ...BASE, sections: [section()], coreSections: ['thesis'], caseWrittenAt: daysAgo(400) }
    const { container } = render(
      <AssetWorkspacePane asset={asset} why={{ headline: 'Stale', reason: null }} />,
    )
    const root = container.querySelector('[data-testid="asset-workspace"]')!
    const header = screen.getByText('AAPL').closest('[class*="sticky"]')!
    expect(root.contains(header)).toBe(true)

    // Walk the chain the browser walks, header up to and including the root.
    const chain: Element[] = []
    for (let el: Element | null = header; el; el = el.parentElement) {
      chain.push(el)
      if (el === root) break
    }
    expect(chain[chain.length - 1]).toBe(root)
    for (const el of chain) {
      expect(el.className).not.toMatch(/\boverflow-(y-)?(auto|scroll)\b/)
    }

    /* The containing block must be allowed to outgrow the scrollport, so the
       header stays pinned for the whole page and not just its first screen. */
    const classes = root.className.split(/\s+/)
    expect(classes).not.toContain('h-full')
    expect(classes).toContain('min-h-full')
  })

  /**
   * ── And the loading state, which had the same fault with no symptom ─────
   *
   * `Skeleton` carried the identical `h-full overflow-y-auto`. It has no
   * header to strand, so nothing looked wrong -- but it is a second
   * scrollport inside the real one for as long as the fetch takes, which
   * means the reader's wheel can land on the wrong box and the loaded page
   * then replaces a scrolled inner element with an unscrolled outer one.
   *
   * Asserted with the SAME chain walk as the loaded page, not a weaker check
   * on the class string, because the question is identical: does anything
   * between this subtree and its scroller claim to scroll?
   */
  it('gives the loading state the same ground, with no scrollport of its own', () => {
    loading = true
    const { container } = render(
      <AssetWorkspacePane asset={asset} why={{ headline: 'Stale', reason: null }} />,
    )
    const ground = container.firstElementChild as HTMLElement
    expect(ground).not.toBeNull()
    // It IS the skeleton and not the loaded page, or this asserts the wrong box.
    expect(container.querySelector('[data-testid="asset-workspace"]')).toBeNull()
    expect(ground.querySelector('.animate-pulse')).not.toBeNull()

    for (const el of [ground, ...Array.from(ground.querySelectorAll('*'))]) {
      expect(el.className.toString()).not.toMatch(/\boverflow-(y-)?(auto|scroll)\b/)
    }
    const classes = ground.className.split(/\s+/)
    expect(classes).not.toContain('h-full')
    expect(classes).toContain('min-h-full')
  })
})
