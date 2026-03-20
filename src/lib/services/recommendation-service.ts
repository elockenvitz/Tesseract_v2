/**
 * Recommendation Service — Canonical orchestrator for the Submit Recommendation workflow.
 *
 * This is the SINGLE entry point for submitting or updating a recommendation.
 * It coordinates the full workflow as one logical action:
 *
 *   1. Persist recommendation content (trade_proposals — legacy, to be retired)
 *   2. Create or update the PM-facing decision request (canonical workflow object)
 *   3. Auto-advance trade stage if applicable
 *
 * All steps are AWAITED. No fire-and-forget. Failures propagate to the caller.
 *
 * Lifecycle rules:
 *   - Active request exists → update in place (edit before PM acts)
 *   - Only resolved requests exist → create new request (resubmission preserves history)
 *   - No requests exist → create new request (first submission)
 *   - Resolved requests are NEVER mutated
 */

import { upsertProposal } from './trade-lab-service'
import {
  ensureDecisionRequestForProposal,
  isActiveDecisionRequestStatus,
  isResolvedDecisionRequestStatus,
} from './decision-request-service'
import { moveTradeIdea } from './trade-idea-service'
import type {
  ActionContext,
  TradeProposal,
  DecisionRequest,
  DecisionRequestUrgency,
  TradeSizingMode,
  ProposalType,
  TradeStage,
} from '../../types/trading'

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

export interface SubmitRecommendationInput {
  tradeQueueItemId: string
  portfolioId: string
  /** Resolved target weight (if weight-based sizing) */
  weight?: number | null
  /** Resolved target shares (if share-based sizing) */
  shares?: number | null
  sizingMode?: TradeSizingMode | string | null
  /** Opaque sizing metadata (v3 framework, baseline, input value, etc.) */
  sizingContext?: Record<string, unknown>
  notes?: string | null
  urgency?: DecisionRequestUrgency
  labId?: string | null
  proposalType?: ProposalType
  /** Pass known existing proposal ID to skip the lookup query */
  knownExistingProposalId?: string | null
  /** Trade action (buy/sell/add/trim) for the decision request snapshot */
  requestedAction?: string | null
  /** Asset symbol for the decision request snapshot */
  assetSymbol?: string | null
  /** Asset company name for the decision request snapshot */
  assetCompanyName?: string | null
  /** Portfolio name for the decision request snapshot */
  portfolioName?: string | null
}

export interface SubmitRecommendationResult {
  /** The persisted recommendation payload (trade_proposals row) */
  proposal: TradeProposal
  /** The PM-facing workflow object (decision_requests row) */
  decisionRequest: DecisionRequest
}

/**
 * Options that control post-submit side effects.
 */
export interface SubmitRecommendationOptions {
  /**
   * If provided, auto-advance the trade idea to 'deciding' stage when conditions
   * are met (e.g., user is owner/assignee and trade is in modeling stage).
   */
  autoAdvance?: {
    tradeStage: TradeStage | string
    createdBy: string
    assignedTo?: string | null
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Submit or update a recommendation.
 *
 * This is the canonical entry point that replaces direct `upsertProposal()` calls.
 * Both the proposal persist and decision request sync are awaited as one logical action.
 *
 * @throws If either the proposal persist or decision request sync fails.
 *         The error message distinguishes partial failure (proposal saved but
 *         decision request failed) from full failure.
 */
export async function submitRecommendation(
  input: SubmitRecommendationInput,
  context: ActionContext,
  options?: SubmitRecommendationOptions,
): Promise<SubmitRecommendationResult> {
  // ── Step 1: Persist recommendation content ──────────────────────────
  // trade_proposals remains the storage layer for now.
  // upsertProposal handles create-vs-update and trade event logging.
  const proposal = await upsertProposal(
    {
      trade_queue_item_id: input.tradeQueueItemId,
      portfolio_id: input.portfolioId,
      weight: input.weight ?? null,
      shares: input.shares ?? null,
      sizing_mode: input.sizingMode as TradeSizingMode | undefined,
      sizing_context: input.sizingContext || {},
      notes: input.notes ?? null,
      lab_id: input.labId,
      proposal_type: input.proposalType,
    },
    context,
    input.knownExistingProposalId,
  )

  // ── Step 2: Build submission snapshot ─────────────────────────────
  // Captures the recommendation state at this moment so resolved decision
  // requests remain a trustworthy historical record.
  const submissionSnapshot: Record<string, unknown> = {
    action: input.requestedAction || null,
    symbol: input.assetSymbol || null,
    company_name: input.assetCompanyName || null,
    portfolio_name: input.portfolioName || null,
    weight: input.weight ?? null,
    shares: input.shares ?? null,
    sizing_mode: input.sizingMode || null,
    notes: input.notes || null,
    proposal_type: input.proposalType || 'analyst',
    requester_name: context.actorName || null,
    requester_email: context.actorEmail || null,
    submitted_at: new Date().toISOString(),
  }
  if (input.sizingContext) {
    submissionSnapshot.sizing_context = input.sizingContext
  }

  // ── Step 3: Create or update decision request (AWAITED) ─────────────
  // This is NOT fire-and-forget. If this fails, the caller gets a clear error.
  let decisionRequest: DecisionRequest
  try {
    decisionRequest = await ensureDecisionRequestForProposal({
      tradeQueueItemId: input.tradeQueueItemId,
      portfolioId: input.portfolioId,
      proposalId: proposal.id,
      requestedBy: context.actorId,
      urgency: input.urgency,
      contextNote: input.notes,
      sizingWeight: input.weight,
      sizingShares: input.shares,
      sizingMode: input.sizingMode,
      requestedAction: input.requestedAction,
      submissionSnapshot,
    })
  } catch (err) {
    // Proposal succeeded but decision request failed — partial failure.
    // Surface this clearly so the user can retry.
    const msg = err instanceof Error ? err.message : 'Unknown error'
    throw new Error(
      `Recommendation saved but failed to sync decision request: ${msg}. ` +
      `The recommendation may not appear in the PM inbox until you resubmit.`,
    )
  }

  // ── Step 3: Auto-advance trade stage (best-effort) ──────────────────
  // Stage advancement is a convenience side-effect, not a workflow integrity
  // concern. It remains fire-and-forget because failing to advance the stage
  // does not invalidate the recommendation or decision request.
  if (options?.autoAdvance) {
    const { tradeStage, createdBy, assignedTo } = options.autoAdvance
    const isOwnerOrAssignee = context.actorId === createdBy || context.actorId === assignedTo
    const isInModelingStage = tradeStage === 'modeling' || tradeStage === 'simulating'

    if (isInModelingStage && isOwnerOrAssignee) {
      moveTradeIdea({
        tradeId: input.tradeQueueItemId,
        target: { stage: 'deciding' },
        context: { ...context, requestId: crypto.randomUUID() },
        note: 'Auto-advanced to deciding after recommendation submitted',
      }).catch(e => console.warn('[submitRecommendation] Auto-advance failed:', e))
    }
  }

  return { proposal, decisionRequest }
}

// Re-export status helpers for convenience
export { isActiveDecisionRequestStatus, isResolvedDecisionRequestStatus } from './decision-request-service'
