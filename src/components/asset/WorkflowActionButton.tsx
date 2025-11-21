import React from 'react'
import { Play, Pause, CheckCircle, RotateCcw, UserPlus, XCircle } from 'lucide-react'
import { Button } from '../ui/Button'

interface WorkflowProgress {
  id: string
  asset_id: string
  workflow_id: string
  current_stage_key: string | null
  is_started: boolean
  is_completed: boolean
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
  workflows: {
    id: string
    name: string
    description: string | null
    status: 'active' | 'ended'
    template_version_id: string | null
    template_version_number: number | null
    created_at: string
    archived: boolean
    deleted?: boolean
  } | null
}

interface WorkflowActionButtonProps {
  workflowId: string | null
  workflowProgress: WorkflowProgress | null
  onStart: (workflowId: string) => void
  onComplete: (workflowId: string) => void
  onRestart: (workflowId: string) => void
  onRemove: (workflowId: string) => void
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

export function WorkflowActionButton({
  workflowId,
  workflowProgress,
  onStart,
  onComplete,
  onRestart,
  onRemove,
  className = '',
  size = 'md'
}: WorkflowActionButtonProps) {
  // If no workflow is selected, show nothing
  if (!workflowId || !workflowProgress) {
    return null
  }

  const { is_started, is_completed, workflows } = workflowProgress
  const isWorkflowEnded = workflows?.status === 'ended'

  // Determine the primary action based on workflow state
  const renderPrimaryAction = () => {
    if (is_completed) {
      // Completed workflow - offer resume
      return (
        <Button
          onClick={() => onRestart(workflowId)}
          size={size}
          variant="outline"
          className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 border-blue-300"
        >
          <Play className="w-4 h-4 mr-2" />
          Resume Workflow
        </Button>
      )
    }

    // Active workflows are automatically started when assets are added to branches
    // Only show "Mark Complete" button (removed "Start Workflow" button)
    return (
      <Button
        onClick={() => onComplete(workflowId)}
        size={size}
        className="bg-blue-600 hover:bg-blue-700 text-white"
      >
        <CheckCircle className="w-4 h-4 mr-2" />
        Mark Complete
      </Button>
    )
  }

  // Secondary action - Remove from workflow - REMOVED, now in workflow selector dropdown
  const renderSecondaryAction = () => {
    return null
  }

  return (
    <div className={`flex items-center space-x-2 ${className}`}>
      {renderPrimaryAction()}
      {renderSecondaryAction()}
    </div>
  )
}
