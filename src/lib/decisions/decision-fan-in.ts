/**
 * When does a decision on ONE portfolio conclude the IDEA?
 *
 * ── Why this is shared ───────────────────────────────────────────────────
 *
 * An idea can be recommended into several portfolios at once, and each gets
 * its own `trade_idea_portfolios` track. The idea itself is only concluded
 * when every track is resolved — otherwise the first PM to decide would drop
 * the card off the board for PMs who still have to.
 *
 * That rule was implemented three times and the three disagreed:
 *
 *   accepted-trade-service  scanned all tracks, wrote `outcome`
 *   execute-sim-variants    excluded the current portfolio, wrote `status`
 *                           only — leaving `outcome` NULL
 *   trade-lab-service       wrote `status` only — same gap
 *
 * `status` is DERIVED from `stage` + `outcome` (`stageToLegacyStatus`), so
 * writing it directly is writing to a cache. Two of the three did exactly
 * that, which is the drift this module exists to end.
 *
 * ── Why it must be observable ────────────────────────────────────────────
 *
 * The accept path wrapped its advance in `try { } catch { console.error }`.
 * A real production acceptance (SHOP, 2026-10-04 16:08) left
 * `trade_queue_items.updated_at` at 16:07:56 — the row was never written —
 * and the database carries no record of why. Three different failures land
 * in exactly that state: an idempotency short-circuit returns silently, a
 * throw is swallowed to the console, and a zero-row RLS update reports
 * nothing at all.
 *
 * So this returns a result instead of swallowing one. Callers decide whether
 * a failed advance should surface; none of them may be unable to tell.
 *
 * ── What it does NOT do ──────────────────────────────────────────────────
 *
 * It never touches `stage`. `stage` is MATURITY — how far the research got —
 * and `ready_to_recommend` is deliberately its last value. Concluding a
 * decision is the LIVENESS axis, which is `outcome`. Writing a stage here
 * would be a lie about the research, and `stage-model.test.ts` actively
 * forbids inventing a post-decision stage.
 */

import { supabase } from '../supabase'
import { moveTradeIdea } from '../services/trade-idea-service'
import { FINAL_STAGE } from '../ideas/stage-model'
import { emitAuditEvent } from '../audit/audit-service'
import type { TradeOutcome } from '../../types/trading'
import type { ActionContext } from '../../types/trading'

/**
 * Leave a durable trace when a committed decision fails to conclude its idea.
 *
 * Returning the reason was half the job, and the half that was already done.
 * Every caller then `console.error`'d it, so the production diagnosis for
 * SHOP and GOOGL had to be reconstructed from constraint definitions weeks
 * later — the database held the stranded idea and no statement of why.
 *
 * Best-effort and never throws: the trade is already committed and the
 * decision already recorded, so failing to write the note about a failure
 * must not fail the operation on top of it.
 */
async function recordConclusionFailure(args: {
  tradeQueueItemId: string
  outcome: string
  reason: string
  context: ActionContext
}): Promise<void> {
  try {
    await emitAuditEvent({
      entity: { type: 'trade_idea', id: args.tradeQueueItemId },
      action: { type: 'conclude_failed', category: 'state_change' },
      // The idea did not move, so there is no "to" state to claim.
      state: { from: { outcome: null }, to: null },
      metadata: {
        intended_outcome: args.outcome,
        reason: args.reason,
        // The trade and the decision DID succeed. Says so explicitly, so a
        // reader of this event does not go looking for a lost trade.
        trade_committed: true,
      },
      actorName: args.context.actorName,
    })
  } catch (e) {
    console.error('[FanIn] Could not record the conclusion failure:', e)
  }
}

export type FanInResult =
  /** Every track resolved and the idea was concluded. */
  | { status: 'concluded'; outcome: TradeOutcome }
  /** At least one portfolio still owes a decision; the idea stays live. */
  | { status: 'still_open'; openPortfolioIds: string[] }
  /** The advance was attempted and did not happen. Never silent. */
  | { status: 'failed'; reason: string }

/**
 * Conclude the idea if, and only if, every portfolio track is resolved.
 *
 * `outcome` is the terminal value for the idea as a whole: `'executed'` once
 * an accept has produced a committed trade, `'rejected'` when every track
 * was declined. Both derive their `status` automatically, and any non-null
 * outcome removes the idea from every active pipeline surface.
 */
export async function resolveIdeaAfterDecision(args: {
  tradeQueueItemId: string | null | undefined
  outcome: Extract<TradeOutcome, 'executed' | 'rejected'>
  context: ActionContext
  note: string
}): Promise<FanInResult> {
  const { tradeQueueItemId, outcome, context, note } = args

  if (!tradeQueueItemId) {
    // No id to attach an audit event to, so this one stays in the result only.
    return { status: 'failed', reason: 'The decision is not linked to a trade idea.' }
  }

  /**
   * Every failure after this point leaves a durable record before returning.
   *
   * One helper rather than three call sites, so a future fourth failure path
   * cannot be added silently — which is how the original `console.error`
   * survived as the only trace for as long as it did.
   */
  const fail = async (reason: string): Promise<FanInResult> => {
    await recordConclusionFailure({ tradeQueueItemId, outcome, reason, context })
    return { status: 'failed', reason }
  }

  const { data: tracks, error: tracksErr } = await supabase
    .from('trade_idea_portfolios')
    .select('portfolio_id, decision_outcome')
    .eq('trade_queue_item_id', tradeQueueItemId)

  if (tracksErr) {
    return fail(`Could not read portfolio tracks: ${tracksErr.message}`)
  }

  /*
   * An idea with NO tracks at all is concluded by this decision.
   *
   * Absence is not an open track — it means nobody ever fanned this idea
   * out per portfolio, so the single decision just made is the whole story.
   * The production SHOP idea is exactly this shape: zero rows in
   * `trade_idea_portfolios`.
   */
  const open = (tracks ?? [])
    .filter(t => (t as { decision_outcome: string | null }).decision_outcome == null)
    .map(t => (t as { portfolio_id: string }).portfolio_id)

  if (open.length > 0) {
    return { status: 'still_open', openPortfolioIds: open }
  }

  try {
    await moveTradeIdea({
      tradeId: tradeQueueItemId,
      // Stage unchanged — this records a decision, it does not promote work.
      target: { stage: FINAL_STAGE, outcome },
      context,
      note,
    })
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }

  /*
   * Confirm the write actually landed.
   *
   * `moveTradeIdea` resolves without error in two cases where nothing was
   * written: an idempotency short-circuit, and an UPDATE that RLS filtered
   * to zero rows (PostgREST reports no error for that). Both are invisible
   * otherwise, and both happened or could have happened in production. The
   * only way to know is to read the row back.
   */
  const { data: after, error: readErr } = await supabase
    .from('trade_queue_items')
    .select('outcome')
    .eq('id', tradeQueueItemId)
    .maybeSingle()

  if (readErr) {
    return fail(`Could not confirm the idea was concluded: ${readErr.message}`)
  }
  if ((after as { outcome: string | null } | null)?.outcome !== outcome) {
    return fail(
      'The idea was not concluded: the update reported success but the row is unchanged. '
      + 'This is usually a permissions filter or a repeated request id.',
    )
  }

  return { status: 'concluded', outcome }
}
