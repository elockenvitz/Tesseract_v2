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
  const [isCommentInputExpanded, setIsCommentInputExpanded] = useState(false)

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
    enabled: !!itemId,
    staleTime: 5 * 60 * 1000, // 5 minutes - comments don't change that often
    gcTime: 10 * 60 * 1000,   // Keep in cache for 10 minutes
    refetchOnWindowFocus: false,
    refetchOnMount: false,
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
      setIsCommentInputExpanded(false)
    }
  }

  // Collapse input when clicking outside or on blur with no content
  const handleInputBlur = () => {
    if (!newComment.trim()) {
      setIsCommentInputExpanded(false)
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
    <div className={clsx('flex flex-col', className)}>
      {/* Add comment - collapsed by default, expands on click */}
      {user && (
        <div className="mb-2">
          {isCommentInputExpanded ? (
            /* Expanded: input + send button */
            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                type="text"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                onBlur={handleInputBlur}
                placeholder="Write a comment..."
                autoFocus
                className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded focus:outline-none focus:border-gray-300"
              />
              <button
                type="submit"
                disabled={!newComment.trim() || addComment.isPending}
                className={clsx(
                  'p-1.5 rounded transition-colors',
                  newComment.trim()
                    ? 'bg-gray-700 text-white hover:bg-gray-800'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                )}
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </form>
          ) : (
            /* Collapsed: minimal text button affordance */
            <button
              onClick={() => setIsCommentInputExpanded(true)}
              className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
            >
              + Add a comment...
            </button>
          )}
        </div>
      )}

      {/* Comments section with stable height during loading */}
      <div className="min-h-[40px]">
        {/* Loading state - subtle spinner */}
        {isLoading ? (
          <div className="flex items-center justify-center py-3">
            <div className="flex items-center gap-2 text-gray-400">
              <div className="w-3 h-3 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin" />
              <span className="text-[11px]">Loading...</span>
            </div>
          </div>
        ) : visibleComments.length > 0 ? (
          <>
            {/* Comments count header - ONLY show when there ARE comments */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <MessageSquare className="h-3.5 w-3.5" />
                <span>{comments.length} {comments.length === 1 ? 'comment' : 'comments'}</span>
              </div>
              {hasMore && (
                <button
                  onClick={() => setShowAll(!showAll)}
                  className="flex items-center gap-1 text-[11px] text-primary-600 hover:text-primary-700"
                >
                  {showAll ? (
                    <>
                      <ChevronUp className="h-3 w-3" />
                      Show less
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3 w-3" />
                      Show all
                    </>
                  )}
                </button>
              )}
            </div>
            {/* Comment list */}
            <div className="space-y-2.5">
              {visibleComments.map(comment => (
                <div key={comment.id} className="flex gap-2">
                  {comment.user?.avatar_url ? (
                    <img
                      src={comment.user.avatar_url}
                      alt={getDisplayName(comment)}
                      className="w-5 h-5 rounded-full object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                      <span className="text-[9px] font-medium text-gray-600">
                        {getInitials(comment)}
                      </span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-medium text-gray-900">
                        {getDisplayName(comment)}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
                      </span>
                    </div>
                    <p className="text-xs text-gray-700 leading-snug">{comment.content}</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          /* Empty state: ONE helper line only, no "0 comments" label */
          <p className="text-[11px] text-gray-400 text-center py-1">No comments yet</p>
        )}
      </div>
    </div>
  )
}

export default IdeaComments
