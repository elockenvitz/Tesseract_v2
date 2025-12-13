/**
 * AddBranchEndingRuleModal Component
 *
 * Modal for adding a new branch ending rule to a workflow.
 * Branch ending rules define when branches should be archived, closed, or deleted.
 */

import React, { useState } from 'react'
import { X, XCircle, Clock, CheckCircle, Calendar, Zap, Archive, Trash2, Bell } from 'lucide-react'
import { Button } from '../../ui/Button'

export interface AddBranchEndingRuleModalProps {
  /** Workflow ID */
  workflowId: string

  /** Workflow name */
  workflowName: string

  /** Callback when modal is closed */
  onClose: () => void

  /** Callback when rule is saved */
  onSave: (ruleData: any) => void
}

export function AddBranchEndingRuleModal({
  workflowId,
  workflowName,
  onClose,
  onSave
}: AddBranchEndingRuleModalProps) {
  const [formData, setFormData] = useState({
    name: '',
    type: 'time',
    conditionType: 'days_after_creation',
    conditionValue: { days: 30 },
    actionType: 'archive_branch',
    actionValue: {},
    isActive: true
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (formData.name.trim()) {
      onSave({
        ...formData,
        rule_category: 'branch_ending'
      })
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100] p-4 pt-32 pb-8">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[calc(100vh-10rem)] overflow-hidden flex flex-col">
        {/* Fixed Header */}
        <div className="p-6 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center space-x-2">
                <XCircle className="w-5 h-5 text-red-600" />
                <h2 className="text-xl font-semibold text-gray-900">Add Branch Ending Rule</h2>
              </div>
              <p className="text-sm text-gray-500 mt-1">Configure when branches should be archived or closed</p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 overflow-y-auto flex-1">
          <form id="add-branch-ending-rule-form" onSubmit={handleSubmit} className="space-y-6">
            {/* Rule Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Rule Name
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., Archive After 30 Days"
                required
              />
            </div>

            {/* Trigger Type Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                When should the branch end?
              </label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { value: 'days_after_creation', label: 'Days After Creation', icon: Clock, desc: 'X days after branch was created' },
                  { value: 'all_assets_completed', label: 'All Assets Complete', icon: CheckCircle, desc: 'When all assets reach final stage' },
                  { value: 'specific_date', label: 'Specific Date', icon: Calendar, desc: 'On a specific calendar date' },
                  { value: 'manual_trigger', label: 'Manual Only', icon: Zap, desc: 'Triggered manually by user' }
                ].map((option) => {
                  const Icon = option.icon
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        let conditionValue = {}
                        if (option.value === 'days_after_creation') {
                          conditionValue = { days: 30 }
                        } else if (option.value === 'specific_date') {
                          conditionValue = { date: '' }
                        }
                        setFormData({
                          ...formData,
                          conditionType: option.value,
                          conditionValue
                        })
                      }}
                      className={`p-4 border-2 rounded-lg transition-all text-left ${
                        formData.conditionType === option.value
                          ? 'border-red-500 bg-red-50'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-start space-x-3">
                        <Icon className={`w-5 h-5 mt-0.5 ${formData.conditionType === option.value ? 'text-red-600' : 'text-gray-400'}`} />
                        <div>
                          <div className={`font-medium ${formData.conditionType === option.value ? 'text-red-900' : 'text-gray-900'}`}>
                            {option.label}
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">{option.desc}</div>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Trigger Configuration */}
            {formData.conditionType === 'days_after_creation' && (
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="text-sm font-medium text-gray-900 mb-3">Time Configuration</h4>
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-600">End branch</span>
                  <input
                    type="number"
                    min="1"
                    value={formData.conditionValue.days || 30}
                    onChange={(e) => setFormData({
                      ...formData,
                      conditionValue: { ...formData.conditionValue, days: parseInt(e.target.value) || 1 }
                    })}
                    className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-600">days after branch creation</span>
                </div>
              </div>
            )}

            {formData.conditionType === 'specific_date' && (
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="text-sm font-medium text-gray-900 mb-3">Date Configuration</h4>
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-600">End branch on</span>
                  <input
                    type="date"
                    value={formData.conditionValue.date || ''}
                    onChange={(e) => setFormData({
                      ...formData,
                      conditionValue: { ...formData.conditionValue, date: e.target.value }
                    })}
                    className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            )}

            {formData.conditionType === 'all_assets_completed' && (
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="text-sm font-medium text-gray-900 mb-3">Completion Configuration</h4>
                <div className="space-y-3">
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={formData.conditionValue.include_deleted !== false}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, include_deleted: e.target.checked }
                      })}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <span className="text-sm text-gray-700">Consider deleted assets as complete</span>
                  </label>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-600">Wait</span>
                    <input
                      type="number"
                      min="0"
                      value={formData.conditionValue.grace_period_days || 0}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, grace_period_days: parseInt(e.target.value) || 0 }
                      })}
                      className="w-16 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-600">days after all assets complete (grace period)</span>
                  </div>
                </div>
              </div>
            )}

            {/* Action Configuration */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-4">
              <h4 className="text-sm font-medium text-gray-900">What should happen when the branch ends?</h4>

              <div className="space-y-3">
                {/* Archive Branch */}
                <label className={`flex items-start p-3 border-2 rounded-lg cursor-pointer transition-all ${
                  formData.actionType === 'archive_branch'
                    ? 'border-amber-500 bg-amber-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}>
                  <input
                    type="radio"
                    name="actionType"
                    checked={formData.actionType === 'archive_branch'}
                    onChange={() => setFormData({ ...formData, actionType: 'archive_branch', actionValue: {} })}
                    className="mt-1 mr-3"
                  />
                  <div className="flex items-start space-x-3">
                    <Archive className={`w-5 h-5 mt-0.5 ${formData.actionType === 'archive_branch' ? 'text-amber-600' : 'text-gray-400'}`} />
                    <div>
                      <div className="font-medium text-gray-900">Archive Branch</div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Move the branch to archived state. It can be restored later if needed.
                      </p>
                    </div>
                  </div>
                </label>

                {/* Delete Branch */}
                <label className={`flex items-start p-3 border-2 rounded-lg cursor-pointer transition-all ${
                  formData.actionType === 'delete_branch'
                    ? 'border-red-500 bg-red-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}>
                  <input
                    type="radio"
                    name="actionType"
                    checked={formData.actionType === 'delete_branch'}
                    onChange={() => setFormData({ ...formData, actionType: 'delete_branch', actionValue: {} })}
                    className="mt-1 mr-3"
                  />
                  <div className="flex items-start space-x-3">
                    <Trash2 className={`w-5 h-5 mt-0.5 ${formData.actionType === 'delete_branch' ? 'text-red-600' : 'text-gray-400'}`} />
                    <div>
                      <div className="font-medium text-gray-900">Delete Branch</div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Permanently delete the branch. This action cannot be easily undone.
                      </p>
                    </div>
                  </div>
                </label>

                {/* Mark Complete */}
                <label className={`flex items-start p-3 border-2 rounded-lg cursor-pointer transition-all ${
                  formData.actionType === 'mark_complete'
                    ? 'border-green-500 bg-green-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}>
                  <input
                    type="radio"
                    name="actionType"
                    checked={formData.actionType === 'mark_complete'}
                    onChange={() => setFormData({ ...formData, actionType: 'mark_complete', actionValue: {} })}
                    className="mt-1 mr-3"
                  />
                  <div className="flex items-start space-x-3">
                    <CheckCircle className={`w-5 h-5 mt-0.5 ${formData.actionType === 'mark_complete' ? 'text-green-600' : 'text-gray-400'}`} />
                    <div>
                      <div className="font-medium text-gray-900">Mark as Complete</div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Mark the branch as successfully completed without archiving.
                      </p>
                    </div>
                  </div>
                </label>

                {/* Notify Only */}
                <label className={`flex items-start p-3 border-2 rounded-lg cursor-pointer transition-all ${
                  formData.actionType === 'notify_only'
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}>
                  <input
                    type="radio"
                    name="actionType"
                    checked={formData.actionType === 'notify_only'}
                    onChange={() => setFormData({ ...formData, actionType: 'notify_only', actionValue: {} })}
                    className="mt-1 mr-3"
                  />
                  <div className="flex items-start space-x-3">
                    <Bell className={`w-5 h-5 mt-0.5 ${formData.actionType === 'notify_only' ? 'text-blue-600' : 'text-gray-400'}`} />
                    <div>
                      <div className="font-medium text-gray-900">Send Notification Only</div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Send a reminder notification without changing the branch status.
                      </p>
                    </div>
                  </div>
                </label>
              </div>

              {/* Additional options for delete action */}
              {formData.actionType === 'delete_branch' && (
                <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3">
                  <div className="flex items-start space-x-2">
                    <Trash2 className="w-4 h-4 text-red-600 mt-0.5" />
                    <div>
                      <p className="text-xs font-medium text-red-800">Warning: Deletion is permanent</p>
                      <p className="text-xs text-red-700 mt-1">
                        Deleted branches and their asset progress will be moved to the deleted state.
                        Consider using Archive instead for recoverable cleanup.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Notification Options */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
              <h4 className="text-sm font-medium text-gray-900">Notification Options</h4>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={formData.actionValue.notify_owner !== false}
                  onChange={(e) => setFormData({
                    ...formData,
                    actionValue: { ...formData.actionValue, notify_owner: e.target.checked }
                  })}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <span className="text-sm text-gray-700">Notify branch owner when rule triggers</span>
              </label>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={formData.actionValue.notify_collaborators || false}
                  onChange={(e) => setFormData({
                    ...formData,
                    actionValue: { ...formData.actionValue, notify_collaborators: e.target.checked }
                  })}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <span className="text-sm text-gray-700">Notify all collaborators</span>
              </label>
            </div>

            {/* Active Toggle */}
            <div className="flex items-center py-3">
              <input
                type="checkbox"
                id="is_active"
                checked={formData.isActive}
                onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <label htmlFor="is_active" className="ml-2 block text-sm text-gray-900 font-medium">
                Activate this rule
              </label>
            </div>
          </form>
        </div>

        {/* Fixed Footer */}
        <div className="p-4 border-t border-gray-200 flex justify-end space-x-3 flex-shrink-0 bg-gray-50">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="add-branch-ending-rule-form">
            Create Rule
          </Button>
        </div>
      </div>
    </div>
  )
}
