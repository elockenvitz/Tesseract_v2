/**
 * StagesView Component
 *
 * Complete Stages tab view for workflows.
 * Displays all workflow stages with their checklist items and provides
 * editing capabilities including drag-and-drop reordering.
 *
 * Extracted from WorkflowsPage.tsx during Phase 3 refactoring.
 */

import React from 'react'
import { Plus, AlertCircle } from 'lucide-react'
import { Button } from '../../ui/Button'
import { WorkflowWithStats } from '../../../types/workflow/workflow.types'
import { StageWithChecklists } from '../shared/StageWithChecklists'
import { ChecklistItem } from '../shared/ChecklistItemCard'

export interface StagesViewProps {
  /** The workflow to display stages for */
  workflow: WorkflowWithStats

  /** All checklist items for this workflow */
  checklistItems?: ChecklistItem[]

  /** Whether the workflow is in template edit mode */
  isEditMode?: boolean

  /** Whether user has admin permission */
  canEdit?: boolean

  /** ID of the checklist item currently being dragged */
  draggedItemId?: string | null

  /** ID of the checklist item being dragged over */
  dragOverItemId?: string | null

  /** Stage operation callbacks */
  onAddStage?: () => void
  onMoveStageUp?: (stageId: string) => void
  onMoveStageDown?: (stageId: string) => void
  onEditStage?: (stageId: string) => void
  onDeleteStage?: (stageId: string) => void

  /** Checklist operation callbacks */
  onAddChecklistItem?: (stageId: string) => void
  onEditChecklistItem?: (itemId: string) => void
  onDeleteChecklistItem?: (itemId: string) => void

  /** Drag and drop callbacks for checklist items */
  onDragStart?: (itemId: string) => void
  onDragEnd?: () => void
  onDragOver?: (e: React.DragEvent) => void
  onDragEnter?: (itemId: string) => void
  onDragLeave?: () => void
  onDrop?: (draggedId: string, targetId: string) => void

  /** Optional function to render content tiles for each stage */
  renderContentTiles?: (stageId: string) => React.ReactNode
}

export function StagesView({
  workflow,
  checklistItems = [],
  isEditMode = false,
  canEdit = false,
  draggedItemId,
  dragOverItemId,
  onAddStage,
  onMoveStageUp,
  onMoveStageDown,
  onEditStage,
  onDeleteStage,
  onAddChecklistItem,
  onEditChecklistItem,
  onDeleteChecklistItem,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
  renderContentTiles
}: StagesViewProps) {
  const stages = workflow.stages || []
  const hasStages = stages.length > 0
  const showControls = canEdit && isEditMode

  // Helper to get checklist items for a specific stage
  const getChecklistItemsForStage = (stageKey: string): ChecklistItem[] => {
    return checklistItems.filter(item => item.stage_id === stageKey)
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <h3 className="text-lg font-semibold text-gray-900">Workflow Stages</h3>
          {canEdit && !isEditMode && (
            <div className="flex items-center space-x-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-3 py-1">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>Click <strong>"Edit Template"</strong> in the header to make changes to stages and checklists</span>
            </div>
          )}
        </div>
        {showControls && hasStages && onAddStage && (
          <Button onClick={onAddStage}>
            <Plus className="w-4 h-4 mr-2" />
            Add Stage
          </Button>
        )}
      </div>

      {/* Stages List */}
      {hasStages ? (
        <div className="space-y-3">
          {stages.map((stage, index) => {
            const stageChecklists = getChecklistItemsForStage(stage.stage_key)

            return (
              <StageWithChecklists
                key={stage.id}
                stage={stage}
                index={index}
                totalStages={stages.length}
                checklistItems={stageChecklists}
                isEditMode={isEditMode}
                canEdit={canEdit}
                draggedItemId={draggedItemId}
                dragOverItemId={dragOverItemId}
                onMoveStageUp={() => onMoveStageUp?.(stage.id)}
                onMoveStageDown={() => onMoveStageDown?.(stage.id)}
                onEditStage={() => onEditStage?.(stage.id)}
                onDeleteStage={() => onDeleteStage?.(stage.id)}
                onAddChecklistItem={() => onAddChecklistItem?.(stage.id)}
                onEditChecklistItem={onEditChecklistItem}
                onDeleteChecklistItem={onDeleteChecklistItem}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDragOver={onDragOver}
                onDragEnter={onDragEnter}
                onDragLeave={onDragLeave}
                onDrop={(targetItemId) => {
                  if (draggedItemId) {
                    onDrop?.(draggedItemId, targetItemId)
                  }
                }}
                contentTilesComponent={renderContentTiles?.(stage.id)}
              />
            )
          })}
        </div>
      ) : (
        /* Empty State */
        <div className="text-center py-12 bg-gray-50 rounded-lg border border-dashed border-gray-300">
          <div className="max-w-md mx-auto">
            <h4 className="text-lg font-medium text-gray-900 mb-2">No stages defined yet</h4>
            <p className="text-sm text-gray-500 mb-4">
              Stages define the steps in your workflow process. Each stage can have checklist items
              that guide users through the work.
            </p>
            {showControls && onAddStage && (
              <Button onClick={onAddStage}>
                <Plus className="w-4 h-4 mr-2" />
                Add First Stage
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
