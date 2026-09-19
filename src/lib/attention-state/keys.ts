/**
 * Attention keys — what a personal disposition is recorded AGAINST.
 *
 * ── Why namespacing is safe here ──────────────────────────────────────────
 *
 * `attention_user_state.attention_id` is `text`, not a foreign key, and every
 * RPC looks it up by exact match on `(user_id, attention_id)`. So a second
 * namespace cannot collide with the first and cannot break the first: rows in
 * a namespace nothing queries are simply inert.
 *
 * ── Why the desktop feed needs one ────────────────────────────────────────
 *
 * The desktop feed merges two sources with different id shapes:
 *
 *   1. The attention system, whose items already carry a real `attention_id`.
 *   2. The global decision engine, whose items carry synthetic ids like
 *      `a2-execution-<uuid>` invented by the evaluator that produced them.
 *
 * Native attention items are recorded under their OWN id, unnamespaced. That
 * is deliberate and load-bearing: the existing attention surfaces already
 * write `snooze_attention(<attention_id>)`, so snoozing an item from Today and
 * snoozing the same item from the attention dashboard must land on one row.
 * Namespacing those would silently split one user's judgment across two rows
 * and each surface would show the other's dismissal as unread.
 *
 * Engine items have no native id, so they get `decision:<id>`.
 *
 * ── The lesson borrowed from mobile ───────────────────────────────────────
 *
 * `lib/signals/dispositions.ts` documents the failure mode at length: a key
 * that embeds anything time-varying means "the identical claim tomorrow" is a
 * different key, so the user answers the same question every day and the
 * disposition never appears to stick. Engine ids embed the evaluator and the
 * subject entity and nothing else, so they are stable across regenerations —
 * which is exactly the property the key needs. Nothing here adds a date.
 */

/** Where a feed item came from. Determines whether its id is already native. */
export type AttentionKeySource = 'attention' | 'decision'

/** Namespace for ids the decision engine invented. */
export const DECISION_NAMESPACE = 'decision:'

/**
 * The `attention_id` a personal disposition for this item is stored under.
 *
 * Returns null for an empty id rather than producing `decision:` as a key,
 * which would collapse every unidentified item onto one shared row.
 */
export function toAttentionKey(source: AttentionKeySource, id: string): string | null {
  const trimmed = id?.trim()
  if (!trimmed) return null
  if (source === 'attention') return trimmed
  return trimmed.startsWith(DECISION_NAMESPACE) ? trimmed : `${DECISION_NAMESPACE}${trimmed}`
}

/* ------------------------------------------------------------------ views -- */

/**
 * The key a per-object VIEW cursor is stored under.
 *
 * ── Why its own namespace ────────────────────────────────────────────────
 *
 * `last_viewed_at` shares a table with snooze and dismissal, but it answers a
 * different question: not "what has this person decided about this finding"
 * but "when did they last actually look at this object". A finding and the
 * asset it concerns are not the same subject, and recording a view against a
 * finding's key would let opening an asset silently mark a finding as seen.
 *
 * Namespacing is safe for the reason the file header already gives: the column
 * is text with no FK, every RPC matches exactly, and a namespace nothing else
 * queries is inert to everything else.
 *
 * ── Why the org is in the key ────────────────────────────────────────────
 *
 * `attention_user_state` has no `organization_id` column -- it is keyed on
 * (user_id, attention_id) alone. The same analyst can hold the same asset in
 * two pilot orgs, and "since you last looked" must not leak across them, so
 * the org goes into the key rather than being wished into the table.
 */
export const VIEW_NAMESPACE = 'view:'

export type ViewSubjectType = 'asset' | 'idea' | 'decision' | 'trade' | 'portfolio'

export function objectViewKey(
  orgId: string | null | undefined,
  subjectType: ViewSubjectType,
  subjectId: string | null | undefined,
): string | null {
  const id = subjectId?.trim()
  const org = orgId?.trim()
  // No org or no subject means no truthful cursor: a shared row would merge
  // two workspaces, which is worse than having no answer.
  if (!id || !org) return null
  return `${VIEW_NAMESPACE}${org}:${subjectType}:${id}`
}

/**
 * Classify a desktop feed item by its id.
 *
 * The dashboard adapter prefixes attention-derived items with `attn-`
 * (`lib/attention-feed/adapters.ts`), which is the only signal available at
 * the point where a disposition is taken. Kept as one function so that if the
 * adapter's convention ever changes, exactly one place has to change with it.
 */
export const ATTENTION_ITEM_PREFIX = 'attn-'

export function sourceOfFeedItemId(itemId: string): AttentionKeySource {
  return itemId?.startsWith(ATTENTION_ITEM_PREFIX) ? 'attention' : 'decision'
}

/**
 * The key for a desktop feed item id, resolving its source automatically.
 *
 * Strips the adapter's `attn-` prefix for attention-derived items so the row
 * matches what the attention surfaces already write.
 */
export function feedItemAttentionKey(itemId: string): string | null {
  const source = sourceOfFeedItemId(itemId)
  if (source === 'attention') {
    return toAttentionKey('attention', itemId.slice(ATTENTION_ITEM_PREFIX.length))
  }
  return toAttentionKey('decision', itemId)
}
