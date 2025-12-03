/**
 * CadenceView Component
 *
 * Complete Cadence tab view for workflows.
 * Manages workflow cadence timeframe and automation rules.
 * Displays two categories of rules:
 * - Branch Creation Rules: When to create new workflow branches
 * - Asset Population Rules: When to add assets to branches
 *
 * Extracted from WorkflowsPage.tsx during Phase 3 refactoring.
 */

import React from 'react'
import { Calendar, Plus, Clock, Zap, Edit3, Trash2, Power, PowerOff, AlertCircle, GitBranch, Users } from 'lucide-react'
import { Card } from '../../ui/Card'
import { Button } from '../../ui/Button'

export type CadenceTimeframe = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'semi-annually' | 'annually' | 'persistent'

export type RuleCategory = 'branch_creation' | 'asset_population'

export interface AutomationRule {
  id: string
  rule_name: string
  rule_type: 'time_based' | 'activity_based' | 'time' | 'event' | 'activity' | 'perpetual'
  rule_category?: RuleCategory
  condition_type: string
  condition_value: any
  action_type: string
  action_value: any
  is_active: boolean
  created_at?: string
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

  /** Callbacks for branch creation rule operations */
  onAddRule?: () => void
  onEditRule?: (rule: AutomationRule) => void
  onDeleteRule?: (ruleId: string, ruleName: string) => void
  onToggleRuleActive?: (ruleId: string, isActive: boolean) => void

  /** Callbacks for asset population rule operations */
  onAddAssetPopulationRule?: () => void
  onEditAssetPopulationRule?: (rule: AutomationRule) => void
  onDeleteAssetPopulationRule?: (ruleId: string, ruleName: string) => void
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
  onToggleRuleActive,
  onAddAssetPopulationRule,
  onEditAssetPopulationRule,
  onDeleteAssetPopulationRule
}: CadenceViewProps) {
  // Separate rules by category
  const branchCreationRules = automationRules.filter(
    rule => !rule.rule_category || rule.rule_category === 'branch_creation'
  )
  const assetPopulationRules = automationRules.filter(
    rule => rule.rule_category === 'asset_population'
  )

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

  // Get human-readable condition description from condition_value object
  const getConditionDescription = (rule: AutomationRule): string => {
    const { condition_type, condition_value } = rule
    const cv = condition_value || {}

    // Handle time-based recurrence patterns
    if (condition_type === 'time_interval' && cv.pattern_type) {
      const capitalize = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1) : ''

      switch (cv.pattern_type) {
        case 'daily':
          if (cv.daily_type === 'every_weekday') {
            return 'Every weekday'
          }
          return cv.interval === 1 ? 'Every day' : `Every ${cv.interval} days`

        case 'weekly':
          const days = cv.days_of_week || []
          const dayNames = days.map((d: string) => capitalize(d.slice(0, 3))).join(', ')
          if (cv.interval === 1) {
            return `Weekly on ${dayNames || 'selected days'}`
          }
          return `Every ${cv.interval} weeks on ${dayNames || 'selected days'}`

        case 'monthly':
          if (cv.monthly_type === 'day_of_month') {
            const dayNum = cv.day_number || 1
            const suffix = dayNum === 1 ? 'st' : dayNum === 2 ? 'nd' : dayNum === 3 ? 'rd' : 'th'
            return cv.interval === 1
              ? `Monthly on the ${dayNum}${suffix}`
              : `Every ${cv.interval} months on the ${dayNum}${suffix}`
          } else if (cv.monthly_type === 'position_of_month') {
            return `The ${cv.position || 'first'} ${capitalize(cv.day_name || 'day')} of every ${cv.interval === 1 ? 'month' : `${cv.interval} months`}`
          }
          return 'Monthly'

        case 'quarterly':
          if (cv.quarterly_type === 'day_of_quarter') {
            return cv.interval === 1
              ? `Day ${cv.day_number || 1} of each quarter`
              : `Day ${cv.day_number || 1} every ${cv.interval} quarters`
          } else if (cv.quarterly_type === 'position_of_quarter') {
            return `The ${cv.position || 'first'} ${capitalize(cv.day_name || 'day')} of each quarter`
          }
          return 'Quarterly'

        case 'yearly':
          if (cv.yearly_type === 'specific_date') {
            return `Annually on ${capitalize(cv.month || 'January')} ${cv.day_number || 1}`
          } else if (cv.yearly_type === 'position_of_year') {
            return `The ${cv.position || 'first'} ${capitalize(cv.day_name || 'day')} of ${capitalize(cv.month || 'January')} each year`
          }
          return 'Yearly'

        default:
          return capitalize(cv.pattern_type)
      }
    }

    // Handle activity-based triggers
    if (condition_type === 'stage_completion') {
      return cv.stage_key ? `When stage "${cv.stage_key}" is completed` : 'When any stage is completed'
    }
    if (condition_type === 'note_added') {
      return 'When a note is added'
    }
    if (condition_type === 'list_assignment') {
      return 'When added to a list'
    }
    if (condition_type === 'workflow_start') {
      return 'When workflow starts'
    }

    // Handle event-based triggers
    if (condition_type === 'earnings_date') {
      const timing = cv.timing === 'after' ? 'after' : 'before'
      return `${cv.days_offset || 0} days ${timing} earnings`
    }

    // Handle asset population specific triggers
    if (condition_type === 'on_branch_creation') {
      return 'When a new branch is created'
    }
    if (condition_type === 'days_before_earnings') {
      return `${cv.days_offset || 0} days before earnings`
    }
    if (condition_type === 'days_after_earnings') {
      return `${cv.days_offset || 0} days after earnings`
    }
    if (condition_type === 'volume_spike') {
      return cv.threshold ? `When volume exceeds ${cv.threshold}x average` : 'When volume spikes'
    }
    if (condition_type === 'manual_trigger') {
      return 'Manual trigger only'
    }

    return condition_type?.replace(/_/g, ' ') || 'Trigger configured'
  }

  // Get human-readable action description from action_value object
  const getActionDescription = (rule: AutomationRule): string => {
    const { action_type, action_value } = rule
    const av = action_value || {}

    switch (action_type) {
      case 'branch_copy':
        if (av.branch_suffix) {
          return `Create branch with suffix "${av.branch_suffix}" (copy progress)`
        }
        return 'Create new branch (copy current progress)'

      case 'branch_nocopy':
        if (av.branch_suffix) {
          return `Create branch with suffix "${av.branch_suffix}" (fresh start)`
        }
        return 'Create new branch (fresh start)'

      case 'move_stage':
        return av.target_stage ? `Move to stage "${av.target_stage}"` : 'Move to specified stage'

      case 'advance_stage':
        return 'Advance to next stage'

      case 'reset_workflow':
        return av.target_stage ? `Reset to stage "${av.target_stage}"` : 'Reset workflow to beginning'

      case 'send_reminder':
        return 'Send reminder notification'

      case 'add_universe_assets':
        return 'Add all assets matching universe filters'

      case 'add_specific_assets':
        if (av.asset_count) {
          return `Add ${av.asset_count} specific assets`
        }
        return 'Add specific assets'

      case 'remove_assets':
        return 'Remove assets from branch'

      default:
        return action_type?.replace(/_/g, ' ') || 'Action configured'
    }
  }

  // Get trigger icon based on rule type
  const getTriggerIcon = (ruleType: string) => {
    switch (ruleType) {
      case 'time_based':
      case 'time':
        return <Clock className="w-4 h-4 text-blue-600" />
      case 'activity_based':
      case 'activity':
        return <Zap className="w-4 h-4 text-blue-600" />
      case 'event':
        return <Calendar className="w-4 h-4 text-blue-600" />
      default:
        return <Clock className="w-4 h-4 text-blue-600" />
    }
  }

  // Render a single rule card
  const renderRuleCard = (
    rule: AutomationRule,
    onEdit?: (rule: AutomationRule) => void,
    onDelete?: (ruleId: string, ruleName: string) => void
  ) => (
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
            {/* Toggle button - available outside of edit mode */}
            {canEdit && onToggleRuleActive ? (
              <button
                onClick={() => onToggleRuleActive(rule.id, !rule.is_active)}
                className={`px-2 py-0.5 rounded-full text-xs border flex items-center cursor-pointer transition-colors ${
                  rule.is_active
                    ? 'bg-green-100 text-green-700 border-green-300 hover:bg-green-200'
                    : 'bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200'
                }`}
                title={rule.is_active ? 'Click to deactivate' : 'Click to activate'}
              >
                {rule.is_active ? (
                  <>
                    <Power className="w-3 h-3 mr-1" />
                    Active
                  </>
                ) : (
                  <>
                    <PowerOff className="w-3 h-3 mr-1" />
                    Inactive
                  </>
                )}
              </button>
            ) : (
              // Read-only badge for non-admins
              <span className={`px-2 py-0.5 rounded-full text-xs border flex items-center ${
                rule.is_active
                  ? 'bg-green-100 text-green-700 border-green-300'
                  : 'bg-gray-100 text-gray-700 border-gray-300'
              }`}>
                {rule.is_active ? (
                  <>
                    <Power className="w-3 h-3 mr-1" />
                    Active
                  </>
                ) : (
                  <>
                    <PowerOff className="w-3 h-3 mr-1" />
                    Inactive
                  </>
                )}
              </span>
            )}
          </div>
        </div>

        {canEdit && isEditMode && (
          <div className="flex items-center space-x-1 ml-2">
            {onEdit && (
              <Button
                size="xs"
                variant="outline"
                title="Edit Rule"
                onClick={() => onEdit(rule)}
              >
                <Edit3 className="w-3 h-3" />
              </Button>
            )}
            {onDelete && (
              <Button
                size="xs"
                variant="outline"
                title="Delete Rule"
                onClick={() => onDelete(rule.id, rule.rule_name)}
              >
                <Trash2 className="w-3 h-3 text-red-600" />
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Rule Details */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Trigger/Condition */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="flex items-center space-x-2 mb-1">
            {getTriggerIcon(rule.rule_type)}
            <span className="text-xs font-medium text-blue-900">When</span>
            <span className="text-xs text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded">
              {rule.rule_type === 'time_based' || rule.rule_type === 'time' ? 'Time' :
               rule.rule_type === 'event' ? 'Event' : 'Activity'}
            </span>
          </div>
          <p className="text-sm text-blue-800 font-medium">
            {getConditionDescription(rule)}
          </p>
        </div>

        {/* Action */}
        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
          <div className="flex items-center space-x-2 mb-1">
            <Zap className="w-4 h-4 text-green-600" />
            <span className="text-xs font-medium text-green-900">Then</span>
          </div>
          <p className="text-sm text-green-800 font-medium">
            {getActionDescription(rule)}
          </p>
        </div>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <h3 className="text-lg font-semibold text-gray-900">Cadence & Automation</h3>
          {canEdit && !isEditMode && (
            <div className="flex items-center space-x-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-3 py-1">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>Click <strong>"Edit Template"</strong> to add, edit, or delete rules. You can toggle rules active/inactive anytime.</span>
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

      {/* Branch Creation Rules Section */}
      <Card>
        <div className="p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <GitBranch className="w-5 h-5 text-purple-600" />
              <h4 className="text-sm font-semibold text-gray-900">
                Branch Creation Rules ({branchCreationRules.length})
              </h4>
              <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                When to create new workflow branches
              </span>
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

          {/* Branch Creation Rules List */}
          {!isLoadingRules && branchCreationRules.length > 0 && (
            <div className="space-y-3">
              {branchCreationRules.map((rule) => renderRuleCard(rule, onEditRule, onDeleteRule))}
            </div>
          )}

          {/* Empty State for Branch Creation */}
          {!isLoadingRules && branchCreationRules.length === 0 && (
            <div className="text-center py-6 bg-gray-50 rounded-lg border border-dashed border-gray-300">
              <div className="max-w-md mx-auto">
                <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <GitBranch className="w-5 h-5 text-purple-500" />
                </div>
                <h5 className="text-sm font-medium text-gray-900 mb-1">No branch creation rules</h5>
                <p className="text-xs text-gray-500 mb-3">
                  Create rules to automatically generate new workflow branches on a schedule (e.g., quarterly, monthly).
                </p>
                {canEdit && isEditMode && onAddRule && (
                  <Button size="sm" onClick={onAddRule}>
                    <Plus className="w-4 h-4 mr-1" />
                    Add Branch Rule
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Asset Population Rules Section */}
      <Card>
        <div className="p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <Users className="w-5 h-5 text-orange-600" />
              <h4 className="text-sm font-semibold text-gray-900">
                Asset Population Rules ({assetPopulationRules.length})
              </h4>
              <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                When to add assets to branches
              </span>
            </div>
            {canEdit && isEditMode && onAddAssetPopulationRule && (
              <Button size="sm" onClick={onAddAssetPopulationRule}>
                <Plus className="w-4 h-4 mr-1" />
                Add Rule
              </Button>
            )}
          </div>

          {/* Asset Population Rules List */}
          {!isLoadingRules && assetPopulationRules.length > 0 && (
            <div className="space-y-3">
              {assetPopulationRules.map((rule) => renderRuleCard(
                rule,
                onEditAssetPopulationRule,
                onDeleteAssetPopulationRule
              ))}
            </div>
          )}

          {/* Empty State for Asset Population */}
          {!isLoadingRules && assetPopulationRules.length === 0 && (
            <div className="text-center py-6 bg-gray-50 rounded-lg border border-dashed border-gray-300">
              <div className="max-w-md mx-auto">
                <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Users className="w-5 h-5 text-orange-500" />
                </div>
                <h5 className="text-sm font-medium text-gray-900 mb-1">No asset population rules</h5>
                <p className="text-xs text-gray-500 mb-3">
                  Create rules to automatically add assets to branches based on triggers like branch creation, earnings dates, or other events.
                </p>
                {canEdit && isEditMode && onAddAssetPopulationRule && (
                  <Button size="sm" onClick={onAddAssetPopulationRule}>
                    <Plus className="w-4 h-4 mr-1" />
                    Add Population Rule
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
