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
 * The proof of that is `coverage_stale` and `unreviewed_move`: different
 * domains, different producers, different questions — and both are
 * `unreviewed`, so both are written by one copy writer and drawn by one branch
 * of the resolver, which tells them apart by the UNIT of the claim rather than
 * by which family it came from.
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
 * `Record<FindingKind, …>`, so the next situation fails to compile until
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
   * The price reached a level somebody committed to.
   *
   * ── Why this shares a question with `target_expired` ────────────────────
   *
   * Because `reader-question` already says so, and it is right: a target
   * reached and a target expired are both "what should this name be worth
   * now", answered by the same editor with the same button. That shared
   * question is what lets the composer put two findings on one name into one
   * situation instead of two tiles, which is the thing this adoption exists to
   * prove.
   *
   * They are still two KINDS, because the claims are different — one is an
   * event that happened, the other a clock that ran out — and merging them
   * would make the lead's own sentence untrue half the time.
   */
  target_reached: {
    predicate: 'threshold_passed',
    question: 'target',
    signalType: 'target_hit',
    subjects: ['asset'],
    intents: ['revise_price_objective', 'reaffirm_case', 'record_judgment'],
    describes: 'The price reached a stated price objective and nothing says so.',
  },

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
    /**
     * Declared in the order the commonest state wants them.
     *
     * `price_move` and `long_silence` both want the thesis editor first, which
     * is what `buildInsightCard` routes them to. `new_evidence` reorders this
     * list rather than owning a different one — see `assembleFinding`.
     */
    intents: ['revise_thesis', 'review_evidence', 'record_judgment'],
    describes: 'A written view has not accounted for what happened since.',
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
    /**
     * `coverage`, and the move off `workflow` is the adoption's whole point.
     *
     * Filing this under workflow put it in one question with a trade awaiting
     * a call and a deliverable past its date. Those have an owner and a
     * deadline; this is the claim that there is no owner. Sharing their
     * question meant sharing their composition — a coverage finding could
     * merge with an unrelated deadline on the same asset — and sharing their
     * chip, which is how a coverage tile came to print "Overdue".
     */
    question: 'coverage',
    /**
     * Its own type, ranked where the legacy row already ranked.
     *
     * `no_research` was the closest existing type and it was not close: that
     * is "no thesis was ever written", a claim about the record rather than
     * about who keeps it. See `TIER`, where `coverage_gap` takes the base the
     * legacy attention row already had so the adoption changes what the tile
     * says without moving it.
     */
    signalType: 'coverage_gap',
    subjects: ['asset', 'portfolio'],
    intents: ['assign_coverage', 'inspect_subject'],
    describes: 'A meaningful position has no analyst assigned to it.',
  },

  /**
   * Somebody covers it and the coverage has gone quiet.
   *
   * ── Where this comes from, and what it is not ───────────────────────────
   *
   * `collectNeglectedCoverage` walks the reader's OWN active coverage rows and
   * raises a name with no research contribution in three weeks. So the subject
   * is always a name the reader is answerable for, and the claim is about that
   * answerability rather than about the price or the thesis.
   *
   * It is not `unreviewed_move`, which asks whether a written view has kept up
   * with what happened. That question presumes a view; this one asks whether
   * anybody is still tending the name at all, and it fires on a name where
   * nothing has happened. Where both are true of one asset the product already
   * picks the richer card — see `suppressCoveredAttention`.
   *
   * `unreviewed` is the predicate, measured in DAYS. That unit is what makes
   * the resolver draw the clock rather than the tape: the elapsed time IS the
   * finding here, where in a stale-research claim the elapsed time is context
   * around a move.
   */
  coverage_stale: {
    predicate: 'unreviewed',
    question: 'coverage',
    signalType: 'coverage_gap',
    subjects: ['asset'],
    /**
     * The name, then the record, then the note.
     *
     * ── Why the thesis editor is not the primary ────────────────────────
     *
     * It was, on the strength of the row's own `next_action` — "Update thesis,
     * rating, or research for this covered name". Three destinations named in
     * one sentence, and the card picked the first as though the finding had
     * established it. It has not. This claim is that nothing has been ADDED in
     * weeks; it says nothing about whether what is written is now wrong. That
     * is `unreviewed_move`'s claim, and it has evidence behind it — a move, an
     * arrival — which this has by definition not got. A primary reading
     * "Update the thesis" tells the reader their view is stale when all anybody
     * knows is that they have been quiet.
     *
     * ── Why not `assign_coverage` either ────────────────────────────────
     *
     * That routes to the coverage register, which is the right destination for
     * the finding that nobody is responsible. Here somebody is, and it is the
     * reader: "Assign coverage" would be offering to solve a problem the card
     * has just said does not exist. It is also commit-class and the reader
     * cannot commit from this surface, so the resolver would decline it for the
     * primary slot anyway.
     *
     * ── What is left is the honest one ──────────────────────────────────
     *
     * Open the name. Every route that could resolve this — the thesis, the
     * rating, a note, the research — lives on the asset, and the card does not
     * know which of them is needed. It is the same conclusion
     * `buildAttentionCard` reached for the rows it cannot resolve: name the one
     * thing this surface can honestly do, and take the reader to the thing
     * being asked about. The thesis editor stays, one place down, for the
     * reader who already knows the view has moved.
     *
     * `review_evidence` is deliberately absent throughout. It routes to
     * `open_research`, which `feedActionIsRoutable` only passes when there is
     * an arrival to read — and the whole claim of this finding is that nothing
     * has arrived. Offering it would put a control on the card that opens
     * nothing.
     */
    intents: ['inspect_subject', 'revise_thesis', 'record_judgment'],
    describes: 'A name the reader covers has had no research on it for weeks.',
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
  coverage: 'Is anybody still answering for this?',
  market: 'Does this change anything?',
  idea: 'Is this worth picking up?',
}
