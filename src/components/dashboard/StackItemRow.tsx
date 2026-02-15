/**
 * StackItemRow — Compact item row inside an ActionStackCard.
 *
 * Layout:
 *   Line 1: [Severity dot] [Age] [Ticker bold colored] [Portfolio text] [Title] ... [CTA]
 *   Line 2: Contextual detail (action, rationale, overdue, rating change, reason)
 */

import { useCallback } from 'react'
import { clsx } from 'clsx'
import type { DashboardItem, DashboardSeverity } from '../../types/dashboard-item'

// ---------------------------------------------------------------------------
// Severity dot colors
// ---------------------------------------------------------------------------

const SEV_DOT: Record<DashboardSeverity, string> = {
  HIGH: 'bg-red-500',
  MED: 'bg-amber-400',
  LOW: 'bg-gray-300 dark:bg-gray-600',
}

// ---------------------------------------------------------------------------
// Action color
// ---------------------------------------------------------------------------

const ACTION_COLOR: Record<string, string> = {
  Buy: 'text-emerald-600 dark:text-emerald-400',
  Add: 'text-emerald-600 dark:text-emerald-400',
  Sell: 'text-red-600 dark:text-red-400',
  Trim: 'text-red-600 dark:text-red-400',
}

// ---------------------------------------------------------------------------
// Build contextual detail line from item meta + reason
// ---------------------------------------------------------------------------

function buildDetailLine(item: DashboardItem): string | null {
  const meta = item.meta
  const parts: string[] = []

  // Action
  if (meta?.action) {
    parts.push(meta.action)
  }

  // Urgency
  if (meta?.urgency && meta.urgency !== 'low') {
    parts.push(`${meta.urgency} urgency`)
  }

  // Rating change
  if (meta?.ratingFrom && meta?.ratingTo) {
    parts.push(`${meta.ratingFrom} \u2192 ${meta.ratingTo}`)
  }

  // Overdue
  if (meta?.overdueDays != null && meta.overdueDays > 0) {
    parts.push(`${meta.overdueDays}d overdue`)
  }

  // Project name
  if (meta?.projectName) {
    parts.push(meta.projectName)
  }

  // Rationale (truncated)
  if (meta?.rationale) {
    const truncated = meta.rationale.length > 80
      ? meta.rationale.slice(0, 77) + '...'
      : meta.rationale
    parts.push(truncated)
  }

  // Fall back to reason if no meta
  if (parts.length === 0 && item.reason) {
    return item.reason
  }

  return parts.length > 0 ? parts.join(' \u00B7 ') : null
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface StackItemRowProps {
  item: DashboardItem
  onItemClick?: (item: DashboardItem) => void
  hideAction?: boolean
}

export function StackItemRow({ item, onItemClick, hideAction }: StackItemRowProps) {
  const handleClick = useCallback(() => {
    onItemClick?.(item)
  }, [item, onItemClick])

  const detail = buildDetailLine(item)

  return (
    <div
      onClick={handleClick}
      className={clsx(
        'flex items-start gap-2 px-3 py-[6px] group',
        onItemClick && 'cursor-pointer',
        'hover:bg-gray-50/60 dark:hover:bg-gray-700/30 transition-colors',
      )}
    >
      {/* Severity dot — vertically centered with first line */}
      <span className={clsx('shrink-0 w-1.5 h-1.5 rounded-full mt-[5px]', SEV_DOT[item.severity])} />

      {/* Content block */}
      <div className="flex-1 min-w-0">
        {/* Line 1: Age, Ticker, Portfolio, Title */}
        <div className="flex items-center gap-2">
          {(item.ageDays ?? 0) > 0 && (
            <span className="shrink-0 text-[11px] text-gray-400 dark:text-gray-500 tabular-nums whitespace-nowrap">
              {item.ageDays}d
            </span>
          )}

          {item.asset?.ticker && (
            <span className="shrink-0 text-[12px] font-bold text-blue-600 dark:text-blue-400 whitespace-nowrap">
              {item.asset.ticker}
            </span>
          )}

          {item.portfolio?.name && (
            <span className="shrink-0 text-[11px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
              {item.portfolio.name}
            </span>
          )}

          <span className="flex-1 min-w-0 text-[12px] text-gray-700 dark:text-gray-200 truncate">
            {item.title}
          </span>
        </div>

        {/* Line 2: Contextual detail */}
        {detail && (
          <div className="flex items-center gap-1.5 mt-0.5">
            {/* Action badge inline if present */}
            {item.meta?.action && (
              <span className={clsx(
                'text-[10px] font-semibold whitespace-nowrap',
                ACTION_COLOR[item.meta.action] ?? 'text-gray-500 dark:text-gray-400',
              )}>
                {item.meta.action}
              </span>
            )}
            <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate leading-tight">
              {/* Show detail but skip redundant action word */}
              {item.meta?.action
                ? detail.replace(new RegExp(`^${item.meta.action}(\\s*\\u00B7\\s*)?`), '')
                : detail}
            </span>
          </div>
        )}
      </div>

      {/* Primary action — compact */}
      {!hideAction && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            item.primaryAction.onClick()
          }}
          className="shrink-0 text-[11px] font-medium w-[64px] text-center py-[3px] rounded bg-gray-100 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600/50 transition-colors mt-[1px]"
        >
          {item.primaryAction.label}
        </button>
      )}
    </div>
  )
}
