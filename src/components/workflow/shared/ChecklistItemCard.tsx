/**
 * ChecklistItemCard Component
 *
 * Displays a single checklist template item with drag-and-drop support.
 * Shows item details, edit controls, and handles reordering.
 *
 * Extracted from WorkflowsPage.tsx during Phase 3 refactoring.
 */

import React from 'react'
import { GripVertical, Edit3, Trash2 } from 'lucide-react'
import { Button } from '../../ui/Button'

export interface ChecklistItem {
  id: string
  stage_id: string
  workflow_id: string
  item_text: string
  item_description?: string
  is_required: boolean
  estimated_hours?: number
  tags?: string[]
  sort_order: number
}

export interface ChecklistItemCardProps {
  /** The checklist item to display */
  item: ChecklistItem

  /** Position in the list (for numbering) */
  index: number

  /** Whether the workflow is in template edit mode */
  isEditMode?: boolean

  /** Whether user has admin permission */
  canEdit?: boolean

  /** Whether this item is currently being dragged */
  isDragging?: boolean

  /** Whether another item is being dragged over this one */
  isDragOver?: boolean

  /** Drag and drop handlers */
  onDragStart?: (e: React.DragEvent) => void
  onDragEnd?: (e: React.DragEvent) => void
  onDragOver?: (e: React.DragEvent) => void
  onDragEnter?: (e: React.DragEvent) => void
  onDragLeave?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void

  /** Callbacks for item operations */
  onEdit?: () => void
  onDelete?: () => void
}

export function ChecklistItemCard({
  item,
  index,
  isEditMode = false,
  canEdit = false,
  isDragging = false,
  isDragOver = false,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
  onEdit,
  onDelete
}: ChecklistItemCardProps) {
  const showControls = canEdit && isEditMode

  // Determine styling based on drag state
  const getDragClasses = () => {
    if (isDragging) return 'opacity-50 bg-blue-100'
    if (isDragOver) return 'bg-blue-200 border-2 border-blue-400'
    return 'bg-white hover:bg-gray-50'
  }

  return (
    <div
      draggable={showControls}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`p-3 rounded-lg border transition-all ${getDragClasses()}`}
    >
      <div className="flex items-start space-x-3">
        {/* Drag Handle */}
        {showControls && (
          <div className="cursor-move text-gray-400 hover:text-gray-600 pt-1">
            <GripVertical className="w-4 h-4" />
          </div>
        )}

        {/* Item Number */}
        <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center border border-gray-300 rounded text-xs font-medium text-gray-600">
          {index + 1}
        </div>

        {/* Item Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center space-x-2">
                <span className="font-medium text-gray-900">{item.item_text}</span>
                {item.is_required && (
                  <span className="px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700 border border-red-300">
                    Required
                  </span>
                )}
              </div>

              {item.item_description && (
                <p className="text-sm text-gray-500 mt-1">{item.item_description}</p>
              )}

              {/* Metadata */}
              <div className="flex items-center space-x-3 mt-2 text-xs text-gray-400">
                {item.estimated_hours !== undefined && item.estimated_hours > 0 && (
                  <span>Est. {item.estimated_hours}h</span>
                )}
                {item.tags && item.tags.length > 0 && (
                  <div className="flex items-center space-x-1">
                    {item.tags.map((tag, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Edit Controls */}
            {showControls && (
              <div className="flex items-center space-x-1 ml-2">
                {onEdit && (
                  <button
                    title="Edit Item"
                    onClick={onEdit}
                    className="p-1.5 rounded hover:bg-gray-100 text-gray-600 hover:text-gray-900 transition-colors"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                )}
                {onDelete && (
                  <button
                    title="Delete Item"
                    onClick={onDelete}
                    className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
