/**
 * When may an investment outcome be recorded?
 *
 * ── The rule this replaces ────────────────────────────────────────────────
 *
 * The service used to answer this with the idea's STAGE:
 *
 *     if (outcome && stage !== 'deciding')          -> refuse     (original)
 *     if (outcome && stage !== 'ready_to_recommend') -> refuse     (four-stage pass)
 *
 * The second is the first with a new name, and both are wrong in the same
 * way. `ready_to_recommend` means "the analyst considers this mature enough to
 * advocate". It says nothing about whether anybody decided anything. An idea
 * can sit there for a month with no recommendation ever submitted, and the old
 * rule would happily let a drag-and-drop stamp `outcome = 'executed'` on it.
 *
 * Stage is maturity. An outcome is the result of a DECISION. Maturity is not
 * evidence of a decision, so it cannot gate one.
 *
 * ── What counts as evidence ───────────────────────────────────────────────
 *
 * Two records in this database represent a decision actually having been
 * taken. Both are real; neither is invented for this rule:
 *
 *   1. A decided `decision_requests` row — a recommendation went to the
 *      Decision Inbox and a PM acted on it.
 *
 *   2. An active `accepted_trades` row — the trade was committed. This covers
 *      promotion straight from simulation, which never creates a decision
 *      request. `accepted_trades` is the canonical record of a committed
 *      trade, and both promotion paths create it BEFORE moving the idea
 *      (`accepted-trade-service` even notes "outcome only advances via
 *      accepted_trade creation"), so the evidence is present at the moment
 *      the outcome is written.
 *
 * Requiring only (1) would have been wrong: it would declare the Inbox the
 * only legitimate way to decide, and broken every simulation promotion.
 */

import { supabase } from '../supabase'

/**
 * The statuses that mean a PM actually decided.
 *
 * ── Why this is NOT `RESOLVED_DECISION_REQUEST_STATUSES` ──────────────────
 *
 * That set exists to answer a different question — "is this row still
 * mutable?" — and it includes `withdrawn`. Withdrawal is the ANALYST pulling
 * their own recommendation back; nobody decided anything. Worse, the withdraw
 * path stamps `reviewed_by` and `reviewed_at` with the withdrawing analyst's
 * own id, so those columns cannot be used as a decision test either: 23 of the
 * 29 withdrawn rows in production carry a `reviewed_at`.
 *
 * `DecisionInbox` already reaches the same conclusion in its own filtering —
 * "withdrawn is a resubmission/cleanup state, not a terminal decision" — and
 * `desktop-decisions/model` keeps `withdrawn` as its own outcome kind rather
 * than folding it into `rejected`. This is that judgement, made once, where
 * the outcome rule can use it.
 */
export const DECIDED_DECISION_STATUSES: readonly string[] = [
  'accepted',
  'accepted_with_modification',
  'rejected',
  'deferred',
] as const

export function isDecidedDecisionStatus(status: string | null | undefined): boolean {
  return !!status && DECIDED_DECISION_STATUSES.includes(status)
}

/** The shape this module needs from a decision request. */
export interface DecisionRecord {
  status: string | null
  created_at?: string | null
}

/** The shape this module needs from an accepted trade. */
export interface AcceptedTradeRecord {
  is_active?: boolean | null
  reverted_at?: string | null
}

/**
 * Which decision request governs, when an idea has several.
 *
 * It routinely has several: 109 requests across 72 ideas in production, one
 * with thirteen. The pattern is a run of `withdrawn` resubmissions followed by
 * the live one.
 *
 * The governing record is the MOST RECENT by `created_at`, not "any request
 * that was ever decided". The difference matters because of revert:
 * `revertAcceptedTrade` sets the request back to `pending` precisely to
 * reopen the question. Under "any ever decided" a reverted decision would
 * still count as decided, which defeats the revert; under "most recent" it
 * correctly reads as undecided again.
 *
 * The two rules disagree on exactly one of the 72 ideas in production today,
 * so this is a choice about correctness rather than about the current corpus.
 */
export function governingDecision<T extends DecisionRecord>(requests: readonly T[]): T | null {
  if (!requests || requests.length === 0) return null

  return [...requests].sort((a, b) => {
    const ta = Date.parse(a.created_at ?? '') || 0
    const tb = Date.parse(b.created_at ?? '') || 0
    // Newest first. Ties keep their original relative order, which is the
    // best available answer when two rows share a timestamp.
    return tb - ta
  })[0]
}

/**
 * Is there evidence that a decision was recorded for this idea?
 *
 * Pure, so the rule can be tested without a database. The IO lives in
 * `fetchOutcomeEligibility` below.
 */
export function hasRecordedDecision(
  requests: readonly DecisionRecord[],
  acceptedTrades: readonly AcceptedTradeRecord[],
): boolean {
  // A live committed trade is a decision, whatever route produced it.
  const hasLiveTrade = (acceptedTrades ?? []).some(
    (t) => t.is_active !== false && !t.reverted_at,
  )
  if (hasLiveTrade) return true

  const governing = governingDecision(requests ?? [])
  return isDecidedDecisionStatus(governing?.status)
}

export interface OutcomeEligibility {
  eligible: boolean
  /** Populated only when not eligible — a sentence for the user, not a code. */
  reason?: string
}

/**
 * The canonical answer, with its IO.
 *
 * One query pair, one place. Both the single-idea and the pair-trade path in
 * `trade-idea-service` call this; previously the pair path performed no
 * outcome validation at all.
 */
export async function fetchOutcomeEligibility(tradeId: string): Promise<OutcomeEligibility> {
  const [{ data: requests }, { data: trades }] = await Promise.all([
    supabase
      .from('decision_requests')
      .select('status, created_at')
      .eq('trade_queue_item_id', tradeId),
    supabase
      .from('accepted_trades')
      .select('is_active, reverted_at')
      .eq('trade_queue_item_id', tradeId),
  ])

  const reqs = (requests ?? []) as DecisionRecord[]
  const acc = (trades ?? []) as AcceptedTradeRecord[]

  if (hasRecordedDecision(reqs, acc)) return { eligible: true }

  // Say which of the three situations this is. "Not eligible" on its own
  // sends the reader looking for a bug; naming the state tells them what to
  // do next.
  const governing = governingDecision(reqs)
  if (!governing) {
    return {
      eligible: false,
      reason:
        'No recommendation has been submitted for this idea, so there is no decision to record an outcome against.',
    }
  }
  if (governing.status === 'withdrawn') {
    return {
      eligible: false,
      reason:
        'The most recent recommendation was withdrawn rather than decided. Submit a new recommendation for a decision.',
    }
  }
  return {
    eligible: false,
    reason:
      'This recommendation is still awaiting a decision in the Decision Inbox. Record the decision there first.',
  }
}
