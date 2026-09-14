/**
 * Which of the pilot's downstream unlocks hold.
 *
 * ── Why the tutorial idea and not the org ─────────────────────────────────
 *
 * Trade Book and Outcomes unlocked once the pilot had committed ANY trade in
 * the org. A fresh pilot org is seeded with an AAPL recommendation waiting in
 * the Decision Inbox, and Pipeline basics sends the pilot to the Inbox — so
 * pilots accepted it, and that unrelated decision opened Trade Book (and from
 * there Outcomes) while the mission, correctly, still said "Test the trade".
 *
 * The unlock now asks the question the mission asks: is there an
 * `accepted_trades` row for the tutorial idea? Accepting or executing anything
 * else still works; it just teaches nothing about the pilot's own decision,
 * so it opens nothing.
 *
 * The stage marks (`trade_book_unlocked_at`, `outcomes_unlocked_at`) are still
 * required on top — they record that the pilot reached each surface in order
 * — but a mark alone is not enough, which is also what re-locks a pilot whose
 * mark was written by an unrelated trade before this rule existed.
 *
 * Graduated pilots and non-pilots never reach this: `usePilotMode` gives them
 * full access before it asks.
 *
 * Pure: no React, no Supabase.
 */
export interface PilotUnlockFacts {
  /** An `accepted_trades` row exists with `trade_queue_item_id` = the tutorial idea. */
  hasTutorialTrade: boolean
  /** `trade_book_unlocked_at_<orgId>` is set. */
  tradeBookMarked: boolean
  /** `outcomes_unlocked_at_<orgId>` is set. */
  outcomesMarked: boolean
}

export interface PilotUnlocks {
  tradeBook: boolean
  outcomes: boolean
  /** The tutorial trade exists but the Trade Book mark was never written. */
  shouldMarkTradeBook: boolean
}

export function pilotUnlocks(facts: PilotUnlockFacts): PilotUnlocks {
  return {
    tradeBook: facts.hasTutorialTrade && facts.tradeBookMarked,
    outcomes: facts.hasTutorialTrade && facts.outcomesMarked,
    shouldMarkTradeBook: facts.hasTutorialTrade && !facts.tradeBookMarked,
  }
}

/**
 * Query key for the tutorial-trade read.
 *
 * Under `accepted-trades` on purpose: both Trade Lab execute paths and the
 * Decision Inbox acceptance already invalidate that prefix when they write a
 * row, so the unlock refreshes the moment the tutorial decision lands.
 */
export const pilotTutorialTradeKey = (orgId: string | null, tutorialIdeaId: string | null) =>
  ['accepted-trades', 'pilot-tutorial', orgId, tutorialIdeaId] as const
