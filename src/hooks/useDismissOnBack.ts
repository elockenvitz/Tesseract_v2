import { useEffect, useRef } from 'react'

/**
 * Back closes the thing in front of you before it leaves the app.
 *
 * ── The defect this closes ────────────────────────────────────────────────
 *
 * The whole authenticated product lives at one URL. `App` mounts DashboardPage
 * under `/*`, tabs are sessionStorage state, and DashboardPage never touches
 * the router — so the entire application is a single history entry. Opening
 * the nav drawer, the notification sheet, the search overlay or any bottom
 * sheet added nothing to history, so the Android back gesture (the primary
 * back on a phone, not a nicety) took the user out of Tesseract from behind an
 * overlay they had opened a second earlier.
 *
 * ── What it does, and deliberately does not, do ───────────────────────────
 *
 * One history entry per open overlay, at the same URL, consumed again however
 * the overlay closes:
 *
 *   back with an overlay open   the overlay closes and the app stays
 *   back with nothing open      the app is left, exactly as before
 *   close by button or backdrop the entry is consumed, no stale step
 *
 * It does NOT put tabs in the URL. "Back from a detail returns to the list it
 * came from" requires the tab set to be addressable, which is a router
 * redesign rather than a compatibility fix. The boundary is written up in
 * `docs/mobile-back-navigation.md`.
 *
 * ── Why the raw History API and not the router ────────────────────────────
 *
 * Sheets are rendered outside a `<Router>` — the card gallery mounts
 * SignalCardView with no router at all — so a router hook here would either
 * throw there or have to be called conditionally. `pushState` preserves
 * whatever state react-router already put on the entry, including its `idx`,
 * so the router's own bookkeeping survives a push it did not make.
 */

/** Marks an entry as an overlay's rather than real navigation's. */
const OVERLAY_STATE_KEY = '__overlay'

let nextToken = 0

export interface DismissOnBackOptions {
  /**
   * Off for desktop. When false the hook never touches history at all, so a
   * dialog rendered on both form factors keeps its desktop behaviour exactly.
   */
  enabled?: boolean
}

function currentToken(): string | null {
  try {
    return (window.history.state as any)?.[OVERLAY_STATE_KEY] ?? null
  } catch {
    return null
  }
}

/**
 * @param open      whether the overlay is currently showing
 * @param onDismiss called when the user presses back; must close the overlay
 */
export function useDismissOnBack(
  open: boolean,
  onDismiss: () => void,
  { enabled = true }: DismissOnBackOptions = {},
): void {
  /** Our entry's token while we own one. */
  const token = useRef<string | null>(null)
  const onDismissRef = useRef(onDismiss)
  const openRef = useRef(open)

  onDismissRef.current = onDismiss
  openRef.current = open

  // Push one entry on open, and listen for it being popped.
  useEffect(() => {
    if (!enabled || !open) return
    if (typeof window === 'undefined' || !window.history?.pushState) return

    const mine = `overlay-${++nextToken}`
    token.current = mine

    try {
      window.history.pushState(
        { ...(window.history.state as object | null), [OVERLAY_STATE_KEY]: mine },
        '',
        window.location.href,
      )
    } catch {
      token.current = null
      return
    }

    const onPop = () => {
      // Our entry is still the current one, so what was popped sat ABOVE us —
      // a sheet opened on top of this drawer, say. Not ours to react to.
      if (currentToken() === mine) return
      token.current = null
      if (openRef.current) onDismissRef.current()
    }

    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [enabled, open])

  // Closing by button, backdrop or Escape consumes the entry, so a later back
  // press is not spent on an overlay that has already gone.
  useEffect(() => {
    if (open) return
    const mine = token.current
    if (mine === null) return

    token.current = null
    // Only if we are actually the top of the stack. Popping while something
    // else sits above us would dismiss THAT instead. A stranded entry costs
    // one extra back press; a wrong pop closes the wrong surface.
    if (currentToken() === mine) {
      try { window.history.back() } catch { /* nothing to go back to */ }
    }
  }, [open])
}
