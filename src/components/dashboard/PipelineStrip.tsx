/**
 * PipelineStrip — Compact pipeline status for the FLOW band.
 *
 * Shows deciding / modeling / executing counts with median age.
 * Each segment is clickable and routes to Trade Queue with filters.
 * Visually lighter than NOW band — small, horizontal, muted.
 */

import { clsx } from 'clsx'
import { Activity, Clock } from 'lucide-react'
import type { ExecutionStats } from './ExecutionSnapshotCard'

// ---------------------------------------------------------------------------
// Stage config
// ---------------------------------------------------------------------------

const STAGES = [
  {
    key: 'deciding' as const,
    label: 'Deciding',
    color: 'text-amber-600 dark:text-amber-400',
    bg: 'hover:bg-amber-50/50 dark:hover:bg-amber-900/10',
    dot: 'bg-amber-400',
  },
  {
    key: 'modeling' as const,
    label: 'Modeling',
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'hover:bg-blue-50/50 dark:hover:bg-blue-900/10',
    dot: 'bg-blue-400',
  },
  {
    key: 'executing' as const,
    label: 'Executing',
    color: 'text-emerald-600 dark:text-emerald-400',
    bg: 'hover:bg-emerald-50/50 dark:hover:bg-emerald-900/10',
    dot: 'bg-emerald-400',
  },
] as const

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface PipelineStripProps {
  stats: ExecutionStats
  isLoading?: boolean
  onOpenTradeQueue: (filter?: string) => void
}

export function PipelineStrip({
  stats,
  isLoading,
  onOpenTradeQueue,
}: PipelineStripProps) {
  if (isLoading) return null

  const total = stats.awaitingDecision + stats.modeling + stats.executing

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 dark:border-gray-700/50">
        <Activity className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
        <span className="text-[12px] font-medium text-gray-600 dark:text-gray-300">
          Pipeline
        </span>
        {total > 0 && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full tabular-nums bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
            {total}
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={() => onOpenTradeQueue()}
          className="text-[10px] font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          Trade Queue
        </button>
      </div>

      {/* Stage segments */}
      <div className="flex divide-x divide-gray-100 dark:divide-gray-700/50">
        {STAGES.map(stage => {
          const detail = stats.stages[stage.key]
          return (
            <button
              key={stage.key}
              onClick={() => onOpenTradeQueue(stage.key)}
              className={clsx(
                'flex-1 flex items-center gap-2 px-3 py-2 text-left transition-colors',
                stage.bg,
              )}
            >
              <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', stage.dot)} />
              <span className={clsx('text-[11px] font-semibold tabular-nums', stage.color)}>
                {detail.count}
              </span>
              <span className="text-[10px] text-gray-500 dark:text-gray-400">
                {stage.label}
              </span>
              {detail.medianDays != null && (
                <span className="hidden sm:flex items-center gap-0.5 ml-auto text-[9px] text-gray-400 dark:text-gray-500 tabular-nums">
                  <Clock className="w-2.5 h-2.5" />
                  {detail.medianDays}d
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
