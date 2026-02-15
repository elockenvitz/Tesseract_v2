/**
 * Shared dismissal helpers for decision engine intel items.
 *
 * Same localStorage key across all surfaces (Dashboard, Asset, Portfolio)
 * so dismissing on one surface hides the item everywhere.
 */

const LS_KEY_PREFIX = 'tesseract.dismissedIntelItems.'

export function getDismissedIds(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(`${LS_KEY_PREFIX}${userId}`)
    return new Set(raw ? JSON.parse(raw) : [])
  } catch {
    return new Set()
  }
}

export function isDismissed(userId: string, itemId: string): boolean {
  return getDismissedIds(userId).has(itemId)
}

export function dismiss(userId: string, itemId: string): void {
  try {
    const ids = getDismissedIds(userId)
    ids.add(itemId)
    localStorage.setItem(
      `${LS_KEY_PREFIX}${userId}`,
      JSON.stringify([...ids]),
    )
  } catch { /* noop */ }
}

export function resetDismissals(userId: string): void {
  try {
    localStorage.removeItem(`${LS_KEY_PREFIX}${userId}`)
  } catch { /* noop */ }
}
