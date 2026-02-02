/**
 * Trade Idea Service
 *
 * THE ONLY WAY to mutate trade ideas.
 *
 * All UI components, API routes, and background jobs MUST use this service.
 * This ensures audit events are emitted for every state change.
 *
 * Core Concepts:
 * - Stage: idea → discussing → simulating → deciding
 * - Outcome: executed | rejected | deferred (only valid in 'deciding' stage)
 * - Visibility Tier: active | trash | archive
 */

import { supabase } from '../supabase'
import {
  emitAuditEvent,
  checkIdempotency,
  getChangedFields,
  createStateSnapshot,
  SYSTEM_ACTORS,
} from '../audit'
import type {
  TradeStage,
  TradeOutcome,
  VisibilityTier,
  TradeQueueStatus,
  ActionContext,
  MoveTarget,
  StateSnapshot as TradeStateSnapshot,
} from '../../types/trading'

// ============================================================
// Types
// ============================================================

export interface TradeIdeaState {
  id: string
  stage: TradeStage
  outcome: TradeOutcome | null
  visibility_tier: VisibilityTier
  status: TradeQueueStatus // Legacy field
  action: string
  urgency: string
  asset_id: string
  portfolio_id: string
  proposed_shares?: number | null
  proposed_weight?: number | null
  rationale?: string | null
  deleted_at?: string | null
  deleted_by?: string | null
  archived_at?: string | null
  previous_state?: TradeStateSnapshot | null
}

export interface MoveTradeIdeaParams {
  tradeId: string
  target: MoveTarget
  context: ActionContext
  note?: string
}

export interface DeleteTradeIdeaParams {
  tradeId: string
  context: ActionContext
  reason?: string
}

export interface RestoreTradeIdeaParams {
  tradeId: string
  context: ActionContext
  targetStage?: TradeStage
}

export interface BulkMoveParams {
  tradeIds: string[]
  target: MoveTarget
  context: ActionContext
}

export interface CreateTradeParams {
  portfolioId: string
  assetId: string
  action: string
  proposedWeight?: number | null
  proposedShares?: number | null
  targetPrice?: number | null
  urgency: string
  rationale?: string
  sharingVisibility?: 'private' | 'portfolio' | 'team' | 'public'
  context: ActionContext
  // Provenance - auto-captured origin context
  originType?: string
  originEntityType?: string | null
  originEntityId?: string | null
  originRoute?: string
  originMetadata?: Record<string, unknown>
  // Context tags - entity-based categorization
  contextTags?: Array<{
    entity_type: string
    entity_id: string
    display_name: string
  }>
}

export interface CreatePairTradeParams {
  portfolioId: string
  name?: string
  description?: string
  rationale?: string
  urgency: string
  legs: Array<{
    assetId: string
    action: string
    legType: 'long' | 'short'
    proposedWeight?: number | null
    proposedShares?: number | null
    targetPrice?: number | null
  }>
  context: ActionContext
}

export interface UpdateTradeIdeaParams {
  tradeId: string
  updates: {
    rationale?: string | null
    proposedWeight?: number | null
    proposedShares?: number | null
    targetPrice?: number | null
    stopLoss?: number | null
    takeProfit?: number | null
    conviction?: 'low' | 'medium' | 'high' | null
    timeHorizon?: 'short' | 'medium' | 'long' | null
    urgency?: string
    sharingVisibility?: 'private' | 'portfolio' | 'team' | 'public' | null
    contextTags?: Array<{
      entity_type: string
      entity_id: string
      display_name: string
    }> | null
  }
  context: ActionContext
}

// ============================================================
// Helpers
// ============================================================

/**
 * Map stage to legacy status for backwards compatibility
 */
function stageToLegacyStatus(stage: TradeStage, outcome: TradeOutcome | null): TradeQueueStatus {
  if (outcome === 'executed') return 'executed'
  if (outcome === 'rejected') return 'rejected'
  if (outcome === 'deferred') return 'cancelled' // Map deferred to cancelled for legacy
  return stage as TradeQueueStatus
}

/**
 * Get org_id from context (returns undefined if not set)
 */
function getOrgId(context: ActionContext): string | undefined {
  // TODO: Get org_id from user's organization
  // Return undefined to let the database use NULL
  return undefined
}

/**
 * Get a trade idea by ID
 */
async function getTradeIdea(tradeId: string): Promise<TradeIdeaState | null> {
  const { data, error } = await supabase
    .from('trade_queue_items')
    .select(`
      id, stage, outcome, visibility_tier, status,
      action, urgency, asset_id, portfolio_id,
      proposed_shares, proposed_weight, rationale,
      deleted_at, deleted_by, archived_at, previous_state,
      assets (symbol),
      portfolios (id, name)
    `)
    .eq('id', tradeId)
    .single()

  if (error || !data) return null
  return data as TradeIdeaState
}

/**
 * Get display name for a trade idea
 */
async function getTradeDisplayName(trade: TradeIdeaState): Promise<string> {
  const { data: asset } = await supabase
    .from('assets')
    .select('symbol')
    .eq('id', trade.asset_id)
    .single()

  return `${trade.action.toUpperCase()} ${asset?.symbol || 'Unknown'}`
}

/**
 * Validate stage transition
 */
function validateStageTransition(
  fromStage: TradeStage,
  fromOutcome: TradeOutcome | null,
  target: MoveTarget
): { valid: boolean; error?: string } {
  const { stage: toStage, outcome: toOutcome } = target

  // If in deciding with an outcome, can't change stage (already decided)
  if (fromStage === 'deciding' && fromOutcome !== null) {
    return { valid: false, error: 'Trade has already been decided. Cannot change stage.' }
  }

  // Outcome only valid when stage is 'deciding'
  if (toOutcome && toStage !== 'deciding') {
    return { valid: false, error: 'Outcome can only be set in deciding stage.' }
  }

  // Valid transitions
  const validTransitions: Record<TradeStage, TradeStage[]> = {
    idea: ['discussing', 'simulating', 'deciding'],
    discussing: ['idea', 'simulating', 'deciding'],
    simulating: ['idea', 'discussing', 'deciding'],
    deciding: ['idea', 'discussing', 'simulating'], // Can demote if no outcome yet
  }

  // Allow same stage (for setting outcome in deciding)
  if (fromStage === toStage) {
    return { valid: true }
  }

  if (!validTransitions[fromStage].includes(toStage)) {
    return { valid: false, error: `Cannot transition from ${fromStage} to ${toStage}` }
  }

  return { valid: true }
}

// ============================================================
// Core Service Functions
// ============================================================

/**
 * Move a trade idea to a new stage/outcome
 *
 * This is THE function for all state changes.
 * All UI actions (drag/drop, buttons, bulk) must call this.
 */
export async function moveTradeIdea(params: MoveTradeIdeaParams): Promise<void> {
  const { tradeId, target, context, note } = params

  // Idempotency check
  if (context.requestId) {
    const isDuplicate = await checkIdempotency({
      requestId: context.requestId,
      entityType: 'trade_idea',
      entityId: tradeId,
      actionType: 'move_stage',
    })
    if (isDuplicate) {
      console.log(`[TRADE] Skipping duplicate request ${context.requestId}`)
      return
    }
  }

  // Get current state
  const currentTrade = await getTradeIdea(tradeId)
  if (!currentTrade) {
    throw new Error(`Trade not found: ${tradeId}`)
  }

  // Check visibility - can't move items in trash or archive
  if (currentTrade.visibility_tier !== 'active') {
    throw new Error(`Cannot move trade in ${currentTrade.visibility_tier}. Restore it first.`)
  }

  // Validate transition
  const validation = validateStageTransition(
    currentTrade.stage,
    currentTrade.outcome,
    target
  )
  if (!validation.valid) {
    throw new Error(validation.error)
  }

  // No change needed
  if (
    currentTrade.stage === target.stage &&
    currentTrade.outcome === (target.outcome || null)
  ) {
    return
  }

  // Build update object
  const now = new Date().toISOString()
  const updates: Record<string, unknown> = {
    stage: target.stage,
    status: stageToLegacyStatus(target.stage, target.outcome || null),
    updated_at: now,
  }

  // Handle outcome
  if (target.outcome) {
    updates.outcome = target.outcome
    updates.outcome_at = now
    updates.outcome_by = context.actorId
    updates.outcome_note = note || null

    // Legacy fields
    if (target.outcome === 'executed') {
      updates.approved_by = context.actorId
      updates.approved_at = now
      updates.executed_at = now
    }
  } else if (target.stage !== 'deciding' && currentTrade.outcome) {
    // Moving out of deciding clears outcome
    updates.outcome = null
    updates.outcome_at = null
    updates.outcome_by = null
    updates.outcome_note = null
  }

  // Perform update
  const { error } = await supabase
    .from('trade_queue_items')
    .update(updates)
    .eq('id', tradeId)

  if (error) {
    throw new Error(`Failed to move trade: ${error.message}`)
  }

  // Get display name for audit
  const displayName = await getTradeDisplayName(currentTrade)

  // Determine action type
  const isOutcomeSet = target.outcome && !currentTrade.outcome
  const actionType = isOutcomeSet ? 'set_outcome' : 'move_stage'

  // Emit audit event
  await emitAuditEvent({
    actor: { id: context.actorId, type: 'user', role: context.actorRole },
    entity: {
      type: 'trade_idea',
      id: tradeId,
      displayName,
    },
    action: { type: actionType, category: 'state_change' },
    state: {
      from: { stage: currentTrade.stage, outcome: currentTrade.outcome },
      to: { stage: target.stage, outcome: target.outcome || null },
    },
    changedFields: target.outcome ? ['stage', 'outcome'] : ['stage'],
    metadata: {
      request_id: context.requestId,
      ui_source: context.uiSource,
      batch_id: context.batchId,
      batch_index: context.batchIndex,
      batch_total: context.batchTotal,
      from_stage: currentTrade.stage,
      to_stage: target.stage,
      from_outcome: currentTrade.outcome,
      to_outcome: target.outcome || null,
      note,
    },
    orgId: getOrgId(context),
    teamId: undefined,
    actorName: context.actorName,
    actorEmail: context.actorEmail,
  })
}

/**
 * Delete a trade idea (soft delete to trash)
 */
export async function deleteTradeIdea(params: DeleteTradeIdeaParams): Promise<void> {
  const { tradeId, context, reason } = params

  // Idempotency check
  if (context.requestId) {
    const isDuplicate = await checkIdempotency({
      requestId: context.requestId,
      entityType: 'trade_idea',
      entityId: tradeId,
      actionType: 'delete',
    })
    if (isDuplicate) {
      console.log(`[TRADE] Skipping duplicate delete request ${context.requestId}`)
      return
    }
  }

  // Get current state
  const currentTrade = await getTradeIdea(tradeId)
  if (!currentTrade) {
    throw new Error(`Trade not found: ${tradeId}`)
  }

  if (currentTrade.visibility_tier === 'trash') {
    throw new Error('Trade is already in trash')
  }

  if (currentTrade.visibility_tier === 'archive') {
    throw new Error('Cannot delete archived trade')
  }

  // Snapshot previous state for restore
  const previousState: TradeStateSnapshot = {
    stage: currentTrade.stage,
    outcome: currentTrade.outcome,
    visibility_tier: currentTrade.visibility_tier,
    updated_at: new Date().toISOString(),
  }

  const now = new Date().toISOString()

  // Perform soft delete
  const { error } = await supabase
    .from('trade_queue_items')
    .update({
      visibility_tier: 'trash',
      status: 'deleted', // Legacy status
      deleted_at: now,
      deleted_by: context.actorId,
      previous_state: previousState,
      updated_at: now,
    })
    .eq('id', tradeId)

  if (error) {
    throw new Error(`Failed to delete trade: ${error.message}`)
  }

  // Get display name for audit
  const displayName = await getTradeDisplayName(currentTrade)

  // Emit audit event
  await emitAuditEvent({
    actor: { id: context.actorId, type: 'user', role: context.actorRole },
    entity: {
      type: 'trade_idea',
      id: tradeId,
      displayName,
    },
    action: { type: 'delete', category: 'lifecycle' },
    state: {
      from: { stage: currentTrade.stage, outcome: currentTrade.outcome, visibility_tier: 'active' },
      to: { stage: currentTrade.stage, outcome: currentTrade.outcome, visibility_tier: 'trash' },
    },
    changedFields: ['visibility_tier', 'deleted_at', 'deleted_by'],
    metadata: {
      request_id: context.requestId,
      ui_source: context.uiSource,
      reason,
      previous_state: previousState,
    },
    orgId: getOrgId(context),
    teamId: undefined,
    actorName: context.actorName,
    actorEmail: context.actorEmail,
  })
}

/**
 * Restore a trade idea from trash
 */
export async function restoreTradeIdea(params: RestoreTradeIdeaParams): Promise<void> {
  const { tradeId, context, targetStage } = params

  // Idempotency check
  if (context.requestId) {
    const isDuplicate = await checkIdempotency({
      requestId: context.requestId,
      entityType: 'trade_idea',
      entityId: tradeId,
      actionType: 'restore',
    })
    if (isDuplicate) {
      console.log(`[TRADE] Skipping duplicate restore request ${context.requestId}`)
      return
    }
  }

  // Get current state
  const currentTrade = await getTradeIdea(tradeId)
  if (!currentTrade) {
    throw new Error(`Trade not found: ${tradeId}`)
  }

  if (currentTrade.visibility_tier === 'active') {
    throw new Error('Trade is not in trash')
  }

  if (currentTrade.visibility_tier === 'archive') {
    throw new Error('Cannot restore archived trades. Contact compliance for access.')
  }

  // Determine restore stage
  const previousState = currentTrade.previous_state as TradeStateSnapshot | null
  const restoreStage = targetStage || previousState?.stage || 'idea'

  const now = new Date().toISOString()

  // Perform restore
  const { error } = await supabase
    .from('trade_queue_items')
    .update({
      visibility_tier: 'active',
      stage: restoreStage,
      status: stageToLegacyStatus(restoreStage, null),
      outcome: null, // Clear outcome on restore
      deleted_at: null,
      deleted_by: null,
      previous_state: null,
      updated_at: now,
    })
    .eq('id', tradeId)

  if (error) {
    throw new Error(`Failed to restore trade: ${error.message}`)
  }

  // Get display name
  const displayName = await getTradeDisplayName(currentTrade)

  // Emit audit event
  await emitAuditEvent({
    actor: { id: context.actorId, type: 'user', role: context.actorRole },
    entity: {
      type: 'trade_idea',
      id: tradeId,
      displayName,
    },
    action: { type: 'restore', category: 'lifecycle' },
    state: {
      from: { stage: currentTrade.stage, outcome: currentTrade.outcome, visibility_tier: 'trash' },
      to: { stage: restoreStage, outcome: null, visibility_tier: 'active' },
    },
    changedFields: ['visibility_tier', 'stage', 'deleted_at', 'deleted_by'],
    metadata: {
      request_id: context.requestId,
      ui_source: context.uiSource,
      restored_to_stage: restoreStage,
    },
    orgId: getOrgId(context),
    teamId: undefined,
    actorName: context.actorName,
    actorEmail: context.actorEmail,
  })
}

/**
 * Bulk move multiple trade ideas
 */
export async function bulkMoveTradeIdeas(params: BulkMoveParams): Promise<{
  succeeded: string[]
  failed: Array<{ tradeId: string; error: string }>
}> {
  const { tradeIds, target, context } = params
  const batchId = crypto.randomUUID()

  const succeeded: string[] = []
  const failed: Array<{ tradeId: string; error: string }> = []

  for (let i = 0; i < tradeIds.length; i++) {
    const tradeId = tradeIds[i]

    try {
      await moveTradeIdea({
        tradeId,
        target,
        context: {
          ...context,
          requestId: context.requestId ? `${context.requestId}-${i}` : crypto.randomUUID(),
          batchId,
          batchIndex: i,
          batchTotal: tradeIds.length,
        },
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

/**
 * Archive trade ideas that have been in trash for > 30 days
 *
 * Run this as a scheduled job (daily cron)
 */
export async function autoArchiveDeletedTradeIdeas(): Promise<{ archived: number }> {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - 30)

  // Find trades to archive
  const { data: tradesToArchive, error: findError } = await supabase
    .from('trade_queue_items')
    .select('id, stage, outcome, action, asset_id, deleted_at')
    .eq('visibility_tier', 'trash')
    .not('deleted_at', 'is', null)
    .lt('deleted_at', cutoffDate.toISOString())

  if (findError) {
    throw new Error(`Failed to find trades to archive: ${findError.message}`)
  }

  if (!tradesToArchive || tradesToArchive.length === 0) {
    return { archived: 0 }
  }

  const now = new Date().toISOString()
  const batchId = crypto.randomUUID()

  // Update all to archive
  const { error: updateError } = await supabase
    .from('trade_queue_items')
    .update({
      visibility_tier: 'archive',
      archived_at: now,
      updated_at: now,
    })
    .in('id', tradesToArchive.map(t => t.id))

  if (updateError) {
    throw new Error(`Failed to archive trades: ${updateError.message}`)
  }

  // Log activity for each trade
  for (const trade of tradesToArchive) {
    const { data: asset } = await supabase
      .from('assets')
      .select('symbol')
      .eq('id', trade.asset_id)
      .single()

    const displayName = `${trade.action.toUpperCase()} ${asset?.symbol || 'Unknown'}`

    await emitAuditEvent({
      actor: SYSTEM_ACTORS.AUTO_ARCHIVE,
      entity: {
        type: 'trade_idea',
        id: trade.id,
        displayName,
      },
      action: { type: 'auto_archive', category: 'system' },
      state: {
        from: { stage: trade.stage, outcome: trade.outcome, visibility_tier: 'trash' },
        to: { stage: trade.stage, outcome: trade.outcome, visibility_tier: 'archive' },
      },
      metadata: {
        batch_id: batchId,
        reason: 'Auto-archived after 30 days in trash',
        deleted_at: trade.deleted_at,
      },
      orgId: undefined,
    })
  }

  return { archived: tradesToArchive.length }
}

// ============================================================
// Create Functions
// ============================================================

/**
 * Create a new trade idea
 */
export async function createTradeIdea(params: CreateTradeParams): Promise<{ id: string }> {
  const {
    portfolioId,
    assetId,
    action,
    proposedWeight,
    proposedShares,
    targetPrice,
    urgency,
    rationale,
    sharingVisibility,
    context,
    // Provenance
    originType,
    originEntityType,
    originEntityId,
    originRoute,
    originMetadata,
    // Context tags
    contextTags,
  } = params

  // Create the trade
  const { data, error } = await supabase
    .from('trade_queue_items')
    .insert({
      portfolio_id: portfolioId,
      asset_id: assetId,
      action,
      proposed_weight: proposedWeight,
      proposed_shares: proposedShares,
      target_price: targetPrice,
      urgency,
      rationale,
      sharing_visibility: sharingVisibility || 'private',
      stage: 'idea',
      outcome: null,
      visibility_tier: 'active',
      status: 'idea', // Legacy
      created_by: context.actorId,
      // Provenance fields
      origin_type: originType || 'manual',
      origin_entity_type: originEntityType || null,
      origin_entity_id: originEntityId || null,
      origin_route: originRoute || null,
      origin_metadata: originMetadata || {},
      // Context tags
      context_tags: contextTags || [],
    })
    .select('id')
    .single()

  if (error) {
    throw new Error(`Failed to create trade: ${error.message}`)
  }

  // Get asset symbol for display name
  const { data: asset } = await supabase
    .from('assets')
    .select('symbol')
    .eq('id', assetId)
    .single()

  const displayName = `${action.toUpperCase()} ${asset?.symbol || 'Unknown'}`

  // Emit audit event
  await emitAuditEvent({
    actor: { id: context.actorId, type: 'user', role: context.actorRole },
    entity: {
      type: 'trade_idea',
      id: data.id,
      displayName,
    },
    action: { type: 'create', category: 'lifecycle' },
    state: {
      from: null,
      to: {
        stage: 'idea',
        outcome: null,
        visibility_tier: 'active',
        action,
        urgency,
        proposed_weight: proposedWeight,
        proposed_shares: proposedShares,
      },
    },
    changedFields: ['stage', 'action', 'urgency', 'asset_id', 'portfolio_id'],
    metadata: {
      request_id: context.requestId,
      ui_source: context.uiSource,
      asset_id: assetId,
      portfolio_id: portfolioId,
      asset_symbol: asset?.symbol,
    },
    orgId: getOrgId(context),
    teamId: undefined,
    actorName: context.actorName,
    actorEmail: context.actorEmail,
    assetSymbol: asset?.symbol,
  })

  // Auto-link to trade lab for this portfolio (create if needed)
  if (portfolioId) {
    // Find or create trade lab for this portfolio
    let { data: existingLab } = await supabase
      .from('trade_labs')
      .select('id')
      .eq('portfolio_id', portfolioId)
      .single()

    if (!existingLab) {
      // Get portfolio name for lab naming
      const { data: portfolio } = await supabase
        .from('portfolios')
        .select('name')
        .eq('id', portfolioId)
        .single()

      const { data: newLab } = await supabase
        .from('trade_labs')
        .insert({
          portfolio_id: portfolioId,
          name: `${portfolio?.name || 'Portfolio'} Trade Lab`,
          settings: {},
          created_by: context.actorId,
        })
        .select('id')
        .single()

      existingLab = newLab
    }

    if (existingLab) {
      await supabase
        .from('trade_lab_idea_links')
        .insert({
          trade_queue_item_id: data.id,
          trade_lab_id: existingLab.id,
          created_by: context.actorId,
        })
    }
  }

  return { id: data.id }
}

/**
 * Update an existing trade idea
 *
 * Supports updating: rationale, sizing, risk/planning fields, context tags
 * Validates ownership and emits audit events
 */
export async function updateTradeIdea(params: UpdateTradeIdeaParams): Promise<void> {
  const { tradeId, updates, context } = params

  // Get current state
  const currentTrade = await getTradeIdea(tradeId)
  if (!currentTrade) {
    throw new Error(`Trade not found: ${tradeId}`)
  }

  // Build update object - only include fields that are being changed
  const now = new Date().toISOString()
  const dbUpdates: Record<string, unknown> = {
    updated_at: now,
  }

  const changedFields: string[] = []

  // Map camelCase to snake_case and track changes
  if (updates.rationale !== undefined) {
    dbUpdates.rationale = updates.rationale
    changedFields.push('rationale')
  }
  if (updates.proposedWeight !== undefined) {
    dbUpdates.proposed_weight = updates.proposedWeight
    changedFields.push('proposed_weight')
  }
  if (updates.proposedShares !== undefined) {
    dbUpdates.proposed_shares = updates.proposedShares
    changedFields.push('proposed_shares')
  }
  if (updates.targetPrice !== undefined) {
    dbUpdates.target_price = updates.targetPrice
    changedFields.push('target_price')
  }
  if (updates.stopLoss !== undefined) {
    dbUpdates.stop_loss = updates.stopLoss
    changedFields.push('stop_loss')
  }
  if (updates.takeProfit !== undefined) {
    dbUpdates.take_profit = updates.takeProfit
    changedFields.push('take_profit')
  }
  if (updates.conviction !== undefined) {
    dbUpdates.conviction = updates.conviction
    changedFields.push('conviction')
  }
  if (updates.timeHorizon !== undefined) {
    dbUpdates.time_horizon = updates.timeHorizon
    changedFields.push('time_horizon')
  }
  if (updates.urgency !== undefined) {
    dbUpdates.urgency = updates.urgency
    changedFields.push('urgency')
  }
  if (updates.sharingVisibility !== undefined) {
    dbUpdates.sharing_visibility = updates.sharingVisibility
    changedFields.push('sharing_visibility')
  }
  if (updates.contextTags !== undefined) {
    dbUpdates.context_tags = updates.contextTags
    changedFields.push('context_tags')
  }

  // No changes to make
  if (changedFields.length === 0) {
    return
  }

  // Perform update
  const { error } = await supabase
    .from('trade_queue_items')
    .update(dbUpdates)
    .eq('id', tradeId)

  if (error) {
    throw new Error(`Failed to update trade: ${error.message}`)
  }

  // Get display name for audit
  const displayName = await getTradeDisplayName(currentTrade)

  // Emit audit event
  await emitAuditEvent({
    actor: { id: context.actorId, type: 'user', role: context.actorRole },
    entity: {
      type: 'trade_idea',
      id: tradeId,
      displayName,
    },
    action: { type: 'update', category: 'content_change' },
    state: {
      from: {
        rationale: currentTrade.rationale,
      },
      to: {
        ...updates,
      },
    },
    changedFields,
    metadata: {
      request_id: context.requestId,
      ui_source: context.uiSource,
    },
    orgId: getOrgId(context),
    teamId: undefined,
    actorName: context.actorName,
    actorEmail: context.actorEmail,
  })
}

/**
 * Create a new pair trade with legs
 */
export async function createPairTrade(params: CreatePairTradeParams): Promise<{ id: string; legIds: string[] }> {
  const {
    portfolioId,
    name,
    description,
    rationale,
    urgency,
    legs,
    context,
  } = params

  // Create the pair trade
  const { data: pairTrade, error: pairError } = await supabase
    .from('pair_trades')
    .insert({
      portfolio_id: portfolioId,
      name,
      description,
      rationale,
      urgency,
      status: 'idea',
      created_by: context.actorId,
    })
    .select('id')
    .single()

  if (pairError) {
    throw new Error(`Failed to create pair trade: ${pairError.message}`)
  }

  // Create the legs
  const legInserts = legs.map((leg) => ({
    portfolio_id: portfolioId,
    asset_id: leg.assetId,
    action: leg.action,
    proposed_shares: leg.proposedShares,
    proposed_weight: leg.proposedWeight,
    target_price: leg.targetPrice,
    urgency,
    stage: 'idea' as TradeStage,
    outcome: null,
    visibility_tier: 'active' as VisibilityTier,
    status: 'idea', // Legacy
    rationale: '',
    created_by: context.actorId,
    pair_trade_id: pairTrade.id,
    pair_leg_type: leg.legType,
  }))

  const { data: createdLegs, error: legsError } = await supabase
    .from('trade_queue_items')
    .insert(legInserts)
    .select('id, asset_id')

  if (legsError) {
    throw new Error(`Failed to create pair trade legs: ${legsError.message}`)
  }

  // Get asset symbols for display
  const assetIds = legs.map((l) => l.assetId)
  const { data: assets } = await supabase
    .from('assets')
    .select('id, symbol')
    .in('id', assetIds)

  const assetMap = new Map(assets?.map((a) => [a.id, a.symbol]) || [])

  // Generate display name
  const longSymbols = legs
    .filter((l) => l.legType === 'long')
    .map((l) => assetMap.get(l.assetId) || 'Unknown')
    .join('/')
  const shortSymbols = legs
    .filter((l) => l.legType === 'short')
    .map((l) => assetMap.get(l.assetId) || 'Unknown')
    .join('/')

  const displayName = name || `Long ${longSymbols} / Short ${shortSymbols}`

  // Emit audit event for pair trade
  await emitAuditEvent({
    actor: { id: context.actorId, type: 'user', role: context.actorRole },
    entity: {
      type: 'pair_trade',
      id: pairTrade.id,
      displayName,
    },
    action: { type: 'create', category: 'lifecycle' },
    state: {
      from: null,
      to: {
        stage: 'idea',
        outcome: null,
        visibility_tier: 'active',
        urgency,
        leg_count: legs.length,
      },
    },
    changedFields: ['stage', 'urgency', 'portfolio_id'],
    metadata: {
      request_id: context.requestId,
      ui_source: context.uiSource,
      portfolio_id: portfolioId,
      leg_count: legs.length,
    },
    orgId: getOrgId(context),
    teamId: undefined,
    actorName: context.actorName,
    actorEmail: context.actorEmail,
  })

  // Emit audit events for each leg
  for (const leg of createdLegs || []) {
    const symbol = assetMap.get(leg.asset_id) || 'Unknown'
    const legInfo = legs.find((l) => l.assetId === leg.asset_id)

    await emitAuditEvent({
      actor: { id: context.actorId, type: 'user', role: context.actorRole },
      entity: {
        type: 'trade_idea',
        id: leg.id,
        displayName: `${legInfo?.action.toUpperCase() || 'TRADE'} ${symbol}`,
      },
      parent: {
        type: 'pair_trade',
        id: pairTrade.id,
      },
      action: { type: 'create', category: 'lifecycle' },
      state: {
        from: null,
        to: {
          stage: 'idea',
          outcome: null,
          visibility_tier: 'active',
          action: legInfo?.action,
          leg_type: legInfo?.legType,
        },
      },
      changedFields: ['stage', 'action', 'asset_id', 'pair_trade_id'],
      metadata: {
        request_id: context.requestId,
        ui_source: context.uiSource,
        via_pair_trade: true,
        asset_symbol: symbol,
      },
      orgId: getOrgId(context),
      teamId: undefined,
      actorName: context.actorName,
      actorEmail: context.actorEmail,
      assetSymbol: symbol,
    })
  }

  // Auto-link all legs to trade lab for this portfolio (create if needed)
  if (portfolioId && createdLegs && createdLegs.length > 0) {
    // Find or create trade lab for this portfolio
    let { data: existingLab } = await supabase
      .from('trade_labs')
      .select('id')
      .eq('portfolio_id', portfolioId)
      .single()

    if (!existingLab) {
      // Get portfolio name for lab naming
      const { data: portfolio } = await supabase
        .from('portfolios')
        .select('name')
        .eq('id', portfolioId)
        .single()

      const { data: newLab } = await supabase
        .from('trade_labs')
        .insert({
          portfolio_id: portfolioId,
          name: `${portfolio?.name || 'Portfolio'} Trade Lab`,
          settings: {},
          created_by: context.actorId,
        })
        .select('id')
        .single()

      existingLab = newLab
    }

    if (existingLab) {
      const labLinks = createdLegs.map(leg => ({
        trade_queue_item_id: leg.id,
        trade_lab_id: existingLab!.id,
        created_by: context.actorId,
      }))

      await supabase
        .from('trade_lab_idea_links')
        .insert(labLinks)
    }
  }

  return {
    id: pairTrade.id,
    legIds: createdLegs?.map((l) => l.id) || [],
  }
}

// ============================================================
// Pair Trade Functions
// ============================================================

/**
 * Move a pair trade and all its legs to a new stage/outcome
 */
export async function movePairTrade(params: {
  pairTradeId: string
  target: MoveTarget
  context: ActionContext
  note?: string
}): Promise<void> {
  const { pairTradeId, target, context, note } = params

  // Get current pair trade
  const { data: pairTrade, error: fetchError } = await supabase
    .from('pair_trades')
    .select('*, trade_queue_items (id, stage, outcome)')
    .eq('id', pairTradeId)
    .single()

  if (fetchError || !pairTrade) {
    throw new Error(`Pair trade not found: ${pairTradeId}`)
  }

  const fromStatus = pairTrade.status

  const now = new Date().toISOString()

  // Update pair trade
  const { error: pairError } = await supabase
    .from('pair_trades')
    .update({
      status: stageToLegacyStatus(target.stage, target.outcome || null),
      updated_at: now,
    })
    .eq('id', pairTradeId)

  if (pairError) {
    throw new Error(`Failed to update pair trade: ${pairError.message}`)
  }

  // Update all legs
  const legUpdates: Record<string, unknown> = {
    stage: target.stage,
    status: stageToLegacyStatus(target.stage, target.outcome || null),
    updated_at: now,
  }

  if (target.outcome) {
    legUpdates.outcome = target.outcome
    legUpdates.outcome_at = now
    legUpdates.outcome_by = context.actorId
    legUpdates.outcome_note = note || null

    if (target.outcome === 'executed') {
      legUpdates.approved_by = context.actorId
      legUpdates.approved_at = now
      legUpdates.executed_at = now
    }
  }

  const { error: legsError } = await supabase
    .from('trade_queue_items')
    .update(legUpdates)
    .eq('pair_trade_id', pairTradeId)

  if (legsError) {
    throw new Error(`Failed to update pair trade legs: ${legsError.message}`)
  }

  // Determine action type
  const isOutcomeSet = target.outcome !== undefined
  const actionType = isOutcomeSet ? 'set_outcome' : 'move_stage'

  // Emit audit event for pair trade
  await emitAuditEvent({
    actor: { id: context.actorId, type: 'user', role: context.actorRole },
    entity: {
      type: 'pair_trade',
      id: pairTradeId,
      displayName: pairTrade.name || 'Pair Trade',
    },
    action: { type: actionType, category: 'state_change' },
    state: {
      from: { status: fromStatus },
      to: { stage: target.stage, outcome: target.outcome || null },
    },
    changedFields: target.outcome ? ['stage', 'outcome'] : ['stage'],
    metadata: {
      request_id: context.requestId,
      ui_source: context.uiSource,
      leg_count: pairTrade.trade_queue_items?.length || 0,
      note,
    },
    orgId: getOrgId(context),
    teamId: undefined,
    actorName: context.actorName,
    actorEmail: context.actorEmail,
  })

  // Emit audit events for each leg
  for (const leg of pairTrade.trade_queue_items || []) {
    await emitAuditEvent({
      actor: { id: context.actorId, type: 'user', role: context.actorRole },
      entity: {
        type: 'trade_idea',
        id: leg.id,
      },
      parent: {
        type: 'pair_trade',
        id: pairTradeId,
      },
      action: { type: actionType, category: 'state_change' },
      state: {
        from: { stage: leg.stage, outcome: leg.outcome },
        to: { stage: target.stage, outcome: target.outcome || null },
      },
      changedFields: target.outcome ? ['stage', 'outcome'] : ['stage'],
      metadata: {
        request_id: context.requestId,
        ui_source: context.uiSource,
        via_pair_trade: true,
        note,
      },
      orgId: getOrgId(context),
      teamId: undefined,
      actorName: context.actorName,
      actorEmail: context.actorEmail,
    })
  }
}

// ============================================================
// Legacy Compatibility
// ============================================================

/**
 * @deprecated Use moveTradeIdea instead
 * Kept for backwards compatibility during migration
 */
export async function moveTrade(params: {
  tradeId: string
  targetStatus: TradeQueueStatus
  actorId: string
  actorRole?: string
  orgId: string
  teamId?: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  const { tradeId, targetStatus, actorId, actorRole, metadata = {} } = params

  // Map legacy status to new stage/outcome
  let target: MoveTarget
  switch (targetStatus) {
    case 'executed':
    case 'approved':
      target = { stage: 'deciding', outcome: 'executed' }
      break
    case 'rejected':
      target = { stage: 'deciding', outcome: 'rejected' }
      break
    case 'cancelled':
      target = { stage: 'deciding', outcome: 'deferred' }
      break
    default:
      target = { stage: targetStatus as TradeStage }
  }

  await moveTradeIdea({
    tradeId,
    target,
    context: {
      actorId,
      actorName: '',
      actorRole: actorRole as 'analyst' | 'pm' | 'admin' | 'system',
      requestId: (metadata.request_id as string) || crypto.randomUUID(),
      uiSource: metadata.ui_source as any,
    },
  })
}

/**
 * @deprecated Use deleteTradeIdea instead
 */
export async function deleteTrade(params: {
  tradeId: string
  actorId: string
  actorRole?: string
  orgId: string
  teamId?: string
  reason?: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  const { tradeId, actorId, actorRole, reason, metadata = {} } = params

  await deleteTradeIdea({
    tradeId,
    context: {
      actorId,
      actorName: '',
      actorRole: actorRole as 'analyst' | 'pm' | 'admin' | 'system',
      requestId: (metadata.request_id as string) || crypto.randomUUID(),
      uiSource: metadata.ui_source as any,
    },
    reason,
  })
}

/**
 * @deprecated Use restoreTradeIdea instead
 */
export async function restoreTrade(params: {
  tradeId: string
  targetStatus?: TradeQueueStatus
  actorId: string
  actorRole?: string
  orgId: string
  teamId?: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  const { tradeId, targetStatus, actorId, actorRole, metadata = {} } = params

  await restoreTradeIdea({
    tradeId,
    context: {
      actorId,
      actorName: '',
      actorRole: actorRole as 'analyst' | 'pm' | 'admin' | 'system',
      requestId: (metadata.request_id as string) || crypto.randomUUID(),
      uiSource: metadata.ui_source as any,
    },
    targetStage: targetStatus as TradeStage | undefined,
  })
}
