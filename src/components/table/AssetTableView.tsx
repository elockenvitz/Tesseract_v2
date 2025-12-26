/**
 * AssetTableView - Shared table view component for displaying assets
 *
 * Used by both AssetsListPage and ListTab to provide consistent UI.
 * Includes: toolbar, filters, table/kanban/tree views, selection, bulk actions.
 */

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  TrendingUp, Search, Filter, Plus, Calendar, Target, FileText, ArrowUpDown,
  ChevronDown, ChevronUp, X, LayoutGrid, List, Table2, Bookmark, BookmarkCheck,
  SlidersHorizontal, CalendarRange, Trash2, Check, CheckSquare, Square,
  Download, Tag, ListPlus, AlertCircle, Loader2, MoreHorizontal, Clock,
  TrendingDown, Bell, RefreshCw, Activity, Settings2, GripVertical, Eye, EyeOff,
  ChevronRight, Pin, PinOff, Edit3, Save, Columns3, GitBranch, FolderTree,
  Layers, GripHorizontal, FolderOpen, Folder, Maximize2, Minimize2, Users, FileEdit
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

const PRIORITY_OPTIONS = [
  { value: 'high', label: 'High', color: 'bg-red-100 text-red-700' },
  { value: 'medium', label: 'Medium', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'low', label: 'Low', color: 'bg-green-100 text-green-700' },
  { value: 'none', label: 'None', color: 'bg-gray-100 text-gray-700' }
]

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

const EXPANDED_ROW_HEIGHT = 280

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
  bulkActionIcon = <Trash2 className="h-4 w-4 mr-1" />
}: AssetTableViewProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Density state
  const [density, setDensity] = useState<DensityMode>(() => {
    const saved = localStorage.getItem('table-density')
    return (saved as DensityMode) || 'comfortable'
  })

  useEffect(() => {
    const handleStorageChange = () => {
      const saved = localStorage.getItem('table-density')
      if (saved && saved !== density) setDensity(saved as DensityMode)
    }
    const interval = setInterval(handleStorageChange, 200)
    return () => clearInterval(interval)
  }, [density])

  const densityConfig = DENSITY_CONFIG[density]
  const densityRowHeight = densityConfig.rowHeight

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
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [editingCell, setEditingCell] = useState<{ assetId: string; field: 'priority' | 'stage' } | null>(null)
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingNoteValue, setEditingNoteValue] = useState('')
  const [workflowPopover, setWorkflowPopover] = useState<{ assetId: string; x: number; y: number } | null>(null)
  const [editingColumnLabel, setEditingColumnLabel] = useState<string | null>(null)
  const [editingColumnValue, setEditingColumnValue] = useState('')
  const [resizingColumn, setResizingColumn] = useState<string | null>(null)
  const [resizeStartX, setResizeStartX] = useState(0)
  const [resizeStartWidth, setResizeStartWidth] = useState(0)
  const [activeTableFilter, setActiveTableFilter] = useState<string | null>(null)

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

  // Fetch workflow progress
  const { data: assetWorkflowProgress } = useQuery({
    queryKey: ['asset-workflow-progress-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_workflow_progress')
        .select(`asset_id, workflow_id, is_started, is_completed, workflows:workflow_id (id, name, color)`)
        .eq('is_started', true)
        .eq('is_completed', false)
      if (error) throw error
      return data || []
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
      filtered = filtered.filter(a => selectedPriorities.includes(a.priority || 'none'))
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
          const priorityOrder = { high: 4, medium: 3, low: 2, none: 1 }
          aValue = priorityOrder[a.priority as keyof typeof priorityOrder] || 0
          bValue = priorityOrder[b.priority as keyof typeof priorityOrder] || 0
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

  // Active filters
  const activeFilters = useMemo(() => {
    const filters: { type: string; value: string; label: string }[] = []
    if (searchQuery) filters.push({ type: 'search', value: searchQuery, label: `Search: "${searchQuery}"` })
    selectedPriorities.forEach(p => {
      const opt = PRIORITY_OPTIONS.find(o => o.value === p)
      filters.push({ type: 'priority', value: p, label: `Priority: ${opt?.label || p}` })
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
    setColumns(prev => prev.map(col => col.id === columnId ? { ...col, visible: !col.visible } : col))
  }, [])

  const toggleColumnPin = useCallback((columnId: string) => {
    setColumns(prev => prev.map(col => col.id === columnId ? { ...col, pinned: !col.pinned } : col))
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

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(columns)) }
    catch (e) { console.warn('Failed to save columns:', e) }
  }, [columns, storageKey])

  const toggleRowExpansion = useCallback((assetId: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(assetId)) next.delete(assetId)
      else next.add(assetId)
      return next
    })
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
    const pinnedCols = columns.filter(c => c.visible && c.pinned)
    const unpinnedCols = columns.filter(c => c.visible && !c.pinned)
    return [...pinnedCols, ...unpinnedCols]
  }, [columns])

  const totalTableWidth = useMemo(() => visibleColumns.reduce((sum, col) => sum + col.width, 0), [visibleColumns])

  // Virtual scrolling
  const rowVirtualizer = useVirtualizer({
    count: filteredAssets.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: useCallback((index: number) => {
      const asset = filteredAssets[index]
      return expandedRows.has(asset?.id) ? EXPANDED_ROW_HEIGHT : densityRowHeight
    }, [filteredAssets, expandedRows, densityRowHeight]),
    overscan: 5,
  })

  useEffect(() => { rowVirtualizer.measure() }, [expandedRows, rowVirtualizer, density])

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

  // Note editing functions
  const startEditingNote = useCallback((assetId: string, currentNote: string) => {
    setEditingNoteId(assetId)
    setEditingNoteValue(currentNote || '')
  }, [])

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
      // Close column label dropdown if clicking outside
      if (editingColumnLabel) {
        const target = e.target as HTMLElement
        if (!target.closest('[data-column-dropdown]')) {
          setEditingColumnLabel(null)
          setEditingColumnValue('')
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
    }
    if (showColumnSettings || showGroupByMenu || editingColumnLabel || activeTableFilter || workflowPopover) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showColumnSettings, showGroupByMenu, editingColumnLabel, activeTableFilter, workflowPopover])

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

    const handleMouseMove = (e: MouseEvent) => {
      const diff = e.clientX - resizeStartX
      const newWidth = Math.max(50, resizeStartWidth + diff)
      setColumns(prev => prev.map(col => col.id === resizingColumn ? { ...col, width: newWidth } : col))
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
  }, [resizingColumn, resizeStartX, resizeStartWidth])

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
        return PRIORITY_OPTIONS.map(p => ({
          key: p.value, label: p.label, color: p.color,
          assets: filteredAssets.filter(a => (a.priority || 'none') === p.value)
        }))
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
        case 'priority': groupKey = asset.priority || 'none'; break
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
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="text-sm text-gray-600">
          {filteredAssets.length} of {assets.length} assets
          {activeFilters.length > 0 && ` (filtered)`}
        </div>

        <div className="flex items-center space-x-3 flex-wrap">
          {/* Market Status */}
          <div className={clsx(
            'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
            marketStatus.isOpen ? 'bg-green-100 text-green-700'
              : marketStatus.status === 'pre-market' ? 'bg-yellow-100 text-yellow-700'
              : marketStatus.status === 'after-hours' ? 'bg-orange-100 text-orange-700'
              : 'bg-gray-100 text-gray-600'
          )}>
            <div className={clsx('w-1.5 h-1.5 rounded-full', marketStatus.isOpen ? 'bg-green-500 animate-pulse' : 'bg-gray-400')} />
            {marketStatus.isOpen ? 'Market Open' : marketStatus.status === 'pre-market' ? 'Pre-Market' : marketStatus.status === 'after-hours' ? 'After Hours' : 'Closed'}
          </div>

          {/* Live Prices */}
          <button
            onClick={() => setShowLivePrices(!showLivePrices)}
            className={clsx('flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-colors text-sm',
              showLivePrices ? 'bg-green-50 border-green-200 text-green-700' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
            )}
          >
            <Activity className={clsx('w-4 h-4', showLivePrices && 'animate-pulse')} />
            {marketDataLoading && <Loader2 className="w-3 h-3 animate-spin" />}
          </button>

          {showLivePrices && (
            <button onClick={() => refreshAll()} className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:border-gray-300">
              <RefreshCw className={clsx('w-4 h-4', marketDataLoading && 'animate-spin')} />
            </button>
          )}

          {/* Select Mode */}
          <button
            onClick={() => selectionMode ? clearSelection() : setSelectionMode(true)}
            className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors text-sm font-medium',
              selectionMode ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
            )}
          >
            <CheckSquare className="w-4 h-4" />
            {selectionMode ? 'Cancel' : 'Select'}
          </button>

          {/* Column Settings (table only) */}
          {viewMode === 'table' && (
            <div className="relative" ref={columnSettingsRef}>
              <button
                onClick={() => setShowColumnSettings(!showColumnSettings)}
                className={clsx('p-1.5 rounded-lg border transition-colors',
                  showColumnSettings ? 'bg-blue-50 border-blue-200 text-blue-600' : 'border-gray-200 text-gray-500'
                )}
              >
                <Settings2 className="w-4 h-4" />
              </button>

              {showColumnSettings && (
                <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-lg shadow-xl border border-gray-200 z-50">
                  <div className="p-3 border-b border-gray-100 flex items-center justify-between">
                    <h4 className="font-medium text-gray-900 text-sm">Table Columns</h4>
                    <div className="flex items-center gap-2">
                      <button onClick={resetColumnWidths} className="text-xs text-gray-500 hover:text-gray-700">Reset Widths</button>
                      <button onClick={resetColumns} className="text-xs text-blue-600">Reset All</button>
                    </div>
                  </div>
                  <div className="p-2 max-h-80 overflow-y-auto">
                    {columns.filter(col => col.id !== 'select').map((col) => (
                      <div key={col.id} className="flex items-center justify-between py-2 px-2 hover:bg-gray-50 rounded-lg"
                        draggable onDragStart={() => setDraggedColumn(col.id)} onDragOver={(e) => e.preventDefault()}
                        onDrop={() => draggedColumn && reorderColumns(draggedColumn, col.id)}
                      >
                        <div className="flex items-center gap-2">
                          <GripVertical className="w-4 h-4 text-gray-300 cursor-grab" />
                          <button onClick={() => toggleColumnVisibility(col.id)} className="p-1 rounded hover:bg-gray-100">
                            {col.visible ? <Eye className="w-4 h-4 text-gray-600" /> : <EyeOff className="w-4 h-4 text-gray-400" />}
                          </button>
                          <span className={clsx('text-sm', col.visible ? 'text-gray-900' : 'text-gray-400')}>{col.label}</span>
                          <span className="text-xs text-gray-400">{col.width}px</span>
                        </div>
                        <button onClick={() => toggleColumnPin(col.id)} className={clsx('p-1 rounded hover:bg-gray-100', col.pinned ? 'text-blue-600' : 'text-gray-400')}>
                          {col.pinned ? <Pin className="w-4 h-4" /> : <PinOff className="w-4 h-4" />}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Group By (table only) */}
          {viewMode === 'table' && (
            <div className="relative" ref={groupByMenuRef}>
              <button
                onClick={() => setShowGroupByMenu(!showGroupByMenu)}
                className={clsx('flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-sm',
                  groupBy !== 'none' ? 'bg-purple-50 border-purple-200 text-purple-700' : 'bg-white border-gray-200 text-gray-600'
                )}
              >
                <Layers className="w-4 h-4" />
                <span className="hidden sm:inline">{groupBy === 'none' ? 'Group' : GROUP_BY_OPTIONS.find(o => o.value === groupBy)?.label}</span>
                <ChevronDown className="w-3 h-3" />
              </button>

              {showGroupByMenu && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-lg shadow-xl border border-gray-200 z-50 py-1">
                  {GROUP_BY_OPTIONS.map(option => (
                    <button key={option.value}
                      onClick={() => { setGroupBy(option.value); setShowGroupByMenu(false); setCollapsedGroups(new Set()) }}
                      className={clsx('w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-50',
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

          {/* View Mode */}
          {!hideViewModes && (
            <div className="flex items-center border border-gray-200 rounded-lg p-1 bg-gray-50">
              <button onClick={() => setViewMode('table')} className={clsx('p-1.5 rounded', viewMode === 'table' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500')}>
                <Table2 className="w-4 h-4" />
              </button>
              <div className="w-px h-4 bg-gray-300 mx-0.5" />
              <button onClick={() => setViewMode('kanban')} className={clsx('p-1.5 rounded', viewMode === 'kanban' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500')}>
                <Columns3 className="w-4 h-4" />
              </button>
              <button onClick={() => setViewMode('tree')} className={clsx('p-1.5 rounded', viewMode === 'tree' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500')}>
                <FolderTree className="w-4 h-4" />
              </button>
            </div>
          )}

          {viewMode === 'table' && <DensityToggle />}
        </div>
      </div>

      {/* Search */}
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
        <input
          type="text" placeholder="Search by symbol, company name, or sector..." value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Active Filters */}
      {activeFilters.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-gray-500">Active filters:</span>
          {activeFilters.map((filter, idx) => (
            <span key={`${filter.type}-${filter.value}-${idx}`} className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-700 text-sm rounded-full">
              {filter.label}
              <button onClick={() => removeFilter(filter.type, filter.value)}><X className="w-3 h-3" /></button>
            </span>
          ))}
          <button onClick={clearAllFilters} className="text-sm text-gray-500 hover:text-gray-700">Clear all</button>
        </div>
      )}

      {/* Selection Actions */}
      {selectionMode && selectedAssetIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-blue-50 border border-blue-100 rounded-lg">
          <span className="text-sm font-medium text-blue-700">{selectedAssetIds.size} selected</span>
          {onBulkAction && (
            <Button variant="secondary" size="sm" onClick={() => onBulkAction(Array.from(selectedAssetIds))}>
              {bulkActionIcon}
              {bulkActionLabel}
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={clearSelection}>
            <X className="h-4 w-4 mr-1" />
            Clear
          </Button>
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <Card padding="none"><div className="p-6"><ListSkeleton count={5} /></div></Card>
      ) : filteredAssets.length > 0 ? (
        <>
          {/* TABLE VIEW */}
          {viewMode === 'table' && groupBy === 'none' && (
            <Card padding="none" className="overflow-hidden">
              <div ref={tableContainerRef} className="overflow-auto" style={{ maxHeight: Math.min(filteredAssets.length * densityRowHeight, 600) + 48 }}>
                {/* Header */}
                <div className="sticky top-0 z-20 bg-gray-50 border-b border-gray-200" style={{ minWidth: totalTableWidth }}>
                  <div className="flex items-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {visibleColumns.map((col, colIndex) => {
                      if (col.id === 'select' && !selectionMode) return null
                      const isPinned = col.pinned
                      const leftOffset = isPinned ? visibleColumns.slice(0, colIndex).filter(c => c.pinned && (c.id !== 'select' || selectionMode)).reduce((sum, c) => sum + c.width, 0) : 0
                      const sortField = col.id === 'asset' ? 'symbol' : col.id === 'price' ? 'current_price' : col.id === 'updated' ? 'updated_at' : col.id

                      return (
                        <div key={col.id} className={clsx('relative flex items-center px-3 py-3 select-none group', isPinned && 'sticky bg-gray-50 z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]')}
                          style={{ width: col.width, minWidth: col.minWidth, left: isPinned ? leftOffset : undefined }}>
                          {col.id === 'select' ? (
                            <button onClick={() => isAllSelected ? clearSelection() : selectAllFiltered()} className="p-0.5 rounded hover:bg-gray-200 transition-colors" title={isAllSelected ? 'Deselect all' : 'Select all'}>
                              {isAllSelected ? <CheckSquare className="h-4 w-4 text-blue-600" /> : isSomeSelected ? (
                                <div className="relative"><Square className="h-4 w-4 text-gray-400" /><div className="absolute inset-0 flex items-center justify-center"><div className="w-2 h-0.5 bg-blue-600 rounded" /></div></div>
                              ) : <Square className="h-4 w-4 text-gray-400" />}
                            </button>
                          ) : (
                            <div className="flex items-center w-full gap-1 min-w-0">
                              {/* Column Label - click to switch column */}
                              <div className="relative flex-1 min-w-0" data-column-dropdown>
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
                                    data-column-dropdown
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
                                                toggleColumnVisibility(col.id)
                                                if (!targetCol.visible) toggleColumnVisibility(targetCol.id)
                                              }
                                              setEditingColumnLabel(null)
                                            }}
                                            className={clsx(
                                              "w-full px-3 py-2 text-left text-sm rounded-md flex items-center gap-2 transition-colors",
                                              targetCol.id === col.id ? "bg-blue-50 text-blue-700" : targetCol.visible ? "hover:bg-gray-100 text-gray-700" : "hover:bg-gray-100 text-gray-400"
                                            )}
                                          >
                                            {targetCol.visible ? <Eye className="w-3 h-3 flex-shrink-0" /> : <EyeOff className="w-3 h-3 flex-shrink-0" />}
                                            <span className="truncate">{targetCol.label}</span>
                                            {targetCol.id === col.id && <Check className="w-3 h-3 ml-auto text-blue-600 flex-shrink-0" />}
                                          </button>
                                        ))}
                                    </div>
                                    <div className="p-2 border-t border-gray-100 bg-gray-50">
                                      <button
                                        onClick={() => { toggleColumnVisibility(col.id); setEditingColumnLabel(null) }}
                                        className="w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50 rounded-md flex items-center gap-2"
                                      >
                                        <EyeOff className="w-3 h-3" />Hide this column
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* Sort indicator - clickable */}
                              {col.sortable && editingColumnLabel !== col.id && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleSort(sortField) }}
                                  className="p-0.5 rounded hover:bg-gray-200 transition-colors"
                                  title={`Sort by ${col.label}`}
                                >
                                  {sortBy === sortField ? (
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
                                      className="absolute top-full right-0 mt-1 w-48 bg-white rounded-lg shadow-xl border border-gray-200 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200 table-filter-dropdown"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                                        <p className="text-xs font-semibold text-gray-700">Filter by {col.label}</p>
                                        {((col.id === 'priority' && selectedPriorities.length > 0) ||
                                          (col.id === 'sector' && selectedSectors.length > 0) ||
                                          (col.id === 'coverage' && selectedStages.length > 0)) && (
                                          <button onClick={() => {
                                            if (col.id === 'priority') setSelectedPriorities([])
                                            if (col.id === 'sector') setSelectedSectors([])
                                            if (col.id === 'coverage') setSelectedStages([])
                                          }} className="text-xs text-blue-600 hover:text-blue-800">Clear</button>
                                        )}
                                      </div>
                                      <div className="p-2 max-h-64 overflow-y-auto">
                                        {col.id === 'priority' && PRIORITY_OPTIONS.map(opt => (
                                          <button key={opt.value} onClick={() => togglePriority(opt.value)}
                                            className={clsx("w-full px-3 py-2 text-left text-sm rounded-md transition-colors flex items-center gap-2", selectedPriorities.includes(opt.value) ? "bg-blue-50 text-blue-700" : "hover:bg-gray-100 text-gray-700")}>
                                            <div className={clsx("w-4 h-4 rounded border-2 flex items-center justify-center transition-colors", selectedPriorities.includes(opt.value) ? "bg-blue-600 border-blue-600" : "border-gray-300")}>
                                              {selectedPriorities.includes(opt.value) && <Check className="w-2.5 h-2.5 text-white" />}
                                            </div>
                                            <span className={clsx("w-2 h-2 rounded-full", opt.color.split(' ')[0])} />
                                            {opt.label}
                                          </button>
                                        ))}
                                        {col.id === 'sector' && sectors.map(sector => (
                                          <button key={sector} onClick={() => toggleSector(sector)}
                                            className={clsx("w-full px-3 py-2 text-left text-sm rounded-md transition-colors flex items-center gap-2", selectedSectors.includes(sector) ? "bg-blue-50 text-blue-700" : "hover:bg-gray-100 text-gray-700")}>
                                            <div className={clsx("w-4 h-4 rounded border-2 flex items-center justify-center transition-colors", selectedSectors.includes(sector) ? "bg-blue-600 border-blue-600" : "border-gray-300")}>
                                              {selectedSectors.includes(sector) && <Check className="w-2.5 h-2.5 text-white" />}
                                            </div>
                                            {sector}
                                          </button>
                                        ))}
                                        {col.id === 'coverage' && Object.entries(PROCESS_STAGES).map(([key, stage]) => (
                                          <button key={key} onClick={() => toggleStage(key)}
                                            className={clsx("w-full px-3 py-2 text-left text-sm rounded-md transition-colors flex items-center gap-2", selectedStages.includes(key) ? "bg-blue-50 text-blue-700" : "hover:bg-gray-100 text-gray-700")}>
                                            <div className={clsx("w-4 h-4 rounded border-2 flex items-center justify-center transition-colors", selectedStages.includes(key) ? "bg-blue-600 border-blue-600" : "border-gray-300")}>
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

                {/* Body */}
                <div style={{ height: rowVirtualizer.getTotalSize(), minWidth: totalTableWidth, position: 'relative' }}>
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

                    return (
                      <div key={asset.id} className={clsx('absolute top-0 left-0 w-full border-b border-gray-100 hover:bg-gray-50 transition-colors group', isSelected && 'bg-blue-50 hover:bg-blue-100')}
                        style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}>
                        <div className="flex items-center cursor-pointer" style={{ minWidth: totalTableWidth, height: densityRowHeight }}
                          onClick={() => toggleRowExpansion(asset.id)} onDoubleClick={() => handleAssetClick(asset)}>
                          {visibleColumns.map((col, colIndex) => {
                            if (col.id === 'select' && !selectionMode) return null
                            const isPinned = col.pinned
                            const leftOffset = isPinned ? visibleColumns.slice(0, colIndex).filter(c => c.pinned && (c.id !== 'select' || selectionMode)).reduce((sum, c) => sum + c.width, 0) : 0

                            return (
                              <div key={col.id} className={clsx('h-full flex items-center', densityConfig.padding, densityConfig.fontSize,
                                isPinned && 'sticky z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.05)]', isPinned && (isSelected ? 'bg-blue-50' : 'bg-white')
                              )} style={{ width: col.width, minWidth: col.minWidth, left: isPinned ? leftOffset : undefined }}>
                                {col.id === 'select' && (
                                  <button onClick={(e) => toggleAssetSelection(asset.id, e)} className="p-0.5 rounded hover:bg-gray-200">
                                    {isSelected ? <CheckSquare className="h-4 w-4 text-blue-600" /> : <Square className="h-4 w-4 text-gray-400" />}
                                  </button>
                                )}
                                {col.id === 'asset' && (
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      <button onClick={(e) => { e.stopPropagation(); toggleRowExpansion(asset.id) }} className="p-0.5 rounded hover:bg-gray-200">
                                        <ChevronRight className={clsx('h-4 w-4 text-gray-400 transition-transform', isExpanded && 'rotate-90')} />
                                      </button>
                                      <div className="min-w-0">
                                        {density === 'comfortable' ? (
                                          <><div className="flex items-center gap-1.5"><p className="text-sm font-semibold text-gray-900 truncate">{asset.symbol}</p>{asset.price_targets?.length > 0 && <Target className="h-3 w-3 text-gray-400" />}</div><p className="text-sm text-gray-600 truncate">{asset.company_name}</p></>
                                        ) : (
                                          <div className="flex items-center gap-1.5"><p className={clsx('font-semibold text-gray-900', density === 'ultra' ? 'text-xs' : 'text-sm')}>{asset.symbol}</p><span className={clsx('text-gray-400', density === 'ultra' ? 'text-xs' : 'text-sm')}>·</span><p className={clsx('text-gray-600 truncate', density === 'ultra' ? 'text-xs' : 'text-sm')}>{asset.company_name}</p></div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                )}
                                {col.id === 'coverage' && (() => {
                                  if (coverage.length === 0) {
                                    return <span className={clsx('text-gray-400', density === 'ultra' ? 'text-xs' : 'text-sm')}>—</span>
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
                                    <div className="flex items-center gap-1.5" title={coverage.map(c => `${c.analyst}${c.team ? ` (${c.team})` : ''}`).join('\n')}>
                                      <span className={clsx('text-gray-900 truncate', density === 'ultra' ? 'text-xs' : 'text-sm')}>{lead.analyst}</span>
                                      {coverage.length > 1 && <span className={clsx('text-blue-600 flex-shrink-0', density === 'ultra' ? 'text-xs' : 'text-xs')}>+{coverage.length - 1}</span>}
                                    </div>
                                  )
                                })()}
                                {col.id === 'workflows' && (() => {
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
                                {col.id === 'price' && (!displayPrice ? <span className="text-gray-400">—</span> : density === 'comfortable' ? (
                                  <div><p className="text-sm font-medium text-gray-900">${Number(displayPrice).toFixed(2)}</p>{showLivePrices && changePercent !== undefined && (
                                    <p className={clsx('text-xs font-medium flex items-center', changePercent >= 0 ? 'text-green-600' : 'text-red-600')}>{changePercent >= 0 ? <TrendingUp className="h-3 w-3 mr-0.5" /> : <TrendingDown className="h-3 w-3 mr-0.5" />}{changePercent >= 0 ? '+' : ''}{changePercent.toFixed(2)}%</p>
                                  )}</div>
                                ) : (
                                  <div className="flex items-center gap-1.5"><p className={clsx('font-medium text-gray-900', density === 'ultra' ? 'text-xs' : 'text-sm')}>${Number(displayPrice).toFixed(2)}</p>{showLivePrices && changePercent !== undefined && (<span className={clsx('font-medium text-xs', changePercent >= 0 ? 'text-green-600' : 'text-red-600')}>{changePercent >= 0 ? '+' : ''}{changePercent.toFixed(2)}%</span>)}</div>
                                ))}
                                {col.id === 'priority' && (editingCell?.assetId === asset.id && editingCell?.field === 'priority' ? (
                                  <select className="text-xs px-2 py-1 border border-blue-400 rounded" value={asset.priority || 'none'}
                                    onChange={(e) => quickEditMutation.mutate({ assetId: asset.id, field: 'priority', value: e.target.value })}
                                    onBlur={() => setEditingCell(null)} onClick={(e) => e.stopPropagation()} autoFocus>
                                    {PRIORITY_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                  </select>
                                ) : (
                                  <div className="group/cell flex items-center gap-1" onDoubleClick={(e) => { e.stopPropagation(); setEditingCell({ assetId: asset.id, field: 'priority' }) }}>
                                    <PriorityBadge priority={asset.priority} /><Edit3 className="h-3 w-3 text-gray-300 opacity-0 group-hover/cell:opacity-100" />
                                  </div>
                                ))}
                                {col.id === 'sector' && (
                                  <span className={clsx('text-gray-600 truncate', density === 'ultra' ? 'text-xs' : 'text-sm')}>
                                    {asset.sector || '—'}
                                  </span>
                                )}
                                {col.id === 'thesis' && (
                                  <div className="text-sm text-gray-600 truncate cursor-help" title={asset.thesis || 'No thesis'}>
                                    {summarizeText(asset.thesis, 50) || <span className="text-gray-400 italic">No thesis</span>}
                                  </div>
                                )}
                                {col.id === 'where_different' && (
                                  <div className="text-sm text-gray-600 truncate cursor-help" title={asset.where_different || 'Not specified'}>
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
                                      className="group/note w-full h-full flex items-center cursor-text hover:bg-gray-50 rounded px-1 -mx-1 transition-colors"
                                      title={quickNote || 'Click to add quick note'}
                                    >
                                      {quickNote ? (
                                        <span className="text-sm text-gray-700 truncate">{summarizeText(quickNote, 40)}</span>
                                      ) : (
                                        <span className="text-sm text-gray-400 italic opacity-0 group-hover/note:opacity-100 transition-opacity">
                                          Add note...
                                        </span>
                                      )}
                                    </div>
                                  )
                                })()}
                                {col.id === 'updated' && (
                                  <div className={clsx('flex items-center text-gray-500', density === 'ultra' ? 'text-xs' : 'text-sm')}>
                                    <Calendar className="h-3 w-3 mr-1 flex-shrink-0" />
                                    <span className="truncate">
                                      {asset.updated_at ? formatDistanceToNow(new Date(asset.updated_at), { addSuffix: true }) : '—'}
                                    </span>
                                  </div>
                                )}
                                {col.id === 'actions' && renderRowActions && renderRowActions(asset)}
                              </div>
                            )
                          })}
                        </div>
                        {isExpanded && (
                          <div className="px-6 py-4 bg-gradient-to-b from-gray-50 to-white border-t border-gray-100" style={{ height: EXPANDED_ROW_HEIGHT - densityRowHeight }}>
                            <div className="grid grid-cols-3 gap-6">
                              <div><h4 className="text-xs font-medium text-gray-500 uppercase mb-2">Asset Info</h4><div className="space-y-1.5 text-sm"><div className="flex gap-2"><span className="text-gray-500">Sector:</span><span className="text-gray-900">{asset.sector || '—'}</span></div><div className="flex gap-2"><span className="text-gray-500">Stage:</span><span className="text-gray-900">{asset.process_stage || '—'}</span></div></div></div>
                              <div><h4 className="text-xs font-medium text-gray-500 uppercase mb-2">Thesis</h4><p className="text-sm text-gray-600">{asset.thesis || 'No thesis available'}</p></div>
                              <div><h4 className="text-xs font-medium text-gray-500 uppercase mb-2">Notes</h4><p className="text-sm text-gray-600 italic">{asset.quick_note || 'No notes'}</p></div>
                            </div>
                            <div className="mt-4 pt-3 border-t border-gray-100 flex gap-2"><Button variant="secondary" size="sm" onClick={() => handleAssetClick(asset)}>View Asset Details</Button></div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Workflow Popover */}
              {workflowPopover && (() => {
                const workflows = assetWorkflowMap.get(workflowPopover.assetId) || []
                const asset = filteredAssets.find(a => a.id === workflowPopover.assetId)
                return (
                  <div
                    className="workflow-popover fixed z-50 bg-white rounded-lg shadow-xl border border-gray-200 p-3 min-w-[200px] max-w-[300px]"
                    style={{ left: workflowPopover.x, top: workflowPopover.y }}
                  >
                    <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-100">
                      <span className="text-sm font-medium text-gray-900">{asset?.symbol} Workflows</span>
                      <button onClick={() => setWorkflowPopover(null)} className="p-1 hover:bg-gray-100 rounded">
                        <X className="w-3 h-3 text-gray-400" />
                      </button>
                    </div>
                    <div className="space-y-2">
                      {workflows.map((wf, idx) => (
                        <div key={idx} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: wf.color }} />
                          <span className="text-sm text-gray-700">{wf.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}
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
                                  {kanbanOrganization !== 'priority' && asset.priority && <PriorityBadge priority={asset.priority} size="sm" />}
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
                                  <PriorityBadge priority={asset.priority} size="sm" />
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
        emptyState || <Card padding="none"><div className="p-12 text-center"><EmptyState icon={Search} title="No assets found" description={activeFilters.length > 0 ? "Try adjusting your filters" : "No assets available"} /></div></Card>
      )}
    </div>
  )
}

export default AssetTableView
