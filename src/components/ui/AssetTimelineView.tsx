import { useState, useMemo } from 'react'
import { X, Clock, User, CheckCircle, AlertTriangle, Zap, Target, TrendingUp, FileText, MessageSquare, Upload, Play, StopCircle, Edit, Filter, ChevronDown, ChevronRight, Calendar, BarChart3 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Badge } from './Badge'
import { formatDistanceToNow, format, differenceInDays, differenceInHours } from 'date-fns'

interface AssetTimelineViewProps {
  assetId: string
  assetSymbol: string
  workflowId?: string
  isOpen: boolean
  onClose: () => void
  inline?: boolean
}

interface TimelineEvent {
  id: string
  created_at: string
  event_type: 'workflow_start' | 'workflow_stop' | 'stage_change' | 'priority_change' | 'task_completed' | 'note_added' | 'comment_added' | 'file_uploaded' | 'general_edit'
  old_value?: string
  new_value?: string
  description: string
  user_email?: string
  user_name?: string
  details?: string
  stage_id?: string
}

interface WorkflowPeriod {
  id: string
  workflow_id: string
  workflow_name: string
  started_at: string
  completed_at?: string
  started_by?: string
  completed_by?: string
  is_active: boolean
  events: TimelineEvent[]
  stages: { [key: string]: StageActivity }
  duration_days?: number
  total_tasks: number
  completed_tasks: number
  files_uploaded: number
  comments_count: number
}

interface StageActivity {
  stage_id: string
  stage_label: string
  entered_at?: string
  events: TimelineEvent[]
  tasks_completed: number
  comments: number
  files: number
  duration?: string
}

type GroupBy = 'workflow-run' | 'stage' | 'date' | 'event-type' | 'user'
type ViewMode = 'detailed' | 'summary' | 'comparison'

const getStageIcon = (stage: string) => {
  switch (stage) {
    case 'outdated': return AlertTriangle
    case 'prioritized': return Zap
    case 'in_progress': return TrendingUp
    case 'recommend': return Target
    case 'review': return CheckCircle
    case 'action': return Zap
    case 'monitor': return TrendingUp
    default: return Clock
  }
}

const getStageColor = (stage: string) => {
  switch (stage) {
    case 'outdated': return 'bg-gray-600'
    case 'prioritized': return 'bg-orange-600'
    case 'in_progress': return 'bg-blue-500'
    case 'recommend': return 'bg-yellow-500'
    case 'review': return 'bg-green-400'
    case 'action': return 'bg-green-700'
    case 'monitor': return 'bg-teal-500'
    default: return 'bg-gray-400'
  }
}

const getEventIcon = (eventType: string, newValue?: string) => {
  switch (eventType) {
    case 'workflow_start': return Play
    case 'workflow_stop': return StopCircle
    case 'stage_change': return newValue ? getStageIcon(newValue) : Clock
    case 'priority_change': return Zap
    case 'task_completed': return CheckCircle
    case 'note_added': return FileText
    case 'comment_added': return MessageSquare
    case 'file_uploaded': return Upload
    case 'general_edit': return Edit
    default: return Clock
  }
}

const getEventColor = (eventType: string) => {
  switch (eventType) {
    case 'task_completed': return 'text-blue-600 bg-blue-50'
    case 'note_added': return 'text-purple-600 bg-purple-50'
    case 'comment_added': return 'text-indigo-600 bg-indigo-50'
    case 'file_uploaded': return 'text-green-600 bg-green-50'
    case 'stage_change': return 'text-orange-600 bg-orange-50'
    case 'priority_change': return 'text-yellow-600 bg-yellow-50'
    default: return 'text-gray-600 bg-gray-50'
  }
}

export function AssetTimelineView({ assetId, assetSymbol, workflowId, isOpen, onClose, inline = false }: AssetTimelineViewProps) {
  const [groupBy, setGroupBy] = useState<GroupBy>('workflow-run')
  const [viewMode, setViewMode] = useState<ViewMode>('detailed')
  const [expandedPeriods, setExpandedPeriods] = useState<Set<string>>(new Set())
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set())
  const [selectedEventTypes, setSelectedEventTypes] = useState<Set<string>>(new Set(['all']))
  const [selectedUser, setSelectedUser] = useState<string>('all')

  const { data: timelineData, isLoading } = useQuery({
    queryKey: ['asset-timeline-grouped', assetId, workflowId],
    queryFn: async () => {
      const allEvents: TimelineEvent[] = []

      // Get workflow stages for labeling
      const { data: workflowStages } = await supabase
        .from('workflow_stages')
        .select('workflow_id, stage_key, stage_label')

      const stageLabels: { [key: string]: string } = {}
      workflowStages?.forEach((stage: any) => {
        stageLabels[stage.stage_key] = stage.stage_label
      })

      // Get workflow progress records to establish periods
      const { data: workflowProgress } = await supabase
        .from('asset_workflow_progress')
        .select(`
          id,
          workflow_id,
          started_at,
          completed_at,
          is_started,
          is_completed,
          workflows:workflow_id (
            name
          ),
          started_by_user:started_by (
            email,
            first_name,
            last_name
          ),
          completed_by_user:completed_by (
            email,
            first_name,
            last_name
          )
        `)
        .eq('asset_id', assetId)
        .order('started_at', { ascending: false })

      const workflowPeriods: WorkflowPeriod[] = []

      workflowProgress?.forEach((record: any) => {
        if (record.started_at) {
          const startUser = record.started_by_user
          const startUserName = startUser ? `${startUser.first_name || ''} ${startUser.last_name || ''}`.trim() : null
          const completeUser = record.completed_by_user
          const completeUserName = completeUser ? `${completeUser.first_name || ''} ${completeUser.last_name || ''}`.trim() : null

          const duration = record.completed_at
            ? differenceInDays(new Date(record.completed_at), new Date(record.started_at))
            : differenceInDays(new Date(), new Date(record.started_at))

          workflowPeriods.push({
            id: record.id,
            workflow_id: record.workflow_id,
            workflow_name: record.workflows?.name || 'Unknown Workflow',
            started_at: record.started_at,
            completed_at: record.completed_at,
            started_by: startUserName || startUser?.email || 'Unknown',
            completed_by: completeUserName || completeUser?.email,
            is_active: record.is_started && !record.is_completed,
            events: [],
            stages: {},
            duration_days: duration,
            total_tasks: 0,
            completed_tasks: 0,
            files_uploaded: 0,
            comments_count: 0
          })
        }
      })

      // Get all timeline events
      // 1. Asset field history
      const { data: fieldHistory } = await supabase
        .from('asset_field_history')
        .select(`
          id,
          field_name,
          old_value,
          new_value,
          changed_at,
          users:changed_by (
            email,
            first_name,
            last_name
          )
        `)
        .eq('asset_id', assetId)
        .order('changed_at', { ascending: false })

      fieldHistory?.forEach((record: any) => {
        let eventType: TimelineEvent['event_type'] = 'general_edit'
        let description = `${record.field_name} updated`

        if (record.field_name === 'process_stage') {
          eventType = 'stage_change'
          description = `Moved to ${stageLabels[record.new_value] || record.new_value}`
        } else if (record.field_name === 'priority') {
          eventType = 'priority_change'
          description = `Priority: ${record.old_value} → ${record.new_value}`
        } else if (record.field_name === 'thesis') {
          description = 'Updated investment thesis'
        } else if (record.field_name === 'where_different') {
          description = 'Updated differentiation'
        } else if (record.field_name === 'risks_to_thesis') {
          description = 'Updated risks'
        }

        const user = record.users
        const userName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : null

        allEvents.push({
          id: record.id,
          created_at: record.changed_at,
          event_type: eventType,
          old_value: record.old_value,
          new_value: record.new_value,
          description,
          user_email: user?.email,
          user_name: userName || user?.email,
          stage_id: record.field_name === 'process_stage' ? record.new_value : undefined
        })
      })

      // 2. Checklist item completions
      const { data: checklistItems } = await supabase
        .from('asset_checklist_items')
        .select(`
          id,
          stage_id,
          item_id,
          item_text,
          completed,
          completed_at,
          comment,
          created_at
        `)
        .eq('asset_id', assetId)
        .eq('completed', true)
        .not('completed_at', 'is', null)
        .order('completed_at', { ascending: false })

      checklistItems?.forEach((item: any) => {
        allEvents.push({
          id: `checklist-${item.id}`,
          created_at: item.completed_at,
          event_type: 'task_completed',
          description: item.item_text || item.item_id.replace(/_/g, ' '),
          stage_id: item.stage_id
        })
      })

      // 3. Asset notes
      const { data: noteHistory } = await supabase
        .from('asset_notes')
        .select(`
          id,
          title,
          created_at,
          updated_at,
          users:created_by (
            email,
            first_name,
            last_name
          )
        `)
        .eq('asset_id', assetId)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })

      noteHistory?.forEach((note: any) => {
        const user = note.users
        const userName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : null

        allEvents.push({
          id: `note-${note.id}`,
          created_at: note.created_at,
          event_type: 'note_added',
          description: note.title,
          user_email: user?.email,
          user_name: userName || user?.email
        })
      })

      // 4. Checklist comments
      const { data: checklistItemsForComments } = await supabase
        .from('asset_checklist_items')
        .select('id')
        .eq('asset_id', assetId)

      const checklistItemIds = checklistItemsForComments?.map(item => item.id) || []

      if (checklistItemIds.length > 0) {
        const { data: comments } = await supabase
          .from('checklist_item_comments')
          .select(`
            id,
            comment_text,
            created_at,
            checklist_item:checklist_item_id (
              item_text,
              item_id,
              stage_id
            ),
            users:user_id (
              email,
              first_name,
              last_name
            )
          `)
          .in('checklist_item_id', checklistItemIds)
          .order('created_at', { ascending: false })

        comments?.forEach((comment: any) => {
          const user = comment.users
          const userName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : null
          const item = comment.checklist_item

          allEvents.push({
            id: `comment-${comment.id}`,
            created_at: comment.created_at,
            event_type: 'comment_added',
            description: `Comment: "${comment.comment_text}"`,
            details: `On: ${item?.item_text || item?.item_id || 'task'}`,
            user_email: user?.email,
            user_name: userName || user?.email,
            stage_id: item?.stage_id
          })
        })
      }

      // 5. File attachments
      const { data: attachments } = await supabase
        .from('asset_checklist_attachments')
        .select(`
          id,
          file_name,
          file_size,
          uploaded_at,
          stage_id,
          users:uploaded_by (
            email,
            first_name,
            last_name
          )
        `)
        .eq('asset_id', assetId)
        .order('uploaded_at', { ascending: false })

      attachments?.forEach((attachment: any) => {
        const user = attachment.users
        const userName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : null

        allEvents.push({
          id: `attachment-${attachment.id}`,
          created_at: attachment.uploaded_at,
          event_type: 'file_uploaded',
          description: attachment.file_name,
          user_email: user?.email,
          user_name: userName || user?.email,
          stage_id: attachment.stage_id
        })
      })

      // Sort all events by date
      allEvents.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

      // Assign events to workflow periods and organize by stage
      workflowPeriods.forEach(period => {
        const periodEvents = allEvents.filter(event => {
          const eventDate = new Date(event.created_at)
          const startDate = new Date(period.started_at)
          const endDate = period.completed_at ? new Date(period.completed_at) : new Date()
          return eventDate >= startDate && eventDate <= endDate
        })

        period.events = periodEvents

        // Organize by stage
        periodEvents.forEach(event => {
          if (event.stage_id) {
            if (!period.stages[event.stage_id]) {
              period.stages[event.stage_id] = {
                stage_id: event.stage_id,
                stage_label: stageLabels[event.stage_id] || event.stage_id,
                events: [],
                tasks_completed: 0,
                comments: 0,
                files: 0
              }
            }

            period.stages[event.stage_id].events.push(event)

            if (event.event_type === 'task_completed') period.stages[event.stage_id].tasks_completed++
            if (event.event_type === 'comment_added') period.stages[event.stage_id].comments++
            if (event.event_type === 'file_uploaded') period.stages[event.stage_id].files++
            if (event.event_type === 'stage_change') {
              period.stages[event.stage_id].entered_at = event.created_at
            }
          }

          // Update period stats
          if (event.event_type === 'task_completed') period.completed_tasks++
          if (event.event_type === 'comment_added') period.comments_count++
          if (event.event_type === 'file_uploaded') period.files_uploaded++
        })

        // Calculate stage durations
        const stageKeys = Object.keys(period.stages).sort((a, b) => {
          const aTime = period.stages[a].entered_at ? new Date(period.stages[a].entered_at!).getTime() : 0
          const bTime = period.stages[b].entered_at ? new Date(period.stages[b].entered_at!).getTime() : 0
          return aTime - bTime
        })

        stageKeys.forEach((key, index) => {
          const stage = period.stages[key]
          if (stage.entered_at) {
            const nextStage = stageKeys[index + 1] ? period.stages[stageKeys[index + 1]] : null
            const endTime = nextStage?.entered_at ? new Date(nextStage.entered_at) : (period.completed_at ? new Date(period.completed_at) : new Date())
            const startTime = new Date(stage.entered_at)
            const hours = differenceInHours(endTime, startTime)
            const days = Math.floor(hours / 24)
            const remainingHours = hours % 24

            if (days > 0) {
              stage.duration = `${days}d ${remainingHours}h`
            } else {
              stage.duration = `${remainingHours}h`
            }
          }
        })
      })

      // Events outside of any workflow period
      const eventsOutsideWorkflow = allEvents.filter(event => {
        return !workflowPeriods.some(period => {
          const eventDate = new Date(event.created_at)
          const startDate = new Date(period.started_at)
          const endDate = period.completed_at ? new Date(period.completed_at) : new Date()
          return eventDate >= startDate && eventDate <= endDate
        })
      })

      // Get unique users
      const users = new Set<string>()
      allEvents.forEach(event => {
        if (event.user_name) users.add(event.user_name)
      })

      return { workflowPeriods, eventsOutsideWorkflow, users: Array.from(users), stageLabels }
    },
    enabled: isOpen
  })

  const workflowPeriods = timelineData?.workflowPeriods || []
  const eventsOutsideWorkflow = timelineData?.eventsOutsideWorkflow || []
  const users = timelineData?.users || []
  const stageLabels = timelineData?.stageLabels || {}

  // Filter events based on selections
  const filteredPeriods = useMemo(() => {
    return workflowPeriods.map(period => {
      const filteredEvents = period.events.filter(event => {
        const typeMatch = selectedEventTypes.has('all') || selectedEventTypes.has(event.event_type)
        const userMatch = selectedUser === 'all' || event.user_name === selectedUser
        return typeMatch && userMatch
      })

      const filteredStages: { [key: string]: StageActivity } = {}
      if (period.stages) {
        Object.keys(period.stages).forEach(stageKey => {
          const stage = period.stages[stageKey]
          const stageFilteredEvents = stage.events.filter(event => {
            const typeMatch = selectedEventTypes.has('all') || selectedEventTypes.has(event.event_type)
            const userMatch = selectedUser === 'all' || event.user_name === selectedUser
            return typeMatch && userMatch
          })

          if (stageFilteredEvents.length > 0) {
            filteredStages[stageKey] = {
              ...stage,
              events: stageFilteredEvents,
              tasks_completed: stageFilteredEvents.filter(e => e.event_type === 'task_completed').length,
              comments: stageFilteredEvents.filter(e => e.event_type === 'comment_added').length,
              files: stageFilteredEvents.filter(e => e.event_type === 'file_uploaded').length
            }
          }
        })
      }

      return {
        ...period,
        events: filteredEvents,
        stages: filteredStages
      }
    })
  }, [workflowPeriods, selectedEventTypes, selectedUser])

  const togglePeriod = (periodId: string) => {
    const newExpanded = new Set(expandedPeriods)
    if (newExpanded.has(periodId)) {
      newExpanded.delete(periodId)
    } else {
      newExpanded.add(periodId)
    }
    setExpandedPeriods(newExpanded)
  }

  const toggleStage = (stageId: string) => {
    const newExpanded = new Set(expandedStages)
    if (newExpanded.has(stageId)) {
      newExpanded.delete(stageId)
    } else {
      newExpanded.add(stageId)
    }
    setExpandedStages(newExpanded)
  }

  const toggleEventType = (eventType: string) => {
    const newTypes = new Set(selectedEventTypes)
    if (eventType === 'all') {
      newTypes.clear()
      newTypes.add('all')
    } else {
      newTypes.delete('all')
      if (newTypes.has(eventType)) {
        newTypes.delete(eventType)
      } else {
        newTypes.add(eventType)
      }
      if (newTypes.size === 0) {
        newTypes.add('all')
      }
    }
    setSelectedEventTypes(newTypes)
  }

  if (!isOpen) return null

  const renderEvent = (event: TimelineEvent, compact: boolean = false) => {
    const Icon = getEventIcon(event.event_type, event.new_value)
    const eventDate = new Date(event.created_at)

    if (compact) {
      return (
        <div key={event.id} className="flex items-center space-x-2 text-xs py-1">
          <div className={`w-6 h-6 rounded flex items-center justify-center ${getEventColor(event.event_type)}`}>
            <Icon className="w-3 h-3" />
          </div>
          <span className="flex-1 text-gray-700 truncate">{event.description}</span>
          {event.user_name && (
            <span className="text-gray-500">{event.user_name}</span>
          )}
          <span className="text-gray-400">{format(eventDate, 'h:mm a')}</span>
        </div>
      )
    }

    return (
      <div key={event.id} className="flex items-start space-x-3 py-2 hover:bg-gray-50 rounded px-2 -mx-2">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${getEventColor(event.event_type)} flex-shrink-0`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2 mb-1">
            <span className="text-sm font-medium text-gray-900">{event.description}</span>
            {event.user_name && (
              <span className="text-xs text-gray-500">by {event.user_name}</span>
            )}
          </div>
          {event.details && (
            <p className="text-xs text-gray-600">{event.details}</p>
          )}
          <span className="text-xs text-gray-400">{format(eventDate, 'MMM d, h:mm a')}</span>
        </div>
      </div>
    )
  }

  const renderWorkflowPeriod = (period: WorkflowPeriod) => {
    const isExpanded = expandedPeriods.has(period.id)
    const stageKeys = Object.keys(period.stages).sort((a, b) => {
      const aTime = period.stages[a].entered_at ? new Date(period.stages[a].entered_at!).getTime() : 0
      const bTime = period.stages[b].entered_at ? new Date(period.stages[b].entered_at!).getTime() : 0
      return aTime - bTime
    })

    return (
      <div key={period.id} className="border-2 border-blue-200 rounded-xl overflow-hidden bg-white">
        {/* Period Header */}
        <div
          className="bg-gradient-to-r from-blue-50 to-blue-100 p-4 cursor-pointer hover:from-blue-100 hover:to-blue-150"
          onClick={() => togglePeriod(period.id)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3 flex-1">
              <button className="text-blue-600">
                {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
              </button>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${period.is_active ? 'bg-green-600' : 'bg-gray-600'}`}>
                {period.is_active ? <Play className="w-5 h-5 text-white" /> : <StopCircle className="w-5 h-5 text-white" />}
              </div>
              <div className="flex-1">
                <div className="flex items-center space-x-3">
                  <h3 className="text-lg font-semibold text-gray-900">{period.workflow_name}</h3>
                  {period.is_active && <Badge variant="success">Active</Badge>}
                  {period.duration_days !== undefined && (
                    <span className="text-xs text-gray-600 bg-white px-2 py-1 rounded">
                      {period.duration_days} days
                    </span>
                  )}
                </div>
                <div className="flex items-center space-x-4 text-xs text-gray-600 mt-1">
                  <span>{format(new Date(period.started_at), 'MMM d, yyyy h:mm a')}</span>
                  {period.completed_at && (
                    <span>→ {format(new Date(period.completed_at), 'MMM d, yyyy h:mm a')}</span>
                  )}
                </div>
              </div>
            </div>

            {/* Summary Stats */}
            <div className="flex items-center space-x-4 text-sm">
              <div className="text-center">
                <div className="font-semibold text-gray-900">{stageKeys.length}</div>
                <div className="text-xs text-gray-600">Stages</div>
              </div>
              <div className="text-center">
                <div className="font-semibold text-blue-600">{period.completed_tasks}</div>
                <div className="text-xs text-gray-600">Tasks</div>
              </div>
              <div className="text-center">
                <div className="font-semibold text-green-600">{period.files_uploaded}</div>
                <div className="text-xs text-gray-600">Files</div>
              </div>
              <div className="text-center">
                <div className="font-semibold text-indigo-600">{period.comments_count}</div>
                <div className="text-xs text-gray-600">Comments</div>
              </div>
            </div>
          </div>
        </div>

        {/* Period Content */}
        {isExpanded && (
          <div className="p-4 space-y-4">
            {viewMode === 'summary' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {stageKeys.map(stageKey => {
                  const stage = period.stages[stageKey]
                  return (
                    <div key={stageKey} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center space-x-2">
                          <div className={`w-8 h-8 rounded-lg ${getStageColor(stageKey)} flex items-center justify-center`}>
                            {(() => {
                              const Icon = getStageIcon(stageKey)
                              return <Icon className="w-4 h-4 text-white" />
                            })()}
                          </div>
                          <div>
                            <h4 className="font-semibold text-gray-900">{stage.stage_label}</h4>
                            {stage.duration && (
                              <span className="text-xs text-gray-500">{stage.duration}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div className="text-center p-2 bg-blue-50 rounded">
                          <div className="font-semibold text-blue-600">{stage.tasks_completed}</div>
                          <div className="text-gray-600">Tasks</div>
                        </div>
                        <div className="text-center p-2 bg-green-50 rounded">
                          <div className="font-semibold text-green-600">{stage.files}</div>
                          <div className="text-gray-600">Files</div>
                        </div>
                        <div className="text-center p-2 bg-indigo-50 rounded">
                          <div className="font-semibold text-indigo-600">{stage.comments}</div>
                          <div className="text-gray-600">Comments</div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {viewMode === 'detailed' && (
              <div className="space-y-3">
                {stageKeys.map(stageKey => {
                  const stage = period.stages[stageKey]
                  const stageExpanded = expandedStages.has(`${period.id}-${stageKey}`)

                  return (
                    <div key={stageKey} className="border border-gray-200 rounded-lg overflow-hidden">
                      <div
                        className="bg-gray-50 p-3 cursor-pointer hover:bg-gray-100"
                        onClick={() => toggleStage(`${period.id}-${stageKey}`)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <button className="text-gray-600">
                              {stageExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </button>
                            <div className={`w-8 h-8 rounded-lg ${getStageColor(stageKey)} flex items-center justify-center`}>
                              {(() => {
                                const Icon = getStageIcon(stageKey)
                                return <Icon className="w-4 h-4 text-white" />
                              })()}
                            </div>
                            <div>
                              <h4 className="font-semibold text-gray-900">{stage.stage_label}</h4>
                              {stage.entered_at && (
                                <span className="text-xs text-gray-500">
                                  {format(new Date(stage.entered_at), 'MMM d, h:mm a')}
                                  {stage.duration && ` • ${stage.duration}`}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center space-x-3 text-xs">
                            <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded">{stage.tasks_completed} tasks</span>
                            <span className="bg-green-100 text-green-700 px-2 py-1 rounded">{stage.files} files</span>
                            <span className="bg-indigo-100 text-indigo-700 px-2 py-1 rounded">{stage.comments} comments</span>
                          </div>
                        </div>
                      </div>

                      {stageExpanded && (
                        <div className="p-4 space-y-1 bg-white">
                          {stage.events.map(event => renderEvent(event))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  const content = (
    <div>
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Controls */}
          <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
            {/* View Mode */}
            <div className="flex items-center space-x-4">
              <span className="text-sm font-medium text-gray-700">View:</span>
              <div className="flex space-x-2">
                <button
                  onClick={() => setViewMode('summary')}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    viewMode === 'summary'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <BarChart3 className="w-4 h-4 inline mr-1" />
                  Summary
                </button>
                <button
                  onClick={() => setViewMode('detailed')}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    viewMode === 'detailed'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <Calendar className="w-4 h-4 inline mr-1" />
                  Detailed
                </button>
              </div>
            </div>

            {/* Filters */}
            <div className="flex items-start space-x-6">
              {/* Event Type Filter */}
              <div className="flex-1">
                <span className="text-sm font-medium text-gray-700 mb-2 block">Event Types:</span>
                <div className="flex flex-wrap gap-2">
                  {['all', 'task_completed', 'stage_change', 'file_uploaded', 'comment_added', 'note_added'].map(type => (
                    <button
                      key={type}
                      onClick={() => toggleEventType(type)}
                      className={`px-3 py-1 text-xs rounded-full transition-colors ${
                        selectedEventTypes.has(type)
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {type.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>

              {/* User Filter */}
              {users.length > 0 && (
                <div>
                  <span className="text-sm font-medium text-gray-700 mb-2 block">User:</span>
                  <select
                    value={selectedUser}
                    onChange={(e) => setSelectedUser(e.target.value)}
                    className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="all">All Users</option>
                    {users.map(user => (
                      <option key={user} value={user}>{user}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Workflow Periods */}
          <div className="space-y-4">
            {filteredPeriods.map(period => renderWorkflowPeriod(period))}
          </div>

          {/* Events Outside Workflow */}
          {eventsOutsideWorkflow.length > 0 && (
            <div className="border-2 border-gray-200 rounded-xl p-6 bg-gray-50">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Activity Outside Workflow</h3>
              <div className="space-y-1">
                {eventsOutsideWorkflow
                  .filter(event => {
                    const typeMatch = selectedEventTypes.has('all') || selectedEventTypes.has(event.event_type)
                    const userMatch = selectedUser === 'all' || event.user_name === selectedUser
                    return typeMatch && userMatch
                  })
                  .map(event => renderEvent(event))}
              </div>
            </div>
          )}

          {filteredPeriods.length === 0 && eventsOutsideWorkflow.length === 0 && (
            <div className="text-center py-12">
              <Clock className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Timeline Events</h3>
              <p className="text-gray-500">
                No events match the current filters. Try adjusting your selection.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )

  if (inline) {
    return (
      <div className="overflow-y-auto max-h-[calc(90vh-120px)]">
        {content}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-blue-100">
          <div className="flex items-center space-x-3">
            <Clock className="w-6 h-6 text-blue-600" />
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                Workflow Timeline
              </h2>
              <p className="text-sm text-gray-600">
                {assetSymbol} - Process history and outcomes
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/50 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)] bg-gray-50">
          {content}
        </div>
      </div>
    </div>
  )
}
