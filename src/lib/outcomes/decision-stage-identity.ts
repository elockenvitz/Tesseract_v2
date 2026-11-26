/**
 * Who answered what, and how many rows that is.
 *
 * Two rules Outcomes got wrong, extracted so they can be asserted directly
 * rather than inferred from a rendered row.
 */
import type { DecisionStage } from '../../types/decision-accountability'

/**
 * A `decision_requests.status` as the stage it actually is.
 *
 * This replaces `d.status === 'deferred' ? 'rejected' : d.status`, which was
 * written because `DecisionStage` had no `deferred` member, and which
 * compiled only because of a cast through `any`. A PM who deferred META was
 * shown in the log of record as having rejected it.
 *
 * An unrecognised status falls back to `cancelled`, not `rejected`. Both are
 * terminal, but `rejected` attributes a judgment to the PM and `cancelled`
 * does not, so a status this function has never seen must not be reported as
 * a rejection somebody made.
 */
export function stageFromRequestStatus(status: string | null | undefined): DecisionStage {
  switch (status) {
    case 'approved':
    case 'accepted':
      return 'approved'
    case 'rejected':
      return 'rejected'
    case 'deferred':
      return 'deferred'
    case 'cancelled':
      return 'cancelled'
    default:
      return 'cancelled'
  }
}

/** Just enough of a row to decide whether it is a duplicate. */
export interface SupersedableRow {
  decision_id: string
  category: string
}

/** Just enough of a `decision_requests` row: the idea it was raised against. */
export interface PassedRequestRef {
  trade_idea?: { id?: string | null } | null
}

/**
 * Drop the idea-sourced rows that a passed decision request already covers.
 *
 * Rejecting a recommendation writes the outcome onto the idea AND leaves the
 * `decision_requests` row in `rejected`, so both row sources emit one and the
 * decision is listed twice.
 *
 * The two rows cannot be deduplicated by `decision_id`: the idea-sourced row
 * keys on the `trade_queue_items` id and the request-sourced row on the
 * `decision_requests` id, so the same decision carries two different ids and
 * nothing ever collides. The shared identity is the IDEA.
 *
 * The request wins, because it is the record of the PM's answer: the
 * reviewer, the review timestamp, the frozen `proposal_version`, and the true
 * `deferred`/`rejected` status. The idea row carries the outcome copied onto
 * the idea, which is why a deferral read as a rejection there at all.
 *
 * Only `passed` rows are dropped. An approved or executed row is never a
 * duplicate of a passed request, and dropping one would take its matched
 * executions with it. An idea rejected with no request of its own is not
 * covered by anything here, so it stays listed.
 */
export function dropIdeaRowsSupersededByRequest<T extends SupersedableRow>(
  ideaRows: T[],
  passedRequests: PassedRequestRef[] | null | undefined,
): T[] {
  const covered = new Set<string>()
  for (const r of passedRequests ?? []) {
    const id = r?.trade_idea?.id
    if (id) covered.add(id)
  }
  if (covered.size === 0) return ideaRows
  return ideaRows.filter(r => !(r.category === 'passed' && covered.has(r.decision_id)))
}
