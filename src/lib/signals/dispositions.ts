import type { SignalType } from './contract'

/**
 * What a reader decided about a finding, and what that does to the feed.
 *
 * ── The question this answers ─────────────────────────────────────────────
 *
 * The response control and the capture sheet were doing the same thing. Both
 * ended in a note against a name, so "does AMT need work?" and the Capture
 * button were two routes to one outcome, and the response bar was the worse of
 * the two: fewer words, no editing, and a question the reader did not ask.
 *
 * The split that makes both worth having:
 *
 *   **Capture** is the reader's own thought, unprompted and unstructured. It
 *   answers "I want to write something down".
 *
 *   **A verdict** is a disposition of a finding the product raised. It answers
 *   "what should happen to this card", and the answer changes what the feed
 *   shows tomorrow. The note it writes is a record of the decision, not the
 *   point of it.
 *
 * A response bar that only wrote prose was the first thing wearing the second
 * thing's clothes. Once a verdict changes the feed it is doing work capture
 * cannot do, and the overlap disappears.
 *
 * ── Why localStorage ──────────────────────────────────────────────────────
 *
 * Same reasoning as `feed-rotation`: this is a presentation concern, it must
 * not cost a round-trip on open, and losing it costs the reader one repeated
 * card rather than any real state. The *content* of a decision that matters —
 * "this needs work" — goes to the capture sheet and is persisted properly; what
 * lives here is only the feed's memory of having asked.
 *
 * The contract has anticipated this since it was written: `SuppressionReason`
 * carries a `snoozed` member described as "user snoozed this type+entity and
 * the condition has not fired". This is that member becoming real.
 */

const KEY_PREFIX = 'tesseract:signal-disposition:'
/** Bounded like the seen map, for the same reason. */
const MAX_TRACKED = 400

/**
 * What the reader decided.
 *
 * `settled` — looked at, no action needed. The finding is correct and handled.
 * `flagged` — real, and it needs work. Stays visible; the work goes to capture.
 * `rejected` — not a useful finding for this name. The strongest signal, and
 *              the one worth listening to hardest, because a proactive surface
 *              that cannot be told it is wrong trains people to ignore it.
 */
export type DispositionKind = 'settled' | 'flagged' | 'rejected'

export interface Disposition {
  kind: DispositionKind
  /** The option the reader chose, for provenance. */
  verdict: string
  /** Epoch ms after which the finding may appear again. */
  until: number
  at: number
}

export type DispositionMap = Record<string, Disposition>

/**
 * type + entity, and deliberately NOT the card's `dedupeKey`.
 *
 * `dedupeKey` carries a trigger period — usually the day — because it exists to
 * identify the same claim RECURRING. A disposition has to outlive that: telling
 * the feed "AAPL's coverage gap is handled" and seeing the identical card
 * tomorrow under a new day key is exactly the failure this is meant to fix.
 */
export function dispositionKey(type: SignalType, entityId: string): string {
  return `${type}:${entityId}`
}

function storageKey(userId: string) {
  return `${KEY_PREFIX}${userId}`
}

export function loadDispositions(userId: string): DispositionMap {
  if (typeof localStorage === 'undefined' || !userId) return {}
  try {
    const raw = localStorage.getItem(storageKey(userId))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as DispositionMap
    const now = Date.now()
    // Expired entries are dropped on read, so the map cannot grow through keys
    // nobody revisits.
    return Object.fromEntries(Object.entries(parsed).filter(([, d]) => d.until > now))
  } catch {
    return {}
  }
}

export function recordDisposition(
  userId: string,
  type: SignalType,
  entityId: string,
  d: Omit<Disposition, 'at'>,
): void {
  if (typeof localStorage === 'undefined' || !userId) return
  try {
    const map = loadDispositions(userId)
    map[dispositionKey(type, entityId)] = { ...d, at: Date.now() }
    const trimmed = Object.entries(map)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX_TRACKED)
    localStorage.setItem(storageKey(userId), JSON.stringify(Object.fromEntries(trimmed)))
  } catch {
    /* storage full or unavailable — a disposition is a nicety, never a failure */
  }
}

/**
 * Whether this finding should stay out of the feed.
 *
 * `flagged` is deliberately NOT suppressed. The reader said the finding is real
 * and needs work; hiding it at that moment would be the surface congratulating
 * itself for raising something and then removing the reminder. It comes back
 * until the underlying condition changes, which is the only honest resolution.
 */
export function isDisposedOf(
  map: DispositionMap,
  type: SignalType,
  entityId: string,
  now: number = Date.now(),
): boolean {
  const d = map[dispositionKey(type, entityId)]
  if (!d) return false
  if (d.kind === 'flagged') return false
  return d.until > now
}

/** How long each decision buys, in days. */
export const DISPOSITION_DAYS: Record<DispositionKind, number> = {
  // Long enough to mean "handled", short enough that a position nobody revisits
  // resurfaces within a quarter.
  settled: 90,
  // Not suppressed at all; the value is here so the shape stays uniform.
  flagged: 0,
  // Longest, because being told the finding is wrong for this name is the
  // strongest signal available and the surface should act like it heard it.
  rejected: 180,
}

/** "Won't come back for 90 days" — shown BEFORE the reader commits. */
export function consequenceOf(kind: DispositionKind): string {
  switch (kind) {
    case 'settled':
      return `Clears this from your feed for ${DISPOSITION_DAYS.settled} days.`
    case 'flagged':
      return 'Keeps it in your feed and opens a note so the work is written down.'
    case 'rejected':
      return `Stops this kind of card appearing for this name for ${DISPOSITION_DAYS.rejected} days.`
  }
}
