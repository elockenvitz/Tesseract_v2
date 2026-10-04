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
import { moveTradeIdea, reconcileOutcomeAfterRevert } from './trade-idea-service'
import { FINAL_STAGE } from '../ideas/stage-model'
import { resolveAcceptSizingBasis, computeAcceptSizing, isRefusal } from '../decisions/accept-sizing'
import { resolveIdeaAfterDecision, type FanInResult } from '../decisions/decision-fan-in'
import {
  recordDecisionReverted,
  recordExecutionRecorded,
  resolveOrganizationIdForPortfolio,
} from '../memory/lifecycle-events'
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
// `rationale` and `thesis_text` come from the SAME join that was already here.
//
// The chain from a committed trade back to why anybody wanted it was never
// broken in the schema -- `accepted_trades.trade_queue_item_id` is populated on
// every row -- it was broken in this SELECT. Trade Book could therefore only
// ever show `acceptance_note` (often null on an inbox accept) and the batch
// description, and the analyst's original case was unreachable from the one
// surface that records what the desk actually did.
//
// Two columns on an existing embed. No new query, no copy of the text, and no
// second place for it to drift from.
//
// ── Correction, Memory Spine slice 2 ───────────────────────────────────────
// Reaching the analyst's case through this embed restored the link, but it
// reached the CURRENT case. A committed trade is a historical fact and its
// "case for the idea" was re-reading `trade_queue_items` live, so editing an
// idea silently rewrote the stated reasoning behind trades already executed
// against it.
//
// `decision_request.proposal_version` is the frozen submission. The
// `trade_queue_item` embed stays for pair wiring and for the current action,
// which are current facts by nature — but its `rationale`/`thesis_text` must
// not be rendered as the historical case. See AcceptedTradesTable's
// `originalCase`.
const TRADE_SELECT = `
  *,
  asset:assets(id, symbol, company_name, sector),
  decision_request:decision_requests!accepted_trades_decision_request_id_fkey(
    id, submission_snapshot, sizing_weight, sizing_shares, sizing_mode, requested_action, created_at,
    proposal_version:proposal_version_id(
      id, version_number, action, weight, shares, sizing_mode, notes,
      thesis_text, rationale, conviction, target_price, time_horizon,
      theses, captured_from, submitted_at
    )
  ),
  trade_queue_item:trade_queue_items!accepted_trades_trade_queue_item_id_fkey(id, pair_id, pair_trade_id, pair_leg_type, action, rationale, thesis_text)
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
  /**
   * Provenance for the execution evidence this create may produce.
   * Omitted means `observed`. The Inbox accept path sets `pmAssumed`.
   */
  execution_origin?: string
  /**
   * Why this trade carries no executable quantity, when it does not.
   *
   * Set by a caller that already tried to size and failed, so the stored
   * note names the ACTUAL obstacle — no price on the snapshot date, an
   * unparseable instruction — rather than the generic fallback. The decision
   * is still recorded; only the execution is withheld.
   */
  unexecutable_reason?: string | null
}

/** Whole shares. Mirrors the Trade Lab execute path's rounding exactly. */
const roundIntOrNull = (v: number | null | undefined): number | null =>
  v == null || !Number.isFinite(v) ? null : Math.round(v)

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
  const { trade: finalized, executionProven } = await finalizeTradeForHoldingsSource(
    trade,
    input.accepted_by,
    input.execution_origin ?? EXECUTION_ORIGIN.observed,
    input.unexecutable_reason ?? null,
  )

  // ── Record the execution in organisational memory ─────────────────────
  //
  // Gated on `executionProven`, which is true only when the holdings apply
  // reported that it moved shares. The decision is recorded either way by
  // the caller; this event is specifically the claim that the portfolio
  // changed, and it may only exist when the portfolio actually changed.
  //
  // It previously fired on every create. An Inbox accept carries no share
  // sizing, so the apply RPC returned `applied: false` without raising and
  // the event asserted an execution that never happened — permanently, in
  // an append-only table.
  //
  // `decision_request_id` is passed through as-is and is frequently null:
  // simulation promotion and direct Trade Book entry both commit trades with
  // no decision request behind them. That absence is recorded faithfully
  // rather than papered over — an active accepted_trade is itself the
  // decision evidence on those paths, and inventing a request would put a
  // decision nobody made into the permanent record.
  if (executionProven) {
    const organizationId = await resolveOrganizationIdForPortfolio(input.portfolio_id)
    if (organizationId) {
      await recordExecutionRecorded({
        organizationId,
        actorId: input.accepted_by,
        acceptedTradeId: finalized.id,
        portfolioId: input.portfolio_id,
        assetId: input.asset_id,
        decisionRequestId: input.decision_request_id ?? null,
        tradeQueueItemId: input.trade_queue_item_id ?? null,
        proposalId: input.proposal_id ?? null,
        action: input.action,
        // The other grade of proof is 'attested:trader', written by
        // updateExecutionStatus. Keeping them distinguishable is what stops
        // the Spine implying it watched something a person asserted.
        provenance: `observed:holdings-apply:${input.source}`,
      })
    }
  }

  return finalized
}

/**
 * The result of attempting execution at accept time.
 *
 * `executionProven` is the single authority for whether Tesseract may claim
 * this trade executed. It is true ONLY when the holdings apply reported that
 * it moved shares. Every caller that wants to assert execution — the
 * `execution_status` stamp, the `portfolio_trade_events` evidence row, the
 * append-only `execution.recorded` memory event — must gate on it.
 */
type FinalizeOutcome = {
  trade: AcceptedTradeWithJoins
  executionProven: boolean
}

/**
 * The note recorded when execution was attempted and did not happen.
 *
 * Not a new status value. `execution_status` is a TEXT column whose CHECK
 * constraint in production allows only
 * not_started/in_progress/complete/cancelled. Writing a 'failed' value would
 * need a migration applied first, and a release where the code writes a value
 * the database rejects turns a silent wrong state into a hard runtime error on
 * the PM's click. The additive CHECK change is proposed in
 * docs/decision-execution-truth.md and deliberately not taken here.
 *
 * So an unproven execution rests at `not_started` / `pending` — which are
 * also the insert defaults, and which `tradeLifecyclePhase` already renders
 * as "Queued · Waiting on trader" — and the reason lands here, where
 * `updateExecutionStatus` already writes execution commentary.
 */
const UNEXECUTABLE_SIZING_NOTE =
  'Awaiting execution: the accepted sizing has no executable share quantity, '
  + 'so no holdings were changed.'

/**
 * Post-create finalization based on portfolios.holdings_source.
 *
 * For paper/manual_eod portfolios this is where the trade becomes "real":
 * holdings get updated and execution_status flips to 'complete'. For
 * live_feed portfolios this is a no-op — fills arrive later from the feed.
 *
 * ── The invariant this function now enforces ─────────────────────────────
 *
 * Completion is claimed only on proof. Previously the `complete` /
 * `matched` stamp at the end ran unconditionally, so three different
 * non-executions were all recorded as executed-and-reconciled:
 *
 *   1. A trade with no share sizing. `apply_trade_to_holdings` checks for
 *      missing shares BEFORE its price guard and RETURNs `applied: false`
 *      instead of raising, so nothing threw. This is every Decision Inbox
 *      accept, which passes no share columns at all.
 *   2. A trade whose price the RPC refused. That one does raise, and the
 *      exception was caught by the outer handler below, which returned the
 *      un-finalized trade — truthful by accident, and invisible.
 *   3. A failed `portfolio_trade_events` insert, which was caught and
 *      ignored while the completion stamp proceeded.
 *
 * Case 1 was the P0: 47 of 49 production trades completed within 5 seconds
 * of creation, and two Inbox rows read `complete` with null sizing and no
 * event row. `reconciliation_status='matched'` was the worse half — the
 * reconciler skips trades with no share columns, so nothing downstream
 * would ever revisit a stamp it did not earn.
 *
 * Safe to call once per created trade. On failure it records the attempt on
 * `execution_note` and reports `executionProven: false`; it never throws,
 * so a decision is never lost because execution could not be completed.
 */
async function finalizeTradeForHoldingsSource(
  trade: AcceptedTradeWithJoins,
  actorId: string,
  /** Provenance for the evidence row this writes. See `EXECUTION_ORIGIN`. */
  executionOrigin: string = EXECUTION_ORIGIN.observed,
  /** A caller-diagnosed reason this trade cannot execute, if it cannot. */
  unexecutableReason: string | null = null,
): Promise<FinalizeOutcome> {
  try {
    const { data: portfolio, error } = await supabase
      .from('portfolios')
      .select('holdings_source')
      .eq('id', trade.portfolio_id)
      .single()

    if (error || !portfolio) {
      console.warn('[AcceptedTrade] Could not read holdings_source for portfolio', trade.portfolio_id, error)
      return { trade, executionProven: false }
    }

    const source = (portfolio as any).holdings_source as 'live_feed' | 'manual_eod' | 'paper'
    if (source === 'live_feed') {
      // Hands off — external feed drives holdings + execution state. No
      // execution has happened yet, so nothing may claim one: the trade
      // stays not_started and `executionProven` stays false. The event for
      // the eventual fill has to come from whatever marks that fill; see
      // the known gap in docs/decision-execution-truth.md.
      return { trade, executionProven: false }
    }

    // paper / manual_eod: attempt the apply, then record what actually
    // happened — in ONE write, whose payload is chosen by the outcome.
    let applyResult: ApplyTradeResult | null = null
    let refusal: string | null = null
    try {
      applyResult = await applyTradeToHoldings(trade.portfolio_id, trade)
    } catch (e) {
      // The RPC refused the trade — a missing or non-positive price is the
      // known case. The decision stands; execution did not occur.
      refusal = e instanceof Error ? e.message : String(e)
      console.warn('[AcceptedTrade] Holdings apply refused; execution not recorded', refusal)
    }

    // `applied: false` means the RPC ran and chose to write nothing, which
    // it does when the trade carries no share information. Nothing moved,
    // so nothing below may say otherwise.
    const executionProven = !refusal && !!applyResult?.applied
    const now = new Date().toISOString()
    let updates: Record<string, unknown>

    if (!executionProven) {
      updates = {
        execution_status: 'not_started',
        execution_note: refusal
          ? `Execution could not be applied: ${refusal}`
          // A caller that already diagnosed the obstacle says what it was.
          // "No price for SHOP on or before 2026-09-29" is actionable;
          // "no executable share quantity" sends the reader hunting.
          : (unexecutableReason ?? UNEXECUTABLE_SIZING_NOTE),
        updated_at: now,
      }
    } else {
      // Emit a portfolio_trade_events row so the Decision Accountability
      // surface (which matches decisions against events) picks up the
      // execution. Without this, paper/manual_eod executes would show as
      // "awaiting execution" in Outcomes forever — there's no holdings
      // feed running the diff-based event generator, so the event must be
      // produced inline when the trade is applied.
      //
      // A failure here does not un-execute the trade — the shares have
      // moved — so it does not block completion. It is recorded on the
      // trade rather than only in the console, because that missing
      // evidence row is exactly what Outcomes reads.
      let eventNote: string | null = null
      try {
        await emitPaperTradeEvent(trade, applyResult as ApplyTradeResult, actorId, executionOrigin)
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e)
        console.warn('[AcceptedTrade] Failed to emit paper trade event', e)
        eventNote = `Executed, but the execution evidence row could not be written: ${reason}`
      }

      // `reconciliation_status='matched'` is only honest on this branch:
      // the holdings were just written from this trade's own numbers, so
      // there is nothing left to reconcile. This matters for
      // pro-forma-baseline queries which key off pending L1 rows.
      updates = {
        execution_status: 'complete',
        execution_completed_at: now,
        executed_by: actorId,
        reconciliation_status: 'matched',
        reconciled_at: now,
        updated_at: now,
        ...(eventNote ? { execution_note: eventNote } : {}),
      }
    }

    const { data: updated, error: updateError } = await supabase
      .from('accepted_trades')
      .update(updates)
      .eq('id', trade.id)
      .select(TRADE_SELECT)
      .single()

    if (updateError || !updated) {
      // If the shares moved but the row still says not_started, that is an
      // understatement rather than a false claim, so the execution event is
      // still allowed: the portfolio really did change.
      console.warn('[AcceptedTrade] Failed to record execution outcome', updateError)
      return { trade, executionProven }
    }
    return { trade: updated as unknown as AcceptedTradeWithJoins, executionProven }
  } catch (e) {
    console.warn('[AcceptedTrade] finalizeTradeForHoldingsSource failed:', e)
    return { trade, executionProven: false }
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

    /*
     * Reverse only what this application actually applied.
     *
     * Reverting a decision and reversing a position are two different acts,
     * and this used to conflate them: any non-live_feed portfolio got a
     * reversal attempt regardless of whether the accept had moved shares.
     *
     * The gate is system-applied EVIDENCE, not `execution_status`. A status
     * is a claim and can be set by hand — a trader can walk a trade to
     * 'complete' through the execution dropdown without the app ever
     * touching holdings, and on a priced-but-refused trade (one that has
     * delta_shares but whose price the RPC rejected) reversing on status
     * alone would subtract shares the portfolio never gained.
     *
     * Attested evidence is deliberately NOT enough either: that execution
     * happened at the desk, so the app's holdings were never incremented by
     * it and the next EOD upload is what carries it.
     *
     * An un-executed decision therefore reverts as a decision only: the row
     * is soft-deleted, the request goes back to pending, and holdings are
     * untouched because they were never touched.
     */
    if (source && source !== 'live_feed' && await hasSystemAppliedEvidence(id)) {
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

  // The idea may now be claiming an outcome that nothing supports.
  //
  // Reverting is a statement that the decision no longer stands, but the
  // outcome columns on `trade_queue_items` were left exactly as they were —
  // so the idea kept reading `executed` while its decision request sat back
  // at `pending`. Production has a row in precisely that state. Worse, the
  // overwrite guard in `moveTradeIdea` then refuses to change an existing
  // outcome, so the reopened idea could never be decided again.
  //
  // This does NOT unconditionally clear the outcome. It re-asks the canonical
  // question — is there still evidence of a decision? — and clears only if
  // the answer is no. That matters because an idea can have several accepted
  // trades, or a decided request that this revert did not touch (revert only
  // resets the request for `source === 'inbox'`), and in those cases the
  // outcome is still correct.
  if (trade.trade_queue_item_id) {
    await reconcileOutcomeAfterRevert(trade.trade_queue_item_id, context)
  }

  // ── Record the reversal in organisational memory ──────────────────────
  //
  // Nothing above leaves a legible trail that a decision was undone: the
  // trade is soft-deleted, the decision request is reset to `pending`, its
  // `decision_note` is nulled, and the idea's outcome may be cleared. Read
  // afterwards, the canonical rows say the decision never happened — not
  // that it was reversed. This event is the difference.
  //
  // It appends; it does not alter the earlier `decision.recorded` or
  // `execution.recorded` events, which remain true statements about what was
  // decided at the time.
  const organizationId = await resolveOrganizationIdForPortfolio((trade as any).portfolio_id)
  if (organizationId) {
    await recordDecisionReverted({
      organizationId,
      actorId: context.actorId,
      acceptedTradeId: id,
      decisionRequestId: (trade as any).decision_request_id ?? null,
      tradeQueueItemId: (trade as any).trade_queue_item_id ?? null,
      portfolioId: (trade as any).portfolio_id ?? null,
      provenance: context.uiSource ? `ui:${context.uiSource}` : 'ui:trade-book',
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

  /*
    The result of a holdings write is checked, not discarded.

    These two statements dropped their error. `portfolio_holdings` carries RLS
    that can refuse a write — the UPDATE and DELETE policies require the caller
    to be the row's creator or an active admin of the org that owns the
    portfolio — so a refusal is an ordinary outcome, not an exotic one. Ignoring
    it meant a reversal that never happened reported the same as one that did,
    and the book silently kept a position the desk believed it had unwound.

    Thrown rather than logged: the caller is reversing an accepted trade, and
    continuing as though the book matched the trade record is the failure worth
    interrupting.
  */
  // `as any` on the row id follows this file's existing idiom for reading
  // columns off a Supabase result the generated types resolve to `never`.
  // Hoisted once so the id is named in the filter and the message without
  // adding four more instances of that pre-existing typing defect.
  const rowId = (existing as any).id as string

  const newShares = Number(existing.shares) + reverseDelta
  if (newShares <= 0) {
    const { error } = await supabase.from('portfolio_holdings').delete().eq('id', rowId)
    if (error) throw new Error(`Failed to reverse holding ${rowId} (delete): ${error.message}`)
  } else {
    const { error } = await supabase
      .from('portfolio_holdings')
      .update({ shares: newShares, updated_at: new Date().toISOString() })
      .eq('id', rowId)
    if (error) throw new Error(`Failed to reverse holding ${rowId} (update): ${error.message}`)
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

/**
 * The committed trade, plus what happened to the idea behind it.
 *
 * Widened rather than changed: it is still an `AcceptedTradeWithJoins`, so
 * existing callers compile untouched, but a caller that cares whether the
 * idea actually left the pipeline can now find out instead of guessing.
 */
export type AcceptedTradeWithFanIn = AcceptedTradeWithJoins & { fanIn: FanInResult }

export async function acceptFromInboxToAcceptedTrade(
  params: AcceptFromInboxToTradeBookParams
): Promise<AcceptedTradeWithFanIn> {
  const { decisionRequest, sizingInput, decisionNote, context } = params

  const assetId = decisionRequest.trade_queue_item?.assets?.id
  if (!assetId) throw new Error('Decision request has no linked asset')

  const rawAction = (decisionRequest.requested_action || decisionRequest.trade_queue_item?.action || 'buy') as TradeAction

  // Determine if PM modified the analyst's sizing
  const analystSizing = decisionRequest.sizing_weight != null
    ? String(decisionRequest.sizing_weight)
    : null
  const isModified = analystSizing != null && sizingInput !== analystSizing

  /*
   * PILOT EXECUTION CONTRACT — size the approval so it can actually execute.
   *
   * Tesseract has no OMS/EMS/broker integration, so a PM's approval is taken
   * as sufficient cause to move the modeled book. That only works if the
   * approval carries a share quantity, and until now this path carried none:
   * it wrote `sizing_input` and left every numeric column null, so the
   * holdings RPC had nothing to apply.
   *
   * On refusal the trade is still created — the DECISION happened and must
   * be recorded — but with no quantities, so the existing machinery leaves
   * it `not_started` with the reason on `execution_note`. A decision is
   * never lost because it could not be priced, and sizing is never invented
   * to make the flow look complete.
   */
  const basis = await resolveAcceptSizingBasis(
    decisionRequest.portfolio_id,
    assetId,
    decisionRequest.trade_queue_item?.assets?.symbol ?? null,
  )
  const sized = isRefusal(basis)
    ? basis
    : computeAcceptSizing(basis, sizingInput, rawAction, assetId)
  const computed = sized.ok ? sized.computed : null
  if (!sized.ok) {
    console.warn('[AcceptedTrade] Approval could not be sized; recording the decision only:', sized.reason)
  }

  // Create accepted trade
  const trade = await createAcceptedTrade({
    portfolio_id: decisionRequest.portfolio_id,
    asset_id: assetId,
    action: rawAction,
    sizing_input: sizingInput,
    sizing_spec: sized.ok ? sized.spec : null,
    // Shares columns are Postgres integers; mirror the Trade Lab rounding.
    target_weight: computed?.target_weight ?? null,
    target_shares: roundIntOrNull(computed?.target_shares),
    delta_weight: computed?.delta_weight ?? null,
    delta_shares: roundIntOrNull(computed?.delta_shares),
    notional_value: computed?.notional_value ?? null,
    price_at_acceptance: computed?.price_used ?? null,
    /*
     * Provenance for whatever evidence this produces. Nothing observed a
     * fill and nobody attested to one — a PM decision implied it, and the
     * record says exactly that so a future broker-confirmed execution stays
     * distinguishable.
     */
    execution_origin: EXECUTION_ORIGIN.pmAssumed,
    unexecutable_reason: sized.ok ? null : sized.reason,
    source: 'inbox',
    decision_request_id: decisionRequest.id,
    trade_queue_item_id: decisionRequest.trade_queue_item_id,
    proposal_id: decisionRequest.proposal_id ?? null,
    accepted_by: context.actorId,
    /*
     * The same precedence the Trade Lab execute path uses, for the same
     * reason: a committed trade should not be the one record with no stated
     * reason when a reason was sitting in the caller's own argument.
     *
     * This was `decisionNote || null`. The PM's note is optional in the single
     * accept and is passed as `undefined` outright by the pair-leg accept, so
     * the common case wrote NULL -- 15 of 52 committed trades in production
     * have no note at all. Meanwhile `decisionRequest.context_note` (the
     * analyst's "why now" on the request) and the idea's own rationale were
     * both already in hand, in this very object, and discarded.
     *
     * Falls back, never overwrites: an explicit PM note still wins. The text
     * is the analyst's existing words placed in the existing canonical field
     * -- no new column, and nothing invented when all three are empty.
     */
    acceptance_note:
      (decisionNote && decisionNote.trim())
      || (decisionRequest.context_note && decisionRequest.context_note.trim())
      || (decisionRequest.trade_queue_item?.thesis_text?.trim())
      || (decisionRequest.trade_queue_item?.rationale?.trim())
      || null,
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
  const fanIn = await resolveIdeaAfterDecision({
    tradeQueueItemId: decisionRequest.trade_queue_item_id,
    outcome: 'executed',
    context,
    note: 'All portfolios resolved — trade idea concluded after approval',
  })

  /*
   * A failed conclusion is reported, not swallowed.
   *
   * The accepted trade exists and the decision is recorded, so this must not
   * throw — losing a committed decision because a kanban card did not move
   * would be far worse. But the previous `console.error` meant the only
   * trace lived in a browser tab nobody had open: a real production accept
   * left the idea sitting in `ready_to_recommend` with no database record of
   * why. The result is attached to the returned trade so the caller can tell
   * the PM, and so a test can assert on it.
   */
  if (fanIn.status === 'failed') {
    console.error('[AcceptedTrade] Idea not concluded after approval:', fanIn.reason)
  }

  return { ...trade, fanIn }
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
          target: { stage: FINAL_STAGE, outcome: 'executed' },
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
  const price = trade.price_at_acceptance || 0
  const assetId = trade.asset_id

  /*
   * ── portfolio_holdings (daily view) ──
   *
   * One RPC, not four statements.
   *
   * This used to read (portfolio, asset, CURRENT_DATE) and insert a row when
   * it found nothing — which on the first trade of any day it always does.
   * The result was a dated snapshot containing only the traded position, with
   * every other holding left behind on the previous date. `latestSnapshotRows`
   * then correctly returned that one row as "current holdings", so the traded
   * name read 100% and everything else looked newly opened at 0%.
   *
   * Rolling the prior date forward first is the fix, and it cannot be done
   * from here: executeSimVariants commits a batch with Promise.all, so N
   * concurrent callers would each see an empty date and each clone it. The
   * carry-forward, the apply and the cash adjustment happen inside one
   * transaction behind a per-portfolio advisory lock instead.
   *
   * The RPC is SECURITY INVOKER, so every write it performs is still subject
   * to exactly the policies these client statements were subject to.
   */
  const { data: applied, error: applyError } = await supabase.rpc('apply_trade_to_holdings', {
    p_portfolio_id: portfolioId,
    p_asset_id: assetId,
    p_target_shares: trade.target_shares ?? null,
    p_delta_shares: trade.delta_shares ?? null,
    p_price: price,
  })

  if (applyError) {
    throw new Error(
      `Failed to apply trade to holdings for asset ${assetId} in portfolio ${portfolioId}: ${applyError.message}`,
    )
  }

  const result = (applied ?? {}) as {
    shares_before?: number
    shares_after?: number
    applied?: boolean
  }
  const sharesBefore = Number(result.shares_before ?? 0)
  const sharesAfter = Number(result.shares_after ?? 0)

  if (result.applied === false) {
    // No share information on the trade — nothing was written.
    return { sharesBefore, sharesAfter: sharesBefore, priceUsed: price, applied: false }
  }

  const newShares = sharesAfter

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
  /**
   * Why we believe this executed. Defaults to `observed` — the app applied
   * the trade as book of record. The Inbox accept path passes `pmAssumed`,
   * because under the pilot contract nothing observed a fill; a PM decision
   * implied one. Same row shape, same holdings effect, honest label.
   */
  origin: string = EXECUTION_ORIGIN.observed,
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

  await insertExecutionEvent({
    portfolio_id: trade.portfolio_id,
    asset_id: trade.asset_id,
    source_type: origin === EXECUTION_ORIGIN.observed ? 'holdings_diff' : 'manual',
    action_type: actionType,
    event_date: new Date().toISOString().split('T')[0],
    quantity_before: sharesBefore,
    quantity_after: sharesAfter,
    quantity_delta: delta,
    market_value_before: mvBefore,
    market_value_after: mvAfter,
    /*
     * Only a genuinely observed apply was detected BY the system. An assumed
     * execution was caused by a person's decision and observed by nobody, so
     * it reports `false` and `source_type: 'manual'` — the table's existing
     * way of saying "a human put this here, we did not watch it happen".
     */
    detected_by_system: origin === EXECUTION_ORIGIN.observed,
    linked_trade_idea_id: trade.trade_queue_item_id ?? null,
    linked_decision_id: trade.decision_request_id ?? null,
    metadata: {
      origin,
      accepted_trade_id: trade.id,
      batch_id: (trade as any).batch_id ?? null,
    },
    // The rationale lives on accepted_trades.acceptance_note — no
    // separate trade_event_rationale capture is needed for paper
    // executes, so skip pending_rationale and go straight to complete.
    status: 'complete',
    created_by: actorId,
  })
}

/**
 * The one place an execution evidence row is written.
 *
 * Both grades of proof — observed and attested — go through here, so the
 * canonical row has a single shape and a single writer.
 */
async function insertExecutionEvent(row: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from('portfolio_trade_events').insert(row)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Execution evidence
// ---------------------------------------------------------------------------

/*
 * `portfolio_trade_events` is the canonical record that a trade executed.
 * Two things can produce one, and they are not interchangeable:
 *
 *   OBSERVED  — the system applied the trade to holdings itself and watched
 *               the position change. `source_type: 'holdings_diff'`,
 *               `detected_by_system: true`.
 *   ATTESTED  — a PM or trader states that the trade was executed away from
 *               the app, on a manual_eod book where fills arrive by EOD
 *               upload. `source_type: 'manual'`, `detected_by_system: false`.
 *
 * Both are evidence of execution. Only the first is evidence that THIS
 * application moved the numbers, which is what reversal depends on — see
 * `hasSystemAppliedEvidence`. The enum already carried both values
 * ('holdings_diff' and 'manual'), so no schema change was needed to tell
 * them apart.
 */
export const EXECUTION_ORIGIN = {
  observed: 'paper_execute',
  attested: 'trader_attested',
  /**
   * PILOT POLICY: the PM approved, so we assume it filled.
   *
   * Tesseract has no OMS/EMS/broker integration. For the pilot, a PM's
   * "Approve & Execute" is treated as sufficient cause to move the modeled
   * book — but that assumption is written down rather than hidden. This row
   * says "no system and no human observed a fill; a decision implied one."
   *
   * It is deliberately NOT `paper_execute`: that value means the app applied
   * the trade and watched the position change as the book of record. And it
   * is deliberately not `trader_attested`: nobody attested anything.
   *
   * The whole point is the upgrade path. When broker confirmation exists,
   * these rows are trivially separable from real fills — by provenance, not
   * by guessing from timestamps.
   */
  pmAssumed: 'pm_assumed_execution',
} as const

/**
 * Origins where THIS application moved the holdings.
 *
 * `pm_assumed_execution` belongs here and `trader_attested` does not, and
 * the distinction is about mechanics, not credibility. An attested execution
 * happened at the desk, so our holdings were never incremented by it. An
 * assumed execution ran through `apply_trade_to_holdings` exactly like an
 * observed one — the app added those shares, so the app must take them back
 * on revert. Leaving `pmAssumed` out of this set would strand a position
 * that a revert is supposed to remove.
 */
const SYSTEM_APPLIED_ORIGINS: readonly string[] = [
  EXECUTION_ORIGIN.observed,
  EXECUTION_ORIGIN.pmAssumed,
]

/** Every execution evidence row recorded against a trade. */
async function executionEvidenceFor(tradeId: string): Promise<Array<{ origin: string }>> {
  const { data, error } = await supabase
    .from('portfolio_trade_events')
    .select('metadata')
    .eq('metadata->>accepted_trade_id', tradeId)

  if (error) {
    // Treat an unreadable evidence table as "no proof". Callers use this to
    // decide whether to mutate holdings; failing closed is the safe side.
    console.warn('[AcceptedTrade] Could not read execution evidence', error)
    return []
  }
  return ((data ?? []) as Array<{ metadata: { origin?: string } | null }>)
    .map(r => ({ origin: r.metadata?.origin ?? '' }))
}

/**
 * Did THIS application apply the trade to holdings?
 *
 * The gate for reversal. An attested execution happened at the desk, so the
 * app's holdings were never incremented by it and must not be decremented
 * on revert — the next EOD upload is what carries that reality. Reversing
 * on attested evidence would subtract a position the app never added.
 */
async function hasSystemAppliedEvidence(tradeId: string): Promise<boolean> {
  return (await executionEvidenceFor(tradeId)).some(e => SYSTEM_APPLIED_ORIGINS.includes(e.origin))
}

/**
 * Record that a human states this trade was executed away from the app.
 *
 * Writes the same canonical row the observed path writes, with provenance
 * that keeps the two distinguishable forever. Returns false when the trade
 * cannot support the claim — an execution nobody can size is not evidence,
 * and the observed path already declines to write a zero-delta row for the
 * same reason.
 *
 * Idempotent: a trade that already carries evidence does not get a second
 * row, so a retried or repeated completion cannot double-count.
 */
async function emitAttestedExecutionEvent(
  trade: AcceptedTradeWithJoins,
  actorId: string,
): Promise<boolean> {
  /*
   * Idempotent on REAL evidence; an assumption does not count as evidence.
   *
   * This used to return on any existing row. Under the pilot that is wrong
   * in one direction: an accept writes a `pm_assumed_execution` row
   * immediately, so a trader who later confirms the actual fill would have
   * been told "already evidenced" and their attestation never recorded —
   * the assumption permanently crowding out the fact it was standing in for.
   *
   * It is still right in the other direction. An OBSERVED execution means
   * the system applied the trade and watched it; a later attestation adds
   * nothing and would double-record. A second ATTESTATION is the
   * double-click this guard was written for. So both of those still
   * suppress, and only the pilot's assumption yields to the real thing.
   */
  const existing = await executionEvidenceFor(trade.id)
  if (existing.some(e => e.origin !== EXECUTION_ORIGIN.pmAssumed)) {
    return true
  }

  // What the trader is attesting moved. Read the current position so the
  // row states before/after rather than a bare delta.
  const { data: holding } = await supabase
    .from('portfolio_holdings')
    .select('shares')
    .eq('portfolio_id', trade.portfolio_id)
    .eq('asset_id', trade.asset_id)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()

  const sharesBefore = Number((holding as { shares?: number } | null)?.shares ?? 0)
  const delta = trade.delta_shares != null
    ? Number(trade.delta_shares)
    : trade.target_shares != null
      ? Number(trade.target_shares) - sharesBefore
      : null

  if (delta == null || delta === 0) return false

  const sharesAfter = sharesBefore + delta
  const action = trade.action as TradeAction
  let actionType: 'initiate' | 'add' | 'trim' | 'exit'
  if (action === 'sell' || action === 'trim') {
    actionType = sharesAfter <= 0 ? 'exit' : 'trim'
  } else if (action === 'buy') {
    actionType = sharesBefore <= 0 ? 'initiate' : 'add'
  } else {
    actionType = 'add'
  }

  const price = trade.price_at_acceptance != null ? Number(trade.price_at_acceptance) : null

  await insertExecutionEvent({
    portfolio_id: trade.portfolio_id,
    asset_id: trade.asset_id,
    // 'manual' and detected_by_system:false are the standing way this table
    // says "a person entered this, the system did not see it happen".
    source_type: 'manual',
    action_type: actionType,
    event_date: new Date().toISOString().split('T')[0],
    quantity_before: sharesBefore,
    quantity_after: sharesAfter,
    quantity_delta: delta,
    market_value_before: price != null ? sharesBefore * price : null,
    market_value_after: price != null ? sharesAfter * price : null,
    detected_by_system: false,
    linked_trade_idea_id: trade.trade_queue_item_id ?? null,
    linked_decision_id: trade.decision_request_id ?? null,
    metadata: {
      origin: EXECUTION_ORIGIN.attested,
      accepted_trade_id: trade.id,
      batch_id: (trade as any).batch_id ?? null,
      attested_by: actorId,
    },
    status: 'complete',
    created_by: actorId,
  })
  return true
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

/**
 * The trader workflow: a human moves a trade through execution by hand.
 *
 * Marking a trade 'complete' here is an ATTESTATION — the person is stating
 * that the trade executed away from the app, which is the normal shape of a
 * manual_eod book where fills arrive by EOD upload. It is not a PM decision,
 * and it is not the system observing a position change.
 *
 * Before this, completing a trade flipped `execution_status` and nothing
 * else: no holdings moved, no `portfolio_trade_events` row was written, no
 * memory event was emitted. Three surfaces then read the bare status and
 * said "Executed" while Decision Accountability — which reads evidence —
 * correctly said "Pending". The status was a claim with nothing behind it.
 *
 * Now the attestation writes the canonical evidence row first, and the
 * status flip only happens if that succeeded. Completion is refused for a
 * trade nobody can size, because an execution with no quantity is not
 * evidence of anything; such a trade can still be cancelled, or corrected
 * with real sizing.
 *
 * The ordering matters and matches `finalizeTradeForHoldingsSource`: record
 * the proof, then make the claim.
 */
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

  let attested = false
  if (status === 'in_progress') {
    updates.execution_started_at = now
    updates.executed_by = context.actorId
  } else if (status === 'complete') {
    const { data: existing, error: readError } = await supabase
      .from('accepted_trades')
      .select(TRADE_SELECT)
      .eq('id', id)
      .single()

    if (readError || !existing) throw readError || new Error('Trade not found')
    const trade = existing as unknown as AcceptedTradeWithJoins

    const evidenced = await emitAttestedExecutionEvent(trade, context.actorId)
    if (!evidenced) {
      throw new Error(
        'This trade cannot be marked executed: it has no executable share '
        + 'quantity, so there is nothing to record as having been traded. '
        + 'Add sizing with a correction, or cancel it.',
      )
    }
    attested = true

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

  /*
   * The memory event is emitted from the evidence, never from the status.
   *
   * `provenance` carries which KIND of proof this was, so the Spine never
   * implies it observed something a person asserted. Dedupe is on the trade
   * id, so a trade already evidenced by the observed path cannot gain a
   * second execution event here.
   */
  if (attested) {
    const row = data as unknown as AcceptedTradeWithJoins
    const organizationId = await resolveOrganizationIdForPortfolio(row.portfolio_id)
    if (organizationId) {
      await recordExecutionRecorded({
        organizationId,
        actorId: context.actorId,
        acceptedTradeId: id,
        portfolioId: row.portfolio_id,
        assetId: row.asset_id,
        decisionRequestId: row.decision_request_id ?? null,
        tradeQueueItemId: row.trade_queue_item_id ?? null,
        proposalId: (row as any).proposal_id ?? null,
        action: row.action as TradeAction,
        provenance: 'attested:trader',
      })
    }
  }

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
          target: { stage: FINAL_STAGE, outcome: 'accepted' },
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
