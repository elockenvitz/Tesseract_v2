/**
 * WorkflowMetricsGrid Component
 *
 * Displays a grid of workflow statistics cards showing key metrics.
 * Part of the Overview view.
 *
 * Extracted from WorkflowsPage.tsx during Phase 3 refactoring.
 */

import React from 'react'
import { TrendingUp, Clock, CheckSquare, Target } from 'lucide-react'
import { StatCard } from '../shared/StatCard'
import { WorkflowWithStats } from '../../../types/workflow/workflow.types'

export interface WorkflowMetricsGridProps {
  workflow: WorkflowWithStats
}

export function WorkflowMetricsGrid({ workflow }: WorkflowMetricsGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <StatCard
        value={workflow.usage_count}
        label="Total Uses"
        icon={TrendingUp}
        description="Times this workflow has been applied"
        colorScheme="blue"
      />

      <StatCard
        value={workflow.active_assets}
        label="Active Assets"
        icon={Clock}
        description="Assets currently in progress"
        colorScheme="orange"
      />

      <StatCard
        value={workflow.completed_assets}
        label="Completed"
        icon={CheckSquare}
        description="Assets that finished this workflow"
        colorScheme="green"
      />

      <StatCard
        value={workflow.stages?.length || 0}
        label="Total Stages"
        icon={Target}
        description="Steps in this workflow process"
        colorScheme="purple"
      />
    </div>
  )
}
