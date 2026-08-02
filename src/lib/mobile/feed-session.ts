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

const KEY = 'tesseract:feed-session'
/** Beyond this, treat it as a new visit and start fresh. */
const MAX_AGE_MS = 30 * 60 * 1000

export interface FeedSession {
  /** Shuffle seed, so the restored order matches the remembered offset. */
  seed: number
  scrollTop: number
  /** How many extra cycles of derived insights had been appended. */
  cycle: number
  savedAt: number
}

export function loadFeedSession(): FeedSession | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as FeedSession
    if (typeof parsed?.seed !== 'number') return null
    if (Date.now() - (parsed.savedAt ?? 0) > MAX_AGE_MS) return null
    return parsed
  } catch {
    return null
  }
}

export function saveFeedSession(session: Omit<FeedSession, 'savedAt'>): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...session, savedAt: Date.now() }))
  } catch {
    /* storage full or unavailable — the feed simply starts from the top */
  }
}

export function clearFeedSession(): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* nothing to do */
  }
}
