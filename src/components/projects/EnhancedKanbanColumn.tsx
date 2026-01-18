import React from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import {
  Circle,
  Clock,
  AlertCircle,
  CheckCircle,
  Ban
} from 'lucide-react'
import { clsx } from 'clsx'
import { EnhancedKanbanCard } from './EnhancedKanbanCard'
import type { ProjectWithAssignments, ProjectStatus } from '../../types/project'

interface EnhancedKanbanColumnProps {
  status: ProjectStatus
  projects: (ProjectWithAssignments & { board_position?: number })[]
  onProjectSelect?: (project: ProjectWithAssignments) => void
  blockingStatus?: Map<string, { isBlocked: boolean; blockedBy: string[]; blocking: string[] }>
  wipLimit?: number
}

const statusConfig: Record<ProjectStatus, {
  label: string
  icon: typeof Circle
  bgColor: string
  textColor: string
}> = {
  planning: {
    label: 'Planning',
    icon: Circle,
    bgColor: 'bg-gray-100 dark:bg-gray-800',
    textColor: 'text-gray-600 dark:text-gray-400'
  },
  in_progress: {
    label: 'In Progress',
    icon: Clock,
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
    textColor: 'text-blue-600 dark:text-blue-400'
  },
  blocked: {
    label: 'Blocked',
    icon: AlertCircle,
    bgColor: 'bg-red-50 dark:bg-red-900/20',
    textColor: 'text-red-600 dark:text-red-400'
  },
  completed: {
    label: 'Completed',
    icon: CheckCircle,
    bgColor: 'bg-green-50 dark:bg-green-900/20',
    textColor: 'text-green-600 dark:text-green-400'
  },
  cancelled: {
    label: 'Cancelled',
    icon: Ban,
    bgColor: 'bg-gray-50 dark:bg-gray-900/20',
    textColor: 'text-gray-500 dark:text-gray-500'
  }
}

export function EnhancedKanbanColumn({
  status,
  projects,
  onProjectSelect,
  blockingStatus,
  wipLimit
}: EnhancedKanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: status
  })

  const config = statusConfig[status]
  const StatusIcon = config.icon
  const isOverWipLimit = wipLimit !== undefined && projects.length > wipLimit
  const isAtWipLimit = wipLimit !== undefined && projects.length === wipLimit

  // Sort projects by board_position
  const sortedProjects = [...projects].sort((a, b) =>
    (a.board_position ?? 0) - (b.board_position ?? 0)
  )

  const projectIds = sortedProjects.map(p => p.id)

  return (
    <div
      ref={setNodeRef}
      className={clsx(
        'flex-1 min-w-0 bg-white dark:bg-gray-800 rounded-lg flex flex-col transition-all duration-200',
        isOver && 'ring-2 ring-primary-500 bg-primary-50 dark:bg-primary-900/20'
      )}
    >
      {/* Column Header */}
      <div className={clsx(
        'px-3 py-3 rounded-t-lg',
        config.bgColor
      )}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusIcon className={clsx('w-4 h-4', config.textColor)} />
            <h3 className={clsx('font-semibold', config.textColor)}>
              {config.label}
            </h3>
            <span className={clsx(
              'text-xs px-2 py-0.5 rounded-full font-medium',
              isOverWipLimit
                ? 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'
                : isAtWipLimit
                ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300'
                : 'bg-white/50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-400'
            )}>
              {projects.length}
              {wipLimit !== undefined && `/${wipLimit}`}
            </span>
          </div>
        </div>

        {/* WIP Limit Warning */}
        {isOverWipLimit && (
          <p className="text-xs text-red-600 dark:text-red-400 mt-1">
            Over WIP limit! Consider completing tasks before adding more.
          </p>
        )}
      </div>

      {/* Cards Container */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[200px]">
        <SortableContext items={projectIds} strategy={verticalListSortingStrategy}>
          {sortedProjects.map((project) => {
            const status = blockingStatus?.get(project.id)
            const isBlocked = status?.isBlocked ?? false
            const blockedByCount = status?.blockedBy?.length ?? 0
            const isBlocking = (status?.blocking?.length ?? 0) > 0
            const blockingCount = status?.blocking?.length ?? 0

            return (
              <EnhancedKanbanCard
                key={project.id}
                project={project}
                onClick={() => onProjectSelect?.({
                  id: project.id,
                  title: project.title,
                  type: 'project',
                  data: project
                } as any)}
                isBlocked={isBlocked}
                isBlocking={isBlocking}
                blockedByCount={blockedByCount}
                blockingCount={blockingCount}
              />
            )
          })}
        </SortableContext>

        {/* Empty State */}
        {projects.length === 0 && (
          <div className={clsx(
            'h-full min-h-[100px] flex items-center justify-center rounded-lg border-2 border-dashed',
            isOver
              ? 'border-primary-400 bg-primary-50/50 dark:bg-primary-900/10'
              : 'border-gray-200 dark:border-gray-700'
          )}>
            <p className="text-sm text-gray-400 dark:text-gray-500">
              {isOver ? 'Drop here' : 'No projects'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
