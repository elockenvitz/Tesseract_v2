/**
 * WorkflowTimelineCard Component
 *
 * Displays workflow timeline information including creation date,
 * last update, and creator information.
 * Part of the Overview view.
 *
 * Extracted from WorkflowsPage.tsx during Phase 3 refactoring.
 */

import React from 'react'
import { Calendar } from 'lucide-react'
import { Card } from '../../ui/Card'
import { WorkflowWithStats } from '../../../types/workflow/workflow.types'

export interface WorkflowTimelineCardProps {
  workflow: WorkflowWithStats
}

interface TimelineItemProps {
  label: string
  value: string
  color: 'green' | 'blue' | 'gray'
}

const COLOR_CLASSES = {
  green: 'bg-green-500',
  blue: 'bg-blue-500',
  gray: 'bg-gray-300'
}

function TimelineItem({ label, value, color }: TimelineItemProps) {
  return (
    <div className="flex items-center space-x-3">
      <div className={`w-2 h-2 ${COLOR_CLASSES[color]} rounded-full`}></div>
      <div className="flex-1">
        <div className="text-sm font-medium text-gray-900">{label}</div>
        <div className="text-xs text-gray-500">{value}</div>
      </div>
    </div>
  )
}

export function WorkflowTimelineCard({ workflow }: WorkflowTimelineCardProps) {
  const createdDate = new Date(workflow.created_at).toLocaleDateString()
  const updatedDate = new Date(workflow.updated_at).toLocaleDateString()
  const creatorName = workflow.creator_name || 'Unknown'

  return (
    <Card>
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Workflow Timeline</h3>
          <Calendar className="w-5 h-5 text-gray-400" />
        </div>
        <div className="space-y-3">
          <TimelineItem
            label="Created"
            value={createdDate}
            color="green"
          />
          <TimelineItem
            label="Last Updated"
            value={updatedDate}
            color="blue"
          />
          <TimelineItem
            label="Created by"
            value={creatorName}
            color="gray"
          />
        </div>
      </div>
    </Card>
  )
}
