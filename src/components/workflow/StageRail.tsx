import React from 'react'
import { clsx } from 'clsx'
import { Check } from 'lucide-react'

/**
 * The stage rail while the analyst is working, rather than choosing.
 *
 * ── Why there are two presentations and not one ─────────────────────────
 *
 * The chevron rail answers "where am I in this Process?", and it answers it
 * well on the stage overview, where that IS the question. It costs about
 * 70px of a 772px viewport, and on the requirement surface — where the
 * question is "what does this requirement need?" — it spends that height
 * restating something the workspace header below it already states.
 *
 * So the rail has two sizes and one rule: full while you are choosing where
 * to work, a strip while you are working. Nothing is removed. Every stage is
 * still named, numbered, counted and clickable; status is still carried by
 * colour; the current stage is still marked as current even when you are
 * looking at another one.
 *
 * It owns no state and no data. The counts, the statuses and the click
 * handler are the rail's own, passed through, so the two presentations
 * cannot disagree about which stage is current or how much is done.
 */

export type StageStatus = 'completed' | 'current' | 'future'

export interface StageRailItem {
  id: string
  label: string
  status: StageStatus
  /** Requirements satisfied and total. Null where the stage carries none. */
  done: number
  total: number
}

interface Props {
  stages: StageRailItem[]
  /** The stage being VIEWED, which is not always the current one. */
  selectedId: string | null
  onSelect: (stageId: string, index: number) => void
  className?: string
}

export function StageRail({ stages, selectedId, onSelect, className }: Props) {
  if (!stages.length) return null

  return (
    <div
      className={clsx('flex items-center gap-1 overflow-x-auto', className)}
      data-testid="stage-rail-compact"
      role="tablist"
      aria-label="Process stages"
    >
      {stages.map((stage, index) => {
        const viewing = stage.id === selectedId
        const complete = stage.status === 'completed'
        const current = stage.status === 'current'
        return (
          <button
            key={stage.id}
            type="button"
            role="tab"
            aria-selected={viewing}
            data-testid={`stage-chip-${stage.id}`}
            onClick={() => onSelect(stage.id, index)}
            title={stage.total > 0 ? `${stage.label} — ${stage.done} of ${stage.total} done` : stage.label}
            className={clsx(
              'group relative flex flex-none items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] leading-tight transition-colors',
              viewing
                ? 'border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900'
                : complete
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:border-emerald-400 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'border-gray-200 text-gray-600 hover:border-gray-400 dark:border-gray-700 dark:text-gray-300',
            )}
          >
            {/* The number is the position; the tick replaces it once done. */}
            <span
              className={clsx(
                'flex h-4 w-4 flex-none items-center justify-center rounded text-[10px] font-bold',
                viewing ? 'bg-white/20' : complete ? 'bg-emerald-200/70 dark:bg-emerald-900' : 'bg-gray-100 dark:bg-gray-800',
              )}
            >
              {complete ? <Check className="h-3 w-3" strokeWidth={3} /> : index + 1}
            </span>
            <span className="max-w-[18ch] truncate font-medium">{stage.label}</span>
            {stage.total > 0 && (
              <span className={clsx('tabular-nums', viewing ? 'opacity-80' : 'text-gray-400 dark:text-gray-500')}>
                {stage.done}/{stage.total}
              </span>
            )}
            {/* Current, even while another stage is being viewed: a reader
                looking ahead must still be able to find their place. */}
            {current && !viewing && (
              <span
                aria-hidden
                data-testid={`stage-chip-current-${stage.id}`}
                className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-blue-600"
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
