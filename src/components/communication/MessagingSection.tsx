import React, { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MessageCircle, Send, Users, Settings, Quote, X, ChevronDown, Search, Filter, Calendar, User, Pin, Reply, MoreVertical, ArrowLeft, Eye } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { Card } from '../ui/Card'
import { formatDistanceToNow, format, differenceInMinutes } from 'date-fns'
import { clsx } from 'clsx'
import { UniversalSmartInput, SmartInputRenderer, type SmartInputMetadata } from '../smart-input'
import type { UniversalSmartInputRef } from '../smart-input'

interface MessagingSectionProps {
  contextType?: string
  contextId?: string
  contextTitle?: string
  citedContent?: string
  fieldName?: string
  onCite?: (content: string, fieldName?: string) => void
  onContextChange?: (contextType: string, contextId: string, contextTitle: string, contextData?: any) => void
  onShowCoverageManager?: () => void
  onBack?: () => void
  onFocusMode?: (enable: boolean) => void
  isFocusMode?: boolean
  isOpen?: boolean
}

interface Message {
  id: string
  content: string
  user_id: string
  context_type: string
  context_id: string
  field_name: string | null
  created_at: string
  user: any
  is_pinned: boolean
  reply_to: string | null
  cited_content: string | null
}

export function MessagingSection({
  contextType,
  contextId,
  contextTitle,
  citedContent,
  fieldName,
  onCite,
  onContextChange,
  onShowCoverageManager,
  onBack,
  onFocusMode,
  isFocusMode = false,
  isOpen = true
}: MessagingSectionProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const smartInputRef = useRef<UniversalSmartInputRef>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const [messageContent, setMessageContent] = useState('')
  const [inputMetadata, setInputMetadata] = useState<SmartInputMetadata>({ mentions: [], references: [], dataSnapshots: [], aiContent: [] })
  const [searchQuery, setSearchQuery] = useState('')
  const [filterBy, setFilterBy] = useState<'all' | 'pinned' | 'replies'>('all')
  const [replyToMessage, setReplyToMessage] = useState<string | null>(null)
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)

  // Fetch recent conversations (when no context is selected)
  const { data: recentConversations, isLoading: conversationsLoading } = useQuery({
    queryKey: ['recent-conversations', user?.id],
    enabled: !contextType && !contextId && !!user?.id, // Don't disable when pane closes - rely on staleTime instead
    staleTime: 60000, // Consider data fresh for 60 seconds
    gcTime: 300000, // Keep in cache for 5 minutes
    queryFn: async () => {
      console.log('🔍 Starting recentConversations query, user:', user?.id)
      if (!user?.id) {
        console.log('❌ No user ID, returning empty array')
        return []
      }

      // Get distinct contexts with recent messages
      const { data, error } = await supabase
        .from('messages')
        .select(`
          context_type,
          context_id,
          created_at,
          content,
          is_read,
          user_id
        `)
        .order('created_at', { ascending: false })
        .limit(100)

      if (error) {
        console.error('❌ Error fetching messages:', error)
        throw error
      }

      console.log('📨 Fetched messages count:', data?.length || 0)

      // Group by context and get the most recent message for each
      const contextMap = new Map()
      data?.forEach(msg => {
        const key = `${msg.context_type}:${msg.context_id}`
        if (!contextMap.has(key)) {
          contextMap.set(key, {
            context_type: msg.context_type,
            context_id: msg.context_id,
            last_message: msg.content,
            last_message_at: msg.created_at,
            has_unread: !msg.is_read && msg.user_id !== user.id // Only unread if from another user
          })
        } else if (!msg.is_read && msg.user_id !== user.id) {
          // Update unread status only for messages from other users
          const existing = contextMap.get(key)
          existing.has_unread = true
        }
      })

      const conversations = Array.from(contextMap.values()).slice(0, 20)
      console.log('📊 Grouped conversations count:', conversations.length)

      // Fetch names for each context
      const conversationsWithNames = await Promise.all(
        conversations.map(async (conv) => {
          console.log('🔎 Fetching name for:', conv.context_type, conv.context_id)
          let contextName = conv.context_type
          let contextData: any = { id: conv.context_id }

          try {
            if (conv.context_type === 'asset') {
              const { data: asset, error } = await supabase
                .from('assets')
                .select('*')
                .eq('id', conv.context_id)
                .maybeSingle()

              if (error) console.error('Error fetching asset:', error)
              contextName = asset ? `${asset.symbol} - ${asset.company_name}` : 'Unknown Asset'
              if (asset) {
                contextData = asset
              }
            } else if (conv.context_type === 'theme') {
              const { data: theme, error } = await supabase
                .from('themes')
                .select('*')
                .eq('id', conv.context_id)
                .maybeSingle()

              if (error) console.error('Error fetching theme:', error)
              contextName = theme?.name || 'Unknown Theme'
              if (theme) {
                contextData = theme
              }
            } else if (conv.context_type === 'portfolio') {
              const { data: portfolio, error } = await supabase
                .from('portfolios')
                .select('name')
                .eq('id', conv.context_id)
                .maybeSingle()

              if (error) console.error('Error fetching portfolio:', error)
              contextName = portfolio?.name || 'Unknown Portfolio'
              if (portfolio) {
                contextData = { id: conv.context_id, name: portfolio.name }
              }
            } else if (conv.context_type === 'note') {
              // Try to find note in different note tables
              let noteTitle = null

              // Try asset_notes
              const { data: assetNote } = await supabase
                .from('asset_notes')
                .select('title')
                .eq('id', conv.context_id)
                .maybeSingle()

              if (assetNote) {
                noteTitle = assetNote.title
              } else {
                // Try theme_notes
                const { data: themeNote } = await supabase
                  .from('theme_notes')
                  .select('title')
                  .eq('id', conv.context_id)
                  .maybeSingle()

                if (themeNote) {
                  noteTitle = themeNote.title
                } else {
                  // Try portfolio_notes
                  const { data: portfolioNote } = await supabase
                    .from('portfolio_notes')
                    .select('title')
                    .eq('id', conv.context_id)
                    .maybeSingle()

                  if (portfolioNote) {
                    noteTitle = portfolioNote.title
                  } else {
                    // Try custom_notebook_notes
                    const { data: customNote } = await supabase
                      .from('custom_notebook_notes')
                      .select('title')
                      .eq('id', conv.context_id)
                      .maybeSingle()

                    if (customNote) {
                      noteTitle = customNote.title
                    }
                  }
                }
              }

              contextName = noteTitle || 'Note Discussion'
            }
          } catch (err) {
            console.error('Error fetching context name:', err)
          }

          console.log('✅ Conversation context:', conv.context_type, conv.context_id, '->', contextName, 'data:', contextData)

          return {
            ...conv,
            context_name: contextName,
            context_data: contextData
          }
        })
      )

      console.log('🎉 Final conversations with names:', conversationsWithNames.length, conversationsWithNames)
      return conversationsWithNames
    }
  })

  // Fetch messages
  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['messages', contextType, contextId],
    queryFn: async () => {
      if (!contextType || !contextId) return []

      const { data, error } = await supabase
        .from('messages')
        .select(`
          *,
          user:users(id, email, first_name, last_name)
        `)
        .eq('context_type', contextType)
        .eq('context_id', contextId)
        .order('created_at', { ascending: true })

      if (error) throw error
      return data
    },
    enabled: !!(contextType && contextId),
    staleTime: 60000, // Consider data fresh for 60 seconds
    refetchOnMount: false, // Don't refetch when switching back to this view
    refetchOnWindowFocus: false, // Don't refetch on window focus
  })

  // Get reply-to message data
  const replyToMessageData = messages.find(m => m.id === replyToMessage)

  // Filter messages
  const filteredMessages = messages.filter(message => {
    const matchesSearch = message.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         getUserDisplayName(message.user).toLowerCase().includes(searchQuery.toLowerCase())
    
    const matchesFilter = filterBy === 'all' || 
                         (filterBy === 'pinned' && message.is_pinned) ||
                         (filterBy === 'replies' && message.reply_to)
    
    return matchesSearch && matchesFilter
  })

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async (data: {
      content: string
      context_type: string
      context_id: string
      field_name?: string
      cited_content?: string
      reply_to?: string
    }) => {
      const { error } = await supabase
        .from('messages')
        .insert([{
          ...data,
          user_id: user?.id
        }])

      if (error) throw error

      // Check for @ mentions in the message content
      const mentionRegex = /@\[([^\]]+)\]\(user:([a-f0-9-]+)\)/g
      const mentions = []
      let match
      while ((match = mentionRegex.exec(data.content)) !== null) {
        mentions.push({
          displayName: match[1],
          userId: match[2]
        })
      }

      // Process mentioned users
      if (mentions.length > 0) {
        const uniqueMentions = mentions.filter((mention, index, self) =>
          mention.userId !== user?.id && // Don't notify yourself
          index === self.findIndex(m => m.userId === mention.userId) // Remove duplicates
        )

        // Create notifications for each mentioned user
        const notifications = uniqueMentions.map(mention => ({
          user_id: mention.userId,
          type: 'mention',
          title: 'You were mentioned',
          message: `${user?.first_name || user?.email?.split('@')[0] || 'Someone'} mentioned you in ${contextTitle || 'a discussion'}`,
          context_type: data.context_type,
          context_id: data.context_id,
          context_data: {
            message_content: data.content.substring(0, 200), // First 200 chars
            mentioned_by: user?.id,
            context_title: contextTitle
          }
        }))

        if (notifications.length > 0) {
          await supabase.from('notifications').insert(notifications)
        }

        // Auto-grant read access to mentioned users for the context
        if (data.context_type === 'theme') {
          // Check which users don't already have access
          const { data: existingCollabs } = await supabase
            .from('theme_collaborations')
            .select('user_id')
            .eq('theme_id', data.context_id)
            .in('user_id', uniqueMentions.map(m => m.userId))

          const existingUserIds = new Set(existingCollabs?.map(c => c.user_id) || [])
          const newCollaborators = uniqueMentions
            .filter(m => !existingUserIds.has(m.userId))
            .map(m => ({
              theme_id: data.context_id,
              user_id: m.userId,
              permission: 'read' as const,
              invited_by: user?.id
            }))

          if (newCollaborators.length > 0) {
            await supabase.from('theme_collaborations').insert(newCollaborators)
          }
        } else if (data.context_type === 'note') {
          // Check which users don't already have access
          const { data: existingCollabs } = await supabase
            .from('note_collaborations')
            .select('user_id')
            .eq('note_id', data.context_id)
            .in('user_id', uniqueMentions.map(m => m.userId))

          const existingUserIds = new Set(existingCollabs?.map(c => c.user_id) || [])
          const newCollaborators = uniqueMentions
            .filter(m => !existingUserIds.has(m.userId))
            .map(m => ({
              note_id: data.context_id,
              note_type: 'custom', // Default note type for mentions
              user_id: m.userId,
              permission: 'read' as const,
              invited_by: user?.id
            }))

          if (newCollaborators.length > 0) {
            await supabase.from('note_collaborations').insert(newCollaborators)
          }
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', contextType, contextId] })
      setMessageContent('')
      setReplyToMessage(null)
      scrollToBottom()
    }
  })

  // Toggle pin mutation
  const togglePinMutation = useMutation({
    mutationFn: async ({ messageId, isPinned }: { messageId: string, isPinned: boolean }) => {
      const { error } = await supabase
        .from('messages')
        .update({ is_pinned: !isPinned })
        .eq('id', messageId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', contextType, contextId] })
    }
  })

  // Mark messages as read mutation
  const markMessagesAsReadMutation = useMutation({
    mutationFn: async (messageIds: string[]) => {
      if (messageIds.length === 0) return

      console.log('💾 Attempting to mark messages as read:', messageIds)
      console.log('💾 Current user ID:', user?.id)

      const { data, error, status, statusText } = await supabase
        .from('messages')
        .update({
          is_read: true,
          read_at: new Date().toISOString()
        })
        .in('id', messageIds)
        .select()

      console.log('📊 Update response - status:', status, 'statusText:', statusText, 'data:', data, 'error:', error)

      if (error) {
        console.error('❌ Error marking messages as read:', error)
        throw error
      }

      console.log('✅ Successfully marked messages as read:', data?.length || 0, 'messages updated', 'data:', data)
    },
    onSuccess: () => {
      console.log('🔄 Invalidating queries after marking messages as read')
      queryClient.invalidateQueries({ queryKey: ['messages', contextType, contextId] })
      queryClient.invalidateQueries({ queryKey: ['unread-messages-count'] })
      queryClient.invalidateQueries({ queryKey: ['recent-conversations', user?.id] })
      queryClient.invalidateQueries({ queryKey: ['unread-context-messages', user?.id] })
    },
    onError: (error) => {
      console.error('❌ Mark as read mutation failed:', error)
    }
  })

  const handleSendMessage = () => {
    if (!messageContent.trim() || !contextType || !contextId) return

    sendMessageMutation.mutate({
      content: messageContent.trim(),
      context_type: contextType,
      context_id: contextId,
      field_name: fieldName,
      cited_content: citedContent,
      reply_to: replyToMessage
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

  const handleTogglePin = (messageId: string, isPinned: boolean) => {
    togglePinMutation.mutate({ messageId, isPinned })
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
      // Show date and time for messages older than 9 minutes
      return format(messageDate, 'MMM d, yyyy h:mm a')
    }
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Auto-focus input when cited content is added
  useEffect(() => {
    if (citedContent) {
      smartInputRef.current?.focus()
    }
  }, [citedContent])

  // Mark unread messages as read when viewing this conversation
  useEffect(() => {
    if (!messages || messages.length === 0 || !user?.id) return

    const unreadMessages = messages.filter(
      message => !message.is_read && message.user_id !== user.id
    )

    console.log('📖 Checking for unread messages in context:', contextType, contextId, '- found:', unreadMessages.length, 'total:', messages.length)
    if (unreadMessages.length > 0) {
      console.log('📬 Unread message IDs:', unreadMessages.map(m => ({ id: m.id, content: m.content.substring(0, 50), user_id: m.user_id, is_read: m.is_read })))
      console.log('📬 Current user can update these? Check RLS policies if 0 messages updated')
    }

    if (unreadMessages.length > 0) {
      // Use a timeout to mark as read after a brief delay to ensure user has seen them
      const timer = setTimeout(() => {
        console.log('✅ Marking', unreadMessages.length, 'messages as read')
        markMessagesAsReadMutation.mutate(unreadMessages.map(m => m.id))
      }, 1000)

      return () => clearTimeout(timer)
    }
  }, [messages, user?.id])

  console.log('📍 MessagingSection render - contextType:', contextType, 'contextId:', contextId)

  // Show conversation list if no context is selected
  if (!contextType && !contextId) {
    console.log('🎨 Rendering conversation list view', {
      conversationsLoading,
      hasData: !!recentConversations,
      count: recentConversations?.length,
      showLoading: conversationsLoading || !recentConversations
    })
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 overflow-y-auto">
          {conversationsLoading || !recentConversations ? (
            <div className="p-4 space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="animate-pulse">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 bg-gray-200 rounded-full"></div>
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                      <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : recentConversations.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <MessageCircle className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <p>No recent conversations</p>
            </div>
          ) : (
            <div className="p-2">
              {recentConversations.map((conv: any) => (
                <div
                  key={`${conv.context_type}:${conv.context_id}`}
                  onClick={() => {
                    console.log('🖱️ Conversation clicked:', conv.context_type, conv.context_id, conv.context_name, 'data:', conv.context_data)
                    if (onContextChange) {
                      onContextChange(conv.context_type, conv.context_id, conv.context_name, conv.context_data)
                    }
                  }}
                  className="p-4 rounded-lg cursor-pointer hover:bg-gray-50 mb-2 border border-gray-200"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2 flex-1 min-w-0">
                      <h4 className="font-semibold text-gray-900 truncate">{conv.context_name}</h4>
                      {conv.has_unread && (
                        <span className="w-2 h-2 rounded-full bg-error-500 flex-shrink-0"></span>
                      )}
                    </div>
                    <span className="text-xs text-gray-500 ml-2 flex-shrink-0">
                      {formatDistanceToNow(new Date(conv.last_message_at), { addSuffix: true })}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 truncate">{conv.last_message}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Context Header */}
      <div className="p-4 border-b border-gray-200 bg-gray-50 flex-shrink-0">
        {/* Header with Back Button, Search, Filter, and Focus Button */}
        {contextType && contextId && (
          <div className="flex items-center space-x-2 mb-3">
            {onBack && (
              <button
                onClick={() => {
                  console.log('🔙 Back button clicked')
                  onBack()
                }}
                className="text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
                title="Back to conversations"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
            )}

            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-3 w-3 text-gray-400" />
              <input
                type="text"
                placeholder="Search messages..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-7 pr-3 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>

            {/* Filter */}
            <select
              value={filterBy}
              onChange={(e) => setFilterBy(e.target.value as any)}
              className="px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 flex-shrink-0"
            >
              <option value="all">All</option>
              <option value="pinned">Pinned</option>
              <option value="replies">Replies</option>
            </select>

            {/* Focus Button */}
            <button
              onClick={() => {
                if (onFocusMode) {
                  onFocusMode(true)
                }
              }}
              className={clsx(
                "p-2 rounded-lg transition-colors flex-shrink-0",
                isFocusMode
                  ? "bg-primary-600 text-white hover:bg-primary-700"
                  : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              )}
              title="Focus mode - Select component to cite"
            >
              <Eye className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* Citation Display */}
        {citedContent && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center space-x-2 mb-1">
                  <Quote className="h-3 w-3 text-blue-600" />
                  <span className="text-xs font-medium text-blue-900">
                    {fieldName ? `Citing ${fieldName}` : 'Cited Content'}
                  </span>
                </div>
                <p className="text-xs text-blue-800 line-clamp-3">
                  {citedContent}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Messages List */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className="h-full overflow-y-auto custom-scrollbar pb-4">
          {!contextType || !contextId ? (
            <div className="p-6 text-center text-gray-500">
              <MessageCircle className="h-8 w-8 text-gray-400 mx-auto mb-2" />
              <p className="text-sm">Select an asset, portfolio, or theme to start a discussion</p>
            </div>
          ) : isLoading && messages.length === 0 ? (
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
          ) : filteredMessages.length > 0 ? (
            <div className="p-4 space-y-0.5">
              {filteredMessages.map((message, index) => {
                const prevMessage = index > 0 ? filteredMessages[index - 1] : null
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
                            {message.field_name && (
                              <Badge variant="primary" size="sm">
                                {message.field_name}
                              </Badge>
                            )}
                          </div>

                          {/* Reply indicator */}
                          {message.reply_to && (
                            <div className="text-xs text-gray-500 mb-1 flex items-center">
                              <Reply className="h-3 w-3 mr-1" />
                              Replying to message
                            </div>
                          )}

                          {/* Cited content */}
                          {message.cited_content && (
                            <div className="p-2 bg-gray-50 border-l-4 border-primary-500 rounded-r mb-2">
                              <p className="text-xs text-gray-600 italic">
                                {message.cited_content.substring(0, 100)}...
                              </p>
                            </div>
                          )}

                          <div className="text-sm text-gray-700 whitespace-pre-wrap">
                            <SmartInputRenderer content={message.content} inline />
                          </div>

                          {/* Message Actions */}
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
                                  handleTogglePin(message.id, message.is_pinned)
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
                          {/* Reply indicator */}
                          {message.reply_to && (
                            <div className="text-xs text-gray-500 mb-1 flex items-center">
                              <Reply className="h-3 w-3 mr-1" />
                              Replying to message
                            </div>
                          )}

                          {/* Cited content */}
                          {message.cited_content && (
                            <div className="p-2 bg-gray-50 border-l-4 border-primary-500 rounded-r mb-2">
                              <p className="text-xs text-gray-600 italic">
                                {message.cited_content.substring(0, 100)}...
                              </p>
                            </div>
                          )}

                          <div className="text-sm text-gray-700 whitespace-pre-wrap">
                            <SmartInputRenderer content={message.content} inline />
                          </div>

                          {/* Message Actions */}
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
                                  handleTogglePin(message.id, message.is_pinned)
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
              <p className="text-sm">No messages yet</p>
              <p className="text-xs">Start the discussion!</p>
            </div>
          )}
        </div>
      </div>

      {/* Message Input */}
      <div className="p-4 border-t border-gray-200 bg-gray-50 flex-shrink-0 relative">
        {/* Reply indicator */}
        {replyToMessage && replyToMessageData && (
          <div className="mb-3 p-2 bg-blue-50 border border-blue-200 rounded-lg">
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

        <div className="flex space-x-2">
          <div className="flex-1">
            <UniversalSmartInput
              ref={smartInputRef}
              value={messageContent}
              onChange={(value, metadata) => {
                setMessageContent(value)
                setInputMetadata(metadata)
              }}
              onKeyDown={handleKeyDown}
              placeholder={
                contextType && contextId
                  ? `Message about ${contextTitle}... Use @mention, #reference, .template, .AI`
                  : "Select a context to start messaging..."
              }
              textareaClassName="text-sm"
              rows={3}
              minHeight="80px"
              disabled={!contextType || !contextId}
              enableMentions={true}
              enableHashtags={true}
              enableTemplates={true}
              enableDataFunctions={false}
              enableAI={true}
            />
          </div>
          <Button
            onClick={handleSendMessage}
            disabled={!messageContent.trim() || !contextType || !contextId || sendMessageMutation.isPending}
            size="sm"
            className="self-end"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>

        {!contextType || !contextId && (
          <p className="text-xs text-gray-500 mt-2">
            Open an asset, portfolio, or theme tab to start a discussion
          </p>
        )}
      </div>
    </div>
  )
}