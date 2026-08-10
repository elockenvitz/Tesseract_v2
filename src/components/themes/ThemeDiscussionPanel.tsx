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
import { useIsMobile } from '../../hooks/useMediaQuery'

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
      className={clsx('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium', sameOrg ? 'bg-sky-50 text-sky-700' : 'bg-gray-100 text-gray-600 dark:text-gray-400 dark:bg-gray-800', className)}
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
  const isMobileViewport = useIsMobile()
  const [composerOpen, setComposerOpen] = useState(false)

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
      // Collapse back to the one-line trigger on a phone, so the stream —
      // which now has the new post at the top of it — is what you land on.
      setComposerOpen(false)
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
    <div className="space-y-3 sm:space-y-4">
      {/* Composer.

          On a phone this is collapsed to a single line until it is wanted. A
          permanently-open three-row textarea plus a visibility select plus a
          Post button is roughly a third of the screen spent on writing, above
          a stream you came here to read. It opens on tap and stays open while
          there is a draft. */}
      {isMobileViewport && !composerOpen && !draft.trim() ? (
        <button
          onClick={() => setComposerOpen(true)}
          className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm text-gray-400 bg-white border border-gray-200 rounded-lg dark:border-gray-700 dark:bg-gray-800"
        >
          <MessageSquare className="w-4 h-4 shrink-0" />
          Start a discussion…
        </button>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg p-3 sm:p-4 dark:border-gray-700 dark:bg-gray-800">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Start a discussion about this theme..."
            rows={3}
            autoFocus={isMobileViewport && composerOpen}
            className="w-full text-sm text-gray-900 bg-white border border-gray-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-300 dark:border-gray-700 dark:text-white dark:bg-gray-800"
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault()
                handlePost()
              }
            }}
          />
          <div className="mt-2 flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-2 sm:gap-3">
            <div className="flex items-center gap-2 text-xs text-gray-600 min-w-0 dark:text-gray-400">
              {themeIsPublic ? (
                <>
                  <span className="shrink-0">Visible to:</span>
                  <select
                    value={visibility}
                    onChange={(e) => setVisibility(e.target.value as ThemeDiscussionVisibility)}
                    className="text-xs px-2 py-1 border border-gray-200 rounded bg-white min-w-0 dark:border-gray-700 dark:bg-gray-800"
                  >
                    <option value="org">My org only</option>
                    <option value="shared">Everyone who sees this theme</option>
                  </select>
                </>
              ) : (
                <span className="inline-flex items-center gap-1 text-gray-500 dark:text-gray-400">
                  <Building2 className="w-3 h-3 shrink-0" />
                  Visible to collaborators in your org
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isMobileViewport && (
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => { setDraft(''); setComposerOpen(false) }}
                >
                  Cancel
                </Button>
              )}
              <Button
                size="sm"
                onClick={handlePost}
                disabled={!draft.trim() || isCreating}
                className="max-sm:flex-1"
              >
                <Send className="w-3.5 h-3.5 mr-1" />
                Post
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Stream */}
      {isLoading ? (
        <div className="space-y-3 animate-pulse">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="bg-gray-100 rounded-lg h-20 dark:bg-gray-800" />
          ))}
        </div>
      ) : orderedPosts.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg dark:bg-gray-900">
          <MessageSquare className="h-10 w-10 text-gray-400 mx-auto mb-3" />
          <h3 className="text-base font-medium text-gray-900 dark:text-white">No discussion yet</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">Be the first to share a take on this theme.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {orderedPosts.map((p) => {
            const isOwn = p.author_id === user?.id
            const isEditing = editingId === p.id
            return (
              <div key={p.id} className={clsx('bg-white border rounded-lg p-3 sm:p-4 dark:bg-gray-800', isOwn ? 'border-primary-200' : 'border-gray-200 dark:border-gray-700')}>
                <div className="flex items-start gap-2.5 sm:gap-3">
                  <div className={clsx('w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0', isOwn ? 'bg-primary-100 text-primary-700' : 'bg-gray-200 text-gray-700 dark:text-gray-300')}>
                    {authorInitials(p)}
                  </div>
                  <div className="flex-1 min-w-0">
                    {/* Author and time on one line, the qualifiers under it.
                        Four items in a single wrapping run put the timestamp
                        somewhere different on every card depending on how long
                        the name was. */}
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span className="text-sm font-semibold text-gray-900 truncate dark:text-white">{authorName(p)}</span>
                      {isOwn && <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary-100 text-primary-700">You</span>}
                      <span className="ml-auto shrink-0 text-xs text-gray-500 dark:text-gray-400">
                        {formatDistanceToNow(new Date(p.created_at), { addSuffix: true })}
                        {p.is_edited && <span className="ml-1 text-gray-400">(edited)</span>}
                      </span>
                    </div>
                    <div className="mb-1.5 mt-0.5">
                      <VisibilityPill visibility={p.visibility} myOrgId={currentOrgId} postOrgId={p.organization_id} />
                    </div>

                    {isEditing ? (
                      <div className="space-y-2">
                        <textarea
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          rows={3}
                          className="w-full text-sm text-gray-900 bg-white border border-primary-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-300 dark:text-white dark:bg-gray-800"
                          autoFocus
                        />
                        <div className="flex items-center gap-2">
                          <Button size="sm" onClick={commitEdit} disabled={isUpdating || !editDraft.trim()} className="max-sm:flex-1">
                            <Check className="w-3.5 h-3.5 mr-1" />
                            Save
                          </Button>
                          <Button size="sm" variant="outline" onClick={cancelEdit} className="max-sm:flex-1">
                            <X className="w-3.5 h-3.5 mr-1" />
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-800 whitespace-pre-wrap break-words dark:text-gray-100">{p.content}</p>
                    )}

                    {/* Own-post actions sit under the post on a phone. As
                        top-right icon buttons they were forced to 44px by the
                        touch minimum and took a third of the card's width away
                        from the text they belonged to. */}
                    {isOwn && !isEditing && isMobileViewport && (
                      <div className="flex items-center gap-1 mt-2 -ml-2.5 border-t border-gray-100 pt-2 dark:border-gray-800">
                        <button
                          onClick={() => startEdit(p)}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-primary-600 rounded hover:bg-primary-50 dark:hover:bg-primary-900/20"
                        >
                          <Edit3 className="w-3.5 h-3.5 shrink-0" /> Edit
                        </button>
                        <button
                          onClick={() => remove(p.id)}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-500 rounded hover:text-error-600 hover:bg-error-50 dark:text-gray-400"
                        >
                          <Trash2 className="w-3.5 h-3.5 shrink-0" /> Delete
                        </button>
                      </div>
                    )}
                  </div>

                  {isOwn && !isEditing && !isMobileViewport && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => startEdit(p)}
                        className="no-touch-target p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded dark:hover:text-gray-200 dark:hover:bg-gray-700"
                        title="Edit"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => remove(p.id)}
                        className="no-touch-target p-1 text-gray-400 hover:text-error-600 hover:bg-error-50 rounded"
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
