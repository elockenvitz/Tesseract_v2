/**
 * AttentionBand — Collapsible accordion section for the dashboard.
 *
 * Shows a summary header with count + oldest age + breakdown.
 * Expands to show items via AttentionRow (max 8 by default).
 * "View all" button at bottom if more items exist.
 */

import { useState, useCallback } from 'react'
import { clsx } from 'clsx'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { AttentionRow } from './AttentionRow'
import type { AttentionFeedItem, AttentionBand as BandType, BandSummary } from '../../types/attention-feed'

// ---------------------------------------------------------------------------
// Band styling
// ---------------------------------------------------------------------------

const BAND_STYLE: Record<BandType, {
  container: string
  headerBg: string
  title: string
  badge: string
  accent: string
  icon: string
}> = {
  now: {
    container: 'border-l-[3px] border-l-red-500 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden',
    headerBg: 'bg-red-50/30 dark:bg-red-950/10',
    title: 'text-gray-900 dark:text-gray-50',
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    accent: 'text-red-500',
    icon: 'text-red-400 dark:text-red-500',
  },
  soon: {
    container: 'rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden',
    headerBg: '',
    title: 'text-gray-800 dark:text-gray-100',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    accent: 'text-amber-500',
    icon: 'text-gray-400 dark:text-gray-500',
  },
  aware: {
    container: 'rounded-lg border border-blue-100/50 dark:border-blue-900/30 bg-gradient-to-br from-blue-50/30 via-white to-white dark:from-slate-800/80 dark:via-gray-800/60 dark:to-gray-800/60 overflow-hidden',
    headerBg: '',
    title: 'text-gray-700 dark:text-gray-200',
    badge: 'bg-blue-100/80 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    accent: 'text-blue-500',
    icon: 'text-blue-400 dark:text-blue-500',
  },
}

const BAND_TITLE: Record<BandType, string> = {
  now: 'NOW \u2014 Requires Action',
  soon: 'SOON \u2014 Needs Progress',
  aware: 'AWARE \u2014 Intelligence Radar',
}

const BAND_SUBTITLE: Record<BandType, string> = {
  now: 'Items blocking progress or requiring a decision.',
  soon: 'Work that needs forward motion.',
  aware: 'Emerging signals across your coverage.',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const MAX_VISIBLE = 8

interface AttentionBandProps {
  bandKey: BandType
  items: AttentionFeedItem[]
  summary: BandSummary
  defaultExpanded?: boolean
  onViewAll?: () => void
  onSnooze: (itemId: string, hours: number) => void
  onMarkDone?: (deliverableId: string) => void
  onNavigate?: (item: AttentionFeedItem) => void
  /** Band element ID for scroll-to-band */
  id?: string
}

export function AttentionBand({
  bandKey,
  items,
  summary,
  defaultExpanded = false,
  onViewAll,
  onSnooze,
  onMarkDone,
  onNavigate,
  id,
}: AttentionBandProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const style = BAND_STYLE[bandKey]
  const hasItems = items.length > 0
  const visibleItems = expanded ? items.slice(0, MAX_VISIBLE) : []
  const hiddenCount = items.length - MAX_VISIBLE

  const toggleExpanded = useCallback(() => {
    setExpanded(e => !e)
  }, [])

  if (!hasItems) {
    return (
      <div id={id} className={style.container}>
        <div className={clsx('flex items-center gap-2.5 px-4 py-3', style.headerBg)}>
          <ChevronRight className={clsx('w-3.5 h-3.5', style.icon)} />
          <h2 className={clsx('text-[13px] font-semibold', style.title)}>
            {BAND_TITLE[bandKey]}
          </h2>
          <div className="flex-1" />
          <span className="text-[11px] text-gray-400 dark:text-gray-500 italic">
            All clear
          </span>
        </div>
      </div>
    )
  }

  return (
    <div id={id} className={style.container}>
      {/* Header */}
      <button
        onClick={toggleExpanded}
        className={clsx(
          'w-full flex items-center gap-2.5 px-4 py-3 text-left',
          'border-b border-gray-100 dark:border-gray-700/50',
          'hover:bg-gray-50/30 dark:hover:bg-gray-800/20 transition-colors',
          style.headerBg,
        )}
      >
        {expanded ? (
          <ChevronDown className={clsx('w-3.5 h-3.5 shrink-0', style.icon)} />
        ) : (
          <ChevronRight className={clsx('w-3.5 h-3.5 shrink-0', style.icon)} />
        )}

        <h2 className={clsx('text-[13px] font-semibold', style.title)}>
          {BAND_TITLE[bandKey]}
        </h2>

        {/* Count badge */}
        <span className={clsx(
          'text-[11px] font-bold px-1.5 py-0.5 rounded-full tabular-nums min-w-[20px] text-center',
          style.badge,
        )}>
          {summary.count}
        </span>

        {/* Summary breakdown */}
        {summary.breakdown && (
          <span className="hidden sm:inline text-[10px] text-gray-400 dark:text-gray-500 truncate">
            {summary.breakdown}
          </span>
        )}

        <div className="flex-1" />

        {/* Oldest age */}
        {summary.oldestAgeDays > 0 && (
          <span className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums shrink-0">
            oldest {summary.oldestAgeDays}d
          </span>
        )}

        {/* Next due (SOON band) */}
        {bandKey === 'soon' && summary.nextDueAt && (
          <span className="text-[10px] text-amber-500 dark:text-amber-400 tabular-nums shrink-0">
            next due {formatRelativeDate(summary.nextDueAt)}
          </span>
        )}
      </button>

      {/* Subtitle */}
      {expanded && (
        <div className="px-4 py-1.5 text-[10px] text-gray-400 dark:text-gray-500 border-b border-gray-100/50 dark:border-gray-700/30">
          {BAND_SUBTITLE[bandKey]}
        </div>
      )}

      {/* Items */}
      {expanded && (
        <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
          {visibleItems.map(item => (
            <AttentionRow
              key={item.id}
              item={item}
              onSnooze={onSnooze}
              onMarkDone={onMarkDone}
              onNavigate={onNavigate}
            />
          ))}

          {/* View all / more items */}
          {hiddenCount > 0 && (
            <div className="px-4 py-2 text-center">
              <button
                onClick={onViewAll}
                className="text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              >
                View all {items.length} items
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const days = Math.ceil((date.getTime() - now.getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `in ${days}d`
}
