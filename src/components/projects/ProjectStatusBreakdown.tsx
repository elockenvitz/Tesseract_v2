import { useQuery } from '@tanstack/react-query'
import { Clock, TrendingUp, AlertCircle, CheckCircle2, XCircle, BarChart3 } from 'lucide-react'
import { Card } from '../ui/Card'
import { supabase } from '../../lib/supabase'
import type { ProjectStatus, ProjectPriority } from '../../types/project'

export function ProjectStatusBreakdown() {
  const { data: projects, isLoading } = useQuery({
    queryKey: ['dashboard-projects-breakdown'],
    queryFn: async () => {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id

      if (!userId) return []

      const { data, error } = await supabase
        .from('projects')
        .select(`
          id,
          status,
          priority,
          project_assignments!inner(assigned_to)
        `)
        .eq('project_assignments.assigned_to', userId)

      if (error) throw error
      return data
    }
  })

  // Calculate breakdown by status
  const statusBreakdown = {
    planning: projects?.filter(p => p.status === 'planning').length || 0,
    in_progress: projects?.filter(p => p.status === 'in_progress').length || 0,
    blocked: projects?.filter(p => p.status === 'blocked').length || 0,
    completed: projects?.filter(p => p.status === 'completed').length || 0,
    cancelled: projects?.filter(p => p.status === 'cancelled').length || 0,
  }

  // Calculate breakdown by priority
  const priorityBreakdown = {
    urgent: projects?.filter(p => p.priority === 'urgent' && p.status !== 'completed' && p.status !== 'cancelled').length || 0,
    high: projects?.filter(p => p.priority === 'high' && p.status !== 'completed' && p.status !== 'cancelled').length || 0,
    medium: projects?.filter(p => p.priority === 'medium' && p.status !== 'completed' && p.status !== 'cancelled').length || 0,
    low: projects?.filter(p => p.priority === 'low' && p.status !== 'completed' && p.status !== 'cancelled').length || 0,
  }

  const total = projects?.length || 0
  const activeTotal = statusBreakdown.planning + statusBreakdown.in_progress + statusBreakdown.blocked

  const getStatusIcon = (status: ProjectStatus) => {
    switch (status) {
      case 'planning': return Clock
      case 'in_progress': return TrendingUp
      case 'blocked': return AlertCircle
      case 'completed': return CheckCircle2
      case 'cancelled': return XCircle
    }
  }

  const statusItems = [
    { status: 'planning' as ProjectStatus, label: 'Planning', count: statusBreakdown.planning, color: 'bg-gray-500' },
    { status: 'in_progress' as ProjectStatus, label: 'In Progress', count: statusBreakdown.in_progress, color: 'bg-blue-500' },
    { status: 'blocked' as ProjectStatus, label: 'Blocked', count: statusBreakdown.blocked, color: 'bg-error-500' },
    { status: 'completed' as ProjectStatus, label: 'Completed', count: statusBreakdown.completed, color: 'bg-success-500' },
    { status: 'cancelled' as ProjectStatus, label: 'Cancelled', count: statusBreakdown.cancelled, color: 'bg-gray-400' },
  ]

  const priorityItems = [
    { priority: 'urgent', label: 'Urgent', count: priorityBreakdown.urgent, color: 'bg-error-500' },
    { priority: 'high', label: 'High', count: priorityBreakdown.high, color: 'bg-warning-500' },
    { priority: 'medium', label: 'Medium', count: priorityBreakdown.medium, color: 'bg-primary-500' },
    { priority: 'low', label: 'Low', count: priorityBreakdown.low, color: 'bg-gray-400' },
  ]

  if (isLoading) {
    return (
      <Card>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Project Breakdown</h2>
          <p className="text-sm text-gray-500">Status and priority distribution</p>
        </div>
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded"></div>
          <div className="h-8 bg-gray-200 rounded"></div>
          <div className="h-8 bg-gray-200 rounded"></div>
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Project Breakdown</h2>
        <p className="text-sm text-gray-500">Status and priority distribution</p>
      </div>

      {/* Status Breakdown */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-700">By Status</h3>
          <span className="text-xs text-gray-500">{total} total</span>
        </div>

        {/* Visual bar */}
        {total > 0 && (
          <div className="flex h-3 rounded-full overflow-hidden mb-3 bg-gray-100">
            {statusItems.map(item => {
              const percentage = (item.count / total) * 100
              if (percentage === 0) return null
              return (
                <div
                  key={item.status}
                  className={`${item.color} transition-all`}
                  style={{ width: `${percentage}%` }}
                  title={`${item.label}: ${item.count} (${percentage.toFixed(1)}%)`}
                />
              )
            })}
          </div>
        )}

        {/* Status list */}
        <div className="space-y-2">
          {statusItems.map(item => {
            const Icon = getStatusIcon(item.status)
            const percentage = total > 0 ? ((item.count / total) * 100).toFixed(1) : '0'

            return (
              <div key={item.status} className="flex items-center justify-between text-sm">
                <div className="flex items-center space-x-2">
                  <div className={`w-3 h-3 rounded ${item.color}`} />
                  <Icon className="h-4 w-4 text-gray-500" />
                  <span className="text-gray-700">{item.label}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-gray-500 text-xs">{percentage}%</span>
                  <span className="font-semibold text-gray-900 w-8 text-right">{item.count}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Priority Breakdown (Active Projects Only) */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-700">By Priority (Active)</h3>
          <span className="text-xs text-gray-500">{activeTotal} active</span>
        </div>

        {/* Visual bar */}
        {activeTotal > 0 && (
          <div className="flex h-3 rounded-full overflow-hidden mb-3 bg-gray-100">
            {priorityItems.map(item => {
              const percentage = (item.count / activeTotal) * 100
              if (percentage === 0) return null
              return (
                <div
                  key={item.priority}
                  className={`${item.color} transition-all`}
                  style={{ width: `${percentage}%` }}
                  title={`${item.label}: ${item.count} (${percentage.toFixed(1)}%)`}
                />
              )
            })}
          </div>
        )}

        {/* Priority list */}
        <div className="space-y-2">
          {priorityItems.map(item => {
            const percentage = activeTotal > 0 ? ((item.count / activeTotal) * 100).toFixed(1) : '0'

            return (
              <div key={item.priority} className="flex items-center justify-between text-sm">
                <div className="flex items-center space-x-2">
                  <div className={`w-3 h-3 rounded ${item.color}`} />
                  <span className="text-gray-700">{item.label}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-gray-500 text-xs">{percentage}%</span>
                  <span className="font-semibold text-gray-900 w-8 text-right">{item.count}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}
