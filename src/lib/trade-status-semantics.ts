/**
 * Trade Status Semantics
 *
 * Maps internal database status values to user-facing labels.
 * The database uses 'approved' but the UI should show "Executed".
 * The database uses 'deciding' but the UI should show "Deciding".
 *
 * This module provides a single source of truth for status display logic,
 * ensuring consistent semantics across Trade Queue, Trade Lab, and Outcomes.
 */

import type { TradeQueueStatus, ResearchStage } from '../types/trading'
import type { DecisionStage } from '../types/outcomes'

// ============================================================
// Research Pipeline Stages (v2)
// ============================================================

/**
 * The pipeline vocabulary now lives in `lib/ideas/stage-model`. These
 * re-exports keep the many existing `trade-status-semantics` imports working;
 * there is no second definition here any more.
 */
export {
  IDEA_STAGES,
  IDEA_STAGE_CONFIG,
  isIdeaStage,
  stageLabel,
  stageIndex,
  isForwardMove,
  previousStage,
  nextStage,
  FINAL_STAGE,
  isFinalStage,
  missingForStage,
  canMoveToStage,
  toIdeaStage,
} from './ideas/stage-model'
export type { IdeaStage, IdeaStageConfig } from './ideas/stage-model'

import {
  IDEA_STAGES as CANONICAL_STAGES,
  IDEA_STAGE_CONFIG as CANONICAL_CONFIG,
  toIdeaStage as coerceStage,
} from './ideas/stage-model'
import type { IdeaStage } from './ideas/stage-model'

/** @deprecated Use `IDEA_STAGES`. */
export const RESEARCH_STAGES: ResearchStage[] = [...CANONICAL_STAGES]

/**
 * @deprecated Use `IDEA_STAGE_CONFIG`.
 *
 * `shortLabel` is retained only because a handful of narrow surfaces read it.
 * It is the same string as `label` — the four names are already short, and two
 * names for one stage is how the old vocabulary drifted in the first place.
 */
export const RESEARCH_STAGE_CONFIG: Record<ResearchStage, {
  label: string
  shortLabel: string
  description: string
  color: string
  iconColor: string
}> = Object.fromEntries(
  CANONICAL_STAGES.map((s) => [s, { ...CANONICAL_CONFIG[s], shortLabel: CANONICAL_CONFIG[s].label }]),
) as Record<IdeaStage, { label: string; shortLabel: string; description: string; color: string; iconColor: string }>

/**
 * @deprecated Use `toIdeaStage`, which never returns null.
 *
 * The old signature returned `ResearchStage | null` and callers branched on the
 * null. There is no longer a stage value that fails to map, so this always
 * returns a stage; the nullable return type is kept only so existing
 * null-checks still compile.
 */
export function toResearchStage(stage: string): ResearchStage | null {
  return coerceStage(stage)
}

// ============================================================
// Status Categories
// ============================================================

/**
 * Statuses that represent an executed decision (finalized, approved)
 * DB: 'approved' -> UI: "Executed"
 */
export const COMMITTED_STATUSES: TradeQueueStatus[] = ['approved']

/**
 * Statuses that represent the deciding/commit review stage
 * DB: 'deciding' -> UI: "Deciding"
 */
export const COMMIT_STAGE_STATUSES: TradeQueueStatus[] = ['deciding']

/**
 * Statuses that represent archived/terminal states (not executed)
 */
export const ARCHIVED_STATUSES: TradeQueueStatus[] = ['rejected', 'cancelled', 'deleted']

// ============================================================
// Liveness
// ============================================================

/**
 * Is this idea finished?
 *
 * ── Three axes, and this file answers exactly one of them ─────────────────
 *
 *   MATURITY       how far the work got            -> `stage`
 *   LIVENESS       is it still open                -> `outcome`, then `status`
 *   DECISION STATE is a portfolio decision pending -> `trade_idea_portfolios`
 *
 * They are routinely confused because `stage` reads like progress and
 * therefore like liveness. It is not. An idea can have reached
 * `stage = 'deciding'` months ago, been executed, and still carry that stage —
 * the column records where the process GOT TO, and nothing moves it back when
 * the work ends. `stage` must never decide whether an idea is open, and this
 * helper deliberately does not accept one.
 *
 * ── Why outcome outranks status ───────────────────────────────────────────
 *
 * `stageToLegacyStatus(stage, outcome)` in `trade-idea-service` derives the
 * legacy status FROM the outcome — executed/accepted become `executed`,
 * rejected becomes `rejected`, deferred becomes `cancelled`. So the outcome is
 * the fact and the status is its mirror, which means the status can drift
 * (nothing recomputes it when a row is edited by another path) while the
 * outcome cannot. When they disagree, the outcome is right.
 *
 * `status` remains a genuine fallback rather than a formality: rows written by
 * the legacy approval path set a terminal status and no outcome at all.
 *
 * ── Deliberately small ────────────────────────────────────────────────────
 *
 * One question, one boolean. Not a state machine, not a lifecycle object, and
 * explicitly not a place to also answer maturity or decision state — folding
 * those together is the mistake this exists to stop repeating.
 */

/**
 * Legacy statuses that mean the work is over.
 *
 * `approved` is here and `ARCHIVED_STATUSES` is not enough on its own: that
 * list is about the archive drawer (`rejected`, `cancelled`, `deleted`) and
 * says nothing about finished work. In this database `approved` is what the
 * legacy approval path writes and it means the decision was taken — every such
 * row observed also carries `outcome = 'executed'`. `executed` and `archived`
 * complete the set; neither appeared in any existing grouping.
 */
export const TERMINAL_STATUSES: TradeQueueStatus[] = [
  'approved', 'executed', 'rejected', 'cancelled', 'archived', 'deleted',
]

/** The shape liveness needs. Deliberately not the whole row. */
export interface IdeaLifecycleRow {
  /** Authoritative when present. Any non-null value is terminal. */
  outcome?: string | null
  /** Legacy mirror. Consulted only when there is no outcome. */
  status?: string | null
}

/**
 * True when the idea is finished and must not be presented as live work.
 *
 * Note what is NOT consulted: `stage`, and `visibility_tier`. The first is
 * maturity; the second is which drawer a row lives in, and an executed trade
 * sits in `active` for as long as nobody archives it.
 */
export function isTerminalIdea(row: IdeaLifecycleRow | null | undefined): boolean {
  if (!row) return false
  // Every member of `TradeOutcome` — executed, accepted, rejected, deferred —
  // is an end state. Presence is therefore the test, not equality.
  if (row.outcome != null && String(row.outcome).trim() !== '') return true
  const status = String(row.status ?? '').trim().toLowerCase()
  return (TERMINAL_STATUSES as string[]).includes(status)
}

/** The inverse, for filters that read better in the positive. */
export function isLiveIdea(row: IdeaLifecycleRow | null | undefined): boolean {
  return !isTerminalIdea(row)
}

/**
 * Statuses that represent active pipeline stages
 */
export const ACTIVE_PIPELINE_STATUSES: TradeQueueStatus[] = ['idea', 'discussing', 'simulating', 'deciding']

/**
 * All statuses that should appear in the "active" view (not archived, not executed)
 */
export const ACTIVE_STATUSES: TradeQueueStatus[] = ['idea', 'discussing', 'simulating', 'deciding']

// ============================================================
// Label Mappings
// ============================================================

/**
 * Maps database status values to user-facing labels
 */
export const STATUS_LABELS: Record<TradeQueueStatus, string> = {
  idea: 'Idea',
  discussing: 'Discussing',
  simulating: 'Simulating',
  deciding: 'Deciding',
  approved: 'Executed',
  rejected: 'Rejected',
  executed: 'Executed',
  cancelled: 'Cancelled',
  deleted: 'Deleted',
}

/**
 * Maps database status to past-tense action labels (for history/outcomes)
 */
export const STATUS_ACTION_LABELS: Record<TradeQueueStatus, string> = {
  idea: 'Added as idea',
  discussing: 'Moved to discussion',
  simulating: 'Sent to simulation',
  deciding: 'Escalated to deciding',
  approved: 'Executed',
  rejected: 'Archived',
  executed: 'Executed',
  cancelled: 'Cancelled',
  deleted: 'Deleted',
}

/**
 * Maps database status to the "by" field label
 * e.g., "approved_by" -> "Executed by"
 */
export const STATUS_BY_LABELS: Record<string, string> = {
  approved_by: 'Executed by',
  approved_at: 'Executed at',
  rejected_by: 'Archived by',
  rejected_at: 'Archived at',
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Get the user-facing label for a status
 */
export function getStatusLabel(status: TradeQueueStatus | DecisionStage): string {
  return STATUS_LABELS[status as TradeQueueStatus] || status
}

/**
 * Check if a status represents an executed decision
 */
export function isCommittedStatus(status: TradeQueueStatus | DecisionStage): boolean {
  return COMMITTED_STATUSES.includes(status as TradeQueueStatus)
}

/**
 * Check if a status is in the deciding stage (pending approval)
 */
export function isCommitStageStatus(status: TradeQueueStatus | DecisionStage): boolean {
  return COMMIT_STAGE_STATUSES.includes(status as TradeQueueStatus)
}

/**
 * Check if a status represents an archived/terminal state
 */
export function isArchivedStatus(status: TradeQueueStatus | DecisionStage): boolean {
  return ARCHIVED_STATUSES.includes(status as TradeQueueStatus)
}

/**
 * Check if a status is in the active pipeline
 */
export function isActiveStatus(status: TradeQueueStatus | DecisionStage): boolean {
  return ACTIVE_STATUSES.includes(status as TradeQueueStatus)
}

/**
 * Get the appropriate "by" field label
 * @param field - The field name (e.g., 'approved_by', 'approved_at')
 * @returns The user-facing label (e.g., 'Executed by', 'Executed at')
 */
export function getByFieldLabel(field: string): string {
  return STATUS_BY_LABELS[field] || field
}

// ============================================================
// Fourth Column Bucket Configuration (Trade Queue)
// ============================================================

export type FourthColumnView = 'deciding' | 'executed' | 'archived' | 'deleted'

export const FOURTH_COLUMN_CONFIG: Record<FourthColumnView, {
  label: string
  description: string
  statuses: TradeQueueStatus[]
}> = {
  deciding: {
    label: 'Deciding',
    description: 'Ideas ready for final decision',
    statuses: ['deciding'],
  },
  executed: {
    label: 'Executed',
    description: 'Approved and finalized decisions',
    statuses: ['approved'],
  },
  archived: {
    label: 'Archived',
    description: 'Rejected or cancelled ideas',
    statuses: ['rejected', 'cancelled'],
  },
  deleted: {
    label: 'Deleted',
    description: 'Soft-deleted items',
    statuses: ['deleted'],
  },
}

/**
 * Get statuses to filter by for a given fourth column view
 */
export function getStatusesForFourthColumn(view: FourthColumnView): TradeQueueStatus[] {
  return FOURTH_COLUMN_CONFIG[view].statuses
}
