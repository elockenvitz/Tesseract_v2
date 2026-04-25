/**
 * DecisionInboxPanel — Bottom drawer for the Trade Queue page.
 *
 * Three states: collapsed (slim strip), half (55%), fullscreen (100%).
 */

import { useState, useCallback, useEffect } from 'react'
import {
  Gavel,
  ChevronUp,
  ChevronDown,
  Maximize2,
  Minimize2,
} from 'lucide-react'
import { clsx } from 'clsx'
import { DecisionInbox } from './DecisionInbox'

// Persist the "last acknowledged pending count" across tab navigation
// and page refresh so amber ("new decision!") doesn't re-pin every time
// the panel re-mounts. Keyed per-portfolio so different portfolios
// track independently.
const ACK_KEY_PREFIX = 'decision_inbox_acknowledged_count_'
const ackKey = (portfolioId?: string) => `${ACK_KEY_PREFIX}${portfolioId || 'global'}`
function readAck(portfolioId?: string): number {
  try {
    const raw = localStorage.getItem(ackKey(portfolioId))
    if (!raw) return 0
    const n = parseInt(raw, 10)
    return Number.isFinite(n) ? n : 0
  } catch { return 0 }
}
function writeAck(portfolioId: string | undefined, n: number) {
  try { localStorage.setItem(ackKey(portfolioId), String(n)) } catch { /* ignore */ }
}

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

  // Track the count the user has already SEEN — the moment they open the
  // drawer, every pending row currently in the inbox is marked as
  // acknowledged. The amber "new decision" tint then only returns when
  // the count grows above that watermark (i.e. a genuinely new request
  // arrived afterwards). Persisted to localStorage so the watermark
  // survives tab navigation and page refresh — without this the amber
  // state re-pins every time the panel re-mounts, defeating the
  // acknowledgement flow.
  const [acknowledgedCount, setAcknowledgedCountState] = useState<number>(() => readAck(portfolioId))
  // Reload the watermark when the active portfolio changes — different
  // portfolios track independently.
  useEffect(() => {
    setAcknowledgedCountState(readAck(portfolioId))
  }, [portfolioId])
  const setAcknowledgedCount = useCallback((n: number) => {
    setAcknowledgedCountState(n)
    writeAck(portfolioId, n)
  }, [portfolioId])
  const hasUnseen = (displayCount ?? 0) > acknowledgedCount

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
        // Opening — mark the current pending count as seen so the
        // amber "new decision" tint resets to neutral.
        setAcknowledgedCount(displayCount ?? 0)
        onToggleCollapsed() // open → half
        setInternalSize('half')
      } else {
        onToggleCollapsed() // close
        setInternalSize('collapsed')
      }
    } else {
      setInternalSize(prev => {
        if (prev === 'collapsed') {
          setAcknowledgedCount(displayCount ?? 0)
          return 'half'
        }
        return 'collapsed'
      })
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
      {/* Header strip — always visible. Amber tint signals an
          UNSEEN pending decision (collapsed AND the count is above
          the watermark from the last time the user opened the
          drawer). Once opened, the watermark catches up so the
          strip stays neutral when the user closes it again. */}
      <button
        onClick={toggle}
        className={clsx(
          "flex-shrink-0 flex items-center justify-between px-4 h-11 cursor-pointer transition-colors group",
          isCollapsed && hasUnseen
            ? "bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/20 dark:hover:bg-amber-900/30 border-t-2 border-t-amber-400 dark:border-t-amber-600"
            : "hover:bg-gray-50 dark:hover:bg-gray-700/50"
        )}
      >
        <div className="flex items-center gap-2">
          <Gavel className={clsx(
            "h-4 w-4",
            isCollapsed && hasUnseen
              ? "text-amber-600 dark:text-amber-400"
              : "text-gray-400 dark:text-gray-500"
          )} />
          <span className={clsx(
            "text-[13px] font-semibold",
            isCollapsed && hasUnseen
              ? "text-amber-900 dark:text-amber-200"
              : "text-gray-700 dark:text-gray-300"
          )}>
            Decision Inbox
          </span>
          {displayCount !== null && displayCount > 0 && (
            <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-500 text-white dark:bg-amber-500 dark:text-white rounded-full shadow-sm">
              {displayCount} pending
            </span>
          )}
          {isCollapsed && hasUnseen && (
            <span className="hidden sm:inline text-[11px] text-amber-700 dark:text-amber-300 font-medium animate-pulse">
              · Click to review
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
