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
}

export function RelatedProjects({
  contextType,
  contextId,
  contextTitle,
  onProjectClick
}: RelatedProjectsProps) {
  const [showCreateModal, setShowCreateModal] = useState(false)

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
      <div className="space-y-4">
        {[1, 2].map((i) => (
          <Card key={i} padding="md" className="animate-pulse">
            <div className="h-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {relatedProjects && relatedProjects.length > 0 ? (
        <>
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-gray-900 dark:text-white">
              {relatedProjects.length} Related Project{relatedProjects.length !== 1 ? 's' : ''}
            </h4>
            <Button size="sm" variant="outline" onClick={() => setShowCreateModal(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Project
            </Button>
          </div>
          <div className="space-y-3">
            {relatedProjects.map((project) => {
              const progress = calculateDeliverableProgress(project)
              const isOverdue = project.due_date && new Date(project.due_date) < new Date()

              return (
                <Card
                  key={project.id}
                  padding="md"
                  className="cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => onProjectClick?.(project.id)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center flex-shrink-0">
                        <FolderKanban className="w-5 h-5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-gray-900 dark:text-white mb-1 truncate">
                          {project.title}
                        </h4>
                        {project.description && (
                          <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2 mb-2">
                            {project.description}
                          </p>
                        )}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(project.status)}`}>
                            {project.status === 'completed' && <CheckCircle className="w-3 h-3" />}
                            {project.status === 'blocked' && <AlertCircle className="w-3 h-3" />}
                            <span className="capitalize">{project.status.replace('_', ' ')}</span>
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getPriorityColor(project.priority)}`}>
                            {project.priority}
                          </span>
                          {progress && (
                            <span className="text-xs text-gray-600 dark:text-gray-400">
                              {progress.completed}/{progress.total} deliverables
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      {project.due_date && (
                        <div className={`flex items-center gap-1 text-sm ${isOverdue ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-600 dark:text-gray-400'}`}>
                          <Calendar className="w-4 h-4" />
                          <div>
                            <div className="text-xs">{format(new Date(project.due_date), 'MMM d')}</div>
                            <div className="text-xs">
                              {isOverdue ? 'overdue' : formatDistanceToNow(new Date(project.due_date), { addSuffix: true })}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        </>
      ) : (
        <div className="text-center py-12">
          <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto mb-4">
            <FolderKanban className="h-8 w-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No related projects</h3>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            Projects related to this {contextType} will appear here.
          </p>
          <Button size="sm" onClick={() => setShowCreateModal(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create First Project
          </Button>
        </div>
      )}

      <CreateProjectModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={(projectId) => {
          setShowCreateModal(false)
          onProjectClick?.(projectId)
        }}
      />
    </div>
  )
}
