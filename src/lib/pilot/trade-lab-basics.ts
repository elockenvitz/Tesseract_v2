/**
 * Trade Lab basics, step 1 — "add a trade from Ideas & recommendations".
 *
 * ── What counts ───────────────────────────────────────────────────────────
 *
 * A `simulation_trades` row the add mutation actually wrote that carries an
 * idea — any idea or recommendation. See `completesTradeLabStep1`. A manual
 * position has no idea at all and never counts.
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

/** Whether the written rows include the tutorial idea itself. */
export function addedTutorialIdea(
  rows: ReadonlyArray<AddedSimulationRow | null | undefined> | null | undefined,
  tutorialIdeaId: string | null | undefined,
): boolean {
  if (!tutorialIdeaId || !rows) return false
  return rows.some(r => !!r && r.trade_queue_item_id === tutorialIdeaId)
}

/**
 * Whether a written add completes the LOCAL Trade Lab basics step 1.
 *
 * The step teaches an action — put a trade from Ideas & recommendations into
 * the simulation — and a pilot may use ANY idea or recommendation for it, so
 * any row the write actually persisted with an idea on it counts: the tutorial
 * idea, a seeded idea, a recommendation. A manual position (no idea) never
 * does, and nothing counts without a written row.
 *
 */
export function completesTradeLabStep1(
  rows: ReadonlyArray<AddedSimulationRow | null | undefined> | null | undefined,
): boolean {
  return (rows ?? []).some(r => !!r && !!r.trade_queue_item_id)
}

/**
 * Tell the Trade Lab basics banner, if the rows earn it. Called from the add
 * mutations' success handlers only. Returns whether it fired.
 */
export function reportTradeLabStep1(
  rows: ReadonlyArray<AddedSimulationRow | null | undefined> | null | undefined,
  target: Pick<EventTarget, 'dispatchEvent'> = window,
): boolean {
  if (!completesTradeLabStep1(rows)) return false
  try { target.dispatchEvent(new CustomEvent(TRADE_LAB_STEP1_EVENT)) } catch { return false }
  return true
}

/** Step 1's instruction. Any idea works; the tutorial idea is named as one. */
export function tradeLabStep1Hint(symbol?: string | null): string {
  return `In Ideas & recommendations, tap Add to simulation on any idea or recommendation${symbol ? `, like ${symbol}` : ''}.`
}
