/**
 * ExecutionSnapshotCard — Decision Pipeline.
 *
 * Three equal segmented cards showing pipeline stage counts with
 * per-stage timing metrics. Each card is clickable and opens the
 * Trade Queue filtered to that stage.
 */

import { clsx } from 'clsx'
import { Activity, ArrowRight, Clock } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StageDetail {
  count: number
  medianDays: number | null
  oldestDays: number | null
}

export interface ExecutionStats {
  awaitingDecision: number
  modeling: number
  executing: number
  medianDaysToDecision: number | null
  oldestProposalDays: number | null
  stages: {
    deciding: StageDetail
    modeling: StageDetail
    executing: StageDetail
  }
}

interface ExecutionSnapshotCardProps {
  stats: ExecutionStats
  isLoading?: boolean
  onOpenTradeQueue: (filter?: string) => void
}

// ---------------------------------------------------------------------------
// Stage card config
// ---------------------------------------------------------------------------

const STAGE_CONFIG = {
  deciding: {
    label: 'Awaiting Decision',
    border: 'border-t-amber-400 dark:border-t-amber-500',
    bg: 'hover:bg-amber-50/50 dark:hover:bg-amber-950/10',
    count: 'text-amber-700 dark:text-amber-300',
  },
  modeling: {
    label: 'Modeling',
    border: 'border-t-blue-400 dark:border-t-blue-500',
    bg: 'hover:bg-blue-50/50 dark:hover:bg-blue-950/10',
    count: 'text-blue-700 dark:text-blue-300',
  },
  executing: {
    label: 'Executing',
    border: 'border-t-emerald-400 dark:border-t-emerald-500',
    bg: 'hover:bg-emerald-50/50 dark:hover:bg-emerald-950/10',
    count: 'text-emerald-700 dark:text-emerald-300',
  },
} as const

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExecutionSnapshotCard({
  stats,
  isLoading,
  onOpenTradeQueue,
}: ExecutionSnapshotCardProps) {
  if (isLoading) return null

  const totalPipeline = stats.awaitingDecision + stats.modeling + stats.executing

  return (
    <div>
      {/* Zone header */}
      <div className="flex items-center gap-2 mb-3">
        <Activity className="w-4 h-4 text-gray-400 dark:text-gray-500" />
        <h2 className="text-[14px] font-semibold text-gray-800 dark:text-gray-100">
          Decision Pipeline
        </h2>
        <div className="flex-1" />
        <button
          onClick={() => onOpenTradeQueue()}
          className="flex items-center gap-1 text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        >
          Trade Queue
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      {/* 3 equal stage cards */}
      <div className="grid grid-cols-3 gap-3">
        {(['deciding', 'modeling', 'executing'] as const).map(stage => {
          const config = STAGE_CONFIG[stage]
          const detail = stats.stages[stage]
          return (
            <StageCard
              key={stage}
              label={config.label}
              detail={detail}
              borderClass={config.border}
              bgClass={config.bg}
              countClass={config.count}
              onClick={() => onOpenTradeQueue(stage)}
            />
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// StageCard — Equal pipeline card
// ---------------------------------------------------------------------------

function StageCard({
  label,
  detail,
  borderClass,
  bgClass,
  countClass,
  onClick,
}: {
  label: string
  detail: StageDetail
  borderClass: string
  bgClass: string
  countClass: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'text-left rounded-lg border border-gray-200 dark:border-gray-700 border-t-[3px]',
        'bg-white dark:bg-gray-800/60 p-4 transition-colors cursor-pointer',
        borderClass,
        bgClass,
      )}
    >
      {/* Label */}
      <div className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1">
        {label}
      </div>

      {/* Count */}
      <div className={clsx('text-[24px] font-bold leading-none tabular-nums mb-2', countClass)}>
        {detail.count}
      </div>

      {/* Timing stats */}
      <div className="space-y-0.5">
        {detail.medianDays != null && (
          <div className="flex items-center gap-1">
            <Clock className="w-2.5 h-2.5 text-gray-400" />
            <span className="text-[9px] text-gray-500 dark:text-gray-400">
              Median <span className="font-semibold tabular-nums">{detail.medianDays}d</span>
            </span>
          </div>
        )}
        {detail.oldestDays != null && detail.oldestDays > 0 && (
          <div className="text-[9px] text-gray-500 dark:text-gray-400">
            Oldest <span className={clsx(
              'font-semibold tabular-nums',
              detail.oldestDays >= 7 && 'text-amber-600 dark:text-amber-400',
            )}>
              {detail.oldestDays}d
            </span>
          </div>
        )}
        {detail.count === 0 && detail.medianDays == null && (
          <div className="text-[9px] text-gray-400 dark:text-gray-500">
            No items
          </div>
        )}
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Helper to compute stats from trade ideas (per-stage detail)
// ---------------------------------------------------------------------------

function computeMedian(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

export function computeExecutionStats(tradeIdeas: any[]): ExecutionStats {
  const decidingAges: number[] = []
  const modelingAges: number[] = []
  const executingAges: number[] = []
  let decidingOldest: number | null = null
  let modelingOldest: number | null = null
  let executingOldest: number | null = null
  const now = Date.now()

  for (const idea of tradeIdeas) {
    if (idea.visibility_tier !== 'active') continue

    const ageDays = Math.floor(
      (now - new Date(idea.updated_at || idea.created_at).getTime()) / 86400000,
    )

    if (idea.stage === 'deciding' && !idea.decision_outcome) {
      decidingAges.push(ageDays)
      if (decidingOldest == null || ageDays > decidingOldest) decidingOldest = ageDays
    } else if (idea.stage === 'active' && !idea.decision_outcome) {
      modelingAges.push(ageDays)
      if (modelingOldest == null || ageDays > modelingOldest) modelingOldest = ageDays
    } else if (idea.stage === 'active' && idea.decision_outcome === 'accepted' && !idea.outcome) {
      executingAges.push(ageDays)
      if (executingOldest == null || ageDays > executingOldest) executingOldest = ageDays
    }
  }

  return {
    awaitingDecision: decidingAges.length,
    modeling: modelingAges.length,
    executing: executingAges.length,
    medianDaysToDecision: computeMedian(decidingAges),
    oldestProposalDays: decidingOldest,
    stages: {
      deciding: {
        count: decidingAges.length,
        medianDays: computeMedian(decidingAges),
        oldestDays: decidingOldest,
      },
      modeling: {
        count: modelingAges.length,
        medianDays: computeMedian(modelingAges),
        oldestDays: modelingOldest,
      },
      executing: {
        count: executingAges.length,
        medianDays: computeMedian(executingAges),
        oldestDays: executingOldest,
      },
    },
  }
}
