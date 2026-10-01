/**
 * Decision Request Service
 *
 * CRUD operations for decision_requests table.
 * Decision requests are the canonical PM workflow object — they represent
 * a formal request for PM review of a trade recommendation.
 *
 * Status lifecycle:
 *   ACTIVE (mutable):   pending → under_review → needs_discussion
 *   RESOLVED (immutable): accepted, rejected, deferred, withdrawn
 *
 * Rules:
 *   - Active requests can be updated in place (e.g., analyst edits sizing)
 *   - Resolved requests are NEVER mutated — resubmission creates a new request
 *   - At most ONE active request per (trade, portfolio, requester) at a time
 */

import { supabase } from '../supabase'
import {
  recordDecisionRecorded,
  resolveOrganizationIdForPortfolio,
} from '../memory/lifecycle-events'
import type { DecisionRequest, DecisionRequestUrgency, DecisionRequestStatus } from '../../types/trading'

// ---------------------------------------------------------------------------
// Status classification — single source of truth
// ---------------------------------------------------------------------------

/** Statuses where a request is still awaiting PM action and can be updated */
export const ACTIVE_DECISION_REQUEST_STATUSES: readonly DecisionRequestStatus[] = [
  'pending',
  'under_review',
  'needs_discussion',
] as const

/** Statuses where a PM has acted — these are historical records, never mutated */
export const RESOLVED_DECISION_REQUEST_STATUSES: readonly DecisionRequestStatus[] = [
  'accepted',
  'accepted_with_modification',
  'rejected',
  'deferred',
  'withdrawn',
] as const

/** Check if a decision request is still active (mutable, awaiting PM action) */
export function isActiveDecisionRequestStatus(status: DecisionRequestStatus): boolean {
  return (ACTIVE_DECISION_REQUEST_STATUSES as readonly string[]).includes(status)
}

/** Check if a decision request has been resolved (immutable historical record) */
export function isResolvedDecisionRequestStatus(status: DecisionRequestStatus): boolean {
  return (RESOLVED_DECISION_REQUEST_STATUSES as readonly string[]).includes(status)
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateDecisionRequestInput {
  tradeQueueItemId: string
  portfolioId: string
  urgency?: DecisionRequestUrgency
  contextNote?: string
  sizingWeight?: number | null
  sizingShares?: number | null
  sizingMode?: string | null
}

export interface UpdateDecisionRequestInput {
  status: DecisionRequestStatus
  decisionNote?: string | null
  deferredUntil?: string | null
  deferredTrigger?: import('../../types/trading').DeferralTrigger | null
  acceptedTradeId?: string | null
}

/*
 * Two embeds here answer two different questions, and conflating them is the
 * defect this slice closes.
 *
 *   `proposal_version`   WHAT WAS RECOMMENDED. Immutable. Read this for all
 *                        historical content — thesis, conviction, target,
 *                        sizing, bull/bear/catalyst/risk cases. Null for the
 *                        113 requests that predate versioning, which the
 *                        resolver in lib/recommendations/
 *                        historical-recommendation.ts handles by falling back
 *                        to submission_snapshot and then saying so.
 *
 *   `trade_queue_item`   CURRENT IDEA STATE. Mutable. Kept because a PM
 *                        looking at a PENDING request legitimately wants
 *                        today's view, and because symbol, company and the
 *                        pair wiring are current facts by nature. Its
 *                        `rationale`, `thesis_text` and `conviction` are
 *                        TODAY'S values — rendering them as the historical
 *                        recommendation is what made past decisions
 *                        re-narrate themselves whenever an idea was edited.
 *
 * No comments inside the template literal: PostgREST parses this string as a
 * select parameter and will reject anything that is not a column list.
 */
const DECISION_REQUEST_SELECT = `
  id, trade_queue_item_id, requested_by, portfolio_id, proposal_id, accepted_trade_id,
  urgency, context_note,
  status, reviewed_by, reviewed_at, decision_note, deferred_until, deferred_trigger,
  sizing_weight, sizing_shares, sizing_mode,
  requested_action, submission_snapshot, proposal_version_id,
  created_at, updated_at,
  requester:requested_by (id, email, first_name, last_name),
  portfolio:portfolio_id (id, name),
  proposal_version:proposal_version_id (
    id, version_number, action, idea_stage, weight, shares, sizing_mode, sizing_context,
    notes, thesis_text, rationale, conviction, target_price, stop_loss, take_profit,
    time_horizon, theses, captured_from, submitted_at, created_at, created_by
  ),
  trade_queue_item:trade_queue_item_id (
    id, action, rationale, thesis_text, conviction, urgency, pair_id, pair_trade_id, pair_leg_type, created_by, assigned_to,
    assets:asset_id (id, symbol, company_name)
  )
`

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function createDecisionRequest(input: CreateDecisionRequestInput): Promise<DecisionRequest> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('decision_requests')
    .insert({
      trade_queue_item_id: input.tradeQueueItemId,
      portfolio_id: input.portfolioId,
      requested_by: user.id,
      urgency: input.urgency || 'medium',
      context_note: input.contextNote || null,
      sizing_weight: input.sizingWeight ?? null,
      sizing_shares: input.sizingShares ?? null,
      sizing_mode: input.sizingMode ?? null,
    })
    .select(DECISION_REQUEST_SELECT)
    .single()

  if (error) throw new Error(`Failed to create decision request: ${error.message}`)
  return data as unknown as DecisionRequest
}

export async function getAllDecisionRequests(portfolioId?: string): Promise<DecisionRequest[]> {
  let query = supabase
    .from('decision_requests')
    .select(DECISION_REQUEST_SELECT)
    .order('created_at', { ascending: false })

  if (portfolioId) {
    query = query.eq('portfolio_id', portfolioId)
  }

  const { data, error } = await query
  if (error) throw new Error(`Failed to fetch decision requests: ${error.message}`)
  return (data || []) as unknown as DecisionRequest[]
}

export async function getDecisionRequestsForPortfolio(portfolioId: string): Promise<DecisionRequest[]> {
  const { data, error } = await supabase
    .from('decision_requests')
    .select(DECISION_REQUEST_SELECT)
    .eq('portfolio_id', portfolioId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to fetch decision requests: ${error.message}`)
  return (data || []) as unknown as DecisionRequest[]
}

export async function getNeedsDecisionRequests(portfolioId?: string): Promise<DecisionRequest[]> {
  let query = supabase
    .from('decision_requests')
    .select(DECISION_REQUEST_SELECT)
    .in('status', [...ACTIVE_DECISION_REQUEST_STATUSES])
    .order('created_at', { ascending: false })

  if (portfolioId) {
    query = query.eq('portfolio_id', portfolioId)
  }

  const { data, error } = await query
  if (error) throw new Error(`Failed to fetch pending decision requests: ${error.message}`)
  return (data || []) as unknown as DecisionRequest[]
}

export async function getDecisionRequestsForIdea(tradeQueueItemId: string): Promise<DecisionRequest[]> {
  const { data, error } = await supabase
    .from('decision_requests')
    .select(DECISION_REQUEST_SELECT)
    .eq('trade_queue_item_id', tradeQueueItemId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to fetch decision requests: ${error.message}`)
  return (data || []) as unknown as DecisionRequest[]
}

export async function getNeedsDecisionCountForIdea(tradeQueueItemId: string): Promise<number> {
  const { count, error } = await supabase
    .from('decision_requests')
    .select('*', { count: 'exact', head: true })
    .eq('trade_queue_item_id', tradeQueueItemId)
    .in('status', [...ACTIVE_DECISION_REQUEST_STATUSES])

  if (error) throw new Error(`Failed to count decision requests: ${error.message}`)
  return count || 0
}

// ---------------------------------------------------------------------------
// Update / Delete
// ---------------------------------------------------------------------------

export async function updateDecisionRequest(
  requestId: string,
  input: UpdateDecisionRequestInput
): Promise<DecisionRequest> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const updates: Record<string, unknown> = {
    status: input.status,
    updated_at: new Date().toISOString(),
  }

  // Set reviewer info on resolved statuses
  if (isResolvedDecisionRequestStatus(input.status)) {
    updates.reviewed_by = user.id
    updates.reviewed_at = new Date().toISOString()
  }

  if (input.decisionNote !== undefined) {
    updates.decision_note = input.decisionNote
  }
  if (input.deferredUntil !== undefined) {
    updates.deferred_until = input.deferredUntil
  }
  if (input.deferredTrigger !== undefined) {
    updates.deferred_trigger = input.deferredTrigger
  }
  if (input.acceptedTradeId !== undefined) {
    updates.accepted_trade_id = input.acceptedTradeId
  }

  const { data, error } = await supabase
    .from('decision_requests')
    .update(updates)
    .eq('id', requestId)
    .select(DECISION_REQUEST_SELECT)
    .single()

  if (error) throw new Error(`Failed to update decision request: ${error.message}`)
  const updated = data as unknown as DecisionRequest

  // ── Record the decision in organisational memory ──────────────────────
  //
  // Here, not at the four call sites, because this function is where every
  // path converges — defer, accept, reject — and a writer per call site is a
  // writer someone forgets to add to the fifth.
  //
  // RESOLVED STATUSES ONLY. `revertAcceptedTrade` calls this with 'pending'
  // to reopen a request; that is the undoing of a decision, not the making of
  // one, and it is recorded as `decision.reverted` by the revert itself. An
  // unguarded emit here would log a phantom decision every time a PM undid a
  // trade.
  if (isResolvedDecisionRequestStatus(input.status)) {
    const organizationId = await resolveOrganizationIdForPortfolio(updated.portfolio_id)
    if (organizationId) {
      await recordDecisionRecorded({
        organizationId,
        actorId: user.id,
        decisionRequestId: requestId,
        status: input.status,
        tradeQueueItemId: updated.trade_queue_item_id ?? null,
        proposalId: updated.proposal_id ?? null,
        portfolioId: updated.portfolio_id ?? null,
        acceptedTradeId: (updates.accepted_trade_id as string | null) ?? null,
      })
    }
  }

  return updated
}

export async function deleteDecisionRequest(requestId: string): Promise<void> {
  const { error } = await supabase
    .from('decision_requests')
    .delete()
    .eq('id', requestId)

  if (error) throw new Error(`Failed to delete decision request: ${error.message}`)
}

// ---------------------------------------------------------------------------
// Recommendation-linked decision request management
// ---------------------------------------------------------------------------

export interface EnsureDecisionRequestInput {
  tradeQueueItemId: string
  portfolioId: string
  proposalId: string
  requestedBy: string
  urgency?: DecisionRequestUrgency
  contextNote?: string | null
  sizingWeight?: number | null
  sizingShares?: number | null
  sizingMode?: string | null
  /** Trade action (buy/sell/add/trim) for quick filtering */
  requestedAction?: string | null
  /** Immutable snapshot of the submitted recommendation state */
  submissionSnapshot?: Record<string, unknown> | null
  /**
   * The immutable recommendation version this request is raised on.
   *
   * This is the canonical record of what was recommended.
   * `submissionSnapshot` above is a projection kept for the 70 requests that
   * predate versioning; it holds sizing and identity only and is overwritten
   * on resubmission, so it cannot answer "what did the FIRST submission say".
   */
  proposalVersionId?: string | null
}

/**
 * Ensure a decision request exists for the given recommendation.
 *
 * Lifecycle rules:
 *   1. If an ACTIVE request exists for this (trade, portfolio, requester) →
 *      update it in place with latest sizing/proposal link.
 *   2. If only RESOLVED requests exist (PM already acted) →
 *      create a NEW request. This preserves decision history.
 *   3. If no requests exist → create a new one.
 *
 * Resolved requests are NEVER mutated.
 */
export async function ensureDecisionRequestForProposal(
  input: EnsureDecisionRequestInput
): Promise<DecisionRequest> {
  // Look for an existing active request from this user for this trade+portfolio
  const { data: existing, error: lookupError } = await supabase
    .from('decision_requests')
    .select(DECISION_REQUEST_SELECT)
    .eq('trade_queue_item_id', input.tradeQueueItemId)
    .eq('portfolio_id', input.portfolioId)
    .eq('requested_by', input.requestedBy)
    .in('status', [...ACTIVE_DECISION_REQUEST_STATUSES])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (lookupError) {
    throw new Error(`Failed to check existing decision requests: ${lookupError.message}`)
  }

  if (existing) {
    // ── Update active request in place ────────────────────────────────
    // The analyst is editing their recommendation before the PM has acted.
    // This is safe — the request is still active/unresolved.
    // Snapshot is updated too since the recommendation content changed.
    const updates: Record<string, unknown> = {
      proposal_id: input.proposalId,
      sizing_weight: input.sizingWeight ?? null,
      sizing_shares: input.sizingShares ?? null,
      sizing_mode: input.sizingMode ?? null,
      context_note: input.contextNote ?? existing.context_note,
      urgency: input.urgency || existing.urgency,
      updated_at: new Date().toISOString(),
    }
    if (input.requestedAction !== undefined) updates.requested_action = input.requestedAction
    if (input.submissionSnapshot) updates.submission_snapshot = input.submissionSnapshot

    // Repoint an UNRESOLVED request at the version the analyst just
    // submitted. Safe precisely because no PM has acted: there is no decision
    // yet whose basis could be rewritten.
    //
    // The earlier version row is NOT touched — it is append-only and stays
    // readable. What moves is only which version this still-open request is
    // asking about, which is the honest answer to "what is the PM being asked
    // to decide right now".
    if (input.proposalVersionId) updates.proposal_version_id = input.proposalVersionId

    const { data, error } = await supabase
      .from('decision_requests')
      .update(updates)
      .eq('id', existing.id)
      .select(DECISION_REQUEST_SELECT)
      .single()

    if (error) throw new Error(`Failed to update active decision request: ${error.message}`)
    return data as unknown as DecisionRequest
  }

  // ── No active request — create a new one ─────────────────────────
  // This covers both first-time submission AND resubmission after resolution.
  // If prior resolved requests exist, they remain untouched (history preserved).
  // The partial unique index (idx_decision_requests_active_per_requester)
  // prevents duplicate active requests at the DB level as a safety net.
  const { data, error } = await supabase
    .from('decision_requests')
    .insert({
      trade_queue_item_id: input.tradeQueueItemId,
      portfolio_id: input.portfolioId,
      requested_by: input.requestedBy,
      proposal_id: input.proposalId,
      urgency: input.urgency || 'medium',
      context_note: input.contextNote || null,
      sizing_weight: input.sizingWeight ?? null,
      sizing_shares: input.sizingShares ?? null,
      sizing_mode: input.sizingMode ?? null,
      requested_action: input.requestedAction || null,
      submission_snapshot: input.submissionSnapshot || null,
      proposal_version_id: input.proposalVersionId || null,
    })
    .select(DECISION_REQUEST_SELECT)
    .single()

  if (error) throw new Error(`Failed to create decision request: ${error.message}`)
  return data as unknown as DecisionRequest
}
