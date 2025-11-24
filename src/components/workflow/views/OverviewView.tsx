/**
 * OverviewView Component
 *
 * Complete Overview tab view for workflows.
 * Composes multiple sub-components to display workflow statistics,
 * performance metrics, timeline, and version information.
 *
 * Extracted from WorkflowsPage.tsx during Phase 3 refactoring.
 */

import React from 'react'
import { WorkflowWithStats } from '../../../types/workflow/workflow.types'
import { WorkflowMetricsGrid } from './WorkflowMetricsGrid'
import { WorkflowPerformanceCard } from './WorkflowPerformanceCard'
import { WorkflowTimelineCard } from './WorkflowTimelineCard'
import { WorkflowTemplateVersionCard, TemplateVersion } from './WorkflowTemplateVersionCard'

export interface OverviewViewProps {
  /** The workflow to display overview for */
  workflow: WorkflowWithStats

  /** Template versions for this workflow */
  templateVersions?: TemplateVersion[]

  /** Callback when user wants to view all versions */
  onViewAllVersions?: () => void

  /** Callback when user wants to view stages details */
  onViewStages?: () => void
}

export function OverviewView({
  workflow,
  templateVersions,
  onViewAllVersions,
  onViewStages
}: OverviewViewProps) {
  return (
    <div className="space-y-6">
      {/* Enhanced Stats Grid */}
      <WorkflowMetricsGrid workflow={workflow} />

      {/* Performance and Timeline Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <WorkflowPerformanceCard workflow={workflow} />
        <WorkflowTimelineCard workflow={workflow} />
      </div>

      {/* Template Version Information */}
      <WorkflowTemplateVersionCard
        versions={templateVersions}
        onViewAllVersions={onViewAllVersions}
      />

      {/* Future: Workflow Stages Overview can go here */}
      {/* This would show a summary of stages with View Details button */}
    </div>
  )
}
