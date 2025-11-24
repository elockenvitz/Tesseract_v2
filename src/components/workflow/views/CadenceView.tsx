/**
 * CadenceView Component
 *
 * Complete Cadence tab view for workflows.
 * Manages workflow cadence timeframe and automation rules.
 *
 * Extracted from WorkflowsPage.tsx during Phase 3 refactoring.
 */

import React from 'react'
import { Calendar, Plus, Clock, Zap, Edit3, Trash2, Power, PowerOff, AlertCircle } from 'lucide-react'
import { Card } from '../../ui/Card'
import { Button } from '../../ui/Button'

export type CadenceTimeframe = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'semi-annually' | 'annually' | 'persistent'

export interface AutomationRule {
  id: string
  rule_name: string
  rule_description?: string
  trigger_type: 'time_based' | 'event_based' | 'activity_based'
  trigger_config: any
  action_type: 'reset' | 'create_branch' | 'move_stage' | 'send_notification'
  action_config: any
  is_active: boolean
  created_at: string
}

export interface CadenceViewProps {
  /** Current cadence timeframe */
  cadenceTimeframe?: CadenceTimeframe

  /** Cadence days configuration (for specific timeframes) */
  cadenceDays?: number[]

  /** List of automation rules */
  automationRules?: AutomationRule[]

  /** Whether user has admin permission */
  canEdit?: boolean

  /** Whether in template edit mode */
  isEditMode?: boolean

  /** Whether automation rules are loading */
  isLoadingRules?: boolean

  /** Callback when cadence timeframe changes */
  onChangeCadence?: (timeframe: CadenceTimeframe) => void

  /** Callbacks for rule operations */
  onAddRule?: () => void
  onEditRule?: (rule: AutomationRule) => void
  onDeleteRule?: (ruleId: string, ruleName: string) => void
  onToggleRuleActive?: (ruleId: string, isActive: boolean) => void
}

export function CadenceView({
  cadenceTimeframe = 'persistent',
  cadenceDays,
  automationRules = [],
  canEdit = false,
  isEditMode = false,
  isLoadingRules = false,
  onChangeCadence,
  onAddRule,
  onEditRule,
  onDeleteRule,
  onToggleRuleActive
}: CadenceViewProps) {
  const hasRules = automationRules.length > 0

  // Get human-readable cadence label
  const getCadenceLabel = (timeframe: CadenceTimeframe): string => {
    const labels: Record<CadenceTimeframe, string> = {
      daily: 'Daily',
      weekly: 'Weekly',
      monthly: 'Monthly',
      quarterly: 'Quarterly',
      'semi-annually': 'Semi-Annually',
      annually: 'Annually',
      persistent: 'Persistent (No Cadence)'
    }
    return labels[timeframe] || timeframe
  }

  // Get trigger type label
  const getTriggerLabel = (triggerType: string): string => {
    switch (triggerType) {
      case 'time_based':
        return 'Time-based'
      case 'event_based':
        return 'Event-based'
      case 'activity_based':
        return 'Activity-based'
      default:
        return triggerType
    }
  }

  // Get action type label
  const getActionLabel = (actionType: string): string => {
    switch (actionType) {
      case 'reset':
        return 'Reset workflow'
      case 'create_branch':
        return 'Create branch'
      case 'move_stage':
        return 'Move to stage'
      case 'send_notification':
        return 'Send notification'
      default:
        return actionType
    }
  }

  // Get trigger icon
  const getTriggerIcon = (triggerType: string) => {
    switch (triggerType) {
      case 'time_based':
        return <Clock className="w-4 h-4" />
      case 'event_based':
        return <Zap className="w-4 h-4" />
      case 'activity_based':
        return <Calendar className="w-4 h-4" />
      default:
        return <Clock className="w-4 h-4" />
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <h3 className="text-lg font-semibold text-gray-900">Cadence & Automation</h3>
          {canEdit && !isEditMode && (
            <div className="flex items-center space-x-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-3 py-1">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>Click <strong>"Edit Template"</strong> in the header to make changes to cadence and automation rules</span>
            </div>
          )}
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-sm text-gray-600">Cadence:</span>
          {canEdit && isEditMode && onChangeCadence ? (
            <select
              value={cadenceTimeframe}
              onChange={(e) => onChangeCadence(e.target.value as CadenceTimeframe)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="semi-annually">Semi-Annually</option>
              <option value="annually">Annually</option>
              <option value="persistent">Persistent (No Cadence)</option>
            </select>
          ) : (
            <span className="px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900">
              {getCadenceLabel(cadenceTimeframe)}
            </span>
          )}
        </div>
      </div>

      {/* Automation Rules */}
      <Card>
        <div className="p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <Zap className="w-5 h-5 text-orange-600" />
              <h4 className="text-sm font-semibold text-gray-900">
                Automation Rules ({automationRules.length})
              </h4>
            </div>
            {canEdit && isEditMode && onAddRule && (
              <Button size="sm" onClick={onAddRule}>
                <Plus className="w-4 h-4 mr-1" />
                Add Rule
              </Button>
            )}
          </div>

          {/* Loading State */}
          {isLoadingRules && (
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <p className="text-sm text-gray-500 mt-2">Loading automation rules...</p>
            </div>
          )}

          {/* Rules List */}
          {!isLoadingRules && hasRules && (
            <div className="space-y-3">
              {automationRules.map((rule) => (
                <div
                  key={rule.id}
                  className={`border rounded-lg p-4 ${
                    rule.is_active ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-200 opacity-60'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-1">
                        <h5 className="text-sm font-medium text-gray-900">{rule.rule_name}</h5>
                        {rule.is_active ? (
                          <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 border border-green-300 flex items-center">
                            <Power className="w-3 h-3 mr-1" />
                            Active
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700 border border-gray-300 flex items-center">
                            <PowerOff className="w-3 h-3 mr-1" />
                            Inactive
                          </span>
                        )}
                      </div>
                      {rule.rule_description && (
                        <p className="text-xs text-gray-500 mb-2">{rule.rule_description}</p>
                      )}
                    </div>

                    {canEdit && (
                      <div className="flex items-center space-x-1 ml-2">
                        {onEditRule && (
                          <Button
                            size="xs"
                            variant="outline"
                            title="Edit Rule"
                            onClick={() => onEditRule(rule)}
                          >
                            <Edit3 className="w-3 h-3" />
                          </Button>
                        )}
                        {onDeleteRule && (
                          <Button
                            size="xs"
                            variant="outline"
                            title="Delete Rule"
                            onClick={() => onDeleteRule(rule.id, rule.rule_name)}
                          >
                            <Trash2 className="w-3 h-3 text-red-600" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Rule Details */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {/* Trigger */}
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                      <div className="flex items-center space-x-2 mb-1">
                        {getTriggerIcon(rule.trigger_type)}
                        <span className="text-xs font-medium text-blue-900">When</span>
                      </div>
                      <p className="text-xs text-blue-700">
                        {getTriggerLabel(rule.trigger_type)}
                      </p>
                    </div>

                    {/* Action */}
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                      <div className="flex items-center space-x-2 mb-1">
                        <Zap className="w-4 h-4 text-green-700" />
                        <span className="text-xs font-medium text-green-900">Then</span>
                      </div>
                      <p className="text-xs text-green-700">
                        {getActionLabel(rule.action_type)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Empty State */}
          {!isLoadingRules && !hasRules && (
            <div className="text-center py-8 bg-gray-50 rounded-lg border border-dashed border-gray-300">
              <div className="max-w-md mx-auto">
                <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Zap className="w-6 h-6 text-gray-400" />
                </div>
                <h5 className="text-sm font-medium text-gray-900 mb-2">No automation rules yet</h5>
                <p className="text-xs text-gray-500 mb-4">
                  Create automation rules to trigger actions based on time, events, or activity.
                  For example, automatically reset workflow branches or send notifications.
                </p>
                {canEdit && isEditMode && onAddRule && (
                  <Button size="sm" onClick={onAddRule}>
                    <Plus className="w-4 h-4 mr-1" />
                    Add First Rule
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
