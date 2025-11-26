import { useQuery } from '@tanstack/react-query'
import { FolderKanban, Clock, AlertCircle, CheckCircle2, Users, TrendingUp } from 'lucide-react'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { supabase } from '../../lib/supabase'
import { NoDataAvailable } from '../common/EmptyState'
import { formatDistanceToNow } from 'date-fns'
import type { ProjectWithAssignments, ProjectStatus, ProjectPriority } from '../../types/project'

interface ProjectOverviewWidgetProps {
  onProjectSelect?: (project: ProjectWithAssignments) => void
}

export function ProjectOverviewWidget({ onProjectSelect }: ProjectOverviewWidgetProps) {
  const { data: projects, isLoading } = useQuery({
    queryKey: ['dashboard-projects'],
    queryFn: async () => {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id

      if (!userId) return []

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
        .order('updated_at', { ascending: false })

      if (error) throw error
      return data as ProjectWithAssignments[]
    }
  })

  // Calculate stats
  const stats = {
    total: projects?.length || 0,
    inProgress: projects?.filter(p => p.status === 'in_progress').length || 0,
    blocked: projects?.filter(p => p.status === 'blocked').length || 0,
    completed: projects?.filter(p => p.status === 'completed').length || 0,
    urgent: projects?.filter(p => p.priority === 'urgent').length || 0,
    dueToday: projects?.filter(p => {
      if (!p.due_date) return false
      const dueDate = new Date(p.due_date)
      const today = new Date()
      return dueDate.toDateString() === today.toDateString()
    }).length || 0,
    overdue: projects?.filter(p => {
      if (!p.due_date || p.status === 'completed' || p.status === 'cancelled') return false
      return new Date(p.due_date) < new Date()
    }).length || 0
  }

  // Get active projects (not completed or cancelled)
  const activeProjects = projects?.filter(p =>
    p.status !== 'completed' && p.status !== 'cancelled'
  ).slice(0, 5) || []

  const getStatusIcon = (status: ProjectStatus) => {
    switch (status) {
      case 'planning': return <Clock className="h-4 w-4" />
      case 'in_progress': return <TrendingUp className="h-4 w-4" />
      case 'blocked': return <AlertCircle className="h-4 w-4" />
      case 'completed': return <CheckCircle2 className="h-4 w-4" />
      default: return <FolderKanban className="h-4 w-4" />
    }
  }

  const getStatusColor = (status: ProjectStatus) => {
    switch (status) {
      case 'planning': return 'text-gray-500 bg-gray-100'
      case 'in_progress': return 'text-blue-600 bg-blue-100'
      case 'blocked': return 'text-error-600 bg-error-100'
      case 'completed': return 'text-success-600 bg-success-100'
      case 'cancelled': return 'text-gray-400 bg-gray-50'
      default: return 'text-gray-500 bg-gray-100'
    }
  }

  const getPriorityColor = (priority: ProjectPriority) => {
    switch (priority) {
      case 'urgent': return 'error'
      case 'high': return 'warning'
      case 'medium': return 'primary'
      case 'low': return 'default'
      default: return 'default'
    }
  }

  if (isLoading) {
    return (
      <Card>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Projects Overview</h2>
          <p className="text-sm text-gray-500">Your active projects and tasks</p>
        </div>
        <div className="animate-pulse space-y-3">
          <div className="h-20 bg-gray-200 rounded"></div>
          <div className="h-20 bg-gray-200 rounded"></div>
          <div className="h-20 bg-gray-200 rounded"></div>
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Projects Overview</h2>
        <p className="text-sm text-gray-500">Your active projects and tasks</p>
      </div>

      {/* Quick Stats Grid */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="p-3 bg-blue-50 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-600">In Progress</p>
              <p className="text-2xl font-bold text-blue-600">{stats.inProgress}</p>
            </div>
            <TrendingUp className="h-6 w-6 text-blue-600" />
          </div>
        </div>

        <div className="p-3 bg-error-50 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-600">Overdue</p>
              <p className="text-2xl font-bold text-error-600">{stats.overdue}</p>
            </div>
            <AlertCircle className="h-6 w-6 text-error-600" />
          </div>
        </div>

        <div className="p-3 bg-warning-50 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-600">Urgent</p>
              <p className="text-2xl font-bold text-warning-600">{stats.urgent}</p>
            </div>
            <AlertCircle className="h-6 w-6 text-warning-600" />
          </div>
        </div>

        <div className="p-3 bg-success-50 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-600">Completed</p>
              <p className="text-2xl font-bold text-success-600">{stats.completed}</p>
            </div>
            <CheckCircle2 className="h-6 w-6 text-success-600" />
          </div>
        </div>
      </div>

      {/* Active Projects List */}
      <div className="space-y-3">
        {activeProjects.length > 0 ? (
          activeProjects.map(project => {
            const completedDeliverables = project.project_deliverables?.filter(d => d.completed).length || 0
            const totalDeliverables = project.project_deliverables?.length || 0
            const progressPercent = totalDeliverables > 0
              ? Math.round((completedDeliverables / totalDeliverables) * 100)
              : 0

            const isOverdue = project.due_date && new Date(project.due_date) < new Date()

            return (
              <div
                key={project.id}
                onClick={() => onProjectSelect?.(project)}
                className="p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2 mb-1">
                      <span className="font-semibold text-gray-900 truncate">{project.title}</span>
                    </div>
                    {project.description && (
                      <p className="text-xs text-gray-600 line-clamp-1">{project.description}</p>
                    )}
                  </div>
                  <Badge variant={getPriorityColor(project.priority)} size="sm" className="ml-2">
                    {project.priority}
                  </Badge>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-2">
                    <div className={`flex items-center space-x-1 px-2 py-1 rounded ${getStatusColor(project.status)}`}>
                      {getStatusIcon(project.status)}
                      <span className="capitalize">{project.status.replace('_', ' ')}</span>
                    </div>

                    {totalDeliverables > 0 && (
                      <div className="text-gray-600">
                        {completedDeliverables}/{totalDeliverables} done
                      </div>
                    )}
                  </div>

                  {project.due_date && (
                    <div className={`flex items-center space-x-1 ${isOverdue ? 'text-error-600' : 'text-gray-600'}`}>
                      <Clock className="h-3 w-3" />
                      <span>{formatDistanceToNow(new Date(project.due_date), { addSuffix: true })}</span>
                    </div>
                  )}
                </div>

                {totalDeliverables > 0 && (
                  <div className="mt-2">
                    <div className="w-full bg-gray-200 rounded-full h-1.5">
                      <div
                        className="bg-primary-600 h-1.5 rounded-full transition-all"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )
          })
        ) : (
          <NoDataAvailable message="No active projects" compact />
        )}
      </div>
    </Card>
  )
}
