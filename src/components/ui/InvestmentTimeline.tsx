import React, { useState } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { Check, Info, AlertTriangle, Calendar, Plus, ChevronDown, Zap, Target, Clock, BrainCircuit, Settings2 } from 'lucide-react'
import { Badge } from './Badge'
import { BadgeSelect } from './BadgeSelect'
import { Button } from './Button'
import { Card } from './Card'
import { StageDeadlineManager } from './StageDeadlineManager'
import { ContentTile } from './ContentTile'
import { AssignmentSelector } from './AssignmentSelector'
import { DecisionItemCard } from './checklist/DecisionItemCard'
import { OperationalItemCard } from './checklist/OperationalItemCard'
import { type ProcessItemType, userName as chUserName } from './checklist/types'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

interface ChecklistItem {
  id: string
  text: string
  completed: boolean
  status?: 'unchecked' | 'completed' | 'na'
  comment?: string
  completedAt?: string
  completedBy?: string
  completedByUser?: {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
  }
  isCustom?: boolean
  sortOrder?: number
  attachments?: ChecklistAttachment[]
  dbId?: string
  item_type?: ProcessItemType
  takeaway?: string | null
  takeaway_updated_at?: string | null
  takeaway_revision_count?: number
  takeaway_update_source?: 'manual' | 'finding' | null
  assignee_id?: string | null
  assignee?: { id: string; email: string; first_name?: string | null; last_name?: string | null } | null
  due_date?: string | null
  notes?: string | null
  source_type?: 'manual' | 'work_request'
  source_work_request_id?: string | null
  source_thinking_item_id?: string | null
  source_thinking_item_text?: string | null
}

interface ChecklistAttachment {
  id: string
  file_name: string
  file_path: string
  file_size?: number
  file_type?: string
  uploaded_by?: string
  uploaded_at: string
}

interface TimelineStage {
  id: string
  label: string
  description: string
  checklist: ChecklistItem[]
}

interface InvestmentTimelineProps {
  currentStage: string
  onStageChange: (stage: string) => void
  onStageClick: (stage: string) => void
  assetSymbol?: string
  className?: string
  assetId?: string
  viewingStageId?: string | null
  onViewingStageChange?: (stageId: string | null) => void
  workflowId?: string
  currentPriority?: string // kept for backward compatibility but not used
  onPriorityChange?: (priority: string) => void // kept for backward compatibility but not used
}

const TIMELINE_STAGES: TimelineStage[] = [
  {
    id: 'outdated',
    label: 'Outdated',
    description: 'Asset research needs to be refreshed or updated',
    checklist: []
  },
  {
    id: 'prioritized',
    label: 'Prioritize',
    description: 'Asset has been prioritized for active research',
    checklist: [
      { id: 'research_plan', text: 'Create detailed research plan', completed: false },
      { id: 'competitor_analysis', text: 'Complete comprehensive competitor analysis', completed: false },
      { id: 'schedule_mgmt', text: 'Schedule management meetings', completed: false },
      { id: 'expert_network', text: 'Engage expert network contacts', completed: false },
      { id: 'channel_checks', text: 'Conduct channel checks', completed: false },
      { id: 'risk_assessment', text: 'Complete initial risk assessment', completed: false }
    ]
  },
  {
    id: 'in_progress',
    label: 'Research',
    description: 'Active research and analysis underway',
    checklist: [
      { id: 'detailed_models', text: 'Build detailed financial models', completed: false },
      { id: 'mgmt_calls', text: 'Complete management due diligence calls', completed: false },
      { id: 'site_visits', text: 'Conduct site visits if applicable', completed: false },
      { id: 'industry_experts', text: 'Interview industry experts', completed: false },
      { id: 'supply_chain', text: 'Analyze supply chain and partnerships', completed: false },
      { id: 'esg_analysis', text: 'Complete ESG analysis', completed: false },
      { id: 'scenario_analysis', text: 'Run scenario and sensitivity analysis', completed: false }
    ]
  },
  {
    id: 'recommend',
    label: 'Recommend',
    description: 'Research complete, preparing recommendation',
    checklist: [
      { id: 'investment_memo', text: 'Prepare comprehensive investment memo', completed: false },
      { id: 'price_targets', text: 'Set bull/base/bear price targets', completed: false },
      { id: 'risk_assessment', text: 'Complete detailed risk assessment', completed: false },
      { id: 'position_sizing', text: 'Recommend optimal position sizing', completed: false },
      { id: 'recommendation_summary', text: 'Draft final recommendation summary', completed: false },
      { id: 'peer_review_prep', text: 'Prepare materials for peer review', completed: false }
    ]
  },
  {
    id: 'review',
    label: 'Review',
    description: 'Recommendation under committee review',
    checklist: [
      { id: 'ic_presentation', text: 'Prepare investment committee presentation', completed: false },
      { id: 'peer_review', text: 'Complete peer review process', completed: false },
      { id: 'risk_mitigation', text: 'Define risk mitigation strategies', completed: false },
      { id: 'compliance_check', text: 'Complete compliance and legal review', completed: false },
      { id: 'committee_feedback', text: 'Address committee feedback and questions', completed: false },
      { id: 'final_approval', text: 'Obtain final investment approval', completed: false }
    ]
  },
  {
    id: 'action',
    label: 'Action',
    description: 'Investment decision made, ready for execution',
    checklist: [
      { id: 'position_sizing', text: 'Determine optimal position sizing', completed: false },
      { id: 'execution_plan', text: 'Create trade execution plan', completed: false },
      { id: 'risk_limits', text: 'Set position and portfolio risk limits', completed: false },
      { id: 'monitoring_plan', text: 'Establish ongoing monitoring plan', completed: false },
      { id: 'exit_strategy', text: 'Define exit strategy and triggers', completed: false },
      { id: 'portfolio_integration', text: 'Update portfolio models and allocations', completed: false }
    ]
  },
  {
    id: 'monitor',
    label: 'Monitor',
    description: 'Ongoing monitoring and performance tracking',
    checklist: [
      { id: 'position_tracking', text: 'Track position performance vs targets', completed: false },
      { id: 'thesis_validation', text: 'Monitor thesis assumptions and catalysts', completed: false },
      { id: 'quarterly_review', text: 'Conduct quarterly performance review', completed: false },
      { id: 'risk_monitoring', text: 'Monitor position and portfolio risk metrics', completed: false },
      { id: 'exit_triggers', text: 'Monitor exit triggers and conditions', completed: false },
      { id: 'reporting', text: 'Prepare regular performance reports', completed: false }
    ]
  }
]

export function InvestmentTimeline({
  currentStage,
  onStageChange,
  onStageClick,
  assetSymbol,
  className = '',
  assetId,
  viewingStageId,
  onViewingStageChange,
  workflowId,
  currentPriority = 'none',
  onPriorityChange
}: InvestmentTimelineProps) {
  const { user } = useAuth()
  const [showStageDetails, setShowStageDetails] = useState<string | null>(null)
  const [lastClickedStageId, setLastClickedStageId] = useState<string | null>(null) // Track clicked stage for focus ring
  const [hasAutoSelected, setHasAutoSelected] = useState(false) // Track if we've auto-selected on mount
  const [stageChecklists, setStageChecklists] = useState<Record<string, ChecklistItem[]>>({})
  const [addingItemToStage, setAddingItemToStage] = useState<string | null>(null)
  const [newItemText, setNewItemText] = useState('')
  const [newItemType, setNewItemType] = useState<ProcessItemType>('operational')
  const [showPriorityDropdown, setShowPriorityDropdown] = useState(false)
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null)
  const queryClient = useQueryClient()

  // Helper function to get default checklist items for a stage
  const getDefaultChecklistForStage = (stageKey: string): ChecklistItem[] => {
    // First try to get workflow-specific checklist templates
    if (workflowChecklistTemplates && workflowChecklistTemplates.length > 0) {
      const stageTemplates = workflowChecklistTemplates.filter(template => template.stage_id === stageKey)
      if (stageTemplates.length > 0) {
        return stageTemplates.map(template => ({
          id: template.item_id,
          text: template.item_text,
          completed: false,
          isCustom: false,
          item_type: template.item_type || 'operational',
        }))
      }
    }

    // Fallback to hardcoded stage checklist if no workflow templates exist
    const defaultStage = TIMELINE_STAGES.find(s => s.id === stageKey)
    return defaultStage?.checklist || []
  }

  // Query to load workflow stages
  const { data: workflowStages } = useQuery({
    queryKey: ['workflow-stages', workflowId],
    queryFn: async () => {
      if (!workflowId) return []

      // Check if this is a workflow branch (has parent_workflow_id) and verify it's active
      const { data: workflow, error: workflowError } = await supabase
        .from('workflows')
        .select('template_version_id, parent_workflow_id, status, archived, deleted')
        .eq('id', workflowId)
        .single()

      // Don't load stages for archived/ended/deleted workflows
      if (workflowError || !workflow || workflow.archived || workflow.status === 'ended' || workflow.deleted) {
        return []
      }

      // If it's a branch (has parent_workflow_id), get stages from template version
      if (workflow?.parent_workflow_id && workflow?.template_version_id) {
        const { data: templateVersion, error } = await supabase
          .from('workflow_template_versions')
          .select('stages')
          .eq('id', workflow.template_version_id)
          .single()

        if (error) {
          console.error('Error fetching template version stages:', error)
          throw error
        }

        // Normalize template version stage format to match workflow_stages table format
        const normalizedStages = (templateVersion.stages || []).map((stage: any) => ({
          stage_key: stage.key || stage.stage_key,
          stage_label: stage.name || stage.stage_label,
          stage_description: stage.description || stage.stage_description,
          stage_color: stage.color || stage.stage_color,
          stage_icon: stage.icon || stage.stage_icon,
          sort_order: stage.order_index || stage.sort_order,
          checklist: stage.checklist || []
        }))
        return normalizedStages
      }

      // Otherwise, it's a template - get stages from workflow_stages table
      const { data, error } = await supabase
        .from('workflow_stages')
        .select('*')
        .eq('workflow_id', workflowId)
        .order('sort_order')

      if (error) throw error
      return data || []
    },
    enabled: !!workflowId,
    gcTime: 0 // Don't cache - always fetch fresh to prevent showing stale/deleted workflow data
  })

  // Query to load workflow checklist templates
  const { data: workflowChecklistTemplates } = useQuery({
    queryKey: ['workflow-checklist-templates', workflowId],
    queryFn: async () => {
      if (!workflowId) return []

      // Check if this is a workflow branch (has parent_workflow_id) and verify it's active
      const { data: workflow, error: workflowError } = await supabase
        .from('workflows')
        .select('template_version_id, parent_workflow_id, status, archived, deleted')
        .eq('id', workflowId)
        .single()

      // Don't load checklists for archived/ended/deleted workflows
      if (workflowError || !workflow || workflow.archived || workflow.status === 'ended' || workflow.deleted) {
        return []
      }

      // Determine which workflow to load checklists from
      const templateWorkflowId = workflow?.parent_workflow_id || workflowId

      // Try workflow_checklist_templates table first
      const { data: checklists, error } = await supabase
        .from('workflow_checklist_templates')
        .select('*')
        .eq('workflow_id', templateWorkflowId)
        .order('stage_id, sort_order')

      if (error) throw error

      if (checklists && checklists.length > 0) {
        return checklists
      }

      // Fallback: extract checklist items from template version stages JSONB
      // (wizard-created processes store checklists inline in stages, not in the templates table)
      const versionId = workflow?.template_version_id
      const parentId = workflow?.parent_workflow_id
      const lookupWorkflowId = parentId || workflowId

      // For branches, use the run's pinned template version; otherwise use the active version
      let versionQuery = supabase
        .from('workflow_template_versions')
        .select('stages')
      if (versionId) {
        versionQuery = versionQuery.eq('id', versionId)
      } else {
        versionQuery = versionQuery.eq('workflow_id', lookupWorkflowId).eq('is_active', true)
      }
      const { data: version } = await versionQuery.single()

      if (version?.stages && Array.isArray(version.stages)) {
        const extracted: any[] = []
        for (const stage of version.stages) {
          const items = stage.checklist_items || []
          items.forEach((rawItem: any, idx: number) => {
            // Handle both string format and {text, item_type} object format
            const text = typeof rawItem === 'string' ? rawItem : rawItem?.text
            const type = typeof rawItem === 'string' ? 'operational' : (rawItem?.item_type || 'operational')
            if (!text?.trim()) return
            const itemId = `${stage.stage_key}_item_${idx}`
            extracted.push({
              id: itemId,
              item_id: itemId,
              workflow_id: lookupWorkflowId,
              stage_id: stage.stage_key,
              item_text: text.trim(),
              item_type: type,
              sort_order: idx,
              is_required: false,
            })
          })
        }
        if (extracted.length > 0) {
          return extracted
        }
      }

      return []
    },
    enabled: !!workflowId,
    gcTime: 0 // Don't cache - always fetch fresh to prevent showing stale/deleted workflow data
  })

  // Query to load existing checklist items from DB (to get dbIds for assignment display)
  const { data: existingChecklistItems } = useQuery({
    queryKey: ['existing-checklist-items', assetId, workflowId],
    queryFn: async () => {
      if (!assetId || !workflowId) return []

      const { data, error} = await supabase
        .from('asset_checklist_items')
        .select('id, stage_id, item_id, item_text, takeaway, takeaway_updated_at, takeaway_revision_count, takeaway_update_source, item_type, assignee_id, due_date, notes, source_type, source_work_request_id, source_thinking_item_id, assignee:users!asset_checklist_items_assignee_id_fkey(id, email, first_name, last_name)')
        .eq('asset_id', assetId)
        .eq('workflow_id', workflowId)

      if (error) throw error
      return data || []
    },
    enabled: !!assetId && !!workflowId,
    gcTime: 0 // Don't cache - always fetch fresh to prevent showing stale/deleted workflow data
  })

  // Stage-level work request query for summary (open gaps + in-flight)
  const stageThinkingDbIds = (showStageDetails && stageChecklists[showStageDetails])
    ? stageChecklists[showStageDetails]
        .filter(i => i.item_type === 'thinking' && i.dbId)
        .map(i => i.dbId!)
    : []

  const { data: stageWorkRequests } = useQuery({
    queryKey: ['stage-work-requests', assetId, workflowId, showStageDetails, stageThinkingDbIds.join(',')],
    queryFn: async () => {
      if (stageThinkingDbIds.length === 0) return []
      const { data, error } = await supabase
        .from('checklist_work_requests')
        .select('id, checklist_item_id, prompt, status, resolved_at, owner_id, due_date, owner:users!checklist_work_requests_owner_id_fkey(first_name, last_name, email)')
        .in('checklist_item_id', stageThinkingDbIds)
        .neq('status', 'cancelled')
      if (error) throw error
      return (data || []).map((d: any) => ({ ...d, owner: Array.isArray(d.owner) ? d.owner[0] : d.owner }))
    },
    enabled: stageThinkingDbIds.length > 0,
    staleTime: 30_000,
  })

  // Query to load workflow-specific priority for this asset
  const { data: workflowPriority } = useQuery({
    queryKey: ['asset-workflow-priority', assetId, workflowId],
    queryFn: async () => {
      if (!assetId || !workflowId) return null

      const { data, error } = await supabase
        .from('asset_workflow_priorities')
        .select('priority')
        .eq('asset_id', assetId)
        .eq('workflow_id', workflowId)
        .single()

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
        throw error
      }

      return data?.priority || 'none' // default to none if no priority set
    },
    enabled: !!assetId && !!workflowId,
    gcTime: 0 // Don't cache - always fetch fresh to prevent showing stale/deleted workflow data
  })

  // Query to load workflow-specific progress for this asset
  const { data: workflowProgress } = useQuery({
    queryKey: ['asset-workflow-progress', assetId, workflowId],
    queryFn: async () => {
      if (!assetId || !workflowId) return null

      const { data, error } = await supabase
        .from('asset_workflow_progress')
        .select('*')
        .eq('asset_id', assetId)
        .eq('workflow_id', workflowId)
        .single()

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
        throw error
      }

      return data
    },
    enabled: !!assetId && !!workflowId,
    gcTime: 0 // Don't cache - always fetch fresh to prevent showing stale/deleted workflow data
  })

  // Use workflow-specific priority if available, otherwise fall back to asset priority
  const effectivePriority = workflowPriority || currentPriority

  // Mutation to save workflow-specific priority
  const saveWorkflowPriorityMutation = useMutation({
    mutationFn: async ({ assetId, workflowId, priority }: {
      assetId: string
      workflowId: string
      priority: string
    }) => {
      const { error } = await supabase
        .from('asset_workflow_priorities')
        .upsert({
          asset_id: assetId,
          workflow_id: workflowId,
          priority
        }, {
          onConflict: 'asset_id,workflow_id'
        })

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-workflow-priority', assetId, workflowId] })
    },
    onError: (error) => {
      console.error('Error saving workflow priority:', error)
      alert('Failed to save process priority. Please try again.')
    }
  })

  // Handler for workflow-specific priority changes
  const handleWorkflowPriorityChange = (priority: string) => {
    if (!assetId || !workflowId) {
      console.error('Cannot save workflow priority: missing assetId or workflowId')
      return
    }

    saveWorkflowPriorityMutation.mutate({
      assetId,
      workflowId,
      priority
    })
  }

  // Convert workflow stages to timeline stages format with default checklists
  const timelineStages: TimelineStage[] = React.useMemo(() => {

    // If no workflow is selected, use hardcoded stages
    if (!workflowId) {
      return TIMELINE_STAGES
    }

    // If workflow is selected but stages haven't loaded or are empty (archived/deleted), return empty
    if (!workflowStages || workflowStages.length === 0) {
      return []
    }

    const stages = workflowStages.map(stage => ({
      id: stage.stage_key,
      label: stage.stage_label,
      description: stage.stage_description || '',
      checklist: getDefaultChecklistForStage(stage.stage_key)
    }))

    // Add a "Completed" stage at the end
    stages.push({
      id: 'completed',
      label: 'Completed',
      description: 'Process completed successfully',
      checklist: []
    })

    return stages
  }, [workflowId, workflowStages, workflowChecklistTemplates])

  // Query all commentary entries for the completed summary
  const allThinkingDbIds = showStageDetails === 'completed'
    ? timelineStages.filter(s => s.id !== 'completed').flatMap(s =>
        (stageChecklists[s.id] || []).filter(i => i.item_type === 'thinking' && i.dbId).map(i => i.dbId!)
      )
    : []

  const { data: allCommentaries = [] } = useQuery({
    queryKey: ['all-commentaries', assetId, workflowId, allThinkingDbIds.join(',')],
    queryFn: async () => {
      if (allThinkingDbIds.length === 0) return []
      const { data, error } = await supabase
        .from('checklist_item_comments')
        .select('checklist_item_id, comment_text, user_id, created_at, user:users!checklist_item_comments_user_id_fkey(id, first_name, last_name, email)')
        .in('checklist_item_id', allThinkingDbIds)
        .eq('signal_type', 'commentary')
        .order('created_at', { ascending: true })
      if (error) throw error
      return data || []
    },
    enabled: showStageDetails === 'completed' && allThinkingDbIds.length > 0,
    staleTime: 30_000,
  })

  // Check if this specific workflow is started for this asset
  const isWorkflowStarted = workflowProgress?.is_started || false

  // Use workflow-specific current stage if available, otherwise use first stage
  const effectiveCurrentStage = workflowProgress?.current_stage_key || timelineStages?.[0]?.id || 'outdated'

  // Mutation to manage workflow progress
  const manageWorkflowProgressMutation = useMutation({
    mutationFn: async ({ action, stageKey }: { action: 'start' | 'stop', stageKey?: string }) => {
      if (!assetId || !workflowId) throw new Error('Missing assetId or workflowId')

      if (action === 'start') {
        const { error } = await supabase
          .from('asset_workflow_progress')
          .upsert({
            asset_id: assetId,
            workflow_id: workflowId,
            current_stage_key: stageKey,
            is_started: true,
            is_completed: false,
            started_at: new Date().toISOString(),
            started_by: user?.id,
            updated_by: user?.id
          }, {
            onConflict: 'asset_id,workflow_id'
          })

        if (error) throw error

        // Also update the asset's current stage if this is the current workflow
        if (stageKey) {
          onStageChange(stageKey)
        }
      } else {
        const { error } = await supabase
          .from('asset_workflow_progress')
          .upsert({
            asset_id: assetId,
            workflow_id: workflowId,
            current_stage_key: null,
            is_started: false,
            is_completed: true,
            completed_at: new Date().toISOString(),
            completed_by: user?.id,
            updated_by: user?.id
          }, {
            onConflict: 'asset_id,workflow_id'
          })

        if (error) throw error

        // Reset asset stage to outdated if this is the current workflow
        onStageChange('outdated')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-workflow-progress', assetId, workflowId] })
      queryClient.invalidateQueries({ queryKey: ['prioritizer-workflows'] })
      queryClient.invalidateQueries({ queryKey: ['asset-workflows-progress'] })
      queryClient.invalidateQueries({ queryKey: ['idea-generator-data'] })
    },
    onError: (error) => {
      console.error('Error managing workflow progress:', error)
      alert('Failed to update process. Please try again.')
    }
  })


  // Query to load workflow-specific checklist state from database
  const { data: savedChecklistItems } = useQuery({
    queryKey: ['asset-workflow-checklist', assetId, workflowId],
    queryFn: async () => {
      if (!assetId || !workflowId) return []
      const { data, error } = await supabase
        .from('asset_checklist_items')
        .select(`
          *,
          completed_by_user:users!asset_checklist_items_completed_by_fkey(id, email, first_name, last_name)
        `)
        .eq('asset_id', assetId)
        .eq('workflow_id', workflowId)
        .order('sort_order', { ascending: true })
      if (error) throw error
      return data || []
    },
    enabled: !!assetId && !!workflowId,
    gcTime: 0 // Don't cache - always fetch fresh to prevent showing stale/deleted workflow data
  })

  // Query to load workflow-specific stage deadlines
  const { data: stageDeadlines } = useQuery({
    queryKey: ['asset-workflow-deadlines', assetId, workflowId],
    queryFn: async () => {
      if (!assetId || !workflowId) return []
      const { data, error } = await supabase
        .from('asset_stage_deadlines')
        .select('*')
        .eq('asset_id', assetId)
        .eq('workflow_id', workflowId)
      if (error) throw error
      return data || []
    },
    enabled: !!assetId && !!workflowId,
    gcTime: 0 // Don't cache - always fetch fresh to prevent showing stale/deleted workflow data
  })

  // Query to load workflow-specific checklist attachments
  const { data: checklistAttachments } = useQuery({
    queryKey: ['asset-workflow-checklist-attachments', assetId, workflowId],
    queryFn: async () => {
      if (!assetId || !workflowId) return []
      const { data, error } = await supabase
        .from('asset_checklist_attachments')
        .select('*')
        .eq('asset_id', assetId)
        .eq('workflow_id', workflowId)
        .order('uploaded_at', { ascending: false })
      if (error) throw error
      return data || []
    },
    enabled: !!assetId && !!workflowId,
    gcTime: 0 // Don't cache - always fetch fresh to prevent showing stale/deleted workflow data
  })

  // Query to get content tiles for the current workflow and stage
  const { data: contentTiles } = useQuery({
    queryKey: ['workflow-stage-content-tiles', workflowId, showStageDetails],
    queryFn: async () => {
      if (!workflowId || !showStageDetails) return []

      const { data, error } = await supabase
        .from('workflow_stage_content_tiles')
        .select('*')
        .eq('workflow_id', workflowId)
        .eq('stage_id', showStageDetails)
        .eq('is_enabled', true)
        .order('sort_order', { ascending: true })

      if (error) throw error
      return data || []
    },
    enabled: !!workflowId && !!showStageDetails,
    gcTime: 0 // Don't cache - always fetch fresh to prevent showing stale/deleted workflow data
  })

  // Mutation to save checklist item changes
  const saveChecklistItemMutation = useMutation({
    mutationFn: async ({ assetId, stageId, itemId, completed, status, comment, completedAt, completedBy }: {
      assetId: string
      stageId: string
      itemId: string
      completed: boolean
      status?: 'unchecked' | 'completed' | 'na'
      comment?: string
      completedAt?: string
      completedBy?: string
    }) => {
      const { error } = await supabase
        .from('asset_checklist_items')
        .upsert({
          asset_id: assetId,
          workflow_id: workflowId,
          stage_id: stageId,
          item_id: itemId,
          completed,
          status: status || 'unchecked',
          comment: comment || null,
          completed_at: completedAt || null,
          completed_by: completedBy || null
        }, {
          onConflict: 'asset_id,workflow_id,stage_id,item_id'
        })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-workflow-checklist', assetId, workflowId] })
    },
    onError: (error) => {
      console.error('Error saving checklist item:', error)
      alert('Failed to save checklist item. Please try again.')
    }
  })

  // Initialize checklists for all stages, merging with saved data and custom items
  React.useEffect(() => {
    // Always initialize checklists even if queries are still loading
    if (timelineStages.length === 0) {
      return
    }

    const initialChecklists: Record<string, ChecklistItem[]> = {}

    timelineStages.forEach(stage => {
      // Start with default stage items
      const defaultItems = stage.checklist.map((item, index) => {
        // Look for saved state for this item
        const savedItem = savedChecklistItems?.find(
          saved => saved.stage_id === stage.id && saved.item_id === item.id
        )

        // Find the dbId for this item
        const existingItem = existingChecklistItems?.find(
          existing => existing.stage_id === stage.id && existing.item_id === item.id
        )

        if (savedItem) {
          return {
            ...item,
            completed: savedItem.completed,
            status: savedItem.status || (savedItem.completed ? 'completed' : 'unchecked'),
            comment: savedItem.comment || undefined,
            completedAt: savedItem.completed_at || undefined,
            completedBy: savedItem.completed_by || undefined,
            completedByUser: savedItem.completed_by_user || undefined,
            sortOrder: index,
            dbId: existingItem?.id,
            item_type: item.item_type || existingItem?.item_type || 'operational',
            takeaway: existingItem?.takeaway || null,
            takeaway_updated_at: existingItem?.takeaway_updated_at || null,
            takeaway_revision_count: existingItem?.takeaway_revision_count || 0,
            takeaway_update_source: existingItem?.takeaway_update_source || null,
            assignee_id: existingItem?.assignee_id || null,
            assignee: existingItem?.assignee ? (Array.isArray(existingItem.assignee) ? existingItem.assignee[0] : existingItem.assignee) : null,
            due_date: existingItem?.due_date || null,
            notes: existingItem?.notes || null,
            source_type: existingItem?.source_type || 'manual',
            source_work_request_id: existingItem?.source_work_request_id || null,
            source_thinking_item_id: existingItem?.source_thinking_item_id || null,
            source_thinking_item_text: existingItem?.source_thinking_item_id ? (existingChecklistItems?.find(i => i.id === existingItem.source_thinking_item_id)?.item_text || null) : null,
            attachments: checklistAttachments?.filter(
              att => att.stage_id === stage.id && att.item_id === item.id
            ) || []
          }
        }

        return {
          ...item,
          sortOrder: index,
          dbId: existingItem?.id,
          item_type: existingItem?.item_type || item.item_type || 'operational',
          takeaway: existingItem?.takeaway || null,
          assignee_id: existingItem?.assignee_id || null,
          assignee: existingItem?.assignee ? (Array.isArray(existingItem.assignee) ? existingItem.assignee[0] : existingItem.assignee) : null,
          due_date: existingItem?.due_date || null,
          notes: existingItem?.notes || null,
          attachments: checklistAttachments?.filter(
            att => att.stage_id === stage.id && att.item_id === item.id
          ) || []
        }
      })

      // Add custom items from database
      const customItems = savedChecklistItems?.filter(
        saved => saved.stage_id === stage.id && saved.is_custom
      ).map(saved => {
        // Find the dbId for this custom item
        const existingItem = existingChecklistItems?.find(
          existing => existing.stage_id === stage.id && existing.item_id === saved.item_id
        )

        return {
          id: saved.item_id,
          text: saved.item_text || saved.item_id,
          completed: saved.completed,
          status: saved.status || (saved.completed ? 'completed' : 'unchecked'),
          comment: saved.comment || undefined,
          completedAt: saved.completed_at || undefined,
          completedBy: saved.completed_by || undefined,
          completedByUser: saved.completed_by_user || undefined,
          isCustom: true,
          sortOrder: saved.sort_order || 999,
          dbId: existingItem?.id,
          item_type: existingItem?.item_type || 'operational',
          takeaway: existingItem?.takeaway || null,
          assignee_id: existingItem?.assignee_id || null,
          assignee: existingItem?.assignee ? (Array.isArray(existingItem.assignee) ? existingItem.assignee[0] : existingItem.assignee) : null,
          due_date: existingItem?.due_date || null,
          notes: existingItem?.notes || null,
          attachments: checklistAttachments?.filter(
            att => att.stage_id === stage.id && att.item_id === saved.item_id
          ) || []
        }
      }) || []

      // Combine and sort by sort_order
      const allItems = [...defaultItems, ...customItems].sort((a, b) =>
        (a.sortOrder || 0) - (b.sortOrder || 0)
      )

      initialChecklists[stage.id] = allItems
    })

    setStageChecklists(initialChecklists)
  }, [assetId, savedChecklistItems, checklistAttachments, timelineStages, workflowChecklistTemplates, existingChecklistItems])

  // Automatically select the current stage when component loads (but only if no stage is selected)
  // Only run after workflow stages have loaded to avoid selecting wrong stage
  React.useEffect(() => {
    // Don't auto-select if workflow data is still loading
    if (!workflowId) return
    if (workflowId && !workflowStages) return // Wait for workflowStages to load
    if (!timelineStages.length) return // Wait for timeline stages to be ready
    if (hasAutoSelected) return // Already auto-selected for this mount

    // Auto-select current stage or first stage
    const stageToSelect = effectiveCurrentStage || timelineStages[0]?.id
    if (stageToSelect) {
      // Batch all state updates together using React.startTransition for consistency
      React.startTransition(() => {
        setShowStageDetails(stageToSelect)
        setLastClickedStageId(stageToSelect) // Set for blue ring styling
        setHasAutoSelected(true) // Mark as auto-selected
      })
      onStageClick(stageToSelect)
    }
  }, [effectiveCurrentStage, workflowId, workflowStages, timelineStages, workflowProgress, hasAutoSelected, showStageDetails, lastClickedStageId, onStageClick])

  // Only force current stage when workflow first starts (not on every render)
  const [hasInitialized, setHasInitialized] = React.useState(false)
  React.useEffect(() => {
    if (isWorkflowStarted && effectiveCurrentStage && !hasInitialized) {
      setShowStageDetails(effectiveCurrentStage)
      onStageClick(effectiveCurrentStage)
      setHasInitialized(true)
    }
  }, [isWorkflowStarted, effectiveCurrentStage, hasInitialized, onStageClick])

  // Handle external viewing stage requests (only when explicitly set from outside)
  React.useEffect(() => {
    if (viewingStageId && viewingStageId !== showStageDetails) {
      setShowStageDetails(viewingStageId)
      setLastClickedStageId(viewingStageId) // Set for blue ring styling
      onStageClick(viewingStageId)
      // Clear the viewing stage ID after setting it to allow normal clicking
      if (onViewingStageChange) {
        onViewingStageChange(null)
      }
    }
  }, [viewingStageId, showStageDetails, onStageClick, onViewingStageChange])

  // Reset stage selection when timelineStages changes and current stage is invalid
  React.useEffect(() => {
    if (showStageDetails && showStageDetails !== 'outdated' && showStageDetails !== 'completed') {
      const stageExists = timelineStages.some(stage => stage.id === showStageDetails)
      if (!stageExists && timelineStages.length > 0) {
        const firstStage = timelineStages[0]?.id
        if (firstStage) {
          setShowStageDetails(firstStage)
          onStageClick(firstStage)
        }
      }
    }
  }, [timelineStages, showStageDetails, onStageClick])

  const getCurrentStageIndex = () => {
    return timelineStages.findIndex(stage => stage.id === effectiveCurrentStage)
  }

  const getStageStatus = (stageIndex: number) => {
    // If workflow is completed, all stages should show as completed
    if (workflowProgress?.is_completed) return 'completed'

    const currentIndex = getCurrentStageIndex()
    if (stageIndex < currentIndex) return 'completed'
    if (stageIndex === currentIndex) return 'current'
    return 'future'
  }

  const getStageColor = (status: string, stageIndex: number) => {
    if (status === 'completed') return 'bg-green-600'
    if (status === 'future') return 'bg-gray-300'

    // Progressive color scheme reflecting stage progression
    const colors = [
      'bg-gray-600',   // outdated
      'bg-orange-600', // prioritized
      'bg-blue-500',   // research (in_progress)
      'bg-yellow-500', // recommend
      'bg-green-400',  // review
      'bg-green-700',  // action
      'bg-teal-500',   // monitor
      'bg-green-600'   // completed
    ]

    return colors[stageIndex] || 'bg-gray-300'
  }

  const getTextColor = (status: string) => {
    switch (status) {
      case 'completed': return 'text-green-700'
      case 'current': return 'text-blue-700'
      case 'future': return 'text-gray-500'
      default: return 'text-gray-500'
    }
  }

  const handleStageClick = (stage: TimelineStage, index: number) => {
    // Allow viewing all stages regardless of workflow state
    onStageClick(stage.id)
    setShowStageDetails(stage.id)
    setLastClickedStageId(stage.id) // Track for persistent focus ring
    // Clear the viewing stage override to allow manual selection
    if (onViewingStageChange) {
      onViewingStageChange(null)
    }
  }

  // Helper function to check if a checklist item is "done" (completed or N/A)
  const isItemDone = (item: ChecklistItem) => {
    const status = item.status || (item.completed ? 'completed' : 'unchecked')
    return status === 'completed' || status === 'na'
  }

  const isCurrentStageCompleted = () => {
    const currentIndex = getCurrentStageIndex()
    const currentStageId = TIMELINE_STAGES[currentIndex]?.id
    if (!currentStageId) return false

    // Outdated stage is always considered "complete" since it has no checklist
    if (currentStageId === 'outdated') return true

    if (!stageChecklists[currentStageId]) return false

    return stageChecklists[currentStageId].every(item => isItemDone(item))
  }

  const isStageEditable = (stageId: string) => {
    // If workflow is marked as completed, lock all editing until resumed
    if (workflowProgress?.is_completed) {
      return false
    }
    // Allow editing any stage to enable flexible workflow
    return true
  }


  const handleAdvanceStage = async () => {
    if (!assetId) {
      alert('No asset ID available. Cannot advance stage.')
      return
    }

    const currentIndex = getCurrentStageIndex()
    if (currentIndex < timelineStages.length - 1) {
      const currentStageId = timelineStages[currentIndex].id
      const currentTime = new Date().toISOString()

      // Update completion timestamps for all completed items in current stage (including N/A items)
      const currentStageItems = stageChecklists[currentStageId] || []
      const updatePromises = currentStageItems
        .filter(item => isItemDone(item) && !item.completedAt)
        .map(item =>
          saveChecklistItemMutation.mutateAsync({
            assetId,
            stageId: currentStageId,
            itemId: item.id,
            completed: item.completed,
            status: item.status,
            comment: item.comment,
            completedAt: currentTime,
            completedBy: user?.id
          })
        )

      try {
        // Wait for all checklist updates to complete
        await Promise.all(updatePromises)

        // Update local state
        setStageChecklists(prev => ({
          ...prev,
          [currentStageId]: prev[currentStageId]?.map(item => ({
            ...item,
            completedAt: item.completed && !item.completedAt ? currentTime : item.completedAt
          })) || []
        }))

        // Advance to next stage
        const nextStage = timelineStages[currentIndex + 1]

        // Check if we're moving to the "Completed" stage
        if (nextStage.id === 'completed') {
          // Mark workflow as completed
          if (workflowId && assetId) {
            await supabase
              .from('asset_workflow_progress')
              .upsert({
                asset_id: assetId,
                workflow_id: workflowId,
                current_stage_key: nextStage.id,
                is_started: false,
                is_completed: true,
                completed_at: new Date().toISOString(),
                completed_by: user?.id,
                updated_at: new Date().toISOString(),
                updated_by: user?.id
              }, {
                onConflict: 'asset_id,workflow_id'
              })

            // Refresh workflow progress
            queryClient.invalidateQueries({ queryKey: ['asset-workflow-progress', assetId, workflowId] })
            queryClient.invalidateQueries({ queryKey: ['prioritizer-workflows'] })
            queryClient.invalidateQueries({ queryKey: ['asset-workflows-progress'] })
            queryClient.invalidateQueries({ queryKey: ['idea-generator-data'] })
          }
        } else {
          // Regular stage progression
          if (workflowId && assetId) {
            await supabase
              .from('asset_workflow_progress')
              .upsert({
                asset_id: assetId,
                workflow_id: workflowId,
                current_stage_key: nextStage.id,
                is_started: true,
                updated_at: new Date().toISOString(),
                updated_by: user?.id
              }, {
                onConflict: 'asset_id,workflow_id'
              })

            // Refresh workflow progress
            queryClient.invalidateQueries({ queryKey: ['asset-workflow-progress', assetId, workflowId] })
          }
        }

        onStageChange(nextStage.id)

        // Focus on the new stage
        setShowStageDetails(nextStage.id)
      } catch (error) {
        console.error('Error saving checklist state:', error)
        alert('Failed to save checklist state. Please try again.')
      }
    }
  }

  const handleRegressStage = async () => {
    const currentIndex = getCurrentStageIndex()
    if (currentIndex > 0) {
      const prevStage = timelineStages[currentIndex - 1]

      // Update workflow-specific progress
      if (workflowId && assetId) {
        await supabase
          .from('asset_workflow_progress')
          .upsert({
            asset_id: assetId,
            workflow_id: workflowId,
            current_stage_key: prevStage.id,
            is_started: true,
            updated_at: new Date().toISOString(),
            updated_by: user?.id
          }, {
            onConflict: 'asset_id,workflow_id'
          })

        // Refresh workflow progress
        queryClient.invalidateQueries({ queryKey: ['asset-workflow-progress', assetId, workflowId] })
      }

      onStageChange(prevStage.id)

      // Focus on the previous stage
      setShowStageDetails(prevStage.id)
    }
  }

  const handleChecklistToggle = (stageId: string, itemId: string) => {
    if (!isStageEditable(stageId)) {
      if (workflowProgress?.is_completed) {
        alert('This process has been marked complete. Click "Resume Process" to continue working on it.')
      } else {
        alert('This checklist is locked. You can only edit items from the current stage.')
      }
      return
    }

    if (!assetId) {
      alert('No asset ID available. Cannot save checklist changes.')
      return
    }

    const currentItem = stageChecklists[stageId]?.find(item => item.id === itemId)
    if (!currentItem) return

    // Cycle through states: unchecked -> completed -> na -> unchecked
    const currentStatus = currentItem.status || (currentItem.completed ? 'completed' : 'unchecked')
    let newStatus: 'unchecked' | 'completed' | 'na'

    if (currentStatus === 'unchecked') {
      newStatus = 'completed'
    } else if (currentStatus === 'completed') {
      newStatus = 'na'
    } else {
      newStatus = 'unchecked'
    }

    const newCompleted = newStatus === 'completed'
    const isDone = newStatus === 'completed' || newStatus === 'na'
    const newCompletedAt = isDone ? new Date().toISOString() : undefined
    const newCompletedBy = isDone ? user?.id : undefined
    const newCompletedByUser = isDone && user ? {
      id: user.id,
      email: user.email || '',
      first_name: (user as any).first_name || null,
      last_name: (user as any).last_name || null
    } : undefined

    // Update local state immediately for responsiveness
    setStageChecklists(prev => ({
      ...prev,
      [stageId]: prev[stageId]?.map(item =>
        item.id === itemId ? {
          ...item,
          completed: newCompleted,
          status: newStatus,
          completedAt: newCompletedAt,
          completedBy: newCompletedBy,
          completedByUser: newCompletedByUser
        } : item
      ) || []
    }))

    // Save to database
    saveChecklistItemMutation.mutate({
      assetId,
      stageId,
      itemId,
      completed: newCompleted,
      status: newStatus,
      comment: currentItem.comment,
      completedAt: newCompletedAt,
      completedBy: newCompletedBy
    })
  }

  const handleAddCustomItem = async (stageId: string) => {
    if (!newItemText.trim() || !assetId || !user) return
    const itemId = `custom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
    const text = newItemText.trim()
    const itemType = newItemType

    // Add to local state immediately
    setStageChecklists(prev => ({
      ...prev,
      [stageId]: [...(prev[stageId] || []), {
        id: itemId, text, completed: false, status: 'unchecked', isCustom: true,
        sortOrder: (prev[stageId]?.length || 0) + 1, item_type: itemType,
      }]
    }))
    setNewItemText('')
    setNewItemType('operational')
    setAddingItemToStage(null)

    // Save to database
    const { error } = await supabase.from('asset_checklist_items').insert({
      asset_id: assetId, workflow_id: workflowId, stage_id: stageId,
      item_id: itemId, item_text: text, completed: false, is_custom: true,
      sort_order: (stageChecklists[stageId]?.length || 0) + 1,
      item_type: itemType, created_by: user.id,
    })
    if (error) console.error('Error adding custom item:', error)
    queryClient.invalidateQueries({ queryKey: ['existing-checklist-items', assetId, workflowId] })
    queryClient.invalidateQueries({ queryKey: ['asset-checklist', assetId, workflowId] })
  }

  const handleRemoveCustomItem = async (stageId: string, itemId: string) => {
    if (!assetId) return
    setStageChecklists(prev => ({
      ...prev,
      [stageId]: (prev[stageId] || []).filter(item => item.id !== itemId)
    }))
    const { error } = await supabase.from('asset_checklist_items').delete()
      .eq('asset_id', assetId).eq('workflow_id', workflowId)
      .eq('stage_id', stageId).eq('item_id', itemId)
    if (error) console.error('Error removing custom item:', error)
    queryClient.invalidateQueries({ queryKey: ['existing-checklist-items', assetId, workflowId] })
  }

  const getStageDeadline = (stageId: string) => {
    return stageDeadlines?.find(deadline => deadline.stage_id === stageId)
  }

  const getDeadlineStatus = (dateString: string) => {
    const deadline = new Date(dateString)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    deadline.setHours(0, 0, 0, 0)

    const diffTime = deadline.getTime() - today.getTime()
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

    if (diffDays < 0) return 'overdue'
    if (diffDays === 0) return 'today'
    if (diffDays <= 3) return 'urgent'
    return 'upcoming'
  }

  const currentStageData = timelineStages.find(stage => stage.id === effectiveCurrentStage)
  const currentIndex = getCurrentStageIndex()


  // Show message when no workflow is assigned OR when workflow has no stages (archived/ended)
  // Show a quiet spinner while workflow stages are loading
  if (workflowId && !workflowStages) {
    return (
      <div className={`space-y-6 ${className}`}>
        <div className="flex items-center justify-center py-16">
          <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  if (!workflowId || workflowId === '' || workflowId === 'undefined' || workflowId === 'null' || (workflowStages && timelineStages.length === 0)) {
    return (
      <div className={`space-y-6 ${className}`}>
        <div className="bg-white border border-gray-200 rounded-lg p-12">
          <div className="flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No Active Processes</h3>
            <p className="text-sm text-gray-500 max-w-md">
              This asset is not currently assigned to any process. Select a process from the dropdown above to get started.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Timeline Visualization */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="mb-4 flex items-center justify-between">
          {/* Workflow Priority on the left */}
          {assetId && workflowId && (
            <div className="flex items-center space-x-2">
              <div className="relative">
                {(() => {
                  const priorityConfig = {
                    'critical': { color: 'bg-red-600 text-white', icon: AlertTriangle, label: 'Critical' },
                    'high': { color: 'bg-orange-500 text-white', icon: Zap, label: 'High' },
                    'medium': { color: 'bg-blue-500 text-white', icon: Target, label: 'Medium' },
                    'low': { color: 'bg-green-500 text-white', icon: Clock, label: 'Low' },
                    'none': { color: 'bg-gray-400 text-white', icon: Clock, label: 'None' }
                  }
                  const current = priorityConfig[effectivePriority as keyof typeof priorityConfig] || priorityConfig['none']

                  return (
                    <>
                      <button
                        onClick={() => setShowPriorityDropdown(!showPriorityDropdown)}
                        className={`px-2 py-1 rounded-lg text-xs font-medium flex items-center space-x-1 hover:opacity-90 transition-opacity ${
                          effectivePriority === 'critical' ? 'bg-red-600 text-white' :
                          effectivePriority === 'high' ? 'bg-orange-500 text-white' :
                          effectivePriority === 'medium' ? 'bg-blue-500 text-white' :
                          effectivePriority === 'low' ? 'bg-green-500 text-white' :
                          effectivePriority === 'none' ? 'bg-gray-400 text-white' :
                          'bg-gray-400 text-white'
                        }`}
                      >
                        <current.icon className="w-3 h-3" />
                        <span>Process: {current.label}</span>
                        <ChevronDown className="w-3 h-3" />
                      </button>

                      {showPriorityDropdown && (
                        <>
                          <div
                            className="fixed inset-0 z-10"
                            onClick={() => setShowPriorityDropdown(false)}
                          />
                          <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 overflow-hidden">
                            <div className="p-2">
                              <button
                                onClick={() => {
                                  handleWorkflowPriorityChange('critical')
                                  setShowPriorityDropdown(false)
                                }}
                                className={`w-full px-3 py-2 rounded-lg text-xs font-medium transition-all bg-red-600 text-white flex items-center space-x-1 mb-1 ${
                                  effectivePriority === 'critical' ? 'ring-2 ring-offset-1 ring-blue-300' : 'opacity-70 hover:opacity-100'
                                }`}
                              >
                                <AlertTriangle className="w-3 h-3" />
                                <span>Critical</span>
                              </button>
                              <button
                                onClick={() => {
                                  handleWorkflowPriorityChange('high')
                                  setShowPriorityDropdown(false)
                                }}
                                className={`w-full px-3 py-2 rounded-lg text-xs font-medium transition-all bg-orange-500 text-white flex items-center space-x-1 mb-1 ${
                                  effectivePriority === 'high' ? 'ring-2 ring-offset-1 ring-blue-300' : 'opacity-70 hover:opacity-100'
                                }`}
                              >
                                <Zap className="w-3 h-3" />
                                <span>High</span>
                              </button>
                              <button
                                onClick={() => {
                                  handleWorkflowPriorityChange('medium')
                                  setShowPriorityDropdown(false)
                                }}
                                className={`w-full px-3 py-2 rounded-lg text-xs font-medium transition-all bg-blue-500 text-white flex items-center space-x-1 mb-1 ${
                                  effectivePriority === 'medium' ? 'ring-2 ring-offset-1 ring-blue-300' : 'opacity-70 hover:opacity-100'
                                }`}
                              >
                                <Target className="w-3 h-3" />
                                <span>Medium</span>
                              </button>
                              <button
                                onClick={() => {
                                  handleWorkflowPriorityChange('low')
                                  setShowPriorityDropdown(false)
                                }}
                                className={`w-full px-3 py-2 rounded-lg text-xs font-medium transition-all bg-green-500 text-white flex items-center space-x-1 mb-1 ${
                                  effectivePriority === 'low' ? 'ring-2 ring-offset-1 ring-blue-300' : 'opacity-70 hover:opacity-100'
                                }`}
                              >
                                <Clock className="w-3 h-3" />
                                <span>Low</span>
                              </button>
                              <button
                                onClick={() => {
                                  handleWorkflowPriorityChange('none')
                                  setShowPriorityDropdown(false)
                                }}
                                className={`w-full px-3 py-2 rounded-lg text-xs font-medium transition-all bg-gray-400 text-white flex items-center space-x-1 ${
                                  effectivePriority === 'none' ? 'ring-2 ring-offset-1 ring-blue-300' : 'opacity-70 hover:opacity-100'
                                }`}
                              >
                                <Clock className="w-3 h-3" />
                                <span>None</span>
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </>
                  )
                })()}
              </div>
            </div>
          )}

        </div>

        {/* Desktop Chevron Timeline - Executive Design */}
        <div className="hidden md:block">
          <div className="relative py-6 px-8">
            <div className="flex items-center gap-0.5 w-full">
              {timelineStages.map((stage, index) => {
                const status = getStageStatus(index)
                const isLast = index === timelineStages.length - 1
                const isFirst = index === 0

                // Get task progress for this stage
                const stageChecklistItems = stageChecklists[stage.id] || []
                const completedTasks = stageChecklistItems.filter(item => isItemDone(item)).length
                const totalTasks = stageChecklistItems.length
                const progressPercent = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0

                // Executive color schemes - minimal and sophisticated
                const colorSchemes: Record<string, {
                  bg: string
                  text: string
                  accent: string
                  progressTrack: string
                  progressFill: string
                }> = {
                  completed: {
                    bg: 'bg-emerald-500',
                    text: 'text-white',
                    accent: 'text-emerald-50',
                    progressTrack: 'bg-emerald-700/30',
                    progressFill: 'bg-white'
                  },
                  current: {
                    bg: 'bg-gradient-to-br from-blue-600 to-indigo-600',
                    text: 'text-white',
                    accent: 'text-blue-50',
                    progressTrack: 'bg-white/20',
                    progressFill: 'bg-white'
                  },
                  future: {
                    bg: 'bg-slate-100',
                    text: 'text-slate-700',
                    accent: 'text-slate-500',
                    progressTrack: 'bg-slate-200',
                    progressFill: 'bg-slate-500'
                  }
                }

                const colors = colorSchemes[status] || colorSchemes.future
                const isSelected = lastClickedStageId === stage.id

                // Responsive sizing for chevrons
                const chevronArrowSize = '34px'

                return (
                  <div
                    key={stage.id}
                    className="relative flex items-center transition-all duration-300 flex-1 min-w-0"
                    style={{ flexBasis: 0 }}
                  >
                    {/* Blue glow border for selected state */}
                    {isSelected && (
                      <div
                        className="absolute pointer-events-none z-[2]"
                        style={{
                          top: '-5px',
                          left: '-5px',
                          right: '-5px',
                          bottom: '-5px',
                          background: 'linear-gradient(135deg, rgba(147, 197, 253, 0.9), rgba(96, 165, 250, 0.7))',
                          clipPath: isLast
                            ? isFirst
                              ? 'none'
                              : `polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, ${chevronArrowSize} 50%)`
                            : isFirst
                              ? `polygon(0% 0%, calc(100% - ${chevronArrowSize}) 0%, 100% 50%, calc(100% - ${chevronArrowSize}) 100%, 0% 100%)`
                              : `polygon(0% 0%, calc(100% - ${chevronArrowSize}) 0%, 100% 50%, calc(100% - ${chevronArrowSize}) 100%, 0% 100%, ${chevronArrowSize} 50%)`,
                          filter: 'blur(3px)'
                        }}
                      />
                    )}
                    <button
                      onClick={() => handleStageClick(stage, index)}
                      className={`
                        relative w-full py-5 px-6 transition-all duration-300 min-w-0
                        ${colors.bg} ${colors.text}
                        ${isSelected
                          ? 'z-[3]'
                          : 'shadow-lg hover:shadow-xl hover:z-[2]'
                        }
                        ${isFirst ? 'rounded-l-xl' : ''}
                        ${isLast ? 'rounded-r-xl' : ''}
                      `}
                      style={{
                        clipPath: isLast
                          ? isFirst
                            ? 'none'
                            : `polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, ${chevronArrowSize} 50%)`
                          : isFirst
                            ? `polygon(0% 0%, calc(100% - ${chevronArrowSize}) 0%, 100% 50%, calc(100% - ${chevronArrowSize}) 100%, 0% 100%)`
                            : `polygon(0% 0%, calc(100% - ${chevronArrowSize}) 0%, 100% 50%, calc(100% - ${chevronArrowSize}) 100%, 0% 100%, ${chevronArrowSize} 50%)`
                      }}
                    >
                      {/* Content */}
                      <div className="relative z-10 space-y-2.5 min-h-[85px] flex flex-col justify-center min-w-0 w-full" style={{ marginLeft: isFirst ? '0' : '16px' }}>


                        {/* Header */}
                        <div className="flex items-center min-w-0">
                          {/* Stage Number - Fixed width container with checkmark for completed */}
                          <div className="relative flex items-center justify-center w-7 h-7 rounded-md bg-black/15 text-sm font-bold flex-shrink-0 mr-2">
                            {index + 1}
                            {/* Completed checkmark - upper right of stage number */}
                            {status === 'completed' && (
                              <div className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-white rounded-full flex items-center justify-center shadow-sm">
                                <Check className="w-3 h-3 text-green-600" strokeWidth={3} />
                              </div>
                            )}
                            {/* Current stage indicator */}
                            {status === 'current' && (
                              <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-white rounded-full animate-pulse shadow-sm" />
                            )}
                          </div>
                          {/* Stage Name - Left aligned */}
                          <h4 className="text-base font-semibold leading-tight truncate min-w-0">
                            {stage.label}
                          </h4>
                        </div>

                        {/* Progress */}
                        {totalTasks > 0 ? (
                          <div className="space-y-1.5 pr-8">
                            <div className={`h-1.5 ${colors.progressTrack} rounded-full overflow-hidden`}>
                              <div
                                className={`h-full ${colors.progressFill} rounded-full transition-all duration-500`}
                                style={{ width: `${progressPercent}%` }}
                              />
                            </div>
                            <div className={`flex items-center justify-between text-xs font-semibold ${colors.accent}`}>
                              <span className="truncate mr-2">{completedTasks}/{totalTasks} tasks</span>
                              <span className="flex-shrink-0">{Math.round(progressPercent)}%</span>
                            </div>
                          </div>
                        ) : (
                          <div className="h-[34px]" /> // Spacer to match progress section height
                        )}

                        {/* Deadline */}
                        {(() => {
                          const deadline = getStageDeadline(stage.id)
                          if (!deadline) return null

                          const deadlineStatus = getDeadlineStatus(deadline.deadline_date)
                          const getDaysUntilDeadline = (dateString: string) => {
                            const deadline = new Date(dateString)
                            const today = new Date()
                            today.setHours(0, 0, 0, 0)
                            deadline.setHours(0, 0, 0, 0)
                            const diffTime = deadline.getTime() - today.getTime()
                            return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
                          }

                          const daysUntil = getDaysUntilDeadline(deadline.deadline_date)
                          const statusText = daysUntil < 0 ? `${Math.abs(daysUntil)}d overdue` :
                                           daysUntil === 0 ? 'Today' :
                                           `${daysUntil}d remaining`

                          const badgeStyles = {
                            overdue: 'bg-red-600 text-white',
                            today: 'bg-orange-500 text-white',
                            urgent: 'bg-amber-500 text-white',
                            upcoming: 'bg-black/10'
                          }

                          return (
                            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md ${badgeStyles[deadlineStatus]} text-xs font-semibold`}>
                              <Calendar className="w-3 h-3" strokeWidth={2} />
                              <span>{statusText}</span>
                            </div>
                          )
                        })()}
                      </div>
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Mobile Timeline */}
        <div className="md:hidden">
          <div className="space-y-3">
            {timelineStages.map((stage, index) => {
              const status = getStageStatus(index)

              return (
                <button
                  key={stage.id}
                  onClick={() => handleStageClick(stage, index)}
                  className={`w-full flex items-center p-3 rounded-lg border transition-all ${
                    status === 'current'
                      ? 'border-blue-500 bg-blue-50'
                      : status === 'completed'
                      ? 'border-green-500 bg-green-50'
                      : 'border-gray-200 bg-gray-50'
                  } hover:shadow-md cursor-pointer ${
                    showStageDetails === stage.id ? 'ring-2 ring-blue-200' : ''
                  }`}
                  title={`Click to view ${stage.label} stage tasks and details`}
                >
                  <div className={`relative w-8 h-8 rounded-full ${getStageColor(status, index)} flex items-center justify-center mr-3`}>
                    {status === 'completed' ? (
                      <Check className="w-4 h-4 text-white" />
                    ) : status === 'current' ? (
                      <div className="w-2 h-2 bg-white rounded-full" />
                    ) : (
                      <div className="w-2 h-2 bg-white rounded-full" />
                    )}

                    {/* Deadline Indicator for Mobile */}
                    {(() => {
                      const deadline = getStageDeadline(stage.id)
                      if (!deadline) return null

                      const deadlineStatus = getDeadlineStatus(deadline.deadline_date)
                      const statusConfig = {
                        overdue: { bg: 'bg-red-500' },
                        today: { bg: 'bg-orange-500' },
                        urgent: { bg: 'bg-yellow-500' },
                        upcoming: { bg: 'bg-blue-500' }
                      }
                      const config = statusConfig[deadlineStatus]

                      return (
                        <div className={`absolute -top-1 -right-1 w-4 h-4 rounded-full ${config.bg} flex items-center justify-center`}>
                          <Calendar className="w-2 h-2 text-white" />
                        </div>
                      )
                    })()}
                  </div>
                  <div className="flex-1 text-left">
                    <div className={`font-medium ${getTextColor(status)}`}>
                      {stage.label}
                    </div>
                    <div className="text-xs text-gray-500">
                      {stage.description}
                    </div>
                    {(() => {
                      const deadline = getStageDeadline(stage.id)
                      if (!deadline) return null

                      const deadlineStatus = getDeadlineStatus(deadline.deadline_date)
                      const getDaysUntilDeadline = (dateString: string) => {
                        const deadline = new Date(dateString)
                        const today = new Date()
                        today.setHours(0, 0, 0, 0)
                        deadline.setHours(0, 0, 0, 0)
                        const diffTime = deadline.getTime() - today.getTime()
                        return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
                      }

                      const daysUntil = getDaysUntilDeadline(deadline.deadline_date)
                      const statusText = daysUntil < 0 ? `${Math.abs(daysUntil)}d overdue` :
                                       daysUntil === 0 ? 'Due today' :
                                       daysUntil === 1 ? 'Due tomorrow' :
                                       `${daysUntil}d left`

                      const textColor = deadlineStatus === 'overdue' ? 'text-red-600' :
                                       deadlineStatus === 'today' ? 'text-orange-600' :
                                       deadlineStatus === 'urgent' ? 'text-yellow-600' : 'text-blue-600'

                      return (
                        <div className={`text-xs ${textColor} font-medium mt-1`}>
                          {statusText}
                        </div>
                      )
                    })()}
                  </div>
                  <div className="flex flex-col items-end space-y-1">
                    {status === 'current' && (
                      <Badge variant="primary" size="sm">
                        Current
                      </Badge>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Stage Details Modal/Card */}
      {showStageDetails && (
        <Card key={`${workflowId}-${showStageDetails}`} className="transition-all duration-300 animate-in fade-in slide-in-from-top-4">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center space-x-3">
              <div className={`w-10 h-10 rounded-full ${getStageColor(getStageStatus(timelineStages.findIndex(s => s.id === showStageDetails)), timelineStages.findIndex(s => s.id === showStageDetails))} flex items-center justify-center`}>
                {getStageStatus(timelineStages.findIndex(s => s.id === showStageDetails)) === 'completed' ? (
                  <Check className="w-5 h-5 text-white" />
                ) : (
                  <Info className="w-5 h-5 text-white" />
                )}
              </div>
              <div className="flex-1">
                <h4 className="text-lg font-semibold text-gray-900">
                  {timelineStages.find(s => s.id === showStageDetails)?.label} Stage
                </h4>
                <p className="text-sm text-gray-600 mb-3">
                  {assetSymbol && `For ${assetSymbol} • `}
                  {timelineStages.find(s => s.id === showStageDetails)?.description}
                </p>
              </div>
            </div>

            {/* Stage Assignment Section - Upper Right */}
            {showStageDetails && showStageDetails !== 'completed' && showStageDetails !== 'outdated' && assetId && workflowId && (
              <div className="flex-shrink-0">
                <AssignmentSelector
                  assetId={assetId}
                  workflowId={workflowId}
                  stageId={showStageDetails}
                  type="stage"
                >
                  {/* Stage Deadline - Below Assigned To */}
                  <div className="mt-2">
                    <StageDeadlineManager
                      assetId={assetId || ''}
                      stageId={showStageDetails}
                      stageName={timelineStages.find(s => s.id === showStageDetails)?.label || ''}
                      isCurrentStage={showStageDetails === effectiveCurrentStage}
                    />
                  </div>
                </AssignmentSelector>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-6">

            {/* Completed — process summary */}
            {showStageDetails === 'completed' && (() => {
              const realStages = timelineStages.filter(s => s.id !== 'completed')
              const allItems = realStages.flatMap(s => stageChecklists[s.id] || [])
              const totalDone = allItems.filter(i => isItemDone(i)).length
              const totalSkipped = allItems.filter(i => i.status === 'na').length

              // Group commentaries by checklist_item_id
              const commentaryByItem = new Map<string, typeof allCommentaries>()
              for (const c of allCommentaries) {
                const list = commentaryByItem.get(c.checklist_item_id) || []
                list.push(c)
                commentaryByItem.set(c.checklist_item_id, list)
              }

              // Build findings: items that have commentary
              const findings = realStages.flatMap(stage =>
                (stageChecklists[stage.id] || [])
                  .filter(i => i.item_type === 'thinking' && i.dbId && commentaryByItem.has(i.dbId))
                  .map(i => ({ item: i, stageLabel: stage.label, entries: commentaryByItem.get(i.dbId!) || [] }))
              )

              return (
                <div className="space-y-4">
                  {/* Stats row */}
                  <div className="flex items-center gap-4 text-[12px] text-gray-500">
                    <span>{realStages.length} stages</span>
                    <span className="text-gray-300">·</span>
                    <span>{totalDone} completed</span>
                    {totalSkipped > 0 && <><span className="text-gray-300">·</span><span>{totalSkipped} skipped</span></>}
                  </div>

                  {/* Key findings — grouped by item, showing each person's commentary */}
                  {findings.length > 0 && (
                    <div>
                      <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2.5">Key Findings</h4>
                      <div className="space-y-4">
                        {findings.map(({ item: fi, stageLabel, entries }) => (
                          <div key={fi.id}>
                            <p className="text-[11px] font-medium text-gray-500 mb-1">{fi.text} <span className="text-gray-400 font-normal">· {stageLabel}</span></p>
                            <div className="space-y-1.5 pl-2 border-l-2 border-gray-100">
                              {entries.map((entry: any) => {
                                const u = Array.isArray(entry.user) ? entry.user[0] : entry.user
                                return (
                                  <div key={entry.checklist_item_id + '-' + entry.user_id}>
                                    <p className="text-[13px] text-gray-800 leading-relaxed">{entry.comment_text}</p>
                                    <p className="text-[10px] text-gray-400 mt-0.5">{u ? `${u.first_name || u.email?.split('@')[0] || 'Unknown'}` : 'Unknown'}</p>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {findings.length === 0 && (
                    <p className="text-[12px] text-gray-400 py-2">No commentary was captured during this process.</p>
                  )}
                </div>
              )
            })()}

            {/* Stage Checklist for non-outdated and non-completed stages */}
            {showStageDetails && showStageDetails !== 'outdated' && showStageDetails !== 'completed' && stageChecklists[showStageDetails] && (
              <div>
                {(() => {
                  const items = stageChecklists[showStageDetails] || []
                  const isEditable = isStageEditable(showStageDetails)
                  const doneCount = items.filter(i => isItemDone(i)).length

                  return (
                    <>
                      <div className="mb-2 px-1 text-[10px] text-gray-400">{doneCount}/{items.length} complete</div>
                      <div className="space-y-1.5">
                        {items.map(item => {
                          const props = {
                            item, stageId: showStageDetails, assetId, workflowId, isEditable,
                            isExpanded: expandedItemId === item.id,
                            onToggleExpand: () => setExpandedItemId(expandedItemId === item.id ? null : item.id),
                            onToggleStatus: () => handleChecklistToggle(showStageDetails, item.id),
                            onRemoveCustom: item.isCustom ? () => handleRemoveCustomItem(showStageDetails, item.id) : undefined,
                            currentUser: user,
                          }
                          return (item.item_type || 'operational') === 'thinking'
                            ? <DecisionItemCard key={item.id} {...props} />
                            : <OperationalItemCard key={item.id} {...props} />
                        })}
                      </div>
                    </>
                  )
                })()}

                  {/* Add Item */}
                  {showStageDetails && showStageDetails !== 'outdated' && !workflowProgress?.is_completed && (
                    <div className="mt-2">
                      {addingItemToStage === showStageDetails ? (
                        <div className="p-2.5 rounded-md border border-gray-200 bg-gray-50/50">
                          {/* Type selector */}
                          <div className="flex items-center gap-1.5 mb-2">
                            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mr-1">Type</span>
                            <button
                              onClick={() => setNewItemType('operational')}
                              className={`flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded border transition-colors ${
                                newItemType === 'operational'
                                  ? 'bg-gray-900 text-white border-gray-900'
                                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                              }`}
                            >
                              <Settings2 className="w-3 h-3" />Task
                            </button>
                            <button
                              onClick={() => setNewItemType('thinking')}
                              className={`flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded border transition-colors ${
                                newItemType === 'thinking'
                                  ? 'bg-gray-900 text-white border-gray-900'
                                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                              }`}
                            >
                              <BrainCircuit className="w-3 h-3" />Analysis
                            </button>
                          </div>
                          {/* Title input */}
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={newItemText}
                              onChange={(e) => setNewItemText(e.target.value)}
                              placeholder={newItemType === 'thinking' ? "What question needs answering?" : "What task needs to be done?"}
                              className="flex-1 px-2.5 py-1.5 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-gray-400 bg-white"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && newItemText.trim()) handleAddCustomItem(showStageDetails)
                                if (e.key === 'Escape') { setAddingItemToStage(null); setNewItemText('') }
                              }}
                            />
                            <button
                              onClick={() => handleAddCustomItem(showStageDetails)}
                              disabled={!newItemText.trim()}
                              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                                newItemText.trim()
                                  ? 'bg-gray-900 text-white hover:bg-gray-800'
                                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                              }`}
                            >
                              Add
                            </button>
                            <button
                              onClick={() => { setAddingItemToStage(null); setNewItemText('') }}
                              className="text-gray-400 hover:text-gray-600 p-1"
                            >
                              <Plus className="w-3.5 h-3.5 rotate-45" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setAddingItemToStage(showStageDetails)}
                          className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-700 hover:bg-gray-50 px-2 py-1.5 rounded transition-colors w-full"
                        >
                          <Plus className="w-3 h-3" />
                          <span>Add item</span>
                        </button>
                      )}
                    </div>
                  )}
              </div>
            )}

            {/* Content Tiles for non-outdated and non-completed stages */}
            {showStageDetails && showStageDetails !== 'outdated' && showStageDetails !== 'completed' && contentTiles && contentTiles.length > 0 && (
              <div className="mt-6">
                <div className="space-y-4">
                  {contentTiles.map((tile) => (
                    <ContentTile
                      key={tile.id}
                      tile={tile}
                      assetId={assetId}
                      assetSymbol={assetSymbol}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Content Tiles for outdated stage */}
            {showStageDetails === 'outdated' && assetId && contentTiles && contentTiles.length > 0 && (
              <div className="mt-6">
                <div className="space-y-4">
                  {contentTiles.map((tile) => (
                    <ContentTile
                      key={tile.id}
                      tile={tile}
                      assetId={assetId}
                      assetSymbol={assetSymbol}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Stage Progression Actions */}
          <div className="mt-6 pt-4 border-t border-gray-200">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-600">
                <div>Stage {currentIndex + 1} of {timelineStages.length}</div>
                {showStageDetails === effectiveCurrentStage && (
                  <div className="text-xs mt-1 text-blue-600">
                    {effectiveCurrentStage === 'outdated'
                      ? '✓ Portfolio review stage - ready to prioritize'
                      : `${stageChecklists[effectiveCurrentStage]?.filter(item => isItemDone(item)).length || 0} of ${stageChecklists[effectiveCurrentStage]?.length || 0} items completed`
                    }
                  </div>
                )}
              </div>

              {/* Stage Action Buttons */}
              <div className="flex items-center space-x-2">
                {currentIndex > 0 && isWorkflowStarted && !workflowProgress?.is_completed && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleRegressStage}
                    className="text-gray-600 hover:text-gray-800"
                  >
                    ← Move to {timelineStages[currentIndex - 1]?.label}
                  </Button>
                )}

                {currentIndex < timelineStages.length - 1 && isWorkflowStarted && !workflowProgress?.is_completed && (
                  <Button
                    size="sm"
                    onClick={handleAdvanceStage}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                    title={timelineStages[currentIndex + 1]?.id === 'completed' ? 'Complete process' : 'Advance to next stage'}
                  >
                    {timelineStages[currentIndex + 1]?.id === 'completed' ? 'Complete Process ✓' : 'Advance Stage →'}
                  </Button>
                )}

                {currentIndex === timelineStages.length - 1 && showStageDetails === effectiveCurrentStage && effectiveCurrentStage === 'completed' && (
                  <div className="text-sm text-green-600 font-medium">
                    🎉 Process completed!
                  </div>
                )}
              </div>
            </div>
          </div>
        </Card>
      )}

    </div>
  )
}