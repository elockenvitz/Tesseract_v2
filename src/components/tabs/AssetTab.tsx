import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { Target, FileText, Plus, Calendar, User, Users, ArrowLeft, Activity, Clock, ChevronDown, ChevronUp, AlertTriangle, Zap, Copy, Download, Trash2, List, ExternalLink, Sparkles, Star, History, Layers, Lock, Share2, ChevronRight, Link2, File, X, Check, FileSpreadsheet, Globe, Building2, FolderTree, Briefcase, Settings2, Tag, FolderKanban } from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '../../hooks/useAuth'
import { useAssetModels } from '../../hooks/useAssetModels'
import { TabStateManager } from '../../lib/tabStateManager'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { PriorityBadge } from '../ui/PriorityBadge'
import { BadgeSelect } from '../ui/BadgeSelect'
import { EditableSectionWithHistory, type EditableSectionWithHistoryRef } from '../ui/EditableSectionWithHistory'
import { InvestmentTimeline } from '../ui/InvestmentTimeline'
import { QuickStageSwitcher } from '../ui/QuickStageSwitcher'
import { AssetWorkflowSelector } from '../ui/AssetWorkflowSelector'
import { WorkflowSelector } from '../ui/WorkflowSelector'
import { AssetWorkflowSelectorEnhanced } from '../asset/AssetWorkflowSelectorEnhanced'
import { AssetDecisionView } from '../asset/AssetDecisionView'
import { WorkflowActionButton } from '../asset/WorkflowActionButton'
import { WorkflowManager } from '../ui/WorkflowManager'
import { CaseCard } from '../ui/CaseCard'
import { AddToListButton } from '../lists/AddToListButton'
import { AddToThemeButton } from '../lists/AddToThemeButton'
import { AddToQueueButton } from '../lists/AddToQueueButton'
import { StockQuote } from '../financial/StockQuote'
import { AssetTimelineView } from '../ui/AssetTimelineView'
import { FinancialNews } from '../financial/FinancialNews'
import { financialDataService } from '../../lib/financial-data/browser-client'
import { CoverageDisplay } from '../coverage/CoverageDisplay'
// DocumentLibrarySection removed — consolidated into KeyReferencesSection
import { RelatedProjects } from '../projects/RelatedProjects'
import { ContributionSection, ThesisUnifiedSummary, ThesisHistoryView, ThesisContainer, KeyReferencesSection, ModelVersionHistory } from '../contributions'
import { useContributions, type ContributionVisibility } from '../../hooks/useContributions'
import { useKeyReferences } from '../../hooks/useKeyReferences'
import { useUserAssetPriority, type Priority } from '../../hooks/useUserAssetPriority'
import { useUserAssetPagePreferences } from '../../hooks/useUserAssetPagePreferences'
import { useAssetHeaderContext } from '../../hooks/useAssetHeaderContext'
import { OutcomesContainer, AnalystRatingsSection, AnalystEstimatesSection, FirmConsensusPanel, PriceTargetsSummary, ViewWarningIndicator } from '../outcomes'
import type { ViewScope } from '../../hooks/useExpectedValue'
import { useViewWarnings } from '../../hooks/useViewWarnings'
import { UserWidgetRenderer, AssetPageFieldCustomizer, InvestmentCaseBuilder } from '../research'
import {
  ChecklistField,
  MetricField,
  TimelineField,
  NumericField,
  DateField
} from '../research/FieldTypeRenderers'
import { useUserAssetWidgets, type WidgetType } from '../../hooks/useUserAssetWidgets'
import { supabase } from '../../lib/supabase'
import { formatDistanceToNow } from 'date-fns'
import { calculateAssetCompleteness } from '../../utils/assetCompleteness'

// Visibility options for thesis sections
const VISIBILITY_OPTIONS: { value: ContributionVisibility; label: string; icon: React.ElementType; description: string }[] = [
  { value: 'firm', label: 'Firm-wide', icon: Globe, description: 'Everyone in the firm can see this' },
  { value: 'division', label: 'Division', icon: Building2, description: 'Visible to your division' },
  { value: 'department', label: 'Department', icon: FolderTree, description: 'Visible to your department' },
  { value: 'team', label: 'Team', icon: Users, description: 'Visible to your team' },
  { value: 'portfolio', label: 'Portfolio', icon: Briefcase, description: 'Only your portfolio can see this' }
]

const VISIBILITY_CONFIG: Record<ContributionVisibility, { icon: React.ElementType; label: string; color: string; bgColor: string }> = {
  portfolio: { icon: Briefcase, label: 'Portfolio', color: 'text-indigo-600', bgColor: 'bg-indigo-50' },
  team: { icon: Users, label: 'Team', color: 'text-blue-600', bgColor: 'bg-blue-50' },
  department: { icon: FolderTree, label: 'Dept', color: 'text-cyan-600', bgColor: 'bg-cyan-50' },
  division: { icon: Building2, label: 'Division', color: 'text-purple-600', bgColor: 'bg-purple-50' },
  firm: { icon: Globe, label: 'Firm', color: 'text-green-600', bgColor: 'bg-green-50' }
}

/**
 * Helper function to get stages for a workflow
 * - For workflow branches: fetches from workflow_template_versions.stages
 * - For workflow templates: fetches from workflow_stages table
 */
async function getWorkflowStages(workflowId: string) {
  // First, check if this is a branch by getting the workflow's template_version_id
  const { data: workflow } = await supabase
    .from('workflows')
    .select('template_version_id, parent_workflow_id')
    .eq('id', workflowId)
    .single()

  // If it's a branch (has parent_workflow_id), get stages from template version
  if (workflow?.parent_workflow_id && workflow?.template_version_id) {
    const { data: templateVersion, error } = await supabase
      .from('workflow_template_versions')
      .select('stages')
      .eq('id', workflow.template_version_id)
      .single()

    if (error) {
      console.error('Error fetching template version stages:', error)
      return { data: [], error }
    }

    // Convert template version stages to the format expected by the code
    const stages = (templateVersion.stages || []).map((stage: any) => ({
      stage_key: stage.stage_key
    }))

    return { data: stages, error: null }
  }

  // Otherwise, it's a template - get stages from workflow_stages table
  const { data, error } = await supabase
    .from('workflow_stages')
    .select('stage_key')
    .eq('workflow_id', workflowId)
    .order('sort_order')

  return { data: data || [], error }
}

interface AssetTabProps {
  asset: any
  onCite?: (content: string, fieldName?: string) => void
  onNavigate?: (tab: { id: string, title: string, type: string, data?: any }) => void
  isFocusMode?: boolean
}

// Inline Key References wrapper for AssetTab supporting_docs section
function AssetTabKeyReferencesInline({
  assetId,
  isCollapsed,
  onToggle,
  notes,
  onCreateNote,
  isEmbedded
}: {
  assetId: string
  isCollapsed: boolean
  onToggle: () => void
  notes?: any[]
  onCreateNote?: () => void
  isEmbedded?: boolean
}) {
  const [showVersionHistory, setShowVersionHistory] = useState(false)
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const { models: mdls } = useAssetModels(assetId)
  const selModel = selectedModelId ? mdls.find(m => m.id === selectedModelId) : null

  return (
    <>
      <KeyReferencesSection
        assetId={assetId}
        isExpanded={!isCollapsed}
        onToggleExpanded={onToggle}
        onViewModelHistory={(modelId) => { setSelectedModelId(modelId); setShowVersionHistory(true) }}
        onCreateNote={onCreateNote}
        notes={notes}
        isEmbedded={isEmbedded}
      />
      {selModel && (
        <ModelVersionHistory
          isOpen={showVersionHistory}
          onClose={() => { setShowVersionHistory(false); setSelectedModelId(null) }}
          modelId={selModel.id}
          assetId={assetId}
          modelName={selModel.name}
          currentVersion={selModel.version}
        />
      )}
    </>
  )
}

export function AssetTab({ asset, onCite, onNavigate, isFocusMode = false }: AssetTabProps) {
  const { user } = useAuth()

  // Per-user priority system
  const {
    myPriority,
    allPriorities,
    setPriority: setUserPriority,
    isSaving: isPrioritySaving
  } = useUserAssetPriority(asset.id)

  // Get other users' priorities (excluding current user)
  const otherPriorities = allPriorities.filter(p => p.user_id !== user?.id)

  const [workflowPriorityState, setWorkflowPriorityState] = useState('none')

  // Extract navigation data if it was passed from notification
  const navigationWorkflowId = asset.data?.workflowId
  const navigationStageId = asset.data?.stageId
  const navigationTaskId = asset.data?.taskId

  // Query to fetch task details if we have taskId but missing workflow/stage data
  const { data: taskDetails } = useQuery({
    queryKey: ['task-details', navigationTaskId],
    queryFn: async () => {
      console.log('📋 AssetTab: Fetching task details for taskId:', navigationTaskId)
      if (!navigationTaskId) return null

      const { data, error } = await supabase
        .from('asset_checklist_items')
        .select('workflow_id, stage_id')
        .eq('id', navigationTaskId)
        .single()

      if (error) {
        console.error('❌ Error fetching task details:', error)
        return null
      }

      console.log('✅ Fetched task details:', data)
      return data
    },
    enabled: !!navigationTaskId && (!navigationWorkflowId || !navigationStageId)
  })

  // Handle component citation in focus mode
  const handleComponentClick = useCallback((content: string, fieldName: string) => {
    if (isFocusMode && onCite) {
      onCite(content, fieldName)
    }
  }, [isFocusMode, onCite])

  // Timeline stages mapping for backward compatibility
  const stageMapping = {
    // Legacy mappings
    'research': 'prioritized',
    'analysis': 'prioritized',
    'monitoring': 'monitor', // Updated to map to new monitor stage
    'archived': 'action',
    // Current system mappings (these should pass through as-is)
    'outdated': 'outdated',
    'prioritized': 'prioritized',
    'in_progress': 'in_progress',
    'recommend': 'recommend',
    'review': 'review',
    'action': 'action',
    'monitor': 'monitor'
  }

  // Map old stage values to new timeline stages
  const mapToTimelineStage = (oldStage: string | null): string => {
    if (!oldStage) return 'outdated'
    return stageMapping[oldStage as keyof typeof stageMapping] || oldStage
  }

  const [stage, setStage] = useState(mapToTimelineStage(asset.process_stage))

  // Collapsible section states
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => {
    const savedState = TabStateManager.loadTabState(asset.id)
    return savedState?.collapsedSections || {}
  })

  const toggleSection = (section: string) => {
    setCollapsedSections(prev => ({ ...prev, [section]: !prev[section] }))
  }

  // Active sub-page selector (Research, Workflow, Lists)
  const [activeSubPage, setActiveSubPage] = useState<'research' | 'workflow' | 'lists'>(() => {
    const savedState = TabStateManager.loadTabState(asset.id)
    return savedState?.activeSubPage || 'research'
  })
  // Research view filter: 'aggregated' or a specific user_id
  const [researchViewFilter, setResearchViewFilter] = useState<'aggregated' | string>(() => {
    const savedState = TabStateManager.loadTabState(asset.id)
    return savedState?.researchViewFilter || 'aggregated'
  })
  // Thesis view mode: 'all' shows 3 sections, 'summary' shows unified narrative, 'history' shows timeline
  const [thesisViewMode, setThesisViewMode] = useState<'all' | 'summary' | 'history' | 'references'>(() => {
    const savedState = TabStateManager.loadTabState(asset.id)
    return savedState?.thesisViewMode || 'all'
  })
  // Research layout mode: 'classic' uses hardcoded sections, 'dynamic' uses configurable fields
  // User asset widgets
  const [showFieldCustomizer, setShowFieldCustomizer] = useState(false)
  const [showCaseBuilder, setShowCaseBuilder] = useState(false)
  const [widgetCollapsedState, setWidgetCollapsedState] = useState<Record<string, boolean>>({})
  // Shared visibility state for all thesis sections
  const [sharedThesisVisibility, setSharedThesisVisibility] = useState<ContributionVisibility>('firm')
  const [sharedThesisTargetIds, setSharedThesisTargetIds] = useState<string[]>([])
  const [showVisibilityDropdown, setShowVisibilityDropdown] = useState(false)
  const [visibilityStep, setVisibilityStep] = useState<'level' | 'targets'>('level')
  const [hasInitializedVisibility, setHasInitializedVisibility] = useState(false)
  const visibilityRef = useRef<HTMLDivElement>(null)
  const [currentlyEditing, setCurrentlyEditing] = useState<string | null>(null)
  const [hasLocalChanges, setHasLocalChanges] = useState(false)
  const [showCoverageManager, setShowCoverageManager] = useState(false)
  const [viewingStageId, setViewingStageId] = useState<string | null>(() => {
    const savedState = TabStateManager.loadTabState(asset.id)
    return savedState?.viewingStageId || null
  })
  const [pendingWorkflowSwitch, setPendingWorkflowSwitch] = useState<{workflowId: string, stageId: string | null} | null>(null)
  const [showTimelineView, setShowTimelineView] = useState(false)
  const [showTemplatesView, setShowTemplatesView] = useState(false)
  const [isTabStateInitialized, setIsTabStateInitialized] = useState(false)
  const [showWorkflowManager, setShowWorkflowManager] = useState(false)
  const [showAssetPriorityDropdown, setShowAssetPriorityDropdown] = useState(false)
  const [showWorkflowPriorityDropdown, setShowWorkflowPriorityDropdown] = useState(false)
  const [showTickerDropdown, setShowTickerDropdown] = useState(false)
  const [listsFocus, setListsFocus] = useState<string | null>(null)
  const headerContext = useAssetHeaderContext(asset.id)
  const [addRefType, setAddRefType] = useState<'none' | 'note' | 'file' | 'model' | 'url'>('none')
  const [newRefUrl, setNewRefUrl] = useState('')
  const [newRefTitle, setNewRefTitle] = useState('')
  const queryClient = useQueryClient()

  // Fetch asset models (Excel files)
  const { models: assetModels = [] } = useAssetModels(asset.id)

  // Refs for EditableSectionWithHistory components
  const thesisRef = useRef<EditableSectionWithHistoryRef>(null)
  const whereDifferentRef = useRef<EditableSectionWithHistoryRef>(null)
  const risksRef = useRef<EditableSectionWithHistoryRef>(null)


  // Fetch full asset data if id or sector is missing
  const { data: fullAsset } = useQuery({
    queryKey: ['asset-full-data', asset.id, asset.symbol],
    queryFn: async () => {
      // Query by id if available, otherwise use symbol
      let query = supabase
        .from('assets')
        .select('*')

      if (asset.id) {
        query = query.eq('id', asset.id)
      } else if (asset.symbol) {
        query = query.eq('symbol', asset.symbol)
      } else {
        throw new Error('No asset id or symbol available')
      }

      const { data, error } = await query.single()

      if (error) throw error
      return data
    },
    enabled: (!asset.id || !asset.sector) && (!!asset.id || !!asset.symbol)
  })

  // Create effective asset with full data merged in
  const effectiveAsset = fullAsset ? { ...asset, ...fullAsset } : asset

  // Fetch workflow-specific priority
  const { data: workflowPriority } = useQuery({
    queryKey: ['asset-workflow-priority', asset.id, asset.workflow_id],
    queryFn: async () => {
      if (!asset.workflow_id) return null

      const { data, error } = await supabase
        .from('asset_workflow_priorities')
        .select('priority')
        .eq('asset_id', asset.id)
        .eq('workflow_id', asset.workflow_id)
        .maybeSingle()

      if (error && error.code !== 'PGRST116') throw error
      return data?.priority || null
    },
    enabled: !!asset.workflow_id
  })

  // Update workflow priority state when workflow priority is loaded
  useEffect(() => {
    setWorkflowPriorityState(workflowPriority || 'none')
  }, [workflowPriority])

  // Update local state when switching to a different asset
  useEffect(() => {
    if (asset.id) {
      console.log(`🔍 AssetTab: Loading asset ${asset.symbol} with data:`, {
        assetId: asset.id,
        symbol: asset.symbol,
        workflow_id: asset.workflow_id,
        hasWorkflowProperty: 'workflow' in asset,
        assetPriority: asset.priority,
        thesis: asset.thesis,
        where_different: asset.where_different,
        risks_to_thesis: asset.risks_to_thesis,
        fullAsset: asset
      })
      setStage(mapToTimelineStage(asset.process_stage))

      // Tab state is already initialized in useState() from TabStateManager
      // No need to set it again here - the useState initializers handle this

      setHasLocalChanges(false) // Reset local changes flag when loading new asset
    }
  }, [asset.id])

  // Mark as initialized once asset is loaded (state is already initialized in useState)
  useEffect(() => {
    setIsTabStateInitialized(true)
  }, [asset.id])

  // Handle noteId from navigation (e.g., from dashboard note click)
  // Open note in its own tab when navigating from notification
  useEffect(() => {
    if (asset.noteId && asset.id) {
      console.log('📝 AssetTab: Opening note in new tab from navigation:', asset.noteId)
      // Find the note to get its title
      const note = notes?.find((n: any) => n.id === asset.noteId)
      onNavigate?.({
        id: asset.noteId,
        title: note?.title || 'Note',
        type: 'note',
        data: { id: asset.noteId, assetId: asset.id, assetSymbol: asset.symbol }
      })
    }
  }, [asset.id, asset.noteId])

  // Handle task assignment navigation from notifications
  useEffect(() => {
    // Use fetched task details as fallback if navigation data is missing
    const effectiveWorkflowId = navigationWorkflowId || taskDetails?.workflow_id
    const effectiveStageId = navigationStageId || taskDetails?.stage_id

    console.log('📋 AssetTab: Navigation data check:', {
      navigationWorkflowId,
      navigationStageId,
      navigationTaskId,
      taskDetails,
      effectiveWorkflowId,
      effectiveStageId,
      assetWorkflowId: asset.workflow_id,
      effectiveAssetWorkflowId: effectiveWorkflowId,
      assetData: asset.data
    })

    if (effectiveWorkflowId || navigationTaskId) {
      console.log('📋 AssetTab: Opening task from notification - switching to workflow sub-page')

      // Switch to Workflow sub-page
      setActiveSubPage('workflow')

      // If the notification has a workflow ID and it's different from current asset workflow,
      // mark it for switching
      if (effectiveWorkflowId && asset.workflow_id !== effectiveWorkflowId) {
        console.log('📋 AssetTab: Marking workflow for switch to:', effectiveWorkflowId)
        setPendingWorkflowSwitch({ workflowId: effectiveWorkflowId, stageId: effectiveStageId || null })
      } else {
        // If workflow matches or no workflow specified, just set stage and switch tab
        if (effectiveStageId) {
          console.log('📋 AssetTab: Setting viewing stage to:', effectiveStageId)
          setViewingStageId(effectiveStageId)
        }
      }
    }
  }, [asset, navigationStageId, navigationWorkflowId, navigationTaskId, taskDetails])

  // Save tab state whenever relevant state changes (but only after initialization)
  useEffect(() => {
    if (isTabStateInitialized) {
      const stateToSave = {
        activeSubPage,
        researchViewFilter,
        thesisViewMode,
        collapsedSections,
        viewingStageId
      }
      console.log(`AssetTab ${asset.id}: Saving state:`, stateToSave)
      TabStateManager.saveTabState(asset.id, stateToSave)
    }
  }, [asset.id, activeSubPage, researchViewFilter, thesisViewMode, collapsedSections, viewingStageId, isTabStateInitialized])

  // Focus-scroll into a Lists tab section when listsFocus is set
  useEffect(() => {
    if (!listsFocus || activeSubPage !== 'lists') return
    // Expand the target section if collapsed
    setCollapsedSections(prev => ({ ...prev, [listsFocus]: false }))
    // Wait a tick for DOM to update, then scroll
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(`lists-section-${listsFocus}`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    setListsFocus(null)
    return () => cancelAnimationFrame(raf)
  }, [listsFocus, activeSubPage])

  // ---------- Queries ----------
  const { data: coverage } = useQuery({
    queryKey: ['coverage', asset.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coverage')
        .select('*, portfolio:portfolios(name)')
        .eq('asset_id', asset.id)
        .eq('is_active', true)
        .order('role', { ascending: true }) // primary first, then secondary, then tertiary
      if (error) throw error
      return data
    },
  })

  // Fetch thesis contributions to check analyst thesis status
  const { data: thesisContributions } = useQuery({
    queryKey: ['thesis-contributions', asset.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_contributions')
        .select('created_by, updated_at')
        .eq('asset_id', asset.id)
        .eq('section', 'thesis')
      if (error) throw error
      return data || []
    },
  })

  // Fetch profile info for thesis contributors
  const contributorIds = React.useMemo(() => {
    if (!thesisContributions) return []
    return [...new Set(thesisContributions.map(t => t.created_by).filter(Boolean))]
  }, [thesisContributions])

  const { data: contributorProfiles, isLoading: isLoadingContributorProfiles } = useQuery({
    queryKey: ['contributor-profiles', contributorIds],
    queryFn: async () => {
      if (contributorIds.length === 0) return []
      const { data, error } = await supabase
        .from('users')
        .select('id, first_name, last_name, email')
        .in('id', contributorIds)
      if (error) throw error
      // Transform to include full_name for consistency
      return (data || []).map(u => ({
        id: u.id,
        full_name: u.first_name && u.last_name ? `${u.first_name} ${u.last_name}` : null,
        email: u.email
      }))
    },
    enabled: contributorIds.length > 0
  })

  // Get user's org chart context for visibility targets
  const { data: userOrgContext } = useQuery({
    queryKey: ['user-org-context', user?.id],
    queryFn: async () => {
      const { data: memberships } = await supabase
        .from('org_chart_node_members')
        .select('node_id, org_chart_nodes(id, name, color, node_type, parent_id)')
        .eq('user_id', user?.id)

      if (!memberships) return { portfolios: [], teams: [], departments: [], divisions: [] }

      const directNodes = memberships
        .map(m => m.org_chart_nodes as { id: string; name: string; color: string; node_type: string; parent_id: string | null })
        .filter(Boolean)

      const { data: allNodes } = await supabase
        .from('org_chart_nodes')
        .select('id, name, color, node_type, parent_id')

      if (!allNodes) return { portfolios: [], teams: [], departments: [], divisions: [] }

      const nodeMap = new Map(allNodes.map(n => [n.id, n]))
      const teamsSet = new Map<string, typeof allNodes[0]>()
      const departmentsSet = new Map<string, typeof allNodes[0]>()
      const divisionsSet = new Map<string, typeof allNodes[0]>()

      const traverseUp = (nodeId: string | null) => {
        if (!nodeId) return
        const node = nodeMap.get(nodeId)
        if (!node) return
        if (node.node_type === 'team') teamsSet.set(node.id, node)
        else if (node.node_type === 'department') departmentsSet.set(node.id, node)
        else if (node.node_type === 'division') divisionsSet.set(node.id, node)
        traverseUp(node.parent_id)
      }

      directNodes.forEach(node => {
        if (node.node_type === 'team') teamsSet.set(node.id, node)
        traverseUp(node.parent_id)
      })

      const portfolios = directNodes.filter(n => n.node_type === 'portfolio').sort((a, b) => a.name.localeCompare(b.name))
      const teams = Array.from(teamsSet.values()).sort((a, b) => a.name.localeCompare(b.name))
      const departments = Array.from(departmentsSet.values()).sort((a, b) => a.name.localeCompare(b.name))
      const divisions = Array.from(divisionsSet.values()).sort((a, b) => a.name.localeCompare(b.name))

      return { portfolios, teams, departments, divisions }
    },
    enabled: !!user?.id
  })

  // Fetch ALL contributions for this asset (for unified summary view)
  const { contributions: allAssetContributions, isLoading: contributionsLoading, isFetching: contributionsFetching } = useContributions({ assetId: asset.id })

  // Legacy: Fetch specific section contributions for visibility initialization (deprecated - will be removed)
  const userThesisContributions = allAssetContributions.filter(c => c.section === 'thesis')
  const userWhereDiffContributions = allAssetContributions.filter(c => c.section === 'where_different')
  const userRisksContributions = allAssetContributions.filter(c => c.section === 'risks_to_thesis')

  // User-added widgets for this asset
  const {
    widgets: userWidgets,
    myWidgets,
    getWidgetValue,
    isMyWidget,
    createWidget,
    deleteWidget,
    saveWidgetValue,
    isCreating: isCreatingWidget
  } = useUserAssetWidgets(asset.id, researchViewFilter !== 'aggregated' ? researchViewFilter : undefined)

  // Get user's layout preferences for this asset (respects default layout + asset-specific overrides)
  const {
    fieldsWithPreferences,
    fieldsBySection,
    displayedFieldsBySection,
    activeLayout,
    isLoading: layoutLoading
  } = useUserAssetPagePreferences(asset.id)

  // Check if user is viewing their own tab - used to conditionally apply layout customizations
  // Layout/template customizations should ONLY apply when viewing "My View"
  const isViewingOwnTab = user && researchViewFilter === user.id
  const isAggregatedView = researchViewFilter === 'aggregated'

  // Get section info with overrides (name, visibility, etc.)
  const getSectionInfo = useCallback((sectionSlug: string) => {
    const section = fieldsBySection.find(s => s.section_slug === sectionSlug)
    // Section is hidden if: explicit section override OR no fields in the section are visible
    // Default to true (visible) while loading to avoid flash of hidden content
    const hasVisibleFields = section ? section.fields.some(f => f.is_visible) : true
    const result = {
      name: section?.section_name || null, // null indicates loading
      isHidden: section?.section_is_hidden || !hasVisibleFields,
      hasOverride: section?.section_has_override || false,
      isLoading: !section // true if section data hasn't loaded yet
    }
    // Debug log section visibility (disabled for performance)
    // console.log(`📦 Section "${sectionSlug}":`, {
    //   found: !!section,
    //   fieldCount: section?.fields.length ?? 0,
    //   visibleFieldCount: section?.fields.filter(f => f.is_visible).length ?? 0,
    //   hasVisibleFields,
    //   isHidden: result.isHidden,
    //   sectionIsHiddenOverride: section?.section_is_hidden
    // })
    return result
  }, [fieldsBySection])

  // Track if user has a custom layout configured
  const hasUserLayout = !!activeLayout

  // Get target options for selected visibility level
  const getTargetOptions = useCallback((visibility: ContributionVisibility) => {
    if (!userOrgContext) return []
    switch (visibility) {
      case 'firm': return []
      case 'division': return userOrgContext.divisions
      case 'department': return userOrgContext.departments
      case 'team': return userOrgContext.teams
      case 'portfolio': return userOrgContext.portfolios
      default: return []
    }
  }, [userOrgContext])

  const targetOptions = getTargetOptions(sharedThesisVisibility)

  // Initialize visibility from user's existing contributions
  useEffect(() => {
    if (!hasInitializedVisibility && user?.id) {
      const userContribution = userThesisContributions.find(c => c.created_by === user.id)
        || userWhereDiffContributions.find(c => c.created_by === user.id)
        || userRisksContributions.find(c => c.created_by === user.id)

      if (userContribution) {
        setSharedThesisVisibility(userContribution.visibility as ContributionVisibility)
        const targets = (userContribution as any).visibility_targets
        if (targets && Array.isArray(targets)) {
          setSharedThesisTargetIds(targets.map((t: any) => t.node_id).filter(Boolean))
        }
        setHasInitializedVisibility(true)
      }
    }
  }, [user?.id, userThesisContributions, userWhereDiffContributions, userRisksContributions, hasInitializedVisibility])

  // Reset initialization when asset changes
  useEffect(() => {
    setHasInitializedVisibility(false)
    setSharedThesisVisibility('firm')
    setSharedThesisTargetIds([])
  }, [asset.id])

  // Reset target IDs when visibility level changes
  useEffect(() => {
    setSharedThesisTargetIds([])
  }, [sharedThesisVisibility])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (visibilityRef.current && !visibilityRef.current.contains(event.target as Node)) {
        setShowVisibilityDropdown(false)
        setVisibilityStep('level')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Handle visibility level selection
  const handleVisibilitySelect = useCallback((newVisibility: ContributionVisibility) => {
    const targets = getTargetOptions(newVisibility)
    if (newVisibility === 'firm' || targets.length === 0) {
      setSharedThesisVisibility(newVisibility)
      setSharedThesisTargetIds([])
      setShowVisibilityDropdown(false)
      setVisibilityStep('level')
    } else {
      setSharedThesisVisibility(newVisibility)
      setVisibilityStep('targets')
    }
  }, [getTargetOptions])

  // Handle target selection confirmation
  const handleTargetsConfirm = useCallback(() => {
    setShowVisibilityDropdown(false)
    setVisibilityStep('level')
  }, [])

  // Check if user is viewing their own tab
  const isViewingOwnThesisTab = user && researchViewFilter === user.id

  // Derive view scope for rating divergence badges (accessibleUserIds derived after researchAnalysts below)
  const ratingViewScope: ViewScope | undefined = React.useMemo(() => {
    if (researchViewFilter === 'aggregated') return { type: 'firm' }
    return { type: 'user', userId: researchViewFilter }
  }, [researchViewFilter])

  // Build thesis status for each covering analyst
  const thesisStatuses = React.useMemo(() => {
    if (!coverage || !thesisContributions) return []
    const now = new Date()
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)

    return coverage
      .filter(c => c.user_id)
      .map(c => {
        const contribution = thesisContributions.find(t => t.created_by === c.user_id)
        const lastUpdated = contribution?.updated_at
        const isStale = lastUpdated ? new Date(lastUpdated) < ninetyDaysAgo : false

        return {
          userId: c.user_id!,
          hasThesis: !!contribution,
          lastUpdated,
          isStale
        }
      })
  }, [coverage, thesisContributions])

  // Helper to format name as "F. LastName"
  const formatShortName = (fullName: string | null | undefined): string => {
    if (!fullName) return 'Unknown'
    const parts = fullName.trim().split(/\s+/)
    if (parts.length === 1) return parts[0]
    const firstName = parts[0]
    const lastName = parts[parts.length - 1]
    return `${firstName.charAt(0)}. ${lastName}`
  }

  // Build unique analyst list for the research view filter
  // Includes both covering analysts AND contributors (thesis, price targets, etc.)
  const researchAnalysts = React.useMemo(() => {
    const uniqueAnalysts = new Map<string, { id: string; name: string; shortName: string; role: string | null; isCovering: boolean }>()

    // Add covering analysts first (they get role priority)
    coverage?.forEach(c => {
      if (c.user_id && !uniqueAnalysts.has(c.user_id)) {
        uniqueAnalysts.set(c.user_id, {
          id: c.user_id,
          name: c.analyst_name || 'Unknown',
          shortName: formatShortName(c.analyst_name),
          role: c.role,
          isCovering: true
        })
      }
    })

    // Add thesis contributors who aren't already in the list
    // Skip adding entries with "Unknown" name while contributor profiles are still loading
    thesisContributions?.forEach((t: any) => {
      if (t.created_by && !uniqueAnalysts.has(t.created_by)) {
        const profile = contributorProfiles?.find(p => p.id === t.created_by)

        // Try multiple sources for the name: profile, current user (if same ID), or email fallback
        let fullName = profile?.full_name
        if (!fullName && t.created_by === user?.id) {
          // Use current user's metadata if this is the logged-in user
          const firstName = (user as any)?.user_metadata?.first_name || (user as any)?.raw_user_meta_data?.first_name
          const lastName = (user as any)?.user_metadata?.last_name || (user as any)?.raw_user_meta_data?.last_name
          if (firstName && lastName) {
            fullName = `${firstName} ${lastName}`
          } else {
            fullName = user?.email?.split('@')[0]
          }
        }
        if (!fullName) {
          fullName = profile?.email?.split('@')[0]
        }

        // Don't add entries without a name while still loading profiles
        if (!fullName && isLoadingContributorProfiles) {
          return // Skip this entry, it will be added once profiles load
        }

        // Final fallback only after loading is complete
        if (!fullName) {
          fullName = 'Unknown'
        }

        uniqueAnalysts.set(t.created_by, {
          id: t.created_by,
          name: fullName,
          shortName: formatShortName(fullName),
          role: null, // Contributors without coverage don't have a role
          isCovering: false
        })
      }
    })

    // Ensure current user is always in the list so they can switch to their own view
    if (user?.id && !uniqueAnalysts.has(user.id)) {
      const firstName = (user as any)?.user_metadata?.first_name || (user as any)?.raw_user_meta_data?.first_name
      const lastName = (user as any)?.user_metadata?.last_name || (user as any)?.raw_user_meta_data?.last_name
      let fullName = firstName && lastName ? `${firstName} ${lastName}` : user.email?.split('@')[0] || 'Unknown'
      uniqueAnalysts.set(user.id, {
        id: user.id,
        name: fullName,
        shortName: formatShortName(fullName),
        role: null,
        isCovering: false
      })
    }

    // Sort: covering analysts by role first, then contributors
    return Array.from(uniqueAnalysts.values()).sort((a, b) => {
      // Covering analysts come before non-covering
      if (a.isCovering && !b.isCovering) return -1
      if (!a.isCovering && b.isCovering) return 1

      // Among covering analysts, sort by role
      if (a.isCovering && b.isCovering) {
        const roleOrder: Record<string, number> = { primary: 0, secondary: 1, tertiary: 2 }
        const aOrder = a.role ? (roleOrder[a.role] ?? 3) : 4
        const bOrder = b.role ? (roleOrder[b.role] ?? 3) : 4
        return aOrder - bOrder
      }

      // Among contributors, sort alphabetically
      return a.name.localeCompare(b.name)
    })
  }, [coverage, thesisContributions, contributorProfiles, isLoadingContributorProfiles, user])

  // Accessible analyst IDs for rating divergence badge filtering (must be after researchAnalysts)
  const ratingAccessibleUserIds: string[] | undefined = React.useMemo(() => {
    if (!researchAnalysts || researchAnalysts.length === 0) return undefined
    const ids = researchAnalysts.map((a: { id: string }) => a.id)
    if (user?.id && !ids.includes(user.id)) ids.push(user.id)
    return ids
  }, [researchAnalysts, user?.id])

  const { data: priceTargets } = useQuery({
    queryKey: ['price-targets', asset.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('price_targets')
        .select('*')
        .eq('asset_id', asset.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })

  const { data: notes } = useQuery({
    queryKey: ['asset-notes', asset.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_notes')
        .select(`
          *,
          user:users!asset_notes_created_by_fkey(id, first_name, last_name, email)
        `)
        .eq('asset_id', asset.id)
        .eq('is_deleted', false)
        .order('updated_at', { ascending: false })
      if (error) throw error
      return data || []
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  })

  // Filter notes based on research view filter and sharing status
  const filteredNotes = React.useMemo(() => {
    if (!notes || !user) return []

    if (researchViewFilter === 'aggregated') {
      // "Our View": Show user's own notes + shared notes from others
      return notes.filter(note =>
        note.created_by === user.id || // User's own notes
        (note.created_by !== user.id && note.is_shared === true) // Others' shared notes
      )
    }

    if (researchViewFilter === user.id) {
      // Viewing own notes: show all (shared and unshared)
      return notes.filter(note => note.created_by === user.id)
    }

    // Viewing another user's notes: only show their shared notes
    return notes.filter(note =>
      note.created_by === researchViewFilter && note.is_shared === true
    )
  }, [notes, researchViewFilter, user])

  // Pagination state for notes
  const [notesDisplayCount, setNotesDisplayCount] = useState(5)
  const paginatedNotes = filteredNotes.slice(0, notesDisplayCount)
  const hasMoreNotes = filteredNotes.length > notesDisplayCount

  // Portfolio holdings query
  const { data: portfolioHoldings } = useQuery({
    queryKey: ['portfolio-holdings', asset.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_holdings')
        .select(`
          *,
          portfolios (
            id,
            name
          )
        `)
        .eq('asset_id', asset.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  // Get all holdings for each portfolio to calculate weights
  const { data: portfolioTotals } = useQuery({
    queryKey: ['portfolio-totals', portfolioHoldings?.map(h => h.portfolio_id)],
    queryFn: async () => {
      if (!portfolioHoldings || portfolioHoldings.length === 0) return {}

      const portfolioIds = [...new Set(portfolioHoldings.map(h => h.portfolio_id))]
      const totals: Record<string, number> = {}

      for (const portfolioId of portfolioIds) {
        const { data, error } = await supabase
          .from('portfolio_holdings')
          .select('shares, cost')
          .eq('portfolio_id', portfolioId)

        if (error) throw error

        // Calculate total cost (cost basis) for this portfolio
        const totalCost = (data || []).reduce((sum, holding) => {
          return sum + (parseFloat(holding.shares) * parseFloat(holding.cost))
        }, 0)

        totals[portfolioId] = totalCost
      }

      return totals
    },
    enabled: !!portfolioHoldings && portfolioHoldings.length > 0,
  })

  // Current stock price for P&L calculations
  const { data: currentQuote } = useQuery({
    queryKey: ['stock-quote', asset.symbol],
    queryFn: async () => {
      const quote = await financialDataService.getQuote(asset.symbol)
      return quote
    },
    enabled: !!asset.symbol && portfolioHoldings && portfolioHoldings.length > 0,
    staleTime: 15000, // Cache for 15 seconds
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  })

  // Unified view warnings (composes divergence + EV mismatch + revision-based rules)
  const viewWarnings = useViewWarnings({
    assetId: asset.id,
    viewScope: ratingViewScope,
    currentPrice: currentQuote?.price,
    accessibleUserIds: ratingAccessibleUserIds,
  })

  // Query to determine the effective workflow ID for this asset
  // Fetch all workflow relationships for this asset
  const { data: allAssetWorkflows, refetch: refetchAllWorkflows } = useQuery({
    queryKey: ['asset-all-workflows', effectiveAsset.id],
    queryFn: async () => {
      // Get all workflow progress records for this asset
      const { data: progressData, error: progressError } = await supabase
        .from('asset_workflow_progress')
        .select(`
          *,
          workflows:workflow_id (
            id,
            name,
            branch_suffix,
            description,
            status,
            template_version_id,
            template_version_number,
            parent_workflow_id,
            created_at,
            archived,
            deleted
          )
        `)
        .eq('asset_id', effectiveAsset.id)
        .order('created_at', { ascending: false })

      if (progressError) {
        console.error('Error fetching asset workflows:', progressError)
        return []
      }

      // Filter to only show workflow branches (not templates), and exclude deleted/archived
      const filtered = progressData?.filter(p =>
        p.workflows &&
        !p.workflows.deleted &&
        !p.workflows.archived &&
        p.workflows.parent_workflow_id !== null  // Only branches, not templates
      ) || []

      // Enhance each workflow with progress statistics
      const enhancedWorkflows = await Promise.all(filtered.map(async (workflow) => {
        // Get task completion stats for this workflow
        const { data: taskStats } = await supabase
          .from('asset_checklist_items')
          .select('id, completed')
          .eq('asset_id', effectiveAsset.id)
          .eq('workflow_id', workflow.workflow_id)

        const total_tasks = taskStats?.length || 0
        const completed_tasks = taskStats?.filter(t => t.completed).length || 0

        // Get stage information for this workflow
        const { data: stageData } = await supabase
          .from('workflow_stages')
          .select('id, stage_key, sort_order')
          .eq('workflow_id', workflow.workflow_id)
          .order('sort_order', { ascending: true })

        const total_stages = stageData?.length || 0
        const current_stage_index = workflow.current_stage_key
          ? (stageData?.findIndex(s => s.stage_key === workflow.current_stage_key) ?? 0)
          : 0

        return {
          ...workflow,
          total_tasks,
          completed_tasks,
          total_stages,
          current_stage_index
        }
      }))

      console.log('📋 AssetTab: Fetched asset workflows:', {
        assetId: effectiveAsset.id,
        assetSymbol: asset.symbol,
        totalProgress: progressData?.length || 0,
        filteredBranches: filtered.length,
        allProgress: progressData,
        filtered: enhancedWorkflows
      })

      return enhancedWorkflows
    },
    enabled: !!effectiveAsset.id
  })

  // Fetch available active workflow branches that asset can join
  const { data: availableWorkflows } = useQuery({
    queryKey: ['asset-available-workflows', effectiveAsset.id, user?.id],
    queryFn: async () => {
      if (!user?.id) {
        return []
      }

      // Get IDs of workflows the asset is already in - fetch directly from DB to avoid stale cache
      const { data: assetProgressRecords } = await supabase
        .from('asset_workflow_progress')
        .select('workflow_id')
        .eq('asset_id', effectiveAsset.id)

      const assetWorkflowIds = assetProgressRecords?.map(ap => ap.workflow_id) || []

      // Get workflow IDs where user is admin (creator) or stakeholder
      const { data: stakeholderWorkflows } = await supabase
        .from('workflow_stakeholders')
        .select('workflow_id')
        .eq('user_id', user.id)

      const stakeholderWorkflowIds = new Set(stakeholderWorkflows?.map(sw => sw.workflow_id) || [])

      // Fetch ALL active workflow branches (not templates)
      const { data: allBranches, error } = await supabase
        .from('workflows')
        .select(`
          id,
          name,
          branch_suffix,
          description,
          status,
          template_version_id,
          template_version_number,
          created_by,
          is_public,
          archived,
          parent_workflow_id,
          created_at
        `)
        .eq('status', 'active')
        .eq('archived', false)
        .eq('deleted', false)
        .not('parent_workflow_id', 'is', null)  // Only branches, not templates
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Error fetching available workflows:', error)
        return []
      }

      // Also fetch parent workflows to check if they're archived
      const parentIds = [...new Set(allBranches?.map(b => b.parent_workflow_id).filter(Boolean) || [])]
      const { data: parentWorkflows } = await supabase
        .from('workflows')
        .select('id, archived')
        .in('id', parentIds.length > 0 ? parentIds : ['none'])

      const archivedParentIds = new Set(
        parentWorkflows?.filter(p => p.archived).map(p => p.id) || []
      )

      // Filter to only workflows where user has access:
      // 1. User created the workflow (admin)
      // 2. User is a stakeholder on the branch itself
      // 3. User is a stakeholder on the parent template workflow
      // 4. Parent workflow is not archived
      const accessibleWorkflows = allBranches?.filter(w => {
        // Skip if parent is archived
        if (w.parent_workflow_id && archivedParentIds.has(w.parent_workflow_id)) return false

        // User is admin (creator) of the workflow
        if (w.created_by === user.id) return true

        // User is stakeholder on the branch itself
        if (stakeholderWorkflowIds.has(w.id)) return true

        // User is stakeholder on the parent template
        if (w.parent_workflow_id && stakeholderWorkflowIds.has(w.parent_workflow_id)) return true

        return false
      }) || []

      // Filter out workflows asset is already in
      const available = accessibleWorkflows.filter(w => !assetWorkflowIds.includes(w.id))

      return available
    },
    enabled: !!asset.id && !!user?.id
  })


  // Fetch workflows with cadence settings for upcoming branches calculation
  const { data: upcomingBranches } = useQuery({
    queryKey: ['asset-upcoming-branches', user?.id],
    queryFn: async () => {
      if (!user?.id) return []

      // Fetch workflow templates with cadence settings
      const { data: workflows, error } = await supabase
        .from('workflows')
        .select(`
          id,
          name,
          description,
          cadence_days,
          cadence_timeframe,
          kickoff_cadence,
          kickoff_custom_date,
          auto_create_branch,
          auto_branch_name,
          template_version_number,
          status,
          created_at
        `)
        .eq('auto_create_branch', true)
        .eq('archived', false)
        .or(`is_public.eq.true,created_by.eq.${user.id}`)

      if (error) {
        console.error('Error fetching workflows for upcoming branches:', error)
        return []
      }

      if (!workflows || workflows.length === 0) return []

      // For now, we'll calculate upcoming branches without last branch dates
      // In production, you'd want to fetch the most recent branch for each workflow template
      const { calculateUpcomingBranches } = await import('../../lib/upcomingBranchUtils')
      const lastBranchDates = new Map<string, Date>()

      return calculateUpcomingBranches(workflows, lastBranchDates, 30)
    },
    enabled: !!user?.id
  })

  const { data: effectiveWorkflowId, isLoading: workflowIdLoading } = useQuery({
    queryKey: ['asset-effective-workflow', asset.id],
    queryFn: async () => {
      console.log(`🔍 AssetTab: Determining effective workflow for ${asset.symbol}:`, {
        assetWorkflowId: asset.workflow_id,
        hasExplicitWorkflowId: !!asset.workflow_id
      })

      // If asset has explicit workflow_id, use it (allow viewing completed workflows)
      // Only reject if the workflow is archived or deleted
      if (asset.workflow_id) {
        const { data: workflowCheck, error: checkError } = await supabase
          .from('workflows')
          .select('id, status, archived, deleted')
          .eq('id', asset.workflow_id)
          .single()

        // Only reject archived or deleted workflows - allow viewing completed (inactive) workflows
        if (checkError || !workflowCheck || workflowCheck.archived || workflowCheck.deleted) {
          console.log(`⚠️ AssetTab: Explicit workflow_id ${asset.workflow_id} is archived/deleted, auto-selecting next workflow`)

          // The selected workflow is archived/deleted, find the next available workflow
          const { data: nextWorkflow } = await supabase
            .from('asset_workflow_progress')
            .select(`
              workflow_id,
              workflows!inner (
                id,
                status,
                archived,
                deleted,
                parent_workflow_id,
                created_at
              )
            `)
            .eq('asset_id', asset.id)
            .eq('is_started', true)
            .eq('workflows.archived', false)
            .is('workflows.deleted', null)
            .not('workflows.parent_workflow_id', 'is', null)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          const nextWorkflowId = nextWorkflow?.workflow_id || null

          // Update the asset's workflow_id to the next available workflow or null
          const { error: updateError } = await supabase
            .from('assets')
            .update({ workflow_id: nextWorkflowId })
            .eq('id', asset.id)

          if (!updateError) {
            asset.workflow_id = nextWorkflowId
          }

          if (nextWorkflowId) {
            console.log(`✅ AssetTab: Auto-selected next workflow: ${nextWorkflowId}`)
            return nextWorkflowId
          } else {
            console.log(`❌ AssetTab: No other workflows available`)
            return null
          }
        } else {
          // Allow viewing completed/inactive workflows that user explicitly selected
          console.log(`✅ AssetTab: Using explicit workflow_id: ${asset.workflow_id} (status: ${workflowCheck.status})`)
          return asset.workflow_id
        }
      }

      // Otherwise, check if there's an active workflow progress record
      // Only look for workflow BRANCHES (not templates) that are active
      const { data: workflowProgress, error } = await supabase
        .from('asset_workflow_progress')
        .select(`
          workflow_id,
          workflows!inner (
            id,
            status,
            archived,
            deleted,
            parent_workflow_id
          )
        `)
        .eq('asset_id', asset.id)
        .eq('is_started', true)
        .eq('workflows.archived', false)
        .eq('workflows.status', 'active')
        .is('workflows.deleted', null)
        .not('workflows.parent_workflow_id', 'is', null)  // Only branches, not templates
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()  // Use maybeSingle instead of single to avoid error when no rows found

      if (error || !workflowProgress) {
        console.log(`❌ AssetTab: No active workflow found for this asset`)
        return null
      }

      console.log(`✅ AssetTab: Using active workflow progress: ${workflowProgress.workflow_id}`)
      return workflowProgress.workflow_id
    },
    staleTime: 0, // Don't cache - always check for ended workflows
    gcTime: 0, // Don't keep cache when component unmounts - prevents showing wrong workflow when switching assets
  })

  // Log the effective workflow ID for debugging
  React.useEffect(() => {
    if (!workflowIdLoading) {
      console.log(`📊 AssetTab ${asset.symbol}: Effective workflow ID:`, effectiveWorkflowId)
    }
  }, [effectiveWorkflowId, workflowIdLoading, asset.symbol])

  // Fetch templates for the asset's workflow
  const { data: workflowTemplates, isLoading: templatesLoading } = useQuery({
    queryKey: ['workflow-templates', effectiveWorkflowId],
    queryFn: async () => {
      if (!effectiveWorkflowId) return []

      const { data, error } = await supabase
        .from('workflow_templates')
        .select('*')
        .eq('workflow_id', effectiveWorkflowId)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data || []
    },
    enabled: !!effectiveWorkflowId
  })

  // Fetch checklist attachments for the asset
  const { data: checklistAttachments, isLoading: attachmentsLoading } = useQuery({
    queryKey: ['asset-checklist-attachments', asset.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_checklist_attachments')
        .select('*')
        .eq('asset_id', asset.id)
        .order('uploaded_at', { ascending: false })

      if (error) throw error
      return data || []
    }
  })

  // Fetch lists that contain this asset
  const { data: assetLists, isLoading: listsLoading } = useQuery({
    queryKey: ['asset-lists', asset.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('list_items')
        .select('lists(id, name, description, type, created_at)')
        .eq('asset_id', asset.id)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data?.map(item => item.lists).filter(Boolean) || []
    }
  })

  // Fetch themes that contain this asset
  const { data: assetThemes, isLoading: themesLoading } = useQuery({
    queryKey: ['asset-themes', asset.id],
    queryFn: async () => {
      console.log('🔍 Fetching themes for asset:', asset.id)
      const { data, error } = await supabase
        .from('theme_assets')
        .select('themes(id, name, description, created_at, theme_type, color)')
        .eq('asset_id', asset.id)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('❌ Error fetching asset themes:', error)
        throw error
      }
      console.log('📦 Raw theme_assets data:', data)
      const themes = data?.map(item => item.themes).filter(Boolean) || []
      console.log('🎨 Asset themes fetched:', themes)
      return themes
    }
  })

  // Fetch thesis references (crucial supporting documents)
  const { data: thesisReferences = [] } = useQuery({
    queryKey: ['thesis-references', asset.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assets')
        .select('thesis_references')
        .eq('id', asset.id)
        .single()
      if (error) throw error
      return (data?.thesis_references || []) as Array<{
        type: 'note' | 'file' | 'link' | 'model'
        id?: string
        title: string
        url?: string
        addedAt: string
      }>
    }
  })

  // Mutation to update thesis references
  const updateThesisRefsMutation = useMutation({
    mutationFn: async (references: typeof thesisReferences) => {
      const { error } = await supabase
        .from('assets')
        .update({ thesis_references: references })
        .eq('id', asset.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['thesis-references', asset.id] })
    }
  })

  const addThesisRef = (ref: Omit<typeof thesisReferences[0], 'addedAt'>) => {
    const exists = thesisReferences.some(r =>
      (r.type === 'note' && ref.type === 'note' && r.id === ref.id) ||
      (r.type === 'file' && ref.type === 'file' && r.id === ref.id) ||
      (r.type === 'link' && ref.type === 'link' && r.url === ref.url)
    )
    if (exists) return
    updateThesisRefsMutation.mutate([...thesisReferences, { ...ref, addedAt: new Date().toISOString() }])
  }

  const removeThesisRef = (index: number) => {
    updateThesisRefsMutation.mutate(thesisReferences.filter((_, i) => i !== index))
  }

  // Fetch per-user key references (new system)
  const { references: userKeyReferences = [] } = useKeyReferences(asset.id)

  const nameFor = (id?: string | null) => {
    if (!id) return 'Unknown'
    const u = usersById?.[id]
    if (!u) return 'Unknown'
    if (u.first_name && u.last_name) return `${u.first_name} ${u.last_name}`
    return u.email?.split('@')[0] || 'Unknown'
  }

  const getThemeTypeColor = (type: string | null) => {
    switch (type) {
      case 'sector': return 'primary'
      case 'geography': return 'success'
      case 'strategy': return 'warning'
      case 'macro': return 'error'
      case 'general': return 'default'
      default: return 'default'
    }
  }

  // ---------- Mutations ----------
  const updateAssetMutation = useMutation({
    mutationFn: async (updates: any) => {
      const { error } = await supabase
        .from('assets')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', asset.id)
      if (error) throw error
      return { ...updates, updated_at: new Date().toISOString() }
    },
    onSuccess: (result) => {
      Object.assign(asset, result)
      setHasLocalChanges(false)
      // Ensure local state is in sync with the updated asset
      if (result.priority !== undefined) {
        setPriority(result.priority)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] })
      queryClient.invalidateQueries({ queryKey: ['all-assets'] })
      // Also invalidate any asset list queries that might contain this asset
      queryClient.invalidateQueries({ queryKey: ['asset-list-items'] })
      queryClient.invalidateQueries({ queryKey: ['theme-related-assets'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio-holdings'] })
    },
  })

  // Function to recalculate and update asset completeness
  const updateAssetCompleteness = async () => {
    const completeness = calculateAssetCompleteness({
      thesis: asset.thesis,
      where_different: asset.where_different,
      risks_to_thesis: asset.risks_to_thesis,
      priceTargets: priceTargets || []
    })

    // Only update if completeness has changed
    if (completeness !== asset.completeness) {
      await supabase
        .from('assets')
        .update({ completeness, updated_at: new Date().toISOString() })
        .eq('id', asset.id)

      // Update local asset object
      asset.completeness = completeness
    }
  }

  // Autosave mutation with completeness update
  const handleSectionSave = (fieldName: string) => {
    return async (content: string) => {
      await updateAssetMutation.mutateAsync({ [fieldName]: content })
      // Recalculate completeness after saving thesis-related fields
      if (['thesis', 'where_different', 'risks_to_thesis'].includes(fieldName)) {
        await updateAssetCompleteness()
      }
    }
  }

  const updatePriceTargetMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const { error } = await supabase.from('price_targets').update(updates).eq('id', id)
      if (error) throw error
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['price-targets', asset.id] })
      queryClient.invalidateQueries({ queryKey: ['price-target-history'] })
      queryClient.invalidateQueries({ queryKey: ['case-history'] })
      // Recalculate completeness after updating price target
      await updateAssetCompleteness()
    },
  })

  const createPriceTargetMutation = useMutation({
    mutationFn: async (priceTarget: any) => {
      const { error } = await supabase
        .from('price_targets')
        .insert([{ ...priceTarget, asset_id: asset.id, created_by: user?.id }])
      if (error) throw error
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['price-targets', asset.id] })
      queryClient.invalidateQueries({ queryKey: ['price-target-history'] })
      queryClient.invalidateQueries({ queryKey: ['case-history'] })
      // Recalculate completeness after creating price target
      await updateAssetCompleteness()
    },
  })

  // Workflow action mutations
  const joinWorkflowMutation = useMutation({
    mutationFn: async ({ workflowId, startImmediately }: { workflowId: string; startImmediately: boolean }) => {
      console.log('🔵 Joining workflow:', { workflowId, assetId: asset.id, userId: user?.id })

      // Check session state before inserting
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      console.log('📋 Session check:', {
        hasSession: !!session,
        userId: session?.user?.id,
        accessToken: session?.access_token ? 'present' : 'missing',
        sessionError
      })

      // Record as an 'add' override - the trigger will handle creating asset_workflow_progress
      // and auto-starting the workflow if it's an active branch
      const { error: overrideError } = await supabase
        .from('workflow_universe_overrides')
        .upsert({
          workflow_id: workflowId,
          asset_id: asset.id,
          override_type: 'add',
          created_by: user?.id
        }, {
          onConflict: 'workflow_id,asset_id'
        })

      console.log('📊 Upsert result:', { error: overrideError })

      if (overrideError) {
        console.error('❌ Error joining workflow:', overrideError)
        throw overrideError
      }

      console.log('✅ Successfully joined workflow')

      // If asset has no workflow selected, automatically select the newly added workflow
      if (!asset.workflow_id) {
        const { error: updateError } = await supabase
          .from('assets')
          .update({ workflow_id: workflowId })
          .eq('id', asset.id)
        if (updateError) console.error('Error auto-selecting workflow:', updateError)
        else asset.workflow_id = workflowId
      }

      return workflowId
    },
    onMutate: async ({ workflowId }) => {
      // Cancel any outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: ['asset-all-workflows', asset.id] })
      await queryClient.cancelQueries({ queryKey: ['asset-available-workflows', asset.id, user?.id] })

      // Snapshot the previous values
      const previousAllWorkflows = queryClient.getQueryData(['asset-all-workflows', asset.id])
      const previousAvailableWorkflows = queryClient.getQueryData(['asset-available-workflows', asset.id, user?.id])

      // Find the workflow being added from availableWorkflows
      const availableWorkflows = queryClient.getQueryData<typeof allAvailableWorkflows>(['asset-available-workflows', asset.id, user?.id]) || []
      const workflowToAdd = availableWorkflows.find((w: any) => w.id === workflowId)

      if (workflowToAdd) {
        // Optimistically add to allAssetWorkflows
        const currentAllWorkflows = queryClient.getQueryData<typeof allAssetWorkflows>(['asset-all-workflows', asset.id]) || []
        const now = new Date().toISOString()
        const optimisticWorkflow: any = {
          id: `temp-${Date.now()}`,
          asset_id: asset.id,
          workflow_id: workflowId,
          current_stage_key: null,
          is_started: true,
          is_completed: false,
          started_at: now,
          completed_at: null,
          created_at: now,
          updated_at: now,
          workflows: {
            id: workflowToAdd.id,
            name: workflowToAdd.name,
            branch_suffix: workflowToAdd.branch_suffix,
            description: workflowToAdd.description,
            status: workflowToAdd.status,
            template_version_id: workflowToAdd.template_version_id,
            template_version_number: workflowToAdd.template_version_number,
            created_at: workflowToAdd.created_at || now,
            archived: workflowToAdd.archived,
            parent_workflow_id: workflowToAdd.parent_workflow_id
          }
        }

        // Find the correct insertion index (sorted by created_at descending)
        // Use workflow's created_at, not the progress record's created_at
        const optimisticCreatedAt = new Date(optimisticWorkflow.workflows.created_at).getTime()
        let insertIndex = currentAllWorkflows.length

        for (let i = 0; i < currentAllWorkflows.length; i++) {
          const currentCreatedAt = new Date((currentAllWorkflows[i] as any).workflows?.created_at || 0).getTime()
          if (optimisticCreatedAt > currentCreatedAt) {
            insertIndex = i
            break
          }
        }

        // Insert at the correct position without resorting
        const newAllWorkflows = [
          ...currentAllWorkflows.slice(0, insertIndex),
          optimisticWorkflow,
          ...currentAllWorkflows.slice(insertIndex)
        ]

        queryClient.setQueryData(['asset-all-workflows', asset.id], newAllWorkflows)

        // Optimistically remove from availableWorkflows
        queryClient.setQueryData(
          ['asset-available-workflows', asset.id, user?.id],
          availableWorkflows.filter((w: any) => w.id !== workflowId)
        )
      }

      return { previousAllWorkflows, previousAvailableWorkflows }
    },
    onError: (err, variables, context) => {
      // Rollback on error
      console.error('❌ Join workflow mutation error:', err)
      if (context?.previousAllWorkflows) {
        queryClient.setQueryData(['asset-all-workflows', asset.id], context.previousAllWorkflows)
      }
      if (context?.previousAvailableWorkflows) {
        queryClient.setQueryData(['asset-available-workflows', asset.id, user?.id], context.previousAvailableWorkflows)
      }
    },
    onSettled: async () => {
      // Wait a tick to ensure optimistic update is rendered before refetching
      await new Promise(resolve => setTimeout(resolve, 0))

      // Refetch to ensure consistency with server
      console.log('🔄 Refetching queries after joining workflow')
      queryClient.invalidateQueries({ queryKey: ['asset-all-workflows', asset.id] })
      queryClient.invalidateQueries({ queryKey: ['asset-available-workflows', asset.id, user?.id] })
      queryClient.invalidateQueries({ queryKey: ['asset-effective-workflow', asset.id] })
      queryClient.invalidateQueries({ queryKey: ['workflow-universe-overrides'] })
      queryClient.invalidateQueries({ queryKey: ['assets'] })
    }
  })

  const markWorkflowCompleteMutation = useMutation({
    mutationFn: async (workflowId: string) => {
      const { error } = await supabase
        .from('asset_workflow_progress')
        .update({
          is_completed: true,
          completed_at: new Date().toISOString()
        })
        .eq('asset_id', asset.id)
        .eq('workflow_id', workflowId)
      if (error) throw error
    },
    onSuccess: (_, workflowId) => {
      queryClient.invalidateQueries({ queryKey: ['asset-all-workflows', asset.id] })
      queryClient.invalidateQueries({ queryKey: ['asset-workflow-progress', asset.id, workflowId] })
      refetchAllWorkflows()
    }
  })

  const removeFromWorkflowMutation = useMutation({
    mutationFn: async (workflowId: string) => {
      // Remove asset from workflow progress
      const { error } = await supabase
        .from('asset_workflow_progress')
        .delete()
        .eq('asset_id', asset.id)
        .eq('workflow_id', workflowId)
      if (error) throw error

      // If we're removing the currently selected workflow, select the next one
      if (asset.workflow_id === workflowId) {
        // Get all active workflows except the one being removed
        const { data: remainingWorkflows } = await supabase
          .from('asset_workflow_progress')
          .select(`
            workflow_id,
            created_at,
            workflows!inner (
              id,
              status,
              archived,
              deleted,
              parent_workflow_id,
              created_at
            )
          `)
          .eq('asset_id', asset.id)
          .neq('workflow_id', workflowId)
          .eq('is_started', true)
          .eq('workflows.status', 'active')
          .eq('workflows.archived', false)
          .is('workflows.deleted', null)
          .not('workflows.parent_workflow_id', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        const nextWorkflowId = remainingWorkflows?.workflow_id || null

        const { error: updateError } = await supabase
          .from('assets')
          .update({ workflow_id: nextWorkflowId })
          .eq('id', asset.id)
        if (updateError) throw updateError

        // Update local state
        asset.workflow_id = nextWorkflowId
      }

      // Record as a 'remove' override (upsert to handle removing after manual add)
      const { error: overrideError } = await supabase
        .from('workflow_universe_overrides')
        .upsert({
          workflow_id: workflowId,
          asset_id: asset.id,
          override_type: 'remove',
          created_by: user?.id
        }, {
          onConflict: 'workflow_id,asset_id'
        })
      if (overrideError) console.error('Error recording override:', overrideError)
      return workflowId
    },
    onMutate: async (workflowId: string) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['asset-all-workflows', asset.id] })
      await queryClient.cancelQueries({ queryKey: ['asset-available-workflows', asset.id, user?.id] })

      // Snapshot the previous values
      const previousAllWorkflows = queryClient.getQueryData(['asset-all-workflows', asset.id])
      const previousAvailableWorkflows = queryClient.getQueryData(['asset-available-workflows', asset.id, user?.id])

      // Find the workflow being removed
      const currentAllWorkflows = queryClient.getQueryData<typeof allAssetWorkflows>(['asset-all-workflows', asset.id]) || []
      const workflowToRemove = currentAllWorkflows.find((w: any) => w.workflow_id === workflowId)

      if (workflowToRemove && workflowToRemove.workflows) {
        // Optimistically remove from allAssetWorkflows
        queryClient.setQueryData(
          ['asset-all-workflows', asset.id],
          currentAllWorkflows.filter((w: any) => w.workflow_id !== workflowId)
        )

        // Optimistically add back to availableWorkflows in the correct sorted position
        const currentAvailableWorkflows = queryClient.getQueryData<typeof allAvailableWorkflows>(['asset-available-workflows', asset.id, user?.id]) || []
        const workflowToAdd: any = {
          id: workflowToRemove.workflows.id,
          name: workflowToRemove.workflows.name,
          branch_suffix: workflowToRemove.workflows.branch_suffix,
          description: workflowToRemove.workflows.description,
          status: workflowToRemove.workflows.status,
          template_version_id: workflowToRemove.workflows.template_version_id,
          template_version_number: workflowToRemove.workflows.template_version_number,
          created_by: user?.id || '',
          is_public: false,
          archived: workflowToRemove.workflows.archived,
          created_at: workflowToRemove.workflows.created_at,
          parent_workflow_id: null // Add this field for consistency
        }

        // Find the correct insertion index (sorted by created_at descending)
        const workflowCreatedAt = new Date(workflowToAdd.created_at || 0).getTime()
        let insertIndex = currentAvailableWorkflows.length

        console.log('🔍 Finding insertion index for workflow:', {
          name: workflowToAdd.name,
          created_at: workflowToAdd.created_at,
          timestamp: workflowCreatedAt
        })

        for (let i = 0; i < currentAvailableWorkflows.length; i++) {
          const currentCreatedAt = new Date((currentAvailableWorkflows[i] as any).created_at || 0).getTime()
          console.log(`  Comparing with [${i}]:`, {
            name: (currentAvailableWorkflows[i] as any).name,
            created_at: (currentAvailableWorkflows[i] as any).created_at,
            timestamp: currentCreatedAt,
            isNewer: workflowCreatedAt > currentCreatedAt
          })
          if (workflowCreatedAt > currentCreatedAt) {
            insertIndex = i
            break
          }
        }

        console.log(`✅ Inserting at index ${insertIndex}`)

        // Insert at the correct position without resorting
        const newAvailableWorkflows = [
          ...currentAvailableWorkflows.slice(0, insertIndex),
          workflowToAdd,
          ...currentAvailableWorkflows.slice(insertIndex)
        ]

        queryClient.setQueryData(
          ['asset-available-workflows', asset.id, user?.id],
          newAvailableWorkflows
        )
      }

      return { previousAllWorkflows, previousAvailableWorkflows }
    },
    onError: (err, workflowId, context) => {
      // Rollback on error
      console.error('❌ Remove workflow mutation error:', err)
      if (context?.previousAllWorkflows) {
        queryClient.setQueryData(['asset-all-workflows', asset.id], context.previousAllWorkflows)
      }
      if (context?.previousAvailableWorkflows) {
        queryClient.setQueryData(['asset-available-workflows', asset.id, user?.id], context.previousAvailableWorkflows)
      }
    },
    onSettled: async () => {
      // Wait a tick to ensure optimistic update is rendered before refetching
      await new Promise(resolve => setTimeout(resolve, 0))

      // Refetch to ensure consistency with server
      queryClient.invalidateQueries({ queryKey: ['asset-all-workflows', asset.id] })
      queryClient.invalidateQueries({ queryKey: ['asset-available-workflows', asset.id, user?.id] })
      queryClient.invalidateQueries({ queryKey: ['asset-effective-workflow', asset.id] })
      queryClient.invalidateQueries({ queryKey: ['workflow-universe-overrides'] })
      queryClient.invalidateQueries({ queryKey: ['assets'] })
    }
  })

  const startWorkflowMutation = useMutation({
    mutationFn: async (workflowId: string) => {
      const { error } = await supabase
        .from('asset_workflow_progress')
        .update({
          is_started: true,
          started_at: new Date().toISOString()
        })
        .eq('asset_id', asset.id)
        .eq('workflow_id', workflowId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-all-workflows', asset.id] })
      refetchAllWorkflows()
    }
  })

  const restartWorkflowMutation = useMutation({
    mutationFn: async (workflowId: string) => {
      const { error } = await supabase
        .from('asset_workflow_progress')
        .update({
          is_completed: false,
          completed_at: null,
          is_started: true,
          started_at: new Date().toISOString()
        })
        .eq('asset_id', asset.id)
        .eq('workflow_id', workflowId)
      if (error) throw error
    },
    onSuccess: (_, workflowId) => {
      queryClient.invalidateQueries({ queryKey: ['asset-all-workflows', asset.id] })
      queryClient.invalidateQueries({ queryKey: ['asset-workflow-progress', asset.id, workflowId] })
      refetchAllWorkflows()
    }
  })

  // ---------- Helpers ----------

  const getStageColor = (s: string | null) => {
    switch (s) {
      case 'research': return 'primary'
      case 'analysis': return 'warning'
      case 'monitoring': return 'success'
      case 'review':
      case 'archived':
      default: return 'default'
    }
  }

  const handleAssetPriorityChange = async (newPriority: Priority) => {
    try {
      await setUserPriority(newPriority)
    } catch (error) {
      console.error('Error updating priority:', error)
    }
  }

  const handleWorkflowPriorityChange = async (newPriority: string) => {
    if (!asset.workflow_id) return

    setWorkflowPriorityState(newPriority)
    setHasLocalChanges(true)

    try {
      const { error } = await supabase
        .from('asset_workflow_priorities')
        .upsert({
          asset_id: asset.id,
          workflow_id: asset.workflow_id,
          priority: newPriority,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'asset_id,workflow_id'
        })

      if (error) throw error

      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['asset-workflow-priority', asset.id, asset.workflow_id] })

      setHasLocalChanges(false)
    } catch (error) {
      console.error('Error updating workflow priority:', error)
      // Revert on error
      setWorkflowPriorityState(workflowPriority || 'none')
    }
  }


  const handleStageChange = (newStage: string) => {
    const prevStage = stage
    setStage(newStage)
    setHasLocalChanges(true)

    // Update the asset object immediately to prevent reversion
    asset.process_stage = newStage

    updateAssetMutation.mutate({ process_stage: newStage })

    // Send analyst notification when stock is prioritized
    if (newStage === 'prioritized' && prevStage !== 'prioritized') {
      sendAnalystNotification()
    }
  }

  const handleWorkflowChange = async (workflowId: string) => {
    console.log(`🔄 Switching workflow for asset ${asset.symbol} (${effectiveAsset.id}) to workflow ${workflowId}`)
    setHasLocalChanges(true)

    // Clear the viewing stage initially to prevent showing stale information from previous workflow
    setViewingStageId(null)

    try {
      // Get the first stage of the new workflow and check if there's an existing workflow progress
      const [workflowStagesResult, workflowProgressResult] = await Promise.all([
        getWorkflowStages(workflowId),
        supabase
          .from('asset_workflow_progress')
          .select('current_stage_key, is_started')
          .eq('asset_id', effectiveAsset.id)
          .eq('workflow_id', workflowId)
          .single()
      ])

      if (workflowStagesResult.error) {
        console.error('Error fetching workflow stages:', workflowStagesResult.error)
        // Fallback to just updating workflow without changing stage
        asset.workflow_id = workflowId
        updateAssetMutation.mutate({ workflow_id: workflowId })
        // Invalidate the effective workflow query to update the UI immediately
        queryClient.invalidateQueries({ queryKey: ['asset-effective-workflow', asset.id] })
        return
      }

      const firstStageKey = workflowStagesResult.data?.[0]?.stage_key || 'prioritized'

      // Determine which stage to show: use current_stage_key if available, otherwise first stage
      const workflowProgress = workflowProgressResult.data
      const isWorkflowStarted = workflowProgress?.is_started || false
      const effectiveCurrentStage = workflowProgress?.current_stage_key || firstStageKey

      console.log(`📊 Workflow status for ${asset.symbol}:`, {
        workflowId,
        firstStageKey,
        isWorkflowStarted,
        currentProgress: workflowProgress,
        effectiveCurrentStage
      })

      // Update workflow assignment (but don't automatically start it)
      asset.workflow_id = workflowId
      setStage(effectiveCurrentStage)

      // Auto-select the appropriate stage to show what needs to be done
      setTimeout(() => {
        setViewingStageId(effectiveCurrentStage)
      }, 100) // Small delay to ensure the workflow data is updated

      // Only update workflow_id, don't try to update process_stage since stage_key values
      // may not match the process_stage enum values
      updateAssetMutation.mutate({
        workflow_id: workflowId
      })

      // Invalidate the effective workflow query to update the UI immediately
      queryClient.invalidateQueries({ queryKey: ['asset-effective-workflow', effectiveAsset.id] })
    } catch (error) {
      console.error('Error in handleWorkflowChange:', error)
      // Fallback to just updating workflow
      asset.workflow_id = workflowId
      updateAssetMutation.mutate({ workflow_id: workflowId })
      // Invalidate the effective workflow query to update the UI immediately
      queryClient.invalidateQueries({ queryKey: ['asset-effective-workflow', effectiveAsset.id] })
    }
  }

  // Execute pending workflow switch once handleWorkflowChange is available
  useEffect(() => {
    console.log('📋 AssetTab: Pending workflow switch check:', {
      hasPending: !!pendingWorkflowSwitch,
      pendingWorkflowSwitch,
      hasAllAssetWorkflows: !!allAssetWorkflows,
      allAssetWorkflowsCount: allAssetWorkflows?.length || 0,
      hasAvailableWorkflows: !!availableWorkflows,
      availableWorkflowsCount: availableWorkflows?.length || 0
    })

    if (pendingWorkflowSwitch) {
      // Check if the workflow exists in either allAssetWorkflows or availableWorkflows
      const workflowExists =
        allAssetWorkflows?.some(w => w.workflow_id === pendingWorkflowSwitch.workflowId) ||
        availableWorkflows?.some(w => w.id === pendingWorkflowSwitch.workflowId)

      console.log('📋 AssetTab: Workflow exists check:', {
        workflowId: pendingWorkflowSwitch.workflowId,
        workflowExists,
        inAssetWorkflows: allAssetWorkflows?.some(w => w.workflow_id === pendingWorkflowSwitch.workflowId),
        inAvailableWorkflows: availableWorkflows?.some(w => w.id === pendingWorkflowSwitch.workflowId)
      })

      if (workflowExists || (allAssetWorkflows !== undefined && availableWorkflows !== undefined)) {
        console.log('📋 AssetTab: Executing pending workflow switch:', pendingWorkflowSwitch)
        handleWorkflowChange(pendingWorkflowSwitch.workflowId)

        // After switching, set the stage if provided
        if (pendingWorkflowSwitch.stageId) {
          setTimeout(() => {
            console.log('📋 AssetTab: Setting viewing stage after workflow switch:', pendingWorkflowSwitch.stageId)
            setViewingStageId(pendingWorkflowSwitch.stageId)
          }, 200) // Delay to ensure workflow data is loaded
        }

        // Clear the pending switch
        setPendingWorkflowSwitch(null)
      }
    }
  }, [pendingWorkflowSwitch, allAssetWorkflows, availableWorkflows])

  const handleWorkflowStart = async (workflowId: string) => {
    console.log(`🔴 AssetTab: handleWorkflowStart called for asset ${asset.symbol} (${effectiveAsset.id}) in workflow ${workflowId}`)

    try {
      // Get the first stage of the workflow
      const { data: workflowStages, error: stagesError } = await getWorkflowStages(workflowId)

      if (stagesError) {
        console.error('Error fetching workflow stages:', stagesError)
        return
      }

      const firstStageKey = workflowStages?.[0]?.stage_key || 'prioritized'
      const now = new Date().toISOString()

      console.log(`📋 First stage key: ${firstStageKey}, workflow stages:`, workflowStages)

      // Create/update workflow progress as started
      const progressData = {
        asset_id: effectiveAsset.id,
        workflow_id: workflowId,
        current_stage_key: firstStageKey,
        is_started: true,
        is_completed: false,
        started_at: now,
        updated_at: now
      }

      console.log(`💾 About to upsert workflow progress:`, progressData)


      const { error: progressError } = await supabase
        .from('asset_workflow_progress')
        .upsert(progressData, {
          onConflict: 'asset_id,workflow_id'
        })

      if (progressError) {
        console.error('❌ Error starting workflow progress:', progressError)
      } else {
        console.log(`✅ Workflow started successfully for asset ${asset.symbol} in workflow ${workflowId}`)
        // Invalidate caches so the workflow shows up as active
        await queryClient.invalidateQueries({ queryKey: ['prioritizer-workflows'] })
        await queryClient.invalidateQueries({ queryKey: ['asset-workflows-progress'] })
        await queryClient.invalidateQueries({ queryKey: ['idea-generator-data'] })
        // Invalidate ALL workflow status queries for this asset, not just this specific workflow
        await queryClient.invalidateQueries({ queryKey: ['current-workflow-status', effectiveAsset.id] })
        await queryClient.invalidateQueries({ queryKey: ['current-workflow-status', effectiveAsset.id, workflowId] })
        await queryClient.invalidateQueries({ queryKey: ['asset-workflow-progress', effectiveAsset.id] })
        await queryClient.invalidateQueries({ queryKey: ['workflows-all'] })
        // Force refetch of workflow status
        await queryClient.refetchQueries({ queryKey: ['current-workflow-status'] })
        console.log(`🔄 Cache invalidated for workflow status updates`)
      }
    } catch (error) {
      console.error('Error starting workflow:', error)
    }
  }

  const handleWorkflowStop = async (workflowId: string) => {
    console.log(`⏸️ AssetTab: handleWorkflowStop called for asset ${asset.symbol} (${effectiveAsset.id}) in workflow ${workflowId}`)

    try {
      const now = new Date().toISOString()

      // Update workflow progress as stopped
      const { error: progressError } = await supabase
        .from('asset_workflow_progress')
        .update({
          is_started: false,
          updated_at: now
        })
        .eq('asset_id', effectiveAsset.id)
        .eq('workflow_id', workflowId)

      if (progressError) {
        console.error('❌ Error stopping workflow progress:', progressError)
        return
      }

      console.log(`✅ Workflow stopped successfully for asset ${asset.symbol} in workflow ${workflowId}`)

      // Immediately update the cache with the new status
      queryClient.setQueryData(['current-workflow-status', effectiveAsset.id, workflowId], {
        is_started: false,
        is_completed: false
      })

      // Then invalidate and refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: ['prioritizer-workflows'] })
      queryClient.invalidateQueries({ queryKey: ['asset-workflows-progress'] })
      queryClient.invalidateQueries({ queryKey: ['idea-generator-data'] })
      queryClient.invalidateQueries({ queryKey: ['workflows-all'] })
      queryClient.refetchQueries({ queryKey: ['current-workflow-status'] })

      console.log(`🔄 Cache updated and invalidated for workflow stop`)
    } catch (error) {
      console.error('Error stopping workflow:', error)
    }
  }

  const sendAnalystNotification = async () => {
    try {
      // Create a notification in the database for analysts
      const { error } = await supabase
        .from('notifications')
        .insert([
          {
            type: 'asset_prioritized',
            title: `New Asset Prioritized: ${asset.symbol}`,
            message: `${asset.symbol} (${asset.company_name}) has been prioritized and requires analyst attention.`,
            asset_id: asset.id,
            created_by: user?.id,
            target_role: 'analyst', // Target analysts specifically
            is_read: false
          }
        ])

      if (error) {
        console.error('Failed to send analyst notification:', error)
      } else {
        console.log(`Analyst notification sent for ${asset.symbol}`)
      }
    } catch (error) {
      console.error('Error sending analyst notification:', error)
    }
  }

  const handleTimelineStageClick = (stageId: string) => {
    // This could be used for showing stage-specific information or actions
    console.log('Timeline stage clicked:', stageId)
  }

  const handleStageView = (stageId: string) => {
    // Expand workflow section and set the stage to view
    setCollapsedSections(prev => ({ ...prev, workflow: false }))
    setViewingStageId(stageId)
  }

  const handleEditStart = (sectionName: string) => {
    // save any other section first
    if (currentlyEditing && currentlyEditing !== sectionName) {
      const currentRef = getCurrentEditingRef()
      if (currentRef?.current) {
        currentRef.current.saveIfEditing()
      }
    }
    setCurrentlyEditing(sectionName)
  }

  const handleEditEnd = () => setCurrentlyEditing(null)

  const getCurrentEditingRef = () => {
    switch (currentlyEditing) {
      case 'thesis':
        return thesisRef
      case 'where_different':
        return whereDifferentRef
      case 'risks_to_thesis':
        return risksRef
      default:
        return null
    }
  }

  const handlePriceTargetSave = async (type: 'bull' | 'base' | 'bear', field: string, value: string) => {
    const existingTarget = priceTargets?.find((pt) => pt.type === type)
    if (existingTarget) {
      await updatePriceTargetMutation.mutateAsync({
        id: existingTarget.id,
        updates: { [field]: field === 'price' ? parseFloat(value) || 0 : value },
      })
    } else {
      const newTarget = {
        type,
        price: field === 'price' ? parseFloat(value) || 0 : 0,
        timeframe: field === 'timeframe' ? value : '12 months',
        reasoning: field === 'reasoning' ? value : '',
      }
      if (field !== 'price') newTarget.price = 0
      await createPriceTargetMutation.mutateAsync(newTarget)
    }
  }

  const getPriceTarget = (type: 'bull' | 'base' | 'bear') => priceTargets?.find((pt) => pt.type === type)

  const handleNoteClick = (noteId: string) => {
    // Use stable tab ID based on entity, not note ID
    const tabId = `note-asset-${asset.id}`
    onNavigate?.({
      id: tabId,
      title: `Note - ${asset.symbol}`,
      type: 'note',
      data: { id: noteId, entityType: 'asset', entityId: asset.id, assetId: asset.id, assetSymbol: asset.symbol }
    })
  }

  const handleCreateNote = () => {
    // Use stable tab ID - same tab for all notes of this asset
    const tabId = `note-asset-${asset.id}`
    onNavigate?.({
      id: tabId,
      title: `Note - ${asset.symbol}`,
      type: 'note',
      data: { entityType: 'asset', entityId: asset.id, assetId: asset.id, assetSymbol: asset.symbol, isNew: true }
    })
  }

  const priorityOptions = [
    { value: 'critical', label: 'Critical Priority' },
    { value: 'high', label: 'High Priority' },
    { value: 'medium', label: 'Medium Priority' },
    { value: 'low', label: 'Low Priority' },
  ]

  return (
    <div className="flex flex-col bg-gray-50 dark:bg-gray-900 -mx-8 -my-6 h-[calc(100%+48px)] overflow-hidden">
      {/* Sticky Header Section */}
      <div className="flex-shrink-0 sticky top-0 z-10 bg-gray-50 dark:bg-gray-900 px-8 pt-6 space-y-3 shadow-sm">
      {/* Asset Header */}
      <div className="space-y-3">
        {/* Single Row - All Summary Info and Controls */}
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-start gap-6">
            {/* Ticker, Price and Company Name */}
            <div className="flex flex-col relative">
              <div className="flex items-baseline gap-4">
                <button
                  onClick={() => setShowTickerDropdown(!showTickerDropdown)}
                  aria-haspopup="dialog"
                  aria-expanded={showTickerDropdown}
                  className="text-3xl font-bold text-gray-900 hover:text-gray-700 transition-colors flex items-baseline gap-1.5 group"
                >
                  <span className="group-hover:underline underline-offset-4 decoration-gray-300">{asset.symbol}</span>
                  <ChevronDown className={clsx('w-4 h-4 text-gray-400 transition-transform', showTickerDropdown && 'rotate-180')} />
                </button>
                <StockQuote symbol={asset.symbol} showOnlyPrice={true} className="text-2xl font-bold" />
                <StockQuote symbol={asset.symbol} showOnlyChange={true} className="text-xl font-semibold" />
              </div>
              <p className="text-lg text-gray-600 mt-1">{asset.company_name}</p>

              {/* Ticker Dropdown */}
              {showTickerDropdown && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowTickerDropdown(false)}
                  />
                  <div className="absolute top-full left-0 mt-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-20 p-4 min-w-[320px] max-h-[70vh] overflow-y-auto">
                    <div className="space-y-4">
                      {/* Coverage */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Coverage</h4>
                          {onNavigate && (
                            <button
                              onClick={() => {
                                setShowTickerDropdown(false)
                                onNavigate({
                                  id: 'coverage',
                                  title: 'Coverage',
                                  type: 'coverage',
                                  data: { assetId: asset.id, assetSymbol: asset.symbol }
                                })
                              }}
                              className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium transition-colors"
                            >
                              <span>Go to Coverage</span>
                              <ExternalLink className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                        <CoverageDisplay
                          assetId={asset.id}
                          coverage={coverage || []}
                          showHeader={false}
                          thesisStatuses={thesisStatuses}
                          showThesisStatus={true}
                          onUserClick={(user) => {
                            if (onNavigate) {
                              onNavigate({
                                id: user.id,
                                title: user.full_name,
                                type: 'user',
                                data: user
                              })
                            }
                          }}
                        />
                      </div>

                      {/* Sector */}
                      {(asset.sector || fullAsset?.sector) && (
                        <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Sector</h4>
                          <p className="text-sm text-gray-900 dark:text-gray-100">{asset.sector || fullAsset?.sector}</p>
                        </div>
                      )}

                      {/* Context */}
                      <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Context</h4>
                        {headerContext.isError ? (
                          <p className="text-xs text-gray-400 italic">Context unavailable</p>
                        ) : headerContext.isLoading ? (
                          <div className="space-y-2">
                            {[1, 2, 3, 4].map((i) => (
                              <div key={i} className="h-5 bg-gray-100 dark:bg-gray-700 rounded animate-pulse" />
                            ))}
                          </div>
                        ) : (
                          <div className="space-y-1">
                            {/* Portfolios */}
                            <div className="flex items-center justify-between py-1 group/row">
                              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                                <Briefcase className="w-3.5 h-3.5 text-gray-400" />
                                <span>{headerContext.portfolios.length > 0
                                  ? `${headerContext.portfolios.length} portfolio${headerContext.portfolios.length !== 1 ? 's' : ''}`
                                  : 'No portfolios'}</span>
                              </div>
                              {headerContext.portfolios.length > 0 && (
                                <button
                                  onClick={() => {
                                    setShowTickerDropdown(false)
                                    setActiveSubPage('lists')
                                    setListsFocus('portfoliosContent')
                                  }}
                                  className="text-xs text-primary-600 hover:text-primary-700 font-medium opacity-0 group-hover/row:opacity-100 transition-opacity"
                                >
                                  View
                                </button>
                              )}
                            </div>
                            {/* Lists */}
                            <div className="flex items-center justify-between py-1 group/row">
                              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                                <List className="w-3.5 h-3.5 text-gray-400" />
                                <span>{(() => {
                                  const s = headerContext.listsShared.length
                                  const p = headerContext.listsMine.length
                                  if (s + p === 0) return 'No lists'
                                  const parts: string[] = []
                                  if (p > 0) parts.push(`${p} personal list${p !== 1 ? 's' : ''}`)
                                  if (s > 0) parts.push(`${s} shared list${s !== 1 ? 's' : ''}`)
                                  return parts.join(' · ')
                                })()}</span>
                              </div>
                              {(headerContext.listsShared.length + headerContext.listsMine.length) > 0 && (
                                <button
                                  onClick={() => {
                                    setShowTickerDropdown(false)
                                    setActiveSubPage('lists')
                                    setListsFocus('listsContent')
                                  }}
                                  className="text-xs text-primary-600 hover:text-primary-700 font-medium opacity-0 group-hover/row:opacity-100 transition-opacity"
                                >
                                  View
                                </button>
                              )}
                            </div>
                            {/* Themes */}
                            <div className="flex items-center justify-between py-1 group/row">
                              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                                <Tag className="w-3.5 h-3.5 text-gray-400" />
                                <span>{headerContext.themes.length > 0
                                  ? `${headerContext.themes.length} theme${headerContext.themes.length !== 1 ? 's' : ''}`
                                  : 'No themes'}</span>
                              </div>
                              {headerContext.themes.length > 0 && (
                                <button
                                  onClick={() => {
                                    setShowTickerDropdown(false)
                                    setActiveSubPage('lists')
                                    setListsFocus('themesContent')
                                  }}
                                  className="text-xs text-primary-600 hover:text-primary-700 font-medium opacity-0 group-hover/row:opacity-100 transition-opacity"
                                >
                                  View
                                </button>
                              )}
                            </div>
                            {/* Projects */}
                            <div className="flex items-center justify-between py-1 group/row">
                              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                                <FolderKanban className="w-3.5 h-3.5 text-gray-400" />
                                <span>{headerContext.projectsCount > 0
                                  ? `${headerContext.projectsCount} project${headerContext.projectsCount !== 1 ? 's' : ''}`
                                  : 'No projects'}</span>
                              </div>
                              {headerContext.projectsCount > 0 && (
                                <button
                                  onClick={() => {
                                    setShowTickerDropdown(false)
                                    setActiveSubPage('lists')
                                    setListsFocus('projectsContent')
                                  }}
                                  className="text-xs text-primary-600 hover:text-primary-700 font-medium opacity-0 group-hover/row:opacity-100 transition-opacity"
                                >
                                  View
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
          {/* Priority Badges - User Priority + Firm Priority */}
          <div className="flex items-center gap-2">
            {/* User's Priority (editable) */}
            <div className="relative">
              <button
                onClick={() => setShowAssetPriorityDropdown(!showAssetPriorityDropdown)}
                disabled={isPrioritySaving}
                className={`px-2 py-1 rounded-lg text-xs font-medium flex items-center gap-1 hover:opacity-90 transition-opacity ${
                  myPriority === 'critical' ? 'bg-red-600 text-white' :
                  myPriority === 'high' ? 'bg-orange-500 text-white' :
                  myPriority === 'medium' ? 'bg-blue-500 text-white' :
                  myPriority === 'low' ? 'bg-green-500 text-white' :
                  'bg-gray-400 text-white'
                } ${isPrioritySaving ? 'opacity-50' : ''}`}
                title="Your personal priority for this asset"
              >
                {myPriority === 'critical' && <AlertTriangle className="w-3 h-3" />}
                {myPriority === 'high' && <Zap className="w-3 h-3" />}
                {myPriority === 'medium' && <Target className="w-3 h-3" />}
                {myPriority === 'low' && <Clock className="w-3 h-3" />}
                {(!myPriority || myPriority === 'none') && <Clock className="w-3 h-3" />}
                <span>You: {myPriority === 'critical' ? 'Critical' : myPriority === 'high' ? 'High' : myPriority === 'medium' ? 'Medium' : myPriority === 'low' ? 'Low' : 'None'}</span>
                <ChevronDown className="w-3 h-3" />
              </button>

              {showAssetPriorityDropdown && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowAssetPriorityDropdown(false)}
                  />
                  <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 overflow-hidden min-w-[120px]">
                    <div className="px-3 py-1.5 text-[10px] font-medium text-gray-500 border-b border-gray-100 uppercase tracking-wide">
                      Your Priority
                    </div>
                    <div className="p-1.5">
                      {(['critical', 'high', 'medium', 'low', 'none'] as Priority[]).map((priority) => {
                        const config = {
                          critical: { bg: 'bg-red-600', icon: AlertTriangle, label: 'Critical' },
                          high: { bg: 'bg-orange-500', icon: Zap, label: 'High' },
                          medium: { bg: 'bg-blue-500', icon: Target, label: 'Medium' },
                          low: { bg: 'bg-green-500', icon: Clock, label: 'Low' },
                          none: { bg: 'bg-gray-400', icon: Clock, label: 'None' }
                        }[priority]
                        const IconComponent = config.icon
                        const isSelected = myPriority === priority || (!myPriority && priority === 'none')
                        return (
                          <button
                            key={priority}
                            onClick={() => {
                              handleAssetPriorityChange(priority)
                              setShowAssetPriorityDropdown(false)
                            }}
                            className={`w-full px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${config.bg} text-white flex items-center gap-1.5 mb-1 last:mb-0 ${
                              isSelected ? 'ring-2 ring-offset-1 ring-blue-300' : 'opacity-70 hover:opacity-100'
                            }`}
                          >
                            <IconComponent className="w-3 h-3" />
                            <span>{config.label}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Others' priorities indicator */}
            {otherPriorities.length > 0 && (
              <div
                className="px-2 py-1 rounded-lg text-xs font-medium flex items-center gap-1 cursor-default bg-gray-100 text-gray-600 border border-gray-200"
                title={otherPriorities.map(p => {
                  const name = p.user ? `${p.user.first_name || ''} ${p.user.last_name || ''}`.trim() || 'Unknown' : 'Unknown'
                  const priorityLabel = p.priority === 'critical' ? 'Critical' : p.priority === 'high' ? 'High' : p.priority === 'medium' ? 'Medium' : p.priority === 'low' ? 'Low' : 'None'
                  return `${name}: ${priorityLabel}`
                }).join('\n')}
              >
                <Users className="w-3 h-3" />
                <span>{otherPriorities.length} other{otherPriorities.length !== 1 ? 's' : ''}</span>
              </div>
            )}
          </div>

          {/* Workflow Selector */}
          <AssetWorkflowSelectorEnhanced
            mode="header"
            selectedWorkflowId={effectiveWorkflowId || null}
            allAssetWorkflows={allAssetWorkflows || []}
            availableWorkflows={availableWorkflows || []}
            onSelectWorkflow={handleWorkflowChange}
            onJoinWorkflow={(workflowId) => joinWorkflowMutation.mutate({ workflowId, startImmediately: false })}
            onRemoveWorkflow={(wfId) => removeFromWorkflowMutation.mutate(wfId)}
          />
          </div>
        </div>
      </div>

      {/* Sub-page Tab Selector */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-1" aria-label="Tabs">
          <button
            onClick={() => setActiveSubPage('research')}
            className={clsx(
              'px-4 py-2 text-sm font-medium rounded-t-lg transition-colors',
              activeSubPage === 'research'
                ? 'bg-white border-t border-l border-r border-gray-200 text-primary-600 -mb-px'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            )}
          >
            <div className="flex items-center space-x-2">
              <FileText className="h-4 w-4" />
              <span>Research</span>
            </div>
          </button>
          <button
            onClick={() => setActiveSubPage('workflow')}
            className={clsx(
              'px-4 py-2 text-sm font-medium rounded-t-lg transition-colors',
              activeSubPage === 'workflow'
                ? 'bg-white border-t border-l border-r border-gray-200 text-primary-600 -mb-px'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            )}
          >
            <div className="flex items-center space-x-2">
              <Activity className="h-4 w-4" />
              <span>Workflow</span>
            </div>
          </button>
          <button
            onClick={() => setActiveSubPage('lists')}
            className={clsx(
              'px-4 py-2 text-sm font-medium rounded-t-lg transition-colors',
              activeSubPage === 'lists'
                ? 'bg-white border-t border-l border-r border-gray-200 text-primary-600 -mb-px'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            )}
          >
            <div className="flex items-center space-x-2">
              <List className="h-4 w-4" />
              <span>Lists</span>
            </div>
          </button>
        </nav>
      </div>
      </div>

      {/* Research View Filter - Fixed bar that doesn't scroll */}
      {activeSubPage === 'research' && (
        <div className="px-8 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between gap-3">
            {/* Left side: View filter */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400 uppercase tracking-wide font-medium">View</span>
              {researchAnalysts.length <= 5 ? (
                // Pills mode for 5 or fewer analysts
                <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
                  <button
                    onClick={() => setResearchViewFilter('aggregated')}
                    className={clsx(
                      'px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-150 flex items-center gap-1.5',
                      researchViewFilter === 'aggregated'
                        ? 'bg-primary-600 text-white shadow-sm'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                    )}
                  >
                    <Users className="w-3.5 h-3.5" />
                    Our View
                  </button>
                  {researchAnalysts.map(analyst => {
                    const isCurrentUser = analyst.id === user?.id
                    return (
                      <button
                        key={analyst.id}
                        onClick={() => setResearchViewFilter(analyst.id)}
                        className={clsx(
                          'px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-150 flex items-center gap-1.5',
                          researchViewFilter === analyst.id
                            ? 'bg-primary-600 text-white shadow-sm'
                            : isCurrentUser
                              ? 'text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300'
                              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                        )}
                      >
                        {analyst.isCovering && (
                          <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                        )}
                        {analyst.shortName}
                      </button>
                    )
                  })}
                </div>
              ) : (
                // Dropdown mode for more than 5 analysts
                <select
                  value={researchViewFilter}
                  onChange={(e) => setResearchViewFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 border-0 focus:ring-2 focus:ring-primary-500 dark:bg-gray-700 dark:text-gray-200"
                >
                  <option value="aggregated">Our View (All Analysts)</option>
                  {researchAnalysts.map(analyst => {
                    const prefix = analyst.isCovering ? '★ ' : ''
                    return (
                      <option key={analyst.id} value={analyst.id}>
                        {prefix}{analyst.name}
                      </option>
                    )
                  })}
                </select>
              )}
            </div>

            {/* Right side: View mode buttons and Customize */}
            <div className="flex items-center gap-2">
              {/* Visibility control - only show when viewing own view (placed first so view buttons don't shift) */}
              {researchViewFilter === user?.id && (
                <div className="relative" ref={visibilityRef}>
                  <button
                    onClick={() => setShowVisibilityDropdown(!showVisibilityDropdown)}
                    className={clsx(
                      'inline-flex items-center px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors',
                      VISIBILITY_CONFIG[sharedThesisVisibility].bgColor,
                      VISIBILITY_CONFIG[sharedThesisVisibility].color,
                      'hover:ring-1 hover:ring-gray-300'
                    )}
                    title="Research visibility"
                  >
                    {React.createElement(VISIBILITY_CONFIG[sharedThesisVisibility].icon, { className: 'w-4 h-4 mr-1.5' })}
                    <span className="hidden sm:inline">{VISIBILITY_CONFIG[sharedThesisVisibility].label}</span>
                    {sharedThesisTargetIds.length > 0 && (
                      <span className="ml-1 opacity-75">({sharedThesisTargetIds.length})</span>
                    )}
                    <ChevronDown className="w-4 h-4 ml-1" />
                  </button>

                  {showVisibilityDropdown && (
                    <div className="absolute right-0 top-full mt-1 z-20 w-64 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg shadow-lg py-1">
                      {visibilityStep === 'level' ? (
                        <>
                          <div className="px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                            Research visibility
                          </div>
                          {VISIBILITY_OPTIONS.map((option) => {
                            const OptionIcon = option.icon
                            const isSelected = sharedThesisVisibility === option.value
                            const targets = getTargetOptions(option.value)
                            const needsTargets = option.value !== 'firm' && targets.length > 0
                            return (
                              <button
                                key={option.value}
                                onClick={() => handleVisibilitySelect(option.value)}
                                className={clsx(
                                  'w-full flex items-center px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-700',
                                  isSelected && 'bg-primary-50 dark:bg-primary-900/20'
                                )}
                              >
                                <OptionIcon className="w-4 h-4 mr-2 text-gray-500 dark:text-gray-400" />
                                <div className="flex-1">
                                  <span className="font-medium text-gray-900 dark:text-gray-100">{option.label}</span>
                                  {needsTargets && (
                                    <span className="text-xs text-gray-400 ml-1">→</span>
                                  )}
                                </div>
                                {isSelected && <Check className="w-4 h-4 text-primary-600 dark:text-primary-400" />}
                              </button>
                            )
                          })}
                        </>
                      ) : (
                        <>
                          <div className="px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 border-b dark:border-gray-700 flex items-center">
                            <button
                              onClick={() => setVisibilityStep('level')}
                              className="mr-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                            >
                              ←
                            </button>
                            Select {sharedThesisVisibility === 'portfolio' ? 'portfolios' :
                                    sharedThesisVisibility === 'team' ? 'teams' :
                                    sharedThesisVisibility === 'department' ? 'departments' : 'divisions'}
                          </div>
                          <div className="max-h-48 overflow-y-auto">
                            {targetOptions.map((target) => {
                              const isSelected = sharedThesisTargetIds.includes(target.id)
                              return (
                                <button
                                  key={target.id}
                                  onClick={() => {
                                    setSharedThesisTargetIds(prev =>
                                      prev.includes(target.id)
                                        ? prev.filter(id => id !== target.id)
                                        : [...prev, target.id]
                                    )
                                  }}
                                  className={clsx(
                                    'w-full flex items-center px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700',
                                    isSelected && 'bg-primary-50 dark:bg-primary-900/20'
                                  )}
                                >
                                  <div className={clsx(
                                    'w-4 h-4 rounded border mr-3 flex items-center justify-center',
                                    isSelected ? 'bg-primary-600 border-primary-600' : 'border-gray-300 dark:border-gray-600'
                                  )}>
                                    {isSelected && <Check className="w-3 h-3 text-white" />}
                                  </div>
                                  <span
                                    className="w-3 h-3 rounded-full mr-2"
                                    style={{ backgroundColor: target.color || '#6b7280' }}
                                  />
                                  <span className="flex-1 text-left text-gray-900 dark:text-gray-100">{target.name}</span>
                                </button>
                              )
                            })}
                          </div>
                          <div className="border-t dark:border-gray-700 px-3 py-2 flex justify-end">
                            <button
                              onClick={() => handleTargetsConfirm()}
                              disabled={sharedThesisTargetIds.length === 0}
                              className="px-3 py-1.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Done
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* View warnings indicator - shows next to visibility */}
              {activeSubPage === 'research' && (
                <ViewWarningIndicator warnings={viewWarnings} />
              )}

              {/* Customize button - only show when viewing own view */}
              {researchViewFilter === user?.id && (
                <button
                  onClick={() => setShowFieldCustomizer(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                  title="Customize asset page layout"
                >
                  <Settings2 className="w-4 h-4" />
                  <span className="hidden sm:inline">Customize</span>
                </button>
              )}

              {/* View mode buttons */}
              <div className="flex items-center gap-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
                <button
                  onClick={() => setThesisViewMode('all')}
                  className={clsx(
                    'p-1.5 rounded-md transition-colors',
                    thesisViewMode === 'all'
                      ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  )}
                  title="All sections"
                >
                  <Layers className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setThesisViewMode('summary')}
                  className={clsx(
                    'p-1.5 rounded-md transition-colors',
                    thesisViewMode === 'summary'
                      ? 'bg-white dark:bg-gray-700 text-purple-600 dark:text-purple-400 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  )}
                  title="AI summary"
                >
                  <Sparkles className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setThesisViewMode('history')}
                  className={clsx(
                    'p-1.5 rounded-md transition-colors',
                    thesisViewMode === 'history'
                      ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  )}
                  title="History timeline"
                >
                  <History className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setThesisViewMode('references')}
                  className={clsx(
                    'p-1.5 rounded-md transition-colors relative',
                    thesisViewMode === 'references'
                      ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  )}
                  title="Key references"
                >
                  <Link2 className="w-4 h-4" />
                  {userKeyReferences.length > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 text-white text-[10px] font-medium rounded-full flex items-center justify-center">
                      {userKeyReferences.length}
                    </span>
                  )}
                </button>
              </div>

              {/* Export Case Button */}
              <button
                onClick={() => setShowCaseBuilder(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                title="Export investment case as PDF"
              >
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">Export</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sub-page Content */}
      <div className="flex-1 overflow-auto px-8 py-4">

        {/* ========== RESEARCH SUB-PAGE ========== */}
        {activeSubPage === 'research' && (
          <div className="space-y-3 min-h-full">
            {/* Decision Engine — filtered view for this asset */}
            <AssetDecisionView assetId={asset.id} />

            {/* Show loading skeleton while layout or contributions load/fetch */}
            {(layoutLoading || (isAggregatedView && (contributionsLoading || contributionsFetching))) ? (
              <div className="space-y-4">
                {[1, 2, 3].map(i => (
                  <Card key={i} padding="none">
                    <div className="px-6 py-4 animate-pulse">
                      <div className="h-5 bg-gray-200 rounded w-1/4 mb-3" />
                      <div className="space-y-2">
                        <div className="h-3 bg-gray-100 rounded w-3/4" />
                        <div className="h-3 bg-gray-100 rounded w-1/2" />
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            ) : thesisViewMode === 'summary' ? (
              /* AI Summary View - shows unified summary */
              <Card padding="md">
                <ThesisUnifiedSummary
                  assetId={asset.id}
                  viewFilter={researchViewFilter}
                  contributions={allAssetContributions}
                  coveringAnalystIds={new Set(coverage?.map(c => c.user_id) || [])}
                />
              </Card>
            ) : thesisViewMode === 'history' ? (
              /* History View - shows timeline instead of full layout */
              <Card padding="md">
                <ThesisHistoryView
                  assetId={asset.id}
                  viewFilter={researchViewFilter}
                />
              </Card>
            ) : thesisViewMode === 'references' ? (
              /* References View - unified Key References surface */
              <AssetTabKeyReferencesInline
                assetId={asset.id}
                isCollapsed={false}
                onToggle={() => {}}
                notes={notes || []}
                onCreateNote={handleCreateNote}
                isEmbedded
              />
            ) : isAggregatedView ? (
              /* Aggregated "All" View - clean flat list of fields with content */
              allAssetContributions.length === 0 ? (
                /* Empty state when no team contributions exist */
                <Card padding="none">
                  <div className="flex flex-col items-center justify-center py-16 px-6">
                    <div className="relative mb-6">
                      <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary-50 to-primary-100 flex items-center justify-center">
                        <Target className="w-10 h-10 text-primary-400" />
                      </div>
                      <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-white shadow-md flex items-center justify-center border border-gray-100">
                        <Users className="w-4 h-4 text-gray-400" />
                      </div>
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">No team research yet</h3>
                    <p className="text-sm text-gray-500 text-center max-w-sm mb-6">
                      No one has shared their investment thesis on this asset yet. Switch to your personal view to start documenting your research.
                    </p>
                    {user && (
                      <button
                        onClick={() => setResearchViewFilter(user.id)}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors shadow-sm"
                      >
                        <Target className="w-4 h-4" />
                        Start Your Research
                      </button>
                    )}
                  </div>
                </Card>
              ) : (
                <div className="space-y-3">
                  {/* Aggregated Price Targets (Bull/Bear/Base) - only shows when data exists */}
                  <PriceTargetsSummary
                    assetId={asset.id}
                    currentPrice={currentQuote?.price}
                  />

                  {/* Aggregated Forecasts Summary - shows ratings, estimates when data exists */}
                  <FirmConsensusPanel assetId={asset.id} />

                  {/* Contribution-based fields (rich_text sections with content) */}
                  {displayedFieldsBySection.flatMap(section => {
                    if (section.section_is_hidden) return []

                    // Skip Key References section — shown in references view tab
                    if (section.section_slug === 'supporting_docs') return []

                    return section.fields
                      .filter(f => f.is_visible)
                      .map(field => {
                        const fieldType = field.field_type

                        // Skip non-contribution field types in aggregated view
                        // (handled by dedicated summary components above)
                        if (['checklist', 'metric', 'timeline', 'numeric', 'date', 'rating', 'estimates', 'price_target', 'key_references'].includes(fieldType)) {
                          return null
                        }

                        // Contribution-based fields (rich_text, etc.)
                        return (
                          <ContributionSection
                            key={field.field_id}
                            assetId={asset.id}
                            section={field.field_slug}
                            title={field.field_name}
                            activeTab={researchViewFilter}
                            onTabChange={setResearchViewFilter}
                            defaultVisibility={sharedThesisVisibility}
                            hideViewModeButtons={true}
                            hideVisibility={true}
                            sharedVisibility={sharedThesisVisibility}
                            sharedTargetIds={sharedThesisTargetIds}
                            hideWhenEmpty={true}
                            flatMode={false}
                          />
                        )
                      })
                  })}
                </div>
              )
            ) : (
              /* Individual User "All" View - shows full layout with all sections */
              displayedFieldsBySection.map((section, sectionIdx) => {
                // Skip hidden sections
                if (section.section_is_hidden) return null

                // Alternating shade for visual separation
                const sectionShade = sectionIdx % 2 === 1 ? '!bg-gray-50/60' : ''

              // Forecasts Section - render fields individually as tiles
              if (section.section_slug === 'forecasts') {
                return (
                  <Card key={section.section_id} padding="none" className={sectionShade}>
                    <button
                      onClick={() => toggleSection('outcomes')}
                      className="w-full px-5 py-2.5 flex items-center gap-2 bg-gray-200 hover:bg-gray-300 transition-colors rounded-t-xl"
                    >
                      <span className="font-semibold text-gray-900">{section.section_name}</span>
                      {collapsedSections.outcomes ? (
                        <ChevronDown className="h-5 w-5 text-gray-400" />
                      ) : (
                        <ChevronUp className="h-5 w-5 text-gray-400" />
                      )}
                    </button>
                    {!collapsedSections.outcomes && (
                      <div className="border-t border-gray-100 px-5 py-2 space-y-3">
                        {section.fields
                          .filter(f => f.is_visible)
                          .map(field => {
                            const fieldType = field.field_type

                            // Price target field
                            if (fieldType === 'price_target') {
                              return (
                                <div key={field.field_id} id="asset-warning-anchor-targets" className="border-l-4 border-l-blue-400 bg-white rounded-lg shadow-sm hover:border-amber-200 hover:bg-amber-50/30 transition-all duration-200 p-4">
                                  <h4 className="text-sm font-medium text-gray-700 mb-1">{field.field_name}</h4>
                                  {field.field_description && (
                                    <p className="text-xs text-gray-500 mb-3">{field.field_description}</p>
                                  )}
                                  <OutcomesContainer
                                    assetId={asset.id}
                                    symbol={asset.symbol}
                                    currentPrice={currentQuote?.price}
                                    onNavigate={onNavigate}
                                    viewFilter={researchViewFilter}
                                  />
                                </div>
                              )
                            }

                            // Rating field
                            if (fieldType === 'rating') {
                              return (
                                <div key={field.field_id} id="asset-warning-anchor-rating" className="border-l-4 border-l-blue-400 bg-white rounded-lg shadow-sm hover:border-amber-200 hover:bg-amber-50/30 transition-all duration-200 p-4">
                                  <h4 className="text-sm font-medium text-gray-700 mb-1">{field.field_name}</h4>
                                  {field.field_description && (
                                    <p className="text-xs text-gray-500 mb-3">{field.field_description}</p>
                                  )}
                                  <AnalystRatingsSection
                                    assetId={asset.id}
                                    isEditable={isViewingOwnThesisTab}
                                    currentPrice={currentQuote?.price}
                                    viewScope={ratingViewScope}
                                    accessibleUserIds={ratingAccessibleUserIds}
                                  />
                                </div>
                              )
                            }

                            // Estimates field
                            if (fieldType === 'estimates') {
                              return (
                                <div key={field.field_id} className="border-l-4 border-l-blue-400 bg-white rounded-lg shadow-sm hover:border-amber-200 hover:bg-amber-50/30 transition-all duration-200 p-4">
                                  <h4 className="text-sm font-medium text-gray-700 mb-1">{field.field_name}</h4>
                                  {field.field_description && (
                                    <p className="text-xs text-gray-500 mb-3">{field.field_description}</p>
                                  )}
                                  <AnalystEstimatesSection
                                    assetId={asset.id}
                                    isEditable={isViewingOwnThesisTab}
                                  />
                                </div>
                              )
                            }

                            // Default: rich_text or other custom fields
                            const anchorId = field.field_slug === 'risks_to_thesis'
                              ? 'asset-warning-anchor-risks'
                              : field.field_slug === 'thesis'
                                ? 'asset-anchor-thesis'
                                : undefined
                            return (
                              <div key={field.field_id} id={anchorId}>
                                <ContributionSection
                                  assetId={asset.id}
                                  section={field.field_slug}
                                  title={field.field_name}
                                  activeTab={researchViewFilter}
                                  onTabChange={setResearchViewFilter}
                                  defaultVisibility={sharedThesisVisibility}
                                  hideViewModeButtons={true}
                                  hideVisibility={true}
                                  sharedVisibility={sharedThesisVisibility}
                                  sharedTargetIds={sharedThesisTargetIds}
                                />
                              </div>
                            )
                          })}
                      </div>
                    )}
                  </Card>
                )
              }

              // Key References section — skip here, shown in references view tab
              if (section.section_slug === 'supporting_docs') {
                return null
              }

              // Generic Section - for all other section types
              return (
                <Card key={section.section_id} padding="none" className={sectionShade}>
                  <button
                    onClick={() => toggleSection(section.section_slug as any)}
                    className="w-full px-5 py-2.5 flex items-center gap-2 bg-gray-200 hover:bg-gray-300 transition-colors rounded-t-xl"
                  >
                    <span className="font-semibold text-gray-900">{section.section_name}</span>
                    {collapsedSections[section.section_slug as keyof typeof collapsedSections] ? (
                      <ChevronDown className="h-5 w-5 text-gray-400" />
                    ) : (
                      <ChevronUp className="h-5 w-5 text-gray-400" />
                    )}
                  </button>
                  {!collapsedSections[section.section_slug as keyof typeof collapsedSections] && (
                    <div className="border-t border-gray-100 px-5 py-2 space-y-3">
                      {section.fields
                        .filter(f => f.is_visible)
                        .map(field => {
                          // Render field based on its type
                          const fieldType = field.field_type

                          // Checklist field
                          if (fieldType === 'checklist') {
                            return (
                              <div key={field.field_id} className="border-l-4 border-l-blue-400 bg-white rounded-lg shadow-sm hover:border-amber-200 hover:bg-amber-50/30 transition-all duration-200 p-4">
                                <h4 className="text-sm font-medium text-gray-700 mb-1">{field.field_name}</h4>
                                {field.field_description && (
                                  <p className="text-xs text-gray-500 mb-3">{field.field_description}</p>
                                )}
                                <ChecklistField
                                  fieldId={field.field_id}
                                  assetId={asset.id}
                                  config={{}}
                                />
                              </div>
                            )
                          }

                          // Metric field
                          if (fieldType === 'metric') {
                            return (
                              <div key={field.field_id} className="border-l-4 border-l-blue-400 bg-white rounded-lg shadow-sm hover:border-amber-200 hover:bg-amber-50/30 transition-all duration-200 p-4">
                                <h4 className="text-sm font-medium text-gray-700 mb-1">{field.field_name}</h4>
                                {field.field_description && (
                                  <p className="text-xs text-gray-500 mb-3">{field.field_description}</p>
                                )}
                                <MetricField
                                  fieldId={field.field_id}
                                  assetId={asset.id}
                                  config={{}}
                                />
                              </div>
                            )
                          }

                          // Timeline field
                          if (fieldType === 'timeline') {
                            return (
                              <div key={field.field_id} className="border-l-4 border-l-blue-400 bg-white rounded-lg shadow-sm hover:border-amber-200 hover:bg-amber-50/30 transition-all duration-200 p-4">
                                <h4 className="text-sm font-medium text-gray-700 mb-1">{field.field_name}</h4>
                                {field.field_description && (
                                  <p className="text-xs text-gray-500 mb-3">{field.field_description}</p>
                                )}
                                <TimelineField
                                  fieldId={field.field_id}
                                  assetId={asset.id}
                                  config={{}}
                                />
                              </div>
                            )
                          }

                          // Numeric field
                          if (fieldType === 'numeric') {
                            return (
                              <div key={field.field_id} className="border-l-4 border-l-blue-400 bg-white rounded-lg shadow-sm hover:border-amber-200 hover:bg-amber-50/30 transition-all duration-200 p-4">
                                <h4 className="text-sm font-medium text-gray-700 mb-1">{field.field_name}</h4>
                                {field.field_description && (
                                  <p className="text-xs text-gray-500 mb-3">{field.field_description}</p>
                                )}
                                <NumericField
                                  fieldId={field.field_id}
                                  assetId={asset.id}
                                  config={{}}
                                />
                              </div>
                            )
                          }

                          // Date field
                          if (fieldType === 'date') {
                            return (
                              <div key={field.field_id} className="border-l-4 border-l-blue-400 bg-white rounded-lg shadow-sm hover:border-amber-200 hover:bg-amber-50/30 transition-all duration-200 p-4">
                                <h4 className="text-sm font-medium text-gray-700 mb-1">{field.field_name}</h4>
                                {field.field_description && (
                                  <p className="text-xs text-gray-500 mb-3">{field.field_description}</p>
                                )}
                                <DateField
                                  fieldId={field.field_id}
                                  assetId={asset.id}
                                  config={{}}
                                />
                              </div>
                            )
                          }

                          // Rating field - render analyst ratings section
                          if (fieldType === 'rating') {
                            return (
                              <div key={field.field_id} id="asset-warning-anchor-rating" className="border-l-4 border-l-blue-400 bg-white rounded-lg shadow-sm hover:border-amber-200 hover:bg-amber-50/30 transition-all duration-200 p-4">
                                <h4 className="text-sm font-medium text-gray-700 mb-1">{field.field_name}</h4>
                                {field.field_description && (
                                  <p className="text-xs text-gray-500 mb-3">{field.field_description}</p>
                                )}
                                <AnalystRatingsSection
                                  assetId={asset.id}
                                  isEditable={isViewingOwnThesisTab}
                                  currentPrice={currentQuote?.price}
                                  viewScope={ratingViewScope}
                                  accessibleUserIds={ratingAccessibleUserIds}
                                />
                              </div>
                            )
                          }

                          // Estimates field - render analyst estimates section
                          if (fieldType === 'estimates') {
                            return (
                              <div key={field.field_id} className="border-l-4 border-l-blue-400 bg-white rounded-lg shadow-sm hover:border-amber-200 hover:bg-amber-50/30 transition-all duration-200 p-4">
                                <h4 className="text-sm font-medium text-gray-700 mb-1">{field.field_name}</h4>
                                {field.field_description && (
                                  <p className="text-xs text-gray-500 mb-3">{field.field_description}</p>
                                )}
                                <AnalystEstimatesSection
                                  assetId={asset.id}
                                  isEditable={isViewingOwnThesisTab}
                                />
                              </div>
                            )
                          }

                          // Price target field - render outcomes container for price targets
                          if (fieldType === 'price_target') {
                            return (
                              <div key={field.field_id} id="asset-warning-anchor-targets" className="border-l-4 border-l-blue-400 bg-white rounded-lg shadow-sm hover:border-amber-200 hover:bg-amber-50/30 transition-all duration-200 p-4">
                                <h4 className="text-sm font-medium text-gray-700 mb-1">{field.field_name}</h4>
                                {field.field_description && (
                                  <p className="text-xs text-gray-500 mb-3">{field.field_description}</p>
                                )}
                                <OutcomesContainer
                                  assetId={asset.id}
                                  symbol={asset.symbol}
                                  currentPrice={currentQuote?.price}
                                  viewFilter={researchViewFilter}
                                />
                              </div>
                            )
                          }

                          // Default: rich_text or other text-based fields use ContributionSection
                          const sectionAnchorId = field.field_slug === 'risks_to_thesis'
                            ? 'asset-warning-anchor-risks'
                            : field.field_slug === 'thesis'
                              ? 'asset-anchor-thesis'
                              : undefined
                          return (
                            <div key={field.field_id} id={sectionAnchorId}>
                              <ContributionSection
                                assetId={asset.id}
                                section={field.field_slug}
                                title={field.field_name}
                                activeTab={researchViewFilter}
                                onTabChange={setResearchViewFilter}
                                defaultVisibility={sharedThesisVisibility}
                                hideViewModeButtons={true}
                                hideVisibility={true}
                                sharedVisibility={sharedThesisVisibility}
                                sharedTargetIds={sharedThesisTargetIds}
                              />
                            </div>
                          )
                        })}
                    </div>
                  )}
                </Card>
              )
            })
            )}

            {/* User-Added Widgets Section */}
            {userWidgets.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 px-1">
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Custom Fields</span>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>
                {userWidgets.map(widget => (
                  <UserWidgetRenderer
                    key={widget.id}
                    widget={widget}
                    value={getWidgetValue(widget.id)}
                    isOwner={isMyWidget(widget.id)}
                    isCollapsed={widgetCollapsedState[widget.id] ?? false}
                    onToggleCollapse={() => setWidgetCollapsedState(prev => ({
                      ...prev,
                      [widget.id]: !prev[widget.id]
                    }))}
                    onSaveValue={async (content, value) => {
                      await saveWidgetValue({ widget_id: widget.id, content, value })
                    }}
                    onDelete={isMyWidget(widget.id) ? () => deleteWidget(widget.id) : undefined}
                    assetId={asset.id}
                  />
                ))}
              </div>
            )}

            {/* Field Customizer Modal */}
            <AssetPageFieldCustomizer
              isOpen={showFieldCustomizer}
              onClose={() => setShowFieldCustomizer(false)}
              assetId={asset.id}
              assetName={asset.name}
              viewFilter={researchViewFilter}
              currentUserId={user?.id}
            />

            {/* Investment Case Builder Modal */}
            {showCaseBuilder && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
                  <div className="p-6">
                    <InvestmentCaseBuilder
                      assetId={asset.id}
                      symbol={asset.symbol || asset.name}
                      companyName={asset.name}
                      currentPrice={currentQuote?.price}
                      onClose={() => setShowCaseBuilder(false)}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========== WORKFLOW SUB-PAGE ========== */}
        {activeSubPage === 'workflow' && (
          <div>
            {(() => {
            console.log('🔍 AssetTab Stage - asset.id:', asset.id, 'effectiveAsset.id:', effectiveAsset.id, 'typeof effectiveAsset.id:', typeof effectiveAsset.id)
            return (
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <div className="flex items-center space-x-3">
                    {showTimelineView ? (
                      <h3 className="text-lg font-semibold text-gray-900">Activity Timeline</h3>
                    ) : (
                      <>
                        <AssetWorkflowSelectorEnhanced
                          mode="stage-tab"
                          selectedWorkflowId={effectiveWorkflowId || null}
                          allAssetWorkflows={allAssetWorkflows || []}
                          availableWorkflows={availableWorkflows || []}
                          upcomingBranches={upcomingBranches || []}
                          onSelectWorkflow={handleWorkflowChange}
                          onJoinWorkflow={(workflowId) => joinWorkflowMutation.mutate({ workflowId, startImmediately: false })}
                          onRemoveWorkflow={(wfId) => removeFromWorkflowMutation.mutate(wfId)}
                        />
                        <WorkflowActionButton
                          workflowId={effectiveWorkflowId || null}
                          workflowProgress={allAssetWorkflows?.find(aw => aw.workflow_id === effectiveWorkflowId) || null}
                          onStart={(wfId) => startWorkflowMutation.mutate(wfId)}
                          onComplete={(wfId) => markWorkflowCompleteMutation.mutate(wfId)}
                          onRestart={(wfId) => restartWorkflowMutation.mutate(wfId)}
                          onRemove={(wfId) => removeFromWorkflowMutation.mutate(wfId)}
                          size="sm"
                        />
                      </>
                    )}
                  </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => {
                      setShowTimelineView(!showTimelineView)
                      setShowTemplatesView(false)
                    }}
                    className="flex items-center space-x-2 px-3 py-1.5 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors duration-200 text-xs font-medium border border-gray-200 hover:border-gray-300"
                  >
                    {showTimelineView ? (
                      <>
                        <Activity className="w-4 h-4" />
                        <span>Stage View</span>
                      </>
                    ) : (
                      <>
                        <Clock className="w-4 h-4" />
                        <span>Timeline</span>
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setShowTemplatesView(!showTemplatesView)
                      setShowTimelineView(false)
                    }}
                    className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg transition-colors duration-200 text-xs font-medium border ${
                      showTemplatesView
                        ? 'bg-blue-50 text-blue-700 border-blue-300'
                        : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100 border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <FileText className="w-4 h-4" />
                    <span>Files</span>
                  </button>
                </div>
              </div>

              {showTemplatesView ? (
                <div className="mt-6 space-y-6">
                  {/* Workflow Templates Section */}
                  <Card>
                    <div className="p-4 border-b border-gray-200">
                      <h3 className="text-lg font-semibold text-gray-900">Workflow Templates</h3>
                      <p className="text-sm text-gray-500 mt-1">Templates available for this workflow</p>
                    </div>
                    <div className="p-4">
                      {templatesLoading ? (
                        <div className="text-center py-8">
                          <p className="text-gray-500 text-sm">Loading templates...</p>
                        </div>
                      ) : workflowTemplates && workflowTemplates.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {workflowTemplates.map((template) => (
                            <div key={template.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                              <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center space-x-3 flex-1 min-w-0">
                                  <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
                                    <FileText className="w-5 h-5 text-blue-600" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <h4 className="text-sm font-medium text-gray-900 truncate">{template.name}</h4>
                                    <p className="text-xs text-gray-500 truncate">{template.file_name}</p>
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
                                <button
                                  onClick={() => window.open(template.file_url, '_blank')}
                                  className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                  title="Download template"
                                >
                                  <Download className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                          <FileText className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                          <p className="text-sm text-gray-500 font-medium">No templates available</p>
                          <p className="text-xs text-gray-400 mt-2">Workflow admins can upload templates in the Workflows tab</p>
                        </div>
                      )}
                    </div>
                  </Card>

                  {/* Workflow Attachments Section */}
                  <Card>
                    <div className="p-4 border-b border-gray-200">
                      <h3 className="text-lg font-semibold text-gray-900">Workflow Attachments</h3>
                      <p className="text-sm text-gray-500 mt-1">Files attached to workflow tasks and stages</p>
                    </div>
                    <div className="p-4">
                      {attachmentsLoading ? (
                        <div className="text-center py-8">
                          <p className="text-gray-500 text-sm">Loading attachments...</p>
                        </div>
                      ) : checklistAttachments && checklistAttachments.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {checklistAttachments.map((attachment) => (
                            <div key={attachment.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                              <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center space-x-3 flex-1 min-w-0">
                                  <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center flex-shrink-0">
                                    <FileText className="w-5 h-5 text-green-600" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <h4 className="text-sm font-medium text-gray-900 truncate">{attachment.file_name}</h4>
                                    <p className="text-xs text-gray-500">Stage: {attachment.stage_id}</p>
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                                <span className="text-xs text-gray-400">
                                  {attachment.file_size ? `${(attachment.file_size / 1024).toFixed(1)} KB` : 'Unknown size'}
                                </span>
                                <button
                                  onClick={() => window.open(attachment.file_path, '_blank')}
                                  className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors"
                                  title="Download file"
                                >
                                  <Download className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                          <FileText className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                          <p className="text-sm text-gray-500 font-medium">No attachments yet</p>
                          <p className="text-xs text-gray-400 mt-2">Files can be attached to workflow tasks in the Stage view</p>
                        </div>
                      )}
                    </div>
                  </Card>
                </div>
              ) : showTimelineView ? (
                <AssetTimelineView
                  assetId={effectiveAsset.id}
                  assetSymbol={asset.symbol}
                  workflowId={effectiveWorkflowId}
                  isOpen={true}
                  onClose={() => setShowTimelineView(false)}
                  inline={true}
                />
              ) : workflowIdLoading || effectiveWorkflowId === undefined ? (
                <div className="bg-white border border-gray-200 rounded-lg p-12 animate-pulse">
                  <div className="flex flex-col items-center justify-center text-center space-y-4">
                    <div className="w-16 h-16 rounded-full bg-gray-200"></div>
                    <div className="h-4 w-48 bg-gray-200 rounded"></div>
                    <div className="h-3 w-64 bg-gray-100 rounded"></div>
                  </div>
                </div>
              ) : !effectiveWorkflowId ? (
                <div className="bg-white border border-gray-200 rounded-lg p-12">
                  <div className="flex flex-col items-center justify-center text-center space-y-4">
                    <Activity className="w-16 h-16 text-gray-300" />
                    <div>
                      <h3 className="text-lg font-medium text-gray-900">No Active Workflows</h3>
                      <p className="text-sm text-gray-500 mt-1">Add this asset to a workflow to start tracking progress</p>
                    </div>
                  </div>
                </div>
              ) : (
                <InvestmentTimeline
                  key={`${effectiveAsset.id}-${effectiveWorkflowId || 'no-workflow'}`} // Force remount when asset or workflow changes
                  currentStage={stage}
                  onStageChange={handleStageChange}
                  onStageClick={handleTimelineStageClick}
                  assetSymbol={asset.symbol}
                  assetId={effectiveAsset.id}
                  viewingStageId={viewingStageId}
                  onViewingStageChange={setViewingStageId}
                  workflowId={effectiveWorkflowId}
                  currentPriority={workflowPriorityState}
                  onPriorityChange={handleWorkflowPriorityChange}
                />
              )}
            </div>
            )
          })()}
          </div>
        )}

        {/* ========== LISTS SUB-PAGE ========== */}
        {activeSubPage === 'lists' && (
          <div className="space-y-8">
            {(() => {
              const listsByType = (assetLists as any[] || []).reduce((acc, list) => {
                const type = list.type || 'list'
                if (!acc[type]) acc[type] = []
                acc[type].push(list)
                return acc
              }, {} as Record<string, any[]>)

              return (
                <>
                  {/* Lists Section */}
                  <Card padding="none" id="lists-section-listsContent">
                    <button
                      onClick={() => toggleSection('listsContent')}
                      className="w-full px-5 py-2.5 flex items-center justify-between hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex justify-between items-center flex-1">
                        <h4
                          onClick={(e) => {
                            e.stopPropagation()
                            if (onNavigate) {
                              onNavigate({
                                id: 'lists',
                                title: 'Lists',
                                type: 'lists',
                                data: null
                              })
                            }
                          }}
                          className="font-medium text-gray-900 hover:text-primary-600 cursor-pointer transition-colors"
                        >
                          Lists
                        </h4>
                        <AddToListButton assetId={asset.id} />
                      </div>
                      {collapsedSections.listsContent ? (
                        <ChevronDown className="h-5 w-5 text-gray-400" />
                      ) : (
                        <ChevronUp className="h-5 w-5 text-gray-400" />
                      )}
                    </button>
                    {!collapsedSections.listsContent && (
                      <div className="border-t border-gray-100 px-5 py-2">
                        {listsByType.list && listsByType.list.length > 0 ? (
                          <div className="grid gap-3">
                            {listsByType.list.map((list: any) => (
                              <Card key={list.id} className="hover:shadow-md transition-shadow cursor-pointer">
                                <div className="p-4">
                                  <div className="flex items-start justify-between">
                                    <div>
                                      <h5 className="font-semibold text-gray-900">{list.name}</h5>
                                      {list.description && (
                                        <p className="text-sm text-gray-600 mt-1">{list.description}</p>
                                      )}
                                      {list.created_at && (
                                        <p className="text-xs text-gray-500 mt-2">
                                          Created {formatDistanceToNow(new Date(list.created_at), { addSuffix: true })}
                                        </p>
                                      )}
                                    </div>
                                    <Badge variant="default">list</Badge>
                                  </div>
                                </div>
                              </Card>
                            ))}
                          </div>
                        ) : (
                          <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                            <p className="text-sm text-gray-500">Not in any lists</p>
                          </div>
                        )}
                      </div>
                    )}
                  </Card>

                  {/* Themes Section */}
                  <Card padding="none" id="lists-section-themesContent">
                    <button
                      onClick={() => toggleSection('themesContent')}
                      className="w-full px-5 py-2.5 flex items-center justify-between hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex justify-between items-center flex-1">
                        <h4
                          onClick={(e) => {
                            e.stopPropagation()
                            if (onNavigate) {
                              onNavigate({
                                id: 'themes-list',
                                title: 'All Themes',
                                type: 'themes-list',
                                data: null
                              })
                            }
                          }}
                          className="font-medium text-gray-900 hover:text-primary-600 cursor-pointer transition-colors"
                        >
                          Themes
                        </h4>
                        <AddToThemeButton assetId={asset.id} />
                      </div>
                      {collapsedSections.themesContent ? (
                        <ChevronDown className="h-5 w-5 text-gray-400" />
                      ) : (
                        <ChevronUp className="h-5 w-5 text-gray-400" />
                      )}
                    </button>
                    {!collapsedSections.themesContent && (
                      <div className="border-t border-gray-100 px-5 py-2">
                        {assetThemes && assetThemes.length > 0 ? (
                          <div className="grid gap-2">
                            {assetThemes.map((theme: any) => (
                              <div
                                key={theme.id}
                                className="px-2 py-1 flex items-center gap-2"
                              >
                                <span
                                  onClick={() => {
                                    if (onNavigate) {
                                      onNavigate({
                                        id: theme.id,
                                        title: theme.name,
                                        type: 'theme',
                                        data: theme
                                      })
                                    }
                                  }}
                                  className="text-sm font-medium text-gray-900 hover:bg-gray-50 cursor-pointer transition-colors px-1 py-0.5 rounded"
                                >
                                  {theme.name}
                                </span>
                                <Badge variant={getThemeTypeColor(theme.theme_type)} size="sm">
                                  {theme.theme_type || 'general'}
                                </Badge>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                            <p className="text-sm text-gray-500">Not in any themes</p>
                          </div>
                        )}
                      </div>
                    )}
                  </Card>

                  {/* Portfolios Section */}
                  <Card padding="none" id="lists-section-portfoliosContent">
                    <button
                      onClick={() => toggleSection('portfoliosContent')}
                      className="w-full px-5 py-2.5 flex items-center justify-between hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex justify-between items-center flex-1">
                        <h4
                          onClick={(e) => {
                            e.stopPropagation()
                            if (onNavigate) {
                              onNavigate({
                                id: 'portfolios-list',
                                title: 'All Portfolios',
                                type: 'portfolios-list',
                                data: null
                              })
                            }
                          }}
                          className="font-medium text-gray-900 hover:text-primary-600 cursor-pointer transition-colors"
                        >
                          Portfolios
                        </h4>
                        <AddToQueueButton assetId={asset.id} />
                      </div>
                      {collapsedSections.portfoliosContent ? (
                        <ChevronDown className="h-5 w-5 text-gray-400" />
                      ) : (
                        <ChevronUp className="h-5 w-5 text-gray-400" />
                      )}
                    </button>
                    {!collapsedSections.portfoliosContent && (
                      <div className="border-t border-gray-100 px-5 py-2">
                        {portfolioHoldings && portfolioHoldings.length > 0 ? (
                          <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Portfolio</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Weight</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Shares</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Avg Cost</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total Cost</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Current Value</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Unrealized P&L</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Unrealized %</th>
                                </tr>
                              </thead>
                              <tbody className="bg-white divide-y divide-gray-200">
                                {portfolioHoldings.map((holding: any) => {
                                  const currentPrice = currentQuote?.price || 0
                                  const shares = parseFloat(holding.shares)
                                  const costPerShare = parseFloat(holding.cost)
                                  const totalCost = shares * costPerShare
                                  const currentValue = shares * currentPrice
                                  const unrealizedPnL = currentValue - totalCost
                                  const unrealizedPercentage = totalCost > 0 ? (unrealizedPnL / totalCost) * 100 : 0
                                  const isPositive = unrealizedPnL >= 0

                                  // Calculate weight as percentage of total portfolio
                                  const portfolioTotal = portfolioTotals?.[holding.portfolio_id] || 0
                                  const weight = portfolioTotal > 0 ? (totalCost / portfolioTotal) * 100 : 0

                                  return (
                                    <tr key={holding.id} className="hover:bg-gray-50">
                                      <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="text-sm font-medium text-gray-900">
                                          {holding.portfolios?.name || 'Unknown Portfolio'}
                                        </div>
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                        {portfolioTotal > 0 ? `${weight.toFixed(2)}%` : '--'}
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                        {shares.toLocaleString()}
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                        ${costPerShare.toFixed(2)}
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                        ${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                        {currentPrice > 0 ? `$${currentValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--'}
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                                        {currentPrice > 0 ? (
                                          <span className={`font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                                            {isPositive ? '+' : ''}${unrealizedPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                          </span>
                                        ) : (
                                          <span className="text-gray-400">--</span>
                                        )}
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                                        {currentPrice > 0 ? (
                                          <span className={`font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                                            {isPositive ? '+' : ''}{unrealizedPercentage.toFixed(2)}%
                                          </span>
                                        ) : (
                                          <span className="text-gray-400">--</span>
                                        )}
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                            <p className="text-sm text-gray-500">Not in any portfolios</p>
                          </div>
                        )}
                      </div>
                    )}
                  </Card>

                  {/* Projects Section */}
                  <Card padding="none" id="lists-section-projectsContent">
                    <button
                      onClick={() => toggleSection('projectsContent')}
                      className="w-full px-5 py-2.5 flex items-center justify-between hover:bg-gray-50 transition-colors"
                    >
                      <span className="font-medium text-gray-900">Projects</span>
                      {collapsedSections.projectsContent ? (
                        <ChevronDown className="h-5 w-5 text-gray-400" />
                      ) : (
                        <ChevronUp className="h-5 w-5 text-gray-400" />
                      )}
                    </button>
                    {!collapsedSections.projectsContent && (
                      <div className="border-t border-gray-100 px-5 py-2">
                        <RelatedProjects
                          contextType="asset"
                          contextId={asset.id}
                          contextTitle={`${asset.symbol} - ${asset.company_name}`}
                          onProjectClick={(projectId) => {
                            if (onNavigate) {
                              onNavigate({
                                id: projectId,
                                title: 'Project',
                                type: 'project',
                                data: { id: projectId }
                              })
                            }
                          }}
                        />
                      </div>
                    )}
                  </Card>
                </>
              )
            })()}
          </div>
        )}
      </div>

      {/* Workflow Manager Modal */}
      <WorkflowManager
        isOpen={showWorkflowManager}
        onClose={() => setShowWorkflowManager(false)}
      />
    </div>
  )
}