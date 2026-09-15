/**
 * What an evaluator's `Age` chip counts from, in words that are true.
 *
 * Every evaluator that publishes `Age` measures it from its own event, and
 * Today used to call all of them "Since review": a proposal waiting four days
 * for a PM read "4d · Since review", and with nothing else to draw its tile
 * said "Unreviewed for 4 days -- nothing has been recorded against this case
 * since it was written". Neither a review nor a written case was involved.
 *
 * Review language is kept only where the age really is counted from the case:
 *
 *   THESIS_STALE / COVERAGE_*     the thesis anchor         "Since review"
 *   PROPOSAL_AWAITING_DECISION    idea.updated_at|created   "Since proposal"
 *   EXECUTION_NOT_CONFIRMED       idea.decided_at|updated   "Since decision"
 *   IDEA_NOT_SIMULATED            idea.created_at           "Open" (and "Opened · Today")
 *
 * Labels only. The dates, the ranking and which findings exist are the
 * evaluators' and are untouched.
 */

export interface AgeEvent {
  /** Label for the count in the metric strip and the Ask AI context. */
  label: string
  /** The aging visual's caption, e.g. "Unreviewed for". */
  caption: string
  /** One sentence under the aging visual. */
  note: string
  /** The aging line's starting milestone. */
  from: string
}

const REVIEW: AgeEvent = {
  label: 'Since review',
  caption: 'Unreviewed for',
  note: 'Nothing has been recorded against this case since it was written.',
  from: 'written',
}

const AGE_EVENTS: Record<string, AgeEvent> = {
  THESIS_STALE: REVIEW,
  COVERAGE_NEW_EVIDENCE: REVIEW,
  COVERAGE_PRICE_MOVE: REVIEW,
  COVERAGE_NO_THESIS: REVIEW,
  COVERAGE_INCOMPLETE_THESIS: REVIEW,
  COVERAGE_STALE_THESIS: REVIEW,
  PROPOSAL_AWAITING_DECISION: {
    label: 'Since proposal',
    caption: 'Awaiting decision for',
    note: 'No decision has been recorded since it was proposed.',
    from: 'proposed',
  },
  EXECUTION_NOT_CONFIRMED: {
    label: 'Since decision',
    caption: 'Unconfirmed for',
    note: 'No execution has been recorded since the decision.',
    from: 'decided',
  },
  IDEA_NOT_SIMULATED: {
    label: 'Open',
    caption: 'Open for',
    note: 'Not yet sized against the book.',
    from: 'opened',
  },
}

/** A finding nobody has classified gets no event word rather than a guessed one. */
const UNNAMED: AgeEvent = {
  label: 'Age',
  caption: 'Open for',
  note: 'Nothing has been recorded against it since it was raised.',
  from: 'raised',
}

export function ageEventFor(titleKey: string | undefined): AgeEvent {
  return (titleKey && AGE_EVENTS[titleKey]) || UNNAMED
}
