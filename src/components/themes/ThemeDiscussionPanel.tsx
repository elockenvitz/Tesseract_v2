import React, { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import { Building2, Globe, MessageSquare, Send, Trash2, Edit3, Check, X } from 'lucide-react'
import { Button } from '../ui/Button'
import {
  useThemeDiscussions,
  type ThemeDiscussionPost,
  type ThemeDiscussionVisibility,
} from '../../hooks/useThemeDiscussions'
import { useAuth } from '../../hooks/useAuth'

interface ThemeDiscussionPanelProps {
  themeId: string
  themeIsPublic: boolean
}

function authorName(p: ThemeDiscussionPost): string {
  const u = p.author
  if (!u) return 'Unknown'
  const full = [u.first_name, u.last_name].filter(Boolean).join(' ').trim()
  return full || u.email?.split('@')[0] || 'Unknown'
}

function authorInitials(p: ThemeDiscussionPost): string {
  const u = p.author
  const first = (u?.first_name || u?.email || '?').charAt(0).toUpperCase()
  const last = (u?.last_name || '').charAt(0).toUpperCase()
  return (first + last).slice(0, 2) || '?'
}

function VisibilityPill({ visibility, myOrgId, postOrgId, className }: {
  visibility: ThemeDiscussionVisibility
  myOrgId: string | null
  postOrgId: string
  className?: string
}) {
  if (visibility === 'shared') {
    return (
      <span className={clsx('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-50 text-violet-700', className)}>
        <Globe className="w-3 h-3" />
        Shared
      </span>
    )
  }
  const sameOrg = myOrgId === postOrgId
  return (
    <span
      className={clsx('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium', sameOrg ? 'bg-sky-50 text-sky-700' : 'bg-gray-100 text-gray-600', className)}
      title={sameOrg ? 'Visible to your org only' : "Visible only to the poster's org"}
    >
      <Building2 className="w-3 h-3" />
      Org only
    </span>
  )
}

export function ThemeDiscussionPanel({ themeId, themeIsPublic }: ThemeDiscussionPanelProps) {
  const { user } = useAuth()
  const {
    posts,
    isLoading,
    currentOrgId,
    create, isCreating,
    update, isUpdating,
    remove,
  } = useThemeDiscussions(themeId)

  // Composer state
  const [draft, setDraft] = useState('')
  const [visibility, setVisibility] = useState<ThemeDiscussionVisibility>('org')

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')

  const orderedPosts = useMemo(
    () => [...posts].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [posts]
  )

  const handlePost = async () => {
    const content = draft.trim()
    if (!content) return
    try {
      await create({ content, visibility: themeIsPublic ? visibility : 'org' })
      setDraft('')
    } catch (e) {
      console.error('Failed to post discussion message', e)
    }
  }

  const startEdit = (p: ThemeDiscussionPost) => {
    setEditingId(p.id)
    setEditDraft(p.content)
  }

  const commitEdit = async () => {
    if (!editingId) return
    try {
      await update({ id: editingId, content: editDraft })
      setEditingId(null)
      setEditDraft('')
    } catch (e) {
      console.error('Failed to edit discussion message', e)
    }
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditDraft('')
  }

  return (
    <div className="space-y-4">
      {/* Composer */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Start a discussion about this theme..."
          rows={3}
          className="w-full text-sm text-gray-900 bg-white border border-gray-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-300"
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault()
              handlePost()
            }
          }}
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-gray-600">
            {themeIsPublic ? (
              <>
                <span>Visible to:</span>
                <select
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as ThemeDiscussionVisibility)}
                  className="text-xs px-2 py-1 border border-gray-200 rounded bg-white"
                >
                  <option value="org">My org only</option>
                  <option value="shared">Everyone who sees this theme</option>
                </select>
              </>
            ) : (
              <span className="inline-flex items-center gap-1 text-gray-500">
                <Building2 className="w-3 h-3" />
                Visible to collaborators in your org
              </span>
            )}
          </div>
          <Button size="sm" onClick={handlePost} disabled={!draft.trim() || isCreating}>
            <Send className="w-3.5 h-3.5 mr-1" />
            Post
          </Button>
        </div>
      </div>

      {/* Stream */}
      {isLoading ? (
        <div className="space-y-3 animate-pulse">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="bg-gray-100 rounded-lg h-20" />
          ))}
        </div>
      ) : orderedPosts.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <MessageSquare className="h-10 w-10 text-gray-400 mx-auto mb-3" />
          <h3 className="text-base font-medium text-gray-900">No discussion yet</h3>
          <p className="text-sm text-gray-500">Be the first to share a take on this theme.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {orderedPosts.map((p) => {
            const isOwn = p.author_id === user?.id
            const isEditing = editingId === p.id
            return (
              <div key={p.id} className={clsx('bg-white border rounded-lg p-4', isOwn ? 'border-primary-200' : 'border-gray-200')}>
                <div className="flex items-start gap-3">
                  <div className={clsx('w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0', isOwn ? 'bg-primary-100 text-primary-700' : 'bg-gray-200 text-gray-700')}>
                    {authorInitials(p)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-semibold text-gray-900 truncate">{authorName(p)}</span>
                      {isOwn && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary-100 text-primary-700">You</span>}
                      <VisibilityPill visibility={p.visibility} myOrgId={currentOrgId} postOrgId={p.organization_id} />
                      <span className="text-xs text-gray-500">
                        {formatDistanceToNow(new Date(p.created_at), { addSuffix: true })}
                        {p.is_edited && <span className="ml-1 text-gray-400">(edited)</span>}
                      </span>
                    </div>
                    {isEditing ? (
                      <div className="space-y-2">
                        <textarea
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          rows={3}
                          className="w-full text-sm text-gray-900 bg-white border border-primary-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-300"
                          autoFocus
                        />
                        <div className="flex items-center gap-2">
                          <Button size="sm" onClick={commitEdit} disabled={isUpdating || !editDraft.trim()}>
                            <Check className="w-3.5 h-3.5 mr-1" />
                            Save
                          </Button>
                          <Button size="sm" variant="outline" onClick={cancelEdit}>
                            <X className="w-3.5 h-3.5 mr-1" />
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{p.content}</p>
                    )}
                  </div>
                  {isOwn && !isEditing && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => startEdit(p)}
                        className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded"
                        title="Edit"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => remove(p.id)}
                        className="p-1 text-gray-400 hover:text-error-600 hover:bg-error-50 rounded"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
