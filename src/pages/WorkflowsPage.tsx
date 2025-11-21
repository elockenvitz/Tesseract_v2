import React, { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Filter, Workflow, Users, Star, Clock, BarChart3, Settings, Trash2, Edit3, Copy, Eye, TrendingUp, StarOff, Target, CheckSquare, UserCog, Calendar, GripVertical, ArrowUp, ArrowDown, Save, X, CalendarDays, Activity, PieChart, Zap, Home, FileText, Download, Globe, Check, Bell, CheckCircle, ChevronDown, ChevronRight, GitBranch, TreeDeciduous, Network, Orbit, Archive, Play, Pause, RotateCcw, Pencil, AlertCircle, RefreshCw, ArrowLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { WorkflowManager } from '../components/ui/WorkflowManager'
import { ContentTileManager } from '../components/ui/ContentTileManager'
import { UniverseRuleBuilder } from '../components/workflow/UniverseRuleBuilder'
import { SimplifiedUniverseBuilder } from '../components/workflow/SimplifiedUniverseBuilder'
import { CreateBranchModal } from '../components/modals/CreateBranchModal'
import { UniversePreviewModal } from '../components/modals/UniversePreviewModal'
import { TemplateVersionsModal } from '../components/modals/TemplateVersionsModal'
import { CreateVersionModal } from '../components/modals/CreateVersionModal'
import { VersionCreatedModal } from '../components/modals/VersionCreatedModal'
import { VersionDetailModal } from '../components/modals/VersionDetailModal'
import { TabStateManager } from '../lib/tabStateManager'
import { FILTER_TYPE_REGISTRY } from '../lib/universeFilters'
import { formatVersion } from '../lib/versionUtils'

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
  auto_create_branch?: boolean
  auto_branch_name?: string
  usage_count: number
  active_assets: number
  completed_assets: number
  creator_name?: string
  is_favorited?: boolean
  stages?: WorkflowStage[]
  user_permission?: 'read' | 'write' | 'admin' | 'owner'
  usage_stats?: any[]
  active_version_number?: number
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
  const [activeView, setActiveView] = useState<'overview' | 'stages' | 'admins' | 'universe' | 'cadence' | 'branches' | 'models'>('overview')
  const [isArchivedExpanded, setIsArchivedExpanded] = useState(false)
  const [isPersistentExpanded, setIsPersistentExpanded] = useState(true)
  const [isCadenceExpanded, setIsCadenceExpanded] = useState(true)

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
  const [preselectedSourceBranch, setPreselectedSourceBranch] = useState<string | null>(null)
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false)
  const [workflowToDelete, setWorkflowToDelete] = useState<string | null>(null)
  const [showPermanentDeleteModal, setShowPermanentDeleteModal] = useState(false)
  const [workflowToPermanentlyDelete, setWorkflowToPermanentlyDelete] = useState<string | null>(null)
  const [showUnarchiveModal, setShowUnarchiveModal] = useState(false)
  const [workflowToUnarchive, setWorkflowToUnarchive] = useState<string | null>(null)
  const [showDeleteStageModal, setShowDeleteStageModal] = useState(false)
  const [removeAdminConfirm, setRemoveAdminConfirm] = useState<{id: string, name: string} | null>(null)
  const [removeStakeholderConfirm, setRemoveStakeholderConfirm] = useState<{id: string, name: string} | null>(null)
  const [stageToDelete, setStageToDelete] = useState<{ id: string, key: string, label: string } | null>(null)
  const [showDeleteRuleModal, setShowDeleteRuleModal] = useState(false)
  const [showUniversePreview, setShowUniversePreview] = useState(false)
  const [ruleToDelete, setRuleToDelete] = useState<{ id: string, name: string, type: string } | null>(null)
  const [branchToEnd, setBranchToEnd] = useState<{ id: string, name: string } | null>(null)
  const [showBranchOverviewModal, setShowBranchOverviewModal] = useState(false)
  const [selectedBranch, setSelectedBranch] = useState<any | null>(null)
  const [collapsedAssetGroups, setCollapsedAssetGroups] = useState<Record<string, boolean>>({
    active: false,
    inherited: false,
    ruleBased: false,
    added: false,
    deleted: false,
    completed: false
  })
  const [branchToContinue, setBranchToContinue] = useState<{ id: string, name: string } | null>(null)
  const [branchToArchive, setBranchToArchive] = useState<{ id: string, name: string } | null>(null)
  const [branchToDelete, setBranchToDelete] = useState<{ id: string, name: string } | null>(null)
  const [branchStatusFilter, setBranchStatusFilter] = useState<'all' | 'archived' | 'deleted'>('all')
  const [showTemplateVersions, setShowTemplateVersions] = useState(false)
  const [showCreateVersion, setShowCreateVersion] = useState(false)
  const [showVersionCreated, setShowVersionCreated] = useState(false)
  const [showVersionDetail, setShowVersionDetail] = useState(false)
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const [createdVersionInfo, setCreatedVersionInfo] = useState<{
    versionNumber: number
    versionName: string
    versionType: 'major' | 'minor'
  } | null>(null)
  const [isTemplateEditMode, setIsTemplateEditMode] = useState(false)
  const [templateChanges, setTemplateChanges] = useState<Array<{
    type: 'stage_added' | 'stage_edited' | 'stage_deleted' | 'stage_reordered' | 'checklist_added' | 'checklist_edited' | 'checklist_deleted' | 'rule_added' | 'rule_edited' | 'rule_deleted' | 'cadence_updated' | 'universe_updated' | 'workflow_updated'
    description: string
    timestamp: number
  }>>([])
  const [showChangesList, setShowChangesList] = useState(false)
  const [showCancelConfirmation, setShowCancelConfirmation] = useState(false)
  const changesDropdownRef = React.useRef<HTMLDivElement>(null)
  const [editingBranchSuffix, setEditingBranchSuffix] = useState<{ id: string, currentSuffix: string } | null>(null)
  const [branchSuffixValue, setBranchSuffixValue] = useState('')
  const [collapsedBranches, setCollapsedBranches] = useState<Set<string>>(new Set())
  const [isTemplateCollapsed, setIsTemplateCollapsed] = useState(false)
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

  // Universe configuration state - simplified with flexible filters
  const [universeRulesState, setUniverseRulesState] = useState<Array<{
    id: string
    type: string
    operator: any
    values: any
    combineWith?: 'AND' | 'OR'
  }>>([])

  // Track initial universe rules when entering template edit mode
  const [initialUniverseRules, setInitialUniverseRules] = useState<typeof universeRulesState>([])

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

  // Query for workflow branches with detailed stats
  const { data: workflowBranches, isLoading: isLoadingBranches } = useQuery({
    queryKey: ['workflow-branches', selectedWorkflow?.id, branchStatusFilter],
    queryFn: async () => {
      if (!selectedWorkflow?.id) return []

      let branchQuery = supabase
        .from('workflows')
        .select(`
          id,
          name,
          parent_workflow_id,
          source_branch_id,
          branch_suffix,
          branched_at,
          created_at,
          cadence_timeframe,
          cadence_days,
          archived,
          archived_at,
          deleted,
          deleted_at,
          status,
          template_version_id,
          template_version_number
        `)
        .eq('parent_workflow_id', selectedWorkflow.id)

      // Apply status filter
      if (branchStatusFilter === 'archived') {
        branchQuery = branchQuery.eq('archived', true)
      } else if (branchStatusFilter === 'deleted') {
        branchQuery = branchQuery.eq('deleted', true)
      } else {
        // 'all' shows only non-deleted, non-archived branches by default
        branchQuery = branchQuery.eq('archived', false).eq('deleted', false)
      }

      branchQuery = branchQuery.order('branched_at', { ascending: false })

      const { data, error } = await branchQuery

      console.log('Branch query filter:', branchStatusFilter)
      console.log('Branch query result:', { data, error, count: data?.length })

      if (error) {
        console.error('Error fetching workflow branches:', error)
        throw error
      }

      // For each branch, get asset progress stats
      const branchesWithStats = await Promise.all((data || []).map(async (branch) => {
        const { data: progressData } = await supabase
          .from('asset_workflow_progress')
          .select('id, current_stage_key, completed_at')
          .eq('workflow_id', branch.id)

        const totalAssets = progressData?.length || 0
        const activeAssets = progressData?.filter(p => !p.completed_at).length || 0
        const completedAssets = progressData?.filter(p => p.completed_at).length || 0

        return {
          ...branch,
          totalAssets,
          activeAssets,
          completedAssets,
          status: branch.status || 'active'
        }
      }))

      return branchesWithStats
    },
    enabled: !!selectedWorkflow?.id,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000
  })

  // Query for selected branch assets
  const { data: selectedBranchAssets } = useQuery({
    queryKey: ['branch-assets', selectedBranch?.id],
    queryFn: async () => {
      if (!selectedBranch?.id) return null

      // Get all asset progress records for this branch
      console.log('🔍 Fetching assets for branch:', selectedBranch.id)

      const { data: progressRecords, error: progressError } = await supabase
        .from('asset_workflow_progress')
        .select('*')
        .eq('workflow_id', selectedBranch.id)

      if (progressError) {
        console.error('🚨 Error fetching branch progress:', progressError)
        return null
      }

      console.log('🔍 Progress records fetched:', progressRecords?.length || 0)

      // Fetch all unique asset IDs in a single query using OR conditions
      const assetIds = [...new Set((progressRecords || []).map(p => p.asset_id))]

      let currentAssets = progressRecords || []

      if (assetIds.length > 0) {
        console.log('🔍 DEBUG: About to fetch asset details for', assetIds.length, 'asset IDs')
        console.log('🔍 DEBUG: First 3 asset IDs:', assetIds.slice(0, 3))

        // Build OR query for assets
        const orQuery = assetIds.map(id => `id.eq.${id}`).join(',')
        console.log('🔍 DEBUG: OR query length:', orQuery.length, 'characters')
        console.log('🔍 DEBUG: OR query preview:', orQuery.substring(0, 200) + '...')

        const { data: assetsData, error: assetsError } = await supabase
          .from('assets')
          .select('id, symbol, company_name')
          .or(orQuery)

        console.log('🔍 DEBUG: Assets query completed')
        console.log('🔍 Assets fetched:', assetsData?.length || 0, 'Error:', assetsError)

        if (assetsError) {
          console.error('🚨 ASSET FETCH ERROR:', assetsError)
        }

        if (assetsData) {
          console.log('🔍 DEBUG: Sample asset data:', assetsData.slice(0, 2))
        }

        if (!assetsError && assetsData) {
          // Create a map for quick lookup
          const assetsMap = Object.fromEntries(assetsData.map(a => [a.id, a]))
          console.log('🔍 DEBUG: Assets map created with', Object.keys(assetsMap).length, 'entries')

          // Attach asset data to progress records
          currentAssets = progressRecords.map(p => ({
            ...p,
            assets: assetsMap[p.asset_id] || null
          }))

          console.log('🔍 DEBUG: After join, sample with asset data:', currentAssets.slice(0, 2))
        } else {
          console.error('🚨 DEBUG: Skipping join - assetsError:', assetsError, 'assetsData:', assetsData)
        }
      } else {
        console.log('🔍 DEBUG: No asset IDs to fetch')
      }

      console.log('🔍 Current assets with joined data:', currentAssets?.length || 0)
      console.log('🔍 Sample:', currentAssets?.slice(0, 2))

      // Get parent workflow assets if this is a branched workflow
      let parentAssets: any[] = []
      if (selectedBranch.parent_workflow_id) {
        const { data: parentProgressRecords, error: parentError } = await supabase
          .from('asset_workflow_progress')
          .select('*')
          .eq('workflow_id', selectedBranch.parent_workflow_id)

        if (parentError) {
          console.error('🚨 Error fetching parent assets:', parentError)
        } else if (parentProgressRecords && parentProgressRecords.length > 0) {
          const parentAssetIds = [...new Set(parentProgressRecords.map(p => p.asset_id))]
          const parentOrQuery = parentAssetIds.map(id => `id.eq.${id}`).join(',')

          const { data: parentAssetsData } = await supabase
            .from('assets')
            .select('id, symbol, company_name')
            .or(parentOrQuery)

          if (parentAssetsData) {
            const parentAssetsMap = Object.fromEntries(parentAssetsData.map(a => [a.id, a]))
            parentAssets = parentProgressRecords.map(p => ({
              ...p,
              assets: parentAssetsMap[p.asset_id] || null
            }))
          }
        }

        console.log('🔍 Parent assets fetched:', parentAssets.length, 'assets')
      }

      // Fetch universe rules from the PARENT WORKFLOW's workflow_universe_rules table
      // These rules determine which assets are "rule-based" (vs inherited or manually added)
      let universeRules: any[] = []
      let ruleBasedAssetIds = new Set<string>()

      console.log('🔍 Fetching universe rules from parent workflow:', selectedWorkflow?.id)

      if (selectedWorkflow?.id) {
        // Fetch universe rules from the workflow_universe_rules table
        const { data: workflowRules, error: rulesError } = await supabase
          .from('workflow_universe_rules')
          .select('*')
          .eq('workflow_id', selectedWorkflow.id)
          .eq('is_active', true)
          .order('sort_order')

        console.log('🔍 Universe rules from workflow_universe_rules table:', workflowRules, 'Error:', rulesError)

        if (workflowRules && workflowRules.length > 0) {
          universeRules = workflowRules
          console.log('🔍 Found', universeRules.length, 'active universe rules')

          // Fetch assets that match these universe rules
          for (const rule of universeRules) {
            console.log('🔍 Processing rule:', rule.rule_type, rule.rule_config)

            if (rule.rule_type === 'sector' && rule.rule_config?.sectors) {
              console.log('🔍 Fetching sector assets for sectors:', rule.rule_config.sectors)
              const { data: sectorAssets, error: sectorError } = await supabase
                .from('assets')
                .select('id')
                .in('sector', rule.rule_config.sectors)

              console.log('🔍 Sector assets found:', sectorAssets?.length, 'Error:', sectorError)
              sectorAssets?.forEach(a => ruleBasedAssetIds.add(a.id))
            } else if (rule.rule_type === 'theme' && rule.rule_config?.theme_ids) {
              console.log('🔍 Fetching theme assets for themes:', rule.rule_config.theme_ids)
              // Fetch assets from theme relationships
              const { data: themeAssets, error: themeError } = await supabase
                .from('theme_assets')
                .select('asset_id')
                .in('theme_id', rule.rule_config.theme_ids)

              console.log('🔍 Theme assets found:', themeAssets?.length, 'Error:', themeError)
              themeAssets?.forEach(a => ruleBasedAssetIds.add(a.asset_id))
            }
          }
        }
      }

      console.log('🔍 Rule-based asset IDs:', ruleBasedAssetIds.size, 'assets', Array.from(ruleBasedAssetIds).slice(0, 3))

      // Categorize assets
      const parentAssetIds = new Set(parentAssets.map(a => a.asset_id))
      const currentAssetIds = new Set(currentAssets?.map(a => a.asset_id) || [])

      const activeAssets = (currentAssets || []).filter(a => !a.completed_at)
      const completedAssets = (currentAssets || []).filter(a => a.completed_at)

      // Rule-based assets: match current branch's universe rules
      const ruleBasedAssets = (currentAssets || []).filter(a => ruleBasedAssetIds.has(a.asset_id))

      // Inherited assets: in parent AND in current, but NOT added by current branch's rules
      const originalAssets = (currentAssets || []).filter(a =>
        parentAssetIds.has(a.asset_id) && !ruleBasedAssetIds.has(a.asset_id)
      )

      // Manually added: NOT in parent, NOT from rules
      const addedAssets = (currentAssets || []).filter(a =>
        !parentAssetIds.has(a.asset_id) && !ruleBasedAssetIds.has(a.asset_id)
      )

      // Find deleted assets (in parent but not in current)
      const deletedAssetIds = [...parentAssetIds].filter(id => !currentAssetIds.has(id))
      const deletedAssets = parentAssets.filter(a => deletedAssetIds.includes(a.asset_id))

      const result = {
        all: currentAssets || [],
        active: activeAssets,
        completed: completedAssets,
        original: originalAssets,
        ruleBased: ruleBasedAssets,
        added: addedAssets,
        deleted: deletedAssets
      }

      console.log('🔍 Branch Assets Query Result:', {
        branchId: selectedBranch.id,
        currentAssetsCount: currentAssets?.length || 0,
        parentAssetsCount: parentAssets.length,
        categorized: {
          all: result.all.length,
          active: result.active.length,
          completed: result.completed.length,
          original: result.original.length,
          ruleBased: result.ruleBased.length,
          added: result.added.length,
          deleted: result.deleted.length
        },
        sampleData: result.all.slice(0, 2)
      })

      return result
    },
    enabled: !!selectedBranch?.id && showBranchOverviewModal,
    staleTime: 0, // Temporarily disabled to test asset join fix
    gcTime: 5 * 60 * 1000
  })

  // Query for ALL workflow branches (for hierarchy view)
  const { data: allWorkflowBranches } = useQuery({
    queryKey: ['all-workflow-branches', selectedWorkflow?.id],
    queryFn: async () => {
      if (!selectedWorkflow?.id) return []

      const { data, error} = await supabase
        .from('workflows')
        .select(`
          id,
          name,
          parent_workflow_id,
          source_branch_id,
          branch_suffix,
          branched_at,
          created_at,
          archived,
          archived_at,
          deleted,
          deleted_at,
          status
        `)
        .eq('parent_workflow_id', selectedWorkflow.id)
        .eq('deleted', false)  // Exclude deleted branches from hierarchy view
        .order('branched_at', { ascending: false })

      if (error) {
        console.error('Error fetching all workflow branches:', error)
        throw error
      }

      // For each branch, get asset progress stats
      const branchesWithStats = await Promise.all((data || []).map(async (branch) => {
        const { data: progressData } = await supabase
          .from('asset_workflow_progress')
          .select('id, current_stage_key, completed_at')
          .eq('workflow_id', branch.id)

        const totalAssets = progressData?.length || 0
        const activeAssets = progressData?.filter(p => !p.completed_at).length || 0
        const completedAssets = progressData?.filter(p => p.completed_at).length || 0

        return {
          ...branch,
          totalAssets,
          activeAssets,
          completedAssets
        }
      }))

      console.log('All workflow branches query result:', branchesWithStats)
      return branchesWithStats
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

  // Query for template versions
  const { data: templateVersions, refetch: refetchVersions } = useQuery({
    queryKey: ['template-versions', selectedWorkflow?.id],
    queryFn: async () => {
      if (!selectedWorkflow?.id) {
        console.log('🔍 Template Versions Query: No workflow selected')
        return []
      }

      console.log('🔍 Template Versions Query: Fetching for workflow ID:', selectedWorkflow.id)

      const { data, error } = await supabase
        .from('workflow_template_versions')
        .select('*')
        .eq('workflow_id', selectedWorkflow.id)
        .order('version_number', { ascending: false })

      if (error) {
        console.error('❌ Error fetching template versions:', error)
        throw error
      }

      console.log('✅ Template Versions Query Result:', data)
      console.log('📊 Template Versions Count:', data?.length || 0)

      return data || []
    },
    enabled: !!selectedWorkflow?.id,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000
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

  // Fetch pending access requests for the workflow
  const { data: pendingAccessRequests, refetch: refetchAccessRequests } = useQuery({
    queryKey: ['workflow-access-requests', selectedWorkflow?.id],
    queryFn: async () => {
      if (!selectedWorkflow?.id) return []

      const { data, error } = await supabase
        .from('workflow_access_requests')
        .select(`
          id,
          user_id,
          workflow_id,
          current_permission,
          requested_permission,
          reason,
          status,
          created_at,
          user:users!workflow_access_requests_user_id_fkey(
            id,
            email,
            first_name,
            last_name
          )
        `)
        .eq('workflow_id', selectedWorkflow.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Error fetching access requests:', error)
        throw error
      }

      return data || []
    },
    enabled: !!selectedWorkflow?.id && (selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner'),
    staleTime: 1 * 60 * 1000,
    gcTime: 3 * 60 * 1000
  })

  // Reset universe initialization flag when workflow changes
  useEffect(() => {
    universeInitialized.current = false
  }, [selectedWorkflow?.id])

  // Load universe rules into state when they change - convert from old format to new rule-based format
  useEffect(() => {
    if (!universeRules) {
      setUniverseRulesState([])
      // Mark as initialized even if no rules to allow saving
      setTimeout(() => {
        universeInitialized.current = true
      }, 100)
      return
    }

    const convertedRules: typeof universeRulesState = []

    universeRules.forEach((rule: any, index: number) => {
      // Check if this is a new-format rule (has operator and values in config)
      if (rule.rule_config?.operator && rule.rule_config?.values !== undefined) {
        // New format - directly use the stored values
        convertedRules.push({
          id: rule.id || `rule-${index}`,
          type: rule.rule_type,
          operator: rule.rule_config.operator,
          values: rule.rule_config.values,
          combineWith: index > 0 ? (rule.combination_operator === 'and' ? 'AND' : 'OR') : undefined
        })
      } else {
        // Old format - convert legacy rules
        let values: string[] = []
        let type: 'analyst' | 'list' | 'theme' | 'sector' | 'priority' = 'list'

        switch (rule.rule_type) {
          case 'list':
            type = 'list'
            values = rule.rule_config?.list_ids || []
            break
          case 'theme':
            type = 'theme'
            values = rule.rule_config?.theme_ids || []
            break
          case 'sector':
            type = 'sector'
            values = rule.rule_config?.sectors || []
            break
          case 'priority':
            type = 'priority'
            values = rule.rule_config?.levels || []
            break
          case 'coverage':
            type = 'analyst'
            values = rule.rule_config?.analyst_user_ids || []
            break
        }

        if (values.length > 0) {
          convertedRules.push({
            id: rule.id || `rule-${index}`,
            type,
            operator: 'includes', // Default to includes for now
            values,
            combineWith: index > 0 ? (rule.combination_operator === 'and' ? 'AND' : 'OR') : undefined
          })
        }
      }
    })

    setUniverseRulesState(convertedRules)

    // Mark as initialized after loading rules
    setTimeout(() => {
      universeInitialized.current = true
    }, 100)
  }, [universeRules])

  // Click outside to close changes dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (changesDropdownRef.current && !changesDropdownRef.current.contains(event.target as Node)) {
        setShowChangesList(false)
      }
    }

    if (showChangesList) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }
  }, [showChangesList])

  // Manual save function for universe rules
  const saveUniverseRules = () => {
    if (selectedWorkflow?.id) {
      saveUniverseMutation.mutate({ workflowId: selectedWorkflow.id })
    }
  }

  // Handler to track universe rule changes
  const handleUniverseRulesChange = (newRules: typeof universeRulesState) => {
    // Always update the state first
    setUniverseRulesState(newRules)

    // Only track if in template edit mode
    if (!isTemplateEditMode) {
      return
    }

    // Compare against initial state to detect actual changes
    // Remove all existing universe_updated changes first
    setTemplateChanges(prev => prev.filter(change => change.type !== 'universe_updated'))

    // Now add back only the changes that differ from initial state
    const changes: Array<{ type: 'universe_updated', description: string }> = []

    // Check for added rules (not in initial state)
    const addedRules = newRules.filter(nr => !initialUniverseRules.find(ir => ir.id === nr.id))
    addedRules.forEach(rule => {
      const filterDef = FILTER_TYPE_REGISTRY[rule.type as keyof typeof FILTER_TYPE_REGISTRY]
      changes.push({
        type: 'universe_updated',
        description: `Added ${filterDef?.label || rule.type} filter`
      })
    })

    // Check for removed rules (in initial state but not in new state)
    const removedRules = initialUniverseRules.filter(ir => !newRules.find(nr => nr.id === ir.id))
    removedRules.forEach(rule => {
      const filterDef = FILTER_TYPE_REGISTRY[rule.type as keyof typeof FILTER_TYPE_REGISTRY]
      changes.push({
        type: 'universe_updated',
        description: `Removed ${filterDef?.label || rule.type} filter`
      })
    })

    // Check for modified rules (same id but different values, operator, or combinator)
    newRules.forEach(newRule => {
      const initialRule = initialUniverseRules.find(ir => ir.id === newRule.id)
      if (initialRule) {
        const filterDef = FILTER_TYPE_REGISTRY[newRule.type as keyof typeof FILTER_TYPE_REGISTRY]
        const filterLabel = filterDef?.label || newRule.type

        // Check if values changed
        if (JSON.stringify(initialRule.values) !== JSON.stringify(newRule.values)) {
          changes.push({
            type: 'universe_updated',
            description: `Modified ${filterLabel} filter values`
          })
        }
        // Check if operator changed
        if (initialRule.operator !== newRule.operator) {
          changes.push({
            type: 'universe_updated',
            description: `Changed ${filterLabel} filter from ${initialRule.operator} to ${newRule.operator}`
          })
        }
        // Check if combinator changed (AND/OR)
        if (initialRule.combineWith !== newRule.combineWith) {
          changes.push({
            type: 'universe_updated',
            description: `Changed ${filterLabel} logic from ${initialRule.combineWith || 'OR'} to ${newRule.combineWith || 'OR'}`
          })
        }
      }
    })

    // Add all changes with timestamps
    if (changes.length > 0) {
      setTemplateChanges(prev => [
        ...prev,
        ...changes.map(change => ({
          ...change,
          timestamp: Date.now()
        }))
      ])
    }
  }

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
      `).eq('archived', false).eq('deleted', false).is('parent_workflow_id', null) // Only show non-archived, non-deleted workflow templates (not branches)

      switch (filterBy) {
        case 'my':
          workflowQuery = workflowQuery.eq('created_by', userId)
          break
        case 'shared':
          // Get shared workflow IDs (as collaborator)
          const { data: sharedCollabIds } = await supabase
            .from('workflow_collaborations')
            .select('workflow_id')
            .eq('user_id', userId)

          // Get workflow IDs where user is a stakeholder
          const { data: sharedStakeholderIds } = await supabase
            .from('workflow_stakeholders')
            .select('workflow_id')
            .eq('user_id', userId)

          const sharedCollaboratorIds = sharedCollabIds?.map(s => s.workflow_id) || []
          const sharedStakeholderWorkflowIds = sharedStakeholderIds?.map(s => s.workflow_id) || []
          const ids = [...new Set([...sharedCollaboratorIds, ...sharedStakeholderWorkflowIds])]

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
          // Get shared workflow IDs (as collaborator)
          const { data: allCollabIds } = await supabase
            .from('workflow_collaborations')
            .select('workflow_id')
            .eq('user_id', userId)

          // Get workflow IDs where user is a stakeholder
          const { data: allStakeholderIds } = await supabase
            .from('workflow_stakeholders')
            .select('workflow_id')
            .eq('user_id', userId)

          const allCollaboratorIds = allCollabIds?.map(s => s.workflow_id) || []
          const allStakeholderWorkflowIds = allStakeholderIds?.map(s => s.workflow_id) || []
          const allIds = [...new Set([...allCollaboratorIds, ...allStakeholderWorkflowIds])]

          // Show only user's workflows + shared workflows + stakeholder workflows
          const sharedFilter = allIds.length > 0 ? `,id.in.(${allIds.join(',')})` : ''
          workflowQuery = workflowQuery.or(`created_by.eq.${userId}${sharedFilter}`)
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

      // Get active template versions for all workflows
      const { data: activeVersions } = await supabase
        .from('workflow_template_versions')
        .select('workflow_id, version_number, id')
        .eq('is_active', true)

      // Create a map of workflow_id to active version number
      const activeVersionMap = new Map(
        (activeVersions || []).map(v => [v.workflow_id, v.version_number])
      )

      // Get user's collaborations with permissions
      const { data: collaborations } = await supabase
        .from('workflow_collaborations')
        .select('workflow_id, permission')
        .eq('user_id', userId)

      // Create a map of workflow_id to collaboration permission
      const collaborationMap = new Map(
        (collaborations || []).map(c => [c.workflow_id, c.permission])
      )

      // Get workflows where user is a stakeholder
      const { data: stakeholderWorkflows } = await supabase
        .from('workflow_stakeholders')
        .select('workflow_id')
        .eq('user_id', userId)

      // Create a set of workflow IDs where user is stakeholder
      const stakeholderWorkflowIds = new Set(
        (stakeholderWorkflows || []).map(s => s.workflow_id)
      )

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
        } else if (stakeholderWorkflowIds.has(workflow.id)) {
          // User is a stakeholder - read-only access
          userPermission = 'read'
        } else if (collaborationMap.has(workflow.id)) {
          // User is a collaborator - use their permission level
          userPermission = collaborationMap.get(workflow.id) as 'read' | 'write' | 'admin'
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
          usage_stats: workflowUsage, // Include detailed usage stats for progress calculation
          active_version_number: activeVersionMap.get(workflow.id) // Add active version number
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

      // Get shared archived workflow IDs (as collaborator)
      const { data: sharedArchivedIds } = await supabase
        .from('workflow_collaborations')
        .select('workflow_id')
        .eq('user_id', userId)

      // Get workflow IDs where user is a stakeholder
      const { data: archivedStakeholderIds } = await supabase
        .from('workflow_stakeholders')
        .select('workflow_id')
        .eq('user_id', userId)

      const collaboratorIds = sharedArchivedIds?.map(s => s.workflow_id) || []
      const stakeholderIds = archivedStakeholderIds?.map(s => s.workflow_id) || []
      const sharedIds = [...new Set([...collaboratorIds, ...stakeholderIds])]
      const sharedFilter = sharedIds.length > 0 ? `,id.in.(${sharedIds.join(',')})` : ''

      // Get archived workflows that user has access to (owned or shared)
      // Exclude deleted workflows from the archived list
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
        .is('deleted', false) // Don't show deleted workflows in archived section
        .is('parent_workflow_id', null) // Only show workflow templates, not branches
        .or(`created_by.eq.${userId}${sharedFilter}`)
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

      return archivedWorkflowsWithStats
    }
  })

  // Restore selected workflow when workflows are loaded
  useEffect(() => {
    if (workflows && workflows.length > 0) {
      const savedState = TabStateManager.loadTabState(tabId)
      if (savedState?.selectedWorkflowId && !selectedWorkflow) {
        // Check both active and archived workflows
        const workflowToRestore = workflows.find(w => w.id === savedState.selectedWorkflowId) ||
          archivedWorkflows?.find(w => w.id === savedState.selectedWorkflowId)
        if (workflowToRestore) {
          setSelectedWorkflow(workflowToRestore)
        }
      }
    }
  }, [workflows, archivedWorkflows, tabId, selectedWorkflow])

  // Update selectedWorkflow when workflows data changes (to pick up updated stages)
  useEffect(() => {
    if (selectedWorkflow && workflows) {
      // Check both active and archived workflows for updates
      const updatedWorkflow = workflows.find(w => w.id === selectedWorkflow.id) ||
        archivedWorkflows?.find(w => w.id === selectedWorkflow.id)
      if (updatedWorkflow) {
        setSelectedWorkflow(updatedWorkflow)
      }
    }
  }, [workflows, archivedWorkflows])

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

      // Always use soft delete - mark as deleted but keep data for recovery
      const { error } = await supabase
        .from('workflows')
        .update({
          deleted: true,
          deleted_at: new Date().toISOString(),
          deleted_by: user?.id
        })
        .eq('id', workflowId)

      if (error) throw error
      return { workflowId, isPermanent: false }
    },
    onSuccess: async (result) => {
      // Invalidate queries to refetch data
      await queryClient.invalidateQueries({ queryKey: ['workflows-full'] })
      await queryClient.invalidateQueries({ queryKey: ['workflows-archived'] })

      // Close the workflow view and clear selection
      setSelectedWorkflow(null)
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

  const unarchiveWorkflowMutation = useMutation({
    mutationFn: async (workflowId: string) => {
      const { error } = await supabase
        .from('workflows')
        .update({
          archived: false,
          archived_at: null,
          archived_by: null
        })
        .eq('id', workflowId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows-full'] })
      queryClient.invalidateQueries({ queryKey: ['workflows-archived'] })
      setSelectedWorkflow(null)
      setShowUnarchiveModal(false)
      setWorkflowToUnarchive(null)
    },
    onError: (error) => {
      console.error('Error unarchiving workflow:', error)
      alert('Failed to unarchive workflow. Please try again.')
      setShowUnarchiveModal(false)
      setWorkflowToUnarchive(null)
    }
  })

  const approveAccessRequestMutation = useMutation({
    mutationFn: async ({ requestId, userId, permission, workflowId }: { requestId: string, userId: string, permission: string, workflowId: string }) => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      // Add or update collaboration
      const { error: collabError } = await supabase
        .from('workflow_collaborations')
        .upsert({
          workflow_id: workflowId,
          user_id: userId,
          permission: permission,
          invited_by: user.id
        }, {
          onConflict: 'workflow_id,user_id'
        })

      if (collabError) throw collabError

      // Update request status
      const { error: requestError } = await supabase
        .from('workflow_access_requests')
        .update({ status: 'approved' })
        .eq('id', requestId)

      if (requestError) throw requestError
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-access-requests'] })
      queryClient.invalidateQueries({ queryKey: ['workflow-collaborators'] })
      refetchAccessRequests()
      refetchCollaborators()
    },
    onError: (error) => {
      console.error('Error approving access request:', error)
      alert('Failed to approve access request. Please try again.')
    }
  })

  const rejectAccessRequestMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabase
        .from('workflow_access_requests')
        .update({ status: 'rejected' })
        .eq('id', requestId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-access-requests'] })
      refetchAccessRequests()
    },
    onError: (error) => {
      console.error('Error rejecting access request:', error)
      alert('Failed to reject access request. Please try again.')
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

  const createVersionMutation = useMutation({
    mutationFn: async ({ workflowId, versionName, description, versionType, workflowData }: {
      workflowId: string
      versionName: string
      description: string
      versionType: 'major' | 'minor'
      workflowData: any
    }) => {
      // First create the template version
      const { data: versionId, error: versionError } = await supabase
        .rpc('create_new_template_version', {
          p_workflow_id: workflowId,
          p_version_name: versionName,
          p_description: description,
          p_version_type: versionType
        })

      if (versionError) throw versionError

      // If this is a major version, create a new workflow record (template tile)
      let newWorkflowId = workflowId
      if (versionType === 'major') {
        const { data: newWorkflow, error: workflowError } = await supabase
          .from('workflows')
          .insert({
            name: `${workflowData.name} v${versionName}`,
            description: workflowData.description,
            color: workflowData.color,
            parent_workflow_id: workflowData.parent_workflow_id || workflowId, // Link to original template
            template_version_id: versionId,
            created_by: workflowData.created_by,
            project_id: workflowData.project_id
          })
          .select()
          .single()

        if (workflowError) throw workflowError
        newWorkflowId = newWorkflow.id

        // Copy stages to new workflow
        const { error: stagesError } = await supabase
          .from('workflow_stages')
          .insert(
            workflowData.stages.map((stage: any) => ({
              workflow_id: newWorkflowId,
              stage_key: stage.stage_key,
              stage_label: stage.stage_label,
              stage_description: stage.stage_description,
              stage_color: stage.stage_color,
              stage_icon: stage.stage_icon,
              sort_order: stage.sort_order
            }))
          )

        if (stagesError) throw stagesError

        // Copy checklist templates
        if (workflowData.checklists && workflowData.checklists.length > 0) {
          const { error: checklistsError } = await supabase
            .from('workflow_checklist_templates')
            .insert(
              workflowData.checklists.map((checklist: any) => ({
                workflow_id: newWorkflowId,
                stage_id: checklist.stage_id,
                item_id: checklist.item_id,
                item_text: checklist.item_text,
                sort_order: checklist.sort_order,
                is_required: checklist.is_required
              }))
            )

          if (checklistsError) throw checklistsError
        }

        // Copy automation rules
        if (workflowData.rules && workflowData.rules.length > 0) {
          const { error: rulesError } = await supabase
            .from('workflow_automation_rules')
            .insert(
              workflowData.rules.map((rule: any) => ({
                workflow_id: newWorkflowId,
                rule_name: rule.rule_name,
                rule_type: rule.rule_type,
                condition_type: rule.condition_type,
                condition_value: rule.condition_value,
                action_type: rule.action_type,
                action_value: rule.action_value,
                is_active: rule.is_active
              }))
            )

          if (rulesError) throw rulesError
        }

        // Copy universe rules if they exist
        const { data: universeRules } = await supabase
          .from('workflow_universe_rules')
          .select('*')
          .eq('workflow_id', workflowId)

        if (universeRules && universeRules.length > 0) {
          const { error: universeError } = await supabase
            .from('workflow_universe_rules')
            .insert(
              universeRules.map(rule => ({
                workflow_id: newWorkflowId,
                filter_type: rule.filter_type,
                filter_operator: rule.filter_operator,
                filter_values: rule.filter_values,
                combinator: rule.combinator,
                order_index: rule.order_index
              }))
            )

          if (universeError) throw universeError
        }
      }

      return { data: versionId, versionName, versionType, newWorkflowId }
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['template-versions'] })
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      refetchVersions()
      setShowCreateVersion(false)

      // Calculate the new version number
      const currentMaxVersion = templateVersions?.length ? Math.max(...templateVersions.map(v => v.version_number)) : 0
      const newVersionNumber = currentMaxVersion + 1

      // If major version, navigate to the new workflow
      if (result.versionType === 'major' && result.newWorkflowId) {
        // Refetch workflows to get the new one
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ['workflows'] })
        }, 500)
      }

      // Show success modal
      setCreatedVersionInfo({
        versionNumber: newVersionNumber,
        versionName: result.versionName,
        versionType: result.versionType
      })
      setShowVersionCreated(true)
    },
    onError: (error: any) => {
      console.error('Error creating template version:', error)
      console.error('Error details:', {
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        code: error?.code
      })
      alert(`Failed to create template version: ${error?.message || 'Please try again.'}`)
    }
  })

  const activateVersionMutation = useMutation({
    mutationFn: async (versionId: string) => {
      const { data, error } = await supabase
        .rpc('activate_template_version', {
          p_version_id: versionId
        })

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['template-versions'] })
      queryClient.invalidateQueries({ queryKey: ['workflow-stages', selectedWorkflow?.id] })
      queryClient.invalidateQueries({ queryKey: ['workflow-checklists', selectedWorkflow?.id] })
      queryClient.invalidateQueries({ queryKey: ['workflow-automation-rules', selectedWorkflow?.id] })
      queryClient.invalidateQueries({ queryKey: ['workflow-universe-rules', selectedWorkflow?.id] })
      refetchVersions()
      alert('Version activated successfully! The workflow has been updated to use this version.')
    },
    onError: (error: any) => {
      console.error('Error activating template version:', error)
      alert(`Failed to activate version: ${error?.message || 'Please try again.'}`)
    }
  })

  const handleCreateVersion = (versionName: string, versionType: 'major' | 'minor', description: string) => {
    if (!selectedWorkflow) return

    // First save workflow metadata if it has changed
    if (editingWorkflowData.name.trim() &&
        (editingWorkflowData.name !== selectedWorkflow.name ||
         editingWorkflowData.description !== selectedWorkflow.description ||
         editingWorkflowData.color !== selectedWorkflow.color)) {
      updateWorkflowMutation.mutate({
        workflowId: selectedWorkflow.id,
        updates: {
          name: editingWorkflowData.name.trim(),
          description: editingWorkflowData.description.trim(),
          color: editingWorkflowData.color
        }
      })
    }

    // Save universe rules if there are any changes
    saveUniverseRules()

    // Prepare workflow data for major version creation
    const workflowData = {
      name: editingWorkflowData.name || selectedWorkflow.name,
      description: editingWorkflowData.description || selectedWorkflow.description,
      color: editingWorkflowData.color || selectedWorkflow.color,
      parent_workflow_id: selectedWorkflow.parent_workflow_id,
      created_by: selectedWorkflow.created_by,
      project_id: selectedWorkflow.project_id,
      stages: selectedWorkflow.stages || [],
      checklists: workflowChecklistTemplates?.filter(c => c.workflow_id === selectedWorkflow.id) || [],
      rules: automationRules?.filter(r => r.workflow_id === selectedWorkflow.id) || []
    }

    // Then create the version
    createVersionMutation.mutate({
      workflowId: selectedWorkflow.id,
      versionName,
      description,
      versionType,
      workflowData
    })

    // Clear changes and exit edit mode
    setTemplateChanges([])
    setIsTemplateEditMode(false)
  }

  // Helper function to add a change to the tracking list
  const trackChange = (type: typeof templateChanges[0]['type'], description: string) => {
    setTemplateChanges(prev => [...prev, {
      type,
      description,
      timestamp: Date.now()
    }])
  }

  // Detect if changes constitute a major or minor version
  const detectVersionType = (): 'major' | 'minor' => {
    // Major changes: Any stage modifications (added, edited, deleted, reordered)
    const majorChangeTypes = [
      'stage_added',
      'stage_edited',
      'stage_deleted',
      'stage_reordered'
    ]

    // Minor changes: Cadence, universe, checklists, automation rules, workflow metadata
    const hasMajorChanges = templateChanges.some(change =>
      majorChangeTypes.includes(change.type)
    )

    return hasMajorChanges ? 'major' : 'minor'
  }

  // Enter template edit mode
  const enterTemplateEditMode = () => {
    setIsTemplateEditMode(true)
    setTemplateChanges([])
    // Initialize editing workflow data
    if (selectedWorkflow) {
      setEditingWorkflowData({
        name: selectedWorkflow.name,
        description: selectedWorkflow.description,
        color: selectedWorkflow.color
      })
    }
    // Capture initial universe rules state for comparison
    setInitialUniverseRules(JSON.parse(JSON.stringify(universeRulesState)))
  }

  // Exit template edit mode and discard changes
  const exitTemplateEditMode = () => {
    // Now handled by ConfirmDialog modal
    setIsTemplateEditMode(false)
    setTemplateChanges([])
    // Refetch data to reset any optimistic updates
    queryClient.invalidateQueries({ queryKey: ['workflows'] })
    queryClient.invalidateQueries({ queryKey: ['workflow-stages'] })
    queryClient.invalidateQueries({ queryKey: ['workflow-checklist-templates'] })
    queryClient.invalidateQueries({ queryKey: ['workflow-automation-rules'] })
  }

  // Save changes and create version
  const saveTemplateChanges = () => {
    if (templateChanges.length === 0) {
      alert('No changes to save')
      return
    }
    setShowCreateVersion(true)
  }

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
      const stageName = selectedWorkflow?.stages?.find(s => s.id === result.stageId)?.name || result.updates.name || 'Stage'

      // Build detailed description of what changed
      const changes: string[] = []
      if (result.updates.name) changes.push('name')
      if (result.updates.stage_description) changes.push('description')
      if (result.updates.stage_color) changes.push('color')
      if (result.updates.standard_deadline_days !== undefined) changes.push('deadline')

      const changesText = changes.length > 0 ? ` (${changes.join(', ')})` : ''
      trackChange('stage_edited', `Edited "${stageName}" stage${changesText}`)
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
        trackChange('stage_added', `Added new stage: ${newStage.name}`)
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
        const deletedStage = selectedWorkflow.stages?.find(s => s.id === result.stageId)
        setSelectedWorkflow({
          ...selectedWorkflow,
          stages: selectedWorkflow.stages?.filter(s => s.id !== result.stageId) || []
        })
        if (deletedStage) {
          trackChange('stage_deleted', `Deleted stage: ${deletedStage.name}`)
        }
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
    mutationFn: async ({ stages, movedStageName, direction }: { stages: { id: string, sort_order: number }[], movedStageName?: string, direction?: 'up' | 'down' }) => {
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

      return { stages, movedStageName, direction }
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

      // Create detailed change description
      if (result.movedStageName && result.direction) {
        trackChange('stage_reordered', `Moved "${result.movedStageName}" stage ${result.direction}`)
      } else {
        trackChange('stage_reordered', 'Reordered workflow stages')
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
      return { itemId, updates }
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['workflow-checklist-templates'] })
      const itemName = result.updates.name || 'checklist item'

      // Build detailed description of what changed
      const changes: string[] = []
      if (result.updates.name) changes.push('name')
      if (result.updates.description) changes.push('description')
      if (result.updates.item_type) changes.push('type')

      const changesText = changes.length > 0 ? ` (${changes.join(', ')})` : ''
      trackChange('checklist_edited', `Edited "${itemName}"${changesText}`)
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
      return { item }
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['workflow-checklist-templates'] })
      setShowAddChecklistItem(null)
      trackChange('checklist_added', `Added checklist item: ${result.item.name}`)
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
      return { itemId }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-checklist-templates'] })
      trackChange('checklist_deleted', 'Deleted checklist item')
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
      trackChange('checklist_edited', 'Reordered checklist items')
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
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['workflow-automation-rules'] })
      setShowAddRuleModal(false)
      trackChange('rule_added', `Added automation rule: ${data.rule_name}`)
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
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['workflow-automation-rules'] })
      setEditingRule(null)
      trackChange('rule_edited', `Edited automation rule: ${data.rule_name}`)
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

      // Determine which workflow to copy from
      // If sourceBranchId is provided, copy from that branch
      // Otherwise, copy from the template (workflowId)
      const sourceId = sourceBranchId || workflowId

      // Get the source workflow data
      const { data: sourceWorkflow, error: workflowError } = await supabase
        .from('workflows')
        .select('*')
        .eq('id', sourceId)
        .single()

      if (workflowError) throw workflowError

      // Determine the root parent workflow ID
      // If source is a branch, use its parent; if source is root, use itself
      const rootParentId = sourceWorkflow.parent_workflow_id || workflowId

      // Get the active template version for the root workflow
      const { data: activeVersion } = await supabase
        .from('workflow_template_versions')
        .select('id, version_number')
        .eq('workflow_id', rootParentId)
        .eq('is_active', true)
        .single()

      // Create new workflow
      const { data: newWorkflow, error: createError} = await supabase
        .from('workflows')
        .insert({
          name: branchName,
          description: sourceWorkflow.description,
          color: sourceWorkflow.color,
          cadence_days: sourceWorkflow.cadence_days,
          status: 'active', // New branches are active by default
          is_public: false, // Always private - users must be explicitly invited
          created_by: userId,
          parent_workflow_id: rootParentId, // Always point to root template
          source_branch_id: sourceBranchId || null,
          branch_suffix: branchSuffix,
          branched_at: new Date().toISOString(),
          template_version_id: activeVersion?.id || null,
          template_version_number: activeVersion?.version_number || null
        })
        .select()
        .single()

      if (createError) throw createError

      // Get universe rules from the root template workflow
      const { data: universeRules } = await supabase
        .from('workflow_universe_rules')
        .select('*')
        .eq('workflow_id', rootParentId)

      // Automatically add assets based on universe rules
      if (universeRules && universeRules.length > 0) {
        console.log(`🌌 Found ${universeRules.length} universe rules, adding matching assets to new branch`)

        const { addAssetsToWorkflowByUniverse } = await import('../lib/universeAssetMatcher')
        const rules = universeRules.map(r => {
          // Extract values from rule_config based on rule_type
          let values: string[] = []
          const config = r.rule_config || {}

          switch (r.rule_type) {
            case 'coverage':
              values = config.analyst_user_ids || []
              break
            case 'list':
              values = config.list_ids || []
              break
            case 'theme':
              values = config.theme_ids || []
              break
            case 'sector':
              values = config.sectors || []
              break
            case 'priority':
              values = config.levels || []
              break
            default:
              values = config.values || []
          }

          return {
            id: r.id,
            type: r.rule_type === 'coverage' ? 'analyst' : r.rule_type,
            values: values,
            operator: r.combination_operator
          }
        })

        const result = await addAssetsToWorkflowByUniverse(
          newWorkflow.id,
          rules,
          'OR' // Default to OR operator for combining rules
        )

        console.log(`✅ Added ${result.added} assets to workflow branch, ${result.errors} errors`)
      }

      return newWorkflow
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-branches'] })
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      queryClient.invalidateQueries({ queryKey: ['asset-all-workflows'] })
      queryClient.invalidateQueries({ queryKey: ['asset-available-workflows'] })
      setShowCreateBranchModal(false)
    },
    onError: (error) => {
      console.error('Error creating workflow branch:', error)
      alert('Failed to create workflow branch. Please try again.')
    }
  })

  const closeBranchMutation = useMutation({
    mutationFn: async (branchId: string) => {
      const { data, error } = await supabase
        .from('workflows')
        .update({ status: 'inactive' })
        .eq('id', branchId)
        .select()

      if (error) {
        console.error('Error updating branch status:', error)
        throw error
      }
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-branches'] })
      setBranchToEnd(null)
    },
    onError: (error: any) => {
      console.error('Error ending workflow branch:', error)
      alert(`Failed to end workflow branch: ${error.message || 'Unknown error'}`)
    }
  })

  const continueBranchMutation = useMutation({
    mutationFn: async (branchId: string) => {
      const { data, error } = await supabase
        .from('workflows')
        .update({ status: 'active' })
        .eq('id', branchId)
        .select()

      if (error) {
        console.error('Error updating branch status:', error)
        throw error
      }
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-branches'] })
      setBranchToContinue(null)
    },
    onError: (error: any) => {
      console.error('Error continuing workflow branch:', error)
      alert(`Failed to continue workflow branch: ${error.message || 'Unknown error'}`)
    }
  })

  const archiveBranchMutation = useMutation({
    mutationFn: async (branchId: string) => {
      const { data: { user } } = await supabase.auth.getUser()

      const { data, error } = await supabase
        .from('workflows')
        .update({
          archived: true,
          archived_at: new Date().toISOString(),
          archived_by: user?.id,
          status: 'inactive'
        })
        .eq('id', branchId)
        .select()

      if (error) {
        console.error('Error archiving branch:', error)
        throw error
      }
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-branches'] })
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      setBranchToArchive(null)
    },
    onError: (error: any) => {
      console.error('Error archiving workflow branch:', error)
      alert(`Failed to archive workflow branch: ${error.message || 'Unknown error'}`)
    }
  })

  const deleteBranchMutation = useMutation({
    mutationFn: async (branchId: string) => {
      const { data: { user } } = await supabase.auth.getUser()

      console.log('Deleting branch:', branchId)

      const { data, error } = await supabase
        .from('workflows')
        .update({
          deleted: true,
          deleted_at: new Date().toISOString(),
          deleted_by: user?.id,
          status: 'inactive'
        })
        .eq('id', branchId)
        .select()

      console.log('Delete branch result:', { data, error })

      if (error) {
        console.error('Error deleting branch:', error)
        throw error
      }
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-branches'] })
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      setBranchToDelete(null)
    },
    onError: (error: any) => {
      console.error('Error deleting workflow branch:', error)
      alert(`Failed to delete workflow branch: ${error.message || 'Unknown error'}`)
    }
  })

  const unarchiveBranchMutation = useMutation({
    mutationFn: async (branchId: string) => {
      const { data, error } = await supabase
        .from('workflows')
        .update({
          archived: false,
          archived_at: null,
          archived_by: null
        })
        .eq('id', branchId)
        .select()

      if (error) {
        console.error('Error unarchiving branch:', error)
        throw error
      }
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-branches'] })
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
    },
    onError: (error: any) => {
      console.error('Error unarchiving workflow branch:', error)
      alert(`Failed to unarchive workflow branch: ${error.message || 'Unknown error'}`)
    }
  })

  const restoreBranchMutation = useMutation({
    mutationFn: async (branchId: string) => {
      const { data, error } = await supabase
        .from('workflows')
        .update({
          deleted: false,
          deleted_at: null,
          deleted_by: null
        })
        .eq('id', branchId)
        .select()

      if (error) {
        console.error('Error restoring branch:', error)
        throw error
      }
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-branches'] })
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
    },
    onError: (error: any) => {
      console.error('Error restoring workflow branch:', error)
      alert(`Failed to restore workflow branch: ${error.message || 'Unknown error'}`)
    }
  })

  const updateBranchSuffixMutation = useMutation({
    mutationFn: async ({ branchId, newSuffix }: { branchId: string, newSuffix: string }) => {
      const { data, error } = await supabase
        .from('workflows')
        .update({ branch_suffix: newSuffix })
        .eq('id', branchId)
        .select()

      if (error) {
        console.error('Error updating branch suffix:', error)
        throw error
      }
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-branches'] })
      setEditingBranchSuffix(null)
      setBranchSuffixValue('')
    },
    onError: (error: any) => {
      console.error('Error updating branch suffix:', error)
      alert(`Failed to update branch suffix: ${error.message || 'Unknown error'}`)
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
      if (data && data.length > 0 && data[0].rule_name) {
        trackChange('rule_deleted', `Deleted automation rule: ${data[0].rule_name}`)
      } else {
        trackChange('rule_deleted', 'Deleted automation rule')
      }
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

  // Universe configuration mutation - updated for flexible filter approach
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

      // Convert rules to database format
      const rulesToInsert: any[] = []

      universeRulesState.forEach((rule, index) => {
        let rule_type: string = rule.type
        let rule_config: any = {}

        // Convert legacy types to database format
        switch (rule.type) {
          case 'analyst':
            rule_type = 'coverage'
            rule_config = { analyst_user_ids: Array.isArray(rule.values) ? rule.values : [rule.values] }
            break
          case 'list':
            rule_type = 'list'
            rule_config = { list_ids: Array.isArray(rule.values) ? rule.values : [rule.values] }
            break
          case 'theme':
            rule_type = 'theme'
            rule_config = { theme_ids: Array.isArray(rule.values) ? rule.values : [rule.values], include_assets: true }
            break
          case 'sector':
            rule_type = 'sector'
            rule_config = { sectors: Array.isArray(rule.values) ? rule.values : [rule.values] }
            break
          case 'priority':
            rule_type = 'priority'
            rule_config = { levels: Array.isArray(rule.values) ? rule.values : [rule.values] }
            break
          default:
            // For new filter types, store the operator and values directly
            rule_config = {
              operator: rule.operator,
              values: rule.values
            }
        }

        rulesToInsert.push({
          workflow_id: workflowId,
          rule_type,
          rule_config,
          combination_operator: rule.combineWith?.toLowerCase() || 'or',
          sort_order: index,
          is_active: true,
          created_by: userId
        })
      })

      // Insert new rules if there are any
      if (rulesToInsert.length > 0) {
        const { error: insertError } = await supabase
          .from('workflow_universe_rules')
          .insert(rulesToInsert)

        if (insertError) throw insertError
      }

      return rulesToInsert
    },
    onSuccess: (rules) => {
      queryClient.invalidateQueries({ queryKey: ['workflow-universe-rules', selectedWorkflow?.id] })
      // Auto-save: silent success
      trackChange('universe_updated', `Updated universe rules (${rules.length} rule${rules.length !== 1 ? 's' : ''})`)
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

      // Create initial Version 1 for the new workflow
      try {
        const { error: versionError } = await supabase
          .rpc('create_initial_template_version', {
            p_workflow_id: createdWorkflow.id
          })

        if (versionError) {
          console.error('Error creating initial version:', versionError)
        } else {
          console.log('✅ Initial version created for workflow')
        }
      } catch (error) {
        console.error('Error creating initial version:', error)
      }

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
    <div className="fixed inset-0 top-32 flex bg-gray-50">
      {/* Left Sidebar */}
      <div className="w-80 bg-white border-r border-gray-200 flex flex-col h-full">
        {/* Header */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-bold text-gray-900">Workflows</h1>
            <div className="flex items-center space-x-2">
              <Button
                onClick={() => setSelectedWorkflow(null)}
                size="sm"
                variant="outline"
                title="Workflow Dashboard"
              >
                <Home className="w-4 h-4" />
              </Button>
              <Button onClick={handleCreateWorkflow} size="sm">
                <Plus className="w-4 h-4" />
              </Button>
            </div>
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
          {isLoading ? (
            /* Loading skeleton for sidebar */
            <div className="p-4 space-y-3 animate-pulse">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="p-3 border border-gray-200 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className="w-3 h-3 bg-gray-300 rounded-full"></div>
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                      <div className="h-3 bg-gray-200 rounded w-full"></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
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

              {filteredWorkflows.length === 0 && !isLoading && (
                <div className="p-4 text-center text-gray-500 text-sm">
                  {searchTerm ? 'No workflows found' : 'No workflows available'}
                </div>
              )}

              {/* Archived Workflows Section */}
              {archivedWorkflows && archivedWorkflows.length > 0 && !isLoading && (
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
            </>
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
          <div className="flex-1 flex flex-col h-full overflow-hidden">
            {/* Workflow Header */}
            <div className="bg-white border-b border-gray-200 px-6 py-4">
              <div className="flex items-center space-x-4">
                {isTemplateEditMode ? (
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
                                  const oldColor = editingWorkflowData.color
                                  setEditingWorkflowData(prev => ({ ...prev, color }))
                                  setShowColorPicker(false)
                                  if (selectedWorkflow && color !== oldColor) {
                                    trackChange('workflow_updated', `Changed workflow color`)
                                  }
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

                    {/* Editing Inputs - Template Edit Mode Style */}
                    <div className="flex-1 flex items-center justify-between">
                      <div className="flex flex-col">
                        <input
                          type="text"
                          value={editingWorkflowData.name}
                          onChange={(e) => setEditingWorkflowData(prev => ({ ...prev, name: e.target.value }))}
                          onBlur={(e) => {
                            if (selectedWorkflow && e.target.value.trim() !== selectedWorkflow.name) {
                              trackChange('workflow_updated', `Changed workflow name from "${selectedWorkflow.name}" to "${e.target.value.trim()}"`)
                            }
                          }}
                          className="block px-2 py-0.5 text-xl font-bold text-gray-900 bg-white border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent mb-1"
                          placeholder="Workflow name"
                          style={{ width: '500px' }}
                        />
                        <input
                          type="text"
                          value={editingWorkflowData.description}
                          onChange={(e) => setEditingWorkflowData(prev => ({ ...prev, description: e.target.value }))}
                          onBlur={(e) => {
                            if (selectedWorkflow && e.target.value.trim() !== selectedWorkflow.description) {
                              trackChange('workflow_updated', `Changed workflow description`)
                            }
                          }}
                          className="block px-2 py-0.5 text-sm text-gray-600 bg-white border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                          placeholder="Description"
                          style={{ width: '500px' }}
                        />
                      </div>

                      <div className="flex items-center space-x-3">
                        {/* Changes Counter with Dropdown */}
                        <div className="relative" ref={changesDropdownRef}>
                          <button
                            onClick={() => setShowChangesList(!showChangesList)}
                            className="flex items-center space-x-2 px-3 py-1.5 bg-amber-100 text-amber-800 rounded-lg hover:bg-amber-200 transition-colors border border-amber-300"
                            title="View changes"
                          >
                            <AlertCircle className="w-4 h-4" />
                            <span className="text-sm font-medium">{templateChanges.length} change{templateChanges.length !== 1 ? 's' : ''}</span>
                            <ChevronDown className={`w-4 h-4 transition-transform ${showChangesList ? 'rotate-180' : ''}`} />
                          </button>

                          {/* Changes Dropdown */}
                          {showChangesList && templateChanges.length > 0 && (
                            <div className="absolute right-0 mt-2 w-96 bg-white rounded-lg shadow-xl border border-gray-200 z-50 max-h-96 overflow-y-auto">
                              <div className="p-3 border-b border-gray-200 bg-gray-50">
                                <h3 className="text-sm font-semibold text-gray-900">Pending Changes</h3>
                              </div>
                              <div className="p-2">
                                {templateChanges.map((change, idx) => (
                                  <div key={idx} className="px-3 py-2 hover:bg-gray-50 rounded text-sm">
                                    <div className="flex items-start space-x-2">
                                      <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                                        change.type.includes('added') ? 'bg-green-500' :
                                        change.type.includes('deleted') ? 'bg-red-500' :
                                        'bg-blue-500'
                                      }`} />
                                      <div className="flex-1">
                                        <p className="text-gray-900">{change.description}</p>
                                        <p className="text-xs text-gray-500 mt-0.5">
                                          {new Date(change.timestamp).toLocaleTimeString()}
                                        </p>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Cancel Button */}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowCancelConfirmation(true)}
                          className="flex items-center space-x-2"
                        >
                          <X className="w-4 h-4" />
                          <span>Cancel</span>
                        </Button>

                        {/* Save Button */}
                        <Button
                          size="sm"
                          onClick={saveTemplateChanges}
                          disabled={templateChanges.length === 0}
                          className="flex items-center space-x-2"
                        >
                          <Save className="w-4 h-4" />
                          <span>Save & Version</span>
                        </Button>
                      </div>
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
                      </div>
                      <div className="flex items-center space-x-3">
                        {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={enterTemplateEditMode}
                            className="flex items-center space-x-2"
                          >
                            <Pencil className="w-4 h-4" />
                            <span>Edit Template</span>
                          </Button>
                        )}
                      </div>
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
                  { id: 'branches', label: 'Branches', icon: Network },
                  { id: 'models', label: 'Models', icon: Copy }
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

                  {/* Template Version Information */}
                  <Card>
                    <div className="p-6">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center space-x-2">
                          <GitBranch className="w-5 h-5 text-indigo-600" />
                          <h3 className="text-lg font-semibold text-gray-900">Template Version</h3>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setShowTemplateVersions(true)}
                        >
                          <Eye className="w-4 h-4 mr-2" />
                          View All Versions
                        </Button>
                      </div>

                      {templateVersions && templateVersions.length > 0 ? (
                        <div className="space-y-3">
                          {(() => {
                            const activeVersion = templateVersions.find(v => v.is_active)
                            return activeVersion ? (
                              <>
                                <div className="flex items-center justify-between">
                                  <div>
                                    <div className="flex items-center space-x-2">
                                      <span className="text-sm font-medium text-gray-900">
                                        {formatVersion(activeVersion.version_number, activeVersion.major_version, activeVersion.minor_version)}
                                      </span>
                                      <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 border border-green-300">
                                        Active
                                      </span>
                                    </div>
                                    {activeVersion.description && (
                                      <p className="text-xs text-gray-500 mt-1">{activeVersion.description}</p>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center space-x-4 text-xs text-gray-500 pt-2 border-t">
                                  <span>{activeVersion.stages?.length || 0} stages</span>
                                  <span>•</span>
                                  <span>{activeVersion.checklist_templates?.length || 0} checklists</span>
                                  <span>•</span>
                                  <span>{activeVersion.automation_rules?.length || 0} rules</span>
                                  <span>•</span>
                                  <span>Created {new Date(activeVersion.created_at).toLocaleDateString()}</span>
                                </div>
                              </>
                            ) : (
                              <div className="text-center py-4">
                                <p className="text-sm text-gray-500">No active version</p>
                              </div>
                            )
                          })()}
                        </div>
                      ) : (
                        <div className="text-center py-4">
                          <p className="text-sm text-gray-500 mb-2">No versions created yet</p>
                          <p className="text-xs text-gray-400">Create a version to track template changes over time</p>
                        </div>
                      )}
                    </div>
                  </Card>

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

                  {/* Workflow Branches Overview */}
                  <Card>
                    <div className="p-6">
                      <div className="flex items-center justify-between mb-6">
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900">Workflow Branches</h3>
                          <p className="text-sm text-gray-500 mt-1">
                            {workflowBranches?.length || 0} total branches
                            {' '}({workflowBranches?.filter(b => b.status === 'active').length || 0} active,{' '}
                            {workflowBranches?.filter(b => b.status === 'inactive').length || 0} ended)
                          </p>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Button size="sm" variant="outline" onClick={() => handleTabChange('branches')}>
                            <Eye className="w-4 h-4 mr-2" />
                            View All
                          </Button>
                          {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner' || selectedWorkflow.user_permission === 'write') && (
                            <Button size="sm" onClick={() => setShowCreateBranchModal(true)}>
                              <Plus className="w-4 h-4 mr-2" />
                              Create Branch
                            </Button>
                          )}
                        </div>
                      </div>

                      {!workflowBranches || workflowBranches.length === 0 ? (
                        <div className="text-center py-8">
                          <Orbit className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                          <h4 className="text-lg font-medium text-gray-900 mb-2">No workflow branches yet</h4>
                          <p className="text-gray-500 mb-4">
                            Create branches to run this workflow for specific time periods or contexts
                          </p>
                          {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner' || selectedWorkflow.user_permission === 'write') && (
                            <Button size="sm" onClick={() => setShowCreateBranchModal(true)}>
                              <Plus className="w-4 h-4 mr-2" />
                              Create First Branch
                            </Button>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {/* Show only first 5 instances in overview */}
                          {workflowBranches.slice(0, 5).map((branch: any) => {
                            const statusColors = {
                              active: 'bg-green-100 text-green-700 border-green-300',
                              inactive: 'bg-gray-100 text-gray-600 border-gray-300'
                            }
                            const statusIcons = {
                              active: Activity,
                              inactive: CheckCircle
                            }
                            const StatusIcon = statusIcons[branch.status as keyof typeof statusIcons]

                            // Construct full branch name with suffix
                            const fullBranchName = branch.branch_suffix ? `${branch.name} ${branch.branch_suffix}` : branch.name

                            // Determine if this is a clean branch or a copy
                            const isCleanBranch = !branch.source_branch_id
                            const BranchIcon = isCleanBranch ? Network : Copy

                            // Format version number as v1.02 (major.minor)
                            const formatVersion = (versionNumber: number) => {
                              if (!versionNumber) return ''
                              const major = Math.floor(versionNumber / 100)
                              const minor = versionNumber % 100
                              return `v${major}.${minor.toString().padStart(2, '0')}`
                            }

                            return (
                              <div key={branch.id} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                                <div className="flex items-center space-x-3 flex-1">
                                  <div className="relative">
                                    <BranchIcon
                                      className={`w-4 h-4 flex-shrink-0 ${isCleanBranch ? 'text-indigo-600' : 'text-amber-600'}`}
                                      title={isCleanBranch ? 'Clean branch' : 'Copied branch'}
                                    />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center space-x-2">
                                      <button
                                        onClick={() => {
                                          setSelectedBranch(branch)
                                          setShowBranchOverviewModal(true)
                                        }}
                                        className="text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline truncate text-left"
                                      >
                                        {fullBranchName}
                                      </button>
                                      <Badge
                                        size="sm"
                                        className={`text-xs flex items-center space-x-1 ${statusColors[branch.status as keyof typeof statusColors]}`}
                                      >
                                        {StatusIcon && <StatusIcon className="w-3 h-3" />}
                                        <span className="capitalize">{branch.status}</span>
                                      </Badge>
                                    </div>
                                    <div className="flex items-center space-x-3 text-xs text-gray-500 mt-1">
                                      {branch.template_version_number && (
                                        <span className="text-purple-600 font-medium">{formatVersion(branch.template_version_number)}</span>
                                      )}
                                      {branch.totalAssets > 0 && (
                                        <>
                                          <span>{branch.totalAssets} assets</span>
                                          <span className="text-green-600">{branch.activeAssets} active</span>
                                          <span className="text-blue-600">{branch.completedAssets} completed</span>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                <div className="text-xs text-gray-500 ml-4">
                                  {new Date(branch.branched_at || branch.created_at).toLocaleDateString()}
                                </div>
                              </div>
                            )
                          })}

                          {workflowBranches.length > 5 && (
                            <div className="text-center pt-2">
                              <Button size="sm" variant="ghost" onClick={() => handleTabChange('cadence')}>
                                View all {workflowBranches.length} branches
                              </Button>
                            </div>
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
                                size="sm"
                                variant="outline"
                                className="border-green-300 text-green-600 hover:bg-green-50 hover:border-green-400 ml-4 min-w-[120px]"
                                onClick={() => {
                                  setWorkflowToUnarchive(selectedWorkflow.id)
                                  setShowUnarchiveModal(true)
                                }}
                              >
                                <CheckCircle className="w-4 h-4 mr-2" />
                                Unarchive
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-orange-300 text-orange-600 hover:bg-orange-50 hover:border-orange-400 ml-4 min-w-[120px]"
                                onClick={() => {
                                  setWorkflowToDelete(selectedWorkflow.id)
                                  setShowDeleteConfirmModal(true)
                                }}
                              >
                                <Archive className="w-4 h-4 mr-2" />
                                Archive
                              </Button>
                            )}
                          </div>
                        )}

                        {/* Permanent Delete Action (only for archived workflows) */}
                        {selectedWorkflow.archived && (
                          <div className="flex items-center justify-between">
                            <div>
                              <h4 className="text-base font-medium text-gray-900 mb-1">
                                Remove Workflow
                              </h4>
                              <p className="text-sm text-gray-600">
                                Remove this workflow from the archived section. All data will be preserved and can be recovered by the application team if needed.
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-red-500 text-red-700 hover:bg-red-100 hover:border-red-600 ml-4 min-w-[160px]"
                              onClick={() => {
                                setWorkflowToPermanentlyDelete(selectedWorkflow.id)
                                setShowPermanentDeleteModal(true)
                              }}
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Remove from Archive
                            </Button>
                          </div>
                        )}
                      </div>
                    </Card>
                  )}
                </div>
              )}

              {activeView === 'stages' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">Workflow Stages</h3>
                    {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') &&
                     (selectedWorkflow?.stages || []).length > 0 && isTemplateEditMode && (
                      <Button size="sm" onClick={() => setShowAddStage(true)}>
                        <Plus className="w-4 h-4 mr-2" />
                        Add Stage
                      </Button>
                    )}
                  </div>
                  {!isTemplateEditMode && (selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center space-x-2">
                      <AlertCircle className="w-4 h-4 text-blue-600 flex-shrink-0" />
                      <p className="text-sm text-blue-800">
                        Click <strong>"Edit Template"</strong> in the header to make changes to stages and checklists
                      </p>
                    </div>
                  )}

                  <div className="space-y-3">
                    {(selectedWorkflow?.stages || []).length === 0 ? (
                      <Card>
                        <div className="text-center py-6">
                          <Target className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                          <h3 className="text-base font-medium text-gray-900 mb-2">No stages configured</h3>
                          <p className="text-sm text-gray-500 mb-3">Add stages to organize your workflow process.</p>
                          {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && isTemplateEditMode && (
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
                            <div className="p-3">
                              {/* Stage Header */}
                              <div className="flex items-center justify-between mb-3">
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
                                {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && isTemplateEditMode && (
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
                                            ],
                                            movedStageName: stageToMove.name,
                                            direction: 'up'
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
                                            ],
                                            movedStageName: stageToMove.name,
                                            direction: 'down'
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
                              <div className="border-t pt-3">
                                <div className="flex items-center justify-between mb-2">
                                  <h5 className="text-sm font-medium text-gray-700">
                                    Checklist Template ({stageChecklistTemplates.length})
                                  </h5>
                                  {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && isTemplateEditMode && (
                                    <button
                                      onClick={() => setShowAddChecklistItem(stage.stage_key)}
                                      className="text-xs font-medium text-gray-700 hover:text-gray-900 flex items-center transition-colors"
                                    >
                                      <Plus className="w-3 h-3 mr-1" />
                                      Add Item
                                    </button>
                                  )}
                                </div>

                                {stageChecklistTemplates.length === 0 ? (
                                  <div className="text-center py-4 bg-gray-50 rounded-lg">
                                    <CheckSquare className="w-6 h-6 text-gray-400 mx-auto mb-2" />
                                    <p className="text-sm text-gray-500">No checklist template items</p>
                                    {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                                      <p className="text-xs text-gray-400 mt-1">Add template items that will appear for all assets using this workflow</p>
                                    )}
                                  </div>
                                ) : (
                                  <div className="space-y-1.5">
                                    {stageChecklistTemplates.map((template, itemIndex) => (
                                      <div
                                        key={template.id}
                                        draggable={(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && isTemplateEditMode}
                                        onDragStart={(e) => handleDragStart(e, template.id)}
                                        onDragOver={handleDragOver}
                                        onDragEnter={(e) => handleDragEnter(e, template.id)}
                                        onDragLeave={handleDragLeave}
                                        onDrop={(e) => handleDrop(e, template.id, stageChecklistTemplates)}
                                        onDragEnd={handleDragEnd}
                                        className={`flex items-center space-x-2 p-2 rounded-lg transition-all duration-200 ${
                                          draggedChecklistItem === template.id ? 'opacity-50 bg-blue-100' :
                                          dragOverItem === template.id ? 'bg-blue-200 border-2 border-blue-400' :
                                          'bg-gray-50 hover:bg-gray-100'
                                        } ${
                                          (selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && isTemplateEditMode ? 'cursor-move' : ''
                                        }`}
                                      >
                                        {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && isTemplateEditMode && (
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
                                            <p className="text-xs text-gray-500 mt-0.5">{template.description}</p>
                                          )}
                                          <div className="flex items-center space-x-3 mt-1">
                                            {template.estimated_hours && (
                                              <span className="text-xs text-gray-400">~{template.estimated_hours}h</span>
                                            )}
                                            {template.tags && (
                                              <span className="text-xs text-gray-400">{template.tags.join(', ')}</span>
                                            )}
                                          </div>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                          {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && isTemplateEditMode && (
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
                              <div className="border-t pt-3 mt-3">
                                <ContentTileManager
                                  workflowId={selectedWorkflow.id}
                                  stageId={stage.stage_key}
                                  isEditable={isTemplateEditMode}
                                  onTileChange={(description) => trackChange('checklist_edited', description)}
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
                        Manage admins, users, and stakeholders for this workflow
                      </p>
                    </div>
                    <div className="flex items-center space-x-3">
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

                    {/* Pending Access Requests */}
                    {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && pendingAccessRequests && pendingAccessRequests.length > 0 && (
                      <Card>
                        <div className="p-3">
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-sm font-semibold text-gray-900">Pending Access Requests</h4>
                            <span className="text-xs text-gray-500 bg-orange-100 px-2 py-1 rounded-full">
                              {pendingAccessRequests.length} pending
                            </span>
                          </div>

                          <div className="space-y-2">
                            {pendingAccessRequests.map((request: any) => {
                              const user = request.user
                              const userName = user?.first_name && user?.last_name
                                ? `${user.first_name} ${user.last_name}`
                                : user?.email || 'Unknown User'
                              const userInitial = userName.charAt(0).toUpperCase()
                              const permissionLabel = request.requested_permission === 'admin' ? 'Admin' : request.requested_permission === 'write' ? 'Write' : 'Read'
                              const permissionColor = request.requested_permission === 'admin' ? 'blue' : request.requested_permission === 'write' ? 'green' : 'gray'

                              return (
                                <div key={request.id} className="flex items-start justify-between p-3 bg-orange-50 rounded-lg border border-orange-200">
                                  <div className="flex items-start space-x-3 flex-1 min-w-0">
                                    <div className="w-8 h-8 bg-orange-500 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                                      <span className="text-white font-semibold text-xs">{userInitial}</span>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 mb-1">
                                        <span className="text-sm font-medium text-gray-900">{userName}</span>
                                        <Badge
                                          variant="default"
                                          size="sm"
                                          className={`${
                                            permissionColor === 'blue' ? 'bg-blue-100 text-blue-700' :
                                            permissionColor === 'green' ? 'bg-green-100 text-green-700' :
                                            'bg-gray-100 text-gray-700'
                                          }`}
                                        >
                                          Requesting {permissionLabel}
                                        </Badge>
                                      </div>
                                      {request.reason && (
                                        <p className="text-xs text-gray-600 mb-2">"{request.reason}"</p>
                                      )}
                                      <p className="text-xs text-gray-500">
                                        {request.current_permission ? `Current: ${request.current_permission}` : 'No current access'} •
                                        Requested {new Date(request.created_at).toLocaleDateString()}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex items-center space-x-2 ml-3">
                                    <Button
                                      size="xs"
                                      variant="outline"
                                      className="border-green-300 text-green-600 hover:bg-green-50"
                                      onClick={() => approveAccessRequestMutation.mutate({
                                        requestId: request.id,
                                        userId: request.user_id,
                                        permission: request.requested_permission,
                                        workflowId: request.workflow_id
                                      })}
                                      disabled={approveAccessRequestMutation.isPending}
                                    >
                                      <Check className="w-3 h-3 mr-1" />
                                      Approve
                                    </Button>
                                    <Button
                                      size="xs"
                                      variant="outline"
                                      className="border-red-300 text-red-600 hover:bg-red-50"
                                      onClick={() => rejectAccessRequestMutation.mutate(request.id)}
                                      disabled={rejectAccessRequestMutation.isPending}
                                    >
                                      <X className="w-3 h-3 mr-1" />
                                      Decline
                                    </Button>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      </Card>
                    )}

                    {/* Team & Access Control */}
                    <Card>
                      <div className="p-4">
                        <h4 className="text-base font-semibold text-gray-900 mb-4">Team & Access Control</h4>

                        {/* Created By Section */}
                        <div className="mb-6">
                          <div className="flex items-center justify-between mb-3">
                            <h5 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Created By</h5>
                          </div>
                          <div className="flex items-center p-3 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
                            <div className="flex items-center space-x-3">
                              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                                <span className="text-white font-semibold text-sm">
                                  {selectedWorkflow.creator_name?.charAt(0).toUpperCase() || '?'}
                                </span>
                              </div>
                              <div>
                                <div className="text-sm font-medium text-gray-900">
                                  {selectedWorkflow.creator_name || 'Unknown User'}
                                </div>
                                <div className="text-xs text-gray-500">Workflow creator</div>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Admins Section */}
                        <div className="mb-6">
                          <div className="flex items-center justify-between mb-3">
                            <h5 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                              Admins ({(workflowCollaborators?.filter((c: any) => c.permission === 'admin').length || 0) + 1})
                            </h5>
                            {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setShowInviteModal(true)}
                              >
                                <Plus className="w-3 h-3 mr-1" />
                                Add Admin
                              </Button>
                            )}
                          </div>
                          <div className="space-y-2">
                            {/* Creator as first admin (always) */}
                            <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg border border-blue-200">
                              <div className="flex items-center space-x-3 flex-1 min-w-0">
                                <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
                                  <span className="text-white font-semibold text-sm">
                                    {selectedWorkflow.creator_name?.charAt(0).toUpperCase() || '?'}
                                  </span>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium text-gray-900 truncate">{selectedWorkflow.creator_name || 'Unknown User'}</div>
                                  <div className="text-xs text-gray-500 truncate">Creator</div>
                                </div>
                              </div>
                            </div>

                            {/* Other admins */}
                            {workflowCollaborators && workflowCollaborators.filter((c: any) => c.permission === 'admin').map((collab: any) => {
                              const user = collab.user
                              const userName = user?.first_name && user?.last_name
                                ? `${user.first_name} ${user.last_name}`
                                : user?.email || 'Unknown User'
                              const userInitial = userName.charAt(0).toUpperCase()
                              const canEdit = selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner'

                              return (
                                <div key={collab.id} className="flex items-center justify-between p-3 bg-blue-50 rounded-lg border border-blue-200 hover:border-blue-300 transition-colors">
                                  <div className="flex items-center space-x-3 flex-1 min-w-0">
                                    <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
                                      <span className="text-white font-semibold text-sm">{userInitial}</span>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="text-sm font-medium text-gray-900 truncate">{userName}</div>
                                      <div className="text-xs text-gray-500 truncate">{user?.email}</div>
                                    </div>
                                  </div>

                                  {canEdit && (
                                    <div className="flex items-center space-x-2 ml-2">
                                      <button
                                        onClick={() => setRemoveAdminConfirm({ id: collab.id, name: userName })}
                                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                        title="Remove admin"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>

                        {/* Users Section (Write and Read permissions) */}
                        {workflowCollaborators && workflowCollaborators.filter((c: any) => c.permission !== 'admin').length > 0 && (
                          <div className="mb-6">
                            <div className="flex items-center justify-between mb-3">
                              <h5 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                                Users ({workflowCollaborators.filter((c: any) => c.permission !== 'admin').length})
                              </h5>
                            </div>
                            <div className="space-y-2">
                              {workflowCollaborators.filter((c: any) => c.permission !== 'admin').map((collab: any) => {
                                const user = collab.user
                                const userName = user?.first_name && user?.last_name
                                  ? `${user.first_name} ${user.last_name}`
                                  : user?.email || 'Unknown User'
                                const userInitial = userName.charAt(0).toUpperCase()
                                const canEdit = selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner'

                                return (
                                  <div key={collab.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors">
                                    <div className="flex items-center space-x-3 flex-1 min-w-0">
                                      <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                                        collab.permission === 'write' ? 'bg-green-500' : 'bg-gray-400'
                                      }`}>
                                        <span className="text-white font-semibold text-sm">{userInitial}</span>
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium text-gray-900 truncate">{userName}</div>
                                        <div className="text-xs text-gray-500 truncate">{user?.email}</div>
                                      </div>
                                    </div>

                                    <div className="flex items-center space-x-2 ml-2">
                                      {canEdit ? (
                                        <>
                                          <select
                                            value={collab.permission}
                                            onChange={(e) => {
                                              updateCollaboratorMutation.mutate({
                                                collaborationId: collab.id,
                                                permission: e.target.value
                                              })
                                            }}
                                            className="text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                          >
                                            <option value="admin">Admin</option>
                                            <option value="write">Write</option>
                                            <option value="read">Read</option>
                                          </select>
                                          <button
                                            onClick={() => {
                                              if (confirm(`Remove ${userName} from this workflow?`)) {
                                                removeCollaboratorMutation.mutate(collab.id)
                                              }
                                            }}
                                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                            title="Remove user"
                                          >
                                            <Trash2 className="w-4 h-4" />
                                          </button>
                                        </>
                                      ) : null}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}

                        {/* Stakeholders Section */}
                        {workflowStakeholders && workflowStakeholders.length > 0 && (
                          <div>
                            <div className="flex items-center justify-between mb-3">
                              <h5 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                                Stakeholders ({workflowStakeholders.length})
                              </h5>
                              {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner' || selectedWorkflow.user_permission === 'write') && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setShowAddStakeholderModal(true)}
                                >
                                  <Plus className="w-3 h-3 mr-1" />
                                  Add Stakeholder
                                </Button>
                              )}
                            </div>
                            <div className="space-y-2">
                              {workflowStakeholders.map((stakeholder: any) => {
                                const user = stakeholder.user
                                const userName = user?.first_name && user?.last_name
                                  ? `${user.first_name} ${user.last_name}`
                                  : user?.email || 'Unknown User'
                                const userInitial = userName.charAt(0).toUpperCase()
                                const canEdit = selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner' || selectedWorkflow.user_permission === 'write'

                                return (
                                  <div key={stakeholder.id} className="flex items-center justify-between p-3 bg-green-50 rounded-lg border border-green-200 hover:border-green-300 transition-colors">
                                    <div className="flex items-center space-x-3 flex-1 min-w-0">
                                      <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                                        <span className="text-white font-semibold text-sm">{userInitial}</span>
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium text-gray-900 truncate">{userName}</div>
                                        <div className="text-xs text-gray-500 truncate">{user?.email}</div>
                                      </div>
                                    </div>

                                    {canEdit && (
                                      <div className="flex items-center space-x-2 ml-2">
                                        <button
                                          onClick={() => setRemoveStakeholderConfirm({ id: stakeholder.id, name: userName })}
                                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                          title="Remove stakeholder"
                                        >
                                          <Trash2 className="w-4 h-4" />
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </Card>
                  </div>
                </div>
              )}

              {activeView === 'universe' && (
                <div className="space-y-6">
                  {!isTemplateEditMode && (selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center space-x-2">
                      <AlertCircle className="w-4 h-4 text-blue-600 flex-shrink-0" />
                      <p className="text-sm text-blue-800">
                        Click <strong>"Edit Template"</strong> in the header to make changes to universe rules
                      </p>
                    </div>
                  )}
                  {/* Simplified Universe Builder */}
                  <SimplifiedUniverseBuilder
                    workflowId={selectedWorkflow.id}
                    rules={universeRulesState}
                    onRulesChange={handleUniverseRulesChange}
                    onSave={saveUniverseRules}
                    isEditable={isTemplateEditMode}
                    analysts={analysts.map(a => ({ value: a.value, label: a.label }))}
                    lists={assetLists.map(l => ({ value: l.id, label: l.name }))}
                    themes={themes.map(t => ({ value: t.id, label: t.name }))}
                    portfolios={[]} // Add portfolios when available
                  />
                </div>
              )}

              {activeView === 'cadence' && (
                <div className="space-y-6">
                  {!isTemplateEditMode && (selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center space-x-2">
                      <AlertCircle className="w-4 h-4 text-blue-600 flex-shrink-0" />
                      <p className="text-sm text-blue-800">
                        Click <strong>"Edit Template"</strong> in the header to make changes to cadence and automation rules
                      </p>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-gray-900">Cadence & Automation</h3>
                      <p className="text-sm text-gray-500 mt-1">Configure workflow timing and automated rules</p>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
                          Cadence Group:
                        </label>
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

                            console.log('Updating workflow cadence group to:', timeframe, 'for workflow:', selectedWorkflow.id)

                            const { data, error } = await supabase
                              .from('workflows')
                              .update({
                                cadence_timeframe: timeframe,
                                cadence_days: daysMap[timeframe]
                              })
                              .eq('id', selectedWorkflow.id)
                              .select()

                            if (error) {
                              console.error('Error updating workflow cadence group:', error)
                              console.error('Error details:', JSON.stringify(error, null, 2))
                              alert(`Failed to update cadence group: ${error.message || error.code || 'Unknown error'}`)
                            } else {
                              console.log('Successfully updated workflow:', data)
                              queryClient.invalidateQueries({ queryKey: ['workflows-full'] })
                              // Also update the local state
                              setSelectedWorkflow({
                                ...selectedWorkflow,
                                cadence_timeframe: timeframe,
                                cadence_days: daysMap[timeframe]
                              })
                              trackChange('cadence_updated', `Updated cadence to: ${timeframe}`)
                            }
                          }}
                          disabled={selectedWorkflow.user_permission === 'read' || !isTemplateEditMode}
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

                      {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && isTemplateEditMode && (
                        <Button size="sm" onClick={() => setShowAddRuleModal(true)}>
                          <Plus className="w-4 h-4 mr-2" />
                          Add Rule
                        </Button>
                      )}
                    </div>
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
                              {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && isTemplateEditMode && (
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
                              {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && isTemplateEditMode && (
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
                                        Create new branch and append "{rule.action_value?.branch_suffix || 'new branch'}"
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

                </div>
              )}

              {/* Branches View */}
              {activeView === 'branches' && (() => {
                console.log('🌳 Branches View Rendering')
                console.log('📋 Selected Workflow:', selectedWorkflow?.id, selectedWorkflow?.name)
                console.log('📊 Template Versions Available:', templateVersions)
                console.log('📊 Template Versions Details:', JSON.stringify(templateVersions, null, 2))

                // Build the tree structure
                const branchMap = new Map<string, any>()

                // Initialize all branches as tree nodes
                workflowBranches?.forEach(branch => {
                  branchMap.set(branch.id, {
                    ...branch,
                    children: [],
                    depth: 0,
                    isCopied: false
                  })
                })

                // Build parent-child relationships with proper hierarchy
                // Template -> Clean Branches -> Copied Branches (max 3 levels)
                const rootBranches: any[] = []

                // First pass: identify clean vs copied branches
                workflowBranches?.forEach(branch => {
                  const node = branchMap.get(branch.id)!

                  // Mark as copied if it has a source_branch_id
                  if (branch.source_branch_id) {
                    node.isCopied = true
                  }
                })

                // Helper function to recursively find the clean parent
                const findCleanParent = (branchId: string): any => {
                  const branch = workflowBranches.find(b => b.id === branchId)
                  if (!branch) return null

                  const node = branchMap.get(branchId)
                  if (!node) return null

                  // If this is a clean branch (not copied), we found it
                  if (!node.isCopied) {
                    return node
                  }

                  // If this is a copied branch, recursively check its source
                  if (branch.source_branch_id) {
                    return findCleanParent(branch.source_branch_id)
                  }

                  return null
                }

                // Second pass: build hierarchy
                workflowBranches?.forEach(branch => {
                  const node = branchMap.get(branch.id)!

                  if (!branch.source_branch_id) {
                    // This is a clean branch (created directly from template)
                    console.log(`🌱 Clean branch: ${branch.name}`)
                    rootBranches.push(node)
                  } else if (branchMap.has(branch.source_branch_id)) {
                    const sourceNode = branchMap.get(branch.source_branch_id)!
                    console.log(`🔗 Processing branch: ${branch.name}, source: ${sourceNode.name}, source is copied: ${sourceNode.isCopied}`)

                    // If source is a clean branch, add as child
                    if (!sourceNode.isCopied) {
                      console.log(`  ✅ Adding ${branch.name} as child of clean branch ${sourceNode.name}`)
                      sourceNode.children.push(node)
                    } else {
                      // If source is a copied branch, recursively find the clean parent
                      console.log(`  🔍 Source is copied, finding clean parent recursively...`)
                      const cleanParent = findCleanParent(branch.source_branch_id)

                      if (cleanParent && !cleanParent.isCopied) {
                        console.log(`  ✅ Found clean parent: ${cleanParent.name}, adding ${branch.name} as child`)
                        cleanParent.children.push(node)
                      } else {
                        console.log(`  ⚠️ No clean parent found, adding ${branch.name} as root`)
                        // Fallback: add as root if we can't find clean parent
                        rootBranches.push(node)
                      }
                    }
                  } else {
                    console.log(`⚠️ Source not found for ${branch.name}, adding as root`)
                    // Source not found in current filter, add as root
                    rootBranches.push(node)
                  }
                })

                // Calculate depths (max depth of 2: 0 for clean branches, 1 for copied branches)
                const calculateDepth = (node: any, depth: number) => {
                  node.depth = depth
                  if (depth < 2) {
                    node.children.forEach((child: any) => calculateDepth(child, depth + 1))
                  }
                }
                rootBranches.forEach(node => calculateDepth(node, 0))

                // Sort by creation date
                const sortByDate = (a: any, b: any) => {
                  return new Date(a.branched_at || a.created_at).getTime() - new Date(b.branched_at || b.created_at).getTime()
                }

                rootBranches.sort(sortByDate)
                rootBranches.forEach(node => {
                  if (node.children.length > 0) {
                    node.children.sort(sortByDate)
                  }
                })

                const renderBranchNode = (node: any, isLast: boolean, parentLines: boolean[] = []): any => {
                  const statusColors = {
                    active: 'bg-green-100 text-green-700 border-green-300',
                    inactive: 'bg-gray-100 text-gray-600 border-gray-300'
                  }
                  const statusIcons = {
                    active: Activity,
                    inactive: CheckCircle
                  }
                  const StatusIcon = statusIcons[node.status as keyof typeof statusIcons]
                  const isCollapsed = collapsedBranches.has(node.id)
                  const hasChildren = node.children.length > 0

                  const toggleCollapse = () => {
                    const newCollapsed = new Set(collapsedBranches)
                    if (isCollapsed) {
                      newCollapsed.delete(node.id)
                    } else {
                      newCollapsed.add(node.id)
                    }
                    setCollapsedBranches(newCollapsed)
                  }

                  return (
                    <div key={node.id}>
                      {/* Branch Node */}
                      <div className="flex items-start">
                        {/* Tree lines */}
                        <div className="flex items-center mr-3">
                          {parentLines.map((hasLine, idx) => (
                            <div key={idx} className="w-6 relative">
                              {hasLine && (
                                <div className="absolute left-3 top-0 bottom-0 w-0.5 bg-gray-300" />
                              )}
                            </div>
                          ))}
                          {node.depth > 0 && (
                            <div className="relative w-6 h-6">
                              {/* Vertical line from parent */}
                              <div className="absolute left-3 top-0 h-3 w-0.5 bg-gray-300" />
                              {/* Horizontal line to node */}
                              <div className="absolute left-3 top-3 w-6 h-0.5 bg-gray-300" />
                              {/* Continue vertical line if not last */}
                              {!isLast && (
                                <div className="absolute left-3 top-3 bottom-0 w-0.5 bg-gray-300" style={{ height: 'calc(100% + 1rem)' }} />
                              )}
                            </div>
                          )}
                        </div>

                        {/* Collapse/Expand Toggle */}
                        {hasChildren && (
                          <button
                            onClick={toggleCollapse}
                            className="flex-shrink-0 mr-2 mt-3 p-1 hover:bg-gray-100 rounded transition-colors"
                            title={isCollapsed ? 'Expand branch' : 'Collapse branch'}
                          >
                            {isCollapsed ? (
                              <ChevronRight className="w-4 h-4 text-gray-500" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-gray-500" />
                            )}
                          </button>
                        )}
                        {!hasChildren && node.depth > 0 && (
                          <div className="w-6 mr-2"></div>
                        )}

                        {/* Branch Card */}
                        <div className="flex-1 mb-4">
                          <div className={`rounded-lg p-3 hover:shadow-md transition-shadow ${
                            node.status === 'inactive'
                              ? 'bg-gray-50 border-2 border-gray-300'
                              : 'bg-white border border-gray-200'
                          }`}>
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                {/* Branch Header */}
                                <div className="flex items-center gap-2 mb-2 flex-wrap">
                                  {node.isCopied ? (
                                    <Copy className="w-4 h-4 text-blue-600 flex-shrink-0" />
                                  ) : (
                                    <Network className="w-4 h-4 text-purple-600 flex-shrink-0" />
                                  )}
                                  <button
                                    onClick={() => {
                                      setSelectedBranch(node)
                                      setShowBranchOverviewModal(true)
                                    }}
                                    className={`text-sm font-semibold hover:text-indigo-600 transition-colors cursor-pointer ${node.status === 'inactive' ? 'text-gray-600' : 'text-gray-900'}`}
                                  >
                                    {node.name}
                                  </button>
                                  {editingBranchSuffix?.id === node.id ? (
                                    <div className="flex items-center space-x-1">
                                      <span className="text-xs text-gray-500">(</span>
                                      <input
                                        type="text"
                                        value={branchSuffixValue}
                                        onChange={(e) => setBranchSuffixValue(e.target.value)}
                                        onBlur={() => {
                                          if (branchSuffixValue.trim() !== editingBranchSuffix.currentSuffix) {
                                            updateBranchSuffixMutation.mutate({
                                              branchId: node.id,
                                              newSuffix: branchSuffixValue.trim()
                                            })
                                          } else {
                                            setEditingBranchSuffix(null)
                                            setBranchSuffixValue('')
                                          }
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            e.currentTarget.blur()
                                          } else if (e.key === 'Escape') {
                                            setEditingBranchSuffix(null)
                                            setBranchSuffixValue('')
                                          }
                                        }}
                                        className="text-xs text-gray-700 border-b border-primary-500 outline-none bg-transparent w-20"
                                        autoFocus
                                      />
                                      <span className="text-xs text-gray-500">)</span>
                                    </div>
                                  ) : (
                                    <>
                                      {node.branch_suffix && (
                                        <div className="flex items-center space-x-1 group">
                                          <span className="text-xs text-gray-500 font-normal">
                                            ({node.branch_suffix})
                                          </span>
                                          {!node.deleted && !node.archived && (selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                                            <button
                                              onClick={() => {
                                                setEditingBranchSuffix({ id: node.id, currentSuffix: node.branch_suffix })
                                                setBranchSuffixValue(node.branch_suffix)
                                              }}
                                              className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-gray-200 rounded transition-opacity"
                                            >
                                              <Edit3 className="w-3 h-3 text-gray-400" />
                                            </button>
                                          )}
                                        </div>
                                      )}
                                    </>
                                  )}
                                  {/* Status Badge - Only show for active branches, right after suffix */}
                                  {!node.deleted && !node.archived && (
                                    <span className={`px-2 py-0.5 rounded-full text-xs flex items-center space-x-1 ${statusColors[node.status]}`}>
                                      {StatusIcon && <StatusIcon className="w-3 h-3" />}
                                      <span className="capitalize">{node.status}</span>
                                    </span>
                                  )}
                                  {/* Child count indicator when collapsed */}
                                  {hasChildren && isCollapsed && (
                                    <span className="px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700 border border-blue-300">
                                      {node.children.length} {node.children.length === 1 ? 'branch' : 'branches'}
                                    </span>
                                  )}
                                </div>

                                {/* Branch Details */}
                                <div className="space-y-1 ml-6">
                                  {/* Branch Type */}
                                  {node.isCopied && (
                                    <div className="flex items-center space-x-1.5 text-xs text-blue-600">
                                      <Copy className="w-3 h-3" />
                                      <span className="font-medium">Copied branch with data from parent</span>
                                    </div>
                                  )}

                                  {/* Dates */}
                                  <div className="flex items-center gap-3 text-xs text-gray-600">
                                    <span>Created {new Date(node.branched_at || node.created_at).toLocaleDateString()}</span>
                                    {node.archived && node.archived_at && (
                                      <>
                                        <span>•</span>
                                        <span className="text-orange-600 font-medium">
                                          Archived {new Date(node.archived_at).toLocaleDateString()}
                                        </span>
                                      </>
                                    )}
                                    {node.deleted && node.deleted_at && (
                                      <>
                                        <span>•</span>
                                        <span className="text-red-600 font-medium">
                                          Deleted {new Date(node.deleted_at).toLocaleDateString()}
                                        </span>
                                      </>
                                    )}
                                  </div>

                                  {/* Asset Stats */}
                                  {node.totalAssets > 0 && (
                                    <div className="flex items-center gap-3 text-xs">
                                      <span className="text-gray-600">{node.totalAssets} total assets:</span>
                                      <span className="text-green-600 font-medium">{node.activeAssets} active</span>
                                      <span className="text-blue-600 font-medium">{node.completedAssets} completed</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center space-x-1">
                                {/* Only show Branch button if not deleted or archived */}
                                {!node.deleted && !node.archived && (selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                                  <button
                                    onClick={() => {
                                      setShowCreateBranchModal(true)
                                      setPreselectedSourceBranch(node.id)
                                    }}
                                    className="p-1.5 hover:bg-gray-100 rounded transition-colors"
                                    title="Create branch from this workflow"
                                  >
                                    <GitBranch className="w-4 h-4 text-gray-600" />
                                  </button>
                                )}
                                {/* Only show End button if active and not deleted or archived */}
                                {!node.deleted && !node.archived && node.status === 'active' && (selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                                  <button
                                    onClick={() => setBranchToEnd({ id: node.id, name: node.name })}
                                    className="p-1.5 hover:bg-orange-100 rounded transition-colors"
                                    title="End this branch"
                                  >
                                    <Pause className="w-4 h-4 text-orange-600 fill-orange-600" />
                                  </button>
                                )}
                                {/* Only show Continue button if inactive and not deleted or archived */}
                                {!node.deleted && !node.archived && node.status === 'inactive' && (selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                                  <button
                                    onClick={() => setBranchToContinue({ id: node.id, name: node.name })}
                                    className="p-1.5 hover:bg-green-100 rounded transition-colors"
                                    title="Continue this branch"
                                  >
                                    <Play className="w-4 h-4 text-green-600" />
                                  </button>
                                )}
                                {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                                  <>
                                    {!node.archived && !node.deleted && (
                                      <>
                                        <button
                                          onClick={() => setBranchToArchive({ id: node.id, name: node.name })}
                                          className="p-1.5 hover:bg-amber-100 rounded transition-colors"
                                          title="Archive this branch"
                                        >
                                          <Archive className="w-4 h-4 text-amber-600" />
                                        </button>
                                        <button
                                          onClick={() => setBranchToDelete({ id: node.id, name: node.name })}
                                          className="p-1.5 hover:bg-red-100 rounded transition-colors"
                                          title="Delete this branch"
                                        >
                                          <Trash2 className="w-4 h-4 text-red-600" />
                                        </button>
                                      </>
                                    )}
                                    {node.archived && (
                                      <button
                                        onClick={() => unarchiveBranchMutation.mutate(node.id)}
                                        disabled={unarchiveBranchMutation.isPending}
                                        className="p-1.5 hover:bg-amber-100 rounded transition-colors disabled:opacity-50"
                                        title={unarchiveBranchMutation.isPending ? 'Unarchiving...' : 'Unarchive this branch'}
                                      >
                                        <Archive className="w-4 h-4 text-amber-600" />
                                      </button>
                                    )}
                                    {node.deleted && (
                                      <button
                                        onClick={() => restoreBranchMutation.mutate(node.id)}
                                        disabled={restoreBranchMutation.isPending}
                                        className="p-1.5 hover:bg-green-100 rounded transition-colors disabled:opacity-50"
                                        title={restoreBranchMutation.isPending ? 'Restoring...' : 'Restore this branch'}
                                      >
                                        <RotateCcw className="w-4 h-4 text-green-600" />
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Children - Only show if not collapsed */}
                      {node.children.length > 0 && !isCollapsed && (
                        <div>
                          {node.children.map((child: any, idx: number) =>
                            renderBranchNode(
                              child,
                              idx === node.children.length - 1,
                              [...parentLines, !isLast]
                            )
                          )}
                        </div>
                      )}
                    </div>
                  )
                }

                return (
                  <div className="space-y-3">
                    {/* Show branch detail view if a branch is selected */}
                    {showBranchOverviewModal && selectedBranch ? (
                      <div className="space-y-4">
                        {/* Back button and header */}
                        <div className="flex items-center space-x-3">
                          <button
                            onClick={() => {
                              setShowBranchOverviewModal(false)
                              setSelectedBranch(null)
                            }}
                            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                          >
                            <ArrowLeft className="w-5 h-5 text-gray-600" />
                          </button>
                          <div className="flex items-center space-x-3">
                            {selectedBranch.isCopied ? (
                              <Copy className="w-6 h-6 text-blue-600" />
                            ) : (
                              <Network className="w-6 h-6 text-purple-600" />
                            )}
                            <div>
                              <h3 className="text-xl font-bold text-gray-900">{selectedBranch.name}</h3>
                              <p className="text-sm text-gray-500">
                                {selectedBranch.isCopied ? 'Copied Branch' : 'Clean Branch'} •
                                Created {new Date(selectedBranch.branched_at || selectedBranch.created_at).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Branch details content */}
                        <div className="space-y-4">
                          {/* Branch Info */}
                          <Card className="p-4">
                            <h4 className="text-lg font-semibold text-gray-900 mb-4">Branch Details</h4>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <span className="text-sm font-medium text-gray-500">Status</span>
                                <div className="mt-1">
                                  <Badge
                                    className={selectedBranch.status === 'active'
                                      ? 'bg-green-100 text-green-700 border-green-300'
                                      : 'bg-gray-100 text-gray-600 border-gray-300'
                                    }
                                  >
                                    {selectedBranch.status === 'active' ? (
                                      <>
                                        <Activity className="w-3 h-3 mr-1" />
                                        Active
                                      </>
                                    ) : (
                                      <>
                                        <CheckCircle className="w-3 h-3 mr-1" />
                                        Inactive
                                      </>
                                    )}
                                  </Badge>
                                </div>
                              </div>

                              {selectedBranch.branch_suffix && (
                                <div>
                                  <span className="text-sm font-medium text-gray-500">Suffix</span>
                                  <p className="text-sm text-gray-900 mt-1">{selectedBranch.branch_suffix}</p>
                                </div>
                              )}

                              <div>
                                <span className="text-sm font-medium text-gray-500">Template Version</span>
                                <p className="text-sm text-gray-900 mt-1">
                                  v{selectedBranch.template_version_number || 'N/A'}
                                </p>
                              </div>

                              {selectedBranch.branched_at && (
                                <div>
                                  <span className="text-sm font-medium text-gray-500">Created</span>
                                  <p className="text-sm text-gray-900 mt-1">
                                    {new Date(selectedBranch.branched_at).toLocaleString()}
                                  </p>
                                </div>
                              )}

                              {selectedBranch.ended_at && (
                                <div>
                                  <span className="text-sm font-medium text-gray-500">Ended</span>
                                  <p className="text-sm text-gray-900 mt-1">
                                    {new Date(selectedBranch.ended_at).toLocaleString()}
                                  </p>
                                </div>
                              )}
                            </div>
                          </Card>

                          {/* Asset Statistics */}
                          <Card className="p-4">
                            <h4 className="text-lg font-semibold text-gray-900 mb-4">Asset Progress</h4>
                            <div className="grid grid-cols-3 gap-4">
                              <div className="text-center p-4 bg-gray-50 rounded-lg">
                                <div className="text-3xl font-bold text-gray-900">{selectedBranch.totalAssets || 0}</div>
                                <div className="text-sm font-medium text-gray-600 mt-1">Total Assets</div>
                              </div>
                              <div className="text-center p-4 bg-green-50 rounded-lg">
                                <div className="text-3xl font-bold text-green-700">{selectedBranch.activeAssets || 0}</div>
                                <div className="text-sm font-medium text-green-700 mt-1">Active</div>
                              </div>
                              <div className="text-center p-4 bg-blue-50 rounded-lg">
                                <div className="text-3xl font-bold text-blue-700">{selectedBranch.completedAssets || 0}</div>
                                <div className="text-sm font-medium text-blue-700 mt-1">Completed</div>
                              </div>
                            </div>
                          </Card>

                          {/* Asset Lists */}
                          {console.log('📊 Selected Branch Assets in UI:', selectedBranchAssets)}
                          {selectedBranchAssets && (
                            <Card className="p-4">
                              <h4 className="text-lg font-semibold text-gray-900 mb-4">Assets</h4>
                              <div className="space-y-2">
                                {/* Inherited Assets (from parent workflow) */}
                                <div className="border border-gray-200 rounded-lg">
                                  <button
                                    onClick={() => setCollapsedAssetGroups(prev => ({ ...prev, inherited: !prev.inherited }))}
                                    className="w-full flex items-center justify-between p-3 hover:bg-gray-50 transition-colors"
                                  >
                                    <div className="flex items-center space-x-2">
                                      {collapsedAssetGroups.inherited ? (
                                        <ChevronRight className="w-4 h-4 text-gray-400" />
                                      ) : (
                                        <ChevronDown className="w-4 h-4 text-gray-400" />
                                      )}
                                      <Target className="w-4 h-4 text-blue-600" />
                                      <h5 className="text-sm font-semibold text-gray-900">
                                        Inherited Assets
                                      </h5>
                                    </div>
                                    <Badge className="bg-blue-100 text-blue-700 border-blue-300">
                                      {selectedBranchAssets.original.length}
                                    </Badge>
                                  </button>
                                  {!collapsedAssetGroups.inherited && (
                                    <div className="px-3 pb-3">
                                      {selectedBranchAssets.original.length > 0 ? (
                                        <div className="bg-blue-50 rounded-lg p-3 space-y-2">
                                          {selectedBranchAssets.original.map((progress: any) => (
                                            <div key={progress.id} className="flex items-center justify-between text-sm">
                                              <div className="flex items-center space-x-2">
                                                <span className="font-medium text-gray-900">
                                                  {progress.assets?.symbol || 'N/A'}
                                                </span>
                                                <span className="text-gray-600">
                                                  {progress.assets?.company_name || 'Unknown'}
                                                </span>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        <p className="text-sm text-gray-500 text-center py-4">No inherited assets</p>
                                      )}
                                    </div>
                                  )}
                                </div>

                                {/* Rule-Based Assets (from universe rules) */}
                                <div className="border border-gray-200 rounded-lg">
                                  <button
                                    onClick={() => setCollapsedAssetGroups(prev => ({ ...prev, ruleBased: !prev.ruleBased }))}
                                    className="w-full flex items-center justify-between p-3 hover:bg-gray-50 transition-colors"
                                  >
                                    <div className="flex items-center space-x-2">
                                      {collapsedAssetGroups.ruleBased ? (
                                        <ChevronRight className="w-4 h-4 text-gray-400" />
                                      ) : (
                                        <ChevronDown className="w-4 h-4 text-gray-400" />
                                      )}
                                      <Target className="w-4 h-4 text-indigo-600" />
                                      <h5 className="text-sm font-semibold text-gray-900">
                                        Rule-Based Assets
                                      </h5>
                                    </div>
                                    <Badge className="bg-indigo-100 text-indigo-700 border-indigo-300">
                                      {selectedBranchAssets.ruleBased?.length || 0}
                                    </Badge>
                                  </button>
                                  {!collapsedAssetGroups.ruleBased && (
                                    <div className="px-3 pb-3">
                                      {selectedBranchAssets.ruleBased && selectedBranchAssets.ruleBased.length > 0 ? (
                                        <div className="bg-indigo-50 rounded-lg p-3 space-y-2">
                                          {selectedBranchAssets.ruleBased.map((progress: any) => (
                                            <div key={progress.id} className="flex items-center justify-between text-sm">
                                              <div className="flex items-center space-x-2">
                                                <span className="font-medium text-gray-900">
                                                  {progress.assets?.symbol || 'N/A'}
                                                </span>
                                                <span className="text-gray-600">
                                                  {progress.assets?.company_name || 'Unknown'}
                                                </span>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        <p className="text-sm text-gray-500 text-center py-4">No rule-based assets</p>
                                      )}
                                    </div>
                                  )}
                                </div>

                                {/* Added Assets */}
                                <div className="border border-gray-200 rounded-lg">
                                  <button
                                    onClick={() => setCollapsedAssetGroups(prev => ({ ...prev, added: !prev.added }))}
                                    className="w-full flex items-center justify-between p-3 hover:bg-gray-50 transition-colors"
                                  >
                                    <div className="flex items-center space-x-2">
                                      {collapsedAssetGroups.added ? (
                                        <ChevronRight className="w-4 h-4 text-gray-400" />
                                      ) : (
                                        <ChevronDown className="w-4 h-4 text-gray-400" />
                                      )}
                                      <Plus className="w-4 h-4 text-purple-600" />
                                      <h5 className="text-sm font-semibold text-gray-900">
                                        Manually Added Assets
                                      </h5>
                                    </div>
                                    <Badge className="bg-purple-100 text-purple-700 border-purple-300">
                                      {selectedBranchAssets.added.length}
                                    </Badge>
                                  </button>
                                  {!collapsedAssetGroups.added && (
                                    <div className="px-3 pb-3">
                                      {selectedBranchAssets.added.length > 0 ? (
                                        <div className="bg-purple-50 rounded-lg p-3 space-y-2">
                                          {selectedBranchAssets.added.map((progress: any) => (
                                            <div key={progress.id} className="flex items-center justify-between text-sm">
                                              <div className="flex items-center space-x-2">
                                                <span className="font-medium text-gray-900">
                                                  {progress.assets?.symbol || 'N/A'}
                                                </span>
                                                <span className="text-gray-600">
                                                  {progress.assets?.company_name || 'Unknown'}
                                                </span>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        <p className="text-sm text-gray-500 text-center py-4">No manually added assets</p>
                                      )}
                                    </div>
                                  )}
                                </div>

                                {/* Deleted/Removed Assets */}
                                <div className="border border-gray-200 rounded-lg">
                                  <button
                                    onClick={() => setCollapsedAssetGroups(prev => ({ ...prev, deleted: !prev.deleted }))}
                                    className="w-full flex items-center justify-between p-3 hover:bg-gray-50 transition-colors"
                                  >
                                    <div className="flex items-center space-x-2">
                                      {collapsedAssetGroups.deleted ? (
                                        <ChevronRight className="w-4 h-4 text-gray-400" />
                                      ) : (
                                        <ChevronDown className="w-4 h-4 text-gray-400" />
                                      )}
                                      <Trash2 className="w-4 h-4 text-red-600" />
                                      <h5 className="text-sm font-semibold text-gray-900">
                                        Removed Assets
                                      </h5>
                                    </div>
                                    <Badge className="bg-red-100 text-red-700 border-red-300">
                                      {selectedBranchAssets.deleted.length}
                                    </Badge>
                                  </button>
                                  {!collapsedAssetGroups.deleted && (
                                    <div className="px-3 pb-3">
                                      {selectedBranchAssets.deleted.length > 0 ? (
                                        <div className="bg-red-50 rounded-lg p-3 space-y-2">
                                          {selectedBranchAssets.deleted.map((progress: any) => (
                                            <div key={progress.id} className="flex items-center justify-between text-sm">
                                              <div className="flex items-center space-x-2">
                                                <span className="font-medium text-gray-900">
                                                  {progress.assets?.symbol || 'N/A'}
                                                </span>
                                                <span className="text-gray-600">
                                                  {progress.assets?.company_name || 'Unknown'}
                                                </span>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        <p className="text-sm text-gray-500 text-center py-4">No removed assets</p>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </Card>
                          )}

                          {/* Branch Description */}
                          {selectedBranch.description && (
                            <Card className="p-4">
                              <h4 className="text-lg font-semibold text-gray-900 mb-2">Description</h4>
                              <p className="text-sm text-gray-700 whitespace-pre-wrap">{selectedBranch.description}</p>
                            </Card>
                          )}
                        </div>
                      </div>
                    ) : (
                      <>
                        <h3 className="text-lg font-semibold text-gray-900">Workflow Branches</h3>

                        {/* Branch Status Filter */}
                        <div className="flex items-center space-x-2 border-b border-gray-200">
                      <button
                        onClick={() => setBranchStatusFilter('all')}
                        className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                          branchStatusFilter === 'all'
                            ? 'border-blue-500 text-blue-600'
                            : 'border-transparent text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        All
                      </button>
                      <button
                        onClick={() => setBranchStatusFilter('archived')}
                        className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                          branchStatusFilter === 'archived'
                            ? 'border-blue-500 text-blue-600'
                            : 'border-transparent text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        Archived
                      </button>
                      <button
                        onClick={() => setBranchStatusFilter('deleted')}
                        className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                          branchStatusFilter === 'deleted'
                            ? 'border-blue-500 text-blue-600'
                            : 'border-transparent text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        Deleted
                      </button>
                    </div>

                    {isLoadingBranches ? (
                      <Card>
                        <div className="text-center py-12">
                          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mb-4"></div>
                          <p className="text-sm text-gray-500">Loading branches...</p>
                        </div>
                      </Card>
                    ) : (
                      <Card>
                        <div className="p-4">
                          <div className="space-y-2">

                            {/* Template Versions with Branches - Only show for 'all' filter */}
                            {console.log('🎛️ Branch Status Filter:', branchStatusFilter)}
                            {branchStatusFilter === 'all' ? (
                              <>
                                {console.log('✅ Filter is ALL - Rendering template versions')}
                                {console.log('🔍 Template Versions:', templateVersions)}
                                {console.log('🔍 Root Branches:', rootBranches)}
                                {console.log('🔍 Template Versions Check:', templateVersions && templateVersions.length > 0)}
                                {/* Show all template versions with their branches */}
                                {templateVersions && templateVersions.length > 0 && templateVersions
                                  .sort((a, b) => (b.version_number || 0) - (a.version_number || 0))
                                  .map(version => {
                                    console.log('🎨 Rendering template version:', version.version_name, version.version_number)
                                    // Get branches for this version
                                    const versionBranches = rootBranches.filter(b =>
                                      (b.template_version_number || 1) === version.version_number
                                    )
                                    console.log(`📦 Version ${version.version_number} has ${versionBranches.length} branches`)
                                    const isVersionCollapsed = collapsedBranches.has(`version-${version.id}`)

                                    return (
                                      <div key={version.id} className="mb-3">
                                        <div className="bg-indigo-50 border-2 border-indigo-200 rounded-lg p-4">
                                          <div className="flex items-center justify-between">
                                            <div className="flex items-center space-x-2 flex-1">
                                              {/* Collapse/Expand Toggle */}
                                              <button
                                                onClick={() => {
                                                  const versionKey = `version-${version.id}`
                                                  setCollapsedBranches(prev => {
                                                    const next = new Set(prev)
                                                    if (next.has(versionKey)) {
                                                      next.delete(versionKey)
                                                    } else {
                                                      next.add(versionKey)
                                                    }
                                                    return next
                                                  })
                                                }}
                                                className="flex-shrink-0 p-1 hover:bg-indigo-200 rounded transition-colors"
                                              >
                                                {isVersionCollapsed ? (
                                                  <ChevronRight className="w-4 h-4 text-indigo-600" />
                                                ) : (
                                                  <ChevronDown className="w-4 h-4 text-indigo-600" />
                                                )}
                                              </button>
                                              <Orbit className="w-5 h-5 text-indigo-600" />
                                              <h3 className="text-base font-semibold text-indigo-900">{selectedWorkflow.name}</h3>
                                              <span className="px-2 py-0.5 rounded-full text-xs bg-indigo-200 text-indigo-800">
                                                Template {formatVersion(version.version_number, version.major_version, version.minor_version)}
                                              </span>
                                              {version.is_active && (
                                                <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 border border-green-300">
                                                  Active
                                                </span>
                                              )}
                                              {isVersionCollapsed && versionBranches.length > 0 && (
                                                <span className="px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700 border border-blue-300">
                                                  {versionBranches.length} {versionBranches.length === 1 ? 'branch' : 'branches'}
                                                </span>
                                              )}
                                            </div>
                                            {!isVersionCollapsed && (selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner' || selectedWorkflow.user_permission === 'write') && (
                                              <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => {
                                                  setShowCreateBranchModal(true)
                                                  setPreselectedSourceBranch(null)
                                                }}
                                                className="border-indigo-300 text-indigo-700 hover:bg-indigo-100"
                                              >
                                                <GitBranch className="w-3 h-3 mr-1" />
                                                Branch
                                              </Button>
                                            )}
                                          </div>
                                          {!isVersionCollapsed && (
                                            <p className="text-xs text-indigo-700 mt-2 ml-11">
                                              Template version • {versionBranches.length} {versionBranches.length === 1 ? 'branch' : 'branches'}
                                            </p>
                                          )}
                                        </div>

                                        {/* Branches for this version */}
                                        {!isVersionCollapsed && versionBranches.length > 0 && (
                                          <div className="ml-4 mt-2">
                                            {versionBranches.map((node, idx) =>
                                              renderBranchNode(node, idx === versionBranches.length - 1, [])
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })}

                                {/* Empty state if no template versions */}
                                {(!templateVersions || templateVersions.length === 0) && (
                                  <div className="text-center py-8">
                                    <Orbit className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                                    <h3 className="text-base font-medium text-gray-900 mb-2">No template versions yet</h3>
                                    <p className="text-sm text-gray-500">
                                      Template versions will appear here once you create them
                                    </p>
                                  </div>
                                )}
                              </>
                            ) : (
                              /* Archived/Deleted filter - show flat list without version grouping */
                              <div>
                                {rootBranches.length > 0 ? (
                                  rootBranches.map((node, idx) =>
                                    renderBranchNode(node, idx === rootBranches.length - 1, [])
                                  )
                                ) : (
                                  <div className="text-center py-8">
                                    <Network className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                                    <h3 className="text-base font-medium text-gray-900 mb-2">No {branchStatusFilter} branches yet</h3>
                                    <p className="text-sm text-gray-500">
                                      When workflow branches with this status are created, they will appear here
                                    </p>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </Card>
                    )}
                  </>
                )}
                  </div>
                )
              })()}

              {/* Models View */}
              {activeView === 'models' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">Document Models</h3>
                    {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                      <Button size="sm" onClick={() => setShowUploadTemplateModal(true)}>
                        <Plus className="w-4 h-4 mr-2" />
                        Upload Model
                      </Button>
                    )}
                  </div>

                  <div className="space-y-3">
                    {/* Models List */}
                    {templatesLoading ? (
                      <div className="text-center py-12">
                        <p className="text-gray-500">Loading models...</p>
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
                          <p className="text-sm text-gray-500 font-medium">No models uploaded yet</p>
                          {(selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner') && (
                            <p className="text-xs text-gray-400 mt-2">Click "Upload Model" to add document models for your team</p>
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
          <div className="flex-1 flex flex-col h-full overflow-hidden">
            {/* Dashboard Header */}
            <div className="bg-white border-b border-gray-200 px-6 py-4">
              <h1 className="text-xl font-bold text-gray-900">Workflow Dashboard</h1>
              <p className="text-gray-600 text-sm">Overview of all active workflows organized by cadence and activity</p>
            </div>

            <div className="flex-1 p-6 bg-gray-50 overflow-y-auto">
              {isLoading ? (
                /* Loading State */
                <div className="space-y-6 animate-pulse">
                  {/* Loading Skeleton for Cadence Map Card */}
                  <Card>
                    <div className="p-6 border-b border-gray-200">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center">
                          <div className="w-6 h-6 bg-gray-200 rounded mr-3"></div>
                          <div>
                            <div className="h-6 bg-gray-200 rounded w-48 mb-2"></div>
                            <div className="h-4 bg-gray-200 rounded w-64"></div>
                          </div>
                        </div>
                        <div className="h-9 w-32 bg-gray-200 rounded"></div>
                      </div>
                    </div>
                    <div className="p-6 space-y-6">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="space-y-3">
                          <div className="flex items-center space-x-2">
                            <div className="w-3 h-3 bg-gray-300 rounded-full"></div>
                            <div className="h-4 bg-gray-200 rounded w-24"></div>
                          </div>
                          <div className="bg-white border border-gray-200 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center space-x-3">
                                <div className="w-3 h-3 bg-gray-300 rounded-full"></div>
                                <div className="h-5 bg-gray-200 rounded w-40"></div>
                              </div>
                              <div className="flex items-center space-x-4">
                                <div className="h-4 w-8 bg-gray-200 rounded"></div>
                                <div className="h-4 w-8 bg-gray-200 rounded"></div>
                                <div className="h-4 w-8 bg-gray-200 rounded"></div>
                              </div>
                            </div>
                            <div className="mt-3 pt-3 border-t border-gray-100">
                              <div className="h-3 bg-gray-200 rounded w-full"></div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                  {/* Loading Skeleton for Quick Stats */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <Card>
                      <div className="p-4 border-b border-gray-200">
                        <div className="h-5 bg-gray-200 rounded w-32"></div>
                      </div>
                      <div className="p-4 space-y-4">
                        {[1, 2, 3, 4].map((i) => (
                          <div key={i} className="flex items-center justify-between">
                            <div className="h-4 bg-gray-200 rounded w-32"></div>
                            <div className="h-6 bg-gray-200 rounded w-12"></div>
                          </div>
                        ))}
                      </div>
                    </Card>
                  </div>
                </div>
              ) : filteredWorkflows.length === 0 ? (
                /* Empty State */
                <div className="flex items-center justify-center h-full">
                  <div className="text-center max-w-md">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Orbit className="w-8 h-8 text-gray-400" />
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
                                        <div className="flex items-center justify-between">
                                          <div className="flex items-center space-x-3">
                                            <div
                                              className="w-3 h-3 rounded-full flex-shrink-0"
                                              style={{ backgroundColor: workflow.color }}
                                            />
                                            <div>
                                              <div className="flex items-center space-x-2">
                                                <h5 className="text-sm font-semibold text-gray-900">{workflow.name}</h5>
                                                {workflow.active_version_number && (
                                                  <span className="text-xs font-medium text-purple-600 bg-purple-50 px-2 py-0.5 rounded">
                                                    {formatVersion(workflow.active_version_number)}
                                                  </span>
                                                )}
                                              </div>
                                            </div>
                                          </div>

                                          {/* Activity Stats */}
                                          <div className="flex items-center space-x-4 text-xs text-gray-500">
                                            <div className="flex items-center space-x-1" title="Active assets in progress">
                                              <Activity className="w-3 h-3 text-green-500" />
                                              <span>{workflow.active_assets}</span>
                                            </div>
                                            <div className="flex items-center space-x-1" title="Total usage count">
                                              <Target className="w-3 h-3 text-blue-500" />
                                              <span>{workflow.usage_count}</span>
                                            </div>
                                            <div className="flex items-center space-x-1" title="Completed assets">
                                              <CheckSquare className="w-3 h-3 text-gray-500" />
                                              <span>{workflow.completed_assets}</span>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              )
                            })
                          })()}
                        </div>
                      ) : (
                        !isLoading && (
                          <div className="text-center py-12">
                            <BarChart3 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                            <h3 className="text-lg font-medium text-gray-900 mb-2">No workflows available</h3>
                            <p className="text-gray-500 mb-6">Create your first workflow to see the cadence visualization</p>
                            <Button onClick={handleCreateWorkflow}>
                              <Plus className="w-4 h-4 mr-2" />
                              Create Workflow
                            </Button>
                          </div>
                        )
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

      {/* Add Admin Modal */}
      {showInviteModal && selectedWorkflow && (
        <AddAdminModal
          workflowId={selectedWorkflow.id}
          workflowName={selectedWorkflow.name}
          onClose={() => setShowInviteModal(false)}
          onAdd={async (userId) => {
            try {
              // Get the current user
              const { data: { user } } = await supabase.auth.getUser()
              if (!user) throw new Error('Not authenticated')

              // Create the workflow collaboration with admin permission
              const { error: inviteError } = await supabase
                .from('workflow_collaborations')
                .insert({
                  workflow_id: selectedWorkflow.id,
                  user_id: userId,
                  permission: 'admin',
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

              // Refresh the workflow data to show the new admin
              queryClient.invalidateQueries({ queryKey: ['workflows-full'] })
              queryClient.invalidateQueries({ queryKey: ['workflow-team', selectedWorkflow.id] })
              queryClient.invalidateQueries({ queryKey: ['workflow-collaborators', selectedWorkflow.id] })

              setShowInviteModal(false)
            } catch (error) {
              console.error('Error adding admin:', error)
              alert('Failed to add admin. Please try again.')
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
          preselectedSourceBranch={preselectedSourceBranch}
          onClose={() => {
            setShowCreateBranchModal(false)
            setPreselectedSourceBranch(null)
          }}
          onSubmit={(branchName, branchSuffix, copyProgress, sourceBranchId) => {
            createBranchMutation.mutate({
              workflowId: selectedWorkflow.id,
              branchName,
              branchSuffix,
              copyProgress,
              sourceBranchId
            })
            setPreselectedSourceBranch(null)
          }}
        />
      )}

      {/* Universe Preview Modal */}
      {showUniversePreview && selectedWorkflow && (
        <UniversePreviewModal
          workflowId={selectedWorkflow.id}
          rules={universeRulesState}
          onClose={() => setShowUniversePreview(false)}
        />
      )}

      {/* Template Versions Modal */}
      {selectedWorkflow && (
        <TemplateVersionsModal
          isOpen={showTemplateVersions}
          onClose={() => setShowTemplateVersions(false)}
          workflowId={selectedWorkflow.id}
          workflowName={selectedWorkflow.name}
          versions={templateVersions || []}
          canCreateVersion={selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner'}
          onCreateVersion={() => setShowCreateVersion(true)}
          onViewVersion={(versionId) => {
            setSelectedVersionId(versionId)
            setShowVersionDetail(true)
          }}
          onActivateVersion={(versionId) => {
            if (confirm('Are you sure you want to activate this version? This will update the workflow to use this version\'s configuration.')) {
              activateVersionMutation.mutate(versionId)
            }
          }}
          canActivateVersion={selectedWorkflow.user_permission === 'admin' || selectedWorkflow.user_permission === 'owner'}
        />
      )}

      {/* Create Version Modal */}
      {selectedWorkflow && (
        <CreateVersionModal
          isOpen={showCreateVersion}
          onClose={() => setShowCreateVersion(false)}
          workflowName={selectedWorkflow.name}
          currentVersionNumber={templateVersions?.length ? Math.max(...templateVersions.map(v => v.version_number)) : 0}
          detectedVersionType={detectVersionType()}
          onCreateVersion={handleCreateVersion}
          previewData={{
            stageCount: selectedWorkflow.stages?.length || 0,
            checklistCount: workflowChecklistTemplates?.filter(c => c.workflow_id === selectedWorkflow.id).length || 0,
            ruleCount: automationRules?.filter(r => r.workflow_id === selectedWorkflow.id).length || 0
          }}
        />
      )}

      {/* Version Created Success Modal */}
      {selectedWorkflow && createdVersionInfo && (
        <VersionCreatedModal
          isOpen={showVersionCreated}
          onClose={() => {
            setShowVersionCreated(false)
            setCreatedVersionInfo(null)
          }}
          versionNumber={createdVersionInfo.versionNumber}
          versionName={createdVersionInfo.versionName}
          versionType={createdVersionInfo.versionType}
          workflowName={selectedWorkflow.name}
          onViewVersion={() => {
            setShowTemplateVersions(true)
          }}
        />
      )}

      {/* Version Detail Modal */}
      {selectedWorkflow && selectedVersionId && (
        <VersionDetailModal
          isOpen={showVersionDetail}
          onClose={() => {
            setShowVersionDetail(false)
            setSelectedVersionId(null)
          }}
          version={templateVersions?.find(v => v.id === selectedVersionId)!}
          workflowName={selectedWorkflow.name}
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
          cadenceTimeframe={selectedWorkflow.cadence_timeframe}
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
          cadenceTimeframe={selectedWorkflow.cadence_timeframe}
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

      {/* End Branch Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!branchToEnd}
        onClose={() => {
          if (!closeBranchMutation.isPending) {
            setBranchToEnd(null)
          }
        }}
        onConfirm={() => {
          if (branchToEnd) {
            closeBranchMutation.mutate(branchToEnd.id)
          }
        }}
        title="End Workflow Branch?"
        message={`Are you sure you want to end "${branchToEnd?.name}"? This will move it to inactive status and it can no longer be used for new assets.`}
        confirmText="End Branch"
        cancelText="Cancel"
        variant="danger"
        isLoading={closeBranchMutation.isPending}
      />

      {/* Continue Branch Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!branchToContinue}
        onClose={() => {
          if (!continueBranchMutation.isPending) {
            setBranchToContinue(null)
          }
        }}
        onConfirm={() => {
          if (branchToContinue) {
            continueBranchMutation.mutate(branchToContinue.id)
          }
        }}
        title="Continue Workflow Branch?"
        message={`Are you sure you want to continue "${branchToContinue?.name}"? This will reactivate the branch and allow new assets to be assigned to it.`}
        confirmText="Continue Branch"
        cancelText="Cancel"
        variant="primary"
        isLoading={continueBranchMutation.isPending}
      />

      {/* Cancel Template Edit Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showCancelConfirmation}
        onClose={() => setShowCancelConfirmation(false)}
        onConfirm={() => {
          setShowCancelConfirmation(false)
          exitTemplateEditMode()
        }}
        title="Discard Template Changes?"
        message={templateChanges.length > 0
          ? `You have ${templateChanges.length} unsaved change${templateChanges.length !== 1 ? 's' : ''}. Are you sure you want to discard all changes and exit edit mode? This action cannot be undone.`
          : 'Are you sure you want to exit edit mode?'}
        confirmText="Discard Changes"
        cancelText="Keep Editing"
        variant="danger"
      />

      {/* Remove Admin Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!removeAdminConfirm}
        onClose={() => {
          if (!removeCollaboratorMutation.isPending) {
            setRemoveAdminConfirm(null)
          }
        }}
        onConfirm={() => {
          if (removeAdminConfirm) {
            removeCollaboratorMutation.mutate(removeAdminConfirm.id)
            setRemoveAdminConfirm(null)
          }
        }}
        title="Remove Admin?"
        message={`Are you sure you want to remove ${removeAdminConfirm?.name} as an admin from this workflow? They will lose all administrative privileges.`}
        confirmText="Remove Admin"
        cancelText="Cancel"
        variant="danger"
        isLoading={removeCollaboratorMutation.isPending}
      />

      {/* Remove Stakeholder Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!removeStakeholderConfirm}
        onClose={() => {
          if (!removeStakeholderMutation.isPending) {
            setRemoveStakeholderConfirm(null)
          }
        }}
        onConfirm={() => {
          if (removeStakeholderConfirm) {
            removeStakeholderMutation.mutate(removeStakeholderConfirm.id)
            setRemoveStakeholderConfirm(null)
          }
        }}
        title="Remove Stakeholder?"
        message={`Are you sure you want to remove ${removeStakeholderConfirm?.name} as a stakeholder from this workflow? They will no longer have access to view this workflow.`}
        confirmText="Remove Stakeholder"
        cancelText="Cancel"
        variant="danger"
        isLoading={removeStakeholderMutation.isPending}
      />

      {/* Archive Branch Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!branchToArchive}
        onClose={() => {
          if (!archiveBranchMutation.isPending) {
            setBranchToArchive(null)
          }
        }}
        onConfirm={() => {
          if (branchToArchive) {
            archiveBranchMutation.mutate(branchToArchive.id)
          }
        }}
        title="Archive Branch?"
        message={`Are you sure you want to archive "${branchToArchive?.name}"? The branch will be hidden from view but all data will be preserved and can be restored later.`}
        confirmText="Archive Branch"
        cancelText="Cancel"
        variant="warning"
        isLoading={archiveBranchMutation.isPending}
      />

      {/* Delete Branch Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!branchToDelete}
        onClose={() => {
          if (!deleteBranchMutation.isPending) {
            setBranchToDelete(null)
          }
        }}
        onConfirm={() => {
          if (branchToDelete) {
            deleteBranchMutation.mutate(branchToDelete.id)
          }
        }}
        title="Delete Branch?"
        message={`Are you sure you want to delete "${branchToDelete?.name}"? The branch will be marked as deleted but can be restored later from the Deleted filter.`}
        confirmText="Delete Branch"
        cancelText="Cancel"
        variant="danger"
        isLoading={deleteBranchMutation.isPending}
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
                  <h3 className="text-lg font-medium text-gray-900">
                    {selectedWorkflow?.archived ? 'Remove Archived Workflow' : 'Delete Workflow'}
                  </h3>
                  <p className="text-sm text-gray-600">
                    Data will be preserved for recovery
                  </p>
                </div>
              </div>
              <p className="text-gray-700 mb-6">
                {selectedWorkflow?.archived ? (
                  <>
                    Are you sure you want to remove <span className="font-semibold">{selectedWorkflow?.name}</span> from the archived section?
                    This will hide it from the interface, but <strong>all data will be preserved</strong> and can be recovered by the application team if needed.
                  </>
                ) : (
                  <>
                    Are you sure you want to delete <span className="font-semibold">{selectedWorkflow?.name}</span>?
                    The workflow will be removed from the main interface but all data will be preserved. You can restore it later from the Deleted section.
                  </>
                )}
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
                  {deleteWorkflowMutation.isPending ? 'Removing...' : selectedWorkflow?.archived ? 'Yes, Remove' : 'Yes, Delete'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}


      {/* Unarchive Workflow Confirmation Modal */}
      {showUnarchiveModal && workflowToUnarchive && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <div className="flex items-center mb-4">
                <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mr-4">
                  <CheckCircle className="w-6 h-6 text-green-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Restore Workflow</h3>
                  <p className="text-sm text-gray-500">Move workflow back to active list</p>
                </div>
              </div>
              <p className="text-gray-700 mb-6">
                Are you sure you want to restore <span className="font-semibold">{selectedWorkflow?.name}</span>?
                This workflow will be moved back to your active workflows list and will be available for use.
              </p>
              <div className="flex justify-end space-x-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowUnarchiveModal(false)
                    setWorkflowToUnarchive(null)
                  }}
                >
                  Cancel
                </Button>
                <Button
                  className="bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => unarchiveWorkflowMutation.mutate(workflowToUnarchive)}
                  disabled={unarchiveWorkflowMutation.isPending}
                >
                  {unarchiveWorkflowMutation.isPending ? 'Restoring...' : 'Yes, Restore'}
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

function AddAdminModal({ workflowId, workflowName, onClose, onAdd }: {
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
          <h2 className="text-lg font-semibold text-gray-900">Add Admin</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mb-4">
          <p className="text-sm text-gray-600 mb-2">
            Add an admin to "{workflowName}"
          </p>
          <p className="text-xs text-gray-500">
            Admins can manage the workflow, add/remove team members, and edit all settings.
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
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                <div className="flex items-center space-x-2">
                  <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
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
              Add Admin
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

function AddRuleModal({ workflowId, workflowName, workflowStages, cadenceTimeframe, onClose, onSave }: {
  workflowId: string
  workflowName: string
  workflowStages: WorkflowStage[]
  cadenceTimeframe?: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'semi-annually' | 'annually' | 'persistent'
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100] p-4 pt-32 pb-8">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[calc(100vh-10rem)] overflow-hidden flex flex-col">
        {/* Fixed Header */}
        <div className="p-6 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center justify-between">
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
        </div>

        {/* Scrollable Content */}
        <div className="p-6 overflow-y-auto flex-1">

        <form id="add-rule-form" onSubmit={handleSubmit} className="space-y-6">
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
                <optgroup label="Create New Branch">
                  <option value="branch_copy">Create a copy (keep current progress)</option>
                  <option value="branch_nocopy">Create a new branch (fresh start)</option>
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
                    Add text that will be appended to "{workflowName}". Use dynamic codes that automatically update with the current date.
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
          <div className="flex items-center py-3">
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
        </form>
        </div>

        {/* Fixed Footer */}
        <div className="p-4 border-t border-gray-200 flex justify-end space-x-3 flex-shrink-0 bg-gray-50">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="add-rule-form">
            Create Rule
          </Button>
        </div>
      </div>
    </div>
  )
}

function EditRuleModal({ rule, workflowName, workflowStages, cadenceTimeframe, onClose, onSave }: {
  rule: any
  workflowName: string
  workflowStages: WorkflowStage[]
  cadenceTimeframe?: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'semi-annually' | 'annually' | 'persistent'
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100] p-4 pt-32 pb-8">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[calc(100vh-10rem)] overflow-hidden flex flex-col">
        {/* Fixed Header */}
        <div className="p-6 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center justify-between">
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
        </div>

        {/* Scrollable Content */}
        <div className="p-6 overflow-y-auto flex-1">

        <form id="edit-rule-form" onSubmit={handleSubmit} className="space-y-6">
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
                <optgroup label="Create New Branch">
                  <option value="branch_copy">Create a copy (keep current progress)</option>
                  <option value="branch_nocopy">Create a new branch (fresh start)</option>
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
                    Add text that will be appended to "{workflowName}". Use dynamic codes that automatically update with the current date.
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
          <div className="flex items-center py-3">
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
        </form>
        </div>

        {/* Fixed Footer */}
        <div className="p-4 border-t border-gray-200 flex justify-end space-x-3 flex-shrink-0 bg-gray-50">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="edit-rule-form">
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  )
}