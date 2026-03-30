/**
 * AddBranchEndingRuleModal Component
 *
 * Modal for adding a new run ending rule to a workflow.
 * Run ending rules define when runs should be archived, completed, or notified.
 */

import React, { useState, useEffect } from 'react'
import { X, Clock, CheckCircle, Calendar, Zap, Eye } from 'lucide-react'
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

  /** When true, renders form body only (no modal chrome). Used for inline embedding. */
  embedded?: boolean

  /** Called when the form's dirty state changes (name field non-empty). */
  onDirtyChange?: (dirty: boolean) => void
}

export function AddBranchEndingRuleModal({
  workflowId,
  workflowName,
  onClose,
  onSave,
  embedded,
  onDirtyChange
}: AddBranchEndingRuleModalProps) {
  type TimeUnit = 'minutes' | 'hours' | 'days' | 'weeks' | 'months'

  const [formData, setFormData] = useState({
    name: '',
    type: 'time',
    conditionType: 'time_after_creation',
    conditionValue: {
      amount: 30,
      unit: 'days' as TimeUnit,
      secondaryAmount: null as number | null,
      secondaryUnit: null as TimeUnit | null,
      atSpecificTime: false,
      triggerTime: '09:00'
    },
    actionType: 'archive_branch',
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
        rule_category: 'branch_ending'
      })
    }
  }

  // ── Summary sentence computation ────────────────────
  const triggerSummary = (() => {
    switch (formData.conditionType) {
      case 'time_after_creation': {
        const cv = formData.conditionValue
        const amt = cv.amount || 0
        const unit = cv.unit || 'days'
        const secondary = cv.secondaryAmount ? ` and ${cv.secondaryAmount} ${cv.secondaryUnit || 'hours'}` : ''
        return `After ${amt} ${unit}${secondary}`
      }
      case 'all_assets_completed':
        return 'When all assets complete'
      case 'specific_date':
        return formData.conditionValue.date ? `On ${formData.conditionValue.date}` : 'On a specific date'
      case 'manual_trigger':
        return 'When manually triggered'
      default:
        return '...'
    }
  })()

  const outcomeSummary = (() => {
    switch (formData.actionType) {
      case 'archive_branch': return 'end run & archive'
      case 'mark_complete': return 'end run'
      case 'notify_only': return 'send notification only'
      default: return '...'
    }
  })()

  const notifyParts: string[] = []
  if (formData.actionValue.notify_owner !== false) notifyParts.push('owner')
  if (formData.actionValue.notify_collaborators) notifyParts.push('collaborators')
  const notifySuffix = formData.actionType !== 'notify_only' && notifyParts.length > 0
    ? ` and notify ${notifyParts.join(' + ')}`
    : ''

  // ── Form body (shared between embedded & standalone) ──
  const formContent = (
    <form id="add-branch-ending-rule-form" onSubmit={handleSubmit} className="space-y-7">
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
            placeholder="e.g., Archive after 30 days"
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
            <span className={`text-[13px] whitespace-nowrap ${formData.isActive ? 'text-gray-600' : 'text-gray-400'}`}>
              {formData.isActive ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>
      </div>

      <div className="border-t border-gray-100" />

      {/* ─── 1. Trigger ──────────────────────────────── */}
      <div className="space-y-4">
        <div>
          <h4 className="text-[13px] font-semibold text-gray-900">Trigger</h4>
          <p className="text-[11px] text-gray-400 mt-0.5">When should this run automatically close?</p>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {[
            { value: 'time_after_creation', label: 'After a set duration', icon: Clock, desc: 'End the run after a defined amount of time' },
            { value: 'all_assets_completed', label: 'When all assets reach final stage', icon: CheckCircle, desc: 'All assets have completed the workflow' },
            { value: 'specific_date', label: 'On a specific date', icon: Calendar, desc: 'End on a chosen calendar date' },
            { value: 'manual_trigger', label: 'Manual only', icon: Zap, desc: 'No automatic trigger — end manually' }
          ].map((option) => {
            const Icon = option.icon
            const selected = formData.conditionType === option.value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  let conditionValue: any = {}
                  if (option.value === 'time_after_creation') {
                    conditionValue = {
                      amount: 30,
                      unit: 'days',
                      secondaryAmount: null,
                      secondaryUnit: null,
                      atSpecificTime: false,
                      triggerTime: '09:00'
                    }
                  } else if (option.value === 'specific_date') {
                    conditionValue = { date: '', triggerTime: '09:00' }
                  }
                  setFormData({
                    ...formData,
                    conditionType: option.value,
                    conditionValue
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

        {/* ── Time after creation config ──────────────── */}
        {formData.conditionType === 'time_after_creation' && (
          <div className="space-y-3 pt-1">
            <div>
              <label className="block text-[13px] font-medium text-gray-700 mb-2">End after</label>
              <div className="flex items-center space-x-2 flex-wrap gap-y-2">
                <input
                  type="number"
                  min="1"
                  value={formData.conditionValue.amount ?? ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    conditionValue: { ...formData.conditionValue, amount: e.target.value === '' ? null : parseInt(e.target.value) }
                  })}
                  onBlur={(e) => {
                    if (!e.target.value || parseInt(e.target.value) < 1) {
                      setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, amount: 1 }
                      })
                    }
                  }}
                  className="w-20 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <select
                  value={formData.conditionValue.unit || 'days'}
                  onChange={(e) => setFormData({
                    ...formData,
                    conditionValue: { ...formData.conditionValue, unit: e.target.value as TimeUnit }
                  })}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="minutes">minutes</option>
                  <option value="hours">hours</option>
                  <option value="days">days</option>
                  <option value="weeks">weeks</option>
                  <option value="months">months</option>
                </select>

                {/* Secondary duration toggle */}
                {formData.conditionValue.secondaryAmount === null ? (
                  <button
                    type="button"
                    onClick={() => setFormData({
                      ...formData,
                      conditionValue: {
                        ...formData.conditionValue,
                        secondaryAmount: 0,
                        secondaryUnit: formData.conditionValue.unit === 'weeks' ? 'days' :
                                       formData.conditionValue.unit === 'months' ? 'days' :
                                       formData.conditionValue.unit === 'days' ? 'hours' : 'minutes'
                      }
                    })}
                    className="text-[13px] text-blue-600 hover:text-blue-700 font-medium"
                  >
                    + Add more time
                  </button>
                ) : (
                  <>
                    <span className="text-[13px] text-gray-400">and</span>
                    <input
                      type="number"
                      min="0"
                      value={formData.conditionValue.secondaryAmount ?? ''}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, secondaryAmount: e.target.value === '' ? null : parseInt(e.target.value) }
                      })}
                      onBlur={(e) => {
                        if (e.target.value === '' || isNaN(parseInt(e.target.value))) {
                          setFormData({
                            ...formData,
                            conditionValue: { ...formData.conditionValue, secondaryAmount: 0 }
                          })
                        }
                      }}
                      className="w-20 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <select
                      value={formData.conditionValue.secondaryUnit || 'hours'}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, secondaryUnit: e.target.value as TimeUnit }
                      })}
                      className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="minutes">minutes</option>
                      <option value="hours">hours</option>
                      <option value="days">days</option>
                      <option value="weeks">weeks</option>
                      <option value="months">months</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, secondaryAmount: null, secondaryUnit: null }
                      })}
                      className="text-sm text-gray-400 hover:text-red-500"
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>

              {/* Duration summary/conversion */}
              <p className="text-[11px] text-gray-400 mt-2">
                {(() => {
                  const cv = formData.conditionValue
                  const amount = cv.amount || 0
                  const unit = cv.unit
                  const secondaryAmount = cv.secondaryAmount || 0
                  const secondaryUnit = cv.secondaryUnit

                  const toMinutes = (amt: number, u: string) => {
                    switch (u) {
                      case 'minutes': return amt
                      case 'hours': return amt * 60
                      case 'days': return amt * 60 * 24
                      case 'weeks': return amt * 60 * 24 * 7
                      case 'months': return amt * 60 * 24 * 30
                      default: return amt
                    }
                  }

                  const totalMinutes = toMinutes(amount, unit) + (secondaryAmount ? toMinutes(secondaryAmount, secondaryUnit || 'minutes') : 0)

                  if (totalMinutes >= 60 * 24 * 30) {
                    return `≈ ${(totalMinutes / (60 * 24 * 30)).toFixed(1)} months`
                  } else if (totalMinutes >= 60 * 24 * 7) {
                    return `≈ ${(totalMinutes / (60 * 24 * 7)).toFixed(1)} weeks`
                  } else if (totalMinutes >= 60 * 24) {
                    return `≈ ${(totalMinutes / (60 * 24)).toFixed(1)} days`
                  } else if (totalMinutes >= 60) {
                    return `≈ ${(totalMinutes / 60).toFixed(1)} hours`
                  }
                  return `${totalMinutes} minutes`
                })()}
              </p>
            </div>

            <div className="border-t border-gray-100" />

            {/* Specific time of day */}
            <div>
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.conditionValue.atSpecificTime || false}
                  onChange={(e) => setFormData({
                    ...formData,
                    conditionValue: { ...formData.conditionValue, atSpecificTime: e.target.checked }
                  })}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <span className="text-[13px] font-medium text-gray-700">Trigger at a specific time of day</span>
              </label>

              {formData.conditionValue.atSpecificTime && (
                <div className="mt-2.5 flex items-center space-x-2 pl-6">
                  <span className="text-[13px] text-gray-600">At</span>
                  <input
                    type="time"
                    value={formData.conditionValue.triggerTime || '09:00'}
                    onChange={(e) => setFormData({
                      ...formData,
                      conditionValue: { ...formData.conditionValue, triggerTime: e.target.value }
                    })}
                    className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-[11px] text-gray-400">(your local time)</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Specific date config ───────────────────── */}
        {formData.conditionType === 'specific_date' && (
          <div className="space-y-2.5 pt-1">
            <label className="block text-[13px] font-medium text-gray-700 mb-0.5">End date</label>
            <div className="flex items-center space-x-3 flex-wrap gap-y-2">
              <input
                type="date"
                value={formData.conditionValue.date || ''}
                onChange={(e) => setFormData({
                  ...formData,
                  conditionValue: { ...formData.conditionValue, date: e.target.value }
                })}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-[13px] text-gray-400">at</span>
              <input
                type="time"
                value={formData.conditionValue.triggerTime || '09:00'}
                onChange={(e) => setFormData({
                  ...formData,
                  conditionValue: { ...formData.conditionValue, triggerTime: e.target.value }
                })}
                className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-[11px] text-gray-400">(your local time)</span>
            </div>
          </div>
        )}

        {/* ── All assets completed config ─────────────── */}
        {formData.conditionType === 'all_assets_completed' && (
          <div className="space-y-3 pt-1">
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
              <span className="text-[13px] text-gray-700">Consider removed assets as complete</span>
            </label>
            <div className="flex items-center space-x-2">
              <span className="text-[13px] text-gray-600">Wait</span>
              <input
                type="number"
                min="0"
                value={formData.conditionValue.grace_period_days || 0}
                onChange={(e) => setFormData({
                  ...formData,
                  conditionValue: { ...formData.conditionValue, grace_period_days: parseInt(e.target.value) || 0 }
                })}
                className="w-16 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-[13px] text-gray-600">days after completion (grace period)</span>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-gray-100" />

      {/* ─── 2. Outcome ──────────────────────────────── */}
      <div className="space-y-4">
        <div>
          <h4 className="text-[13px] font-semibold text-gray-900">Outcome</h4>
          <p className="text-[11px] text-gray-400 mt-0.5">What should happen when it closes?</p>
        </div>

        <div className="space-y-2">
          {/* End run */}
          <label className={`flex items-start px-3.5 py-3 rounded-lg cursor-pointer transition-all ${
            formData.actionType === 'mark_complete'
              ? 'border border-blue-500 bg-blue-50/60 shadow-sm'
              : 'border border-gray-200 hover:border-gray-300'
          }`}>
            <input
              type="radio"
              name="actionType"
              checked={formData.actionType === 'mark_complete'}
              onChange={() => setFormData({ ...formData, actionType: 'mark_complete', actionValue: {} })}
              className="mt-0.5 mr-3 accent-blue-600"
            />
            <div>
              <div className={`text-[13px] font-medium ${formData.actionType === 'mark_complete' ? 'text-blue-900' : 'text-gray-800'}`}>
                End run
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">
                Close this cycle. The run stays visible in history.
              </p>
            </div>
          </label>

          {/* End run & archive */}
          <label className={`flex items-start px-3.5 py-3 rounded-lg cursor-pointer transition-all ${
            formData.actionType === 'archive_branch'
              ? 'border border-blue-500 bg-blue-50/60 shadow-sm'
              : 'border border-gray-200 hover:border-gray-300'
          }`}>
            <input
              type="radio"
              name="actionType"
              checked={formData.actionType === 'archive_branch'}
              onChange={() => setFormData({ ...formData, actionType: 'archive_branch', actionValue: {} })}
              className="mt-0.5 mr-3 accent-blue-600"
            />
            <div>
              <div className={`text-[13px] font-medium ${formData.actionType === 'archive_branch' ? 'text-blue-900' : 'text-gray-800'}`}>
                End run & archive
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">
                Close this cycle and move to archive. Can be restored if needed.
              </p>
            </div>
          </label>

          {/* Send notification only */}
          <label className={`flex items-start px-3.5 py-3 rounded-lg cursor-pointer transition-all ${
            formData.actionType === 'notify_only'
              ? 'border border-blue-500 bg-blue-50/60 shadow-sm'
              : 'border border-gray-200 hover:border-gray-300'
          }`}>
            <input
              type="radio"
              name="actionType"
              checked={formData.actionType === 'notify_only'}
              onChange={() => setFormData({ ...formData, actionType: 'notify_only', actionValue: {} })}
              className="mt-0.5 mr-3 accent-blue-600"
            />
            <div>
              <div className={`text-[13px] font-medium ${formData.actionType === 'notify_only' ? 'text-blue-900' : 'text-gray-800'}`}>
                Send notification only
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">
                Notify without changing run status.
              </p>
            </div>
          </label>
        </div>
      </div>

      <div className="border-t border-gray-100" />

      {/* ─── 3. Notifications ────────────────────────── */}
      <div className="space-y-2.5">
        <p className="text-[12px] font-medium text-gray-500">Notifications <span className="font-normal text-gray-400">— optional</span></p>
        <div className="space-y-1.5">
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.actionValue.notify_owner !== false}
              onChange={(e) => setFormData({
                ...formData,
                actionValue: { ...formData.actionValue, notify_owner: e.target.checked }
              })}
              className="h-3.5 w-3.5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <span className="text-[13px] text-gray-600">Notify run owner</span>
          </label>
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.actionValue.notify_collaborators || false}
              onChange={(e) => setFormData({
                ...formData,
                actionValue: { ...formData.actionValue, notify_collaborators: e.target.checked }
              })}
              className="h-3.5 w-3.5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <span className="text-[13px] text-gray-600">Notify all collaborators</span>
          </label>
        </div>
      </div>

      <div className="border-t border-gray-100" />

      {/* ─── Summary Preview ─────────────────────────── */}
      <div className="bg-blue-50/60 border border-blue-200 rounded-md px-3.5 py-3">
        <div className="flex items-center space-x-2">
          <Eye className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
          <p className="text-sm text-blue-900">
            <span className="font-medium">{triggerSummary}</span>
            <span className="text-blue-400 mx-1.5">→</span>
            <span className="font-semibold">{outcomeSummary}{notifySuffix}.</span>
          </p>
        </div>
      </div>
    </form>
  )

  if (embedded) return formContent

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100] p-4 pt-32 pb-8">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[calc(100vh-10rem)] overflow-hidden flex flex-col">
        {/* Fixed Header */}
        <div className="px-6 py-5 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Create Run Ending Rule</h2>
              <p className="text-sm text-gray-500 mt-0.5">Define when and how runs are closed.</p>
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
        <div className="px-6 py-5 overflow-y-auto flex-1">
          {formContent}
        </div>

        {/* Fixed Footer */}
        <div className="px-6 py-3.5 border-t border-gray-200 flex justify-end items-center space-x-3 flex-shrink-0">
          <Button type="button" variant="outline" onClick={onClose} className="text-gray-500">
            Cancel
          </Button>
          <Button type="submit" form="add-branch-ending-rule-form" className="bg-blue-600 hover:bg-blue-700 text-white shadow-sm">
            Create Rule
          </Button>
        </div>
      </div>
    </div>
  )
}
