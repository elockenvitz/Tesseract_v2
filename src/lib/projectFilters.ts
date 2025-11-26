import { startOfToday, endOfToday, startOfWeek, endOfWeek, startOfMonth, endOfMonth, isBefore } from 'date-fns'
import type { ProjectWithAssignments } from '../types/project'
import type { ProjectFilters } from '../components/projects/ProjectFilterPanel'

/**
 * Apply all filters to a project list
 */
export function applyProjectFilters(
  projects: ProjectWithAssignments[],
  filters: ProjectFilters,
  userId?: string
): ProjectWithAssignments[] {
  return projects.filter(project => {
    // Status filter
    if (filters.status !== 'all' && project.status !== filters.status) {
      return false
    }

    // Priority filter
    if (filters.priority !== 'all' && project.priority !== filters.priority) {
      return false
    }

    // Assignment filter
    if (filters.assignment !== 'all' && userId) {
      if (filters.assignment === 'created' && project.created_by !== userId) {
        return false
      }
      if (filters.assignment === 'assigned') {
        const isAssigned = project.project_assignments?.some(
          a => a.assigned_to === userId
        )
        if (!isAssigned) return false
      }
    }

    // Context type filter
    if (filters.contextType !== 'all' && project.context_type !== filters.contextType) {
      return false
    }

    // Due date range filter
    if (filters.dueDateRange !== 'all' && project.due_date) {
      const dueDate = new Date(project.due_date)
      const now = new Date()

      switch (filters.dueDateRange) {
        case 'overdue':
          if (dueDate >= now) return false
          break

        case 'today':
          const todayStart = startOfToday()
          const todayEnd = endOfToday()
          if (dueDate < todayStart || dueDate > todayEnd) return false
          break

        case 'this_week':
          const weekStart = startOfWeek(now)
          const weekEnd = endOfWeek(now)
          if (dueDate < weekStart || dueDate > weekEnd) return false
          break

        case 'this_month':
          const monthStart = startOfMonth(now)
          const monthEnd = endOfMonth(now)
          if (dueDate < monthStart || dueDate > monthEnd) return false
          break

        case 'custom':
          if (filters.dueDateFrom) {
            const fromDate = new Date(filters.dueDateFrom)
            if (dueDate < fromDate) return false
          }
          if (filters.dueDateTo) {
            const toDate = new Date(filters.dueDateTo)
            if (dueDate > toDate) return false
          }
          break
      }
    }

    // Has deliverables filter
    if (filters.hasDeliverables === true) {
      const hasDeliverables = project.project_deliverables && project.project_deliverables.length > 0
      if (!hasDeliverables) return false
    }

    return true
  })
}

/**
 * Count active filters
 */
export function countActiveFilters(filters: ProjectFilters): number {
  let count = 0

  if (filters.status !== 'all') count++
  if (filters.priority !== 'all') count++
  if (filters.assignment !== 'all') count++
  if (filters.contextType !== 'all') count++
  if (filters.dueDateRange !== 'all') count++
  if (filters.hasDeliverables === true) count++

  return count
}

/**
 * Get default filters
 */
export function getDefaultFilters(): ProjectFilters {
  return {
    status: 'all',
    priority: 'all',
    assignment: 'all',
    contextType: 'all',
    dueDateRange: 'all',
    hasDeliverables: undefined,
    tags: []
  }
}

/**
 * Calculate project counts for quick filter presets
 */
export function calculatePresetCounts(
  projects: ProjectWithAssignments[],
  userId?: string
) {
  const now = new Date()
  const weekStart = startOfWeek(now)
  const weekEnd = endOfWeek(now)

  return {
    myProjects: projects.filter(p =>
      p.project_assignments?.some(a => a.assigned_to === userId)
    ).length,
    urgent: projects.filter(p =>
      p.priority === 'urgent' && p.status === 'in_progress'
    ).length,
    dueThisWeek: projects.filter(p => {
      if (!p.due_date) return false
      const dueDate = new Date(p.due_date)
      return dueDate >= weekStart && dueDate <= weekEnd
    }).length,
    blocked: projects.filter(p => p.status === 'blocked').length,
    inProgress: projects.filter(p => p.status === 'in_progress').length,
    completed: projects.filter(p => p.status === 'completed').length
  }
}
