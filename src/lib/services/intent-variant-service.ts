/**
 * Intent Variant Service
 *
 * Manages Intent Variants in Trade Lab v3.
 * Handles creation, normalization, conflict persistence, and trade sheet creation.
 */

import { supabase } from '../supabase'
import { emitAuditEvent } from '../audit'
import {
  normalizeSizing,
  normalizeSizingBatch,
  hasAnyConflicts,
  hasAnyBelowLotWarnings,
  getNormalizationSummary,
  type NormalizationContext,
  type BatchNormalizationInput,
} from '../trade-lab/normalize-sizing'
import { parseSizingInput, toSizingSpec } from '../trade-lab/sizing-parser'
import type {
  IntentVariant,
  IntentVariantWithDetails,
  CreateIntentVariantInput,
  UpdateIntentVariantInput,
  VariantBatchUpdate,
  TradeSheet,
  RoundingConfig,
  ActiveWeightConfig,
  AssetPrice,
  ComputedValues,
  ActionContext,
  TradeAction,
} from '../../types/trading'

// =============================================================================
// TYPES
// =============================================================================

export interface FetchVariantsOptions {
  labId: string
  viewId?: string | null
  includeDeleted?: boolean
}

export interface CreateVariantParams {
  input: CreateIntentVariantInput
  portfolioId?: string
  currentPosition?: {
    shares: number
    weight: number
    cost_basis: number | null
    active_weight: number | null
  } | null
  price: AssetPrice
  portfolioTotalValue: number
  roundingConfig: RoundingConfig
  activeWeightConfig?: ActiveWeightConfig | null
  hasBenchmark: boolean
  context: ActionContext
}

export interface UpdateVariantParams {
  variantId: string
  updates: UpdateIntentVariantInput
  currentPosition?: {
    shares: number
    weight: number
    cost_basis: number | null
    active_weight: number | null
  } | null
  price: AssetPrice
  portfolioTotalValue: number
  roundingConfig: RoundingConfig
  activeWeightConfig?: ActiveWeightConfig | null
  hasBenchmark: boolean
  context: ActionContext
}

export interface RevalidateVariantsParams {
  labId: string
  viewId?: string | null
  prices: Map<string, AssetPrice>
  positions: Map<string, {
    shares: number
    weight: number
    cost_basis: number | null
    active_weight: number | null
  }>
  portfolioTotalValue: number
  roundingConfig: RoundingConfig
  hasBenchmark: boolean
  context: ActionContext
}

export interface CreateTradeSheetParams {
  labId: string
  viewId?: string | null
  name: string
  description?: string | null
  context: ActionContext
}

// =============================================================================
// FETCH VARIANTS
// =============================================================================

export async function getVariantsForLab(
  options: FetchVariantsOptions
): Promise<IntentVariantWithDetails[]> {
  const { labId, viewId, includeDeleted = false } = options

  let query = supabase
    .from('lab_variants')
    .select(`
      *,
      asset:assets (id, symbol, company_name, sector),
      trade_queue_item:trade_queue_items (id, rationale, urgency, stage)
    `)
    .eq('lab_id', labId)
    .order('created_at', { ascending: true })

  if (viewId !== undefined) {
    if (viewId === null) {
      query = query.is('view_id', null)
    } else {
      query = query.eq('view_id', viewId)
    }
  }

  if (!includeDeleted) {
    query = query.eq('visibility_tier', 'active')
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`Failed to fetch variants: ${error.message}`)
  }

  return data as IntentVariantWithDetails[]
}

export async function getVariant(variantId: string): Promise<IntentVariant | null> {
  const { data, error } = await supabase
    .from('lab_variants')
    .select('*')
    .eq('id', variantId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw new Error(`Failed to fetch variant: ${error.message}`)
  }

  return data as IntentVariant
}

// =============================================================================
// CREATE VARIANT
// =============================================================================

export async function createVariant(params: CreateVariantParams): Promise<IntentVariant> {
  const {
    input,
    portfolioId: passedPortfolioId,
    currentPosition,
    price,
    portfolioTotalValue,
    roundingConfig,
    activeWeightConfig,
    hasBenchmark,
    context,
  } = params

  // Normalize sizing
  const normCtx: NormalizationContext = {
    action: input.action,
    sizing_input: input.sizing_input,
    current_position: currentPosition ?? null,
    portfolio_total_value: portfolioTotalValue,
    price,
    rounding_config: roundingConfig,
    active_weight_config: activeWeightConfig ?? null,
    has_benchmark: hasBenchmark,
  }

  const normResult = normalizeSizing(normCtx)

  // Parse sizing spec
  const parseResult = parseSizingInput(input.sizing_input, { has_benchmark: hasBenchmark })
  const sizingSpec = parseResult.is_valid
    ? toSizingSpec(input.sizing_input, parseResult)
    : null

  // Use passed portfolioId if available, otherwise look it up
  let portfolioId = passedPortfolioId
  if (!portfolioId) {
    const { data: lab, error: labError } = await supabase
      .from('trade_labs')
      .select('portfolio_id')
      .eq('id', input.lab_id)
      .single()

    if (labError || !lab) {
      throw new Error(`Lab not found: ${input.lab_id}${labError ? ` (${labError.message})` : ''}`)
    }
    portfolioId = lab.portfolio_id
  }

  // Sanitize JSONB fields (strip NaN/Infinity which break JSON serialization)
  const safeJson = (val: any) => val != null ? JSON.parse(JSON.stringify(val)) : null

  // Insert variant (with retry for transient network errors)
  const insertPayload = {
    lab_id: input.lab_id,
    view_id: input.view_id ?? null,
    trade_queue_item_id: input.trade_queue_item_id ?? null,
    asset_id: input.asset_id,
    portfolio_id: portfolioId,
    action: input.action,
    sizing_input: input.sizing_input,
    sizing_spec: safeJson(sizingSpec),
    computed: safeJson(normResult.computed),
    direction_conflict: safeJson(normResult.direction_conflict),
    below_lot_warning: normResult.below_lot_warning,
    current_position: safeJson(currentPosition),
    active_weight_config: safeJson(activeWeightConfig),
    notes: input.notes ?? null,
    sort_order: input.sort_order ?? 0,
    touched_in_lab_at: new Date().toISOString(),
    created_by: context.actorId,
  }

  let data: any
  let error: any
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await supabase
      .from('lab_variants')
      .insert(insertPayload)
      .select('*, asset:assets(id, symbol, company_name, sector)')
      .single()
    data = result.data
    error = result.error
    if (!error || !error.message?.includes('Failed to fetch')) break
    // Wait briefly before retry
    await new Promise(r => setTimeout(r, 300 * (attempt + 1)))
  }

  if (error) {
    const isRLS = error.message?.includes('row-level security')
    throw new Error(
      isRLS
        ? `Permission denied: you don't have access to this portfolio's trade lab. Try refreshing or re-logging in.`
        : `Failed to create variant: ${error.message}`
    )
  }

  // Log event
  await emitAuditEvent({
    actor: { id: context.actorId, type: 'user', role: context.actorRole },
    entity: { type: 'lab_variant', id: data.id },
    action: { type: 'create', category: 'lifecycle' },
    state: {
      from: null,
      to: {
        action: input.action,
        sizing_input: input.sizing_input,
        direction_conflict: normResult.direction_conflict,
      },
    },
    metadata: {
      request_id: context.requestId,
      ui_source: context.uiSource,
      lab_id: input.lab_id,
      view_id: input.view_id,
    },
    orgId: undefined,
    actorName: context.actorName,
    actorEmail: context.actorEmail,
  })

  return data as IntentVariant
}

// =============================================================================
// UPDATE VARIANT
// =============================================================================

export async function updateVariant(params: UpdateVariantParams): Promise<IntentVariant> {
  const {
    variantId,
    updates,
    currentPosition,
    price,
    portfolioTotalValue,
    roundingConfig,
    activeWeightConfig,
    hasBenchmark,
    context,
  } = params

  // Get existing variant
  const existing = await getVariant(variantId)
  if (!existing) {
    throw new Error(`Variant not found: ${variantId}`)
  }

  // Merge updates
  const action = updates.action ?? existing.action
  const sizingInput = updates.sizing_input ?? existing.sizing_input

  // Re-normalize with new values
  const normCtx: NormalizationContext = {
    action,
    sizing_input: sizingInput,
    current_position: currentPosition ?? existing.current_position,
    portfolio_total_value: portfolioTotalValue,
    price,
    rounding_config: roundingConfig,
    active_weight_config: activeWeightConfig ?? existing.active_weight_config,
    has_benchmark: hasBenchmark,
  }

  const normResult = normalizeSizing(normCtx)

  // Parse sizing spec
  const parseResult = parseSizingInput(sizingInput, { has_benchmark: hasBenchmark })
  const sizingSpec = parseResult.is_valid
    ? toSizingSpec(sizingInput, parseResult)
    : null

  // Update variant
  const { data, error } = await supabase
    .from('lab_variants')
    .update({
      action,
      sizing_input: sizingInput,
      sizing_spec: sizingSpec,
      computed: normResult.computed ?? null,
      direction_conflict: normResult.direction_conflict,
      below_lot_warning: normResult.below_lot_warning,
      current_position: currentPosition ?? existing.current_position,
      active_weight_config: activeWeightConfig ?? existing.active_weight_config,
      notes: updates.notes !== undefined ? updates.notes : existing.notes,
      sort_order: updates.sort_order !== undefined ? updates.sort_order : existing.sort_order,
      touched_in_lab_at: new Date().toISOString(),
    })
    .eq('id', variantId)
    .select('*, asset:assets(id, symbol, company_name, sector)')
    .single()

  if (error) {
    const isRLS = error.message?.includes('row-level security')
    throw new Error(
      isRLS
        ? `Permission denied: you don't have access to this portfolio's trade lab. Try refreshing or re-logging in.`
        : `Failed to update variant: ${error.message}`
    )
  }

  // v3 spec: Emit lab.variant.computed event
  await emitAuditEvent({
    actor: { id: context.actorId, type: 'user', role: context.actorRole },
    entity: { type: 'lab_variant', id: variantId },
    action: {
      type: 'lab.variant.computed',
      category: 'state_change',
    },
    state: {
      from: {
        computed: existing.computed,
        direction_conflict: existing.direction_conflict,
      },
      to: {
        computed: normResult.computed,
        direction_conflict: normResult.direction_conflict,
      },
    },
    metadata: {
      request_id: context.requestId,
      ui_source: context.uiSource,
      lab_id: existing.lab_id,
      has_conflict: normResult.direction_conflict !== null,
      has_computed: normResult.computed !== null,
      below_lot_warning: normResult.below_lot_warning,
      trigger: 'user_edit',
    },
    orgId: undefined,
    actorName: context.actorName,
    actorEmail: context.actorEmail,
  })

  // v3 spec: Emit conflict-specific events
  const hadConflictBefore = existing.direction_conflict !== null
  const hasConflictNow = normResult.direction_conflict !== null

  if (!hadConflictBefore && hasConflictNow) {
    // lab.sizing.direction_conflict_detected
    await emitAuditEvent({
      actor: { id: context.actorId, type: 'user', role: context.actorRole },
      entity: { type: 'lab_variant', id: variantId },
      action: {
        type: 'lab.sizing.direction_conflict_detected',
        category: 'state_change',
      },
      state: {
        from: null,
        to: normResult.direction_conflict,
      },
      metadata: {
        request_id: context.requestId,
        ui_source: context.uiSource,
        lab_id: existing.lab_id,
        trigger: normResult.direction_conflict?.trigger || 'user_edit',
      },
      orgId: undefined,
      actorName: context.actorName,
      actorEmail: context.actorEmail,
    })
  } else if (hadConflictBefore && !hasConflictNow) {
    // lab.sizing.direction_conflict_resolved
    await emitAuditEvent({
      actor: { id: context.actorId, type: 'user', role: context.actorRole },
      entity: { type: 'lab_variant', id: variantId },
      action: {
        type: 'lab.sizing.direction_conflict_resolved',
        category: 'state_change',
      },
      state: {
        from: existing.direction_conflict,
        to: null,
      },
      metadata: {
        request_id: context.requestId,
        ui_source: context.uiSource,
        lab_id: existing.lab_id,
      },
      orgId: undefined,
      actorName: context.actorName,
      actorEmail: context.actorEmail,
    })
  }

  return data as IntentVariant
}

// =============================================================================
// DELETE VARIANT
// =============================================================================

export async function deleteVariant(
  variantId: string,
  context: ActionContext
): Promise<void> {
  const existing = await getVariant(variantId)
  if (!existing) {
    throw new Error(`Variant not found: ${variantId}`)
  }

  const { error } = await supabase
    .from('lab_variants')
    .update({
      visibility_tier: 'trash',
      deleted_at: new Date().toISOString(),
    })
    .eq('id', variantId)

  if (error) {
    const isRLS = error.message?.includes('row-level security')
    throw new Error(
      isRLS
        ? `Permission denied: you don't have access to this portfolio's trade lab. Try refreshing or re-logging in.`
        : `Failed to delete variant: ${error.message}`
    )
  }

  await emitAuditEvent({
    actor: { id: context.actorId, type: 'user', role: context.actorRole },
    entity: { type: 'lab_variant', id: variantId },
    action: { type: 'delete', category: 'lifecycle' },
    state: {
      from: { action: existing.action, asset_id: existing.asset_id },
      to: null,
    },
    metadata: {
      request_id: context.requestId,
      ui_source: context.uiSource,
      lab_id: existing.lab_id,
    },
    orgId: undefined,
    actorName: context.actorName,
    actorEmail: context.actorEmail,
  })
}

// =============================================================================
// BATCH REVALIDATION
// =============================================================================

export async function revalidateVariants(
  params: RevalidateVariantsParams
): Promise<{
  updated: number
  conflicts: number
  warnings: number
}> {
  const {
    labId,
    viewId,
    prices,
    positions,
    portfolioTotalValue,
    roundingConfig,
    hasBenchmark,
    context,
  } = params

  // Fetch all active variants
  const variants = await getVariantsForLab({ labId, viewId })

  if (variants.length === 0) {
    return { updated: 0, conflicts: 0, warnings: 0 }
  }

  // Prepare batch inputs
  const inputs: BatchNormalizationInput[] = variants.map((v) => ({
    id: v.id,
    action: v.action as TradeAction,
    sizing_input: v.sizing_input,
    asset_id: v.asset_id,
    current_position: positions.get(v.asset_id) ?? v.current_position,
    active_weight_config: v.active_weight_config,
  }))

  // Batch normalize
  const results = normalizeSizingBatch(
    inputs,
    prices,
    portfolioTotalValue,
    roundingConfig,
    hasBenchmark
  )

  // Prepare batch updates
  const updates: VariantBatchUpdate[] = []
  for (const [id, result] of results) {
    updates.push({
      id,
      computed: result.result.computed ?? null,
      direction_conflict: result.result.direction_conflict,
      below_lot_warning: result.result.below_lot_warning,
      sizing_spec: result.sizing_spec,
    })
  }

  // Batch update in database (use transaction-like approach)
  const updatePromises = updates.map((u) =>
    supabase
      .from('lab_variants')
      .update({
        computed: u.computed,
        direction_conflict: u.direction_conflict,
        below_lot_warning: u.below_lot_warning,
        sizing_spec: u.sizing_spec,
      })
      .eq('id', u.id)
  )

  await Promise.all(updatePromises)

  // Get summary
  const summary = getNormalizationSummary(results)

  // v3 spec: Emit lab.revalidation.completed event
  await emitAuditEvent({
    actor: { id: context.actorId, type: 'user', role: context.actorRole },
    entity: { type: 'trade_lab', id: labId },
    action: {
      type: 'lab.revalidation.completed',
      category: 'state_change',
    },
    state: {
      from: null,
      to: {
        total_variants: summary.total,
        valid: summary.valid,
        invalid: summary.invalid,
        conflicts: summary.conflicts,
        below_lot_warnings: summary.below_lot_warnings,
        total_notional: summary.total_notional,
      },
    },
    metadata: {
      request_id: context.requestId,
      ui_source: context.uiSource,
      lab_id: labId,
      view_id: viewId,
      trigger: 'load_revalidation',
    },
    orgId: undefined,
    actorName: context.actorName,
    actorEmail: context.actorEmail,
  })

  return {
    updated: summary.valid,
    conflicts: summary.conflicts,
    warnings: summary.below_lot_warnings,
  }
}

// =============================================================================
// CONFLICT CHECK
// =============================================================================

export async function labHasConflicts(labId: string, viewId?: string): Promise<boolean> {
  // v3: direction_conflict is JSONB (null = no conflict, object = conflict)
  // Use .not('direction_conflict', 'is', null) to check for conflicts
  let query = supabase
    .from('lab_variants')
    .select('id', { count: 'exact', head: true })
    .eq('lab_id', labId)
    .eq('visibility_tier', 'active')
    .not('direction_conflict', 'is', null)

  if (viewId) {
    query = query.eq('view_id', viewId)
  }

  const { count, error } = await query

  if (error) {
    throw new Error(`Failed to check conflicts: ${error.message}`)
  }

  return (count ?? 0) > 0
}

export async function getConflictSummary(labId: string, viewId?: string): Promise<{
  total: number
  conflicts: number
  warnings: number
  canCreateTradeSheet: boolean
}> {
  let query = supabase
    .from('lab_variants')
    .select('direction_conflict, below_lot_warning')
    .eq('lab_id', labId)
    .eq('visibility_tier', 'active')

  if (viewId) {
    query = query.eq('view_id', viewId)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`Failed to get conflict summary: ${error.message}`)
  }

  const variants = data ?? []
  // v3: direction_conflict is JSONB (null = no conflict, object = conflict)
  const conflicts = variants.filter((v) => v.direction_conflict !== null).length
  const warnings = variants.filter((v) => v.below_lot_warning).length

  return {
    total: variants.length,
    conflicts,
    warnings,
    canCreateTradeSheet: conflicts === 0 && variants.length > 0,
  }
}

// =============================================================================
// TRADE SHEET CREATION
// =============================================================================

export async function createTradeSheet(
  params: CreateTradeSheetParams
): Promise<TradeSheet> {
  const { labId, viewId, name, description, context } = params

  // Check for conflicts first
  const hasConflicts = await labHasConflicts(labId, viewId ?? undefined)
  if (hasConflicts) {
    // v3 spec: Emit lab.trade_sheet.blocked_by_conflicts event
    const conflictSummary = await getConflictSummary(labId, viewId ?? undefined)
    await emitAuditEvent({
      actor: { id: context.actorId, type: 'user', role: context.actorRole },
      entity: { type: 'trade_lab', id: labId },
      action: {
        type: 'lab.trade_sheet.blocked_by_conflicts',
        category: 'state_change',
      },
      state: {
        from: null,
        to: {
          conflict_count: conflictSummary.conflicts,
          total_variants: conflictSummary.total,
        },
      },
      metadata: {
        request_id: context.requestId,
        ui_source: context.uiSource,
        lab_id: labId,
        view_id: viewId,
        attempted_sheet_name: name,
      },
      orgId: undefined,
      actorName: context.actorName,
      actorEmail: context.actorEmail,
    })
    throw new Error('Cannot create Trade Sheet with unresolved direction conflicts')
  }

  // Use the database function for atomic creation
  const { data, error } = await supabase.rpc('create_trade_sheet', {
    p_lab_id: labId,
    p_name: name,
    p_user_id: context.actorId,
    p_description: description ?? null,
    p_view_id: viewId ?? null,
  })

  if (error) {
    throw new Error(`Failed to create Trade Sheet: ${error.message}`)
  }

  // Fetch the created trade sheet
  const { data: sheet, error: fetchError } = await supabase
    .from('trade_sheets')
    .select('*')
    .eq('id', data)
    .single()

  if (fetchError) {
    throw new Error(`Failed to fetch Trade Sheet: ${fetchError.message}`)
  }

  return sheet as TradeSheet
}

export async function getTradeSheet(sheetId: string): Promise<TradeSheet | null> {
  const { data, error } = await supabase
    .from('trade_sheets')
    .select('*')
    .eq('id', sheetId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw new Error(`Failed to fetch Trade Sheet: ${error.message}`)
  }

  return data as TradeSheet
}

export async function getTradeSheetsForLab(labId: string): Promise<TradeSheet[]> {
  const { data, error } = await supabase
    .from('trade_sheets')
    .select('*')
    .eq('lab_id', labId)
    .eq('visibility_tier', 'active')
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to fetch Trade Sheets: ${error.message}`)
  }

  return data as TradeSheet[]
}

// =============================================================================
// ROUNDING CONFIG
// =============================================================================

export async function getRoundingConfig(
  portfolioId: string,
  assetId?: string
): Promise<RoundingConfig> {
  // If asset-specific, try to get override first
  if (assetId) {
    const { data: override } = await supabase
      .from('asset_rounding_configs')
      .select('lot_size, min_lot_behavior, round_direction')
      .eq('portfolio_id', portfolioId)
      .eq('asset_id', assetId)
      .single()

    if (override) {
      return {
        lot_size: override.lot_size,
        min_lot_behavior: override.min_lot_behavior as 'round' | 'zero' | 'warn',
        round_direction: override.round_direction as 'nearest' | 'up' | 'down',
      }
    }
  }

  // Fall back to portfolio default
  const { data: portfolio } = await supabase
    .from('portfolios')
    .select('rounding_config')
    .eq('id', portfolioId)
    .single()

  if (portfolio?.rounding_config) {
    const config = portfolio.rounding_config as Record<string, unknown>
    return {
      lot_size: (config.lot_size as number) ?? 1,
      min_lot_behavior: (config.min_lot_behavior as 'round' | 'zero' | 'warn') ?? 'round',
      round_direction: (config.round_direction as 'nearest' | 'up' | 'down') ?? 'nearest',
    }
  }

  // Ultimate fallback
  return {
    lot_size: 1,
    min_lot_behavior: 'round',
    round_direction: 'nearest',
  }
}

export async function setAssetRoundingConfig(
  portfolioId: string,
  assetId: string,
  config: RoundingConfig,
  context: ActionContext
): Promise<void> {
  const { error } = await supabase
    .from('asset_rounding_configs')
    .upsert({
      portfolio_id: portfolioId,
      asset_id: assetId,
      lot_size: config.lot_size,
      min_lot_behavior: config.min_lot_behavior,
      round_direction: config.round_direction ?? 'nearest',
      created_by: context.actorId,
    }, {
      onConflict: 'portfolio_id,asset_id',
    })

  if (error) {
    throw new Error(`Failed to set rounding config: ${error.message}`)
  }
}
