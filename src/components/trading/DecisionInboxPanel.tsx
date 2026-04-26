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
import { useAuth } from '../../hooks/useAuth'
import { useOrganization } from '../../contexts/OrganizationContext'
import { DecisionInbox } from './DecisionInbox'

// Persist the "last acknowledged pending count" across tab navigation
// and page refresh so amber ("new decision!") doesn't re-pin every time
// the panel re-mounts. Keyed per user+org+portfolio — using portfolioId
// alone bled across pilot clients (when portfolio_id is "all" / unset
// the key fell back to a single shared "global" bucket, so the prior
// client's watermark suppressed amber in the next client).
const ACK_KEY_PREFIX = 'decision_inbox_acknowledged_count_'
function ackKey(userId: string | undefined, orgId: string | null, portfolioId?: string) {
  const u = userId || 'anon'
  const o = orgId || 'no-org'
  const p = portfolioId || 'all'
  return `${ACK_KEY_PREFIX}${u}_${o}_${p}`
}
function readAck(userId: string | undefined, orgId: string | null, portfolioId?: string): number {
  try {
    const raw = localStorage.getItem(ackKey(userId, orgId, portfolioId))
    if (!raw) return 0
    const n = parseInt(raw, 10)
    return Number.isFinite(n) ? n : 0
  } catch { return 0 }
}
function writeAck(userId: string | undefined, orgId: string | null, portfolioId: string | undefined, n: number) {
  try { localStorage.setItem(ackKey(userId, orgId, portfolioId), String(n)) } catch { /* ignore */ }
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
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const [internalSize, setInternalSize] = useState<DrawerSize>('collapsed')
  const [resolvedPendingCount, setResolvedPendingCount] = useState<number | null>(null)
  const handlePendingCountChange = useCallback((count: number) => setResolvedPendingCount(count), [])

  // Whenever the active portfolio changes (e.g. analyst switches to a
  // new pilot client), reset the resolved count back to null so we
  // don't carry the previous portfolio's value across the boundary.
  // The inner inbox refetches and fires `onPendingCountChange` with
  // the new portfolio's number a moment later.
  useEffect(() => {
    setResolvedPendingCount(null)
  }, [portfolioId])

  // The parent passes an UNFILTERED count (`pendingCount`) derived straight
  // from decision_requests by status. DecisionInbox re-filters by permission
  // (classifyWaiting + portfolio role) and fires onPendingCountChange with
  // the corrected number.
  //
  // Display rule: prefer resolvedPendingCount once it's a positive number
  // (the authoritative permission-filtered count), but fall back to the
  // unfiltered `pendingCount` prop whenever resolved is null or 0 AND the
  // unfiltered count says there ARE pending DRs. Without the fallback, any
  // transient refetch (a re-mount, a permission-filter blip, a stale-cache
  // moment after opening the drawer) would briefly report 0 and hide the
  // badge — leaving the user thinking the count vanished.
  const displayCount =
    resolvedPendingCount != null && resolvedPendingCount > 0
      ? resolvedPendingCount
      : pendingCount > 0
        ? pendingCount
        : resolvedPendingCount

  // Track the count the user has already SEEN — the moment they open the
  // drawer, every pending row currently in the inbox is marked as
  // acknowledged. The amber "new decision" tint then only returns when
  // the count grows above that watermark (i.e. a genuinely new request
  // arrived afterwards). Persisted to localStorage so the watermark
  // survives tab navigation and page refresh — without this the amber
  // state re-pins every time the panel re-mounts, defeating the
  // acknowledgement flow.
  const [acknowledgedCount, setAcknowledgedCountState] = useState<number>(
    () => readAck(user?.id, currentOrgId, portfolioId),
  )
  // Reload the watermark when user / org / portfolio changes — each
  // (user, org, portfolio) triplet tracks independently.
  useEffect(() => {
    setAcknowledgedCountState(readAck(user?.id, currentOrgId, portfolioId))
  }, [user?.id, currentOrgId, portfolioId])
  const setAcknowledgedCount = useCallback((n: number) => {
    setAcknowledgedCountState(n)
    writeAck(user?.id, currentOrgId, portfolioId, n)
  }, [user?.id, currentOrgId, portfolioId])
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
      {/* Outer is a div+role=button instead of <button> because the
          fullscreen toggle inside is also a <button>, and nested
          buttons trip React's DOM nesting validator. We keep
          keyboard accessibility via the role and a keydown handler. */}
      <div
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            toggle()
          }
        }}
        className={clsx(
          "flex-shrink-0 flex items-center justify-between px-4 h-11 cursor-pointer transition-colors group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400",
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
      </div>

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
