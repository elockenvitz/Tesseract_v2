/**
 * StageWithChecklists Component
 *
 * Displays a workflow stage with its checklist template items.
 * Combines StageCard with ChecklistItemCard list and handles drag-and-drop reordering.
 *
 * Extracted from WorkflowsPage.tsx during Phase 3 refactoring.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, ListChecks, ChevronDown, ChevronRight } from 'lucide-react'
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

  /** Called with reordered items when drag ends */
  onReorder?: (items: { id: string, sort_order: number }[], stageId: string) => void

  /** Parent-controlled collapsed state (overrides local) */
  forceCollapsed?: boolean
  /** Called when user toggles collapse (if parent controls state) */
  onToggleCollapsed?: () => void
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
  onReorder,
  forceCollapsed,
  onToggleCollapsed,
}: StageWithChecklistsProps) {
  const isFirst = index === 0
  const isLast = index === totalStages - 1
  const showControls = canEdit && isEditMode
  const [localCollapsed, setLocalCollapsed] = useState(false)
  // Allow parent to override collapsed state
  const isCollapsed = forceCollapsed ?? localCollapsed
  const toggleCollapsed = () => {
    if (onToggleCollapsed) onToggleCollapsed()
    else setLocalCollapsed(!localCollapsed)
  }

  // Local state for smooth drag reordering
  const [localItems, setLocalItems] = useState(checklistItems)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [hasReordered, setHasReordered] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Sync local items with props - only when not actively reordering
  useEffect(() => {
    if (!draggingId && !hasReordered) {
      setLocalItems(checklistItems)
    }
    // Reset hasReordered flag when props update with new data
    if (hasReordered && JSON.stringify(checklistItems.map(i => i.id)) === JSON.stringify(localItems.map(i => i.id))) {
      setHasReordered(false)
    }
  }, [checklistItems, draggingId, hasReordered])

  // Reset local state when exiting edit mode (e.g., cancel/discard changes)
  useEffect(() => {
    if (!isEditMode) {
      setLocalItems(checklistItems)
      setHasReordered(false)
      setDraggingId(null)
      setHoverIndex(null)
    }
  }, [isEditMode, checklistItems])

  // Handle mouse up globally to end drag
  useEffect(() => {
    const handleMouseUp = () => {
      if (draggingId) {
        // Mark that we've reordered so we don't reset to old props
        setHasReordered(true)
        // Save the reorder - pass the new order to parent with stageId
        // Use stage_id from checklist items (database value) for consistency with original values tracking
        const updates = localItems.map((item, idx) => ({
          id: item.id,
          sort_order: idx + 1
        }))
        const stageId = localItems[0]?.stage_id || stage.stage_key
        onReorder?.(updates, stageId)
        setDraggingId(null)
        setHoverIndex(null)
      }
    }

    if (draggingId) {
      window.addEventListener('mouseup', handleMouseUp)
      return () => window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [draggingId, localItems, onReorder, stage.stage_key])

  // Reorder items when hovering during drag
  const handleItemHover = useCallback((targetIndex: number) => {
    if (!draggingId || hoverIndex === targetIndex) return

    setHoverIndex(targetIndex)

    setLocalItems(prev => {
      const dragIndex = prev.findIndex(item => item.id === draggingId)
      if (dragIndex === -1 || dragIndex === targetIndex) return prev

      const newItems = [...prev]
      const [draggedItem] = newItems.splice(dragIndex, 1)
      newItems.splice(targetIndex, 0, draggedItem)
      return newItems
    })
  }, [draggingId, hoverIndex])

  return (
    <Card>
      <div className="p-3">
        {/* Stage Header — clickable to expand/collapse */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={toggleCollapsed}
            className="flex items-center space-x-3 flex-1 min-w-0 text-left group"
          >
            {/* Collapse chevron */}
            {isCollapsed
              ? <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
              : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
            }
            {/* Stage Number */}
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 text-gray-600 font-medium text-sm shrink-0">
              {index + 1}
            </div>

            {/* Stage Info */}
            <div>
              <h4 className="font-medium text-gray-900">{stage.stage_label}</h4>
              <p className="text-sm text-gray-500">{stage.stage_description}</p>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                {stage.standard_deadline_days != null && (
                  <span className="text-xs text-gray-400">
                    Target: {stage.standard_deadline_days} days
                  </span>
                )}
                {stage.default_assignee_type && stage.default_assignee_value && (
                  <span className="text-xs text-gray-400">
                    Assigned to: {stage.default_assignee_type === 'role' ? stage.default_assignee_value.replace(/_/g, ' ') : stage.default_assignee_value}
                  </span>
                )}
                {stage.completion_criteria && (
                  <span className="text-xs text-gray-400">
                    Done when: {stage.completion_criteria}
                  </span>
                )}
              </div>
            </div>
          </button>

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

        {/* Checklist Items Section — collapsible */}
        {!isCollapsed && (
        <div className="mt-3 border-t pt-3">
          <div className="flex items-center justify-between mb-2">
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
          {localItems.length > 0 ? (
            <div ref={containerRef} className="space-y-2">
              {localItems.map((item, itemIndex) => (
                <ChecklistItemCard
                  key={item.id}
                  item={item}
                  index={itemIndex}
                  isEditMode={isEditMode}
                  canEdit={canEdit}
                  isDragging={draggingId === item.id}
                  isDragOver={false}
                  onDragStart={() => {
                    setDraggingId(item.id)
                    onDragStart?.(item.id)
                  }}
                  onDragEnd={() => {}}
                  onDragOver={() => {}}
                  onDragEnter={() => handleItemHover(itemIndex)}
                  onDragLeave={() => {}}
                  onDrop={() => {}}
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
        )}

      </div>
    </Card>
  )
}
