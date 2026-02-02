import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow, format, differenceInMinutes } from 'date-fns'
import {
  X,
  TrendingUp,
  TrendingDown,
  MessageSquare,
  Send,
  Edit2,
  CheckCircle2,
  XCircle,
  Clock,
  User,
  RotateCcw,
  Pin,
  Reply,
  MessageCircle,
  Link2,
  Scale,
  FlaskConical,
  Wrench,
  Trash2,
  AlertTriangle,
  History,
  ChevronDown
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { AddToLabDropdown } from './AddToLabDropdown'
import { useTradeExpressionCounts } from '../../hooks/useTradeExpressionCounts'
import { useTradeIdeaService } from '../../hooks/useTradeIdeaService'
import { EntityTimeline } from '../audit/EntityTimeline'
import { UniversalSmartInput, SmartInputRenderer, type SmartInputMetadata } from '../smart-input'
import type { UniversalSmartInputRef } from '../smart-input'
import type {
  TradeQueueItemWithDetails,
  TradeQueueStatus
} from '../../types/trading'
import { clsx } from 'clsx'

type ModalTab = 'details' | 'activity'

interface TradeIdeaDetailModalProps {
  isOpen: boolean
  tradeId: string
  onClose: () => void
}

const STATUS_CONFIG: Record<TradeQueueStatus, { label: string; color: string }> = {
  idea: { label: 'Ideas', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  discussing: { label: 'Working On', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' },
  simulating: { label: 'Simulating', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' },
  deciding: { label: 'Commit', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
  approved: { label: 'Committed', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
  cancelled: { label: 'Deferred', color: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300' },
  deleted: { label: 'Deleted', color: 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400' },
}

export function TradeIdeaDetailModal({ isOpen, tradeId, onClose }: TradeIdeaDetailModalProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const discussionInputRef = useRef<UniversalSmartInputRef>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const [activeTab, setActiveTab] = useState<ModalTab>('details')
  const [discussionMessage, setDiscussionMessage] = useState('')
  const [discussionMetadata, setDiscussionMetadata] = useState<SmartInputMetadata>({ mentions: [], references: [], dataSnapshots: [], aiContent: [] })
  const [replyToMessage, setReplyToMessage] = useState<string | null>(null)
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isLabsExpanded, setIsLabsExpanded] = useState(false)
  const [showPriorityDropdown, setShowPriorityDropdown] = useState(false)
  const priorityDropdownRef = useRef<HTMLDivElement>(null)

  // Get expression counts for trade ideas
  const { data: expressionCounts } = useTradeExpressionCounts()

  // Fetch trade details - check both pair_trades and trade_queue_items
  const { data: tradeData, isLoading } = useQuery({
    queryKey: ['trade-detail', tradeId],
    queryFn: async () => {
      // First try to fetch as a pair trade
      const { data: pairTrade, error: pairError } = await supabase
        .from('pair_trades')
        .select(`
          *,
          portfolios:portfolio_id (id, name, portfolio_id),
          users:created_by (id, email, first_name, last_name),
          trade_queue_items!trade_queue_items_pair_trade_id_fkey (
            *,
            assets:asset_id (id, symbol, company_name, sector)
          )
        `)
        .eq('id', tradeId)
        .maybeSingle()

      if (pairTrade) {
        return { type: 'pair' as const, data: pairTrade }
      }

      // Fall back to individual trade item
      const { data: tradeItem, error: tradeError } = await supabase
        .from('trade_queue_items')
        .select(`
          *,
          assets (id, symbol, company_name, sector),
          portfolios (id, name, portfolio_id),
          users:created_by (id, email, first_name, last_name)
        `)
        .eq('id', tradeId)
        .maybeSingle()

      if (tradeError) throw tradeError
      if (!tradeItem) return null

      return { type: 'single' as const, data: tradeItem as TradeQueueItemWithDetails }
    },
    enabled: isOpen,
  })

  // Extract trade for backwards compatibility with existing UI
  const trade = tradeData?.type === 'single' ? tradeData.data : null
  const pairTrade = tradeData?.type === 'pair' ? tradeData.data : null

  // Fetch portfolio holdings for this asset to determine position context
  const { data: portfolioPositions } = useQuery({
    queryKey: ['portfolio-positions', trade?.asset_id],
    queryFn: async () => {
      if (!trade?.asset_id) return new Map<string, number>()

      const { data, error } = await supabase
        .from('portfolio_holdings')
        .select('portfolio_id, shares')
        .eq('asset_id', trade.asset_id)

      if (error) throw error

      // Create a map of portfolio_id -> shares
      const positionMap = new Map<string, number>()
      data?.forEach((holding: any) => {
        positionMap.set(holding.portfolio_id, holding.shares || 0)
      })
      return positionMap
    },
    enabled: isOpen && !!trade?.asset_id,
  })

  // Helper to get position context label
  const getPositionContext = (portfolioId: string): string => {
    const shares = portfolioPositions?.get(portfolioId) || 0
    const isBuy = trade?.action === 'buy' || trade?.action === 'add'

    if (isBuy) {
      if (shares > 0) return 'add to position'
      if (shares < 0) return 'cover short'
      return 'new position'
    } else {
      if (shares > 0) return 'reduce position'
      if (shares < 0) return 'add to short'
      return 'new short'
    }
  }

  // Fetch discussion messages
  const { data: discussionMessages = [] } = useQuery({
    queryKey: ['messages', 'trade_idea', tradeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select(`
          *,
          user:users(id, email, first_name, last_name)
        `)
        .eq('context_type', 'trade_idea')
        .eq('context_id', tradeId)
        .order('created_at', { ascending: true })

      if (error) throw error
      return data
    },
    enabled: isOpen,
  })

  // Get reply-to message data
  const replyToMessageData = discussionMessages.find(m => m.id === replyToMessage)

  // Trade service for audited mutations
  const {
    moveTrade,
    deleteTrade,
    restoreTrade,
    movePairTrade,
    isMoving,
    isDeleting,
    isRestoring,
    isMovingPairTrade,
  } = useTradeIdeaService({
    onDeleteSuccess: () => {
      setShowDeleteConfirm(false)
      onClose()
    },
  })

  // Wrapper for single trade status updates (for backwards compatibility)
  const updateStatusMutation = {
    mutate: (status: TradeQueueStatus) => {
      moveTrade({ tradeId, targetStatus: status, uiSource: 'modal' })
    },
    isPending: isMoving,
  }

  // Wrapper for pair trade status updates (for backwards compatibility)
  const updatePairTradeStatusMutation = {
    mutate: (status: TradeQueueStatus) => {
      movePairTrade({ pairTradeId: tradeId, targetStatus: status, uiSource: 'modal' })
    },
    isPending: isMovingPairTrade,
  }

  // Wrapper for delete (for backwards compatibility)
  const deleteTradeMutation = {
    mutate: () => {
      deleteTrade({ tradeId, uiSource: 'modal' })
    },
    isPending: isDeleting,
  }

  // Wrapper for restore (for backwards compatibility with restore buttons)
  const restoreMutation = {
    mutate: (targetStatus: TradeQueueStatus) => {
      restoreTrade({ tradeId, targetStatus, uiSource: 'modal' })
    },
    isPending: isRestoring,
  }

  // Send discussion message mutation
  const sendDiscussionMessageMutation = useMutation({
    mutationFn: async (data: { content: string; reply_to?: string }) => {
      const { error } = await supabase
        .from('messages')
        .insert([{
          content: data.content,
          context_type: 'trade_idea',
          context_id: tradeId,
          user_id: user?.id,
          reply_to: data.reply_to
        }])

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', 'trade_idea', tradeId] })
      setDiscussionMessage('')
      setReplyToMessage(null)
      scrollToBottom()
    }
  })

  // Toggle pin mutation for discussion messages
  const toggleDiscussionPinMutation = useMutation({
    mutationFn: async ({ messageId, isPinned }: { messageId: string; isPinned: boolean }) => {
      const { error } = await supabase
        .from('messages')
        .update({ is_pinned: !isPinned })
        .eq('id', messageId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', 'trade_idea', tradeId] })
    }
  })

  // Update priority mutation
  const updatePriorityMutation = useMutation({
    mutationFn: async (newPriority: string) => {
      const { error } = await supabase
        .from('trade_queue_items')
        .update({ urgency: newPriority })
        .eq('id', tradeId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-detail', tradeId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      setShowPriorityDropdown(false)
    }
  })

  // Close priority dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (priorityDropdownRef.current && !priorityDropdownRef.current.contains(event.target as Node)) {
        setShowPriorityDropdown(false)
      }
    }
    if (showPriorityDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showPriorityDropdown])

  const handleSendDiscussionMessage = () => {
    if (!discussionMessage.trim()) return

    sendDiscussionMessageMutation.mutate({
      content: discussionMessage.trim(),
      reply_to: replyToMessage || undefined
    })
  }

  const handleDiscussionKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendDiscussionMessage()
    }
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    if (activeTab === 'discussion') {
      scrollToBottom()
    }
  }, [discussionMessages, activeTab])

  const formatMessageTime = (createdAt: string) => {
    const messageDate = new Date(createdAt)
    const now = new Date()
    const minutesAgo = differenceInMinutes(now, messageDate)

    if (minutesAgo <= 9) {
      return formatDistanceToNow(messageDate, { addSuffix: true })
    } else {
      return format(messageDate, 'MMM d, yyyy h:mm a')
    }
  }

  const getUserInitials = (userData: any) => {
    if (userData?.first_name && userData?.last_name) {
      return `${userData.first_name[0]}${userData.last_name[0]}`.toUpperCase()
    }
    const name = getUserDisplayName(userData)
    return name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
  }

  const getUserDisplayName = (userData: { first_name?: string | null; last_name?: string | null; email?: string }) => {
    if (userData.first_name || userData.last_name) {
      return `${userData.first_name || ''} ${userData.last_name || ''}`.trim()
    }
    return userData.email?.split('@')[0] || 'Unknown'
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-2xl w-full h-[80vh] max-h-[700px] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-3">
            {/* Single Trade Header */}
            {trade && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className={clsx(
                  "font-semibold uppercase",
                  trade.action === 'buy' || trade.action === 'add'
                    ? "text-green-600 dark:text-green-400"
                    : "text-red-600 dark:text-red-400"
                )}>
                  {trade.action}
                </span>
                <span className="font-bold text-lg text-gray-900 dark:text-white">
                  {trade.assets?.symbol}
                </span>
                <span className="text-gray-500 dark:text-gray-400">
                  {trade.assets?.company_name}
                </span>
                <div className="relative" ref={priorityDropdownRef}>
                  <button
                    onClick={() => setShowPriorityDropdown(!showPriorityDropdown)}
                    className={clsx(
                      "text-xs px-2 py-0.5 rounded-full cursor-pointer hover:ring-2 hover:ring-offset-1 transition-all",
                      trade.urgency === 'urgent' ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 hover:ring-red-300" :
                      trade.urgency === 'high' ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 hover:ring-orange-300" :
                      trade.urgency === 'medium' ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 hover:ring-blue-300" :
                      "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 hover:ring-gray-300"
                    )}
                  >
                    {trade.urgency || 'low'}
                  </button>
                  {showPriorityDropdown && (
                    <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50 min-w-[100px]">
                      {['low', 'medium', 'high', 'urgent'].map((priority) => (
                        <button
                          key={priority}
                          onClick={() => updatePriorityMutation.mutate(priority)}
                          disabled={updatePriorityMutation.isPending}
                          className={clsx(
                            "w-full px-3 py-1.5 text-xs text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2",
                            trade.urgency === priority && "bg-gray-50 dark:bg-gray-700"
                          )}
                        >
                          <span className={clsx(
                            "w-2 h-2 rounded-full",
                            priority === 'urgent' ? "bg-red-500" :
                            priority === 'high' ? "bg-orange-500" :
                            priority === 'medium' ? "bg-blue-500" :
                            "bg-gray-400"
                          )} />
                          <span className="capitalize text-gray-700 dark:text-gray-300">{priority}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            {/* Pair Trade Header */}
            {pairTrade && (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1 px-2 py-1 rounded font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                  <Link2 className="h-4 w-4" />
                  <span className="text-sm">Pair Trade</span>
                </div>
                <div>
                  <span className="font-bold text-lg text-gray-900 dark:text-white">
                    {pairTrade.name || 'Pairs Trade'}
                  </span>
                </div>
              </div>
            )}
            <button
              onClick={onClose}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
            >
              <X className="h-5 w-5 text-gray-500" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1">
            <button
              onClick={() => setActiveTab('details')}
              className={clsx(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors",
                activeTab === 'details'
                  ? "bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300"
                  : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
              )}
            >
              <Edit2 className="h-4 w-4" />
              Details
            </button>
            <button
              onClick={() => setActiveTab('activity')}
              className={clsx(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors",
                activeTab === 'activity'
                  ? "bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300"
                  : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
              )}
            >
              <History className="h-4 w-4" />
              Activity
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-4 space-y-4">
              <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
              <div className="h-24 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
            </div>
          ) : pairTrade ? (
            <>
              {/* Pair Trade Details Tab */}
              {activeTab === 'details' && (
                <div className="p-4 space-y-6">
                  {/* Status and Urgency */}
                  <div className="flex items-center gap-3">
                    <span className={clsx("px-3 py-1 rounded-full text-sm font-medium", STATUS_CONFIG[pairTrade.status as TradeQueueStatus]?.color || 'bg-gray-100 text-gray-800')}>
                      {STATUS_CONFIG[pairTrade.status as TradeQueueStatus]?.label || pairTrade.status}
                    </span>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      Urgency: <span className="font-medium capitalize">{pairTrade.urgency}</span>
                    </span>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      Portfolio: <span className="font-medium">{pairTrade.portfolios?.name}</span>
                    </span>
                  </div>

                  {/* Pair Legs */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Trade Legs</h3>
                    {pairTrade.trade_queue_items?.filter((leg: any) => leg.pair_leg_type === 'long').map((leg: any) => (
                      <div key={leg.id} className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 border border-green-200 dark:border-green-800">
                        <div className="flex items-center gap-2 mb-2">
                          <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
                          <span className="text-xs font-medium text-green-700 dark:text-green-300 uppercase">Long</span>
                          <span className="font-semibold text-gray-900 dark:text-white">{leg.assets?.symbol}</span>
                          <span className="text-sm text-gray-500 dark:text-gray-400">{leg.assets?.company_name}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          {leg.proposed_weight && (
                            <div>
                              <span className="text-gray-500 dark:text-gray-400">Target Weight: </span>
                              <span className="font-medium text-green-600 dark:text-green-400">+{leg.proposed_weight.toFixed(2)}%</span>
                            </div>
                          )}
                          {leg.proposed_shares && (
                            <div>
                              <span className="text-gray-500 dark:text-gray-400">Shares: </span>
                              <span className="font-medium text-green-600 dark:text-green-400">+{leg.proposed_shares.toLocaleString()}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {pairTrade.trade_queue_items?.filter((leg: any) => leg.pair_leg_type === 'short').map((leg: any) => (
                      <div key={leg.id} className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 border border-red-200 dark:border-red-800">
                        <div className="flex items-center gap-2 mb-2">
                          <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" />
                          <span className="text-xs font-medium text-red-700 dark:text-red-300 uppercase">Short</span>
                          <span className="font-semibold text-gray-900 dark:text-white">{leg.assets?.symbol}</span>
                          <span className="text-sm text-gray-500 dark:text-gray-400">{leg.assets?.company_name}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          {leg.proposed_weight && (
                            <div>
                              <span className="text-gray-500 dark:text-gray-400">Target Weight: </span>
                              <span className="font-medium text-red-600 dark:text-red-400">-{leg.proposed_weight.toFixed(2)}%</span>
                            </div>
                          )}
                          {leg.proposed_shares && (
                            <div>
                              <span className="text-gray-500 dark:text-gray-400">Shares: </span>
                              <span className="font-medium text-red-600 dark:text-red-400">-{leg.proposed_shares.toLocaleString()}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Thesis & Rationale */}
                  {(pairTrade.thesis_summary || pairTrade.rationale) && (
                    <div>
                      {pairTrade.thesis_summary && (
                        <div className="mb-3">
                          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
                            Thesis Summary
                          </h3>
                          <p className="text-gray-900 dark:text-white">{pairTrade.thesis_summary}</p>
                        </div>
                      )}
                      {pairTrade.rationale && (
                        <div>
                          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
                            Rationale
                          </h3>
                          <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{pairTrade.rationale}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Status Actions */}
                  {pairTrade.status !== 'approved' && pairTrade.status !== 'cancelled' && pairTrade.status !== 'rejected' && (
                    <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                        Actions
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {/* Move to Simulating */}
                        {(pairTrade.status === 'idea' || pairTrade.status === 'discussing') && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => updatePairTradeStatusMutation.mutate('simulating')}
                            disabled={updatePairTradeStatusMutation.isPending}
                          >
                            <FlaskConical className="h-4 w-4 mr-1" />
                            Start Simulating
                          </Button>
                        )}
                        {/* Move to Commit */}
                        {pairTrade.status === 'simulating' && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => updatePairTradeStatusMutation.mutate('deciding')}
                            disabled={updatePairTradeStatusMutation.isPending}
                          >
                            <Scale className="h-4 w-4 mr-1" />
                            Escalate to Commit
                          </Button>
                        )}
                        {/* Commit/Reject (only in commit stage) */}
                        {pairTrade.status === 'deciding' && (
                          <>
                            <Button
                              size="sm"
                              onClick={() => updatePairTradeStatusMutation.mutate('approved')}
                              disabled={updatePairTradeStatusMutation.isPending}
                            >
                              <CheckCircle2 className="h-4 w-4 mr-1" />
                              Commit
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => updatePairTradeStatusMutation.mutate('rejected')}
                              disabled={updatePairTradeStatusMutation.isPending}
                            >
                              <XCircle className="h-4 w-4 mr-1" />
                              Reject
                            </Button>
                          </>
                        )}
                        {/* Archive (for non-deciding stages) */}
                        {pairTrade.status !== 'deciding' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => updatePairTradeStatusMutation.mutate('cancelled')}
                            disabled={updatePairTradeStatusMutation.isPending}
                          >
                            Archive
                          </Button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Restore Actions for Archived Pair Trades */}
                  {(pairTrade.status === 'approved' || pairTrade.status === 'cancelled' || pairTrade.status === 'rejected') && (
                    <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                        Restore Pair Trade
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                        This pair trade is archived. You can restore it to an active status.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => updatePairTradeStatusMutation.mutate('idea')}
                          disabled={updatePairTradeStatusMutation.isPending}
                        >
                          <RotateCcw className="h-4 w-4 mr-1" />
                          Restore as Idea
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => updatePairTradeStatusMutation.mutate('discussing')}
                          disabled={updatePairTradeStatusMutation.isPending}
                        >
                          <MessageSquare className="h-4 w-4 mr-1" />
                          Restore as Discussing
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Metadata */}
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-4 text-xs text-gray-500 dark:text-gray-400">
                    <div className="flex items-center gap-1">
                      <User className="h-3 w-3" />
                      Created by {pairTrade.users ? getUserDisplayName(pairTrade.users) : 'Unknown'}
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      <Clock className="h-3 w-3" />
                      {formatDistanceToNow(new Date(pairTrade.created_at), { addSuffix: true })}
                    </div>
                  </div>
                </div>
              )}

              {/* Discussion Tab for Pair Trade */}
              {activeTab === 'discussion' && (
                <div className="flex flex-col h-full">
                  {/* Messages List */}
                  <div className="flex-1 overflow-y-auto p-4">
                    {discussionMessages.length > 0 ? (
                      <div className="space-y-0.5">
                        {discussionMessages.map((message, index) => {
                          const prevMessage = index > 0 ? discussionMessages[index - 1] : null
                          const isSameUser = prevMessage && prevMessage.user_id === message.user_id
                          const showUserInfo = !isSameUser
                          const isSelected = selectedMessageId === message.id

                          return (
                            <div key={message.id} className="group">
                              {showUserInfo ? (
                                <div
                                  className="flex items-start space-x-3 mt-3 first:mt-0 cursor-pointer"
                                  onClick={() => setSelectedMessageId(isSelected ? null : message.id)}
                                >
                                  <div className="w-6 h-6 bg-primary-100 dark:bg-primary-900/30 rounded-full flex items-center justify-center flex-shrink-0">
                                    <span className="text-primary-600 dark:text-primary-400 text-xs font-semibold">
                                      {getUserInitials(message.user)}
                                    </span>
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center space-x-2 mb-1">
                                      <span className="text-xs font-medium text-gray-900 dark:text-white">
                                        {getUserDisplayName(message.user)}
                                      </span>
                                      {message.is_pinned && <Pin className="h-3 w-3 text-warning-500" />}
                                    </div>
                                    {message.reply_to && (
                                      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1 flex items-center">
                                        <Reply className="h-3 w-3 mr-1" />
                                        Replying to message
                                      </div>
                                    )}
                                    <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                                      <SmartInputRenderer content={message.content} inline />
                                    </div>
                                    {isSelected && (
                                      <div className="flex items-center space-x-2 mt-2">
                                        <span className="text-xs text-gray-500 dark:text-gray-400">{formatMessageTime(message.created_at)}</span>
                                        <span className="text-gray-300 dark:text-gray-600">•</span>
                                        <button onClick={(e) => { e.stopPropagation(); setReplyToMessage(message.id); discussionInputRef.current?.focus() }} className="text-xs text-gray-500 hover:text-primary-600 dark:text-gray-400 dark:hover:text-primary-400 transition-colors">Reply</button>
                                        <button onClick={(e) => { e.stopPropagation(); toggleDiscussionPinMutation.mutate({ messageId: message.id, isPinned: message.is_pinned }) }} className="text-xs text-gray-500 hover:text-warning-600 dark:text-gray-400 dark:hover:text-warning-400 transition-colors">{message.is_pinned ? 'Unpin' : 'Pin'}</button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-start hover:bg-gray-50 dark:hover:bg-gray-700/50 -mx-2 px-2 py-0.5 rounded cursor-pointer" onClick={() => setSelectedMessageId(isSelected ? null : message.id)}>
                                  <div className="w-6 h-6 flex-shrink-0 mr-3"></div>
                                  <div className="flex-1 min-w-0">
                                    {message.reply_to && (
                                      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1 flex items-center">
                                        <Reply className="h-3 w-3 mr-1" />Replying to message
                                      </div>
                                    )}
                                    <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                                      <SmartInputRenderer content={message.content} inline />
                                    </div>
                                    {isSelected && (
                                      <div className="flex items-center space-x-2 mt-2">
                                        <span className="text-xs text-gray-500 dark:text-gray-400">{formatMessageTime(message.created_at)}</span>
                                        <span className="text-gray-300 dark:text-gray-600">•</span>
                                        <button onClick={(e) => { e.stopPropagation(); setReplyToMessage(message.id); discussionInputRef.current?.focus() }} className="text-xs text-gray-500 hover:text-primary-600 dark:text-gray-400 dark:hover:text-primary-400 transition-colors">Reply</button>
                                        <button onClick={(e) => { e.stopPropagation(); toggleDiscussionPinMutation.mutate({ messageId: message.id, isPinned: message.is_pinned }) }} className="text-xs text-gray-500 hover:text-warning-600 dark:text-gray-400 dark:hover:text-warning-400 transition-colors">{message.is_pinned ? 'Unpin' : 'Pin'}</button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })}
                        <div ref={messagesEndRef} className="h-4" />
                      </div>
                    ) : (
                      <div className="p-6 text-center text-gray-500 dark:text-gray-400">
                        <MessageCircle className="h-8 w-8 text-gray-400 dark:text-gray-500 mx-auto mb-2" />
                        <p className="text-sm">No discussion yet</p>
                        <p className="text-xs">Start the conversation about this trade!</p>
                      </div>
                    )}
                  </div>

                  {/* Message Input */}
                  <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex-shrink-0">
                    {replyToMessage && replyToMessageData && (
                      <div className="mb-2 p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <Reply className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                            <span className="text-xs font-medium text-blue-900 dark:text-blue-300">Replying to {getUserDisplayName(replyToMessageData.user)}</span>
                          </div>
                          <button onClick={() => setReplyToMessage(null)} className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200"><X className="h-3 w-3" /></button>
                        </div>
                        <p className="text-xs text-blue-700 dark:text-blue-300 mt-1 line-clamp-2">{replyToMessageData.content}</p>
                      </div>
                    )}
                    <div className="flex space-x-2">
                      <div className="flex-1">
                        <UniversalSmartInput ref={discussionInputRef} value={discussionMessage} onChange={(value, metadata) => { setDiscussionMessage(value); setDiscussionMetadata(metadata) }} onKeyDown={handleDiscussionKeyDown} placeholder="Add to the discussion..." textareaClassName="text-sm" rows={2} minHeight="60px" enableMentions={true} enableHashtags={true} enableTemplates={false} enableDataFunctions={false} enableAI={false} />
                      </div>
                      <button onClick={handleSendDiscussionMessage} disabled={!discussionMessage.trim() || sendDiscussionMessageMutation.isPending} className={clsx("self-end p-2 rounded-lg transition-colors", discussionMessage.trim() ? "bg-primary-600 text-white hover:bg-primary-700" : "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed")}><Send className="h-4 w-4" /></button>
                    </div>
                  </div>
                </div>
              )}

              {/* Activity Tab for Pair Trade */}
              {activeTab === 'activity' && (
                <div className="p-4">
                  <EntityTimeline
                    entityType="pair_trade"
                    entityId={tradeId}
                    showHeader={true}
                    collapsible={false}
                    excludeActions={['attach', 'detach']}
                  />
                </div>
              )}
            </>
          ) : trade ? (
            <>
              {/* Single Trade Details Tab */}
              {activeTab === 'details' && (
                <div className="p-4 space-y-4">
                  {/* Rationale - Top and Prominent */}
                  {(trade.thesis_summary || trade.rationale) && (
                    <div className="pb-4 border-b border-gray-200 dark:border-gray-700">
                      {trade.thesis_summary && (
                        <p className="text-base font-semibold text-gray-900 dark:text-white mb-2">
                          {trade.thesis_summary}
                        </p>
                      )}
                      {trade.rationale && (
                        <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
                          {trade.rationale}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Trade Labs Section - Collapsible */}
                  {(() => {
                    const expression = expressionCounts?.get(trade.id)
                    const labCount = expression?.count || 0

                    return (
                      <div className="bg-gray-50 dark:bg-gray-700/30 rounded-lg p-3">
                        <div className="flex items-center justify-between">
                          <button
                            onClick={() => setIsLabsExpanded(!isLabsExpanded)}
                            className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300"
                          >
                            <ChevronDown className={clsx("h-4 w-4 transition-transform", isLabsExpanded && "rotate-180")} />
                            <span>Trade Labs</span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">({labCount})</span>
                          </button>
                          <AddToLabDropdown
                            trade={trade as TradeQueueItemWithDetails}
                            existingLabIds={expression?.labIds || []}
                            onSuccess={() => {
                              queryClient.invalidateQueries({ queryKey: ['trade-lab-inclusion-counts'] })
                            }}
                          />
                        </div>

                        {isLabsExpanded && (
                          <div className="mt-3 space-y-1">
                            {labCount === 0 ? (
                              <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                                Not added to any portfolios yet
                              </p>
                            ) : (
                              expression?.portfolioNames?.map((portfolioName, idx) => (
                                <button
                                  key={expression.labIds[idx]}
                                  onClick={() => {
                                    window.dispatchEvent(new CustomEvent('openTradeLab', {
                                      detail: {
                                        labId: expression.labIds[idx],
                                        labName: expression.labNames[idx],
                                        portfolioId: expression.portfolioIds[idx]
                                      }
                                    }))
                                    onClose()
                                  }}
                                  className="flex items-center justify-between w-full px-3 py-2 text-sm text-left bg-white dark:bg-gray-700 rounded hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                                >
                                  <span className="text-gray-700 dark:text-gray-300">{portfolioName}</span>
                                  <span className="text-xs text-gray-400 dark:text-gray-500">{getPositionContext(expression.portfolioIds[idx])}</span>
                                </button>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })()}

              {/* Status Actions */}
              {trade.status !== 'approved' && trade.status !== 'cancelled' && trade.status !== 'rejected' && (
                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                    Actions
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {/* Idea stage: Work on it or Send to Simulation */}
                    {trade.status === 'idea' && (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => updateStatusMutation.mutate('discussing')}
                          disabled={updateStatusMutation.isPending}
                        >
                          <Wrench className="h-4 w-4 mr-1" />
                          Work on this
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => updateStatusMutation.mutate('simulating')}
                          disabled={updateStatusMutation.isPending}
                        >
                          <FlaskConical className="h-4 w-4 mr-1" />
                          Send to Simulation
                        </Button>
                      </>
                    )}
                    {/* Working On stage: Send to Simulation */}
                    {trade.status === 'discussing' && (
                      <Button
                        size="sm"
                        onClick={() => updateStatusMutation.mutate('simulating')}
                        disabled={updateStatusMutation.isPending}
                      >
                        <FlaskConical className="h-4 w-4 mr-1" />
                        Send to Simulation
                      </Button>
                    )}
                    {/* Simulating stage: Escalate to Deciding */}
                    {trade.status === 'simulating' && (
                      <Button
                        size="sm"
                        onClick={() => updateStatusMutation.mutate('deciding')}
                        disabled={updateStatusMutation.isPending}
                      >
                        <Scale className="h-4 w-4 mr-1" />
                        Escalate to Commit
                      </Button>
                    )}
                    {/* Commit stage: Commit or Reject */}
                    {trade.status === 'deciding' && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => updateStatusMutation.mutate('approved')}
                          disabled={updateStatusMutation.isPending}
                        >
                          <CheckCircle2 className="h-4 w-4 mr-1" />
                          Commit
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => updateStatusMutation.mutate('rejected')}
                          disabled={updateStatusMutation.isPending}
                        >
                          <XCircle className="h-4 w-4 mr-1" />
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => updateStatusMutation.mutate('simulating')}
                          disabled={updateStatusMutation.isPending}
                        >
                          <FlaskConical className="h-4 w-4 mr-1" />
                          Back to Simulation
                        </Button>
                      </>
                    )}
                    {/* Defer available for non-commit stages */}
                    {(trade.status === 'idea' || trade.status === 'discussing' || trade.status === 'simulating') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => updateStatusMutation.mutate('cancelled')}
                        disabled={updateStatusMutation.isPending}
                      >
                        Defer
                      </Button>
                    )}
                    {/* Delete button - available for all non-deleted items */}
                    {trade.status !== 'deleted' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setShowDeleteConfirm(true)}
                        className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* Restore Actions for Archived Items */}
              {(trade.status === 'approved' || trade.status === 'cancelled' || trade.status === 'rejected') && (
                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                    Restore Trade Idea
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                    This trade idea is archived. You can restore it to an active status.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => updateStatusMutation.mutate('idea')}
                      disabled={updateStatusMutation.isPending}
                    >
                      <RotateCcw className="h-4 w-4 mr-1" />
                      Restore to Ideas
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => updateStatusMutation.mutate('discussing')}
                      disabled={updateStatusMutation.isPending}
                    >
                      <Wrench className="h-4 w-4 mr-1" />
                      Restore to Working On
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => updateStatusMutation.mutate('simulating')}
                      disabled={updateStatusMutation.isPending}
                    >
                      <FlaskConical className="h-4 w-4 mr-1" />
                      Restore to Simulating
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowDeleteConfirm(true)}
                      className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      Delete
                    </Button>
                  </div>
                </div>
              )}

              {/* Restore Actions for Deleted Items */}
              {trade.status === 'deleted' && (
                <div className="border-t border-red-200 dark:border-red-800/50 pt-4 bg-red-50/50 dark:bg-red-900/10 -mx-4 px-4 pb-4 rounded-b-lg">
                  <h3 className="text-sm font-semibold text-red-700 dark:text-red-300 mb-3">
                    Restore Deleted Trade Idea
                  </h3>
                  <p className="text-xs text-red-600 dark:text-red-400 mb-3">
                    This trade idea was deleted. You can restore it to an active status.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => restoreMutation.mutate('idea')}
                      disabled={restoreMutation.isPending}
                    >
                      <RotateCcw className="h-4 w-4 mr-1" />
                      Restore to Ideas
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => restoreMutation.mutate('discussing')}
                      disabled={restoreMutation.isPending}
                    >
                      <Wrench className="h-4 w-4 mr-1" />
                      Restore to Working On
                    </Button>
                  </div>
                </div>
              )}

              {/* Metadata */}
              <div className="text-xs text-gray-500 dark:text-gray-400">
                <div className="flex items-center gap-1">
                  <User className="h-3 w-3" />
                  Created by {trade.users ? getUserDisplayName(trade.users) : 'Unknown'}
                </div>
                <div className="flex items-center gap-1 mt-1">
                  <Clock className="h-3 w-3" />
                  {formatDistanceToNow(new Date(trade.created_at), { addSuffix: true })}
                </div>
              </div>

              {/* Discussion Section */}
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                  Comments {discussionMessages.length > 0 && <span className="text-gray-400">· {discussionMessages.length}</span>}
                </h3>

                {/* Messages */}
                {discussionMessages.length > 0 && (
                  <div className="space-y-3 mb-4 max-h-36 overflow-y-auto">
                    {discussionMessages.map((message) => (
                      <div key={message.id} className="flex gap-2">
                        <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
                          <span className="text-[10px] font-medium text-gray-600 dark:text-gray-400">
                            {getUserInitials(message.user)}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2">
                            <span className="text-xs font-medium text-gray-900 dark:text-white">
                              {getUserDisplayName(message.user)}
                            </span>
                            <span className="text-[10px] text-gray-400">
                              {formatMessageTime(message.created_at)}
                            </span>
                          </div>
                          <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5">
                            <SmartInputRenderer content={message.content} inline />
                          </p>
                        </div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                )}

                {/* Input */}
                <div className="flex gap-2 items-center">
                  <input
                    ref={discussionInputRef as any}
                    type="text"
                    value={discussionMessage}
                    onChange={(e) => setDiscussionMessage(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendDiscussionMessage() }}}
                    placeholder="Add a comment..."
                    className="flex-1 h-9 px-3 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                  <button
                    onClick={handleSendDiscussionMessage}
                    disabled={!discussionMessage.trim() || sendDiscussionMessageMutation.isPending}
                    className={clsx(
                      "h-9 w-9 rounded-lg flex items-center justify-center transition-colors",
                      discussionMessage.trim()
                        ? "bg-primary-600 text-white hover:bg-primary-700"
                        : "bg-gray-100 dark:bg-gray-800 text-gray-400"
                    )}
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </div>
                </div>
              )}

              {/* Activity Tab for Single Trade */}
              {activeTab === 'activity' && (
                <div className="p-4">
                  <EntityTimeline
                    entityType="trade_idea"
                    entityId={tradeId}
                    showHeader={true}
                    collapsible={false}
                    excludeActions={['attach', 'detach']}
                  />
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowDeleteConfirm(false)}
          />
          <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Delete Trade Idea?
                </h3>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                  Are you sure you want to delete this trade idea? It will be moved to the deleted section and can be restored later if needed.
                </p>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => deleteTradeMutation.mutate()}
                disabled={deleteTradeMutation.isPending}
                loading={deleteTradeMutation.isPending}
              >
                <Trash2 className="h-4 w-4 mr-1.5" />
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
