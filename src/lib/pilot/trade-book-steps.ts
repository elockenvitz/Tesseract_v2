/**
 * Trade Book basics — the three steps, in one place.
 *
 * Trade Book is pilot mission stage 4, "Make the decision", and finishing these
 * three steps completes it (see `usePilotTradeBookSteps`); the last one opens
 * Outcomes, which is stage 5. They are not new mission stages.
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
}

export const TRADE_BOOK_STEPS: readonly TradeBookStepCopy[] = [
  {
    key: 'reviewed',
    n: 1,
    title: 'Review the trade',
    hint: 'Tap a trade in this batch to check its price, size and notes.',
  },
  {
    /*
     * The batch's one answer. Trade-specific notes are optional and do not
     * complete this step: only saving "Why this decision?" fires its event.
     */
    key: 'rationale',
    n: 2,
    title: 'Add your rationale',
    hint: 'Answer “Why this decision?” for the whole batch.',
  },
  {
    key: 'outcomes',
    n: 3,
    title: 'Open Outcomes',
    hint: 'See how the decision plays out.',
  },
]

/** Window events each step completes on. Fired by the real actions on the page. */
export const TRADE_BOOK_STEP_EVENTS: Record<TradeBookStepKey, string> = {
  reviewed: 'pilot-tradebook:trade-reviewed',
  rationale: 'pilot-tradebook:rationale-added',
  outcomes: 'pilot-tradebook:opened-outcomes',
}
