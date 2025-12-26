/**
 * ListTab - Display assets in a specific list
 *
 * Uses the same AssetTableView component as AssetsListPage for consistency.
 * Adds list-specific header (name, description, share, add asset) above the table.
 */

import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Star, Share2, Plus, X, Search, Loader2, Trash2 } from 'lucide-react'
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
}

export function ListTab({ list, onAssetSelect }: ListTabProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // State
  const [showShareDialog, setShowShareDialog] = useState(false)
  const [showAddAssetDialog, setShowAddAssetDialog] = useState(false)
  const [showRemoveConfirm, setShowRemoveConfirm] = useState<{
    isOpen: boolean
    itemId: string | null
    assetSymbol: string
  }>({ isOpen: false, itemId: null, assetSymbol: '' })
  const [showBulkRemoveConfirm, setShowBulkRemoveConfirm] = useState<{
    isOpen: boolean
    assetIds: string[]
  }>({ isOpen: false, assetIds: [] })

  // Fetch list items with asset details
  const { data: listItems = [], isLoading } = useQuery({
    queryKey: ['asset-list-items', list.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_list_items')
        .select(`
          *,
          assets(*)
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

  // Extract assets from list items
  const assets = useMemo(() => {
    return listItems
      .filter(item => item.assets)
      .map(item => ({
        ...item.assets!,
        _listItemId: item.id, // Store list item ID for removal
        _addedAt: item.added_at,
        _listNotes: item.notes
      }))
  }, [listItems])

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

  // Empty state for list
  const emptyState = (
    <div className="p-12 text-center">
      <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <Search className="h-8 w-8 text-gray-400" />
      </div>
      <h3 className="text-lg font-medium text-gray-900 mb-2">No assets in this list</h3>
      <p className="text-gray-500 mb-4">Add assets to start tracking them.</p>
      <Button variant="primary" onClick={() => setShowAddAssetDialog(true)}>
        <Plus className="h-4 w-4 mr-1.5" />
        Add Asset
      </Button>
    </div>
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
              {collaborators && collaborators.length > 0 && (
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
          <Button variant="primary" size="sm" onClick={() => setShowAddAssetDialog(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Add Asset
          </Button>
        </div>
      </div>

      {/* Asset Table View - matches AssetsListPage exactly */}
      <AssetTableView
        assets={assets}
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

      {/* Add Asset Dialog */}
      {showAddAssetDialog && createPortal(
        <AddAssetDialog
          listId={list.id}
          listName={list.name}
          onClose={() => setShowAddAssetDialog(false)}
        />,
        document.body
      )}
    </div>
  )
}

// Add Asset Dialog Component
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
