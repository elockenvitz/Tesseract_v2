/**
 * Finding the feed entry an Explore preview came from.
 *
 * ── Why this is not just "the card for that asset" ────────────────────────
 *
 * Tapping a preview must open THAT object's full tile — a no-target preview
 * opens the no-target card, a scenario preview opens the scenario card. The
 * matcher did this:
 *
 *     if (focus.assetId && input.id.includes(focus.assetId)) return true
 *     return input.type === wantType && ...
 *
 * The first line short-circuits on the asset alone. A name usually carries
 * several findings at once — that is the entire premise of the feed — so
 * tapping "NVDA has no price target" would open whichever NVDA card happened
 * to be earliest in the pool, often the active-risk one. The reader taps a
 * specific finding and gets a different one about the same company, which
 * reads as the app ignoring the tap.
 *
 * Both facts have to agree. An asset match alone is not an object match.
 *
 * Pure — takes already-extracted descriptors so it can be tested without a
 * feed, a query client, or a rendered card.
 */

export interface ExploreTarget {
  /** `signalType:asset` — the preview's own identity. */
  dedupeKey: string
  assetId?: string | null
  symbol?: string | null
}

export interface EntryDescriptor {
  /** The ranked signal type for this entry. */
  type: string
  /** The ranking id, which embeds the asset id where there is one. */
  id: string
  /** The entry's symbol, however its kind happens to store it. */
  symbol?: string | null
}

/** The signal type a preview is about. */
export function targetType(t: ExploreTarget): string {
  return t.dedupeKey.split(':')[0]
}

/**
 * Score how well an entry answers a preview. Higher is better; 0 is no match.
 *
 * Scored rather than boolean because more than one entry can legitimately
 * satisfy the type, and the one that also matches the asset is the right
 * answer. Returning the first type match would reopen the same class of bug
 * from the other direction.
 */
export function matchScore(t: ExploreTarget, e: EntryDescriptor): number {
  if (e.type !== targetType(t)) return 0

  const wantAsset = t.assetId ?? null
  const wantSymbol = t.symbol ? t.symbol.toUpperCase() : null
  const hasAsset = wantAsset ? e.id.includes(wantAsset) : false
  const hasSymbol = wantSymbol && e.symbol ? e.symbol.toUpperCase() === wantSymbol : false

  // Type and asset both agree: this is the object the reader tapped.
  if (hasAsset) return 3
  if (hasSymbol) return 2

  /**
   * The type matches and the preview names no asset at all — a template with
   * no ticker, a workflow item. That is a legitimate match, and ranked below
   * the identified ones so it can never beat them.
   */
  if (!wantAsset && !wantSymbol) return 1

  // Type matches but the preview IS about a specific name and this entry is
  // about a different one. Not a match; opening it would be the original bug.
  return 0
}

/**
 * The best entry for a preview, or null.
 *
 * Null is a real answer: a post, an aggregate, or a template with no ticker
 * has no Level-2 card, and the overlay says so rather than inventing one.
 */
export function findExploreMatch<T>(
  t: ExploreTarget,
  entries: T[],
  describe: (e: T) => EntryDescriptor,
): T | null {
  let best: T | null = null
  let bestScore = 0
  for (const e of entries) {
    const score = matchScore(t, describe(e))
    // Strictly greater, so the FIRST entry at the winning score wins and the
    // result is stable — the feed's own order decides ties.
    if (score > bestScore) { best = e; bestScore = score }
  }
  return best
}
