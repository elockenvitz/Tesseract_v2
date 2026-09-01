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
  /**
   * Capital that is out of line with what was written about it.
   *
   * ── Why this is not "decisions" ─────────────────────────────────────────
   *
   * A held position outside its written range and an unheld name outside the
   * same range are the same card type and two different findings: one is a
   * question about a book, the other an observation about a name somebody
   * covers. They were both filed under Decisions, which meant the reader had
   * no way to ask for the first, to turn it off, or to learn that it existed.
   *
   * The category is about WHOSE MONEY, which is the distinction the cards
   * already make in their own words.
   */
  | 'portfolio'
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
  // Beside Decisions, because it is the same question asked of capital rather
  // than of a name.
  { key: 'portfolio', label: 'Portfolio' },
  { key: 'research', label: 'Research' },
  { key: 'ideas', label: 'Ideas' },
  { key: 'workflow', label: 'Workflow' },
  { key: 'news', label: 'News' },
]

export const CATEGORY_LABEL: Record<FeedCategory, string> =
  Object.fromEntries(FEED_CATEGORIES.map(c => [c.key, c.label])) as Record<FeedCategory, string>

/**
 * The colour each category wears, in one place.
 *
 * ── Why it lives beside the taxonomy rather than beside the tile ──────────
 *
 * It was a `CATEGORY_DOT` const inside `MobileExplore`, which made the colour a
 * property of one component rather than of the category. Any second surface
 * that wanted to distinguish the same five families would have written its own
 * map, they would have disagreed within a release, and the reader would have
 * learned that violet means Ideas on one screen and something else on another.
 * That is the identical mistake the categories themselves were extracted to
 * fix — two places holding one taxonomy.
 *
 * Kept deliberately quiet. §8: a reader should recognise the class of a card at
 * a glance without the grid turning into a colour chart, so this is a 6px dot
 * and never a filled badge. The dot is a reinforcement, not the only carrier —
 * the card's own content and its metadata line say what it is in words.
 */
export const CATEGORY_DOT: Record<FeedCategory, string> = {
  /** The price against the framework. Consequence, so the warmest colour. */
  decisions: 'bg-rose-500',
  /**
   * Capital out of line with what was written.
   *
   * Amber rather than a second red: it is the same family of consequence as
   * Decisions and adjacent to it in the row, so a warm neighbour reads as
   * related where another rose would read as the same thing.
   */
  portfolio: 'bg-amber-500',
  /** The written record. */
  research: 'bg-sky-500',
  /** What colleagues posted. */
  ideas: 'bg-violet-500',
  /** Work with a due date. */
  workflow: 'bg-amber-500',
  /** Things that happened outside. Neutral, because a story asserts nothing. */
  news: 'bg-gray-400',
}

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
  card?: { type?: string; capital?: { issueType?: string } | null } | null
  /**
   * The capital stamp, where the entry has one but no card yet.
   *
   * Insight and lens entries build their card at RENDER time, so the object
   * this function is given during filtering has no `.card` at all — and a
   * stamped unwritten position was therefore classified from its entry kind,
   * which is `insight`, which is Research. The card was right and unreachable.
   */
  capital?: { issueType?: string | null } | null
}): FeedCategory | null {
  /**
   * Capital beats the type, because the type cannot tell these apart.
   *
   * `scenario_gap` is one `SignalType` covering two findings — a held position
   * outside its range, and an unheld name outside the same range — and the
   * registry can only give a type one category. The card knows which it is:
   * the builder stamps `capital` only where a position is genuinely behind the
   * break. See `SignalCard.capital`.
   *
   * Nothing else changes. A scenario card with no capital resolves through the
   * registry to Decisions exactly as before.
   */
  if ((entry.capital ?? entry.card?.capital)?.issueType) return 'portfolio'

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
  // Not a kind of its own: a card earns this by carrying `capital`, which the
  // scenario builder stamps on a held framework break and nothing else.
  portfolio: ['scenario (held framework break)'],
  research: ['insight', 'signal'],
  ideas: ['idea'],
  workflow: ['attention (projects, deliverables, notifications)'],
  news: ['news', 'template (except active_risk)'],
}

/**
 * The word on the card's own pill, for an entry that has one.
 *
 * ── Why this is not `categoryOf` ─────────────────────────────────────────
 *
 * A category is five buckets over thirty card types, so "Research" answers
 * "no thesis", "unreviewed change" and "target expired" together. The pill is
 * what the reader recognises and what they mean by "show me the no-thesis
 * ones".
 *
 * Only the DECLARED type counts. `categoryOf` falls back to the entry kind —
 * the name of the hook that produced the row — because every member of a kind
 * shares a category. That reasoning does not carry here: a `lens` entry may be
 * a crowding card or an oversized one, and guessing between them would put a
 * card under a pill it does not wear. An entry with no built card has no pill,
 * and returns null rather than a guess.
 */
export function signalTypeOf(entry: { card?: { type?: string } | null }): string | null {
  const declared = entry.card?.type
  return declared && declared in CONTENT_REGISTRY ? declared : null
}
