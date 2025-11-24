/**
 * StageCard Component
 *
 * Displays a single workflow stage with its details, checklist templates,
 * and reordering controls (in edit mode).
 *
 * Extracted from WorkflowsPage.tsx during Phase 3 refactoring.
 */

import React from 'react'
import { ArrowUp, ArrowDown, Trash2, Edit3 } from 'lucide-react'
import { Card } from '../../ui/Card'
import { Button } from '../../ui/Button'
import { WorkflowStage } from '../../../types/workflow/workflow.types'

export interface StageCardProps {
  /** The stage to display */
  stage: WorkflowStage

  /** Position in the list (for numbering) */
  index: number

  /** Total number of stages (for disable logic) */
  totalStages: number

  /** Whether the workflow is in template edit mode */
  isEditMode?: boolean

  /** Whether user has admin permission */
  canEdit?: boolean

  /** Number of checklist templates for this stage */
  checklistCount?: number

  /** Callbacks for stage operations */
  onMoveUp?: () => void
  onMoveDown?: () => void
  onEdit?: () => void
  onDelete?: () => void
}

export function StageCard({
  stage,
  index,
  totalStages,
  isEditMode = false,
  canEdit = false,
  checklistCount = 0,
  onMoveUp,
  onMoveDown,
  onEdit,
  onDelete
}: StageCardProps) {
  const isFirst = index === 0
  const isLast = index === totalStages - 1
  const showControls = canEdit && isEditMode

  return (
    <Card>
      <div className="p-3">
        {/* Stage Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-4">
            {/* Stage Number */}
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 text-gray-600 font-medium text-sm">
              {index + 1}
            </div>

            {/* Stage Info */}
            <div>
              <h4 className="font-medium text-gray-900">{stage.stage_label}</h4>
              <p className="text-sm text-gray-500">{stage.stage_description}</p>
              <div className="flex items-center space-x-4 mt-1">
                <span className="text-xs text-gray-400">
                  Deadline: {stage.standard_deadline_days} days
                </span>
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: stage.stage_color }}
                  title={`Color: ${stage.stage_color}`}
                />
                {checklistCount > 0 && (
                  <span className="text-xs text-gray-400">
                    {checklistCount} checklist{checklistCount !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Edit Controls */}
          {showControls && (
            <div className="flex items-center space-x-2">
              {onMoveUp && (
                <Button
                  size="xs"
                  variant="outline"
                  title="Move Up"
                  disabled={isFirst}
                  onClick={onMoveUp}
                >
                  <ArrowUp className="w-3 h-3" />
                </Button>
              )}
              {onMoveDown && (
                <Button
                  size="xs"
                  variant="outline"
                  title="Move Down"
                  disabled={isLast}
                  onClick={onMoveDown}
                >
                  <ArrowDown className="w-3 h-3" />
                </Button>
              )}
              {onEdit && (
                <Button
                  size="xs"
                  variant="outline"
                  title="Edit Stage"
                  onClick={onEdit}
                >
                  <Edit3 className="w-3 h-3" />
                </Button>
              )}
              {onDelete && (
                <Button
                  size="xs"
                  variant="outline"
                  title="Delete Stage"
                  onClick={onDelete}
                >
                  <Trash2 className="w-3 h-3 text-red-600" />
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Suggested Priorities (if any) */}
        {stage.suggested_priorities && stage.suggested_priorities.length > 0 && (
          <div className="mt-2 flex items-center space-x-2">
            <span className="text-xs text-gray-500">Suggested priorities:</span>
            <div className="flex flex-wrap gap-1">
              {stage.suggested_priorities.map((priority, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 text-xs rounded-full bg-blue-50 text-blue-700 border border-blue-200"
                >
                  {priority}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
