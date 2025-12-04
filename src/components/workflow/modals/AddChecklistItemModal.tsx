/**
 * AddChecklistItemModal Component
 *
 * Modal for adding a new checklist item to a workflow stage.
 * Extracted from WorkflowsPage.tsx during Phase 5 refactoring.
 */

import React, { useState, useRef, useEffect } from 'react'
import { Button } from '../../ui/Button'

export interface AddChecklistItemModalProps {
  /** Workflow ID */
  workflowId: string

  /** Stage ID */
  stageId: string

  /** Existing checklist items for calculating sort order */
  existingItems: any[]

  /** Callback when modal is closed */
  onClose: () => void

  /** Callback when item is saved */
  onSave: (item: any) => void
}

export function AddChecklistItemModal({ workflowId, stageId, existingItems, onClose, onSave }: AddChecklistItemModalProps) {
  const [formData, setFormData] = useState({
    item_text: '',
    sort_order: existingItems.length + 1,
    is_required: false
  })
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-focus the input when modal opens
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Auto-generate a unique item_id based on timestamp and random string
    const itemId = `item_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    onSave({
      ...formData,
      item_id: itemId
    })
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Add Checklist Item</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Task Name</label>
            <input
              ref={inputRef}
              type="text"
              value={formData.item_text}
              onChange={(e) => setFormData({ ...formData, item_text: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="e.g., Complete new analysis"
              required
            />
          </div>
          <div className="flex items-center">
            <input
              type="checkbox"
              id="is_required"
              checked={formData.is_required}
              onChange={(e) => setFormData({ ...formData, is_required: e.target.checked })}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="is_required" className="ml-2 block text-sm text-gray-900">
              Required item
            </label>
          </div>
          <div className="flex space-x-3 justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">
              Add Item
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
