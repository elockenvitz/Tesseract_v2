/**
 * Trade Lab basics, step 1 — "add a trade from Ideas & recommendations".
 *
 * ── What counts ───────────────────────────────────────────────────────────
 *
 * A `simulation_trades` row the add mutation actually wrote, that came from a
 * recommendation, or whose `trade_queue_item_id` is the pilot's tutorial idea.
 * See `completesTradeLabStep1` for why a seeded recommendation now teaches the
 * local step while the global mission still follows only the tutorial idea.
 * A manual position has no idea at all and never counts.
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
 * Whether a written add completes the LOCAL Trade Lab basics step 1.
 *
 * The step teaches an action — put a trade from Ideas & recommendations into
 * the simulation — so any recommendation the write actually persisted counts,
 * seeded or not. A plain idea counts when it is the tutorial idea. A manual
 * position (no idea) never does, and nothing counts without a written row.
 *
 * This is the banner's step only. The global mission does not listen to it: it
 * reads `simulation_trades` and decisions for the tutorial idea id directly
 * (`usePilotMission`), so an unrelated recommendation teaching the action here
 * cannot satisfy the mission's simulation or decision facts.
 */
export function completesTradeLabStep1(
  rows: ReadonlyArray<AddedSimulationRow | null | undefined> | null | undefined,
  tutorialIdeaId: string | null | undefined,
  options: { fromRecommendation?: boolean } = {},
): boolean {
  const written = (rows ?? []).filter((r): r is AddedSimulationRow => !!r)
  if (written.length === 0) return false
  if (options.fromRecommendation && written.some(r => !!r.trade_queue_item_id)) return true
  return addedTutorialIdea(written, tutorialIdeaId)
}

/**
 * Tell the Trade Lab basics banner, if the rows earn it. Called from the add
 * mutations' success handlers only. Returns whether it fired.
 */
export function reportTradeLabStep1(
  rows: ReadonlyArray<AddedSimulationRow | null | undefined> | null | undefined,
  tutorialIdeaId: string | null | undefined,
  options: { fromRecommendation?: boolean } = {},
  target: Pick<EventTarget, 'dispatchEvent'> = window,
): boolean {
  if (!completesTradeLabStep1(rows, tutorialIdeaId, options)) return false
  try { target.dispatchEvent(new CustomEvent(TRADE_LAB_STEP1_EVENT)) } catch { return false }
  return true
}

/** Step 1's instruction, naming the tutorial idea once it is known. */
export function tradeLabStep1Hint(symbol?: string | null): string {
  return `In Ideas & recommendations, tap Add to simulation on a recommendation${symbol ? ` or on ${symbol}` : ''}.`
}
