/**
 * Feature flags you can turn on from a phone.
 *
 * There is no settings screen for these and there should not be one — a flag
 * that needs a UI is a flag that has outlived its purpose. Toggling is done by
 * URL, which works on a phone, in a branch deploy, and over a link somebody
 * sends you:
 *
 *   ?flag=signal-cards      turn on, persists
 *   ?flag=-signal-cards     turn off, persists
 *   ?flag=none              clear everything
 *
 * The parameter is consumed on read and the value persists in localStorage, so
 * the flag survives navigation and app restarts without leaving a query string
 * behind to be shared by accident.
 */

const KEY = 'tesseract:flags'

export type FlagName =
  /**
   * Render active risk, recommendation and news through the signal card
   * contract and SignalCardView. The other four feed kinds keep their legacy
   * tiles.
   *
   * This is a deliberate temporary state with an exit, not a resting place:
   * the exit is the remaining four builders, after which the legacy tile
   * components are deleted in one PR and this flag goes with them.
   */
  | 'signal-cards'

function read(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function write(set: Set<string>): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify([...set]))
  } catch {
    /* a flag failing to persist must never break the app */
  }
}

/**
 * Apply any `?flag=` in the current URL, then report the active set.
 *
 * Called from `isFlagOn` rather than at module load so that a flag set by URL
 * takes effect on the first render that asks for it, including on a cold start
 * where the app mounts before any effect runs.
 */
function syncFromUrl(): Set<string> {
  const flags = read()
  if (typeof window === 'undefined') return flags
  const param = new URLSearchParams(window.location.search).get('flag')
  if (!param) return flags

  let changed = false
  for (const token of param.split(',').map(t => t.trim()).filter(Boolean)) {
    if (token === 'none') {
      flags.clear()
      changed = true
    } else if (token.startsWith('-')) {
      changed = flags.delete(token.slice(1)) || changed
    } else if (!flags.has(token)) {
      flags.add(token)
      changed = true
    }
  }
  if (changed) write(flags)

  // Strip the parameter so the flag is not carried into a shared link. The
  // state now lives in localStorage; leaving it in the URL would silently turn
  // the flag on for whoever the link is sent to.
  const url = new URL(window.location.href)
  url.searchParams.delete('flag')
  window.history.replaceState({}, '', url.toString())

  return flags
}

let cached: Set<string> | null = null

export function isFlagOn(name: FlagName): boolean {
  if (cached === null) cached = syncFromUrl()
  return cached.has(name)
}

/** Testing seam. */
export function __resetFlags(): void {
  cached = null
}
