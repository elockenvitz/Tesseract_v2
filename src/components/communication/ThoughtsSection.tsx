import { useState } from 'react'
import { TrendingUp, Lightbulb, ArrowLeft, ChevronUp, ChevronDown } from 'lucide-react'
import { QuickThoughtCapture } from '../thoughts/QuickThoughtCapture'
import { QuickTradeIdeaCapture } from '../thoughts/QuickTradeIdeaCapture'
import { ThoughtsFeed } from '../thoughts/ThoughtsFeed'
import { TradeIdeaDiscussion } from '../thoughts/TradeIdeaDiscussion'

interface ThoughtsSectionProps {
  onAssetClick?: (assetId: string, symbol: string) => void
  onOpenDiscussion?: (contextType: string, contextId: string, contextTitle: string) => void
}

type CaptureMode = 'collapsed' | 'idea' | 'trade_idea'

interface ActiveDiscussion {
  tradeId: string
  tradeTitle: string
}

export function ThoughtsSection({ onAssetClick, onOpenDiscussion }: ThoughtsSectionProps) {
  const [filter, setFilter] = useState<'all' | 'thoughts' | 'trades' | 'pinned'>('all')
  const [captureMode, setCaptureMode] = useState<CaptureMode>('collapsed')
  const [isCaptureCollapsed, setIsCaptureCollapsed] = useState(false)
  const [activeDiscussion, setActiveDiscussion] = useState<ActiveDiscussion | null>(null)

  const handleCaptureSuccess = () => {
    setCaptureMode('collapsed')
  }

  // Handle opening discussion from feed
  const handleOpenDiscussion = (contextType: string, contextId: string, contextTitle: string) => {
    if (contextType === 'trade_idea') {
      // Open in-pane discussion view
      setActiveDiscussion({ tradeId: contextId, tradeTitle: contextTitle })
    } else if (onOpenDiscussion) {
      // Fall back to external handler for other types
      onOpenDiscussion(contextType, contextId, contextTitle)
    }
  }

  // If viewing a discussion, show the discussion component
  if (activeDiscussion) {
    return (
      <TradeIdeaDiscussion
        tradeId={activeDiscussion.tradeId}
        tradeTitle={activeDiscussion.tradeTitle}
        onBack={() => setActiveDiscussion(null)}
      />
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Capture Section - hidden with CSS to preserve state */}
      <div className={`p-3 border-b border-gray-200 ${isCaptureCollapsed ? 'hidden' : ''}`}>
        {/* Collapsed state - show two buttons */}
        {captureMode === 'collapsed' && (
          <div className="flex gap-2">
            <button
              onClick={() => setCaptureMode('idea')}
              className="flex-1 flex items-center justify-center space-x-2 px-3 py-2.5 bg-gradient-to-r from-indigo-500 to-blue-600 text-white text-sm font-medium rounded-lg hover:from-indigo-600 hover:to-blue-700 transition-all shadow-sm"
            >
              <Lightbulb className="h-4 w-4" />
              <span>Thought</span>
            </button>
            <button
              onClick={() => setCaptureMode('trade_idea')}
              className="flex-1 flex items-center justify-center space-x-2 px-3 py-2.5 bg-gradient-to-r from-green-500 to-emerald-600 text-white text-sm font-medium rounded-lg hover:from-green-600 hover:to-emerald-700 transition-all shadow-sm"
            >
              <TrendingUp className="h-4 w-4" />
              <span>Trade Idea</span>
            </button>
          </div>
        )}

        {/* Expanded state - show capture form for quick ideas */}
        {captureMode === 'idea' && (
          <div>
            <button
              onClick={() => setCaptureMode('collapsed')}
              className="flex items-center gap-1.5 mb-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back</span>
            </button>
            <QuickThoughtCapture
              compact={true}
              autoFocus={true}
              placeholder="Capture a quick thought..."
              onSuccess={handleCaptureSuccess}
              onCancel={() => setCaptureMode('collapsed')}
            />
          </div>
        )}

        {/* Expanded state - show capture form for trade ideas */}
        {captureMode === 'trade_idea' && (
          <div>
            <button
              onClick={() => setCaptureMode('collapsed')}
              className="flex items-center gap-1.5 mb-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back</span>
            </button>
            <QuickTradeIdeaCapture
              compact={true}
              autoFocus={true}
              onSuccess={handleCaptureSuccess}
              onCancel={() => setCaptureMode('collapsed')}
            />
          </div>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="px-4 py-2 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            {([
              { key: 'all', label: 'All' },
              { key: 'thoughts', label: 'Thoughts' },
              { key: 'trades', label: 'Trades' },
              { key: 'pinned', label: 'Pinned' },
            ] as const).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`px-2.5 py-1 text-xs font-medium rounded-full transition-colors ${
                  filter === key
                    ? 'bg-primary-100 text-primary-700'
                    : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setIsCaptureCollapsed(!isCaptureCollapsed)}
            className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
            title={isCaptureCollapsed ? 'Show capture buttons' : 'Hide capture buttons'}
          >
            {isCaptureCollapsed ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronUp className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Thoughts Feed */}
      <div className="flex-1 overflow-y-auto p-4">
        <ThoughtsFeed
          limit={20}
          showHeader={false}
          filter={filter}
          onAssetClick={onAssetClick}
          onOpenDiscussion={handleOpenDiscussion}
        />
      </div>
    </div>
  )
}
