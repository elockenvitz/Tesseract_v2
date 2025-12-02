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
import { SimplifiedUniverseBuilder } from '../components/workflow/SimplifiedUniverseBuilder'
import {
  OverviewView,
  StagesView,
  UniverseView,
  ModelsView,
  AdminsView,
  CadenceView,
  BranchesView
} from '../components/workflow/views'
import { CreateBranchModal } from '../components/modals/CreateBranchModal'
import { UniversePreviewModal } from '../components/modals/UniversePreviewModal'
import { TemplateVersionsModal } from '../components/modals/TemplateVersionsModal'
import { CreateVersionModal } from '../components/modals/CreateVersionModal'
import { VersionCreatedModal } from '../components/modals/VersionCreatedModal'
import { VersionDetailModal } from '../components/modals/VersionDetailModal'
import {
  AddStageModal,
  EditStageModal,
  AddChecklistItemModal,
  EditChecklistItemModal,
  InviteUserModal,
  AddStakeholderModal,
  AddAdminModal,
  AccessRequestModal,
  AddRuleModal,
  EditRuleModal
} from '../components/workflow/modals'
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
  user_permission?: 'read' | 'admin'
  can_archive?: boolean  // Only owners and admin collaborators can archive
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

  // Context menu state for workflow right-click
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean
    x: number
    y: number
    workflow: WorkflowWithStats | null
    isArchived: boolean
  }>({
    isOpen: false,
    x: 0,
    y: 0,
    workflow: null,
    isArchived: false
  })
  const contextMenuRef = useRef<HTMLDivElement>(null)

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
  const [collapsedTemplateVersions, setCollapsedTemplateVersions] = useState<Set<string>>(new Set())
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

      // First, get all template versions for this workflow to show in the UI
      const { data: templateVersions } = await supabase
        .from('workflow_template_versions')
        .select('id, version_number, is_active')
        .eq('workflow_id', selectedWorkflow.id)
        .order('version_number', { ascending: false })

      // Then get all direct branches of this workflow
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

      if (error) {
        console.error('Error fetching workflow branches:', error)
        throw error
      }

      // Create a map to calculate branch levels
      const branchMap = new Map((data || []).map(b => [b.id, b]))

      const calculateBranchLevel = (branch: any): number => {
        if (!branch.source_branch_id) return 0
        const parent = branchMap.get(branch.source_branch_id)
        if (!parent) return 1 // Parent is outside this set, assume level 1
        return calculateBranchLevel(parent) + 1
      }

      // Helper to convert integer version to string format (preserves .0)
      const formatVersionNumber = (version: number | null | undefined): string | undefined => {
        if (!version) return undefined

        // Handle different storage formats:
        // Single digit (1, 2, 3) -> 1.0, 2.0, 3.0 (major versions)
        // Three digits (101, 102, 103) -> 1.1, 1.2, 1.3 (minor versions)
        if (version < 100) {
          // Single or double digit: treat as major.0
          return `${version}.0`
        } else {
          // Three digits: first digit is major, last two digits are minor
          const major = Math.floor(version / 100)
          const minor = version % 100
          return `${major}.${minor}`
        }
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

        // Map to BranchesView expected format
        return {
          id: branch.id,
          workflow_id: selectedWorkflow.id,
          branch_name: branch.name,
          branch_suffix: branch.branch_suffix || undefined,
          parent_branch_id: branch.source_branch_id || undefined,
          branch_level: calculateBranchLevel(branch),
          is_active: branch.status === 'active',
          is_clean: !activeAssets || activeAssets === 0,
          is_archived: branch.archived || false,
          is_deleted: branch.deleted || false,
          created_at: branch.branched_at || branch.created_at,
          created_by: '', // Not fetched in this query
          archived_at: branch.archived_at || undefined,
          archived_by: undefined,
          deleted_at: branch.deleted_at || undefined,
          deleted_by: undefined,
          template_version_number: formatVersionNumber(branch.template_version_number),
          total_assets: totalAssets,
          active_assets: activeAssets,
          completed_assets: completedAssets
        }
      }))

      // Get all unique template versions that have branches in the current filter
      const branchVersions = new Set<string>()
      branchesWithStats.forEach(b => {
        if (b.template_version_number) {
          branchVersions.add(b.template_version_number.toString())
        }
      })

      // Create placeholder entries for template tiles
      // These allow the UI to group branches by template version
      const placeholderBranches = Array.from(branchVersions).map(versionStr => ({
        id: `placeholder-${versionStr}`,
        workflow_id: selectedWorkflow.id,
        branch_name: selectedWorkflow.name,
        branch_suffix: undefined,
        parent_branch_id: undefined,
        branch_level: 0,
        is_active: false,
        is_clean: true,
        is_archived: false,
        is_deleted: false,
        created_at: new Date().toISOString(),
        created_by: '',
        template_version_number: versionStr,
        total_assets: 0,
        active_assets: 0,
        completed_assets: 0,
        is_placeholder: true
      }))

      // For "all" filter, also add placeholders for template versions with no branches
      if (branchStatusFilter === 'all' && templateVersions) {
        templateVersions.forEach(tv => {
          const formattedVersion = formatVersionNumber(tv.version_number)?.toString()
          if (formattedVersion && !branchVersions.has(formattedVersion)) {
            placeholderBranches.push({
              id: `placeholder-${tv.id}`,
              workflow_id: selectedWorkflow.id,
              branch_name: selectedWorkflow.name,
              branch_suffix: undefined,
              parent_branch_id: undefined,
              branch_level: 0,
              is_active: tv.is_active || false,
              is_clean: true,
              is_archived: false,
              is_deleted: false,
              created_at: new Date().toISOString(),
              created_by: '',
              template_version_number: formattedVersion,
              total_assets: 0,
              active_assets: 0,
              completed_assets: 0,
              is_placeholder: true
            })
          }
        })
      }

      return [...branchesWithStats, ...placeholderBranches]
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
      const { data: progressRecords, error: progressError } = await supabase
        .from('asset_workflow_progress')
        .select('*')
        .eq('workflow_id', selectedBranch.id)

      if (progressError) {
        console.error('🚨 Error fetching branch progress:', progressError)
        return null
      }

      // Fetch all unique asset IDs in a single query using OR conditions
      const assetIds = [...new Set((progressRecords || []).map(p => p.asset_id))]

      let currentAssets = progressRecords || []

      if (assetIds.length > 0) {
        // Build OR query for assets
        const orQuery = assetIds.map(id => `id.eq.${id}`).join(',')

        const { data: assetsData, error: assetsError } = await supabase
          .from('assets')
          .select('id, symbol, company_name')
          .or(orQuery)

        if (assetsError) {
          console.error('🚨 ASSET FETCH ERROR:', assetsError)
        }

        if (!assetsError && assetsData) {
          // Create a map for quick lookup
          const assetsMap = Object.fromEntries(assetsData.map(a => [a.id, a]))

          // Attach asset data to progress records
          currentAssets = progressRecords.map(p => ({
            ...p,
            assets: assetsMap[p.asset_id] || null
          }))
        } else {
          console.error('🚨 DEBUG: Skipping join - assetsError:', assetsError, 'assetsData:', assetsData)
        }
      }

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
      }

      // Fetch universe rules from the PARENT WORKFLOW's workflow_universe_rules table
      // These rules determine which assets are "rule-based" (vs inherited or manually added)
      let universeRules: any[] = []
      let ruleBasedAssetIds = new Set<string>()

      if (selectedWorkflow?.id) {
        // Fetch universe rules from the workflow_universe_rules table
        const { data: workflowRules, error: rulesError } = await supabase
          .from('workflow_universe_rules')
          .select('*')
          .eq('workflow_id', selectedWorkflow.id)
          .eq('is_active', true)
          .order('sort_order')

        if (workflowRules && workflowRules.length > 0) {
          universeRules = workflowRules

          // Fetch assets that match these universe rules
          for (const rule of universeRules) {
            if (rule.rule_type === 'sector' && rule.rule_config?.sectors) {
              const { data: sectorAssets, error: sectorError } = await supabase
                .from('assets')
                .select('id')
                .in('sector', rule.rule_config.sectors)

              sectorAssets?.forEach(a => ruleBasedAssetIds.add(a.id))
            } else if (rule.rule_type === 'theme' && rule.rule_config?.theme_ids) {
              // Fetch assets from theme relationships
              const { data: themeAssets, error: themeError } = await supabase
                .from('theme_assets')
                .select('asset_id')
                .in('theme_id', rule.rule_config.theme_ids)

              themeAssets?.forEach(a => ruleBasedAssetIds.add(a.asset_id))
            }
          }
        }
      }

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

      return result
    },
    enabled: !!selectedBranch?.id && showBranchOverviewModal,
    staleTime: 0,
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
        return []
      }

      const { data, error } = await supabase
        .from('workflow_template_versions')
        .select('*')
        .eq('workflow_id', selectedWorkflow.id)
        .order('version_number', { ascending: false })

      if (error) {
        console.error('❌ Error fetching template versions:', error)
        throw error
      }

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
    enabled: !!selectedWorkflow?.id && (selectedWorkflow.user_permission === 'admin'),
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
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id

      if (!userId) {
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
        const creatorEmail = creator?.email || ''

        // Determine user permission (simplified to admin or read)
        let userPermission: 'read' | 'admin' = 'read'
        let canArchive = false  // Only owners and admin collaborators can archive

        if (workflow.created_by === userId) {
          // Owner = admin and can archive
          userPermission = 'admin'
          canArchive = true
        } else if (collaborationMap.has(workflow.id)) {
          // User is a collaborator - use their permission level (takes precedence over stakeholder)
          const collabPermission = collaborationMap.get(workflow.id)
          // Map write/admin/owner to admin, everything else to read
          userPermission = (collabPermission === 'admin' || collabPermission === 'write' || collabPermission === 'owner') ? 'admin' : 'read'
          // Only admin collaborators can archive (not write)
          canArchive = (collabPermission === 'admin' || collabPermission === 'owner')
        } else if (stakeholderWorkflowIds.has(workflow.id)) {
          // User is a stakeholder - read-only access
          userPermission = 'read'
        } else if (workflow.name === 'Research Workflow') {
          // For Research Workflow, all logged-in users can be admin but cannot archive
          userPermission = 'admin'
          canArchive = false
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
          creator_email: creatorEmail,
          is_favorited: favoritedWorkflowIds.has(workflow.id),
          stages: workflowStagesData,
          user_permission: userPermission,
          can_archive: canArchive,
          usage_stats: workflowUsage, // Include detailed usage stats for progress calculation
          active_version_number: activeVersionMap.get(workflow.id) // Add active version number
        }
      })

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

        // Determine user permission - only owner can restore archived workflows
        let userPermission: 'read' | 'admin' = 'read'
        let canArchive = false
        if (workflow.created_by === userId) {
          userPermission = 'admin'
          canArchive = true  // Owner can restore (unarchive)
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
          can_archive: canArchive,
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
      console.log('🗄️ Archive mutation started for workflow:', workflowId)
      const { data: { user } } = await supabase.auth.getUser()

      const { data, error } = await supabase
        .from('workflows')
        .update({
          archived: true,
          archived_at: new Date().toISOString(),
          archived_by: user?.id
        })
        .eq('id', workflowId)
        .select()

      console.log('🗄️ Archive mutation result:', { data, error })
      if (error) throw error
      return data
    },
    onSuccess: async (data, deletedWorkflowId) => {
      console.log('🗄️ Archive mutation onSuccess:', { data, deletedWorkflowId })
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

      // Invalidate both active and archived workflow queries using predicate for reliable matching
      await queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0]
          return key === 'workflows-full' || key === 'workflows-archived'
        }
      })
      // Force refetch to ensure UI updates
      await queryClient.refetchQueries({
        predicate: (query) => {
          const key = query.queryKey[0]
          return key === 'workflows-full' || key === 'workflows-archived'
        }
      })
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
      // Invalidate and refetch queries using predicate for reliable matching
      await queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0]
          return key === 'workflows-full' || key === 'workflows-archived'
        }
      })
      await queryClient.refetchQueries({
        predicate: (query) => {
          const key = query.queryKey[0]
          return key === 'workflows-full' || key === 'workflows-archived'
        }
      })

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
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0]
          return key === 'workflows-full' || key === 'deleted-workflows'
        }
      })
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
    onSuccess: async () => {
      // Invalidate and refetch using predicate for reliable matching
      await queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0]
          return key === 'workflows-full' || key === 'workflows-archived'
        }
      })
      await queryClient.refetchQueries({
        predicate: (query) => {
          const key = query.queryKey[0]
          return key === 'workflows-full' || key === 'workflows-archived'
        }
      })
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
    // Reset universe rules to initial state
    setUniverseRulesState(initialUniverseRules)
    // Refetch data to reset any optimistic updates
    queryClient.invalidateQueries({ queryKey: ['workflows'] })
    queryClient.invalidateQueries({ queryKey: ['workflow-stages'] })
    queryClient.invalidateQueries({ queryKey: ['workflow-checklist-templates'] })
    queryClient.invalidateQueries({ queryKey: ['workflow-automation-rules'] })
    queryClient.invalidateQueries({ queryKey: ['workflow-universe-rules', selectedWorkflow?.id] })
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

  // Context menu handlers for workflow right-click
  const handleWorkflowContextMenu = (event: React.MouseEvent, workflow: WorkflowWithStats, isArchived: boolean = false) => {
    event.preventDefault()
    setContextMenu({
      isOpen: true,
      x: event.clientX,
      y: event.clientY,
      workflow,
      isArchived
    })
  }

  const handleContextMenuArchive = () => {
    console.log('🗄️ handleContextMenuArchive called, workflow:', contextMenu.workflow)
    if (contextMenu.workflow) {
      console.log('🗄️ Setting workflowToDelete:', contextMenu.workflow.id)
      setWorkflowToDelete(contextMenu.workflow.id)
      setShowDeleteConfirmModal(true)
    }
    setContextMenu(prev => ({ ...prev, isOpen: false }))
  }

  const handleContextMenuUnarchive = () => {
    if (contextMenu.workflow) {
      setWorkflowToUnarchive(contextMenu.workflow.id)
      setShowUnarchiveModal(true)
    }
    setContextMenu(prev => ({ ...prev, isOpen: false }))
  }

  const handleContextMenuDuplicate = () => {
    if (contextMenu.workflow) {
      duplicateWorkflowMutation.mutate(contextMenu.workflow.id)
    }
    setContextMenu(prev => ({ ...prev, isOpen: false }))
  }

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        setContextMenu(prev => ({ ...prev, isOpen: false }))
      }
    }

    if (contextMenu.isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [contextMenu.isOpen])

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

      const { data, error } = await supabase
        .from('workflow_stages')
        .insert(stageData)
        .select()

      if (error) {
        console.error('Database error:', error)
        throw error
      }

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

        await addAssetsToWorkflowByUniverse(
          newWorkflow.id,
          rules,
          'OR' // Default to OR operator for combining rules
        )
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
      const { data, error } = await supabase
        .from('workflow_automation_rules')
        .delete()
        .eq('id', ruleId)
        .select()

      if (error) throw error

      return data
    },
    onSuccess: (data) => {
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
      // Create initial Version 1 for the new workflow
      try {
        const { error: versionError } = await supabase
          .rpc('create_initial_template_version', {
            p_workflow_id: createdWorkflow.id
          })

        if (versionError) {
          console.error('Error creating initial version:', versionError)
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
            setSelectedWorkflow(newWorkflow)
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
                          onContextMenu={(e) => handleWorkflowContextMenu(e, workflow, false)}
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
                          onContextMenu={(e) => handleWorkflowContextMenu(e, workflow, false)}
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
                          onContextMenu={(e) => handleWorkflowContextMenu(e, workflow, true)}
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
                        {(selectedWorkflow.user_permission === 'admin') && (
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
                <OverviewView
                  workflow={selectedWorkflow}
                  templateVersions={templateVersions}
                  onViewAllVersions={() => setShowTemplateVersions(true)}
                  onViewStages={() => handleTabChange('stages')}
                />
              )}

              {activeView === 'stages' && (
                <StagesView
                  workflow={selectedWorkflow}
                  checklistItems={workflowChecklistTemplates}
                  isEditMode={isTemplateEditMode}
                  canEdit={selectedWorkflow.user_permission === 'admin'}
                  draggedItemId={draggedChecklistItem}
                  dragOverItemId={dragOverItem}
                  onAddStage={() => setShowAddStage(true)}
                  onMoveStageUp={(stageId) => {
                    const index = selectedWorkflow.stages?.findIndex(s => s.id === stageId)
                    if (index !== undefined && index > 0 && selectedWorkflow.stages) {
                      const stages = selectedWorkflow.stages
                      const stageToMove = stages[index]
                      const stageAbove = stages[index - 1]
                      reorderStagesMutation.mutate({
                        stages: [
                          { id: stageToMove.id, sort_order: stageAbove.sort_order },
                          { id: stageAbove.id, sort_order: stageToMove.sort_order }
                        ],
                        movedStageName: stageToMove.name,
                        direction: 'up'
                      })
                    }
                  }}
                  onMoveStageDown={(stageId) => {
                    const index = selectedWorkflow.stages?.findIndex(s => s.id === stageId)
                    if (index !== undefined && selectedWorkflow.stages && index < selectedWorkflow.stages.length - 1) {
                      const stages = selectedWorkflow.stages
                      const stageToMove = stages[index]
                      const stageBelow = stages[index + 1]
                      reorderStagesMutation.mutate({
                        stages: [
                          { id: stageToMove.id, sort_order: stageBelow.sort_order },
                          { id: stageBelow.id, sort_order: stageToMove.sort_order }
                        ],
                        movedStageName: stageToMove.name,
                        direction: 'down'
                      })
                    }
                  }}
                  onEditStage={(stageId) => setEditingStage(stageId)}
                  onDeleteStage={(stageId) => {
                    const stage = selectedWorkflow.stages?.find(s => s.id === stageId)
                    if (stage) {
                      setStageToDelete({
                        id: stage.id,
                        key: stage.stage_key,
                        label: stage.stage_label
                      })
                      setShowDeleteStageModal(true)
                    }
                  }}
                  onAddChecklistItem={(stageId) => setShowAddChecklistItem(stageId)}
                  onEditChecklistItem={(itemId) => setEditingChecklistItem(itemId)}
                  onDeleteChecklistItem={(itemId) => {
                    const item = workflowChecklistTemplates?.find(t => t.id === itemId)
                    if (item && confirm(`Are you sure you want to delete "${item.item_text}"?`)) {
                      deleteChecklistItemMutation.mutate(itemId)
                    }
                  }}
                  onDragStart={(itemId) => setDraggedChecklistItem(itemId)}
                  onDragEnd={() => setDraggedChecklistItem(null)}
                  onDragOver={(e) => handleDragOver(e)}
                  onDragEnter={(itemId) => setDragOverItem(itemId)}
                  onDragLeave={() => setDragOverItem(null)}
                  onDrop={(draggedId, targetId) => {
                    const stageChecklistTemplates = workflowChecklistTemplates?.filter(
                      template => {
                        const draggedTemplate = workflowChecklistTemplates.find(t => t.id === draggedId)
                        return draggedTemplate && template.stage_id === draggedTemplate.stage_id
                      }
                    ) || []
                    const fakeEvent = { preventDefault: () => {} } as React.DragEvent
                    handleDrop(fakeEvent, targetId, stageChecklistTemplates)
                  }}
                  renderContentTiles={(stageId) => (
                    <ContentTileManager
                      workflowId={selectedWorkflow.id}
                      stageId={stageId}
                      isEditable={isTemplateEditMode}
                      onTileChange={(description) => trackChange('checklist_edited', description)}
                    />
                  )}
                />
              )}


              {activeView === 'admins' && (
                <AdminsView
                  creatorId={selectedWorkflow.created_by}
                  creatorName={selectedWorkflow.creator_name || 'Unknown User'}
                  creatorEmail={selectedWorkflow.creator_email || ''}
                  currentUserId={user?.id}
                  collaborators={workflowCollaborators}
                  stakeholders={workflowStakeholders}
                  accessRequests={pendingAccessRequests}
                  canEdit={selectedWorkflow.user_permission === 'admin'}
                  canRequestAccess={selectedWorkflow.user_permission === 'read' || selectedWorkflow.user_permission === 'write'}
                  onRequestAccess={() => setShowAccessRequestModal(true)}
                  onInviteCollaborator={() => setShowInviteModal(true)}
                  onChangePermission={(userId, newPermission) => {
                    const collab = workflowCollaborators?.find((c: any) => c.user_id === userId)
                    if (collab) {
                      updateCollaboratorMutation.mutate({
                        collaborationId: collab.id,
                        permission: newPermission
                      })
                    }
                  }}
                  onRemoveCollaborator={(userId, userName) => setRemoveAdminConfirm({ id: userId, name: userName })}
                  onAddStakeholder={() => setShowAddStakeholderModal(true)}
                  onRemoveStakeholder={(stakeholderId, stakeholderName) => setRemoveStakeholderConfirm({ id: stakeholderId, name: stakeholderName })}
                  onApproveAccessRequest={(requestId, userId, permission, workflowId) => {
                    approveAccessRequestMutation.mutate({ requestId, userId, permission, workflowId })
                  }}
                  onRejectAccessRequest={(requestId) => rejectAccessRequestMutation.mutate(requestId)}
                />
              )}

              {activeView === 'universe' && (
                <UniverseView
                  workflowId={selectedWorkflow.id}
                  rules={universeRulesState}
                  isEditMode={isTemplateEditMode}
                  canEdit={selectedWorkflow.user_permission === 'admin'}
                  analysts={analysts?.map(a => ({ value: a.user_id, label: a.analyst_name })) || []}
                  lists={assetLists.map(l => ({ value: l.id, label: l.name }))}
                  themes={themes.map(t => ({ value: t.id, label: t.name }))}
                  portfolios={[]}
                  onRulesChange={handleUniverseRulesChange}
                  onSave={saveUniverseRules}
                />
              )}

              {activeView === 'cadence' && (
                <CadenceView
                  cadenceTimeframe={selectedWorkflow.cadence_timeframe || 'annually'}
                  cadenceDays={selectedWorkflow.cadence_days ? [selectedWorkflow.cadence_days] : undefined}
                  automationRules={automationRules?.filter(rule => rule.workflow_id === selectedWorkflow.id)}
                  canEdit={selectedWorkflow.user_permission === 'admin'}
                  isEditMode={isTemplateEditMode}
                    onChangeCadence={async (timeframe) => {
                      const daysMap = {
                        'daily': 1,
                        'weekly': 7,
                        'monthly': 30,
                        'quarterly': 90,
                        'semi-annually': 180,
                        'annually': 365,
                        'persistent': 0
                      }

                      const { data, error } = await supabase
                        .from('workflows')
                        .update({
                          cadence_timeframe: timeframe,
                          cadence_days: daysMap[timeframe]
                        })
                        .eq('id', selectedWorkflow.id)
                        .select()

                      if (error) {
                        alert(`Failed to update cadence group: ${error.message || error.code || 'Unknown error'}`)
                      } else {
                        queryClient.invalidateQueries({ queryKey: ['workflows-full'] })
                        setSelectedWorkflow({
                          ...selectedWorkflow,
                          cadence_timeframe: timeframe,
                          cadence_days: daysMap[timeframe]
                        })
                        trackChange('cadence_updated', `Updated cadence to: ${timeframe}`)
                      }
                    }}
                    onAddRule={() => setShowAddRuleModal(true)}
                    onEditRule={(rule) => setEditingRule(rule.id)}
                    onDeleteRule={(ruleId, ruleName) => {
                      setRuleToDelete({ id: ruleId, name: ruleName, type: 'automation' })
                      setShowDeleteRuleModal(true)
                    }}
                  />
              )}

              {/* Branches View */}
              {activeView === 'branches' && (
                <BranchesView
                  branches={workflowBranches}
                  statusFilter={branchStatusFilter}
                  collapsedBranches={collapsedBranches}
                  collapsedTemplateVersions={collapsedTemplateVersions}
                  canEdit={selectedWorkflow.user_permission === 'admin'}
                  isLoading={isLoadingBranches}
                  onStatusFilterChange={setBranchStatusFilter}
                  onToggleCollapse={(branchId) => {
                    const newCollapsed = new Set(collapsedBranches)
                    if (newCollapsed.has(branchId)) {
                      newCollapsed.delete(branchId)
                    } else {
                      newCollapsed.add(branchId)
                    }
                    setCollapsedBranches(newCollapsed)
                  }}
                  onToggleTemplateCollapse={(versionNumber) => {
                    const newCollapsed = new Set(collapsedTemplateVersions)
                    if (newCollapsed.has(versionNumber)) {
                      newCollapsed.delete(versionNumber)
                    } else {
                      newCollapsed.add(versionNumber)
                    }
                    setCollapsedTemplateVersions(newCollapsed)
                  }}
                  onCreateBranch={(parentBranchId, templateVersion) => {
                    if (parentBranchId) {
                      setParentBranchForNew(parentBranchId)
                    }
                    setShowCreateBranchModal(true)
                  }}
                  onViewBranch={(branch) => {
                    // Could open a branch details modal here
                    console.log('View branch:', branch)
                  }}
                  onEditSuffix={(branchId, currentSuffix) => {
                    setBranchToEditSuffix({ id: branchId, currentSuffix })
                  }}
                  onEndBranch={(branch) => {
                    setBranchToEnd({ id: branch.id, name: branch.branch_name })
                  }}
                  onContinueBranch={(branch) => {
                    setBranchToContinue({ id: branch.id, name: branch.branch_name })
                  }}
                  onArchiveBranch={(branch) => {
                    setBranchToArchive({ id: branch.id, name: branch.branch_name })
                  }}
                  onUnarchiveBranch={(branch) => {
                    unarchiveBranchMutation.mutate(branch.id)
                  }}
                  onDeleteBranch={(branch) => {
                    setBranchToDelete({ id: branch.id, name: branch.branch_name })
                  }}
                  onRestoreBranch={(branch) => {
                    restoreBranchMutation.mutate(branch.id)
                  }}
                />
              )}

              {/* Models View */}
              {activeView === 'models' && (
                <ModelsView
                  templates={workflowTemplates?.map(t => ({
                    id: t.id,
                    workflow_id: t.workflow_id,
                    template_name: t.name,
                    template_description: t.description,
                    file_path: t.file_url,
                    file_size: t.file_size,
                    uploaded_by: t.uploaded_by || '',
                    uploaded_at: t.uploaded_at || ''
                  }))}
                  isLoading={templatesLoading}
                  canEdit={selectedWorkflow.user_permission === 'admin'}
                  onUpload={() => setShowUploadTemplateModal(true)}
                  onDownload={(template) => window.open(template.file_path, '_blank')}
                  onDelete={(template) => {
                    if (confirm(`Are you sure you want to delete "${template.template_name}"?`)) {
                      deleteTemplateMutation.mutate(template.id)
                    }
                  }}
                />
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
          canCreateVersion={selectedWorkflow.user_permission === 'admin'}
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
          canActivateVersion={selectedWorkflow.user_permission === 'admin'}
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
          if (!deleteRuleMutation.isPending) {
            setShowDeleteRuleModal(false)
            setRuleToDelete(null)
          }
        }}
        onConfirm={() => {
          if (ruleToDelete) {
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
            const collab = workflowCollaborators?.find((c: any) => c.user_id === removeAdminConfirm.id)
            if (collab) {
              removeCollaboratorMutation.mutate(collab.id)
            }
            setRemoveAdminConfirm(null)
          }
        }}
        title="Remove Administrator?"
        message={`Are you sure you want to remove ${removeAdminConfirm?.name} as an administrator from this workflow? They will no longer have access to view this workflow.`}
        confirmText="Remove Administrator"
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

      {/* Workflow Context Menu */}
      {contextMenu.isOpen && (
        <div
          ref={contextMenuRef}
          className="fixed bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 min-w-[160px]"
          style={{
            left: contextMenu.x,
            top: contextMenu.y
          }}
        >
          {/* Archive/Restore - only show if user can archive (owner or admin collaborator) */}
          {contextMenu.workflow?.can_archive && (
            contextMenu.isArchived ? (
              // Restore option for archived workflows
              <button
                onClick={handleContextMenuUnarchive}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center space-x-2"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Restore</span>
              </button>
            ) : (
              // Archive option for active workflows
              <button
                onClick={handleContextMenuArchive}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center space-x-2"
              >
                <Archive className="w-4 h-4" />
                <span>Archive</span>
              </button>
            )
          )}

          <button
            onClick={handleContextMenuDuplicate}
            className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center space-x-2"
          >
            <Copy className="w-4 h-4" />
            <span>Duplicate</span>
          </button>
        </div>
      )}
    </div>
  )
}


