/**
 * Attention Edge Function
 *
 * Provides the backbone for the "10-minute screen" by:
 * 1. Computing AttentionItems from various data sources
 * 2. Applying scoring and de-duplication
 * 3. Returning 4 categorized sections
 *
 * Endpoints:
 * - GET /attention?window_hours=24 - Get all attention items
 * - POST /attention/ack - Acknowledge an item
 * - POST /attention/snooze - Snooze an item until a timestamp
 * - POST /attention/dismiss - Dismiss an item
 * - POST /attention/mark-read - Mark an item as read
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ============================================================================
// CORS Headers
// ============================================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ============================================================================
// Types
// ============================================================================

type AttentionSourceType =
  | 'task' | 'workflow_item' | 'project' | 'project_deliverable'
  | 'decision' | 'idea' | 'note' | 'message' | 'asset_event'
  | 'coverage_change' | 'file' | 'trade_queue_item' | 'list_suggestion'
  | 'notification' | 'custom'

type AttentionType = 'informational' | 'action_required' | 'decision_required' | 'alignment'
type AttentionAudience = 'personal' | 'shared' | 'team'
type AttentionStatus = 'open' | 'in_progress' | 'blocked' | 'waiting' | 'resolved' | 'dismissed'
type AttentionSeverity = 'low' | 'medium' | 'high' | 'critical'
type AttentionReadState = 'unread' | 'read' | 'acknowledged'

interface ScoreBreakdown {
  key: string
  value: number
}

interface AttentionItem {
  attention_id: string
  source_type: AttentionSourceType
  source_id: string
  source_url: string
  attention_type: AttentionType
  reason_code: string
  reason_text: string
  title: string
  subtitle?: string
  preview?: string
  tags: string[]
  icon_key: string
  audience: AttentionAudience
  primary_owner_user_id?: string | null
  participant_user_ids: string[]
  created_by_user_id?: string | null
  last_actor_user_id?: string | null
  created_at: string
  updated_at: string
  last_activity_at: string
  due_at?: string | null
  snoozed_until?: string | null
  read_state?: AttentionReadState
  last_viewed_at?: string | null
  status: AttentionStatus
  blocker_reason?: string | null
  next_action?: string | null
  resolution?: string | null
  resolution_note?: string | null
  resolution_at?: string | null
  severity: AttentionSeverity
  score: number
  score_breakdown?: ScoreBreakdown[]
  context: {
    asset_id?: string | null
    portfolio_id?: string | null
    theme_id?: string | null
    project_id?: string | null
    list_id?: string | null
    workflow_id?: string | null
    context_refs?: { type: string; id: string }[]
  }
}

interface AttentionUserState {
  attention_id: string
  read_state: AttentionReadState
  last_viewed_at: string | null
  snoozed_until: string | null
  dismissed_at: string | null
}

// ============================================================================
// Scoring Weights (Tunable)
// ============================================================================

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

// Priority for de-duplication (higher = wins)
const ATTENTION_TYPE_PRIORITY: Record<AttentionType, number> = {
  decision_required: 4,
  action_required: 3,
  informational: 2,
  alignment: 1,
}

// ============================================================================
// Utility Functions
// ============================================================================

// Generate deterministic attention_id using Web Crypto API
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

  // Base score from severity
  const severityMultiplier = WEIGHTS.severity_multipliers[item.severity] || 1.0
  score += 10 * severityMultiplier
  breakdown.push({ key: 'severity', value: 10 * severityMultiplier })

  // Urgency: overdue or due soon
  if (item.due_at) {
    const dueDate = new Date(item.due_at)
    const now = new Date()
    const daysUntilDue = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)

    if (daysUntilDue < 0) {
      // Overdue
      const overdueDays = Math.abs(Math.floor(daysUntilDue))
      const overdueScore = overdueDays * WEIGHTS.overdue_days_multiplier
      score += overdueScore
      breakdown.push({ key: 'overdue', value: overdueScore })
    } else if (daysUntilDue <= WEIGHTS.due_soon_days_threshold) {
      // Due soon
      score += WEIGHTS.due_soon_bonus
      breakdown.push({ key: 'due_soon', value: WEIGHTS.due_soon_bonus })
    }
  }

  // Ownership bonus
  if (item.primary_owner_user_id === userId) {
    score += WEIGHTS.owner_bonus
    breakdown.push({ key: 'owner', value: WEIGHTS.owner_bonus })
  } else if (item.participant_user_ids.includes(userId)) {
    score += WEIGHTS.assigned_bonus
    breakdown.push({ key: 'assigned', value: WEIGHTS.assigned_bonus })
  }

  // Attention type bonus
  if (item.attention_type === 'decision_required') {
    score += WEIGHTS.decision_required_bonus
    breakdown.push({ key: 'decision_type', value: WEIGHTS.decision_required_bonus })
  } else if (item.attention_type === 'action_required') {
    score += WEIGHTS.action_required_bonus
    breakdown.push({ key: 'action_type', value: WEIGHTS.action_required_bonus })
  }

  // Blocking bonus
  if (item.status === 'blocked' || item.blocker_reason) {
    score += WEIGHTS.blocking_bonus
    breakdown.push({ key: 'blocking', value: WEIGHTS.blocking_bonus })
  }

  // Recent activity bonus/penalty
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

// ============================================================================
// Data Source Collectors
// ============================================================================

// Collect action items from project deliverables assigned to user
async function collectProjectDeliverables(
  supabase: any,
  userId: string,
  windowStart: Date
): Promise<AttentionItem[]> {
  const items: AttentionItem[] = []

  // Get deliverables assigned to user that are not completed
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
        context_id
      ),
      deliverable_assignments!left (
        user_id
      )
    `)
    .eq('completed', false)
    .or(`assigned_to.eq.${userId},deliverable_assignments.user_id.eq.${userId}`)

  if (error) {
    console.error('Error fetching deliverables:', error)
    return items
  }

  for (const d of deliverables || []) {
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
      tags: [d.projects?.status, d.projects?.priority].filter(Boolean),
      icon_key: 'ListTodo',
      audience: 'personal',
      primary_owner_user_id: d.assigned_to || userId,
      participant_user_ids: [d.assigned_to, ...(d.deliverable_assignments?.map((a: any) => a.user_id) || [])].filter(Boolean),
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

// Collect action items from projects user owns/is assigned to
async function collectProjects(
  supabase: any,
  userId: string,
  windowStart: Date
): Promise<AttentionItem[]> {
  const items: AttentionItem[] = []

  // Get active projects user is involved with
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
    .or(`created_by.eq.${userId},project_assignments.assigned_to.eq.${userId}`)

  if (error) {
    console.error('Error fetching projects:', error)
    return items
  }

  for (const p of projects || []) {
    // Only create action items for blocked projects or those with due dates
    const isBlocked = p.status === 'blocked'
    const isOverdue = p.due_date && new Date(p.due_date) < new Date()
    const isDueSoon = p.due_date &&
      (new Date(p.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24) <= 7

    if (!isBlocked && !isOverdue && !isDueSoon) continue

    const attentionType: AttentionType = isBlocked ? 'action_required' : 'action_required'
    const reasonCode = isBlocked ? 'project_blocked' : isOverdue ? 'project_overdue' : 'project_due_soon'

    const attentionId = await generateAttentionId(
      'project',
      p.id,
      attentionType,
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
      attention_type: attentionType,
      reason_code: reasonCode,
      reason_text: isBlocked
        ? `Project is blocked: ${p.blocked_reason || 'needs attention'}`
        : isOverdue
        ? `Project is overdue`
        : `Project is due soon`,
      title: p.title,
      subtitle: p.context_type ? `${p.context_type} project` : undefined,
      preview: p.description?.substring(0, 150),
      tags: [p.status, p.priority].filter(Boolean),
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

// Collect decision items from trade queue
async function collectTradeQueueItems(
  supabase: any,
  userId: string,
  windowStart: Date
): Promise<AttentionItem[]> {
  const items: AttentionItem[] = []

  // Get trade queue items pending approval where user hasn't voted
  const { data: trades, error } = await supabase
    .from('trade_queue_items')
    .select(`
      *,
      assets!inner (
        id,
        symbol,
        company_name
      ),
      portfolios!inner (
        id,
        name
      ),
      trade_queue_votes!left (
        user_id,
        vote
      )
    `)
    .in('status', ['pending', 'discussing'])
    .or(`visibility.eq.public,visibility.is.null,created_by.eq.${userId}`)

  if (error) {
    console.error('Error fetching trade queue:', error)
    return items
  }

  for (const t of trades || []) {
    // Check if user has already voted
    const userVote = t.trade_queue_votes?.find((v: any) => v.user_id === userId)
    if (userVote) continue  // Already voted, skip

    const attentionId = await generateAttentionId(
      'trade_queue_item',
      t.id,
      'decision_required',
      'trade_vote_needed'
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
      reason_code: 'trade_vote_needed',
      reason_text: `Trade idea for ${t.assets?.symbol} needs your vote`,
      title: `${t.action?.toUpperCase()} ${t.assets?.symbol}`,
      subtitle: t.portfolios?.name,
      preview: t.rationale?.substring(0, 150),
      tags: [t.action, t.urgency].filter(Boolean),
      icon_key: 'ArrowLeftRight',
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
      next_action: 'Cast your vote',
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

// Collect decision items from list suggestions
async function collectListSuggestions(
  supabase: any,
  userId: string,
  windowStart: Date
): Promise<AttentionItem[]> {
  const items: AttentionItem[] = []

  // Get pending suggestions targeted at user
  const { data: suggestions, error } = await supabase
    .from('asset_list_suggestions')
    .select(`
      *,
      asset_lists!inner (
        id,
        name
      ),
      assets!inner (
        id,
        symbol,
        company_name
      ),
      suggested_by_user:users!asset_list_suggestions_suggested_by_fkey (
        first_name,
        last_name,
        email
      )
    `)
    .eq('target_user_id', userId)
    .eq('status', 'pending')

  if (error) {
    console.error('Error fetching list suggestions:', error)
    return items
  }

  for (const s of suggestions || []) {
    const attentionId = await generateAttentionId(
      'list_suggestion',
      s.id,
      'decision_required',
      'suggestion_pending'
    )

    const suggestedByName = s.suggested_by_user?.first_name
      ? `${s.suggested_by_user.first_name} ${s.suggested_by_user.last_name || ''}`.trim()
      : s.suggested_by_user?.email || 'Someone'

    items.push({
      attention_id: attentionId,
      source_type: 'list_suggestion',
      source_id: s.id,
      source_url: `/list/${s.list_id}`,
      attention_type: 'decision_required',
      reason_code: 'suggestion_pending',
      reason_text: `${suggestedByName} suggested ${s.suggestion_type === 'add' ? 'adding' : 'removing'} ${s.assets?.symbol}`,
      title: `${s.suggestion_type === 'add' ? 'Add' : 'Remove'} ${s.assets?.symbol}`,
      subtitle: s.asset_lists?.name,
      preview: s.notes?.substring(0, 150),
      tags: [s.suggestion_type],
      icon_key: 'ListPlus',
      audience: 'personal',
      primary_owner_user_id: userId,
      participant_user_ids: [s.suggested_by],
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

// Collect informational items from notifications
async function collectNotifications(
  supabase: any,
  userId: string,
  windowStart: Date
): Promise<AttentionItem[]> {
  const items: AttentionItem[] = []

  // Get recent unread notifications
  const { data: notifications, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .eq('is_read', false)
    .gte('created_at', windowStart.toISOString())
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    console.error('Error fetching notifications:', error)
    return items
  }

  for (const n of notifications || []) {
    const attentionId = await generateAttentionId(
      'notification',
      n.id,
      'informational',
      n.type
    )

    // Map notification type to source URL
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

// Collect informational items from project activity
async function collectProjectActivity(
  supabase: any,
  userId: string,
  windowStart: Date
): Promise<AttentionItem[]> {
  const items: AttentionItem[] = []

  // Get recent project activity for projects user is involved with
  const { data: activities, error } = await supabase
    .from('project_activity')
    .select(`
      *,
      projects!inner (
        id,
        title,
        created_by,
        project_assignments!left (
          assigned_to
        )
      ),
      actor:users!project_activity_actor_id_fkey (
        first_name,
        last_name,
        email
      )
    `)
    .gte('created_at', windowStart.toISOString())
    .neq('actor_id', userId)  // Exclude own activity
    .order('created_at', { ascending: false })
    .limit(30)

  if (error) {
    console.error('Error fetching project activity:', error)
    return items
  }

  // Filter to only include projects user has access to
  const userActivities = (activities || []).filter((a: any) => {
    const isCreator = a.projects?.created_by === userId
    const isAssigned = a.projects?.project_assignments?.some(
      (pa: any) => pa.assigned_to === userId
    )
    return isCreator || isAssigned
  })

  for (const a of userActivities) {
    const attentionId = await generateAttentionId(
      'project',
      a.id,
      'informational',
      a.activity_type
    )

    const actorName = a.actor?.first_name
      ? `${a.actor.first_name} ${a.actor.last_name || ''}`.trim()
      : 'Someone'

    // Generate human-readable activity message
    const activityMessages: Record<string, string> = {
      project_created: `${actorName} created this project`,
      project_updated: `${actorName} updated the project`,
      status_changed: `${actorName} changed status to ${a.new_value}`,
      priority_changed: `${actorName} changed priority to ${a.new_value}`,
      due_date_changed: `${actorName} updated the due date`,
      assignment_added: `${actorName} added a team member`,
      deliverable_added: `${actorName} added a deliverable`,
      deliverable_completed: `${actorName} completed a deliverable`,
      comment_added: `${actorName} added a comment`,
    }

    items.push({
      attention_id: attentionId,
      source_type: 'project',
      source_id: a.project_id,
      source_url: `/project/${a.project_id}`,
      attention_type: 'informational',
      reason_code: a.activity_type,
      reason_text: activityMessages[a.activity_type] || `${actorName} made changes`,
      title: a.projects?.title || 'Project Update',
      subtitle: a.activity_type.replace(/_/g, ' '),
      tags: [a.activity_type],
      icon_key: 'Activity',
      audience: 'shared',
      primary_owner_user_id: a.projects?.created_by,
      participant_user_ids: [],
      created_by_user_id: a.actor_id,
      last_actor_user_id: a.actor_id,
      created_at: a.created_at,
      updated_at: a.created_at,
      last_activity_at: a.created_at,
      status: 'resolved',
      severity: 'low',
      score: 0,
      context: {
        project_id: a.project_id,
      },
    })
  }

  return items
}

// Collect alignment items from high-activity projects
async function collectAlignmentProjects(
  supabase: any,
  userId: string,
  windowStart: Date
): Promise<AttentionItem[]> {
  const items: AttentionItem[] = []

  // Get projects with multiple contributors and recent activity
  const { data: projects, error } = await supabase
    .from('projects')
    .select(`
      *,
      project_assignments (
        assigned_to,
        role
      ),
      project_activity (
        id,
        created_at
      )
    `)
    .in('status', ['planning', 'in_progress'])
    .order('updated_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('Error fetching alignment projects:', error)
    return items
  }

  for (const p of projects || []) {
    // Only include projects with multiple contributors
    const contributors = new Set([
      p.created_by,
      ...(p.project_assignments || []).map((a: any) => a.assigned_to)
    ].filter(Boolean))

    if (contributors.size < 2) continue

    // Check if user has visibility
    const hasVisibility = contributors.has(userId)
    if (!hasVisibility) continue

    // Count recent activity
    const recentActivityCount = (p.project_activity || []).filter(
      (a: any) => new Date(a.created_at) >= windowStart
    ).length

    if (recentActivityCount < 2) continue  // Not enough activity

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
      reason_text: `${recentActivityCount} updates from ${contributors.size} team members`,
      title: p.title,
      subtitle: `${contributors.size} contributors`,
      preview: p.description?.substring(0, 150),
      tags: [p.status, p.priority, `${recentActivityCount} updates`].filter(Boolean),
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

// ============================================================================
// Main Attention Computation
// ============================================================================

async function computeAttention(
  supabase: any,
  userId: string,
  windowHours: number
): Promise<{
  sections: Record<AttentionType, AttentionItem[]>
  counts: Record<string, number>
  generated_at: string
  window_start: string
}> {
  const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000)

  // Fetch user's attention state for filtering
  const { data: userStates } = await supabase
    .from('attention_user_state')
    .select('attention_id, read_state, last_viewed_at, snoozed_until, dismissed_at')
    .eq('user_id', userId)

  const stateMap = new Map<string, AttentionUserState>()
  for (const s of userStates || []) {
    stateMap.set(s.attention_id, s)
  }

  // Collect items from all sources in parallel
  const [
    deliverables,
    projects,
    tradeItems,
    suggestions,
    notifications,
    activities,
    alignmentProjects,
  ] = await Promise.all([
    collectProjectDeliverables(supabase, userId, windowStart),
    collectProjects(supabase, userId, windowStart),
    collectTradeQueueItems(supabase, userId, windowStart),
    collectListSuggestions(supabase, userId, windowStart),
    collectNotifications(supabase, userId, windowStart),
    collectProjectActivity(supabase, userId, windowStart),
    collectAlignmentProjects(supabase, userId, windowStart),
  ])

  // Combine all items
  let allItems: AttentionItem[] = [
    ...deliverables,
    ...projects,
    ...tradeItems,
    ...suggestions,
    ...notifications,
    ...activities,
    ...alignmentProjects,
  ]

  // Apply user state (filter dismissed/snoozed, merge read state)
  const now = new Date()
  allItems = allItems.filter(item => {
    const state = stateMap.get(item.attention_id)
    if (!state) return true

    // Filter out dismissed items
    if (state.dismissed_at) return false

    // Filter out snoozed items (unless snooze expired)
    if (state.snoozed_until && new Date(state.snoozed_until) > now) return false

    return true
  })

  // Merge user state into items
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
    return {
      ...item,
      score,
      score_breakdown: breakdown,
    }
  })

  // De-duplicate: keep highest priority attention_type per source object
  const sourceKeyMap = new Map<string, AttentionItem>()
  for (const item of allItems) {
    const sourceKey = `${item.source_type}:${item.source_id}`
    const existing = sourceKeyMap.get(sourceKey)

    if (!existing) {
      sourceKeyMap.set(sourceKey, item)
    } else {
      // Compare priority
      const existingPriority = ATTENTION_TYPE_PRIORITY[existing.attention_type]
      const newPriority = ATTENTION_TYPE_PRIORITY[item.attention_type]

      if (newPriority > existingPriority) {
        sourceKeyMap.set(sourceKey, item)
      } else if (newPriority === existingPriority && item.score > existing.score) {
        sourceKeyMap.set(sourceKey, item)
      }
    }
  }

  const deduplicatedItems = Array.from(sourceKeyMap.values())

  // Split into sections and sort by score
  const sections: Record<AttentionType, AttentionItem[]> = {
    informational: [],
    action_required: [],
    decision_required: [],
    alignment: [],
  }

  for (const item of deduplicatedItems) {
    sections[item.attention_type].push(item)
  }

  // Sort each section by score (descending)
  for (const type of Object.keys(sections) as AttentionType[]) {
    sections[type].sort((a, b) => b.score - a.score)
  }

  return {
    sections,
    counts: {
      informational: sections.informational.length,
      action_required: sections.action_required.length,
      decision_required: sections.decision_required.length,
      alignment: sections.alignment.length,
      total: deduplicatedItems.length,
    },
    generated_at: new Date().toISOString(),
    window_start: windowStart.toISOString(),
  }
}

// ============================================================================
// Request Handlers
// ============================================================================

async function handleGetAttention(req: Request, supabase: any, userId: string) {
  const url = new URL(req.url)
  const windowHours = parseInt(url.searchParams.get('window_hours') || '24', 10)

  const result = await computeAttention(supabase, userId, windowHours)

  return new Response(JSON.stringify({
    ...result,
    window_hours: windowHours,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function handleAck(req: Request, supabase: any, userId: string) {
  const { attention_id } = await req.json()

  if (!attention_id) {
    return new Response(
      JSON.stringify({ error: 'attention_id is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const { error } = await supabase.rpc('acknowledge_attention', { p_attention_id: attention_id })

  if (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({ success: true }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleSnooze(req: Request, supabase: any, userId: string) {
  const { attention_id, snoozed_until } = await req.json()

  if (!attention_id || !snoozed_until) {
    return new Response(
      JSON.stringify({ error: 'attention_id and snoozed_until are required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const { error } = await supabase.rpc('snooze_attention', {
    p_attention_id: attention_id,
    p_until: snoozed_until,
  })

  if (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({ success: true }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleDismiss(req: Request, supabase: any, userId: string) {
  const { attention_id } = await req.json()

  if (!attention_id) {
    return new Response(
      JSON.stringify({ error: 'attention_id is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const { error } = await supabase.rpc('dismiss_attention', { p_attention_id: attention_id })

  if (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({ success: true }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleMarkRead(req: Request, supabase: any, userId: string) {
  const { attention_id } = await req.json()

  if (!attention_id) {
    return new Response(
      JSON.stringify({ error: 'attention_id is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const { error } = await supabase.rpc('mark_attention_read', { p_attention_id: attention_id })

  if (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({ success: true }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

// ============================================================================
// Main Server
// ============================================================================

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get authorization header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create Supabase client with user's JWT
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    })

    // Get user from JWT
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid authorization' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Route based on path and method
    const url = new URL(req.url)
    const path = url.pathname.replace('/attention', '')

    if (req.method === 'GET' && (path === '' || path === '/')) {
      return await handleGetAttention(req, supabase, user.id)
    }

    if (req.method === 'POST') {
      if (path === '/ack') {
        return await handleAck(req, supabase, user.id)
      }
      if (path === '/snooze') {
        return await handleSnooze(req, supabase, user.id)
      }
      if (path === '/dismiss') {
        return await handleDismiss(req, supabase, user.id)
      }
      if (path === '/mark-read') {
        return await handleMarkRead(req, supabase, user.id)
      }
    }

    return new Response(
      JSON.stringify({ error: 'Not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
