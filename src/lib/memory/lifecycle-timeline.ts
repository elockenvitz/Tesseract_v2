/**
 * Reading the lifecycle back.
 *
 * Writing events is only half of a Spine. The question the trace document
 * said nobody can answer today — "what happened to this idea, and who did
 * it?" — needs a read path, and the read path is the thing that proves the
 * event shape was chosen correctly.
 *
 * The crossing problem: a single idea's history spans three subject types.
 * `recommendation.submitted` is filed under the IDEA, `decision.recorded`
 * under the DECISION REQUEST, and `execution.recorded` / `decision.reverted`
 * under the TRADE. Querying by `subject_id` alone returns a third of the
 * story. This queries `related->>'trade_queue_item_id'` instead, which every
 * writer populates precisely so that this read works without a join table.
 */
import { supabase } from '../supabase'
import type { LifecycleEventType } from './lifecycle-events'

export interface LifecycleEvent {
  id: string
  event_type: LifecycleEventType | string
  subject_type: string
  subject_id: string
  actor_id: string
  occurred_at: string
  recorded_at: string
  source_type: string | null
  source_id: string | null
  source_field: string | null
  related: Record<string, string>
  payload: Record<string, unknown>
  provenance: string | null
}

const EVENT_SELECT =
  'id, event_type, subject_type, subject_id, actor_id, occurred_at, recorded_at, ' +
  'source_type, source_id, source_field, related, payload, provenance'

/** The four this slice writes. Used to exclude review/obligation events. */
export const LIFECYCLE_EVENT_TYPES: LifecycleEventType[] = [
  'recommendation.submitted',
  'decision.recorded',
  'decision.reverted',
  'execution.recorded',
]

/**
 * Every lifecycle event touching one idea, oldest first.
 *
 * Ordered by `occurred_at` — when the thing happened — not `recorded_at`,
 * which is when the row landed. The two differ for any event written after a
 * retry or, later, by a backfill, and a timeline sorted by write time would
 * show a backfilled 2025 decision after a 2026 one. `id` breaks ties so the
 * order is total and stable across pages.
 */
export async function fetchIdeaLifecycle(
  tradeQueueItemId: string,
): Promise<LifecycleEvent[]> {
  const { data, error } = await supabase
    .from('memory_events')
    .select(EVENT_SELECT)
    .in('event_type', LIFECYCLE_EVENT_TYPES)
    .eq('related->>trade_queue_item_id', tradeQueueItemId)
    .order('occurred_at', { ascending: true })
    .order('id', { ascending: true })

  if (error) throw new Error(`Failed to read idea lifecycle: ${error.message}`)
  return (data ?? []) as unknown as LifecycleEvent[]
}

/**
 * Every lifecycle event touching one accepted trade, oldest first.
 *
 * Both by subject and by relationship, because the decision that produced a
 * trade is filed under the decision request and carries the trade only in
 * `related.accepted_trade_id`. Asking for the trade's own subject rows would
 * return the execution and the revert but not the decision between them.
 */
export async function fetchTradeLifecycle(
  acceptedTradeId: string,
): Promise<LifecycleEvent[]> {
  const { data, error } = await supabase
    .from('memory_events')
    .select(EVENT_SELECT)
    .in('event_type', LIFECYCLE_EVENT_TYPES)
    .eq('related->>accepted_trade_id', acceptedTradeId)
    .order('occurred_at', { ascending: true })
    .order('id', { ascending: true })

  if (error) throw new Error(`Failed to read trade lifecycle: ${error.message}`)
  return (data ?? []) as unknown as LifecycleEvent[]
}

/**
 * Did this idea's decision get reversed, and is that reversal still standing?
 *
 * The reason this is worth a function: after a revert, the canonical rows
 * read as though no decision was ever made. Only the event stream
 * distinguishes "never decided" from "decided and undone", and that is a
 * difference a PM looking at an idea needs to see.
 */
export function summariseLifecycle(events: LifecycleEvent[]) {
  const submitted = events.filter(e => e.event_type === 'recommendation.submitted')
  const decisions = events.filter(e => e.event_type === 'decision.recorded')
  const executions = events.filter(e => e.event_type === 'execution.recorded')
  const reverts = events.filter(e => e.event_type === 'decision.reverted')

  const revertedTradeIds = new Set(
    reverts.map(e => e.related?.accepted_trade_id).filter(Boolean) as string[],
  )
  const standingExecutions = executions.filter(
    e => !revertedTradeIds.has(e.related?.accepted_trade_id ?? e.subject_id),
  )

  return {
    submissionCount: submitted.length,
    decisionCount: decisions.length,
    /** Last decision STATUS, which may since have been reverted. */
    lastDecisionStatus: (decisions.at(-1)?.payload?.status as string | undefined) ?? null,
    executionCount: executions.length,
    revertCount: reverts.length,
    /** Executions not undone — the honest "is anything live" answer. */
    standingExecutionCount: standingExecutions.length,
    /** True when something was decided and every resulting trade was undone. */
    wasDecidedThenReverted: decisions.length > 0 && executions.length > 0 && standingExecutions.length === 0,
  }
}
