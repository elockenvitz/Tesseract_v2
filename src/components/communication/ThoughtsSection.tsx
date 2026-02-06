import { useState, useCallback, useEffect } from 'react'
import { TrendingUp, Lightbulb, ArrowLeft } from 'lucide-react'
import { QuickThoughtCapture } from '../thoughts/QuickThoughtCapture'
import { QuickTradeIdeaCapture } from '../thoughts/QuickTradeIdeaCapture'
import { RecentQuickIdeas } from '../thoughts/RecentQuickIdeas'
import { QuickThoughtDetailPanel } from '../ideas/QuickThoughtDetailPanel'
import { useRecentQuickIdeas } from '../../hooks/useRecentQuickIdeas'
import { useToast } from '../common/Toast'
import { buildQuickThoughtsFilters } from '../../hooks/useIdeasRouting'
import type { CapturedContext } from '../thoughts/ContextSelector'
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

type CaptureMode = 'collapsed' | 'idea' | 'trade_idea'
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
  const { success } = useToast()

  // Fetch recent quick ideas for the sidebar (max 5, personal only, no trade ideas)
  const { data: recentIdeas = [], invalidate: invalidateRecentIdeas, hasMore } = useRecentQuickIdeas(5)

  // Captured context - locked when opening capture mode
  const [capturedContext, setCapturedContext] = useState<CapturedContext | null>(null)

  // When opening capture mode, capture the current context
  const handleOpenCapture = (mode: 'idea' | 'trade_idea') => {
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

  const handleTradeIdeaSuccess = () => {
    success('Trade idea added.', 'Decision queued in Priorities.')

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
  const handleOpenIdea = useCallback((id: string) => {
    if (onOpenInspector) {
      // Open the quick thought in inspect mode (stays in sidebar)
      onOpenInspector('quick_thought', id)
    }
  }, [onOpenInspector])

  // Handle viewing all ideas - dispatches event to open Ideas tab with Quick Thoughts filter
  const handleViewAllIdeas = useCallback(() => {
    if (onViewAllIdeas) {
      // Custom handler provided
      onViewAllIdeas()
    } else {
      // Build filters with context
      const context = initialContextType && initialContextId
        ? { type: initialContextType as 'asset' | 'portfolio' | 'theme', id: initialContextId }
        : undefined
      const filters = buildQuickThoughtsFilters(context)

      // Dispatch event for DashboardPage to open Ideas tab with filters
      window.dispatchEvent(new CustomEvent('openIdeasTab', {
        detail: { filters }
      }))

      // Close the sidebar
      onClose?.()
    }
  }, [onViewAllIdeas, initialContextType, initialContextId, onClose])

  // ESC key handler - in inspect mode, go back to capture; in capture mode, close sidebar
  useEffect(() => {
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (sidebarMode === 'inspect' && onBackToCapture) {
          // In inspect mode, ESC goes back to capture mode
          onBackToCapture()
        } else {
          // In capture mode, ESC closes the sidebar
          onClose?.()
        }
      }
    }

    document.addEventListener('keydown', handleEscKey)
    return () => document.removeEventListener('keydown', handleEscKey)
  }, [sidebarMode, onBackToCapture, onClose])

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
          {/* Future: Add other item type detail views here */}
          {selectedItem.type !== 'quick_thought' && (
            <div className="p-4 text-center text-gray-500">
              <p>Detail view for {selectedItem.type} coming soon</p>
            </div>
          )}
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
        {/* Mode selector - show two buttons */}
        {captureMode === 'collapsed' && (
          <>
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
      </div>
    </div>
  )
}
