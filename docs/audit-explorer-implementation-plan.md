# Audit Explorer Implementation Plan

**Version**: 1.0
**Status**: Draft
**Author**: Staff Engineer
**Date**: 2026-02-01

---

## Executive Summary

This document defines the implementation plan for Tesseract's unified Audit Explorer system—an institutional-grade auditability layer that provides a single source of truth for all meaningful changes across the platform without cluttering normal workflow UI.

### Design Principles

1. **Single source of truth**: One `audit_events` table powers all history views
2. **Write-path enforcement**: All mutations flow through audited service functions
3. **Filter-first UI**: Audit Explorer shows nothing until filters applied
4. **Separation of concerns**: Workflow UI stays clean; audit lives in dedicated tool
5. **Extensible**: Schema supports future AI analysis ("why did we do this?")
6. **Institutional-grade**: Immutable, tamper-evident, compliant with SOC 2 / regulatory needs

---

## A. Canonical Event Model

### A.1 Core Schema

```sql
-- ============================================================
-- AUDIT EVENTS TABLE (Single Source of Truth)
-- ============================================================

CREATE TABLE audit_events (
  -- Identity
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Timing
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Actor
  actor_id UUID REFERENCES users(id),           -- NULL for system actions
  actor_type TEXT NOT NULL DEFAULT 'user',      -- 'user', 'system', 'api_key', 'webhook'
  actor_role TEXT,                              -- Role at time of action: 'analyst', 'pm', 'admin'

  -- Entity (what changed)
  entity_type TEXT NOT NULL,                    -- 'trade_idea', 'asset', 'coverage', 'order', etc.
  entity_id UUID NOT NULL,
  entity_display_name TEXT,                     -- Denormalized for search: "AAPL", "Buy NVDA idea"

  -- Parent Entity (for relationships)
  parent_entity_type TEXT,                      -- e.g., 'trade_idea' when entity is 'order'
  parent_entity_id UUID,

  -- Action
  action_type TEXT NOT NULL,                    -- See action taxonomy below
  action_category TEXT NOT NULL,                -- 'lifecycle', 'field_edit', 'relationship', 'access'

  -- State Change
  from_state JSONB,                             -- Previous state (NULL for creates)
  to_state JSONB,                               -- New state (NULL for deletes)
  changed_fields TEXT[],                        -- Array of field names that changed

  -- Context
  metadata JSONB NOT NULL DEFAULT '{}',

  -- Search optimization (denormalized)
  search_text TEXT,                             -- Concatenated searchable content

  -- Organizational context
  org_id UUID NOT NULL,
  team_id UUID,

  -- Immutability marker
  checksum TEXT NOT NULL                        -- SHA-256 of core fields for tamper detection
);

-- ============================================================
-- INDEXES
-- ============================================================

-- Primary query patterns
CREATE INDEX idx_audit_events_entity
  ON audit_events(entity_type, entity_id, occurred_at DESC);

CREATE INDEX idx_audit_events_actor
  ON audit_events(actor_id, occurred_at DESC)
  WHERE actor_id IS NOT NULL;

CREATE INDEX idx_audit_events_occurred_at
  ON audit_events(occurred_at DESC);

CREATE INDEX idx_audit_events_action
  ON audit_events(action_type, occurred_at DESC);

CREATE INDEX idx_audit_events_parent
  ON audit_events(parent_entity_type, parent_entity_id, occurred_at DESC)
  WHERE parent_entity_id IS NOT NULL;

-- Search
CREATE INDEX idx_audit_events_search
  ON audit_events USING gin(to_tsvector('english', search_text));

-- Organizational filtering
CREATE INDEX idx_audit_events_org
  ON audit_events(org_id, occurred_at DESC);

-- Composite for common filter patterns
CREATE INDEX idx_audit_events_entity_action
  ON audit_events(entity_type, action_type, occurred_at DESC);

-- ============================================================
-- PARTITIONING (for scale)
-- ============================================================

-- Partition by month for efficient retention management
-- Implementation note: Convert to partitioned table when volume exceeds 10M rows

-- Example partition strategy:
-- CREATE TABLE audit_events (
--   ...
-- ) PARTITION BY RANGE (occurred_at);
--
-- CREATE TABLE audit_events_2026_01 PARTITION OF audit_events
--   FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

-- ============================================================
-- CONSTRAINTS
-- ============================================================

ALTER TABLE audit_events ADD CONSTRAINT valid_entity_type
  CHECK (entity_type IN (
    'trade_idea', 'pair_trade', 'order', 'execution',
    'asset', 'coverage', 'portfolio', 'simulation',
    'user', 'team', 'comment', 'attachment'
  ));

ALTER TABLE audit_events ADD CONSTRAINT valid_action_category
  CHECK (action_category IN (
    'lifecycle',      -- create, delete, restore, archive
    'state_change',   -- workflow transitions
    'field_edit',     -- individual field updates
    'relationship',   -- attach, detach, link, unlink
    'access',         -- view, export, share
    'system'          -- auto_archive, scheduled jobs
  ));

ALTER TABLE audit_events ADD CONSTRAINT valid_actor_type
  CHECK (actor_type IN ('user', 'system', 'api_key', 'webhook', 'migration'));

-- Immutability: No updates or deletes allowed
-- Enforced via RLS + application layer
```

### A.2 Action Taxonomy

```typescript
// src/lib/audit/types.ts

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

export type ActionCategory =
  | 'lifecycle'
  | 'state_change'
  | 'field_edit'
  | 'relationship'
  | 'access'
  | 'system'

export type ActionType =
  // Lifecycle
  | 'create'
  | 'delete'
  | 'restore'
  | 'archive'
  | 'auto_archive'
  | 'hard_delete'      // Compliance-only, requires elevated permission

  // State changes (workflow)
  | 'move_stage'       // idea -> discussing -> simulating -> deciding
  | 'set_outcome'      // executed, rejected, deferred
  | 'escalate'
  | 'demote'

  // Field edits
  | 'update_field'     // Single field
  | 'update_fields'    // Multiple fields in one save
  | 'set_rating'
  | 'set_price_target'
  | 'set_thesis'
  | 'set_risk_flags'

  // Relationships
  | 'attach'           // Add to lab, add to portfolio
  | 'detach'
  | 'link'             // trade_idea -> order
  | 'unlink'
  | 'assign_coverage'
  | 'remove_coverage'
  | 'transfer_ownership'

  // Access (optional, for sensitive audit trails)
  | 'view'
  | 'export'
  | 'share'

  // System
  | 'backfill'
  | 'migrate'
  | 'reconcile'

export interface AuditEventMetadata {
  // Request context
  request_id?: string           // Idempotency key
  session_id?: string
  ip_address?: string           // Hashed or last octet only
  user_agent?: string

  // UI context
  ui_source?: string            // 'drag_drop', 'modal', 'bulk_action', 'keyboard'
  page_path?: string

  // Bulk operations
  batch_id?: string             // Groups related bulk actions
  batch_index?: number          // Position in batch
  batch_total?: number          // Total items in batch

  // Business context
  reason?: string               // User-provided reason for change
  reason_code?: string          // Structured reason: 'error_correction', 'new_info', etc.

  // Compliance
  approval_id?: string          // If change required approval
  compliance_flag?: string      // 'material_change', 'restricted_asset', etc.

  // AI/Future
  confidence_score?: number     // If AI-assisted
  model_version?: string
}

export interface AuditEvent {
  id: string
  occurred_at: string
  recorded_at: string

  actor_id: string | null
  actor_type: 'user' | 'system' | 'api_key' | 'webhook' | 'migration'
  actor_role: string | null

  entity_type: EntityType
  entity_id: string
  entity_display_name: string | null

  parent_entity_type: EntityType | null
  parent_entity_id: string | null

  action_type: ActionType
  action_category: ActionCategory

  from_state: Record<string, unknown> | null
  to_state: Record<string, unknown> | null
  changed_fields: string[] | null

  metadata: AuditEventMetadata

  org_id: string
  team_id: string | null

  checksum: string
}
```

### A.3 System Actor Representation

```typescript
// System actors are represented with actor_id = NULL and actor_type = 'system'

const SYSTEM_ACTORS = {
  AUTO_ARCHIVE: {
    actor_id: null,
    actor_type: 'system' as const,
    actor_role: 'system:auto_archive',
  },
  SCHEDULED_JOB: {
    actor_id: null,
    actor_type: 'system' as const,
    actor_role: 'system:scheduler',
  },
  DATA_MIGRATION: {
    actor_id: null,
    actor_type: 'migration' as const,
    actor_role: 'system:migration',
  },
  WEBHOOK_HANDLER: {
    actor_id: null,
    actor_type: 'webhook' as const,
    actor_role: 'system:webhook',
  },
}
```

### A.4 Checksum Calculation (Tamper Detection)

```typescript
import { createHash } from 'crypto'

function calculateChecksum(event: Omit<AuditEvent, 'id' | 'checksum' | 'recorded_at'>): string {
  const payload = JSON.stringify({
    occurred_at: event.occurred_at,
    actor_id: event.actor_id,
    actor_type: event.actor_type,
    entity_type: event.entity_type,
    entity_id: event.entity_id,
    action_type: event.action_type,
    from_state: event.from_state,
    to_state: event.to_state,
    org_id: event.org_id,
  })

  return createHash('sha256').update(payload).digest('hex')
}
```

### A.5 Retention Strategy

| Tier | Duration | Storage | Queryable | UI Visible |
|------|----------|---------|-----------|------------|
| Hot | 0-90 days | Primary DB | Full speed | Yes |
| Warm | 90 days - 2 years | Primary DB (older partitions) | Slightly slower | Yes (with warning) |
| Cold | 2-7 years | Archive storage (S3/Glacier) | On-demand restore | Compliance only |
| Purge | >7 years | Deleted | No | No |

```sql
-- Retention policy implementation
-- Run monthly via pg_cron or external scheduler

-- Move to cold storage (export + delete from primary)
-- Keep: id, occurred_at, entity_type, entity_id, action_type, actor_id, checksum
-- Archive: full record to S3

CREATE OR REPLACE FUNCTION archive_old_audit_events()
RETURNS void AS $$
BEGIN
  -- Export events older than 2 years to archive
  -- (Implementation depends on your archive storage solution)

  -- After successful archive, optionally compress in-place
  -- by removing detailed from_state/to_state for events > 2 years
  UPDATE audit_events
  SET
    from_state = jsonb_build_object('_archived', true),
    to_state = jsonb_build_object('_archived', true),
    metadata = metadata || jsonb_build_object('archived_at', NOW())
  WHERE occurred_at < NOW() - INTERVAL '2 years'
    AND from_state->>'_archived' IS NULL;
END;
$$ LANGUAGE plpgsql;
```

---

## B. Data Sources + Migration Strategy

### B.1 History Domain Inventory

| Domain | Current Source | Priority | Backfill Needed | Complexity |
|--------|----------------|----------|-----------------|------------|
| Trade Idea State | `trade_queue_items.status` changes | P0 | Yes (limited) | Medium |
| Trade Idea Edits | None (lost) | P0 | No | Low |
| Coverage Changes | `coverage_history` table | P1 | Migrate existing | Medium |
| Asset Field Edits | `asset_field_history` (partial) | P2 | Partial migrate | Medium |
| Order Lifecycle | `orders` + `executions` | P2 | Join existing | High |
| Simulation Changes | None | P3 | No | Low |
| User/Team Changes | None | P3 | No | Low |
| Comments/Attachments | Existing tables | P3 | Optional | Low |

### B.2 Additional Recommended Domains

Beyond the five you listed, I recommend adding:

1. **Simulation/Lab History** (P2)
   - Lab creation, trade additions, commits
   - Critical for "why did we size it this way?" analysis
   - Links trade ideas to actual expression

2. **Portfolio Changes** (P2)
   - Benchmark changes, strategy updates
   - Compliance cares about mandate drift

3. **User Permission Changes** (P3)
   - Who granted access when
   - Required for SOC 2 compliance

4. **Data Import Events** (P3)
   - When external data was refreshed
   - Explains "why did our model change?"

5. **Alert/Notification History** (P4)
   - What alerts fired and when
   - Useful for "did anyone see this risk flag?"

### B.3 Phase 1: Trade Ideas (Weeks 1-3)

**Scope**: Trade idea lifecycle, state transitions, field edits, delete/restore

**Build**:
```typescript
// 1. Create audit_events table (migration)
// 2. Implement audit service

// src/lib/audit/audit-service.ts
import { supabase } from '../supabase'
import type { AuditEvent, AuditEventMetadata, EntityType, ActionType } from './types'

interface EmitAuditEventParams {
  actor: { id: string | null; type: string; role?: string }
  entity: { type: EntityType; id: string; displayName?: string }
  parent?: { type: EntityType; id: string }
  action: { type: ActionType; category: string }
  state: { from?: Record<string, unknown>; to?: Record<string, unknown> }
  changedFields?: string[]
  metadata?: AuditEventMetadata
  orgId: string
  teamId?: string
}

export async function emitAuditEvent(params: EmitAuditEventParams): Promise<void> {
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
  } = params

  const occurredAt = new Date().toISOString()

  // Build search text
  const searchText = [
    entity.displayName,
    action.type,
    metadata.reason,
    changedFields?.join(' '),
  ].filter(Boolean).join(' ')

  // Calculate checksum
  const checksum = calculateChecksum({
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

  const { error } = await supabase.from('audit_events').insert({
    occurred_at: occurredAt,
    actor_id: actor.id,
    actor_type: actor.type,
    actor_role: actor.role,
    entity_type: entity.type,
    entity_id: entity.id,
    entity_display_name: entity.displayName,
    parent_entity_type: parent?.type,
    parent_entity_id: parent?.id,
    action_type: action.type,
    action_category: action.category,
    from_state: state.from || null,
    to_state: state.to || null,
    changed_fields: changedFields,
    metadata,
    search_text: searchText,
    org_id: orgId,
    team_id: teamId,
    checksum,
  })

  if (error) {
    // Log but don't throw - audit should not break main flow
    console.error('[AUDIT] Failed to emit event:', error)
    // In production: send to error tracking, maybe retry queue
  }
}

// 3. Integrate with trade state machine
// Update moveTrade(), deleteTrade(), restoreTrade() to call emitAuditEvent()
```

**Backfill**:
```sql
-- Limited backfill from existing data
-- Only creates "snapshot" events, not full history

INSERT INTO audit_events (
  occurred_at,
  actor_id,
  actor_type,
  actor_role,
  entity_type,
  entity_id,
  entity_display_name,
  action_type,
  action_category,
  to_state,
  metadata,
  org_id,
  checksum
)
SELECT
  t.created_at,
  t.created_by,
  'user',
  NULL,
  'trade_idea',
  t.id,
  CONCAT(a.symbol, ' ', t.action),
  'create',
  'lifecycle',
  jsonb_build_object(
    'status', t.status,
    'action', t.action,
    'urgency', t.urgency,
    'asset_id', t.asset_id
  ),
  jsonb_build_object('backfill', true, 'backfill_date', NOW()),
  t.org_id,
  '' -- Checksum computed by trigger
FROM trade_queue_items t
JOIN assets a ON a.id = t.asset_id
WHERE NOT EXISTS (
  SELECT 1 FROM audit_events ae
  WHERE ae.entity_type = 'trade_idea'
    AND ae.entity_id = t.id
    AND ae.action_type = 'create'
);
```

**Deprecate**: Nothing yet (additive change)

**Avoid Breaking**: Existing Trade Queue UI continues to work; Audit Explorer is additive

**Acceptance Criteria**:
- [ ] Every `moveTrade()` call emits audit event
- [ ] Every `deleteTrade()` call emits audit event
- [ ] Every `restoreTrade()` call emits audit event
- [ ] Trade idea field edits emit audit events
- [ ] Backfill script successfully creates initial events
- [ ] Events are immutable (no UPDATE/DELETE allowed)

### B.4 Phase 2: Coverage Changes (Weeks 4-5)

**Scope**: Primary/secondary coverage assignments, analyst changes

**Build**:
```typescript
// Wrap coverage mutations in audit-emitting functions

export async function assignCoverage(params: {
  assetId: string
  analystId: string
  coverageType: 'primary' | 'secondary' | 'portfolio'
  portfolioId?: string
  actorId: string
}): Promise<void> {
  const { assetId, analystId, coverageType, portfolioId, actorId } = params

  // Get current state
  const currentCoverage = await getCurrentCoverage(assetId)

  // Perform mutation
  await supabase.from('coverage_assignments').upsert({
    asset_id: assetId,
    analyst_id: analystId,
    coverage_type: coverageType,
    portfolio_id: portfolioId,
  })

  // Emit audit event
  await emitAuditEvent({
    actor: { id: actorId, type: 'user' },
    entity: {
      type: 'coverage',
      id: `${assetId}-${coverageType}`,
      displayName: `${coverageType} coverage`,
    },
    parent: { type: 'asset', id: assetId },
    action: { type: 'assign_coverage', category: 'relationship' },
    state: {
      from: currentCoverage ? { analyst_id: currentCoverage.analyst_id } : null,
      to: { analyst_id: analystId, coverage_type: coverageType },
    },
    metadata: { portfolio_id: portfolioId },
    orgId: await getOrgId(actorId),
  })
}
```

**Backfill**: Migrate existing `coverage_history` table
```sql
INSERT INTO audit_events (...)
SELECT ... FROM coverage_history
-- Map old schema to new event schema
```

**Deprecate**: `coverage_history` table (after migration verified)

**Acceptance Criteria**:
- [ ] All coverage assignment changes emit audit events
- [ ] Historical coverage data migrated
- [ ] Coverage timeline on Asset page powered by audit_events
- [ ] Old coverage_history table no longer written to

### B.5 Phase 3: Asset Field History (Weeks 6-7)

**Scope**: Thesis, rating, price target, risk flags, catalysts, key metrics

**Build**:
```typescript
// Track specific high-value fields
const AUDITED_ASSET_FIELDS = [
  'thesis',
  'rating',
  'price_target',
  'risk_flags',
  'catalysts',
  'investment_summary',
  'bull_case',
  'bear_case',
  'key_metrics',
] as const

export async function updateAssetField(params: {
  assetId: string
  field: typeof AUDITED_ASSET_FIELDS[number]
  value: unknown
  actorId: string
  reason?: string
}): Promise<void> {
  const { assetId, field, value, actorId, reason } = params

  // Get current value
  const { data: asset } = await supabase
    .from('assets')
    .select(field)
    .eq('id', assetId)
    .single()

  const previousValue = asset?.[field]

  // Skip if no change
  if (JSON.stringify(previousValue) === JSON.stringify(value)) {
    return
  }

  // Perform update
  await supabase
    .from('assets')
    .update({ [field]: value, updated_at: new Date().toISOString() })
    .eq('id', assetId)

  // Emit audit event
  await emitAuditEvent({
    actor: { id: actorId, type: 'user' },
    entity: { type: 'asset', id: assetId },
    action: {
      type: field === 'rating' ? 'set_rating' :
            field === 'price_target' ? 'set_price_target' :
            field === 'thesis' ? 'set_thesis' :
            'update_field',
      category: 'field_edit',
    },
    state: {
      from: { [field]: previousValue },
      to: { [field]: value },
    },
    changedFields: [field],
    metadata: { reason },
    orgId: await getAssetOrgId(assetId),
  })
}
```

**Backfill**: Partial (only if `asset_field_history` exists)

**Deprecate**: Inline field history components (replace with unified Timeline)

### B.6 Phase 4: Order/Execution Lifecycle (Weeks 8-10)

**Scope**: Order creation, fills, amendments, cancellations, links to trade ideas

**Build**:
```typescript
// Order lifecycle events
export async function createOrder(params: CreateOrderParams): Promise<Order> {
  // ... order creation logic ...

  await emitAuditEvent({
    actor: { id: params.actorId, type: 'user' },
    entity: { type: 'order', id: order.id, displayName: `${order.side} ${order.symbol}` },
    parent: params.tradeIdeaId
      ? { type: 'trade_idea', id: params.tradeIdeaId }
      : undefined,
    action: { type: 'create', category: 'lifecycle' },
    state: { to: orderToState(order) },
    metadata: { source: params.source },
    orgId: params.orgId,
  })

  return order
}

export async function recordExecution(params: RecordExecutionParams): Promise<Execution> {
  // ... execution recording logic ...

  await emitAuditEvent({
    actor: { id: null, type: 'system', role: 'system:oms' },
    entity: { type: 'execution', id: execution.id },
    parent: { type: 'order', id: params.orderId },
    action: { type: 'create', category: 'lifecycle' },
    state: { to: executionToState(execution) },
    metadata: { venue: execution.venue, fill_id: execution.external_id },
    orgId: params.orgId,
  })

  return execution
}
```

**Backfill**: Join orders + executions tables to create historical events

---

## C. Write-Path Enforcement

### C.1 Architecture Decision: Application Layer vs DB Triggers

**Recommendation: Application Layer (Service Functions)**

| Factor | Application Layer | DB Triggers |
|--------|-------------------|-------------|
| Context richness | Full (actor, UI source, reason) | Limited (no HTTP context) |
| Testability | Easy to unit test | Harder to test |
| Debuggability | Standard debugging | Trigger debugging is painful |
| Performance | Async possible | Synchronous |
| Portability | Works with any DB | Postgres-specific |
| Bypass risk | Higher (must enforce) | Lower (always fires) |

**Mitigation for bypass risk**:
1. All mutations go through service layer (no direct Supabase client writes for audited entities)
2. RLS policies prevent direct writes to audited tables
3. Periodic reconciliation job detects drift

### C.2 Service Layer Pattern

```typescript
// src/lib/services/trade-idea-service.ts

import { emitAuditEvent } from '../audit/audit-service'
import { supabase } from '../supabase'

/**
 * TradeIdeaService - THE ONLY WAY to mutate trade ideas
 *
 * All UI components, API routes, and background jobs MUST use this service.
 * Direct Supabase writes are prohibited and blocked by RLS.
 */
export class TradeIdeaService {
  constructor(
    private actorId: string,
    private actorRole: string,
    private orgId: string,
    private requestId?: string
  ) {}

  async create(params: CreateTradeIdeaParams): Promise<TradeIdea> {
    const tradeIdea = await this.performCreate(params)

    await emitAuditEvent({
      actor: { id: this.actorId, type: 'user', role: this.actorRole },
      entity: {
        type: 'trade_idea',
        id: tradeIdea.id,
        displayName: `${params.action} ${params.symbol}`,
      },
      action: { type: 'create', category: 'lifecycle' },
      state: { to: this.toState(tradeIdea) },
      metadata: { request_id: this.requestId, ui_source: params.uiSource },
      orgId: this.orgId,
    })

    return tradeIdea
  }

  async move(tradeId: string, target: MoveTarget): Promise<void> {
    const before = await this.getTradeIdea(tradeId)
    await this.performMove(tradeId, target)
    const after = await this.getTradeIdea(tradeId)

    await emitAuditEvent({
      actor: { id: this.actorId, type: 'user', role: this.actorRole },
      entity: {
        type: 'trade_idea',
        id: tradeId,
        displayName: before.displayName,
      },
      action: {
        type: target.type === 'outcome' ? 'set_outcome' : 'move_stage',
        category: 'state_change',
      },
      state: { from: this.toState(before), to: this.toState(after) },
      changedFields: this.getChangedFields(before, after),
      metadata: { request_id: this.requestId },
      orgId: this.orgId,
    })
  }

  // ... delete, restore, updateField, etc.
}

// Factory function for easy instantiation
export function createTradeIdeaService(context: RequestContext): TradeIdeaService {
  return new TradeIdeaService(
    context.userId,
    context.userRole,
    context.orgId,
    context.requestId
  )
}
```

### C.3 Idempotency Strategy

```typescript
// Request ID based idempotency

interface IdempotencyCheck {
  requestId: string
  entityType: EntityType
  entityId: string
  actionType: ActionType
}

async function checkIdempotency(check: IdempotencyCheck): Promise<boolean> {
  const { data } = await supabase
    .from('audit_events')
    .select('id')
    .eq('entity_type', check.entityType)
    .eq('entity_id', check.entityId)
    .eq('action_type', check.actionType)
    .contains('metadata', { request_id: check.requestId })
    .limit(1)

  return data && data.length > 0
}

// In service methods:
async move(tradeId: string, target: MoveTarget): Promise<void> {
  if (this.requestId) {
    const isDuplicate = await checkIdempotency({
      requestId: this.requestId,
      entityType: 'trade_idea',
      entityId: tradeId,
      actionType: target.type === 'outcome' ? 'set_outcome' : 'move_stage',
    })

    if (isDuplicate) {
      console.log(`[IDEMPOTENCY] Skipping duplicate request ${this.requestId}`)
      return
    }
  }

  // ... proceed with mutation
}
```

### C.4 Bulk Action Handling

```typescript
// Each entity gets its own event, linked by batch_id

async function bulkMove(
  tradeIds: string[],
  target: MoveTarget,
  context: RequestContext
): Promise<BulkResult> {
  const batchId = crypto.randomUUID()
  const results: BulkResult = { succeeded: [], failed: [] }

  for (let i = 0; i < tradeIds.length; i++) {
    const tradeId = tradeIds[i]

    try {
      const service = createTradeIdeaService({
        ...context,
        // Unique request ID per item to allow partial retries
        requestId: `${context.requestId}-${i}`,
      })

      await service.move(tradeId, target, {
        batch_id: batchId,
        batch_index: i,
        batch_total: tradeIds.length,
      })

      results.succeeded.push(tradeId)
    } catch (error) {
      results.failed.push({ tradeId, error: error.message })
    }
  }

  return results
}
```

### C.5 RLS Enforcement

```sql
-- Prevent direct writes to audited tables
-- Only service role (used by Edge Functions) can write

-- For trade_queue_items:
CREATE POLICY "Service role only writes"
  ON trade_queue_items
  FOR INSERT
  WITH CHECK (
    -- Only allow through authenticated service role
    auth.jwt()->>'role' = 'service_role'
    OR
    -- Or through specific Edge Function
    current_setting('app.current_function', true) IN (
      'trade-idea-service',
      'bulk-trade-service'
    )
  );

-- Audit events: append-only
CREATE POLICY "Append only audit events"
  ON audit_events
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "No updates to audit events"
  ON audit_events
  FOR UPDATE
  USING (false);

CREATE POLICY "No deletes from audit events"
  ON audit_events
  FOR DELETE
  USING (false);
```

---

## D. Audit Explorer UI/UX Specification

### D.1 Navigation & Access

**Location**: Settings > Audit Explorer (for compliance/admin)
**Alternative access**: "View History" links on entity pages open filtered view

**Access Control**:
| Role | Access Level |
|------|--------------|
| Analyst | Own actions + entities they have access to |
| PM | Team actions + all team entities |
| Admin | Org-wide access |
| Compliance | Full access including archived retention |

### D.2 Filter-First Interface

```
┌─────────────────────────────────────────────────────────────────────────┐
│  AUDIT EXPLORER                                            [Export CSV] │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  📅 Date Range*     │  Entity Type      │  Asset           │   │   │
│  │  [Last 30 days ▼]   │  [All types ▼]    │  [Search...    ] │   │   │
│  ├─────────────────────┼───────────────────┼──────────────────┤   │   │
│  │  User               │  Action Type      │  Search          │   │   │
│  │  [All users ▼]      │  [All actions ▼]  │  [Free text... ] │   │   │
│  ├─────────────────────┴───────────────────┴──────────────────┤   │   │
│  │  ☑ Include deleted    ☐ Include archived (compliance only) │   │   │
│  └─────────────────────────────────────────────────────────────┘   │   │
│                                                                         │
│  [Apply Filters]                              [Save Search] [Clear]     │
│                                                                         │
│  ─────────────────────────────────────────────────────────────────────  │
│                                                                         │
│  ⚠️  Apply filters to view audit events                                 │
│                                                                         │
│     Select a date range and at least one other filter to begin.         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**After filters applied**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Results: 247 events                              Page 1 of 13  [< >]   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌───────────┬────────────┬───────────┬────────────┬─────────────────┐ │
│  │ Timestamp │ Entity     │ Action    │ User       │ Details         │ │
│  ├───────────┼────────────┼───────────┼────────────┼─────────────────┤ │
│  │ 2/1 14:32 │ NVDA idea  │ Executed  │ J. Smith   │ Deciding → Exec │ │
│  │ 2/1 14:30 │ NVDA idea  │ Move      │ J. Smith   │ Sim → Deciding  │ │
│  │ 2/1 13:15 │ AAPL       │ PT Change │ M. Lee     │ $185 → $195     │ │
│  │ 2/1 12:00 │ MSFT cvg   │ Assigned  │ Admin      │ → Sarah Chen    │ │
│  │ 2/1 11:45 │ AMD idea   │ Deleted   │ T. Wang    │ Moved to trash  │ │
│  │ ...       │            │           │            │                 │ │
│  └───────────┴────────────┴───────────┴────────────┴─────────────────┘ │
│                                                                         │
│  Click row to expand details ▼                                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Expanded row detail**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ▼ 2/1/2026 14:32:15 - NVDA idea - Executed                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Actor: John Smith (PM) via Trade Queue drag/drop                       │
│  Request ID: req_abc123                                                 │
│                                                                         │
│  State Change:                                                          │
│  ┌─────────────────────────┬─────────────────────────┐                 │
│  │ Before                  │ After                   │                 │
│  ├─────────────────────────┼─────────────────────────┤                 │
│  │ stage: deciding         │ stage: deciding         │                 │
│  │ outcome: null           │ outcome: executed       │                 │
│  │ visibility: active      │ visibility: active      │                 │
│  └─────────────────────────┴─────────────────────────┘                 │
│                                                                         │
│  Related Events:                                                        │
│  • 2/1 14:35 - Order created (linked)                                   │
│  • 2/1 14:36 - Order filled                                             │
│                                                                         │
│  [View Entity] [View Full JSON] [Copy Event ID]                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### D.3 Entity Timeline Component

Reusable component for entity detail pages:

```typescript
// src/components/audit/EntityTimeline.tsx

interface EntityTimelineProps {
  entityType: EntityType
  entityId: string
  parentEntityType?: EntityType
  parentEntityId?: string
  maxItems?: number
  showFilters?: boolean
}

export function EntityTimeline({
  entityType,
  entityId,
  parentEntityType,
  parentEntityId,
  maxItems = 20,
  showFilters = false,
}: EntityTimelineProps) {
  const { data: events, isLoading } = useQuery({
    queryKey: ['audit-events', entityType, entityId],
    queryFn: () => fetchEntityAuditEvents({
      entityType,
      entityId,
      parentEntityType,
      parentEntityId,
      limit: maxItems,
    }),
  })

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
        History
      </h3>

      {showFilters && <TimelineFilters />}

      <div className="relative">
        {/* Timeline line */}
        <div className="absolute left-4 top-0 bottom-0 w-px bg-gray-200 dark:bg-gray-700" />

        {events?.map((event) => (
          <TimelineEvent key={event.id} event={event} />
        ))}
      </div>

      <Button variant="ghost" size="sm" onClick={openFullAuditExplorer}>
        View full history in Audit Explorer →
      </Button>
    </div>
  )
}
```

### D.4 Use Case Examples

#### Use Case 1: Coverage Changes for Asset X

**Query**: "Show me all changes to coverage for AAPL over last quarter"

```typescript
const filters = {
  dateRange: { start: '2025-10-01', end: '2026-01-01' },
  entityType: 'coverage',
  parentEntityId: assetId, // AAPL's asset ID
  actionTypes: ['assign_coverage', 'remove_coverage'],
}
```

**UI Flow**:
1. Navigate to Audit Explorer
2. Set date range to "Last quarter"
3. Select Entity Type = "Coverage"
4. Search for "AAPL" in Asset filter
5. View results showing all coverage assignments/removals

#### Use Case 2: Deleted Trade Ideas by User

**Query**: "Show all trade ideas deleted by User Y in January"

```typescript
const filters = {
  dateRange: { start: '2026-01-01', end: '2026-02-01' },
  entityType: 'trade_idea',
  actorId: userYId,
  actionTypes: ['delete'],
  includeDeleted: true,
}
```

#### Use Case 3: PT/Rating Audit

**Query**: "Audit all edits to PT/rating fields for NVDA"

```typescript
const filters = {
  dateRange: { start: '2025-01-01', end: '2026-02-01' },
  entityType: 'asset',
  entityId: nvdaAssetId,
  actionTypes: ['set_rating', 'set_price_target'],
}
```

**Result shows**:
- Every rating change with before/after values
- Every PT change with before/after values
- Who made each change and when
- Optional reason if provided

#### Use Case 4: Trade Idea → Execution Trace

**Query**: "Trace trade idea → decision → executed trade → post-mortem changes"

```typescript
// Start with trade idea
const tradeIdeaEvents = await fetchEntityAuditEvents({
  entityType: 'trade_idea',
  entityId: tradeIdeaId,
})

// Get linked orders
const orderEvents = await fetchEntityAuditEvents({
  parentEntityType: 'trade_idea',
  parentEntityId: tradeIdeaId,
  entityType: 'order',
})

// Get executions for each order
const executionEvents = await Promise.all(
  orderEvents.map(order =>
    fetchEntityAuditEvents({
      parentEntityType: 'order',
      parentEntityId: order.entity_id,
      entityType: 'execution',
    })
  )
)
```

**UI**: Render as connected graph/tree showing:
```
Trade Idea: Buy NVDA
├── Created: Jan 15 by John
├── Moved to Simulating: Jan 18
├── Moved to Deciding: Jan 22
├── Executed: Jan 25
│   └── Order: Buy 1000 NVDA
│       ├── Created: Jan 25
│       ├── Filled: 500 @ $142.50
│       └── Filled: 500 @ $142.55
└── Post-mortem note added: Feb 1
```

### D.5 Saved Searches

```typescript
interface SavedSearch {
  id: string
  name: string
  filters: AuditExplorerFilters
  created_by: string
  is_shared: boolean
  created_at: string
}

// Example saved searches:
const EXAMPLE_SAVED_SEARCHES = [
  { name: 'My recent changes', filters: { actorId: 'me', dateRange: 'last_7_days' }},
  { name: 'All PT changes', filters: { actionTypes: ['set_price_target'] }},
  { name: 'Deleted items', filters: { actionTypes: ['delete'], includeDeleted: true }},
  { name: 'Coverage changes', filters: { entityType: 'coverage' }},
]
```

### D.6 Export Functionality

```typescript
async function exportAuditEvents(
  filters: AuditExplorerFilters,
  format: 'csv' | 'json'
): Promise<Blob> {
  // Fetch all matching events (paginated internally)
  const events = await fetchAllAuditEvents(filters)

  if (format === 'csv') {
    const csv = convertToCSV(events, {
      columns: [
        'occurred_at',
        'entity_type',
        'entity_display_name',
        'action_type',
        'actor_email',
        'from_state',
        'to_state',
        'changed_fields',
      ],
    })
    return new Blob([csv], { type: 'text/csv' })
  }

  return new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' })
}
```

---

## E. Permissions and Security

### E.1 Role-Based Access Matrix

| Capability | Analyst | PM | Admin | Compliance |
|------------|---------|-----|-------|------------|
| View own actions | ✅ | ✅ | ✅ | ✅ |
| View team actions | ❌ | ✅ | ✅ | ✅ |
| View org actions | ❌ | ❌ | ✅ | ✅ |
| View cross-org | ❌ | ❌ | ❌ | ✅ |
| View deleted items | ✅ | ✅ | ✅ | ✅ |
| View archived (>30d) | ❌ | ❌ | ❌ | ✅ |
| Export | Limited | ✅ | ✅ | ✅ |
| Access Audit Explorer | ❌ | ✅ | ✅ | ✅ |
| Access Timeline on entities | ✅ | ✅ | ✅ | ✅ |

### E.2 RLS Implementation

```sql
-- Audit events RLS policy
CREATE POLICY "Users can view audit events for accessible entities"
  ON audit_events
  FOR SELECT
  USING (
    -- Compliance role sees everything in org
    (
      EXISTS (
        SELECT 1 FROM user_roles
        WHERE user_id = auth.uid()
        AND role IN ('compliance', 'super_admin')
        AND (org_id = audit_events.org_id OR role = 'super_admin')
      )
    )
    OR
    -- Admin sees org-wide
    (
      EXISTS (
        SELECT 1 FROM user_roles
        WHERE user_id = auth.uid()
        AND role = 'admin'
        AND org_id = audit_events.org_id
      )
      AND (audit_events.metadata->>'visibility_tier' IS NULL
           OR audit_events.metadata->>'visibility_tier' != 'archive')
    )
    OR
    -- PM sees team + own
    (
      EXISTS (
        SELECT 1 FROM user_roles
        WHERE user_id = auth.uid()
        AND role = 'pm'
        AND org_id = audit_events.org_id
      )
      AND (
        audit_events.actor_id = auth.uid()
        OR audit_events.team_id IN (
          SELECT team_id FROM team_members WHERE user_id = auth.uid()
        )
      )
      AND (audit_events.metadata->>'visibility_tier' IS NULL
           OR audit_events.metadata->>'visibility_tier' = 'active')
    )
    OR
    -- Analyst sees own actions only
    (
      audit_events.actor_id = auth.uid()
      AND (audit_events.metadata->>'visibility_tier' IS NULL
           OR audit_events.metadata->>'visibility_tier' = 'active')
    )
  );
```

### E.3 Data Minimization

```typescript
// Sanitize sensitive data before logging

function sanitizeForAudit(state: Record<string, unknown>): Record<string, unknown> {
  const REDACTED_FIELDS = [
    'password',
    'api_key',
    'secret',
    'token',
    'ssn',
    'account_number',
  ]

  const sanitized = { ...state }

  for (const field of REDACTED_FIELDS) {
    if (field in sanitized) {
      sanitized[field] = '[REDACTED]'
    }
  }

  return sanitized
}

// IP address handling: store hashed or partial
function sanitizeIpAddress(ip: string): string {
  // Option 1: Hash
  return createHash('sha256').update(ip).digest('hex').substring(0, 16)

  // Option 2: Partial (last octet zeroed)
  // return ip.replace(/\.\d+$/, '.0')
}
```

### E.4 Audit of Audit Access

```typescript
// Log access to Audit Explorer itself (for compliance)
async function logAuditExplorerAccess(
  userId: string,
  filters: AuditExplorerFilters,
  resultCount: number
): Promise<void> {
  await emitAuditEvent({
    actor: { id: userId, type: 'user' },
    entity: { type: 'audit_explorer', id: 'access' },
    action: { type: 'view', category: 'access' },
    state: {
      to: {
        filters: sanitizeFilters(filters),
        result_count: resultCount,
      },
    },
    metadata: { ui_source: 'audit_explorer' },
    orgId: await getUserOrgId(userId),
  })
}
```

---

## F. Performance and Scaling

### F.1 Expected Volumes

| Metric | Estimate | Notes |
|--------|----------|-------|
| Events/day (small org) | 500-2,000 | 10-50 users |
| Events/day (medium org) | 5,000-20,000 | 50-200 users |
| Events/day (large org) | 50,000-200,000 | 200+ users |
| Event size (avg) | 2-5 KB | Including JSON states |
| Retention | 7 years | Compliance requirement |
| Total rows (7 years, medium) | ~50M | Requires partitioning |

### F.2 Query Patterns and Indexes

```sql
-- Pattern 1: Recent events for entity (most common)
-- Index: idx_audit_events_entity
SELECT * FROM audit_events
WHERE entity_type = 'trade_idea' AND entity_id = $1
ORDER BY occurred_at DESC
LIMIT 50;

-- Pattern 2: User's recent actions
-- Index: idx_audit_events_actor
SELECT * FROM audit_events
WHERE actor_id = $1 AND occurred_at > NOW() - INTERVAL '30 days'
ORDER BY occurred_at DESC
LIMIT 100;

-- Pattern 3: Entity type + date range (Audit Explorer)
-- Index: idx_audit_events_entity_action
SELECT * FROM audit_events
WHERE entity_type = $1
  AND action_type = ANY($2)
  AND occurred_at BETWEEN $3 AND $4
ORDER BY occurred_at DESC
LIMIT 100 OFFSET $5;

-- Pattern 4: Full-text search
-- Index: idx_audit_events_search
SELECT * FROM audit_events
WHERE to_tsvector('english', search_text) @@ plainto_tsquery('english', $1)
  AND occurred_at BETWEEN $2 AND $3
ORDER BY occurred_at DESC
LIMIT 100;

-- Pattern 5: Parent entity lookup (trace relationships)
-- Index: idx_audit_events_parent
SELECT * FROM audit_events
WHERE parent_entity_type = 'trade_idea' AND parent_entity_id = $1
ORDER BY occurred_at DESC;
```

### F.3 Denormalization Strategy

```sql
-- Add denormalized columns for fast filtering

ALTER TABLE audit_events ADD COLUMN actor_email TEXT;
ALTER TABLE audit_events ADD COLUMN actor_name TEXT;
ALTER TABLE audit_events ADD COLUMN asset_symbol TEXT;  -- If entity is asset-related

-- Populate on insert (in application layer)
-- Or via trigger for consistency:

CREATE OR REPLACE FUNCTION denormalize_audit_event()
RETURNS TRIGGER AS $$
BEGIN
  -- Denormalize actor info
  IF NEW.actor_id IS NOT NULL THEN
    SELECT email, CONCAT(first_name, ' ', last_name)
    INTO NEW.actor_email, NEW.actor_name
    FROM users WHERE id = NEW.actor_id;
  END IF;

  -- Denormalize asset symbol if applicable
  IF NEW.entity_type = 'asset' THEN
    SELECT symbol INTO NEW.asset_symbol
    FROM assets WHERE id = NEW.entity_id;
  ELSIF NEW.entity_type IN ('trade_idea', 'coverage') THEN
    -- Look up via relationship
    -- ...
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_denormalize
  BEFORE INSERT ON audit_events
  FOR EACH ROW EXECUTE FUNCTION denormalize_audit_event();
```

### F.4 Partitioning Strategy

```sql
-- Convert to partitioned table when approaching 10M rows

-- Step 1: Create partitioned table
CREATE TABLE audit_events_partitioned (
  LIKE audit_events INCLUDING ALL
) PARTITION BY RANGE (occurred_at);

-- Step 2: Create monthly partitions
CREATE TABLE audit_events_2026_01 PARTITION OF audit_events_partitioned
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

CREATE TABLE audit_events_2026_02 PARTITION OF audit_events_partitioned
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

-- Step 3: Automate partition creation
CREATE OR REPLACE FUNCTION create_audit_partition()
RETURNS void AS $$
DECLARE
  partition_date DATE := DATE_TRUNC('month', NOW() + INTERVAL '1 month');
  partition_name TEXT := 'audit_events_' || TO_CHAR(partition_date, 'YYYY_MM');
  start_date DATE := partition_date;
  end_date DATE := partition_date + INTERVAL '1 month';
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_events_partitioned
     FOR VALUES FROM (%L) TO (%L)',
    partition_name, start_date, end_date
  );
END;
$$ LANGUAGE plpgsql;

-- Run monthly via pg_cron
SELECT cron.schedule('create-audit-partition', '0 0 25 * *', 'SELECT create_audit_partition()');
```

### F.5 Archive Tier Strategy

```typescript
// Active tier: Hot queries (0-90 days)
// Warm tier: Queryable but slower (90 days - 2 years)
// Cold tier: Compliance-only (2+ years)

interface AuditQueryOptions {
  tier: 'active' | 'warm' | 'cold'
  dateRange: DateRange
}

async function queryAuditEvents(
  filters: AuditExplorerFilters,
  options: AuditQueryOptions
): Promise<AuditEvent[]> {
  if (options.tier === 'cold') {
    // Check compliance permission
    if (!hasComplianceRole(currentUser)) {
      throw new Error('Cold tier requires compliance role')
    }

    // Query from archive storage (S3 + Athena, or restored partition)
    return queryArchiveStorage(filters, options.dateRange)
  }

  // Standard DB query for active/warm
  return queryDatabase(filters, options.dateRange)
}
```

### F.6 Export Performance

```typescript
// Stream large exports to avoid memory issues

async function exportLargeAuditReport(
  filters: AuditExplorerFilters,
  format: 'csv' | 'json'
): Promise<ReadableStream> {
  const BATCH_SIZE = 1000
  let offset = 0

  return new ReadableStream({
    async pull(controller) {
      const batch = await fetchAuditEvents({
        ...filters,
        limit: BATCH_SIZE,
        offset,
      })

      if (batch.length === 0) {
        controller.close()
        return
      }

      const formatted = format === 'csv'
        ? convertBatchToCSV(batch, offset === 0)
        : JSON.stringify(batch)

      controller.enqueue(new TextEncoder().encode(formatted))
      offset += BATCH_SIZE
    },
  })
}
```

---

## G. Testing and Acceptance Criteria

### G.1 Unit Tests

```typescript
// src/lib/audit/__tests__/audit-service.test.ts

describe('AuditService', () => {
  describe('emitAuditEvent', () => {
    it('creates event with correct structure', async () => {
      await emitAuditEvent({
        actor: { id: 'user-1', type: 'user', role: 'analyst' },
        entity: { type: 'trade_idea', id: 'trade-1', displayName: 'Buy AAPL' },
        action: { type: 'create', category: 'lifecycle' },
        state: { to: { status: 'idea' } },
        orgId: 'org-1',
      })

      const event = await getLatestEvent('trade_idea', 'trade-1')

      expect(event.actor_id).toBe('user-1')
      expect(event.actor_type).toBe('user')
      expect(event.entity_type).toBe('trade_idea')
      expect(event.action_type).toBe('create')
      expect(event.to_state).toEqual({ status: 'idea' })
      expect(event.checksum).toBeDefined()
    })

    it('calculates checksum correctly', async () => {
      const event = await emitAuditEvent({ ... })
      const recalculated = calculateChecksum(event)
      expect(event.checksum).toBe(recalculated)
    })

    it('handles system actors', async () => {
      await emitAuditEvent({
        actor: SYSTEM_ACTORS.AUTO_ARCHIVE,
        ...
      })

      const event = await getLatestEvent(...)
      expect(event.actor_id).toBeNull()
      expect(event.actor_type).toBe('system')
      expect(event.actor_role).toBe('system:auto_archive')
    })
  })

  describe('idempotency', () => {
    it('prevents duplicate events with same request_id', async () => {
      const params = {
        actor: { id: 'user-1', type: 'user' },
        entity: { type: 'trade_idea', id: 'trade-1' },
        action: { type: 'move_stage', category: 'state_change' },
        metadata: { request_id: 'req-123' },
        ...
      }

      await emitAuditEvent(params)
      await emitAuditEvent(params) // Duplicate

      const events = await getEventsForEntity('trade_idea', 'trade-1')
      expect(events.filter(e => e.action_type === 'move_stage')).toHaveLength(1)
    })
  })
})
```

### G.2 Integration Tests

```typescript
// src/lib/services/__tests__/trade-idea-service.integration.test.ts

describe('TradeIdeaService Integration', () => {
  describe('moveTrade', () => {
    it('emits audit event on state change', async () => {
      const service = createTradeIdeaService(testContext)
      const tradeId = await createTestTradeIdea({ status: 'idea' })

      await service.move(tradeId, { type: 'stage', stage: 'discussing' })

      const events = await getEventsForEntity('trade_idea', tradeId)
      const moveEvent = events.find(e => e.action_type === 'move_stage')

      expect(moveEvent).toBeDefined()
      expect(moveEvent.from_state.workflow_stage).toBe('idea')
      expect(moveEvent.to_state.workflow_stage).toBe('discussing')
    })

    it('includes correct changed_fields', async () => {
      // ...
    })
  })

  describe('deleteTrade', () => {
    it('emits delete event with previous state snapshot', async () => {
      const service = createTradeIdeaService(testContext)
      const tradeId = await createTestTradeIdea({ status: 'idea' })

      await service.delete(tradeId, { reason: 'Created in error' })

      const events = await getEventsForEntity('trade_idea', tradeId)
      const deleteEvent = events.find(e => e.action_type === 'delete')

      expect(deleteEvent).toBeDefined()
      expect(deleteEvent.from_state.visibility).toBe('active')
      expect(deleteEvent.to_state.visibility).toBe('trash')
      expect(deleteEvent.metadata.reason).toBe('Created in error')
    })
  })

  describe('bulk operations', () => {
    it('creates one event per entity with batch_id', async () => {
      const tradeIds = await createTestTradeIdeas(5)

      await bulkMove(tradeIds, { type: 'stage', stage: 'discussing' }, testContext)

      const events = await getEventsWithBatchId(/* batch_id */)
      expect(events).toHaveLength(5)
      expect(new Set(events.map(e => e.metadata.batch_id)).size).toBe(1)
    })
  })
})
```

### G.3 Permission Tests

```typescript
describe('Audit Explorer Permissions', () => {
  it('analyst can only see own actions', async () => {
    const analystContext = createContext({ role: 'analyst', userId: 'analyst-1' })

    const results = await queryAuditEvents({}, analystContext)

    expect(results.every(e => e.actor_id === 'analyst-1')).toBe(true)
  })

  it('PM can see team actions', async () => {
    const pmContext = createContext({ role: 'pm', userId: 'pm-1', teamId: 'team-1' })

    const results = await queryAuditEvents({}, pmContext)

    expect(results.every(e =>
      e.actor_id === 'pm-1' || e.team_id === 'team-1'
    )).toBe(true)
  })

  it('compliance can see archived events', async () => {
    const complianceContext = createContext({ role: 'compliance' })

    const results = await queryAuditEvents({ includeArchived: true }, complianceContext)

    expect(results.some(e => e.metadata.visibility_tier === 'archive')).toBe(true)
  })

  it('non-compliance cannot see archived events', async () => {
    const adminContext = createContext({ role: 'admin' })

    const results = await queryAuditEvents({ includeArchived: true }, adminContext)

    expect(results.every(e => e.metadata.visibility_tier !== 'archive')).toBe(true)
  })
})
```

### G.4 Acceptance Criteria Checklists

#### Phase 1: Trade Ideas

- [ ] **Write Path**
  - [ ] `createTradeIdea()` emits `create` event
  - [ ] `moveTrade()` emits `move_stage` or `set_outcome` event
  - [ ] `deleteTrade()` emits `delete` event with previous_state
  - [ ] `restoreTrade()` emits `restore` event
  - [ ] `updateTradeField()` emits `update_field` event
  - [ ] Bulk actions emit one event per entity with shared batch_id

- [ ] **Event Integrity**
  - [ ] Events have valid checksum
  - [ ] Events are immutable (UPDATE/DELETE blocked)
  - [ ] from_state and to_state accurately reflect change
  - [ ] changed_fields array is accurate

- [ ] **UI Integration**
  - [ ] Trade idea detail modal shows Timeline powered by audit_events
  - [ ] "View History" link opens Audit Explorer with pre-filtered view

- [ ] **Backfill**
  - [ ] Existing trade ideas have `create` events backfilled
  - [ ] Backfilled events marked with `metadata.backfill: true`

#### Phase 2: Coverage

- [ ] `assignCoverage()` emits `assign_coverage` event
- [ ] `removeCoverage()` emits `remove_coverage` event
- [ ] Existing coverage_history migrated to audit_events
- [ ] Asset page coverage timeline powered by audit_events
- [ ] Old coverage_history writes deprecated

#### Phase 3: Asset Fields

- [ ] Rating changes emit `set_rating` event
- [ ] PT changes emit `set_price_target` event
- [ ] Thesis changes emit `set_thesis` event
- [ ] Asset page field history powered by audit_events

#### Phase 4: Orders/Executions

- [ ] Order creation emits event with parent_entity = trade_idea
- [ ] Execution emits event with parent_entity = order
- [ ] Full trace from trade_idea → order → execution queryable

#### Audit Explorer UI

- [ ] Requires date range filter before showing results
- [ ] Entity type, user, action filters work correctly
- [ ] Include deleted toggle works
- [ ] Include archived toggle only visible to compliance
- [ ] Pagination works
- [ ] Export to CSV works
- [ ] Saved searches work
- [ ] Row expansion shows full detail

---

## H. Implementation Timeline

| Phase | Scope | Duration | Dependencies |
|-------|-------|----------|--------------|
| 0 | Schema + audit service foundation | 1 week | None |
| 1 | Trade ideas | 2 weeks | Phase 0 |
| 2 | Coverage changes | 1 week | Phase 0 |
| 3 | Asset field history | 1 week | Phase 0 |
| 4 | Orders/executions | 2 weeks | Phase 1 |
| 5 | Audit Explorer UI | 2 weeks | Phase 1 |
| 6 | Backfill + migration | 1 week | Phases 1-4 |
| 7 | Performance tuning + partitioning | 1 week | Phase 5 |

**Total: ~11 weeks**

---

## I. Open Questions / Decisions Needed

1. **Retention period**: 7 years proposed. Confirm with compliance.
2. **Cold storage solution**: S3 + Athena vs. separate analytics DB?
3. **Access logging**: Should we log every Audit Explorer query? (Proposed: yes for compliance)
4. **Real-time vs. async**: Should audit writes be synchronous or queued? (Proposed: sync for simplicity, async later if perf issues)
5. **Cross-org visibility**: Do compliance users need cross-org access? (Proposed: yes for parent company compliance)

---

## J. Appendix: Migration SQL

```sql
-- Full migration script: migrations/YYYYMMDD_create_audit_events.sql

-- See Section A.1 for complete schema
-- See Section B.3-B.6 for backfill scripts per phase
```
