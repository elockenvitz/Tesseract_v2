/**
 * The reader's answers, kept current without polling.
 *
 * ── What this is for ──────────────────────────────────────────────────────
 *
 * Judgment suppression is decided from `localStorage` — see `dispositions` for
 * why that is the right store for "which cards has this reader dealt with".
 * localStorage is synchronous and free to read, so the interesting part of this
 * hook is not the read: it is knowing WHEN to read again.
 *
 * Three things can change what should be on screen, and each is handled by
 * asking again at the right moment rather than by a timer:
 *
 *   · this tab records an answer   → `DISPOSITIONS_CHANGED_EVENT`
 *   · another tab records one      → the browser's own `storage` event
 *   · a snooze runs out            → nothing at all, deliberately
 *
 * The third is the one worth stating. A snooze does not expire by being
 * watched; it expires by being asked again with a later clock, because
 * `acknowledgmentFor` compares `now` against the stored window every time the
 * feed is evaluated. So the card comes back on the next evaluation — a refetch,
 * a remount, a window focus — and no interval exists whose only job is to
 * notice that a week has passed. An interval would also be worse than useless:
 * it would re-key the feed on a timer and move the page under the reader.
 *
 * ── Why a snapshot, and not a live read per card ──────────────────────────
 *
 * Same reason `MobileDashboard` snapshots it: a disposition applied mid-scroll
 * would delete a card under the reader and jump the feed. State changes when an
 * event says it changed, and the surface re-renders once, as a unit.
 *
 * Filed under `hooks/ideas` because the Ideas feed is its only consumer today —
 * mobile keeps its own state because it also writes, and each write site
 * already refreshes. Nothing here is Ideas-specific if a second surface wants
 * it.
 */

import { useEffect, useState } from 'react'
import {
  DISPOSITIONS_CHANGED_EVENT,
  loadDispositions,
  type DispositionMap,
} from '../../lib/signals/dispositions'

const EMPTY: DispositionMap = {}

export function useDispositions(userId: string | null | undefined): DispositionMap {
  const [dispositions, setDispositions] = useState<DispositionMap>(
    () => (userId ? loadDispositions(userId) : EMPTY),
  )

  useEffect(() => {
    if (!userId) {
      setDispositions(EMPTY)
      return
    }
    const reread = () => setDispositions(loadDispositions(userId))
    reread()

    /**
     * Only this user's key, and only when the value actually moved.
     *
     * `storage` fires for every key on the origin. Re-reading on an unrelated
     * write would replace the map with an equal-but-different object and
     * re-key every query that depends on it — a refetch caused by somebody
     * else's cache entry.
     */
    const onStorage = (e: StorageEvent) => {
      if (e.key && !e.key.endsWith(userId)) return
      reread()
    }

    window.addEventListener(DISPOSITIONS_CHANGED_EVENT, reread)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(DISPOSITIONS_CHANGED_EVENT, reread)
      window.removeEventListener('storage', onStorage)
    }
  }, [userId])

  return dispositions
}
