/**
 * Remembers where the user was in the feed across navigation.
 *
 * Opening an asset and coming back remounts the dashboard, which previously
 * reset the scroll to the top *and* reshuffled the order — so the card the
 * user had just left was not merely off-screen, it was somewhere else
 * entirely. Both have to be restored together: position without order is
 * meaningless, since offset N points at a different card once the deck is
 * re-dealt.
 *
 * sessionStorage rather than localStorage: resuming mid-feed is right within a
 * browsing session and wrong the next morning, when the user wants today's
 * feed from the top. The age check covers long-lived mobile tabs, where a
 * session can persist for days.
 */

import { wasFeedBackgrounded } from './feed-continuity'

/**
 * The unscoped key this used to live under, kept only so it can be deleted.
 *
 * It was one entry for the whole origin: user A's seed and offset were user
 * B's, and org X's were org Y's. Nothing in it is intelligence — a seed, a
 * cycle and a scroll offset — so nothing leaked, but "restore me where I was"
 * restored somebody else's place, and after an org switch it restored a
 * position in a feed that no longer contained those cards.
 *
 * It is NOT migrated into a scoped key. There is no way to know whose it was,
 * and guessing means assigning one reader's position to whoever opens the tab
 * next — the exact bug the scoping exists to prevent. It is removed on the
 * first scoped read instead.
 */
const LEGACY_KEY = 'tesseract:feed-session'
const KEY_PREFIX = 'tesseract:feed-session:'
/** Beyond this, treat it as a new visit and start fresh. */
const MAX_AGE_MS = 30 * 60 * 1000
/**
 * The same window, for a tab the system killed while it was in the background.
 *
 * Eight hours, matching `feed-continuity`'s own. The two have to agree: the
 * order and the position are restored by that module and the seed and cycle by
 * this one, and a feed handed back half of each would land the reader at an
 * offset into a shorter list than the one they left.
 */
const BACKGROUND_MAX_AGE_MS = 8 * 60 * 60 * 1000

/**
 * Whose feed, in which organization.
 *
 * Both are required. A session saved without them is a session that cannot be
 * safely handed back — see `scopedKey`, which refuses rather than falling back
 * to a shared entry.
 */
export interface FeedSessionScope {
  userId: string | null | undefined
  orgId: string | null | undefined
}

/**
 * Null whenever the reader is not fully identified.
 *
 * The dashboard's first render can happen before the org query resolves, and
 * writing under a partial scope then would produce an entry that the next
 * render — now fully identified — cannot find, and that a DIFFERENT reader
 * could. Not saving is the correct behaviour for the fraction of a second
 * before both are known.
 */
function scopedKey(scope: FeedSessionScope): string | null {
  const { userId, orgId } = scope
  if (!userId || !orgId) return null
  return `${KEY_PREFIX}${userId}:${orgId}`
}

/** Drop the pre-scoping entry the first time we look for a scoped one. */
function dropLegacy(): void {
  try {
    sessionStorage.removeItem(LEGACY_KEY)
  } catch {
    /* nothing to do */
  }
}

export interface FeedSession {
  /** Shuffle seed, so the restored order matches the remembered offset. */
  seed: number
  scrollTop: number
  /** How many extra cycles of derived insights had been appended. */
  cycle: number
  savedAt: number
}

/**
 * True when this page load was an explicit reload rather than an in-app
 * navigation. A reload is the user asking for a fresh feed; restoring the
 * previous order and position in that case makes refreshing look broken.
 */
function isPageReload(): boolean {
  if (typeof performance === 'undefined') return false
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    return nav?.type === 'reload'
  } catch {
    return false
  }
}

export function loadFeedSession(scope: FeedSessionScope): FeedSession | null {
  if (typeof sessionStorage === 'undefined') return null
  dropLegacy()
  const key = scopedKey(scope)
  if (!key) return null
  /**
   * Resume for an in-app navigation, and for a tab the system killed.
   *
   * ── What the reload check was getting wrong ─────────────────────────────
   *
   * Its reasoning holds and is kept: a browser refresh looked identical to
   * returning from an asset page, so it restored the same seed and offset and
   * the feed appeared not to change at all.
   *
   * It assumed a reload is always the reader asking for one. On a phone it
   * usually is not. Reported from an iPhone: leave Safari for another app,
   * come back, and the feed is at the top — because iOS evicts a backgrounded
   * tab under memory pressure and reloads it on return, and
   * `performance.navigation` calls that a reload too.
   *
   * `wasFeedBackgrounded` is the thing that tells them apart: a reader who
   * hits refresh is LOOKING at the page, and a tab iOS discards was hidden.
   */
  const backgrounded = wasFeedBackgrounded(`${scope.userId}:${scope.orgId}`)
  if (isPageReload() && !backgrounded) {
    clearFeedSession(scope)
    return null
  }
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as FeedSession
    if (typeof parsed?.seed !== 'number') return null
    /**
     * A longer window for a phone that was put down.
     *
     * Thirty minutes was chosen for an in-app navigation, where it is generous.
     * It is far too short for "I switched apps", which is the case this now
     * also serves — a meeting, a commute or an afternoon all count as "where I
     * was", and the next morning still does not.
     */
    const maxAge = backgrounded ? BACKGROUND_MAX_AGE_MS : MAX_AGE_MS
    if (Date.now() - (parsed.savedAt ?? 0) > maxAge) return null
    return parsed
  } catch {
    return null
  }
}

export function saveFeedSession(scope: FeedSessionScope, session: Omit<FeedSession, 'savedAt'>): void {
  if (typeof sessionStorage === 'undefined') return
  const key = scopedKey(scope)
  if (!key) return
  try {
    sessionStorage.setItem(key, JSON.stringify({ ...session, savedAt: Date.now() }))
  } catch {
    /* storage full or unavailable — the feed simply starts from the top */
  }
}

export function clearFeedSession(scope: FeedSessionScope): void {
  if (typeof sessionStorage === 'undefined') return
  dropLegacy()
  const key = scopedKey(scope)
  if (!key) return
  try {
    sessionStorage.removeItem(key)
  } catch {
    /* nothing to do */
  }
}
