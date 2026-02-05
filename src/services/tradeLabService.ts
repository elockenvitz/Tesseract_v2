import { supabase } from '../lib/supabase'

// =============================================================================
// Types
// =============================================================================

export type TradeLabViewType = 'private' | 'shared'
export type TradeLabViewRole = 'owner' | 'editor' | 'viewer'
export type TradePlanStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'sent' | 'acknowledged' | 'archived'

export interface TradeLab {
  id: string
  portfolio_id: string
  name: string
  description: string | null
  settings: Record<string, unknown>
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface TradeLabView {
  id: string
  lab_id: string
  owner_id: string | null
  view_type: TradeLabViewType
  name: string
  description: string | null
  visibility_tier: string
  deleted_at: string | null
  archived_at: string | null
  baseline_holdings: unknown[] | null
  baseline_total_value: number | null
  baseline_captured_at: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface TradeLabViewMember {
  id: string
  view_id: string
  user_id: string
  role: TradeLabViewRole
  invited_by: string | null
  created_at: string
  updated_at: string
  users?: {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
  }
}

export interface TradeLabDraft {
  id: string
  portfolio_id: string
  view_id: string | null
  name: string
  description: string | null
  status: string
  baseline_holdings: unknown[]
  baseline_total_value: number
  result_metrics: Record<string, unknown>
  is_collaborative: boolean
  visibility: string
  created_by: string
  created_at: string
  updated_at: string
  completed_at: string | null
}

export interface TradePlan {
  id: string
  portfolio_id: string
  lab_id: string | null
  source_view_id: string | null
  source_simulation_id: string | null
  name: string
  description: string | null
  status: TradePlanStatus
  baseline_holdings: unknown[]
  baseline_total_value: number
  result_metrics: Record<string, unknown>
  submitted_at: string | null
  submitted_by: string | null
  approved_at: string | null
  approved_by: string | null
  rejected_at: string | null
  rejected_by: string | null
  rejection_reason: string | null
  sent_at: string | null
  sent_by: string | null
  acknowledged_at: string | null
  acknowledged_by: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
  archived_by: string | null
}

export interface TradePlanItem {
  id: string
  plan_id: string
  asset_id: string
  trade_queue_item_id: string | null
  action: string
  shares: number | null
  weight: number | null
  price: number | null
  rationale: string | null
  notes: string | null
  sort_order: number
  created_at: string
  assets?: {
    id: string
    symbol: string
    company_name: string
    sector: string | null
  }
}

// =============================================================================
// Trade Lab Service
// =============================================================================

export const tradeLabService = {
  // ---------------------------------------------------------------------------
  // Lab Management
  // ---------------------------------------------------------------------------

  /**
   * Get or create a trade lab for a portfolio
   */
  async getOrCreateTradeLab(portfolioId: string): Promise<TradeLab> {
    // Try to get existing lab
    const { data: existingLab, error: fetchError } = await supabase
      .from('trade_labs')
      .select('*')
      .eq('portfolio_id', portfolioId)
      .single()

    if (existingLab) return existingLab as TradeLab

    // Create if not found
    if (fetchError?.code === 'PGRST116') {
      const { data: portfolio } = await supabase
        .from('portfolios')
        .select('name')
        .eq('id', portfolioId)
        .single()

      const { data: newLab, error: createError } = await supabase
        .from('trade_labs')
        .insert({
          portfolio_id: portfolioId,
          name: `${portfolio?.name || 'Portfolio'} Trade Lab`,
          settings: {}
        })
        .select()
        .single()

      if (createError) throw createError
      return newLab as TradeLab
    }

    if (fetchError) throw fetchError
    throw new Error('Failed to get or create trade lab')
  },

  // ---------------------------------------------------------------------------
  // View Management
  // ---------------------------------------------------------------------------

  /**
   * Get or create the user's private workspace view
   */
  async getOrCreatePrivateView(labId: string, userId: string): Promise<TradeLabView> {
    const { data, error } = await supabase.rpc('get_or_create_private_view', {
      p_lab_id: labId,
      p_user_id: userId
    })

    if (error) throw error

    // Fetch the full view
    const { data: view, error: viewError } = await supabase
      .from('trade_lab_views')
      .select('*')
      .eq('id', data)
      .single()

    if (viewError) throw viewError
    return view as TradeLabView
  },

  /**
   * List all shared views the user can access
   */
  async listSharedViews(labId: string): Promise<TradeLabView[]> {
    const { data, error } = await supabase
      .from('trade_lab_views')
      .select('*')
      .eq('lab_id', labId)
      .eq('view_type', 'shared')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })

    if (error) throw error
    return (data || []) as TradeLabView[]
  },

  /**
   * Create a new shared view with members
   */
  async createSharedView(
    labId: string,
    name: string,
    members: Array<{ userId: string; role: TradeLabViewRole }>
  ): Promise<TradeLabView> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    // Create the view
    const { data: view, error: viewError } = await supabase
      .from('trade_lab_views')
      .insert({
        lab_id: labId,
        owner_id: user.id,
        view_type: 'shared',
        name,
        created_by: user.id
      })
      .select()
      .single()

    if (viewError) throw viewError

    // Add members
    if (members.length > 0) {
      const memberInserts = members.map(m => ({
        view_id: view.id,
        user_id: m.userId,
        role: m.role,
        invited_by: user.id
      }))

      const { error: membersError } = await supabase
        .from('trade_lab_view_members')
        .insert(memberInserts)

      if (membersError) throw membersError
    }

    return view as TradeLabView
  },

  /**
   * Update members of a shared view
   */
  async updateSharedViewMembers(
    viewId: string,
    changes: {
      add?: Array<{ userId: string; role: TradeLabViewRole }>
      remove?: string[]
      update?: Array<{ userId: string; role: TradeLabViewRole }>
    }
  ): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    // Add new members
    if (changes.add && changes.add.length > 0) {
      const memberInserts = changes.add.map(m => ({
        view_id: viewId,
        user_id: m.userId,
        role: m.role,
        invited_by: user.id
      }))

      const { error } = await supabase
        .from('trade_lab_view_members')
        .insert(memberInserts)

      if (error) throw error
    }

    // Remove members
    if (changes.remove && changes.remove.length > 0) {
      const { error } = await supabase
        .from('trade_lab_view_members')
        .delete()
        .eq('view_id', viewId)
        .in('user_id', changes.remove)

      if (error) throw error
    }

    // Update roles
    if (changes.update && changes.update.length > 0) {
      for (const update of changes.update) {
        const { error } = await supabase
          .from('trade_lab_view_members')
          .update({ role: update.role })
          .eq('view_id', viewId)
          .eq('user_id', update.userId)

        if (error) throw error
      }
    }
  },

  /**
   * Get members of a view
   */
  async getViewMembers(viewId: string): Promise<TradeLabViewMember[]> {
    const { data, error } = await supabase
      .from('trade_lab_view_members')
      .select(`
        *,
        users:user_id (id, email, first_name, last_name)
      `)
      .eq('view_id', viewId)
      .order('created_at', { ascending: true })

    if (error) throw error
    return (data || []) as TradeLabViewMember[]
  },

  // ---------------------------------------------------------------------------
  // Draft Management
  // ---------------------------------------------------------------------------

  /**
   * List drafts for a specific view
   */
  async listDrafts(viewId: string): Promise<TradeLabDraft[]> {
    const { data, error } = await supabase
      .from('simulations')
      .select('*')
      .eq('view_id', viewId)
      .not('status', 'eq', 'archived')
      .order('updated_at', { ascending: false })

    if (error) throw error
    return (data || []) as TradeLabDraft[]
  },

  /**
   * Create or update a draft (autosave)
   */
  async upsertDraft(
    viewId: string,
    draft: {
      id?: string
      name: string
      description?: string
      baseline_holdings?: unknown[]
      baseline_total_value?: number
      result_metrics?: Record<string, unknown>
    }
  ): Promise<TradeLabDraft> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    // Get view to find portfolio_id
    const { data: view, error: viewError } = await supabase
      .from('trade_lab_views')
      .select('lab_id')
      .eq('id', viewId)
      .single()

    if (viewError) throw viewError

    const { data: lab, error: labError } = await supabase
      .from('trade_labs')
      .select('portfolio_id')
      .eq('id', view.lab_id)
      .single()

    if (labError) throw labError

    if (draft.id) {
      // Update existing
      const { data, error } = await supabase
        .from('simulations')
        .update({
          name: draft.name,
          description: draft.description,
          baseline_holdings: draft.baseline_holdings,
          baseline_total_value: draft.baseline_total_value,
          result_metrics: draft.result_metrics,
          updated_at: new Date().toISOString()
        })
        .eq('id', draft.id)
        .select()
        .single()

      if (error) throw error
      return data as TradeLabDraft
    } else {
      // Create new
      const { data, error } = await supabase
        .from('simulations')
        .insert({
          portfolio_id: lab.portfolio_id,
          view_id: viewId,
          name: draft.name,
          description: draft.description || '',
          status: 'draft',
          baseline_holdings: draft.baseline_holdings || [],
          baseline_total_value: draft.baseline_total_value || 0,
          result_metrics: draft.result_metrics || {},
          created_by: user.id
        })
        .select()
        .single()

      if (error) throw error
      return data as TradeLabDraft
    }
  },

  /**
   * Move a draft to a different view
   */
  async moveDraft(draftId: string, targetViewId: string): Promise<void> {
    const { error } = await supabase
      .from('simulations')
      .update({ view_id: targetViewId, updated_at: new Date().toISOString() })
      .eq('id', draftId)

    if (error) throw error
  },

  /**
   * Soft delete a draft
   */
  async deleteDraft(draftId: string): Promise<void> {
    const { error } = await supabase
      .from('simulations')
      .update({ status: 'archived', updated_at: new Date().toISOString() })
      .eq('id', draftId)

    if (error) throw error
  },

  // ---------------------------------------------------------------------------
  // Plan Management
  // ---------------------------------------------------------------------------

  /**
   * Create a plan from a simulation (draft)
   */
  async createPlanFromSimulation(simulationId: string, name?: string): Promise<TradePlan> {
    const { data: planId, error: rpcError } = await supabase.rpc('create_plan_from_simulation', {
      p_simulation_id: simulationId,
      p_name: name || null
    })

    if (rpcError) throw rpcError

    const { data, error } = await supabase
      .from('trade_plans')
      .select('*')
      .eq('id', planId)
      .single()

    if (error) throw error
    return data as TradePlan
  },

  /**
   * List plans for a portfolio
   */
  async listPlans(
    portfolioId: string,
    filters?: {
      status?: TradePlanStatus[]
      limit?: number
      offset?: number
    }
  ): Promise<{ plans: TradePlan[]; total: number }> {
    let query = supabase
      .from('trade_plans')
      .select('*', { count: 'exact' })
      .eq('portfolio_id', portfolioId)
      .order('created_at', { ascending: false })

    if (filters?.status && filters.status.length > 0) {
      query = query.in('status', filters.status)
    }

    if (filters?.limit) {
      query = query.limit(filters.limit)
    }

    if (filters?.offset) {
      query = query.range(filters.offset, filters.offset + (filters.limit || 10) - 1)
    }

    const { data, count, error } = await query

    if (error) throw error
    return {
      plans: (data || []) as TradePlan[],
      total: count || 0
    }
  },

  /**
   * Get a plan with its items
   */
  async getPlan(planId: string): Promise<{ plan: TradePlan; items: TradePlanItem[] }> {
    const { data: plan, error: planError } = await supabase
      .from('trade_plans')
      .select('*')
      .eq('id', planId)
      .single()

    if (planError) throw planError

    const { data: items, error: itemsError } = await supabase
      .from('trade_plan_items')
      .select(`
        *,
        assets (id, symbol, company_name, sector)
      `)
      .eq('plan_id', planId)
      .order('sort_order', { ascending: true })

    if (itemsError) throw itemsError

    return {
      plan: plan as TradePlan,
      items: (items || []) as TradePlanItem[]
    }
  },

  /**
   * Submit a plan for approval
   */
  async submitForApproval(planId: string): Promise<TradePlan> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    const { data, error } = await supabase
      .from('trade_plans')
      .update({
        status: 'pending_approval',
        submitted_at: new Date().toISOString(),
        submitted_by: user.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', planId)
      .select()
      .single()

    if (error) throw error
    return data as TradePlan
  },

  /**
   * Approve a plan
   */
  async approvePlan(planId: string): Promise<TradePlan> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    const { data, error } = await supabase
      .from('trade_plans')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by: user.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', planId)
      .select()
      .single()

    if (error) throw error
    return data as TradePlan
  },

  /**
   * Reject a plan
   */
  async rejectPlan(planId: string, reason?: string): Promise<TradePlan> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    const { data, error } = await supabase
      .from('trade_plans')
      .update({
        status: 'rejected',
        rejected_at: new Date().toISOString(),
        rejected_by: user.id,
        rejection_reason: reason || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', planId)
      .select()
      .single()

    if (error) throw error
    return data as TradePlan
  },

  /**
   * Send a plan to desk
   */
  async sendToDesk(planId: string): Promise<TradePlan> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    const { data, error } = await supabase
      .from('trade_plans')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        sent_by: user.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', planId)
      .select()
      .single()

    if (error) throw error
    return data as TradePlan
  },

  /**
   * Acknowledge a plan
   */
  async acknowledgePlan(planId: string): Promise<TradePlan> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    const { data, error } = await supabase
      .from('trade_plans')
      .update({
        status: 'acknowledged',
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: user.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', planId)
      .select()
      .single()

    if (error) throw error
    return data as TradePlan
  },

  /**
   * Archive a plan
   */
  async archivePlan(planId: string): Promise<TradePlan> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    const { data, error } = await supabase
      .from('trade_plans')
      .update({
        status: 'archived',
        archived_at: new Date().toISOString(),
        archived_by: user.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', planId)
      .select()
      .single()

    if (error) throw error
    return data as TradePlan
  }
}

export default tradeLabService
