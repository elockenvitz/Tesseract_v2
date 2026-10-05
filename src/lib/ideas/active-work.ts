/**
 * One question, one answer: is this idea currently active work?
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 *
 * Four surfaces asked that question and three of them got it wrong, because
 * each wrote its own filter. The Ideas Pipeline board — the authority, the
 * thing a user points at and says "these are my open ideas" — composed four
 * separate rules to decide board membership. The Quick Capture picker
 * composed exactly one of them (`isLiveIdea`) and then told the user "In
 * pipeline" about ideas the Pipeline does not show: four untouched pilot
 * seeds that graduation had already retired.
 *
 * That is the defect class this module closes. Not "the picker had a bug" —
 * the picker had a *different definition*, and a second definition of a
 * user-visible fact is a defect that regenerates every time a new surface
 * needs the same answer.
 *
 * ── This invents nothing ─────────────────────────────────────────────────
 *
 * Every clause below delegates. There is no new semantics here, which is the
 * point: if this file disagreed with the Pipeline it would be a fifth wrong
 * answer rather than a fix.
 *
 *   LIVENESS       `isLiveIdea`            trade-status-semantics
 *   PILOT SEEDS    `isOperationalAfterPilot` pilot/seed-visibility
 *   PARKED         `isParked`              memory/obligations
 *   DEFERRED       `isDeferredResurfaced`  below, lifted from the board
 *
 * ── Where it deliberately does NOT belong ────────────────────────────────
 *
 * `usePipelineItems` must keep returning rows this predicate rejects. It
 * feeds the desktop Snoozed, Archived and Committed tabs, which exist to
 * list precisely the parked and terminal work. Filtering at the shared read
 * would make snoozed ideas unrecoverable — `MobilePipeline` documents this,
 * and it is why the predicate is applied per-surface rather than in the
 * hook. "Active work" is one question that surface asks; it is not the only
 * question, and a surface asking a different one must keep its own filter.
 */

import { isLiveIdea, type IdeaLifecycleRow as IdeaLivenessRow } from '../trade-status-semantics'
import { isParked } from '../memory/obligations'
import {
  isOperationalAfterPilot,
  isPilotSeedRow,
  type SeedMetadataRow,
} from '../pilot/seed-visibility'
import { hasGenuineUserWork, type IdeaLifecycleRow } from './lifecycle'

/**
 * The columns the question needs.
 *
 * Spelled out so a caller can see what its `select` must fetch. A query that
 * omits `origin_metadata` reads every pilot seed as a normal idea; one that
 * omits the evidence embeds reads every idea as unworked. Both failures look
 * exactly like a correct answer, which is how the picker shipped broken — it
 * selected `asset_id, status, outcome` and nothing else.
 */
export interface ActiveWorkRow extends IdeaLifecycleRow, SeedMetadataRow {
  /** Which drawer the row lives in. Only `active` can be active work. */
  visibility_tier?: string | null
  /** Snooze target. A future value parks the idea. */
  revisit_at?: string | null
  /** Resurface date for a deferred (`cancelled`) idea. */
  deferred_until?: string | null
}

/** Statuses the Ideas Pipeline treats as deferred rather than finished. */
export const DEFERRED_STATUSES: readonly string[] = ['cancelled']

/**
 * A deferred idea whose resurface date has arrived.
 *
 * Lifted verbatim from `TradeQueuePage`'s `isDeferredAndReady`, where it was
 * an inline closure. The board readmits a `cancelled` idea once its date
 * passes, so without this clause the canonical predicate would be *stricter*
 * than the authority and hide work the Pipeline shows — the same disagreement
 * in the other direction.
 *
 * `deferred_until` is stored as UTC midnight but means a date the user picked
 * on a calendar, so the comparison is date-to-date in local time. Comparing
 * the raw timestamps would resurface the idea up to a day early or late
 * depending on the reader's offset.
 *
 * No `deferred_until` means no resurface date, which means it stays deferred.
 */
export function isDeferredResurfaced(
  row: Pick<ActiveWorkRow, 'status' | 'outcome' | 'deferred_until'> | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!row) return false
  if (!DEFERRED_STATUSES.includes(String(row.status ?? '').trim().toLowerCase())) return false
  if (!row.deferred_until) return false
  /*
   * An outcome outranks the deferral.
   *
   * The board never consults `outcome` — it predates the column. But in the
   * three-axis model `outcome` is the authoritative liveness signal, and an
   * idea that reached a recorded conclusion is finished whatever its status
   * says. Resurfacing it would contradict its own conclusion, so this is one
   * place the predicate is deliberately stricter than the surface it was
   * lifted from. Noted rather than silent, because it is a real difference.
   */
  if (row.outcome != null && String(row.outcome).trim() !== '') return false

  const target = new Date(row.deferred_until)
  if (Number.isNaN(target.getTime())) return false

  // The date the user picked, read out of UTC, compared against their local
  // today. Resurface when local date >= intended date.
  const intended = new Date(
    target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate(),
  ).getTime()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return today >= intended
}

/** What the predicate needs to know about the world, not the row. */
export interface ActiveWorkContext {
  /**
   * The pilot's own graduation flag (`usePilotMode().hasGraduated`). Before
   * graduation every seed is operational — it IS the work being demonstrated.
   */
  hasGraduated: boolean
  /** Injectable for tests; parked and deferred are both time-dependent. */
  now?: Date
}

/**
 * Should this idea currently be treated as active work?
 *
 * True only when every authority agrees. Each clause can veto, and the order
 * is cheapest-first; none of them is optional.
 *
 * A caller that cannot answer `hasGraduated` has not finished reading its
 * data — it is a required input, not a flag with a safe default, because
 * defaulting it either way silently picks one of the two wrong answers.
 */
export function isActiveIdeaWork(
  row: ActiveWorkRow | null | undefined,
  { hasGraduated, now = new Date() }: ActiveWorkContext,
): boolean {
  if (!row) return false

  // Which drawer. An archived row is not active work however live it looks.
  // Tolerates absence: a query that did not select the column has already
  // filtered on it (`.eq('visibility_tier', 'active')`) or is not scoping by
  // drawer at all, and inventing a rejection here would hide real work.
  if (row.visibility_tier != null && row.visibility_tier !== 'active') return false

  // Snoozed until a future date. The snooze dialog promises it hides the idea
  // "from your pipeline, feed and attention list" — this is what makes that
  // sentence true on every surface instead of just the desktop board.
  if (isParked(row.revisit_at, now)) return false

  // Retired pilot seeds. `isPilotSeedRow` reads the marker; `hasGenuineUserWork`
  // decides whether a person has since acted on it. A worked seed is that
  // person's work and stays active.
  if (!isOperationalAfterPilot(
    { pilotSeed: isPilotSeedRow(row), actedOn: hasGenuineUserWork(row) },
    { hasGraduated },
  )) return false

  // Liveness last, because deferral can readmit a terminal status.
  return isLiveIdea(row as IdeaLivenessRow) || isDeferredResurfaced(row, now)
}

/** The same question over a list. */
export function activeIdeaWork<T extends ActiveWorkRow>(
  rows: readonly T[] | null | undefined,
  ctx: ActiveWorkContext,
): T[] {
  return (rows ?? []).filter(r => isActiveIdeaWork(r, ctx))
}

/**
 * Embed fragment every active-work query must select.
 *
 * Re-exported from `lifecycle` and widened with the columns this predicate
 * reads, so a caller writes one fragment rather than remembering five column
 * names. The columns are the difference between an answer and a guess.
 */
export const ACTIVE_WORK_SELECT = `
  id, asset_id, portfolio_id, status, outcome, visibility_tier,
  revisit_at, deferred_until, origin_metadata,
  accepted_trades (id, is_active, reverted_at),
  decision_requests (id, status, created_at)
`
