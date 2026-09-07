/**
 * The six canonical situations, declared semantically.
 *
 * ── What this table is, and what it is not ────────────────────────────────
 *
 * It is the FACTS → FINDINGS boundary: each entry says what kind of claim a
 * situation makes, which question it contributes to, and what the reader could
 * do about it. Every field is semantic. There is no component, no pane, no
 * primitive and no height anywhere in it, and that absence is the point — the
 * resolver reads a finding's PREDICATE to choose a picture, never its kind, so
 * two kinds that make the same shape of claim get the same treatment for free
 * and one kind in two states can get two.
 *
 * The proof of that is `coverage_gap` and `no_core_thesis`: different domains,
 * different producers, different subjects even — and both are `absent`, so
 * both resolve to the same primitive without either naming it.
 *
 * ── The `signalType` column ───────────────────────────────────────────────
 *
 * Every kind declares which of the product's existing signal types it ranks
 * as. That is the seam that keeps `feed-priority` sovereign: the engine cannot
 * mint a tier, only claim membership of one that already exists and has
 * already been argued for.
 *
 * ── Exhaustive by construction ────────────────────────────────────────────
 *
 * `Record<FindingKind, …>`, so a seventh situation fails to compile until
 * somebody states what it claims, what it asks and what it ranks as. The same
 * discipline `CONTENT_REGISTRY` and `reader-question` use, for the same
 * reason: a lookup table whose entries can be forgotten is a lookup table that
 * disagrees with itself within a quarter.
 */

import type { SignalType } from '../signals/contract'
import type { ReaderQuestion } from '../signals/reader-question'
import type {
  ActionIntent, FindingKind, FindingPredicate, SubjectKind,
} from './finding'

export interface SituationDefinition {
  /** The shape of the claim. Chooses the picture, downstream and indirectly. */
  predicate: FindingPredicate
  /** Which reader question this contributes to. Drives composition. */
  question: ReaderQuestion
  /** The existing signal type this ranks as. See the header. */
  signalType: SignalType
  /** What the finding can be about. Guards nonsense at the producer. */
  subjects: SubjectKind[]
  /**
   * What the reader could do, most useful first.
   *
   * `inspect_subject` is never listed: every plan carries it, and repeating it
   * here would let one situation forget it.
   */
  intents: ActionIntent[]
  /** One sentence, for the gallery and for whoever adds the seventh. */
  describes: string
}

export const SITUATION_DEFINITIONS: Record<FindingKind, SituationDefinition> = {
  /**
   * The horizon on a stated price objective has passed.
   *
   * `expired`, not `unreviewed`: the number did not go stale by neglect, it
   * reached the end of a period somebody chose. The distinction survives all
   * the way to the picture, where a horizon that ran out is drawn on a clock
   * and a move nobody looked at is drawn on the tape.
   */
  target_expired: {
    predicate: 'expired',
    question: 'target',
    signalType: 'target_expired',
    subjects: ['asset'],
    intents: ['revise_price_objective', 'reaffirm_case', 'record_judgment'],
    describes: 'A price objective outlived the horizon its author gave it.',
  },

  /**
   * The price has left the band the analyst modelled.
   *
   * The richest claim the product can make, because the scenario ladder is
   * already stored per case with probabilities. `band` carries the geometry
   * rather than a sentence about it — "below the bear case" is a summary, and
   * the summary is what the picture is supposed to produce.
   */
  case_price_dislocation: {
    predicate: 'outside_band',
    question: 'framework',
    signalType: 'scenario_gap',
    subjects: ['asset'],
    intents: ['reaffirm_case', 'revise_price_objective', 'record_judgment'],
    describes: 'The live price sits outside the scenario band somebody wrote.',
  },

  /**
   * The name moved materially and nobody has looked since.
   *
   * Distinct from a dislocation: nothing has been contradicted, and there may
   * be no band to contradict. The claim is about the desk's attention, which
   * is why the move is measured FROM the last review rather than from a date
   * on the calendar.
   */
  unreviewed_move: {
    predicate: 'unreviewed',
    question: 'research',
    signalType: 'research_stale',
    subjects: ['asset'],
    intents: ['review_evidence', 'record_judgment', 'reaffirm_case'],
    describes: 'A material move has occurred since the last time anyone looked.',
  },

  /**
   * Capital is deployed and no durable view was ever written.
   *
   * `absent`, and deliberately the same predicate as a coverage gap: both are
   * structural holes, both are best drawn as an empty slot rather than a
   * number, and neither has anything to plot. Proving that two unrelated
   * domains share a treatment without either asking for it is most of why this
   * situation is in the canonical set.
   */
  no_core_thesis: {
    predicate: 'absent',
    question: 'thesis',
    signalType: 'no_research',
    subjects: ['asset'],
    intents: ['write_thesis', 'record_judgment'],
    describes: 'A held position has no written thesis behind it.',
  },

  /**
   * A real position in the book that nobody is responsible for.
   *
   * Subject is the ASSET, not the portfolio, even though the fact comes from a
   * book: the reader's question is about this name, and filing it under the
   * portfolio would compose it with sizing findings it has nothing to do with.
   * A portfolio-subject variant is legitimate later and would be a different
   * question, not a different kind.
   */
  coverage_gap: {
    predicate: 'unowned',
    question: 'workflow',
    signalType: 'no_research',
    subjects: ['asset', 'portfolio'],
    intents: ['assign_coverage', 'inspect_subject'],
    describes: 'A meaningful position has no analyst assigned to it.',
  },

  /**
   * A decision was taken and its loop is still open.
   *
   * `awaiting` is the only predicate where the reader is the blocker rather
   * than the observer, and the plan reflects it: the prompt is inline even on
   * a briefing surface, because hiding "somebody is waiting on you" behind an
   * engagement is hiding the entire point of the card.
   */
  decision_followup: {
    predicate: 'awaiting',
    question: 'workflow',
    signalType: 'recommendation',
    subjects: ['asset', 'project'],
    intents: ['close_loop', 'record_judgment'],
    describes: 'A decision was made and the follow-up it implied is still open.',
  },
}

/**
 * The words each question is asked in.
 *
 * One prompt per question rather than one per kind, which is the composition
 * rule showing up in the copy: three findings that ask what to do about a
 * price objective must not ask it three different ways, or the reader
 * reasonably concludes they are three different asks.
 */
export const QUESTION_PROMPT: Record<ReaderQuestion, string> = {
  target: 'What should this name be worth?',
  framework: 'Does the case still hold?',
  thesis: 'What is the argument for owning this?',
  research: 'Has the view changed?',
  sizing: 'Is this the right size?',
  workflow: 'What happens next, and who does it?',
  market: 'Does this change anything?',
  idea: 'Is this worth picking up?',
}
