/**
 * What a Today finding's age and price window count from, in words that are true.
 *
 * Every evaluator measures its `Age` chip and sets `createdAt` from its own
 * event, and Today used to call nearly all of them a review. The rule now:
 * review wording only where the start date IS a recorded review.
 *
 *   finding                        start date                    age label
 *   COVERAGE_*  (caseAnchor)       research review               "Since review"
 *                                  case written, never reviewed  "Since written"
 *   THESIS_STALE                   thesis contribution updated   "Since update"
 *   PROPOSAL_AWAITING_DECISION     idea.updated_at|created_at    "Since proposal"
 *   EXECUTION_NOT_CONFIRMED        idea.decided_at|updated_at    "Since decision"
 *   IDEA_NOT_SIMULATED             idea.created_at               "Open" / "Opened · Today"
 *   RATING_NO_FOLLOWUP             rating change                 (its own "Changed" chip)
 *   anything else                  when it was raised            "Age"
 *
 * The same event names the price move ("Price since proposal"), the drawn
 * window's caption and tick, the aging visual, and the Ask AI context, so the
 * tile and the AI never describe one date two ways.
 *
 * Labels only. The dates, the ranking and which findings exist are the
 * evaluators' and are untouched.
 */

export interface AnchorWords {
  /** Caption phrase: "Price since {since}". */
  since: string
  /** Short form for labels: "Price since {shortSince}", "since {shortSince} · 20d". */
  shortSince: string
  /** "History does not reach {the}". */
  the: string
  /** The tick on a drawn window. */
  tick: string
}

export interface AgeEvent {
  /** Label for the age in the metric strip and the Ask AI context. */
  label: string
  /** The aging visual's caption, e.g. "Unreviewed for". */
  caption: string
  /** One sentence under the aging visual. */
  note: string
  /** The aging line's starting milestone. */
  from: string
  /** How the start date is named on a price move. */
  anchor: AnchorWords
}

const REVIEWED: AgeEvent = {
  label: 'Since review',
  caption: 'Unreviewed for',
  note: 'Nothing has been recorded against this case since its last review.',
  from: 'reviewed',
  anchor: { since: 'last review', shortSince: 'review', the: 'the review date', tick: 'LAST REVIEW' },
}

const WRITTEN: AgeEvent = {
  label: 'Since written',
  caption: 'Unchanged for',
  note: 'Nothing has been recorded against this case since it was written.',
  from: 'written',
  anchor: { since: 'the thesis was written', shortSince: 'written', the: 'the date it was written', tick: 'WRITTEN' },
}

const UPDATED: AgeEvent = {
  label: 'Since update',
  caption: 'Not updated for',
  note: 'The written thesis has not been edited since.',
  from: 'updated',
  anchor: { since: 'the last thesis update', shortSince: 'update', the: 'the update date', tick: 'LAST UPDATE' },
}

const AGE_EVENTS: Record<string, AgeEvent> = {
  THESIS_STALE: UPDATED,
  PROPOSAL_AWAITING_DECISION: {
    label: 'Since proposal',
    caption: 'Awaiting decision for',
    note: 'No decision has been recorded since it was proposed.',
    from: 'proposed',
    anchor: { since: 'the proposal', shortSince: 'proposal', the: 'the proposal date', tick: 'PROPOSAL' },
  },
  EXECUTION_NOT_CONFIRMED: {
    label: 'Since decision',
    caption: 'Unconfirmed for',
    note: 'No execution has been recorded since the decision.',
    from: 'decided',
    anchor: { since: 'the decision', shortSince: 'decision', the: 'the decision date', tick: 'DECISION' },
  },
  IDEA_NOT_SIMULATED: {
    label: 'Open',
    caption: 'Open for',
    note: 'Not yet sized against the book.',
    from: 'opened',
    anchor: { since: 'the idea was opened', shortSince: 'idea', the: 'the date it was opened', tick: 'OPENED' },
  },
  RATING_NO_FOLLOWUP: {
    label: 'Since change',
    caption: 'Unanswered for',
    note: 'Nothing downstream has moved since the rating changed.',
    from: 'changed',
    anchor: { since: 'the rating changed', shortSince: 'change', the: 'the change date', tick: 'RATING CHANGE' },
  },
}

/** A finding nobody has classified gets no event word rather than a guessed one. */
const UNNAMED: AgeEvent = {
  label: 'Age',
  caption: 'Open for',
  note: 'Nothing has been recorded against it since it was raised.',
  from: 'raised',
  anchor: { since: 'it was raised', shortSince: 'raised', the: 'the date it was raised', tick: 'RAISED' },
}

export function ageEventFor(
  titleKey: string | undefined,
  caseAnchor?: 'reviewed' | 'written',
): AgeEvent {
  if (titleKey?.startsWith('COVERAGE_')) {
    // Only a recorded review earns review wording; a case that was written and
    // never reviewed counts from being written.
    return caseAnchor === 'reviewed' ? REVIEWED : caseAnchor === 'written' ? WRITTEN : UNNAMED
  }
  return (titleKey && AGE_EVENTS[titleKey]) || UNNAMED
}
