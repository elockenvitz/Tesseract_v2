import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { List, TrendingUp, Plus, Search, Calendar, User, Users, Share2, Trash2, MoreVertical, Target, FileText } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'

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
  assets: {
    id: string
    symbol: string
    company_name: string
    current_price: number | null
    sector: string | null
    priority: string | null
    process_stage: string | null
  } | null
  added_by_user?: {
    email: string
    first_name?: string
    last_name?: string
  }
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
  const [showItemMenu, setShowItemMenu] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const { user } = useAuth()

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
        .order('added_at', { ascending: false })
      
      if (error) throw error
      return data as ListItem[]
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
          user:users!asset_list_collaborations_user_id_fkey(email, first_name, last_name)
        `)
        .eq('list_id', list.id)
        .order('created_at', { ascending: false })
      
      if (error) throw error
      return data || []
    }
  })

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

  const getPriorityColor = (priority: string | null) => {
    switch (priority) {
      case 'high': return 'error'
      case 'medium': return 'warning'
      case 'low': return 'success'
      case 'none': return 'default'
      default: return 'default'
    }
  }

  const getStageColor = (stage: string | null) => {
    switch (stage) {
      case 'research': return 'primary'
      case 'analysis': return 'warning'
      case 'monitoring': return 'success'
      case 'review': return 'default'
      case 'archived': return 'default'
      default: return 'default'
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

  const filteredItems = listItems?.filter(item =>
    !searchQuery ||
    item.assets?.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.assets?.company_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (item.notes && item.notes.toLowerCase().includes(searchQuery.toLowerCase()))
  ) || []

  return (
    <div className="space-y-6">
      {/* List Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start space-x-8 flex-1">
          <div>
            <div className="flex items-center space-x-3 mb-2">
              <div 
                className="w-4 h-4 rounded-full border-2 border-white shadow-sm"
                style={{ backgroundColor: list.color || '#3b82f6' }}
              />
              <h1 className="text-2xl font-bold text-gray-900">{list.name}</h1>
              {list.is_default && (
                <Star className="h-5 w-5 text-yellow-500" />
              )}
            </div>
            {list.description && (
              <p className="text-lg text-gray-600 mb-1">{list.description}</p>
            )}
          </div>
          
          <div className="text-left">
            <div className="mb-1">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Assets</p>
              <p className="text-xl font-bold text-gray-900">{listItems?.length || 0}</p>
            </div>
            {collaborators && collaborators.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Collaborators</p>
                <p className="text-sm text-gray-700">{collaborators.length}</p>
              </div>
            )}
          </div>
        </div>
        
        <div className="flex items-center space-x-3">
          {collaborators && collaborators.length > 0 && (
            <Badge variant="primary" size="sm">
              <Share2 className="h-3 w-3 mr-1" />
              Shared
            </Badge>
          )}
        </div>
      </div>

      {/* Search */}
      <Card>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search assets in this list..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        </div>
      </Card>

      {/* Assets List */}
      <Card padding="none">
        {isLoading ? (
          <div className="p-6">
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="animate-pulse">
                  <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 bg-gray-200 rounded-lg"></div>
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-gray-200 rounded w-1/4"></div>
                      <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                    </div>
                    <div className="space-y-2">
                      <div className="h-4 bg-gray-200 rounded w-16"></div>
                      <div className="h-3 bg-gray-200 rounded w-12"></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : filteredItems.length > 0 ? (
          <div className="divide-y divide-gray-200">
            {filteredItems.map((item) => (
              <div
                key={item.id}
                className="px-6 py-4 hover:bg-gray-50 transition-colors group"
              >
                <div className="flex items-center justify-between">
                  <div 
                    className="flex items-center space-x-4 flex-1 cursor-pointer"
                    onClick={() => item.assets && handleAssetClick(item.assets)}
                  >
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2 mb-1">
                        <h4 className="font-semibold text-gray-900">
                          {item.assets?.symbol || 'Unknown'}
                        </h4>
                        {item.assets?.priority && (
                          <Badge variant={getPriorityColor(item.assets.priority)} size="sm">
                            {item.assets.priority}
                          </Badge>
                        )}
                        {item.assets?.process_stage && (
                          <Badge variant={getStageColor(item.assets.process_stage)} size="sm">
                            {item.assets.process_stage}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 truncate">
                        {item.assets?.company_name || 'Unknown Company'}
                      </p>
                      {item.assets?.sector && (
                        <p className="text-xs text-gray-500">{item.assets.sector}</p>
                      )}
                      {item.notes && (
                        <p className="text-xs text-gray-600 mt-1 italic">
                          "{item.notes}"
                        </p>
                      )}
                    </div>
                    
                    <div className="text-right">
                      {item.assets?.current_price && (
                        <p className="text-lg font-semibold text-gray-900">
                          ${item.assets.current_price}
                        </p>
                      )}
                      <div className="flex items-center space-x-3 text-xs text-gray-500 mt-1">
                        <div className="flex items-center">
                          <Calendar className="h-3 w-3 mr-1" />
                          {formatDistanceToNow(new Date(item.added_at), { addSuffix: true })}
                        </div>
                        <div className="flex items-center">
                          <User className="h-3 w-3 mr-1" />
                          {item.added_by === user?.id ? 'You' : getUserDisplayName(item.added_by_user)}
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="relative ml-4">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowItemMenu(showItemMenu === item.id ? null : item.id)
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200 rounded transition-all"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                    
                    {showItemMenu === item.id && (
                      <div className="absolute right-0 top-8 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-10 min-w-[140px]">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRemoveFromList(item.id, item.assets?.symbol || 'Unknown')
                          }}
                          className="w-full px-3 py-2 text-left text-sm text-error-600 hover:bg-error-50 flex items-center"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Remove from List
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-12 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <List className="h-8 w-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {listItems?.length === 0 ? 'No assets in this list yet' : 'No assets match your search'}
            </h3>
            <p className="text-gray-500 mb-4">
              {listItems?.length === 0 
                ? 'Start adding assets to organize your investment ideas.'
                : 'Try adjusting your search criteria.'
              }
            </p>
          </div>
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
    </div>
  )
}