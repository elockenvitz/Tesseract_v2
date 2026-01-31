import { useState } from 'react'
import { TrendingUp, Lightbulb, ArrowLeft } from 'lucide-react'
import { QuickThoughtCapture } from '../thoughts/QuickThoughtCapture'
import { QuickTradeIdeaCapture } from '../thoughts/QuickTradeIdeaCapture'
import { useToast } from '../common/Toast'
import type { CapturedContext } from '../thoughts/ContextSelector'

interface ThoughtsSectionProps {
  onClose?: () => void
  // Auto-detected context from current location
  initialContextType?: string
  initialContextId?: string
  initialContextTitle?: string
}

type CaptureMode = 'collapsed' | 'idea' | 'trade_idea'
type IdeaType = 'thought' | 'research_idea' | 'thesis'

export function ThoughtsSection({
  onClose,
  initialContextType,
  initialContextId,
  initialContextTitle
}: ThoughtsSectionProps) {
  const [captureMode, setCaptureMode] = useState<CaptureMode>('collapsed')
  const [currentIdeaType, setCurrentIdeaType] = useState<IdeaType>('thought')
  const { success } = useToast()

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

    // Close the pane after a brief delay to let the user see the button state change
    setTimeout(() => {
      onClose?.()
    }, 100)
  }

  const handleTradeIdeaSuccess = () => {
    success('Trade idea added.', 'Decision queued in Priorities.')

    setCaptureMode('collapsed')
    setCapturedContext(null)

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

  return (
    <div className="flex flex-col h-full">
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

            {/* Guided empty state */}
            <div className="mt-8 text-center">
              <p className="text-sm font-medium text-gray-600">
                What do you want to capture?
              </p>
              <p className="mt-1 text-xs text-gray-400">
                Choose Thought or Trade Idea to save it without leaving your workflow.
              </p>
            </div>
          </>
        )}

        {/* Capture form for quick ideas (Thought / Research / Thesis) */}
        {captureMode === 'idea' && (
          <div>
            <button
              onClick={handleCaptureCancel}
              className="flex items-center gap-1.5 mb-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back</span>
            </button>

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
          <div>
            <button
              onClick={handleCaptureCancel}
              className="flex items-center gap-1.5 mb-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back</span>
            </button>

            {/* Mode-specific guidance */}
            <p className="mb-3 text-xs text-gray-400">
              Capture a potential trade to review or decide on later.
            </p>

            <QuickTradeIdeaCapture
              compact={true}
              autoFocus={true}
              onSuccess={handleTradeIdeaSuccess}
              onCancel={handleCaptureCancel}
              capturedContext={capturedContext}
              onContextChange={handleContextChange}
            />
          </div>
        )}
      </div>
    </div>
  )
}
