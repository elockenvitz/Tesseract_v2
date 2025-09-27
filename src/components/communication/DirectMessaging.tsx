import React, { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MessageCircle, Users, Plus, Search, Send, MoreVertical, X, ArrowLeft } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { formatDistanceToNow } from 'date-fns'
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
  created_at: string
  updated_at: string
  user: {
    id: string
    email: string
    first_name?: string
    last_name?: string
  }
}

export function DirectMessaging({ isOpen, onClose }: DirectMessagingProps) {
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [messageContent, setMessageContent] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [showNewConversation, setShowNewConversation] = useState(false)
  const [showGroupCreation, setShowGroupCreation] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [groupDescription, setGroupDescription] = useState('')
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const queryClient = useQueryClient()
  const { user } = useAuth()

  // Fetch all conversations for the current user
  const { data: conversations, isLoading: conversationsLoading, error: conversationsError } = useQuery({
    queryKey: ['conversations'],
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

      // Get last message for each conversation
      const conversationsWithMessages = await Promise.all(
        (data || []).map(async (conv) => {
          const { data: lastMessage } = await supabase
            .from('conversation_messages')
            .select('content, user_id, created_at')
            .eq('conversation_id', conv.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          return {
            ...conv,
            last_message: lastMessage,
            participants: conv.conversation_participants
          }
        })
      )

      return conversationsWithMessages as Conversation[]
    },
    enabled: isOpen && !!user?.id,
    refetchInterval: false, // Disable automatic refresh
    staleTime: 1000 * 60 * 5, // Consider data fresh for 5 minutes
    gcTime: 1000 * 60 * 10, // Keep in cache for 10 minutes
  })

  // Fetch messages for selected conversation
  const { data: messages, isLoading: messagesLoading } = useQuery({
    queryKey: ['conversation-messages', selectedConversationId],
    queryFn: async () => {
      if (!selectedConversationId) return []

      const { data, error } = await supabase
        .from('conversation_messages')
        .select(`
          *,
          user:users(id, email, first_name, last_name)
        `)
        .eq('conversation_id', selectedConversationId)
        .order('created_at', { ascending: true })

      if (error) throw error
      return data as Message[]
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

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  // Mark conversation as read when viewing messages
  useEffect(() => {
    if (!selectedConversationId || !user?.id) return

    const markAsRead = async () => {
      try {
        await supabase
          .from('conversation_participants')
          .update({ last_read_at: new Date().toISOString() })
          .eq('conversation_id', selectedConversationId)
          .eq('user_id', user.id)

        // Invalidate the unread messages query to update the red dot
        queryClient.invalidateQueries({ queryKey: ['unread-messages', user.id] })
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
    mutationFn: async ({ conversationId, content }: { conversationId: string; content: string }) => {
      const { error } = await supabase
        .from('conversation_messages')
        .insert([{
          conversation_id: conversationId,
          user_id: user?.id,
          content
        }])

      if (error) throw error

      // Update conversation last_message_at
      await supabase
        .from('conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', conversationId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversation-messages', selectedConversationId] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      setMessageContent('')
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
      content: messageContent
    })
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
    
    if (conversation.last_message) {
      return conversation.last_message.content.substring(0, 50) + '...'
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
          ) : conversationsLoading ? (
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
                        {conversation.unread_count && conversation.unread_count > 0 && (
                          <div className="absolute -top-1 -right-1 w-5 h-5 bg-error-500 rounded-full flex items-center justify-center">
                            <span className="text-white text-xs font-bold">
                              {conversation.unread_count > 9 ? '9+' : conversation.unread_count}
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
          {messagesLoading ? (
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
            <div className="space-y-4 p-4">
              {messages.map((message) => (
                <div key={message.id} className="flex items-start space-x-3">
                  <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-primary-600 text-sm font-semibold">
                      {getUserInitials(message.user)}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2 mb-1">
                      <span className="text-sm font-medium text-gray-900">
                        {getUserDisplayName(message.user)}
                      </span>
                      <span className="text-xs text-gray-500">
                        {formatDistanceToNow(new Date(message.created_at), { addSuffix: true })}
                      </span>
                      {message.is_edited && (
                        <span className="text-xs text-gray-400">(edited)</span>
                      )}
                    </div>

                    <div className="text-sm text-gray-700 whitespace-pre-wrap">
                      {message.content}
                    </div>
                  </div>
                </div>
              ))}
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