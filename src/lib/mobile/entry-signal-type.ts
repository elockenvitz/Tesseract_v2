/**
 * The `SignalType` a feed entry's card will carry — resolved from the ENTRY.
 *
 * ── The defect this exists to close ───────────────────────────────────────
 *
 * Manual QA on a phone: most tile pills did nothing when tapped, and no
 * "… only / Clear" band ever appeared. Traced in the browser to a chip that
 * rendered as a `<span>` with no `onClick`:
 *
 *     tag: "SPAN"   text: "Trade idea"   onClick: undefined
 *
 * beside one that rendered correctly:
 *
 *     tag: "BUTTON" text: "News"         onClick: function
 *
 * `SignalCardView` renders the chip as a button only when it is given a
 * handler, and `pillFilterFor` withholds one unless `entryHasExactFamily` says
 * the tile has a family a reader could be offered. That predicate asks
 * `displayFamilyOf`, which read the type from `entry.card?.type ?? entry.signalType`.
 *
 * Four of the feed's entry kinds keep it somewhere else entirely:
 *
 *     scenario, template   `entry.card.type`        ✓ already found
 *     lens                 `entry.signalType`       ✓ already found
 *     insight              the research framing     ✓ already found
 *     signal               `entry.signal.type`      ✗ a whole SignalCard, under
 *                                                     a different property
 *     idea                 `entry.idea.type`        ✗ the POST's type, which
 *                                                     maps to a SignalType
 *     attention            `entry.attention`        ✗ derived from source_type
 *     news                 nothing                  — the entry-kind fallback
 *                                                     happens to BE a SignalType
 *
 * So three kinds fell through to `familyOf`'s entry-kind fallback — `idea`,
 * `signal`, `attention` — which names no family, has no label, and correctly
 * fails the exactness test. Their pills went inert. The chips still printed
 * "Trade idea", "Case gaps", "Awaiting you": real, specific, labelled families
 * that the reader could see and could not act on.
 *
 * The feed is dominated by those three kinds, which is why the reader's
 * experience was "the pill doesn't work" rather than "the pill works on some
 * tiles".
 *
 * ── Why this could not be fixed by changing `familyOf` ────────────────────
 *
 * It could not, and the branch that found the seam said so: `familyOf` is the
 * diversity axis `composeFeed` keys on, so changing what it returns changes
 * feed order. That is why the gap was reported rather than closed.
 *
 * `displayFamilyOf` has no such constraint. It exists only to answer "what does
 * this tile's chip say", it is read by the pill filter and the banner and by
 * nothing else, and composition never sees it. Closing the seam there costs
 * nothing anywhere.
 *
 * ── One resolver, three readers ───────────────────────────────────────────
 *
 * `rankInputFor` already performs each of these derivations in its own branch.
 * They are moved here rather than copied so the ranker, the pill filter and the
 * banner cannot come to disagree about what a tile is — which is the class of
 * defect this whole area has produced twice already.
 *
 * Pure. No React, no Supabase, no clock.
 */

/** A post's stored type, mapped to the card the feed builds from it. */
export function ideaSignalType(type: unknown): 'trade_idea' | 'thought' {
  return type === 'trade' || type === 'trade_idea' ? 'trade_idea' : 'thought'
}

/**
 * An attention item's card type, from the source that produced it.
 *
 * Lifted verbatim out of `rankInputFor`, whose comment records why the mapping
 * exists: attention items are not one thing, so they must not get one tier — a
 * trade awaiting the PM's call and a deliverable three weeks late rank
 * differently and print different chips.
 */
export function attentionSignalType(a: {
  source_type?: string | null
  attention_type?: string | null
} | null | undefined): string {
  if (!a) return 'awaiting_review'
  if (a.source_type === 'trade_queue_item') return 'recommendation'
  if (a.source_type === 'project' || a.source_type === 'project_deliverable') return 'project_overdue'
  if (a.attention_type === 'informational') return 'thought'
  return 'awaiting_review'
}

/**
 * The type an attention item's CARD will print, which is not always its rank.
 *
 * ── The mismatch this separates ───────────────────────────────────────────
 *
 * `attentionSignalType` types every trade-queue item as a `recommendation`,
 * and that is right for RANKING: a trade awaiting the desk's call belongs in
 * that tier whether or not a card for it has loaded.
 *
 * The card is a different question. `MobileDashboard` renders a recommendation
 * only when `recommendationBySource` actually holds one for that `source_id`;
 * with no match it falls through to the generic attention card, whose chip
 * reads "Needs review". So the tile said "Needs review" and the band it opened
 * said "Awaiting decision" — reported from manual QA in exactly those words.
 *
 * The lookup is component state, so it is passed in rather than guessed. The
 * two answers are allowed to differ and now say which is which.
 */
export function attentionDisplayType(
  a: { source_type?: string | null; attention_type?: string | null } | null | undefined,
  hasRecommendationCard: boolean,
): string {
  if (a?.source_type === 'trade_queue_item') {
    return hasRecommendationCard ? 'recommendation' : 'awaiting_review'
  }
  return attentionSignalType(a)
}

/**
 * The type the entry's card will declare, or null when the entry has none.
 *
 * Null is a real answer — a news entry genuinely carries no type on the entry,
 * and `displayFamilyOf` falls through to the entry kind for it, which happens
 * to be the `SignalType` `news`. Returning a guess here instead would put a
 * family on a tile whose chip says something else.
 */
export function entrySignalType(entry: {
  kind?: string
  card?: { type?: string } | null
  signal?: { type?: string } | null
  signalType?: string | null
  idea?: { type?: unknown } | null
  attention?: { source_type?: string | null; attention_type?: string | null } | null
}): string | null {
  /**
   * The card first, wherever it is.
   *
   * A scenario or template entry carries it as `card`; a signal entry carries a
   * whole `SignalCard` as `signal`. Both are the built card and both are the
   * most direct answer available.
   */
  if (entry.card?.type) return entry.card.type
  if (entry.signal?.type) return entry.signal.type

  /** A lens declares its type at construction. */
  if (entry.signalType) return entry.signalType

  if (entry.kind === 'idea') return ideaSignalType(entry.idea?.type)
  if (entry.kind === 'attention') return attentionSignalType(entry.attention)

  return null
}
