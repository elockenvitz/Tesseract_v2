/**
 * AddAssetPopulationRuleModal Component
 *
 * Modal for adding a new asset population rule to a workflow.
 * Asset population rules define when assets are added to workflow branches.
 */

import React, { useState, useEffect } from 'react'
import { X, Users, Play, Calendar, Zap, Info } from 'lucide-react'
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

  /** When true, renders form body only (no modal chrome). Used for inline embedding. */
  embedded?: boolean

  /** Called when the form's dirty state changes (name field non-empty). */
  onDirtyChange?: (dirty: boolean) => void
}

export function AddAssetPopulationRuleModal({
  workflowId,
  workflowName,
  workflowStages,
  onClose,
  onSave,
  embedded,
  onDirtyChange
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

  // Signal dirty state to parent when name field is non-empty
  useEffect(() => {
    onDirtyChange?.(formData.name.trim() !== '')
  }, [formData.name, onDirtyChange])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (formData.name.trim()) {
      onSave({
        ...formData,
        rule_category: 'asset_population'
      })
    }
  }

  const formContent = (
    <form id="add-asset-population-rule-form" onSubmit={handleSubmit} className="space-y-7">
      {/* ─── Name & Status ───────────────────────────── */}
      <div className="space-y-1.5">
        <label className="block text-[13px] font-medium text-gray-700">
          Rule Name
        </label>
        <div className="flex items-center gap-4">
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="e.g., Populate universe on run start"
            required
          />
          <div className="flex items-center space-x-2.5">
            <button
              type="button"
              role="switch"
              aria-checked={formData.isActive}
              onClick={() => setFormData({ ...formData, isActive: !formData.isActive })}
              className={`relative inline-flex h-[18px] w-8 flex-shrink-0 items-center rounded-full transition-colors ${
                formData.isActive ? 'bg-blue-500' : 'bg-gray-300'
              }`}
            >
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                formData.isActive ? 'translate-x-[14px]' : 'translate-x-[3px]'
              }`} />
            </button>
            <span className={`text-[13px] ${formData.isActive ? 'text-gray-600' : 'text-gray-400'}`}>
              {formData.isActive ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>
      </div>

      <div className="border-t border-gray-100" />

      {/* ─── 1. Trigger ──────────────────────────────── */}
      <div className="space-y-3">
        <div>
          <h4 className="text-[13px] font-semibold text-gray-900">Trigger</h4>
          <p className="text-[11px] text-gray-400 mt-0.5">When should assets enter the process?</p>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {[
            { value: 'on_branch_creation', label: 'When a new run starts', icon: Play, desc: 'Assets are added at the start of each run' },
            { value: 'days_before_earnings', label: 'Before earnings', icon: Calendar, desc: 'A set number of days before earnings date' },
            { value: 'days_after_earnings', label: 'After earnings', icon: Calendar, desc: 'A set number of days after earnings date' },
            { value: 'manual_trigger', label: 'Manual only', icon: Zap, desc: 'Only when triggered by a user' }
          ].map((option) => {
            const Icon = option.icon
            const selected = formData.conditionType === option.value
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
                className={`px-3.5 py-3 rounded-lg transition-all text-left ${
                  selected
                    ? 'border border-blue-500 bg-blue-50/60 shadow-sm'
                    : 'border border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'
                }`}
              >
                <div className="flex items-start space-x-2.5">
                  <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${selected ? 'text-blue-600' : 'text-gray-400'}`} />
                  <div className="min-w-0">
                    <div className={`text-[13px] font-medium leading-tight ${selected ? 'text-blue-900' : 'text-gray-800'}`}>
                      {option.label}
                    </div>
                    <div className="text-[11px] text-gray-400 mt-0.5 leading-snug">{option.desc}</div>
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {/* Earnings offset — inline config */}
        {(formData.conditionType === 'days_before_earnings' || formData.conditionType === 'days_after_earnings') && (
          <div className="flex items-center space-x-2 pl-1">
            <input
              type="number"
              min="0"
              value={formData.conditionValue.days_offset || 0}
              onChange={(e) => setFormData({
                ...formData,
                conditionValue: { ...formData.conditionValue, days_offset: parseInt(e.target.value) || 0 }
              })}
              className="w-16 px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-[13px] text-gray-500">
              days {formData.conditionType === 'days_before_earnings' ? 'before' : 'after'} earnings
            </span>
          </div>
        )}
      </div>

      <div className="border-t border-gray-100" />

      {/* ─── 2. Asset Source ─────────────────────────── */}
      <div className="space-y-3">
        <div>
          <h4 className="text-[13px] font-semibold text-gray-900">Asset Source</h4>
          <p className="text-[11px] text-gray-400 mt-0.5">Which assets are added when the trigger fires?</p>
        </div>

        <div className="space-y-2">
          {/* Universe assets */}
          <label className={`flex items-start px-3.5 py-3 rounded-lg cursor-pointer transition-all ${
            formData.actionType === 'add_universe_assets'
              ? 'border border-blue-500 bg-blue-50/60 shadow-sm'
              : 'border border-gray-200 hover:border-gray-300'
          }`}>
            <input
              type="radio"
              name="actionType"
              checked={formData.actionType === 'add_universe_assets'}
              onChange={() => setFormData({ ...formData, actionType: 'add_universe_assets', actionValue: {} })}
              className="mt-0.5 mr-3 accent-blue-600"
            />
            <div>
              <div className={`text-[13px] font-medium ${formData.actionType === 'add_universe_assets' ? 'text-blue-900' : 'text-gray-800'}`}>
                Universe assets
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">
                All assets matching this process's scope rules at the time of trigger.
              </p>
            </div>
          </label>

          {/* Specific assets */}
          <label className={`flex items-start px-3.5 py-3 rounded-lg cursor-pointer transition-all ${
            formData.actionType === 'add_specific_assets'
              ? 'border border-blue-500 bg-blue-50/60 shadow-sm'
              : 'border border-gray-200 hover:border-gray-300'
          }`}>
            <input
              type="radio"
              name="actionType"
              checked={formData.actionType === 'add_specific_assets'}
              onChange={() => setFormData({ ...formData, actionType: 'add_specific_assets', actionValue: {} })}
              className="mt-0.5 mr-3 accent-blue-600"
            />
            <div>
              <div className={`text-[13px] font-medium ${formData.actionType === 'add_specific_assets' ? 'text-blue-900' : 'text-gray-800'}`}>
                Specific assets
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">
                Only selected assets from a static list, theme, or portfolio.
              </p>
            </div>
          </label>
        </div>

        {/* Universe — scope re-evaluation note */}
        {formData.actionType === 'add_universe_assets' && (
          <div className="flex items-center space-x-1.5 pl-1">
            <Info className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
            <p className="text-[11px] text-gray-400">Scope rules are re-evaluated each time the trigger fires.</p>
          </div>
        )}

        {/* Specific assets — inline source selector */}
        {formData.actionType === 'add_specific_assets' && (
          <div className="pl-1 space-y-2.5">
            <label className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide">Source</label>
            <select
              value={formData.actionValue.source || 'list'}
              onChange={(e) => setFormData({
                ...formData,
                actionValue: { ...formData.actionValue, source: e.target.value }
              })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="list">From Asset List</option>
              <option value="theme">From Theme</option>
              <option value="portfolio">From Portfolio</option>
              <option value="filter">Custom Filter</option>
            </select>

            {formData.actionValue.source === 'filter' && (
              <div className="flex items-center space-x-1.5">
                <Info className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                <p className="text-[11px] text-gray-400">Uses the same filter options as scope rules.</p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-gray-100" />

      {/* ─── 3. Initial Stage ────────────────────────── */}
      <div className="space-y-2">
        <div>
          <h4 className="text-[13px] font-semibold text-gray-900">Initial Stage</h4>
          <p className="text-[11px] text-gray-400 mt-0.5">Newly added assets will enter the process at this stage.</p>
        </div>
        <select
          value={formData.actionValue.starting_stage || ''}
          onChange={(e) => setFormData({
            ...formData,
            actionValue: { ...formData.actionValue, starting_stage: e.target.value }
          })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">First stage (default)</option>
          {workflowStages.map((stage) => (
            <option key={stage.stage_key} value={stage.stage_key}>
              {stage.stage_label}
            </option>
          ))}
        </select>
      </div>
    </form>
  )

  if (embedded) return formContent

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
          {formContent}
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
