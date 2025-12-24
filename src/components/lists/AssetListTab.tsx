import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  List, TrendingUp, TrendingDown, Plus, Search, Calendar, User, Users, Share2, Trash2,
  MoreVertical, Target, FileText, Star, ChevronRight, CheckSquare, Square, X, Loader2,
  UserPlus, Copy, Link, Mail, Bell, Edit3
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { PriorityBadge } from '../ui/PriorityBadge'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { DensityToggle } from '../table/DensityToggle'
import { DENSITY_CONFIG } from '../../contexts/TableContext'
import { useMarketData } from '../../hooks/useMarketData'
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
  { id: 'select', label: '', visible: true, width: 32, minWidth: 32 },
  { id: 'asset', label: 'Asset', visible: true, width: 200, minWidth: 150 },
  { id: 'price', label: 'Price', visible: true, width: 100, minWidth: 80 },
  { id: 'priority', label: 'Priority', visible: true, width: 90, minWidth: 70 },
  { id: 'sector', label: 'Sector', visible: true, width: 120, minWidth: 80 },
  { id: 'notes', label: 'Notes', visible: true, width: 180, minWidth: 100 },
  { id: 'added', label: 'Added', visible: true, width: 130, minWidth: 100 }
]

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
  const [showAddAssetModal, setShowAddAssetModal] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

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

  // Filter items based on search
  const filteredItems = useMemo(() => {
    if (!listItems) return []
    if (!searchQuery) return listItems

    const query = searchQuery.toLowerCase()
    return listItems.filter(item =>
      item.assets?.symbol.toLowerCase().includes(query) ||
      item.assets?.company_name.toLowerCase().includes(query) ||
      (item.notes && item.notes.toLowerCase().includes(query)) ||
      (item.assets?.sector && item.assets.sector.toLowerCase().includes(query))
    )
  }, [listItems, searchQuery])

  // Virtual scrolling
  const rowVirtualizer = useVirtualizer({
    count: filteredItems.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: useCallback((index) => {
      const item = filteredItems[index]
      if (item && expandedRows.has(item.id)) {
        return densityRowHeight + 200
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
              {list.is_default && <Star className="h-4 w-4 text-yellow-500" />}
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

        {/* Action buttons in upper right */}
        <div className="flex items-center gap-2">
          <DensityToggle />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowShareModal(true)}
          >
            <Share2 className="h-4 w-4 mr-1.5" />
            Share
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowAddAssetModal(true)}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Add Asset
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-6 text-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-gray-500">Assets:</span>
          <span className="font-semibold text-gray-900">{listItems?.length || 0}</span>
        </div>
        {collaborators && collaborators.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-gray-500">Collaborators:</span>
            <span className="font-semibold text-gray-900">{collaborators.length}</span>
          </div>
        )}
      </div>

      {/* Search and filters bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search assets in this list..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        {filteredItems.length > 0 && (
          <button
            onClick={() => {
              setSelectionMode(!selectionMode)
              if (selectionMode) setSelectedItemIds(new Set())
            }}
            className={clsx(
              'px-3 py-2 text-sm rounded-lg border transition-colors',
              selectionMode
                ? 'bg-blue-50 border-blue-200 text-blue-700'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            )}
          >
            {selectionMode ? 'Cancel Selection' : 'Select'}
          </button>
        )}
      </div>

      {/* Bulk actions bar */}
      {selectionMode && selectedItemIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-blue-50 border border-blue-100 rounded-lg">
          <span className="text-sm font-medium text-blue-700">
            {selectedItemIds.size} selected
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                // Handle bulk remove
                selectedItemIds.forEach(id => {
                  removeFromListMutation.mutate(id)
                })
                setSelectedItemIds(new Set())
              }}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Remove
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <Card padding="none" className="overflow-hidden">
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
          <div className="overflow-x-auto">
            {/* Table Header */}
            <div
              className="flex items-center border-b border-gray-200 bg-gray-50/80 sticky top-0 z-10"
              style={{ minWidth: totalTableWidth }}
            >
              {visibleColumns.map((col) => (
                <div
                  key={col.id}
                  className={clsx(
                    'flex items-center',
                    densityConfig.padding,
                    'text-xs font-medium text-gray-500 uppercase tracking-wider'
                  )}
                  style={{ width: col.width, minWidth: col.minWidth }}
                >
                  {col.id === 'select' ? (
                    <button
                      onClick={toggleSelectAll}
                      className="p-0.5 rounded hover:bg-gray-200 transition-colors"
                    >
                      {selectedItemIds.size === filteredItems.length ? (
                        <CheckSquare className="h-4 w-4 text-blue-600" />
                      ) : (
                        <Square className="h-4 w-4 text-gray-400" />
                      )}
                    </button>
                  ) : (
                    col.label
                  )}
                </div>
              ))}
            </div>

            {/* Virtual scrolling container */}
            <div
              ref={tableContainerRef}
              className="overflow-y-auto"
              style={{ height: Math.min(filteredItems.length * densityRowHeight + 100, 600) }}
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
                    <div
                      key={item.id}
                      className={clsx(
                        'absolute top-0 left-0 w-full border-b border-gray-100 hover:bg-gray-50 transition-colors',
                        selectedItemIds.has(item.id) && 'bg-blue-50 hover:bg-blue-100'
                      )}
                      style={{
                        height: virtualRow.size,
                        transform: `translateY(${virtualRow.start}px)`
                      }}
                    >
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
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        toggleRowExpansion(item.id)
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
                                          <p className="text-sm font-semibold text-gray-900 truncate">
                                            {asset.symbol}
                                          </p>
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
                                        {changePercent !== undefined && (
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
                                      {changePercent !== undefined && (
                                        <span className={clsx(
                                          'font-medium',
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

                        {/* Row actions */}
                        <div className="flex items-center gap-1 px-2 opacity-0 hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleRemoveFromList(item.id, asset.symbol)
                            }}
                            className="p-1.5 rounded hover:bg-red-100 text-gray-400 hover:text-red-600 transition-colors"
                            title="Remove from list"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      {/* Expanded Row Content */}
                      {isExpanded && (
                        <div className="px-6 py-4 bg-gradient-to-b from-gray-50 to-white border-t border-gray-100">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">Asset Details</h4>
                              <div className="space-y-1 text-sm">
                                {asset.sector && (
                                  <div className="flex gap-2">
                                    <span className="text-gray-500">Sector:</span>
                                    <span className="text-gray-900">{asset.sector}</span>
                                  </div>
                                )}
                                {asset.process_stage && (
                                  <div className="flex gap-2">
                                    <span className="text-gray-500">Stage:</span>
                                    <span className="text-gray-900">{asset.process_stage}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                            <div>
                              <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">List Info</h4>
                              <div className="space-y-1 text-sm">
                                <div className="flex gap-2">
                                  <span className="text-gray-500">Added by:</span>
                                  <span className="text-gray-900">
                                    {item.added_by === user?.id ? 'You' : getUserDisplayName(item.added_by_user)}
                                  </span>
                                </div>
                                {item.notes && (
                                  <div className="flex gap-2">
                                    <span className="text-gray-500">Notes:</span>
                                    <span className="text-gray-900 italic">{item.notes}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="mt-4 pt-3 border-t border-gray-100 flex gap-2">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleAssetClick(asset)}
                            >
                              View Asset Details
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
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
            {listItems?.length === 0 && (
              <Button variant="primary" onClick={() => setShowAddAssetModal(true)}>
                <Plus className="h-4 w-4 mr-1.5" />
                Add Asset
              </Button>
            )}
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

      {/* Add Asset Modal */}
      {showAddAssetModal && createPortal(
        <AddAssetToListModal
          listId={list.id}
          listName={list.name}
          onClose={() => setShowAddAssetModal(false)}
        />,
        document.body
      )}

      {/* Share Modal */}
      {showShareModal && createPortal(
        <ShareListModal
          list={list}
          collaborators={collaborators || []}
          onClose={() => setShowShareModal(false)}
        />,
        document.body
      )}
    </div>
  )
}

// Add Asset to List Modal
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

export default AssetListTab
