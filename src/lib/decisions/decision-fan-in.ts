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
import type { TradeOutcome } from '../../types/trading'
import type { ActionContext } from '../../types/trading'

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
    return { status: 'failed', reason: 'The decision is not linked to a trade idea.' }
  }

  const { data: tracks, error: tracksErr } = await supabase
    .from('trade_idea_portfolios')
    .select('portfolio_id, decision_outcome')
    .eq('trade_queue_item_id', tradeQueueItemId)

  if (tracksErr) {
    return { status: 'failed', reason: `Could not read portfolio tracks: ${tracksErr.message}` }
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
    return { status: 'failed', reason: e instanceof Error ? e.message : String(e) }
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
    return { status: 'failed', reason: `Could not confirm the idea was concluded: ${readErr.message}` }
  }
  if ((after as { outcome: string | null } | null)?.outcome !== outcome) {
    return {
      status: 'failed',
      reason:
        'The idea was not concluded: the update reported success but the row is unchanged. '
        + 'This is usually a permissions filter or a repeated request id.',
    }
  }

  return { status: 'concluded', outcome }
}
