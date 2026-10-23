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
  /**
   * The stage's deadline, already turned into words by the caller.
   *
   * The chevrons carried this as a coloured pill inside a 70px shape. It is
   * a date, not a stage, so here it is one line of small text under the
   * name — present only where a deadline is actually set.
   */
  deadline?: { label: string; tone: 'overdue' | 'today' | 'urgent' | 'upcoming' } | null
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
              'group relative flex flex-none items-start gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] leading-tight transition-colors',
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
            <span className="flex min-w-0 flex-col items-start">
              <span className="flex items-center gap-1.5">
                <span className="max-w-[20ch] truncate font-medium">{stage.label}</span>
                {stage.total > 0 && (
                  <span className={clsx('tabular-nums', viewing ? 'opacity-80' : 'text-gray-400 dark:text-gray-500')}>
                    {stage.done}/{stage.total}
                  </span>
                )}
              </span>
              {/* Progress as a rule under the name: the same fact the count
                  states, at a glance, in 2px instead of a 70px shape. */}
              {stage.total > 0 && (
                <span
                  aria-hidden
                  className={clsx(
                    'mt-1 h-[2px] w-full overflow-hidden rounded-full',
                    viewing ? 'bg-white/25 dark:bg-gray-900/20' : 'bg-gray-200 dark:bg-gray-700',
                  )}
                >
                  <span
                    className={clsx(
                      'block h-full rounded-full transition-all duration-500',
                      complete ? 'bg-emerald-500' : viewing ? 'bg-white dark:bg-gray-900' : 'bg-gray-400 dark:bg-gray-500',
                    )}
                    style={{ width: `${Math.round((stage.done / stage.total) * 100)}%` }}
                  />
                </span>
              )}
              {stage.deadline && (
                <span
                  className={clsx(
                    'mt-0.5 text-[10px] font-medium',
                    viewing ? 'opacity-80' :
                      stage.deadline.tone === 'overdue' ? 'text-red-600 dark:text-red-400'
                        : stage.deadline.tone === 'today' ? 'text-orange-600 dark:text-orange-400'
                          : stage.deadline.tone === 'urgent' ? 'text-amber-600 dark:text-amber-500'
                            : 'text-gray-400 dark:text-gray-500',
                  )}
                >
                  {stage.deadline.label}
                </span>
              )}
            </span>
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
