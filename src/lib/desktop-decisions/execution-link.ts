/**
 * Which accepted trade executed a decision request.
 *
 * ── The canonical link, and the gap in it ────────────────────────────────
 *
 * `decision_requests.accepted_trade_id` is the direct link, and the Inbox
 * accept path writes it. Trade Lab Execute did not: it resolved or created the
 * request BEFORE the trade existed and never came back to set it. So every
 * Trade Lab execution after the April backfill reached Decisions with no
 * execution and no batch -- an executed trade read as "Never executed", and the
 * batch's written rationale was invisible.
 *
 * The writer now sets the link at execution time. For the rows written before
 * that, the trade side already carries the answer: `accepted_trades.
 * decision_request_id` is a foreign key to the request, written by the same
 * execute call. Following it back is a lookup, not a match.
 *
 * ── Deterministic only ─────────────────────────────────────────────────────
 *
 * The fallback accepts a trade only when ALL of these hold, and only when
 * exactly one trade does:
 *
 *   - it names this request in `decision_request_id` (the FK, never a
 *     symbol, portfolio or time-window guess)
 *   - it is in the request's own portfolio
 *   - it is active -- a reverted or cancelled trade did not execute the decision
 *   - it is an original, not a correction of another trade
 *
 * and only for a request that was accepted. Anything ambiguous returns null and
 * the record stays "no execution on record", which is honest; attaching the
 * wrong trade would not be.
 */

export interface TradeLinkCandidate {
  id: string
  decision_request_id: string | null
  portfolio_id: string | null
  is_active: boolean | null
  corrects_accepted_trade_id: string | null
}

export interface RequestForLink {
  id: string
  portfolio_id: string
  status: string | null
  /** The direct FK, where it was written. */
  accepted_trade_id: string | null
}

const ACCEPTED = new Set(['accepted', 'accepted_with_modification'])

/** Requests whose execution has to be looked up from the trade side. */
export function needsExecutionFallback(r: RequestForLink): boolean {
  return !r.accepted_trade_id && ACCEPTED.has(r.status ?? '')
}

export function fallbackExecutionFor<T extends TradeLinkCandidate>(
  request: RequestForLink,
  trades: readonly T[],
): T | null {
  if (!needsExecutionFallback(request)) return null
  const matches = trades.filter(t =>
    t.decision_request_id === request.id
    && t.portfolio_id === request.portfolio_id
    && t.is_active === true
    && !t.corrects_accepted_trade_id,
  )
  return matches.length === 1 ? matches[0] : null
}
