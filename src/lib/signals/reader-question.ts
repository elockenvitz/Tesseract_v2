import type { SignalType } from './contract'

/**
 * What a card asks its reader to think about.
 *
 * ── Why the category could not do this job ────────────────────────────────
 *
 * The canonical category is where a card FILES — decisions, portfolio,
 * research, workflow, ideas, news — and filing is not the same as asking.
 * The reported run is the proof:
 *
 *     target_hit       decisions
 *     target_expired   decisions
 *     no_target        portfolio
 *
 * Three cards, two categories, one question: what should happen to this
 * name's target? A composer keyed on the category sees the third as variety
 * and lets the run through, which is exactly what a reader complained about.
 * It cuts the other way too — `recommendation` files under decisions and asks
 * a workflow question, "somebody is waiting on you".
 *
 * ── Why this is not a taxonomy system ─────────────────────────────────────
 *
 * It is one exhaustive map from a type the product already declares to a word
 * describing the ask. There is no registry, no plugin point and no way to
 * express a rule: adding a signal type makes this file fail to compile until
 * somebody says what it asks, which is the only maintenance burden intended.
 *
 * Used for COMPOSITION only. Ranking never sees it, nothing is dropped, and
 * the reader's own filters are unaffected — asking for Research and being
 * handed research is the answer, not repetition.
 */
export type ReaderQuestion =
  /** What should happen to this name's price target? */
  | 'target'
  /** The price has left the case that was written for it. */
  | 'framework'
  /** Capital is here with no durable view behind it. */
  | 'thesis'
  /** A written view has gone stale, or new evidence contradicts it. */
  | 'research'
  /** This position is the wrong size for the conviction behind it. */
  | 'sizing'
  /** Somebody is waiting on you. */
  | 'workflow'
  /** Something happened outside the book. */
  | 'market'
  /** Somebody on the desk had an idea. */
  | 'idea'

const QUESTION: Record<SignalType, ReaderQuestion> = {
  // What should happen to the target — reached, expired, or never set.
  target_hit: 'target',
  target_expired: 'target',
  no_target: 'target',

  // The price against the case somebody wrote.
  scenario_gap: 'framework',

  // Capital with nothing written behind it.
  no_research: 'thesis',

  // A view that exists and has aged, or been overtaken.
  research_stale: 'research',
  thesis_conflict: 'research',
  team_focus: 'research',

  // The size of the bet against the conviction behind it.
  active_risk: 'sizing',
  crowding: 'sizing',
  conviction_oversized: 'sizing',
  conviction_undersized: 'sizing',

  // Somebody is waiting on the reader.
  recommendation: 'workflow',
  awaiting_review: 'workflow',
  project_overdue: 'workflow',

  // Outside the book.
  news: 'market',
  unusual_move: 'market',
  earnings_ahead: 'market',
  earnings_result: 'market',
  corporate_action: 'market',
  catalyst_ahead: 'market',
  economic_release: 'market',

  // The desk's own posts.
  trade_idea: 'idea',
  pair_trade: 'idea',
  thought: 'idea',
  research_note: 'idea',
  thesis_update: 'idea',
  discussion: 'idea',
}

/**
 * The question this type asks, or null when the type is unknown.
 *
 * Null is treated by the composer as "no question to repeat", so an
 * unrecognised card never blocks another — the safe direction, since the cost
 * is a missed diversity opportunity rather than a card held back.
 */
export function readerQuestionFor(type: string | null | undefined): ReaderQuestion | null {
  if (!type) return null
  return QUESTION[type as SignalType] ?? null
}
