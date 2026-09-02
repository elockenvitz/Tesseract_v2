/**
 * Has THIS reader already dealt with this object, and until when?
 *
 * ── Why this is one function ──────────────────────────────────────────────
 *
 * The product had four stores answering that question and three different
 * arithmetics for reading them back:
 *
 *   1. `attention_user_state` — a row per user per attention id, carrying
 *      `dismissed_at` and `snoozed_until`. Read inline in `useAttention`.
 *   2. `lib/signals/dispositions` — the mobile feed's own memory, keyed by
 *      user, holding an `until` per finding.
 *   3. `lib/attention-feed/snooze` — a localStorage list of `{ itemId, until }`
 *      for the desktop dashboard bands.
 *   4. `trade_queue_items.revisit_at` — which is not personal at all. See the
 *      note on `deferTradeIdea`.
 *
 * The first three mean the same thing and are the same shape. Nothing about
 * "the reader deferred this until Thursday" differs between a trade decision on
 * the desktop dashboard and a scenario gap on the phone, so the boundary
 * conditions should not be re-decided per store — and they were being decided
 * differently: one used `>`, one used `>=`, one compared `Date` objects and one
 * compared epoch numbers, and only two of them handled a malformed timestamp.
 *
 * ── What this deliberately is NOT ─────────────────────────────────────────
 *
 * Not a store, not a hook, not a sync layer, and not a schema. It reads a
 * record somebody else loaded and answers one question about it. Where the
 * record lives, how it is keyed, and whether it survives a device change are
 * all still decided by the caller, because those answers genuinely differ
 * today and unifying them is a durable-persistence stage with its own schema
 * and RLS questions.
 *
 * Not ranking, either. Suppression REMOVES an object; it never moves one. That
 * separation is what makes this safe to share across surfaces whose ordering
 * legitimately differs — mobile briefs, desktop works, Explore discovers, and
 * all three should agree about what the reader has already answered.
 */

/**
 * A personal disposition: one user's standing answer about one object.
 *
 * Both fields are optional and both `null` and `undefined` mean "no answer",
 * because the three stores disagree about which one they write and a reader
 * that treats them differently would suppress on one surface and not another.
 */
export interface PersonalDisposition {
  /** When the reader dismissed it outright. Any truthy timestamp counts. */
  dismissedAt?: string | number | Date | null
  /** When the reader's deferral runs out. ISO, epoch ms, or a Date. */
  snoozedUntil?: string | number | Date | null
}

/**
 * Epoch ms, or `null` when the value is absent or not a time.
 *
 * A malformed timestamp resolves to `null` and therefore does NOT suppress.
 * That is the deliberate direction: a corrupt localStorage entry should show
 * the reader a card they have already seen, never hide one they have not.
 */
export function toEpoch(v: string | number | Date | null | undefined): number | null {
  if (v == null) return null
  const t = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * Should this object be hidden from this reader right now?
 *
 * Dismissal is permanent and beats a deferral. A deferral is live only while
 * `now` is strictly before it, so a snooze that has just expired returns the
 * object rather than holding it for one more read — the reader asked for it
 * back at that moment, and rounding the other way loses a card silently.
 */
export function isPersonallySuppressed(
  d: PersonalDisposition | null | undefined,
  now: number,
): boolean {
  if (!d) return false
  if (toEpoch(d.dismissedAt) != null) return true
  const until = toEpoch(d.snoozedUntil)
  return until != null && until > now
}

/**
 * When a deferral of `hours` taken at `now` runs out.
 *
 * Three call sites computed this inline with the same expression and three
 * different spellings of an hour in milliseconds. A negative or non-finite
 * duration yields `now`, which `isPersonallySuppressed` reads as already
 * expired — a defer that cannot be expressed suppresses nothing.
 */
export const HOUR_MS = 3_600_000

export function deferUntil(hours: number, now: number): number {
  if (!Number.isFinite(hours) || hours <= 0) return now
  return now + hours * HOUR_MS
}
