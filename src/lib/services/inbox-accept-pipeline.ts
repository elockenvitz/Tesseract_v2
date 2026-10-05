/**
 * Inbox Accept Pipeline
 *
 * Orchestrates the flow when a PM acts on a recommendation from the Decision Inbox.
 *
 * Accept flow:
 *   1. Creates an accepted_trade on the Trade Book
 *   2. Updates the decision_request status to accepted
 *   3. Updates the per-portfolio track on trade_idea_portfolios
 *   4. Conditionally concludes the trade idea lifecycle (only when no other
 *      portfolios have unresolved tracks)
 *   5. Notifies the originating analyst
 *
 * Reject flow:
 *   1. Updates the decision_request status to rejected
 *   2. Deactivates the linked trade_proposal so the recommendation count
 *      drops to 0 and the analyst can resubmit a revised recommendation
 *   3. Updates the per-portfolio track decision_outcome
 *   4. Notifies the originating analyst
 *
 * Both flows leave the trade idea ALIVE on the kanban for any portfolios
 * that haven't yet been decided. This is the iterative model: a rejection
 * is "this proposal was rejected" not "this idea is dead".
 *
 * Also handles reverting an accept (undo):
 *   1. Reverts the accepted_trade (soft-delete + resets decision request)
 */

import { supabase } from '../supabase'
import {
  acceptFromInboxToAcceptedTrade,
  revertAcceptedTrade,
  findAcceptedTradeForDecisionRequest,
} from './accepted-trade-service'
import { updateDecisionRequest } from './decision-request-service'
import { resolveIdeaAfterDecision, type FanInResult } from '../decisions/decision-fan-in'
import type { DecisionRequest, TradeAction, ActionContext, AcceptedTradeWithJoins } from '../../types/trading'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AcceptFromInboxParams {
  /** The decision request being accepted */
  decisionRequest: DecisionRequest
  /** PM-provided sizing string in unified syntax (e.g. "2.5", "+0.5", "#500") */
  sizingInput: string
  /** Optional PM note */
  decisionNote?: string
  /** Action context (actor info) */
  context: ActionContext
}

export interface AcceptFromInboxResult {
  acceptedTrade: AcceptedTradeWithJoins
  isModified: boolean
  /**
   * Whether the idea actually became terminal.
   *
   * Carried out to the caller rather than left on the trade object, where it
   * was present at runtime but erased by this result type — so no UI could
   * see it even in principle. A `concluded` accept is the full contract; a
   * `failed` one means the trade is committed and correct while the idea is
   * stranded in the pipeline, and the PM has to be told that rather than
   * shown an unqualified success.
   */
  fanIn: FanInResult
}

export interface RevertAcceptParams {
  /** The decision request to revert */
  decisionRequestId: string
  /** Action context (actor info) */
  context: ActionContext
}

// ---------------------------------------------------------------------------
// Accept
// ---------------------------------------------------------------------------

export async function acceptFromInbox(params: AcceptFromInboxParams): Promise<AcceptFromInboxResult> {
  const { decisionRequest, sizingInput, decisionNote, context } = params

  const analystSizing = decisionRequest.sizing_weight != null
    ? String(decisionRequest.sizing_weight)
    : null
  const isModified = analystSizing != null && sizingInput !== analystSizing

  const acceptedTrade = await acceptFromInboxToAcceptedTrade({
    decisionRequest,
    sizingInput,
    decisionNote,
    context,
  })

  return { acceptedTrade, isModified, fanIn: acceptedTrade.fanIn }
}

// ---------------------------------------------------------------------------
// Reject
// ---------------------------------------------------------------------------

export interface RejectFromInboxParams {
  /** The decision request being rejected */
  decisionRequest: DecisionRequest
  /** PM-provided rejection reason */
  reason: string | null
  /** Action context (actor info) */
  context: ActionContext
}

/**
 * Reject a recommendation from the inbox.
 *
 * Marks the DR rejected, deactivates its linked trade_proposal (so the
 * "Needs recommendation" CTA returns and the analyst can revise), and
 * updates the per-portfolio decision track.
 *
 * The idea stays alive while ANY portfolio still owes a decision, and is
 * concluded as `rejected` once none does. Returns which of those happened.
 */
export async function rejectFromInbox(params: RejectFromInboxParams): Promise<FanInResult> {
  const { decisionRequest, reason, context } = params

  // 1. Update DR to rejected
  await updateDecisionRequest(decisionRequest.id, {
    status: 'rejected',
    decisionNote: reason,
  })

  // 2. Deactivate the linked proposal so recommendationCount drops to 0.
  // Iterative model: the analyst can submit a NEW recommendation. The old
  // (rejected) proposal stays in history via rejectedProposals queries.
  if (decisionRequest.proposal_id) {
    const { error: proposalErr } = await supabase
      .from('trade_proposals')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', decisionRequest.proposal_id)
    if (proposalErr) {
      console.warn('[RejectFromInbox] Failed to deactivate proposal', proposalErr)
    }
  }

  // 3. Update per-portfolio track to rejected. Other portfolios untouched.
  if (decisionRequest.trade_queue_item_id && decisionRequest.portfolio_id) {
    const { error: trackErr } = await supabase
      .from('trade_idea_portfolios')
      .update({
        decision_outcome: 'rejected',
        decision_reason: reason,
        decided_by: context.actorId,
        decided_at: new Date().toISOString(),
      })
      .eq('trade_queue_item_id', decisionRequest.trade_queue_item_id)
      .eq('portfolio_id', decisionRequest.portfolio_id)
    if (trackErr) {
      console.warn('[RejectFromInbox] Failed to update per-portfolio track', trackErr)
    }
  }

  // 4. Notify the originating analyst that their recommendation was
  // rejected. Best-effort — failure doesn't block the reject. Skip if the
  // PM is rejecting their own recommendation.
  if (decisionRequest.requested_by && decisionRequest.requested_by !== context.actorId) {
    try {
      const symbol = (decisionRequest.trade_queue_item as any)?.assets?.symbol || 'an idea'
      const portfolioName = (decisionRequest as any)?.portfolio?.name || ''
      const portfolioPart = portfolioName ? ` for ${portfolioName}` : ''
      const reasonPart = reason ? `: "${reason}"` : ''
      await supabase.from('notifications').insert({
        user_id: decisionRequest.requested_by,
        type: 'recommendation_decided',
        title: 'Recommendation rejected',
        message: `${context.actorName || 'A PM'} rejected your recommendation on ${symbol}${portfolioPart}${reasonPart}`,
        context_type: 'trade_idea',
        context_id: decisionRequest.trade_queue_item_id,
        context_data: {
          decision_request_id: decisionRequest.id,
          portfolio_id: decisionRequest.portfolio_id,
          outcome: 'rejected',
          reason,
        },
      })
    } catch (e) {
      console.warn('[RejectFromInbox] Failed to notify analyst', e)
    }
  }

  /*
   * Conclude the idea only when NO portfolio still owes a decision.
   *
   * Iterative reject is real and must survive: a rejection is feedback, and
   * while any track is open the analyst can revise sizing and resubmit, so
   * the idea stays live and the amber "Needs recommendation" CTA returns
   * because the proposal is now inactive.
   *
   * What was wrong is the other half. Once EVERY track is rejected there is
   * nothing left to revise for, yet this path wrote nothing to
   * `trade_queue_items` at all — so a fully-rejected idea stayed
   * indistinguishable from one nobody had looked at, sitting in the pipeline
   * presenting itself as still awaiting the same decision that was already
   * made. Accept and reject are now symmetric: same fan-in rule, same shared
   * implementation, same observable result.
   */
  const fanIn = await resolveIdeaAfterDecision({
    tradeQueueItemId: decisionRequest.trade_queue_item_id,
    outcome: 'rejected',
    context,
    note: 'All portfolios resolved — trade idea concluded after rejection',
  })

  if (fanIn.status === 'failed') {
    console.error('[RejectFromInbox] Idea not concluded after rejection:', fanIn.reason)
  }

  return fanIn
}

// ---------------------------------------------------------------------------
// Revert (Undo)
// ---------------------------------------------------------------------------

export async function revertAcceptFromInbox(params: RevertAcceptParams): Promise<void> {
  const { decisionRequestId, context } = params

  // Find the accepted trade linked to this decision request
  const tradeId = await findAcceptedTradeForDecisionRequest(decisionRequestId)
  if (!tradeId) {
    throw new Error('No accepted trade found for this decision request')
  }

  // Revert reverts the trade AND resets the decision request back to pending
  await revertAcceptedTrade(tradeId, 'Reverted from Decision Inbox', context)
}

// Re-export helper
export { findAcceptedTradeForDecisionRequest }
