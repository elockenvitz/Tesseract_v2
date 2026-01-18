import React, { useState, useMemo } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useAllProjectDependencies } from '../../hooks/useProjectDependencies'
import { EnhancedKanbanColumn } from './EnhancedKanbanColumn'
import { EnhancedKanbanCardOverlay } from './EnhancedKanbanCard'
import type { ProjectWithAssignments, ProjectStatus } from '../../types/project'

interface EnhancedKanbanBoardProps {
  projects: (ProjectWithAssignments & { board_position?: number })[]
  onProjectSelect?: (project: any) => void
  wipLimits?: Partial<Record<ProjectStatus, number>>
}

const BOARD_STATUSES: ProjectStatus[] = ['planning', 'in_progress', 'blocked', 'completed']

export function EnhancedKanbanBoard({
  projects,
  onProjectSelect,
  wipLimits = { in_progress: 5 }
}: EnhancedKanbanBoardProps) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { blockingStatus } = useAllProjectDependencies()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8
      }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )

  // Group projects by status
  const projectsByStatus = useMemo(() => {
    const grouped: Record<ProjectStatus, (ProjectWithAssignments & { board_position?: number })[]> = {
      planning: [],
      in_progress: [],
      blocked: [],
      completed: [],
      cancelled: []
    }

    projects.forEach(project => {
      if (grouped[project.status]) {
        grouped[project.status].push(project)
      }
    })

    // Sort each group by board_position
    Object.keys(grouped).forEach(status => {
      grouped[status as ProjectStatus].sort((a, b) =>
        (a.board_position ?? 0) - (b.board_position ?? 0)
      )
    })

    return grouped
  }, [projects])

  // Find the active project for drag overlay
  const activeProject = useMemo(() => {
    if (!activeId) return null
    return projects.find(p => p.id === activeId)
  }, [activeId, projects])

  // Update project status mutation
  const updateStatusMutation = useMutation({
    mutationFn: async ({
      projectId,
      status,
      boardPosition
    }: {
      projectId: string
      status: ProjectStatus
      boardPosition?: number
    }) => {
      const updateData: any = { status }
      if (boardPosition !== undefined) {
        updateData.board_position = boardPosition
      }

      const { error } = await supabase
        .from('projects')
        .update(updateData)
        .eq('id', projectId)

      if (error) throw error
    },
    onMutate: async ({ projectId, status, boardPosition }) => {
      await queryClient.cancelQueries({ queryKey: ['projects'] })

      const previousProjects = queryClient.getQueryData(['projects', user?.id, 'active'])

      queryClient.setQueryData(['projects', user?.id, 'active'], (old: any) => {
        if (!old) return old
        return old.map((project: any) =>
          project.id === projectId
            ? { ...project, status, board_position: boardPosition ?? project.board_position }
            : project
        )
      })

      return { previousProjects }
    },
    onError: (err, variables, context) => {
      if (context?.previousProjects) {
        queryClient.setQueryData(['projects', user?.id, 'active'], context.previousProjects)
      }
      console.error('Failed to update project:', err)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    }
  })

  // Update board positions mutation
  const updatePositionsMutation = useMutation({
    mutationFn: async (updates: { id: string; board_position: number }[]) => {
      const promises = updates.map(({ id, board_position }) =>
        supabase
          .from('projects')
          .update({ board_position })
          .eq('id', id)
      )

      const results = await Promise.all(promises)
      const errors = results.filter(r => r.error)
      if (errors.length > 0) {
        throw new Error('Failed to update positions')
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    }
  })

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }

  const handleDragOver = (event: DragOverEvent) => {
    setOverId(event.over?.id as string | null)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    setActiveId(null)
    setOverId(null)

    if (!over) return

    const activeProjectId = active.id as string
    const overId = over.id as string

    // Find the project being dragged
    const draggedProject = projects.find(p => p.id === activeProjectId)
    if (!draggedProject) return

    // Check if dropped on a column (status)
    if (BOARD_STATUSES.includes(overId as ProjectStatus)) {
      const newStatus = overId as ProjectStatus

      if (draggedProject.status !== newStatus) {
        // Get the projects in the target column
        const targetProjects = projectsByStatus[newStatus]
        const newPosition = targetProjects.length // Add to the end

        updateStatusMutation.mutate({
          projectId: activeProjectId,
          status: newStatus,
          boardPosition: newPosition
        })
      }
      return
    }

    // Dropped on another card - reorder within or across columns
    const overProject = projects.find(p => p.id === overId)
    if (!overProject) return

    const oldStatus = draggedProject.status
    const newStatus = overProject.status

    if (oldStatus === newStatus) {
      // Same column - reorder
      const columnProjects = [...projectsByStatus[oldStatus]]
      const oldIndex = columnProjects.findIndex(p => p.id === activeProjectId)
      const newIndex = columnProjects.findIndex(p => p.id === overId)

      if (oldIndex !== newIndex) {
        const reordered = arrayMove(columnProjects, oldIndex, newIndex)
        const updates = reordered.map((p, index) => ({
          id: p.id,
          board_position: index
        }))

        updatePositionsMutation.mutate(updates)
      }
    } else {
      // Different column - move and insert at position
      const targetProjects = [...projectsByStatus[newStatus]]
      const insertIndex = targetProjects.findIndex(p => p.id === overId)

      updateStatusMutation.mutate({
        projectId: activeProjectId,
        status: newStatus,
        boardPosition: insertIndex >= 0 ? insertIndex : targetProjects.length
      })

      // Update positions of other cards in target column
      const updatedTargetProjects = [
        ...targetProjects.slice(0, insertIndex),
        draggedProject,
        ...targetProjects.slice(insertIndex)
      ]
      const positionUpdates = updatedTargetProjects
        .filter(p => p.id !== activeProjectId)
        .map((p, index) => ({
          id: p.id,
          board_position: index >= insertIndex ? index + 1 : index
        }))

      if (positionUpdates.length > 0) {
        updatePositionsMutation.mutate(positionUpdates)
      }
    }
  }

  const handleDragCancel = () => {
    setActiveId(null)
    setOverId(null)
  }

  const activeBlockingStatus = activeProject ? blockingStatus.get(activeProject.id) : undefined

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="h-full p-4">
        <div className="flex gap-4 h-full overflow-x-auto pb-4">
          {BOARD_STATUSES.map(status => (
            <EnhancedKanbanColumn
              key={status}
              status={status}
              projects={projectsByStatus[status]}
              onProjectSelect={onProjectSelect}
              blockingStatus={blockingStatus}
              wipLimit={wipLimits[status]}
            />
          ))}
        </div>
      </div>

      <DragOverlay dropAnimation={{
        duration: 200,
        easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)'
      }}>
        {activeProject && (
          <EnhancedKanbanCardOverlay
            project={activeProject}
            isBlocked={activeBlockingStatus?.isBlocked}
            isBlocking={(activeBlockingStatus?.blocking?.length ?? 0) > 0}
          />
        )}
      </DragOverlay>
    </DndContext>
  )
}
