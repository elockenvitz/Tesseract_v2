/**
 * Attention System Types
 *
 * The Attention system normalizes various objects (projects, deliverables, trades, etc.)
 * into a unified AttentionItem format for the "10-minute screen" dashboard.
 *
 * Items are categorized into 4 sections:
 * 1. informational - "What's New"
 * 2. action_required - "What I Need To Do"
 * 3. decision_required - "Decisions I Need To Make"
 * 4. alignment - "Team Priority View"
 */

// Source types - where the attention item originates
export type AttentionSourceType =
  | 'task'
  | 'workflow_item'
  | 'project'
  | 'project_deliverable'
  | 'decision'
  | 'idea'
  | 'note'
  | 'message'
  | 'asset_event'
  | 'coverage_change'
  | 'file'
  | 'trade_queue_item'
  | 'list_suggestion'
  | 'notification'
  | 'quick_thought'
  | 'custom'

// Attention type - determines which dashboard section
export type AttentionType =
  | 'informational'
  | 'action_required'
  | 'decision_required'
  | 'alignment'

// Priority order for de-duplication (higher = more important)
export const ATTENTION_TYPE_PRIORITY: Record<AttentionType, number> = {
  decision_required: 4,
  action_required: 3,
  informational: 2,
  alignment: 1,
}

// Audience scope
export type AttentionAudience = 'personal' | 'shared' | 'team'

// Item status
export type AttentionStatus =
  | 'open'
  | 'in_progress'
  | 'blocked'
  | 'waiting'
  | 'resolved'
  | 'dismissed'

// Severity levels
export type AttentionSeverity = 'low' | 'medium' | 'high' | 'critical'

// Read state (matches database enum)
export type AttentionReadState = 'unread' | 'read' | 'acknowledged'

// Score breakdown component
export interface ScoreBreakdown {
  key: string
  value: number
  description?: string
}

// Context references for linking
export interface ContextRef {
  type: string
  id: string
  label?: string
}

// Full AttentionItem contract
export interface AttentionItem {
  // Core identification
  attention_id: string  // Deterministic hash: SHA-256 of source_type:source_id:attention_type:reason_code
  source_type: AttentionSourceType
  source_id: string
  source_url: string  // Deep link into existing tab routing

  // Classification
  attention_type: AttentionType
  reason_code: string
  reason_text: string  // One sentence explanation

  // Display
  title: string
  subtitle?: string
  preview?: string
  tags: string[]
  icon_key: string

  // Ownership & participants
  audience: AttentionAudience
  primary_owner_user_id?: string | null
  participant_user_ids: string[]
  created_by_user_id?: string | null
  last_actor_user_id?: string | null

  // Timestamps
  created_at: string
  updated_at: string
  last_activity_at: string
  due_at?: string | null

  // User state (merged from attention_user_state)
  snoozed_until?: string | null
  read_state?: AttentionReadState
  last_viewed_at?: string | null

  // Status & resolution
  status: AttentionStatus
  blocker_reason?: string | null
  next_action?: string | null
  resolution?: string | null
  resolution_note?: string | null
  resolution_at?: string | null

  // Scoring
  severity: AttentionSeverity
  score: number
  score_breakdown?: ScoreBreakdown[]

  // Context linking
  context: {
    asset_id?: string | null
    portfolio_id?: string | null
    theme_id?: string | null
    project_id?: string | null
    list_id?: string | null
    workflow_id?: string | null
    context_refs?: ContextRef[]
  }
}

// User state record (from attention_user_state table)
export interface AttentionUserState {
  id: string
  user_id: string
  attention_id: string
  read_state: AttentionReadState
  last_viewed_at: string | null
  snoozed_until: string | null
  dismissed_at: string | null
  personal_rank_override: number | null
  created_at: string
  updated_at: string
}

// API Response types
export interface AttentionResponse {
  generated_at: string
  window_start: string
  window_hours: number
  sections: {
    informational: AttentionItem[]
    action_required: AttentionItem[]
    decision_required: AttentionItem[]
    alignment: AttentionItem[]
  }
  counts: {
    informational: number
    action_required: number
    decision_required: number
    alignment: number
    total: number
  }
}

// Mutation request types
export interface AckAttentionRequest {
  attention_id: string
}

export interface SnoozeAttentionRequest {
  attention_id: string
  snoozed_until: string  // ISO timestamp
}

export interface DismissAttentionRequest {
  attention_id: string
}

export interface MarkReadAttentionRequest {
  attention_id: string
}

// Scoring weights configuration
export interface ScoringWeights {
  // Urgency-based weights
  overdue_days_multiplier: number      // Score per day overdue
  due_soon_days_threshold: number      // Days to consider "due soon"
  due_soon_bonus: number               // Bonus for due soon items

  // Ownership weights
  owner_bonus: number                  // Bonus if user owns the item
  assigned_bonus: number               // Bonus if assigned to user

  // Type weights
  decision_required_bonus: number      // Bonus for decision items
  action_required_bonus: number        // Bonus for action items
  blocking_bonus: number               // Bonus if blocking others

  // Activity weights
  recent_activity_threshold_hours: number  // Hours to consider "recent"
  recent_activity_bonus: number            // Bonus for recent activity
  stale_activity_penalty: number           // Penalty for stale items

  // Severity multipliers
  severity_multipliers: Record<AttentionSeverity, number>
}

// Default scoring weights (can be tuned)
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
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
  },
}

// Icon mapping for source types
export const SOURCE_TYPE_ICONS: Record<AttentionSourceType, string> = {
  task: 'CheckSquare',
  workflow_item: 'Workflow',
  project: 'FolderKanban',
  project_deliverable: 'ListTodo',
  decision: 'Scale',
  idea: 'Lightbulb',
  note: 'FileText',
  message: 'MessageSquare',
  asset_event: 'TrendingUp',
  coverage_change: 'Users',
  file: 'File',
  trade_queue_item: 'ArrowLeftRight',
  list_suggestion: 'ListPlus',
  notification: 'Bell',
  quick_thought: 'Lightbulb',
  custom: 'Circle',
}

// Section display configuration
export const ATTENTION_SECTIONS = {
  informational: {
    title: "What's New",
    icon: 'Newspaper',
    color: 'sky',
    description: 'Recent updates and changes relevant to you',
  },
  action_required: {
    title: 'What I Need To Do',
    icon: 'CheckCircle',
    color: 'amber',
    description: 'Tasks and items requiring your action',
  },
  decision_required: {
    title: 'Decisions I Need To Make',
    icon: 'Scale',
    color: 'violet',
    description: 'Items awaiting your decision or approval',
  },
  alignment: {
    title: 'Team Priority',
    icon: 'Users',
    color: 'emerald',
    description: 'High-activity items across your team',
  },
} as const
