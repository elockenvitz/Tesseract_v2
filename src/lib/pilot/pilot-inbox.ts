/**
 * Which decision requests a pilot can act on.
 *
 * ── Why ───────────────────────────────────────────────────────────────────
 *
 * A fresh pilot org is seeded with an AAPL recommendation waiting in the
 * Decision Inbox, and Pipeline basics step 2 sends the pilot to the Inbox. Three
 * pilots in a row accepted it believing they were deciding their own tutorial
 * idea. It executed a real trade on an unrelated idea, and — correctly — moved
 * neither the mission nor the unlocks, so the pilot was left confused.
 *
 * While a pilot has not graduated, a request is an EXAMPLE unless it is for the
 * tutorial idea itself: it stays visible, because seeing a recommendation is
 * the lesson of step 2, but it is marked as an example and nothing on it can
 * be accepted, rejected, deferred, re-sized or undone. The tutorial idea's own
 * request, if one exists, is a real decision and stays actionable.
 *
 * `effectiveIsPilot` is already `hasGraduated ? false : isPilot`, so graduated
 * pilots and non-pilots get every request as it was.
 *
 * Pure: no React, no Supabase.
 */
export interface PilotInboxGate {
  effectiveIsPilot: boolean
  tutorialIdeaId: string | null
}

export function isPilotExampleRequest(
  request: { trade_queue_item_id?: string | null },
  gate: PilotInboxGate,
): boolean {
  if (!gate.effectiveIsPilot) return false
  // No tutorial idea yet means nothing in the Inbox is the pilot's own.
  if (!gate.tutorialIdeaId) return true
  return request.trade_queue_item_id !== gate.tutorialIdeaId
}

/** Shown beside an example request. */
export const PILOT_EXAMPLE_HINT =
  'Example recommendation. Decide your own pilot idea in Trade Lab.'
