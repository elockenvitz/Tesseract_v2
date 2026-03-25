/**
 * useAttention Hook
 *
 * Fetches and manages attention items for the "10-minute screen" dashboard.
 * Provides data for 4 sections:
 * 1. informational - "What's New"
 * 2. action_required - "What I Need To Do"
 * 3. decision_required - "Decisions I Need To Make"
 * 4. alignment - "Team Priority View"
 *
 * This version queries Supabase directly (no Edge Function required).
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import type {
  AttentionResponse,
  AttentionItem,
  AttentionType,
  AttentionSeverity,
  ScoreBreakdown,
} from '../types/attention'

// ===== Query Key Helpers =====
// Export these for use in other components that need to invalidate attention queries

/**
 * Build the query key for a specific attention query
 */
export function attentionQueryKey(userId: string, windowHours?: number): (string | number)[] {
  if (windowHours !== undefined) {
    return ['attention', userId, windowHours]
  }
  return ['attention', userId]
}

/**
 * Invalidate all attention queries for a user (regardless of windowHours)
 */
export async function invalidateAttentionQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  userId: string
): Promise<void> {
  await queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey
      return key[0] === 'attention' && key[1] === userId
    }
  })
}

/**
 * Helper to invalidate attention from any component
 * Gets userId from current auth state
 */
export function useInvalidateAttention() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return async () => {
    if (user?.id) {
      await invalidateAttentionQueries(queryClient, user.id)
    }
  }
}

interface UseAttentionOptions {
  windowHours?: number
  enabled?: boolean
  refetchInterval?: number | false
}

interface AttentionMutationOptions {
  onSuccess?: () => void
  onError?: (error: Error) => void
}

// Scoring weights
const WEIGHTS = {
  overdue_days_multiplier: 10,
  due_soon_days_threshold: 3,
  due_soon_bonus: 20,
  owner_bonus: 15,
  assigned_bonus: 10,
  decision_required_bonus: 30,
  action_required_bonus: 20,
  blocking_bonus: 25,
  recent_activity_threshold_hours: 24,
  recent_activity_bonus: 10,
  stale_activity_penalty: -5,
  severity_multipliers: {
    low: 1.0,
    medium: 1.25,
    high: 1.5,
    critical: 2.0,
  } as Record<AttentionSeverity, number>,
}

// Priority for de-duplication
const ATTENTION_TYPE_PRIORITY: Record<AttentionType, number> = {
  decision_required: 4,
  action_required: 3,
  informational: 2,
  alignment: 1,
}

// Generate deterministic attention_id
async function generateAttentionId(
  sourceType: string,
  sourceId: string,
  attentionType: string,
  reasonCode: string
): Promise<string> {
  const input = `${sourceType}:${sourceId}:${attentionType}:${reasonCode}`
  const encoder = new TextEncoder()
  const data = encoder.encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32)
}

// Calculate score for an attention item
function calculateScore(item: AttentionItem, userId: string): { score: number; breakdown: ScoreBreakdown[] } {
  const breakdown: ScoreBreakdown[] = []
  let score = 0

  const severityMultiplier = WEIGHTS.severity_multipliers[item.severity] || 1.0
  score += 10 * severityMultiplier
  breakdown.push({ key: 'severity', value: 10 * severityMultiplier })

  if (item.due_at) {
    const dueDate = new Date(item.due_at)
    const now = new Date()
    const daysUntilDue = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)

    if (daysUntilDue < 0) {
      const overdueDays = Math.abs(Math.floor(daysUntilDue))
      const overdueScore = overdueDays * WEIGHTS.overdue_days_multiplier
      score += overdueScore
      breakdown.push({ key: 'overdue', value: overdueScore })
    } else if (daysUntilDue <= WEIGHTS.due_soon_days_threshold) {
      score += WEIGHTS.due_soon_bonus
      breakdown.push({ key: 'due_soon', value: WEIGHTS.due_soon_bonus })
    }
  }

  if (item.primary_owner_user_id === userId) {
    score += WEIGHTS.owner_bonus
    breakdown.push({ key: 'owner', value: WEIGHTS.owner_bonus })
  } else if (item.participant_user_ids.includes(userId)) {
    score += WEIGHTS.assigned_bonus
    breakdown.push({ key: 'assigned', value: WEIGHTS.assigned_bonus })
  }

  if (item.attention_type === 'decision_required') {
    score += WEIGHTS.decision_required_bonus
    breakdown.push({ key: 'decision_type', value: WEIGHTS.decision_required_bonus })
  } else if (item.attention_type === 'action_required') {
    score += WEIGHTS.action_required_bonus
    breakdown.push({ key: 'action_type', value: WEIGHTS.action_required_bonus })
  }

  if (item.status === 'blocked' || item.blocker_reason) {
    score += WEIGHTS.blocking_bonus
    breakdown.push({ key: 'blocking', value: WEIGHTS.blocking_bonus })
  }

  const lastActivity = new Date(item.last_activity_at)
  const hoursSinceActivity = (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60)

  if (hoursSinceActivity <= WEIGHTS.recent_activity_threshold_hours) {
    score += WEIGHTS.recent_activity_bonus
    breakdown.push({ key: 'recent_activity', value: WEIGHTS.recent_activity_bonus })
  } else if (hoursSinceActivity > 72) {
    score += WEIGHTS.stale_activity_penalty
    breakdown.push({ key: 'stale', value: WEIGHTS.stale_activity_penalty })
  }

  return { score: Math.max(0, score), breakdown }
}

// Collect project deliverables
async function collectProjectDeliverables(userId: string): Promise<AttentionItem[]> {
  const items: AttentionItem[] = []

  // First get projects the user is assigned to
  const { data: userProjectIds } = await supabase
    .from('project_assignments')
    .select('project_id')
    .eq('assigned_to', userId)

  const projectIds = userProjectIds?.map(p => p.project_id) || []

  // Get deliverables that are either:
  // 1. Directly assigned to the user, OR
  // 2. In a project the user is assigned to (and unassigned)
  const { data: deliverables, error } = await supabase
    .from('project_deliverables')
    .select(`
      *,
      projects!inner (
        id,
        title,
        status,
        priority,
        context_type,
        context_id,
        created_by
      )
    `)
    .eq('completed', false)
    .limit(30)

  if (error || !deliverables) return items

  // Filter to deliverables relevant to this user
  const relevantDeliverables = deliverables.filter(d =>
    d.assigned_to === userId ||  // Directly assigned
    (d.assigned_to === null && projectIds.includes(d.project_id)) ||  // Unassigned in user's project
    d.projects?.created_by === userId  // User owns the project
  )

  for (const d of relevantDeliverables) {
    const attentionId = await generateAttentionId(
      'project_deliverable',
      d.id,
      'action_required',
      'deliverable_pending'
    )

    const isOverdue = d.due_date && new Date(d.due_date) < new Date()
    const severity: AttentionSeverity = isOverdue ? 'high' :
      d.projects?.priority === 'urgent' ? 'high' :
      d.projects?.priority === 'high' ? 'medium' : 'low'

    items.push({
      attention_id: attentionId,
      source_type: 'project_deliverable',
      source_id: d.id,
      source_url: `/project/${d.project_id}`,
      attention_type: 'action_required',
      reason_code: 'deliverable_pending',
      reason_text: isOverdue
        ? `This deliverable is overdue and needs completion`
        : `You have a pending deliverable to complete`,
      title: d.title,
      subtitle: d.projects?.title,
      preview: d.description?.substring(0, 150),
      tags: [d.projects?.status, d.projects?.priority].filter(Boolean) as string[],
      icon_key: 'ListTodo',
      audience: 'personal',
      primary_owner_user_id: d.assigned_to || userId,
      participant_user_ids: [d.assigned_to].filter(Boolean) as string[],
      created_by_user_id: null,
      last_actor_user_id: null,
      created_at: d.created_at,
      updated_at: d.updated_at,
      last_activity_at: d.updated_at,
      due_at: d.due_date,
      status: 'open',
      next_action: 'Complete this deliverable',
      severity,
      score: 0,
      context: {
        project_id: d.project_id,
      },
    })
  }

  return items
}

// Collect projects
async function collectProjects(userId: string): Promise<AttentionItem[]> {
  const items: AttentionItem[] = []

  // Get project IDs where user is assigned
  const { data: userProjectAssignments } = await supabase
    .from('project_assignments')
    .select('project_id')
    .eq('assigned_to', userId)

  const assignedProjectIds = userProjectAssignments?.map(p => p.project_id) || []

  const { data: projects, error } = await supabase
    .from('projects')
    .select(`
      *,
      project_assignments!left (
        assigned_to,
        role
      )
    `)
    .in('status', ['planning', 'in_progress', 'blocked'])
    .limit(30)

  if (error || !projects) return items

  // Filter to projects relevant to the user (created or assigned)
  const relevantProjects = projects.filter(p =>
    p.created_by === userId || assignedProjectIds.includes(p.id)
  )

  for (const p of relevantProjects) {
    const isBlocked = p.status === 'blocked'
    const isOverdue = p.due_date && new Date(p.due_date) < new Date()
    const isDueSoon = p.due_date &&
      (new Date(p.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24) <= 7

    if (!isBlocked && !isOverdue && !isDueSoon) continue

    const reasonCode = isBlocked ? 'project_blocked' : isOverdue ? 'project_overdue' : 'project_due_soon'

    const attentionId = await generateAttentionId(
      'project',
      p.id,
      'action_required',
      reasonCode
    )

    const severity: AttentionSeverity = isBlocked ? 'high' :
      isOverdue ? 'high' :
      p.priority === 'urgent' ? 'high' :
      p.priority === 'high' ? 'medium' : 'low'

    items.push({
      attention_id: attentionId,
      source_type: 'project',
      source_id: p.id,
      source_url: `/project/${p.id}`,
      attention_type: 'action_required',
      reason_code: reasonCode,
      reason_text: isBlocked
        ? `Project is blocked: ${p.blocked_reason || 'needs attention'}`
        : isOverdue
        ? `Project is overdue`
        : `Project is due soon`,
      title: p.title,
      subtitle: p.context_type ? `${p.context_type} project` : undefined,
      preview: p.description?.substring(0, 150),
      tags: [p.status, p.priority].filter(Boolean) as string[],
      icon_key: 'FolderKanban',
      audience: 'personal',
      primary_owner_user_id: p.created_by,
      participant_user_ids: (p.project_assignments || []).map((a: any) => a.assigned_to).filter(Boolean),
      created_by_user_id: p.created_by,
      last_actor_user_id: null,
      created_at: p.created_at,
      updated_at: p.updated_at,
      last_activity_at: p.updated_at,
      due_at: p.due_date,
      status: p.status === 'blocked' ? 'blocked' : 'in_progress',
      blocker_reason: p.blocked_reason,
      next_action: isBlocked ? 'Resolve blocker' : 'Review project progress',
      severity,
      score: 0,
      context: {
        project_id: p.id,
      },
    })
  }

  return items
}

// Collect trade queue items
// Only items in 'deciding' stage show as Decision Required
// Items in earlier stages (idea, discussing, approved/simulating) are for grooming, not decisions
async function collectTradeQueueItems(userId: string): Promise<AttentionItem[]> {
  const items: AttentionItem[] = []

  // Only fetch items in 'deciding' status - these require an actual decision
  const { data: trades, error } = await supabase
    .from('trade_queue_items')
    .select(`
      *,
      assets (
        id,
        symbol,
        company_name
      ),
      portfolios (
        id,
        name
      ),
      trade_queue_votes (
        user_id,
        vote
      )
    `)
    .eq('status', 'deciding')
    .limit(20)

  if (error || !trades) return items

  for (const t of trades) {
    const userVote = t.trade_queue_votes?.find((v: any) => v.user_id === userId)
    if (userVote) continue

    const attentionId = await generateAttentionId(
      'trade_queue_item',
      t.id,
      'decision_required',
      'trade_decision_needed'
    )

    const urgencyMap: Record<string, AttentionSeverity> = {
      urgent: 'critical',
      high: 'high',
      medium: 'medium',
      low: 'low',
    }

    items.push({
      attention_id: attentionId,
      source_type: 'trade_queue_item',
      source_id: t.id,
      source_url: `/trade-queue`,
      attention_type: 'decision_required',
      reason_code: 'trade_decision_needed',
      reason_text: `Trade idea for ${t.assets?.symbol || 'asset'} is ready for decision`,
      title: `${t.action?.toUpperCase() || 'TRADE'} ${t.assets?.symbol || ''}`,
      subtitle: t.portfolios?.name,
      preview: t.rationale?.substring(0, 150),
      tags: [t.action, t.urgency, 'deciding'].filter(Boolean) as string[],
      icon_key: 'Scale',
      audience: 'shared',
      primary_owner_user_id: t.created_by,
      participant_user_ids: (t.trade_queue_votes || []).map((v: any) => v.user_id).filter(Boolean),
      created_by_user_id: t.created_by,
      last_actor_user_id: t.created_by,
      created_at: t.created_at,
      updated_at: t.updated_at,
      last_activity_at: t.updated_at,
      due_at: t.expires_at,
      status: 'waiting',
      next_action: 'Make a decision: Execute, Reject, or Continue Simulating',
      severity: urgencyMap[t.urgency] || 'medium',
      score: 0,
      context: {
        asset_id: t.asset_id,
        portfolio_id: t.portfolio_id,
      },
    })
  }

  return items
}

// Collect list suggestions
async function collectListSuggestions(userId: string): Promise<AttentionItem[]> {
  const items: AttentionItem[] = []

  const { data: suggestions, error } = await supabase
    .from('asset_list_suggestions')
    .select(`
      *,
      asset_lists (
        id,
        name
      ),
      assets (
        id,
        symbol,
        company_name
      )
    `)
    .eq('target_user_id', userId)
    .eq('status', 'pending')
    .limit(20)

  if (error || !suggestions) return items

  for (const s of suggestions) {
    const attentionId = await generateAttentionId(
      'list_suggestion',
      s.id,
      'decision_required',
      'suggestion_pending'
    )

    items.push({
      attention_id: attentionId,
      source_type: 'list_suggestion',
      source_id: s.id,
      source_url: `/list/${s.list_id}`,
      attention_type: 'decision_required',
      reason_code: 'suggestion_pending',
      reason_text: `Someone suggested ${s.suggestion_type === 'add' ? 'adding' : 'removing'} ${s.assets?.symbol || 'an asset'}`,
      title: `${s.suggestion_type === 'add' ? 'Add' : 'Remove'} ${s.assets?.symbol || ''}`,
      subtitle: s.asset_lists?.name,
      preview: s.notes?.substring(0, 150),
      tags: [s.suggestion_type],
      icon_key: 'ListPlus',
      audience: 'personal',
      primary_owner_user_id: userId,
      participant_user_ids: [s.suggested_by].filter(Boolean) as string[],
      created_by_user_id: s.suggested_by,
      last_actor_user_id: s.suggested_by,
      created_at: s.created_at,
      updated_at: s.created_at,
      last_activity_at: s.created_at,
      status: 'waiting',
      next_action: 'Accept or reject suggestion',
      severity: 'low',
      score: 0,
      context: {
        asset_id: s.asset_id,
        list_id: s.list_id,
      },
    })
  }

  return items
}

// Collect notifications
// Note: For unread notifications, we don't filter by time window since they're still actionable
async function collectNotifications(userId: string, _windowStart: Date): Promise<AttentionItem[]> {
  const items: AttentionItem[] = []

  const { data: notifications, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .eq('is_read', false)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error || !notifications) return items

  for (const n of notifications) {
    const attentionId = await generateAttentionId(
      'notification',
      n.id,
      'informational',
      n.type
    )

    let sourceUrl = '/'
    if (n.context_type === 'asset') sourceUrl = `/asset/${n.context_id}`
    else if (n.context_type === 'project') sourceUrl = `/project/${n.context_id}`
    else if (n.context_type === 'note') sourceUrl = `/note/${n.context_id}`
    else if (n.context_type === 'workflow') sourceUrl = `/workflows`

    items.push({
      attention_id: attentionId,
      source_type: 'notification',
      source_id: n.id,
      source_url: sourceUrl,
      attention_type: 'informational',
      reason_code: n.type,
      reason_text: n.message,
      title: n.title,
      preview: n.message?.substring(0, 150),
      tags: [n.type],
      icon_key: 'Bell',
      audience: 'personal',
      primary_owner_user_id: userId,
      participant_user_ids: [],
      created_by_user_id: n.context_data?.changed_by,
      last_actor_user_id: n.context_data?.changed_by,
      created_at: n.created_at,
      updated_at: n.created_at,
      last_activity_at: n.created_at,
      status: 'open',
      severity: 'low',
      score: 0,
      context: {
        asset_id: n.context_type === 'asset' ? n.context_id : null,
        project_id: n.context_type === 'project' ? n.context_id : null,
      },
    })
  }

  return items
}

// Collect quick thoughts that need attention
// Rules:
// 1. User's OWN items:
//    - Thesis mode → action_required (reminder to develop)
//    - Time hook set (revisit/alert/expiration) → action_required (reminder)
// 2. TEAMMATE items (for What's New):
//    - Shared AND relates to assets/projects/portfolios user works with → informational
async function collectQuickThoughts(userId: string, windowStart: Date): Promise<AttentionItem[]> {
  const items: AttentionItem[] = []

  // First, get user's own Thesis and time-hooked thoughts
  const { data: ownThoughts, error: ownError } = await supabase
    .from('quick_thoughts')
    .select(`
      *,
      assets (id, symbol, company_name),
      portfolios (id, name),
      projects (id, title)
    `)
    .eq('created_by', userId)
    .eq('is_archived', false)
    .or('idea_type.eq.thesis,date_type.neq.null')
    .gte('created_at', windowStart.toISOString())
    .order('created_at', { ascending: false })
    .limit(20)

  if (!ownError && ownThoughts) {
    for (const t of ownThoughts) {
      // Skip if no time hook trigger yet (for time-hooked items)
      if (t.date_type && t.date_type !== 'thesis') {
        const now = new Date()
        // For revisit/alert, check if the date has passed or is today
        if (t.date_type === 'revisit' || t.date_type === 'alert') {
          if (t.revisit_date) {
            const revisitDate = new Date(t.revisit_date)
            if (revisitDate > now) continue // Not yet time
          }
        }
        // For expiration, check if approaching (within 24h) or passed
        if (t.date_type === 'expiration' && t.expires_at) {
          const expiresAt = new Date(t.expires_at)
          const hoursUntilExpiry = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60)
          if (hoursUntilExpiry > 24) continue // Not yet urgent
        }
      }

      const reasonCode = t.idea_type === 'thesis'
        ? 'thesis_needs_development'
        : t.date_type === 'revisit'
        ? 'thought_revisit_due'
        : t.date_type === 'alert'
        ? 'thought_alert_triggered'
        : 'thought_expiring'

      const attentionId = await generateAttentionId(
        'quick_thought',
        t.id,
        'action_required',
        reasonCode
      )

      const contextLabel = t.assets?.symbol ||
        t.projects?.title ||
        t.portfolios?.name ||
        null

      const severity: AttentionSeverity = t.idea_type === 'thesis' ? 'medium' :
        t.date_type === 'expiration' ? 'high' :
        t.date_type === 'alert' ? 'medium' : 'low'

      items.push({
        attention_id: attentionId,
        source_type: 'quick_thought',
        source_id: t.id,
        source_url: '/ideas',
        attention_type: 'action_required',
        reason_code: reasonCode,
        reason_text: t.idea_type === 'thesis'
          ? 'Thesis needs development or follow-up'
          : t.date_type === 'revisit'
          ? 'Time to revisit this thought'
          : t.date_type === 'alert'
          ? 'Alert triggered for this thought'
          : 'This thought is expiring soon',
        title: t.content.substring(0, 80) + (t.content.length > 80 ? '...' : ''),
        subtitle: contextLabel,
        preview: t.content.substring(0, 150),
        tags: [t.idea_type, t.sentiment, ...(t.tags || [])].filter(Boolean) as string[],
        icon_key: t.idea_type === 'thesis' ? 'FileText' : 'Lightbulb',
        audience: 'personal',
        primary_owner_user_id: userId,
        participant_user_ids: [],
        created_by_user_id: userId,
        last_actor_user_id: userId,
        created_at: t.created_at,
        updated_at: t.updated_at,
        last_activity_at: t.updated_at,
        due_at: t.revisit_date || t.expires_at,
        status: 'open',
        next_action: t.idea_type === 'thesis'
          ? 'Review and develop this thesis'
          : 'Review this thought',
        severity,
        score: 0,
        context: {
          asset_id: t.asset_id,
          project_id: t.project_id,
          portfolio_id: t.portfolio_id,
        },
      })
    }
  }

  // Second, get shared thoughts from teammates that relate to user's context
  // First, find assets/projects/portfolios the user works with
  const { data: userAssets } = await supabase
    .from('portfolio_holdings')
    .select('asset_id, portfolios!inner(created_by)')
    .eq('portfolios.created_by', userId)

  const { data: userProjects } = await supabase
    .from('project_assignments')
    .select('project_id')
    .eq('assigned_to', userId)

  const { data: userPortfolios } = await supabase
    .from('portfolios')
    .select('id')
    .eq('created_by', userId)

  const assetIds = [...new Set(userAssets?.map(h => h.asset_id).filter(Boolean) || [])]
  const projectIds = [...new Set(userProjects?.map(p => p.project_id).filter(Boolean) || [])]
  const portfolioIds = [...new Set(userPortfolios?.map(p => p.id).filter(Boolean) || [])]

  // Only query for teammate thoughts if user has some context
  if (assetIds.length > 0 || projectIds.length > 0 || portfolioIds.length > 0) {
    // Build filter for shared thoughts from others that match user's context
    let query = supabase
      .from('quick_thoughts')
      .select(`
        *,
        assets (id, symbol, company_name),
        portfolios (id, name),
        projects (id, title)
      `)
      .neq('created_by', userId) // Not the user's own
      .eq('is_archived', false)
      .neq('visibility', 'private') // Must be shared
      .gte('created_at', windowStart.toISOString())
      .order('created_at', { ascending: false })
      .limit(20)

    // Filter to thoughts that match user's assets, projects, or portfolios
    const filters: string[] = []
    if (assetIds.length > 0) {
      filters.push(`asset_id.in.(${assetIds.join(',')})`)
    }
    if (projectIds.length > 0) {
      filters.push(`project_id.in.(${projectIds.join(',')})`)
    }
    if (portfolioIds.length > 0) {
      filters.push(`portfolio_id.in.(${portfolioIds.join(',')})`)
    }

    if (filters.length > 0) {
      query = query.or(filters.join(','))
    }

    const { data: teammateThoughts, error: teamError } = await query

    if (!teamError && teammateThoughts) {
      for (const t of teammateThoughts) {
        const attentionId = await generateAttentionId(
          'quick_thought',
          t.id,
          'informational',
          'teammate_shared_thought'
        )

        const contextLabel = t.assets?.symbol ||
          t.projects?.title ||
          t.portfolios?.name ||
          null

        items.push({
          attention_id: attentionId,
          source_type: 'quick_thought',
          source_id: t.id,
          source_url: '/ideas',
          attention_type: 'informational',
          reason_code: 'teammate_shared_thought',
          reason_text: `New ${t.idea_type === 'thesis' ? 'thesis' : 'thought'} shared${contextLabel ? ` on ${contextLabel}` : ''}`,
          title: t.content.substring(0, 80) + (t.content.length > 80 ? '...' : ''),
          subtitle: contextLabel,
          preview: t.content.substring(0, 150),
          tags: [t.idea_type, t.sentiment, ...(t.tags || [])].filter(Boolean) as string[],
          icon_key: t.idea_type === 'thesis' ? 'FileText' : 'Lightbulb',
          audience: 'shared',
          primary_owner_user_id: t.created_by,
          participant_user_ids: [],
          created_by_user_id: t.created_by,
          last_actor_user_id: t.created_by,
          created_at: t.created_at,
          updated_at: t.updated_at,
          last_activity_at: t.created_at,
          status: 'open',
          severity: 'low',
          score: 0,
          context: {
            asset_id: t.asset_id,
            project_id: t.project_id,
            portfolio_id: t.portfolio_id,
          },
        })
      }
    }
  }

  return items
}

// Collect project activity for alignment
async function collectAlignmentProjects(userId: string, windowStart: Date): Promise<AttentionItem[]> {
  const items: AttentionItem[] = []

  const { data: projects, error } = await supabase
    .from('projects')
    .select(`
      *,
      project_assignments (
        assigned_to,
        role
      )
    `)
    .in('status', ['planning', 'in_progress'])
    .gte('updated_at', windowStart.toISOString())
    .order('updated_at', { ascending: false })
    .limit(30)

  if (error || !projects) return items

  for (const p of projects) {
    const contributors = new Set([
      p.created_by,
      ...(p.project_assignments || []).map((a: any) => a.assigned_to)
    ].filter(Boolean))

    if (contributors.size < 2) continue

    const hasVisibility = contributors.has(userId)
    if (!hasVisibility) continue

    const attentionId = await generateAttentionId(
      'project',
      p.id,
      'alignment',
      'high_activity'
    )

    items.push({
      attention_id: attentionId,
      source_type: 'project',
      source_id: p.id,
      source_url: `/project/${p.id}`,
      attention_type: 'alignment',
      reason_code: 'high_activity',
      reason_text: `Recent activity from ${contributors.size} team members`,
      title: p.title,
      subtitle: `${contributors.size} contributors`,
      preview: p.description?.substring(0, 150),
      tags: [p.status, p.priority].filter(Boolean) as string[],
      icon_key: 'Users',
      audience: 'team',
      primary_owner_user_id: p.created_by,
      participant_user_ids: Array.from(contributors) as string[],
      created_by_user_id: p.created_by,
      last_actor_user_id: null,
      created_at: p.created_at,
      updated_at: p.updated_at,
      last_activity_at: p.updated_at,
      due_at: p.due_date,
      status: p.status === 'blocked' ? 'blocked' : 'in_progress',
      severity: p.priority === 'urgent' ? 'high' : p.priority === 'high' ? 'medium' : 'low',
      score: 0,
      context: {
        project_id: p.id,
      },
    })
  }

  return items
}

// Collect decision requests (PM inbox)
async function collectDecisionRequests(userId: string): Promise<AttentionItem[]> {
  const items: AttentionItem[] = []

  // Get portfolios where user is PM
  const { data: pmPortfolios } = await supabase
    .from('portfolio_team')
    .select('portfolio_id')
    .eq('user_id', userId)
    .in('role', ['pm', 'admin'])

  const pmIds = (pmPortfolios || []).map(p => p.portfolio_id)
  if (pmIds.length === 0) return items

  const { data: requests, error } = await supabase
    .from('decision_requests')
    .select(`
      id, status, context_note, created_at, updated_at, portfolio_id, urgency,
      requester:users!decision_requests_requested_by_fkey(first_name, last_name),
      portfolio:portfolios(name),
      trade_queue_item:trade_queue_items(id, action, assets(symbol))
    `)
    .in('portfolio_id', pmIds)
    .in('status', ['pending', 'under_review', 'needs_discussion'])
    .order('created_at', { ascending: true })
    .limit(20)

  if (error || !requests) return items

  for (const r of requests) {
    const asset = (r.trade_queue_item as any)?.assets
    const action = (r.trade_queue_item as any)?.action
    const req = r.requester as any
    const reqName = req?.first_name ? `${req.first_name} ${req.last_name?.[0] || ''}.`.trim() : 'Analyst'
    const daysSince = Math.max(0, Math.floor((Date.now() - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24)))

    const attentionId = await generateAttentionId('decision_request', r.id, 'decision_required', 'pm_decision_needed')

    const urgencyMap: Record<string, AttentionSeverity> = { critical: 'critical', high: 'high', medium: 'medium', low: 'low' }
    const severity: AttentionSeverity = daysSince > 14 ? 'critical' : urgencyMap[r.urgency] || (daysSince > 7 ? 'high' : 'medium')

    items.push({
      attention_id: attentionId,
      source_type: 'trade_queue_item',
      source_id: (r.trade_queue_item as any)?.id || r.id,
      source_url: '/trade-queue',
      attention_type: 'decision_required',
      reason_code: 'pm_decision_needed',
      reason_text: daysSince > 7
        ? `Decision waiting ${daysSince} days — from ${reqName}`
        : `${reqName} submitted a recommendation for your review`,
      title: `${action?.toUpperCase() || '?'} ${asset?.symbol || '?'}`,
      subtitle: (r.portfolio as any)?.name,
      preview: r.context_note?.substring(0, 150),
      tags: [action, r.urgency, 'decision'].filter(Boolean) as string[],
      icon_key: 'Scale',
      audience: 'personal',
      primary_owner_user_id: userId,
      participant_user_ids: [],
      created_by_user_id: null,
      last_actor_user_id: null,
      created_at: r.created_at,
      updated_at: r.updated_at || r.created_at,
      last_activity_at: r.updated_at || r.created_at,
      due_at: null,
      status: 'waiting',
      next_action: 'Review and decide: Accept, Reject, or Defer',
      severity,
      score: 0,
      context: { asset_id: null, portfolio_id: r.portfolio_id },
    })
  }
  return items
}

// Collect stale trade ideas (user created, no update in 7+ days)
async function collectStaleTradeIdeas(userId: string): Promise<AttentionItem[]> {
  const items: AttentionItem[] = []
  const staleThreshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const { data: ideas, error } = await supabase
    .from('trade_queue_items')
    .select('id, action, status, stage, urgency, created_at, updated_at, assets!inner(id, symbol, company_name), portfolios(name)')
    .eq('created_by', userId)
    .not('status', 'in', '("approved","rejected","executed","deleted","cancelled")')
    .lt('updated_at', staleThreshold.toISOString())
    .order('updated_at', { ascending: true })
    .limit(20)

  if (error || !ideas) return items

  for (const t of ideas) {
    const daysSince = Math.max(0, Math.floor((Date.now() - new Date(t.updated_at || t.created_at).getTime()) / (1000 * 60 * 60 * 24)))
    const asset = t.assets as any

    const attentionId = await generateAttentionId('trade_queue_item', t.id, 'action_required', 'idea_stale')

    items.push({
      attention_id: attentionId,
      source_type: 'trade_queue_item',
      source_id: t.id,
      source_url: '/trade-queue',
      attention_type: 'action_required',
      reason_code: 'idea_stale',
      reason_text: `No updates in ${daysSince} days — advance, archive, or update`,
      title: `${t.action?.toUpperCase()} ${asset?.symbol}`,
      subtitle: (t.portfolios as any)?.name || t.stage || t.status,
      tags: [t.action, t.stage, 'stale'].filter(Boolean) as string[],
      icon_key: 'TrendingUp',
      audience: 'personal',
      primary_owner_user_id: userId,
      participant_user_ids: [],
      created_by_user_id: userId,
      last_actor_user_id: userId,
      created_at: t.created_at,
      updated_at: t.updated_at,
      last_activity_at: t.updated_at || t.created_at,
      due_at: null,
      status: 'stale',
      next_action: 'Review: advance stage, update thesis, or archive',
      severity: daysSince > 14 ? 'high' : 'medium',
      score: 0,
      context: { asset_id: asset?.id },
    })
  }
  return items
}

// Collect neglected covered assets (assets user covers with no thesis/rating/contribution updates)
async function collectNeglectedCoverage(userId: string): Promise<AttentionItem[]> {
  const items: AttentionItem[] = []

  // Get assets user covers
  const { data: coverage, error: covErr } = await supabase
    .from('coverage')
    .select('asset_id, updated_at, assets!inner(id, symbol, company_name)')
    .eq('user_id', userId)
    .eq('is_active', true)

  if (covErr || !coverage || coverage.length === 0) return items

  // Get latest contribution per asset
  const assetIds = coverage.map(c => c.asset_id)
  const { data: contributions } = await supabase
    .from('asset_contributions')
    .select('asset_id, updated_at')
    .eq('created_by', userId)
    .in('asset_id', assetIds)
    .order('updated_at', { ascending: false })

  // Build map of most recent contribution per asset
  const latestUpdate = new Map<string, string>()
  for (const c of contributions || []) {
    if (!latestUpdate.has(c.asset_id)) latestUpdate.set(c.asset_id, c.updated_at)
  }

  const staleThresholdDays = 21 // 3 weeks without research update
  const now = Date.now()

  for (const c of coverage) {
    const lastUpdate = latestUpdate.get(c.asset_id)
    const lastDate = lastUpdate ? new Date(lastUpdate) : new Date(c.updated_at)
    const daysSince = Math.floor((now - lastDate.getTime()) / (1000 * 60 * 60 * 24))

    if (daysSince < staleThresholdDays) continue

    const asset = c.assets as any
    const attentionId = await generateAttentionId('coverage', c.asset_id, 'action_required', 'coverage_neglected')

    items.push({
      attention_id: attentionId,
      source_type: 'coverage_change',
      source_id: c.asset_id,
      source_url: `/asset/${c.asset_id}`,
      attention_type: 'action_required',
      reason_code: 'coverage_neglected',
      reason_text: lastUpdate
        ? `No research update in ${daysSince} days — thesis may be stale`
        : `Covering ${asset?.symbol} but no thesis or research on file`,
      title: `${asset?.symbol} — Research stale`,
      subtitle: asset?.company_name,
      tags: ['coverage', 'stale'],
      icon_key: 'TrendingUp',
      audience: 'personal',
      primary_owner_user_id: userId,
      participant_user_ids: [],
      created_by_user_id: userId,
      last_actor_user_id: userId,
      created_at: c.updated_at,
      updated_at: lastDate.toISOString(),
      last_activity_at: lastDate.toISOString(),
      due_at: null,
      status: 'stale',
      next_action: 'Update thesis, rating, or research for this covered name',
      severity: daysSince > 30 ? 'high' : 'medium',
      score: 0,
      context: { asset_id: c.asset_id },
    })
  }
  return items
}

// Collect upcoming earnings for covered assets
async function collectUpcomingEarnings(userId: string): Promise<AttentionItem[]> {
  const items: AttentionItem[] = []

  const { data: coverage } = await supabase
    .from('coverage')
    .select('asset_id')
    .eq('user_id', userId)
    .eq('is_active', true)

  const coveredIds = (coverage || []).map(c => c.asset_id)
  if (coveredIds.length === 0) return items

  const { data: earnings, error } = await supabase
    .from('asset_earnings_dates')
    .select('id, earnings_date, is_estimated, assets!inner(id, symbol, company_name)')
    .in('asset_id', coveredIds)
    .gte('earnings_date', new Date().toISOString().split('T')[0])
    .order('earnings_date', { ascending: true })
    .limit(10)

  if (error || !earnings) return items

  for (const e of earnings) {
    const asset = e.assets as any
    const daysUntil = Math.ceil((new Date(e.earnings_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    if (daysUntil > 14) continue // Only show within 2 weeks

    const attentionId = await generateAttentionId('earnings', e.id, 'informational', 'earnings_upcoming')

    items.push({
      attention_id: attentionId,
      source_type: 'coverage_change',
      source_id: e.id,
      source_url: `/asset/${asset?.id}`,
      attention_type: 'informational',
      reason_code: 'earnings_upcoming',
      reason_text: daysUntil <= 1 ? `${asset?.symbol} reports earnings tomorrow` : `${asset?.symbol} earnings in ${daysUntil} days — ensure thesis is current`,
      title: `${asset?.symbol} Earnings`,
      subtitle: e.is_estimated ? 'Estimated date' : 'Confirmed',
      tags: ['earnings', daysUntil <= 7 ? 'this_week' : 'upcoming'],
      icon_key: 'TrendingUp',
      audience: 'personal',
      primary_owner_user_id: userId,
      participant_user_ids: [],
      created_by_user_id: null,
      last_actor_user_id: null,
      created_at: e.earnings_date,
      updated_at: e.earnings_date,
      last_activity_at: e.earnings_date,
      due_at: e.earnings_date,
      status: 'open',
      next_action: 'Review thesis and positioning before results',
      severity: daysUntil <= 3 ? 'high' : daysUntil <= 7 ? 'medium' : 'low',
      score: 0,
      context: { asset_id: asset?.id },
    })
  }
  return items
}

// Collect overdue personal tasks
async function collectOverduePersonalTasks(userId: string): Promise<AttentionItem[]> {
  const items: AttentionItem[] = []

  const { data: tasks, error } = await supabase
    .from('personal_tasks')
    .select('id, title, description, priority, due_date, created_at')
    .eq('user_id', userId)
    .eq('completed', false)
    .not('due_date', 'is', null)
    .lt('due_date', new Date().toISOString().split('T')[0])
    .order('due_date', { ascending: true })
    .limit(10)

  if (error || !tasks) return items

  for (const t of tasks) {
    const daysOver = Math.floor((Date.now() - new Date(t.due_date).getTime()) / (1000 * 60 * 60 * 24))
    const attentionId = await generateAttentionId('personal_task', t.id, 'action_required', 'task_overdue')

    items.push({
      attention_id: attentionId,
      source_type: 'task',
      source_id: t.id,
      source_url: '/priorities',
      attention_type: 'action_required',
      reason_code: 'task_overdue',
      reason_text: `${daysOver} day${daysOver !== 1 ? 's' : ''} overdue`,
      title: t.title,
      preview: t.description?.substring(0, 150),
      tags: ['overdue', t.priority].filter(Boolean) as string[],
      icon_key: 'CheckSquare',
      audience: 'personal',
      primary_owner_user_id: userId,
      participant_user_ids: [],
      created_by_user_id: userId,
      last_actor_user_id: userId,
      created_at: t.created_at,
      updated_at: t.created_at,
      last_activity_at: t.created_at,
      due_at: t.due_date,
      status: 'overdue',
      next_action: 'Complete, reschedule, or remove',
      severity: daysOver > 7 ? 'high' : 'medium',
      score: 0,
    })
  }
  return items
}

// Collect stale projects (not blocked, but no updates in 14+ days)
async function collectStaleProjects(userId: string): Promise<AttentionItem[]> {
  const items: AttentionItem[] = []
  const staleThreshold = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)

  const { data: assignments } = await supabase
    .from('project_assignments')
    .select('project_id')
    .eq('assigned_to', userId)

  const assignedIds = (assignments || []).map(a => a.project_id)

  const { data: projects, error } = await supabase
    .from('projects')
    .select('id, title, status, priority, due_date, created_by, updated_at, created_at')
    .is('deleted_at', null)
    .in('status', ['planning', 'in_progress', 'review'])
    .lt('updated_at', staleThreshold.toISOString())
    .limit(15)

  if (error || !projects) return items

  const relevant = projects.filter(p => p.created_by === userId || assignedIds.includes(p.id))

  for (const p of relevant) {
    const daysSince = Math.floor((Date.now() - new Date(p.updated_at || p.created_at).getTime()) / (1000 * 60 * 60 * 24))

    const attentionId = await generateAttentionId('project', p.id, 'action_required', 'project_stale')

    items.push({
      attention_id: attentionId,
      source_type: 'project',
      source_id: p.id,
      source_url: `/project/${p.id}`,
      attention_type: 'action_required',
      reason_code: 'project_stale',
      reason_text: `No updates in ${daysSince} days`,
      title: p.title,
      subtitle: `${p.status?.replace('_', ' ')} · stale`,
      tags: [p.status, 'stale'].filter(Boolean) as string[],
      icon_key: 'FolderKanban',
      audience: 'personal',
      primary_owner_user_id: p.created_by,
      participant_user_ids: [],
      created_by_user_id: p.created_by,
      last_actor_user_id: null,
      created_at: p.created_at,
      updated_at: p.updated_at,
      last_activity_at: p.updated_at || p.created_at,
      due_at: p.due_date,
      status: 'stale',
      next_action: 'Update progress or close if no longer relevant',
      severity: daysSince > 30 ? 'high' : 'medium',
      score: 0,
      context: { project_id: p.id },
    })
  }
  return items
}

// Main computation function
async function computeAttention(userId: string, windowHours: number): Promise<AttentionResponse> {
  const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000)

  // Fetch user's attention state
  const { data: userStates } = await supabase
    .from('attention_user_state')
    .select('attention_id, read_state, last_viewed_at, snoozed_until, dismissed_at')
    .eq('user_id', userId)

  const stateMap = new Map<string, any>()
  for (const s of userStates || []) {
    stateMap.set(s.attention_id, s)
  }

  // Collect items from all sources
  const [
    deliverables, projects, tradeItems, suggestions, notifications,
    alignmentProjects, quickThoughts,
    decisionRequests, staleIdeas, neglectedCoverage,
    upcomingEarnings, overduePersonalTasks, staleProjects,
  ] = await Promise.all([
    collectProjectDeliverables(userId),
    collectProjects(userId),
    collectTradeQueueItems(userId),
    collectListSuggestions(userId),
    collectNotifications(userId, windowStart),
    collectAlignmentProjects(userId, windowStart),
    collectQuickThoughts(userId, windowStart),
    collectDecisionRequests(userId),
    collectStaleTradeIdeas(userId),
    collectNeglectedCoverage(userId),
    collectUpcomingEarnings(userId),
    collectOverduePersonalTasks(userId),
    collectStaleProjects(userId),
  ])

  let allItems: AttentionItem[] = [
    ...deliverables,
    ...projects,
    ...tradeItems,
    ...suggestions,
    ...notifications,
    ...alignmentProjects,
    ...quickThoughts,
    ...decisionRequests,
    ...staleIdeas,
    ...neglectedCoverage,
    ...upcomingEarnings,
    ...overduePersonalTasks,
    ...staleProjects,
  ]

  // Filter dismissed/snoozed
  const now = new Date()
  allItems = allItems.filter(item => {
    const state = stateMap.get(item.attention_id)
    if (!state) return true
    if (state.dismissed_at) return false
    if (state.snoozed_until && new Date(state.snoozed_until) > now) return false
    return true
  })

  // Merge user state
  allItems = allItems.map(item => {
    const state = stateMap.get(item.attention_id)
    if (state) {
      return {
        ...item,
        read_state: state.read_state,
        last_viewed_at: state.last_viewed_at,
        snoozed_until: state.snoozed_until,
      }
    }
    return item
  })

  // Calculate scores
  allItems = allItems.map(item => {
    const { score, breakdown } = calculateScore(item, userId)
    return { ...item, score, score_breakdown: breakdown }
  })

  // De-duplicate
  const sourceKeyMap = new Map<string, AttentionItem>()
  for (const item of allItems) {
    const sourceKey = `${item.source_type}:${item.source_id}`
    const existing = sourceKeyMap.get(sourceKey)

    if (!existing) {
      sourceKeyMap.set(sourceKey, item)
    } else {
      const existingPriority = ATTENTION_TYPE_PRIORITY[existing.attention_type]
      const newPriority = ATTENTION_TYPE_PRIORITY[item.attention_type]

      if (newPriority > existingPriority || (newPriority === existingPriority && item.score > existing.score)) {
        sourceKeyMap.set(sourceKey, item)
      }
    }
  }

  const deduplicatedItems = Array.from(sourceKeyMap.values())

  // Split into sections
  const sections: Record<AttentionType, AttentionItem[]> = {
    informational: [],
    action_required: [],
    decision_required: [],
    alignment: [],
  }

  for (const item of deduplicatedItems) {
    sections[item.attention_type].push(item)
  }

  // Sort by score
  for (const type of Object.keys(sections) as AttentionType[]) {
    sections[type].sort((a, b) => b.score - a.score)
  }

  return {
    generated_at: new Date().toISOString(),
    window_start: windowStart.toISOString(),
    window_hours: windowHours,
    sections,
    counts: {
      informational: sections.informational.length,
      action_required: sections.action_required.length,
      decision_required: sections.decision_required.length,
      alignment: sections.alignment.length,
      total: deduplicatedItems.length,
    },
  }
}

export function useAttention(options: UseAttentionOptions = {}) {
  const { windowHours = 24, enabled = true, refetchInterval = 60000 } = options
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['attention', user?.id, windowHours],
    queryFn: async (): Promise<AttentionResponse> => {
      if (!user?.id) {
        throw new Error('User not authenticated')
      }
      return computeAttention(user.id, windowHours)
    },
    enabled: enabled && !!user?.id,
    staleTime: 30000,
    refetchInterval: refetchInterval,
    refetchOnWindowFocus: true,
    retry: 2,
  })

  // Acknowledge mutation
  const acknowledgeMutation = useMutation({
    mutationFn: async (attentionId: string) => {
      const { error } = await supabase.rpc('acknowledge_attention', { p_attention_id: attentionId })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attention'] })
    },
  })

  // Snooze mutation
  const snoozeMutation = useMutation({
    mutationFn: async ({ attentionId, until }: { attentionId: string; until: Date | string }) => {
      const snoozedUntil = typeof until === 'string' ? until : until.toISOString()
      const { error } = await supabase.rpc('snooze_attention', {
        p_attention_id: attentionId,
        p_until: snoozedUntil,
      })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attention'] })
    },
  })

  // Dismiss mutation (simple)
  const dismissMutation = useMutation({
    mutationFn: async (attentionId: string) => {
      const { error } = await supabase.rpc('dismiss_attention', { p_attention_id: attentionId })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attention'] })
    },
  })

  // Dismiss with reason mutation (for "Not relevant..." flow)
  const dismissWithReasonMutation = useMutation({
    mutationFn: async ({ attentionId, reason, note }: {
      attentionId: string
      reason: 'duplicate' | 'incorrect_signal' | 'not_my_responsibility' | 'no_longer_relevant'
      note?: string
    }) => {
      const { error } = await supabase.rpc('dismiss_attention_with_reason', {
        p_attention_id: attentionId,
        p_reason: reason,
        p_note: note || null
      })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attention'] })
    },
  })

  // Mark read mutation
  const markReadMutation = useMutation({
    mutationFn: async (attentionId: string) => {
      const { error } = await supabase.rpc('mark_attention_read', { p_attention_id: attentionId })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attention'] })
    },
  })

  // ===== Resolution Actions =====

  // Mark deliverable as done
  const markDeliverableDoneMutation = useMutation({
    mutationFn: async (deliverableId: string) => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { error } = await supabase
        .from('project_deliverables')
        .update({
          completed: true,
          completed_at: new Date().toISOString(),
          completed_by: user.id,
        })
        .eq('id', deliverableId)

      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attention'] })
      queryClient.invalidateQueries({ queryKey: ['project'] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['project-deliverables'] })
    },
  })

  // Approve trade idea
  const approveTradeIdeaMutation = useMutation({
    mutationFn: async (tradeId: string) => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { error } = await supabase
        .from('trade_queue_items')
        .update({
          status: 'approved',
          approved_by: user.id,
          approved_at: new Date().toISOString(),
        })
        .eq('id', tradeId)

      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attention'] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      queryClient.invalidateQueries({ queryKey: ['trade-ideas-feed'] })
    },
  })

  // Reject trade idea
  const rejectTradeIdeaMutation = useMutation({
    mutationFn: async (tradeId: string) => {
      const { error } = await supabase
        .from('trade_queue_items')
        .update({
          status: 'rejected',
        })
        .eq('id', tradeId)

      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attention'] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      queryClient.invalidateQueries({ queryKey: ['trade-ideas-feed'] })
    },
  })

  // Defer trade idea (snooze via revisit_at)
  const deferTradeIdeaMutation = useMutation({
    mutationFn: async ({ tradeId, hours }: { tradeId: string; hours: number }) => {
      const revisitAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()

      const { error } = await supabase
        .from('trade_queue_items')
        .update({
          revisit_at: revisitAt,
        })
        .eq('id', tradeId)

      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attention'] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
    },
  })

  const acknowledge = (attentionId: string, options?: AttentionMutationOptions) => {
    return acknowledgeMutation.mutateAsync(attentionId, options)
  }

  const snooze = (attentionId: string, until: Date | string, options?: AttentionMutationOptions) => {
    return snoozeMutation.mutateAsync({ attentionId, until }, options)
  }

  const snoozeFor = (attentionId: string, hours: number, options?: AttentionMutationOptions) => {
    const until = new Date(Date.now() + hours * 60 * 60 * 1000)
    return snooze(attentionId, until, options)
  }

  const dismiss = (attentionId: string, options?: AttentionMutationOptions) => {
    return dismissMutation.mutateAsync(attentionId, options)
  }

  const dismissWithReason = (
    attentionId: string,
    reason: 'duplicate' | 'incorrect_signal' | 'not_my_responsibility' | 'no_longer_relevant',
    note?: string,
    options?: AttentionMutationOptions
  ) => {
    return dismissWithReasonMutation.mutateAsync({ attentionId, reason, note }, options)
  }

  const markRead = (attentionId: string, options?: AttentionMutationOptions) => {
    return markReadMutation.mutateAsync(attentionId, options)
  }

  // Resolution action wrappers
  const markDeliverableDone = (deliverableId: string) => {
    return markDeliverableDoneMutation.mutateAsync(deliverableId)
  }

  const approveTradeIdea = (tradeId: string) => {
    return approveTradeIdeaMutation.mutateAsync(tradeId)
  }

  const rejectTradeIdea = (tradeId: string) => {
    return rejectTradeIdeaMutation.mutateAsync(tradeId)
  }

  const deferTradeIdea = (tradeId: string, hours: number) => {
    return deferTradeIdeaMutation.mutateAsync({ tradeId, hours })
  }

  const sections = data?.sections || {
    informational: [],
    action_required: [],
    decision_required: [],
    alignment: [],
  }

  const counts = data?.counts || {
    informational: 0,
    action_required: 0,
    decision_required: 0,
    alignment: 0,
    total: 0,
  }

  const hasUrgentItems = [
    ...sections.action_required,
    ...sections.decision_required,
  ].some(item => item.severity === 'critical' || item.severity === 'high')

  const getSection = (type: AttentionType): AttentionItem[] => sections[type] || []

  const getTopItems = (type: AttentionType, n: number = 5): AttentionItem[] => getSection(type).slice(0, n)

  const hasItems = counts.total > 0

  const hasSectionItems = (type: AttentionType): boolean => (counts[type] || 0) > 0

  return {
    sections,
    counts,
    generatedAt: data?.generated_at,
    windowStart: data?.window_start,
    isLoading,
    isFetching,
    isError,
    error,
    acknowledge,
    snooze,
    snoozeFor,
    dismiss,
    dismissWithReason,
    markRead,
    refetch,
    isAcknowledging: acknowledgeMutation.isPending,
    isSnoozing: snoozeMutation.isPending,
    isDismissing: dismissMutation.isPending,
    isDismissingWithReason: dismissWithReasonMutation.isPending,
    isMarkingRead: markReadMutation.isPending,
    // Resolution actions
    markDeliverableDone,
    approveTradeIdea,
    rejectTradeIdea,
    deferTradeIdea,
    isMarkingDone: markDeliverableDoneMutation.isPending,
    isApprovingTrade: approveTradeIdeaMutation.isPending,
    isRejectingTrade: rejectTradeIdeaMutation.isPending,
    isDeferringTrade: deferTradeIdeaMutation.isPending,
    getSection,
    getTopItems,
    hasItems,
    hasSectionItems,
    hasUrgentItems,
  }
}

export function useAttentionCounts(options: { enabled?: boolean } = {}) {
  const { enabled = true } = options
  const { user } = useAuth()

  const { data } = useQuery({
    queryKey: ['attention-counts', user?.id],
    queryFn: async () => {
      if (!user?.id) return null
      const result = await computeAttention(user.id, 24)
      return result?.counts || null
    },
    enabled: enabled && !!user?.id,
    staleTime: 60000,
    refetchInterval: 120000,
  })

  return {
    counts: data,
    totalCount: data?.total || 0,
    actionCount: data?.action_required || 0,
    decisionCount: data?.decision_required || 0,
  }
}

export default useAttention
