import { useQuery } from '@tanstack/react-query'
import { MessageSquare, FileText, CheckCircle2, Clock, User } from 'lucide-react'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { supabase } from '../../lib/supabase'
import { NoDataAvailable } from '../common/EmptyState'
import { formatDistanceToNow } from 'date-fns'
import type { ProjectWithAssignments } from '../../types/project'

interface RecentProjectActivityProps {
  onProjectSelect?: (project: ProjectWithAssignments) => void
}

interface ActivityItem {
  id: string
  type: 'project_updated' | 'comment_added' | 'deliverable_completed' | 'project_created'
  project_id: string
  project_title: string
  timestamp: string
  user_name?: string
  details?: string
  icon: typeof MessageSquare
  color: string
}

export function RecentProjectActivity({ onProjectSelect }: RecentProjectActivityProps) {
  const { data: activities, isLoading } = useQuery({
    queryKey: ['dashboard-project-activity'],
    queryFn: async () => {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id

      if (!userId) return []

      // Get recent projects (created or updated)
      const { data: recentProjects, error: projectsError } = await supabase
        .from('projects')
        .select(`
          id,
          title,
          created_at,
          updated_at,
          project_assignments!inner(assigned_to)
        `)
        .eq('project_assignments.assigned_to', userId)
        .order('updated_at', { ascending: false })
        .limit(10)

      if (projectsError) throw projectsError

      // Get recent comments
      const { data: recentComments, error: commentsError } = await supabase
        .from('project_comments')
        .select(`
          id,
          content,
          created_at,
          user_id,
          project_id,
          projects!inner(
            title,
            project_assignments!inner(assigned_to)
          ),
          users(
            first_name,
            last_name,
            email
          )
        `)
        .eq('projects.project_assignments.assigned_to', userId)
        .order('created_at', { ascending: false })
        .limit(10)

      if (commentsError) throw commentsError

      // Get recently completed deliverables
      const { data: recentDeliverables, error: deliverablesError } = await supabase
        .from('project_deliverables')
        .select(`
          id,
          title,
          completed_at,
          completed_by,
          project_id,
          projects!inner(
            title,
            project_assignments!inner(assigned_to)
          ),
          users:completed_by(
            first_name,
            last_name,
            email
          )
        `)
        .eq('projects.project_assignments.assigned_to', userId)
        .eq('completed', true)
        .not('completed_at', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(10)

      if (deliverablesError) throw deliverablesError

      // Combine all activities
      const activities: ActivityItem[] = []

      // Add project updates
      recentProjects?.forEach(project => {
        const isNew = new Date(project.created_at).getTime() === new Date(project.updated_at).getTime()

        activities.push({
          id: `project-${project.id}-${project.updated_at}`,
          type: isNew ? 'project_created' : 'project_updated',
          project_id: project.id,
          project_title: project.title,
          timestamp: project.updated_at,
          icon: FileText,
          color: isNew ? 'text-primary-600 bg-primary-100' : 'text-blue-600 bg-blue-100'
        })
      })

      // Add comments
      recentComments?.forEach(comment => {
        const userName = comment.users
          ? `${comment.users.first_name || ''} ${comment.users.last_name || ''}`.trim() || comment.users.email
          : 'Someone'

        activities.push({
          id: `comment-${comment.id}`,
          type: 'comment_added',
          project_id: comment.project_id,
          project_title: (comment.projects as any)?.title || 'Unknown Project',
          timestamp: comment.created_at,
          user_name: userName,
          details: comment.content,
          icon: MessageSquare,
          color: 'text-indigo-600 bg-indigo-100'
        })
      })

      // Add completed deliverables
      recentDeliverables?.forEach(deliverable => {
        const userName = deliverable.users
          ? `${deliverable.users.first_name || ''} ${deliverable.users.last_name || ''}`.trim() || deliverable.users.email
          : 'Someone'

        activities.push({
          id: `deliverable-${deliverable.id}`,
          type: 'deliverable_completed',
          project_id: deliverable.project_id,
          project_title: (deliverable.projects as any)?.title || 'Unknown Project',
          timestamp: deliverable.completed_at!,
          user_name: userName,
          details: deliverable.title,
          icon: CheckCircle2,
          color: 'text-success-600 bg-success-100'
        })
      })

      // Sort all activities by timestamp
      return activities.sort((a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      ).slice(0, 10)
    }
  })

  const getActivityMessage = (activity: ActivityItem) => {
    switch (activity.type) {
      case 'project_created':
        return 'Project created'
      case 'project_updated':
        return 'Project updated'
      case 'comment_added':
        return `${activity.user_name} commented`
      case 'deliverable_completed':
        return `${activity.user_name} completed a task`
      default:
        return 'Activity'
    }
  }

  if (isLoading) {
    return (
      <Card>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Recent Activity</h2>
          <p className="text-sm text-gray-500">Latest project updates</p>
        </div>
        <div className="animate-pulse space-y-3">
          <div className="h-16 bg-gray-200 rounded"></div>
          <div className="h-16 bg-gray-200 rounded"></div>
          <div className="h-16 bg-gray-200 rounded"></div>
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Recent Activity</h2>
        <p className="text-sm text-gray-500">Latest project updates</p>
      </div>

      <div className="space-y-3">
        {activities && activities.length > 0 ? (
          activities.map(activity => {
            const Icon = activity.icon

            return (
              <div
                key={activity.id}
                className="flex items-start space-x-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className={`p-2 rounded-lg flex-shrink-0 ${activity.color}`}>
                  <Icon className="h-4 w-4" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between mb-1">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {activity.project_title}
                      </p>
                      <p className="text-xs text-gray-600">
                        {getActivityMessage(activity)}
                      </p>
                    </div>
                    <span className="text-xs text-gray-500 ml-2 flex-shrink-0">
                      {formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true })}
                    </span>
                  </div>

                  {activity.details && (
                    <p className="text-xs text-gray-600 line-clamp-2 mt-1">
                      {activity.details}
                    </p>
                  )}
                </div>
              </div>
            )
          })
        ) : (
          <NoDataAvailable message="No recent activity" compact />
        )}
      </div>
    </Card>
  )
}
