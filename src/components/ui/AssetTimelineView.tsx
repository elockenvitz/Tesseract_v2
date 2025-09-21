import React, { useState } from 'react'
import { X, Clock, User, CheckCircle, AlertTriangle, Zap, Target, TrendingUp, FileText } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Badge } from './Badge'

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
  event_type: 'stage_change' | 'priority_change' | 'task_completed' | 'note_added' | 'general_edit'
  old_value?: string
  new_value?: string
  description: string
  user_email?: string
  user_name?: string
}

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

const getPriorityColor = (priority: string) => {
  switch (priority) {
    case 'critical': return 'bg-red-600'
    case 'high': return 'bg-orange-500'
    case 'medium': return 'bg-blue-500'
    case 'low': return 'bg-green-500'
    default: return 'bg-gray-400'
  }
}

export function AssetTimelineView({ assetId, assetSymbol, workflowId, isOpen, onClose, inline = false }: AssetTimelineViewProps) {
  const { data: timelineData, isLoading } = useQuery({
    queryKey: ['asset-timeline', assetId, workflowId],
    queryFn: async () => {
      const events: TimelineEvent[] = []

      // Get workflow info and stages if workflowId is provided
      let workflowStages: string[] = []
      let workflowName = ''
      if (workflowId) {
        const { data: workflow } = await supabase
          .from('workflows')
          .select('name')
          .eq('id', workflowId)
          .single()

        const { data: stages } = await supabase
          .from('workflow_stages')
          .select('stage_key')
          .eq('workflow_id', workflowId)

        workflowStages = stages?.map(s => s.stage_key) || []
        workflowName = workflow?.name || ''
      }

      // Get workflow-specific progress history
      if (workflowId) {
        const { data: progressHistory } = await supabase
          .from('asset_workflow_progress')
          .select(`
            created_at,
            updated_at,
            is_started,
            started_at,
            completed_at,
            current_stage_key
          `)
          .eq('asset_id', assetId)
          .eq('workflow_id', workflowId)

        progressHistory?.forEach((record: any) => {
          if (record.started_at) {
            events.push({
              id: `workflow-start-${record.created_at}`,
              created_at: record.started_at,
              event_type: 'stage_change',
              description: `Started workflow progress`,
              user_email: undefined,
              user_name: undefined
            })
          }

          if (record.completed_at) {
            events.push({
              id: `workflow-complete-${record.updated_at}`,
              created_at: record.completed_at,
              event_type: 'stage_change',
              description: `Completed workflow`,
              user_email: undefined,
              user_name: undefined
            })
          }
        })
      }

      // Get asset field history
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

      // Convert field history to timeline events
      fieldHistory?.forEach((record: any) => {
        let eventType: TimelineEvent['event_type'] = 'general_edit'
        let description = `${record.field_name} updated`

        if (record.field_name === 'process_stage') {
          eventType = 'stage_change'
          description = `Stage changed from ${record.old_value} to ${record.new_value}`

          // If we have a specific workflow, only include stage changes relevant to this workflow
          if (workflowId && !workflowStages.includes(record.new_value) && !workflowStages.includes(record.old_value)) {
            return // Skip this event if neither old nor new stage belongs to current workflow
          }
        } else if (record.field_name === 'priority') {
          eventType = 'priority_change'
          description = `Priority changed from ${record.old_value} to ${record.new_value}`
        } else if (record.field_name === 'thesis') {
          description = 'Investment thesis updated'
        } else if (record.field_name === 'where_different') {
          description = 'Where Different section updated'
        } else if (record.field_name === 'risks_to_thesis') {
          description = 'Risks to Thesis section updated'
        }

        const user = record.users
        const userName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : null

        events.push({
          id: record.id,
          created_at: record.changed_at,
          event_type: eventType,
          old_value: record.old_value,
          new_value: record.new_value,
          description,
          user_email: user?.email,
          user_name: userName || user?.email
        })
      })

      // Get checklist item completions
      const { data: checklistItems } = await supabase
        .from('asset_checklist_items')
        .select(`
          id,
          stage_id,
          item_id,
          completed,
          completed_at,
          comment,
          created_at
        `)
        .eq('asset_id', assetId)
        .eq('completed', true)
        .not('completed_at', 'is', null)
        .order('completed_at', { ascending: false })

      // Convert checklist completions to timeline events (filter by workflow stages if provided)
      checklistItems?.forEach((item: any) => {
        // If we have a specific workflow, only include checklist items from that workflow's stages
        if (!workflowId || workflowStages.includes(item.stage_id)) {
          events.push({
            id: `checklist-${item.id}`,
            created_at: item.completed_at,
            event_type: 'task_completed',
            description: `Completed task: ${item.item_id.replace('_', ' ')} in ${item.stage_id} stage`,
            user_email: undefined,
            user_name: undefined
          })
        }
      })

      // Get asset notes as timeline events
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

      // Convert notes to timeline events
      noteHistory?.forEach((note: any) => {
        const user = note.users
        const userName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : null

        events.push({
          id: `note-${note.id}`,
          created_at: note.created_at,
          event_type: 'note_added',
          description: `Added note: ${note.title}`,
          user_email: user?.email,
          user_name: userName || user?.email
        })
      })

      // Sort all events by date (most recent first)
      events.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

      return { events, workflowName }
    },
    enabled: isOpen
  })

  const timelineEvents = timelineData?.events
  const workflowName = timelineData?.workflowName

  if (!isOpen) return null

  const content = (
    <div>
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : (
        <div className="space-y-6">
          {timelineEvents?.map((event, index) => {
            const isLast = index === timelineEvents.length - 1
            const eventDate = new Date(event.created_at)

            return (
              <div key={event.id} className="relative">
                {/* Timeline line */}
                {!isLast && (
                  <div className="absolute left-6 top-12 w-0.5 h-full bg-gray-200"></div>
                )}

                <div className="flex items-start space-x-4">
                  {/* Event icon */}
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                    event.event_type === 'stage_change' ? getStageColor(event.new_value || '') :
                    event.event_type === 'priority_change' ? getPriorityColor(event.new_value || '') :
                    'bg-blue-100'
                  }`}>
                    {event.event_type === 'stage_change' && event.new_value ? (
                      React.createElement(getStageIcon(event.new_value), {
                        className: "w-5 h-5 text-white"
                      })
                    ) : event.event_type === 'priority_change' ? (
                      <Zap className="w-5 h-5 text-white" />
                    ) : event.event_type === 'task_completed' ? (
                      <CheckCircle className="w-5 h-5 text-blue-600" />
                    ) : event.event_type === 'note_added' ? (
                      <FileText className="w-5 h-5 text-blue-600" />
                    ) : (
                      <Clock className="w-5 h-5 text-blue-600" />
                    )}
                  </div>

                  {/* Event details */}
                  <div className="flex-1 min-w-0">
                    <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-2">
                            <Badge
                              variant={
                                event.event_type === 'stage_change' ? 'default' :
                                event.event_type === 'priority_change' ? 'warning' :
                                event.event_type === 'task_completed' ? 'success' :
                                event.event_type === 'note_added' ? 'info' :
                                'secondary'
                              }
                              size="sm"
                            >
                              {event.event_type.replace('_', ' ').toUpperCase()}
                            </Badge>
                            <span className="text-xs text-gray-500">
                              {eventDate.toLocaleDateString()} at {eventDate.toLocaleTimeString()}
                            </span>
                          </div>

                          <p className="text-sm text-gray-900 mb-2">{event.description}</p>

                          {(event.old_value && event.new_value) && (
                            <div className="flex items-center space-x-2 text-xs text-gray-600">
                              <span className="bg-red-100 text-red-800 px-2 py-1 rounded">
                                {event.old_value}
                              </span>
                              <span>→</span>
                              <span className="bg-green-100 text-green-800 px-2 py-1 rounded">
                                {event.new_value}
                              </span>
                            </div>
                          )}
                        </div>

                        {(event.user_name || event.user_email) && (
                          <div className="flex items-center space-x-2 text-xs text-gray-500 ml-4">
                            <User className="w-3 h-3" />
                            <span>{event.user_name || event.user_email}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}

          {(!timelineEvents || timelineEvents.length === 0) && (
            <div className="text-center py-12">
              <Clock className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Timeline Events</h3>
              <p className="text-gray-500">
                Timeline tracking will begin recording changes as you work with this asset.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )

  if (inline) {
    return (
      <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
        {content}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <Clock className="w-6 h-6 text-blue-600" />
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                {workflowName ? `${workflowName} Timeline` : 'Timeline View'}
              </h2>
              <p className="text-sm text-gray-500">
                {assetSymbol} - {workflowName ? `${workflowName} Workflow History` : 'Activity History'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
          {content}
        </div>
      </div>
    </div>
  )
}