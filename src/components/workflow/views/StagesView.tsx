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
import { Plus, Pencil, Save, X, AlertCircle, ChevronDown } from 'lucide-react'
import { Button } from '../../ui/Button'
import { WorkflowWithStats } from '../../../types/workflow/workflow.types'
import { StageWithChecklists } from '../shared/StageWithChecklists'
import { ChecklistItem } from '../shared/ChecklistItemCard'

export interface TemplateChange {
  type: string
  description: string
  timestamp: Date
  elementId?: string
  currentValue?: any
}

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

  /** Called with reordered items when drag ends */
  onReorderItems?: (items: { id: string, sort_order: number }[], stageId: string) => void

  /** Optional function to render content tiles for each stage */
  renderContentTiles?: (stageId: string) => React.ReactNode

  /** Template edit mode controls */
  onEnterEditMode?: () => void
  onExitEditMode?: () => void
  onSaveChanges?: () => void
  onCancelChanges?: () => void

  /** Template changes tracking */
  templateChanges?: TemplateChange[]
  showChangesList?: boolean
  onToggleChangesList?: () => void
  changesDropdownRef?: React.RefObject<HTMLDivElement>
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
  onReorderItems,
  renderContentTiles,
  onEnterEditMode,
  onExitEditMode,
  onSaveChanges,
  onCancelChanges,
  templateChanges = [],
  showChangesList = false,
  onToggleChangesList,
  changesDropdownRef
}: StagesViewProps) {
  const stages = workflow.stages || []
  const hasStages = stages.length > 0
  const showControls = canEdit && isEditMode

  // Helper to get checklist items for a specific stage
  const getChecklistItemsForStage = (stageKey: string): ChecklistItem[] => {
    return checklistItems.filter(item => item.stage_id === stageKey)
  }

  // Helper to get category info for change types
  const getCategoryInfo = (type: string) => {
    if (type.startsWith('stage_')) return { label: 'Stage', color: 'bg-purple-100 text-purple-700' }
    if (type.startsWith('checklist_')) return { label: 'Checklist', color: 'bg-cyan-100 text-cyan-700' }
    return { label: 'Other', color: 'bg-gray-100 text-gray-700' }
  }

  return (
    <div>
      {/* Sticky Header */}
      <div
        className="sticky top-0 z-10 px-6 py-4 border-b border-gray-200"
        style={{ backgroundColor: '#f9fafb' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <h3 className="text-lg font-semibold text-gray-900">
              Workflow Stages
              <span className="ml-2 text-sm font-normal text-gray-500">({stages.length})</span>
            </h3>
          </div>

          {/* Right side buttons */}
          <div className="flex items-center space-x-3">
            {isEditMode ? (
              <>
                {/* Changes Counter with Dropdown */}
                {templateChanges.length > 0 && (
                  <div className="relative" ref={changesDropdownRef}>
                    <button
                      onClick={onToggleChangesList}
                      className="flex items-center space-x-2 px-3 py-1.5 bg-amber-100 text-amber-800 rounded-lg hover:bg-amber-200 transition-colors border border-amber-300"
                      title="View changes"
                    >
                      <AlertCircle className="w-4 h-4" />
                      <span className="text-sm font-medium">{templateChanges.length} change{templateChanges.length !== 1 ? 's' : ''}</span>
                      <ChevronDown className={`w-4 h-4 transition-transform ${showChangesList ? 'rotate-180' : ''}`} />
                    </button>

                    {/* Changes Dropdown */}
                    {showChangesList && (
                      <div className="absolute right-0 mt-2 w-[380px] bg-white rounded-lg shadow-xl border border-gray-200 z-50 max-h-80 overflow-y-auto">
                        <div className="p-3 border-b border-gray-200 bg-gray-50">
                          <h3 className="text-sm font-semibold text-gray-900">Pending Changes ({templateChanges.length})</h3>
                          <p className="text-xs text-gray-500 mt-1">
                            Changes will create a new template version
                          </p>
                        </div>
                        <div className="p-2">
                          {templateChanges.map((change, idx) => {
                            const categoryInfo = getCategoryInfo(change.type)
                            return (
                              <div key={change.elementId || idx} className="px-3 py-2 hover:bg-gray-50 rounded text-sm">
                                <div className="flex items-start space-x-2">
                                  <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                                    change.type.includes('added') ? 'bg-green-500' :
                                    change.type.includes('deleted') ? 'bg-red-500' :
                                    'bg-blue-500'
                                  }`} />
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${categoryInfo.color}`}>
                                        {categoryInfo.label}
                                      </span>
                                      <span className="text-xs text-gray-400">
                                        {change.type.includes('added') ? 'Added' :
                                         change.type.includes('deleted') ? 'Deleted' :
                                         change.type.includes('reordered') ? 'Reordered' : 'Modified'}
                                      </span>
                                    </div>
                                    <p className="text-gray-900">{change.description}</p>
                                    <p className="text-xs text-gray-400 mt-0.5">
                                      {new Date(change.timestamp).toLocaleTimeString()}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Add Stage Button */}
                {onAddStage && (
                  <Button variant="outline" size="sm" onClick={onAddStage}>
                    <Plus className="w-4 h-4 mr-1" />
                    Add Stage
                  </Button>
                )}

                {/* Cancel Button */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onCancelChanges}
                  className="flex items-center space-x-1"
                >
                  <X className="w-4 h-4" />
                  <span>Cancel</span>
                </Button>

                {/* Save Button */}
                <Button
                  size="sm"
                  onClick={onSaveChanges}
                  disabled={templateChanges.length === 0}
                  className="flex items-center space-x-1"
                >
                  <Save className="w-4 h-4" />
                  <span>Save & Version</span>
                </Button>
              </>
            ) : (
              /* Edit Template Button - only shown when not in edit mode */
              canEdit && onEnterEditMode && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onEnterEditMode}
                  className="flex items-center space-x-2"
                >
                  <Pencil className="w-4 h-4" />
                  <span>Edit Template</span>
                </Button>
              )
            )}
          </div>
        </div>
      </div>

      {/* Stages List */}
      {hasStages ? (
        <div className="space-y-3 p-6">
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
                onAddChecklistItem={() => onAddChecklistItem?.(stage.stage_key)}
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
                onReorder={onReorderItems}
                contentTilesComponent={renderContentTiles?.(stage.id)}
              />
            )
          })}
        </div>
      ) : (
        /* Empty State */
        <div className="p-6">
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
        </div>
      )}
    </div>
  )
}
