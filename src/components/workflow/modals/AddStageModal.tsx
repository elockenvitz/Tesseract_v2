/**
 * AddStageModal Component
 *
 * Modal for adding a new workflow stage with inline checklist items,
 * optional target duration, default assignee, and completion criteria.
 */

import React, { useState, useRef } from 'react'
import { X, Plus, GripVertical, Trash2, Clock, User, Users, BrainCircuit, Settings2 } from 'lucide-react'
import { Button } from '../../ui/Button'
import type { WorkflowStage } from '../../../types/workflow'

type ProcessItemType = 'thinking' | 'operational'

interface DraftChecklistItem {
  tempId: string
  item_text: string
  is_required: boolean
  sort_order: number
  item_type: ProcessItemType
}

export interface AddStageModalProps {
  workflowId: string
  existingStages: WorkflowStage[]
  /** Available team members for assignee picker */
  teamMembers?: Array<{ id: string; name: string; role?: string }>
  onClose: () => void
  onSave: (stage: Omit<WorkflowStage, 'id' | 'created_at' | 'updated_at'>, checklistItems: DraftChecklistItem[]) => void
}

const ROLE_OPTIONS = [
  { value: 'primary_analyst', label: 'Primary Analyst' },
  { value: 'secondary_analyst', label: 'Secondary Analyst' },
  { value: 'portfolio_manager', label: 'Portfolio Manager' },
  { value: 'coverage_lead', label: 'Coverage Lead' },
]

export function AddStageModal({ workflowId, existingStages, teamMembers = [], onClose, onSave }: AddStageModalProps) {
  const [stageLabel, setStageLabel] = useState('')
  const [stageDescription, setStageDescription] = useState('')
  const [targetDays, setTargetDays] = useState<string>('')
  const [assigneeType, setAssigneeType] = useState<'none' | 'person' | 'role'>('none')
  const [assigneeValue, setAssigneeValue] = useState('')
  const [completionCriteria, setCompletionCriteria] = useState('')
  const [items, setItems] = useState<DraftChecklistItem[]>([])
  const [newItemText, setNewItemText] = useState('')
  const newItemRef = useRef<HTMLInputElement>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const stage_key = `stage_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
    onSave(
      {
        stage_key,
        stage_label: stageLabel,
        stage_description: stageDescription,
        stage_color: '#3b82f6',
        stage_icon: '',
        sort_order: existingStages.length + 1,
        standard_deadline_days: targetDays ? parseInt(targetDays) : null,
        suggested_priorities: [],
        default_assignee_type: assigneeType === 'none' ? null : assigneeType,
        default_assignee_value: assigneeType === 'none' ? null : assigneeValue || null,
        completion_criteria: completionCriteria || null,
      },
      items
    )
  }

  const [newItemType, setNewItemType] = useState<ProcessItemType>('operational')

  const addItem = () => {
    const text = newItemText.trim()
    if (!text) return
    setItems(prev => [
      ...prev,
      {
        tempId: `item_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        item_text: text,
        is_required: false,
        sort_order: prev.length + 1,
        item_type: newItemType,
      },
    ])
    setNewItemText('')
    newItemRef.current?.focus()
  }

  const removeItem = (tempId: string) => {
    setItems(prev => prev.filter(i => i.tempId !== tempId).map((item, idx) => ({ ...item, sort_order: idx + 1 })))
  }

  const toggleRequired = (tempId: string) => {
    setItems(prev => prev.map(i => i.tempId === tempId ? { ...i, is_required: !i.is_required } : i))
  }

  const updateItemText = (tempId: string, text: string) => {
    setItems(prev => prev.map(i => i.tempId === tempId ? { ...i, item_text: text } : i))
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Add Stage</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="px-6 py-4 space-y-4">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Stage Name</label>
              <input
                type="text"
                value={stageLabel}
                onChange={(e) => setStageLabel(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., Initial Research"
                required
                autoFocus
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
              <textarea
                value={stageDescription}
                onChange={(e) => setStageDescription(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                rows={2}
                placeholder="What happens in this stage?"
              />
            </div>

            {/* Target Duration + Default Assignee — side by side */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="flex items-center gap-1 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
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
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="—"
                  />
                  <span className="text-sm text-gray-500 shrink-0">days</span>
                </div>
              </div>

              <div>
                <label className="flex items-center gap-1 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  <User className="w-3.5 h-3.5" />
                  Default Assignee
                  <span className="text-xs text-gray-400 font-normal">(optional)</span>
                </label>
                <select
                  value={assigneeType}
                  onChange={(e) => { setAssigneeType(e.target.value as any); setAssigneeValue('') }}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="none">None</option>
                  <option value="role">By Role</option>
                  {teamMembers.length > 0 && <option value="person">Specific Person</option>}
                </select>
              </div>
            </div>

            {/* Assignee value selector (conditional) */}
            {assigneeType === 'role' && (
              <select
                value={assigneeValue}
                onChange={(e) => setAssigneeValue(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Select a role...</option>
                {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            )}
            {assigneeType === 'person' && teamMembers.length > 0 && (
              <select
                value={assigneeValue}
                onChange={(e) => setAssigneeValue(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Select a person...</option>
                {teamMembers.map(m => <option key={m.id} value={m.id}>{m.name}{m.role ? ` (${m.role})` : ''}</option>)}
              </select>
            )}

            {/* Completion Criteria */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Completion Criteria
                <span className="text-xs text-gray-400 font-normal ml-1">(optional)</span>
              </label>
              <input
                type="text"
                value={completionCriteria}
                onChange={(e) => setCompletionCriteria(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., All checklist items complete and thesis updated"
              />
            </div>

            {/* Checklist Items */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Checklist Items
                {items.length > 0 && <span className="text-gray-400 font-normal ml-1">({items.length})</span>}
              </label>

              {items.length > 0 && (
                <div className="space-y-1 mb-2">
                  {items.map((item) => (
                    <div
                      key={item.tempId}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-700/50 group"
                    >
                      <GripVertical className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                      {/* Type badge */}
                      <span className={`flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0 rounded flex-shrink-0 ${
                        item.item_type === 'thinking' ? 'bg-purple-50 text-purple-600' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {item.item_type === 'thinking' ? <BrainCircuit className="w-2.5 h-2.5" /> : <Settings2 className="w-2.5 h-2.5" />}
                        {item.item_type === 'thinking' ? 'Analysis' : 'Task'}
                      </span>
                      <input
                        type="text"
                        value={item.item_text}
                        onChange={(e) => updateItemText(item.tempId, e.target.value)}
                        className="flex-1 text-sm bg-transparent border-none outline-none focus:ring-0 p-0 text-gray-900 dark:text-white"
                      />
                      <label className="flex items-center gap-1 flex-shrink-0 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={item.is_required}
                          onChange={() => toggleRequired(item.tempId)}
                          className="rounded border-gray-300 text-blue-600 w-3.5 h-3.5"
                        />
                        <span className="text-[11px] text-gray-400">Required</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => removeItem(item.tempId)}
                        className="p-0.5 rounded hover:bg-red-50 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add new item */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Type</span>
                  <button
                    type="button"
                    onClick={() => setNewItemType('operational')}
                    className={`flex items-center gap-0.5 px-2 py-0.5 text-[10px] font-medium rounded border transition-colors ${
                      newItemType === 'operational' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                    }`}
                  >
                    <Settings2 className="w-2.5 h-2.5" />Task
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewItemType('thinking')}
                    className={`flex items-center gap-0.5 px-2 py-0.5 text-[10px] font-medium rounded border transition-colors ${
                      newItemType === 'thinking' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                    }`}
                  >
                    <BrainCircuit className="w-2.5 h-2.5" />Analysis
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    ref={newItemRef}
                    type="text"
                    value={newItemText}
                    onChange={(e) => setNewItemText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); addItem() }
                    }}
                    className="flex-1 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder={newItemType === 'thinking' ? "What question needs answering?" : "What task needs to be done?"}
                  />
                  <Button type="button" size="sm" variant="outline" onClick={addItem} disabled={!newItemText.trim()}>
                    <Plus className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              <p className="text-[11px] text-gray-400 mt-1">Press Enter to add. You can also add items later.</p>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end space-x-3 px-6 py-4 border-t border-gray-100 dark:border-gray-700">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">
              Add Stage
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
