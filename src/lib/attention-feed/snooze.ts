/**
 * Local snooze / defer for the dashboard bands — localStorage-backed.
 *
 * ── Why the key carries a user id ─────────────────────────────────────────
 *
 * It did not, and that was a real leak. The key was the constant
 * `tesseract.attentionFeedSnooze`, so every reader who signed in on a given
 * browser shared one snooze list: a PM deferring a decision on a shared
 * terminal hid it from the analyst who signed in next, and the analyst had no
 * way to see that it had happened or to get the item back.
 *
 * A disposition is user x object. The store has to be keyed that way even when
 * it lives in a browser, which is what `lib/signals/dispositions` already does
 * for the mobile feed — this brings the desktop store to the same rule rather
 * than inventing a second one.
 *
 * Entries written before this change live under the old key and are simply not
 * read. That is the correct migration: they are at most a few days of
 * deferrals whose provenance cannot be established — there is no record of who
 * wrote them — and re-showing a handful of cards is a much smaller harm than
 * attributing one reader's deferrals to another.
 *
 * Expiry is decided by `isPersonallySuppressed`, shared with `attention_user_state`
 * and the mobile feed, so a boundary case cannot be answered one way here and
 * another way there.
 */

import { deferUntil, isPersonallySuppressed } from '../signals/personal-suppression'

const LS_PREFIX = 'tesseract.attentionFeedSnooze'

interface SnoozeEntry {
  itemId: string
  until: number // epoch ms
}

/**
 * `null` for a signed-out reader, and every function below then no-ops.
 *
 * Writing to a shared key when the user is unknown is what created the leak;
 * refusing to write is the honest failure. Nothing on this surface is
 * reachable signed-out, so this is a guard rather than a supported mode.
 */
function storageKey(userId: string | null | undefined): string | null {
  return userId ? `${LS_PREFIX}:${userId}` : null
}

function loadEntries(userId: string | null | undefined): SnoozeEntry[] {
  const key = storageKey(userId)
  if (!key || typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveEntries(userId: string | null | undefined, entries: SnoozeEntry[]): void {
  const key = storageKey(userId)
  if (!key || typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(key, JSON.stringify(entries))
  } catch { /* noop */ }
}

/** Returns the set of item ids this reader currently has snoozed, pruning expired. */
export function getSnoozedIds(userId: string | null | undefined): Set<string> {
  const now = Date.now()
  const entries = loadEntries(userId)
  const active = entries.filter(e => isPersonallySuppressed({ snoozedUntil: e.until }, now))
  if (active.length !== entries.length) {
    saveEntries(userId, active)
  }
  return new Set(active.map(e => e.itemId))
}

/** Snooze an item for this reader, for a given duration. */
export function snoozeItem(userId: string | null | undefined, itemId: string, hours: number): void {
  if (!storageKey(userId)) return
  const entries = loadEntries(userId).filter(e => e.itemId !== itemId)
  entries.push({ itemId, until: deferUntil(hours, Date.now()) })
  saveEntries(userId, entries)
}

/** Snooze presets */
export const SNOOZE_PRESETS = [
  { label: '1 day', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '1 week', hours: 168 },
] as const

/** Remove this reader's snooze for an item. */
export function unsnoozeItem(userId: string | null | undefined, itemId: string): void {
  if (!storageKey(userId)) return
  saveEntries(userId, loadEntries(userId).filter(e => e.itemId !== itemId))
}
