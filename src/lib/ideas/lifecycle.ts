/**
 * Did a person actually act on this idea?
 *
 * ── What this file is, and is not ─────────────────────────────────────────
 *
 * It is NOT a lifecycle vocabulary. `trade-status-semantics` already owns
 * that, and owns it well: `isLiveIdea` / `isTerminalIdea` / `TERMINAL_STATUSES`
 * there, with the reasoning for why `outcome` outranks `status` and why
 * neither `stage` nor `visibility_tier` is allowed to answer liveness. Those
 * are re-exported below so callers have one import, not so they have a second
 * definition. Adding an eighth copy of the terminal-status list is the disease,
 * not the cure — there are already seven.
 *
 * What is genuinely missing, and lives here, is the OTHER question:
 *
 *   isLiveIdea          is there open work here, right now?
 *   hasGenuineUserWork  did a person ever act on this?
 *
 * They are different and were conflated, which is the bug this file exists to
 * fix. An executed trade is NOT live and IS genuine work. An untouched pilot
 * seed parked at `deciding` looks live and is NOT work. A rule that cannot
 * tell those apart either suppresses real history or counts the tour as the
 * reader's book, and the pilot visibility rule was doing the first.
 *
 * ── Evidence, not mirrors ─────────────────────────────────────────────────
 *
 * `judgeIdeaRow` used to answer "acted on" from `decided_at`,
 * `decision_outcome` and `outcome` on the idea row. All three are NULL on
 * every one of the 179 active rows in production — including an AAPL idea that
 * was decided, executed, and carries a completed `accepted_trades` record. So
 * the rule reported that nobody had ever acted on anything, and the pilot's
 * one real outcome was filed as an untouched seed.
 *
 * The answer comes instead from the artifacts the action produced: a live
 * `accepted_trades` row, or a governing `decision_requests` row in a decided
 * status. The mirrors are still honoured when set; they are simply not the
 * evidence.
 *
 * Status is deliberately not evidence either. The seeder plants ideas at
 * several stages, so a seed arrives at `deciding` having had nothing done to
 * it — reading status would make every seed look worked the moment it existed.
 */

import {
  hasRecordedDecision,
  governingDecision,
  isDecidedDecisionStatus,
  type DecisionRecord,
  type AcceptedTradeRecord,
} from '../decisions/outcome-eligibility'
import {
  isLiveIdea,
  isTerminalIdea,
  TERMINAL_STATUSES,
  COMMITTED_STATUSES,
  type IdeaLifecycleRow as IdeaLivenessRow,
} from '../trade-status-semantics'

/**
 * The row these rules need: liveness fields, plus the embedded evidence.
 *
 * Evidence travels WITH the row, fetched by the query that read it. Both child
 * tables carry a foreign key to `trade_queue_items`, so PostgREST embeds them
 * in the same request — see `IDEA_EVIDENCE_SELECT`. Judging a list therefore
 * costs one query, not one per row, which is what ruled out looking the
 * evidence up inside the predicate.
 */
export interface IdeaLifecycleRow extends IdeaLivenessRow {
  /** Embedded. `undefined` means "not fetched", not "none exist". */
  accepted_trades?: readonly AcceptedTradeRecord[] | null
  decision_requests?: readonly DecisionRecord[] | null
  /** Legacy mirrors. Honoured when set; null on every production row today. */
  decided_at?: string | null
  decision_outcome?: string | null
}

/**
 * Embed fragment for the evidence, so every caller fetches the same columns.
 *
 * Named here rather than retyped per query because a surface that judges rows
 * without it reads every idea as unworked — silently, and looking exactly like
 * a correct empty result.
 */
export const IDEA_EVIDENCE_SELECT = `
  accepted_trades (id, is_active, reverted_at),
  decision_requests (id, status, created_at)
`

/**
 * Did a person actually act on this idea?
 *
 * Delegates to `hasRecordedDecision`, which already owns what counts as a
 * decision — a live, non-reverted accepted trade, or a governing decision
 * request in a decided status. Restating that here is how the two would drift,
 * and its revert semantics (a reverted trade reopens the question) are subtle
 * enough to be worth having in exactly one place.
 */
export function hasGenuineUserWork(row: IdeaLifecycleRow | null | undefined): boolean {
  if (!row) return false

  if (hasRecordedDecision(row.decision_requests ?? [], row.accepted_trades ?? [])) return true

  return !!row.decided_at || !!row.decision_outcome || !!row.outcome
}

/**
 * Did this idea end by becoming a position, rather than being dropped?
 *
 * Only for describing history to a reader — "Executed Sep 28" rather than
 * "Closed". Never a liveness test: use `isLiveIdea`.
 */
export function isCommittedIdea(row: IdeaLifecycleRow | null | undefined): boolean {
  if (!row) return false
  if ((row.accepted_trades ?? []).some(t => t.is_active !== false && !t.reverted_at)) return true
  const status = String(row.status ?? '').trim().toLowerCase()
  return status === 'executed' || (COMMITTED_STATUSES as string[]).includes(status)
}

/** Whether the evidence this row would need was actually fetched. */
export function hasEvidenceEmbedded(row: IdeaLifecycleRow | null | undefined): boolean {
  return !!row && (row.accepted_trades !== undefined || row.decision_requests !== undefined)
}

// The liveness vocabulary, re-exported so callers need one import. Defined in
// `trade-status-semantics` — do not shadow these.
export { isLiveIdea, isTerminalIdea, TERMINAL_STATUSES, governingDecision, isDecidedDecisionStatus }
export type { DecisionRecord, AcceptedTradeRecord }
