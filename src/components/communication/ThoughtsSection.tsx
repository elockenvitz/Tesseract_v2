import { useState, useCallback, useEffect } from 'react'
import { TrendingUp, Lightbulb, ArrowLeft, HelpCircle, FileText, MessageCircleQuestion, CheckCircle2, Clock, ChevronRight, Scale, Briefcase, ArrowUpRight, Check, X as XIcon, MessageCircle, Loader2, Sparkles } from 'lucide-react'
import { usePilotMode } from '../../hooks/usePilotMode'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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
import { useUpdateDecisionRequest, useAcceptFromInbox } from '../../hooks/useDecisionRequests'
import { useToast } from '../common/Toast'
import { buildQuickThoughtsFilters } from '../../hooks/useIdeasRouting'
import type { CapturedContext } from '../thoughts/ContextSelector'
import { useOrganization } from '../../contexts/OrganizationContext'
import { useSidebarStore } from '../../stores/sidebarStore'
import { usePendingResearchLinksStore } from '../../stores/pendingResearchLinksStore'
import type { SidebarMode, SelectedItem, InspectableItemType } from '../../stores/sidebarStore'
import { type RequestType, REQUEST_TYPE_META } from '../ui/checklist/types'

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
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const pilotMode = usePilotMode()
  const { currentOrgId } = useOrganization()
  const [captureMode, setCaptureMode] = useState<CaptureMode>('collapsed')
  // Pilot Get Started banner — visible until the pilot has captured
  // their first trade idea OR explicitly dismisses it. Keyed per
  // user+org so an analyst running multiple pilot clients sees a
  // fresh banner for each new client (otherwise dismissing once in
  // pilot org A would silently hide it in pilot org B too).
  const pilotCaptureBannerKey = `pilot_capture_banner_dismissed_${user?.id || 'anon'}_${currentOrgId || 'no-org'}`
  const [pilotBannerDismissed, setPilotBannerDismissed] = useState<boolean>(() => {
    try {
      return user?.id && currentOrgId ? localStorage.getItem(pilotCaptureBannerKey) === '1' : false
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      setPilotBannerDismissed(
        user?.id && currentOrgId
          ? localStorage.getItem(pilotCaptureBannerKey) === '1'
          : false
      )
    } catch { /* ignore */ }
  }, [user?.id, currentOrgId, pilotCaptureBannerKey])
  const dismissPilotCaptureBanner = useCallback(() => {
    try { localStorage.setItem(pilotCaptureBannerKey, '1') } catch { /* ignore */ }
    setPilotBannerDismissed(true)
  }, [pilotCaptureBannerKey])
  // Per-step completion for the Quick Capture Get Started banner.
  // Same pattern as the Idea Pipeline + Trade Lab banners — each
  // step ticks off as the user does the corresponding action and
  // the banner auto-retires once all three are done. Keyed per
  // user+org so each pilot client tracks independently.
  const captureStepKey = (n: 1 | 2 | 3) =>
    `pilot_capture_step${n}_${user?.id || 'anon'}_${currentOrgId || 'no-org'}`
  const readCaptureStep = (n: 1 | 2 | 3) => {
    try { return localStorage.getItem(captureStepKey(n)) === '1' } catch { return false }
  }
  const writeCaptureStep = (n: 1 | 2 | 3) => {
    try { localStorage.setItem(captureStepKey(n), '1') } catch { /* ignore */ }
  }
  const [captureStep1Done, setCaptureStep1Done] = useState(() => readCaptureStep(1))
  const [captureStep2Done, setCaptureStep2Done] = useState(() => readCaptureStep(2))
  const [captureStep3Done, setCaptureStep3Done] = useState(() => readCaptureStep(3))
  // Reload from localStorage when user/org changes.
  useEffect(() => {
    setCaptureStep1Done(readCaptureStep(1))
    setCaptureStep2Done(readCaptureStep(2))
    setCaptureStep3Done(readCaptureStep(3))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, currentOrgId])
  // Listen for the three step events. Dispatched from
  // QuickTradeIdeaCapture as the user fills the form, plus from
  // handleTradeIdeaSuccess for the submit step. Listener bodies are
  // queueMicrotask-deferred so a render-time event dispatcher can't
  // trigger setState in this component during another component's
  // render.
  useEffect(() => {
    const defer = (fn: () => void) => () => queueMicrotask(fn)
    const onStep1 = defer(() => { writeCaptureStep(1); setCaptureStep1Done(true) })
    const onStep2 = defer(() => { writeCaptureStep(2); setCaptureStep2Done(true) })
    const onStep3 = defer(() => { writeCaptureStep(3); setCaptureStep3Done(true) })
    window.addEventListener('pilot-capture:ticker-picked', onStep1)
    window.addEventListener('pilot-capture:thesis-portfolio-set', onStep2)
    window.addEventListener('pilot-capture:submitted', onStep3)
    return () => {
      window.removeEventListener('pilot-capture:ticker-picked', onStep1)
      window.removeEventListener('pilot-capture:thesis-portfolio-set', onStep2)
      window.removeEventListener('pilot-capture:submitted', onStep3)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, currentOrgId])
  // Banner only fires inside the Add Trade Idea form — the pilot UX
  // hint is "here's how to fill this thing out", not a generic intro
  // for the whole Quick Ideas surface. Hidden on the main capture
  // mode picker so the right rail doesn't open with a wall of copy.
  const showPilotCaptureBanner = pilotMode.effectiveIsPilot && !pilotBannerDismissed && captureMode === 'trade_idea'
  const [currentIdeaType, setCurrentIdeaType] = useState<IdeaType>('thought')
  const [showPromptList, setShowPromptList] = useState(false)
  const [showPendingReview, setShowPendingReview] = useState(false)
  const { success } = useToast()
  const { openPromptCount, pendingRecommendationCount } = useDirectCounts()

  // Count active trade ideas in pipeline (not committed/rejected/deleted)
  const { data: pipelineCount = 0 } = useQuery({
    queryKey: ['pipeline-active-count', user?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('trade_queue_items')
        .select('id', { count: 'exact', head: true })
        .eq('created_by', user!.id)
        .not('status', 'in', '("approved","rejected","executed","deleted")')
      if (error) return 0
      return count ?? 0
    },
    enabled: !!user?.id,
    staleTime: 60_000,
  })

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
        label: 'View in Pipeline',
        onClick: () => {
          window.dispatchEvent(new CustomEvent('openTradeQueue', {
            detail: { selectedTradeId: tradeIdeaId }
          }))
        }
      } : undefined
    })

    // Pilot users see a Get Started banner above the capture
    // surface; first successful trade-idea submission retires it
    // permanently so it doesn't keep nagging. Also tick step 3
    // (the submit step) so the visible checkmarks complete on the
    // way out.
    if (pilotMode.effectiveIsPilot) {
      try { window.dispatchEvent(new CustomEvent('pilot-capture:submitted')) } catch { /* ignore */ }
      dismissPilotCaptureBanner()
    }

    setCaptureMode('collapsed')
    setCapturedContext(null)

    // Refresh recent ideas list
    invalidateRecentIdeas()

    // Pilot dashboard's System Loop reads from the trade-queue-items
    // queries to decide which stage is "done". The dashboard's queries
    // share the `trade-queue-items` prefix so QuickTradeIdeaCapture's
    // own invalidation already covers the dashboard. We still fire a
    // window event as a belt-and-suspenders refresh signal so the
    // listener can refetch defensively.
    queryClient.refetchQueries({ queryKey: ['trade-queue-items'] })
    queryClient.refetchQueries({ queryKey: ['pilot-dashboard-recorded'] })
    try {
      window.dispatchEvent(new CustomEvent('pilot-loop:refresh', { detail: { reason: 'trade-idea-submitted' } }))
    } catch { /* ignore */ }

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
            onClick={() => {
              if (selectedItem.type === 'prompt') {
                // Go back to Open Prompts list, not main Quick Ideas
                setShowPromptList(true)
                invalidateRecentIdeas()
                onBackToCapture?.()
              } else {
                onBackToCapture?.()
              }
            }}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>{selectedItem.type === 'prompt' ? 'Back to Open Prompts' : 'Back to Quick Ideas'}</span>
          </button>
        </div>

        {/* Detail panel - render based on item type */}
        <div className="flex-1 overflow-hidden">
          {selectedItem.type === 'quick_thought' && (
            <QuickThoughtDetailPanel
              quickThoughtId={selectedItem.id}
              onClose={onBackToCapture}
              onNavigateToTradeIdea={(tradeIdeaId) => {
              }}
              embedded
            />
          )}
          {selectedItem.type === 'prompt' && (
            <PromptDetailView
              promptId={selectedItem.id}
              onClose={() => { setShowPromptList(true); onBackToCapture?.() }}
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

  // ── Pending Review list view ──
  if (showPendingReview) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700">
          <button
            onClick={() => setShowPendingReview(false)}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to Quick Ideas</span>
          </button>
        </div>
        <div className="px-3 py-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Pending Review</h3>
          <button
            onClick={() => {
              setShowPendingReview(false)
              // Open Idea Pipeline with decision drawer in fullscreen
              window.dispatchEvent(new CustomEvent('openTradeQueue', {
                detail: { openDecisionDrawer: 'full' }
              }))
              onClose?.()
            }}
            className="text-[10px] font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
          >
            View all in Idea Pipeline
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-3">
          <PendingReviewList />
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
              <div className="flex-1">
                <button
                  onClick={() => handleOpenCapture('idea')}
                  className="w-full flex items-center justify-center space-x-2 px-3 py-2.5 bg-gradient-to-r from-indigo-500 to-blue-600 text-white text-sm font-medium rounded-lg hover:from-indigo-600 hover:to-blue-700 transition-all shadow-sm"
                >
                  <Lightbulb className="h-4 w-4" />
                  <span>Thought</span>
                </button>
                {recentIdeas.filter(i => i.kind === 'thought').length > 0 && (
                  <button
                    onClick={handleViewAllIdeas}
                    className="mt-1 w-full text-center text-[11px] text-gray-400 dark:text-gray-500 cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline transition-colors"
                  >
                    <span className="font-semibold text-gray-600 dark:text-gray-300">{recentIdeas.filter(i => i.kind === 'thought').length}</span> recent thoughts
                  </button>
                )}
              </div>
              <div className="flex-1">
                <button
                  onClick={() => handleOpenCapture('trade_idea')}
                  className="w-full flex items-center justify-center space-x-2 px-3 py-2.5 bg-gradient-to-r from-green-500 to-emerald-600 text-white text-sm font-medium rounded-lg hover:from-green-600 hover:to-emerald-700 transition-all shadow-sm"
                >
                  <TrendingUp className="h-4 w-4" />
                  <span>Trade Idea</span>
                </button>
                {pipelineCount > 0 && (
                  <button
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('openTradeQueue', { detail: {} }))
                      onClose?.()
                    }}
                    className="mt-1 w-full text-center text-[11px] text-gray-400 dark:text-gray-500 cursor-pointer hover:text-green-600 dark:hover:text-green-400 hover:underline transition-colors"
                  >
                    <span className="font-semibold text-gray-600 dark:text-gray-300">{pipelineCount}</span> in pipeline
                  </button>
                )}
              </div>
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
                    className="mt-1 w-full text-center text-[11px] text-gray-400 dark:text-gray-500 cursor-pointer hover:text-violet-600 dark:hover:text-violet-400 hover:underline transition-colors"
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
                {pendingRecommendationCount > 0 && (
                  <button
                    onClick={() => setShowPendingReview(true)}
                    className="mt-1 w-full text-center text-[11px] text-gray-400 dark:text-gray-500 cursor-pointer hover:text-amber-600 dark:hover:text-amber-400 hover:underline transition-colors"
                  >
                    <span className="font-semibold text-gray-600 dark:text-gray-300">{pendingRecommendationCount}</span> pending review
                  </button>
                )}
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
            {/* Pilot Get Started banner — lives inside the Add Trade
                Idea form so the steps describe THIS form, not the
                generic Quick Ideas picker. Auto-retires once the
                pilot submits their first trade idea, or via manual
                dismiss. Same visual family as the Trade Lab + Idea
                Pipeline banners for cross-surface consistency. */}
            {showPilotCaptureBanner && (
              <div className="mb-3 rounded-md bg-gradient-to-b from-amber-50 to-amber-100/30 dark:from-amber-900/25 dark:to-amber-900/5 border border-amber-200 dark:border-amber-800/60">
                <div className="px-3 pt-2.5 pb-2 flex items-start gap-2">
                  <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300 font-semibold shrink-0 mt-0.5">
                    <Sparkles className="h-3.5 w-3.5" />
                    <span className="text-[11px] uppercase tracking-wider">Get started</span>
                  </div>
                  <button
                    onClick={dismissPilotCaptureBanner}
                    className="ml-auto -my-1 p-1 rounded text-amber-500 hover:text-amber-700 hover:bg-amber-100/60 dark:text-amber-400 dark:hover:text-amber-200 dark:hover:bg-amber-900/30 transition-colors shrink-0"
                    title="Dismiss"
                    aria-label="Dismiss capture intro"
                  >
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="px-3 pb-2.5">
                  <ol className="space-y-1">
                    <PilotCaptureStep n={1} title="Pick a ticker" done={captureStep1Done} />
                    <PilotCaptureStep n={2} title="Add a thesis and portfolio" done={captureStep2Done} />
                    <PilotCaptureStep n={3} title="Submit" done={captureStep3Done} />
                  </ol>
                </div>
              </div>
            )}

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
      // Fetch prompts created by the current user (exclude resolved)
      const { data: myPrompts, error: err1 } = await supabase
        .from('quick_thoughts')
        .select('id, content, tags, created_at, created_by')
        .eq('created_by', user!.id)
        .eq('idea_type', 'prompt')
        .eq('is_archived', false)
        .not('tags', 'cs', '{"status:closed"}')
        .order('created_at', { ascending: false })
        .limit(20)

      if (err1) throw err1

      // Fetch prompts assigned to the current user (exclude resolved)
      const { data: assignedToMe, error: err2 } = await supabase
        .from('quick_thoughts')
        .select('id, content, tags, created_at, created_by')
        .eq('idea_type', 'prompt')
        .eq('is_archived', false)
        .neq('created_by', user!.id)
        .contains('tags', [`assignee:${user!.id}`])
        .not('tags', 'cs', '{"status:closed"}')
        .order('created_at', { ascending: false })
        .limit(20)

      if (err2) throw err2

      // Merge and deduplicate
      const seen = new Set<string>()
      const all = [...(myPrompts || []), ...(assignedToMe || [])].filter(p => {
        if (seen.has(p.id)) return false
        seen.add(p.id)
        return true
      })

      // Sort by created_at desc
      all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

      return all
    },
    enabled: !!user?.id,
    staleTime: 30_000,
  })

  // Batch-fetch assignee names for all prompts
  const assigneeIds = [...new Set(
    prompts
      .flatMap(p => (p.tags || []) as string[])
      .filter(t => t.startsWith('assignee:'))
      .map(t => t.replace('assignee:', ''))
      .filter(Boolean)
  )]

  const { data: assigneeUsers } = useQuery({
    queryKey: ['prompt-assignee-users', assigneeIds],
    queryFn: async () => {
      if (assigneeIds.length === 0) return []
      const { data } = await supabase
        .from('users')
        .select('id, first_name, last_name, email')
        .in('id', assigneeIds)
      return data || []
    },
    enabled: assigneeIds.length > 0,
    staleTime: 5 * 60_000,
  })

  const getAssigneeName = (id: string | null) => {
    if (!id) return null
    const u = assigneeUsers?.find(a => a.id === id)
    if (!u) return null
    if (u.first_name && u.last_name) return `${u.first_name} ${u.last_name[0]}.`
    if (u.first_name) return u.first_name
    return u.email?.split('@')[0] || null
  }

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
        // Extract assignee info from tags
        const assigneeIdTag = prompt.tags?.find((t: string) => t.startsWith('assignee:'))
        const assigneeId = assigneeIdTag ? assigneeIdTag.replace('assignee:', '') : null
        const assigneeName = getAssigneeName(assigneeId)
        // Extract context from tags
        const ctxTag = prompt.tags?.find((t: string) => t.startsWith('ctx:'))
        const ctxTitle = ctxTag ? ctxTag.replace(/^ctx:[^:]+:[^:]+:/, '') : null
        const categoryTag = prompt.tags?.find((t: string) => t.startsWith('category:'))
        const category = categoryTag ? categoryTag.replace('category:', '') as RequestType : null
        const categoryMeta = category ? REQUEST_TYPE_META[category] : null
        const timeAgo = formatDistanceToNow(new Date(prompt.created_at), { addSuffix: true })

        // Determine who it's waiting on
        const isCreatedByMe = prompt.created_by === user?.id
        const isAssignedToMe = assigneeId === user?.id

        let waitingLabel: string | null = null
        let waitingColor = ''
        let waitingBg = ''
        if (isAssignedToMe) {
          waitingLabel = 'Waiting on you'
          waitingColor = 'text-rose-700 dark:text-rose-300'
          waitingBg = 'bg-rose-50 dark:bg-rose-900/30 px-1.5 py-0.5 rounded'
        } else if (isCreatedByMe && assigneeName) {
          waitingLabel = `Waiting on ${assigneeName}`
          waitingColor = 'text-violet-700 dark:text-violet-300'
          waitingBg = 'bg-violet-50 dark:bg-violet-900/30 px-1.5 py-0.5 rounded'
        }

        return (
          <button
            key={prompt.id}
            onClick={() => onSelectPrompt(prompt.id)}
            className="w-full text-left px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-violet-300 dark:hover:border-violet-600 hover:bg-violet-50/50 dark:hover:bg-violet-900/10 transition-colors group"
          >
            <div className="flex items-stretch gap-2">
              <MessageCircleQuestion className="h-3.5 w-3.5 text-violet-500 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-900 dark:text-white line-clamp-2 leading-snug">
                  {prompt.content || 'Untitled prompt'}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  {categoryMeta && (
                    <span className={clsx('text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700/60', categoryMeta.color)}>
                      {categoryMeta.label}
                    </span>
                  )}
                  {waitingLabel && (
                    <span className={clsx('text-[10px] font-semibold', waitingColor, waitingBg)}>
                      {waitingLabel}
                    </span>
                  )}
                  {ctxTitle && (
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate max-w-[100px]">{ctxTitle}</span>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end justify-between shrink-0 ml-1">
                <ChevronRight className="h-3.5 w-3.5 text-gray-300 dark:text-gray-600 group-hover:text-violet-400" />
                <span className="text-[9px] text-gray-400 dark:text-gray-500">{timeAgo}</span>
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ─── Inline Pending Review List ────────────────────────────────────────────

function PendingReviewList() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const updateDecision = useUpdateDecisionRequest()
  const acceptFromInbox = useAcceptFromInbox()

  // Fetch portfolios where current user is PM/admin
  const { data: pmPortfolioIds = [] } = useQuery({
    queryKey: ['user-pm-portfolios', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('portfolio_team')
        .select('portfolio_id')
        .eq('user_id', user!.id)
        .in('role', ['pm', 'admin'])
      return (data || []).map(p => p.portfolio_id)
    },
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
  })

  // Fetch pending decisions: ones I submitted + ones for portfolios I manage
  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['pending-review-list', user?.id, pmPortfolioIds],
    queryFn: async () => {
      const selectClause = `
        id, status, context_note, created_at, requested_by, portfolio_id,
        sizing_weight, sizing_mode,
        trade_queue_item_id,
        portfolio:portfolios(id, name),
        requester:users!decision_requests_requested_by_fkey(id, first_name, last_name, email),
        trade_queue_item:trade_queue_items(id, action, asset_id, assets(symbol, company_name))
      `

      // Fetch requests I submitted
      const { data: myRequests, error: err1 } = await supabase
        .from('decision_requests')
        .select(selectClause)
        .eq('requested_by', user!.id)
        .in('status', ['pending', 'under_review', 'needs_discussion'])
        .order('created_at', { ascending: false })
        .limit(20)

      if (err1) throw err1

      // Fetch requests for portfolios I manage (including ones I submitted)
      let pmRequests: any[] = []
      if (pmPortfolioIds.length > 0) {
        const { data, error: err2 } = await supabase
          .from('decision_requests')
          .select(selectClause)
          .in('portfolio_id', pmPortfolioIds)
          .in('status', ['pending', 'under_review', 'needs_discussion'])
          .order('created_at', { ascending: false })
          .limit(20)

        if (err2) throw err2
        pmRequests = data || []
      }

      // Merge and deduplicate
      const seen = new Set<string>()
      return [...(myRequests || []), ...pmRequests].filter(r => {
        if (seen.has(r.id)) return false
        seen.add(r.id)
        return true
      }).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    },
    enabled: !!user?.id,
    staleTime: 30_000,
  })

  const pmPortfolioSet = new Set(pmPortfolioIds)

  // Track which cards are in action mode
  const [actioningId, setActioningId] = useState<string | null>(null)
  const [actionNote, setActionNote] = useState('')

  const handleAccept = async (req: any) => {
    const sizingInput = req.sizing_weight != null ? String(req.sizing_weight) : '0'
    await acceptFromInbox.mutateAsync({
      decisionRequest: req as any,
      sizingInput,
      decisionNote: actionNote || undefined,
      context: {
        actorId: user!.id,
        actorName: (user as any)?.first_name || user?.email || 'PM',
        actorRole: 'pm',
        requestId: `quick-accept-${Date.now()}`,
      }
    })
    setActioningId(null)
    setActionNote('')
    queryClient.invalidateQueries({ queryKey: ['pending-review-list'] })
    queryClient.invalidateQueries({ queryKey: ['direct-pending-recommendation-count'] })
  }

  const handleReject = async (req: any) => {
    await updateDecision.mutateAsync({
      requestId: req.id,
      input: {
        status: 'rejected',
        decisionNote: actionNote || null,
      }
    })
    setActioningId(null)
    setActionNote('')
    queryClient.invalidateQueries({ queryKey: ['pending-review-list'] })
    queryClient.invalidateQueries({ queryKey: ['direct-pending-recommendation-count'] })
  }

  const handleMessageUser = (userId: string) => {
    window.dispatchEvent(new CustomEvent('openDirectMessage', {
      detail: { recipientId: userId }
    }))
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-14 bg-gray-100 dark:bg-gray-700/50 rounded-lg animate-pulse" />
        ))}
      </div>
    )
  }

  if (requests.length === 0) {
    return (
      <div className="text-center py-8">
        <Scale className="h-8 w-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
        <p className="text-sm text-gray-500 dark:text-gray-400">No pending decisions</p>
      </div>
    )
  }

  const isPending = updateDecision.isPending || acceptFromInbox.isPending

  return (
    <div className="space-y-1.5">
      {requests.map((req: any) => {
        const asset = req.trade_queue_item?.assets
        const symbol = asset?.symbol || '?'
        const companyName = asset?.company_name
        const action = req.trade_queue_item?.action
        const portfolioName = req.portfolio?.name
        const timeAgo = formatDistanceToNow(new Date(req.created_at), { addSuffix: true })
        const isBuy = action === 'buy' || action === 'add'
        const isMyRequest = req.requested_by === user?.id
        const isPMForPortfolio = pmPortfolioSet.has(req.portfolio_id)
        const canDecide = isPMForPortfolio

        // Who submitted this
        const requesterName = req.requester?.first_name
          ? `${req.requester.first_name}${req.requester.last_name ? ' ' + req.requester.last_name[0] + '.' : ''}`
          : req.requester?.email?.split('@')[0] || 'Unknown'

        const isActioning = actioningId === req.id

        return (
          <div
            key={req.id}
            className="px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-amber-300 dark:hover:border-amber-600 transition-colors"
          >
            {/* Top row: action + symbol + company */}
            <div
              className="flex items-center gap-2 text-sm cursor-pointer"
              onClick={() => {
                if (req.trade_queue_item_id) {
                  window.dispatchEvent(new CustomEvent('openTradeQueue', {
                    detail: { selectedTradeId: req.trade_queue_item_id }
                  }))
                }
              }}
            >
              {action && (
                <span className={clsx(
                  'font-semibold text-xs',
                  isBuy ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                )}>
                  {action.toUpperCase()}
                </span>
              )}
              <span className="font-semibold text-gray-900 dark:text-white">{symbol}</span>
              {companyName && (
                <span className="text-gray-500 dark:text-gray-400 truncate text-xs">{companyName}</span>
              )}
              <ChevronRight className="h-3 w-3 text-gray-300 dark:text-gray-600 ml-auto shrink-0" />
            </div>

            {/* Middle row: portfolio + who it's waiting on */}
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {portfolioName && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    window.dispatchEvent(new CustomEvent('openTradeLab', {
                      detail: { portfolioId: req.portfolio_id }
                    }))
                  }}
                  className="flex items-center gap-1 text-[10px] text-primary-600 dark:text-primary-400 font-medium hover:underline"
                >
                  <Briefcase className="h-2.5 w-2.5" />
                  {portfolioName}
                </button>
              )}
              {canDecide ? (
                // I'm the PM — show who submitted it
                isMyRequest ? (
                  <span className="text-[10px] font-semibold text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30 px-1.5 py-0.5 rounded">
                    Your recommendation
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[10px]">
                    <span className="text-gray-400">From</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (req.requester?.id) handleMessageUser(req.requester.id)
                      }}
                      className="font-semibold text-primary-600 dark:text-primary-400 hover:underline"
                    >
                      {requesterName}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (req.requester?.id) handleMessageUser(req.requester.id)
                      }}
                      className="text-gray-400 hover:text-primary-500 transition-colors"
                      title={`Message ${requesterName}`}
                    >
                      <MessageCircle className="h-3 w-3" />
                    </button>
                  </span>
                )
              ) : (
                // I'm not the PM — show it's awaiting decision
                <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 rounded">
                  Awaiting PM decision
                </span>
              )}
              <span className="text-[9px] text-gray-400 dark:text-gray-500 ml-auto">{timeAgo}</span>
            </div>

            {/* Context note */}
            {req.context_note && (
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 line-clamp-2 italic">"{req.context_note}"</p>
            )}

            {/* Action buttons — only for PM (canDecide) */}
            {canDecide && !isActioning && (
              <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-gray-100 dark:border-gray-700/50">
                <button
                  onClick={(e) => { e.stopPropagation(); setActioningId(req.id); setActionNote('') }}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50 transition-colors"
                >
                  <Check className="h-3 w-3" /> Accept
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setActioningId(`reject-${req.id}`); setActionNote('') }}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40 transition-colors"
                >
                  <XIcon className="h-3 w-3" /> Reject
                </button>
              </div>
            )}

            {/* Accept confirmation */}
            {isActioning && actioningId === req.id && (
              <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700/50 space-y-1.5">
                <input
                  type="text"
                  value={actionNote}
                  onChange={e => setActionNote(e.target.value)}
                  placeholder="Note (optional)"
                  className="w-full px-2 py-1 text-xs border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-green-500 focus:outline-none"
                  onClick={e => e.stopPropagation()}
                />
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleAccept(req) }}
                    disabled={isPending}
                    className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold rounded bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50"
                  >
                    {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    Confirm Accept
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setActioningId(null) }}
                    className="px-2 py-1 text-[10px] text-gray-500 hover:text-gray-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Reject confirmation */}
            {actioningId === `reject-${req.id}` && (
              <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700/50 space-y-1.5">
                <input
                  type="text"
                  value={actionNote}
                  onChange={e => setActionNote(e.target.value)}
                  placeholder="Reason (optional)"
                  className="w-full px-2 py-1 text-xs border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-red-500 focus:outline-none"
                  onClick={e => e.stopPropagation()}
                />
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleReject(req) }}
                    disabled={isPending}
                    className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold rounded bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
                  >
                    {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <XIcon className="h-3 w-3" />}
                    Confirm Reject
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setActioningId(null) }}
                    className="px-2 py-1 text-[10px] text-gray-500 hover:text-gray-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// Numbered step pill used in the pilot Get Started banner inside
// the capture sidebar. Mirrors the pattern from the Trade Lab and
// Idea Pipeline banners for visual consistency across surfaces.
function PilotCaptureStep({ n, title, done }: { n: number; title: string; done?: boolean }) {
  return (
    <li className="flex items-center gap-2">
      <span
        className={clsx(
          "shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold tabular-nums",
          done ? "bg-emerald-500 text-white" : "bg-amber-500 text-white",
        )}
      >
        {done ? <Check className="h-2.5 w-2.5" /> : n}
      </span>
      <span
        className={clsx(
          "text-[11px] font-medium leading-tight",
          done ? "text-emerald-700 dark:text-emerald-300 line-through opacity-70" : "text-gray-800 dark:text-gray-100",
        )}
      >
        {title}
      </span>
    </li>
  )
}
