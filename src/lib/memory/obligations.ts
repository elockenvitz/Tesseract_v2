/**
 * Parked work, and the promise that it comes back.
 *
 * ── What was wrong ───────────────────────────────────────────────────────
 *
 * "Snooze Idea — hides this idea until the date you choose" wrote
 * `revisit_at`, audited the write, and stopped. Nothing filtered on the
 * column; the idea stayed exactly where it was. Worse,
 * `snoozeTradeIdea` also bumped `updated_at`, which is what every staleness
 * heuristic reads — so the one action a user took to be reminded later made
 * the idea look freshly worked on and therefore LESS likely to resurface.
 * The feature was not merely inert. It was subtractive.
 *
 * ── The distinction this module exists to hold ───────────────────────────
 *
 * An obligation is a DURABLE INTENT TO REVISIT: at time T, a person
 * explicitly said this work should get attention again at or after X. It is
 * not "this looks stale", not "the model finds this interesting", and not
 * every open idea. Every obligation written here comes from one explicit
 * user action, deterministically.
 *
 * `memory_obligations` stays canonical for outstanding state;
 * `trade_queue_items.revisit_at` and `decision_requests.deferred_until`
 * stay canonical for the date. The obligation CONNECTS them — it does not
 * replace either, and the suppression predicate below reads the canonical
 * column, not the obligation.
 *
 * ── Due is not done ──────────────────────────────────────────────────────
 *
 * The due date means "eligible for attention again". It does not clear the
 * obligation. An obligation that evaporates when its date passes is a
 * reminder that deletes itself the moment it becomes relevant, which is the
 * failure mode this whole table exists to avoid. Only a real action clears
 * it — see `CLEAR_REASONS`.
 */

/** The vocabulary, mirroring `memory_obligations_kind_ck`. */
export const OBLIGATION_KINDS = {
  /** A committed trade whose lifecycle says it needs review. Pre-existing. */
  tradeReview: 'trade_review',
  /** A user parked an idea until a date. */
  ideaRevisit: 'idea_revisit',
  /** A PM deferred a recommendation to a date. */
  decisionRevisit: 'decision_revisit',
} as const

export type ObligationKind = (typeof OBLIGATION_KINDS)[keyof typeof OBLIGATION_KINDS]

/**
 * Why an obligation was cleared.
 *
 * Passed as the RPC's `p_provenance`, which lands on the `obligation.cleared`
 * memory event. The obligation row itself records only THAT it was cleared;
 * the reason lives on the timeline, which is the right split — current state
 * on the table, history in the events.
 */
export const CLEAR_REASONS = {
  /** The work resumed: the idea advanced a stage, or was recommended. */
  workResumed: 'clear:work-resumed',
  /** The idea reached a terminal outcome, or the decision was resolved. */
  terminal: 'clear:terminal',
  /** Archived or deleted — there is nothing left to come back to. */
  removed: 'clear:removed',
  /** The user explicitly cancelled the snooze/deferral. */
  cancelled: 'clear:cancelled',
  /** Replaced by a new date. Written by supersede_memory_obligation. */
  superseded: 'clear:superseded',
} as const

export type ClearReason = (typeof CLEAR_REASONS)[keyof typeof CLEAR_REASONS]

/* ── Suppression ───────────────────────────────────────────────────────── */

/**
 * Is this item currently parked?
 *
 * Reads the canonical column, deliberately. A surface that filtered on the
 * obligation table would hide work whenever the obligation write failed —
 * and show work whenever a stale obligation lingered. The date on the row
 * the user edited is the truth about whether they parked it; the obligation
 * is the truth about whether we still owe them a resurfacing.
 */
export function isParked(
  revisitAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!revisitAt) return false
  const due = Date.parse(revisitAt)
  if (Number.isNaN(due)) return false
  return due > now.getTime()
}

/**
 * The PostgREST filter that suppresses parked work.
 *
 * `.or(PARKED_SUPPRESSION_FILTER())` on any query over `trade_queue_items`.
 * Written as one exported string so every attention surface suppresses by
 * the same rule — a second, slightly different predicate elsewhere is how
 * "snoozed" comes to mean different things on two screens.
 *
 * Note the shape: NULL revisit_at passes. An item that was never snoozed
 * must never be hidden by a snooze filter, and `revisit_at.lte.<now>` alone
 * would drop every un-snoozed idea in the product.
 */
export function parkedSuppressionFilter(now: Date = new Date()): string {
  return `revisit_at.is.null,revisit_at.lte.${now.toISOString()}`
}

/**
 * Surfaces where "snooze" promises suppression, and surfaces where it must
 * not suppress.
 *
 * Recorded here rather than as scattered comments because the second list is
 * the safety property: a user must always be able to deliberately find their
 * own parked work. Hiding it from search as well as from the feed does not
 * make the product calmer, it makes the work unrecoverable — and a snooze
 * you cannot undo is a delete with a friendlier label.
 */
export const SUPPRESSED_SURFACES = [
  'attention feed',
  'ideas pipeline (active lanes)',
  'dashboard idea counts and lists',
  'mobile pipeline',
] as const

export const NEVER_SUPPRESSED_SURFACES = [
  'global search',
  'direct link / idea detail',
  'the idea\'s own portfolio and asset pages',
  'an explicit "snoozed" or "all work" view',
] as const

/* ── Clear rules ───────────────────────────────────────────────────────── */

/** What happened to the idea, as far as the clear rule is concerned. */
export interface IdeaClearSignal {
  /** Terminal outcome set, or status moved to a terminal value. */
  isTerminal?: boolean
  /** Soft-deleted or archived. */
  isRemoved?: boolean
  /** Stage advanced since the obligation was raised. */
  stageAdvanced?: boolean
  /** A recommendation was submitted for it. */
  recommendationSubmitted?: boolean
  /** The user explicitly cancelled the snooze (revisit_at cleared). */
  snoozeCancelled?: boolean
}

/**
 * Should this idea's revisit obligation be cleared, and why?
 *
 * Returns null to leave it open. Deliberately does NOT clear on "the due
 * date arrived" or on "someone opened the idea": opening a page is not doing
 * the work, and an obligation that clears on sight is a reminder that
 * deletes itself when noticed — the same mistake the trade-review rule
 * already avoids by clearing on its predicate rather than on a view.
 *
 * Order matters only for which reason is reported; any one of these is
 * sufficient.
 */
export function ideaClearReason(signal: IdeaClearSignal): ClearReason | null {
  if (signal.isRemoved) return CLEAR_REASONS.removed
  if (signal.isTerminal) return CLEAR_REASONS.terminal
  if (signal.snoozeCancelled) return CLEAR_REASONS.cancelled
  if (signal.recommendationSubmitted) return CLEAR_REASONS.workResumed
  if (signal.stageAdvanced) return CLEAR_REASONS.workResumed
  return null
}

export interface DecisionClearSignal {
  /** The request left `deferred` for any resolved status. */
  isResolved?: boolean
  /** The deferral was cancelled and the request is active again. */
  deferralCancelled?: boolean
  /** The request was withdrawn or its idea removed. */
  isRemoved?: boolean
}

export function decisionClearReason(signal: DecisionClearSignal): ClearReason | null {
  if (signal.isRemoved) return CLEAR_REASONS.removed
  if (signal.isResolved) return CLEAR_REASONS.terminal
  if (signal.deferralCancelled) return CLEAR_REASONS.cancelled
  return null
}

/* ── Due state ─────────────────────────────────────────────────────────── */

export type DueState = 'due' | 'scheduled' | 'open_ended'

/**
 * Where an open obligation stands.
 *
 *   due         the date has passed — eligible to surface, still outstanding
 *   scheduled   parked until a future date
 *   open_ended  no date was given; outstanding but never becomes "due"
 *
 * `open_ended` is a real state, not a gap to paper over. A trade-review
 * obligation has a due date only when `execution_expected_by` was set, which
 * it never is in practice. Treating a missing date as "due now" would flood
 * the feed with work nobody scheduled.
 */
export function dueState(
  dueAt: string | null | undefined,
  now: Date = new Date(),
): DueState {
  if (!dueAt) return 'open_ended'
  const t = Date.parse(dueAt)
  if (Number.isNaN(t)) return 'open_ended'
  return t <= now.getTime() ? 'due' : 'scheduled'
}

/** Whole days between two instants, floored. Negative before the due date. */
export function elapsedDays(from: string, to: Date = new Date()): number {
  const start = Date.parse(from)
  if (Number.isNaN(start)) return 0
  return Math.floor((to.getTime() - start) / 86_400_000)
}
