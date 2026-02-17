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
  ChevronRight, ChevronLeft, Pin, PinOff, Save, Columns3, GitBranch, FolderTree,
  Layers, GripHorizontal, FolderOpen, Folder, Maximize2, Minimize2, Users, FileEdit,
  Flag, Keyboard, HelpCircle, Sparkles, AlertTriangle, Zap, WrapText, FolderPlus
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
import { PriceTargetsSummary } from '../outcomes/PriceTargetsSummary'
import './table-styles.css'

// ============================================================================
// Types & Constants
// ============================================================================

type ViewMode = 'table' | 'kanban'
type GroupByOption = 'none' | 'sector' | 'priority' | 'stage' | 'listGroup' | 'contributor'
type DensityMode = 'comfortable' | 'compact' | 'ultra'
type KanbanOrganization = 'priority' | 'stage'

const GROUP_BY_OPTIONS: { value: GroupByOption; label: string; icon: any }[] = [
  { value: 'none', label: 'No Grouping', icon: List },
  { value: 'sector', label: 'By Sector', icon: Layers },
  { value: 'priority', label: 'By Priority', icon: AlertCircle },
  { value: 'stage', label: 'By Stage', icon: GitBranch }
]

const KANBAN_ORGANIZATION_OPTIONS: { value: KanbanOrganization; label: string; icon: any }[] = [
  { value: 'priority', label: 'Priority', icon: AlertCircle },
  { value: 'stage', label: 'Process Stage', icon: Target }
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
  { id: 'coverage', label: 'Covered By', visible: true, width: 140, minWidth: 100, sortable: true, pinned: false, category: 'research' },
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
  { id: 'listNote', label: 'List Note', visible: false, width: 180, minWidth: 100, sortable: false, pinned: false, category: 'research' },

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
  comfortable: 360,
  compact: 320,
  ultra: 260,
  micro: 220,
} as const

const RESEARCH_FIELDS = [
  { key: 'thesis', label: 'Thesis' },
  { key: 'bull_case', label: 'Bull Case' },
  { key: 'bear_case', label: 'Bear Case' },
  { key: 'base_case', label: 'Base Case' },
  { key: 'where_different', label: 'Where Different' },
  { key: 'risks_to_thesis', label: 'Key Risks' },
] as const

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
  /** Callback to remove a row from list. Receives the row ID (_rowId), not asset ID.
   *  In list context, rowId is the asset_list_items.id for that specific row. */
  onRemoveFromList?: (rowId: string) => void
  /** Per-row removal permission check. Takes the row ID (_rowId || asset.id).
   *  In collaborative lists, the same asset may appear twice with different owners;
   *  this check is per-row so each instance can have different removability. */
  canRemoveRow?: (rowId: string) => boolean
  /** Callback to update the list-specific note for a row */
  onUpdateListNote?: (rowId: string, note: string) => void
  /** List ID for inline add functionality */
  listId?: string
  /** IDs of assets already in the list (to prevent duplicates) */
  existingAssetIds?: string[]
  /** List group data for 'listGroup' grouping mode */
  listGroupData?: { id: string; name: string; color: string | null; sort_order: number }[]
  /** Override the initial groupBy option (e.g., 'contributor' for collaborative lists) */
  initialGroupBy?: GroupByOption
  /** Callback for manual reorder drag within a list */
  onReorderItem?: (fromIndex: number, toIndex: number) => void
  /** Callback for moving an item to a different list group */
  onMoveItemToGroup?: (assetId: string, groupId: string | null) => void
  /** Callback to rename a list group */
  onRenameGroup?: (groupId: string, name: string) => void
  /** Callback to delete a list group */
  onDeleteGroup?: (groupId: string) => void
  /** Callback to create a new list group */
  onCreateGroup?: (params: { name: string; color: string }) => void
  /** Callback to open "Create Trade Idea" modal for a specific asset */
  onCreateTradeIdea?: (assetId: string) => void
  /** Custom kanban boards saved to this list */
  kanbanBoards?: { id: string; name: string }[]
  /** Currently active kanban board ID */
  activeKanbanBoardId?: string | null
  /** Callback when user selects a kanban board (null = back to preset) */
  onSelectKanbanBoard?: (boardId: string | null) => void
  /** Callback to create a new kanban board — returns the created board */
  onCreateKanbanBoard?: (name: string) => Promise<{ id: string }>
  /** Callback to delete a kanban board */
  onDeleteKanbanBoard?: (boardId: string) => void
  /** Callback to rename a kanban board */
  onRenameKanbanBoard?: (boardId: string, name: string) => void
  /** Lanes for the active kanban board */
  kanbanBoardLanes?: { id: string; name: string; color: string; sort_order: number }[]
  /** Lane-item assignments for the active kanban board */
  kanbanBoardLaneItems?: { lane_id: string; asset_list_item_id: string }[]
  /** Callback to create a lane on the active board */
  onCreateKanbanLane?: (name: string, color: string) => void
  /** Callback to delete a lane */
  onDeleteKanbanLane?: (laneId: string) => void
  /** Callback to rename a lane */
  onRenameKanbanLane?: (laneId: string, name: string) => void
  /** Callback to assign an asset to a lane (takes asset ID, parent maps to list item ID) */
  onAssignToKanbanLane?: (laneId: string, assetId: string) => void
  /** Callback to remove an asset from its lane (takes asset ID) */
  onRemoveFromKanbanLane?: (assetId: string) => void
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
  canRemoveRow,
  onUpdateListNote,
  listId,
  existingAssetIds = [],
  listGroupData,
  initialGroupBy,
  onReorderItem,
  onMoveItemToGroup,
  onRenameGroup,
  onDeleteGroup,
  onCreateGroup,
  onCreateTradeIdea,
  kanbanBoards,
  activeKanbanBoardId,
  onSelectKanbanBoard,
  onCreateKanbanBoard,
  onDeleteKanbanBoard,
  onRenameKanbanBoard,
  kanbanBoardLanes,
  kanbanBoardLaneItems,
  onCreateKanbanLane,
  onDeleteKanbanLane,
  onRenameKanbanLane,
  onAssignToKanbanLane,
  onRemoveFromKanbanLane
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
  const [sortBy, setSortBy] = useState<string | null>('updated_at')
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
  const [draftColumns, setDraftColumns] = useState<ColumnConfig[]>([])
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)
  const [editingCell, setEditingCell] = useState<{ assetId: string; field: 'priority' | 'stage'; x: number; y: number } | null>(null)
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingNoteValue, setEditingNoteValue] = useState('')
  // List note inline editor state (keyed by _rowId, separate from asset notes)
  const [editingListNoteRowId, setEditingListNoteRowId] = useState<string | null>(null)
  const [editingListNoteValue, setEditingListNoteValue] = useState('')
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
  const [rowContextMenu, setRowContextMenu] = useState<{ assetId: string; rowId: string; x: number; y: number } | null>(null)

  // Grouping state
  const [groupBy, setGroupBy] = useState<GroupByOption>(initialGroupBy || 'none')
  const [showGroupByMenu, setShowGroupByMenu] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  // Group editing state (for listGroup inline rename and kebab menu)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [editingGroupName, setEditingGroupName] = useState('')
  const [groupKebabMenu, setGroupKebabMenu] = useState<{ groupId: string; x: number; y: number } | null>(null)

  // Inline new group creation state
  const [showInlineNewGroup, setShowInlineNewGroup] = useState(false)
  const [inlineNewGroupName, setInlineNewGroupName] = useState('')
  const [inlineNewGroupColor, setInlineNewGroupColor] = useState('#6366f1')
  const [showInlineColorPicker, setShowInlineColorPicker] = useState(false)
  const inlineNewGroupInputRef = useRef<HTMLInputElement>(null)

  // Group drag-and-drop state (for moving assets between custom groups)
  const [dragGroupAssetId, setDragGroupAssetId] = useState<string | null>(null)
  const [dragGroupSourceKey, setDragGroupSourceKey] = useState<string | null>(null)
  const [dropTargetGroupId, setDropTargetGroupId] = useState<string | null>(null)
  const dragExpandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Kanban state
  const [kanbanOrganization, setKanbanOrganization] = useState<KanbanOrganization>('priority')
  const [kanbanColumnSearch, setKanbanColumnSearch] = useState<Record<string, string>>({})
  const [hiddenKanbanColumns, setHiddenKanbanColumns] = useState<Set<string>>(new Set())
  const [fullscreenKanbanColumn, setFullscreenKanbanColumn] = useState<string | null>(null)
  const [draggedAsset, setDraggedAsset] = useState<string | null>(null)

  // Custom kanban lane management state
  const [showNewLaneInput, setShowNewLaneInput] = useState(false)
  const [newLaneName, setNewLaneName] = useState('')
  const [newLaneColor, setNewLaneColor] = useState('#6366f1')
  const [editingLaneId, setEditingLaneId] = useState<string | null>(null)
  const [editingLaneName, setEditingLaneName] = useState('')
  const [laneKebabMenu, setLaneKebabMenu] = useState<string | null>(null)
  const newLaneInputRef = useRef<HTMLInputElement>(null)

  // Custom kanban board creation state
  const [showNewBoardInput, setShowNewBoardInput] = useState(false)
  const [newBoardName, setNewBoardName] = useState('')
  const newBoardInputRef = useRef<HTMLInputElement>(null)
  const [editingBoardId, setEditingBoardId] = useState<string | null>(null)
  const [editingBoardName, setEditingBoardName] = useState('')
  const [boardKebabMenu, setBoardKebabMenu] = useState<string | null>(null)

  // Row drag-reorder state
  const [dragRowIndex, setDragRowIndex] = useState<number | null>(null)
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null)

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

    // When sortBy is null (manual mode), sort by _sortOrder (persisted drag order)
    if (sortBy === null) {
      filtered = [...filtered].sort((a, b) => (a._sortOrder ?? 999999) - (b._sortOrder ?? 999999))
    } else {
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
          case 'manual':
            aValue = a._sortOrder ?? 999999
            bValue = b._sortOrder ?? 999999
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
    }

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
        case 'listGroup': key = asset._listGroupId || '__ungrouped__'; break
        case 'contributor': key = asset._addedBy || '__unknown__'; break
        default: key = 'Other'
      }
      if (!groupMap.has(key)) groupMap.set(key, [])
      groupMap.get(key)!.push(asset)
    })

    // Convert to array with labels and colors
    groupMap.forEach((groupAssets, key) => {
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
      } else if (groupBy === 'listGroup') {
        if (key === '__ungrouped__') {
          label = 'Ungrouped'
        } else {
          const gd = listGroupData?.find(g => g.id === key)
          label = gd?.name || 'Unknown Group'
          if (gd?.color) color = gd.color
        }
      } else if (groupBy === 'contributor') {
        if (key === '__unknown__') {
          label = 'Unknown'
        } else if (key === user?.id) {
          label = 'You'
        } else {
          // Use the first asset's _addedByUser for display name
          const first = groupAssets[0]
          const u = first?._addedByUser
          if (u?.first_name && u?.last_name) label = `${u.first_name} ${u.last_name}`
          else if (u?.email) label = u.email
          else label = key
        }
      }

      groups.push({ key, label, color, assets: groupAssets })
    })

    // For listGroup mode, add empty groups from listGroupData that have no assets yet
    if (groupBy === 'listGroup' && listGroupData) {
      const existingKeys = new Set(groups.map(g => g.key))
      listGroupData.forEach(gd => {
        if (!existingKeys.has(gd.id)) {
          groups.push({ key: gd.id, label: gd.name, color: gd.color || undefined, assets: [] })
        }
      })
    }

    // Sort groups
    if (groupBy === 'priority') {
      const order = ['high', 'medium', 'low', 'none']
      groups.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
    } else if (groupBy === 'listGroup') {
      // Sort by list group sort_order, ungrouped at end
      const orderMap = new Map<string, number>()
      listGroupData?.forEach(g => orderMap.set(g.id, g.sort_order))
      groups.sort((a, b) => {
        if (a.key === '__ungrouped__') return 1
        if (b.key === '__ungrouped__') return -1
        return (orderMap.get(a.key) ?? 999) - (orderMap.get(b.key) ?? 999)
      })
    } else if (groupBy === 'contributor') {
      // Current user's group first, then alphabetical
      groups.sort((a, b) => {
        if (a.key === user?.id) return -1
        if (b.key === user?.id) return 1
        if (a.key === '__unknown__') return 1
        if (b.key === '__unknown__') return -1
        return a.label.localeCompare(b.label)
      })
    } else {
      groups.sort((a, b) => a.label.localeCompare(b.label))
    }

    return groups
  }, [filteredAssets, groupBy, listGroupData, user?.id])

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
    if (sortBy === field) {
      if (sortOrder === 'desc') setSortOrder('asc')
      else if (onReorderItem) { setSortBy(null); setSortOrder('desc') }
      else setSortOrder('desc')
    } else {
      setSortBy(field); setSortOrder('desc')
    }
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

  // Virtualization is only used for the flat (ungrouped) table view.
  // Grouped views render group headers with collapsible sections and potentially
  // drag-reorder handles — virtualizer can't handle mixed row heights and
  // interleaved group dividers safely, so we skip it entirely when grouped.
  const useVirtualization = viewMode === 'table' && groupBy === 'none'

  // Virtual scrolling with dynamic measurement for wrap text
  // Key includes version to force remount when collapsing (needed to clear measurement cache)
  const virtualizerKey = `${density}-${hasWrapTextColumn}-${virtualizerVersion}`
  const rowVirtualizer = useVirtualizer({
    count: useVirtualization ? filteredAssets.length : 0,
    getScrollElement: () => tableContainerRef.current,
    // Include density and expanded state in item key to invalidate cache when these change
    getItemKey: useCallback((index: number) => {
      const asset = filteredAssets[index]
      const isExpanded = asset?.id === expandedRowId
      const rowId = asset?._rowId || asset?.id
      return `${rowId}-${density}-${isExpanded ? 'expanded' : 'collapsed'}`
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
  const [insertTargetId, setInsertTargetId] = useState<string | null>(null) // The _rowId of the target row
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
    const targetId = targetAsset?._rowId || null
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

  // List note editing helpers (saves to asset_list_items.notes via parent callback)
  const startEditingListNote = useCallback((rowId: string, currentNote: string) => {
    setEditingListNoteRowId(rowId)
    setEditingListNoteValue(currentNote || '')
  }, [])

  const cancelListNoteEdit = useCallback(() => {
    setEditingListNoteRowId(null)
    setEditingListNoteValue('')
  }, [])

  const saveListNote = useCallback((rowId: string) => {
    if (onUpdateListNote) {
      onUpdateListNote(rowId, editingListNoteValue)
    }
    setEditingListNoteRowId(null)
    setEditingListNoteValue('')
  }, [editingListNoteValue, onUpdateListNote])

  // Kanban drag handlers
  const handleKanbanDragStart = useCallback((assetId: string) => setDraggedAsset(assetId), [])
  const handleKanbanDragOver = useCallback((e: React.DragEvent) => e.preventDefault(), [])
  const handleKanbanDrop = useCallback((targetKey: string) => {
    if (!draggedAsset) { setDraggedAsset(null); return }
    if (activeKanbanBoardId) {
      if (targetKey === 'unassigned') {
        onRemoveFromKanbanLane?.(draggedAsset)
      } else {
        onAssignToKanbanLane?.(targetKey, draggedAsset)
      }
    } else if (kanbanOrganization === 'priority') {
      quickEditMutation.mutate({ assetId: draggedAsset, field: 'priority', value: targetKey })
    }
    setDraggedAsset(null)
  }, [draggedAsset, activeKanbanBoardId, kanbanOrganization, quickEditMutation, onAssignToKanbanLane, onRemoveFromKanbanLane])

  const canDragKanban = kanbanOrganization === 'priority' || !!activeKanbanBoardId

  // Row drag-reorder
  const canDragRows = !!onReorderItem && sortBy === null && groupBy === 'none'
  const dragHandleWidth = 24

  const handleRowDragStart = useCallback((e: React.DragEvent, rowIndex: number) => {
    setDragRowIndex(rowIndex)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(rowIndex))
  }, [])

  const handleRowDragOver = useCallback((e: React.DragEvent, rowIndex: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    // Determine if drop should be above or below this row
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    const targetIdx = e.clientY < midY ? rowIndex : rowIndex + 1
    setDropTargetIndex(targetIdx)
  }, [])

  const handleRowDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (dragRowIndex !== null && dropTargetIndex !== null && onReorderItem) {
      const adjustedTarget = dropTargetIndex > dragRowIndex ? dropTargetIndex - 1 : dropTargetIndex
      if (adjustedTarget !== dragRowIndex) {
        onReorderItem(dragRowIndex, adjustedTarget)
      }
    }
    setDragRowIndex(null)
    setDropTargetIndex(null)
  }, [dragRowIndex, dropTargetIndex, onReorderItem])

  const handleRowDragEnd = useCallback(() => {
    setDragRowIndex(null)
    setDropTargetIndex(null)
  }, [])

  // Group drag-and-drop (move assets between custom groups)
  const canDragGroupedRows = groupBy === 'listGroup' && !!onMoveItemToGroup

  const handleGroupedRowDragStart = useCallback((e: React.DragEvent, assetId: string, symbol: string, sourceGroupKey: string) => {
    setDragGroupAssetId(assetId)
    setDragGroupSourceKey(sourceGroupKey)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', assetId)
    // Compact drag ghost pill
    const ghost = document.createElement('div')
    ghost.textContent = symbol
    ghost.style.cssText = 'position:fixed;top:-100px;left:-100px;padding:4px 12px;background:#3b82f6;color:#fff;border-radius:6px;font-size:13px;font-weight:600;font-family:system-ui;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.18);'
    document.body.appendChild(ghost)
    e.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, ghost.offsetHeight / 2)
    requestAnimationFrame(() => document.body.removeChild(ghost))
  }, [])

  const handleGroupedDragOver = useCallback((e: React.DragEvent, groupKey: string) => {
    if (!dragGroupAssetId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dropTargetGroupId !== groupKey) {
      setDropTargetGroupId(groupKey)
      // Auto-expand collapsed groups after a short hover
      if (collapsedGroups.has(groupKey)) {
        if (dragExpandTimerRef.current) clearTimeout(dragExpandTimerRef.current)
        dragExpandTimerRef.current = setTimeout(() => {
          setCollapsedGroups(prev => {
            const next = new Set(prev)
            next.delete(groupKey)
            return next
          })
        }, 400)
      }
    }
  }, [dragGroupAssetId, dropTargetGroupId, collapsedGroups])

  const handleGroupedDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if truly leaving the group container (not entering a child)
    const related = e.relatedTarget as HTMLElement | null
    if (!related || !e.currentTarget.contains(related)) {
      setDropTargetGroupId(null)
      if (dragExpandTimerRef.current) { clearTimeout(dragExpandTimerRef.current); dragExpandTimerRef.current = null }
    }
  }, [])

  const handleGroupedDrop = useCallback((e: React.DragEvent, groupKey: string) => {
    e.preventDefault()
    if (dragGroupAssetId && onMoveItemToGroup && groupKey !== dragGroupSourceKey) {
      onMoveItemToGroup(dragGroupAssetId, groupKey === '__ungrouped__' ? null : groupKey)
    }
    setDragGroupAssetId(null)
    setDragGroupSourceKey(null)
    setDropTargetGroupId(null)
    if (dragExpandTimerRef.current) { clearTimeout(dragExpandTimerRef.current); dragExpandTimerRef.current = null }
  }, [dragGroupAssetId, dragGroupSourceKey, onMoveItemToGroup])

  const handleGroupedRowDragEnd = useCallback(() => {
    setDragGroupAssetId(null)
    setDragGroupSourceKey(null)
    setDropTargetGroupId(null)
    if (dragExpandTimerRef.current) { clearTimeout(dragExpandTimerRef.current); dragExpandTimerRef.current = null }
  }, [])

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
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
      // Close group kebab menu if clicking outside
      if (groupKebabMenu) {
        const target = e.target as HTMLElement
        if (!target.closest('.group-kebab-menu')) {
          setGroupKebabMenu(null)
        }
      }
    }
    if (showGroupByMenu || columnContextMenu || activeTableFilter || workflowPopover || rowContextMenu || addColumnDropdown || priorityColumnPicker || prioritySourceSelector || groupKebabMenu) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showGroupByMenu, columnContextMenu, activeTableFilter, workflowPopover, rowContextMenu, addColumnDropdown, priorityColumnPicker, prioritySourceSelector, groupKebabMenu])

  // Render metric detail expansion panel
  const renderMetricDetail = useCallback((asset: any, columnId: string, quote: any, coverage: any[], workflows: any[]) => {
    const price = quote?.price || asset.current_price
    const changeP = quote?.changePercent

    // --- LEFT ZONE: Price + sparkline + stats ---
    const leftZone = (
      <div className="flex flex-col h-full">
        <div className="mb-1.5">
          <div className="text-xl font-bold text-gray-900 font-mono leading-none">
            {formatPrice(price)}
          </div>
          {changeP !== undefined && (
            <div className={clsx(
              'text-xs font-medium font-mono flex items-center gap-0.5 mt-1',
              changeP >= 0 ? 'text-green-600' : 'text-red-600'
            )}>
              {changeP >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {formatPriceChange(changeP)}
            </div>
          )}
        </div>
        <div className="flex-1 min-h-0 rounded bg-gray-50/60 border border-gray-100 p-1">
          <MiniChart symbol={asset.symbol} height={80} days={30} showPrice={false} showChange={false} />
        </div>
        <div className="mt-1.5 space-y-0.5 text-[11px]">
          {quote?.volume != null && (
            <div className="flex justify-between"><span className="text-gray-400">Vol</span><span className="font-mono text-gray-600">{(quote.volume / 1e6).toFixed(1)}M</span></div>
          )}
          {quote?.high != null && (
            <div className="flex justify-between"><span className="text-gray-400">High</span><span className="font-mono text-green-600">{formatPrice(quote.high)}</span></div>
          )}
          {quote?.low != null && (
            <div className="flex justify-between"><span className="text-gray-400">Low</span><span className="font-mono text-red-600">{formatPrice(quote.low)}</span></div>
          )}
        </div>
      </div>
    )

    // --- RIGHT ZONE: Price targets + meta ---
    const rightZone = (
      <div className="flex flex-col h-full overflow-hidden">
        <PriceTargetsSummary
          assetId={asset.id}
          currentPrice={price}
          className="!border-gray-100 !shadow-none !rounded-md"
        />
        <div className="mt-auto pt-1.5 space-y-1 text-[11px]">
          {coverage.length > 0 && (
            <div className="text-gray-500 flex items-center gap-1">
              <Users className="w-3 h-3 flex-shrink-0" />
              {coverage.length} analyst{coverage.length !== 1 ? 's' : ''}
            </div>
          )}
          {asset.updated_at && (
            <div className="text-gray-400 flex items-center gap-1">
              <Clock className="w-3 h-3 flex-shrink-0" />
              Updated {formatRelativeTime(asset.updated_at)}
            </div>
          )}
        </div>
      </div>
    )

    // --- CENTER ZONE ---
    let centerZone: React.ReactNode

    switch (columnId) {
      // ── Price / Change: enlarged chart with key stats alongside ──
      case 'price':
      case 'change':
        centerZone = (
          <div className="flex flex-col h-full overflow-hidden">
            <h5 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1 flex-shrink-0">30-Day Price Chart</h5>
            <div className="flex-1 min-h-0 rounded bg-gray-50/40 border border-gray-100 p-1">
              <MiniChart symbol={asset.symbol} height={120} days={30} showPrice={false} showChange={false} />
            </div>
            {/* Inline stats row below chart */}
            <div className="mt-1.5 flex gap-4 text-[11px] text-gray-500 flex-shrink-0">
              {asset.market_cap && <span>Mkt Cap <span className="font-mono text-gray-700">{formatPrice(asset.market_cap)}</span></span>}
              {quote?.volume != null && <span>Vol <span className="font-mono text-gray-700">{(quote.volume / 1e6).toFixed(1)}M</span></span>}
              {asset.pe_ratio && <span>P/E <span className="font-mono text-gray-700">{Number(asset.pe_ratio).toFixed(1)}</span></span>}
            </div>
          </div>
        )
        break

      // ── Ticker / Company / Sector: profile + research preview ──
      case 'ticker':
      case 'companyName':
      case 'sector':
        centerZone = (
          <div className="flex flex-col h-full overflow-hidden">
            <div className="flex items-baseline gap-2 mb-1 flex-shrink-0">
              <span className="text-base font-bold text-gray-900 leading-none">{asset.symbol}</span>
              <span className="text-sm text-gray-600 truncate">{asset.company_name}</span>
            </div>
            <div className="flex items-center gap-1.5 mb-2 flex-shrink-0">
              {asset.sector && <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[11px] font-medium">{asset.sector}</span>}
              {asset.industry && <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-[11px]">{asset.industry}</span>}
              {asset.market_cap && <span className="text-[11px] text-gray-400 ml-1">Mkt Cap {formatPrice(asset.market_cap)}</span>}
            </div>
            {asset.description && (
              <p className="text-xs text-gray-600 leading-relaxed line-clamp-2 mb-2 flex-shrink-0">{asset.description}</p>
            )}
            {/* Research preview cards */}
            <div className="grid grid-cols-2 gap-1.5 flex-shrink-0">
              {asset.thesis && (
                <div className="col-span-2 bg-gray-50 border border-gray-100 rounded p-1.5">
                  <h6 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Thesis</h6>
                  <p className="text-[11px] text-gray-700 line-clamp-2">{asset.thesis}</p>
                </div>
              )}
              {asset.bull_case && (
                <div className="bg-green-50/50 border border-green-100 rounded p-1.5">
                  <h6 className="text-[10px] font-semibold text-green-700 uppercase tracking-wide mb-0.5">Bull</h6>
                  <p className="text-[11px] text-green-900 line-clamp-1">{asset.bull_case}</p>
                </div>
              )}
              {asset.bear_case && (
                <div className="bg-red-50/50 border border-red-100 rounded p-1.5">
                  <h6 className="text-[10px] font-semibold text-red-700 uppercase tracking-wide mb-0.5">Bear</h6>
                  <p className="text-[11px] text-red-900 line-clamp-1">{asset.bear_case}</p>
                </div>
              )}
            </div>
          </div>
        )
        break

      // ── Research fields: 3×2 grid, triggered field highlighted ──
      case 'thesis':
      case 'bull_case':
      case 'bear_case':
      case 'base_case':
      case 'where_different':
      case 'risks_to_thesis':
        centerZone = (
          <div className="h-full overflow-hidden">
            <div className="grid grid-cols-3 grid-rows-2 gap-1.5 h-full">
              {RESEARCH_FIELDS.map(({ key, label }) => {
                const val = asset[key]
                const isTriggered = key === columnId
                return (
                  <div
                    key={key}
                    className={clsx(
                      'rounded p-2 flex flex-col overflow-hidden',
                      isTriggered
                        ? 'bg-blue-50 border border-blue-200 ring-1 ring-blue-300/50'
                        : 'bg-gray-50/80 border border-gray-100'
                    )}
                  >
                    <h6 className={clsx(
                      'text-[10px] font-semibold uppercase tracking-wide mb-0.5 flex-shrink-0',
                      isTriggered ? 'text-blue-600' : 'text-gray-400'
                    )}>
                      {label}
                    </h6>
                    {val ? (
                      <p className={clsx(
                        'text-[11px] leading-snug flex-1 overflow-hidden',
                        isTriggered ? 'text-blue-900 line-clamp-6' : 'text-gray-600 line-clamp-2'
                      )}>
                        {val}
                      </p>
                    ) : (
                      <p className="text-[11px] text-gray-300 italic">—</p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
        break

      // ── Coverage: analyst cards + thesis context ──
      case 'coverage':
        centerZone = (
          <div className="flex flex-col h-full overflow-hidden">
            <h5 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5 flex-shrink-0">Analyst Coverage</h5>
            {coverage.length === 0 ? (
              <p className="text-xs text-gray-400 italic">No coverage assigned</p>
            ) : (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {coverage.map((analyst, idx) => (
                  <div key={idx} className="flex items-center gap-1.5 px-2 py-1 bg-gray-50 border border-gray-100 rounded">
                    <div className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[9px] font-semibold flex-shrink-0">
                      {getInitials(analyst.analyst)}
                    </div>
                    <span className="text-[11px] font-medium text-gray-900">{analyst.analyst}</span>
                    {analyst.isLead && <span className="px-1 py-px text-[9px] font-medium bg-blue-100 text-blue-700 rounded">Lead</span>}
                  </div>
                ))}
              </div>
            )}
            {/* Thesis preview for context */}
            {asset.thesis && (
              <div className="border-t border-gray-100 pt-1.5 mt-auto flex-shrink-0">
                <h6 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Thesis</h6>
                <p className="text-[11px] text-gray-600 line-clamp-2">{asset.thesis}</p>
              </div>
            )}
          </div>
        )
        break

      // ── Priority: picker buttons ──
      case 'priority': {
        const currentPriority = getUserPriority(asset.id)
        centerZone = (
          <div className="flex flex-col h-full overflow-hidden">
            <h5 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5 flex-shrink-0">Set Priority</h5>
            <div className="flex flex-wrap gap-1.5">
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
                      'px-3 py-2 rounded text-xs font-medium transition-all text-white flex items-center gap-1.5',
                      config.bg,
                      isSelected ? 'ring-2 ring-offset-1 ring-blue-400' : 'opacity-70 hover:opacity-100'
                    )}
                  >
                    <IconComponent className="w-3.5 h-3.5" />
                    <span>{config.label}</span>
                    {isSelected && <Check className="w-3.5 h-3.5" />}
                  </button>
                )
              })}
            </div>
            {/* Context: thesis or note below */}
            {asset.thesis && (
              <div className="border-t border-gray-100 pt-1.5 mt-auto flex-shrink-0">
                <h6 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Thesis</h6>
                <p className="text-[11px] text-gray-600 line-clamp-2">{asset.thesis}</p>
              </div>
            )}
          </div>
        )
        break
      }

      // ── Notes: styled note block + research context ──
      case 'notes':
        centerZone = (
          <div className="flex flex-col h-full overflow-hidden">
            <h5 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1 flex-shrink-0">Quick Note</h5>
            {asset.quick_note ? (
              <div className="bg-amber-50/50 border border-amber-100 rounded p-2 flex-shrink-0">
                <p className="text-xs text-gray-700 leading-relaxed italic line-clamp-4">"{asset.quick_note}"</p>
              </div>
            ) : (
              <p className="text-xs text-gray-400 italic mb-2">No quick note</p>
            )}
            {asset.thesis && (
              <div className="border-t border-gray-100 pt-1.5 mt-auto flex-shrink-0">
                <h6 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Thesis</h6>
                <p className="text-[11px] text-gray-600 line-clamp-2">{asset.thesis}</p>
              </div>
            )}
          </div>
        )
        break

      // ── List Note: styled note block + research context ──
      case 'listNote':
        centerZone = (
          <div className="flex flex-col h-full overflow-hidden">
            <h5 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1 flex-shrink-0">List Note</h5>
            {asset._listNotes ? (
              <div className="bg-gray-50 border border-gray-100 rounded p-2 flex-shrink-0">
                <p className="text-xs text-gray-700 leading-relaxed line-clamp-4">{asset._listNotes}</p>
              </div>
            ) : (
              <p className="text-xs text-gray-400 italic mb-2">No list note</p>
            )}
            {asset.thesis && (
              <div className="border-t border-gray-100 pt-1.5 mt-auto flex-shrink-0">
                <h6 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Thesis</h6>
                <p className="text-[11px] text-gray-600 line-clamp-2">{asset.thesis}</p>
              </div>
            )}
          </div>
        )
        break

      // ── Workflows: cards + stage info ──
      case 'workflows':
        centerZone = (
          <div className="flex flex-col h-full overflow-hidden">
            <h5 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5 flex-shrink-0">Active Workflows</h5>
            {workflows.length === 0 ? (
              <p className="text-xs text-gray-400 italic">No active workflows</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {workflows.map((wf, idx) => (
                  <div key={idx} className="flex items-center gap-2 px-2.5 py-1.5 bg-gray-50 border border-gray-100 rounded">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: wf.color }} />
                    <span className="text-xs font-medium text-gray-900">{wf.name}</span>
                  </div>
                ))}
              </div>
            )}
            {/* Stage + coverage context */}
            <div className="border-t border-gray-100 pt-1.5 mt-auto flex gap-4 text-[11px] text-gray-500 flex-shrink-0">
              {asset.process_stage && <span>Stage: <span className="text-gray-700 font-medium">{PROCESS_STAGES[asset.process_stage]?.label || asset.process_stage}</span></span>}
              {coverage.length > 0 && <span>{coverage.length} analyst{coverage.length !== 1 ? 's' : ''}</span>}
            </div>
          </div>
        )
        break

      // ── Updated: timeline + context ──
      case 'updated':
        centerZone = (
          <div className="flex flex-col h-full overflow-hidden">
            <h5 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5 flex-shrink-0">Timeline</h5>
            <div className="space-y-2 flex-shrink-0">
              {asset.updated_at && (
                <div className="flex items-center gap-2 text-xs">
                  <Clock className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                  <span className="text-gray-700">Last updated {formatRelativeTime(asset.updated_at)}</span>
                </div>
              )}
              {asset.created_at && (
                <div className="flex items-center gap-2 text-xs">
                  <Calendar className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                  <span className="text-gray-500">Created {formatRelativeTime(asset.created_at)}</span>
                </div>
              )}
              {asset.process_stage && (
                <div className="flex items-center gap-2 text-xs">
                  <Target className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                  <span className="text-gray-700">Stage: {PROCESS_STAGES[asset.process_stage]?.label || asset.process_stage}</span>
                </div>
              )}
            </div>
            {asset.thesis && (
              <div className="border-t border-gray-100 pt-1.5 mt-auto flex-shrink-0">
                <h6 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Thesis</h6>
                <p className="text-[11px] text-gray-600 line-clamp-2">{asset.thesis}</p>
              </div>
            )}
          </div>
        )
        break

      // ── Default (chevron): research overview ──
      default:
        centerZone = (
          <div className="flex flex-col h-full overflow-hidden">
            {/* Thesis */}
            {asset.thesis && (
              <div className="mb-1.5 flex-shrink-0">
                <h6 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Thesis</h6>
                <p className="text-xs text-gray-700 leading-relaxed line-clamp-3">{asset.thesis}</p>
              </div>
            )}
            {/* Bull / Bear */}
            <div className="grid grid-cols-2 gap-1.5 mb-1.5 flex-shrink-0">
              <div className="bg-green-50/50 border border-green-100 rounded p-1.5">
                <h6 className="text-[10px] font-semibold text-green-700 uppercase tracking-wide mb-0.5">Bull Case</h6>
                <p className="text-[11px] text-green-900 line-clamp-2">{asset.bull_case || <span className="text-gray-400 italic">—</span>}</p>
              </div>
              <div className="bg-red-50/50 border border-red-100 rounded p-1.5">
                <h6 className="text-[10px] font-semibold text-red-700 uppercase tracking-wide mb-0.5">Bear Case</h6>
                <p className="text-[11px] text-red-900 line-clamp-2">{asset.bear_case || <span className="text-gray-400 italic">—</span>}</p>
              </div>
            </div>
            {/* Base / Where Different / Risks in tight row */}
            <div className="grid grid-cols-3 gap-1.5 flex-shrink-0">
              {asset.base_case && (
                <div className="bg-gray-50 border border-gray-100 rounded p-1.5">
                  <h6 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Base</h6>
                  <p className="text-[11px] text-gray-600 line-clamp-1">{asset.base_case}</p>
                </div>
              )}
              {asset.where_different && (
                <div className="bg-gray-50 border border-gray-100 rounded p-1.5">
                  <h6 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Diff. View</h6>
                  <p className="text-[11px] text-gray-600 line-clamp-1">{asset.where_different}</p>
                </div>
              )}
              {asset.risks_to_thesis && (
                <div className="bg-gray-50 border border-gray-100 rounded p-1.5">
                  <h6 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Risks</h6>
                  <p className="text-[11px] text-gray-600 line-clamp-1">{asset.risks_to_thesis}</p>
                </div>
              )}
            </div>
            {!asset.thesis && !asset.bull_case && !asset.bear_case && (
              <p className="text-xs text-gray-400 italic">No research details available</p>
            )}
          </div>
        )
        break
    }

    // --- ASSEMBLE 3-ZONE LAYOUT ---
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left zone */}
          <div className="w-44 flex-shrink-0 overflow-hidden pr-3">
            {leftZone}
          </div>
          {/* Divider */}
          <div className="w-px bg-gray-200 flex-shrink-0" />
          {/* Center zone */}
          <div className="flex-1 min-w-0 overflow-hidden px-4">
            {centerZone}
          </div>
          {/* Divider */}
          <div className="w-px bg-gray-200 flex-shrink-0" />
          {/* Right zone */}
          <div className="w-48 flex-shrink-0 overflow-hidden pl-3">
            {rightZone}
          </div>
        </div>
        {/* Action buttons */}
        <div className="mt-1.5 pt-1.5 border-t border-gray-200 flex items-center gap-3 flex-shrink-0">
          <button
            onClick={() => handleAssetClick(asset)}
            className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
          >
            Open Asset
            <ChevronRight className="w-3 h-3" />
          </button>
          {onCreateTradeIdea && (
            <button
              onClick={() => onCreateTradeIdea(asset.id)}
              className="text-xs text-gray-600 hover:text-gray-800 font-medium flex items-center gap-1 px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded transition-colors"
            >
              <Tag className="w-3 h-3" />
              Create Trade Idea
            </button>
          )}
        </div>
      </div>
    )
  }, [getUserPriority, setUserPriorityMutation, handleAssetClick, toggleRowExpansion, onCreateTradeIdea])

  // Quick action buttons rendered at the bottom of expanded rows
  const renderExpandedActions = useCallback((asset: any) => (
    <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-end gap-3">
      <button
        onClick={() => handleAssetClick(asset)}
        className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
      >
        Open Asset
        <ChevronRight className="w-3 h-3" />
      </button>
      {onCreateTradeIdea && (
        <button
          onClick={() => onCreateTradeIdea(asset.id)}
          className="text-xs text-gray-600 hover:text-gray-800 font-medium flex items-center gap-1 px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded transition-colors"
        >
          <Tag className="w-3 h-3" />
          Create Trade Idea
        </button>
      )}
    </div>
  ), [handleAssetClick, onCreateTradeIdea])

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
    // Custom board view — build columns from board lanes
    if (activeKanbanBoardId && kanbanBoardLanes) {
      const laneItemMap = new Map((kanbanBoardLaneItems || []).map(i => [i.asset_list_item_id, i.lane_id]))
      return [
        {
          key: 'unassigned',
          label: 'Unassigned',
          color: 'bg-gray-100 text-gray-600',
          assets: filteredAssets.filter(a => !laneItemMap.has(a._rowId))
        },
        ...kanbanBoardLanes
          .sort((a, b) => a.sort_order - b.sort_order)
          .map(lane => ({
            key: lane.id,
            label: lane.name,
            color: 'bg-opacity-20 text-gray-800',
            bgColor: lane.color,
            assets: filteredAssets.filter(a => laneItemMap.get(a._rowId) === lane.id)
          }))
      ]
    }

    // Preset views
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
      default:
        return []
    }
  }, [kanbanOrganization, filteredAssets, activeKanbanBoardId, kanbanBoardLanes, kanbanBoardLaneItems])

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className={clsx(
      fillHeight ? 'h-full flex flex-col' : 'space-y-4'
    )}>
      {/* Toolbar */}
      {!hideToolbar && (
      <div className={clsx('flex items-center gap-3 pb-3', fillHeight && 'flex-shrink-0')}>
        {/* Left: Search */}
        <div className="relative w-56">
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

        {/* Add Group — inline in toolbar for listGroup mode */}
        {viewMode === 'table' && groupBy === 'listGroup' && onCreateGroup && (
          showInlineNewGroup ? (
            <div className="flex items-center gap-1.5">
              <div className="relative flex-shrink-0">
                <button
                  onClick={() => setShowInlineColorPicker(!showInlineColorPicker)}
                  className="w-4 h-4 rounded-full border border-gray-300 hover:border-gray-400 transition-colors"
                  style={{ backgroundColor: inlineNewGroupColor }}
                  title="Pick color"
                />
                {showInlineColorPicker && (
                  <div className="absolute left-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 p-1.5 z-50 flex gap-1 flex-wrap w-[120px]">
                    {['#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#6b7280'].map(color => (
                      <button
                        key={color}
                        onClick={() => { setInlineNewGroupColor(color); setShowInlineColorPicker(false) }}
                        className={clsx('w-4 h-4 rounded-full transition-transform hover:scale-110', inlineNewGroupColor === color && 'ring-2 ring-offset-1 ring-gray-400')}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                )}
              </div>
              <input
                ref={inlineNewGroupInputRef}
                type="text"
                value={inlineNewGroupName}
                onChange={(e) => setInlineNewGroupName(e.target.value)}
                placeholder="Group name..."
                className="w-32 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter' && inlineNewGroupName.trim()) {
                    e.preventDefault()
                    onCreateGroup({ name: inlineNewGroupName.trim(), color: inlineNewGroupColor })
                    setInlineNewGroupName('')
                    setShowInlineNewGroup(false)
                    setShowInlineColorPicker(false)
                  }
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    setInlineNewGroupName('')
                    setShowInlineNewGroup(false)
                    setShowInlineColorPicker(false)
                  }
                }}
              />
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (inlineNewGroupName.trim()) {
                    onCreateGroup({ name: inlineNewGroupName.trim(), color: inlineNewGroupColor })
                    setInlineNewGroupName('')
                    setShowInlineNewGroup(false)
                    setShowInlineColorPicker(false)
                  }
                }}
                disabled={!inlineNewGroupName.trim()}
                className="p-0.5 rounded text-green-600 hover:bg-green-50 disabled:text-gray-300 transition-colors"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setInlineNewGroupName(''); setShowInlineNewGroup(false); setShowInlineColorPicker(false) }}
                className="p-0.5 rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowInlineNewGroup(true)
                setInlineNewGroupName('')
                setInlineNewGroupColor('#6366f1')
                setTimeout(() => inlineNewGroupInputRef.current?.focus(), 50)
              }}
              className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              Add Group
            </button>
          )
        )}

        {/* Center spacer */}
        <div className="flex-1" />

        {/* Right side controls */}
        <div className="flex items-center gap-1">
          {/* Density toggle (table mode only) */}
          {viewMode === 'table' && <DensityToggle />}

          {/* Divider */}
          {viewMode === 'table' && <div className="h-4 w-px bg-gray-200 mx-1" />}

          {/* Group by */}
          {viewMode === 'table' && (
            <div className="relative" ref={groupByMenuRef}>
              <button
                onClick={() => setShowGroupByMenu(!showGroupByMenu)}
                className={clsx(
                  'flex items-center gap-1.5 px-2 py-1.5 rounded-md transition-colors text-xs font-medium',
                  groupBy !== 'none' ? 'text-purple-600 bg-purple-50' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                )}
                title="Group by"
              >
                <Layers className="w-4 h-4" />
                {groupBy !== 'none' && (
                  <span>
                    {[
                      ...GROUP_BY_OPTIONS,
                      ...(listGroupData ? [{ value: 'listGroup' as GroupByOption, label: 'By Custom', icon: FolderTree }] : []),
                      ...(listId ? [{ value: 'contributor' as GroupByOption, label: 'By Contributor', icon: Users }] : []),
                    ].find(o => o.value === groupBy)?.label || ''}
                  </span>
                )}
              </button>
              {showGroupByMenu && (
                <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-lg shadow-lg border border-gray-200 z-50 py-1">
                  {[
                    ...GROUP_BY_OPTIONS,
                    ...(listGroupData ? [{ value: 'listGroup' as GroupByOption, label: 'By Custom', icon: FolderTree }] : []),
                    ...(listId ? [{ value: 'contributor' as GroupByOption, label: 'By Contributor', icon: Users }] : []),
                  ].map(option => (
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

          {/* Manual order toggle (when drag-reorder is available) */}
          {viewMode === 'table' && onReorderItem && groupBy === 'none' && (
            sortBy === null ? (
              <button
                onClick={() => setSortBy('updated_at')}
                className="flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium text-blue-600 bg-blue-50 transition-colors"
                title="Exit manual order (restore sort)"
              >
                <GripVertical className="w-3.5 h-3.5" />
                <span>Manual</span>
                <X className="w-3 h-3 ml-0.5" />
              </button>
            ) : (
              <button
                onClick={() => setSortBy(null)}
                className="flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                title="Clear sort to enable drag reorder"
              >
                <GripVertical className="w-3.5 h-3.5" />
                <span>Manual</span>
              </button>
            )
          )}

          {/* Column settings */}
          {viewMode === 'table' && (
            <button
              onClick={() => { setDraftColumns(columns.map(c => ({ ...c }))); setShowColumnSettings(true) }}
              className={clsx(
                'p-1.5 rounded-md transition-colors',
                'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
              )}
              title="Column settings"
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>
          )}

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
      {!hideToolbar && selectionMode && selectedAssetIds.size > 0 && (() => {
        const selectedArr = Array.from(selectedAssetIds)
        // For row-specific removal checks, resolve selected asset IDs to their rows
        const removableCount = canRemoveRow
          ? assets.filter(a => selectedAssetIds.has(a.id) && canRemoveRow(a._rowId || a.id)).length
          : selectedArr.length
        const hasExclusions = canRemoveRow && removableCount < selectedArr.length

        return (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-100 rounded-md mb-2">
            <span className="text-xs font-medium text-blue-700">
              {selectedArr.length} selected
              {hasExclusions && (
                <span className="text-blue-500 font-normal">{` \u00B7 ${removableCount} removable`}</span>
              )}
            </span>
            {onBulkAction && removableCount > 0 && (
              <button
                onClick={() => onBulkAction(selectedArr)}
                className="text-xs text-blue-700 hover:text-blue-900 font-medium"
              >
                {bulkActionLabel}
              </button>
            )}
            {/* Create Trade Idea (bulk) */}
            {onCreateTradeIdea && (
              <button
                onClick={() => onCreateTradeIdea(selectedArr[0])}
                className="text-xs text-blue-700 hover:text-blue-900 font-medium flex items-center gap-1"
              >
                <Tag className="w-3.5 h-3.5" />
                Trade Idea{selectedArr.length > 1 ? ` (${selectedArr.length})` : ''}
              </button>
            )}
            {/* Move to Group (bulk) */}
            {listGroupData && onMoveItemToGroup && (
              <div className="relative group/bulkmove">
                <button className="text-xs text-blue-700 hover:text-blue-900 font-medium flex items-center gap-1">
                  <FolderOpen className="w-3.5 h-3.5" />
                  Move to Group
                </button>
                <div className="absolute left-0 top-full mt-1 w-40 bg-white rounded-lg shadow-xl border border-gray-200 py-1 hidden group-hover/bulkmove:block z-50">
                  <button
                    onClick={() => { selectedArr.forEach(id => onMoveItemToGroup(id, null)); clearSelection() }}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 text-gray-600"
                  >
                    No Group
                  </button>
                  {listGroupData.map(g => (
                    <button
                      key={g.id}
                      onClick={() => { selectedArr.forEach(id => onMoveItemToGroup(id, g.id)); clearSelection() }}
                      className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
                    >
                      {g.color && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: g.color }} />}
                      <span className="truncate">{g.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button onClick={clearSelection} className="text-xs text-blue-600 hover:text-blue-800 ml-auto">
              Clear
            </button>
          </div>
        )
      })()}

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
                <div className="pro-table-header" style={{ minWidth: totalTableWidth + (canDragRows ? dragHandleWidth : 0) + (hiddenColumns.length > 0 ? 40 : 0) }}>
                  <div className="flex items-center">
                    {/* Drag handle spacer in header */}
                    {canDragRows && (
                      <div className="flex-shrink-0" style={{ width: dragHandleWidth }} />
                    )}
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
                            cursor: col.sortable ? 'pointer' : undefined,
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
                        key={asset._rowId || asset.id}
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
                          isExpanded && 'expanded flex flex-col',
                          dragRowIndex === virtualRow.index && 'opacity-50'
                        )}
                        data-row-index={virtualRow.index}
                        draggable={canDragRows}
                        onDragStart={canDragRows ? (e) => handleRowDragStart(e, virtualRow.index) : undefined}
                        onDragOver={canDragRows ? (e) => handleRowDragOver(e, virtualRow.index) : undefined}
                        onDrop={canDragRows ? handleRowDrop : undefined}
                        onDragEnd={canDragRows ? handleRowDragEnd : undefined}
                        style={{
                          height: isExpanded ? expandedRowHeight : (hasWrapTextColumn ? 'auto' : densityRowHeight),
                          minHeight: hasWrapTextColumn && !isExpanded ? densityRowHeight : undefined,
                          transform: `translateY(${virtualRow.start + insertOffset}px)`
                        }}>
                        {/* Drop indicator line */}
                        {canDragRows && dropTargetIndex === virtualRow.index && dragRowIndex !== null && dragRowIndex !== virtualRow.index && (
                          <div className="absolute top-0 left-0 right-0 h-0.5 bg-blue-500 z-10" style={{ transform: 'translateY(-1px)' }} />
                        )}
                        <div
                          className={clsx('flex items-center', isExpanded ? 'h-auto' : 'h-full')}
                          style={{ minWidth: totalTableWidth + (canDragRows ? dragHandleWidth : 0), minHeight: densityRowHeight }}
                          onDoubleClick={() => toggleRowExpansion(asset.id)}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            setRowContextMenu({ assetId: asset.id, rowId: asset._rowId || asset.id, x: e.clientX, y: e.clientY })
                          }}>
                          {/* Drag handle */}
                          {canDragRows && (
                            <div className="flex items-center justify-center cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 flex-shrink-0" style={{ width: dragHandleWidth, minHeight: densityRowHeight }}>
                              <GripVertical className="w-3.5 h-3.5" />
                            </div>
                          )}
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
                                          ? '#f8fafc'  // slate-50 for even rows (matches --table-row-even)
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
                                        <span className="pro-symbol">{asset.symbol}</span>
                                        {/* Hide price target icon in micro mode */}
                                        {density !== 'micro' && asset.price_targets?.length > 0 && (
                                          <Target className="h-3 w-3 text-amber-500" title={`${asset.price_targets.length} price target(s)`} />
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                )}
                                {col.id === 'companyName' && (
                                  <span className="pro-company-name flex-1 min-w-0 truncate">
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
                                      <div className="flex items-center gap-1.5" title={coverage.map(c => `${c.analyst}${c.team ? ` (${c.team})` : ''}`).join('\n')}>
                                        <div className="min-w-0 flex-1">
                                          <span className="pro-analyst block truncate">{lead.analyst}</span>
                                        </div>
                                        {coverage.length > 1 && <span className="pro-analyst-count">+{coverage.length - 1}</span>}
                                      </div>
                                    )
                                  }

                                  return (
                                    <div className={clsx('flex items-center', isMicro ? 'gap-0.5' : 'gap-1.5')} title={coverage.map(c => `${c.analyst}${c.team ? ` (${c.team})` : ''}`).join('\n')}>
                                      <span className="pro-analyst truncate">{lead.analyst}</span>
                                      {coverage.length > 1 && <span className={clsx('pro-analyst-count', isMicro && 'text-[8px] px-0.5 py-0')}>+{coverage.length - 1}</span>}
                                    </div>
                                  )
                                })()}
                                {col.id === 'workflows' && (() => {
                                  const isMicro = density === 'micro'

                                  if (workflows.length === 0) {
                                    return (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          const rect = e.currentTarget.getBoundingClientRect()
                                          setWorkflowPopover({ assetId: asset.id, x: rect.left, y: rect.bottom + 4 })
                                        }}
                                        className="text-gray-400 hover:text-blue-600 transition-colors"
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
                                      className={clsx('pro-workflow-badge', isMicro && 'px-1 py-0')}
                                    >
                                      <span className={clsx('pro-workflow-dot', isMicro && 'w-1.5 h-1.5')} style={{ backgroundColor: workflows[0]?.color || '#6366f1' }} />
                                      <span>{workflows.length}{isMicro ? '' : ` workflow${workflows.length !== 1 ? 's' : ''}`}</span>
                                    </button>
                                  )
                                })()}
                                {col.id === 'price' && (() => {
                                  if (!displayPrice) return <span className="pro-empty-cell">—</span>
                                  return (
                                    <span className="pro-price">
                                      {formatPrice(displayPrice)}
                                    </span>
                                  )
                                })()}
                                {col.id === 'change' && (() => {
                                  if (!showLivePrices || changePercent === undefined) return <span className="pro-empty-cell">—</span>
                                  const changeClass = getPriceChangeClass(changePercent)
                                  return (
                                    <span className={clsx('pro-price-change', changeClass)}>
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
                                      isMicro ? 'px-1.5 py-0' : isMicroOrUltra ? 'gap-1 px-1.5 py-0' : 'gap-1 px-2 py-0.5',
                                      config.bg
                                    )}>
                                      {!isMicro && IconComponent && <IconComponent className={isMicroOrUltra ? 'w-2.5 h-2.5' : 'w-3 h-3'} />}
                                      <span>{config.label}</span>
                                    </span>
                                  ) : (
                                    <span className="text-gray-400">
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
                                  <span className="text-gray-600 truncate">
                                    {asset.sector || '—'}
                                  </span>
                                )}
                                {col.id === 'thesis' && (
                                  <span className={clsx('flex-1 min-w-0 text-gray-600 cursor-help', col.wrapText ? 'whitespace-normal break-words' : 'truncate')} title={asset.thesis || 'No thesis'}>
                                    {asset.thesis || <span className="text-gray-400 italic">No thesis</span>}
                                  </span>
                                )}
                                {col.id === 'bull_case' && (
                                  <span className={clsx('flex-1 min-w-0 text-gray-600 cursor-help', col.wrapText ? 'whitespace-normal break-words' : 'truncate')} title={asset.bull_case || 'Not specified'}>
                                    {asset.bull_case || <span className="text-gray-400 italic">—</span>}
                                  </span>
                                )}
                                {col.id === 'bear_case' && (
                                  <span className={clsx('flex-1 min-w-0 text-gray-600 cursor-help', col.wrapText ? 'whitespace-normal break-words' : 'truncate')} title={asset.bear_case || 'Not specified'}>
                                    {asset.bear_case || <span className="text-gray-400 italic">—</span>}
                                  </span>
                                )}
                                {col.id === 'base_case' && (
                                  <span className={clsx('flex-1 min-w-0 text-gray-600 cursor-help', col.wrapText ? 'whitespace-normal break-words' : 'truncate')} title={asset.base_case || 'Not specified'}>
                                    {asset.base_case || <span className="text-gray-400 italic">—</span>}
                                  </span>
                                )}
                                {col.id === 'where_different' && (
                                  <span className={clsx('flex-1 min-w-0 text-gray-600 cursor-help', col.wrapText ? 'whitespace-normal break-words' : 'truncate')} title={asset.where_different || 'Not specified'}>
                                    {asset.where_different || <span className="text-gray-400 italic">—</span>}
                                  </span>
                                )}
                                {col.id === 'risks_to_thesis' && (
                                  <span className={clsx('flex-1 min-w-0 text-gray-600 cursor-help', col.wrapText ? 'whitespace-normal break-words' : 'truncate')} title={asset.risks_to_thesis || 'Not specified'}>
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
                                        <span className={clsx('text-gray-700 flex-1 min-w-0', col.wrapText ? 'whitespace-normal break-words' : 'truncate')}>{quickNote}</span>
                                      ) : (
                                        <span className="text-gray-400 italic opacity-0 group-hover/note:opacity-100 transition-opacity">
                                          {isMicro ? '+' : 'Add note...'}
                                        </span>
                                      )}
                                    </div>
                                  )
                                })()}
                                {col.id === 'listNote' && onUpdateListNote && (() => {
                                  const listNote = (asset as any)._listNotes || ''
                                  const rowId = (asset as any)._rowId || asset.id
                                  const isEditing = editingListNoteRowId === rowId

                                  if (isEditing) {
                                    return (
                                      <div className="relative" onClick={(e) => e.stopPropagation()}>
                                        <textarea
                                          autoFocus
                                          value={editingListNoteValue}
                                          onChange={(e) => setEditingListNoteValue(e.target.value)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                              e.preventDefault()
                                              saveListNote(rowId)
                                            } else if (e.key === 'Escape') {
                                              e.preventDefault()
                                              cancelListNoteEdit()
                                            }
                                          }}
                                          onBlur={() => saveListNote(rowId)}
                                          placeholder="Add list note..."
                                          rows={2}
                                          className="w-full text-sm px-2 py-1.5 bg-white border border-blue-400 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 resize-none transition-all"
                                        />
                                        <div className="absolute -bottom-5 right-0 text-[10px] text-gray-400">
                                          Enter to save · Esc to cancel
                                        </div>
                                      </div>
                                    )
                                  }

                                  const isMicro = density === 'micro'

                                  return (
                                    <div
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        startEditingListNote(rowId, listNote)
                                      }}
                                      className={clsx('group/listnote w-full flex items-center cursor-text hover:bg-gray-50 rounded px-1 -mx-1 transition-colors', !col.wrapText && 'h-full')}
                                      title={listNote || 'Click to add list note'}
                                    >
                                      {listNote ? (
                                        <span className={clsx('text-gray-700 flex-1 min-w-0', col.wrapText ? 'whitespace-normal break-words' : 'truncate')}>{listNote}</span>
                                      ) : (
                                        <span className="text-gray-400 italic opacity-0 group-hover/listnote:opacity-100 transition-opacity">
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
                                      freshness === 'stale' && 'stale'
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
                          <div className="pro-expanded-row px-5 py-3 overflow-hidden" style={{ height: expandedRowHeight - densityRowHeight }}>
                            <div className="h-full flex flex-col overflow-hidden">
                              <div className="flex items-center justify-end mb-0 -mt-1 -mr-2">
                                <button
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => { toggleRowExpansion(asset.id); setExpandedMetricColumn(null) }}
                                  className="p-0.5 hover:bg-gray-200/60 rounded transition-colors"
                                >
                                  <X className="w-3.5 h-3.5 text-gray-400" />
                                </button>
                              </div>
                              <div className="flex-1 min-h-0 overflow-hidden">
                                {renderMetricDetail(
                                  asset,
                                  expandedMetricColumn?.assetId === asset.id ? expandedMetricColumn.columnId : 'default',
                                  quote,
                                  coverage,
                                  workflows
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
            <Card padding="none" className={clsx('overflow-hidden pro-table', fillHeight && 'flex-1 min-h-0 flex flex-col', `density-${density}`)}>
              <div className={clsx('pro-table-container overflow-auto', fillHeight && 'flex-1')}>
                {/* Column Header — same as flat table */}
                <div className="pro-table-header" style={{ minWidth: totalTableWidth + (canDragGroupedRows ? dragHandleWidth : 0) + (hiddenColumns.length > 0 ? 40 : 0) }}>
                  <div className="flex items-center">
                    {/* Drag handle spacer */}
                    {canDragGroupedRows && (
                      <div className="flex-shrink-0" style={{ width: dragHandleWidth }} />
                    )}
                    {visibleColumns.map((col, colIndex) => {
                      if (col.id === 'select' && !selectionMode) return null
                      const isPinned = col.pinned || col.id === 'select'
                      const leftOffset = isPinned
                        ? visibleColumns.slice(0, colIndex).filter(c => (c.pinned || c.id === 'select') && (c.id !== 'select' || selectionMode)).reduce((sum, c) => sum + c.width, 0)
                        : 0
                      const sortField = col.id === 'ticker' ? 'symbol' : col.id === 'companyName' ? 'company_name' : col.id === 'price' ? 'current_price' : col.id === 'updated' ? 'updated_at' : col.id
                      const isSorted = sortBy === sortField
                      const isDragOver = dragOverColumn === col.id && draggedColumn !== col.id
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
                            cursor: col.sortable ? 'pointer' : undefined,
                            background: isPinned ? 'linear-gradient(to bottom, #ffffff, #f8fafc)' : undefined
                          }}
                        >
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
                              <span className="flex items-center gap-1 flex-1 min-w-0 select-none">
                                <span className={clsx('truncate', col.pinned && 'text-blue-600 font-medium')}>{col.label}</span>
                              </span>
                              {col.sortable && sortBy === sortField && (
                                <span className="flex-shrink-0">
                                  {sortOrder === 'asc' ? <ChevronUp className="h-3 w-3 text-blue-600" /> : <ChevronDown className="h-3 w-3 text-blue-600" />}
                                </span>
                              )}
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
                          {col.id !== 'select' && (
                            <div
                              className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group-hover:bg-gray-300 transition-colors"
                              onMouseDown={(e) => handleResizeStart(e, col.id, col.width)}
                            />
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Grouped Rows */}
                <div style={{ minWidth: totalTableWidth + (canDragGroupedRows ? dragHandleWidth : 0) }}>
                {groupedAssets.map(group => {
                  const isDropTarget = canDragGroupedRows && dropTargetGroupId === group.key && dragGroupSourceKey !== group.key
                  return (
                  <div
                    key={group.key}
                    className={clsx(
                      'transition-colors duration-150',
                      isDropTarget && 'bg-blue-50/40'
                    )}
                    onDragOver={canDragGroupedRows ? (e) => handleGroupedDragOver(e, group.key) : undefined}
                    onDragLeave={canDragGroupedRows ? handleGroupedDragLeave : undefined}
                    onDrop={canDragGroupedRows ? (e) => handleGroupedDrop(e, group.key) : undefined}
                  >
                    {/* Group Header */}
                    <div
                      className={clsx(
                        'w-full flex items-center gap-2 px-3 py-1.5 bg-gray-50/80 hover:bg-gray-100/80 transition-all duration-150 sticky top-0 z-[5] border-b border-gray-200/60',
                        isDropTarget && 'bg-blue-50 border-l-[3px] border-l-blue-400 pl-[9px]'
                      )}
                    >
                      <button
                        onClick={() => {
                          if (editingGroupId === group.key) return
                          setCollapsedGroups(prev => {
                            const next = new Set(prev)
                            if (next.has(group.key)) next.delete(group.key)
                            else next.add(group.key)
                            return next
                          })
                        }}
                        className="flex items-center gap-2 flex-1 min-w-0"
                      >
                        {collapsedGroups.has(group.key) ? (
                          <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
                        )}
                        {group.color && group.color.startsWith('#') && (
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: group.color }} />
                        )}
                        {groupBy === 'contributor' && group.key !== '__unknown__' && (
                          <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-semibold flex items-center justify-center flex-shrink-0">
                            {group.label.charAt(0).toUpperCase()}
                          </span>
                        )}
                        {groupBy === 'listGroup' && group.key !== '__ungrouped__' && editingGroupId === group.key ? (
                          <input
                            autoFocus
                            className="text-sm font-medium text-gray-700 bg-white border border-blue-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-[80px]"
                            value={editingGroupName}
                            onChange={(e) => setEditingGroupName(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                            onBlur={() => {
                              if (editingGroupName.trim() && editingGroupName.trim() !== group.label) {
                                onRenameGroup?.(group.key, editingGroupName.trim())
                              }
                              setEditingGroupId(null)
                            }}
                            onKeyDown={(e) => {
                              e.stopPropagation()
                              if (e.key === 'Enter') {
                                if (editingGroupName.trim() && editingGroupName.trim() !== group.label) {
                                  onRenameGroup?.(group.key, editingGroupName.trim())
                                }
                                setEditingGroupId(null)
                              } else if (e.key === 'Escape') {
                                setEditingGroupId(null)
                              }
                            }}
                          />
                        ) : (
                          <>
                            {group.color && !group.color.startsWith('#') ? (
                              <span className={clsx('px-1.5 py-0.5 text-xs font-medium rounded', group.color)}>
                                {group.label}
                              </span>
                            ) : (
                              <span className="text-sm font-medium text-gray-700">{group.label}</span>
                            )}
                          </>
                        )}
                        <span className="text-xs text-gray-500 flex-shrink-0">({group.assets.length})</span>
                      </button>

                      {groupBy === 'listGroup' && group.key !== '__ungrouped__' && onRenameGroup && (
                        <div className="relative flex-shrink-0">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              const rect = (e.target as HTMLElement).getBoundingClientRect()
                              setGroupKebabMenu(groupKebabMenu?.groupId === group.key ? null : { groupId: group.key, x: rect.right - 140, y: rect.bottom + 4 })
                            }}
                            className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Group Content — full column cells like flat table */}
                    {!collapsedGroups.has(group.key) && (
                      <div>
                        {group.assets.map((asset, rowIdx) => {
                          const isExpanded = expandedRows.has(asset.id)
                          const isSelected = selectedAssetIds.has(asset.id)
                          const quote = showLivePrices ? getQuote(asset.symbol) : null
                          const livePrice = showLivePrices && quote?.price
                          const displayPrice = livePrice || asset.current_price
                          const changePercent = quote?.changePercent
                          const coverage = assetCoverageMap.get(asset.id) || []
                          const workflows = assetWorkflowMap.get(asset.id) || []
                          const flagColor = getFlagColor(asset.id)
                          const flagStyles = getFlagStyles(flagColor)
                          const isEvenRow = rowIdx % 2 === 1

                          return (
                            <div
                              key={asset._rowId || asset.id}
                              className={clsx(
                                'pro-table-row group/row',
                                isEvenRow && 'row-even',
                                isSelected && 'selected',
                                flagColor && 'flagged',
                                flagColor && `flag-${flagColor}`,
                                isExpanded && 'expanded flex flex-col',
                                canDragGroupedRows && dragGroupAssetId === asset.id && 'opacity-30'
                              )}
                              draggable={canDragGroupedRows}
                              onDragStart={canDragGroupedRows ? (e) => handleGroupedRowDragStart(e, asset.id, asset.symbol, group.key) : undefined}
                              onDragEnd={canDragGroupedRows ? handleGroupedRowDragEnd : undefined}
                            >
                              <div
                                className={clsx('flex items-center', isExpanded ? 'h-auto' : 'h-full')}
                                style={{ minHeight: densityRowHeight }}
                                onDoubleClick={() => toggleRowExpansion(asset.id)}
                                onContextMenu={(e) => {
                                  e.preventDefault()
                                  setRowContextMenu({ assetId: asset.id, rowId: asset._rowId || asset.id, x: e.clientX, y: e.clientY })
                                }}
                              >
                                {/* Drag handle — reveals on hover */}
                                {canDragGroupedRows && (
                                  <div className="flex items-center justify-center cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 opacity-0 group-hover/row:opacity-100 transition-opacity duration-100 flex-shrink-0" style={{ width: dragHandleWidth, minHeight: densityRowHeight }}>
                                    <GripVertical className="w-3.5 h-3.5" />
                                  </div>
                                )}
                                {visibleColumns.map((col, colIndex) => {
                                  if (col.id === 'select' && !selectionMode) return null
                                  const isPinned = col.pinned || col.id === 'select'
                                  const leftOffset = isPinned
                                    ? visibleColumns.slice(0, colIndex).filter(c => (c.pinned || c.id === 'select') && (c.id !== 'select' || selectionMode)).reduce((sum, c) => sum + c.width, 0)
                                    : 0
                                  const lastPinnedCol = [...visibleColumns].reverse().find(c =>
                                    (c.pinned || c.id === 'select') && (c.id !== 'select' || selectionMode)
                                  )
                                  const isLastPinned = isPinned && col.id === lastPinnedCol?.id

                                  return (
                                    <div
                                      key={col.id}
                                      onClick={(e) => { e.stopPropagation(); handleAssetClick(asset) }}
                                      className={clsx(
                                        'pro-table-cell cursor-default',
                                        isExpanded ? 'h-auto' : 'h-full',
                                        col.wrapText && !isExpanded && 'items-start',
                                        densityConfig.padding,
                                        densityConfig.fontSize,
                                        isLastPinned && 'border-r-2 border-slate-200'
                                      )}
                                      style={{
                                        width: col.width,
                                        minWidth: col.minWidth,
                                        backgroundColor: isPinned
                                          ? (isSelected
                                              ? '#dbeafe'
                                              : isEvenRow
                                                ? '#f8fafc'
                                                : '#ffffff')
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
                                              <span className="pro-symbol">{asset.symbol}</span>
                                              {density !== 'micro' && asset.price_targets?.length > 0 && (
                                                <Target className="h-3 w-3 text-amber-500" title={`${asset.price_targets.length} price target(s)`} />
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      )}
                                      {col.id === 'companyName' && (
                                        <span className="pro-company-name flex-1 min-w-0 truncate">
                                          {asset.company_name || '\u2014'}
                                        </span>
                                      )}
                                      {col.id === 'coverage' && (() => {
                                        if (coverage.length === 0) return <span className="pro-empty-cell">\u2014</span>
                                        const lead = coverage.find(c => c.isLead) || coverage[0]
                                        const isMicro = density === 'micro'
                                        if (density === 'comfortable') {
                                          return (
                                            <div className="flex items-center gap-1.5" title={coverage.map(c => `${c.analyst}${c.team ? ` (${c.team})` : ''}`).join('\n')}>
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
                                            <span className="pro-analyst truncate">{lead.analyst}</span>
                                            {coverage.length > 1 && <span className={clsx('pro-analyst-count', isMicro && 'text-[8px] px-0.5 py-0')}>+{coverage.length - 1}</span>}
                                          </div>
                                        )
                                      })()}
                                      {col.id === 'workflows' && (() => {
                                        const isMicro = density === 'micro'
                                        if (workflows.length === 0) {
                                          return (
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation()
                                                setWorkflowPopover({ assetId: asset.id, x: e.clientX, y: e.clientY })
                                              }}
                                              className={clsx('pro-empty-cell hover:text-blue-500 transition-colors', isMicro && 'text-[9px]')}
                                            >
                                              {isMicro ? '\u2014' : 'Add workflow'}
                                            </button>
                                          )
                                        }
                                        return (
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              setWorkflowPopover({ assetId: asset.id, x: e.clientX, y: e.clientY })
                                            }}
                                            className={clsx('flex items-center gap-1 text-left', isMicro && 'gap-0.5')}
                                          >
                                            <span className={clsx('pro-workflow-name truncate', isMicro && 'text-[9px]')}>{workflows[0].name}</span>
                                            {workflows.length > 1 && <span className={clsx('pro-analyst-count', isMicro && 'text-[8px] px-0.5 py-0')}>+{workflows.length - 1}</span>}
                                          </button>
                                        )
                                      })()}
                                      {col.id === 'price' && (() => {
                                        if (!displayPrice) return <span className="pro-empty-cell">\u2014</span>
                                        return (
                                          <span className="pro-price">
                                            {formatPrice(displayPrice)}
                                          </span>
                                        )
                                      })()}
                                      {col.id === 'change' && (() => {
                                        if (!showLivePrices || changePercent === undefined) return <span className="pro-empty-cell">\u2014</span>
                                        const changeClass = getPriceChangeClass(changePercent)
                                        return (
                                          <span className={clsx('pro-price-change', changeClass)}>
                                            {formatPriceChange(changePercent)}
                                          </span>
                                        )
                                      })()}
                                      {(col.id === 'priority' || col.id.startsWith('priority_') || col.prioritySource) && (() => {
                                        const priority = getPriorityForColumn(col, asset.id)
                                        const config = priority && priority !== 'none' ? PRIORITY_CONFIG[priority] : null
                                        const IconComponent = config?.icon
                                        const isMicroOrUltra = density === 'ultra' || density === 'micro'
                                        const isMicro = density === 'micro'
                                        const isEditable = col.prioritySource === 'my' || (col.id === 'priority' && !col.prioritySource)

                                        const content = config ? (
                                          <span className={clsx(
                                            'inline-flex items-center justify-center rounded font-medium text-white',
                                            isMicro ? 'px-1.5 py-0' : isMicroOrUltra ? 'gap-1 px-1.5 py-0' : 'gap-1 px-2 py-0.5',
                                            config.bg
                                          )}>
                                            {!isMicro && IconComponent && <IconComponent className={isMicroOrUltra ? 'w-2.5 h-2.5' : 'w-3 h-3'} />}
                                            <span>{config.label}</span>
                                          </span>
                                        ) : (
                                          <span className="text-gray-400">
                                            {isMicro ? '\u2014' : (isEditable ? 'Set priority' : '\u2014')}
                                          </span>
                                        )

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
                                        <span className={clsx('truncate', density === 'micro' ? 'text-[9px]' : 'text-xs text-gray-600')}>
                                          {asset.sector || '\u2014'}
                                        </span>
                                      )}
                                      {col.id === 'thesis' && (
                                        <span className={clsx('flex-1 min-w-0 text-gray-600 cursor-help', col.wrapText ? 'whitespace-normal break-words' : 'truncate')} title={asset.thesis || 'No thesis'}>
                                          {asset.thesis || <span className="text-gray-400 italic">No thesis</span>}
                                        </span>
                                      )}
                                      {col.id === 'bull_case' && (
                                        <span className={clsx('flex-1 min-w-0 text-gray-600 cursor-help', col.wrapText ? 'whitespace-normal break-words' : 'truncate')} title={asset.bull_case || 'Not specified'}>
                                          {asset.bull_case || <span className="text-gray-400 italic">{'\u2014'}</span>}
                                        </span>
                                      )}
                                      {col.id === 'bear_case' && (
                                        <span className={clsx('flex-1 min-w-0 text-gray-600 cursor-help', col.wrapText ? 'whitespace-normal break-words' : 'truncate')} title={asset.bear_case || 'Not specified'}>
                                          {asset.bear_case || <span className="text-gray-400 italic">{'\u2014'}</span>}
                                        </span>
                                      )}
                                      {col.id === 'base_case' && (
                                        <span className={clsx('flex-1 min-w-0 text-gray-600 cursor-help', col.wrapText ? 'whitespace-normal break-words' : 'truncate')} title={asset.base_case || 'Not specified'}>
                                          {asset.base_case || <span className="text-gray-400 italic">{'\u2014'}</span>}
                                        </span>
                                      )}
                                      {col.id === 'where_different' && (
                                        <span className={clsx('flex-1 min-w-0 text-gray-600 cursor-help', col.wrapText ? 'whitespace-normal break-words' : 'truncate')} title={asset.where_different || 'Not specified'}>
                                          {asset.where_different || <span className="text-gray-400 italic">{'\u2014'}</span>}
                                        </span>
                                      )}
                                      {col.id === 'risks_to_thesis' && (
                                        <span className={clsx('flex-1 min-w-0 text-gray-600 cursor-help', col.wrapText ? 'whitespace-normal break-words' : 'truncate')} title={asset.risks_to_thesis || 'Not specified'}>
                                          {asset.risks_to_thesis || <span className="text-gray-400 italic">{'\u2014'}</span>}
                                        </span>
                                      )}
                                      {col.id === 'notes' && (() => {
                                        const quickNote = asset.quick_note || ''
                                        const isEditing = editingNoteId === asset.id
                                        const isMicro = density === 'micro'

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
                                              <span className={clsx('text-gray-700 flex-1 min-w-0', col.wrapText ? 'whitespace-normal break-words' : 'truncate')}>{quickNote}</span>
                                            ) : (
                                              <span className="text-gray-400 italic opacity-0 group-hover/note:opacity-100 transition-opacity">
                                                {isMicro ? '+' : 'Add note...'}
                                              </span>
                                            )}
                                          </div>
                                        )
                                      })()}
                                      {col.id === 'listNote' && onUpdateListNote && (() => {
                                        const listNote = (asset as any)._listNotes || ''
                                        const rowId = (asset as any)._rowId || asset.id
                                        const isEditing = editingListNoteRowId === rowId
                                        const isMicro = density === 'micro'

                                        if (isEditing) {
                                          return (
                                            <div className="relative" onClick={(e) => e.stopPropagation()}>
                                              <textarea
                                                autoFocus
                                                value={editingListNoteValue}
                                                onChange={(e) => setEditingListNoteValue(e.target.value)}
                                                onKeyDown={(e) => {
                                                  if (e.key === 'Enter' && !e.shiftKey) {
                                                    e.preventDefault()
                                                    saveListNote(rowId)
                                                  } else if (e.key === 'Escape') {
                                                    e.preventDefault()
                                                    cancelListNoteEdit()
                                                  }
                                                }}
                                                onBlur={() => saveListNote(rowId)}
                                                placeholder="Add a list note..."
                                                rows={2}
                                                className="w-full text-sm px-2 py-1.5 bg-white border border-blue-400 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 resize-none transition-all"
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
                                              startEditingListNote(rowId, listNote)
                                            }}
                                            className={clsx('group/note w-full flex items-center cursor-text hover:bg-gray-50 rounded px-1 -mx-1 transition-colors', !col.wrapText && 'h-full')}
                                            title={listNote || 'Click to add list note'}
                                          >
                                            {listNote ? (
                                              <span className={clsx('text-gray-700 flex-1 min-w-0', col.wrapText ? 'whitespace-normal break-words' : 'truncate')}>{listNote}</span>
                                            ) : (
                                              <span className="text-gray-400 italic opacity-0 group-hover/note:opacity-100 transition-opacity">
                                                {isMicro ? '+' : 'Add note...'}
                                              </span>
                                            )}
                                          </div>
                                        )
                                      })()}
                                      {col.id === 'updated' && (() => {
                                        if (!asset.updated_at) return <span className="pro-empty-cell">{'\u2014'}</span>
                                        const freshness = getTimestampFreshness(asset.updated_at)
                                        const isMicro = density === 'micro'
                                        return (
                                          <div className={clsx(
                                            'pro-timestamp flex items-center',
                                            isMicro ? 'gap-0.5' : 'gap-1.5',
                                            freshness === 'recent' && 'recent',
                                            freshness === 'stale' && 'stale'
                                          )}>
                                            <Clock className={isMicro ? 'h-2 w-2 flex-shrink-0' : 'h-3 w-3 flex-shrink-0'} />
                                            <span className="truncate tabular-nums">
                                              {formatRelativeTime(asset.updated_at)}
                                            </span>
                                          </div>
                                        )
                                      })()}
                                      {col.isCustomAI && (
                                        <AIColumnCell
                                          asset={asset}
                                          column={col}
                                          density={density}
                                        />
                                      )}
                                      {col.id === 'actions' && renderRowActions && (
                                        <div className="flex items-center justify-end">
                                          {renderRowActions(asset)}
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                              {/* Expanded content */}
                              {isExpanded && (
                                <div className="pro-expanded-row px-5 py-3 overflow-hidden" style={{ height: expandedRowHeight - densityRowHeight }}>
                                  <div className="h-full flex flex-col overflow-hidden">
                                    <div className="flex items-center justify-end mb-0 -mt-1 -mr-2">
                                      <button
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={() => { toggleRowExpansion(asset.id); setExpandedMetricColumn(null) }}
                                        className="p-0.5 hover:bg-gray-200/60 rounded transition-colors"
                                      >
                                        <X className="w-3.5 h-3.5 text-gray-400" />
                                      </button>
                                    </div>
                                    <div className="flex-1 min-h-0 overflow-hidden">
                                      {renderMetricDetail(
                                        asset,
                                        expandedMetricColumn?.assetId === asset.id ? expandedMetricColumn.columnId : 'default',
                                        quote,
                                        coverage,
                                        workflows
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                  )
                })}
                </div>

              </div>

              {/* Inline Add Row — outside scroll container so it stays at bottom */}
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
                />
              )}
            </Card>
          )}

          {/* KANBAN VIEW */}
          {viewMode === 'kanban' && (() => {
            const visibleKanbanColumns = fullscreenKanbanColumn
              ? kanbanColumns.filter(c => c.key === fullscreenKanbanColumn)
              : kanbanColumns.filter(c => !hiddenKanbanColumns.has(c.key))
            const hiddenColumnsInfo = kanbanColumns.filter(c => hiddenKanbanColumns.has(c.key))

            return (
              <div className="space-y-3">
                {/* Kanban Controls */}
                <div className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-4 py-2">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-500">Organize by:</span>
                    <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                      {KANBAN_ORGANIZATION_OPTIONS.map(option => (
                        <button key={option.value}
                          onClick={() => { onSelectKanbanBoard?.(null); setKanbanOrganization(option.value); setKanbanColumnSearch({}); setHiddenKanbanColumns(new Set()); setFullscreenKanbanColumn(null); setBoardKebabMenu(null) }}
                          className={clsx('flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                            !activeKanbanBoardId && kanbanOrganization === option.value ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                          )}>
                          <option.icon className="w-3.5 h-3.5" />{option.label}
                        </button>
                      ))}
                      {/* Saved custom boards */}
                      {kanbanBoards?.map(board => (
                        <div key={board.id} className="relative">
                          {editingBoardId === board.id ? (
                            <input
                              autoFocus
                              type="text"
                              value={editingBoardName}
                              onChange={(e) => setEditingBoardName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && editingBoardName.trim()) { onRenameKanbanBoard?.(board.id, editingBoardName.trim()); setEditingBoardId(null) }
                                if (e.key === 'Escape') setEditingBoardId(null)
                              }}
                              onBlur={() => { if (editingBoardName.trim()) onRenameKanbanBoard?.(board.id, editingBoardName.trim()); setEditingBoardId(null) }}
                              className="px-2 py-1 text-xs font-medium bg-white border border-blue-300 rounded-md w-24 focus:outline-none focus:ring-1 focus:ring-blue-400"
                            />
                          ) : (
                            <button
                              onClick={() => { onSelectKanbanBoard?.(board.id); setKanbanColumnSearch({}); setHiddenKanbanColumns(new Set()); setFullscreenKanbanColumn(null); setBoardKebabMenu(null) }}
                              onContextMenu={(e) => { e.preventDefault(); setBoardKebabMenu(boardKebabMenu === board.id ? null : board.id) }}
                              className={clsx('flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                                activeKanbanBoardId === board.id ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                              )}>
                              <Columns3 className="w-3.5 h-3.5" />{board.name}
                            </button>
                          )}
                          {boardKebabMenu === board.id && (
                            <div className="absolute left-0 top-full mt-1 w-32 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                              <button onClick={() => { setEditingBoardId(board.id); setEditingBoardName(board.name); setBoardKebabMenu(null) }}
                                className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50 flex items-center gap-2">
                                <FileEdit className="w-3.5 h-3.5 text-gray-400" /> Rename
                              </button>
                              <button onClick={() => { onDeleteKanbanBoard?.(board.id); setBoardKebabMenu(null); if (activeKanbanBoardId === board.id) onSelectKanbanBoard?.(null) }}
                                className="w-full px-3 py-1.5 text-left text-sm hover:bg-red-50 text-red-600 flex items-center gap-2">
                                <Trash2 className="w-3.5 h-3.5" /> Delete
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                      {/* Inline new board input */}
                      {showNewBoardInput ? (
                        <div className="flex items-center gap-1">
                          <input
                            ref={newBoardInputRef}
                            type="text"
                            value={newBoardName}
                            onChange={(e) => setNewBoardName(e.target.value)}
                            placeholder="Board name..."
                            className="px-2 py-1 text-xs border border-gray-300 rounded-md w-28 focus:outline-none focus:ring-1 focus:ring-blue-400"
                            onKeyDown={async (e) => {
                              if (e.key === 'Enter' && newBoardName.trim() && onCreateKanbanBoard) {
                                const board = await onCreateKanbanBoard(newBoardName.trim())
                                if (board) onSelectKanbanBoard?.(board.id)
                                setNewBoardName(''); setShowNewBoardInput(false)
                                setKanbanColumnSearch({}); setHiddenKanbanColumns(new Set()); setFullscreenKanbanColumn(null)
                              }
                              if (e.key === 'Escape') { setShowNewBoardInput(false); setNewBoardName('') }
                            }}
                          />
                          <button onClick={() => { setShowNewBoardInput(false); setNewBoardName('') }} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-3 h-3" /></button>
                        </div>
                      ) : onCreateKanbanBoard && (
                        <button
                          onClick={() => { setShowNewBoardInput(true); setTimeout(() => newBoardInputRef.current?.focus(), 50) }}
                          className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-gray-400 hover:text-gray-600 rounded-md transition-colors"
                          title="Create a new board"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <span className="text-xs text-gray-400 ml-2">{filteredAssets.length} assets</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {hiddenColumnsInfo.length > 0 && !fullscreenKanbanColumn && (
                      <div className="flex items-center gap-1.5">
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
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {visibleKanbanColumns.map(column => {
                    const columnSearchQuery = kanbanColumnSearch[column.key] || ''
                    const filteredColumnAssets = columnSearchQuery
                      ? column.assets.filter((a: any) => a.symbol?.toLowerCase().includes(columnSearchQuery.toLowerCase()) || a.company_name?.toLowerCase().includes(columnSearchQuery.toLowerCase()))
                      : column.assets
                    const isFullscreen = fullscreenKanbanColumn === column.key
                    const isCustomLane = !!activeKanbanBoardId && column.key !== 'unassigned'
                    const isEditingThisLane = editingLaneId === column.key

                    return (
                      <div key={column.key} className={clsx('flex flex-col rounded-lg border border-gray-200 overflow-hidden', isFullscreen ? 'min-h-[600px] flex-1' : 'min-h-[400px]', !isFullscreen && visibleKanbanColumns.length >= 3 ? 'flex-1 min-w-[200px]' : !isFullscreen ? 'w-72 flex-shrink-0' : '')}
                        onDragOver={handleKanbanDragOver} onDrop={() => canDragKanban && handleKanbanDrop(column.key)}>
                        {/* Column Header */}
                        <div className={clsx('px-3 py-2 border-b border-gray-200', column.color)} style={(column as any).bgColor ? { backgroundColor: (column as any).bgColor + '33' } : undefined}>
                          <div className="flex items-center gap-2">
                            {isEditingThisLane ? (
                              <input
                                autoFocus
                                type="text"
                                value={editingLaneName}
                                onChange={(e) => setEditingLaneName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && editingLaneName.trim()) { onRenameKanbanLane?.(column.key, editingLaneName.trim()); setEditingLaneId(null) }
                                  if (e.key === 'Escape') setEditingLaneId(null)
                                }}
                                onBlur={() => { if (editingLaneName.trim()) onRenameKanbanLane?.(column.key, editingLaneName.trim()); setEditingLaneId(null) }}
                                className="font-semibold text-sm bg-white/80 border border-gray-300 rounded px-1.5 py-0.5 flex-1 min-w-0 focus:outline-none focus:ring-1 focus:ring-blue-400"
                              />
                            ) : (
                              <h3 className="font-semibold text-sm truncate flex-1">{column.label}</h3>
                            )}
                            <span className="text-xs bg-white/60 px-1.5 py-0.5 rounded flex-shrink-0">{filteredColumnAssets.length}</span>
                            <div className="flex items-center gap-0.5 flex-shrink-0">
                              {isFullscreen ? (
                                <button onClick={() => setFullscreenKanbanColumn(null)} className="p-1 rounded hover:bg-white/40 text-gray-600"><Minimize2 className="w-3.5 h-3.5" /></button>
                              ) : (
                                <>
                                  <button onClick={() => setFullscreenKanbanColumn(column.key)} className="p-1 rounded hover:bg-white/40 text-gray-600"><Maximize2 className="w-3.5 h-3.5" /></button>
                                  <button onClick={() => { const newHidden = new Set(hiddenKanbanColumns); newHidden.add(column.key); setHiddenKanbanColumns(newHidden) }} className="p-1 rounded hover:bg-white/40 text-gray-600"><EyeOff className="w-3.5 h-3.5" /></button>
                                </>
                              )}
                              {/* Lane kebab menu for custom lanes */}
                              {isCustomLane && (
                                <div className="relative">
                                  <button onClick={() => setLaneKebabMenu(laneKebabMenu === column.key ? null : column.key)} className="p-1 rounded hover:bg-white/40 text-gray-600"><MoreHorizontal className="w-3.5 h-3.5" /></button>
                                  {laneKebabMenu === column.key && (
                                    <div className="absolute right-0 top-full mt-1 w-32 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                                      <button onClick={() => { setEditingLaneId(column.key); setEditingLaneName(column.label); setLaneKebabMenu(null) }}
                                        className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50 flex items-center gap-2">
                                        <FileEdit className="w-3.5 h-3.5 text-gray-400" /> Rename
                                      </button>
                                      {onDeleteKanbanLane && (
                                        <button onClick={() => { onDeleteKanbanLane(column.key); setLaneKebabMenu(null) }}
                                          className="w-full px-3 py-1.5 text-left text-sm hover:bg-red-50 text-red-600 flex items-center gap-2">
                                          <Trash2 className="w-3.5 h-3.5" /> Delete
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                          {/* Per-lane search */}
                          <div className="mt-1.5 relative">
                            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                            <input
                              type="text"
                              placeholder="Filter..."
                              value={columnSearchQuery}
                              onChange={(e) => setKanbanColumnSearch(prev => ({ ...prev, [column.key]: e.target.value }))}
                              className="w-full pl-6 pr-2 py-1 text-xs border border-gray-200 rounded bg-white/80 focus:outline-none focus:ring-1 focus:ring-blue-400"
                            />
                          </div>
                        </div>

                        {/* Column Content */}
                        <div className="flex-1 p-2 space-y-1.5 overflow-y-auto max-h-[500px] bg-gray-50">
                          {filteredColumnAssets.map((asset: any) => {
                            const isSelected = selectedAssetIds.has(asset.id)
                            return (
                              <div key={asset.id} draggable={canDragKanban} onDragStart={() => canDragKanban && handleKanbanDragStart(asset.id)}
                                onClick={() => selectionMode ? toggleAssetSelection(asset.id) : handleAssetClick(asset)}
                                className={clsx('bg-white rounded-lg border p-3 hover:shadow-sm transition-shadow',
                                  canDragKanban ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                                  draggedAsset === asset.id && 'opacity-50',
                                  isSelected ? 'border-blue-400 bg-blue-50' : 'border-gray-200'
                                )}>
                                <div className="flex items-start justify-between mb-1">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      {selectionMode && (isSelected ? <CheckSquare className="h-4 w-4 text-blue-600 flex-shrink-0" /> : <Square className="h-4 w-4 text-gray-400 flex-shrink-0" />)}
                                      <p className="font-semibold text-gray-900 text-sm">{asset.symbol}</p>
                                    </div>
                                    <p className="text-xs text-gray-600 truncate">{asset.company_name}</p>
                                  </div>
                                  {canDragKanban && <GripHorizontal className="w-4 h-4 text-gray-300 flex-shrink-0" />}
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  {(() => { const quote = getQuote(asset.symbol); const displayPrice = (showLivePrices && quote?.price) || asset.current_price; return displayPrice ? <span className="text-xs font-medium text-gray-900">${Number(displayPrice).toFixed(2)}</span> : <span /> })()}
                                  {!activeKanbanBoardId && kanbanOrganization === 'priority' && asset.process_stage && PROCESS_STAGES[asset.process_stage] && (
                                    <span className={clsx('px-1.5 py-0.5 text-[10px] font-medium rounded-full', PROCESS_STAGES[asset.process_stage].color)}>{PROCESS_STAGES[asset.process_stage].label}</span>
                                  )}
                                  {(activeKanbanBoardId || kanbanOrganization !== 'priority') && (() => {
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
                                {asset.sector && (
                                  <div className="mt-1.5">
                                    <span className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">{asset.sector}</span>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                          {filteredColumnAssets.length === 0 && (
                            <div className="text-center py-8">
                              <p className="text-xs text-gray-400">{canDragKanban ? 'Drop assets here' : 'No assets'}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}

                  {/* Add Lane button (custom board mode only) */}
                  {activeKanbanBoardId && onCreateKanbanLane && !fullscreenKanbanColumn && (
                    <div className="flex-shrink-0" style={{ width: 200, minWidth: 200 }}>
                      {showNewLaneInput ? (
                        <div className="rounded-lg border-2 border-dashed border-gray-300 p-3 space-y-2">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                const palette = ['#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#6b7280']
                                const idx = palette.indexOf(newLaneColor)
                                setNewLaneColor(palette[(idx + 1) % palette.length])
                              }}
                              className="w-5 h-5 rounded-full flex-shrink-0 border-2 border-white shadow-sm"
                              style={{ backgroundColor: newLaneColor }}
                              title="Click to change color"
                            />
                            <input
                              ref={newLaneInputRef}
                              type="text"
                              value={newLaneName}
                              onChange={(e) => setNewLaneName(e.target.value)}
                              placeholder="Lane name..."
                              className="flex-1 min-w-0 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && newLaneName.trim()) {
                                  onCreateKanbanLane(newLaneName.trim(), newLaneColor)
                                  setNewLaneName('')
                                  setNewLaneColor('#6366f1')
                                  setShowNewLaneInput(false)
                                }
                                if (e.key === 'Escape') { setShowNewLaneInput(false); setNewLaneName('') }
                              }}
                            />
                          </div>
                          <div className="flex gap-1">
                            <button
                              onClick={() => {
                                if (newLaneName.trim()) {
                                  onCreateKanbanLane(newLaneName.trim(), newLaneColor)
                                  setNewLaneName('')
                                  setNewLaneColor('#6366f1')
                                  setShowNewLaneInput(false)
                                }
                              }}
                              disabled={!newLaneName.trim()}
                              className="flex-1 px-2 py-1 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
                            >
                              Add
                            </button>
                            <button
                              onClick={() => { setShowNewLaneInput(false); setNewLaneName('') }}
                              className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setShowNewLaneInput(true); setTimeout(() => newLaneInputRef.current?.focus(), 50) }}
                          className="w-full h-full min-h-[120px] rounded-lg border-2 border-dashed border-gray-300 hover:border-gray-400 flex flex-col items-center justify-center gap-2 text-gray-400 hover:text-gray-600 transition-colors"
                        >
                          <Plus className="w-5 h-5" />
                          <span className="text-xs font-medium">Add Lane</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })()}

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

          {/* Move to Group submenu */}
          {listGroupData && onMoveItemToGroup && (
            <>
              <div className="h-px bg-gray-100 my-1" />
              <div className="relative group/move">
                <div className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2 cursor-default">
                  <FolderOpen className="w-4 h-4 text-gray-500" />
                  Move to Group
                  <ChevronRight className="w-3 h-3 text-gray-400 ml-auto" />
                </div>
                <div className="absolute left-full top-0 ml-1 w-40 bg-white rounded-lg shadow-xl border border-gray-200 py-1 hidden group-hover/move:block z-[101]">
                  <button
                    onClick={() => { onMoveItemToGroup(rowContextMenu.assetId, null); setRowContextMenu(null) }}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 text-gray-600"
                  >
                    No Group
                  </button>
                  {listGroupData.map(g => (
                    <button
                      key={g.id}
                      onClick={() => { onMoveItemToGroup(rowContextMenu.assetId, g.id); setRowContextMenu(null) }}
                      className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
                    >
                      {g.color && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: g.color }} />}
                      <span className="truncate">{g.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Create Trade Idea */}
          {onCreateTradeIdea && (
            <>
              <div className="h-px bg-gray-100 my-1" />
              <button
                onClick={() => {
                  onCreateTradeIdea(rowContextMenu.assetId)
                  setRowContextMenu(null)
                }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
              >
                <Tag className="w-4 h-4 text-gray-500" />
                Create Trade Idea
              </button>
            </>
          )}

          <div className="h-px bg-gray-100 my-1" />
          {onRemoveFromList ? (() => {
            const isRemovable = !canRemoveRow || canRemoveRow(rowContextMenu.rowId)
            return isRemovable ? (
              <button
                onClick={() => {
                  onRemoveFromList(rowContextMenu.rowId)
                  setRowContextMenu(null)
                }}
                className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
              >
                <X className="w-4 h-4" />
                Remove from List
              </button>
            ) : (() => {
              const asset = assets.find(a => a.id === rowContextMenu.assetId)
              const addedByUser = asset?._addedByUser
              const addedByName = addedByUser?.first_name
                ? `${addedByUser.first_name}${addedByUser.last_name ? ' ' + addedByUser.last_name : ''}`
                : addedByUser?.email?.split('@')[0] || 'another user'
              return (
                <div
                  className="w-full px-3 py-2 text-left text-sm text-gray-400 flex items-center gap-2 cursor-not-allowed"
                  title={`Added by ${addedByName}`}
                >
                  <X className="w-4 h-4" />
                  Remove from List
                </div>
              )
            })()
          })() : (
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

      {/* Group Kebab Menu */}
      {groupKebabMenu && (
        <div
          className="group-kebab-menu fixed z-[100] w-36 bg-white rounded-lg shadow-xl border border-gray-200 py-1 animate-in fade-in duration-100"
          style={{ left: groupKebabMenu.x, top: groupKebabMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              const group = listGroupData?.find(g => g.id === groupKebabMenu.groupId)
              if (group) {
                setEditingGroupId(groupKebabMenu.groupId)
                setEditingGroupName(group.name)
              }
              setGroupKebabMenu(null)
            }}
            className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
          >
            <FileEdit className="w-3.5 h-3.5 text-gray-500" />
            Rename
          </button>
          {onDeleteGroup && (
            <button
              onClick={() => {
                onDeleteGroup(groupKebabMenu.groupId)
                setGroupKebabMenu(null)
              }}
              className="w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete Group
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

      {/* Column Management Modal */}
      {showColumnSettings && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center" onClick={() => setShowColumnSettings(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative bg-white rounded-xl shadow-2xl border border-gray-200 w-[680px] max-h-[520px] flex flex-col animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-gray-500" />
                <h3 className="text-sm font-semibold text-gray-900">Manage Columns</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setDraftColumns([...DEFAULT_COLUMNS, ...extraColumns].map(c => ({ ...c })))}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                >
                  Reset to Default
                </button>
                <button onClick={() => setShowColumnSettings(false)} className="p-1 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Body — two-panel layout */}
            <div className="flex flex-1 min-h-0 divide-x divide-gray-200">
              {/* Left: Available columns */}
              <div className="w-1/2 flex flex-col">
                <div className="px-4 py-2.5 border-b border-gray-100">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Available</p>
                </div>
                <div className="flex-1 overflow-y-auto p-2">
                  {(() => {
                    const available = draftColumns.filter(c => !c.visible && c.id !== 'select')
                    const categories = Object.entries(COLUMN_CATEGORIES) as [string, { label: string }][]
                    const grouped = categories.map(([cat, info]) => ({
                      category: cat,
                      label: info.label,
                      cols: available.filter(c => c.category === cat)
                    })).filter(g => g.cols.length > 0)

                    if (available.length === 0) {
                      return (
                        <div className="flex items-center justify-center h-full text-xs text-gray-400 py-8">
                          All columns are visible
                        </div>
                      )
                    }

                    return grouped.map(group => (
                      <div key={group.category} className="mb-2">
                        <div className="px-2 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                          {group.label}
                        </div>
                        {group.cols.map(col => (
                          <button
                            key={col.id}
                            onClick={() => {
                              setDraftColumns(prev => {
                                const withoutCol = prev.filter(c => c.id !== col.id)
                                return [...withoutCol, { ...col, visible: true }]
                              })
                            }}
                            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-50 text-left transition-colors group/avail"
                          >
                            <Plus className="w-3.5 h-3.5 text-gray-300 group-hover/avail:text-blue-500 transition-colors" />
                            <span className="text-xs text-gray-600 group-hover/avail:text-gray-900 flex-1">{col.label}</span>
                            <ChevronRight className="w-3 h-3 text-gray-300 group-hover/avail:text-blue-500 transition-colors" />
                          </button>
                        ))}
                      </div>
                    ))
                  })()}
                </div>
              </div>

              {/* Right: Selected columns (drag to reorder) */}
              <div className="w-1/2 flex flex-col">
                <div className="px-4 py-2.5 border-b border-gray-100">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Selected
                    <span className="ml-1.5 text-gray-400 font-normal normal-case">
                      ({draftColumns.filter(c => c.visible && c.id !== 'select').length})
                    </span>
                  </p>
                </div>
                <div className="flex-1 overflow-y-auto p-2">
                  {draftColumns.filter(c => c.visible && c.id !== 'select').map((col) => (
                    <div
                      key={col.id}
                      className={clsx(
                        'flex items-center gap-1.5 px-2 py-1.5 rounded-md transition-colors',
                        draggedColumn === col.id ? 'opacity-30 bg-gray-100' : 'hover:bg-gray-50'
                      )}
                      draggable
                      onDragStart={() => setDraggedColumn(col.id)}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
                      onDrop={() => {
                        if (draggedColumn) {
                          setDraftColumns(prev => {
                            const arr = [...prev]
                            const from = arr.findIndex(c => c.id === draggedColumn)
                            const to = arr.findIndex(c => c.id === col.id)
                            if (from === -1 || to === -1) return prev
                            const [moved] = arr.splice(from, 1)
                            arr.splice(to, 0, moved)
                            return arr
                          })
                          setDraggedColumn(null)
                        }
                      }}
                      onDragEnd={() => setDraggedColumn(null)}
                    >
                      <GripVertical className="w-3 h-3 text-gray-300 cursor-grab flex-shrink-0" />
                      <span className="text-xs text-gray-700 flex-1 truncate">{col.label}</span>
                      {(col.canUnpin !== false || !col.pinned) ? (
                        <button
                          onClick={() => {
                            setDraftColumns(prev => prev.map(c => {
                              if (c.id !== col.id) return c
                              if (c.pinned && c.canUnpin === false) return c
                              return { ...c, pinned: !c.pinned }
                            }))
                          }}
                          className={clsx(
                            'p-0.5 rounded transition-colors flex-shrink-0',
                            col.pinned ? 'text-blue-600 hover:text-blue-700' : 'text-gray-300 hover:text-gray-500'
                          )}
                          title={col.pinned ? 'Unpin column' : 'Pin column'}
                        >
                          <Pin className="w-3 h-3" />
                        </button>
                      ) : (
                        <Pin className="w-3 h-3 text-blue-600 opacity-50 flex-shrink-0" title="This column cannot be unpinned" />
                      )}
                      <button
                        onClick={() => {
                          setDraftColumns(prev => prev.map(c => c.id === col.id ? { ...c, visible: false } : c))
                        }}
                        className="p-0.5 rounded text-gray-300 hover:text-red-500 transition-colors flex-shrink-0"
                        title="Remove column"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200">
              <button
                onClick={() => setShowColumnSettings(false)}
                className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setColumns(draftColumns)
                  setShowColumnSettings(false)
                }}
                className="px-4 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
              >
                Save
              </button>
            </div>
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
        setSearchResults(data)
      }
    } catch (e) {
      console.error('Search error:', e)
    } finally {
      setIsSearching(false)
    }
  }, [])

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
  const [isFocused, setIsFocused] = useState(false)
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
        setSearchResults(data)
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
      // Lookup all tickers in batch
      const { data: assets, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name')
        .in('symbol', tickers)

      if (error) throw error

      const assetMap = new Map(assets?.map(a => [a.symbol, a]) || [])

      // Separate valid and not-found
      const toAdd: { id: string; symbol: string }[] = []
      const notFound: string[] = []

      for (const ticker of tickers) {
        const asset = assetMap.get(ticker)
        if (!asset) {
          notFound.push(ticker)
        } else {
          toAdd.push({ id: asset.id, symbol: asset.symbol })
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
      e.preventDefault()
      e.stopPropagation()
      setInputValue('')
      setSearchResults([])
      inputRef.current?.blur()
    }
  }

  // Close dropdown on click outside
  useEffect(() => {
    if (searchResults.length === 0) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (
        rowRef.current && !rowRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setSearchResults([])
        setInputValue('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [searchResults.length])

  // Close dropdown on blur (click away from input)
  const handleBlur = useCallback(() => {
    // Small delay so click on dropdown item can fire first
    setTimeout(() => {
      if (!dropdownRef.current?.contains(document.activeElement)) {
        setSearchResults([])
      }
    }, 150)
  }, [])

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
        top: rect.top, // Anchor to top of input row (dropdown renders upward)
        left: rect.left + 32 // Offset for the select column
      })
    } else {
      setDropdownPosition(null)
    }
  }, [searchResults.length])

  return (
    <>
      {/* Add ticker bar — clean single row */}
      <div
        ref={rowRef}
        className={clsx(
          'flex items-center gap-2 px-3 border-t cursor-text transition-colors',
          isFocused
            ? 'border-blue-200 bg-blue-50/30'
            : 'border-gray-200 bg-gray-50/50 hover:bg-gray-50'
        )}
        style={{ minWidth: totalTableWidth, height: densityRowHeight }}
        onClick={() => inputRef.current?.focus()}
      >
        <Plus className={clsx('h-3.5 w-3.5 flex-shrink-0 transition-colors', isFocused ? 'text-blue-400' : 'text-gray-300')} />
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onFocus={() => setIsFocused(true)}
          onBlur={() => { setIsFocused(false); handleBlur() }}
          placeholder={isFocused ? 'Search by ticker or name...' : 'Add ticker...'}
          className="flex-1 bg-transparent border-none outline-none text-xs text-gray-700 placeholder:text-gray-400"
        />
        {isSearching && (
          <Loader2 className="h-3 w-3 text-blue-400 animate-spin flex-shrink-0" />
        )}
        {feedback && (
          <span className={clsx(
            'text-[11px] font-medium flex-shrink-0 transition-opacity',
            feedback.type === 'success' ? 'text-green-600' : 'text-red-500'
          )}>
            {feedback.message}
          </span>
        )}
      </div>

      {/* Search results dropdown - rendered above the input row via portal */}
      {searchResults.length > 0 && dropdownPosition && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] w-80 bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden"
          style={{ bottom: window.innerHeight - dropdownPosition.top + 4, left: dropdownPosition.left }}
        >
          <div className="px-3 py-1.5 text-xs text-gray-400 border-b border-gray-100 bg-gray-50">
            ↑↓ navigate · Enter add · Esc clear
          </div>
          {searchResults.map((asset, idx) => (
            <button
              key={asset.id}
              onClick={() => addAsset(asset.id, asset.symbol)}
              onMouseEnter={() => setSelectedIndex(idx)}
              className={clsx(
                'w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-gray-50 transition-colors',
                idx === selectedIndex && 'bg-blue-50'
              )}
            >
              <span className="font-semibold text-gray-900 flex-shrink-0">{asset.symbol}</span>
              <span className="text-xs text-gray-500 truncate flex-1 min-w-0">{asset.company_name}</span>
              {asset.sector && (
                <span className="text-[10px] text-gray-400 flex-shrink-0">{asset.sector}</span>
              )}
              <Plus className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
            </button>
          ))}
        </div>,
        document.body
      )}

    </>
  )
}

export default AssetTableView
