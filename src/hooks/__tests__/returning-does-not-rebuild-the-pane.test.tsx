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
import { renderHook, waitFor, act } from '@testing-library/react'
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
/* Mutable so an organization switch can be driven through the real hook
   rather than asserted about its key shape. Read at render time, which is
   when the context would be. */
let org = ORG
vi.mock('../../contexts/OrganizationContext', () => ({
  useOrganization: () => ({ currentOrgId: org }),
  useOrganizationOptional: () => ({ currentOrgId: org }),
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
  org = ORG
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

const mount = (focus: 'overview' | 'research' = 'overview') =>
  renderHook(() => useAssetWorkspace('a-1', 'AAPL', focus), { wrapper: wrap })

const mountAsset = (assetId: string, symbol: string) =>
  renderHook(() => useAssetWorkspace(assetId, symbol, 'overview'), { wrapper: wrap })

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

  it('is still there after a long absence', async () => {
    /* The 60-second `staleTime` above carries a quick trip. It does NOT
       carry a meeting: React Query's default `gcTime` is five minutes, and
       past it the entry is collected and the pane comes back to its own
       `if (isLoading) return <Skeleton />` plus eight fresh reads. That is
       the "appears to reload" the reader reported on the longer trips, and
       `ASSET_SURFACE_GC_TIME` is what this asserts.

       Fake timers only for this case, and `shouldAdvanceTime` so React
       Query's own scheduling still runs while the collection timer is under
       the test's control. */
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const first = mount()
      await waitFor(() => expect(first.result.current.isLoading).toBe(false))
      const afterFirst = reads.length
      first.unmount()

      /* Ten minutes: past the default that used to drop it, inside the
         thirty the surface now declares. */
      await act(async () => { vi.advanceTimersByTime(10 * 60 * 1000) })

      const second = mount()
      /* The first render, before any effect. Loading here is the skeleton. */
      expect(second.result.current.isLoading).toBe(false)
      expect(second.result.current.data).toBeDefined()

      /* And it is not a freshness change. Ten minutes is well past the
         60-second staleTime, so it revalidates -- behind the content the
         reader is already looking at, never in place of it. */
      await waitFor(() => expect(reads.length).toBeGreaterThan(afterFirst))
      expect(second.result.current.isLoading).toBe(false)
    } finally {
      vi.useRealTimers()
    }
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

describe('what the retention must not hand back', () => {
  /**
   * A note on what "no data" looks like here, because it is not `undefined`.
   *
   * The hook ends `return { data: data ?? EMPTY, ... }` -- a single frozen
   * empty workspace shared by every caller with no entry. So a cold mount
   * hands the pane a blank, and the way to prove a blank rather than
   * somebody else's rows is identity: two unrelated cold keys return the
   * SAME object, and a resolved fetch returns a different one. That is what
   * `blank()` and the reference comparisons below are doing.
   */
  const blank = () => {
    const probe = renderHook(() => useAssetWorkspace('never-read', 'ZZZZ', 'overview'), { wrapper: wrap })
    const shell = probe.result.current.data
    probe.unmount()
    return shell
  }

  it('starts a different asset cold rather than showing the last one', async () => {
    /* The requirement is explicit that an asset change resets asset-specific
       state. A retention that served the previous name's rows would be the
       worst kind of fast: the reader is looking at MSFT with AAPL's case. */
    const aapl = mount()
    await waitFor(() => expect(aapl.result.current.isLoading).toBe(false))
    const fromAapl = aapl.result.current.data
    aapl.unmount()

    const msft = mountAsset('a-2', 'MSFT')
    expect(msft.result.current.isLoading).toBe(true)
    /* The blank, not AAPL's workspace. */
    expect(msft.result.current.data).toBe(blank())
    expect(msft.result.current.data).not.toBe(fromAapl)
    await waitFor(() => expect(msft.result.current.isLoading).toBe(false))

    /* Two entries now, one per asset -- not one entry answering for both.
       `blank()`'s probe key is excluded; it is the test's own mount. */
    const entries = client.getQueryCache().getAll()
      .filter(q => q.queryKey[0] === ASSET_WORKSPACE_KEY)
      .filter(q => q.queryKey[1] === 'a-1' || q.queryKey[1] === 'a-2')
    expect(entries).toHaveLength(2)
    expect(new Set(entries.map(q => q.queryKey[1]))).toEqual(new Set(['a-1', 'a-2']))
  })

  it('exposes nothing from the organization the reader has left', async () => {
    /* The hard requirement: "Switching organizations must not retain or
       expose previous organization data." The org is a key segment, so a
       switch asks a different question and gets no answer until it has one
       -- which is what `isLoading` true and `data` undefined assert here.

       This is driven through the real hook and the real context rather than
       by inspecting the key, because the thing that must hold is what the
       PANE receives, not how the key is spelled. */
    const inA = mount()
    await waitFor(() => expect(inA.result.current.isLoading).toBe(false))
    const fromA = inA.result.current.data
    expect(fromA).toBeDefined()
    inA.unmount()

    org = 'org-b'
    const inB = mount()
    expect(inB.result.current.isLoading).toBe(true)
    /* The blank shell every empty caller shares -- so provably not the
       workspace the previous organization's fetch produced. */
    expect(inB.result.current.data).toBe(blank())
    expect(inB.result.current.data).not.toBe(fromA)

    await waitFor(() => expect(inB.result.current.isLoading).toBe(false))
    /* And the two are separate entries, so going back to the first org is
       not served the second one's rows either. */
    const orgs = client.getQueryCache().getAll()
      .filter(q => q.queryKey[0] === ASSET_WORKSPACE_KEY)
      .map(q => q.queryKey[4])
    expect(new Set(orgs)).toEqual(new Set([ORG, 'org-b']))
  })

  it('refetches a canonical edit instead of serving the kept copy', async () => {
    /* The recent cache-invalidation work for case, target and workflow
       writes must survive this change, and retention does not touch it: an
       invalidation marks the entry stale and the mounted hook refetches. */
    const open = mount()
    await waitFor(() => expect(open.result.current.isLoading).toBe(false))
    const afterFirst = reads.length

    await act(async () => {
      await client.invalidateQueries({ queryKey: [ASSET_WORKSPACE_KEY] })
    })

    await waitFor(() => expect(reads.length).toBeGreaterThan(afterFirst))
    /* Refetched without putting a skeleton over content already on screen. */
    expect(open.result.current.isLoading).toBe(false)
  })
})
