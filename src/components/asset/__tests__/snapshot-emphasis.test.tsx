/**
 * The workspace state has to change the page, not just a data attribute.
 *
 * ── What this suite exists to prevent ────────────────────────────────────
 *
 * `STATE_EMPHASIS` described, per situation, what the Snapshot should lead
 * with. Nothing read it. The page composed one fixed layout and used
 * `workspaceState` for `data-workspace-state` and nothing else, so six
 * situations produced an identical page -- and a test in the resolver's own
 * suite asserted a property of the constant while believing it was asserting
 * something about the page.
 *
 * So these assertions are deliberately about the RENDERED ROW, not about the
 * constant. `context.test.ts` already covers what the constant says; the
 * question here is whether the page obeys it.
 *
 * ── The state that was costing a reader something ────────────────────────
 *
 * `position-unexplained`: held, with no case on record. The case panel at the
 * top of the page is then empty or nearly so, and the exposure -- the only
 * concrete fact about the name -- sat below two other blocks. The reader's
 * question on that name is "what are we holding, and why has nobody written
 * it down", and half of it was at the bottom of the page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { AssetWorkspaceData } from '../../../hooks/useAssetWorkspace'

const BASE: AssetWorkspaceData = {
  sections: [], evidence: [], caseWrittenAt: null, coreSections: [],
  history: [], spot: null, ladder: null, target: null,
  positions: [], liveIdeas: [], decisions: [],
}

let data: AssetWorkspaceData = BASE
let books: { id: string; name: string; role: string | null }[] = []

vi.mock('../../../hooks/useAssetWorkspace', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../hooks/useAssetWorkspace')>()
  return { ...actual, useAssetWorkspace: () => ({ data, isLoading: false, error: null }) }
})
vi.mock('../../../hooks/useAssetDecisionTimeline', () => ({
  useAssetDecisionTimeline: () => ({
    events: [], allEvents: [],
    phaseCounts: { all: 0, exploratory: 0, formal: 0, execution: 0, review: 0 },
    isLoading: false, isError: false,
  }),
}))
vi.mock('../../../hooks/useAnalystRatings', () => ({
  useAnalystRatings: () => ({ ratings: [], consensus: [], myRating: undefined, isLoading: false }),
}))
vi.mock('../../../hooks/useDesktopPortfolio', () => ({
  usePortfolioList: () => ({ portfolios: books, isLoading: false }),
}))
vi.mock('../../coverage/CoverageDisplay', () => ({
  CoverageDisplay: () => <div data-testid="coverage" />,
}))
vi.mock('../../portfolio-v2/PortfolioVisual', async importOriginal => {
  const actual = await importOriginal<typeof import('../../portfolio-v2/PortfolioVisual')>()
  return { ...actual, FrameworkScale: () => <div data-testid="ladder" /> }
})
/* The briefing costs a model call and has its own suite. */
vi.mock('../AssetBriefingSection', () => ({
  AssetBriefingSection: () => <div data-testid="briefing" />,
}))

import { InvestmentSnapshot } from '../InvestmentSnapshot'

const ASSET = { id: 'a-1', symbol: 'AAPL', company_name: 'Apple Inc.' }

const position = (over: Partial<AssetWorkspaceData['positions'][number]> = {}) => ({
  portfolioId: 'p-growth', portfolioName: 'Large Cap Growth',
  shares: 150, price: 170, marketValue: 25_500, weightPct: 25.3,
  avgCost: 165.2, unrealisedGain: 2_020, unrealisedPct: 6.23,
  asOf: '2025-08-01', ...over,
})

function renderSnapshot() {
  return render(
    <InvestmentSnapshot
      asset={ASSET}
      coverage={[]}
      currentQuote={{ price: 336.64, timestamp: '2026-10-09T20:00:00Z' }}
      onOpenSubPage={() => {}}
    />,
  )
}

/** The state the page says it resolved, so a fixture can be checked. */
const stateOf = () =>
  screen.getByTestId('investment-snapshot').getAttribute('data-workspace-state')

/** What the page actually put in the top row, or null if nothing. */
const leadOf = () =>
  screen.queryByTestId('snapshot-lead-row')?.getAttribute('data-lead') ?? null

beforeEach(() => {
  data = { ...BASE }
  books = []
})

describe('held with no case on record', () => {
  beforeEach(() => {
    /* A position and no written sections: exposure with nothing explaining
       it. Coverage is empty, which is what keeps this out of the research
       states. */
    data = { ...BASE, positions: [position()] }
    books = [{ id: 'p-growth', name: 'Large Cap Growth', role: 'pm' }]
  })

  it('is the state this fixture produces', () => {
    /* Pinned so the assertions below cannot quietly start describing a
       different situation. */
    renderSnapshot()
    expect(stateOf()).toBe('position-unexplained')
  })

  it('puts the exposure in the top row beside the case', () => {
    renderSnapshot()
    expect(leadOf()).toBe('position')
    const row = screen.getByTestId('snapshot-lead-row')
    expect(row.querySelector('[data-testid="snapshot-our-view"]')).toBeTruthy()
    expect(row.textContent).toMatch(/Large Cap Growth/)
  })

  it('renders the exposure once, not twice', () => {
    /*
     * The failure mode of promoting a panel rather than moving it. A block
     * that leads AND still sits in its old position is a duplicate, which is
     * exactly the defect the consolidated evidence section was fixing in the
     * chat pane the same week.
     */
    renderSnapshot()
    const everyWeight = screen.getAllByText(/25\.3/)
    expect(everyWeight.length).toBe(1)
  })
})

describe('held with a written case', () => {
  beforeEach(() => {
    data = {
      ...BASE,
      positions: [position()],
      caseWrittenAt: '2026-11-01T00:00:00Z',
      coreSections: ['thesis', 'risks'],
      sections: [{
        section: 'thesis',
        content: 'The case.',
        supportingDetail: null,
        updatedAt: '2026-11-01T00:00:00Z',
        authorName: 'An analyst',
      }],
    }
    books = [{ id: 'p-growth', name: 'Large Cap Growth', role: 'pm' }]
  })

  it('leaves the case alone at the top, because nothing outranks it', () => {
    /* The contrast that makes the test above mean something: the SAME
       position, with a case written, does not get promoted. */
    renderSnapshot()
    expect(stateOf()).toBe('position-monitored')
    expect(leadOf()).toBeNull()
  })

  it('still shows the exposure, lower down', () => {
    /* Emphasis reorders; it never hides. A reader who cannot find the
       position because of a rule they cannot see is worse off than one who
       scrolls. */
    renderSnapshot()
    expect(screen.getByText(/Large Cap Growth/)).toBeTruthy()
  })
})

describe('nothing held and nothing covered', () => {
  it('leads with nothing, because there is no exposure to lead with', () => {
    /*
     * The trap in making `position` a lead at all: `unowned` also has no
     * written case, and promoting an empty exposure panel would give the
     * emptiest possible page its most prominent slot.
     */
    renderSnapshot()
    expect(stateOf()).toBe('unowned')
    expect(leadOf()).toBeNull()
  })
})
