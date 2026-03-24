import { useState, useCallback, useEffect } from 'react'
import { TrendingUp, Lightbulb, ArrowLeft, HelpCircle, FileText, MessageCircleQuestion, CheckCircle2, Clock, ChevronRight } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'
import { QuickThoughtCapture } from '../thoughts/QuickThoughtCapture'
import { QuickTradeIdeaCapture } from '../thoughts/QuickTradeIdeaCapture'
import { RecentQuickIdeas } from '../thoughts/RecentQuickIdeas'
import { QuickThoughtDetailPanel } from '../ideas/QuickThoughtDetailPanel'
import { PromptDetailView } from '../thoughts/PromptDetailView'
import { PromptModal } from '../thoughts/PromptModal'
import { RecommendationQuickModal } from '../thoughts/RecommendationQuickModal'
import { useRecentQuickIdeas } from '../../hooks/useRecentQuickIdeas'
import { useDirectCounts } from '../../hooks/useDirectCounts'
import { useToast } from '../common/Toast'
import { buildQuickThoughtsFilters } from '../../hooks/useIdeasRouting'
import type { CapturedContext } from '../thoughts/ContextSelector'
import { useSidebarStore } from '../../stores/sidebarStore'
import { usePendingResearchLinksStore } from '../../stores/pendingResearchLinksStore'
import type { SidebarMode, SelectedItem, InspectableItemType } from '../../stores/sidebarStore'

interface ThoughtsSectionProps {
  onClose?: () => void
  // Auto-detected context from current location
  initialContextType?: string
  initialContextId?: string
  initialContextTitle?: string
  // Callbacks for recent ideas
  onViewAllIdeas?: () => void
  // Sidebar store state and actions
  sidebarMode?: SidebarMode
  selectedItem?: SelectedItem | null
  onBackToCapture?: () => void
  onOpenInspector?: (type: InspectableItemType, id: string) => void
}

type CaptureMode = 'collapsed' | 'idea' | 'trade_idea' | 'prompt' | 'proposal'
type IdeaType = 'thought' | 'research_idea' | 'thesis'

export function ThoughtsSection({
  onClose,
  initialContextType,
  initialContextId,
  initialContextTitle,
  onViewAllIdeas,
  sidebarMode = 'capture',
  selectedItem,
  onBackToCapture,
  onOpenInspector,
}: ThoughtsSectionProps) {
  const [captureMode, setCaptureMode] = useState<CaptureMode>('collapsed')
  const [currentIdeaType, setCurrentIdeaType] = useState<IdeaType>('thought')
  const [showPromptList, setShowPromptList] = useState(false)
  const { success } = useToast()
  const { openPromptCount, pendingRecommendationCount } = useDirectCounts()

  // Fetch recent quick ideas for the sidebar (max 5, personal only, no trade ideas)
  const { data: recentIdeas = [], invalidate: invalidateRecentIdeas, hasMore } = useRecentQuickIdeas(5)

  // Captured context - locked when opening capture mode
  const [capturedContext, setCapturedContext] = useState<CapturedContext | null>(null)

  // Auto-select capture mode from pending store value (one-shot)
  const pendingCaptureType = useSidebarStore(s => s.pendingCaptureType)
  const clearPendingCaptureType = useSidebarStore(s => s.clearPendingCaptureType)

  useEffect(() => {
    if (pendingCaptureType && sidebarMode === 'capture') {
      handleOpenCapture(pendingCaptureType)
      clearPendingCaptureType()
    }
  }, [pendingCaptureType, sidebarMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // When opening capture mode, capture the current context
  const handleOpenCapture = (mode: 'idea' | 'trade_idea' | 'prompt' | 'proposal') => {
    // Capture context at the moment of opening
    if (initialContextType && initialContextId) {
      setCapturedContext({
        type: initialContextType,
        id: initialContextId,
        title: initialContextTitle
      })
    } else {
      setCapturedContext(null)
    }
    setCaptureMode(mode)
  }

  // Get toast message based on idea type
  const getToastMessage = (ideaType: IdeaType): { message: string; description?: string } => {
    switch (ideaType) {
      case 'thesis':
        return { message: 'Thesis captured.' }
      case 'research_idea':
        return { message: 'Research note saved.' }
      default:
        return { message: 'Thought captured.' }
    }
  }

  // Clear context when capture is cancelled or completed
  const handleCaptureSuccess = (ideaType?: IdeaType) => {
    const toastInfo = getToastMessage(ideaType || currentIdeaType)
    success(toastInfo.message, toastInfo.description)

    setCaptureMode('collapsed')
    setCapturedContext(null)

    // Refresh recent ideas list
    invalidateRecentIdeas()

    // Close the pane after a brief delay to let the user see the button state change
    setTimeout(() => {
      onClose?.()
    }, 100)
  }

  const handleTradeIdeaSuccess = (tradeIdeaId?: string) => {
    success('Trade idea added.', {
      description: 'Decision queued in Priorities.',
      action: tradeIdeaId ? {
        label: 'View in Queue',
        onClick: () => {
          window.dispatchEvent(new CustomEvent('openTradeQueue', {
            detail: { selectedTradeId: tradeIdeaId }
          }))
        }
      } : undefined
    })

    setCaptureMode('collapsed')
    setCapturedContext(null)

    // Refresh recent ideas list
    invalidateRecentIdeas()

    // Close the pane after a brief delay
    setTimeout(() => {
      onClose?.()
    }, 100)
  }

  const handleCaptureCancel = () => {
    setCaptureMode('collapsed')
    setCapturedContext(null)
    usePendingResearchLinksStore.getState().clear()
  }

  // Allow user to change context
  const handleContextChange = (newContext: CapturedContext | null) => {
    setCapturedContext(newContext)
  }

  // Track idea type changes from the capture form
  const handleIdeaTypeChange = (ideaType: IdeaType) => {
    setCurrentIdeaType(ideaType)
  }

  // Handle opening a recent idea - opens in inspect mode within the same sidebar
  const handleOpenIdea = useCallback((id: string, kind?: string) => {
    if (onOpenInspector) {
      // Route prompts to their own detail view
      const inspectType = kind === 'prompt' ? 'prompt' as const : 'quick_thought' as const
      onOpenInspector(inspectType, id)
    }
  }, [onOpenInspector])

  // Handle viewing all ideas - opens Ideas tab without pre-filtering
  const handleViewAllIdeas = useCallback(() => {
    if (onViewAllIdeas) {
      // Custom handler provided
      onViewAllIdeas()
    } else {
      // Open Ideas tab unfiltered so the user sees everything, not just recent
      window.dispatchEvent(new CustomEvent('openIdeasTab', {
        detail: {}
      }))

      // Close the sidebar
      onClose?.()
    }
  }, [onViewAllIdeas, onClose])

  // ESC key handler - in inspect mode, go back to capture
  useEffect(() => {
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && sidebarMode === 'inspect' && onBackToCapture) {
        onBackToCapture()
      }
    }

    document.addEventListener('keydown', handleEscKey)
    return () => document.removeEventListener('keydown', handleEscKey)
  }, [sidebarMode, onBackToCapture])

  // If in inspect mode with a selected item, show the detail view
  if (sidebarMode === 'inspect' && selectedItem) {
    return (
      <div className="flex flex-col h-full">
        {/* Back button header */}
        <div className="px-3 py-2 border-b border-gray-100">
          <button
            onClick={onBackToCapture}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to Quick Ideas</span>
          </button>
        </div>

        {/* Detail panel - render based on item type */}
        <div className="flex-1 overflow-hidden">
          {selectedItem.type === 'quick_thought' && (
            <QuickThoughtDetailPanel
              quickThoughtId={selectedItem.id}
              onClose={onBackToCapture}
              onNavigateToTradeIdea={(tradeIdeaId) => {
                // TODO: Navigate to trade idea
                console.log('Navigate to trade idea:', tradeIdeaId)
              }}
              embedded // Use embedded mode (no fixed positioning)
            />
          )}
          {selectedItem.type === 'prompt' && (
            <PromptDetailView
              promptId={selectedItem.id}
              onClose={onBackToCapture}
            />
          )}
          {selectedItem.type !== 'quick_thought' && selectedItem.type !== 'prompt' && (
            <div className="p-4 text-center text-gray-500">
              <p>Detail view for {selectedItem.type} coming soon</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Open Prompts list view ──
  if (showPromptList) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700">
          <button
            onClick={() => setShowPromptList(false)}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to Quick Ideas</span>
          </button>
        </div>
        <div className="px-3 py-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Open Prompts</h3>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-3">
          <OpenPromptList
            onSelectPrompt={(id) => {
              setShowPromptList(false)
              if (onOpenInspector) {
                onOpenInspector('prompt', id)
              }
            }}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Back button header - show when in capture mode (not collapsed) */}
      {captureMode !== 'collapsed' && (
        <div className="px-3 py-2 border-b border-gray-100">
          <button
            onClick={handleCaptureCancel}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back</span>
          </button>
        </div>
      )}

      {/* Purpose statement - only show when no mode selected */}
      {captureMode === 'collapsed' && (
        <div className="px-3 pt-1 pb-2">
          <p className="text-xs text-gray-400">
            Capture ideas the moment they occur.
          </p>
        </div>
      )}

      {/* Capture Section */}
      <div className="flex-1 px-3 pb-3 overflow-y-auto">
        {/* Mode selector — four actions in two groups */}
        {captureMode === 'collapsed' && (
          <>
            {/* CAPTURE group */}
            <div className="mb-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Capture
              </span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleOpenCapture('idea')}
                className="flex-1 flex items-center justify-center space-x-2 px-3 py-2.5 bg-gradient-to-r from-indigo-500 to-blue-600 text-white text-sm font-medium rounded-lg hover:from-indigo-600 hover:to-blue-700 transition-all shadow-sm"
              >
                <Lightbulb className="h-4 w-4" />
                <span>Thought</span>
              </button>
              <button
                onClick={() => handleOpenCapture('trade_idea')}
                className="flex-1 flex items-center justify-center space-x-2 px-3 py-2.5 bg-gradient-to-r from-green-500 to-emerald-600 text-white text-sm font-medium rounded-lg hover:from-green-600 hover:to-emerald-700 transition-all shadow-sm"
              >
                <TrendingUp className="h-4 w-4" />
                <span>Trade Idea</span>
              </button>
            </div>

            {/* Divider */}
            <div className="my-3 border-t border-gray-100 dark:border-gray-700" />

            {/* DIRECT group */}
            <div className="mb-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Direct
              </span>
            </div>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-1.5 leading-tight">
              Request insight or formalize a recommendation.
            </p>
            <div className="flex gap-2">
              {/* Prompt column */}
              <div className="flex-1">
                <button
                  onClick={() => handleOpenCapture('prompt')}
                  title="Ask someone for input on the current context (assigned + tracked)"
                  className="w-full flex items-center justify-center space-x-2 px-3 py-2.5 border border-violet-300 dark:border-violet-600 text-violet-700 dark:text-violet-300 text-sm font-medium rounded-lg hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-all"
                >
                  <HelpCircle className="h-4 w-4" />
                  <span>Prompt</span>
                </button>
                {openPromptCount > 0 && (
                  <button
                    onClick={() => setShowPromptList(true)}
                    className="mt-1 text-[11px] text-gray-400 dark:text-gray-500 cursor-pointer hover:text-violet-600 dark:hover:text-violet-400 hover:underline transition-colors"
                  >
                    <span className="font-semibold text-gray-600 dark:text-gray-300">{openPromptCount}</span> open prompts
                  </button>
                )}
              </div>

              {/* Proposal column */}
              <div className="flex-1">
                <button
                  onClick={() => handleOpenCapture('proposal')}
                  title="Create a formal recommendation from a trade idea"
                  className="w-full flex items-center justify-center space-x-2 px-3 py-2.5 border-2 border-amber-300 dark:border-amber-500 text-amber-700 dark:text-amber-300 text-sm font-medium rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/30 transition-all"
                >
                  <FileText className="h-4 w-4" />
                  <span>Recommend</span>
                </button>
                <button
                  onClick={() => {
                    // TODO: Navigate to proposals list when dedicated view exists
                    window.dispatchEvent(new CustomEvent('openTradeQueue', { detail: {} }))
                    onClose?.()
                  }}
                  className="mt-1 text-[11px] text-gray-400 dark:text-gray-500 cursor-pointer hover:text-amber-600 dark:hover:text-amber-400 hover:underline transition-colors"
                >
                  <span className="font-semibold text-gray-600 dark:text-gray-300">{pendingRecommendationCount}</span> pending review
                </button>
              </div>
            </div>

            {/* Divider — closes the DIRECT group before RECENT */}
            <div className="my-3 border-t border-gray-100 dark:border-gray-700" />

            {/* Recent Quick Ideas (personal only, no trade ideas) */}
            <RecentQuickIdeas
              items={recentIdeas}
              onOpen={handleOpenIdea}
              onViewAll={handleViewAllIdeas}
              hasMore={hasMore}
            />

          </>
        )}

        {/* Capture form for quick ideas (Thought / Research / Thesis) */}
        {captureMode === 'idea' && (
          <div className="pt-3">
            {/* Mode-specific guidance */}
            <p className="mb-3 text-xs text-gray-400">
              Jot down an observation, question, or thesis — no structure required.
            </p>

            <QuickThoughtCapture
              compact={true}
              autoFocus={true}
              placeholder="Capture a quick thought..."
              onSuccess={handleCaptureSuccess}
              onCancel={handleCaptureCancel}
              capturedContext={capturedContext}
              onContextChange={handleContextChange}
              onIdeaTypeChange={handleIdeaTypeChange}
            />
          </div>
        )}

        {/* Capture form for trade ideas */}
        {captureMode === 'trade_idea' && (
          <div className="pt-3">
            {/* Mode-specific guidance */}
            <p className="mb-3 text-xs text-gray-400">
              Capture a potential trade to review or decide on later.
            </p>

            <QuickTradeIdeaCapture
              compact={true}
              autoFocus={true}
              onSuccess={handleTradeIdeaSuccess}
              onCancel={handleCaptureCancel}
              // Provenance is now auto-captured from location.pathname
              // Pass context as provenance props if available
              assetId={initialContextType === 'asset' ? initialContextId : undefined}
              portfolioId={initialContextType === 'portfolio' ? initialContextId : undefined}
            />
          </div>
        )}

        {/* Inline prompt form */}
        {captureMode === 'prompt' && (
          <div className="pt-3">
            <p className="mb-3 text-xs text-gray-400">
              Assign a question to a team member and choose who can see it.
            </p>

            <PromptModal
              isOpen={true}
              embedded
              onClose={() => {
                handleCaptureCancel()
                // Close pane after send
                setTimeout(() => onClose?.(), 100)
              }}
              context={capturedContext}
            />
          </div>
        )}

        {/* Inline proposal form */}
        {captureMode === 'proposal' && (
          <div className="pt-3">
            <p className="mb-3 text-xs text-gray-400">
              Select a trade idea to submit a recommendation.
            </p>

            <RecommendationQuickModal
              isOpen={true}
              embedded
              onClose={() => {
                handleCaptureCancel()
                setTimeout(() => onClose?.(), 100)
              }}
              context={capturedContext}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Inline Open Prompts List ──────────────────────────────────────────────

function OpenPromptList({ onSelectPrompt }: { onSelectPrompt: (id: string) => void }) {
  const { user } = useAuth()

  const { data: prompts = [], isLoading } = useQuery({
    queryKey: ['open-prompts-list', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quick_thoughts')
        .select('id, content, tags, created_at, created_by')
        .eq('created_by', user!.id)
        .eq('idea_type', 'prompt')
        .order('created_at', { ascending: false })
        .limit(20)

      if (error) throw error
      return data || []
    },
    enabled: !!user?.id,
    staleTime: 30_000,
  })

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-14 bg-gray-100 dark:bg-gray-700/50 rounded-lg animate-pulse" />
        ))}
      </div>
    )
  }

  if (prompts.length === 0) {
    return (
      <div className="text-center py-8">
        <MessageCircleQuestion className="h-8 w-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
        <p className="text-sm text-gray-500 dark:text-gray-400">No open prompts</p>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      {prompts.map(prompt => {
        // Extract assignee name from tags
        const assigneeTag = prompt.tags?.find((t: string) => t.startsWith('assignee_name:'))
        const assigneeName = assigneeTag ? assigneeTag.replace('assignee_name:', '') : null
        // Extract context from tags
        const ctxTag = prompt.tags?.find((t: string) => t.startsWith('ctx:'))
        const ctxTitle = ctxTag ? ctxTag.replace(/^ctx:[^:]+:[^:]+:/, '') : null
        const timeAgo = formatDistanceToNow(new Date(prompt.created_at), { addSuffix: true })

        return (
          <button
            key={prompt.id}
            onClick={() => onSelectPrompt(prompt.id)}
            className="w-full text-left px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-violet-300 dark:hover:border-violet-600 hover:bg-violet-50/50 dark:hover:bg-violet-900/10 transition-colors group"
          >
            <div className="flex items-start gap-2">
              <MessageCircleQuestion className="h-3.5 w-3.5 text-violet-500 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-900 dark:text-white line-clamp-2 leading-snug">
                  {prompt.content || 'Untitled prompt'}
                </p>
                <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-400 dark:text-gray-500">
                  {assigneeName && (
                    <>
                      <span>To: <span className="font-medium text-gray-500 dark:text-gray-400">{assigneeName}</span></span>
                      <span>·</span>
                    </>
                  )}
                  {ctxTitle && (
                    <>
                      <span className="truncate max-w-[100px]">{ctxTitle}</span>
                      <span>·</span>
                    </>
                  )}
                  <span>{timeAgo}</span>
                </div>
              </div>
              <ChevronRight className="h-3.5 w-3.5 text-gray-300 dark:text-gray-600 group-hover:text-violet-400 shrink-0 mt-0.5" />
            </div>
          </button>
        )
      })}
    </div>
  )
}
