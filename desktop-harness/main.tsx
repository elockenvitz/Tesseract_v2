import React from 'react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import { IdeasWorkspace } from '../src/components/ideas-v2/IdeasWorkspace'
import { DashboardShell } from '../src/components/dashboard/DashboardShell'
import { DecisionTimeline } from '../src/components/asset/DecisionTimeline'
import { MobileAssetPage } from '../src/components/mobile/asset/MobileAssetPage'
import { OurViewSummary } from '../src/components/asset/OurViewSummary'
import { InvestmentSnapshot } from '../src/components/asset/InvestmentSnapshot'
import { SNAPSHOT_COVERAGE, SNAPSHOT_THESIS_STATUS, SNAPSHOT_QUOTE } from './snapshot-fixtures'
import { OUR_VIEW_FIELDS, ourViewContributions } from './our-view-fixtures'
import { FeedSentinelRepro } from './feed-sentinel-repro'
import { DesignDirections } from './design/directions'
import { DecisionBand } from '../src/components/asset-v2/AssetWorkspace'
import { AW_PENDING, AW_NONE } from './asset-workspace-fixtures'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AssetWorkPane } from '../src/components/asset/work/AssetWorkPane'
import { splitAttention } from '../src/lib/asset-work/attention'

/**
 * The app's providers, minus everything the harness does not need.
 *
 * react-query is genuinely required: several components below the stubbed
 * hooks still call `useQuery` for their own reasons, and a missing client
 * throws rather than degrading. Retries and refetching are off so a fixture
 * render is deterministic and cannot flicker mid-screenshot.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity },
  },
})

/**
 * The desktop surfaces at a real width, on the app's own stylesheet.
 *
 * `?surface=dashboard` (the default) renders the whole shell -- the lens bar
 * and Today beneath it, which is what a user actually lands on.
 * `?surface=ideas` renders the Ideas field alone, which is what Stage 4D
 * measured; both are kept so that stage's numbers stay reproducible.
 *
 * These surfaces are `h-full overflow-y-auto`, so they scroll inside their
 * parent rather than growing the page. That is right in the app and wrong for
 * a screenshot: a full-page capture would stop at the fold and every row below
 * it would be unreachable. The harness gives a tall container so the whole
 * surface lays out at once. Nothing about the composition depends on the
 * container's height, so the first viewport still shows exactly what the app's
 * first viewport shows.
 *
 * `?h=` overrides it, for checking that the real scrolling case still works.
 */
function Harness() {
  const q = new URLSearchParams(location.search)
  const h = Number(q.get('h') ?? '3200')
  const surface = q.get('surface') ?? 'dashboard'

  /*
   * `?surface=feed-sentinel` reproduces the mobile Ideas feed's pagination
   * lifecycle — navigating to Explore and back. `?attach=ref` is the broken
   * form the bug was reported against, `?attach=state` the fix. See
   * `feed-sentinel-repro.tsx` for exactly what it stands for and what it
   * does not.
   */
  /*
   * `?surface=design&dir=a|b&mobile=1` renders the two proposed Asset
   * Workspace directions. Prototypes for a decision, never imported by the app.
   */
  if (surface === 'design') {
    const mobile = q.get('mobile') === '1'
    return (
      <div data-harness="design" style={{ width: mobile ? 390 : '100%', height: mobile ? 860 : h, margin: mobile ? '0 auto' : undefined, border: mobile ? '1px solid #ddd' : undefined, overflow: 'hidden' }}>
        <DesignDirections dir={(q.get('dir') as 'a' | 'b') ?? 'a'} mobile={mobile} />
      </div>
    )
  }

  /*
   * `?surface=asset-workspace&case=pending|none` renders the REAL AssetWorkspacePane
   * (the component IdeasWorkPane mounts) with synthetic data seeded into its own
   * react-query key — so the new DecisionBand is viewable without production data or
   * a login. `case=pending` shows the band; `case=none` shows it collapsed.
   */
  if (surface === 'asset-workspace') {
    return <AssetWorkspaceSurface mode={(q.get('case') as 'pending' | 'none') ?? 'pending'} h={h} />
  }

  if (surface === 'feed-sentinel') {
    return (
      <div data-harness={surface} style={{ padding: 12 }}>
        <FeedSentinelRepro
          attach={(q.get('attach') as 'ref' | 'state') ?? 'ref'}
          initial={q.has('tiles') ? Number(q.get('tiles')) : undefined}
          exhausted={q.get('exhausted') === '1'}
        />
      </div>
    )
  }


  /*
   * `?surface=decision-timeline` renders the asset Decision Memory timeline
   * against `stub-decision-timeline.ts`. `?asset=empty` selects the
   * no-history case; `?book=pf-growth` exercises the portfolio filter.
   *
   * Constrained to a realistic column width rather than the full page: the
   * timeline sits in AssetTab's content column, and measuring it at 1920px
   * would measure a width it never actually gets.
   */
  if (surface === 'decision-timeline') {
    return (
      <div
        style={{ height: `${h}px`, width: '100%', padding: 24, background: '#f8fafc' }}
        data-harness={surface}
      >
        <div style={{ maxWidth: 860 }}>
          <DecisionTimeline
            assetId={q.get('asset') ?? 'aapl'}
            portfolioId={q.get('book')}
            onNavigate={(d) => {
              // The harness has no tab shell. Record the descriptor on the DOM
              // so a probe can assert WHERE a click would have gone, which is
              // the part that regressed before.
              document.body.setAttribute('data-last-nav', JSON.stringify(d))
            }}
          />
        </div>
      </div>
    )
  }

  /*
   * `?surface=snapshot` renders the desktop Investment Snapshot — the Asset
   * page's landing — against the same `useAssetWorkspace` fixtures the phone
   * Snapshot uses, so the two surfaces cannot be compared against different
   * data. `?asset=empty` is the unheld, uncovered security.
   *
   * Given the asset page's real content width rather than the full window:
   * the Snapshot sits inside AssetTab's column, and measuring it at 1920
   * would measure a width it never actually gets.
   */
  /*
   * ?surface=asset-work&case=both|ideas|process|none|pm|analyst
   *
   * The Work prototype with synthetic data, so the interaction can be reviewed
   * without touching the Process or Decisions tabs. The component takes props
   * shaped to the real contracts — attention already split by splitAttention,
   * ideas carrying stored stage values, the workflow summary the Process tab
   * renders — so what is stubbed here is the fetch, not the shape.
   */
  if (surface === 'asset-work') {
    const mode = q.get('case') ?? 'both'
    const requests = [
      { id: 'req-1', portfolioId: 'pf-a', requestedBy: 'analyst-1', status: 'pending',
        action: 'buy', portfolioName: 'Large Cap Growth', requesterName: 'J. Homler',
        contextNote: 'Add 30bps on the pullback', createdAgo: '2 days ago' },
      { id: 'req-2', portfolioId: 'pf-b', requestedBy: 'me', status: 'pending',
        action: 'trim', portfolioName: 'Vision Fund 10K', requesterName: 'You',
        contextNote: 'Trim into strength', createdAgo: '5 hours ago' },
    ]
    const pmIds = mode === 'analyst' ? [] : ['pf-a']
    const attention = (mode === 'none' || mode === 'process')
      ? { needsYourAction: [], awaitingOthers: [] }
      : splitAttention(requests as never, { userId: 'me', pmPortfolioIds: pmIds })

    const ideas = (mode === 'both' || mode === 'ideas' || mode === 'pm' || mode === 'analyst')
      ? [
          { id: 'i1', action: 'buy', stage: 'ready_for_decision', rationale: 'Deliveries inflecting; margin trough passed', portfolioName: 'Large Cap Growth', updatedAgo: '3d' },
          { id: 'i2', action: 'add', stage: 'thesis_forming', rationale: 'Services mix shifting the multiple', portfolioName: 'Vision Fund 10K', updatedAgo: '1w' },
          { id: 'i3', action: 'sell', stage: 'exploring', rationale: 'Competitive position eroding in China', portfolioName: null, updatedAgo: '2w' },
        ]
      : []

    const proc = (mode === 'both' || mode === 'process' || mode === 'pm' || mode === 'analyst')
      ? {
          workflowName: 'Earnings Season - Q2 2026',
          stages: [
            { id: 's1', label: 'Expectations', done: 2, total: 5, active: true },
            { id: 's2', label: 'Earnings Print', done: 0, total: 5, active: false },
            { id: 's3', label: 'Trade Decision', done: 0, total: 3, active: false },
          ],
          openStageLabel: 'Expectations', openStageDone: 2, openStageTotal: 5,
          assigneeName: 'E. Lockenvitz', deadline: 'Nov 1', priorityLabel: 'High',
        }
      : null

    return (
      <div data-harness={surface} style={{ height: `${h}px`, width: '100%', background: '#f9fafb', padding: '16px 32px', overflow: 'auto' }}>
        <p style={{ font: '600 12px system-ui', color: '#6b7280', marginBottom: 12 }}>
          AssetWorkPane — case={mode} (pm books: {pmIds.join(',') || 'none'})
        </p>
        <div style={{ maxWidth: 760 }}>
          <AssetWorkPane
            attention={attention as never}
            ideas={ideas}
            process={proc}
            researchLinks={mode === 'none' ? [] : [
              { key: 'thesis', label: 'Investment Thesis', detail: '2 sources', onOpen: () => console.log('open thesis') },
            ]}
            onOpenIdeas={() => console.log('open idea pipeline')}
            onOpenIdea={(id) => console.log('open idea', id)}
            onOpenProcess={() => console.log('open full process')}
            onNewIdea={() => console.log('new idea')}
            onStartProcess={() => console.log('start process')}
          />
        </div>
      </div>
    )
  }

  if (surface === 'snapshot') {
    const assetId = q.get('asset') ?? 'aapl'
    const empty = assetId === 'empty'
    return (
      <div
        data-harness={surface}
        style={{ height: `${h}px`, width: '100%', background: '#f9fafb', padding: '16px 32px' }}
      >
        <InvestmentSnapshot
          asset={{
            id: assetId,
            symbol: empty ? 'ZZZ' : 'AAPL',
            company_name: empty ? 'Zephyr Holdings' : 'Apple Inc.',
          }}
          coverage={empty ? [] : SNAPSHOT_COVERAGE}
          thesisStatuses={empty ? [] : SNAPSHOT_THESIS_STATUS}
          currentQuote={empty ? null : SNAPSHOT_QUOTE}
          contributions={ourViewContributions(null)}
          contributionFields={OUR_VIEW_FIELDS}
          coveringAnalystIds={new Set(['u-rivera'])}
          onOpenAnalyst={(id) => document.body.setAttribute('data-last-nav', JSON.stringify({ analyst: id }))}
          onOpenSubPage={(page) => {
            document.body.setAttribute('data-last-nav', JSON.stringify({ subPage: page }))
          }}
        />
      </div>
    )
  }

  /*
   * `?surface=our-view` renders the Our View firm summary against
   * `our-view-fixtures.ts`. `?view=empty` is the nobody-has-written case and
   * `?view=single` the one-contributor case, which is the one that must not
   * read as a firm position.
   *
   * The component is pure — contributions in, summary out, no queries — so it
   * needs no stub module. Same 860px column the Research pane gives it.
   */
  if (surface === 'our-view') {
    const view = q.get('view')
    return (
      <div
        style={{ height: `${h}px`, width: '100%', padding: 24, background: '#f8fafc' }}
        data-harness={surface}
      >
        <div style={{ maxWidth: 860 }}>
          <OurViewSummary
            contributions={ourViewContributions(view)}
            fields={OUR_VIEW_FIELDS}
            coveringAnalystIds={new Set(['u-rivera'])}
            currentUserId="u-okafor"
            symbol="AAPL"
            onOpenAnalyst={(id) => {
              document.body.setAttribute('data-last-nav', JSON.stringify({ analyst: id }))
            }}
          />
        </div>
      </div>
    )
  }

  /*
   * `?surface=mobile-asset` renders the phone asset page. It is given a
   * FIXED 390x844 frame rather than the page width, because the whole claim
   * of Increment 2C is that this surface works at a phone's dimensions —
   * measuring it in a 1440px window would measure a width it never gets.
   *
   * `?asset=empty` is the unheld, no-history security.
   */
  if (surface === 'mobile-asset') {
    const vh = Number(q.get('vh') ?? '844')
    return (
      <div
        data-harness={surface}
        style={{
          width: 390, height: vh, overflow: 'hidden',
          border: '1px solid #e5e7eb', margin: '0 auto',
        }}
      >
        <MobileAssetPage
          asset={{
            id: q.get('asset') ?? 'aapl',
            symbol: q.get('asset') === 'empty' ? 'ZZZ' : 'AAPL',
            company_name: q.get('asset') === 'empty' ? 'Zephyr Holdings' : 'Apple Inc.',
            portfolioId: q.get('book'),
          }}
          onNavigate={(d) => {
            document.body.setAttribute('data-last-nav', JSON.stringify(d))
          }}
        />
      </div>
    )
  }

  return (
    <div style={{ height: `${h}px`, width: '100%' }} data-harness={surface}>
      {surface === 'ideas'
        ? <IdeasWorkspace />
        : <DashboardShell initialLens={(q.get('lens') as never) ?? 'today'} />}
    </div>
  )
}

/** Dev-only: the real AssetWorkspacePane with a stubbed org context and a seeded
 *  cache, so its DecisionBand renders on synthetic data. The Decide CTA's real
 *  hand-off event is caught and shown, demonstrating the navigation into the
 *  decision workflow without a tab shell here. */
function AssetWorkspaceSurface({ mode, h }: { mode: 'pending' | 'none'; h: number }) {
  const [nav, setNav] = React.useState<string | null>(null)
  React.useEffect(() => {
    const on = (e: Event) => {
      const d = JSON.stringify((e as CustomEvent).detail)
      setNav(d); document.body.setAttribute('data-last-nav', d)
    }
    window.addEventListener('decision-engine-action', on as EventListener)
    return () => window.removeEventListener('decision-engine-action', on as EventListener)
  }, [])
  const data = mode === 'pending' ? AW_PENDING : AW_NONE
  return (
    <div data-harness="asset-workspace" style={{ height: `${h}px`, width: '100%', background: '#f9fafb', padding: '24px 32px' }}>
      <div style={{ maxWidth: 1040 }}>
        <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
          AssetWorkspacePane › DecisionBand — the real component, synthetic data (case={mode})
        </p>
        <DecisionBand data={data} position={data.positions[0] ?? null} symbol="AAPL"
          onOpenLegacy={() => setNav('{"openLegacy":true}')} />
        {mode === 'none' && (
          <p style={{ fontSize: 13, color: '#374151' }}>
            No pending request → the band renders nothing above this line (it collapsed cleanly).
          </p>
        )}
      </div>
      {nav && (
        <div data-testid="harness-nav"
          style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#111827', color: '#fff', padding: '10px 14px', fontFamily: 'monospace', fontSize: 12 }}>
          Decide → handed off to the decision workflow: {nav}
        </div>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>
  </React.StrictMode>,
)
