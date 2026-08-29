import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { useFeedSessionStability } from '../useFeedSessionStability'

/**
 * The mobile feed composes once per visit and then holds still.
 *
 * The previous pass had this backwards: it refetched every stale source when
 * the tab came back, which re-ranked the list under a reader who had gone to
 * answer a message. Freshness here belongs to the FIRST composition. These
 * tests pin the difference — nothing moves on its own, everything moves when
 * asked.
 */

let client: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
)

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  act(() => { document.dispatchEvent(new Event('visibilitychange')) })
}

/** Mount a feed query under the stability policy, the way the dashboard does. */
function mountFeed(key: unknown[], fn: () => Promise<unknown>, staleTime = 0) {
  return renderHook(
    () => {
      useFeedSessionStability()
      return useQuery({ queryKey: key, queryFn: fn, staleTime })
    },
    { wrapper },
  )
}

beforeEach(() => {
  // The app-wide defaults this hook exists to override for mobile.
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnMount: true, refetchOnWindowFocus: false },
    },
  })
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})
afterEach(() => { client.clear(); vi.restoreAllMocks() })

describe('the working set survives leaving and coming back', () => {
  it('does not refetch when the tab is foregrounded again', async () => {
    const fn = vi.fn().mockResolvedValue(['a'])
    mountFeed(['ideas-feed', 'x'], fn)
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1))

    setVisibility('hidden')
    setVisibility('visible')

    await act(async () => { await Promise.resolve() })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  /**
   * Reconnect is a focus refetch under another name: a phone that backgrounds
   * usually drops and reacquires the network. React Query defaults this to
   * true and `App.tsx` does not override it, so removing the visibility
   * listener alone would have left most of the behaviour in place and only
   * looked fixed.
   */
  it('does not refetch when the network comes back', async () => {
    const fn = vi.fn().mockResolvedValue(['a'])
    mountFeed(['scenario-cards', 'org-1'], fn)
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1))

    act(() => { window.dispatchEvent(new Event('online')) })

    await act(async () => { await Promise.resolve() })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  /**
   * Opening an asset and coming back REMOUNTS the dashboard. `feed-session`
   * restores the seed and the scroll offset, so without this the reader lands
   * on the right pixel of a list whose contents changed underneath them.
   */
  it('does not refetch on remount, even when stale', async () => {
    const fn = vi.fn().mockResolvedValue(['a'])
    const first = mountFeed(['ideas-feed', 'x'], fn)
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1))
    first.unmount()

    mountFeed(['ideas-feed', 'x'], fn)
    await act(async () => { await Promise.resolve() })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('holds every participating source, not just the feed', async () => {
    for (const root of ['ideas-feed', 'signal-cards', 'scenario-cards', 'attention',
      'recommendation-cards', 'derived-insights', 'portfolio-lenses',
      'coverage-relevance', 'feed-context', 'feed-facets']) {
      const fn = vi.fn().mockResolvedValue(['a'])
      const h = mountFeed([root, 'k'], fn)
      await waitFor(() => expect(fn).toHaveBeenCalledTimes(1))
      setVisibility('hidden'); setVisibility('visible')
      act(() => { window.dispatchEvent(new Event('online')) })
      await act(async () => { await Promise.resolve() })
      expect(fn, root).toHaveBeenCalledTimes(1)
      h.unmount()
    }
  })
})

describe('but the reader can still ask', () => {
  /** Pull-to-refresh and the post-write invalidation both go through this. */
  it('an explicit refetch still recomposes', async () => {
    const fn = vi.fn().mockResolvedValue(['a'])
    mountFeed(['ideas-feed', 'x'], fn)
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1))

    await act(async () => { await client.refetchQueries({ queryKey: ['ideas-feed'] }) })
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('an invalidation after a write still redraws that source', async () => {
    const fn = vi.fn().mockResolvedValue(['a'])
    mountFeed(['scenario-cards', 'org-1'], fn)
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1))

    await act(async () => { await client.invalidateQueries({ queryKey: ['scenario-cards'] }) })
    expect(fn).toHaveBeenCalledTimes(2)
  })

  /** A filter change is a new key, which is a new query, which always fetches. */
  it('a filter change composes a new working set', async () => {
    const fn = vi.fn().mockResolvedValue(['a'])
    const { rerender } = renderHook(
      ({ f }: { f: string }) => {
        useFeedSessionStability()
        return useQuery({ queryKey: ['ideas-feed', f], queryFn: fn, staleTime: 0 })
      },
      { wrapper, initialProps: { f: 'all' } },
    )
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1))

    rerender({ f: 'scenario_gap' })
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2))
  })
})

describe('the desktop keeps its own behaviour', () => {
  /**
   * `useIdeasFeed` and `useSignalCards` are also `IdeasFeedPage`. The policy is
   * per-key-root and undone on unmount, so leaving the mobile feed hands the
   * desktop back exactly what it had rather than pinning it too.
   */
  it('restores the previous defaults when the feed unmounts', async () => {
    const before = client.getQueryDefaults(['ideas-feed'])
    const { unmount } = renderHook(() => useFeedSessionStability(), { wrapper })
    expect(client.getQueryDefaults(['ideas-feed']).refetchOnMount).toBe(false)

    unmount()
    expect(client.getQueryDefaults(['ideas-feed']).refetchOnMount)
      .toBe(before?.refetchOnMount)
  })

  it('leaves queries outside the feed untouched', () => {
    renderHook(() => useFeedSessionStability(), { wrapper })
    expect(client.getQueryDefaults(['market-data']).refetchOnMount).toBeUndefined()
    expect(client.getQueryDefaults(['user-organizations']).refetchOnMount).toBeUndefined()
  })
})
