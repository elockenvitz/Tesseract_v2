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

import type { TradeQueueStatus } from '../types/trading'
import type { DecisionStage } from '../types/outcomes'

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
