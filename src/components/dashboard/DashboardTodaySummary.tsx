/**
 * DashboardTodaySummary — Decision Load strip.
 *
 * Compact categorized summary:
 *   Decision Load Today
 *   • 7 Decisions  • 6 Work Items  • 1 Risk Signal
 *
 * Each count clickable → filters/scrolls to relevant items.
 * Subtle, not loud.
 */

import { clsx } from 'clsx'
import type { DecisionLoadSummary } from '../../lib/dashboard/mapGdeToDashboardItems'

interface DashboardTodaySummaryProps {
  summary: DecisionLoadSummary
  isLoading?: boolean
  onScrollToBand?: (band: 'NOW' | 'SOON' | 'AWARE') => void
}

export function DashboardTodaySummary({
  summary,
  isLoading,
  onScrollToBand,
}: DashboardTodaySummaryProps) {
  if (isLoading) {
    return (
      <div className="h-4 w-48 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
    )
  }

  const total = summary.decisions + summary.workItems + summary.riskSignals

  if (total === 0) {
    return (
      <div className="text-[11px] text-gray-400 dark:text-gray-500">
        All clear. No items require attention.
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 text-[11px]">
      <span className="text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide text-[10px]">
        Decision Load
      </span>

      {summary.decisions > 0 && (
        <button
          onClick={() => onScrollToBand?.('NOW')}
          className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors tabular-nums"
        >
          <span className="font-semibold">{summary.decisions}</span>
          <span className="text-gray-400 dark:text-gray-500 ml-0.5">
            Decision{summary.decisions !== 1 ? 's' : ''}
          </span>
        </button>
      )}

      {summary.workItems > 0 && (
        <>
          {summary.decisions > 0 && <Dot />}
          <button
            onClick={() => onScrollToBand?.('SOON')}
            className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors tabular-nums"
          >
            <span className="font-semibold">{summary.workItems}</span>
            <span className="text-gray-400 dark:text-gray-500 ml-0.5">
              Work Item{summary.workItems !== 1 ? 's' : ''}
            </span>
          </button>
        </>
      )}

      {summary.riskSignals > 0 && (
        <>
          {(summary.decisions > 0 || summary.workItems > 0) && <Dot />}
          <button
            onClick={() => onScrollToBand?.('AWARE')}
            className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors tabular-nums"
          >
            <span className="font-semibold">{summary.riskSignals}</span>
            <span className="text-gray-400 dark:text-gray-500 ml-0.5">
              Risk Signal{summary.riskSignals !== 1 ? 's' : ''}
            </span>
          </button>
        </>
      )}
    </div>
  )
}

function Dot() {
  return (
    <span className="text-gray-300 dark:text-gray-600 select-none">
      {'\u00B7'}
    </span>
  )
}
