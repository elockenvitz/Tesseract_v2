import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  TrendingUp, Search, Filter, Plus, Calendar, Target, FileText, ArrowUpDown,
  ChevronDown, ChevronUp, X, LayoutGrid, List, Table2, Bookmark, BookmarkCheck,
  SlidersHorizontal, CalendarRange, Trash2, Check, CheckSquare, Square,
  Download, Tag, ListPlus, AlertCircle, Loader2, MoreHorizontal, Clock,
  TrendingDown, Bell, RefreshCw, Activity, Settings2, GripVertical, Eye, EyeOff,
  ChevronRight, Pin, PinOff, Edit3, Save, Columns3, GitBranch, FolderTree,
  Layers, GripHorizontal, FolderOpen, Folder, Maximize2, Minimize2
} from 'lucide-react'
import { PriorityBadge } from '../components/ui/PriorityBadge'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { ListSkeleton } from '../components/common/LoadingSkeleton'
import { EmptyState } from '../components/common/EmptyState'
import { useMarketData, useMarketStatus, usePriceAlerts, MarketQuote } from '../hooks/useMarketData'
import { formatDistanceToNow, format, isAfter, isBefore, parseISO, startOfDay, endOfDay } from 'date-fns'
import { clsx } from 'clsx'
import { TableProvider, useTableContext, DENSITY_CONFIG } from '../contexts/TableContext'
import { KeyboardShortcutsHelp } from '../components/table/KeyboardShortcutsHelp'
import { CommandPalette } from '../components/table/CommandPalette'
import { DensityToggle } from '../components/table/DensityToggle'

// View modes (compact is now a density option, not a separate view)
type ViewMode = 'table' | 'kanban' | 'tree'

// Group by options
type GroupByOption = 'none' | 'sector' | 'priority' | 'stage' | 'theme'

const GROUP_BY_OPTIONS: { value: GroupByOption; label: string; icon: any }[] = [
  { value: 'none', label: 'No Grouping', icon: List },
  { value: 'sector', label: 'By Sector', icon: Layers },
  { value: 'priority', label: 'By Priority', icon: AlertCircle },
  { value: 'stage', label: 'By Stage', icon: GitBranch },
  { value: 'theme', label: 'By Theme', icon: FolderTree }
]

// Kanban column order for priority
const KANBAN_COLUMNS = ['high', 'medium', 'low', 'none'] as const

// Kanban organization options
type KanbanOrganization = 'priority' | 'stage' | 'workflow'

const KANBAN_ORGANIZATION_OPTIONS: { value: KanbanOrganization; label: string; icon: any }[] = [
  { value: 'priority', label: 'Priority', icon: AlertCircle },
  { value: 'stage', label: 'Process Stage', icon: Target },
  { value: 'workflow', label: 'Workflow', icon: GitBranch }
]

// Process stages with labels and colors
const PROCESS_STAGES = {
  outdated: { label: 'Outdated', color: 'bg-gray-100 text-gray-700' },
  prioritized: { label: 'Prioritized', color: 'bg-purple-100 text-purple-700' },
  in_progress: { label: 'In Progress', color: 'bg-blue-100 text-blue-700' },
  recommend: { label: 'Recommend', color: 'bg-green-100 text-green-700' },
  review: { label: 'Review', color: 'bg-yellow-100 text-yellow-700' },
  action: { label: 'Action', color: 'bg-red-100 text-red-700' },
  monitor: { label: 'Monitor', color: 'bg-cyan-100 text-cyan-700' }
}

// Priority options
const PRIORITY_OPTIONS = [
  { value: 'high', label: 'High', color: 'bg-red-100 text-red-700' },
  { value: 'medium', label: 'Medium', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'low', label: 'Low', color: 'bg-green-100 text-green-700' },
  { value: 'none', label: 'None', color: 'bg-gray-100 text-gray-700' }
]

// Date range presets
const DATE_PRESETS = [
  { label: 'Today', days: 0 },
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'This year', days: 365 }
]

// Helper to auto-summarize long text for column display
function summarizeText(text: string | null | undefined, maxLength: number = 60): string {
  if (!text) return ''
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= maxLength) return cleaned
  // Try to cut at a word boundary
  const truncated = cleaned.substring(0, maxLength)
  const lastSpace = truncated.lastIndexOf(' ')
  return (lastSpace > maxLength * 0.7 ? truncated.substring(0, lastSpace) : truncated) + '...'
}

// Column configuration for table
interface ColumnConfig {
  id: string
  label: string
  visible: boolean
  width: number
  minWidth: number
  sortable: boolean
  pinned: boolean
}

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: 'select', label: '', visible: true, width: 32, minWidth: 32, sortable: false, pinned: false },
  { id: 'asset', label: 'Asset', visible: true, width: 220, minWidth: 150, sortable: true, pinned: true },
  { id: 'coverage', label: 'Coverage', visible: true, width: 140, minWidth: 100, sortable: true, pinned: false },
  { id: 'workflows', label: 'Workflows', visible: true, width: 120, minWidth: 80, sortable: true, pinned: false },
  { id: 'price', label: 'Price', visible: true, width: 100, minWidth: 80, sortable: true, pinned: false },
  { id: 'priority', label: 'Priority', visible: true, width: 90, minWidth: 70, sortable: true, pinned: false },
  { id: 'thesis', label: 'Thesis', visible: false, width: 200, minWidth: 120, sortable: false, pinned: false },
  { id: 'where_different', label: 'Where Different', visible: false, width: 200, minWidth: 120, sortable: false, pinned: false },
  { id: 'notes', label: 'Notes', visible: false, width: 200, minWidth: 120, sortable: false, pinned: false },
  { id: 'sector', label: 'Sector', visible: false, width: 120, minWidth: 80, sortable: true, pinned: false },
  { id: 'updated', label: 'Last Updated', visible: true, width: 140, minWidth: 110, sortable: true, pinned: false }
]

// Expanded row height (stays fixed, not density-dependent)
const EXPANDED_ROW_HEIGHT = 280

interface SavedFilter {
  id: string
  name: string
  filters: {
    searchQuery: string
    priorities: string[]
    sectors: string[]
    stages: string[]
    dateField: 'created_at' | 'updated_at'
    dateFrom: string | null
    dateTo: string | null
  }
  created_at: string
}

interface AssetsListPageProps {
  onAssetSelect?: (asset: any) => void
}

export function AssetsListPage({ onAssetSelect }: AssetsListPageProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Density state - synced with localStorage for consistency with TableContext
  type DensityMode = 'comfortable' | 'compact' | 'ultra'
  const [density, setDensity] = useState<DensityMode>(() => {
    const saved = localStorage.getItem('table-density')
    return (saved as DensityMode) || 'comfortable'
  })

  // Listen for density changes from DensityToggle
  useEffect(() => {
    const handleStorageChange = () => {
      const saved = localStorage.getItem('table-density')
      if (saved && saved !== density) {
        setDensity(saved as DensityMode)
      }
    }
    // Check periodically for changes (since storage events don't fire for same-window changes)
    const interval = setInterval(handleStorageChange, 200)
    return () => clearInterval(interval)
  }, [density])

  // Get the row height based on density
  const densityRowHeight = DENSITY_CONFIG[density].rowHeight

  // Filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPriorities, setSelectedPriorities] = useState<string[]>([])
  const [selectedSectors, setSelectedSectors] = useState<string[]>([])
  const [selectedStages, setSelectedStages] = useState<string[]>([])
  const [dateField, setDateField] = useState<'created_at' | 'updated_at'>('updated_at')
  const [dateFrom, setDateFrom] = useState<string | null>(null)
  const [dateTo, setDateTo] = useState<string | null>(null)

  // Sort state
  const [sortBy, setSortBy] = useState('updated_at')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  // UI state
  const [viewMode, setViewMode] = useState<ViewMode>('table')
  const [activeTableFilter, setActiveTableFilter] = useState<string | null>(null)
  const [showSaveFilterModal, setShowSaveFilterModal] = useState(false)
  const [newFilterName, setNewFilterName] = useState('')

  // Bulk selection state
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set())
  const [showBulkPriorityModal, setShowBulkPriorityModal] = useState(false)
  const [showBulkStageModal, setShowBulkStageModal] = useState(false)
  const [showBulkListModal, setShowBulkListModal] = useState(false)
  const [showBulkTagModal, setShowBulkTagModal] = useState(false)
  const [bulkActionLoading, setBulkActionLoading] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState('#3B82F6')

  // Market data state
  const [showLivePrices, setShowLivePrices] = useState(true)

  // Enhanced table state - with localStorage persistence
  const [columns, setColumns] = useState<ColumnConfig[]>(() => {
    try {
      const saved = localStorage.getItem('assetsTableColumns')
      if (saved) {
        const parsed = JSON.parse(saved) as ColumnConfig[]
        // Merge with defaults to handle new columns added since last save
        return DEFAULT_COLUMNS.map(defaultCol => {
          const savedCol = parsed.find(c => c.id === defaultCol.id)
          return savedCol ? { ...defaultCol, visible: savedCol.visible, width: savedCol.width, pinned: savedCol.pinned } : defaultCol
        })
      }
    } catch (e) {
      console.warn('Failed to load table columns from localStorage:', e)
    }
    return DEFAULT_COLUMNS
  })
  const [showColumnSettings, setShowColumnSettings] = useState(false)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [editingCell, setEditingCell] = useState<{ assetId: string; field: 'priority' | 'stage' } | null>(null)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingNoteValue, setEditingNoteValue] = useState('')
  const [resizingColumn, setResizingColumn] = useState<string | null>(null)
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null)
  const [editingColumnLabel, setEditingColumnLabel] = useState<string | null>(null)
  const [editingColumnValue, setEditingColumnValue] = useState('')
  const [showAddColumnMenu, setShowAddColumnMenu] = useState(false)
  const tableContainerRef = useRef<HTMLDivElement>(null)
  const columnSettingsRef = useRef<HTMLDivElement>(null)
  const tableFilterRef = useRef<HTMLDivElement>(null)

  // Column management state (used by table view)
  const [dropTargetColumn, setDropTargetColumn] = useState<string | null>(null)
  const [frozenColumnId, setFrozenColumnId] = useState<string | null>(null)
  const [columnContextMenu, setColumnContextMenu] = useState<{ x: number; y: number; columnId: string } | null>(null)
  const [showColumnsMenu, setShowColumnsMenu] = useState(false)
  const [workflowPopover, setWorkflowPopover] = useState<{ assetId: string; x: number; y: number } | null>(null)
  const columnsMenuRef = useRef<HTMLDivElement>(null)

  // Grouping state
  const [groupBy, setGroupBy] = useState<GroupByOption>('none')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [showGroupByMenu, setShowGroupByMenu] = useState(false)
  const [draggedAsset, setDraggedAsset] = useState<string | null>(null)
  const [expandedTreeNodes, setExpandedTreeNodes] = useState<Set<string>>(new Set(['root']))
  const [treeOrganization, setTreeOrganization] = useState<'theme' | 'portfolio' | 'list' | 'sector' | 'priority' | 'workflow'>('theme')
  const groupByMenuRef = useRef<HTMLDivElement>(null)

  // Kanban view state
  const [kanbanOrganization, setKanbanOrganization] = useState<KanbanOrganization>('priority')
  const [kanbanColumnSearch, setKanbanColumnSearch] = useState<Record<string, string>>({})
  const [showKanbanOrgMenu, setShowKanbanOrgMenu] = useState(false)
  const kanbanOrgMenuRef = useRef<HTMLDivElement>(null)
  const [hiddenKanbanColumns, setHiddenKanbanColumns] = useState<Set<string>>(new Set())
  const [fullscreenKanbanColumn, setFullscreenKanbanColumn] = useState<string | null>(null)

  // Fetch all assets
  const { data: assets, isLoading: assetsLoading } = useQuery({
    queryKey: ['all-assets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assets')
        .select('*')
        .order('updated_at', { ascending: false })

      if (error) throw error
      return data || []
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  // Fetch asset workflow progress (which workflows each asset is in)
  const { data: assetWorkflowProgress } = useQuery({
    queryKey: ['asset-workflow-progress-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_workflow_progress')
        .select(`
          asset_id,
          workflow_id,
          is_started,
          is_completed,
          current_stage_key,
          workflows:workflow_id (
            id,
            name,
            color
          )
        `)
        .eq('is_started', true)
        .eq('is_completed', false)

      if (error) throw error
      return data || []
    },
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  // Create a map of asset_id -> workflow info
  const assetWorkflowMap = useMemo(() => {
    if (!assetWorkflowProgress) return new Map<string, Array<{ id: string; name: string; color: string }>>()

    const map = new Map<string, Array<{ id: string; name: string; color: string }>>()
    assetWorkflowProgress.forEach(progress => {
      const workflow = progress.workflows as any
      if (!workflow) return

      const existing = map.get(progress.asset_id) || []
      existing.push({
        id: workflow.id,
        name: workflow.name,
        color: workflow.color || '#6366f1'
      })
      map.set(progress.asset_id, existing)
    })
    return map
  }, [assetWorkflowProgress])

  // Fetch coverage data for all assets
  const { data: coverageData } = useQuery({
    queryKey: ['asset-coverage-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coverage')
        .select(`
          asset_id,
          user_id,
          analyst_name,
          role,
          is_lead,
          is_active,
          team_id,
          org_chart_nodes:team_id (
            id,
            name
          )
        `)
        .eq('is_active', true)

      if (error) throw error
      return data || []
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  // Fetch users to map user_id to names (since coverage.user_id has no FK)
  const { data: usersData } = useQuery({
    queryKey: ['users-for-coverage'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, first_name, last_name')

      if (error) throw error
      return data || []
    },
    staleTime: 10 * 60 * 1000,
  })

  // Create users lookup map
  const usersMap = useMemo(() => {
    if (!usersData) return new Map<string, string>()
    const map = new Map<string, string>()
    usersData.forEach(u => {
      const name = `${u.first_name || ''} ${u.last_name || ''}`.trim()
      if (name) map.set(u.id, name)
    })
    return map
  }, [usersData])

  // Create a map of asset_id -> coverage info
  const assetCoverageMap = useMemo(() => {
    if (!coverageData) return new Map<string, Array<{ analyst: string; team: string; isLead: boolean }>>()

    const map = new Map<string, Array<{ analyst: string; team: string; isLead: boolean }>>()
    coverageData.forEach(cov => {
      const orgChartNode = cov.org_chart_nodes as any
      // Try to get name from users map, fall back to analyst_name field
      const analystName = (cov.user_id && usersMap.get(cov.user_id)) || cov.analyst_name || 'Unknown'
      const teamName = orgChartNode?.name || ''

      const existing = map.get(cov.asset_id) || []
      existing.push({
        analyst: analystName,
        team: teamName,
        isLead: cov.is_lead || false
      })
      map.set(cov.asset_id, existing)
    })
    return map
  }, [coverageData, usersMap])

  // Quick notes are now stored directly on the asset via quick_note field
  // No separate query needed - they come with the assets data

  // Extract symbols for market data fetching
  const assetSymbols = useMemo(() => {
    if (!assets) return []
    return assets.map(a => a.symbol).filter(Boolean)
  }, [assets])

  // Market status
  const marketStatus = useMarketStatus()

  // Fetch market data for all assets
  const { quotes, getQuote, refreshAll, isLoading: marketDataLoading } = useMarketData(
    assetSymbols,
    {
      refreshInterval: marketStatus.isOpen ? 30000 : 120000, // 30s when market open, 2min otherwise
      enabled: showLivePrices && assetSymbols.length > 0
    }
  )

  // Price alerts
  const priceAlerts = usePriceAlerts(
    (assets || []).map(a => ({
      id: a.id,
      symbol: a.symbol,
      price_targets: a.price_targets
    })),
    quotes
  )

  // Check if asset has a price alert
  const hasAlert = useCallback((assetId: string) => {
    return priceAlerts.some(alert => alert.assetId === assetId)
  }, [priceAlerts])

  // Fetch saved filters
  const { data: savedFilters } = useQuery({
    queryKey: ['saved-asset-filters', user?.id],
    queryFn: async () => {
      if (!user?.id) return []
      const { data, error } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', user.id)
        .eq('preference_type', 'asset_filter')
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Error fetching saved filters:', error)
        return []
      }

      return (data || []).map(pref => ({
        id: pref.id,
        name: pref.preference_key,
        filters: pref.preference_value,
        created_at: pref.created_at
      })) as SavedFilter[]
    },
    enabled: !!user?.id,
  })

  // Save filter mutation
  const saveFilterMutation = useMutation({
    mutationFn: async (name: string) => {
      if (!user?.id) throw new Error('User not authenticated')

      const filterData = {
        searchQuery,
        priorities: selectedPriorities,
        sectors: selectedSectors,
        stages: selectedStages,
        dateField,
        dateFrom,
        dateTo
      }

      const { data, error } = await supabase
        .from('user_preferences')
        .insert({
          user_id: user.id,
          preference_type: 'asset_filter',
          preference_key: name,
          preference_value: filterData
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-asset-filters'] })
      setShowSaveFilterModal(false)
      setNewFilterName('')
    }
  })

  // Delete filter mutation
  const deleteFilterMutation = useMutation({
    mutationFn: async (filterId: string) => {
      const { error } = await supabase
        .from('user_preferences')
        .delete()
        .eq('id', filterId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-asset-filters'] })
    }
  })

  // Fetch user's asset lists
  const { data: assetLists } = useQuery({
    queryKey: ['asset-lists', user?.id],
    queryFn: async () => {
      if (!user?.id) return []
      const { data, error } = await supabase
        .from('asset_lists')
        .select('*')
        .eq('created_by', user.id)
        .order('name')

      if (error) {
        console.error('Error fetching asset lists:', error)
        return []
      }
      return data || []
    },
    enabled: !!user?.id,
  })

  // Fetch asset list memberships (which assets belong to which lists)
  const { data: assetListItems } = useQuery({
    queryKey: ['asset-list-items'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_list_items')
        .select('asset_id, list_id')

      if (error) {
        console.error('Error fetching asset list items:', error)
        return []
      }
      return data || []
    },
  })

  // Build a map of asset_id -> list names for tree view
  const assetToListsMap = useMemo(() => {
    const map = new Map<string, string[]>()
    if (!assetListItems || !assetLists) return map

    const listIdToName = new Map(assetLists.map((l: any) => [l.id, l.name]))

    assetListItems.forEach((item: any) => {
      const listName = listIdToName.get(item.list_id)
      if (listName) {
        if (!map.has(item.asset_id)) {
          map.set(item.asset_id, [])
        }
        map.get(item.asset_id)!.push(listName)
      }
    })
    return map
  }, [assetListItems, assetLists])

  // Fetch active workflow branches for tree view organization
  const { data: workflows } = useQuery({
    queryKey: ['workflow-branches-for-tree'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workflows')
        .select('id, name, parent_workflow_id')
        .not('parent_workflow_id', 'is', null) // Only branches (not templates)
        .eq('archived', false)
        .eq('deleted', false)
        .order('name')

      if (error) {
        console.error('Error fetching workflow branches:', error)
        return []
      }
      return data || []
    },
  })

  // Fetch asset-workflow associations (from checklist items, only for active branches)
  const { data: assetWorkflowItems } = useQuery({
    queryKey: ['asset-workflow-items', workflows],
    queryFn: async () => {
      if (!workflows || workflows.length === 0) return []

      // Get workflow IDs of active branches
      const activeBranchIds = workflows.map((w: any) => w.id)

      const { data, error } = await supabase
        .from('asset_checklist_items')
        .select('asset_id, workflow_id')
        .in('workflow_id', activeBranchIds)

      if (error) {
        console.error('Error fetching asset workflow items:', error)
        return []
      }
      // Deduplicate - each asset-workflow pair should only appear once
      const seen = new Set<string>()
      return (data || []).filter((item: any) => {
        if (!item.workflow_id) return false
        const key = `${item.asset_id}-${item.workflow_id}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    },
    enabled: !!workflows && workflows.length > 0,
  })

  // Build a map of asset_id -> workflow names for tree view
  const assetToWorkflowsMap = useMemo(() => {
    const map = new Map<string, string[]>()
    if (!assetWorkflowItems || !workflows) return map

    const workflowIdToName = new Map(workflows.map((w: any) => [w.id, w.name]))

    assetWorkflowItems.forEach((item: any) => {
      const workflowName = workflowIdToName.get(item.workflow_id)
      if (workflowName) {
        if (!map.has(item.asset_id)) {
          map.set(item.asset_id, [])
        }
        if (!map.get(item.asset_id)!.includes(workflowName)) {
          map.get(item.asset_id)!.push(workflowName)
        }
      }
    })
    return map
  }, [assetWorkflowItems, workflows])

  // Fetch available tags
  const { data: assetTags, refetch: refetchTags } = useQuery({
    queryKey: ['asset-tags'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_tags')
        .select('*')
        .order('name')

      if (error) {
        console.error('Error fetching asset tags:', error)
        return []
      }
      return data || []
    },
  })

  // Bulk update priority mutation
  const bulkUpdatePriorityMutation = useMutation({
    mutationFn: async (priority: string) => {
      setBulkActionLoading(true)
      const assetIds = Array.from(selectedAssetIds)
      const { error } = await supabase
        .from('assets')
        .update({ priority, updated_at: new Date().toISOString() })
        .in('id', assetIds)

      if (error) throw error
      return assetIds.length
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['all-assets'] })
      setSelectedAssetIds(new Set())
      setShowBulkPriorityModal(false)
      setBulkActionLoading(false)
    },
    onError: () => {
      setBulkActionLoading(false)
    }
  })

  // Bulk update stage mutation
  const bulkUpdateStageMutation = useMutation({
    mutationFn: async (stage: string) => {
      setBulkActionLoading(true)
      const assetIds = Array.from(selectedAssetIds)
      const { error } = await supabase
        .from('assets')
        .update({ process_stage: stage, updated_at: new Date().toISOString() })
        .in('id', assetIds)

      if (error) throw error
      return assetIds.length
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['all-assets'] })
      setSelectedAssetIds(new Set())
      setShowBulkStageModal(false)
      setBulkActionLoading(false)
    },
    onError: () => {
      setBulkActionLoading(false)
    }
  })

  // Bulk add to list mutation
  const bulkAddToListMutation = useMutation({
    mutationFn: async (listId: string) => {
      setBulkActionLoading(true)
      const assetIds = Array.from(selectedAssetIds)

      // Insert each asset to the list (ignore duplicates)
      const inserts = assetIds.map(assetId => ({
        list_id: listId,
        asset_id: assetId,
        added_by: user?.id
      }))

      const { error } = await supabase
        .from('asset_list_items')
        .upsert(inserts, { onConflict: 'list_id,asset_id', ignoreDuplicates: true })

      if (error) throw error
      return assetIds.length
    },
    onSuccess: () => {
      setSelectedAssetIds(new Set())
      setShowBulkListModal(false)
      setBulkActionLoading(false)
    },
    onError: () => {
      setBulkActionLoading(false)
    }
  })

  // Create new tag mutation
  const createTagMutation = useMutation({
    mutationFn: async ({ name, color }: { name: string; color: string }) => {
      const { data, error } = await supabase
        .from('asset_tags')
        .insert({ name, color, created_by: user?.id })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      refetchTags()
      setNewTagName('')
    }
  })

  // Bulk assign tag mutation
  const bulkAssignTagMutation = useMutation({
    mutationFn: async (tagId: string) => {
      setBulkActionLoading(true)
      const assetIds = Array.from(selectedAssetIds)

      const assignments = assetIds.map(assetId => ({
        asset_id: assetId,
        tag_id: tagId,
        assigned_by: user?.id
      }))

      const { error } = await supabase
        .from('asset_tag_assignments')
        .upsert(assignments, { onConflict: 'asset_id,tag_id', ignoreDuplicates: true })

      if (error) throw error
      return assetIds.length
    },
    onSuccess: () => {
      setSelectedAssetIds(new Set())
      setShowBulkTagModal(false)
      setBulkActionLoading(false)
    },
    onError: () => {
      setBulkActionLoading(false)
    }
  })

  // Get unique sectors for filter
  const sectors = useMemo(() => {
    if (!assets) return []
    const uniqueSectors = [...new Set(assets.map(asset => asset.sector).filter(Boolean))]
    return uniqueSectors.sort()
  }, [assets])

  // Get unique stages for filter
  const stages = useMemo(() => {
    if (!assets) return []
    const uniqueStages = [...new Set(assets.map(asset => asset.process_stage).filter(Boolean))]
    return uniqueStages
  }, [assets])

  // Filter and sort assets
  const filteredAssets = useMemo(() => {
    if (!assets) return []

    let filtered = assets

    // Apply filters
    filtered = assets.filter(asset => {
      // Search filter
      if (searchQuery) {
        const searchLower = searchQuery.toLowerCase()
        const matchesSearch =
          asset.symbol?.toLowerCase().includes(searchLower) ||
          asset.company_name?.toLowerCase().includes(searchLower) ||
          (asset.sector && asset.sector.toLowerCase().includes(searchLower))
        if (!matchesSearch) return false
      }

      // Priority filter (multi-select)
      if (selectedPriorities.length > 0 && !selectedPriorities.includes(asset.priority || 'none')) {
        return false
      }

      // Sector filter (multi-select)
      if (selectedSectors.length > 0 && !selectedSectors.includes(asset.sector)) {
        return false
      }

      // Stage filter (multi-select)
      if (selectedStages.length > 0 && !selectedStages.includes(asset.process_stage)) {
        return false
      }

      // Date range filter
      if (dateFrom || dateTo) {
        const assetDate = asset[dateField] ? parseISO(asset[dateField]) : null
        if (!assetDate) return false

        if (dateFrom && isBefore(assetDate, startOfDay(parseISO(dateFrom)))) {
          return false
        }
        if (dateTo && isAfter(assetDate, endOfDay(parseISO(dateTo)))) {
          return false
        }
      }

      return true
    })

    // Sort assets
    filtered = [...filtered].sort((a, b) => {
      let aValue, bValue

      switch (sortBy) {
        case 'symbol':
          aValue = a.symbol || ''
          bValue = b.symbol || ''
          break
        case 'company_name':
          aValue = a.company_name || ''
          bValue = b.company_name || ''
          break
        case 'current_price':
          aValue = Number(a.current_price) || 0
          bValue = Number(b.current_price) || 0
          break
        case 'priority':
          const priorityOrder = { high: 4, medium: 3, low: 2, none: 1 }
          aValue = priorityOrder[a.priority as keyof typeof priorityOrder] || 0
          bValue = priorityOrder[b.priority as keyof typeof priorityOrder] || 0
          break
        case 'process_stage':
          const stageOrder = {
            outdated: 1, prioritized: 2, in_progress: 3,
            recommend: 4, review: 5, action: 6, monitor: 7
          }
          aValue = stageOrder[a.process_stage as keyof typeof stageOrder] || 0
          bValue = stageOrder[b.process_stage as keyof typeof stageOrder] || 0
          break
        case 'created_at':
          aValue = new Date(a.created_at || 0).getTime()
          bValue = new Date(b.created_at || 0).getTime()
          break
        case 'updated_at':
        default:
          aValue = new Date(a.updated_at || 0).getTime()
          bValue = new Date(b.updated_at || 0).getTime()
          break
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortOrder === 'asc'
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue)
      }

      return sortOrder === 'asc' ? aValue - bValue : bValue - aValue
    })

    return filtered
  }, [assets, searchQuery, selectedPriorities, selectedSectors, selectedStages, dateField, dateFrom, dateTo, sortBy, sortOrder])

  // Active filters for pills
  const activeFilters = useMemo(() => {
    const filters: { type: string; value: string; label: string }[] = []

    if (searchQuery) {
      filters.push({ type: 'search', value: searchQuery, label: `Search: "${searchQuery}"` })
    }

    selectedPriorities.forEach(p => {
      const option = PRIORITY_OPTIONS.find(o => o.value === p)
      filters.push({ type: 'priority', value: p, label: `Priority: ${option?.label || p}` })
    })

    selectedSectors.forEach(s => {
      filters.push({ type: 'sector', value: s, label: `Sector: ${s}` })
    })

    selectedStages.forEach(s => {
      const stage = PROCESS_STAGES[s as keyof typeof PROCESS_STAGES]
      filters.push({ type: 'stage', value: s, label: `Stage: ${stage?.label || s}` })
    })

    if (dateFrom || dateTo) {
      const label = dateFrom && dateTo
        ? `${dateField === 'created_at' ? 'Created' : 'Updated'}: ${format(parseISO(dateFrom), 'MMM d')} - ${format(parseISO(dateTo), 'MMM d')}`
        : dateFrom
          ? `${dateField === 'created_at' ? 'Created' : 'Updated'} after ${format(parseISO(dateFrom), 'MMM d')}`
          : `${dateField === 'created_at' ? 'Created' : 'Updated'} before ${format(parseISO(dateTo!), 'MMM d')}`
      filters.push({ type: 'date', value: 'date', label })
    }

    return filters
  }, [searchQuery, selectedPriorities, selectedSectors, selectedStages, dateField, dateFrom, dateTo])

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortOrder('desc')
    }
  }

  const handleAssetClick = (asset: any) => {
    if (onAssetSelect) {
      onAssetSelect({
        id: asset.id,
        title: asset.symbol,
        type: 'asset',
        data: asset
      })
    }
  }

  const removeFilter = (type: string, value: string) => {
    switch (type) {
      case 'search':
        setSearchQuery('')
        break
      case 'priority':
        setSelectedPriorities(prev => prev.filter(p => p !== value))
        break
      case 'sector':
        setSelectedSectors(prev => prev.filter(s => s !== value))
        break
      case 'stage':
        setSelectedStages(prev => prev.filter(s => s !== value))
        break
      case 'date':
        setDateFrom(null)
        setDateTo(null)
        break
    }
  }

  const clearAllFilters = () => {
    setSearchQuery('')
    setSelectedPriorities([])
    setSelectedSectors([])
    setSelectedStages([])
    setDateFrom(null)
    setDateTo(null)
  }

  const applyDatePreset = (days: number) => {
    const today = new Date()
    if (days === 0) {
      setDateFrom(format(today, 'yyyy-MM-dd'))
      setDateTo(format(today, 'yyyy-MM-dd'))
    } else {
      const fromDate = new Date(today)
      fromDate.setDate(fromDate.getDate() - days)
      setDateFrom(format(fromDate, 'yyyy-MM-dd'))
      setDateTo(format(today, 'yyyy-MM-dd'))
    }
  }

  const loadSavedFilter = (filter: SavedFilter) => {
    setSearchQuery(filter.filters.searchQuery || '')
    setSelectedPriorities(filter.filters.priorities || [])
    setSelectedSectors(filter.filters.sectors || [])
    setSelectedStages(filter.filters.stages || [])
    setDateField(filter.filters.dateField || 'updated_at')
    setDateFrom(filter.filters.dateFrom || null)
    setDateTo(filter.filters.dateTo || null)
  }

  const handleSaveFilter = () => {
    if (newFilterName.trim()) {
      saveFilterMutation.mutate(newFilterName.trim())
    }
  }

  // Selection helpers
  const toggleAssetSelection = useCallback((assetId: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setSelectedAssetIds(prev => {
      const next = new Set(prev)
      if (next.has(assetId)) {
        next.delete(assetId)
      } else {
        next.add(assetId)
      }
      return next
    })
  }, [])

  const selectAllFiltered = useCallback(() => {
    setSelectedAssetIds(new Set(filteredAssets.map(a => a.id)))
  }, [filteredAssets])

  const clearSelection = useCallback(() => {
    setSelectedAssetIds(new Set())
    setSelectionMode(false)
  }, [])

  const isAllSelected = useMemo(() => {
    return filteredAssets.length > 0 && filteredAssets.every(a => selectedAssetIds.has(a.id))
  }, [filteredAssets, selectedAssetIds])

  const isSomeSelected = useMemo(() => {
    return selectedAssetIds.size > 0 && !isAllSelected
  }, [selectedAssetIds, isAllSelected])

  // Export to CSV
  const exportToCSV = useCallback(() => {
    const assetsToExport = selectedAssetIds.size > 0
      ? filteredAssets.filter(a => selectedAssetIds.has(a.id))
      : filteredAssets

    const headers = ['Symbol', 'Company Name', 'Sector', 'Priority', 'Stage', 'Price', 'Created', 'Updated']
    const rows = assetsToExport.map(asset => [
      asset.symbol || '',
      asset.company_name || '',
      asset.sector || '',
      asset.priority || '',
      asset.process_stage || '',
      asset.current_price?.toString() || '',
      asset.created_at ? format(new Date(asset.created_at), 'yyyy-MM-dd') : '',
      asset.updated_at ? format(new Date(asset.updated_at), 'yyyy-MM-dd') : ''
    ])

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `assets_export_${format(new Date(), 'yyyy-MM-dd_HHmmss')}.csv`
    link.click()
    URL.revokeObjectURL(link.href)

    // Clear selection after export
    if (selectedAssetIds.size > 0) {
      setSelectedAssetIds(new Set())
    }
  }, [filteredAssets, selectedAssetIds])

  // Toggle multi-select helpers
  const togglePriority = (priority: string) => {
    setSelectedPriorities(prev =>
      prev.includes(priority) ? prev.filter(p => p !== priority) : [...prev, priority]
    )
  }

  const toggleSector = (sector: string) => {
    setSelectedSectors(prev =>
      prev.includes(sector) ? prev.filter(s => s !== sector) : [...prev, sector]
    )
  }

  const toggleStage = (stage: string) => {
    setSelectedStages(prev =>
      prev.includes(stage) ? prev.filter(s => s !== stage) : [...prev, stage]
    )
  }

  // Quick edit mutation
  const quickEditMutation = useMutation({
    mutationFn: async ({ assetId, field, value }: { assetId: string; field: string; value: string }) => {
      const { error } = await supabase
        .from('assets')
        .update({ [field]: value, updated_at: new Date().toISOString() })
        .eq('id', assetId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-assets'] })
      setEditingCell(null)
    }
  })

  // Save/update quick note mutation - updates the quick_note field on the asset directly
  const saveNoteMutation = useMutation({
    mutationFn: async ({ assetId, content }: { assetId: string; content: string }) => {
      const { error } = await supabase
        .from('assets')
        .update({
          quick_note: content,
          quick_note_updated_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', assetId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-assets'] })
      setEditingNoteId(null)
      setEditingNoteValue('')
    }
  })

  // Start editing a note
  const startEditingNote = useCallback((assetId: string, currentContent: string) => {
    setEditingNoteId(assetId)
    setEditingNoteValue(currentContent)
  }, [])

  // Cancel note editing
  const cancelNoteEdit = useCallback(() => {
    setEditingNoteId(null)
    setEditingNoteValue('')
  }, [])

  // Save quick note (called on blur or Enter)
  const saveNote = useCallback((assetId: string) => {
    const trimmedValue = editingNoteValue.trim()
    // Always save - allows clearing the note by saving empty string
    saveNoteMutation.mutate({
      assetId,
      content: trimmedValue
    })
  }, [editingNoteValue, saveNoteMutation])

  // Column management functions
  const toggleColumnVisibility = useCallback((columnId: string) => {
    setColumns(prev => prev.map(col =>
      col.id === columnId ? { ...col, visible: !col.visible } : col
    ))
  }, [])

  const toggleColumnPin = useCallback((columnId: string) => {
    setColumns(prev => prev.map(col =>
      col.id === columnId ? { ...col, pinned: !col.pinned } : col
    ))
  }, [])

  const updateColumnLabel = useCallback((columnId: string, newLabel: string) => {
    setColumns(prev => prev.map(col =>
      col.id === columnId ? { ...col, label: newLabel } : col
    ))
  }, [])

  const reorderColumns = useCallback((draggedId: string, targetId: string) => {
    setColumns(prev => {
      const newColumns = [...prev]
      const draggedIndex = newColumns.findIndex(c => c.id === draggedId)
      const targetIndex = newColumns.findIndex(c => c.id === targetId)
      if (draggedIndex === -1 || targetIndex === -1) return prev
      const [draggedCol] = newColumns.splice(draggedIndex, 1)
      newColumns.splice(targetIndex, 0, draggedCol)
      return newColumns
    })
    setDraggedColumn(null)
  }, [])

  const handleColumnResize = useCallback((columnId: string, newWidth: number) => {
    setColumns(prev => prev.map(col => {
      if (col.id === columnId) {
        return { ...col, width: Math.max(col.minWidth, newWidth) }
      }
      return col
    }))
  }, [])

  const resetColumnWidths = useCallback(() => {
    setColumns(DEFAULT_COLUMNS)
  }, [])

  // Handle column context menu
  const handleColumnContextMenu = useCallback((e: React.MouseEvent, columnId: string) => {
    e.preventDefault()
    setColumnContextMenu({ x: e.clientX, y: e.clientY, columnId })
  }, [])

  const handleFreezeColumn = useCallback((columnId: string) => {
    setFrozenColumnId(prev => prev === columnId ? null : columnId)
    setColumnContextMenu(null)
  }, [])

  const handleUnfreezeColumns = useCallback(() => {
    setFrozenColumnId(null)
    setColumnContextMenu(null)
  }, [])

  // Close context menu on outside click
  useEffect(() => {
    if (!columnContextMenu) return
    const handleClickOutside = () => setColumnContextMenu(null)
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [columnContextMenu])

  // Persist table columns to localStorage when they change
  useEffect(() => {
    try {
      localStorage.setItem('assetsTableColumns', JSON.stringify(columns))
    } catch (e) {
      console.warn('Failed to save table columns to localStorage:', e)
    }
  }, [columns])

  // Row expansion
  const toggleRowExpansion = useCallback((assetId: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(assetId)) {
        next.delete(assetId)
      } else {
        next.add(assetId)
      }
      return next
    })
  }, [])

  // Get visible columns (respecting pinned order)
  const visibleColumns = useMemo(() => {
    const pinnedCols = columns.filter(c => c.visible && c.pinned)
    const unpinnedCols = columns.filter(c => c.visible && !c.pinned)
    return [...pinnedCols, ...unpinnedCols]
  }, [columns])

  // Calculate frozen column info (for table view column freezing)
  const frozenColumnInfo = useMemo(() => {
    if (!frozenColumnId) return { frozenCount: 0, offsets: new Map<string, number>(), totalFrozenWidth: 0 }

    const offsets = new Map<string, number>()
    let currentOffset = 0
    let frozenCount = 0
    let foundFrozen = false

    for (const col of visibleColumns) {
      if (col.id === 'select' && !selectionMode) continue

      offsets.set(col.id, currentOffset)
      currentOffset += col.width
      frozenCount++

      if (col.id === frozenColumnId) {
        foundFrozen = true
        break
      }
    }

    if (!foundFrozen) {
      return { frozenCount: 0, offsets: new Map<string, number>(), totalFrozenWidth: 0 }
    }

    return { frozenCount, offsets, totalFrozenWidth: currentOffset }
  }, [frozenColumnId, visibleColumns, selectionMode])

  // Calculate total table width
  const totalTableWidth = useMemo(() => {
    return visibleColumns.reduce((sum, col) => sum + col.width, 0)
  }, [visibleColumns])

  // Pinned columns width
  const pinnedWidth = useMemo(() => {
    return visibleColumns.filter(c => c.pinned).reduce((sum, col) => sum + col.width, 0)
  }, [visibleColumns])

  // Virtual rows for the table (density-aware)
  const rowVirtualizer = useVirtualizer({
    count: filteredAssets.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: useCallback((index: number) => {
      const asset = filteredAssets[index]
      return expandedRows.has(asset?.id) ? EXPANDED_ROW_HEIGHT : densityRowHeight
    }, [filteredAssets, expandedRows, densityRowHeight]),
    overscan: 5,
  })

  // Force virtualizer to recalculate when rows expand/collapse or density changes
  useEffect(() => {
    rowVirtualizer.measure()
  }, [expandedRows, rowVirtualizer, density])

  // Close column settings on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (columnSettingsRef.current && !columnSettingsRef.current.contains(e.target as Node)) {
        setShowColumnSettings(false)
      }
    }
    if (showColumnSettings) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showColumnSettings])

  // Close group by menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (groupByMenuRef.current && !groupByMenuRef.current.contains(e.target as Node)) {
        setShowGroupByMenu(false)
      }
    }
    if (showGroupByMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showGroupByMenu])

  // Close columns menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (columnsMenuRef.current && !columnsMenuRef.current.contains(e.target as Node)) {
        setShowColumnsMenu(false)
      }
    }
    if (showColumnsMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showColumnsMenu])

  // Close workflow popover on outside click
  useEffect(() => {
    if (!workflowPopover) return
    const handleClickOutside = () => setWorkflowPopover(null)
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [workflowPopover])

  // Close active table filter on outside click
  useEffect(() => {
    if (!activeTableFilter) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.table-filter-dropdown')) {
        setActiveTableFilter(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [activeTableFilter])

  // Toggle group collapse
  const toggleGroupCollapse = useCallback((groupKey: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupKey)) {
        next.delete(groupKey)
      } else {
        next.add(groupKey)
      }
      return next
    })
  }, [])

  // Toggle tree node expansion
  const toggleTreeNode = useCallback((nodeKey: string) => {
    setExpandedTreeNodes(prev => {
      const next = new Set(prev)
      if (next.has(nodeKey)) {
        next.delete(nodeKey)
      } else {
        next.add(nodeKey)
      }
      return next
    })
  }, [])

  // Grouped assets computation
  const groupedAssets = useMemo(() => {
    if (groupBy === 'none') return null

    const groups: Map<string, { assets: any[]; stats: { count: number; totalValue: number; avgChange: number } }> = new Map()

    filteredAssets.forEach(asset => {
      let groupKey: string

      switch (groupBy) {
        case 'sector':
          groupKey = asset.sector || 'Uncategorized'
          break
        case 'priority':
          groupKey = asset.priority || 'none'
          break
        case 'stage':
          groupKey = asset.process_stage || 'No Stage'
          break
        case 'theme':
          groupKey = asset.theme || 'Unassigned'
          break
        default:
          groupKey = 'All'
      }

      if (!groups.has(groupKey)) {
        groups.set(groupKey, { assets: [], stats: { count: 0, totalValue: 0, avgChange: 0 } })
      }

      const group = groups.get(groupKey)!
      group.assets.push(asset)
      group.stats.count++

      const quote = asset.symbol ? getQuote(asset.symbol) : null
      if (quote?.price) {
        group.stats.totalValue += quote.price
      } else if (asset.current_price) {
        group.stats.totalValue += Number(asset.current_price)
      }

      if (quote?.changePercent) {
        group.stats.avgChange = (group.stats.avgChange * (group.stats.count - 1) + quote.changePercent) / group.stats.count
      }
    })

    // Sort groups based on type
    const sortedGroups: [string, { assets: any[]; stats: { count: number; totalValue: number; avgChange: number } }][] = []

    if (groupBy === 'priority') {
      KANBAN_COLUMNS.forEach(priority => {
        if (groups.has(priority)) {
          sortedGroups.push([priority, groups.get(priority)!])
        }
      })
    } else if (groupBy === 'stage') {
      Object.keys(PROCESS_STAGES).forEach(stage => {
        if (groups.has(stage)) {
          sortedGroups.push([stage, groups.get(stage)!])
        }
      })
      // Add "No Stage" at the end if exists
      if (groups.has('No Stage')) {
        sortedGroups.push(['No Stage', groups.get('No Stage')!])
      }
    } else {
      // Sort alphabetically for other group types
      Array.from(groups.entries())
        .sort((a, b) => {
          if (a[0] === 'Uncategorized' || a[0] === 'Unassigned') return 1
          if (b[0] === 'Uncategorized' || b[0] === 'Unassigned') return -1
          return a[0].localeCompare(b[0])
        })
        .forEach(entry => sortedGroups.push(entry))
    }

    return sortedGroups
  }, [filteredAssets, groupBy, getQuote])

  // Tree data structure - supports multiple organization modes
  const treeData = useMemo(() => {
    if (viewMode !== 'tree') return null

    const root: { name: string; children: Map<string, any>; assets: any[] } = {
      name: 'All Assets',
      children: new Map(),
      assets: []
    }

    if (treeOrganization === 'theme') {
      // Theme → Sector → Assets
      filteredAssets.forEach(asset => {
        const theme = asset.theme || 'Unassigned'
        const sector = asset.sector || 'Other'

        if (!root.children.has(theme)) {
          root.children.set(theme, { name: theme, children: new Map(), assets: [] })
        }

        const themeNode = root.children.get(theme)!
        if (!themeNode.children.has(sector)) {
          themeNode.children.set(sector, { name: sector, children: new Map(), assets: [] })
        }

        themeNode.children.get(sector)!.assets.push(asset)
      })
    } else if (treeOrganization === 'list') {
      // List → Assets (assets can appear in multiple lists)
      filteredAssets.forEach(asset => {
        const lists = assetToListsMap.get(asset.id) || ['Not in any list']

        lists.forEach(listName => {
          if (!root.children.has(listName)) {
            root.children.set(listName, { name: listName, children: new Map(), assets: [] })
          }
          root.children.get(listName)!.assets.push(asset)
        })
      })
    } else if (treeOrganization === 'portfolio') {
      // Portfolio (uses theme as portfolio name) → Priority → Assets
      filteredAssets.forEach(asset => {
        const portfolio = asset.theme || 'Unassigned'
        const priority = asset.priority || 'none'
        const priorityLabel = PRIORITY_OPTIONS.find(p => p.value === priority)?.label || 'None'

        if (!root.children.has(portfolio)) {
          root.children.set(portfolio, { name: portfolio, children: new Map(), assets: [] })
        }

        const portfolioNode = root.children.get(portfolio)!
        if (!portfolioNode.children.has(priorityLabel)) {
          portfolioNode.children.set(priorityLabel, { name: priorityLabel, children: new Map(), assets: [] })
        }

        portfolioNode.children.get(priorityLabel)!.assets.push(asset)
      })
    } else if (treeOrganization === 'sector') {
      // Sector → Priority → Assets
      filteredAssets.forEach(asset => {
        const sector = asset.sector || 'Other'
        const priority = asset.priority || 'none'
        const priorityLabel = PRIORITY_OPTIONS.find(p => p.value === priority)?.label || 'None'

        if (!root.children.has(sector)) {
          root.children.set(sector, { name: sector, children: new Map(), assets: [] })
        }

        const sectorNode = root.children.get(sector)!
        if (!sectorNode.children.has(priorityLabel)) {
          sectorNode.children.set(priorityLabel, { name: priorityLabel, children: new Map(), assets: [] })
        }

        sectorNode.children.get(priorityLabel)!.assets.push(asset)
      })
    } else if (treeOrganization === 'priority') {
      // Priority → Sector → Assets
      // Use specific order for priorities
      const priorityOrder = ['high', 'medium', 'low', 'none']

      filteredAssets.forEach(asset => {
        const priority = asset.priority || 'none'
        const priorityLabel = PRIORITY_OPTIONS.find(p => p.value === priority)?.label || 'None'
        const sector = asset.sector || 'Other'

        if (!root.children.has(priorityLabel)) {
          root.children.set(priorityLabel, { name: priorityLabel, children: new Map(), assets: [], order: priorityOrder.indexOf(priority) })
        }

        const priorityNode = root.children.get(priorityLabel)!
        if (!priorityNode.children.has(sector)) {
          priorityNode.children.set(sector, { name: sector, children: new Map(), assets: [] })
        }

        priorityNode.children.get(sector)!.assets.push(asset)
      })

      // Sort root children by priority order
      const sortedChildren = new Map(
        Array.from(root.children.entries()).sort((a, b) => (a[1].order ?? 99) - (b[1].order ?? 99))
      )
      root.children = sortedChildren
    } else if (treeOrganization === 'workflow') {
      // Workflow → Assets (assets can appear in multiple workflows)
      filteredAssets.forEach(asset => {
        const workflowNames = assetToWorkflowsMap.get(asset.id) || ['No workflow']

        workflowNames.forEach(workflowName => {
          if (!root.children.has(workflowName)) {
            root.children.set(workflowName, { name: workflowName, children: new Map(), assets: [] })
          }
          root.children.get(workflowName)!.assets.push(asset)
        })
      })
    }

    return root
  }, [filteredAssets, viewMode, treeOrganization, assetToListsMap, assetToWorkflowsMap])

  // Kanban drag handlers
  const handleKanbanDragStart = useCallback((assetId: string) => {
    setDraggedAsset(assetId)
  }, [])

  const handleKanbanDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handleKanbanDrop = useCallback((newPriority: string) => {
    if (draggedAsset) {
      quickEditMutation.mutate({ assetId: draggedAsset, field: 'priority', value: newPriority })
      setDraggedAsset(null)
    }
  }, [draggedAsset, quickEditMutation])

  // Get group display info
  const getGroupInfo = useCallback((groupKey: string) => {
    switch (groupBy) {
      case 'priority':
        const priorityOpt = PRIORITY_OPTIONS.find(p => p.value === groupKey)
        return {
          label: priorityOpt?.label || groupKey,
          color: priorityOpt?.color || 'bg-gray-100 text-gray-700',
          icon: AlertCircle
        }
      case 'stage':
        const stageInfo = PROCESS_STAGES[groupKey as keyof typeof PROCESS_STAGES]
        return {
          label: stageInfo?.label || groupKey,
          color: stageInfo?.color || 'bg-gray-100 text-gray-700',
          icon: GitBranch
        }
      case 'sector':
        return {
          label: groupKey,
          color: 'bg-blue-50 text-blue-700',
          icon: Layers
        }
      case 'theme':
        return {
          label: groupKey,
          color: 'bg-purple-50 text-purple-700',
          icon: FolderTree
        }
      default:
        return {
          label: groupKey,
          color: 'bg-gray-100 text-gray-700',
          icon: Folder
        }
    }
  }, [groupBy])

  return (
    <TableProvider>
      <AssetsListContent
        density={density}
        densityRowHeight={densityRowHeight}
        densityConfig={DENSITY_CONFIG[density]}
        assets={assets}
        isLoading={assetsLoading}
        filteredAssets={filteredAssets}
        activeFilters={activeFilters}
        marketStatus={marketStatus}
        showLivePrices={showLivePrices}
        setShowLivePrices={setShowLivePrices}
        marketDataLoading={marketDataLoading}
        refreshAll={refreshAll}
        priceAlerts={priceAlerts}
        selectionMode={selectionMode}
        setSelectionMode={setSelectionMode}
        clearSelection={clearSelection}
        viewMode={viewMode}
        setViewMode={setViewMode}
        showColumnSettings={showColumnSettings}
        setShowColumnSettings={setShowColumnSettings}
        columns={columns}
        resetColumnWidths={resetColumnWidths}
        toggleColumnVisibility={toggleColumnVisibility}
        toggleColumnPin={toggleColumnPin}
        updateColumnLabel={updateColumnLabel}
        draggedColumn={draggedColumn}
        setDraggedColumn={setDraggedColumn}
        reorderColumns={reorderColumns}
        editingColumnLabel={editingColumnLabel}
        setEditingColumnLabel={setEditingColumnLabel}
        editingColumnValue={editingColumnValue}
        setEditingColumnValue={setEditingColumnValue}
        showAddColumnMenu={showAddColumnMenu}
        setShowAddColumnMenu={setShowAddColumnMenu}
        groupBy={groupBy}
        setGroupBy={setGroupBy}
        showGroupByMenu={showGroupByMenu}
        setShowGroupByMenu={setShowGroupByMenu}
        groupByMenuRef={groupByMenuRef}
        columnSettingsRef={columnSettingsRef}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        activeTableFilter={activeTableFilter}
        setActiveTableFilter={setActiveTableFilter}
        tableFilterRef={tableFilterRef}
        selectedPriorities={selectedPriorities}
        togglePriority={togglePriority}
        selectedSectors={selectedSectors}
        toggleSector={toggleSector}
        sectors={sectors}
        selectedStages={selectedStages}
        setSelectedStages={setSelectedStages}
        toggleStage={toggleStage}
        selectedAssetIds={selectedAssetIds}
        toggleAssetSelection={toggleAssetSelection}
        selectAllFiltered={selectAllFiltered}
        isAllSelected={isAllSelected}
        isSomeSelected={isSomeSelected}
        sortBy={sortBy}
        setSortBy={setSortBy}
        sortOrder={sortOrder}
        setSortOrder={setSortOrder}
        handleSort={handleSort}
        expandedRows={expandedRows}
        setExpandedRows={setExpandedRows}
        editingCell={editingCell}
        setEditingCell={setEditingCell}
        quickEditMutation={quickEditMutation}
        getQuote={getQuote}
        onAssetSelect={onAssetSelect}
        tableContainerRef={tableContainerRef}
        rowVirtualizer={rowVirtualizer}
        assetToListsMap={assetToListsMap}
        handleColumnResize={handleColumnResize}
        resizingColumn={resizingColumn}
        setResizingColumn={setResizingColumn}
        groupedAssets={groupedAssets}
        collapsedGroups={collapsedGroups}
        toggleGroupCollapse={toggleGroupCollapse}
        getGroupInfo={getGroupInfo}
        treeData={treeData}
        expandedTreeNodes={expandedTreeNodes}
        toggleTreeNode={toggleTreeNode}
        treeOrganization={treeOrganization}
        setTreeOrganization={setTreeOrganization}
        handleKanbanDragStart={handleKanbanDragStart}
        handleKanbanDragOver={handleKanbanDragOver}
        handleKanbanDrop={handleKanbanDrop}
        draggedAsset={draggedAsset}
        setDraggedAsset={setDraggedAsset}
        frozenColumnId={frozenColumnId}
        setFrozenColumnId={setFrozenColumnId}
        frozenColumnInfo={frozenColumnInfo}
        handleColumnContextMenu={handleColumnContextMenu}
        handleFreezeColumn={handleFreezeColumn}
        handleUnfreezeColumns={handleUnfreezeColumns}
        columnContextMenu={columnContextMenu}
        setColumnContextMenu={setColumnContextMenu}
        showColumnsMenu={showColumnsMenu}
        setShowColumnsMenu={setShowColumnsMenu}
        workflowPopover={workflowPopover}
        setWorkflowPopover={setWorkflowPopover}
        columnsMenuRef={columnsMenuRef}
        dropTargetColumn={dropTargetColumn}
        setDropTargetColumn={setDropTargetColumn}
        exportToCSV={exportToCSV}
        showBulkPriorityModal={showBulkPriorityModal}
        setShowBulkPriorityModal={setShowBulkPriorityModal}
        showBulkStageModal={showBulkStageModal}
        setShowBulkStageModal={setShowBulkStageModal}
        showBulkListModal={showBulkListModal}
        setShowBulkListModal={setShowBulkListModal}
        showBulkTagModal={showBulkTagModal}
        setShowBulkTagModal={setShowBulkTagModal}
        bulkActionLoading={bulkActionLoading}
        setBulkActionLoading={setBulkActionLoading}
        bulkUpdatePriorityMutation={bulkUpdatePriorityMutation}
        bulkUpdateStageMutation={bulkUpdateStageMutation}
        bulkAddToListMutation={bulkAddToListMutation}
        bulkAddTagMutation={bulkAssignTagMutation}
        lists={assetLists}
        tags={assetTags}
        createTagMutation={createTagMutation}
        newTagName={newTagName}
        setNewTagName={setNewTagName}
        newTagColor={newTagColor}
        setNewTagColor={setNewTagColor}
        visibleColumns={visibleColumns}
        totalTableWidth={totalTableWidth}
        assetWorkflowMap={assetWorkflowMap}
        assetCoverageMap={assetCoverageMap}
        editingNoteId={editingNoteId}
        editingNoteValue={editingNoteValue}
        setEditingNoteValue={setEditingNoteValue}
        startEditingNote={startEditingNote}
        cancelNoteEdit={cancelNoteEdit}
        saveNote={saveNote}
        saveNoteMutation={saveNoteMutation}
        kanbanOrganization={kanbanOrganization}
        setKanbanOrganization={setKanbanOrganization}
        kanbanColumnSearch={kanbanColumnSearch}
        setKanbanColumnSearch={setKanbanColumnSearch}
        hiddenKanbanColumns={hiddenKanbanColumns}
        setHiddenKanbanColumns={setHiddenKanbanColumns}
        fullscreenKanbanColumn={fullscreenKanbanColumn}
        setFullscreenKanbanColumn={setFullscreenKanbanColumn}
        toggleRowExpansion={toggleRowExpansion}
        handleAssetClick={handleAssetClick}
        hasAlert={hasAlert}
        pinnedColumnsWidth={pinnedWidth}
        showSaveFilterModal={showSaveFilterModal}
        setShowSaveFilterModal={setShowSaveFilterModal}
        newFilterName={newFilterName}
        setNewFilterName={setNewFilterName}
        savedFilters={savedFilters}
        saveFilterMutation={saveFilterMutation}
        handleSaveFilter={handleSaveFilter}
        loadSavedFilter={loadSavedFilter}
        refetchTags={refetchTags}
        removeFilter={removeFilter}
        clearAllFilters={clearAllFilters}
      />
    </TableProvider>
  )
}

// Inner content component that uses TableContext
function AssetsListContent(props: any) {
  const {
    density,
    densityRowHeight,
    densityConfig,
    assets,
    isLoading,
    filteredAssets,
    activeFilters,
    marketStatus,
    showLivePrices,
    setShowLivePrices,
    marketDataLoading,
    refreshAll,
    priceAlerts,
    selectionMode,
    setSelectionMode,
    clearSelection,
    viewMode,
    setViewMode,
    showColumnSettings,
    setShowColumnSettings,
    columns,
    resetColumnWidths,
    toggleColumnVisibility,
    toggleColumnPin,
    updateColumnLabel,
    draggedColumn,
    setDraggedColumn,
    reorderColumns,
    editingColumnLabel,
    setEditingColumnLabel,
    editingColumnValue,
    setEditingColumnValue,
    showAddColumnMenu,
    setShowAddColumnMenu,
    groupBy,
    setGroupBy,
    showGroupByMenu,
    setShowGroupByMenu,
    groupByMenuRef,
    columnSettingsRef,
    searchQuery,
    setSearchQuery,
    activeTableFilter,
    setActiveTableFilter,
    tableFilterRef,
    selectedPriorities,
    togglePriority,
    selectedSectors,
    toggleSector,
    sectors,
    selectedStages,
    setSelectedStages,
    toggleStage,
    selectedAssetIds,
    toggleAssetSelection,
    selectAllFiltered,
    isAllSelected,
    isSomeSelected,
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,
    handleSort,
    expandedRows,
    setExpandedRows,
    editingCell,
    setEditingCell,
    quickEditMutation,
    getQuote,
    onAssetSelect,
    tableContainerRef,
    rowVirtualizer,
    assetToListsMap,
    handleColumnResize,
    resizingColumn,
    setResizingColumn,
    groupedAssets,
    collapsedGroups,
    toggleGroupCollapse,
    getGroupInfo,
    treeData,
    expandedTreeNodes,
    toggleTreeNode,
    treeOrganization,
    setTreeOrganization,
    handleKanbanDragStart,
    handleKanbanDragOver,
    handleKanbanDrop,
    draggedAsset,
    setDraggedAsset,
    frozenColumnId,
    setFrozenColumnId,
    frozenColumnInfo,
    handleColumnContextMenu,
    handleFreezeColumn,
    handleUnfreezeColumns,
    columnContextMenu,
    setColumnContextMenu,
    showColumnsMenu,
    setShowColumnsMenu,
    workflowPopover,
    setWorkflowPopover,
    columnsMenuRef,
    dropTargetColumn,
    setDropTargetColumn,
    exportToCSV,
    showBulkPriorityModal,
    setShowBulkPriorityModal,
    showBulkStageModal,
    setShowBulkStageModal,
    showBulkListModal,
    setShowBulkListModal,
    showBulkTagModal,
    setShowBulkTagModal,
    bulkActionLoading,
    setBulkActionLoading,
    bulkUpdatePriorityMutation,
    bulkUpdateStageMutation,
    bulkAddToListMutation,
    bulkAddTagMutation,
    lists,
    tags,
    createTagMutation,
    newTagName,
    setNewTagName,
    newTagColor,
    setNewTagColor,
    visibleColumns,
    totalTableWidth,
    assetWorkflowMap,
    assetCoverageMap,
    editingNoteId,
    editingNoteValue,
    setEditingNoteValue,
    startEditingNote,
    cancelNoteEdit,
    saveNote,
    saveNoteMutation,
    kanbanOrganization,
    setKanbanOrganization,
    kanbanColumnSearch,
    setKanbanColumnSearch,
    hiddenKanbanColumns,
    setHiddenKanbanColumns,
    fullscreenKanbanColumn,
    setFullscreenKanbanColumn,
    toggleRowExpansion,
    handleAssetClick,
    hasAlert,
    pinnedColumnsWidth,
    showSaveFilterModal,
    setShowSaveFilterModal,
    newFilterName,
    setNewFilterName,
    savedFilters,
    saveFilterMutation,
    handleSaveFilter,
    loadSavedFilter,
    refetchTags,
    removeFilter,
    clearAllFilters
  } = props

  // Access TableContext for command palette and keyboard shortcuts
  const {
    state: tableState,
    closeCommandPalette,
    toggleKeyboardHelp,
    setDensity
  } = useTableContext()

  return (
    <div className="space-y-4">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">All Assets</h1>
          <p className="text-gray-600">
            {filteredAssets.length} of {assets?.length || 0} assets
            {activeFilters.length > 0 && ` (filtered)`}
          </p>
        </div>

        {/* View Mode Toggle & Select Button */}
        <div className="flex items-center space-x-3">
          {/* Market Status Indicator */}
          <div className={clsx(
            'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
            marketStatus.isOpen
              ? 'bg-green-100 text-green-700'
              : marketStatus.status === 'pre-market'
                ? 'bg-yellow-100 text-yellow-700'
                : marketStatus.status === 'after-hours'
                  ? 'bg-orange-100 text-orange-700'
                  : 'bg-gray-100 text-gray-600'
          )}>
            <div className={clsx(
              'w-1.5 h-1.5 rounded-full',
              marketStatus.isOpen ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
            )} />
            {marketStatus.isOpen ? 'Market Open' : marketStatus.status === 'pre-market' ? 'Pre-Market' : marketStatus.status === 'after-hours' ? 'After Hours' : 'Closed'}
          </div>

          {/* Live Prices Toggle */}
          <button
            onClick={() => setShowLivePrices(!showLivePrices)}
            className={clsx(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-colors text-sm',
              showLivePrices
                ? 'bg-green-50 border-green-200 text-green-700'
                : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
            )}
            title={showLivePrices ? 'Live prices enabled' : 'Live prices disabled'}
          >
            <Activity className={clsx('w-4 h-4', showLivePrices && 'animate-pulse')} />
            {marketDataLoading && <Loader2 className="w-3 h-3 animate-spin" />}
          </button>

          {/* Refresh Button */}
          {showLivePrices && (
            <button
              onClick={() => refreshAll()}
              className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700 transition-colors"
              title="Refresh prices"
            >
              <RefreshCw className={clsx('w-4 h-4', marketDataLoading && 'animate-spin')} />
            </button>
          )}

          {/* Price Alerts Indicator */}
          {priceAlerts.length > 0 && (
            <div className="flex items-center gap-1 px-2 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">
              <Bell className="w-3 h-3" />
              {priceAlerts.length}
            </div>
          )}

          {/* Select Mode Toggle */}
          <button
            onClick={() => {
              if (selectionMode) {
                clearSelection()
              } else {
                setSelectionMode(true)
              }
            }}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors text-sm font-medium',
              selectionMode
                ? 'bg-blue-50 border-blue-200 text-blue-700'
                : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-700'
            )}
          >
            <CheckSquare className="w-4 h-4" />
            {selectionMode ? 'Cancel' : 'Select'}
          </button>

          {/* Column Settings - only show in table view */}
          {viewMode === 'table' && (
            <div className="relative" ref={columnSettingsRef}>
              <button
                onClick={() => setShowColumnSettings(!showColumnSettings)}
                className={clsx(
                  'p-1.5 rounded-lg border transition-colors',
                  showColumnSettings
                    ? 'bg-blue-50 border-blue-200 text-blue-600'
                    : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700'
                )}
                title="Column settings"
              >
                <Settings2 className="w-4 h-4" />
              </button>

              {/* Column Settings Dropdown */}
              {showColumnSettings && (
                <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-lg shadow-xl border border-gray-200 z-50">
                  <div className="p-3 border-b border-gray-100">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium text-gray-900 text-sm">Table Columns</h4>
                      <button
                        onClick={resetColumnWidths}
                        className="text-xs text-blue-600 hover:text-blue-700"
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                  <div className="p-2 max-h-80 overflow-y-auto">
                    {columns.filter(col => col.id !== 'select').map((col) => (
                      <div
                        key={col.id}
                        className="flex items-center justify-between py-2 px-2 hover:bg-gray-50 rounded-lg group"
                        draggable
                        onDragStart={() => setDraggedColumn(col.id)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => draggedColumn && reorderColumns(draggedColumn, col.id)}
                      >
                        <div className="flex items-center gap-2">
                          <GripVertical className="w-4 h-4 text-gray-300 cursor-grab" />
                          <button
                            onClick={() => toggleColumnVisibility(col.id)}
                            className="p-1 rounded hover:bg-gray-100"
                          >
                            {col.visible ? (
                              <Eye className="w-4 h-4 text-gray-600" />
                            ) : (
                              <EyeOff className="w-4 h-4 text-gray-400" />
                            )}
                          </button>
                          <span className={clsx(
                            'text-sm',
                            col.visible ? 'text-gray-900' : 'text-gray-400'
                          )}>
                            {col.label}
                          </span>
                        </div>
                        <button
                          onClick={() => toggleColumnPin(col.id)}
                          className={clsx(
                            'p-1 rounded hover:bg-gray-100',
                            col.pinned ? 'text-blue-600' : 'text-gray-400'
                          )}
                          title={col.pinned ? 'Unpin column' : 'Pin column'}
                        >
                          {col.pinned ? <Pin className="w-4 h-4" /> : <PinOff className="w-4 h-4" />}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Group By Dropdown - hide for kanban view */}
          {viewMode !== 'kanban' && (
            <div className="relative" ref={groupByMenuRef}>
              <button
                onClick={() => setShowGroupByMenu(!showGroupByMenu)}
                className={clsx(
                  'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-colors text-sm',
                  groupBy !== 'none'
                    ? 'bg-purple-50 border-purple-200 text-purple-700'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                )}
              >
                <Layers className="w-4 h-4" />
                <span className="hidden sm:inline">
                  {groupBy === 'none' ? 'Group' : GROUP_BY_OPTIONS.find(o => o.value === groupBy)?.label}
                </span>
                <ChevronDown className="w-3 h-3" />
              </button>

              {showGroupByMenu && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-lg shadow-xl border border-gray-200 z-50 py-1">
                  {GROUP_BY_OPTIONS.map(option => (
                    <button
                      key={option.value}
                      onClick={() => {
                        setGroupBy(option.value)
                        setShowGroupByMenu(false)
                        setCollapsedGroups(new Set())
                      }}
                      className={clsx(
                        'w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-50',
                        groupBy === option.value && 'bg-purple-50 text-purple-700'
                      )}
                    >
                      <option.icon className="w-4 h-4" />
                      {option.label}
                      {groupBy === option.value && <Check className="w-4 h-4 ml-auto" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center border border-gray-200 rounded-lg p-1 bg-gray-50">
            <button
              onClick={() => setViewMode('table')}
              className={clsx(
                'p-1.5 rounded transition-colors',
                viewMode === 'table' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'
              )}
              title="Table view"
            >
              <Table2 className="w-4 h-4" />
            </button>
            <div className="w-px h-4 bg-gray-300 mx-0.5" />
            <button
              onClick={() => setViewMode('kanban')}
              className={clsx(
                'p-1.5 rounded transition-colors',
                viewMode === 'kanban' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'
              )}
              title="Kanban board"
            >
              <Columns3 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('tree')}
              className={clsx(
                'p-1.5 rounded transition-colors',
                viewMode === 'tree' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'
              )}
              title="Tree view"
            >
              <FolderTree className="w-4 h-4" />
            </button>
          </div>

          {/* Density Toggle - controls row height/density */}
          {viewMode === 'table' && <DensityToggle />}
        </div>
      </div>

      {/* Search Bar + Filter Toggle */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search by symbol, company name, or sector..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

      </div>

      {/* Active Filter Pills */}
      {activeFilters.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-gray-500">Active filters:</span>
          {activeFilters.map((filter, idx) => (
            <span
              key={`${filter.type}-${filter.value}-${idx}`}
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-700 text-sm rounded-full"
            >
              {filter.label}
              <button
                onClick={() => removeFilter(filter.type, filter.value)}
                className="hover:text-blue-900"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <button
            onClick={clearAllFilters}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Assets Display */}
      {isLoading ? (
        <Card padding="none">
          <div className="p-6">
            <ListSkeleton count={5} />
          </div>
        </Card>
      ) : filteredAssets.length > 0 ? (
        <>
          {/* Enhanced Table View with Virtual Scrolling */}
          {viewMode === 'table' && groupBy === 'none' && (
            <Card padding="none" className="overflow-hidden">
              {/* Single scroll container for both header and body */}
              <div
                ref={tableContainerRef}
                className="overflow-auto"
                style={{ maxHeight: Math.min(filteredAssets.length * densityRowHeight, 600) + 48 }}
              >
                {/* Sticky Table Header */}
                <div
                  className="sticky top-0 z-20 bg-gray-50 border-b border-gray-200"
                  style={{ minWidth: totalTableWidth }}
                >
                  <div
                    className="flex items-center text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                  {visibleColumns.map((col, colIndex) => {
                    // Skip select column if not in selection mode
                    if (col.id === 'select' && !selectionMode) return null

                    const isPinned = col.pinned
                    const leftOffset = isPinned
                      ? visibleColumns.slice(0, colIndex).filter(c => c.pinned && (c.id !== 'select' || selectionMode)).reduce((sum, c) => sum + c.width, 0)
                      : 0

                    return (
                      <div
                        key={col.id}
                        draggable={col.id !== 'select'}
                        onDragStart={(e) => {
                          if (col.id === 'select') return
                          e.dataTransfer.effectAllowed = 'move'
                          setDraggedColumn(col.id)
                        }}
                        onDragOver={(e) => {
                          e.preventDefault()
                          e.dataTransfer.dropEffect = 'move'
                        }}
                        onDrop={(e) => {
                          e.preventDefault()
                          if (draggedColumn && draggedColumn !== col.id && col.id !== 'select') {
                            reorderColumns(draggedColumn, col.id)
                          }
                          setDraggedColumn(null)
                        }}
                        onDragEnd={() => setDraggedColumn(null)}
                        className={clsx(
                          'relative flex items-center px-3 py-3 select-none group',
                          isPinned ? 'sticky bg-gray-50 z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]' : 'overflow-visible',
                          col.id !== 'select' && 'cursor-grab active:cursor-grabbing',
                          draggedColumn === col.id && 'opacity-50',
                          draggedColumn && draggedColumn !== col.id && col.id !== 'select' && 'hover:bg-blue-50'
                        )}
                        style={{
                          width: col.width,
                          minWidth: col.minWidth,
                          left: isPinned ? leftOffset : undefined
                        }}
                      >
                        {/* Column Content */}
                        {col.id === 'select' ? (
                          <button
                            onClick={() => isAllSelected ? clearSelection() : selectAllFiltered()}
                            className="p-0.5 rounded hover:bg-gray-200 transition-colors"
                            title={isAllSelected ? 'Deselect all' : 'Select all'}
                          >
                            {isAllSelected ? (
                              <CheckSquare className="h-4 w-4 text-blue-600" />
                            ) : isSomeSelected ? (
                              <div className="relative">
                                <Square className="h-4 w-4 text-gray-400" />
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <div className="w-2 h-0.5 bg-blue-600 rounded" />
                                </div>
                              </div>
                            ) : (
                              <Square className="h-4 w-4 text-gray-400" />
                            )}
                          </button>
                        ) : (
                          <div
                            className="flex items-center w-full gap-1 min-w-0"
                            onClick={(e) => {
                              // Only sort if clicking on whitespace, not on the label
                              if (col.sortable && editingColumnLabel !== col.id && e.target === e.currentTarget) {
                                handleSort(
                                  col.id === 'asset' ? 'symbol' :
                                  col.id === 'workflows' ? 'workflow_count' :
                                  col.id === 'price' ? 'current_price' :
                                  col.id === 'updated' ? 'updated_at' : col.id
                                )
                              }
                            }}
                          >
                            {/* Column Label - click to switch column */}
                            <div className="relative flex-1 min-w-0">
                              <span
                                className="block cursor-default truncate hover:text-gray-700"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setEditingColumnLabel(editingColumnLabel === col.id ? null : col.id)
                                  setEditingColumnValue('')
                                }}
                              >
                                {col.label}
                              </span>

                              {/* Column Switcher Dropdown */}
                              {editingColumnLabel === col.id && (
                                <div
                                  className="absolute top-full left-0 mt-1 w-56 bg-white rounded-lg shadow-xl border border-gray-200 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <div className="p-2 border-b border-gray-100">
                                    <input
                                      type="text"
                                      placeholder="Search columns..."
                                      value={editingColumnValue}
                                      onChange={(e) => setEditingColumnValue(e.target.value)}
                                      autoFocus
                                      className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                                    />
                                  </div>
                                  <div className="max-h-64 overflow-y-auto p-1">
                                    {columns
                                      .filter(c => c.id !== 'select')
                                      .filter(c => c.label.toLowerCase().includes(editingColumnValue.toLowerCase()))
                                      .map(targetCol => (
                                        <button
                                          key={targetCol.id}
                                          onClick={() => {
                                            if (targetCol.id !== col.id) {
                                              // Hide current column
                                              toggleColumnVisibility(col.id)
                                              // Show target column if hidden
                                              if (!targetCol.visible) {
                                                toggleColumnVisibility(targetCol.id)
                                              }
                                            }
                                            setEditingColumnLabel(null)
                                          }}
                                          className={clsx(
                                            "w-full px-3 py-2 text-left text-sm rounded-md flex items-center gap-2 transition-colors",
                                            targetCol.id === col.id
                                              ? "bg-blue-50 text-blue-700"
                                              : targetCol.visible
                                              ? "hover:bg-gray-100 text-gray-700"
                                              : "hover:bg-gray-100 text-gray-400"
                                          )}
                                        >
                                          {targetCol.visible ? (
                                            <Eye className="w-3 h-3 flex-shrink-0" />
                                          ) : (
                                            <EyeOff className="w-3 h-3 flex-shrink-0" />
                                          )}
                                          <span className="truncate">{targetCol.label}</span>
                                          {targetCol.id === col.id && (
                                            <Check className="w-3 h-3 ml-auto text-blue-600 flex-shrink-0" />
                                          )}
                                        </button>
                                      ))}
                                  </div>
                                  <div className="p-2 border-t border-gray-100 bg-gray-50">
                                    <button
                                      onClick={() => {
                                        toggleColumnVisibility(col.id)
                                        setEditingColumnLabel(null)
                                      }}
                                      className="w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50 rounded-md flex items-center gap-2"
                                    >
                                      <EyeOff className="w-3 h-3" />
                                      Hide this column
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Sort indicator - clickable */}
                            {col.sortable && editingColumnLabel !== col.id && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleSort(
                                    col.id === 'asset' ? 'symbol' :
                                    col.id === 'workflows' ? 'workflow_count' :
                                    col.id === 'price' ? 'current_price' :
                                    col.id === 'updated' ? 'updated_at' :
                                    col.id === 'coverage' ? 'coverage_analyst' : col.id
                                  )
                                }}
                                className="p-0.5 rounded hover:bg-gray-200 transition-colors cursor-default"
                                title={`Sort by ${col.label}`}
                              >
                                {sortBy === (col.id === 'asset' ? 'symbol' : col.id === 'workflows' ? 'workflow_count' : col.id === 'price' ? 'current_price' : col.id === 'updated' ? 'updated_at' : col.id === 'coverage' ? 'coverage_analyst' : col.id) ? (
                                  sortOrder === 'asc' ? <ChevronUp className="h-3 w-3 text-blue-600" /> : <ChevronDown className="h-3 w-3 text-blue-600" />
                                ) : (
                                  <ArrowUpDown className="h-3 w-3 opacity-0 group-hover:opacity-50 transition-opacity" />
                                )}
                              </button>
                            )}

                            {/* Filter button for filterable columns */}
                            {['priority', 'sector', 'coverage', 'workflows'].includes(col.id) && (
                              <div className="relative table-filter-dropdown">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setActiveTableFilter(activeTableFilter === col.id ? null : col.id)
                                  }}
                                  className={clsx(
                                    "p-1 rounded transition-all",
                                    (col.id === 'priority' && selectedPriorities.length > 0) ||
                                    (col.id === 'sector' && selectedSectors.length > 0) ||
                                    (col.id === 'coverage' && selectedStages.length > 0)
                                      ? "text-blue-600 bg-blue-100 hover:bg-blue-200"
                                      : "text-gray-400 hover:text-gray-600 hover:bg-gray-200 opacity-0 group-hover:opacity-100"
                                  )}
                                  title={`Filter by ${col.label}`}
                                >
                                  <Filter className="w-3 h-3" />
                                </button>

                                {/* Filter Dropdown */}
                                {activeTableFilter === col.id && (
                                  <div
                                    className="absolute top-full right-0 mt-1 w-48 bg-white rounded-lg shadow-xl border border-gray-200 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                                      <p className="text-xs font-semibold text-gray-700">Filter by {col.label}</p>
                                      {((col.id === 'priority' && selectedPriorities.length > 0) ||
                                        (col.id === 'sector' && selectedSectors.length > 0) ||
                                        (col.id === 'coverage' && selectedStages.length > 0)) && (
                                        <button
                                          onClick={() => {
                                            if (col.id === 'priority') setSelectedPriorities([])
                                            if (col.id === 'sector') setSelectedSectors([])
                                            if (col.id === 'coverage') setSelectedStages([])
                                          }}
                                          className="text-xs text-blue-600 hover:text-blue-800"
                                        >
                                          Clear
                                        </button>
                                      )}
                                    </div>
                                    <div className="p-2 max-h-64 overflow-y-auto">
                                      {col.id === 'priority' && PRIORITY_OPTIONS.map(opt => (
                                        <button
                                          key={opt.value}
                                          onClick={() => togglePriority(opt.value)}
                                          className={clsx(
                                            "w-full px-3 py-2 text-left text-sm rounded-md transition-colors flex items-center gap-2",
                                            selectedPriorities.includes(opt.value) ? "bg-blue-50 text-blue-700" : "hover:bg-gray-100 text-gray-700"
                                          )}
                                        >
                                          <div className={clsx(
                                            "w-4 h-4 rounded border-2 flex items-center justify-center transition-colors",
                                            selectedPriorities.includes(opt.value) ? "border-blue-600 bg-blue-600" : "border-gray-300"
                                          )}>
                                            {selectedPriorities.includes(opt.value) && <Check className="w-2.5 h-2.5 text-white" />}
                                          </div>
                                          <span className={clsx("w-2 h-2 rounded-full", opt.color.split(' ')[0])} />
                                          {opt.label}
                                        </button>
                                      ))}
                                      {col.id === 'sector' && sectors.map(sector => (
                                        <button
                                          key={sector}
                                          onClick={() => toggleSector(sector)}
                                          className={clsx(
                                            "w-full px-3 py-2 text-left text-sm rounded-md transition-colors flex items-center gap-2",
                                            selectedSectors.includes(sector) ? "bg-blue-50 text-blue-700" : "hover:bg-gray-100 text-gray-700"
                                          )}
                                        >
                                          <div className={clsx(
                                            "w-4 h-4 rounded border-2 flex items-center justify-center transition-colors",
                                            selectedSectors.includes(sector) ? "border-blue-600 bg-blue-600" : "border-gray-300"
                                          )}>
                                            {selectedSectors.includes(sector) && <Check className="w-2.5 h-2.5 text-white" />}
                                          </div>
                                          {sector}
                                        </button>
                                      ))}
                                      {col.id === 'coverage' && Object.entries(PROCESS_STAGES).map(([key, stage]) => (
                                        <button
                                          key={key}
                                          onClick={() => toggleStage(key)}
                                          className={clsx(
                                            "w-full px-3 py-2 text-left text-sm rounded-md transition-colors flex items-center gap-2",
                                            selectedStages.includes(key) ? "bg-blue-50 text-blue-700" : "hover:bg-gray-100 text-gray-700"
                                          )}
                                        >
                                          <div className={clsx(
                                            "w-4 h-4 rounded border-2 flex items-center justify-center transition-colors",
                                            selectedStages.includes(key) ? "border-blue-600 bg-blue-600" : "border-gray-300"
                                          )}>
                                            {selectedStages.includes(key) && <Check className="w-2.5 h-2.5 text-white" />}
                                          </div>
                                          <span className={clsx("px-1.5 py-0.5 text-xs rounded", stage.color)}>{stage.label}</span>
                                        </button>
                                      ))}
                                      {col.id === 'workflows' && (
                                        <div className="px-2 py-3 text-xs text-gray-500 text-center">
                                          Workflow filters coming soon
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Resize Handle - always visible divider line */}
                        {col.id !== 'select' && (
                          <div
                            className="absolute right-0 top-0 bottom-0 w-px bg-gray-300"
                          />
                        )}
                        {/* Resize Handle - draggable area */}
                        {col.id !== 'select' && (
                          <div
                            className="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize z-30 group/resize"
                            onMouseDown={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              setResizingColumn(col.id)
                              const startX = e.clientX
                              const startWidth = col.width
                              const columnId = col.id

                              const onMouseMove = (moveEvent: MouseEvent) => {
                                moveEvent.preventDefault()
                                const newWidth = startWidth + (moveEvent.clientX - startX)
                                handleColumnResize(columnId, newWidth)
                              }

                              const onMouseUp = () => {
                                setResizingColumn(null)
                                document.removeEventListener('mousemove', onMouseMove)
                                document.removeEventListener('mouseup', onMouseUp)
                                document.body.style.cursor = ''
                                document.body.style.userSelect = ''
                              }

                              document.body.style.cursor = 'col-resize'
                              document.body.style.userSelect = 'none'
                              document.addEventListener('mousemove', onMouseMove)
                              document.addEventListener('mouseup', onMouseUp)
                            }}
                          >
                            {/* Hover indicator */}
                            <div className={clsx(
                              "absolute inset-y-0 right-0 w-1 transition-colors",
                              resizingColumn === col.id
                                ? "bg-blue-500"
                                : "bg-transparent group-hover/resize:bg-blue-400"
                            )} />
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {/* Add Column Button */}
                  <div className="relative flex items-center justify-center px-2 py-3">
                    <button
                      onClick={() => setShowAddColumnMenu(!showAddColumnMenu)}
                      className="p-1 rounded hover:bg-gray-200 transition-colors text-gray-400 hover:text-gray-600"
                      title="Add column"
                    >
                      <Plus className="h-4 w-4" />
                    </button>

                    {/* Add Column Dropdown */}
                    {showAddColumnMenu && (
                      <div
                        className="absolute top-full right-0 mt-1 w-48 bg-white rounded-lg shadow-xl border border-gray-200 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
                          <p className="text-xs font-semibold text-gray-700">Show Column</p>
                        </div>
                        <div className="p-2 max-h-64 overflow-y-auto">
                          {columns.filter(c => c.id !== 'select' && !c.visible).map(col => (
                            <button
                              key={col.id}
                              onClick={() => {
                                toggleColumnVisibility(col.id)
                                setShowAddColumnMenu(false)
                              }}
                              className="w-full px-3 py-2 text-left text-sm rounded-md hover:bg-gray-100 text-gray-700 flex items-center gap-2"
                            >
                              <Plus className="w-3 h-3 text-gray-400" />
                              {col.label}
                            </button>
                          ))}
                          {columns.filter(c => c.id !== 'select' && !c.visible).length === 0 && (
                            <p className="px-3 py-2 text-xs text-gray-500 italic">All columns visible</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Virtual Scrolling Body */}
              <div
                style={{
                  height: `${rowVirtualizer.getTotalSize()}px`,
                  minWidth: totalTableWidth,
                  position: 'relative',
                }}
              >
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const asset = filteredAssets[virtualRow.index]
                    const isExpanded = expandedRows.has(asset.id)
                    const isEditing = editingCell?.assetId === asset.id

                    return (
                      <div
                        key={asset.id}
                        className={clsx(
                          "absolute top-0 left-0 w-full border-b border-gray-100 hover:bg-gray-50 transition-colors",
                          selectedAssetIds.has(asset.id) && "bg-blue-50 hover:bg-blue-100"
                        )}
                        style={{
                          height: virtualRow.size,
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        {/* Main Row - density-aware height */}
                        <div
                          className="flex items-center cursor-pointer"
                          style={{ minWidth: totalTableWidth, height: `${densityRowHeight}px` }}
                          onClick={() => !isEditing && toggleRowExpansion(asset.id)}
                          onDoubleClick={() => !isEditing && handleAssetClick(asset)}
                        >
                          {visibleColumns.map((col, colIndex) => {
                            if (col.id === 'select' && !selectionMode) return null

                            const isPinned = col.pinned
                            const leftOffset = isPinned
                              ? visibleColumns.slice(0, colIndex).filter(c => c.pinned && (c.id !== 'select' || selectionMode)).reduce((sum, c) => sum + c.width, 0)
                              : 0

                            return (
                              <div
                                key={col.id}
                                className={clsx(
                                  'h-full flex items-center',
                                  densityConfig.padding,
                                  densityConfig.fontSize,
                                  isPinned && 'sticky z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.05)]',
                                  isPinned && (selectedAssetIds.has(asset.id) ? 'bg-blue-50' : 'bg-white')
                                )}
                                style={{
                                  width: col.width,
                                  minWidth: col.minWidth,
                                  left: isPinned ? leftOffset : undefined
                                }}
                              >
                                {/* Render cell content based on column */}
                                {col.id === 'select' && (
                                  <button
                                    onClick={(e) => toggleAssetSelection(asset.id, e)}
                                    className="p-0.5 rounded hover:bg-gray-200 transition-colors"
                                  >
                                    {selectedAssetIds.has(asset.id) ? (
                                      <CheckSquare className="h-4 w-4 text-blue-600" />
                                    ) : (
                                      <Square className="h-4 w-4 text-gray-400" />
                                    )}
                                  </button>
                                )}

                                {col.id === 'asset' && (
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          toggleRowExpansion(asset.id)
                                        }}
                                        className="p-0.5 rounded hover:bg-gray-200 transition-colors"
                                      >
                                        <ChevronRight className={clsx(
                                          'h-4 w-4 text-gray-400 transition-transform',
                                          isExpanded && 'rotate-90'
                                        )} />
                                      </button>
                                      <div className="min-w-0">
                                        {density === 'comfortable' ? (
                                          <>
                                            <div className="flex items-center gap-1.5">
                                              <p className="text-sm font-semibold text-gray-900 truncate">
                                                {asset.symbol}
                                              </p>
                                              {asset.price_targets?.length > 0 && (
                                                <Target className="h-3 w-3 text-gray-400 flex-shrink-0" />
                                              )}
                                              {hasAlert(asset.id) && (
                                                <Bell className="h-3 w-3 text-amber-500 animate-pulse flex-shrink-0" />
                                              )}
                                            </div>
                                            <p className="text-sm text-gray-600 truncate">{asset.company_name}</p>
                                          </>
                                        ) : (
                                          <div className="flex items-center gap-1.5">
                                            <p className={clsx(
                                              'font-semibold text-gray-900',
                                              density === 'ultra' ? 'text-xs' : 'text-sm'
                                            )}>
                                              {asset.symbol}
                                            </p>
                                            <span className={clsx(
                                              'text-gray-400',
                                              density === 'ultra' ? 'text-xs' : 'text-sm'
                                            )}>·</span>
                                            <p className={clsx(
                                              'text-gray-600 truncate',
                                              density === 'ultra' ? 'text-xs' : 'text-sm'
                                            )}>
                                              {asset.company_name}
                                            </p>
                                            {asset.price_targets?.length > 0 && (
                                              <Target className="h-3 w-3 text-gray-400 flex-shrink-0" />
                                            )}
                                            {hasAlert(asset.id) && (
                                              <Bell className="h-3 w-3 text-amber-500 animate-pulse flex-shrink-0" />
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {col.id === 'workflows' && (() => {
                                  const workflows = assetWorkflowMap.get(asset.id) || []
                                  return workflows.length > 0 ? (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        const rect = e.currentTarget.getBoundingClientRect()
                                        setWorkflowPopover({ assetId: asset.id, x: rect.left, y: rect.bottom + 4 })
                                      }}
                                      className="px-2 py-0.5 text-xs font-medium rounded-full bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-colors"
                                    >
                                      {workflows.length} workflow{workflows.length !== 1 ? 's' : ''}
                                    </button>
                                  ) : (
                                    <span className="text-sm text-gray-400">—</span>
                                  )
                                })()}

                                {col.id === 'price' && (
                                  (() => {
                                    const quote = asset.symbol ? getQuote(asset.symbol) : null
                                    const livePrice = showLivePrices && quote?.price
                                    const displayPrice = livePrice || asset.current_price
                                    const changePercent = quote?.changePercent

                                    if (!displayPrice) {
                                      return <span className={clsx(
                                        'text-gray-400',
                                        density === 'ultra' ? 'text-xs' : 'text-sm'
                                      )}>—</span>
                                    }

                                    if (density === 'comfortable') {
                                      return (
                                        <div>
                                          <p className="text-sm font-medium text-gray-900">
                                            ${Number(displayPrice).toFixed(2)}
                                          </p>
                                          {showLivePrices && changePercent !== undefined && (
                                            <p className={clsx(
                                              'text-xs font-medium flex items-center',
                                              changePercent >= 0 ? 'text-green-600' : 'text-red-600'
                                            )}>
                                              {changePercent >= 0 ? <TrendingUp className="h-3 w-3 mr-0.5" /> : <TrendingDown className="h-3 w-3 mr-0.5" />}
                                              {changePercent >= 0 ? '+' : ''}{changePercent.toFixed(2)}%
                                            </p>
                                          )}
                                        </div>
                                      )
                                    }

                                    return (
                                      <div className="flex items-center gap-1.5">
                                        <p className={clsx(
                                          'font-medium text-gray-900',
                                          density === 'ultra' ? 'text-xs' : 'text-sm'
                                        )}>
                                          ${Number(displayPrice).toFixed(2)}
                                        </p>
                                        {showLivePrices && changePercent !== undefined && (
                                          <span className={clsx(
                                            'font-medium flex items-center',
                                            density === 'ultra' ? 'text-xs' : 'text-xs',
                                            changePercent >= 0 ? 'text-green-600' : 'text-red-600'
                                          )}>
                                            {changePercent >= 0 ? '+' : ''}{changePercent.toFixed(2)}%
                                          </span>
                                        )}
                                      </div>
                                    )
                                  })()
                                )}

                                {col.id === 'priority' && (
                                  editingCell?.assetId === asset.id && editingCell?.field === 'priority' ? (
                                    <select
                                      className="text-xs px-2 py-1 border border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      value={asset.priority || 'none'}
                                      onChange={(e) => {
                                        quickEditMutation.mutate({ assetId: asset.id, field: 'priority', value: e.target.value })
                                      }}
                                      onBlur={() => setEditingCell(null)}
                                      onClick={(e) => e.stopPropagation()}
                                      autoFocus
                                    >
                                      {PRIORITY_OPTIONS.map(opt => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                      ))}
                                    </select>
                                  ) : (
                                    <div
                                      className="group/cell flex items-center gap-1"
                                      onDoubleClick={(e) => {
                                        e.stopPropagation()
                                        setEditingCell({ assetId: asset.id, field: 'priority' })
                                      }}
                                    >
                                      <PriorityBadge priority={asset.priority} />
                                      <Edit3 className="h-3 w-3 text-gray-300 opacity-0 group-hover/cell:opacity-100 transition-opacity" />
                                    </div>
                                  )
                                )}

                                {col.id === 'coverage' && (() => {
                                  const coverage = assetCoverageMap.get(asset.id) || []
                                  if (coverage.length === 0) {
                                    return <span className={clsx(
                                      'text-gray-400',
                                      density === 'ultra' ? 'text-xs' : 'text-sm'
                                    )}>—</span>
                                  }
                                  const lead = coverage.find(c => c.isLead) || coverage[0]

                                  if (density === 'comfortable') {
                                    return (
                                      <div className="flex flex-col gap-0.5" title={coverage.map(c => `${c.analyst}${c.team ? ` (${c.team})` : ''}`).join('\n')}>
                                        <span className="text-sm text-gray-900 truncate">{lead.analyst}</span>
                                        {lead.team && <span className="text-xs text-gray-500 truncate">{lead.team}</span>}
                                        {coverage.length > 1 && <span className="text-xs text-blue-600">+{coverage.length - 1} more</span>}
                                      </div>
                                    )
                                  }

                                  return (
                                    <div
                                      className="flex items-center gap-1.5"
                                      title={coverage.map(c => `${c.analyst}${c.team ? ` (${c.team})` : ''}`).join('\n')}
                                    >
                                      <span className={clsx(
                                        'text-gray-900 truncate',
                                        density === 'ultra' ? 'text-xs' : 'text-sm'
                                      )}>{lead.analyst}</span>
                                      {coverage.length > 1 && (
                                        <span className={clsx(
                                          'text-blue-600 flex-shrink-0',
                                          density === 'ultra' ? 'text-xs' : 'text-xs'
                                        )}>+{coverage.length - 1}</span>
                                      )}
                                    </div>
                                  )
                                })()}

                                {col.id === 'thesis' && (
                                  <div
                                    className="text-sm text-gray-600 truncate cursor-help"
                                    title={asset.thesis || 'No thesis'}
                                  >
                                    {summarizeText(asset.thesis, 50) || <span className="text-gray-400 italic">No thesis</span>}
                                  </div>
                                )}

                                {col.id === 'where_different' && (
                                  <div
                                    className="text-sm text-gray-600 truncate cursor-help"
                                    title={asset.where_different || 'Not specified'}
                                  >
                                    {summarizeText(asset.where_different, 50) || <span className="text-gray-400 italic">—</span>}
                                  </div>
                                )}

                                {col.id === 'notes' && (() => {
                                  const quickNote = asset.quick_note || ''
                                  const isEditing = editingNoteId === asset.id

                                  if (isEditing) {
                                    return (
                                      <div className="relative" onClick={(e) => e.stopPropagation()}>
                                        <textarea
                                          autoFocus
                                          value={editingNoteValue}
                                          onChange={(e) => setEditingNoteValue(e.target.value)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                              e.preventDefault()
                                              saveNote(asset.id)
                                            } else if (e.key === 'Escape') {
                                              e.preventDefault()
                                              cancelNoteEdit()
                                            }
                                          }}
                                          onBlur={() => saveNote(asset.id)}
                                          placeholder="Add a quick note..."
                                          rows={2}
                                          className="w-full text-sm px-2 py-1.5 bg-white dark:bg-gray-800 border border-blue-400 dark:border-blue-500 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 resize-none transition-all"
                                        />
                                        <div className="absolute -bottom-5 right-0 text-[10px] text-gray-400">
                                          Enter to save · Esc to cancel
                                        </div>
                                      </div>
                                    )
                                  }

                                  return (
                                    <div
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        startEditingNote(asset.id, quickNote)
                                      }}
                                      className="group/note w-full h-full flex items-center cursor-text hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded px-1 -mx-1 transition-colors"
                                      title={quickNote || 'Click to add quick note'}
                                    >
                                      {quickNote ? (
                                        <span className="text-sm text-gray-700 dark:text-gray-300 truncate">
                                          {summarizeText(quickNote, 40)}
                                        </span>
                                      ) : (
                                        <span className="text-sm text-gray-400 italic opacity-0 group-hover/note:opacity-100 transition-opacity">
                                          Add note...
                                        </span>
                                      )}
                                    </div>
                                  )
                                })()}

                                {col.id === 'sector' && (
                                  <span className="text-sm text-gray-600 truncate">
                                    {asset.sector || '—'}
                                  </span>
                                )}

                                {col.id === 'updated' && (
                                  <div className="flex items-center text-sm text-gray-500">
                                    <Calendar className="h-3 w-3 mr-1 flex-shrink-0" />
                                    <span className="truncate">
                                      {formatDistanceToNow(new Date(asset.updated_at || 0), { addSuffix: true })}
                                    </span>
                                  </div>
                                )}

                              </div>
                            )
                          })}
                        </div>

                        {/* Expanded Row Content */}
                        {isExpanded && (
                          <div className="px-6 py-4 bg-gradient-to-b from-gray-50 to-white border-t border-gray-100">
                            {/* Quick Stats Row */}
                            <div className="flex items-center gap-6 mb-4 pb-3 border-b border-gray-100">
                              {asset.sector && (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs text-gray-500">Sector:</span>
                                  <span className="text-xs font-medium text-gray-700">{asset.sector}</span>
                                </div>
                              )}
                              {asset.market_cap && (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs text-gray-500">Market Cap:</span>
                                  <span className="text-xs font-medium text-gray-700">
                                    ${(asset.market_cap / 1e9).toFixed(2)}B
                                  </span>
                                </div>
                              )}
                              {asset.created_at && (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs text-gray-500">Added:</span>
                                  <span className="text-xs font-medium text-gray-700">
                                    {format(parseISO(asset.created_at), 'MMM d, yyyy')}
                                  </span>
                                </div>
                              )}
                              {asset.updated_at && (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs text-gray-500">Updated:</span>
                                  <span className="text-xs font-medium text-gray-700">
                                    {formatDistanceToNow(parseISO(asset.updated_at), { addSuffix: true })}
                                  </span>
                                </div>
                              )}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleAssetClick(asset)
                                }}
                                className="ml-auto text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                              >
                                Open Full View
                                <ChevronRight className="h-3 w-3" />
                              </button>
                            </div>

                            <div className="grid grid-cols-3 gap-6">
                              {/* Thesis */}
                              <div>
                                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                                  <FileText className="h-3.5 w-3.5" />
                                  Thesis
                                </h4>
                                <p className="text-sm text-gray-700 leading-relaxed">
                                  {asset.thesis || <span className="text-gray-400 italic">No thesis recorded</span>}
                                </p>
                              </div>

                              {/* Recent Notes */}
                              <div>
                                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                                  <FileText className="h-3.5 w-3.5" />
                                  Recent Notes
                                </h4>
                                {asset.asset_notes?.length > 0 ? (
                                  <div className="space-y-2">
                                    {asset.asset_notes.slice(0, 2).map((note: any, idx: number) => (
                                      <div key={idx} className="text-sm">
                                        <p className="text-gray-700 line-clamp-2">{note.content}</p>
                                        {note.created_at && (
                                          <p className="text-xs text-gray-400 mt-0.5">
                                            {formatDistanceToNow(parseISO(note.created_at), { addSuffix: true })}
                                          </p>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-sm text-gray-400 italic">No notes yet</p>
                                )}
                              </div>

                              {/* Price Targets & Tags */}
                              <div>
                                {asset.price_targets?.length > 0 && (
                                  <div className="mb-3">
                                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                                      <Target className="h-3.5 w-3.5" />
                                      Price Targets
                                    </h4>
                                    <div className="flex gap-2 flex-wrap">
                                      {asset.price_targets.slice(0, 4).map((target: any, idx: number) => {
                                        const quote = asset.symbol ? getQuote(asset.symbol) : null
                                        const currentPrice = quote?.price || asset.current_price
                                        const targetPrice = Number(target.price)
                                        const pctToTarget = currentPrice ? ((targetPrice - currentPrice) / currentPrice * 100) : null

                                        return (
                                          <span key={idx} className="inline-flex items-center gap-1 px-2 py-1 bg-white border border-gray-200 rounded text-xs shadow-sm">
                                            <span className={clsx(
                                              'font-semibold',
                                              target.type === 'bull' ? 'text-green-600' : 'text-red-600'
                                            )}>
                                              ${targetPrice.toFixed(2)}
                                            </span>
                                            {pctToTarget !== null && (
                                              <span className="text-gray-400">
                                                ({pctToTarget > 0 ? '+' : ''}{pctToTarget.toFixed(1)}%)
                                              </span>
                                            )}
                                          </span>
                                        )
                                      })}
                                    </div>
                                  </div>
                                )}

                                {asset.tags?.length > 0 && (
                                  <div>
                                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                                      <Tag className="h-3.5 w-3.5" />
                                      Tags
                                    </h4>
                                    <div className="flex gap-1.5 flex-wrap">
                                      {asset.tags.map((tag: any, idx: number) => (
                                        <span
                                          key={idx}
                                          className="px-2 py-0.5 text-xs rounded-full"
                                          style={{
                                            backgroundColor: tag.color ? `${tag.color}20` : '#E5E7EB',
                                            color: tag.color || '#374151'
                                          }}
                                        >
                                          {tag.name}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {!asset.price_targets?.length && !asset.tags?.length && (
                                  <p className="text-sm text-gray-400 italic">No targets or tags</p>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Table Footer with row count */}
              <div className="px-4 py-2 bg-gray-50 border-t border-gray-200 text-xs text-gray-500">
                Showing {filteredAssets.length} assets
                {expandedRows.size > 0 && ` • ${expandedRows.size} expanded`}
              </div>
            </Card>
          )}


          {/* Kanban View - Drag & Drop Board */}
          {viewMode === 'kanban' && (() => {
            // Get columns based on organization type
            const getKanbanColumns = () => {
              switch (kanbanOrganization) {
                case 'priority':
                  return PRIORITY_OPTIONS.map(p => ({
                    key: p.value,
                    label: p.label,
                    color: p.color,
                    assets: filteredAssets.filter(a => (a.priority || 'none') === p.value)
                  }))
                case 'stage':
                  return Object.entries(PROCESS_STAGES).map(([key, stage]) => ({
                    key,
                    label: stage.label,
                    color: stage.color,
                    assets: filteredAssets.filter(a => a.process_stage === key)
                  })).concat([{
                    key: 'unassigned',
                    label: 'No Stage',
                    color: 'bg-gray-100 text-gray-600',
                    assets: filteredAssets.filter(a => !a.process_stage)
                  }])
                case 'workflow':
                  // Group by workflows - get unique workflows from assetWorkflowMap
                  const workflowGroups = new Map<string, { id: string; name: string; color: string; assets: any[] }>()
                  filteredAssets.forEach(asset => {
                    const workflows = assetWorkflowMap.get(asset.id) || []
                    if (workflows.length === 0) {
                      const noWf = workflowGroups.get('none') || { id: 'none', name: 'No Workflow', color: '#9CA3AF', assets: [] }
                      noWf.assets.push(asset)
                      workflowGroups.set('none', noWf)
                    } else {
                      workflows.forEach(wf => {
                        const group = workflowGroups.get(wf.id) || { ...wf, assets: [] }
                        group.assets.push(asset)
                        workflowGroups.set(wf.id, group)
                      })
                    }
                  })
                  return Array.from(workflowGroups.values()).map(wf => ({
                    key: wf.id,
                    label: wf.name,
                    color: `bg-opacity-20 text-gray-800`,
                    bgColor: wf.color,
                    assets: wf.assets
                  }))
                default:
                  return []
              }
            }

            const columns = getKanbanColumns()

            // Filter columns based on hidden/fullscreen state
            const visibleKanbanColumns = fullscreenKanbanColumn
              ? columns.filter(c => c.key === fullscreenKanbanColumn)
              : columns.filter(c => !hiddenKanbanColumns.has(c.key))

            const hiddenColumnsInfo = columns.filter(c => hiddenKanbanColumns.has(c.key))

            return (
              <div className="space-y-4">
                {/* Kanban Organization Selector */}
                <div className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-4 py-2">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-700">Organize by:</span>
                    <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                      {KANBAN_ORGANIZATION_OPTIONS.map(option => (
                        <button
                          key={option.value}
                          onClick={() => {
                            setKanbanOrganization(option.value)
                            setKanbanColumnSearch({})
                            setHiddenKanbanColumns(new Set())
                            setFullscreenKanbanColumn(null)
                          }}
                          className={clsx(
                            'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                            kanbanOrganization === option.value
                              ? 'bg-white text-blue-600 shadow-sm'
                              : 'text-gray-600 hover:text-gray-900'
                          )}
                        >
                          <option.icon className="w-3.5 h-3.5" />
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {fullscreenKanbanColumn && (
                      <button
                        onClick={() => setFullscreenKanbanColumn(null)}
                        className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100 transition-colors"
                      >
                        <Minimize2 className="w-3.5 h-3.5" />
                        Exit Fullscreen
                      </button>
                    )}
                    <div className="text-sm text-gray-500">
                      {filteredAssets.length} assets in {visibleKanbanColumns.length} columns
                    </div>
                    {/* Hidden Columns - Inline */}
                    {hiddenColumnsInfo.length > 0 && !fullscreenKanbanColumn && (
                      <div className="flex items-center gap-1.5 border-l border-gray-200 pl-3">
                        <span className="text-xs text-gray-400">Hidden:</span>
                        {hiddenColumnsInfo.map(col => (
                          <button
                            key={col.key}
                            onClick={() => {
                              const newHidden = new Set(hiddenKanbanColumns)
                              newHidden.delete(col.key)
                              setHiddenKanbanColumns(newHidden)
                            }}
                            className="flex items-center gap-1 px-1.5 py-0.5 text-xs bg-gray-100 hover:bg-gray-200 rounded transition-colors"
                            title={`Show ${col.label} (${col.assets.length} assets)`}
                          >
                            <Eye className="w-3 h-3 text-gray-400" />
                            <span className="text-gray-600">{col.label}</span>
                          </button>
                        ))}
                        {hiddenColumnsInfo.length > 1 && (
                          <button
                            onClick={() => setHiddenKanbanColumns(new Set())}
                            className="text-xs text-blue-600 hover:text-blue-700"
                          >
                            All
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Kanban Board - columns expand to fill space */}
                <div
                  className="grid gap-4"
                  style={{
                    gridTemplateColumns: fullscreenKanbanColumn
                      ? '1fr'
                      : `repeat(${Math.min(visibleKanbanColumns.length, 8)}, minmax(200px, 1fr))`
                  }}
                >
                  {visibleKanbanColumns.map(column => {
                    const searchTerm = kanbanColumnSearch[column.key] || ''
                    const filteredColumnAssets = searchTerm
                      ? column.assets.filter(a =>
                          a.symbol?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          a.company_name?.toLowerCase().includes(searchTerm.toLowerCase())
                        )
                      : column.assets

                    const isFullscreen = fullscreenKanbanColumn === column.key

                    return (
                      <div
                        key={column.key}
                        className={clsx(
                          "flex flex-col bg-gray-50 rounded-lg border border-gray-200",
                          isFullscreen ? "min-h-[600px]" : "min-h-[400px]"
                        )}
                        onDragOver={handleKanbanDragOver}
                        onDrop={() => kanbanOrganization === 'priority' && handleKanbanDrop(column.key)}
                      >
                        {/* Column Header */}
                        <div
                          className={clsx(
                            'px-3 py-2 border-b border-gray-200 rounded-t-lg',
                            column.color
                          )}
                          style={column.bgColor ? { backgroundColor: `${column.bgColor}20` } : undefined}
                        >
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-sm truncate flex-shrink-0" title={column.label}>
                              {column.label}
                            </h3>
                            <span className="text-xs opacity-75 bg-white/50 px-1.5 py-0.5 rounded flex-shrink-0">
                              {filteredColumnAssets.length}
                            </span>
                            {/* Column Search - Inline */}
                            <div className="relative flex-1 min-w-0">
                              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                              <input
                                type="text"
                                placeholder="Search..."
                                value={searchTerm}
                                onChange={(e) => setKanbanColumnSearch(prev => ({
                                  ...prev,
                                  [column.key]: e.target.value
                                }))}
                                className="w-full pl-7 pr-2 py-1 text-xs bg-white border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </div>
                            {/* Column Actions */}
                            <div className="flex items-center gap-0.5 flex-shrink-0">
                              {isFullscreen ? (
                                <button
                                  onClick={() => setFullscreenKanbanColumn(null)}
                                  className="p-1 rounded hover:bg-white/50 text-gray-500 hover:text-gray-700 transition-colors"
                                  title="Exit fullscreen"
                                >
                                  <Minimize2 className="w-3.5 h-3.5" />
                                </button>
                              ) : (
                                <>
                                  <button
                                    onClick={() => setFullscreenKanbanColumn(column.key)}
                                    className="p-1 rounded hover:bg-white/50 text-gray-500 hover:text-gray-700 transition-colors"
                                    title="Fullscreen"
                                  >
                                    <Maximize2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => {
                                      const newHidden = new Set(hiddenKanbanColumns)
                                      newHidden.add(column.key)
                                      setHiddenKanbanColumns(newHidden)
                                    }}
                                    className="p-1 rounded hover:bg-white/50 text-gray-500 hover:text-gray-700 transition-colors"
                                    title="Hide column"
                                  >
                                    <EyeOff className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Column Content */}
                        <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[500px]">
                          {filteredColumnAssets.map(asset => (
                            <div
                              key={asset.id}
                              draggable={kanbanOrganization === 'priority'}
                              onDragStart={() => kanbanOrganization === 'priority' && handleKanbanDragStart(asset.id)}
                              onClick={() => handleAssetClick(asset)}
                              className={clsx(
                                "bg-white rounded-lg border border-gray-200 p-3 hover:shadow-md transition-shadow",
                                kanbanOrganization === 'priority' ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
                                draggedAsset === asset.id && "opacity-50"
                              )}
                            >
                              <div className="flex items-start justify-between mb-2">
                                <div className="min-w-0 flex-1">
                                  <p className="font-semibold text-gray-900 text-sm">{asset.symbol}</p>
                                  <p className="text-xs text-gray-600 truncate">{asset.company_name}</p>
                                </div>
                                {kanbanOrganization === 'priority' && (
                                  <GripHorizontal className="w-4 h-4 text-gray-300 flex-shrink-0" />
                                )}
                              </div>
                              {asset.sector && (
                                <p className="text-xs text-gray-500 mb-2">{asset.sector}</p>
                              )}
                              <div className="flex items-center justify-between gap-2">
                                {(() => {
                                  const quote = asset.symbol ? getQuote(asset.symbol) : null
                                  const displayPrice = (showLivePrices && quote?.price) || asset.current_price
                                  return displayPrice ? (
                                    <span className="text-xs font-medium text-gray-900">
                                      ${Number(displayPrice).toFixed(2)}
                                    </span>
                                  ) : <span />
                                })()}
                                {/* Show appropriate badge based on organization */}
                                {kanbanOrganization === 'priority' && asset.process_stage && PROCESS_STAGES[asset.process_stage as keyof typeof PROCESS_STAGES] && (
                                  <span className={clsx(
                                    'px-1.5 py-0.5 text-[10px] font-medium rounded-full',
                                    PROCESS_STAGES[asset.process_stage as keyof typeof PROCESS_STAGES].color
                                  )}>
                                    {PROCESS_STAGES[asset.process_stage as keyof typeof PROCESS_STAGES].label}
                                  </span>
                                )}
                                {kanbanOrganization === 'stage' && asset.priority && (
                                  <PriorityBadge priority={asset.priority} size="sm" />
                                )}
                                {kanbanOrganization === 'workflow' && asset.priority && (
                                  <PriorityBadge priority={asset.priority} size="sm" />
                                )}
                              </div>
                            </div>
                          ))}
                          {filteredColumnAssets.length === 0 && (
                            <div className="text-center py-8 text-gray-400">
                              {searchTerm ? (
                                <p className="text-xs">No matches for "{searchTerm}"</p>
                              ) : kanbanOrganization === 'priority' ? (
                                <p className="text-xs">Drop assets here</p>
                              ) : (
                                <p className="text-xs">No assets</p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* Tree View - Hierarchical Organization */}
          {viewMode === 'tree' && treeData && (
            <Card padding="none">
              {/* Organization Selector */}
              <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FolderTree className="w-4 h-4 text-gray-500" />
                  <span className="text-sm font-medium text-gray-700">Organize by:</span>
                </div>
                <div className="flex items-center gap-1 bg-white rounded-lg border border-gray-200 p-0.5">
                  {[
                    { value: 'theme', label: 'Theme' },
                    { value: 'list', label: 'List' },
                    { value: 'sector', label: 'Sector' },
                    { value: 'priority', label: 'Priority' },
                    { value: 'workflow', label: 'Workflow' },
                    { value: 'portfolio', label: 'Portfolio' },
                  ].map(option => (
                    <button
                      key={option.value}
                      onClick={() => setTreeOrganization(option.value as any)}
                      className={clsx(
                        'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                        treeOrganization === option.value
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-600 hover:bg-gray-100'
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-4">
                {/* Root level */}
                {Array.from(treeData.children.entries()).map(([groupName, groupNode]) => {
                  const groupKey = `group-${groupName}`
                  const isGroupExpanded = expandedTreeNodes.has(groupKey)
                  // Count assets - either directly or through children
                  const groupAssetCount = groupNode.assets.length > 0
                    ? groupNode.assets.length
                    : Array.from(groupNode.children.values())
                        .reduce((sum: number, childNode: any) => sum + childNode.assets.length, 0)

                  return (
                    <div key={groupName} className="mb-2">
                      {/* Group Row (Theme/List/Sector/Portfolio) */}
                      <button
                        onClick={() => toggleTreeNode(groupKey)}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 rounded-lg transition-colors"
                      >
                        <ChevronRight className={clsx(
                          'w-4 h-4 text-gray-400 transition-transform',
                          isGroupExpanded && 'rotate-90'
                        )} />
                        <span className="font-medium text-gray-900">{groupName}</span>
                        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                          {groupAssetCount}
                        </span>
                      </button>

                      {/* Expanded Content */}
                      {isGroupExpanded && (
                        <div className="ml-6 border-l border-gray-200 pl-2">
                          {/* If there are child groups (nested structure like Theme→Sector) */}
                          {groupNode.children.size > 0 && Array.from(groupNode.children.entries()).map(([childName, childNode]: [string, any]) => {
                            const childKey = `${groupKey}-${childName}`
                            const isChildExpanded = expandedTreeNodes.has(childKey)

                            return (
                              <div key={childName} className="mb-1">
                                {/* Child Group Row */}
                                <button
                                  onClick={() => toggleTreeNode(childKey)}
                                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 rounded-lg transition-colors"
                                >
                                  <ChevronRight className={clsx(
                                    'w-3 h-3 text-gray-400 transition-transform',
                                    isChildExpanded && 'rotate-90'
                                  )} />
                                  <span className="text-sm text-gray-700">{childName}</span>
                                  <span className="text-xs text-gray-400">
                                    {childNode.assets.length}
                                  </span>
                                </button>

                                {/* Assets within Child Group */}
                                {isChildExpanded && (
                                  <div className="ml-6 border-l border-gray-100 pl-2">
                                    {childNode.assets.map((asset: any) => (
                                      <div
                                        key={asset.id}
                                        onClick={() => handleAssetClick(asset)}
                                        className="flex items-center justify-between px-3 py-2 hover:bg-gray-50 rounded-lg cursor-pointer transition-colors"
                                      >
                                        <div className="flex items-center gap-2">
                                          <div className="w-2 h-2 rounded-full bg-gray-300" />
                                          <span className="font-medium text-gray-900">{asset.symbol}</span>
                                          <span className="text-sm text-gray-600">{asset.company_name}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          {(() => {
                                            const quote = asset.symbol ? getQuote(asset.symbol) : null
                                            const displayPrice = (showLivePrices && quote?.price) || asset.current_price
                                            return displayPrice ? (
                                              <span className="text-sm font-medium text-gray-900">
                                                ${Number(displayPrice).toFixed(2)}
                                              </span>
                                            ) : null
                                          })()}
                                          <PriorityBadge priority={asset.priority} size="sm" />
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )
                          })}

                          {/* If there are direct assets (flat structure like List→Assets) */}
                          {groupNode.assets.length > 0 && groupNode.assets.map((asset: any) => (
                            <div
                              key={asset.id}
                              onClick={() => handleAssetClick(asset)}
                              className="flex items-center justify-between px-3 py-2 hover:bg-gray-50 rounded-lg cursor-pointer transition-colors"
                            >
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-gray-300" />
                                <span className="font-medium text-gray-900">{asset.symbol}</span>
                                <span className="text-sm text-gray-600">{asset.company_name}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                {(() => {
                                  const quote = asset.symbol ? getQuote(asset.symbol) : null
                                  const displayPrice = (showLivePrices && quote?.price) || asset.current_price
                                  return displayPrice ? (
                                    <span className="text-sm font-medium text-gray-900">
                                      ${Number(displayPrice).toFixed(2)}
                                    </span>
                                  ) : null
                                })()}
                                <PriorityBadge priority={asset.priority} size="sm" />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}

                {treeData.children.size === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    <FolderTree className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p>No assets to display in tree view</p>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Grouped View Overlay - Show groups when groupBy is set (Table view - compact handles its own grouping) */}
          {groupBy !== 'none' && groupedAssets && viewMode === 'table' && (
            <div className="space-y-4">
              {groupedAssets.map(([groupKey, group]) => {
                const isCollapsed = collapsedGroups.has(groupKey)
                const groupInfo = getGroupInfo(groupKey)

                return (
                  <Card key={groupKey} padding="none">
                    {/* Group Header */}
                    <button
                      onClick={() => toggleGroupCollapse(groupKey)}
                      className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors border-b border-gray-200"
                    >
                      <div className="flex items-center gap-3">
                        <ChevronRight className={clsx(
                          'w-4 h-4 text-gray-400 transition-transform',
                          !isCollapsed && 'rotate-90'
                        )} />
                        <span className={clsx(
                          'px-2.5 py-1 text-sm font-medium rounded-full',
                          groupInfo.color
                        )}>
                          {groupInfo.label}
                        </span>
                        <span className="text-sm text-gray-500">
                          {group.stats.count} {group.stats.count === 1 ? 'asset' : 'assets'}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        {group.stats.totalValue > 0 && (
                          <span className="text-gray-600">
                            Total: ${group.stats.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        )}
                        {group.stats.avgChange !== 0 && showLivePrices && (
                          <span className={clsx(
                            'font-medium',
                            group.stats.avgChange >= 0 ? 'text-green-600' : 'text-red-600'
                          )}>
                            {group.stats.avgChange >= 0 ? '+' : ''}{group.stats.avgChange.toFixed(2)}% avg
                          </span>
                        )}
                      </div>
                    </button>

                    {/* Group Content */}
                    {!isCollapsed && (
                      <div className="divide-y divide-gray-100">
                        {group.assets.map(asset => (
                          <div
                            key={asset.id}
                            onClick={() => handleAssetClick(asset)}
                            className="px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors flex items-center justify-between"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="min-w-0">
                                <p className="font-semibold text-gray-900">{asset.symbol}</p>
                                <p className="text-sm text-gray-600 truncate">{asset.company_name}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              {(() => {
                                const quote = asset.symbol ? getQuote(asset.symbol) : null
                                const displayPrice = (showLivePrices && quote?.price) || asset.current_price
                                const changePercent = quote?.changePercent
                                return displayPrice ? (
                                  <div className="text-right">
                                    <p className="text-sm font-medium text-gray-900">
                                      ${Number(displayPrice).toFixed(2)}
                                    </p>
                                    {showLivePrices && changePercent !== undefined && (
                                      <p className={clsx(
                                        'text-xs font-medium',
                                        changePercent >= 0 ? 'text-green-600' : 'text-red-600'
                                      )}>
                                        {changePercent >= 0 ? '+' : ''}{changePercent.toFixed(2)}%
                                      </p>
                                    )}
                                  </div>
                                ) : null
                              })()}
                              <PriorityBadge priority={asset.priority} size="sm" />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                )
              })}
            </div>
          )}
        </>
      ) : assets?.length === 0 ? (
        <Card>
          <EmptyState
            icon={TrendingUp}
            title="No assets yet"
            description="Start by adding your first investment idea."
            action={{
              label: 'Add First Asset',
              onClick: () => console.log('Add asset clicked'),
              icon: Plus
            }}
          />
        </Card>
      ) : (
        <Card>
          <EmptyState
            icon={Search}
            title="No assets match your filters"
            description="Try adjusting your search criteria or clearing filters."
            action={{
              label: 'Clear Filters',
              onClick: clearAllFilters
            }}
          />
        </Card>
      )}

      {/* Save Filter Modal */}
      {showSaveFilterModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Save Filter Preset</h3>
            <input
              type="text"
              value={newFilterName}
              onChange={(e) => setNewFilterName(e.target.value)}
              placeholder="Filter name (e.g., 'High Priority Tech')"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleSaveFilter()}
            />
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowSaveFilterModal(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleSaveFilter}
                disabled={!newFilterName.trim() || saveFilterMutation.isPending}
              >
                {saveFilterMutation.isPending ? 'Saving...' : 'Save Filter'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Bulk Actions Bar */}
      {selectedAssetIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-40">
          <div className="bg-gray-900 text-white rounded-xl shadow-2xl px-4 py-3 flex items-center gap-4">
            <div className="flex items-center gap-2 pr-4 border-r border-gray-700">
              <CheckSquare className="h-5 w-5 text-blue-400" />
              <span className="font-medium">{selectedAssetIds.size} selected</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowBulkPriorityModal(true)}
                className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
                title="Change Priority"
              >
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm">Priority</span>
              </button>

              <button
                onClick={() => setShowBulkStageModal(true)}
                className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
                title="Change Stage"
              >
                <Target className="h-4 w-4" />
                <span className="text-sm">Stage</span>
              </button>

              <button
                onClick={() => setShowBulkListModal(true)}
                className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
                title="Add to List"
              >
                <ListPlus className="h-4 w-4" />
                <span className="text-sm">Add to List</span>
              </button>

              <button
                onClick={() => setShowBulkTagModal(true)}
                className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
                title="Tag Assets"
              >
                <Tag className="h-4 w-4" />
                <span className="text-sm">Tag</span>
              </button>

              <button
                onClick={exportToCSV}
                className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
                title="Export to CSV"
              >
                <Download className="h-4 w-4" />
                <span className="text-sm">Export</span>
              </button>
            </div>

            <button
              onClick={clearSelection}
              className="ml-2 p-1.5 hover:bg-gray-700 rounded-lg transition-colors"
              title="Clear selection"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Bulk Priority Modal */}
      {showBulkPriorityModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Set Priority for {selectedAssetIds.size} Assets
            </h3>
            <div className="space-y-2 mb-6">
              {PRIORITY_OPTIONS.map(option => (
                <button
                  key={option.value}
                  onClick={() => bulkUpdatePriorityMutation.mutate(option.value)}
                  disabled={bulkActionLoading}
                  className={clsx(
                    "w-full px-4 py-3 text-left rounded-lg border transition-colors flex items-center justify-between",
                    option.color,
                    "hover:opacity-80",
                    bulkActionLoading && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <span className="font-medium">{option.label}</span>
                  {bulkActionLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                </button>
              ))}
            </div>
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setShowBulkPriorityModal(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Stage Modal */}
      {showBulkStageModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Set Stage for {selectedAssetIds.size} Assets
            </h3>
            <div className="space-y-2 mb-6 max-h-80 overflow-y-auto">
              {Object.entries(PROCESS_STAGES).map(([key, stage]) => (
                <button
                  key={key}
                  onClick={() => bulkUpdateStageMutation.mutate(key)}
                  disabled={bulkActionLoading}
                  className={clsx(
                    "w-full px-4 py-3 text-left rounded-lg border transition-colors flex items-center justify-between",
                    stage.color,
                    "hover:opacity-80",
                    bulkActionLoading && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <span className="font-medium">{stage.label}</span>
                  {bulkActionLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                </button>
              ))}
            </div>
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setShowBulkStageModal(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Add to List Modal */}
      {showBulkListModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Add {selectedAssetIds.size} Assets to List
            </h3>
            {lists && lists.length > 0 ? (
              <div className="space-y-2 mb-6 max-h-80 overflow-y-auto">
                {lists.map(list => (
                  <button
                    key={list.id}
                    onClick={() => bulkAddToListMutation.mutate(list.id)}
                    disabled={bulkActionLoading}
                    className={clsx(
                      "w-full px-4 py-3 text-left rounded-lg border border-gray-200 transition-colors flex items-center gap-3",
                      "hover:bg-gray-50 hover:border-gray-300",
                      bulkActionLoading && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: list.color || '#3B82F6' }}
                    />
                    <div className="flex-1">
                      <span className="font-medium text-gray-900">{list.name}</span>
                      {list.description && (
                        <p className="text-sm text-gray-500 truncate">{list.description}</p>
                      )}
                    </div>
                    {bulkActionLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <ListPlus className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                <p>No lists yet. Create a list first.</p>
              </div>
            )}
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setShowBulkListModal(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Tag Modal */}
      {showBulkTagModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Tag {selectedAssetIds.size} Assets
            </h3>

            {/* Create new tag */}
            <div className="mb-4 p-3 bg-gray-50 rounded-lg">
              <label className="block text-sm font-medium text-gray-700 mb-2">Create New Tag</label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={newTagColor}
                  onChange={(e) => setNewTagColor(e.target.value)}
                  className="w-10 h-10 rounded cursor-pointer border border-gray-200"
                />
                <input
                  type="text"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  placeholder="Tag name..."
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <Button
                  onClick={() => {
                    if (newTagName.trim()) {
                      createTagMutation.mutate({ name: newTagName.trim(), color: newTagColor })
                    }
                  }}
                  disabled={!newTagName.trim() || createTagMutation.isPending}
                  size="sm"
                >
                  {createTagMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {/* Existing tags */}
            {tags && tags.length > 0 ? (
              <div className="space-y-2 mb-6 max-h-60 overflow-y-auto">
                <label className="block text-sm font-medium text-gray-700 mb-2">Apply Existing Tag</label>
                {tags.map(tag => (
                  <button
                    key={tag.id}
                    onClick={() => bulkAddTagMutation.mutate(tag.id)}
                    disabled={bulkActionLoading}
                    className={clsx(
                      "w-full px-4 py-2.5 text-left rounded-lg border border-gray-200 transition-colors flex items-center gap-3",
                      "hover:bg-gray-50 hover:border-gray-300",
                      bulkActionLoading && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: tag.color || '#6B7280' }}
                    />
                    <span className="font-medium text-gray-900">{tag.name}</span>
                    {bulkActionLoading && <Loader2 className="h-4 w-4 animate-spin ml-auto" />}
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-gray-500 mb-4">
                <Tag className="h-10 w-10 mx-auto mb-2 text-gray-300" />
                <p className="text-sm">No tags yet. Create one above.</p>
              </div>
            )}

            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setShowBulkTagModal(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Keyboard Shortcuts Help Modal */}
      <KeyboardShortcutsHelp />

      {/* Command Palette */}
      <CommandPalette
        isOpen={tableState.commandPaletteOpen}
        onClose={closeCommandPalette}
        assets={assets?.map(a => ({ id: a.id, symbol: a.symbol, company_name: a.company_name })) || []}
        columns={columns.map(c => ({ id: c.id, label: c.label, visible: c.visible }))}
        onNavigateToAsset={(assetId) => {
          const asset = assets?.find(a => a.id === assetId)
          if (asset) {
            onAssetSelect?.(asset)
          }
        }}
        onApplyFilter={(field, value) => {
          if (!field && !value) {
            // Clear all filters
            clearAllFilters()
          } else if (field === 'priority') {
            setSelectedPriorities(value ? [value] : [])
          }
        }}
        onApplySort={(field, direction) => {
          setSortBy(field)
          setSortOrder(direction)
        }}
        onToggleColumnVisibility={toggleColumnVisibility}
        onSetDensity={setDensity}
        onSelectAll={() => {
          setSelectionMode(true)
          setSelectedAssetIds(new Set(filteredAssets.map(a => a.id)))
        }}
        onClearSelection={() => {
          setSelectedAssetIds(new Set())
          setSelectionMode(false)
        }}
        onBulkDelete={() => {
          if (selectedAssetIds.size > 0) {
            // Trigger bulk delete
            setShowBulkPriorityModal(true)
          }
        }}
        onBulkChangePriority={(priority) => {
          // Bulk priority change
          selectedAssetIds.forEach(async (assetId) => {
            await supabase
              .from('assets')
              .update({ priority })
              .eq('id', assetId)
          })
          queryClient.invalidateQueries({ queryKey: ['all-assets'] })
          setSelectedAssetIds(new Set())
          setSelectionMode(false)
        }}
        onShowKeyboardShortcuts={toggleKeyboardHelp}
        onAnalyzeWithAI={() => {
          // Could integrate with AI analysis feature
          console.log('AI analyze:', selectedAssetIds.size > 0 ? Array.from(selectedAssetIds) : 'focused asset')
        }}
        selectedCount={selectedAssetIds.size}
      />
    </div>
  )
}
