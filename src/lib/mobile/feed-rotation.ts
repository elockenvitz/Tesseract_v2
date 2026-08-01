/**
 * Keeps the phone feed from opening on the same post every time.
 *
 * `for_you` ranking is deterministic — freshness, author relevance, asset
 * relevance and quality are all stable for a given item — so with a slow-moving
 * content set the top of the feed is identical on every open. That is correct
 * ranking and a poor feed.
 *
 * Rather than randomising (which would break relevance ordering and make the
 * feed feel arbitrary), items already seen are demoted below unseen ones while
 * *relative* rank is preserved inside each group. The strongest new item still
 * leads; already-read posts fall behind it and remain reachable by scrolling.
 *
 * Seen state is per-user, in localStorage. Deliberately not a table: this is a
 * presentation concern, it must not cost a round-trip on open, and losing it
 * costs the user nothing worse than one repeated ordering.
 */

const KEY_PREFIX = 'tesseract:feed-seen:'
/** Enough to cover several sessions; old entries fall off the front. */
const MAX_TRACKED = 300
/** After this, an item is fair game to lead the feed again. */
const SEEN_TTL_MS = 3 * 24 * 60 * 60 * 1000

type SeenMap = Record<string, number>

function storageKey(userId: string) {
  return `${KEY_PREFIX}${userId}`
}

export function loadSeen(userId: string): SeenMap {
  if (typeof localStorage === 'undefined' || !userId) return {}
  try {
    const raw = localStorage.getItem(storageKey(userId))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as SeenMap
    const cutoff = Date.now() - SEEN_TTL_MS
    // Drop expired entries on read so the map cannot grow unbounded through
    // stale keys that are never revisited.
    return Object.fromEntries(Object.entries(parsed).filter(([, at]) => at > cutoff))
  } catch {
    return {}
  }
}

export function markSeen(userId: string, itemIds: string[]): void {
  if (typeof localStorage === 'undefined' || !userId || !itemIds.length) return
  try {
    const seen = loadSeen(userId)
    const now = Date.now()
    for (const id of itemIds) seen[id] = now

    const trimmed = Object.entries(seen)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_TRACKED)

    localStorage.setItem(storageKey(userId), JSON.stringify(Object.fromEntries(trimmed)))
  } catch {
    /* storage full or unavailable — rotation is a nicety, never a failure */
  }
}

/**
 * Unseen items first, then seen, with the incoming relevance order preserved
 * within each group. Stable: equal-status items keep their original positions.
 */
export function rotateBySeen<T extends { id: string }>(items: T[], seen: SeenMap): T[] {
  const unseen: T[] = []
  const alreadySeen: T[] = []
  for (const item of items) {
    if (seen[item.id]) alreadySeen.push(item)
    else unseen.push(item)
  }
  return [...unseen, ...alreadySeen]
}
