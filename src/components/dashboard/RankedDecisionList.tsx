/**
 * RankedDecisionList — Numbered, ranked stack of DECIDE items.
 *
 * Shows items ranked by composite priority score with:
 *   - Position number (rank)
 *   - Action badge + ticker
 *   - Priority reason (synthesized)
 *   - Age with severity coloring
 *   - Portfolio
 *   - CTA
 *   - Snooze on hover
 *
 * Progressive disclosure: shows top N, then "Show all" toggle.
 * Visually distinguishes top 3 from the rest.
 */

import { useState, useCallback } from 'react'
import { clsx } from 'clsx'
import { ChevronDown, ChevronUp, Clock, MoreHorizontal } from 'lucide-react'
import type { RankedDecisionItem } from '../../lib/dashboard/dashboardIntelligence'
import type { DashboardItem } from '../../types/dashboard-item'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PREVIEW_COUNT = 3
const TOP_TIER_COUNT = 3

const SNOOZE_OPTIONS = [
  { label: 'Later today', hours: 4 },
  { label: 'Tomorrow', hours: 24 },
  { label: 'Next week', hours: 168 },
]

// ---------------------------------------------------------------------------
// Action colors
// ---------------------------------------------------------------------------

const ACTION_COLOR: Record<string, string> = {
  Buy: 'text-emerald-600 dark:text-emerald-400',
  Add: 'text-emerald-600 dark:text-emerald-400',
  Sell: 'text-red-600 dark:text-red-400',
  Trim: 'text-red-600 dark:text-red-400',
}

function ageColor(days: number): string {
  if (days >= 10) return 'text-red-600 dark:text-red-400'
  if (days >= 5) return 'text-amber-600 dark:text-amber-400'
  return 'text-gray-400 dark:text-gray-500'
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RankedDecisionListProps {
  /** Pre-ranked items (hero item already removed) */
  items: RankedDecisionItem[]
  onItemClick?: (item: DashboardItem) => void
  onSnooze?: (itemId: string, hours: number) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RankedDecisionList({
  items,
  onItemClick,
  onSnooze,
}: RankedDecisionListProps) {
  const [expanded, setExpanded] = useState(false)

  if (items.length === 0) return null

  const visible = expanded ? items : items.slice(0, PREVIEW_COUNT)
  const hasMore = items.length > PREVIEW_COUNT

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-gray-100 dark:border-gray-700/40">
        <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          Next up
        </span>
        <span className="text-[11px] font-bold text-gray-400 dark:text-gray-500 tabular-nums">
          {items.length} awaiting decision
        </span>
      </div>

      {/* Rows */}
      <div className="divide-y divide-gray-50 dark:divide-gray-700/30">
        {visible.map(ranked => (
          <DecisionRow
            key={ranked.item.id}
            ranked={ranked}
            isTopTier={ranked.rank <= TOP_TIER_COUNT + 1} // +1 because hero is rank 1
            onItemClick={onItemClick}
            onSnooze={onSnooze}
          />
        ))}
      </div>

      {/* Expand toggle */}
      {hasMore && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50/50 dark:hover:bg-gray-700/20 transition-colors border-t border-gray-100 dark:border-gray-700/40"
        >
          {expanded ? (
            <>
              <ChevronUp className="w-3 h-3" />
              Collapse
            </>
          ) : (
            <>
              <ChevronDown className="w-3 h-3" />
              +{items.length - PREVIEW_COUNT} more decisions
            </>
          )}
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// DecisionRow
// ---------------------------------------------------------------------------

function DecisionRow({
  ranked,
  isTopTier,
  onItemClick,
  onSnooze,
}: {
  ranked: RankedDecisionItem
  isTopTier: boolean
  onItemClick?: (item: DashboardItem) => void
  onSnooze?: (itemId: string, hours: number) => void
}) {
  const [snoozeOpen, setSnoozeOpen] = useState(false)
  const { item, rank, priorityReason } = ranked
  const age = item.ageDays ?? 0
  const action = item.meta?.action
  const ticker = item.asset?.ticker

  const handleClick = useCallback(() => {
    onItemClick?.(item)
  }, [item, onItemClick])

  const handleSnooze = useCallback((hours: number) => {
    onSnooze?.(item.id, hours)
    setSnoozeOpen(false)
  }, [item.id, onSnooze])

  return (
    <div
      onClick={handleClick}
      className={clsx(
        'flex items-center gap-2.5 px-3.5 group transition-colors',
        onItemClick && 'cursor-pointer',
        isTopTier ? 'py-[7px]' : 'py-[5px]',
        'hover:bg-gray-50/60 dark:hover:bg-gray-700/30',
      )}
    >
      {/* Rank */}
      <span className={clsx(
        'shrink-0 tabular-nums font-bold text-right',
        isTopTier ? 'text-[13px] w-5' : 'text-[11px] w-5',
        rank <= TOP_TIER_COUNT + 1
          ? 'text-gray-400 dark:text-gray-500'
          : 'text-gray-300 dark:text-gray-600',
      )}>
        {rank}
      </span>

      {/* Age */}
      <span className={clsx(
        'shrink-0 text-[11px] font-bold tabular-nums',
        ageColor(age),
      )}>
        {age}d
      </span>

      {/* Action + Ticker */}
      <div className="flex items-center gap-1.5 shrink-0">
        {action && !item.meta?.isPairTrade && (
          <span className={clsx(
            'text-[12px] font-bold whitespace-nowrap',
            ACTION_COLOR[action] ?? 'text-gray-500 dark:text-gray-400',
          )}>
            {action}
          </span>
        )}
        {ticker && !item.meta?.isPairTrade && (
          <span className="text-[12px] font-bold text-blue-600 dark:text-blue-400 whitespace-nowrap">
            {ticker}
          </span>
        )}
        {item.meta?.isPairTrade && action && (
          <span className="text-[12px] font-bold text-gray-700 dark:text-gray-200 whitespace-nowrap truncate max-w-[180px]">
            {action}
          </span>
        )}
        {item.meta?.proposedWeight != null && (
          <span className="text-[11px] font-bold tabular-nums text-violet-600 dark:text-violet-400">
            {item.meta.proposedWeight.toFixed(1)}%
          </span>
        )}
      </div>

      {/* Priority factors */}
      <span className={clsx(
        'flex-1 min-w-0 truncate',
        isTopTier ? 'text-[11px] text-gray-500 dark:text-gray-400' : 'text-[10px] text-gray-400 dark:text-gray-500',
      )}>
        {priorityReason}
      </span>

      {/* CTA */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          item.primaryAction.onClick()
        }}
        className={clsx(
          'shrink-0 text-[11px] font-medium px-2.5 py-[3px] rounded transition-colors',
          'bg-gray-100 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300',
          'hover:bg-gray-200 dark:hover:bg-gray-600/50',
          'opacity-0 group-hover:opacity-100',
        )}
      >
        {item.primaryAction.label}
      </button>

      {/* Snooze */}
      {onSnooze && (
        <div className="relative shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setSnoozeOpen(!snoozeOpen)
            }}
            className="p-1 rounded text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 opacity-0 group-hover:opacity-100 transition-all"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>

          {snoozeOpen && (
            <div className="absolute top-full right-0 mt-1 z-50 min-w-[120px] rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg py-1">
              {SNOOZE_OPTIONS.map(opt => (
                <button
                  key={opt.hours}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleSnooze(opt.hours)
                  }}
                  className="w-full text-left px-3 py-1.5 text-[11px] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
