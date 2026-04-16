/**
 * DecisionInboxPanel — Bottom drawer for the Trade Queue page.
 *
 * Three states: collapsed (slim strip), half (55%), fullscreen (100%).
 */

import { useState, useCallback } from 'react'
import {
  Gavel,
  ChevronUp,
  ChevronDown,
  Maximize2,
  Minimize2,
} from 'lucide-react'
import { clsx } from 'clsx'
import { DecisionInbox } from './DecisionInbox'

type DrawerSize = 'collapsed' | 'half' | 'full'

interface DecisionInboxPanelProps {
  portfolioId?: string
  onIdeaClick?: (tradeId: string) => void
  collapsed?: boolean
  onToggleCollapsed?: () => void
  pendingCount?: number
  searchQuery?: string
  actionFilter?: string
  urgencyFilter?: string
  createdByFilter?: string
}

export function DecisionInboxPanel({
  portfolioId,
  onIdeaClick,
  collapsed: controlledCollapsed,
  onToggleCollapsed,
  pendingCount = 0,
  searchQuery,
  actionFilter,
  urgencyFilter,
  createdByFilter,
}: DecisionInboxPanelProps) {
  const [internalSize, setInternalSize] = useState<DrawerSize>('collapsed')
  const [resolvedPendingCount, setResolvedPendingCount] = useState<number | null>(null)
  const handlePendingCountChange = useCallback((count: number) => setResolvedPendingCount(count), [])

  // The parent passes an UNFILTERED count (`pendingCount`) derived straight
  // from decision_requests by status. DecisionInbox re-filters by permission
  // (classifyWaiting + portfolio role) and fires onPendingCountChange with
  // the corrected number. Showing the parent value as a fallback caused a
  // visible flicker on hard refresh (e.g. 8 → 7). Prefer the resolved value
  // once known and only fall back to `pendingCount` when the inbox hasn't
  // reported yet AND the prop looks plausible (non-zero); otherwise show
  // nothing to avoid the wrong-number flash.
  const displayCount = resolvedPendingCount ?? null

  // Derive size from controlled collapsed prop or internal state
  const size: DrawerSize = controlledCollapsed === true ? 'collapsed'
    : controlledCollapsed === false && internalSize === 'collapsed' ? 'half'
    : controlledCollapsed === false ? internalSize
    : internalSize

  const isCollapsed = size === 'collapsed'
  const isOpen = !isCollapsed

  const toggle = () => {
    if (onToggleCollapsed) {
      if (isCollapsed) {
        onToggleCollapsed() // open → half
        setInternalSize('half')
      } else {
        onToggleCollapsed() // close
        setInternalSize('collapsed')
      }
    } else {
      setInternalSize(prev => prev === 'collapsed' ? 'half' : 'collapsed')
    }
  }

  const toggleFullscreen = (e: React.MouseEvent) => {
    e.stopPropagation()
    setInternalSize(prev => prev === 'full' ? 'half' : 'full')
    // Ensure the controlled parent knows we're open
    if (controlledCollapsed && onToggleCollapsed) onToggleCollapsed()
  }

  return (
    <div
      className={clsx(
        "absolute bottom-0 left-0 right-0 z-20 flex flex-col bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] dark:shadow-[0_-4px_16px_rgba(0,0,0,0.3)] transition-all duration-200 ease-in-out",
        size === 'collapsed' && "h-10",
        size === 'half' && "h-[60%]",
        size === 'full' && "h-full",
      )}
    >
      {/* Header strip — always visible */}
      <button
        onClick={toggle}
        className="flex-shrink-0 flex items-center justify-between px-4 h-10 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors group"
      >
        <div className="flex items-center gap-2">
          <Gavel className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500" />
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Decision Inbox</span>
          {displayCount !== null && displayCount > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded-full">
              {displayCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {isOpen && (
            <button
              onClick={toggleFullscreen}
              className="p-1.5 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              title={size === 'full' ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {size === 'full'
                ? <Minimize2 className="h-4 w-4" />
                : <Maximize2 className="h-4 w-4" />
              }
            </button>
          )}
          <div className="p-1.5 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            {isCollapsed
              ? <ChevronUp className="h-4 w-4" />
              : <ChevronDown className="h-4 w-4" />
            }
          </div>
        </div>
      </button>

      {/* Inbox content — always mounted for count, hidden when collapsed */}
      <div className={clsx("flex-1 min-h-0 overflow-hidden", isOpen ? "border-t border-gray-100 dark:border-gray-700" : "hidden")}>
        <DecisionInbox
          portfolioId={portfolioId}
          onIdeaClick={onIdeaClick}
          panelMode
          searchQuery={searchQuery}
          actionFilter={actionFilter}
          urgencyFilter={urgencyFilter}
          createdByFilter={createdByFilter}
          onPendingCountChange={handlePendingCountChange}
        />
      </div>
    </div>
  )
}
