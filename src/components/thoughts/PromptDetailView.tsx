/**
 * PromptDetailView
 *
 * Dedicated detail view for Prompt items (idea_type='prompt' in quick_thoughts).
 * Shows prompt-specific metadata, response thread, and status controls.
 * Replaces the generic QuickThoughtDetailPanel for prompts.
 */

import { useState, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { clsx } from 'clsx'
import {
  MessageCircleQuestion,
  Clock,
  CheckCircle2,
  RotateCcw,
  Pencil,
  TrendingUp,
  Copy,
  MoreHorizontal,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useQuickThought } from '../../hooks/useQuickThoughtsFeed'
import { IdeaComments } from '../ideas/social/IdeaComments'
import { useToast } from '../common/Toast'
import { formatRelativeTime } from './RecentQuickIdeas'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PromptStatus = 'open' | 'responded' | 'closed'

// ---------------------------------------------------------------------------
// Tag helpers (same convention as PromptModal + useRecentQuickIdeas)
// ---------------------------------------------------------------------------

function extractTag(tags: string[] | null | undefined, prefix: string): string | undefined {
  if (!tags) return undefined
  const match = tags.find(t => t.startsWith(prefix))
  return match ? match.slice(prefix.length) : undefined
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** First name of assignee, or full display name as fallback. */
function getPrimaryResponderFirstName(
  assigneeUser: { first_name?: string | null; last_name?: string | null; email?: string | null } | null | undefined
): string | undefined {
  if (!assigneeUser) return undefined
  return assigneeUser.first_name || assigneeUser.email?.split('@')[0] || 'Unknown'
}

/** Accountable empty-state text for the responses section. */
function getAwaitingResponseText(responderFirstName: string | undefined): string {
  if (responderFirstName) return `Awaiting response from ${responderFirstName}.`
  return 'No responses yet.'
}

/** "0 responses", "1 response", "3 responses" */
function pluralizeResponseCount(n: number): string {
  return `${n} ${n === 1 ? 'response' : 'responses'}`
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PromptDetailViewProps {
  promptId: string
  onClose?: () => void
}

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<PromptStatus, { label: string; icon: typeof Clock; cls: string; bg: string }> = {
  open: {
    label: 'Open',
    icon: Clock,
    cls: 'text-violet-700 dark:text-violet-300',
    bg: 'bg-violet-100 dark:bg-violet-900/30',
  },
  responded: {
    label: 'Responded',
    icon: MessageCircleQuestion,
    cls: 'text-emerald-700 dark:text-emerald-300',
    bg: 'bg-emerald-100 dark:bg-emerald-900/30',
  },
  closed: {
    label: 'Resolved',
    icon: CheckCircle2,
    cls: 'text-gray-500 dark:text-gray-400',
    bg: 'bg-gray-100 dark:bg-gray-700',
  },
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PromptDetailView({ promptId, onClose }: PromptDetailViewProps) {
  const { user } = useAuth()
  const { success } = useToast()
  const queryClient = useQueryClient()

  // Fetch the quick_thought row (prompts are stored in the same table)
  const { data: thought, isLoading } = useQuickThought(promptId)

  // --- Local status state (TODO: persist to DB when status column exists) ---
  const [status, setStatus] = useState<PromptStatus>('open')

  // --- Editing state ---
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')

  // --- Secondary menu ---
  const [showMenu, setShowMenu] = useState(false)

  // --- Response count (reported from IdeaComments) ---
  const [responseCount, setResponseCount] = useState(0)
  const handleCountChange = useCallback((count: number) => setResponseCount(count), [])

  // Sync from fetched data
  useEffect(() => {
    if (thought) {
      setEditContent(thought.content)
      // TODO: Read actual status from DB when column exists
      // For now: if there are responses (messages), consider it 'responded'
    }
  }, [thought])

  // --- Fetch assignee name ---
  const assigneeId = extractTag(thought?.tags, 'assignee:')
  const { data: assigneeUser } = useQuery({
    queryKey: ['user-lookup', assigneeId],
    queryFn: async () => {
      if (!assigneeId) return null
      const { data } = await supabase
        .from('users')
        .select('id, first_name, last_name, email')
        .eq('id', assigneeId)
        .maybeSingle()
      return data
    },
    enabled: !!assigneeId,
    staleTime: 5 * 60_000,
  })

  // --- Update mutation (for editing prompt content) ---
  const updateMutation = useMutation({
    mutationFn: async (content: string) => {
      const { error } = await supabase
        .from('quick_thoughts')
        .update({ content, updated_at: new Date().toISOString() })
        .eq('id', promptId)
      if (error) throw error
    },
    onSuccess: () => {
      success('Prompt updated')
      setIsEditing(false)
      queryClient.invalidateQueries({ queryKey: ['quick-thought', promptId] })
      queryClient.invalidateQueries({ queryKey: ['recent-quick-ideas'] })
    },
  })

  // Derived values
  const isCreator = user?.id === thought?.author?.id
  const title = extractTag(thought?.tags, 'title:')
  const authorName = thought?.author
    ? thought.author.first_name
      ? `${thought.author.first_name}${thought.author.last_name ? ' ' + thought.author.last_name : ''}`
      : thought.author.email?.split('@')[0] || 'Unknown'
    : 'Unknown'
  const assigneeName = assigneeUser
    ? assigneeUser.first_name
      ? `${assigneeUser.first_name}${assigneeUser.last_name ? ' ' + assigneeUser.last_name : ''}`
      : assigneeUser.email?.split('@')[0] || 'Unknown'
    : undefined
  const contextLabel = thought?.asset?.symbol
    || (thought as any)?.portfolio?.name
    || (thought as any)?.theme?.name
    || undefined
  const contextType: 'asset' | 'portfolio' | 'theme' | undefined =
    thought?.asset?.symbol ? 'asset'
    : (thought as any)?.portfolio?.name ? 'portfolio'
    : (thought as any)?.theme?.name ? 'theme'
    : undefined
  const contextEntityId = thought?.asset_id
    || (thought as any)?.portfolio_id
    || (thought as any)?.theme_id
    || undefined
  const responderFirstName = getPrimaryResponderFirstName(assigneeUser)
  const awaitingText = getAwaitingResponseText(responderFirstName)
  const statusCfg = STATUS_CONFIG[status]
  const StatusIcon = statusCfg.icon

  // --- Loading state ---
  if (isLoading || !thought) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header: type + status tags */}
      <div className="px-4 pt-3 pb-2 border-b border-gray-100 dark:border-gray-700">
        <div className="flex items-center gap-2">
          {/* Type tag */}
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">
            <MessageCircleQuestion className="h-3.5 w-3.5" />
            Prompt
          </span>

          {/* Status tag */}
          <span className={clsx(
            'inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded',
            statusCfg.bg, statusCfg.cls
          )}>
            <StatusIcon className="h-3 w-3" />
            {statusCfg.label}
          </span>

          {/* Response count — muted summary */}
          <span className="text-[10px] text-gray-400 dark:text-gray-500">
            {pluralizeResponseCount(responseCount)}
          </span>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Status action */}
          {status !== 'closed' ? (
            <button
              onClick={() => {
                setStatus('closed')
                success('Prompt resolved')
                // TODO: Persist status to DB
              }}
              className="text-[11px] text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors flex items-center gap-1"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Mark Resolved
            </button>
          ) : (
            <button
              onClick={() => {
                setStatus('open')
                // TODO: Persist status to DB
              }}
              className="text-[11px] text-gray-400 hover:text-violet-600 dark:hover:text-violet-400 transition-colors flex items-center gap-1"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reopen
            </button>
          )}
        </div>

        {/* Audience / visibility */}
        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
          Visible to: {thought.visibility === 'team' ? 'Team' : 'Assignees'}
        </p>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        {/* Metadata block */}
        <div className="px-4 py-3 space-y-1.5 border-b border-gray-50 dark:border-gray-800">
          {/* From */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-400 dark:text-gray-500 w-14 shrink-0">From:</span>
            <span className="text-gray-700 dark:text-gray-300 font-medium">{authorName}</span>
          </div>
          {/* To — shows assignee as primary responder */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-400 dark:text-gray-500 w-14 shrink-0">To:</span>
            <span className="text-gray-700 dark:text-gray-300 font-medium">
              {assigneeName
                ? <>{assigneeName} <span className="text-gray-400 dark:text-gray-500 font-normal">(primary responder)</span></>
                : '\u2014'}
            </span>
          </div>
          {/* Context — rendered as clickable chip */}
          {contextLabel && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-gray-400 dark:text-gray-500 w-14 shrink-0">Context:</span>
              <button
                onClick={() => {
                  // TODO: Navigate to entity page when deep-link routing is available
                  if (contextType === 'asset' && contextEntityId) {
                    window.dispatchEvent(new CustomEvent('navigateToAsset', {
                      detail: { assetId: contextEntityId, symbol: contextLabel }
                    }))
                  }
                }}
                className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700/60 text-gray-600 dark:text-gray-300 text-[11px] font-medium cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600/60 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
              >
                {contextLabel}
              </button>
            </div>
          )}
          {/* Created */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-400 dark:text-gray-500 w-14 shrink-0">Created:</span>
            <span className="text-gray-500 dark:text-gray-400">
              {formatRelativeTime(thought.created_at)} ago
            </span>
          </div>
        </div>

        {/* Title (if present) */}
        {title && (
          <div className="px-4 pt-3">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              {title}
            </h3>
          </div>
        )}

        {/* Prompt body */}
        <div className="px-4 py-3">
          {isEditing ? (
            <div className="space-y-2">
              <textarea
                value={editContent}
                onChange={e => setEditContent(e.target.value)}
                className="w-full h-20 px-2.5 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-violet-400 focus:border-transparent resize-none"
                autoFocus
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => updateMutation.mutate(editContent.trim())}
                  disabled={!editContent.trim() || updateMutation.isPending}
                  className="h-7 px-3 text-xs font-medium rounded-md bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50 transition-colors"
                >
                  {updateMutation.isPending ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => { setIsEditing(false); setEditContent(thought.content) }}
                  className="h-7 px-3 text-xs text-gray-500 hover:text-gray-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="group relative">
              <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-wrap">
                {thought.content}
              </p>
              {isCreator && (
                <button
                  onClick={() => setIsEditing(true)}
                  className="absolute top-0 right-0 p-1 rounded opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 transition-opacity"
                  title="Edit prompt"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Responses section — reuses IdeaComments with 'quick_thought' context */}
        <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700">
          <h4 className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">
            Responses
          </h4>
          <IdeaComments
            itemId={promptId}
            itemType="quick_thought"
            maxVisible={10}
            interactionMode="response"
            disabled={status === 'closed'}
            disabledMessage="This prompt is resolved."
            emptyStateOverride={awaitingText}
            onCountChange={handleCountChange}
          />
        </div>

        {/* Secondary actions */}
        <div className="px-4 py-3 border-t border-gray-50 dark:border-gray-800">
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors flex items-center gap-1"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
              More actions
            </button>

            {showMenu && (
              <div className="absolute bottom-full left-0 mb-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 z-10 min-w-[160px]">
                <button
                  disabled
                  title="Coming soon"
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-400 dark:text-gray-500 cursor-not-allowed text-left"
                >
                  <TrendingUp className="h-3.5 w-3.5" />
                  Convert to Trade Idea
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(window.location.href)
                    success('Link copied')
                    setShowMenu(false)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 text-left"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy link
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
