/**
 * ListTab - Display assets in a specific list
 *
 * Uses the same AssetTableView component as AssetsListPage for consistency.
 * Adds list-specific header (name, description, share, add asset) above the table.
 * Wires useListPermissions, useListSuggestions, useListGroups, useListReorder.
 */

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, X, Search, Loader2, Trash2, Check,
  CheckCircle2, XCircle
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { ShareListDialog } from '../lists/ShareListDialog'
import { ListTableView } from '../lists/ListTableView'
import { AddTradeIdeaModal } from '../trading/AddTradeIdeaModal'
import { ListHeaderStrip } from '../lists/ListHeaderStrip'
import { ListBrief } from '../lists/ListBrief'
import { ListFilterChipBar, EMPTY_FILTERS, type ListRowFilters } from '../lists/ListFilterChipBar'
import { ListProgressStrip } from '../lists/ListProgressStrip'
import { ListEmptyState } from '../lists/ListEmptyState'
import { ScreenCriteriaPanel } from '../lists/ScreenCriteriaPanel'
import { useListStatuses } from '../../hooks/lists/useListStatuses'
import { useListRealtime } from '../../hooks/lists/useListRealtime'
import { useListPermissions } from '../../hooks/lists/useListPermissions'
import { useListSuggestions } from '../../hooks/lists/useListSuggestions'
import { useListGroups } from '../../hooks/lists/useListGroups'
import { useListReorder } from '../../hooks/lists/useListReorder'
import { useListKanbanBoards, useKanbanBoard } from '../../hooks/lists/useListKanban'
import { useScreenResults } from '../../hooks/lists/useScreenResults'
import { useUpdateScreenCriteria } from '../../hooks/lists/useUpdateScreenCriteria'
import type { ScreenCriteria } from '../../lib/lists/screen-types'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'

interface ListTabProps {
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
  assignee_id: string | null
  status_id: string | null
  due_date: string | null
  is_flagged: boolean
  assets: {
    id: string
    symbol: string
    company_name: string
    current_price: number | null
    sector: string | null
    priority: string | null
    process_stage: string | null
    thesis?: string | null
    where_different?: string | null
    quick_note?: string | null
    updated_at?: string | null
    price_targets?: any[]
  } | null
  added_by_user?: {
    id: string
    email: string
    first_name?: string
    last_name?: string
  }
  assignee?: {
    id: string
    email: string
    first_name?: string | null
    last_name?: string | null
  } | null
  status?: {
    id: string
    name: string
    color: string
    sort_order: number
  } | null
  tag_links?: Array<{
    tag: {
      id: string
      name: string
      color: string
    } | null
  }>
}


export function ListTab({ list, onAssetSelect }: ListTabProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // ── State ────────────────────────────────────────────────────────────
  const [showShareDialog, setShowShareDialog] = useState(false)
  const [showSuggestionsPanel, setShowSuggestionsPanel] = useState(false)
  const [showRemoveConfirm, setShowRemoveConfirm] = useState<{
    isOpen: boolean; itemId: string | null; assetSymbol: string
  }>({ isOpen: false, itemId: null, assetSymbol: '' })
  const [showBulkRemoveConfirm, setShowBulkRemoveConfirm] = useState<{
    isOpen: boolean; itemIds: string[]; totalSelected: number
  }>({ isOpen: false, itemIds: [], totalSelected: 0 })

  // Trade Idea modal state
  const [showTradeIdeaModal, setShowTradeIdeaModal] = useState(false)
  const [tradeIdeaAssetId, setTradeIdeaAssetId] = useState<string | undefined>(undefined)

  // Row-level filters (assignee / status / tag / flagged-only)
  const [rowFilters, setRowFilters] = useState<ListRowFilters>(EMPTY_FILTERS)

  // Statuses for the progress strip (same query as cells; React Query dedupes)
  const { statuses: listStatuses } = useListStatuses(list.id)

  // Realtime: keep table + activity + taxonomies in sync with other users' changes
  useListRealtime(list.id)

  const handleProgressFilter = useCallback((statusId: string | null) => {
    if (statusId === null) return // "No status" row click — no-op for now
    setRowFilters(prev => {
      const has = prev.statusIds.includes(statusId)
      return {
        ...prev,
        statusIds: has
          ? prev.statusIds.filter(x => x !== statusId)
          : [...prev.statusIds, statusId]
      }
    })
  }, [])

  const isCollaborative = list.list_type === 'collaborative'

  // ── Data queries ─────────────────────────────────────────────────────

  // Full list row (incl. lifecycle / deadline / brief) + owner profile,
  // kept fresh via invalidations on governance mutations. The `list` prop
  // may only carry summary fields from upstream ListSurface queries.
  const { data: listDetail } = useQuery({
    queryKey: ['asset-list', list.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_lists')
        .select(`
          *,
          owner:users!asset_lists_created_by_fkey(id, email, first_name, last_name)
        `)
        .eq('id', list.id)
        .single()
      if (error) throw error
      return data as any
    },
    enabled: !!list.id
  })

  const contentMode: 'manual' | 'screen' = (listDetail?.content_mode ?? 'manual')
  const isScreen = contentMode === 'screen'
  const screenCriteria = (listDetail?.screen_criteria ?? null) as ScreenCriteria | null

  const { data: listItems = [], isLoading: isLoadingItems } = useQuery({
    queryKey: ['asset-list-items', list.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_list_items')
        .select(`
          *,
          assets(*),
          added_by_user:users!asset_list_items_added_by_fkey(id, email, first_name, last_name),
          assignee:users!asset_list_items_assignee_id_fkey(id, email, first_name, last_name),
          status:list_statuses!asset_list_items_status_id_fkey(id, name, color, sort_order),
          tag_links:list_item_tags(tag:list_tags(id, name, color))
        `)
        .eq('list_id', list.id)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('added_at', { ascending: false })
      if (error) throw error
      return data as ListItem[]
    },
    // Screens don't use asset_list_items — skip the fetch entirely.
    enabled: !isScreen
  })

  const {
    assets: screenAssets,
    isLoading: isLoadingScreen,
    matchCount: screenMatchCount,
    rawCount: screenUniverseCount
  } = useScreenResults({ enabled: isScreen, criteria: screenCriteria })

  const updateScreenCriteria = useUpdateScreenCriteria(list.id)

  // Snapshot the current screen matches into a brand-new manual list,
  // preserving name (+ "(snapshot)"), description, color, and lifecycle.
  const snapshotScreenMutation = useMutation({
    mutationFn: async () => {
      if (!isScreen || !user?.id) throw new Error('Only screens can be snapshotted')
      const matchIds = screenAssets.map(a => a.id)
      if (matchIds.length === 0) throw new Error('No matching assets to snapshot')

      const { data: newList, error: createErr } = await supabase
        .from('asset_lists')
        .insert([{
          name: `${listDetail?.name ?? list.name} (snapshot)`,
          description: listDetail?.description ?? null,
          color: listDetail?.color ?? null,
          list_type: listDetail?.list_type ?? 'mutual',
          content_mode: 'manual',
          created_by: user.id
        }])
        .select('id')
        .single()
      if (createErr) throw createErr

      const rows = matchIds.map(assetId => ({
        list_id: newList.id,
        asset_id: assetId,
        added_by: user.id
      }))
      const { error: itemsErr } = await supabase
        .from('asset_list_items')
        .insert(rows)
      if (itemsErr) throw itemsErr

      return newList.id as string
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-lists'] })
      queryClient.invalidateQueries({ queryKey: ['list-surfaces'] })
    }
  })

  const isLoading = isScreen ? isLoadingScreen : isLoadingItems

  const { data: collaborators = [] } = useQuery({
    queryKey: ['asset-list-collaborators', list.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_list_collaborations')
        .select(`*, user:users!asset_list_collaborations_user_id_fkey(email, first_name, last_name)`)
        .eq('list_id', list.id)
      if (error) throw error
      return data || []
    }
  })

  const { data: isFavorited } = useQuery({
    queryKey: ['list-favorite', list.id, user?.id],
    queryFn: async () => {
      if (!user?.id) return false
      const { data } = await supabase
        .from('asset_list_favorites')
        .select('id')
        .eq('list_id', list.id)
        .eq('user_id', user.id)
        .single()
      return !!data
    },
    enabled: !!user?.id
  })

  // ── Hooks ────────────────────────────────────────────────────────────

  const permissions = useListPermissions({ list, collaborators })

  const {
    incomingCount: suggestionsIncomingCount,
    incomingSuggestions,
    outgoingSuggestions,
    acceptSuggestion,
    rejectSuggestion,
    cancelSuggestion,
    isAccepting,
    isRejecting,
    isCanceling
  } = useListSuggestions({ listId: list.id, enabled: true })

  const {
    groups,
    createGroup,
    updateGroup,
    deleteGroup,
    moveItemToGroup,
    isCreating: isCreatingGroup
  } = useListGroups({ listId: list.id, enabled: true })

  const {
    handleReorder,
    ensureSortOrder
  } = useListReorder({ listId: list.id, items: listItems })

  // Custom kanban boards
  const [activeKanbanBoardId, setActiveKanbanBoardId] = useState<string | null>(null)
  const {
    boards: kanbanBoards,
    createBoard: createKanbanBoard,
    deleteBoard: deleteKanbanBoard,
    renameBoard: renameKanbanBoard
  } = useListKanbanBoards(list.id)

  const {
    lanes: kanbanBoardLanes,
    laneItems: kanbanBoardLaneItems,
    createLane: createKanbanLane,
    deleteLane: deleteKanbanLane,
    renameLane: renameKanbanLane,
    assignToLane: assignToKanbanLane,
    removeFromLane: removeFromKanbanLane
  } = useKanbanBoard(activeKanbanBoardId)

  // Map asset ID → list item ID for kanban lane assignments
  const handleAssignToKanbanLane = useCallback((laneId: string, assetId: string) => {
    const listItemId = listItems.find(i => i.asset_id === assetId)?.id
    if (listItemId) assignToKanbanLane(laneId, listItemId)
  }, [listItems, assignToKanbanLane])

  const handleRemoveFromKanbanLane = useCallback((assetId: string) => {
    const listItemId = listItems.find(i => i.asset_id === assetId)?.id
    if (listItemId) removeFromKanbanLane(listItemId)
  }, [listItems, removeFromKanbanLane])

  // Backfill sort_order on mount via hook
  const backfillDoneRef = useRef<string | null>(null)
  useEffect(() => {
    if (listItems.length > 0 && backfillDoneRef.current !== list.id) {
      backfillDoneRef.current = list.id
      ensureSortOrder()
    }
  }, [listItems.length, list.id, ensureSortOrder])

  // ── Derived data ─────────────────────────────────────────────────────

  const manualUnfilteredAssets = useMemo(() => {
    return listItems
      .filter(item => item.assets)
      .map(item => ({
        ...item.assets!,
        _rowId: item.id,
        _sortOrder: item.sort_order,
        _addedAt: item.added_at,
        _addedBy: item.added_by,
        _addedByUser: item.added_by_user,
        _listNotes: item.notes,
        _listGroupId: item.group_id,
        // Phase 3A list-scoped primitives
        _assigneeId: item.assignee_id,
        _assignee: item.assignee ?? null,
        _statusId: item.status_id,
        _status: item.status ?? null,
        _dueDate: item.due_date,
        _isFlagged: !!item.is_flagged,
        _tags: (item.tag_links ?? [])
          .map(tl => tl.tag)
          .filter((t): t is NonNullable<typeof t> => !!t)
      }))
  }, [listItems])

  // Screens compute their asset set from criteria; manual lists use list_items.
  const unfilteredAssets = isScreen ? screenAssets : manualUnfilteredAssets

  // Apply row-level filters client-side before handing to the table
  const assets = useMemo(() => {
    const f = rowFilters
    const hasAssignee = f.assigneeIds.length > 0
    const hasStatus = f.statusIds.length > 0
    const hasTag = f.tagIds.length > 0
    const anyActive = hasAssignee || hasStatus || hasTag
      || f.flaggedOnly || f.unassignedOnly || f.dueSoon
    if (!anyActive) return unfilteredAssets

    const assigneeSet = new Set(f.assigneeIds)
    const statusSet = new Set(f.statusIds)
    const tagSet = new Set(f.tagIds)

    // "Due soon" = has due_date AND (overdue OR within next 7 days)
    const nowMs = Date.now()
    const weekMs = 7 * 24 * 60 * 60 * 1000

    return unfilteredAssets.filter(a => {
      if (hasAssignee && !(a._assigneeId && assigneeSet.has(a._assigneeId))) return false
      if (hasStatus && !(a._statusId && statusSet.has(a._statusId))) return false
      if (hasTag && !a._tags.some((t: any) => tagSet.has(t.id))) return false
      if (f.flaggedOnly && !a._isFlagged) return false
      if (f.unassignedOnly && a._assigneeId) return false
      if (f.dueSoon) {
        if (!a._dueDate) return false
        const due = new Date(a._dueDate).getTime()
        if (isNaN(due)) return false
        if (due - nowMs > weekMs) return false
      }
      return true
    })
  }, [unfilteredAssets, rowFilters])



  // Map row IDs (list_item.id) → full list item for row-specific lookups
  const rowIdToItemMap = useMemo(() => {
    const map = new Map<string, ListItem>()
    listItems.forEach(item => map.set(item.id, item))
    return map
  }, [listItems])

  const existingAssetIds = useMemo(() =>
    listItems.map(item => item.asset_id),
    [listItems]
  )

  // List group data for AssetTableView
  const listGroupData = useMemo(() => {
    if (!groups || groups.length === 0) return undefined
    return groups.map(g => ({
      id: g.id,
      name: g.name,
      color: g.color,
      sort_order: g.sort_order ?? 0
    }))
  }, [groups])

  // ── Mutations ────────────────────────────────────────────────────────

  const toggleFavoriteMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error('Not authenticated')
      if (isFavorited) {
        await supabase.from('asset_list_favorites').delete().eq('list_id', list.id).eq('user_id', user.id)
      } else {
        await supabase.from('asset_list_favorites').insert({ list_id: list.id, user_id: user.id })
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['list-favorite', list.id] })
      queryClient.invalidateQueries({ queryKey: ['user-favorite-lists'] })
    }
  })

  const removeFromListMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase.from('asset_list_items').delete().eq('id', itemId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-list-items', list.id] })
      queryClient.invalidateQueries({ queryKey: ['asset-lists'] })
      setShowRemoveConfirm({ isOpen: false, itemId: null, assetSymbol: '' })
    }
  })

  const bulkRemoveMutation = useMutation({
    mutationFn: async (itemIds: string[]) => {
      if (itemIds.length === 0) throw new Error('No items to remove')
      const { error } = await supabase.from('asset_list_items').delete().in('id', itemIds)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-list-items', list.id] })
      queryClient.invalidateQueries({ queryKey: ['asset-lists'] })
      setShowBulkRemoveConfirm({ isOpen: false, itemIds: [], totalSelected: 0 })
    }
  })

  const updateListNoteMutation = useMutation({
    mutationFn: async ({ itemId, note }: { itemId: string; note: string }) => {
      const { error } = await supabase
        .from('asset_list_items')
        .update({ notes: note || null })
        .eq('id', itemId)
      if (error) throw error
    },
    onMutate: async ({ itemId, note }) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: ['asset-list-items', list.id] })
      const prev = queryClient.getQueryData<ListItem[]>(['asset-list-items', list.id])
      if (prev) {
        queryClient.setQueryData<ListItem[]>(['asset-list-items', list.id],
          prev.map(item => item.id === itemId ? { ...item, notes: note || null } : item)
        )
      }
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['asset-list-items', list.id], ctx.prev)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-list-items', list.id] })
    }
  })

  const handleUpdateListNote = useCallback((rowId: string, note: string) => {
    updateListNoteMutation.mutate({ itemId: rowId, note })
  }, [updateListNoteMutation])

  // ── Handlers ─────────────────────────────────────────────────────────

  // Move asset to a group (uses _rowId → list_item.id)
  const handleMoveToGroup = useCallback((assetId: string, groupId: string | null) => {
    const asset = assets.find(a => a.id === assetId)
    if (!asset) return
    moveItemToGroup({ itemId: asset._rowId, groupId })
  }, [assets, moveItemToGroup])

  // Rename a group
  const handleRenameGroup = useCallback((groupId: string, name: string) => {
    updateGroup({ groupId, updates: { name } })
  }, [updateGroup])

  // Delete a group
  const handleDeleteGroup = useCallback((groupId: string) => {
    deleteGroup(groupId)
  }, [deleteGroup])

  const handleBulkAction = useCallback((assetIds: string[]) => {
    // Resolve selected asset IDs to rows, then filter by per-row removal permission
    const selectedSet = new Set(assetIds)
    const removableItemIds = assets
      .filter(a => selectedSet.has(a.id) && permissions.canRemoveItem({ added_by: a._addedBy }))
      .map(a => a._rowId)
    if (removableItemIds.length === 0) return
    setShowBulkRemoveConfirm({ isOpen: true, itemIds: removableItemIds, totalSelected: assetIds.length })
  }, [assets, permissions])

  const handleRemoveFromList = useCallback((rowId: string) => {
    const item = rowIdToItemMap.get(rowId)
    if (!item) return
    if (!permissions.canRemoveItem({ added_by: item.added_by })) return
    if (item.assets) {
      setShowRemoveConfirm({ isOpen: true, itemId: item.id, assetSymbol: item.assets.symbol })
    }
  }, [rowIdToItemMap, permissions])

  const handleReorderItem = useCallback((fromIndex: number, toIndex: number) => {
    handleReorder(fromIndex, toIndex)
  }, [handleReorder])

  // Create Trade Idea handler — opens modal with optional pre-selected asset
  const handleCreateTradeIdea = useCallback((assetId?: string) => {
    setTradeIdeaAssetId(assetId)
    setShowTradeIdeaModal(true)
  }, [])

  const canAdd = permissions.canAddAnyItem || permissions.canAddToOwnSection

  // Per-row removal permission check — uses rowId (list_item.id), not assetId
  const canRemoveRow = useCallback((rowId: string): boolean => {
    const item = rowIdToItemMap.get(rowId)
    return item ? permissions.canRemoveItem({ added_by: item.added_by }) : false
  }, [rowIdToItemMap, permissions])


  // ── Render ───────────────────────────────────────────────────────────

  // Compose header data from prop + fresh detail fetch
  const displayList = useMemo(() => ({
    id: list.id,
    name: listDetail?.name ?? list.name,
    color: listDetail?.color ?? list.color ?? null,
    list_type: (listDetail?.list_type ?? list.list_type) as 'mutual' | 'collaborative',
    lifecycle: (listDetail?.lifecycle ?? 'active') as 'active' | 'converted' | 'archived'
  }), [list, listDetail])

  const ownerInitials = useMemo(() => {
    const o = listDetail?.owner
    if (!o) return null
    if (o.first_name && o.last_name) return `${o.first_name[0]}${o.last_name[0]}`.toUpperCase()
    if (o.first_name) return o.first_name[0].toUpperCase()
    if (o.email) return o.email[0].toUpperCase()
    return null
  }, [listDetail])

  const ownerName = useMemo(() => {
    const o = listDetail?.owner
    if (!o) return null
    if (o.first_name && o.last_name) return `${o.first_name} ${o.last_name}`
    if (o.first_name) return o.first_name
    return o.email ?? null
  }, [listDetail])

  return (
    <div className="h-full flex flex-col">
      <ListHeaderStrip
        list={displayList}
        assetCount={assets.length}
        collaborators={collaborators as any}
        ownerName={ownerName}
        ownerInitials={ownerInitials}
        isFavorited={!!isFavorited}
        onToggleFavorite={() => toggleFavoriteMutation.mutate()}
        suggestionsIncomingCount={suggestionsIncomingCount}
        onToggleSuggestionsPanel={() => setShowSuggestionsPanel(!showSuggestionsPanel)}
        showingSuggestionsPanel={showSuggestionsPanel}
        onShare={() => setShowShareDialog(true)}
        permissions={permissions}
        addAssetSlot={(!isScreen && canAdd) ? <InlineAssetAdder listId={list.id} existingAssetIds={existingAssetIds} /> : null}
      />

      <ListBrief
        listId={list.id}
        brief={listDetail?.brief ?? null}
        canEdit={permissions.canWrite}
      />

      {isScreen && (
        <div className="py-1.5">
          <ScreenCriteriaPanel
            criteria={screenCriteria}
            canEdit={permissions.canWrite}
            matchCount={screenMatchCount}
            universeCount={screenUniverseCount}
            isLoading={isLoadingScreen}
            onSave={(next) => updateScreenCriteria.mutate(next)}
            isSaving={updateScreenCriteria.isPending}
            onSnapshot={() => snapshotScreenMutation.mutate()}
            isSnapshotting={snapshotScreenMutation.isPending}
          />
        </div>
      )}

      {!isScreen && unfilteredAssets.length > 0 && (
        <div className="flex items-center gap-3 py-1.5 flex-wrap">
          <div className="min-w-0 flex-1">
            <ListProgressStrip
              statuses={listStatuses}
              assets={unfilteredAssets}
              onFilterByStatus={handleProgressFilter}
              activeStatusIds={rowFilters.statusIds}
            />
          </div>
          <div className="flex-shrink-0 border-l border-gray-200 dark:border-gray-800 pl-3">
            <ListFilterChipBar
              listId={list.id}
              filters={rowFilters}
              onChange={setRowFilters}
            />
          </div>
        </div>
      )}

      {/* Suggestions panel (inline below header) */}
      {showSuggestionsPanel && (incomingSuggestions.length > 0 || outgoingSuggestions.length > 0) && (
        <div className="border border-amber-200 bg-amber-50/50 rounded-lg mb-2 flex-shrink-0">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-amber-200/60">
            <span className="text-xs font-semibold text-amber-800 uppercase tracking-wider">Pending Suggestions</span>
            <button onClick={() => setShowSuggestionsPanel(false)} className="p-0.5 hover:bg-amber-200/50 rounded">
              <X className="h-3.5 w-3.5 text-amber-600" />
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto divide-y divide-amber-100">
            {incomingSuggestions.map(s => (
              <div key={s.id} className="flex items-center justify-between px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-800">
                    {s.suggestion_type === 'add' ? 'Add' : 'Remove'}{' '}
                    <span className="font-semibold">{s.asset?.symbol || 'Unknown'}</span>
                  </p>
                  <p className="text-[10px] text-gray-500">
                    from {s.suggester?.first_name || s.suggester?.email || 'Someone'}
                    {s.notes && ` — "${s.notes}"`}
                    {' · '}{s.created_at ? formatDistanceToNow(new Date(s.created_at), { addSuffix: true }) : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                  <button
                    onClick={() => acceptSuggestion({ suggestionId: s.id })}
                    disabled={isAccepting}
                    className="p-1 rounded hover:bg-green-100 text-green-600 transition-colors"
                    title="Accept"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => rejectSuggestion({ suggestionId: s.id })}
                    disabled={isRejecting}
                    className="p-1 rounded hover:bg-red-100 text-red-500 transition-colors"
                    title="Reject"
                  >
                    <XCircle className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
            {outgoingSuggestions.map(s => (
              <div key={s.id} className="flex items-center justify-between px-3 py-2 opacity-70">
                <div className="min-w-0">
                  <p className="text-xs text-gray-600">
                    You suggested to {s.suggestion_type}{' '}
                    <span className="font-medium">{s.asset?.symbol || 'Unknown'}</span>
                  </p>
                  <p className="text-[10px] text-gray-400">
                    {s.created_at ? formatDistanceToNow(new Date(s.created_at), { addSuffix: true }) : ''}
                  </p>
                </div>
                <button
                  onClick={() => cancelSuggestion(s.id)}
                  disabled={isCanceling}
                  className="px-2 py-0.5 text-[10px] text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                >
                  Cancel
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Table (full width) */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 min-h-0">
          {!isLoading && unfilteredAssets.length === 0 ? (
            isScreen ? (
              <div className="h-full flex items-center justify-center text-sm text-gray-500 dark:text-gray-400">
                {(!screenCriteria || screenCriteria.rules.length === 0)
                  ? 'Add criteria above to start screening.'
                  : 'No assets match the current criteria.'}
              </div>
            ) : (
              <ListEmptyState canAdd={canAdd} listName={displayList.name} />
            )
          ) : (
          <ListTableView
            listId={list.id}
            assets={assets}
            isLoading={isLoading}
            permissions={permissions}
            onAssetSelect={onAssetSelect}
            listStatuses={listStatuses}
            hideListColumns={isScreen}
            storageKey={`listTableColumns_${list.id}`}
            onBulkAction={(!isScreen && (permissions.canRemoveAnyItem || permissions.canRemoveFromOwnSection)) ? handleBulkAction : undefined}
            bulkActionLabel="Remove from List"
            bulkActionIcon={<Trash2 className="h-4 w-4 mr-1" />}
            onRemoveFromList={isScreen ? undefined : handleRemoveFromList}
            canRemoveRow={(!isScreen && isCollaborative) ? canRemoveRow : undefined}
            onUpdateListNote={isScreen ? undefined : handleUpdateListNote}
            existingAssetIds={existingAssetIds}
            fillHeight
            listGroupData={isScreen ? undefined : listGroupData}
            onReorderItem={(!isScreen && permissions.canWrite) ? handleReorderItem : undefined}
            onMoveItemToGroup={isScreen ? undefined : handleMoveToGroup}
            onRenameGroup={isScreen ? undefined : handleRenameGroup}
            onDeleteGroup={isScreen ? undefined : handleDeleteGroup}
            onCreateGroup={isScreen ? undefined : createGroup}
            onCreateTradeIdea={handleCreateTradeIdea}
            kanbanBoards={isScreen ? undefined : kanbanBoards}
            activeKanbanBoardId={activeKanbanBoardId}
            onSelectKanbanBoard={setActiveKanbanBoardId}
            onCreateKanbanBoard={createKanbanBoard}
            onDeleteKanbanBoard={deleteKanbanBoard}
            onRenameKanbanBoard={renameKanbanBoard}
            kanbanBoardLanes={kanbanBoardLanes}
            kanbanBoardLaneItems={kanbanBoardLaneItems}
            onCreateKanbanLane={createKanbanLane}
            onDeleteKanbanLane={deleteKanbanLane}
            onRenameKanbanLane={renameKanbanLane}
            onAssignToKanbanLane={handleAssignToKanbanLane}
            onRemoveFromKanbanLane={handleRemoveFromKanbanLane}
          />
          )}
        </div>
      </div>

      {/* Confirmation Dialogs */}
      <ConfirmDialog
        isOpen={showRemoveConfirm.isOpen}
        onClose={() => setShowRemoveConfirm({ isOpen: false, itemId: null, assetSymbol: '' })}
        onConfirm={() => showRemoveConfirm.itemId && removeFromListMutation.mutate(showRemoveConfirm.itemId)}
        title="Remove from List"
        message={`Remove ${showRemoveConfirm.assetSymbol} from "${list.name}"?`}
        confirmText="Remove"
        cancelText="Cancel"
        variant="warning"
        isLoading={removeFromListMutation.isPending}
      />
      <ConfirmDialog
        isOpen={showBulkRemoveConfirm.isOpen}
        onClose={() => setShowBulkRemoveConfirm({ isOpen: false, itemIds: [], totalSelected: 0 })}
        onConfirm={() => bulkRemoveMutation.mutate(showBulkRemoveConfirm.itemIds)}
        title="Remove Selected Assets"
        message={
          showBulkRemoveConfirm.totalSelected > showBulkRemoveConfirm.itemIds.length
            ? `Remove ${showBulkRemoveConfirm.itemIds.length} of ${showBulkRemoveConfirm.totalSelected} selected asset${showBulkRemoveConfirm.totalSelected === 1 ? '' : 's'} from "${list.name}"? ${showBulkRemoveConfirm.totalSelected - showBulkRemoveConfirm.itemIds.length} item${showBulkRemoveConfirm.totalSelected - showBulkRemoveConfirm.itemIds.length === 1 ? '' : 's'} added by others will not be removed.`
            : `Remove ${showBulkRemoveConfirm.itemIds.length} selected asset${showBulkRemoveConfirm.itemIds.length === 1 ? '' : 's'} from "${list.name}"?`
        }
        confirmText={`Remove ${showBulkRemoveConfirm.itemIds.length} Asset${showBulkRemoveConfirm.itemIds.length === 1 ? '' : 's'}`}
        cancelText="Cancel"
        variant="warning"
        isLoading={bulkRemoveMutation.isPending}
      />

      {/* Share Dialog */}
      {showShareDialog && (
        <ShareListDialog
          list={list}
          isOpen={showShareDialog}
          onClose={() => setShowShareDialog(false)}
        />
      )}

      {/* Trade Idea Modal */}
      <AddTradeIdeaModal
        isOpen={showTradeIdeaModal}
        onClose={() => { setShowTradeIdeaModal(false); setTradeIdeaAssetId(undefined) }}
        onSuccess={() => { setShowTradeIdeaModal(false); setTradeIdeaAssetId(undefined) }}
        preselectedAssetId={tradeIdeaAssetId}
      />
    </div>
  )
}

// ── InlineAssetAdder ───────────────────────────────────────────────────

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

  const [debouncedQuery, setDebouncedQuery] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 200)
    return () => clearTimeout(timer)
  }, [searchQuery])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsExpanded(false)
        setSearchQuery('')
      }
    }
    if (isExpanded) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isExpanded])

  useEffect(() => {
    if (isExpanded && inputRef.current) inputRef.current.focus()
  }, [isExpanded])

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

  const filteredResults = useMemo(() => {
    if (!searchResults) return []
    const existingSet = new Set(existingAssetIds)
    return searchResults.filter(a => !existingSet.has(a.id))
  }, [searchResults, existingAssetIds])

  const addMutation = useMutation({
    mutationFn: async (assetId: string) => {
      const { error } = await supabase
        .from('asset_list_items')
        .insert({ list_id: listId, asset_id: assetId, added_by: user?.id })
      if (error) throw error
      return assetId
    },
    onSuccess: (assetId) => {
      queryClient.invalidateQueries({ queryKey: ['asset-list-items', listId] })
      queryClient.invalidateQueries({ queryKey: ['asset-lists'] })
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
      <Button variant="primary" size="sm" onClick={() => setIsExpanded(true)}>
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
          onClick={() => { setIsExpanded(false); setSearchQuery('') }}
          className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

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
                      justAdded ? 'bg-green-50' : 'hover:bg-gray-50'
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

export default ListTab
