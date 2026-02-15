/**
 * DailyFocusSummary — One-line micro-summary at the top of the dashboard.
 *
 * "Today: 5 actions · 3 due soon · 2 signals"
 *
 * Each token is clickable and scrolls to / expands the relevant band.
 */

import { clsx } from 'clsx'
import type { BandSummary } from '../../types/attention-feed'

interface DailyFocusSummaryProps {
  nowSummary: BandSummary
  soonSummary: BandSummary
  awareSummary: BandSummary
  isLoading?: boolean
  onScrollToBand?: (band: 'now' | 'soon' | 'aware') => void
}

export function DailyFocusSummary({
  nowSummary,
  soonSummary,
  awareSummary,
  isLoading,
  onScrollToBand,
}: DailyFocusSummaryProps) {
  if (isLoading) {
    return (
      <div className="h-6 w-64 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
    )
  }

  const total = nowSummary.count + soonSummary.count + awareSummary.count

  if (total === 0) {
    return (
      <div className="text-[12px] text-gray-400 dark:text-gray-500">
        All clear. Nothing needs your attention right now.
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1 text-[12px]">
      <span className="text-gray-500 dark:text-gray-400 font-medium">Today:</span>

      {nowSummary.count > 0 && (
        <SummaryToken
          label={`${nowSummary.count} action${nowSummary.count !== 1 ? 's' : ''}`}
          className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200"
          onClick={() => onScrollToBand?.('now')}
        />
      )}

      {nowSummary.count > 0 && soonSummary.count > 0 && (
        <Dot />
      )}

      {soonSummary.count > 0 && (
        <SummaryToken
          label={`${soonSummary.count} due soon`}
          className="text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200"
          onClick={() => onScrollToBand?.('soon')}
        />
      )}

      {(nowSummary.count > 0 || soonSummary.count > 0) && awareSummary.count > 0 && (
        <Dot />
      )}

      {awareSummary.count > 0 && (
        <SummaryToken
          label={`${awareSummary.count} signal${awareSummary.count !== 1 ? 's' : ''}`}
          className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200"
          onClick={() => onScrollToBand?.('aware')}
        />
      )}
    </div>
  )
}

function SummaryToken({
  label,
  className,
  onClick,
}: {
  label: string
  className: string
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'font-semibold tabular-nums transition-colors cursor-pointer',
        className,
      )}
    >
      {label}
    </button>
  )
}

function Dot() {
  return (
    <span className="text-gray-300 dark:text-gray-600 select-none px-0.5">
      {'\u00B7'}
    </span>
  )
}
