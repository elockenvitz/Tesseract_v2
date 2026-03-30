/**
 * AddRuleModal Component
 *
 * Modal for adding a new automation rule to a workflow.
 * Extracted from WorkflowsPage.tsx during Phase 5 refactoring.
 */

import React, { useState, useEffect } from 'react'
import { X, Clock, Zap, Activity, Target, Eye, ChevronDown } from 'lucide-react'
import { Button } from '../../ui/Button'
import type { WorkflowStage } from '../../../types/workflow'

export interface AddRuleModalProps {
  /** Workflow ID */
  workflowId: string

  /** Workflow name */
  workflowName: string

  /** Workflow stages */
  workflowStages: WorkflowStage[]

  /** Cadence timeframe */
  cadenceTimeframe?: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'semi-annually' | 'annually' | 'persistent'

  /** Callback when modal is closed */
  onClose: () => void

  /** Callback when rule is saved */
  onSave: (ruleData: any) => void

  /**
   * When true, renders only the form body (no modal backdrop, header, or footer).
   * Used to embed the form inline inside the wizard Step 5 content area.
   */
  embedded?: boolean

  /** Called when the form's dirty state changes (name field non-empty). */
  onDirtyChange?: (dirty: boolean) => void
}

// Helper functions for dynamic workflow name suffixes
function getCurrentQuarter(): number {
  const month = new Date().getMonth() + 1
  return Math.ceil(month / 3)
}

function getCurrentYear(): number {
  return new Date().getFullYear()
}

function getQuarterMonths(quarter: number): { start: string, end: string } {
  const months = {
    1: { start: 'Jan', end: 'Mar' },
    2: { start: 'Apr', end: 'Jun' },
    3: { start: 'Jul', end: 'Sep' },
    4: { start: 'Oct', end: 'Dec' }
  }
  return months[quarter as keyof typeof months]
}

function processDynamicSuffix(suffix: string): string {
  if (!suffix) return ''

  const now = new Date()
  const quarter = getCurrentQuarter()
  const year = getCurrentYear()
  const months = getQuarterMonths(quarter)
  const currentMonth = now.toLocaleString('en-US', { month: 'short' })
  const currentDay = now.getDate()
  const formattedDate = `${currentMonth} ${currentDay} ${year}`

  return suffix
    .replace(/{Q}/g, quarter.toString())
    .replace(/{QUARTER}/g, `Q${quarter}`)
    .replace(/{YEAR}/g, year.toString())
    .replace(/{YY}/g, year.toString().slice(-2))
    .replace(/{MONTH}/g, currentMonth)
    .replace(/{START_MONTH}/g, months.start)
    .replace(/{END_MONTH}/g, months.end)
    .replace(/{DATE}/g, formattedDate)
    .replace(/{DAY}/g, currentDay.toString())
}

export function AddRuleModal({ workflowId, workflowName, workflowStages, cadenceTimeframe, onClose, onSave, embedded, onDirtyChange }: AddRuleModalProps) {
  const [formData, setFormData] = useState({
    name: '',
    type: 'time',
    conditionType: 'time_interval',
    conditionValue: {},
    actionType: 'branch_copy',
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
      onSave(formData)
    }
  }

  // ── Embedded mode: render form body only (no modal chrome) ──
  const formContent = (
        <form id="add-rule-form" onSubmit={handleSubmit} className="space-y-7">
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
                placeholder="e.g., Weekly Review Reset"
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
              <p className="text-[11px] text-gray-400 mt-0.5">When should a new run be created?</p>
            </div>

              <div className="grid grid-cols-2 gap-2.5">
                {[
                  { value: 'time', label: 'On a schedule', icon: Clock, desc: 'Daily, weekly, monthly, or custom cadence' },
                  { value: 'event', label: 'On a market event', icon: Zap, desc: 'Earnings, price changes, or volume spikes' },
                  { value: 'activity', label: 'On user action', icon: Activity, desc: 'Stage completion, notes, or list changes' },
                  { value: 'perpetual', label: 'Always available', icon: Target, desc: 'No automatic trigger — manual start only' }
                ].map((option) => {
                  const Icon = option.icon
                  const selected = formData.type === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        const conditionMap: Record<string, string> = {
                          'time': 'time_interval',
                          'event': 'earnings_date',
                          'activity': 'stage_completion',
                          'perpetual': 'always_available'
                        }
                        setFormData({
                          ...formData,
                          type: option.value,
                          conditionType: conditionMap[option.value],
                          conditionValue: {}
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

              {/* ── Time trigger configuration ──────────────────── */}
              {formData.type === 'time' && (
                <div className="space-y-3 pt-1">
                  {/* Recurrence Pattern */}
                  <div>
                    <h5 className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-2.5">Recurrence</h5>
                    <div className="flex space-x-6">
                      {/* Left Column - Radio Buttons */}
                      <div className="flex flex-col space-y-2 min-w-[100px]">
                        {(['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as const).map((pattern) => (
                          <label key={pattern} htmlFor={`pattern-${pattern}`} className="flex items-center space-x-2 cursor-pointer">
                            <input
                              type="radio"
                              id={`pattern-${pattern}`}
                              checked={formData.conditionValue.pattern_type === pattern}
                              onChange={() => {
                                const defaults: Record<string, any> = {
                                  daily: { pattern_type: 'daily', daily_type: 'every_x_days', interval: 1 },
                                  weekly: { pattern_type: 'weekly', interval: 1, days_of_week: ['monday'] },
                                  monthly: { pattern_type: 'monthly', monthly_type: 'day_of_month', day_number: 1, interval: 1 },
                                  quarterly: { pattern_type: 'quarterly', quarterly_type: 'day_of_quarter', day_number: 1, interval: 1 },
                                  yearly: { pattern_type: 'yearly', yearly_type: 'specific_date', month: 'january', day_number: 1 },
                                }
                                setFormData({ ...formData, conditionValue: defaults[pattern] })
                              }}
                            />
                            <span className="text-sm font-medium text-gray-800 capitalize">{pattern}</span>
                          </label>
                        ))}
                      </div>

                      {/* Right Column - Configuration Options */}
                      <div className="flex-1 border-l border-gray-200 pl-5">
                        {/* Daily Options */}
                        {formData.conditionValue.pattern_type === 'daily' && (
                          <div className="flex flex-col space-y-2">
                            <div className="flex items-center space-x-2">
                              <input
                                type="radio"
                                id="daily-every-x"
                                checked={formData.conditionValue.daily_type === 'every_x_days'}
                                onChange={() => setFormData({
                                  ...formData,
                                  conditionValue: { ...formData.conditionValue, daily_type: 'every_x_days', interval: 1 }
                                })}
                              />
                              <label htmlFor="daily-every-x" className="text-sm text-gray-700">Every</label>
                              <input
                                type="number"
                                min="1"
                                value={formData.conditionValue.interval || 1}
                                onChange={(e) => setFormData({
                                  ...formData,
                                  conditionValue: { ...formData.conditionValue, interval: parseInt(e.target.value) || 1 }
                                })}
                                className="w-14 px-2 py-1 border border-gray-300 rounded text-sm"
                                disabled={formData.conditionValue.daily_type !== 'every_x_days'}
                              />
                              <span className="text-sm text-gray-700">day(s)</span>
                            </div>
                            <div className="flex items-center space-x-2">
                              <input
                                type="radio"
                                id="daily-weekday"
                                checked={formData.conditionValue.daily_type === 'every_weekday'}
                                onChange={() => setFormData({
                                  ...formData,
                                  conditionValue: { ...formData.conditionValue, daily_type: 'every_weekday' }
                                })}
                              />
                              <label htmlFor="daily-weekday" className="text-sm text-gray-700">Every weekday</label>
                            </div>
                          </div>
                        )}

                        {/* Weekly Options */}
                        {formData.conditionValue.pattern_type === 'weekly' && (
                          <div className="flex flex-col space-y-2">
                            <div className="flex items-center space-x-2">
                              <span className="text-sm text-gray-700">Every</span>
                              <input
                                type="number"
                                min="1"
                                value={formData.conditionValue.interval || 1}
                                onChange={(e) => setFormData({
                                  ...formData,
                                  conditionValue: { ...formData.conditionValue, interval: parseInt(e.target.value) || 1 }
                                })}
                                className="w-14 px-2 py-1 border border-gray-300 rounded text-sm"
                              />
                              <span className="text-sm text-gray-700">week(s) on:</span>
                            </div>
                            <div className="grid grid-cols-4 gap-1.5">
                              {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day) => (
                                <label key={day} className="flex items-center space-x-1.5 text-sm">
                                  <input
                                    type="checkbox"
                                    checked={(formData.conditionValue.days_of_week || []).includes(day.toLowerCase())}
                                    onChange={(e) => {
                                      const days = formData.conditionValue.days_of_week || []
                                      const newDays = e.target.checked
                                        ? [...days, day.toLowerCase()]
                                        : days.filter((d: string) => d !== day.toLowerCase())
                                      setFormData({
                                        ...formData,
                                        conditionValue: { ...formData.conditionValue, days_of_week: newDays }
                                      })
                                    }}
                                  />
                                  <span>{day.slice(0, 3)}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Monthly Options */}
                        {formData.conditionValue.pattern_type === 'monthly' && (
                          <div className="flex flex-col space-y-2">
                            <div className="flex items-center space-x-2">
                              <input
                                type="radio"
                                id="monthly-day"
                                checked={formData.conditionValue.monthly_type === 'day_of_month'}
                                onChange={() => setFormData({
                                  ...formData,
                                  conditionValue: { ...formData.conditionValue, monthly_type: 'day_of_month', day_number: 1 }
                                })}
                              />
                              <label htmlFor="monthly-day" className="text-sm text-gray-700">Day</label>
                              <input
                                type="number"
                                min="1"
                                max="31"
                                value={formData.conditionValue.day_number || 1}
                                onChange={(e) => setFormData({
                                  ...formData,
                                  conditionValue: { ...formData.conditionValue, day_number: parseInt(e.target.value) || 1 }
                                })}
                                className="w-14 px-2 py-1 border border-gray-300 rounded text-sm"
                                disabled={formData.conditionValue.monthly_type !== 'day_of_month'}
                              />
                              <span className="text-sm text-gray-700">of every</span>
                              <input
                                type="number"
                                min="1"
                                value={formData.conditionValue.interval || 1}
                                onChange={(e) => setFormData({
                                  ...formData,
                                  conditionValue: { ...formData.conditionValue, interval: parseInt(e.target.value) || 1 }
                                })}
                                className="w-14 px-2 py-1 border border-gray-300 rounded text-sm"
                                disabled={formData.conditionValue.monthly_type !== 'day_of_month'}
                              />
                              <span className="text-sm text-gray-700">month(s)</span>
                            </div>
                            <div className="flex items-center space-x-2">
                              <input
                                type="radio"
                                id="monthly-position"
                                checked={formData.conditionValue.monthly_type === 'position_of_month'}
                                onChange={() => setFormData({
                                  ...formData,
                                  conditionValue: {
                                    ...formData.conditionValue,
                                    monthly_type: 'position_of_month',
                                    position: 'first',
                                    day_name: 'monday'
                                  }
                                })}
                              />
                              <label htmlFor="monthly-position" className="text-sm text-gray-700">The</label>
                              <select
                                value={formData.conditionValue.position || 'first'}
                                onChange={(e) => setFormData({
                                  ...formData,
                                  conditionValue: { ...formData.conditionValue, position: e.target.value }
                                })}
                                className="px-2 py-1 border border-gray-300 rounded text-sm"
                                disabled={formData.conditionValue.monthly_type !== 'position_of_month'}
                              >
                                <option value="first">First</option>
                                <option value="second">Second</option>
                                <option value="third">Third</option>
                                <option value="fourth">Fourth</option>
                                <option value="last">Last</option>
                              </select>
                              <select
                                value={formData.conditionValue.day_name || 'monday'}
                                onChange={(e) => setFormData({
                                  ...formData,
                                  conditionValue: { ...formData.conditionValue, day_name: e.target.value }
                                })}
                                className="px-2 py-1 border border-gray-300 rounded text-sm"
                                disabled={formData.conditionValue.monthly_type !== 'position_of_month'}
                              >
                                <option value="day">Day</option>
                                <option value="weekday">Weekday</option>
                                <option value="weekend_day">Weekend day</option>
                                <option value="monday">Monday</option>
                                <option value="tuesday">Tuesday</option>
                                <option value="wednesday">Wednesday</option>
                                <option value="thursday">Thursday</option>
                                <option value="friday">Friday</option>
                                <option value="saturday">Saturday</option>
                                <option value="sunday">Sunday</option>
                              </select>
                              <span className="text-sm text-gray-700">of every</span>
                              <input
                                type="number"
                                min="1"
                                value={formData.conditionValue.interval || 1}
                                onChange={(e) => setFormData({
                                  ...formData,
                                  conditionValue: { ...formData.conditionValue, interval: parseInt(e.target.value) || 1 }
                                })}
                                className="w-14 px-2 py-1 border border-gray-300 rounded text-sm"
                                disabled={formData.conditionValue.monthly_type !== 'position_of_month'}
                              />
                              <span className="text-sm text-gray-700">month(s)</span>
                            </div>
                          </div>
                        )}

                        {/* Quarterly Options */}
                        {formData.conditionValue.pattern_type === 'quarterly' && (
                          <div className="flex flex-col space-y-2">
                            <div className="flex items-center space-x-2">
                              <input
                                type="radio"
                                id="quarterly-day"
                                checked={formData.conditionValue.quarterly_type === 'day_of_quarter'}
                                onChange={() => setFormData({
                                  ...formData,
                                  conditionValue: { ...formData.conditionValue, quarterly_type: 'day_of_quarter', day_number: 1 }
                                })}
                              />
                              <label htmlFor="quarterly-day" className="text-sm text-gray-700">Day</label>
                              <input
                                type="number"
                                min="1"
                                max="92"
                                value={formData.conditionValue.day_number || 1}
                                onChange={(e) => setFormData({
                                  ...formData,
                                  conditionValue: { ...formData.conditionValue, day_number: parseInt(e.target.value) || 1 }
                                })}
                                className="w-14 px-2 py-1 border border-gray-300 rounded text-sm"
                                disabled={formData.conditionValue.quarterly_type !== 'day_of_quarter'}
                              />
                              <span className="text-sm text-gray-700">of every</span>
                              <input
                                type="number"
                                min="1"
                                value={formData.conditionValue.interval || 1}
                                onChange={(e) => setFormData({
                                  ...formData,
                                  conditionValue: { ...formData.conditionValue, interval: parseInt(e.target.value) || 1 }
                                })}
                                className="w-14 px-2 py-1 border border-gray-300 rounded text-sm"
                                disabled={formData.conditionValue.quarterly_type !== 'day_of_quarter'}
                              />
                              <span className="text-sm text-gray-700">quarter(s)</span>
                            </div>
                            <div className="flex items-center space-x-2">
                              <input
                                type="radio"
                                id="quarterly-position"
                                checked={formData.conditionValue.quarterly_type === 'position_of_quarter'}
                                onChange={() => setFormData({
                                  ...formData,
                                  conditionValue: {
                                    ...formData.conditionValue,
                                    quarterly_type: 'position_of_quarter',
                                    position: 'first',
                                    day_name: 'monday'
                                  }
                                })}
                              />
                              <label htmlFor="quarterly-position" className="text-sm text-gray-700">The</label>
                              <select
                                value={formData.conditionValue.position || 'first'}
                                onChange={(e) => setFormData({
                                  ...formData,
                                  conditionValue: { ...formData.conditionValue, position: e.target.value }
                                })}
                                className="px-2 py-1 border border-gray-300 rounded text-sm"
                                disabled={formData.conditionValue.quarterly_type !== 'position_of_quarter'}
                              >
                                <option value="first">First</option>
                                <option value="second">Second</option>
                                <option value="third">Third</option>
                                <option value="fourth">Fourth</option>
                                <option value="last">Last</option>
                              </select>
                              <select
                                value={formData.conditionValue.day_name || 'monday'}
                                onChange={(e) => setFormData({
                                  ...formData,
                                  conditionValue: { ...formData.conditionValue, day_name: e.target.value }
                                })}
                                className="px-2 py-1 border border-gray-300 rounded text-sm"
                                disabled={formData.conditionValue.quarterly_type !== 'position_of_quarter'}
                              >
                                <option value="day">Day</option>
                                <option value="weekday">Weekday</option>
                                <option value="weekend_day">Weekend day</option>
                                <option value="monday">Monday</option>
                                <option value="tuesday">Tuesday</option>
                                <option value="wednesday">Wednesday</option>
                                <option value="thursday">Thursday</option>
                                <option value="friday">Friday</option>
                                <option value="saturday">Saturday</option>
                                <option value="sunday">Sunday</option>
                              </select>
                              <span className="text-sm text-gray-700">of every</span>
                              <input
                                type="number"
                                min="1"
                                value={formData.conditionValue.interval || 1}
                                onChange={(e) => setFormData({
                                  ...formData,
                                  conditionValue: { ...formData.conditionValue, interval: parseInt(e.target.value) || 1 }
                                })}
                                className="w-14 px-2 py-1 border border-gray-300 rounded text-sm"
                                disabled={formData.conditionValue.quarterly_type !== 'position_of_quarter'}
                              />
                              <span className="text-sm text-gray-700">quarter(s)</span>
                            </div>
                          </div>
                        )}

                        {/* Yearly Options */}
                        {formData.conditionValue.pattern_type === 'yearly' && (
                          <div className="flex flex-col space-y-2">
                            <div className="flex items-center space-x-2">
                              <input
                                type="radio"
                                id="yearly-date"
                                checked={formData.conditionValue.yearly_type === 'specific_date'}
                                onChange={() => setFormData({
                                  ...formData,
                                  conditionValue: { ...formData.conditionValue, yearly_type: 'specific_date' }
                                })}
                              />
                              <label htmlFor="yearly-date" className="text-sm text-gray-700">On</label>
                              <select
                                value={formData.conditionValue.month || 'january'}
                                onChange={(e) => setFormData({
                                  ...formData,
                                  conditionValue: { ...formData.conditionValue, month: e.target.value }
                                })}
                                className="px-2 py-1 border border-gray-300 rounded text-sm"
                                disabled={formData.conditionValue.yearly_type !== 'specific_date'}
                              >
                                {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map(m => (
                                  <option key={m} value={m.toLowerCase()}>{m}</option>
                                ))}
                              </select>
                              <input
                                type="number"
                                min="1"
                                max="31"
                                value={formData.conditionValue.day_number || 1}
                                onChange={(e) => setFormData({
                                  ...formData,
                                  conditionValue: { ...formData.conditionValue, day_number: parseInt(e.target.value) || 1 }
                                })}
                                className="w-14 px-2 py-1 border border-gray-300 rounded text-sm"
                                disabled={formData.conditionValue.yearly_type !== 'specific_date'}
                              />
                            </div>
                            <div className="flex items-center space-x-2">
                              <input
                                type="radio"
                                id="yearly-position"
                                checked={formData.conditionValue.yearly_type === 'position_of_year'}
                                onChange={() => setFormData({
                                  ...formData,
                                  conditionValue: {
                                    ...formData.conditionValue,
                                    yearly_type: 'position_of_year',
                                    position: 'first',
                                    day_name: 'monday',
                                    month: 'january'
                                  }
                                })}
                              />
                              <label htmlFor="yearly-position" className="text-sm text-gray-700">The</label>
                              <select
                                value={formData.conditionValue.position || 'first'}
                                onChange={(e) => setFormData({
                                  ...formData,
                                  conditionValue: { ...formData.conditionValue, position: e.target.value }
                                })}
                                className="px-2 py-1 border border-gray-300 rounded text-sm"
                                disabled={formData.conditionValue.yearly_type !== 'position_of_year'}
                              >
                                <option value="first">First</option>
                                <option value="second">Second</option>
                                <option value="third">Third</option>
                                <option value="fourth">Fourth</option>
                                <option value="last">Last</option>
                              </select>
                              <select
                                value={formData.conditionValue.day_name || 'monday'}
                                onChange={(e) => setFormData({
                                  ...formData,
                                  conditionValue: { ...formData.conditionValue, day_name: e.target.value }
                                })}
                                className="px-2 py-1 border border-gray-300 rounded text-sm"
                                disabled={formData.conditionValue.yearly_type !== 'position_of_year'}
                              >
                                <option value="day">Day</option>
                                <option value="weekday">Weekday</option>
                                <option value="weekend_day">Weekend day</option>
                                <option value="monday">Monday</option>
                                <option value="tuesday">Tuesday</option>
                                <option value="wednesday">Wednesday</option>
                                <option value="thursday">Thursday</option>
                                <option value="friday">Friday</option>
                                <option value="saturday">Saturday</option>
                                <option value="sunday">Sunday</option>
                              </select>
                              <span className="text-sm text-gray-700">of</span>
                              <select
                                value={formData.conditionValue.month || 'january'}
                                onChange={(e) => setFormData({
                                  ...formData,
                                  conditionValue: { ...formData.conditionValue, month: e.target.value }
                                })}
                                className="px-2 py-1 border border-gray-300 rounded text-sm"
                                disabled={formData.conditionValue.yearly_type !== 'position_of_year'}
                              >
                                {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map(m => (
                                  <option key={m} value={m.toLowerCase()}>{m}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        )}

                        {/* No pattern selected yet */}
                        {!formData.conditionValue.pattern_type && (
                          <p className="text-sm text-gray-400 py-2">Choose how often this run should repeat.</p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-gray-100" />

                  {/* Time of Day */}
                  <div>
                    <h5 className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-2">Time of day</h5>
                    <div className="flex items-center space-x-3">
                      <span className="text-sm text-gray-600">Trigger time:</span>
                      <input
                        type="time"
                        value={formData.conditionValue.trigger_time || '09:00'}
                        onChange={(e) => setFormData({
                          ...formData,
                          conditionValue: { ...formData.conditionValue, trigger_time: e.target.value }
                        })}
                        className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1.5">Uses your local timezone.</p>
                  </div>

                  <div className="border-t border-gray-100" />

                  {/* Range */}
                  <div>
                    <h5 className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-2">Range</h5>
                    <div className="space-y-2.5">
                      <div className="flex items-center space-x-2">
                        <label className="text-sm text-gray-600 w-16">Start:</label>
                        <input
                          type="date"
                          value={formData.conditionValue.start_date || ''}
                          onChange={(e) => setFormData({
                            ...formData,
                            conditionValue: { ...formData.conditionValue, start_date: e.target.value }
                          })}
                          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex items-center space-x-2">
                          <input
                            type="radio"
                            id="end-no-end"
                            checked={formData.conditionValue.end_type === 'no_end' || !formData.conditionValue.end_type}
                            onChange={() => setFormData({
                              ...formData,
                              conditionValue: { ...formData.conditionValue, end_type: 'no_end' }
                            })}
                          />
                          <label htmlFor="end-no-end" className="text-sm text-gray-700">No end date</label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <input
                            type="radio"
                            id="end-after"
                            checked={formData.conditionValue.end_type === 'after_occurrences'}
                            onChange={() => setFormData({
                              ...formData,
                              conditionValue: { ...formData.conditionValue, end_type: 'after_occurrences', occurrences: 10 }
                            })}
                          />
                          <label htmlFor="end-after" className="text-sm text-gray-700">End after</label>
                          <input
                            type="number"
                            min="1"
                            value={formData.conditionValue.occurrences || 10}
                            onChange={(e) => setFormData({
                              ...formData,
                              conditionValue: { ...formData.conditionValue, occurrences: parseInt(e.target.value) || 1 }
                            })}
                            className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                            disabled={formData.conditionValue.end_type !== 'after_occurrences'}
                          />
                          <span className="text-sm text-gray-700">occurrences</span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <input
                            type="radio"
                            id="end-by-date"
                            checked={formData.conditionValue.end_type === 'end_by_date'}
                            onChange={() => setFormData({
                              ...formData,
                              conditionValue: { ...formData.conditionValue, end_type: 'end_by_date' }
                            })}
                          />
                          <label htmlFor="end-by-date" className="text-sm text-gray-700">End by</label>
                          <input
                            type="date"
                            value={formData.conditionValue.end_date || ''}
                            onChange={(e) => setFormData({
                              ...formData,
                              conditionValue: { ...formData.conditionValue, end_date: e.target.value }
                            })}
                            className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            disabled={formData.conditionValue.end_type !== 'end_by_date'}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Event trigger configuration ─────────────────── */}
              {formData.type === 'event' && (
                <div className="space-y-3 pt-1">
                  <div>
                    <label className="block text-[13px] font-medium text-gray-700 mb-1.5">Event Type</label>
                    <select
                      value={formData.conditionType}
                      onChange={(e) => setFormData({ ...formData, conditionType: e.target.value, conditionValue: {} })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
                    >
                      <optgroup label="Corporate Events">
                        <option value="earnings_date">Earnings Date</option>
                        <option value="dividend_date">Dividend Date</option>
                        <option value="conference">Conference</option>
                        <option value="investor_relations_call">Investor Relations Call</option>
                        <option value="analyst_call">Sell-Side Analyst Call</option>
                        <option value="roadshow">Roadshow</option>
                      </optgroup>
                      <optgroup label="Market Activity">
                        <option value="price_change">Price Change</option>
                        <option value="volume_spike">Volume Spike</option>
                      </optgroup>
                    </select>
                  </div>

                  {formData.conditionType === 'earnings_date' && (
                    <div className="flex items-center space-x-2">
                      <input
                        type="number"
                        min="0"
                        value={formData.conditionValue.days_offset || ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          conditionValue: { ...formData.conditionValue, days_offset: parseInt(e.target.value) }
                        })}
                        className="w-16 px-2 py-1.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                        placeholder="3"
                      />
                      <span className="text-sm text-gray-600">days</span>
                      <select
                        value={formData.conditionValue.timing || 'before'}
                        onChange={(e) => setFormData({
                          ...formData,
                          conditionValue: { ...formData.conditionValue, timing: e.target.value }
                        })}
                        className="px-3 py-1.5 border border-gray-300 rounded-md bg-white text-sm"
                      >
                        <option value="before">before</option>
                        <option value="after">after</option>
                      </select>
                      <span className="text-sm text-gray-600">earnings</span>
                    </div>
                  )}

                  {formData.conditionType === 'price_change' && (
                    <div className="flex items-center space-x-2">
                      <span className="text-sm text-gray-600">When price changes by</span>
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={formData.conditionValue.percentage || ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          conditionValue: { ...formData.conditionValue, percentage: parseFloat(e.target.value) }
                        })}
                        className="w-16 px-2 py-1.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                        placeholder="5"
                      />
                      <span className="text-sm text-gray-600">%</span>
                      <select
                        value={formData.conditionValue.direction || 'either'}
                        onChange={(e) => setFormData({
                          ...formData,
                          conditionValue: { ...formData.conditionValue, direction: e.target.value }
                        })}
                        className="px-3 py-1.5 border border-gray-300 rounded-md bg-white text-sm"
                      >
                        <option value="up">up</option>
                        <option value="down">down</option>
                        <option value="either">either direction</option>
                      </select>
                    </div>
                  )}

                  {formData.conditionType === 'volume_spike' && (
                    <div className="flex items-center space-x-2">
                      <span className="text-sm text-gray-600">When volume is</span>
                      <input
                        type="number"
                        min="1"
                        step="0.1"
                        value={formData.conditionValue.multiplier || ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          conditionValue: { ...formData.conditionValue, multiplier: parseFloat(e.target.value) }
                        })}
                        className="w-16 px-2 py-1.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                        placeholder="2"
                      />
                      <span className="text-sm text-gray-600">\u00d7 average volume</span>
                    </div>
                  )}

                  {['dividend_date', 'conference', 'investor_relations_call', 'analyst_call', 'roadshow'].includes(formData.conditionType) && (
                    <div className="flex items-center space-x-2">
                      <input
                        type="number"
                        min="0"
                        value={formData.conditionValue.days_offset || ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          conditionValue: { ...formData.conditionValue, days_offset: parseInt(e.target.value) }
                        })}
                        className="w-16 px-2 py-1.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                        placeholder="3"
                      />
                      <span className="text-sm text-gray-600">days</span>
                      <select
                        value={formData.conditionValue.timing || 'before'}
                        onChange={(e) => setFormData({
                          ...formData,
                          conditionValue: { ...formData.conditionValue, timing: e.target.value }
                        })}
                        className="px-3 py-1.5 border border-gray-300 rounded-md bg-white text-sm"
                      >
                        <option value="before">before</option>
                        <option value="after">after</option>
                      </select>
                      <span className="text-sm text-gray-600">
                        {formData.conditionType === 'dividend_date' ? 'dividend date'
                          : formData.conditionType === 'conference' ? 'conference'
                          : formData.conditionType === 'investor_relations_call' ? 'investor relations call'
                          : formData.conditionType === 'analyst_call' ? 'sell-side analyst call'
                          : 'roadshow'}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* ── Activity trigger configuration ──────────────── */}
              {formData.type === 'activity' && (
                <div className="space-y-3 pt-1">
                  <div>
                    <label className="block text-[13px] font-medium text-gray-700 mb-1.5">Activity Type</label>
                    <select
                      value={formData.conditionType}
                      onChange={(e) => setFormData({ ...formData, conditionType: e.target.value, conditionValue: {} })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
                    >
                      <option value="stage_completion">Stage Completion</option>
                      <option value="note_added">Note Added</option>
                      <option value="list_assignment">Added to List</option>
                      <option value="workflow_start">Workflow Started</option>
                    </select>
                  </div>

                  {formData.conditionType === 'stage_completion' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">Stage</label>
                      <select
                        value={formData.conditionValue.stage_key || ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          conditionValue: { ...formData.conditionValue, stage_key: e.target.value }
                        })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
                      >
                        <option value="">Any stage</option>
                        {workflowStages.map((stage) => (
                          <option key={stage.stage_key} value={stage.stage_key}>
                            {stage.stage_label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {/* ── Perpetual info ──────────────────────────────── */}
              {formData.type === 'perpetual' && (
                <p className="text-[13px] text-gray-400 py-1">This process is always available — no automatic trigger.</p>
              )}
          </div>

          {/* ─── 2. Run Behavior ──────────────────────────── */}
          {formData.type !== 'perpetual' && (
          <>
          <div className="border-t border-gray-100" />

          <div className="space-y-4">
            <div>
              <h4 className="text-[13px] font-semibold text-gray-900">Run Behavior</h4>
              <p className="text-[11px] text-gray-400 mt-0.5">How should the new run be created?</p>
            </div>

            {/* Embedded mode: always creating a run — hide the action type dropdown */}
            {embedded ? (
              <p className="text-[13px] text-gray-500">This rule creates a new run each time the trigger fires.</p>
            ) : (
              <div>
                <label className="block text-[13px] font-medium text-gray-700 mb-1.5">Action type</label>
                <select
                  value={formData.actionType === 'branch_copy' || formData.actionType === 'branch_nocopy' ? 'branch_create' : formData.actionType}
                  onChange={(e) => {
                    const val = e.target.value
                    if (val === 'branch_create') {
                      setFormData({ ...formData, actionType: 'branch_nocopy', actionValue: {} })
                    } else {
                      setFormData({ ...formData, actionType: val, actionValue: {} })
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
                >
                  <optgroup label="Workflow Progress">
                    <option value="move_stage">Move to a specific stage</option>
                    <option value="advance_stage">Advance to next stage</option>
                    <option value="reset_workflow">Reset workflow to beginning</option>
                  </optgroup>
                  <optgroup label="Runs">
                    <option value="branch_create">Start a new run</option>
                  </optgroup>
                  <optgroup label="Notification">
                    <option value="send_reminder">Send a reminder notification</option>
                  </optgroup>
                </select>
              </div>
            )}

            {/* Run mode */}
            {(formData.actionType === 'branch_copy' || formData.actionType === 'branch_nocopy') && (
              <div className="space-y-2">
                <label className="block text-[13px] font-medium text-gray-700">Run mode</label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    className={`rounded-lg px-3.5 py-3 text-left transition-all ${
                      formData.actionType === 'branch_nocopy'
                        ? 'border border-blue-500 bg-blue-50/60 shadow-sm'
                        : 'border border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'
                    }`}
                    onClick={() => setFormData({ ...formData, actionType: 'branch_nocopy' })}
                  >
                    <div className={`text-[13px] font-medium leading-tight ${formData.actionType === 'branch_nocopy' ? 'text-blue-900' : 'text-gray-800'}`}>
                      Start clean
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">No progress is carried over.</p>
                  </button>
                  <button
                    type="button"
                    className={`rounded-lg px-3.5 py-3 text-left transition-all ${
                      formData.actionType === 'branch_copy'
                        ? 'border border-blue-500 bg-blue-50/60 shadow-sm'
                        : 'border border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'
                    }`}
                    onClick={() => setFormData({ ...formData, actionType: 'branch_copy' })}
                  >
                    <div className={`text-[13px] font-medium leading-tight ${formData.actionType === 'branch_copy' ? 'text-blue-900' : 'text-gray-800'}`}>
                      Carry forward
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">Reset stages but keep notes, comments, and custom items from the prior run.</p>
                  </button>
                </div>
              </div>
            )}

            {/* Stage selection for move/reset actions (standalone only) */}
            {!embedded && (formData.actionType === 'move_stage' || formData.actionType === 'reset_workflow') && (
              <div>
                <label className="block text-[13px] font-medium text-gray-700 mb-1.5">
                  {formData.actionType === 'move_stage' ? 'Target stage' : 'Restart from'}
                </label>
                <select
                  value={formData.actionValue.target_stage || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    actionValue: { ...formData.actionValue, target_stage: e.target.value }
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
                >
                  <option value="">First stage</option>
                  {workflowStages.map((stage) => (
                    <option key={stage.stage_key} value={stage.stage_key}>
                      {stage.stage_label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-gray-400 mt-1">
                  {formData.actionType === 'move_stage'
                    ? 'The workflow will move to this stage when the rule triggers.'
                    : 'The workflow will restart from this stage (all progress will be reset).'}
                </p>
              </div>
            )}

            {!embedded && formData.actionType === 'send_reminder' && (
              <p className="text-[13px] text-gray-500">
                This will send a notification without making any changes to the workflow progress.
              </p>
            )}
          </div>
          </>
          )}

          {/* ─── 3. Run Naming ──────────────────────────── */}
          {(formData.actionType === 'branch_copy' || formData.actionType === 'branch_nocopy') && (
          <>
          <div className="border-t border-gray-100" />

          <div className="space-y-3">
            <div>
              <h4 className="text-[13px] font-semibold text-gray-900">Run Naming</h4>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Each run is named "{workflowName} - <em>suffix</em>". Pick or type a suffix below.
              </p>
            </div>

            {/* Quick Insert Templates */}
            <div className="grid grid-cols-4 gap-1.5">
              <button
                type="button"
                onClick={() => setFormData({
                  ...formData,
                  actionValue: { ...formData.actionValue, branch_suffix: '{MONTH} {YEAR}' }
                })}
                className="px-2.5 py-2 text-xs bg-white border border-gray-200 hover:border-blue-400 hover:bg-blue-50 rounded-md transition-colors text-center"
              >
                <div className="font-medium text-gray-900">{new Date().toLocaleString('en-US', { month: 'short' })} {getCurrentYear()}</div>
                <div className="text-[10px] text-gray-400 mt-0.5">Monthly</div>
              </button>
              <button
                type="button"
                onClick={() => setFormData({
                  ...formData,
                  actionValue: { ...formData.actionValue, branch_suffix: '{QUARTER} {YEAR}' }
                })}
                className="px-2.5 py-2 text-xs bg-white border border-gray-200 hover:border-blue-400 hover:bg-blue-50 rounded-md transition-colors text-center"
              >
                <div className="font-medium text-gray-900">Q{getCurrentQuarter()} {getCurrentYear()}</div>
                <div className="text-[10px] text-gray-400 mt-0.5">Quarterly</div>
              </button>
              <button
                type="button"
                onClick={() => setFormData({
                  ...formData,
                  actionValue: { ...formData.actionValue, branch_suffix: '{YEAR}' }
                })}
                className="px-2.5 py-2 text-xs bg-white border border-gray-200 hover:border-blue-400 hover:bg-blue-50 rounded-md transition-colors text-center"
              >
                <div className="font-medium text-gray-900">{getCurrentYear()}</div>
                <div className="text-[10px] text-gray-400 mt-0.5">Annual</div>
              </button>
              <button
                type="button"
                onClick={() => setFormData({
                  ...formData,
                  actionValue: { ...formData.actionValue, branch_suffix: '{DATE}' }
                })}
                className="px-2.5 py-2 text-xs bg-white border border-gray-200 hover:border-blue-400 hover:bg-blue-50 rounded-md transition-colors text-center"
              >
                <div className="font-medium text-gray-900">{processDynamicSuffix('{DATE}')}</div>
                <div className="text-[10px] text-gray-400 mt-0.5">Date</div>
              </button>
            </div>

            {/* Custom suffix input */}
            <input
              type="text"
              value={formData.actionValue.branch_suffix || ''}
              onChange={(e) => setFormData({
                ...formData,
                actionValue: { ...formData.actionValue, branch_suffix: e.target.value }
              })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
              placeholder="Custom suffix or use a template above"
            />

            {/* Preview — always visible */}
            <div className={`rounded-md px-3.5 py-3 ${formData.actionValue.branch_suffix ? 'bg-blue-50/60 border border-blue-200' : 'bg-gray-50 border border-gray-200'}`}>
              <div className="flex items-center space-x-2">
                <Eye className={`w-3.5 h-3.5 flex-shrink-0 ${formData.actionValue.branch_suffix ? 'text-blue-400' : 'text-gray-400'}`} />
                <p className={`text-sm truncate ${formData.actionValue.branch_suffix ? 'text-blue-900' : 'text-gray-400'}`}>
                  <span className="font-medium">
                    {formData.actionValue.branch_suffix
                      ? `${workflowName} - ${processDynamicSuffix(formData.actionValue.branch_suffix)}`
                      : `${workflowName} - ...`}
                  </span>
                </p>
              </div>
            </div>

            {/* Available Codes — collapsed by default */}
            <details className="text-xs">
              <summary className="cursor-pointer text-gray-500 hover:text-gray-700 font-medium flex items-center space-x-1">
                <ChevronDown className="w-3 h-3" />
                <span>Available dynamic codes</span>
              </summary>
              <div className="mt-2 ml-4 text-gray-500">
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                  <span><code className="bg-gray-100 px-1 py-0.5 rounded text-blue-600 text-[10px]">{'{QUARTER}'}</code> = Q{getCurrentQuarter()}</span>
                  <span><code className="bg-gray-100 px-1 py-0.5 rounded text-blue-600 text-[10px]">{'{Q}'}</code> = {getCurrentQuarter()}</span>
                  <span><code className="bg-gray-100 px-1 py-0.5 rounded text-blue-600 text-[10px]">{'{YEAR}'}</code> = {getCurrentYear()}</span>
                  <span><code className="bg-gray-100 px-1 py-0.5 rounded text-blue-600 text-[10px]">{'{YY}'}</code> = {getCurrentYear().toString().slice(-2)}</span>
                  <span><code className="bg-gray-100 px-1 py-0.5 rounded text-blue-600 text-[10px]">{'{MONTH}'}</code> = {new Date().toLocaleString('en-US', { month: 'short' })}</span>
                  <span><code className="bg-gray-100 px-1 py-0.5 rounded text-blue-600 text-[10px]">{'{DAY}'}</code> = {new Date().getDate()}</span>
                  <span><code className="bg-gray-100 px-1 py-0.5 rounded text-blue-600 text-[10px]">{'{DATE}'}</code> = {processDynamicSuffix('{DATE}')}</span>
                </div>
              </div>
            </details>
          </div>
          </>
          )}
        </form>
  )

  if (embedded) return formContent

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100] p-4 pt-32 pb-8">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[calc(100vh-10rem)] overflow-hidden flex flex-col">
        {/* Fixed Header */}
        <div className="px-6 py-5 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Create Run Rule</h2>
              <p className="text-sm text-gray-500 mt-0.5">Define when and how new runs are created.</p>
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
          <Button type="submit" form="add-rule-form" className="bg-blue-600 hover:bg-blue-700 text-white shadow-sm">
            Create Rule
          </Button>
        </div>
      </div>
    </div>
  )
}
