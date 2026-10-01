/**
 * The four lifecycle moments that currently leave no durable memory.
 *
 * ── What this is for ─────────────────────────────────────────────────────
 *
 * `audit_events` holds 316 stage transitions for ideas and ZERO rows for
 * recommendations, decisions or executions. The most consequential moments in
 * the product — someone recommending a trade, someone deciding on it, the
 * trade being committed, that commitment being undone — are invisible to
 * organisational memory. This writes one Spine event at each.
 *
 * ── The rule, inherited and unchanged ────────────────────────────────────
 *
 * From the foundation migration: "The Spine CONNECTS existing truth; it does
 * not duplicate and compete with it." So each event carries POINTERS
 * (`source_type`/`source_id`, `related`) and a payload of normalised scalars
 * only. No thesis, no rationale, no proposal blob, no decision note. Re-read
 * the canonical row for content; the event says an action occurred, who did
 * it, and when.
 *
 * It also says only what is true. `decision.recorded` carries a status and no
 * reason, because today no reason is durably captured — a free-text
 * `decision_note` that a later revert nulls is not a reason. Memory must never
 * imply we know WHY when we only know WHAT.
 *
 * ── Why one module ───────────────────────────────────────────────────────
 *
 * `useThesisReview` and `useDecisionReview` each inline their own insert.
 * That was fine for two; it is not a pattern to copy four more times, because
 * the parts that matter — the dedupe contract, the duplicate-tolerance rule,
 * the "never block the canonical action" rule — have to be identical
 * everywhere or the guarantees are not guarantees. This is the one place they
 * live. It is not a second abstraction; it is the first.
 */
import { supabase } from '../supabase'

/** The vocabulary this module writes. Mirrors the CHECK on `memory_events`. */
export type LifecycleEventType =
  | 'recommendation.submitted'
  | 'decision.recorded'
  | 'decision.reverted'
  | 'execution.recorded'

/** Subject kinds the table's CHECK already permits. */
type SubjectType = 'asset' | 'idea' | 'decision' | 'trade' | 'batch' | 'portfolio' | 'obligation'

interface EmitInput {
  organizationId: string
  actorId: string
  eventType: LifecycleEventType
  subjectType: SubjectType
  subjectId: string
  /** The canonical row this event is ABOUT. Always set for these four. */
  sourceType: string
  sourceId: string
  /** The column on that row holding the human content, when one exists. */
  sourceField?: string
  /** Pointers to the other canonical rows, so a reader can navigate. */
  related?: Record<string, string | null | undefined>
  /** Normalised scalars only. Never prose, never a blob. */
  payload?: Record<string, string | number | boolean | null | undefined>
  /** Deterministic from the canonical source. See each writer below. */
  dedupeKey: string
  /** Which surface recorded it, matching `ui:*` already in use. */
  provenance: string
}

/**
 * Strip keys whose value is undefined/null.
 *
 * `related` and `payload` are jsonb and NOT NULL with a `{}` default. Writing
 * explicit nulls would make an absent relationship indistinguishable from one
 * that was looked up and found empty — and for `decision_request_id` on a
 * simulation promotion, that difference is the whole point.
 */
function compact<T extends Record<string, unknown>>(obj: T | undefined): Record<string, unknown> {
  if (!obj) return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v
  }
  return out
}

/**
 * Write one event.
 *
 * ── Failure model, chosen deliberately ───────────────────────────────────
 *
 * The canonical write has already happened when this is called, and this
 * NEVER throws. A failure to record memory must not fail a portfolio action
 * that already succeeded: refusing to let a PM accept a trade because an
 * append-only log was briefly unavailable would be a worse product than one
 * with a gap in its history.
 *
 * The cost is honest and worth stating: an event can be lost. Because every
 * dedupe key here is deterministic from canonical rows that still exist, a
 * lost event is recoverable by the same backfill that will seed history —
 * which is precisely why the keys are derived from the source rather than
 * from a clock or a random id.
 *
 * A duplicate is success, not failure: it means the same action was already
 * recorded, which is the idempotency doing its job.
 */
async function emit(input: EmitInput): Promise<{ written: boolean; duplicate: boolean }> {
  try {
    const { error } = await supabase.from('memory_events').insert({
      organization_id: input.organizationId,
      actor_id: input.actorId,
      event_type: input.eventType,
      subject_type: input.subjectType,
      subject_id: input.subjectId,
      source_type: input.sourceType,
      source_id: input.sourceId,
      source_field: input.sourceField ?? null,
      related: compact(input.related),
      payload: compact(input.payload),
      provenance: input.provenance,
      dedupe_key: input.dedupeKey,
    } as never)

    if (!error) return { written: true, duplicate: false }

    if (/duplicate key|unique constraint/i.test(error.message)) {
      return { written: false, duplicate: true }
    }
    console.warn(`[memory] ${input.eventType} not recorded:`, error.message)
    return { written: false, duplicate: false }
  } catch (err) {
    console.warn(`[memory] ${input.eventType} not recorded:`, err)
    return { written: false, duplicate: false }
  }
}

/**
 * Resolve the organisation an event belongs to.
 *
 * Only `portfolios` and `trade_queue_items` carry `organization_id` — neither
 * `decision_requests` nor `accepted_trades` does, so every writer here has to
 * reach one hop to find it. Portfolio is the hop that always exists: both of
 * those tables have `portfolio_id` NOT NULL, while `trade_queue_item_id` is
 * nullable on `accepted_trades`.
 *
 * Cached for the page session. A portfolio cannot change organisation — that
 * would be a tenancy violation, not an update — so a stale entry is not a
 * class of bug that exists here.
 *
 * Returns null rather than throwing on failure: no org means no event, and
 * no event must never mean no trade.
 */
const orgByPortfolio = new Map<string, string | null>()

export async function resolveOrganizationIdForPortfolio(
  portfolioId: string | null | undefined,
): Promise<string | null> {
  if (!portfolioId) return null
  const cached = orgByPortfolio.get(portfolioId)
  if (cached !== undefined) return cached
  try {
    const { data, error } = await supabase
      .from('portfolios')
      .select('organization_id')
      .eq('id', portfolioId)
      .maybeSingle()
    const org = error ? null : ((data as { organization_id?: string } | null)?.organization_id ?? null)
    orgByPortfolio.set(portfolioId, org)
    return org
  } catch {
    return null
  }
}

/** Test seam: the cache is module state and would leak between cases. */
export function __resetOrgCacheForTests() {
  orgByPortfolio.clear()
}

/* ─────────────────────────── the four writers ───────────────────────────── */

export interface RecommendationSubmittedInput {
  organizationId: string
  actorId: string
  /** The idea the recommendation is about — the event's subject. */
  tradeQueueItemId: string
  decisionRequestId: string
  proposalId?: string | null
  /**
   * The immutable `trade_proposal_versions` row this submission froze.
   *
   * A POINTER, never a copy. The version holds the thesis, conviction and
   * target that were current at submission; duplicating any of that into the
   * event would make memory a competing store of the same truth, which the
   * Spine's foundation exists to avoid. The event says a recommendation was
   * submitted and where to read exactly what it said.
   */
  proposalVersionId?: string | null
  portfolioId?: string | null
  assetId?: string | null
  action?: string | null
  sizingMode?: string | null
  weight?: number | null
  shares?: number | null
  provenance?: string
}

/**
 * A recommendation reached a PM.
 *
 * Subject is the IDEA, not the request: "this idea was recommended" is the
 * fact a reader wants on an idea's timeline, and the request is reachable
 * through `source_id`.
 *
 * Dedupe is the submission's CONTENT, not its clock. `updateDecisionRequest`
 * stamps a fresh `updated_at` on every call, so keying on time would let a
 * retry — the client losing a response after the canonical write succeeded —
 * record a second submission that never happened. Keying on the sizing
 * actually submitted means an identical retry lands once, and a genuine
 * resubmission at a different size is correctly a new event.
 */
export async function recordRecommendationSubmitted(input: RecommendationSubmittedInput) {
  return emit({
    organizationId: input.organizationId,
    actorId: input.actorId,
    eventType: 'recommendation.submitted',
    subjectType: 'idea',
    subjectId: input.tradeQueueItemId,
    sourceType: 'decision_requests',
    sourceId: input.decisionRequestId,
    related: {
      decision_request_id: input.decisionRequestId,
      proposal_id: input.proposalId,
      proposal_version_id: input.proposalVersionId,
      portfolio_id: input.portfolioId,
      asset_id: input.assetId,
      trade_queue_item_id: input.tradeQueueItemId,
    },
    payload: {
      action: input.action,
      sizing_mode: input.sizingMode,
      weight: input.weight,
      shares: input.shares,
    },
    dedupeKey: [
      'recommendation.submitted',
      input.decisionRequestId,
      input.proposalId ?? 'no-proposal',
      input.sizingMode ?? 'no-mode',
      input.weight ?? 'no-weight',
      input.shares ?? 'no-shares',
    ].join(':'),
    provenance: input.provenance ?? 'ui:recommendation',
  })
}

export interface DecisionRecordedInput {
  organizationId: string
  actorId: string
  decisionRequestId: string
  /** accepted | accepted_with_modification | rejected | deferred */
  status: string
  tradeQueueItemId?: string | null
  proposalId?: string | null
  portfolioId?: string | null
  acceptedTradeId?: string | null
  provenance?: string
}

/**
 * A PM resolved a recommendation.
 *
 * One event type carrying the status, rather than four types. The status is a
 * property of the decision, not a different kind of happening, and
 * `decision_requests.status` is already the canonical vocabulary — mirroring
 * it into the event-type namespace would mean two places to change when a
 * fifth status appears.
 *
 * NO RATIONALE IS CARRIED, deliberately. `decision_note` is free text that a
 * revert nulls and a Trade Lab execute overwrites; recording it here would
 * assert durable knowledge of why, which the product does not have. When
 * structured reasons exist (a later slice) they belong in their own event.
 *
 * Dedupe includes `accepted_trade_id` so that accept → revert → accept-again
 * is two distinct decisions — because it is — while a retry of one accept,
 * which produces no new trade, lands once.
 */
export async function recordDecisionRecorded(input: DecisionRecordedInput) {
  return emit({
    organizationId: input.organizationId,
    actorId: input.actorId,
    eventType: 'decision.recorded',
    subjectType: 'decision',
    subjectId: input.decisionRequestId,
    sourceType: 'decision_requests',
    sourceId: input.decisionRequestId,
    related: {
      trade_queue_item_id: input.tradeQueueItemId,
      proposal_id: input.proposalId,
      portfolio_id: input.portfolioId,
      accepted_trade_id: input.acceptedTradeId,
    },
    payload: { status: input.status },
    dedupeKey: [
      'decision.recorded',
      input.decisionRequestId,
      input.status,
      input.acceptedTradeId ?? 'no-trade',
    ].join(':'),
    provenance: input.provenance ?? 'ui:decision-inbox',
  })
}

export interface DecisionRevertedInput {
  organizationId: string
  actorId: string
  acceptedTradeId: string
  decisionRequestId?: string | null
  tradeQueueItemId?: string | null
  portfolioId?: string | null
  provenance?: string
}

/**
 * A committed trade was undone.
 *
 * Appended, never destructive: the original `decision.recorded` and
 * `execution.recorded` events stay exactly as they were. That is the point of
 * recording this at all — the canonical rows are reset in place (the revert
 * nulls `decision_note` and flips the DR back to `pending`), so without an
 * event the history reads as though the decision never happened rather than
 * as though it was reversed.
 *
 * Dedupe is the trade id alone. A trade can be reverted once — `is_active`
 * goes false — and re-executing produces a new trade with a new id, so a
 * genuine second reversal is naturally a distinct key.
 */
export async function recordDecisionReverted(input: DecisionRevertedInput) {
  return emit({
    organizationId: input.organizationId,
    actorId: input.actorId,
    eventType: 'decision.reverted',
    subjectType: 'trade',
    subjectId: input.acceptedTradeId,
    sourceType: 'accepted_trades',
    sourceId: input.acceptedTradeId,
    // Revert is the one moment in this slice where a reason IS durably
    // captured: `revertAcceptedTrade` requires one and stores it. Point at
    // the column instead of copying the prose into the payload — that is what
    // source_field is for, and it keeps the canonical row the single truth.
    sourceField: 'revert_reason',
    related: {
      accepted_trade_id: input.acceptedTradeId,
      decision_request_id: input.decisionRequestId,
      trade_queue_item_id: input.tradeQueueItemId,
      portfolio_id: input.portfolioId,
    },
    dedupeKey: `decision.reverted:${input.acceptedTradeId}`,
    provenance: input.provenance ?? 'ui:decision-inbox',
  })
}

export interface ExecutionRecordedInput {
  organizationId: string
  actorId: string
  acceptedTradeId: string
  portfolioId?: string | null
  assetId?: string | null
  /** Absent on a simulation promotion. See the note below. */
  decisionRequestId?: string | null
  tradeQueueItemId?: string | null
  proposalId?: string | null
  action?: string | null
  provenance?: string
}

/**
 * A trade became canonical.
 *
 * `decision_request_id` is OPTIONAL and is written only when one exists.
 * Simulation promotion commits a trade without ever creating a decision
 * request, and an active `accepted_trades` row is itself legitimate decision
 * evidence there. Inventing a request to satisfy a uniform shape would put a
 * decision in the record that nobody made — the exact failure this module
 * exists to avoid. A reader distinguishes the two by the relationship's
 * presence, which is why `compact()` omits empty keys rather than writing
 * null.
 *
 * Dedupe is the trade id: one row, one execution, naturally retry-safe.
 */
export async function recordExecutionRecorded(input: ExecutionRecordedInput) {
  return emit({
    organizationId: input.organizationId,
    actorId: input.actorId,
    eventType: 'execution.recorded',
    subjectType: 'trade',
    subjectId: input.acceptedTradeId,
    sourceType: 'accepted_trades',
    sourceId: input.acceptedTradeId,
    related: {
      accepted_trade_id: input.acceptedTradeId,
      decision_request_id: input.decisionRequestId,
      trade_queue_item_id: input.tradeQueueItemId,
      proposal_id: input.proposalId,
      portfolio_id: input.portfolioId,
      asset_id: input.assetId,
    },
    payload: { action: input.action },
    dedupeKey: `execution.recorded:${input.acceptedTradeId}`,
    provenance: input.provenance ?? 'ui:trade-lab',
  })
}

/** Exported for the backfill dry-run and for tests, so keys cannot drift. */
export const dedupeKeys = {
  recommendationSubmitted: (
    drId: string, proposalId: string | null, sizingMode: string | null,
    weight: number | null, shares: number | null,
  ) => [
    'recommendation.submitted', drId, proposalId ?? 'no-proposal',
    sizingMode ?? 'no-mode', weight ?? 'no-weight', shares ?? 'no-shares',
  ].join(':'),
  decisionRecorded: (drId: string, status: string, acceptedTradeId: string | null) =>
    ['decision.recorded', drId, status, acceptedTradeId ?? 'no-trade'].join(':'),
  decisionReverted: (acceptedTradeId: string) => `decision.reverted:${acceptedTradeId}`,
  executionRecorded: (acceptedTradeId: string) => `execution.recorded:${acceptedTradeId}`,
}
