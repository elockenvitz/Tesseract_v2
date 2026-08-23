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

  /**
   * Show a count per feed stage, above the first card.
   *
   * A phone has no console and no network tab, so "the query returned
   * nothing", "the ranking buried it" and "I am on a cached bundle" are
   * indistinguishable from the reader's side — which is how one question got
   * five different correct answers and stayed open.
   *
   * Uses the flag mechanism rather than a bare `?debug=1` for the reason the
   * comment in `main.tsx` already gives: the root route redirects with
   * `<Navigate replace />`, which drops the query string before any screen
   * mounts. A latch inside the feed ran too late, twice.
   */
  | 'feed-debug'

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
 * Called from `main.tsx` before React mounts, NOT lazily from the screen that
 * uses the flag. The root route redirects with `<Navigate to="/dashboard"
 * replace />`, which discards the query string — so a flag read from inside
 * the feed happens after the parameter is already gone, and the flag silently
 * never sets. That shipped once and meant the flag was never on for anyone.
 */
export function syncFlagsFromUrl(): Set<string> {
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
  if (cached === null) cached = syncFlagsFromUrl()
  return cached.has(name)
}

/** Testing seam. */
export function __resetFlags(): void {
  cached = null
}
