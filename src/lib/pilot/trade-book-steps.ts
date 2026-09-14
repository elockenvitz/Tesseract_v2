/**
 * Trade Book basics — the three steps, in one place.
 *
 * Trade Book is where stage 5 of the pilot starts (the decision is recorded;
 * now look at it) and Outcomes is where it finishes. These are the local steps
 * that walk a pilot from one to the other. They are not new mission stages.
 *
 * The step banner and the phone's next-steps card both read this, so the words
 * a pilot is told and the controls they are given cannot drift apart. Each
 * title names the action on the page; each hint says where it is, using the
 * page's own labels ("Why this decision?", "Trade-specific notes").
 */
export type TradeBookStepKey = 'reviewed' | 'rationale' | 'outcomes'

export interface TradeBookStepCopy {
  key: TradeBookStepKey
  n: number
  title: string
  hint: string
  /** The verb on the phone's next-steps card. */
  actionLabel: string
}

export const TRADE_BOOK_STEPS: readonly TradeBookStepCopy[] = [
  {
    key: 'reviewed',
    n: 1,
    title: 'Review the trade',
    hint: 'Open a trade in this batch to check its price, size and notes.',
    actionLabel: 'Show me',
  },
  {
    key: 'rationale',
    n: 2,
    title: 'Add your rationale',
    hint: 'Answer “Why this decision?” for the whole batch, or add a trade-specific note.',
    actionLabel: 'Write it',
  },
  {
    key: 'outcomes',
    n: 3,
    title: 'Open Outcomes',
    hint: 'See how the decision plays out. That’s where the last pilot stage finishes.',
    actionLabel: 'Open',
  },
]

/** Window events each step completes on. Fired by the real actions on the page. */
export const TRADE_BOOK_STEP_EVENTS: Record<TradeBookStepKey, string> = {
  reviewed: 'pilot-tradebook:trade-reviewed',
  rationale: 'pilot-tradebook:rationale-added',
  outcomes: 'pilot-tradebook:opened-outcomes',
}
