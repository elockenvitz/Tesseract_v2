/**
 * AssetTableView - Shared table view component for displaying assets
 *
 * Used by both AssetsListPage and ListTab to provide consistent UI.
 * Includes: toolbar, filters, table/kanban/tree views, selection, bulk actions.
 */

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  TrendingUp, Search, Filter, Plus, Calendar, Target, FileText, ArrowUpDown,
  ChevronDown, ChevronUp, X, LayoutGrid, List, Table2, Bookmark, BookmarkCheck,
  SlidersHorizontal, CalendarRange, Trash2, Check, CheckSquare, Square,
  Download, Tag, ListPlus, AlertCircle, Loader2, MoreHorizontal, Clock,
  TrendingDown, Bell, RefreshCw, Activity, Settings2, GripVertical, Eye, EyeOff,
  ChevronRight, Pin, PinOff, Save, Columns3, GitBranch, FolderTree,
  Layers, GripHorizontal, FolderOpen, Folder, Maximize2, Minimize2, Users, FileEdit,
  Flag, Keyboard, HelpCircle, Sparkles, AlertTriangle, Zap, WrapText
} from 'lucide-react'
import { PriorityBadge } from '../ui/PriorityBadge'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { ListSkeleton } from '../common/LoadingSkeleton'
import { EmptyState } from '../common/EmptyState'
import { useMarketData, useMarketStatus } from '../../hooks/useMarketData'
import { formatDistanceToNow, format } from 'date-fns'
import { clsx } from 'clsx'
import { DENSITY_CONFIG } from '../../contexts/TableContext'
import { DensityToggle } from './DensityToggle'
import { useSpreadsheetNavigation } from '../../hooks/useSpreadsheetNavigation'
import { useAssetFlags, FLAG_COLORS, type FlagColor } from '../../hooks/useAssetFlags'
import { MetricPopover } from './MetricPopover'
import { FilterBar } from './FilterBar'
import { KeyboardHelpModal } from './KeyboardHelpModal'
import { formatPrice, formatPriceChange, getPriceChangeClass, formatRelativeTime, getTimestampFreshness, truncateText, getInitials } from './tableUtils'
import { useColumnContentSource, type ContentSourceType } from '../../hooks/useColumnContentSource'
import { useAIColumns, useAIColumnCache } from '../../hooks/useAIColumns'
import { ContentSourceSelector } from './ContentSourceSelector'
import { AIColumnLibraryDropdown } from './AIColumnLibraryDropdown'
import { CreateAIColumnModal } from './CreateAIColumnModal'
import { QuickPromptInput } from './QuickPromptInput'
import { AIColumnCell } from './AIColumnCell'
import { useUserAssetPriorities, useFirmAssetPriorities, useSpecificUserPriorities, Priority } from '../../hooks/useUserAssetPriority'
import { MiniChart } from '../ideas/widgets/MiniChart'
import './table-styles.css'

// ============================================================================
// Types & Constants
// ============================================================================

type ViewMode = 'table' | 'kanban' | 'tree'
type GroupByOption = 'none' | 'sector' | 'priority' | 'stage' | 'theme'
type DensityMode = 'comfortable' | 'compact' | 'ultra'
type KanbanOrganization = 'priority' | 'stage' | 'workflow'
type TreeOrganization = 'theme' | 'sector' | 'priority' | 'list' | 'workflow' | 'portfolio'

const GROUP_BY_OPTIONS: { value: GroupByOption; label: string; icon: any }[] = [
  { value: 'none', label: 'No Grouping', icon: List },
  { value: 'sector', label: 'By Sector', icon: Layers },
  { value: 'priority', label: 'By Priority', icon: AlertCircle },
  { value: 'stage', label: 'By Stage', icon: GitBranch },
  { value: 'theme', label: 'By Theme', icon: FolderTree }
]

const KANBAN_ORGANIZATION_OPTIONS: { value: KanbanOrganization; label: string; icon: any }[] = [
  { value: 'priority', label: 'Priority', icon: AlertCircle },
  { value: 'stage', label: 'Process Stage', icon: Target },
  { value: 'workflow', label: 'Workflow', icon: GitBranch }
]

const PROCESS_STAGES: Record<string, { label: string; color: string }> = {
  outdated: { label: 'Outdated', color: 'bg-gray-100 text-gray-700' },
  prioritized: { label: 'Prioritized', color: 'bg-purple-100 text-purple-700' },
  in_progress: { label: 'In Progress', color: 'bg-blue-100 text-blue-700' },
  recommend: { label: 'Recommend', color: 'bg-green-100 text-green-700' },
  review: { label: 'Review', color: 'bg-yellow-100 text-yellow-700' },
  action: { label: 'Action', color: 'bg-red-100 text-red-700' },
  monitor: { label: 'Monitor', color: 'bg-cyan-100 text-cyan-700' }
}

// Priority configuration matching the asset page's useUserAssetPriority system
const PRIORITY_CONFIG: Record<Priority, { label: string; bg: string; icon: any }> = {
  critical: { label: 'Critical', bg: 'bg-red-600', icon: AlertTriangle },
  high: { label: 'High', bg: 'bg-orange-500', icon: Zap },
  medium: { label: 'Medium', bg: 'bg-blue-500', icon: Target },
  low: { label: 'Low', bg: 'bg-green-500', icon: Clock },
  none: { label: 'None', bg: 'bg-gray-400', icon: Clock }
}

const PRIORITY_OPTIONS: Priority[] = ['critical', 'high', 'medium', 'low', 'none']

// Priority source types for user-specific priority columns
export type PrioritySourceType = 'my' | 'firm' | 'user'

interface ColumnConfig {
  id: string
  label: string
  visible: boolean
  width: number
  minWidth: number
  sortable: boolean
  pinned: boolean
  canUnpin?: boolean // If false, column cannot be unpinned (default: true)
  category?: 'core' | 'price' | 'research' | 'workflow' | 'fundamentals' | 'ai'
  isCustomAI?: boolean
  aiColumnId?: string
  wrapText?: boolean // If true, text wraps instead of truncating
  // For priority columns - specify whose priority to show
  prioritySource?: PrioritySourceType
  sourceUserId?: string // User ID when prioritySource is 'user'
  sourceUserName?: string // Display name when prioritySource is 'user'
}

const DEFAULT_COLUMNS: ColumnConfig[] = [
  // Core columns
  { id: 'select', label: '', visible: true, width: 32, minWidth: 32, sortable: false, pinned: false, category: 'core' },
  { id: 'ticker', label: 'Ticker', visible: true, width: 100, minWidth: 80, sortable: true, pinned: true, canUnpin: false, category: 'core' },
  { id: 'companyName', label: 'Company', visible: true, width: 220, minWidth: 120, sortable: true, pinned: true, canUnpin: true, category: 'core' },
  { id: 'sector', label: 'Sector', visible: false, width: 100, minWidth: 80, sortable: true, pinned: false, category: 'core' },
  { id: 'industry', label: 'Industry', visible: false, width: 120, minWidth: 80, sortable: true, pinned: false, category: 'core' },

  // Price & Market columns
  { id: 'price', label: 'Price', visible: true, width: 100, minWidth: 80, sortable: true, pinned: false, category: 'price' },
  { id: 'change', label: 'Change %', visible: true, width: 90, minWidth: 70, sortable: true, pinned: false, category: 'price' },
  { id: 'volume', label: 'Volume', visible: false, width: 100, minWidth: 80, sortable: true, pinned: false, category: 'price' },
  { id: 'market_cap', label: 'Market Cap', visible: false, width: 110, minWidth: 90, sortable: true, pinned: false, category: 'price' },
  { id: 'high_52w', label: '52W High', visible: false, width: 90, minWidth: 70, sortable: true, pinned: false, category: 'price' },
  { id: 'low_52w', label: '52W Low', visible: false, width: 90, minWidth: 70, sortable: true, pinned: false, category: 'price' },
  { id: 'avg_volume', label: 'Avg Volume', visible: false, width: 100, minWidth: 80, sortable: true, pinned: false, category: 'price' },

  // Research columns
  { id: 'coverage', label: 'Coverage', visible: true, width: 140, minWidth: 100, sortable: true, pinned: false, category: 'research' },
  { id: 'priority', label: 'My Priority', visible: true, width: 100, minWidth: 80, sortable: true, pinned: false, category: 'research', prioritySource: 'my' },
  { id: 'rating', label: 'Rating', visible: false, width: 80, minWidth: 60, sortable: true, pinned: false, category: 'research' },
  { id: 'price_target', label: 'Price Target', visible: false, width: 100, minWidth: 80, sortable: true, pinned: false, category: 'research' },
  { id: 'upside', label: 'Upside %', visible: false, width: 90, minWidth: 70, sortable: true, pinned: false, category: 'research' },
  { id: 'thesis', label: 'Thesis', visible: false, width: 200, minWidth: 120, sortable: false, pinned: false, category: 'research' },
  { id: 'bull_case', label: 'Bull Case', visible: false, width: 200, minWidth: 120, sortable: false, pinned: false, category: 'research' },
  { id: 'bear_case', label: 'Bear Case', visible: false, width: 200, minWidth: 120, sortable: false, pinned: false, category: 'research' },
  { id: 'base_case', label: 'Base Case', visible: false, width: 200, minWidth: 120, sortable: false, pinned: false, category: 'research' },
  { id: 'where_different', label: 'Where Different', visible: false, width: 200, minWidth: 120, sortable: false, pinned: false, category: 'research' },
  { id: 'risks_to_thesis', label: 'Risks to Thesis', visible: false, width: 200, minWidth: 120, sortable: false, pinned: false, category: 'research' },
  { id: 'notes', label: 'Notes', visible: false, width: 200, minWidth: 120, sortable: false, pinned: false, category: 'research' },

  // Workflow columns
  { id: 'workflows', label: 'Workflows', visible: true, width: 120, minWidth: 80, sortable: true, pinned: false, category: 'workflow' },
  { id: 'stage', label: 'Stage', visible: false, width: 100, minWidth: 80, sortable: true, pinned: false, category: 'workflow' },
  { id: 'updated', label: 'Last Updated', visible: true, width: 130, minWidth: 100, sortable: true, pinned: false, category: 'workflow' },
  { id: 'created', label: 'Created', visible: false, width: 130, minWidth: 100, sortable: true, pinned: false, category: 'workflow' },
  { id: 'last_note', label: 'Last Note', visible: false, width: 130, minWidth: 100, sortable: true, pinned: false, category: 'workflow' },

  // Fundamentals columns
  { id: 'pe_ratio', label: 'P/E', visible: false, width: 70, minWidth: 50, sortable: true, pinned: false, category: 'fundamentals' },
  { id: 'forward_pe', label: 'Fwd P/E', visible: false, width: 80, minWidth: 60, sortable: true, pinned: false, category: 'fundamentals' },
  { id: 'ev_ebitda', label: 'EV/EBITDA', visible: false, width: 90, minWidth: 70, sortable: true, pinned: false, category: 'fundamentals' },
  { id: 'pb_ratio', label: 'P/B', visible: false, width: 70, minWidth: 50, sortable: true, pinned: false, category: 'fundamentals' },
  { id: 'dividend_yield', label: 'Div Yield', visible: false, width: 90, minWidth: 70, sortable: true, pinned: false, category: 'fundamentals' },
  { id: 'eps', label: 'EPS', visible: false, width: 80, minWidth: 60, sortable: true, pinned: false, category: 'fundamentals' },
  { id: 'revenue', label: 'Revenue', visible: false, width: 100, minWidth: 80, sortable: true, pinned: false, category: 'fundamentals' },
  { id: 'revenue_growth', label: 'Rev Growth', visible: false, width: 100, minWidth: 80, sortable: true, pinned: false, category: 'fundamentals' },
  { id: 'profit_margin', label: 'Margin', visible: false, width: 80, minWidth: 60, sortable: true, pinned: false, category: 'fundamentals' },
  { id: 'roe', label: 'ROE', visible: false, width: 70, minWidth: 50, sortable: true, pinned: false, category: 'fundamentals' },
  { id: 'debt_equity', label: 'D/E', visible: false, width: 70, minWidth: 50, sortable: true, pinned: false, category: 'fundamentals' },
]

const COLUMN_CATEGORIES = {
  core: { label: 'Core', icon: 'Layers' },
  price: { label: 'Price & Market', icon: 'TrendingUp' },
  research: { label: 'Research', icon: 'FileText' },
  workflow: { label: 'Workflow', icon: 'GitBranch' },
  fundamentals: { label: 'Fundamentals', icon: 'Activity' },
}

// Expanded row height scales with density
const expandedRowHeightS = {
  comfortable: 320,
  compact: 280,
  ultra: 220,
  micro: 180,
} as const

function summarizeText(text: string | null | undefined, maxLength: number = 60): string {
  if (!text) return ''
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= maxLength) return cleaned
  const truncated = cleaned.substring(0, maxLength)
  const lastSpace = truncated.lastIndexOf(' ')
  return (lastSpace > maxLength * 0.7 ? truncated.substring(0, lastSpace) : truncated) + '...'
}

// ============================================================================
// Props Interface
// ============================================================================

interface AssetTableViewProps {
  assets: any[]
  isLoading?: boolean
  onAssetSelect?: (asset: any) => void
  hideViewModes?: boolean
  extraColumns?: ColumnConfig[]
  renderRowActions?: (asset: any) => React.ReactNode
  emptyState?: React.ReactNode
  storageKey?: string
  /** Bulk action callback - receives array of selected asset IDs */
  onBulkAction?: (assetIds: string[]) => void
  /** Label for bulk action button */
  bulkActionLabel?: string
  /** Icon for bulk action button */
  bulkActionIcon?: React.ReactNode
  /** Hide the entire toolbar (search, filters, view toggles) - useful for embedded tables */
  hideToolbar?: boolean
  /** Fill available height - use flex layout to fill parent container */
  fillHeight?: boolean
  /** Callback to remove asset from list (shows in right-click menu instead of delete) */
  onRemoveFromList?: (assetId: string) => void
  /** List ID for inline add functionality */
  listId?: string
  /** IDs of assets already in the list (to prevent duplicates) */
  existingAssetIds?: string[]
}

// ============================================================================
// Main Component
// ============================================================================

export function AssetTableView({
  assets,
  isLoading = false,
  onAssetSelect,
  hideViewModes = false,
  extraColumns = [],
  renderRowActions,
  emptyState,
  storageKey = 'assetsTableColumns',
  onBulkAction,
  bulkActionLabel = 'Bulk Action',
  bulkActionIcon = <Trash2 className="h-4 w-4 mr-1" />,
  hideToolbar = false,
  fillHeight = false,
  onRemoveFromList,
  listId,
  existingAssetIds = []
}: AssetTableViewProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Get asset IDs for user priority lookup
  const assetIds = useMemo(() => assets.map(a => a.id), [assets])

  // User priorities hook - fetches current user's priorities for all assets
  const { getPriority: getUserPriority, isLoading: isLoadingPriorities } = useUserAssetPriorities(assetIds)

  // Firm priorities hook - fetches aggregated firm priority (average of covering analysts)
  const { getFirmPriority } = useFirmAssetPriorities(assetIds)

  // Mutation to set user priority with optimistic updates
  const setUserPriorityMutation = useMutation({
    mutationFn: async ({ assetId, priority }: { assetId: string; priority: Priority }) => {
      if (!user?.id) throw new Error('Not authenticated')

      if (priority === 'none') {
        // Delete the priority record
        const { error } = await supabase
          .from('user_asset_priorities')
          .delete()
          .eq('asset_id', assetId)
          .eq('user_id', user.id)
        if (error) throw error
      } else {
        // Upsert the priority
        const { error } = await supabase
          .from('user_asset_priorities')
          .upsert({
            asset_id: assetId,
            user_id: user.id,
            priority,
            updated_at: new Date().toISOString()
          }, { onConflict: 'asset_id,user_id' })
        if (error) throw error
      }
    },
    onMutate: async ({ assetId, priority }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['user-asset-priorities-batch'] })

      // Snapshot all matching queries
      const queryKey = ['user-asset-priorities-batch', assetIds.sort().join(','), user?.id]
      const previousData = queryClient.getQueryData<Array<{ asset_id: string; priority: string }>>(queryKey)

      // Optimistically update the cache
      queryClient.setQueryData<Array<{ asset_id: string; priority: string }>>(queryKey, (old = []) => {
        if (priority === 'none') {
          return old.filter(p => p.asset_id !== assetId)
        }
        const existing = old.find(p => p.asset_id === assetId)
        if (existing) {
          return old.map(p => p.asset_id === assetId ? { ...p, priority } : p)
        } else {
          return [...old, { asset_id: assetId, priority }]
        }
      })

      return { previousData, queryKey }
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousData && context?.queryKey) {
        queryClient.setQueryData(context.queryKey, context.previousData)
      }
      console.error('Error setting priority:', err)
    },
    onSettled: () => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ queryKey: ['user-asset-priorities-batch'] })
    }
  })

  // Density state
  const [density, setDensity] = useState<DensityMode>(() => {
    const saved = localStorage.getItem('table-density')
    return (saved as DensityMode) || 'comfortable'
  })

  // Listen for density changes via custom event (dispatched by DensityToggle)
  useEffect(() => {
    const handleDensityChange = (e: CustomEvent<{ density: DensityMode }>) => {
      setDensity(e.detail.density)
    }
    window.addEventListener('density-change', handleDensityChange as EventListener)
    return () => window.removeEventListener('density-change', handleDensityChange as EventListener)
  }, [])

  const densityConfig = DENSITY_CONFIG[density]
  const densityRowHeight = densityConfig.rowHeight
  const expandedRowHeight = expandedRowHeightS[density]

  // Filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPriorities, setSelectedPriorities] = useState<string[]>([])
  const [selectedSectors, setSelectedSectors] = useState<string[]>([])
  const [selectedStages, setSelectedStages] = useState<string[]>([])

  // Sort state
  const [sortBy, setSortBy] = useState('updated_at')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  // UI state
  const [viewMode, setViewMode] = useState<ViewMode>('table')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set())
  const [showLivePrices, setShowLivePrices] = useState(true)

  // Column state
  const [columns, setColumns] = useState<ColumnConfig[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved) as ColumnConfig[]
        const allColumns = [...DEFAULT_COLUMNS, ...extraColumns]
        return allColumns.map(defaultCol => {
          const savedCol = parsed.find(c => c.id === defaultCol.id)
          return savedCol ? { ...defaultCol, visible: savedCol.visible, width: savedCol.width, pinned: savedCol.pinned } : defaultCol
        })
      }
    } catch (e) { console.warn('Failed to load columns:', e) }
    return [...DEFAULT_COLUMNS, ...extraColumns]
  })
  const [showColumnSettings, setShowColumnSettings] = useState(false)
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)
  const [editingCell, setEditingCell] = useState<{ assetId: string; field: 'priority' | 'stage'; x: number; y: number } | null>(null)
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingNoteValue, setEditingNoteValue] = useState('')
  const [workflowPopover, setWorkflowPopover] = useState<{ assetId: string; x: number; y: number } | null>(null)
  const [columnContextMenu, setColumnContextMenu] = useState<{ columnId: string; x: number; y: number } | null>(null)
  const [addColumnDropdown, setAddColumnDropdown] = useState<{ x: number; y: number } | null>(null)
  const [addColumnSearch, setAddColumnSearch] = useState('')
  const addColumnRef = useRef<HTMLButtonElement>(null)
  const [resizingColumn, setResizingColumn] = useState<string | null>(null)
  const [resizeStartX, setResizeStartX] = useState(0)
  const [resizeStartWidth, setResizeStartWidth] = useState(0)
  const [activeTableFilter, setActiveTableFilter] = useState<string | null>(null)

  // Row context menu state
  const [rowContextMenu, setRowContextMenu] = useState<{ assetId: string; x: number; y: number } | null>(null)

  // Grouping state
  const [groupBy, setGroupBy] = useState<GroupByOption>('none')
  const [showGroupByMenu, setShowGroupByMenu] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  // Kanban state
  const [kanbanOrganization, setKanbanOrganization] = useState<KanbanOrganization>('priority')
  const [kanbanColumnSearch, setKanbanColumnSearch] = useState<Record<string, string>>({})
  const [hiddenKanbanColumns, setHiddenKanbanColumns] = useState<Set<string>>(new Set())
  const [fullscreenKanbanColumn, setFullscreenKanbanColumn] = useState<string | null>(null)
  const [draggedAsset, setDraggedAsset] = useState<string | null>(null)

  // Tree state
  const [treeOrganization, setTreeOrganization] = useState<TreeOrganization>('sector')
  const [expandedTreeNodes, setExpandedTreeNodes] = useState<Set<string>>(new Set(['root']))

  // Refs
  const tableContainerRef = useRef<HTMLDivElement>(null)
  const columnSettingsRef = useRef<HTMLDivElement>(null)
  const groupByMenuRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Keyboard help modal state
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false)

  // Track which column triggered row expansion (for showing metric-specific details)
  const [expandedMetricColumn, setExpandedMetricColumn] = useState<{ assetId: string; columnId: string } | null>(null)

  // Asset flags for row highlighting
  const { getFlagColor, getFlagStyles, cycleFlag } = useAssetFlags()

  // AI Columns state (optional feature - wrapped in try/catch for safety)
  const aiColumnsHook = useAIColumns()
  const aiActiveColumns = aiColumnsHook?.activeColumns ?? []
  const addColumnToView = aiColumnsHook?.addColumnToView
  const isColumnInView = aiColumnsHook?.isColumnInView
  const [showAIColumnLibrary, setShowAIColumnLibrary] = useState<{ x: number; y: number } | null>(null)
  const [showCreateAIColumnModal, setShowCreateAIColumnModal] = useState(false)
  const [showQuickPrompt, setShowQuickPrompt] = useState<{ x: number; y: number } | null>(null)
  const [quickPromptColumn, setQuickPromptColumn] = useState<{ id: string; name: string; prompt: string } | null>(null)

  // Content source state (optional feature)
  const contentSourceHook = useColumnContentSource()
  const getSourceType = contentSourceHook?.getSourceType
  const hasCustomSource = contentSourceHook?.hasCustomSource ?? (() => false)
  const [contentSourceSelector, setContentSourceSelector] = useState<{
    columnId: string
    columnLabel: string
    position: { x: number; y: number }
    assetId?: string
  } | null>(null)

  // Priority column picker state (for adding priority columns from different users)
  const [priorityColumnPicker, setPriorityColumnPicker] = useState<{ x: number; y: number } | null>(null)
  const [priorityColumnPickerSearch, setPriorityColumnPickerSearch] = useState('')

  // Priority source selector state (for changing existing column's priority source)
  const [prioritySourceSelector, setPrioritySourceSelector] = useState<{
    columnId: string
    columnLabel: string
    position: { x: number; y: number }
    currentSource: PrioritySourceType
    currentUserId?: string
    currentUserName?: string
  } | null>(null)
  const [prioritySourceSearch, setPrioritySourceSearch] = useState('')

  // Fetch team members for priority column picker
  const { data: teamMembers = [] } = useQuery({
    queryKey: ['team-members'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .order('first_name')
      if (error) throw error
      return data || []
    }
  })

  // Get unique user IDs from columns that have priority source set to 'user'
  const specificPriorityUserIds = useMemo(() => {
    return [...new Set(columns.filter(c => c.prioritySource === 'user' && c.sourceUserId).map(c => c.sourceUserId!))]
  }, [columns])

  // Hooks to get specific users' priorities (for columns showing another user's priority)
  // We fetch up to 3 different users' priorities at once
  const specificUserPriority1 = useSpecificUserPriorities(assetIds, specificPriorityUserIds[0])
  const specificUserPriority2 = useSpecificUserPriorities(assetIds, specificPriorityUserIds[1])
  const specificUserPriority3 = useSpecificUserPriorities(assetIds, specificPriorityUserIds[2])

  // Create a map of userId -> getPriority function
  const specificUserPriorityMap = useMemo(() => {
    const map = new Map<string, (assetId: string) => Priority | null>()
    if (specificPriorityUserIds[0]) map.set(specificPriorityUserIds[0], specificUserPriority1.getPriority)
    if (specificPriorityUserIds[1]) map.set(specificPriorityUserIds[1], specificUserPriority2.getPriority)
    if (specificPriorityUserIds[2]) map.set(specificPriorityUserIds[2], specificUserPriority3.getPriority)
    return map
  }, [specificPriorityUserIds, specificUserPriority1.getPriority, specificUserPriority2.getPriority, specificUserPriority3.getPriority])

  // Helper function to get priority based on column configuration
  const getPriorityForColumn = useCallback((col: ColumnConfig, assetId: string): Priority | null => {
    if (col.prioritySource === 'firm') {
      return getFirmPriority(assetId)
    }
    if (col.prioritySource === 'user' && col.sourceUserId) {
      const getUserPriorityFn = specificUserPriorityMap.get(col.sourceUserId)
      return getUserPriorityFn ? getUserPriorityFn(assetId) : null
    }
    // Default to 'my' priority
    return getUserPriority(assetId)
  }, [getUserPriority, getFirmPriority, specificUserPriorityMap])

  // Merge AI columns with regular columns (only if AI columns exist)
  const allColumns = useMemo(() => {
    // Start with base columns
    if (!aiActiveColumns || aiActiveColumns.length === 0) {
      return columns
    }

    const aiCols: ColumnConfig[] = aiActiveColumns.map(c => ({
      id: `ai_${c.id}`,
      label: c.name,
      visible: c.isVisible,
      width: c.width,
      minWidth: 120,
      sortable: false,
      pinned: false,
      category: 'ai' as const,
      isCustomAI: true,
      aiColumnId: c.id,
    }))

    // Add quick prompt column if active
    if (quickPromptColumn) {
      aiCols.push({
        id: `quick_${quickPromptColumn.id}`,
        label: quickPromptColumn.name,
        visible: true,
        width: 200,
        minWidth: 120,
        sortable: false,
        pinned: false,
        category: 'ai' as const,
        isCustomAI: true,
        aiColumnId: quickPromptColumn.id,
      })
    }

    return [...columns, ...aiCols]
  }, [columns, aiActiveColumns, quickPromptColumn])

  // Market data
  const assetSymbols = useMemo(() => assets.map(a => a.symbol).filter(Boolean), [assets])
  const marketStatus = useMarketStatus()
  const { quotes, getQuote, refreshAll, isLoading: marketDataLoading } = useMarketData(
    assetSymbols,
    { refreshInterval: marketStatus.isOpen ? 30000 : 120000, enabled: showLivePrices && assetSymbols.length > 0 }
  )

  // Fetch coverage data
  const { data: coverageData } = useQuery({
    queryKey: ['asset-coverage-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coverage')
        .select(`asset_id, user_id, analyst_name, role, is_lead, is_active, team_id, org_chart_nodes:team_id (id, name)`)
        .eq('is_active', true)
      if (error) throw error
      return data || []
    },
    staleTime: 5 * 60 * 1000,
  })

  const { data: usersData } = useQuery({
    queryKey: ['users-for-coverage'],
    queryFn: async () => {
      const { data, error } = await supabase.from('users').select('id, first_name, last_name')
      if (error) throw error
      return data || []
    },
    staleTime: 10 * 60 * 1000,
  })

  const usersMap = useMemo(() => {
    if (!usersData) return new Map<string, string>()
    const map = new Map<string, string>()
    usersData.forEach(u => {
      const name = `${u.first_name || ''} ${u.last_name || ''}`.trim()
      if (name) map.set(u.id, name)
    })
    return map
  }, [usersData])

  const assetCoverageMap = useMemo(() => {
    if (!coverageData) return new Map<string, Array<{ analyst: string; team: string; isLead: boolean }>>()
    const map = new Map<string, Array<{ analyst: string; team: string; isLead: boolean }>>()
    coverageData.forEach(cov => {
      const orgChartNode = cov.org_chart_nodes as any
      const analystName = (cov.user_id && usersMap.get(cov.user_id)) || cov.analyst_name || 'Unknown'
      const teamName = orgChartNode?.name || ''
      const existing = map.get(cov.asset_id) || []
      existing.push({ analyst: analystName, team: teamName, isLead: cov.is_lead || false })
      map.set(cov.asset_id, existing)
    })
    return map
  }, [coverageData, usersMap])

  // Fetch workflow progress (only active, non-deleted workflows)
  const { data: assetWorkflowProgress } = useQuery({
    queryKey: ['asset-workflow-progress-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_workflow_progress')
        .select(`asset_id, workflow_id, is_started, is_completed, workflows:workflow_id (id, name, color, archived, deleted)`)
        .eq('is_started', true)
        .eq('is_completed', false)
      if (error) throw error
      // Filter out archived/deleted workflows
      return (data || []).filter(d => {
        const wf = d.workflows as any
        return wf && !wf.archived && !wf.deleted
      })
    },
    staleTime: 2 * 60 * 1000,
  })

  const assetWorkflowMap = useMemo(() => {
    if (!assetWorkflowProgress) return new Map<string, Array<{ id: string; name: string; color: string }>>()
    const map = new Map<string, Array<{ id: string; name: string; color: string }>>()
    assetWorkflowProgress.forEach(progress => {
      const workflow = progress.workflows as any
      if (!workflow) return
      const existing = map.get(progress.asset_id) || []
      existing.push({ id: workflow.id, name: workflow.name, color: workflow.color || '#6366f1' })
      map.set(progress.asset_id, existing)
    })
    return map
  }, [assetWorkflowProgress])

  // Fetch available workflows that user can add assets to
  const { data: availableWorkflows = [] } = useQuery({
    queryKey: ['available-workflows-for-list', user?.id],
    queryFn: async () => {
      if (!user?.id) return []

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
          color,
          status,
          created_by,
          parent_workflow_id
        `)
        .eq('status', 'active')
        .eq('archived', false)
        .eq('deleted', false)
        .not('parent_workflow_id', 'is', null) // Only branches, not templates
        .order('name', { ascending: true })

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

      // Filter to only workflows where:
      // 1. User has access (creator or stakeholder)
      // 2. Parent workflow is not archived
      const accessibleWorkflows = allBranches?.filter(w => {
        // Skip if parent is archived
        if (w.parent_workflow_id && archivedParentIds.has(w.parent_workflow_id)) return false

        if (w.created_by === user.id) return true
        if (stakeholderWorkflowIds.has(w.id)) return true
        if (w.parent_workflow_id && stakeholderWorkflowIds.has(w.parent_workflow_id)) return true
        return false
      }) || []

      return accessibleWorkflows
    },
    enabled: !!user?.id,
    staleTime: 2 * 60 * 1000
  })

  // Get unique sectors
  const sectors = useMemo(() => [...new Set(assets.map(a => a.sector).filter(Boolean))].sort(), [assets])

  // Filter and sort
  const filteredAssets = useMemo(() => {
    let filtered = assets

    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(asset =>
        asset.symbol?.toLowerCase().includes(query) ||
        asset.company_name?.toLowerCase().includes(query) ||
        asset.sector?.toLowerCase().includes(query)
      )
    }

    if (selectedPriorities.length > 0) {
      filtered = filtered.filter(a => selectedPriorities.includes(getUserPriority(a.id) || 'none'))
    }

    if (selectedSectors.length > 0) {
      filtered = filtered.filter(a => selectedSectors.includes(a.sector))
    }

    if (selectedStages.length > 0) {
      filtered = filtered.filter(a => selectedStages.includes(a.process_stage))
    }

    filtered = [...filtered].sort((a, b) => {
      let aValue: any, bValue: any
      switch (sortBy) {
        case 'symbol': aValue = a.symbol || ''; bValue = b.symbol || ''; break
        case 'current_price': aValue = Number(a.current_price) || 0; bValue = Number(b.current_price) || 0; break
        case 'priority':
          const priorityOrder = { critical: 5, high: 4, medium: 3, low: 2, none: 1 }
          const aPriority = getUserPriority(a.id) || 'none'
          const bPriority = getUserPriority(b.id) || 'none'
          aValue = priorityOrder[aPriority as keyof typeof priorityOrder] || 0
          bValue = priorityOrder[bPriority as keyof typeof priorityOrder] || 0
          break
        case 'updated_at':
        default:
          aValue = new Date(a.updated_at || 0).getTime()
          bValue = new Date(b.updated_at || 0).getTime()
          break
      }
      if (typeof aValue === 'string') return sortOrder === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue)
      return sortOrder === 'asc' ? aValue - bValue : bValue - aValue
    })

    return filtered
  }, [assets, searchQuery, selectedPriorities, selectedSectors, selectedStages, sortBy, sortOrder])

  // Grouped assets for table view
  const groupedAssets = useMemo(() => {
    if (groupBy === 'none') return null

    const groups: { key: string; label: string; color?: string; assets: any[] }[] = []
    const groupMap = new Map<string, any[]>()

    filteredAssets.forEach(asset => {
      let key: string
      switch (groupBy) {
        case 'sector': key = asset.sector || 'Uncategorized'; break
        case 'priority': key = getUserPriority(asset.id) || 'none'; break
        case 'stage': key = asset.process_stage || 'unassigned'; break
        case 'theme': key = asset.theme || 'Unassigned'; break
        default: key = 'Other'
      }
      if (!groupMap.has(key)) groupMap.set(key, [])
      groupMap.get(key)!.push(asset)
    })

    // Convert to array with labels and colors
    groupMap.forEach((assets, key) => {
      let label = key
      let color: string | undefined

      if (groupBy === 'priority') {
        const config = PRIORITY_CONFIG[key as Priority]
        label = config?.label || key
        color = config?.bg
      } else if (groupBy === 'stage') {
        const stage = PROCESS_STAGES[key]
        label = stage?.label || (key === 'unassigned' ? 'No Stage' : key)
        color = stage?.color
      }

      groups.push({ key, label, color, assets })
    })

    // Sort groups
    if (groupBy === 'priority') {
      const order = ['high', 'medium', 'low', 'none']
      groups.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
    } else {
      groups.sort((a, b) => a.label.localeCompare(b.label))
    }

    return groups
  }, [filteredAssets, groupBy])

  // Active filters
  const activeFilters = useMemo(() => {
    const filters: { type: string; value: string; label: string }[] = []
    if (searchQuery) filters.push({ type: 'search', value: searchQuery, label: `Search: "${searchQuery}"` })
    selectedPriorities.forEach(p => {
      const config = PRIORITY_CONFIG[p as Priority]
      filters.push({ type: 'priority', value: p, label: `Priority: ${config?.label || p}` })
    })
    selectedSectors.forEach(s => filters.push({ type: 'sector', value: s, label: `Sector: ${s}` }))
    selectedStages.forEach(s => {
      const stage = PROCESS_STAGES[s]
      filters.push({ type: 'stage', value: s, label: `Stage: ${stage?.label || s}` })
    })
    return filters
  }, [searchQuery, selectedPriorities, selectedSectors, selectedStages])

  // Handlers
  const handleSort = (field: string) => {
    if (sortBy === field) setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')
    else { setSortBy(field); setSortOrder('desc') }
  }

  const handleAssetClick = (asset: any) => {
    if (onAssetSelect) onAssetSelect({ id: asset.id, title: asset.symbol, type: 'asset', data: asset })
  }

  const removeFilter = (type: string, value: string) => {
    switch (type) {
      case 'search': setSearchQuery(''); break
      case 'priority': setSelectedPriorities(prev => prev.filter(p => p !== value)); break
      case 'sector': setSelectedSectors(prev => prev.filter(s => s !== value)); break
      case 'stage': setSelectedStages(prev => prev.filter(s => s !== value)); break
    }
  }

  const togglePriority = (value: string) => {
    setSelectedPriorities(prev => prev.includes(value) ? prev.filter(p => p !== value) : [...prev, value])
  }

  const toggleSector = (value: string) => {
    setSelectedSectors(prev => prev.includes(value) ? prev.filter(s => s !== value) : [...prev, value])
  }

  const toggleStage = (value: string) => {
    setSelectedStages(prev => prev.includes(value) ? prev.filter(s => s !== value) : [...prev, value])
  }

  const clearAllFilters = () => {
    setSearchQuery('')
    setSelectedPriorities([])
    setSelectedSectors([])
    setSelectedStages([])
  }

  // Selection helpers
  const toggleAssetSelection = useCallback((assetId: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setSelectedAssetIds(prev => {
      const next = new Set(prev)
      if (next.has(assetId)) next.delete(assetId)
      else next.add(assetId)
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

  const isAllSelected = useMemo(() => filteredAssets.length > 0 && filteredAssets.every(a => selectedAssetIds.has(a.id)), [filteredAssets, selectedAssetIds])
  const isSomeSelected = useMemo(() => selectedAssetIds.size > 0 && !isAllSelected, [selectedAssetIds, isAllSelected])

  // Column helpers
  const toggleColumnVisibility = useCallback((columnId: string) => {
    setColumns(prev => {
      const col = prev.find(c => c.id === columnId)
      if (!col) return prev

      // If making visible, move to end of array (after all other columns)
      if (!col.visible) {
        const withoutCol = prev.filter(c => c.id !== columnId)
        return [...withoutCol, { ...col, visible: true }]
      }

      // If hiding, just toggle in place
      return prev.map(c => c.id === columnId ? { ...c, visible: false } : c)
    })
  }, [])

  const toggleColumnPin = useCallback((columnId: string) => {
    // Simple toggle - visibleColumns memo handles the ordering
    // But respect canUnpin - if canUnpin is false and column is pinned, don't allow unpinning
    setColumns(prev => prev.map(col => {
      if (col.id !== columnId) return col
      // If trying to unpin but canUnpin is false, don't allow
      if (col.pinned && col.canUnpin === false) return col
      return { ...col, pinned: !col.pinned }
    }))
  }, [])

  const toggleColumnWrap = useCallback((columnId: string) => {
    setColumns(prev => prev.map(col => {
      if (col.id !== columnId) return col
      return { ...col, wrapText: !col.wrapText }
    }))
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

  const resetColumns = useCallback(() => setColumns([...DEFAULT_COLUMNS, ...extraColumns]), [extraColumns])

  // Add a new priority column with a specific source
  const addPriorityColumn = useCallback((source: PrioritySourceType, sourceUserId?: string, sourceUserName?: string) => {
    const columnId = source === 'user' ? `priority_${sourceUserId}` : `priority_${source}`

    // Check if this column already exists
    const existingColumn = columns.find(c => c.id === columnId)
    if (existingColumn) {
      // Just make it visible and move to end
      setColumns(prev => {
        const withoutCol = prev.filter(c => c.id !== columnId)
        return [...withoutCol, { ...existingColumn, visible: true }]
      })
      return
    }

    // Create a new column
    const label = source === 'my' ? 'My Priority'
      : source === 'firm' ? 'Firm Priority'
      : sourceUserName ? `${sourceUserName}'s Priority`
      : 'Priority'

    const newColumn: ColumnConfig = {
      id: columnId,
      label,
      visible: true,
      width: 110,
      minWidth: 80,
      sortable: true,
      pinned: false,
      category: 'research',
      prioritySource: source,
      sourceUserId: source === 'user' ? sourceUserId : undefined,
      sourceUserName: source === 'user' ? sourceUserName : undefined,
    }

    setColumns(prev => [...prev, newColumn])
  }, [columns])

  // Change an existing priority column's source
  const changePriorityColumnSource = useCallback((columnId: string, source: PrioritySourceType, sourceUserId?: string, sourceUserName?: string) => {
    // Generate the new label based on source
    const label = source === 'my' ? 'My Priority'
      : source === 'firm' ? 'Firm Priority'
      : sourceUserName ? `${sourceUserName}'s Priority`
      : 'Priority'

    setColumns(prev => prev.map(col => {
      if (col.id === columnId) {
        return {
          ...col,
          label,
          prioritySource: source,
          sourceUserId: source === 'user' ? sourceUserId : undefined,
          sourceUserName: source === 'user' ? sourceUserName : undefined,
        }
      }
      return col
    }))
  }, [])

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(columns)) }
    catch (e) { console.warn('Failed to save columns:', e) }
  }, [columns, storageKey])

  // Single row expansion - only one row can be expanded at a time
  const toggleRowExpansion = useCallback((assetId: string) => {
    setExpandedRowId(prev => prev === assetId ? null : assetId)
    // Clear metric column when collapsing
    setExpandedMetricColumn(prev => prev?.assetId === assetId ? null : prev)
  }, [])

  const toggleTreeNode = useCallback((nodeKey: string) => {
    setExpandedTreeNodes(prev => {
      const next = new Set(prev)
      if (next.has(nodeKey)) next.delete(nodeKey)
      else next.add(nodeKey)
      return next
    })
  }, [])

  const visibleColumns = useMemo(() => {
    // Pinned columns go to the left (after select), unpinned columns follow
    const selectCol = allColumns.find(c => c.id === 'select' && c.visible)
    const pinnedCols = allColumns.filter(c => c.visible && c.pinned && c.id !== 'select')
    const unpinnedCols = allColumns.filter(c => c.visible && !c.pinned && c.id !== 'select')
    const ordered = selectCol ? [selectCol, ...pinnedCols, ...unpinnedCols] : [...pinnedCols, ...unpinnedCols]

    // Scale column widths based on density
    const widthScale = densityConfig.widthScale
    return ordered.map(col => ({
      ...col,
      width: Math.round(col.width * widthScale),
      minWidth: Math.round(col.minWidth * widthScale)
    }))
  }, [allColumns, densityConfig.widthScale])

  // Hidden columns for the add column menu
  const hiddenColumns = useMemo(() => allColumns.filter(c => !c.visible && c.id !== 'select'), [allColumns])

  const totalTableWidth = useMemo(() => visibleColumns.reduce((sum, col) => sum + col.width, 0), [visibleColumns])

  // Check if any visible column has wrap text enabled
  const hasWrapTextColumn = useMemo(() => visibleColumns.some(col => col.wrapText), [visibleColumns])

  // Computed expandedRows Set for backward compatibility (now only one row at a time)
  const expandedRows = useMemo(() => {
    return expandedRowId ? new Set([expandedRowId]) : new Set<string>()
  }, [expandedRowId])

  // Version counter to force virtualizer remount on expansion/density changes (clears measurement cache)
  const [virtualizerVersion, setVirtualizerVersion] = useState(0)
  // Track pending scroll after remount
  const pendingScrollIndexRef = useRef<number | null>(null)

  // Force virtualizer remount when density changes
  const prevDensityRef = useRef(density)

  // Virtual scrolling with dynamic measurement for wrap text
  // Key includes version to force remount when collapsing (needed to clear measurement cache)
  const virtualizerKey = `${density}-${hasWrapTextColumn}-${virtualizerVersion}`
  const rowVirtualizer = useVirtualizer({
    count: filteredAssets.length,
    getScrollElement: () => tableContainerRef.current,
    // Include density and expanded state in item key to invalidate cache when these change
    getItemKey: useCallback((index: number) => {
      const asset = filteredAssets[index]
      const isExpanded = asset?.id === expandedRowId
      return `${asset?.id}-${density}-${isExpanded ? 'expanded' : 'collapsed'}`
    }, [filteredAssets, density, expandedRowId]),
    estimateSize: useCallback((index: number) => {
      const asset = filteredAssets[index]
      // Expanded rows always get fixed height
      if (expandedRows.has(asset?.id)) return expandedRowHeight
      // Wrap text rows get estimated larger height
      if (hasWrapTextColumn) return densityRowHeight * 2
      return densityRowHeight
    }, [filteredAssets, expandedRows, densityRowHeight, expandedRowHeight, hasWrapTextColumn]),
    overscan: 20,
    // Dynamic measurement only for wrap text AND non-expanded rows
    measureElement: hasWrapTextColumn ? (element) => {
      const index = element.getAttribute('data-index')
      const asset = index !== null ? filteredAssets[parseInt(index)] : null
      // Don't dynamically measure expanded rows - they use fixed expandedRowHeight
      if (asset && expandedRows.has(asset.id)) {
        return expandedRowHeight
      }
      return element.getBoundingClientRect().height
    } : undefined,
  })

  // Force virtualizer to remeasure when density changes
  useEffect(() => {
    if (prevDensityRef.current !== density) {
      prevDensityRef.current = density
      // Clear all cached measurements and force re-render
      rowVirtualizer.measure()
      setVirtualizerVersion(v => v + 1)
    }
  }, [density, rowVirtualizer])

  // Track previous expanded row to handle collapse
  const prevExpandedRowIdRef = useRef<string | null>(null)

  // Handle expansion/collapse - increment version to force clean remount
  useEffect(() => {
    const wasExpanded = prevExpandedRowIdRef.current
    prevExpandedRowIdRef.current = expandedRowId

    // Any change in expansion state (expand or collapse) should force remount
    if (expandedRowId !== wasExpanded) {
      // If expanding, set pending scroll
      if (expandedRowId) {
        const expandedIndex = filteredAssets.findIndex(a => a.id === expandedRowId)
        pendingScrollIndexRef.current = expandedIndex !== -1 ? expandedIndex : null
      }
      // Force virtualizer to recalculate all positions
      rowVirtualizer.measure()
      setVirtualizerVersion(v => v + 1)
    }
  }, [expandedRowId, filteredAssets, rowVirtualizer])

  // Handle pending scroll after virtualizer remounts
  useEffect(() => {
    if (pendingScrollIndexRef.current !== null) {
      const scrollIndex = pendingScrollIndexRef.current
      pendingScrollIndexRef.current = null
      // Use requestAnimationFrame to ensure virtualizer is ready
      requestAnimationFrame(() => {
        rowVirtualizer.scrollToIndex(scrollIndex, { align: 'start' })
      })
    }
  }, [virtualizerVersion, rowVirtualizer])

  // Convert columns for spreadsheet navigation (add editable property)
  // Filter out select column when not in selection mode since it's not rendered
  const navColumns = useMemo(() =>
    visibleColumns
      .filter(col => col.id !== 'select' || selectionMode)
      .map(col => ({
        ...col,
        editable: col.id === 'notes' || col.id === 'priority'
      })),
    [visibleColumns, selectionMode]
  )

  // Spreadsheet keyboard navigation
  const {
    focusedCell,
    isCellFocused,
    isRowFocused,
    handleCellClick,
    focusCell,
  } = useSpreadsheetNavigation({
    columns: navColumns,
    totalRows: filteredAssets.length,
    tableRef: tableContainerRef as React.RefObject<HTMLElement>,
    isEditable: (columnId) => columnId === 'notes' || columnId === 'priority',
    onRowSelect: (rowIndex, addToSelection) => {
      const asset = filteredAssets[rowIndex]
      if (asset) toggleAssetSelection(asset.id)
    },
    onSelectAll: selectAllFiltered,
    scrollToRow: (rowIndex) => {
      // Only scroll if row is outside the visible range (with some buffer)
      const virtualItems = rowVirtualizer.getVirtualItems()
      if (virtualItems.length === 0) return
      const firstVisible = virtualItems[0]?.index ?? 0
      const lastVisible = virtualItems[virtualItems.length - 1]?.index ?? 0
      // Add buffer of 2 rows - only scroll if actually out of view
      if (rowIndex < firstVisible + 2 || rowIndex > lastVisible - 2) {
        rowVirtualizer.scrollToIndex(rowIndex, { align: 'auto' })
      }
    },
  })

  // Get focused asset for quick actions
  const focusedAsset = focusedCell ? filteredAssets[focusedCell.rowIndex] : null

  // Ref for inline add input (for keyboard navigation)
  const inlineAddInputRef = useRef<HTMLInputElement>(null)

  // Track if we're at the last row for arrow navigation
  const isAtLastRow = focusedCell && focusedCell.rowIndex === filteredAssets.length - 1

  // Handle arrow down at last row to focus inline add input
  useEffect(() => {
    if (!listId) return // Only if inline add is enabled

    const handleArrowDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isInInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'

      // Arrow down from last row -> focus inline add input
      if (e.key === 'ArrowDown' && !isInInput && isAtLastRow) {
        e.preventDefault()
        e.stopImmediatePropagation() // Stop other listeners
        inlineAddInputRef.current?.focus()
        focusCell(null) // Clear table focus
      }
    }

    // Use capture phase to run before spreadsheet navigation
    window.addEventListener('keydown', handleArrowDown, true)
    return () => window.removeEventListener('keydown', handleArrowDown, true)
  }, [listId, isAtLastRow, focusCell])

  // Callback for when user presses up arrow in inline add row
  const handleInlineAddExitUp = useCallback(() => {
    if (filteredAssets.length > 0) {
      const lastRowIndex = filteredAssets.length - 1
      focusCell({ rowIndex: lastRowIndex, columnId: 'ticker' })
      rowVirtualizer.scrollToIndex(lastRowIndex, { align: 'auto' })
    }
  }, [filteredAssets.length, focusCell, rowVirtualizer])

  // State for inline insert - stores the row index for visual positioning and the list item ID for stable targeting
  const [insertAboveRow, setInsertAboveRow] = useState<number | null>(null)
  const [insertTargetId, setInsertTargetId] = useState<string | null>(null) // The _listItemId of the target row
  const insertTargetIdRef = useRef<string | null>(null) // Ref to always have latest value in callbacks
  const insertInputRef = useRef<HTMLInputElement>(null)

  // Keep ref in sync with state
  useEffect(() => {
    insertTargetIdRef.current = insertTargetId
  }, [insertTargetId])

  // Open insert mode - triggered by Ctrl+I
  const openInsertAbove = useCallback(() => {
    if (!focusedCell || !listId) return
    const targetAsset = filteredAssets[focusedCell.rowIndex]
    const targetId = targetAsset?._listItemId || null
    setInsertAboveRow(focusedCell.rowIndex)
    setInsertTargetId(targetId)
    insertTargetIdRef.current = targetId // Set ref immediately for callback use
  }, [focusedCell, listId, filteredAssets])

  // Focus insert input when it opens
  useEffect(() => {
    if (insertAboveRow !== null && insertInputRef.current) {
      insertInputRef.current.focus()
    }
  }, [insertAboveRow])


  // Handle insert cancellation - focus on the row below the insert position (the next row)
  const cancelInsertAbove = useCallback(() => {
    const rowToFocus = insertAboveRow
    setInsertAboveRow(null)
    setInsertTargetId(null)
    insertTargetIdRef.current = null // Reset ref as well
    // Focus the row below the insert position so user can continue navigating
    // The insert appears below insertAboveRow, so focus insertAboveRow + 1 (or stay on insertAboveRow if at end)
    if (rowToFocus !== null) {
      const nextRow = Math.min(rowToFocus + 1, filteredAssets.length - 1)
      setTimeout(() => {
        focusCell({ rowIndex: nextRow, columnId: 'ticker' })
      }, 0)
    }
  }, [insertAboveRow, focusCell, filteredAssets.length])

  // Handle insert below completion - keeps insert mode open for continued adding
  const handleInsertAbove = useCallback(async (assetId: string, symbol: string): Promise<boolean> => {
    // Use ref to always get the latest target ID (avoids stale closure issues)
    const currentTargetId = insertTargetIdRef.current
    if (currentTargetId === null || !listId) return false

    try {
      // Query the target's current sort_order and find the next item's sort_order
      const { data: allItems } = await supabase
        .from('asset_list_items')
        .select('id, sort_order')
        .eq('list_id', listId)
        .order('sort_order', { ascending: true })

      let targetSortOrder = 0
      let nextSortOrder = 100
      let targetFound = false

      if (allItems && allItems.length > 0) {
        // Find the target item by ID
        const targetIndex = allItems.findIndex(i => i.id === currentTargetId)
        console.log('Insert search:', {
          currentTargetId,
          targetIndex,
          allItemIds: allItems.map(i => i.id),
          allSortOrders: allItems.map(i => i.sort_order)
        })
        if (targetIndex !== -1) {
          targetFound = true
          targetSortOrder = allItems[targetIndex].sort_order ?? 0
          // Find the next item (the one right after target in sort order)
          const nextItem = allItems[targetIndex + 1]
          nextSortOrder = nextItem?.sort_order ?? (targetSortOrder + 100)
        } else {
          // Target not found - insert at the end of the list
          const lastItem = allItems[allItems.length - 1]
          targetSortOrder = lastItem.sort_order ?? 0
          nextSortOrder = targetSortOrder + 100
          console.warn('Insert target not found, appending to end')
        }
      }

      // Calculate new sort_order (between target and next, so it appears below target)
      let newSortOrder: number
      // Insert between target and next
      newSortOrder = Math.floor((targetSortOrder + nextSortOrder) / 2)
      if (newSortOrder <= targetSortOrder) {
        newSortOrder = targetSortOrder + 1
      }

      // Ensure we have a valid sort_order
      if (newSortOrder <= 0) newSortOrder = targetSortOrder + 1
      if (newSortOrder <= 0) newSortOrder = 1

      console.log('Insert below:', {
        currentTargetId,
        targetFound,
        targetSortOrder,
        nextSortOrder,
        newSortOrder
      })

      // Insert the new item and get its ID
      const { data: insertedData, error } = await supabase
        .from('asset_list_items')
        .insert({
          list_id: listId,
          asset_id: assetId,
          added_by: user?.id,
          sort_order: newSortOrder
        })
        .select('id')
        .single()

      if (error) throw error

      // Update insertTargetId to the newly inserted item so next insert goes below it
      // Update BOTH ref and state - ref for immediate use, state for React sync
      if (insertedData?.id) {
        insertTargetIdRef.current = insertedData.id // Update ref immediately
        setInsertTargetId(insertedData.id) // Update state for React
      }

      queryClient.invalidateQueries({ queryKey: ['asset-list-items', listId] })
      queryClient.invalidateQueries({ queryKey: ['asset-lists'] })

      return true
    } catch (e) {
      console.error('Insert failed:', e)
      return false
    }
  }, [listId, user?.id, queryClient]) // Uses insertTargetIdRef instead of insertTargetId to avoid stale closures

  // Note editing function (defined before useEffect that uses it)
  const startEditingNote = useCallback((assetId: string, currentNote: string) => {
    setEditingNoteId(assetId)
    setEditingNoteValue(currentNote || '')
  }, [])

  // Keyboard shortcuts for quick actions (p, n, e, f, /, ?, Enter)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if in an input/textarea
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

      // Handle Enter separately (expand row with metric-specific details)
      if (e.key === 'Enter' && focusedCell && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        const asset = filteredAssets[focusedCell.rowIndex]
        if (asset) {
          const isCurrentlyExpanded = expandedRows.has(asset.id)
          const isSameMetric = expandedMetricColumn?.assetId === asset.id && expandedMetricColumn?.columnId === focusedCell.columnId

          if (isCurrentlyExpanded && isSameMetric) {
            // Collapse if same cell pressed again
            toggleRowExpansion(asset.id)
            setExpandedMetricColumn(null)
          } else {
            // Expand row and set metric column
            if (!isCurrentlyExpanded) {
              toggleRowExpansion(asset.id)
            }
            setExpandedMetricColumn({ assetId: asset.id, columnId: focusedCell.columnId })
          }
        }
        return
      }

      // Handle Escape to close expanded row or exit insert mode
      if (e.key === 'Escape') {
        if (insertAboveRow !== null) {
          e.preventDefault()
          setInsertAboveRow(null)
          return
        }
        if (expandedMetricColumn) {
          e.preventDefault()
          toggleRowExpansion(expandedMetricColumn.assetId)
          setExpandedMetricColumn(null)
          return
        }
        // Also close if focused cell is on an expanded row
        if (focusedCell && expandedRowId) {
          const focusedAsset = filteredAssets[focusedCell.rowIndex]
          if (focusedAsset?.id === expandedRowId) {
            e.preventDefault()
            toggleRowExpansion(expandedRowId)
            return
          }
        }
      }

      // Handle Ctrl+I for insert above (in list view)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i' && listId && focusedCell) {
        e.preventDefault()
        openInsertAbove()
        return
      }

      // Prevent if modifier keys (except for ? which needs shift)
      if (e.metaKey || e.ctrlKey || e.altKey) return

      switch (e.key.toLowerCase()) {
        case 'p': // Open priority picker
          if (focusedAsset) {
            e.preventDefault()
            setEditingCell({ assetId: focusedAsset.id, field: 'priority' })
          }
          break

        case 'n': // Edit note
          if (focusedAsset) {
            e.preventDefault()
            startEditingNote(focusedAsset.id, focusedAsset.quick_note || '')
          }
          break

        case 'e': // Expand/collapse row
          if (focusedAsset) {
            e.preventDefault()
            toggleRowExpansion(focusedAsset.id)
          }
          break

        case 'f': // Cycle flag color
          if (focusedAsset) {
            e.preventDefault()
            cycleFlag(focusedAsset.id)
          }
          break


        case '/': // Focus search
          e.preventDefault()
          searchInputRef.current?.focus()
          break

        case '?': // Show keyboard help
          if (e.shiftKey) {
            e.preventDefault()
            setShowKeyboardHelp(true)
          }
          break

        // Number keys 1-9 for saved views (placeholder)
        case '1': case '2': case '3': case '4': case '5':
        case '6': case '7': case '8': case '9':
          // Reserved for saved views
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [focusedAsset, focusedCell, expandedMetricColumn, expandedRows, expandedRowId, filteredAssets, cycleFlag, startEditingNote, toggleRowExpansion, listId, openInsertAbove, insertAboveRow])

  // Quick edit mutation
  const quickEditMutation = useMutation({
    mutationFn: async ({ assetId, field, value }: { assetId: string; field: string; value: string }) => {
      const { error } = await supabase.from('assets').update({ [field]: value, updated_at: new Date().toISOString() }).eq('id', assetId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-assets'] })
      queryClient.invalidateQueries({ queryKey: ['asset-list-items'] })
      setEditingCell(null)
    }
  })

  // Delete asset mutation
  const deleteAssetMutation = useMutation({
    mutationFn: async (assetId: string) => {
      const { error } = await supabase.from('assets').delete().eq('id', assetId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-assets'] })
      queryClient.invalidateQueries({ queryKey: ['asset-list-items'] })
      setRowContextMenu(null)
    }
  })

  // Join workflow mutation - adds asset to a workflow
  const joinWorkflowMutation = useMutation({
    mutationFn: async ({ assetId, workflowId }: { assetId: string; workflowId: string }) => {
      if (!user?.id) throw new Error('Not authenticated')

      // Record as an 'add' override - the trigger will handle creating asset_workflow_progress
      const { error } = await supabase
        .from('workflow_universe_overrides')
        .upsert({
          workflow_id: workflowId,
          asset_id: assetId,
          override_type: 'add',
          created_by: user.id
        }, {
          onConflict: 'workflow_id,asset_id'
        })

      if (error) throw error
      return { assetId, workflowId }
    },
    onMutate: async ({ assetId, workflowId }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['asset-workflow-progress-all'] })

      // Get the workflow info from availableWorkflows
      const workflow = availableWorkflows.find(w => w.id === workflowId)
      if (!workflow) return

      // Snapshot previous value
      const previousData = queryClient.getQueryData(['asset-workflow-progress-all'])

      // Optimistically update assetWorkflowProgress
      queryClient.setQueryData(['asset-workflow-progress-all'], (old: any[] = []) => {
        return [...old, {
          asset_id: assetId,
          workflow_id: workflowId,
          is_started: true,
          is_completed: false,
          workflows: { id: workflow.id, name: workflow.name, color: workflow.color || '#6366f1', archived: false, deleted: false }
        }]
      })

      return { previousData }
    },
    onError: (err, variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(['asset-workflow-progress-all'], context.previousData)
      }
      console.error('Error joining workflow:', err)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-workflow-progress-all'] })
      setWorkflowPopover(null)
    }
  })

  // Note editing helper functions
  const cancelNoteEdit = useCallback(() => {
    setEditingNoteId(null)
    setEditingNoteValue('')
  }, [])

  const saveNote = useCallback((assetId: string) => {
    quickEditMutation.mutate({ assetId, field: 'quick_note', value: editingNoteValue })
    setEditingNoteId(null)
    setEditingNoteValue('')
  }, [editingNoteValue, quickEditMutation])

  // Kanban drag handlers
  const handleKanbanDragStart = useCallback((assetId: string) => setDraggedAsset(assetId), [])
  const handleKanbanDragOver = useCallback((e: React.DragEvent) => e.preventDefault(), [])
  const handleKanbanDrop = useCallback((targetPriority: string) => {
    if (draggedAsset && kanbanOrganization === 'priority') {
      quickEditMutation.mutate({ assetId: draggedAsset, field: 'priority', value: targetPriority })
    }
    setDraggedAsset(null)
  }, [draggedAsset, kanbanOrganization, quickEditMutation])

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (columnSettingsRef.current && !columnSettingsRef.current.contains(e.target as Node)) setShowColumnSettings(false)
      if (groupByMenuRef.current && !groupByMenuRef.current.contains(e.target as Node)) setShowGroupByMenu(false)
      // Close column context menu if clicking outside
      if (columnContextMenu) {
        const target = e.target as HTMLElement
        if (!target.closest('.column-context-menu')) {
          setColumnContextMenu(null)
        }
      }
      // Close table filter dropdown if clicking outside
      if (activeTableFilter) {
        const target = e.target as HTMLElement
        if (!target.closest('.table-filter-dropdown')) {
          setActiveTableFilter(null)
        }
      }
      // Close workflow popover if clicking outside
      if (workflowPopover) {
        const target = e.target as HTMLElement
        if (!target.closest('.workflow-popover')) {
          setWorkflowPopover(null)
        }
      }
      // Close row context menu if clicking outside
      if (rowContextMenu) {
        const target = e.target as HTMLElement
        if (!target.closest('.row-context-menu')) {
          setRowContextMenu(null)
        }
      }
      // Close add column dropdown if clicking outside (handled by portal click handler)
      if (addColumnDropdown) {
        const target = e.target as HTMLElement
        if (!target.closest('.add-column-dropdown') && !target.closest('[data-add-column-btn]')) {
          setAddColumnDropdown(null)
          setAddColumnSearch('')
        }
      }
      // Close priority column picker if clicking outside
      if (priorityColumnPicker) {
        const target = e.target as HTMLElement
        if (!target.closest('.priority-column-picker')) {
          setPriorityColumnPicker(null)
          setPriorityColumnPickerSearch('')
        }
      }
      // Close priority source selector if clicking outside
      if (prioritySourceSelector) {
        const target = e.target as HTMLElement
        if (!target.closest('.priority-source-selector')) {
          setPrioritySourceSelector(null)
          setPrioritySourceSearch('')
        }
      }
    }
    if (showColumnSettings || showGroupByMenu || columnContextMenu || activeTableFilter || workflowPopover || rowContextMenu || addColumnDropdown || priorityColumnPicker || prioritySourceSelector) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showColumnSettings, showGroupByMenu, columnContextMenu, activeTableFilter, workflowPopover, rowContextMenu, addColumnDropdown, priorityColumnPicker, prioritySourceSelector])

  // Render metric detail expansion panel
  const renderMetricDetail = useCallback((asset: any, columnId: string, quote: any, coverage: any[], workflows: any[]) => {
    // Widget card wrapper for consistent styling
    const WidgetCard = ({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) => (
      <div className={clsx('bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden', className)}>
        <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
          <h5 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{title}</h5>
        </div>
        <div className="p-3">{children}</div>
      </div>
    )

    switch (columnId) {
      case 'price':
        return (
          <div className="flex gap-4 h-full">
            {/* Price Chart Widget */}
            <WidgetCard title="Price Chart" className="flex-1">
              <MiniChart symbol={asset.symbol} height={120} days={30} showPrice={false} showChange={false} />
            </WidgetCard>
            {/* Price Details Widget */}
            <WidgetCard title="Price Details" className="w-48">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Current</span>
                  <span className="font-mono font-semibold text-sm">{formatPrice(quote?.price || asset.current_price)}</span>
                </div>
                {quote?.changePercent !== undefined && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Change</span>
                    <span className={clsx('font-mono font-medium text-sm', quote.changePercent >= 0 ? 'text-green-600' : 'text-red-600')}>
                      {formatPriceChange(quote.changePercent)}
                    </span>
                  </div>
                )}
                {quote?.high && quote?.low && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">High</span>
                      <span className="font-mono text-sm text-green-600">{formatPrice(quote.high)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Low</span>
                      <span className="font-mono text-sm text-red-600">{formatPrice(quote.low)}</span>
                    </div>
                  </>
                )}
                {quote?.volume && (
                  <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                    <span className="text-xs text-gray-500">Volume</span>
                    <span className="font-mono text-sm">{(quote.volume / 1000000).toFixed(2)}M</span>
                  </div>
                )}
              </div>
            </WidgetCard>
          </div>
        )

      case 'ticker':
      case 'companyName':
        return (
          <div className="flex gap-4 h-full">
            {/* Company Info Widget */}
            <WidgetCard title="Company Profile" className="flex-1">
              <div className="space-y-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg font-bold text-gray-900">{asset.symbol}</span>
                    <span className="text-sm text-gray-500">•</span>
                    <span className="text-sm font-medium text-gray-700">{asset.company_name}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    {asset.sector && <span className="px-2 py-0.5 bg-gray-100 rounded">{asset.sector}</span>}
                    {asset.industry && <span className="px-2 py-0.5 bg-gray-100 rounded">{asset.industry}</span>}
                  </div>
                </div>
                {asset.description ? (
                  <p className="text-sm text-gray-600 leading-relaxed line-clamp-4">{asset.description}</p>
                ) : (
                  <p className="text-sm text-gray-400 italic">No company description available</p>
                )}
              </div>
            </WidgetCard>
            {/* Quick Stats Widget */}
            <WidgetCard title="Key Stats" className="w-48">
              <div className="space-y-2">
                {asset.market_cap && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Market Cap</span>
                    <span className="font-mono text-sm">{formatPrice(asset.market_cap)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Stage</span>
                  <span className="text-sm">{asset.process_stage || '—'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Priority</span>
                  <span className="text-sm">{getUserPriority(asset.id) || 'None'}</span>
                </div>
                {coverage.length > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Coverage</span>
                    <span className="text-sm">{coverage.length} analyst{coverage.length !== 1 ? 's' : ''}</span>
                  </div>
                )}
              </div>
            </WidgetCard>
          </div>
        )

      case 'thesis':
      case 'bull_case':
      case 'bear_case':
      case 'base_case':
      case 'where_different':
      case 'risks_to_thesis':
        const fieldMap: Record<string, { label: string; field: keyof typeof asset }> = {
          thesis: { label: 'Investment Thesis', field: 'thesis' },
          bull_case: { label: 'Bull Case', field: 'bull_case' },
          bear_case: { label: 'Bear Case', field: 'bear_case' },
          base_case: { label: 'Base Case', field: 'base_case' },
          where_different: { label: 'Differentiated View', field: 'where_different' },
          risks_to_thesis: { label: 'Key Risks', field: 'risks_to_thesis' }
        }
        const fieldInfo = fieldMap[columnId]
        const fieldValue = asset[fieldInfo.field]
        return (
          <div className="flex gap-4 h-full">
            <WidgetCard title={fieldInfo.label} className="flex-1">
              <div className="h-full flex flex-col">
                {fieldValue ? (
                  <p className="text-sm text-gray-700 leading-relaxed flex-1 overflow-auto">{fieldValue}</p>
                ) : (
                  <p className="text-sm text-gray-400 italic">No {fieldInfo.label.toLowerCase()} documented yet</p>
                )}
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <button
                    onClick={() => handleAssetClick(asset)}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                  >
                    Edit on Asset Page
                    <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </WidgetCard>
            {/* Mini Chart */}
            <WidgetCard title="Price" className="w-56">
              <MiniChart symbol={asset.symbol} height={80} days={14} />
            </WidgetCard>
          </div>
        )

      case 'coverage':
        return (
          <div className="flex gap-4 h-full">
            <WidgetCard title="Analyst Coverage" className="flex-1">
              {coverage.length === 0 ? (
                <p className="text-sm text-gray-400 italic">No coverage assigned</p>
              ) : (
                <div className="space-y-2">
                  {coverage.map((analyst, idx) => (
                    <div key={idx} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                      <span className="text-sm font-medium text-gray-900">{analyst.analyst}</span>
                      {analyst.isLead && (
                        <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700 rounded">Lead</span>
                      )}
                      {analyst.team && <span className="text-xs text-gray-400">• {analyst.team}</span>}
                    </div>
                  ))}
                </div>
              )}
            </WidgetCard>
          </div>
        )

      case 'workflows':
        return (
          <div className="flex gap-4 h-full">
            <WidgetCard title="Active Workflows" className="flex-1">
              {workflows.length === 0 ? (
                <p className="text-sm text-gray-400 italic">No active workflows</p>
              ) : (
                <div className="space-y-2">
                  {workflows.map((wf, idx) => (
                    <div key={idx} className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: wf.color }} />
                      <span className="text-sm font-medium text-gray-900">{wf.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </WidgetCard>
          </div>
        )

      case 'priority':
        const currentPriority = getUserPriority(asset.id)
        return (
          <div className="flex gap-4 h-full">
            <WidgetCard title="Set Priority" className="w-64">
              <div className="space-y-1.5">
                {PRIORITY_OPTIONS.map(priority => {
                  const config = PRIORITY_CONFIG[priority]
                  const IconComponent = config.icon
                  const isSelected = currentPriority === priority || (!currentPriority && priority === 'none')

                  return (
                    <button
                      key={priority}
                      onClick={() => {
                        setUserPriorityMutation.mutate({ assetId: asset.id, priority })
                        setExpandedMetricColumn(null)
                        toggleRowExpansion(asset.id)
                      }}
                      className={clsx(
                        'w-full px-3 py-2 rounded-lg text-sm font-medium transition-all text-white flex items-center gap-2',
                        config.bg,
                        isSelected ? 'ring-2 ring-offset-2 ring-blue-400' : 'opacity-70 hover:opacity-100'
                      )}
                    >
                      <IconComponent className="w-4 h-4" />
                      <span>{config.label}</span>
                      {isSelected && <Check className="w-4 h-4 ml-auto" />}
                    </button>
                  )
                })}
              </div>
            </WidgetCard>
          </div>
        )

      case 'notes':
        return (
          <div className="flex gap-4 h-full">
            <WidgetCard title="Quick Note" className="flex-1">
              <div className="h-full flex flex-col">
                {asset.quick_note ? (
                  <p className="text-sm text-gray-700 leading-relaxed flex-1 italic">"{asset.quick_note}"</p>
                ) : (
                  <p className="text-sm text-gray-400 italic">No quick note</p>
                )}
              </div>
            </WidgetCard>
          </div>
        )

      default:
        return (
          <div className="flex gap-4 h-full">
            <WidgetCard title="Details" className="flex-1">
              <p className="text-sm text-gray-400 italic">No additional details for this column</p>
            </WidgetCard>
          </div>
        )
    }
  }, [getUserPriority, setUserPriorityMutation, handleAssetClick, toggleRowExpansion])

  // Column resizing handlers
  const handleResizeStart = useCallback((e: React.MouseEvent, columnId: string, currentWidth: number) => {
    e.preventDefault()
    e.stopPropagation()
    setResizingColumn(columnId)
    setResizeStartX(e.clientX)
    setResizeStartWidth(currentWidth)
  }, [])

  useEffect(() => {
    if (!resizingColumn) return

    const widthScale = densityConfig.widthScale
    const handleMouseMove = (e: MouseEvent) => {
      const diff = e.clientX - resizeStartX
      const newScaledWidth = Math.max(50 * widthScale, resizeStartWidth + diff)
      // Store unscaled width so it can be properly rescaled when density changes
      const newBaseWidth = Math.round(newScaledWidth / widthScale)
      setColumns(prev => prev.map(col => col.id === resizingColumn ? { ...col, width: newBaseWidth } : col))
    }

    const handleMouseUp = () => {
      setResizingColumn(null)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [resizingColumn, resizeStartX, resizeStartWidth, densityConfig.widthScale])

  // Reset column widths
  const resetColumnWidths = useCallback(() => {
    setColumns(prev => prev.map(col => {
      const defaultCol = DEFAULT_COLUMNS.find(d => d.id === col.id)
      return defaultCol ? { ...col, width: defaultCol.width } : col
    }))
  }, [])

  // Kanban columns
  const kanbanColumns = useMemo(() => {
    switch (kanbanOrganization) {
      case 'priority':
        return PRIORITY_OPTIONS.map(priority => {
          const config = PRIORITY_CONFIG[priority]
          return {
            key: priority, label: config.label, color: `${config.bg} text-white`,
            assets: filteredAssets.filter(a => (getUserPriority(a.id) || 'none') === priority)
          }
        })
      case 'stage':
        return Object.entries(PROCESS_STAGES).map(([key, stage]) => ({
          key, label: stage.label, color: stage.color,
          assets: filteredAssets.filter(a => a.process_stage === key)
        })).concat([{
          key: 'unassigned', label: 'No Stage', color: 'bg-gray-100 text-gray-600',
          assets: filteredAssets.filter(a => !a.process_stage)
        }])
      case 'workflow':
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
          key: wf.id, label: wf.name, color: 'bg-opacity-20 text-gray-800', bgColor: wf.color, assets: wf.assets
        }))
      default:
        return []
    }
  }, [kanbanOrganization, filteredAssets, assetWorkflowMap])

  // Tree data
  const treeData = useMemo(() => {
    if (viewMode !== 'tree') return null
    const root: { name: string; children: Map<string, any>; assets: any[] } = { name: 'All Assets', children: new Map(), assets: [] }

    filteredAssets.forEach(asset => {
      let groupKey: string
      switch (treeOrganization) {
        case 'sector': groupKey = asset.sector || 'Uncategorized'; break
        case 'priority': groupKey = getUserPriority(asset.id) || 'none'; break
        case 'theme': groupKey = asset.theme || 'Unassigned'; break
        default: groupKey = asset.sector || 'Other'
      }

      if (!root.children.has(groupKey)) root.children.set(groupKey, { name: groupKey, children: new Map(), assets: [] })
      root.children.get(groupKey)!.assets.push(asset)
    })

    return root
  }, [viewMode, treeOrganization, filteredAssets])

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className={clsx(
      fillHeight ? 'h-full flex flex-col' : 'space-y-4'
    )}>
      {/* Compact Toolbar */}
      {!hideToolbar && (
      <div className={clsx('flex items-center gap-3 pb-3', fillHeight && 'flex-shrink-0')}>
        {/* Search - compact */}
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search... (press /)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-8 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-gray-50/50"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Density toggle - next to search */}
        {viewMode === 'table' && <DensityToggle />}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right side controls */}
        <div className="flex items-center gap-1">
          {/* Select mode */}
          <button
            onClick={() => selectionMode ? clearSelection() : setSelectionMode(true)}
            className={clsx(
              'p-1.5 rounded-md transition-colors',
              selectionMode ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
            )}
            title={selectionMode ? 'Cancel selection' : 'Select assets'}
          >
            <CheckSquare className="w-4 h-4" />
          </button>

          {/* Group by */}
          {viewMode === 'table' && (
            <div className="relative" ref={groupByMenuRef}>
              <button
                onClick={() => setShowGroupByMenu(!showGroupByMenu)}
                className={clsx(
                  'p-1.5 rounded-md transition-colors',
                  groupBy !== 'none' ? 'text-purple-600 bg-purple-50' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                )}
                title="Group by"
              >
                <Layers className="w-4 h-4" />
              </button>
              {showGroupByMenu && (
                <div className="absolute right-0 top-full mt-1 w-40 bg-white rounded-lg shadow-lg border border-gray-200 z-50 py-1">
                  {GROUP_BY_OPTIONS.map(option => (
                    <button key={option.value}
                      onClick={() => { setGroupBy(option.value); setShowGroupByMenu(false); setCollapsedGroups(new Set()) }}
                      className={clsx('w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 hover:bg-gray-50',
                        groupBy === option.value && 'bg-purple-50 text-purple-700'
                      )}
                    >
                      <option.icon className="w-3.5 h-3.5" />
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Column settings */}
          {viewMode === 'table' && (
            <div className="relative" ref={columnSettingsRef}>
              <button
                onClick={() => setShowColumnSettings(!showColumnSettings)}
                className={clsx(
                  'p-1.5 rounded-md transition-colors',
                  showColumnSettings ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                )}
                title="Column settings"
              >
                <Settings2 className="w-4 h-4" />
              </button>
              {showColumnSettings && (
                <div className="absolute right-0 top-full mt-1 w-64 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
                  <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-700">Columns</span>
                    <button onClick={resetColumns} className="text-xs text-blue-600 hover:text-blue-700">Reset</button>
                  </div>
                  <div className="p-1.5 max-h-64 overflow-y-auto">
                    {columns.filter(col => col.id !== 'select').map((col) => (
                      <div key={col.id} className="flex items-center gap-2 py-1.5 px-2 hover:bg-gray-50 rounded"
                        draggable onDragStart={() => setDraggedColumn(col.id)} onDragOver={(e) => e.preventDefault()}
                        onDrop={() => draggedColumn && reorderColumns(draggedColumn, col.id)}
                      >
                        <GripVertical className="w-3 h-3 text-gray-300 cursor-grab" />
                        <button onClick={() => toggleColumnVisibility(col.id)} className="text-gray-400 hover:text-gray-600">
                          {col.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        </button>
                        <span className={clsx('text-xs flex-1', col.visible ? 'text-gray-700' : 'text-gray-400')}>{col.label}</span>
                        {/* Hide pin toggle for columns that can't be unpinned */}
                        {(col.canUnpin !== false || !col.pinned) ? (
                          <button onClick={() => toggleColumnPin(col.id)} className={clsx('text-gray-400 hover:text-gray-600', col.pinned && 'text-blue-600')}>
                            <Pin className="w-3 h-3" />
                          </button>
                        ) : (
                          <Pin className="w-3 h-3 text-blue-600 opacity-50" title="This column cannot be unpinned" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Divider */}
          <div className="h-4 w-px bg-gray-200 mx-1" />

          {/* View mode toggle */}
          {!hideViewModes && (
            <div className="flex items-center bg-gray-100 rounded-md p-0.5">
              <button onClick={() => setViewMode('table')} className={clsx('p-1 rounded', viewMode === 'table' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500')} title="Table view">
                <Table2 className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setViewMode('kanban')} className={clsx('p-1 rounded', viewMode === 'kanban' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500')} title="Kanban view">
                <Columns3 className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setViewMode('tree')} className={clsx('p-1 rounded', viewMode === 'tree' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500')} title="Tree view">
                <FolderTree className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
      )}

      {/* Active Filters - compact */}
      {!hideToolbar && activeFilters.length > 0 && (
        <div className="flex items-center gap-1.5 pb-2 flex-wrap">
          {activeFilters.map((filter, idx) => (
            <span key={`${filter.type}-${filter.value}-${idx}`} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full">
              {filter.label}
              <button onClick={() => removeFilter(filter.type, filter.value)} className="hover:text-blue-900"><X className="w-3 h-3" /></button>
            </span>
          ))}
          <button onClick={clearAllFilters} className="text-xs text-gray-500 hover:text-gray-700 ml-1">Clear</button>
        </div>
      )}

      {/* Selection Actions - compact */}
      {!hideToolbar && selectionMode && selectedAssetIds.size > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-100 rounded-md mb-2">
          <span className="text-xs font-medium text-blue-700">{selectedAssetIds.size} selected</span>
          {onBulkAction && (
            <button
              onClick={() => onBulkAction(Array.from(selectedAssetIds))}
              className="text-xs text-blue-700 hover:text-blue-900 font-medium"
            >
              {bulkActionLabel}
            </button>
          )}
          <button onClick={clearSelection} className="text-xs text-blue-600 hover:text-blue-800 ml-auto">
            Clear
          </button>
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <Card padding="none" className={fillHeight ? 'flex-1 flex items-center justify-center' : ''}>
          {fillHeight ? (
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
          ) : (
            <div className="p-6"><ListSkeleton count={5} /></div>
          )}
        </Card>
      ) : filteredAssets.length > 0 ? (
        <>
          {/* TABLE VIEW */}
          {viewMode === 'table' && groupBy === 'none' && (
            <Card padding="none" className={clsx('overflow-hidden pro-table', fillHeight && 'flex-1 min-h-0 flex flex-col', `density-${density}`)}>
              <div ref={tableContainerRef} className={clsx('pro-table-container overflow-auto', fillHeight && 'flex-1')}>
                {/* Header */}
                <div className="pro-table-header" style={{ minWidth: totalTableWidth + (hiddenColumns.length > 0 ? 40 : 0) }}>
                  <div className="flex items-center">
                    {visibleColumns.map((col, colIndex) => {
                      if (col.id === 'select' && !selectionMode) return null
                      const isPinned = col.pinned || col.id === 'select' // Select column is always "pinned" to left
                      // Calculate left offset: sum of all columns before this one that are pinned (or select)
                      const leftOffset = isPinned
                        ? visibleColumns.slice(0, colIndex).filter(c => (c.pinned || c.id === 'select') && (c.id !== 'select' || selectionMode)).reduce((sum, c) => sum + c.width, 0)
                        : 0
                      const sortField = col.id === 'ticker' ? 'symbol' : col.id === 'companyName' ? 'company_name' : col.id === 'price' ? 'current_price' : col.id === 'updated' ? 'updated_at' : col.id
                      const isSorted = sortBy === sortField
                      const isDragOver = dragOverColumn === col.id && draggedColumn !== col.id
                      // Check if this is the last pinned column for shadow - find actual last pinned column by ID
                      const lastPinnedCol = [...visibleColumns].reverse().find(c =>
                        (c.pinned || c.id === 'select') && (c.id !== 'select' || selectionMode)
                      )
                      const isLastPinned = isPinned && col.id === lastPinnedCol?.id

                      return (
                        <div
                          key={col.id}
                          draggable={col.id !== 'select'}
                          onDragStart={(e) => {
                            if (col.id !== 'select') {
                              setDraggedColumn(col.id)
                              e.dataTransfer.effectAllowed = 'move'
                              // Set drag image
                              const dragEl = e.currentTarget.cloneNode(true) as HTMLElement
                              dragEl.style.opacity = '0.8'
                              dragEl.style.background = '#e0e7ff'
                              dragEl.style.borderRadius = '4px'
                              dragEl.style.padding = '8px 12px'
                              document.body.appendChild(dragEl)
                              e.dataTransfer.setDragImage(dragEl, 0, 0)
                              setTimeout(() => document.body.removeChild(dragEl), 0)
                            }
                          }}
                          onDragEnter={(e) => {
                            e.preventDefault()
                            if (draggedColumn && col.id !== 'select' && col.id !== draggedColumn) {
                              setDragOverColumn(col.id)
                            }
                          }}
                          onDragOver={(e) => {
                            e.preventDefault()
                            e.dataTransfer.dropEffect = 'move'
                          }}
                          onDragLeave={(e) => {
                            // Only clear if leaving to outside the element
                            const rect = e.currentTarget.getBoundingClientRect()
                            if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
                              if (dragOverColumn === col.id) {
                                setDragOverColumn(null)
                              }
                            }
                          }}
                          onDrop={(e) => {
                            e.preventDefault()
                            if (draggedColumn && draggedColumn !== col.id && col.id !== 'select') {
                              reorderColumns(draggedColumn, col.id)
                            }
                            setDragOverColumn(null)
                          }}
                          onDragEnd={() => {
                            setDraggedColumn(null)
                            setDragOverColumn(null)
                          }}
                          className={clsx(
                            'pro-table-header-cell relative px-3 py-2.5 group transition-all duration-75',
                            isLastPinned && 'border-r-2 border-slate-200',
                            isSorted && 'sorted',
                            draggedColumn === col.id && 'opacity-40 scale-[0.98]'
                          )}
                          style={{
                            width: col.width,
                            minWidth: col.minWidth,
                            cursor: col.id !== 'select' ? 'grab' : undefined,
                            background: isPinned ? 'linear-gradient(to bottom, #ffffff, #f8fafc)' : undefined
                          }}
                        >
                          {/* Drop indicator - clean vertical line */}
                          {isDragOver && (
                            <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-blue-500 z-20" />
                          )}
                          {col.id === 'select' ? (
                            <button
                              onClick={() => isAllSelected ? clearSelection() : selectAllFiltered()}
                              className="p-0.5 rounded hover:bg-gray-100 transition-colors"
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
                              onDoubleClick={(e) => {
                                e.stopPropagation()
                                if (col.sortable) handleSort(sortField)
                              }}
                              onContextMenu={(e) => {
                                e.preventDefault()
                                setColumnContextMenu({ columnId: col.id, x: e.clientX, y: e.clientY })
                              }}
                            >
                              {/* Column Label */}
                              <span className="flex items-center gap-1 flex-1 min-w-0 select-none">
                                <span className={clsx('truncate', col.pinned && 'text-blue-600 font-medium')}>{col.label}</span>
                              </span>

                              {/* Sort indicator - only visible when sorted */}
                              {col.sortable && sortBy === sortField && (
                                <span className="flex-shrink-0">
                                  {sortOrder === 'asc' ? <ChevronUp className="h-3 w-3 text-blue-600" /> : <ChevronDown className="h-3 w-3 text-blue-600" />}
                                </span>
                              )}

                              {/* Filter indicator - only visible when filter is active */}
                              {['priority', 'sector', 'coverage', 'workflows'].includes(col.id) && (
                                ((col.id === 'priority' && selectedPriorities.length > 0) ||
                                 (col.id === 'sector' && selectedSectors.length > 0) ||
                                 (col.id === 'coverage' && selectedStages.length > 0)) && (
                                  <span className="flex-shrink-0 text-blue-600">
                                    <Filter className="w-3 h-3" />
                                  </span>
                                )
                              )}

                            </div>
                          )}

                          {/* Resize handle */}
                          {col.id !== 'select' && (
                            <div
                              className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group-hover:bg-gray-300 transition-colors"
                              onMouseDown={(e) => handleResizeStart(e, col.id, col.width)}
                            />
                          )}
                        </div>
                      )
                    })}

                    {/* Add Column Button */}
                    <div className="flex-shrink-0 px-2 py-2.5">
                      <button
                        ref={addColumnRef}
                        data-add-column-btn
                        onClick={() => {
                          if (addColumnDropdown) {
                            setAddColumnDropdown(null)
                            setAddColumnSearch('')
                          } else {
                            const rect = addColumnRef.current?.getBoundingClientRect()
                            if (rect) {
                              setAddColumnDropdown({
                                x: Math.min(rect.right - 224, window.innerWidth - 234), // 224 = dropdown width, 10px margin
                                y: rect.bottom + 4
                              })
                            }
                          }
                        }}
                        className="p-1.5 rounded hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
                        title="Add column"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Add Column Dropdown - rendered via portal */}
                {addColumnDropdown && createPortal(
                  <div
                    className="fixed w-56 bg-white rounded-lg shadow-xl border border-gray-200 z-[9999] overflow-hidden animate-in fade-in zoom-in-95 duration-100 add-column-dropdown"
                    style={{ left: addColumnDropdown.x, top: addColumnDropdown.y }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Search Input */}
                    <div className="p-2 border-b border-gray-100">
                      <input
                        type="text"
                        autoFocus
                        value={addColumnSearch}
                        onChange={(e) => setAddColumnSearch(e.target.value)}
                        placeholder="Search columns..."
                        className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                      />
                    </div>

                    {/* Column List */}
                    <div className="max-h-64 overflow-y-auto p-1">
                      {hiddenColumns
                        .filter(col =>
                          !addColumnSearch ||
                          col.label.toLowerCase().includes(addColumnSearch.toLowerCase())
                        )
                        .map(col => (
                          <button
                            key={col.id}
                            onClick={() => {
                              toggleColumnVisibility(col.id)
                              setAddColumnDropdown(null)
                              setAddColumnSearch('')
                            }}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 rounded-md flex items-center gap-2 text-gray-700"
                          >
                            <Plus className="w-3.5 h-3.5 text-gray-400" />
                            {col.label}
                          </button>
                        ))
                      }
                      {hiddenColumns.filter(col =>
                        !addColumnSearch ||
                        col.label.toLowerCase().includes(addColumnSearch.toLowerCase())
                      ).length === 0 && (
                        <div className="px-3 py-4 text-center text-sm text-gray-500">
                          {addColumnSearch ? 'No matching columns' : 'All columns visible'}
                        </div>
                      )}
                    </div>
                    {/* Special Column Buttons - at bottom */}
                    <div className="p-2 border-t border-gray-100 space-y-2">
                      {/* Add Priority Column Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          const dropdownPos = addColumnDropdown
                          setAddColumnDropdown(null)
                          setAddColumnSearch('')
                          setTimeout(() => {
                            setPriorityColumnPicker({
                              x: dropdownPos ? dropdownPos.x : window.innerWidth - 300,
                              y: dropdownPos ? dropdownPos.y : 100
                            })
                          }, 50)
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-orange-50 to-amber-50 hover:from-orange-100 hover:to-amber-100 rounded-lg border border-orange-100 transition-colors"
                      >
                        <Flag className="w-4 h-4 text-orange-500" />
                        <span className="text-sm font-medium text-orange-700">Add Priority Column</span>
                      </button>
                      {/* Add AI Column Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          // Position AI library dropdown at same location as add column dropdown
                          const dropdownPos = addColumnDropdown
                          setAddColumnDropdown(null)
                          setAddColumnSearch('')
                          setTimeout(() => {
                            setShowAIColumnLibrary({
                              x: dropdownPos ? Math.max(10, dropdownPos.x - 64) : Math.max(10, window.innerWidth - 340),
                              y: dropdownPos ? dropdownPos.y : 100
                            })
                          }, 50)
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-purple-50 to-indigo-50 hover:from-purple-100 hover:to-indigo-100 rounded-lg border border-purple-100 transition-colors"
                      >
                        <Sparkles className="w-4 h-4 text-purple-500" />
                        <span className="text-sm font-medium text-purple-700">Add AI Column</span>
                      </button>
                    </div>
                  </div>,
                  document.body
                )}

                {/* Column Context Menu - rendered via portal */}
                {columnContextMenu && createPortal(
                  <div
                    className="fixed w-52 bg-white rounded-lg shadow-xl border border-gray-200 z-[9999] overflow-hidden animate-in fade-in zoom-in-95 duration-100 column-context-menu"
                    style={{ left: columnContextMenu.x, top: columnContextMenu.y }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {(() => {
                      const col = allColumns.find(c => c.id === columnContextMenu.columnId)
                      if (!col) return null
                      const sortField = col.id === 'ticker' ? 'symbol' : col.id === 'companyName' ? 'company_name' : col.id === 'price' ? 'current_price' : col.id === 'updated' ? 'updated_at' : col.id
                      const isSorted = sortBy === sortField
                      const isTextColumn = ['thesis', 'bull_case', 'bear_case', 'base_case', 'where_different', 'risks_to_thesis', 'notes'].includes(col.id)
                      const isAIColumn = col.isCustomAI

                      return (
                        <>
                          {/* Sort Options */}
                          {col.sortable && (
                            <>
                              <button
                                onClick={() => {
                                  setSortBy(sortField)
                                  setSortOrder('asc')
                                  setColumnContextMenu(null)
                                }}
                                className={clsx(
                                  "w-full px-3 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2",
                                  isSorted && sortOrder === 'asc' && "bg-blue-50 text-blue-700"
                                )}
                              >
                                <ChevronUp className="w-4 h-4" />
                                Sort Ascending
                              </button>
                              <button
                                onClick={() => {
                                  setSortBy(sortField)
                                  setSortOrder('desc')
                                  setColumnContextMenu(null)
                                }}
                                className={clsx(
                                  "w-full px-3 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2",
                                  isSorted && sortOrder === 'desc' && "bg-blue-50 text-blue-700"
                                )}
                              >
                                <ChevronDown className="w-4 h-4" />
                                Sort Descending
                              </button>
                              <div className="h-px bg-gray-100 my-1" />
                            </>
                          )}

                          {/* Filter Option for filterable columns */}
                          {['priority', 'sector', 'coverage'].includes(col.id) && (
                            <>
                              <button
                                onClick={() => {
                                  setActiveTableFilter(col.id)
                                  setColumnContextMenu(null)
                                }}
                                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
                              >
                                <Filter className="w-4 h-4" />
                                Filter by {col.label}
                              </button>
                              <div className="h-px bg-gray-100 my-1" />
                            </>
                          )}

                          {/* Content Source for text columns */}
                          {isTextColumn && (
                            <>
                              <button
                                onClick={() => {
                                  setContentSourceSelector({
                                    columnId: col.id,
                                    columnLabel: col.label,
                                    position: { x: columnContextMenu.x, y: columnContextMenu.y },
                                    assetId: filteredAssets[0]?.id,
                                  })
                                  setColumnContextMenu(null)
                                }}
                                className={clsx(
                                  "w-full px-3 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2",
                                  hasCustomSource(col.id) && "text-purple-600"
                                )}
                              >
                                <Users className="w-4 h-4" />
                                Change Content Source
                                {hasCustomSource(col.id) && (
                                  <span className="ml-auto text-xs bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded">
                                    Custom
                                  </span>
                                )}
                              </button>
                              <button
                                onClick={() => {
                                  toggleColumnWrap(col.id)
                                  setColumnContextMenu(null)
                                }}
                                className={clsx(
                                  "w-full px-3 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2",
                                  col.wrapText && "text-blue-600"
                                )}
                              >
                                <WrapText className="w-4 h-4" />
                                Wrap Text
                                {col.wrapText && (
                                  <Check className="w-4 h-4 ml-auto" />
                                )}
                              </button>
                              <div className="h-px bg-gray-100 my-1" />
                            </>
                          )}

                          {/* Priority Column - change source */}
                          {(col.id === 'priority' || col.id.startsWith('priority_') || col.prioritySource) && (
                            <>
                              <button
                                onClick={() => {
                                  // Open priority source selector for this column
                                  setPrioritySourceSelector({
                                    columnId: col.id,
                                    columnLabel: col.label,
                                    position: { x: columnContextMenu.x, y: columnContextMenu.y },
                                    currentSource: col.prioritySource || 'my',
                                    currentUserId: col.sourceUserId,
                                    currentUserName: col.sourceUserName,
                                  })
                                  setColumnContextMenu(null)
                                }}
                                className={clsx(
                                  "w-full px-3 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2",
                                  col.prioritySource && col.prioritySource !== 'my' && "text-purple-600"
                                )}
                              >
                                <Users className="w-4 h-4" />
                                Change Priority Source
                                {col.prioritySource && col.prioritySource !== 'my' && (
                                  <span className="ml-auto text-xs bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded">
                                    {col.prioritySource === 'firm' ? 'Firm' : col.sourceUserName?.split(' ')[0] || 'User'}
                                  </span>
                                )}
                              </button>
                              <div className="h-px bg-gray-100 my-1" />
                            </>
                          )}

                          {/* AI Column specific options */}
                          {isAIColumn && (
                            <>
                              <button
                                onClick={() => {
                                  // TODO: Refresh all AI content for this column
                                  setColumnContextMenu(null)
                                }}
                                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
                              >
                                <RefreshCw className="w-4 h-4" />
                                Refresh All
                              </button>
                              <div className="h-px bg-gray-100 my-1" />
                            </>
                          )}

                          {/* Pin/Unpin - hide unpin for columns that can't be unpinned */}
                          {!isAIColumn && (col.canUnpin !== false || !col.pinned) && (
                            <button
                              onClick={() => {
                                toggleColumnPin(col.id)
                                setColumnContextMenu(null)
                              }}
                              className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
                            >
                              {col.pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
                              {col.pinned ? 'Unpin Column' : 'Pin Column'}
                            </button>
                          )}

                          {/* Remove */}
                          <button
                            onClick={() => {
                              toggleColumnVisibility(col.id)
                              setColumnContextMenu(null)
                            }}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2 text-red-600"
                          >
                            <X className="w-4 h-4" />
                            Remove Column
                          </button>
                        </>
                      )
                    })()}
                  </div>,
                  document.body
                )}


                {/* Filter Dropdown (for column context menu filter action) */}
                {activeTableFilter && createPortal(
                  <div
                    className="fixed w-48 bg-white rounded-lg shadow-xl border border-gray-200 z-[9999] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200 table-filter-dropdown"
                    style={{ left: columnContextMenu?.x || 100, top: (columnContextMenu?.y || 100) + 30 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                      <p className="text-xs font-semibold text-gray-700">Filter by {columns.find(c => c.id === activeTableFilter)?.label}</p>
                      {((activeTableFilter === 'priority' && selectedPriorities.length > 0) ||
                        (activeTableFilter === 'sector' && selectedSectors.length > 0) ||
                        (activeTableFilter === 'coverage' && selectedStages.length > 0)) && (
                        <button onClick={() => {
                          if (activeTableFilter === 'priority') setSelectedPriorities([])
                          if (activeTableFilter === 'sector') setSelectedSectors([])
                          if (activeTableFilter === 'coverage') setSelectedStages([])
                        }} className="text-xs text-blue-600 hover:text-blue-800">Clear</button>
                      )}
                    </div>
                    <div className="p-2 max-h-64 overflow-y-auto">
                      {activeTableFilter === 'priority' && PRIORITY_OPTIONS.map(priority => {
                        const config = PRIORITY_CONFIG[priority]
                        const IconComponent = config.icon
                        return (
                          <button key={priority} onClick={() => togglePriority(priority)}
                            className={clsx("w-full px-3 py-2 text-left text-sm rounded-md transition-colors flex items-center gap-2", selectedPriorities.includes(priority) ? "bg-blue-50 text-blue-700" : "hover:bg-gray-100 text-gray-700")}>
                            <div className={clsx("w-4 h-4 rounded border-2 flex items-center justify-center transition-colors", selectedPriorities.includes(priority) ? "bg-blue-600 border-blue-600" : "border-gray-300")}>
                              {selectedPriorities.includes(priority) && <Check className="w-2.5 h-2.5 text-white" />}
                            </div>
                            <span className={clsx("w-3 h-3 rounded-full flex items-center justify-center text-white", config.bg)}>
                              <IconComponent className="w-2 h-2" />
                            </span>
                            {config.label}
                          </button>
                        )
                      })}
                      {activeTableFilter === 'sector' && sectors.map(sector => (
                        <button key={sector} onClick={() => toggleSector(sector)}
                          className={clsx("w-full px-3 py-2 text-left text-sm rounded-md transition-colors flex items-center gap-2", selectedSectors.includes(sector) ? "bg-blue-50 text-blue-700" : "hover:bg-gray-100 text-gray-700")}>
                          <div className={clsx("w-4 h-4 rounded border-2 flex items-center justify-center transition-colors", selectedSectors.includes(sector) ? "bg-blue-600 border-blue-600" : "border-gray-300")}>
                            {selectedSectors.includes(sector) && <Check className="w-2.5 h-2.5 text-white" />}
                          </div>
                          {sector}
                        </button>
                      ))}
                      {activeTableFilter === 'coverage' && Object.entries(PROCESS_STAGES).map(([key, stage]) => (
                        <button key={key} onClick={() => toggleStage(key)}
                          className={clsx("w-full px-3 py-2 text-left text-sm rounded-md transition-colors flex items-center gap-2", selectedStages.includes(key) ? "bg-blue-50 text-blue-700" : "hover:bg-gray-100 text-gray-700")}>
                          <div className={clsx("w-4 h-4 rounded border-2 flex items-center justify-center transition-colors", selectedStages.includes(key) ? "bg-blue-600 border-blue-600" : "border-gray-300")}>
                            {selectedStages.includes(key) && <Check className="w-2.5 h-2.5 text-white" />}
                          </div>
                          <span className={clsx("px-1.5 py-0.5 text-xs rounded", stage.color)}>{stage.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>,
                  document.body
                )}

                {/* Body - key forces remount when density/wrap changes to reset virtualization cache */}
                <div
                  key={virtualizerKey}
                  style={{
                    height: rowVirtualizer.getTotalSize() + (insertAboveRow !== null ? densityRowHeight : 0),
                    minWidth: totalTableWidth,
                    position: 'relative'
                  }}>
                  {/* Inline Insert Row - renders when insert mode is active */}
                  {insertAboveRow !== null && listId && (
                    <InlineInsertRow
                      rowIndex={insertAboveRow}
                      densityRowHeight={densityRowHeight}
                      densityConfig={densityConfig}
                      totalTableWidth={totalTableWidth}
                      visibleColumns={visibleColumns}
                      existingAssetIds={existingAssetIds || []}
                      inputRef={insertInputRef}
                      onInsert={handleInsertAbove}
                      onCancel={cancelInsertAbove}
                    />
                  )}

                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const asset = filteredAssets[virtualRow.index]
                    const isExpanded = expandedRows.has(asset.id)
                    const isSelected = selectedAssetIds.has(asset.id)
                    const quote = getQuote(asset.symbol)
                    const livePrice = showLivePrices && quote?.price
                    const displayPrice = livePrice || asset.current_price
                    const changePercent = quote?.changePercent
                    const coverage = assetCoverageMap.get(asset.id) || []
                    const workflows = assetWorkflowMap.get(asset.id) || []
                    const flagColor = getFlagColor(asset.id)
                    const flagStyles = getFlagStyles(flagColor)
                    const rowIsFocused = isRowFocused(virtualRow.index)
                    const isEvenRow = virtualRow.index % 2 === 1

                    // When insert mode is active, shift rows at or after insert position down
                    // Shift rows BELOW the selected row down to make room for insert input
                    const insertOffset = (insertAboveRow !== null && virtualRow.index > insertAboveRow) ? densityRowHeight : 0

                    return (
                      <div
                        key={asset.id}
                        ref={hasWrapTextColumn && !isExpanded ? rowVirtualizer.measureElement : undefined}
                        data-index={virtualRow.index}
                        className={clsx(
                          'pro-table-row absolute top-0 left-0 w-full group',
                          isEvenRow && 'row-even',
                          isSelected && 'selected',
                          rowIsFocused && 'focused',
                          flagColor && 'flagged',
                          flagColor && `flag-${flagColor}`,
                          hasWrapTextColumn && !isExpanded && 'wrap-enabled',
                          isExpanded && 'expanded flex flex-col'
                        )}
                        data-row-index={virtualRow.index}
                        style={{
                          height: isExpanded ? expandedRowHeight : (hasWrapTextColumn ? 'auto' : densityRowHeight),
                          minHeight: hasWrapTextColumn && !isExpanded ? densityRowHeight : undefined,
                          transform: `translateY(${virtualRow.start + insertOffset}px)`
                        }}>
                        <div
                          className={clsx('flex items-center', isExpanded ? 'h-auto' : 'h-full')}
                          style={{ minWidth: totalTableWidth, minHeight: densityRowHeight }}
                          onDoubleClick={() => toggleRowExpansion(asset.id)}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            setRowContextMenu({ assetId: asset.id, x: e.clientX, y: e.clientY })
                          }}>
                          {visibleColumns.map((col, colIndex) => {
                            if (col.id === 'select' && !selectionMode) return null
                            const isPinned = col.pinned || col.id === 'select' // Select column is always "pinned" to left
                            const leftOffset = isPinned
                              ? visibleColumns.slice(0, colIndex).filter(c => (c.pinned || c.id === 'select') && (c.id !== 'select' || selectionMode)).reduce((sum, c) => sum + c.width, 0)
                              : 0
                            const cellIsFocused = isCellFocused(virtualRow.index, col.id)
                            // Check if this is the last pinned column for shadow - find actual last pinned column by ID
                            const lastPinnedCol = [...visibleColumns].reverse().find(c =>
                              (c.pinned || c.id === 'select') && (c.id !== 'select' || selectionMode)
                            )
                            const isLastPinned = isPinned && col.id === lastPinnedCol?.id

                            return (
                              <div
                                key={col.id}
                                onClick={(e) => { e.stopPropagation(); handleCellClick(virtualRow.index, col.id, e) }}
                                className={clsx(
                                  'pro-table-cell cursor-default',
                                  isExpanded ? 'h-auto' : 'h-full',
                                  col.wrapText && !isExpanded && 'items-start',
                                  densityConfig.padding,
                                  densityConfig.fontSize,
                                  isLastPinned && 'border-r-2 border-slate-200',
                                  cellIsFocused && 'focused'
                                )}
                                style={{
                                  width: col.width,
                                  minWidth: col.minWidth,
                                  backgroundColor: isPinned
                                    ? (isSelected
                                        ? '#dbeafe'  // blue-100 for selected
                                        : isEvenRow
                                          ? '#f1f5f9'  // slate-100 for even rows
                                          : '#ffffff') // white for odd rows
                                    : undefined
                                }}
                              >
                                {col.id === 'select' && (
                                  <button onClick={(e) => toggleAssetSelection(asset.id, e)} className="p-0.5 rounded hover:bg-gray-200">
                                    {isSelected ? <CheckSquare className="h-4 w-4 text-blue-600" /> : <Square className="h-4 w-4 text-gray-400" />}
                                  </button>
                                )}
                                {col.id === 'ticker' && (
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      {/* Hide expand chevron in micro mode for cleaner look */}
                                      {density !== 'micro' && (
                                        <button
                                          onMouseDown={(e) => e.preventDefault()}
                                          onClick={(e) => { e.stopPropagation(); toggleRowExpansion(asset.id) }}
                                          className="p-1 rounded hover:bg-gray-100 transition-colors"
                                        >
                                          <ChevronRight className={clsx('h-3.5 w-3.5 text-gray-400 transition-transform duration-150', isExpanded && 'rotate-90')} />
                                        </button>
                                      )}
                                      <div className="flex items-center gap-1.5">
                                        <span className={clsx('pro-symbol', (density === 'ultra' || density === 'micro') ? 'text-xs' : 'text-sm')}>{asset.symbol}</span>
                                        {/* Hide price target icon in micro mode */}
                                        {density !== 'micro' && asset.price_targets?.length > 0 && (
                                          <Target className="h-3 w-3 text-amber-500" title={`${asset.price_targets.length} price target(s)`} />
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                )}
                                {col.id === 'companyName' && (
                                  <span className={clsx('pro-company-name flex-1 min-w-0 truncate', (density === 'ultra' || density === 'micro') ? 'text-xs' : 'text-sm')}>
                                    {asset.company_name || '—'}
                                  </span>
                                )}
                                {col.id === 'coverage' && (() => {
                                  if (coverage.length === 0) {
                                    return <span className="pro-empty-cell">—</span>
                                  }
                                  const lead = coverage.find(c => c.isLead) || coverage[0]
                                  const isMicro = density === 'micro'

                                  if (density === 'comfortable') {
                                    return (
                                      <div className="flex items-center gap-2" title={coverage.map(c => `${c.analyst}${c.team ? ` (${c.team})` : ''}`).join('\n')}>
                                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center text-[10px] font-semibold text-slate-600 flex-shrink-0">
                                          {getInitials(lead.analyst)}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                          <span className="pro-analyst block truncate">{lead.analyst}</span>
                                          {lead.team && <span className="pro-analyst-team block truncate">{lead.team}</span>}
                                        </div>
                                        {coverage.length > 1 && <span className="pro-analyst-count">+{coverage.length - 1}</span>}
                                      </div>
                                    )
                                  }

                                  return (
                                    <div className={clsx('flex items-center', isMicro ? 'gap-0.5' : 'gap-1.5')} title={coverage.map(c => `${c.analyst}${c.team ? ` (${c.team})` : ''}`).join('\n')}>
                                      <span className={clsx('pro-analyst truncate', isMicro ? 'text-[9px]' : (density === 'ultra') ? 'text-[10px]' : 'text-sm')}>{lead.analyst}</span>
                                      {coverage.length > 1 && <span className={clsx('pro-analyst-count', isMicro && 'text-[8px] px-0.5 py-0')}>+{coverage.length - 1}</span>}
                                    </div>
                                  )
                                })()}
                                {col.id === 'workflows' && (() => {
                                  const isMicroOrUltra = density === 'ultra' || density === 'micro'
                                  const isMicro = density === 'micro'

                                  if (workflows.length === 0) {
                                    return (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          const rect = e.currentTarget.getBoundingClientRect()
                                          setWorkflowPopover({ assetId: asset.id, x: rect.left, y: rect.bottom + 4 })
                                        }}
                                        className={clsx('text-gray-400 hover:text-blue-600 transition-colors', isMicro ? 'text-[9px]' : isMicroOrUltra ? 'text-[10px]' : 'text-xs')}
                                      >
                                        {isMicro ? '—' : 'Add workflow'}
                                      </button>
                                    )
                                  }

                                  return (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        const rect = e.currentTarget.getBoundingClientRect()
                                        setWorkflowPopover({ assetId: asset.id, x: rect.left, y: rect.bottom + 4 })
                                      }}
                                      className={clsx('pro-workflow-badge', isMicro && 'text-[9px] px-1 py-0', isMicroOrUltra && !isMicro && 'text-[10px]')}
                                    >
                                      <span className={clsx('pro-workflow-dot', isMicro && 'w-1.5 h-1.5')} style={{ backgroundColor: workflows[0]?.color || '#6366f1' }} />
                                      <span>{workflows.length}{isMicro ? '' : ` workflow${workflows.length !== 1 ? 's' : ''}`}</span>
                                    </button>
                                  )
                                })()}
                                {col.id === 'price' && (() => {
                                  if (!displayPrice) return <span className="pro-empty-cell">—</span>
                                  return (
                                    <span className={clsx('pro-price', (density === 'ultra' || density === 'micro') && 'text-xs')}>
                                      {formatPrice(displayPrice)}
                                    </span>
                                  )
                                })()}
                                {col.id === 'change' && (() => {
                                  if (!showLivePrices || changePercent === undefined) return <span className="pro-empty-cell">—</span>
                                  const changeClass = getPriceChangeClass(changePercent)
                                  return (
                                    <span className={clsx('pro-price-change', changeClass, (density === 'ultra' || density === 'micro') && 'text-[10px] px-1 py-0')}>
                                      {formatPriceChange(changePercent)}
                                    </span>
                                  )
                                })()}
                                {(col.id === 'priority' || col.id.startsWith('priority_') || col.prioritySource) && (() => {
                                  // Get priority based on column's source configuration
                                  const priority = getPriorityForColumn(col, asset.id)
                                  const config = priority && priority !== 'none' ? PRIORITY_CONFIG[priority] : null
                                  const IconComponent = config?.icon
                                  const isMicroOrUltra = density === 'ultra' || density === 'micro'
                                  const isMicro = density === 'micro'

                                  // Only allow editing for user's own priority column
                                  const isEditable = col.prioritySource === 'my' || (col.id === 'priority' && !col.prioritySource)

                                  const content = config ? (
                                    <span className={clsx(
                                      'inline-flex items-center justify-center rounded font-medium text-white',
                                      isMicro ? 'px-1.5 py-0 text-[10px]' : isMicroOrUltra ? 'gap-1 px-1.5 py-0 text-[10px]' : 'gap-1 px-2 py-0.5 text-xs',
                                      config.bg
                                    )}>
                                      {!isMicro && IconComponent && <IconComponent className={isMicroOrUltra ? 'w-2.5 h-2.5' : 'w-3 h-3'} />}
                                      <span>{config.label}</span>
                                    </span>
                                  ) : (
                                    <span className={clsx('text-gray-400', isMicro ? 'text-[10px]' : isMicroOrUltra ? 'text-[10px]' : 'text-xs')}>
                                      {isMicro ? '—' : (isEditable ? 'Set priority' : '—')}
                                    </span>
                                  )

                                  // If editable, render as button; otherwise just show the content
                                  if (isEditable) {
                                    return (
                                      <button
                                        className="w-full h-full flex items-center justify-start cursor-pointer hover:bg-gray-50 rounded px-1 -mx-1 transition-colors"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          const rect = e.currentTarget.getBoundingClientRect()
                                          setEditingCell({ assetId: asset.id, field: 'priority', x: rect.left, y: rect.bottom + 4 })
                                        }}
                                      >
                                        {content}
                                      </button>
                                    )
                                  }

                                  return (
                                    <div className="w-full h-full flex items-center justify-start px-1 -mx-1">
                                      {content}
                                    </div>
                                  )
                                })()}
                                {col.id === 'sector' && (
                                  <span className={clsx('text-gray-600 truncate', (density === 'ultra' || density === 'micro') ? 'text-xs' : 'text-sm')}>
                                    {asset.sector || '—'}
                                  </span>
                                )}
                                {col.id === 'thesis' && (
                                  <span className={clsx('flex-1 min-w-0 text-gray-600 cursor-help', col.wrapText ? 'whitespace-normal break-words' : 'truncate', density === 'micro' ? 'text-[9px]' : (density === 'ultra') ? 'text-[10px]' : 'text-sm')} title={asset.thesis || 'No thesis'}>
                                    {asset.thesis || <span className="text-gray-400 italic">No thesis</span>}
                                  </span>
                                )}
                                {col.id === 'bull_case' && (
                                  <span className={clsx('flex-1 min-w-0 text-gray-600 cursor-help', col.wrapText ? 'whitespace-normal break-words' : 'truncate', density === 'micro' ? 'text-[9px]' : (density === 'ultra') ? 'text-[10px]' : 'text-sm')} title={asset.bull_case || 'Not specified'}>
                                    {asset.bull_case || <span className="text-gray-400 italic">—</span>}
                                  </span>
                                )}
                                {col.id === 'bear_case' && (
                                  <span className={clsx('flex-1 min-w-0 text-gray-600 cursor-help', col.wrapText ? 'whitespace-normal break-words' : 'truncate', density === 'micro' ? 'text-[9px]' : (density === 'ultra') ? 'text-[10px]' : 'text-sm')} title={asset.bear_case || 'Not specified'}>
                                    {asset.bear_case || <span className="text-gray-400 italic">—</span>}
                                  </span>
                                )}
                                {col.id === 'base_case' && (
                                  <span className={clsx('flex-1 min-w-0 text-gray-600 cursor-help', col.wrapText ? 'whitespace-normal break-words' : 'truncate', density === 'micro' ? 'text-[9px]' : (density === 'ultra') ? 'text-[10px]' : 'text-sm')} title={asset.base_case || 'Not specified'}>
                                    {asset.base_case || <span className="text-gray-400 italic">—</span>}
                                  </span>
                                )}
                                {col.id === 'where_different' && (
                                  <span className={clsx('flex-1 min-w-0 text-gray-600 cursor-help', col.wrapText ? 'whitespace-normal break-words' : 'truncate', density === 'micro' ? 'text-[9px]' : (density === 'ultra') ? 'text-[10px]' : 'text-sm')} title={asset.where_different || 'Not specified'}>
                                    {asset.where_different || <span className="text-gray-400 italic">—</span>}
                                  </span>
                                )}
                                {col.id === 'risks_to_thesis' && (
                                  <span className={clsx('flex-1 min-w-0 text-gray-600 cursor-help', col.wrapText ? 'whitespace-normal break-words' : 'truncate', density === 'micro' ? 'text-[9px]' : (density === 'ultra') ? 'text-[10px]' : 'text-sm')} title={asset.risks_to_thesis || 'Not specified'}>
                                    {asset.risks_to_thesis || <span className="text-gray-400 italic">—</span>}
                                  </span>
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
                                          className="w-full text-sm px-2 py-1.5 bg-white border border-blue-400 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 resize-none transition-all"
                                        />
                                        <div className="absolute -bottom-5 right-0 text-[10px] text-gray-400">
                                          Enter to save · Esc to cancel
                                        </div>
                                      </div>
                                    )
                                  }

                                  const isMicroOrUltra = density === 'ultra' || density === 'micro'
                                  const isMicro = density === 'micro'

                                  return (
                                    <div
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        startEditingNote(asset.id, quickNote)
                                      }}
                                      className={clsx('group/note w-full flex items-center cursor-text hover:bg-gray-50 rounded px-1 -mx-1 transition-colors', !col.wrapText && 'h-full')}
                                      title={quickNote || 'Click to add quick note'}
                                    >
                                      {quickNote ? (
                                        <span className={clsx('text-gray-700 flex-1 min-w-0', col.wrapText ? 'whitespace-normal break-words' : 'truncate', isMicro ? 'text-[9px]' : isMicroOrUltra ? 'text-[10px]' : 'text-sm')}>{quickNote}</span>
                                      ) : (
                                        <span className={clsx('text-gray-400 italic opacity-0 group-hover/note:opacity-100 transition-opacity', isMicro ? 'text-[9px]' : isMicroOrUltra ? 'text-[10px]' : 'text-sm')}>
                                          {isMicro ? '+' : 'Add note...'}
                                        </span>
                                      )}
                                    </div>
                                  )
                                })()}
                                {col.id === 'updated' && (() => {
                                  if (!asset.updated_at) return <span className="pro-empty-cell">—</span>
                                  const freshness = getTimestampFreshness(asset.updated_at)
                                  const isMicro = density === 'micro'

                                  return (
                                    <div className={clsx(
                                      'pro-timestamp flex items-center',
                                      isMicro ? 'gap-0.5' : 'gap-1.5',
                                      freshness === 'recent' && 'recent',
                                      freshness === 'stale' && 'stale',
                                      isMicro ? 'text-[9px]' : (density === 'ultra') && 'text-[10px]'
                                    )}>
                                      <Clock className={isMicro ? 'h-2 w-2 flex-shrink-0' : 'h-3 w-3 flex-shrink-0'} />
                                      <span className="truncate tabular-nums">
                                        {formatRelativeTime(asset.updated_at)}
                                      </span>
                                    </div>
                                  )
                                })()}
                                {col.isCustomAI && col.aiColumnId && (
                                  <AIColumnCell
                                    columnId={col.aiColumnId}
                                    columnName={col.label}
                                    assetId={asset.id}
                                    assetSymbol={asset.symbol}
                                    content={null} // TODO: Wire up actual cache
                                    isLoading={false}
                                    onGenerate={() => {
                                      // TODO: Implement AI generation
                                      console.log('Generate AI content for', col.label, asset.symbol)
                                    }}
                                    onRefresh={() => {
                                      // TODO: Implement refresh
                                      console.log('Refresh AI content for', col.label, asset.symbol)
                                    }}
                                    density={density}
                                  />
                                )}
                                {col.id === 'actions' && renderRowActions && renderRowActions(asset)}
                              </div>
                            )
                          })}
                        </div>
                        {isExpanded && (
                          <div className="pro-expanded-row px-6 py-4" style={{ height: expandedRowHeight - densityRowHeight }}>
                            {/* Show metric-specific details if triggered by Enter on a specific column */}
                            {expandedMetricColumn?.assetId === asset.id ? (
                              <div className="h-full flex flex-col">
                                <div className="flex items-center justify-between mb-3">
                                  <h4 className="pro-expanded-section-title mb-0">
                                    {visibleColumns.find(c => c.id === expandedMetricColumn.columnId)?.label || 'Details'}
                                  </h4>
                                  <button
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => { toggleRowExpansion(asset.id); setExpandedMetricColumn(null) }}
                                    className="p-1 hover:bg-gray-100 rounded transition-colors"
                                  >
                                    <X className="w-4 h-4 text-gray-400" />
                                  </button>
                                </div>
                                <div className="flex-1 overflow-auto">
                                  {renderMetricDetail(asset, expandedMetricColumn.columnId, quote, coverage, workflows)}
                                </div>
                                <div className="mt-4 pt-3 border-t border-gray-100 flex gap-2">
                                  <Button variant="secondary" size="sm" onClick={() => handleAssetClick(asset)}>
                                    View Full Details
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              /* Default expanded view (when expanded via chevron) */
                              <>
                                <div className="grid grid-cols-3 gap-8">
                                  <div>
                                    <h4 className="pro-expanded-section-title">Asset Info</h4>
                                    <div className="space-y-2">
                                      <div className="flex items-center justify-between">
                                        <span className="text-xs text-gray-500">Sector</span>
                                        <span className="text-sm font-medium text-gray-900">{asset.sector || '—'}</span>
                                      </div>
                                      <div className="flex items-center justify-between">
                                        <span className="text-xs text-gray-500">Stage</span>
                                        <span className="text-sm font-medium text-gray-900">{asset.process_stage || '—'}</span>
                                      </div>
                                      {asset.market_cap && (
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs text-gray-500">Market Cap</span>
                                          <span className="text-sm font-mono font-medium text-gray-900">{formatPrice(asset.market_cap)}</span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  <div>
                                    <h4 className="pro-expanded-section-title">Thesis</h4>
                                    <p className="text-sm text-gray-600 leading-relaxed">{asset.thesis || 'No thesis available'}</p>
                                  </div>
                                  <div>
                                    <h4 className="pro-expanded-section-title">Notes</h4>
                                    <p className="text-sm text-gray-600 leading-relaxed italic">{asset.quick_note || 'No notes'}</p>
                                  </div>
                                </div>
                                <div className="mt-4 pt-3 border-t border-gray-100 flex gap-2">
                                  <Button variant="secondary" size="sm" onClick={() => handleAssetClick(asset)}>
                                    View Full Details
                                  </Button>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Inline Add Row */}
              {listId && (
                <InlineAddRow
                  listId={listId}
                  existingAssetIds={existingAssetIds}
                  columns={visibleColumns}
                  density={density}
                  densityConfig={densityConfig}
                  totalTableWidth={totalTableWidth}
                  queryClient={queryClient}
                  user={user}
                  inputRef={inlineAddInputRef}
                  onExitUp={handleInlineAddExitUp}
                />
              )}

              {/* Workflow Popover */}
              {workflowPopover && (() => {
                const currentWorkflows = assetWorkflowMap.get(workflowPopover.assetId) || []
                const asset = filteredAssets.find(a => a.id === workflowPopover.assetId)
                // Filter available workflows to exclude ones asset is already in
                const currentWorkflowIds = new Set(currentWorkflows.map(w => w.id))
                const addableWorkflows = availableWorkflows.filter(w => !currentWorkflowIds.has(w.id))

                return (
                  <div
                    className="workflow-popover fixed z-50 bg-white rounded-lg shadow-xl border border-gray-200 p-3 min-w-[240px] max-w-[320px]"
                    style={{ left: workflowPopover.x, top: workflowPopover.y }}
                  >
                    <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-100">
                      <span className="text-sm font-medium text-gray-900">{asset?.symbol} Workflows</span>
                      <button onClick={() => setWorkflowPopover(null)} className="p-1 hover:bg-gray-100 rounded">
                        <X className="w-3 h-3 text-gray-400" />
                      </button>
                    </div>

                    {/* Active Workflows */}
                    {currentWorkflows.length > 0 && (
                      <div className="mb-3">
                        <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-1.5 px-1">Active</div>
                        <div className="space-y-1">
                          {currentWorkflows.map((wf, idx) => (
                            <div key={idx} className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-gray-50">
                              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: wf.color }} />
                              <span className="text-sm text-gray-700">{wf.name}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Available Workflows to Add */}
                    {addableWorkflows.length > 0 && (
                      <div>
                        {currentWorkflows.length > 0 && <div className="border-t border-gray-100 my-2" />}
                        <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-1.5 px-1">
                          Add to Workflow
                        </div>
                        <div className="space-y-1 max-h-[200px] overflow-y-auto">
                          {addableWorkflows.map((wf) => (
                            <button
                              key={wf.id}
                              onClick={() => joinWorkflowMutation.mutate({ assetId: workflowPopover.assetId, workflowId: wf.id })}
                              disabled={joinWorkflowMutation.isPending}
                              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-blue-50 text-left transition-colors group"
                            >
                              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: wf.color || '#6366f1' }} />
                              <span className="text-sm text-gray-700 flex-1 truncate">
                                {wf.name}
                                {wf.branch_suffix && <span className="text-gray-400"> ({wf.branch_suffix})</span>}
                              </span>
                              <Plus className="w-3.5 h-3.5 text-gray-400 group-hover:text-blue-600 transition-colors flex-shrink-0" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Empty state */}
                    {currentWorkflows.length === 0 && addableWorkflows.length === 0 && (
                      <div className="text-sm text-gray-500 text-center py-2">
                        No workflows available
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* Priority Dropdown */}
              {editingCell?.field === 'priority' && createPortal(
                <div
                  className="fixed z-[100] animate-in fade-in zoom-in-95 duration-100"
                  style={{ left: editingCell.x, top: editingCell.y }}
                >
                  <div className="bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden min-w-[140px]">
                    <div className="px-3 py-1.5 border-b border-gray-100">
                      <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Your Priority</span>
                    </div>
                    <div className="p-1.5">
                      {PRIORITY_OPTIONS.map(priority => {
                        const config = PRIORITY_CONFIG[priority]
                        const IconComponent = config.icon
                        const currentPriority = getUserPriority(editingCell.assetId)
                        const isSelected = currentPriority === priority || (!currentPriority && priority === 'none')

                        return (
                          <button
                            key={priority}
                            onClick={() => {
                              setUserPriorityMutation.mutate({ assetId: editingCell.assetId, priority })
                              setEditingCell(null)
                            }}
                            className={clsx(
                              'w-full px-2.5 py-1.5 rounded-md text-xs font-medium transition-all text-white flex items-center gap-1.5 mb-1 last:mb-0',
                              config.bg,
                              isSelected ? 'ring-2 ring-offset-1 ring-blue-300' : 'opacity-70 hover:opacity-100'
                            )}
                          >
                            <IconComponent className="w-3 h-3" />
                            <span>{config.label}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  {/* Invisible backdrop to close on click outside */}
                  <div
                    className="fixed inset-0 -z-10"
                    onClick={() => setEditingCell(null)}
                  />
                </div>,
                document.body
              )}

            </Card>
          )}

          {/* GROUPED TABLE VIEW */}
          {viewMode === 'table' && groupBy !== 'none' && groupedAssets && (
            <Card padding="none" className={clsx('overflow-hidden', fillHeight && 'flex-1 min-h-0 flex flex-col')}>
              <div className={clsx(fillHeight ? 'overflow-auto flex-1' : '')}>
                {groupedAssets.map(group => (
                  <div key={group.key} className="border-b border-gray-100 last:border-b-0">
                    {/* Group Header */}
                    <button
                      onClick={() => {
                        setCollapsedGroups(prev => {
                          const next = new Set(prev)
                          if (next.has(group.key)) next.delete(group.key)
                          else next.add(group.key)
                          return next
                        })
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors sticky top-0 z-10"
                    >
                      {collapsedGroups.has(group.key) ? (
                        <ChevronRight className="h-4 w-4 text-gray-400" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-gray-400" />
                      )}
                      {group.color && (
                        <span className={clsx('px-1.5 py-0.5 text-xs font-medium rounded', group.color)}>
                          {group.label}
                        </span>
                      )}
                      {!group.color && (
                        <span className="text-sm font-medium text-gray-700">{group.label}</span>
                      )}
                      <span className="text-xs text-gray-500">({group.assets.length})</span>
                    </button>

                    {/* Group Content */}
                    {!collapsedGroups.has(group.key) && (
                      <div className="divide-y divide-gray-50">
                        {group.assets.map(asset => {
                          const isExpanded = expandedRows.has(asset.id)
                          const isSelected = selectedAssetIds.has(asset.id)
                          const quote = showLivePrices ? getQuote(asset.symbol) : null
                          const coverage = assetCoverageMap.get(asset.id) || []
                          const workflows = assetWorkflowMap.get(asset.id) || []

                          return (
                            <div key={asset.id} className="group">
                              <div
                                onClick={() => handleAssetClick(asset)}
                                className={clsx(
                                  'flex items-center px-3 cursor-pointer transition-colors',
                                  isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                                )}
                                style={{ height: densityRowHeight }}
                              >
                                {/* Selection checkbox */}
                                {selectionMode && (
                                  <div className="w-8 flex-shrink-0">
                                    <button
                                      onClick={(e) => toggleAssetSelection(asset.id, e)}
                                      className="p-0.5 rounded hover:bg-gray-200 transition-colors"
                                    >
                                      {isSelected ? <CheckSquare className="h-4 w-4 text-blue-600" /> : <Square className="h-4 w-4 text-gray-400" />}
                                    </button>
                                  </div>
                                )}

                                {/* Expand toggle */}
                                <button
                                  onClick={(e) => { e.stopPropagation(); toggleExpandRow(asset.id) }}
                                  className="p-1 mr-2 rounded hover:bg-gray-200 transition-colors"
                                >
                                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-gray-400" /> : <ChevronRight className="h-3.5 w-3.5 text-gray-400" />}
                                </button>

                                {/* Asset info */}
                                <div className="flex-1 min-w-0 flex items-center gap-3">
                                  <div className="min-w-0">
                                    <div className="font-medium text-gray-900 text-sm truncate">{asset.symbol}</div>
                                    {density !== 'ultra' && (
                                      <div className="text-xs text-gray-500 truncate">{asset.company_name}</div>
                                    )}
                                  </div>
                                </div>

                                {/* Price */}
                                <div className="w-24 text-right text-sm tabular-nums">
                                  {quote ? (
                                    <>
                                      <div className="font-medium">${quote.price?.toFixed(2)}</div>
                                      {density !== 'ultra' && quote.changePercent !== undefined && (
                                        <div className={clsx('text-xs', quote.changePercent >= 0 ? 'text-green-600' : 'text-red-600')}>
                                          {quote.changePercent >= 0 ? '+' : ''}{quote.changePercent.toFixed(2)}%
                                        </div>
                                      )}
                                    </>
                                  ) : asset.current_price ? (
                                    <div className="font-medium">${asset.current_price.toFixed(2)}</div>
                                  ) : (
                                    <div className="text-gray-400">—</div>
                                  )}
                                </div>

                                {/* Priority */}
                                {groupBy !== 'priority' && (() => {
                                  const userPriority = getUserPriority(asset.id)
                                  const config = userPriority && userPriority !== 'none' ? PRIORITY_CONFIG[userPriority] : null
                                  const IconComponent = config?.icon
                                  return (
                                    <div className="w-20 flex justify-center">
                                      {config ? (
                                        <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium text-white', config.bg)}>
                                          {IconComponent && <IconComponent className="w-3 h-3" />}
                                          <span>{config.label}</span>
                                        </span>
                                      ) : (
                                        <span className="text-xs text-gray-400">—</span>
                                      )}
                                    </div>
                                  )
                                })()}

                                {/* Actions */}
                                {renderRowActions && (
                                  <div className="w-12 flex justify-end">
                                    {renderRowActions(asset)}
                                  </div>
                                )}
                              </div>

                              {/* Expanded content */}
                              {isExpanded && (
                                <div className="px-3 py-3 bg-gray-50/50 border-t border-gray-100">
                                  <div className="grid grid-cols-3 gap-4 text-sm">
                                    {asset.thesis && (
                                      <div>
                                        <div className="text-xs font-medium text-gray-500 mb-1">Thesis</div>
                                        <div className="text-gray-700">{asset.thesis}</div>
                                      </div>
                                    )}
                                    {asset.where_different && (
                                      <div>
                                        <div className="text-xs font-medium text-gray-500 mb-1">Where Different</div>
                                        <div className="text-gray-700">{asset.where_different}</div>
                                      </div>
                                    )}
                                    {coverage.length > 0 && (
                                      <div>
                                        <div className="text-xs font-medium text-gray-500 mb-1">Coverage</div>
                                        <div className="text-gray-700">{coverage.map(c => c.analyst).join(', ')}</div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* KANBAN VIEW */}
          {viewMode === 'kanban' && (() => {
            const visibleKanbanColumns = fullscreenKanbanColumn
              ? kanbanColumns.filter(c => c.key === fullscreenKanbanColumn)
              : kanbanColumns.filter(c => !hiddenKanbanColumns.has(c.key))
            const hiddenColumnsInfo = kanbanColumns.filter(c => hiddenKanbanColumns.has(c.key))

            return (
              <div className="space-y-4">
                {/* Kanban Organization Selector */}
                <div className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-4 py-2">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-700">Organize by:</span>
                    <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                      {KANBAN_ORGANIZATION_OPTIONS.map(option => (
                        <button key={option.value}
                          onClick={() => { setKanbanOrganization(option.value); setKanbanColumnSearch({}); setHiddenKanbanColumns(new Set()); setFullscreenKanbanColumn(null) }}
                          className={clsx('flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                            kanbanOrganization === option.value ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                          )}>
                          <option.icon className="w-3.5 h-3.5" />{option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {fullscreenKanbanColumn && (
                      <button onClick={() => setFullscreenKanbanColumn(null)} className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-blue-600 bg-blue-50 rounded-md">
                        <Minimize2 className="w-3.5 h-3.5" />Exit Fullscreen
                      </button>
                    )}
                    <div className="text-sm text-gray-500">{filteredAssets.length} assets in {visibleKanbanColumns.length} columns</div>
                    {hiddenColumnsInfo.length > 0 && !fullscreenKanbanColumn && (
                      <div className="flex items-center gap-1.5 border-l border-gray-200 pl-3">
                        <span className="text-xs text-gray-400">Hidden:</span>
                        {hiddenColumnsInfo.map(col => (
                          <button key={col.key} onClick={() => { const newHidden = new Set(hiddenKanbanColumns); newHidden.delete(col.key); setHiddenKanbanColumns(newHidden) }}
                            className="flex items-center gap-1 px-1.5 py-0.5 text-xs bg-gray-100 hover:bg-gray-200 rounded">
                            <Eye className="w-3 h-3 text-gray-400" /><span className="text-gray-600">{col.label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Kanban Board */}
                <div className="grid gap-4" style={{ gridTemplateColumns: fullscreenKanbanColumn ? '1fr' : `repeat(${Math.min(visibleKanbanColumns.length, 8)}, minmax(200px, 1fr))` }}>
                  {visibleKanbanColumns.map(column => {
                    const searchTerm = kanbanColumnSearch[column.key] || ''
                    const filteredColumnAssets = searchTerm
                      ? column.assets.filter((a: any) => a.symbol?.toLowerCase().includes(searchTerm.toLowerCase()) || a.company_name?.toLowerCase().includes(searchTerm.toLowerCase()))
                      : column.assets
                    const isFullscreen = fullscreenKanbanColumn === column.key

                    return (
                      <div key={column.key} className={clsx('flex flex-col bg-gray-50 rounded-lg border border-gray-200', isFullscreen ? 'min-h-[600px]' : 'min-h-[400px]')}
                        onDragOver={handleKanbanDragOver} onDrop={() => kanbanOrganization === 'priority' && handleKanbanDrop(column.key)}>
                        {/* Column Header */}
                        <div className={clsx('px-3 py-2 border-b border-gray-200 rounded-t-lg', column.color)} style={(column as any).bgColor ? { backgroundColor: `${(column as any).bgColor}20` } : undefined}>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-sm truncate flex-shrink-0">{column.label}</h3>
                            <span className="text-xs opacity-75 bg-white/50 px-1.5 py-0.5 rounded flex-shrink-0">{filteredColumnAssets.length}</span>
                            <div className="relative flex-1 min-w-0">
                              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                              <input type="text" placeholder="Search..." value={searchTerm}
                                onChange={(e) => setKanbanColumnSearch(prev => ({ ...prev, [column.key]: e.target.value }))}
                                className="w-full pl-7 pr-2 py-1 text-xs bg-white border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500" />
                            </div>
                            <div className="flex items-center gap-0.5 flex-shrink-0">
                              {isFullscreen ? (
                                <button onClick={() => setFullscreenKanbanColumn(null)} className="p-1 rounded hover:bg-white/50 text-gray-500"><Minimize2 className="w-3.5 h-3.5" /></button>
                              ) : (
                                <><button onClick={() => setFullscreenKanbanColumn(column.key)} className="p-1 rounded hover:bg-white/50 text-gray-500"><Maximize2 className="w-3.5 h-3.5" /></button>
                                <button onClick={() => { const newHidden = new Set(hiddenKanbanColumns); newHidden.add(column.key); setHiddenKanbanColumns(newHidden) }} className="p-1 rounded hover:bg-white/50 text-gray-500"><EyeOff className="w-3.5 h-3.5" /></button></>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Column Content */}
                        <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[500px]">
                          {filteredColumnAssets.map((asset: any) => {
                            const isSelected = selectedAssetIds.has(asset.id)
                            return (
                              <div key={asset.id} draggable={kanbanOrganization === 'priority'} onDragStart={() => kanbanOrganization === 'priority' && handleKanbanDragStart(asset.id)}
                                onClick={() => selectionMode ? toggleAssetSelection(asset.id) : handleAssetClick(asset)}
                                className={clsx('bg-white rounded-lg border p-3 hover:shadow-md transition-shadow',
                                  kanbanOrganization === 'priority' ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                                  draggedAsset === asset.id && 'opacity-50',
                                  isSelected ? 'border-blue-400 bg-blue-50' : 'border-gray-200'
                                )}>
                                <div className="flex items-start justify-between mb-2">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      {selectionMode && (isSelected ? <CheckSquare className="h-4 w-4 text-blue-600 flex-shrink-0" /> : <Square className="h-4 w-4 text-gray-400 flex-shrink-0" />)}
                                      <p className="font-semibold text-gray-900 text-sm">{asset.symbol}</p>
                                    </div>
                                    <p className="text-xs text-gray-600 truncate">{asset.company_name}</p>
                                  </div>
                                  {kanbanOrganization === 'priority' && <GripHorizontal className="w-4 h-4 text-gray-300 flex-shrink-0" />}
                                </div>
                                {asset.sector && <p className="text-xs text-gray-500 mb-2">{asset.sector}</p>}
                                <div className="flex items-center justify-between gap-2">
                                  {(() => { const quote = getQuote(asset.symbol); const displayPrice = (showLivePrices && quote?.price) || asset.current_price; return displayPrice ? <span className="text-xs font-medium text-gray-900">${Number(displayPrice).toFixed(2)}</span> : <span /> })()}
                                  {kanbanOrganization === 'priority' && asset.process_stage && PROCESS_STAGES[asset.process_stage] && (
                                    <span className={clsx('px-1.5 py-0.5 text-[10px] font-medium rounded-full', PROCESS_STAGES[asset.process_stage].color)}>{PROCESS_STAGES[asset.process_stage].label}</span>
                                  )}
                                  {kanbanOrganization !== 'priority' && (() => {
                                    const userPriority = getUserPriority(asset.id)
                                    const config = userPriority && userPriority !== 'none' ? PRIORITY_CONFIG[userPriority] : null
                                    const IconComponent = config?.icon
                                    return config ? (
                                      <span className={clsx('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-white', config.bg)}>
                                        {IconComponent && <IconComponent className="w-2.5 h-2.5" />}
                                        <span>{config.label}</span>
                                      </span>
                                    ) : null
                                  })()}
                                </div>
                              </div>
                            )
                          })}
                          {filteredColumnAssets.length === 0 && (
                            <div className="text-center py-8 text-gray-400"><p className="text-xs">{searchTerm ? `No matches for "${searchTerm}"` : kanbanOrganization === 'priority' ? 'Drop assets here' : 'No assets'}</p></div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* TREE VIEW */}
          {viewMode === 'tree' && treeData && (
            <Card padding="none">
              <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
                <div className="flex items-center gap-2"><FolderTree className="w-4 h-4 text-gray-500" /><span className="text-sm font-medium text-gray-700">Organize by:</span></div>
                <div className="flex items-center gap-1 bg-white rounded-lg border border-gray-200 p-0.5">
                  {(['sector', 'priority', 'theme'] as TreeOrganization[]).map(option => (
                    <button key={option} onClick={() => setTreeOrganization(option)}
                      className={clsx('px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize', treeOrganization === option ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100')}>
                      {option}
                    </button>
                  ))}
                </div>
              </div>
              <div className="p-4">
                {Array.from(treeData.children.entries()).map(([groupName, groupNode]) => {
                  const groupKey = `group-${groupName}`
                  const isGroupExpanded = expandedTreeNodes.has(groupKey)
                  const groupAssetCount = groupNode.assets.length

                  return (
                    <div key={groupName} className="mb-2">
                      <button onClick={() => toggleTreeNode(groupKey)} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 rounded-lg transition-colors">
                        <ChevronRight className={clsx('w-4 h-4 text-gray-400 transition-transform', isGroupExpanded && 'rotate-90')} />
                        <span className="font-medium text-gray-900">{groupName}</span>
                        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{groupAssetCount}</span>
                      </button>
                      {isGroupExpanded && (
                        <div className="ml-6 border-l border-gray-200 pl-2">
                          {groupNode.assets.map((asset: any) => {
                            const isSelected = selectedAssetIds.has(asset.id)
                            return (
                              <div key={asset.id} onClick={() => selectionMode ? toggleAssetSelection(asset.id) : handleAssetClick(asset)}
                                className={clsx('flex items-center justify-between px-3 py-2 hover:bg-gray-50 rounded-lg cursor-pointer transition-colors', isSelected && 'bg-blue-50')}>
                                <div className="flex items-center gap-2">
                                  {selectionMode && (isSelected ? <CheckSquare className="h-4 w-4 text-blue-600" /> : <Square className="h-4 w-4 text-gray-400" />)}
                                  <div className="w-2 h-2 rounded-full bg-gray-300" />
                                  <span className="font-medium text-gray-900">{asset.symbol}</span>
                                  <span className="text-sm text-gray-600">{asset.company_name}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  {(() => { const quote = getQuote(asset.symbol); const displayPrice = (showLivePrices && quote?.price) || asset.current_price; return displayPrice ? <span className="text-sm font-medium text-gray-900">${Number(displayPrice).toFixed(2)}</span> : null })()}
                                  {(() => {
                                    const userPriority = getUserPriority(asset.id)
                                    const config = userPriority && userPriority !== 'none' ? PRIORITY_CONFIG[userPriority] : null
                                    const IconComponent = config?.icon
                                    return config ? (
                                      <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium text-white', config.bg)}>
                                        {IconComponent && <IconComponent className="w-3 h-3" />}
                                        <span>{config.label}</span>
                                      </span>
                                    ) : null
                                  })()}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
                {treeData.children.size === 0 && (
                  <div className="text-center py-8 text-gray-500"><FolderTree className="w-12 h-12 mx-auto mb-3 text-gray-300" /><p>No assets to display in tree view</p></div>
                )}
              </div>
            </Card>
          )}
        </>
      ) : (
        fillHeight ? (
          <div className="flex-1 flex items-center justify-center">
            {emptyState || (
              <div className="text-center">
                <EmptyState icon={Search} title="No assets found" description={activeFilters.length > 0 ? "Try adjusting your filters" : "No assets available"} />
              </div>
            )}
          </div>
        ) : (
          emptyState || (
            <Card padding="none">
              <div className="p-12 text-center">
                <EmptyState icon={Search} title="No assets found" description={activeFilters.length > 0 ? "Try adjusting your filters" : "No assets available"} />
              </div>
            </Card>
          )
        )
      )}

      {/* Row Context Menu */}
      {rowContextMenu && (
        <div
          className="row-context-menu fixed z-[100] w-48 bg-white rounded-lg shadow-xl border border-gray-200 py-1 animate-in fade-in slide-in-from-top-2 duration-100"
          style={{ left: rowContextMenu.x, top: rowContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              const asset = assets.find(a => a.id === rowContextMenu.assetId)
              if (asset) cycleFlag(asset.id)
            }}
            className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
          >
            <Flag className="w-4 h-4 text-gray-500" />
            Toggle Flag
          </button>
          <button
            onClick={() => {
              toggleRowExpansion(rowContextMenu.assetId)
              setRowContextMenu(null)
            }}
            className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
          >
            <ChevronRight className="w-4 h-4 text-gray-500" />
            {expandedRows.has(rowContextMenu.assetId) ? 'Collapse' : 'Expand'} Row
          </button>
          <div className="h-px bg-gray-100 my-1" />
          {onRemoveFromList ? (
            <button
              onClick={() => {
                onRemoveFromList(rowContextMenu.assetId)
                setRowContextMenu(null)
              }}
              className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
            >
              <X className="w-4 h-4" />
              Remove from List
            </button>
          ) : (
            <button
              onClick={() => {
                if (confirm('Are you sure you want to delete this asset?')) {
                  deleteAssetMutation.mutate(rowContextMenu.assetId)
                }
              }}
              className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Delete Asset
            </button>
          )}
        </div>
      )}

      {/* Keyboard help button - bottom right corner */}
      {viewMode === 'table' && (
        <button
          onClick={() => setShowKeyboardHelp(true)}
          className="fixed bottom-4 right-4 p-2 bg-white rounded-full shadow-lg border border-gray-200 text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors z-40"
          title="Keyboard shortcuts (?)"
        >
          <Keyboard className="w-4 h-4" />
        </button>
      )}

      {/* Keyboard Help Modal */}
      <KeyboardHelpModal
        isOpen={showKeyboardHelp}
        onClose={() => setShowKeyboardHelp(false)}
      />

      {/* Content Source Selector */}
      {contentSourceSelector && (
        <ContentSourceSelector
          columnId={contentSourceSelector.columnId}
          columnLabel={contentSourceSelector.columnLabel}
          position={contentSourceSelector.position}
          assetId={contentSourceSelector.assetId}
          onClose={() => setContentSourceSelector(null)}
        />
      )}

      {/* AI Column Library Dropdown */}
      {showAIColumnLibrary && (
        <AIColumnLibraryDropdown
          position={showAIColumnLibrary}
          onClose={() => setShowAIColumnLibrary(null)}
          onQuickPrompt={() => setShowQuickPrompt(showAIColumnLibrary)}
          onCreateColumn={() => setShowCreateAIColumnModal(true)}
        />
      )}

      {/* Create AI Column Modal */}
      <CreateAIColumnModal
        isOpen={showCreateAIColumnModal}
        onClose={() => setShowCreateAIColumnModal(false)}
        onSuccess={(column) => {
          addColumnToView?.(column.id)
        }}
      />

      {/* Quick Prompt Input */}
      {showQuickPrompt && (
        <QuickPromptInput
          position={showQuickPrompt}
          onClose={() => setShowQuickPrompt(null)}
          onRun={(prompt) => {
            // Create temporary quick prompt column
            setQuickPromptColumn({
              id: `temp_${Date.now()}`,
              name: prompt.length > 30 ? prompt.slice(0, 30) + '...' : prompt,
              prompt,
            })
            setShowQuickPrompt(null)
          }}
          onSaveToLibrary={(prompt) => {
            setShowQuickPrompt(null)
            setShowCreateAIColumnModal(true)
            // The prompt will be pre-filled when modal opens
          }}
        />
      )}

      {/* Priority Column Picker */}
      {priorityColumnPicker && createPortal(
        <div
          className="fixed w-72 bg-white rounded-lg shadow-xl border border-gray-200 z-[9999] overflow-hidden animate-in fade-in zoom-in-95 duration-100 priority-column-picker"
          style={{
            left: Math.min(priorityColumnPicker.x, window.innerWidth - 300),
            top: Math.min(priorityColumnPicker.y, window.innerHeight - 400)
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2 border-b border-gray-100 bg-gradient-to-r from-orange-50 to-amber-50">
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <Flag className="w-4 h-4 text-orange-500" />
              Add Priority Column
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">Choose whose priority to display</p>
          </div>

          {/* Quick Options */}
          <div className="p-2 border-b border-gray-100 space-y-1">
            <button
              onClick={() => {
                addPriorityColumn('my')
                setPriorityColumnPicker(null)
                setPriorityColumnPickerSearch('')
              }}
              className="w-full px-3 py-2 text-left text-sm hover:bg-orange-50 rounded-md flex items-center gap-2 text-gray-700"
            >
              <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-xs font-medium text-blue-700">
                {user?.first_name?.[0] || user?.email?.[0]?.toUpperCase() || 'M'}
              </div>
              <span>My Priority</span>
              <span className="ml-auto text-xs text-gray-400">Your own ratings</span>
            </button>
            <button
              onClick={() => {
                addPriorityColumn('firm')
                setPriorityColumnPicker(null)
                setPriorityColumnPickerSearch('')
              }}
              className="w-full px-3 py-2 text-left text-sm hover:bg-orange-50 rounded-md flex items-center gap-2 text-gray-700"
            >
              <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center">
                <Users className="w-3.5 h-3.5 text-purple-600" />
              </div>
              <span>Firm Priority</span>
              <span className="ml-auto text-xs text-gray-400">Team average</span>
            </button>
          </div>

          {/* Search Team Members */}
          <div className="p-2 border-b border-gray-100">
            <input
              type="text"
              autoFocus
              value={priorityColumnPickerSearch}
              onChange={(e) => setPriorityColumnPickerSearch(e.target.value)}
              placeholder="Search team members..."
              className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-400"
            />
          </div>

          {/* Team Member List */}
          <div className="max-h-48 overflow-y-auto p-1">
            {teamMembers
              .filter(member =>
                member.id !== user?.id && // Don't show current user
                (!priorityColumnPickerSearch ||
                  `${member.first_name || ''} ${member.last_name || ''} ${member.email}`.toLowerCase().includes(priorityColumnPickerSearch.toLowerCase()))
              )
              .map(member => {
                const name = `${member.first_name || ''} ${member.last_name || ''}`.trim() || member.email
                const initials = member.first_name?.[0] || member.email[0]?.toUpperCase() || '?'
                return (
                  <button
                    key={member.id}
                    onClick={() => {
                      addPriorityColumn('user', member.id, name)
                      setPriorityColumnPicker(null)
                      setPriorityColumnPickerSearch('')
                    }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-orange-50 rounded-md flex items-center gap-2 text-gray-700"
                  >
                    <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-xs font-medium text-gray-700">
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{name}</div>
                      {member.first_name && (
                        <div className="text-xs text-gray-400 truncate">{member.email}</div>
                      )}
                    </div>
                  </button>
                )
              })}
            {teamMembers.filter(m =>
              m.id !== user?.id &&
              (!priorityColumnPickerSearch ||
                `${m.first_name || ''} ${m.last_name || ''} ${m.email}`.toLowerCase().includes(priorityColumnPickerSearch.toLowerCase()))
            ).length === 0 && (
              <div className="px-3 py-4 text-center text-sm text-gray-500">
                {priorityColumnPickerSearch ? 'No matching team members' : 'No other team members'}
              </div>
            )}
          </div>

          {/* Close Button */}
          <div className="p-2 border-t border-gray-100">
            <button
              onClick={() => {
                setPriorityColumnPicker(null)
                setPriorityColumnPickerSearch('')
              }}
              className="w-full px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-md"
            >
              Cancel
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Priority Source Selector (for changing existing column's source) */}
      {prioritySourceSelector && createPortal(
        <div
          className="fixed w-72 bg-white rounded-lg shadow-xl border border-gray-200 z-[9999] overflow-hidden animate-in fade-in zoom-in-95 duration-100 priority-source-selector"
          style={{
            left: Math.min(prioritySourceSelector.position.x, window.innerWidth - 300),
            top: Math.min(prioritySourceSelector.position.y, window.innerHeight - 400)
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2 border-b border-gray-100 bg-gradient-to-r from-purple-50 to-indigo-50">
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <Users className="w-4 h-4 text-purple-500" />
              Change Priority Source
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">{prioritySourceSelector.columnLabel} column</p>
          </div>

          {/* Source Options */}
          <div className="p-2 border-b border-gray-100 space-y-1">
            <button
              onClick={() => {
                changePriorityColumnSource(prioritySourceSelector.columnId, 'my')
                setPrioritySourceSelector(null)
                setPrioritySourceSearch('')
              }}
              className={clsx(
                "w-full px-3 py-2 text-left text-sm rounded-md flex items-center gap-2",
                prioritySourceSelector.currentSource === 'my'
                  ? "bg-purple-50 text-purple-700 border border-purple-200"
                  : "hover:bg-purple-50 text-gray-700"
              )}
            >
              <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-xs font-medium text-blue-700">
                {user?.first_name?.[0] || user?.email?.[0]?.toUpperCase() || 'M'}
              </div>
              <span>My Priority</span>
              {prioritySourceSelector.currentSource === 'my' && (
                <Check className="w-4 h-4 ml-auto text-purple-600" />
              )}
            </button>
            <button
              onClick={() => {
                changePriorityColumnSource(prioritySourceSelector.columnId, 'firm')
                setPrioritySourceSelector(null)
                setPrioritySourceSearch('')
              }}
              className={clsx(
                "w-full px-3 py-2 text-left text-sm rounded-md flex items-center gap-2",
                prioritySourceSelector.currentSource === 'firm'
                  ? "bg-purple-50 text-purple-700 border border-purple-200"
                  : "hover:bg-purple-50 text-gray-700"
              )}
            >
              <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center">
                <Users className="w-3.5 h-3.5 text-purple-600" />
              </div>
              <span>Firm Priority</span>
              <span className="text-xs text-gray-400">Team average</span>
              {prioritySourceSelector.currentSource === 'firm' && (
                <Check className="w-4 h-4 ml-auto text-purple-600" />
              )}
            </button>
          </div>

          {/* Search Team Members */}
          <div className="p-2 border-b border-gray-100">
            <input
              type="text"
              autoFocus
              value={prioritySourceSearch}
              onChange={(e) => setPrioritySourceSearch(e.target.value)}
              placeholder="Search team members..."
              className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-400"
            />
          </div>

          {/* Team Member List */}
          <div className="max-h-48 overflow-y-auto p-1">
            {teamMembers
              .filter(member =>
                member.id !== user?.id &&
                (!prioritySourceSearch ||
                  `${member.first_name || ''} ${member.last_name || ''} ${member.email}`.toLowerCase().includes(prioritySourceSearch.toLowerCase()))
              )
              .map(member => {
                const name = `${member.first_name || ''} ${member.last_name || ''}`.trim() || member.email
                const initials = member.first_name?.[0] || member.email[0]?.toUpperCase() || '?'
                const isSelected = prioritySourceSelector.currentSource === 'user' && prioritySourceSelector.currentUserId === member.id
                return (
                  <button
                    key={member.id}
                    onClick={() => {
                      changePriorityColumnSource(prioritySourceSelector.columnId, 'user', member.id, name)
                      setPrioritySourceSelector(null)
                      setPrioritySourceSearch('')
                    }}
                    className={clsx(
                      "w-full px-3 py-2 text-left text-sm rounded-md flex items-center gap-2",
                      isSelected
                        ? "bg-purple-50 text-purple-700 border border-purple-200"
                        : "hover:bg-purple-50 text-gray-700"
                    )}
                  >
                    <div className={clsx(
                      "w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium",
                      isSelected ? "bg-purple-200 text-purple-700" : "bg-gray-100 text-gray-700"
                    )}>
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{name}</div>
                      {member.first_name && (
                        <div className="text-xs text-gray-400 truncate">{member.email}</div>
                      )}
                    </div>
                    {isSelected && (
                      <Check className="w-4 h-4 text-purple-600 flex-shrink-0" />
                    )}
                  </button>
                )
              })}
            {teamMembers.filter(m =>
              m.id !== user?.id &&
              (!prioritySourceSearch ||
                `${m.first_name || ''} ${m.last_name || ''} ${m.email}`.toLowerCase().includes(prioritySourceSearch.toLowerCase()))
            ).length === 0 && (
              <div className="px-3 py-4 text-center text-sm text-gray-500">
                {prioritySourceSearch ? 'No matching team members' : 'No other team members'}
              </div>
            )}
          </div>

          {/* Close Button */}
          <div className="p-2 border-t border-gray-100">
            <button
              onClick={() => {
                setPrioritySourceSelector(null)
                setPrioritySourceSearch('')
              }}
              className="w-full px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-md"
            >
              Cancel
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

// ============================================================================
// Inline Insert Row Component - appears in the table when Ctrl+I is pressed
// ============================================================================

interface InlineInsertRowProps {
  rowIndex: number
  densityRowHeight: number
  densityConfig: typeof DENSITY_CONFIG['comfortable']
  totalTableWidth: number
  visibleColumns: ColumnConfig[]
  existingAssetIds: string[]
  inputRef: React.RefObject<HTMLInputElement>
  onInsert: (assetId: string, symbol: string) => Promise<boolean>
  onCancel: () => void
}

function InlineInsertRow({
  rowIndex,
  densityRowHeight,
  densityConfig,
  totalTableWidth,
  visibleColumns,
  existingAssetIds,
  inputRef,
  onInsert,
  onCancel
}: InlineInsertRowProps) {
  const [inputValue, setInputValue] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [isInserting, setIsInserting] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number } | null>(null)

  // Focus input on mount
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }, [inputRef])

  // Search function
  const performSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([])
      return
    }

    setIsSearching(true)
    try {
      const { data, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name, sector')
        .or(`symbol.ilike.%${query}%,company_name.ilike.%${query}%`)
        .limit(8)

      if (!error && data) {
        const existingSet = new Set(existingAssetIds)
        setSearchResults(data.filter(a => !existingSet.has(a.id)))
      }
    } catch (e) {
      console.error('Search error:', e)
    } finally {
      setIsSearching(false)
    }
  }, [existingAssetIds])

  // Debounced search
  useEffect(() => {
    if (!inputValue.trim()) {
      setSearchResults([])
      return
    }

    const timer = setTimeout(() => {
      performSearch(inputValue)
    }, 150)

    return () => clearTimeout(timer)
  }, [inputValue, performSearch])

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(0)
  }, [searchResults])

  // Update dropdown position when results appear
  useEffect(() => {
    if (searchResults.length > 0 && rowRef.current) {
      const rect = rowRef.current.getBoundingClientRect()
      setDropdownPosition({
        top: rect.bottom + 4,
        left: rect.left + 40 // Offset for alignment
      })
    } else {
      setDropdownPosition(null)
    }
  }, [searchResults.length])

  // Handle insert and clear input for continued adding
  const handleInsert = async (assetId: string, symbol: string) => {
    if (isInserting) return
    setIsInserting(true)
    const success = await onInsert(assetId, symbol)
    setIsInserting(false)
    if (success) {
      setInputValue('')
      setSearchResults([])
      // Use requestAnimationFrame to refocus after the current render cycle
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
    }
  }

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      if (searchResults.length > 0) {
        e.preventDefault()
        setSelectedIndex(prev => Math.min(prev + 1, searchResults.length - 1))
      }
    } else if (e.key === 'ArrowUp') {
      if (searchResults.length > 0 && selectedIndex > 0) {
        e.preventDefault()
        setSelectedIndex(prev => prev - 1)
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (searchResults.length > 0 && searchResults[selectedIndex]) {
        const asset = searchResults[selectedIndex]
        handleInsert(asset.id, asset.symbol)
      } else if (inputValue.trim()) {
        const exactMatch = searchResults.find(
          a => a.symbol.toUpperCase() === inputValue.toUpperCase()
        )
        if (exactMatch) {
          handleInsert(exactMatch.id, exactMatch.symbol)
        }
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onCancel()
    }
  }

  // Calculate position - should appear below the selected row
  const yPosition = (rowIndex + 1) * densityRowHeight

  return (
    <>
      <div
        ref={rowRef}
        className="pro-table-row absolute top-0 left-0 w-full bg-blue-50 border-y border-blue-300"
        style={{
          height: densityRowHeight,
          transform: `translateY(${yPosition}px)`,
          minWidth: totalTableWidth,
          zIndex: 10
        }}
      >
        <div className="flex items-center" style={{ minWidth: totalTableWidth, height: densityRowHeight }}>
          {visibleColumns.map((col) => (
            <div
              key={col.id}
              className={clsx(
                'h-full flex items-center',
                densityConfig.padding,
                densityConfig.fontSize
              )}
              style={{ width: col.width, minWidth: col.minWidth }}
            >
              {col.id === 'select' && (
                <Plus className="h-4 w-4 text-blue-500" />
              )}
              {col.id === 'ticker' && (
                <div className="flex-1 flex items-center gap-2">
                  <input
                    ref={inputRef}
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value.toUpperCase())}
                    onKeyDown={handleKeyDown}
                    placeholder="Type ticker..."
                    className="flex-1 bg-transparent border-none outline-none text-sm text-gray-900 placeholder:text-gray-400"
                    disabled={isInserting}
                  />
                  {isSearching && (
                    <Loader2 className="h-3.5 w-3.5 text-gray-400 animate-spin" />
                  )}
                  {isInserting && (
                    <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Search results dropdown - using portal to escape overflow:hidden */}
      {searchResults.length > 0 && dropdownPosition && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] w-80 bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden"
          style={{ top: dropdownPosition.top, left: dropdownPosition.left }}
        >
          {searchResults.map((asset, idx) => (
            <button
              key={asset.id}
              onClick={() => handleInsert(asset.id, asset.symbol)}
              onMouseEnter={() => setSelectedIndex(idx)}
              className={clsx(
                'w-full px-3 py-2 text-left flex items-center justify-between hover:bg-gray-50 transition-colors',
                idx === selectedIndex && 'bg-blue-50'
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900">{asset.symbol}</span>
                  <span className="text-xs text-gray-500 truncate">{asset.company_name}</span>
                </div>
                {asset.sector && (
                  <span className="text-xs text-gray-400">{asset.sector}</span>
                )}
              </div>
              <Plus className="h-4 w-4 text-gray-400 flex-shrink-0" />
            </button>
          ))}
          <div className="px-3 py-1.5 text-xs text-gray-400 border-t border-gray-100 bg-gray-50">
            ↑↓ navigate · Enter add · Esc exit
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

// ============================================================================

interface InlineAddRowProps {
  listId: string
  existingAssetIds: string[]
  columns: ColumnConfig[]
  density: DensityMode
  densityConfig: typeof DENSITY_CONFIG['comfortable']
  totalTableWidth: number
  queryClient: any
  user: any
  inputRef?: React.RefObject<HTMLInputElement>
  onExitUp?: () => void // Called when user presses up arrow to exit
}

function InlineAddRow({
  listId,
  existingAssetIds,
  columns,
  density,
  densityConfig,
  totalTableWidth,
  queryClient,
  user,
  inputRef: externalInputRef,
  onExitUp
}: InlineAddRowProps) {
  const [inputValue, setInputValue] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const internalInputRef = useRef<HTMLInputElement>(null)
  const inputRef = externalInputRef || internalInputRef
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Search function
  const performSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([])
      return
    }

    setIsSearching(true)
    try {
      const { data, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name, sector')
        .or(`symbol.ilike.%${query}%,company_name.ilike.%${query}%`)
        .limit(8)

      if (!error && data) {
        // Filter out already existing assets
        const existingSet = new Set(existingAssetIds)
        setSearchResults(data.filter(a => !existingSet.has(a.id)))
      }
    } catch (e) {
      console.error('Search error:', e)
    } finally {
      setIsSearching(false)
    }
  }, [existingAssetIds])

  // Debounced search effect
  useEffect(() => {
    if (!inputValue.trim()) {
      setSearchResults([])
      return
    }

    const timer = setTimeout(() => {
      performSearch(inputValue)
    }, 150)

    return () => clearTimeout(timer)
  }, [inputValue, performSearch])

  // Parse tickers from pasted text (handles Excel, Word, PDF, etc.)
  const parseTickers = (input: string): string[] => {
    return input
      .toUpperCase()
      .split(/[,\s;\n\r\t]+/)
      .map(t => t.trim())
      .filter(t => t.length > 0 && t.length <= 10 && /^[A-Z0-9.^-]+$/.test(t))
  }

  // Add asset mutation
  const addAsset = async (assetId: string, symbol: string) => {
    try {
      const { error } = await supabase
        .from('asset_list_items')
        .insert({
          list_id: listId,
          asset_id: assetId,
          added_by: user?.id
        })

      if (error) throw error

      queryClient.invalidateQueries({ queryKey: ['asset-list-items', listId] })
      queryClient.invalidateQueries({ queryKey: ['asset-lists'] })
      setInputValue('')
      setSearchResults([])
      setFeedback({ type: 'success', message: `Added ${symbol}` })
      setTimeout(() => setFeedback(null), 1500)
      inputRef.current?.focus()
    } catch (e) {
      setFeedback({ type: 'error', message: 'Failed to add' })
      setTimeout(() => setFeedback(null), 2000)
    }
  }

  // Handle paste - supports multiple tickers from Excel, Word, PDF, etc.
  const handlePaste = async (e: React.ClipboardEvent) => {
    const pastedText = e.clipboardData.getData('text')
    const tickers = parseTickers(pastedText)

    // If single ticker or less, let default behavior handle it
    if (tickers.length <= 1) return

    e.preventDefault()
    setIsSearching(true)
    setFeedback(null)

    try {
      const existingSet = new Set(existingAssetIds)

      // Lookup all tickers in batch
      const { data: assets, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name')
        .in('symbol', tickers)

      if (error) throw error

      const assetMap = new Map(assets?.map(a => [a.symbol, a]) || [])

      // Separate valid, duplicate, and invalid
      const toAdd: { id: string; symbol: string }[] = []
      const duplicates: string[] = []
      const notFound: string[] = []

      for (const ticker of tickers) {
        const asset = assetMap.get(ticker)
        if (!asset) {
          notFound.push(ticker)
        } else if (existingSet.has(asset.id)) {
          duplicates.push(ticker)
        } else {
          toAdd.push({ id: asset.id, symbol: asset.symbol })
          existingSet.add(asset.id) // Prevent duplicates within the paste
        }
      }

      // Add all valid tickers
      if (toAdd.length > 0) {
        const insertData = toAdd.map(a => ({
          list_id: listId,
          asset_id: a.id,
          added_by: user?.id
        }))

        const { error: insertError } = await supabase
          .from('asset_list_items')
          .insert(insertData)

        if (insertError) throw insertError

        queryClient.invalidateQueries({ queryKey: ['asset-list-items', listId] })
        queryClient.invalidateQueries({ queryKey: ['asset-lists'] })
      }

      // Show feedback
      const parts: string[] = []
      if (toAdd.length > 0) parts.push(`Added ${toAdd.length}`)
      if (duplicates.length > 0) parts.push(`${duplicates.length} already in list`)
      if (notFound.length > 0) parts.push(`${notFound.length} not found`)

      setFeedback({
        type: toAdd.length > 0 ? 'success' : 'error',
        message: parts.join(', ')
      })
      setTimeout(() => setFeedback(null), 3000)
      setInputValue('')

    } catch (e) {
      console.error('Paste error:', e)
      setFeedback({ type: 'error', message: 'Failed to add tickers' })
      setTimeout(() => setFeedback(null), 2000)
    } finally {
      setIsSearching(false)
    }
  }

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      if (searchResults.length > 0) {
        e.preventDefault()
        setSelectedIndex(prev => Math.min(prev + 1, searchResults.length - 1))
      }
    } else if (e.key === 'ArrowUp') {
      if (searchResults.length > 0 && selectedIndex > 0) {
        // Navigate within search results
        e.preventDefault()
        setSelectedIndex(prev => prev - 1)
      } else {
        // Exit up to table
        e.preventDefault()
        inputRef.current?.blur()
        onExitUp?.()
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (searchResults.length > 0 && searchResults[selectedIndex]) {
        const asset = searchResults[selectedIndex]
        addAsset(asset.id, asset.symbol)
      } else if (inputValue.trim()) {
        // Try exact match
        const exactMatch = searchResults.find(
          a => a.symbol.toUpperCase() === inputValue.toUpperCase()
        )
        if (exactMatch) {
          addAsset(exactMatch.id, exactMatch.symbol)
        }
      }
    } else if (e.key === 'Escape') {
      setInputValue('')
      setSearchResults([])
      inputRef.current?.blur()
    }
  }

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(0)
  }, [searchResults])

  const densityRowHeight = densityConfig.rowHeight
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number } | null>(null)
  const rowRef = useRef<HTMLDivElement>(null)

  // Update dropdown position when input is focused or results change
  useEffect(() => {
    if (searchResults.length > 0 && rowRef.current) {
      const rect = rowRef.current.getBoundingClientRect()
      setDropdownPosition({
        top: rect.bottom + 4,
        left: rect.left + 32 // Offset for the select column
      })
    } else {
      setDropdownPosition(null)
    }
  }, [searchResults.length])

  return (
    <>
      {/* The input row styled like a table row */}
      <div
        ref={rowRef}
        className="pro-table-row flex items-center border-t border-gray-200 bg-gray-50/50 hover:bg-gray-50"
        style={{ minWidth: totalTableWidth, height: densityRowHeight }}
      >
        {columns.map((col) => (
          <div
            key={col.id}
            className={clsx(
              'h-full flex items-center',
              densityConfig.padding,
              densityConfig.fontSize
            )}
            style={{ width: col.width, minWidth: col.minWidth }}
          >
            {col.id === 'select' && (
              <Plus className="h-4 w-4 text-gray-400" />
            )}
            {col.id === 'ticker' && (
              <div className="flex-1 flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={inputValue}
                  onChange={(e) => {
                    setInputValue(e.target.value)
                  }}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder="Type or paste tickers..."
                  className={clsx(
                    'flex-1 bg-transparent border-none outline-none text-gray-700 placeholder:text-gray-400',
                    (density === 'ultra' || density === 'micro') ? 'text-xs' : 'text-sm'
                  )}
                />
                {isSearching && (
                  <Loader2 className="h-3.5 w-3.5 text-gray-400 animate-spin" />
                )}
                {feedback && (
                  <span className={clsx(
                    'text-xs font-medium',
                    feedback.type === 'success' ? 'text-green-600' : 'text-red-600'
                  )}>
                    {feedback.message}
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Search results dropdown - using portal to escape overflow:hidden */}
      {searchResults.length > 0 && dropdownPosition && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] w-80 bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden"
          style={{ top: dropdownPosition.top, left: dropdownPosition.left }}
        >
          {searchResults.map((asset, idx) => (
            <button
              key={asset.id}
              onClick={() => addAsset(asset.id, asset.symbol)}
              onMouseEnter={() => setSelectedIndex(idx)}
              className={clsx(
                'w-full px-3 py-2 text-left flex items-center justify-between hover:bg-gray-50 transition-colors',
                idx === selectedIndex && 'bg-blue-50'
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900">{asset.symbol}</span>
                  <span className="text-xs text-gray-500 truncate">{asset.company_name}</span>
                </div>
                {asset.sector && (
                  <span className="text-xs text-gray-400">{asset.sector}</span>
                )}
              </div>
              <Plus className="h-4 w-4 text-gray-400 flex-shrink-0" />
            </button>
          ))}
          <div className="px-3 py-1.5 text-xs text-gray-400 border-t border-gray-100 bg-gray-50">
            ↑↓ navigate · Enter add · Esc clear
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

export default AssetTableView
