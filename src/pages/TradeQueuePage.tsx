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
  Briefcase
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
  TradeQueueFilters
} from '../types/trading'
import { clsx } from 'clsx'

const STATUS_CONFIG: Record<TradeQueueStatus, { label: string; color: string; icon: React.ElementType }> = {
  idea: { label: 'Idea', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300', icon: AlertCircle },
  discussing: { label: 'Discussing', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300', icon: MessageSquare },
  approved: { label: 'Approved', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300', icon: CheckCircle2 },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300', icon: XCircle },
  executed: { label: 'Executed', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300', icon: PlayCircle },
  cancelled: { label: 'Cancelled', color: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300', icon: XCircle },
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
  const [thirdColumnView, setThirdColumnView] = useState<'approved' | 'rejected' | 'archived'>('approved')
  const [fullscreenColumn, setFullscreenColumn] = useState<TradeQueueStatus | 'archived' | null>(null)

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
          trade_queue_votes (id, vote)
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
        // Exclude archived items from main view
        if (archivedStatuses.includes(item.status)) return false
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

  // Group items by status for kanban-like view
  const itemsByStatus = useMemo(() => {
    const groups: Record<TradeQueueStatus, TradeQueueItemWithDetails[]> = {
      idea: [],
      discussing: [],
      approved: [],
      rejected: [],
      executed: [],
      cancelled: [],
    }

    filteredItems.forEach(item => {
      groups[item.status].push(item)
    })

    return groups
  }, [filteredItems])

  // Drag handlers - use dataTransfer to pass the item ID reliably
  const handleDragStart = useCallback((e: React.DragEvent, itemId: string) => {
    e.dataTransfer.setData('text/plain', itemId)
    e.dataTransfer.effectAllowed = 'move'
    setDraggedItem(itemId)
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

    // Get the item ID from dataTransfer (more reliable than state)
    const itemId = e.dataTransfer.getData('text/plain')
    console.log('Drop event - itemId from dataTransfer:', itemId, 'targetStatus:', targetStatus)

    if (!itemId) {
      console.error('No item ID found in dataTransfer')
      setDraggedItem(null)
      return
    }

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
  }, [tradeItems, queryClient])

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
          <div className="flex items-center gap-3">
            <Button onClick={() => setShowAddModal(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Trade Idea
            </Button>
          </div>
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
              {itemsByStatus.approved.length}
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
            {filteredItems.length === 0 ? (
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
                {/* Kanban Grid - shows either 3 columns or 1 fullscreen column */}
                <div className={clsx(
                  "gap-4",
                  fullscreenColumn ? "grid grid-cols-1" : "grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3"
                )}>
                  {/* Idea Column */}
                  {(!fullscreenColumn || fullscreenColumn === 'idea') && (
                  <div
                    className="flex flex-col"
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, 'idea')}
                  >
                    <div className="flex items-center gap-2 mb-3 px-2">
                      <AlertCircle className="h-5 w-5 text-gray-500" />
                      <h2 className="font-semibold text-gray-900 dark:text-white">Idea</h2>
                      <Badge variant="default" className="ml-auto">
                        {itemsByStatus.idea.length}
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

                  {/* Discussing Column */}
                  {(!fullscreenColumn || fullscreenColumn === 'discussing') && (
                  <div
                    className="flex flex-col"
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, 'discussing')}
                  >
                    <div className="flex items-center gap-2 mb-3 px-2">
                      <MessageSquare className="h-5 w-5 text-gray-500" />
                      <h2 className="font-semibold text-gray-900 dark:text-white">Discussing</h2>
                      <Badge variant="default" className="ml-auto">
                        {itemsByStatus.discussing.length}
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

                  {/* Third Column - Toggleable between Approved/Rejected/Archived */}
                  {(!fullscreenColumn || fullscreenColumn === 'archived') && (
                  <div
                    className="flex flex-col"
                    onDragOver={handleDragOver}
                    onDrop={(e) => {
                      if (thirdColumnView === 'approved') handleDrop(e, 'approved')
                      else if (thirdColumnView === 'rejected') handleDrop(e, 'rejected')
                    }}
                  >
                    <div className="flex items-center gap-2 mb-3 px-2">
                      {thirdColumnView === 'approved' && <CheckCircle2 className="h-5 w-5 text-gray-500" />}
                      {thirdColumnView === 'rejected' && <XCircle className="h-5 w-5 text-gray-500" />}
                      {thirdColumnView === 'archived' && <Archive className="h-5 w-5 text-gray-500" />}

                      {/* Dropdown Toggle */}
                      <div className="relative group">
                        <button className="flex items-center gap-1 font-semibold text-gray-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400 transition-colors">
                          {thirdColumnView === 'approved' ? 'Approved' : thirdColumnView === 'rejected' ? 'Rejected' : 'Archived'}
                          <ChevronDown className="h-4 w-4" />
                        </button>
                        <div className="absolute left-0 top-full mt-1 w-40 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
                          <button
                            onClick={() => setThirdColumnView('approved')}
                            className={clsx(
                              "w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-700 rounded-t-lg",
                              thirdColumnView === 'approved' && "bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400"
                            )}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            Approved
                            <Badge variant="secondary" className="text-xs ml-auto">{itemsByStatus.approved.length}</Badge>
                          </button>
                          <button
                            onClick={() => setThirdColumnView('rejected')}
                            className={clsx(
                              "w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-700",
                              thirdColumnView === 'rejected' && "bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400"
                            )}
                          >
                            <XCircle className="h-4 w-4" />
                            Rejected
                            <Badge variant="secondary" className="text-xs ml-auto">{itemsByStatus.rejected.length}</Badge>
                          </button>
                          <button
                            onClick={() => setThirdColumnView('archived')}
                            className={clsx(
                              "w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-700 rounded-b-lg",
                              thirdColumnView === 'archived' && "bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400"
                            )}
                          >
                            <Archive className="h-4 w-4" />
                            Archived
                            <Badge variant="secondary" className="text-xs ml-auto">{archivedItems.length}</Badge>
                          </button>
                        </div>
                      </div>

                      <Badge variant="default" className="ml-auto">
                        {thirdColumnView === 'approved'
                          ? itemsByStatus.approved.length
                          : thirdColumnView === 'rejected'
                            ? itemsByStatus.rejected.length
                            : archivedItems.length}
                      </Badge>
                      <button
                        onClick={() => setFullscreenColumn(fullscreenColumn === 'archived' ? null : 'archived')}
                        className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                        title={fullscreenColumn === 'archived' ? "Exit fullscreen" : "Fullscreen"}
                      >
                        {fullscreenColumn === 'archived' ? (
                          <Minimize2 className="h-4 w-4 text-gray-400" />
                        ) : (
                          <Maximize2 className="h-4 w-4 text-gray-400" />
                        )}
                      </button>
                    </div>
                    <div className={clsx(
                      "flex-1 rounded-lg border-2 border-dashed p-2 transition-colors",
                      fullscreenColumn === 'archived' ? "min-h-[400px]" : "min-h-[200px]",
                      draggedItem && thirdColumnView !== 'archived'
                        ? "border-primary-300 dark:border-primary-700 bg-primary-50/50 dark:bg-primary-900/10"
                        : "border-gray-200 dark:border-gray-700"
                    )}>
                      <div className={clsx(
                        "gap-2",
                        fullscreenColumn === 'archived'
                          ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                          : "space-y-2"
                      )}>
                        {(thirdColumnView === 'approved'
                          ? itemsByStatus.approved
                          : thirdColumnView === 'rejected'
                            ? itemsByStatus.rejected
                            : archivedItems
                        ).map(item => (
                          <TradeQueueCard
                            key={item.id}
                            item={item}
                            isDragging={draggedItem === item.id}
                            onDragStart={(e) => handleDragStart(e, item.id)}
                            onDragEnd={handleDragEnd}
                            onClick={() => setSelectedTradeId(item.id)}
                            isArchived={thirdColumnView === 'archived'}
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
            {/* Approved Trade Ideas Section */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Approved Trade Ideas</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Trade ideas ready for simulation and execution
                  </p>
                </div>
              </div>

              {itemsByStatus.approved.length === 0 ? (
                <Card className="p-6 text-center">
                  <CheckCircle2 className="h-8 w-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">No approved trade ideas yet</p>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-8">
                  {itemsByStatus.approved.map(item => (
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
  const StatusIcon = STATUS_CONFIG[item.status].icon

  return (
    <div
      draggable={!isArchived}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={clsx(
        "bg-white dark:bg-gray-800 rounded-lg border shadow-sm transition-all cursor-pointer",
        isDragging && "opacity-50 rotate-2 scale-105",
        isArchived
          ? "border-gray-200 dark:border-gray-700 opacity-75"
          : "border-gray-200 dark:border-gray-700 hover:shadow-md hover:border-gray-300 dark:hover:border-gray-600"
      )}
    >
      <div className="p-3">
        {/* Header */}
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            {!isArchived && (
              <GripVertical className="h-4 w-4 text-gray-400 cursor-grab" />
            )}
            <div className={clsx("flex items-center gap-1 font-medium", ACTION_CONFIG[item.action].color)}>
              <ActionIcon className="h-4 w-4" />
              <span className="uppercase text-xs">{item.action}</span>
            </div>
          </div>
        </div>

        {/* Asset info */}
        <div className="mb-2" onClick={onClick}>
          <div className="font-semibold text-gray-900 dark:text-white">
            {item.assets?.symbol}
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400 truncate">
            {item.assets?.company_name}
          </div>
        </div>

        {/* Portfolio, Creator, Date */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2 text-xs text-gray-500 dark:text-gray-400" onClick={onClick}>
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

        {/* Sizing */}
        <div className="flex items-center gap-2 mb-2 text-sm" onClick={onClick}>
          {item.proposed_weight && (
            <span className="text-gray-700 dark:text-gray-300">
              {item.proposed_weight.toFixed(1)}% weight
            </span>
          )}
          {item.proposed_shares && (
            <span className="text-gray-500 dark:text-gray-400">
              ({item.proposed_shares.toLocaleString()} shares)
            </span>
          )}
        </div>

        {/* Rationale preview */}
        {item.rationale && (
          <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mb-2" onClick={onClick}>
            {item.rationale}
          </p>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <span className={clsx("text-xs px-2 py-0.5 rounded-full", URGENCY_CONFIG[item.urgency].color)}>
              {item.urgency}
            </span>
            <span className={clsx("text-xs px-2 py-0.5 rounded-full flex items-center gap-1", STATUS_CONFIG[item.status].color)}>
              <StatusIcon className="h-3 w-3" />
              {STATUS_CONFIG[item.status].label}
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
