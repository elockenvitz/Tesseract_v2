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

/**
 * The legacy Dashboard lens tab types. Each renders the Dashboard shell on its
 * own lens (see DashboardPage and `LENS_FOR_TAB` in DashboardShell).
 */
export const DASHBOARD_LENS_TAB_TYPES: ReadonlySet<string> = new Set([
  'ideas-v2', 'research-v2', 'portfolio-v2', 'decisions-v2',
])

/**
 * Which tab type to render for a Dashboard lens tab.
 *
 * A pilot's Dashboard is the pilot home until they graduate — that is the
 * `today` branch in DashboardPage, which reads `effectiveIsPilot`
 * (`hasGraduated ? false : isPilot`). The four lens types had no such branch
 * and no pilot access entry, so a saved session or a deep link carrying
 * `ideas-v2` put the full Dashboard shell in front of a pilot on step 1.
 *
 * They go through the same gate rather than a new one: for a pilot who has not
 * graduated, a lens tab renders as the home. Anyone else, including a
 * graduated pilot, gets the type unchanged. Every other type — Pipeline, Trade
 * Lab, Trade Book, Outcomes — is returned as it is.
 */
export function dashboardTabTypeForRender(
  tabType: string,
  effectiveIsPilot: boolean,
  homeType: string,
): string {
  return effectiveIsPilot && DASHBOARD_LENS_TAB_TYPES.has(tabType) ? homeType : tabType
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
