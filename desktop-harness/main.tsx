import React from 'react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import { IdeasWorkspace } from '../src/components/ideas-v2/IdeasWorkspace'
import { DashboardShell } from '../src/components/dashboard/DashboardShell'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { FeedSentinelRepro } from './feed-sentinel-repro'

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
