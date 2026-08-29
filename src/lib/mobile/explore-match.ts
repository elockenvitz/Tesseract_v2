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
  /** The preview's own identity. NOT a reliable source of its type. */
  dedupeKey: string
  /**
   * The id of the ROW this preview came from, where its source has one.
   *
   * ── Why type and asset were not enough ──────────────────────────────────
   *
   * They identify a FINDING, and a finding is unique per name: an asset has one
   * missing-target card, one conviction gap, one scenario breach. The whole
   * matcher was written against that assumption and it holds for every derived
   * card in the feed.
   *
   * It does not hold for the one family that is not derived. A desk posts as
   * many trade ideas and thoughts about NVDA as it likes, and every one of them
   * carries the same signal type and the same asset. `matchScore` therefore
   * scored all of them 2, `findExploreMatch` kept the first, and tapping the
   * third idea on a name opened the first — the reader spends a tap and gets a
   * different colleague's post about the same company, which reads exactly like
   * the app ignoring them.
   *
   * The id was on both sides the whole time: the preview's `dedupeKey` is
   * `post:<id>` and the entry's ranking id is `idea:<type>:<id>`. Declared here
   * rather than parsed back out of the key, for the same reason `signalType` is
   * declared — a dedupe key is built from whatever local vocabulary the adapter
   * had, and reading identity out of one is how this class of bug arrives.
   *
   * Absent for a derived card, which genuinely has no row behind it, and for an
   * aggregate, which stands for many.
   */
  objectId?: string | null
  /**
   * The declared type, where the adapter set one. Null for aggregates.
   *
   * Preferred over the dedupe key in every case, because the key's prefix was
   * never a `SignalType` — see `ExploreItem.signalType`.
   */
  signalType?: string | null
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

/**
 * The signal type a preview is about.
 *
 * The declared field wins. The dedupe-key prefix survives only as a fallback
 * for anything not yet migrated, and it is a poor one: the adapters built
 * those keys from local vocabulary — `conviction`, `post`, `attention`,
 * `economic`, each insight's own `kind` — none of which are `SignalType`
 * values. Matching on it failed for whole families of tile, which is why
 * tapping them fell through to "this one lives on its own surface" when a
 * perfectly good Level-2 card existed.
 */
export function targetType(t: ExploreTarget): string {
  return t.signalType ?? t.dedupeKey.split(':')[0]
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

  /**
   * The row itself, where the preview knows which one it is.
   *
   * Ranked above the asset deliberately: several posts can share one name, and
   * on those the asset says only "about the right company" while this says
   * "the one they tapped". Below the type check, so an id that happened to
   * appear inside an unrelated kind's ranking id cannot pull a match across
   * families.
   */
  const wantObject = t.objectId ?? null
  if (wantObject && e.id.includes(wantObject)) return 4

  const wantAsset = t.assetId ?? null
  const wantSymbol = t.symbol ? t.symbol.toUpperCase() : null
  const hasAsset = wantAsset ? e.id.includes(wantAsset) : false
  const hasSymbol = wantSymbol && e.symbol ? e.symbol.toUpperCase() === wantSymbol : false

  /**
   * A preview that NAMES its row and did not find it is not answered by a
   * sibling that merely shares the name.
   *
   * Without this, the id fix would be cosmetic: the second NVDA idea would
   * still fall through to the asset clause and still open the first one.
   */
  if (wantObject) return 0

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
