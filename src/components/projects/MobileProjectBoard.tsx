import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { MobileProjectRows } from './MobileProjectRows'
import { getStatusConfig } from '../../lib/project-config'
import type { ProjectWithAssignments, ProjectStatus } from '../../types/project'

/**
 * The four stages the board represents, in pipeline order. Same set and same
 * order as `BOARD_STATUSES` in EnhancedKanbanBoard — this is a different
 * presentation of that model, not a different model.
 */
export const BOARD_STAGES: ProjectStatus[] = ['planning', 'in_progress', 'blocked', 'completed']

export interface MobileProjectBoardProps {
  projects: ProjectWithAssignments[]
  onProjectSelect?: (result: any) => void
  /** Opens the actions sheet, whose Status section is how a project moves stage. */
  onOpenActions: (project: ProjectWithAssignments) => void
}

/**
 * The board, for a phone: one stage at a time.
 *
 * ── Why not the columns ───────────────────────────────────────────────────
 *
 * The desktop board is four columns side by side, which works because a
 * desktop can show four columns side by side. Every attempt to make that
 * survive 390px failed differently: dividing the width gave ~58px a column,
 * and giving each column a real width turned the board into a horizontally
 * scrolled page where you could see one column, could not see the others,
 * and could not tell how far along the row you were. A kanban board's whole
 * claim is that you see the stages at once. A phone cannot, so the honest
 * move is to stop pretending and pick a shape that does work.
 *
 * So: a stage rail that shows every stage and its count at once — which is
 * the part of the board a phone CAN show — and below it the projects in the
 * selected stage as a full-width vertical list. The counts carry the
 * distribution; the list carries the detail.
 *
 * ── Moving a project ──────────────────────────────────────────────────────
 *
 * Dragging a card between columns is the desktop gesture for a status
 * change. Here, each row's `⋯` opens the same actions sheet the list view
 * uses, whose Status section performs the same `updateStatusMutation`. A
 * project therefore leaves the stage you are looking at as soon as you move
 * it, which is the same feedback the column move gives — and the previous /
 * next arrows step to the neighbouring stage so you can follow it.
 *
 * Nothing here touches the drag/drop architecture, which is still what
 * desktop uses. This component is never rendered above `sm`.
 */
export function MobileProjectBoard({
  projects,
  onProjectSelect,
  onOpenActions,
}: MobileProjectBoardProps) {
  const byStage = useMemo(() => {
    const grouped = Object.fromEntries(
      BOARD_STAGES.map(s => [s, [] as ProjectWithAssignments[]])
    ) as Record<ProjectStatus, ProjectWithAssignments[]>

    for (const project of projects) {
      // `cancelled` is not a board stage, exactly as on the desktop board.
      if (grouped[project.status]) grouped[project.status].push(project)
    }
    return grouped
  }, [projects])

  // Open on the first stage that has anything in it, so the board does not
  // greet a user with an empty column when work exists one tap away.
  const [stage, setStage] = useState<ProjectStatus>(
    () => BOARD_STAGES.find(s => projects.some(p => p.status === s)) ?? 'planning'
  )

  const index = BOARD_STAGES.indexOf(stage)
  const current = byStage[stage] ?? []
  const config = getStatusConfig(stage)

  return (
    <div className="flex flex-col h-full">
      {/* Stage rail — every stage and its count, visible at once. This is
          the part of a board a phone can actually show. */}
      <div
        role="group"
        aria-label="Board stages"
        className="flex items-center gap-1.5 overflow-x-auto no-scrollbar px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
      >
        {BOARD_STAGES.map(s => {
          const cfg = getStatusConfig(s)
          const count = byStage[s]?.length ?? 0
          const active = s === stage
          return (
            <button
              key={s}
              type="button"
              onClick={() => setStage(s)}
              aria-pressed={active}
              className={clsx(
                'no-touch-target tap-pad flex shrink-0 items-center gap-1.5 h-8 px-2.5 rounded-lg text-[13px] font-medium transition-colors',
                active
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
              )}
            >
              <span className={clsx('h-1.5 w-1.5 rounded-full', active ? 'bg-white/70' : cfg.dotColor)} />
              {cfg.label}
              <span className={clsx(
                'rounded px-1 text-[11px] tabular-nums',
                active ? 'bg-white/20' : 'bg-white dark:bg-gray-800'
              )}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Stage body */}
      <div className="flex-1 overflow-y-auto overscroll-contain bg-gray-50 dark:bg-gray-900">
        {current.length > 0 ? (
          <div className="bg-white dark:bg-gray-800">
            <MobileProjectRows
              projects={current}
              onProjectSelect={onProjectSelect}
              onOpenActions={onOpenActions}
            />
          </div>
        ) : (
          <div className="px-4 py-10 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Nothing in {config.label.toLowerCase()}
            </p>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              Move a project here from its ⋯ menu.
            </p>
          </div>
        )}
      </div>

      {/* Step to the neighbouring stage — the way to follow a project you
          just moved out of the stage you were looking at. */}
      <div className="flex items-center justify-between gap-2 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2">
        <button
          type="button"
          disabled={index <= 0}
          onClick={() => setStage(BOARD_STAGES[index - 1])}
          aria-label={
            index > 0
              ? `Previous stage: ${getStatusConfig(BOARD_STAGES[index - 1]).label}`
              : 'Previous stage'
          }
          className="no-touch-target tap-pad flex items-center gap-1 h-8 px-2 text-[13px] font-medium text-gray-600 dark:text-gray-300 disabled:opacity-30"
        >
          <ChevronLeft className="w-4 h-4" />
          {index > 0 ? getStatusConfig(BOARD_STAGES[index - 1]).label : 'Previous'}
        </button>
        <span className="text-[11px] text-gray-400 dark:text-gray-500 tabular-nums">
          {index + 1} of {BOARD_STAGES.length}
        </span>
        <button
          type="button"
          disabled={index >= BOARD_STAGES.length - 1}
          onClick={() => setStage(BOARD_STAGES[index + 1])}
          aria-label={
            index < BOARD_STAGES.length - 1
              ? `Next stage: ${getStatusConfig(BOARD_STAGES[index + 1]).label}`
              : 'Next stage'
          }
          className="no-touch-target tap-pad flex items-center gap-1 h-8 px-2 text-[13px] font-medium text-gray-600 dark:text-gray-300 disabled:opacity-30"
        >
          {index < BOARD_STAGES.length - 1 ? getStatusConfig(BOARD_STAGES[index + 1]).label : 'Next'}
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
