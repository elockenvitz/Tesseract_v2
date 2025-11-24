/**
 * WorkflowPerformanceCard Component
 *
 * Displays workflow performance metrics including completion rate and active progress.
 * Part of the Overview view.
 *
 * Extracted from WorkflowsPage.tsx during Phase 3 refactoring.
 */

import React from 'react'
import { BarChart3 } from 'lucide-react'
import { Card } from '../../ui/Card'
import { ProgressBar } from '../shared/ProgressBar'
import { WorkflowWithStats } from '../../../types/workflow/workflow.types'

export interface WorkflowPerformanceCardProps {
  workflow: WorkflowWithStats
}

export function WorkflowPerformanceCard({ workflow }: WorkflowPerformanceCardProps) {
  const completionRate = workflow.usage_count > 0
    ? (workflow.completed_assets / workflow.usage_count) * 100
    : 0

  const activeRate = workflow.usage_count > 0
    ? (workflow.active_assets / workflow.usage_count) * 100
    : 0

  const hasData = workflow.usage_count > 0

  return (
    <Card>
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Performance Metrics</h3>
          <BarChart3 className="w-5 h-5 text-gray-400" />
        </div>

        {hasData ? (
          <div className="space-y-4">
            <ProgressBar
              label="Completion Rate"
              value={completionRate}
              color="green"
            />

            <ProgressBar
              label="Active Progress"
              value={activeRate}
              color="orange"
            />
          </div>
        ) : (
          <div className="text-center py-4">
            <div className="text-sm text-gray-500">No usage data yet</div>
            <div className="text-xs text-gray-400 mt-1">
              Apply this workflow to see performance metrics
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
