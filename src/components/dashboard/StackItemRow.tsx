/**
 * StackItemRow — Compact item row inside an ActionStackCard.
 *
 * Layout:
 *   Line 1: [Severity dot] [Action badge] [Ticker] [Weight] [Portfolio] [Title] [Age] ... [CTA]
 *   Line 2: Contextual detail (urgency, rationale, overdue, rating change, reason)
 */

import { useCallback } from 'react'
import { clsx } from 'clsx'
import type { DashboardItem, DashboardSeverity } from '../../types/dashboard-item'

// ---------------------------------------------------------------------------
// Age badge colors
// ---------------------------------------------------------------------------

// Age badge color — proposals use pure age, others use severity
const SEV_AGE: Record<DashboardSeverity, string> = {
  HIGH: 'text-red-600 dark:text-red-400',
  MED: 'text-amber-600 dark:text-amber-400',
  LOW: 'text-gray-400 dark:text-gray-500',
}

function proposalAgeBadgeColor(days: number): string {
  if (days >= 10) return 'text-red-600 dark:text-red-400'
  if (days >= 5) return 'text-amber-600 dark:text-amber-400'
  return 'text-gray-400 dark:text-gray-500'
}

// ---------------------------------------------------------------------------
// Impact badge colors (for DECIDE band items)
// ---------------------------------------------------------------------------

const IMPACT_BADGE: Record<DashboardSeverity, string> = {
  HIGH: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
  MED: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
  LOW: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
}

const IMPACT_LABEL: Record<DashboardSeverity, string> = {
  HIGH: 'High',
  MED: 'Med',
  LOW: 'Low',
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

function getActionColor(action: string): string {
  if (ACTION_COLOR[action]) return ACTION_COLOR[action]
  return 'text-gray-500 dark:text-gray-400'
}

const TICKER_COLOR = 'text-blue-600 dark:text-blue-400'

/**
 * Parse a pair trade action string like "Buy LLY, PFE / Sell CLOV, GH"
 * into colored segments: action words (Buy/Sell) + tickers (blue).
 */
function parsePairAction(action: string): { text: string; color: string }[] {
  // Pattern: "Buy TICK1, TICK2 / Sell TICK3, TICK4"
  const segments: { text: string; color: string }[] = []
  const parts = action.split(' / ')
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) segments.push({ text: ' / ', color: 'text-gray-400 dark:text-gray-500' })
    const part = parts[i].trim()
    const spaceIdx = part.indexOf(' ')
    if (spaceIdx > 0) {
      const verb = part.slice(0, spaceIdx)
      const tickers = part.slice(spaceIdx)
      segments.push({ text: verb, color: getActionColor(verb) })
      segments.push({ text: tickers, color: TICKER_COLOR })
    } else {
      segments.push({ text: part, color: getActionColor(part) })
    }
  }
  return segments
}

// ---------------------------------------------------------------------------
// Build contextual detail line from item meta + reason
// ---------------------------------------------------------------------------

function buildDetailLine(item: DashboardItem): string | null {
  const meta = item.meta
  const parts: string[] = []

  // Action is shown on line 1, skip it here

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
  /** Show impact badge (High/Med/Low) — enabled for DECIDE band items */
  showImpact?: boolean
  /** Optional trailing label shown after the title (e.g. deliverable count) */
  trailingBadge?: string
}

export function StackItemRow({ item, onItemClick, hideAction, showImpact, trailingBadge }: StackItemRowProps) {
  const handleClick = useCallback(() => {
    onItemClick?.(item)
  }, [item, onItemClick])

  const detail = buildDetailLine(item)
  const isProposal = item.id.startsWith('a1-proposal')
  const isOverdueProject = item.type === 'PROJECT' && (
    (item.meta?.overdueDays != null && item.meta.overdueDays > 0) ||
    item.contextChips?.some(c => c.toLowerCase().includes('overdue'))
  )

  return (
    <div
      onClick={handleClick}
      className={clsx(
        'flex items-start gap-2 px-3 py-[6px] group',
        onItemClick && 'cursor-pointer',
        'hover:bg-gray-50/60 dark:hover:bg-gray-700/30 transition-colors',
      )}
    >
      {/* Colored age badge — proposals use age-based color, others use severity */}
      {/* Deliverables show overdue days instead of item age */}
      <span className={clsx(
        'shrink-0 text-[11px] font-bold tabular-nums mt-[1px] whitespace-nowrap',
        isProposal ? proposalAgeBadgeColor(item.ageDays ?? 0) : SEV_AGE[item.severity],
      )}>
        {(item.meta?.overdueDays != null && item.meta.overdueDays > 0)
          ? `${item.meta.overdueDays}d`
          : `${item.ageDays ?? 0}d`}
      </span>

      {/* Impact badge (DECIDE band only) */}
      {showImpact && (
        <span className={clsx(
          'shrink-0 text-[9px] font-bold uppercase tracking-wide px-1 py-px rounded mt-[2px]',
          IMPACT_BADGE[item.severity],
        )}>
          {IMPACT_LABEL[item.severity]}
        </span>
      )}

      {/* Content block */}
      <div className="flex-1 min-w-0">
        {/* Line 1: Action, Ticker, Weight, Portfolio, Title, Age */}
        <div className="flex items-center gap-1.5">
          {/* Action badge — pair trades get multi-colored segments */}
          {item.meta?.action && (
            item.meta.isPairTrade ? (
              <span className="shrink-0 text-[12px] font-bold whitespace-nowrap">
                {parsePairAction(item.meta.action).map((seg, i) => (
                  <span key={i} className={seg.color}>{seg.text}</span>
                ))}
              </span>
            ) : (
              <span className={clsx(
                'shrink-0 text-[12px] font-bold whitespace-nowrap',
                getActionColor(item.meta.action),
              )}>
                {item.meta.action}
              </span>
            )
          )}

          {/* Ticker — hidden for pair trades (already in action label) */}
          {item.asset?.ticker && !item.meta?.isPairTrade && (
            <span className="shrink-0 text-[12px] font-bold text-blue-600 dark:text-blue-400 whitespace-nowrap">
              {item.asset.ticker}
            </span>
          )}

          {/* Proposed weight badge */}
          {item.meta?.proposedWeight != null && (
            <span className="shrink-0 text-[12px] font-bold tabular-nums whitespace-nowrap text-violet-600 dark:text-violet-400">
              {item.meta.proposedWeight.toFixed(1)}%
            </span>
          )}

          {item.portfolio?.name && (
            <span className="shrink-0 text-[12px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
              {item.portfolio.name}
            </span>
          )}

          <span className={clsx(
            'flex-1 min-w-0 text-[11px] truncate',
            isOverdueProject
              ? 'text-gray-700 dark:text-gray-200 font-medium'
              : 'text-gray-400 dark:text-gray-500',
          )}>
            {item.title}
          </span>

          {trailingBadge && (
            <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500 tabular-nums whitespace-nowrap">
              {trailingBadge}
            </span>
          )}

        </div>

        {/* Line 2: Contextual detail */}
        {detail && (
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate leading-tight">
              {detail}
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
