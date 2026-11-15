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

/* ──────────────────────── canonical event identity ─────────────────────── */

/**
 * A timestamp reduced to the one form both sides of a comparison can agree on.
 *
 * This exists because a dedupe key containing a timestamp is only idempotent
 * if the live writer and a later reconciler render that timestamp identically,
 * and by default they do not:
 *
 *   the browser sends   2026-11-15T12:00:00.123Z     (JS, millisecond)
 *   Postgres stores     2026-11-15 12:00:00.123+00   (timestamptz, microsecond)
 *   PostgREST returns   2026-11-15T12:00:00.123+00:00
 *
 * Three different strings for one instant. Keying on any of them literally
 * would mean the reconciler rebuilt a key that never matched, appended a
 * second event into an append-only table, and called it a repair.
 *
 * So the key carries epoch MILLISECONDS as an integer: no colons to collide
 * with the key's own separator, no timezone spelling, no trailing-zero
 * question. Microseconds are truncated on both sides identically. Two
 * resolutions of the same request inside one millisecond would collapse to one
 * event, which is the correct answer for a double-submit and is not reachable
 * by a human through two network round trips.
 */
export function eventInstantToken(value: string | null | undefined): string {
  if (!value) return 'no-instant'
  const t = Date.parse(value)
  if (!Number.isFinite(t)) return 'no-instant'
  return String(t)
}

/**
 * The identity of each event, as one definition.
 *
 * Exported for the detector, the backfill dry-run and the tests so the key
 * cannot drift from the writers — and the writers below now CALL these rather
 * than re-deriving the same string inline, which is what let
 * `decision.recorded` drift in the first place.
 *
 * ── Why `decision.recorded` is keyed on `reviewed_at` ────────────────────
 *
 * It used to be keyed on `accepted_trade_id`, and that was wrong in both
 * directions at once. Measured in production on 2026-11-15:
 *
 *   both live `decision.recorded` rows carry  ...:accepted:no-trade
 *   both decision requests they describe now carry a real accepted_trade_id
 *
 * because on the inbox path and on `markDRAccepted` the request is resolved —
 * and the event emitted — BEFORE the trade exists; `accepted_trade_id` is
 * written by a separate later call (`linkDecisionRequestToTrade`). The
 * consequences:
 *
 *   1. Reconciliation was impossible. A backfill rebuilding the key from the
 *      canonical row produces the trade-bearing form, misses, and appends a
 *      SECOND event for a decision already recorded. The detector had to
 *      match on `(event_type, source_id)` instead and said so at length.
 *   2. The key did the OPPOSITE of its stated purpose. It named the trade so
 *      that accept → revert → accept-again read as two decisions; because the
 *      value is null at emit time, both accepts produced
 *      `...:accepted:no-trade` and the second was swallowed as a duplicate.
 *
 * `reviewed_at` has neither problem. It is written by the SAME statement that
 * sets the status, so it is final at emit time and reproducible from the row
 * afterwards; and a revert leaves it in place while a re-accept overwrites it
 * with a new instant, so the two accepts are genuinely two keys.
 *
 * The honest residual: if the resolving UPDATE itself runs twice (a true
 * double-submit, not an emit retry), it mints a second `reviewed_at` and
 * yields a second event. That is a fair reading of the data — after the second
 * UPDATE the canonical row says the decision was made at the later instant and
 * no longer records the earlier one — and it is the case the old key handled
 * by accident while breaking the two above. An emit retry over one UPDATE,
 * which is the retry that actually happens here, lands exactly once.
 */
export const dedupeKeys = {
  recommendationSubmitted: (
    drId: string, proposalId: string | null, sizingMode: string | null,
    weight: number | null, shares: number | null,
  ) => [
    'recommendation.submitted', drId, proposalId ?? 'no-proposal',
    sizingMode ?? 'no-mode', weight ?? 'no-weight', shares ?? 'no-shares',
  ].join(':'),
  decisionRecorded: (drId: string, status: string, reviewedAt: string | null) =>
    ['decision.recorded', drId, status, eventInstantToken(reviewedAt)].join(':'),
  decisionReverted: (acceptedTradeId: string) => `decision.reverted:${acceptedTradeId}`,
  executionRecorded: (acceptedTradeId: string) => `execution.recorded:${acceptedTradeId}`,
}

/**
 * The `decision.recorded` key as it was written before 2026-11-15.
 *
 * READ-ONLY. Nothing may emit with this. It exists so that a future backfill
 * can recognise the rows that already carry the old shape instead of appending
 * duplicates beside them, and so the detector can report how many of those
 * remain. Production holds exactly two such rows and they are NOT rewritten:
 * editing an append-only history to match a new formula would be rewriting
 * decision history to suit the code.
 *
 * Frozen deliberately. If the current key changes again, this stays as it is
 * and a second legacy entry joins it.
 */
export const legacyDedupeKeys = {
  decisionRecorded: (drId: string, status: string, acceptedTradeId: string | null) =>
    ['decision.recorded', drId, status, acceptedTradeId ?? 'no-trade'].join(':'),
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
    dedupeKey: dedupeKeys.recommendationSubmitted(
      input.decisionRequestId,
      input.proposalId ?? null,
      input.sizingMode ?? null,
      input.weight ?? null,
      input.shares ?? null,
    ),
    provenance: input.provenance ?? 'ui:recommendation',
  })
}

export interface DecisionRecordedInput {
  organizationId: string
  actorId: string
  decisionRequestId: string
  /** accepted | accepted_with_modification | rejected | deferred */
  status: string
  /**
   * `decision_requests.reviewed_at` AS THE RESOLVING WRITE SET IT. Required,
   * not optional, and that is the whole point — see `dedupeKeys` below.
   *
   * Pass the value the UPDATE actually wrote (read back from its `returning`
   * row, or the exact string that was sent). Never `new Date()` at the moment
   * of the emit: a freshly minted clock reading is not the canonical row's
   * identity and would make the key unreproducible from the database.
   *
   * Required so that a sixth decision path cannot be added without supplying
   * it. The compiler is the gate; a nullable field would have let the defect
   * this replaces reappear silently.
   */
  reviewedAt: string | null
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
 * Dedupe is the request plus the resolution's own timestamp. See `dedupeKeys`
 * for why it is not the accepted trade id, which was the previous choice and
 * was unsound in both directions.
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
    dedupeKey: dedupeKeys.decisionRecorded(
      input.decisionRequestId,
      input.status,
      input.reviewedAt,
    ),
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
    dedupeKey: dedupeKeys.decisionReverted(input.acceptedTradeId),
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
    dedupeKey: dedupeKeys.executionRecorded(input.acceptedTradeId),
    provenance: input.provenance ?? 'ui:trade-lab',
  })
}
