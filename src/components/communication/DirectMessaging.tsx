import React, { useState, useRef, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MessageCircle, Users, Plus, Search, Send, MoreVertical, X, ArrowLeft, Pin, Reply } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { formatDistanceToNow, format, differenceInMinutes } from 'date-fns'
import { clsx } from 'clsx'

interface DirectMessagingProps {
  isOpen: boolean
  onClose: () => void
}

interface Conversation {
  id: string
  name: string | null
  description: string
  is_group: boolean
  created_by: string | null
  created_at: string
  updated_at: string
  last_message_at: string
  participants: Array<{
    user_id: string
    is_admin: boolean
    user: {
      id: string
      email: string
      first_name?: string
      last_name?: string
    }
  }>
  last_message?: {
    content: string
    user_id: string
    created_at: string
  }
  unread_count?: number
}

interface Message {
  id: string
  conversation_id: string
  user_id: string
  content: string
  reply_to: string | null
  is_edited: boolean
  is_pinned: boolean
  created_at: string
  updated_at: string
  user: {
    id: string
    email: string
    first_name?: string
    last_name?: string
  }
  replied_message?: {
    id: string
    content: string
    user_id: string
    user: {
      id: string
      email: string
      first_name?: string
      last_name?: string
    }
  }
}

export function DirectMessaging({ isOpen, onClose }: DirectMessagingProps) {
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [messageContent, setMessageContent] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [showNewConversation, setShowNewConversation] = useState(false)
  const [showGroupCreation, setShowGroupCreation] = useState(false)
  const queryClient = useQueryClient()
  const [groupName, setGroupName] = useState('')
  const [groupDescription, setGroupDescription] = useState('')
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { user } = useAuth()

  // Don't invalidate on open - let the cache work naturally

  // Check URL for conversation parameter and select it
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const conversationId = params.get('conversation')
    if (conversationId && conversationId !== selectedConversationId) {
      setSelectedConversationId(conversationId)
      // Clean up URL after setting
      params.delete('conversation')
      const newUrl = params.toString() ? `${window.location.pathname}?${params.toString()}` : window.location.pathname
      window.history.replaceState({}, '', newUrl)
    }
  }, [selectedConversationId])

  // Fetch all conversations for the current user
  const { data: rawConversations, isLoading: conversationsLoading, isFetching: conversationsFetching, error: conversationsError } = useQuery({
    queryKey: ['conversations'],
    enabled: !!user?.id,
    staleTime: 30000, // Keep data fresh for 30 seconds
    structuralSharing: false, // Prevent partial data updates that cause flashing
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!user?.id) return []

      // First get conversation IDs where user is a participant
      const { data: userConversations, error: participantError } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', user.id)

      if (participantError) throw participantError
      if (!userConversations || userConversations.length === 0) return []

      const conversationIds = userConversations.map(p => p.conversation_id)

      // Now get full conversation data with all participants
      const { data, error } = await supabase
        .from('conversations')
        .select(`
          *,
          conversation_participants(
            user_id,
            is_admin,
            user:users(id, email, first_name, last_name)
          )
        `)
        .in('id', conversationIds)
        .order('last_message_at', { ascending: false })

      if (error) throw error

      // Get last message and unread count for each conversation
      const conversationsWithMessages = await Promise.all(
        (data || []).map(async (conv) => {
          const { data: lastMessage } = await supabase
            .from('conversation_messages')
            .select('content, user_id, created_at')
            .eq('conversation_id', conv.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          // Get participant's last_read_at - fetch fresh to avoid stale data
          const { data: participantData } = await supabase
            .from('conversation_participants')
            .select('last_read_at')
            .eq('conversation_id', conv.id)
            .eq('user_id', user.id)
            .single()

          const lastReadAt = participantData?.last_read_at

          // Count unread messages (messages created after last_read_at)
          let unreadCount = 0
          if (lastReadAt) {
            const { count } = await supabase
              .from('conversation_messages')
              .select('*', { count: 'exact', head: true })
              .eq('conversation_id', conv.id)
              .neq('user_id', user.id) // Don't count own messages
              .gt('created_at', lastReadAt)

            unreadCount = count || 0
          } else {
            // If never read, count all messages from others
            const { count } = await supabase
              .from('conversation_messages')
              .select('*', { count: 'exact', head: true })
              .eq('conversation_id', conv.id)
              .neq('user_id', user.id)

            unreadCount = count || 0
          }

          return {
            ...conv,
            last_message: lastMessage,
            participants: conv.conversation_participants,
            unread_count: unreadCount
          }
        })
      )

      return conversationsWithMessages as Conversation[]
    },
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })

  // Create a stable, memoized version of conversations to prevent flashing
  // Use a ref to store the last valid conversations and only update when data is complete
  const lastValidConversationsRef = useRef<typeof rawConversations>(null)
  const lastSignatureRef = useRef<string>('')

  // Create a signature based on participant IDs AND names to catch when names change
  const participantSignature = rawConversations
    ?.map(c => `${c.id}:${c.participants?.map(p =>
      `${p.user_id}-${p.user?.first_name || ''}-${p.user?.last_name || ''}`
    ).sort().join(',')}`)
    .sort()
    .join('|') || ''

  const conversations = useMemo(() => {
    if (!rawConversations) {
      return undefined
    }

    // Check if all conversations have complete participant data
    const isComplete = rawConversations.every(conv =>
      conv.participants &&
      conv.participants.length > 0 &&
      conv.participants.every(p => p.user && p.user.first_name && p.user.last_name)
    )

    // If data is incomplete, show loading
    if (!isComplete) {
      return undefined
    }

    // If signature changed, show loading while we wait for stable data
    if (participantSignature !== lastSignatureRef.current) {
      // Update the ref for next render
      lastSignatureRef.current = participantSignature
      lastValidConversationsRef.current = rawConversations.map(conv => ({
        ...conv,
        participants: conv.participants?.map(p => ({
          ...p,
          user: p.user ? { ...p.user } : null
        }))
      }))
      // Return undefined to show loading skeleton
      return undefined
    }

    // Signature matches - return cached data
    return lastValidConversationsRef.current
  }, [participantSignature, rawConversations])

  // Fetch messages for selected conversation
  const { data: messages, isLoading: messagesLoading, error: messagesError } = useQuery({
    queryKey: ['conversation-messages', selectedConversationId],
    enabled: !!selectedConversationId, // Don't disable when pane closes - rely on staleTime instead
    staleTime: 60000, // Consider data fresh for 60 seconds
    refetchOnMount: false, // Don't refetch when switching back to this view
    refetchOnWindowFocus: false, // Don't refetch on window focus
    queryFn: async () => {
      if (!selectedConversationId) return []

      // First, fetch all messages
      const { data: messagesData, error: messagesErr } = await supabase
        .from('conversation_messages')
        .select(`
          *,
          user:users(id, email, first_name, last_name)
        `)
        .eq('conversation_id', selectedConversationId)
        .order('created_at', { ascending: true })

      if (messagesErr) {
        console.error('Error fetching messages:', messagesErr)
        throw messagesErr
      }

      // For each message with reply_to, fetch the replied message
      const messagesWithReplies = await Promise.all(
        (messagesData || []).map(async (message) => {
          if (message.reply_to) {
            const { data: repliedMsg } = await supabase
              .from('conversation_messages')
              .select(`
                id,
                content,
                user_id,
                user:users(id, email, first_name, last_name)
              `)
              .eq('id', message.reply_to)
              .maybeSingle()

            return {
              ...message,
              replied_message: repliedMsg
            }
          }
          return message
        })
      )

      return messagesWithReplies as Message[]
    },
    enabled: !!selectedConversationId,
    refetchInterval: 2000, // Real-time updates
  })

  // Fetch all users for creating conversations
  const { data: allUsers } = useQuery({
    queryKey: ['all-users-messaging'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .neq('id', user?.id)
        .order('first_name', { ascending: true })

      if (error) throw error
      return data || []
    },
    enabled: showNewConversation || showGroupCreation,
  })

  // Auto-scroll to bottom when new messages arrive (but not on initial load)
  const previousMessagesLengthRef = useRef(0)
  useEffect(() => {
    if (messagesEndRef.current && messages && messages.length > 0) {
      // Only scroll if messages were added (not on initial load or conversation change)
      if (previousMessagesLengthRef.current > 0 && messages.length > previousMessagesLengthRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
      } else if (previousMessagesLengthRef.current === 0) {
        // On initial load, scroll instantly without animation
        messagesEndRef.current.scrollIntoView({ behavior: 'instant' })
      }
      previousMessagesLengthRef.current = messages.length
    }
  }, [messages])

  // Reset message count when conversation changes
  useEffect(() => {
    previousMessagesLengthRef.current = 0
  }, [selectedConversationId])

  // Mark conversation as read when viewing messages
  useEffect(() => {
    if (!selectedConversationId || !user?.id) return

    const markAsRead = async () => {
      try {
        // Use RPC function to bypass RLS recursion issue
        const { error } = await supabase.rpc('mark_conversation_read', {
          p_conversation_id: selectedConversationId,
          p_user_id: user.id
        })

        if (error) {
          console.error('Error updating last_read_at:', error)
        }

        // Invalidate and refetch the unread direct messages query to update the red dot immediately
        await queryClient.invalidateQueries({ queryKey: ['unread-direct-messages', user.id] })
        await queryClient.refetchQueries({ queryKey: ['unread-direct-messages', user.id] })
        // Also invalidate conversations to update unread counts
        queryClient.invalidateQueries({ queryKey: ['conversations'] })
      } catch (error) {
        console.error('Error marking conversation as read:', error)
      }
    }

    // Mark as read after a short delay to ensure user has seen the messages
    const timer = setTimeout(markAsRead, 1000)
    return () => clearTimeout(timer)
  }, [selectedConversationId, user?.id, messages])

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async ({ conversationId, content, replyTo }: { conversationId: string; content: string; replyTo?: string | null }) => {
      const { error } = await supabase
        .from('conversation_messages')
        .insert([{
          conversation_id: conversationId,
          user_id: user?.id,
          content,
          reply_to: replyTo || null
        }])

      if (error) throw error

      // Update conversation last_message_at
      await supabase
        .from('conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', conversationId)

      // Check for @ mentions in the message content
      const mentionRegex = /@\[([^\]]+)\]\(user:([a-f0-9-]+)\)/g
      const mentions = []
      let match
      while ((match = mentionRegex.exec(content)) !== null) {
        mentions.push({
          displayName: match[1],
          userId: match[2]
        })
      }

      // Process mentioned users
      if (mentions.length > 0) {
        const currentConversation = conversations?.find(c => c.id === conversationId)
        const conversationName = currentConversation?.name ||
                                currentConversation?.participants
                                  .filter(p => p.user_id !== user?.id)
                                  .map(p => p.user?.first_name || p.user?.email?.split('@')[0])
                                  .join(', ') || 'a conversation'

        const uniqueMentions = mentions.filter((mention, index, self) =>
          mention.userId !== user?.id && // Don't notify yourself
          index === self.findIndex(m => m.userId === mention.userId) // Remove duplicates
        )

        // Create notifications for each mentioned user
        const notifications = uniqueMentions.map(mention => ({
          user_id: mention.userId,
          type: 'mention',
          title: 'You were mentioned',
          message: `${user?.first_name || user?.email?.split('@')[0] || 'Someone'} mentioned you in ${conversationName}`,
          context_type: 'conversation',
          context_id: conversationId,
          context_data: {
            message_content: content.substring(0, 200), // First 200 chars
            mentioned_by: user?.id,
            conversation_name: conversationName
          }
        }))

        if (notifications.length > 0) {
          await supabase.from('notifications').insert(notifications)
        }

        // Auto-add mentioned users to conversation if not already participants
        const { data: existingParticipants } = await supabase
          .from('conversation_participants')
          .select('user_id')
          .eq('conversation_id', conversationId)
          .in('user_id', uniqueMentions.map(m => m.userId))

        const existingUserIds = new Set(existingParticipants?.map(p => p.user_id) || [])
        const newParticipants = uniqueMentions
          .filter(m => !existingUserIds.has(m.userId))
          .map(m => ({
            conversation_id: conversationId,
            user_id: m.userId,
            is_admin: false
          }))

        if (newParticipants.length > 0) {
          await supabase.from('conversation_participants').insert(newParticipants)
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversation-messages', selectedConversationId] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      setMessageContent('')
      setReplyingTo(null)
    }
  })

  // Toggle pin mutation
  const togglePinMutation = useMutation({
    mutationFn: async ({ messageId, isPinned }: { messageId: string; isPinned: boolean }) => {
      const { error } = await supabase
        .from('conversation_messages')
        .update({ is_pinned: !isPinned })
        .eq('id', messageId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversation-messages', selectedConversationId] })
    }
  })

  // Create direct conversation mutation
  const createDirectConversationMutation = useMutation({
    mutationFn: async (otherUserId: string) => {
      const { data, error } = await supabase.rpc('get_or_create_direct_conversation', {
        other_user_id: otherUserId
      })

      if (error) throw error
      return data
    },
    onSuccess: (conversationId) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      setSelectedConversationId(conversationId)
      setShowNewConversation(false)
    }
  })

  // Create group conversation mutation
  const createGroupMutation = useMutation({
    mutationFn: async ({ name, description, userIds }: { name: string; description: string; userIds: string[] }) => {
      // Create the group conversation
      const { data: conversation, error: convError } = await supabase
        .from('conversations')
        .insert([{
          name,
          description,
          is_group: true,
          created_by: user?.id
        }])
        .select()
        .single()

      if (convError) throw convError

      // Add creator as admin participant
      const participants = [
        { conversation_id: conversation.id, user_id: user?.id, is_admin: true },
        ...userIds.map(userId => ({
          conversation_id: conversation.id,
          user_id: userId,
          is_admin: false
        }))
      ]

      const { error: participantsError } = await supabase
        .from('conversation_participants')
        .insert(participants)

      if (participantsError) throw participantsError

      return conversation.id
    },
    onSuccess: (conversationId) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      setSelectedConversationId(conversationId)
      setShowGroupCreation(false)
      setGroupName('')
      setGroupDescription('')
      setSelectedUsers([])
    }
  })

  const handleSendMessage = () => {
    if (!messageContent.trim() || !selectedConversationId) return

    sendMessageMutation.mutate({
      conversationId: selectedConversationId,
      content: messageContent,
      replyTo: replyingTo?.id
    })
  }

  const handleReply = (message: Message) => {
    setReplyingTo(message)
    textareaRef.current?.focus()
  }

  const handleTogglePin = (messageId: string, isPinned: boolean) => {
    togglePinMutation.mutate({ messageId, isPinned })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const getUserDisplayName = (user: any) => {
    if (!user) return 'Unknown User'
    
    if (user.first_name && user.last_name) {
      return `${user.first_name} ${user.last_name}`
    }
    
    if (user.email) {
      return user.email.split('@')[0]
    }
    
    return 'Unknown User'
  }

  const getUserInitials = (user: any) => {
    if (!user) return 'UU'

    if (user.first_name && user.last_name) {
      return (user.first_name[0] + user.last_name[0]).toUpperCase()
    }

    if (user.email) {
      const email = user.email
      const parts = email.split('@')[0].split('.')
      if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase()
      }

      const name = email.split('@')[0]
      return name.length >= 2 ? name.substring(0, 2).toUpperCase() : name.toUpperCase()
    }

    return 'UU'
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

  const getConversationTitle = (conversation: Conversation) => {
    if (conversation.is_group) {
      return conversation.name || 'Group Chat'
    }

    // For direct messages, show the other user's name
    const otherParticipant = conversation.participants?.find(p => p.user_id !== user?.id)
    return otherParticipant ? getUserDisplayName(otherParticipant.user) : 'Direct Message'
  }

  const getConversationSubtitle = (conversation: Conversation) => {
    if (conversation.is_group) {
      return `${conversation.participants?.length || 0} members`
    }

    if (conversation.last_message && conversation.last_message.content) {
      const preview = conversation.last_message.content.trim()
      if (preview.length === 0) return 'No messages yet'
      return preview.length > 50 ? preview.substring(0, 50) + '...' : preview
    }

    return 'No messages yet'
  }

  const selectedConversation = conversations?.find(c => c.id === selectedConversationId)

  // Show conversation list view
  if (!selectedConversationId && !showNewConversation && !showGroupCreation) {
    return (
      <div className="flex flex-col h-full">
        {/* Action Buttons and Search */}
        <div className="p-4 border-b border-gray-200">
          {/* Action Buttons */}
          <div className="flex space-x-2 mb-4">
            <Button
              size="sm"
              onClick={() => setShowNewConversation(true)}
              className="flex-1"
            >
              <MessageCircle className="h-4 w-4 mr-2" />
              New Chat
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowGroupCreation(true)}
              className="flex-1"
            >
              <Users className="h-4 w-4 mr-2" />
              New Group
            </Button>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
        </div>

        {/* Conversations List */}
        <div className="flex-1 overflow-y-auto">
          {conversationsError ? (
            <div className="p-4 text-center text-red-600">
              <p>Error loading conversations:</p>
              <p className="text-sm">{conversationsError.message}</p>
            </div>
          ) : conversationsLoading && !conversations ? (
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
          ) : !conversations || conversationsFetching ? (
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
          ) : conversations && conversations.length > 0 ? (
            <div className="p-2">
              {conversations
                .filter(conv => 
                  !searchQuery || 
                  getConversationTitle(conv).toLowerCase().includes(searchQuery.toLowerCase())
                )
                .map((conversation) => (
                  <div
                    key={conversation.id}
                    onClick={() => setSelectedConversationId(conversation.id)}
                    className="p-4 rounded-lg cursor-pointer transition-colors hover:bg-gray-50 mb-2"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="relative">
                        {conversation.is_group ? (
                          <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-purple-600 rounded-full flex items-center justify-center">
                            <Users className="h-6 w-6 text-white" />
                          </div>
                        ) : (
                          <div className="w-12 h-12 bg-gradient-to-br from-primary-500 to-primary-600 rounded-full flex items-center justify-center">
                            <span className="text-white font-semibold">
                              {getUserInitials(conversation.participants?.find(p => p.user_id !== user?.id)?.user)}
                            </span>
                          </div>
                        )}
                        {(conversation.unread_count ?? 0) > 0 && (
                          <div className="absolute -top-1 -right-1 w-5 h-5 bg-error-500 rounded-full flex items-center justify-center">
                            <span className="text-white text-xs font-bold">
                              {conversation.unread_count! > 9 ? '9+' : conversation.unread_count}
                            </span>
                          </div>
                        )}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <h4 className="font-semibold text-gray-900 truncate">
                            {getConversationTitle(conversation)}
                          </h4>
                          {conversation.last_message && (
                            <span className="text-xs text-gray-500">
                              {formatDistanceToNow(new Date(conversation.last_message.created_at), { addSuffix: true })}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 truncate">
                          {getConversationSubtitle(conversation)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <div className="p-8 text-center text-gray-500">
              <MessageCircle className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No conversations yet</h3>
              <p className="text-sm mb-4">Start a conversation with your team members</p>
              <div className="space-y-2">
                <Button size="sm" onClick={() => setShowNewConversation(true)} className="w-full">
                  <MessageCircle className="h-4 w-4 mr-2" />
                  Start New Chat
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowGroupCreation(true)} className="w-full">
                  <Users className="h-4 w-4 mr-2" />
                  Create Group
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Show new conversation creation
  if (showNewConversation) {
    return (
      <div className="flex flex-col h-full">
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setShowNewConversation(false)}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <h3 className="text-lg font-semibold text-gray-900">Start New Conversation</h3>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search users..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
          
          <div className="space-y-2">
            {allUsers?.map((otherUser) => (
              <div
                key={otherUser.id}
                onClick={() => createDirectConversationMutation.mutate(otherUser.id)}
                className="flex items-center space-x-3 p-3 hover:bg-gray-50 rounded-lg cursor-pointer transition-colors"
              >
                <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                  <span className="text-primary-600 font-semibold text-sm">
                    {getUserInitials(otherUser)}
                  </span>
                </div>
                <div>
                  <p className="font-medium text-gray-900">{getUserDisplayName(otherUser)}</p>
                  <p className="text-sm text-gray-500">{otherUser.email}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Show group creation
  if (showGroupCreation) {
    return (
      <div className="flex flex-col h-full">
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setShowGroupCreation(false)}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <h3 className="text-lg font-semibold text-gray-900">Create Group</h3>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Group Name</label>
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Enter group name..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Description (optional)</label>
            <textarea
              value={groupDescription}
              onChange={(e) => setGroupDescription(e.target.value)}
              placeholder="Describe the group purpose..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              rows={3}
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Add Members</label>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {allUsers?.map((otherUser) => (
                <div
                  key={otherUser.id}
                  className="flex items-center space-x-3 p-2 hover:bg-gray-50 rounded-lg"
                >
                  <input
                    type="checkbox"
                    checked={selectedUsers.includes(otherUser.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedUsers([...selectedUsers, otherUser.id])
                      } else {
                        setSelectedUsers(selectedUsers.filter(id => id !== otherUser.id))
                      }
                    }}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
                    <span className="text-primary-600 font-semibold text-xs">
                      {getUserInitials(otherUser)}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{getUserDisplayName(otherUser)}</p>
                    <p className="text-xs text-gray-500">{otherUser.email}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        
        <div className="p-4 border-t border-gray-200">
          <div className="flex space-x-3">
            <Button
              variant="outline"
              onClick={() => {
                setShowGroupCreation(false)
                setGroupName('')
                setGroupDescription('')
                setSelectedUsers([])
              }}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={() => createGroupMutation.mutate({
                name: groupName,
                description: groupDescription,
                userIds: selectedUsers
              })}
              disabled={!groupName.trim() || selectedUsers.length === 0 || createGroupMutation.isPending}
              className="flex-1"
            >
              Create Group
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // Show selected conversation chat
  return (
    <div className="flex flex-col h-full bg-white">
      {/* Chat Header - Pinned to top */}
      <div className="p-4 border-b border-gray-200 bg-white flex-shrink-0 z-10 relative shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setSelectedConversationId(null)}
              className="text-gray-600 hover:text-gray-800 transition-colors p-1 rounded-lg hover:bg-gray-100"
              title="Back to conversations"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            {selectedConversation?.is_group ? (
              <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-purple-600 rounded-full flex items-center justify-center">
                <Users className="h-5 w-5 text-white" />
              </div>
            ) : (
              <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-primary-600 rounded-full flex items-center justify-center">
                <span className="text-white font-semibold text-sm">
                  {getUserInitials(selectedConversation?.participants?.find(p => p.user_id !== user?.id)?.user)}
                </span>
              </div>
            )}
            <div>
              <h3 className="font-semibold text-gray-900">
                {selectedConversation ? getConversationTitle(selectedConversation) : 'Loading...'}
              </h3>
              <p className="text-sm text-gray-500">
                {selectedConversation?.is_group
                  ? `${selectedConversation.participants?.length || 0} members`
                  : 'Direct message'
                }
              </p>
            </div>
          </div>
          <button className="text-gray-400 hover:text-gray-600 transition-colors">
            <MoreVertical className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Messages - Scrollable area between header and input */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className="h-full overflow-y-auto custom-scrollbar">
          {messagesError ? (
            <div className="p-4 text-center text-red-600">
              <p>Error loading messages:</p>
              <p className="text-sm">{messagesError.message}</p>
            </div>
          ) : messagesLoading && !messages ? (
            <div className="space-y-3 p-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="animate-pulse">
                  <div className="flex items-start space-x-3">
                    <div className="w-8 h-8 bg-gray-200 rounded-full"></div>
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-gray-200 rounded w-1/4"></div>
                      <div className="h-3 bg-gray-200 rounded w-3/4"></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : messages && messages.length > 0 ? (
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
                            {message.is_edited && (
                              <span className="text-xs text-gray-400">(edited)</span>
                            )}
                          </div>

                          {/* Reply indicator */}
                          {message.replied_message && (
                            <div className="text-xs text-gray-500 mb-1 flex items-center p-2 bg-gray-50 rounded">
                              <Reply className="h-3 w-3 mr-1" />
                              <span className="font-medium mr-1">
                                {getUserDisplayName(message.replied_message.user)}:
                              </span>
                              <span className="truncate">
                                {message.replied_message.content.substring(0, 50)}
                                {message.replied_message.content.length > 50 ? '...' : ''}
                              </span>
                            </div>
                          )}

                          <div className="text-sm text-gray-700 whitespace-pre-wrap">
                            {message.content}
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
                                  handleReply(message)
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
                          {message.replied_message && (
                            <div className="text-xs text-gray-500 mb-1 flex items-center p-2 bg-gray-50 rounded">
                              <Reply className="h-3 w-3 mr-1" />
                              <span className="font-medium mr-1">
                                {getUserDisplayName(message.replied_message.user)}:
                              </span>
                              <span className="truncate">
                                {message.replied_message.content.substring(0, 50)}
                                {message.replied_message.content.length > 50 ? '...' : ''}
                              </span>
                            </div>
                          )}

                          <div className="text-sm text-gray-700 whitespace-pre-wrap">
                            {message.content}
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
                                  handleReply(message)
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
            <div className="text-center py-8 text-gray-500 p-4">
              <MessageCircle className="h-8 w-8 text-gray-400 mx-auto mb-2" />
              <p className="text-sm">No messages yet</p>
              <p className="text-xs">Start the conversation!</p>
            </div>
          )}
        </div>
      </div>

      {/* Message Input - Pinned to bottom */}
      <div className="p-4 border-t border-gray-200 bg-white flex-shrink-0 z-10 relative">
        {/* Reply indicator */}
        {replyingTo && (
          <div className="mb-3 p-2 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Reply className="h-3 w-3 text-blue-600" />
                <span className="text-xs font-medium text-blue-900">
                  Replying to {getUserDisplayName(replyingTo.user)}
                </span>
              </div>
              <button
                onClick={() => setReplyingTo(null)}
                className="text-blue-600 hover:text-blue-800"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            <p className="text-xs text-blue-700 mt-1 line-clamp-2">
              {replyingTo.content}
            </p>
          </div>
        )}

        <div className="flex space-x-2">
          <textarea
            ref={textareaRef}
            value={messageContent}
            onChange={(e) => setMessageContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="flex-1 p-3 text-sm border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            rows={2}
          />
          <Button
            onClick={handleSendMessage}
            disabled={!messageContent.trim() || sendMessageMutation.isPending}
            size="sm"
            className="self-end"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  )
}