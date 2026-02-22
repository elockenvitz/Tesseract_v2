/**
 * CadenceView — Scheduling Rules Builder
 *
 * Vertical rule-builder layout with three sections:
 *   1. Start Conditions (run creation)
 *   2. Inclusion Logic (asset population)
 *   3. Completion Conditions (run ending)
 *
 * Each section supports multiple rules, section-specific add buttons,
 * and is structured for future AND/OR conditional logic.
 *
 * Also renders:
 *   - Summary panel (next run, assets in scope, active rule count)
 *   - Execution history (collapsible)
 *   - Execution detail drawer
 */

import React, { useState, useMemo } from 'react'
import {
  Calendar, Clock, Zap, AlertCircle,
  GitBranch, Users, ChevronRight, ChevronDown, XCircle, CheckCircle,
  AlertTriangle, History, X, Eye
} from 'lucide-react'
import { Card } from '../../ui/Card'
import { RuleRow } from './RuleRow'
import { RuleSection } from './RuleSection'

// ─── Types ──────────────────────────────────────────────────────────────────

export type CadenceTimeframe = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'semi-annually' | 'annually' | 'persistent'

export type RuleCategory = 'branch_creation' | 'asset_population' | 'branch_ending'

export type RuleStatus = 'erroring' | 'active' | 'active_unscheduled' | 'paused'

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
  last_run_at?: string | null
  next_run_at?: string | null
  run_count?: number
  last_status?: 'success' | 'error' | 'skipped' | null
  last_error?: string | null
  schedule_error?: string | null
}

export interface RuleExecution {
  id: string
  rule_id: string
  workflow_id: string
  executed_at: string
  status: 'success' | 'error' | 'skipped'
  trigger_source: 'manual' | 'scheduler' | 'db_trigger' | 'client_session'
  executed_by?: string | null
  result_summary?: any
  error_message?: string | null
  idempotency_key?: string | null
}

export interface CadenceViewProps {
  cadenceTimeframe?: CadenceTimeframe
  cadenceDays?: number[]
  automationRules?: AutomationRule[]
  canEdit?: boolean
  isEditMode?: boolean
  isLoadingRules?: boolean
  onChangeCadence?: (timeframe: CadenceTimeframe) => void
  onAddRule?: () => void
  onEditRule?: (rule: AutomationRule) => void
  onDeleteRule?: (ruleId: string, ruleName: string) => void
  onToggleRuleActive?: (ruleId: string, isActive: boolean) => void
  onAddAssetPopulationRule?: () => void
  onEditAssetPopulationRule?: (rule: AutomationRule) => void
  onDeleteAssetPopulationRule?: (ruleId: string, ruleName: string) => void
  onAddBranchEndingRule?: () => void
  onEditBranchEndingRule?: (rule: AutomationRule) => void
  onDeleteBranchEndingRule?: (ruleId: string, ruleName: string) => void
  onRunRule?: (ruleId: string) => void
  runningRuleId?: string | null
  ruleExecutions?: RuleExecution[]
  isLoadingExecutions?: boolean
  // Next run summary
  universeAssetCount?: number
  onViewUniverseAssets?: () => void
}

// ─── Status helpers ─────────────────────────────────────────────────────────

function computeRuleStatus(rule: AutomationRule): RuleStatus {
  if (!rule.is_active) return 'paused'

  // Erroring: last execution was an error within the last 24 hours
  if (rule.last_status === 'error' && rule.last_run_at) {
    const hoursSinceRun = (Date.now() - new Date(rule.last_run_at).getTime()) / 3600000
    if (hoursSinceRun < 24) return 'erroring'
  }

  // Time-interval rules without a schedule
  if (rule.condition_type === 'time_interval' && !rule.next_run_at) {
    return 'active_unscheduled'
  }

  return 'active'
}

const STATUS_PRIORITY: Record<RuleStatus, number> = {
  erroring: 0,
  active: 1,
  active_unscheduled: 2,
  paused: 3,
}

function sortRulesByStatus(rules: AutomationRule[]): AutomationRule[] {
  return [...rules].sort((a, b) => {
    const sa = computeRuleStatus(a)
    const sb = computeRuleStatus(b)
    const diff = STATUS_PRIORITY[sa] - STATUS_PRIORITY[sb]
    if (diff !== 0) return diff
    // Within same status: soonest next_run_at first
    if (a.next_run_at && b.next_run_at) {
      return new Date(a.next_run_at).getTime() - new Date(b.next_run_at).getTime()
    }
    if (a.next_run_at) return -1
    if (b.next_run_at) return 1
    return 0
  })
}

const STATUS_CONFIG: Record<RuleStatus, { label: string; className: string; icon: React.ReactNode }> = {
  erroring: {
    label: 'Erroring',
    className: 'bg-red-100 text-red-700 border-red-300',
    icon: <AlertCircle className="w-3 h-3" />,
  },
  active: {
    label: 'Active',
    className: 'bg-green-50 text-green-600 border-green-200',
    icon: <CheckCircle className="w-3 h-3" />,
  },
  active_unscheduled: {
    label: 'Unscheduled',
    className: 'bg-amber-100 text-amber-700 border-amber-300',
    icon: <AlertTriangle className="w-3 h-3" />,
  },
  paused: {
    label: 'Paused',
    className: 'bg-gray-100 text-gray-600 border-gray-300',
    icon: <Clock className="w-3 h-3" />,
  },
}

// ─── Component ──────────────────────────────────────────────────────────────

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
  onDeleteAssetPopulationRule,
  onAddBranchEndingRule,
  onEditBranchEndingRule,
  onDeleteBranchEndingRule,
  onRunRule,
  runningRuleId,
  ruleExecutions = [],
  isLoadingExecutions = false,
  universeAssetCount,
  onViewUniverseAssets,
}: CadenceViewProps) {
  const [showHistory, setShowHistory] = useState(false)
  const [selectedExecution, setSelectedExecution] = useState<RuleExecution | null>(null)

  // ── Categorize & sort rules ───────────────────────────────────────────
  const branchCreationRules = useMemo(
    () => sortRulesByStatus(automationRules.filter(r => !r.rule_category || r.rule_category === 'branch_creation')),
    [automationRules]
  )
  const assetPopulationRules = useMemo(
    () => sortRulesByStatus(automationRules.filter(r => r.rule_category === 'asset_population')),
    [automationRules]
  )
  const branchEndingRules = useMemo(
    () => sortRulesByStatus(automationRules.filter(r => r.rule_category === 'branch_ending')),
    [automationRules]
  )

  // ── Formatters ────────────────────────────────────────────────────────

  const getCadenceLabel = (tf: CadenceTimeframe): string => {
    const m: Record<CadenceTimeframe, string> = {
      daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly',
      'semi-annually': 'Semi-Annually', annually: 'Annually', persistent: 'Persistent (No Cadence)',
    }
    return m[tf] || tf
  }

  const formatTime12 = (time: string): string => {
    if (!time) return ''
    const [h, m] = time.split(':')
    const hr = parseInt(h, 10)
    return `${hr % 12 || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`
  }

  const formatRelative = (dateStr: string): string => {
    const d = new Date(dateStr)
    const ms = Date.now() - d.getTime()
    const mins = Math.floor(ms / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(ms / 3600000)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.floor(ms / 86400000)
    if (days < 7) return `${days}d ago`
    return d.toLocaleDateString()
  }

  const formatFuture = (dateStr: string): string => {
    const d = new Date(dateStr)
    const ms = d.getTime() - Date.now()
    if (ms < 0) return 'overdue'
    const mins = Math.floor(ms / 60000)
    if (mins < 60) return `in ${mins}m`
    const hrs = Math.floor(ms / 3600000)
    if (hrs < 24) return `in ${hrs}h`
    const days = Math.floor(ms / 86400000)
    if (days < 7) return `in ${days}d`
    return d.toLocaleDateString()
  }

  // ── Condition/Action descriptions ─────────────────────────────────────

  const getConditionDescription = (rule: AutomationRule): string => {
    const { condition_type, condition_value } = rule
    const cv = condition_value || {}
    const cap = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1) : ''

    if (condition_type === 'time_interval' && cv.pattern_type) {
      const t = cv.trigger_time ? ` at ${formatTime12(cv.trigger_time)}` : ''
      switch (cv.pattern_type) {
        case 'daily':
          if (cv.daily_type === 'every_weekday') return `Every weekday${t}`
          return cv.interval === 1 ? `Every day${t}` : `Every ${cv.interval} days${t}`
        case 'weekly': {
          const dn = (cv.days_of_week || []).map((d: string) => cap(d.slice(0, 3))).join(', ')
          return cv.interval === 1 ? `Weekly on ${dn || 'selected days'}${t}` : `Every ${cv.interval} weeks on ${dn || 'selected days'}${t}`
        }
        case 'monthly':
          if (cv.monthly_type === 'day_of_month') {
            const n = cv.day_number || 1
            const sfx = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'
            return cv.interval === 1 ? `Monthly on the ${n}${sfx}${t}` : `Every ${cv.interval} months on the ${n}${sfx}${t}`
          }
          if (cv.monthly_type === 'position_of_month')
            return `The ${cv.position || 'first'} ${cap(cv.day_name || 'day')} of every ${cv.interval === 1 ? 'month' : `${cv.interval} months`}${t}`
          return `Monthly${t}`
        case 'quarterly':
          if (cv.quarterly_type === 'day_of_quarter')
            return cv.interval === 1 ? `Day ${cv.day_number || 1} of each quarter${t}` : `Day ${cv.day_number || 1} every ${cv.interval} quarters${t}`
          if (cv.quarterly_type === 'position_of_quarter')
            return `The ${cv.position || 'first'} ${cap(cv.day_name || 'day')} of each quarter${t}`
          return `Quarterly${t}`
        case 'yearly':
          if (cv.yearly_type === 'specific_date')
            return `Annually on ${cap(cv.month || 'January')} ${cv.day_number || 1}${t}`
          if (cv.yearly_type === 'position_of_year')
            return `The ${cv.position || 'first'} ${cap(cv.day_name || 'day')} of ${cap(cv.month || 'January')} each year${t}`
          return `Yearly${t}`
        default: return cap(cv.pattern_type)
      }
    }
    if (condition_type === 'stage_completion') return cv.stage_key ? `When stage "${cv.stage_key}" is completed` : 'When any stage is completed'
    if (condition_type === 'note_added') return 'When a note is added'
    if (condition_type === 'list_assignment') return 'When added to a list'
    if (condition_type === 'workflow_start') return 'When workflow starts'
    if (condition_type === 'earnings_date') return `${cv.days_offset || 0} days ${cv.timing === 'after' ? 'after' : 'before'} earnings`
    if (condition_type === 'on_branch_creation') return 'When a new run is started'
    if (condition_type === 'days_before_earnings') return `${cv.days_offset || 0} days before earnings`
    if (condition_type === 'days_after_earnings') return `${cv.days_offset || 0} days after earnings`
    if (condition_type === 'volume_spike') return cv.threshold ? `When volume exceeds ${cv.threshold}x average` : 'When volume spikes'
    if (condition_type === 'manual_trigger') return 'Manual trigger only'
    if (condition_type === 'time_after_creation') {
      let s = `${cv.amount || 30} ${cv.unit || 'days'}`
      if (cv.secondaryAmount && cv.secondaryUnit) s += ` and ${cv.secondaryAmount} ${cv.secondaryUnit}`
      if (cv.atSpecificTime && cv.triggerTime) s += ` at ${formatTime12(cv.triggerTime)}`
      return `${s} after the run starts`
    }
    if (condition_type === 'days_after_creation') return `${cv.days || 30} days after the run starts`
    if (condition_type === 'specific_date') {
      let d = cv.date ? `On ${new Date(cv.date).toLocaleDateString()}` : 'On a specific date'
      if (cv.triggerTime) d += ` at ${formatTime12(cv.triggerTime)}`
      return d
    }
    return condition_type?.replace(/_/g, ' ') || 'Trigger configured'
  }

  const getActionDescription = (rule: AutomationRule): string => {
    const { action_type, action_value } = rule
    const av = action_value || {}
    switch (action_type) {
      case 'branch_copy': return av.branch_suffix ? `Start run "${av.branch_suffix}" carrying forward progress` : 'Start a new run carrying forward progress'
      case 'branch_nocopy': return av.branch_suffix ? `Start fresh run "${av.branch_suffix}"` : 'Start a fresh run from scratch'
      case 'move_stage': return av.target_stage ? `Move assets to the "${av.target_stage}" stage` : 'Move assets to a target stage'
      case 'advance_stage': return 'Advance assets to their next stage'
      case 'reset_workflow': return av.target_stage ? `Reset all assets back to "${av.target_stage}"` : 'Reset all assets to the first stage'
      case 'send_reminder': return 'Send a reminder notification'
      case 'add_universe_assets': return 'Add all assets matching the scope criteria'
      case 'add_specific_assets': return av.asset_count ? `Add ${av.asset_count} specific assets` : 'Add a set of selected assets'
      case 'remove_assets': return 'Remove specified assets from the run'
      default: return action_type?.replace(/_/g, ' ') || 'Perform action'
    }
  }

  const getTriggerIcon = (ruleType: string) => {
    switch (ruleType) {
      case 'time_based': case 'time': return <Clock className="w-4 h-4 text-blue-600" />
      case 'activity_based': case 'activity': return <Zap className="w-4 h-4 text-blue-600" />
      case 'event': return <Calendar className="w-4 h-4 text-blue-600" />
      default: return <Clock className="w-4 h-4 text-blue-600" />
    }
  }

  // ── Section summary helper ────────────────────────────────────────────

  const getSectionSummary = (rules: AutomationRule[], includeNextTrigger = false): string => {
    if (rules.length === 0) return ''
    const active = rules.filter(r => r.is_active).length
    const disabled = rules.length - active
    const parts: string[] = []
    if (active > 0) parts.push(`${active} active`)
    if (disabled > 0) parts.push(`${disabled} disabled`)
    if (includeNextTrigger) {
      const nextRule = rules
        .filter(r => r.is_active && r.next_run_at)
        .sort((a, b) => new Date(a.next_run_at!).getTime() - new Date(b.next_run_at!).getTime())[0]
      if (nextRule?.next_run_at) parts.push(`Next: ${formatFuture(nextRule.next_run_at)}`)
    }
    return parts.join(' \u00b7 ')
  }

  // ── Build RuleRow props from an AutomationRule ────────────────────────

  const renderRule = (
    rule: AutomationRule,
    onEdit?: (rule: AutomationRule) => void,
    onDelete?: (ruleId: string, ruleName: string) => void,
  ) => {
    const status = computeRuleStatus(rule)
    const cfg = STATUS_CONFIG[status]

    let lastRunText: string | undefined
    let lastRunIcon: React.ReactNode | undefined
    if (rule.last_run_at) {
      lastRunText = formatRelative(rule.last_run_at)
      lastRunIcon = rule.last_status === 'success' ? <CheckCircle className="w-3 h-3 text-green-500" />
        : rule.last_status === 'error' ? <AlertCircle className="w-3 h-3 text-red-500" />
        : <Clock className="w-3 h-3 text-gray-400" />
    }

    let nextRunText: string | undefined
    let scheduleWarning: string | undefined
    if (rule.condition_type === 'time_interval') {
      if (rule.next_run_at) {
        nextRunText = formatFuture(rule.next_run_at)
      } else if (rule.is_active && rule.schedule_error) {
        scheduleWarning = rule.schedule_error
      } else if (rule.is_active) {
        scheduleWarning = 'Schedule pending'
      }
    }

    return (
      <RuleRow
        key={rule.id}
        id={rule.id}
        name={rule.rule_name}
        triggerIcon={getTriggerIcon(rule.rule_type)}
        summary={`${getConditionDescription(rule)} \u2192 ${getActionDescription(rule)}`}
        status={cfg}
        canEdit={canEdit}
        isActive={rule.is_active}
        lastRunText={lastRunText}
        lastRunIcon={lastRunIcon}
        nextRunText={nextRunText}
        scheduleWarning={scheduleWarning}
        runCount={rule.run_count}
        onEdit={onEdit ? () => onEdit(rule) : undefined}
        onDelete={onDelete ? () => onDelete(rule.id, rule.rule_name) : undefined}
        onToggleActive={onToggleRuleActive ? () => onToggleRuleActive(rule.id, !rule.is_active) : undefined}
      />
    )
  }

  // ── Main render ───────────────────────────────────────────────────────

  const activeRuleCount = automationRules.filter(r => r.is_active).length

  const nextRunRule = automationRules
    .filter(r => r.is_active && r.next_run_at)
    .sort((a, b) => new Date(a.next_run_at!).getTime() - new Date(b.next_run_at!).getTime())[0] || null
  const nextRunDate = nextRunRule?.next_run_at ? new Date(nextRunRule.next_run_at) : null

  const isConfigValid = branchCreationRules.length > 0
    && assetPopulationRules.length > 0
    && branchEndingRules.length > 0

  return (
    <div className="space-y-4">
      {/* ── System state banner ──────────────────────────────────────── */}
      <div className="bg-gray-50/80 border border-gray-200 rounded-lg px-4 py-3">
        {/* Title + cadence selector */}
        <div className="flex items-center gap-3">
          <h3 className="text-[15px] font-semibold text-gray-900">Scheduling</h3>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">Cadence:</span>
            {canEdit && onChangeCadence ? (
              <select
                value={cadenceTimeframe}
                onChange={(e) => onChangeCadence(e.target.value as CadenceTimeframe)}
                className="px-2 py-0.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-xs bg-white"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="semi-annually">Semi-Annually</option>
                <option value="annually">Annually</option>
                <option value="persistent">Persistent</option>
              </select>
            ) : (
              <span className="text-xs font-medium text-gray-700">
                {getCadenceLabel(cadenceTimeframe)}
              </span>
            )}
          </div>
        </div>

        {/* Microcopy */}
        <p className="text-xs text-gray-500 mt-1.5 mb-2">
          These rules define how recurring runs start, which assets are included, and when they complete.
        </p>

        {/* Metrics + validity warning (only shown when incomplete) */}
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5 text-gray-600">
            <span>
              {automationRules.length} {automationRules.length === 1 ? 'rule' : 'rules'}
            </span>

            {universeAssetCount !== undefined && universeAssetCount > 0 && (
              <>
                <span className="text-gray-300">&middot;</span>
                {onViewUniverseAssets ? (
                  <button
                    onClick={onViewUniverseAssets}
                    className="text-blue-600 hover:text-blue-700 font-medium transition-colors focus:outline-none focus:underline"
                  >
                    {universeAssetCount} {universeAssetCount === 1 ? 'asset' : 'assets'}
                  </button>
                ) : (
                  <span>
                    {universeAssetCount} {universeAssetCount === 1 ? 'asset' : 'assets'}
                  </span>
                )}
              </>
            )}

            {nextRunDate && (
              <>
                <span className="text-gray-300">&middot;</span>
                <span>
                  Next run: {nextRunDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              </>
            )}
          </div>

          {/* Validity — only shown when configuration is incomplete */}
          {!isConfigValid && (
            <div className="flex items-center gap-1 flex-shrink-0 ml-3">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-[11px] text-amber-600 font-medium">Configuration incomplete</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Rule builder ─────────────────────────────────────────────── */}
      <div className="space-y-4">
        <RuleSection
          step={1}
          icon={<GitBranch className="w-4 h-4 text-purple-600" />}
          title="Start Conditions"
          subtitle="When should a new run begin?"
          summaryText={getSectionSummary(branchCreationRules, true)}
          addLabel="Add start condition"
          canEdit={canEdit}
          isLoading={isLoadingRules}
          ruleCount={branchCreationRules.length}
          onAdd={onAddRule}
        >
          {branchCreationRules.map(r => renderRule(r, onEditRule, onDeleteRule))}
        </RuleSection>

        <RuleSection
          step={2}
          icon={<Users className="w-4 h-4 text-orange-600" />}
          title="Inclusion Logic"
          subtitle="Which assets should be added to a run?"
          summaryText={getSectionSummary(assetPopulationRules)}
          addLabel="Add inclusion rule"
          canEdit={canEdit}
          isLoading={isLoadingRules}
          ruleCount={assetPopulationRules.length}
          onAdd={onAddAssetPopulationRule}
        >
          {assetPopulationRules.map(r => renderRule(r, onEditAssetPopulationRule, onDeleteAssetPopulationRule))}
        </RuleSection>

        <RuleSection
          step={3}
          icon={<XCircle className="w-4 h-4 text-red-600" />}
          title="Completion Conditions"
          subtitle="When should a run end?"
          summaryText={getSectionSummary(branchEndingRules)}
          addLabel="Add completion condition"
          canEdit={canEdit}
          isLoading={isLoadingRules}
          ruleCount={branchEndingRules.length}
          onAdd={onAddBranchEndingRule}
        >
          {branchEndingRules.map(r => renderRule(r, onEditBranchEndingRule, onDeleteBranchEndingRule))}
        </RuleSection>
      </div>

      {/* ── Execution History ──────────────────────────────────────────── */}
      {ruleExecutions.length > 0 && (
        <Card className="overflow-hidden">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="w-full px-3 py-2 flex items-center justify-between hover:bg-gray-50 transition-colors text-left"
          >
            <div className="flex items-center gap-2">
              {showHistory ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
              <History className="w-4 h-4 text-gray-600" />
              <h4 className="text-sm font-semibold text-gray-900">Run History ({ruleExecutions.length})</h4>
            </div>
          </button>

          {showHistory && (
            <div className="px-3 pb-3 border-t border-gray-100">
              {isLoadingExecutions ? (
                <div className="text-center py-4">
                  <div className="inline-block animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600" />
                </div>
              ) : (
                <div className="divide-y divide-gray-100 mt-2">
                  {ruleExecutions.map((exec) => {
                    const rule = automationRules.find(r => r.id === exec.rule_id)
                    return (
                      <button
                        key={exec.id}
                        onClick={() => setSelectedExecution(exec)}
                        className="flex items-center justify-between py-2 text-xs w-full text-left hover:bg-gray-50 rounded px-1 -mx-1 transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {exec.status === 'success' ? <CheckCircle className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                            : exec.status === 'error' ? <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                            : <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />}
                          <span className="font-medium text-gray-700 truncate">{rule?.rule_name || 'Unknown rule'}</span>
                          {exec.trigger_source !== 'manual' ? null : (
                            <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded text-[10px] font-medium">manual</span>
                          )}
                          {exec.trigger_source === 'scheduler' && (
                            <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-[10px] font-medium">scheduler</span>
                          )}
                          {canEdit && exec.error_message && (
                            <span className="text-red-500 truncate max-w-[180px]" title={exec.error_message}>{exec.error_message}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                          <Eye className="w-3 h-3 text-gray-400" />
                          <span className="text-gray-400">{formatRelative(exec.executed_at)}</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {/* ── Execution Detail Drawer ──────────────────────────────────── */}
      {selectedExecution && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/20" onClick={() => setSelectedExecution(null)} />
          <div className="relative w-full max-w-md bg-white shadow-xl flex flex-col animate-in slide-in-from-right">
            {/* Drawer header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <h3 className="text-sm font-semibold text-gray-900">Execution Detail</h3>
              <button onClick={() => setSelectedExecution(null)} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            {/* Drawer body */}
            <div className="flex-1 overflow-auto p-4 space-y-4">
              {/* Status */}
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Status</label>
                <div className="mt-1 flex items-center gap-2">
                  {selectedExecution.status === 'success' ? <CheckCircle className="w-4 h-4 text-green-500" />
                    : selectedExecution.status === 'error' ? <AlertCircle className="w-4 h-4 text-red-500" />
                    : <AlertTriangle className="w-4 h-4 text-amber-500" />}
                  <span className={`text-sm font-medium ${
                    selectedExecution.status === 'success' ? 'text-green-700'
                    : selectedExecution.status === 'error' ? 'text-red-700'
                    : 'text-amber-700'
                  }`}>
                    {selectedExecution.status.charAt(0).toUpperCase() + selectedExecution.status.slice(1)}
                  </span>
                </div>
              </div>

              {/* Rule name */}
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Rule</label>
                <p className="mt-1 text-sm text-gray-900">
                  {automationRules.find(r => r.id === selectedExecution.rule_id)?.rule_name || selectedExecution.rule_id}
                </p>
              </div>

              {/* Timestamp */}
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Executed At</label>
                <p className="mt-1 text-sm text-gray-900">{new Date(selectedExecution.executed_at).toLocaleString()}</p>
              </div>

              {/* Trigger source */}
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Trigger Source</label>
                <p className="mt-1 text-sm text-gray-900">{selectedExecution.trigger_source}</p>
              </div>

              {/* Result summary */}
              {selectedExecution.result_summary && (
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Result Summary</label>
                  <pre className="mt-1 text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-60 text-gray-800 border border-gray-200">
                    {JSON.stringify(selectedExecution.result_summary, null, 2)}
                  </pre>
                </div>
              )}

              {/* Error message - admin only */}
              {canEdit && selectedExecution.error_message && (
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Error Message</label>
                  <pre className="mt-1 text-xs bg-red-50 rounded-lg p-3 overflow-auto max-h-40 text-red-800 border border-red-200 whitespace-pre-wrap">
                    {selectedExecution.error_message}
                  </pre>
                </div>
              )}

              {/* Idempotency key */}
              {selectedExecution.idempotency_key && (
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Idempotency Key</label>
                  <p className="mt-1 text-xs text-gray-600 font-mono break-all">{selectedExecution.idempotency_key}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
