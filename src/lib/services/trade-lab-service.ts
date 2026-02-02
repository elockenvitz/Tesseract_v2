/**
 * Trade Lab Service
 *
 * Manages Trade Labs (ONE per portfolio), Views, and Drafts.
 *
 * Architecture:
 * - Trade Labs: One per portfolio (hard rule, enforced by unique constraint)
 * - Views: My Drafts (private), Shared (invited members), Portfolio Working Set (all members)
 * - Drafts: Trade ideas being composed, with autosave support
 */

import { supabase } from '../supabase'
import { emitAuditEvent } from '../audit'
import type { ActionContext, TradeAction } from '../../types/trading'

// ============================================================
// Types
// ============================================================

export type TradeLabViewType = 'private' | 'shared' | 'portfolio'
export type TradeLabViewRole = 'owner' | 'editor' | 'viewer'
export type VisibilityTier = 'active' | 'trash' | 'archive'

export interface TradeLab {
  id: string
  portfolio_id: string
  name: string
  description: string | null
  settings: Record<string, unknown>
  legacy_simulation_id: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

export interface TradeLabWithDetails extends TradeLab {
  portfolio?: {
    id: string
    name: string
  }
  view_count?: number
  draft_count?: number
}

export interface TradeLabView {
  id: string
  lab_id: string
  simulation_id: string | null // Legacy, kept for backwards compat
  view_type: TradeLabViewType
  name: string
  description: string | null
  owner_id: string | null
  created_by: string
  visibility_tier: VisibilityTier
  baseline_holdings: unknown[] | null
  baseline_total_value: number | null
  created_at: string
  updated_at: string
}

export interface TradeLabViewWithDetails extends TradeLabView {
  lab?: {
    id: string
    name: string
    portfolio_id: string
  }
  owner?: {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
  }
  members?: TradeLabViewMember[]
  draft_count?: number
}

export interface TradeLabViewMember {
  id: string
  view_id: string
  user_id: string
  role: TradeLabViewRole
  invited_by: string | null
  created_at: string
  user?: {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
  }
}

export interface TradeLabDraft {
  id: string
  lab_id: string | null
  simulation_id: string
  view_id: string | null
  trade_queue_item_id: string | null
  asset_id: string
  action: TradeAction
  shares: number | null
  weight: number | null
  price: number | null
  notes: string | null
  tags: string[] | null
  sort_order: number
  last_autosave_at: string | null
  autosave_version: number
  visibility_tier: VisibilityTier
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export interface TradeLabDraftWithDetails extends TradeLabDraft {
  asset?: {
    id: string
    symbol: string
    company_name: string
    sector: string | null
  }
  trade_queue_item?: {
    id: string
    rationale: string
    urgency: string
    stage: string
    outcome: string | null
  } | null
}

export interface CreateViewParams {
  labId: string
  viewType: TradeLabViewType
  name: string
  description?: string
  members?: Array<{ userId: string; role: TradeLabViewRole }>
  context: ActionContext
}

export interface UpsertDraftParams {
  id?: string
  labId: string
  viewId?: string | null
  tradeQueueItemId?: string | null
  assetId: string
  action: TradeAction
  shares?: number | null
  weight?: number | null
  price?: number | null
  notes?: string | null
  tags?: string[] | null
  sortOrder?: number
  context: ActionContext
}

export interface MoveDraftParams {
  draftId: string
  targetViewId: string
  context: ActionContext
}

// ============================================================
// Trade Lab Functions
// ============================================================

/**
 * Get or create a Trade Lab for a portfolio.
 * Enforces the ONE lab per portfolio rule via unique constraint.
 */
export async function getOrCreateTradeLab(portfolioId: string): Promise<TradeLab> {
  // First try to get existing
  const { data: existing, error: fetchError } = await supabase
    .from('trade_labs')
    .select('*')
    .eq('portfolio_id', portfolioId)
    .single()

  if (existing) {
    return existing as TradeLab
  }

  // Create new via RPC function (handles concurrency)
  const { data: labId, error: createError } = await supabase.rpc(
    'get_or_create_trade_lab',
    { p_portfolio_id: portfolioId }
  )

  if (createError) {
    throw new Error(`Failed to create trade lab: ${createError.message}`)
  }

  // Fetch the created lab
  const { data: lab, error: refetchError } = await supabase
    .from('trade_labs')
    .select('*')
    .eq('id', labId)
    .single()

  if (refetchError || !lab) {
    throw new Error(`Failed to fetch created trade lab: ${refetchError?.message}`)
  }

  return lab as TradeLab
}

/**
 * Get trade lab by ID
 */
export async function getTradeLab(labId: string): Promise<TradeLab | null> {
  const { data, error } = await supabase
    .from('trade_labs')
    .select('*')
    .eq('id', labId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw new Error(`Failed to get trade lab: ${error.message}`)
  }

  return data as TradeLab
}

/**
 * Get trade lab for a portfolio
 */
export async function getTradeLabForPortfolio(portfolioId: string): Promise<TradeLab | null> {
  const { data, error } = await supabase
    .from('trade_labs')
    .select('*')
    .eq('portfolio_id', portfolioId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw new Error(`Failed to get trade lab: ${error.message}`)
  }

  return data as TradeLab
}

/**
 * Get all trade labs the user has access to (via portfolio membership)
 */
export async function getTradeLabsForUser(): Promise<TradeLabWithDetails[]> {
  const { data, error } = await supabase
    .from('trade_labs')
    .select(`
      *,
      portfolio:portfolios (id, name)
    `)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to get trade labs: ${error.message}`)
  }

  return data as TradeLabWithDetails[]
}

// ============================================================
// View Functions
// ============================================================

/**
 * Get or create Private (Workspace) view for a user in a lab
 */
export async function getOrCreatePrivateView(
  labId: string,
  userId: string
): Promise<TradeLabView> {
  // Use RPC function for atomic get-or-create
  const { data: viewId, error } = await supabase.rpc('get_or_create_private_view', {
    p_lab_id: labId,
    p_user_id: userId,
  })

  if (error) {
    throw new Error(`Failed to get/create Private view: ${error.message}`)
  }

  // Fetch the full view record
  const { data: view, error: fetchError } = await supabase
    .from('trade_lab_views')
    .select('*')
    .eq('id', viewId)
    .single()

  if (fetchError) {
    throw new Error(`Failed to fetch view: ${fetchError.message}`)
  }

  return view as TradeLabView
}

/**
 * @deprecated Use getOrCreatePrivateView instead
 */
export const getOrCreateMyDraftsView = getOrCreatePrivateView

/**
 * Get or create Portfolio view for a lab
 */
export async function getOrCreatePortfolioView(labId: string): Promise<TradeLabView> {
  const { data: viewId, error } = await supabase.rpc('get_or_create_portfolio_view', {
    p_lab_id: labId,
  })

  if (error) {
    throw new Error(`Failed to get/create Portfolio view: ${error.message}`)
  }

  const { data: view, error: fetchError } = await supabase
    .from('trade_lab_views')
    .select('*')
    .eq('id', viewId)
    .single()

  if (fetchError) {
    throw new Error(`Failed to fetch view: ${fetchError.message}`)
  }

  return view as TradeLabView
}

/**
 * @deprecated Use getOrCreatePortfolioView instead
 */
export const getOrCreatePortfolioWorkingSet = getOrCreatePortfolioView

/**
 * Get all views for a lab that the user can access
 */
export async function getViewsForLab(labId: string): Promise<TradeLabViewWithDetails[]> {
  const { data, error } = await supabase
    .from('trade_lab_views')
    .select(`
      *,
      owner:users!trade_lab_views_owner_id_fkey (id, email, first_name, last_name),
      members:trade_lab_view_members (
        id, view_id, user_id, role,
        user:users (id, email, first_name, last_name)
      )
    `)
    .eq('lab_id', labId)
    .eq('visibility_tier', 'active')
    .order('view_type')
    .order('name')

  if (error) {
    throw new Error(`Failed to fetch views: ${error.message}`)
  }

  // Add draft counts
  const viewIds = data.map((v: any) => v.id)
  if (viewIds.length > 0) {
    const { data: counts } = await supabase
      .from('simulation_trades')
      .select('view_id')
      .in('view_id', viewIds)
      .eq('visibility_tier', 'active')

    const countMap = new Map<string, number>()
    counts?.forEach((d: any) => {
      if (d.view_id) {
        countMap.set(d.view_id, (countMap.get(d.view_id) || 0) + 1)
      }
    })

    return data.map((v: any) => ({
      ...v,
      draft_count: countMap.get(v.id) || 0,
    })) as TradeLabViewWithDetails[]
  }

  return data as TradeLabViewWithDetails[]
}

/**
 * Create a new shared view
 */
export async function createSharedView(params: CreateViewParams): Promise<TradeLabView> {
  const { labId, viewType, name, description, members, context } = params

  if (viewType !== 'shared') {
    throw new Error('Use getOrCreatePrivateView for private views or getOrCreatePortfolioView for portfolio views')
  }

  // Create the view
  const { data: view, error: viewError } = await supabase
    .from('trade_lab_views')
    .insert({
      lab_id: labId,
      view_type: viewType,
      name,
      description,
      owner_id: context.actorId,
      created_by: context.actorId,
      visibility_tier: 'active',
    })
    .select()
    .single()

  if (viewError) {
    throw new Error(`Failed to create view: ${viewError.message}`)
  }

  // Add creator as owner + invited members
  const memberInserts = [
    {
      view_id: view.id,
      user_id: context.actorId,
      role: 'owner' as TradeLabViewRole,
      invited_by: context.actorId,
    },
    ...(members || []).map((m) => ({
      view_id: view.id,
      user_id: m.userId,
      role: m.role,
      invited_by: context.actorId,
    })),
  ]

  const { error: membersError } = await supabase
    .from('trade_lab_view_members')
    .insert(memberInserts)

  if (membersError) {
    // Rollback: delete the view
    await supabase.from('trade_lab_views').delete().eq('id', view.id)
    throw new Error(`Failed to add members: ${membersError.message}`)
  }

  // Emit audit event
  await emitAuditEvent({
    actor: { id: context.actorId, type: 'user', role: context.actorRole },
    entity: {
      type: 'trade_lab_view',
      id: view.id,
      displayName: name,
    },
    action: { type: 'create', category: 'lifecycle' },
    state: {
      from: null,
      to: { view_type: viewType, name, member_count: memberInserts.length },
    },
    changedFields: ['view_type', 'name', 'lab_id'],
    metadata: {
      request_id: context.requestId,
      ui_source: context.uiSource,
      lab_id: labId,
    },
    orgId: undefined,
    actorName: context.actorName,
    actorEmail: context.actorEmail,
  })

  return view as TradeLabView
}

/**
 * Update a view
 */
export async function updateView(
  viewId: string,
  updates: Partial<Pick<TradeLabView, 'name' | 'description'>>,
  context: ActionContext
): Promise<TradeLabView> {
  const { data, error } = await supabase
    .from('trade_lab_views')
    .update(updates)
    .eq('id', viewId)
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to update view: ${error.message}`)
  }

  return data as TradeLabView
}

/**
 * Delete a view (soft delete)
 */
export async function deleteView(viewId: string, context: ActionContext): Promise<void> {
  const { error } = await supabase
    .from('trade_lab_views')
    .update({
      visibility_tier: 'trash',
      deleted_at: new Date().toISOString(),
      deleted_by: context.actorId,
    })
    .eq('id', viewId)

  if (error) {
    throw new Error(`Failed to delete view: ${error.message}`)
  }
}

/**
 * Add a member to a shared view
 */
export async function addViewMember(
  viewId: string,
  userId: string,
  role: TradeLabViewRole,
  context: ActionContext
): Promise<void> {
  const { error } = await supabase.from('trade_lab_view_members').insert({
    view_id: viewId,
    user_id: userId,
    role,
    invited_by: context.actorId,
  })

  if (error) {
    throw new Error(`Failed to add member: ${error.message}`)
  }

  // Get user info for audit
  const { data: user } = await supabase
    .from('users')
    .select('email, first_name, last_name')
    .eq('id', userId)
    .single()

  await emitAuditEvent({
    actor: { id: context.actorId, type: 'user', role: context.actorRole },
    entity: { type: 'trade_lab_view', id: viewId },
    action: { type: 'add_member', category: 'relationship' },
    state: { from: null, to: { user_id: userId, role } },
    metadata: {
      request_id: context.requestId,
      ui_source: context.uiSource,
      added_user_email: user?.email,
      added_user_name: `${user?.first_name || ''} ${user?.last_name || ''}`.trim(),
    },
    orgId: undefined,
    actorName: context.actorName,
    actorEmail: context.actorEmail,
  })
}

/**
 * Remove a member from a shared view
 */
export async function removeViewMember(
  viewId: string,
  userId: string,
  context: ActionContext
): Promise<void> {
  const { data: membership } = await supabase
    .from('trade_lab_view_members')
    .select('role')
    .eq('view_id', viewId)
    .eq('user_id', userId)
    .single()

  const { error } = await supabase
    .from('trade_lab_view_members')
    .delete()
    .eq('view_id', viewId)
    .eq('user_id', userId)

  if (error) {
    throw new Error(`Failed to remove member: ${error.message}`)
  }

  await emitAuditEvent({
    actor: { id: context.actorId, type: 'user', role: context.actorRole },
    entity: { type: 'trade_lab_view', id: viewId },
    action: { type: 'remove_member', category: 'relationship' },
    state: { from: { user_id: userId, role: membership?.role }, to: null },
    metadata: {
      request_id: context.requestId,
      ui_source: context.uiSource,
      removed_user_id: userId,
    },
    orgId: undefined,
    actorName: context.actorName,
    actorEmail: context.actorEmail,
  })
}

// ============================================================
// Draft Functions
// ============================================================

/**
 * Get all drafts for a lab, optionally filtered by view
 */
export async function getDraftsForLab(
  labId: string,
  viewId?: string
): Promise<TradeLabDraftWithDetails[]> {
  let query = supabase
    .from('simulation_trades')
    .select(`
      *,
      asset:assets (id, symbol, company_name, sector),
      trade_queue_item:trade_queue_items (id, rationale, urgency, stage, outcome)
    `)
    .eq('lab_id', labId)
    .eq('visibility_tier', 'active')
    .order('sort_order')

  if (viewId) {
    query = query.eq('view_id', viewId)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`Failed to fetch drafts: ${error.message}`)
  }

  return data as TradeLabDraftWithDetails[]
}

/**
 * Get drafts for a specific view
 */
export async function getDraftsForView(viewId: string): Promise<TradeLabDraftWithDetails[]> {
  const { data, error } = await supabase
    .from('simulation_trades')
    .select(`
      *,
      asset:assets (id, symbol, company_name, sector),
      trade_queue_item:trade_queue_items (id, rationale, urgency, stage, outcome)
    `)
    .eq('view_id', viewId)
    .eq('visibility_tier', 'active')
    .order('sort_order')

  if (error) {
    throw new Error(`Failed to fetch drafts: ${error.message}`)
  }

  return data as TradeLabDraftWithDetails[]
}

/**
 * Upsert a draft (create or update with autosave)
 */
export async function upsertDraft(params: UpsertDraftParams): Promise<TradeLabDraft> {
  const {
    id,
    labId,
    viewId,
    tradeQueueItemId,
    assetId,
    action,
    shares,
    weight,
    price,
    notes,
    tags,
    sortOrder,
    context,
  } = params

  const now = new Date().toISOString()

  // Need simulation_id for backwards compat - get from lab
  const { data: lab } = await supabase
    .from('trade_labs')
    .select('legacy_simulation_id')
    .eq('id', labId)
    .single()

  const simulationId = lab?.legacy_simulation_id || labId // Fallback to lab_id if no legacy

  const draftData = {
    lab_id: labId,
    simulation_id: simulationId,
    view_id: viewId,
    trade_queue_item_id: tradeQueueItemId,
    asset_id: assetId,
    action,
    shares,
    weight,
    price,
    notes,
    tags,
    sort_order: sortOrder ?? 0,
    last_autosave_at: now,
    updated_by: context.actorId,
  }

  if (id) {
    // Update existing draft
    const { data, error } = await supabase
      .from('simulation_trades')
      .update({
        ...draftData,
        autosave_version: supabase.sql`autosave_version + 1`,
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      throw new Error(`Failed to update draft: ${error.message}`)
    }

    return data as TradeLabDraft
  } else {
    // Insert new draft
    const { data, error } = await supabase
      .from('simulation_trades')
      .insert({
        ...draftData,
        created_by: context.actorId,
        autosave_version: 1,
        visibility_tier: 'active',
      })
      .select()
      .single()

    if (error) {
      throw new Error(`Failed to create draft: ${error.message}`)
    }

    // Get asset info for audit
    const { data: asset } = await supabase
      .from('assets')
      .select('symbol')
      .eq('id', assetId)
      .single()

    await emitAuditEvent({
      actor: { id: context.actorId, type: 'user', role: context.actorRole },
      entity: {
        type: 'trade_lab_draft',
        id: data.id,
        displayName: `${action.toUpperCase()} ${asset?.symbol || 'Unknown'}`,
      },
      action: { type: 'create', category: 'lifecycle' },
      state: {
        from: null,
        to: { action, asset_id: assetId, shares, weight },
      },
      metadata: {
        request_id: context.requestId,
        ui_source: context.uiSource,
        lab_id: labId,
        view_id: viewId,
      },
      orgId: undefined,
      actorName: context.actorName,
      actorEmail: context.actorEmail,
      assetSymbol: asset?.symbol,
    })

    return data as TradeLabDraft
  }
}

/**
 * Move a draft to a different view
 */
export async function moveDraftToView(params: MoveDraftParams): Promise<void> {
  const { draftId, targetViewId, context } = params

  // Get current draft
  const { data: draft, error: fetchError } = await supabase
    .from('simulation_trades')
    .select('view_id, asset_id')
    .eq('id', draftId)
    .single()

  if (fetchError) {
    throw new Error(`Draft not found: ${fetchError.message}`)
  }

  const fromViewId = draft.view_id

  // Update draft
  const { error } = await supabase
    .from('simulation_trades')
    .update({ view_id: targetViewId })
    .eq('id', draftId)

  if (error) {
    throw new Error(`Failed to move draft: ${error.message}`)
  }

  await emitAuditEvent({
    actor: { id: context.actorId, type: 'user', role: context.actorRole },
    entity: { type: 'trade_lab_draft', id: draftId },
    action: { type: 'move_view', category: 'state_change' },
    state: {
      from: { view_id: fromViewId },
      to: { view_id: targetViewId },
    },
    metadata: { request_id: context.requestId, ui_source: context.uiSource },
    orgId: undefined,
    actorName: context.actorName,
    actorEmail: context.actorEmail,
  })
}

/**
 * Delete a draft (soft delete)
 */
export async function deleteDraft(draftId: string, context: ActionContext): Promise<void> {
  // Get draft info for audit
  const { data: draft } = await supabase
    .from('simulation_trades')
    .select('asset_id, action, lab_id, view_id')
    .eq('id', draftId)
    .single()

  const { error } = await supabase
    .from('simulation_trades')
    .update({
      visibility_tier: 'trash',
      deleted_at: new Date().toISOString(),
    })
    .eq('id', draftId)

  if (error) {
    throw new Error(`Failed to delete draft: ${error.message}`)
  }

  if (draft) {
    const { data: asset } = await supabase
      .from('assets')
      .select('symbol')
      .eq('id', draft.asset_id)
      .single()

    await emitAuditEvent({
      actor: { id: context.actorId, type: 'user', role: context.actorRole },
      entity: {
        type: 'trade_lab_draft',
        id: draftId,
        displayName: `${draft.action.toUpperCase()} ${asset?.symbol || 'Unknown'}`,
      },
      action: { type: 'delete', category: 'lifecycle' },
      state: {
        from: { action: draft.action, asset_id: draft.asset_id },
        to: null,
      },
      metadata: {
        request_id: context.requestId,
        ui_source: context.uiSource,
        lab_id: draft.lab_id,
        view_id: draft.view_id,
      },
      orgId: undefined,
      actorName: context.actorName,
      actorEmail: context.actorEmail,
      assetSymbol: asset?.symbol,
    })
  }
}

/**
 * Reorder drafts within a view
 */
export async function reorderDrafts(
  labId: string,
  viewId: string | null,
  orderedDraftIds: string[],
  context: ActionContext
): Promise<void> {
  // Update sort_order for each draft
  const updates = orderedDraftIds.map((id, index) =>
    supabase
      .from('simulation_trades')
      .update({ sort_order: index })
      .eq('id', id)
      .eq('lab_id', labId)
  )

  await Promise.all(updates)

  // Single audit event for reorder
  await emitAuditEvent({
    actor: { id: context.actorId, type: 'user', role: context.actorRole },
    entity: { type: 'trade_lab_view', id: viewId || labId },
    action: { type: 'reorder_drafts', category: 'field_edit' },
    state: { from: null, to: { draft_order: orderedDraftIds } },
    metadata: {
      request_id: context.requestId,
      ui_source: context.uiSource,
      draft_count: orderedDraftIds.length,
    },
    orgId: undefined,
    actorName: context.actorName,
    actorEmail: context.actorEmail,
  })
}

/**
 * Copy drafts from one view to another
 */
export async function copyDraftsToView(
  sourceViewId: string,
  targetViewId: string,
  context: ActionContext
): Promise<TradeLabDraft[]> {
  // Get source drafts
  const sourceDrafts = await getDraftsForView(sourceViewId)

  if (sourceDrafts.length === 0) {
    return []
  }

  // Get target view's lab_id
  const { data: targetView, error: viewError } = await supabase
    .from('trade_lab_views')
    .select('lab_id')
    .eq('id', targetViewId)
    .single()

  if (viewError) {
    throw new Error(`Failed to get target view: ${viewError.message}`)
  }

  // Get lab's simulation_id for backwards compat
  const { data: lab } = await supabase
    .from('trade_labs')
    .select('legacy_simulation_id')
    .eq('id', targetView.lab_id)
    .single()

  const now = new Date().toISOString()

  // Insert copies
  const copies = sourceDrafts.map((d, index) => ({
    lab_id: targetView.lab_id,
    simulation_id: lab?.legacy_simulation_id || targetView.lab_id,
    view_id: targetViewId,
    asset_id: d.asset_id,
    trade_queue_item_id: d.trade_queue_item_id,
    action: d.action,
    shares: d.shares,
    weight: d.weight,
    price: d.price,
    notes: d.notes,
    tags: d.tags,
    sort_order: index,
    created_by: context.actorId,
    updated_by: context.actorId,
    last_autosave_at: now,
    autosave_version: 1,
    visibility_tier: 'active' as VisibilityTier,
  }))

  const { data, error } = await supabase
    .from('simulation_trades')
    .insert(copies)
    .select()

  if (error) {
    throw new Error(`Failed to copy drafts: ${error.message}`)
  }

  return data as TradeLabDraft[]
}

// ============================================================
// Trade Idea Links (for "expressed in" tracking)
// ============================================================

/**
 * Link a trade idea to a lab (for "expressed in" tracking)
 */
export async function linkIdeaToLab(
  labId: string,
  tradeQueueItemId: string,
  context: ActionContext
): Promise<void> {
  const { error } = await supabase
    .from('trade_lab_idea_links')
    .insert({
      trade_lab_id: labId,
      trade_queue_item_id: tradeQueueItemId,
      created_by: context.actorId,
    })

  if (error && error.code !== '23505') {
    throw new Error(`Failed to link idea: ${error.message}`)
  }
}

/**
 * Unlink a trade idea from a lab
 */
export async function unlinkIdeaFromLab(
  labId: string,
  tradeQueueItemId: string,
  context: ActionContext
): Promise<void> {
  const { error } = await supabase
    .from('trade_lab_idea_links')
    .delete()
    .eq('trade_lab_id', labId)
    .eq('trade_queue_item_id', tradeQueueItemId)

  if (error) {
    throw new Error(`Failed to unlink idea: ${error.message}`)
  }
}

/**
 * Update per-portfolio sizing for a trade idea link
 */
export async function updateIdeaLinkSizing(
  labId: string,
  tradeQueueItemId: string,
  sizing: { proposedWeight?: number | null; proposedShares?: number | null },
  context: ActionContext
): Promise<void> {
  const { error } = await supabase
    .from('trade_lab_idea_links')
    .update({
      proposed_weight: sizing.proposedWeight,
      proposed_shares: sizing.proposedShares,
    })
    .eq('trade_lab_id', labId)
    .eq('trade_queue_item_id', tradeQueueItemId)

  if (error) {
    throw new Error(`Failed to update sizing: ${error.message}`)
  }

  await emitAuditEvent({
    actor: { id: context.actorId, type: 'user', role: context.actorRole },
    entity: { type: 'trade_queue_item', id: tradeQueueItemId },
    action: { type: 'update_portfolio_sizing', category: 'update' },
    state: { to: { lab_id: labId, ...sizing } },
    metadata: {
      request_id: context.requestId,
      ui_source: context.uiSource,
      lab_id: labId,
    },
    orgId: undefined,
    actorName: context.actorName,
    actorEmail: context.actorEmail,
  })
}

/**
 * Get count of labs where an idea is expressed
 */
export async function getIdeaExpressionCount(
  tradeQueueItemId: string
): Promise<{ count: number; labNames: string[] }> {
  const { data, error } = await supabase
    .from('trade_lab_idea_links')
    .select('trade_lab_id, trade_labs (name)')
    .eq('trade_queue_item_id', tradeQueueItemId)

  if (error) {
    throw new Error(`Failed to get expression count: ${error.message}`)
  }

  return {
    count: data?.length || 0,
    labNames: data?.map((d: any) => d.trade_labs?.name).filter(Boolean) || [],
  }
}

export interface IdeaLabLink {
  id: string
  trade_lab_id: string
  trade_queue_item_id: string
  proposed_weight: number | null
  proposed_shares: number | null
  created_by: string | null
  created_at: string
  trade_lab?: {
    id: string
    name: string
    portfolio_id: string
    portfolio?: {
      id: string
      name: string
    }
  }
}

/**
 * Get all lab links for a trade idea with sizing data
 */
export async function getIdeaLabLinks(
  tradeQueueItemId: string
): Promise<IdeaLabLink[]> {
  const { data, error } = await supabase
    .from('trade_lab_idea_links')
    .select(`
      id,
      trade_lab_id,
      trade_queue_item_id,
      proposed_weight,
      proposed_shares,
      created_by,
      created_at,
      trade_labs:trade_lab_id (
        id,
        name,
        portfolio_id,
        portfolios:portfolio_id (
          id,
          name
        )
      )
    `)
    .eq('trade_queue_item_id', tradeQueueItemId)
    .order('created_at')

  if (error) {
    throw new Error(`Failed to get idea lab links: ${error.message}`)
  }

  // Transform nested data structure
  return (data || []).map((link: any) => ({
    ...link,
    trade_lab: link.trade_labs ? {
      id: link.trade_labs.id,
      name: link.trade_labs.name,
      portfolio_id: link.trade_labs.portfolio_id,
      portfolio: link.trade_labs.portfolios,
    } : undefined,
    trade_labs: undefined,
  }))
}

// ============================================================
// Workbench Functions
// ============================================================

/**
 * Clear all drafts for a view (soft delete).
 * Used after committing trades to create a fresh workbench.
 */
export async function clearDraftsForView(
  viewId: string,
  context: ActionContext
): Promise<{ clearedCount: number }> {
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('simulation_trades')
    .update({
      visibility_tier: 'trash',
      deleted_at: now,
    })
    .eq('view_id', viewId)
    .eq('visibility_tier', 'active')
    .select('id')

  if (error) throw new Error(`Failed to clear drafts: ${error.message}`)

  await emitAuditEvent({
    actor: { id: context.actorId, type: 'user', role: context.actorRole },
    entity: { type: 'trade_lab_view', id: viewId },
    action: { type: 'clear_workbench', category: 'lifecycle' },
    state: { from: { draft_count: data?.length || 0 }, to: { draft_count: 0 } },
    metadata: {
      request_id: context.requestId,
      ui_source: context.uiSource,
      cleared_count: data?.length || 0,
    },
    orgId: undefined,
    actorName: context.actorName,
    actorEmail: context.actorEmail,
  })

  return { clearedCount: data?.length || 0 }
}

// ============================================================
// Legacy Compatibility
// ============================================================

/**
 * Get views for a simulation (legacy - uses simulation_id)
 * @deprecated Use getViewsForLab instead
 */
export async function getViewsForSimulation(
  simulationId: string
): Promise<TradeLabViewWithDetails[]> {
  const { data, error } = await supabase
    .from('trade_lab_views')
    .select(`
      *,
      owner:users!trade_lab_views_owner_id_fkey (id, email, first_name, last_name),
      members:trade_lab_view_members (
        id, view_id, user_id, role,
        user:users (id, email, first_name, last_name)
      )
    `)
    .eq('simulation_id', simulationId)
    .eq('visibility_tier', 'active')
    .order('view_type')
    .order('name')

  if (error) {
    throw new Error(`Failed to fetch views: ${error.message}`)
  }

  return data as TradeLabViewWithDetails[]
}

/**
 * Get drafts for a simulation (legacy - uses simulation_id)
 * @deprecated Use getDraftsForLab instead
 */
export async function getDraftsForSimulation(
  simulationId: string,
  viewId?: string
): Promise<TradeLabDraftWithDetails[]> {
  let query = supabase
    .from('simulation_trades')
    .select(`
      *,
      asset:assets (id, symbol, company_name, sector),
      trade_queue_item:trade_queue_items (id, rationale, urgency, stage, outcome)
    `)
    .eq('simulation_id', simulationId)
    .eq('visibility_tier', 'active')
    .order('sort_order')

  if (viewId) {
    query = query.eq('view_id', viewId)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`Failed to fetch drafts: ${error.message}`)
  }

  return data as TradeLabDraftWithDetails[]
}
