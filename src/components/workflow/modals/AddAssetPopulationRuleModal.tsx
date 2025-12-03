/**
 * AddAssetPopulationRuleModal Component
 *
 * Modal for adding a new asset population rule to a workflow.
 * Asset population rules define when assets are added to workflow branches.
 */

import React, { useState } from 'react'
import { X, Users, GitBranch, Calendar, TrendingUp, Zap, AlertCircle } from 'lucide-react'
import { Button } from '../../ui/Button'
import type { WorkflowStage } from '../../../types/workflow'

export interface AddAssetPopulationRuleModalProps {
  /** Workflow ID */
  workflowId: string

  /** Workflow name */
  workflowName: string

  /** Workflow stages */
  workflowStages: WorkflowStage[]

  /** Callback when modal is closed */
  onClose: () => void

  /** Callback when rule is saved */
  onSave: (ruleData: any) => void
}

export function AddAssetPopulationRuleModal({
  workflowId,
  workflowName,
  workflowStages,
  onClose,
  onSave
}: AddAssetPopulationRuleModalProps) {
  const [formData, setFormData] = useState({
    name: '',
    type: 'event',
    conditionType: 'on_branch_creation',
    conditionValue: {},
    actionType: 'add_universe_assets',
    actionValue: {},
    isActive: true
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (formData.name.trim()) {
      onSave({
        ...formData,
        rule_category: 'asset_population'
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
                <Users className="w-5 h-5 text-orange-600" />
                <h2 className="text-xl font-semibold text-gray-900">Add Asset Population Rule</h2>
              </div>
              <p className="text-sm text-gray-500 mt-1">Configure when assets should be added to workflow branches</p>
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
          <form id="add-asset-population-rule-form" onSubmit={handleSubmit} className="space-y-6">
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
                placeholder="e.g., Add Universe on Creation"
                required
              />
            </div>

            {/* Trigger Type Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                When should assets be added?
              </label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { value: 'on_branch_creation', label: 'On Branch Creation', icon: GitBranch, desc: 'When a new branch is created' },
                  { value: 'days_before_earnings', label: 'Before Earnings', icon: Calendar, desc: 'X days before earnings date' },
                  { value: 'days_after_earnings', label: 'After Earnings', icon: Calendar, desc: 'X days after earnings date' },
                  { value: 'manual_trigger', label: 'Manual Only', icon: Zap, desc: 'Triggered manually by user' }
                ].map((option) => {
                  const Icon = option.icon
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setFormData({
                          ...formData,
                          conditionType: option.value,
                          conditionValue: option.value.includes('earnings') ? { days_offset: 0 } : {}
                        })
                      }}
                      className={`p-4 border-2 rounded-lg transition-all text-left ${
                        formData.conditionType === option.value
                          ? 'border-orange-500 bg-orange-50'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-start space-x-3">
                        <Icon className={`w-5 h-5 mt-0.5 ${formData.conditionType === option.value ? 'text-orange-600' : 'text-gray-400'}`} />
                        <div>
                          <div className={`font-medium ${formData.conditionType === option.value ? 'text-orange-900' : 'text-gray-900'}`}>
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

            {/* Trigger Configuration for earnings-based triggers */}
            {(formData.conditionType === 'days_before_earnings' || formData.conditionType === 'days_after_earnings') && (
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="text-sm font-medium text-gray-900 mb-3">Earnings Timing</h4>
                <div className="flex items-center space-x-2">
                  <input
                    type="number"
                    min="0"
                    value={formData.conditionValue.days_offset || 0}
                    onChange={(e) => setFormData({
                      ...formData,
                      conditionValue: { ...formData.conditionValue, days_offset: parseInt(e.target.value) || 0 }
                    })}
                    className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-600">
                    days {formData.conditionType === 'days_before_earnings' ? 'before' : 'after'} earnings date
                  </span>
                </div>
              </div>
            )}

            {/* Action Configuration */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-4">
              <h4 className="text-sm font-medium text-gray-900">What assets should be added?</h4>

              <div className="space-y-3">
                {/* Add Universe Assets */}
                <label className={`flex items-start p-3 border-2 rounded-lg cursor-pointer transition-all ${
                  formData.actionType === 'add_universe_assets'
                    ? 'border-green-500 bg-green-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}>
                  <input
                    type="radio"
                    name="actionType"
                    checked={formData.actionType === 'add_universe_assets'}
                    onChange={() => setFormData({ ...formData, actionType: 'add_universe_assets', actionValue: {} })}
                    className="mt-1 mr-3"
                  />
                  <div>
                    <div className="font-medium text-gray-900">Add Universe Assets</div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Add all assets that match the workflow's universe filter rules
                    </p>
                  </div>
                </label>

                {/* Add Specific Assets */}
                <label className={`flex items-start p-3 border-2 rounded-lg cursor-pointer transition-all ${
                  formData.actionType === 'add_specific_assets'
                    ? 'border-green-500 bg-green-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}>
                  <input
                    type="radio"
                    name="actionType"
                    checked={formData.actionType === 'add_specific_assets'}
                    onChange={() => setFormData({ ...formData, actionType: 'add_specific_assets', actionValue: {} })}
                    className="mt-1 mr-3"
                  />
                  <div>
                    <div className="font-medium text-gray-900">Add Specific Assets</div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Add assets based on specific criteria or selection
                    </p>
                  </div>
                </label>
              </div>

              {/* Additional options for add_specific_assets */}
              {formData.actionType === 'add_specific_assets' && (
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Asset Source</label>
                    <select
                      value={formData.actionValue.source || 'list'}
                      onChange={(e) => setFormData({
                        ...formData,
                        actionValue: { ...formData.actionValue, source: e.target.value }
                      })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="list">From Asset List</option>
                      <option value="theme">From Theme</option>
                      <option value="portfolio">From Portfolio</option>
                      <option value="filter">Custom Filter</option>
                    </select>
                  </div>

                  {formData.actionValue.source === 'filter' && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                      <div className="flex items-start space-x-2">
                        <AlertCircle className="w-4 h-4 text-blue-600 mt-0.5" />
                        <p className="text-xs text-blue-800">
                          Custom filter configuration will use the same filter options as universe rules.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Starting Stage (optional) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Starting Stage (optional)
              </label>
              <select
                value={formData.actionValue.starting_stage || ''}
                onChange={(e) => setFormData({
                  ...formData,
                  actionValue: { ...formData.actionValue, starting_stage: e.target.value }
                })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">First stage (default)</option>
                {workflowStages.map((stage) => (
                  <option key={stage.stage_key} value={stage.stage_key}>
                    {stage.stage_label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Which stage should newly added assets start at?
              </p>
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
          <Button type="submit" form="add-asset-population-rule-form">
            Create Rule
          </Button>
        </div>
      </div>
    </div>
  )
}
