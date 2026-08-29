import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { useFeedIsUpdating, useFeedRefreshOnReturn } from '../useFeedFreshness'
import { isFeedQueryKey, FEED_QUERY_ROOTS } from '../../../lib/mobile/feed-queries'

/**
 * Returning to Mobile Ideas refreshes what has gone stale, and says so.
 *
 * The app-wide default is `refetchOnWindowFocus: false` — right for the
 * desktop surfaces, wrong for the one surface people background constantly.
 * Turning it on globally would change every query in the application including
 * the DESKTOP feed, which shares `useIdeasFeed` and `useSignalCards`, so the
 * policy is scoped to this component tree instead. These tests pin both halves
 * of that: what refetches, and what deliberately does not.
 */

let client: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
)

/** Foreground the tab, the way iOS Safari does. */
function returnToTab() {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  act(() => { document.dispatchEvent(new Event('visibilitychange')) })
}
function leaveTab() {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
  act(() => { document.dispatchEvent(new Event('visibilitychange')) })
}

/**
 * Render a real `useQuery` alongside the hook under test.
 *
 * The policy only touches ACTIVE queries — ones something is rendering — so a
 * cache entry built by hand would not exercise it. This mounts an actual
 * observer, which is what the dashboard has.
 */
function mountFeed(
  key: unknown[],
  fn: () => Promise<unknown>,
  staleTime: number,
  opts?: { ready?: boolean },
) {
  const hook = renderHook(
    () => {
      useQuery({ queryKey: key, queryFn: fn, staleTime })
      useFeedRefreshOnReturn()
      return useFeedIsUpdating(opts?.ready ?? true)
    },
    { wrapper },
  )
  return hook
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})
afterEach(() => {
  client.clear()
  vi.restoreAllMocks()
})

// ── Which queries are the feed ──────────────────────────────────────────────

describe('the participating sources are named in one place', () => {
  it('matches a feed query by its key root', () => {
    expect(isFeedQueryKey(['ideas-feed', { mode: 'for_you' }, 'u', 'o'])).toBe(true)
    expect(isFeedQueryKey(['scenario-cards', 'org-1'])).toBe(true)
    expect(isFeedQueryKey(['coverage-relevance', 'u', 'o'])).toBe(true)
  })

  /**
   * The exclusions are the point of a list. Quotes are per-symbol and already
   * fetched for what is on screen; a focus event fanning out one request per
   * visible ticker would cost a burst to learn nothing the next scroll would
   * not have said.
   */
  it('does not match quotes, history or anything outside the feed', () => {
    expect(isFeedQueryKey(['market-data', 'AMZN'])).toBe(false)
    expect(isFeedQueryKey(['symbol-history', 'AMZN'])).toBe(false)
    expect(isFeedQueryKey(['user-organizations', 'u'])).toBe(false)
    expect(isFeedQueryKey([])).toBe(false)
    expect(isFeedQueryKey([{ not: 'a string' }])).toBe(false)
  })

  it('covers every source the feed composes from', () => {
    for (const root of ['ideas-feed', 'feed-context', 'signal-cards', 'scenario-cards',
      'recommendation-cards', 'attention', 'derived-insights', 'portfolio-lenses',
      'coverage-relevance', 'coverage-relevance-holdings', 'feed-facets']) {
      expect(FEED_QUERY_ROOTS, root).toContain(root)
    }
  })
})

// ── Returning to the tab ────────────────────────────────────────────────────

describe('returning to the tab', () => {
  it('refetches a feed query that has gone stale', async () => {
    const fn = vi.fn().mockResolvedValue(['a'])
    mountFeed(['ideas-feed', 'x'], fn, 0) // stale immediately
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1))

    leaveTab()
    returnToTab()

    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2))
  })

  /**
   * The churn rule. `invalidateQueries` would mark everything stale and refetch
   * all eleven sources on every foreground — a reader flicking between apps
   * would re-request the whole feed several times a minute. Asking each query
   * whether it is ACTUALLY stale defers to the staleTime its hook declares.
   */
  it('leaves a fresh feed query alone', async () => {
    const fn = vi.fn().mockResolvedValue(['a'])
    mountFeed(['scenario-cards', 'org-1'], fn, 5 * 60 * 1000)
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1))

    leaveTab()
    returnToTab()

    await act(async () => { await Promise.resolve() })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('leaves queries outside the feed alone, however stale', async () => {
    const fn = vi.fn().mockResolvedValue({ price: 1 })
    mountFeed(['market-data', 'AMZN'], fn, 0)
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1))

    leaveTab()
    returnToTab()

    await act(async () => { await Promise.resolve() })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  /** Leaving is not an event. Only the return is. */
  it('does not refetch when the tab is being hidden', async () => {
    const fn = vi.fn().mockResolvedValue(['a'])
    mountFeed(['ideas-feed', 'x'], fn, 0)
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1))

    leaveTab()

    await act(async () => { await Promise.resolve() })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  /**
   * A phone that never left the foreground but lost the network for two minutes
   * has stale data and no visibility transition to hang a refetch on.
   */
  it('refetches stale feed queries when the network comes back', async () => {
    const fn = vi.fn().mockResolvedValue(['a'])
    mountFeed(['attention', 'u', 'o', 24], fn, 0)
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1))

    act(() => { window.dispatchEvent(new Event('online')) })

    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2))
  })

  it('stops listening when unmounted', async () => {
    const fn = vi.fn().mockResolvedValue(['a'])
    const { unmount } = mountFeed(['ideas-feed', 'x'], fn, 0)
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1))
    unmount()

    leaveTab()
    returnToTab()

    await act(async () => { await Promise.resolve() })
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

// ── The quiet updating state ────────────────────────────────────────────────

describe('the feed says when it is checking', () => {
  /**
   * Never during the initial load. The feed has its own loader for that, and
   * two loading vocabularies for one wait teaches a reader to distrust both.
   */
  it('is false while the feed is still composing', async () => {
    let resolve!: (v: unknown) => void
    const fn = vi.fn(() => new Promise(r => { resolve = r }))
    // `ready` false — this is the first load, and the feed shows its loader.
    const { result } = mountFeed(['ideas-feed', 'x'], fn as any, 0, { ready: false })

    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1))
    expect(result.current).toBe(false)

    await act(async () => { resolve(['a']); await Promise.resolve() })
  })

  it('is true while a feed source refetches over data already on screen', async () => {
    let resolve!: (v: unknown) => void
    const fn = vi.fn()
      .mockResolvedValueOnce(['a'])
      .mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const { result } = mountFeed(['ideas-feed', 'x'], fn as any, 0)

    // Settled after the first load: data on screen, nothing in flight.
    await waitFor(() => expect(result.current).toBe(false))
    expect(fn).toHaveBeenCalledTimes(1)

    leaveTab()
    returnToTab()

    await waitFor(() => expect(result.current).toBe(true))

    // …and it settles when the refetch lands.
    await act(async () => { resolve(['a', 'b']); await Promise.resolve() })
    await waitFor(() => expect(result.current).toBe(false))
  })

  it('ignores fetches that are not the feed', async () => {
    let resolve!: (v: unknown) => void
    const fn = vi.fn(() => new Promise(r => { resolve = r }))
    const { result } = mountFeed(['market-data', 'AMZN'], fn as any, 0)

    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1))
    expect(result.current).toBe(false)

    await act(async () => { resolve({}); await Promise.resolve() })
  })
})
