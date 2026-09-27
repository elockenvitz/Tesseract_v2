import { clsx } from 'clsx'
import { Check, Trash2 } from 'lucide-react'
import { BottomSheet } from '../mobile/BottomSheet'
import { PROJECT_STATUSES, PROJECT_PRIORITIES } from '../../lib/project-config'
import type { ProjectWithAssignments, ProjectStatus, ProjectPriority } from '../../types/project'

export interface ProjectActionsSheetProps {
  project: ProjectWithAssignments | null
  onClose: () => void

  onStatusChange: (status: ProjectStatus) => void
  onPriorityChange: (priority: ProjectPriority) => void

  /** Omitted when the viewer did not create the project, matching the list. */
  onCancelProject?: () => void
}

/**
 * The editing half of a project row, moved off the row.
 *
 * The desktop card carries a status dropdown pill, a priority dropdown pill
 * and a hover-revealed delete button inline, which is why a phone list read
 * as a column of forms. The mutations are unchanged — this calls the same
 * `updateStatusMutation` and `updatePriorityMutation` the pills called, and
 * opens the same delete modal — but they are one tap away instead of
 * competing with the project's name for attention.
 *
 * Tag editing is deliberately NOT here. It is the one list action with no
 * equivalent anywhere else (project detail has no tag section), so hiding it
 * behind a sheet section would be the only way to reach it, and building that
 * picker is more than a composition pass. It stays on the desktop card and is
 * flagged as the gap it is.
 */
export function ProjectActionsSheet({
  project,
  onClose,
  onStatusChange,
  onPriorityChange,
  onCancelProject,
}: ProjectActionsSheetProps) {
  return (
    <BottomSheet
      open={project !== null}
      onClose={onClose}
      title={project?.title ?? 'Project'}
      fitContent
    >
      {project && (
        <div className="pb-2">
          <Section title="Status">
            {PROJECT_STATUSES.filter(s => s.id !== 'cancelled').map(s => (
              <Row
                key={s.id}
                selected={project.status === s.id}
                onClick={() => {
                  onStatusChange(s.id)
                  onClose()
                }}
              >
                <span className={clsx('h-2.5 w-2.5 rounded-full shrink-0', s.dotColor)} />
                <span className="flex-1 min-w-0 truncate">{s.label}</span>
              </Row>
            ))}
          </Section>

          <Section title="Priority">
            {PROJECT_PRIORITIES.map(p => (
              <Row
                key={p.id}
                selected={project.priority === p.id}
                onClick={() => {
                  onPriorityChange(p.id)
                  onClose()
                }}
              >
                <span className={clsx('rounded px-1.5 py-0.5 text-[11px] font-medium shrink-0', p.pillClasses)}>
                  {p.label}
                </span>
                <span className="flex-1 min-w-0" />
              </Row>
            ))}
          </Section>

          {onCancelProject && (
            <div className="pt-3">
              <button
                type="button"
                onClick={() => {
                  onCancelProject()
                  onClose()
                }}
                className="w-full px-4 py-3 flex items-center gap-3 text-left text-sm font-medium text-red-600 dark:text-red-400"
              >
                <Trash2 className="h-4 w-4 shrink-0" />
                Cancel project
              </button>
            </div>
          )}
        </div>
      )}
    </BottomSheet>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pt-3">
      <div className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
        {title}
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-800">{children}</div>
    </div>
  )
}

function Row({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={clsx(
        'w-full px-4 py-3 flex items-center gap-3 text-left text-sm',
        selected
          ? 'text-primary-700 dark:text-primary-300 font-semibold'
          : 'text-gray-700 dark:text-gray-200',
      )}
    >
      {children}
      {selected && <Check className="h-4 w-4 text-primary-600 shrink-0" />}
    </button>
  )
}
