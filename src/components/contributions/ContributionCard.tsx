import React, { useState, useRef, useEffect } from 'react'
import { clsx } from 'clsx'
import {
  User,
  Edit3,
  Trash2,
  Pin,
  Archive,
  MoreVertical,
  MessageSquare,
  ThumbsUp,
  ThumbsDown,
  AlertCircle,
  HelpCircle,
  History,
  ChevronDown,
  ChevronUp,
  Users,
  Building2,
  Globe,
  Briefcase,
  FolderTree
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useAuth } from '../../hooks/useAuth'
import { useContributionReplies, useContributionHistory } from '../../hooks/useContributions'
import type { Contribution, ReactionType, ContributionVisibility } from '../../hooks/useContributions'

interface OrgNode {
  id: string
  name: string
  color: string
  node_type: string
}

interface UserOrgContext {
  portfolios: OrgNode[]
  teams: OrgNode[]
  departments: OrgNode[]
  divisions: OrgNode[]
}

interface ContributionCardProps {
  contribution: Contribution
  onEdit?: (id: string, content: string) => void
  onDelete?: (id: string) => void
  onTogglePin?: (id: string, isPinned: boolean) => void
  onToggleArchive?: (id: string, isArchived: boolean) => void
  onToggleReaction?: (contributionId: string, reaction: ReactionType) => void
  onChangeVisibility?: (id: string, visibility: ContributionVisibility, targetIds: string[]) => void
  userOrgContext?: UserOrgContext
  isEditable?: boolean
  canPin?: boolean
  canArchive?: boolean
}

const REACTION_CONFIG: Record<ReactionType, { icon: React.ElementType; label: string; activeColor: string }> = {
  agree: { icon: ThumbsUp, label: 'Agree', activeColor: 'text-green-600 bg-green-50' },
  disagree: { icon: ThumbsDown, label: 'Disagree', activeColor: 'text-red-600 bg-red-50' },
  important: { icon: AlertCircle, label: 'Important', activeColor: 'text-amber-600 bg-amber-50' },
  question: { icon: HelpCircle, label: 'Question', activeColor: 'text-blue-600 bg-blue-50' }
}

const VISIBILITY_CONFIG: Record<ContributionVisibility, { icon: React.ElementType; label: string; color: string }> = {
  portfolio: { icon: Briefcase, label: 'Portfolio', color: 'text-indigo-500' },
  team: { icon: Users, label: 'Team', color: 'text-blue-500' },
  department: { icon: FolderTree, label: 'Dept', color: 'text-cyan-500' },
  division: { icon: Building2, label: 'Division', color: 'text-purple-500' },
  firm: { icon: Globe, label: 'Firm', color: 'text-green-500' }
}

export function ContributionCard({
  contribution,
  onEdit,
  onDelete,
  onTogglePin,
  onToggleArchive,
  onToggleReaction,
  onChangeVisibility,
  userOrgContext,
  isEditable = true,
  canPin = false,
  canArchive = false
}: ContributionCardProps) {
  const { user } = useAuth()
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(contribution.content)
  const [showMenu, setShowMenu] = useState(false)
  const [showReplies, setShowReplies] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showVisibilityMenu, setShowVisibilityMenu] = useState(false)
  const [pendingVisibility, setPendingVisibility] = useState<ContributionVisibility | null>(null)
  const [selectedTargetIds, setSelectedTargetIds] = useState<string[]>([])
  const [newReply, setNewReply] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const visibilityMenuRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isOwner = user?.id === contribution.created_by
  const visibilityConfig = VISIBILITY_CONFIG[contribution.visibility]
  const VisibilityIcon = visibilityConfig.icon

  // Get replies for this contribution
  const { replies, createReply, isLoading: repliesLoading } = useContributionReplies(contribution.id)
  const { history, isLoading: historyLoading } = useContributionHistory(contribution.id)

  // Close menus on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false)
      }
      if (visibilityMenuRef.current && !visibilityMenuRef.current.contains(event.target as Node)) {
        setShowVisibilityMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Auto-resize textarea
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
    }
  }, [isEditing, editContent])

  const handleSaveEdit = () => {
    if (editContent.trim() && editContent !== contribution.content) {
      onEdit?.(contribution.id, editContent.trim())
    }
    setIsEditing(false)
  }

  const handleCancelEdit = () => {
    setEditContent(contribution.content)
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleCancelEdit()
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSaveEdit()
    }
  }

  const handleSubmitReply = async () => {
    if (!newReply.trim()) return
    await createReply.mutateAsync({ content: newReply.trim() })
    setNewReply('')
  }

  // Get reaction counts and check if current user has reacted
  const getReactionInfo = (reactionType: ReactionType) => {
    const reactionsOfType = contribution.reactions?.filter(r => r.reaction === reactionType) || []
    const count = reactionsOfType.length
    const hasReacted = reactionsOfType.some(r => r.user_id === user?.id)
    return { count, hasReacted }
  }

  return (
    <div
      className={clsx(
        'bg-white border rounded-lg shadow-sm transition-all',
        contribution.is_pinned && 'border-amber-300 bg-amber-50/30',
        contribution.is_archived && 'opacity-60'
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between p-4 pb-2">
        <div className="flex items-center space-x-3">
          {/* Avatar */}
          <div className="flex-shrink-0">
            <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center">
              <span className="text-sm font-medium text-primary-700">
                {(contribution.user?.full_name || 'U').charAt(0).toUpperCase()}
              </span>
            </div>
          </div>

          {/* User info - compact single line */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5">
              <span className="font-medium text-gray-900 text-sm">
                {contribution.user?.full_name || 'Unknown User'}
              </span>
              <span className="text-xs text-gray-400">
                {formatDistanceToNow(new Date(contribution.created_at), { addSuffix: true })}
                {contribution.updated_at !== contribution.created_at && ' (edited)'}
              </span>
              {contribution.team && (
                <span
                  className="text-xs px-1.5 py-0.5 rounded"
                  style={{
                    backgroundColor: contribution.team.color ? `${contribution.team.color}15` : '#f3f4f6',
                    color: contribution.team.color || '#6b7280'
                  }}
                >
                  {contribution.team.name}
                </span>
              )}
              {isOwner && onChangeVisibility && userOrgContext ? (
                <div className="relative" ref={visibilityMenuRef}>
                  <button
                    onClick={() => {
                      setShowVisibilityMenu(!showVisibilityMenu)
                      setPendingVisibility(null)
                      setSelectedTargetIds([])
                    }}
                    className={clsx(
                      'flex items-center text-xs px-1.5 py-0.5 rounded hover:bg-gray-100 transition-colors',
                      visibilityConfig.color
                    )}
                    title="Change visibility"
                  >
                    <VisibilityIcon className="w-3 h-3 mr-0.5" />
                    {visibilityConfig.label}
                    <ChevronDown className="w-3 h-3 ml-0.5 opacity-50" />
                  </button>
                  {showVisibilityMenu && (
                    <div className="absolute left-0 top-6 z-20 w-64 bg-white border rounded-lg shadow-lg py-1">
                      {!pendingVisibility ? (
                        // Step 1: Select visibility level
                        <>
                          <div className="px-3 py-1.5 text-xs font-medium text-gray-500 border-b">
                            Select visibility
                          </div>
                          {(Object.entries(VISIBILITY_CONFIG) as [ContributionVisibility, typeof VISIBILITY_CONFIG[ContributionVisibility]][]).map(([key, config]) => {
                            const Icon = config.icon
                            return (
                              <button
                                key={key}
                                onClick={() => {
                                  if (key === 'firm') {
                                    // Firm doesn't need target selection
                                    onChangeVisibility(contribution.id, key, [])
                                    setShowVisibilityMenu(false)
                                  } else {
                                    setPendingVisibility(key)
                                    setSelectedTargetIds([])
                                  }
                                }}
                                className={clsx(
                                  'w-full flex items-center px-3 py-1.5 text-xs hover:bg-gray-50',
                                  contribution.visibility === key && !pendingVisibility ? 'bg-gray-100 font-medium' : ''
                                )}
                              >
                                <Icon className={clsx('w-3 h-3 mr-2', config.color)} />
                                {config.label}
                                {key !== 'firm' && <ChevronDown className="w-3 h-3 ml-auto rotate-[-90deg]" />}
                              </button>
                            )
                          })}
                        </>
                      ) : (
                        // Step 2: Select targets
                        <>
                          <div className="px-3 py-1.5 text-xs font-medium text-gray-500 border-b flex items-center justify-between">
                            <button
                              onClick={() => setPendingVisibility(null)}
                              className="text-primary-600 hover:text-primary-700"
                            >
                              ← Back
                            </button>
                            <span>Select {pendingVisibility}(s)</span>
                          </div>
                          <div className="max-h-48 overflow-y-auto">
                            {(() => {
                              const targets = pendingVisibility === 'portfolio' ? userOrgContext.portfolios
                                : pendingVisibility === 'team' ? userOrgContext.teams
                                : pendingVisibility === 'department' ? userOrgContext.departments
                                : userOrgContext.divisions
                              return targets.map((target) => {
                                const isSelected = selectedTargetIds.includes(target.id)
                                return (
                                  <button
                                    key={target.id}
                                    onClick={() => {
                                      setSelectedTargetIds(prev =>
                                        prev.includes(target.id)
                                          ? prev.filter(id => id !== target.id)
                                          : [...prev, target.id]
                                      )
                                    }}
                                    className={clsx(
                                      'w-full flex items-center px-3 py-1.5 text-xs hover:bg-gray-50',
                                      isSelected && 'bg-primary-50'
                                    )}
                                  >
                                    <div className={clsx(
                                      'w-3.5 h-3.5 rounded border mr-2 flex items-center justify-center flex-shrink-0',
                                      isSelected ? 'bg-primary-600 border-primary-600' : 'border-gray-300'
                                    )}>
                                      {isSelected && (
                                        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                      )}
                                    </div>
                                    <span
                                      className="w-2 h-2 rounded-full mr-1.5"
                                      style={{ backgroundColor: target.color || '#6b7280' }}
                                    />
                                    {target.name}
                                  </button>
                                )
                              })
                            })()}
                          </div>
                          <div className="px-3 py-2 border-t flex justify-end">
                            <button
                              onClick={() => {
                                if (selectedTargetIds.length > 0) {
                                  onChangeVisibility(contribution.id, pendingVisibility, selectedTargetIds)
                                  setShowVisibilityMenu(false)
                                  setPendingVisibility(null)
                                  setSelectedTargetIds([])
                                }
                              }}
                              disabled={selectedTargetIds.length === 0}
                              className="px-3 py-1 text-xs bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Apply ({selectedTargetIds.length})
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <span className={clsx('flex items-center text-xs', visibilityConfig.color)}>
                  <VisibilityIcon className="w-3 h-3 mr-0.5" />
                  {visibilityConfig.label}
                </span>
              )}
              {contribution.is_pinned && (
                <span className="flex items-center text-xs text-amber-600">
                  <Pin className="w-3 h-3 mr-0.5" />
                  Pinned
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Actions menu */}
        {(isOwner || canPin || canArchive) && (
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {showMenu && (
              <div className="absolute right-0 top-8 z-10 w-40 bg-white border rounded-lg shadow-lg py-1">
                {isOwner && isEditable && (
                  <>
                    <button
                      onClick={() => {
                        setIsEditing(true)
                        setShowMenu(false)
                      }}
                      className="w-full flex items-center px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      <Edit3 className="w-4 h-4 mr-2" />
                      Edit
                    </button>
                    <button
                      onClick={() => {
                        onDelete?.(contribution.id)
                        setShowMenu(false)
                      }}
                      className="w-full flex items-center px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete
                    </button>
                  </>
                )}
                {canPin && (
                  <button
                    onClick={() => {
                      onTogglePin?.(contribution.id, !contribution.is_pinned)
                      setShowMenu(false)
                    }}
                    className="w-full flex items-center px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <Pin className="w-4 h-4 mr-2" />
                    {contribution.is_pinned ? 'Unpin' : 'Pin to top'}
                  </button>
                )}
                {canArchive && (
                  <button
                    onClick={() => {
                      onToggleArchive?.(contribution.id, !contribution.is_archived)
                      setShowMenu(false)
                    }}
                    className="w-full flex items-center px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <Archive className="w-4 h-4 mr-2" />
                    {contribution.is_archived ? 'Restore' : 'Archive'}
                  </button>
                )}
                <button
                  onClick={() => {
                    setShowHistory(!showHistory)
                    setShowMenu(false)
                  }}
                  className="w-full flex items-center px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <History className="w-4 h-4 mr-2" />
                  View history
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="px-4 pb-3">
        {isEditing ? (
          <div className="space-y-2">
            <textarea
              ref={textareaRef}
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full p-3 border rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Write your contribution..."
              rows={3}
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">
                Cmd+Enter to save, Escape to cancel
              </span>
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleCancelEdit}
                  className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded hover:bg-primary-700"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-gray-700 whitespace-pre-wrap">
            {contribution.content}
          </div>
        )}
      </div>

      {/* Reactions and replies bar */}
      <div className="px-4 py-2 border-t flex items-center justify-between">
        {/* Reactions */}
        <div className="flex items-center space-x-1">
          {(Object.entries(REACTION_CONFIG) as [ReactionType, typeof REACTION_CONFIG[ReactionType]][]).map(([type, config]) => {
            const { count, hasReacted } = getReactionInfo(type)
            const Icon = config.icon
            return (
              <button
                key={type}
                onClick={() => onToggleReaction?.(contribution.id, type)}
                className={clsx(
                  'flex items-center px-2 py-1 rounded text-xs transition-colors',
                  hasReacted
                    ? config.activeColor
                    : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                )}
                title={config.label}
              >
                <Icon className="w-3.5 h-3.5" />
                {count > 0 && <span className="ml-1">{count}</span>}
              </button>
            )
          })}
        </div>

        {/* Reply toggle */}
        <button
          onClick={() => setShowReplies(!showReplies)}
          className="flex items-center text-xs text-gray-500 hover:text-gray-700"
        >
          <MessageSquare className="w-3.5 h-3.5 mr-1" />
          {contribution.replies_count || 0} {contribution.replies_count === 1 ? 'reply' : 'replies'}
          {showReplies ? (
            <ChevronUp className="w-3 h-3 ml-1" />
          ) : (
            <ChevronDown className="w-3 h-3 ml-1" />
          )}
        </button>
      </div>

      {/* Replies section */}
      {showReplies && (
        <div className="border-t bg-gray-50 p-4 space-y-3">
          {repliesLoading ? (
            <div className="text-sm text-gray-500 text-center py-2">Loading replies...</div>
          ) : replies.length === 0 ? (
            <div className="text-sm text-gray-500 text-center py-2">No replies yet</div>
          ) : (
            <div className="space-y-3">
              {replies.map((reply) => (
                <div key={reply.id} className="flex space-x-2">
                  <div className="flex-shrink-0">
                    <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center">
                      <span className="text-xs font-medium text-gray-600">
                        {(reply.user?.full_name || 'U').charAt(0).toUpperCase()}
                      </span>
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-medium text-gray-900">
                        {reply.user?.full_name || 'Unknown'}
                      </span>
                      <span className="text-xs text-gray-400">
                        {formatDistanceToNow(new Date(reply.created_at), { addSuffix: true })}
                      </span>
                      {reply.is_edited && (
                        <span className="text-xs text-gray-400">(edited)</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-700 mt-0.5">{reply.content}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* New reply input */}
          <div className="flex space-x-2 pt-2">
            <input
              type="text"
              value={newReply}
              onChange={(e) => setNewReply(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSubmitReply()
                }
              }}
              placeholder="Write a reply..."
              className="flex-1 px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <button
              onClick={handleSubmitReply}
              disabled={!newReply.trim() || createReply.isPending}
              className="px-3 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Reply
            </button>
          </div>
        </div>
      )}

      {/* History section */}
      {showHistory && (
        <div className="border-t bg-gray-50 p-4">
          <h4 className="text-sm font-medium text-gray-700 mb-3 flex items-center">
            <History className="w-4 h-4 mr-1" />
            Edit History
          </h4>
          {historyLoading ? (
            <div className="text-sm text-gray-500 text-center py-2">Loading history...</div>
          ) : history.length === 0 ? (
            <div className="text-sm text-gray-500 text-center py-2">No edits recorded</div>
          ) : (
            <div className="space-y-3">
              {history.map((h) => (
                <div key={h.id} className="text-sm border-l-2 border-gray-300 pl-3">
                  <div className="flex items-center text-xs text-gray-500 mb-1">
                    <span className="font-medium">{h.user?.full_name || 'Unknown'}</span>
                    <span className="mx-1">•</span>
                    <span>{formatDistanceToNow(new Date(h.changed_at), { addSuffix: true })}</span>
                  </div>
                  {h.old_content && (
                    <div className="p-2 bg-red-50 rounded text-xs text-red-700 mb-1 line-through">
                      {h.old_content.substring(0, 200)}
                      {h.old_content.length > 200 && '...'}
                    </div>
                  )}
                  <div className="p-2 bg-green-50 rounded text-xs text-green-700">
                    {h.new_content.substring(0, 200)}
                    {h.new_content.length > 200 && '...'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
