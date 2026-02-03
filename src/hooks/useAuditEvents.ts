import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  queryAuditEvents,
  getEntityAuditEvents,
  getEntityTreeAuditEvents,
  emitAuditEvent,
  type AuditEventFilters,
  type AuditEventQueryOptions,
  type EmitAuditEventParams,
  type EntityType,
  type AuditEvent,
} from '../lib/audit'

/**
 * Hook to query audit events with filters
 *
 * Returns paginated audit events matching the provided filters.
 * Requires at least a date range filter to prevent huge queries.
 */
export function useAuditEvents(
  filters: AuditEventFilters,
  options: AuditEventQueryOptions = {},
  enabled = true
) {
  // Require date range to prevent huge queries
  const hasRequiredFilters = !!filters.dateRange

  return useQuery({
    queryKey: ['audit-events', filters, options],
    queryFn: () => queryAuditEvents(filters, options),
    enabled: enabled && hasRequiredFilters,
    staleTime: 30000, // 30 seconds
  })
}

/**
 * Hook to get audit events for a specific entity
 *
 * Use this on entity detail pages to show the history timeline.
 * Returns { events: AuditEvent[] } for consistency with other query hooks.
 */
export function useEntityAuditEvents(
  entityType: EntityType | null,
  entityId: string | null,
  options: AuditEventQueryOptions = {}
) {
  return useQuery({
    queryKey: ['audit-events', 'entity', entityType, entityId, options],
    queryFn: async () => {
      const events = await getEntityAuditEvents(entityType!, entityId!, options)
      return { events }
    },
    enabled: !!entityType && !!entityId,
    staleTime: 30000,
  })
}

/**
 * Hook to get audit events for an entity and its children
 *
 * Use this to trace relationships like trade_idea -> order -> execution.
 */
export function useEntityTreeAuditEvents(
  entityType: EntityType | null,
  entityId: string | null,
  options: AuditEventQueryOptions = {}
) {
  return useQuery({
    queryKey: ['audit-events', 'tree', entityType, entityId, options],
    queryFn: () => getEntityTreeAuditEvents(entityType!, entityId!, options),
    enabled: !!entityType && !!entityId,
    staleTime: 30000,
  })
}

/**
 * Hook to emit audit events
 *
 * Use this when you need to manually emit an audit event from a component.
 * Most audit events should be emitted from service functions instead.
 */
export function useEmitAuditEvent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: EmitAuditEventParams) => emitAuditEvent(params),
    onSuccess: () => {
      // Invalidate audit event queries to show new event
      queryClient.invalidateQueries({ queryKey: ['audit-events'] })
    },
  })
}

/**
 * Hook to get the total count of audit events matching filters
 *
 * Useful for showing counts in UI without fetching all events.
 */
export function useAuditEventCount(filters: AuditEventFilters, enabled = true) {
  return useQuery({
    queryKey: ['audit-events', 'count', filters],
    queryFn: async () => {
      const result = await queryAuditEvents(filters, { limit: 1 })
      return result.totalCount
    },
    enabled,
    staleTime: 60000, // 1 minute
  })
}

/**
 * Map internal stage names to user-friendly labels
 */
const STAGE_LABELS: Record<string, string> = {
  idea: 'Ideas',
  discussing: 'Working On',
  working_on: 'Working On',
  simulating: 'Modeling',
  modeling: 'Modeling',
  deciding: 'Deciding',
  approved: 'Committed',
  rejected: 'Rejected',
  cancelled: 'Deferred',
  archived: 'Archived',
  executed: 'Executed',
}

/**
 * Map outcome values to user-friendly labels
 */
const OUTCOME_LABELS: Record<string, string> = {
  executed: 'Executed',
  rejected: 'Rejected',
  deferred: 'Deferred',
  accepted: 'Committed',
}

/**
 * Get user-friendly stage label
 */
function getStageLabel(stage: string | undefined): string {
  if (!stage) return 'unknown'
  return STAGE_LABELS[stage] || stage
}

/**
 * Get a human-readable summary of an audit event
 */
export function formatEventSummary(event: AuditEvent): string {
  const actor = event.actor_name?.split(' ')[0] || event.actor_email?.split('@')[0] || null

  switch (event.action_type) {
    case 'create':
      return actor ? `${actor} created this trade` : 'Trade created'
    case 'delete':
      return actor ? `${actor} moved to trash` : 'Moved to trash'
    case 'restore':
      return actor ? `${actor} restored from trash` : 'Restored from trash'
    case 'move_stage':
      const toStage = event.to_state?.stage || event.to_state?.workflow_stage || event.to_state?.status
      return actor ? `${actor} moved to ${getStageLabel(toStage)}` : `Moved to ${getStageLabel(toStage)}`
    case 'set_outcome':
      const outcome = event.to_state?.outcome || event.to_state?.workflow_outcome
      const outcomeLabel = OUTCOME_LABELS[outcome] || outcome
      return actor ? `${actor} marked as ${outcomeLabel}` : `Marked as ${outcomeLabel}`
    case 'update_field':
    case 'update_fields':
      const fields = event.changed_fields?.join(', ') || 'details'
      return actor ? `${actor} updated ${fields}` : `Updated ${fields}`
    case 'set_rating':
      return actor ? `${actor} changed rating` : 'Rating changed'
    case 'set_price_target':
      return actor ? `${actor} updated price target` : 'Price target updated'
    case 'attach':
      return 'Added to portfolio'
    case 'detach':
      return 'Removed from portfolio'
    case 'auto_archive':
      return 'Automatically archived'
    default:
      return actor ? `${actor} made changes` : 'Changes made'
  }
}

/**
 * Get the appropriate icon name for an action type
 */
export function getActionIcon(actionType: string): string {
  switch (actionType) {
    case 'create':
      return 'Plus'
    case 'delete':
      return 'Trash2'
    case 'restore':
      return 'RotateCcw'
    case 'move_stage':
      return 'ArrowRight'
    case 'set_outcome':
      return 'CheckCircle2'
    case 'update_field':
    case 'update_fields':
      return 'Edit2'
    case 'set_rating':
      return 'Star'
    case 'set_price_target':
      return 'Target'
    case 'assign_coverage':
      return 'UserPlus'
    case 'remove_coverage':
      return 'UserMinus'
    case 'auto_archive':
      return 'Archive'
    case 'attach':
      return 'Link2'
    case 'detach':
      return 'Unlink'
    default:
      return 'Activity'
  }
}

/**
 * Get the appropriate color for an action category
 */
export function getActionCategoryColor(category: string): string {
  switch (category) {
    case 'lifecycle':
      return 'blue'
    case 'state_change':
      return 'amber'
    case 'field_edit':
      return 'green'
    case 'relationship':
      return 'purple'
    case 'access':
      return 'gray'
    case 'system':
      return 'red'
    default:
      return 'gray'
  }
}
