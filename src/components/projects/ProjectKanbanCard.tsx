import { Calendar, CheckCircle, Tag, Users } from 'lucide-react'
import { formatDistanceToNow, differenceInDays } from 'date-fns'
import { clsx } from 'clsx'
import type { ProjectWithAssignments, ProjectPriority } from '../../types/project'

interface ProjectKanbanCardProps {
  project: ProjectWithAssignments
  onClick: () => void
  isDragging?: boolean
}

export function ProjectKanbanCard({ project, onClick, isDragging }: ProjectKanbanCardProps) {
  const totalDeliverables = project.project_deliverables?.length || 0
  const completedDeliverables = project.project_deliverables?.filter(d => d.completed).length || 0
  const assignmentCount = project.project_assignments?.length || 0
  const isOverdue = project.due_date && new Date(project.due_date) < new Date() && project.status !== 'completed'

  const getPriorityColor = (priority: ProjectPriority) => {
    switch (priority) {
      case 'urgent': return 'border-red-500'
      case 'high': return 'border-orange-500'
      case 'medium': return 'border-yellow-500'
      case 'low': return 'border-gray-400'
    }
  }

  const getPriorityBgColor = (priority: ProjectPriority) => {
    switch (priority) {
      case 'urgent': return 'bg-red-500'
      case 'high': return 'bg-orange-500'
      case 'medium': return 'bg-yellow-500'
      case 'low': return 'bg-gray-400'
    }
  }

  const getPriorityLabel = (priority: ProjectPriority) => {
    switch (priority) {
      case 'urgent': return 'Urgent'
      case 'high': return 'High'
      case 'medium': return 'Med'
      case 'low': return 'Low'
    }
  }

  return (
    <div
      onClick={onClick}
      className={clsx(
        'bg-white dark:bg-gray-800 rounded-lg p-3 shadow-sm border-2',
        getPriorityColor(project.priority),
        'hover:shadow-md transition-all cursor-pointer group',
        isDragging && 'opacity-50 rotate-2'
      )}
    >
      {/* Priority badge in upper left */}
      <div className="flex items-start gap-2 mb-2">
        <span className={clsx(
          'px-2 py-0.5 rounded text-xs font-semibold text-white',
          getPriorityBgColor(project.priority)
        )}>
          {getPriorityLabel(project.priority)}
        </span>
      </div>

      {/* Title */}
      <h4 className="font-medium text-gray-900 dark:text-white text-sm mb-2 line-clamp-2 group-hover:text-primary-600 dark:group-hover:text-primary-400">
        {project.title}
      </h4>

      {/* Tags */}
      {project.project_tag_assignments && project.project_tag_assignments.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {project.project_tag_assignments.slice(0, 2).map((assignment: any) => (
            <span
              key={assignment.id}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium"
              style={{
                backgroundColor: assignment.project_tags.color + '15',
                color: assignment.project_tags.color
              }}
            >
              <Tag className="w-2.5 h-2.5" />
              {assignment.project_tags.name}
            </span>
          ))}
          {project.project_tag_assignments.length > 2 && (
            <span className="text-xs text-gray-500">+{project.project_tag_assignments.length - 2}</span>
          )}
        </div>
      )}

      {/* Meta info */}
      <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
        {/* Due date */}
        {project.due_date && (
          <div className={clsx('flex items-center gap-1', isOverdue && 'text-red-600 dark:text-red-400 font-medium')}>
            <Calendar className="w-3 h-3" />
            <span>{Math.abs(differenceInDays(new Date(project.due_date), new Date()))}d</span>
          </div>
        )}

        {/* Deliverables */}
        {totalDeliverables > 0 && (
          <div className="flex items-center gap-1">
            <CheckCircle className="w-3 h-3" />
            <span>{completedDeliverables}/{totalDeliverables}</span>
          </div>
        )}

        {/* Team */}
        {assignmentCount > 0 && (
          <div className="flex items-center gap-1">
            <Users className="w-3 h-3" />
            <span>{assignmentCount}</span>
          </div>
        )}
      </div>
    </div>
  )
}
