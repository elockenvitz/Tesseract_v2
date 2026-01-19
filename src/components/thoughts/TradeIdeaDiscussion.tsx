import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, MessageCircle, Send, TrendingUp, TrendingDown,
  Clock, Pin, Reply, X, ArrowLeftRight, Zap, FolderKanban,
  Globe, Users, Lock
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { formatDistanceToNow, format, differenceInMinutes } from 'date-fns'
import { clsx } from 'clsx'
import { UniversalSmartInput, SmartInputRenderer, type SmartInputMetadata } from '../smart-input'
import type { UniversalSmartInputRef } from '../smart-input'

interface TradeIdeaDiscussionProps {
  tradeId: string
  tradeTitle: string
  onBack: () => void
}

interface Message {
  id: string
  content: string
  user_id: string
  context_type: string
  context_id: string
  created_at: string
  user: any
  is_pinned: boolean
  reply_to: string | null
}

type TradeUrgency = 'low' | 'medium' | 'high' | 'urgent'
type Visibility = 'private' | 'team' | 'public'

const urgencyConfig: Record<TradeUrgency, { label: string; color: string; bg: string }> = {
  low: { label: 'Low', color: 'text-gray-600', bg: 'bg-gray-100' },
  medium: { label: 'Medium', color: 'text-blue-600', bg: 'bg-blue-100' },
  high: { label: 'High', color: 'text-orange-600', bg: 'bg-orange-100' },
  urgent: { label: 'Urgent', color: 'text-red-600', bg: 'bg-red-100' }
}

const visibilityIcons: Record<Visibility, typeof Globe> = {
  public: Globe,
  team: Users,
  private: Lock
}

export function TradeIdeaDiscussion({ tradeId, tradeTitle, onBack }: TradeIdeaDiscussionProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const smartInputRef = useRef<UniversalSmartInputRef>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const [messageContent, setMessageContent] = useState('')
  const [inputMetadata, setInputMetadata] = useState<SmartInputMetadata>({ mentions: [], references: [], dataSnapshots: [], aiContent: [] })
  const [replyToMessage, setReplyToMessage] = useState<string | null>(null)
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)

  // Fetch trade idea details - check both pair_trades and trade_queue_items
  const { data: tradeDetails } = useQuery({
    queryKey: ['trade-idea-details', tradeId],
    queryFn: async () => {
      // First try pair_trades
      const { data: pairTrade } = await supabase
        .from('pair_trades')
        .select(`
          *,
          portfolios:portfolio_id(id, name),
          trade_queue_items!trade_queue_items_pair_trade_id_fkey(
            *,
            assets:asset_id(id, symbol, company_name)
          )
        `)
        .eq('id', tradeId)
        .maybeSingle()

      if (pairTrade) {
        return { type: 'pair', data: pairTrade }
      }

      // Try trade_queue_items
      const { data: tradeItem } = await supabase
        .from('trade_queue_items')
        .select(`
          *,
          assets:asset_id(id, symbol, company_name),
          portfolios:portfolio_id(id, name)
        `)
        .eq('id', tradeId)
        .maybeSingle()

      if (tradeItem) {
        return { type: 'single', data: tradeItem }
      }

      return null
    }
  })

  // Fetch messages for this trade idea
  const { data: messages = [], isLoading } = useQuery({
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
    }
  })

  // Get reply-to message data
  const replyToMessageData = messages.find(m => m.id === replyToMessage)

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async (data: { content: string; reply_to?: string }) => {
      if (!user?.id) {
        throw new Error('You must be logged in to send messages')
      }

      const { error } = await supabase
        .from('messages')
        .insert([{
          content: data.content,
          context_type: 'trade_idea',
          context_id: tradeId,
          user_id: user.id,
          reply_to: data.reply_to || null
        }])

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', 'trade_idea', tradeId] })
      setMessageContent('')
      setReplyToMessage(null)
      // Clear the input ref as well
      if (smartInputRef.current) {
        smartInputRef.current.focus()
      }
      scrollToBottom()
    },
    onError: (error) => {
      console.error('Failed to send message:', error)
    }
  })

  // Toggle pin mutation
  const togglePinMutation = useMutation({
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

  const handleSendMessage = () => {
    if (!messageContent.trim() || !user?.id) return

    sendMessageMutation.mutate({
      content: messageContent.trim(),
      reply_to: replyToMessage || undefined
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const handleReply = (messageId: string) => {
    setReplyToMessage(messageId)
    smartInputRef.current?.focus()
  }

  const getUserDisplayName = (user: any) => {
    if (user?.first_name && user?.last_name) {
      return `${user.first_name} ${user.last_name}`
    }
    return user?.email || 'Unknown User'
  }

  const getUserInitials = (user: any) => {
    if (user?.first_name && user?.last_name) {
      return `${user.first_name[0]}${user.last_name[0]}`.toUpperCase()
    }
    const name = getUserDisplayName(user)
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
  }

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

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Render trade idea header
  const renderTradeHeader = () => {
    if (!tradeDetails) return null

    if (tradeDetails.type === 'pair') {
      const pair = tradeDetails.data
      const items = pair.trade_queue_items || []
      const longs = items.filter((t: any) => t.pair_leg_type === 'long')
      const shorts = items.filter((t: any) => t.pair_leg_type === 'short')
      const urgencyInfo = urgencyConfig[pair.urgency as TradeUrgency] || urgencyConfig.medium
      const VisibilityIcon = visibilityIcons[(pair.visibility as Visibility) || 'private']

      return (
        <div className="p-3 bg-gray-50 border-b border-gray-200">
          <div className="flex items-start gap-2 mb-2">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-purple-50 text-purple-600">
              <ArrowLeftRight className="h-3 w-3" />
              Pair Trade
            </span>
            <span className={clsx("px-1.5 py-0.5 rounded text-xs font-medium", urgencyInfo.bg, urgencyInfo.color)}>
              {urgencyInfo.label}
            </span>
          </div>

          {/* Pair legs */}
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div className="bg-green-50/50 border border-green-100 rounded-md p-2">
              <div className="flex items-center gap-1 mb-1">
                <TrendingUp className="h-3 w-3 text-green-600" />
                <span className="text-xs font-medium text-green-700">Long</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {longs.map((t: any) => (
                  <span key={t.id} className="text-xs font-medium text-gray-700">
                    {t.assets?.symbol}
                  </span>
                ))}
              </div>
            </div>
            <div className="bg-red-50/50 border border-red-100 rounded-md p-2">
              <div className="flex items-center gap-1 mb-1">
                <TrendingDown className="h-3 w-3 text-red-600" />
                <span className="text-xs font-medium text-red-700">Short</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {shorts.map((t: any) => (
                  <span key={t.id} className="text-xs font-medium text-gray-700">
                    {t.assets?.symbol}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {pair.rationale && (
            <p className="text-xs text-gray-600 mb-2">{pair.rationale}</p>
          )}

          <div className="flex items-center gap-3 text-xs text-gray-400">
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span>{formatDistanceToNow(new Date(pair.created_at), { addSuffix: true })}</span>
            </div>
            {pair.portfolios && (
              <div className="flex items-center gap-1">
                <FolderKanban className="h-3 w-3" />
                <span>{pair.portfolios.name}</span>
              </div>
            )}
            <div className="flex items-center gap-1">
              <VisibilityIcon className="h-3 w-3" />
              <span className="capitalize">{pair.visibility || 'private'}</span>
            </div>
          </div>
        </div>
      )
    } else {
      const trade = tradeDetails.data
      const isLong = trade.action === 'buy' || trade.action === 'add'
      const urgencyInfo = urgencyConfig[trade.urgency as TradeUrgency] || urgencyConfig.medium
      const VisibilityIcon = visibilityIcons[(trade.visibility as Visibility) || 'private']

      return (
        <div className="p-3 bg-gray-50 border-b border-gray-200">
          <div className="flex items-start gap-2 mb-2">
            <span className={clsx(
              "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium",
              isLong ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"
            )}>
              {isLong ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {trade.action.toUpperCase()}
            </span>
            <span className={clsx("px-1.5 py-0.5 rounded text-xs font-medium", urgencyInfo.bg, urgencyInfo.color)}>
              {urgencyInfo.label}
            </span>
          </div>

          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-semibold text-gray-900">{trade.assets?.symbol}</span>
            <span className="text-xs text-gray-500">{trade.assets?.company_name}</span>
          </div>

          {trade.rationale && (
            <p className="text-xs text-gray-600 mb-2">{trade.rationale}</p>
          )}

          <div className="flex items-center gap-3 text-xs text-gray-400">
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span>{formatDistanceToNow(new Date(trade.created_at), { addSuffix: true })}</span>
            </div>
            {trade.portfolios && (
              <div className="flex items-center gap-1">
                <FolderKanban className="h-3 w-3" />
                <span>{trade.portfolios.name}</span>
              </div>
            )}
            <div className="flex items-center gap-1">
              <VisibilityIcon className="h-3 w-3" />
              <span className="capitalize">{trade.visibility || 'private'}</span>
            </div>
          </div>
        </div>
      )
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with back button */}
      <div className="flex items-center gap-2 p-3 border-b border-gray-200 bg-white">
        <button
          onClick={onBack}
          className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-gray-900 truncate">{tradeTitle}</h3>
          <p className="text-xs text-gray-500">Trade Discussion</p>
        </div>
      </div>

      {/* Trade idea details */}
      {renderTradeHeader()}

      {/* Messages List */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className="h-full overflow-y-auto custom-scrollbar">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="animate-pulse">
                  <div className="flex items-start space-x-3">
                    <div className="w-6 h-6 bg-gray-200 rounded-full"></div>
                    <div className="flex-1 space-y-2">
                      <div className="h-3 bg-gray-200 rounded w-1/4"></div>
                      <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : messages.length > 0 ? (
            <div className="p-4 space-y-0.5">
              {messages.map((message, index) => {
                const prevMessage = index > 0 ? messages[index - 1] : null
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
                        <div className="w-6 h-6 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-primary-600 text-xs font-semibold">
                            {getUserInitials(message.user)}
                          </span>
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2 mb-1">
                            <span className="text-xs font-medium text-gray-900">
                              {getUserDisplayName(message.user)}
                            </span>
                            {message.is_pinned && (
                              <Pin className="h-3 w-3 text-warning-500" />
                            )}
                          </div>

                          {message.reply_to && (
                            <div className="text-xs text-gray-500 mb-1 flex items-center">
                              <Reply className="h-3 w-3 mr-1" />
                              Replying to message
                            </div>
                          )}

                          <div className="text-sm text-gray-700 whitespace-pre-wrap">
                            <SmartInputRenderer content={message.content} inline />
                          </div>

                          {isSelected && (
                            <div className="flex items-center space-x-2 mt-2">
                              <span className="text-xs text-gray-500">
                                {formatMessageTime(message.created_at)}
                              </span>
                              <span className="text-gray-300">•</span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleReply(message.id)
                                }}
                                className="text-xs text-gray-500 hover:text-primary-600 transition-colors"
                              >
                                Reply
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  togglePinMutation.mutate({ messageId: message.id, isPinned: message.is_pinned })
                                }}
                                className="text-xs text-gray-500 hover:text-warning-600 transition-colors"
                              >
                                {message.is_pinned ? 'Unpin' : 'Pin'}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div
                        className="flex items-start hover:bg-gray-50 -mx-2 px-2 py-0.5 rounded cursor-pointer"
                        onClick={() => setSelectedMessageId(isSelected ? null : message.id)}
                      >
                        <div className="w-6 h-6 flex-shrink-0 mr-3"></div>
                        <div className="flex-1 min-w-0">
                          {message.reply_to && (
                            <div className="text-xs text-gray-500 mb-1 flex items-center">
                              <Reply className="h-3 w-3 mr-1" />
                              Replying to message
                            </div>
                          )}

                          <div className="text-sm text-gray-700 whitespace-pre-wrap">
                            <SmartInputRenderer content={message.content} inline />
                          </div>

                          {isSelected && (
                            <div className="flex items-center space-x-2 mt-2">
                              <span className="text-xs text-gray-500">
                                {formatMessageTime(message.created_at)}
                              </span>
                              <span className="text-gray-300">•</span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleReply(message.id)
                                }}
                                className="text-xs text-gray-500 hover:text-primary-600 transition-colors"
                              >
                                Reply
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  togglePinMutation.mutate({ messageId: message.id, isPinned: message.is_pinned })
                                }}
                                className="text-xs text-gray-500 hover:text-warning-600 transition-colors"
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
            <div className="p-6 text-center text-gray-500">
              <MessageCircle className="h-8 w-8 text-gray-400 mx-auto mb-2" />
              <p className="text-sm">No discussion yet</p>
              <p className="text-xs">Start the conversation about this trade idea!</p>
            </div>
          )}
        </div>
      </div>

      {/* Message Input */}
      <div className="p-3 border-t border-gray-200 bg-white flex-shrink-0">
        {replyToMessage && replyToMessageData && (
          <div className="mb-2 p-2 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Reply className="h-3 w-3 text-blue-600" />
                <span className="text-xs font-medium text-blue-900">
                  Replying to {getUserDisplayName(replyToMessageData.user)}
                </span>
              </div>
              <button
                onClick={() => setReplyToMessage(null)}
                className="text-blue-600 hover:text-blue-800"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            <p className="text-xs text-blue-700 mt-1 line-clamp-2">
              {replyToMessageData.content}
            </p>
          </div>
        )}

        <div className="flex items-end gap-2">
          <div className="flex-1 min-w-0">
            <UniversalSmartInput
              ref={smartInputRef}
              value={messageContent}
              onChange={(value, metadata) => {
                setMessageContent(value)
                setInputMetadata(metadata)
              }}
              onKeyDown={handleKeyDown}
              placeholder="Add to the discussion... Use @ to mention users"
              textareaClassName="text-sm p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
              rows={2}
              minHeight="56px"
              enableMentions={true}
              enableHashtags={true}
              enableTemplates={false}
              enableDataFunctions={false}
              enableAI={false}
            />
          </div>
          <button
            onClick={handleSendMessage}
            disabled={!messageContent.trim() || !user?.id || sendMessageMutation.isPending}
            className={clsx(
              "flex-shrink-0 p-2.5 rounded-lg transition-colors",
              messageContent.trim() && user?.id
                ? "bg-primary-600 text-white hover:bg-primary-700"
                : "bg-gray-200 text-gray-400 cursor-not-allowed"
            )}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
