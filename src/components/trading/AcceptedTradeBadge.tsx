/**
 * AcceptedTradeBadge — Small inline badge for HoldingsSimulationTable rows.
 */

import { clsx } from 'clsx'
import type { ExecutionStatus } from '../../types/trading'

const BADGE_CONFIG: Record<ExecutionStatus, { label: string; bg: string; text: string }> = {
  not_started: {
    label: 'Accepted',
    bg: 'bg-blue-100 dark:bg-blue-900/30',
    text: 'text-blue-700 dark:text-blue-400',
  },
  in_progress: {
    label: 'In Progress',
    bg: 'bg-amber-100 dark:bg-amber-900/30',
    text: 'text-amber-700 dark:text-amber-400',
  },
  complete: {
    label: 'Complete',
    bg: 'bg-green-100 dark:bg-green-900/30',
    text: 'text-green-700 dark:text-green-400',
  },
  cancelled: {
    label: 'Cancelled',
    bg: 'bg-red-100 dark:bg-red-900/30',
    text: 'text-red-700 dark:text-red-400',
  },
}

interface AcceptedTradeBadgeProps {
  executionStatus: ExecutionStatus
  reconciliationStatus?: string
  className?: string
}

export function AcceptedTradeBadge({
  executionStatus,
  reconciliationStatus,
  className,
}: AcceptedTradeBadgeProps) {
  // Hide badge once reconciled
  if (reconciliationStatus === 'matched') return null

  const config = BADGE_CONFIG[executionStatus]

  return (
    <span
      className={clsx(
        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide',
        config.bg,
        config.text,
        className
      )}
    >
      {config.label}
    </span>
  )
}
