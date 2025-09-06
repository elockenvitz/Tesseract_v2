import React, { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MessageCircle, Send, Users, Settings, Quote, X, ChevronDown, Search, Filter, Calendar, User, Pin, Reply, MoreVertical } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { Card } from '../ui/Card'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'

interface MessagingSectionProps {
  contextType?: string
  contextId?: string
  contextTitle?: string
  citedContent?: string
  fieldName?: string
  onCite?: (content: string, fieldName?: string) => void
  onContextChange?: (contextType: string, contextId: string, contextTitle: string) => void
  onShowCoverageManager?: () => void
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
  onShowCoverageManager
}: MessagingSectionProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  
  const [messageContent, setMessageContent] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [filterBy, setFilterBy] = useState<'all' | 'pinned' | 'replies'>('all')
  const [replyToMessage, setReplyToMessage] = useState<string | null>(null)

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
    enabled: !!(contextType && contextId)
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const handleReply = (messageId: string) => {
    setReplyToMessage(messageId)
    textareaRef.current?.focus()
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

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  return (
    <div className="flex flex-col h-full">
      {/* Context Header */}
      <div className="p-4 border-b border-gray-200 bg-gray-50">
        {/* Search and Filter */}
        <div className="flex items-center space-x-2 mb-3">
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
          <select
            value={filterBy}
            onChange={(e) => setFilterBy(e.target.value as any)}
            className="px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
          >
            <option value="all">All</option>
            <option value="pinned">Pinned</option>
            <option value="replies">Replies</option>
          </select>
        </div>

        {/* Citation Display */}
        {citedContent && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg mb-3">
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
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {!contextType || !contextId ? (
          <div className="p-6 text-center text-gray-500">
            <MessageCircle className="h-8 w-8 text-gray-400 mx-auto mb-2" />
            <p className="text-sm">Select an asset, portfolio, or theme to start a discussion</p>
          </div>
        ) : isLoading ? (
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
          <div className="p-4 space-y-4">
            {filteredMessages.map((message) => (
              <div key={message.id} className="flex items-start space-x-3 group">
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
                    <span className="text-xs text-gray-500">
                      {formatDistanceToNow(new Date(message.created_at), { addSuffix: true })}
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
                    {message.content}
                  </div>
                  
                  {/* Message Actions */}
                  <div className="flex items-center space-x-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleReply(message.id)}
                      className="text-xs text-gray-500 hover:text-primary-600 transition-colors"
                    >
                      Reply
                    </button>
                    <button
                      onClick={() => handleTogglePin(message.id, message.is_pinned)}
                      className="text-xs text-gray-500 hover:text-warning-600 transition-colors"
                    >
                      {message.is_pinned ? 'Unpin' : 'Pin'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        ) : (
          <div className="p-6 text-center text-gray-500">
            <MessageCircle className="h-8 w-8 text-gray-400 mx-auto mb-2" />
            <p className="text-sm">No messages yet</p>
            <p className="text-xs">Start the discussion!</p>
          </div>
        )}
      </div>

      {/* Message Input */}
      <div className="p-4 border-t border-gray-200 bg-gray-50">
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
          <textarea
            ref={textareaRef}
            value={messageContent}
            onChange={(e) => setMessageContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              contextType && contextId 
                ? `Message about ${contextTitle}...`
                : "Select a context to start messaging..."
            }
            className="flex-1 p-3 text-sm border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            rows={3}
            disabled={!contextType || !contextId}
          />
          <Button
            onClick={handleSendMessage}
            disabled={!messageContent.trim() || !contextType || !contextId || sendMessageMutation.isPending}
            size="sm"
            className="self-end"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        
        {!contextType || !contextId ? (
          <p className="text-xs text-gray-500 mt-2">
            Open an asset, portfolio, or theme tab to start a discussion
          </p>
        ) : (
          <p className="text-xs text-gray-500 mt-2">
            Press Enter to send, Shift+Enter for new line
          </p>
        )}
      </div>
    </div>
  )
}