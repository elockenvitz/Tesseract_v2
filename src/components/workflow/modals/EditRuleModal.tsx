/**
 * EditRuleModal Component
 *
 * Modal for editing an existing automation rule.
 * Extracted from WorkflowsPage.tsx during Phase 5 refactoring.
 */

import React, { useState } from 'react'
import { X, Clock, Zap, Activity, Target, Eye } from 'lucide-react'
import { Button } from '../../ui/Button'
import type { WorkflowStage } from '../../../types/workflow'

export interface EditRuleModalProps {
  /** Rule to edit */
  rule: any

  /** Workflow name */
  workflowName: string

  /** Workflow stages */
  workflowStages: WorkflowStage[]

  /** Cadence timeframe */
  cadenceTimeframe?: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'semi-annually' | 'annually' | 'persistent'

  /** Callback when modal is closed */
  onClose: () => void

  /** Callback when rule is saved */
  onSave: (updates: any) => void
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

export function EditRuleModal({ rule, workflowName, workflowStages, cadenceTimeframe, onClose, onSave }: EditRuleModalProps) {
  const [formData, setFormData] = useState({
    name: rule.rule_name || '',
    type: rule.rule_type || 'time',
    conditionType: rule.condition_type || 'time_interval',
    conditionValue: rule.condition_value || {},
    actionType: rule.action_type || 'branch_copy',
    actionValue: rule.action_value || {},
    isActive: rule.is_active ?? true
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (formData.name.trim()) {
      onSave(formData)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100] p-4 pt-32 pb-8">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[calc(100vh-10rem)] overflow-hidden flex flex-col">
        {/* Fixed Header */}
        <div className="p-6 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Edit Automation Rule</h2>
              <p className="text-sm text-gray-500 mt-1">Update when and how this workflow should be automated</p>
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

        <form id="edit-rule-form" onSubmit={handleSubmit} className="space-y-6">
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
              placeholder="e.g., Weekly Review Reset"
              required
            />
          </div>

          {/* Rule Type Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Trigger Type
            </label>
            <div className="grid grid-cols-2 gap-3">
              {[
                { value: 'time', label: 'Time', icon: Clock, desc: 'Trigger based on time intervals' },
                { value: 'event', label: 'Event', icon: Zap, desc: 'Trigger on market events' },
                { value: 'activity', label: 'Activity', icon: Activity, desc: 'Trigger on user actions' },
                { value: 'perpetual', label: 'Perpetual', icon: Target, desc: 'Always available' }
              ].map((option) => {
                const Icon = option.icon
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      const conditionMap = {
                        'time': 'time_interval',
                        'event': 'earnings_date',
                        'activity': 'stage_completion',
                        'perpetual': 'always_available'
                      }
                      setFormData({
                        ...formData,
                        type: option.value,
                        conditionType: conditionMap[option.value as keyof typeof conditionMap],
                        conditionValue: {}
                      })
                    }}
                    className={`p-4 border-2 rounded-lg transition-all text-left ${
                      formData.type === option.value
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start space-x-3">
                      <Icon className={`w-5 h-5 mt-0.5 ${formData.type === option.value ? 'text-blue-600' : 'text-gray-400'}`} />
                      <div>
                        <div className={`font-medium ${formData.type === option.value ? 'text-blue-900' : 'text-gray-900'}`}>
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
          <div className="bg-gray-50 rounded-lg p-4 space-y-4">
            <h4 className="text-sm font-medium text-gray-900">Trigger Configuration</h4>

            {formData.type === 'time' && (
              <div className="space-y-4">
                {/* Recurrence Pattern */}
                <div className="bg-white border-2 border-gray-200 rounded-lg p-4">
                  <h5 className="text-sm font-semibold text-gray-900 mb-3">Recurrence Pattern</h5>

                  {/* Pattern Type Selection - Two Column Layout */}
                  <div className="flex space-x-8">
                    {/* Left Column - Radio Buttons */}
                    <div className="flex flex-col space-y-3 min-w-[100px]">
                      {/* Daily */}
                      <div className="flex items-center space-x-2">
                        <input
                          type="radio"
                          id="pattern-daily"
                          checked={formData.conditionValue.pattern_type === 'daily'}
                          onChange={() => setFormData({
                            ...formData,
                            conditionValue: {
                              pattern_type: 'daily',
                              daily_type: 'every_x_days',
                              interval: 1
                            }
                          })}
                        />
                        <label htmlFor="pattern-daily" className="font-medium text-gray-900 cursor-pointer">Daily</label>
                      </div>

                      {/* Weekly */}
                      <div className="flex items-center space-x-2">
                        <input
                          type="radio"
                          id="pattern-weekly"
                          checked={formData.conditionValue.pattern_type === 'weekly'}
                          onChange={() => setFormData({
                            ...formData,
                            conditionValue: {
                              pattern_type: 'weekly',
                              interval: 1,
                              days_of_week: ['monday']
                            }
                          })}
                        />
                        <label htmlFor="pattern-weekly" className="font-medium text-gray-900 cursor-pointer">Weekly</label>
                      </div>

                      {/* Monthly */}
                      <div className="flex items-center space-x-2">
                        <input
                          type="radio"
                          id="pattern-monthly"
                          checked={formData.conditionValue.pattern_type === 'monthly'}
                          onChange={() => setFormData({
                            ...formData,
                            conditionValue: {
                              pattern_type: 'monthly',
                              monthly_type: 'day_of_month',
                              day_number: 1,
                              interval: 1
                            }
                          })}
                        />
                        <label htmlFor="pattern-monthly" className="font-medium text-gray-900 cursor-pointer">Monthly</label>
                      </div>

                      {/* Quarterly */}
                      <div className="flex items-center space-x-2">
                        <input
                          type="radio"
                          id="pattern-quarterly"
                          checked={formData.conditionValue.pattern_type === 'quarterly'}
                          onChange={() => setFormData({
                            ...formData,
                            conditionValue: {
                              pattern_type: 'quarterly',
                              quarterly_type: 'day_of_quarter',
                              day_number: 1,
                              interval: 1
                            }
                          })}
                        />
                        <label htmlFor="pattern-quarterly" className="font-medium text-gray-900 cursor-pointer">Quarterly</label>
                      </div>

                      {/* Yearly */}
                      <div className="flex items-center space-x-2">
                        <input
                          type="radio"
                          id="pattern-yearly"
                          checked={formData.conditionValue.pattern_type === 'yearly'}
                          onChange={() => setFormData({
                            ...formData,
                            conditionValue: {
                              pattern_type: 'yearly',
                              yearly_type: 'specific_date',
                              month: 'january',
                              day_number: 1
                            }
                          })}
                        />
                        <label htmlFor="pattern-yearly" className="font-medium text-gray-900 cursor-pointer">Yearly</label>
                      </div>
                    </div>

                    {/* Right Column - Configuration Options */}
                    <div className="flex-1 border-l border-gray-200 pl-6">
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
                              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                              disabled={formData.conditionValue.daily_type !== 'every_x_days'}
                            />
                            <label className="text-sm text-gray-700">day(s)</label>
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
                            <span className="text-sm text-gray-700">Recur every</span>
                            <input
                              type="number"
                              min="1"
                              value={formData.conditionValue.interval || 1}
                              onChange={(e) => setFormData({
                                ...formData,
                                conditionValue: { ...formData.conditionValue, interval: parseInt(e.target.value) || 1 }
                              })}
                              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                            />
                            <span className="text-sm text-gray-700">week(s) on:</span>
                          </div>
                          <div className="grid grid-cols-4 gap-2">
                            {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day) => (
                              <label key={day} className="flex items-center space-x-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={(formData.conditionValue.days_of_week || []).includes(day.toLowerCase())}
                                  onChange={(e) => {
                                    const days = formData.conditionValue.days_of_week || []
                                    const newDays = e.target.checked
                                      ? [...days, day.toLowerCase()]
                                      : days.filter(d => d !== day.toLowerCase())
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
                              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
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
                              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
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
                              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
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
                              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
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
                              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
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
                              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
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
                              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
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
                    </div>
                  </div>
                </div>

                {/* Range of Recurrence */}
                <div className="bg-white border-2 border-gray-200 rounded-lg p-4">
                  <h5 className="text-sm font-semibold text-gray-900 mb-3">Range of Recurrence</h5>

                  <div className="space-y-3">
                    {/* Start Date */}
                    <div className="flex items-center space-x-2">
                      <label className="text-sm font-medium text-gray-700 w-20">Start:</label>
                      <input
                        type="date"
                        value={formData.conditionValue.start_date || ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          conditionValue: { ...formData.conditionValue, start_date: e.target.value }
                        })}
                        className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    {/* End Options */}
                    <div className="space-y-2">
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
                          className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
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
                          className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          disabled={formData.conditionValue.end_type !== 'end_by_date'}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {formData.type === 'event' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Event Type</label>
                  <select
                    value={formData.conditionType}
                    onChange={(e) => setFormData({ ...formData, conditionType: e.target.value, conditionValue: {} })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
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
                      className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="3"
                    />
                    <span className="text-sm text-gray-600">days</span>
                    <select
                      value={formData.conditionValue.timing || 'before'}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, timing: e.target.value }
                      })}
                      className="px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
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
                      className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="5"
                    />
                    <span className="text-sm text-gray-600">%</span>
                    <select
                      value={formData.conditionValue.direction || 'either'}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, direction: e.target.value }
                      })}
                      className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                      className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="2"
                    />
                    <span className="text-sm text-gray-600">× average volume</span>
                  </div>
                )}

                {formData.conditionType === 'dividend_date' && (
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      min="0"
                      value={formData.conditionValue.days_offset || ''}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, days_offset: parseInt(e.target.value) }
                      })}
                      className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="3"
                    />
                    <span className="text-sm text-gray-600">days</span>
                    <select
                      value={formData.conditionValue.timing || 'before'}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, timing: e.target.value }
                      })}
                      className="px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
                    >
                      <option value="before">before</option>
                      <option value="after">after</option>
                    </select>
                    <span className="text-sm text-gray-600">dividend date</span>
                  </div>
                )}

                {formData.conditionType === 'conference' && (
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      min="0"
                      value={formData.conditionValue.days_offset || ''}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, days_offset: parseInt(e.target.value) }
                      })}
                      className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="3"
                    />
                    <span className="text-sm text-gray-600">days</span>
                    <select
                      value={formData.conditionValue.timing || 'before'}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, timing: e.target.value }
                      })}
                      className="px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
                    >
                      <option value="before">before</option>
                      <option value="after">after</option>
                    </select>
                    <span className="text-sm text-gray-600">conference</span>
                  </div>
                )}

                {formData.conditionType === 'investor_relations_call' && (
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      min="0"
                      value={formData.conditionValue.days_offset || ''}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, days_offset: parseInt(e.target.value) }
                      })}
                      className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="3"
                    />
                    <span className="text-sm text-gray-600">days</span>
                    <select
                      value={formData.conditionValue.timing || 'before'}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, timing: e.target.value }
                      })}
                      className="px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
                    >
                      <option value="before">before</option>
                      <option value="after">after</option>
                    </select>
                    <span className="text-sm text-gray-600">investor relations call</span>
                  </div>
                )}

                {formData.conditionType === 'analyst_call' && (
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      min="0"
                      value={formData.conditionValue.days_offset || ''}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, days_offset: parseInt(e.target.value) }
                      })}
                      className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="3"
                    />
                    <span className="text-sm text-gray-600">days</span>
                    <select
                      value={formData.conditionValue.timing || 'before'}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, timing: e.target.value }
                      })}
                      className="px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
                    >
                      <option value="before">before</option>
                      <option value="after">after</option>
                    </select>
                    <span className="text-sm text-gray-600">sell-side analyst call</span>
                  </div>
                )}

                {formData.conditionType === 'roadshow' && (
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      min="0"
                      value={formData.conditionValue.days_offset || ''}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, days_offset: parseInt(e.target.value) }
                      })}
                      className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="3"
                    />
                    <span className="text-sm text-gray-600">days</span>
                    <select
                      value={formData.conditionValue.timing || 'before'}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, timing: e.target.value }
                      })}
                      className="px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
                    >
                      <option value="before">before</option>
                      <option value="after">after</option>
                    </select>
                    <span className="text-sm text-gray-600">roadshow</span>
                  </div>
                )}
              </div>
            )}

            {formData.type === 'activity' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Activity Type</label>
                  <select
                    value={formData.conditionType}
                    onChange={(e) => setFormData({ ...formData, conditionType: e.target.value, conditionValue: {} })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
                  >
                    <option value="stage_completion">Stage Completion</option>
                    <option value="note_added">Note Added</option>
                    <option value="list_assignment">Added to List</option>
                    <option value="workflow_start">Workflow Started</option>
                  </select>
                </div>

                {formData.conditionType === 'stage_completion' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Stage</label>
                    <select
                      value={formData.conditionValue.stage_key || ''}
                      onChange={(e) => setFormData({
                        ...formData,
                        conditionValue: { ...formData.conditionValue, stage_key: e.target.value }
                      })}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
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

            {formData.type === 'perpetual' && (
              <div>
                <p className="text-sm text-gray-600">This workflow will always be available to work on and will not trigger automatically.</p>
              </div>
            )}
          </div>

          {/* Action Configuration - Only shown for non-perpetual rules */}
          {formData.type !== 'perpetual' && (
          <div className="bg-gray-50 rounded-lg p-4 space-y-4">
            <h4 className="text-sm font-medium text-gray-900">Action Configuration</h4>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">When this rule triggers, what should happen?</label>
              <select
                value={formData.actionType}
                onChange={(e) => setFormData({ ...formData, actionType: e.target.value, actionValue: {} })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
              >
                <optgroup label="Workflow Progress">
                  <option value="move_stage">Move to a specific stage</option>
                  <option value="advance_stage">Advance to next stage</option>
                  <option value="reset_workflow">Reset workflow to beginning</option>
                </optgroup>
                <optgroup label="Create New Branch">
                  <option value="branch_copy">Create a copy (keep current progress)</option>
                  <option value="branch_nocopy">Create a new branch (fresh start)</option>
                </optgroup>
                <optgroup label="Notification">
                  <option value="send_reminder">Send a reminder notification</option>
                </optgroup>
              </select>
            </div>

            {(formData.actionType === 'branch_copy' || formData.actionType === 'branch_nocopy') && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    How should the new workflow be named?
                  </label>
                  <p className="text-xs text-gray-500 mb-3">
                    Add text that will be appended to "{workflowName}". Use dynamic codes that automatically update with the current date.
                  </p>
                </div>

                {/* Quick Insert Templates */}
                <div className="space-y-2">
                  <span className="text-xs font-medium text-gray-700">Common templates:</span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFormData({
                        ...formData,
                        actionValue: { ...formData.actionValue, branch_suffix: '{MONTH} {YEAR}' }
                      })}
                      className="px-3 py-2 text-xs bg-white border border-gray-300 hover:border-blue-400 hover:bg-blue-50 rounded-lg transition-colors text-left"
                    >
                      <div className="font-medium text-gray-900">{new Date().toLocaleString('en-US', { month: 'short' })} {getCurrentYear()}</div>
                      <div className="text-gray-500 mt-0.5">Monthly</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({
                        ...formData,
                        actionValue: { ...formData.actionValue, branch_suffix: '{QUARTER} {YEAR}' }
                      })}
                      className="px-3 py-2 text-xs bg-white border border-gray-300 hover:border-blue-400 hover:bg-blue-50 rounded-lg transition-colors text-left"
                    >
                      <div className="font-medium text-gray-900">Q{getCurrentQuarter()} {getCurrentYear()}</div>
                      <div className="text-gray-500 mt-0.5">Quarterly</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({
                        ...formData,
                        actionValue: { ...formData.actionValue, branch_suffix: '{YEAR}' }
                      })}
                      className="px-3 py-2 text-xs bg-white border border-gray-300 hover:border-blue-400 hover:bg-blue-50 rounded-lg transition-colors text-left"
                    >
                      <div className="font-medium text-gray-900">{getCurrentYear()}</div>
                      <div className="text-gray-500 mt-0.5">Annual</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({
                        ...formData,
                        actionValue: { ...formData.actionValue, branch_suffix: '{DATE}' }
                      })}
                      className="px-3 py-2 text-xs bg-white border border-gray-300 hover:border-blue-400 hover:bg-blue-50 rounded-lg transition-colors text-left"
                    >
                      <div className="font-medium text-gray-900">{processDynamicSuffix('{DATE}')}</div>
                      <div className="text-gray-500 mt-0.5">Date</div>
                    </button>
                  </div>
                </div>

                {/* Input Field */}
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-gray-600">Custom suffix:</label>
                  <input
                    type="text"
                    value={formData.actionValue.branch_suffix || ''}
                    onChange={(e) => setFormData({
                      ...formData,
                      actionValue: { ...formData.actionValue, branch_suffix: e.target.value }
                    })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
                    placeholder="Type or use a template above"
                  />
                </div>

                {/* Preview Box */}
                {formData.actionValue.branch_suffix && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <div className="flex items-start space-x-2">
                      <div className="flex-shrink-0 mt-0.5">
                        <Eye className="w-4 h-4 text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-blue-900 mb-1">Preview of new workflow name:</p>
                        <p className="text-sm font-semibold text-blue-900 truncate">
                          {workflowName} - {processDynamicSuffix(formData.actionValue.branch_suffix)}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Available Codes */}
                <details className="text-xs">
                  <summary className="cursor-pointer text-gray-600 hover:text-gray-900 font-medium">
                    Available dynamic codes
                  </summary>
                  <div className="mt-2 ml-4 space-y-1 text-gray-600">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      <span><code className="bg-gray-100 px-1.5 py-0.5 rounded text-blue-600">{'{QUARTER}'}</code> = Q{getCurrentQuarter()}</span>
                      <span><code className="bg-gray-100 px-1.5 py-0.5 rounded text-blue-600">{'{Q}'}</code> = {getCurrentQuarter()}</span>
                      <span><code className="bg-gray-100 px-1.5 py-0.5 rounded text-blue-600">{'{YEAR}'}</code> = {getCurrentYear()}</span>
                      <span><code className="bg-gray-100 px-1.5 py-0.5 rounded text-blue-600">{'{YY}'}</code> = {getCurrentYear().toString().slice(-2)}</span>
                      <span><code className="bg-gray-100 px-1.5 py-0.5 rounded text-blue-600">{'{MONTH}'}</code> = {new Date().toLocaleString('en-US', { month: 'short' })}</span>
                      <span><code className="bg-gray-100 px-1.5 py-0.5 rounded text-blue-600">{'{DAY}'}</code> = {new Date().getDate()}</span>
                      <span><code className="bg-gray-100 px-1.5 py-0.5 rounded text-blue-600">{'{DATE}'}</code> = {processDynamicSuffix('{DATE}')}</span>
                    </div>
                  </div>
                </details>
              </div>
            )}

            {(formData.actionType === 'move_stage' || formData.actionType === 'reset_workflow') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {formData.actionType === 'move_stage' ? 'Which stage to move to?' : 'Which stage to restart from?'}
                </label>
                <select
                  value={formData.actionValue.target_stage || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    actionValue: { ...formData.actionValue, target_stage: e.target.value }
                  })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm shadow-sm"
                >
                  <option value="">First stage</option>
                  {workflowStages.map((stage) => (
                    <option key={stage.stage_key} value={stage.stage_key}>
                      {stage.stage_label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  {formData.actionType === 'move_stage'
                    ? 'The workflow will move to this stage when the rule triggers'
                    : 'The workflow will restart from this stage (all progress will be reset)'}
                </p>
              </div>
            )}

            {formData.actionType === 'notify_only' && (
              <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                <p className="text-sm text-blue-800">This will send a notification without making any changes to the workflow progress.</p>
              </div>
            )}

            {formData.actionType === 'mark_complete' && (
              <div className="bg-green-50 border border-green-200 rounded-md p-3">
                <p className="text-sm text-green-800">This will mark the workflow as complete and move it out of active workflows.</p>
              </div>
            )}
          </div>
          )}

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
          <Button type="submit" form="edit-rule-form">
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  )
}
