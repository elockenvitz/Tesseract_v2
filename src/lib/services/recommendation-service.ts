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

import { supabase } from '../supabase'
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

  // ── Step 3: Create or update decision requests (AWAITED) ────────────
  // For singletons: one decision_request for the submitted trade_queue_item.
  // For pair trades: one decision_request per leg, all linked to the same
  // proposal row. Without per-leg DRs, the PM inbox shows one "representative"
  // leg and the other legs have no presence — users can't accept/reject
  // individual legs of a pair, and the per-leg progress counter is broken.
  //
  // Leg resolution: each sizing_context.leg may already carry a `legId`
  // (preferred — caller knows the trade_queue_item_id for each leg). If not,
  // we resolve legId by looking up trade_queue_items by (pair_id, asset_id,
  // portfolio_id) using the submitted tradeQueueItemId's pair_id as the anchor.
  let decisionRequest: DecisionRequest
  try {
    const sizingCtx = (input.sizingContext || {}) as Record<string, any>
    const isPairTrade = sizingCtx.isPairTrade === true && Array.isArray(sizingCtx.legs) && sizingCtx.legs.length > 0

    if (isPairTrade) {
      // Resolve the submitted trade_queue_item's pair_id so we can look up
      // siblings by asset_id if leg.legId wasn't provided by the caller.
      let pairAnchorId: string | null = null
      {
        const { data } = await supabase
          .from('trade_queue_items')
          .select('pair_id, pair_trade_id')
          .eq('id', input.tradeQueueItemId)
          .maybeSingle()
        pairAnchorId = (data as any)?.pair_id || (data as any)?.pair_trade_id || null
      }

      // Build the final leg list with resolved legIds. Always include the
      // submitted tradeQueueItemId as one of the legs so at least one DR
      // matches the proposal's representative leg.
      const rawLegs = sizingCtx.legs as Array<{
        legId?: string
        assetId?: string
        symbol?: string
        action?: string
        weight?: number | null
        shares?: number | null
        sizingMode?: string
      }>

      const resolvedLegs: Array<{
        legId: string
        action?: string
        weight?: number | null
        shares?: number | null
        sizingMode?: string
      }> = []

      for (const leg of rawLegs) {
        let legId: string | undefined = leg.legId
        if (!legId && leg.assetId && pairAnchorId) {
          const { data: match } = await supabase
            .from('trade_queue_items')
            .select('id')
            .eq('asset_id', leg.assetId)
            .eq('portfolio_id', input.portfolioId)
            .or(`pair_id.eq.${pairAnchorId},pair_trade_id.eq.${pairAnchorId}`)
            .eq('visibility_tier', 'active')
            .limit(1)
            .maybeSingle()
          legId = (match as any)?.id
        }
        if (legId) {
          resolvedLegs.push({
            legId,
            action: leg.action,
            weight: typeof leg.weight === 'number' ? leg.weight : null,
            shares: typeof leg.shares === 'number' ? leg.shares : null,
            sizingMode: leg.sizingMode,
          })
        }
      }

      // Ensure the submitted item itself is present (defensive — covers
      // callers that pass only partner legs in sizing_context.legs).
      if (!resolvedLegs.some(l => l.legId === input.tradeQueueItemId)) {
        resolvedLegs.unshift({
          legId: input.tradeQueueItemId,
          action: input.requestedAction,
          weight: input.weight ?? null,
          shares: input.shares ?? null,
          sizingMode: typeof input.sizingMode === 'string' ? input.sizingMode : undefined,
        })
      }

      if (resolvedLegs.length === 0) {
        throw new Error('Pair recommendation has no resolvable legs to create decision requests for')
      }

      // Create/update DRs for every leg in parallel. All share the same
      // proposal_id and submission_snapshot so the PM inbox can group them.
      const drs = await Promise.all(
        resolvedLegs.map(leg =>
          ensureDecisionRequestForProposal({
            tradeQueueItemId: leg.legId,
            portfolioId: input.portfolioId,
            proposalId: proposal.id,
            requestedBy: context.actorId,
            urgency: input.urgency,
            contextNote: input.notes,
            sizingWeight: leg.weight ?? null,
            sizingShares: leg.shares ?? null,
            sizingMode: (leg.sizingMode || input.sizingMode) as TradeSizingMode | undefined,
            requestedAction: (leg.action || input.requestedAction) as any,
            submissionSnapshot,
          }),
        ),
      )

      // Return the DR for the submitted leg as the representative; fall back
      // to the first DR if for some reason the submitted leg isn't in the set.
      decisionRequest =
        drs.find(d => d.trade_queue_item_id === input.tradeQueueItemId) || drs[0]
    } else {
      // Singleton path — unchanged
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
    }
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

  // ── Step 4: Notify PMs of the target portfolio (best-effort) ─────────
  // Push signal so the PM doesn't have to manually check the inbox to know
  // a new recommendation arrived. Notifies anyone with a PM role on the
  // portfolio. The notifier is the analyst who just submitted.
  notifyPortfolioPMsOfRecommendation({
    proposalId: proposal.id,
    tradeQueueItemId: input.tradeQueueItemId,
    portfolioId: input.portfolioId,
    actorId: context.actorId,
    actorName: context.actorName,
    assetSymbol: input.assetSymbol || null,
    portfolioName: input.portfolioName || null,
    isPairTrade: !!(input.sizingContext as any)?.isPairTrade,
  }).catch(e => console.warn('[submitRecommendation] PM notification failed:', e))

  return { proposal, decisionRequest }
}

/**
 * Best-effort: notify all PMs on a portfolio that a new recommendation
 * has been submitted. Errors are logged and swallowed — notification
 * delivery should never block the recommendation flow.
 */
async function notifyPortfolioPMsOfRecommendation(params: {
  proposalId: string
  tradeQueueItemId: string
  portfolioId: string
  actorId: string
  actorName?: string | null
  assetSymbol: string | null
  portfolioName: string | null
  isPairTrade: boolean
}): Promise<void> {
  // Find PMs on the portfolio (excluding the analyst themselves).
  const { data: members, error: membersErr } = await supabase
    .from('portfolio_team')
    .select('user_id, role')
    .eq('portfolio_id', params.portfolioId)
  if (membersErr || !members) return

  const pmRoleHints = ['portfolio manager', 'pm', 'manager']
  const recipients = members
    .filter(m => {
      const role = (m as any).role?.toLowerCase() || ''
      return pmRoleHints.some(hint => role.includes(hint)) && (m as any).user_id !== params.actorId
    })
    .map(m => (m as any).user_id as string)

  if (recipients.length === 0) return

  const symbolPart = params.assetSymbol ? ` on ${params.assetSymbol}` : ''
  const portfolioPart = params.portfolioName ? ` for ${params.portfolioName}` : ''
  const actorPart = params.actorName || 'An analyst'
  const kindPart = params.isPairTrade ? 'a pair recommendation' : 'a recommendation'

  const notifications = recipients.map(userId => ({
    user_id: userId,
    type: 'recommendation_submitted' as const,
    title: `New recommendation${symbolPart}`,
    message: `${actorPart} submitted ${kindPart}${portfolioPart}.`,
    context_type: 'trade_idea' as const,
    context_id: params.tradeQueueItemId,
    context_data: {
      proposal_id: params.proposalId,
      portfolio_id: params.portfolioId,
      is_pair_trade: params.isPairTrade,
    },
  }))

  await supabase.from('notifications').insert(notifications)
}

// Re-export status helpers for convenience
export { isActiveDecisionRequestStatus, isResolvedDecisionRequestStatus } from './decision-request-service'
