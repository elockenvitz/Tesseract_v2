import { useEffect, useRef, useState } from 'react'

import { loadSeen, type SeenMap } from '../../lib/mobile/feed-rotation'
import { loadInterest, type InterestVector } from '../../lib/mobile/feed-telemetry'

/**
 * What the feed knows about THIS reader, snapshotted, and re-snapshotted when
 * the reader changes.
 *
 * ── Why they are snapshots ────────────────────────────────────────────────
 *
 * `rotateBySeen` demotes what has already been read and `interestScore` boosts
 * what the reader dwells on. Both read stores that this same session is
 * writing to as the reader scrolls. Reading them live would re-rank the list
 * underneath the thumb — the card being looked at is the card being recorded,
 * so it would move the moment it was read. Frozen for the life of a mount is
 * the correct behaviour and the reason these were `useState` initialisers.
 *
 * ── Why they could not stay plain initialisers ────────────────────────────
 *
 * They were keyed on a reader who is not always known yet. `useAuth` seeds
 * `user` from `auth-user-cache` and only then confirms the session against the
 * server, so `userId` is `undefined` for the first frames of a cold start —
 * and `loadSeen('')` / `loadInterest('')` both return empty by design, since
 * there is no such reader.
 *
 * A `useState` initialiser runs once. A mount that began in that window
 * therefore kept the ANONYMOUS snapshot for its entire life: nothing demoted,
 * nothing personalised, and no correction short of a reload. `dispositions` in
 * `MobileDashboard` already had a `[userId]` effect for exactly this reason;
 * these two did not, and that asymmetry was an oversight rather than a
 * decision. It is the shape of "the first feed looked like a different, older
 * feed until I refreshed".
 *
 * ── Why the ref, and why identity is the trigger ──────────────────────────
 *
 * The effect must fire when the READER changes and never when the stores
 * change, or it reintroduces exactly the live re-ranking the snapshots exist
 * to prevent. The ref holds whose snapshot is currently loaded; an effect that
 * finds them unchanged does nothing at all, so scrolling, dwelling and marking
 * things seen never disturb the order.
 *
 * `undefined` and `''` are the same reader — nobody — so resolving from one to
 * the other does not re-snapshot twice.
 */
export interface ReaderSnapshots {
  /** What this reader has already been shown, for demotion. */
  seenAtMount: SeenMap
  /** What this reader dwells on, for ranking. */
  interestAtMount: InterestVector
}

export function useReaderSnapshots(userId: string | null | undefined): ReaderSnapshots {
  const [seenAtMount, setSeenAtMount] = useState<SeenMap>(() => loadSeen(userId ?? ''))
  const [interestAtMount, setInterestAtMount] = useState<InterestVector>(
    () => loadInterest(userId ?? ''),
  )

  // Whose snapshot is loaded right now. Not state: it must be readable and
  // writable inside the effect without scheduling a render of its own.
  const loadedFor = useRef<string>(userId ?? '')

  useEffect(() => {
    const id = userId ?? ''
    if (loadedFor.current === id) return
    loadedFor.current = id
    setSeenAtMount(loadSeen(id))
    setInterestAtMount(loadInterest(id))
  }, [userId])

  return { seenAtMount, interestAtMount }
}
