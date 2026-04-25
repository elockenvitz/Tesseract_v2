/**
 * Execute Sim Variants Service
 *
 * The unified pipeline for committing Trade Lab sim variants to the
 * Trade Book (`accepted_trades`).
 *
 * Replaces the older "Create Trade Sheet" CTA as the primary execute action.
 * Trade Sheets remain available as snapshot artifacts for sharing, but they
 * are no longer the unit of execution.
 *
 * For each variant the pipeline must:
 *
 *   A. **Has a linked pending DR** (via proposal_id or decision_request_id)
 *      → mark the DR accepted, insert accepted_trade pointing to it.
 *
 *   B. **Has a trade_queue_item but no pending DR** (logged idea, no
 *      analyst recommendation yet) → create a self-proposed DR
 *      (requester = decider = current PM) with status='accepted', then
 *      insert accepted_trade.
 *
 *   C. **Ad-hoc** (no linked queue item) → create a trade_queue_item from
 *      the variant's asset, then a self-proposed DR, then accepted_trade.
 *
 * All rows produced in a single Execute click share an `executed_at`
 * timestamp and a `trade_batch_id`. The batch carries an optional name
 * provided by the PM ("Rebalance round 1"), per the design (option C-iii).
 *
 * Holdings-source behavior is delegated to `createAcceptedTrade`'s built-in
 * `finalizeTradeForHoldingsSource`:
 *   - paper / manual_eod  → auto-applies to holdings, marks reconciled
 *   - live_feed           → leaves trade pending L1 reconciliation
 *
 * On success, the variants are deleted from `lab_variants` (and thus from
 * the sim table) so the PM can immediately start a new working set on top
 * of the new pro-forma baseline.
 */

import { supabase } from '../supabase'
import { createAcceptedTrade, type CreateAcceptedTradeInput } from './accepted-trade-service'
import { deleteVariant } from './intent-variant-service'
import type {
  IntentVariantWithDetails,
  AcceptedTradeWithJoins,
  ActionContext,
  TradeAction,
  TradeBatch,
} from '../../types/trading'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecuteSimVariantsParams {
  /** Variants to commit, in the order the PM wants them executed. */
  variants: IntentVariantWithDetails[]
  /** Portfolio they all belong to. Asserted to match every variant. */
  portfolioId: string
  /** Optional batch name (e.g. "Morning rebalance"). */
  batchName?: string | null
  /** Optional batch description. */
  batchDescription?: string | null
  /** PM acting on the execute. */
  context: ActionContext
  /** Optional per-variant reason/rationale. Keys are variant IDs. The
   *  string lands on accepted_trade.acceptance_note for each committed
   *  trade, so the context is permanent on the Trade Book row and the
   *  Outcomes surface. Missing / empty entries fall back to the
   *  variant's existing notes, then null. */
  reasonsByVariantId?: Record<string, string>
}

export interface ExecuteSimVariantsResult {
  batch: TradeBatch
  trades: AcceptedTradeWithJoins[]
  /** Variants that failed to commit (e.g. missing sizing). One entry per failure. */
  failures: Array<{ variantId: string; symbol: string; reason: string }>
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Determine the trade source bucket for a variant. Maps to the
 * `accepted_trades.source` enum.
 */
function classifyVariantSource(v: IntentVariantWithDetails): 'inbox' | 'simulation' | 'adhoc' {
  if (v.proposal_id || v.decision_request_id) return 'inbox'
  if (v.trade_queue_item_id) return 'simulation'
  return 'adhoc'
}

/**
 * Find any pending decision_request that the variant should resolve. We
 * prefer an explicit decision_request_id link, then fall back to the
 * proposal_id, then the trade_queue_item_id + portfolio combo.
 */
async function findExistingPendingDR(v: IntentVariantWithDetails): Promise<string | null> {
  if (v.decision_request_id) {
    const { data } = await supabase
      .from('decision_requests')
      .select('id, status')
      .eq('id', v.decision_request_id)
      .maybeSingle()
    if (data && (data as any).status === 'pending') return (data as any).id
  }

  if (v.proposal_id && v.portfolio_id) {
    const { data } = await supabase
      .from('decision_requests')
      .select('id, status')
      .eq('proposal_id', v.proposal_id)
      .eq('portfolio_id', v.portfolio_id)
      .in('status', ['pending', 'under_review', 'needs_discussion'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data) return (data as any).id
  }

  if (v.trade_queue_item_id && v.portfolio_id) {
    const { data } = await supabase
      .from('decision_requests')
      .select('id, status')
      .eq('trade_queue_item_id', v.trade_queue_item_id)
      .eq('portfolio_id', v.portfolio_id)
      .in('status', ['pending', 'under_review', 'needs_discussion'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data) return (data as any).id
  }

  return null
}

/**
 * Create a self-proposed DR (requester = decider) for a variant that has
 * no existing pending DR. Used for cases B and C (logged idea or ad-hoc).
 *
 * The DR is inserted directly with status='accepted' so we don't need a
 * second update step. The PM is both the requester and the reviewer.
 */
async function createSelfProposedAcceptedDR(
  v: IntentVariantWithDetails,
  tradeQueueItemId: string,
  ctx: ActionContext,
): Promise<string> {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('decision_requests')
    .insert({
      trade_queue_item_id: tradeQueueItemId,
      portfolio_id: v.portfolio_id,
      requested_by: ctx.actorId,
      requested_action: v.action,
      sizing_weight: v.computed?.target_weight ?? null,
      sizing_shares: v.computed?.target_shares ?? null,
      sizing_mode: v.sizing_spec?.kind ?? null,
      status: 'accepted',
      reviewed_by: ctx.actorId,
      reviewed_at: now,
      decision_note: 'Self-proposed via Trade Lab Execute',
      context_note: v.notes ?? null,
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`Failed to create self-proposed DR: ${error?.message || 'unknown'}`)
  }
  return (data as any).id
}

/**
 * Ensure a trade_queue_item exists for the variant. Returns the id of an
 * existing item if linked, otherwise reuses the most recent active TQI
 * for the same (asset, portfolio) pair, or creates a fresh ad-hoc one.
 *
 * Why look up by (asset, portfolio) when there's no trade_queue_item_id:
 * direct-edit variants on baseline positions (e.g. the PM clicks an
 * existing holding and types "trim 0.5%") don't carry a TQI reference,
 * but the asset may already have one from an earlier idea. Reusing it
 * keeps the Trade Book history coherent and avoids polluting the queue
 * with ad-hoc items for every follow-on action on the same asset.
 */
async function ensureTradeQueueItem(
  v: IntentVariantWithDetails,
  ctx: ActionContext,
): Promise<string> {
  if (v.trade_queue_item_id) return v.trade_queue_item_id

  // Try to find an existing non-terminal TQI for this asset+portfolio.
  if (v.portfolio_id) {
    const { data: existing } = await supabase
      .from('trade_queue_items')
      .select('id')
      .eq('asset_id', v.asset_id)
      .eq('portfolio_id', v.portfolio_id)
      .eq('visibility_tier', 'active')
      .in('status', ['idea', 'discussing', 'simulating', 'deciding'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (existing) return (existing as any).id
  }

  // No existing candidate → create a fresh ad-hoc TQI. Populate every
  // NOT NULL column AND portfolio_id, because the SELECT RLS policy
  // requires portfolio_in_current_org(portfolio_id) — without it the
  // post-insert .select() fails with an RLS violation even though the
  // INSERT policy (auth.uid() = created_by) passed.
  const { data, error } = await supabase
    .from('trade_queue_items')
    .insert({
      asset_id: v.asset_id,
      portfolio_id: v.portfolio_id ?? null,
      created_by: ctx.actorId,
      action: v.action,
      status: 'deciding',
      stage: 'ready_for_decision',
      visibility_tier: 'active',
      origin_type: 'manual',
      origin_metadata: { source: 'trade_lab_execute', variant_id: v.id },
      context_tags: [],
      rationale: v.notes ?? 'Created from Trade Lab Execute (ad-hoc)',
      urgency: 'medium',
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`Failed to create ad-hoc trade_queue_item: ${error?.message || 'unknown'}`)
  }
  return (data as any).id
}

/**
 * Build the CreateAcceptedTradeInput from a variant + resolved DR.
 */
function buildAcceptedTradeInput(
  v: IntentVariantWithDetails,
  decisionRequestId: string,
  tradeQueueItemId: string,
  batchId: string,
  ctx: ActionContext,
  reason?: string | null,
  batchDescription?: string | null,
): CreateAcceptedTradeInput {
  const computed = v.computed
  // Shares columns on accepted_trades are integers. If the baseline has
  // fractional holdings (e.g. AZO 1,075.12) and the user trims to a
  // rounded delta (e.g. -1,075), the resulting target_shares is
  // 1075.12 + (-1075) = 0.12 — a non-integer float that fails the
  // Postgres integer coercion at insert time. Round both values before
  // shipping. The client-side row display is also integer (fmtShares
  // uses Math.round) so this doesn't change what the PM sees.
  const roundIntOrNull = (v: number | null | undefined): number | null =>
    v == null || !Number.isFinite(v) ? null : Math.round(v)
  return {
    portfolio_id: v.portfolio_id,
    asset_id: v.asset_id,
    action: v.action as TradeAction,
    sizing_input: v.sizing_input,
    sizing_spec: v.sizing_spec ?? null,
    target_weight: computed?.target_weight ?? null,
    target_shares: roundIntOrNull(computed?.target_shares),
    delta_weight: computed?.delta_weight ?? null,
    delta_shares: roundIntOrNull(computed?.delta_shares),
    // ComputedValues uses `notional_value` and `price_used` — the earlier
    // shorter names `notional` / `price` don't exist on the type, so
    // reading them returned undefined → NULL at insert time. That broke
    // foldTradesIntoActiveSimulations (which early-returns when
    // price_at_acceptance is null) and silently skipped the sim baseline
    // update for every trade executed through this path.
    notional_value: computed?.notional_value ?? null,
    price_at_acceptance: computed?.price_used ?? null,
    source: classifyVariantSource(v),
    decision_request_id: decisionRequestId,
    lab_variant_id: v.id,
    trade_queue_item_id: tradeQueueItemId,
    proposal_id: v.proposal_id ?? null,
    accepted_by: ctx.actorId,
    // Precedence for the permanent note on the accepted_trade:
    //   1. Explicit per-trade reason from the Execute modal
    //   2. Batch rationale / description (inherited when the PM wrote
    //      one overall "why" and skipped the per-trade fields — the
    //      common case for cash raises / rebalances where every trade
    //      shares the same motivation)
    //   3. Variant's own notes (from earlier editing)
    //   4. null — PM can backfill context later in Trade Book/Outcomes
    acceptance_note:
      (reason && reason.trim())
      || (batchDescription && batchDescription.trim())
      || v.notes
      || null,
    batch_id: batchId,
  }
}

/**
 * Bulk-delete `simulation_trades` rows for many assets at once. Used by
 * the parallelized execute pipeline so we replace N round-trips (one
 * sims+delete per committed variant) with a single SELECT + DELETE.
 */
async function bulkDeleteSimulationTradesForAssets(
  portfolioId: string,
  assetIds: string[],
): Promise<void> {
  if (assetIds.length === 0) return
  const { data: sims, error: simsErr } = await supabase
    .from('simulations')
    .select('id')
    .eq('portfolio_id', portfolioId)
    .is('completed_at', null)
  if (simsErr || !sims || sims.length === 0) return
  const simIds = (sims as any[]).map(s => s.id)

  const { error } = await supabase
    .from('simulation_trades')
    .delete()
    .in('simulation_id', simIds)
    .in('asset_id', assetIds)
  if (error) {
    console.warn('[ExecuteSim] Bulk delete simulation_trades failed', error)
  }
}

/**
 * Aggregated fold: apply ALL committed trades to the baseline of every
 * active simulation in a single pass per sim. Replaces calling
 * foldTradeIntoActiveSimulations once per variant, which re-fetched the
 * same sims repeatedly and — worse — caused last-write-wins races when
 * parallelized, since every variant read+wrote the same JSONB column.
 *
 * Model B semantics preserved: baseline_total_value stays fixed; only
 * position shares/values/weights mutate. Same rules for new positions,
 * full exits, and existing-position updates as the single-trade helper.
 */
async function foldTradesIntoActiveSimulations(
  trades: AcceptedTradeWithJoins[],
  portfolioId: string,
): Promise<void> {
  if (trades.length === 0) return

  // Gate on holdings_source — only paper/manual_eod mutate the sim baseline.
  const { data: portfolio } = await supabase
    .from('portfolios')
    .select('holdings_source')
    .eq('id', portfolioId)
    .single()
  const source = (portfolio as any)?.holdings_source as
    | 'paper'
    | 'manual_eod'
    | 'live_feed'
    | undefined
  if (!source || source === 'live_feed') return

  const { data: sims, error: simsErr } = await supabase
    .from('simulations')
    .select('id, baseline_holdings, baseline_total_value')
    .eq('portfolio_id', portfolioId)
    .is('completed_at', null)
  if (simsErr || !sims || sims.length === 0) return

  await Promise.all(
    (sims as any[]).map(async (sim) => {
      const baseline: any[] = Array.isArray(sim.baseline_holdings)
        ? sim.baseline_holdings.map((h: any) => ({ ...h }))
        : []

      // Track total cash impact of this trade batch — every share
      // increase at baseline price debits cash by the same amount,
      // every share decrease credits it. Without this, total holding
      // value drifts away from `baseline_total_value` and weights
      // sum to over (or under) 100%. Buys + sells in one batch
      // net out as a single cash adjustment at the end.
      let cashDelta = 0

      for (const trade of trades) {
        const tradePrice = trade.price_at_acceptance != null ? Number(trade.price_at_acceptance) : null
        if (tradePrice == null || !Number.isFinite(tradePrice)) continue

        const targetShares = trade.target_shares != null ? Number(trade.target_shares) : null
        const deltaShares = trade.delta_shares != null ? Number(trade.delta_shares) : null
        if (targetShares == null && deltaShares == null) continue

        const idx = baseline.findIndex((h: any) => h.asset_id === trade.asset_id)
        const prevShares = idx >= 0 ? Number(baseline[idx].shares) || 0 : 0
        let newShares: number
        if (targetShares != null) {
          newShares = targetShares
        } else {
          newShares = prevShares + (deltaShares ?? 0)
        }
        const sharesChange = newShares - prevShares

        if (newShares <= 0) {
          if (idx >= 0) {
            // Position fully closed — credit cash for the disposed
            // shares at the (preserved) baseline price.
            const closedPrice = Number(baseline[idx].price) || tradePrice
            cashDelta += prevShares * closedPrice
            baseline.splice(idx, 1)
          }
        } else if (idx >= 0) {
          // Keep the EXISTING baseline price — the fold tracks
          // ownership (shares) changes, not a mark-to-market. Cash
          // moves by sharesChange × baseline price so the total
          // value stays pegged to baseline_total_value.
          const preservedPrice = Number(baseline[idx].price) || tradePrice
          baseline[idx].shares = newShares
          baseline[idx].price = preservedPrice
          baseline[idx].value = newShares * preservedPrice
          cashDelta -= sharesChange * preservedPrice
        } else {
          // New position — no prior baseline mark, so the trade
          // price is the best we have. Cash debits by the full
          // notional at trade price. Refreshes on next EOD mark.
          const asset: any = (trade as any).asset || {}
          baseline.push({
            asset_id: trade.asset_id,
            symbol: asset.symbol || '',
            company_name: asset.company_name || '',
            sector: asset.sector || null,
            shares: newShares,
            price: tradePrice,
            value: newShares * tradePrice,
            weight: 0,
          })
          cashDelta -= newShares * tradePrice
        }
      }

      // Apply the net cash adjustment to CASH_USD so the total
      // holdings value stays equal to baseline_total_value and
      // weights sum to ~100%.
      if (cashDelta !== 0) {
        const cashIdx = baseline.findIndex(
          (h: any) => h.symbol === 'CASH_USD' || h.symbol === 'CASH',
        )
        if (cashIdx >= 0) {
          const newCash = (Number(baseline[cashIdx].shares) || 0) + cashDelta
          baseline[cashIdx].shares = newCash
          baseline[cashIdx].price = 1
          baseline[cashIdx].value = newCash
        }
      }

      // baseline_total_value stays fixed (Model B). Re-derive weights from
      // the fixed total so cash shows up as the residual.
      const fixedTotal =
        Number(sim.baseline_total_value) || baseline.reduce((s, h) => s + (Number(h.value) || 0), 0)
      for (const h of baseline) {
        h.weight = fixedTotal > 0 ? (Number(h.value) / fixedTotal) * 100 : 0
      }

      const { error: updErr } = await supabase
        .from('simulations')
        .update({
          baseline_holdings: baseline,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sim.id)
      if (updErr) {
        console.warn('[ExecuteSim] Aggregated fold update failed for sim', sim.id, updErr)
      }
    }),
  )
}

/**
 * After an accepted_trade is created from a sim-lab execute, advance the
 * linked trade_queue_item so the Decision Outcomes surface (which
 * filters on `trade_queue_items.status IN ('approved','executed',...)`)
 * picks it up. Without this the TQI stays at its working status
 * ('deciding' for ad-hoc trades, whatever for imported ideas) and the
 * trade is invisible on the accountability page.
 *
 * Mirrors the post-commit advancement `acceptFromInboxToAcceptedTrade`
 * does via moveTradeIdea, but scoped to a single portfolio's track. If
 * the TQI is shared across multiple portfolios (trade_idea_portfolios
 * with one row per portfolio), we only flip the global TQI status once
 * every portfolio's track has a terminal decision_outcome. Otherwise we
 * update just this portfolio's track and leave the global status alone.
 *
 * Non-fatal: failures log a warning; the accepted_trade is already
 * committed and the PM can manually advance the idea via the kanban.
 */
async function advanceTradeIdeaAfterExecute(
  tradeQueueItemId: string,
  portfolioId: string,
  ctx: ActionContext,
): Promise<void> {
  const now = new Date().toISOString()

  // 1. Update this portfolio's track, if one exists.
  try {
    await supabase
      .from('trade_idea_portfolios')
      .update({
        decision_outcome: 'accepted',
        decided_by: ctx.actorId,
        decided_at: now,
      })
      .eq('trade_queue_item_id', tradeQueueItemId)
      .eq('portfolio_id', portfolioId)
  } catch (e) {
    console.warn('[ExecuteSim] Failed to update per-portfolio track', e)
  }

  // 2. Check for other unresolved tracks across portfolios. If any
  // other portfolio still has a null decision_outcome, the idea
  // isn't globally done yet — leave the TQI status alone.
  let hasOtherOpenTracks = false
  try {
    const { data: openTracks } = await supabase
      .from('trade_idea_portfolios')
      .select('portfolio_id, decision_outcome')
      .eq('trade_queue_item_id', tradeQueueItemId)
    if (openTracks && openTracks.length > 0) {
      hasOtherOpenTracks = openTracks.some(
        (t: any) => t.portfolio_id !== portfolioId && t.decision_outcome == null,
      )
    }
  } catch (e) {
    console.warn('[ExecuteSim] Failed to scan open tracks', e)
  }

  if (hasOtherOpenTracks) return

  // 3. No other portfolios are waiting — flip the TQI itself to
  // 'executed' so the Decision Outcomes ledger picks it up. Also set
  // approved_at (used by the page's date-range filter) if it hasn't
  // been set already by an earlier stage.
  try {
    const { error } = await supabase
      .from('trade_queue_items')
      .update({
        status: 'executed',
        approved_at: now,
        approved_by: ctx.actorId,
        updated_at: now,
      })
      .eq('id', tradeQueueItemId)
      // Don't step on rows that a user or another flow has already
      // moved to a terminal state.
      .not('status', 'in', '(executed,rejected,cancelled)')
    if (error) {
      console.warn('[ExecuteSim] Failed to advance TQI status', error)
    }
  } catch (e) {
    console.warn('[ExecuteSim] advanceTradeIdeaAfterExecute threw', e)
  }
}

/**
 * After a variant is committed to an accepted_trade, resolve any other
 * artifacts that represent the same trade idea for this portfolio:
 *
 *  - Deactivate every active `trade_proposal` linked to the same TQI
 *    + portfolio. Without this the proposal stays visible as a
 *    recommendation in the Trade Lab left pane even though the PM
 *    already executed it — and clicking the pane re-imports it as
 *    a fresh variant, appearing to undo the execute.
 *  - Advance every pending `decision_request` for the same TQI
 *    + portfolio to 'accepted', linking to the new accepted_trade.
 *    (The DR we explicitly resolved earlier is skipped to avoid a
 *    redundant update — path A uses `markDRAccepted` directly.)
 *
 * Both steps mirror what `acceptFromInboxToAcceptedTrade` does for the
 * inbox path. Without them, the Trade Lab's proposal and DR layers
 * drift out of sync with the Trade Book.
 *
 * Non-fatal: failures here don't roll back the accepted_trade.
 */
async function resolveOrphanedIdeaArtifacts(params: {
  tradeQueueItemId: string
  portfolioId: string
  acceptedTradeId: string
  excludeDecisionRequestId: string | null
  ctx: ActionContext
}): Promise<void> {
  const { tradeQueueItemId, portfolioId, acceptedTradeId, excludeDecisionRequestId, ctx } = params
  const now = new Date().toISOString()

  // 1. Deactivate any still-active proposals for this TQI/portfolio.
  try {
    const { error } = await supabase
      .from('trade_proposals')
      .update({ is_active: false, updated_at: now })
      .eq('trade_queue_item_id', tradeQueueItemId)
      .eq('portfolio_id', portfolioId)
      .eq('is_active', true)
    if (error) console.warn('[ExecuteSim] Failed to deactivate proposals', error)
  } catch (e) {
    console.warn('[ExecuteSim] Deactivate proposals threw', e)
  }

  // 2. Find every pending DR for the same TQI/portfolio besides the one we
  // explicitly resolved in the main loop. Mark them accepted and link to
  // the same accepted_trade so the inbox no longer surfaces them.
  try {
    let query = supabase
      .from('decision_requests')
      .select('id')
      .eq('trade_queue_item_id', tradeQueueItemId)
      .eq('portfolio_id', portfolioId)
      .in('status', ['pending', 'under_review', 'needs_discussion'])
    if (excludeDecisionRequestId) query = query.neq('id', excludeDecisionRequestId)

    const { data: staleDRs, error: fetchErr } = await query
    if (fetchErr) {
      console.warn('[ExecuteSim] Failed to scan orphan DRs', fetchErr)
      return
    }
    if (!staleDRs || staleDRs.length === 0) return

    const ids = (staleDRs as any[]).map(r => r.id)
    const { error: updErr } = await supabase
      .from('decision_requests')
      .update({
        status: 'accepted',
        reviewed_by: ctx.actorId,
        reviewed_at: now,
        decision_note: 'Resolved by Trade Lab Execute (sibling of committed trade)',
        accepted_trade_id: acceptedTradeId,
        updated_at: now,
      })
      .in('id', ids)
    if (updErr) console.warn('[ExecuteSim] Failed to resolve orphan DRs', updErr)
  } catch (e) {
    console.warn('[ExecuteSim] Resolve orphan DRs threw', e)
  }
}

/**
 * Mark an existing DR accepted via direct update. Used in case A.
 *
 * Note: we don't go through `updateDecisionRequest` because that helper
 * has stage-validation side effects we don't want here (the DR is being
 * resolved as part of an Execute click, not a normal inbox accept).
 */
async function markDRAccepted(decisionRequestId: string, ctx: ActionContext): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('decision_requests')
    .update({
      status: 'accepted',
      reviewed_by: ctx.actorId,
      reviewed_at: now,
      decision_note: 'Accepted via Trade Lab Execute',
      updated_at: now,
    })
    .eq('id', decisionRequestId)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Commit a working set of sim variants to the Trade Book.
 *
 * Failures on individual variants are caught and reported in `failures`
 * rather than aborting the whole batch — the PM gets partial-success
 * feedback and can re-execute the failures after fixing them.
 *
 * The `batch_id` is created up-front so that even partial success groups
 * the committed trades coherently. If ALL variants fail, the (empty) batch
 * is rolled back.
 */
export async function executeSimVariants(
  params: ExecuteSimVariantsParams,
): Promise<ExecuteSimVariantsResult> {
  const { variants, portfolioId, batchName, batchDescription, context, reasonsByVariantId } = params

  // Defensive: assert all variants belong to the requested portfolio.
  for (const v of variants) {
    if (v.portfolio_id !== portfolioId) {
      throw new Error(
        `Variant ${v.id} (${v.asset?.symbol || '?'}) belongs to portfolio ${v.portfolio_id}, expected ${portfolioId}`,
      )
    }
  }

  // 1. Create the batch up-front.
  const sourceBuckets = new Set(variants.map(classifyVariantSource))
  const sourceType = sourceBuckets.size > 1 ? 'mixed' : Array.from(sourceBuckets)[0] || 'simulation'

  const { data: batchRow, error: batchErr } = await supabase
    .from('trade_batches')
    .insert({
      portfolio_id: portfolioId,
      name: batchName ?? null,
      description: batchDescription ?? null,
      status: 'active',
      source_type: sourceType,
      created_by: context.actorId,
    })
    .select('*')
    .single()

  if (batchErr || !batchRow) {
    throw new Error(`Failed to create trade_batch: ${batchErr?.message || 'unknown'}`)
  }
  const batch = batchRow as unknown as TradeBatch

  // 2. Commit each variant in PARALLEL.
  //
  // Previously this loop ran sequentially, firing ~10 DB round-trips
  // per variant (ensure TQI → resolve DR → insert accepted_trade →
  // finalize holdings → fold into sims → delete sim_trades → delete
  // variant). A 20-trade batch therefore needed ~200 sequential hops and
  // felt noticeably slow to PMs.
  //
  // Different variants touch disjoint rows for the common case (one
  // trade per asset per batch), so phase 1 — the commit itself plus the
  // idempotent resolve/advance steps — is safe to parallelize. Phase 2
  // (fold + sim_trade cleanup + variant delete) is hoisted out so it
  // runs ONCE across the whole batch: a single aggregated fold per
  // active simulation prevents last-write-wins races on the shared
  // `baseline_holdings` JSONB column, and a single `.in(...)` delete
  // replaces N sim-fetch + delete round-trips.
  type CommitSuccess = { ok: true; trade: AcceptedTradeWithJoins; variantId: string }
  type CommitFailure = { ok: false; failure: ExecuteSimVariantsResult['failures'][number] }
  type CommitResult = CommitSuccess | CommitFailure

  const commitResults: CommitResult[] = await Promise.all(
    variants.map(async (v): Promise<CommitResult> => {
      try {
        if (!v.sizing_input || !v.computed) {
          return {
            ok: false,
            failure: {
              variantId: v.id,
              symbol: v.asset?.symbol || '?',
              reason: 'No sizing entered',
            },
          }
        }

        const tradeQueueItemId = await ensureTradeQueueItem(v, context)

        let decisionRequestId = await findExistingPendingDR(v)
        if (decisionRequestId) {
          await markDRAccepted(decisionRequestId, context)
        } else {
          decisionRequestId = await createSelfProposedAcceptedDR(v, tradeQueueItemId, context)
        }
        const resolvedExistingDR = decisionRequestId

        const reason = reasonsByVariantId?.[v.id] ?? null
        const trade = await createAcceptedTrade(
          buildAcceptedTradeInput(v, decisionRequestId, tradeQueueItemId, batch.id, context, reason, batchDescription),
        )

        // Resolve orphan proposals + sibling DRs, and advance the TQI
        // in parallel — both are idempotent and non-fatal. Their helpers
        // wrap DB errors internally, so Promise.all won't surface a
        // rejection that would roll back the committed trade.
        if (tradeQueueItemId) {
          await Promise.all([
            resolveOrphanedIdeaArtifacts({
              tradeQueueItemId,
              portfolioId,
              acceptedTradeId: trade.id,
              excludeDecisionRequestId: resolvedExistingDR,
              ctx: context,
            }),
            advanceTradeIdeaAfterExecute(tradeQueueItemId, portfolioId, context),
          ])
        }

        return { ok: true, trade, variantId: v.id }
      } catch (e: any) {
        return {
          ok: false,
          failure: {
            variantId: v.id,
            symbol: v.asset?.symbol || '?',
            reason: e?.message || 'Unknown error',
          },
        }
      }
    }),
  )

  const trades: AcceptedTradeWithJoins[] = []
  const failures: ExecuteSimVariantsResult['failures'] = []
  const committedVariantIds: string[] = []
  for (const r of commitResults) {
    if (r.ok) {
      trades.push(r.trade)
      committedVariantIds.push(r.variantId)
    } else {
      failures.push(r.failure)
    }
  }

  // 3. If everything failed, drop the empty batch so it doesn't pollute
  // the Trade Book history.
  if (trades.length === 0) {
    await supabase.from('trade_batches').delete().eq('id', batch.id)
    return { batch, trades, failures }
  }

  // 4. Post-commit cleanup — fire-and-forget.
  //
  // Previously this awaited a fold + bulk-delete + per-variant deletes
  // before returning. Those are housekeeping (keep sim baselines in sync,
  // clear the working set, drop lab_variants rows) and don't affect
  // whether the trades were committed. The Decision Recorded modal was
  // therefore delayed by the full cleanup time on a large batch —
  // hundreds of ms of perceived "still executing" after the actual
  // commits had already landed. Running cleanup in the background lets
  // the UI flip to the Decision Recorded moment immediately; the
  // client's optimistic cache patches already hide the committed
  // variants, so the user sees the new working set at the same time
  // they see the modal. Invalidations in the mutation's onSuccess pick
  // up the real rows from the server a moment later.
  //
  // Order inside the background task is preserved (fold before sim_trade
  // delete) so the SimulationPage sync effect can't observe an orphaned
  // sim_trade mid-flight.
  const committedAssetIds = Array.from(new Set(trades.map(t => t.asset_id)))
  void (async () => {
    try {
      await foldTradesIntoActiveSimulations(trades, portfolioId)
      await Promise.all([
        bulkDeleteSimulationTradesForAssets(portfolioId, committedAssetIds),
        Promise.all(
          committedVariantIds.map(vid =>
            deleteVariant(vid, context).catch(e => {
              console.warn('[ExecuteSim] deleteVariant failed (non-fatal, trade already committed)', vid, e)
            }),
          ),
        ),
      ])
    } catch (e) {
      console.warn('[ExecuteSim] background cleanup failed (non-fatal, trades committed)', e)
    }
  })()

  return { batch, trades, failures }
}
