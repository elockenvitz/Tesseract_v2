/**
 * Audit System Types
 *
 * Canonical type definitions for the unified audit event model.
 * These types are the single source of truth for audit logging.
 */

// ============================================================
// Entity Types
// ============================================================

export type EntityType =
  | 'trade_idea'
  | 'pair_trade'
  | 'order'
  | 'execution'
  | 'asset'
  | 'coverage'
  | 'portfolio'
  | 'simulation'
  | 'user'
  | 'team'
  | 'comment'
  | 'attachment'
  | 'audit_explorer'
  | 'layout_template'

// ============================================================
// Action Types
// ============================================================

export type ActionCategory =
  | 'lifecycle'          // create, delete, restore, archive
  | 'state_change'       // workflow transitions
  | 'field_edit'         // individual field updates
  | 'relationship'       // attach, detach, link, unlink
  | 'access'             // view, export, share
  | 'system'             // auto_archive, scheduled jobs
  | 'research_layout'    // layout template CRUD and customization

export type ActionType =
  // Lifecycle
  | 'create'
  | 'delete'
  | 'restore'
  | 'archive'
  | 'auto_archive'
  | 'hard_delete'

  // State changes (workflow)
  | 'move_stage'
  | 'set_outcome'
  | 'escalate'
  | 'demote'

  // Field edits
  | 'update_field'
  | 'update_fields'
  | 'set_rating'
  | 'set_price_target'
  | 'set_thesis'
  | 'set_risk_flags'

  // Relationships
  | 'attach'
  | 'detach'
  | 'link'
  | 'unlink'
  | 'assign_coverage'
  | 'remove_coverage'
  | 'transfer_ownership'

  // Access (for sensitive audit trails)
  | 'view'
  | 'export'
  | 'share'

  // System
  | 'backfill'
  | 'migrate'
  | 'reconcile'

// ============================================================
// Actor Types
// ============================================================

export type ActorType = 'user' | 'system' | 'api_key' | 'webhook' | 'migration'

export interface Actor {
  id: string | null
  type: ActorType
  role?: string
}

export const SYSTEM_ACTORS = {
  AUTO_ARCHIVE: {
    id: null,
    type: 'system' as const,
    role: 'system:auto_archive',
  },
  SCHEDULED_JOB: {
    id: null,
    type: 'system' as const,
    role: 'system:scheduler',
  },
  DATA_MIGRATION: {
    id: null,
    type: 'migration' as const,
    role: 'system:migration',
  },
  WEBHOOK_HANDLER: {
    id: null,
    type: 'webhook' as const,
    role: 'system:webhook',
  },
  BACKFILL: {
    id: null,
    type: 'migration' as const,
    role: 'system:backfill',
  },
} as const

// ============================================================
// State Types
// ============================================================

export interface StateSnapshot {
  [key: string]: unknown
}

// ============================================================
// Metadata Types
// ============================================================

export interface AuditEventMetadata {
  // Request context
  request_id?: string
  session_id?: string
  ip_address?: string
  user_agent?: string

  // UI context
  ui_source?: 'drag_drop' | 'modal' | 'bulk_action' | 'keyboard' | 'api' | 'form' | string
  page_path?: string

  // Bulk operations
  batch_id?: string
  batch_index?: number
  batch_total?: number

  // Business context
  reason?: string
  reason_code?: string

  // Compliance
  approval_id?: string
  compliance_flag?: string

  // Backfill/migration markers
  backfill?: boolean
  backfill_date?: string
  migration_version?: string

  // Visibility tier (for retention)
  visibility_tier?: 'active' | 'trash' | 'archive'

  // Extensible
  [key: string]: unknown
}

// ============================================================
// Audit Event Types
// ============================================================

export interface AuditEvent {
  id: string
  occurred_at: string
  recorded_at: string

  actor_id: string | null
  actor_type: ActorType
  actor_role: string | null

  entity_type: EntityType
  entity_id: string
  entity_display_name: string | null

  parent_entity_type: EntityType | null
  parent_entity_id: string | null

  action_type: ActionType
  action_category: ActionCategory

  from_state: StateSnapshot | null
  to_state: StateSnapshot | null
  changed_fields: string[] | null

  metadata: AuditEventMetadata

  search_text: string | null
  actor_email: string | null
  actor_name: string | null
  asset_symbol: string | null

  org_id: string
  team_id: string | null

  checksum: string
}

// ============================================================
// Emit Event Parameters
// ============================================================

export interface EmitAuditEventParams {
  actor: Actor
  entity: {
    type: EntityType
    id: string
    displayName?: string
  }
  parent?: {
    type: EntityType
    id: string
  }
  action: {
    type: ActionType
    category: ActionCategory
  }
  state: {
    from?: StateSnapshot | null
    to?: StateSnapshot | null
  }
  changedFields?: string[]
  metadata?: AuditEventMetadata
  orgId: string
  teamId?: string
  // Optional denormalized fields
  actorEmail?: string
  actorName?: string
  assetSymbol?: string
}

// ============================================================
// Query Types
// ============================================================

export interface AuditEventFilters {
  dateRange?: {
    start: string
    end: string
  }
  entityType?: EntityType | EntityType[]
  entityId?: string
  parentEntityType?: EntityType
  parentEntityId?: string
  actorId?: string
  actionType?: ActionType | ActionType[]
  actionCategory?: ActionCategory | ActionCategory[]
  assetSymbol?: string
  searchText?: string
  includeDeleted?: boolean
  includeArchived?: boolean
  batchId?: string
}

export interface AuditEventQueryOptions {
  limit?: number
  offset?: number
  orderBy?: 'occurred_at' | 'recorded_at'
  orderDirection?: 'asc' | 'desc'
}

export interface AuditEventQueryResult {
  events: AuditEvent[]
  totalCount: number
  hasMore: boolean
}

// ============================================================
// Saved Search Types
// ============================================================

export interface SavedAuditSearch {
  id: string
  name: string
  filters: AuditEventFilters
  created_by: string
  is_shared: boolean
  created_at: string
  updated_at: string
}
