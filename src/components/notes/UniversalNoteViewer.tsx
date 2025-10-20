import React, { useState } from 'react'
import { Edit, Share2, Send } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { formatDistanceToNow } from 'date-fns'
import ReactMarkdown from 'react-markdown'

export type EntityType = 'asset' | 'portfolio' | 'theme'

export interface UniversalNoteViewerProps {
  entityType: EntityType
  entityId: string
  noteId: string
  onEdit?: () => void
  onShare?: () => void
}

interface EntityConfig {
  tableName: string
  foreignKey: string
  queryKey: string
  commentsTable: string
}

const ENTITY_CONFIGS: Record<EntityType, EntityConfig> = {
  asset: {
    tableName: 'asset_notes',
    foreignKey: 'asset_id',
    queryKey: 'asset-notes',
    commentsTable: 'asset_note_comments'
  },
  portfolio: {
    tableName: 'portfolio_notes',
    foreignKey: 'portfolio_id',
    queryKey: 'portfolio-notes',
    commentsTable: 'portfolio_note_comments'
  },
  theme: {
    tableName: 'theme_notes',
    foreignKey: 'theme_id',
    queryKey: 'theme-notes',
    commentsTable: 'theme_note_comments'
  }
}

export function UniversalNoteViewer({
  entityType,
  entityId,
  noteId,
  onEdit,
  onShare
}: UniversalNoteViewerProps) {
  const config = ENTITY_CONFIGS[entityType]
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [newComment, setNewComment] = useState('')

  // Fetch the note
  const { data: note, isLoading: noteLoading } = useQuery({
    queryKey: [config.queryKey, entityId, noteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from(config.tableName)
        .select('*')
        .eq('id', noteId)
        .single()
      if (error) throw error
      return data
    }
  })

  // Fetch comments
  const { data: comments } = useQuery({
    queryKey: ['note-comments', noteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from(config.commentsTable)
        .select(`
          *,
          users:created_by (
            id,
            first_name,
            last_name,
            email
          )
        `)
        .eq('note_id', noteId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data || []
    }
  })

  // Check if user has write access
  const hasWriteAccess = note?.created_by === user?.id

  // Add comment mutation
  const addCommentMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!user) throw new Error('User not authenticated')
      const { data, error } = await supabase
        .from(config.commentsTable)
        .insert([{
          note_id: noteId,
          content,
          created_by: user.id
        }])
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['note-comments', noteId] })
      setNewComment('')
    }
  })

  const handleAddComment = () => {
    if (newComment.trim()) {
      addCommentMutation.mutate(newComment)
    }
  }

  const getNoteTypeColor = (type: string | null) => {
    switch (type) {
      case 'meeting': return 'success'
      case 'call': return 'purple'
      case 'research': return 'warning'
      case 'idea': return 'error'
      case 'analysis': return 'primary'
      case 'general': return 'default'
      default: return 'default'
    }
  }

  const getUserName = (userObj: any) => {
    if (!userObj) return 'Unknown'
    if (userObj.first_name && userObj.last_name) {
      return `${userObj.first_name} ${userObj.last_name}`
    }
    return userObj.email?.split('@')[0] || 'Unknown'
  }

  if (noteLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" />
      </div>
    )
  }

  if (!note) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Note not found</div>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-200px)]">
      {/* Main Note Content - 2/3 width */}
      <div className="flex-1 flex flex-col border-r border-gray-200">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 bg-white">
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-gray-900 mb-2">
                {note.title || 'Untitled'}
              </h1>
              <div className="flex items-center space-x-3">
                <Badge variant={getNoteTypeColor(note.note_type)} size="sm">
                  {note.note_type || 'general'}
                </Badge>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              {onShare && (
                <Button variant="outline" size="sm" onClick={onShare}>
                  <Share2 className="h-4 w-4 mr-2" />
                  Share
                </Button>
              )}
              {hasWriteAccess && onEdit && (
                <Button variant="outline" size="sm" onClick={onEdit}>
                  <Edit className="h-4 w-4 mr-2" />
                  Edit
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Note Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="prose max-w-none">
            <ReactMarkdown>{note.content || 'No content'}</ReactMarkdown>
          </div>
        </div>
      </div>

      {/* Comments Sidebar - 1/3 width */}
      <div className="w-1/3 flex flex-col bg-gray-50">
        {/* Comments Header */}
        <div className="p-4 border-b border-gray-200 bg-white">
          <h3 className="font-semibold text-gray-900">Comments</h3>
        </div>

        {/* Comments List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {comments && comments.length > 0 ? (
            comments.map((comment) => (
              <div key={comment.id} className="bg-white rounded-lg p-3 shadow-sm">
                <div className="flex items-start justify-between mb-2">
                  <div className="font-medium text-sm text-gray-900">
                    {getUserName(comment.users)}
                  </div>
                  <div className="text-xs text-gray-500">
                    {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
                  </div>
                </div>
                <p className="text-sm text-gray-700">{comment.content}</p>
              </div>
            ))
          ) : (
            <div className="text-center py-8 text-gray-500 text-sm">
              No comments yet
            </div>
          )}
        </div>

        {/* Add Comment */}
        <div className="p-4 border-t border-gray-200 bg-white">
          <div className="space-y-2">
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Add a comment..."
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              rows={3}
            />
            <Button
              size="sm"
              onClick={handleAddComment}
              disabled={!newComment.trim() || addCommentMutation.isPending}
              className="w-full"
            >
              <Send className="h-4 w-4 mr-2" />
              {addCommentMutation.isPending ? 'Posting...' : 'Post Comment'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
