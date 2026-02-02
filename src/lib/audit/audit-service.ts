/**
 * Audit Service
 *
 * Core service for emitting and querying audit events.
 * This is the single entry point for all audit logging.
 */

import { supabase } from '../supabase'
import { calculateChecksum } from './checksum'
import type {
  AuditEvent,
  AuditEventFilters,
  AuditEventQueryOptions,
  AuditEventQueryResult,
  EmitAuditEventParams,
  StateSnapshot,
} from './types'

// ============================================================
// Emit Audit Event
// ============================================================

/**
 * Emit an audit event to the log
 *
 * This is the primary function for recording audit events.
 * All mutations to audited entities should call this function.
 *
 * @param params - Event parameters
 * @returns The created event ID, or null if logging failed
 */
export async function emitAuditEvent(params: EmitAuditEventParams): Promise<string | null> {
  const {
    actor,
    entity,
    parent,
    action,
    state,
    changedFields,
    metadata = {},
    orgId,
    teamId,
    actorEmail,
    actorName,
    assetSymbol,
  } = params

  const occurredAt = new Date().toISOString()

  // Build search text for full-text search
  const searchTextParts = [
    entity.displayName,
    action.type,
    metadata.reason,
    changedFields?.join(' '),
    assetSymbol,
    actorEmail,
  ].filter(Boolean)
  const searchText = searchTextParts.length > 0 ? searchTextParts.join(' ') : null

  // Calculate checksum for tamper detection
  const checksum = await calculateChecksum({
    occurred_at: occurredAt,
    actor_id: actor.id,
    actor_type: actor.type,
    entity_type: entity.type,
    entity_id: entity.id,
    action_type: action.type,
    from_state: state.from || null,
    to_state: state.to || null,
    org_id: orgId,
  })

  try {
    const { data, error } = await supabase
      .from('audit_events')
      .insert({
        occurred_at: occurredAt,
        actor_id: actor.id,
        actor_type: actor.type,
        actor_role: actor.role || null,
        entity_type: entity.type,
        entity_id: entity.id,
        entity_display_name: entity.displayName || null,
        parent_entity_type: parent?.type || null,
        parent_entity_id: parent?.id || null,
        action_type: action.type,
        action_category: action.category,
        from_state: state.from || null,
        to_state: state.to || null,
        changed_fields: changedFields || null,
        metadata,
        search_text: searchText,
        actor_email: actorEmail || null,
        actor_name: actorName || null,
        asset_symbol: assetSymbol || null,
        org_id: orgId,
        team_id: teamId || null,
        checksum,
      })
      .select('id')
      .single()

    if (error) {
      console.error('[AUDIT] Failed to emit event:', error)
      // Don't throw - audit logging should not break main flow
      // In production, send to error tracking service
      return null
    }

    return data?.id || null
  } catch (err) {
    console.error('[AUDIT] Exception emitting event:', err)
    return null
  }
}

// ============================================================
// Idempotency Check
// ============================================================

/**
 * Check if an event with the same request_id already exists
 *
 * Use this to prevent duplicate events from retries.
 */
export async function checkIdempotency(params: {
  requestId: string
  entityType: string
  entityId: string
  actionType: string
}): Promise<boolean> {
  const { requestId, entityType, entityId, actionType } = params

  const { data, error } = await supabase
    .from('audit_events')
    .select('id')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .eq('action_type', actionType)
    .contains('metadata', { request_id: requestId })
    .limit(1)

  if (error) {
    console.error('[AUDIT] Idempotency check failed:', error)
    return false // Proceed if check fails
  }

  return data !== null && data.length > 0
}

// ============================================================
// Query Audit Events
// ============================================================

/**
 * Query audit events with filters
 */
export async function queryAuditEvents(
  filters: AuditEventFilters,
  options: AuditEventQueryOptions = {}
): Promise<AuditEventQueryResult> {
  const {
    limit = 50,
    offset = 0,
    orderBy = 'occurred_at',
    orderDirection = 'desc',
  } = options

  let query = supabase
    .from('audit_events')
    .select('*', { count: 'exact' })

  // Apply filters
  if (filters.dateRange) {
    query = query
      .gte('occurred_at', filters.dateRange.start)
      .lte('occurred_at', filters.dateRange.end)
  }

  if (filters.entityType) {
    if (Array.isArray(filters.entityType)) {
      query = query.in('entity_type', filters.entityType)
    } else {
      query = query.eq('entity_type', filters.entityType)
    }
  }

  if (filters.entityId) {
    query = query.eq('entity_id', filters.entityId)
  }

  if (filters.parentEntityType) {
    query = query.eq('parent_entity_type', filters.parentEntityType)
  }

  if (filters.parentEntityId) {
    query = query.eq('parent_entity_id', filters.parentEntityId)
  }

  if (filters.actorId) {
    query = query.eq('actor_id', filters.actorId)
  }

  if (filters.actionType) {
    if (Array.isArray(filters.actionType)) {
      query = query.in('action_type', filters.actionType)
    } else {
      query = query.eq('action_type', filters.actionType)
    }
  }

  if (filters.actionCategory) {
    if (Array.isArray(filters.actionCategory)) {
      query = query.in('action_category', filters.actionCategory)
    } else {
      query = query.eq('action_category', filters.actionCategory)
    }
  }

  if (filters.assetSymbol) {
    query = query.eq('asset_symbol', filters.assetSymbol)
  }

  if (filters.batchId) {
    query = query.contains('metadata', { batch_id: filters.batchId })
  }

  if (filters.searchText) {
    query = query.textSearch('search_text', filters.searchText)
  }

  // Visibility filters
  if (!filters.includeArchived) {
    // Exclude archived items (visibility_tier = 'archive' in metadata)
    query = query.or('metadata->visibility_tier.is.null,metadata->visibility_tier.neq.archive')
  }

  // Apply ordering
  query = query.order(orderBy, { ascending: orderDirection === 'asc' })

  // Apply pagination
  query = query.range(offset, offset + limit - 1)

  const { data, error, count } = await query

  if (error) {
    console.error('[AUDIT] Query failed:', error)
    throw new Error(`Audit query failed: ${error.message}`)
  }

  return {
    events: (data || []) as AuditEvent[],
    totalCount: count || 0,
    hasMore: (count || 0) > offset + limit,
  }
}

/**
 * Get audit events for a specific entity
 */
export async function getEntityAuditEvents(
  entityType: string,
  entityId: string,
  options: AuditEventQueryOptions = {}
): Promise<AuditEvent[]> {
  const { limit = 50, orderDirection = 'desc' } = options

  // Direct query for better reliability
  const { data, error } = await supabase
    .from('audit_events')
    .select('*')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('occurred_at', { ascending: orderDirection === 'asc' })
    .limit(limit)

  if (error) {
    console.error('[AUDIT] getEntityAuditEvents failed:', error)
    throw new Error(`Audit query failed: ${error.message}`)
  }

  return (data || []) as AuditEvent[]
}

/**
 * Get audit events for a parent entity and its children
 */
export async function getEntityTreeAuditEvents(
  entityType: string,
  entityId: string,
  options: AuditEventQueryOptions = {}
): Promise<AuditEvent[]> {
  const { limit = 100, orderDirection = 'desc' } = options

  // Query both direct events and child events
  const { data, error } = await supabase
    .from('audit_events')
    .select('*')
    .or(`and(entity_type.eq.${entityType},entity_id.eq.${entityId}),and(parent_entity_type.eq.${entityType},parent_entity_id.eq.${entityId})`)
    .order('occurred_at', { ascending: orderDirection === 'asc' })
    .limit(limit)

  if (error) {
    console.error('[AUDIT] Tree query failed:', error)
    throw new Error(`Audit tree query failed: ${error.message}`)
  }

  return (data || []) as AuditEvent[]
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Get changed fields between two state objects
 */
export function getChangedFields(
  from: StateSnapshot | null,
  to: StateSnapshot | null
): string[] {
  if (!from && !to) return []
  if (!from) return Object.keys(to || {})
  if (!to) return Object.keys(from)

  const allKeys = new Set([...Object.keys(from), ...Object.keys(to)])
  const changed: string[] = []

  for (const key of allKeys) {
    if (JSON.stringify(from[key]) !== JSON.stringify(to[key])) {
      changed.push(key)
    }
  }

  return changed
}

/**
 * Create a state snapshot from an object, excluding internal fields
 */
export function createStateSnapshot(
  obj: Record<string, unknown>,
  excludeFields: string[] = ['updated_at', 'created_at']
): StateSnapshot {
  const snapshot: StateSnapshot = {}

  for (const [key, value] of Object.entries(obj)) {
    if (!excludeFields.includes(key) && value !== undefined) {
      snapshot[key] = value
    }
  }

  return snapshot
}

/**
 * Format audit event for display
 */
export function formatAuditEventSummary(event: AuditEvent): string {
  const actor = event.actor_name || event.actor_email || event.actor_role || 'System'
  const entity = event.entity_display_name || `${event.entity_type}:${event.entity_id.slice(0, 8)}`
  const action = event.action_type.replace(/_/g, ' ')

  return `${actor} ${action} ${entity}`
}
