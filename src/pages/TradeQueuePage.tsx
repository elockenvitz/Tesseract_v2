import { useState, useMemo, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  Search,
  ArrowUpDown,
  TrendingUp,
  TrendingDown,
  MessageSquare,
  ThumbsUp,
  ThumbsDown,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  PlayCircle,
  GripVertical,
  Archive,
  Lightbulb,
  FlaskConical,
  History,
  FileText,
  ExternalLink,
  Maximize2,
  Minimize2,
  ChevronDown,
  User,
  Calendar,
  Briefcase,
  Link2,
  Scale,
  Wrench,
  MoreVertical,
  Trash2,
  Circle
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Input } from '../components/ui/Input'
import { EmptyState } from '../components/common/EmptyState'
import { ListSkeleton } from '../components/common/LoadingSkeleton'
import { AddTradeIdeaModal } from '../components/trading/AddTradeIdeaModal'
import { TradeIdeaDetailModal } from '../components/trading/TradeIdeaDetailModal'
import type {
  TradeQueueItemWithDetails,
  TradeQueueStatus,
  TradeAction,
  TradeUrgency,
  TradeQueueFilters,
  PairTradeWithDetails
} from '../types/trading'
import { clsx } from 'clsx'

const STATUS_CONFIG: Record<TradeQueueStatus, { label: string; color: string; icon: React.ElementType }> = {
  idea: { label: 'Ideas', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300', icon: Lightbulb },
  discussing: { label: 'Working On', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300', icon: Wrench },
  simulating: { label: 'Simulating', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300', icon: FlaskConical },
  deciding: { label: 'Deciding', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300', icon: Scale },
  approved: { label: 'Approved', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300', icon: CheckCircle2 },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300', icon: XCircle },
  cancelled: { label: 'Cancelled', color: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300', icon: XCircle },
  deleted: { label: 'Deleted', color: 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400', icon: Archive },
}

const ACTION_CONFIG: Record<TradeAction, { label: string; color: string; icon: React.ElementType }> = {
  buy: { label: 'Buy', color: 'text-green-600 dark:text-green-400', icon: TrendingUp },
  sell: { label: 'Sell', color: 'text-red-600 dark:text-red-400', icon: TrendingDown },
  add: { label: 'Add', color: 'text-green-600 dark:text-green-400', icon: TrendingUp },
  trim: { label: 'Trim', color: 'text-orange-600 dark:text-orange-400', icon: TrendingDown },
}

const URGENCY_CONFIG: Record<TradeUrgency, { label: string; color: string }> = {
  low: { label: 'Low', color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  medium: { label: 'Medium', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  high: { label: 'High', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
  urgent: { label: 'Urgent', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
}

export function TradeQueuePage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // UI State
  const [filters, setFilters] = useState<TradeQueueFilters>({
    status: 'all',
    urgency: 'all',
    action: 'all',
    portfolio_id: 'all',
    search: ''
  })
  const [sortBy, setSortBy] = useState<'created_at' | 'urgency' | 'priority'>('created_at')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [showAddModal, setShowAddModal] = useState(false)
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null)
  const [draggedItem, setDraggedItem] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [activeSection, setActiveSection] = useState<'idea-pipeline' | 'pretrade' | 'post-trade'>('idea-pipeline')
  const [fourthColumnView, setFourthColumnView] = useState<'deciding' | 'approved' | 'rejected' | 'archived' | 'deleted'>('deciding')
  const [fullscreenColumn, setFullscreenColumn] = useState<TradeQueueStatus | 'archived' | null>(null)
  const [showDeletedConfirm, setShowDeletedConfirm] = useState(false)
  const [showOverflowMenu, setShowOverflowMenu] = useState(false)

  // Fetch trade queue items
  const { data: tradeItems, isLoading, error } = useQuery({
    queryKey: ['trade-queue-items'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trade_queue_items')
        .select(`
          *,
          assets (id, symbol, company_name, sector),
          portfolios (id, name, portfolio_id),
          users:created_by (id, email, first_name, last_name),
          trade_queue_comments (id),
          trade_queue_votes (id, vote),
          pair_trades (id, name, description, rationale, thesis_summary, urgency, status)
        `)
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false })

      if (error) throw error

      // Calculate vote summaries
      return (data || []).map(item => ({
        ...item,
        vote_summary: {
          approve: item.trade_queue_votes?.filter((v: any) => v.vote === 'approve').length || 0,
          reject: item.trade_queue_votes?.filter((v: any) => v.vote === 'reject').length || 0,
          needs_discussion: item.trade_queue_votes?.filter((v: any) => v.vote === 'needs_discussion').length || 0,
        }
      })) as TradeQueueItemWithDetails[]
    },
  })

  // Fetch pair trades with their legs
  const { data: pairTrades } = useQuery({
    queryKey: ['pair-trades'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pair_trades')
        .select(`
          *,
          portfolios (id, name, portfolio_id),
          users:created_by (id, email, first_name, last_name),
          trade_queue_items (
            id, asset_id, action, proposed_shares, proposed_weight, target_price,
            pair_leg_type, status,
            assets (id, symbol, company_name, sector)
          )
        `)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data as PairTradeWithDetails[]
    },
  })

  // Fetch portfolios for filter dropdown
  const { data: portfolios } = useQuery({
    queryKey: ['portfolios-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolios')
        .select('id, name, portfolio_id')
        .order('name')

      if (error) throw error
      return data
    },
  })

  // Fetch simulations with their linked trade queue items (for pretrade section)
  const { data: simulations } = useQuery({
    queryKey: ['simulations-with-trades'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('simulations')
        .select(`
          *,
          portfolios (id, name, portfolio_id),
          users:created_by (id, email, first_name, last_name),
          simulation_trades (
            id,
            trade_queue_item_id,
            asset_id,
            action,
            shares,
            weight,
            price,
            assets (id, symbol, company_name, sector)
          )
        `)
        .in('status', ['draft', 'running'])
        .order('created_at', { ascending: false })

      if (error) throw error
      return data
    },
  })

  // Fetch executed trades for post-trade section
  const { data: executedTrades } = useQuery({
    queryKey: ['executed-trades'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trade_queue_items')
        .select(`
          *,
          assets (id, symbol, company_name, sector),
          portfolios (id, name, portfolio_id),
          users:created_by (id, email, first_name, last_name),
          approved_user:approved_by (id, email, first_name, last_name),
          trade_queue_comments (id, content, created_at, users:user_id (id, email, first_name, last_name))
        `)
        .eq('status', 'executed')
        .order('executed_at', { ascending: false })
        .limit(50)

      if (error) throw error
      return data
    },
  })

  // Update trade item priority mutation
  const updatePriorityMutation = useMutation({
    mutationFn: async ({ id, priority }: { id: string; priority: number }) => {
      const { error } = await supabase
        .from('trade_queue_items')
        .update({ priority })
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
    },
  })

  // Archived statuses
  const archivedStatuses: TradeQueueStatus[] = ['executed', 'rejected', 'cancelled']

  // Filter and sort items (excluding archived)
  const filteredItems = useMemo(() => {
    if (!tradeItems) return []

    return tradeItems
      .filter(item => {
        // Exclude archived and deleted items from main view
        if (archivedStatuses.includes(item.status)) return false
        if (item.status === 'deleted') return false
        if (filters.status && filters.status !== 'all' && item.status !== filters.status) return false
        if (filters.urgency && filters.urgency !== 'all' && item.urgency !== filters.urgency) return false
        if (filters.action && filters.action !== 'all' && item.action !== filters.action) return false
        if (filters.portfolio_id && filters.portfolio_id !== 'all' && item.portfolio_id !== filters.portfolio_id) return false
        if (filters.search) {
          const search = filters.search.toLowerCase()
          const matchesSymbol = item.assets?.symbol?.toLowerCase().includes(search)
          const matchesCompany = item.assets?.company_name?.toLowerCase().includes(search)
          const matchesRationale = item.rationale?.toLowerCase().includes(search)
          if (!matchesSymbol && !matchesCompany && !matchesRationale) return false
        }
        return true
      })
      .sort((a, b) => {
        const order = sortOrder === 'asc' ? 1 : -1
        if (sortBy === 'created_at') {
          return order * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        }
        if (sortBy === 'urgency') {
          const urgencyOrder = { urgent: 4, high: 3, medium: 2, low: 1 }
          return order * (urgencyOrder[a.urgency] - urgencyOrder[b.urgency])
        }
        if (sortBy === 'priority') {
          return order * (a.priority - b.priority)
        }
        return 0
      })
  }, [tradeItems, filters, sortBy, sortOrder])

  // Archived items (separate from active)
  const archivedItems = useMemo(() => {
    if (!tradeItems) return []
    return tradeItems.filter(item => archivedStatuses.includes(item.status))
  }, [tradeItems])

  // Deleted items (soft-deleted trade ideas)
  const deletedItems = useMemo(() => {
    if (!tradeItems) return []
    return tradeItems.filter(item => item.status === 'deleted')
  }, [tradeItems])

  // Pretrade items - approved items that are linked to simulations
  const pretradeItems = useMemo(() => {
    if (!tradeItems || !simulations) return []

    // Get all trade_queue_item_ids that are in simulations
    const tradeIdsInSimulations = new Set<string>()
    simulations.forEach(sim => {
      sim.simulation_trades?.forEach((trade: any) => {
        if (trade.trade_queue_item_id) {
          tradeIdsInSimulations.add(trade.trade_queue_item_id)
        }
      })
    })

    // Return approved items that are in simulations
    return tradeItems.filter(item =>
      item.status === 'approved' && tradeIdsInSimulations.has(item.id)
    )
  }, [tradeItems, simulations])

  // Get simulation info for a trade queue item
  const getSimulationForTrade = useCallback((tradeId: string) => {
    if (!simulations) return null
    return simulations.find(sim =>
      sim.simulation_trades?.some((trade: any) => trade.trade_queue_item_id === tradeId)
    )
  }, [simulations])

  // Group pair trade items by pair_trade_id
  const pairTradeGroups = useMemo(() => {
    if (!filteredItems) return new Map<string, { pairTrade: any; legs: TradeQueueItemWithDetails[] }>()

    const groups = new Map<string, { pairTrade: any; legs: TradeQueueItemWithDetails[] }>()

    filteredItems.forEach(item => {
      if (item.pair_trade_id && item.pair_trades) {
        if (!groups.has(item.pair_trade_id)) {
          groups.set(item.pair_trade_id, {
            pairTrade: item.pair_trades,
            legs: []
          })
        }
        groups.get(item.pair_trade_id)!.legs.push(item)
      }
    })

    return groups
  }, [filteredItems])

  // Get IDs of items that are part of pair trades (to exclude from individual display)
  const pairTradeItemIds = useMemo(() => {
    const ids = new Set<string>()
    pairTradeGroups.forEach(group => {
      group.legs.forEach(leg => ids.add(leg.id))
    })
    return ids
  }, [pairTradeGroups])

  // Group items by status for kanban-like view (excluding individual pair trade legs)
  const itemsByStatus = useMemo(() => {
    const groups: Record<TradeQueueStatus, TradeQueueItemWithDetails[]> = {
      idea: [],
      discussing: [],
      simulating: [],
      deciding: [],
      approved: [],
      rejected: [],
      cancelled: [],
      deleted: [],
    }

    filteredItems.forEach(item => {
      // Skip items that are part of pair trades - they'll be shown as grouped cards
      if (pairTradeItemIds.has(item.id)) return
      groups[item.status].push(item)
    })

    return groups
  }, [filteredItems, pairTradeItemIds])

  // Group pair trades by status (based on the pair_trade's status)
  const pairTradesByStatus = useMemo(() => {
    const groups: Record<TradeQueueStatus, Array<{ pairTradeId: string; pairTrade: any; legs: TradeQueueItemWithDetails[] }>> = {
      idea: [],
      discussing: [],
      simulating: [],
      deciding: [],
      approved: [],
      rejected: [],
      cancelled: [],
      deleted: [],
    }

    pairTradeGroups.forEach((group, pairTradeId) => {
      const status = group.pairTrade.status as TradeQueueStatus
      if (groups[status]) {
        groups[status].push({ pairTradeId, ...group })
      }
    })

    return groups
  }, [pairTradeGroups])

  // Drag handlers - use dataTransfer to pass the item ID reliably
  const handleDragStart = useCallback((e: React.DragEvent, itemId: string) => {
    e.dataTransfer.setData('text/plain', itemId)
    e.dataTransfer.setData('type', 'item')
    e.dataTransfer.effectAllowed = 'move'
    setDraggedItem(itemId)
  }, [])

  // Drag handler for pair trade cards
  const handlePairTradeDragStart = useCallback((e: React.DragEvent, pairTradeId: string) => {
    e.dataTransfer.setData('text/plain', pairTradeId)
    e.dataTransfer.setData('type', 'pair-trade')
    e.dataTransfer.effectAllowed = 'move'
    setDraggedItem(pairTradeId)
  }, [])

  const handleDragEnd = useCallback(() => {
    setDraggedItem(null)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent, targetStatus: TradeQueueStatus) => {
    e.preventDefault()

    // Get the item ID and type from dataTransfer
    const itemId = e.dataTransfer.getData('text/plain')
    const dragType = e.dataTransfer.getData('type')
    console.log('Drop event - itemId:', itemId, 'type:', dragType, 'targetStatus:', targetStatus)

    if (!itemId) {
      console.error('No item ID found in dataTransfer')
      setDraggedItem(null)
      return
    }

    // Handle pair trade drag - update all legs AND the pair_trades record
    if (dragType === 'pair-trade') {
      const pairTradeGroup = pairTradeGroups.get(itemId)
      if (!pairTradeGroup) {
        console.error('Pair trade group not found')
        setDraggedItem(null)
        return
      }

      if (pairTradeGroup.pairTrade.status === targetStatus) {
        console.log('Pair trade already has target status, skipping update')
        setDraggedItem(null)
        return
      }

      console.log('Updating pair trade and all legs to status:', targetStatus)

      // Update the pair_trades record status
      const { error: pairError } = await supabase
        .from('pair_trades')
        .update({ status: targetStatus })
        .eq('id', itemId)

      if (pairError) {
        console.error('Error updating pair trade status:', pairError)
      }

      // Update all legs
      const legIds = pairTradeGroup.legs.map(leg => leg.id)
      const { error: legsError } = await supabase
        .from('trade_queue_items')
        .update({ status: targetStatus })
        .in('id', legIds)

      if (legsError) {
        console.error('Error updating pair trade leg statuses:', legsError)
      }

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      queryClient.invalidateQueries({ queryKey: ['pair-trades'] })
      setDraggedItem(null)
      return
    }

    // Handle individual item drag
    const item = tradeItems?.find(i => i.id === itemId)
    console.log('Found item:', item?.assets?.symbol, 'current status:', item?.status)

    if (!item) {
      console.error('Item not found in tradeItems')
      setDraggedItem(null)
      return
    }

    if (item.status === targetStatus) {
      console.log('Item already has target status, skipping update')
      setDraggedItem(null)
      return
    }

    console.log('Updating status from', item.status, 'to', targetStatus)

    // Update status via direct supabase call
    const { error, data } = await supabase
      .from('trade_queue_items')
      .update({ status: targetStatus })
      .eq('id', itemId)
      .select()

    if (error) {
      console.error('Error updating trade status:', error)
    } else {
      console.log('Status updated successfully:', data)
      // Invalidate both the list query and the individual item query
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-item', itemId] })
    }

    setDraggedItem(null)
  }, [tradeItems, pairTradeGroups, queryClient])

  const handleSort = useCallback((field: typeof sortBy) => {
    if (sortBy === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortOrder('desc')
    }
  }, [sortBy])

  // ESC key handler for fullscreen mode
  useEffect(() => {
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && fullscreenColumn) {
        setFullscreenColumn(null)
      }
    }

    document.addEventListener('keydown', handleEscKey)
    return () => document.removeEventListener('keydown', handleEscKey)
  }, [fullscreenColumn])

  if (isLoading) {
    return (
      <div className="p-6">
        <ListSkeleton count={5} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <Card className="p-6">
          <p className="text-red-600 dark:text-red-400">Error loading trade queue: {(error as Error).message}</p>
        </Card>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Trade Queue</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Collaborate on trade ideas and run simulations
            </p>
          </div>
          <Button onClick={() => setShowAddModal(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Trade Idea
          </Button>
        </div>

        {/* Pipeline Section Tabs */}
        <div className="flex items-center gap-1 mb-4 p-1 bg-gray-100 dark:bg-gray-700/50 rounded-lg w-fit">
          <button
            onClick={() => setActiveSection('idea-pipeline')}
            className={clsx(
              "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all",
              activeSection === 'idea-pipeline'
                ? "bg-white dark:bg-gray-800 text-primary-600 dark:text-primary-400 shadow-sm"
                : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            )}
          >
            <Lightbulb className="h-4 w-4" />
            Idea Pipeline
            <Badge variant="secondary" className="text-xs ml-1">
              {filteredItems.length}
            </Badge>
          </button>
          <button
            onClick={() => setActiveSection('pretrade')}
            className={clsx(
              "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all",
              activeSection === 'pretrade'
                ? "bg-white dark:bg-gray-800 text-primary-600 dark:text-primary-400 shadow-sm"
                : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            )}
          >
            <FlaskConical className="h-4 w-4" />
            Pretrade
            <Badge variant="secondary" className="text-xs ml-1">
              {itemsByStatus.simulating.length}
            </Badge>
          </button>
          <button
            onClick={() => setActiveSection('post-trade')}
            className={clsx(
              "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all",
              activeSection === 'post-trade'
                ? "bg-white dark:bg-gray-800 text-primary-600 dark:text-primary-400 shadow-sm"
                : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            )}
          >
            <History className="h-4 w-4" />
            Post Trade
            <Badge variant="secondary" className="text-xs ml-1">
              {executedTrades?.length || 0}
            </Badge>
          </button>
        </div>

        {/* Filters - only show for idea pipeline */}
        {activeSection === 'idea-pipeline' && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search trades..."
              value={filters.search || ''}
              onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
              className="pl-10"
            />
          </div>

          <select
            value={filters.status || 'all'}
            onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value as TradeQueueStatus | 'all' }))}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          >
            <option value="all">All Statuses</option>
            {Object.entries(STATUS_CONFIG).map(([key, config]) => (
              <option key={key} value={key}>{config.label}</option>
            ))}
          </select>

          <select
            value={filters.action || 'all'}
            onChange={(e) => setFilters(prev => ({ ...prev, action: e.target.value as TradeAction | 'all' }))}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          >
            <option value="all">All Actions</option>
            {Object.entries(ACTION_CONFIG).map(([key, config]) => (
              <option key={key} value={key}>{config.label}</option>
            ))}
          </select>

          <select
            value={filters.urgency || 'all'}
            onChange={(e) => setFilters(prev => ({ ...prev, urgency: e.target.value as TradeUrgency | 'all' }))}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          >
            <option value="all">All Urgency</option>
            {Object.entries(URGENCY_CONFIG).map(([key, config]) => (
              <option key={key} value={key}>{config.label}</option>
            ))}
          </select>

          <select
            value={filters.portfolio_id || 'all'}
            onChange={(e) => setFilters(prev => ({ ...prev, portfolio_id: e.target.value }))}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          >
            <option value="all">All Portfolios</option>
            {portfolios?.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          <button
            onClick={() => handleSort('created_at')}
            className={clsx(
              "flex items-center gap-1 px-3 py-2 text-sm rounded-lg border transition-colors",
              sortBy === 'created_at'
                ? "border-primary-500 text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20"
                : "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
            )}
          >
            <Clock className="h-4 w-4" />
            Date
            <ArrowUpDown className="h-3 w-3" />
          </button>

          <button
            onClick={() => handleSort('urgency')}
            className={clsx(
              "flex items-center gap-1 px-3 py-2 text-sm rounded-lg border transition-colors",
              sortBy === 'urgency'
                ? "border-primary-500 text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20"
                : "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
            )}
          >
            <AlertCircle className="h-4 w-4" />
            Urgency
            <ArrowUpDown className="h-3 w-3" />
          </button>
        </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {/* IDEA PIPELINE SECTION */}
        {activeSection === 'idea-pipeline' && (
          <>
            {filteredItems.length === 0 && deletedItems.length === 0 && archivedItems.length === 0 ? (
              <EmptyState
                icon={TrendingUp}
                title="No trade ideas yet"
                description="Add your first trade idea to start collaborating with your team"
                action={
                  <Button onClick={() => setShowAddModal(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Trade Idea
                  </Button>
                }
              />
            ) : (
              <>
                {/* Kanban Grid - shows either 4 columns or 1 fullscreen column */}
                <div className={clsx(
                  "gap-4",
                  fullscreenColumn ? "grid grid-cols-1" : "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4"
                )}>
                  {/* Ideas Column */}
                  {(!fullscreenColumn || fullscreenColumn === 'idea') && (
                  <div
                    className="flex flex-col"
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, 'idea')}
                  >
                    <div className="flex items-center gap-2 mb-3 px-2">
                      <Lightbulb className="h-5 w-5 text-blue-500" />
                      <h2 className="font-semibold text-gray-900 dark:text-white">Ideas</h2>
                      <Badge variant="default" className="ml-auto">
                        {itemsByStatus.idea.length + pairTradesByStatus.idea.length}
                      </Badge>
                      <button
                        onClick={() => setFullscreenColumn(fullscreenColumn === 'idea' ? null : 'idea')}
                        className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                        title={fullscreenColumn === 'idea' ? "Exit fullscreen" : "Fullscreen"}
                      >
                        {fullscreenColumn === 'idea' ? (
                          <Minimize2 className="h-4 w-4 text-gray-400" />
                        ) : (
                          <Maximize2 className="h-4 w-4 text-gray-400" />
                        )}
                      </button>
                    </div>
                    <div className={clsx(
                      "flex-1 rounded-lg border-2 border-dashed p-2 transition-colors",
                      fullscreenColumn === 'idea' ? "min-h-[400px]" : "min-h-[200px]",
                      draggedItem
                        ? "border-primary-300 dark:border-primary-700 bg-primary-50/50 dark:bg-primary-900/10"
                        : "border-gray-200 dark:border-gray-700"
                    )}>
                      <div className={clsx(
                        "gap-2",
                        fullscreenColumn === 'idea'
                          ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                          : "space-y-2"
                      )}>
                        {/* Pair Trade Cards */}
                        {pairTradesByStatus.idea.map(({ pairTradeId, pairTrade, legs }) => (
                          <PairTradeCard
                            key={pairTradeId}
                            pairTradeId={pairTradeId}
                            pairTrade={pairTrade}
                            legs={legs}
                            isDragging={draggedItem === pairTradeId}
                            onDragStart={(e) => handlePairTradeDragStart(e, pairTradeId)}
                            onDragEnd={handleDragEnd}
                            onPairClick={(pairId) => setSelectedTradeId(pairId)}
                          />
                        ))}
                        {/* Individual Trade Cards */}
                        {itemsByStatus.idea.map(item => (
                          <TradeQueueCard
                            key={item.id}
                            item={item}
                            isDragging={draggedItem === item.id}
                            onDragStart={(e) => handleDragStart(e, item.id)}
                            onDragEnd={handleDragEnd}
                            onClick={() => setSelectedTradeId(item.id)}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                  )}

                  {/* Working On Column */}
                  {(!fullscreenColumn || fullscreenColumn === 'discussing') && (
                  <div
                    className="flex flex-col"
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, 'discussing')}
                  >
                    <div className="flex items-center gap-2 mb-3 px-2">
                      <Wrench className="h-5 w-5 text-yellow-500" />
                      <h2 className="font-semibold text-gray-900 dark:text-white">Working On</h2>
                      <Badge variant="default" className="ml-auto">
                        {itemsByStatus.discussing.length + pairTradesByStatus.discussing.length}
                      </Badge>
                      <button
                        onClick={() => setFullscreenColumn(fullscreenColumn === 'discussing' ? null : 'discussing')}
                        className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                        title={fullscreenColumn === 'discussing' ? "Exit fullscreen" : "Fullscreen"}
                      >
                        {fullscreenColumn === 'discussing' ? (
                          <Minimize2 className="h-4 w-4 text-gray-400" />
                        ) : (
                          <Maximize2 className="h-4 w-4 text-gray-400" />
                        )}
                      </button>
                    </div>
                    <div className={clsx(
                      "flex-1 rounded-lg border-2 border-dashed p-2 transition-colors",
                      fullscreenColumn === 'discussing' ? "min-h-[400px]" : "min-h-[200px]",
                      draggedItem
                        ? "border-primary-300 dark:border-primary-700 bg-primary-50/50 dark:bg-primary-900/10"
                        : "border-gray-200 dark:border-gray-700"
                    )}>
                      <div className={clsx(
                        "gap-2",
                        fullscreenColumn === 'discussing'
                          ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                          : "space-y-2"
                      )}>
                        {/* Pair Trade Cards */}
                        {pairTradesByStatus.discussing.map(({ pairTradeId, pairTrade, legs }) => (
                          <PairTradeCard
                            key={pairTradeId}
                            pairTradeId={pairTradeId}
                            pairTrade={pairTrade}
                            legs={legs}
                            isDragging={draggedItem === pairTradeId}
                            onDragStart={(e) => handlePairTradeDragStart(e, pairTradeId)}
                            onDragEnd={handleDragEnd}
                            onPairClick={(pairId) => setSelectedTradeId(pairId)}
                          />
                        ))}
                        {/* Individual Trade Cards */}
                        {itemsByStatus.discussing.map(item => (
                          <TradeQueueCard
                            key={item.id}
                            item={item}
                            isDragging={draggedItem === item.id}
                            onDragStart={(e) => handleDragStart(e, item.id)}
                            onDragEnd={handleDragEnd}
                            onClick={() => setSelectedTradeId(item.id)}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                  )}

                  {/* Simulating Column */}
                  {(!fullscreenColumn || fullscreenColumn === 'simulating') && (
                  <div
                    className="flex flex-col"
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, 'simulating')}
                  >
                    <div className="flex items-center gap-2 mb-3 px-2">
                      <FlaskConical className="h-5 w-5 text-purple-500" />
                      <h2 className="font-semibold text-gray-900 dark:text-white">Simulating</h2>
                      <Badge variant="default" className="ml-auto">
                        {itemsByStatus.simulating.length + pairTradesByStatus.simulating.length}
                      </Badge>
                      <button
                        onClick={() => setFullscreenColumn(fullscreenColumn === 'simulating' ? null : 'simulating')}
                        className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                        title={fullscreenColumn === 'simulating' ? "Exit fullscreen" : "Fullscreen"}
                      >
                        {fullscreenColumn === 'simulating' ? (
                          <Minimize2 className="h-4 w-4 text-gray-400" />
                        ) : (
                          <Maximize2 className="h-4 w-4 text-gray-400" />
                        )}
                      </button>
                    </div>
                    <div className={clsx(
                      "flex-1 rounded-lg border-2 border-dashed p-2 transition-colors",
                      fullscreenColumn === 'simulating' ? "min-h-[400px]" : "min-h-[200px]",
                      draggedItem
                        ? "border-primary-300 dark:border-primary-700 bg-primary-50/50 dark:bg-primary-900/10"
                        : "border-gray-200 dark:border-gray-700"
                    )}>
                      <div className={clsx(
                        "gap-2",
                        fullscreenColumn === 'simulating'
                          ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                          : "space-y-2"
                      )}>
                        {/* Pair Trade Cards */}
                        {pairTradesByStatus.simulating.map(({ pairTradeId, pairTrade, legs }) => (
                          <PairTradeCard
                            key={pairTradeId}
                            pairTradeId={pairTradeId}
                            pairTrade={pairTrade}
                            legs={legs}
                            isDragging={draggedItem === pairTradeId}
                            onDragStart={(e) => handlePairTradeDragStart(e, pairTradeId)}
                            onDragEnd={handleDragEnd}
                            onPairClick={(pairId) => setSelectedTradeId(pairId)}
                          />
                        ))}
                        {/* Individual Trade Cards */}
                        {itemsByStatus.simulating.map(item => (
                          <TradeQueueCard
                            key={item.id}
                            item={item}
                            isDragging={draggedItem === item.id}
                            onDragStart={(e) => handleDragStart(e, item.id)}
                            onDragEnd={handleDragEnd}
                            onClick={() => setSelectedTradeId(item.id)}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                  )}

                  {/* Fourth Column - Deciding (Active) + Outcomes (History) */}
                  {(!fullscreenColumn || fullscreenColumn === 'deciding' || fullscreenColumn === 'archived') && (
                  <div
                    className="flex flex-col"
                    onDragOver={handleDragOver}
                    onDrop={(e) => {
                      if (fourthColumnView === 'deciding') handleDrop(e, 'deciding')
                      else if (fourthColumnView === 'rejected') handleDrop(e, 'rejected')
                    }}
                  >
                    <div className={clsx(
                      "flex items-center gap-2 mb-3 px-2 py-1 rounded-t-lg transition-colors",
                      fourthColumnView !== 'deciding' && "bg-gray-50 dark:bg-gray-800/50"
                    )}>
                      {/* Icon changes based on view */}
                      {fourthColumnView === 'deciding' && <Scale className="h-5 w-5 text-amber-500" />}
                      {fourthColumnView === 'approved' && <CheckCircle2 className="h-5 w-5 text-green-500" />}
                      {fourthColumnView === 'rejected' && <XCircle className="h-5 w-5 text-gray-400" />}
                      {fourthColumnView === 'archived' && <Archive className="h-5 w-5 text-gray-400" />}
                      {fourthColumnView === 'deleted' && <Trash2 className="h-5 w-5 text-gray-400" />}

                      {/* Dropdown Toggle with grouped options */}
                      <div className="relative group">
                        <button className={clsx(
                          "flex items-center gap-1.5 font-semibold transition-colors",
                          fourthColumnView === 'deciding'
                            ? "text-gray-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400"
                            : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                        )}>
                          {/* Header title changes based on view */}
                          {fourthColumnView === 'deciding' ? (
                            <>
                              Deciding
                              <span className="ml-1 px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded">
                                Active
                              </span>
                            </>
                          ) : (
                            <>
                              {fourthColumnView === 'approved' ? 'Approved' : fourthColumnView === 'rejected' ? 'Rejected' : fourthColumnView === 'archived' ? 'Archived' : 'Deleted'}
                              <span className="ml-1 px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 rounded flex items-center gap-0.5">
                                <History className="h-2.5 w-2.5" />
                                History
                              </span>
                            </>
                          )}
                          <ChevronDown className="h-4 w-4" />
                        </button>

                        {/* Restructured dropdown with groups */}
                        <div className="absolute left-0 top-full mt-1 w-56 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
                          {/* Active Stage Group */}
                          <div className="px-2 pt-2 pb-1">
                            <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                              Stage (Active)
                            </span>
                          </div>
                          <button
                            onClick={() => setFourthColumnView('deciding')}
                            className={clsx(
                              "w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-700",
                              fourthColumnView === 'deciding' && "bg-amber-50 dark:bg-amber-900/20"
                            )}
                            title="Active items awaiting a decision"
                          >
                            <div className="flex items-center gap-2 flex-1">
                              {fourthColumnView === 'deciding' && (
                                <Circle className="h-2 w-2 fill-amber-500 text-amber-500" />
                              )}
                              <Scale className={clsx("h-4 w-4", fourthColumnView === 'deciding' ? "text-amber-600" : "text-gray-400")} />
                              <span className={fourthColumnView === 'deciding' ? "font-medium text-amber-700 dark:text-amber-400" : ""}>Deciding</span>
                            </div>
                            <Badge variant="secondary" className="text-xs">{itemsByStatus.deciding.length + pairTradesByStatus.deciding.length}</Badge>
                          </button>

                          {/* Divider */}
                          <div className="my-1 border-t border-gray-100 dark:border-gray-700" />

                          {/* Outcomes Group */}
                          <div className="px-2 pt-1 pb-1 flex items-center gap-1">
                            <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                              Outcomes
                            </span>
                            <History className="h-3 w-3 text-gray-400" />
                          </div>
                          <button
                            onClick={() => setFourthColumnView('approved')}
                            className={clsx(
                              "w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-700",
                              fourthColumnView === 'approved' && "bg-gray-100 dark:bg-gray-700"
                            )}
                            title="Trade ideas that were approved"
                          >
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                            <span className={fourthColumnView === 'approved' ? "font-medium" : "text-gray-600 dark:text-gray-300"}>Approved</span>
                            <Badge variant="secondary" className="text-xs ml-auto">{itemsByStatus.approved.length + pairTradesByStatus.approved.length}</Badge>
                          </button>
                          <button
                            onClick={() => setFourthColumnView('rejected')}
                            className={clsx(
                              "w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-700",
                              fourthColumnView === 'rejected' && "bg-gray-100 dark:bg-gray-700"
                            )}
                            title="Reviewed and decided against"
                          >
                            <XCircle className="h-4 w-4 text-red-400" />
                            <span className={fourthColumnView === 'rejected' ? "font-medium" : "text-gray-600 dark:text-gray-300"}>Rejected</span>
                            <Badge variant="secondary" className="text-xs ml-auto">{itemsByStatus.rejected.length + pairTradesByStatus.rejected.length}</Badge>
                          </button>
                          <button
                            onClick={() => setFourthColumnView('archived')}
                            className={clsx(
                              "w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-700 rounded-b-lg",
                              fourthColumnView === 'archived' && "bg-gray-100 dark:bg-gray-700"
                            )}
                            title="Not pursuing right now"
                          >
                            <Archive className="h-4 w-4 text-gray-400" />
                            <span className={fourthColumnView === 'archived' ? "font-medium" : "text-gray-600 dark:text-gray-300"}>Archived</span>
                            <Badge variant="secondary" className="text-xs ml-auto">{archivedItems.length}</Badge>
                          </button>
                        </div>
                      </div>

                      {/* Item count badge */}
                      <Badge variant="default" className="ml-auto">
                        {fourthColumnView === 'deciding'
                          ? itemsByStatus.deciding.length + pairTradesByStatus.deciding.length
                          : fourthColumnView === 'approved'
                            ? itemsByStatus.approved.length + pairTradesByStatus.approved.length
                            : fourthColumnView === 'rejected'
                              ? itemsByStatus.rejected.length + pairTradesByStatus.rejected.length
                              : fourthColumnView === 'archived'
                                ? archivedItems.length
                                : deletedItems.length}
                      </Badge>

                      {/* Fullscreen button */}
                      <button
                        onClick={() => setFullscreenColumn(fullscreenColumn === 'deciding' ? null : 'deciding')}
                        className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                        title={fullscreenColumn === 'deciding' ? "Exit fullscreen" : "Fullscreen"}
                      >
                        {fullscreenColumn === 'deciding' ? (
                          <Minimize2 className="h-4 w-4 text-gray-400" />
                        ) : (
                          <Maximize2 className="h-4 w-4 text-gray-400" />
                        )}
                      </button>

                      {/* Overflow menu for Deleted */}
                      <div className="relative">
                        <button
                          onClick={() => setShowOverflowMenu(!showOverflowMenu)}
                          className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                          title="More options"
                        >
                          <MoreVertical className="h-4 w-4 text-gray-400" />
                        </button>
                        {showOverflowMenu && (
                          <>
                            <div
                              className="fixed inset-0 z-10"
                              onClick={() => setShowOverflowMenu(false)}
                            />
                            <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-20">
                              <div className="py-1">
                                <button
                                  onClick={() => {
                                    setShowDeletedConfirm(true)
                                    setShowOverflowMenu(false)
                                  }}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                                >
                                  <Trash2 className="h-4 w-4" />
                                  View Deleted Items
                                  <Badge variant="secondary" className="text-xs ml-auto">{deletedItems.length}</Badge>
                                </button>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                    <div className={clsx(
                      "flex-1 rounded-lg border-2 border-dashed p-2 transition-colors",
                      (fullscreenColumn === 'deciding' || fullscreenColumn === 'archived') ? "min-h-[400px]" : "min-h-[200px]",
                      fourthColumnView === 'deleted'
                        ? "border-red-200 dark:border-red-800/50 bg-red-50/30 dark:bg-red-900/10"
                        : draggedItem && fourthColumnView !== 'archived'
                          ? "border-primary-300 dark:border-primary-700 bg-primary-50/50 dark:bg-primary-900/10"
                          : "border-gray-200 dark:border-gray-700"
                    )}>
                      {/* Outcome history banners */}
                      {(fourthColumnView === 'approved' || fourthColumnView === 'rejected' || fourthColumnView === 'archived') && (
                        <div className="mb-3 p-2.5 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg">
                          <div className="flex items-center gap-2">
                            <History className="h-4 w-4 text-gray-400 flex-shrink-0" />
                            <p className="text-xs text-gray-500 dark:text-gray-400 flex-1">
                              {fourthColumnView === 'approved'
                                ? "Viewing approved trade ideas. These were approved from Deciding."
                                : fourthColumnView === 'rejected'
                                  ? "Viewing rejected trade ideas. These were reviewed and decided against."
                                  : "Viewing archived trade ideas. These are not being pursued right now."}
                            </p>
                            <button
                              onClick={() => setFourthColumnView('deciding')}
                              className="flex-shrink-0 px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                            >
                              Back to Active
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Deleted items warning banner */}
                      {fourthColumnView === 'deleted' && (
                        <div className="mb-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                          <div className="flex items-start gap-3">
                            <Trash2 className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-red-800 dark:text-red-300">
                                Viewing Deleted Items
                              </p>
                              <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                                These items have been removed. Click on an item to restore it if needed.
                              </p>
                            </div>
                            <button
                              onClick={() => setFourthColumnView('deciding')}
                              className="flex-shrink-0 px-2.5 py-1 text-xs font-medium text-red-700 dark:text-red-300 bg-white dark:bg-gray-800 border border-red-300 dark:border-red-700 rounded hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                            >
                              Back to Deciding
                            </button>
                          </div>
                        </div>
                      )}
                      <div className={clsx(
                        "gap-2",
                        (fullscreenColumn === 'deciding' || fullscreenColumn === 'archived')
                          ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                          : "space-y-2"
                      )}>
                        {/* Pair Trade Cards for Deciding/Approved/Rejected views */}
                        {fourthColumnView === 'deciding' && pairTradesByStatus.deciding.map(({ pairTradeId, pairTrade, legs }) => (
                          <PairTradeCard
                            key={pairTradeId}
                            pairTradeId={pairTradeId}
                            pairTrade={pairTrade}
                            legs={legs}
                            isDragging={draggedItem === pairTradeId}
                            onDragStart={(e) => handlePairTradeDragStart(e, pairTradeId)}
                            onDragEnd={handleDragEnd}
                            onPairClick={(pairId) => setSelectedTradeId(pairId)}
                          />
                        ))}
                        {/* Approved outcome: trades that were approved */}
                        {fourthColumnView === 'approved' && pairTradesByStatus.approved.map(({ pairTradeId, pairTrade, legs }) => (
                          <PairTradeCard
                            key={pairTradeId}
                            pairTradeId={pairTradeId}
                            pairTrade={pairTrade}
                            legs={legs}
                            isDragging={draggedItem === pairTradeId}
                            onDragStart={(e) => handlePairTradeDragStart(e, pairTradeId)}
                            onDragEnd={handleDragEnd}
                            onPairClick={(pairId) => setSelectedTradeId(pairId)}
                          />
                        ))}
                        {fourthColumnView === 'rejected' && pairTradesByStatus.rejected.map(({ pairTradeId, pairTrade, legs }) => (
                          <PairTradeCard
                            key={pairTradeId}
                            pairTradeId={pairTradeId}
                            pairTrade={pairTrade}
                            legs={legs}
                            isDragging={draggedItem === pairTradeId}
                            onDragStart={(e) => handlePairTradeDragStart(e, pairTradeId)}
                            onDragEnd={handleDragEnd}
                            onPairClick={(pairId) => setSelectedTradeId(pairId)}
                          />
                        ))}
                        {/* Individual Trade Cards */}
                        {(fourthColumnView === 'deciding'
                          ? itemsByStatus.deciding
                          : fourthColumnView === 'approved'
                            ? itemsByStatus.approved
                            : fourthColumnView === 'rejected'
                              ? itemsByStatus.rejected
                              : fourthColumnView === 'archived'
                                ? archivedItems
                                : deletedItems
                        ).map(item => (
                          <TradeQueueCard
                            key={item.id}
                            item={item}
                            isDragging={draggedItem === item.id}
                            onDragStart={(e) => handleDragStart(e, item.id)}
                            onDragEnd={handleDragEnd}
                            onClick={() => setSelectedTradeId(item.id)}
                            isArchived={fourthColumnView === 'archived' || fourthColumnView === 'deleted'}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {/* PRETRADE SECTION */}
        {activeSection === 'pretrade' && (
          <div className="space-y-6">
            {/* Simulating Trade Ideas Section */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Simulating Trade Ideas</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Trade ideas currently being analyzed in simulations
                  </p>
                </div>
              </div>

              {itemsByStatus.simulating.length === 0 ? (
                <Card className="p-6 text-center">
                  <FlaskConical className="h-8 w-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">No trade ideas currently simulating</p>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-8">
                  {itemsByStatus.simulating.map(item => (
                    <TradeQueueCard
                      key={item.id}
                      item={item}
                      isDragging={draggedItem === item.id}
                      onDragStart={(e) => handleDragStart(e, item.id)}
                      onDragEnd={handleDragEnd}
                      onClick={() => setSelectedTradeId(item.id)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Active Simulations Section */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Active Trade Labs</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Trade ideas being analyzed in simulations before execution
                  </p>
                </div>
              </div>

            {(!simulations || simulations.length === 0) ? (
              <Card className="p-6 text-center">
                <FlaskConical className="h-8 w-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                <p className="text-sm text-gray-500 dark:text-gray-400">No active simulations</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Select approved trade ideas and create a simulation</p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {simulations.map((sim: any) => (
                  <Card key={sim.id} className="p-4 hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="font-semibold text-gray-900 dark:text-white">{sim.name}</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {sim.portfolios?.name || 'Unknown Portfolio'}
                        </p>
                      </div>
                      <Badge variant={sim.status === 'running' ? 'success' : 'secondary'}>
                        {sim.status}
                      </Badge>
                    </div>

                    {sim.description && (
                      <p className="text-sm text-gray-600 dark:text-gray-300 mb-3 line-clamp-2">
                        {sim.description}
                      </p>
                    )}

                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {sim.simulation_trades?.length || 0} trades
                      </span>
                      <span className="text-xs text-gray-400">•</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        Created {new Date(sim.created_at).toLocaleDateString()}
                      </span>
                    </div>

                    {/* Trade preview */}
                    {sim.simulation_trades && sim.simulation_trades.length > 0 && (
                      <div className="border-t border-gray-100 dark:border-gray-700 pt-3 mt-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Trades:</p>
                        <div className="flex flex-wrap gap-1">
                          {sim.simulation_trades.slice(0, 5).map((trade: any) => (
                            <span
                              key={trade.id}
                              className={clsx(
                                "text-xs px-2 py-0.5 rounded-full",
                                trade.action === 'buy' || trade.action === 'add'
                                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                                  : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                              )}
                            >
                              {trade.action.toUpperCase()} {trade.assets?.symbol}
                            </span>
                          ))}
                          {sim.simulation_trades.length > 5 && (
                            <span className="text-xs text-gray-400">
                              +{sim.simulation_trades.length - 5} more
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="w-full"
                        onClick={() => {
                          // Navigate to simulation page - dispatch custom event
                          window.dispatchEvent(new CustomEvent('openSimulation', { detail: { simulationId: sim.id } }))
                        }}
                      >
                        <ExternalLink className="h-4 w-4 mr-2" />
                        Open Trade Lab
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
            </div>
          </div>
        )}

        {/* POST TRADE SECTION */}
        {activeSection === 'post-trade' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Trade History</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Review executed trades, rationales, and lessons learned
                </p>
              </div>
            </div>

            {(!executedTrades || executedTrades.length === 0) ? (
              <EmptyState
                icon={History}
                title="No executed trades yet"
                description="Executed trades will appear here with their rationales and notes"
              />
            ) : (
              <div className="space-y-4">
                {executedTrades.map((trade: any) => (
                  <Card key={trade.id} className="p-4">
                    <div className="flex items-start gap-4">
                      {/* Trade action indicator */}
                      <div className={clsx(
                        "flex-shrink-0 w-12 h-12 rounded-lg flex items-center justify-center",
                        trade.action === 'buy' || trade.action === 'add'
                          ? "bg-green-100 dark:bg-green-900/30"
                          : "bg-red-100 dark:bg-red-900/30"
                      )}>
                        {trade.action === 'buy' || trade.action === 'add' ? (
                          <TrendingUp className={clsx("h-6 w-6", ACTION_CONFIG[trade.action as TradeAction].color)} />
                        ) : (
                          <TrendingDown className={clsx("h-6 w-6", ACTION_CONFIG[trade.action as TradeAction].color)} />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className={clsx("text-sm font-medium uppercase", ACTION_CONFIG[trade.action as TradeAction].color)}>
                                {trade.action}
                              </span>
                              <h3 className="font-semibold text-gray-900 dark:text-white">
                                {trade.assets?.symbol}
                              </h3>
                              <span className="text-gray-500 dark:text-gray-400">-</span>
                              <span className="text-sm text-gray-600 dark:text-gray-300">
                                {trade.assets?.company_name}
                              </span>
                            </div>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                              {trade.portfolios?.name} • Executed {trade.executed_at ? new Date(trade.executed_at).toLocaleDateString() : 'N/A'}
                            </p>
                          </div>
                          <div className="text-right">
                            {trade.proposed_weight && (
                              <p className="text-sm font-medium text-gray-900 dark:text-white">
                                {trade.proposed_weight.toFixed(1)}% weight
                              </p>
                            )}
                            {trade.proposed_shares && (
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                {trade.proposed_shares.toLocaleString()} shares
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Rationale */}
                        {trade.rationale && (
                          <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-1">
                              <FileText className="h-3 w-3" />
                              Trade Rationale
                            </p>
                            <p className="text-sm text-gray-700 dark:text-gray-300">
                              {trade.rationale}
                            </p>
                          </div>
                        )}

                        {/* Thesis Summary */}
                        {trade.thesis_summary && (
                          <div className="mt-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                            <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-1">
                              Thesis Summary
                            </p>
                            <p className="text-sm text-blue-800 dark:text-blue-200">
                              {trade.thesis_summary}
                            </p>
                          </div>
                        )}

                        {/* Comments/Notes */}
                        {trade.trade_queue_comments && trade.trade_queue_comments.length > 0 && (
                          <div className="mt-3 border-t border-gray-100 dark:border-gray-700 pt-3">
                            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1">
                              <MessageSquare className="h-3 w-3" />
                              Discussion Notes ({trade.trade_queue_comments.length})
                            </p>
                            <div className="space-y-2">
                              {trade.trade_queue_comments.slice(0, 2).map((comment: any) => (
                                <div key={comment.id} className="text-sm">
                                  <span className="font-medium text-gray-700 dark:text-gray-300">
                                    {comment.users?.first_name || comment.users?.email?.split('@')[0] || 'Unknown'}:
                                  </span>
                                  <span className="text-gray-600 dark:text-gray-400 ml-1">
                                    {comment.content}
                                  </span>
                                </div>
                              ))}
                              {trade.trade_queue_comments.length > 2 && (
                                <button
                                  onClick={() => setSelectedTradeId(trade.id)}
                                  className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
                                >
                                  View all {trade.trade_queue_comments.length} comments
                                </button>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Footer with metadata */}
                        <div className="mt-3 flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                          {trade.users && (
                            <span>
                              Proposed by {trade.users.first_name || trade.users.email?.split('@')[0]}
                            </span>
                          )}
                          {trade.approved_user && (
                            <span>
                              Approved by {trade.approved_user.first_name || trade.approved_user.email?.split('@')[0]}
                            </span>
                          )}
                          <button
                            onClick={() => setSelectedTradeId(trade.id)}
                            className="text-primary-600 dark:text-primary-400 hover:underline ml-auto"
                          >
                            View Details
                          </button>
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      <AddTradeIdeaModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSuccess={() => {
          setShowAddModal(false)
          queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
        }}
      />


      {selectedTradeId && (
        <TradeIdeaDetailModal
          isOpen={!!selectedTradeId}
          tradeId={selectedTradeId}
          onClose={() => setSelectedTradeId(null)}
        />
      )}

      {/* Deleted Items Confirmation Modal */}
      {showDeletedConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowDeletedConfirm(false)}
          />
          <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <Trash2 className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  View Deleted Items
                </h3>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                  You're about to view {deletedItems.length} deleted trade idea{deletedItems.length !== 1 ? 's' : ''}.
                  These items have been removed from the active pipeline.
                </p>
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-500">
                  Deleted items are retained for audit purposes and can be restored if needed.
                </p>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => setShowDeletedConfirm(false)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setFourthColumnView('deleted')
                  setShowDeletedConfirm(false)
                }}
              >
                <Trash2 className="h-4 w-4 mr-1.5" />
                View Deleted
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Pair Trade Card Component - displays grouped pair trade as a single card
interface PairTradeCardProps {
  pairTradeId: string
  pairTrade: any
  legs: TradeQueueItemWithDetails[]
  isDragging: boolean
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
  onPairClick: (pairId: string) => void
}

function PairTradeCard({
  pairTradeId,
  pairTrade,
  legs,
  isDragging,
  onDragStart,
  onDragEnd,
  onPairClick
}: PairTradeCardProps) {
  // Sort legs: long first, then short
  const sortedLegs = [...legs].sort((a, b) => {
    if (a.pair_leg_type === 'long' && b.pair_leg_type === 'short') return -1
    if (a.pair_leg_type === 'short' && b.pair_leg_type === 'long') return 1
    return 0
  })

  const longLeg = sortedLegs.find(l => l.pair_leg_type === 'long')
  const shortLeg = sortedLegs.find(l => l.pair_leg_type === 'short')

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => onPairClick(pairTradeId)}
      className={clsx(
        "bg-white dark:bg-gray-800 rounded-lg border-2 shadow-sm transition-all cursor-pointer",
        isDragging && "opacity-50 rotate-2 scale-105",
        "border-purple-300 dark:border-purple-700 hover:shadow-md hover:border-purple-400 dark:hover:border-purple-600"
      )}
    >
      <div className="p-3">
        {/* Pairs Trade Header */}
        <div className="flex items-center gap-2 mb-3 pb-2 border-b border-purple-100 dark:border-purple-800">
          <GripVertical className="h-4 w-4 text-gray-400 cursor-grab" />
          <Link2 className="h-4 w-4 text-purple-600 dark:text-purple-400" />
          <span className="font-semibold text-purple-700 dark:text-purple-300 truncate flex-1">
            {pairTrade.name || 'Pairs Trade'}
          </span>
        </div>

        {/* Legs Display */}
        <div className="space-y-2">
          {/* Long Leg */}
          {longLeg && (
            <div className="flex items-center gap-2 p-2 bg-green-50 dark:bg-green-900/20 rounded-md">
              <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
              <span className="text-xs font-medium text-green-700 dark:text-green-300 uppercase">Long</span>
              <span className="font-semibold text-gray-900 dark:text-white">{longLeg.assets?.symbol}</span>
              <span className="text-sm text-gray-500 dark:text-gray-400 truncate flex-1">{longLeg.assets?.company_name}</span>
              {longLeg.proposed_weight && (
                <span className="text-xs font-medium text-green-600 dark:text-green-400">+{longLeg.proposed_weight.toFixed(1)}%</span>
              )}
              {longLeg.proposed_shares && !longLeg.proposed_weight && (
                <span className="text-xs font-medium text-green-600 dark:text-green-400">+{longLeg.proposed_shares.toLocaleString()}</span>
              )}
            </div>
          )}

          {/* Short Leg */}
          {shortLeg && (
            <div className="flex items-center gap-2 p-2 bg-red-50 dark:bg-red-900/20 rounded-md">
              <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" />
              <span className="text-xs font-medium text-red-700 dark:text-red-300 uppercase">Short</span>
              <span className="font-semibold text-gray-900 dark:text-white">{shortLeg.assets?.symbol}</span>
              <span className="text-sm text-gray-500 dark:text-gray-400 truncate flex-1">{shortLeg.assets?.company_name}</span>
              {shortLeg.proposed_weight && (
                <span className="text-xs font-medium text-red-600 dark:text-red-400">-{shortLeg.proposed_weight.toFixed(1)}%</span>
              )}
              {shortLeg.proposed_shares && !shortLeg.proposed_weight && (
                <span className="text-xs font-medium text-red-600 dark:text-red-400">-{shortLeg.proposed_shares.toLocaleString()}</span>
              )}
            </div>
          )}
        </div>

        {/* Rationale preview */}
        {pairTrade.rationale && (
          <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mt-2">
            {pairTrade.rationale}
          </p>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 mt-2 border-t border-gray-100 dark:border-gray-700">
          <span className={clsx("text-xs px-2 py-0.5 rounded-full", URGENCY_CONFIG[pairTrade.urgency as TradeUrgency]?.color || URGENCY_CONFIG.medium.color)}>
            {pairTrade.urgency || 'medium'}
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {legs.length} legs
          </span>
        </div>
      </div>
    </div>
  )
}

// Trade Queue Card Component
interface TradeQueueCardProps {
  item: TradeQueueItemWithDetails
  isDragging: boolean
  isArchived?: boolean
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
  onClick: () => void
}

function TradeQueueCard({
  item,
  isDragging,
  isArchived,
  onDragStart,
  onDragEnd,
  onClick
}: TradeQueueCardProps) {
  const ActionIcon = ACTION_CONFIG[item.action].icon

  return (
    <div
      draggable={!isArchived}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={clsx(
        "bg-white dark:bg-gray-800 rounded-lg border shadow-sm transition-all cursor-pointer",
        isDragging && "opacity-50 rotate-2 scale-105",
        isArchived
          ? "border-gray-200 dark:border-gray-700 opacity-75"
          : "border-gray-200 dark:border-gray-700 hover:shadow-md hover:border-gray-300 dark:hover:border-gray-600"
      )}
    >
      <div className="p-3">
        {/* Pairs Trade Indicator */}
        {item.pair_trade_id && item.pair_trades && (
          <div className="flex items-center gap-1.5 mb-2 px-2 py-1 bg-purple-50 dark:bg-purple-900/20 rounded-md border border-purple-200 dark:border-purple-800">
            <Link2 className="h-3 w-3 text-purple-600 dark:text-purple-400" />
            <span className="text-xs font-medium text-purple-700 dark:text-purple-300 truncate">
              {item.pair_trades.name || 'Pairs Trade'}
            </span>
            {item.pair_leg_type && (
              <span className={clsx(
                "text-xs px-1.5 py-0.5 rounded-full ml-auto",
                item.pair_leg_type === 'long'
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
              )}>
                {item.pair_leg_type}
              </span>
            )}
          </div>
        )}

        {/* Header */}
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            {!isArchived && (
              <GripVertical className="h-4 w-4 text-gray-400 cursor-grab" />
            )}
            <div className={clsx("flex items-center gap-1.5 font-medium", ACTION_CONFIG[item.action].color)}>
              <ActionIcon className="h-4 w-4" />
              <span className="uppercase text-xs">{item.action}</span>
              {item.proposed_weight && (
                <span className="text-xs">
                  {(item.action === 'buy' || item.action === 'add') ? '+' : '-'}{item.proposed_weight.toFixed(1)}%
                </span>
              )}
              {!item.proposed_weight && item.proposed_shares && (
                <span className="text-xs">
                  {(item.action === 'buy' || item.action === 'add') ? '+' : '-'}{item.proposed_shares.toLocaleString()} shs
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Asset info */}
        <div className="mb-2">
          <div className="font-semibold text-gray-900 dark:text-white">
            {item.assets?.symbol}
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400 truncate">
            {item.assets?.company_name}
          </div>
        </div>

        {/* Portfolio, Creator, Date */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2 text-xs text-gray-500 dark:text-gray-400">
          {item.portfolios?.name && (
            <span className="flex items-center gap-1">
              <Briefcase className="h-3 w-3" />
              {item.portfolios.name}
            </span>
          )}
          {item.users && (
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" />
              {item.users.first_name || item.users.email?.split('@')[0] || 'Unknown'}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {new Date(item.created_at).toLocaleDateString()}
          </span>
        </div>

        {/* Sizing - show shares as supplementary info if we have both weight and shares */}
        {item.proposed_weight && item.proposed_shares && (
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            {item.proposed_shares.toLocaleString()} shares
          </div>
        )}

        {/* Rationale preview */}
        {item.rationale && (
          <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mb-2">
            {item.rationale}
          </p>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <span className={clsx("text-xs px-2 py-0.5 rounded-full", URGENCY_CONFIG[item.urgency].color)}>
              {item.urgency}
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            {item.trade_queue_comments && item.trade_queue_comments.length > 0 && (
              <span className="flex items-center gap-0.5">
                <MessageSquare className="h-3 w-3" />
                {item.trade_queue_comments.length}
              </span>
            )}
            {item.vote_summary && (
              <>
                {item.vote_summary.approve > 0 && (
                  <span className="flex items-center gap-0.5 text-green-600">
                    <ThumbsUp className="h-3 w-3" />
                    {item.vote_summary.approve}
                  </span>
                )}
                {item.vote_summary.reject > 0 && (
                  <span className="flex items-center gap-0.5 text-red-600">
                    <ThumbsDown className="h-3 w-3" />
                    {item.vote_summary.reject}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
