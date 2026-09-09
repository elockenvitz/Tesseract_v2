/**
 * The five lanes a briefing is made of, as the reader experiences them.
 *
 * ── The failure this exists to fix ────────────────────────────────────────
 *
 * Manual QA, with the run rules, the question rules and the screen-saturation
 * rules all in place and all passing:
 *
 *   Needs Review, Overdue, Coverage Gap, Needs Review, Coverage Gap, Overdue
 *
 * Every rule agreed that sequence was diverse. Measured on a pilot-shaped pool
 * the composed top ten held four different reader questions and four different
 * categories, which is what the acceptance criteria asked for and is not what
 * the reader saw. What the reader saw was seven amber cards each saying that
 * something needs looking at.
 *
 * Three separate facts conspired:
 *
 *   1. `research_stale` and `awaiting_review` print the SAME words. Both chips
 *      read "Needs review", so two families the model considers distinct are
 *      one family to the person holding the phone.
 *   2. Coverage was filed under the `research` category and the `coverage`
 *      question — correctly, on their own terms — which took it out of every
 *      rule that was holding workflow down.
 *   3. `recommendation` is filed under `decisions`, and reads "Awaiting
 *      decision", which is the same request in the same colour.
 *
 * So the model had four names for one lane and counted them as four.
 *
 * ── Why a fifth axis rather than a fix to the existing four ───────────────
 *
 * Because the existing four are all correct. A missing thesis and a stale one
 * ARE different questions; coverage IS a claim about the written record rather
 * than about a queue. Collapsing any of them to make the composer behave would
 * be breaking a true distinction to fix a presentation problem, and every one
 * of those distinctions is load-bearing somewhere else — the pill filters on
 * the family, Curate filters on the category, composition spaces on the
 * question.
 *
 * What was missing is coarser than all of them: not what a card asks, but which
 * KIND OF WORK it represents. A briefing has a handful of those, and a reader
 * notices immediately when one of them is most of the page.
 *
 * ── Not colour ───────────────────────────────────────────────────────────
 *
 * These are derived from what a card is FOR, and the accent rail follows from
 * the same semantics rather than the other way round. Nothing here reads a
 * colour, and a repaint cannot change a lane.
 *
 * Exhaustive by construction, like every other vocabulary in this directory: a
 * new signal type does not compile until somebody says which lane it is in.
 *
 * Pure. No React, no clock.
 */

import type { SignalType } from './contract'

export type BriefClass =
  /**
   * Somebody needs to look at something, and it is usually the reader.
   *
   * The widest lane, and deliberately so — it is the one the reader was
   * drowning in. A trade awaiting a call, a deliverable past its date, a name
   * whose coverage has gone quiet and a written view nobody has revisited are
   * four different questions and one experience: a request for attention, worn
   * in the same clothes.
   */
  | 'work'
  /**
   * A written view, measured against the market.
   *
   * The reason the product exists. A price outside its band, a target reached
   * or lapsed, a position with no number and no thesis: all of them are "does
   * what we wrote still hold", which is a different act from working a queue.
   */
  | 'judgment'
  /**
   * What the desk said, as opposed to what the data noticed.
   *
   * `Surface` already draws this line for the accent rail and gives the
   * reasoning: "Priya thinks this" and "the book is 6.2% overweight" are not
   * the same kind of claim. A post is something to read; the rest of the feed
   * is something to answer.
   */
  | 'desk'
  /** Something happened outside the book. Nobody chose it and nobody owns it. */
  | 'market'
  /** What the book itself looks like: size, crowding, active weight. */
  | 'book'

/**
 * One lane per type. The comments carry the arguments that are not obvious.
 */
const BRIEF_CLASS: Record<SignalType, BriefClass> = {
  // ── work ────────────────────────────────────────────────────────────────
  awaiting_review: 'work',
  project_overdue: 'work',
  coverage_gap: 'work',
  /**
   * `research_stale`, and this is the entry that explains the whole file.
   *
   * Its chip reads "Needs review" — the same two words `awaiting_review`
   * prints. The model calls them different families asking different questions,
   * and the reader cannot tell them apart because they are printed the same and
   * ask for the same thing. Filing it anywhere else would leave the composer
   * counting a screen of "Needs review" as varied.
   */
  research_stale: 'work',
  /**
   * A recommendation is a decision waiting on a person.
   *
   * Filed under `decisions` as a category, which is right — it belongs with the
   * things a reader commits to. As an EXPERIENCE it is a request addressed to
   * them, arriving in the same amber clothes as everything else in this lane.
   */
  recommendation: 'work',
  /** Two people disagree and somebody has to reconcile it. */
  thesis_conflict: 'work',

  // ── judgment ────────────────────────────────────────────────────────────
  scenario_gap: 'judgment',
  target_hit: 'judgment',
  target_expired: 'judgment',
  no_target: 'judgment',
  /**
   * No thesis was ever written, which is a claim about the view and not a task.
   *
   * It sits beside the targets rather than in `work` because the reader's act
   * is authorship — deciding what this name is for — rather than clearing
   * something somebody put in front of them.
   */
  no_research: 'judgment',

  // ── desk ────────────────────────────────────────────────────────────────
  trade_idea: 'desk',
  thought: 'desk',
  research_note: 'desk',
  team_focus: 'desk',
  /**
   * The three other post types, and the reader named one of them.
   *
   * "Thought, Trade Idea, Pair Trade" was the second cluster reported, and a
   * pair trade is its own signal type rather than a thought with two legs.
   * `reader-question` already files all six of these under `idea` and
   * `card-identity` groups them as what a colleague wrote; the lane agrees with
   * both.
   */
  pair_trade: 'desk',
  thesis_update: 'desk',
  discussion: 'desk',

  // ── market ──────────────────────────────────────────────────────────────
  news: 'market',
  unusual_move: 'market',
  earnings_ahead: 'market',
  earnings_result: 'market',
  corporate_action: 'market',
  economic_release: 'market',
  catalyst_ahead: 'market',

  // ── book ────────────────────────────────────────────────────────────────
  active_risk: 'book',
  crowding: 'book',
  conviction_oversized: 'book',
  conviction_undersized: 'book',
}

/** The lane a card belongs to. Unknown types are unlaned rather than guessed. */
export function briefClassFor(type: string | null | undefined): BriefClass | null {
  if (!type) return null
  return BRIEF_CLASS[type as SignalType] ?? null
}

/** For tests and the dev overlay. */
export const BRIEF_CLASSES: BriefClass[] = ['work', 'judgment', 'desk', 'market', 'book']
