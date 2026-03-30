/**
 * OverviewView Component
 *
 * Execution-first dashboard for a recurring process.
 * Prioritises quick signal when a run is active:
 *
 *   1. Active Run Signal Strip (health · identity · progress · actions)
 *      OR "No Active Run" banner with schedule / create CTA
 *   2. Needs Attention (only when items exist)
 *   3. Schedule summary  +  Run History summary  (side-by-side)
 *   4. Process Definition (template version card, de-emphasised)
 *   5. Details (collapsible: timeline, created by)
 */

import React, { useState } from 'react'
import {
  Play,
  Clock,
  Calendar,
  History,
  Settings,
  Square,
  Eye,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  CircleDot,
  Info,
} from 'lucide-react'
import { Card } from '../../ui/Card'
import { Button } from '../../ui/Button'
import { WorkflowWithStats } from '../../../types/workflow/workflow.types'
import { WorkflowTemplateVersionCard, TemplateVersion } from './WorkflowTemplateVersionCard'
import {
  safeRelativeTime,
  safeFutureRelativeTime,
} from '../../../utils/workflow/runHelpers'

// ─── Interfaces ────────────────────────────────────────────────

interface ActiveRunSummary {
  id: string
  branch_suffix?: string
  branch_name?: string
  template_version_number?: string | number | null
  total_assets: number
  active_assets: number
  completed_assets: number
  created_at?: string
}

interface ScheduleSummary {
  next_run_at: string | null
  rule_name: string
}

interface AutomationRuleSummary {
  id: string
  rule_name: string
  rule_category?: string
  condition_type?: string
  is_active: boolean
  next_run_at?: string | null
}

interface RunHistoryBranch {
  id: string
  is_active: boolean
  is_archived: boolean
  is_deleted: boolean
  is_placeholder?: boolean
  total_assets: number
  completed_assets: number
  created_at: string
  archived_at?: string
  status?: string
}

export interface OverviewViewProps {
  workflow: WorkflowWithStats
  templateVersions?: TemplateVersion[]
  /** Live stages for the process definition card */
  stages?: { id: string; stage_label: string; stage_key?: string; sort_order?: number }[]
  /** Live checklist items for the process definition card */
  checklistItems?: { id: string; item_text: string; stage_id?: string; sort_order?: number }[]
  onViewAllVersions?: () => void
  activeRun?: ActiveRunSummary | null
  schedule?: ScheduleSummary | null
  automationRules?: AutomationRuleSummary[]
  branches?: RunHistoryBranch[]
  scopeCount?: number
  onViewRun?: () => void
  onEndRun?: () => void
  onConfigureSchedule?: () => void
  onViewScope?: () => void
}

// ─── Health helpers ────────────────────────────────────────────

type HealthState = 'on_track' | 'at_risk' | 'needs_attention'

function computeHealth(run: ActiveRunSummary): HealthState {
  if (run.total_assets === 0) return 'needs_attention'          // nothing assigned yet
  if (run.active_assets === 0) return 'on_track'                 // all done
  const pct = run.completed_assets / run.total_assets
  if (pct >= 0.5) return 'on_track'                              // ≥50 % done
  if (pct >= 0.2) return 'at_risk'                               // 20-49 % — lagging
  return 'needs_attention'                                       // <20 %
}

const HEALTH_CONFIG: Record<HealthState, { label: string; color: string; border: string; dot: string }> = {
  on_track:        { label: 'On track',        color: 'text-green-700 bg-green-50 border-green-200',    border: 'border-l-green-500', dot: 'bg-green-500'  },
  at_risk:         { label: 'At risk',         color: 'text-amber-700 bg-amber-50 border-amber-200',    border: 'border-l-amber-500', dot: 'bg-amber-500'  },
  needs_attention: { label: 'Needs attention', color: 'text-red-700   bg-red-50   border-red-200',      border: 'border-l-red-500',   dot: 'bg-red-500'    },
}

// ─── Component ─────────────────────────────────────────────────

export function OverviewView({
  workflow,
  templateVersions,
  stages,
  checklistItems,
  onViewAllVersions,
  activeRun,
  schedule,
  automationRules,
  branches,
  scopeCount,
  onViewRun,
  onEndRun,
  onConfigureSchedule,
  onViewScope,
}: OverviewViewProps) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const isPortfolioScope = workflow.scope_type === 'portfolio'
  const itemLabel = isPortfolioScope ? 'portfolios' : 'assets'
  const itemLabelSingular = isPortfolioScope ? 'portfolio' : 'asset'
  const isGeneralScope = workflow.scope_type === 'general'
  const ItemsInScope = isGeneralScope ? 'Stages in Process' : isPortfolioScope ? 'Portfolios in Scope' : 'Assets in Scope'
  const ItemsAssigned = isGeneralScope ? 'Stages defined' : isPortfolioScope ? 'Portfolios assigned' : 'Assets assigned'

  const createdDate = new Date(workflow.created_at).toLocaleDateString()
  const updatedDate = new Date(workflow.updated_at).toLocaleDateString()

  // ─── Run history stats ─────────────────────────────────────
  const realBranches = (branches || []).filter(
    (b) => !b.is_placeholder && !b.is_deleted
  )
  const totalRuns = realBranches.length
  const completedRuns = realBranches.filter(
    (b) => !b.is_active || b.is_archived
  )
  const lastCompletedRun = completedRuns.length > 0
    ? completedRuns.sort((a, b) => {
        const dateA = a.archived_at || a.created_at
        const dateB = b.archived_at || b.created_at
        return new Date(dateB).getTime() - new Date(dateA).getTime()
      })[0]
    : null
  const lastCompletedDate = lastCompletedRun
    ? new Date(lastCompletedRun.archived_at || lastCompletedRun.created_at).toLocaleDateString()
    : null

  // ─── End condition helper ──────────────────────────────────
  function getEndConditionText(rules: any[], runCreatedAt?: string | null): string | null {
    const active = rules.filter(r => r.is_active)
    if (active.length === 0) return null
    const rule = active[0]
    const cv = rule.condition_value || {}
    switch (rule.condition_type) {
      case 'all_assets_completed': return 'Ends when all items are completed'
      case 'time_after_creation': {
        if (runCreatedAt && cv.amount && cv.unit) {
          const created = new Date(runCreatedAt)
          const ms = cv.unit === 'hours' ? cv.amount * 3600000 : cv.amount * 86400000
          const endDate = new Date(created.getTime() + ms)
          if (cv.atSpecificTime && cv.triggerTime) {
            const [h, m] = cv.triggerTime.split(':').map(Number)
            endDate.setHours(h, m, 0, 0)
          }
          const now = new Date()
          if (endDate <= now) return `Should have ended ${endDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at ${cv.triggerTime || ''} (overdue)`
          return `Ends ${endDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}${cv.triggerTime ? ` at ${cv.triggerTime}` : ''}`
        }
        return `Ends ${cv.amount || ''} ${cv.unit || 'days'} after start${cv.triggerTime ? ` at ${cv.triggerTime}` : ''}`
      }
      case 'time_interval': {
        if (cv.pattern_type === 'daily') return `Ends daily at ${cv.trigger_time || 'scheduled time'}`
        if (cv.pattern_type === 'weekly') return `Ends weekly on ${cv.day_of_week || 'scheduled day'}`
        if (cv.pattern_type === 'monthly') return `Ends monthly on day ${cv.day_of_month || 'scheduled day'}`
        return `Ends on schedule`
      }
      case 'specific_date': return `Ends ${cv.date ? new Date(cv.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : 'on specific date'}`
      case 'manual': return 'Ends manually'
      default: return rule.rule_name || 'Has completion rule'
    }
  }

  // ─── Schedule info ─────────────────────────────────────────
  const hasScheduleRules = automationRules && automationRules.length > 0
  const creationRules = (automationRules || []).filter(
    (r) => !r.rule_category || r.rule_category === 'branch_creation'
  )
  const endingRules = (automationRules || []).filter(
    (r) => r.rule_category === 'branch_ending'
  )
  const hasAutoEnd = endingRules.some((r) => r.is_active)
  const cadenceLabel = workflow.cadence_timeframe
    ? workflow.cadence_timeframe.charAt(0).toUpperCase() + workflow.cadence_timeframe.slice(1)
    : null

  // ─── Progress computation ──────────────────────────────────
  const pct = activeRun && activeRun.total_assets > 0
    ? Math.round((activeRun.completed_assets / activeRun.total_assets) * 100)
    : 0

  // ─── Needs-attention items ─────────────────────────────────
  const attentionItems: { label: string; detail: string }[] = []
  if (activeRun) {
    if (activeRun.total_assets === 0) {
      attentionItems.push({ label: `No ${itemLabel} assigned`, detail: `Add ${itemLabel} to the run or configure inclusion rules.` })
    }
    if (activeRun.total_assets > 0 && activeRun.active_assets === activeRun.total_assets) {
      attentionItems.push({ label: 'No progress yet', detail: `None of the assigned ${itemLabel} have been completed.` })
    }
  }
  const multipleActive = realBranches.filter((b) => b.is_active).length
  if (multipleActive > 1) {
    attentionItems.push({ label: `${multipleActive} active runs`, detail: 'Consider ending older runs to avoid confusion.' })
  }

  // ─── Health state (only when run exists) ───────────────────
  const health = activeRun ? computeHealth(activeRun) : null
  const healthCfg = health ? HEALTH_CONFIG[health] : null

  // ─── Version label ─────────────────────────────────────────
  const versionLabel = activeRun?.template_version_number
    ? `v${activeRun.template_version_number}`
    : 'v—'

  return (
    <div className="space-y-6">

      {/* ═══ 1. Active Run Signal Strip ═══════════════════════════ */}
      {activeRun ? (
        <Card className={`border-l-4 ${healthCfg!.border}`}>
          <div className="p-5">
            {/* Header: health badge + actions */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-3">
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${healthCfg!.color}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${healthCfg!.dot}`} />
                  {healthCfg!.label}
                </span>
                <h3 className="text-base font-semibold text-gray-900">Active Run</h3>
              </div>
              <div className="flex items-center space-x-2">
                {onEndRun && (
                  <Button size="sm" variant="outline" onClick={onEndRun}>
                    <Square className="w-3.5 h-3.5 mr-1.5" />
                    End Run
                  </Button>
                )}
                {onViewRun && (
                  <Button size="sm" onClick={onViewRun}>
                    <Eye className="w-3.5 h-3.5 mr-1.5" />
                    Open Run
                  </Button>
                )}
              </div>
            </div>

            {/* Identity row */}
            <div className="flex items-center space-x-3 mb-3">
              <span className="font-medium text-gray-900">
                {activeRun.branch_suffix || activeRun.branch_name || 'Current'}
              </span>
              <span
                className="text-[10px] font-medium px-1.5 py-0 rounded bg-gray-100 text-gray-500 leading-4"
                title={activeRun.template_version_number ? `Process definition ${versionLabel}` : 'No definition version assigned'}
              >
                {versionLabel}
              </span>
              <span className="text-xs text-gray-400">
                Started {safeRelativeTime(activeRun.created_at)}
              </span>
            </div>

            {/* Progress + counts */}
            {workflow.scope_type === 'general' ? (
              stages && stages.length > 0 ? (
                <div className="text-sm text-gray-600">
                  <span className="font-semibold text-gray-900">{stages.length}</span> stages · In progress
                </div>
              ) : (
                <p className="text-sm text-gray-400">No stages defined</p>
              )
            ) : activeRun.total_assets > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center space-x-4">
                    <span className="text-gray-600">
                      <span className="font-semibold text-gray-900">{activeRun.completed_assets}</span>
                      <span className="text-gray-400"> / {activeRun.total_assets} {itemLabel}</span>
                    </span>
                    <span className={`text-xs font-medium ${activeRun.active_assets > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                      {activeRun.active_assets > 0 ? `${activeRun.active_assets} remaining` : 'All complete'}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400 font-medium">{pct}%</span>
                </div>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      health === 'on_track' ? 'bg-green-500'
                      : health === 'at_risk' ? 'bg-amber-500'
                      : 'bg-red-500'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400">0 {itemLabel} assigned to this run.</p>
            )}

            {/* End condition */}
            {getEndConditionText(endingRules) && (
              <p className="text-xs text-gray-500 mt-2 pt-2 border-t border-gray-100">
                {getEndConditionText(endingRules, activeRun?.created_at)}
              </p>
            )}
          </div>
        </Card>
      ) : (
        /* ─── No active run banner ─── */
        <Card className="bg-gray-50 border-gray-200">
          <div className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Play className="w-5 h-5 text-gray-400" />
                <div>
                  <h3 className="text-sm font-semibold text-gray-700">No active run</h3>
                  {schedule?.next_run_at ? (
                    <p className="text-xs text-gray-500 mt-0.5">
                      Next scheduled: {safeFutureRelativeTime(schedule.next_run_at)}
                      {hasAutoEnd && ' · Auto-start enabled'}
                    </p>
                  ) : hasScheduleRules ? (
                    <p className="text-xs text-gray-400 mt-0.5">
                      No upcoming scheduled run.
                    </p>
                  ) : (
                    <p className="text-xs text-gray-400 mt-0.5">
                      No recurring schedule configured.
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center space-x-2">
                {!hasScheduleRules && onConfigureSchedule && (
                  <Button size="sm" variant="outline" onClick={onConfigureSchedule}>
                    <Settings className="w-3.5 h-3.5 mr-1.5" />
                    Configure Schedule
                  </Button>
                )}
                {lastCompletedRun && (
                  <div className="flex items-center space-x-2 text-xs text-gray-500">
                    <History className="w-3.5 h-3.5" />
                    <span>
                      Last run: {lastCompletedDate}
                      {lastCompletedRun.total_assets > 0 && (
                        <span className="text-gray-400"> · {lastCompletedRun.completed_assets}/{lastCompletedRun.total_assets} assets</span>
                      )}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* ═══ Quick Stats strip ═══════════════════════════════════ */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
          <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-0.5">{ItemsInScope}</p>
          {scopeCount !== undefined ? (
            onViewScope ? (
              <button onClick={onViewScope} className="text-lg font-bold text-blue-600 hover:text-blue-700 transition-colors">
                {scopeCount}
                <span className="text-xs font-medium ml-1">&rarr;</span>
              </button>
            ) : (
              <span className="text-lg font-bold text-gray-900">{scopeCount}</span>
            )
          ) : (
            <span className="text-lg font-bold text-gray-300">&mdash;</span>
          )}
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
          <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-0.5">Total Runs</p>
          <span className="text-lg font-bold text-gray-900">{totalRuns}</span>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
          <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-0.5">Last Completed</p>
          <span className="text-lg font-bold text-gray-900">{lastCompletedDate || '\u2014'}</span>
        </div>
      </div>

      {/* ═══ 2. Needs Attention ═══════════════════════════════════ */}
      {attentionItems.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50">
          <div className="p-4">
            <div className="flex items-center space-x-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-semibold text-amber-800">Needs Attention</h3>
            </div>
            <div className="space-y-1.5">
              {attentionItems.map((item, i) => (
                <div key={i} className="flex items-start space-x-2">
                  <CircleDot className="w-3 h-3 text-amber-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="text-sm font-medium text-amber-900">{item.label}</span>
                    <span className="text-sm text-amber-700"> — {item.detail}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* ═══ 3. Schedule + Run History (side-by-side) ═════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Schedule */}
        <Card className="flex flex-col">
          <div className="p-5 flex-1">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <Calendar className="w-4 h-4 text-indigo-500" />
                <h3 className="text-sm font-semibold text-gray-900">Schedule</h3>
              </div>
              {onConfigureSchedule && (
                <button
                  onClick={onConfigureSchedule}
                  className="flex items-center text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <Settings className="w-3.5 h-3.5 mr-1" />
                  Configure
                </button>
              )}
            </div>

            {hasScheduleRules ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Cadence</span>
                  <span className="text-gray-900 font-medium">{cadenceLabel || 'Not set'}</span>
                </div>

                {schedule?.next_run_at && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Next scheduled run</span>
                    <span className="text-gray-900 font-medium">
                      {safeFutureRelativeTime(schedule.next_run_at)}
                    </span>
                  </div>
                )}

                {creationRules.length > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Creation rules</span>
                    <span className="text-gray-500">
                      {creationRules.filter((r) => r.is_active).length} active
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Auto-end previous runs</span>
                  <span className={`font-medium ${hasAutoEnd ? 'text-green-600' : 'text-gray-400'}`}>
                    {hasAutoEnd ? 'Enabled' : 'Not configured'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-center py-3">
                <p className="text-sm text-gray-400">No scheduling rules configured.</p>
                {onConfigureSchedule && (
                  <Button size="sm" variant="outline" onClick={onConfigureSchedule} className="mt-3">
                    <Settings className="w-3.5 h-3.5 mr-1.5" />
                    Configure Schedule
                  </Button>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* Run History */}
        <Card className="flex flex-col">
          <div className="p-5 flex-1">
            <div className="flex items-center space-x-2 mb-4">
              <History className="w-4 h-4 text-purple-500" />
              <h3 className="text-sm font-semibold text-gray-900">Run History</h3>
            </div>

            {totalRuns > 0 ? (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-2xl font-bold text-gray-900">{totalRuns}</div>
                  <div className="text-xs text-gray-500">Total runs</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-gray-900">{completedRuns.length}</div>
                  <div className="text-xs text-gray-500">Completed</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-gray-900">
                    {realBranches.filter((b) => b.is_active).length}
                  </div>
                  <div className="text-xs text-gray-500">Active now</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    {lastCompletedDate || '—'}
                  </div>
                  <div className="text-xs text-gray-500">Last completed</div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400">No runs yet. Create a run to get started.</p>
            )}
          </div>
        </Card>
      </div>

      {/* ═══ 4. Process Definition (de-emphasised) ════════════════ */}
      <WorkflowTemplateVersionCard
        versions={templateVersions}
        stages={stages}
        checklistItems={checklistItems}
        onViewAllVersions={onViewAllVersions}
      />

      {/* ═══ 5. Details (collapsible) ═════════════════════════════ */}
      <div className="border border-gray-200 rounded-lg bg-white">
        <button
          onClick={() => setDetailsOpen(!detailsOpen)}
          className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors rounded-lg"
        >
          <div className="flex items-center space-x-2">
            <Info className="w-4 h-4 text-gray-400" />
            <span className="text-sm font-semibold text-gray-700">Details</span>
          </div>
          {detailsOpen
            ? <ChevronDown className="w-4 h-4 text-gray-400" />
            : <ChevronRight className="w-4 h-4 text-gray-400" />
          }
        </button>
        {detailsOpen && (
          <div className="px-5 pb-4 border-t border-gray-100">
            <div className="space-y-3 pt-3">
              <div className="flex items-center space-x-3">
                <div className="w-2 h-2 bg-green-500 rounded-full" />
                <div className="flex-1">
                  <div className="text-sm text-gray-700">Created</div>
                  <div className="text-xs text-gray-500">{createdDate}</div>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <div className="w-2 h-2 bg-blue-500 rounded-full" />
                <div className="flex-1">
                  <div className="text-sm text-gray-700">Last updated</div>
                  <div className="text-xs text-gray-500">{updatedDate}</div>
                </div>
              </div>
              {workflow.creator_name && (
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-gray-300 rounded-full" />
                  <div className="flex-1">
                    <div className="text-sm text-gray-700">Created by</div>
                    <div className="text-xs text-gray-500">{workflow.creator_name}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
