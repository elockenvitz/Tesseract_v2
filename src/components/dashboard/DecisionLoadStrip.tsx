/**
 * DecisionLoadStrip — Replaces DashboardTodaySummary.
 *
 * Format:
 *   Decision Load  Decisions: 7 · Work: 6 · Signals: 1 · Oldest: 13d
 *
 * Each count clickable → scrolls to relevant band.
 * Oldest colored: red if >7d, amber if >3d.
 */

import type { CockpitSummary, CockpitBand } from '../../types/cockpit'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface DecisionLoadStripProps {
  summary: CockpitSummary
  isLoading?: boolean
  onScrollToBand?: (band: CockpitBand) => void
}

export function DecisionLoadStrip({
  summary,
  isLoading,
  onScrollToBand,
}: DecisionLoadStripProps) {
  if (isLoading) {
    return (
      <div className="h-4 w-48 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
    )
  }

  const total = summary.decisions + summary.work + summary.signals + summary.investigate

  if (total === 0) {
    return (
      <div className="text-[12px] text-gray-400 dark:text-gray-500">
        All clear. No items require attention.
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 text-[12px]">
      <span className="text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide text-[11px]">
        Decision Load
      </span>

      {summary.decisions > 0 && (
        <button
          onClick={() => onScrollToBand?.('DECIDE')}
          className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors tabular-nums"
        >
          <span className="font-semibold">{summary.decisions}</span>
          <span className="text-gray-400 dark:text-gray-500 ml-0.5">
            Decision{summary.decisions !== 1 ? 's' : ''}
          </span>
        </button>
      )}

      {summary.work > 0 && (
        <>
          {summary.decisions > 0 && <Dot />}
          <button
            onClick={() => onScrollToBand?.('ADVANCE')}
            className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors tabular-nums"
          >
            <span className="font-semibold">{summary.work}</span>
            <span className="text-gray-400 dark:text-gray-500 ml-0.5">
              Work
            </span>
          </button>
        </>
      )}

      {summary.signals > 0 && (
        <>
          {(summary.decisions > 0 || summary.work > 0) && <Dot />}
          <button
            onClick={() => onScrollToBand?.('AWARE')}
            className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors tabular-nums"
          >
            <span className="font-semibold">{summary.signals}</span>
            <span className="text-gray-400 dark:text-gray-500 ml-0.5">
              Signal{summary.signals !== 1 ? 's' : ''}
            </span>
          </button>
        </>
      )}

      {summary.investigate > 0 && (
        <>
          {(summary.decisions > 0 || summary.work > 0 || summary.signals > 0) && <Dot />}
          <button
            onClick={() => onScrollToBand?.('INVESTIGATE')}
            className="text-violet-600 dark:text-violet-400 hover:text-violet-800 dark:hover:text-violet-300 transition-colors tabular-nums"
          >
            <span className="font-semibold">{summary.investigate}</span>
            <span className="text-violet-400 dark:text-violet-500 ml-0.5">
              Investigate
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
