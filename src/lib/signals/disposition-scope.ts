import type { SignalType } from './contract'
import type { DispositionKind } from './dispositions'

/**
 * Who an action belongs to — the contract this stage exists to establish.
 *
 * ── The failure it prevents ───────────────────────────────────────────────
 *
 * Two controls on the same card, drawn the same way, one word apart:
 *
 *   Defer on a project deliverable  → `snooze_attention`   → my row only
 *   Defer on a trade queue item     → `trade_queue_items.revisit_at`
 *                                      → the shared object, for everybody
 *
 * The second was not a decision anybody made. `AttentionCard.handleDefer`
 * branched on `source_type === 'trade_queue_item'` and called a mutation that
 * happened to exist, so one analyst deciding "not today" rewrote the revisit
 * time the whole desk reads — and, because the attention filter never looks at
 * `revisit_at`, did not defer the item for the person who clicked. A personal
 * intent produced a shared effect and no personal effect. That is the exact
 * inversion this module names so it cannot recur silently.
 *
 * ── The three categories, and why there are three ─────────────────────────
 *
 * Two would be a lie by omission. "Personal vs shared" has no room for the one
 * legitimate middle case — a person deliberately telling their colleagues
 * something about a shared object without changing it — and code that has no
 * word for a case tends to file it under whichever neighbour is closer. The
 * third slot is declared and DELIBERATELY EMPTY (see `SHARED_ACK`), so that
 * anything wanting those semantics has to add itself here on purpose.
 *
 * ── What this module is not ───────────────────────────────────────────────
 *
 * Not a dispatcher, not a permission system, not a registry anything plugs
 * into. It is a lookup table and three predicates: the enforcement is a test
 * asserting that every verb the app can reach is classified, and that the
 * personal ones write nowhere but the caller's own row. A framework would move
 * the question somewhere harder to read; the point is that the answer stays
 * greppable.
 *
 * Pure by construction — no Supabase import, so the gallery graph can reach it
 * (`scripts/gallery-purity.mjs`).
 */

export type ActionOwnership =
  /**
   * `user × object × disposition`. Changes what THIS reader sees and nothing
   * else. The underlying investment or workflow object is untouched, and a
   * teammate loading the same object sees exactly what they saw before.
   */
  | 'personal'
  /**
   * Mutates the shared object. Everyone sees the change; it needs authority,
   * and the control must say what it actually does.
   */
  | 'shared'
  /**
   * A statement addressed to colleagues, attached to a shared object, that does
   * not change the object's own state. Declared, and currently unused.
   */
  | 'shared_ack'

export interface OwnedAction {
  ownership: ActionOwnership
  /** Where the effect lands. Named so a reader can check the claim. */
  writes: string
  /** Why it is classified this way, in one line. */
  note: string
}

/**
 * Every disposition verb the surfaces can currently reach.
 *
 * Keyed by the judgment key where one exists, and by the mutation name where
 * the action has no key because it is not a judgment at all.
 * `disposition-scope.test.ts` pins this against the vocabularies the app
 * actually writes, so adding an option without deciding who owns it fails a
 * test rather than defaulting to whichever branch is nearest.
 */
export const ACTION_OWNERSHIP: Record<string, OwnedAction> = {
  // ── Personal: feed triage ────────────────────────────────────────────────
  feed_snoozed: {
    ownership: 'personal',
    writes: 'attention_user_state.snoozed_until (own row)',
    note: 'Take it off my screen for a week. Says nothing about the finding.',
  },
  feed_dismissed: {
    ownership: 'personal',
    writes: 'attention_user_state.dismissed_until (own row)',
    note: 'Stronger than snooze, still bounded, still only mine.',
  },

  // ── Personal: feed quality ───────────────────────────────────────────────
  // A complaint about the SURFACE. It suppresses for the complainer and is
  // recorded as telemetry; it must never edit the thing the card was about.
  feed_not_useful: {
    ownership: 'personal',
    writes: 'attention_user_state.dismissed_until (own row) + pilot_telemetry_events',
    note: 'A claim about the card, not about the position.',
  },
  feed_wrong_person: {
    ownership: 'personal',
    writes: 'attention_user_state.dismissed_until (own row) + pilot_telemetry_events',
    note: 'A routing complaint. Deliberately does NOT rewrite coverage.',
  },

  // ── Personal: attention queue ────────────────────────────────────────────
  // The four verbs on a workflow card. None of them resolves the underlying
  // item, and none of them is allowed to — see the `Done`/`Answered` removal
  // recorded in MobileDashboard's attention branch.
  reviewed: {
    ownership: 'personal',
    writes: 'attention_user_state (own row)',
    note: 'I have looked at it. The deliverable stays open for everyone else.',
  },
  in_progress: {
    ownership: 'personal',
    writes: 'attention_user_state (own row)',
    note: 'Acknowledged and still open. Not suppressed, only de-prioritised.',
  },
  defer: {
    ownership: 'personal',
    writes: 'attention_user_state.snoozed_until (own row)',
    note: 'The one this stage moved. Was reaching trade_queue_items.revisit_at.',
  },
  not_mine: {
    ownership: 'personal',
    writes: 'attention_user_state (own row)',
    note: 'A routing statement about me. The gap is real and still somebody’s.',
  },

  // ── Personal: investment verdicts ────────────────────────────────────────
  // These also write an `audit_events` row, which is org-visible HISTORY rather
  // than object state: it records that a person concluded something at a time.
  // Reading the history back changes nothing a teammate sees on the object.
  judgment: {
    ownership: 'personal',
    writes: 'attention_user_state (own row) + audit_events (append-only history)',
    note: 'Suppression is mine; the record is the firm’s. Neither mutates the asset.',
  },

  // ── Shared: the real resolution verbs ────────────────────────────────────
  // Every one of these changes what colleagues see. They exist, they are
  // correct, and they must be reached only from a control that says so.
  markDeliverableDone: {
    ownership: 'shared',
    writes: 'project_deliverables.completed',
    note: 'Genuinely completes assigned work.',
  },
  approveTradeIdea: {
    ownership: 'shared',
    writes: 'trade_queue_items.status = approved',
    note: 'A committed decision on a shared queue item.',
  },
  rejectTradeIdea: {
    ownership: 'shared',
    writes: 'trade_queue_items.status = rejected',
    note: 'Same, in the other direction.',
  },
  deferTradeIdea: {
    ownership: 'shared',
    writes: 'trade_queue_items.revisit_at',
    note:
      'Moves the revisit time the whole desk reads. Correct as a deliberate ' +
      'queue action; wrong as the implementation of one reader’s "not today", ' +
      'which is what it was.',
  },
}

/**
 * The empty third category, kept visible on purpose.
 *
 * Nothing today is a shared acknowledgment. The nearest candidates are all
 * something else: `audit_events` is history, not state; a `quick_thought` is a
 * note with its own visibility model; `trade_queue_votes` is a vote, which is
 * an input to a decision rather than an acknowledgment of one.
 *
 * Left as a declared and empty set rather than deleted, because the alternative
 * is a two-valued vocabulary in which a future "the desk has seen this" lands
 * in `shared` and quietly starts mutating an object.
 */
export const SHARED_ACK: ReadonlySet<string> = new Set<string>()

export function ownershipOf(action: string): ActionOwnership | null {
  return ACTION_OWNERSHIP[action]?.ownership ?? null
}

/** True when the action may only ever touch the acting user's own state. */
export function isPersonalAction(action: string): boolean {
  return ownershipOf(action) === 'personal'
}

/** True when the action changes what teammates see on the object itself. */
export function mutatesSharedObject(action: string): boolean {
  return ownershipOf(action) === 'shared'
}

/**
 * The namespace personal feed state occupies inside `attention_user_state`.
 *
 * ── Why a prefix rather than a table ──────────────────────────────────────
 *
 * `attention_user_state` is already `UNIQUE (user_id, attention_id)` over an
 * opaque `text` key, which is exactly `(user, object)`. Its existing rows hold
 * a 32-char hex hash from `generateAttentionId`; these hold
 * `signal:<type>:<subject>`. Disjoint by shape, so the two namespaces cannot
 * collide, and the attention pipeline's exact-match lookup never finds one of
 * ours. A second table would have been the same key, the same policies and one
 * more thing to keep in step.
 */
export const DURABLE_KEY_PREFIX = 'signal:'

/**
 * The durable row key for a feed disposition.
 *
 * The subject is `dispositionEntityFor(card)` — the entity for a machine
 * finding that recurs, the card for a one-off artefact somebody created. That
 * rule lives in `dispositions.ts` and is deliberately not restated here; this
 * function only namespaces whatever it is given, so the local and durable
 * stores cannot disagree about identity.
 */
export function durableDispositionKey(type: SignalType | string, subject: string): string {
  return `${DURABLE_KEY_PREFIX}${type}:${subject}`
}

/** Split a durable key back into `type` and `subject`, or null if it is not ours. */
export function parseDurableKey(key: string): { type: string; subject: string } | null {
  if (!key.startsWith(DURABLE_KEY_PREFIX)) return null
  const rest = key.slice(DURABLE_KEY_PREFIX.length)
  const cut = rest.indexOf(':')
  // A subject may itself contain colons — `idea:recommendation:<uuid>` does —
  // so only the FIRST separator is structural.
  if (cut <= 0 || cut === rest.length - 1) return null
  return { type: rest.slice(0, cut), subject: rest.slice(cut + 1) }
}

/**
 * Which durable column a disposition kind expires in.
 *
 * `snoozed_until` and `dismissed_until` are both bounded windows and the split
 * is not cosmetic: the existing partial indexes are per column, and the two
 * carry different product meaning — "later" versus "not this". `flagged`
 * returns null because it suppresses nothing at all; the row is still written,
 * so the answer is remembered, but neither window is set.
 */
export function suppressionFieldFor(
  kind: DispositionKind,
): 'snoozed_until' | 'dismissed_until' | null {
  switch (kind) {
    case 'settled':
      return 'snoozed_until'
    case 'rejected':
      return 'dismissed_until'
    case 'flagged':
      return null
  }
}
