/**
 * Whether a feed post has already been dealt with — for both shells.
 *
 * ── The divergence this closes ────────────────────────────────────────────
 *
 * Mobile ran judgment suppression and desktop ran none of it. A reader who
 * dismissed a colleague's thought on their phone met it again on their laptop,
 * and a snooze bought quiet on exactly one device. That is the ranking
 * divergence users can most clearly name, because it is not a matter of order —
 * the card is either gone or it is not.
 *
 * ── Why this module is thin on purpose ────────────────────────────────────
 *
 * It answers one question the shells must not answer for themselves: given a
 * feed row and the reader's stored dispositions, is this row withheld? Every
 * part of that answer already existed and none of it is re-implemented here:
 *
 *   · what an answer MEANS      → `judgment-policy`, via `suppressionFor`
 *   · where answers are stored  → `dispositions`, via `dispositionKey`
 *   · what a post's identity is → `builders/ideas`, via ideaCardType/ideaCardId
 *
 * This file is the composition, and only the composition. If it grows a rule of
 * its own — a window, a category, a second notion of what counts as answered —
 * that rule belongs in one of the three modules above instead, or the two
 * shells have started disagreeing again through a third party.
 *
 * See docs/tickets/ideas-ranking-divergence.md.
 */

import type { SignalType } from '../signals/contract'
import { ideaCardId, ideaCardType } from '../signals/builders/ideas'
import { dispositionKey, type DispositionMap } from '../signals/dispositions'
import {
  suppressionFor,
  type JudgmentRecord,
  type SuppressionState,
} from '../signals/judgment-policy'

/** The least a feed row needs for a stored answer to be found for it. */
export interface SuppressibleFeedItem {
  id: string | number
  type: string
}

/** Where a post's answer lives in the disposition store. */
export interface FeedJudgmentRef {
  /** The contract type the disposition is filed under. */
  type: SignalType
  /** The post's own identity — see below. Never a bare asset id. */
  entityId: string
  /** The composed `type:entity` key, which is what the store is keyed by. */
  storeKey: string
}

/**
 * What a stored answer about this post would be filed under.
 *
 * ── Keyed on the POST, never on the ticker ────────────────────────────────
 *
 * This is the rule that keeps suppression from doing damage, and it is
 * `dispositionEntityFor`'s rule, not a new one: a machine-derived finding is a
 * recurring claim about a NAME, so it is keyed by asset — but a colleague's
 * post is one artifact somebody wrote once. Keyed on the asset, one reader
 * answering Priya's thought about AAPL would silence Marcus's thought about
 * AAPL: a different person, a different argument, hidden because of an answer
 * that was never about it.
 *
 * `ideaCardId` composes `idea:{itemType}:{id}`, so two rows sharing an asset
 * cannot share a key, and a quick thought and a note with the same underlying
 * id cannot either. Both halves come from `builders/ideas` — the same two
 * functions `MobileDashboard` calls — because a shell that guessed either half
 * would look up a key nothing ever wrote and suppress nothing, silently.
 *
 * The `?? 'idea'` fallback mirrors the mobile call site exactly. It is not a
 * good identity, but matching mobile matters more than improving on it here:
 * the point of this module is that the two shells resolve to the same key.
 */
export function judgmentRefFor(item: SuppressibleFeedItem): FeedJudgmentRef {
  const type = ideaCardType(item.type)
  const entityId = ideaCardId(item.type, String(item.id ?? 'idea'))
  return { type, entityId, storeKey: dispositionKey(type, entityId) }
}

/**
 * The stored answer for this post, reduced to what the policy reads.
 *
 * Reads `key ?? verdict` for the same reason `judgmentOf` does: pre-Phase-3
 * records carry the semantic answer under the old name, and dropping them would
 * quietly un-suppress every card a reader answered before the rename.
 */
export function judgmentRecordFor(
  item: SuppressibleFeedItem,
  dispositions: DispositionMap,
): JudgmentRecord | null {
  const d = dispositions[judgmentRefFor(item).storeKey]
  if (!d) return null
  return { key: d.key ?? d.verdict ?? null, kind: d.kind, at: d.at }
}

/**
 * Whether this post should be shown, and why not when it should not.
 *
 * Delegates the entire decision to `suppressionFor`, which is what makes this
 * shell-independent: the windows, the categories, the resolved-versus-quiet
 * distinction and the scope gate are all decided there, once.
 */
export function suppressionForFeedItem(
  item: SuppressibleFeedItem,
  dispositions: DispositionMap,
  now: number,
): SuppressionState {
  const { type } = judgmentRefFor(item)
  return suppressionFor(judgmentRecordFor(item, dispositions), type, now)
}

/**
 * The rows the reader has not already dealt with.
 *
 * ── Why this runs before scoring, not after ───────────────────────────────
 *
 * Three reasons, and the first two are correctness rather than tidiness.
 *
 * A suppressed row must not consume a diversity slot. `applyDiversity` spaces
 * runs of one author or one asset across a page, so a hidden card that still
 * participated would push a visible one out of the page for the sake of
 * spacing something nobody can see.
 *
 * And coverage must not resurrect a dismissed card. The coverage bonus is
 * additive and deliberately large enough to move a card up a page; if
 * suppression were a later filter over a coverage-ranked list, the two features
 * would be arguing, and "I dismissed this" has to win that argument every time.
 * Evaluating eligibility first means they never meet.
 *
 * Third, it is cheaper: nothing is scored that cannot be shown.
 *
 * ── Failing open ──────────────────────────────────────────────────────────
 *
 * An empty or unreadable disposition map yields the input unchanged. That is
 * the same refusal `coverageRelevanceFor` makes for an unresolved index and for
 * the same reason: hiding real findings because a store did not load is the
 * worst failure available here, and it is silent. `loadDispositions` already
 * returns `{}` rather than throwing on a parse failure, private browsing, or a
 * disabled origin, so this degrades to showing everything.
 */
export function eligibleFeedItems<T extends SuppressibleFeedItem>(
  items: readonly T[],
  dispositions: DispositionMap,
  now: number,
): T[] {
  if (!items.length) return []
  // Nothing answered means nothing withheld — skip the per-row work entirely.
  if (!dispositions || Object.keys(dispositions).length === 0) return items.slice()
  return items.filter(item => !suppressionForFeedItem(item, dispositions, now).suppressed)
}

/**
 * A stable fingerprint of what the reader has answered.
 *
 * For a React Query key, so a disposition recorded in another tab recomputes
 * the feed instead of waiting for a reload — the same job `coverageSignature`
 * does for coverage, and written the same way for the same reason.
 *
 * Includes `until` as well as the key, because a snooze being replaced by a
 * dismissal on the same card changes how long it stays away without changing
 * how many records exist. Sorted, so two identical stores always produce the
 * same string regardless of insertion order.
 *
 * It deliberately does NOT include anything that changes with the clock. A
 * signature that moved on its own would refetch the feed on a timer, which is
 * the polling this is meant to avoid: an expired snooze comes back because the
 * next evaluation asks `acknowledgmentFor` again with a later `now`, not
 * because anything went looking for it.
 */
export function dispositionSignature(dispositions: DispositionMap): string {
  const entries = Object.entries(dispositions ?? {})
  if (entries.length === 0) return 'none'
  return entries
    .map(([k, d]) => `${k}=${d.key ?? d.verdict ?? ''}@${d.until}`)
    .sort()
    .join('|')
}
