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

import { KIND_LABEL } from '../../components/signals/card-identity'
import { RESEARCH_FILTER_OPTIONS, RESEARCH_FILTER_PREFIX } from '../research/case-state'
import { CONTENT_REGISTRY } from '../signals/content-registry'
import { entrySignalType } from './entry-signal-type'
import type { SignalType } from '../signals/contract'
import { PORTFOLIO_FILTER_OPTIONS, PORTFOLIO_FILTER_PREFIX } from '../signals/portfolio-issues'

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
  /**
   * The card's declared type, where the entry knows it but has no card yet.
   *
   * Lens entries build their card at RENDER time — `{ kind: 'lens', score,
   * lens }` and nothing else — so a `crowding` or `no_target` card was being
   * classified from its entry kind, which is `lens`, which is Decisions. The
   * registry said Portfolio and could not be consulted, because the thing
   * being classified had no type on it.
   *
   * Exactly the defect insight entries had with `capital`, one family over.
   */
  signalType?: string | null
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
  const declared = entry.card?.type ?? entry.signalType
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
  /**
   * Two routes in, deliberately.
   *
   * Three families are book-derived by construction and declare Portfolio in
   * the registry — active risk, crowding, and a sized position nobody has
   * priced. Two more are Research and Scenario findings that BECOME capital
   * issues once a position is behind them, and earn it per card by carrying a
   * `capital` stamp. See `SignalCard.capital`.
   */
  portfolio: [
    'lens (active_risk, crowding, no_target)',
    'scenario (held framework break)',
    'insight (material position, no written view)',
  ],
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


/**
 * The product FAMILY a card belongs to — the question it asks the reader.
 *
 * ── Why `SignalType` was not fine-grained enough ──────────────────────────
 *
 * Ordering diversity has to key on what the reader recognises, and what the
 * reader recognises is the pill on the card. Two `SignalType`s each cover two
 * pills:
 *
 *   `scenario_gap`  is "Case vs price" on an unheld name and "Framework break"
 *                   on a held one. Different categories, different cards.
 *   `no_research`   is "No core thesis" in Research and, on a material
 *                   position, an unwritten-position card in Portfolio.
 *
 * A diversity rule keyed on the type therefore sees two families where the
 * reader sees four, and cannot break up a run of one of them — which is
 * exactly the reported "No Core Thesis, No Core Thesis, No Core Thesis".
 *
 * ── And why it is not coarser either ──────────────────────────────────────
 *
 * The other direction is just as wrong. `interleaveByKind` keyed on the ENTRY
 * KIND — the hook that produced the row — so crowding, no-target, target-hit,
 * target-expired and both conviction types were one bucket called `lens`, and a
 * "no two adjacent" rule was satisfied by showing all six back to back.
 *
 * ── No new vocabulary ─────────────────────────────────────────────────────
 *
 * Every key returned here already exists and is already user-visible through a
 * Curate row: `portfolio:<issue>` from `PORTFOLIO_FILTER_OPTIONS`,
 * `research:<framing>` from `RESEARCH_FILTER_OPTIONS`, and the `SignalType`
 * itself for every family that is exactly one type. Nothing is invented, so
 * "these two cards are the same family" and "these two cards match the same
 * filter row" are guaranteed to be the same statement.
 */
export function familyOf(entry: {
  kind?: string
  card?: { type?: string; capital?: { issueType?: string } | null } | null
  capital?: { issueType?: string | null } | null
  signal?: { type?: string } | null
  signalType?: string | null
  idea?: { type?: unknown } | null
  attention?: { source_type?: string | null; attention_type?: string | null; reason_code?: string | null } | null
  insight?: { issue?: { framing?: string | null } | null } | null
}): string | null {
  /**
   * Capital first, for the same reason `categoryOf` reads it first: it is the
   * only thing that can tell a held framework break from an unheld one, and
   * they are different cards with different pills.
   */
  const issue = (entry.capital ?? entry.card?.capital)?.issueType
  if (issue) return `${PORTFOLIO_FILTER_PREFIX}${issue}`

  /**
   * Research by FRAMING, because the type is a category word.
   *
   * `no_research` covers "No core thesis" and "Incomplete case";
   * `research_stale` covers "New evidence", "Material move" and "Quiet since".
   * Those five are what the pills say and what the reader is being asked, so
   * they are five families and not two.
   */
  const framing = entry.insight?.issue?.framing
  if (framing) return `${RESEARCH_FILTER_PREFIX}${framing}`

  /**
   * The type, from wherever the entry keeps it.
   *
   * ── Why the fallback was doing too much work ──────────────────────────────
   *
   * This read `entry.card?.type ?? entry.signalType`, which finds it on a
   * scenario, a template and a lens and misses it on an idea, a signal and an
   * attention item. Those three fell through to the entry kind — the name of
   * the HOOK that produced the row — so `composeFeed`, which keys its diversity
   * axis on this function, saw one bucket called `attention` holding "Needs
   * review", "Overdue" and "Awaiting decision" alike, and could not break up a
   * run of them. Reported from a phone as too many of the same tile in a row.
   *
   * `entrySignalType` is the same resolution the ranker performs per branch,
   * in one place. The capital and framing refinements above it are unchanged:
   * they are finer than the type and the diversity axis wants them.
   */
  const declared = entrySignalType(entry)
  if (declared) return declared

  // Still nothing: fall back to the entry kind so unclassifiable rows are
  // separable from each other, rather than collapsing into one family that the
  // run rule would then try to break up forever.
  return entry.kind ?? null
}

/**
 * The family a tile's PILL prints — the identity a reader can act on.
 *
 * ── Two identities, and why the product now has both ──────────────────────
 *
 * `familyOf` refines by the capital stamp: a held framework break is
 * `portfolio:framework_break` where an unheld case-vs-price is `scenario_gap`.
 * That refinement is real and useful — Curate offers it by name, `composeFeed`
 * keys its diversity axis on it, and Explore reads it — so it stays exactly
 * where it is.
 *
 * The PILL does not show it. Only `buildInsightCard` sets a `kindLabel`, so a
 * capital-stamped scenario tile prints `KIND_LABEL['scenario_gap']` — "Case vs
 * price" — the same words as the unheld tile beside it. Filtering on the finer
 * string therefore meant tapping one of two identical-looking chips hid the
 * other, and opened a band reading "Framework break", which is a refinement the
 * tile never displayed.
 *
 * The decision is that VISIBLE PILL IDENTITY WINS for user-facing filtering.
 * Two tiles showing the same words are one family under the thumb. So this
 * resolver mirrors how the chip is derived, and nothing else:
 *
 *   research framing   the card sets `kindLabel = RESEARCH_PILL[framing]`, so
 *                      the five framings genuinely print five different words
 *                      and stay five families
 *   declared type      `KIND_LABEL[type]`, which is what every other chip reads
 *   entry kind         the fallback, which names no family and is why
 *                      `entryHasExactFamily` exists
 *
 * The capital branch is deliberately absent. A refinement that the tile does
 * not display must not reach the filter or the banner.
 *
 * `family-label-agreement` in `feed-categories.test` holds the invariant: for
 * every family this returns, `familyLabel` gives back the words the chip prints.
 */
export function displayFamilyOf(entry: {
  kind?: string
  card?: { type?: string; capital?: { issueType?: string } | null } | null
  capital?: { issueType?: string | null } | null
  signal?: { type?: string } | null
  signalType?: string | null
  idea?: { type?: unknown } | null
  attention?: { source_type?: string | null; attention_type?: string | null; reason_code?: string | null } | null
  insight?: { issue?: { framing?: string | null } | null } | null
}): string | null {
  const framing = entry.insight?.issue?.framing
  if (framing) return `${RESEARCH_FILTER_PREFIX}${framing}`

  /**
   * Wherever the entry keeps its type, not only where two kinds keep it.
   *
   * This read `entry.card?.type ?? entry.signalType`, which finds it on a
   * scenario, a template and a lens and misses it on an idea, a signal and an
   * attention item — three kinds that dominate the feed. Their chips printed
   * real, labelled families and their pills rendered inert, because a family
   * that resolves only to the hook name correctly fails `isExactFamily`.
   *
   * Browser evidence, one chip of each: `SPAN` with `onClick: undefined` on a
   * tile reading "Trade idea", `BUTTON` with a handler on one reading "News".
   * See `entry-signal-type`, which is now the one place that answers this.
   */
  const declared = entrySignalType(entry)
  if (declared) return declared

  return entry.kind ?? null
}

/**
 * The reader-facing name of a tile FAMILY, or null when the key is not one.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * `familyOf` returns three kinds of string, and only two of them are families
 * a reader has ever seen:
 *
 *   `portfolio:framework_break`  a Curate row, already labelled
 *   `research:no_case`           a Curate row, already labelled
 *   `scenario_gap`               a SignalType, already labelled on the card
 *   `signal` / `idea` / …        the ENTRY KIND, from the fallback at the
 *                                bottom of `familyOf` — the name of the hook
 *                                that produced the row, which no reader has
 *                                seen and which names no family at all
 *
 * The fallback exists so the diversity rule can still separate unclassified
 * rows from each other while composing. It is not a filter the reader can be
 * offered: the pill on such a tile says something specific ("Case gaps"), and
 * filtering by `signal` would return every finding that hook emits.
 *
 * So this resolver does double duty. It gives the banner the exact words the
 * pill was printed in, and — by returning null — it is the test for whether a
 * pill may be a filter control at all. One function, so a family that can be
 * named and a family that can be filtered can never come apart.
 *
 * Every label is borrowed, never invented: the two Curate option lists and the
 * card's own `KIND_LABEL`. Nothing here introduces a second vocabulary.
 */
const FAMILY_LABELS: Record<string, string> = {
  ...Object.fromEntries(PORTFOLIO_FILTER_OPTIONS.map(o => [o.key, o.label])),
  ...Object.fromEntries(RESEARCH_FILTER_OPTIONS.map(o => [o.key, o.label])),
  ...KIND_LABEL,
}

export function familyLabel(family: string | null | undefined): string | null {
  if (!family) return null
  return FAMILY_LABELS[family] ?? null
}

/**
 * Whether a family key names something the reader can be offered as a filter.
 *
 * True exactly when it has a label. A key with no label is `familyOf`'s
 * entry-kind fallback, which is a producer and not a family.
 */
export function isExactFamily(family: string | null | undefined): family is string {
  return familyLabel(family) !== null
}

/**
 * Whether THIS tile's pill may act as a filter.
 *
 * The rule the feed holds: a pill that behaves like a control filters to
 * exactly the family printed on it, or it is not a control. An entry whose
 * family resolves only to its hook name fails this, and its pill renders
 * inert rather than quietly widening the feed to everything that hook emits.
 *
 * Asks `displayFamilyOf`, because the question is about the PILL. Asking
 * `familyOf` would gate on an identity the reader cannot see — and would pass
 * a capital-stamped tile on the strength of a Curate row its chip never
 * mentions.
 */
export function entryHasExactFamily(entry: Parameters<typeof displayFamilyOf>[0]): boolean {
  return isExactFamily(displayFamilyOf(entry))
}
