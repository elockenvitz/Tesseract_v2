import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { loadDispositions, type DispositionMap } from '../../lib/signals/dispositions'
import { fetchDurableDispositions, mergeDispositions } from '../../lib/signals/disposition-sync'

/**
 * What this reader has already decided about — from the durable store, with
 * `localStorage` underneath it.
 *
 * ── The rule this preserves ───────────────────────────────────────────────
 *
 * `MobileDashboard` snapshots dispositions once per mount and refreshes only on
 * an explicit triage or dismissal. That is not a storage decision, it is a
 * scroll-stability one: applied live, a suppression would delete the card under
 * the reader's thumb and jump the feed mid-scroll. Swapping the source must not
 * quietly swap that behaviour too, so the hook returns a value that changes
 * only when something asks it to:
 *
 *   - the durable query resolving, once, on mount
 *   - `refreshLocal()`, called by the same two handlers that called
 *     `setDispositions(loadDispositions(...))` before
 *
 * `refetchOnWindowFocus` is off for exactly this reason. A reader coming back
 * to the tab should find the feed where they left it, not two cards shorter.
 *
 * ── Layering ──────────────────────────────────────────────────────────────
 *
 * Local first paint, durable on top. The local read is synchronous, so the
 * first frame already suppresses what this browser knows about; the query then
 * adds what every other device knows. Server wins on conflict — see
 * `mergeDispositions`.
 *
 * A failed or unresolved query yields the local map alone, which is exactly the
 * behaviour before this stage. Nothing about the feed depends on the network
 * being there.
 */

export function feedDispositionsKey(userId: string): (string | number)[] {
  return ['feed-dispositions', userId]
}

export interface UseFeedDispositionsResult {
  /** The merged map, in the shape `feed-priority` and `judgment-policy` already read. */
  dispositions: DispositionMap
  /** Re-read `localStorage` after a write. The durable half refreshes itself. */
  refreshLocal: () => void
  /** Drop the cached durable map so the next mount refetches. */
  invalidate: () => void
}

export function useFeedDispositions(userId: string | null | undefined): UseFeedDispositionsResult {
  const queryClient = useQueryClient()
  const id = userId ?? ''

  // Snapshotted, for the scroll-stability reason above. `loadDispositions` is
  // synchronous and cheap; this is a state cell rather than a `useMemo` because
  // the two write handlers need to be able to advance it deliberately.
  const [local, setLocal] = useState<DispositionMap>(() => loadDispositions(id))
  useEffect(() => { setLocal(loadDispositions(id)) }, [id])

  const { data: durable } = useQuery({
    queryKey: feedDispositionsKey(id),
    queryFn: () => fetchDurableDispositions(id),
    enabled: !!id,
    // Long enough that scrolling the feed never triggers a refetch, short
    // enough that a second device converges within a session.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    // An empty map is the honest fallback: no suppression, so a card the reader
    // answered elsewhere appears once more. Failing open is the right direction
    // for a feed — showing something twice is a nuisance, hiding something the
    // reader never dismissed is not.
    retry: 1,
  })

  const dispositions = useMemo(
    () => mergeDispositions(local, durable ?? {}),
    [local, durable],
  )

  const refreshLocal = useCallback(() => { setLocal(loadDispositions(id)) }, [id])

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: feedDispositionsKey(id) })
  }, [queryClient, id])

  return { dispositions, refreshLocal, invalidate }
}
