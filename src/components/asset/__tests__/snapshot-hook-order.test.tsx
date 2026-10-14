/**
 * The Snapshot must survive loading -> loaded. It did not.
 *
 * ── The crash ────────────────────────────────────────────────────────────
 *
 *     Rendered more hooks than during the previous render.
 *     at useMemo, in InvestmentSnapshot
 *
 * `if (isLoading) return <SnapshotSkeleton />` sits part-way down the
 * component. A `useMemo` counting execution provenance had been placed BELOW
 * it, next to the panel that consumes it. So the first render — workspace
 * query in flight — returned at the guard having run seven hooks, and the
 * second render ran eight. React cannot reconcile that and throws, taking the
 * whole Asset Workspace down in the authenticated app.
 *
 * ── Why nothing caught it ────────────────────────────────────────────────
 *
 * Every existing test and every harness surface mocks `useAssetWorkspace` to
 * return `isLoading: false` on the very first render. That is a reasonable
 * fixture and it makes this class of bug INVISIBLE: the loading branch is
 * never taken, so the short hook list is never recorded, so the long one
 * never conflicts with it. The defect needs a real transition.
 *
 * So these tests drive the transition itself. They assert nothing about
 * layout — React throwing is the failure, and a passing render is the pass.
 * A source-text check could not do this: the violation is about execution
 * order across two renders, not about where a line sits in a file.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import type { AssetWorkspaceData } from '../../../hooks/useAssetWorkspace'

const EMPTY: AssetWorkspaceData = {
  sections: [], evidence: [], caseWrittenAt: null, coreSections: [],
  history: [], spot: null, ladder: null, target: null,
  positions: [], liveIdeas: [], decisions: [],
}

const POPULATED: AssetWorkspaceData = {
  ...EMPTY,
  caseWrittenAt: '2026-09-28T10:00:00Z',
  coreSections: ['thesis'],
  sections: [{
    section: 'thesis', content: 'Services mix is mispriced.',
    supportingDetail: null, updatedAt: '2026-09-28T10:00:00Z', authorName: 'Ana Bell',
  }] as never,
  spot: 231.4,
  target: 268,
  positions: [{
    portfolioId: 'pf-1', portfolioName: 'Growth', shares: 1000, price: 231.4,
    marketValue: 231_400, weightPct: 2.5, avgCost: 188.2,
    unrealisedGain: 43_200, unrealisedPct: 22.9, asOf: '2026-10-10',
  }] as never,
  decisions: [{
    id: 'd1', action: 'add', portfolioId: 'pf-1', portfolioName: 'Growth',
    decidedAt: null, decisionNote: 'Raising to target.',
  }] as never,
  liveIdeas: [] as never,
}

/*
 * The mocks are LIVE: each reads a module-level variable, so a test can change
 * what the hook returns and re-render to simulate a query resolving. A mock
 * that closed over a fixed value could not express a transition, which is the
 * whole subject here.
 */
let workspace: AssetWorkspaceData = EMPTY
let workspaceLoading = true
vi.mock('../../../hooks/useAssetWorkspace', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../hooks/useAssetWorkspace')>()
  return {
    ...actual,
    useAssetWorkspace: () => ({ data: workspace, isLoading: workspaceLoading, error: null }),
  }
})

let timelineEvents: any[] = []
let timelineLoading = true
vi.mock('../../../hooks/useAssetDecisionTimeline', () => ({
  useAssetDecisionTimeline: () => ({
    events: timelineEvents,
    allEvents: timelineEvents,
    phaseCounts: { all: timelineEvents.length, exploratory: 0, formal: 0, execution: 0, review: 0 },
    isLoading: timelineLoading,
    isError: false,
  }),
}))

let ratings: { id: string }[] = []
let consensus: { value: string; count: number; percentage: number }[] = []
vi.mock('../../../hooks/useAnalystRatings', () => ({
  useAnalystRatings: () => ({ ratings, consensus, isLoading: false }),
}))

let books: { id: string; name: string; role: string | null }[] = []
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

const { InvestmentSnapshot } = await import('../InvestmentSnapshot')

const ASSET = { id: 'a1', symbol: 'AAPL', company_name: 'Apple Inc.' }

/**
 * React logs the hook-order error to console.error BEFORE throwing, and
 * testing-library logs it again. Captured so a passing run is quiet and a
 * failing one can name what React actually said.
 */
let consoleErrors: string[] = []
beforeEach(() => {
  workspace = EMPTY
  workspaceLoading = true
  timelineEvents = []
  timelineLoading = true
  ratings = []
  consensus = []
  books = []
  consoleErrors = []
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    consoleErrors.push(a.map(String).join(' '))
  })
})
afterEach(() => { vi.restoreAllMocks() })

/** Every hook-order complaint React makes, in one matcher. */
const HOOK_ORDER = /Rendered more hooks|Rendered fewer hooks|order of Hooks|Should have a queue/i

function expectNoHookOrderError() {
  const hits = consoleErrors.filter(e => HOOK_ORDER.test(e))
  expect(hits, hits.join('\n')).toEqual([])
}

describe('the Snapshot survives its own loading transition', () => {
  it('loading -> populated', () => {
    const { rerender } = render(
      <InvestmentSnapshot asset={ASSET} coverage={[]} onOpenSubPage={() => {}} />,
    )

    // The query resolves. This is the render that used to throw.
    act(() => {
      workspace = POPULATED
      workspaceLoading = false
      timelineEvents = [{
        id: 'e1', type: 'trade_executed', executionProof: 'verified',
        timestamp: '2026-06-02', title: 'Add', phase: 'execution',
      }]
      timelineLoading = false
    })
    rerender(<InvestmentSnapshot asset={ASSET} coverage={[]} onOpenSubPage={() => {}} />)

    expectNoHookOrderError()
  })

  it('loading -> empty', () => {
    /*
     * The other arm. A name with nothing on record still leaves the loading
     * branch, so it runs the same hook-count transition — and an empty
     * workspace is the commoner case on a new tenant.
     */
    const { rerender } = render(
      <InvestmentSnapshot asset={ASSET} coverage={[]} onOpenSubPage={() => {}} />,
    )
    act(() => { workspace = EMPTY; workspaceLoading = false; timelineLoading = false })
    rerender(<InvestmentSnapshot asset={ASSET} coverage={[]} onOpenSubPage={() => {}} />)

    expectNoHookOrderError()
  })

  it('survives a second transition back into loading', () => {
    // A refetch puts `isLoading` back to true, so the component re-enters the
    // short branch after having run the long one. The reverse of the crash.
    const { rerender } = render(
      <InvestmentSnapshot asset={ASSET} coverage={[]} onOpenSubPage={() => {}} />,
    )
    act(() => { workspace = POPULATED; workspaceLoading = false; timelineLoading = false })
    rerender(<InvestmentSnapshot asset={ASSET} coverage={[]} onOpenSubPage={() => {}} />)
    act(() => { workspaceLoading = true })
    rerender(<InvestmentSnapshot asset={ASSET} coverage={[]} onOpenSubPage={() => {}} />)
    act(() => { workspaceLoading = false })
    rerender(<InvestmentSnapshot asset={ASSET} coverage={[]} onOpenSubPage={() => {}} />)

    expectNoHookOrderError()
  })
})

describe('the Snapshot survives context changes after loading', () => {
  it('a portfolio selection', async () => {
    const userEvent = (await import('@testing-library/user-event')).default
    workspace = POPULATED
    workspaceLoading = false
    timelineLoading = false
    books = [
      { id: 'pf-1', name: 'Growth', role: 'pm' },
      { id: 'pf-2', name: 'Income', role: 'pm' },
    ]

    const { container } = render(
      <InvestmentSnapshot asset={ASSET} coverage={[]} onOpenSubPage={() => {}} />,
    )
    // The book selector re-renders every domain through one state change,
    // which is the interaction most likely to expose an order problem.
    const select = container.querySelector('select')
    if (select) await userEvent.selectOptions(select, 'pf-2')

    expectNoHookOrderError()
  })

  it('research context arriving late', () => {
    /*
     * Contributions and the template field list are passed down from
     * `AssetTab` and arrive on a later render than the workspace query. That
     * is a prop change across a render boundary, and the contributor roster
     * is rendered conditionally on it — exactly the shape that invites a
     * conditional hook.
     */
    const { rerender } = render(
      <InvestmentSnapshot asset={ASSET} coverage={[]} onOpenSubPage={() => {}} />,
    )
    act(() => { workspace = POPULATED; workspaceLoading = false; timelineLoading = false })
    rerender(<InvestmentSnapshot asset={ASSET} coverage={[]} onOpenSubPage={() => {}} />)

    rerender(
      <InvestmentSnapshot
        asset={ASSET}
        coverage={[]}
        onOpenSubPage={() => {}}
        contributions={[{
          id: 'c1', asset_id: 'a1', section: 'thesis', content: 'A view.',
          created_by: 'u1', is_archived: false, updated_at: '2026-10-01T00:00:00Z',
          user: { id: 'u1', first_name: 'Ana', last_name: 'Bell' },
        }] as never}
        contributionFields={[{ slug: 'thesis', label: 'Investment Thesis', sectionKeys: ['thesis'] }]}
        coveringAnalystIds={new Set(['u1'])}
        onOpenAnalyst={() => {}}
      />,
    )

    expectNoHookOrderError()
  })

  it('ratings arriving after the first paint', () => {
    const { rerender } = render(
      <InvestmentSnapshot asset={ASSET} coverage={[]} onOpenSubPage={() => {}} />,
    )
    act(() => { workspace = POPULATED; workspaceLoading = false; timelineLoading = false })
    rerender(<InvestmentSnapshot asset={ASSET} coverage={[]} onOpenSubPage={() => {}} />)
    act(() => {
      ratings = [{ id: 'r1' }, { id: 'r2' }]
      consensus = [{ value: 'Buy', count: 2, percentage: 100 }]
    })
    rerender(<InvestmentSnapshot asset={ASSET} coverage={[]} onOpenSubPage={() => {}} />)

    expectNoHookOrderError()
  })
})
