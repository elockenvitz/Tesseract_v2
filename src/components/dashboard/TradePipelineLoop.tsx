/**
 * TradePipelineLoop — Bottleneck-aware pipeline visualization.
 *
 * Shows 3 vertical stages (Modeling → Deciding → Executing) with:
 *   - Count per stage
 *   - Median age + oldest age
 *   - Bottleneck detection (highest median age among populated stages)
 *   - Visual highlight ring + "BOTTLENECK" label on the worst stage
 *
 * Designed for a narrow right column (~320px).
 * Each stage is clickable → opens Trade Queue filtered to that stage.
 */

import { useMemo } from 'react'
import { clsx } from 'clsx'
import { ArrowDown } from 'lucide-react'
import type { ExecutionStats } from './ExecutionSnapshotCard'

// ---------------------------------------------------------------------------
// Stage config
// ---------------------------------------------------------------------------

const STAGE_META = {
  deciding: {
    label: 'Deciding',
    accent: 'text-red-600 dark:text-red-400',
    ring: 'ring-red-400/50 dark:ring-red-500/30',
    bg: 'bg-red-50/40 dark:bg-red-950/10',
  },
  modeling: {
    label: 'Modeling',
    accent: 'text-amber-600 dark:text-amber-400',
    ring: 'ring-amber-400/50 dark:ring-amber-500/30',
    bg: 'bg-amber-50/40 dark:bg-amber-950/10',
  },
  executing: {
    label: 'Executing',
    accent: 'text-blue-600 dark:text-blue-400',
    ring: 'ring-blue-400/50 dark:ring-blue-500/30',
    bg: 'bg-blue-50/40 dark:bg-blue-950/10',
  },
} as const

export type StageKey = keyof typeof STAGE_META

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TradePipelineLoopProps {
  stats: ExecutionStats
  isLoading?: boolean
  onOpenTradeQueue: (filter?: string) => void
  /** Currently selected pipeline stage (highlights the stage and filters DECIDE) */
  activeStage?: StageKey | null
  /** Called when a stage is clicked — toggles the filter */
  onStageSelect?: (stage: StageKey | null) => void
}

export function TradePipelineLoop({
  stats,
  isLoading,
  onOpenTradeQueue,
  activeStage,
  onStageSelect,
}: TradePipelineLoopProps) {
  // Determine bottleneck: highest median age among stages with items
  const bottleneckKey = useMemo((): StageKey | null => {
    const candidates = (
      ['deciding', 'modeling', 'executing'] as const
    )
      .filter(k => stats.stages[k].count > 0)

    if (candidates.length === 0) return null

    return candidates.reduce((worst, k) => {
      const wAge = stats.stages[worst].medianDays ?? 0
      const kAge = stats.stages[k].medianDays ?? 0
      if (kAge > wAge) return k
      if (kAge === wAge && stats.stages[k].count > stats.stages[worst].count) return k
      return worst
    })
  }, [stats])

  if (isLoading) return null

  const total =
    stats.stages.deciding.count +
    stats.stages.modeling.count +
    stats.stages.executing.count

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden flex flex-col flex-none">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-700/50">
        <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-200">
          Trade Pipeline
        </span>
        <span className="text-[11px] font-bold text-gray-500 dark:text-gray-400 tabular-nums">
          {total} active
        </span>
      </div>

      {total === 0 ? (
        <div className="flex-1 flex items-center justify-center px-3 py-4 text-[11px] text-gray-400 dark:text-gray-500">
          Pipeline clear. No active trades.
        </div>
      ) : (
        <div className="flex-1 p-2 space-y-0.5">
          {(['modeling', 'deciding', 'executing'] as const).map((stage, idx) => {
            const detail = stats.stages[stage]
            const meta = STAGE_META[stage]
            const isBottleneck = bottleneckKey === stage

            return (
              <div key={stage}>
                <button
                  onClick={() => {
                    if (onStageSelect) {
                      onStageSelect(activeStage === stage ? null : stage)
                    } else {
                      onOpenTradeQueue(stage)
                    }
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md transition-colors text-left',
                    'hover:bg-gray-50 dark:hover:bg-gray-700/30',
                    activeStage === stage && clsx('ring-2', meta.ring, meta.bg),
                    isBottleneck && activeStage !== stage && clsx('ring-1', meta.ring, meta.bg),
                  )}
                >
                  {/* Count */}
                  <span
                    className={clsx(
                      'text-[18px] font-bold tabular-nums leading-none w-7 text-right',
                      detail.count > 0 ? meta.accent : 'text-gray-300 dark:text-gray-600',
                    )}
                  >
                    {detail.count}
                  </span>

                  {/* Label + timing */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12px] font-medium text-gray-700 dark:text-gray-200">
                        {meta.label}
                      </span>
                      {isBottleneck && (
                        <span className="text-[9px] font-bold uppercase tracking-wider text-red-500 dark:text-red-400">
                          Bottleneck
                        </span>
                      )}
                    </div>
                  </div>
                </button>

                {/* Connector between stages */}
                {idx < 2 && (
                  <div className="flex justify-center py-0.5">
                    <ArrowDown className="w-3 h-3 text-gray-300 dark:text-gray-600" />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Footer — open trade queue CTA */}
      <div className="border-t border-gray-100 dark:border-gray-700/50 px-3 py-2 flex items-center justify-between">
        <button
          onClick={() => onOpenTradeQueue()}
          className="text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
        >
          Open trade queue &rarr;
        </button>
      </div>
    </div>
  )
}
