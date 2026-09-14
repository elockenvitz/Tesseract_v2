/**
 * Trade Lab basics, step 1 — "the simulation gained the tutorial idea".
 *
 * ── What counts ───────────────────────────────────────────────────────────
 *
 * A `simulation_trades` row the add mutation actually wrote, whose
 * `trade_queue_item_id` is the pilot's tutorial idea. That covers both
 * acceptable actions with one fact, because both write that lineage:
 *
 *   - adding the tutorial idea itself writes its own id;
 *   - adding a recommendation raised on it writes the recommendation's source
 *     `trade_queue_item_id`, which is the tutorial idea.
 *
 * A seeded recommendation wraps a different trade_queue_item, so its row names
 * that item and does not count. A manual position has no idea at all.
 *
 * ── What does not ─────────────────────────────────────────────────────────
 *
 * Opening or expanding anything writes no row. A failed add never reaches
 * the rows. A removal is not an add. And the rows are the ones returned by the
 * write, not the object the client meant to send, so what counts is what the
 * database recorded.
 *
 * Pure: no React, no Supabase, no window.
 */

export const TRADE_LAB_STEP1_EVENT = 'pilot-tradelab:rec-reviewed'

export interface AddedSimulationRow {
  trade_queue_item_id?: string | null
}

export function addedTutorialIdea(
  rows: ReadonlyArray<AddedSimulationRow | null | undefined> | null | undefined,
  tutorialIdeaId: string | null | undefined,
): boolean {
  if (!tutorialIdeaId || !rows) return false
  return rows.some(r => !!r && r.trade_queue_item_id === tutorialIdeaId)
}

/**
 * Tell the Trade Lab basics banner, if the rows earn it. Called from the add
 * mutations' success handlers only. Returns whether it fired.
 */
export function reportTradeLabStep1(
  rows: ReadonlyArray<AddedSimulationRow | null | undefined> | null | undefined,
  tutorialIdeaId: string | null | undefined,
  target: Pick<EventTarget, 'dispatchEvent'> = window,
): boolean {
  if (!addedTutorialIdea(rows, tutorialIdeaId)) return false
  try { target.dispatchEvent(new CustomEvent(TRADE_LAB_STEP1_EVENT)) } catch { return false }
  return true
}

/** Step 1's instruction, naming the idea once it is known. */
export function tradeLabStep1Hint(symbol?: string | null): string {
  return `In Ideas & recommendations, tap Add to simulation on ${symbol || 'the idea you captured'} — the idea itself, or a recommendation made on it. Other recommendations don't count.`
}
