import { useQuery } from '@tanstack/react-query'
import { Calendar, Clock, AlertTriangle } from 'lucide-react'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { supabase } from '../../lib/supabase'
import { NoDataAvailable } from '../common/EmptyState'
import { format, formatDistanceToNow, isToday, isTomorrow, isThisWeek, addDays, startOfDay } from 'date-fns'
import type { ProjectWithAssignments, ProjectPriority } from '../../types/project'

interface UpcomingDeadlinesProps {
  onProjectSelect?: (project: ProjectWithAssignments) => void
}

export function UpcomingDeadlines({ onProjectSelect }: UpcomingDeadlinesProps) {
  const { data: projects, isLoading } = useQuery({
    queryKey: ['dashboard-project-deadlines'],
    queryFn: async () => {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id

      if (!userId) return []

      // Get projects with deadlines that are not completed/cancelled
      const { data, error } = await supabase
        .from('projects')
        .select(`
          *,
          project_assignments!inner(
            id,
            assigned_to,
            role
          ),
          project_deliverables(
            id,
            completed
          )
        `)
        .eq('project_assignments.assigned_to', userId)
        .not('due_date', 'is', null)
        .in('status', ['planning', 'in_progress', 'blocked'])
        .order('due_date', { ascending: true })

      if (error) throw error
      return data as ProjectWithAssignments[]
    }
  })

  const getPriorityColor = (priority: ProjectPriority) => {
    switch (priority) {
      case 'urgent': return 'error'
      case 'high': return 'warning'
      case 'medium': return 'primary'
      case 'low': return 'default'
      default: return 'default'
    }
  }

  const getDateCategory = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()

    if (date < now) return 'overdue'
    if (isToday(date)) return 'today'
    if (isTomorrow(date)) return 'tomorrow'
    if (isThisWeek(date)) return 'this_week'
    return 'later'
  }

  const getDateLabel = (dateStr: string) => {
    const date = new Date(dateStr)
    const category = getDateCategory(dateStr)

    switch (category) {
      case 'overdue':
        return { label: 'Overdue', color: 'text-error-600 bg-error-50', icon: AlertTriangle }
      case 'today':
        return { label: 'Due Today', color: 'text-warning-600 bg-warning-50', icon: AlertTriangle }
      case 'tomorrow':
        return { label: 'Due Tomorrow', color: 'text-blue-600 bg-blue-50', icon: Calendar }
      case 'this_week':
        return { label: `Due ${format(date, 'EEEE')}`, color: 'text-primary-600 bg-primary-50', icon: Calendar }
      default:
        return { label: `Due ${format(date, 'MMM d')}`, color: 'text-gray-600 bg-gray-50', icon: Calendar }
    }
  }

  // Group projects by date category
  const groupedProjects = projects?.reduce((acc, project) => {
    if (!project.due_date) return acc
    const category = getDateCategory(project.due_date)
    if (!acc[category]) acc[category] = []
    acc[category].push(project)
    return acc
  }, {} as Record<string, ProjectWithAssignments[]>) || {}

  const categoryOrder = ['overdue', 'today', 'tomorrow', 'this_week', 'later']
  const sortedCategories = categoryOrder.filter(cat => groupedProjects[cat]?.length > 0)

  if (isLoading) {
    return (
      <Card>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Upcoming Deadlines</h2>
          <p className="text-sm text-gray-500">Projects due soon</p>
        </div>
        <div className="animate-pulse space-y-3">
          <div className="h-16 bg-gray-200 rounded"></div>
          <div className="h-16 bg-gray-200 rounded"></div>
          <div className="h-16 bg-gray-200 rounded"></div>
        </div>
      </Card>
    )
  }

  const totalUpcoming = projects?.length || 0

  return (
    <Card>
      <div className="mb-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Upcoming Deadlines</h2>
            <p className="text-sm text-gray-500">Projects due soon</p>
          </div>
          {totalUpcoming > 0 && (
            <Badge variant="primary">{totalUpcoming}</Badge>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {sortedCategories.length > 0 ? (
          sortedCategories.map(category => {
            const categoryProjects = groupedProjects[category] || []
            if (categoryProjects.length === 0) return null

            // Get the label for the first project in this category (they all share the same category)
            const firstProject = categoryProjects[0]
            const dateInfo = firstProject.due_date ? getDateLabel(firstProject.due_date) : null

            return (
              <div key={category}>
                {dateInfo && (
                  <div className={`flex items-center space-x-2 mb-2 px-2 py-1 rounded ${dateInfo.color}`}>
                    <dateInfo.icon className="h-4 w-4" />
                    <span className="text-xs font-semibold uppercase tracking-wide">
                      {dateInfo.label}
                    </span>
                    <span className="text-xs">({categoryProjects.length})</span>
                  </div>
                )}

                <div className="space-y-2">
                  {categoryProjects.map(project => {
                    const completedDeliverables = project.project_deliverables?.filter(d => d.completed).length || 0
                    const totalDeliverables = project.project_deliverables?.length || 0

                    return (
                      <div
                        key={project.id}
                        onClick={() => onProjectSelect?.(project)}
                        className="p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors"
                      >
                        <div className="flex items-start justify-between mb-1">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center space-x-2">
                              <span className="font-semibold text-gray-900 truncate text-sm">
                                {project.title}
                              </span>
                              <Badge variant={getPriorityColor(project.priority)} size="sm">
                                {project.priority}
                              </Badge>
                            </div>
                            {project.description && (
                              <p className="text-xs text-gray-600 line-clamp-1 mt-1">
                                {project.description}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-xs mt-2">
                          <div className="flex items-center space-x-2 text-gray-600">
                            <Clock className="h-3 w-3" />
                            <span>
                              {project.due_date && formatDistanceToNow(new Date(project.due_date), { addSuffix: true })}
                            </span>
                          </div>

                          {totalDeliverables > 0 && (
                            <div className="text-gray-600">
                              {completedDeliverables}/{totalDeliverables} tasks
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })
        ) : (
          <NoDataAvailable message="No upcoming deadlines" compact />
        )}
      </div>
    </Card>
  )
}
