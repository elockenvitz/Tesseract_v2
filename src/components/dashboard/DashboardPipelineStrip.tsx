/**
 * DashboardPipelineStrip — Visual pipeline card.
 *
 * Shows trade idea flow through stages as a horizontal funnel:
 *   [Awaiting Decision] → [Modeling] → [Executing]
 *
 * Each stage is a clickable segment with count, median age, and visual weight.
 * Colored to indicate bottlenecks (red if count > 0 and median high).
 */

import { clsx } from 'clsx'
import { ArrowRight, Clock, AlertCircle } from 'lucide-react'
import type { ExecutionStats } from './ExecutionSnapshotCard'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface DashboardPipelineStripProps {
  stats: ExecutionStats
  isLoading?: boolean
  onOpenTradeQueue: (filter?: string) => void
}

export function DashboardPipelineStrip({
  stats,
  isLoading,
  onOpenTradeQueue,
}: DashboardPipelineStripProps) {
  if (isLoading) return null

  const { deciding, modeling, executing } = stats.stages
  const total = deciding.count + modeling.count + executing.count

  if (total === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/30">
        <span className="text-[11px] text-gray-400 dark:text-gray-500">
          Pipeline clear. No active trade ideas in progress.
        </span>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-700/50">
        <span className="text-[11px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">
          Trade Pipeline
        </span>
        <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 tabular-nums">
          {total} active
        </span>
        {stats.oldestProposalDays != null && stats.oldestProposalDays > 5 && (
          <span className="flex items-center gap-0.5 text-[10px] text-amber-500 dark:text-amber-400">
            <AlertCircle className="w-3 h-3" />
            Oldest {stats.oldestProposalDays}d
          </span>
        )}
      </div>

      {/* Pipeline stages */}
      <div className="flex items-stretch">
        <PipelineStage
          label="Awaiting Decision"
          count={deciding.count}
          medianDays={deciding.medianDays}
          oldestDays={deciding.oldestDays}
          accentClass={deciding.count > 0
            ? 'text-red-600 dark:text-red-400'
            : 'text-gray-400 dark:text-gray-500'}
          bgClass={deciding.count > 0
            ? 'bg-red-50/40 dark:bg-red-950/10'
            : ''}
          onClick={() => onOpenTradeQueue('deciding')}
        />
        <ArrowRight className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600 shrink-0 self-center -mx-0.5 z-10" />
        <PipelineStage
          label="Modeling"
          count={modeling.count}
          medianDays={modeling.medianDays}
          oldestDays={modeling.oldestDays}
          accentClass={modeling.count > 0
            ? 'text-amber-600 dark:text-amber-400'
            : 'text-gray-400 dark:text-gray-500'}
          bgClass={modeling.count > 0
            ? 'bg-amber-50/30 dark:bg-amber-950/10'
            : ''}
          onClick={() => onOpenTradeQueue('modeling')}
        />
        <ArrowRight className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600 shrink-0 self-center -mx-0.5 z-10" />
        <PipelineStage
          label="Executing"
          count={executing.count}
          medianDays={executing.medianDays}
          oldestDays={executing.oldestDays}
          accentClass={executing.count > 0
            ? 'text-blue-600 dark:text-blue-400'
            : 'text-gray-400 dark:text-gray-500'}
          bgClass={executing.count > 0
            ? 'bg-blue-50/30 dark:bg-blue-950/10'
            : ''}
          onClick={() => onOpenTradeQueue('executing')}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pipeline stage segment
// ---------------------------------------------------------------------------

function PipelineStage({
  label,
  count,
  medianDays,
  oldestDays,
  accentClass,
  bgClass,
  onClick,
}: {
  label: string
  count: number
  medianDays: number | null
  oldestDays: number | null
  accentClass: string
  bgClass: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex-1 flex flex-col items-center gap-0.5 py-2.5 px-2 transition-colors',
        'hover:bg-gray-50 dark:hover:bg-gray-700/30',
        bgClass,
      )}
    >
      <span className={clsx('text-[18px] font-bold tabular-nums leading-none', accentClass)}>
        {count}
      </span>
      <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
        {label}
      </span>
      {count > 0 && medianDays != null && (
        <span className="flex items-center gap-0.5 text-[9px] text-gray-400 dark:text-gray-500 tabular-nums">
          <Clock className="w-2.5 h-2.5" />
          {medianDays}d med{oldestDays != null && oldestDays > medianDays ? ` · ${oldestDays}d max` : ''}
        </span>
      )}
    </button>
  )
}
