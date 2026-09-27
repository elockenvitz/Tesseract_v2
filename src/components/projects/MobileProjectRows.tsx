import { clsx } from 'clsx'
import { MoreHorizontal, Users, AlertTriangle } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import {
  getStatusConfig,
  getPriorityConfig,
  daysOverdue,
} from '../../lib/project-config'
import type { ProjectWithAssignments } from '../../types/project'

export interface MobileProjectRowsProps {
  projects: ProjectWithAssignments[]
  onProjectSelect?: (result: any) => void
  /** Opens the actions sheet for one project — status, priority, tags, cancel. */
  onOpenActions: (project: ProjectWithAssignments) => void
}

/**
 * The Projects list on a phone.
 *
 * ── Why this is a separate component ──────────────────────────────────────
 *
 * The desktop card is an editing surface. It gives its own visual weight to a
 * status dropdown pill, a priority dropdown pill, a tag run with an "Add tag"
 * trigger, a description, a progress bar, a member count, an inline due-date
 * picker, a relative timestamp and a delete button — thirteen elements, each
 * of them a control. At 390px that is 220-250px of card, so barely one
 * project fits above the fold, and the loudest things on screen are the
 * editors rather than the projects.
 *
 * A phone list answers three questions: what is this project, is it healthy,
 * does it need me. So this is a row, not a panel: identity first, one line of
 * context, one line that carries progress and attention. Everything that
 * changes the project moves behind the `•••` trigger, which opens the same
 * mutations in a sheet.
 *
 * It renders alongside — never instead of — the desktop markup in
 * ProjectsPage, which is untouched. Two components rather than one set of
 * responsive classes, because the information hierarchy differs, not just the
 * spacing; this is the same split `MobileTradeRows` makes for the trade book.
 *
 * Height budget: ~112px with a description, ~92px without.
 */
export function MobileProjectRows({
  projects,
  onProjectSelect,
  onOpenActions,
}: MobileProjectRowsProps) {
  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
      {projects.map(project => (
        <MobileProjectRow
          key={project.id}
          project={project}
          onProjectSelect={onProjectSelect}
          onOpenActions={onOpenActions}
        />
      ))}
    </ul>
  )
}

function MobileProjectRow({
  project,
  onProjectSelect,
  onOpenActions,
}: {
  project: ProjectWithAssignments
  onProjectSelect?: (result: any) => void
  onOpenActions: (project: ProjectWithAssignments) => void
}) {
  const status = getStatusConfig(project.status)
  const priority = getPriorityConfig(project.priority)

  const deliverables = project.project_deliverables ?? []
  const total = deliverables.length
  const done = deliverables.filter(d => d.completed).length
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  const overdueDays = daysOverdue(project.due_date, project.status)
  const members = project.project_assignments?.length ?? 0

  // One line of context: the description if there is one, otherwise the thing
  // a description would have told you — when this last moved.
  const context = project.description?.trim()

  return (
    <li>
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() =>
            onProjectSelect?.({
              id: project.id,
              title: project.title,
              type: 'project',
              data: project,
            })
          }
          className="no-touch-target flex-1 min-w-0 text-left px-4 py-3 active:bg-gray-50 dark:active:bg-gray-800/60"
        >
          {/* Identity. The status dot carries state without spending a pill on
              it — the pill is what made every row look like a form. */}
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={clsx('h-2 w-2 rounded-full shrink-0', status.dotColor)}
              aria-hidden="true"
            />
            <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-gray-900 dark:text-white">
              {project.title}
            </h3>
          </div>

          {/* Context — clamped to one line. The stored description is
              untouched; the full text is on the project detail page. */}
          <p className="mt-0.5 truncate text-[13px] text-gray-500 dark:text-gray-400">
            {context || `${status.label} · updated ${formatDistanceToNow(new Date(project.updated_at ?? project.created_at), { addSuffix: true })}`}
          </p>

          {/* Health: progress, then whatever most needs attention. */}
          <div className="mt-2 flex items-center gap-2 text-[12px] text-gray-500 dark:text-gray-400">
            {total > 0 ? (
              <>
                <span
                  className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
                  role="img"
                  aria-label={`${pct}% complete`}
                >
                  <span
                    className={clsx(
                      'block h-full rounded-full',
                      done === total ? 'bg-emerald-500' : done > 0 ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-600'
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </span>
                <span className="shrink-0 tabular-nums">{done}/{total}</span>
              </>
            ) : (
              <span className="shrink-0 text-gray-400">No tasks</span>
            )}

            {overdueDays > 0 && (
              <span className="flex min-w-0 shrink items-center gap-1 font-medium text-red-600 dark:text-red-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{overdueDays}d overdue</span>
              </span>
            )}

            <span className="ml-auto flex shrink-0 items-center gap-2">
              <span className={clsx('rounded px-1.5 py-0.5 text-[11px] font-medium', priority.pillClasses)}>
                {priority.label}
              </span>
              {members > 0 && (
                <span className="flex items-center gap-0.5">
                  <Users className="h-3.5 w-3.5" />
                  {members}
                </span>
              )}
            </span>
          </div>
        </button>

        {/* Everything that edits the project. Off the row itself, so the row
            reads as a project rather than as a settings panel. */}
        <button
          type="button"
          onClick={() => onOpenActions(project)}
          aria-label={`Actions for ${project.title}`}
          className="flex w-11 shrink-0 items-center justify-center text-gray-400 active:bg-gray-50 dark:active:bg-gray-800/60"
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </div>
    </li>
  )
}
