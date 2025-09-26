import React, { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Filter, Workflow, Users, Star, Clock, BarChart3, Settings, Trash2, Edit3, Copy, Eye, TrendingUp, StarOff, Target, CheckSquare, UserCog, Calendar, GripVertical, ArrowUp, ArrowDown, Save, X, CalendarDays, Activity, PieChart, Zap, Home } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { WorkflowManager } from '../components/ui/WorkflowManager'
import { ContentTileManager } from '../components/ui/ContentTileManager'
import { TabStateManager } from '../lib/tabStateManager'

interface WorkflowWithStats {
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
  usage_count: number
  active_assets: number
  completed_assets: number
  creator_name?: string
  is_favorited?: boolean
  stages?: WorkflowStage[]
  user_permission?: 'read' | 'write' | 'admin' | 'owner'
}

interface WorkflowStage {
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

interface WorkflowsPageProps {
  className?: string
  tabId?: string
}

export function WorkflowsPage({ className = '', tabId = 'workflows' }: WorkflowsPageProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [filterBy, setFilterBy] = useState<'all' | 'my' | 'public' | 'shared' | 'favorites'>('all')
  const [sortBy, setSortBy] = useState<'name' | 'usage' | 'created' | 'updated'>('usage')
  const [showWorkflowManager, setShowWorkflowManager] = useState(false)
  const [selectedWorkflowForEdit, setSelectedWorkflowForEdit] = useState<string | null>(null)
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowWithStats | null>(null)
  const [activeView, setActiveView] = useState<'overview' | 'stages' | 'admins' | 'cadence'>('overview')
  const [editingStage, setEditingStage] = useState<string | null>(null)
  const [editingChecklistItem, setEditingChecklistItem] = useState<string | null>(null)
  const [showAddStage, setShowAddStage] = useState(false)
  const [showAddChecklistItem, setShowAddChecklistItem] = useState<string | null>(null)
  const [draggedStage, setDraggedStage] = useState<string | null>(null)
  const [draggedChecklistItem, setDraggedChecklistItem] = useState<string | null>(null)
  const [dragOverItem, setDragOverItem] = useState<string | null>(null)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [showAccessRequestModal, setShowAccessRequestModal] = useState(false)
  const [showAddRuleModal, setShowAddRuleModal] = useState(false)
  const [editingRule, setEditingRule] = useState<string | null>(null)
  const [isEditingWorkflow, setIsEditingWorkflow] = useState(false)
  const [editingWorkflowData, setEditingWorkflowData] = useState({
    name: '',
    description: '',
    color: ''
  })
  const [showInlineWorkflowCreator, setShowInlineWorkflowCreator] = useState(false)
  const [newWorkflowData, setNewWorkflowData] = useState({
    name: '',
    description: '',
    color: '#3b82f6',
    is_public: false,
    cadence_days: 365
  })
  const queryClient = useQueryClient()

  // Load saved state on component mount
  useEffect(() => {
    const savedState = TabStateManager.loadTabState(tabId)
    if (savedState) {
      if (savedState.selectedWorkflowId) {
        // We'll restore the selected workflow after workflows are loaded
      }
      if (savedState.activeView) {
        setActiveView(savedState.activeView)
      }
      if (savedState.searchTerm) {
        setSearchTerm(savedState.searchTerm)
      }
      if (savedState.filterBy) {
        setFilterBy(savedState.filterBy)
      }
      if (savedState.sortBy) {
        setSortBy(savedState.sortBy)
      }
    }
  }, [tabId])

  // Save state whenever key values change
  useEffect(() => {
    const state = {
      selectedWorkflowId: selectedWorkflow?.id || null,
      activeView,
      searchTerm,
      filterBy,
      sortBy
    }
    TabStateManager.saveTabState(tabId, state)
  }, [tabId, selectedWorkflow?.id, activeView, searchTerm, filterBy, sortBy])

  // Parallel queries for better performance - remove dependencies
  const { data: workflowStages } = useQuery({
    queryKey: ['workflow-stages'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workflow_stages')
        .select('*')
        .order('workflow_id')
        .order('sort_order')

      if (error) {
        console.error('Error fetching workflow stages:', error)
        throw error
      }

      return data || []
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000 // 10 minutes
  })

  // Run in parallel instead of waiting for stages
  const { data: automationRules } = useQuery({
    queryKey: ['workflow-automation-rules'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workflow_automation_rules')
        .select('*')
        .order('workflow_id')
        .order('rule_name')

      if (error) {
        console.error('Error fetching automation rules:', error)
        throw error
      }

      return data || []
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000 // 10 minutes
  })

  // Run in parallel instead of waiting for stages
  const { data: workflowChecklistTemplates } = useQuery({
    queryKey: ['workflow-checklist-templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workflow_checklist_templates')
        .select('*')
        .order('workflow_id')
        .order('stage_id')
        .order('sort_order')

      if (error) {
        console.error('Error fetching workflow checklist templates:', error)
        throw error
      }

      return data || []
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000 // 10 minutes
  })

  // Query to get all workflows with statistics
  const { data: workflows, isLoading, error: workflowsError } = useQuery({
    queryKey: ['workflows-full', filterBy, sortBy],
    // Remove dependency - run immediately for faster loading
    queryFn: async () => {
      console.log('Fetching workflows...', { filterBy, sortBy })
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id

      console.log('Current user:', userId)

      if (!userId) {
        console.log('No user found, returning empty array')
        return []
      }

      // Get workflows based on filter
      let workflowQuery = supabase.from('workflows').select(`
        *,
        users:created_by (
          first_name,
          last_name,
          email
        )
      `)

      switch (filterBy) {
        case 'my':
          workflowQuery = workflowQuery.eq('created_by', userId)
          break
        case 'public':
          workflowQuery = workflowQuery.eq('is_public', true)
          break
        case 'shared':
          // Get shared workflow IDs first
          const { data: sharedIds } = await supabase
            .from('workflow_collaborations')
            .select('workflow_id')
            .eq('user_id', userId)

          const ids = sharedIds?.map(s => s.workflow_id) || []
          if (ids.length === 0) return []
          workflowQuery = workflowQuery.in('id', ids)
          break
        case 'favorites':
          // Get favorited workflow IDs first
          const { data: favoriteIds } = await supabase
            .from('workflow_favorites')
            .select('workflow_id')
            .eq('user_id', userId)

          const favIds = favoriteIds?.map(f => f.workflow_id) || []
          if (favIds.length === 0) return []
          workflowQuery = workflowQuery.in('id', favIds)
          break
        case 'all':
        default:
          // Get shared workflow IDs
          const { data: allSharedIds } = await supabase
            .from('workflow_collaborations')
            .select('workflow_id')
            .eq('user_id', userId)

          const allIds = allSharedIds?.map(s => s.workflow_id) || []
          const sharedFilter = allIds.length > 0 ? `,id.in.(${allIds.join(',')})` : ''
          workflowQuery = workflowQuery.or(`is_public.eq.true,created_by.eq.${userId}${sharedFilter}`)
          break
      }

      const { data: workflowData, error } = await workflowQuery

      console.log('Raw workflow data:', workflowData)

      if (error) {
        console.error('Error fetching workflows:', error)
        throw error
      }

      // Get usage statistics
      const { data: usageStats } = await supabase
        .from('asset_workflow_progress')
        .select('workflow_id, is_started, completed_at')

      // Get user's favorited workflows
      const { data: userFavorites } = await supabase
        .from('workflow_favorites')
        .select('workflow_id')
        .eq('user_id', userId)

      const favoritedWorkflowIds = new Set(userFavorites?.map(f => f.workflow_id) || [])

      // Calculate statistics for each workflow
      const workflowsWithStats: WorkflowWithStats[] = (workflowData || []).map(workflow => {
        const workflowUsage = usageStats?.filter(stat => stat.workflow_id === workflow.id) || []
        const activeAssets = workflowUsage.filter(stat => stat.is_started && !stat.completed_at).length
        const completedAssets = workflowUsage.filter(stat => stat.completed_at).length
        const totalUsage = workflowUsage.length

        const creator = workflow.users
        const creatorName = creator ? `${creator.first_name || ''} ${creator.last_name || ''}`.trim() || creator.email : ''

        // Determine user permission
        let userPermission: 'read' | 'write' | 'admin' | 'owner' = 'read'
        if (workflow.created_by === userId) {
          userPermission = 'owner'
        } else if (workflow.name === 'Research Workflow') {
          // For Research Workflow, all logged-in users can be admin
          userPermission = 'admin'
        }

        // Get stages for this workflow
        const workflowStagesData = workflowStages?.filter(stage => stage.workflow_id === workflow.id) || []

        return {
          ...workflow,
          usage_count: totalUsage,
          active_assets: activeAssets,
          completed_assets: completedAssets,
          creator_name: creatorName,
          is_favorited: favoritedWorkflowIds.has(workflow.id),
          stages: workflowStagesData,
          user_permission: userPermission
        }
      })

      console.log('Workflows with stats:', workflowsWithStats)

      // Sort workflows (favorites always first)
      workflowsWithStats.sort((a, b) => {
        // Always show favorites first
        if (a.is_favorited && !b.is_favorited) return -1
        if (!a.is_favorited && b.is_favorited) return 1

        // Then sort by the selected criteria
        switch (sortBy) {
          case 'usage':
            if (a.usage_count !== b.usage_count) return b.usage_count - a.usage_count
            return a.name.localeCompare(b.name)
          case 'created':
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          case 'updated':
            return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
          case 'name':
          default:
            return a.name.localeCompare(b.name)
        }
      })

      console.log('Final workflows to return:', workflowsWithStats)
      return workflowsWithStats
    },
    staleTime: 2 * 60 * 1000, // 2 minutes for main data
    gcTime: 5 * 60 * 1000 // 5 minutes
  })

  // Restore selected workflow when workflows are loaded
  useEffect(() => {
    if (workflows && workflows.length > 0) {
      const savedState = TabStateManager.loadTabState(tabId)
      if (savedState?.selectedWorkflowId && !selectedWorkflow) {
        const workflowToRestore = workflows.find(w => w.id === savedState.selectedWorkflowId)
        if (workflowToRestore) {
          setSelectedWorkflow(workflowToRestore)
        }
      }
    }
  }, [workflows, tabId, selectedWorkflow])

  // Filter workflows by search term
  const filteredWorkflows = workflows?.filter(workflow =>
    workflow.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    workflow.description.toLowerCase().includes(searchTerm.toLowerCase())
  ) || []

  // Debug logs can be removed in production
  // console.log('Filtered workflows for display:', filteredWorkflows)

  const handleCreateWorkflow = () => {
    setSelectedWorkflow(null) // Clear any selected workflow
    setShowInlineWorkflowCreator(true)
    // Reset form data
    setNewWorkflowData({
      name: '',
      description: '',
      color: '#3b82f6',
      is_public: false,
      cadence_days: 365
    })
  }

  const handleEditWorkflow = (workflowId: string) => {
    setSelectedWorkflowForEdit(workflowId)
    setShowWorkflowManager(true)
  }

  const handleSelectWorkflow = (workflow: WorkflowWithStats) => {
    setSelectedWorkflow(workflow)
    setActiveView('overview')
  }

  const duplicateWorkflowMutation = useMutation({
    mutationFn: async (workflowId: string) => {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id

      if (!userId) throw new Error('Not authenticated')

      // Get the original workflow
      const { data: originalWorkflow, error: fetchError } = await supabase
        .from('workflows')
        .select('*')
        .eq('id', workflowId)
        .single()

      if (fetchError) throw fetchError

      // Create duplicate workflow
      const { data: newWorkflow, error: createError } = await supabase
        .from('workflows')
        .insert({
          name: `${originalWorkflow.name} (Copy)`,
          description: originalWorkflow.description,
          color: originalWorkflow.color,
          is_public: false,
          is_default: false,
          created_by: userId
        })
        .select()
        .single()

      if (createError) throw createError

      // Get and duplicate workflow stages
      const { data: originalStages, error: stagesError } = await supabase
        .from('workflow_stages')
        .select('*')
        .eq('workflow_id', workflowId)
        .order('sort_order')

      if (stagesError) throw stagesError

      if (originalStages && originalStages.length > 0) {
        const newStages = originalStages.map(stage => ({
          workflow_id: newWorkflow.id,
          stage_key: stage.stage_key,
          stage_label: stage.stage_label,
          stage_description: stage.stage_description,
          sort_order: stage.sort_order,
          created_by: userId
        }))

        const { error: insertStagesError } = await supabase
          .from('workflow_stages')
          .insert(newStages)

        if (insertStagesError) throw insertStagesError
      }

      return newWorkflow
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows-full'] })
    },
    onError: (error) => {
      console.error('Error duplicating workflow:', error)
      alert('Failed to duplicate workflow. Please try again.')
    }
  })

  const deleteWorkflowMutation = useMutation({
    mutationFn: async (workflowId: string) => {
      // First delete workflow stages
      const { error: stagesError } = await supabase
        .from('workflow_stages')
        .delete()
        .eq('workflow_id', workflowId)

      if (stagesError) throw stagesError

      // Then delete the workflow
      const { error: workflowError } = await supabase
        .from('workflows')
        .delete()
        .eq('id', workflowId)

      if (workflowError) throw workflowError
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows-full'] })
    },
    onError: (error) => {
      console.error('Error deleting workflow:', error)
      alert('Failed to delete workflow. Please try again.')
    }
  })

  const toggleFavoriteMutation = useMutation({
    mutationFn: async ({ workflowId, isFavorited }: { workflowId: string, isFavorited: boolean }) => {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id

      if (!userId) throw new Error('Not authenticated')

      if (isFavorited) {
        // Remove from favorites
        const { error } = await supabase
          .from('workflow_favorites')
          .delete()
          .eq('workflow_id', workflowId)
          .eq('user_id', userId)

        if (error) throw error
      } else {
        // Add to favorites
        const { error } = await supabase
          .from('workflow_favorites')
          .insert({
            workflow_id: workflowId,
            user_id: userId
          })

        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows-full'] })
    },
    onError: (error) => {
      console.error('Error toggling favorite:', error)
      alert('Failed to update favorite. Please try again.')
    }
  })

  const handleDeleteWorkflow = (workflowId: string, workflowName: string) => {
    if (confirm(`Are you sure you want to delete "${workflowName}"? This action cannot be undone.`)) {
      deleteWorkflowMutation.mutate(workflowId)
    }
  }

  // Mutations for stage management
  const updateStageMutation = useMutation({
    mutationFn: async ({ stageId, updates }: { stageId: string, updates: Partial<WorkflowStage> }) => {
      const { error } = await supabase
        .from('workflow_stages')
        .update(updates)
        .eq('id', stageId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-stages'] })
      queryClient.invalidateQueries({ queryKey: ['workflows-full'] })
    },
    onError: (error) => {
      console.error('Error updating stage:', error)
      alert('Failed to update stage. Please try again.')
    }
  })

  const addStageMutation = useMutation({
    mutationFn: async ({ workflowId, stage }: { workflowId: string, stage: Omit<WorkflowStage, 'id' | 'created_at' | 'updated_at'> }) => {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id

      if (!userId) throw new Error('Not authenticated')

      const { error } = await supabase
        .from('workflow_stages')
        .insert({
          ...stage,
          workflow_id: workflowId,
          created_by: userId
        })

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-stages'] })
      queryClient.invalidateQueries({ queryKey: ['workflows-full'] })
      setShowAddStage(false)
    },
    onError: (error) => {
      console.error('Error adding stage:', error)
      alert('Failed to add stage. Please try again.')
    }
  })

  const deleteStageMutation = useMutation({
    mutationFn: async ({ stageId, stageKey }: { stageId: string, stageKey: string }) => {
      // First delete checklist templates for this stage (using stage_key)
      const { error: checklistError } = await supabase
        .from('workflow_checklist_templates')
        .delete()
        .eq('stage_id', stageKey)

      if (checklistError) throw checklistError

      // Then delete the stage (using id)
      const { error: stageError } = await supabase
        .from('workflow_stages')
        .delete()
        .eq('id', stageId)

      if (stageError) throw stageError
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-stages'] })
      queryClient.invalidateQueries({ queryKey: ['workflows-full'] })
      queryClient.invalidateQueries({ queryKey: ['workflow-checklist-templates'] })
    },
    onError: (error) => {
      console.error('Error deleting stage:', error)
      alert('Failed to delete stage. Please try again.')
    }
  })

  const reorderStagesMutation = useMutation({
    mutationFn: async ({ stages }: { stages: { id: string, sort_order: number }[] }) => {
      const { error } = await supabase
        .from('workflow_stages')
        .upsert(stages, { onConflict: 'id' })

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-stages'] })
      queryClient.invalidateQueries({ queryKey: ['workflows-full'] })
    },
    onError: (error) => {
      console.error('Error reordering stages:', error)
      alert('Failed to reorder stages. Please try again.')
    }
  })

  // Mutations for checklist item management
  const updateChecklistItemMutation = useMutation({
    mutationFn: async ({ itemId, updates }: { itemId: string, updates: any }) => {
      const { error } = await supabase
        .from('workflow_checklist_templates')
        .update(updates)
        .eq('id', itemId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-checklist-templates'] })
    },
    onError: (error) => {
      console.error('Error updating checklist item:', error)
      alert('Failed to update checklist item. Please try again.')
    }
  })

  const addChecklistItemMutation = useMutation({
    mutationFn: async ({ workflowId, stageId, item }: { workflowId: string, stageId: string, item: any }) => {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id

      if (!userId) throw new Error('Not authenticated')

      const { error } = await supabase
        .from('workflow_checklist_templates')
        .insert({
          ...item,
          workflow_id: workflowId,
          stage_id: stageId,
          created_by: userId
        })

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-checklist-templates'] })
      setShowAddChecklistItem(null)
    },
    onError: (error) => {
      console.error('Error adding checklist item:', error)
      alert('Failed to add checklist item. Please try again.')
    }
  })

  const deleteChecklistItemMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase
        .from('workflow_checklist_templates')
        .delete()
        .eq('id', itemId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-checklist-templates'] })
    },
    onError: (error) => {
      console.error('Error deleting checklist item:', error)
      alert('Failed to delete checklist item. Please try again.')
    }
  })

  const reorderChecklistItemsMutation = useMutation({
    mutationFn: async ({ items }: { items: { id: string, sort_order: number }[] }) => {
      const { error } = await supabase
        .from('workflow_checklist_templates')
        .upsert(items, { onConflict: 'id' })

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-checklist-templates'] })
    },
    onError: (error) => {
      console.error('Error reordering checklist items:', error)
      alert('Failed to reorder checklist items. Please try again.')
    }
  })

  // Mutations for automation rules management
  const addRuleMutation = useMutation({
    mutationFn: async ({ workflowId, rule }: { workflowId: string, rule: any }) => {
      const { data, error } = await supabase
        .from('workflow_automation_rules')
        .insert([{
          workflow_id: workflowId,
          rule_name: rule.name,
          rule_type: rule.type,
          condition_type: rule.conditionType,
          condition_value: rule.conditionValue,
          action_type: rule.actionType,
          action_value: rule.actionValue,
          is_active: rule.isActive || true
        }])
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automation-rules'] })
      setShowAddRuleModal(false)
    },
    onError: (error) => {
      console.error('Error adding automation rule:', error)
      alert('Failed to add automation rule. Please try again.')
    }
  })

  const updateRuleMutation = useMutation({
    mutationFn: async ({ ruleId, updates }: { ruleId: string, updates: any }) => {
      const { data, error } = await supabase
        .from('workflow_automation_rules')
        .update({
          rule_name: updates.name,
          rule_type: updates.type,
          condition_type: updates.conditionType,
          condition_value: updates.conditionValue,
          action_type: updates.actionType,
          action_value: updates.actionValue,
          is_active: updates.isActive
        })
        .eq('id', ruleId)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automation-rules'] })
      setEditingRule(null)
    },
    onError: (error) => {
      console.error('Error updating automation rule:', error)
      alert('Failed to update automation rule. Please try again.')
    }
  })

  const deleteRuleMutation = useMutation({
    mutationFn: async (ruleId: string) => {
      const { error } = await supabase
        .from('workflow_automation_rules')
        .delete()
        .eq('id', ruleId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automation-rules'] })
    },
    onError: (error) => {
      console.error('Error deleting automation rule:', error)
      alert('Failed to delete automation rule. Please try again.')
    }
  })

  const updateWorkflowMutation = useMutation({
    mutationFn: async ({ workflowId, updates }: { workflowId: string, updates: { name?: string, description?: string, color?: string } }) => {
      const { error } = await supabase
        .from('workflows')
        .update(updates)
        .eq('id', workflowId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      setIsEditingWorkflow(false)
    },
    onError: (error) => {
      console.error('Error updating workflow:', error)
      alert('Failed to update workflow. Please try again.')
    }
  })

  const createWorkflowMutation = useMutation({
    mutationFn: async (workflowData: {
      name: string
      description: string
      color: string
      is_public: boolean
      cadence_days: number
    }) => {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id

      if (!userId) throw new Error('Not authenticated')

      const { data, error } = await supabase
        .from('workflows')
        .insert([{
          name: workflowData.name,
          description: workflowData.description,
          color: workflowData.color,
          is_public: workflowData.is_public,
          cadence_days: workflowData.cadence_days,
          created_by: userId
        }])
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: (createdWorkflow) => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      setShowInlineWorkflowCreator(false)
      // Optionally select the newly created workflow
      setSelectedWorkflow(createdWorkflow)
      // Reset form
      setNewWorkflowData({
        name: '',
        description: '',
        color: '#3b82f6',
        is_public: false,
        cadence_days: 365
      })
    },
    onError: (error) => {
      console.error('Error creating workflow:', error)
      alert('Failed to create workflow. Please try again.')
    }
  })

  const setDefaultWorkflowMutation = useMutation({
    mutationFn: async (workflowId: string) => {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id

      if (!userId) throw new Error('Not authenticated')

      // First, unset any existing default workflows for this user
      const { error: unsetError } = await supabase
        .from('workflows')
        .update({ is_default: false })
        .eq('created_by', userId)
        .eq('is_default', true)

      if (unsetError) throw unsetError

      // Then set the new default workflow
      const { error: setError } = await supabase
        .from('workflows')
        .update({ is_default: true })
        .eq('id', workflowId)
        .eq('created_by', userId) // Ensure user owns the workflow

      if (setError) throw setError

      return workflowId
    },
    onSuccess: (workflowId) => {
      queryClient.invalidateQueries({ queryKey: ['workflows-full'] })

      // Update the selectedWorkflow state if it's the one we just set as default
      if (selectedWorkflow && selectedWorkflow.id === workflowId) {
        setSelectedWorkflow({
          ...selectedWorkflow,
          is_default: true
        })
      }
    },
    onError: (error) => {
      console.error('Error setting default workflow:', error)
      alert('Failed to set default workflow. Please try again.')
    }
  })

  // Helper functions for workflow editing
  const startEditingWorkflow = () => {
    if (selectedWorkflow) {
      setEditingWorkflowData({
        name: selectedWorkflow.name,
        description: selectedWorkflow.description,
        color: selectedWorkflow.color
      })
      setIsEditingWorkflow(true)
    }
  }

  const cancelEditingWorkflow = () => {
    setIsEditingWorkflow(false)
    setEditingWorkflowData({
      name: '',
      description: '',
      color: ''
    })
  }

  const saveWorkflowChanges = () => {
    if (selectedWorkflow && editingWorkflowData.name.trim()) {
      updateWorkflowMutation.mutate({
        workflowId: selectedWorkflow.id,
        updates: {
          name: editingWorkflowData.name.trim(),
          description: editingWorkflowData.description.trim(),
          color: editingWorkflowData.color
        }
      })
    }
  }

  // Helper functions for inline workflow creation
  const handleSaveNewWorkflow = () => {
    if (newWorkflowData.name.trim()) {
      createWorkflowMutation.mutate(newWorkflowData)
    }
  }

  const handleCancelNewWorkflow = () => {
    setShowInlineWorkflowCreator(false)
    setNewWorkflowData({
      name: '',
      description: '',
      color: '#3b82f6',
      is_public: false,
      cadence_days: 365
    })
  }

  // Color options for workflow
  const colorOptions = [
    '#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444',
    '#06B6D4', '#84CC16', '#F97316', '#EC4899', '#6366F1'
  ]

  // Drag and drop handlers for checklist items
  const handleDragStart = (e: React.DragEvent, itemId: string) => {
    setDraggedChecklistItem(itemId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', itemId)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDragEnter = (e: React.DragEvent, itemId: string) => {
    e.preventDefault()
    if (draggedChecklistItem && draggedChecklistItem !== itemId) {
      setDragOverItem(itemId)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear if we're leaving the item entirely
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverItem(null)
    }
  }

  const handleDrop = (e: React.DragEvent, targetItemId: string, stageItems: any[]) => {
    e.preventDefault()

    if (!draggedChecklistItem || draggedChecklistItem === targetItemId) {
      setDraggedChecklistItem(null)
      setDragOverItem(null)
      return
    }

    const draggedIndex = stageItems.findIndex(item => item.id === draggedChecklistItem)
    const targetIndex = stageItems.findIndex(item => item.id === targetItemId)

    if (draggedIndex === -1 || targetIndex === -1) {
      setDraggedChecklistItem(null)
      setDragOverItem(null)
      return
    }

    // Create new order based on drag and drop
    const reorderedItems = [...stageItems]
    const [draggedItem] = reorderedItems.splice(draggedIndex, 1)
    reorderedItems.splice(targetIndex, 0, draggedItem)

    // Update sort orders
    const updates = reorderedItems.map((item, index) => ({
      id: item.id,
      sort_order: index + 1
    }))

    reorderChecklistItemsMutation.mutate({ items: updates })

    setDraggedChecklistItem(null)
    setDragOverItem(null)
  }

  const handleDragEnd = () => {
    setDraggedChecklistItem(null)
    setDragOverItem(null)
  }

  if (isLoading) {
    return (
      <div className={`space-y-6 ${className}`}>
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-48 mb-6"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="h-64 bg-gray-200 rounded-lg"></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (workflowsError) {
    return (
      <div className={`space-y-6 ${className}`}>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-red-800 mb-2">Error Loading Workflows</h3>
          <p className="text-red-600 text-sm">{workflowsError.message}</p>
          <p className="text-red-500 text-xs mt-2">Check the browser console for more details.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gray-50 -mx-4 sm:-mx-6 lg:-mx-8 -my-6">
      {/* Left Sidebar */}
      <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-bold text-gray-900">Workflows</h1>
            <Button onClick={handleCreateWorkflow} size="sm">
              <Plus className="w-4 h-4" />
            </Button>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search workflows..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 w-full border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            />
          </div>

          {/* Filter Buttons */}
          <div className="flex flex-wrap gap-2 mt-3">
            <button
              onClick={() => setFilterBy('all')}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                filterBy === 'all' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilterBy('my')}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                filterBy === 'my' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Mine
            </button>
            <button
              onClick={() => setFilterBy('public')}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                filterBy === 'public' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Public
            </button>
            <button
              onClick={() => setFilterBy('shared')}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                filterBy === 'shared' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Shared
            </button>
          </div>
        </div>

        {/* Workflow List */}
        <div className="flex-1 overflow-y-auto">
          {filteredWorkflows.map((workflow) => (
            <button
              key={workflow.id}
              onClick={() => handleSelectWorkflow(workflow)}
              className={`w-full text-left p-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                selectedWorkflow?.id === workflow.id ? 'bg-blue-50 border-blue-200' : ''
              }`}
            >
              <div className="flex items-center space-x-3">
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: workflow.color }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2">
                    <h3 className="font-medium text-sm text-gray-900 truncate">{workflow.name}</h3>
                    {workflow.is_default && (
                      <Badge variant="secondary" size="sm" className="text-xs">
                        Default
                      </Badge>
                    )}
                    {workflow.is_favorited && (
                      <Star className="w-3 h-3 text-yellow-500 fill-current flex-shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-gray-500 truncate mt-1">{workflow.description}</p>
                </div>
              </div>
            </button>
          ))}

          {filteredWorkflows.length === 0 && (
            <div className="p-4 text-center text-gray-500 text-sm">
              {searchTerm ? 'No workflows found' : 'No workflows available'}
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {showInlineWorkflowCreator ? (
          // Inline Workflow Creator
          <div className="flex-1 flex flex-col">
            <div className="bg-white border-b border-gray-200 px-6 py-4">
              <h1 className="text-xl font-bold text-gray-900">Create New Workflow</h1>
              <p className="text-gray-600 text-sm">Set up a new workflow to guide your investment process</p>
            </div>

            <div className="flex-1 p-6 bg-gray-50">
              <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-sm">
                <div className="p-6">
                  <div className="space-y-6">
                    {/* Basic Information */}
                    <div>
                      <h3 className="text-lg font-medium text-gray-900 mb-4">Basic Information</h3>
                      <div className="grid grid-cols-1 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Workflow Name *
                          </label>
                          <input
                            type="text"
                            value={newWorkflowData.name}
                            onChange={(e) => setNewWorkflowData({ ...newWorkflowData, name: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            placeholder="Enter workflow name"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Description
                          </label>
                          <textarea
                            value={newWorkflowData.description}
                            onChange={(e) => setNewWorkflowData({ ...newWorkflowData, description: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            rows={3}
                            placeholder="Describe this workflow..."
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Color
                            </label>
                            <div className="flex items-center space-x-2">
                              <input
                                type="color"
                                value={newWorkflowData.color}
                                onChange={(e) => setNewWorkflowData({ ...newWorkflowData, color: e.target.value })}
                                className="w-10 h-10 rounded-lg border border-gray-300"
                              />
                              <input
                                type="text"
                                value={newWorkflowData.color}
                                onChange={(e) => setNewWorkflowData({ ...newWorkflowData, color: e.target.value })}
                                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                              />
                            </div>
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Cadence (Days)
                            </label>
                            <input
                              type="number"
                              min="1"
                              max="1095"
                              value={newWorkflowData.cadence_days}
                              onChange={(e) => setNewWorkflowData({ ...newWorkflowData, cadence_days: parseInt(e.target.value) || 365 })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                              placeholder="How often to restart workflow"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Settings */}
                    <div>
                      <h3 className="text-lg font-medium text-gray-900 mb-4">Settings</h3>
                      <div className="flex items-center">
                        <label className="flex items-center">
                          <input
                            type="checkbox"
                            checked={newWorkflowData.is_public}
                            onChange={(e) => setNewWorkflowData({ ...newWorkflowData, is_public: e.target.checked })}
                            className="mr-2 rounded"
                          />
                          <span className="text-sm text-gray-700">Make public (visible to all users)</span>
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center justify-end space-x-3 mt-8 pt-6 border-t border-gray-200">
                    <Button
                      variant="outline"
                      onClick={handleCancelNewWorkflow}
                      disabled={createWorkflowMutation.isPending}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleSaveNewWorkflow}
                      disabled={createWorkflowMutation.isPending || !newWorkflowData.name.trim()}
                    >
                      {createWorkflowMutation.isPending ? 'Creating...' : 'Create Workflow'}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : selectedWorkflow ? (
          <div className="flex-1 flex flex-col">
            {/* Workflow Header */}
            <div className="bg-white border-b border-gray-200 px-6 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div
                    className="w-6 h-6 rounded-full"
                    style={{ backgroundColor: selectedWorkflow.color }}
                  />
                  <div>
                    <h1 className="text-xl font-bold text-gray-900">{selectedWorkflow.name}</h1>
                    <p className="text-gray-600 text-sm">{selectedWorkflow.description}</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedWorkflow(null)}
                  className="flex items-center space-x-2"
                >
                  <Home className="w-4 h-4" />
                  <span>Dashboard</span>
                </Button>
              </div>
            </div>

            {/* Tab Navigation */}
            <div className="border-b border-gray-200">
              <nav className="flex space-x-8 px-6">
                {[
                  { id: 'overview', label: 'Overview', icon: BarChart3 },
                  { id: 'stages', label: 'Stages', icon: Target },
                  { id: 'admins', label: 'Team & Admins', icon: UserCog },
                  { id: 'cadence', label: 'Cadence', icon: Calendar }
                ].map((tab) => {
                  const Icon = tab.icon
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveView(tab.id as any)}
                      className={`flex items-center space-x-2 py-4 px-1 border-b-2 text-sm font-medium transition-colors ${
                        activeView === tab.id
                          ? 'border-primary-500 text-primary-600'
                          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{tab.label}</span>
                    </button>
                  )
                })}
              </nav>
            </div>

            {/* Tab Content */}
            <div className="flex-1 p-6 bg-gray-50 overflow-y-auto">
              {activeView === 'overview' && (
                <div className="space-y-6">
                  {/* Header Section */}
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-100 h-[170px] overflow-hidden">
                    <div className="flex items-start justify-between h-full">
                      <div className="flex items-start space-x-3 flex-1 h-full overflow-hidden">
                        {/* Workflow Icon */}
                        <div className="flex-shrink-0 w-14">
                          <div
                            className="w-14 h-14 rounded-xl flex items-center justify-center text-white text-xl font-bold"
                            style={{ backgroundColor: isEditingWorkflow ? editingWorkflowData.color : selectedWorkflow.color }}
                          >
                            <Workflow className="w-7 h-7" />
                          </div>
                        </div>

                        {/* Workflow Details */}
                        <div className="flex-1 min-w-0 h-full flex flex-col justify-center overflow-hidden">
                          {isEditingWorkflow ? (
                            <div className="space-y-2">
                              <div>
                                <input
                                  type="text"
                                  value={editingWorkflowData.name}
                                  onChange={(e) => setEditingWorkflowData(prev => ({ ...prev, name: e.target.value }))}
                                  className="block w-full text-lg font-semibold text-gray-900 bg-white border border-gray-300 rounded-md px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                                  placeholder="Enter workflow name"
                                />
                              </div>
                              <div>
                                <textarea
                                  value={editingWorkflowData.description}
                                  onChange={(e) => setEditingWorkflowData(prev => ({ ...prev, description: e.target.value }))}
                                  className="block w-full text-sm text-gray-700 bg-white border border-gray-300 rounded-md px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none transition-colors"
                                  rows={2}
                                  placeholder="Describe what this workflow is for"
                                />
                              </div>
                              <div className="flex items-center space-x-2">
                                {selectedWorkflow.is_default && (
                                  <Badge variant="secondary" size="sm">Default</Badge>
                                )}
                                {selectedWorkflow.is_public && (
                                  <Badge variant="success" size="sm">Public</Badge>
                                )}
                                {!selectedWorkflow.is_public && !selectedWorkflow.is_default && (
                                  <Badge variant="default" size="sm">Private</Badge>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div>
                              <div className="flex items-center space-x-3 mb-2">
                                <h2 className="text-2xl font-bold text-gray-900">{selectedWorkflow.name}</h2>
                                {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                                  <button
                                    onClick={startEditingWorkflow}
                                    className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors"
                                    title="Edit workflow details"
                                  >
                                    <Edit3 className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                              <p className="text-gray-600 mb-3">{selectedWorkflow.description}</p>
                              <div className="flex items-center space-x-3">
                                {selectedWorkflow.is_default && (
                                  <Badge variant="secondary" size="sm">Default Workflow</Badge>
                                )}
                                {selectedWorkflow.is_public && (
                                  <Badge variant="success" size="sm">Public</Badge>
                                )}
                                {!selectedWorkflow.is_public && !selectedWorkflow.is_default && (
                                  <Badge variant="default" size="sm">Private</Badge>
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Color Picker - Integrated on the right when editing */}
                        {isEditingWorkflow && (
                          <div className="flex-shrink-0 flex flex-col justify-center">
                            <div className="space-y-1">
                              <div className="text-xs font-medium text-gray-600 text-center">Color</div>
                              <div className="grid grid-cols-5 gap-1">
                                {colorOptions.slice(0, 5).map((color) => (
                                  <button
                                    key={color}
                                    className={`w-5 h-5 rounded border-2 transition-all ${
                                      editingWorkflowData.color === color ? 'border-gray-600 shadow-sm' : 'border-gray-300 hover:border-gray-500'
                                    }`}
                                    style={{ backgroundColor: color }}
                                    onClick={() => setEditingWorkflowData(prev => ({ ...prev, color }))}
                                    title={`Select ${color}`}
                                  />
                                ))}
                              </div>
                              <div className="grid grid-cols-5 gap-1">
                                {colorOptions.slice(5).map((color) => (
                                  <button
                                    key={color}
                                    className={`w-5 h-5 rounded border-2 transition-all ${
                                      editingWorkflowData.color === color ? 'border-gray-600 shadow-sm' : 'border-gray-300 hover:border-gray-500'
                                    }`}
                                    style={{ backgroundColor: color }}
                                    onClick={() => setEditingWorkflowData(prev => ({ ...prev, color }))}
                                    title={`Select ${color}`}
                                  />
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-start space-x-2 flex-shrink-0 ml-3">
                        {/* Default Workflow Toggle - Prominent placement */}
                        {!isEditingWorkflow && (selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                          <button
                            onClick={selectedWorkflow.is_default ? undefined : () => setDefaultWorkflowMutation.mutate(selectedWorkflow.id)}
                            disabled={selectedWorkflow.is_default || setDefaultWorkflowMutation.isPending}
                            className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                              selectedWorkflow.is_default
                                ? 'bg-yellow-100 text-yellow-800 border-2 border-yellow-300 cursor-default'
                                : 'bg-white text-gray-700 border-2 border-gray-300 hover:border-yellow-400 hover:bg-yellow-50'
                            } ${setDefaultWorkflowMutation.isPending ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            <div className="flex items-center space-x-2">
                              <Star className={`w-4 h-4 ${selectedWorkflow.is_default ? 'text-yellow-600 fill-current' : 'text-gray-500'}`} />
                              <span>
                                {selectedWorkflow.is_default ? 'Default' : 'Set as Default'}
                              </span>
                            </div>
                          </button>
                        )}

                        {isEditingWorkflow && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={cancelEditingWorkflow}
                              disabled={updateWorkflowMutation.isPending}
                              className="px-3 py-1.5 text-xs"
                            >
                              <X className="w-3 h-3 mr-1" />
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              onClick={saveWorkflowChanges}
                              disabled={updateWorkflowMutation.isPending || !editingWorkflowData.name.trim()}
                              className="px-3 py-1.5 text-xs"
                            >
                              <Save className="w-3 h-3 mr-1" />
                              {updateWorkflowMutation.isPending ? 'Saving...' : 'Save'}
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Enhanced Stats Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <Card>
                      <div className="p-6">
                        <div className="flex items-center">
                          <div className="p-2 bg-blue-100 rounded-lg">
                            <TrendingUp className="w-6 h-6 text-blue-600" />
                          </div>
                          <div className="ml-4">
                            <div className="text-2xl font-bold text-gray-900">{selectedWorkflow.usage_count}</div>
                            <div className="text-sm text-gray-500">Total Uses</div>
                          </div>
                        </div>
                        <div className="mt-4 text-xs text-gray-400">
                          Times this workflow has been applied
                        </div>
                      </div>
                    </Card>

                    <Card>
                      <div className="p-6">
                        <div className="flex items-center">
                          <div className="p-2 bg-orange-100 rounded-lg">
                            <Clock className="w-6 h-6 text-orange-600" />
                          </div>
                          <div className="ml-4">
                            <div className="text-2xl font-bold text-gray-900">{selectedWorkflow.active_assets}</div>
                            <div className="text-sm text-gray-500">Active Assets</div>
                          </div>
                        </div>
                        <div className="mt-4 text-xs text-gray-400">
                          Assets currently in progress
                        </div>
                      </div>
                    </Card>

                    <Card>
                      <div className="p-6">
                        <div className="flex items-center">
                          <div className="p-2 bg-green-100 rounded-lg">
                            <CheckSquare className="w-6 h-6 text-green-600" />
                          </div>
                          <div className="ml-4">
                            <div className="text-2xl font-bold text-gray-900">{selectedWorkflow.completed_assets}</div>
                            <div className="text-sm text-gray-500">Completed</div>
                          </div>
                        </div>
                        <div className="mt-4 text-xs text-gray-400">
                          Assets that finished this workflow
                        </div>
                      </div>
                    </Card>

                    <Card>
                      <div className="p-6">
                        <div className="flex items-center">
                          <div className="p-2 bg-purple-100 rounded-lg">
                            <Target className="w-6 h-6 text-purple-600" />
                          </div>
                          <div className="ml-4">
                            <div className="text-2xl font-bold text-gray-900">{selectedWorkflow.stages?.length || 0}</div>
                            <div className="text-sm text-gray-500">Total Stages</div>
                          </div>
                        </div>
                        <div className="mt-4 text-xs text-gray-400">
                          Steps in this workflow process
                        </div>
                      </div>
                    </Card>
                  </div>

                  {/* Workflow Performance Insights */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Success Rate Card */}
                    <Card>
                      <div className="p-6">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-semibold text-gray-900">Performance Metrics</h3>
                          <BarChart3 className="w-5 h-5 text-gray-400" />
                        </div>
                        <div className="space-y-4">
                          <div>
                            <div className="flex justify-between text-sm mb-1">
                              <span className="text-gray-600">Completion Rate</span>
                              <span className="font-medium">
                                {selectedWorkflow.usage_count > 0
                                  ? Math.round((selectedWorkflow.completed_assets / selectedWorkflow.usage_count) * 100)
                                  : 0}%
                              </span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                              <div
                                className="bg-green-500 h-2 rounded-full transition-all duration-300"
                                style={{
                                  width: selectedWorkflow.usage_count > 0
                                    ? `${Math.round((selectedWorkflow.completed_assets / selectedWorkflow.usage_count) * 100)}%`
                                    : '0%'
                                }}
                              />
                            </div>
                          </div>
                          <div>
                            <div className="flex justify-between text-sm mb-1">
                              <span className="text-gray-600">Active Progress</span>
                              <span className="font-medium">
                                {selectedWorkflow.usage_count > 0
                                  ? Math.round((selectedWorkflow.active_assets / selectedWorkflow.usage_count) * 100)
                                  : 0}%
                              </span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                              <div
                                className="bg-orange-500 h-2 rounded-full transition-all duration-300"
                                style={{
                                  width: selectedWorkflow.usage_count > 0
                                    ? `${Math.round((selectedWorkflow.active_assets / selectedWorkflow.usage_count) * 100)}%`
                                    : '0%'
                                }}
                              />
                            </div>
                          </div>
                        </div>
                        {selectedWorkflow.usage_count === 0 && (
                          <div className="text-center py-4">
                            <div className="text-sm text-gray-500">No usage data yet</div>
                            <div className="text-xs text-gray-400 mt-1">Apply this workflow to see performance metrics</div>
                          </div>
                        )}
                      </div>
                    </Card>

                    {/* Workflow Timeline */}
                    <Card>
                      <div className="p-6">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-semibold text-gray-900">Workflow Timeline</h3>
                          <Calendar className="w-5 h-5 text-gray-400" />
                        </div>
                        <div className="space-y-3">
                          <div className="flex items-center space-x-3">
                            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                            <div className="flex-1">
                              <div className="text-sm font-medium text-gray-900">Created</div>
                              <div className="text-xs text-gray-500">{new Date(selectedWorkflow.created_at).toLocaleDateString()}</div>
                            </div>
                          </div>
                          <div className="flex items-center space-x-3">
                            <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                            <div className="flex-1">
                              <div className="text-sm font-medium text-gray-900">Last Updated</div>
                              <div className="text-xs text-gray-500">{new Date(selectedWorkflow.updated_at).toLocaleDateString()}</div>
                            </div>
                          </div>
                          <div className="flex items-center space-x-3">
                            <div className="w-2 h-2 bg-gray-300 rounded-full"></div>
                            <div className="flex-1">
                              <div className="text-sm font-medium text-gray-900">Created by</div>
                              <div className="text-xs text-gray-500">{selectedWorkflow.creator_name}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </Card>
                  </div>

                  {/* Workflow Stages Overview */}
                  <Card>
                    <div className="p-6">
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="text-lg font-semibold text-gray-900">Workflow Stages Overview</h3>
                        <Button size="sm" variant="outline" onClick={() => setActiveView('stages')}>
                          <Eye className="w-4 h-4 mr-2" />
                          View Details
                        </Button>
                      </div>

                      {selectedWorkflow.stages && selectedWorkflow.stages.length > 0 ? (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between text-sm text-gray-500 mb-4">
                            <span>Stage Flow</span>
                            <span>Est. Duration</span>
                          </div>
                          <div className="space-y-3">
                            {selectedWorkflow.stages.map((stage, index) => (
                              <div key={stage.stage_key} className="flex items-center space-x-4">
                                <div className="flex items-center space-x-3 flex-1">
                                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 text-gray-600 font-medium text-sm">
                                    {index + 1}
                                  </div>
                                  <div className="flex-1">
                                    <div className="text-sm font-medium text-gray-900">{stage.stage_label}</div>
                                    <div className="text-xs text-gray-500 truncate">{stage.stage_description}</div>
                                  </div>
                                </div>
                                <div className="text-sm text-gray-500 min-w-0">
                                  {stage.standard_deadline_days} days
                                </div>
                                <div
                                  className="w-3 h-3 rounded-full flex-shrink-0"
                                  style={{ backgroundColor: stage.stage_color }}
                                />
                                {index < selectedWorkflow.stages!.length - 1 && (
                                  <div className="w-4 h-px bg-gray-300 flex-shrink-0"></div>
                                )}
                              </div>
                            ))}
                          </div>
                          <div className="mt-4 pt-4 border-t border-gray-200">
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-500">Total estimated duration:</span>
                              <span className="font-medium text-gray-900">
                                {selectedWorkflow.stages.reduce((total, stage) => total + stage.standard_deadline_days, 0)} days
                              </span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-center py-8">
                          <Target className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                          <h4 className="text-lg font-medium text-gray-900 mb-2">No stages configured</h4>
                          <p className="text-gray-500 mb-4">Add stages to define your workflow process and track progress effectively.</p>
                          {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                            <Button size="sm" onClick={() => setActiveView('stages')}>
                              <Plus className="w-4 h-4 mr-2" />
                              Configure Stages
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </Card>

                  {/* Quick Actions */}
                  <Card>
                    <div className="p-6">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') ? (
                          <>
                            <button
                              onClick={() => setActiveView('stages')}
                              className="p-4 text-left border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                            >
                              <div className="flex items-center space-x-3">
                                <div className="p-2 bg-blue-100 rounded-lg">
                                  <Target className="w-5 h-5 text-blue-600" />
                                </div>
                                <div>
                                  <div className="font-medium text-gray-900">Edit Stages</div>
                                  <div className="text-sm text-gray-500">Modify workflow steps</div>
                                </div>
                              </div>
                            </button>
                            <button
                              onClick={() => setActiveView('admins')}
                              className="p-4 text-left border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                            >
                              <div className="flex items-center space-x-3">
                                <div className="p-2 bg-green-100 rounded-lg">
                                  <Users className="w-5 h-5 text-green-600" />
                                </div>
                                <div>
                                  <div className="font-medium text-gray-900">Manage Team</div>
                                  <div className="text-sm text-gray-500">Add collaborators</div>
                                </div>
                              </div>
                            </button>
                            <button
                              onClick={() => setActiveView('cadence')}
                              className="p-4 text-left border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                            >
                              <div className="flex items-center space-x-3">
                                <div className="p-2 bg-purple-100 rounded-lg">
                                  <Settings className="w-5 h-5 text-purple-600" />
                                </div>
                                <div>
                                  <div className="font-medium text-gray-900">Automation</div>
                                  <div className="text-sm text-gray-500">Set up rules</div>
                                </div>
                              </div>
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => setActiveView('stages')}
                              className="p-4 text-left border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                            >
                              <div className="flex items-center space-x-3">
                                <div className="p-2 bg-blue-100 rounded-lg">
                                  <Eye className="w-5 h-5 text-blue-600" />
                                </div>
                                <div>
                                  <div className="font-medium text-gray-900">View Stages</div>
                                  <div className="text-sm text-gray-500">See workflow steps</div>
                                </div>
                              </div>
                            </button>
                            <button
                              onClick={() => setActiveView('admins')}
                              className="p-4 text-left border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                            >
                              <div className="flex items-center space-x-3">
                                <div className="p-2 bg-green-100 rounded-lg">
                                  <Users className="w-5 h-5 text-green-600" />
                                </div>
                                <div>
                                  <div className="font-medium text-gray-900">View Team</div>
                                  <div className="text-sm text-gray-500">See collaborators</div>
                                </div>
                              </div>
                            </button>
                            <button
                              onClick={() => setShowAccessRequestModal(true)}
                              className="p-4 text-left border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                            >
                              <div className="flex items-center space-x-3">
                                <div className="p-2 bg-orange-100 rounded-lg">
                                  <UserCog className="w-5 h-5 text-orange-600" />
                                </div>
                                <div>
                                  <div className="font-medium text-gray-900">Request Access</div>
                                  <div className="text-sm text-gray-500">Higher permissions</div>
                                </div>
                              </div>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </Card>
                </div>
              )}

              {activeView === 'stages' && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">Workflow Stages</h3>
                    {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                      <Button size="sm" onClick={() => setShowAddStage(true)}>
                        <Plus className="w-4 h-4 mr-2" />
                        Add Stage
                      </Button>
                    )}
                  </div>

                  <div className="space-y-4">
                    {(selectedWorkflow?.stages || []).length === 0 ? (
                      <Card>
                        <div className="text-center py-8">
                          <Target className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                          <h3 className="text-lg font-medium text-gray-900 mb-2">No stages configured</h3>
                          <p className="text-gray-500 mb-4">Add stages to organize your workflow process.</p>
                          {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                            <Button size="sm" onClick={() => setShowAddStage(true)}>
                              <Plus className="w-4 h-4 mr-2" />
                              Add First Stage
                            </Button>
                          )}
                        </div>
                      </Card>
                    ) : (
                      (selectedWorkflow?.stages || []).map((stage, index) => {
                        // Get workflow checklist templates for this stage
                        const stageChecklistTemplates = workflowChecklistTemplates?.filter(
                          template => template.workflow_id === selectedWorkflow.id && template.stage_id === stage.stage_key
                        ) || []

                        return (
                          <Card key={stage.stage_key}>
                            <div className="p-4">
                              {/* Stage Header */}
                              <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center space-x-4">
                                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 text-gray-600 font-medium text-sm">
                                    {index + 1}
                                  </div>
                                  <div>
                                    <h4 className="font-medium text-gray-900">{stage.stage_label}</h4>
                                    <p className="text-sm text-gray-500">{stage.stage_description}</p>
                                    <div className="flex items-center space-x-4 mt-1">
                                      <span className="text-xs text-gray-400">Deadline: {stage.standard_deadline_days} days</span>
                                      <div
                                        className="w-3 h-3 rounded-full"
                                        style={{ backgroundColor: stage.stage_color }}
                                      />
                                    </div>
                                  </div>
                                </div>
                                {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                                  <div className="flex items-center space-x-2">
                                    <Button size="xs" variant="outline" title="Move Up" disabled={index === 0}
                                      onClick={() => {
                                        if (index > 0) {
                                          const stages = selectedWorkflow.stages!
                                          const reorderedStages = [...stages]
                                          const stageToMove = reorderedStages[index]
                                          const stageAbove = reorderedStages[index - 1]

                                          reorderStagesMutation.mutate({
                                            stages: [
                                              { id: stageToMove.id, sort_order: stageAbove.sort_order },
                                              { id: stageAbove.id, sort_order: stageToMove.sort_order }
                                            ]
                                          })
                                        }
                                      }}>
                                      <ArrowUp className="w-3 h-3" />
                                    </Button>
                                    <Button size="xs" variant="outline" title="Move Down" disabled={index === (selectedWorkflow.stages!.length - 1)}
                                      onClick={() => {
                                        if (index < selectedWorkflow.stages!.length - 1) {
                                          const stages = selectedWorkflow.stages!
                                          const reorderedStages = [...stages]
                                          const stageToMove = reorderedStages[index]
                                          const stageBelow = reorderedStages[index + 1]

                                          reorderStagesMutation.mutate({
                                            stages: [
                                              { id: stageToMove.id, sort_order: stageBelow.sort_order },
                                              { id: stageBelow.id, sort_order: stageToMove.sort_order }
                                            ]
                                          })
                                        }
                                      }}>
                                      <ArrowDown className="w-3 h-3" />
                                    </Button>
                                    <Button size="xs" variant="outline" title="Edit Stage"
                                      onClick={() => setEditingStage(stage.id)}>
                                      <Edit3 className="w-3 h-3" />
                                    </Button>
                                    <Button size="xs" variant="outline" title="Delete Stage"
                                      onClick={() => {
                                        if (confirm(`Are you sure you want to delete the "${stage.stage_label}" stage? This will also delete all its checklist items.`)) {
                                          deleteStageMutation.mutate({ stageId: stage.id, stageKey: stage.stage_key })
                                        }
                                      }}>
                                      <Trash2 className="w-3 h-3" />
                                    </Button>
                                  </div>
                                )}
                              </div>

                              {/* Checklist Items */}
                              <div className="border-t pt-4">
                                <div className="flex items-center justify-between mb-3">
                                  <h5 className="text-sm font-medium text-gray-700">
                                    Checklist Template ({stageChecklistTemplates.length})
                                  </h5>
                                  {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                                    <button
                                      onClick={() => setShowAddChecklistItem(stage.stage_key)}
                                      className="text-sm font-medium text-gray-700 hover:text-gray-900 flex items-center transition-colors"
                                    >
                                      <Plus className="w-3 h-3 mr-1" />
                                      Add Item
                                    </button>
                                  )}
                                </div>

                                {stageChecklistTemplates.length === 0 ? (
                                  <div className="text-center py-6 bg-gray-50 rounded-lg">
                                    <CheckSquare className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                                    <p className="text-sm text-gray-500">No checklist template items</p>
                                    {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                                      <p className="text-xs text-gray-400 mt-1">Add template items that will appear for all assets using this workflow</p>
                                    )}
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    {stageChecklistTemplates.map((template, itemIndex) => (
                                      <div
                                        key={template.id}
                                        draggable={selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner'}
                                        onDragStart={(e) => handleDragStart(e, template.id)}
                                        onDragOver={handleDragOver}
                                        onDragEnter={(e) => handleDragEnter(e, template.id)}
                                        onDragLeave={handleDragLeave}
                                        onDrop={(e) => handleDrop(e, template.id, stageChecklistTemplates)}
                                        onDragEnd={handleDragEnd}
                                        className={`flex items-center space-x-3 p-3 rounded-lg transition-all duration-200 ${
                                          draggedChecklistItem === template.id ? 'opacity-50 bg-blue-100' :
                                          dragOverItem === template.id ? 'bg-blue-200 border-2 border-blue-400' :
                                          'bg-gray-50 hover:bg-gray-100'
                                        } ${
                                          (selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') ? 'cursor-move' : ''
                                        }`}
                                      >
                                        {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                                          <div className="flex items-center justify-center w-5 h-5 text-gray-400 hover:text-gray-600">
                                            <GripVertical className="w-4 h-4" />
                                          </div>
                                        )}
                                        <div className="flex items-center justify-center w-5 h-5 rounded bg-white border border-gray-300">
                                          <span className="text-xs text-gray-500">{itemIndex + 1}</span>
                                        </div>
                                        <div className="flex-1">
                                          <div className="flex items-center space-x-2">
                                            <span className="text-sm font-medium text-gray-900">{template.item_text}</span>
                                            {template.is_required && (
                                              <Badge variant="destructive" size="xs">Required</Badge>
                                            )}
                                          </div>
                                          {template.description && (
                                            <p className="text-xs text-gray-500 mt-1">{template.description}</p>
                                          )}
                                          <div className="flex items-center space-x-4 mt-2">
                                            {template.estimated_hours && (
                                              <span className="text-xs text-gray-400">~{template.estimated_hours}h</span>
                                            )}
                                            {template.tags && (
                                              <span className="text-xs text-gray-400">{template.tags.join(', ')}</span>
                                            )}
                                          </div>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                          {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                                            <div className="flex items-center space-x-1">
                                              <Button size="xs" variant="outline" title="Edit Item"
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  setEditingChecklistItem(template.id)
                                                }}>
                                                <Edit3 className="w-3 h-3" />
                                              </Button>
                                              <Button size="xs" variant="outline" title="Delete Item"
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  if (confirm(`Are you sure you want to delete "${template.item_text}"?`)) {
                                                    deleteChecklistItemMutation.mutate(template.id)
                                                  }
                                                }}>
                                                <Trash2 className="w-3 h-3" />
                                              </Button>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Content Tiles */}
                              <div className="border-t pt-4 mt-4">
                                <ContentTileManager
                                  workflowId={selectedWorkflow.id}
                                  stageId={stage.stage_key}
                                />
                              </div>
                            </div>
                          </Card>
                        )
                      })
                    )}
                  </div>
                </div>
              )}


              {activeView === 'admins' && (
                <div className="space-y-6">
                  {/* Header with Actions */}
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">Team & Access Management</h3>
                      <p className="text-sm text-gray-600 mt-1">
                        Manage who can access and modify this workflow
                      </p>
                    </div>
                    <div className="flex space-x-2">
                      {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                        <Button size="sm" onClick={() => setShowInviteModal(true)}>
                          <Plus className="w-4 h-4 mr-2" />
                          Invite User
                        </Button>
                      )}
                      {selectedWorkflow.user_permission === 'read' && (
                        <Button size="sm" variant="outline" onClick={() => setShowAccessRequestModal(true)}>
                          <UserCog className="w-4 h-4 mr-2" />
                          Request Access
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-6">
                    {/* Workflow Owner */}
                    <Card>
                      <div className="p-6">
                        <div className="flex items-center justify-between mb-4">
                          <h4 className="text-lg font-semibold text-gray-900">Workflow Owner</h4>
                          <Badge variant="default" size="sm">
                            Full Control
                          </Badge>
                        </div>
                        <div className="flex items-center space-x-4">
                          <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center">
                            <span className="text-white font-semibold text-lg">
                              {selectedWorkflow.creator_name ?
                                selectedWorkflow.creator_name.charAt(0).toUpperCase() :
                                '?'
                              }
                            </span>
                          </div>
                          <div className="flex-1">
                            <div className="font-semibold text-gray-900">
                              {selectedWorkflow.creator_name || 'Unknown User'}
                            </div>
                            <div className="text-sm text-gray-600">
                              Created this workflow • Has full administrative rights
                            </div>
                          </div>
                        </div>
                      </div>
                    </Card>

                    {/* Access Control & Permissions */}
                    <Card>
                      <div className="p-6">
                        <h4 className="text-lg font-semibold text-gray-900 mb-4">Access Control</h4>

                        <div className="space-y-4">
                          {/* Workflow Visibility */}
                          <div className="bg-gray-50 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-medium text-gray-900">Workflow Visibility</span>
                              <div className="space-x-2">
                                {selectedWorkflow.is_public && (
                                  <Badge variant="success" size="sm">
                                    <Eye className="w-3 h-3 mr-1" />
                                    Public
                                  </Badge>
                                )}
                                {selectedWorkflow.is_default && (
                                  <Badge variant="secondary" size="sm">
                                    <Star className="w-3 h-3 mr-1" />
                                    Default
                                  </Badge>
                                )}
                                {!selectedWorkflow.is_public && !selectedWorkflow.is_default && (
                                  <Badge variant="default" size="sm">
                                    <Users className="w-3 h-3 mr-1" />
                                    Private
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <p className="text-sm text-gray-600">
                              {selectedWorkflow.is_public && "Anyone in your organization can view and use this workflow"}
                              {selectedWorkflow.is_default && "This is the default workflow for new assets"}
                              {!selectedWorkflow.is_public && !selectedWorkflow.is_default && "Only invited users can access this workflow"}
                            </p>
                          </div>

                          {/* Your Access Level */}
                          <div className="bg-blue-50 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-medium text-gray-900">Your Access Level</span>
                              <Badge
                                variant={selectedWorkflow.user_permission === 'owner' ? 'default' :
                                        selectedWorkflow.user_permission === 'admin' ? 'secondary' :
                                        selectedWorkflow.user_permission === 'write' ? 'outline' : 'destructive'}
                                size="sm"
                                className="capitalize"
                              >
                                <UserCog className="w-3 h-3 mr-1" />
                                {selectedWorkflow.user_permission}
                              </Badge>
                            </div>
                            <div className="text-sm text-gray-600">
                              {selectedWorkflow.user_permission === 'owner' && (
                                <div>
                                  <p className="font-medium text-blue-700 mb-1">Full Control</p>
                                  <p>You can modify all workflow settings, manage team access, edit stages, and delete the workflow.</p>
                                </div>
                              )}
                              {selectedWorkflow.user_permission === 'admin' && (
                                <div>
                                  <p className="font-medium text-blue-700 mb-1">Administrative Access</p>
                                  <p>You can edit workflow settings, manage checklist items, invite users, and modify automation rules.</p>
                                </div>
                              )}
                              {selectedWorkflow.user_permission === 'write' && (
                                <div>
                                  <p className="font-medium text-blue-700 mb-1">Edit Access</p>
                                  <p>You can edit checklist items and use the workflow, but cannot modify core settings or invite users.</p>
                                </div>
                              )}
                              {selectedWorkflow.user_permission === 'read' && (
                                <div>
                                  <p className="font-medium text-blue-700 mb-1">View Only</p>
                                  <p>You can view and use this workflow but cannot make any modifications. Use "Request Access" to get additional permissions.</p>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Permission Levels Guide */}
                          <div className="border-t pt-4">
                            <h5 className="font-medium text-gray-900 mb-3">Permission Levels Explained</h5>
                            <div className="space-y-3">
                              <div className="flex items-start space-x-3">
                                <div className="w-6 h-6 bg-gray-800 rounded flex items-center justify-center">
                                  <span className="text-white text-xs font-bold">O</span>
                                </div>
                                <div>
                                  <p className="font-medium text-gray-900">Owner</p>
                                  <p className="text-sm text-gray-600">Complete control over the workflow including deletion and ownership transfer</p>
                                </div>
                              </div>
                              <div className="flex items-start space-x-3">
                                <div className="w-6 h-6 bg-blue-600 rounded flex items-center justify-center">
                                  <span className="text-white text-xs font-bold">A</span>
                                </div>
                                <div>
                                  <p className="font-medium text-gray-900">Admin</p>
                                  <p className="text-sm text-gray-600">Can modify workflow settings, stages, automation rules, and manage team access</p>
                                </div>
                              </div>
                              <div className="flex items-start space-x-3">
                                <div className="w-6 h-6 bg-green-600 rounded flex items-center justify-center">
                                  <span className="text-white text-xs font-bold">W</span>
                                </div>
                                <div>
                                  <p className="font-medium text-gray-900">Write</p>
                                  <p className="text-sm text-gray-600">Can edit checklist items and workflow content but not core settings</p>
                                </div>
                              </div>
                              <div className="flex items-start space-x-3">
                                <div className="w-6 h-6 bg-gray-400 rounded flex items-center justify-center">
                                  <span className="text-white text-xs font-bold">R</span>
                                </div>
                                <div>
                                  <p className="font-medium text-gray-900">Read</p>
                                  <p className="text-sm text-gray-600">Can view and use the workflow but cannot make modifications</p>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </Card>

                    {/* Quick Actions */}
                    {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                      <Card>
                        <div className="p-6">
                          <h4 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h4>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Button variant="outline" onClick={() => setShowInviteModal(true)} className="justify-start">
                              <Plus className="w-4 h-4 mr-2" />
                              Invite Team Member
                            </Button>
                            <Button variant="outline" className="justify-start" disabled>
                              <Settings className="w-4 h-4 mr-2" />
                              Workflow Settings
                            </Button>
                            <Button variant="outline" className="justify-start" disabled>
                              <Users className="w-4 h-4 mr-2" />
                              View All Members
                            </Button>
                            <Button variant="outline" className="justify-start" disabled>
                              <BarChart3 className="w-4 h-4 mr-2" />
                              Usage Analytics
                            </Button>
                          </div>
                        </div>
                      </Card>
                    )}

                  </div>
                </div>
              )}

              {activeView === 'cadence' && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">Automation Rules</h3>
                    {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                      <Button size="sm" onClick={() => setShowAddRuleModal(true)}>
                        <Plus className="w-4 h-4 mr-2" />
                        Add Rule
                      </Button>
                    )}
                  </div>

                  <div className="space-y-4">
                    {(() => {
                      const workflowRules = automationRules?.filter(rule => rule.workflow_id === selectedWorkflow.id) || []

                      if (workflowRules.length === 0) {
                        return (
                          <Card>
                            <div className="text-center py-8">
                              <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                              <h3 className="text-lg font-medium text-gray-900 mb-2">No automation rules</h3>
                              <p className="text-gray-500 mb-4">Set up automated workflows to trigger actions based on conditions.</p>
                              {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                                <Button size="sm" onClick={() => setShowAddRuleModal(true)}>
                                  <Plus className="w-4 h-4 mr-2" />
                                  Create First Rule
                                </Button>
                              )}
                            </div>
                          </Card>
                        )
                      }

                      return workflowRules.map((rule) => (
                        <Card key={rule.id} className="hover:shadow-md transition-shadow">
                          <div className="p-6">
                            <div className="flex items-start justify-between mb-4">
                              <div className="flex-1">
                                <div className="flex items-center space-x-3 mb-2">
                                  <h4 className="text-lg font-semibold text-gray-900">{rule.rule_name}</h4>
                                  <Badge variant={rule.is_active ? "success" : "secondary"} size="sm">
                                    {rule.is_active ? "Active" : "Inactive"}
                                  </Badge>
                                </div>
                                <Badge variant="outline" size="sm" className="capitalize">
                                  {rule.rule_type.replace('_', ' ')}
                                </Badge>
                              </div>
                              {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                                <div className="flex items-center space-x-1">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setEditingRule(rule.id)}
                                    title="Edit rule"
                                    className="p-2"
                                  >
                                    <Edit3 className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      if (confirm(`Are you sure you want to delete the rule "${rule.rule_name}"?`)) {
                                        deleteRuleMutation.mutate(rule.id)
                                      }
                                    }}
                                    title="Delete rule"
                                    className="p-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </div>
                              )}
                            </div>

                            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                              <div className="flex items-start space-x-4">
                                <div className="flex-1">
                                  <div className="flex items-center space-x-2 mb-1">
                                    <Clock className="w-4 h-4 text-blue-600" />
                                    <span className="text-sm font-medium text-gray-700">When</span>
                                  </div>
                                  <div className="text-sm text-gray-900 ml-6">
                                    {rule.condition_type === 'time_based' && rule.condition_value?.interval_days && (
                                      <span>Every {rule.condition_value.interval_days} days</span>
                                    )}
                                    {rule.condition_type === 'earnings_date' && rule.condition_value?.days_before && (
                                      <span>{rule.condition_value.days_before} days before earnings</span>
                                    )}
                                    {!rule.condition_value && (
                                      <span className="capitalize">{rule.condition_type.replace('_', ' ')}</span>
                                    )}
                                  </div>
                                </div>

                                <div className="flex-1">
                                  <div className="flex items-center space-x-2 mb-1">
                                    <Target className="w-4 h-4 text-green-600" />
                                    <span className="text-sm font-medium text-gray-700">Then</span>
                                  </div>
                                  <div className="text-sm text-gray-900 ml-6">
                                    {rule.action_type === 'reset_workflow' && rule.action_value?.reset_to_stage && (
                                      <span>Reset to {rule.action_value.reset_to_stage} stage</span>
                                    )}
                                    {rule.action_type === 'start_workflow' && rule.action_value?.target_stage && (
                                      <span>Start at {rule.action_value.target_stage} stage</span>
                                    )}
                                    {rule.action_type === 'notify_users' && (
                                      <span>Notify users</span>
                                    )}
                                    {!rule.action_value && rule.action_type !== 'notify_users' && (
                                      <span className="capitalize">{rule.action_type.replace('_', ' ')}</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </Card>
                      ))
                    })()}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          // Workflow Dashboard - Default Landing Page
          <div className="flex-1 flex flex-col">
            {/* Dashboard Header */}
            <div className="bg-white border-b border-gray-200 px-6 py-4">
              <h1 className="text-xl font-bold text-gray-900">Workflow Dashboard</h1>
              <p className="text-gray-600 text-sm">Overview of all active workflows organized by cadence and activity</p>
            </div>

            <div className="flex-1 p-6 bg-gray-50 overflow-y-auto">
              {filteredWorkflows.length === 0 ? (
                /* Empty State */
                <div className="flex items-center justify-center h-full">
                  <div className="text-center max-w-md">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Workflow className="w-8 h-8 text-gray-400" />
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No workflows found</h3>
                    <p className="text-gray-500 mb-4">
                      Create your first workflow to get started managing your investment process.
                    </p>
                    <Button onClick={handleCreateWorkflow}>
                      <Plus className="w-4 h-4 mr-2" />
                      Create Your First Workflow
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Quick Stats */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <Card className="p-4">
                      <div className="flex items-center">
                        <div className="p-2 bg-blue-100 rounded-lg">
                          <Workflow className="w-5 h-5 text-blue-600" />
                        </div>
                        <div className="ml-3">
                          <p className="text-sm font-medium text-gray-500">Total Workflows</p>
                          <p className="text-xl font-semibold text-gray-900">{filteredWorkflows.length}</p>
                        </div>
                      </div>
                    </Card>

                    <Card className="p-4">
                      <div className="flex items-center">
                        <div className="p-2 bg-green-100 rounded-lg">
                          <Activity className="w-5 h-5 text-green-600" />
                        </div>
                        <div className="ml-3">
                          <p className="text-sm font-medium text-gray-500">Active Assets</p>
                          <p className="text-xl font-semibold text-gray-900">
                            {filteredWorkflows.reduce((sum, w) => sum + w.active_assets, 0)}
                          </p>
                        </div>
                      </div>
                    </Card>

                    <Card className="p-4">
                      <div className="flex items-center">
                        <div className="p-2 bg-purple-100 rounded-lg">
                          <CheckSquare className="w-5 h-5 text-purple-600" />
                        </div>
                        <div className="ml-3">
                          <p className="text-sm font-medium text-gray-500">Completed</p>
                          <p className="text-xl font-semibold text-gray-900">
                            {filteredWorkflows.reduce((sum, w) => sum + w.completed_assets, 0)}
                          </p>
                        </div>
                      </div>
                    </Card>

                    <Card className="p-4">
                      <div className="flex items-center">
                        <div className="p-2 bg-orange-100 rounded-lg">
                          <Zap className="w-5 h-5 text-orange-600" />
                        </div>
                        <div className="ml-3">
                          <p className="text-sm font-medium text-gray-500">Total Usage</p>
                          <p className="text-xl font-semibold text-gray-900">
                            {filteredWorkflows.reduce((sum, w) => sum + w.usage_count, 0)}
                          </p>
                        </div>
                      </div>
                    </Card>
                  </div>

                  {/* Workflow Cadence Visualization */}
                  <Card>
                    <div className="p-6 border-b border-gray-200">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center">
                          <BarChart3 className="w-6 h-6 text-indigo-500 mr-3" />
                          <div>
                            <h3 className="text-xl font-semibold text-gray-900">Workflow Cadence Map</h3>
                            <p className="text-sm text-gray-500">Visual timeline of all workflow cycles and their frequency</p>
                          </div>
                        </div>
                        <Button size="sm" variant="outline" onClick={handleCreateWorkflow}>
                          <Plus className="w-4 h-4 mr-2" />
                          New Workflow
                        </Button>
                      </div>
                    </div>

                    <div className="p-6">
                      {filteredWorkflows.length > 0 ? (
                        <div className="space-y-8">
                          {/* Timeline Scale */}
                          <div className="relative">
                            <div className="flex items-center text-xs text-gray-500 mb-4">
                              <span className="w-16">Daily</span>
                              <span className="flex-1 text-center">Weekly</span>
                              <span className="flex-1 text-center">Monthly</span>
                              <span className="flex-1 text-center">Quarterly</span>
                              <span className="flex-1 text-center">Yearly</span>
                              <span className="w-16 text-right">Multi-Year</span>
                            </div>

                            {/* Timeline Bar */}
                            <div className="relative h-2 bg-gradient-to-r from-blue-100 via-green-100 via-yellow-100 via-orange-100 to-purple-100 rounded-full mb-8">
                              <div className="absolute inset-0 bg-gradient-to-r from-blue-200 via-green-200 via-yellow-200 via-orange-200 to-purple-200 rounded-full opacity-50"></div>
                              {/* Scale markers */}
                              <div className="absolute top-3 left-0 w-px h-4 bg-gray-300"></div>
                              <div className="absolute top-3 left-1/5 w-px h-4 bg-gray-300"></div>
                              <div className="absolute top-3 left-2/5 w-px h-4 bg-gray-300"></div>
                              <div className="absolute top-3 left-3/5 w-px h-4 bg-gray-300"></div>
                              <div className="absolute top-3 left-4/5 w-px h-4 bg-gray-300"></div>
                              <div className="absolute top-3 right-0 w-px h-4 bg-gray-300"></div>
                            </div>
                          </div>

                          {/* Workflow Visualization */}
                          <div className="space-y-6">
                            {filteredWorkflows
                              .sort((a, b) => a.cadence_days - b.cadence_days)
                              .map((workflow, index) => {
                                // Calculate position on timeline (logarithmic scale for better distribution)
                                const maxDays = Math.max(...filteredWorkflows.map(w => w.cadence_days), 730)
                                const position = Math.min(95, (Math.log(workflow.cadence_days + 1) / Math.log(maxDays + 1)) * 95)

                                // Determine cadence category and color
                                let cadenceCategory = ''
                                let categoryColor = ''
                                if (workflow.cadence_days <= 7) {
                                  cadenceCategory = 'Daily/Weekly'
                                  categoryColor = 'bg-blue-500'
                                } else if (workflow.cadence_days <= 90) {
                                  cadenceCategory = 'Monthly'
                                  categoryColor = 'bg-green-500'
                                } else if (workflow.cadence_days <= 365) {
                                  cadenceCategory = 'Quarterly'
                                  categoryColor = 'bg-yellow-500'
                                } else if (workflow.cadence_days <= 730) {
                                  cadenceCategory = 'Yearly'
                                  categoryColor = 'bg-orange-500'
                                } else {
                                  cadenceCategory = 'Multi-Year'
                                  categoryColor = 'bg-purple-500'
                                }

                                return (
                                  <div key={workflow.id} className="relative group">
                                    {/* Timeline Line */}
                                    <div className="relative h-16 bg-gray-50 rounded-lg border border-gray-200 hover:border-gray-300 transition-all duration-200">
                                      {/* Background pattern to show cadence */}
                                      <div className="absolute inset-0 opacity-20 rounded-lg" style={{
                                        background: `linear-gradient(90deg, ${workflow.color} 0%, ${workflow.color}40 100%)`
                                      }}></div>

                                      {/* Workflow indicator positioned on timeline */}
                                      <div
                                        className="absolute top-2 transform -translate-x-1/2 flex flex-col items-center cursor-pointer"
                                        style={{ left: `${position}%` }}
                                        onClick={() => handleSelectWorkflow(workflow)}
                                      >
                                        {/* Workflow dot */}
                                        <div className="relative">
                                          <div
                                            className="w-6 h-6 rounded-full border-4 border-white shadow-lg transform group-hover:scale-110 transition-transform duration-200"
                                            style={{ backgroundColor: workflow.color }}
                                          />
                                          {workflow.is_default && (
                                            <Star className="absolute -top-1 -right-1 w-3 h-3 text-yellow-500 fill-current" />
                                          )}
                                        </div>

                                        {/* Workflow info */}
                                        <div className="mt-2 text-center min-w-max">
                                          <div className="flex items-center space-x-1 justify-center mb-1">
                                            <p className="text-sm font-semibold text-gray-900">{workflow.name}</p>
                                          </div>
                                          <div className="flex items-center space-x-2 text-xs text-gray-600">
                                            <Badge variant="secondary" size="sm">{cadenceCategory}</Badge>
                                            <span>•</span>
                                            <span>{workflow.cadence_days}d cycle</span>
                                          </div>
                                        </div>
                                      </div>

                                      {/* Activity indicators */}
                                      <div className="absolute bottom-2 right-4 flex items-center space-x-4 text-xs text-gray-500">
                                        <div className="flex items-center space-x-1">
                                          <Activity className="w-3 h-3 text-green-500" />
                                          <span>{workflow.active_assets} active</span>
                                        </div>
                                        <div className="flex items-center space-x-1">
                                          <Target className="w-3 h-3 text-blue-500" />
                                          <span>{workflow.usage_count} total</span>
                                        </div>
                                        <div className="flex items-center space-x-1">
                                          <CheckSquare className="w-3 h-3 text-gray-500" />
                                          <span>{workflow.completed_assets} done</span>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Workflow stages preview */}
                                    {workflow.stages && workflow.stages.length > 0 && (
                                      <div className="mt-2 flex items-center space-x-2 pl-4">
                                        <div className="text-xs text-gray-500">Stages:</div>
                                        <div className="flex items-center space-x-1">
                                          {workflow.stages.slice(0, 5).map((stage, stageIndex) => (
                                            <div
                                              key={stage.id}
                                              className="w-2 h-2 rounded-full opacity-60"
                                              style={{ backgroundColor: stage.stage_color }}
                                              title={stage.stage_label}
                                            />
                                          ))}
                                          {workflow.stages.length > 5 && (
                                            <span className="text-xs text-gray-400">+{workflow.stages.length - 5}</span>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                          </div>

                          {/* Legend */}
                          <div className="pt-6 border-t border-gray-200">
                            <div className="flex items-center justify-between">
                              <div>
                                <h4 className="text-sm font-medium text-gray-700 mb-2">Timeline Categories</h4>
                                <div className="flex items-center space-x-6 text-xs">
                                  <div className="flex items-center space-x-1">
                                    <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                                    <span>Daily/Weekly (≤7d)</span>
                                  </div>
                                  <div className="flex items-center space-x-1">
                                    <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                                    <span>Monthly (≤90d)</span>
                                  </div>
                                  <div className="flex items-center space-x-1">
                                    <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                                    <span>Quarterly (≤365d)</span>
                                  </div>
                                  <div className="flex items-center space-x-1">
                                    <div className="w-3 h-3 bg-orange-500 rounded-full"></div>
                                    <span>Yearly (≤730d)</span>
                                  </div>
                                  <div className="flex items-center space-x-1">
                                    <div className="w-3 h-3 bg-purple-500 rounded-full"></div>
                                    <span>Multi-Year (&gt;730d)</span>
                                  </div>
                                </div>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-medium text-gray-700">Total Workflows: {filteredWorkflows.length}</p>
                                <p className="text-xs text-gray-500">Click any workflow to view details</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-center py-12">
                          <BarChart3 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                          <h3 className="text-lg font-medium text-gray-900 mb-2">No workflows available</h3>
                          <p className="text-gray-500 mb-6">Create your first workflow to see the cadence visualization</p>
                          <Button onClick={handleCreateWorkflow}>
                            <Plus className="w-4 h-4 mr-2" />
                            Create Workflow
                          </Button>
                        </div>
                      )}
                    </div>
                  </Card>

                  {/* Activity Timeline */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Quick Stats */}
                    <Card>
                      <div className="p-4 border-b border-gray-200">
                        <div className="flex items-center">
                          <PieChart className="w-5 h-5 text-indigo-500 mr-2" />
                          <h3 className="text-lg font-medium text-gray-900">Quick Stats</h3>
                        </div>
                      </div>
                      <div className="p-4 space-y-4">
                        {(() => {
                          const totalActive = filteredWorkflows.reduce((sum, w) => sum + w.active_assets, 0)
                          const totalCompleted = filteredWorkflows.reduce((sum, w) => sum + w.completed_assets, 0)
                          const totalUsage = filteredWorkflows.reduce((sum, w) => sum + w.usage_count, 0)
                          const averageCadence = Math.round(filteredWorkflows.reduce((sum, w) => sum + w.cadence_days, 0) / filteredWorkflows.length) || 0

                          return (
                            <>
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-gray-600">Total Active Assets</span>
                                <span className="text-lg font-semibold text-green-600">{totalActive}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-gray-600">Completed Assets</span>
                                <span className="text-lg font-semibold text-blue-600">{totalCompleted}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-gray-600">Total Usage</span>
                                <span className="text-lg font-semibold text-purple-600">{totalUsage}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-gray-600">Avg. Cadence</span>
                                <span className="text-lg font-semibold text-orange-600">{averageCadence}d</span>
                              </div>
                            </>
                          )
                        })()}
                      </div>
                    </Card>

                    {/* Activity Overview */}
                    <Card className="lg:col-span-2">
                      <div className="p-4 border-b border-gray-200">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center">
                            <PieChart className="w-5 h-5 text-orange-500 mr-2" />
                            <h3 className="text-lg font-medium text-gray-900">Activity Overview</h3>
                          </div>
                          <Button size="sm" variant="outline" onClick={handleCreateWorkflow}>
                            <Plus className="w-4 h-4 mr-2" />
                            New Workflow
                          </Button>
                        </div>
                      </div>
                      <div className="p-4">
                        {/* Most Active Workflows */}
                        <div className="space-y-3">
                          <h4 className="text-sm font-medium text-gray-700">Most Active Workflows</h4>
                          {(() => {
                            const sortedByActivity = [...filteredWorkflows]
                              .sort((a, b) => b.active_assets - a.active_assets)
                              .slice(0, 5)

                            return sortedByActivity.map((workflow, index) => (
                              <div
                                key={workflow.id}
                                className="flex items-center justify-between p-2 rounded hover:bg-gray-50 cursor-pointer"
                                onClick={() => handleSelectWorkflow(workflow)}
                              >
                                <div className="flex items-center space-x-3">
                                  <span className="text-xs text-gray-400 w-4">#{index + 1}</span>
                                  <div
                                    className="w-3 h-3 rounded-full"
                                    style={{ backgroundColor: workflow.color }}
                                  />
                                  <span className="text-sm font-medium text-gray-900">{workflow.name}</span>
                                </div>
                                <div className="flex items-center space-x-2 text-xs text-gray-500">
                                  <span>{workflow.active_assets} active</span>
                                  <span>•</span>
                                  <span>{workflow.usage_count} total</span>
                                  {workflow.cadence_days <= 90 && <Badge variant="outline" className="text-xs py-0 px-1">High Freq</Badge>}
                                </div>
                              </div>
                            ))
                          })()}
                        </div>

                        {/* Quick Actions */}
                        <div className="mt-6 pt-4 border-t border-gray-200">
                          <h4 className="text-sm font-medium text-gray-700 mb-3">Quick Actions</h4>
                          <div className="grid grid-cols-2 gap-2">
                            <Button size="sm" variant="outline" onClick={handleCreateWorkflow}>
                              <Plus className="w-4 h-4 mr-2" />
                              Create Workflow
                            </Button>
                            <Button size="sm" variant="outline" disabled>
                              <Settings className="w-4 h-4 mr-2" />
                              Bulk Edit
                            </Button>
                          </div>
                        </div>
                      </div>
                    </Card>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Add Stage Modal */}
      {showAddStage && selectedWorkflow && (
        <AddStageModal
          workflowId={selectedWorkflow.id}
          existingStages={selectedWorkflow.stages || []}
          onClose={() => setShowAddStage(false)}
          onSave={(stageData) => {
            addStageMutation.mutate({ workflowId: selectedWorkflow.id, stage: stageData })
          }}
        />
      )}

      {/* Edit Stage Modal */}
      {editingStage && selectedWorkflow && (
        <EditStageModal
          stage={selectedWorkflow.stages?.find(s => s.id === editingStage)!}
          onClose={() => setEditingStage(null)}
          onSave={(updates) => {
            updateStageMutation.mutate({ stageId: editingStage, updates })
            setEditingStage(null)
          }}
        />
      )}

      {/* Add Checklist Item Modal */}
      {showAddChecklistItem && selectedWorkflow && (
        <AddChecklistItemModal
          workflowId={selectedWorkflow.id}
          stageId={showAddChecklistItem}
          existingItems={workflowChecklistTemplates?.filter(t => t.stage_id === showAddChecklistItem) || []}
          onClose={() => setShowAddChecklistItem(null)}
          onSave={(itemData) => {
            addChecklistItemMutation.mutate({
              workflowId: selectedWorkflow.id,
              stageId: showAddChecklistItem,
              item: itemData
            })
          }}
        />
      )}

      {/* Edit Checklist Item Modal */}
      {editingChecklistItem && (
        <EditChecklistItemModal
          item={workflowChecklistTemplates?.find(t => t.id === editingChecklistItem)!}
          onClose={() => setEditingChecklistItem(null)}
          onSave={(updates) => {
            updateChecklistItemMutation.mutate({ itemId: editingChecklistItem, updates })
            setEditingChecklistItem(null)
          }}
        />
      )}

      {/* Workflow Manager Modal */}
      {showWorkflowManager && (
        <WorkflowManager
          isOpen={true}
          onClose={() => {
            setShowWorkflowManager(false)
            setSelectedWorkflowForEdit(null)
          }}
          selectedWorkflowId={selectedWorkflowForEdit}
          onWorkflowSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['workflows-full'] })
          }}
        />
      )}

      {/* Invite User Modal */}
      {showInviteModal && selectedWorkflow && (
        <InviteUserModal
          workflowId={selectedWorkflow.id}
          workflowName={selectedWorkflow.name}
          onClose={() => setShowInviteModal(false)}
          onInvite={(email, permission) => {
            // TODO: Implement invite functionality
            console.log('Inviting user:', email, 'with permission:', permission)
            setShowInviteModal(false)
          }}
        />
      )}

      {/* Access Request Modal */}
      {showAccessRequestModal && selectedWorkflow && (
        <AccessRequestModal
          workflowId={selectedWorkflow.id}
          workflowName={selectedWorkflow.name}
          currentPermission={selectedWorkflow.user_permission}
          onClose={() => setShowAccessRequestModal(false)}
          onRequest={(requestedPermission, reason) => {
            // TODO: Implement access request functionality
            console.log('Requesting access:', requestedPermission, 'reason:', reason)
            setShowAccessRequestModal(false)
          }}
        />
      )}

      {/* Add Rule Modal */}
      {showAddRuleModal && selectedWorkflow && (
        <AddRuleModal
          workflowId={selectedWorkflow.id}
          workflowStages={selectedWorkflow.stages || []}
          onClose={() => setShowAddRuleModal(false)}
          onSave={(ruleData) => {
            addRuleMutation.mutate({ workflowId: selectedWorkflow.id, rule: ruleData })
          }}
        />
      )}

      {/* Edit Rule Modal */}
      {editingRule && selectedWorkflow && (
        <EditRuleModal
          rule={automationRules?.find(r => r.id === editingRule)!}
          workflowStages={selectedWorkflow.stages || []}
          onClose={() => setEditingRule(null)}
          onSave={(updates) => {
            updateRuleMutation.mutate({ ruleId: editingRule, updates })
          }}
        />
      )}
    </div>
  )
}

// Modal Components
function AddStageModal({ workflowId, existingStages, onClose, onSave }: {
  workflowId: string
  existingStages: WorkflowStage[]
  onClose: () => void
  onSave: (stage: Omit<WorkflowStage, 'id' | 'created_at' | 'updated_at'>) => void
}) {
  const [formData, setFormData] = useState({
    stage_key: '',
    stage_label: '',
    stage_description: '',
    stage_color: '#3b82f6',
    stage_icon: '',
    sort_order: existingStages.length + 1,
    standard_deadline_days: 7,
    suggested_priorities: [] as string[]
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave(formData)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Add New Stage</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Stage Key</label>
            <input
              type="text"
              value={formData.stage_key}
              onChange={(e) => setFormData({ ...formData, stage_key: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="e.g., new_stage"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Stage Label</label>
            <input
              type="text"
              value={formData.stage_label}
              onChange={(e) => setFormData({ ...formData, stage_label: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="e.g., New Stage"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={formData.stage_description}
              onChange={(e) => setFormData({ ...formData, stage_description: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              rows={3}
              placeholder="Describe what happens in this stage"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Standard Deadline (days)</label>
            <input
              type="number"
              value={formData.standard_deadline_days}
              onChange={(e) => setFormData({ ...formData, standard_deadline_days: parseInt(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              min="1"
              required
            />
          </div>
          <div className="flex space-x-3 justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">
              Add Stage
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function EditStageModal({ stage, onClose, onSave }: {
  stage: WorkflowStage
  onClose: () => void
  onSave: (updates: Partial<WorkflowStage>) => void
}) {
  const [formData, setFormData] = useState({
    stage_label: stage.stage_label,
    stage_description: stage.stage_description,
    standard_deadline_days: stage.standard_deadline_days
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave(formData)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Edit Stage</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Stage Label</label>
            <input
              type="text"
              value={formData.stage_label}
              onChange={(e) => setFormData({ ...formData, stage_label: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={formData.stage_description}
              onChange={(e) => setFormData({ ...formData, stage_description: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              rows={3}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Standard Deadline (days)</label>
            <input
              type="number"
              value={formData.standard_deadline_days}
              onChange={(e) => setFormData({ ...formData, standard_deadline_days: parseInt(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              min="1"
              required
            />
          </div>
          <div className="flex space-x-3 justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">
              Save Changes
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AddChecklistItemModal({ workflowId, stageId, existingItems, onClose, onSave }: {
  workflowId: string
  stageId: string
  existingItems: any[]
  onClose: () => void
  onSave: (item: any) => void
}) {
  const [formData, setFormData] = useState({
    item_id: '',
    item_text: '',
    sort_order: existingItems.length + 1,
    is_required: false
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave(formData)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Add Checklist Item</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Item ID</label>
            <input
              type="text"
              value={formData.item_id}
              onChange={(e) => setFormData({ ...formData, item_id: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="e.g., new_item_001"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Item Text</label>
            <input
              type="text"
              value={formData.item_text}
              onChange={(e) => setFormData({ ...formData, item_text: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="e.g., Complete new analysis"
              required
            />
          </div>
          <div className="flex items-center">
            <input
              type="checkbox"
              id="is_required"
              checked={formData.is_required}
              onChange={(e) => setFormData({ ...formData, is_required: e.target.checked })}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="is_required" className="ml-2 block text-sm text-gray-900">
              Required item
            </label>
          </div>
          <div className="flex space-x-3 justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">
              Add Item
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function EditChecklistItemModal({ item, onClose, onSave }: {
  item: any
  onClose: () => void
  onSave: (updates: any) => void
}) {
  const [formData, setFormData] = useState({
    item_text: item.item_text,
    is_required: item.is_required
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave(formData)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Edit Checklist Item</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Item Text</label>
            <input
              type="text"
              value={formData.item_text}
              onChange={(e) => setFormData({ ...formData, item_text: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>
          <div className="flex items-center">
            <input
              type="checkbox"
              id="is_required_edit"
              checked={formData.is_required}
              onChange={(e) => setFormData({ ...formData, is_required: e.target.checked })}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="is_required_edit" className="ml-2 block text-sm text-gray-900">
              Required item
            </label>
          </div>
          <div className="flex space-x-3 justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">
              Save Changes
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function InviteUserModal({ workflowId, workflowName, onClose, onInvite }: {
  workflowId: string
  workflowName: string
  onClose: () => void
  onInvite: (email: string, permission: 'read' | 'write' | 'admin') => void
}) {
  const [email, setEmail] = useState('')
  const [permission, setPermission] = useState<'read' | 'write' | 'admin'>('read')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedUser, setSelectedUser] = useState<{id: string, email: string, name: string} | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)

  // Query to get all users for searchable dropdown
  const { data: users } = useQuery({
    queryKey: ['users-search'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .order('first_name')
        .order('last_name')

      if (error) throw error

      return data.map(user => ({
        id: user.id,
        email: user.email,
        name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email
      }))
    }
  })

  // Filter users based on search term
  const filteredUsers = users?.filter(user =>
    user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email.toLowerCase().includes(searchTerm.toLowerCase())
  ) || []

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const inviteEmail = selectedUser?.email || email.trim()
    if (inviteEmail) {
      onInvite(inviteEmail, permission)
    }
  }

  const handleUserSelect = (user: {id: string, email: string, name: string}) => {
    setSelectedUser(user)
    setEmail(user.email)
    setSearchTerm(user.name)
    setShowDropdown(false)
  }

  const handleSearchChange = (value: string) => {
    setSearchTerm(value)
    setSelectedUser(null)
    setEmail('')
    setShowDropdown(true)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Invite User</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mb-4">
          <p className="text-sm text-gray-600 mb-2">
            Invite a team member to collaborate on "{workflowName}"
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Search User or Enter Email
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  onFocus={() => setShowDropdown(true)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Search by name or enter email..."
                />
                <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              </div>

              {/* Dropdown */}
              {showDropdown && searchTerm && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowDropdown(false)}
                  />
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-md shadow-lg z-20 max-h-48 overflow-y-auto">
                    {filteredUsers.length > 0 ? (
                      filteredUsers.map((user) => (
                        <button
                          key={user.id}
                          type="button"
                          onClick={() => handleUserSelect(user)}
                          className="w-full text-left px-3 py-2 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
                        >
                          <div className="font-medium text-gray-900">{user.name}</div>
                          <div className="text-sm text-gray-500">{user.email}</div>
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-gray-500 text-sm">
                        No users found. You can still enter an email manually.
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Manual email input for non-found users */}
              {!selectedUser && searchTerm && !searchTerm.includes(' ') && searchTerm.includes('@') && (
                <div className="mt-2">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Or enter email manually"
                  />
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Permission Level
              </label>
              <select
                value={permission}
                onChange={(e) => setPermission(e.target.value as 'read' | 'write' | 'admin')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="read">Read Only - Can view workflow</option>
                <option value="write">Write - Can edit checklist items</option>
                <option value="admin">Admin - Can edit workflow settings</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end space-x-3 mt-6">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">
              Send Invitation
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AccessRequestModal({ workflowId, workflowName, currentPermission, onClose, onRequest }: {
  workflowId: string
  workflowName: string
  currentPermission?: 'read' | 'write' | 'admin' | 'owner'
  onClose: () => void
  onRequest: (requestedPermission: 'write' | 'admin', reason: string) => void
}) {
  const [requestedPermission, setRequestedPermission] = useState<'write' | 'admin'>('write')
  const [reason, setReason] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (reason.trim()) {
      onRequest(requestedPermission, reason.trim())
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Request Access</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mb-4">
          <p className="text-sm text-gray-600 mb-2">
            Request higher access level for "{workflowName}"
          </p>
          <div className="text-xs text-gray-500 bg-gray-50 p-2 rounded">
            Current permission: <span className="font-medium capitalize">{currentPermission}</span>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Requested Permission Level
              </label>
              <select
                value={requestedPermission}
                onChange={(e) => setRequestedPermission(e.target.value as 'write' | 'admin')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="write">Write Access - Edit checklist items and workflow content</option>
                <option value="admin">Admin Access - Full workflow management permissions</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reason for Request
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 h-24 resize-none"
                placeholder="Please explain why you need this access level..."
                required
              />
              <div className="text-xs text-gray-500 mt-1">
                This request will be sent to the workflow administrators for approval.
              </div>
            </div>
          </div>

          <div className="flex justify-end space-x-3 mt-6">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">
              Send Request
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AddRuleModal({ workflowId, workflowStages, onClose, onSave }: {
  workflowId: string
  workflowStages: WorkflowStage[]
  onClose: () => void
  onSave: (ruleData: any) => void
}) {
  const [formData, setFormData] = useState({
    name: '',
    type: 'time_based',
    conditionType: 'time_based',
    conditionValue: {},
    actionType: 'reset_workflow',
    actionValue: {},
    isActive: true
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (formData.name.trim()) {
      onSave(formData)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-gray-900">Add Automation Rule</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Rule Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Rule Name
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., Weekly Review Reminder"
              required
            />
          </div>

          {/* Rule Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Rule Type
            </label>
            <select
              value={formData.type}
              onChange={(e) => setFormData({ ...formData, type: e.target.value, conditionType: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="time_based">Time Based</option>
              <option value="earnings_date">Earnings Date</option>
              <option value="stage_based">Stage Based</option>
            </select>
          </div>

          {/* Condition Configuration */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Condition
            </label>
            {formData.conditionType === 'time_based' && (
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-600">Every</span>
                <input
                  type="number"
                  min="1"
                  value={formData.conditionValue.interval_days || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    conditionValue: { ...formData.conditionValue, interval_days: parseInt(e.target.value) }
                  })}
                  className="w-20 px-2 py-1 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="7"
                />
                <span className="text-sm text-gray-600">days</span>
              </div>
            )}
            {formData.conditionType === 'earnings_date' && (
              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  min="1"
                  value={formData.conditionValue.days_before || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    conditionValue: { ...formData.conditionValue, days_before: parseInt(e.target.value) }
                  })}
                  className="w-20 px-2 py-1 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="3"
                />
                <span className="text-sm text-gray-600">days before earnings date</span>
              </div>
            )}
          </div>

          {/* Action Configuration */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Action
            </label>
            <select
              value={formData.actionType}
              onChange={(e) => setFormData({ ...formData, actionType: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
            >
              <option value="reset_workflow">Reset Workflow</option>
              <option value="start_workflow">Start Workflow</option>
              <option value="notify_users">Notify Users</option>
            </select>

            {(formData.actionType === 'reset_workflow' || formData.actionType === 'start_workflow') && (
              <div className="mt-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Target Stage
                </label>
                <select
                  value={formData.actionValue.target_stage || formData.actionValue.reset_to_stage || ''}
                  onChange={(e) => {
                    const key = formData.actionType === 'reset_workflow' ? 'reset_to_stage' : 'target_stage'
                    setFormData({
                      ...formData,
                      actionValue: { ...formData.actionValue, [key]: e.target.value }
                    })
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select stage...</option>
                  {workflowStages.map((stage) => (
                    <option key={stage.stage_key} value={stage.stage_key}>
                      {stage.stage_label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Active Toggle */}
          <div className="flex items-center">
            <input
              type="checkbox"
              id="is_active"
              checked={formData.isActive}
              onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="is_active" className="ml-2 block text-sm text-gray-900">
              Rule is active
            </label>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">
              Create Rule
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function EditRuleModal({ rule, workflowStages, onClose, onSave }: {
  rule: any
  workflowStages: WorkflowStage[]
  onClose: () => void
  onSave: (updates: any) => void
}) {
  const [formData, setFormData] = useState({
    name: rule.rule_name || '',
    type: rule.rule_type || 'time_based',
    conditionType: rule.condition_type || 'time_based',
    conditionValue: rule.condition_value || {},
    actionType: rule.action_type || 'reset_workflow',
    actionValue: rule.action_value || {},
    isActive: rule.is_active ?? true
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (formData.name.trim()) {
      onSave(formData)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-gray-900">Edit Automation Rule</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Rule Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Rule Name
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., Weekly Review Reminder"
              required
            />
          </div>

          {/* Rule Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Rule Type
            </label>
            <select
              value={formData.type}
              onChange={(e) => setFormData({ ...formData, type: e.target.value, conditionType: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="time_based">Time Based</option>
              <option value="earnings_date">Earnings Date</option>
              <option value="stage_based">Stage Based</option>
            </select>
          </div>

          {/* Condition Configuration */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Condition
            </label>
            {formData.conditionType === 'time_based' && (
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-600">Every</span>
                <input
                  type="number"
                  min="1"
                  value={formData.conditionValue.interval_days || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    conditionValue: { ...formData.conditionValue, interval_days: parseInt(e.target.value) }
                  })}
                  className="w-20 px-2 py-1 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="7"
                />
                <span className="text-sm text-gray-600">days</span>
              </div>
            )}
            {formData.conditionType === 'earnings_date' && (
              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  min="1"
                  value={formData.conditionValue.days_before || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    conditionValue: { ...formData.conditionValue, days_before: parseInt(e.target.value) }
                  })}
                  className="w-20 px-2 py-1 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="3"
                />
                <span className="text-sm text-gray-600">days before earnings date</span>
              </div>
            )}
          </div>

          {/* Action Configuration */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Action
            </label>
            <select
              value={formData.actionType}
              onChange={(e) => setFormData({ ...formData, actionType: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
            >
              <option value="reset_workflow">Reset Workflow</option>
              <option value="start_workflow">Start Workflow</option>
              <option value="notify_users">Notify Users</option>
            </select>

            {(formData.actionType === 'reset_workflow' || formData.actionType === 'start_workflow') && (
              <div className="mt-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Target Stage
                </label>
                <select
                  value={formData.actionValue.target_stage || formData.actionValue.reset_to_stage || ''}
                  onChange={(e) => {
                    const key = formData.actionType === 'reset_workflow' ? 'reset_to_stage' : 'target_stage'
                    setFormData({
                      ...formData,
                      actionValue: { ...formData.actionValue, [key]: e.target.value }
                    })
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select stage...</option>
                  {workflowStages.map((stage) => (
                    <option key={stage.stage_key} value={stage.stage_key}>
                      {stage.stage_label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Active Toggle */}
          <div className="flex items-center">
            <input
              type="checkbox"
              id="is_active_edit"
              checked={formData.isActive}
              onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="is_active_edit" className="ml-2 block text-sm text-gray-900">
              Rule is active
            </label>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">
              Save Changes
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}