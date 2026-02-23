import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FolderKanban, Plus, Calendar, CheckCircle, AlertCircle } from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { CreateProjectModal } from './CreateProjectModal'
import type { ProjectStatus, ProjectPriority, ProjectContextType } from '../../types/project'

interface RelatedProjectsProps {
  contextType: ProjectContextType
  contextId: string
  contextTitle?: string
  onProjectClick?: (projectId: string) => void
  /** When true, the component hides its own create buttons (parent places one in a section header). */
  hideCreateButton?: boolean
  /** Controlled open state for the create modal — lets the parent trigger it from an external button. */
  createModalOpen?: boolean
  /** Called when the externally-controlled create modal should close. */
  onCreateModalClose?: () => void
}

export function RelatedProjects({
  contextType,
  contextId,
  contextTitle,
  onProjectClick,
  hideCreateButton,
  createModalOpen,
  onCreateModalClose
}: RelatedProjectsProps) {
  const [showCreateModal, setShowCreateModal] = useState(false)
  const isModalOpen = createModalOpen ?? showCreateModal
  const closeModal = () => {
    setShowCreateModal(false)
    onCreateModalClose?.()
  }

  const { data: relatedProjects, isLoading } = useQuery({
    queryKey: ['entity-projects', contextType, contextId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select(`
          *,
          project_deliverables(id, completed)
        `)
        .eq('context_type', contextType)
        .eq('context_id', contextId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data || []
    }
  })

  const getStatusColor = (status: ProjectStatus) => {
    switch (status) {
      case 'planning':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
      case 'in_progress':
        return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
      case 'blocked':
        return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
      case 'completed':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400'
      case 'cancelled':
        return 'bg-gray-100 text-gray-600 dark:bg-gray-900/30 dark:text-gray-500'
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400'
    }
  }

  const getPriorityColor = (priority: ProjectPriority) => {
    switch (priority) {
      case 'urgent':
        return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
      case 'high':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400'
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
      case 'low':
        return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400'
    }
  }

  const calculateDeliverableProgress = (project: any) => {
    const deliverables = project.project_deliverables || []
    if (deliverables.length === 0) return null

    const completed = deliverables.filter((d: any) => d.completed).length
    const total = deliverables.length
    return { completed, total, percentage: Math.round((completed / total) * 100) }
  }

  if (isLoading) {
    return (
      <div className="space-y-1.5 py-1">
        {[1, 2].map((i) => (
          <div key={i} className="h-6 bg-gray-100 dark:bg-gray-700 rounded animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {relatedProjects && relatedProjects.length > 0 ? (
        <>
          {!hideCreateButton && (
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-gray-500">
                {relatedProjects.length} project{relatedProjects.length !== 1 ? 's' : ''}
              </span>
              <Button size="sm" variant="outline" onClick={() => setShowCreateModal(true)}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                New Project
              </Button>
            </div>
          )}
          <div className="divide-y divide-gray-100">
            {relatedProjects.map((project) => {
              const progress = calculateDeliverableProgress(project)
              const isOverdue = project.due_date && new Date(project.due_date) < new Date()

              return (
                <div
                  key={project.id}
                  className="flex items-center justify-between gap-3 py-1.5 cursor-pointer hover:bg-gray-50/50 -mx-1 px-1 rounded transition-colors"
                  onClick={() => onProjectClick?.(project.id)}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <FolderKanban className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    <span className="text-[13px] font-medium text-gray-900 dark:text-white truncate">
                      {project.title}
                    </span>
                    <span className={`inline-flex items-center gap-0.5 px-1.5 py-px rounded-full text-[10px] font-medium flex-shrink-0 ${getStatusColor(project.status)}`}>
                      {project.status === 'completed' && <CheckCircle className="w-2.5 h-2.5" />}
                      {project.status === 'blocked' && <AlertCircle className="w-2.5 h-2.5" />}
                      <span className="capitalize">{project.status.replace('_', ' ')}</span>
                    </span>
                    <span className={`px-1.5 py-px rounded-full text-[10px] font-medium flex-shrink-0 ${getPriorityColor(project.priority)}`}>
                      {project.priority}
                    </span>
                    {progress && (
                      <span className="text-[10px] text-gray-400 flex-shrink-0 tabular-nums">
                        {progress.completed}/{progress.total}
                      </span>
                    )}
                  </div>
                  {project.due_date && (
                    <span className={`text-[11px] flex-shrink-0 tabular-nums ${isOverdue ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
                      {format(new Date(project.due_date), 'MMM d')}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </>
      ) : (
        <div className="flex items-center gap-3 py-1">
          <span className="text-[13px] text-gray-400">No related projects.</span>
          {!hideCreateButton && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="text-[11px] font-medium text-primary-600 hover:text-primary-700 transition-colors"
            >
              Create First Project
            </button>
          )}
        </div>
      )}

      <CreateProjectModal
        isOpen={isModalOpen}
        onClose={closeModal}
        onSuccess={(projectId) => {
          closeModal()
          onProjectClick?.(projectId)
        }}
      />
    </div>
  )
}
