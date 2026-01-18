import React from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Users,
  Lock,
  AlertTriangle,
  Zap,
  ArrowUp,
  Minus,
  Circle
} from 'lucide-react'
import { Card } from '../ui/Card'
import { DatePicker } from '../ui/DatePicker'
import { clsx } from 'clsx'
import { supabase } from '../../lib/supabase'
import type { ProjectWithAssignments, ProjectPriority } from '../../types/project'

interface EnhancedKanbanCardProps {
  project: ProjectWithAssignments & { board_position?: number }
  onClick?: () => void
  isBlocked?: boolean
  isBlocking?: boolean
  blockedByCount?: number
  blockingCount?: number
}

export function EnhancedKanbanCard({
  project,
  onClick,
  isBlocked = false,
  isBlocking = false,
  blockedByCount = 0,
  blockingCount = 0
}: EnhancedKanbanCardProps) {
  const queryClient = useQueryClient()

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: project.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : 'auto'
  }

  // Update due date mutation
  const updateDueDateMutation = useMutation({
    mutationFn: async (newDate: string | null) => {
      const { error } = await supabase
        .from('projects')
        .update({ due_date: newDate })
        .eq('id', project.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    }
  })

  const totalDeliverables = project.project_deliverables?.length || 0
  const completedDeliverables = project.project_deliverables?.filter(d => d.completed).length || 0
  const assignmentCount = project.project_assignments?.length || 0

  const getPriorityBorderColor = (priority: ProjectPriority) => {
    switch (priority) {
      case 'urgent': return 'border-l-red-500'
      case 'high': return 'border-l-orange-500'
      case 'medium': return 'border-l-yellow-500'
      case 'low': return 'border-l-gray-400'
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

  const getPriorityIcon = (priority: ProjectPriority) => {
    switch (priority) {
      case 'urgent': return <Zap className="w-3 h-3" />
      case 'high': return <ArrowUp className="w-3 h-3" />
      case 'medium': return <Minus className="w-3 h-3" />
      case 'low': return <Circle className="w-3 h-3" />
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
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={clsx(
        'kanban-card touch-none cursor-grab active:cursor-grabbing',
        isDragging && 'kanban-card-dragging'
      )}
    >
      <Card
        className={clsx(
          'p-0 hover:shadow-md transition-all border-l-3',
          getPriorityBorderColor(project.priority),
          isDragging && 'shadow-2xl ring-2 ring-primary-500',
          isBlocked && 'ring-1 ring-red-400 bg-red-50/50 dark:bg-red-900/10'
        )}
        onClick={onClick}
      >
        <div className="px-2 py-1">
          {/* Title row with priority badge and blocking indicators */}
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className={clsx(
              'px-1.5 py-0.5 rounded text-xs font-semibold text-white flex-shrink-0',
              getPriorityBgColor(project.priority)
            )}>
              {getPriorityLabel(project.priority)}
            </span>
            <h4 className="font-medium text-gray-900 dark:text-white text-sm truncate flex-1">
              {project.title}
            </h4>
            {isBlocked && (
              <Lock className="w-3.5 h-3.5 text-red-500 flex-shrink-0" title={`Blocked by ${blockedByCount} project${blockedByCount !== 1 ? 's' : ''}`} />
            )}
            {isBlocking && !isBlocked && (
              <AlertTriangle className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0" title={`Blocking ${blockingCount} project${blockingCount !== 1 ? 's' : ''}`} />
            )}
          </div>

          {/* Progress Bar (compact) */}
          {totalDeliverables > 0 && (
            <div className="flex items-center gap-1.5 mb-0.5">
              <div className="flex-1 h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={clsx(
                    'h-full rounded-full',
                    completedDeliverables === totalDeliverables ? 'bg-green-500' : 'bg-primary-500'
                  )}
                  style={{ width: `${(completedDeliverables / totalDeliverables) * 100}%` }}
                />
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                {completedDeliverables}/{totalDeliverables}
              </span>
            </div>
          )}

          {/* Footer: Due Date & Team */}
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <div onClick={(e) => e.stopPropagation()}>
              <DatePicker
                value={project.due_date}
                onChange={(date) => updateDueDateMutation.mutate(date)}
                placeholder="Set date"
                compact
                showClear={false}
                showOverdue
                isCompleted={project.status === 'completed'}
              />
            </div>
            {assignmentCount > 0 && (
              <div className="flex items-center gap-0.5">
                <Users className="w-3 h-3" />
                <span>{assignmentCount}</span>
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  )
}

// Static card for drag overlay (doesn't need sortable hooks)
export function EnhancedKanbanCardOverlay({
  project,
  isBlocked = false,
  isBlocking = false
}: Omit<EnhancedKanbanCardProps, 'onClick'>) {
  const getPriorityBorderColor = (priority: ProjectPriority) => {
    switch (priority) {
      case 'urgent': return 'border-l-red-500'
      case 'high': return 'border-l-orange-500'
      case 'medium': return 'border-l-yellow-500'
      case 'low': return 'border-l-gray-400'
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
    <Card
      className={clsx(
        'p-0 shadow-2xl border-l-3 w-[220px] rotate-3 scale-105',
        getPriorityBorderColor(project.priority),
        isBlocked && 'ring-1 ring-red-400'
      )}
    >
      <div className="px-2 py-1">
        <div className="flex items-center gap-1.5">
          <span className={clsx(
            'px-1.5 py-0.5 rounded text-xs font-semibold text-white flex-shrink-0',
            getPriorityBgColor(project.priority)
          )}>
            {getPriorityLabel(project.priority)}
          </span>
          <h4 className="font-medium text-gray-900 dark:text-white text-sm truncate">
            {project.title}
          </h4>
        </div>
      </div>
    </Card>
  )
}
