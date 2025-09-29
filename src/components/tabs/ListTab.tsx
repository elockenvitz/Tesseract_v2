import React, { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { List, TrendingUp, Plus, Search, Calendar, User, Users, Share2, Trash2, MoreVertical, Target, FileText, Filter, ChevronDown, ArrowUpDown, Grid, BarChart3, Star, GripVertical, ArrowUpRight, ArrowDownRight, AlertTriangle, Zap, CheckCircle, Settings, Eye, EyeOff, Edit3, X, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { financialDataService } from '../../lib/financial-data/browser-client'
import { useAuth } from '../../hooks/useAuth'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { PriorityBadge } from '../ui/PriorityBadge'
import { Select } from '../ui/Select'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { ShareListDialog } from '../lists/ShareListDialog'
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
  list_category?: string | null
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

// Stage configurations matching SmartStageManager
const STAGE_CONFIGS = [
  {
    id: 'outdated',
    label: 'Outdated',
    color: 'bg-gray-600',
    textColor: 'text-gray-600',
    icon: AlertTriangle,
    description: 'Requires data refresh'
  },
  {
    id: 'prioritized',
    label: 'Prioritize',
    color: 'bg-orange-600',
    textColor: 'text-orange-600',
    icon: Zap,
    description: 'Active focus required'
  },
  {
    id: 'in_progress',
    label: 'Research',
    color: 'bg-blue-500',
    textColor: 'text-blue-500',
    icon: TrendingUp,
    description: 'Deep analysis underway'
  },
  {
    id: 'recommend',
    label: 'Recommend',
    color: 'bg-yellow-500',
    textColor: 'text-yellow-500',
    icon: Target,
    description: 'Preparing recommendation'
  },
  {
    id: 'review',
    label: 'Review',
    color: 'bg-green-400',
    textColor: 'text-green-400',
    icon: CheckCircle,
    description: 'Committee review'
  },
  {
    id: 'action',
    label: 'Action',
    color: 'bg-green-700',
    textColor: 'text-green-700',
    icon: Zap,
    description: 'Execution phase'
  },
  {
    id: 'monitor',
    label: 'Monitor',
    color: 'bg-teal-500',
    textColor: 'text-teal-500',
    icon: TrendingUp,
    description: 'Ongoing tracking'
  }
]

export function ListTab({ list, onAssetSelect }: ListTabProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('all')
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
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [contextMenuItem, setContextMenuItem] = useState<string | null>(null)
  const [columnContextMenu, setColumnContextMenu] = useState<{ position: { x: number; y: number }; columnId: string } | null>(null)
  const [draggedItem, setDraggedItem] = useState<string | null>(null)
  const [draggedOverItem, setDraggedOverItem] = useState<string | null>(null)
  const [draggedOverStage, setDraggedOverStage] = useState<string | null>(null)
  const [dragPosition, setDragPosition] = useState<'above' | 'below' | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [showShareDialog, setShowShareDialog] = useState(false)
  const [showAddAssetDialog, setShowAddAssetDialog] = useState(false)
  const [assetSearchQuery, setAssetSearchQuery] = useState('')
  const [selectedAssets, setSelectedAssets] = useState<string[]>([])
  const [showColumnSettings, setShowColumnSettings] = useState(false)
  // Symbol column is fixed, dynamic columns start after it
  const [dynamicColumns, setDynamicColumns] = useState([
    { id: 'company_name', field: 'assets.company_name', label: 'Company', width: 200, type: 'text' },
    { id: 'price', field: 'assets.current_price', label: 'Price', width: 120, type: 'currency' },
    { id: 'priority', field: 'assets.priority', label: 'Priority', width: 120, type: 'priority' },
    { id: 'sector', field: 'assets.sector', label: 'Sector', width: 150, type: 'text' },
  ])

  // Fixed symbol column
  const symbolColumn = { id: 'symbol', field: 'assets.symbol', label: 'Symbol', width: 140, type: 'text' }
  const [resizingColumn, setResizingColumn] = useState<string | null>(null)
  const [editingHeader, setEditingHeader] = useState<string | null>(null)
  const [headerInputValue, setHeaderInputValue] = useState('')
  const [fieldSearchResults, setFieldSearchResults] = useState<typeof availableFields>([])
  const [showFieldDropdown, setShowFieldDropdown] = useState(false)
  const [showCategorySettings, setShowCategorySettings] = useState(false)
  const [customCategories, setCustomCategories] = useState([
    { id: 'watching', label: 'Watching', color: 'bg-blue-500', icon: Eye },
    { id: 'researching', label: 'Researching', color: 'bg-yellow-500', icon: Search },
    { id: 'ready', label: 'Ready to Buy', color: 'bg-green-500', icon: CheckCircle },
    { id: 'holding', label: 'Holding', color: 'bg-purple-500', icon: Star }
  ])
  const [newCategoryLabel, setNewCategoryLabel] = useState('')
  const [editingCategory, setEditingCategory] = useState<string | null>(null)
  const [editingLabel, setEditingLabel] = useState('')

  // Available fields for dynamic columns
  const availableFields = [
    { id: 'assets.symbol', label: 'Symbol', type: 'text' },
    { id: 'assets.company_name', label: 'Company Name', type: 'text' },
    { id: 'assets.current_price', label: 'Current Price', type: 'currency' },
    { id: 'assets.priority', label: 'Priority', type: 'priority' },
    { id: 'assets.sector', label: 'Sector', type: 'text' },
    { id: 'assets.process_stage', label: 'Process Stage', type: 'stage' },
    { id: 'notes', label: 'Notes', type: 'text' },
    { id: 'added_at', label: 'Date Added', type: 'date' },
    { id: 'added_by_user.email', label: 'Added By Email', type: 'text' },
    { id: 'added_by_user.first_name', label: 'Added By First Name', type: 'text' },
    { id: 'added_by_user.last_name', label: 'Added By Last Name', type: 'text' },
  ]

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

  // Fetch active workflows for assets in the list
  const { data: activeWorkflows } = useQuery({
    queryKey: ['list-active-workflows', listItems?.map(item => item.assets?.id).filter(Boolean)],
    queryFn: async () => {
      if (!listItems || listItems.length === 0) return {}

      const assetIds = listItems
        .map(item => item.assets?.id)
        .filter(Boolean) as string[]

      if (assetIds.length === 0) return {}

      const { data, error } = await supabase
        .from('asset_workflow_progress')
        .select(`
          asset_id,
          stage,
          status,
          updated_at,
          workflows (
            id,
            name,
            color
          )
        `)
        .in('asset_id', assetIds)
        .eq('status', 'active')
        .order('updated_at', { ascending: false })

      if (error) {
        console.error('Failed to fetch active workflows:', error)
        return {}
      }

      // Group workflows by asset_id
      const workflowsByAsset: Record<string, any[]> = {}
      data?.forEach(item => {
        if (!workflowsByAsset[item.asset_id]) {
          workflowsByAsset[item.asset_id] = []
        }
        workflowsByAsset[item.asset_id].push(item)
      })

      return workflowsByAsset
    },
    staleTime: 30000,
    refetchOnWindowFocus: false
  })

  // Fetch financial data for all assets in the list
  const { data: financialData, isLoading: financialDataLoading } = useQuery({
    queryKey: ['list-financial-data', listItems?.map(item => item.assets?.symbol).filter(Boolean)],
    queryFn: async () => {
      if (!listItems || listItems.length === 0) return {}

      const quotes: Record<string, any> = {}
      const symbols = listItems
        .map(item => item.assets?.symbol)
        .filter(Boolean) as string[]

      // Fetch quotes for all assets in parallel
      const fetchPromises = symbols.map(async (symbol) => {
        try {
          console.log(`ListTab: Fetching quote for ${symbol}`)
          const quote = await financialDataService.getQuote(symbol)
          if (quote) {
            console.log(`ListTab: Got quote for ${symbol}: $${quote.price}`)
            return { symbol, quote }
          }
          return null
        } catch (error) {
          console.warn(`ListTab: Failed to fetch quote for ${symbol}:`, error)
          return null
        }
      })

      const results = await Promise.all(fetchPromises)

      // Build the quotes object
      results.forEach(result => {
        if (result && result.quote) {
          quotes[result.symbol] = result.quote
        }
      })

      return quotes
    },
    enabled: !!listItems && listItems.length > 0,
    staleTime: 15000, // Cache for 15 seconds
    refetchInterval: 30000, // Refetch every 30 seconds
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

  // Fetch all assets for adding to list
  const { data: allAssets, isLoading: allAssetsLoading } = useQuery({
    queryKey: ['all-assets-for-adding'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name, sector')
        .order('symbol', { ascending: true })

      if (error) throw error
      return data || []
    },
    enabled: showAddAssetDialog // Only fetch when dialog is open
  })

  // Check if list is favorited by current user
  const { data: isFavorited, refetch: refetchFavorite } = useQuery({
    queryKey: ['list-favorite', list.id, user?.id],
    queryFn: async () => {
      if (!user) return false
      const { data, error } = await supabase
        .from('asset_list_favorites')
        .select('id')
        .eq('list_id', list.id)
        .eq('user_id', user.id)
        .single()

      if (error && error.code !== 'PGRST116') throw error // PGRST116 means no rows found
      return !!data
    },
    enabled: !!user
  })

  // Mutation to toggle favorite
  const toggleFavoriteMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('User not authenticated')

      if (isFavorited) {
        // Remove from favorites
        const { error } = await supabase
          .from('asset_list_favorites')
          .delete()
          .eq('list_id', list.id)
          .eq('user_id', user.id)
        if (error) throw error
      } else {
        // Add to favorites
        const { error } = await supabase
          .from('asset_list_favorites')
          .insert({ list_id: list.id, user_id: user.id })
        if (error) throw error
      }
    },
    onSuccess: () => {
      refetchFavorite()
      queryClient.invalidateQueries({ queryKey: ['user-favorite-lists'] })
    }
  })

  // Add assets to list mutation
  const addAssetsToListMutation = useMutation({
    mutationFn: async (assetIds: string[]) => {
      if (!user) throw new Error('User not authenticated')

      const itemsToInsert = assetIds.map(assetId => ({
        list_id: list.id,
        asset_id: assetId,
        added_by: user.id,
        added_at: new Date().toISOString()
      }))

      const { error } = await supabase
        .from('asset_list_items')
        .insert(itemsToInsert)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-list-items', list.id] })
      queryClient.invalidateQueries({ queryKey: ['asset-lists'] })
      setShowAddAssetDialog(false)
      setSelectedAssets([])
      setAssetSearchQuery('')
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


      // Sector filter
      const matchesSector = sectorFilter === 'all' || item.assets.sector === sectorFilter

      return matchesSearch && matchesPriority && matchesSector
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
          // Use real-time price if available, otherwise fallback to saved price
          const aQuote = financialData?.[a.assets?.symbol || '']
          const bQuote = financialData?.[b.assets?.symbol || '']
          aValue = aQuote?.price || a.assets?.current_price || 0
          bValue = bQuote?.price || b.assets?.current_price || 0
          break
        case 'priority':
          const priorityOrder = { high: 4, medium: 3, low: 2, none: 1 }
          aValue = priorityOrder[a.assets?.priority as keyof typeof priorityOrder] || 0
          bValue = priorityOrder[b.assets?.priority as keyof typeof priorityOrder] || 0
          break
        case 'process_stage':
          const stageOrder = {
            outdated: 1,
            prioritized: 2,
            in_progress: 3,
            recommend: 4,
            review: 5,
            action: 6,
            monitor: 7
          }
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
  }, [listItems, searchQuery, priorityFilter, sectorFilter, sortBy, sortOrder, financialData])

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

  // Update list item category mutation (for kanban view)
  const updateItemCategoryMutation = useMutation({
    mutationFn: async ({ itemId, newCategory }: { itemId: string; newCategory: string }) => {
      const { error } = await supabase
        .from('asset_list_items')
        .update({
          list_category: newCategory,
          updated_at: new Date().toISOString()
        })
        .eq('id', itemId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-list-items', list.id] })
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

  const handleDragEnter = (e: React.DragEvent, itemId?: string, category?: string) => {
    e.preventDefault()
    if (itemId && draggedItem && draggedItem !== itemId) {
      setDraggedOverItem(itemId)
    }
    if (category && draggedItem) {
      setDraggedOverStage(category)
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

  const handleDrop = (e: React.DragEvent, targetItemId?: string, targetCategory?: string) => {
    e.preventDefault()

    if (!draggedItem) return

    if (targetCategory && viewMode === 'kanban') {
      // Handle category change in kanban view
      const draggedItemData = filteredItems.find(item => item.id === draggedItem)
      if (draggedItemData && (draggedItemData.list_category || 'uncategorized') !== targetCategory) {
        updateItemCategoryMutation.mutate({
          itemId: draggedItemData.id,
          newCategory: targetCategory
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


  const getStageColor = (stage: string | null) => {
    const stageConfig = STAGE_CONFIGS.find(config => config.id === stage)
    if (stageConfig) {
      // Convert bg-color to badge variant
      switch (stageConfig.color) {
        case 'bg-gray-600': return 'default'
        case 'bg-orange-600': return 'warning'
        case 'bg-blue-500': return 'primary'
        case 'bg-yellow-500': return 'warning'
        case 'bg-green-400': return 'success'
        case 'bg-green-700': return 'success'
        case 'bg-teal-500': return 'primary'
        default: return 'default'
      }
    }
    return 'default'
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

  // Filter assets for adding (exclude already added assets)
  const availableAssets = useMemo(() => {
    if (!allAssets || !listItems) return []

    const existingAssetIds = new Set(listItems.map(item => item.asset_id))
    let filtered = allAssets.filter(asset => !existingAssetIds.has(asset.id))

    // Apply search filter
    if (assetSearchQuery.trim()) {
      const searchLower = assetSearchQuery.toLowerCase()
      filtered = filtered.filter(asset =>
        asset.symbol.toLowerCase().includes(searchLower) ||
        asset.company_name.toLowerCase().includes(searchLower) ||
        (asset.sector && asset.sector.toLowerCase().includes(searchLower))
      )
    }

    return filtered
  }, [allAssets, listItems, assetSearchQuery])

  // Handle asset selection for adding
  const toggleAssetSelection = (assetId: string) => {
    setSelectedAssets(prev =>
      prev.includes(assetId)
        ? prev.filter(id => id !== assetId)
        : [...prev, assetId]
    )
  }

  // Add selected assets to list
  const handleAddSelectedAssets = () => {
    if (selectedAssets.length > 0) {
      addAssetsToListMutation.mutate(selectedAssets)
    }
  }

  const clearFilters = () => {
    setSearchQuery('')
    setPriorityFilter('all')
    setSectorFilter('all')
    setSortBy('added_at')
    setSortOrder('desc')
  }

  // Column management functions
  const addColumn = (fieldId: string) => {
    const field = availableFields.find(f => f.id === fieldId)
    if (field && !dynamicColumns.find(col => col.field === fieldId) && fieldId !== 'assets.symbol') {
      const newColumn = {
        id: fieldId.replace(/\./g, '_'),
        field: fieldId,
        label: field.label,
        width: 150,
        type: field.type
      }
      setDynamicColumns([...dynamicColumns, newColumn])
    }
  }

  const removeColumn = (columnId: string) => {
    setDynamicColumns(columns => columns.filter(col => col.id !== columnId))
  }

  const updateColumnWidth = (columnId: string, newWidth: number) => {
    if (columnId === 'symbol') {
      // Handle symbol column width if needed
      return
    }
    setDynamicColumns(columns =>
      columns.map(col =>
        col.id === columnId ? { ...col, width: Math.max(50, newWidth) } : col
      )
    )
  }

  const updateColumnLabel = (columnId: string, newLabel: string) => {
    setDynamicColumns(columns =>
      columns.map(col =>
        col.id === columnId ? { ...col, label: newLabel } : col
      )
    )
  }

  const updateColumnField = (columnId: string, newFieldId: string) => {
    const field = availableFields.find(f => f.id === newFieldId)
    if (field && newFieldId !== 'assets.symbol') {
      setDynamicColumns(columns =>
        columns.map(col =>
          col.id === columnId ? {
            ...col,
            field: newFieldId,
            type: field.type,
            label: field.label
          } : col
        )
      )
    }
  }

  // Handle column resize
  const handleColumnResize = (columnId: string, startX: number, startWidth: number) => {
    const handleMouseMove = (e: MouseEvent) => {
      const diff = e.clientX - startX
      const newWidth = startWidth + diff
      updateColumnWidth(columnId, newWidth)
    }

    const handleMouseUp = () => {
      setResizingColumn(null)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  // Handle field search with real-time filtering
  const handleFieldSearch = (query: string) => {
    setHeaderInputValue(query)

    if (query.trim() === '') {
      // Show all fields when empty
      setFieldSearchResults(availableFields)
    } else {
      // Filter fields based on query
      const filtered = availableFields.filter(field =>
        field.label.toLowerCase().includes(query.toLowerCase()) ||
        field.id.toLowerCase().includes(query.toLowerCase())
      )
      setFieldSearchResults(filtered)
    }

    setShowFieldDropdown(true)
  }

  // Select field from dropdown
  const selectField = (columnId: string, field: typeof availableFields[0]) => {
    updateColumnField(columnId, field.id)
    setEditingHeader(null)
    setHeaderInputValue('')
    setShowFieldDropdown(false)
    setFieldSearchResults([])
  }

  // Handle right-click context menu for rows
  const handleRowRightClick = (e: React.MouseEvent, itemId: string) => {
    e.preventDefault()
    setContextMenuPosition({ x: e.clientX, y: e.clientY })
    setContextMenuItem(itemId)
    setColumnContextMenu(null) // Close column menu
  }

  // Handle right-click context menu for column headers
  const handleColumnRightClick = (e: React.MouseEvent, columnId: string) => {
    console.log('🖱️ Right-click detected on column:', columnId)
    e.preventDefault()
    setColumnContextMenu({
      position: { x: e.clientX, y: e.clientY },
      columnId
    })
    setContextMenuPosition(null) // Close row menu
    console.log('🎯 Column context menu state set:', { position: { x: e.clientX, y: e.clientY }, columnId })
  }

  // Close context menus
  const closeContextMenu = () => {
    setContextMenuPosition(null)
    setContextMenuItem(null)
    setColumnContextMenu(null)
  }

  // Start editing header
  const startEditingHeader = (columnId: string, currentLabel: string) => {
    console.log('✏️ startEditingHeader called with:', columnId, currentLabel)
    setEditingHeader(columnId)
    setHeaderInputValue('')  // Start with empty search
    setFieldSearchResults(availableFields)  // Show all fields initially
    setShowFieldDropdown(true)
    console.log('✏️ Edit header state updated')
  }

  // Cancel editing
  const cancelEditingHeader = () => {
    setEditingHeader(null)
    setHeaderInputValue('')
    setShowFieldDropdown(false)
    setFieldSearchResults([])
  }

  // Get value from item based on field path
  const getFieldValue = (item: ListItem, fieldPath: string) => {
    const parts = fieldPath.split('.')
    let value: any = item

    for (const part of parts) {
      value = value?.[part]
      if (value === undefined || value === null) break
    }

    return value
  }

  // Render cell content based on type
  const renderCellContent = (item: ListItem, column: any) => {
    const value = getFieldValue(item, column.field)

    switch (column.type) {
      case 'currency':
        if (column.field === 'assets.current_price') {
          const quote = financialData?.[item.assets?.symbol || '']
          if (quote) {
            const isPositive = quote.change >= 0
            const changeColor = isPositive ? 'text-success-600' : 'text-red-600'
            const ChangeIcon = isPositive ? ArrowUpRight : ArrowDownRight
            return (
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  ${quote.price.toFixed(2)}
                </p>
                <div className={`flex items-center ${changeColor} text-xs`}>
                  <ChangeIcon className="h-3 w-3 mr-0.5" />
                  {isPositive ? '+' : ''}{quote.changePercent.toFixed(2)}%
                </div>
              </div>
            )
          }
        }
        return value ? `$${value}` : '—'

      case 'priority':
        return value ? <PriorityBadge priority={value} /> : '—'

      case 'stage':
        if (!value) return '—'
        const stageConfig = STAGE_CONFIGS.find(config => config.id === value)
        if (stageConfig) {
          const StageIcon = stageConfig.icon
          return (
            <div className="flex items-center space-x-1">
              <StageIcon className={`h-3 w-3 ${stageConfig.textColor}`} />
              <span className={`text-xs ${stageConfig.textColor}`}>{stageConfig.label}</span>
            </div>
          )
        }
        return value

      case 'date':
        return value ? formatDistanceToNow(new Date(value), { addSuffix: true }) : '—'

      default:
        return value || '—'
    }
  }

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement

      if (showColumnSettings) {
        if (!target.closest('.column-settings-dropdown') && !target.closest('button')) {
          setShowColumnSettings(false)
        }
      }

      if (showCategorySettings) {
        if (!target.closest('.category-settings-dropdown') && !target.closest('button')) {
          setShowCategorySettings(false)
        }
      }

      if (showFieldDropdown && editingHeader) {
        // Only close if clicking outside the dropdown and input area
        const isInsideDropdown = target.closest('.absolute') || target.closest('input')
        if (!isInsideDropdown) {
          cancelEditingHeader()
        }
      }

      if (contextMenuPosition || columnContextMenu) {
        // Only close if clicking outside the context menu
        if (!target.closest('.fixed.bg-white.border')) {
          closeContextMenu()
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showColumnSettings, showCategorySettings, showFieldDropdown, editingHeader, contextMenuPosition, columnContextMenu])

  // Category management functions
  const addCategory = () => {
    if (newCategoryLabel.trim()) {
      const newCategory = {
        id: newCategoryLabel.toLowerCase().replace(/\s+/g, '_'),
        label: newCategoryLabel.trim(),
        color: 'bg-gray-500',
        icon: Target
      }
      setCustomCategories([...customCategories, newCategory])
      setNewCategoryLabel('')
    }
  }

  const updateCategory = (categoryId: string, newLabel: string) => {
    setCustomCategories(categories =>
      categories.map(cat =>
        cat.id === categoryId ? { ...cat, label: newLabel } : cat
      )
    )
    setEditingCategory(null)
    setEditingLabel('')
  }

  const deleteCategory = (categoryId: string) => {
    setCustomCategories(categories => categories.filter(cat => cat.id !== categoryId))
  }

  const activeFiltersCount = [
    searchQuery,
    priorityFilter !== 'all' ? priorityFilter : null,
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
        <div className="p-4">
          <div onClick={() => item.assets && handleAssetClick(item.assets)}>
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
                <PriorityBadge priority={item.assets.priority} />
              )}
            </div>
          </div>
          {/* Active Workflows */}
          {(() => {
            const assetWorkflows = activeWorkflows?.[item.assets?.id || ''] || []

            if (assetWorkflows.length === 0) return null

            return (
              <div className="mt-3 pt-3 border-t border-gray-200">
                <div className="text-xs font-medium text-gray-500 mb-2">Active Workflows</div>
                <div className="space-y-1">
                  {assetWorkflows.slice(0, 2).map((workflow, index) => (
                    <div
                      key={`${workflow.workflows.id}-${index}`}
                      className="flex items-center justify-between p-2 bg-gray-50 rounded text-xs"
                    >
                      <div className="flex items-center space-x-2">
                        <div
                          className={`w-2 h-2 rounded-full`}
                          style={{ backgroundColor: workflow.workflows.color || '#3b82f6' }}
                        />
                        <span className="font-medium truncate">{workflow.workflows.name}</span>
                      </div>
                      <span className="text-gray-500 capitalize">{workflow.stage}</span>
                    </div>
                  ))}
                  {assetWorkflows.length > 2 && (
                    <div className="text-xs text-gray-500 text-center">
                      +{assetWorkflows.length - 2} more
                    </div>
                  )}
                </div>
              </div>
            )
          })()}
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
        "pl-2 pr-4 py-4 transition-all duration-200 group relative",
        !isDragging && "hover:bg-gray-50 cursor-move",
        draggedItem === item.id && 'opacity-30 scale-95 z-10',
        draggedOverItem === item.id && dragPosition === 'above' && 'border-t-4 border-primary-500',
        draggedOverItem === item.id && dragPosition === 'below' && 'border-b-4 border-primary-500',
        draggedOverItem === item.id && 'bg-primary-25'
      )}
      onContextMenu={(e) => handleRowRightClick(e, item.id)}
      style={{
        transform: draggedItem === item.id ? 'rotate(1deg)' : 'none',
        boxShadow: draggedItem === item.id ? '0 8px 25px rgba(0, 0, 0, 0.15)' : 'none'
      }}
    >
      {/* Drop indicator lines */}
      {draggedOverItem === item.id && dragPosition === 'above' && (
        <div className="absolute top-0 left-2 right-6 h-0.5 bg-primary-500 rounded-full z-20" />
      )}
      {draggedOverItem === item.id && dragPosition === 'below' && (
        <div className="absolute bottom-0 left-2 right-6 h-0.5 bg-primary-500 rounded-full z-20" />
      )}
      
      <div className="flex items-center gap-2">
        {/* Drag Handle */}
        <div className="flex-shrink-0 w-6">
          <div className={clsx(
            "p-1 hover:bg-gray-200 rounded transition-all duration-200",
            isDragging ? "opacity-0" : "opacity-0 group-hover:opacity-100"
          )}
          disabled={isDragging}
          >
            <GripVertical className="h-3 w-3 text-gray-400 cursor-grab active:cursor-grabbing" />
          </div>
        </div>

        <div className="flex-1">
          <div className="flex items-center gap-2">
            {/* Symbol column - matches header */}
            <div className="flex-shrink-0" style={{ width: `${symbolColumn.width}px` }}>
              <div
                className="cursor-pointer"
                onClick={() => item.assets && handleAssetClick(item.assets)}
              >
                <h4 className="font-semibold text-gray-900">
                  {item.assets?.symbol || 'Unknown'}
                </h4>
                <p className="text-sm text-gray-600 truncate">
                  {item.assets?.company_name || 'Unknown Company'}
                </p>
                {item.assets?.sector && (
                  <p className="text-xs text-gray-500">{item.assets.sector}</p>
                )}
              </div>
            </div>

            {/* Dynamic columns */}
            {dynamicColumns.map(column => (
              <div
                key={column.id}
                className="flex-shrink-0"
                style={{ width: `${column.width}px` }}
              >
                {financialDataLoading && column.type === 'currency' ? (
                  <div className="animate-pulse">
                    <div className="h-4 bg-gray-200 rounded w-16"></div>
                  </div>
                ) : (
                  <div className="text-sm">
                    {renderCellContent(item, column)}
                  </div>
                )}
              </div>
            ))}

            {/* No actions column - will use right-click */}
          </div>
        </div>
      </div>
    </div>
  )

  const renderKanbanColumn = (categoryId: string, items: ListItem[], categoryConfig: any) => {
    const CategoryIcon = categoryConfig.icon

    return (
      <div
        key={categoryId}
        className="flex-1 min-w-[300px]"
        onDragOver={handleDragOver}
        onDragEnter={(e) => handleDragEnter(e, undefined, categoryId)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, undefined, categoryId)}
      >
        <div className={clsx(
          "bg-gray-50 rounded-lg p-4 min-h-[200px] transition-colors",
          draggedOverStage === categoryId && 'bg-primary-50 border-2 border-primary-300 border-dashed'
        )}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <div className={`w-6 h-6 rounded-full ${categoryConfig.color} flex items-center justify-center`}>
                <CategoryIcon className="w-3 h-3 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">{categoryConfig.label}</h3>
              </div>
            </div>
            <Badge variant="primary" size="sm">
              {items.length}
            </Badge>
          </div>
          <div className="space-y-3">
            {items.map(item => renderAssetCard(item))}
          </div>
        </div>
      </div>
    )
  }

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
              <button
                onClick={() => toggleFavoriteMutation.mutate()}
                className="transition-colors"
                title={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
              >
                <Star
                  className={clsx(
                    'h-5 w-5 transition-colors',
                    isFavorited ? 'text-yellow-500 fill-yellow-500' : 'text-gray-400 hover:text-yellow-500'
                  )}
                />
              </button>
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
          <Button
            onClick={() => setShowAddAssetDialog(true)}
            variant="primary"
            size="sm"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Asset
          </Button>
          {list.created_by === user?.id && (
            <Button
              onClick={() => setShowShareDialog(true)}
              variant="outline"
              size="sm"
            >
              <Share2 className="h-4 w-4 mr-2" />
              Share
            </Button>
          )}
          {collaborators && collaborators.length > 0 && (
            <Badge variant="primary" size="sm">
              <Users className="h-3 w-3 mr-1" />
              {collaborators.length} Shared
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

            {/* View Settings - Available in all views */}
            <div className="relative">
              <button
                onClick={() => setShowColumnSettings(!showColumnSettings)}
                className="flex items-center space-x-1 text-gray-600 hover:text-gray-900 transition-colors p-1 rounded hover:bg-gray-50"
                title="View settings"
              >
                <Settings className="h-4 w-4" />
              </button>

              {/* Settings Dropdown */}
              {showColumnSettings && (
                <div className="absolute right-0 top-full mt-2 bg-white border border-gray-200 rounded-lg shadow-xl py-2 z-[10002] min-w-[280px] column-settings-dropdown">
                  {viewMode === 'table' && (
                    <div className="px-4 py-2 border-b border-gray-200">
                      <h4 className="font-medium text-gray-900 mb-3">Table Settings</h4>
                      <p className="text-sm text-gray-600 mb-2">Click headers to sort, right-click to edit/remove columns</p>
                      <div className="space-y-2">
                        {availableFields.filter(field => field.id !== 'assets.symbol' && !dynamicColumns.find(col => col.field === field.id)).map(field => (
                          <button
                            key={field.id}
                            onClick={() => {
                              addColumn(field.id)
                              setShowColumnSettings(false)
                            }}
                            className="flex items-center justify-between w-full px-2 py-1 text-sm hover:bg-gray-50 rounded transition-colors"
                          >
                            <span>{field.label}</span>
                            <Plus className="h-3 w-3 text-gray-400" />
                          </button>
                        ))}
                        {availableFields.filter(field => field.id !== 'assets.symbol' && !dynamicColumns.find(col => col.field === field.id)).length === 0 && (
                          <p className="text-xs text-gray-500">All available columns are already added</p>
                        )}
                      </div>
                    </div>
                  )}

                  {viewMode === 'kanban' && (
                    <div className="px-4 py-2">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-medium text-gray-900">Category Settings</h4>
                        <button
                          onClick={() => setShowCategorySettings(!showCategorySettings)}
                          className="text-sm text-primary-600 hover:text-primary-700 transition-colors"
                        >
                          {showCategorySettings ? 'Close' : 'Manage'}
                        </button>
                      </div>
                      <p className="text-sm text-gray-600">Manage categories for organizing your assets</p>
                    </div>
                  )}

                  {viewMode === 'cards' && (
                    <div className="px-4 py-2">
                      <h4 className="font-medium text-gray-900 mb-2">Card Settings</h4>
                      <p className="text-sm text-gray-600">Card view display options</p>
                    </div>
                  )}

                  {/* View Mode Switcher */}
                  <div className="px-4 py-2 border-t border-gray-200 mt-2">
                    <h5 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Switch View</h5>
                    <div className="space-y-1">
                      <button
                        onClick={() => {
                          setViewMode('table')
                          setShowColumnSettings(false)
                        }}
                        className={`flex items-center w-full px-2 py-1 text-sm rounded transition-colors ${
                          viewMode === 'table' ? 'bg-primary-50 text-primary-700' : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <span>Table View</span>
                      </button>
                      <button
                        onClick={() => {
                          setViewMode('cards')
                          setShowColumnSettings(false)
                        }}
                        className={`flex items-center w-full px-2 py-1 text-sm rounded transition-colors ${
                          viewMode === 'cards' ? 'bg-primary-50 text-primary-700' : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <span>Cards View</span>
                      </button>
                      <button
                        onClick={() => {
                          setViewMode('kanban')
                          setShowColumnSettings(false)
                        }}
                        className={`flex items-center w-full px-2 py-1 text-sm rounded transition-colors ${
                          viewMode === 'kanban' ? 'bg-primary-50 text-primary-700' : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <span>Kanban View</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
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
                  { value: 'priority', label: 'Priority' }
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
            <Card padding="none" className="overflow-visible relative">
              {/* Field Dropdown - Positioned below header */}
              {editingHeader && (
                <div
                  className="absolute bg-white border border-gray-300 rounded-lg shadow-xl max-h-80 overflow-hidden min-w-[360px]"
                  style={{
                    zIndex: 10000,
                    top: '60px',
                    left: '50%',
                    transform: 'translateX(-50%)'
                  }}
                >
                  {/* Header */}
                  <div className="px-3 py-2 text-sm font-medium text-gray-700 border-b border-gray-200 bg-gray-50">
                    Change Column Field
                  </div>

                  {/* Search Input */}
                  <div className="p-3 border-b border-gray-200">
                    <input
                      type="text"
                      value={headerInputValue}
                      onChange={(e) => handleFieldSearch(e.target.value)}
                      placeholder="Search fields..."
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      autoFocus
                    />
                  </div>

                  {/* Results */}
                  <div className="max-h-60 overflow-y-auto">
                    {fieldSearchResults.length > 0 ? (
                      fieldSearchResults.map((field, index) => (
                        <button
                          key={field.id}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            selectField(editingHeader!, field)
                          }}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-primary-50 flex items-center justify-between border-b border-gray-100 last:border-b-0 transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-gray-900 truncate">{field.label}</div>
                            <div className="text-gray-500 text-xs truncate">{field.id}</div>
                          </div>
                          <div className="text-xs text-primary-600 capitalize bg-primary-100 px-2 py-0.5 rounded ml-2">{field.type}</div>
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-4 text-sm text-gray-500 text-center">
                        {headerInputValue.trim() ? `No fields found for "${headerInputValue}"` : 'Type to search available fields'}
                      </div>
                    )}
                  </div>

                  {/* Footer */}
                  <div className="px-3 py-2 text-xs text-gray-500 border-t border-gray-200 bg-gray-50">
                    Press Escape to cancel
                  </div>
                </div>
              )}
              <div className="divide-y divide-gray-200 overflow-visible">
                {/* Table Header - Spreadsheet Style */}
                <div className="pl-2 pr-6 py-3 bg-gray-50 border-b border-gray-200 overflow-visible relative">
                  <div className="flex items-center gap-2 text-xs font-medium text-gray-500 uppercase tracking-wider min-w-max">
                    <div className="flex-shrink-0 w-6"></div>

                    {/* Symbol column - Fixed */}
                    <div
                      className="flex-shrink-0 relative group"
                      style={{ width: `${symbolColumn.width}px` }}
                      onContextMenu={(e) => {
                        if (editingHeader !== 'symbol') {
                          handleColumnRightClick(e, 'symbol')
                        }
                      }}
                    >
                      <button
                        onClick={() => handleSort('symbol')}
                        className="flex items-center space-x-1 hover:text-gray-700 transition-colors w-full h-full py-2"
                        title="Sort by Symbol (right-click anywhere on header for options)"
                      >
                        <span>{symbolColumn.label}</span>
                        <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </div>

                    {/* Dynamic columns with resize handles */}
                    {dynamicColumns.map((column, index) => (
                      <div
                        key={column.id}
                        className="flex-shrink-0 relative group"
                        style={{ width: `${column.width}px` }}
                        onContextMenu={(e) => {
                          if (editingHeader !== column.id) {
                            handleColumnRightClick(e, column.id)
                          }
                        }}
                      >
                        <div className="flex items-center justify-between h-full">
                          {editingHeader === column.id ? (
                            <div className="relative w-full">
                              <input
                                type="text"
                                value={headerInputValue}
                                onChange={(e) => handleFieldSearch(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape') {
                                    cancelEditingHeader()
                                  } else if (e.key === 'Enter' && fieldSearchResults.length > 0) {
                                    selectField(column.id, fieldSearchResults[0])
                                  }
                                }}
                                className="w-full px-2 py-1 text-xs border border-primary-500 rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary-500"
                                placeholder="Type to search fields..."
                                autoFocus
                              />

                              {/* Field dropdown removed - using global dropdown */}
                            </div>
                          ) : (
                            <button
                              onClick={() => handleSort(column.field.replace('assets.', ''))}
                              className="flex items-center space-x-1 hover:text-gray-700 transition-colors truncate w-full h-full py-2"
                              title={`Sort by ${column.label} (right-click anywhere on header for options)`}
                            >
                              <span className="truncate">{column.label}</span>
                              <ArrowUpDown className="h-3 w-3 flex-shrink-0" />
                            </button>
                          )}
                        </div>

                        {/* Resize handle */}
                        <div
                          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary-300 opacity-0 group-hover:opacity-100 transition-opacity"
                          onMouseDown={(e) => {
                            e.preventDefault()
                            setResizingColumn(column.id)
                            handleColumnResize(column.id, e.clientX, column.width)
                          }}
                        />
                      </div>
                    ))}

                    {/* Add column button */}
                    <div className="flex-shrink-0 relative">
                      <button
                        onClick={() => {
                          // Create a new empty column that user can immediately edit
                          const newColumnId = `col_${Date.now()}`
                          const emptyColumn = {
                            id: newColumnId,
                            field: 'notes', // Default field
                            label: 'New Column',
                            width: 150,
                            type: 'text'
                          }
                          setDynamicColumns([...dynamicColumns, emptyColumn])
                          // Immediately start editing the new column
                          setTimeout(() => {
                            startEditingHeader(newColumnId, 'New Column')
                          }, 100)
                        }}
                        className="flex items-center space-x-1 text-primary-600 hover:text-primary-700 transition-colors px-2 py-1 rounded hover:bg-primary-50"
                        title="Add new column"
                      >
                        <Plus className="h-3 w-3" />
                        <span>Add Column</span>
                      </button>
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
            <div className="space-y-4">
              {/* Category Management - Header without duplicate settings button */}
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-gray-900">Categories</h3>
              </div>

              {showCategorySettings && (
                <Card className="category-settings-dropdown">
                  <div className="space-y-4">
                    <h4 className="font-medium text-gray-900">Manage Categories</h4>

                    {/* Add new category */}
                    <div className="flex items-center space-x-2">
                      <input
                        type="text"
                        placeholder="New category name"
                        value={newCategoryLabel}
                        onChange={(e) => setNewCategoryLabel(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && addCategory()}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                      <Button size="sm" onClick={addCategory}>
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>

                    {/* Existing categories */}
                    <div className="space-y-2">
                      {customCategories.map(category => (
                        <div key={category.id} className="flex items-center justify-between p-2 border border-gray-200 rounded-lg">
                          <div className="flex items-center space-x-2">
                            <div className={`w-4 h-4 rounded-full ${category.color}`}></div>
                            {editingCategory === category.id ? (
                              <input
                                type="text"
                                value={editingLabel}
                                onChange={(e) => setEditingLabel(e.target.value)}
                                onKeyPress={(e) => {
                                  if (e.key === 'Enter') updateCategory(category.id, editingLabel)
                                }}
                                className="px-2 py-1 border border-gray-300 rounded text-sm"
                                autoFocus
                              />
                            ) : (
                              <span className="text-sm font-medium">{category.label}</span>
                            )}
                          </div>
                          <div className="flex items-center space-x-1">
                            {editingCategory === category.id ? (
                              <>
                                <button
                                  onClick={() => updateCategory(category.id, editingLabel)}
                                  className="p-1 text-green-600 hover:bg-green-50 rounded"
                                >
                                  <Check className="h-3 w-3" />
                                </button>
                                <button
                                  onClick={() => {
                                    setEditingCategory(null)
                                    setEditingLabel('')
                                  }}
                                  className="p-1 text-gray-400 hover:bg-gray-50 rounded"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => {
                                    setEditingCategory(category.id)
                                    setEditingLabel(category.label)
                                  }}
                                  className="p-1 text-gray-400 hover:bg-gray-50 rounded"
                                >
                                  <Edit3 className="h-3 w-3" />
                                </button>
                                <button
                                  onClick={() => deleteCategory(category.id)}
                                  className="p-1 text-red-400 hover:bg-red-50 rounded"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </Card>
              )}

              {/* Kanban Columns */}
              <div className="flex space-x-6 overflow-x-auto pb-4 min-h-[400px]">
                {/* Uncategorized column */}
                {(() => {
                  const uncategorizedItems = filteredItems.filter(item => !item.list_category)
                  return renderKanbanColumn('uncategorized', uncategorizedItems, {
                    id: 'uncategorized',
                    label: 'Uncategorized',
                    color: 'bg-gray-400',
                    icon: Target
                  })
                })()}

                {/* Custom category columns */}
                {customCategories.map(categoryConfig => {
                  const categoryItems = filteredItems.filter(item => item.list_category === categoryConfig.id)
                  return renderKanbanColumn(categoryConfig.id, categoryItems, categoryConfig)
                })}
              </div>
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

      {/* Share Dialog */}
      <ShareListDialog
        isOpen={showShareDialog}
        onClose={() => setShowShareDialog(false)}
        list={list}
      />

      {/* Add Asset Dialog */}
      {showAddAssetDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900">Add Assets to "{list.name}"</h2>
              <button
                onClick={() => {
                  setShowAddAssetDialog(false)
                  setSelectedAssets([])
                  setAssetSearchQuery('')
                }}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            {/* Search */}
            <div className="p-6 border-b border-gray-200">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search assets by symbol, company name, or sector..."
                  value={assetSearchQuery}
                  onChange={(e) => setAssetSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
              {selectedAssets.length > 0 && (
                <div className="mt-3 flex items-center justify-between">
                  <p className="text-sm text-gray-600">
                    {selectedAssets.length} asset{selectedAssets.length !== 1 ? 's' : ''} selected
                  </p>
                  <button
                    onClick={() => setSelectedAssets([])}
                    className="text-sm text-primary-600 hover:text-primary-700 transition-colors"
                  >
                    Clear selection
                  </button>
                </div>
              )}
            </div>

            {/* Asset List */}
            <div className="flex-1 overflow-y-auto">
              {allAssetsLoading ? (
                <div className="p-6">
                  <div className="space-y-4">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="animate-pulse">
                        <div className="flex items-center space-x-4 p-4">
                          <div className="w-4 h-4 bg-gray-200 rounded"></div>
                          <div className="flex-1 space-y-2">
                            <div className="h-4 bg-gray-200 rounded w-1/4"></div>
                            <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : availableAssets.length > 0 ? (
                <div className="divide-y divide-gray-200">
                  {availableAssets.map((asset) => (
                    <div
                      key={asset.id}
                      className={clsx(
                        'flex items-center p-4 hover:bg-gray-50 transition-colors cursor-pointer',
                        selectedAssets.includes(asset.id) && 'bg-primary-50'
                      )}
                      onClick={() => toggleAssetSelection(asset.id)}
                    >
                      <div className="flex items-center space-x-4 flex-1">
                        <input
                          type="checkbox"
                          checked={selectedAssets.includes(asset.id)}
                          onChange={() => toggleAssetSelection(asset.id)}
                          className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2">
                            <p className="text-sm font-semibold text-gray-900">{asset.symbol}</p>
                          </div>
                          <p className="text-sm text-gray-600 truncate">{asset.company_name}</p>
                          {asset.sector && (
                            <p className="text-xs text-gray-500">{asset.sector}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-12 text-center">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Search className="h-8 w-8 text-gray-400" />
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">
                    {assetSearchQuery ? 'No assets found' : 'No available assets'}
                  </h3>
                  <p className="text-gray-500">
                    {assetSearchQuery
                      ? 'Try adjusting your search terms'
                      : 'All assets are already in this list or no assets exist yet'
                    }
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between p-6 border-t border-gray-200">
              <div className="text-sm text-gray-600">
                {availableAssets.length} asset{availableAssets.length !== 1 ? 's' : ''} available
              </div>
              <div className="flex space-x-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowAddAssetDialog(false)
                    setSelectedAssets([])
                    setAssetSearchQuery('')
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleAddSelectedAssets}
                  disabled={selectedAssets.length === 0 || addAssetsToListMutation.isPending}
                >
                  {addAssetsToListMutation.isPending ? 'Adding...' : `Add ${selectedAssets.length} Asset${selectedAssets.length !== 1 ? 's' : ''}`}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Column Context Menu */}
      {columnContextMenu && (
        <div>
          {console.log('🎯 Rendering column context menu:', columnContextMenu)}
          <div
            className="fixed bg-white border border-gray-200 rounded-lg shadow-xl py-1 z-[10001] min-w-[160px]"
            style={{
              top: columnContextMenu.position.y,
              left: columnContextMenu.position.x
            }}
            onMouseDown={(e) => {
              console.log('🖱️ Mouse down on context menu container')
              e.stopPropagation()
            }}
          >
          {columnContextMenu.columnId !== 'symbol' && (
            <button
              onClick={() => {
                console.log('🔍 Edit Field clicked for column:', columnContextMenu.columnId)
                const column = dynamicColumns.find(col => col.id === columnContextMenu.columnId)
                console.log('📋 Found column:', column)
                if (column) {
                  console.log('✏️ Calling startEditingHeader')
                  startEditingHeader(columnContextMenu.columnId, column.label)
                }
                setColumnContextMenu(null)
              }}
              className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center transition-colors"
            >
              <Edit3 className="h-4 w-4 mr-2" />
              Edit Field
            </button>
          )}
          {columnContextMenu.columnId === 'symbol' && (
            <div className="px-3 py-2 text-sm text-gray-500 italic">
              Symbol column cannot be changed
            </div>
          )}
          {columnContextMenu.columnId !== 'symbol' && (
            <button
              onClick={() => {
                removeColumn(columnContextMenu.columnId)
                setColumnContextMenu(null)
              }}
              className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center transition-colors"
            >
              <X className="h-4 w-4 mr-2" />
              Remove Column
            </button>
          )}
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenuPosition && contextMenuItem && (
        <div
          className="fixed bg-white border border-gray-200 rounded-lg shadow-xl py-1 z-50 min-w-[160px]"
          style={{
            top: contextMenuPosition.y,
            left: contextMenuPosition.x
          }}
        >
          <button
            onClick={() => {
              const item = filteredItems.find(i => i.id === contextMenuItem)
              if (item) {
                handleRemoveFromList(item.id, item.assets?.symbol || 'Unknown')
              }
              closeContextMenu()
            }}
            className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center transition-colors"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Remove from List
          </button>
        </div>
      )}
    </div>
  )
}