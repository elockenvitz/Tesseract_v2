/**
 * Suppression and resurfacing — pure logic, no network.
 *
 * ── What resurfacing D2 does and does not decide ──────────────────────────
 *
 * The brief asks what the existing model supports for: the same issue
 * recurring, a materially changed issue, a new issue on the same object, and
 * snooze expiry. What `attention_user_state` actually gives us is one row per
 * `(user, attention_id)` carrying two timestamps. So:
 *
 *   SNOOZE EXPIRY — fully supported, and decided here. `snoozed_until` is a
 *   timestamp; once it passes, the item returns on its own. Nothing has to
 *   run, no job, no cleanup.
 *
 *   SAME ISSUE, SAME OBJECT — supported, and it stays suppressed. The key is
 *   derived from the evaluator and the subject, so a regenerated identical
 *   finding maps to the same row. This is the behaviour mobile learned the
 *   hard way: a key that varies over time makes the user answer the same
 *   question every morning.
 *
 *   NEW ISSUE ON THE SAME OBJECT — supported, and it resurfaces, because a
 *   different evaluator produces a different id and therefore a different key.
 *   Dismissing "research is stale" does not silence "framework broken".
 *
 *   MATERIALLY CHANGED OUTPUT OF THE SAME EVALUATOR — NOT decided here, and
 *   deliberately so. Telling "AMZN is 5% above bull" from "AMZN is 40% above
 *   bull" requires a fingerprint of the evaluator's output, which means the
 *   evaluators must emit one, which is ranking/Today work. D2 would have to
 *   invent that fingerprint and every evaluator would have to be revisited to
 *   populate it — a large system, built speculatively, in a stage whose job is
 *   durability.
 *
 *   The conservative consequence is stated plainly so nobody has to infer it:
 *   a dismissal of an evaluator's finding about an object currently persists
 *   even if that finding later gets much worse. `isDismissPermanent` names
 *   that boundary, and `DISMISS_RESURFACE_NOTE` is the sentence a UI should
 *   show so the user is not surprised by it. Until the fingerprint exists,
 *   `Snooze` is the honest default for "not now" and `Dismiss` should be
 *   presented as the deliberate, reversible-by-undismiss choice it is.
 */

import type { PersonalAttentionRow, SuppressionReason } from './types'

/**
 * Is this item currently hidden from this user, and why?
 *
 * Dismissal outranks snooze: if a row carries both, the user has made the
 * stronger statement and it is the one worth reporting.
 */
export function suppressionFor(
  row: PersonalAttentionRow | undefined,
  now: number = Date.now(),
): SuppressionReason {
  if (!row) return { suppressed: false }

  if (row.dismissed_at) {
    return { suppressed: true, by: 'dismiss', since: row.dismissed_at }
  }

  if (row.snoozed_until) {
    const until = Date.parse(row.snoozed_until)
    // An unparseable timestamp must not hide an item forever. Failing open is
    // the right direction for a feed whose job is to surface things.
    if (Number.isFinite(until) && until > now) {
      return { suppressed: true, by: 'snooze', until: row.snoozed_until }
    }
  }

  return { suppressed: false }
}

export function isSuppressed(
  row: PersonalAttentionRow | undefined,
  now?: number,
): boolean {
  return suppressionFor(row, now).suppressed
}

/**
 * The set of attention keys currently suppressed for this user.
 *
 * Expiry is evaluated at read time rather than by pruning stored rows: the
 * row is the record of what the user decided and when, and deleting it to
 * represent "the snooze ended" would destroy that. Mobile's localStorage
 * implementation pruned on read because storage was the only state it had;
 * here the database is the state and the read is a projection of it.
 */
export function suppressedKeys(
  rows: readonly PersonalAttentionRow[],
  now?: number,
): Set<string> {
  const out = new Set<string>()
  for (const row of rows) {
    if (isSuppressed(row, now)) out.add(row.attention_id)
  }
  return out
}

/** Snooze presets, carried over from the retired localStorage module. */
export const SNOOZE_PRESETS = [
  { label: '1 day', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '1 week', hours: 168 },
] as const

export function snoozeUntilISO(hours: number, now: number = Date.now()): string {
  return new Date(now + hours * 3_600_000).toISOString()
}

/**
 * True while a dismissal has no automatic path back.
 *
 * Constant in D2 — see the module note. It is a function rather than a boolean
 * so that when the material-change fingerprint lands, this becomes the single
 * place that consults it and no call site has to change.
 */
export function isDismissPermanent(): boolean {
  return true
}

export const DISMISS_RESURFACE_NOTE =
  'Dismissed for you only, on every device. It will not come back on its own — ' +
  'a different issue about the same name still will.'

export const SNOOZE_RESURFACE_NOTE =
  'Hidden for you only, on every device, until the snooze expires.'
