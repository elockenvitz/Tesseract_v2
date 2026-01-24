import React, { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Search, Send, Check, User, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { clsx } from 'clsx'
import type { ScoredFeedItem } from '../../hooks/ideas/types'

interface ShareToUserModalProps {
  isOpen: boolean
  onClose: () => void
  item: ScoredFeedItem
}

export function ShareToUserModal({ isOpen, onClose, item }: ShareToUserModalProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [sent, setSent] = useState(false)
  const queryClient = useQueryClient()
  const { user } = useAuth()

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('')
      setSelectedUsers([])
      setMessage('')
      setSent(false)
    }
  }, [isOpen])

  // Fetch all users
  const { data: allUsers, isLoading: usersLoading } = useQuery({
    queryKey: ['all-users-share'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .neq('id', user?.id)
        .order('first_name', { ascending: true })

      if (error) throw error
      return data || []
    },
    enabled: isOpen
  })

  // Filter users based on search
  const filteredUsers = allUsers?.filter(u => {
    if (!searchQuery) return true
    const fullName = `${u.first_name || ''} ${u.last_name || ''}`.toLowerCase()
    const email = (u.email || '').toLowerCase()
    const query = searchQuery.toLowerCase()
    return fullName.includes(query) || email.includes(query)
  }) || []

  // Share mutation
  const shareMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id || selectedUsers.length === 0) throw new Error('No users selected')

      // Build the share message
      const assetSymbol = 'asset' in item && item.asset ? item.asset.symbol : null
      const title = 'title' in item ? item.title : null
      const itemTypeLabel = item.type.replace('_', ' ')

      let shareContent = message ? `${message}\n\n---\n\n` : ''
      shareContent += `Shared ${itemTypeLabel}${assetSymbol ? ` for $${assetSymbol}` : ''}`
      if (title) {
        shareContent += `\n**${title}**`
      }
      shareContent += `\n\n${item.content?.substring(0, 300) || ''}`
      if (item.content && item.content.length > 300) {
        shareContent += '...'
      }

      // For each selected user, create or get conversation and send message
      for (const targetUserId of selectedUsers) {
        // Get or create direct conversation
        const { data: conversationId, error: convError } = await supabase.rpc(
          'get_or_create_direct_conversation',
          { other_user_id: targetUserId }
        )

        if (convError) {
          console.error('Error creating conversation:', convError)
          continue
        }

        // Send the message
        const { error: msgError } = await supabase
          .from('conversation_messages')
          .insert([{
            conversation_id: conversationId,
            user_id: user.id,
            content: shareContent
          }])

        if (msgError) {
          console.error('Error sending message:', msgError)
          continue
        }

        // Update conversation last_message_at
        await supabase
          .from('conversations')
          .update({ last_message_at: new Date().toISOString() })
          .eq('id', conversationId)

        // Create notification for the recipient
        await supabase.from('notifications').insert([{
          user_id: targetUserId,
          type: 'share',
          title: 'Content shared with you',
          message: `${user?.first_name || user?.email?.split('@')[0] || 'Someone'} shared a ${itemTypeLabel} with you`,
          context_type: 'conversation',
          context_id: conversationId,
          context_data: {
            shared_item_id: item.id,
            shared_item_type: item.type,
            shared_by: user.id
          }
        }])
      }
    },
    onSuccess: () => {
      setSent(true)
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      // Auto-close after showing success
      setTimeout(() => {
        onClose()
      }, 1500)
    }
  })

  const toggleUser = (userId: string) => {
    setSelectedUsers(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    )
  }

  const getUserDisplayName = (u: any) => {
    if (u.first_name && u.last_name) {
      return `${u.first_name} ${u.last_name}`
    }
    if (u.email) {
      return u.email.split('@')[0]
    }
    return 'Unknown User'
  }

  const getUserInitials = (u: any) => {
    if (u.first_name && u.last_name) {
      return (u.first_name[0] + u.last_name[0]).toUpperCase()
    }
    if (u.email) {
      return u.email.substring(0, 2).toUpperCase()
    }
    return 'UU'
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Share with Team</h3>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {sent ? (
          // Success state
          <div className="flex-1 flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
              <Check className="h-8 w-8 text-green-600" />
            </div>
            <h4 className="text-lg font-medium text-gray-900">Shared Successfully!</h4>
            <p className="text-sm text-gray-500 mt-1">
              Sent to {selectedUsers.length} {selectedUsers.length === 1 ? 'person' : 'people'}
            </p>
          </div>
        ) : (
          <>
            {/* Search */}
            <div className="px-4 py-3 border-b border-gray-100">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search team members..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  autoFocus
                />
              </div>
            </div>

            {/* User list */}
            <div className="flex-1 overflow-y-auto px-2 py-2 min-h-[200px] max-h-[300px]">
              {usersLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 text-gray-400 animate-spin" />
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <User className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm">No users found</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredUsers.map((u) => {
                    const isSelected = selectedUsers.includes(u.id)
                    return (
                      <button
                        key={u.id}
                        onClick={() => toggleUser(u.id)}
                        className={clsx(
                          'w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-left',
                          isSelected
                            ? 'bg-primary-50 border border-primary-200'
                            : 'hover:bg-gray-50'
                        )}
                      >
                        <div className={clsx(
                          'w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0',
                          isSelected ? 'bg-primary-500' : 'bg-gray-200'
                        )}>
                          {isSelected ? (
                            <Check className="h-4 w-4 text-white" />
                          ) : (
                            <span className="text-sm font-medium text-gray-600">
                              {getUserInitials(u)}
                            </span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={clsx(
                            'text-sm font-medium truncate',
                            isSelected ? 'text-primary-900' : 'text-gray-900'
                          )}>
                            {getUserDisplayName(u)}
                          </p>
                          <p className="text-xs text-gray-500 truncate">{u.email}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Message input */}
            <div className="px-4 py-3 border-t border-gray-100">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Add a message (optional)
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Write a message..."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
                rows={2}
              />
            </div>

            {/* Footer */}
            <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
              <span className="text-sm text-gray-500">
                {selectedUsers.length > 0
                  ? `${selectedUsers.length} selected`
                  : 'Select team members to share with'}
              </span>
              <button
                onClick={() => shareMutation.mutate()}
                disabled={selectedUsers.length === 0 || shareMutation.isPending}
                className={clsx(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                  selectedUsers.length > 0
                    ? 'bg-primary-600 text-white hover:bg-primary-700'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                )}
              >
                {shareMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Share
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default ShareToUserModal
