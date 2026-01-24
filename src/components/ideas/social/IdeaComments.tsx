import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import { MessageSquare, Send, ChevronDown, ChevronUp, User } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../hooks/useAuth'
import type { ItemType } from '../../../hooks/ideas/types'

interface IdeaCommentsProps {
  itemId: string
  itemType: ItemType
  maxVisible?: number
  className?: string
}

interface Comment {
  id: string
  content: string
  user_id: string
  created_at: string
  user?: {
    id: string
    email?: string
    first_name?: string
    last_name?: string
    full_name?: string
    avatar_url?: string
  }
}

export function IdeaComments({
  itemId,
  itemType,
  maxVisible = 3,
  className
}: IdeaCommentsProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [showAll, setShowAll] = useState(false)
  const [newComment, setNewComment] = useState('')

  // Fetch comments using messages table with context
  const { data: comments = [], isLoading } = useQuery({
    queryKey: ['idea-comments', itemId, itemType],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select(`
          id,
          content,
          user_id,
          created_at,
          user:users(id, email, first_name, last_name, full_name, avatar_url)
        `)
        .eq('context_type', itemType)
        .eq('context_id', itemId)
        .order('created_at', { ascending: true })

      if (error) throw error
      return data as Comment[]
    },
    staleTime: 30000
  })

  // Add comment mutation
  const addComment = useMutation({
    mutationFn: async (content: string) => {
      if (!user?.id) throw new Error('Not authenticated')

      const { error } = await supabase
        .from('messages')
        .insert({
          content,
          context_type: itemType,
          context_id: itemId,
          user_id: user.id
        })

      if (error) throw error
    },
    onSuccess: () => {
      setNewComment('')
      queryClient.invalidateQueries({ queryKey: ['idea-comments', itemId, itemType] })
    }
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (newComment.trim()) {
      addComment.mutate(newComment.trim())
    }
  }

  const visibleComments = showAll ? comments : comments.slice(0, maxVisible)
  const hasMore = comments.length > maxVisible

  const getDisplayName = (comment: Comment) => {
    const u = comment.user
    if (!u) return 'Unknown'
    return u.full_name ||
      (u.first_name && u.last_name ? `${u.first_name} ${u.last_name}` : null) ||
      u.email?.split('@')[0] ||
      'Unknown'
  }

  const getInitials = (comment: Comment) => {
    const name = getDisplayName(comment)
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
  }

  return (
    <div className={clsx('space-y-3', className)}>
      {/* Comments count header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 text-sm text-gray-600">
          <MessageSquare className="h-4 w-4" />
          <span>{comments.length} {comments.length === 1 ? 'comment' : 'comments'}</span>
        </div>
        {hasMore && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700"
          >
            {showAll ? (
              <>
                <ChevronUp className="h-3 w-3" />
                Show less
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" />
                Show all ({comments.length})
              </>
            )}
          </button>
        )}
      </div>

      {/* Comments list */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="animate-pulse flex gap-2">
              <div className="w-6 h-6 bg-gray-200 rounded-full" />
              <div className="flex-1 space-y-1">
                <div className="h-3 bg-gray-200 rounded w-1/4" />
                <div className="h-4 bg-gray-200 rounded w-3/4" />
              </div>
            </div>
          ))}
        </div>
      ) : visibleComments.length > 0 ? (
        <div className="space-y-3">
          {visibleComments.map(comment => (
            <div key={comment.id} className="flex gap-2">
              {comment.user?.avatar_url ? (
                <img
                  src={comment.user.avatar_url}
                  alt={getDisplayName(comment)}
                  className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                  <span className="text-[10px] font-medium text-gray-600">
                    {getInitials(comment)}
                  </span>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-900">
                    {getDisplayName(comment)}
                  </span>
                  <span className="text-xs text-gray-400">
                    {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
                  </span>
                </div>
                <p className="text-sm text-gray-700">{comment.content}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-500 text-center py-2">No comments yet</p>
      )}

      {/* Add comment form */}
      {user && (
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Add a comment..."
            className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
          />
          <button
            type="submit"
            disabled={!newComment.trim() || addComment.isPending}
            className={clsx(
              'p-2 rounded-lg transition-colors',
              newComment.trim()
                ? 'bg-primary-600 text-white hover:bg-primary-700'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            )}
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      )}
    </div>
  )
}

export default IdeaComments
