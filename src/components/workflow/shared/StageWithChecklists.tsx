/**
 * StageWithChecklists Component
 *
 * Displays a workflow stage with its checklist template items.
 * Combines StageCard with ChecklistItemCard list and handles drag-and-drop reordering.
 *
 * Extracted from WorkflowsPage.tsx during Phase 3 refactoring.
 */

import React from 'react'
import { Plus, ListChecks } from 'lucide-react'
import { Card } from '../../ui/Card'
import { Button } from '../../ui/Button'
import { WorkflowStage } from '../../../types/workflow/workflow.types'
import { ChecklistItemCard, ChecklistItem } from './ChecklistItemCard'

export interface StageWithChecklistsProps {
  /** The stage to display */
  stage: WorkflowStage

  /** Position in the list (for numbering) */
  index: number

  /** Total number of stages (for disable logic) */
  totalStages: number

  /** Checklist items for this stage */
  checklistItems?: ChecklistItem[]

  /** Whether the workflow is in template edit mode */
  isEditMode?: boolean

  /** Whether user has admin permission */
  canEdit?: boolean

  /** ID of the item currently being dragged */
  draggedItemId?: string | null

  /** ID of the item being dragged over */
  dragOverItemId?: string | null

  /** Stage operation callbacks */
  onMoveStageUp?: () => void
  onMoveStageDown?: () => void
  onEditStage?: () => void
  onDeleteStage?: () => void

  /** Checklist operation callbacks */
  onAddChecklistItem?: () => void
  onEditChecklistItem?: (itemId: string) => void
  onDeleteChecklistItem?: (itemId: string) => void

  /** Drag and drop callbacks */
  onDragStart?: (itemId: string) => void
  onDragEnd?: () => void
  onDragOver?: (e: React.DragEvent) => void
  onDragEnter?: (itemId: string) => void
  onDragLeave?: () => void
  onDrop?: (targetItemId: string) => void

  /** Optional content tiles component */
  contentTilesComponent?: React.ReactNode
}

export function StageWithChecklists({
  stage,
  index,
  totalStages,
  checklistItems = [],
  isEditMode = false,
  canEdit = false,
  draggedItemId,
  dragOverItemId,
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
  contentTilesComponent
}: StageWithChecklistsProps) {
  const isFirst = index === 0
  const isLast = index === totalStages - 1
  const showControls = canEdit && isEditMode

  return (
    <Card>
      <div className="p-4">
        {/* Stage Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-4">
            {/* Stage Number */}
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-gray-100 text-gray-600 font-medium">
              {index + 1}
            </div>

            {/* Stage Info */}
            <div>
              <h4 className="font-medium text-gray-900 text-lg">{stage.stage_label}</h4>
              <p className="text-sm text-gray-500">{stage.stage_description}</p>
              <div className="flex items-center space-x-4 mt-1">
                <span className="text-xs text-gray-400">
                  Deadline: {stage.standard_deadline_days} days
                </span>
                <div
                  className="w-4 h-4 rounded-full border border-gray-300"
                  style={{ backgroundColor: stage.stage_color }}
                  title={`Color: ${stage.stage_color}`}
                />
                {checklistItems.length > 0 && (
                  <span className="text-xs text-gray-400">
                    {checklistItems.length} checklist item{checklistItems.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Stage Edit Controls */}
          {showControls && (
            <div className="flex items-center space-x-2">
              {onMoveStageUp && (
                <Button
                  size="sm"
                  variant="outline"
                  title="Move Stage Up"
                  disabled={isFirst}
                  onClick={onMoveStageUp}
                >
                  ↑
                </Button>
              )}
              {onMoveStageDown && (
                <Button
                  size="sm"
                  variant="outline"
                  title="Move Stage Down"
                  disabled={isLast}
                  onClick={onMoveStageDown}
                >
                  ↓
                </Button>
              )}
              {onEditStage && (
                <Button
                  size="sm"
                  variant="outline"
                  title="Edit Stage"
                  onClick={onEditStage}
                >
                  Edit
                </Button>
              )}
              {onDeleteStage && (
                <Button
                  size="sm"
                  variant="outline"
                  title="Delete Stage"
                  onClick={onDeleteStage}
                >
                  Delete
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Checklist Items Section */}
        <div className="mt-4 border-t pt-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <ListChecks className="w-4 h-4 text-gray-500" />
              <h5 className="text-sm font-medium text-gray-700">
                Checklist Items ({checklistItems.length})
              </h5>
            </div>
            {showControls && onAddChecklistItem && (
              <Button
                size="sm"
                variant="outline"
                onClick={onAddChecklistItem}
              >
                <Plus className="w-4 h-4 mr-1" />
                Add Item
              </Button>
            )}
          </div>

          {/* Checklist Items List */}
          {checklistItems.length > 0 ? (
            <div className="space-y-2">
              {checklistItems.map((item, itemIndex) => (
                <ChecklistItemCard
                  key={item.id}
                  item={item}
                  index={itemIndex}
                  isEditMode={isEditMode}
                  canEdit={canEdit}
                  isDragging={draggedItemId === item.id}
                  isDragOver={dragOverItemId === item.id}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move'
                    onDragStart?.(item.id)
                  }}
                  onDragEnd={onDragEnd}
                  onDragOver={onDragOver}
                  onDragEnter={() => onDragEnter?.(item.id)}
                  onDragLeave={onDragLeave}
                  onDrop={() => onDrop?.(item.id)}
                  onEdit={() => onEditChecklistItem?.(item.id)}
                  onDelete={() => onDeleteChecklistItem?.(item.id)}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-6 bg-gray-50 rounded-lg border border-dashed border-gray-300">
              <p className="text-sm text-gray-500">
                No checklist items yet
              </p>
              {showControls && (
                <p className="text-xs text-gray-400 mt-1">
                  Click "Add Item" to create checklist items for this stage
                </p>
              )}
            </div>
          )}
        </div>

        {/* Content Tiles Section (if provided) */}
        {contentTilesComponent && (
          <div className="mt-4 border-t pt-4">
            {contentTilesComponent}
          </div>
        )}

        {/* Suggested Priorities */}
        {stage.suggested_priorities && stage.suggested_priorities.length > 0 && (
          <div className="mt-4 border-t pt-4">
            <div className="flex items-center space-x-2">
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
          </div>
        )}
      </div>
    </Card>
  )
}
