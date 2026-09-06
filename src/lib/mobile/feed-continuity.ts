/**
 * The feed's position and filter, held in memory for the life of the tab.
 *
 * ── What this is for ──────────────────────────────────────────────────────
 *
 * Four promises the feed makes, and could not keep while filtering rebuilt it:
 *
 *   1. Tapping a tile's pill filters to that exact tile type.
 *   2. The tapped tile stays under the reader's thumb while it happens.
 *   3. Clearing the filter restores the original order AND the original tile.
 *   4. Leaving and coming back restores the filter, the tile within it, and
 *      the place in the unfiltered feed underneath.
 *
 * All four are the same requirement wearing four hats: ONE base order is
 * computed per visit, every filter is a derived VIEW over it, and position is
 * remembered as a stable entry key rather than an offset into an array that
 * the next filter change would renumber.
 *
 * ── Why a module-level Map and not storage ────────────────────────────────
 *
 * The lifetime has to be exactly "this page load". `feed-session` uses
 * sessionStorage, which outlives a reload — correct for the seed it carries,
 * wrong here, because a reload is the one moment the reader IS asking for a
 * fresh feed. A module holds its state for as long as the bundle is live, so
 * an in-app navigation keeps it and a refresh evaluates the module again and
 * gets nothing. That is the required lifetime with no expiry check, no
 * `performance.navigation` sniffing and no key to clean up.
 *
 * It is also not React state. The dashboard UNMOUNTS when the reader opens an
 * asset, so anything held in a hook is gone by the time they come back, which
 * is precisely the navigation this has to survive.
 *
 * Pure of React and of storage. Imported by the dashboard and the tests alike.
 */

/** Where the reader is, named by entry key rather than by index. */
export interface FeedPosition {
  /**
   * The tile in the UNFILTERED base order.
   *
   * Kept even while a filter is active, because clearing the filter has to
   * return to where the reader was before they set it — not to wherever the
   * filtered tile happens to sit in the full list.
   */
  baseKey: string | null
  /**
   * The tile within the active view.
   *
   * Moving inside a filtered feed must survive leaving and returning, and it
   * is not the same tile as `baseKey` the moment the reader scrolls.
   */
  viewKey: string | null
}

export interface FeedContinuity {
  /**
   * The active tile-type filter, in the family vocabulary `familyOf` speaks —
   * `portfolio:<issue>`, `research:<framing>`, or a bare `SignalType`.
   *
   * One key, not a list. The pill answers "only this kind of tile", and a set
   * of them is what the Curate sheet is for.
   */
  family: string | null
  position: FeedPosition
}

export function emptyContinuity(): FeedContinuity {
  return { family: null, position: { baseKey: null, viewKey: null } }
}

/**
 * Whose feed, in which organization — the same scoping rule `feed-session`
 * applies, for the same reason: one reader's place is not another's, and an
 * org switch lands in a feed that does not contain the remembered tile.
 *
 * Null while either is unresolved. The dashboard's first render can precede
 * the org query, and remembering a position under a partial scope would file
 * it where the next render cannot find it and a different reader could.
 */
export function feedScopeKey(scope: {
  userId: string | null | undefined
  orgId: string | null | undefined
}): string | null {
  if (!scope.userId || !scope.orgId) return null
  return `${scope.userId}:${scope.orgId}`
}

const BY_SCOPE = new Map<string, FeedContinuity>()

export function readFeedContinuity(scopeKey: string | null): FeedContinuity {
  if (!scopeKey) return emptyContinuity()
  return BY_SCOPE.get(scopeKey) ?? emptyContinuity()
}

/**
 * Merge, never replace.
 *
 * `position` takes a PARTIAL deliberately: the two anchors are written by
 * different events — scrolling inside a filter moves `viewKey` alone, and
 * clearing a filter must leave `baseKey` exactly where entering it put one.
 * A whole-object write would make every caller responsible for preserving the
 * half it does not care about, and the first one to forget would silently lose
 * the reader's place.
 */
export function writeFeedContinuity(
  scopeKey: string | null,
  patch: { family?: string | null; position?: Partial<FeedPosition> },
): void {
  if (!scopeKey) return
  const current = readFeedContinuity(scopeKey)
  BY_SCOPE.set(scopeKey, {
    family: patch.family !== undefined ? patch.family : current.family,
    position: { ...current.position, ...(patch.position ?? {}) },
  })
}

/**
 * Forget a scope, or all of them.
 *
 * Used by pull-to-refresh, which IS the reader asking for a new feed, and by
 * tests standing in for a page load. Nothing else should call it: an ordinary
 * filter change must not clear the position it exists to protect.
 */
export function clearFeedContinuity(scopeKey?: string | null): void {
  if (scopeKey == null) {
    BY_SCOPE.clear()
    return
  }
  BY_SCOPE.delete(scopeKey)
}

/**
 * The filtered feed, as a view over the base order.
 *
 * A `filter` and not a re-sort, so the surviving tiles are in exactly the
 * order the base put them in. That is what makes clearing the filter free:
 * the base was never touched, so there is nothing to restore it from.
 *
 * `familyOf` is injected rather than imported so this stays free of the
 * classifier and testable against plain objects.
 */
export function deriveFeedView<T>(
  base: readonly T[],
  familyOf: (item: T) => string | null,
  family: string | null,
): T[] {
  if (!family) return [...base]
  return base.filter(item => familyOf(item) === family)
}

/**
 * Where a remembered key sits now, or -1.
 *
 * The whole point of keying by identity: a tile's index changes with every
 * filter toggle and its key does not.
 */
export function indexOfKey(keys: readonly string[], key: string | null): number {
  if (!key) return -1
  return keys.indexOf(key)
}

/**
 * The tile to land on, given what was remembered.
 *
 * Falls back to the top rather than to a neighbour. A remembered tile that the
 * current view does not contain means the reader asked for something it is not
 * part of — landing them mid-list at an unrelated card would be a worse answer
 * than the beginning, and a silent one.
 */
export function resolveAnchorIndex(keys: readonly string[], key: string | null): number {
  const at = indexOfKey(keys, key)
  return at >= 0 ? at : 0
}

/** One slot's measured position within the scroller. */
export interface SlotOffset {
  key: string
  top: number
}

/**
 * Which tile the reader is on, from measured slot positions.
 *
 * The last slot that has reached the top of the scroller. On a snap feed that
 * is unambiguous for a settled scroll, and during a flick it names the tile
 * being left rather than an arbitrary one — which is the right answer, because
 * the position is only ever read after the scroll stops.
 *
 * `offsets` need not be sorted; nothing downstream guarantees DOM order.
 */
export function anchorKeyAt(offsets: readonly SlotOffset[], scrollTop: number): string | null {
  let best: SlotOffset | null = null
  for (const slot of offsets) {
    // A pixel of tolerance: a snapped scroller routinely settles a fraction
    // short of the offset it snapped to, and without this the reader is
    // reported one tile above the one filling their screen.
    if (slot.top > scrollTop + 1) continue
    if (!best || slot.top > best.top) best = slot
  }
  // Above the first slot — or nothing measured yet — is the top of the feed.
  if (best) return best.key
  let first: SlotOffset | null = null
  for (const slot of offsets) if (!first || slot.top < first.top) first = slot
  return first?.key ?? null
}
