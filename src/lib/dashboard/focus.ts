/**
 * Entering Dashboard Focus Mode.
 *
 * ── The bug this exists to kill ──────────────────────────────────────────
 *
 * Today's "Review thesis" built a TAB DESCRIPTOR and dispatched it on the
 * shell's channel, so clicking it left the Dashboard entirely and opened a
 * second surface. Every Dashboard action had the same shape available to it,
 * and the shape was wrong: a Dashboard action is not navigation.
 *
 * ── Browse, focus, deep — three things, not two ──────────────────────────
 *
 * BROWSE and FOCUS are two states of ONE Dashboard tab. A tile click, a
 * primary action on a Today card, an Up Next swap: all of these move between
 * those two states and none of them creates a tab.
 *
 * DEEP is the third thing, and it is the only one that may open or reuse a
 * top-level work tab -- reached exclusively by an explicit "Open full Asset",
 * "Open Idea pipeline" or "Open Portfolio tooling". `openAsset` and its
 * siblings stay exactly as they are; they are simply no longer what a
 * Dashboard action calls.
 *
 * ── Not routing ─────────────────────────────────────────────────────────
 *
 * No new tab type, no tab per issue, no URL space. One event, carrying enough
 * for the destination lens to say what the reader clicked and why.
 */

/** Which lens owns this issue. Focus always resolves inside one. */
export type DashboardLensId = 'today' | 'ideas' | 'research' | 'portfolio' | 'decisions'

export interface DashboardFocusTarget {
  lens: DashboardLensId
  /** What kind of object the lens should select. */
  objectType: 'asset' | 'idea' | 'position' | 'decision'
  objectId: string
  symbol?: string | null
  label?: string | null
  /** Book context, where the issue is exposure-shaped. */
  portfolioId?: string | null
  portfolioName?: string | null
  /** Why it surfaced. The workspace states this rather than re-deriving it. */
  issue?: string | null
  /** Which lens or surface raised it. */
  origin?: string | null
  /** Where it sat in the ranking that surfaced it, when that is meaningful. */
  rank?: number | null
}

export const DASHBOARD_FOCUS_EVENT = 'tesseract:dashboard-focus' as const

/**
 * Ask the Dashboard to focus an issue, in place.
 *
 * One dispatch, deliberately -- unlike the deep-handoff seams, there is no tab
 * descriptor here, because producing one is exactly the mistake this replaces.
 */
export function openDashboardFocus(target: DashboardFocusTarget): boolean {
  if (typeof window === 'undefined') return false
  if (!target?.objectId || !target?.lens) return false
  window.dispatchEvent(
    new CustomEvent<DashboardFocusTarget>(DASHBOARD_FOCUS_EVENT, { detail: target }),
  )
  return true
}

export function subscribeToDashboardFocus(
  handler: (t: DashboardFocusTarget) => void,
): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<DashboardFocusTarget>).detail
    if (!detail?.objectId || !detail?.lens) return
    handler(detail)
  }
  window.addEventListener(DASHBOARD_FOCUS_EVENT, listener)
  return () => window.removeEventListener(DASHBOARD_FOCUS_EVENT, listener)
}

/**
 * Which Dashboard issues Today can resolve without leaving.
 *
 * Everything else on a Today card -- raising an idea, opening a simulation,
 * filtering the trade queue -- is operational work the deep product owns, and
 * still goes through the shared dispatcher untouched. That dispatcher is also
 * used by the Asset page, the old Dashboard and the Action Center, so it is
 * read here and never modified.
 */
export const TODAY_FOCUS_ACTIONS: Record<string, DashboardLensId> = {
  OPEN_ASSET_UPDATE_THESIS: 'research',
  OPEN_ASSET_REVIEW_SEQUENCE: 'research',
}
