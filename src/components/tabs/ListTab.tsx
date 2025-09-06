import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { List, TrendingUp, Plus, Search, Calendar, User, Users, Share2, Trash2, MoreVertical, Target, FileText, Filter, ChevronDown, ArrowUpDown, Grid, BarChart3, Star, GripVertical } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { Select } from '../ui/Select'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'

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
  } | null
  added_by_user?: {
    email: string
    first_name?: string
    last_name?: string
  }
}

export function ListTab({ list, onAssetSelect }: ListTabProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [stageFilter, setStageFilter] = useState('all')
  const [sectorFilter, setSectorFilter] = useState('all')
  const [sortBy, setSortBy] = useState('added_at')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [showFilters, setShowFilters] = useState(false)
  const [viewMode, setViewMode] = useState<'table' | 'grid' | 'kanban'>('table')
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
  const [draggedItem, setDraggedItem] = useState<string | null>(null)
  const [draggedOverItem, setDraggedOverItem] = useState<string | null>(null)
  const [draggedOverStage, setDraggedOverStage] = useState<string | null>(null)
  const [dragPosition, setDragPosition] = useState<'above' | 'below' | null>(null)
  const [isDragging, setIsDragging] = useState(false)
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

  // Get unique sectors for filter
  const sectors = useMemo(() => {
    if (!listItems) return []
    const uniqueSectors = [...new Set(listItems.map(item => item.assets?.sector).filter(Boolean))]
    return uniqueSectors.sort()
  }, [listItems])

  // Filter and sort items
  const filteredItems = useMemo(() => {
    if (!listItems) return []

    let filtered = listItems.filter(item => {
      if (!item.assets) return false

      // Search filter
      const matchesSearch = !searchQuery ||
        item.assets.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.assets.company_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.notes && item.notes.toLowerCase().includes(searchQuery.toLowerCase()))

      // Priority filter
      const matchesPriority = priorityFilter === 'all' || item.assets.priority === priorityFilter

      // Stage filter
      const matchesStage = stageFilter === 'all' || item.assets.process_stage === stageFilter

      // Sector filter
      const matchesSector = sectorFilter === 'all' || item.assets.sector === sectorFilter

      return matchesSearch && matchesPriority && matchesStage && matchesSector
    })

    // Sort items
    filtered.sort((a, b) => {
      let aValue, bValue

      switch (sortBy) {
        case 'symbol':
          aValue = a.assets?.symbol || ''
          bValue = b.assets?.symbol || ''
          break
        case 'company_name':
          aValue = a.assets?.company_name || ''
          bValue = b.assets?.company_name || ''
          break
        case 'current_price':
          aValue = a.assets?.current_price || 0
          bValue = b.assets?.current_price || 0
          break
        case 'priority':
          const priorityOrder = { high: 4, medium: 3, low: 2, none: 1 }
          aValue = priorityOrder[a.assets?.priority as keyof typeof priorityOrder] || 0
          bValue = priorityOrder[b.assets?.priority as keyof typeof priorityOrder] || 0
          break
        case 'process_stage':
          const stageOrder = { research: 1, analysis: 2, monitoring: 3, review: 4, archived: 5 }
          aValue = stageOrder[a.assets?.process_stage as keyof typeof stageOrder] || 0
          bValue = stageOrder[b.assets?.process_stage as keyof typeof stageOrder] || 0
          break
        case 'added_at':
        default:
          aValue = new Date(a.added_at || 0).getTime()
          bValue = new Date(b.added_at || 0).getTime()
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
  }, [listItems, searchQuery, priorityFilter, stageFilter, sectorFilter, sortBy, sortOrder])

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

  // Update asset stage mutation (for kanban view)
  const updateAssetStageMutation = useMutation({
    mutationFn: async ({ assetId, newStage }: { assetId: string; newStage: string }) => {
      const { error } = await supabase
        .from('assets')
        .update({ process_stage: newStage, updated_at: new Date().toISOString() })
        .eq('id', assetId)
      
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-list-items', list.id] })
      queryClient.invalidateQueries({ queryKey: ['assets'] })
      queryClient.invalidateQueries({ queryKey: ['all-assets'] })
    }
  })

  // Reorder list items mutation
  const reorderItemsMutation = useMutation({
    mutationFn: async ({ fromIndex, toIndex }: { fromIndex: number; toIndex: number }) => {
      // For now, we'll just update the added_at timestamp to change order
      // In a real app, you might want to add a sort_order field
      const item = filteredItems[fromIndex]
      if (!item) return
      
      const { error } = await supabase
        .from('asset_list_items')
        .update({ added_at: new Date().toISOString() })
        .eq('id', item.id)
      
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-list-items', list.id] })
    }
  })

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, itemId: string) => {
    setDraggedItem(itemId)
    setIsDragging(true)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', itemId)
    
    // Add a custom drag image for better visual feedback
    const dragElement = e.currentTarget as HTMLElement
    const rect = dragElement.getBoundingClientRect()
    
    // Create a ghost element
    const ghost = dragElement.cloneNode(true) as HTMLElement
    ghost.style.position = 'absolute'
    ghost.style.top = '-1000px'
    ghost.style.left = '-1000px'
    ghost.style.width = `${rect.width}px`
    ghost.style.opacity = '0.8'
    ghost.style.transform = 'rotate(2deg)'
    ghost.style.boxShadow = '0 10px 25px rgba(0, 0, 0, 0.2)'
    ghost.style.borderRadius = '8px'
    ghost.style.backgroundColor = 'white'
    document.body.appendChild(ghost)
    
    e.dataTransfer.setDragImage(ghost, rect.width / 2, rect.height / 2)
    
    // Clean up ghost element after drag starts
    setTimeout(() => {
      if (document.body.contains(ghost)) {
        document.body.removeChild(ghost)
      }
    }, 0)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    
    // Determine drop position based on mouse position
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    const mouseY = e.clientY
    
    setDragPosition(mouseY < midY ? 'above' : 'below')
  }

  const handleDragEnter = (e: React.DragEvent, itemId?: string, stage?: string) => {
    e.preventDefault()
    if (itemId && draggedItem && draggedItem !== itemId) {
      setDraggedOverItem(itemId)
    }
    if (stage && draggedItem) {
      setDraggedOverStage(stage)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX
    const y = e.clientY
    
    // Only clear if mouse is actually outside the element
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setDraggedOverItem(null)
      setDraggedOverStage(null)
      setDragPosition(null)
    }
  }

  const handleDrop = (e: React.DragEvent, targetItemId?: string, targetStage?: string) => {
    e.preventDefault()
    
    if (!draggedItem) return
    
    if (targetStage && viewMode === 'kanban') {
      // Handle stage change in kanban view
      const draggedItemData = filteredItems.find(item => item.id === draggedItem)
      if (draggedItemData?.assets && draggedItemData.assets.process_stage !== targetStage) {
        updateAssetStageMutation.mutate({
          assetId: draggedItemData.assets.id,
          newStage: targetStage
        })
      }
    } else if (targetItemId && targetItemId !== draggedItem) {
      // Handle reordering
      const fromIndex = filteredItems.findIndex(item => item.id === draggedItem)
      const toIndex = filteredItems.findIndex(item => item.id === targetItemId)
      
      if (fromIndex !== -1 && toIndex !== -1) {
        // Adjust target index based on drop position
        const finalToIndex = dragPosition === 'below' ? toIndex + 1 : toIndex
        reorderItemsMutation.mutate({ fromIndex, toIndex })
      }
    }
    
    setDraggedItem(null)
    setDraggedOverItem(null)
    setDraggedOverStage(null)
    setDragPosition(null)
    setIsDragging(false)
    setDraggedOverStage(null)
  }

  const handleDragEnd = () => {
    setDraggedItem(null)
    setDraggedOverItem(null)
    setDraggedOverStage(null)
    setDragPosition(null)
    setIsDragging(false)
    setDraggedOverStage(null)
  }

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

  const clearFilters = () => {
    setSearchQuery('')
    setPriorityFilter('all')
    setStageFilter('all')
    setSectorFilter('all')
    setSortBy('added_at')
    setSortOrder('desc')
  }

  const activeFiltersCount = [
    searchQuery,
    priorityFilter !== 'all' ? priorityFilter : null,
    stageFilter !== 'all' ? stageFilter : null,
    sectorFilter !== 'all' ? sectorFilter : null
  ].filter(Boolean).length

  const renderAssetCard = (item: ListItem) => (
    <div
      key={item.id}
      draggable
      onDragStart={(e) => handleDragStart(e, item.id)}
      onDragOver={handleDragOver}
      onDragEnter={(e) => handleDragEnter(e, item.id)}
      onDragLeave={handleDragLeave}
      onDrop={(e) => handleDrop(e, item.id)}
      onDragEnd={handleDragEnd}
      className={clsx(
        'transition-all duration-200',
        draggedItem === item.id && 'opacity-50 scale-95',
        draggedOverItem === item.id && 'transform scale-105'
      )}
    >
      <Card className="cursor-pointer hover:shadow-md transition-shadow group">
        <div 
          className="p-4"
          onClick={() => item.assets && handleAssetClick(item.assets)}
        >
          {/* Asset Info */}
          <div className="mb-3">
            <h4 className="font-semibold text-gray-900 text-sm mb-1">
              {item.assets?.symbol || 'Unknown'}
            </h4>
            <p className="text-xs text-gray-600 line-clamp-2 mb-1">
              {item.assets?.company_name || 'Unknown Company'}
            </p>
            {item.assets?.sector && (
              <p className="text-xs text-gray-500">{item.assets.sector}</p>
            )}
          </div>
          
          {/* Badges */}
          <div className="flex flex-wrap gap-1 mt-3">
            {item.assets?.priority && (
              <Badge variant={getPriorityColor(item.assets.priority)} size="sm">
                {item.assets.priority}
              </Badge>
            )}
          </div>
        </div>
      </Card>
    </div>
  )

  const renderTableRow = (item: ListItem) => (
    <div
      key={item.id}
      draggable
      onDragStart={(e) => handleDragStart(e, item.id)}
      onDragOver={handleDragOver}
      onDragEnter={(e) => handleDragEnter(e, item.id)}
      onDragLeave={handleDragLeave}
      onDrop={(e) => handleDrop(e, item.id)}
      onDragEnd={handleDragEnd}
      className={clsx(
        "px-6 py-4 transition-all duration-200 group relative",
        !isDragging && "hover:bg-gray-50 cursor-move",
        draggedItem === item.id && 'opacity-30 scale-95 z-10',
        draggedOverItem === item.id && dragPosition === 'above' && 'border-t-4 border-primary-500',
        draggedOverItem === item.id && dragPosition === 'below' && 'border-b-4 border-primary-500',
        draggedOverItem === item.id && 'bg-primary-25'
      )}
      style={{
        transform: draggedItem === item.id ? 'rotate(1deg)' : 'none',
        boxShadow: draggedItem === item.id ? '0 8px 25px rgba(0, 0, 0, 0.15)' : 'none'
      }}
    >
      {/* Drop indicator lines */}
      {draggedOverItem === item.id && dragPosition === 'above' && (
        <div className="absolute top-0 left-6 right-6 h-0.5 bg-primary-500 rounded-full z-20" />
      )}
      {draggedOverItem === item.id && dragPosition === 'below' && (
        <div className="absolute bottom-0 left-6 right-6 h-0.5 bg-primary-500 rounded-full z-20" />
      )}
      
      <div className="grid grid-cols-12 gap-4 items-center">
        {/* Drag Handle */}
        <div className="col-span-1">
          <div className={clsx(
            "p-2 hover:bg-gray-200 rounded-lg transition-all duration-200",
            isDragging ? "opacity-0" : "opacity-0 group-hover:opacity-100"
          )}
          disabled={isDragging}
          >
            <GripVertical className="h-4 w-4 text-gray-400 cursor-grab active:cursor-grabbing" />
          </div>
        </div>

        <div className="col-span-11">
          <div className="grid grid-cols-10 gap-4 items-center">
            {/* Asset Info with Drag Handle */}
            <div className="col-span-3">
              <div 
                className="flex items-center space-x-4 cursor-pointer"
                onClick={() => item.assets && handleAssetClick(item.assets)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-3">
                    <div className="min-w-0 flex-1">
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
                  </div>
                </div>
              </div>
            </div>

            {/* Price */}
            <div className="col-span-1">
              {item.assets?.current_price ? (
                <span className="text-sm font-semibold text-gray-900">
                  ${item.assets.current_price}
                </span>
              ) : (
                <span className="text-sm text-gray-400">—</span>
              )}
            </div>

            {/* Priority */}
            <div className="col-span-1">
              {item.assets?.priority && (
                <Badge variant={getPriorityColor(item.assets.priority)} size="sm">
                  {item.assets.priority}
                </Badge>
              )}
            </div>

            {/* Stage */}
            <div className="col-span-1">
              {item.assets?.process_stage && (
                <Badge variant={getStageColor(item.assets.process_stage)} size="sm">
                  {item.assets.process_stage}
                </Badge>
              )}
            </div>

            {/* Added Date */}
            <div className="col-span-2">
              <div className="flex items-center text-sm text-gray-500">
                <Calendar className="h-3 w-3 mr-1" />
                {formatDistanceToNow(new Date(item.added_at), { addSuffix: true })}
              </div>
            </div>

            {/* Actions */}
            <div className="col-span-2">
              <div className="relative">
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
                  <div className="absolute right-0 top-10 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50 min-w-[160px]">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRemoveFromList(item.id, item.assets?.symbol || 'Unknown')
                      }}
                      className="w-full px-3 py-2 text-left text-sm text-error-600 hover:bg-error-50 flex items-center transition-colors"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Remove from List
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  const renderKanbanColumn = (stage: string, items: ListItem[]) => (
    <div 
      key={stage} 
      className="flex-1 min-w-[300px]"
      onDragOver={handleDragOver}
      onDragEnter={(e) => handleDragEnter(e, undefined, stage)}
      onDragLeave={handleDragLeave}
      onDrop={(e) => handleDrop(e, undefined, stage)}
    >
      <div className={clsx(
        "bg-gray-50 rounded-lg p-4 min-h-[200px] transition-colors",
        draggedOverStage === stage && 'bg-primary-50 border-2 border-primary-300 border-dashed'
      )}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900 capitalize">{stage}</h3>
          <Badge variant={getStageColor(stage)} size="sm">
            {items.length}
          </Badge>
        </div>
        <div className="space-y-3">
          {items.map(item => renderAssetCard(item))}
        </div>
      </div>
    </div>
  )

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

      {/* Search and Filters */}
      <Card>
        <div className="space-y-4">
          {/* Search Bar and Controls - Same Line */}
          <div className="flex items-center space-x-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search assets in this list..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            
            {/* Filter Toggle */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center space-x-2 text-sm text-gray-600 hover:text-gray-900 transition-colors whitespace-nowrap"
            >
              <Filter className="h-4 w-4" />
              <span>Filters</span>
              {activeFiltersCount > 0 && (
                <Badge variant="primary" size="sm">
                  {activeFiltersCount}
                </Badge>
              )}
              <ChevronDown className={clsx(
                "h-4 w-4 transition-transform duration-200",
                showFilters && 'rotate-180'
              )} />
            </button>
            
            {/* View Mode Toggle */}
            <div className="flex items-center space-x-2">
              <span className="text-sm text-gray-600">View:</span>
              <div className="flex space-x-1 bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setViewMode('table')}
                  className={clsx(
                    'px-2 py-1 text-xs font-medium rounded transition-colors',
                    viewMode === 'table' 
                      ? 'bg-white text-gray-900 shadow-sm' 
                      : 'text-gray-600 hover:text-gray-900'
                  )}
                >
                  Table
                </button>
                <button
                  onClick={() => setViewMode('grid')}
                  className={clsx(
                    'px-2 py-1 text-xs font-medium rounded transition-colors',
                    viewMode === 'grid' 
                      ? 'bg-white text-gray-900 shadow-sm' 
                      : 'text-gray-600 hover:text-gray-900'
                  )}
                >
                  <Grid className="h-3 w-3 mr-1" />
                  Grid
                </button>
                <button
                  onClick={() => setViewMode('kanban')}
                  className={clsx(
                    'px-2 py-1 text-xs font-medium rounded transition-colors',
                    viewMode === 'kanban' 
                      ? 'bg-white text-gray-900 shadow-sm' 
                      : 'text-gray-600 hover:text-gray-900'
                  )}
                >
                  <BarChart3 className="h-3 w-3 mr-1" />
                  Kanban
                </button>
              </div>
            </div>
            
            {activeFiltersCount > 0 && (
              <button
                onClick={clearFilters}
                className="text-sm text-primary-600 hover:text-primary-700 transition-colors whitespace-nowrap"
              >
                Clear all filters
              </button>
            )}
          </div>

          {/* Filter Controls */}
          {showFilters && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-4 border-t border-gray-200">
              <Select
                label="Priority"
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                options={[
                  { value: 'all', label: 'All Priorities' },
                  { value: 'none', label: 'No Priority Set' },
                  { value: 'high', label: 'High Priority' },
                  { value: 'medium', label: 'Medium Priority' },
                  { value: 'low', label: 'Low Priority' }
                ]}
              />

              <Select
                label="Stage"
                value={stageFilter}
                onChange={(e) => setStageFilter(e.target.value)}
                options={[
                  { value: 'all', label: 'All Stages' },
                  { value: 'research', label: 'Research' },
                  { value: 'analysis', label: 'Analysis' },
                  { value: 'monitoring', label: 'Monitoring' },
                  { value: 'review', label: 'Review' },
                  { value: 'archived', label: 'Archived' }
                ]}
              />

              <Select
                label="Sector"
                value={sectorFilter}
                onChange={(e) => setSectorFilter(e.target.value)}
                options={[
                  { value: 'all', label: 'All Sectors' },
                  ...sectors.map(sector => ({ value: sector, label: sector }))
                ]}
              />

              <Select
                label="Sort by"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                options={[
                  { value: 'added_at', label: 'Date Added' },
                  { value: 'symbol', label: 'Symbol' },
                  { value: 'company_name', label: 'Company Name' },
                  { value: 'current_price', label: 'Price' },
                  { value: 'priority', label: 'Priority' },
                  { value: 'process_stage', label: 'Stage' }
                ]}
              />
            </div>
          )}
        </div>
      </Card>

      {/* Main Content - Render based on view mode */}
      {isLoading ? (
        <Card>
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
        </Card>
      ) : filteredItems.length > 0 ? (
        <>
          {viewMode === 'table' && (
            <Card padding="none">
              <div className="divide-y divide-gray-200">
                {/* Table Header */}
                <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
                  <div className="grid grid-cols-12 gap-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <div className="col-span-1 flex items-center justify-center">
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity mr-2">
                      </div>
                    </div>
                    <div className="col-span-11">
                      <div className="grid grid-cols-10 gap-4">
                        <div className="col-span-3">
                          <button
                            onClick={() => handleSort('symbol')}
                            className="flex items-center space-x-1 hover:text-gray-700 transition-colors"
                          >
                            <span>Asset</span>
                            <ArrowUpDown className="h-3 w-3" />
                          </button>
                        </div>
                        <div className="col-span-1">
                          <button
                            onClick={() => handleSort('current_price')}
                            className="flex items-center space-x-1 hover:text-gray-700 transition-colors"
                          >
                            <span>Price</span>
                            <ArrowUpDown className="h-3 w-3" />
                          </button>
                        </div>
                        <div className="col-span-1">
                          <button
                            onClick={() => handleSort('priority')}
                            className="flex items-center space-x-1 hover:text-gray-700 transition-colors"
                          >
                            <span>Priority</span>
                            <ArrowUpDown className="h-3 w-3" />
                          </button>
                        </div>
                        <div className="col-span-1">
                          <button
                            onClick={() => handleSort('process_stage')}
                            className="flex items-center space-x-1 hover:text-gray-700 transition-colors"
                          >
                            <span>Stage</span>
                            <ArrowUpDown className="h-3 w-3" />
                          </button>
                        </div>
                        <div className="col-span-2">
                          <button
                            onClick={() => handleSort('added_at')}
                            className="flex items-center space-x-1 hover:text-gray-700 transition-colors"
                          >
                            <span>Added</span>
                            <ArrowUpDown className="h-3 w-3" />
                          </button>
                        </div>
                        <div className="col-span-2">
                          <span>Remove</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Table Body */}
                <div className="divide-y divide-gray-200">
                  {filteredItems.map(item => renderTableRow(item))}
                </div>
              </div>
            </Card>
          )}

          {viewMode === 'grid' && (
            <div 
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              {filteredItems.map(item => renderAssetCard(item))}
            </div>
          )}

          {viewMode === 'kanban' && (
            <div className="flex space-x-6 overflow-x-auto pb-4 min-h-[400px]">
              {['research', 'analysis', 'monitoring', 'review', 'archived'].map(stage => {
                const stageItems = filteredItems.filter(item => item.assets?.process_stage === stage)
                return renderKanbanColumn(stage, stageItems)
              })}
            </div>
          )}
        </>
      ) : (
        <Card>
          <div className="text-center py-12">
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
        </Card>
      )}

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