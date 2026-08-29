import { useEffect } from 'react'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'

import { isFeedQueryKey } from '../../lib/mobile/feed-queries'

/**
 * Coming back to Mobile Ideas refreshes it, and says so.
 *
 * ── The problem ───────────────────────────────────────────────────────────
 *
 * `App.tsx` sets `refetchOnWindowFocus: false` app-wide. On a desktop that is
 * a reasonable default — a tab in the background is usually a tab somebody
 * alt-tabbed past. On a phone it is the wrong default for the one surface
 * people leave and return to constantly: backgrounding Safari to answer a
 * message and coming back is the normal way this feed is used, and the feed
 * came back showing exactly what it showed before, however old, with nothing
 * to say so. The only way to get current intelligence was a manual reload —
 * which is what a reader reported as "it felt like a different, stale version
 * until I refreshed".
 *
 * ── Why this is a hook and not a change to the defaults ───────────────────
 *
 * Turning `refetchOnWindowFocus` on globally would change every query in the
 * application, including the desktop Ideas feed, the ops views and every
 * editor — dozens of surfaces, one of which this pass is explicitly not
 * allowed to touch. `useIdeasFeed` and `useSignalCards` are shared with
 * `IdeasFeedPage`, so setting the option inside them has the same problem.
 *
 * So the policy lives where the surface does. It is still React Query's own
 * machinery — `refetchQueries` with a predicate — not a timer and not a poll.
 */

/**
 * Refetch the feed's STALE queries when the tab becomes visible again, and
 * when the network comes back.
 *
 * ── Why `isStale()` and not `invalidateQueries` ───────────────────────────
 *
 * `invalidateQueries` marks matching queries stale and then refetches them, so
 * every return to the tab would re-request all eleven sources no matter how
 * recently they were fetched — a reader flicking between apps would refetch
 * the whole feed several times a minute. Asking each query whether it is
 * actually stale defers to the staleTime the hook already declares: 30 seconds
 * for the feed itself, five minutes for the scenario cards, thirty for the
 * facets. Return after ten seconds and nothing fires.
 *
 * `type: 'active'` so a query nobody is rendering — a filter combination
 * scrolled past, a previous org's cached pages — is not refetched to keep a
 * cache entry warm that nothing is reading.
 *
 * Bound to `visibilitychange`, which is the event iOS Safari actually delivers
 * when a tab is foregrounded; `focus` alone does not fire reliably there.
 */
export function useFeedRefreshOnReturn(enabled: boolean = true): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!enabled) return
    if (typeof document === 'undefined') return

    const refetchStale = () => {
      void queryClient.refetchQueries({
        type: 'active',
        predicate: q => isFeedQueryKey(q.queryKey) && q.isStale(),
      })
    }

    const onVisible = () => {
      // Leaving is not an event. Only the return is.
      if (document.visibilityState !== 'visible') return
      refetchStale()
    }

    document.addEventListener('visibilitychange', onVisible)
    // Reconnect matters for the same reason and is a different signal: a phone
    // that never left the foreground but lost the network for two minutes has
    // stale data and no visibility transition to hang a refetch on.
    window.addEventListener('online', refetchStale)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', refetchStale)
    }
  }, [enabled, queryClient])
}

/**
 * True while any feed source is fetching fresh data over data already on
 * screen.
 *
 * `useIsFetching` counts fetches in flight, which includes the FIRST one. The
 * caller passes `ready` — false until the composing gate has cleared — so this
 * can only ever be true for a background refresh. During the initial load the
 * feed shows its own loader, and a card that says "Updating…" over a spinner
 * is two claims about one wait.
 *
 * Deliberately not a count and not a list of what is refreshing. The reader is
 * being told "what you are looking at is being checked", which is one fact.
 */
export function useFeedIsUpdating(ready: boolean): boolean {
  const fetching = useIsFetching({
    predicate: q => isFeedQueryKey(q.queryKey),
  })
  return ready && fetching > 0
}
