import { useState } from 'react'
import { TrendingUp, ChevronDown, ChevronUp } from 'lucide-react'
import { QuickThoughtCapture } from '../thoughts/QuickThoughtCapture'
import { ThoughtsFeed } from '../thoughts/ThoughtsFeed'
import { AddTradeIdeaModal } from '../trading/AddTradeIdeaModal'

interface ThoughtsSectionProps {
  onAssetClick?: (assetId: string, symbol: string) => void
}

export function ThoughtsSection({ onAssetClick }: ThoughtsSectionProps) {
  const [filter, setFilter] = useState<'all' | 'pinned' | 'bullish' | 'bearish'>('all')
  const [showTradeIdeaModal, setShowTradeIdeaModal] = useState(false)
  const [isCaptureExpanded, setIsCaptureExpanded] = useState(true)

  return (
    <div className="flex flex-col h-full">
      {/* Collapsible Quick Thought Capture */}
      {isCaptureExpanded && (
        <div className="p-4 border-b border-gray-200">
          <QuickThoughtCapture
            compact={true}
            autoFocus={false}
            placeholder="Capture a quick thought..."
          />

          {/* Quick Trade Idea Button */}
          <button
            onClick={() => setShowTradeIdeaModal(true)}
            className="mt-3 w-full flex items-center justify-center space-x-2 px-3 py-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white text-sm font-medium rounded-lg hover:from-green-600 hover:to-emerald-700 transition-all shadow-sm"
          >
            <TrendingUp className="h-4 w-4" />
            <span>Quick Trade Idea</span>
          </button>
        </div>
      )}

      {/* Filter Tabs with Collapse Toggle */}
      <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          {(['all', 'pinned', 'bullish', 'bearish'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                filter === f
                  ? 'bg-primary-100 text-primary-700'
                  : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <button
          onClick={() => setIsCaptureExpanded(!isCaptureExpanded)}
          className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
          title={isCaptureExpanded ? 'Collapse capture' : 'Expand capture'}
        >
          {isCaptureExpanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Thoughts Feed */}
      <div className="flex-1 overflow-y-auto p-4">
        <ThoughtsFeed
          limit={20}
          showHeader={false}
          filter={filter}
          onAssetClick={onAssetClick}
        />
      </div>

      {/* Trade Idea Modal */}
      <AddTradeIdeaModal
        isOpen={showTradeIdeaModal}
        onClose={() => setShowTradeIdeaModal(false)}
        onSuccess={() => setShowTradeIdeaModal(false)}
      />
    </div>
  )
}
