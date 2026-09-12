/**
 * Whether the shell should hold a loader instead of painting the active tab.
 *
 * ── The defect this exists to prevent ────────────────────────────────────
 *
 * The rule was one line, and it asked the wrong question. It held whenever
 * the reader might be a pilot AND the active tab was hidden in
 * `PILOT_ACCESS_DEFAULTS`. That was safe only while every default-hidden
 * surface stayed hidden for the whole pilot, because the route guard would
 * then move them off it and the hold would end with the tab.
 *
 * Coverage now opens once a pilot has declared some. A pilot sitting on the
 * Coverage tab was therefore held by a rule reading a default that no longer
 * described them, waiting for a route guard that was never going to fire. The
 * page loaded forever.
 *
 * ── The two questions ────────────────────────────────────────────────────
 *
 * `hiddenByDefaults` answers "would this tab be hidden if this turns out to be
 * a pilot", which is the only thing available before the decision resolves and
 * exactly what the pre-decision hold needs.
 *
 * `hiddenForThisPilot` answers "is it hidden for this reader right now", from
 * the resolved access map including unlocks. That is what says the route guard
 * is about to move them, and it is the only one allowed to hold after the
 * decision is in — because it can become false, and a default cannot.
 *
 * Pure: no React, no queries.
 */
export interface PilotTabGateInput {
  /** Is `users.current_organization_id` resolved yet? */
  orgKnown: boolean
  /** Is the pilot-flags query still in flight? */
  pilotLoading: boolean
  /** The resolved answer, once there is one. */
  isPilot: boolean
  /** Hidden for a pilot under the static defaults. */
  hiddenByDefaults: boolean
  /** Hidden for THIS pilot under the resolved access map. */
  hiddenForThisPilot: boolean
}

export function shouldHoldForPilotDecision(input: PilotTabGateInput): boolean {
  const { orgKnown, pilotLoading, isPilot, hiddenByDefaults, hiddenForThisPilot } = input

  // Undecided, and this tab would be hidden if the answer is "pilot". Hold, or
  // it paints for a frame before the guard swaps it.
  if ((!orgKnown || pilotLoading) && hiddenByDefaults) return true

  // Decided, they are a pilot, and this tab really is closed to them. The
  // route guard is mid-swap and this covers the render in between. It
  // terminates, because the guard changes the active tab.
  return isPilot && hiddenForThisPilot
}
