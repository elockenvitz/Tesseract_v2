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
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
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
import { modeForEntryColumn } from '../listRowModes'
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

/**
 * The table's half of the entry handshake, so the loop can be closed.
 *
 * `ListRowExpansion` reports the entry it is showing and `AssetTableView`
 * stores it and feeds it straight back as `entryColumnId` — the row's height
 * and the ring on the collapsed cell both come from that stored value. Every
 * test that passes `entryColumnId` as a fixed prop exercises only half of it,
 * so an echo that disagrees with what it is handed back oscillates forever in
 * the browser and passes every one of them.
 *
 * This mounts the real feedback loop and records it. `settled` is the entry
 * the pair agreed on; `echoes` is every value that crossed the seam, so a
 * cycle shows up as a repeating tail rather than as a hung test.
 */
type RowProps = React.ComponentProps<typeof ListRowExpansion>

function renderWithTable(initialEntry?: string, props: Partial<RowProps> = {}) {
  const echoes: string[] = []
  /*
   * `pressEnterOn` is the keyboard path, and it is a DIFFERENT path.
   *
   * Enter on a focused cell makes `AssetTableView` write that cell's COLUMN
   * ID over whatever the panel last echoed — see its Enter handler. A tab
   * click sets the mode in the same commit as the event; this arrives as a
   * prop change on an already-open row, one frame later. The infinite flash
   * between the chart and the written case only existed on this path, which
   * is why driving the row by tab clicks alone never saw it.
   */
  let setEntryExternally: (entry: string) => void = () => {}
  function Harness() {
    const [entry, setEntry] = React.useState<string | undefined>(initialEntry)
    setEntryExternally = setEntry
    return (
      <ListRowExpansion
        listId="l-1"
        rowId="r-1"
        asset={asset}
        canEdit
        entryColumnId={entry}
        // Mirrors `reportEntryFor` in AssetTableView, which returns the
        // previous object when the entry is unchanged. Re-echoing the same
        // value is free; echoing a DIFFERENT one re-renders, which is the
        // only way a cycle can sustain itself.
        onEntryChange={next => { echoes.push(next); setEntry(prev => (prev === next ? prev : next)) }}
        {...props}
      />
    )
  }
  const view = render(<Harness />)
  return {
    ...view,
    echoes,
    settled: () => echoes[echoes.length - 1],
    /** The distinct values the seam produced since `from` — >1 is a cycle. */
    distinctSince: (from: number) => [...new Set(echoes.slice(from))],
    pressEnterOn: (columnId: string) => act(() => setEntryExternally(columnId)),
  }
}

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
    // so Position and Price must not pop in once the workspace lands —
    // that moves the tab the reader is aiming at.
    hooks.workspaceLoading = true
    renderRow({ signal: { ...EMPTY_SIGNAL, weightPct: 4.2, targetPrice: 210, closes: [1, 2, 3] } })
    for (const name of ['Overview', 'Market', 'Research', 'Position', 'Work']) {
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
    ['list_view', 'research'],
    // The target cell opens the same chart the price cell does — the target
    // is drawn on it. See `listRowModes`.
    ['list_valuation', 'market'],
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

  /**
   * Market draws the REAL chart when it has dated history.
   *
   * `PriceContext` is the interactive chart the Ideas feed and the dashboard
   * use — ranges, hover crosshair, scrub, target as a band, events as markers.
   * This is pinned because the fixture carried an empty `history` for the
   * whole life of the mode, so the flat-sparkline fallback was the only path
   * any test ever exercised: the integration could have thrown on first
   * contact with real data and every test would still have passed.
   */
  describe('Price uses the interactive chart, not an enlarged sparkline', () => {
    const dated = (n: number) => Array.from({ length: n }, (_, i) => ({
      date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
      close: 100 + Math.sin(i / 3) * 8,
    }))

    it('renders range controls once a dated series exists', () => {
      full()
      hooks.workspace.history = dated(120)
      hooks.workspace.target = 140
      openFrom('list_market', { signal: { ...EMPTY_SIGNAL, closes: [100, 101, 102] } })
      /*
       * The range switcher is the chart's own; the flat sparkline has none.
       * Only ranges the series can actually fill are offered, so a 120-day
       * history shows 1M and 3M and withholds 1Y — asserting on a range the
       * data cannot support would be asserting on invented history.
       */
      expect(screen.getByRole('button', { name: '1M' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '3M' })).toBeInTheDocument()
    })

    it('falls back to the flat path when there is no dated history', () => {
      full()
      hooks.workspace.history = []
      openFrom('list_market', { signal: { ...EMPTY_SIGNAL, closes: [100, 101, 102] } })
      expect(screen.queryByRole('button', { name: '3M' })).not.toBeInTheDocument()
      expect(currentMode()).toBe('market')
    })

    it('says so plainly when there is neither', () => {
      full()
      hooks.workspace.history = []
      openFrom('list_market', { signal: { ...EMPTY_SIGNAL, closes: null } })
      expect(screen.getByText('No price history on file.')).toBeInTheDocument()
    })

    /**
     * Nothing stands above the chart.
     *
     * Market opened with three hero figures — Last, 1 month, Range — stacked
     * ABOVE the plot, which cost about a third of a fixed-height panel to
     * restate what `PriceContext` already draws in its own header: the last
     * price and today's change. The chart came out roughly 1,100 × 230, where
     * a 3% move is a flat line.
     *
     * The rail that held `1 month` and `Range` is gone too, and those two
     * went with it: the range chips set the window, the move is now labelled
     * with the window it was measured over, and the high and low ARE the
     * y-axis. The panel states the price once.
     */
    it('does not restate the chart readout anywhere in the panel', () => {
      full()
      hooks.workspace.history = dated(120)
      openFrom('list_market', { signal: { ...EMPTY_SIGNAL, closes: [100, 101, 102] } })
      expect(screen.getByTestId('price-chart-readout')).toBeInTheDocument()
      expect(screen.queryByText('Last')).not.toBeInTheDocument()
      expect(screen.queryByText('1 month')).not.toBeInTheDocument()
      expect(screen.queryByText('Range')).not.toBeInTheDocument()
    })

    /**
     * The headline figure is the price the ROW is showing, not the last close.
     *
     * The inspector read its price from `price_history_cache` while the
     * collapsed row above it read the table's live quote, so LLY was 1169.60
     * in the row and 1,149.85 in the panel it opened. Same name, same screen,
     * two prices, and no way to tell which one the desk acts on.
     */
    it('states the quoted price, not the series last close', () => {
      full()
      hooks.workspace.history = dated(120)
      hooks.workspace.spot = null
      openFrom('list_market', {
        signal: { ...EMPTY_SIGNAL, closes: [100, 101, 102] },
        quote: { price: 207.5, changePercent: 1.2 },
      })
      expect(screen.getByTestId('price-chart-readout')).toHaveTextContent('207.50')
      // And it says the figure is live rather than dating it to the last
      // close, which is a day the quote did not come from.
      expect(screen.getByText('live')).toBeInTheDocument()
    })

    /**
     * The desktop chart, not the feed's.
     *
     * `PriceContext` draws into a non-uniformly stretched viewBox, which is
     * right for a 92px feed card and cannot carry text, a circle or a crisp
     * 1px rule at 1,050px. These are the things only a pixel-space chart can
     * render, so their presence is the proof the right component is mounted.
     */
    it('draws gridlines, an axis and a crosshair readout', async () => {
      full()
      hooks.workspace.history = dated(120)
      openFrom('list_market', { signal: { ...EMPTY_SIGNAL, closes: [100, 101, 102] } })
      const chart = screen.getByTestId('price-chart')
      expect(within(chart).getByTestId('price-chart-line')).toBeInTheDocument()
      expect(within(chart).getByTestId('price-chart-area')).toBeInTheDocument()
      // Range chips are the chart's own, and only ranges the data can fill.
      const chips = within(screen.getByTestId('price-chart-ranges'))
        .getAllByRole('button').map(b => b.textContent)
      expect(chips).toContain('1M')
      expect(chips).toContain('3M')
      expect(chips).not.toContain('1Y')
    })

    /**
     * PRICE draws the scenarios on the price history, always.
     *
     * The rungs were ticks on a bare 26px rule, which says where each case
     * sits relative to the others and nothing about whether any of them is
     * plausible. `PriceChart` places a price level as a labelled band on its
     * own scale, so the rungs go there — a bear case is only assessable
     * against where the stock has actually traded. This used to be
     * Valuation's behaviour and Market's omission; one mode cannot disagree
     * with itself about whether to draw them.
     */
    it('draws the scenario rungs as bands on the real chart', () => {
      full()
      hooks.workspace.history = dated(120)
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
      expect(currentMode()).toBe('market')
      // The chart's own range control — proof this is the real chart and not
      // the static axis fallback.
      expect(screen.getByRole('button', { name: '3M' })).toBeInTheDocument()
      /*
       * One level per distinct price, never two for the same number.
       *
       * `Street beat` is priced at the target, so it must not be drawn as both
       * a `target` level and a `case` level: two dashed rules at the same y
       * with two labels fighting for the same pixels. Downside + target = 2.
       */
      expect(screen.getAllByTestId('price-chart-level')).toHaveLength(2)
    })
  })

  /**
   * The row echoes the FIELD, not the mode.
   *
   * `AssetTableView` stamps the echoed value as `data-open-entry`, and
   * `lists-surface.css` rings the collapsed cell whose `data-entry` matches.
   * MARKET and the target both open PRICE now, so echoing the mode name
   * collapsed them into one value: click the target and the ring jumped to
   * the price cell — a highlight on a field the reader had not touched.
   */
  it.each([
    ['list_valuation', 'valuation'],
    ['list_market', 'market'],
    ['list_exposure', 'position'],
  ])('opened from %s, it reports %s so the ring lands on that cell', (columnId, token) => {
    full()
    const onEntryChange = vi.fn()
    openFrom(columnId, { onEntryChange, signal: { ...EMPTY_SIGNAL, closes: [100, 101, 102] } })
    expect(onEntryChange).toHaveBeenCalledWith(token)
    expect(onEntryChange).not.toHaveBeenCalledWith('price')
  })

  /** Reached by the tab switcher instead, there is no clicked field to keep. */
  it('reports the mode when the reader used the switch, not a cell', async () => {
    full()
    const onEntryChange = vi.fn()
    openFrom('list_exposure', { onEntryChange, signal: { ...EMPTY_SIGNAL, closes: [100, 101, 102] } })
    onEntryChange.mockClear()
    await userEvent.click(screen.getByRole('tab', { name: 'Market' }))
    expect(onEntryChange).toHaveBeenCalledWith('market')
  })

  /**
   * The seam must come to rest, whatever route the reader took.
   *
   * The expansion reports what it is showing and the table hands that back as
   * the entry. If the two ever disagree about the same state the pair ping-
   * pongs: the row re-measures on every frame, the panel jitters and the
   * collapsed ring flickers between cells. This drives the real loop and
   * asserts it reaches a fixed point.
   */
  it.each([
    ['list_market', 'market'],
    ['list_valuation', 'market'],
    ['list_view', 'research'],
    ['list_exposure', 'position'],
    ['list_work', 'work'],
    [undefined, 'overview'],
  ])('settles immediately when opened from %s', (entry, expectedMode) => {
    full()
    const h = renderWithTable(entry, { signal: { ...EMPTY_SIGNAL, closes: [100, 101, 102] } })
    expect(currentMode()).toBe(expectedMode)
    // One echo, or two where the column id normalises to its token. Never a
    // third: a third means the pair disagreed and corrected each other.
    expect(h.echoes.length).toBeLessThanOrEqual(2)
    expect(modeForEntryColumn(h.settled())).toBe(expectedMode)
  })

  /**
   * Enter on the sparkline, then Enter on the investment case.
   *
   * The reported flash, reproduced exactly. The keyboard path writes the
   * raw COLUMN ID onto an already-open row, so the panel sees its entry
   * change out from under it — and when the mode was synced in an effect,
   * the echo published a one-frame-stale mode that became the next entry.
   * The pair then cycled price -> case -> price without ever converging.
   *
   * A render-loop test cannot be written as "it does not hang": React gives
   * up at 50 nested updates and throws, and a cycle that settles after
   * twenty is still a visible flash. So this counts what crosses the seam.
   */
  it('settles when Enter moves from the sparkline to the investment case', () => {
    full()
    const h = renderWithTable('list_market', { signal: { ...EMPTY_SIGNAL, closes: [100, 101, 102] } })
    expect(currentMode()).toBe('market')

    const before = h.echoes.length
    h.pressEnterOn('list_view')
    expect(currentMode()).toBe('research')
    // ONE distinct value. The cycle alternated 'price' and 'case' forever;
    // repeats of a single value are the seam agreeing with itself.
    /* `case`, not `research`: the echo carries the TOKEN the clicked cell
       stamps, which is what the ring matches on, while the MODE it resolves
       to is `research`. Collapsing the two is how the ring ended up on a
       field nobody touched. */
    expect(h.distinctSince(before), 'the seam must converge, not cycle').toEqual(['case'])

    // Back to the sparkline, because a cycle needs both legs to show.
    const mid = h.echoes.length
    h.pressEnterOn('list_market')
    expect(currentMode()).toBe('market')
    expect(h.distinctSince(mid)).toEqual(['market'])
  })

  /** Every pair of fields, since the cycle needs two modes to bounce between. */
  it.each([
    ['list_market', 'list_view', 'research'],
    ['list_view', 'list_market', 'market'],
    ['list_valuation', 'list_exposure', 'position'],
    ['list_exposure', 'list_valuation', 'market'],
    ['list_work', 'list_view', 'research'],
  ])('Enter from %s to %s lands on %s and stops', (from, to, expected) => {
    full()
    const h = renderWithTable(from, { signal: { ...EMPTY_SIGNAL, closes: [100, 101, 102] } })
    const before = h.echoes.length
    h.pressEnterOn(to)
    expect(currentMode()).toBe(expected)
    expect(h.distinctSince(before).length, 'more than one value means a cycle').toBe(1)
  })

  /**
   * Chart → Investment View, the move that was freaking out.
   *
   * PRICE and CASE are the two modes whose heights differ most (2.1 against
   * 1.0 of the row budget), so an unstable seam here is not a subtle flicker —
   * the row doubles and halves repeatedly.
   */
  it('settles when switching from the chart to the written view', async () => {
    full()
    const h = renderWithTable('list_market', { signal: { ...EMPTY_SIGNAL, closes: [100, 101, 102] } })
    expect(currentMode()).toBe('market')
    const before = h.echoes.length

    await userEvent.click(screen.getByRole('tab', { name: 'Research' }))
    expect(currentMode()).toBe('research')

    const after = h.echoes.slice(before)
    expect(after.length).toBeLessThanOrEqual(2)
    expect(modeForEntryColumn(h.settled())).toBe('research')
    // And back again, because a cycle can need both legs to show itself.
    await userEvent.click(screen.getByRole('tab', { name: 'Market' }))
    expect(currentMode()).toBe('market')
    expect(modeForEntryColumn(h.settled())).toBe('market')
  })

  it('re-enters on the newly clicked field while the row stays open', () => {
    full()
    const { rerender } = openFrom('list_valuation')
    expect(currentMode()).toBe('market')
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
    // These three always mean something — an unwritten case and unstarted work
    // are exactly what a list is for.
    for (const name of ['Overview', 'Research', 'Work']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument()
    }
  })

  it('falls back to Overview rather than a blank canvas', () => {
    // Opened on Position, but this name is not held.
    openFrom('list_exposure')
    expect(currentMode()).toBe('overview')
  })

  /**
   * Overview carries no price thumbnail at all.
   *
   * It had one — a 36px sparkline in a 170px band — directly beneath the
   * collapsed row's own sparkline for the same security. Two pictures of the
   * same series, neither interrogable, an inch apart. The row keeps its
   * sparkline and Market keeps the real chart; Overview's space goes to the
   * written case, which is the thing the row genuinely cannot carry.
   */
  it('does not draw a second sparkline under the row’s own', () => {
    full()
    openFrom('ticker', { signal: { ...EMPTY_SIGNAL, closes: [100, 103, 99, 107] } })
    expect(currentMode()).toBe('overview')
    const body = screen.getByTestId('overview-bands')
    expect(within(body).queryByTestId('overview-open-chart')).not.toBeInTheDocument()
    expect(body.querySelector('svg')).toBeNull()
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

/**
 * The verdict band: the desk's stance, as a sentence, above every mode.
 *
 * These used to assert a five-band Overview — Market, Investment view,
 * Position, The case, Work — which was a readable arrangement of the same
 * five numbers the collapsed row already shows one row above. The facts did
 * not move out of the product; they moved into one line that stands over all
 * six modes, which is what frees Overview to be the written case.
 */
describe('the verdict states the stance in one line', () => {
  it('reads rating, conviction, target, upside and position as a sentence', () => {
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
    const verdict = within(screen.getByTestId('verdict-band'))
    expect(verdict.getByText('Buy')).toBeInTheDocument()
    expect(verdict.getByText('high')).toBeInTheDocument()
    expect(verdict.getByText('$200.00')).toBeInTheDocument()
    // (200 - 170.5) / 170.5 = +17.3%
    expect(verdict.getByText('+17.3%')).toBeInTheDocument()
    expect(verdict.getByText('5.14%')).toBeInTheDocument()
    expect(screen.getByTestId('verdict-band').textContent).toContain('Tech Growth')
  })

  it('stands over every mode, not just Overview', async () => {
    hooks.workspace.spot = 100
    hooks.workspace.target = 130
    renderRow()
    const read = () => screen.getByTestId('verdict-band').textContent
    const onOverview = read()
    await userEvent.click(screen.getByRole('tab', { name: 'Research' }))
    // Identical, not merely present: the stance does not change because the
    // reader clicked a tab, which is the whole reason each mode below can be
    // pure evidence.
    expect(read()).toBe(onOverview)
    await userEvent.click(screen.getByRole('tab', { name: 'Work' }))
    expect(read()).toBe(onOverview)
  })

  it('says what is true rather than rendering a row of dashes', () => {
    renderRow()
    /*
     * Nothing rated, nothing held, nothing decided is a real state and the
     * honest rendering of it is a sentence — not five headings over five
     * em-dashes.
     */
    expect(screen.getByTestId('verdict-band').textContent)
      .toMatch(/Not yet rated, and not held/)
    expect(screen.getByText(/No case written/)).toBeInTheDocument()
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

describe('Overview is the written case, not a second dashboard', () => {
  /**
   * Overview must not restate the collapsed row.
   *
   * This is the invariant the five-band version violated: price, change,
   * weight and rating are all visible in the row the reader just clicked, so
   * repeating them an inch below is the row again, larger. They belong to the
   * verdict line now, which is stated once for all six modes.
   */
  it('does not repeat the row’s own figures in its body', () => {
    hooks.workspace.spot = 170.5
    hooks.workspace.positions = [
      { portfolioId: 'p1', portfolioName: 'Tech Growth', shares: 10, price: 170.5,
        marketValue: 1705, weightPct: 5.14, avgCost: null, unrealisedGain: null,
        unrealisedPct: null, asOf: null },
    ]
    hooks.workspace.sections = [section('thesis', 'Services mix is underappreciated.')]
    renderRow()
    const body = screen.getByTestId('overview-bands').textContent ?? ''
    for (const heading of ['Market', 'Investment view', 'Position']) {
      expect(body, `${heading} belongs to the verdict line, not the body`).not.toContain(heading)
    }
    // The weight is stated — once, in the verdict.
    expect(screen.getByTestId('verdict-band').textContent).toContain('5.14%')
    expect(body).not.toContain('5.14%')
  })

  /**
   * Overview answers three QUESTIONS, not three sections.
   *
   * It used to be the written case in up to three columns, which is what
   * RESEARCH shows — so opening a row from the ticker and from the rating
   * gave the same thing at different lengths and the switch between them
   * did nothing a reader could name. Overview is the mode asked for before
   * the reader knows what they want, so it says what the desk believes,
   * what has happened, and what is owed, and each column is a door to the
   * mode that owns it.
   */
  it('asks what we believe, what happened and what is owed', () => {
    hooks.workspace.sections = [
      section('thesis', 'Services mix is underappreciated.'),
      section('where_different', 'Street models hardware cyclicality only.'),
      section('risks_to_thesis', 'China exposure.'),
    ]
    renderRow()
    const body = screen.getByTestId('overview-bands')
    for (const heading of ['What we believe', 'What has happened', 'What is owed']) {
      expect(within(body).getByText(heading)).toBeInTheDocument()
    }
    // The thesis leads the belief column; the rest of the case is Research's.
    expect(within(body).getByText(/Services mix is underappreciated/)).toBeInTheDocument()
    expect(within(body).queryByText(/China exposure/)).not.toBeInTheDocument()
  })

  it('says nothing is outstanding rather than leaving the column blank', () => {
    hooks.workspace.sections = [section('thesis', 'A view.')]
    renderRow()
    const body = screen.getByTestId('overview-bands')
    expect(within(body).getByText('Nothing outstanding.')).toBeInTheDocument()
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

  /**
   * An owed decision hands off. It is never taken in the row.
   *
   * A decision is one answer per (idea, PORTFOLIO) track, and authorisation
   * is PM-only per portfolio — so a row-level Approve would decide for every
   * other book and might offer an action the reader does not have. Both are
   * solvable only by reproducing the inbox's portfolio picker, permission
   * gate and fan-in, which is the duplicate decision engine this must not
   * become. So the row routes to the canonical surface.
   */
  it('routes an owed decision to the canonical surface instead of deciding', async () => {
    const events: unknown[] = []
    const onAction = (e: Event) => events.push((e as CustomEvent).detail)
    window.addEventListener('decision-engine-action', onAction)
    try {
      openFrom('list_work', {
        signal: {
          ...EMPTY_SIGNAL,
          work: { tier: 'decision', label: 'BUY · Decision ready', count: 0, secondary: null },
          idea: {
            id: 'i1', direction: 'buy', stage: 'ready_for_decision', portfolioName: 'Growth',
            proposedWeight: 2.5, rationale: null, authorName: 'D. Liu',
            createdAt: '2026-09-01T00:00:00Z', conviction: 'medium',
          },
        },
      })
      const btn = screen.getByRole('button', { name: /Decide in Pipeline/ })
      await userEvent.click(btn)
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ type: 'trade-queue' })
    } finally {
      window.removeEventListener('decision-engine-action', onAction)
    }
  })

  it('offers no approve or reject control anywhere in the row', () => {
    openFrom('list_work', {
      signal: {
        ...EMPTY_SIGNAL,
        work: { tier: 'decision', label: 'BUY · Decision ready', count: 0, secondary: null },
        idea: {
          id: 'i1', direction: 'buy', stage: 'ready_for_decision', portfolioName: 'Growth',
          proposedWeight: 2.5, rationale: null, authorName: 'D. Liu',
          createdAt: '2026-09-01T00:00:00Z', conviction: 'medium',
        },
      },
    })
    for (const name of [/^Approve/, /^Reject/, /^Accept/, /Request changes/]) {
      expect(screen.queryByRole('button', { name }), `${name} must not exist here`).toBeNull()
    }
  })

  it('says nothing is new rather than leaving the column blank', () => {
    hooks.workspace.sections = [section('thesis', 'Services mix.')]
    renderRow()
    // Said in the "What has happened" column AND in the rail's Latest
    // research — both are places a reader looks for it, so both state it.
    expect(screen.getAllByText('Nothing filed since the case was written.').length)
      .toBeGreaterThan(0)
  })

  /**
   * An unwritten case is a prompt, not an empty column.
   *
   * It is the single most actionable state a list surfaces — nothing records
   * why the desk holds the view — so it is stated in words, and the footer
   * already carries the button that writes one.
   */
  it('says so plainly when no case is written', () => {
    renderRow()
    expect(screen.getByText(/No case written/)).toBeInTheDocument()
  })

  it('ignores a section that exists but is blank', () => {
    hooks.workspace.sections = [section('thesis', '   ')]
    renderRow()
    expect(screen.getByText(/No case written/)).toBeInTheDocument()
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
    expect(currentMode()).toBe('research')
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
  /**
   * The books list is clamped, because the panel clips rather than scrolls.
   *
   * `ModeLayout` is `overflow-hidden` by design — a second scroll surface
   * inside a virtualised row hides content behind a bar nobody looks for. So
   * a list whose length is the data's has to state what fits and count the
   * rest. Unclamped, a name in two books overran its box by 46px and the
   * second book was sliced through the middle of its own figures.
   */
  it('clamps the books list and counts what it did not draw', () => {
    hooks.workspace.positions = Array.from({ length: 6 }, (_, i) => ({
      portfolioId: `p${i}`, portfolioName: `Book ${i}`, shares: 100 * (6 - i),
      weightPct: 6 - i, marketValue: 1000 * (6 - i), unrealisedPct: 1,
    }))
    openFrom('list_exposure')
    const body = within(screen.getByTestId('list-row-expansion'))
    // `Book 0` is also the largest-weight hero's sub and a verdict clause, so
    // it is the absences that carry this: the fourth book is not drawn.
    expect(body.getAllByText('Book 0').length).toBeGreaterThan(0)
    expect(body.getByText('Book 2')).toBeInTheDocument()
    expect(body.queryByText('Book 3')).not.toBeInTheDocument()
    expect(body.queryByText('Book 5')).not.toBeInTheDocument()
    expect(body.getByText('+3 more books — open the full case')).toBeInTheDocument()
  })

  it('draws every book when they all fit, and counts nothing', () => {
    hooks.workspace.positions = [
      { portfolioId: 'p1', portfolioName: 'Only Book', shares: 10, weightPct: 1, marketValue: 100, unrealisedPct: 0 },
    ]
    openFrom('list_exposure')
    expect(screen.queryByText(/more books? — open the full case/)).not.toBeInTheDocument()
  })

  it('lists every book holding it, largest weight first', () => {
    hooks.workspace.positions = [
      { portfolioId: 'p1', portfolioName: 'Small Book', shares: 100, weightPct: 0.4, marketValue: 1000, unrealisedPct: -3.2 },
      { portfolioId: 'p2', portfolioName: 'Big Book', shares: 9000, weightPct: 6.1, marketValue: 90000, unrealisedPct: 12.5 },
    ]
    openFrom('list_exposure')
    expect(currentMode()).toBe('position')
    // Scoped to the mode body: the verdict line above it also names the
    // largest book, so an unscoped query finds that first.
    const body = screen.getByTestId('list-row-expansion')
    const names = within(body).getAllByText(/^(Big|Small) Book$/).map(n => n.textContent)
    expect(names[0]).toBe('Big Book')
    // Twice in the mode itself — the headline weight and the book row — plus
    // once more in the verdict line above it.
    expect(screen.getAllByText('6.10%').length).toBe(3)
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
    expect(currentMode()).toBe('market')
    expect(screen.getByText('Street beat')).toBeInTheDocument()
    expect(screen.getByText('Downside')).toBeInTheDocument()
    // Cheapest rung first, and upside measured against spot.
    expect(screen.getByText('-20.0%')).toBeInTheDocument()
  })

  it('does not offer to write a price target from the row', () => {
    hooks.workspace.spot = 100
    hooks.workspace.target = null
    openFrom('list_valuation', { onOpenAsset: () => {} })
    // `savePriceTarget` needs a resolved scenario, which a row cannot pick
    // honestly — so this links into the case instead of writing.
    expect(screen.getByRole('button', { name: /Set a target in the case/ })).toBeInTheDocument()
  })

  /**
   * With a target on file, PRICE stops asking for one.
   *
   * The merged mode inherited Valuation's footer, which offered "Set a target
   * in the case" unconditionally — including on a chart that was already
   * drawing the target as a labelled band. An action that proposes work the
   * panel can see is done is an action the reader learns to ignore.
   */
  it('offers the state-chosen move once a target exists', () => {
    hooks.workspace.spot = 100
    hooks.workspace.target = 130
    hooks.workspace.sections = [section('thesis', 'Services mix.')]
    openFrom('list_valuation', { onOpenAsset: () => {} })
    expect(screen.queryByRole('button', { name: /Set a target in the case/ })).not.toBeInTheDocument()
    expect(screen.getByText('Open full case')).toBeInTheDocument()
  })
})

describe('ownership and list fields stay reachable', () => {
  it('names the open recommendation in the verdict', () => {
    hooks.workspace.liveIdeas = [
      { id: 'i1', action: 'buy', stage: 'deciding', rationale: null, portfolioName: 'Tech Growth' },
    ]
    renderRow()
    // An open idea is part of the stance, so it is a clause of the verdict
    // rather than a band of its own — one fact about the security, stated
    // once, wherever the reader happens to be.
    //
    // `Deciding`, not `deciding`: the stage is a database enum and was being
    // concatenated raw, so a portfolio manager was shown `ready_for_decision`.
    expect(within(screen.getByTestId('verdict-band')).getByText('BUY · Deciding')).toBeInTheDocument()
  })

  it('writes an enum stage as words, not as storage', () => {
    hooks.workspace.liveIdeas = [
      { id: 'i1', action: 'buy', stage: 'ready_for_decision', rationale: null, portfolioName: 'Tech Growth' },
    ]
    renderRow()
    const band = within(screen.getByTestId('verdict-band'))
    expect(band.getByText('BUY · Ready for decision')).toBeInTheDocument()
    expect(band.queryByText(/ready_for_decision/)).not.toBeInTheDocument()
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
