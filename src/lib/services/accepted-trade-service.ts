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
//
// trade_queue_item join exposes pair_id/pair_trade_id/pair_leg_type so the
// Trade Book can render pair legs adjacent with a "↔ pair" badge. Without
// this join there's no path from an accepted_trade to its pair grouping.
const TRADE_SELECT = `
  *,
  asset:assets(id, symbol, company_name, sector),
  trade_queue_item:trade_queue_items!accepted_trades_trade_queue_item_id_fkey(id, pair_id, pair_trade_id, pair_leg_type, action)
`

// Select comment rows; user display info is fetched separately so the
// embed isn't coupled to the FK constraint name (which PostgREST can't
// always resolve when the FK targets auth.users instead of public.users).
const COMMENT_SELECT = `*`

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
  /** Post-reconciliation correction link. When set, this trade corrects
   *  the referenced accepted_trade. The original stays visible with a
   *  "corrected by →" link. */
  corrects_accepted_trade_id?: string | null
  /** Optional soft deadline for execution. Informational only. */
  execution_expected_by?: string | null
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
      corrects_accepted_trade_id: input.corrects_accepted_trade_id ?? null,
      execution_expected_by: input.execution_expected_by ?? null,
    })
    .select(TRADE_SELECT)
    .single()

  if (error) throw error
  const trade = data as unknown as AcceptedTradeWithJoins

  // Post-insert: apply holdings_source behavior.
  // - paper/manual_eod: apply to holdings, auto-complete execution.
  // - live_feed: leave execution_status='not_started' for trader workflow.
  const finalized = await finalizeTradeForHoldingsSource(trade, input.accepted_by)
  return finalized
}

/**
 * Post-create finalization based on portfolios.holdings_source.
 *
 * For paper/manual_eod portfolios this is where the trade becomes "real":
 * holdings get updated and execution_status flips to 'complete'. For
 * live_feed portfolios this is a no-op — fills arrive later from the feed.
 *
 * Safe to call once per created trade. On failure, logs a warning and
 * returns the original (not-yet-finalized) trade so the caller still sees
 * the inserted row — the PM can recover manually via the Trade Book UI.
 */
async function finalizeTradeForHoldingsSource(
  trade: AcceptedTradeWithJoins,
  actorId: string
): Promise<AcceptedTradeWithJoins> {
  try {
    const { data: portfolio, error } = await supabase
      .from('portfolios')
      .select('holdings_source')
      .eq('id', trade.portfolio_id)
      .single()

    if (error || !portfolio) {
      console.warn('[AcceptedTrade] Could not read holdings_source for portfolio', trade.portfolio_id, error)
      return trade
    }

    const source = (portfolio as any).holdings_source as 'live_feed' | 'manual_eod' | 'paper'
    if (source === 'live_feed') {
      // Hands off — external feed drives holdings + execution state.
      return trade
    }

    // paper / manual_eod: apply to holdings and auto-complete execution.
    // Also mark reconciliation_status='matched' since the holdings are now
    // in sync with the trade — there's nothing left to reconcile. This
    // matters for pro-forma-baseline queries which key off pending L1 rows.
    const applyResult = await applyTradeToHoldings(trade.portfolio_id, trade)

    // Emit a portfolio_trade_events row so the Decision Accountability
    // surface (which matches decisions against events) picks up the
    // execution. Without this, paper/manual_eod executes would show as
    // "awaiting execution" in Outcomes forever — there's no holdings
    // feed running the diff-based event generator, so the event must be
    // produced inline when the trade is applied.
    try {
      await emitPaperTradeEvent(trade, applyResult, actorId)
    } catch (e) {
      console.warn('[AcceptedTrade] Failed to emit paper trade event', e)
    }

    const now = new Date().toISOString()
    const { data: updated, error: updateError } = await supabase
      .from('accepted_trades')
      .update({
        execution_status: 'complete',
        execution_completed_at: now,
        executed_by: actorId,
        reconciliation_status: 'matched',
        reconciled_at: now,
        updated_at: now,
      })
      .eq('id', trade.id)
      .select(TRADE_SELECT)
      .single()

    if (updateError || !updated) {
      console.warn('[AcceptedTrade] Failed to auto-complete execution_status', updateError)
      return trade
    }
    return updated as unknown as AcceptedTradeWithJoins
  } catch (e) {
    console.warn('[AcceptedTrade] finalizeTradeForHoldingsSource failed:', e)
    return trade
  }
}

// ---------------------------------------------------------------------------
// Correction trades
// ---------------------------------------------------------------------------

export interface CreateCorrectionTradeInput {
  /** The accepted_trade being corrected. */
  originalTradeId: string
  /** PM initiating the correction. */
  acceptedBy: string
  /** Required: the correction's sizing. The PM must state the new intent —
   *  a correction with identical sizing to the original would be a no-op. */
  sizing_input: string
  /** Parsed sizing spec (the caller typically parses via parseSizingInput). */
  sizing_spec?: any
  target_weight?: number | null
  target_shares?: number | null
  delta_weight?: number | null
  delta_shares?: number | null
  notional_value?: number | null
  price_at_acceptance?: number | null
  /** Action override. Defaults to the original trade's action (most
   *  corrections are same-direction sizing tweaks). */
  action?: TradeAction
  /** Reason note — lands on both the new row's acceptance_note and as a
   *  comment on the original. */
  note: string
  /** Optional: group the correction into an existing batch. */
  batch_id?: string | null
}

/**
 * Create a correction trade that points back at the original via
 * `corrects_accepted_trade_id`. Copies portfolio / asset from the original
 * and takes new sizing from the caller.
 *
 * Note: the original row is NOT reverted or deactivated. The design is
 * "original stays visible with a corrected-by link" — both rows coexist.
 * Reverting would lose the audit trail of what was originally committed.
 *
 * Drops an auto-comment on the original pointing at the correction, so
 * anyone looking at the original sees "→ corrected by <new_id>: <note>".
 */
export async function createCorrectionTrade(
  input: CreateCorrectionTradeInput
): Promise<AcceptedTradeWithJoins> {
  // 1. Fetch the original (we need portfolio_id / asset_id / action / source).
  const { data: original, error: fErr } = await supabase
    .from('accepted_trades')
    .select('id, portfolio_id, asset_id, action, source, is_active')
    .eq('id', input.originalTradeId)
    .single()

  if (fErr || !original) {
    throw new Error(`Original accepted_trade ${input.originalTradeId} not found`)
  }
  if (!(original as any).is_active) {
    throw new Error('Cannot correct a reverted/inactive trade')
  }

  // 2. Build the correction via the standard create path so
  // holdings_source finalization runs for paper/manual_eod portfolios.
  const correction = await createAcceptedTrade({
    portfolio_id: (original as any).portfolio_id,
    asset_id: (original as any).asset_id,
    action: input.action ?? ((original as any).action as TradeAction),
    sizing_input: input.sizing_input,
    sizing_spec: input.sizing_spec ?? null,
    target_weight: input.target_weight ?? null,
    target_shares: input.target_shares ?? null,
    delta_weight: input.delta_weight ?? null,
    delta_shares: input.delta_shares ?? null,
    notional_value: input.notional_value ?? null,
    price_at_acceptance: input.price_at_acceptance ?? null,
    // Corrections keep the original's provenance bucket — they're
    // post-reconciliation touch-ups, not fresh inbox/simulation output.
    source: (original as any).source as AcceptedTradeSource,
    accepted_by: input.acceptedBy,
    acceptance_note: `Correction of ${input.originalTradeId}: ${input.note}`,
    batch_id: input.batch_id ?? null,
    corrects_accepted_trade_id: input.originalTradeId,
  })

  // 3. Audit comment on the original so it's obvious when reviewing.
  try {
    await addComment(input.originalTradeId, input.acceptedBy, {
      content: `Corrected by new trade: ${input.note}`,
      comment_type: 'correction',
      metadata: {
        correction_trade_id: correction.id,
        new_sizing: input.sizing_input,
      },
    })
  } catch (e) {
    // Non-fatal — the correction trade is already committed.
    console.warn('[AcceptedTrade] Failed to add correction audit comment', e)
  }

  return correction
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
  // Fetch the full trade row — we need sizing fields to reverse holdings
  // and asset_id/portfolio_id for the lookup.
  const { data: trade, error: fetchError } = await supabase
    .from('accepted_trades')
    .select('*, asset:assets(id, symbol, company_name, sector)')
    .eq('id', id)
    .single()

  if (fetchError || !trade) throw fetchError || new Error('Trade not found')

  // Reverse the holdings application BEFORE soft-deleting the trade. For
  // paper/manual_eod portfolios Phase 1 auto-applied this trade to holdings
  // on accept; reverting means undoing that apply so the portfolio state
  // matches pre-accept. For live_feed portfolios nothing was applied, so
  // the reverse is a no-op.
  try {
    const { data: portfolio } = await supabase
      .from('portfolios')
      .select('holdings_source')
      .eq('id', (trade as any).portfolio_id)
      .single()
    const source = (portfolio as any)?.holdings_source as 'live_feed' | 'manual_eod' | 'paper' | undefined
    if (source && source !== 'live_feed') {
      await reverseTradeOnHoldings((trade as any).portfolio_id, trade as unknown as AcceptedTradeWithJoins)
    }
  } catch (e) {
    console.warn('[AcceptedTrade] Failed to reverse holdings on revert', e)
    // Continue — a holdings-reverse failure must not block the revert
    // itself. The PM can reconcile manually if needed.
  }

  // Soft-delete the trade and clear its reconciliation status — the trade
  // no longer represents a decision so stale recon state would be misleading.
  const { error } = await supabase
    .from('accepted_trades')
    .update({
      is_active: false,
      reverted_at: new Date().toISOString(),
      reverted_by: context.actorId,
      revert_reason: reason,
      reconciliation_status: 'pending',
      reconciled_at: null,
      reconciliation_detail: null,
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

/**
 * Reverse a previously paper-applied trade from portfolio_holdings.
 *
 * Applied deltas are reversed by applying their negation. Trades that
 * specified only `target_shares` (absolute end state) cannot be cleanly
 * reversed without knowing the pre-trade baseline; in that case we log a
 * warning and leave holdings alone. Callers must guard on holdings_source.
 */
async function reverseTradeOnHoldings(
  portfolioId: string,
  trade: AcceptedTradeWithJoins,
): Promise<void> {
  const today = new Date().toISOString().split('T')[0]
  const assetId = trade.asset_id

  // Find today's holding row.
  const { data: existing } = await supabase
    .from('portfolio_holdings')
    .select('id, shares, price')
    .eq('portfolio_id', portfolioId)
    .eq('asset_id', assetId)
    .eq('date', today)
    .maybeSingle()

  if (!existing) {
    console.warn('[AcceptedTrade] Cannot reverse: no holding row for today', assetId)
    return
  }

  // Compute the reversal delta. Prefer delta_shares (we know exactly what
  // was added/removed). If only target_shares is set we don't know the
  // pre-trade baseline — log and skip.
  let reverseDelta: number | null = null
  if (trade.delta_shares != null) {
    reverseDelta = -Number(trade.delta_shares)
  } else {
    console.warn(
      '[AcceptedTrade] Cannot cleanly reverse trade with only target_shares and no delta',
      trade.id,
    )
    return
  }

  const newShares = Number(existing.shares) + reverseDelta
  if (newShares <= 0) {
    await supabase.from('portfolio_holdings').delete().eq('id', existing.id)
  } else {
    await supabase
      .from('portfolio_holdings')
      .update({ shares: newShares, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
  }

  // Also reverse on the latest snapshot positions if Phase 1 wrote there.
  try {
    const { data: latestSnapshot } = await supabase
      .from('portfolio_holdings_snapshots')
      .select('id')
      .eq('portfolio_id', portfolioId)
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!latestSnapshot) return

    const { data: pos } = await supabase
      .from('portfolio_holdings_positions')
      .select('shares')
      .eq('snapshot_id', latestSnapshot.id)
      .eq('asset_id', assetId)
      .maybeSingle()
    if (!pos) return

    const snapNewShares = Number(pos.shares) + reverseDelta
    if (snapNewShares <= 0) {
      await supabase
        .from('portfolio_holdings_positions')
        .delete()
        .eq('snapshot_id', latestSnapshot.id)
        .eq('asset_id', assetId)
    } else {
      await supabase
        .from('portfolio_holdings_positions')
        .update({ shares: snapNewShares })
        .eq('snapshot_id', latestSnapshot.id)
        .eq('asset_id', assetId)
    }
  } catch (e) {
    console.warn('[AcceptedTrade] Failed to reverse snapshot positions', e)
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

  // Per-portfolio resolution: mark THIS portfolio's track as accepted, but
  // leave other portfolios' tracks untouched. The trade idea card stays
  // visible on the kanban for any portfolio that still has an unresolved
  // track. Only when ALL portfolios with active tracks have a terminal
  // decision_outcome do we advance the global trade_queue_items status.
  if (decisionRequest.trade_queue_item_id) {
    try {
      const { error: trackErr } = await supabase
        .from('trade_idea_portfolios')
        .update({
          decision_outcome: isModified ? 'accepted_with_modification' as any : 'accepted',
          decided_by: context.actorId,
          decided_at: new Date().toISOString(),
        })
        .eq('trade_queue_item_id', decisionRequest.trade_queue_item_id)
        .eq('portfolio_id', decisionRequest.portfolio_id)
      if (trackErr) {
        console.warn('[AcceptedTrade] Failed to update per-portfolio track decision', trackErr)
      }
    } catch (e) {
      console.warn('[AcceptedTrade] Per-portfolio track update threw', e)
    }
  }

  // Notify the originating analyst that their recommendation was accepted.
  // Best-effort — failures don't block the accept.
  if (decisionRequest.requested_by && decisionRequest.requested_by !== context.actorId) {
    try {
      const symbol = (decisionRequest.trade_queue_item as any)?.assets?.symbol || 'an idea'
      const portfolioName = (decisionRequest as any)?.portfolio?.name || ''
      const portfolioPart = portfolioName ? ` for ${portfolioName}` : ''
      const noteSuffix = isModified ? ' (sizing modified)' : ''
      await supabase.from('notifications').insert({
        user_id: decisionRequest.requested_by,
        type: 'recommendation_decided',
        title: `Recommendation accepted${noteSuffix}`,
        message: `${context.actorName || 'A PM'} accepted your recommendation on ${symbol}${portfolioPart}.`,
        context_type: 'trade_idea',
        context_id: decisionRequest.trade_queue_item_id,
        context_data: {
          decision_request_id: decisionRequest.id,
          accepted_trade_id: trade.id,
          portfolio_id: decisionRequest.portfolio_id,
          outcome: isModified ? 'accepted_with_modification' : 'accepted',
        },
      })
    } catch (e) {
      console.warn('[AcceptedTrade] Failed to notify analyst on accept', e)
    }
  }

  // Conclude trade idea lifecycle ONLY when no other portfolios are still
  // pending a decision. For multi-portfolio ideas this prevents the first
  // PM's accept from prematurely dropping the card off the kanban for
  // other PMs whose decisions are still pending.
  //
  // Errors here are logged loudly. We do NOT throw — the accepted_trade
  // already exists and the per-portfolio track is updated; failing to
  // advance the global status is recoverable.
  if (decisionRequest.trade_queue_item_id) {
    try {
      // Are there any other portfolios with unresolved tracks for this idea?
      const { data: openTracks, error: tracksErr } = await supabase
        .from('trade_idea_portfolios')
        .select('portfolio_id, decision_outcome')
        .eq('trade_queue_item_id', decisionRequest.trade_queue_item_id)
      if (tracksErr) throw tracksErr

      const anyOpen = (openTracks || []).some(t => (t as any).decision_outcome == null)
      if (!anyOpen) {
        // All portfolios resolved → safe to advance the global trade idea
        await moveTradeIdea({
          tradeId: decisionRequest.trade_queue_item_id,
          target: { stage: 'deciding', outcome: 'executed' },
          context,
          note: 'All portfolios resolved — trade idea concluded after accept',
        })
      }
    } catch (e) {
      console.error(
        '[AcceptedTrade] Failed to advance trade idea after accept — '
        + 'the accepted_trade was created but the kanban card may not have '
        + 'moved. This usually means a stage validation failed. Trade ID: '
        + decisionRequest.trade_queue_item_id,
        e,
      )
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

  // Holdings application + execution_status finalization is handled inside
  // createAcceptedTrade → finalizeTradeForHoldingsSource, gated on the
  // portfolio's holdings_source. No explicit apply needed here.

  return results
}

/**
 * Apply a single committed trade to portfolio_holdings + the latest
 * snapshot positions (paper trading).
 *
 * Semantics:
 * - target_shares set → upsert holding with that absolute share count
 * - delta_shares set  → adjust existing holding by delta
 * - no share data     → no-op (return silently)
 * - final shares ≤ 0  → remove the holding (full exit)
 *
 * Called from createAcceptedTrade after the insert, gated on the
 * portfolio's holdings_source. Errors are caught by the caller
 * (finalizeTradeForHoldingsSource) so a failure here does not roll back
 * the accepted_trade row — the trade still exists in the Trade Book and
 * can be reconciled manually.
 */
interface ApplyTradeResult {
  sharesBefore: number
  sharesAfter: number
  priceUsed: number
  applied: boolean
}

async function applyTradeToHoldings(
  portfolioId: string,
  trade: AcceptedTradeWithJoins
): Promise<ApplyTradeResult> {
  const today = new Date().toISOString().split('T')[0]
  const price = trade.price_at_acceptance || 0
  const assetId = trade.asset_id

  // ── portfolio_holdings (daily view) ──
  const { data: existing } = await supabase
    .from('portfolio_holdings')
    .select('id, shares, price')
    .eq('portfolio_id', portfolioId)
    .eq('asset_id', assetId)
    .eq('date', today)
    .maybeSingle()

  const sharesBefore = Number(existing?.shares ?? 0)

  let newShares: number | null = null
  if (trade.target_shares != null) {
    newShares = trade.target_shares
  } else if (trade.delta_shares != null) {
    newShares = sharesBefore + trade.delta_shares
  }

  if (newShares == null) {
    // No share info on the trade — nothing to apply.
    return { sharesBefore, sharesAfter: sharesBefore, priceUsed: price, applied: false }
  }

  if (newShares <= 0) {
    if (existing) {
      await supabase.from('portfolio_holdings').delete().eq('id', existing.id)
    }
  } else if (existing) {
    await supabase
      .from('portfolio_holdings')
      .update({ shares: newShares, price, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
  } else {
    await supabase.from('portfolio_holdings').insert({
      portfolio_id: portfolioId,
      asset_id: assetId,
      shares: newShares,
      price,
      cost: price,
      date: today,
    })
  }

  const sharesAfter = Math.max(newShares, 0)

  // ── portfolio_holdings_snapshots (keep latest snapshot in sync) ──
  try {
    const { data: latestSnapshot } = await supabase
      .from('portfolio_holdings_snapshots')
      .select('id')
      .eq('portfolio_id', portfolioId)
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!latestSnapshot) {
      return { sharesBefore, sharesAfter, priceUsed: price, applied: true }
    }

    // For snapshot positions we have to recompute delta against the snapshot,
    // not the daily holding, because the two can diverge.
    let snapNewShares: number | null = null
    if (trade.target_shares != null) {
      snapNewShares = trade.target_shares
    } else if (trade.delta_shares != null) {
      const { data: pos } = await supabase
        .from('portfolio_holdings_positions')
        .select('shares')
        .eq('snapshot_id', latestSnapshot.id)
        .eq('asset_id', assetId)
        .maybeSingle()
      snapNewShares = (pos?.shares ?? 0) + trade.delta_shares
    }
    if (snapNewShares == null) {
      return { sharesBefore, sharesAfter, priceUsed: price, applied: true }
    }

    if (snapNewShares <= 0) {
      await supabase
        .from('portfolio_holdings_positions')
        .delete()
        .eq('snapshot_id', latestSnapshot.id)
        .eq('asset_id', assetId)
    } else {
      await supabase.from('portfolio_holdings_positions').upsert(
        {
          snapshot_id: latestSnapshot.id,
          portfolio_id: portfolioId,
          asset_id: assetId,
          symbol: (trade as any).asset?.symbol || '',
          shares: snapNewShares,
          price,
          market_value: snapNewShares * price,
        },
        { onConflict: 'snapshot_id,symbol' }
      )
    }
  } catch (e) {
    console.warn('[PaperTrade] Failed to update snapshot positions:', e)
  }

  return { sharesBefore, sharesAfter, priceUsed: price, applied: true }
}

/**
 * Emit a portfolio_trade_events row for a paper/manual_eod execute.
 *
 * The Decision Accountability surface matches decisions against events
 * in `portfolio_trade_events`. For live_feed portfolios the event is
 * generated by the holdings-diff job when fills land. For paper and
 * manual_eod portfolios there is no feed — so we have to write the
 * event ourselves when the trade is applied, otherwise every Trade Lab
 * execute sits as "awaiting" in Outcomes forever.
 *
 * Action mapping (accepted_trades.action → trade_event_action):
 *  - sell + full exit (newShares == 0) → exit
 *  - sell / trim                       → trim
 *  - buy + no prior position           → initiate
 *  - buy / add                         → add
 *
 * Linked back to the trade idea via `linked_trade_idea_id` so the
 * accountability hook's `eventsByLinkedIdea` lookup finds it as an
 * explicit match.
 */
async function emitPaperTradeEvent(
  trade: AcceptedTradeWithJoins,
  apply: ApplyTradeResult,
  actorId: string,
): Promise<void> {
  if (!apply.applied) return

  const { sharesBefore, sharesAfter, priceUsed } = apply
  const delta = sharesAfter - sharesBefore
  if (delta === 0) return

  let actionType: 'initiate' | 'add' | 'trim' | 'exit'
  const action = trade.action as TradeAction
  if (action === 'sell') {
    actionType = sharesAfter <= 0 ? 'exit' : 'trim'
  } else if (action === 'trim') {
    actionType = sharesAfter <= 0 ? 'exit' : 'trim'
  } else if (action === 'buy') {
    actionType = sharesBefore <= 0 ? 'initiate' : 'add'
  } else {
    // 'add'
    actionType = 'add'
  }

  const mvBefore = sharesBefore * priceUsed
  const mvAfter = sharesAfter * priceUsed

  const { error } = await supabase.from('portfolio_trade_events').insert({
    portfolio_id: trade.portfolio_id,
    asset_id: trade.asset_id,
    source_type: 'holdings_diff',
    action_type: actionType,
    event_date: new Date().toISOString().split('T')[0],
    quantity_before: sharesBefore,
    quantity_after: sharesAfter,
    quantity_delta: delta,
    market_value_before: mvBefore,
    market_value_after: mvAfter,
    detected_by_system: true,
    linked_trade_idea_id: trade.trade_queue_item_id ?? null,
    linked_decision_id: trade.decision_request_id ?? null,
    metadata: {
      origin: 'paper_execute',
      accepted_trade_id: trade.id,
      batch_id: (trade as any).batch_id ?? null,
    },
    // The rationale lives on accepted_trades.acceptance_note — no
    // separate trade_event_rationale capture is needed for paper
    // executes, so skip pending_rationale and go straight to complete.
    status: 'complete',
    created_by: actorId,
  })
  if (error) throw error
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
  const row = data as unknown as AcceptedTradeComment
  // Attach display info with a separate lookup (see getComments for why
  // we don't use a PostgREST embed here).
  const { data: userRow } = await supabase
    .from('users')
    .select('id, email, first_name, last_name')
    .eq('id', userId)
    .maybeSingle()
  return { ...row, user: (userRow ?? undefined) as AcceptedTradeComment['user'] }
}

export async function getComments(tradeId: string): Promise<AcceptedTradeComment[]> {
  const { data, error } = await supabase
    .from('accepted_trade_comments')
    .select(COMMENT_SELECT)
    .eq('accepted_trade_id', tradeId)
    .order('created_at', { ascending: true })

  if (error) throw error
  const rows = (data as unknown as AcceptedTradeComment[]) || []
  if (rows.length === 0) return rows

  // Attach display info by looking up public.users in a second round
  // trip. Doing this client-side avoids a PostgREST embed that breaks
  // when the FK on accepted_trade_comments.user_id points at auth.users
  // instead of public.users.
  const userIds = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean)))
  if (userIds.length === 0) return rows
  const { data: users } = await supabase
    .from('users')
    .select('id, email, first_name, last_name')
    .in('id', userIds)
  const byId = new Map((users || []).map((u) => [u.id as string, u]))
  return rows.map((r) => ({
    ...r,
    user: byId.get(r.user_id) as AcceptedTradeComment['user'],
  }))
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
