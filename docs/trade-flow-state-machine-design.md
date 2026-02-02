# Trade Flow State Machine Design

## Overview

This document defines a precise, auditable state-transition system for trade workflow management with clear semantic separation between **workflow states** and **retention/archive states**.

---

## 1. Data Model

### 1.1 Trade Queue Items Table (Modified)

```sql
-- Migration: add_trade_state_machine_fields
ALTER TABLE trade_queue_items ADD COLUMN IF NOT EXISTS workflow_stage TEXT NOT NULL DEFAULT 'idea';
ALTER TABLE trade_queue_items ADD COLUMN IF NOT EXISTS workflow_outcome TEXT; -- NULL until decided
ALTER TABLE trade_queue_items ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE trade_queue_items ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id);
ALTER TABLE trade_queue_items ADD COLUMN IF NOT EXISTS previous_state JSONB; -- snapshot for restore

-- Add constraints
ALTER TABLE trade_queue_items ADD CONSTRAINT valid_workflow_stage
  CHECK (workflow_stage IN ('idea', 'discussing', 'simulating', 'deciding'));

ALTER TABLE trade_queue_items ADD CONSTRAINT valid_workflow_outcome
  CHECK (workflow_outcome IS NULL OR workflow_outcome IN ('executed', 'rejected', 'deferred'));

-- Outcome only valid when stage is 'deciding' or was decided
ALTER TABLE trade_queue_items ADD CONSTRAINT outcome_requires_deciding
  CHECK (
    (workflow_outcome IS NULL) OR
    (workflow_stage = 'deciding' AND workflow_outcome IS NOT NULL)
  );

-- Index for visibility queries
CREATE INDEX idx_trade_queue_items_visibility
  ON trade_queue_items(deleted_at, workflow_outcome);
```

### 1.2 State Representation

| Field | Type | Description |
|-------|------|-------------|
| `workflow_stage` | enum | Current pipeline stage: `idea`, `discussing`, `simulating`, `deciding` |
| `workflow_outcome` | enum (nullable) | Terminal outcome: `executed`, `rejected`, `deferred` (only set when decided) |
| `deleted_at` | timestamp (nullable) | When soft-deleted (NULL = not deleted) |
| `deleted_by` | uuid (nullable) | Who deleted it |
| `previous_state` | jsonb (nullable) | Snapshot before deletion for deterministic restore |

### 1.3 Visibility Tier (Derived, Not Stored)

```typescript
type VisibilityTier = 'active' | 'trash' | 'archive'

function getVisibilityTier(item: TradeQueueItem): VisibilityTier {
  if (!item.deleted_at) return 'active'

  const daysSinceDeleted = differenceInDays(new Date(), item.deleted_at)
  if (daysSinceDeleted < TRASH_RETENTION_DAYS) return 'trash' // e.g., 30 days
  return 'archive'
}
```

### 1.4 Activity Log Table (New)

```sql
CREATE TABLE trade_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id UUID NOT NULL REFERENCES trade_queue_items(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES users(id), -- NULL for system actions
  action_type TEXT NOT NULL,
  from_state JSONB NOT NULL,
  to_state JSONB NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Constraints
ALTER TABLE trade_activity_log ADD CONSTRAINT valid_action_type
  CHECK (action_type IN ('move', 'delete', 'restore', 'auto_archive', 'bulk_move'));

-- Indexes
CREATE INDEX idx_trade_activity_log_trade_id ON trade_activity_log(trade_id);
CREATE INDEX idx_trade_activity_log_actor_id ON trade_activity_log(actor_id);
CREATE INDEX idx_trade_activity_log_created_at ON trade_activity_log(created_at DESC);
CREATE INDEX idx_trade_activity_log_action_type ON trade_activity_log(action_type);

-- RLS
ALTER TABLE trade_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view activity for trades they can access"
  ON trade_activity_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM trade_queue_items t
      WHERE t.id = trade_activity_log.trade_id
      -- Add your existing RLS logic here
    )
  );

-- Activity log is append-only (immutable)
CREATE POLICY "Only system can insert activity logs"
  ON trade_activity_log FOR INSERT
  WITH CHECK (true); -- Controlled via service layer

-- No updates or deletes allowed
CREATE POLICY "Activity logs are immutable"
  ON trade_activity_log FOR UPDATE
  USING (false);

CREATE POLICY "Activity logs cannot be deleted"
  ON trade_activity_log FOR DELETE
  USING (false);
```

---

## 2. State Machine / Transition Map

### 2.1 Workflow State Diagram

```
                    ┌─────────────────────────────────────────┐
                    │           WORKFLOW STAGES               │
                    │                                         │
   ┌────────┐      │  ┌──────────┐    ┌────────────┐         │
   │  NEW   │──────┼─▶│   IDEA   │───▶│ DISCUSSING │         │
   └────────┘      │  └──────────┘    └────────────┘         │
                    │       │  ▲            │  ▲              │
                    │       │  │            │  │              │
                    │       ▼  │            ▼  │              │
                    │  ┌────────────┐  ┌──────────┐          │
                    │  │ SIMULATING │◀─│ DECIDING │          │
                    │  └────────────┘  └──────────┘          │
                    │                       │                 │
                    └───────────────────────┼─────────────────┘
                                            │
                         ┌──────────────────┼──────────────────┐
                         │                  │                  │
                         ▼                  ▼                  ▼
                    ┌──────────┐      ┌──────────┐      ┌──────────┐
                    │ EXECUTED │      │ REJECTED │      │ DEFERRED │
                    └──────────┘      └──────────┘      └──────────┘
                         │                  │                  │
                         └──────────────────┴──────────────────┘
                                            │
                                   OUTCOMES (Terminal)
```

### 2.2 Visibility State Diagram

```
                    ┌─────────────────────────────────────────┐
                    │              ACTIVE                      │
                    │   (any workflow stage or outcome)        │
                    └─────────────────────────────────────────┘
                                       │
                                  [DELETE]
                                       │
                                       ▼
                    ┌─────────────────────────────────────────┐
                    │              TRASH                       │
                    │   (deleted_at set, < 30 days)           │
                    │   - Visible in "View Deleted"           │
                    │   - Restorable                          │
                    └─────────────────────────────────────────┘
                            │                    │
                       [RESTORE]            [30 days]
                            │                    │
                            ▼                    ▼
                    ┌───────────────┐    ┌─────────────────────┐
                    │    ACTIVE     │    │      ARCHIVE        │
                    │ (previous     │    │  (deleted_at > 30d) │
                    │  state)       │    │  - Hidden from UI   │
                    └───────────────┘    │  - Audit access only│
                                         │  - NOT restorable   │
                                         └─────────────────────┘
```

### 2.3 Valid Transitions

```typescript
// Workflow stage transitions (when visibility = 'active')
const VALID_STAGE_TRANSITIONS: Record<WorkflowStage, WorkflowStage[]> = {
  idea:       ['discussing', 'simulating', 'deciding'],
  discussing: ['idea', 'simulating', 'deciding'],
  simulating: ['idea', 'discussing', 'deciding'],
  deciding:   ['simulating'], // Can go back to simulating, but not earlier
}

// Outcome transitions (only from 'deciding' stage)
const VALID_OUTCOMES: WorkflowOutcome[] = ['executed', 'rejected', 'deferred']

// Visibility transitions
const VALID_VISIBILITY_TRANSITIONS = {
  active:  ['trash'],           // Can delete
  trash:   ['active', 'archive'], // Can restore or auto-archive
  archive: [],                  // Terminal (requires elevated permission to access)
}
```

### 2.4 Blocked Transitions

| From | To | Reason |
|------|----|--------|
| Any outcome | Any stage | Outcomes are terminal; cannot un-execute |
| Archive | Anything | Requires elevated permission / compliance override |
| Non-deciding | Any outcome | Must be in deciding stage to reach outcome |
| Trash (>30d) | Active | Auto-archived; cannot restore via normal UI |

---

## 3. API / Service Design

### 3.1 Type Definitions

```typescript
// src/lib/trade-state-machine/types.ts

export type WorkflowStage = 'idea' | 'discussing' | 'simulating' | 'deciding'
export type WorkflowOutcome = 'executed' | 'rejected' | 'deferred'
export type VisibilityTier = 'active' | 'trash' | 'archive'
export type ActionType = 'move' | 'delete' | 'restore' | 'auto_archive' | 'bulk_move'

export interface TradeState {
  workflow_stage: WorkflowStage
  workflow_outcome: WorkflowOutcome | null
  deleted_at: string | null
  deleted_by: string | null
}

export interface StateSnapshot {
  workflow_stage: WorkflowStage
  workflow_outcome: WorkflowOutcome | null
  visibility: VisibilityTier
}

export interface ActivityLogEntry {
  trade_id: string
  actor_id: string | null
  action_type: ActionType
  from_state: StateSnapshot
  to_state: StateSnapshot
  metadata?: {
    reason?: string
    ui_source?: string
    batch_id?: string
    [key: string]: unknown
  }
}

export interface MoveTradeParams {
  tradeId: string
  actorId: string
  target:
    | { type: 'stage'; stage: WorkflowStage }
    | { type: 'outcome'; outcome: WorkflowOutcome }
  metadata?: Record<string, unknown>
}

export interface DeleteTradeParams {
  tradeId: string
  actorId: string
  reason?: string
  metadata?: Record<string, unknown>
}

export interface RestoreTradeParams {
  tradeId: string
  actorId: string
  metadata?: Record<string, unknown>
}

export interface BulkMoveParams {
  tradeIds: string[]
  actorId: string
  target:
    | { type: 'stage'; stage: WorkflowStage }
    | { type: 'outcome'; outcome: WorkflowOutcome }
  metadata?: Record<string, unknown>
}
```

### 3.2 State Machine Implementation

```typescript
// src/lib/trade-state-machine/state-machine.ts

import { supabase } from '../supabase'
import type {
  WorkflowStage,
  WorkflowOutcome,
  VisibilityTier,
  TradeState,
  StateSnapshot,
  ActivityLogEntry,
  MoveTradeParams,
  DeleteTradeParams,
  RestoreTradeParams,
  BulkMoveParams,
} from './types'

const TRASH_RETENTION_DAYS = 30

const VALID_STAGE_TRANSITIONS: Record<WorkflowStage, WorkflowStage[]> = {
  idea: ['discussing', 'simulating', 'deciding'],
  discussing: ['idea', 'simulating', 'deciding'],
  simulating: ['idea', 'discussing', 'deciding'],
  deciding: ['simulating'],
}

const VALID_OUTCOMES: WorkflowOutcome[] = ['executed', 'rejected', 'deferred']

// ============================================================
// Helper Functions
// ============================================================

export function getVisibilityTier(deletedAt: string | null): VisibilityTier {
  if (!deletedAt) return 'active'

  const daysSinceDeleted = Math.floor(
    (Date.now() - new Date(deletedAt).getTime()) / (1000 * 60 * 60 * 24)
  )

  return daysSinceDeleted < TRASH_RETENTION_DAYS ? 'trash' : 'archive'
}

function createStateSnapshot(state: TradeState): StateSnapshot {
  return {
    workflow_stage: state.workflow_stage,
    workflow_outcome: state.workflow_outcome,
    visibility: getVisibilityTier(state.deleted_at),
  }
}

async function logActivity(entry: ActivityLogEntry): Promise<void> {
  const { error } = await supabase.from('trade_activity_log').insert({
    trade_id: entry.trade_id,
    actor_id: entry.actor_id,
    action_type: entry.action_type,
    from_state: entry.from_state,
    to_state: entry.to_state,
    metadata: entry.metadata || {},
  })

  if (error) {
    console.error('Failed to log activity:', error)
    throw new Error(`Activity log failed: ${error.message}`)
  }
}

async function getTradeState(tradeId: string): Promise<TradeState & { id: string }> {
  const { data, error } = await supabase
    .from('trade_queue_items')
    .select('id, workflow_stage, workflow_outcome, deleted_at, deleted_by, previous_state')
    .eq('id', tradeId)
    .single()

  if (error || !data) {
    throw new Error(`Trade not found: ${tradeId}`)
  }

  return data as TradeState & { id: string }
}

// ============================================================
// Transition Validators
// ============================================================

function validateStageTransition(
  currentStage: WorkflowStage,
  currentOutcome: WorkflowOutcome | null,
  targetStage: WorkflowStage
): { valid: boolean; reason?: string } {
  // Cannot move if already has an outcome
  if (currentOutcome) {
    return { valid: false, reason: `Cannot change stage: trade has outcome '${currentOutcome}'` }
  }

  // Check if transition is allowed
  const allowedTargets = VALID_STAGE_TRANSITIONS[currentStage]
  if (!allowedTargets.includes(targetStage)) {
    return {
      valid: false,
      reason: `Cannot move from '${currentStage}' to '${targetStage}'. Allowed: ${allowedTargets.join(', ')}`
    }
  }

  return { valid: true }
}

function validateOutcomeTransition(
  currentStage: WorkflowStage,
  currentOutcome: WorkflowOutcome | null,
  targetOutcome: WorkflowOutcome
): { valid: boolean; reason?: string } {
  // Cannot change outcome once set
  if (currentOutcome) {
    return { valid: false, reason: `Trade already has outcome '${currentOutcome}'` }
  }

  // Must be in deciding stage
  if (currentStage !== 'deciding') {
    return { valid: false, reason: `Must be in 'deciding' stage to set outcome. Current: '${currentStage}'` }
  }

  // Validate outcome value
  if (!VALID_OUTCOMES.includes(targetOutcome)) {
    return { valid: false, reason: `Invalid outcome '${targetOutcome}'. Valid: ${VALID_OUTCOMES.join(', ')}` }
  }

  return { valid: true }
}

// ============================================================
// Core Mutation Functions
// ============================================================

/**
 * moveTrade - THE ONLY WAY to change trade workflow state
 *
 * All UI actions (drag/drop, buttons, bulk actions) MUST call this function.
 */
export async function moveTrade(params: MoveTradeParams): Promise<void> {
  const { tradeId, actorId, target, metadata } = params

  // 1. Get current state
  const currentState = await getTradeState(tradeId)
  const fromSnapshot = createStateSnapshot(currentState)

  // 2. Validate visibility (must be active)
  if (fromSnapshot.visibility !== 'active') {
    throw new Error(`Cannot move trade in '${fromSnapshot.visibility}' visibility tier`)
  }

  // 3. Validate and compute new state
  let newStage = currentState.workflow_stage
  let newOutcome = currentState.workflow_outcome

  if (target.type === 'stage') {
    const validation = validateStageTransition(
      currentState.workflow_stage,
      currentState.workflow_outcome,
      target.stage
    )
    if (!validation.valid) {
      throw new Error(validation.reason)
    }
    newStage = target.stage
  } else {
    const validation = validateOutcomeTransition(
      currentState.workflow_stage,
      currentState.workflow_outcome,
      target.outcome
    )
    if (!validation.valid) {
      throw new Error(validation.reason)
    }
    newOutcome = target.outcome
  }

  // 4. Update trade
  const { error } = await supabase
    .from('trade_queue_items')
    .update({
      workflow_stage: newStage,
      workflow_outcome: newOutcome,
      updated_at: new Date().toISOString(),
    })
    .eq('id', tradeId)

  if (error) {
    throw new Error(`Failed to move trade: ${error.message}`)
  }

  // 5. Log activity
  const toSnapshot: StateSnapshot = {
    workflow_stage: newStage,
    workflow_outcome: newOutcome,
    visibility: 'active',
  }

  await logActivity({
    trade_id: tradeId,
    actor_id: actorId,
    action_type: 'move',
    from_state: fromSnapshot,
    to_state: toSnapshot,
    metadata,
  })
}

/**
 * deleteTrade - Soft delete (move to trash)
 */
export async function deleteTrade(params: DeleteTradeParams): Promise<void> {
  const { tradeId, actorId, reason, metadata } = params

  // 1. Get current state
  const currentState = await getTradeState(tradeId)
  const fromSnapshot = createStateSnapshot(currentState)

  // 2. Validate visibility (must be active)
  if (fromSnapshot.visibility !== 'active') {
    throw new Error(`Trade is already in '${fromSnapshot.visibility}' tier`)
  }

  // 3. Snapshot previous state for restore
  const previousState: StateSnapshot = {
    workflow_stage: currentState.workflow_stage,
    workflow_outcome: currentState.workflow_outcome,
    visibility: 'active',
  }

  // 4. Update trade
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('trade_queue_items')
    .update({
      deleted_at: now,
      deleted_by: actorId,
      previous_state: previousState,
      updated_at: now,
    })
    .eq('id', tradeId)

  if (error) {
    throw new Error(`Failed to delete trade: ${error.message}`)
  }

  // 5. Log activity
  const toSnapshot: StateSnapshot = {
    workflow_stage: currentState.workflow_stage,
    workflow_outcome: currentState.workflow_outcome,
    visibility: 'trash',
  }

  await logActivity({
    trade_id: tradeId,
    actor_id: actorId,
    action_type: 'delete',
    from_state: fromSnapshot,
    to_state: toSnapshot,
    metadata: { ...metadata, reason },
  })
}

/**
 * restoreTrade - Restore from trash to previous state
 */
export async function restoreTrade(params: RestoreTradeParams): Promise<void> {
  const { tradeId, actorId, metadata } = params

  // 1. Get current state
  const currentState = await getTradeState(tradeId) as TradeState & {
    id: string
    previous_state: StateSnapshot | null
  }
  const fromSnapshot = createStateSnapshot(currentState)

  // 2. Validate visibility (must be trash, not archive)
  if (fromSnapshot.visibility !== 'trash') {
    if (fromSnapshot.visibility === 'archive') {
      throw new Error('Cannot restore archived trades. Contact compliance for access.')
    }
    throw new Error('Trade is not deleted')
  }

  // 3. Get previous state
  const previousState = currentState.previous_state
  if (!previousState) {
    throw new Error('No previous state found for restore')
  }

  // 4. Update trade
  const { error } = await supabase
    .from('trade_queue_items')
    .update({
      workflow_stage: previousState.workflow_stage,
      workflow_outcome: previousState.workflow_outcome,
      deleted_at: null,
      deleted_by: null,
      previous_state: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', tradeId)

  if (error) {
    throw new Error(`Failed to restore trade: ${error.message}`)
  }

  // 5. Log activity
  const toSnapshot: StateSnapshot = {
    workflow_stage: previousState.workflow_stage,
    workflow_outcome: previousState.workflow_outcome,
    visibility: 'active',
  }

  await logActivity({
    trade_id: tradeId,
    actor_id: actorId,
    action_type: 'restore',
    from_state: fromSnapshot,
    to_state: toSnapshot,
    metadata,
  })
}

/**
 * autoArchiveDeletedTrades - System job to move old trash to archive
 *
 * Run this as a scheduled job (e.g., daily cron)
 */
export async function autoArchiveDeletedTrades(): Promise<{ archived: number }> {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - TRASH_RETENTION_DAYS)

  // 1. Find trades to archive
  const { data: tradesToArchive, error: findError } = await supabase
    .from('trade_queue_items')
    .select('id, workflow_stage, workflow_outcome, deleted_at')
    .not('deleted_at', 'is', null)
    .lt('deleted_at', cutoffDate.toISOString())

  if (findError) {
    throw new Error(`Failed to find trades to archive: ${findError.message}`)
  }

  if (!tradesToArchive || tradesToArchive.length === 0) {
    return { archived: 0 }
  }

  // 2. Log activity for each (no state change needed - visibility is derived)
  const batchId = crypto.randomUUID()

  for (const trade of tradesToArchive) {
    const fromSnapshot: StateSnapshot = {
      workflow_stage: trade.workflow_stage,
      workflow_outcome: trade.workflow_outcome,
      visibility: 'trash',
    }

    const toSnapshot: StateSnapshot = {
      workflow_stage: trade.workflow_stage,
      workflow_outcome: trade.workflow_outcome,
      visibility: 'archive',
    }

    await logActivity({
      trade_id: trade.id,
      actor_id: null, // System action
      action_type: 'auto_archive',
      from_state: fromSnapshot,
      to_state: toSnapshot,
      metadata: { batch_id: batchId, reason: 'Auto-archived after 30 days in trash' },
    })
  }

  return { archived: tradesToArchive.length }
}

/**
 * bulkMoveTrades - Move multiple trades at once
 */
export async function bulkMoveTrades(params: BulkMoveParams): Promise<{
  succeeded: string[]
  failed: Array<{ tradeId: string; error: string }>
}> {
  const { tradeIds, actorId, target, metadata } = params
  const batchId = crypto.randomUUID()

  const succeeded: string[] = []
  const failed: Array<{ tradeId: string; error: string }> = []

  for (const tradeId of tradeIds) {
    try {
      await moveTrade({
        tradeId,
        actorId,
        target,
        metadata: { ...metadata, batch_id: batchId },
      })
      succeeded.push(tradeId)
    } catch (error) {
      failed.push({
        tradeId,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  return { succeeded, failed }
}
```

### 3.3 React Hooks

```typescript
// src/hooks/useTradeStateMachine.ts

import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  moveTrade,
  deleteTrade,
  restoreTrade,
  bulkMoveTrades,
  type MoveTradeParams,
  type DeleteTradeParams,
  type RestoreTradeParams,
  type BulkMoveParams,
} from '../lib/trade-state-machine/state-machine'
import { useAuth } from './useAuth'
import { toast } from 'sonner'

export function useTradeStateMachine() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const invalidateQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
    queryClient.invalidateQueries({ queryKey: ['trade-activity-log'] })
  }

  const moveTradeM = useMutation({
    mutationFn: (params: Omit<MoveTradeParams, 'actorId'>) =>
      moveTrade({ ...params, actorId: user!.id }),
    onSuccess: () => {
      invalidateQueries()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to move trade')
    },
  })

  const deleteTradeM = useMutation({
    mutationFn: (params: Omit<DeleteTradeParams, 'actorId'>) =>
      deleteTrade({ ...params, actorId: user!.id }),
    onSuccess: () => {
      invalidateQueries()
      toast.success('Trade moved to trash')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete trade')
    },
  })

  const restoreTradeM = useMutation({
    mutationFn: (params: Omit<RestoreTradeParams, 'actorId'>) =>
      restoreTrade({ ...params, actorId: user!.id }),
    onSuccess: () => {
      invalidateQueries()
      toast.success('Trade restored')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to restore trade')
    },
  })

  const bulkMoveM = useMutation({
    mutationFn: (params: Omit<BulkMoveParams, 'actorId'>) =>
      bulkMoveTrades({ ...params, actorId: user!.id }),
    onSuccess: (result) => {
      invalidateQueries()
      if (result.failed.length === 0) {
        toast.success(`Moved ${result.succeeded.length} trades`)
      } else {
        toast.warning(
          `Moved ${result.succeeded.length} trades. ${result.failed.length} failed.`
        )
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Bulk move failed')
    },
  })

  return {
    moveTrade: moveTradeM.mutate,
    moveTradeAsync: moveTradeM.mutateAsync,
    isMoving: moveTradeM.isPending,

    deleteTrade: deleteTradeM.mutate,
    deleteTradeAsync: deleteTradeM.mutateAsync,
    isDeleting: deleteTradeM.isPending,

    restoreTrade: restoreTradeM.mutate,
    restoreTradeAsync: restoreTradeM.mutateAsync,
    isRestoring: restoreTradeM.isPending,

    bulkMove: bulkMoveM.mutate,
    bulkMoveAsync: bulkMoveM.mutateAsync,
    isBulkMoving: bulkMoveM.isPending,
  }
}
```

---

## 4. Migration Path from Current System

### 4.1 Field Mapping

| Current Field | New Field | Migration |
|---------------|-----------|-----------|
| `status = 'idea'` | `workflow_stage = 'idea'` | Direct |
| `status = 'discussing'` | `workflow_stage = 'discussing'` | Direct |
| `status = 'simulating'` | `workflow_stage = 'simulating'` | Direct |
| `status = 'deciding'` | `workflow_stage = 'deciding'` | Direct |
| `status = 'approved'` | `workflow_stage = 'deciding'`, `workflow_outcome = 'executed'` | Split |
| `status = 'rejected'` | `workflow_stage = 'deciding'`, `workflow_outcome = 'rejected'` | Split |
| `status = 'cancelled'` | `workflow_stage = 'deciding'`, `workflow_outcome = 'deferred'` | Map cancelled → deferred |
| `status = 'deleted'` | `deleted_at = updated_at` | Use timestamp |

### 4.2 Migration SQL

```sql
-- Migration: migrate_to_state_machine

-- 1. Add new columns
ALTER TABLE trade_queue_items ADD COLUMN workflow_stage TEXT;
ALTER TABLE trade_queue_items ADD COLUMN workflow_outcome TEXT;
ALTER TABLE trade_queue_items ADD COLUMN previous_state JSONB;
-- deleted_at and deleted_by may already exist

-- 2. Migrate data
UPDATE trade_queue_items SET
  workflow_stage = CASE
    WHEN status IN ('idea', 'discussing', 'simulating', 'deciding') THEN status
    WHEN status IN ('approved', 'rejected', 'cancelled', 'executed') THEN 'deciding'
    WHEN status = 'deleted' THEN
      COALESCE((previous_state->>'workflow_stage')::TEXT, 'idea')
    ELSE 'idea'
  END,
  workflow_outcome = CASE
    WHEN status IN ('approved', 'executed') THEN 'executed'
    WHEN status = 'rejected' THEN 'rejected'
    WHEN status = 'cancelled' THEN 'deferred'
    ELSE NULL
  END,
  deleted_at = CASE
    WHEN status = 'deleted' THEN COALESCE(deleted_at, updated_at)
    ELSE NULL
  END;

-- 3. Add constraints and set defaults
ALTER TABLE trade_queue_items
  ALTER COLUMN workflow_stage SET NOT NULL,
  ALTER COLUMN workflow_stage SET DEFAULT 'idea';

-- 4. Add check constraints
ALTER TABLE trade_queue_items ADD CONSTRAINT valid_workflow_stage
  CHECK (workflow_stage IN ('idea', 'discussing', 'simulating', 'deciding'));

ALTER TABLE trade_queue_items ADD CONSTRAINT valid_workflow_outcome
  CHECK (workflow_outcome IS NULL OR workflow_outcome IN ('executed', 'rejected', 'deferred'));

-- 5. Drop old status column (after verifying migration)
-- ALTER TABLE trade_queue_items DROP COLUMN status;
```

---

## 5. UI Integration Guidance

### 5.1 Workflow UI Boundaries

```
┌─────────────────────────────────────────────────────────────────────┐
│                        TRADE QUEUE PAGE                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────┐  ┌───────────┐  ┌────────────┐  ┌─────────────────┐   │
│  │  Ideas  │  │Working On │  │ Simulating │  │    Deciding     │   │
│  │         │  │           │  │            │  │                 │   │
│  │  drag   │  │   drag    │  │    drag    │  │ [Dropdown ▼]    │   │
│  │  drop   │  │   drop    │  │    drop    │  │  • Deciding     │   │
│  │         │  │           │  │            │  │  • Executed     │   │
│  │         │  │           │  │            │  │  • Rejected     │   │
│  │         │  │           │  │            │  │  • Deferred     │   │
│  │         │  │           │  │            │  │  ─────────────  │   │
│  │         │  │           │  │            │  │  [⋮] View Trash │   │
│  └─────────┘  └───────────┘  └────────────┘  └─────────────────┘   │
│                                                                     │
│  ════════════════════════════════════════════════════════════════  │
│                     WORKFLOW UI STOPS HERE                          │
│  ════════════════════════════════════════════════════════════════  │
│                                                                     │
│  Archive access: Outcomes page only (audit/compliance view)         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 Fourth Column Dropdown Options

```typescript
type FourthColumnView = 'deciding' | 'executed' | 'rejected' | 'deferred'

const FOURTH_COLUMN_OPTIONS = [
  { value: 'deciding', label: 'Deciding', description: 'Awaiting final decision' },
  { value: 'executed', label: 'Executed', description: 'Approved and executed' },
  { value: 'rejected', label: 'Rejected', description: 'Decided against' },
  { value: 'deferred', label: 'Deferred', description: 'Not now, maybe later' },
]
```

### 5.3 Trash Access

```typescript
// Trash is accessed via overflow menu (three-dot icon)
// Only visible when there are items in trash

const TrashButton = () => {
  const { data: trashCount } = useQuery({
    queryKey: ['trash-count'],
    queryFn: async () => {
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - TRASH_RETENTION_DAYS)

      const { count } = await supabase
        .from('trade_queue_items')
        .select('*', { count: 'exact', head: true })
        .not('deleted_at', 'is', null)
        .gte('deleted_at', cutoff.toISOString())

      return count || 0
    },
  })

  if (!trashCount) return null

  return (
    <DropdownMenuItem onClick={() => setView('trash')}>
      <Trash2 className="h-4 w-4 mr-2" />
      View Trash
      <Badge className="ml-auto">{trashCount}</Badge>
    </DropdownMenuItem>
  )
}
```

### 5.4 Action Button Mapping

| Current Button | New Behavior | Calls |
|----------------|--------------|-------|
| "Work on this" | Move to discussing | `moveTrade({ target: { type: 'stage', stage: 'discussing' }})` |
| "Send to Simulation" | Move to simulating | `moveTrade({ target: { type: 'stage', stage: 'simulating' }})` |
| "Escalate to Deciding" | Move to deciding | `moveTrade({ target: { type: 'stage', stage: 'deciding' }})` |
| "Execute" | Set outcome executed | `moveTrade({ target: { type: 'outcome', outcome: 'executed' }})` |
| "Reject" | Set outcome rejected | `moveTrade({ target: { type: 'outcome', outcome: 'rejected' }})` |
| "Defer" | Set outcome deferred | `moveTrade({ target: { type: 'outcome', outcome: 'deferred' }})` |
| "Delete" | Move to trash | `deleteTrade({ tradeId })` |
| "Restore" | Restore from trash | `restoreTrade({ tradeId })` |

### 5.5 Drag & Drop Integration

```typescript
const handleDrop = (tradeId: string, targetStage: WorkflowStage) => {
  // ALL drag/drop actions go through moveTrade
  moveTrade({
    tradeId,
    target: { type: 'stage', stage: targetStage },
    metadata: { ui_source: 'drag_drop' },
  })
}
```

---

## 6. Summary

### Key Principles Enforced

1. **Single mutation path**: All state changes go through `moveTrade()`, `deleteTrade()`, or `restoreTrade()`
2. **No direct field mutation**: UI never writes to `workflow_stage`, `workflow_outcome`, or `deleted_at` directly
3. **Immutable audit log**: Every transition creates an `trade_activity_log` entry
4. **Clear separation**: Workflow states (stage/outcome) vs. retention states (visibility tier)
5. **Deterministic restore**: `previous_state` snapshot enables exact restoration

### Terminology Reference

| Term | Meaning |
|------|---------|
| **Workflow Stage** | Pipeline position: idea → discussing → simulating → deciding |
| **Workflow Outcome** | Terminal decision: executed, rejected, deferred |
| **Visibility Tier** | Retention state: active, trash, archive |
| **Deferred** | "Not now, maybe later" (replaces "archived" as workflow state) |
| **Archive** | Deep retention for audit (NOT a workflow state) |
| **Trash** | Recently deleted, restorable within 30 days |
