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
  sort_order?: number | null
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

// Helper function to render trading view cell values
const renderTradingCellValue = (item: any, column: any, quote: any, changeColor: string) => {
  switch (column.id) {
    case 'current_price':
      return quote ? (
        <div className="font-bold text-gray-900">
          ${quote.price.toFixed(2)}
        </div>
      ) : (
        <div className="text-gray-400">
          ${item.assets?.current_price?.toFixed(2) || '--'}
        </div>
      )

    case 'day_change':
      return quote ? (
        <div className={`px-2 py-1 rounded font-semibold ${changeColor}`}>
          {quote.change >= 0 ? '▲' : '▼'} {Math.abs(quote.change).toFixed(2)}
        </div>
      ) : (
        <span className="text-gray-400">--</span>
      )

    case 'day_change_percent':
      return quote ? (
        <div className={`px-2 py-1 rounded font-bold ${changeColor}`}>
          {quote.changePercent >= 0 ? '+' : ''}{quote.changePercent.toFixed(1)}%
        </div>
      ) : (
        <span className="text-gray-400">--%</span>
      )

    case 'volume':
      return quote?.volume ? (
        <span>
          {quote.volume > 1000000
            ? `${(quote.volume / 1000000).toFixed(1)}M`
            : quote.volume > 1000
            ? `${(quote.volume / 1000).toFixed(0)}K`
            : quote.volume.toLocaleString()
          }
        </span>
      ) : (
        <span className="text-gray-400">--</span>
      )

    case 'market_cap':
      return quote?.marketCap ? (
        <span>
          {quote.marketCap > 1000000000
            ? `$${(quote.marketCap / 1000000000).toFixed(1)}B`
            : quote.marketCap > 1000000
            ? `$${(quote.marketCap / 1000000).toFixed(0)}M`
            : `$${(quote.marketCap / 1000).toFixed(0)}K`
          }
        </span>
      ) : (
        <span className="text-gray-400">--</span>
      )

    case 'priority':
      return item.assets?.priority ? (
        <PriorityBadge priority={item.assets.priority} size="sm" />
      ) : null

    case 'pe_ratio':
      return quote?.pe ? (
        <span>{quote.pe.toFixed(1)}</span>
      ) : (
        <span className="text-gray-400">--</span>
      )

    default:
      // Fallback to basic field display
      return item.assets?.[column.field] || '--'
  }
}

export function ListTab({ list, onAssetSelect }: ListTabProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [sectorFilter, setSectorFilter] = useState('all')
  const [sortBy, setSortBy] = useState('sort_order')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [showFilters, setShowFilters] = useState(false)
  const [viewMode, setViewMode] = useState<'table' | 'grid' | 'kanban' | 'trading'>('table')
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

  // Column management state
  const [resizingColumn, setResizingColumn] = useState<string | null>(null)
  const [resizeStartX, setResizeStartX] = useState(0)
  const [resizeStartWidth, setResizeStartWidth] = useState(0)
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null)
  const [draggedOverColumn, setDraggedOverColumn] = useState<string | null>(null)
  const [companyColumnWidth, setCompanyColumnWidth] = useState(150)
  const [columnContextMenu, setColumnContextMenu] = useState<{
    columnId: string;
    x: number;
    y: number;
    isFixedColumn?: boolean
  } | null>(null)
  // Symbol column is fixed, dynamic columns start after it
  const [dynamicColumns, setDynamicColumns] = useState([
    { id: 'company_name', field: 'assets.company_name', label: 'Company', width: 200, type: 'text' },
    { id: 'price', field: 'assets.current_price', label: 'Price', width: 120, type: 'currency' },
    { id: 'priority', field: 'assets.priority', label: 'Priority', width: 120, type: 'priority' },
    { id: 'sector', field: 'assets.sector', label: 'Sector', width: 150, type: 'text' },
  ])

  // Fixed symbol column
  const symbolColumn = { id: 'symbol', field: 'assets.symbol', label: 'Symbol', width: 140, type: 'text' }
  const [editingHeader, setEditingHeader] = useState<string | null>(null)
  const [headerInputValue, setHeaderInputValue] = useState('')
  const [fieldSearchResults, setFieldSearchResults] = useState<typeof availableFields>([])
  const [showFieldDropdown, setShowFieldDropdown] = useState(false)
  const [showCategorySettings, setShowCategorySettings] = useState(false)

  // Trading view columns
  const [tradingColumns, setTradingColumns] = useState([
    {
      id: 'current_price',
      label: 'Price',
      field: 'current_price',
      sortKey: 'current_price',
      align: 'left' as const,
      width: 100,
      sortable: true
    },
    {
      id: 'day_change',
      label: 'Day Chg',
      field: 'day_change',
      align: 'left' as const,
      width: 80,
      sortable: false
    },
    {
      id: 'day_change_percent',
      label: 'Day %',
      field: 'day_change_percent',
      align: 'left' as const,
      width: 80,
      sortable: false
    },
    {
      id: 'volume',
      label: 'Volume',
      field: 'volume',
      align: 'left' as const,
      width: 100,
      sortable: false
    },
    {
      id: 'market_cap',
      label: 'Mkt Cap',
      field: 'market_cap',
      align: 'left' as const,
      width: 100,
      sortable: false
    },
    {
      id: 'priority',
      label: 'Priority',
      field: 'priority',
      align: 'center' as const,
      width: 80,
      sortable: false
    }
  ])

  // Use trading columns for trading view, regular columns for table view
  const visibleColumns = viewMode === 'trading' ? tradingColumns : dynamicColumns
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
        .order('sort_order', { ascending: true })

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
        added_at: new Date().toISOString(),
        sort_order: (index + 1 + (listItems?.length || 0)) * 10
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

  // AI-powered natural language filtering
  const parseNaturalLanguageFilter = (query: string, item: any) => {
    if (!query.trim()) return true

    const lowerQuery = query.toLowerCase()
    const asset = item.assets
    if (!asset) return false

    let hasSpecificFilter = false

    // Debug logging
    if (query === 'high priority') {
      console.log('Filtering for high priority:', {
        query,
        symbol: asset.symbol,
        priority: asset.priority,
        sector: asset.sector
      })
    }

    // Price filters
    if (lowerQuery.includes('under $') || lowerQuery.includes('below $') || lowerQuery.includes('< $')) {
      hasSpecificFilter = true
      const priceMatch = lowerQuery.match(/(?:under|below|<)\s*\$?(\d+(?:\.\d+)?)/i)
      if (priceMatch) {
        const targetPrice = parseFloat(priceMatch[1])
        const currentPrice = financialData?.[asset.symbol]?.price || asset.current_price || 0
        if (currentPrice > targetPrice) return false
      }
    }

    if (lowerQuery.includes('over $') || lowerQuery.includes('above $') || lowerQuery.includes('> $')) {
      hasSpecificFilter = true
      const priceMatch = lowerQuery.match(/(?:over|above|>)\s*\$?(\d+(?:\.\d+)?)/i)
      if (priceMatch) {
        const targetPrice = parseFloat(priceMatch[1])
        const currentPrice = financialData?.[asset.symbol]?.price || asset.current_price || 0
        if (currentPrice < targetPrice) return false
      }
    }

    // Priority filters - more flexible patterns
    if (lowerQuery.includes('high priority') || lowerQuery.includes('high prio') || lowerQuery === 'high') {
      hasSpecificFilter = true
      if (asset.priority !== 'high') return false
    }
    if (lowerQuery.includes('medium priority') || lowerQuery.includes('medium prio') || lowerQuery === 'medium') {
      hasSpecificFilter = true
      if (asset.priority !== 'medium') return false
    }
    if (lowerQuery.includes('low priority') || lowerQuery.includes('low prio') || lowerQuery === 'low') {
      hasSpecificFilter = true
      if (asset.priority !== 'low') return false
    }
    if (lowerQuery.includes('no priority') || lowerQuery.includes('priority not set') || lowerQuery.includes('missing priority') || lowerQuery.includes('unset')) {
      hasSpecificFilter = true
      if (asset.priority && asset.priority !== 'none') return false
    }

    // Sector filters
    const sectorKeywords = {
      'tech': ['technology', 'software', 'tech', 'it', 'computer', 'tech stocks', 'software companies'],
      'biotech': ['biotech', 'biotechnology', 'pharmaceutical', 'pharma', 'healthcare', 'biotech companies', 'pharma companies'],
      'finance': ['finance', 'financial', 'bank', 'insurance', 'financial services', 'banking'],
      'energy': ['energy', 'oil', 'gas', 'renewable', 'energy stocks', 'oil companies'],
      'retail': ['retail', 'consumer', 'shopping', 'retail stocks', 'consumer goods'],
      'automotive': ['automotive', 'auto', 'car', 'vehicle', 'auto companies'],
      'real estate': ['real estate', 'reits', 'property', 'real estate stocks'],
      'healthcare': ['healthcare', 'medical', 'health', 'healthcare stocks']
    }

    let hasSectorFilter = false
    for (const [sector, keywords] of Object.entries(sectorKeywords)) {
      if (keywords.some(keyword => lowerQuery.includes(keyword))) {
        hasSpecificFilter = true
        hasSectorFilter = true
        if (!asset.sector?.toLowerCase().includes(sector) &&
            !keywords.some(keyword => asset.sector?.toLowerCase().includes(keyword))) {
          return false
        }
        break // Only match the first sector found
      }
    }

    // Date filters
    const now = new Date()
    if (lowerQuery.includes('this week') || lowerQuery.includes('added this week')) {
      hasSpecificFilter = true
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      const addedDate = new Date(item.added_at)
      if (addedDate < weekAgo) return false
    }

    if (lowerQuery.includes('this month') || lowerQuery.includes('added this month')) {
      hasSpecificFilter = true
      const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate())
      const addedDate = new Date(item.added_at)
      if (addedDate < monthAgo) return false
    }

    if (lowerQuery.includes('today') || lowerQuery.includes('added today')) {
      hasSpecificFilter = true
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const addedDate = new Date(item.added_at)
      if (addedDate < today) return false
    }

    // If we had specific filters and passed them all, return true
    if (hasSpecificFilter) return true

    // Basic text search (fallback for non-specific queries)
    const basicMatch =
      asset.symbol.toLowerCase().includes(lowerQuery) ||
      asset.company_name.toLowerCase().includes(lowerQuery) ||
      (asset.sector && asset.sector.toLowerCase().includes(lowerQuery)) ||
      (item.notes && item.notes.toLowerCase().includes(lowerQuery))

    return basicMatch
  }

  // Filter and sort items
  const filteredItems = useMemo(() => {
    if (!listItems) return []

    let filtered = listItems.filter(item => {
      if (!item.assets) return false

      // AI Natural Language Filter
      const matchesAIFilter = parseNaturalLanguageFilter(searchQuery, item)

      // Legacy filters (for backwards compatibility)
      const matchesPriority = priorityFilter === 'all' || item.assets.priority === priorityFilter
      const matchesSector = sectorFilter === 'all' || item.assets.sector === sectorFilter

      return matchesAIFilter && matchesPriority && matchesSector
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
          aValue = new Date(a.added_at || 0).getTime()
          bValue = new Date(b.added_at || 0).getTime()
          break
        case 'sort_order':
        default:
          aValue = a.sort_order || 0
          bValue = b.sort_order || 0
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
    mutationFn: async ({ draggedItemId, targetItemId, position }: {
      draggedItemId: string;
      targetItemId: string;
      position: 'above' | 'below'
    }) => {
      // Get all items in the list ordered by sort_order
      const { data: allItems, error: fetchError } = await supabase
        .from('asset_list_items')
        .select('id, sort_order')
        .eq('list_id', list.id)
        .order('sort_order', { ascending: true })

      if (fetchError) throw fetchError
      if (!allItems) return

      // Find the dragged and target items
      const draggedItem = allItems.find(item => item.id === draggedItemId)
      const targetItem = allItems.find(item => item.id === targetItemId)

      if (!draggedItem || !targetItem) return

      // Calculate new sort orders
      const updates: { id: string; sort_order: number }[] = []

      // Remove dragged item from the array for reordering
      const itemsWithoutDragged = allItems.filter(item => item.id !== draggedItemId)

      // Find target index in the filtered array
      const targetIndex = itemsWithoutDragged.findIndex(item => item.id === targetItemId)

      // Calculate the insertion point
      const insertIndex = position === 'above' ? targetIndex : targetIndex + 1

      // Insert the dragged item at the new position
      const reorderedItems = [
        ...itemsWithoutDragged.slice(0, insertIndex),
        draggedItem,
        ...itemsWithoutDragged.slice(insertIndex)
      ]

      // Assign new sort orders
      reorderedItems.forEach((item, index) => {
        const newSortOrder = (index + 1) * 10 // Use increments of 10 for easier future insertions
        if (item.sort_order !== newSortOrder) {
          updates.push({ id: item.id, sort_order: newSortOrder })
        }
      })

      // Apply updates in batch
      if (updates.length > 0) {
        for (const update of updates) {
          const { error } = await supabase
            .from('asset_list_items')
            .update({ sort_order: update.sort_order })
            .eq('id', update.id)

          if (error) throw error
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-list-items', list.id] })
      queryClient.invalidateQueries({ queryKey: ['asset-lists'] })
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
    } else if (targetItemId && targetItemId !== draggedItem && dragPosition) {
      // Handle reordering
      reorderItemsMutation.mutate({
        draggedItemId: draggedItem,
        targetItemId: targetItemId,
        position: dragPosition
      })
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

  // Column resizing functions
  const handleColumnResizeStart = (columnId: string, startX: number, startWidth: number) => {
    setResizingColumn(columnId)
    setResizeStartX(startX)
    setResizeStartWidth(startWidth)

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault()

      const deltaX = e.clientX - startX
      const newWidth = Math.max(50, startWidth + deltaX) // Minimum width of 50px

      if (columnId === 'company') {
        setCompanyColumnWidth(newWidth)
      } else {
        setTradingColumns(prev => prev.map(col =>
          col.id === columnId ? { ...col, width: newWidth } : col
        ))
      }
    }

    const handleMouseUp = (e: MouseEvent) => {
      e.preventDefault()
      setResizingColumn(null)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'default'
      document.body.style.userSelect = 'auto'
    }

    // Prevent text selection while resizing
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  // Column drag and drop functions
  const handleColumnDragStart = (e: React.DragEvent, columnId: string) => {
    // Don't allow dragging of ticker or company columns
    if (columnId === 'ticker' || columnId === 'company') {
      e.preventDefault()
      return
    }

    setDraggedColumn(columnId)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleColumnDragOver = (e: React.DragEvent, targetColumnId: string) => {
    e.preventDefault()
    if (!draggedColumn || draggedColumn === targetColumnId) return

    // Don't allow dropping before ticker or company columns
    if (targetColumnId === 'ticker' || targetColumnId === 'company') return

    setDraggedOverColumn(targetColumnId)
    e.dataTransfer.dropEffect = 'move'
  }

  const handleColumnDrop = (e: React.DragEvent, targetColumnId: string) => {
    e.preventDefault()
    if (!draggedColumn || draggedColumn === targetColumnId) return

    // Don't allow dropping before ticker or company columns
    if (targetColumnId === 'ticker' || targetColumnId === 'company') return

    const draggedIndex = tradingColumns.findIndex(col => col.id === draggedColumn)
    const targetIndex = tradingColumns.findIndex(col => col.id === targetColumnId)

    if (draggedIndex === -1 || targetIndex === -1) return

    const newColumns = [...tradingColumns]
    const [draggedCol] = newColumns.splice(draggedIndex, 1)
    newColumns.splice(targetIndex, 0, draggedCol)

    setTradingColumns(newColumns)
    setDraggedColumn(null)
    setDraggedOverColumn(null)
  }

  const handleColumnDragEnd = () => {
    setDraggedColumn(null)
    setDraggedOverColumn(null)
  }

  // Right-click context menu for columns
  const handleColumnRightClick = (e: React.MouseEvent, columnId: string, isFixedColumn: boolean = false) => {
    try {
      e.preventDefault()
      e.stopPropagation()

      // Validate inputs
      if (!columnId) {
        console.warn('handleColumnRightClick: columnId is required')
        return
      }

      // Close any existing context menus first
      setColumnContextMenu(null)

      // Set new context menu position with bounds checking
      const x = Math.min(e.clientX, window.innerWidth - 200) // Ensure menu doesn't go off-screen
      const y = Math.min(e.clientY, window.innerHeight - 300)

      setColumnContextMenu({
        columnId,
        x,
        y,
        isFixedColumn: Boolean(isFixedColumn)
      })
    } catch (error) {
      console.error('Error in handleColumnRightClick:', error)
      // Ensure context menu is closed on error
      setColumnContextMenu(null)
    }
  }

  // Close context menu
  const closeColumnContextMenu = () => {
    setColumnContextMenu(null)
    setEditingHeader(null)
  }

  // Handle column edit from context menu
  const handleEditColumn = (columnId: string) => {
    setEditingHeader(columnId)
    setHeaderInputValue('')
    closeColumnContextMenu()
  }

  // Handle column deletion from context menu
  const handleDeleteColumn = (columnId: string) => {
    setTradingColumns(prev => prev.filter(col => col.id !== columnId))
    closeColumnContextMenu()
  }

  // Click outside to close context menu
  React.useEffect(() => {
    const handleClickOutside = () => {
      if (columnContextMenu) {
        closeColumnContextMenu()
      }
    }

    if (columnContextMenu) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [columnContextMenu])


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
    setSortBy('sort_order')
    setSortOrder('asc')
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
    if (viewMode === 'trading') {
      setTradingColumns(tradingColumns.map(col =>
        col.id === columnId
          ? {
              ...col,
              field: field.field,
              label: field.label,
              align: 'left' as const,
              sortable: field.type === 'number' || field.type === 'text',
              sortKey: field.field.replace('assets.', '')
            }
          : col
      ))
    } else {
      updateColumnField(columnId, field.id)
    }
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
        </div>
        
        <div className="flex items-start space-x-3">
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
              Share{collaborators && collaborators.length > 0 && ` (${collaborators.length})`}
            </Button>
          )}
        </div>
      </div>

      {/* Search and Filters */}
      <Card>
        <div className="space-y-4">
          {/* Search Bar and Controls - Same Line */}
          <div className="flex items-center space-x-4">
            {/* AI-Powered Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search or filter with AI: 'AAPL', 'high priority tech stocks', 'under $50', 'added this week'..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            
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
                <button
                  onClick={() => setViewMode('trading')}
                  className={clsx(
                    'px-2 py-1 text-xs font-medium rounded transition-colors',
                    viewMode === 'trading'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  )}
                >
                  <TrendingUp className="h-3 w-3 mr-1" />
                  Trading
                </button>
              </div>
            </div>



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

                  {viewMode === 'trading' && (
                    <div className="px-4 py-2">
                      <h4 className="font-medium text-gray-900 mb-2">Trading Settings</h4>
                      <p className="text-sm text-gray-600">Ultra-compact view optimized for real-time financial data and maximum asset density</p>
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
                      <button
                        onClick={() => {
                          setViewMode('trading')
                          setShowColumnSettings(false)
                        }}
                        className={`flex items-center w-full px-2 py-1 text-sm rounded transition-colors ${
                          viewMode === 'trading' ? 'bg-primary-50 text-primary-700' : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <span>Trading View</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

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

          {viewMode === 'trading' && (
            <Card padding="none" className="overflow-x-auto">
              <table className="min-w-full">
                {/* Trading Table Header */}
                <thead className="bg-gray-900 text-white">
                  <tr>
                    {/* Fixed Ticker Column */}
                    <th
                      className="px-2 py-2 text-left text-xs font-medium uppercase tracking-wider relative"
                      style={{ width: '80px', minWidth: '80px' }}
                    >
                      <button
                        onClick={() => handleSort('symbol')}
                        className="flex items-center space-x-1 hover:text-gray-300 transition-colors"
                      >
                        <span>Ticker</span>
                        <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </th>

                    {/* Fixed Company Column */}
                    <th
                      className="px-2 py-2 text-left text-xs font-medium uppercase tracking-wider relative"
                      style={{ width: `${companyColumnWidth}px`, minWidth: `${companyColumnWidth}px` }}
                      onContextMenu={(e) => handleColumnRightClick(e, 'company', true)}
                    >
                      <div className="flex items-center justify-between">
                        <button
                          onClick={() => handleSort('company_name')}
                          className="flex items-center space-x-1 hover:text-gray-300 transition-colors"
                        >
                          <span>Company</span>
                          <ArrowUpDown className="h-3 w-3" />
                        </button>

                        {/* Resize handle */}
                        <div
                          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 opacity-0 hover:opacity-100 transition-opacity"
                          onMouseDown={(e) => handleColumnResizeStart('company', e.clientX, companyColumnWidth)}
                        />
                      </div>
                    </th>

                    {/* Dynamic Trading Columns */}
                    {visibleColumns.map((column, index) => (
                      <th
                        key={column.id}
                        className={clsx(
                          'px-2 py-2 text-xs font-medium uppercase tracking-wider relative select-none',
                          column.align === 'right' ? 'text-right' :
                          column.align === 'center' ? 'text-center' : 'text-left',
                          draggedOverColumn === column.id && 'bg-blue-600'
                        )}
                        style={{ width: `${column.width}px`, minWidth: `${column.width}px` }}
                        draggable
                        onDragStart={(e) => handleColumnDragStart(e, column.id)}
                        onDragOver={(e) => handleColumnDragOver(e, column.id)}
                        onDrop={(e) => handleColumnDrop(e, column.id)}
                        onDragEnd={handleColumnDragEnd}
                        onContextMenu={(e) => handleColumnRightClick(e, column.id, false)}
                      >
                        <div className="flex items-center justify-between">
                          <div className={clsx(
                            'flex items-center space-x-1',
                            column.align === 'right' && 'justify-end',
                            column.align === 'center' && 'justify-center'
                          )}>
                            {column.sortable && (
                              <button
                                onClick={() => handleSort(column.sortKey!)}
                                className="flex items-center space-x-1 hover:text-gray-300 transition-colors"
                              >
                                <span>{column.label}</span>
                                <ArrowUpDown className="h-3 w-3" />
                              </button>
                            )}
                            {!column.sortable && (
                              <span>{column.label}</span>
                            )}
                          </div>

                          {/* Resize handle */}
                          <div
                            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 opacity-0 hover:opacity-100 transition-opacity"
                            onMouseDown={(e) => {
                              e.preventDefault()
                              handleColumnResizeStart(column.id, e.clientX, column.width)
                            }}
                          />
                        </div>
                      </th>
                    ))}

                    {/* Add Column Button */}
                    <th className="px-2 py-2 w-8">
                      <button
                        onClick={() => {
                          const newColumnId = `col_${Date.now()}`
                          const newColumn = {
                            id: newColumnId,
                            label: 'New Column',
                            field: 'notes',
                            align: 'left' as const,
                            width: 100,
                            sortable: false
                          }
                          setTradingColumns([...tradingColumns, newColumn])
                          setEditingHeader(newColumnId)
                          setHeaderInputValue('')
                        }}
                        className="text-gray-400 hover:text-white transition-colors p-1 hover:bg-gray-700 rounded"
                        title="Add column"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </th>
                  </tr>
                </thead>

                {/* Trading Table Body */}
                <tbody className="bg-white divide-y divide-gray-100">
                  {filteredItems.map((item, index) => {
                    const quote = financialData?.[item.assets?.symbol || '']
                    const isPositive = quote ? quote.change >= 0 : null
                    const changeColor = isPositive === null ? 'text-gray-500' :
                                       isPositive ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'
                    const rowBg = isPositive === null ? '' :
                                 isPositive ? 'hover:bg-green-25' : 'hover:bg-red-25'

                    return (
                      <tr
                        key={item.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, item.id)}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, item.id)}
                        className={`${rowBg} hover:bg-gray-50 transition-colors text-xs border-l-2 ${
                          isPositive === null ? 'border-l-gray-200' :
                          isPositive ? 'border-l-green-400' : 'border-l-red-400'
                        }`}
                      >
                        {/* Ticker Symbol - Fixed width */}
                        <td
                          className="px-2 py-2"
                          style={{ width: '80px', minWidth: '80px' }}
                        >
                          <div className="flex items-center">
                            <GripVertical className="h-3 w-3 text-gray-400 mr-1 cursor-grab" />
                            <div className="font-bold text-gray-900 text-sm truncate">
                              {item.assets?.symbol || 'N/A'}
                            </div>
                          </div>
                        </td>

                        {/* Company Name - Fixed width */}
                        <td
                          className="px-2 py-2"
                          style={{ width: `${companyColumnWidth}px`, minWidth: `${companyColumnWidth}px` }}
                        >
                          <div className="text-xs text-gray-700 truncate" title={item.assets?.company_name || 'Unknown Company'}>
                            {item.assets?.company_name || 'Unknown Company'}
                          </div>
                        </td>

                        {/* Dynamic Columns - Variable width */}
                        {visibleColumns.map((column) => (
                          <td
                            key={column.id}
                            className={clsx(
                              'px-2 py-2 text-xs',
                              column.align === 'right' ? 'text-right' :
                              column.align === 'center' ? 'text-center' : 'text-left'
                            )}
                            style={{ width: `${column.width}px`, minWidth: `${column.width}px` }}
                          >
                            <div className="truncate">
                              {renderTradingCellValue(item, column, quote, changeColor)}
                            </div>
                          </td>
                        ))}

                        {/* Empty cell for add column button alignment */}
                        <td className="px-2 py-2 w-8"></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {/* Field Dropdown for Trading View - Positioned below header */}
              {editingHeader && viewMode === 'trading' && (
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
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          cancelEditingHeader()
                        } else if (e.key === 'Enter' && fieldSearchResults.length > 0) {
                          selectField(editingHeader, fieldSearchResults[0])
                        }
                      }}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      placeholder="Search for a field to display..."
                      autoFocus
                    />
                  </div>

                  {/* Field Results */}
                  <div className="max-h-48 overflow-y-auto">
                    {fieldSearchResults.map((field) => (
                      <button
                        key={field.id}
                        onClick={() => selectField(editingHeader, field)}
                        className="w-full px-3 py-2 text-left hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm font-medium text-gray-900">{field.label}</div>
                            <div className="text-xs text-gray-500">{field.category}</div>
                          </div>
                          <div className="text-xs text-gray-400">{field.type}</div>
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* Close Button */}
                  <div className="px-3 py-2 bg-gray-50 border-t border-gray-200">
                    <button
                      onClick={cancelEditingHeader}
                      className="text-sm text-gray-600 hover:text-gray-800"
                    >
                      Press ESC to close
                    </button>
                  </div>
                </div>
              )}

              {/* Trading Summary Footer */}
              <div className="bg-gray-900 text-white px-4 py-2 text-xs border-t">
                <div className="flex justify-between items-center">
                  <div className="flex items-center space-x-4">
                    <span>{filteredItems.length} assets</span>
                    <span>•</span>
                    <span className="flex items-center">
                      <span className="text-green-400 mr-1">▲</span>
                      {filteredItems.filter(item => {
                        const quote = financialData?.[item.assets?.symbol || '']
                        return quote && quote.change > 0
                      }).length} up
                    </span>
                    <span>•</span>
                    <span className="flex items-center">
                      <span className="text-red-400 mr-1">▼</span>
                      {filteredItems.filter(item => {
                        const quote = financialData?.[item.assets?.symbol || '']
                        return quote && quote.change < 0
                      }).length} down
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span>{financialDataLoading ? 'Updating...' : 'Live Data'}</span>
                    <span className={`inline-block w-2 h-2 rounded-full ${
                      financialDataLoading ? 'bg-yellow-400 animate-pulse' : 'bg-green-400 animate-pulse'
                    }`}></span>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* Column Context Menu */}
          {columnContextMenu && (
            <>
              {/* Click-outside overlay */}
              <div
                className="fixed inset-0 z-[10002]"
                onClick={() => setColumnContextMenu(null)}
              />
              <div
                className="fixed bg-white border border-gray-200 rounded-lg shadow-xl py-2 z-[10003] min-w-[160px]"
                style={{
                  left: columnContextMenu.x,
                  top: columnContextMenu.y,
                }}
                onClick={(e) => e.stopPropagation()}
                onMouseLeave={() => setColumnContextMenu(null)}
              >
                {!columnContextMenu.isFixedColumn ? (
                  <>
                    <button
                      onClick={() => {
                        try {
                          const column = tradingColumns.find(col => col.id === columnContextMenu.columnId)
                          if (column) {
                            setHeaderInputValue(column.label)
                            setEditingHeader(columnContextMenu.columnId)
                            setShowFieldDropdown(true)
                            setFieldSearchResults(availableFields)
                          }
                          setColumnContextMenu(null)
                        } catch (error) {
                          console.error('Error in Edit Column:', error)
                          setColumnContextMenu(null)
                        }
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                    >
                      Edit Column
                    </button>
                    <button
                      onClick={() => {
                        try {
                          setTradingColumns(tradingColumns.filter(col => col.id !== columnContextMenu.columnId))
                          setColumnContextMenu(null)
                        } catch (error) {
                          console.error('Error in Remove Column:', error)
                          setColumnContextMenu(null)
                        }
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 transition-colors"
                    >
                      Remove Column
                    </button>
                  </>
                ) : (
                  <div className="px-4 py-2 text-sm text-gray-500">
                    Fixed column cannot be edited
                  </div>
                )}
              </div>
            </>
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