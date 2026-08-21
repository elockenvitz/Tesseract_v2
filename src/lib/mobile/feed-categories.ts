/**
 * What the feed's categories are, in one place.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * The header banner and the Curate sheet both rendered from `KIND_LABELS`, a
 * map of the feed's INTERNAL entry kinds: attention, idea, signal, insight,
 * news, template, lens. Those are source names — they say which hook produced
 * a row — and they leaked to the reader as filter labels.
 *
 * That is why the taxonomy did not survive contact with a phone. "Insights"
 * and "Signals" are indistinguishable as words, and the split between them was
 * an implementation detail: an unreviewed-change card and a no-thesis card are
 * the same kind of finding about the same kind of gap, and landed in different
 * filters because one is derived in `useDerivedInsights` and the other is not.
 * "Portfolio lenses" is not a phrase anybody says out loud. And scenario cards
 * had no category at all, because they were never in the pool until Phase 8.
 *
 * So: categories are named for what the reader is being asked to do, resolved
 * from the ENTRY rather than from its source, and both controls render from
 * this file. The same word now means the same thing in both places because
 * there is only one place.
 *
 * Pure — no React, no Supabase. Imported by the dashboard, the filter sheet
 * and the tests alike.
 */

import { CONTENT_REGISTRY } from '../signals/content-registry'
import type { SignalType } from '../signals/contract'

export type FeedCategory =
  /** A position has left, or never had, the framework it was written against. */
  | 'decisions'
  /** A documentation gap: no thesis, a view that has not kept up. */
  | 'research'
  /** Work assigned to somebody, with a due date. */
  | 'workflow'
  /** What colleagues posted: trade ideas, thoughts, notes. */
  | 'ideas'
  /** Things that happened in the market. */
  | 'news'

/** Order matters: this is the order the filter row renders in. */
export const FEED_CATEGORIES: { key: FeedCategory; label: string }[] = [
  { key: 'decisions', label: 'Decisions' },
  { key: 'research', label: 'Research' },
  { key: 'ideas', label: 'Ideas' },
  { key: 'workflow', label: 'Workflow' },
  { key: 'news', label: 'News' },
]

export const CATEGORY_LABEL: Record<FeedCategory, string> =
  Object.fromEntries(FEED_CATEGORIES.map(c => [c.key, c.label])) as Record<FeedCategory, string>

/**
 * The category an entry belongs to.
 *
 * Takes the whole entry, not just its kind, for one reason that matters:
 * `attention` is not one thing. A trade awaiting the PM's call and a project
 * deliverable three weeks late arrive through the same hook and belong in
 * different categories, and the row already says which it is. Splitting on
 * `source_type` here is the same decision the ranking adapter makes, for the
 * same reason.
 *
 * Returns null for an entry shape nobody has classified, which the filter
 * treats as "keep when no filter is set, drop when one is" — the honest
 * behaviour, and visible in a test rather than silent.
 */
export function categoryOf(entry: {
  kind?: string
  attention?: { source_type?: string | null }
  /** The built card, where the entry has one. Its declared type wins. */
  card?: { type?: string } | null
}): FeedCategory | null {
  /**
   * The card's declared category beats anything inferred from its source.
   *
   * ── The defect this closes ──────────────────────────────────────────────
   *
   * The switch below resolves from the ENTRY KIND, which is the name of the
   * hook that produced the row. That works while every member of a kind shares
   * a category, and `template` does not: five of its six members really are
   * market events, and `active_risk` is how far a position sits from its
   * benchmark weight — a sizing decision, filed under **News**. Reported from
   * a phone, and correctly, as nonsense.
   *
   * Deferring to `content-registry` means the declared category is the single
   * source of truth for both Curate's filters and Explore's, and a new card
   * type cannot pick one up by accident from whichever hook happens to emit it.
   */
  const declared = entry.card?.type
  if (declared && declared in CONTENT_REGISTRY) {
    return CONTENT_REGISTRY[declared as SignalType].canonicalCategory
  }

  switch (entry.kind) {
    // The price against the framework: scenario ladders, targets hit and
    // expired, positions with no target, conviction and crowding.
    case 'scenario':
    case 'lens':
      return 'decisions'

    // Derived findings about the written record. `insight` and `signal` are
    // deliberately merged: an unreviewed change and a missing thesis are the
    // same sort of gap, and the reader has no way to know that one is computed
    // in a different hook.
    case 'insight':
    case 'signal':
      return 'research'

    case 'idea':
      return 'ideas'

    case 'news':
    case 'template':
      return 'news'

    case 'attention':
      // A proposed trade is a decision somebody is waiting on. Everything else
      // arriving through this hook — deliverables, projects, notifications — is
      // work with a due date.
      return entry.attention?.source_type === 'trade_queue_item' ? 'decisions' : 'workflow'

    default:
      return null
  }
}

/**
 * The internal kinds behind each category, for tests and for debugging.
 *
 * Not used for filtering — `categoryOf` is, because `attention` cannot be
 * resolved from its kind alone. Kept so a reviewer can see the mapping without
 * reading a switch.
 */
export const CATEGORY_KINDS: Record<FeedCategory, string[]> = {
  decisions: ['scenario', 'lens', 'attention (trade_queue_item)'],
  research: ['insight', 'signal'],
  ideas: ['idea'],
  workflow: ['attention (projects, deliverables, notifications)'],
  news: ['news', 'template (except active_risk)'],
}
