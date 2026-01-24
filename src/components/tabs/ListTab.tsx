/**
 * ListTab - Display assets in a specific list
 *
 * Uses the same AssetTableView component as AssetsListPage for consistency.
 * Adds list-specific header (name, description, share, add asset) above the table.
 */

import React, { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Star, Share2, Plus, X, Search, Loader2, Trash2, Check, Users, ChevronDown, ChevronRight, LayoutGrid, List, Layers, User } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { ShareListDialog } from '../lists/ShareListDialog'
import { AssetTableView } from '../table/AssetTableView'
import { clsx } from 'clsx'
import { createPortal } from 'react-dom'

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
}

type CollaborativeViewMode = 'all' | 'grouped' | 'expanded' | 'tabs'

export function ListTab({ list, onAssetSelect }: ListTabProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // State
  const [showShareDialog, setShowShareDialog] = useState(false)
  const [showRemoveConfirm, setShowRemoveConfirm] = useState<{
    isOpen: boolean
    itemId: string | null
    assetSymbol: string
  }>({ isOpen: false, itemId: null, assetSymbol: '' })
  const [showBulkRemoveConfirm, setShowBulkRemoveConfirm] = useState<{
    isOpen: boolean
    assetIds: string[]
  }>({ isOpen: false, assetIds: [] })

  // Collaborative list view state
  const [viewMode, setViewMode] = useState<CollaborativeViewMode>('all')
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState<string>('all')

  // Check if this is a collaborative list
  const isCollaborative = list.list_type === 'collaborative'

  // Fetch list items with asset details and added_by user info
  const { data: listItems = [], isLoading } = useQuery({
    queryKey: ['asset-list-items', list.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_list_items')
        .select(`
          *,
          assets(*),
          added_by_user:users!asset_list_items_added_by_fkey(id, email, first_name, last_name)
        `)
        .eq('list_id', list.id)
        .order('added_at', { ascending: false })

      if (error) throw error
      return data as ListItem[]
    }
  })

  // Fetch collaborators
  const { data: collaborators } = useQuery({
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

  // Fetch favorite status
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

  // Extract assets from list items with added_by info
  const assets = useMemo(() => {
    return listItems
      .filter(item => item.assets)
      .map(item => ({
        ...item.assets!,
        _listItemId: item.id,
        _addedAt: item.added_at,
        _addedBy: item.added_by,
        _addedByUser: item.added_by_user,
        _listNotes: item.notes
      }))
  }, [listItems])

  // Get display name for a user
  const getUserDisplayName = (userInfo: { email: string; first_name?: string; last_name?: string } | null | undefined, userId?: string | null) => {
    if (!userInfo) return userId === user?.id ? 'You' : 'Unknown'
    if (userInfo.first_name && userInfo.last_name) {
      return userId === user?.id ? 'You' : `${userInfo.first_name} ${userInfo.last_name}`
    }
    return userId === user?.id ? 'You' : userInfo.email?.split('@')[0] || 'Unknown'
  }

  // Group assets by user for collaborative lists
  const assetsByUser = useMemo(() => {
    if (!isCollaborative) return null

    const groups: Record<string, { user: any; userId: string; assets: any[] }> = {}

    // Always put current user first
    if (user?.id) {
      groups[user.id] = {
        user: { id: user.id, email: user.email, first_name: user.user_metadata?.first_name, last_name: user.user_metadata?.last_name },
        userId: user.id,
        assets: []
      }
    }

    assets.forEach(asset => {
      const userId = asset._addedBy || 'unknown'
      if (!groups[userId]) {
        groups[userId] = {
          user: asset._addedByUser,
          userId,
          assets: []
        }
      }
      groups[userId].assets.push(asset)
    })

    // Convert to array and sort (current user first, then alphabetically)
    return Object.values(groups)
      .filter(g => g.assets.length > 0 || g.userId === user?.id)
      .sort((a, b) => {
        if (a.userId === user?.id) return -1
        if (b.userId === user?.id) return 1
        const nameA = getUserDisplayName(a.user, a.userId)
        const nameB = getUserDisplayName(b.user, b.userId)
        return nameA.localeCompare(nameB)
      })
  }, [assets, isCollaborative, user?.id])

  // Get all unique users for tabs view
  const uniqueUsers = useMemo(() => {
    if (!assetsByUser) return []
    return assetsByUser.map(g => ({
      id: g.userId,
      name: getUserDisplayName(g.user, g.userId),
      count: g.assets.length
    }))
  }, [assetsByUser])

  // Filter assets for tabs view
  const filteredAssetsForTab = useMemo(() => {
    if (activeTab === 'all' || !isCollaborative) return assets
    return assets.filter(a => a._addedBy === activeTab)
  }, [assets, activeTab, isCollaborative])

  // Toggle section collapse
  const toggleSection = (userId: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev)
      if (next.has(userId)) {
        next.delete(userId)
      } else {
        next.add(userId)
      }
      return next
    })
  }

  // Create a map of asset ID to list item ID for removal
  const assetToListItemMap = useMemo(() => {
    const map = new Map<string, string>()
    listItems.forEach(item => {
      if (item.assets) {
        map.set(item.assets.id, item.id)
      }
    })
    return map
  }, [listItems])

  // Mutations
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

  // Bulk remove mutation
  const bulkRemoveMutation = useMutation({
    mutationFn: async (assetIds: string[]) => {
      // Get list item IDs for the selected assets
      const listItemIds = assetIds.map(assetId => assetToListItemMap.get(assetId)).filter(Boolean) as string[]
      if (listItemIds.length === 0) throw new Error('No items to remove')

      const { error } = await supabase
        .from('asset_list_items')
        .delete()
        .in('id', listItemIds)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-list-items', list.id] })
      queryClient.invalidateQueries({ queryKey: ['asset-lists'] })
      setShowBulkRemoveConfirm({ isOpen: false, assetIds: [] })
    }
  })

  // Handle bulk action from AssetTableView
  const handleBulkAction = (assetIds: string[]) => {
    setShowBulkRemoveConfirm({ isOpen: true, assetIds })
  }

  // Render remove button for each row
  const renderRowActions = (asset: any) => {
    const listItemId = assetToListItemMap.get(asset.id)
    if (!listItemId) return null

    return (
      <button
        onClick={(e) => {
          e.stopPropagation()
          setShowRemoveConfirm({ isOpen: true, itemId: listItemId, assetSymbol: asset.symbol })
        }}
        className="p-1.5 rounded hover:bg-red-100 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all"
        title="Remove from list"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    )
  }

  // Get existing asset IDs for filtering
  const existingAssetIds = useMemo(() =>
    listItems.map(item => item.asset_id),
    [listItems]
  )

  // Empty state for list
  const emptyState = (
    <div className="p-12 text-center">
      <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <Search className="h-8 w-8 text-gray-400" />
      </div>
      <h3 className="text-lg font-medium text-gray-900 mb-2">No assets in this list</h3>
      <p className="text-gray-500 mb-4">Add assets to start tracking them.</p>
      <InlineAssetAdder listId={list.id} existingAssetIds={[]} />
    </div>
  )

  // View mode button component
  const ViewModeButton = ({ mode, icon: Icon, label }: { mode: CollaborativeViewMode; icon: any; label: string }) => (
    <button
      onClick={() => setViewMode(mode)}
      className={clsx(
        'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors',
        viewMode === mode
          ? 'bg-blue-100 text-blue-700'
          : 'text-gray-600 hover:bg-gray-100'
      )}
      title={label}
    >
      <Icon className="h-4 w-4" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  )

  return (
    <div className="space-y-4">
      {/* List Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div
            className="w-4 h-4 rounded-full border-2 border-white shadow-sm flex-shrink-0"
            style={{ backgroundColor: list.color || '#3b82f6' }}
          />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-gray-900">{list.name}</h1>
              <button
                onClick={() => toggleFavoriteMutation.mutate()}
                className="transition-colors"
                title={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
              >
                <Star className={clsx(
                  'h-5 w-5 transition-colors',
                  isFavorited ? 'text-yellow-500 fill-yellow-500' : 'text-gray-400 hover:text-yellow-500'
                )} />
              </button>
              {isCollaborative && (
                <Badge variant="primary" size="sm">
                  <Users className="h-3 w-3 mr-1" />
                  Collaborative
                </Badge>
              )}
              {!isCollaborative && collaborators && collaborators.length > 0 && (
                <Badge variant="secondary" size="sm">
                  <Share2 className="h-3 w-3 mr-1" />
                  Shared
                </Badge>
              )}
            </div>
            {list.description && (
              <p className="text-sm text-gray-500 mt-0.5">{list.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {list.created_by === user?.id && (
            <Button variant="secondary" size="sm" onClick={() => setShowShareDialog(true)}>
              <Share2 className="h-4 w-4 mr-1.5" />
              Share{collaborators && collaborators.length > 0 && ` (${collaborators.length})`}
            </Button>
          )}
          <InlineAssetAdder listId={list.id} existingAssetIds={existingAssetIds} />
        </div>
      </div>

      {/* View Mode Toggle for Collaborative Lists */}
      {isCollaborative && assets.length > 0 && (
        <div className="flex items-center gap-2 p-1 bg-gray-100 rounded-lg w-fit">
          <ViewModeButton mode="all" icon={List} label="All" />
          <ViewModeButton mode="tabs" icon={User} label="By User" />
          <ViewModeButton mode="grouped" icon={Layers} label="Grouped" />
          <ViewModeButton mode="expanded" icon={LayoutGrid} label="Expanded" />
        </div>
      )}

      {/* Tabs View - User Pills */}
      {isCollaborative && viewMode === 'tabs' && uniqueUsers.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setActiveTab('all')}
            className={clsx(
              'px-3 py-1.5 text-sm font-medium rounded-full transition-colors',
              activeTab === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            )}
          >
            All ({assets.length})
          </button>
          {uniqueUsers.map(u => (
            <button
              key={u.id}
              onClick={() => setActiveTab(u.id)}
              className={clsx(
                'px-3 py-1.5 text-sm font-medium rounded-full transition-colors',
                activeTab === u.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              )}
            >
              {u.name} ({u.count})
            </button>
          ))}
        </div>
      )}

      {/* Standard View / Tabs View Content */}
      {(!isCollaborative || viewMode === 'all' || viewMode === 'tabs') && (
        <AssetTableView
          assets={viewMode === 'tabs' ? filteredAssetsForTab : assets}
          isLoading={isLoading}
          onAssetSelect={onAssetSelect}
          renderRowActions={renderRowActions}
          emptyState={emptyState}
          storageKey={`listTableColumns_${list.id}`}
          extraColumns={[
            { id: 'actions', label: '', visible: true, width: 50, minWidth: 50, sortable: false, pinned: false }
          ]}
          onBulkAction={handleBulkAction}
          bulkActionLabel="Remove from List"
          bulkActionIcon={<Trash2 className="h-4 w-4 mr-1" />}
        />
      )}

      {/* Grouped View (Collapsible Sections) */}
      {isCollaborative && viewMode === 'grouped' && assetsByUser && (
        <div className="space-y-4">
          {assetsByUser.map(group => (
            <div key={group.userId} className="border border-gray-200 rounded-lg overflow-hidden">
              <button
                onClick={() => toggleSection(group.userId)}
                className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {collapsedSections.has(group.userId) ? (
                    <ChevronRight className="h-5 w-5 text-gray-400" />
                  ) : (
                    <ChevronDown className="h-5 w-5 text-gray-400" />
                  )}
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                    <span className="text-white text-sm font-medium">
                      {getUserDisplayName(group.user, group.userId).charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <span className="font-medium text-gray-900">
                    {getUserDisplayName(group.user, group.userId)}
                  </span>
                  <Badge variant="secondary" size="sm">{group.assets.length}</Badge>
                </div>
              </button>
              {!collapsedSections.has(group.userId) && (
                <AssetTableView
                  assets={group.assets}
                  isLoading={false}
                  onAssetSelect={onAssetSelect}
                  renderRowActions={renderRowActions}
                  storageKey={`listTableColumns_${list.id}`}
                  extraColumns={[
                    { id: 'actions', label: '', visible: true, width: 50, minWidth: 50, sortable: false, pinned: false }
                  ]}
                  onBulkAction={handleBulkAction}
                  bulkActionLabel="Remove from List"
                  bulkActionIcon={<Trash2 className="h-4 w-4 mr-1" />}
                  hideToolbar
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Expanded View (Always Open Sections) */}
      {isCollaborative && viewMode === 'expanded' && assetsByUser && (
        <div className="space-y-6">
          {assetsByUser.map(group => (
            <div key={group.userId}>
              <div className="flex items-center gap-3 mb-3 pb-2 border-b border-gray-200">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                  <span className="text-white text-sm font-medium">
                    {getUserDisplayName(group.user, group.userId).charAt(0).toUpperCase()}
                  </span>
                </div>
                <span className="font-semibold text-gray-900">
                  {getUserDisplayName(group.user, group.userId)}
                </span>
                <Badge variant="secondary" size="sm">{group.assets.length} assets</Badge>
              </div>
              <AssetTableView
                assets={group.assets}
                isLoading={false}
                onAssetSelect={onAssetSelect}
                renderRowActions={renderRowActions}
                storageKey={`listTableColumns_${list.id}`}
                extraColumns={[
                  { id: 'actions', label: '', visible: true, width: 50, minWidth: 50, sortable: false, pinned: false }
                ]}
                onBulkAction={handleBulkAction}
                bulkActionLabel="Remove from List"
                bulkActionIcon={<Trash2 className="h-4 w-4 mr-1" />}
                hideToolbar
              />
            </div>
          ))}
        </div>
      )}

      {/* Remove Confirmation (single) */}
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

      {/* Bulk Remove Confirmation */}
      <ConfirmDialog
        isOpen={showBulkRemoveConfirm.isOpen}
        onClose={() => setShowBulkRemoveConfirm({ isOpen: false, assetIds: [] })}
        onConfirm={() => bulkRemoveMutation.mutate(showBulkRemoveConfirm.assetIds)}
        title="Remove Selected Assets"
        message={`Remove ${showBulkRemoveConfirm.assetIds.length} selected asset${showBulkRemoveConfirm.assetIds.length === 1 ? '' : 's'} from "${list.name}"?`}
        confirmText={`Remove ${showBulkRemoveConfirm.assetIds.length} Asset${showBulkRemoveConfirm.assetIds.length === 1 ? '' : 's'}`}
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

// Add Asset Dialog Component (legacy - kept for reference)
function AddAssetDialog({ listId, listName, onClose }: { listId: string; listName: string; onClose: () => void }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const queryClient = useQueryClient()
  const { user } = useAuth()

  const { data: searchResults = [], isLoading } = useQuery({
    queryKey: ['asset-search-for-list', searchQuery, listId],
    queryFn: async () => {
      if (!searchQuery.trim()) return []
      const { data: existingItems } = await supabase.from('asset_list_items').select('asset_id').eq('list_id', listId)
      const existingIds = existingItems?.map(i => i.asset_id) || []

      const { data, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name, sector')
        .or(`symbol.ilike.%${searchQuery}%,company_name.ilike.%${searchQuery}%`)
        .limit(10)

      if (error) throw error
      return (data || []).filter(a => !existingIds.includes(a.id))
    },
    enabled: searchQuery.length >= 2
  })

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!selectedAssetId) throw new Error('No asset selected')
      const { error } = await supabase.from('asset_list_items').insert({
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
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Search Asset</label>
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

          {searchQuery.length >= 2 && (
            <div className="border border-gray-200 rounded-lg max-h-48 overflow-y-auto">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                </div>
              ) : searchResults.length > 0 ? (
                <div className="divide-y divide-gray-100">
                  {searchResults.map((asset) => (
                    <button
                      key={asset.id}
                      onClick={() => setSelectedAssetId(asset.id)}
                      className={clsx('w-full px-4 py-2 text-left hover:bg-gray-50', selectedAssetId === asset.id && 'bg-blue-50')}
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

          {selectedAssetId && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Notes (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add a note..."
                rows={2}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none"
              />
            </div>
          )}
        </div>

        <div className="px-5 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => addMutation.mutate()} disabled={!selectedAssetId || addMutation.isPending}>
            {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="h-4 w-4 mr-1" />Add</>}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default ListTab
