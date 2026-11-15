/**
 * Coming back to an asset surface is not a cold start.
 *
 * ── What was wrong ───────────────────────────────────────────────────────
 *
 * Reported: "Both the canonical Asset Page and embedded Asset Workspace
 * appear to reload when I navigate to another application tab and return."
 *
 * It was `gcTime`. Two of the four queries behind
 * `useUserAssetPagePreferences` carried `gcTime: 0`, commented "Don't cache
 * - always fetch fresh data", which throws the entry away the instant the
 * component unmounts. `AssetTab` reads that hook's composite `isLoading` as
 * `pageReady` and returns a full-page skeleton when it is true, so every
 * single return to the tab was a skeleton. The rest inherited the app's
 * five-minute default and so failed the same way on any longer trip.
 *
 * ── Why the options are tested and not the hook ──────────────────────────
 *
 * `useUserAssetPagePreferences` is 2,500 lines over four queries, auth, an
 * org context and a dozen mutations. Rendering it proves which mocks were
 * written, not what React Query does with a retention setting.
 *
 * What decides the reader's experience is three options and the gap between
 * two mounts, so that is what is driven here: a real `QueryClient`, a real
 * `useQuery`, a real unmount, real timers moved forward, a real remount.
 * The negative case runs the identical harness with `gcTime: 0`, so the two
 * differ in exactly the thing under test -- which also means this file
 * cannot pass vacuously: the same assertions fail on the old setting.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ASSET_SURFACE_GC_TIME } from '../asset-surface-retention'

/** Every time the query function actually went and asked. */
let fetches = 0

const KEY = ['asset-page', 'sections', 'u-1', 'org-a'] as const

/** The options the asset-page preference queries now carry. */
const RETAINED = {
  staleTime: 0,
  gcTime: ASSET_SURFACE_GC_TIME,
  refetchOnMount: 'always',
} as const

/** What two of them carried before. */
const DISCARDED = {
  staleTime: 0,
  gcTime: 0,
  refetchOnMount: 'always',
} as const

let client: QueryClient
const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
)

const mount = (options: typeof RETAINED | typeof DISCARDED) =>
  renderHook(
    () => useQuery({
      queryKey: KEY,
      queryFn: async () => { fetches++; return ['thesis', 'risks'] },
      ...options,
    }),
    { wrapper: wrap },
  )

beforeEach(() => {
  fetches = 0
  /* `shouldAdvanceTime` so React Query's own scheduling and `waitFor` still
     run while the garbage-collection timer is under our control. */
  vi.useFakeTimers({ shouldAdvanceTime: true })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

afterEach(() => {
  vi.useRealTimers()
})

/** Leave the tab, wait, come back. The reader's actual gesture. */
const away = async (ms: number) => {
  await act(async () => { vi.advanceTimersByTime(ms) })
}

describe('leaving an asset surface and coming back', () => {
  it('reports no loading and renders the previous answer immediately', async () => {
    const first = mount(RETAINED)
    await waitFor(() => expect(first.result.current.isLoading).toBe(false))
    expect(fetches).toBe(1)

    first.unmount()
    /* Ten minutes: past the app's five-minute default, which is the trip
       that used to come back to a skeleton. */
    await away(10 * 60 * 1000)

    const second = mount(RETAINED)
    /* The FIRST render, before any effect. A hook reporting loading here is
       what draws `AssetTab`'s full-page skeleton. */
    expect(second.result.current.isLoading).toBe(false)
    expect(second.result.current.data).toEqual(['thesis', 'risks'])
  })

  it('still revalidates behind the content it just rendered', async () => {
    /* The other half of the requirement: immediate, and not stale. The
       retention is not a freshness change, so `refetchOnMount: 'always'`
       must still ask. */
    const first = mount(RETAINED)
    await waitFor(() => expect(first.result.current.isLoading).toBe(false))
    first.unmount()
    await away(10 * 60 * 1000)

    const second = mount(RETAINED)
    expect(second.result.current.isLoading).toBe(false)
    await waitFor(() => expect(fetches).toBe(2))
    /* And the refetch never put the surface back into a loading state. */
    expect(second.result.current.isLoading).toBe(false)
  })

  it('survives repeated navigation, not just one trip', async () => {
    let seen = mount(RETAINED)
    await waitFor(() => expect(seen.result.current.isLoading).toBe(false))

    for (let i = 0; i < 4; i++) {
      seen.unmount()
      await away(60 * 1000)
      seen = mount(RETAINED)
      expect(seen.result.current.isLoading, `trip ${i + 1}`).toBe(false)
      expect(seen.result.current.data, `trip ${i + 1}`).toBeDefined()
    }
  })

  it('drops the entry once the retention really has passed', async () => {
    /* It is a retention, not a permanent cache. Past the window the entry
       goes, and a cold start is then correct. */
    const first = mount(RETAINED)
    await waitFor(() => expect(first.result.current.isLoading).toBe(false))
    first.unmount()
    await away(ASSET_SURFACE_GC_TIME + 60 * 1000)

    const second = mount(RETAINED)
    expect(second.result.current.isLoading).toBe(true)
  })
})

describe('the setting that caused it', () => {
  it('comes back to a loading state after no time at all', async () => {
    /* `gcTime: 0` is the old value on the section and field catalogues. The
       entry is gone on unmount, so this needs no elapsed time to fail --
       which is why the reader saw it on every tab switch rather than
       occasionally. */
    const first = mount(DISCARDED)
    await waitFor(() => expect(first.result.current.isLoading).toBe(false))

    first.unmount()
    await away(0)

    const second = mount(DISCARDED)
    expect(second.result.current.isLoading).toBe(true)
    expect(second.result.current.data).toBeUndefined()
  })

  it('is the only difference between the two', async () => {
    /* Same key, same query function, same staleTime, same refetchOnMount.
       If this pair ever stops disagreeing, the harness has stopped
       measuring retention and the cases above are worthless. */
    const discarded = mount(DISCARDED)
    await waitFor(() => expect(discarded.result.current.isLoading).toBe(false))
    discarded.unmount()
    await away(0)
    expect(mount(DISCARDED).result.current.isLoading).toBe(true)

    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    fetches = 0
    const retained = mount(RETAINED)
    await waitFor(() => expect(retained.result.current.isLoading).toBe(false))
    retained.unmount()
    await away(0)
    expect(mount(RETAINED).result.current.isLoading).toBe(false)
  })
})

describe('what the retention must not keep', () => {
  it('keeps one organization s answer out of another s', async () => {
    /* The org is in the key, so a switch is a different question and gets a
       cold start rather than the previous org's rows. A retention that
       crossed orgs would be an isolation fault, not a convenience. */
    const inA = mount(RETAINED)
    await waitFor(() => expect(inA.result.current.isLoading).toBe(false))
    inA.unmount()

    const inB = renderHook(
      () => useQuery({
        queryKey: ['asset-page', 'sections', 'u-1', 'org-b'],
        queryFn: async () => { fetches++; return ['other org'] },
        ...RETAINED,
      }),
      { wrapper: wrap },
    )
    expect(inB.result.current.isLoading).toBe(true)
    expect(inB.result.current.data).toBeUndefined()
  })

  it('keeps one reader s answer out of another s', async () => {
    const mine = mount(RETAINED)
    await waitFor(() => expect(mine.result.current.isLoading).toBe(false))
    mine.unmount()

    const theirs = renderHook(
      () => useQuery({
        queryKey: ['asset-page', 'sections', 'u-2', 'org-a'],
        queryFn: async () => { fetches++; return ['someone else'] },
        ...RETAINED,
      }),
      { wrapper: wrap },
    )
    expect(theirs.result.current.isLoading).toBe(true)
  })

  it('still serves a canonical edit rather than the kept answer', async () => {
    /* Invalidation is untouched by retention. A case, target or workflow
       write marks the key stale and the next read refetches, which is the
       behaviour the recent cache-invalidation work put in and this must not
       quietly undo. */
    const open = mount(RETAINED)
    await waitFor(() => expect(open.result.current.isLoading).toBe(false))
    expect(fetches).toBe(1)

    await act(async () => {
      await client.invalidateQueries({ queryKey: ['asset-page'] })
    })

    await waitFor(() => expect(fetches).toBe(2))
    /* Refetched without ever showing a loading state over content the
       reader was looking at. */
    expect(open.result.current.isLoading).toBe(false)
  })
})
