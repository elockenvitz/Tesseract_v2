import React, { useState } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { Check, Info, AlertTriangle, Calendar, Users, MessageSquare, X, Plus, Trash2, Edit3, Paperclip, Upload, Download, FileText, ChevronDown, Zap, Target, Clock } from 'lucide-react'
import { Badge } from './Badge'
import { BadgeSelect } from './BadgeSelect'
import { Button } from './Button'
import { Card } from './Card'
import { StageDeadlineManager } from './StageDeadlineManager'
import { ContentTile } from './ContentTile'
import { MentionInput } from './MentionInput'
import { AssignmentSelector } from './AssignmentSelector'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

interface ChecklistItem {
  id: string
  text: string
  completed: boolean
  comment?: string
  completedAt?: string
  isCustom?: boolean
  sortOrder?: number
  attachments?: ChecklistAttachment[]
  dbId?: string
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
  const [stageChecklists, setStageChecklists] = useState<Record<string, ChecklistItem[]>>({})
  const [commentingItem, setCommentingItem] = useState<{stageId: string, itemId: string} | null>(null)
  const [commentText, setCommentText] = useState('')
  const [commentMentions, setCommentMentions] = useState<string[]>([])
  const [commentReferences, setCommentReferences] = useState<Array<{type: string, id: string, text: string}>>([])
  const [editingComment, setEditingComment] = useState<{id: string, text: string} | null>(null)
  const [assigningItem, setAssigningItem] = useState<{stageId: string, itemId: string, dbId: string} | null>(null)
  const [showingCommentsFor, setShowingCommentsFor] = useState<{stageId: string, itemId: string} | null>(null)
  const [showingAttachmentsFor, setShowingAttachmentsFor] = useState<{stageId: string, itemId: string} | null>(null)
  const [isDraggingOver, setIsDraggingOver] = useState<string | null>(null)
  const [addingItemToStage, setAddingItemToStage] = useState<string | null>(null)
  const [newItemText, setNewItemText] = useState('')
  const [uploadingFiles, setUploadingFiles] = useState<{[key: string]: boolean}>({})
  const [showPriorityDropdown, setShowPriorityDropdown] = useState(false)
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
          isCustom: false
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

      const { data, error } = await supabase
        .from('workflow_stages')
        .select('*')
        .eq('workflow_id', workflowId)
        .order('sort_order')

      if (error) throw error
      return data || []
    },
    enabled: !!workflowId
  })

  // Query to load workflow checklist templates
  const { data: workflowChecklistTemplates } = useQuery({
    queryKey: ['workflow-checklist-templates', workflowId],
    queryFn: async () => {
      if (!workflowId) return []

      const { data, error } = await supabase
        .from('workflow_checklist_templates')
        .select('*')
        .eq('workflow_id', workflowId)
        .order('stage_id, sort_order')

      if (error) throw error
      return data || []
    },
    enabled: !!workflowId
  })

  // Query to load existing checklist items from DB (to get dbIds for assignment display)
  const { data: existingChecklistItems } = useQuery({
    queryKey: ['existing-checklist-items', assetId, workflowId],
    queryFn: async () => {
      if (!assetId || !workflowId) return []

      const { data, error} = await supabase
        .from('asset_checklist_items')
        .select('id, stage_id, item_id')
        .eq('asset_id', assetId)
        .eq('workflow_id', workflowId)

      if (error) throw error
      return data || []
    },
    enabled: !!assetId && !!workflowId
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
    enabled: !!assetId && !!workflowId
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
    enabled: !!assetId && !!workflowId
  })

  // Query to load task assignments for all checklist items
  const { data: taskAssignments } = useQuery({
    queryKey: ['task-assignments-all', assetId, workflowId],
    queryFn: async () => {
      if (!assetId || !workflowId) return []

      // Get all checklist items for this asset/workflow
      const { data: checklistItems, error: itemsError } = await supabase
        .from('asset_checklist_items')
        .select('id, item_id, stage_id')
        .eq('asset_id', assetId)
        .eq('workflow_id', workflowId)

      if (itemsError) throw itemsError
      if (!checklistItems || checklistItems.length === 0) return []

      // Get assignments for these items
      const itemIds = checklistItems.map(item => item.id)
      const { data: assignments, error: assignmentsError } = await supabase
        .from('checklist_task_assignments')
        .select(`
          *,
          user:users!checklist_task_assignments_assigned_user_id_fkey(id, email, first_name, last_name)
        `)
        .in('checklist_item_id', itemIds)

      if (assignmentsError) throw assignmentsError

      // Map assignments to item_id + stage_id for easy lookup
      const assignmentMap: Record<string, any[]> = {}
      assignments?.forEach(assignment => {
        const item = checklistItems.find(ci => ci.id === assignment.checklist_item_id)
        if (item) {
          const key = `${item.stage_id}-${item.item_id}`
          if (!assignmentMap[key]) assignmentMap[key] = []
          assignmentMap[key].push(assignment)
        }
      })

      return assignmentMap
    },
    enabled: !!assetId && !!workflowId
  })

  // Query to load comments for all checklist items
  const { data: itemComments } = useQuery({
    queryKey: ['checklist-item-comments', assetId, workflowId],
    queryFn: async () => {
      if (!assetId || !workflowId) return {}

      // Get all checklist items for this asset/workflow
      const { data: checklistItems, error: itemsError } = await supabase
        .from('asset_checklist_items')
        .select('id, item_id, stage_id')
        .eq('asset_id', assetId)
        .eq('workflow_id', workflowId)

      if (itemsError) throw itemsError
      if (!checklistItems || checklistItems.length === 0) return {}

      // Get comments for these items
      const itemIds = checklistItems.map(item => item.id)
      const { data: comments, error: commentsError } = await supabase
        .from('checklist_item_comments')
        .select(`
          *,
          user:users!checklist_item_comments_user_id_fkey(id, email, first_name, last_name)
        `)
        .in('checklist_item_id', itemIds)
        .order('created_at', { ascending: true })

      if (commentsError) throw commentsError

      // Map comments to item_id + stage_id for easy lookup
      const commentsMap: Record<string, any[]> = {}
      comments?.forEach(comment => {
        const item = checklistItems.find(ci => ci.id === comment.checklist_item_id)
        if (item) {
          const key = `${item.stage_id}-${item.item_id}`
          if (!commentsMap[key]) commentsMap[key] = []
          commentsMap[key].push(comment)
        }
      })

      return commentsMap
    },
    enabled: !!assetId && !!workflowId
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
      alert('Failed to save workflow priority. Please try again.')
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
    console.log('InvestmentTimeline: workflowId:', workflowId, 'workflowStages:', workflowStages, 'workflowChecklistTemplates:', workflowChecklistTemplates)

    if (!workflowId || !workflowStages || workflowStages.length === 0) {
      // Fallback to hardcoded stages if no workflow is selected
      console.log('InvestmentTimeline: Using hardcoded TIMELINE_STAGES')
      return TIMELINE_STAGES
    }

    console.log('InvestmentTimeline: Converting workflow stages to timeline stages')
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
      description: 'Workflow completed successfully',
      checklist: []
    })

    return stages
  }, [workflowId, workflowStages, workflowChecklistTemplates])

  // Check if this specific workflow is started for this asset
  const isWorkflowStarted = workflowProgress?.is_started || false

  // Use workflow-specific current stage if workflow is started, otherwise use first stage
  const effectiveCurrentStage = isWorkflowStarted && workflowProgress?.current_stage_key
    ? workflowProgress.current_stage_key
    : timelineStages?.[0]?.id || 'outdated'

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
      alert('Failed to update workflow. Please try again.')
    }
  })


  // Query to load workflow-specific checklist state from database
  const { data: savedChecklistItems } = useQuery({
    queryKey: ['asset-workflow-checklist', assetId, workflowId],
    queryFn: async () => {
      if (!assetId || !workflowId) return []
      const { data, error } = await supabase
        .from('asset_checklist_items')
        .select('*')
        .eq('asset_id', assetId)
        .eq('workflow_id', workflowId)
        .order('sort_order', { ascending: true })
      if (error) throw error
      return data || []
    },
    enabled: !!assetId && !!workflowId
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
    enabled: !!assetId && !!workflowId
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
    enabled: !!assetId && !!workflowId
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
    enabled: !!workflowId && !!showStageDetails
  })

  // Mutation to save checklist item changes
  const saveChecklistItemMutation = useMutation({
    mutationFn: async ({ assetId, stageId, itemId, completed, comment, completedAt }: {
      assetId: string
      stageId: string
      itemId: string
      completed: boolean
      comment?: string
      completedAt?: string
    }) => {
      const { error } = await supabase
        .from('asset_checklist_items')
        .upsert({
          asset_id: assetId,
          workflow_id: workflowId,
          stage_id: stageId,
          item_id: itemId,
          completed,
          comment: comment || null,
          completed_at: completedAt || null
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
      console.log('⚠️ Checklist initialization skipped: timelineStages is empty')
      return
    }

    console.log('🔄 Initializing checklists for', timelineStages.length, 'stages')
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
            comment: savedItem.comment || undefined,
            completedAt: savedItem.completed_at || undefined,
            sortOrder: index,
            dbId: existingItem?.id,
            attachments: checklistAttachments?.filter(
              att => att.stage_id === stage.id && att.item_id === item.id
            ) || []
          }
        }

        return {
          ...item,
          sortOrder: index,
          dbId: existingItem?.id,
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
          comment: saved.comment || undefined,
          completedAt: saved.completed_at || undefined,
          isCustom: true,
          sortOrder: saved.sort_order || 999,
          dbId: existingItem?.id,
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
      console.log(`  ✓ Stage ${stage.id}: ${allItems.length} items`)
    })

    console.log('✅ Setting stageChecklists with', Object.keys(initialChecklists).length, 'stages')
    setStageChecklists(initialChecklists)
  }, [assetId, savedChecklistItems, checklistAttachments, timelineStages, workflowChecklistTemplates, existingChecklistItems])

  // Automatically select the current stage when component loads (but only if no stage is selected)
  // Only run after workflow stages have loaded to avoid selecting wrong stage
  React.useEffect(() => {
    // Don't auto-select if workflow data is still loading
    if (!workflowId) return
    if (workflowId && !workflowStages) return // Wait for workflowStages to load

    if (effectiveCurrentStage && !showStageDetails) {
      console.log(`🎬 Auto-selecting initial stage: ${effectiveCurrentStage}`)
      setShowStageDetails(effectiveCurrentStage)
      onStageClick(effectiveCurrentStage)
    }
  }, [effectiveCurrentStage, showStageDetails, onStageClick, workflowId, workflowStages])

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
      console.log(`🔄 External request to view stage: ${viewingStageId}`)
      setShowStageDetails(viewingStageId)
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
        console.log(`⚠️ Current stage ${showStageDetails} doesn't exist in workflow, resetting to first stage`)
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
    const currentIndex = getCurrentStageIndex()
    if (stageIndex < currentIndex) return 'completed'
    if (stageIndex === currentIndex) return 'current'
    return 'upcoming'
  }

  const getStageColor = (status: string, stageIndex: number) => {
    if (status === 'upcoming') return 'bg-gray-300'

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
      case 'upcoming': return 'text-gray-500'
      default: return 'text-gray-500'
    }
  }

  const handleStageClick = (stage: TimelineStage, index: number) => {
    // Allow viewing all stages regardless of workflow state
    console.log(`🎯 User clicked stage: ${stage.label} (${stage.id})`)
    onStageClick(stage.id)
    setShowStageDetails(stage.id)
    // Clear the viewing stage override to allow manual selection
    if (onViewingStageChange) {
      onViewingStageChange(null)
    }
  }

  const isCurrentStageCompleted = () => {
    const currentIndex = getCurrentStageIndex()
    const currentStageId = TIMELINE_STAGES[currentIndex]?.id
    if (!currentStageId) return false

    // Outdated stage is always considered "complete" since it has no checklist
    if (currentStageId === 'outdated') return true

    if (!stageChecklists[currentStageId]) return false

    return stageChecklists[currentStageId].every(item => item.completed)
  }

  const isStageEditable = (stageId: string) => {
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

      // Update completion timestamps for all completed items in current stage
      const currentStageItems = stageChecklists[currentStageId] || []
      const updatePromises = currentStageItems
        .filter(item => item.completed && !item.completedAt)
        .map(item =>
          saveChecklistItemMutation.mutateAsync({
            assetId,
            stageId: currentStageId,
            itemId: item.id,
            completed: item.completed,
            comment: item.comment,
            completedAt: currentTime
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
      alert('This checklist is locked. You can only edit items from the current stage.')
      return
    }

    if (!assetId) {
      alert('No asset ID available. Cannot save checklist changes.')
      return
    }

    const currentItem = stageChecklists[stageId]?.find(item => item.id === itemId)
    if (!currentItem) return

    const newCompleted = !currentItem.completed
    const newCompletedAt = newCompleted ? new Date().toISOString() : undefined

    // Update local state immediately for responsiveness
    setStageChecklists(prev => ({
      ...prev,
      [stageId]: prev[stageId]?.map(item =>
        item.id === itemId ? {
          ...item,
          completed: newCompleted,
          completedAt: newCompletedAt
        } : item
      ) || []
    }))

    // Save to database
    saveChecklistItemMutation.mutate({
      assetId,
      stageId,
      itemId,
      completed: newCompleted,
      comment: currentItem.comment,
      completedAt: newCompletedAt
    })
  }

  const handleAddComment = (stageId: string, itemId: string) => {
    setCommentingItem({ stageId, itemId })
    setCommentText('')
    setCommentMentions([])
    setCommentReferences([])
    // Also show the comments thread
    setShowingCommentsFor({ stageId, itemId })
  }

  const handleToggleComments = (stageId: string, itemId: string) => {
    const key = `${stageId}-${itemId}`
    const isCurrentlyShowing = showingCommentsFor?.stageId === stageId && showingCommentsFor?.itemId === itemId

    if (isCurrentlyShowing) {
      setShowingCommentsFor(null)
    } else {
      setShowingCommentsFor({ stageId, itemId })
    }
  }

  const handleSaveComment = async () => {
    if (!commentingItem || !assetId || !user || !workflowId) {
      console.log('Missing required data for saving comment:', { commentingItem, assetId, userId: user?.id, workflowId })
      return
    }

    const trimmedComment = commentText.trim()
    if (!trimmedComment) {
      console.log('Empty comment text')
      return
    }

    try {
      // Get checklist item ID from database first, or create it if it doesn't exist
      let { data: checklistItem, error: checklistError } = await supabase
        .from('asset_checklist_items')
        .select('id')
        .eq('asset_id', assetId)
        .eq('workflow_id', workflowId)
        .eq('stage_id', commentingItem.stageId)
        .eq('item_id', commentingItem.itemId)
        .maybeSingle()

      if (checklistError) {
        console.error('Error fetching checklist item:', checklistError)
        return
      }

      // If checklist item doesn't exist, create it
      if (!checklistItem) {
        console.log('Checklist item not found, creating it...')

        // Find the checklist item text from the workflow template
        const stage = timelineStages?.find(s => s.id === commentingItem.stageId)
        const item = stage?.checklist.find(i => i.id === commentingItem.itemId)

        if (!item) {
          console.error('Could not find item in workflow template')
          return
        }

        const { data: newItem, error: createError } = await supabase
          .from('asset_checklist_items')
          .insert({
            asset_id: assetId,
            workflow_id: workflowId,
            stage_id: commentingItem.stageId,
            item_id: commentingItem.itemId,
            item_text: item.text,
            completed: false,
            created_by: user.id
          })
          .select('id')
          .single()

        if (createError) {
          console.error('Error creating checklist item:', createError)
          return
        }

        checklistItem = newItem
        console.log('Created checklist item:', checklistItem)
      }

      // Save the comment to the new comments table
      const { error: commentError } = await supabase
        .from('checklist_item_comments')
        .insert({
          checklist_item_id: checklistItem.id,
          user_id: user.id,
          comment_text: trimmedComment
        })

      if (commentError) {
        console.error('Error saving comment:', commentError)
        return
      }

      // Save mentions to database if any
      if (commentMentions.length > 0) {
        for (const [index, mentionedUserId] of commentMentions.entries()) {
          const { error: mentionError } = await supabase
            .from('checklist_comment_mentions')
            .insert({
              checklist_item_id: checklistItem.id,
              mentioned_user_id: mentionedUserId,
              mentioned_by: user.id,
              comment_text: trimmedComment,
              mention_position: index
            })

          if (mentionError) {
            console.error('Error saving mention:', mentionError)
          }
        }
      }

      // Save references to database if any
      if (commentReferences.length > 0) {
        for (const reference of commentReferences) {
          const { error: refError } = await supabase
            .from('checklist_comment_references')
            .insert({
              checklist_item_id: checklistItem.id,
              reference_type: reference.type,
              reference_id: reference.id,
              reference_text: reference.text,
              created_by: user.id
            })

          if (refError) {
            console.error('Error saving reference:', refError)
          }
        }
      }

      // Invalidate queries to refetch comments
      queryClient.invalidateQueries({ queryKey: ['checklist-item-comments', assetId, workflowId] })

      // Reset state
      setCommentingItem(null)
      setCommentText('')
      setCommentMentions([])
      setCommentReferences([])

      console.log('Comment saved successfully')
    } catch (error) {
      console.error('Unexpected error saving comment:', error)
    }
  }

  const handleCancelComment = () => {
    setCommentingItem(null)
    setCommentText('')
    setCommentMentions([])
    setCommentReferences([])
    setEditingComment(null)
  }

  const handleEditComment = (commentId: string, currentText: string) => {
    setEditingComment({ id: commentId, text: currentText })
  }

  const handleUpdateComment = async (commentId: string) => {
    if (!editingComment || !user) return

    const trimmedText = editingComment.text.trim()
    if (!trimmedText) return

    try {
      const { error } = await supabase
        .from('checklist_item_comments')
        .update({
          comment_text: trimmedText,
          is_edited: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', commentId)
        .eq('user_id', user.id) // Only allow updating own comments

      if (error) {
        console.error('Error updating comment:', error)
        return
      }

      // Invalidate queries to refetch comments
      queryClient.invalidateQueries({ queryKey: ['checklist-item-comments', assetId, workflowId] })

      setEditingComment(null)
    } catch (error) {
      console.error('Unexpected error updating comment:', error)
    }
  }

  const handleDeleteComment = async (commentId: string) => {
    if (!user || !confirm('Are you sure you want to delete this comment?')) return

    try {
      const { error } = await supabase
        .from('checklist_item_comments')
        .delete()
        .eq('id', commentId)
        .eq('user_id', user.id) // Only allow deleting own comments

      if (error) {
        console.error('Error deleting comment:', error)
        return
      }

      // Invalidate queries to refetch comments
      queryClient.invalidateQueries({ queryKey: ['checklist-item-comments', assetId, workflowId] })
    } catch (error) {
      console.error('Unexpected error deleting comment:', error)
    }
  }

  // Helper function to get or create checklist item database ID
  const getOrCreateChecklistItemId = async (stageId: string, itemId: string): Promise<string | null> => {
    if (!assetId || !user) return null

    try {
      // First, try to find existing checklist item
      const { data: existingItem, error: fetchError } = await supabase
        .from('asset_checklist_items')
        .select('id')
        .eq('asset_id', assetId)
        .eq('workflow_id', workflowId)
        .eq('stage_id', stageId)
        .eq('item_id', itemId)
        .maybeSingle()

      if (fetchError) {
        console.error('Error fetching checklist item:', fetchError)
        return null
      }

      if (existingItem) {
        return existingItem.id
      }

      // If not found, create it
      const stage = timelineStages?.find(s => s.id === stageId)
      const item = stage?.checklist.find(i => i.id === itemId)

      if (!item) {
        console.error('Could not find item in workflow template')
        return null
      }

      const { data: newItem, error: createError } = await supabase
        .from('asset_checklist_items')
        .insert({
          asset_id: assetId,
          workflow_id: workflowId,
          stage_id: stageId,
          item_id: itemId,
          item_text: item.text,
          completed: false,
          created_by: user.id
        })
        .select('id')
        .single()

      if (createError) {
        console.error('Error creating checklist item:', createError)
        return null
      }

      return newItem.id
    } catch (error) {
      console.error('Unexpected error getting/creating checklist item:', error)
      return null
    }
  }

  const handleOpenAssignment = async (stageId: string, itemId: string) => {
    console.log('👥 handleOpenAssignment called for stage:', stageId, 'item:', itemId)
    const dbId = await getOrCreateChecklistItemId(stageId, itemId)
    console.log('👥 Got dbId:', dbId)
    if (dbId) {
      console.log('👥 Setting assigningItem to:', { stageId, itemId, dbId })
      setAssigningItem({ stageId, itemId, dbId })
      // Invalidate to refresh dbIds in case item was just created
      queryClient.invalidateQueries({ queryKey: ['existing-checklist-items', assetId, workflowId] })
    }
  }

  const handleOpenConversation = async (userId: string) => {
    if (!user) return

    console.log('💬 Opening conversation with user:', userId)

    try {
      // Find existing direct message conversation between the two users
      const { data: existingParticipants, error: fetchError } = await supabase
        .from('conversation_participants')
        .select('conversation_id, conversations!inner(is_group)')
        .eq('user_id', user.id)

      if (fetchError) {
        console.error('Error fetching conversations:', fetchError)
        throw fetchError
      }

      console.log('📝 Found participant records:', existingParticipants?.length)

      // Check each conversation to see if it's a DM with the target user
      let conversationId: string | null = null
      if (existingParticipants) {
        for (const participant of existingParticipants) {
          // Only check non-group conversations
          if (!(participant.conversations as any).is_group) {
            const { data: otherParticipants, error: otherError } = await supabase
              .from('conversation_participants')
              .select('user_id')
              .eq('conversation_id', participant.conversation_id)
              .neq('user_id', user.id)

            if (otherError) continue

            // If this conversation has exactly one other participant and it's our target user
            if (otherParticipants && otherParticipants.length === 1 && otherParticipants[0].user_id === userId) {
              conversationId = participant.conversation_id
              break
            }
          }
        }
      }

      if (conversationId) {
        console.log('✅ Found existing conversation:', conversationId)
        // Dispatch custom event to open direct messages pane with conversation
        window.dispatchEvent(new CustomEvent('openDirectMessage', {
          detail: { conversationId }
        }))
      } else {
        console.log('🆕 Creating new conversation with user:', userId)
        // Create new conversation
        const { data: newConversation, error: createError } = await supabase
          .from('conversations')
          .insert({
            is_group: false,
            created_by: user.id
          })
          .select()
          .single()

        if (createError || !newConversation) {
          console.error('Error creating conversation:', createError)
          throw createError
        }

        console.log('✅ Created conversation:', newConversation.id)

        // Add participants
        const { error: participantsError } = await supabase
          .from('conversation_participants')
          .insert([
            { conversation_id: newConversation.id, user_id: user.id },
            { conversation_id: newConversation.id, user_id: userId }
          ])

        if (participantsError) {
          console.error('Error adding participants:', participantsError)
          throw participantsError
        }

        console.log('📨 Dispatching openDirectMessage event for new conversation')
        // Dispatch custom event to open direct messages pane with new conversation
        window.dispatchEvent(new CustomEvent('openDirectMessage', {
          detail: { conversationId: newConversation.id }
        }))
      }
    } catch (error) {
      console.error('Error opening conversation:', error)
    }
  }

  const handleAddCustomItem = async (stageId: string) => {
    if (!newItemText.trim() || !assetId) return

    try {
      const newItemId = `custom_${Date.now()}`
      const maxSortOrder = Math.max(
        ...(stageChecklists[stageId]?.map(item => item.sortOrder || 0) || [0])
      )

      // Save to database
      const { error } = await supabase
        .from('asset_checklist_items')
        .insert({
          asset_id: assetId,
          workflow_id: workflowId,
          stage_id: stageId,
          item_id: newItemId,
          item_text: newItemText.trim(),
          is_custom: true,
          completed: false,
          sort_order: maxSortOrder + 1,
          created_by: (await supabase.auth.getUser()).data.user?.id
        })

      if (error) throw error

      // Update local state
      setStageChecklists(prev => ({
        ...prev,
        [stageId]: [
          ...(prev[stageId] || []),
          {
            id: newItemId,
            text: newItemText.trim(),
            completed: false,
            isCustom: true,
            sortOrder: maxSortOrder + 1
          }
        ].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
      }))

      // Reset form
      setNewItemText('')
      setAddingItemToStage(null)

      // Refresh the query
      queryClient.invalidateQueries({ queryKey: ['asset-workflow-checklist', assetId, workflowId] })
    } catch (error) {
      console.error('Error adding custom item:', error)
      alert('Failed to add custom checklist item. Please try again.')
    }
  }

  const handleRemoveCustomItem = async (stageId: string, itemId: string) => {
    if (!assetId) return

    try {
      // Remove from database
      const { error } = await supabase
        .from('asset_checklist_items')
        .delete()
        .eq('asset_id', assetId)
        .eq('workflow_id', workflowId)
        .eq('stage_id', stageId)
        .eq('item_id', itemId)
        .eq('is_custom', true)

      if (error) throw error

      // Update local state
      setStageChecklists(prev => ({
        ...prev,
        [stageId]: prev[stageId]?.filter(item => item.id !== itemId) || []
      }))

      // Refresh the query
      queryClient.invalidateQueries({ queryKey: ['asset-workflow-checklist', assetId, workflowId] })
    } catch (error) {
      console.error('Error removing custom item:', error)
      alert('Failed to remove custom checklist item. Please try again.')
    }
  }

  const handleToggleAttachments = (stageId: string, itemId: string) => {
    const key = `${stageId}-${itemId}`
    const isCurrentlyShowing = showingAttachmentsFor?.stageId === stageId && showingAttachmentsFor?.itemId === itemId

    if (isCurrentlyShowing) {
      setShowingAttachmentsFor(null)
    } else {
      setShowingAttachmentsFor({ stageId, itemId })
    }
  }

  const handleDragOver = (e: React.DragEvent, stageId: string, itemId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOver(`${stageId}-${itemId}`)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOver(null)
  }

  const handleDrop = async (e: React.DragEvent, stageId: string, itemId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOver(null)

    const files = e.dataTransfer.files
    if (files.length > 0) {
      await handleFileUpload(stageId, itemId, files)
    }
  }

  const handleFileUpload = async (stageId: string, itemId: string, files: FileList) => {
    if (!assetId || !files.length) return

    const uploadKey = `${stageId}-${itemId}`
    setUploadingFiles(prev => ({ ...prev, [uploadKey]: true }))

    try {
      for (const file of Array.from(files)) {
        // Upload file to Supabase Storage
        const fileExt = file.name.split('.').pop()
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`
        const filePath = `checklist-attachments/${assetId}/${stageId}/${itemId}/${fileName}`

        console.log('Uploading file:', file.name, 'to path:', filePath)

        const { error: uploadError } = await supabase.storage
          .from('assets')
          .upload(filePath, file)

        if (uploadError) {
          console.error('Storage upload error:', uploadError)
          throw new Error(`Storage error: ${uploadError.message}`)
        }

        // Save attachment record to database
        const { data: user } = await supabase.auth.getUser()

        console.log('Saving attachment to database')
        const { error: dbError } = await supabase
          .from('asset_checklist_attachments')
          .insert({
            asset_id: assetId,
            workflow_id: workflowId,
            stage_id: stageId,
            item_id: itemId,
            file_name: file.name,
            file_path: filePath,
            file_size: file.size,
            file_type: file.type,
            uploaded_by: user.user?.id
          })

        if (dbError) {
          console.error('Database insert error:', dbError)
          throw new Error(`Database error: ${dbError.message}`)
        }

        console.log('File uploaded successfully')
      }

      // Refresh attachments
      queryClient.invalidateQueries({ queryKey: ['asset-workflow-checklist-attachments', assetId, workflowId] })
    } catch (error: any) {
      console.error('Error uploading file:', error)
      alert(`Failed to upload file: ${error.message || 'Unknown error'}. Please check the console for details.`)
    } finally {
      setUploadingFiles(prev => ({ ...prev, [uploadKey]: false }))
    }
  }

  const handleDeleteAttachment = async (attachmentId: string) => {
    try {
      // Get attachment details first
      const { data: attachment } = await supabase
        .from('asset_checklist_attachments')
        .select('file_path')
        .eq('id', attachmentId)
        .single()

      if (attachment) {
        // Delete file from storage
        await supabase.storage
          .from('assets')
          .remove([attachment.file_path])
      }

      // Delete attachment record
      const { error } = await supabase
        .from('asset_checklist_attachments')
        .delete()
        .eq('id', attachmentId)

      if (error) throw error

      // Refresh attachments
      queryClient.invalidateQueries({ queryKey: ['asset-workflow-checklist-attachments', assetId, workflowId] })
    } catch (error) {
      console.error('Error deleting attachment:', error)
      alert('Failed to delete attachment. Please try again.')
    }
  }

  const handleDownloadAttachment = async (attachment: ChecklistAttachment) => {
    try {
      const { data, error } = await supabase.storage
        .from('assets')
        .download(attachment.file_path)

      if (error) throw error

      // Create download link
      const url = URL.createObjectURL(data)
      const a = document.createElement('a')
      a.href = url
      a.download = attachment.file_name
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Error downloading file:', error)
      alert('Failed to download file. Please try again.')
    }
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
                        <span>Workflow: {current.label}</span>
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

        {/* Desktop Timeline */}
        <div className="hidden md:block">
          <div className="relative">
            {/* Stage Nodes */}
            <div className="relative flex justify-center gap-16 transition-all duration-500">
              {/* Single continuous progress line - positioned relative to first and last circles */}
              <div
                className="absolute top-8 h-1 bg-gray-200 rounded-full transition-all duration-500"
                style={{
                  left: `calc(50% - ${(timelineStages.length - 1) * 4}rem)`,
                  width: `${(timelineStages.length - 1) * 8}rem`,
                  zIndex: 0
                }}
              >
                <div
                  className={`h-full transition-all duration-500 rounded-full bg-gradient-to-r ${
                    currentIndex === timelineStages.length - 1
                      ? 'from-gray-600 via-blue-500 to-green-600'
                      : currentIndex > 0
                      ? 'from-gray-600 to-blue-500'
                      : 'from-gray-200 to-gray-200'
                  }`}
                  style={{
                    width: `${(currentIndex / (timelineStages.length - 1)) * 100}%`,
                    minWidth: currentIndex > 0 ? '2px' : '0'
                  }}
                />
              </div>

              {timelineStages.map((stage, index) => {
                const status = getStageStatus(index)
                const isOutdated = stage.id === 'outdated' || effectiveCurrentStage === 'outdated'
                const isFirstActiveStage = index === 1 && (effectiveCurrentStage === 'outdated' || timelineStages[0]?.id === 'outdated')

                return (
                  <React.Fragment key={stage.id}>
                    <div className="flex flex-col items-center relative z-10" style={{ maxWidth: '120px' }}>
                      {/* Stage Circle */}
                      <button
                        onClick={() => handleStageClick(stage, index)}
                        className={`relative z-10 w-16 h-16 rounded-full border-4 border-white shadow-lg transition-all duration-300 ${
                          getStageColor(status, index)
                        } hover:scale-110 cursor-pointer ${
                          showStageDetails === stage.id ? 'ring-4 ring-blue-200' : ''
                        }`}
                        title={`Click to view ${stage.label} stage tasks and details`}
                      >
                        <div className="flex items-center justify-center h-full">
                          {status === 'completed' ? (
                            <Check className="w-6 h-6 text-white" />
                          ) : status === 'current' ? (
                            <div className="w-3 h-3 bg-white rounded-full animate-pulse" />
                          ) : (
                            <div className="w-3 h-3 bg-white rounded-full" />
                          )}
                        </div>

                      {/* Deadline Indicator */}
                      {(() => {
                        const deadline = getStageDeadline(stage.id)
                        if (!deadline) return null

                        const deadlineStatus = getDeadlineStatus(deadline.deadline_date)
                        const statusConfig = {
                          overdue: { bg: 'bg-red-500', text: 'text-white', icon: '⚠️' },
                          today: { bg: 'bg-orange-500', text: 'text-white', icon: '📅' },
                          urgent: { bg: 'bg-yellow-500', text: 'text-white', icon: '⏰' },
                          upcoming: { bg: 'bg-blue-500', text: 'text-white', icon: '📆' }
                        }
                        const config = statusConfig[deadlineStatus]

                        return (
                          <div className={`absolute -top-2 -right-2 w-6 h-6 rounded-full ${config.bg} flex items-center justify-center text-xs shadow-lg`}>
                            <Calendar className="w-3 h-3 text-white" />
                          </div>
                        )
                      })()}
                    </button>

                    {/* Stage Label */}
                    <div className="mt-3 text-center w-full">
                      <div className={`text-sm font-medium ${getTextColor(status)} break-words`}>
                        {stage.label}
                      </div>
                      {status === 'current' && (
                        <Badge variant="primary" size="sm" className="mt-1">
                          Current
                        </Badge>
                      )}
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

                  </div>
                </React.Fragment>
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

            {/* Completed Stage Message */}
            {showStageDetails === 'completed' && (
              <div className="text-center py-8">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Check className="w-10 h-10 text-green-600" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                  🎉 Workflow Completed!
                </h3>
                <p className="text-gray-600">
                  All stages have been successfully completed for {assetSymbol || 'this asset'}.
                </p>
              </div>
            )}

            {/* Stage Checklist for non-outdated and non-completed stages */}
            {showStageDetails && showStageDetails !== 'outdated' && showStageDetails !== 'completed' && stageChecklists[showStageDetails] && (
              <div>
                <div className="mb-4">
                  <h5 className="font-medium text-gray-900 flex items-center">
                    <Calendar className="w-4 h-4 mr-2" />
                    Checklist
                    <span className="ml-2 text-xs text-gray-500">
                      ({stageChecklists[showStageDetails].filter(item => item.completed).length}/{stageChecklists[showStageDetails].length} completed)
                    </span>
                  </h5>
                </div>
                <div className="space-y-3">
                  {stageChecklists[showStageDetails].map((item) => {
                    const isEditable = isStageEditable(showStageDetails)
                    const isCommenting = commentingItem?.stageId === showStageDetails && commentingItem?.itemId === item.id

                    return (
                      <div key={item.id}>
                        <div
                          className={`flex items-start space-x-3 p-3 rounded-lg border transition-colors ${
                            isEditable
                              ? 'border-gray-200 hover:bg-gray-50'
                              : 'border-gray-100 bg-gray-50'
                          } ${
                            !isEditable ? 'opacity-75' : ''
                          }`}
                        >
                          <button
                            onClick={() => handleChecklistToggle(showStageDetails, item.id)}
                            disabled={!isEditable || saveChecklistItemMutation.isPending}
                            className={`flex-shrink-0 w-5 h-5 rounded border-2 transition-colors ${
                              item.completed
                                ? 'bg-green-500 border-green-500 text-white'
                                : isEditable && !saveChecklistItemMutation.isPending
                                ? 'border-gray-300 hover:border-gray-400'
                                : 'border-gray-200'
                            } ${
                              !isEditable || saveChecklistItemMutation.isPending ? 'cursor-not-allowed' : 'cursor-pointer'
                            }`}
                          >
                            {item.completed && (
                              <Check className="w-3 h-3 m-0.5" />
                            )}
                          </button>

                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <span className={`text-sm ${
                                item.completed
                                  ? 'text-gray-600 font-medium'
                                  : 'text-gray-700'
                              }`}>
                                {item.text}
                              </span>

                              <div className="flex items-center space-x-2">

                                {item.completedAt && (
                                  <span className="text-xs text-gray-400">
                                    {new Date(item.completedAt).toLocaleString(undefined, {
                                      month: 'short',
                                      day: 'numeric',
                                      year: 'numeric',
                                      hour: 'numeric',
                                      minute: '2-digit'
                                    })}
                                  </span>
                                )}

                                {(() => {
                                  const comments = itemComments?.[`${showStageDetails}-${item.id}`] || []
                                  const hasComments = comments.length > 0
                                  return (
                                    <button
                                      onClick={() => handleToggleComments(showStageDetails, item.id)}
                                      className={`relative p-1 rounded hover:bg-gray-100 transition-colors ${
                                        hasComments ? 'text-blue-600' : 'text-gray-400'
                                      }`}
                                      title={hasComments ? `${comments.length} comment${comments.length > 1 ? 's' : ''}` : 'Add comment'}
                                    >
                                      <MessageSquare className="w-4 h-4" />
                                      {hasComments && (
                                        <span className="absolute -top-1 -right-1 flex items-center justify-center w-3.5 h-3.5 text-[10px] font-semibold text-white bg-blue-600 rounded-full">
                                          {comments.length}
                                        </span>
                                      )}
                                    </button>
                                  )
                                })()}

                                {(() => {
                                  const hasAttachments = item.attachments && item.attachments.length > 0
                                  const isShowingAttachments = showingAttachmentsFor?.stageId === showStageDetails && showingAttachmentsFor?.itemId === item.id

                                  return (
                                    <button
                                      onClick={() => handleToggleAttachments(showStageDetails, item.id)}
                                      className={`relative p-1 rounded transition-colors ${
                                        isShowingAttachments
                                          ? 'bg-blue-50 text-blue-600'
                                          : hasAttachments
                                          ? 'text-blue-600 hover:bg-blue-50'
                                          : 'text-gray-400 hover:bg-gray-100 hover:text-blue-600'
                                      }`}
                                      title={hasAttachments ? `${item.attachments.length} attachment${item.attachments.length > 1 ? 's' : ''}` : 'View attachments'}
                                    >
                                      <Paperclip className="w-4 h-4" />
                                      {hasAttachments && (
                                        <span className="absolute -top-1 -right-1 flex items-center justify-center w-3.5 h-3.5 text-[10px] font-semibold text-white bg-blue-600 rounded-full">
                                          {item.attachments.length}
                                        </span>
                                      )}
                                    </button>
                                  )
                                })()}

                                {isEditable && (
                                  <button
                                    onClick={() => handleOpenAssignment(showStageDetails, item.id)}
                                    className="p-1 rounded hover:bg-gray-100 transition-colors text-gray-400 hover:text-blue-600"
                                    title="Assign task"
                                  >
                                    <Users className="w-4 h-4" />
                                  </button>
                                )}

                                {/* Show assigned users for this task */}
                                {(() => {
                                  const key = `${showStageDetails}-${item.id}`
                                  const itemAssignments = taskAssignments?.[key] || []

                                  if (itemAssignments.length > 0) {
                                    return (
                                      <div className="flex items-center gap-1 ml-1">
                                        {itemAssignments.map((assignment: any) => {
                                          const userName = assignment.user?.first_name && assignment.user?.last_name
                                            ? `${assignment.user.first_name} ${assignment.user.last_name}`
                                            : assignment.user?.email || 'Unknown'
                                          const initials = userName.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase()

                                          return (
                                            <div
                                              key={assignment.id}
                                              className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0 cursor-pointer hover:bg-blue-700 transition-colors"
                                              title={`Assigned to ${userName}. Click to message.`}
                                              onClick={async () => {
                                                // Open direct message with this user
                                                await handleOpenConversation(assignment.assigned_user_id || assignment.user?.id)
                                              }}
                                            >
                                              <span className="text-white text-[10px] font-semibold">
                                                {initials}
                                              </span>
                                            </div>
                                          )
                                        })}
                                      </div>
                                    )
                                  }
                                  return null
                                })()}

                                {uploadingFiles[`${showStageDetails}-${item.id}`] && (
                                  <div className="flex items-center">
                                    <div className="animate-spin w-4 h-4 border border-blue-600 border-t-transparent rounded-full"></div>
                                  </div>
                                )}

                                {item.isCustom && (
                                  <button
                                    onClick={() => handleRemoveCustomItem(showStageDetails, item.id)}
                                    className="p-1 rounded hover:bg-red-100 text-red-400 hover:text-red-600 transition-colors"
                                    title="Remove custom item"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}

                                {!isEditable && (
                                  <AlertTriangle className="w-4 h-4 text-orange-400" title="Checklist is locked" />
                                )}
                              </div>
                            </div>

                            {/* Comments thread */}
                            {showingCommentsFor?.stageId === showStageDetails && showingCommentsFor?.itemId === item.id && (
                              <div className="mt-2 bg-gray-50 rounded-lg border border-gray-200 divide-y divide-gray-200">
                                {/* Existing comments */}
                                {itemComments?.[`${showStageDetails}-${item.id}`]?.map((comment: any) => {
                                  const userName = comment.user?.first_name && comment.user?.last_name
                                    ? `${comment.user.first_name} ${comment.user.last_name}`
                                    : comment.user?.email || 'Unknown'
                                  const isOwnComment = user?.id === comment.user_id
                                  const isEditing = editingComment?.id === comment.id

                                  return (
                                    <div key={comment.id} className="p-2">
                                      <div className="flex items-center justify-between mb-1">
                                        <div className="flex items-center space-x-2">
                                          <span className="text-xs font-medium text-gray-900">{userName}</span>
                                          {comment.is_edited && (
                                            <span className="text-xs text-gray-400 italic">(edited)</span>
                                          )}
                                        </div>
                                        <div className="flex items-center space-x-2">
                                          <span className="text-xs text-gray-500">
                                            {new Date(comment.created_at).toLocaleString(undefined, {
                                              month: 'short',
                                              day: 'numeric',
                                              hour: 'numeric',
                                              minute: '2-digit'
                                            })}
                                          </span>
                                          {isOwnComment && !isEditing && (
                                            <div className="flex items-center space-x-1">
                                              <button
                                                onClick={() => handleEditComment(comment.id, comment.comment_text)}
                                                className="text-gray-400 hover:text-blue-600 transition-colors"
                                                title="Edit"
                                              >
                                                <Edit3 className="w-3 h-3" />
                                              </button>
                                              <button
                                                onClick={() => handleDeleteComment(comment.id)}
                                                className="text-gray-400 hover:text-red-600 transition-colors"
                                                title="Delete"
                                              >
                                                <Trash2 className="w-3 h-3" />
                                              </button>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                      {isEditing ? (
                                        <div className="flex items-start space-x-2">
                                          <textarea
                                            value={editingComment.text}
                                            onChange={(e) => setEditingComment({ id: comment.id, text: e.target.value })}
                                            onKeyDown={(e) => {
                                              if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault()
                                                handleUpdateComment(comment.id)
                                              } else if (e.key === 'Escape') {
                                                setEditingComment(null)
                                              }
                                            }}
                                            className="flex-1 text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                                            rows={2}
                                            autoFocus
                                          />
                                          <div className="flex flex-col space-y-1">
                                            <Button size="sm" onClick={() => handleUpdateComment(comment.id)}>
                                              <Check className="w-3 h-3" />
                                            </Button>
                                            <Button variant="ghost" size="sm" onClick={() => setEditingComment(null)}>
                                              <X className="w-3 h-3" />
                                            </Button>
                                          </div>
                                        </div>
                                      ) : (
                                        <p className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">{comment.comment_text}</p>
                                      )}
                                    </div>
                                  )
                                })}

                                {/* Add comment input */}
                                <div className="p-2">
                                  <MentionInput
                                    value={commentingItem?.stageId === showStageDetails && commentingItem?.itemId === item.id ? commentText : ''}
                                    onChange={(value, mentions, references) => {
                                      if (!commentingItem || commentingItem.stageId !== showStageDetails || commentingItem.itemId !== item.id) {
                                        handleAddComment(showStageDetails, item.id)
                                      }
                                      setCommentText(value)
                                      setCommentMentions(mentions)
                                      setCommentReferences(references)
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault()
                                        if (commentText.trim()) {
                                          handleSaveComment()
                                        }
                                      } else if (e.key === 'Escape') {
                                        handleCancelComment()
                                      }
                                    }}
                                    onBlur={() => {
                                      // Only cancel if the text is empty
                                      if (!commentText.trim()) {
                                        handleCancelComment()
                                      }
                                    }}
                                    placeholder="Add a comment (press Enter to send)..."
                                    className="text-xs"
                                    rows={2}
                                    hideHelper={true}
                                  />
                                </div>
                              </div>
                            )}

                            {/* Attachments list */}
                            {showingAttachmentsFor?.stageId === showStageDetails && showingAttachmentsFor?.itemId === item.id && (
                              <div
                                className={`mt-2 bg-gray-50 rounded-lg border-2 transition-colors ${
                                  isDraggingOver === `${showStageDetails}-${item.id}`
                                    ? 'border-blue-500 bg-blue-50'
                                    : 'border-gray-200'
                                }`}
                                onDragOver={(e) => handleDragOver(e, showStageDetails, item.id)}
                                onDragLeave={handleDragLeave}
                                onDrop={(e) => handleDrop(e, showStageDetails, item.id)}
                              >
                                {/* Existing attachments */}
                                {item.attachments && item.attachments.length > 0 ? (
                                  <div className="divide-y divide-gray-200">
                                    {item.attachments.map((attachment) => (
                                      <div key={attachment.id} className="flex items-center justify-between p-2 hover:bg-gray-100 transition-colors">
                                        <div className="flex items-center space-x-2 flex-1 min-w-0">
                                          <FileText className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                          <span className="text-xs text-gray-700 truncate">{attachment.file_name}</span>
                                          {attachment.file_size && (
                                            <span className="text-xs text-gray-400">
                                              ({(attachment.file_size / 1024).toFixed(1)} KB)
                                            </span>
                                          )}
                                        </div>
                                        <div className="flex items-center space-x-1 flex-shrink-0">
                                          <button
                                            onClick={() => handleDownloadAttachment(attachment)}
                                            className="p-1 rounded hover:bg-blue-100 text-blue-600 transition-colors"
                                            title="Download"
                                          >
                                            <Download className="w-3.5 h-3.5" />
                                          </button>
                                          {isEditable && (
                                            <button
                                              onClick={() => handleDeleteAttachment(attachment.id)}
                                              className="p-1 rounded hover:bg-red-100 text-red-600 transition-colors"
                                              title="Delete"
                                            >
                                              <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="p-4 text-center text-gray-400 text-xs">
                                    No attachments yet
                                  </div>
                                )}

                                {/* Upload area */}
                                {isEditable && (
                                  <div className="p-3 border-t border-gray-200">
                                    <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors cursor-pointer">
                                      <input
                                        type="file"
                                        multiple
                                        className="hidden"
                                        onChange={(e) => {
                                          if (e.target.files) {
                                            handleFileUpload(showStageDetails, item.id, e.target.files)
                                            e.target.value = '' // Reset input
                                          }
                                        }}
                                      />
                                      <Upload className="w-6 h-6 text-gray-400 mb-2" />
                                      <span className="text-xs text-gray-600">
                                        Click to browse or drag and drop files here
                                      </span>
                                    </label>
                                  </div>
                                )}

                                {uploadingFiles[`${showStageDetails}-${item.id}`] && (
                                  <div className="p-3 border-t border-gray-200 flex items-center justify-center space-x-2">
                                    <div className="animate-spin w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                                    <span className="text-xs text-gray-600">Uploading...</span>
                                  </div>
                                )}
                              </div>
                            )}

                          </div>
                        </div>


                        {/* Assignment selector - always show if item exists in DB */}
                        {(() => {
                          const shouldAutoOpen = assigningItem?.stageId === showStageDetails && assigningItem?.itemId === item.id
                          console.log(`🔍 Item ${item.id}: dbId=${item.dbId}, shouldAutoOpen=${shouldAutoOpen}, assigningItem=`, assigningItem)

                          if (item.dbId) {
                            return (
                              <AssignmentSelector
                                key={`${item.dbId}-${shouldAutoOpen ? 'auto' : 'normal'}`}
                                checklistItemId={item.dbId}
                                type="task"
                                autoOpenModal={shouldAutoOpen}
                                hideAssignedSection={true}
                                onAssignmentChange={() => {
                                  queryClient.invalidateQueries({ queryKey: ['task-assignments-all'] })
                                }}
                                onModalClose={() => setAssigningItem(null)}
                              />
                            )
                          }
                          return null
                        })()}
                      </div>
                    )
                  })}

                  {/* Add Custom Item Section */}
                  {showStageDetails && showStageDetails !== 'outdated' && (
                    <div className="mt-3">
                      {addingItemToStage === showStageDetails ? (
                        <div className="flex items-center space-x-2 p-2 bg-blue-50 rounded-lg border border-blue-200">
                          <Plus className="w-4 h-4 text-blue-600 flex-shrink-0" />
                          <input
                            type="text"
                            value={newItemText}
                            onChange={(e) => setNewItemText(e.target.value)}
                            placeholder="Add custom item..."
                            className="flex-1 px-2 py-1 text-sm border-0 bg-transparent focus:outline-none focus:ring-0 placeholder-blue-400"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && newItemText.trim()) {
                                handleAddCustomItem(showStageDetails)
                              } else if (e.key === 'Escape') {
                                setAddingItemToStage(null)
                                setNewItemText('')
                              }
                            }}
                            onBlur={() => {
                              if (!newItemText.trim()) {
                                setAddingItemToStage(null)
                                setNewItemText('')
                              }
                            }}
                          />
                          {newItemText.trim() && (
                            <button
                              onClick={() => handleAddCustomItem(showStageDetails)}
                              className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                            >
                              Add
                            </button>
                          )}
                        </div>
                      ) : (
                        <button
                          onClick={() => setAddingItemToStage(showStageDetails)}
                          className="flex items-center space-x-2 text-xs text-gray-500 hover:text-blue-600 hover:bg-blue-50 px-2 py-1 rounded transition-colors w-full"
                        >
                          <Plus className="w-3 h-3" />
                          <span>Add custom item...</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
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
                      : `${stageChecklists[effectiveCurrentStage]?.filter(item => item.completed).length || 0} of ${stageChecklists[effectiveCurrentStage]?.length || 0} items completed`
                    }
                  </div>
                )}
              </div>

              {/* Stage Action Buttons */}
              <div className="flex items-center space-x-2">
                {currentIndex > 0 && isWorkflowStarted && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleRegressStage}
                    className="text-gray-600 hover:text-gray-800"
                  >
                    ← Move to {timelineStages[currentIndex - 1]?.label}
                  </Button>
                )}

                {currentIndex < timelineStages.length - 1 && isWorkflowStarted && (
                  <Button
                    size="sm"
                    onClick={handleAdvanceStage}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                    title={timelineStages[currentIndex + 1]?.id === 'completed' ? 'Complete workflow' : 'Advance to next stage'}
                  >
                    {timelineStages[currentIndex + 1]?.id === 'completed' ? 'Complete Workflow ✓' : 'Advance Stage →'}
                  </Button>
                )}

                {currentIndex === timelineStages.length - 1 && showStageDetails === effectiveCurrentStage && effectiveCurrentStage === 'completed' && (
                  <div className="text-sm text-green-600 font-medium">
                    🎉 Workflow completed!
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