/**
 * Local snooze / defer — localStorage-backed, no backend changes.
 *
 * Stores snoozed item IDs with expiration timestamps.
 * Expired entries are pruned on read.
 */

const LS_KEY = 'tesseract.attentionFeedSnooze'

interface SnoozeEntry {
  itemId: string
  until: number // epoch ms
}

function loadEntries(): SnoozeEntry[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveEntries(entries: SnoozeEntry[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(entries))
  } catch { /* noop */ }
}

/** Returns set of currently snoozed item IDs (pruning expired) */
export function getSnoozedIds(): Set<string> {
  const now = Date.now()
  const entries = loadEntries()
  const active = entries.filter(e => e.until > now)
  if (active.length !== entries.length) {
    saveEntries(active)
  }
  return new Set(active.map(e => e.itemId))
}

/** Snooze an item for a given duration */
export function snoozeItem(itemId: string, hours: number): void {
  const entries = loadEntries().filter(e => e.itemId !== itemId)
  entries.push({ itemId, until: Date.now() + hours * 3600000 })
  saveEntries(entries)
}

/** Snooze presets */
export const SNOOZE_PRESETS = [
  { label: '1 day', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '1 week', hours: 168 },
] as const

/** Remove snooze for an item */
export function unsnoozeItem(itemId: string): void {
  const entries = loadEntries().filter(e => e.itemId !== itemId)
  saveEntries(entries)
}
