/**
 * Which of the pilot's downstream unlocks hold.
 *
 * ── What opens Trade Book ─────────────────────────────────────────────────
 *
 * A pilot may add any idea to Trade Lab — their own, a seeded one, a
 * recommendation — size it and execute it. Executing a trade is what earns
 * Trade Book, whatever the trade was. So the fact is: has this pilot committed
 * an `accepted_trades` row in this org?
 *
 * (For a while this was scoped to the tutorial idea only. Pilots executed the
 * seeded recommendation in Trade Lab, which is exactly the flow the pilot is
 * meant to teach, and were left locked out. The product rule is any trade.)
 *
 * Still per-org, and still the pilot's own: a trade in another org, or one
 * someone else committed, opens nothing here.
 *
 * The stage marks (`trade_book_unlocked_at`, `outcomes_unlocked_at`) are still
 * required on top — they record that the pilot reached each surface in order.
 *
 * Graduated pilots and non-pilots never reach this: `usePilotMode` gives them
 * full access before it asks.
 *
 * Pure: no React, no Supabase.
 */
export interface PilotUnlockFacts {
  /** The pilot has committed an `accepted_trades` row in this org. */
  hasPilotTrade: boolean
  /** `trade_book_unlocked_at_<orgId>` is set. */
  tradeBookMarked: boolean
  /** `outcomes_unlocked_at_<orgId>` is set. */
  outcomesMarked: boolean
}

export interface PilotUnlocks {
  tradeBook: boolean
  outcomes: boolean
  /** The pilot has a committed trade but the Trade Book mark was never written. */
  shouldMarkTradeBook: boolean
}

export function pilotUnlocks(facts: PilotUnlockFacts): PilotUnlocks {
  return {
    tradeBook: facts.hasPilotTrade && facts.tradeBookMarked,
    outcomes: facts.hasPilotTrade && facts.outcomesMarked,
    shouldMarkTradeBook: facts.hasPilotTrade && !facts.tradeBookMarked,
  }
}

/**
 * Query key for the pilot's committed-trade read.
 *
 * Under `accepted-trades` on purpose: both Trade Lab execute paths and the
 * Decision Inbox acceptance already invalidate that prefix when they write a
 * row, so the unlock refreshes the moment the trade lands.
 */
export const pilotCommittedTradeKey = (orgId: string | null, userId: string | null | undefined) =>
  ['accepted-trades', 'pilot-committed', orgId, userId ?? null] as const
