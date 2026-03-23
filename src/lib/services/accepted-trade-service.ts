/**
 * Accepted Trade Service
 *
 * CRUD and orchestration for accepted_trades — the Trade Book.
 * Follows the pattern of intent-variant-service.ts.
 *
 * INVARIANT: All committed trades must exist in accepted_trades.
 * This is the SOLE canonical commit system. Trade ideas should only
 * reach outcome='accepted' when an accepted_trade is created here.
 * Trade Sheets do NOT create decision state — they are snapshot artifacts only.
 * Trade Plans are REMOVED — use trade_batches for grouped commits.
 */

import { supabase } from '../supabase'
import { updateDecisionRequest } from './decision-request-service'
import { deleteVariant } from './intent-variant-service'
import { moveTradeIdea } from './trade-idea-service'
import type {
  AcceptedTrade,
  AcceptedTradeWithJoins,
  AcceptedTradeComment,
  AcceptedTradeSource,
  ExecutionStatus,
  TradeAction,
  ActionContext,
  DecisionRequest,
  IntentVariant,
} from '../../types/trading'

// ---------------------------------------------------------------------------
// Joins
// ---------------------------------------------------------------------------

// NOTE: accepted_by and executed_by FK to auth.users, not public.users.
// PostgREST cannot resolve cross-schema FK joins, so user joins are omitted.
// Use a separate query to resolve user display names if needed.
const TRADE_SELECT = `
  *,
  asset:assets(id, symbol, company_name, sector)
`

const COMMENT_SELECT = `
  *,
  user:users!accepted_trade_comments_user_id_fkey(id, email, first_name, last_name)
`

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function getAcceptedTradesForPortfolio(
  portfolioId: string
): Promise<AcceptedTradeWithJoins[]> {
  const { data, error } = await supabase
    .from('accepted_trades')
    .select(TRADE_SELECT)
    .eq('portfolio_id', portfolioId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data as unknown as AcceptedTradeWithJoins[]) || []
}

export interface CreateAcceptedTradeInput {
  portfolio_id: string
  asset_id: string
  action: TradeAction
  sizing_input?: string | null
  sizing_spec?: any
  target_weight?: number | null
  target_shares?: number | null
  delta_weight?: number | null
  delta_shares?: number | null
  notional_value?: number | null
  price_at_acceptance?: number | null
  source: AcceptedTradeSource
  decision_request_id?: string | null
  lab_variant_id?: string | null
  trade_queue_item_id?: string | null
  proposal_id?: string | null
  accepted_by: string
  acceptance_note?: string | null
  batch_id?: string | null
}

export async function createAcceptedTrade(
  input: CreateAcceptedTradeInput
): Promise<AcceptedTradeWithJoins> {
  const { data, error } = await supabase
    .from('accepted_trades')
    .insert({
      portfolio_id: input.portfolio_id,
      asset_id: input.asset_id,
      action: input.action,
      sizing_input: input.sizing_input ?? null,
      sizing_spec: input.sizing_spec ?? null,
      target_weight: input.target_weight ?? null,
      target_shares: input.target_shares ?? null,
      delta_weight: input.delta_weight ?? null,
      delta_shares: input.delta_shares ?? null,
      notional_value: input.notional_value ?? null,
      price_at_acceptance: input.price_at_acceptance ?? null,
      source: input.source,
      decision_request_id: input.decision_request_id ?? null,
      lab_variant_id: input.lab_variant_id ?? null,
      trade_queue_item_id: input.trade_queue_item_id ?? null,
      proposal_id: input.proposal_id ?? null,
      accepted_by: input.accepted_by,
      acceptance_note: input.acceptance_note ?? null,
      batch_id: input.batch_id ?? null,
    })
    .select(TRADE_SELECT)
    .single()

  if (error) throw error
  return data as unknown as AcceptedTradeWithJoins
}

export async function updateAcceptedTradeSizing(
  id: string,
  updates: {
    sizing_input?: string
    action?: TradeAction
    target_weight?: number | null
    target_shares?: number | null
    delta_weight?: number | null
    delta_shares?: number | null
    notional_value?: number | null
  },
  context: ActionContext
): Promise<AcceptedTradeWithJoins> {
  // Fetch old values for auto-comment
  const { data: old } = await supabase
    .from('accepted_trades')
    .select('sizing_input, action')
    .eq('id', id)
    .single()

  const { data, error } = await supabase
    .from('accepted_trades')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select(TRADE_SELECT)
    .single()

  if (error) throw error

  // Auto-comment on sizing change
  if (old && (old.sizing_input !== updates.sizing_input || old.action !== updates.action)) {
    await addComment(id, context.actorId, {
      content: `Sizing changed: ${old.sizing_input || '—'} → ${updates.sizing_input || '—'}`,
      comment_type: 'sizing_change',
      metadata: { old_sizing: old.sizing_input, new_sizing: updates.sizing_input, actor: context.actorName },
    })
  }

  return data as unknown as AcceptedTradeWithJoins
}

export async function revertAcceptedTrade(
  id: string,
  reason: string,
  context: ActionContext
): Promise<void> {
  // Fetch the trade to check source
  const { data: trade, error: fetchError } = await supabase
    .from('accepted_trades')
    .select('id, source, decision_request_id')
    .eq('id', id)
    .single()

  if (fetchError || !trade) throw fetchError || new Error('Trade not found')

  // Soft-delete
  const { error } = await supabase
    .from('accepted_trades')
    .update({
      is_active: false,
      reverted_at: new Date().toISOString(),
      reverted_by: context.actorId,
      revert_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) throw error

  // If source=inbox, revert decision request back to pending + clear linkage
  if (trade.source === 'inbox' && trade.decision_request_id) {
    await updateDecisionRequest(trade.decision_request_id, {
      status: 'pending',
      decisionNote: null,
      acceptedTradeId: null,
    })
  }
}

// ---------------------------------------------------------------------------
// Orchestrators
// ---------------------------------------------------------------------------

export interface AcceptFromInboxToTradeBookParams {
  decisionRequest: DecisionRequest
  sizingInput: string
  decisionNote?: string
  context: ActionContext
}

export async function acceptFromInboxToAcceptedTrade(
  params: AcceptFromInboxToTradeBookParams
): Promise<AcceptedTradeWithJoins> {
  const { decisionRequest, sizingInput, decisionNote, context } = params

  const assetId = decisionRequest.trade_queue_item?.assets?.id
  if (!assetId) throw new Error('Decision request has no linked asset')

  const rawAction = (decisionRequest.requested_action || decisionRequest.trade_queue_item?.action || 'buy') as TradeAction

  // Determine if PM modified the analyst's sizing
  const analystSizing = decisionRequest.sizing_weight != null
    ? String(decisionRequest.sizing_weight)
    : null
  const isModified = analystSizing != null && sizingInput !== analystSizing

  // Create accepted trade
  const trade = await createAcceptedTrade({
    portfolio_id: decisionRequest.portfolio_id,
    asset_id: assetId,
    action: rawAction,
    sizing_input: sizingInput,
    source: 'inbox',
    decision_request_id: decisionRequest.id,
    trade_queue_item_id: decisionRequest.trade_queue_item_id,
    proposal_id: decisionRequest.proposal_id ?? null,
    accepted_by: context.actorId,
    acceptance_note: decisionNote || null,
  })

  // Update decision request status + link to the accepted trade
  const status = isModified ? 'accepted_with_modification' : 'accepted'
  await updateDecisionRequest(decisionRequest.id, {
    status,
    decisionNote: decisionNote || null,
    acceptedTradeId: trade.id,
  })

  // Deactivate ALL active proposals for this trade idea + portfolio.
  // Once the PM accepts a recommendation, all pending proposals for the same
  // asset/idea are fulfilled — they should not remain in Trade Lab's Recommendations.
  await supabase
    .from('trade_proposals')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('trade_queue_item_id', decisionRequest.trade_queue_item_id)
    .eq('portfolio_id', decisionRequest.portfolio_id)
    .eq('is_active', true)

  // Conclude trade idea lifecycle
  if (decisionRequest.trade_queue_item_id) {
    try {
      await moveTradeIdea({
        tradeId: decisionRequest.trade_queue_item_id,
        target: { stage: 'deciding', outcome: 'executed' },
        context,
        note: 'Trade accepted via Decision Inbox → Trade Book',
      })
    } catch (e) {
      console.warn('[AcceptedTrade] Failed to advance trade idea:', e)
    }
  }

  return trade
}

export interface BulkPromoteParams {
  variantIds: string[]
  portfolioId: string
  context: ActionContext
}

export async function bulkPromoteFromSimulation(
  params: BulkPromoteParams
): Promise<AcceptedTradeWithJoins[]> {
  const { variantIds, portfolioId, context } = params

  // Fetch variants with computed values
  const { data: variants, error: fetchError } = await supabase
    .from('lab_variants')
    .select('*, asset:assets(id, symbol, company_name, sector)')
    .in('id', variantIds)

  if (fetchError || !variants) throw fetchError || new Error('Failed to fetch variants')

  const results: AcceptedTradeWithJoins[] = []

  for (const variant of variants) {
    const computed = variant.computed as any
    const trade = await createAcceptedTrade({
      portfolio_id: portfolioId,
      asset_id: variant.asset_id,
      action: variant.action,
      sizing_input: variant.sizing_input,
      sizing_spec: variant.sizing_spec,
      target_weight: computed?.target_weight ?? null,
      target_shares: computed?.target_shares ?? null,
      delta_weight: computed?.delta_weight ?? null,
      delta_shares: computed?.delta_shares ?? null,
      notional_value: computed?.notional_value ?? null,
      price_at_acceptance: computed?.price_used ?? null,
      source: 'simulation',
      lab_variant_id: variant.id,
      trade_queue_item_id: variant.trade_queue_item_id,
      proposal_id: variant.proposal_id,
      accepted_by: context.actorId,
    })
    results.push(trade)

    // Conclude trade idea if linked
    if (variant.trade_queue_item_id) {
      try {
        await moveTradeIdea({
          tradeId: variant.trade_queue_item_id,
          target: { stage: 'deciding', outcome: 'executed' },
          context,
          note: 'Trade promoted from simulation → Trade Book',
        })
      } catch (e) {
        console.warn(`[AcceptedTrade] Failed to advance idea ${variant.trade_queue_item_id}:`, e)
      }
    }
  }

  // Delete promoted variants and their simulation_trades from simulation.
  // This removes them from the Trade Lab view so the simulation reverts
  // to baseline for those assets. Committed trades live in Trade Book.
  const promotedAssetIds = variants.map(v => v.asset_id)
  for (const variantId of variantIds) {
    try {
      await deleteVariant(variantId, context)
    } catch (e) {
      console.warn(`[AcceptedTrade] Failed to delete variant ${variantId}:`, e)
    }
  }

  // Clean up simulation_trades for promoted assets
  if (promotedAssetIds.length > 0) {
    // Find the simulation_id from the lab's simulation
    const { data: simData } = await supabase
      .from('simulations')
      .select('id')
      .eq('trade_lab_id', variants[0]?.lab_id)
      .eq('is_active', true)
      .limit(1)
      .single()

    if (simData?.id) {
      await supabase
        .from('simulation_trades')
        .delete()
        .eq('simulation_id', simData.id)
        .in('asset_id', promotedAssetIds)
    }
  }

  return results
}

export async function createAdHocAcceptedTrade(params: {
  portfolioId: string
  assetId: string
  action: TradeAction
  sizingInput?: string
  note?: string
  context: ActionContext
}): Promise<AcceptedTradeWithJoins> {
  return createAcceptedTrade({
    portfolio_id: params.portfolioId,
    asset_id: params.assetId,
    action: params.action,
    sizing_input: params.sizingInput || null,
    source: 'adhoc',
    accepted_by: params.context.actorId,
    acceptance_note: params.note || null,
  })
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export async function updateExecutionStatus(
  id: string,
  status: ExecutionStatus,
  note: string | null,
  context: ActionContext
): Promise<AcceptedTradeWithJoins> {
  const now = new Date().toISOString()
  const updates: Record<string, unknown> = {
    execution_status: status,
    execution_note: note,
    updated_at: now,
  }

  if (status === 'in_progress') {
    updates.execution_started_at = now
    updates.executed_by = context.actorId
  } else if (status === 'complete') {
    updates.execution_completed_at = now
    updates.executed_by = context.actorId
  }

  const { data, error } = await supabase
    .from('accepted_trades')
    .update(updates)
    .eq('id', id)
    .select(TRADE_SELECT)
    .single()

  if (error) throw error

  // Auto-comment
  await addComment(id, context.actorId, {
    content: `Execution status → ${status}${note ? `: ${note}` : ''}`,
    comment_type: 'execution_update',
    metadata: { status, actor: context.actorName },
  })

  return data as unknown as AcceptedTradeWithJoins
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export async function addComment(
  tradeId: string,
  userId: string,
  input: {
    content: string
    comment_type?: string
    metadata?: Record<string, unknown>
  }
): Promise<AcceptedTradeComment> {
  const { data, error } = await supabase
    .from('accepted_trade_comments')
    .insert({
      accepted_trade_id: tradeId,
      user_id: userId,
      content: input.content,
      comment_type: input.comment_type || 'note',
      metadata: input.metadata || {},
    })
    .select(COMMENT_SELECT)
    .single()

  if (error) throw error
  return data as unknown as AcceptedTradeComment
}

export async function getComments(tradeId: string): Promise<AcceptedTradeComment[]> {
  const { data, error } = await supabase
    .from('accepted_trade_comments')
    .select(COMMENT_SELECT)
    .eq('accepted_trade_id', tradeId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data as unknown as AcceptedTradeComment[]) || []
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export async function findAcceptedTradeForDecisionRequest(
  decisionRequestId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('accepted_trades')
    .select('id')
    .eq('decision_request_id', decisionRequestId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (error) return null
  return data?.id ?? null
}

// ---------------------------------------------------------------------------
// Trade Batches — pure grouping/context objects.
// Trade Book is post-decision. Batches group trades that were committed together.
// They do not gate execution or imply review/approval workflow.
// ---------------------------------------------------------------------------

import type { TradeBatch } from '../../types/trading'

export async function createTradeBatch(params: {
  portfolioId: string
  name?: string
  description?: string
  sourceType: 'inbox' | 'simulation' | 'adhoc' | 'mixed'
  createdBy: string
}): Promise<TradeBatch> {
  const { data, error } = await supabase
    .from('trade_batches')
    .insert({
      portfolio_id: params.portfolioId,
      name: params.name || null,
      description: params.description || null,
      source_type: params.sourceType,
      created_by: params.createdBy,
    })
    .select()
    .single()

  if (error) throw error
  return data as TradeBatch
}

export async function getTradeBatchesForPortfolio(
  portfolioId: string
): Promise<TradeBatch[]> {
  const { data, error } = await supabase
    .from('trade_batches')
    .select()
    .eq('portfolio_id', portfolioId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data as TradeBatch[]) || []
}

/**
 * Bulk promote from simulation into a named batch.
 * Creates a trade_batch, then creates accepted_trades linked to it.
 */
export async function bulkPromoteWithBatch(params: {
  variantIds: string[]
  portfolioId: string
  batchName?: string
  context: ActionContext
}): Promise<{ batch: TradeBatch; trades: AcceptedTradeWithJoins[] }> {
  // Create the batch first
  const batch = await createTradeBatch({
    portfolioId: params.portfolioId,
    name: params.batchName || `Promoted ${new Date().toLocaleDateString()}`,
    sourceType: 'simulation',
    createdBy: params.context.actorId,
  })

  // Fetch variants
  const { data: variants, error: fetchError } = await supabase
    .from('lab_variants')
    .select('*, asset:assets(id, symbol, company_name, sector)')
    .in('id', params.variantIds)

  if (fetchError || !variants) throw fetchError || new Error('Failed to fetch variants')

  const results: AcceptedTradeWithJoins[] = []
  for (const variant of variants) {
    const computed = variant.computed as any
    const trade = await createAcceptedTrade({
      portfolio_id: params.portfolioId,
      asset_id: variant.asset_id,
      action: variant.action,
      sizing_input: variant.sizing_input,
      sizing_spec: variant.sizing_spec,
      target_weight: computed?.target_weight ?? null,
      target_shares: computed?.target_shares ?? null,
      delta_weight: computed?.delta_weight ?? null,
      delta_shares: computed?.delta_shares ?? null,
      notional_value: computed?.notional_value ?? null,
      price_at_acceptance: computed?.price_used ?? null,
      source: 'simulation',
      lab_variant_id: variant.id,
      trade_queue_item_id: variant.trade_queue_item_id,
      proposal_id: variant.proposal_id,
      accepted_by: params.context.actorId,
      batch_id: batch.id,
    })
    results.push(trade)

    // Conclude linked trade idea — outcome only advances via accepted_trade creation
    if (variant.trade_queue_item_id) {
      try {
        await moveTradeIdea({
          tradeId: variant.trade_queue_item_id,
          target: { stage: 'deciding', outcome: 'accepted' },
          context: params.context,
          note: 'Trade promoted from simulation → Trade Book',
        })
      } catch (e) {
        console.warn(`[AcceptedTrade] Failed to advance idea ${variant.trade_queue_item_id}:`, e)
      }
    }
  }

  // Delete promoted variants from simulation
  for (const variantId of params.variantIds) {
    try {
      await deleteVariant(variantId, params.context)
    } catch (e) {
      console.warn(`[AcceptedTrade] Failed to delete variant ${variantId}:`, e)
    }
  }

  return { batch, trades: results }
}
