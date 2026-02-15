/**
 * DashboardRow — Surgical-density row for the Decision Engine Console.
 *
 * Layout:
 *   Left:   severity badge + type icon + title + 1-line reason
 *   Right:  portfolio | ticker | age | owner (tight stack) + primary action
 *
 * 16px max vertical padding. Compact badges. Consistent button width.
 * Owner shown as muted text when available.
 * AWARE mode: no action button.
 */

import { useCallback } from 'react'
import { clsx } from 'clsx'
import {
  Scale,
  FlaskConical,
  FolderKanban,
  FileText,
  AlertTriangle,
  Radar,
  HelpCircle,
} from 'lucide-react'
import type {
  DashboardItem,
  DashboardSeverity,
  DashboardItemType,
} from '../../types/dashboard-item'

// ---------------------------------------------------------------------------
// Severity styling — compact
// ---------------------------------------------------------------------------

const SEV_PILL: Record<DashboardSeverity, string> = {
  HIGH: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  MED: 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-300',
  LOW: 'bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
}

const SEV_BORDER: Record<DashboardSeverity, string> = {
  HIGH: 'border-l-red-500',
  MED: 'border-l-amber-400 dark:border-l-amber-500',
  LOW: 'border-l-transparent',
}

// ---------------------------------------------------------------------------
// Type icon mapping
// ---------------------------------------------------------------------------

const TYPE_ICON: Record<DashboardItemType, React.FC<{ className?: string }>> = {
  DECISION: Scale,
  SIMULATION: FlaskConical,
  PROJECT: FolderKanban,
  THESIS: FileText,
  RATING: AlertTriangle,
  SIGNAL: Radar,
  OTHER: HelpCircle,
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface DashboardRowProps {
  item: DashboardItem
  onRowClick?: (item: DashboardItem) => void
  /** Suppress action button (AWARE band) */
  hideAction?: boolean
}

export function DashboardRow({ item, onRowClick, hideAction }: DashboardRowProps) {
  const Icon = TYPE_ICON[item.type]

  const handleRowClick = useCallback(() => {
    onRowClick?.(item)
  }, [item, onRowClick])

  return (
    <div
      onClick={handleRowClick}
      className={clsx(
        'flex items-center gap-1.5 px-3 py-[6px] group',
        'border-l-[2px]',
        SEV_BORDER[item.severity],
        onRowClick && 'cursor-pointer',
        'hover:bg-gray-50/60 dark:hover:bg-gray-800/40 transition-colors',
      )}
    >
      {/* Severity badge — compact */}
      <span
        className={clsx(
          'shrink-0 text-[8px] font-bold uppercase tracking-wider px-1 py-px rounded',
          SEV_PILL[item.severity],
        )}
      >
        {item.severity}
      </span>

      {/* Type icon */}
      <Icon className="w-3 h-3 shrink-0 text-gray-400 dark:text-gray-500" />

      {/* Title + reason */}
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-medium text-gray-800 dark:text-gray-100 leading-tight truncate">
          {item.title}
        </div>
        {item.reason && (
          <div className="text-[10px] text-gray-400 dark:text-gray-500 leading-tight truncate">
            {item.reason}
          </div>
        )}
      </div>

      {/* Right meta stack: portfolio | ticker | age | owner */}
      <div className="hidden sm:flex items-center gap-1 shrink-0">
        {item.portfolio?.name && (
          <span className="text-[8px] font-medium px-1 py-px rounded bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400 whitespace-nowrap">
            {item.portfolio.name}
          </span>
        )}
        {item.asset?.ticker && (
          <span className="text-[8px] font-medium px-1 py-px rounded bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400 whitespace-nowrap">
            {item.asset.ticker}
          </span>
        )}
        {(item.ageDays ?? 0) > 0 && (
          <span className="text-[8px] font-medium px-1 py-px rounded bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400 whitespace-nowrap tabular-nums">
            {item.ageDays}d
          </span>
        )}
        {item.owner?.name && (
          <span className="text-[9px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
            {item.owner.name}
          </span>
        )}
      </div>

      {/* Primary action — consistent width, hidden for AWARE */}
      {!hideAction && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            item.primaryAction.onClick()
          }}
          className="shrink-0 text-[10px] font-medium w-[60px] text-center py-[3px] rounded bg-gray-100 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600/50 transition-colors"
        >
          {item.primaryAction.label}
        </button>
      )}
    </div>
  )
}
