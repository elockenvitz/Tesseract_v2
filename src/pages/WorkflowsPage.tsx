import React, { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Filter, Workflow, Users, Star, Clock, BarChart3, Settings, Trash2, Edit3, Copy, Eye, TrendingUp, StarOff, Target, CheckSquare, UserCog, Calendar, GripVertical, ArrowUp, ArrowDown, Save, X, CalendarDays, Activity, PieChart, Zap, Home, FileText, Download, Globe, Check, Bell, CheckCircle, ChevronDown } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { WorkflowManager } from '../components/ui/WorkflowManager'
import { ContentTileManager } from '../components/ui/ContentTileManager'
import { CreateBranchModal } from '../components/modals/CreateBranchModal'
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
  cadence_timeframe?: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'semi-annually' | 'annually' | 'persistent'
  kickoff_cadence?: 'immediate' | 'month-start' | 'quarter-start' | 'year-start' | 'custom-date'
  kickoff_custom_date?: string
  usage_count: number
  active_assets: number
  completed_assets: number
  creator_name?: string
  is_favorited?: boolean
  stages?: WorkflowStage[]
  user_permission?: 'read' | 'write' | 'admin' | 'owner'
  usage_stats?: any[]
  archived?: boolean
  archived_at?: string
  archived_by?: string
  deleted?: boolean
  deleted_at?: string
  deleted_by?: string
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

// Helper functions for dynamic workflow name suffixes
// NOTE: These functions mirror the database functions in migration 20251023000000_add_unique_workflow_name_generator.sql
// Keep them in sync to ensure consistent behavior between frontend preview and backend execution

function getCurrentQuarter(): number {
  const month = new Date().getMonth() + 1 // getMonth() returns 0-11
  return Math.ceil(month / 3)
}

function getCurrentYear(): number {
  return new Date().getFullYear()
}

function getQuarterMonths(quarter: number): { start: string, end: string } {
  const months = {
    1: { start: 'Jan', end: 'Mar' },
    2: { start: 'Apr', end: 'Jun' },
    3: { start: 'Jul', end: 'Sep' },
    4: { start: 'Oct', end: 'Dec' }
  }
  return months[quarter as keyof typeof months]
}

/**
 * Processes dynamic placeholders in workflow name suffixes
 * Available placeholders:
 * - {Q} = Quarter number (1-4)
 * - {QUARTER} = Quarter with Q prefix (Q1-Q4)
 * - {YEAR} = Full year (e.g., 2025)
 * - {YY} = Short year (e.g., 25)
 * - {MONTH} = Current month abbreviation (e.g., Oct)
 * - {START_MONTH} = Quarter start month (e.g., Apr for Q2)
 * - {END_MONTH} = Quarter end month (e.g., Jun for Q2)
 *
 * Example: "{Q}{YEAR}" becomes "42025" in Q4 2025
 *
 * NOTE: This function is for preview only. The actual backend uses
 * process_dynamic_suffix() in PostgreSQL which guarantees uniqueness.
 */
function processDynamicSuffix(suffix: string): string {
  if (!suffix) return ''

  const now = new Date()
  const quarter = getCurrentQuarter()
  const year = getCurrentYear()
  const months = getQuarterMonths(quarter)
  const currentMonth = now.toLocaleString('en-US', { month: 'short' })
  const currentDay = now.getDate()
  const formattedDate = `${currentMonth} ${currentDay} ${year}`

  return suffix
    .replace(/{Q}/g, quarter.toString())
    .replace(/{QUARTER}/g, `Q${quarter}`)
    .replace(/{YEAR}/g, year.toString())
    .replace(/{YY}/g, year.toString().slice(-2))
    .replace(/{MONTH}/g, currentMonth)
    .replace(/{START_MONTH}/g, months.start)
    .replace(/{END_MONTH}/g, months.end)
    .replace(/{DATE}/g, formattedDate)
    .replace(/{DAY}/g, currentDay.toString())
}

export function WorkflowsPage({ className = '', tabId = 'workflows' }: WorkflowsPageProps) {
  const { user } = useAuth()
  const [searchTerm, setSearchTerm] = useState('')
  const [filterBy, setFilterBy] = useState<'all' | 'my' | 'public' | 'shared' | 'favorites'>('all')
  const [sortBy, setSortBy] = useState<'name' | 'usage' | 'created' | 'updated'>('usage')
  const [showWorkflowManager, setShowWorkflowManager] = useState(false)
  const [selectedWorkflowForEdit, setSelectedWorkflowForEdit] = useState<string | null>(null)
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowWithStats | null>(null)
  const [activeView, setActiveView] = useState<'overview' | 'stages' | 'admins' | 'universe' | 'cadence' | 'templates'>('overview')
  const [isArchivedExpanded, setIsArchivedExpanded] = useState(false)
  const [isPersistentExpanded, setIsPersistentExpanded] = useState(true)
  const [isCadenceExpanded, setIsCadenceExpanded] = useState(true)
  const [isDeletedExpanded, setIsDeletedExpanded] = useState(false)

  // Track the active tab for each workflow to restore when switching back
  const [workflowTabMemory, setWorkflowTabMemory] = useState<Record<string, 'overview' | 'stages' | 'admins' | 'universe' | 'cadence' | 'templates'>>({})

  // Function to change tabs and save the tab for the current workflow
  const handleTabChange = (newTab: 'overview' | 'stages' | 'admins' | 'universe' | 'cadence' | 'templates') => {
    if (selectedWorkflow) {
      setWorkflowTabMemory(prev => ({
        ...prev,
        [selectedWorkflow.id]: newTab
      }))
    }
    setActiveView(newTab)
  }

  // Restore the saved tab when switching workflows
  useEffect(() => {
    if (selectedWorkflow?.id && workflowTabMemory[selectedWorkflow.id]) {
      setActiveView(workflowTabMemory[selectedWorkflow.id])
    } else {
      // Default to overview if no saved tab
      setActiveView('overview')
    }
  }, [selectedWorkflow?.id])

  const [showUploadTemplateModal, setShowUploadTemplateModal] = useState(false)
  const [templateFormData, setTemplateFormData] = useState({
    name: '',
    description: '',
    file: null as File | null
  })
  const [uploadingTemplate, setUploadingTemplate] = useState(false)
  const [editingStage, setEditingStage] = useState<string | null>(null)
  const [editingChecklistItem, setEditingChecklistItem] = useState<string | null>(null)
  const [showAddStage, setShowAddStage] = useState(false)
  const [showAddChecklistItem, setShowAddChecklistItem] = useState<string | null>(null)
  const [draggedStage, setDraggedStage] = useState<string | null>(null)
  const [draggedChecklistItem, setDraggedChecklistItem] = useState<string | null>(null)
  const [dragOverItem, setDragOverItem] = useState<string | null>(null)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [showAddStakeholderModal, setShowAddStakeholderModal] = useState(false)
  const [showAccessRequestModal, setShowAccessRequestModal] = useState(false)
  const [showAddRuleModal, setShowAddRuleModal] = useState(false)
  const [editingRule, setEditingRule] = useState<string | null>(null)
  const [showCreateBranchModal, setShowCreateBranchModal] = useState(false)
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false)
  const [workflowToDelete, setWorkflowToDelete] = useState<string | null>(null)
  const [showPermanentDeleteModal, setShowPermanentDeleteModal] = useState(false)
  const [workflowToPermanentlyDelete, setWorkflowToPermanentlyDelete] = useState<string | null>(null)
  const [showDeleteStageModal, setShowDeleteStageModal] = useState(false)
  const [stageToDelete, setStageToDelete] = useState<{ id: string, key: string, label: string } | null>(null)
  const [showDeleteRuleModal, setShowDeleteRuleModal] = useState(false)
  const [ruleToDelete, setRuleToDelete] = useState<{ id: string, name: string, type: string } | null>(null)
  const [isEditingWorkflow, setIsEditingWorkflow] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
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

  // Universe configuration state
  const [selectedLists, setSelectedLists] = useState<string[]>([])
  const [selectedThemes, setSelectedThemes] = useState<string[]>([])
  const [selectedSectors, setSelectedSectors] = useState<string[]>([])
  const [selectedPriorities, setSelectedPriorities] = useState<string[]>([])
  const [selectedAnalysts, setSelectedAnalysts] = useState<string[]>([])

  // Track if universe has been initialized to prevent auto-save on load
  const universeInitialized = useRef(false)

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

  // Query for workflow branches
  const { data: workflowBranches } = useQuery({
    queryKey: ['workflow-branches', selectedWorkflow?.id],
    queryFn: async () => {
      if (!selectedWorkflow?.id) return []

      const { data, error } = await supabase
        .from('workflows')
        .select('id, name, parent_workflow_id, branch_suffix, branched_at, created_at')
        .eq('parent_workflow_id', selectedWorkflow.id)
        .order('branched_at', { ascending: false })

      if (error) {
        console.error('Error fetching workflow branches:', error)
        throw error
      }

      return data || []
    },
    enabled: !!selectedWorkflow?.id,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000
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

  // Fetch asset lists for universe configuration
  const { data: assetLists } = useQuery({
    queryKey: ['asset-lists-for-universe'],
    queryFn: async () => {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id
      if (!userId) return []

      const { data, error } = await supabase
        .from('asset_lists')
        .select('id, name, color, created_by')
        .eq('created_by', userId)
        .order('name')

      if (error) {
        console.error('Error fetching asset lists:', error)
        throw error
      }

      return data || []
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000
  })

  // Fetch themes for universe configuration
  const { data: themes } = useQuery({
    queryKey: ['themes-for-universe'],
    queryFn: async () => {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id
      if (!userId) return []

      const { data, error } = await supabase
        .from('themes')
        .select('id, name, color, created_by')
        .or(`created_by.eq.${userId},is_public.eq.true`)
        .order('name')

      if (error) {
        console.error('Error fetching themes:', error)
        throw error
      }

      return data || []
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000
  })

  // Fetch analysts for coverage universe configuration
  const { data: analysts } = useQuery({
    queryKey: ['analysts-for-universe'],
    queryFn: async () => {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id
      if (!userId) return []

      // Get unique analysts from coverage table
      const { data, error } = await supabase
        .from('coverage')
        .select('user_id, analyst_name')
        .order('analyst_name')

      if (error) {
        console.error('Error fetching analysts:', error)
        throw error
      }

      // Get unique analysts
      const uniqueAnalysts = data?.reduce((acc: any[], curr) => {
        if (!acc.find(a => a.user_id === curr.user_id)) {
          acc.push(curr)
        }
        return acc
      }, []) || []

      return uniqueAnalysts
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000
  })

  // Fetch universe rules for selected workflow
  const { data: universeRules } = useQuery({
    queryKey: ['workflow-universe-rules', selectedWorkflow?.id],
    queryFn: async () => {
      if (!selectedWorkflow?.id) return []

      const { data, error } = await supabase
        .from('workflow_universe_rules')
        .select('*')
        .eq('workflow_id', selectedWorkflow.id)
        .eq('is_active', true)
        .order('sort_order')

      if (error) {
        console.error('Error fetching universe rules:', error)
        throw error
      }

      return data || []
    },
    enabled: !!selectedWorkflow?.id,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000
  })

  // Fetch workflow collaborators for team management
  const { data: workflowCollaborators, refetch: refetchCollaborators } = useQuery({
    queryKey: ['workflow-collaborators', selectedWorkflow?.id],
    queryFn: async () => {
      if (!selectedWorkflow?.id) return []

      const { data, error } = await supabase
        .from('workflow_collaborations')
        .select(`
          id,
          user_id,
          permission,
          invited_by,
          created_at,
          user:users!workflow_collaborations_user_id_fkey(
            id,
            email,
            first_name,
            last_name
          )
        `)
        .eq('workflow_id', selectedWorkflow.id)
        .order('created_at', { ascending: true })

      if (error) {
        console.error('Error fetching collaborators:', error)
        throw error
      }

      return data || []
    },
    enabled: !!selectedWorkflow?.id,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000
  })

  // Fetch workflow stakeholders
  const { data: workflowStakeholders, refetch: refetchStakeholders } = useQuery({
    queryKey: ['workflow-stakeholders', selectedWorkflow?.id],
    queryFn: async () => {
      if (!selectedWorkflow?.id) return []

      const { data, error } = await supabase
        .from('workflow_stakeholders')
        .select(`
          id,
          user_id,
          created_at,
          created_by,
          user:users!workflow_stakeholders_user_id_fkey(
            id,
            email,
            first_name,
            last_name
          )
        `)
        .eq('workflow_id', selectedWorkflow.id)
        .order('created_at', { ascending: true })

      if (error) {
        console.error('Error fetching stakeholders:', error)
        throw error
      }

      return data || []
    },
    enabled: !!selectedWorkflow?.id,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000
  })

  // Reset universe initialization flag when workflow changes
  useEffect(() => {
    universeInitialized.current = false
  }, [selectedWorkflow?.id])

  // Load universe rules into state when they change
  useEffect(() => {
    if (!universeRules) {
      // Mark as initialized even if no rules to allow saving
      setTimeout(() => {
        universeInitialized.current = true
      }, 100)
      return
    }

    const lists: string[] = []
    const themes: string[] = []
    const sectors: string[] = []
    const priorities: string[] = []
    const analystIds: string[] = []

    universeRules.forEach((rule: any) => {
      switch (rule.rule_type) {
        case 'list':
          const listIds = rule.rule_config?.list_ids || []
          lists.push(...listIds)
          break
        case 'theme':
          const themeIds = rule.rule_config?.theme_ids || []
          themes.push(...themeIds)
          break
        case 'sector':
          const sectorNames = rule.rule_config?.sectors || []
          sectors.push(...sectorNames)
          break
        case 'priority':
          const priorityLevels = rule.rule_config?.levels || []
          priorities.push(...priorityLevels)
          break
        case 'coverage':
          const analystUserIds = rule.rule_config?.analyst_user_ids || []
          analystIds.push(...analystUserIds)
          break
      }
    })

    setSelectedLists(lists)
    setSelectedThemes(themes)
    setSelectedSectors(sectors)
    setSelectedPriorities(priorities)
    setSelectedAnalysts(analystIds)

    // Mark as initialized after loading rules
    setTimeout(() => {
      universeInitialized.current = true
    }, 100)
  }, [universeRules])

  // Auto-save universe configuration when selections change
  useEffect(() => {
    if (!universeInitialized.current || !selectedWorkflow?.id) return

    const timeoutId = setTimeout(() => {
      saveUniverseMutation.mutate({ workflowId: selectedWorkflow.id })
    }, 1000) // Debounce for 1 second

    return () => clearTimeout(timeoutId)
  }, [selectedLists, selectedThemes, selectedSectors, selectedPriorities, selectedAnalysts, selectedWorkflow?.id])

  // Query to get all workflows with statistics
  const { data: workflows, isLoading, error: workflowsError } = useQuery({
    queryKey: ['workflows-full', filterBy, sortBy, workflowStages],
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
      `).eq('archived', false).eq('deleted', false) // Only show non-archived, non-deleted workflows

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

      // Get usage statistics with detailed progress info
      const { data: usageStats } = await supabase
        .from('asset_workflow_progress')
        .select('workflow_id, is_started, completed_at, current_stage_key, started_at, asset_id')

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

        // Get stages for this workflow and sort by sort_order
        const workflowStagesData = workflowStages
          ?.filter(stage => stage.workflow_id === workflow.id)
          .sort((a, b) => a.sort_order - b.sort_order) || []

        return {
          ...workflow,
          cadence_days: workflow.cadence_days || 365, // Default to yearly if not set
          usage_count: totalUsage,
          active_assets: activeAssets,
          completed_assets: completedAssets,
          creator_name: creatorName,
          is_favorited: favoritedWorkflowIds.has(workflow.id),
          stages: workflowStagesData,
          user_permission: userPermission,
          usage_stats: workflowUsage // Include detailed usage stats for progress calculation
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

  // Update selectedWorkflow when workflows data changes (to pick up updated stages)
  useEffect(() => {
    if (selectedWorkflow && workflows) {
      const updatedWorkflow = workflows.find(w => w.id === selectedWorkflow.id)
      if (updatedWorkflow) {
        setSelectedWorkflow(updatedWorkflow)
      }
    }
  }, [workflows])

  // Filter workflows by search term
  const filteredWorkflows = workflows?.filter(workflow =>
    workflow.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    workflow.description.toLowerCase().includes(searchTerm.toLowerCase())
  ) || []

  // Separate workflows into persistent and cadence groups
  const persistentWorkflows = filteredWorkflows.filter(w =>
    w.cadence_timeframe === 'persistent'
  )
  const cadenceWorkflows = filteredWorkflows.filter(w =>
    w.cadence_timeframe !== 'persistent'
  )

  // Query for archived workflows with full data processing
  const { data: archivedWorkflows } = useQuery({
    queryKey: ['workflows-archived', workflowStages],
    enabled: !!workflowStages, // Only run when workflowStages are loaded
    queryFn: async () => {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id

      console.log('🗄️ Fetching archived workflows for user:', userId)
      console.log('🗄️ workflowStages available:', workflowStages?.length || 0, 'stages')

      if (!userId) return []

      // Get shared archived workflow IDs
      const { data: sharedArchivedIds } = await supabase
        .from('workflow_collaborations')
        .select('workflow_id')
        .eq('user_id', userId)

      const sharedIds = sharedArchivedIds?.map(s => s.workflow_id) || []
      const sharedFilter = sharedIds.length > 0 ? `,id.in.(${sharedIds.join(',')})` : ''

      // Get archived workflows that user has access to
      const { data: workflowData, error } = await supabase
        .from('workflows')
        .select(`
          *,
          users:created_by (
            first_name,
            last_name,
            email
          )
        `)
        .eq('archived', true)
        .or(`is_public.eq.true,created_by.eq.${userId}${sharedFilter}`)
        .order('archived_at', { ascending: false })

      console.log('🗄️ Archived workflows result:', { data: workflowData, error, count: workflowData?.length })

      if (error) {
        console.error('🗄️ Error fetching archived workflows:', error)
        throw error
      }

      if (!workflowData || workflowData.length === 0) return []

      // Get usage statistics for archived workflows (preserved data)
      const { data: usageStats } = await supabase
        .from('asset_workflow_progress')
        .select('workflow_id, is_started, completed_at, current_stage_key, started_at, asset_id')
        .in('workflow_id', workflowData.map(w => w.id))

      // Get user's favorited workflows
      const { data: userFavorites } = await supabase
        .from('workflow_favorites')
        .select('workflow_id')
        .eq('user_id', userId)

      const favoritedWorkflowIds = new Set(userFavorites?.map(f => f.workflow_id) || [])

      // Process archived workflows with full stats and stages (data is preserved)
      const archivedWorkflowsWithStats: WorkflowWithStats[] = workflowData.map(workflow => {
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
        }

        // Get stages for this archived workflow (stages are preserved)
        const workflowStagesData = workflowStages
          ?.filter(stage => stage.workflow_id === workflow.id)
          .sort((a, b) => a.sort_order - b.sort_order) || []

        return {
          ...workflow,
          cadence_days: workflow.cadence_days || 365,
          usage_count: totalUsage,
          active_assets: activeAssets,
          completed_assets: completedAssets,
          creator_name: creatorName,
          is_favorited: favoritedWorkflowIds.has(workflow.id),
          stages: workflowStagesData,
          user_permission: userPermission,
          usage_stats: workflowUsage
        }
      })

      console.log('🗄️ Archived workflows with stats:', archivedWorkflowsWithStats)

      return archivedWorkflowsWithStats
    }
  })

  console.log('🗄️ Archived workflows in component:', archivedWorkflows)

  // Fetch deleted workflows (separate from archived)
  const { data: deletedWorkflows } = useQuery<WorkflowWithStats[]>({
    queryKey: ['deleted-workflows'],
    queryFn: async () => {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id

      if (!userId) return []

      // Get shared deleted workflow IDs
      const { data: sharedDeletedIds } = await supabase
        .from('workflow_collaborations')
        .select('workflow_id')
        .eq('user_id', userId)

      const sharedIds = sharedDeletedIds?.map(s => s.workflow_id) || []
      const sharedFilter = sharedIds.length > 0 ? `,id.in.(${sharedIds.join(',')})` : ''

      // Get deleted workflows that user has access to
      const { data: workflowData, error } = await supabase
        .from('workflows')
        .select(`
          *,
          users:created_by (
            first_name,
            last_name,
            email
          )
        `)
        .eq('deleted', true)
        .or(`is_public.eq.true,created_by.eq.${userId}${sharedFilter}`)
        .order('deleted_at', { ascending: false })

      console.log('🗑️ Deleted workflows result:', { data: workflowData, error, count: workflowData?.length })

      if (error) {
        console.error('🗑️ Error fetching deleted workflows:', error)
        throw error
      }

      if (!workflowData || workflowData.length === 0) return []

      // Get usage statistics for deleted workflows (preserved data)
      const { data: usageStats } = await supabase
        .from('asset_workflow_progress')
        .select('workflow_id, is_started, completed_at, current_stage_key, started_at, asset_id')
        .in('workflow_id', workflowData.map(w => w.id))

      // Get user's favorited workflows
      const { data: userFavorites } = await supabase
        .from('workflow_favorites')
        .select('workflow_id')
        .eq('user_id', userId)

      const favoritedWorkflowIds = new Set(userFavorites?.map(f => f.workflow_id) || [])

      // Process deleted workflows with full stats and stages (data is preserved)
      const deletedWorkflowsWithStats: WorkflowWithStats[] = workflowData.map(workflow => {
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
        }

        // Get stages for this deleted workflow (stages are preserved)
        const workflowStagesData = workflowStages
          ?.filter(stage => stage.workflow_id === workflow.id)
          .sort((a, b) => a.sort_order - b.sort_order) || []

        return {
          ...workflow,
          cadence_days: workflow.cadence_days || 365,
          usage_count: totalUsage,
          active_assets: activeAssets,
          completed_assets: completedAssets,
          creator_name: creatorName,
          is_favorited: favoritedWorkflowIds.has(workflow.id),
          stages: workflowStagesData,
          user_permission: userPermission,
          usage_stats: workflowUsage
        }
      })

      console.log('🗑️ Deleted workflows with stats:', deletedWorkflowsWithStats)

      return deletedWorkflowsWithStats
    }
  })

  console.log('🗑️ Deleted workflows in component:', deletedWorkflows)

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
    // Tab will be restored by useEffect based on workflowTabMemory
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

  const archiveWorkflowMutation = useMutation({
    mutationFn: async (workflowId: string) => {
      const { data: { user } } = await supabase.auth.getUser()

      const { error } = await supabase
        .from('workflows')
        .update({
          archived: true,
          archived_at: new Date().toISOString(),
          archived_by: user?.id
        })
        .eq('id', workflowId)

      if (error) throw error
    },
    onSuccess: (_, deletedWorkflowId) => {
      // Find the next workflow to select
      if (workflows && workflows.length > 1) {
        const deletedIndex = workflows.findIndex(w => w.id === deletedWorkflowId)
        let nextWorkflow: WorkflowWithStats | null = null

        // Try to select the next workflow in the list
        if (deletedIndex < workflows.length - 1) {
          nextWorkflow = workflows[deletedIndex + 1]
        } else if (deletedIndex > 0) {
          // If deleted was the last one, select the previous one
          nextWorkflow = workflows[deletedIndex - 1]
        }

        if (nextWorkflow) {
          setSelectedWorkflow(nextWorkflow)
        } else {
          setSelectedWorkflow(null)
        }
      } else {
        setSelectedWorkflow(null)
      }

      queryClient.invalidateQueries({ queryKey: ['workflows-full'] })
      setShowDeleteConfirmModal(false)
      setWorkflowToDelete(null)
    },
    onError: (error) => {
      console.error('Error archiving workflow:', error)
      alert('Failed to archive workflow. Please try again.')
      setShowDeleteConfirmModal(false)
      setWorkflowToDelete(null)
    }
  })

  const deleteWorkflowMutation = useMutation({
    mutationFn: async (workflowId: string) => {
      const { data: { user } } = await supabase.auth.getUser()

      const { error } = await supabase
        .from('workflows')
        .update({
          deleted: true,
          deleted_at: new Date().toISOString(),
          deleted_by: user?.id
        })
        .eq('id', workflowId)

      if (error) throw error
      return workflowId
    },
    onSuccess: async (deletedWorkflowId) => {
      // Invalidate queries to refetch data
      await queryClient.invalidateQueries({ queryKey: ['workflows-full'] })
      await queryClient.invalidateQueries({ queryKey: ['deleted-workflows'] })

      // Fetch the updated deleted workflow to keep it selected
      const { data: deletedWorkflow } = await supabase
        .from('workflows')
        .select(`
          *,
          users:created_by (
            first_name,
            last_name,
            email
          )
        `)
        .eq('id', deletedWorkflowId)
        .single()

      if (deletedWorkflow) {
        // Update the selected workflow with the deleted version
        setSelectedWorkflow({
          ...selectedWorkflow!,
          deleted: true,
          deleted_at: deletedWorkflow.deleted_at,
          deleted_by: deletedWorkflow.deleted_by
        })
      }

      setShowPermanentDeleteModal(false)
      setWorkflowToPermanentlyDelete(null)
    },
    onError: (error) => {
      console.error('Error deleting workflow:', error)
      alert('Failed to delete workflow. Please try again.')
      setShowPermanentDeleteModal(false)
      setWorkflowToPermanentlyDelete(null)
    }
  })

  const restoreDeletedWorkflowMutation = useMutation({
    mutationFn: async (workflowId: string) => {
      const { error } = await supabase
        .from('workflows')
        .update({
          deleted: false,
          deleted_at: null,
          deleted_by: null
        })
        .eq('id', workflowId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows-full'] })
      queryClient.invalidateQueries({ queryKey: ['deleted-workflows'] })
    },
    onError: (error) => {
      console.error('Error restoring workflow:', error)
      alert('Failed to restore workflow. Please try again.')
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

  const handleArchiveWorkflow = (workflowId: string, workflowName: string) => {
    if (confirm(`Are you sure you want to archive "${workflowName}"? It will be hidden from the UI but all data will be preserved.`)) {
      archiveWorkflowMutation.mutate(workflowId)
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

      return { stageId, updates }
    },
    onSuccess: (result) => {
      // Update the selected workflow optimistically
      if (selectedWorkflow) {
        setSelectedWorkflow({
          ...selectedWorkflow,
          stages: selectedWorkflow.stages?.map(stage =>
            stage.id === result.stageId
              ? { ...stage, ...result.updates }
              : stage
          ) || []
        })
      }
    },
    onError: (error) => {
      console.error('Error updating stage:', error)
      alert('Failed to update stage. Please try again.')
    }
  })

  const addStageMutation = useMutation({
    mutationFn: async ({ workflowId, stage }: { workflowId: string, stage: Omit<WorkflowStage, 'id' | 'created_at' | 'updated_at'> }) => {
      const stageData = {
        ...stage,
        workflow_id: workflowId
      }

      console.log('Inserting stage:', stageData)

      const { data, error } = await supabase
        .from('workflow_stages')
        .insert(stageData)
        .select()

      if (error) {
        console.error('Database error:', error)
        throw error
      }

      console.log('Stage created successfully:', data)
      return { data, workflowId }
    },
    onSuccess: (result) => {
      // Update the selected workflow optimistically to add the new stage
      if (selectedWorkflow && result.data[0]) {
        const newStage = result.data[0] as WorkflowStage
        setSelectedWorkflow({
          ...selectedWorkflow,
          stages: [...(selectedWorkflow.stages || []), newStage]
        })
      }

      // Only invalidate the specific workflow query, not all workflows
      queryClient.invalidateQueries({ queryKey: ['workflow-stages', result.workflowId] })
      setShowAddStage(false)
    },
    onError: (error: any) => {
      console.error('Error adding stage:', error)
      alert(`Failed to add stage: ${error.message || 'Please try again'}`)
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

      return { stageId }
    },
    onSuccess: (result) => {
      // Update the selected workflow optimistically to remove the stage
      if (selectedWorkflow) {
        setSelectedWorkflow({
          ...selectedWorkflow,
          stages: selectedWorkflow.stages?.filter(s => s.id !== result.stageId) || []
        })
      }

      // Only invalidate specific queries
      queryClient.invalidateQueries({ queryKey: ['workflow-checklist-templates'] })
    },
    onError: (error) => {
      console.error('Error deleting stage:', error)
      alert('Failed to delete stage. Please try again.')
    }
  })

  const reorderStagesMutation = useMutation({
    mutationFn: async ({ stages }: { stages: { id: string, sort_order: number }[] }) => {
      // Update each stage's sort_order individually
      const updates = stages.map(stage =>
        supabase
          .from('workflow_stages')
          .update({ sort_order: stage.sort_order })
          .eq('id', stage.id)
      )

      const results = await Promise.all(updates)
      const error = results.find(r => r.error)?.error

      if (error) throw error

      return { stages }
    },
    onSuccess: (result) => {
      // Update the selected workflow optimistically
      if (selectedWorkflow) {
        const updatedStages = selectedWorkflow.stages?.map(stage => {
          const newOrder = result.stages.find(s => s.id === stage.id)?.sort_order
          return newOrder !== undefined ? { ...stage, sort_order: newOrder } : stage
        }).sort((a, b) => a.sort_order - b.sort_order) || []

        setSelectedWorkflow({
          ...selectedWorkflow,
          stages: updatedStages
        })
      }
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
      console.log('Adding automation rule with data:', {
        workflow_id: workflowId,
        rule_name: rule.name,
        rule_type: rule.type,
        condition_type: rule.conditionType,
        condition_value: rule.conditionValue,
        action_type: rule.actionType,
        action_value: rule.actionValue,
        is_active: rule.isActive || true
      })

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

      if (error) {
        console.error('Supabase error details:', error)
        throw error
      }
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-automation-rules'] })
      setShowAddRuleModal(false)
    },
    onError: (error: any) => {
      console.error('Error adding automation rule:', error)
      alert(`Failed to add automation rule: ${error.message || 'Please try again.'}`)
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
      queryClient.invalidateQueries({ queryKey: ['workflow-automation-rules'] })
      setEditingRule(null)
    },
    onError: (error) => {
      console.error('Error updating automation rule:', error)
      alert('Failed to update automation rule. Please try again.')
    }
  })

  // Mutation to create a workflow branch manually
  const createBranchMutation = useMutation({
    mutationFn: async ({ workflowId, branchName, branchSuffix, copyProgress, sourceBranchId }: {
      workflowId: string
      branchName: string
      branchSuffix: string
      copyProgress: boolean
      sourceBranchId?: string
    }) => {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id
      if (!userId) throw new Error('Not authenticated')

      // Get the source workflow
      const { data: sourceWorkflow, error: workflowError } = await supabase
        .from('workflows')
        .select('*')
        .eq('id', workflowId)
        .single()

      if (workflowError) throw workflowError

      // Create new workflow
      const { data: newWorkflow, error: createError } = await supabase
        .from('workflows')
        .insert({
          name: branchName,
          description: sourceWorkflow.description,
          color: sourceWorkflow.color,
          cadence_days: sourceWorkflow.cadence_days,
          is_public: sourceWorkflow.is_public,
          created_by: userId,
          parent_workflow_id: workflowId,
          branch_suffix: branchSuffix,
          branched_at: new Date().toISOString()
        })
        .select()
        .single()

      if (createError) throw createError

      return newWorkflow
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-branches'] })
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      setShowCreateBranchModal(false)
      alert('Workflow branch created successfully!')
    },
    onError: (error) => {
      console.error('Error creating workflow branch:', error)
      alert('Failed to create workflow branch. Please try again.')
    }
  })

  const deleteRuleMutation = useMutation({
    mutationFn: async (ruleId: string) => {
      console.log('🗑️ Attempting to delete rule:', ruleId)

      const { data, error } = await supabase
        .from('workflow_automation_rules')
        .delete()
        .eq('id', ruleId)
        .select()

      console.log('🗑️ Delete result:', { data, error })

      if (error) throw error

      return data
    },
    onSuccess: (data) => {
      console.log('✅ Rule deleted successfully:', data)
      queryClient.invalidateQueries({ queryKey: ['workflow-automation-rules'] })
      setShowDeleteRuleModal(false)
      setRuleToDelete(null)
    },
    onError: (error) => {
      console.error('❌ Error deleting automation rule:', error)
      alert(`Failed to delete automation rule: ${error.message}`)
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
    onMutate: async ({ workflowId, updates }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['workflows-full'] })

      // Snapshot the previous value
      const previousWorkflows = queryClient.getQueryData(['workflows-full', filterBy, sortBy, workflowStages])

      // Optimistically update the cache
      queryClient.setQueryData(['workflows-full', filterBy, sortBy, workflowStages], (old: any) => {
        if (!old) return old
        return old.map((workflow: any) =>
          workflow.id === workflowId
            ? { ...workflow, ...updates }
            : workflow
        )
      })

      // Return context with the previous data
      return { previousWorkflows }
    },
    onError: (error, variables, context) => {
      // Rollback to previous data on error
      if (context?.previousWorkflows) {
        queryClient.setQueryData(['workflows-full', filterBy, sortBy, workflowStages], context.previousWorkflows)
      }
      console.error('Error updating workflow:', error)
      alert('Failed to update workflow. Please try again.')
    },
    onSettled: () => {
      // Always refetch after error or success to ensure we have the latest data
      queryClient.invalidateQueries({ queryKey: ['workflows-full'] })
      setIsEditingWorkflow(false)
    }
  })

  // Universe configuration mutation
  const saveUniverseMutation = useMutation({
    mutationFn: async ({ workflowId }: { workflowId: string }) => {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id
      if (!userId) throw new Error('User not authenticated')

      // First, delete all existing universe rules for this workflow
      const { error: deleteError } = await supabase
        .from('workflow_universe_rules')
        .delete()
        .eq('workflow_id', workflowId)

      if (deleteError) throw deleteError

      // Now insert new rules based on selections
      const rulesToInsert: any[] = []

      // Add list rules
      if (selectedLists.length > 0) {
        rulesToInsert.push({
          workflow_id: workflowId,
          rule_type: 'list',
          rule_config: { list_ids: selectedLists },
          combination_operator: 'or',
          sort_order: 0,
          is_active: true,
          created_by: userId
        })
      }

      // Add theme rules
      if (selectedThemes.length > 0) {
        rulesToInsert.push({
          workflow_id: workflowId,
          rule_type: 'theme',
          rule_config: { theme_ids: selectedThemes, include_assets: true },
          combination_operator: 'or',
          sort_order: 1,
          is_active: true,
          created_by: userId
        })
      }

      // Add sector rules
      if (selectedSectors.length > 0) {
        rulesToInsert.push({
          workflow_id: workflowId,
          rule_type: 'sector',
          rule_config: { sectors: selectedSectors },
          combination_operator: 'or',
          sort_order: 2,
          is_active: true,
          created_by: userId
        })
      }

      // Add priority rules
      if (selectedPriorities.length > 0) {
        rulesToInsert.push({
          workflow_id: workflowId,
          rule_type: 'priority',
          rule_config: { levels: selectedPriorities },
          combination_operator: 'or',
          sort_order: 3,
          is_active: true,
          created_by: userId
        })
      }

      // Add coverage rules (analyst coverage)
      if (selectedAnalysts.length > 0) {
        rulesToInsert.push({
          workflow_id: workflowId,
          rule_type: 'coverage',
          rule_config: { analyst_user_ids: selectedAnalysts },
          combination_operator: 'or',
          sort_order: 4,
          is_active: true,
          created_by: userId
        })
      }

      // Insert new rules if there are any
      if (rulesToInsert.length > 0) {
        const { error: insertError } = await supabase
          .from('workflow_universe_rules')
          .insert(rulesToInsert)

        if (insertError) throw insertError
      }

      return rulesToInsert
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-universe-rules', selectedWorkflow?.id] })
      // Auto-save: silent success
    },
    onError: (error) => {
      console.error('Error saving universe configuration:', error)
      // Auto-save: silent error (could add toast notification here)
    }
  })

  // Update collaborator permission
  const updateCollaboratorMutation = useMutation({
    mutationFn: async ({ collaborationId, permission }: { collaborationId: string, permission: string }) => {
      const { error } = await supabase
        .from('workflow_collaborations')
        .update({ permission, updated_at: new Date().toISOString() })
        .eq('id', collaborationId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-collaborators', selectedWorkflow?.id] })
      alert('Permission updated successfully!')
    },
    onError: (error) => {
      console.error('Error updating collaborator permission:', error)
      alert('Failed to update permission. Please try again.')
    }
  })

  // Remove collaborator
  const removeCollaboratorMutation = useMutation({
    mutationFn: async (collaborationId: string) => {
      const { error } = await supabase
        .from('workflow_collaborations')
        .delete()
        .eq('id', collaborationId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-collaborators', selectedWorkflow?.id] })
      alert('Team member removed successfully!')
    },
    onError: (error) => {
      console.error('Error removing collaborator:', error)
      alert('Failed to remove team member. Please try again.')
    }
  })

  // Add stakeholder
  const addStakeholderMutation = useMutation({
    mutationFn: async ({ workflowId, userId }: { workflowId: string, userId: string }) => {
      const currentUser = await supabase.auth.getUser()
      const currentUserId = currentUser.data.user?.id

      if (!currentUserId) throw new Error('Not authenticated')

      const { error } = await supabase
        .from('workflow_stakeholders')
        .insert({
          workflow_id: workflowId,
          user_id: userId,
          created_by: currentUserId
        })

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-stakeholders', selectedWorkflow?.id] })
      refetchStakeholders()
    },
    onError: (error: any) => {
      console.error('Error adding stakeholder:', error)
      if (error.code === '23505') {
        alert('This user is already a stakeholder.')
      } else {
        alert('Failed to add stakeholder. Please try again.')
      }
    }
  })

  // Remove stakeholder
  const removeStakeholderMutation = useMutation({
    mutationFn: async (stakeholderId: string) => {
      const { error } = await supabase
        .from('workflow_stakeholders')
        .delete()
        .eq('id', stakeholderId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-stakeholders', selectedWorkflow?.id] })
      alert('Stakeholder removed successfully!')
      refetchStakeholders()
    },
    onError: (error) => {
      console.error('Error removing stakeholder:', error)
      alert('Failed to remove stakeholder. Please try again.')
    }
  })

  // Request access to workflow
  const requestAccessMutation = useMutation({
    mutationFn: async ({ workflowId, currentPermission, requestedPermission, reason }: {
      workflowId: string
      currentPermission?: string
      requestedPermission: 'write' | 'admin'
      reason: string
    }) => {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id

      if (!userId) throw new Error('Not authenticated')

      const { error } = await supabase
        .from('workflow_access_requests')
        .insert({
          workflow_id: workflowId,
          user_id: userId,
          current_permission: currentPermission || null,
          requested_permission: requestedPermission,
          reason: reason,
          status: 'pending'
        })

      if (error) throw error
    },
    onSuccess: (_data, variables) => {
      // Invalidate the pending request query for this workflow
      queryClient.invalidateQueries({ queryKey: ['pending-access-request', variables.workflowId] })
    },
    onError: (error: any) => {
      console.error('Error requesting access:', error)
      if (error.message?.includes('duplicate') || error.code === '23505') {
        alert('You already have a pending access request for this workflow.')
      } else {
        alert('Failed to send access request. Please try again.')
      }
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
    onSuccess: async (createdWorkflow) => {
      console.log('✅ Workflow created:', createdWorkflow)
      // Invalidate and refetch workflows list - use the correct query key
      await queryClient.invalidateQueries({ queryKey: ['workflows-full'] })
      await queryClient.refetchQueries({ queryKey: ['workflows-full'] })

      setShowInlineWorkflowCreator(false)

      // Select the newly created workflow - need to wait for the workflows to be refetched
      // Use a small delay to ensure the query has updated
      setTimeout(() => {
        // Get the query data with the correct key pattern
        const queryCache = queryClient.getQueryCache()
        const queries = queryCache.findAll({ queryKey: ['workflows-full'] })

        if (queries.length > 0) {
          const workflows = queries[0].state.data as WorkflowWithStats[] | undefined
          const newWorkflow = workflows?.find(w => w.id === createdWorkflow.id)
          if (newWorkflow) {
            console.log('📍 Selecting newly created workflow:', newWorkflow)
            setSelectedWorkflow(newWorkflow)
          } else {
            console.log('⚠️ Could not find newly created workflow in list')
          }
        }
      }, 200)

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

  // Fetch templates for selected workflow
  const { data: workflowTemplates, isLoading: templatesLoading } = useQuery({
    queryKey: ['workflow-templates', selectedWorkflow?.id],
    queryFn: async () => {
      if (!selectedWorkflow?.id) return []

      const { data, error } = await supabase
        .from('workflow_templates')
        .select('*')
        .eq('workflow_id', selectedWorkflow.id)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data || []
    },
    enabled: !!selectedWorkflow?.id
  })

  // Upload template mutation
  const uploadTemplateMutation = useMutation({
    mutationFn: async ({ workflowId, name, description, file }: { workflowId: string; name: string; description: string; file: File }) => {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id

      if (!userId) throw new Error('Not authenticated')

      // Upload file to storage
      const fileExt = file.name.split('.').pop()
      const fileName = `${workflowId}/${Date.now()}_${file.name}`

      const { error: uploadError } = await supabase.storage
        .from('workflow-templates')
        .upload(fileName, file)

      if (uploadError) throw uploadError

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('workflow-templates')
        .getPublicUrl(fileName)

      // Create template record
      const { data, error } = await supabase
        .from('workflow_templates')
        .insert({
          workflow_id: workflowId,
          name,
          description,
          file_url: publicUrl,
          file_name: file.name,
          file_size: file.size,
          file_type: file.type,
          uploaded_by: userId
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-templates', selectedWorkflow?.id] })
      setShowUploadTemplateModal(false)
      setTemplateFormData({ name: '', description: '', file: null })
    },
    onError: (error) => {
      console.error('Error uploading template:', error)
      alert('Failed to upload template. Please try again.')
    }
  })

  // Delete template mutation
  const deleteTemplateMutation = useMutation({
    mutationFn: async (templateId: string) => {
      const template = workflowTemplates?.find(t => t.id === templateId)
      if (!template) throw new Error('Template not found')

      // Delete file from storage
      const fileName = template.file_url.split('/').slice(-2).join('/')
      const { error: storageError } = await supabase.storage
        .from('workflow-templates')
        .remove([fileName])

      if (storageError) throw storageError

      // Delete template record
      const { error } = await supabase
        .from('workflow_templates')
        .delete()
        .eq('id', templateId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-templates', selectedWorkflow?.id] })
    },
    onError: (error) => {
      console.error('Error deleting template:', error)
      alert('Failed to delete template. Please try again.')
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
          {/* Persistent Workflows Section */}
          {persistentWorkflows.length > 0 && (
            <div>
              <button
                onClick={() => setIsPersistentExpanded(!isPersistentExpanded)}
                className="w-full px-3 py-2 flex items-center justify-between hover:bg-gray-50 transition-colors border-b border-gray-200"
              >
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Persistent Workflows ({persistentWorkflows.length})
                </h3>
                <ChevronDown
                  className={`w-4 h-4 text-gray-400 transition-transform ${
                    isPersistentExpanded ? 'transform rotate-180' : ''
                  }`}
                />
              </button>
              {isPersistentExpanded && (
                <div className="border-b border-gray-200">
                  {persistentWorkflows.map((workflow) => (
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
                            {workflow.is_favorited && (
                              <Star className="w-3 h-3 text-yellow-500 fill-current flex-shrink-0" />
                            )}
                            {workflow.is_public && (
                              <Badge variant="success" size="sm" className="flex-shrink-0">
                                Public
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 truncate mt-1">{workflow.description}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Cadence Workflows Section */}
          {cadenceWorkflows.length > 0 && (
            <div>
              <button
                onClick={() => setIsCadenceExpanded(!isCadenceExpanded)}
                className="w-full px-3 py-2 flex items-center justify-between hover:bg-gray-50 transition-colors border-b border-gray-200"
              >
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Cadence Workflows ({cadenceWorkflows.length})
                </h3>
                <ChevronDown
                  className={`w-4 h-4 text-gray-400 transition-transform ${
                    isCadenceExpanded ? 'transform rotate-180' : ''
                  }`}
                />
              </button>
              {isCadenceExpanded && (
                <div className="border-b border-gray-200">
                  {cadenceWorkflows.map((workflow) => (
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
                            {workflow.is_favorited && (
                              <Star className="w-3 h-3 text-yellow-500 fill-current flex-shrink-0" />
                            )}
                            {workflow.is_public && (
                              <Badge variant="success" size="sm" className="flex-shrink-0">
                                Public
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 truncate mt-1">{workflow.description}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {filteredWorkflows.length === 0 && (
            <div className="p-4 text-center text-gray-500 text-sm">
              {searchTerm ? 'No workflows found' : 'No workflows available'}
            </div>
          )}

          {/* Archived Workflows Section */}
          {archivedWorkflows && archivedWorkflows.length > 0 && (
            <div className="mt-6 pt-4 border-t border-gray-200">
              <button
                onClick={() => setIsArchivedExpanded(!isArchivedExpanded)}
                className="w-full px-3 pb-2 flex items-center justify-between hover:bg-gray-50 transition-colors"
              >
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Archived ({archivedWorkflows.length})
                </h3>
                <ChevronDown
                  className={`w-4 h-4 text-gray-400 transition-transform ${
                    isArchivedExpanded ? 'transform rotate-180' : ''
                  }`}
                />
              </button>
              {isArchivedExpanded && (
                <div className="space-y-1">
                  {archivedWorkflows.map((workflow: WorkflowWithStats) => (
                    <button
                      key={workflow.id}
                      onClick={() => {
                        // Archived workflows already have full data loaded
                        setSelectedWorkflow(workflow)
                      }}
                      className={`w-full text-left p-3 hover:bg-gray-50 transition-colors ${
                        selectedWorkflow?.id === workflow.id ? 'bg-gray-100' : ''
                      }`}
                    >
                      <div className="flex items-center space-x-3">
                        <div
                          className="w-3 h-3 rounded-full flex-shrink-0 opacity-50"
                          style={{ backgroundColor: workflow.color }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2">
                            <h3 className="font-medium text-sm text-gray-500 truncate">{workflow.name}</h3>
                            <Badge variant="secondary" size="sm" className="flex-shrink-0">
                              Archived
                            </Badge>
                          </div>
                          <p className="text-xs text-gray-400 truncate mt-1">
                            Archived {workflow.archived_at ? new Date(workflow.archived_at).toLocaleDateString() : 'recently'}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Deleted Workflows Section */}
          {deletedWorkflows && deletedWorkflows.length > 0 && (
            <div className="mt-6 pt-4 border-t border-gray-200">
              <button
                onClick={() => setIsDeletedExpanded(!isDeletedExpanded)}
                className="w-full px-3 pb-2 flex items-center justify-between hover:bg-gray-50 transition-colors"
              >
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Deleted ({deletedWorkflows.length})
                </h3>
                <ChevronDown
                  className={`w-4 h-4 text-gray-400 transition-transform ${
                    isDeletedExpanded ? 'transform rotate-180' : ''
                  }`}
                />
              </button>
              {isDeletedExpanded && (
                <div className="space-y-1">
                  {deletedWorkflows.map((workflow: WorkflowWithStats) => (
                    <button
                      key={workflow.id}
                      onClick={() => {
                        // Deleted workflows already have full data loaded
                        setSelectedWorkflow(workflow)
                      }}
                      className={`w-full text-left p-3 hover:bg-gray-50 transition-colors ${
                        selectedWorkflow?.id === workflow.id ? 'bg-gray-100' : ''
                      }`}
                    >
                      <div className="flex items-center space-x-3">
                        <div
                          className="w-3 h-3 rounded-full flex-shrink-0 opacity-50"
                          style={{ backgroundColor: workflow.color }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2">
                            <h3 className="font-medium text-sm text-gray-500 truncate">{workflow.name}</h3>
                            <Badge variant="secondary" size="sm" className="flex-shrink-0">
                              Deleted
                            </Badge>
                          </div>
                          <p className="text-xs text-gray-400 truncate mt-1">
                            Deleted {workflow.deleted_at ? new Date(workflow.deleted_at).toLocaleDateString() : 'recently'}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
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
              <div className="flex items-center space-x-4">
                {isEditingWorkflow ? (
                  <>
                    {/* Color Picker Circle */}
                    <div className="relative flex-shrink-0">
                      <button
                        onClick={() => setShowColorPicker(!showColorPicker)}
                        className="w-8 h-8 rounded-full border-2 border-gray-300 hover:border-gray-400 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500"
                        style={{ backgroundColor: editingWorkflowData.color }}
                        title="Change color"
                      />
                      {showColorPicker && (
                        <div className="absolute top-10 left-0 z-50 bg-white rounded-lg shadow-lg border border-gray-200 p-3">
                          <div className="grid grid-cols-5 gap-2">
                            {colorOptions.map((color) => (
                              <button
                                key={color}
                                onClick={() => {
                                  setEditingWorkflowData(prev => ({ ...prev, color }))
                                  setShowColorPicker(false)
                                }}
                                className={`w-8 h-8 rounded-full border-2 transition-all hover:scale-110 ${
                                  editingWorkflowData.color === color ? 'border-gray-900 ring-2 ring-offset-2 ring-gray-900' : 'border-gray-300 hover:border-gray-400'
                                }`}
                                style={{ backgroundColor: color }}
                                title={color}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Editing Inputs - Inline Style */}
                    <div className="flex-1 flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="flex flex-col">
                          <input
                            type="text"
                            value={editingWorkflowData.name}
                            onChange={(e) => setEditingWorkflowData(prev => ({ ...prev, name: e.target.value }))}
                            className="block px-2 py-0.5 text-xl font-bold text-gray-900 bg-transparent border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent mb-1"
                            placeholder="Workflow name"
                            style={{ width: '500px' }}
                          />
                          <input
                            type="text"
                            value={editingWorkflowData.description}
                            onChange={(e) => setEditingWorkflowData(prev => ({ ...prev, description: e.target.value }))}
                            className="block px-2 py-0.5 text-sm text-gray-600 bg-transparent border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            placeholder="Description"
                            style={{ width: '500px' }}
                          />
                        </div>
                        <div className="flex items-center space-x-2">
                          <Button
                            size="sm"
                            onClick={saveWorkflowChanges}
                            disabled={updateWorkflowMutation.isPending || !editingWorkflowData.name.trim()}
                            className="bg-primary-600 hover:bg-primary-700 text-white"
                          >
                            <Save className="w-3.5 h-3.5 mr-1" />
                            {updateWorkflowMutation.isPending ? 'Saving...' : 'Save'}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              cancelEditingWorkflow()
                              setShowColorPicker(false)
                            }}
                            disabled={updateWorkflowMutation.isPending}
                          >
                            <X className="w-3.5 h-3.5" />
                          </Button>
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
                  </>
                ) : (
                  <>
                    <div
                      className="w-8 h-8 rounded-full flex-shrink-0"
                      style={{ backgroundColor: selectedWorkflow.color }}
                    />
                    <div className="flex-1 flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div>
                          <h1 className="text-xl font-bold text-gray-900">{selectedWorkflow.name}</h1>
                          <p className="text-gray-600 text-sm">{selectedWorkflow.description}</p>
                        </div>
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
                  </>
                )}
              </div>
            </div>

            {/* Tab Navigation */}
            <div className="border-b border-gray-200">
              <nav className="flex space-x-8 px-6">
                {[
                  { id: 'overview', label: 'Overview', icon: BarChart3 },
                  { id: 'admins', label: 'Team & Admins', icon: UserCog },
                  { id: 'universe', label: 'Universe', icon: Globe },
                  { id: 'stages', label: 'Stages', icon: Target },
                  { id: 'cadence', label: 'Cadence', icon: Calendar },
                  { id: 'templates', label: 'Templates', icon: Copy }
                ].map((tab) => {
                  const Icon = tab.icon
                  return (
                    <button
                      key={tab.id}
                      onClick={() => handleTabChange(tab.id as any)}
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
                        <Button size="sm" variant="outline" onClick={() => handleTabChange('stages')}>
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
                            <Button size="sm" onClick={() => handleTabChange('stages')}>
                              <Plus className="w-4 h-4 mr-2" />
                              Configure Stages
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </Card>

                  {/* Workflow Actions Section */}
                  {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                    <Card>
                      <div className="p-6">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">Workflow Actions</h3>

                        {/* Archive Action */}
                        {!selectedWorkflow.deleted && (
                          <div className="flex items-center justify-between mb-6 pb-6 border-b border-gray-200">
                            <div>
                              <h4 className="text-base font-medium text-gray-900 mb-1">
                                {selectedWorkflow.archived ? 'Restore from Archive' : 'Archive Workflow'}
                              </h4>
                              <p className="text-sm text-gray-600">
                                {selectedWorkflow.archived
                                  ? 'Unarchive this workflow to make it active and visible in the interface again.'
                                  : 'Archive this workflow to hide it from the interface while preserving all data.'
                                }
                              </p>
                            </div>
                            {selectedWorkflow.archived ? (
                              <Button
                                variant="outline"
                                className="border-green-300 text-green-600 hover:bg-green-50 hover:border-green-400 ml-4"
                                onClick={async () => {
                                  if (confirm(`Are you sure you want to unarchive "${selectedWorkflow.name}"?`)) {
                                    const { error } = await supabase
                                      .from('workflows')
                                      .update({
                                        archived: false,
                                        archived_at: null,
                                        archived_by: null
                                      })
                                      .eq('id', selectedWorkflow.id)

                                    if (error) {
                                      alert('Failed to unarchive workflow. Please try again.')
                                    } else {
                                      queryClient.invalidateQueries({ queryKey: ['workflows-full'] })
                                      queryClient.invalidateQueries({ queryKey: ['workflows-archived'] })
                                      setSelectedWorkflow(null)
                                    }
                                  }
                                }}
                              >
                                <CheckCircle className="w-4 h-4 mr-2" />
                                Unarchive
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                className="border-orange-300 text-orange-600 hover:bg-orange-50 hover:border-orange-400 ml-4"
                                onClick={() => {
                                  setWorkflowToDelete(selectedWorkflow.id)
                                  setShowDeleteConfirmModal(true)
                                }}
                              >
                                <Trash2 className="w-4 h-4 mr-2" />
                                Archive
                              </Button>
                            )}
                          </div>
                        )}

                        {/* Delete Action */}
                        <div className="flex items-center justify-between">
                          <div>
                            <h4 className="text-base font-medium text-gray-900 mb-1">
                              {selectedWorkflow.deleted ? 'Restore Deleted Workflow' : 'Delete Workflow'}
                            </h4>
                            <p className="text-sm text-gray-600">
                              {selectedWorkflow.deleted
                                ? 'Restore this workflow to make it active again. All data is preserved.'
                                : 'Delete this workflow to remove it from the interface. You can restore it later from the Deleted section.'
                              }
                            </p>
                          </div>
                          {selectedWorkflow.deleted ? (
                            <Button
                              variant="outline"
                              className="border-green-300 text-green-600 hover:bg-green-50 hover:border-green-400 ml-4"
                              onClick={async () => {
                                if (confirm(`Are you sure you want to restore "${selectedWorkflow.name}"?`)) {
                                  restoreDeletedWorkflowMutation.mutate(selectedWorkflow.id)
                                  setSelectedWorkflow(null)
                                }
                              }}
                            >
                              <CheckCircle className="w-4 h-4 mr-2" />
                              Restore
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              className="border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400 ml-4"
                              onClick={() => {
                                setWorkflowToPermanentlyDelete(selectedWorkflow.id)
                                setShowPermanentDeleteModal(true)
                              }}
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete
                            </Button>
                          )}
                        </div>
                      </div>
                    </Card>
                  )}
                </div>
              )}

              {activeView === 'stages' && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">Workflow Stages</h3>
                    {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') &&
                     (selectedWorkflow?.stages || []).length > 0 && (
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
                                        setStageToDelete({
                                          id: stage.id,
                                          key: stage.stage_key,
                                          label: stage.stage_label
                                        })
                                        setShowDeleteStageModal(true)
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
                  {/* Header with Actions and Visibility Toggle */}
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">Team & Access Management</h3>
                      <p className="text-sm text-gray-600 mt-1">
                        Manage who can access and modify this workflow
                      </p>
                    </div>
                    <div className="flex items-center space-x-3">
                      {/* Public/Private Toggle */}
                      {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                        <div className="flex items-center space-x-2">
                          <label className="flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedWorkflow.is_public || false}
                              onChange={async (e) => {
                                const newValue = e.target.checked
                                setSelectedWorkflow({ ...selectedWorkflow, is_public: newValue })
                                try {
                                  const { error } = await supabase
                                    .from('workflows')
                                    .update({ is_public: newValue })
                                    .eq('id', selectedWorkflow.id)
                                  if (error) {
                                    setSelectedWorkflow({ ...selectedWorkflow, is_public: !newValue })
                                    throw error
                                  }
                                } catch (error) {
                                  console.error('Failed to update workflow visibility:', error)
                                }
                              }}
                              className="mr-2 rounded"
                            />
                            <span className="text-sm text-gray-700 flex items-center">
                              {selectedWorkflow.is_public ? (
                                <>
                                  <Eye className="w-4 h-4 mr-1 text-green-600" />
                                  Public
                                </>
                              ) : (
                                <>
                                  <Users className="w-4 h-4 mr-1 text-gray-600" />
                                  Private
                                </>
                              )}
                            </span>
                          </label>
                        </div>
                      )}
                      {!(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                        <Badge variant={selectedWorkflow.is_public ? "success" : "default"} size="sm">
                          {selectedWorkflow.is_public ? (
                            <>
                              <Eye className="w-3 h-3 mr-1" />
                              Public
                            </>
                          ) : (
                            <>
                              <Users className="w-3 h-3 mr-1" />
                              Private
                            </>
                          )}
                        </Badge>
                      )}

                      {/* Invite User button - disabled when public */}
                      {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                        <Button
                          size="sm"
                          onClick={() => setShowInviteModal(true)}
                          disabled={selectedWorkflow.is_public}
                          className={selectedWorkflow.is_public ? 'opacity-50 cursor-not-allowed' : ''}
                        >
                          <Plus className="w-4 h-4 mr-2" />
                          Invite User
                        </Button>
                      )}
                      {/* Allow read and write users to request elevated permissions */}
                      {(selectedWorkflow.user_permission === 'read' || selectedWorkflow.user_permission === 'write') && (
                        <Button size="sm" variant="outline" onClick={() => setShowAccessRequestModal(true)}>
                          <UserCog className="w-4 h-4 mr-2" />
                          Request Access
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-6">

                    {/* Stakeholders */}
                    <Card>
                      <div className="p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-semibold text-gray-900">Stakeholders</h4>
                            {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner' || selectedWorkflow.user_permission === 'write') && (
                              <button
                                onClick={() => setShowAddStakeholderModal(true)}
                                className="p-1 text-green-600 hover:text-green-700 hover:bg-green-50 rounded transition-colors"
                                title="Add stakeholder"
                              >
                                <Plus className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                          <span className="text-xs text-gray-500">
                            {(workflowCollaborators?.length || 0) + (workflowStakeholders?.length || 0) + 1} stakeholder{((workflowCollaborators?.length || 0) + (workflowStakeholders?.length || 0) + 1) !== 1 ? 's' : ''}
                          </span>
                        </div>

                        <div className="space-y-2">
                          {/* Owner */}
                          <div className="flex items-center justify-between p-2 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
                            <div className="flex items-center space-x-2">
                              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                                <span className="text-white font-semibold text-xs">
                                  {selectedWorkflow.creator_name?.charAt(0).toUpperCase() || '?'}
                                </span>
                              </div>
                              <div>
                                <div className="text-sm font-medium text-gray-900">
                                  {selectedWorkflow.creator_name || 'Unknown User'}
                                </div>
                                <div className="text-xs text-gray-500">Workflow owner</div>
                              </div>
                            </div>
                            <Badge variant="default" size="sm" className="bg-gray-800 text-white">
                              Owner
                            </Badge>
                          </div>

                          {/* Collaborators */}
                          {workflowCollaborators && workflowCollaborators.length > 0 ? (
                            workflowCollaborators.map((collab: any) => {
                              const user = collab.user
                              const userName = user?.first_name && user?.last_name
                                ? `${user.first_name} ${user.last_name}`
                                : user?.email || 'Unknown User'
                              const userInitial = userName.charAt(0).toUpperCase()

                              const canEdit = selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner'

                              return (
                                <div key={collab.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors">
                                  <div className="flex items-center space-x-2 flex-1 min-w-0">
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                                      collab.permission === 'admin' ? 'bg-blue-500' :
                                      collab.permission === 'write' ? 'bg-green-500' :
                                      'bg-gray-400'
                                    }`}>
                                      <span className="text-white font-semibold text-xs">{userInitial}</span>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="text-sm font-medium text-gray-900 truncate">{userName}</div>
                                      <div className="text-xs text-gray-500 truncate">{user?.email}</div>
                                    </div>
                                  </div>

                                  <div className="flex items-center space-x-2 ml-2">
                                    {canEdit ? (
                                      <select
                                        value={collab.permission}
                                        onChange={(e) => {
                                          updateCollaboratorMutation.mutate({
                                            collaborationId: collab.id,
                                            permission: e.target.value
                                          })
                                        }}
                                        className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      >
                                        <option value="admin">Admin</option>
                                        <option value="write">Write</option>
                                        <option value="read">Read</option>
                                      </select>
                                    ) : (
                                      <Badge
                                        variant={
                                          collab.permission === 'admin' ? 'secondary' :
                                          collab.permission === 'write' ? 'outline' :
                                          'destructive'
                                        }
                                        size="sm"
                                        className="capitalize"
                                      >
                                        {collab.permission}
                                      </Badge>
                                    )}

                                    {canEdit && (
                                      <button
                                        onClick={() => {
                                          if (confirm(`Remove ${userName} from this workflow?`)) {
                                            removeCollaboratorMutation.mutate(collab.id)
                                          }
                                        }}
                                        className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                        title="Remove member"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )
                            })
                          ) : null}

                          {/* Stakeholders (non-collaborator users) */}
                          {workflowStakeholders && workflowStakeholders.length > 0 && workflowStakeholders.map((stakeholder: any) => {
                            const user = stakeholder.user
                            const userName = user?.first_name && user?.last_name
                              ? `${user.first_name} ${user.last_name}`
                              : user?.email || 'Unknown User'
                            const userInitial = userName.charAt(0).toUpperCase()

                            const canEdit = selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner' || selectedWorkflow.user_permission === 'write'

                            return (
                              <div key={stakeholder.id} className="flex items-center justify-between p-2 bg-green-50 rounded-lg border border-green-200 hover:border-green-300 transition-colors">
                                <div className="flex items-center space-x-2 flex-1 min-w-0">
                                  <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                                    <span className="text-white font-semibold text-xs">{userInitial}</span>
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-gray-900 truncate">{userName}</div>
                                    <div className="text-xs text-gray-500 truncate">{user?.email}</div>
                                  </div>
                                </div>

                                <div className="flex items-center space-x-2 ml-2">
                                  <Badge variant="success" size="sm">Stakeholder</Badge>
                                  {canEdit && (
                                    <button
                                      onClick={() => {
                                        if (confirm(`Remove ${userName} as stakeholder?`)) {
                                          removeStakeholderMutation.mutate(stakeholder.id)
                                        }
                                      }}
                                      className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                      title="Remove stakeholder"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </Card>
                  </div>
                </div>
              )}

              {activeView === 'universe' && (
                <div className="space-y-6">
                  {/* Header */}
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Workflow Universe</h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Define which assets, themes, or portfolios will automatically receive this workflow when it kicks off
                    </p>
                  </div>

                  {/* Universe Definition Form */}
                  <Card>
                    <div className="p-6">
                      <div className="flex items-center justify-between mb-6">
                        <h4 className="text-base font-semibold text-gray-900">Define Universe</h4>
                        <div className="text-sm text-gray-500">
                          Select which assets should receive this workflow
                        </div>
                      </div>

                      <div className="space-y-6">
                        {/* Analyst Coverage Section */}
                        <div className="border-b border-gray-200 pb-6">
                          <div className="flex items-center justify-between mb-3">
                            <h5 className="text-sm font-semibold text-gray-900 flex items-center">
                              <Users className="w-4 h-4 mr-2 text-indigo-600" />
                              Include assets covered by these analysts:
                            </h5>
                            <span className="text-xs text-gray-500">{selectedAnalysts.length} selected</span>
                          </div>
                          <div className="space-y-2 ml-6">
                            {analysts && analysts.length > 0 ? (
                              analysts.map((analyst: any) => (
                                <label key={analyst.user_id} className="flex items-center space-x-3 cursor-pointer group">
                                  <input
                                    type="checkbox"
                                    checked={selectedAnalysts.includes(analyst.user_id)}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setSelectedAnalysts([...selectedAnalysts, analyst.user_id])
                                      } else {
                                        setSelectedAnalysts(selectedAnalysts.filter(id => id !== analyst.user_id))
                                      }
                                    }}
                                    className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                                  />
                                  <span className="text-sm text-gray-700 group-hover:text-gray-900">{analyst.analyst_name}</span>
                                </label>
                              ))
                            ) : (
                              <p className="text-xs text-gray-500 italic">No analyst coverage data available</p>
                            )}
                          </div>
                        </div>

                        {/* Asset Lists Section */}
                        <div className="border-b border-gray-200 pb-6">
                          <div className="flex items-center justify-between mb-3">
                            <h5 className="text-sm font-semibold text-gray-900 flex items-center">
                              <FileText className="w-4 h-4 mr-2 text-blue-600" />
                              Include assets from these lists:
                            </h5>
                            <span className="text-xs text-gray-500">{selectedLists.length} selected</span>
                          </div>
                          <div className="space-y-2 ml-6">
                            {assetLists && assetLists.length > 0 ? (
                              assetLists.map((list: any) => (
                                <label key={list.id} className="flex items-center space-x-3 cursor-pointer group">
                                  <input
                                    type="checkbox"
                                    checked={selectedLists.includes(list.id)}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setSelectedLists([...selectedLists, list.id])
                                      } else {
                                        setSelectedLists(selectedLists.filter(id => id !== list.id))
                                      }
                                    }}
                                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                  />
                                  <span className="text-sm text-gray-700 group-hover:text-gray-900">{list.name}</span>
                                </label>
                              ))
                            ) : (
                              <p className="text-xs text-gray-500 italic">No lists available - create a list first</p>
                            )}
                          </div>
                        </div>

                        {/* Themes Section */}
                        <div className="border-b border-gray-200 pb-6">
                          <div className="flex items-center justify-between mb-3">
                            <h5 className="text-sm font-semibold text-gray-900 flex items-center">
                              <PieChart className="w-4 h-4 mr-2 text-purple-600" />
                              Include assets from these themes:
                            </h5>
                            <span className="text-xs text-gray-500">{selectedThemes.length} selected</span>
                          </div>
                          <div className="space-y-2 ml-6">
                            {themes && themes.length > 0 ? (
                              themes.map((theme: any) => (
                                <label key={theme.id} className="flex items-center space-x-3 cursor-pointer group">
                                  <input
                                    type="checkbox"
                                    checked={selectedThemes.includes(theme.id)}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setSelectedThemes([...selectedThemes, theme.id])
                                      } else {
                                        setSelectedThemes(selectedThemes.filter(id => id !== theme.id))
                                      }
                                    }}
                                    className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                                  />
                                  <span className="text-sm text-gray-700 group-hover:text-gray-900">{theme.name}</span>
                                </label>
                              ))
                            ) : (
                              <p className="text-xs text-gray-500 italic">No themes available - create a theme first</p>
                            )}
                          </div>
                        </div>

                        {/* Sectors Section */}
                        <div className="border-b border-gray-200 pb-6">
                          <div className="flex items-center justify-between mb-3">
                            <h5 className="text-sm font-semibold text-gray-900 flex items-center">
                              <Filter className="w-4 h-4 mr-2 text-green-600" />
                              Include assets from these sectors:
                            </h5>
                            <span className="text-xs text-gray-500">{selectedSectors.length} selected</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 ml-6">
                            {['Communication Services', 'Consumer', 'Energy', 'Financials', 'Healthcare', 'Industrials', 'Materials', 'Real Estate', 'Technology', 'Utilities'].map((sector) => (
                              <label key={sector} className="flex items-center space-x-3 cursor-pointer group">
                                <input
                                  type="checkbox"
                                  checked={selectedSectors.includes(sector)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedSectors([...selectedSectors, sector])
                                    } else {
                                      setSelectedSectors(selectedSectors.filter(s => s !== sector))
                                    }
                                  }}
                                  className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
                                />
                                <span className="text-sm text-gray-700 group-hover:text-gray-900">{sector}</span>
                              </label>
                            ))}
                          </div>
                        </div>

                        {/* Priority Section */}
                        <div className="border-b border-gray-200 pb-6">
                          <div className="flex items-center justify-between mb-3">
                            <h5 className="text-sm font-semibold text-gray-900 flex items-center">
                              <Star className="w-4 h-4 mr-2 text-amber-600" />
                              Include assets with these priorities:
                            </h5>
                            <span className="text-xs text-gray-500">{selectedPriorities.length} selected</span>
                          </div>
                          <div className="space-y-2 ml-6">
                            {['Critical', 'High', 'Medium', 'Low'].map((priority) => (
                              <label key={priority} className="flex items-center space-x-3 cursor-pointer group">
                                <input
                                  type="checkbox"
                                  checked={selectedPriorities.includes(priority)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedPriorities([...selectedPriorities, priority])
                                    } else {
                                      setSelectedPriorities(selectedPriorities.filter(p => p !== priority))
                                    }
                                  }}
                                  className="w-4 h-4 text-amber-600 border-gray-300 rounded focus:ring-amber-500"
                                />
                                <span className="text-sm text-gray-700 group-hover:text-gray-900">{priority}</span>
                              </label>
                            ))}
                          </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex justify-between items-center pt-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedAnalysts([])
                              setSelectedLists([])
                              setSelectedThemes([])
                              setSelectedSectors([])
                              setSelectedPriorities([])
                            }}
                          >
                            Reset
                          </Button>

                          {/* Auto-save status indicator */}
                          <div className="flex items-center text-sm">
                            {saveUniverseMutation.isPending ? (
                              <>
                                <Clock className="w-4 h-4 mr-2 text-gray-400 animate-pulse" />
                                <span className="text-gray-500">Saving...</span>
                              </>
                            ) : (
                              <>
                                <Check className="w-4 h-4 mr-2 text-green-600" />
                                <span className="text-gray-500">Saved</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </Card>
                </div>
              )}

              {activeView === 'cadence' && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">Cadence & Automation</h3>
                      <p className="text-sm text-gray-500 mt-1">Configure workflow timing and automated rules</p>
                    </div>
                    {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                      <Button size="sm" onClick={() => setShowAddRuleModal(true)}>
                        <Plus className="w-4 h-4 mr-2" />
                        Add Rule
                      </Button>
                    )}
                  </div>

                  {/* Frequency Category Card */}
                  <Card className="border-l-4 border-l-blue-500">
                    <div className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center space-x-2">
                          <Calendar className="w-4 h-4 text-blue-600" />
                          <h4 className="text-sm font-semibold text-gray-900">Frequency Category</h4>
                        </div>
                        <select
                          value={selectedWorkflow.cadence_timeframe || 'annually'}
                          onChange={async (e) => {
                            const timeframe = e.target.value as 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'semi-annually' | 'annually' | 'persistent'
                            const daysMap = {
                              'daily': 1,
                              'weekly': 7,
                              'monthly': 30,
                              'quarterly': 90,
                              'semi-annually': 180,
                              'annually': 365,
                              'persistent': 0
                            }

                            console.log('Updating workflow frequency category to:', timeframe, 'for workflow:', selectedWorkflow.id)

                            const { data, error } = await supabase
                              .from('workflows')
                              .update({
                                cadence_timeframe: timeframe,
                                cadence_days: daysMap[timeframe]
                              })
                              .eq('id', selectedWorkflow.id)
                              .select()

                            if (error) {
                              console.error('Error updating workflow frequency category:', error)
                              console.error('Error details:', JSON.stringify(error, null, 2))
                              alert(`Failed to update frequency category: ${error.message || error.code || 'Unknown error'}`)
                            } else {
                              console.log('Successfully updated workflow:', data)
                              queryClient.invalidateQueries({ queryKey: ['workflows-full'] })
                              // Also update the local state
                              setSelectedWorkflow({
                                ...selectedWorkflow,
                                cadence_timeframe: timeframe,
                                cadence_days: daysMap[timeframe]
                              })
                            }
                          }}
                          disabled={selectedWorkflow.user_permission === 'read'}
                          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                        >
                          <option value="daily">Daily</option>
                          <option value="weekly">Weekly</option>
                          <option value="monthly">Monthly</option>
                          <option value="quarterly">Quarterly</option>
                          <option value="semi-annually">Semi-Annually</option>
                          <option value="annually">Annually</option>
                          <option value="persistent">Persistent (No Reset)</option>
                        </select>
                      </div>
                    </div>
                  </Card>

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
                          <div className="p-4">
                            <div className="flex items-start justify-between mb-3">
                              <div className="flex-1">
                                <div className="flex items-center space-x-2 mb-1">
                                  <h4 className="text-base font-semibold text-gray-900">{rule.rule_name}</h4>
                                  <Badge variant={rule.is_active ? "success" : "secondary"} size="sm">
                                    {rule.is_active ? "Active" : "Inactive"}
                                  </Badge>
                                  <Badge variant="outline" size="sm" className="capitalize">
                                    {rule.rule_type.replace('_', ' ')}
                                  </Badge>
                                </div>
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
                                      setRuleToDelete({
                                        id: rule.id,
                                        name: rule.rule_name,
                                        type: rule.rule_type
                                      })
                                      setShowDeleteRuleModal(true)
                                    }}
                                    title="Delete rule"
                                    className="p-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </div>
                              )}
                            </div>

                            <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                              <div className="grid grid-cols-2 gap-3">
                                <div className="flex-1">
                                  <div className="flex items-center space-x-1 mb-1">
                                    <Clock className="w-3.5 h-3.5 text-blue-600" />
                                    <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">When</span>
                                  </div>
                                  <div className="text-sm text-gray-900 ml-4.5">
                                    {/* Time-based triggers */}
                                    {(rule.condition_type === 'time_based' || rule.condition_type === 'time_interval') && (
                                      <>
                                        {/* Daily patterns */}
                                        {rule.condition_value?.pattern_type === 'daily' && (
                                          <>
                                            {rule.condition_value?.daily_type === 'every_x_days' && (
                                              <span>Every {rule.condition_value.interval || 1} day{rule.condition_value.interval !== 1 ? 's' : ''}</span>
                                            )}
                                            {rule.condition_value?.daily_type === 'every_weekday' && (
                                              <span>Every weekday</span>
                                            )}
                                          </>
                                        )}

                                        {/* Weekly patterns */}
                                        {rule.condition_value?.pattern_type === 'weekly' && (
                                          <span>
                                            Every {rule.condition_value.interval || 1} week{rule.condition_value.interval !== 1 ? 's' : ''} on {
                                              (rule.condition_value.days_of_week || []).map((day: string) =>
                                                day.charAt(0).toUpperCase() + day.slice(1)
                                              ).join(', ')
                                            }
                                          </span>
                                        )}

                                        {/* Monthly patterns */}
                                        {rule.condition_value?.pattern_type === 'monthly' && (
                                          <>
                                            {rule.condition_value?.monthly_type === 'day_of_month' && (
                                              <span>Day {rule.condition_value.day_number} of every {rule.condition_value.interval || 1} month{rule.condition_value.interval !== 1 ? 's' : ''}</span>
                                            )}
                                            {rule.condition_value?.monthly_type === 'position_of_month' && (
                                              <span>
                                                The {rule.condition_value.position} {rule.condition_value.day_name} of every {rule.condition_value.interval || 1} month{rule.condition_value.interval !== 1 ? 's' : ''}
                                              </span>
                                            )}
                                          </>
                                        )}

                                        {/* Quarterly patterns */}
                                        {rule.condition_value?.pattern_type === 'quarterly' && (
                                          <>
                                            {rule.condition_value?.quarterly_type === 'day_of_quarter' && (
                                              <span>Day {rule.condition_value.day_number} of every {rule.condition_value.interval || 1} quarter{rule.condition_value.interval !== 1 ? 's' : ''}</span>
                                            )}
                                            {rule.condition_value?.quarterly_type === 'position_of_quarter' && (
                                              <span>
                                                The {rule.condition_value.position} {rule.condition_value.day_name} of every {rule.condition_value.interval || 1} quarter{rule.condition_value.interval !== 1 ? 's' : ''}
                                              </span>
                                            )}
                                          </>
                                        )}

                                        {/* Yearly patterns */}
                                        {rule.condition_value?.pattern_type === 'yearly' && (
                                          <>
                                            {rule.condition_value?.yearly_type === 'day_of_year' && (
                                              <span>
                                                {rule.condition_value.month} {rule.condition_value.day_number} of every {rule.condition_value.interval || 1} year{rule.condition_value.interval !== 1 ? 's' : ''}
                                              </span>
                                            )}
                                            {rule.condition_value?.yearly_type === 'position_of_year' && (
                                              <span>
                                                The {rule.condition_value.position} {rule.condition_value.day_name} of {rule.condition_value.month} every {rule.condition_value.interval || 1} year{rule.condition_value.interval !== 1 ? 's' : ''}
                                              </span>
                                            )}
                                          </>
                                        )}

                                        {/* Legacy patterns */}
                                        {rule.condition_value?.pattern === 'interval' && rule.condition_value?.interval_days && (
                                          <span>Every {rule.condition_value.interval_days} days</span>
                                        )}
                                        {rule.condition_value?.pattern === 'first_of_month' && (
                                          <span>First day of each month</span>
                                        )}
                                        {rule.condition_value?.pattern === 'last_of_month' && (
                                          <span>Last day of each month</span>
                                        )}
                                        {rule.condition_value?.pattern === 'first_of_quarter' && (
                                          <span>First day of each quarter</span>
                                        )}
                                        {rule.condition_value?.pattern === 'last_of_quarter' && (
                                          <span>Last day of each quarter</span>
                                        )}
                                        {rule.condition_value?.pattern === 'first_of_year' && (
                                          <span>First day of each year</span>
                                        )}
                                        {rule.condition_value?.pattern === 'last_of_year' && (
                                          <span>Last day of each year</span>
                                        )}
                                        {rule.condition_value?.pattern === 'specific_day_of_month' && rule.condition_value?.day_of_month && (
                                          <span>Day {rule.condition_value.day_of_month} of each month</span>
                                        )}
                                        {/* Legacy support - no pattern specified but has interval_days */}
                                        {!rule.condition_value?.pattern && !rule.condition_value?.pattern_type && rule.condition_value?.interval_days && (
                                          <span>Every {rule.condition_value.interval_days} days</span>
                                        )}

                                        {/* Show start and end dates if specified */}
                                        {rule.condition_value?.start_date && (
                                          <div className="text-xs text-gray-500 mt-1">
                                            Starting: {new Date(rule.condition_value.start_date).toLocaleDateString()}
                                          </div>
                                        )}
                                        {rule.condition_value?.end_type === 'on_date' && rule.condition_value?.end_date && (
                                          <div className="text-xs text-gray-500 mt-1">
                                            Ending: {new Date(rule.condition_value.end_date).toLocaleDateString()}
                                          </div>
                                        )}
                                        {rule.condition_value?.end_type === 'after_occurrences' && rule.condition_value?.occurrences && (
                                          <div className="text-xs text-gray-500 mt-1">
                                            For {rule.condition_value.occurrences} occurrence{rule.condition_value.occurrences !== 1 ? 's' : ''}
                                          </div>
                                        )}
                                      </>
                                    )}

                                    {/* Event-based triggers */}
                                    {rule.condition_type === 'earnings_date' && (
                                      <span>
                                        {rule.condition_value?.days_offset || 0} days {rule.condition_value?.timing || 'before'} earnings
                                      </span>
                                    )}
                                    {rule.condition_type === 'price_change' && (
                                      <span>
                                        Price changes {rule.condition_value?.direction === 'up' ? 'up' : rule.condition_value?.direction === 'down' ? 'down' : ''} by {rule.condition_value?.percentage || 0}%
                                      </span>
                                    )}
                                    {rule.condition_type === 'volume_spike' && (
                                      <span>
                                        Volume is {rule.condition_value?.multiplier || 1}× average
                                      </span>
                                    )}
                                    {rule.condition_type === 'dividend_date' && (
                                      <span>
                                        {rule.condition_value?.days_offset || 0} days {rule.condition_value?.timing || 'before'} dividend date
                                      </span>
                                    )}
                                    {rule.condition_type === 'conference' && (
                                      <span>
                                        {rule.condition_value?.days_offset || 0} days {rule.condition_value?.timing || 'before'} conference
                                      </span>
                                    )}
                                    {rule.condition_type === 'investor_relations_call' && (
                                      <span>
                                        {rule.condition_value?.days_offset || 0} days {rule.condition_value?.timing || 'before'} investor relations call
                                      </span>
                                    )}
                                    {rule.condition_type === 'analyst_call' && (
                                      <span>
                                        {rule.condition_value?.days_offset || 0} days {rule.condition_value?.timing || 'before'} sell-side analyst call
                                      </span>
                                    )}
                                    {rule.condition_type === 'roadshow' && (
                                      <span>
                                        {rule.condition_value?.days_offset || 0} days {rule.condition_value?.timing || 'before'} roadshow
                                      </span>
                                    )}

                                    {/* Activity-based triggers */}
                                    {rule.condition_type === 'stage_completion' && (
                                      <span>
                                        Stage {rule.condition_value?.stage_key ? `"${rule.condition_value.stage_key}"` : 'any'} completed
                                      </span>
                                    )}
                                    {rule.condition_type === 'note_added' && (
                                      <span>Note is added</span>
                                    )}
                                    {rule.condition_type === 'list_assignment' && (
                                      <span>Asset added to list</span>
                                    )}
                                    {rule.condition_type === 'workflow_start' && (
                                      <span>Workflow is started</span>
                                    )}

                                    {/* Perpetual */}
                                    {rule.condition_type === 'always_available' && (
                                      <span>Always available</span>
                                    )}

                                    {/* Fallback for old or unknown types */}
                                    {!rule.condition_value && !['always_available', 'note_added', 'list_assignment', 'workflow_start'].includes(rule.condition_type) && (
                                      <span className="capitalize">{rule.condition_type.replace('_', ' ')}</span>
                                    )}
                                  </div>
                                </div>

                                <div className="flex-1">
                                  <div className="flex items-center space-x-1 mb-1">
                                    <Target className="w-3.5 h-3.5 text-green-600" />
                                    <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Then</span>
                                  </div>
                                  <div className="text-sm text-gray-900 ml-4.5">
                                    {/* New action types */}
                                    {rule.action_type === 'reset_complete' && (
                                      <span>
                                        Reset completely to {rule.action_value?.target_stage || 'first stage'}
                                      </span>
                                    )}
                                    {rule.action_type === 'branch_copy' && (
                                      <span>
                                        Copy and append "{rule.action_value?.branch_suffix || 'new branch'}"
                                      </span>
                                    )}
                                    {rule.action_type === 'branch_nocopy' && (
                                      <span>
                                        Create new instance and append "{rule.action_value?.branch_suffix || 'new branch'}"
                                      </span>
                                    )}
                                    {rule.action_type === 'move_stage' && (
                                      <span>
                                        Move to {rule.action_value?.target_stage || 'first stage'}
                                      </span>
                                    )}
                                    {rule.action_type === 'notify_only' && (
                                      <span>Send notification only</span>
                                    )}

                                    {/* Legacy action types */}
                                    {rule.action_type === 'reset_workflow' && (
                                      <span>
                                        Reset to {rule.action_value?.reset_to_stage || rule.action_value?.target_stage || 'first stage'}
                                      </span>
                                    )}
                                    {rule.action_type === 'start_workflow' && (
                                      <span>
                                        Start at {rule.action_value?.target_stage || 'first stage'}
                                      </span>
                                    )}
                                    {rule.action_type === 'notify_users' && (
                                      <span>Notify users</span>
                                    )}

                                    {/* Fallback */}
                                    {!['reset_complete', 'branch_copy', 'branch_nocopy', 'move_stage', 'notify_only', 'reset_workflow', 'start_workflow', 'notify_users'].includes(rule.action_type) && (
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

                  {/* Workflow Branches Section */}
                  <div className="mt-8">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-base font-semibold text-gray-900">Workflow Branches</h3>
                        <p className="text-sm text-gray-500 mt-1">Workflow instances created</p>
                      </div>
                      {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner' || selectedWorkflow.user_permission === 'write') && (
                        <Button size="sm" onClick={() => setShowCreateBranchModal(true)}>
                          <Plus className="w-4 h-4 mr-2" />
                          Create Branch
                        </Button>
                      )}
                    </div>

                    {!workflowBranches || workflowBranches.length === 0 ? (
                      <Card>
                        <div className="text-center py-8">
                          <Workflow className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                          <h3 className="text-base font-medium text-gray-900 mb-2">No workflow branches yet</h3>
                          <p className="text-sm text-gray-500">
                            When a new workflow branch is created, it will appear here
                          </p>
                        </div>
                      </Card>
                    ) : (
                      <div className="space-y-3">
                        {workflowBranches.map((branch) => (
                          <Card key={branch.id} className="hover:shadow-md transition-shadow">
                            <div className="p-3">
                              <div className="flex items-center justify-between">
                                <div className="flex-1">
                                  <div className="flex items-center space-x-2">
                                    <Workflow className="w-4 h-4 text-indigo-600" />
                                    <h4 className="text-sm font-medium text-gray-900">{branch.name}</h4>
                                  </div>
                                  {branch.branch_suffix && (
                                    <div className="text-xs text-gray-500 mt-1 ml-6">
                                      Suffix: {branch.branch_suffix}
                                    </div>
                                  )}
                                </div>
                                <div className="text-xs text-gray-500">
                                  Created {new Date(branch.branched_at || branch.created_at).toLocaleDateString()}
                                </div>
                              </div>
                            </div>
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Templates View */}
              {activeView === 'templates' && (
                <div className="px-6 py-6">
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">Workflow Templates</h3>
                        <p className="text-sm text-gray-500 mt-1">Upload and manage templates that your team will use in this workflow</p>
                      </div>
                      {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                        <Button size="sm" onClick={() => setShowUploadTemplateModal(true)}>
                          <Plus className="w-4 h-4 mr-2" />
                          Upload Template
                        </Button>
                      )}
                    </div>

                    {/* Templates List */}
                    {templatesLoading ? (
                      <div className="text-center py-12">
                        <p className="text-gray-500">Loading templates...</p>
                      </div>
                    ) : workflowTemplates && workflowTemplates.length > 0 ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {workflowTemplates.map((template) => (
                          <Card key={template.id} className="hover:shadow-md transition-shadow">
                            <div className="p-4">
                              <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center space-x-3">
                                  <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
                                    <FileText className="w-5 h-5 text-blue-600" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <h4 className="text-sm font-medium text-gray-900 truncate">{template.name}</h4>
                                    <p className="text-xs text-gray-500">{template.file_name}</p>
                                  </div>
                                </div>
                              </div>

                              {template.description && (
                                <p className="text-xs text-gray-600 mb-3 line-clamp-2">{template.description}</p>
                              )}

                              <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                                <span className="text-xs text-gray-400">
                                  {template.file_size ? `${(template.file_size / 1024).toFixed(1)} KB` : 'Unknown size'}
                                </span>
                                <div className="flex items-center space-x-2">
                                  <button
                                    onClick={() => window.open(template.file_url, '_blank')}
                                    className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                    title="Download template"
                                  >
                                    <Download className="w-4 h-4" />
                                  </button>
                                  {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                                    <button
                                      onClick={() => {
                                        if (confirm(`Are you sure you want to delete "${template.name}"?`)) {
                                          deleteTemplateMutation.mutate(template.id)
                                        }
                                      }}
                                      className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                                      title="Delete template"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </Card>
                        ))}
                      </div>
                    ) : (
                      <Card className="border-2 border-dashed border-gray-300">
                        <div className="p-8 text-center">
                          <Copy className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                          <p className="text-sm text-gray-500 font-medium">No templates uploaded yet</p>
                          {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                            <p className="text-xs text-gray-400 mt-2">Click "Upload Template" to add files for your team</p>
                          )}
                        </div>
                      </Card>
                    )}
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
              {filteredWorkflows.length === 0 && !isLoading ? (
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
              ) : filteredWorkflows.length > 0 ? (
                <div className="space-y-6">
                  {/* Workflow Cadence Visualization */}
                  <Card>
                    <div className="p-6 border-b border-gray-200">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center">
                          <BarChart3 className="w-6 h-6 text-indigo-500 mr-3" />
                          <div>
                            <h3 className="text-xl font-semibold text-gray-900">Workflow Cadence Map</h3>
                            <p className="text-sm text-gray-500">Track the cycle and progress of each workflow</p>
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
                        <div className="space-y-6">
                          {/* Workflows grouped by frequency */}
                          {(() => {
                            console.log('Grouping workflows by frequency category...')
                            // Group workflows by frequency category based on cadence_timeframe if available
                            const groups = {
                              'Persistent': filteredWorkflows.filter(w => w.cadence_timeframe === 'persistent' || (!w.cadence_timeframe && w.cadence_days === 0)),
                              'Daily': filteredWorkflows.filter(w => w.cadence_timeframe === 'daily' || (!w.cadence_timeframe && w.cadence_days <= 1 && w.cadence_days > 0)),
                              'Weekly': filteredWorkflows.filter(w => w.cadence_timeframe === 'weekly' || (!w.cadence_timeframe && w.cadence_days > 1 && w.cadence_days <= 7)),
                              'Monthly': filteredWorkflows.filter(w => w.cadence_timeframe === 'monthly' || (!w.cadence_timeframe && w.cadence_days > 7 && w.cadence_days <= 30)),
                              'Quarterly': filteredWorkflows.filter(w => w.cadence_timeframe === 'quarterly' || (!w.cadence_timeframe && w.cadence_days > 30 && w.cadence_days <= 90)),
                              'Semi-Annually': filteredWorkflows.filter(w => w.cadence_timeframe === 'semi-annually' || (!w.cadence_timeframe && w.cadence_days > 90 && w.cadence_days <= 180)),
                              'Annually': filteredWorkflows.filter(w => w.cadence_timeframe === 'annually' || (!w.cadence_timeframe && w.cadence_days > 180 && w.cadence_days <= 365))
                            }

                            return Object.entries(groups).map(([category, workflows]) => {
                              if (workflows.length === 0) return null

                              // Determine category color
                              let categoryColor = ''
                              if (category === 'Persistent') categoryColor = 'bg-gray-500'
                              else if (category === 'Daily') categoryColor = 'bg-purple-500'
                              else if (category === 'Weekly') categoryColor = 'bg-blue-500'
                              else if (category === 'Monthly') categoryColor = 'bg-green-500'
                              else if (category === 'Quarterly') categoryColor = 'bg-yellow-500'
                              else if (category === 'Semi-Annually') categoryColor = 'bg-orange-500'
                              else categoryColor = 'bg-red-500'

                              return (
                                <div key={category} className="space-y-3">
                                  {/* Category Header */}
                                  <div className="flex items-center space-x-2 mb-4">
                                    <div className={`w-3 h-3 rounded-full ${categoryColor}`}></div>
                                    <h4 className="text-sm font-semibold text-gray-700">{category}</h4>
                                    <span className="text-xs text-gray-500">({workflows.length} workflow{workflows.length !== 1 ? 's' : ''})</span>
                                  </div>

                                  {/* Workflows in this category */}
                                  {workflows.map(workflow => {
                                    return (
                                      <div
                                        key={workflow.id}
                                        className="bg-white border border-gray-200 rounded-lg p-4 hover:border-gray-300 hover:shadow-sm transition-all duration-200 cursor-pointer"
                                        onClick={() => handleSelectWorkflow(workflow)}
                                      >
                                        {/* Workflow Header */}
                                        <div className="flex items-center justify-between mb-3">
                                          <div className="flex items-center space-x-3">
                                            <div
                                              className="w-3 h-3 rounded-full flex-shrink-0"
                                              style={{ backgroundColor: workflow.color }}
                                            />
                                            <div>
                                              <div className="flex items-center space-x-2">
                                                <h5 className="text-sm font-semibold text-gray-900">{workflow.name}</h5>
                                              </div>
                                            </div>
                                          </div>

                                          {/* Activity Stats */}
                                          <div className="flex items-center space-x-4 text-xs text-gray-500">
                                            <div className="flex items-center space-x-1">
                                              <Activity className="w-3 h-3 text-green-500" />
                                              <span>{workflow.active_assets}</span>
                                            </div>
                                            <div className="flex items-center space-x-1">
                                              <Target className="w-3 h-3 text-blue-500" />
                                              <span>{workflow.usage_count}</span>
                                            </div>
                                            <div className="flex items-center space-x-1">
                                              <CheckSquare className="w-3 h-3 text-gray-500" />
                                              <span>{workflow.completed_assets}</span>
                                            </div>
                                          </div>
                                        </div>

                                        {/* Stages Preview */}
                                        {workflow.stages && Array.isArray(workflow.stages) && workflow.stages.length > 0 ? (
                                          <div className="mt-3 pt-3 border-t border-gray-100 flex items-center space-x-2">
                                            <span className="text-xs text-gray-500">Stages:</span>
                                            <div className="flex items-center space-x-1">
                                              {workflow.stages.filter(s => s).map((stage, idx) => (
                                                <div
                                                  key={stage?.id || `stage-${idx}`}
                                                  className="w-2 h-2 rounded-full"
                                                  style={{ backgroundColor: workflow.color || '#94a3b8' }}
                                                  title={stage?.stage_label || `Stage ${idx + 1}`}
                                                />
                                              ))}
                                            </div>
                                          </div>
                                        ) : (
                                          <div className="mt-3 pt-3 border-t border-gray-100">
                                            <span className="text-xs text-gray-400 italic">No stages configured</span>
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })}
                                </div>
                              )
                            })
                          })()}
                        </div>
                      ) : !isLoading ? (
                        <div className="text-center py-12">
                          <BarChart3 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                          <h3 className="text-lg font-medium text-gray-900 mb-2">No workflows available</h3>
                          <p className="text-gray-500 mb-6">Create your first workflow to see the cadence visualization</p>
                          <Button onClick={handleCreateWorkflow}>
                            <Plus className="w-4 h-4 mr-2" />
                            Create Workflow
                          </Button>
                        </div>
                      ) : null}
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
                                <span className="text-sm text-gray-600">Avg. Frequency</span>
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
              ) : null}
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
          onInvite={async (email, permission) => {
            try {
              // Get the current user
              const { data: { user } } = await supabase.auth.getUser()
              if (!user) throw new Error('Not authenticated')

              // Find the user by email
              const { data: invitedUser, error: userError } = await supabase
                .from('users')
                .select('id')
                .eq('email', email.toLowerCase())
                .single()

              if (userError || !invitedUser) {
                alert('User not found. Please make sure the email address is correct.')
                return
              }

              // Create the workflow collaboration
              const { error: inviteError } = await supabase
                .from('workflow_collaborations')
                .insert({
                  workflow_id: selectedWorkflow.id,
                  user_id: invitedUser.id,
                  permission: permission,
                  invited_by: user.id
                })

              if (inviteError) {
                if (inviteError.code === '23505') { // Unique constraint violation
                  alert('This user already has access to this workflow.')
                } else {
                  throw inviteError
                }
                return
              }

              // Refresh the workflow data to show the new team member
              queryClient.invalidateQueries({ queryKey: ['workflows-full'] })
              queryClient.invalidateQueries({ queryKey: ['workflow-team', selectedWorkflow.id] })
              queryClient.invalidateQueries({ queryKey: ['workflow-collaborators', selectedWorkflow.id] })

              setShowInviteModal(false)
              alert(`Successfully invited ${email} with ${permission} access!`)
            } catch (error) {
              console.error('Error inviting user:', error)
              alert('Failed to invite user. Please try again.')
            }
          }}
        />
      )}

      {/* Add Stakeholder Modal */}
      {showAddStakeholderModal && selectedWorkflow && (
        <AddStakeholderModal
          workflowId={selectedWorkflow.id}
          workflowName={selectedWorkflow.name}
          onClose={() => setShowAddStakeholderModal(false)}
          onAdd={async (userId) => {
            try {
              addStakeholderMutation.mutate({
                workflowId: selectedWorkflow.id,
                userId: userId
              })
              setShowAddStakeholderModal(false)
            } catch (error) {
              console.error('Error adding stakeholder:', error)
            }
          }}
        />
      )}

      {/* Create Branch Modal */}
      {showCreateBranchModal && selectedWorkflow && (
        <CreateBranchModal
          workflowId={selectedWorkflow.id}
          workflowName={selectedWorkflow.name}
          existingBranches={workflowBranches || []}
          onClose={() => setShowCreateBranchModal(false)}
          onSubmit={(branchName, branchSuffix, copyProgress, sourceBranchId) => {
            createBranchMutation.mutate({
              workflowId: selectedWorkflow.id,
              branchName,
              branchSuffix,
              copyProgress,
              sourceBranchId
            })
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
            requestAccessMutation.mutate({
              workflowId: selectedWorkflow.id,
              currentPermission: selectedWorkflow.user_permission,
              requestedPermission,
              reason
            })
          }}
        />
      )}

      {/* Add Rule Modal */}
      {showAddRuleModal && selectedWorkflow && (
        <AddRuleModal
          workflowId={selectedWorkflow.id}
          workflowName={selectedWorkflow.name}
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
          workflowName={selectedWorkflow.name}
          workflowStages={selectedWorkflow.stages || []}
          onClose={() => setEditingRule(null)}
          onSave={(updates) => {
            updateRuleMutation.mutate({ ruleId: editingRule, updates })
          }}
        />
      )}

      {/* Delete Rule Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showDeleteRuleModal}
        onClose={() => {
          console.log('🚪 ConfirmDialog onClose called, isPending:', deleteRuleMutation.isPending)
          if (!deleteRuleMutation.isPending) {
            setShowDeleteRuleModal(false)
            setRuleToDelete(null)
          }
        }}
        onConfirm={() => {
          console.log('✔️ ConfirmDialog onConfirm called, ruleToDelete:', ruleToDelete)
          if (ruleToDelete) {
            console.log('🚀 Calling deleteRuleMutation.mutate with:', ruleToDelete.id)
            deleteRuleMutation.mutate(ruleToDelete.id)
          }
        }}
        title="Delete Automation Rule?"
        message={`Are you sure you want to delete "${ruleToDelete?.name}"? This ${ruleToDelete?.type === 'time_based' ? 'time-based automation' : 'activity-based trigger'} will be permanently removed and can't be undone.`}
        confirmText="Delete Rule"
        cancelText="Cancel"
        variant="danger"
        isLoading={deleteRuleMutation.isPending}
      />

      {/* Upload Template Modal */}
      {showUploadTemplateModal && selectedWorkflow && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-xl font-bold text-gray-900">Upload Template</h2>
              <p className="text-sm text-gray-500 mt-1">Add a template file for your team to use</p>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Template Name
                </label>
                <input
                  type="text"
                  placeholder="e.g., Earnings Analysis Template"
                  value={templateFormData.name}
                  onChange={(e) => setTemplateFormData({ ...templateFormData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Description (Optional)
                </label>
                <textarea
                  placeholder="Describe what this template is used for..."
                  rows={3}
                  value={templateFormData.description}
                  onChange={(e) => setTemplateFormData({ ...templateFormData, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Upload File
                </label>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
                  onChange={(e) => setTemplateFormData({ ...templateFormData, file: e.target.files?.[0] || null })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
                <p className="text-xs text-gray-400 mt-2">PDF, Word, Excel, PowerPoint, or Text files</p>
                {templateFormData.file && (
                  <p className="text-xs text-gray-600 mt-2">Selected: {templateFormData.file.name}</p>
                )}
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 flex justify-end space-x-3">
              <Button
                variant="outline"
                onClick={() => {
                  setShowUploadTemplateModal(false)
                  setTemplateFormData({ name: '', description: '', file: null })
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (!templateFormData.name.trim()) {
                    alert('Please enter a template name')
                    return
                  }
                  if (!templateFormData.file) {
                    alert('Please select a file to upload')
                    return
                  }
                  uploadTemplateMutation.mutate({
                    workflowId: selectedWorkflow.id,
                    name: templateFormData.name,
                    description: templateFormData.description,
                    file: templateFormData.file
                  })
                }}
                loading={uploadTemplateMutation.isPending}
              >
                Upload Template
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Archive Workflow Confirmation Modal */}
      {showDeleteConfirmModal && workflowToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <div className="flex items-center mb-4">
                <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mr-4">
                  <Trash2 className="w-6 h-6 text-orange-600" />
                </div>
                <div>
                  <h3 className="text-lg font-medium text-gray-900">Archive Workflow</h3>
                  <p className="text-sm text-gray-500">Data will be preserved</p>
                </div>
              </div>
              <p className="text-gray-700 mb-6">
                Are you sure you want to archive <span className="font-semibold">{workflows?.find(w => w.id === workflowToDelete)?.name}</span>?
                The workflow will be hidden from the UI but all data will be preserved. Assets will remain assigned but won't show as active.
              </p>
              <div className="flex justify-end space-x-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowDeleteConfirmModal(false)
                    setWorkflowToDelete(null)
                  }}
                >
                  Cancel
                </Button>
                <Button
                  className="bg-orange-600 hover:bg-orange-700 text-white"
                  onClick={() => archiveWorkflowMutation.mutate(workflowToDelete)}
                  disabled={archiveWorkflowMutation.isPending}
                >
                  {archiveWorkflowMutation.isPending ? 'Archiving...' : 'Yes, Archive'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Workflow Confirmation Modal */}
      {showPermanentDeleteModal && workflowToPermanentlyDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <div className="flex items-center mb-4">
                <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mr-4">
                  <Trash2 className="w-6 h-6 text-red-600" />
                </div>
                <div>
                  <h3 className="text-lg font-medium text-gray-900">Delete Workflow</h3>
                  <p className="text-sm text-gray-500">Can be restored later</p>
                </div>
              </div>
              <p className="text-gray-700 mb-6">
                Are you sure you want to delete <span className="font-semibold">{selectedWorkflow?.name}</span>?
                The workflow will be removed from the main interface but all data will be preserved. You can restore it later from the Deleted section.
              </p>
              <div className="flex justify-end space-x-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowPermanentDeleteModal(false)
                    setWorkflowToPermanentlyDelete(null)
                  }}
                >
                  Cancel
                </Button>
                <Button
                  className="bg-red-600 hover:bg-red-700 text-white"
                  onClick={() => deleteWorkflowMutation.mutate(workflowToPermanentlyDelete)}
                  disabled={deleteWorkflowMutation.isPending}
                >
                  {deleteWorkflowMutation.isPending ? 'Deleting...' : 'Yes, Delete'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Stage Confirmation Modal */}
      {showDeleteStageModal && stageToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <div className="flex items-center mb-4">
                <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mr-4">
                  <Trash2 className="w-6 h-6 text-red-600" />
                </div>
                <div>
                  <h3 className="text-lg font-medium text-gray-900">Delete Stage</h3>
                  <p className="text-sm text-gray-500">This action cannot be undone</p>
                </div>
              </div>
              <p className="text-gray-700 mb-2">
                Are you sure you want to delete the <span className="font-semibold">"{stageToDelete.label}"</span> stage?
              </p>
              <p className="text-sm text-gray-600 mb-6">
                All checklist items and configuration for this stage will be permanently removed.
              </p>
              <div className="flex justify-end space-x-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowDeleteStageModal(false)
                    setStageToDelete(null)
                  }}
                >
                  Cancel
                </Button>
                <Button
                  className="bg-red-600 hover:bg-red-700 text-white"
                  onClick={() => {
                    deleteStageMutation.mutate({ stageId: stageToDelete.id, stageKey: stageToDelete.key })
                    setShowDeleteStageModal(false)
                    setStageToDelete(null)
                  }}
                  disabled={deleteStageMutation.isPending}
                >
                  {deleteStageMutation.isPending ? 'Deleting...' : 'Yes, Delete Stage'}
                </Button>
              </div>
            </div>
          </div>
        </div>
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

    // Auto-generate stage_key from stage_label
    const stage_key = formData.stage_label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')

    onSave({
      ...formData,
      stage_key
    })
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Add New Stage</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Stage Name</label>
            <input
              type="text"
              value={formData.stage_label}
              onChange={(e) => setFormData({ ...formData, stage_label: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="e.g., Planning & Research"
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

function AddStakeholderModal({ workflowId, workflowName, onClose, onAdd }: {
  workflowId: string
  workflowName: string
  onClose: () => void
  onAdd: (userId: string) => void
}) {
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
    if (selectedUser) {
      onAdd(selectedUser.id)
    }
  }

  const handleUserSelect = (user: {id: string, email: string, name: string}) => {
    setSelectedUser(user)
    setSearchTerm(user.name)
    setShowDropdown(false)
  }

  const handleSearchChange = (value: string) => {
    setSearchTerm(value)
    setSelectedUser(null)
    setShowDropdown(true)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Add Stakeholder</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mb-4">
          <p className="text-sm text-gray-600 mb-2">
            Add a stakeholder who will be using "{workflowName}"
          </p>
          <p className="text-xs text-gray-500">
            Stakeholders can view the workflow but won't have permission to edit it.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Search User
              </label>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => handleSearchChange(e.target.value)}
                onFocus={() => setShowDropdown(true)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Search by name or email..."
                required
              />

              {/* Searchable dropdown */}
              {showDropdown && filteredUsers.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                  {filteredUsers.slice(0, 10).map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      onClick={() => handleUserSelect(user)}
                      className="w-full text-left px-3 py-2 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
                    >
                      <div className="font-medium text-sm text-gray-900">{user.name}</div>
                      <div className="text-xs text-gray-500">{user.email}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedUser && (
              <div className="p-3 bg-green-50 border border-green-200 rounded-md">
                <div className="flex items-center space-x-2">
                  <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                    <span className="text-white font-semibold text-xs">
                      {selectedUser.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <div className="font-medium text-sm text-gray-900">{selectedUser.name}</div>
                    <div className="text-xs text-gray-500">{selectedUser.email}</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end space-x-3 mt-6">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!selectedUser}>
              Add Stakeholder
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
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [reminderSent, setReminderSent] = useState(false)

  // Check for existing pending request
  const { data: pendingRequest, isLoading: loadingPendingRequest } = useQuery({
    queryKey: ['pending-access-request', workflowId],
    queryFn: async () => {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id
      if (!userId) return null

      const { data, error } = await supabase
        .from('workflow_access_requests')
        .select('*')
        .eq('workflow_id', workflowId)
        .eq('user_id', userId)
        .eq('status', 'pending')
        .maybeSingle()

      if (error) throw error
      return data
    }
  })

  // Send reminder mutation
  const sendReminderMutation = useMutation({
    mutationFn: async () => {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id
      if (!userId || !pendingRequest) throw new Error('Missing data')

      // Get workflow name and requester name
      const { data: workflow } = await supabase
        .from('workflows')
        .select('name, created_by')
        .eq('id', workflowId)
        .single()

      const { data: requesterData } = await supabase
        .from('users')
        .select('first_name, last_name, email')
        .eq('id', userId)
        .single()

      const requesterName = requesterData
        ? `${requesterData.first_name || ''} ${requesterData.last_name || ''}`.trim() || requesterData.email
        : 'A user'

      // Notify workflow owner
      await supabase.from('notifications').insert({
        user_id: workflow?.created_by,
        type: 'workflow_access_request',
        title: 'Access Request Reminder',
        message: `${requesterName} sent a reminder about their ${pendingRequest.requested_permission} access request for "${workflowName}"`,
        context_type: 'workflow',
        context_id: workflowId,
        context_data: {
          workflow_id: workflowId,
          workflow_name: workflowName,
          user_id: userId,
          requester_name: requesterName,
          requested_permission: pendingRequest.requested_permission,
          reason: pendingRequest.reason,
          request_id: pendingRequest.id,
          is_reminder: true
        },
        is_read: false
      })

      // Notify all workflow admins
      const { data: admins } = await supabase
        .from('workflow_collaborations')
        .select('user_id')
        .eq('workflow_id', workflowId)
        .eq('permission', 'admin')
        .neq('user_id', userId)

      if (admins && admins.length > 0) {
        await supabase.from('notifications').insert(
          admins.map(admin => ({
            user_id: admin.user_id,
            type: 'workflow_access_request',
            title: 'Access Request Reminder',
            message: `${requesterName} sent a reminder about their ${pendingRequest.requested_permission} access request for "${workflowName}"`,
            context_type: 'workflow',
            context_id: workflowId,
            context_data: {
              workflow_id: workflowId,
              workflow_name: workflowName,
              user_id: userId,
              requester_name: requesterName,
              requested_permission: pendingRequest.requested_permission,
              reason: pendingRequest.reason,
              request_id: pendingRequest.id,
              is_reminder: true
            },
            is_read: false
          }))
        )
      }
    },
    onSuccess: () => {
      setReminderSent(true)
    },
    onError: (error) => {
      console.error('Error sending reminder:', error)
      alert('Failed to send reminder. Please try again.')
    }
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (reason.trim()) {
      onRequest(requestedPermission, reason.trim())
      setIsSubmitted(true)
    }
  }

  const handleClose = () => {
    setIsSubmitted(false)
    setReminderSent(false)
    setReason('')
    setRequestedPermission('write')
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Request Access</h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {loadingPendingRequest ? (
          <div className="py-8 text-center">
            <div className="text-gray-500">Loading...</div>
          </div>
        ) : pendingRequest ? (
          <div className="py-4">
            <div className="flex items-start space-x-3 mb-4">
              <div className="flex-shrink-0">
                <div className="w-12 h-12 rounded-full bg-yellow-100 flex items-center justify-center">
                  <Clock className="w-6 h-6 text-yellow-600" />
                </div>
              </div>
              <div className="flex-1">
                <h3 className="text-base font-medium text-gray-900 mb-1">
                  Access request pending
                </h3>
                <p className="text-sm text-gray-600">
                  You have already requested {pendingRequest.requested_permission} access to this workflow.
                </p>
              </div>
            </div>

            <div className="bg-gray-50 rounded-lg p-4 mb-4">
              <div className="space-y-2">
                <div>
                  <span className="text-xs font-medium text-gray-500">Requested Permission:</span>
                  <p className="text-sm text-gray-900 capitalize">{pendingRequest.requested_permission}</p>
                </div>
                <div>
                  <span className="text-xs font-medium text-gray-500">Your Reason:</span>
                  <p className="text-sm text-gray-900">{pendingRequest.reason}</p>
                </div>
                <div>
                  <span className="text-xs font-medium text-gray-500">Requested:</span>
                  <p className="text-sm text-gray-900">
                    {new Date(pendingRequest.created_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit'
                    })}
                  </p>
                </div>
              </div>
            </div>

            {reminderSent ? (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                <div className="flex items-center space-x-2">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  <p className="text-sm text-green-800 font-medium">
                    Reminder sent to workflow admins!
                  </p>
                </div>
              </div>
            ) : (
              <div className="mb-4">
                <p className="text-xs text-gray-500 mb-3">
                  Your request is waiting for admin approval. You can send a reminder to notify them again.
                </p>
                <Button
                  onClick={() => sendReminderMutation.mutate()}
                  disabled={sendReminderMutation.isPending}
                  variant="outline"
                  className="w-full"
                >
                  <Bell className="w-4 h-4 mr-2" />
                  {sendReminderMutation.isPending ? 'Sending...' : 'Send Reminder to Admins'}
                </Button>
              </div>
            )}

            <Button onClick={handleClose} variant="outline" className="w-full">
              Close
            </Button>
          </div>
        ) : isSubmitted ? (
          <div className="py-6">
            <div className="flex items-center justify-center mb-4">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle className="w-10 h-10 text-green-600" />
              </div>
            </div>
            <div className="text-center">
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Access request sent successfully!
              </h3>
              <p className="text-sm text-gray-600 mb-6">
                Workflow admins will be notified and will review your request.
              </p>
              <Button onClick={handleClose} className="w-full">
                Close
              </Button>
            </div>
          </div>
        ) : (
          <>
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
                <Button type="button" variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
                <Button type="submit">
                  Send Request
                </Button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

// Natural language parser for time-based triggers
function parseNaturalLanguage(input: string) {
  const text = input.toLowerCase().trim()

  if (!text) {
    return { parsed_successfully: false, interpretation: '' }
  }

  // Pattern matching
  const patterns = {
    // "every other friday/monday/etc"
    everyOtherDayOfWeek: /every\s+other\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
    // "every friday/monday/etc"
    everyDayOfWeek: /every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
    // "every other week/month/quarter/year"
    everyOther: /every\s+other\s+(week|month|quarter|year)/i,
    // Every X days/weeks/months/quarters/years
    everyInterval: /every\s+(\d+)\s+(day|week|month|quarter|year)s?/i,
    // Just "every day/week/month/quarter/year"
    everyPeriod: /every\s+(day|week|month|quarter|year)/i,
    // "15th of month/quarter", "1st of month"
    ordinalOfPeriod: /(\d+)(?:st|nd|rd|th)?\s+(?:of\s+)?(?:each\s+|every\s+)?(month|quarter|year)/i,
    // "first/last/second day of month/quarter/year"
    positionOfPeriod: /(first|last|second|third)\s+(?:day\s+)?(?:of\s+)?(?:each\s+|every\s+)?(month|quarter|year)/i,
  }

  // Try to match "every other friday"
  let match = text.match(patterns.everyOtherDayOfWeek)
  if (match) {
    const dayOfWeek = match[1]
    const capitalizedDay = dayOfWeek.charAt(0).toUpperCase() + dayOfWeek.slice(1)
    return {
      parsed_successfully: true,
      interpretation: `Triggers every other ${capitalizedDay} (every 2 weeks on ${capitalizedDay})`,
      schedule_type: 'day_of_week',
      interval_count: 2,
      period: 'week',
      day_of_week: dayOfWeek
    }
  }

  // Try to match "every friday"
  match = text.match(patterns.everyDayOfWeek)
  if (match) {
    const dayOfWeek = match[1]
    const capitalizedDay = dayOfWeek.charAt(0).toUpperCase() + dayOfWeek.slice(1)
    return {
      parsed_successfully: true,
      interpretation: `Triggers every ${capitalizedDay}`,
      schedule_type: 'day_of_week',
      interval_count: 1,
      period: 'week',
      day_of_week: dayOfWeek
    }
  }

  // Try to match "every other week/month/etc"
  match = text.match(patterns.everyOther)
  if (match) {
    const period = match[1]
    return {
      parsed_successfully: true,
      interpretation: `Triggers every other ${period} (every 2 ${period}s)`,
      schedule_type: 'interval',
      interval_count: 2,
      period: period
    }
  }

  // Try to match "every X days/weeks/etc"
  match = text.match(patterns.everyInterval)
  if (match) {
    const count = parseInt(match[1])
    const period = match[2]
    return {
      parsed_successfully: true,
      interpretation: `Triggers every ${count} ${period}${count > 1 ? 's' : ''}`,
      schedule_type: 'interval',
      interval_count: count,
      period: period
    }
  }

  // Try to match "every day/week/month"
  match = text.match(patterns.everyPeriod)
  if (match) {
    const period = match[1]
    return {
      parsed_successfully: true,
      interpretation: `Triggers every ${period}`,
      schedule_type: 'interval',
      interval_count: 1,
      period: period
    }
  }

  // Try to match "15th of month", "1st of quarter"
  match = text.match(patterns.ordinalOfPeriod)
  if (match) {
    const day = parseInt(match[1])
    const period = match[2]
    const ordinal = day === 1 ? '1st' : day === 2 ? '2nd' : day === 3 ? '3rd' : `${day}th`
    return {
      parsed_successfully: true,
      interpretation: `Triggers on the ${ordinal} day of every ${period}`,
      schedule_type: 'specific_day',
      day_number: day,
      period: period
    }
  }

  // Try to match "first/last day of month"
  match = text.match(patterns.positionOfPeriod)
  if (match) {
    const position = match[1]
    const period = match[2]
    return {
      parsed_successfully: true,
      interpretation: `Triggers on the ${position} day of every ${period}`,
      schedule_type: 'position',
      position: position,
      period: period
    }
  }

  // Best guess attempt
  return {
    parsed_successfully: false,
    interpretation: `Try: "every friday", "every other monday", "every X days", "15th of month", "first day of quarter"`,
    schedule_type: 'unknown'
  }
}

function AddRuleModal({ workflowId, workflowName, workflowStages, onClose, onSave }: {
  workflowId: string
  workflowName: string
  workflowStages: WorkflowStage[]
  onClose: () => void
  onSave: (ruleData: any) => void
}) {
  const [formData, setFormData] = useState({
    name: '',
    type: 'time',
    conditionType: 'time_interval',
    conditionValue: {},
    actionType: 'branch_copy',
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
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 overflow-y-auto flex-1">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Add Automation Rule</h2>
            <p className="text-sm text-gray-500 mt-1">Configure when and how this workflow should be automated</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
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
              placeholder="e.g., Weekly Review Reset"
              required
            />
          </div>

          {/* Rule Type Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Trigger Type
            </label>
            <div className="grid grid-cols-2 gap-3">
              {[
                { value: 'time', label: 'Time', icon: Clock, desc: 'Trigger based on time intervals' },
                { value: 'event', label: 'Event', icon: Zap, desc: 'Trigger on market events' },
                { value: 'activity', label: 'Activity', icon: Activity, desc: 'Trigger on user actions' },
                { value: 'perpetual', label: 'Perpetual', icon: Target, desc: 'Always available' }
              ].map((option) => {
                const Icon = option.icon
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      const conditionMap = {
                        'time': 'time_interval',
                        'event': 'earnings_date',
                        'activity': 'stage_completion',
                        'perpetual': 'always_available'
                      }
                      setFormData({
                        ...formData,
                        type: option.value,
                        conditionType: conditionMap[option.value as keyof typeof conditionMap],
                        conditionValue: {}
                      })
                    }}
                    className={`p-4 border-2 rounded-lg transition-all text-left ${
                      formData.type === option.value
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start space-x-3">
                      <Icon className={`w-5 h-5 mt-0.5 ${formData.type === option.value ? 'text-blue-600' : 'text-gray-400'}`} />
                      <div>
                        <div className={`font-medium ${formData.type === option.value ? 'text-blue-900' : 'text-gray-900'}`}>
                          {option.label}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">{option.desc}</div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Trigger Configuration */}
          <div className="bg-gray-50 rounded-lg p-4 space-y-4">
            <h4 className="text-sm font-medium text-gray-900">Trigger Configuration</h4>

            {formData.type === 'time' && (
              <div className="space-y-4">
                {/* Recurrence Pattern */}
                <div className="bg-white border-2 border-gray-200 rounded-lg p-4">
                  <h5 className="text-sm font-semibold text-gray-900 mb-3">Recurrence Pattern</h5>

                  {/* Pattern Type Selection - Two Column Layout */}
                  <div className="flex space-x-8">
                    {/* Left Column - Radio Buttons */}
                    <div className="flex flex-col space-y-3 min-w-[100px]">
                      {/* Daily */}
                      <div className="flex items-center space-x-2">
                        <input
                          type="radio"
                          id="pattern-daily"
                          checked={formData.conditionValue.pattern_type === 'daily'}
                          onChange={() => setFormData({
                            ...formData,
                            conditionValue: {
                              pattern_type: 'daily',
                              daily_type: 'every_x_days',
                              interval: 1
                            }
                          })}
                        />
                        <label htmlFor="pattern-daily" className="font-medium text-gray-900 cursor-pointer">Daily</label>
                      </div>

                      {/* Weekly */}
                      <div className="flex items-center space-x-2">
                        <input
                          type="radio"
                          id="pattern-weekly"
                          checked={formData.conditionValue.pattern_type === 'weekly'}
                          onChange={() => setFormData({
                            ...formData,
                            conditionValue: {
                              pattern_type: 'weekly',
                              interval: 1,
                              days_of_week: ['monday']
                            }
                          })}
                        />
                        <label htmlFor="pattern-weekly" className="font-medium text-gray-900 cursor-pointer">Weekly</label>
                      </div>

                      {/* Monthly */}
                      <div className="flex items-center space-x-2">
                        <input
                          type="radio"
                          id="pattern-monthly"
                          checked={formData.conditionValue.pattern_type === 'monthly'}
                          onChange={() => setFormData({
                            ...formData,
                            conditionValue: {
                              pattern_type: 'monthly',
                              monthly_type: 'day_of_month',
                              day_number: 1,
                              interval: 1
                            }
                          })}
                        />
                        <label htmlFor="pattern-monthly" className="font-medium text-gray-900 cursor-pointer">Monthly</label>
                      </div>

                      {/* Quarterly */}
                      <div className="flex items-center space-x-2">
                        <input
                          type="radio"
                          id="pattern-quarterly"
                          checked={formData.conditionValue.pattern_type === 'quarterly'}
                          onChange={() => setFormData({
                            ...formData,
                            conditionValue: {
                              pattern_type: 'quarterly',
                              quarterly_type: 'day_of_quarter',
                              day_number: 1,
                              interval: 1
                            }
                          })}
                        />
                        <label htmlFor="pattern-quarterly" className="font-medium text-gray-900 cursor-pointer">Quarterly</label>
                      </div>

                      {/* Yearly */}
                      <div className="flex items-center space-x-2">
                        <input
                          type="radio"
                          id="pattern-yearly"
                          checked={formData.conditionValue.pattern_type === 'yearly'}
                          onChange={() => setFormData({
                            ...formData,
                            conditionValue: {
                              pattern_type: 'yearly',
                              yearly_type: 'specific_date',
                              month: 'january',
                              day_number: 1
                            }
                          })}
                        />
                        <label htmlFor="pattern-yearly" className="font-medium text-gray-900 cursor-pointer">Yearly</label>
                      </div>
                    </div>

                    {/* Right Column - Configuration Options */}
                    <div className="flex-1 border-l border-gray-200 pl-6">
                      {/* Daily Options */}
                      {formData.conditionValue.pattern_type === 'daily' && (
                        <div className="flex flex-col space-y-2">
                          <div className="flex items-center space-x-2">
                            <input
                              type="radio"
                              id="daily-every-x"
                              checked={formData.conditionValue.daily_type === 'every_x_days'}
                              onChange={() => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, daily_type: 'every_x_days', interval: 1 }
                              })}
                            />
                            <label htmlFor="daily-every-x" className="text-sm text-gray-700">Every</label>
                            <input
                              type="number"
                              min="1"
                              value={formData.conditionValue.interval || 1}
                              onChange={(e) => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, interval: parseInt(e.target.value) || 1 }
                              })}
                              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                              disabled={formData.conditionValue.daily_type !== 'every_x_days'}
                            />
                            <label className="text-sm text-gray-700">day(s)</label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <input
                              type="radio"
                              id="daily-weekday"
                              checked={formData.conditionValue.daily_type === 'every_weekday'}
                              onChange={() => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, daily_type: 'every_weekday' }
                              })}
                            />
                            <label htmlFor="daily-weekday" className="text-sm text-gray-700">Every weekday</label>
                          </div>
                        </div>
                      )}

                      {/* Weekly Options */}
                      {formData.conditionValue.pattern_type === 'weekly' && (
                        <div className="flex flex-col space-y-2">
                          <div className="flex items-center space-x-2">
                            <span className="text-sm text-gray-700">Recur every</span>
                            <input
                              type="number"
                              min="1"
                              value={formData.conditionValue.interval || 1}
                              onChange={(e) => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, interval: parseInt(e.target.value) || 1 }
                              })}
                              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                            />
                            <span className="text-sm text-gray-700">week(s) on:</span>
                          </div>
                          <div className="grid grid-cols-4 gap-2">
                            {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day) => (
                              <label key={day} className="flex items-center space-x-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={(formData.conditionValue.days_of_week || []).includes(day.toLowerCase())}
                                  onChange={(e) => {
                                    const days = formData.conditionValue.days_of_week || []
                                    const newDays = e.target.checked
                                      ? [...days, day.toLowerCase()]
                                      : days.filter(d => d !== day.toLowerCase())
                                    setFormData({
                                      ...formData,
                                      conditionValue: { ...formData.conditionValue, days_of_week: newDays }
                                    })
                                  }}
                                />
                                <span>{day.slice(0, 3)}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Monthly Options */}
                      {formData.conditionValue.pattern_type === 'monthly' && (
                        <div className="flex flex-col space-y-2">
                          <div className="flex items-center space-x-2">
                            <input
                              type="radio"
                              id="monthly-day"
                              checked={formData.conditionValue.monthly_type === 'day_of_month'}
                              onChange={() => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, monthly_type: 'day_of_month', day_number: 1 }
                              })}
                            />
                            <label htmlFor="monthly-day" className="text-sm text-gray-700">Day</label>
                            <input
                              type="number"
                              min="1"
                              max="31"
                              value={formData.conditionValue.day_number || 1}
                              onChange={(e) => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, day_number: parseInt(e.target.value) || 1 }
                              })}
                              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                              disabled={formData.conditionValue.monthly_type !== 'day_of_month'}
                            />
                            <span className="text-sm text-gray-700">of every</span>
                            <input
                              type="number"
                              min="1"
                              value={formData.conditionValue.interval || 1}
                              onChange={(e) => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, interval: parseInt(e.target.value) || 1 }
                              })}
                              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                              disabled={formData.conditionValue.monthly_type !== 'day_of_month'}
                            />
                            <span className="text-sm text-gray-700">month(s)</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <input
                              type="radio"
                              id="monthly-position"
                              checked={formData.conditionValue.monthly_type === 'position_of_month'}
                              onChange={() => setFormData({
                                ...formData,
                                conditionValue: {
                                  ...formData.conditionValue,
                                  monthly_type: 'position_of_month',
                                  position: 'first',
                                  day_name: 'monday'
                                }
                              })}
                            />
                            <label htmlFor="monthly-position" className="text-sm text-gray-700">The</label>
                            <select
                              value={formData.conditionValue.position || 'first'}
                              onChange={(e) => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, position: e.target.value }
                              })}
                              className="px-2 py-1 border border-gray-300 rounded text-sm"
                              disabled={formData.conditionValue.monthly_type !== 'position_of_month'}
                            >
                              <option value="first">First</option>
                              <option value="second">Second</option>
                              <option value="third">Third</option>
                              <option value="fourth">Fourth</option>
                              <option value="last">Last</option>
                            </select>
                            <select
                              value={formData.conditionValue.day_name || 'monday'}
                              onChange={(e) => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, day_name: e.target.value }
                              })}
                              className="px-2 py-1 border border-gray-300 rounded text-sm"
                              disabled={formData.conditionValue.monthly_type !== 'position_of_month'}
                            >
                              <option value="day">Day</option>
                              <option value="weekday">Weekday</option>
                              <option value="weekend_day">Weekend day</option>
                              <option value="monday">Monday</option>
                              <option value="tuesday">Tuesday</option>
                              <option value="wednesday">Wednesday</option>
                              <option value="thursday">Thursday</option>
                              <option value="friday">Friday</option>
                              <option value="saturday">Saturday</option>
                              <option value="sunday">Sunday</option>
                            </select>
                            <span className="text-sm text-gray-700">of every</span>
                            <input
                              type="number"
                              min="1"
                              value={formData.conditionValue.interval || 1}
                              onChange={(e) => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, interval: parseInt(e.target.value) || 1 }
                              })}
                              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                              disabled={formData.conditionValue.monthly_type !== 'position_of_month'}
                            />
                            <span className="text-sm text-gray-700">month(s)</span>
                          </div>
                        </div>
                      )}

                      {/* Quarterly Options */}
                      {formData.conditionValue.pattern_type === 'quarterly' && (
                        <div className="flex flex-col space-y-2">
                          <div className="flex items-center space-x-2">
                            <input
                              type="radio"
                              id="quarterly-day"
                              checked={formData.conditionValue.quarterly_type === 'day_of_quarter'}
                              onChange={() => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, quarterly_type: 'day_of_quarter', day_number: 1 }
                              })}
                            />
                            <label htmlFor="quarterly-day" className="text-sm text-gray-700">Day</label>
                            <input
                              type="number"
                              min="1"
                              max="92"
                              value={formData.conditionValue.day_number || 1}
                              onChange={(e) => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, day_number: parseInt(e.target.value) || 1 }
                              })}
                              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                              disabled={formData.conditionValue.quarterly_type !== 'day_of_quarter'}
                            />
                            <span className="text-sm text-gray-700">of every</span>
                            <input
                              type="number"
                              min="1"
                              value={formData.conditionValue.interval || 1}
                              onChange={(e) => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, interval: parseInt(e.target.value) || 1 }
                              })}
                              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                              disabled={formData.conditionValue.quarterly_type !== 'day_of_quarter'}
                            />
                            <span className="text-sm text-gray-700">quarter(s)</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <input
                              type="radio"
                              id="quarterly-position"
                              checked={formData.conditionValue.quarterly_type === 'position_of_quarter'}
                              onChange={() => setFormData({
                                ...formData,
                                conditionValue: {
                                  ...formData.conditionValue,
                                  quarterly_type: 'position_of_quarter',
                                  position: 'first',
                                  day_name: 'monday'
                                }
                              })}
                            />
                            <label htmlFor="quarterly-position" className="text-sm text-gray-700">The</label>
                            <select
                              value={formData.conditionValue.position || 'first'}
                              onChange={(e) => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, position: e.target.value }
                              })}
                              className="px-2 py-1 border border-gray-300 rounded text-sm"
                              disabled={formData.conditionValue.quarterly_type !== 'position_of_quarter'}
                            >
                              <option value="first">First</option>
                              <option value="second">Second</option>
                              <option value="third">Third</option>
                              <option value="fourth">Fourth</option>
                              <option value="last">Last</option>
                            </select>
                            <select
                              value={formData.conditionValue.day_name || 'monday'}
                              onChange={(e) => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, day_name: e.target.value }
                              })}
                              className="px-2 py-1 border border-gray-300 rounded text-sm"
                              disabled={formData.conditionValue.quarterly_type !== 'position_of_quarter'}
                            >
                              <option value="day">Day</option>
                              <option value="weekday">Weekday</option>
                              <option value="weekend_day">Weekend day</option>
                              <option value="monday">Monday</option>
                              <option value="tuesday">Tuesday</option>
                              <option value="wednesday">Wednesday</option>
                              <option value="thursday">Thursday</option>
                              <option value="friday">Friday</option>
                              <option value="saturday">Saturday</option>
                              <option value="sunday">Sunday</option>
                            </select>
                            <span className="text-sm text-gray-700">of every</span>
                            <input
                              type="number"
                              min="1"
                              value={formData.conditionValue.interval || 1}
                              onChange={(e) => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, interval: parseInt(e.target.value) || 1 }
                              })}
                              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                              disabled={formData.conditionValue.quarterly_type !== 'position_of_quarter'}
                            />
                            <span className="text-sm text-gray-700">quarter(s)</span>
                          </div>
                        </div>
                      )}

                      {/* Yearly Options */}
                      {formData.conditionValue.pattern_type === 'yearly' && (
                        <div className="flex flex-col space-y-2">
                          <div className="flex items-center space-x-2">
                            <input
                              type="radio"
                              id="yearly-date"
                              checked={formData.conditionValue.yearly_type === 'specific_date'}
                              onChange={() => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, yearly_type: 'specific_date' }
                              })}
                            />
                            <label htmlFor="yearly-date" className="text-sm text-gray-700">On</label>
                            <select
                              value={formData.conditionValue.month || 'january'}
                              onChange={(e) => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, month: e.target.value }
                              })}
                              className="px-2 py-1 border border-gray-300 rounded text-sm"
                              disabled={formData.conditionValue.yearly_type !== 'specific_date'}
                            >
                              {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map(m => (
                                <option key={m} value={m.toLowerCase()}>{m}</option>
                              ))}
                            </select>
                            <input
                              type="number"
                              min="1"
                              max="31"
                              value={formData.conditionValue.day_number || 1}
                              onChange={(e) => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, day_number: parseInt(e.target.value) || 1 }
                              })}
                              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                              disabled={formData.conditionValue.yearly_type !== 'specific_date'}
                            />
                          </div>
                          <div className="flex items-center space-x-2">
                            <input
                              type="radio"
                              id="yearly-position"
                              checked={formData.conditionValue.yearly_type === 'position_of_year'}
                              onChange={() => setFormData({
                                ...formData,
                                conditionValue: {
                                  ...formData.conditionValue,
                                  yearly_type: 'position_of_year',
                                  position: 'first',
                                  day_name: 'monday',
                                  month: 'january'
                                }
                              })}
                            />
                            <label htmlFor="yearly-position" className="text-sm text-gray-700">The</label>
                            <select
                              value={formData.conditionValue.position || 'first'}
                              onChange={(e) => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, position: e.target.value }
                              })}
                              className="px-2 py-1 border border-gray-300 rounded text-sm"
                              disabled={formData.conditionValue.yearly_type !== 'position_of_year'}
                            >
                              <option value="first">First</option>
                              <option value="second">Second</option>
                              <option value="third">Third</option>
                              <option value="fourth">Fourth</option>
                              <option value="last">Last</option>
                            </select>
                            <select
                              value={formData.conditionValue.day_name || 'monday'}
                              onChange={(e) => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, day_name: e.target.value }
                              })}
                              className="px-2 py-1 border border-gray-300 rounded text-sm"
                              disabled={formData.conditionValue.yearly_type !== 'position_of_year'}
                            >
                              <option value="day">Day</option>
                              <option value="weekday">Weekday</option>
                              <option value="weekend_day">Weekend day</option>
                              <option value="monday">Monday</option>
                              <option value="tuesday">Tuesday</option>
                              <option value="wednesday">Wednesday</option>
                              <option value="thursday">Thursday</option>
                              <option value="friday">Friday</option>
                              <option value="saturday">Saturday</option>
                              <option value="sunday">Sunday</option>
                            </select>
                            <span className="text-sm text-gray-700">of</span>
                            <select
                              value={formData.conditionValue.month || 'january'}
                              onChange={(e) => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, month: e.target.value }
                              })}
                              className="px-2 py-1 border border-gray-300 rounded text-sm"
                              disabled={formData.conditionValue.yearly_type !== 'position_of_year'}
                            >
                              {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map(m => (
                                <option key={m} value={m.toLowerCase()}>{m}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Range of Recurrence */}
                <div className="bg-white border-2 border-gray-200 rounded-lg p-4">
                  <h5 className="text-sm font-semibold text-gray-900 mb-3">Range of Recurrence</h5>

                  <div className="space-y-3">
                    {/* Start Date */}
                    <div className="flex items-center space-x-2">
                      <label className="text-sm font-medium text-gray-700 w-20">Start:</label>
                      <input
                        type="date"
                        value={formData.conditionValue.start_date || ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          conditionValue: { ...formData.conditionValue, start_date: e.target.value }
                        })}
                        className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    {/* End Options */}
                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <input
                          type="radio"
                          id="end-no-end"
                          checked={formData.conditionValue.end_type === 'no_end' || !formData.conditionValue.end_type}
                          onChange={() => setFormData({
                            ...formData,
                            conditionValue: { ...formData.conditionValue, end_type: 'no_end' }
                          })}
                        />
                        <label htmlFor="end-no-end" className="text-sm text-gray-700">No end date</label>
                      </div>

                      <div className="flex items-center space-x-2">
                        <input
                          type="radio"
                          id="end-after"
                          checked={formData.conditionValue.end_type === 'after_occurrences'}
                          onChange={() => setFormData({
                            ...formData,
                            conditionValue: { ...formData.conditionValue, end_type: 'after_occurrences', occurrences: 10 }
                          })}
                        />
                        <label htmlFor="end-after" className="text-sm text-gray-700">End after</label>
                        <input
                          type="number"
                          min="1"
                          value={formData.conditionValue.occurrences || 10}
                          onChange={(e) => setFormData({
                            ...formData,
                            conditionValue: { ...formData.conditionValue, occurrences: parseInt(e.target.value) || 1 }
                          })}
                          className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                          disabled={formData.conditionValue.end_type !== 'after_occurrences'}
                        />
                        <span className="text-sm text-gray-700">occurrences</span>
                      </div>

                      <div className="flex items-center space-x-2">
                        <input
                          type="radio"
                          id="end-by-date"
                          checked={formData.conditionValue.end_type === 'end_by_date'}
                          onChange={() => setFormData({
                            ...formData,
                            conditionValue: { ...formData.conditionValue, end_type: 'end_by_date' }
                          })}
                        />
                        <label htmlFor="end-by-date" className="text-sm text-gray-700">End by</label>
                        <input
                          type="date"
                          value={formData.conditionValue.end_date || ''}
                          onChange={(e) => setFormData({
                            ...formData,
                            conditionValue: { ...formData.conditionValue, end_date: e.target.value }
                          })}
                          className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          disabled={formData.conditionValue.end_type !== 'end_by_date'}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {formData.type === 'event' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Event Type</label>
                  <select
                    value={formData.conditionType}
                    onChange={(e) => setFormData({ ...formData, conditionType: e.target.value, conditionValue: {} })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
                  >
                    <optgroup label="Corporate Events">
                      <option value="earnings_date">Earnings Date</option>
                      <option value="dividend_date">Dividend Date</option>
                      <option value="conference">Conference</option>
                      <option value="investor_relations_call">Investor Relations Call</option>
                      <option value="analyst_call">Sell-Side Analyst Call</option>
                      <option value="roadshow">Roadshow</option>
                    </optgroup>
                    <optgroup label="Market Activity">
                      <option value="price_change">Price Change</option>
                      <option value="volume_spike">Volume Spike</option>
                    </optgroup>
                  </select>
                </div>

                {formData.conditionType === 'earnings_date' && (
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      min="0"
                      value={formData.conditionValue.days_offset || ''}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, days_offset: parseInt(e.target.value) }
                      })}
                      className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="3"
                    />
                    <span className="text-sm text-gray-600">days</span>
                    <select
                      value={formData.conditionValue.timing || 'before'}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, timing: e.target.value }
                      })}
                      className="px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
                    >
                      <option value="before">before</option>
                      <option value="after">after</option>
                    </select>
                    <span className="text-sm text-gray-600">earnings</span>
                  </div>
                )}

                {formData.conditionType === 'price_change' && (
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-600">When price changes by</span>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={formData.conditionValue.percentage || ''}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, percentage: parseFloat(e.target.value) }
                      })}
                      className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="5"
                    />
                    <span className="text-sm text-gray-600">%</span>
                    <select
                      value={formData.conditionValue.direction || 'either'}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, direction: e.target.value }
                      })}
                      className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="up">up</option>
                      <option value="down">down</option>
                      <option value="either">either direction</option>
                    </select>
                  </div>
                )}

                {formData.conditionType === 'volume_spike' && (
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-600">When volume is</span>
                    <input
                      type="number"
                      min="1"
                      step="0.1"
                      value={formData.conditionValue.multiplier || ''}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, multiplier: parseFloat(e.target.value) }
                      })}
                      className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="2"
                    />
                    <span className="text-sm text-gray-600">× average volume</span>
                  </div>
                )}

                {formData.conditionType === 'dividend_date' && (
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      min="0"
                      value={formData.conditionValue.days_offset || ''}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, days_offset: parseInt(e.target.value) }
                      })}
                      className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="3"
                    />
                    <span className="text-sm text-gray-600">days</span>
                    <select
                      value={formData.conditionValue.timing || 'before'}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, timing: e.target.value }
                      })}
                      className="px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
                    >
                      <option value="before">before</option>
                      <option value="after">after</option>
                    </select>
                    <span className="text-sm text-gray-600">dividend date</span>
                  </div>
                )}

                {formData.conditionType === 'conference' && (
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      min="0"
                      value={formData.conditionValue.days_offset || ''}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, days_offset: parseInt(e.target.value) }
                      })}
                      className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="3"
                    />
                    <span className="text-sm text-gray-600">days</span>
                    <select
                      value={formData.conditionValue.timing || 'before'}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, timing: e.target.value }
                      })}
                      className="px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
                    >
                      <option value="before">before</option>
                      <option value="after">after</option>
                    </select>
                    <span className="text-sm text-gray-600">conference</span>
                  </div>
                )}

                {formData.conditionType === 'investor_relations_call' && (
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      min="0"
                      value={formData.conditionValue.days_offset || ''}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, days_offset: parseInt(e.target.value) }
                      })}
                      className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="3"
                    />
                    <span className="text-sm text-gray-600">days</span>
                    <select
                      value={formData.conditionValue.timing || 'before'}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, timing: e.target.value }
                      })}
                      className="px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
                    >
                      <option value="before">before</option>
                      <option value="after">after</option>
                    </select>
                    <span className="text-sm text-gray-600">investor relations call</span>
                  </div>
                )}

                {formData.conditionType === 'analyst_call' && (
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      min="0"
                      value={formData.conditionValue.days_offset || ''}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, days_offset: parseInt(e.target.value) }
                      })}
                      className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="3"
                    />
                    <span className="text-sm text-gray-600">days</span>
                    <select
                      value={formData.conditionValue.timing || 'before'}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, timing: e.target.value }
                      })}
                      className="px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
                    >
                      <option value="before">before</option>
                      <option value="after">after</option>
                    </select>
                    <span className="text-sm text-gray-600">sell-side analyst call</span>
                  </div>
                )}

                {formData.conditionType === 'roadshow' && (
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      min="0"
                      value={formData.conditionValue.days_offset || ''}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, days_offset: parseInt(e.target.value) }
                      })}
                      className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="3"
                    />
                    <span className="text-sm text-gray-600">days</span>
                    <select
                      value={formData.conditionValue.timing || 'before'}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, timing: e.target.value }
                      })}
                      className="px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
                    >
                      <option value="before">before</option>
                      <option value="after">after</option>
                    </select>
                    <span className="text-sm text-gray-600">roadshow</span>
                  </div>
                )}
              </div>
            )}

            {formData.type === 'activity' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Activity Type</label>
                  <select
                    value={formData.conditionType}
                    onChange={(e) => setFormData({ ...formData, conditionType: e.target.value, conditionValue: {} })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
                  >
                    <option value="stage_completion">Stage Completion</option>
                    <option value="note_added">Note Added</option>
                    <option value="list_assignment">Added to List</option>
                    <option value="workflow_start">Workflow Started</option>
                  </select>
                </div>

                {formData.conditionType === 'stage_completion' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Stage</label>
                    <select
                      value={formData.conditionValue.stage_key || ''}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, stage_key: e.target.value }
                      })}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
                    >
                      <option value="">Any stage</option>
                      {workflowStages.map((stage) => (
                        <option key={stage.stage_key} value={stage.stage_key}>
                          {stage.stage_label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {formData.type === 'perpetual' && (
              <div>
                <p className="text-sm text-gray-600">This workflow will always be available to work on and will not trigger automatically.</p>
              </div>
            )}
          </div>

          {/* Action Configuration - Only shown for non-perpetual rules */}
          {formData.type !== 'perpetual' && (
          <div className="bg-gray-50 rounded-lg p-4 space-y-4">
            <h4 className="text-sm font-medium text-gray-900">Action Configuration</h4>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">When this rule triggers, what should happen?</label>
              <select
                value={formData.actionType}
                onChange={(e) => setFormData({ ...formData, actionType: e.target.value, actionValue: {} })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
              >
                <optgroup label="Workflow Progress">
                  <option value="move_stage">Move to a specific stage</option>
                  <option value="advance_stage">Advance to next stage</option>
                  <option value="reset_workflow">Reset workflow to beginning</option>
                </optgroup>
                <optgroup label="Create New Instance">
                  <option value="branch_copy">Create a copy (keep current progress)</option>
                  <option value="branch_nocopy">Create a new instance (fresh start)</option>
                </optgroup>
                <optgroup label="Notification">
                  <option value="send_reminder">Send a reminder notification</option>
                </optgroup>
              </select>
            </div>

            {(formData.actionType === 'branch_copy' || formData.actionType === 'branch_nocopy') && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    How should the new workflow be named?
                  </label>
                  <p className="text-xs text-gray-500 mb-3">
                    Add text that will be appended to "{workflowName}".
                    Use dynamic codes that automatically update with the current date.
                  </p>
                </div>

                {/* Quick Insert Templates */}
                <div className="space-y-2">
                  <span className="text-xs font-medium text-gray-700">Common templates:</span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFormData({
                        ...formData,
                        actionValue: { ...formData.actionValue, branch_suffix: '{MONTH} {YEAR}' }
                      })}
                      className="px-3 py-2 text-xs bg-white border border-gray-300 hover:border-blue-400 hover:bg-blue-50 rounded-lg transition-colors text-left"
                    >
                      <div className="font-medium text-gray-900">{new Date().toLocaleString('en-US', { month: 'short' })} {getCurrentYear()}</div>
                      <div className="text-gray-500 mt-0.5">Monthly</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({
                        ...formData,
                        actionValue: { ...formData.actionValue, branch_suffix: '{QUARTER} {YEAR}' }
                      })}
                      className="px-3 py-2 text-xs bg-white border border-gray-300 hover:border-blue-400 hover:bg-blue-50 rounded-lg transition-colors text-left"
                    >
                      <div className="font-medium text-gray-900">Q{getCurrentQuarter()} {getCurrentYear()}</div>
                      <div className="text-gray-500 mt-0.5">Quarterly</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({
                        ...formData,
                        actionValue: { ...formData.actionValue, branch_suffix: '{YEAR}' }
                      })}
                      className="px-3 py-2 text-xs bg-white border border-gray-300 hover:border-blue-400 hover:bg-blue-50 rounded-lg transition-colors text-left"
                    >
                      <div className="font-medium text-gray-900">{getCurrentYear()}</div>
                      <div className="text-gray-500 mt-0.5">Annual</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({
                        ...formData,
                        actionValue: { ...formData.actionValue, branch_suffix: '{DATE}' }
                      })}
                      className="px-3 py-2 text-xs bg-white border border-gray-300 hover:border-blue-400 hover:bg-blue-50 rounded-lg transition-colors text-left"
                    >
                      <div className="font-medium text-gray-900">{processDynamicSuffix('{DATE}')}</div>
                      <div className="text-gray-500 mt-0.5">Date</div>
                    </button>
                  </div>
                </div>

                {/* Input Field */}
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-gray-600">Custom suffix:</label>
                  <input
                    type="text"
                    value={formData.actionValue.branch_suffix || ''}
                    onChange={(e) => setFormData({
                      ...formData,
                      actionValue: { ...formData.actionValue, branch_suffix: e.target.value }
                    })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
                    placeholder="Type or use a template above"
                  />
                </div>

                {/* Preview Box */}
                {formData.actionValue.branch_suffix && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <div className="flex items-start space-x-2">
                      <div className="flex-shrink-0 mt-0.5">
                        <Eye className="w-4 h-4 text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-blue-900 mb-1">Preview of new workflow name:</p>
                        <p className="text-sm font-semibold text-blue-900 truncate">
                          {workflowName} - {processDynamicSuffix(formData.actionValue.branch_suffix)}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Available Codes */}
                <details className="text-xs">
                  <summary className="cursor-pointer text-gray-600 hover:text-gray-900 font-medium">
                    Available dynamic codes
                  </summary>
                  <div className="mt-2 ml-4 space-y-1 text-gray-600">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      <span><code className="bg-gray-100 px-1.5 py-0.5 rounded text-blue-600">{'{QUARTER}'}</code> = Q{getCurrentQuarter()}</span>
                      <span><code className="bg-gray-100 px-1.5 py-0.5 rounded text-blue-600">{'{Q}'}</code> = {getCurrentQuarter()}</span>
                      <span><code className="bg-gray-100 px-1.5 py-0.5 rounded text-blue-600">{'{YEAR}'}</code> = {getCurrentYear()}</span>
                      <span><code className="bg-gray-100 px-1.5 py-0.5 rounded text-blue-600">{'{YY}'}</code> = {getCurrentYear().toString().slice(-2)}</span>
                      <span><code className="bg-gray-100 px-1.5 py-0.5 rounded text-blue-600">{'{MONTH}'}</code> = {new Date().toLocaleString('en-US', { month: 'short' })}</span>
                      <span><code className="bg-gray-100 px-1.5 py-0.5 rounded text-blue-600">{'{DAY}'}</code> = {new Date().getDate()}</span>
                      <span><code className="bg-gray-100 px-1.5 py-0.5 rounded text-blue-600">{'{DATE}'}</code> = {processDynamicSuffix('{DATE}')}</span>
                    </div>
                  </div>
                </details>
              </div>
            )}

            {(formData.actionType === 'move_stage' || formData.actionType === 'reset_workflow') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {formData.actionType === 'move_stage' ? 'Which stage to move to?' : 'Which stage to restart from?'}
                </label>
                <select
                  value={formData.actionValue.target_stage || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    actionValue: { ...formData.actionValue, target_stage: e.target.value }
                  })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
                >
                  <option value="">First stage</option>
                  {workflowStages.map((stage) => (
                    <option key={stage.stage_key} value={stage.stage_key}>
                      {stage.stage_label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  {formData.actionType === 'move_stage'
                    ? 'The workflow will move to this stage when the rule triggers'
                    : 'The workflow will restart from this stage (all progress will be reset)'}
                </p>
              </div>
            )}

            {formData.actionType === 'notify_only' && (
              <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                <p className="text-sm text-blue-800">This will send a notification without making any changes to the workflow progress.</p>
              </div>
            )}

            {formData.actionType === 'mark_complete' && (
              <div className="bg-green-50 border border-green-200 rounded-md p-3">
                <p className="text-sm text-green-800">This will mark the workflow as complete and move it out of active workflows.</p>
              </div>
            )}
          </div>
          )}

          {/* Active Toggle */}
          <div className="flex items-center justify-between py-3 border-t border-gray-200">
            <div className="flex items-center">
              <input
                type="checkbox"
                id="is_active"
                checked={formData.isActive}
                onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <label htmlFor="is_active" className="ml-2 block text-sm text-gray-900 font-medium">
                Activate
              </label>
            </div>

            <div className="flex space-x-3">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit">
                Create Rule
              </Button>
            </div>
          </div>
        </form>
        </div>
      </div>
    </div>
  )
}

function EditRuleModal({ rule, workflowName, workflowStages, onClose, onSave }: {
  rule: any
  workflowName: string
  workflowStages: WorkflowStage[]
  onClose: () => void
  onSave: (updates: any) => void
}) {
  const [formData, setFormData] = useState({
    name: rule.rule_name || '',
    type: rule.rule_type || 'time',
    conditionType: rule.condition_type || 'time_interval',
    conditionValue: rule.condition_value || {},
    actionType: rule.action_type || 'branch_copy',
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
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 overflow-y-auto flex-1">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Edit Automation Rule</h2>
            <p className="text-sm text-gray-500 mt-1">Update when and how this workflow should be automated</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
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
              placeholder="e.g., Weekly Review Reset"
              required
            />
          </div>

          {/* Rule Type Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Trigger Type
            </label>
            <div className="grid grid-cols-2 gap-3">
              {[
                { value: 'time', label: 'Time', icon: Clock, desc: 'Trigger based on time intervals' },
                { value: 'event', label: 'Event', icon: Zap, desc: 'Trigger on market events' },
                { value: 'activity', label: 'Activity', icon: Activity, desc: 'Trigger on user actions' },
                { value: 'perpetual', label: 'Perpetual', icon: Target, desc: 'Always available' }
              ].map((option) => {
                const Icon = option.icon
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      const conditionMap = {
                        'time': 'time_interval',
                        'event': 'earnings_date',
                        'activity': 'stage_completion',
                        'perpetual': 'always_available'
                      }
                      setFormData({
                        ...formData,
                        type: option.value,
                        conditionType: conditionMap[option.value as keyof typeof conditionMap],
                        conditionValue: {}
                      })
                    }}
                    className={`p-4 border-2 rounded-lg transition-all text-left ${
                      formData.type === option.value
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start space-x-3">
                      <Icon className={`w-5 h-5 mt-0.5 ${formData.type === option.value ? 'text-blue-600' : 'text-gray-400'}`} />
                      <div>
                        <div className={`font-medium ${formData.type === option.value ? 'text-blue-900' : 'text-gray-900'}`}>
                          {option.label}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">{option.desc}</div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Trigger Configuration */}
          <div className="bg-gray-50 rounded-lg p-4 space-y-4">
            <h4 className="text-sm font-medium text-gray-900">Trigger Configuration</h4>

            {formData.type === 'time' && (
              <div className="space-y-4">
                {/* Recurrence Pattern */}
                <div className="bg-white border-2 border-gray-200 rounded-lg p-4">
                  <h5 className="text-sm font-semibold text-gray-900 mb-3">Recurrence Pattern</h5>

                  {/* Pattern Type Selection - Two Column Layout */}
                  <div className="flex space-x-8">
                    {/* Left Column - Radio Buttons */}
                    <div className="flex flex-col space-y-3 min-w-[100px]">
                      {/* Daily */}
                      <div className="flex items-center space-x-2">
                        <input
                          type="radio"
                          id="pattern-daily"
                          checked={formData.conditionValue.pattern_type === 'daily'}
                          onChange={() => setFormData({
                            ...formData,
                            conditionValue: {
                              pattern_type: 'daily',
                              daily_type: 'every_x_days',
                              interval: 1
                            }
                          })}
                        />
                        <label htmlFor="pattern-daily" className="font-medium text-gray-900 cursor-pointer">Daily</label>
                      </div>

                      {/* Weekly */}
                      <div className="flex items-center space-x-2">
                        <input
                          type="radio"
                          id="pattern-weekly"
                          checked={formData.conditionValue.pattern_type === 'weekly'}
                          onChange={() => setFormData({
                            ...formData,
                            conditionValue: {
                              pattern_type: 'weekly',
                              interval: 1,
                              days_of_week: ['monday']
                            }
                          })}
                        />
                        <label htmlFor="pattern-weekly" className="font-medium text-gray-900 cursor-pointer">Weekly</label>
                      </div>

                      {/* Monthly */}
                      <div className="flex items-center space-x-2">
                        <input
                          type="radio"
                          id="pattern-monthly"
                          checked={formData.conditionValue.pattern_type === 'monthly'}
                          onChange={() => setFormData({
                            ...formData,
                            conditionValue: {
                              pattern_type: 'monthly',
                              monthly_type: 'day_of_month',
                              day_number: 1,
                              interval: 1
                            }
                          })}
                        />
                        <label htmlFor="pattern-monthly" className="font-medium text-gray-900 cursor-pointer">Monthly</label>
                      </div>

                      {/* Quarterly */}
                      <div className="flex items-center space-x-2">
                        <input
                          type="radio"
                          id="pattern-quarterly"
                          checked={formData.conditionValue.pattern_type === 'quarterly'}
                          onChange={() => setFormData({
                            ...formData,
                            conditionValue: {
                              pattern_type: 'quarterly',
                              quarterly_type: 'day_of_quarter',
                              day_number: 1,
                              interval: 1
                            }
                          })}
                        />
                        <label htmlFor="pattern-quarterly" className="font-medium text-gray-900 cursor-pointer">Quarterly</label>
                      </div>

                      {/* Yearly */}
                      <div className="flex items-center space-x-2">
                        <input
                          type="radio"
                          id="pattern-yearly"
                          checked={formData.conditionValue.pattern_type === 'yearly'}
                          onChange={() => setFormData({
                            ...formData,
                            conditionValue: {
                              pattern_type: 'yearly',
                              yearly_type: 'specific_date',
                              month: 'january',
                              day_number: 1
                            }
                          })}
                        />
                        <label htmlFor="pattern-yearly" className="font-medium text-gray-900 cursor-pointer">Yearly</label>
                      </div>
                    </div>

                    {/* Right Column - Configuration Options */}
                    <div className="flex-1 border-l border-gray-200 pl-6">
                      {/* Daily Options */}
                      {formData.conditionValue.pattern_type === 'daily' && (
                        <div className="flex flex-col space-y-2">
                          <div className="flex items-center space-x-2">
                            <input
                              type="radio"
                              id="daily-every-x"
                              checked={formData.conditionValue.daily_type === 'every_x_days'}
                              onChange={() => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, daily_type: 'every_x_days', interval: 1 }
                              })}
                            />
                            <label htmlFor="daily-every-x" className="text-sm text-gray-700">Every</label>
                            <input
                              type="number"
                              min="1"
                              value={formData.conditionValue.interval || 1}
                              onChange={(e) => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, interval: parseInt(e.target.value) || 1 }
                              })}
                              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                              disabled={formData.conditionValue.daily_type !== 'every_x_days'}
                            />
                            <label className="text-sm text-gray-700">day(s)</label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <input
                              type="radio"
                              id="daily-weekday"
                              checked={formData.conditionValue.daily_type === 'every_weekday'}
                              onChange={() => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, daily_type: 'every_weekday' }
                              })}
                            />
                            <label htmlFor="daily-weekday" className="text-sm text-gray-700">Every weekday</label>
                          </div>
                        </div>
                      )}

                      {/* Weekly Options */}
                      {formData.conditionValue.pattern_type === 'weekly' && (
                        <div className="flex flex-col space-y-2">
                          <div className="flex items-center space-x-2">
                            <span className="text-sm text-gray-700">Recur every</span>
                            <input
                              type="number"
                              min="1"
                              value={formData.conditionValue.interval || 1}
                              onChange={(e) => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, interval: parseInt(e.target.value) || 1 }
                              })}
                              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                            />
                            <span className="text-sm text-gray-700">week(s) on:</span>
                          </div>
                          <div className="grid grid-cols-4 gap-2">
                            {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day) => (
                              <label key={day} className="flex items-center space-x-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={(formData.conditionValue.days_of_week || []).includes(day.toLowerCase())}
                                  onChange={(e) => {
                                    const days = formData.conditionValue.days_of_week || []
                                    const newDays = e.target.checked
                                      ? [...days, day.toLowerCase()]
                                      : days.filter(d => d !== day.toLowerCase())
                                    setFormData({
                                      ...formData,
                                      conditionValue: { ...formData.conditionValue, days_of_week: newDays }
                                    })
                                  }}
                                />
                                <span>{day.slice(0, 3)}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Monthly Options */}
                      {formData.conditionValue.pattern_type === 'monthly' && (
                        <div className="flex flex-col space-y-2">
                          <div className="flex items-center space-x-2">
                            <input
                              type="radio"
                              id="monthly-day"
                              checked={formData.conditionValue.monthly_type === 'day_of_month'}
                              onChange={() => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, monthly_type: 'day_of_month', day_number: 1 }
                              })}
                            />
                            <label htmlFor="monthly-day" className="text-sm text-gray-700">Day</label>
                            <input
                              type="number"
                              min="1"
                              max="31"
                              value={formData.conditionValue.day_number || 1}
                              onChange={(e) => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, day_number: parseInt(e.target.value) || 1 }
                              })}
                              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                              disabled={formData.conditionValue.monthly_type !== 'day_of_month'}
                            />
                            <span className="text-sm text-gray-700">of every</span>
                            <input
                              type="number"
                              min="1"
                              value={formData.conditionValue.interval || 1}
                              onChange={(e) => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, interval: parseInt(e.target.value) || 1 }
                              })}
                              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                              disabled={formData.conditionValue.monthly_type !== 'day_of_month'}
                            />
                            <span className="text-sm text-gray-700">month(s)</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <input
                              type="radio"
                              id="monthly-position"
                              checked={formData.conditionValue.monthly_type === 'position_of_month'}
                              onChange={() => setFormData({
                                ...formData,
                                conditionValue: {
                                  ...formData.conditionValue,
                                  monthly_type: 'position_of_month',
                                  position: 'first',
                                  day_name: 'monday'
                                }
                              })}
                            />
                            <label htmlFor="monthly-position" className="text-sm text-gray-700">The</label>
                            <select
                              value={formData.conditionValue.position || 'first'}
                              onChange={(e) => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, position: e.target.value }
                              })}
                              className="px-2 py-1 border border-gray-300 rounded text-sm"
                              disabled={formData.conditionValue.monthly_type !== 'position_of_month'}
                            >
                              <option value="first">First</option>
                              <option value="second">Second</option>
                              <option value="third">Third</option>
                              <option value="fourth">Fourth</option>
                              <option value="last">Last</option>
                            </select>
                            <select
                              value={formData.conditionValue.day_name || 'monday'}
                              onChange={(e) => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, day_name: e.target.value }
                              })}
                              className="px-2 py-1 border border-gray-300 rounded text-sm"
                              disabled={formData.conditionValue.monthly_type !== 'position_of_month'}
                            >
                              <option value="day">Day</option>
                              <option value="weekday">Weekday</option>
                              <option value="weekend_day">Weekend day</option>
                              <option value="monday">Monday</option>
                              <option value="tuesday">Tuesday</option>
                              <option value="wednesday">Wednesday</option>
                              <option value="thursday">Thursday</option>
                              <option value="friday">Friday</option>
                              <option value="saturday">Saturday</option>
                              <option value="sunday">Sunday</option>
                            </select>
                            <span className="text-sm text-gray-700">of every</span>
                            <input
                              type="number"
                              min="1"
                              value={formData.conditionValue.interval || 1}
                              onChange={(e) => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, interval: parseInt(e.target.value) || 1 }
                              })}
                              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                              disabled={formData.conditionValue.monthly_type !== 'position_of_month'}
                            />
                            <span className="text-sm text-gray-700">month(s)</span>
                          </div>
                        </div>
                      )}

                      {/* Quarterly Options */}
                      {formData.conditionValue.pattern_type === 'quarterly' && (
                        <div className="flex flex-col space-y-2">
                          <div className="flex items-center space-x-2">
                            <input
                              type="radio"
                              id="quarterly-day"
                              checked={formData.conditionValue.quarterly_type === 'day_of_quarter'}
                              onChange={() => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, quarterly_type: 'day_of_quarter', day_number: 1 }
                              })}
                            />
                            <label htmlFor="quarterly-day" className="text-sm text-gray-700">Day</label>
                            <input
                              type="number"
                              min="1"
                              max="92"
                              value={formData.conditionValue.day_number || 1}
                              onChange={(e) => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, day_number: parseInt(e.target.value) || 1 }
                              })}
                              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                              disabled={formData.conditionValue.quarterly_type !== 'day_of_quarter'}
                            />
                            <span className="text-sm text-gray-700">of every</span>
                            <input
                              type="number"
                              min="1"
                              value={formData.conditionValue.interval || 1}
                              onChange={(e) => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, interval: parseInt(e.target.value) || 1 }
                              })}
                              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                              disabled={formData.conditionValue.quarterly_type !== 'day_of_quarter'}
                            />
                            <span className="text-sm text-gray-700">quarter(s)</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <input
                              type="radio"
                              id="quarterly-position"
                              checked={formData.conditionValue.quarterly_type === 'position_of_quarter'}
                              onChange={() => setFormData({
                                ...formData,
                                conditionValue: {
                                  ...formData.conditionValue,
                                  quarterly_type: 'position_of_quarter',
                                  position: 'first',
                                  day_name: 'monday'
                                }
                              })}
                            />
                            <label htmlFor="quarterly-position" className="text-sm text-gray-700">The</label>
                            <select
                              value={formData.conditionValue.position || 'first'}
                              onChange={(e) => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, position: e.target.value }
                              })}
                              className="px-2 py-1 border border-gray-300 rounded text-sm"
                              disabled={formData.conditionValue.quarterly_type !== 'position_of_quarter'}
                            >
                              <option value="first">First</option>
                              <option value="second">Second</option>
                              <option value="third">Third</option>
                              <option value="fourth">Fourth</option>
                              <option value="last">Last</option>
                            </select>
                            <select
                              value={formData.conditionValue.day_name || 'monday'}
                              onChange={(e) => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, day_name: e.target.value }
                              })}
                              className="px-2 py-1 border border-gray-300 rounded text-sm"
                              disabled={formData.conditionValue.quarterly_type !== 'position_of_quarter'}
                            >
                              <option value="day">Day</option>
                              <option value="weekday">Weekday</option>
                              <option value="weekend_day">Weekend day</option>
                              <option value="monday">Monday</option>
                              <option value="tuesday">Tuesday</option>
                              <option value="wednesday">Wednesday</option>
                              <option value="thursday">Thursday</option>
                              <option value="friday">Friday</option>
                              <option value="saturday">Saturday</option>
                              <option value="sunday">Sunday</option>
                            </select>
                            <span className="text-sm text-gray-700">of every</span>
                            <input
                              type="number"
                              min="1"
                              value={formData.conditionValue.interval || 1}
                              onChange={(e) => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, interval: parseInt(e.target.value) || 1 }
                              })}
                              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                              disabled={formData.conditionValue.quarterly_type !== 'position_of_quarter'}
                            />
                            <span className="text-sm text-gray-700">quarter(s)</span>
                          </div>
                        </div>
                      )}

                      {/* Yearly Options */}
                      {formData.conditionValue.pattern_type === 'yearly' && (
                        <div className="flex flex-col space-y-2">
                          <div className="flex items-center space-x-2">
                            <input
                              type="radio"
                              id="yearly-date"
                              checked={formData.conditionValue.yearly_type === 'specific_date'}
                              onChange={() => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, yearly_type: 'specific_date' }
                              })}
                            />
                            <label htmlFor="yearly-date" className="text-sm text-gray-700">On</label>
                            <select
                              value={formData.conditionValue.month || 'january'}
                              onChange={(e) => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, month: e.target.value }
                              })}
                              className="px-2 py-1 border border-gray-300 rounded text-sm"
                              disabled={formData.conditionValue.yearly_type !== 'specific_date'}
                            >
                              {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map(m => (
                                <option key={m} value={m.toLowerCase()}>{m}</option>
                              ))}
                            </select>
                            <input
                              type="number"
                              min="1"
                              max="31"
                              value={formData.conditionValue.day_number || 1}
                              onChange={(e) => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, day_number: parseInt(e.target.value) || 1 }
                              })}
                              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                              disabled={formData.conditionValue.yearly_type !== 'specific_date'}
                            />
                          </div>
                          <div className="flex items-center space-x-2">
                            <input
                              type="radio"
                              id="yearly-position"
                              checked={formData.conditionValue.yearly_type === 'position_of_year'}
                              onChange={() => setFormData({
                                ...formData,
                                conditionValue: {
                                  ...formData.conditionValue,
                                  yearly_type: 'position_of_year',
                                  position: 'first',
                                  day_name: 'monday',
                                  month: 'january'
                                }
                              })}
                            />
                            <label htmlFor="yearly-position" className="text-sm text-gray-700">The</label>
                            <select
                              value={formData.conditionValue.position || 'first'}
                              onChange={(e) => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, position: e.target.value }
                              })}
                              className="px-2 py-1 border border-gray-300 rounded text-sm"
                              disabled={formData.conditionValue.yearly_type !== 'position_of_year'}
                            >
                              <option value="first">First</option>
                              <option value="second">Second</option>
                              <option value="third">Third</option>
                              <option value="fourth">Fourth</option>
                              <option value="last">Last</option>
                            </select>
                            <select
                              value={formData.conditionValue.day_name || 'monday'}
                              onChange={(e) => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, day_name: e.target.value }
                              })}
                              className="px-2 py-1 border border-gray-300 rounded text-sm"
                              disabled={formData.conditionValue.yearly_type !== 'position_of_year'}
                            >
                              <option value="day">Day</option>
                              <option value="weekday">Weekday</option>
                              <option value="weekend_day">Weekend day</option>
                              <option value="monday">Monday</option>
                              <option value="tuesday">Tuesday</option>
                              <option value="wednesday">Wednesday</option>
                              <option value="thursday">Thursday</option>
                              <option value="friday">Friday</option>
                              <option value="saturday">Saturday</option>
                              <option value="sunday">Sunday</option>
                            </select>
                            <span className="text-sm text-gray-700">of</span>
                            <select
                              value={formData.conditionValue.month || 'january'}
                              onChange={(e) => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, month: e.target.value }
                              })}
                              className="px-2 py-1 border border-gray-300 rounded text-sm"
                              disabled={formData.conditionValue.yearly_type !== 'position_of_year'}
                            >
                              {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map(m => (
                                <option key={m} value={m.toLowerCase()}>{m}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Range of Recurrence */}
                <div className="bg-white border-2 border-gray-200 rounded-lg p-4">
                  <h5 className="text-sm font-semibold text-gray-900 mb-3">Range of Recurrence</h5>

                  <div className="space-y-3">
                    {/* Start Date */}
                    <div className="flex items-center space-x-2">
                      <label className="text-sm font-medium text-gray-700 w-20">Start:</label>
                      <input
                        type="date"
                        value={formData.conditionValue.start_date || ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          conditionValue: { ...formData.conditionValue, start_date: e.target.value }
                        })}
                        className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    {/* End Options */}
                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <input
                          type="radio"
                          id="end-no-end"
                          checked={formData.conditionValue.end_type === 'no_end' || !formData.conditionValue.end_type}
                          onChange={() => setFormData({
                            ...formData,
                            conditionValue: { ...formData.conditionValue, end_type: 'no_end' }
                          })}
                        />
                        <label htmlFor="end-no-end" className="text-sm text-gray-700">No end date</label>
                      </div>

                      <div className="flex items-center space-x-2">
                        <input
                          type="radio"
                          id="end-after"
                          checked={formData.conditionValue.end_type === 'after_occurrences'}
                          onChange={() => setFormData({
                            ...formData,
                            conditionValue: { ...formData.conditionValue, end_type: 'after_occurrences', occurrences: 10 }
                          })}
                        />
                        <label htmlFor="end-after" className="text-sm text-gray-700">End after</label>
                        <input
                          type="number"
                          min="1"
                          value={formData.conditionValue.occurrences || 10}
                          onChange={(e) => setFormData({
                            ...formData,
                            conditionValue: { ...formData.conditionValue, occurrences: parseInt(e.target.value) || 1 }
                          })}
                          className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                          disabled={formData.conditionValue.end_type !== 'after_occurrences'}
                        />
                        <span className="text-sm text-gray-700">occurrences</span>
                      </div>

                      <div className="flex items-center space-x-2">
                        <input
                          type="radio"
                          id="end-by-date"
                          checked={formData.conditionValue.end_type === 'end_by_date'}
                          onChange={() => setFormData({
                            ...formData,
                            conditionValue: { ...formData.conditionValue, end_type: 'end_by_date' }
                          })}
                        />
                        <label htmlFor="end-by-date" className="text-sm text-gray-700">End by</label>
                        <input
                          type="date"
                          value={formData.conditionValue.end_date || ''}
                          onChange={(e) => setFormData({
                            ...formData,
                            conditionValue: { ...formData.conditionValue, end_date: e.target.value }
                          })}
                          className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          disabled={formData.conditionValue.end_type !== 'end_by_date'}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {formData.type === 'event' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Event Type</label>
                  <select
                    value={formData.conditionType}
                    onChange={(e) => setFormData({ ...formData, conditionType: e.target.value, conditionValue: {} })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
                  >
                    <optgroup label="Corporate Events">
                      <option value="earnings_date">Earnings Date</option>
                      <option value="dividend_date">Dividend Date</option>
                      <option value="conference">Conference</option>
                      <option value="investor_relations_call">Investor Relations Call</option>
                      <option value="analyst_call">Sell-Side Analyst Call</option>
                      <option value="roadshow">Roadshow</option>
                    </optgroup>
                    <optgroup label="Market Activity">
                      <option value="price_change">Price Change</option>
                      <option value="volume_spike">Volume Spike</option>
                    </optgroup>
                  </select>
                </div>

                {formData.conditionType === 'earnings_date' && (
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      min="0"
                      value={formData.conditionValue.days_offset || ''}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, days_offset: parseInt(e.target.value) }
                      })}
                      className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="3"
                    />
                    <span className="text-sm text-gray-600">days</span>
                    <select
                      value={formData.conditionValue.timing || 'before'}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, timing: e.target.value }
                      })}
                      className="px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
                    >
                      <option value="before">before</option>
                      <option value="after">after</option>
                    </select>
                    <span className="text-sm text-gray-600">earnings</span>
                  </div>
                )}

                {formData.conditionType === 'price_change' && (
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-600">When price changes by</span>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={formData.conditionValue.percentage || ''}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, percentage: parseFloat(e.target.value) }
                      })}
                      className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="5"
                    />
                    <span className="text-sm text-gray-600">%</span>
                    <select
                      value={formData.conditionValue.direction || 'either'}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, direction: e.target.value }
                      })}
                      className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="up">up</option>
                      <option value="down">down</option>
                      <option value="either">either direction</option>
                    </select>
                  </div>
                )}

                {formData.conditionType === 'volume_spike' && (
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-600">When volume is</span>
                    <input
                      type="number"
                      min="1"
                      step="0.1"
                      value={formData.conditionValue.multiplier || ''}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, multiplier: parseFloat(e.target.value) }
                      })}
                      className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="2"
                    />
                    <span className="text-sm text-gray-600">× average volume</span>
                  </div>
                )}

                {formData.conditionType === 'dividend_date' && (
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      min="0"
                      value={formData.conditionValue.days_offset || ''}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, days_offset: parseInt(e.target.value) }
                      })}
                      className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="3"
                    />
                    <span className="text-sm text-gray-600">days</span>
                    <select
                      value={formData.conditionValue.timing || 'before'}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, timing: e.target.value }
                      })}
                      className="px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
                    >
                      <option value="before">before</option>
                      <option value="after">after</option>
                    </select>
                    <span className="text-sm text-gray-600">dividend date</span>
                  </div>
                )}

                {formData.conditionType === 'conference' && (
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      min="0"
                      value={formData.conditionValue.days_offset || ''}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, days_offset: parseInt(e.target.value) }
                      })}
                      className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="3"
                    />
                    <span className="text-sm text-gray-600">days</span>
                    <select
                      value={formData.conditionValue.timing || 'before'}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, timing: e.target.value }
                      })}
                      className="px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
                    >
                      <option value="before">before</option>
                      <option value="after">after</option>
                    </select>
                    <span className="text-sm text-gray-600">conference</span>
                  </div>
                )}

                {formData.conditionType === 'investor_relations_call' && (
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      min="0"
                      value={formData.conditionValue.days_offset || ''}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, days_offset: parseInt(e.target.value) }
                      })}
                      className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="3"
                    />
                    <span className="text-sm text-gray-600">days</span>
                    <select
                      value={formData.conditionValue.timing || 'before'}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, timing: e.target.value }
                      })}
                      className="px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
                    >
                      <option value="before">before</option>
                      <option value="after">after</option>
                    </select>
                    <span className="text-sm text-gray-600">investor relations call</span>
                  </div>
                )}

                {formData.conditionType === 'analyst_call' && (
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      min="0"
                      value={formData.conditionValue.days_offset || ''}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, days_offset: parseInt(e.target.value) }
                      })}
                      className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="3"
                    />
                    <span className="text-sm text-gray-600">days</span>
                    <select
                      value={formData.conditionValue.timing || 'before'}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, timing: e.target.value }
                      })}
                      className="px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
                    >
                      <option value="before">before</option>
                      <option value="after">after</option>
                    </select>
                    <span className="text-sm text-gray-600">sell-side analyst call</span>
                  </div>
                )}

                {formData.conditionType === 'roadshow' && (
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      min="0"
                      value={formData.conditionValue.days_offset || ''}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, days_offset: parseInt(e.target.value) }
                      })}
                      className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="3"
                    />
                    <span className="text-sm text-gray-600">days</span>
                    <select
                      value={formData.conditionValue.timing || 'before'}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, timing: e.target.value }
                      })}
                      className="px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
                    >
                      <option value="before">before</option>
                      <option value="after">after</option>
                    </select>
                    <span className="text-sm text-gray-600">roadshow</span>
                  </div>
                )}
              </div>
            )}

            {formData.type === 'activity' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Activity Type</label>
                  <select
                    value={formData.conditionType}
                    onChange={(e) => setFormData({ ...formData, conditionType: e.target.value, conditionValue: {} })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
                  >
                    <option value="stage_completion">Stage Completion</option>
                    <option value="note_added">Note Added</option>
                    <option value="list_assignment">Added to List</option>
                    <option value="workflow_start">Workflow Started</option>
                  </select>
                </div>

                {formData.conditionType === 'stage_completion' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Stage</label>
                    <select
                      value={formData.conditionValue.stage_key || ''}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, stage_key: e.target.value }
                      })}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
                    >
                      <option value="">Any stage</option>
                      {workflowStages.map((stage) => (
                        <option key={stage.stage_key} value={stage.stage_key}>
                          {stage.stage_label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {formData.type === 'perpetual' && (
              <div>
                <p className="text-sm text-gray-600">This workflow will always be available to work on and will not trigger automatically.</p>
              </div>
            )}
          </div>

          {/* Action Configuration - Only shown for non-perpetual rules */}
          {formData.type !== 'perpetual' && (
          <div className="bg-gray-50 rounded-lg p-4 space-y-4">
            <h4 className="text-sm font-medium text-gray-900">Action Configuration</h4>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">When this rule triggers, what should happen?</label>
              <select
                value={formData.actionType}
                onChange={(e) => setFormData({ ...formData, actionType: e.target.value, actionValue: {} })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
              >
                <optgroup label="Workflow Progress">
                  <option value="move_stage">Move to a specific stage</option>
                  <option value="advance_stage">Advance to next stage</option>
                  <option value="reset_workflow">Reset workflow to beginning</option>
                </optgroup>
                <optgroup label="Create New Instance">
                  <option value="branch_copy">Create a copy (keep current progress)</option>
                  <option value="branch_nocopy">Create a new instance (fresh start)</option>
                </optgroup>
                <optgroup label="Notification">
                  <option value="send_reminder">Send a reminder notification</option>
                </optgroup>
              </select>
            </div>

            {(formData.actionType === 'branch_copy' || formData.actionType === 'branch_nocopy') && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    How should the new workflow be named?
                  </label>
                  <p className="text-xs text-gray-500 mb-3">
                    Add text that will be appended to "{workflowName}".
                    Use dynamic codes that automatically update with the current date.
                  </p>
                </div>

                {/* Quick Insert Templates */}
                <div className="space-y-2">
                  <span className="text-xs font-medium text-gray-700">Common templates:</span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFormData({
                        ...formData,
                        actionValue: { ...formData.actionValue, branch_suffix: '{MONTH} {YEAR}' }
                      })}
                      className="px-3 py-2 text-xs bg-white border border-gray-300 hover:border-blue-400 hover:bg-blue-50 rounded-lg transition-colors text-left"
                    >
                      <div className="font-medium text-gray-900">{new Date().toLocaleString('en-US', { month: 'short' })} {getCurrentYear()}</div>
                      <div className="text-gray-500 mt-0.5">Monthly</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({
                        ...formData,
                        actionValue: { ...formData.actionValue, branch_suffix: '{QUARTER} {YEAR}' }
                      })}
                      className="px-3 py-2 text-xs bg-white border border-gray-300 hover:border-blue-400 hover:bg-blue-50 rounded-lg transition-colors text-left"
                    >
                      <div className="font-medium text-gray-900">Q{getCurrentQuarter()} {getCurrentYear()}</div>
                      <div className="text-gray-500 mt-0.5">Quarterly</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({
                        ...formData,
                        actionValue: { ...formData.actionValue, branch_suffix: '{YEAR}' }
                      })}
                      className="px-3 py-2 text-xs bg-white border border-gray-300 hover:border-blue-400 hover:bg-blue-50 rounded-lg transition-colors text-left"
                    >
                      <div className="font-medium text-gray-900">{getCurrentYear()}</div>
                      <div className="text-gray-500 mt-0.5">Annual</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({
                        ...formData,
                        actionValue: { ...formData.actionValue, branch_suffix: '{DATE}' }
                      })}
                      className="px-3 py-2 text-xs bg-white border border-gray-300 hover:border-blue-400 hover:bg-blue-50 rounded-lg transition-colors text-left"
                    >
                      <div className="font-medium text-gray-900">{processDynamicSuffix('{DATE}')}</div>
                      <div className="text-gray-500 mt-0.5">Date</div>
                    </button>
                  </div>
                </div>

                {/* Input Field */}
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-gray-600">Custom suffix:</label>
                  <input
                    type="text"
                    value={formData.actionValue.branch_suffix || ''}
                    onChange={(e) => setFormData({
                      ...formData,
                      actionValue: { ...formData.actionValue, branch_suffix: e.target.value }
                    })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
                    placeholder="Type or use a template above"
                  />
                </div>

                {/* Preview Box */}
                {formData.actionValue.branch_suffix && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <div className="flex items-start space-x-2">
                      <div className="flex-shrink-0 mt-0.5">
                        <Eye className="w-4 h-4 text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-blue-900 mb-1">Preview of new workflow name:</p>
                        <p className="text-sm font-semibold text-blue-900 truncate">
                          {workflowName} - {processDynamicSuffix(formData.actionValue.branch_suffix)}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Available Codes */}
                <details className="text-xs">
                  <summary className="cursor-pointer text-gray-600 hover:text-gray-900 font-medium">
                    Available dynamic codes
                  </summary>
                  <div className="mt-2 ml-4 space-y-1 text-gray-600">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      <span><code className="bg-gray-100 px-1.5 py-0.5 rounded text-blue-600">{'{QUARTER}'}</code> = Q{getCurrentQuarter()}</span>
                      <span><code className="bg-gray-100 px-1.5 py-0.5 rounded text-blue-600">{'{Q}'}</code> = {getCurrentQuarter()}</span>
                      <span><code className="bg-gray-100 px-1.5 py-0.5 rounded text-blue-600">{'{YEAR}'}</code> = {getCurrentYear()}</span>
                      <span><code className="bg-gray-100 px-1.5 py-0.5 rounded text-blue-600">{'{YY}'}</code> = {getCurrentYear().toString().slice(-2)}</span>
                      <span><code className="bg-gray-100 px-1.5 py-0.5 rounded text-blue-600">{'{MONTH}'}</code> = {new Date().toLocaleString('en-US', { month: 'short' })}</span>
                      <span><code className="bg-gray-100 px-1.5 py-0.5 rounded text-blue-600">{'{DAY}'}</code> = {new Date().getDate()}</span>
                      <span><code className="bg-gray-100 px-1.5 py-0.5 rounded text-blue-600">{'{DATE}'}</code> = {processDynamicSuffix('{DATE}')}</span>
                    </div>
                  </div>
                </details>
              </div>
            )}

            {(formData.actionType === 'move_stage' || formData.actionType === 'reset_workflow') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {formData.actionType === 'move_stage' ? 'Which stage to move to?' : 'Which stage to restart from?'}
                </label>
                <select
                  value={formData.actionValue.target_stage || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    actionValue: { ...formData.actionValue, target_stage: e.target.value }
                  })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
                >
                  <option value="">First stage</option>
                  {workflowStages.map((stage) => (
                    <option key={stage.stage_key} value={stage.stage_key}>
                      {stage.stage_label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  {formData.actionType === 'move_stage'
                    ? 'The workflow will move to this stage when the rule triggers'
                    : 'The workflow will restart from this stage (all progress will be reset)'}
                </p>
              </div>
            )}

            {formData.actionType === 'notify_only' && (
              <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                <p className="text-sm text-blue-800">This will send a notification without making any changes to the workflow progress.</p>
              </div>
            )}

            {formData.actionType === 'mark_complete' && (
              <div className="bg-green-50 border border-green-200 rounded-md p-3">
                <p className="text-sm text-green-800">This will mark the workflow as complete and move it out of active workflows.</p>
              </div>
            )}
          </div>
          )}

          {/* Active Toggle */}
          <div className="flex items-center justify-between py-3 border-t border-gray-200">
            <div className="flex items-center">
              <input
                type="checkbox"
                id="is_active_edit"
                checked={formData.isActive}
                onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <label htmlFor="is_active_edit" className="ml-2 block text-sm text-gray-900 font-medium">
                Activate
              </label>
            </div>

            <div className="flex space-x-3">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit">
                Save Changes
              </Button>
            </div>
          </div>
        </form>
        </div>
      </div>
    </div>
  )
}