import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { FEED_QUERY_ROOTS, isFeedQueryKey } from '../../lib/mobile/feed-queries'

/**
 * The mobile feed composes ONCE per visit, and then holds still.
 *
 * ── What this replaces, and why ───────────────────────────────────────────
 *
 * `useFeedRefreshOnReturn`, which refetched every stale feed source when the
 * tab came back. It solved a problem nobody had. A reader working down the
 * feed who answers a message and comes back wants the card they left, in the
 * place they left it — and instead the list re-ranked underneath them, which
 * is the app moving their work rather than doing any.
 *
 * Freshness on this surface belongs to the FIRST composition. A working set
 * that was correct when it was built stays useful for as long as somebody is
 * working through it; one that re-sorts every time a phone is unlocked does
 * not. So this is the opposite policy, in the same seam.
 *
 * ── The three defaults being overridden, and what each one did ────────────
 *
 * `App.tsx` sets `refetchOnMount: true` and leaves `refetchOnReconnect` at
 * React Query's default of `true`. Both move the feed without anybody asking:
 *
 *   - `refetchOnReconnect` — a phone that backgrounds usually drops and
 *     reacquires the network, so a reconnect refetch is a focus refetch under
 *     another name. Removing the visibility listener without this would have
 *     left most of the behaviour in place and made it look fixed.
 *   - `refetchOnMount` — opening an asset and coming back REMOUNTS the
 *     dashboard. `feed-session` restores the seed and the scroll offset, so
 *     the reader lands on the right pixel of a list whose contents have
 *     meanwhile changed underneath them. Position without content is the
 *     worse half of the same bug the session restore exists to fix.
 *   - `refetchOnWindowFocus` is already false app-wide; set here anyway so
 *     this hook states the whole policy rather than depending on a default
 *     somebody could reasonably change for the desktop surfaces.
 *
 * ── What still recomposes, deliberately ───────────────────────────────────
 *
 * Nothing here touches an explicit refetch. Pull-to-refresh (`handleRefresh`),
 * a filter change, a browser reload and the `invalidateQueries` that follows a
 * write all still rebuild the feed, because all four are the reader asking. A
 * judgment recorded on a card still invalidates and redraws that card.
 *
 * ── Why it is set per-query and restored on unmount ───────────────────────
 *
 * `useIdeasFeed` and `useSignalCards` are also the DESKTOP feed
 * (`IdeasFeedPage`). Changing the defaults in `App.tsx` would pin them there
 * too, and the desktop has neither the backgrounding problem nor the session
 * to protect. `setQueryDefaults` is scoped to a key root and is undone when
 * this component unmounts, so leaving mobile hands the desktop back exactly
 * what it had.
 *
 * `staleTime: Infinity` is deliberately NOT set. Staleness is what makes a
 * deliberate refresh cheap and what a future "new updates available" check
 * would read. The queries may be stale; they simply must not act on it by
 * themselves.
 */
export function useFeedSessionStability(): void {
  const queryClient = useQueryClient()

  /**
   * Applied during RENDER, not in an effect — and this is load-bearing.
   *
   * Effects run after the commit. A remount (returning from an asset page)
   * re-creates the query observers in that same commit, so they read
   * `refetchOnMount` BEFORE an effect could set it and fire the refetch this
   * hook exists to prevent. Caught by `does not refetch on remount, even when
   * stale`, which failed by exactly one extra call.
   *
   * Writing to the client during render is a deliberate escape hatch, and a
   * safe one here: the write is idempotent, guarded by a ref so it happens
   * once per mount, and it configures a cache rather than touching React
   * state. It also means THIS HOOK MUST BE CALLED BEFORE THE FEED'S QUERY
   * HOOKS in the component body — in `MobileDashboard` it is the first thing
   * after the auth and org context it needs.
   */
  const previous = useRef<{ root: string; defaults: unknown }[] | null>(null)
  if (previous.current === null) {
    previous.current = FEED_QUERY_ROOTS.map(root => ({
      root,
      defaults: queryClient.getQueryDefaults([root]),
    }))
    for (const root of FEED_QUERY_ROOTS) {
      queryClient.setQueryDefaults([root], {
        refetchOnMount: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
      })
    }
  }

  useEffect(() => {
    return () => {
      // Hand the desktop back what it had, exactly. Restoring `{}` rather than
      // deleting is fine: React Query merges defaults over the client's own,
      // so an empty object reinstates the app-wide behaviour.
      for (const { root, defaults } of previous.current ?? []) {
        queryClient.setQueryDefaults([root], (defaults as object) ?? {})
      }
    }
  }, [queryClient])
}

/**
 * Re-exported so a caller reasoning about the policy has one import.
 *
 * The predicate is what a deliberate refresh and a future update-check both
 * need, and it must name the same eleven sources this hook pins.
 */
export { isFeedQueryKey, FEED_QUERY_ROOTS }
