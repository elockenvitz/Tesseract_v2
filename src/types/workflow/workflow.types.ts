/**
 * Workflow Type Definitions
 *
 * Centralized type definitions for the workflow system.
 * Extracted from WorkflowsPage.tsx during refactoring.
 */

export interface WorkflowStage {
  id: string
  workflow_id: string
  stage_key: string
  stage_label: string
  stage_description: string
  stage_color: string
  stage_icon: string
  sort_order: number
  standard_deadline_days: number
  suggested_priorities: string[]
  created_at: string
  updated_at: string
}

export interface WorkflowWithStats {
  id: string
  name: string
  description: string
  color: string
  is_default: boolean
  is_public: boolean
  created_by: string
  created_at: string
  updated_at: string
  cadence_days: number
  cadence_timeframe?: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'semi-annually' | 'annually' | 'persistent'
  kickoff_cadence?: 'immediate' | 'month-start' | 'quarter-start' | 'year-start' | 'custom-date'
  kickoff_custom_date?: string
  auto_create_branch?: boolean
  auto_branch_name?: string
  usage_count: number
  active_assets: number
  completed_assets: number
  creator_name?: string
  is_favorited?: boolean
  stages?: WorkflowStage[]
  user_permission?: 'read' | 'admin'
  usage_stats?: any[]
  active_version_number?: number
  archived?: boolean
  archived_at?: string
  archived_by?: string
  deleted?: boolean
  deleted_at?: string
  deleted_by?: string
}

export type CadenceTimeframe = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'semi-annually' | 'annually' | 'persistent'

export type KickoffCadence = 'immediate' | 'month-start' | 'quarter-start' | 'year-start' | 'custom-date'

export type WorkflowPermission = 'read' | 'admin'

export interface WorkflowsPageProps {
  className?: string
  tabId?: string
}
