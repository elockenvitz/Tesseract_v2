/**
 * FocusStack — Daily work entry point.
 *
 * Sits above the dashboard bands as a clear command list:
 *   NOW     → single highest priority item
 *   NEXT    → 2-4 next items
 *   DISCUSS → team-level items needing coordination
 *   UNBLOCK → process friction and blockers
 *
 * Not a card layout. A command list. Tight, directive, scannable.
 */

import { useMemo, useCallback, useState } from 'react'
import { clsx } from 'clsx'
import { ArrowRight, Clock, Users, AlertTriangle, MoreHorizontal } from 'lucide-react'
import type { CockpitViewModel } from '../../types/cockpit'
import type { DashboardItem } from '../../types/dashboard-item'
import type { ExecutionStats } from './ExecutionSnapshotCard'
import {
  buildFocusStack,
  buildHeroConsequence,
  type RankedDecisionItem,
  type FocusDiscussItem,
  type FocusUnblockItem,
} from '../../lib/dashboard/dashboardIntelligence'

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

const SNOOZE_OPTIONS = [
  { label: 'Later today', hours: 4 },
  { label: 'Tomorrow', hours: 24 },
  { label: 'Next week', hours: 168 },
]

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FocusStackProps {
  viewModel: CockpitViewModel
  pipelineStats: ExecutionStats
  isLoading?: boolean
  onItemClick?: (item: DashboardItem) => void
  onSnooze?: (itemId: string, hours: number) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FocusStack({
  viewModel,
  pipelineStats,
  isLoading,
  onItemClick,
  onSnooze,
}: FocusStackProps) {
  const focus = useMemo(
    () => buildFocusStack(viewModel, pipelineStats),
    [viewModel, pipelineStats],
  )

  if (isLoading || focus.isEmpty) return null

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden">
      {/* NOW */}
      {focus.now && (
        <FocusNowCard item={focus.now} onSnooze={onSnooze} />
      )}

      {/* NEXT */}
      {focus.next.length > 0 && (
        <FocusNextList items={focus.next} onItemClick={onItemClick} />
      )}

      {/* DISCUSS + UNBLOCK row */}
      {(focus.discuss.length > 0 || focus.unblock.length > 0) && (
        <div className={clsx(
          'grid gap-px bg-gray-100 dark:bg-gray-700/40',
          focus.discuss.length > 0 && focus.unblock.length > 0
            ? 'grid-cols-2'
            : 'grid-cols-1',
        )}>
          {focus.discuss.length > 0 && (
            <FocusDiscussList items={focus.discuss} onItemClick={onItemClick} />
          )}
          {focus.unblock.length > 0 && (
            <FocusUnblockList items={focus.unblock} />
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// FocusNowCard — The single most important item
// ---------------------------------------------------------------------------

function FocusNowCard({
  item,
  onSnooze,
}: {
  item: DashboardItem
  onSnooze?: (itemId: string, hours: number) => void
}) {
  const [snoozeOpen, setSnoozeOpen] = useState(false)
  const consequence = useMemo(() => buildHeroConsequence(item), [item])
  const age = item.ageDays ?? 0
  const action = item.meta?.action
  const ticker = item.asset?.ticker
  const isPairTrade = item.meta?.isPairTrade

  const displayLabel = isPairTrade && action
    ? action
    : [action, ticker].filter(Boolean).join(' ') || item.title

  const handleSnooze = useCallback((hours: number) => {
    onSnooze?.(item.id, hours)
    setSnoozeOpen(false)
  }, [item.id, onSnooze])

  return (
    <div className={clsx(
      'px-4 py-3 border-b',
      consequence.status === 'stalled' || consequence.status === 'blocked'
        ? 'border-b-red-200/60 dark:border-b-red-800/30 bg-red-50/20 dark:bg-red-950/5'
        : consequence.status === 'at risk'
          ? 'border-b-red-100/60 dark:border-b-red-800/20'
          : 'border-b-gray-100 dark:border-b-gray-700/40',
    )}>
      {/* Label row */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
          Work on now
        </span>
        <div className="flex-1 h-px bg-gray-100 dark:bg-gray-700/40" />
        <div className="flex items-center gap-1">
          <Clock className={clsx('w-3 h-3', ageColor(age))} />
          <span className={clsx('text-[11px] font-bold tabular-nums', ageColor(age))}>
            {age}d
          </span>
        </div>
      </div>

      {/* Main row: action/ticker + tension + CTA */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {/* Title line */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[16px] font-bold text-gray-900 dark:text-gray-50 leading-tight">
              {displayLabel}
            </span>
            {item.meta?.proposedWeight != null && (
              <span className="text-[12px] font-bold tabular-nums text-violet-600 dark:text-violet-400">
                {item.meta.proposedWeight.toFixed(1)}%
              </span>
            )}
            {item.portfolio?.name && (
              <span className="text-[11px] text-gray-400 dark:text-gray-500">
                {item.portfolio.name}
              </span>
            )}
          </div>

          {/* Tension */}
          <p className="text-[11px] font-medium text-gray-700 dark:text-gray-200 leading-snug">
            {consequence.tension}
          </p>
          {consequence.ifIgnored && (
            <p className="text-[10px] text-red-600/80 dark:text-red-400/70 leading-snug mt-0.5">
              {consequence.ifIgnored}
            </p>
          )}
        </div>

        {/* CTA */}
        <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
          <button
            onClick={() => item.primaryAction.onClick()}
            className={clsx(
              'flex items-center gap-1 text-[11px] font-semibold px-3 py-1.5 rounded-md transition-colors',
              consequence.status === 'stalled' || consequence.status === 'blocked' || consequence.status === 'at risk'
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-gray-900 text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200',
            )}
          >
            {item.primaryAction.label}
            <ArrowRight className="w-3 h-3" />
          </button>

          {onSnooze && (
            <div className="relative">
              <button
                onClick={() => setSnoozeOpen(!snoozeOpen)}
                className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
              >
                <MoreHorizontal className="w-3.5 h-3.5" />
              </button>
              {snoozeOpen && (
                <div className="absolute top-full right-0 mt-1 z-50 min-w-[120px] rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg py-1">
                  {SNOOZE_OPTIONS.map(opt => (
                    <button
                      key={opt.hours}
                      onClick={() => handleSnooze(opt.hours)}
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
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// FocusNextList — Next 2-4 items
// ---------------------------------------------------------------------------

function FocusNextList({
  items,
  onItemClick,
}: {
  items: RankedDecisionItem[]
  onItemClick?: (item: DashboardItem) => void
}) {
  return (
    <div className="border-b border-gray-100 dark:border-gray-700/40">
      {/* Label */}
      <div className="flex items-center gap-2 px-4 pt-2.5 pb-1">
        <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
          Next
        </span>
        <div className="flex-1 h-px bg-gray-100 dark:bg-gray-700/40" />
      </div>

      {/* Items */}
      <div>
        {items.map(ranked => {
          const { item } = ranked
          const age = item.ageDays ?? 0
          const action = item.meta?.action
          const ticker = item.asset?.ticker

          return (
            <div
              key={item.id}
              onClick={() => onItemClick?.(item)}
              className={clsx(
                'flex items-center gap-2.5 px-4 py-[6px] group transition-colors',
                onItemClick && 'cursor-pointer',
                'hover:bg-gray-50/60 dark:hover:bg-gray-700/30',
              )}
            >
              {/* Age */}
              <span className={clsx(
                'shrink-0 text-[11px] font-bold tabular-nums w-[24px] text-right',
                ageColor(age),
              )}>
                {age}d
              </span>

              {/* Action + Ticker */}
              {action && !item.meta?.isPairTrade && (
                <span className={clsx(
                  'shrink-0 text-[12px] font-bold',
                  ACTION_COLOR[action] ?? 'text-gray-500',
                )}>
                  {action}
                </span>
              )}
              {ticker && !item.meta?.isPairTrade && (
                <span className="shrink-0 text-[12px] font-bold text-blue-600 dark:text-blue-400">
                  {ticker}
                </span>
              )}
              {item.meta?.isPairTrade && action && (
                <span className="shrink-0 text-[12px] font-bold text-gray-700 dark:text-gray-200 truncate max-w-[160px]">
                  {action}
                </span>
              )}
              {item.meta?.proposedWeight != null && (
                <span className="shrink-0 text-[10px] font-bold tabular-nums text-violet-600 dark:text-violet-400">
                  {item.meta.proposedWeight.toFixed(1)}%
                </span>
              )}

              {/* Reason */}
              <span className="flex-1 min-w-0 text-[10px] text-gray-400 dark:text-gray-500 truncate">
                {ranked.priorityReason}
              </span>

              {/* CTA on hover */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  item.primaryAction.onClick()
                }}
                className="shrink-0 text-[10px] font-medium px-2 py-[2px] rounded bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600/50 opacity-0 group-hover:opacity-100 transition-all"
              >
                {item.primaryAction.label}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// FocusDiscussList — Team-level items
// ---------------------------------------------------------------------------

function FocusDiscussList({
  items,
  onItemClick,
}: {
  items: FocusDiscussItem[]
  onItemClick?: (item: DashboardItem) => void
}) {
  return (
    <div className="bg-white dark:bg-gray-800/60 px-3.5 py-2.5">
      {/* Label */}
      <div className="flex items-center gap-1.5 mb-2">
        <Users className="w-3 h-3 text-blue-400 dark:text-blue-500" />
        <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
          Discuss
        </span>
      </div>

      {/* Items */}
      <div className="space-y-1.5">
        {items.map(d => (
          <div
            key={d.id}
            className="group"
          >
            <div className="text-[11px] font-medium text-gray-700 dark:text-gray-200 leading-snug">
              {d.title}
            </div>
            <div className="text-[10px] text-gray-400 dark:text-gray-500 leading-snug">
              {d.reason}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// FocusUnblockList — Process friction
// ---------------------------------------------------------------------------

function FocusUnblockList({
  items,
}: {
  items: FocusUnblockItem[]
}) {
  return (
    <div className="bg-white dark:bg-gray-800/60 px-3.5 py-2.5">
      {/* Label */}
      <div className="flex items-center gap-1.5 mb-2">
        <AlertTriangle className="w-3 h-3 text-amber-400 dark:text-amber-500" />
        <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
          Unblock
        </span>
      </div>

      {/* Items */}
      <div className="space-y-1.5">
        {items.map(u => (
          <div
            key={u.id}
            onClick={u.onClick}
            className={clsx(
              'group',
              u.onClick && 'cursor-pointer',
            )}
          >
            <div className="flex items-center gap-1.5">
              <span className={clsx(
                'text-[10px] font-bold tabular-nums',
                u.age >= 14 ? 'text-red-600 dark:text-red-400'
                  : u.age >= 7 ? 'text-amber-600 dark:text-amber-400'
                    : 'text-gray-400 dark:text-gray-500',
              )}>
                {u.age}d
              </span>
              <span className="text-[11px] font-medium text-gray-700 dark:text-gray-200 leading-snug">
                {u.title}
              </span>
            </div>
            <div className="text-[10px] text-gray-400 dark:text-gray-500 leading-snug pl-[30px]">
              {u.reason}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
