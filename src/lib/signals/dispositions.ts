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
/**
 * A FEED state. Not a business state, and it must never become one.
 *
 * ── The complete list of things that read this ────────────────────────────
 *
 * Audited 2026-08-19, and worth re-checking before adding a fourth:
 *
 *   1. `isDisposedOf` — should the card be hidden
 *   2. `DISPOSITION_DAYS` — for how long
 *   3. `consequenceOf` — the sentence shown before the reader commits
 *
 * That is all of it. No pricing, coverage, workflow or research code reads
 * `kind`, and none should. The reason matters: several semantic judgments
 * legitimately share a state, and the state carries none of their meaning.
 *
 *   `not_price_driven → settled` does NOT mean a target was set, that
 *   valuation work is complete, or that any process was satisfied. It means
 *   the reader answered, so stop asking for 90 days.
 *
 *   `owned_elsewhere → settled` does NOT mean the research exists or the
 *   coverage question is resolved globally. Somebody else owns it; that is a
 *   routing fact, and this feed has stopped asking THIS reader.
 *
 *   `defer → settled` does NOT mean the work is done.
 *
 *   `no_longer_covered → settled` must not stand in the way of a future
 *   coverage cleanup, which is a different system reading different data.
 *
 *   `not_relevant → rejected` on a news or market card is FEED FEEDBACK, not
 *   an investment conclusion. It carries `intent: 'feed_quality'`, and
 *   anything reading judgments back must filter on that or it will count
 *   complaints about the surface as research about the position.
 *
 * Anything that wants to know what the analyst actually decided reads
 * `Disposition.key`, or `metadata.judgment_key` on the durable audit row.
 */
export type DispositionKind = 'settled' | 'flagged' | 'rejected'

/**
 * The record schema version.
 *
 * Records written before Phase 3 carry no `v`, no `key` and no `question`. They
 * are still valid for the only thing the feed reads them for — whether a
 * finding is suppressed — so they are not migrated or discarded. Readers that
 * want the semantic judgment must tolerate its absence, which is what
 * `judgmentOf` is for.
 */
export const DISPOSITION_SCHEMA = 2

export interface Disposition {
  /**
   * The generic feed state. Governs suppression and nothing else.
   *
   * Three states cannot express what an analyst actually decided, and they were
   * never meant to: `settled` covers "the thesis is intact" and "this position
   * is deliberately not price-driven", which are different answers to different
   * questions that happen to have the same consequence for the feed. Keep this
   * for what it does and read `key` for what the reader meant.
   */
  kind: DispositionKind

  /**
   * The semantic judgment: `thesis_intact`, `cases_outdated`, `not_price_driven`.
   *
   * This is the field that carries meaning, and the reason Phase 3 needed no
   * migration: a free-text slot for the chosen option already existed as
   * `verdict`, documented as incidental provenance. Promoting it to a stable
   * contract cost a rename and a doc comment.
   *
   * Two options mapping to the same `kind` remain distinguishable here, which
   * is the whole requirement: `cases_outdated` and `thesis_weaker` are both
   * `flagged` to the feed and are not the same thing to a research process.
   */
  key: string

  /** @deprecated Pre-Phase-3 alias of `key`, still written so a reader on the
   *  old shape does not see an empty field. Read `key`. */
  verdict: string

  /** What the reader saw on the button, so an audit does not need the builder
   *  that produced it. Labels get reworded; a stored answer should not become
   *  unreadable when they do. */
  label?: string
  /** The question that was asked. A judgment is only interpretable against it:
   *  "Needs review" answers something different on a stale target than on an
   *  unpriced position. */
  question?: string
  /** Which card type asked. */
  cardType?: string
  /** Schema version. Absent on pre-Phase-3 records. */
  v?: number

  /** Epoch ms after which the finding may appear again. */
  until: number
  at: number
}

/**
 * The semantic judgment, when the record carries one.
 *
 * Returns null for pre-Phase-3 records rather than guessing: inferring
 * `thesis_intact` from `kind: 'settled'` would fabricate a specific answer out
 * of a generic state, and be wrong for every card whose `settled` option meant
 * something else.
 */
export function judgmentOf(d: Disposition | undefined): {
  key: string; label?: string; question?: string; cardType?: string
} | null {
  if (!d) return null
  const key = d.key ?? d.verdict
  if (!key) return null
  return { key, label: d.label, question: d.question, cardType: d.cardType }
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

/**
 * Write a judgment, and say whether it stuck.
 *
 * Returns false rather than throwing when storage is unavailable — private
 * browsing, a full quota, a disabled origin. The caller needs to know, because
 * a response control that shows a confident selected state over a write that
 * silently failed is worse than one that admits it: the reader believes they
 * have answered, the card returns tomorrow, and they stop trusting the row.
 *
 * It was previously a swallowed try/catch on the reasoning that "a disposition
 * is a nicety, never a failure". That was true when the only consequence was
 * feed ordering. It stopped being true once the tap became the product's record
 * of what an analyst decided.
 */
export function recordDisposition(
  userId: string,
  type: SignalType,
  entityId: string,
  d: Omit<Disposition, 'at' | 'verdict' | 'v'> & { verdict?: string },
): boolean {
  if (typeof localStorage === 'undefined' || !userId) return false
  try {
    const map = loadDispositions(userId)
    map[dispositionKey(type, entityId)] = {
      ...d,
      // Written for readers still on the old shape. `key` is the contract.
      verdict: d.verdict ?? d.key,
      v: DISPOSITION_SCHEMA,
      at: Date.now(),
    }
    const trimmed = Object.entries(map)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX_TRACKED)
    localStorage.setItem(storageKey(userId), JSON.stringify(Object.fromEntries(trimmed)))
    return true
  } catch {
    return false
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

/**
 * How long a judgment is RETAINED, in days. Not how long it suppresses.
 *
 * ── The bug this comment exists to prevent recurring ──────────────────────
 *
 * `flagged` was 0, on the reasoning that a flagged finding is not suppressed so
 * the window did not matter. It mattered enormously: `until` is also the
 * retention key, and `loadDispositions` drops every record whose `until` has
 * passed. A flagged judgment was therefore written with `until = now` and
 * discarded on the very next read — and `flagged` is where the most ordinary
 * answers on the surface land. Thesis weaker, Cases outdated, Needs review,
 * Revise target, Needs update: every one of them was recorded and immediately
 * forgotten.
 *
 * Suppression and retention are separate concerns and are now separately
 * expressed. `isDisposedOf` decides visibility, and it returns false for
 * `flagged` regardless of this value; these numbers only decide how long the
 * answer is remembered.
 */
export const DISPOSITION_DAYS: Record<DispositionKind, number> = {
  // Long enough to mean "handled", short enough that a position nobody revisits
  // resurfaces within a quarter.
  settled: 90,
  // Retained as long as a settled answer, and suppressed for none of it. The
  // card keeps appearing — the reader said it needs work — while the record of
  // what they said survives.
  flagged: 90,
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
