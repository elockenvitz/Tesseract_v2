import {
  Square,
  CheckCircle,
  ChevronRight
} from 'lucide-react'
import { DatePicker } from '../ui/DatePicker'
import { EmptyState } from '../common/EmptyState'
import type { ProjectWithAssignments, ProjectStatus, ProjectPriority } from '../../types/project'

interface TaskItem {
  deliverable: {
    id: string
    title: string
    completed: boolean
    due_date: string | null
  }
  project: ProjectWithAssignments
}

interface MyTasksViewProps {
  myTasks: TaskItem[]
  onToggleDeliverable: (deliverableId: string, completed: boolean) => void
  onUpdateDueDate: (deliverableId: string, dueDate: string | null) => void
  onProjectSelect?: (tab: { id: string; title: string; type: string; data: any }) => void
}


export function MyTasksView({
  myTasks,
  onToggleDeliverable,
  onUpdateDueDate,
  onProjectSelect,
}: MyTasksViewProps) {
  const handleViewProject = (project: ProjectWithAssignments) => {
    onProjectSelect?.({
      id: project.id,
      title: project.title,
      type: 'project',
      data: project
    })
  }

  return (
    <div className="p-4">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          My Tasks
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {myTasks.length} incomplete {myTasks.length === 1 ? 'task' : 'tasks'} across your assigned projects
        </p>
      </div>

      {myTasks.length > 0 ? (
        <div className="space-y-2">
          {myTasks.map(({ deliverable, project }) => (
            <div
              key={deliverable.id}
              className="flex items-center gap-3 p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:shadow-sm transition-shadow"
            >
              {/* Checkbox */}
              <button
                onClick={() => onToggleDeliverable(deliverable.id, deliverable.completed)}
                className="flex-shrink-0 text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
              >
                <Square className="w-5 h-5" />
              </button>

              {/* Task Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                  {deliverable.title}
                </p>
                {/* The project name opens the project.

                    It used to open a 320px floating card summarising the
                    project — a hover-preview shape, on a surface with no
                    hover, where it covered the list it was launched from and
                    its only real action was "View project". Tapping a
                    project's name should open that project; the preview is
                    an extra step between the tap and what it meant. */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleViewProject(project)
                  }}
                  className="no-touch-target tap-pad mt-0.5 flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                >
                  <span className="truncate max-w-[200px]">{project.title}</span>
                  <ChevronRight className="w-3 h-3 flex-shrink-0" />
                </button>
              </div>

              {/* Due Date Picker */}
              <div onClick={(e) => e.stopPropagation()} className="flex-shrink-0">
                <DatePicker
                  value={deliverable.due_date}
                  onChange={(date) => onUpdateDueDate(deliverable.id, date)}
                  placeholder="Set due"
                  variant="inline"
                  compact
                  showOverdue
                  isCompleted={deliverable.completed}
                  maxDate={project.due_date}
                  projectDueDate={project.due_date}
                  allowPastDates
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={CheckCircle}
          title="All caught up!"
          description="You have no incomplete tasks in your assigned projects."
        />
      )}

    </div>
  )
}
