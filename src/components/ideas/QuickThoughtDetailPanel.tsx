import { useState, useEffect, useCallback } from 'react'
import { clsx } from 'clsx'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  EyeOff,
  Users,
  Globe,
  TrendingUp,
  TrendingDown,
  Minus,
  HelpCircle,
  AlertTriangle,
  Sparkles,
  Lightbulb,
  Link as LinkIcon,
  ArrowRight,
  Calendar,
  Edit2,
  Check,
  FileText,
  BookOpen,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useQuickThought } from '../../hooks/useQuickThoughtsFeed'
import { useToast } from '../common/Toast'
import { IdeaReactions } from './social/IdeaReactions'
import { BookmarkButton } from './social/BookmarkButton'
import { IdeaComments } from './social/IdeaComments'
import { PromoteToTradeIdeaModal } from './PromoteToTradeIdeaModal'
import type { Sentiment } from '../../hooks/ideas/types'

// ============================================================================
// QUICK THOUGHT DETAIL PANEL
// Right-side panel for viewing, editing, and acting on quick_thoughts
// Opens when a quick_thought card is clicked in the Ideas tab
// ============================================================================

/**
 * Compact relative timestamp: "2m", "3h", "6d", "2w", "Jan 5"
 */
function formatCompactTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSecs < 60) return 'now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays === 1) return '1d ago'
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface QuickThoughtDetailPanelProps {
  quickThoughtId: string | null
  onClose: () => void
  onPromoteSuccess?: (tradeIdeaId: string) => void
  onNavigateToTradeIdea?: (tradeIdeaId: string) => void
  /**
   * Embedded mode: removes fixed width and border for use inside CommunicationPane
   */
  embedded?: boolean
}

// Visibility configuration
const visibilityConfig = {
  private: { icon: EyeOff, label: 'Private', description: 'Only visible to you' },
  team: { icon: Users, label: 'Team', description: 'Visible to your team' },
  public: { icon: Globe, label: 'Public', description: 'Visible to everyone' },
} as const

// Sentiment/signal configuration
const sentimentConfig: Record<Sentiment, { icon: typeof TrendingUp; label: string; color: string; bg: string }> = {
  bullish: { icon: TrendingUp, label: 'Bullish', color: 'text-green-600', bg: 'bg-green-50' },
  bearish: { icon: TrendingDown, label: 'Bearish', color: 'text-red-600', bg: 'bg-red-50' },
  neutral: { icon: Minus, label: 'Neutral', color: 'text-gray-600', bg: 'bg-gray-100' },
  curious: { icon: HelpCircle, label: 'Curious', color: 'text-blue-600', bg: 'bg-blue-50' },
  concerned: { icon: AlertTriangle, label: 'Concerned', color: 'text-amber-600', bg: 'bg-amber-50' },
  excited: { icon: Sparkles, label: 'Excited', color: 'text-purple-600', bg: 'bg-purple-50' },
}

// Idea type configuration
type IdeaType = 'thought' | 'research_idea' | 'thesis'
const ideaTypeConfig: Record<IdeaType, { icon: typeof Lightbulb; label: string; color: string; bg: string }> = {
  thought: { icon: Lightbulb, label: 'Thought', color: 'text-amber-700', bg: 'bg-amber-50' },
  research_idea: { icon: FileText, label: 'Research', color: 'text-blue-600', bg: 'bg-blue-50' },
  thesis: { icon: BookOpen, label: 'Thesis', color: 'text-purple-600', bg: 'bg-purple-50' },
}

export function QuickThoughtDetailPanel({
  quickThoughtId,
  onClose,
  onPromoteSuccess,
  onNavigateToTradeIdea,
  embedded = false,
}: QuickThoughtDetailPanelProps) {
  const { user } = useAuth()
  const { success, error: showError } = useToast()
  const queryClient = useQueryClient()

  // Fetch quick thought data
  const { data: thought, isLoading } = useQuickThought(quickThoughtId)

  // Local edit state
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [editVisibility, setEditVisibility] = useState<'private' | 'team' | 'public'>('private')
  const [editSentiment, setEditSentiment] = useState<Sentiment | null>(null)
  const [editIdeaType, setEditIdeaType] = useState<IdeaType>('thought')

  // Promote modal state
  const [isPromoteModalOpen, setIsPromoteModalOpen] = useState(false)

  // Sync edit state when thought loads
  useEffect(() => {
    if (thought) {
      setEditContent(thought.content)
      setEditVisibility(thought.visibility)
      setEditSentiment(thought.sentiment || null)
      setEditIdeaType(thought.idea_type || 'thought')
    }
  }, [thought])

  // Check if current user is the creator
  const isCreator = user?.id === thought?.author.id

  // ============================================================================
  // UPDATE MUTATION
  // ============================================================================
  const updateMutation = useMutation({
    mutationFn: async (updates: { content?: string; visibility?: 'private' | 'team' | 'public'; sentiment?: Sentiment | null; idea_type?: IdeaType }) => {
      if (!quickThoughtId) throw new Error('No quick thought ID')

      const { error } = await supabase
        .from('quick_thoughts')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('id', quickThoughtId)

      if (error) throw error
    },
    onSuccess: () => {
      success('Quick thought updated')
      setIsEditing(false)
      queryClient.invalidateQueries({ queryKey: ['quick-thought', quickThoughtId] })
      queryClient.invalidateQueries({ queryKey: ['quick-thoughts-feed'] })
    },
    onError: (err: Error) => {
      showError('Failed to update', err.message)
    },
  })


  // ============================================================================
  // HANDLERS
  // ============================================================================
  const handleSaveEdit = useCallback(() => {
    const hasChanges =
      editContent.trim() !== thought?.content ||
      editVisibility !== thought?.visibility ||
      editSentiment !== thought?.sentiment ||
      editIdeaType !== (thought?.idea_type || 'thought')

    if (hasChanges) {
      updateMutation.mutate({
        content: editContent.trim(),
        visibility: editVisibility,
        sentiment: editSentiment,
        idea_type: editIdeaType,
      })
    } else {
      setIsEditing(false)
    }
  }, [editContent, editVisibility, editSentiment, editIdeaType, thought, updateMutation])

  const handleCancelEdit = useCallback(() => {
    setEditContent(thought?.content || '')
    setEditVisibility(thought?.visibility || 'private')
    setEditSentiment(thought?.sentiment || null)
    setEditIdeaType(thought?.idea_type || 'thought')
    setIsEditing(false)
  }, [thought])

  const handlePromote = useCallback(() => {
    if (thought?.promoted_to_trade_idea_id) {
      // Already promoted, navigate to it
      onNavigateToTradeIdea?.(thought.promoted_to_trade_idea_id)
    } else {
      // Open promote modal
      setIsPromoteModalOpen(true)
    }
  }, [thought, onNavigateToTradeIdea])

  const handlePromoteSuccess = useCallback((tradeIdeaId: string) => {
    setIsPromoteModalOpen(false)
    onPromoteSuccess?.(tradeIdeaId)
  }, [onPromoteSuccess])

  // Enter edit mode handler
  const handleEnterEditMode = useCallback(() => {
    if (!isCreator) return
    setEditContent(thought?.content || '')
    setEditVisibility(thought?.visibility || 'private')
    setEditSentiment(thought?.sentiment || null)
    setEditIdeaType(thought?.idea_type || 'thought')
    setIsEditing(true)
  }, [isCreator, thought])

  // Handle keyboard shortcuts
  // ESC: exit edit mode (revert) or close panel
  // Cmd/Ctrl+Enter: save while editing
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isEditing) {
          handleCancelEdit()
        } else {
          onClose()
        }
      }
      // Cmd/Ctrl+Enter to save while editing
      if (isEditing && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleSaveEdit()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isEditing, handleCancelEdit, handleSaveEdit, onClose])

  // Don't render if no ID
  if (!quickThoughtId) return null

  // Container classes based on embedded mode
  const containerClasses = embedded
    ? 'h-full bg-white flex flex-col'
    : 'w-96 h-full bg-white border-l border-gray-200 flex flex-col'

  // Loading state
  if (isLoading) {
    return (
      <div className={clsx(containerClasses, 'items-center justify-center')}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    )
  }

  // Not found state
  if (!thought) {
    return (
      <div className={containerClasses}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Quick Thought</h3>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-gray-500 text-center">Quick thought not found</p>
        </div>
      </div>
    )
  }

  const SentimentIcon = thought.sentiment ? sentimentConfig[thought.sentiment].icon : Lightbulb
  const sentimentStyle = thought.sentiment ? sentimentConfig[thought.sentiment] : null
  const VisibilityIcon = visibilityConfig[thought.visibility].icon
  const isPromoted = !!thought.promoted_to_trade_idea_id

  return (
    <div className={clsx(containerClasses, 'overflow-hidden')}>
      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Unified Metadata Row - combines type indicator, sentiment, visibility, timestamp */}
        <div className="px-4 pt-3 pb-2">
          {/* Primary metadata line: Signal · Visibility · Type */}
          <div className="flex items-center gap-1.5 text-[11px] text-gray-500 flex-wrap">
            {/* Sentiment with icon */}
            {sentimentStyle ? (
              <span className={clsx('inline-flex items-center gap-0.5', sentimentStyle.color)}>
                <SentimentIcon className="h-3 w-3" />
                <span className="font-medium">{sentimentStyle.label}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5 text-gray-400">
                <Lightbulb className="h-3 w-3" />
                <span>Thought</span>
              </span>
            )}
            <span className="text-gray-300">·</span>

            {/* Visibility */}
            <span className="inline-flex items-center gap-0.5">
              <VisibilityIcon className="h-3 w-3" />
              <span>{visibilityConfig[thought.visibility].label}</span>
            </span>

            {/* Type label (muted) */}
            <span className="text-gray-300">·</span>
            {(() => {
              const typeKey = (thought.idea_type || 'thought') as IdeaType
              const typeConfig = ideaTypeConfig[typeKey]
              const TypeIcon = typeConfig.icon
              return (
                <span className={clsx('inline-flex items-center gap-0.5', typeConfig.color)}>
                  <TypeIcon className="h-3 w-3" />
                  <span>{typeConfig.label}</span>
                </span>
              )
            })()}

            {/* Revisit indicator */}
            {thought.revisit_date && new Date(thought.revisit_date) <= new Date() && (
              <>
                <span className="text-gray-300">·</span>
                <span className="inline-flex items-center gap-0.5 text-amber-600">
                  <Calendar className="h-3 w-3" />
                  <span>Revisit</span>
                </span>
              </>
            )}

            {/* Promoted indicator */}
            {isPromoted && (
              <>
                <span className="text-gray-300">·</span>
                <button
                  onClick={() => onNavigateToTradeIdea?.(thought.promoted_to_trade_idea_id!)}
                  className="inline-flex items-center gap-0.5 text-green-600 hover:text-green-700"
                >
                  <TrendingUp className="h-3 w-3" />
                  <span>Promoted</span>
                </button>
              </>
            )}
          </div>

          {/* Secondary metadata line: Author · Timestamp */}
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-xs text-gray-500">
              {thought.author.full_name || thought.author.email?.split('@')[0] || 'Unknown'}
            </span>
            <span className="text-gray-300 text-[10px]">·</span>
            <span className="text-[10px] text-gray-400">
              {formatCompactTime(thought.created_at)}
            </span>
            {/* Show edited indicator if updated */}
            {thought.updated_at && thought.updated_at !== thought.created_at && (
              <>
                <span className="text-gray-300 text-[10px]">·</span>
                <span className="text-[10px] text-gray-400 italic">edited</span>
              </>
            )}
          </div>
        </div>

        {/* Context Links - tighter spacing */}
        {(thought.asset || thought.portfolio || thought.theme) && (
          <div className="px-4 pb-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              <LinkIcon className="h-3 w-3 text-gray-400" />
              {thought.asset && (
                <span className="inline-flex items-center px-1.5 py-0.5 text-[11px] font-semibold text-primary-700 bg-primary-50 rounded">
                  ${thought.asset.symbol}
                </span>
              )}
              {thought.portfolio && (
                <span className="inline-flex items-center px-1.5 py-0.5 text-[11px] font-medium text-gray-600 bg-gray-100 rounded">
                  {thought.portfolio.name}
                </span>
              )}
              {thought.theme && (
                <span className="inline-flex items-center px-1.5 py-0.5 text-[11px] font-medium text-purple-600 bg-purple-50 rounded">
                  {thought.theme.name}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Content Section */}
        <div className="px-4 py-3 border-t border-gray-100">
          {isEditing ? (
            /* ============================================================
               EDIT MODE
               - Textarea with subtle border (no heavy focus ring on load)
               - Visibility selector (muted, metadata-like)
               - Save/Cancel inline, compact, near content
               ============================================================ */
            <div className="space-y-2">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full min-h-[100px] p-2.5 border border-gray-200 rounded-lg text-sm text-gray-800 focus:outline-none focus:border-gray-300 focus:ring-1 focus:ring-gray-200 resize-y"
                autoFocus
                placeholder="What's on your mind?"
              />

              {/* Idea type selector - muted metadata style */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] text-gray-400">Type:</span>
                {(Object.keys(ideaTypeConfig) as IdeaType[]).map((t) => {
                  const config = ideaTypeConfig[t]
                  const TIcon = config.icon
                  const isSelected = editIdeaType === t
                  return (
                    <button
                      key={t}
                      onClick={() => setEditIdeaType(t)}
                      className={clsx(
                        'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] transition-colors',
                        isSelected
                          ? `${config.bg} ${config.color}`
                          : 'text-gray-500 hover:bg-gray-100'
                      )}
                    >
                      <TIcon className="h-3 w-3" />
                      {config.label}
                    </button>
                  )
                })}
              </div>

              {/* Sentiment selector - muted metadata style */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] text-gray-400">Signal:</span>
                {(Object.keys(sentimentConfig) as Sentiment[]).map((s) => {
                  const config = sentimentConfig[s]
                  const SIcon = config.icon
                  const isSelected = editSentiment === s
                  return (
                    <button
                      key={s}
                      onClick={() => setEditSentiment(isSelected ? null : s)}
                      className={clsx(
                        'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] transition-colors',
                        isSelected
                          ? `${config.bg} ${config.color}`
                          : 'text-gray-500 hover:bg-gray-100'
                      )}
                    >
                      <SIcon className="h-3 w-3" />
                      {config.label}
                    </button>
                  )
                })}
              </div>

              {/* Visibility selector - muted metadata style */}
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-gray-400">Visibility:</span>
                {(['private', 'team', 'public'] as const).map((v) => {
                  const VIcon = visibilityConfig[v].icon
                  return (
                    <button
                      key={v}
                      onClick={() => setEditVisibility(v)}
                      className={clsx(
                        'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] transition-colors',
                        editVisibility === v
                          ? 'bg-gray-200 text-gray-700'
                          : 'text-gray-500 hover:bg-gray-100'
                      )}
                    >
                      <VIcon className="h-3 w-3" />
                      {visibilityConfig[v].label}
                    </button>
                  )
                })}
              </div>

              {/* Edit actions - compact, near content, not competing with Promote */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleSaveEdit}
                  disabled={updateMutation.isPending}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-gray-700 rounded hover:bg-gray-800 disabled:opacity-50"
                >
                  <Check className="h-3 w-3" />
                  {updateMutation.isPending ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={handleCancelEdit}
                  className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
                >
                  Cancel
                </button>
                <span className="text-[10px] text-gray-400 ml-auto">
                  {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+'}Enter to save
                </span>
              </div>
            </div>
          ) : (
            /* ============================================================
               READ-ONLY MODE (DEFAULT)
               - Plain text content, no textarea
               - Edit button visible for creator (always visible, not hover)
               - Calm, inspector-like feel
               ============================================================ */
            <div>
              {/* Content header with edit affordance */}
              {isCreator && (
                <div className="flex items-center justify-end mb-1">
                  <button
                    onClick={handleEnterEditMode}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                  >
                    <Edit2 className="h-3 w-3" />
                    Edit
                  </button>
                </div>
              )}
              {/* Content as plain text */}
              <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                {thought.content}
              </p>
            </div>
          )}
        </div>

        {/* Social Section - only show for non-private or if creator */}
        {/* Tighter spacing: py-2 instead of py-3, space-y-3 instead of space-y-4 */}
        {(thought.visibility !== 'private' || isCreator) && (
          <div className="px-4 py-2 border-t border-gray-100 space-y-3">
            {/* Reactions + Bookmark - action row */}
            <div className="flex items-center justify-between">
              <IdeaReactions
                itemId={thought.id}
                itemType="quick_thought"
                variant="compact"
              />
              <BookmarkButton
                itemId={thought.id}
                itemType="quick_thought"
                variant="compact"
              />
            </div>

            {/* Comments */}
            <IdeaComments
              itemId={thought.id}
              itemType="quick_thought"
              maxVisible={5}
            />
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="px-4 py-3 border-t border-gray-200 flex-shrink-0">
        {isPromoted ? (
          <button
            onClick={() => onNavigateToTradeIdea?.(thought.promoted_to_trade_idea_id!)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-green-700 bg-green-50 rounded-lg hover:bg-green-100 transition-colors"
          >
            <TrendingUp className="h-4 w-4" />
            View Trade Idea
            <ArrowRight className="h-4 w-4" />
          </button>
        ) : (
          <button
            onClick={handlePromote}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-green-500 to-emerald-600 rounded-lg hover:from-green-600 hover:to-emerald-700 transition-all"
          >
            <TrendingUp className="h-4 w-4" />
            Promote to Trade Idea
          </button>
        )}
      </div>

      {/* Promote Modal */}
      {thought && (
        <PromoteToTradeIdeaModal
          isOpen={isPromoteModalOpen}
          onClose={() => setIsPromoteModalOpen(false)}
          onSuccess={handlePromoteSuccess}
          quickThoughtId={thought.id}
          quickThoughtContent={thought.content}
          assetId={thought.asset?.id}
          assetSymbol={thought.asset?.symbol}
          portfolioId={thought.portfolio?.id}
          portfolioName={thought.portfolio?.name}
          visibility={thought.visibility}
        />
      )}
    </div>
  )
}
