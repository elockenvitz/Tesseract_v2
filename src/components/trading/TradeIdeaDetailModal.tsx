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
  Link2
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { UniversalSmartInput, SmartInputRenderer, type SmartInputMetadata } from '../smart-input'
import type { UniversalSmartInputRef } from '../smart-input'
import type {
  TradeQueueItemWithDetails,
  TradeQueueStatus
} from '../../types/trading'
import { clsx } from 'clsx'

type ModalTab = 'details' | 'discussion'

interface TradeIdeaDetailModalProps {
  isOpen: boolean
  tradeId: string
  onClose: () => void
}

const STATUS_CONFIG: Record<TradeQueueStatus, { label: string; color: string }> = {
  idea: { label: 'Idea', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  discussing: { label: 'Discussing', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' },
  approved: { label: 'Approved', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
  executed: { label: 'Executed', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' },
  cancelled: { label: 'Cancelled', color: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300' },
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
    enabled: isOpen && activeTab === 'discussion',
  })

  // Get reply-to message data
  const replyToMessageData = discussionMessages.find(m => m.id === replyToMessage)

  // Update status mutation for single trades
  const updateStatusMutation = useMutation({
    mutationFn: async (status: TradeQueueStatus) => {
      const updates: any = { status }
      if (status === 'approved') {
        updates.approved_by = user?.id
        updates.approved_at = new Date().toISOString()
      } else if (status === 'executed') {
        updates.executed_at = new Date().toISOString()
      }

      const { error } = await supabase
        .from('trade_queue_items')
        .update(updates)
        .eq('id', tradeId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-queue-item', tradeId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
    },
  })

  // Update status mutation for pair trades (updates pair_trades and all legs)
  const updatePairTradeStatusMutation = useMutation({
    mutationFn: async (status: TradeQueueStatus) => {
      // Update the pair_trades record
      const { error: pairError } = await supabase
        .from('pair_trades')
        .update({ status })
        .eq('id', tradeId)

      if (pairError) throw pairError

      // Update all associated trade_queue_items (legs)
      const legUpdates: any = { status }
      if (status === 'approved') {
        legUpdates.approved_by = user?.id
        legUpdates.approved_at = new Date().toISOString()
      } else if (status === 'executed') {
        legUpdates.executed_at = new Date().toISOString()
      }

      const { error: legsError } = await supabase
        .from('trade_queue_items')
        .update(legUpdates)
        .eq('pair_trade_id', tradeId)

      if (legsError) throw legsError
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-detail', tradeId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      queryClient.invalidateQueries({ queryKey: ['pair-trades'] })
    },
  })

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
              <div className="flex items-center gap-3">
                <div className={clsx(
                  "flex items-center gap-1 px-2 py-1 rounded font-medium",
                  trade.action === 'buy' || trade.action === 'add'
                    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                )}>
                  {trade.action === 'buy' || trade.action === 'add' ? (
                    <TrendingUp className="h-4 w-4" />
                  ) : (
                    <TrendingDown className="h-4 w-4" />
                  )}
                  <span className="uppercase text-sm">{trade.action}</span>
                </div>
                <div>
                  <span className="font-bold text-lg text-gray-900 dark:text-white">
                    {trade.assets?.symbol}
                  </span>
                  <span className="text-gray-500 dark:text-gray-400 ml-2">
                    {trade.assets?.company_name}
                  </span>
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
              onClick={() => setActiveTab('discussion')}
              className={clsx(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors",
                activeTab === 'discussion'
                  ? "bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300"
                  : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
              )}
            >
              <MessageCircle className="h-4 w-4" />
              Discussion
              {discussionMessages.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 text-xs bg-gray-200 dark:bg-gray-600 rounded-full">
                  {discussionMessages.length}
                </span>
              )}
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
                  {pairTrade.status !== 'executed' && pairTrade.status !== 'cancelled' && pairTrade.status !== 'rejected' && (
                    <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                        Actions
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {pairTrade.status !== 'approved' && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => updatePairTradeStatusMutation.mutate('approved')}
                            disabled={updatePairTradeStatusMutation.isPending}
                          >
                            <CheckCircle2 className="h-4 w-4 mr-1" />
                            Approve
                          </Button>
                        )}
                        {pairTrade.status === 'approved' && (
                          <Button
                            size="sm"
                            onClick={() => updatePairTradeStatusMutation.mutate('executed')}
                            disabled={updatePairTradeStatusMutation.isPending}
                          >
                            <TrendingUp className="h-4 w-4 mr-1" />
                            Mark Executed
                          </Button>
                        )}
                        {pairTrade.status !== 'rejected' && (
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => updatePairTradeStatusMutation.mutate('rejected')}
                            disabled={updatePairTradeStatusMutation.isPending}
                          >
                            <XCircle className="h-4 w-4 mr-1" />
                            Reject
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => updatePairTradeStatusMutation.mutate('cancelled')}
                          disabled={updatePairTradeStatusMutation.isPending}
                        >
                          Archive
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Restore Actions for Archived Pair Trades */}
                  {(pairTrade.status === 'executed' || pairTrade.status === 'cancelled' || pairTrade.status === 'rejected') && (
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
            </>
          ) : trade ? (
            <>
              {/* Single Trade Details Tab */}
              {activeTab === 'details' && (
                <div className="p-4 space-y-6">
                  {/* Status and Urgency */}
              <div className="flex items-center gap-3">
                <span className={clsx("px-3 py-1 rounded-full text-sm font-medium", STATUS_CONFIG[trade.status].color)}>
                  {STATUS_CONFIG[trade.status].label}
                </span>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  Urgency: <span className="font-medium capitalize">{trade.urgency}</span>
                </span>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  Portfolio: <span className="font-medium">{trade.portfolios?.name}</span>
                </span>
              </div>

              {/* Sizing Info */}
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Proposed Sizing
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-2xl font-bold text-gray-900 dark:text-white">
                      {trade.proposed_weight ? `${trade.proposed_weight.toFixed(2)}%` : '—'}
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">Target Weight</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-gray-900 dark:text-white">
                      {trade.proposed_shares ? trade.proposed_shares.toLocaleString() : '—'}
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">Shares</div>
                  </div>
                </div>
                {trade.target_price && (
                  <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-600">
                    <span className="text-sm text-gray-500 dark:text-gray-400">Target Price: </span>
                    <span className="font-semibold text-gray-900 dark:text-white">${trade.target_price.toFixed(2)}</span>
                  </div>
                )}
              </div>

              {/* Thesis & Rationale */}
              {(trade.thesis_summary || trade.rationale) && (
                <div>
                  {trade.thesis_summary && (
                    <div className="mb-3">
                      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
                        Thesis Summary
                      </h3>
                      <p className="text-gray-900 dark:text-white">{trade.thesis_summary}</p>
                    </div>
                  )}
                  {trade.rationale && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
                        Rationale
                      </h3>
                      <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{trade.rationale}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Status Actions */}
              {trade.status !== 'executed' && trade.status !== 'cancelled' && trade.status !== 'rejected' && (
                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                    Actions
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {trade.status !== 'approved' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => updateStatusMutation.mutate('approved')}
                        disabled={updateStatusMutation.isPending}
                      >
                        <CheckCircle2 className="h-4 w-4 mr-1" />
                        Approve
                      </Button>
                    )}
                    {trade.status === 'approved' && (
                      <Button
                        size="sm"
                        onClick={() => updateStatusMutation.mutate('executed')}
                        disabled={updateStatusMutation.isPending}
                      >
                        <TrendingUp className="h-4 w-4 mr-1" />
                        Mark Executed
                      </Button>
                    )}
                    {trade.status !== 'rejected' && (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => updateStatusMutation.mutate('rejected')}
                        disabled={updateStatusMutation.isPending}
                      >
                        <XCircle className="h-4 w-4 mr-1" />
                        Reject
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => updateStatusMutation.mutate('cancelled')}
                      disabled={updateStatusMutation.isPending}
                    >
                      Archive
                    </Button>
                  </div>
                </div>
              )}

              {/* Restore Actions for Archived Items */}
              {(trade.status === 'executed' || trade.status === 'cancelled' || trade.status === 'rejected') && (
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
                      Restore as Idea
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => updateStatusMutation.mutate('discussing')}
                      disabled={updateStatusMutation.isPending}
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
                  Created by {trade.users ? getUserDisplayName(trade.users) : 'Unknown'}
                </div>
                <div className="flex items-center gap-1 mt-1">
                  <Clock className="h-3 w-3" />
                  {formatDistanceToNow(new Date(trade.created_at), { addSuffix: true })}
                </div>
              </div>
                </div>
              )}

              {/* Discussion Tab */}
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
                                      {message.is_pinned && (
                                        <Pin className="h-3 w-3 text-warning-500" />
                                      )}
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
                                        <span className="text-xs text-gray-500 dark:text-gray-400">
                                          {formatMessageTime(message.created_at)}
                                        </span>
                                        <span className="text-gray-300 dark:text-gray-600">•</span>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            setReplyToMessage(message.id)
                                            discussionInputRef.current?.focus()
                                          }}
                                          className="text-xs text-gray-500 hover:text-primary-600 dark:text-gray-400 dark:hover:text-primary-400 transition-colors"
                                        >
                                          Reply
                                        </button>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            toggleDiscussionPinMutation.mutate({ messageId: message.id, isPinned: message.is_pinned })
                                          }}
                                          className="text-xs text-gray-500 hover:text-warning-600 dark:text-gray-400 dark:hover:text-warning-400 transition-colors"
                                        >
                                          {message.is_pinned ? 'Unpin' : 'Pin'}
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <div
                                  className="flex items-start hover:bg-gray-50 dark:hover:bg-gray-700/50 -mx-2 px-2 py-0.5 rounded cursor-pointer"
                                  onClick={() => setSelectedMessageId(isSelected ? null : message.id)}
                                >
                                  <div className="w-6 h-6 flex-shrink-0 mr-3"></div>
                                  <div className="flex-1 min-w-0">
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
                                        <span className="text-xs text-gray-500 dark:text-gray-400">
                                          {formatMessageTime(message.created_at)}
                                        </span>
                                        <span className="text-gray-300 dark:text-gray-600">•</span>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            setReplyToMessage(message.id)
                                            discussionInputRef.current?.focus()
                                          }}
                                          className="text-xs text-gray-500 hover:text-primary-600 dark:text-gray-400 dark:hover:text-primary-400 transition-colors"
                                        >
                                          Reply
                                        </button>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            toggleDiscussionPinMutation.mutate({ messageId: message.id, isPinned: message.is_pinned })
                                          }}
                                          className="text-xs text-gray-500 hover:text-warning-600 dark:text-gray-400 dark:hover:text-warning-400 transition-colors"
                                        >
                                          {message.is_pinned ? 'Unpin' : 'Pin'}
                                        </button>
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
                        <p className="text-xs">Start the conversation about this trade idea!</p>
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
                            <span className="text-xs font-medium text-blue-900 dark:text-blue-300">
                              Replying to {getUserDisplayName(replyToMessageData.user)}
                            </span>
                          </div>
                          <button
                            onClick={() => setReplyToMessage(null)}
                            className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                        <p className="text-xs text-blue-700 dark:text-blue-300 mt-1 line-clamp-2">
                          {replyToMessageData.content}
                        </p>
                      </div>
                    )}

                    <div className="flex space-x-2">
                      <div className="flex-1">
                        <UniversalSmartInput
                          ref={discussionInputRef}
                          value={discussionMessage}
                          onChange={(value, metadata) => {
                            setDiscussionMessage(value)
                            setDiscussionMetadata(metadata)
                          }}
                          onKeyDown={handleDiscussionKeyDown}
                          placeholder="Add to the discussion..."
                          textareaClassName="text-sm"
                          rows={2}
                          minHeight="60px"
                          enableMentions={true}
                          enableHashtags={true}
                          enableTemplates={false}
                          enableDataFunctions={false}
                          enableAI={false}
                        />
                      </div>
                      <button
                        onClick={handleSendDiscussionMessage}
                        disabled={!discussionMessage.trim() || sendDiscussionMessageMutation.isPending}
                        className={clsx(
                          "self-end p-2 rounded-lg transition-colors",
                          discussionMessage.trim()
                            ? "bg-primary-600 text-white hover:bg-primary-700"
                            : "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed"
                        )}
                      >
                        <Send className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
