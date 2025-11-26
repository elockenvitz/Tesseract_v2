import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  FileText,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  XCircle,
  UserPlus,
  UserMinus,
  ListPlus,
  ListChecks,
  ListX,
  MessageSquare,
  Paperclip,
  Calendar,
  Zap,
  Edit,
  Trash2,
  Filter
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { Select } from '../ui/Select'
import { NoDataAvailable } from '../common/EmptyState'
import { formatDistanceToNow, format } from 'date-fns'
import type { ProjectActivityWithActor, ProjectActivityType } from '../../types/project'

interface ProjectActivityFeedProps {
  projectId: string
  limit?: number
  showFilters?: boolean
}

export function ProjectActivityFeed({
  projectId,
  limit,
  showFilters = true
}: ProjectActivityFeedProps) {
  const [activityTypeFilter, setActivityTypeFilter] = useState<'all' | ProjectActivityType>('all')
  const [actorFilter, setActorFilter] = useState<'all' | string>('all')

  // Fetch activity
  const { data: activities, isLoading } = useQuery({
    queryKey: ['project-activity', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_activity')
        .select(`
          *,
          actor:actor_id(
            id,
            email,
            first_name,
            last_name
          )
        `)
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(limit || 100)

      if (error) throw error
      return data as ProjectActivityWithActor[]
    }
  })

  // Get unique actors for filter
  const actors = useMemo(() => {
    if (!activities) return []
    const uniqueActors = new Map()
    activities.forEach(activity => {
      if (activity.actor && activity.actor_id) {
        uniqueActors.set(activity.actor_id, activity.actor)
      }
    })
    return Array.from(uniqueActors.values())
  }, [activities])

  // Filter activities
  const filteredActivities = useMemo(() => {
    if (!activities) return []

    return activities.filter(activity => {
      if (activityTypeFilter !== 'all' && activity.activity_type !== activityTypeFilter) {
        return false
      }
      if (actorFilter !== 'all' && activity.actor_id !== actorFilter) {
        return false
      }
      return true
    })
  }, [activities, activityTypeFilter, actorFilter])

  const getActivityIcon = (type: ProjectActivityType) => {
    switch (type) {
      case 'project_created':
        return FileText
      case 'project_updated':
        return Edit
      case 'project_deleted':
        return Trash2
      case 'status_changed':
        return TrendingUp
      case 'priority_changed':
        return Zap
      case 'due_date_changed':
        return Calendar
      case 'assignment_added':
        return UserPlus
      case 'assignment_removed':
        return UserMinus
      case 'deliverable_added':
        return ListPlus
      case 'deliverable_completed':
        return ListChecks
      case 'deliverable_uncompleted':
      case 'deliverable_deleted':
        return ListX
      case 'comment_added':
      case 'comment_updated':
      case 'comment_deleted':
        return MessageSquare
      case 'attachment_added':
      case 'attachment_deleted':
        return Paperclip
      default:
        return FileText
    }
  }

  const getActivityColor = (type: ProjectActivityType) => {
    switch (type) {
      case 'project_created':
      case 'deliverable_added':
      case 'assignment_added':
      case 'comment_added':
      case 'attachment_added':
        return 'text-success-600 bg-success-100'
      case 'project_deleted':
      case 'deliverable_deleted':
      case 'assignment_removed':
      case 'comment_deleted':
      case 'attachment_deleted':
        return 'text-error-600 bg-error-100'
      case 'deliverable_completed':
        return 'text-success-600 bg-success-100'
      case 'deliverable_uncompleted':
        return 'text-warning-600 bg-warning-100'
      case 'status_changed':
      case 'priority_changed':
      case 'due_date_changed':
        return 'text-blue-600 bg-blue-100'
      default:
        return 'text-gray-600 bg-gray-100'
    }
  }

  const getActivityDescription = (activity: ProjectActivityWithActor) => {
    const actorName = activity.actor
      ? `${activity.actor.first_name || ''} ${activity.actor.last_name || ''}`.trim() || activity.actor.email
      : 'Someone'

    switch (activity.activity_type) {
      case 'project_created':
        return `${actorName} created this project`

      case 'project_updated':
        return `${actorName} updated the project`

      case 'status_changed':
        return `${actorName} changed status from ${activity.old_value} to ${activity.new_value}`

      case 'priority_changed':
        return `${actorName} changed priority from ${activity.old_value} to ${activity.new_value}`

      case 'due_date_changed':
        const oldDate = activity.old_value ? format(new Date(activity.old_value), 'MMM d, yyyy') : 'none'
        const newDate = activity.new_value ? format(new Date(activity.new_value), 'MMM d, yyyy') : 'none'
        return `${actorName} changed due date from ${oldDate} to ${newDate}`

      case 'assignment_added':
        return `${actorName} assigned this project as ${activity.metadata?.role || 'contributor'}`

      case 'assignment_removed':
        return `${actorName} was removed from this project`

      case 'deliverable_added':
        return `${actorName} added deliverable "${activity.metadata?.title}"`

      case 'deliverable_completed':
        return `${actorName} completed deliverable "${activity.metadata?.title}"`

      case 'deliverable_uncompleted':
        return `${actorName} marked deliverable "${activity.metadata?.title}" as incomplete`

      case 'deliverable_deleted':
        return `${actorName} deleted deliverable "${activity.metadata?.title}"`

      case 'comment_added':
        return `${actorName} added a comment`

      case 'comment_updated':
        return `${actorName} updated a comment`

      case 'comment_deleted':
        return `${actorName} deleted a comment`

      case 'attachment_added':
        return `${actorName} added an attachment`

      case 'attachment_deleted':
        return `${actorName} deleted an attachment`

      default:
        return `${actorName} made a change`
    }
  }

  if (isLoading) {
    return (
      <Card>
        <div className="p-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Activity</h3>
          <div className="animate-pulse space-y-3">
            <div className="h-12 bg-gray-200 rounded"></div>
            <div className="h-12 bg-gray-200 rounded"></div>
            <div className="h-12 bg-gray-200 rounded"></div>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Activity</h3>
          {filteredActivities.length > 0 && (
            <Badge variant="default">{filteredActivities.length}</Badge>
          )}
        </div>

        {/* Filters */}
        {showFilters && activities && activities.length > 5 && (
          <div className="grid grid-cols-2 gap-3 mb-4">
            <Select
              value={activityTypeFilter}
              onChange={(e) => setActivityTypeFilter(e.target.value as 'all' | ProjectActivityType)}
              options={[
                { value: 'all', label: 'All Activity' },
                { value: 'status_changed', label: 'Status Changes' },
                { value: 'priority_changed', label: 'Priority Changes' },
                { value: 'assignment_added', label: 'Assignments' },
                { value: 'deliverable_completed', label: 'Completed Tasks' },
                { value: 'comment_added', label: 'Comments' }
              ]}
            />
            <Select
              value={actorFilter}
              onChange={(e) => setActorFilter(e.target.value)}
              options={[
                { value: 'all', label: 'All Users' },
                ...actors.map(actor => ({
                  value: actor.id,
                  label: `${actor.first_name || ''} ${actor.last_name || ''}`.trim() || actor.email
                }))
              ]}
            />
          </div>
        )}

        {/* Activity List */}
        <div className="space-y-3">
          {filteredActivities.length > 0 ? (
            filteredActivities.map(activity => {
              const Icon = getActivityIcon(activity.activity_type)
              const colorClass = getActivityColor(activity.activity_type)

              return (
                <div key={activity.id} className="flex items-start space-x-3">
                  <div className={`p-2 rounded-lg flex-shrink-0 ${colorClass}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 dark:text-white">
                      {getActivityDescription(activity)}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              )
            })
          ) : (
            <NoDataAvailable message="No activity yet" compact />
          )}
        </div>
      </div>
    </Card>
  )
}
