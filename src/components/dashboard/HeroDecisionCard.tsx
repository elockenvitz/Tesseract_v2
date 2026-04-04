/**
 * HeroDecisionCard — Featured top-priority decision.
 *
 * Large-format card showing the single most important decision:
 *   - Action badge (Buy/Sell/Trim/Add) with color
 *   - Ticker + company name
 *   - Portfolio
 *   - Age with severity coloring
 *   - Rationale excerpt
 *   - Clear CTAs: primary action + snooze
 *
 * This is the "start here" anchor of the entire dashboard.
 */

import { useCallback, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { ArrowRight, Clock, MoreHorizontal } from 'lucide-react'
import type { DashboardItem } from '../../types/dashboard-item'
import { buildHeroConsequence } from '../../lib/dashboard/dashboardIntelligence'

// ---------------------------------------------------------------------------
// Action colors
// ---------------------------------------------------------------------------

const ACTION_STYLE: Record<string, { text: string; bg: string; border: string }> = {
  Buy: {
    text: 'text-emerald-700 dark:text-emerald-300',
    bg: 'bg-emerald-50 dark:bg-emerald-900/20',
    border: 'border-emerald-200 dark:border-emerald-800/40',
  },
  Add: {
    text: 'text-emerald-700 dark:text-emerald-300',
    bg: 'bg-emerald-50 dark:bg-emerald-900/20',
    border: 'border-emerald-200 dark:border-emerald-800/40',
  },
  Sell: {
    text: 'text-red-700 dark:text-red-300',
    bg: 'bg-red-50 dark:bg-red-900/20',
    border: 'border-red-200 dark:border-red-800/40',
  },
  Trim: {
    text: 'text-red-700 dark:text-red-300',
    bg: 'bg-red-50 dark:bg-red-900/20',
    border: 'border-red-200 dark:border-red-800/40',
  },
}

const DEFAULT_ACTION_STYLE = {
  text: 'text-gray-700 dark:text-gray-300',
  bg: 'bg-gray-50 dark:bg-gray-800',
  border: 'border-gray-200 dark:border-gray-700',
}

// ---------------------------------------------------------------------------
// Age severity
// ---------------------------------------------------------------------------

function ageColor(days: number): string {
  if (days >= 10) return 'text-red-600 dark:text-red-400'
  if (days >= 5) return 'text-amber-600 dark:text-amber-400'
  return 'text-gray-500 dark:text-gray-400'
}

// ---------------------------------------------------------------------------
// Snooze menu
// ---------------------------------------------------------------------------

const SNOOZE_OPTIONS = [
  { label: 'Later today', hours: 4 },
  { label: 'Tomorrow', hours: 24 },
  { label: 'Next week', hours: 168 },
]

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface HeroDecisionCardProps {
  item: DashboardItem
  onSnooze?: (itemId: string, hours: number) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  stalled: { label: 'Stalled', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  'at risk': { label: 'At Risk', cls: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' },
  blocked: { label: 'Blocked', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  misaligned: { label: 'Misaligned', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  aging: { label: 'Aging', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  open: { label: '', cls: '' },
}

export function HeroDecisionCard({ item, onSnooze }: HeroDecisionCardProps) {
  const [snoozeOpen, setSnoozeOpen] = useState(false)
  const age = item.ageDays ?? 0
  const action = item.meta?.action
  const actionStyle = action ? (ACTION_STYLE[action] ?? DEFAULT_ACTION_STYLE) : null
  const ticker = item.asset?.ticker
  const isPairTrade = item.meta?.isPairTrade

  const consequence = useMemo(() => buildHeroConsequence(item), [item])

  const handlePrimary = useCallback(() => {
    item.primaryAction.onClick()
  }, [item])

  const handleSnooze = useCallback((hours: number) => {
    onSnooze?.(item.id, hours)
    setSnoozeOpen(false)
  }, [item.id, onSnooze])

  const displayTitle = isPairTrade && action
    ? action
    : ticker
      ? ticker
      : item.title

  const subtitle = isPairTrade
    ? item.title
    : item.asset?.name || item.title

  const statusBadge = STATUS_BADGE[consequence.status]

  return (
    <div className={clsx(
      'relative rounded-lg border overflow-hidden',
      'bg-white dark:bg-gray-800/60',
      consequence.status === 'stalled' || consequence.status === 'blocked'
        ? 'border-red-300/80 dark:border-red-800/40'
        : consequence.status === 'at risk'
          ? 'border-red-200/80 dark:border-red-800/30'
          : 'border-gray-200 dark:border-gray-700',
    )}>
      {/* Top accent bar */}
      <div className={clsx(
        'h-[2px]',
        consequence.status === 'stalled' || consequence.status === 'blocked' ? 'bg-red-600'
          : consequence.status === 'at risk' ? 'bg-red-500'
            : consequence.status === 'aging' ? 'bg-amber-400'
              : 'bg-gray-300 dark:bg-gray-600',
      )} />

      <div className="px-4 py-3">
        {/* Row 1: Start Here + status badge + age */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
              Start here
            </span>
            {statusBadge.label && (
              <span className={clsx('text-[9px] font-bold uppercase tracking-wider px-1.5 py-px rounded', statusBadge.cls)}>
                {statusBadge.label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Clock className={clsx('w-3 h-3', ageColor(age))} />
            <span className={clsx('text-[11px] font-bold tabular-nums', ageColor(age))}>
              {age}d
            </span>
          </div>
        </div>

        {/* Row 2: Action + Ticker/Title */}
        <div className="flex items-center gap-2.5 mb-1">
          {actionStyle && action && (
            <span className={clsx(
              'text-[13px] font-bold px-2 py-0.5 rounded border',
              actionStyle.text,
              actionStyle.bg,
              actionStyle.border,
            )}>
              {action}
            </span>
          )}
          <span className="text-[20px] font-bold text-gray-900 dark:text-gray-50 leading-tight">
            {displayTitle}
          </span>
          {item.meta?.proposedWeight != null && (
            <span className="text-[14px] font-bold tabular-nums text-violet-600 dark:text-violet-400">
              {item.meta.proposedWeight.toFixed(1)}%
            </span>
          )}
        </div>

        {/* Row 3: Subtitle + Portfolio */}
        <div className="flex items-center gap-2 mb-2">
          {subtitle !== displayTitle && (
            <span className="text-[12px] text-gray-500 dark:text-gray-400 truncate">
              {subtitle}
            </span>
          )}
          {item.portfolio?.name && (
            <>
              {subtitle !== displayTitle && <span className="text-gray-300 dark:text-gray-600">\u00B7</span>}
              <span className="text-[12px] font-medium text-gray-500 dark:text-gray-400">
                {item.portfolio.name}
              </span>
            </>
          )}
        </div>

        {/* Row 4: Why #1 + tension + consequence */}
        <div className="mb-2.5">
          {/* Why this is top priority — short factor fragments */}
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              Why #1
            </span>
            <div className="flex items-center gap-1">
              {consequence.whyFirst.map((factor, i) => (
                <span key={i} className="text-[10px] font-medium text-gray-500 dark:text-gray-400">
                  {i > 0 && <span className="text-gray-300 dark:text-gray-600 mr-1">/</span>}
                  {factor}
                </span>
              ))}
            </div>
          </div>

          <p className="text-[12px] font-medium text-gray-800 dark:text-gray-100 leading-snug">
            {consequence.tension}
          </p>
          {consequence.ifIgnored && (
            <p className="text-[11px] text-red-600/90 dark:text-red-400/80 leading-snug mt-0.5">
              {consequence.ifIgnored}
            </p>
          )}
        </div>

        {/* Row 6: CTAs */}
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrimary}
            className={clsx(
              'flex items-center gap-1.5 text-[12px] font-semibold px-3.5 py-1.5 rounded-md transition-colors',
              consequence.status === 'stalled' || consequence.status === 'blocked' || consequence.status === 'at risk'
                ? 'bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-500'
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
                className="flex items-center gap-1 text-[11px] font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 px-2 py-1.5 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
              >
                <MoreHorizontal className="w-3.5 h-3.5" />
                Defer
              </button>

              {snoozeOpen && (
                <div className="absolute top-full left-0 mt-1 z-50 min-w-[140px] rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg py-1">
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
