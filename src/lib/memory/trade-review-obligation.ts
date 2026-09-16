/**
 * "Needs review" as a durable fact instead of a pill on one page.
 *
 * ── The existing rule, unchanged ─────────────────────────────────────────
 *
 * `tradeLifecyclePhase` already decides this, and nothing here re-decides it.
 * A committed trade needs review when reconciliation came back `partial`,
 * `deviated` or `unmatched`, or when the staleness sweeper has flagged it --
 * and it is not cancelled. No new interval, no new threshold, no second
 * definition. This module only turns that answer into a row.
 *
 * ── Why it mattered ──────────────────────────────────────────────────────
 *
 * The phase was derived on render and shown as a pill inside the batch detail.
 * Nothing outside Trade Book read it: not the attention feed, not Today, not a
 * digest. A trade whose fills never matched sat there indefinitely, and the
 * only way to find out was for somebody to open that portfolio's Trade Book
 * and look.
 *
 * ── Subject, owner, due date ─────────────────────────────────────────────
 *
 *   subject   the `accepted_trades` row -- the same thing the lifecycle rule
 *             is about
 *   owner     `accepted_by`, the PM who committed it. Existing semantics; no
 *             new assignment rule.
 *   due_at    `execution_expected_by` where one was set, else null. It is the
 *             only deadline this data model actually has, and inventing one
 *             would be inventing a timing rule.
 */
import { tradeLifecyclePhase } from '../trade-book/lifecycle'

/** The minimum of a trade this needs. Kept narrow so callers can pass rows
 *  from any of the several shapes `accepted_trades` is read into. */
export interface ReviewableTrade {
  id: string
  execution_status: string
  reconciliation_status: string
  staleness_flagged_at?: string | null
  accepted_by?: string | null
  execution_expected_by?: string | null
}

/** One stable kind for this obligation, everywhere. */
export const TRADE_REVIEW_KIND = 'trade_review'

/** Does the EXISTING lifecycle rule say this trade needs review? */
export function needsReview(trade: ReviewableTrade): boolean {
  return tradeLifecyclePhase(trade as never).phase === 'needs_review'
}

export interface ObligationPlan {
  /** Trades whose obligation should exist. Raising is idempotent, so this may
   *  safely include ones already open. */
  raise: ReviewableTrade[]
  /** Ids of trades that no longer need review and whose open obligation should
   *  be cleared. */
  clearSubjectIds: string[]
}

/**
 * What should change, given the trades on hand and the obligations already
 * open for them.
 *
 * Clearing is driven by the PREDICATE going false -- reconciliation resolved,
 * or the staleness flag lifted -- not by anyone having looked. Opening the
 * page is not doing the work, and an obligation that clears on sight is a
 * reminder that deletes itself when noticed.
 */
export function planTradeReviewObligations(
  trades: readonly ReviewableTrade[],
  openSubjectIds: ReadonlySet<string>,
): ObligationPlan {
  const raise: ReviewableTrade[] = []
  const clearSubjectIds: string[] = []

  for (const t of trades) {
    if (!t?.id) continue
    if (needsReview(t)) {
      // Already-open ones are skipped here only to save a round trip; the
      // RPC's open-obligation constraint is what actually guarantees one.
      if (!openSubjectIds.has(t.id)) raise.push(t)
    } else if (openSubjectIds.has(t.id)) {
      clearSubjectIds.push(t.id)
    }
  }

  return { raise, clearSubjectIds }
}
