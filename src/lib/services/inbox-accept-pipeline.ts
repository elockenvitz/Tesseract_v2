/**
 * Inbox Accept Pipeline
 *
 * Orchestrates the flow when a PM accepts a recommendation from the Decision Inbox:
 *   1. Creates an accepted_trade on the Trade Book
 *   2. Updates the decision_request status to accepted
 *   3. Concludes the trade idea lifecycle
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

  return { acceptedTrade, isModified }
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
