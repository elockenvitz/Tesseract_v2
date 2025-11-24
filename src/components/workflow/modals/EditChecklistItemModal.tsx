/**
 * EditChecklistItemModal Component
 *
 * Modal for editing an existing checklist item.
 * Extracted from WorkflowsPage.tsx during Phase 5 refactoring.
 */

import React, { useState } from 'react'
import { Button } from '../../ui/Button'

export interface EditChecklistItemModalProps {
  /** Checklist item to edit */
  item: any

  /** Callback when modal is closed */
  onClose: () => void

  /** Callback when item is saved */
  onSave: (updates: any) => void
}

export function EditChecklistItemModal({ item, onClose, onSave }: EditChecklistItemModalProps) {
  const [formData, setFormData] = useState({
    item_text: item.item_text,
    is_required: item.is_required
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave(formData)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Edit Checklist Item</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Item Text</label>
            <input
              type="text"
              value={formData.item_text}
              onChange={(e) => setFormData({ ...formData, item_text: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>
          <div className="flex items-center">
            <input
              type="checkbox"
              id="is_required_edit"
              checked={formData.is_required}
              onChange={(e) => setFormData({ ...formData, is_required: e.target.checked })}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="is_required_edit" className="ml-2 block text-sm text-gray-900">
              Required item
            </label>
          </div>
          <div className="flex space-x-3 justify-end">
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
