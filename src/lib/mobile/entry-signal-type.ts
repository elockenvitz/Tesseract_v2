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

import type { Severity } from '../signals/contract'

/**
 * How loud an attention item is, from the field that actually carries it.
 *
 * ── The field that was never there ────────────────────────────────────────
 *
 * `rankInputFor` read `a.priority`:
 *
 *     severity: a.priority === 'high' ? 'critical'
 *             : a.priority === 'medium' ? 'attention'
 *             : 'informational'
 *
 * `AttentionItem` has no `priority`. It has `severity`, typed
 * `'low' | 'medium' | 'high' | 'critical'` — and `'high'`/`'medium'` are that
 * type's values, not a priority column's, so the branch was reaching for the
 * right thing under the wrong name. Nothing in the product ever wrote
 * `priority` onto one of these rows; the whole repository reads it in exactly
 * one place, which is the line above.
 *
 * The consequence was total rather than partial. `undefined` matches neither
 * arm, so EVERY attention item in the feed scored `informational` — a decision
 * waiting on the reader, a deliverable three weeks late and an earnings note
 * next Thursday all took the same urgency. That is 0.021 of the score where a
 * critical item should carry 0.14, and it applied to every attention family
 * the product has.
 *
 * ── Why this mapping and not a new one ────────────────────────────────────
 *
 * `useAttention` already computes severity per family from structured facts —
 * a project's priority column, days past due, days since a contribution — and
 * its own scorer multiplies by exactly this field. So the severity is
 * authored, populated and load-bearing elsewhere; the feed simply was not
 * reading it. The three-value shape below is the original branch's own, with
 * `critical` added because a four-value scale that stops at `high` would send
 * the loudest items to the quietest bucket.
 */
const ATTENTION_RANK_SEVERITY: Record<string, Severity> = {
  critical: 'critical',
  high: 'critical',
  medium: 'attention',
  low: 'informational',
}

export function attentionRankSeverity(
  a: { severity?: string | null } | null | undefined,
): Severity {
  return (a?.severity && ATTENTION_RANK_SEVERITY[a.severity]) || 'informational'
}

/** A post's stored type, mapped to the card the feed builds from it. */
export function ideaSignalType(type: unknown): 'trade_idea' | 'thought' {
  return type === 'trade' || type === 'trade_idea' ? 'trade_idea' : 'thought'
}

/**
 * The type `buildAttentionCard` gives an attention item — and so its chip.
 *
 * ── The broadening this ends ──────────────────────────────────────────────
 *
 * Manual QA: tapping "Needs Review" returned a feed still containing Overdue
 * tiles. The two mappings in this area key on DIFFERENT FIELDS, and only one of
 * them decides what the reader sees:
 *
 *   buildAttentionCard   ATTENTION_TYPE[a.attention_type]   ← the chip
 *   attentionSignalType  a.source_type                      ← the tier
 *
 * `action_required` becomes `project_overdue`, so a coverage-stale item — whose
 * source is `coverage_change` — prints "Overdue". The display resolver was
 * asking the source-type mapping, which sends anything that is not a trade
 * queue item or a project to `awaiting_review`. So an entire class of tiles
 * printing "Overdue" answered to the "Needs review" family, and tapping one
 * returned the other.
 *
 * This is the builder's own map, moved here so there is exactly one derivation
 * of what an attention tile says. `buildAttentionCard` imports it rather than
 * keeping a copy: a second table is how the two came apart in the first place.
 */
export const ATTENTION_CARD_TYPE: Record<string, string> = {
  decision_required: 'awaiting_review',
  action_required: 'project_overdue',
  alignment: 'thesis_conflict',
  informational: 'team_focus',
}

/**
 * The reasons that name their own situation, ahead of the generic mapping.
 *
 * ── Why the reason and not the source ─────────────────────────────────────
 *
 * `source_type: 'coverage_change'` is a junk drawer. `useAttention` stamps it
 * on two unrelated producers: `collectNeglectedCoverage`, which raises a name
 * the reader covers and has not touched in three weeks, and
 * `collectUpcomingEarnings`, which raises a print that is coming up. One is a
 * coverage finding and the other is a calendar entry, and keying on the source
 * would type them the same.
 *
 * `reason_code` is the field that actually names what was noticed, and
 * `generateAttentionId` already treats it as part of an item's identity. So it
 * is what this keys on, and `earnings_upcoming` keeps the mapping it had.
 *
 * ── Why it wins over `attention_type` ─────────────────────────────────────
 *
 * `attention_type` is a routing hint with four values, and coverage neglect is
 * stamped `action_required` — which maps to `project_overdue`, so the chip read
 * "Overdue" on a finding with no deadline and no assignment. Reported from a
 * phone in exactly those terms: "overdue doesn't seem like the right type since
 * it's coverage being stale." The reason is more specific than the routing
 * hint, so where a reason names a situation it decides.
 */
export const ATTENTION_REASON_CARD_TYPE: Record<string, string> = {
  coverage_neglected: 'coverage_gap',
}

export function attentionCardType(
  a: { attention_type?: string | null; reason_code?: string | null } | null | undefined,
): string {
  const byReason = a?.reason_code && ATTENTION_REASON_CARD_TYPE[a.reason_code]
  if (byReason) return byReason
  return (a?.attention_type && ATTENTION_CARD_TYPE[a.attention_type]) || 'awaiting_review'
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
  a: {
    source_type?: string | null
    attention_type?: string | null
    reason_code?: string | null
  } | null | undefined,
  hasRecommendationCard: boolean,
): string {
  /**
   * The one override: a matched trade-queue item renders a different card.
   *
   * `MobileDashboard` swaps in the recommendation card when
   * `recommendationBySource` holds one, and that card's chip reads "Awaiting
   * decision". With no match the generic attention card renders and says
   * whatever `attentionCardType` says.
   */
  if (a?.source_type === 'trade_queue_item' && hasRecommendationCard) return 'recommendation'
  return attentionCardType(a)
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
  attention?: {
    source_type?: string | null
    attention_type?: string | null
    reason_code?: string | null
  } | null
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
  /**
   * The CARD's type, not the ranker's.
   *
   * This is the user-facing resolver: the pill filters on it and the composer
   * breaks runs on it, and both of those are about what the reader sees. The
   * ranker keeps `attentionSignalType`, which answers a different question —
   * which tier a trade awaiting the desk's call belongs in — and is unchanged.
   */
  if (entry.kind === 'attention') return attentionCardType(entry.attention)

  return null
}
