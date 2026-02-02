/**
 * Trade Plan Service
 *
 * Manages Trade Plans - immutable snapshots with approval workflow.
 *
 * Approval Routing:
 * - Analysts must submit for PM approval
 * - PMs can send directly to desk
 *
 * Status Flow:
 * draft → pending_approval → approved → sent_to_desk → acknowledged
 *        └─────────────────→ rejected
 *
 * PMs with can_send_to_desk:
 * draft → sent_to_desk → acknowledged
 */

import { supabase } from '../supabase'
import { emitAuditEvent } from '../audit'
import type { ActionContext } from '../../types/trading'

// ============================================================
// Types
// ============================================================

export type TradePlanStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'sent_to_desk'
  | 'acknowledged'

export interface TradePlan {
  id: string
  source_view_id: string | null
  portfolio_id: string
  name: string
  description: string | null
  status: TradePlanStatus
  created_by: string
  submitted_at: string | null
  submitted_by: string | null
  submission_note: string | null
  approved_at: string | null
  approved_by: string | null
  approval_note: string | null
  rejected_at: string | null
  rejected_by: string | null
  rejection_note: string | null
  sent_to_desk_at: string | null
  sent_to_desk_by: string | null
  desk_reference: string | null
  acknowledged_at: string | null
  acknowledged_by: string | null
  acknowledgment_note: string | null
  snapshot_holdings: unknown[]
  snapshot_total_value: number
  snapshot_metrics: Record<string, unknown> | null
  visibility_tier: 'active' | 'trash' | 'archive'
  version: number
  created_at: string
  updated_at: string
}

export interface TradePlanWithDetails extends TradePlan {
  portfolios?: {
    id: string
    name: string
  }
  users?: {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
  }
  trade_plan_items?: TradePlanItem[]
  trade_plan_approvers?: TradePlanApprover[]
}

export interface TradePlanItem {
  id: string
  plan_id: string
  source_trade_id: string | null
  source_trade_idea_id: string | null
  asset_id: string
  action: string
  shares: number
  weight: number | null
  price: number
  estimated_value: number
  asset_symbol: string
  asset_name: string | null
  asset_sector: string | null
  beginning_shares: number
  beginning_weight: number
  ending_shares: number
  rationale: string | null
  sort_order: number
  created_at: string
}

export interface TradePlanApprover {
  id: string
  plan_id: string
  approver_id: string
  decision: 'pending' | 'approved' | 'rejected' | null
  decision_at: string | null
  decision_note: string | null
  approval_order: number
  is_required: boolean
  created_at: string
  updated_at: string
  users?: {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
  }
}

export interface CreatePlanParams {
  viewId: string
  name: string
  description?: string
  context: ActionContext
}

export interface SubmitForApprovalParams {
  planId: string
  note?: string
  context: ActionContext
}

export interface ApproveRejectParams {
  planId: string
  action: 'approve' | 'reject'
  note?: string
  context: ActionContext
}

export interface SendToDeskParams {
  planId: string
  context: ActionContext
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Get user's trade role (analyst or pm) for a portfolio
 */
async function getUserTradeRole(
  userId: string,
  portfolioId: string
): Promise<'analyst' | 'pm'> {
  const { data, error } = await supabase.rpc('get_user_trade_role', {
    p_user_id: userId,
    p_portfolio_id: portfolioId,
  })

  if (error) {
    console.warn('Failed to get user trade role, defaulting to analyst:', error)
    return 'analyst'
  }

  return data === 'pm' ? 'pm' : 'analyst'
}

/**
 * Check if user can send directly to desk
 */
async function userCanSendToDesk(
  userId: string,
  portfolioId: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc('user_can_send_to_desk', {
    p_user_id: userId,
    p_portfolio_id: portfolioId,
  })

  if (error) {
    console.warn('Failed to check send_to_desk capability:', error)
    return false
  }

  return !!data
}

/**
 * Check if user can approve plans
 */
async function userCanApprovePlans(
  userId: string,
  portfolioId: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc('user_can_approve_plans', {
    p_user_id: userId,
    p_portfolio_id: portfolioId,
  })

  if (error) {
    console.warn('Failed to check approve_plans capability:', error)
    return false
  }

  return !!data
}

/**
 * Get potential approvers for a portfolio
 */
async function getPortfolioApprovers(portfolioId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('user_capabilities')
    .select('user_id')
    .or(`portfolio_id.eq.${portfolioId},portfolio_id.is.null`)
    .eq('can_approve_trade_plans', true)

  if (error) {
    console.warn('Failed to get approvers:', error)
    return []
  }

  return data?.map((d) => d.user_id) || []
}

// ============================================================
// Core Functions
// ============================================================

/**
 * Create a trade plan from a Trade Lab view
 */
export async function createTradePlanFromView(
  params: CreatePlanParams
): Promise<TradePlan> {
  const { viewId, name, description, context } = params

  // Use the Postgres function to create plan atomically
  const { data: planId, error: createError } = await supabase.rpc(
    'create_trade_plan_from_view',
    {
      p_view_id: viewId,
      p_name: name,
      p_user_id: context.actorId,
    }
  )

  if (createError) {
    throw new Error(`Failed to create plan: ${createError.message}`)
  }

  // Update description if provided
  if (description) {
    await supabase
      .from('trade_plans')
      .update({ description })
      .eq('id', planId)
  }

  // Fetch the created plan
  const { data: plan, error: fetchError } = await supabase
    .from('trade_plans')
    .select('*')
    .eq('id', planId)
    .single()

  if (fetchError) {
    throw new Error(`Failed to fetch plan: ${fetchError.message}`)
  }

  // Emit audit event
  await emitAuditEvent({
    actor: { id: context.actorId, type: 'user', role: context.actorRole },
    entity: {
      type: 'trade_plan',
      id: planId,
      displayName: name,
    },
    action: { type: 'create', category: 'lifecycle' },
    state: {
      from: null,
      to: { status: 'draft', name },
    },
    changedFields: ['status', 'name', 'source_view_id'],
    metadata: {
      request_id: context.requestId,
      ui_source: context.uiSource,
      source_view_id: viewId,
      portfolio_id: plan.portfolio_id,
    },
    orgId: undefined,
    actorName: context.actorName,
    actorEmail: context.actorEmail,
  })

  return plan as TradePlan
}

/**
 * Submit a plan for approval (analyst workflow)
 */
export async function submitForApproval(
  params: SubmitForApprovalParams
): Promise<void> {
  const { planId, note, context } = params

  // Get current plan with optimistic locking
  const { data: plan, error: fetchError } = await supabase
    .from('trade_plans')
    .select('status, version, portfolio_id, name')
    .eq('id', planId)
    .single()

  if (fetchError) {
    throw new Error(`Plan not found: ${fetchError.message}`)
  }

  if (plan.status !== 'draft') {
    throw new Error(`Cannot submit plan with status '${plan.status}'`)
  }

  const now = new Date().toISOString()

  // Update with version check
  const { error: updateError, count } = await supabase
    .from('trade_plans')
    .update({
      status: 'pending_approval',
      submitted_at: now,
      submitted_by: context.actorId,
      submission_note: note,
    })
    .eq('id', planId)
    .eq('version', plan.version)

  if (updateError) {
    throw new Error(`Failed to submit plan: ${updateError.message}`)
  }

  if (count === 0) {
    throw new Error('Plan was modified by another user. Please refresh and try again.')
  }

  // Find and add approvers
  const approverIds = await getPortfolioApprovers(plan.portfolio_id)

  // TODO: Enable when trade_plan_approvers table exists
  // if (approverIds.length > 0) {
  //   const approverInserts = approverIds.map((approverId, idx) => ({
  //     plan_id: planId,
  //     approver_id: approverId,
  //     approval_order: idx,
  //     is_required: true,
  //   }))
  //   await supabase.from('trade_plan_approvers').insert(approverInserts)
  // }

  // Emit audit event
  await emitAuditEvent({
    actor: { id: context.actorId, type: 'user', role: context.actorRole },
    entity: {
      type: 'trade_plan',
      id: planId,
      displayName: plan.name,
    },
    action: { type: 'submit_for_approval', category: 'state_change' },
    state: {
      from: { status: 'draft' },
      to: { status: 'pending_approval' },
    },
    changedFields: ['status', 'submitted_at', 'submitted_by'],
    metadata: {
      request_id: context.requestId,
      ui_source: context.uiSource,
      note,
      approver_count: approverIds.length,
    },
    orgId: undefined,
    actorName: context.actorName,
    actorEmail: context.actorEmail,
  })
}

/**
 * Approve or reject a plan (PM workflow)
 */
export async function approvePlan(params: ApproveRejectParams): Promise<void> {
  const { planId, action, note, context } = params

  // Get current plan
  const { data: plan, error: fetchError } = await supabase
    .from('trade_plans')
    .select('status, version, portfolio_id, name')
    .eq('id', planId)
    .single()

  if (fetchError) {
    throw new Error(`Plan not found: ${fetchError.message}`)
  }

  if (plan.status !== 'pending_approval') {
    throw new Error(`Cannot ${action} plan with status '${plan.status}'`)
  }

  // Verify user can approve
  const canApprove = await userCanApprovePlans(context.actorId, plan.portfolio_id)
  if (!canApprove) {
    throw new Error('You do not have permission to approve plans')
  }

  const now = new Date().toISOString()
  const newStatus = action === 'approve' ? 'approved' : 'rejected'

  const updateData: Record<string, unknown> =
    action === 'approve'
      ? {
          status: newStatus,
          approved_at: now,
          approved_by: context.actorId,
          approval_note: note,
        }
      : {
          status: newStatus,
          rejected_at: now,
          rejected_by: context.actorId,
          rejection_note: note,
        }

  // Update with version check
  const { error: updateError, count } = await supabase
    .from('trade_plans')
    .update(updateData)
    .eq('id', planId)
    .eq('version', plan.version)

  if (updateError) {
    throw new Error(`Failed to ${action} plan: ${updateError.message}`)
  }

  if (count === 0) {
    throw new Error('Plan was modified by another user. Please refresh and try again.')
  }

  // TODO: Enable when trade_plan_approvers table exists
  // await supabase
  //   .from('trade_plan_approvers')
  //   .update({
  //     decision: action === 'approve' ? 'approved' : 'rejected',
  //     decision_at: now,
  //     decision_note: note,
  //   })
  //   .eq('plan_id', planId)
  //   .eq('approver_id', context.actorId)

  // Emit audit event
  await emitAuditEvent({
    actor: { id: context.actorId, type: 'user', role: context.actorRole },
    entity: {
      type: 'trade_plan',
      id: planId,
      displayName: plan.name,
    },
    action: {
      type: action === 'approve' ? 'approve' : 'reject',
      category: 'state_change',
    },
    state: {
      from: { status: 'pending_approval' },
      to: { status: newStatus },
    },
    changedFields: ['status', action === 'approve' ? 'approved_at' : 'rejected_at'],
    metadata: {
      request_id: context.requestId,
      ui_source: context.uiSource,
      note,
    },
    orgId: undefined,
    actorName: context.actorName,
    actorEmail: context.actorEmail,
  })
}

/**
 * Send a plan to the trading desk
 */
export async function sendToDesk(params: SendToDeskParams): Promise<string> {
  const { planId, context } = params

  // Get current plan
  const { data: plan, error: fetchError } = await supabase
    .from('trade_plans')
    .select('status, version, portfolio_id, name')
    .eq('id', planId)
    .single()

  if (fetchError) {
    throw new Error(`Plan not found: ${fetchError.message}`)
  }

  // Check if user can send directly (PM) or needs to be approved first
  const canSendDirectly = await userCanSendToDesk(context.actorId, plan.portfolio_id)

  if (plan.status === 'draft' && !canSendDirectly) {
    throw new Error('You must submit this plan for approval first')
  }

  if (plan.status !== 'draft' && plan.status !== 'approved') {
    throw new Error(`Cannot send plan with status '${plan.status}' to desk`)
  }

  const now = new Date().toISOString()
  const deskReference = `PLAN-${Date.now()}-${planId.substring(0, 8).toUpperCase()}`

  // Update with version check
  const { error: updateError, count } = await supabase
    .from('trade_plans')
    .update({
      status: 'sent_to_desk',
      sent_to_desk_at: now,
      sent_to_desk_by: context.actorId,
      desk_reference: deskReference,
    })
    .eq('id', planId)
    .eq('version', plan.version)

  if (updateError) {
    throw new Error(`Failed to send plan to desk: ${updateError.message}`)
  }

  if (count === 0) {
    throw new Error('Plan was modified by another user. Please refresh and try again.')
  }

  // Emit audit event
  await emitAuditEvent({
    actor: { id: context.actorId, type: 'user', role: context.actorRole },
    entity: {
      type: 'trade_plan',
      id: planId,
      displayName: plan.name,
    },
    action: { type: 'send_to_desk', category: 'state_change' },
    state: {
      from: { status: plan.status },
      to: { status: 'sent_to_desk', desk_reference: deskReference },
    },
    changedFields: ['status', 'sent_to_desk_at', 'desk_reference'],
    metadata: {
      request_id: context.requestId,
      ui_source: context.uiSource,
      desk_reference: deskReference,
      direct_send: canSendDirectly && plan.status === 'draft',
    },
    orgId: undefined,
    actorName: context.actorName,
    actorEmail: context.actorEmail,
  })

  return deskReference
}

/**
 * Acknowledge desk receipt
 */
export async function acknowledgeDeskReceipt(
  planId: string,
  note: string | undefined,
  context: ActionContext
): Promise<void> {
  // Get current plan
  const { data: plan, error: fetchError } = await supabase
    .from('trade_plans')
    .select('status, version, name')
    .eq('id', planId)
    .single()

  if (fetchError) {
    throw new Error(`Plan not found: ${fetchError.message}`)
  }

  if (plan.status !== 'sent_to_desk') {
    throw new Error(`Cannot acknowledge plan with status '${plan.status}'`)
  }

  const now = new Date().toISOString()

  const { error: updateError, count } = await supabase
    .from('trade_plans')
    .update({
      status: 'acknowledged',
      acknowledged_at: now,
      acknowledged_by: context.actorId,
      acknowledgment_note: note,
    })
    .eq('id', planId)
    .eq('version', plan.version)

  if (updateError) {
    throw new Error(`Failed to acknowledge plan: ${updateError.message}`)
  }

  if (count === 0) {
    throw new Error('Plan was modified. Please refresh and try again.')
  }

  await emitAuditEvent({
    actor: { id: context.actorId, type: 'user', role: context.actorRole },
    entity: {
      type: 'trade_plan',
      id: planId,
      displayName: plan.name,
    },
    action: { type: 'acknowledge', category: 'state_change' },
    state: {
      from: { status: 'sent_to_desk' },
      to: { status: 'acknowledged' },
    },
    changedFields: ['status', 'acknowledged_at'],
    metadata: {
      request_id: context.requestId,
      ui_source: context.uiSource,
      note,
    },
    orgId: undefined,
    actorName: context.actorName,
    actorEmail: context.actorEmail,
  })
}

// ============================================================
// Query Functions
// ============================================================

/**
 * Get a plan with all details
 */
export async function getPlanWithDetails(
  planId: string
): Promise<TradePlanWithDetails | null> {
  const { data, error } = await supabase
    .from('trade_plans')
    .select(`
      *,
      portfolios (id, name),
      users:created_by (id, email, first_name, last_name),
      trade_plan_items (*)
    `)
    .eq('id', planId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null // Not found
    throw new Error(`Failed to fetch plan: ${error.message}`)
  }

  return data as TradePlanWithDetails
}

/**
 * Get plans for a portfolio
 */
export async function getPlansForPortfolio(
  portfolioId: string,
  options: {
    status?: TradePlanStatus | TradePlanStatus[]
    includeArchived?: boolean
    limit?: number
    offset?: number
  } = {}
): Promise<TradePlanWithDetails[]> {
  let query = supabase
    .from('trade_plans')
    .select(`
      *,
      portfolios (id, name),
      users:created_by (id, email, first_name, last_name),
      trade_plan_items (id)
    `)
    .eq('portfolio_id', portfolioId)

  if (!options.includeArchived) {
    query = query.is('archived_at', null)
  }

  if (options.status) {
    if (Array.isArray(options.status)) {
      query = query.in('status', options.status)
    } else {
      query = query.eq('status', options.status)
    }
  }

  query = query.order('created_at', { ascending: false })

  if (options.limit) {
    query = query.limit(options.limit)
  }

  if (options.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 50) - 1)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`Failed to fetch plans: ${error.message}`)
  }

  return data as TradePlanWithDetails[]
}

/**
 * Get pending approvals for a user
 * Note: Returns plans where the user is a portfolio PM and status is pending_approval
 */
export async function getPendingApprovals(
  userId: string
): Promise<TradePlanWithDetails[]> {
  // For now, just get plans pending approval that the user created
  // TODO: Implement proper approver tracking when trade_plan_approvers table exists
  const { data, error } = await supabase
    .from('trade_plans')
    .select(`
      *,
      portfolios (id, name),
      users:created_by (id, email, first_name, last_name),
      trade_plan_items (id)
    `)
    .eq('status', 'pending_approval')
    .is('archived_at', null)
    .order('submitted_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to fetch pending approvals: ${error.message}`)
  }

  return data as TradePlanWithDetails[]
}

/**
 * Delete a plan (soft delete via archived_at)
 */
export async function deletePlan(
  planId: string,
  context: ActionContext
): Promise<void> {
  const { data: plan, error: fetchError } = await supabase
    .from('trade_plans')
    .select('status, name, archived_at')
    .eq('id', planId)
    .single()

  if (fetchError) {
    throw new Error(`Plan not found: ${fetchError.message}`)
  }

  if (plan.archived_at) {
    throw new Error('Plan is already archived')
  }

  // Can only delete draft plans
  if (plan.status !== 'draft') {
    throw new Error('Can only delete draft plans')
  }

  const now = new Date().toISOString()

  const { error } = await supabase
    .from('trade_plans')
    .update({
      archived_at: now,
      archived_by: context.actorId,
    })
    .eq('id', planId)

  if (error) {
    throw new Error(`Failed to delete plan: ${error.message}`)
  }

  await emitAuditEvent({
    actor: { id: context.actorId, type: 'user', role: context.actorRole },
    entity: {
      type: 'trade_plan',
      id: planId,
      displayName: plan.name,
    },
    action: { type: 'delete', category: 'lifecycle' },
    state: {
      from: { archived_at: null, status: plan.status },
      to: { archived_at: now },
    },
    changedFields: ['archived_at', 'archived_by'],
    metadata: {
      request_id: context.requestId,
      ui_source: context.uiSource,
    },
    orgId: undefined,
    actorName: context.actorName,
    actorEmail: context.actorEmail,
  })
}

// ============================================================
// History & Discovery Queries
// ============================================================

export interface ListPlansParams {
  portfolioId?: string
  labId?: string
  status?: TradePlanStatus | TradePlanStatus[]
  creatorId?: string
  sourceViewId?: string
  sourceViewType?: 'private' | 'shared' | 'portfolio'
  startDate?: string
  endDate?: string
  limit?: number
  offset?: number
  includeArchived?: boolean
}

/**
 * List plans with flexible filtering (for Trade Plans History page)
 */
export async function listPlans(
  params: ListPlansParams = {}
): Promise<TradePlanWithDetails[]> {
  const {
    portfolioId,
    labId,
    status,
    creatorId,
    sourceViewId,
    sourceViewType,
    startDate,
    endDate,
    limit = 50,
    offset = 0,
    includeArchived = false,
  } = params

  let query = supabase
    .from('trade_plans')
    .select(`
      *,
      portfolios (id, name),
      users:created_by (id, email, first_name, last_name),
      trade_plan_items (id, asset_id, action, shares, weight)
    `)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  // Visibility filter - use archived_at instead of visibility_tier
  if (!includeArchived) {
    query = query.is('archived_at', null)
  }

  // Portfolio filter
  if (portfolioId) {
    query = query.eq('portfolio_id', portfolioId)
  }

  // Lab filter
  if (labId) {
    query = query.eq('lab_id', labId)
  }

  // Status filter
  if (status) {
    if (Array.isArray(status)) {
      query = query.in('status', status)
    } else {
      query = query.eq('status', status)
    }
  }

  // Creator filter
  if (creatorId) {
    query = query.eq('created_by', creatorId)
  }

  // Source view filter
  if (sourceViewId) {
    query = query.eq('source_view_id', sourceViewId)
  }

  // Date range filters
  if (startDate) {
    query = query.gte('created_at', startDate)
  }

  if (endDate) {
    query = query.lte('created_at', endDate)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`Failed to list plans: ${error.message}`)
  }

  // If filtering by source view type, we need to join and filter
  if (sourceViewType && data) {
    const viewIds = data
      .filter((p: any) => p.source_view_id)
      .map((p: any) => p.source_view_id)

    if (viewIds.length > 0) {
      const { data: views } = await supabase
        .from('trade_lab_views')
        .select('id, view_type')
        .in('id', viewIds)
        .eq('view_type', sourceViewType)

      const matchingViewIds = new Set(views?.map((v) => v.id) || [])
      return data.filter(
        (p: any) => p.source_view_id && matchingViewIds.has(p.source_view_id)
      ) as TradePlanWithDetails[]
    }
  }

  return data as TradePlanWithDetails[]
}

/**
 * Get plans created by a specific user
 */
export async function getMyPlans(
  userId: string,
  params: Omit<ListPlansParams, 'creatorId'> = {}
): Promise<TradePlanWithDetails[]> {
  return listPlans({ ...params, creatorId: userId })
}

/**
 * Get plans from collaborative views (shared views & portfolio working set)
 * These are plans the user contributed to via collaboration
 */
export async function getCollaborativePlans(
  userId: string,
  params: Omit<ListPlansParams, 'creatorId'> = {}
): Promise<TradePlanWithDetails[]> {
  // Get views where user is a member (shared views)
  const { data: memberViews, error: viewError } = await supabase
    .from('trade_lab_view_members')
    .select('view_id')
    .eq('user_id', userId)

  if (viewError) {
    throw new Error(`Failed to get member views: ${viewError.message}`)
  }

  // Get portfolio working set views for user's portfolios
  const { data: portfolioMembers, error: pmError } = await supabase
    .from('portfolio_members')
    .select('portfolio_id')
    .eq('user_id', userId)

  if (pmError) {
    throw new Error(`Failed to get portfolio memberships: ${pmError.message}`)
  }

  const portfolioIds = portfolioMembers.map((pm) => pm.portfolio_id)

  // Get lab IDs for these portfolios
  const { data: labs, error: labError } = await supabase
    .from('trade_labs')
    .select('id')
    .in('portfolio_id', portfolioIds)

  if (labError) {
    throw new Error(`Failed to get labs: ${labError.message}`)
  }

  const labIds = labs?.map((l) => l.id) || []

  // Get portfolio views
  const { data: pwsViews, error: pwsError } = await supabase
    .from('trade_lab_views')
    .select('id')
    .in('lab_id', labIds)
    .eq('view_type', 'portfolio')

  if (pwsError) {
    throw new Error(`Failed to get PWS views: ${pwsError.message}`)
  }

  const collaborativeViewIds = [
    ...memberViews.map((v) => v.view_id),
    ...(pwsViews?.map((v) => v.id) || []),
  ]

  if (collaborativeViewIds.length === 0) {
    return []
  }

  // Get plans from these views (excluding user's own plans)
  const allPlans = await listPlans(params)
  return allPlans.filter(
    (p) =>
      p.source_view_id &&
      collaborativeViewIds.includes(p.source_view_id) &&
      p.created_by !== userId
  )
}

/**
 * Get recent plans for quick access
 */
export async function getRecentPlans(
  portfolioId?: string,
  limit: number = 10
): Promise<TradePlanWithDetails[]> {
  return listPlans({
    portfolioId,
    limit,
    status: ['sent_to_desk', 'acknowledged', 'approved'],
  })
}

/**
 * Get plan statistics for a portfolio
 */
export async function getPlanStats(portfolioId: string): Promise<{
  total: number
  draft: number
  pending: number
  approved: number
  sent: number
  acknowledged: number
  rejected: number
}> {
  const { data, error } = await supabase
    .from('trade_plans')
    .select('status')
    .eq('portfolio_id', portfolioId)
    .is('archived_at', null)

  if (error) {
    throw new Error(`Failed to get plan stats: ${error.message}`)
  }

  const stats = {
    total: data?.length || 0,
    draft: 0,
    pending: 0,
    approved: 0,
    sent: 0,
    acknowledged: 0,
    rejected: 0,
  }

  data?.forEach((p) => {
    switch (p.status) {
      case 'draft':
        stats.draft++
        break
      case 'pending_approval':
        stats.pending++
        break
      case 'approved':
        stats.approved++
        break
      case 'sent_to_desk':
        stats.sent++
        break
      case 'acknowledged':
        stats.acknowledged++
        break
      case 'rejected':
        stats.rejected++
        break
    }
  })

  return stats
}
