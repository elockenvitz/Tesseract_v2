/**
 * EditStageModal Component
 *
 * Modal for editing an existing workflow stage.
 * Extracted from WorkflowsPage.tsx during Phase 5 refactoring.
 */

import React, { useState } from 'react'
import { Button } from '../../ui/Button'
import type { WorkflowStage } from '../../../types/workflow'

export interface EditStageModalProps {
  /** Stage to edit */
  stage: WorkflowStage

  /** Callback when modal is closed */
  onClose: () => void

  /** Callback when stage is saved */
  onSave: (updates: Partial<WorkflowStage>) => void
}

export function EditStageModal({ stage, onClose, onSave }: EditStageModalProps) {
  const [formData, setFormData] = useState({
    stage_label: stage.stage_label,
    stage_description: stage.stage_description,
    standard_deadline_days: stage.standard_deadline_days
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave(formData)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Edit Stage</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Stage Label</label>
            <input
              type="text"
              value={formData.stage_label}
              onChange={(e) => setFormData({ ...formData, stage_label: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={formData.stage_description}
              onChange={(e) => setFormData({ ...formData, stage_description: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              rows={3}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Standard Deadline (days)</label>
            <input
              type="number"
              value={formData.standard_deadline_days}
              onChange={(e) => setFormData({ ...formData, standard_deadline_days: parseInt(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              min="1"
              required
            />
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
