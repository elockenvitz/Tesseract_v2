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
  /**
   * The base feed's order, as entry keys — the snapshot itself.
   *
   * ── Why remembering the POSITION was not enough ─────────────────────────
   *
   * The base order lives in a `useMemo`, and a memo is component state: the
   * dashboard unmounts when the reader opens an asset, so coming back
   * recomputes it from whatever the inputs say now. Several of those inputs
   * are written BY the visit that is being resumed:
   *
   *   - `visibleItems` is `rotateBySeen(ideas, seenAtMount)`, and the feed
   *     calls `markSeen` on its top ten 1.5s after mount. The second mount
   *     therefore loads a seen-map the first mount wrote, and `rotateBySeen`
   *     demotes exactly those ten behind every unseen idea. Guaranteed, on the
   *     first return, with no data change anywhere.
   *   - `interestAtMount` is re-snapshotted per mount from dwell telemetry the
   *     same session records.
   *   - `rankFeed` is handed `Date.now()`.
   *   - an `invalidateQueries` after any write refetches a source mid-visit.
   *
   * So the reader was returned to the right TILE in a feed whose surrounding
   * order had changed underneath it. Keeping the order here makes the snapshot
   * real rather than nominal.
   *
   * Append-only: see `rememberBaseOrder`.
   */
  baseOrder: string[] | null
  /**
   * The furthest the reader has actually been, as a count of tiles.
   *
   * -- Why the snapshot is no longer the whole feed --------------------------
   *
   * `baseOrder` used to hold the entire composed order, and
   * `reconcileToRemembered` held all of it in place. That kept the promise this
   * module exists for and cost something it did not need to: material arriving
   * later could only ever be APPENDED, because everything ahead of the reader
   * was already frozen. A page of posts fetched at the bottom of a long scroll
   * therefore landed after every tile in the feed rather than interleaving into
   * the stretch the reader was about to reach -- which is the one place a
   * varied feed most needs it.
   *
   * The promise was always narrower than the implementation. Nothing the reader
   * has PASSED may move. Material they have never seen is free to be composed,
   * because there is nothing on screen to keep still.
   *
   * So the snapshot is the read prefix and it grows as they scroll.
   * `reconcileToRemembered` needs no change at all: it holds what it knows and
   * puts the rest after, and "the rest" is now a composed tail rather than a
   * frozen one.
   *
   * -- Why a high-water mark and not the live position ----------------------
   *
   * A reader who scrolls back up still has tiles below them on screen. Reading
   * the live position would let those recompose while visible, which is the
   * same defect in miniature. This only ever rises, within a page lifetime.
   */
  readDepth: number
}

/**
 * The deeper of two depths, which is the only way `readDepth` is ever set.
 *
 * A named function rather than a `Math.max` at each call site, so the
 * monotonicity is stated once and the next caller cannot forget it.
 */
export function deepestRead(remembered: number | null | undefined, seen: number): number {
  return Math.max(remembered ?? 0, Number.isFinite(seen) ? Math.max(0, seen) : 0)
}

export function emptyContinuity(): FeedContinuity {
  return { family: null, position: { baseKey: null, viewKey: null }, baseOrder: null, readDepth: 0 }
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

/**
 * ── Why this module now writes to storage after all ───────────────────────
 *
 * The header above argues for a module-level Map, and the argument is right
 * for the case it considered: an in-app navigation keeps the bundle alive and
 * a reload evaluates the module afresh, which is the required lifetime with no
 * expiry check and no key to clean up.
 *
 * It assumed a reload is always the reader asking for one. On a phone it is
 * usually not. Reported from an iPhone: leave Safari for another app, come
 * back, and the feed is at the top. iOS evicts a backgrounded tab under memory
 * pressure and reloads it on return, and to this module that is
 * indistinguishable from a refresh — so the order and the tile were discarded
 * on a page load the reader never asked for and did not know had happened.
 *
 * So the snapshot survives in `sessionStorage`, which dies with the tab as it
 * should, and the RESTORE is gated on whether the page was hidden when it was
 * last written. See `markFeedHidden`.
 *
 * What is stored is small by construction. Since the freeze depth landed,
 * `baseOrder` holds the read prefix rather than the whole feed, so a reader ten
 * screens down persists a few dozen keys.
 */
const STORE_PREFIX = 'tesseract:feed-continuity:'
const HIDDEN_PREFIX = 'tesseract:feed-hidden:'

/**
 * How long a backgrounded feed is still the reader's place.
 *
 * Eight hours: a lunch, a meeting, a commute and an afternoon all count as
 * "where I was", and the next morning does not. `feed-session` draws the same
 * line at thirty minutes, which was chosen for an in-app navigation and is far
 * too short for "I put my phone down".
 */
const HIDDEN_TTL_MS = 8 * 60 * 60 * 1000

function storeKey(scopeKey: string): string { return `${STORE_PREFIX}${scopeKey}` }
function hiddenKey(scopeKey: string): string { return `${HIDDEN_PREFIX}${scopeKey}` }

/**
 * Record that the page went into the background, and when.
 *
 * This is the whole of how a system eviction is told apart from a refresh, and
 * it works because the two differ in what the page was doing when it died. A
 * reader who hits reload does it while LOOKING at the page. A tab iOS discards
 * was hidden at the time. So the marker is set on the way out of view and
 * cleared on the way back in, and a page that loads to find one knows it was
 * killed rather than refreshed.
 *
 * `performance.navigation` cannot answer this: both report `reload`.
 */
export function markFeedHidden(scopeKey: string | null, hidden: boolean): void {
  if (!scopeKey || typeof sessionStorage === 'undefined') return
  try {
    if (hidden) sessionStorage.setItem(hiddenKey(scopeKey), String(Date.now()))
    else sessionStorage.removeItem(hiddenKey(scopeKey))
  } catch {
    /* storage unavailable — the feed simply starts from the top */
  }
}

/** Whether this page load followed a background eviction rather than a refresh. */
export function wasFeedBackgrounded(scopeKey: string | null): boolean {
  if (!scopeKey || typeof sessionStorage === 'undefined') return false
  try {
    const at = Number(sessionStorage.getItem(hiddenKey(scopeKey)))
    return Number.isFinite(at) && at > 0 && Date.now() - at < HIDDEN_TTL_MS
  } catch {
    return false
  }
}

/** Write the in-memory snapshot out, so a killed tab can be handed it back. */
export function persistFeedContinuity(scopeKey: string | null): void {
  if (!scopeKey || typeof sessionStorage === 'undefined') return
  const current = BY_SCOPE.get(scopeKey)
  if (!current) return
  try {
    sessionStorage.setItem(storeKey(scopeKey), JSON.stringify(current))
  } catch {
    /* storage full — the position is a nicety, never a failure */
  }
}

/**
 * Read a persisted snapshot back into memory, once, at mount.
 *
 * Refuses unless the page was backgrounded, so a deliberate refresh still gets
 * the fresh feed it is asking for — which is the behaviour the module header
 * argues for and which this must not cost.
 *
 * Never overwrites a live entry. An in-app navigation already has the real
 * thing in memory and it is newer than anything on disk.
 */
export function hydrateFeedContinuity(scopeKey: string | null): boolean {
  if (!scopeKey || typeof sessionStorage === 'undefined') return false
  if (BY_SCOPE.has(scopeKey)) return false
  if (!wasFeedBackgrounded(scopeKey)) {
    try { sessionStorage.removeItem(storeKey(scopeKey)) } catch { /* nothing to do */ }
    return false
  }
  try {
    const raw = sessionStorage.getItem(storeKey(scopeKey))
    if (!raw) return false
    const parsed = JSON.parse(raw) as Partial<FeedContinuity>
    if (!parsed || typeof parsed !== 'object') return false
    BY_SCOPE.set(scopeKey, {
      family: parsed.family ?? null,
      position: {
        baseKey: parsed.position?.baseKey ?? null,
        viewKey: parsed.position?.viewKey ?? null,
      },
      baseOrder: Array.isArray(parsed.baseOrder) ? parsed.baseOrder : null,
      readDepth: typeof parsed.readDepth === 'number' ? parsed.readDepth : 0,
    })
    return true
  } catch {
    return false
  }
}

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
  patch: {
    family?: string | null
    position?: Partial<FeedPosition>
    baseOrder?: string[] | null
    readDepth?: number
  },
): void {
  if (!scopeKey) return
  const current = readFeedContinuity(scopeKey)
  BY_SCOPE.set(scopeKey, {
    family: patch.family !== undefined ? patch.family : current.family,
    position: { ...current.position, ...(patch.position ?? {}) },
    baseOrder: patch.baseOrder !== undefined ? patch.baseOrder : current.baseOrder,
    // Never rewritten downwards. See `deepestRead`.
    readDepth: patch.readDepth !== undefined
      ? deepestRead(current.readDepth, patch.readDepth)
      : current.readDepth,
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
  // The persisted copy goes with it, or a pull-to-refresh would be undone by
  // the next background eviction handing the old place straight back.
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.removeItem(storeKey(scopeKey))
    sessionStorage.removeItem(hiddenKey(scopeKey))
  } catch {
    /* nothing to do */
  }
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

/**
 * The nearest tile the reader can still be put on, using the order they left.
 *
 * ── Why the top is the wrong answer here ──────────────────────────────────
 *
 * `resolveAnchorIndex` falls back to the top and its reasoning holds where it
 * is used: a FILTER that does not contain the remembered tile is the reader
 * asking for something else, and landing them mid-list at an unrelated card
 * would be worse.
 *
 * Coming back to the same unfiltered feed is not that. The tile may be missing
 * for a reason that has nothing to do with the reader — a source refetched, a
 * card was answered and dropped, an insight aged out — and sending them to the
 * beginning of a feed they had scrolled five screens into is the failure this
 * whole module exists to prevent.
 *
 * So the remembered ORDER is walked outwards from where the tile was and the
 * NEAREST surviving neighbour is used — nearest on either side, because sending
 * the reader further from where they were to satisfy a direction rule would be
 * the same mistake in miniature. A tie goes backwards: the reader was moving
 * down the feed, so the tile above the gap is one they have already passed, and
 * landing there shows them whatever replaced the missing card rather than
 * skipping past it.
 *
 * Null when nothing from the remembered order survives, which the caller reads
 * as "there is no position to restore" rather than as "go to the top".
 */
export function nearestRememberedKey(
  baseOrder: readonly string[] | null,
  currentKeys: readonly string[],
  want: string | null,
): string | null {
  if (!want) return null
  const present = new Set(currentKeys)
  if (present.has(want)) return want
  if (!baseOrder) return null

  const at = baseOrder.indexOf(want)
  if (at < 0) return null

  for (let d = 1; d < baseOrder.length; d++) {
    const back = at - d
    if (back >= 0 && present.has(baseOrder[back])) return baseOrder[back]
    const fwd = at + d
    if (fwd < baseOrder.length && present.has(baseOrder[fwd])) return baseOrder[fwd]
  }
  return null
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

/**
 * Re-impose a remembered order on a freshly computed feed.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 *
 * An entry the snapshot knows keeps the place the snapshot gave it. An entry
 * it does not know is NEW, and goes after everything it does know, in whatever
 * order the ranker put it in.
 *
 * That is the conservative reading of "new findings may appear": they become
 * reachable without a single existing tile moving. Ranking a new arrival into
 * the middle would be a better feed and a worse promise — it is precisely the
 * list shifting under someone working down it.
 *
 * A remembered key with nothing to match is skipped rather than treated as a
 * gap, so a card that a refetch removed simply is not there, and one that
 * comes back later returns to its old place instead of being appended as if it
 * were new.
 *
 * With no snapshot, the ranker's order stands — that is the first visit of a
 * page lifetime, which is the one time the feed is allowed to be composed.
 */
export function reconcileToRemembered<T>(
  items: readonly { key: string; item: T }[],
  remembered: readonly string[] | null,
): { key: string; item: T }[] {
  if (!remembered || remembered.length === 0) return [...items]

  const byKey = new Map<string, { key: string; item: T }[]>()
  for (const entry of items) {
    const bucket = byKey.get(entry.key)
    if (bucket) bucket.push(entry)
    else byKey.set(entry.key, [entry])
  }

  const held: { key: string; item: T }[] = []
  const seen = new Set<string>()
  for (const key of remembered) {
    if (seen.has(key)) continue
    seen.add(key)
    const bucket = byKey.get(key)
    if (bucket) held.push(...bucket)
  }

  const fresh = items.filter(entry => !seen.has(entry.key))
  return [...held, ...fresh]
}

/**
 * Extend the snapshot with whatever is new, and never rewrite what it holds.
 *
 * Append-only is what makes `reconcileToRemembered` a fixed point: reconciling
 * and then remembering the result produces the same list again, so the two
 * cannot chase each other across renders. It is also what lets a tile that
 * vanished from one refetch return to its original place rather than to the
 * end.
 */
export function rememberBaseOrder(
  remembered: readonly string[] | null,
  currentKeys: readonly string[],
): string[] {
  if (!remembered || remembered.length === 0) return [...currentKeys]
  const known = new Set(remembered)
  const added = currentKeys.filter(key => !known.has(key))
  return added.length ? [...remembered, ...added] : [...remembered]
}
