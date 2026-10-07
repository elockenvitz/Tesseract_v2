/**
 * The expanded list row, state by state.
 *
 * Two rules carry most of the design and both are easy to regress, so both are
 * pinned here:
 *
 *   1. The orientation strip shows only what EXISTS. A thin case must not read
 *      as a broken one, so an absent price, position, rating or target renders
 *      nothing at all rather than a dash. Asserting the happy path alone would
 *      pass against a strip full of placeholders.
 *
 *   2. The five questions are the information ARCHITECTURE, not headings. A
 *      literal "What's changed?" title is a regression, so the absence of
 *      those strings is asserted directly.
 *
 * `MobileListRows` renders this same component without the `coverage` prop, so
 * the no-coverage case is a real shipping configuration rather than a defensive
 * test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const hooks = vi.hoisted(() => ({
  workspace: {
    sections: [] as any[],
    evidence: [] as any[],
    caseWrittenAt: null as string | null,
    coreSections: [] as string[],
    history: [] as any[],
    spot: null as number | null,
    // `CurrentLadder | null` in the real shape; `any` here so a test can hand
    // in a ladder without restating the whole interface.
    ladder: null as any,
    target: null as number | null,
    positions: [] as any[],
    liveIdeas: [] as any[],
    decisions: [] as any[],
  },
  ratings: [] as any[],
  scales: [] as any[],
  updates: [] as any[],
  /** Everything `saveRating` was called with, in order. */
  ratingWrites: [] as any[],
  /** Every `thesis.reviewed` outcome recorded, in order. */
  reviews: [] as any[],
  reviewDone: false,
  /** Everything `saveContribution` was called with, in order. */
  caseWrites: [] as any[],
  workspaceLoading: false,
}))

vi.mock('../../../hooks/useAssetWorkspace', () => ({
  useAssetWorkspace: () => ({ data: hooks.workspace, isLoading: hooks.workspaceLoading, error: null }),
}))
vi.mock('../../../hooks/useAnalystRatings', () => ({
  useAnalystRatings: () => ({
    ratings: hooks.ratings,
    // The canonical writer, recorded rather than performed. What matters to
    // this file is the ARGUMENTS — a rating written against the wrong scale is
    // the defect worth pinning, and it is invisible if the call is swallowed.
    saveRating: { mutate: (v: any) => hooks.ratingWrites.push(v), isPending: false },
  }),
  useRatingScales: () => ({ scales: hooks.scales }),
}))
vi.mock('../../../hooks/useContributions', () => ({
  useContributions: () => ({
    // Canonical case-text writer, recorded rather than performed. The
    // arguments matter: a save with the wrong sectionKey silently writes the
    // thesis over "where we differ".
    saveContribution: {
      mutateAsync: async (v: any) => { hooks.caseWrites.push(v) },
      isPending: false,
    },
  }),
}))
vi.mock('../../../hooks/useThesisReview', () => ({
  useRecordThesisReview: () => ({
    record: (outcome: string) => hooks.reviews.push(outcome),
    isPending: false,
    isDone: hooks.reviewDone,
    error: null,
  }),
}))
vi.mock('../../../hooks/lists/useUpdateListItem', () => ({
  useUpdateListItem: () => ({ mutate: (v: any) => hooks.updates.push(v) }),
}))
// The three list-scoped cells own their own data and popovers; this file is
// about the expansion's composition, not theirs.
vi.mock('../ListAssigneeCell', () => ({ ListAssigneeCell: () => <div data-testid="assignee" /> }))
vi.mock('../ListStatusCell', () => ({ ListStatusCell: () => <div data-testid="status" /> }))
vi.mock('../ListTagsCell', () => ({ ListTagsCell: () => <div data-testid="tags" /> }))

import { ListRowExpansion } from '../ListRowExpansion'
import { SECTION_LABEL } from '../../../lib/desktop-research/model'
import type { ListRowSignal } from '../../../hooks/lists/useListRowSignals'

const asset = { id: 'a-aapl', symbol: 'AAPL', company_name: 'Apple Inc.' }

/** A signal that knows nothing — the batch's own "unknown asset" value. */
const EMPTY_SIGNAL: ListRowSignal = {
  state: null, subject: null, weightPct: null, closes: null,
  bookName: null, bookCount: 0,
  ratingValue: null, ratingColor: null, conviction: null, targetPrice: null,
  work: { tier: 'clear', label: '', count: 0, secondary: null },
  idea: null,
}

const section = (key: string, content: string, authorName = 'Eric L') => ({
  section: key, content, supportingDetail: null,
  updatedAt: '2026-09-01T00:00:00Z', authorName,
})

const evidence = (over: Partial<Record<string, unknown>> = {}) => ({
  id: Math.random().toString(36).slice(2),
  title: 'Q3 print beat',
  content: 'body',
  createdAt: '2026-10-01T00:00:00Z',
  authorName: 'Dana',
  isShared: true,
  isNewSinceReview: false,
  ...over,
})

function renderRow(props: Record<string, unknown> = {}) {
  return render(
    <ListRowExpansion
      listId="l-1"
      rowId="r-1"
      asset={asset}
      canEdit
      {...(props as any)}
    />,
  )
}

/**
 * Open the row the way a reader would: by clicking a field.
 *
 * Passing `entryColumnId` rather than clicking a tab is deliberate — it
 * exercises the contract the table actually uses, so a broken column→mode map
 * fails these tests instead of only failing in the browser.
 */
const openFrom = (columnId: string, props: Record<string, unknown> = {}) =>
  renderRow({ entryColumnId: columnId, ...props })

const currentMode = () =>
  screen.getByTestId('list-row-expansion').getAttribute('data-mode')

beforeEach(() => {
  hooks.workspace = {
    sections: [], evidence: [], caseWrittenAt: null, coreSections: [],
    history: [], spot: null, ladder: null as any, target: null,
    positions: [], liveIdeas: [], decisions: [],
  }
  hooks.ratings = []
  hooks.scales = []
  hooks.updates = []
  hooks.ratingWrites = []
  hooks.reviews = []
  hooks.reviewDone = false
  hooks.caseWrites = []
  hooks.workspaceLoading = false
})

describe('loading is not an answer about the security', () => {
  it('claims nothing while the workspace is still loading', () => {
    hooks.workspaceLoading = true
    renderRow({ onOpenAsset: () => {}, onCreateTradeIdea: () => {} })
    expect(screen.getByTestId('mode-skeleton')).toBeInTheDocument()
    // Every one of these is a CLAIM. Saying it before the answer is known is
    // worse than saying nothing, and each used to flash on every row open.
    for (const lie of [
      'No case written yet.', 'No thesis on file', 'Not held in any book.',
      'No valuation on file.', 'Nothing outstanding',
    ]) {
      expect(screen.queryByText(lie)).not.toBeInTheDocument()
    }
  })

  it('proposes no action from data it has not read', () => {
    hooks.workspaceLoading = true
    renderRow({ onOpenAsset: () => {}, onCreateTradeIdea: () => {} })
    expect(screen.queryByText('Write the case')).not.toBeInTheDocument()
    expect(screen.queryByText('Start an idea')).not.toBeInTheDocument()
    // The way into the full case is state-independent, so it stays.
    expect(screen.getByText('Open full case')).toBeInTheDocument()
  })

  it('keeps the mode switch stable from the first frame', () => {
    // The list-wide signal already knows the weight and target for every name,
    // so Position and Valuation must not pop in once the workspace lands —
    // that moves the tab the reader is aiming at.
    hooks.workspaceLoading = true
    renderRow({ signal: { ...EMPTY_SIGNAL, weightPct: 4.2, targetPrice: 210, closes: [1, 2, 3] } })
    for (const name of ['Overview', 'Market', 'Case', 'Valuation', 'Position', 'Work']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument()
    }
  })

  it('shows the real content once loaded', () => {
    hooks.workspace.sections = [section('thesis', 'Services mix.')]
    renderRow()
    expect(screen.queryByTestId('mode-skeleton')).not.toBeInTheDocument()
    expect(screen.getByText(/Services mix/)).toBeInTheDocument()
  })
})

describe('the clicked field decides the mode', () => {
  const full = () => {
    hooks.workspace.spot = 170.5
    hooks.workspace.target = 200
    hooks.workspace.positions = [
      { portfolioId: 'p1', portfolioName: 'Tech Growth', shares: 10490, price: 170.5,
        marketValue: 1788545, weightPct: 5.14, avgCost: null, unrealisedGain: null,
        unrealisedPct: null, asOf: null },
    ]
    hooks.workspace.sections = [section('thesis', 'Services mix.')]
  }

  it.each([
    ['ticker', 'overview'],
    ['companyName', 'overview'],
    ['price', 'market'],
    ['change', 'market'],
    ['list_market', 'market'],
    ['list_view', 'case'],
    ['list_valuation', 'valuation'],
    ['list_exposure', 'position'],
    ['list_work', 'work'],
  ])('a click on %s opens %s', (columnId, expected) => {
    full()
    openFrom(columnId, { signal: { ...EMPTY_SIGNAL, closes: [100, 101, 102] } })
    expect(currentMode()).toBe(expected)
  })

  it('opens Overview when the row was opened from the chevron', () => {
    full()
    renderRow()
    expect(currentMode()).toBe('overview')
  })

  it('re-enters on the newly clicked field while the row stays open', () => {
    full()
    const { rerender } = openFrom('list_valuation')
    expect(currentMode()).toBe('valuation')
    // The table hands in a new entryColumnId — the reader restating intent on
    // a row that is already open.
    rerender(
      <ListRowExpansion listId="l-1" rowId="r-1" asset={asset} canEdit entryColumnId="list_exposure" />,
    )
    expect(currentMode()).toBe('position')
  })

  it('offers no mode the security cannot answer', () => {
    // Nothing held, no prices, no target.
    renderRow()
    expect(screen.queryByRole('tab', { name: 'Position' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Market' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Valuation' })).not.toBeInTheDocument()
    // These three always mean something — an unwritten case and unstarted work
    // are exactly what a list is for.
    for (const name of ['Overview', 'Case', 'Work']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument()
    }
  })

  it('falls back to Overview rather than a blank canvas', () => {
    // Opened on Position, but this name is not held.
    openFrom('list_exposure')
    expect(currentMode()).toBe('overview')
  })

  it('lets the reader move between modes without closing the row', async () => {
    full()
    openFrom('list_work')
    expect(currentMode()).toBe('work')
    await userEvent.click(screen.getByRole('tab', { name: 'Overview' }))
    expect(currentMode()).toBe('overview')
    expect(screen.getByTestId('list-row-expansion')).toBeInTheDocument()
  })
})

describe('Overview shows only what exists', () => {
  it('renders price, position, rating, target and upside when all are present', () => {
    hooks.workspace.spot = 170.5
    hooks.workspace.target = 200
    hooks.workspace.positions = [
      { portfolioId: 'p1', portfolioName: 'Tech Growth', shares: 10490, price: 170.5,
        marketValue: 1788545, weightPct: 5.14, avgCost: null, unrealisedGain: null,
        unrealisedPct: null, asOf: null },
    ]
    hooks.ratings = [{ id: 'r1', rating_value: 'Buy', rating_scale_id: 's1', conviction: 'high', is_official: true, updated_at: '2026-10-01' }]
    hooks.scales = [{ id: 's1', values: [{ value: 'Buy', label: 'Buy', color: '#10b981', sort: 1 }] }]

    renderRow()
    expect(screen.getByText('$170.50')).toBeInTheDocument()
    expect(screen.getByText('5.14%')).toBeInTheDocument()
    expect(screen.getByText('Buy')).toBeInTheDocument()
    // Target and its upside sit inside "What we believe", beside the view —
    // they are the claim, not a separate metrics strip.
    expect(screen.getByText('$200.00')).toBeInTheDocument()
    // (200 - 170.5) / 170.5 = +17.3%
    expect(screen.getByText('+17.3%')).toBeInTheDocument()
    expect(screen.getByText('What we believe')).toBeInTheDocument()
  })

  it('omits facts entirely when the data is absent — no dashes, no placeholders', () => {
    renderRow()
    for (const label of ['Price', 'Position', 'View', 'Target', 'Upside']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument()
    }
  })

  it('shows shares when a position exists but its weight is unknowable', () => {
    // `weightPct` is deliberately null when the book's value cannot be derived.
    hooks.workspace.positions = [
      { portfolioId: 'p1', portfolioName: 'Tech Growth', shares: 1200, price: 10,
        marketValue: 12000, weightPct: null, avgCost: null, unrealisedGain: null,
        unrealisedPct: null, asOf: null },
    ]
    renderRow()
    expect(screen.getByText('1,200 sh')).toBeInTheDocument()
  })

  it('marks negative upside as negative', () => {
    hooks.workspace.spot = 200
    hooks.workspace.target = 180
    renderRow()
    // Direction is carried by colour on the figure it belongs to, which is the
    // one place colour is allowed to mean something on this surface.
    expect(screen.getByText('-10.0%').className).toMatch(/rose/)
  })

  it('prefers the official rating over a more recent unofficial one', () => {
    hooks.ratings = [
      { id: 'r-new', rating_value: 'Hold', rating_scale_id: 's1', conviction: 'low', is_official: false, updated_at: '2026-10-05' },
      { id: 'r-off', rating_value: 'Buy', rating_scale_id: 's1', conviction: 'high', is_official: true, updated_at: '2026-01-01' },
    ]
    hooks.scales = [{ id: 's1', values: [{ value: 'Buy', color: '#10b981' }, { value: 'Hold', color: '#f59e0b' }] }]
    // Case mode, where the picker lives — scoped to the DISPLAY, because the
    // rating is also an <option> and an unscoped query would pass even if the
    // pill never rendered.
    openFrom('list_view')
    const display = within(screen.getByTestId('row-rating-display'))
    expect(display.getByText('Buy')).toBeInTheDocument()
    expect(display.queryByText('Hold')).not.toBeInTheDocument()
  })
})

describe('rating and conviction write through the canonical path', () => {
  it('writes against the scale the existing rating already uses', async () => {
    hooks.ratings = [{ id: 'r1', rating_value: 'Hold', rating_scale_id: 's-legacy', conviction: 'low', is_official: true, updated_at: '2026-10-01' }]
    hooks.scales = [
      { id: 's-default', is_default: true, values: [{ value: 'Overweight' }] },
      { id: 's-legacy', values: [{ value: 'Hold' }, { value: 'Buy' }] },
    ]
    openFrom('list_view')
    await userEvent.selectOptions(screen.getByRole('combobox'), 'Buy')
    // Not the org default — a rating written against the wrong scale produces a
    // value string that matches no configured value and silently drops out of
    // every colour and consensus read.
    expect(hooks.ratingWrites).toEqual([
      { ratingValue: 'Buy', ratingScaleId: 's-legacy', conviction: 'low' },
    ])
  })

  it('falls back to the organisation default when nothing is rated yet', async () => {
    hooks.scales = [
      { id: 's-other', values: [{ value: 'X' }] },
      { id: 's-default', is_default: true, values: [{ value: 'Overweight' }] },
    ]
    openFrom('list_view')
    await userEvent.selectOptions(screen.getByRole('combobox'), 'Overweight')
    expect(hooks.ratingWrites).toEqual([
      { ratingValue: 'Overweight', ratingScaleId: 's-default', conviction: null },
    ])
  })

  it('keeps the rating value when only conviction changes', async () => {
    hooks.ratings = [{ id: 'r1', rating_value: 'Buy', rating_scale_id: 's1', conviction: 'low', is_official: true, updated_at: '2026-10-01' }]
    hooks.scales = [{ id: 's1', values: [{ value: 'Buy' }] }]
    openFrom('list_view')
    await userEvent.click(screen.getByLabelText('Set high conviction'))
    expect(hooks.ratingWrites).toEqual([
      { ratingValue: 'Buy', ratingScaleId: 's1', conviction: 'high' },
    ])
  })

  it('offers no conviction control until something is rated', () => {
    hooks.scales = [{ id: 's1', is_default: true, values: [{ value: 'Buy' }] }]
    openFrom('list_view')
    expect(screen.queryByLabelText('Set high conviction')).not.toBeInTheDocument()
  })
})

describe('Case mode writes case text through the canonical writer', () => {
  const scales = () => { hooks.scales = [{ id: 's1', is_default: true, values: [{ value: 'Buy' }] }] }

  it('offers all three core sections, including risks', () => {
    scales()
    hooks.workspace.sections = [section('thesis', 'Services mix.')]
    openFrom('list_view')
    // Overview deliberately shows two; the Case mode is where the whole case
    // lives, so withholding risks here would make it unreachable from a list.
    expect(screen.getByText('Thesis')).toBeInTheDocument()
    expect(screen.getByText(SECTION_LABEL.where_different)).toBeInTheDocument()
    expect(screen.getByText(SECTION_LABEL.risks_to_thesis)).toBeInTheDocument()
  })

  it('saves under the section that was edited', async () => {
    scales()
    hooks.workspace.sections = [section('thesis', 'Old thesis.')]
    openFrom('list_view')
    await userEvent.click(screen.getByLabelText('Edit Thesis'))
    const box = screen.getByRole('textbox')
    await userEvent.clear(box)
    await userEvent.type(box, 'New thesis.')
    await userEvent.tab()
    expect(hooks.caseWrites).toEqual([{ content: 'New thesis.', sectionKey: 'thesis' }])
  })

  it('does not write when the text was not changed', async () => {
    scales()
    hooks.workspace.sections = [section('thesis', 'Unchanged.')]
    openFrom('list_view')
    await userEvent.click(screen.getByLabelText('Edit Thesis'))
    await userEvent.tab()
    // A stray focus must not create a contribution revision.
    expect(hooks.caseWrites).toEqual([])
  })

  it('invites writing a section that does not exist yet', () => {
    scales()
    openFrom('list_view')
    expect(screen.getByText('Write thesis')).toBeInTheDocument()
  })
})

describe('reviewing evidence is recorded, not just linked', () => {
  const unread = () => {
    hooks.workspace.evidence = [evidence({ isNewSinceReview: true })]
    hooks.workspace.sections = [section('thesis', 'Services mix.')]
  }

  it('offers the three verdicts the research surface offers', () => {
    unread()
    renderRow({ onOpenAsset: () => {} })
    for (const label of ['Still holds', 'Changed', 'Needs work']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('records the verdict through the canonical thesis.reviewed writer', async () => {
    unread()
    renderRow({ onOpenAsset: () => {} })
    await userEvent.click(screen.getByText('Still holds'))
    expect(hooks.reviews).toEqual(['holds'])
  })

  it('collapses to a confirmation once recorded, so a second verdict is not invited', () => {
    unread()
    hooks.reviewDone = true
    renderRow({ onOpenAsset: () => {} })
    expect(screen.getByText('Review recorded')).toBeInTheDocument()
    expect(screen.queryByText('Still holds')).not.toBeInTheDocument()
  })
})

describe('Overview synthesises the three questions', () => {
  it('names the three bands, in order', () => {
    /*
     * The bands ARE the structure. Overview used to be a metrics strip, a
     * thesis, and a rail of list metadata, which gave owner/status/due/note
     * more weight than the position and the open idea.
     */
    hooks.workspace.sections = [section('thesis', 'Services mix is underappreciated.')]
    const { container } = renderRow()
    const text = container.textContent ?? ''
    expect(text.indexOf('What we believe')).toBeGreaterThanOrEqual(0)
    expect(text.indexOf('What we believe')).toBeLessThan(text.indexOf("What's happening"))
    expect(text.indexOf("What's happening")).toBeLessThan(text.indexOf("What we're doing"))
  })

  it('leads the belief band with the thesis and its author', () => {
    hooks.workspace.sections = [
      section('thesis', 'Services mix is underappreciated.'),
      section('where_different', 'Street models hardware cyclicality only.', 'Dana R'),
    ]
    renderRow()
    expect(screen.getByText(/Services mix is underappreciated/)).toBeInTheDocument()
    // The lead section's author; the rest of the case is one tab away.
    expect(screen.getByText('Eric L')).toBeInTheDocument()
  })

  it('puts what changed in its own band, unreviewed first', () => {
    hooks.workspace.caseWrittenAt = '2026-09-01T00:00:00Z'
    hooks.workspace.sections = [section('thesis', 'Services mix.')]
    hooks.workspace.evidence = [
      evidence({ title: 'Older note', createdAt: '2026-09-20T00:00:00Z', isNewSinceReview: false }),
      evidence({ title: 'New since review', createdAt: '2026-09-10T00:00:00Z', isNewSinceReview: true }),
    ]
    renderRow()
    const titles = screen.getAllByText(/Older note|New since review/).map(n => n.textContent)
    // Unreviewed leads, even though it is the older of the two.
    expect(titles[0]).toBe('New since review')
  })

  it('says nothing is new rather than leaving the band blank', () => {
    hooks.workspace.sections = [section('thesis', 'Services mix.')]
    renderRow()
    expect(screen.getByText('Nothing new since the case was written.')).toBeInTheDocument()
  })

  it('shows only the leading section, leaving the rest to Case mode', () => {
    hooks.workspace.sections = [
      section('thesis', 'A view.'),
      section('where_different', 'A differentiator.'),
      section('risks_to_thesis', 'China exposure.'),
    ]
    renderRow()
    // Overview orients; it is not the whole case. Risks are reachable one tab
    // away rather than crammed into a fixed-height summary.
    expect(screen.queryByText(SECTION_LABEL.risks_to_thesis)).not.toBeInTheDocument()
  })

  it('says so plainly when no case is written', () => {
    renderRow()
    expect(screen.getByText('No case written yet.')).toBeInTheDocument()
  })

  it('ignores a section that exists but is blank', () => {
    hooks.workspace.sections = [section('thesis', '   ')]
    renderRow()
    expect(screen.getByText('No case written yet.')).toBeInTheDocument()
  })
})

describe('Work mode launches the workflow the signal names', () => {
  it('shows the unreviewed evidence itself, newest intent first', () => {
    hooks.workspace.caseWrittenAt = '2026-09-01T00:00:00Z'
    hooks.workspace.sections = [section('thesis', 'A view.')]
    hooks.workspace.evidence = [
      evidence({ title: 'Older note', createdAt: '2026-09-20T00:00:00Z', isNewSinceReview: false }),
      evidence({ title: 'New since review', createdAt: '2026-09-10T00:00:00Z', isNewSinceReview: true }),
    ]
    openFrom('list_work')
    expect(currentMode()).toBe('work')
    expect(screen.getByText('1 new since the case was written')).toBeInTheDocument()
    // Only the unreviewed items — the reviewed one is not what this mode is for.
    expect(screen.getByText('New since review')).toBeInTheDocument()
    expect(screen.queryByText('Older note')).not.toBeInTheDocument()
  })

  it('offers the verdict next to the evidence it is about', async () => {
    hooks.workspace.sections = [section('thesis', 'A view.')]
    hooks.workspace.evidence = [evidence({ isNewSinceReview: true })]
    openFrom('list_work')
    expect(screen.getByText('Does the case still hold?')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Still holds'))
    expect(hooks.reviews).toEqual(['holds'])
  })

  it('routes an unwritten case to writing it, in-row', async () => {
    hooks.scales = [{ id: 's1', is_default: true, values: [{ value: 'Buy' }] }]
    openFrom('list_work')
    expect(screen.getByText('No thesis on file')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Write the case/ }))
    // Stays in the row and switches mode rather than navigating away.
    expect(currentMode()).toBe('case')
  })

  it('shows the live idea as the open work', () => {
    hooks.workspace.sections = [section('thesis', 'A view.')]
    hooks.workspace.liveIdeas = [
      { id: 'i1', action: 'buy', stage: 'deciding', rationale: 'Because.', portfolioName: 'Tech Growth' },
    ]
    openFrom('list_work')
    expect(screen.getByText('BUY')).toBeInTheDocument()
    // The desk's word for the stage, not the enum value.
    expect(screen.getByText('Deciding')).toBeInTheDocument()
    expect(screen.getByText('Tech Growth')).toBeInTheDocument()
    expect(screen.getByText('Because.')).toBeInTheDocument()
  })

  it('does not offer to advance a stage or act on a recommendation', () => {
    hooks.workspace.sections = [section('thesis', 'A view.')]
    hooks.workspace.liveIdeas = [
      { id: 'i1', action: 'buy', stage: 'deciding', rationale: null, portfolioName: null },
    ]
    openFrom('list_work', { onOpenAsset: () => {} })
    // Both are gated on things a row cannot collect — a sizing decision, a
    // rationale/thesis gate, recorded decision evidence. A row that offered
    // them would be a second, weaker writer.
    expect(screen.queryByText(/Advance|Accept|Approve|Reject/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Continue the idea/ })).toBeInTheDocument()
  })

  it('offers the verdict for a case that is merely due a look', () => {
    hooks.workspace.sections = [section('thesis', 'A view.')]
    hooks.workspace.caseWrittenAt = '2026-01-01T00:00:00Z'
    openFrom('list_work', { signal: { ...EMPTY_SIGNAL, state: 'stale' } })
    expect(screen.getByText('Review due')).toBeInTheDocument()
    expect(screen.getByText('Still holds')).toBeInTheDocument()
  })

  it('says plainly when nothing is outstanding', () => {
    hooks.workspace.sections = [section('thesis', 'A view.')]
    openFrom('list_work', { signal: { ...EMPTY_SIGNAL, state: 'current' }, onCreateTradeIdea: () => {} })
    expect(screen.getByText('Nothing outstanding')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Start an idea/ })).toBeInTheDocument()
  })
})

describe('Position and Valuation modes', () => {
  it('lists every book holding it, largest weight first', () => {
    hooks.workspace.positions = [
      { portfolioId: 'p1', portfolioName: 'Small Book', shares: 100, weightPct: 0.4, marketValue: 1000, unrealisedPct: -3.2 },
      { portfolioId: 'p2', portfolioName: 'Big Book', shares: 9000, weightPct: 6.1, marketValue: 90000, unrealisedPct: 12.5 },
    ]
    openFrom('list_exposure')
    expect(currentMode()).toBe('position')
    const names = screen.getAllByText(/Big Book|Small Book/).map(n => n.textContent)
    expect(names[0]).toBe('Big Book')
    // Twice on purpose: once as the headline weight, once in the book rows.
    expect(screen.getAllByText('6.10%').length).toBe(2)
    expect(screen.getByText('Largest weight')).toBeInTheDocument()
    expect(screen.getByText('+12.5%')).toBeInTheDocument()
  })

  it('names the scenarios the desk configured, not Bear/Base/Bull', () => {
    hooks.workspace.spot = 100
    hooks.workspace.target = 130
    hooks.workspace.ladder = {
      assetId: 'a-aapl', symbol: 'AAPL', companyName: null, valid: true, reason: '',
      updatedAt: '2026-10-01T00:00:00Z',
      cases: [
        { id: 'c1', scenarioId: 's1', name: 'Downside', price: 80, probability: 0.25, timeframe: null, reasoning: null, userId: null },
        { id: 'c2', scenarioId: 's2', name: 'Street beat', price: 130, probability: 0.5, timeframe: null, reasoning: null, userId: null },
      ],
    }
    openFrom('list_valuation')
    expect(currentMode()).toBe('valuation')
    expect(screen.getByText('Street beat')).toBeInTheDocument()
    expect(screen.getByText('Downside')).toBeInTheDocument()
    // Cheapest rung first, and upside measured against spot.
    expect(screen.getByText('-20.0%')).toBeInTheDocument()
  })

  it('does not offer to write a price target from the row', () => {
    hooks.workspace.spot = 100
    hooks.workspace.target = 130
    openFrom('list_valuation', { onOpenAsset: () => {} })
    // `savePriceTarget` needs a resolved scenario, which a row cannot pick
    // honestly — so this links into the case instead of writing.
    expect(screen.getByRole('button', { name: /Set a target in the case/ })).toBeInTheDocument()
  })
})

describe('ownership and list fields stay reachable', () => {
  it('shows the active idea in Overview too', () => {
    hooks.workspace.liveIdeas = [
      { id: 'i1', action: 'buy', stage: 'deciding', rationale: null, portfolioName: 'Tech Growth' },
    ]
    renderRow()
    // One figure, not an action label and a stage chip: an open idea is one
    // fact about the security.
    expect(screen.getByText('Open idea')).toBeInTheDocument()
    expect(screen.getByText('BUY · deciding')).toBeInTheDocument()
  })

  it('shows no Active fact when there is no idea', () => {
    renderRow()
    expect(screen.queryByText('Active')).not.toBeInTheDocument()
  })

  it('shows coverage when the table passed it', () => {
    renderRow({ coverage: [{ analyst: 'Dana R', team: 'Tech', isLead: true }] })
    expect(screen.getByText('Dana R')).toBeInTheDocument()
    expect(screen.getByText('lead')).toBeInTheDocument()
  })

  it('renders without coverage — the mobile configuration', () => {
    renderRow()
    expect(screen.queryByText('Covered')).not.toBeInTheDocument()
    expect(screen.getByTestId('list-row-expansion')).toBeInTheDocument()
  })

  it('keeps the list-scoped controls', () => {
    renderRow()
    expect(screen.getByTestId('assignee')).toBeInTheDocument()
    expect(screen.getByTestId('status')).toBeInTheDocument()
    expect(screen.getByTestId('tags')).toBeInTheDocument()
    // The note lost its label when the list fields were compressed to one
    // quiet block — the placeholder carries the meaning now.
    expect(screen.getByPlaceholderText('Why this name is here…')).toBeInTheDocument()
  })
})

describe('one primary action, chosen from state', () => {
  const onOpenAsset = vi.fn()

  it('offers review when evidence is unread, and says how much', () => {
    hooks.workspace.evidence = [evidence({ isNewSinceReview: true }), evidence({ isNewSinceReview: true })]
    renderRow({ onOpenAsset })
    expect(screen.getByText('2 new · does the case hold?')).toBeInTheDocument()
  })

  it('does not offer to start an idea when the caller cannot open the modal', () => {
    // `onCreateTradeIdea` is how `ListTab` opens its page-level modal. Without
    // it the button would be a dead control, so the state falls through.
    hooks.workspace.sections = [section('thesis', 'A view.')]
    renderRow({ onOpenAsset })
    expect(screen.queryByText('Start an idea')).not.toBeInTheDocument()
  })

  it('offers to start an idea on a written case with nothing live', async () => {
    const onCreateTradeIdea = vi.fn()
    hooks.workspace.sections = [section('thesis', 'A view.')]
    renderRow({ onOpenAsset, onCreateTradeIdea })
    await userEvent.click(screen.getByText('Start an idea'))
    // The asset id, so the page-level modal preselects this security.
    expect(onCreateTradeIdea).toHaveBeenCalledWith('a-aapl')
  })

  it('offers the idea when there is one and nothing unread', () => {
    hooks.workspace.sections = [section('thesis', 'A view.')]
    hooks.workspace.liveIdeas = [{ id: 'i1', action: 'buy', stage: null, rationale: null, portfolioName: null }]
    renderRow({ onOpenAsset })
    expect(screen.getByText('Open active idea')).toBeInTheDocument()
  })

  it('offers to write the case when there is none', () => {
    renderRow({ onOpenAsset })
    expect(screen.getByText('Write the case')).toBeInTheDocument()
  })

  it('offers no primary action when the case is written and nothing is pending', () => {
    hooks.workspace.sections = [section('thesis', 'A view.')]
    renderRow({ onOpenAsset })
    expect(screen.queryByText(/Review|Open active idea|Write the case/)).not.toBeInTheDocument()
    // The way into the full case is always there.
    expect(screen.getByText('Open full case')).toBeInTheDocument()
  })

  it('does not repeat the verdict in the footer while Work mode is showing it', () => {
    hooks.workspace.sections = [section('thesis', 'A view.')]
    hooks.workspace.evidence = [evidence({ isNewSinceReview: true })]
    openFrom('list_work')
    // One review group, not two.
    expect(screen.getAllByText('Still holds')).toHaveLength(1)
    expect(screen.queryByText(/does the case hold\?/)).not.toBeInTheDocument()
  })
})

describe('the five questions are architecture, not headings', () => {
  it('renders no question-shaped section titles', () => {
    hooks.workspace.sections = [section('thesis', 'A view.')]
    hooks.workspace.evidence = [evidence({ isNewSinceReview: true })]
    hooks.workspace.liveIdeas = [{ id: 'i1', action: 'buy', stage: null, rationale: null, portfolioName: null }]
    const { container } = renderRow({ coverage: [{ analyst: 'Dana R', team: 'Tech', isLead: false }] })
    const text = container.textContent ?? ''
    for (const q of [
      'What do we believe', "What's changed", 'What are we doing',
      'Who is involved', 'What can I do next',
    ]) {
      expect(text).not.toContain(q)
    }
  })
})

describe('the height contract', () => {
  it('animates contents, never height', () => {
    const { container } = renderRow()
    const root = container.querySelector('[data-testid="list-row-expansion"]')!
    const cls = root.className
    // Opacity + translate entrance, matching the chevron's 150ms.
    expect(cls).toContain('fade-in')
    expect(cls).toContain('duration-150')
    // A height/size transition here would fight the virtualiser, which sizes
    // expanded rows up front.
    expect(cls).not.toMatch(/transition-\[height\]|animate-height|transition-all/)
  })
})
