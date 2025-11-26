import { useState } from 'react'
import { Circle, Clock, AlertCircle, CheckCircle } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { ProjectKanbanCard } from './ProjectKanbanCard'
import type { ProjectWithAssignments, ProjectStatus } from '../../types/project'
import { clsx } from 'clsx'

interface ProjectKanbanBoardProps {
  projects: ProjectWithAssignments[]
  onProjectSelect: (project: any) => void
}

const STATUSES: { id: ProjectStatus; label: string; icon: any; color: string }[] = [
  { id: 'planning', label: 'Planning', icon: Circle, color: 'bg-gray-100 text-gray-700' },
  { id: 'in_progress', label: 'In Progress', icon: Clock, color: 'bg-blue-100 text-blue-700' },
  { id: 'blocked', label: 'Blocked', icon: AlertCircle, color: 'bg-red-100 text-red-700' },
  { id: 'completed', label: 'Completed', icon: CheckCircle, color: 'bg-green-100 text-green-700' }
]

export function ProjectKanbanBoard({ projects, onProjectSelect }: ProjectKanbanBoardProps) {
  const queryClient = useQueryClient()
  const [draggedProject, setDraggedProject] = useState<string | null>(null)
  const [draggedOverStatus, setDraggedOverStatus] = useState<ProjectStatus | null>(null)

  const updateStatusMutation = useMutation({
    mutationFn: async ({ projectId, status }: { projectId: string; status: ProjectStatus }) => {
      const { error } = await supabase
        .from('projects')
        .update({ status })
        .eq('id', projectId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    }
  })

  const handleDragStart = (projectId: string) => {
    setDraggedProject(projectId)
  }

  const handleDragEnd = () => {
    setDraggedProject(null)
    setDraggedOverStatus(null)
  }

  const handleDragOver = (e: React.DragEvent, status: ProjectStatus) => {
    e.preventDefault()
    setDraggedOverStatus(status)
  }

  const handleDragLeave = () => {
    setDraggedOverStatus(null)
  }

  const handleDrop = (e: React.DragEvent, status: ProjectStatus) => {
    e.preventDefault()
    if (draggedProject) {
      updateStatusMutation.mutate({ projectId: draggedProject, status })
    }
    setDraggedProject(null)
    setDraggedOverStatus(null)
  }

  return (
    <div className="flex gap-4 h-full overflow-x-auto p-4">
      {STATUSES.map(status => {
        const statusProjects = projects.filter(p => p.status === status.id)
        const Icon = status.icon
        const isDropTarget = draggedOverStatus === status.id

        return (
          <div
            key={status.id}
            className={clsx(
              'flex-shrink-0 w-80 bg-gray-50 dark:bg-gray-900 rounded-lg flex flex-col transition-all',
              isDropTarget && 'ring-2 ring-primary-500 bg-primary-50 dark:bg-primary-900/20'
            )}
            onDragOver={(e) => handleDragOver(e, status.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, status.id)}
          >
            {/* Column header */}
            <div className="p-3 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={clsx('p-1.5 rounded', status.color)}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <h3 className="font-semibold text-gray-900 dark:text-white text-sm">
                    {status.label}
                  </h3>
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 px-2 py-0.5 rounded-full">
                  {statusProjects.length}
                </span>
              </div>
            </div>

            {/* Cards */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[200px]">
              {statusProjects.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-gray-400 dark:text-gray-600 text-sm">
                  No projects
                </div>
              ) : (
                statusProjects.map(project => (
                  <div
                    key={project.id}
                    draggable
                    onDragStart={() => handleDragStart(project.id)}
                    onDragEnd={handleDragEnd}
                  >
                    <ProjectKanbanCard
                      project={project}
                      onClick={() => onProjectSelect({
                        id: project.id,
                        title: project.title,
                        type: 'project',
                        data: project
                      })}
                      isDragging={draggedProject === project.id}
                    />
                  </div>
                ))
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
