/**
 * Durable attention state — the personal/shared distinction, made explicit.
 *
 * ── The defect this exists to fix ─────────────────────────────────────────
 *
 * Desktop had one control labelled "Defer" that did two incompatible things:
 * for a `trade_queue_item` it wrote `trade_queue_items.revisit_at` — a SHARED
 * workflow change every teammate sees — and for everything else it wrote a
 * key into `localStorage` under `tesseract.attentionFeedSnooze`. Same label,
 * same menu, same confirmation toast. A user could not tell whether they had
 * just made a private note-to-self or moved the team's revisit date.
 *
 * The localStorage half was also not durable in any useful sense: per-browser,
 * per-device, unattributable, invisible to the org, and gone when site data is
 * cleared. "I dealt with this" is a judgment, and the product was throwing it
 * away.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 *
 * PERSONAL state answers "should I see this?" and never changes what anything
 * is. SHARED state answers "when is the team looking at this?" and changes the
 * object for everybody.
 *
 * They are different types here, not two values of one enum, because the whole
 * failure was that the two were interchangeable at a call site.
 */

/**
 * A personal disposition. Suppresses an item for ONE user on ALL their
 * devices, and changes no shared investment or workflow state whatsoever.
 */
export type PersonalDisposition = 'dismiss' | 'snooze'

/**
 * Why an item was dismissed.
 *
 * Constrained by `attention_user_state_dismiss_reason_check` in production.
 * Mirrored here so a bad value is a type error at the call site rather than a
 * constraint violation in front of a user — the same discipline D1 applied to
 * `messages.context_type`.
 */
export const DISMISS_REASONS = [
  'duplicate',
  'incorrect_signal',
  'not_my_responsibility',
  'no_longer_relevant',
] as const

export type DismissReason = (typeof DISMISS_REASONS)[number]

/**
 * A shared workflow deferral. Moves a revisit date the whole team observes.
 *
 * Deliberately NOT a member of `PersonalDisposition`, and deliberately not
 * called "snooze". Only objects with a real revisit concept can carry one —
 * see `sharedDeferCapability`. We do not invent shared semantics for objects
 * that have none.
 */
export interface SharedDefer {
  kind: 'trade_queue_item'
  /** The row whose revisit date moves. */
  targetId: string
}

/** Whether an object supports a genuine shared deferral, and why not if it doesn't. */
export type SharedDeferCapability =
  | { supported: true; defer: SharedDefer }
  | { supported: false; reason: string }

/** One user's stored state for one attention key. */
export interface PersonalAttentionRow {
  attention_id: string
  snoozed_until: string | null
  dismissed_at: string | null
  dismiss_reason: DismissReason | null
}

/** Why an item is currently hidden from this user, if it is. */
export type SuppressionReason =
  | { suppressed: false }
  | { suppressed: true; by: 'dismiss'; since: string }
  | { suppressed: true; by: 'snooze'; until: string }
