/**
 * EditStageModal Component
 *
 * Modal for editing a workflow stage with inline checklist item management.
 */

import React, { useState, useRef } from 'react'
import { X, Plus, GripVertical, Trash2, Clock, User } from 'lucide-react'
import { Button } from '../../ui/Button'
import type { WorkflowStage } from '../../../types/workflow'

interface ChecklistItem {
  id: string
  item_text: string
  is_required: boolean
  sort_order: number
}

export interface EditStageChecklistChanges {
  added: { tempId: string; item_text: string; is_required: boolean; sort_order: number }[]
  updated: Record<string, Partial<ChecklistItem>>
  deleted: string[]
}

export interface EditStageModalProps {
  stage: WorkflowStage
  checklistItems?: ChecklistItem[]
  onClose: () => void
  onSave: (updates: Partial<WorkflowStage>, checklistChanges?: EditStageChecklistChanges) => void
}

const ROLE_OPTIONS = [
  { value: 'primary_analyst', label: 'Primary Analyst' },
  { value: 'secondary_analyst', label: 'Secondary Analyst' },
  { value: 'portfolio_manager', label: 'Portfolio Manager' },
  { value: 'coverage_lead', label: 'Coverage Lead' },
]

export function EditStageModal({ stage, checklistItems = [], onClose, onSave }: EditStageModalProps) {
  const [stageLabel, setStageLabel] = useState(stage.stage_label)
  const [stageDescription, setStageDescription] = useState(stage.stage_description || '')
  const [targetDays, setTargetDays] = useState<string>(stage.standard_deadline_days != null ? String(stage.standard_deadline_days) : '')
  const [assigneeType, setAssigneeType] = useState<'none' | 'person' | 'role'>(stage.default_assignee_type || 'none')
  const [assigneeValue, setAssigneeValue] = useState(stage.default_assignee_value || '')
  const [completionCriteria, setCompletionCriteria] = useState(stage.completion_criteria || '')

  // Local copy of existing items for editing
  const [existingItems, setExistingItems] = useState<ChecklistItem[]>(
    [...checklistItems].sort((a, b) => a.sort_order - b.sort_order)
  )
  const [newItems, setNewItems] = useState<{ tempId: string; item_text: string; is_required: boolean; sort_order: number }[]>([])
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set())
  const [newItemText, setNewItemText] = useState('')
  const newItemRef = useRef<HTMLInputElement>(null)

  const allItems = [
    ...existingItems.filter(i => !deletedIds.has(i.id)),
    ...newItems,
  ]

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    // Stage field changes
    const stageUpdates: Partial<WorkflowStage> = {}
    if (stageLabel !== stage.stage_label) stageUpdates.stage_label = stageLabel
    if (stageDescription !== (stage.stage_description || '')) stageUpdates.stage_description = stageDescription

    const newDeadline = targetDays ? parseInt(targetDays) : null
    if (newDeadline !== stage.standard_deadline_days) stageUpdates.standard_deadline_days = newDeadline

    const newAssigneeType = assigneeType === 'none' ? null : assigneeType
    const newAssigneeValue = assigneeType === 'none' ? null : assigneeValue || null
    if (newAssigneeType !== (stage.default_assignee_type || null)) stageUpdates.default_assignee_type = newAssigneeType as any
    if (newAssigneeValue !== (stage.default_assignee_value || null)) stageUpdates.default_assignee_value = newAssigneeValue

    const newCriteria = completionCriteria || null
    if (newCriteria !== (stage.completion_criteria || null)) stageUpdates.completion_criteria = newCriteria

    // Checklist changes
    const updated: Record<string, Partial<ChecklistItem>> = {}
    for (const item of existingItems) {
      if (deletedIds.has(item.id)) continue
      const original = checklistItems.find(c => c.id === item.id)
      if (!original) continue
      const changes: Partial<ChecklistItem> = {}
      if (item.item_text !== original.item_text) changes.item_text = item.item_text
      if (item.is_required !== original.is_required) changes.is_required = item.is_required
      if (Object.keys(changes).length > 0) updated[item.id] = changes
    }

    const checklistChanges: EditStageChecklistChanges = {
      added: newItems,
      updated,
      deleted: Array.from(deletedIds),
    }

    const hasChecklistChanges = newItems.length > 0 || deletedIds.size > 0 || Object.keys(updated).length > 0
    const hasStageChanges = Object.keys(stageUpdates).length > 0

    if (hasStageChanges || hasChecklistChanges) {
      onSave(
        hasStageChanges ? stageUpdates : {},
        hasChecklistChanges ? checklistChanges : undefined
      )
    } else {
      onClose()
    }
  }

  const addItem = () => {
    const text = newItemText.trim()
    if (!text) return
    setNewItems(prev => [
      ...prev,
      {
        tempId: `item_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        item_text: text,
        is_required: false,
        sort_order: allItems.length + 1,
      },
    ])
    setNewItemText('')
    newItemRef.current?.focus()
  }

  const removeExisting = (id: string) => {
    setDeletedIds(prev => new Set(prev).add(id))
  }

  const removeNew = (tempId: string) => {
    setNewItems(prev => prev.filter(i => i.tempId !== tempId))
  }

  const updateExistingText = (id: string, text: string) => {
    setExistingItems(prev => prev.map(i => i.id === id ? { ...i, item_text: text } : i))
  }

  const toggleExistingRequired = (id: string) => {
    setExistingItems(prev => prev.map(i => i.id === id ? { ...i, is_required: !i.is_required } : i))
  }

  const updateNewText = (tempId: string, text: string) => {
    setNewItems(prev => prev.map(i => i.tempId === tempId ? { ...i, item_text: text } : i))
  }

  const toggleNewRequired = (tempId: string) => {
    setNewItems(prev => prev.map(i => i.tempId === tempId ? { ...i, is_required: !i.is_required } : i))
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 pt-20">
      <div className="bg-white rounded-lg w-full max-w-lg max-h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900">Edit Stage</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="px-6 py-4 space-y-4">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Stage Name</label>
              <input
                type="text"
                value={stageLabel}
                onChange={(e) => setStageLabel(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
                autoFocus
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={stageDescription}
                onChange={(e) => setStageDescription(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                rows={2}
                placeholder="What happens in this stage?"
              />
            </div>

            {/* Target Duration + Default Assignee */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="flex items-center gap-1 text-sm font-medium text-gray-700 mb-1">
                  <Clock className="w-3.5 h-3.5" />
                  Target Duration
                  <span className="text-xs text-gray-400 font-normal">(optional)</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    value={targetDays}
                    onChange={(e) => setTargetDays(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="—"
                  />
                  <span className="text-sm text-gray-500 shrink-0">days</span>
                </div>
              </div>
              <div>
                <label className="flex items-center gap-1 text-sm font-medium text-gray-700 mb-1">
                  <User className="w-3.5 h-3.5" />
                  Default Assignee
                  <span className="text-xs text-gray-400 font-normal">(optional)</span>
                </label>
                <select
                  value={assigneeType}
                  onChange={(e) => { setAssigneeType(e.target.value as any); setAssigneeValue('') }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="none">None</option>
                  <option value="role">By Role</option>
                </select>
              </div>
            </div>

            {/* Assignee value (conditional) */}
            {assigneeType === 'role' && (
              <select
                value={assigneeValue}
                onChange={(e) => setAssigneeValue(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Select a role...</option>
                {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            )}

            {/* Completion Criteria */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Completion Criteria
                <span className="text-xs text-gray-400 font-normal ml-1">(optional)</span>
              </label>
              <input
                type="text"
                value={completionCriteria}
                onChange={(e) => setCompletionCriteria(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., All checklist items complete and thesis updated"
              />
            </div>

            {/* Checklist Items */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Checklist Items
                {allItems.length > 0 && <span className="text-gray-400 font-normal ml-1">({allItems.length})</span>}
              </label>

              {allItems.length > 0 && (
                <div className="space-y-1 mb-2">
                  {/* Existing items */}
                  {existingItems.filter(i => !deletedIds.has(i.id)).map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-gray-200 bg-gray-50/50 group"
                    >
                      <GripVertical className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                      <input
                        type="text"
                        value={item.item_text}
                        onChange={(e) => updateExistingText(item.id, e.target.value)}
                        className="flex-1 text-sm bg-transparent border-none outline-none focus:ring-0 p-0"
                      />
                      <label className="flex items-center gap-1 flex-shrink-0 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={item.is_required}
                          onChange={() => toggleExistingRequired(item.id)}
                          className="rounded border-gray-300 text-blue-600 w-3.5 h-3.5"
                        />
                        <span className="text-[11px] text-gray-400">Required</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => removeExisting(item.id)}
                        className="p-0.5 rounded hover:bg-red-50 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}

                  {/* New items */}
                  {newItems.map((item) => (
                    <div
                      key={item.tempId}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-blue-200 bg-blue-50/30 group"
                    >
                      <GripVertical className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                      <input
                        type="text"
                        value={item.item_text}
                        onChange={(e) => updateNewText(item.tempId, e.target.value)}
                        className="flex-1 text-sm bg-transparent border-none outline-none focus:ring-0 p-0"
                      />
                      <label className="flex items-center gap-1 flex-shrink-0 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={item.is_required}
                          onChange={() => toggleNewRequired(item.tempId)}
                          className="rounded border-gray-300 text-blue-600 w-3.5 h-3.5"
                        />
                        <span className="text-[11px] text-gray-400">Required</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => removeNew(item.tempId)}
                        className="p-0.5 rounded hover:bg-red-50 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add new item */}
              <div className="flex items-center gap-2">
                <input
                  ref={newItemRef}
                  type="text"
                  value={newItemText}
                  onChange={(e) => setNewItemText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); addItem() }
                  }}
                  className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Add a checklist item..."
                />
                <Button type="button" size="sm" variant="outline" onClick={addItem} disabled={!newItemText.trim()}>
                  <Plus className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end space-x-3 px-6 py-4 border-t border-gray-100">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">
              Save Changes
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
