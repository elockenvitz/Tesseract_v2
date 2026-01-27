import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  List, TrendingUp, TrendingDown, Plus, Search, Calendar, User, Users, Share2, Trash2,
  MoreVertical, Target, FileText, Star, ChevronRight, CheckSquare, Square, X, Loader2,
  UserPlus, Copy, Link, Mail, Bell, Edit3, MessageSquarePlus, Minus, Check, GripVertical,
  FolderOpen
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useListPermissions, useListSuggestions, useListReorder, backfillSortOrder, useListGroups } from '../../hooks/lists'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { PriorityBadge } from '../ui/PriorityBadge'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { DensityToggle } from '../table/DensityToggle'
import { DENSITY_CONFIG } from '../../contexts/TableContext'
import { useMarketData } from '../../hooks/useMarketData'
import { ListUserFilter } from './ListUserFilter'
import { SuggestAssetModal } from './SuggestAssetModal'
import { PendingSuggestionsPanel } from './PendingSuggestionsPanel'
import { SuggestionBadge } from './SuggestionBadge'
import { MultiTickerInput } from './MultiTickerInput'
import { AssetGroupSection, AddGroupButton } from './AssetGroupSection'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'
import { createPortal } from 'react-dom'

interface AssetListTabProps {
  list: any
  onAssetSelect?: (asset: any) => void
}

interface ListItem {
  id: string
  asset_id: string
  added_at: string
  added_by: string | null
  notes: string | null
  sort_order: number | null
  group_id: string | null
  assets: {
    id: string
    symbol: string
    company_name: string
    current_price: number | null
    sector: string | null
    priority: string | null
    process_stage: string | null
    quick_note?: string | null
    updated_at?: string | null
  } | null
  added_by_user?: {
    email: string
    first_name?: string
    last_name?: string
  }
}

// Column configuration for list table
interface ColumnConfig {
  id: string
  label: string
  visible: boolean
  width: number
  minWidth: number
}

const LIST_COLUMNS: ColumnConfig[] = [
  { id: 'drag', label: '', visible: true, width: 28, minWidth: 28 },
  { id: 'select', label: '', visible: true, width: 32, minWidth: 32 },
  { id: 'asset', label: 'Asset', visible: true, width: 200, minWidth: 150 },
  { id: 'price', label: 'Price', visible: true, width: 100, minWidth: 80 },
  { id: 'priority', label: 'Priority', visible: true, width: 90, minWidth: 70 },
  { id: 'sector', label: 'Sector', visible: true, width: 120, minWidth: 80 },
  { id: 'notes', label: 'Notes', visible: true, width: 180, minWidth: 100 },
  { id: 'added', label: 'Added', visible: true, width: 130, minWidth: 100 }
]

// Sortable row component for virtual list
interface SortableVirtualRowProps {
  id: string
  virtualStart: number
  virtualSize: number
  children: (props: { dragHandleProps: Record<string, any>; isDragging: boolean }) => React.ReactNode
  className?: string
}

function SortableVirtualRow({ id, virtualStart, virtualSize, children, className }: SortableVirtualRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id })

  // Combine virtual positioning with sortable transform
  const style: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: virtualSize,
    // Apply virtualizer's translateY, then sortable's transform on top
    transform: transform
      ? `translateY(${virtualStart}px) translate3d(${transform.x}px, ${transform.y}px, 0)`
      : `translateY(${virtualStart}px)`,
    transition,
    opacity: isDragging ? 0.8 : 1,
    zIndex: isDragging ? 100 : 'auto',
    backgroundColor: isDragging ? 'white' : undefined,
    boxShadow: isDragging ? '0 4px 12px rgba(0,0,0,0.15)' : undefined
  }

  return (
    <div ref={setNodeRef} style={style} className={className}>
      {children({ dragHandleProps: { ...listeners, ...attributes }, isDragging })}
    </div>
  )
}

export function AssetListTab({ list, onAssetSelect }: AssetListTabProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [showRemoveConfirm, setShowRemoveConfirm] = useState<{
    isOpen: boolean
    itemId: string | null
    assetSymbol: string
  }>({
    isOpen: false,
    itemId: null,
    assetSymbol: ''
  })
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())
  const [showShareModal, setShowShareModal] = useState(false)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [selectedUserFilter, setSelectedUserFilter] = useState<string | 'all'>('all')
  const [showSuggestModal, setShowSuggestModal] = useState<{
    isOpen: boolean
    type: 'add' | 'remove'
    asset?: { id: string; symbol: string; company_name: string }
    targetUser?: { id: string; email: string; first_name: string | null; last_name: string | null }
  }>({ isOpen: false, type: 'add' })
  const [showSuggestionsPanel, setShowSuggestionsPanel] = useState(false)
  const [openGroupMenu, setOpenGroupMenu] = useState<string | null>(null)

  const queryClient = useQueryClient()
  const { user } = useAuth()
  const tableContainerRef = useRef<HTMLDivElement>(null)

  // Density state - synced with localStorage
  type DensityMode = 'comfortable' | 'compact' | 'ultra'
  const [density, setDensity] = useState<DensityMode>(() => {
    const saved = localStorage.getItem('table-density')
    return (saved as DensityMode) || 'comfortable'
  })

  // Listen for density changes
  useEffect(() => {
    const handleStorageChange = () => {
      const saved = localStorage.getItem('table-density')
      if (saved && saved !== density) {
        setDensity(saved as DensityMode)
      }
    }
    const interval = setInterval(handleStorageChange, 200)
    return () => clearInterval(interval)
  }, [density])

  const densityConfig = DENSITY_CONFIG[density]
  const densityRowHeight = densityConfig.rowHeight

  // Market data for live prices
  const symbols = useMemo(() => {
    return [] // We'll populate after fetching list items
  }, [])
  const { getQuote } = useMarketData(symbols)

  // Fetch list items with asset details
  const { data: listItems, isLoading } = useQuery({
    queryKey: ['asset-list-items', list.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_list_items')
        .select(`
          *,
          assets(*),
          added_by_user:users!added_by(email, first_name, last_name)
        `)
        .eq('list_id', list.id)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('added_at', { ascending: false })

      if (error) throw error

      // Backfill sort_order for items that have null values
      const items = data as ListItem[]
      const needsBackfill = items.some(i => i.sort_order === null)
      if (needsBackfill && items.length > 0) {
        await backfillSortOrder(items)
      }

      return items
    }
  })

  // Fetch list collaborators
  const { data: collaborators } = useQuery({
    queryKey: ['asset-list-collaborators', list.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_list_collaborations')
        .select(`
          *,
          user:users!asset_list_collaborations_user_id_fkey(id, email, first_name, last_name)
        `)
        .eq('list_id', list.id)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data || []
    }
  })

  // Permission hook for collaborative lists
  const permissions = useListPermissions({
    list: list,
    collaborators: collaborators?.map(c => ({
      user_id: c.user_id,
      permission: c.permission
    })) || []
  })

  // Suggestions hook for collaborative lists
  const {
    incomingCount,
    pendingSuggestions
  } = useListSuggestions({
    listId: list.id,
    enabled: permissions.listType === 'collaborative'
  })

  // Groups hook
  const {
    groups,
    isLoading: groupsLoading,
    createGroup,
    updateGroup,
    deleteGroup,
    moveItemToGroup,
    toggleGroupCollapse,
    isGroupCollapsed,
    isCreating: isCreatingGroup
  } = useListGroups({ listId: list.id })

  // Organize items by group
  const itemsByGroup = useMemo(() => {
    if (!listItems) return { ungrouped: [], grouped: new Map() }

    const ungrouped: ListItem[] = []
    const grouped = new Map<string, ListItem[]>()

    // Initialize groups
    groups.forEach(g => grouped.set(g.id, []))

    // Distribute items
    listItems.forEach(item => {
      if (item.group_id && grouped.has(item.group_id)) {
        grouped.get(item.group_id)!.push(item)
      } else {
        ungrouped.push(item)
      }
    })

    // Sort items within each group by sort_order
    ungrouped.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    grouped.forEach((items, groupId) => {
      items.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    })

    return { ungrouped, grouped }
  }, [listItems, groups])

  // Drag-and-drop reordering
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8 // 8px movement before drag starts
      }
    }),
    useSensor(KeyboardSensor)
  )

  const { handleReorder, isReordering } = useListReorder({
    listId: list.id,
    items: listItems || []
  })

  // Handle drag end event
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const activeId = active.id as string
    const overId = over.id as string

    // Check if dropping on a group header (to move item into group)
    if (overId.startsWith('group-drop-')) {
      const groupId = overId.replace('group-drop-', '')
      const item = listItems?.find(i => i.id === activeId)
      if (item && item.group_id !== groupId) {
        moveItemToGroup({ itemId: activeId, groupId })
      }
      return
    }

    // Check if dropping on "ungrouped" area
    if (overId === 'ungrouped-drop') {
      const item = listItems?.find(i => i.id === activeId)
      if (item && item.group_id !== null) {
        moveItemToGroup({ itemId: activeId, groupId: null })
      }
      return
    }

    // Regular reordering between items
    const sortedItems = [...(listItems || [])].sort((a, b) =>
      (a.sort_order ?? 0) - (b.sort_order ?? 0)
    )

    const oldIndex = sortedItems.findIndex(item => item.id === activeId)
    const newIndex = sortedItems.findIndex(item => item.id === overId)

    if (oldIndex !== -1 && newIndex !== -1) {
      handleReorder(oldIndex, newIndex)
    }
  }

  // Get all unique users who have items in this list
  const listUsers = useMemo(() => {
    if (!listItems) return []

    const userMap = new Map<string, { id: string; email: string; first_name: string | null; last_name: string | null }>()

    // Add the list owner
    if (list.created_by) {
      userMap.set(list.created_by, {
        id: list.created_by,
        email: list.owner_email || '',
        first_name: list.owner_first_name || null,
        last_name: list.owner_last_name || null
      })
    }

    // Add users who added items
    listItems.forEach(item => {
      if (item.added_by && item.added_by_user && !userMap.has(item.added_by)) {
        userMap.set(item.added_by, {
          id: item.added_by,
          email: item.added_by_user.email,
          first_name: item.added_by_user.first_name || null,
          last_name: item.added_by_user.last_name || null
        })
      }
    })

    // Add collaborators
    collaborators?.forEach(c => {
      if (c.user && !userMap.has(c.user_id)) {
        userMap.set(c.user_id, {
          id: c.user_id,
          email: c.user.email,
          first_name: c.user.first_name || null,
          last_name: c.user.last_name || null
        })
      }
    })

    return Array.from(userMap.values())
  }, [listItems, collaborators, list])

  // Remove asset from list mutation
  const removeFromListMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase
        .from('asset_list_items')
        .delete()
        .eq('id', itemId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-list-items', list.id] })
      queryClient.invalidateQueries({ queryKey: ['asset-lists'] })
      setShowRemoveConfirm({ isOpen: false, itemId: null, assetSymbol: '' })
    }
  })

  // Filter items based on search and user filter
  const filteredItems = useMemo(() => {
    if (!listItems) return []

    let items = listItems

    // Apply user filter (for collaborative lists)
    if (permissions.listType === 'collaborative' && selectedUserFilter !== 'all') {
      items = items.filter(item => item.added_by === selectedUserFilter)
    }

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      items = items.filter(item =>
        item.assets?.symbol.toLowerCase().includes(query) ||
        item.assets?.company_name.toLowerCase().includes(query) ||
        (item.notes && item.notes.toLowerCase().includes(query)) ||
        (item.assets?.sector && item.assets.sector.toLowerCase().includes(query))
      )
    }

    return items
  }, [listItems, searchQuery, selectedUserFilter, permissions.listType])

  // Group items by user for collaborative lists
  const itemsByUser = useMemo(() => {
    if (permissions.listType !== 'collaborative' || !listItems) return null

    const groups: Record<string, ListItem[]> = {}

    listItems.forEach(item => {
      const userId = item.added_by || 'unknown'
      if (!groups[userId]) {
        groups[userId] = []
      }
      groups[userId].push(item)
    })

    return groups
  }, [listItems, permissions.listType])

  // Virtual scrolling
  const expandedRowHeight = 32 // Compact inline expanded content
  const rowVirtualizer = useVirtualizer({
    count: filteredItems.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: useCallback((index) => {
      const item = filteredItems[index]
      if (item && expandedRows.has(item.id)) {
        return densityRowHeight + expandedRowHeight
      }
      return densityRowHeight
    }, [filteredItems, expandedRows, densityRowHeight]),
    overscan: 10
  })

  // Calculate total table width
  const visibleColumns = LIST_COLUMNS.filter(col => col.visible && (col.id !== 'select' || selectionMode))
  const totalTableWidth = visibleColumns.reduce((sum, col) => sum + col.width, 0)

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

  const handleRemoveFromList = (itemId: string, assetSymbol: string) => {
    setShowRemoveConfirm({
      isOpen: true,
      itemId,
      assetSymbol
    })
  }

  const confirmRemoveFromList = () => {
    if (showRemoveConfirm.itemId) {
      removeFromListMutation.mutate(showRemoveConfirm.itemId)
    }
  }

  const getUserDisplayName = (user: any) => {
    if (!user) return 'Unknown User'
    if (user.first_name && user.last_name) {
      return `${user.first_name} ${user.last_name}`
    }
    return user.email?.split('@')[0] || 'Unknown User'
  }

  const toggleItemSelection = (itemId: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setSelectedItemIds(prev => {
      const next = new Set(prev)
      if (next.has(itemId)) {
        next.delete(itemId)
      } else {
        next.add(itemId)
      }
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedItemIds.size === filteredItems.length) {
      setSelectedItemIds(new Set())
    } else {
      setSelectedItemIds(new Set(filteredItems.map(item => item.id)))
    }
  }

  const toggleRowExpansion = (itemId: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(itemId)) {
        next.delete(itemId)
      } else {
        next.add(itemId)
      }
      return next
    })
  }

  return (
    <div className="h-full flex flex-col">
      {/* Compact Header Bar */}
      <div className="flex items-center justify-between py-2 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: list.color || '#3b82f6' }}
          />
          <h1 className="text-lg font-semibold text-gray-900 truncate">{list.name}</h1>
          {list.is_default && <Star className="h-3.5 w-3.5 text-yellow-500 flex-shrink-0" />}
          <span className="text-sm text-gray-500 flex-shrink-0">{listItems?.length || 0} assets</span>
          {permissions.listType === 'collaborative' && (
            <Badge variant="secondary" size="sm" className="flex-shrink-0">
              <UserPlus className="h-3 w-3 mr-1" />
              Collaborative
            </Badge>
          )}
          {collaborators && collaborators.length > 0 && (
            <Badge variant="secondary" size="sm" className="flex-shrink-0">
              <Share2 className="h-3 w-3 mr-1" />
              {collaborators.length}
            </Badge>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {permissions.listType === 'collaborative' && incomingCount > 0 && (
            <SuggestionBadge
              count={incomingCount}
              onClick={() => setShowSuggestionsPanel(true)}
            />
          )}

          {/* Search inline */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-40 pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* User filter for collaborative lists */}
          {permissions.listType === 'collaborative' && listUsers.length > 1 && (
            <ListUserFilter
              users={listUsers}
              currentUserId={user?.id || ''}
              selectedUserId={selectedUserFilter}
              onChange={setSelectedUserFilter}
            />
          )}

          <DensityToggle />

          {filteredItems.length > 0 && (
            <button
              onClick={() => {
                setSelectionMode(!selectionMode)
                if (selectionMode) setSelectedItemIds(new Set())
              }}
              className={clsx(
                'px-2.5 py-1.5 text-xs rounded-md border transition-colors',
                selectionMode
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              )}
            >
              {selectionMode ? 'Cancel' : 'Select'}
            </button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowShareModal(true)}
          >
            <Share2 className="h-3.5 w-3.5" />
          </Button>
          <MultiTickerInput
            listId={list.id}
            existingAssetIds={listItems?.map(item => item.asset_id) || []}
          />
          {permissions.listType === 'collaborative' && permissions.canSuggestChanges && listUsers.length > 1 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSuggestModal({ isOpen: true, type: 'add' })}
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Bulk actions bar - only when needed */}
      {selectionMode && selectedItemIds.size > 0 && (
        <div className="flex items-center gap-3 px-3 py-1.5 bg-blue-50 border border-blue-100 rounded-md mb-2 flex-shrink-0">
          <span className="text-xs font-medium text-blue-700">
            {selectedItemIds.size} selected
          </span>
          <Button
            variant="secondary"
            size="sm"
            className="ml-auto text-xs py-1"
            onClick={() => {
              selectedItemIds.forEach(id => {
                removeFromListMutation.mutate(id)
              })
              setSelectedItemIds(new Set())
            }}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            Remove
          </Button>
        </div>
      )}

      {/* Table - fills remaining space */}
      <Card padding="none" className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
          <div className="flex-1 min-h-0 flex flex-col">
            {/* Table area with horizontal scroll */}
            <div className="flex-1 min-h-0 overflow-x-auto flex flex-col">
              {/* Table Header */}
              <div
                className="flex items-center border-b border-gray-200 bg-gray-50 sticky top-0 z-10 flex-shrink-0"
                style={{ minWidth: totalTableWidth }}
              >
                {visibleColumns.map((col) => (
                  <div
                    key={col.id}
                    className={clsx(
                      'flex items-center py-2',
                      density === 'ultra' ? 'px-2' : 'px-3',
                      'text-[10px] font-semibold text-gray-400 uppercase tracking-wide'
                    )}
                    style={{ width: col.width, minWidth: col.minWidth }}
                  >
                    {col.id === 'select' ? (
                      <button
                        onClick={toggleSelectAll}
                        className="p-0.5 rounded hover:bg-gray-200 transition-colors"
                      >
                        {selectedItemIds.size === filteredItems.length ? (
                          <CheckSquare className="h-3.5 w-3.5 text-blue-600" />
                        ) : (
                          <Square className="h-3.5 w-3.5 text-gray-400" />
                        )}
                      </button>
                    ) : (
                      col.label
                    )}
                  </div>
                ))}
              </div>

              {/* Virtual scrolling container - fills remaining height */}
              <div
                ref={tableContainerRef}
                className="flex-1 overflow-y-auto"
              >
              <SortableContext
                items={filteredItems.map(item => item.id)}
                strategy={verticalListSortingStrategy}
              >
              <div
                style={{
                  height: `${rowVirtualizer.getTotalSize()}px`,
                  minWidth: totalTableWidth,
                  position: 'relative'
                }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const item = filteredItems[virtualRow.index]
                  const asset = item.assets
                  const isExpanded = expandedRows.has(item.id)

                  if (!asset) return null

                  return (
                    <SortableVirtualRow
                      key={item.id}
                      id={item.id}
                      virtualStart={virtualRow.start}
                      virtualSize={virtualRow.size}
                      className={clsx(
                        'border-b border-gray-50 hover:bg-blue-50/30 transition-colors',
                        selectedItemIds.has(item.id) && 'bg-blue-50/50 hover:bg-blue-50/70'
                      )}
                    >
                      {({ dragHandleProps, isDragging }) => (
                      <>
                      {/* Main Row */}
                      <div
                        className="flex items-center cursor-pointer"
                        style={{ minWidth: totalTableWidth, height: densityRowHeight }}
                        onClick={() => toggleRowExpansion(item.id)}
                        onDoubleClick={() => handleAssetClick(asset)}
                      >
                        {visibleColumns.map((col) => {
                          if (col.id === 'select' && !selectionMode) return null

                          return (
                            <div
                              key={col.id}
                              className={clsx(
                                'h-full flex items-center',
                                densityConfig.padding,
                                densityConfig.fontSize
                              )}
                              style={{ width: col.width, minWidth: col.minWidth }}
                            >
                              {/* Drag handle column */}
                              {col.id === 'drag' && (
                                <button
                                  {...dragHandleProps}
                                  className={clsx(
                                    'touch-none cursor-grab active:cursor-grabbing p-0.5 rounded hover:bg-gray-200 transition-colors',
                                    isDragging ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'
                                  )}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <GripVertical className={density === 'ultra' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
                                </button>
                              )}

                              {/* Select column */}
                              {col.id === 'select' && (
                                <button
                                  onClick={(e) => toggleItemSelection(item.id, e)}
                                  className="p-0.5 rounded hover:bg-gray-200 transition-colors"
                                >
                                  {selectedItemIds.has(item.id) ? (
                                    <CheckSquare className="h-4 w-4 text-blue-600" />
                                  ) : (
                                    <Square className="h-4 w-4 text-gray-400" />
                                  )}
                                </button>
                              )}

                              {/* Asset column */}
                              {col.id === 'asset' && (
                                <div className="min-w-0 flex-1">
                                  <div className={clsx(
                                    'flex items-center',
                                    density === 'ultra' ? 'gap-1' : 'gap-1.5'
                                  )}>
                                    {/* Expand chevron - hidden in ultra mode for cleaner view */}
                                    {density !== 'ultra' && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          toggleRowExpansion(item.id)
                                        }}
                                        className="p-0.5 rounded hover:bg-gray-200 transition-colors flex-shrink-0"
                                      >
                                        <ChevronRight className={clsx(
                                          'h-3.5 w-3.5 text-gray-400 transition-transform',
                                          isExpanded && 'rotate-90'
                                        )} />
                                      </button>
                                    )}
                                    {/* Group color indicator */}
                                    {item.group_id && (() => {
                                      const itemGroup = groups.find(g => g.id === item.group_id)
                                      return itemGroup ? (
                                        <div
                                          className="w-2 h-2 rounded-full flex-shrink-0"
                                          style={{ backgroundColor: itemGroup.color }}
                                          title={itemGroup.name}
                                        />
                                      ) : null
                                    })()}
                                    <div className="min-w-0 flex-1">
                                      {density === 'comfortable' ? (
                                        <>
                                          <p className="text-sm font-semibold text-gray-900 truncate">
                                            {asset.symbol}
                                          </p>
                                          <p className="text-xs text-gray-500 truncate">{asset.company_name}</p>
                                        </>
                                      ) : (
                                        <div className="flex items-center gap-1">
                                          <span className={clsx(
                                            'font-semibold text-gray-900',
                                            density === 'ultra' ? 'text-xs' : 'text-sm'
                                          )}>
                                            {asset.symbol}
                                          </span>
                                          <span className={clsx(
                                            'text-gray-400 truncate',
                                            density === 'ultra' ? 'text-[10px]' : 'text-xs'
                                          )}>
                                            {asset.company_name}
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Price column */}
                              {col.id === 'price' && (
                                (() => {
                                  const quote = asset.symbol ? getQuote(asset.symbol) : null
                                  const livePrice = quote?.price
                                  const displayPrice = livePrice || asset.current_price
                                  const changePercent = quote?.changePercent

                                  if (!displayPrice) {
                                    return <span className="text-gray-300 text-xs">—</span>
                                  }

                                  if (density === 'comfortable') {
                                    return (
                                      <div>
                                        <p className="text-sm font-medium text-gray-900">
                                          ${Number(displayPrice).toFixed(2)}
                                        </p>
                                        {changePercent !== undefined && (
                                          <p className={clsx(
                                            'text-[11px] font-medium',
                                            changePercent >= 0 ? 'text-green-600' : 'text-red-600'
                                          )}>
                                            {changePercent >= 0 ? '+' : ''}{changePercent.toFixed(2)}%
                                          </p>
                                        )}
                                      </div>
                                    )
                                  }

                                  // Compact and ultra - single line
                                  return (
                                    <div className="flex items-baseline gap-1">
                                      <span className={clsx(
                                        'font-medium text-gray-900 tabular-nums',
                                        density === 'ultra' ? 'text-[11px]' : 'text-xs'
                                      )}>
                                        {Number(displayPrice).toFixed(2)}
                                      </span>
                                      {changePercent !== undefined && (
                                        <span className={clsx(
                                          'font-medium tabular-nums',
                                          density === 'ultra' ? 'text-[10px]' : 'text-[11px]',
                                          changePercent >= 0 ? 'text-green-600' : 'text-red-600'
                                        )}>
                                          {changePercent >= 0 ? '+' : ''}{changePercent.toFixed(1)}%
                                        </span>
                                      )}
                                    </div>
                                  )
                                })()
                              )}

                              {/* Priority column */}
                              {col.id === 'priority' && (
                                <PriorityBadge priority={asset.priority} />
                              )}

                              {/* Sector column */}
                              {col.id === 'sector' && (
                                <span className={clsx(
                                  'text-gray-600 truncate',
                                  density === 'ultra' ? 'text-xs' : 'text-sm'
                                )}>
                                  {asset.sector || '—'}
                                </span>
                              )}

                              {/* Notes column */}
                              {col.id === 'notes' && (
                                <span className={clsx(
                                  'text-gray-600 truncate italic',
                                  density === 'ultra' ? 'text-xs' : 'text-sm'
                                )}>
                                  {item.notes || asset.quick_note || '—'}
                                </span>
                              )}

                              {/* Added column */}
                              {col.id === 'added' && (
                                <div className={clsx(
                                  'flex items-center text-gray-500',
                                  density === 'ultra' ? 'text-xs' : 'text-sm'
                                )}>
                                  <Calendar className="h-3 w-3 mr-1 flex-shrink-0" />
                                  <span className="truncate">
                                    {formatDistanceToNow(new Date(item.added_at), { addSuffix: true })}
                                  </span>
                                </div>
                              )}
                            </div>
                          )
                        })}

                        {/* Row actions - permission based */}
                        <div className={clsx(
                          'flex items-center gap-0.5 px-1 transition-opacity',
                          density === 'ultra' ? 'opacity-60 hover:opacity-100' : 'opacity-0 hover:opacity-100'
                        )}>
                          {/* Move to Group dropdown */}
                          {groups.length > 0 && (
                            <div className="relative">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setOpenGroupMenu(openGroupMenu === item.id ? null : item.id)
                                }}
                                className={clsx(
                                  'rounded hover:bg-blue-100 text-gray-400 hover:text-blue-600 transition-colors',
                                  density === 'ultra' ? 'p-0.5' : 'p-1',
                                  openGroupMenu === item.id && 'bg-blue-100 text-blue-600'
                                )}
                                title="Move to group"
                              >
                                <FolderOpen className={density === 'ultra' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
                              </button>
                              {openGroupMenu === item.id && (
                                <div className="absolute right-0 top-full mt-1 w-40 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
                                  {item.group_id && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        moveItemToGroup({ itemId: item.id, groupId: null })
                                        setOpenGroupMenu(null)
                                      }}
                                      className="w-full px-3 py-1.5 text-left text-xs text-gray-600 hover:bg-gray-50 flex items-center gap-2"
                                    >
                                      <X className="h-3 w-3" />
                                      Remove from group
                                    </button>
                                  )}
                                  {groups.map(group => (
                                    <button
                                      key={group.id}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        moveItemToGroup({ itemId: item.id, groupId: group.id })
                                        setOpenGroupMenu(null)
                                      }}
                                      className={clsx(
                                        'w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 flex items-center gap-2',
                                        item.group_id === group.id ? 'text-blue-600 font-medium' : 'text-gray-700'
                                      )}
                                    >
                                      <div
                                        className="w-2 h-2 rounded-full"
                                        style={{ backgroundColor: group.color }}
                                      />
                                      {group.name}
                                      {item.group_id === group.id && (
                                        <Check className="h-3 w-3 ml-auto" />
                                      )}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          {/* For mutual lists or own items in collaborative lists - show delete */}
                          {permissions.canRemoveItem(item) && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleRemoveFromList(item.id, asset.symbol)
                              }}
                              className={clsx(
                                'rounded hover:bg-red-100 text-gray-400 hover:text-red-600 transition-colors',
                                density === 'ultra' ? 'p-0.5' : 'p-1'
                              )}
                              title="Remove from list"
                            >
                              <Trash2 className={density === 'ultra' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
                            </button>
                          )}

                          {/* For collaborative lists and other users' items - show suggest remove */}
                          {permissions.listType === 'collaborative' &&
                           permissions.canSuggestChanges &&
                           item.added_by !== user?.id &&
                           item.added_by_user && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setShowSuggestModal({
                                  isOpen: true,
                                  type: 'remove',
                                  asset: {
                                    id: asset.id,
                                    symbol: asset.symbol,
                                    company_name: asset.company_name
                                  },
                                  targetUser: {
                                    id: item.added_by!,
                                    email: item.added_by_user.email,
                                    first_name: item.added_by_user.first_name || null,
                                    last_name: item.added_by_user.last_name || null
                                  }
                                })
                              }}
                              className={clsx(
                                'rounded hover:bg-amber-100 text-gray-400 hover:text-amber-600 transition-colors',
                                density === 'ultra' ? 'p-0.5' : 'p-1'
                              )}
                              title="Suggest removing"
                            >
                              <MessageSquarePlus className={density === 'ultra' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Expanded Row Content - Compact inline style */}
                      {isExpanded && (
                        <div className="px-4 py-2 bg-gray-50/50 border-t border-gray-100 flex items-center gap-6 text-xs">
                          {asset.sector && (
                            <span className="text-gray-500">
                              Sector: <span className="text-gray-700 font-medium">{asset.sector}</span>
                            </span>
                          )}
                          {asset.process_stage && (
                            <span className="text-gray-500">
                              Stage: <span className="text-gray-700 font-medium">{asset.process_stage}</span>
                            </span>
                          )}
                          <span className="text-gray-500">
                            Added by: <span className="text-gray-700 font-medium">
                              {item.added_by === user?.id ? 'You' : getUserDisplayName(item.added_by_user)}
                            </span>
                          </span>
                          {item.notes && (
                            <span className="text-gray-500 truncate max-w-xs">
                              Note: <span className="text-gray-700 italic">{item.notes}</span>
                            </span>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleAssetClick(asset)
                            }}
                            className="ml-auto text-blue-600 hover:text-blue-700 font-medium hover:underline"
                          >
                            View Details →
                          </button>
                        </div>
                      )}
                      </>
                      )}
                    </SortableVirtualRow>
                  )
                })}
              </div>
              </SortableContext>

              {/* Empty state message */}
              {filteredItems.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <List className="h-8 w-8 text-gray-300 mb-2" />
                  <p className="text-sm text-gray-500">
                    {listItems?.length === 0 ? 'No assets yet - type below to add' : 'No matches found'}
                  </p>
                </div>
              )}
            </div>
            </div>
            {/* End of horizontal scroll area */}

            {/* Inline Add Row - OUTSIDE scroll containers, always visible at bottom */}
            <InlineTickerRow
              listId={list.id}
              existingAssetIds={listItems?.map(item => item.asset_id) || []}
            />

            {/* Groups Bar */}
            {(groups.length > 0 || permissions.canAddItem) && (
              <div className="flex-shrink-0 border-t border-gray-200 bg-gray-50 px-3 py-2">
                {groups.length > 0 && (
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="text-xs text-gray-500 font-medium">Groups:</span>
                    {groups.map(group => {
                      const count = itemsByGroup.grouped.get(group.id)?.length || 0
                      return (
                        <button
                          key={group.id}
                          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium bg-white border border-gray-200 hover:border-gray-300 transition-colors"
                          title={`${group.name} (${count} items)`}
                        >
                          <div
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: group.color }}
                          />
                          <span className="text-gray-700">{group.name}</span>
                          <span className="text-gray-400">({count})</span>
                        </button>
                      )
                    })}
                    {itemsByGroup.ungrouped.length > 0 && (
                      <span className="text-xs text-gray-400">
                        + {itemsByGroup.ungrouped.length} ungrouped
                      </span>
                    )}
                  </div>
                )}
                {permissions.canAddItem && (
                  <AddGroupButton
                    onAdd={(name) => createGroup({ name })}
                    isLoading={isCreatingGroup}
                  />
                )}
              </div>
            )}
          </div>
          </DndContext>
        )}
      </Card>

      {/* Remove Confirmation */}
      <ConfirmDialog
        isOpen={showRemoveConfirm.isOpen}
        onClose={() => setShowRemoveConfirm({ isOpen: false, itemId: null, assetSymbol: '' })}
        onConfirm={confirmRemoveFromList}
        title="Remove from List"
        message={`Are you sure you want to remove ${showRemoveConfirm.assetSymbol} from "${list.name}"?`}
        confirmText="Remove"
        cancelText="Cancel"
        variant="warning"
        isLoading={removeFromListMutation.isPending}
      />

      {/* Share Modal */}
      {showShareModal && createPortal(
        <ShareListModal
          list={list}
          collaborators={collaborators || []}
          onClose={() => setShowShareModal(false)}
        />,
        document.body
      )}

      {/* Suggest Asset Modal for collaborative lists */}
      {showSuggestModal.isOpen && createPortal(
        <SuggestAssetModal
          listId={list.id}
          listName={list.name}
          suggestionType={showSuggestModal.type}
          preselectedAsset={showSuggestModal.asset}
          preselectedTargetUser={showSuggestModal.targetUser}
          listUsers={listUsers}
          onClose={() => setShowSuggestModal({ isOpen: false, type: 'add' })}
        />,
        document.body
      )}

      {/* Pending Suggestions Panel for collaborative lists */}
      {showSuggestionsPanel && createPortal(
        <PendingSuggestionsPanel
          listId={list.id}
          isOpen={showSuggestionsPanel}
          onClose={() => setShowSuggestionsPanel(false)}
        />,
        document.body
      )}
    </div>
  )
}

// Inline Asset Adder - replaces modal flow
function InlineAssetAdder({
  listId,
  existingAssetIds
}: {
  listId: string
  existingAssetIds: string[]
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [recentlyAdded, setRecentlyAdded] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const { user } = useAuth()

  // Debounce search
  const [debouncedQuery, setDebouncedQuery] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 200)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsExpanded(false)
        setSearchQuery('')
      }
    }
    if (isExpanded) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isExpanded])

  // Focus input when expanded
  useEffect(() => {
    if (isExpanded && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isExpanded])

  // Search for assets
  const { data: searchResults, isFetching: isSearching } = useQuery({
    queryKey: ['inline-asset-search', debouncedQuery, listId],
    queryFn: async () => {
      if (!debouncedQuery.trim() || debouncedQuery.length < 1) return []

      const { data, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name, sector')
        .or(`symbol.ilike.%${debouncedQuery}%,company_name.ilike.%${debouncedQuery}%`)
        .limit(8)

      if (error) throw error
      return data || []
    },
    enabled: debouncedQuery.length >= 1
  })

  // Filter out already-added assets
  const filteredResults = useMemo(() => {
    if (!searchResults) return []
    const existingSet = new Set(existingAssetIds)
    return searchResults.filter(a => !existingSet.has(a.id))
  }, [searchResults, existingAssetIds])

  // Add mutation
  const addMutation = useMutation({
    mutationFn: async (assetId: string) => {
      const { error } = await supabase
        .from('asset_list_items')
        .insert({
          list_id: listId,
          asset_id: assetId,
          added_by: user?.id
        })
      if (error) throw error
      return assetId
    },
    onSuccess: (assetId) => {
      queryClient.invalidateQueries({ queryKey: ['asset-list-items', listId] })
      queryClient.invalidateQueries({ queryKey: ['asset-lists'] })
      // Show "Added" feedback
      setRecentlyAdded(prev => new Set(prev).add(assetId))
      setTimeout(() => {
        setRecentlyAdded(prev => {
          const next = new Set(prev)
          next.delete(assetId)
          return next
        })
      }, 1500)
    }
  })

  const handleAdd = (asset: any) => {
    if (recentlyAdded.has(asset.id) || addMutation.isPending) return
    addMutation.mutate(asset.id)
  }

  if (!isExpanded) {
    return (
      <Button
        variant="primary"
        size="sm"
        onClick={() => setIsExpanded(true)}
      >
        <Plus className="h-4 w-4 mr-1.5" />
        Add Asset
      </Button>
    )
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Type to add asset..."
            className="w-56 pl-9 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setIsExpanded(false)
                setSearchQuery('')
              }
            }}
          />
          {isSearching && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 animate-spin" />
          )}
        </div>
        <button
          onClick={() => {
            setIsExpanded(false)
            setSearchQuery('')
          }}
          className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Dropdown results */}
      {searchQuery.length >= 1 && (
        <div className="absolute top-full left-0 mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden">
          {isSearching && debouncedQuery !== searchQuery ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 text-gray-400 animate-spin" />
            </div>
          ) : filteredResults.length > 0 ? (
            <div className="max-h-64 overflow-y-auto">
              {filteredResults.map((asset) => {
                const isAdding = addMutation.isPending && addMutation.variables === asset.id
                const justAdded = recentlyAdded.has(asset.id)

                return (
                  <button
                    key={asset.id}
                    onClick={() => handleAdd(asset)}
                    disabled={isAdding || justAdded}
                    className={clsx(
                      'w-full px-3 py-2 text-left flex items-center justify-between transition-colors',
                      justAdded
                        ? 'bg-green-50'
                        : 'hover:bg-gray-50'
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 truncate">{asset.symbol}</p>
                      <p className="text-xs text-gray-500 truncate">{asset.company_name}</p>
                    </div>
                    <div className="ml-2 flex-shrink-0">
                      {justAdded ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600">
                          <Check className="h-3.5 w-3.5" />
                          Added
                        </span>
                      ) : isAdding ? (
                        <Loader2 className="h-4 w-4 text-gray-400 animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4 text-gray-400" />
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          ) : debouncedQuery.length >= 1 && !isSearching ? (
            <div className="px-3 py-6 text-center text-sm text-gray-500">
              No assets found
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

// Add Asset to List Modal (legacy - kept for reference)
function AddAssetToListModal({
  listId,
  listName,
  onClose
}: {
  listId: string
  listName: string
  onClose: () => void
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const queryClient = useQueryClient()
  const { user } = useAuth()

  // Search for assets not in this list
  const { data: searchResults, isLoading: isSearching } = useQuery({
    queryKey: ['asset-search-for-list', searchQuery, listId],
    queryFn: async () => {
      if (!searchQuery.trim()) return []

      // Get assets already in the list
      const { data: existingItems } = await supabase
        .from('asset_list_items')
        .select('asset_id')
        .eq('list_id', listId)

      const existingAssetIds = existingItems?.map(i => i.asset_id) || []

      // Search for assets
      const { data, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name, sector')
        .or(`symbol.ilike.%${searchQuery}%,company_name.ilike.%${searchQuery}%`)
        .not('id', 'in', `(${existingAssetIds.join(',') || 'null'})`)
        .limit(10)

      if (error) throw error
      return data || []
    },
    enabled: searchQuery.length >= 2
  })

  const addToListMutation = useMutation({
    mutationFn: async () => {
      if (!selectedAssetId) throw new Error('No asset selected')

      const { error } = await supabase
        .from('asset_list_items')
        .insert({
          list_id: listId,
          asset_id: selectedAssetId,
          added_by: user?.id,
          notes: notes || null
        })

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-list-items', listId] })
      queryClient.invalidateQueries({ queryKey: ['asset-lists'] })
      onClose()
    }
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900">Add Asset to {listName}</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Search input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Search Asset
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by symbol or name..."
                className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                autoFocus
              />
            </div>
          </div>

          {/* Search results */}
          {searchQuery.length >= 2 && (
            <div className="border border-gray-200 rounded-lg max-h-48 overflow-y-auto">
              {isSearching ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                </div>
              ) : searchResults && searchResults.length > 0 ? (
                <div className="divide-y divide-gray-100">
                  {searchResults.map((asset) => (
                    <button
                      key={asset.id}
                      onClick={() => setSelectedAssetId(asset.id)}
                      className={clsx(
                        'w-full px-4 py-2 text-left hover:bg-gray-50 transition-colors',
                        selectedAssetId === asset.id && 'bg-blue-50'
                      )}
                    >
                      <p className="font-medium text-gray-900">{asset.symbol}</p>
                      <p className="text-sm text-gray-500">{asset.company_name}</p>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-center text-gray-500 py-4">No assets found</p>
              )}
            </div>
          )}

          {/* Notes input */}
          {selectedAssetId && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add a note about why you're adding this asset..."
                rows={2}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none"
              />
            </div>
          )}
        </div>

        <div className="px-5 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => addToListMutation.mutate()}
            disabled={!selectedAssetId || addToListMutation.isPending}
          >
            {addToListMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Plus className="h-4 w-4 mr-1" />
                Add to List
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

// Share List Modal
function ShareListModal({
  list,
  collaborators,
  onClose
}: {
  list: any
  collaborators: any[]
  onClose: () => void
}) {
  const [email, setEmail] = useState('')
  const [permission, setPermission] = useState<'view' | 'edit'>('view')
  const queryClient = useQueryClient()

  const inviteMutation = useMutation({
    mutationFn: async () => {
      // First find user by email
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('id')
        .eq('email', email.toLowerCase())
        .single()

      if (userError || !userData) {
        throw new Error('User not found. They must have an account first.')
      }

      // Add collaboration
      const { error } = await supabase
        .from('asset_list_collaborations')
        .insert({
          list_id: list.id,
          user_id: userData.id,
          permission
        })

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-list-collaborators', list.id] })
      setEmail('')
    }
  })

  const removeCollaboratorMutation = useMutation({
    mutationFn: async (collaborationId: string) => {
      const { error } = await supabase
        .from('asset_list_collaborations')
        .delete()
        .eq('id', collaborationId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-list-collaborators', list.id] })
    }
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900">Share "{list.name}"</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Invite by email */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Invite by Email
            </label>
            <div className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colleague@company.com"
                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
              <select
                value={permission}
                onChange={(e) => setPermission(e.target.value as 'view' | 'edit')}
                className="px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              >
                <option value="view">Can view</option>
                <option value="edit">Can edit</option>
              </select>
            </div>
            <Button
              variant="primary"
              className="mt-2 w-full"
              onClick={() => inviteMutation.mutate()}
              disabled={!email || inviteMutation.isPending}
            >
              {inviteMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <UserPlus className="h-4 w-4 mr-1" />
                  Send Invite
                </>
              )}
            </Button>
            {inviteMutation.isError && (
              <p className="mt-2 text-sm text-red-600">
                {(inviteMutation.error as Error).message}
              </p>
            )}
          </div>

          {/* Current collaborators */}
          {collaborators.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Shared With
              </label>
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                {collaborators.map((collab) => (
                  <div key={collab.id} className="flex items-center justify-between px-4 py-2">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {collab.user?.first_name && collab.user?.last_name
                          ? `${collab.user.first_name} ${collab.user.last_name}`
                          : collab.user?.email
                        }
                      </p>
                      <p className="text-xs text-gray-500">{collab.permission}</p>
                    </div>
                    <button
                      onClick={() => removeCollaboratorMutation.mutate(collab.id)}
                      className="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Copy link */}
          <div className="pt-4 border-t border-gray-100">
            <button
              onClick={() => {
                navigator.clipboard.writeText(`${window.location.origin}/lists/${list.id}`)
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 transition-colors"
            >
              <Link className="h-4 w-4" />
              Copy Link
            </button>
          </div>
        </div>

        <div className="px-5 py-4 bg-gray-50 border-t border-gray-100 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  )
}

// Inline Ticker Row - type directly in the table to add assets
function InlineTickerRow({
  listId,
  existingAssetIds
}: {
  listId: string
  existingAssetIds: string[]
}) {
  const [inputValue, setInputValue] = useState('')
  const [isValidating, setIsValidating] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const { user } = useAuth()

  // Parse tickers from input
  const parseTickers = (input: string): string[] => {
    return input
      .toUpperCase()
      .split(/[,\s;]+/)
      .map(t => t.trim())
      .filter(t => t.length > 0 && /^[A-Z0-9.]+$/.test(t))
  }

  // Add assets mutation
  const addMutation = useMutation({
    mutationFn: async (assetIds: string[]) => {
      const insertData = assetIds.map(assetId => ({
        list_id: listId,
        asset_id: assetId,
        added_by: user?.id
      }))

      const { error } = await supabase
        .from('asset_list_items')
        .insert(insertData)

      if (error) throw error
      return assetIds.length
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['asset-list-items', listId] })
      queryClient.invalidateQueries({ queryKey: ['asset-lists'] })
      setInputValue('')
      setFeedback({ type: 'success', message: `Added ${count} asset${count !== 1 ? 's' : ''}` })
      setTimeout(() => setFeedback(null), 2000)
    },
    onError: (error) => {
      setFeedback({ type: 'error', message: 'Failed to add assets' })
      setTimeout(() => setFeedback(null), 3000)
    }
  })

  const handleSubmit = async () => {
    const tickers = parseTickers(inputValue)
    if (tickers.length === 0) return

    setIsValidating(true)
    setFeedback(null)

    try {
      // Validate tickers against database
      const { data: assets, error } = await supabase
        .from('assets')
        .select('id, symbol')
        .in('symbol', tickers)

      if (error) throw error

      const existingSet = new Set(existingAssetIds)
      const validAssets = (assets || []).filter(a => !existingSet.has(a.id))
      const foundSymbols = new Set((assets || []).map(a => a.symbol))
      const notFoundTickers = tickers.filter(t => !foundSymbols.has(t))
      const duplicateTickers = (assets || []).filter(a => existingSet.has(a.id)).map(a => a.symbol)

      if (validAssets.length > 0) {
        addMutation.mutate(validAssets.map(a => a.id))
      }

      // Show feedback for issues
      if (notFoundTickers.length > 0 || duplicateTickers.length > 0) {
        const messages: string[] = []
        if (notFoundTickers.length > 0) {
          messages.push(`Not found: ${notFoundTickers.join(', ')}`)
        }
        if (duplicateTickers.length > 0) {
          messages.push(`Already in list: ${duplicateTickers.join(', ')}`)
        }
        if (validAssets.length === 0) {
          setFeedback({ type: 'error', message: messages.join('. ') })
          setTimeout(() => setFeedback(null), 3000)
        }
      }
    } catch (error) {
      setFeedback({ type: 'error', message: 'Error validating tickers' })
      setTimeout(() => setFeedback(null), 3000)
    } finally {
      setIsValidating(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && inputValue.trim()) {
      e.preventDefault()
      handleSubmit()
    }
  }

  // Always render - this is the inline add row at the bottom of the table
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 bg-gray-50 border-t border-gray-200"
      style={{ minHeight: '48px' }}
    >
      <Plus className="h-5 w-5 text-gray-400 flex-shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (inputValue.trim()) {
            handleSubmit()
          }
        }}
        placeholder="Type tickers to add (AAPL, MSFT, GOOGL) and press Enter..."
        className="flex-1 bg-transparent border-none outline-none text-gray-600 placeholder:text-gray-400 text-sm"
        disabled={isValidating || addMutation.isPending}
      />
      {(isValidating || addMutation.isPending) && (
        <Loader2 className="h-4 w-4 text-blue-500 animate-spin flex-shrink-0" />
      )}
      {feedback && (
        <span className={clsx(
          'text-xs font-medium flex-shrink-0',
          feedback.type === 'success' ? 'text-green-600' : 'text-red-600'
        )}>
          {feedback.message}
        </span>
      )}
    </div>
  )
}

export default AssetListTab
