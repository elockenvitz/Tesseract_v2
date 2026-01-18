import { useState, useRef, useEffect } from 'react'
import {
  Square,
  CheckCircle,
  Clock,
  Circle,
  AlertCircle,
  Ban,
  ExternalLink,
  Calendar,
  Users,
  ChevronRight
} from 'lucide-react'
import { clsx } from 'clsx'
import { format } from 'date-fns'
import { DatePicker } from '../ui/DatePicker'
import { EmptyState } from '../common/EmptyState'
import { Button } from '../ui/Button'
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
  getStatusIcon: (status: ProjectStatus) => React.ReactNode
  getStatusColor: (status: ProjectStatus) => string
  getPriorityColor: (priority: ProjectPriority) => string
}

interface ProjectPopoverProps {
  project: ProjectWithAssignments
  position: { top: number; left: number }
  onClose: () => void
  onViewProject: () => void
  getStatusIcon: (status: ProjectStatus) => React.ReactNode
  getStatusColor: (status: ProjectStatus) => string
  getPriorityColor: (priority: ProjectPriority) => string
}

function ProjectPopover({
  project,
  position,
  onClose,
  onViewProject,
  getStatusIcon,
  getStatusColor,
  getPriorityColor
}: ProjectPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  const totalDeliverables = project.project_deliverables?.length || 0
  const completedDeliverables = project.project_deliverables?.filter(d => d.completed).length || 0
  const progressPercent = totalDeliverables > 0 ? Math.round((completedDeliverables / totalDeliverables) * 100) : 0

  return (
    <div
      ref={popoverRef}
      className="fixed z-50 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 p-4 w-80"
      style={{ top: position.top, left: position.left }}
    >
      {/* Project Title */}
      <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-3 pr-6">
        {project.title}
      </h3>

      {/* Status and Priority Badges */}
      <div className="flex items-center gap-2 mb-3">
        <span className={clsx(
          'flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium',
          getStatusColor(project.status)
        )}>
          {getStatusIcon(project.status)}
          <span className="capitalize">{project.status.replace('_', ' ')}</span>
        </span>
        <span className={clsx(
          'px-2 py-1 rounded-full text-xs font-medium',
          getPriorityColor(project.priority)
        )}>
          {project.priority.charAt(0).toUpperCase() + project.priority.slice(1)}
        </span>
      </div>

      {/* Description */}
      {project.description && (
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-2">
          {project.description}
        </p>
      )}

      {/* Progress */}
      {totalDeliverables > 0 && (
        <div className="mb-3">
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
            <span>Progress</span>
            <span>{completedDeliverables}/{totalDeliverables} tasks ({progressPercent}%)</span>
          </div>
          <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className={clsx(
                'h-full rounded-full transition-all duration-300',
                completedDeliverables === totalDeliverables
                  ? 'bg-green-500'
                  : 'bg-primary-500'
              )}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Due Date and Team */}
      <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400 mb-4">
        {project.due_date && (
          <div className="flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" />
            <span>Due {format(new Date(project.due_date), 'MMM d, yyyy')}</span>
          </div>
        )}
        {project.project_assignments && project.project_assignments.length > 0 && (
          <div className="flex items-center gap-1">
            <Users className="w-3.5 h-3.5" />
            <span>{project.project_assignments.length} member{project.project_assignments.length !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>

      {/* View Project Button */}
      <Button
        onClick={onViewProject}
        variant="primary"
        size="sm"
        className="w-full"
      >
        <span>View Project</span>
        <ChevronRight className="w-4 h-4 ml-1" />
      </Button>
    </div>
  )
}

export function MyTasksView({
  myTasks,
  onToggleDeliverable,
  onUpdateDueDate,
  onProjectSelect,
  getStatusIcon,
  getStatusColor,
  getPriorityColor
}: MyTasksViewProps) {
  const [activePopover, setActivePopover] = useState<{
    projectId: string
    position: { top: number; left: number }
  } | null>(null)

  const handleProjectClick = (e: React.MouseEvent, project: ProjectWithAssignments) => {
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()

    // Calculate position - show below and to the right of the click
    let top = rect.bottom + 8
    let left = rect.left

    // Adjust if would overflow right edge
    if (left + 320 > window.innerWidth - 16) {
      left = window.innerWidth - 320 - 16
    }

    // Adjust if would overflow bottom edge - show above instead
    if (top + 300 > window.innerHeight - 16) {
      top = rect.top - 300 - 8
    }

    setActivePopover({
      projectId: project.id,
      position: { top, left }
    })
  }

  const handleViewProject = (project: ProjectWithAssignments) => {
    setActivePopover(null)
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
                <button
                  onClick={(e) => handleProjectClick(e, project)}
                  className="text-xs text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors flex items-center gap-1"
                >
                  <span className="truncate max-w-[200px]">{project.title}</span>
                  <ExternalLink className="w-3 h-3 flex-shrink-0" />
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

      {/* Project Popover */}
      {activePopover && (
        <ProjectPopover
          project={myTasks.find(t => t.project.id === activePopover.projectId)!.project}
          position={activePopover.position}
          onClose={() => setActivePopover(null)}
          onViewProject={() => handleViewProject(
            myTasks.find(t => t.project.id === activePopover.projectId)!.project
          )}
          getStatusIcon={getStatusIcon}
          getStatusColor={getStatusColor}
          getPriorityColor={getPriorityColor}
        />
      )}
    </div>
  )
}
