import React from 'react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import { IdeasWorkspace } from '../src/components/ideas-v2/IdeasWorkspace'
import { DashboardShell } from '../src/components/dashboard/DashboardShell'
import { DecisionTimeline } from '../src/components/asset/DecisionTimeline'
import { MobileAssetPage } from '../src/components/mobile/asset/MobileAssetPage'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

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

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>
  </React.StrictMode>,
)
