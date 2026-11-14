/**
 * Coming back to the Dashboard does not rebuild the work pane.
 *
 * ── The complaint ─────────────────────────────────────────────────────────
 *
 * "I opened an asset from the Dashboard, navigated to the canonical Asset
 * Page to review/edit the case, then returned to the Dashboard. The left-hand
 * Asset Workspace pane appeared to reload and rebuild its content."
 *
 * `DashboardPage.renderTabContent()` renders the ACTIVE tab only, so the
 * whole Dashboard subtree -- shell, feed and work pane -- is unmounted the
 * moment the reader looks at another tab, and remounted on the way back.
 * That remount is the tab host's design and is not what this pins.
 *
 * What the reader SEES as a rebuild has three separable causes, and the brief
 * is explicit that they must not be treated as one thing:
 *
 *   the selection is gone    `place.ts`, already shipped: the lens, the name
 *                            and the open pane come back, so the reader does
 *                            not have to reopen the event.
 *   the pane's own UI state  `pane-place.ts`: the disclosure they had opened
 *                            and where they had scrolled to.
 *   a loading flash          this file. A remount that refetches shows the
 *                            skeleton, and a skeleton where content was is
 *                            indistinguishable from a reload.
 *
 * ── Why this is tested against a real QueryClient ─────────────────────────
 *
 * The question is whether the remount's key MATCHES the entry the previous
 * mount left behind, and only React Query can answer that. A test asserting
 * the hook "uses the cache" would pass against a key with an extra segment,
 * a key that captured a value which resets with the tab, or a `staleTime` of
 * zero. So: seed the real key shape, mount the real hook, and read back both
 * what it reports and whether it went to the network.
 *
 * `reads` counts every `supabase.from(...)`, so a refetch cannot hide: the
 * hook issues eight of them per fetch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const reads: string[] = []
vi.mock('../../lib/supabase', () => {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'gte', 'in', 'order', 'limit']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(resolve)
  return {
    supabase: {
      from: vi.fn((table: string) => { reads.push(table); return chain }),
    },
  }
})

const ORG = 'org-a'
vi.mock('../../contexts/OrganizationContext', () => ({
  useOrganization: () => ({ currentOrgId: ORG }),
  useOrganizationOptional: () => ({ currentOrgId: ORG }),
}))

import { useAssetWorkspace, ASSET_WORKSPACE_KEY } from '../useAssetWorkspace'

/** The key as the hook builds it: `[prefix, assetId, symbol, days, orgId]`. */
const key = (days: number) => [ASSET_WORKSPACE_KEY, 'a-1', 'AAPL', days, ORG]

let client: QueryClient
const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
)

beforeEach(() => {
  reads.length = 0
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

const mount = (focus: 'overview' | 'research' = 'overview') =>
  renderHook(() => useAssetWorkspace('a-1', 'AAPL', focus), { wrapper: wrap })

describe('the second visit', () => {
  it('reports no loading and issues no read when the entry is still fresh', async () => {
    /* The first visit. Let it settle so the cache holds a real entry with a
       real `dataUpdatedAt`, rather than one planted by hand. */
    const first = mount()
    await waitFor(() => expect(first.result.current.isLoading).toBe(false))
    const afterFirst = reads.length
    expect(afterFirst).toBeGreaterThan(0)

    /* Leaving the Dashboard tab. This is the real unmount, not a simulation
       of one: the tab host renders the active tab only. */
    first.unmount()

    const second = mount()
    /* The very FIRST render, before any effect has run. A pane that reports
       loading here draws its skeleton, and a skeleton where content was is
       what the reader called a rebuild. */
    expect(second.result.current.isLoading).toBe(false)
    expect(second.result.current.data).toBeDefined()
    /* And it did not go back to the database for rows it already had. The
       60-second staleTime is doing this, which is legitimate here: the
       question is freshness of UNCHANGED content, and every writer that can
       change it invalidates this key. */
    expect(reads.length).toBe(afterFirst)
  })

  it('keys on nothing that resets with the tab', async () => {
    /* The failure this guards: a key segment derived from state that lives
       inside the Dashboard subtree would be new on the way back, so the
       remount would miss its own entry and refetch. Asserting the exact
       entry the hook populated is how that gets caught -- the shape is
       `[prefix, assetId, symbol, days, orgId]` and nothing in it is pane
       state. */
    const { result, unmount } = mount()
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    const populated = client.getQueryCache().getAll()
      .filter(q => q.queryKey[0] === ASSET_WORKSPACE_KEY)
    expect(populated).toHaveLength(1)
    expect(populated[0].queryKey).toEqual(key(populated[0].queryKey[3] as number))

    unmount()
    mount()
    /* Still one entry, not two. A second entry means the remount asked a
       different question and will show a skeleton while it answers it. */
    expect(client.getQueryCache().getAll()
      .filter(q => q.queryKey[0] === ASSET_WORKSPACE_KEY)).toHaveLength(1)
  })

  it('still fetches for a different question', async () => {
    /* The other branch, which is what makes the two above checks rather
       than a cache that answers everything. `research` pulls a deeper
       history, so it is a different key and a genuinely different read --
       and a reader who asked for it must not be served the shallow one. */
    const first = mount('overview')
    await waitFor(() => expect(first.result.current.isLoading).toBe(false))
    const afterFirst = reads.length
    first.unmount()

    mount('research')
    await waitFor(() => expect(reads.length).toBeGreaterThan(afterFirst))
  })
})
