/**
 * RecurringProcessesHomePanel
 *
 * Default landing page for the Recurring Processes page.
 * Answers: "What's active, what needs attention, what's next, what processes exist?"
 *
 * Sections:
 *   - Attention chips (computed from existing data)
 *   - Active Runs (grouped by process, parent-gated)
 *   - Upcoming Cycles (parent-gated)
 *   - Processes (catalog with optional archived toggle)
 */

import React, { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Plus,
  Activity,
  Calendar,
  Clock,
  List,
  AlertTriangle,
  Info,
  ChevronRight,
  Eye,
} from 'lucide-react'
import { Card } from '../../ui/Card'
import { Button } from '../../ui/Button'
import { Badge } from '../../ui/Badge'
import { supabase } from '../../../lib/supabase'
import { useActiveRuns, type ActiveRun } from '../../../hooks/workflow/useActiveRuns'
import { ActiveRunsTable } from './ActiveRunsTable'
import {
  isActiveRun,
  isEndedRun,
  isArchivedRun,
  isActiveProcess,
  safeFutureRelativeTime,
  groupRunsByProcess,
  getScopeBadgeLabel,
  getScopeColor,
} from '../../../utils/workflow/runHelpers'

// Minimal type matching WorkflowWithStats shape from WorkflowsPage
interface WorkflowItem {
  id: string
  name: string
  description: string
  color: string
  cadence_timeframe?: string
  cadence_days: number
  active_assets: number
  completed_assets: number
  usage_count: number
  scope_type?: string
}

export interface RecurringProcessesHomePanelProps {
  workflows: WorkflowItem[]
  /** Archived workflows for the catalog toggle (optional) */
  archivedWorkflows?: WorkflowItem[]
  isLoadingWorkflows: boolean
  userId: string | undefined
  onSelectWorkflow: (workflow: WorkflowItem) => void
  onSelectRun: (run: ActiveRun) => void
  onCreateWorkflow: () => void
  onEndRun?: (run: ActiveRun) => void
  onArchiveRun?: (run: ActiveRun) => void
}

type RunViewFilter = 'active' | 'all' | 'archived' | 'ended'

function getCadenceBadge(workflow: WorkflowItem): string {
  if (workflow.cadence_timeframe === 'persistent') return 'Continuous'
  if (workflow.cadence_timeframe) {
    return workflow.cadence_timeframe.charAt(0).toUpperCase() + workflow.cadence_timeframe.slice(1)
  }
  // No cadence_timeframe and no cadence_days = manual process
  if (!workflow.cadence_days || workflow.cadence_days === 0) return 'Manual'
  if (workflow.cadence_days <= 1) return 'Daily'
  if (workflow.cadence_days <= 7) return 'Weekly'
  if (workflow.cadence_days <= 30) return 'Monthly'
  if (workflow.cadence_days <= 90) return 'Quarterly'
  return 'Annual'
}

/**
 * Checks if a run's parent process is active using the parent state
 * fields on ActiveRun (parent_archived, parent_status, parent_deleted).
 */
function isRunParentActive(run: ActiveRun): boolean {
  return isActiveProcess({
    archived: run.parent_archived,
    status: run.parent_status,
    deleted: run.parent_deleted,
  })
}

export function RecurringProcessesHomePanel({
  workflows,
  archivedWorkflows = [],
  isLoadingWorkflows,
  userId,
  onSelectWorkflow,
  onSelectRun,
  onCreateWorkflow,
  onEndRun,
  onArchiveRun,
}: RecurringProcessesHomePanelProps) {
  const { data: allRuns = [], isLoading: isLoadingRuns } = useActiveRuns(userId)
  const [viewFilter, setViewFilter] = useState<RunViewFilter>('active')
  const [showArchived, setShowArchived] = useState(false)

  // Active runs with parent gating: run is active AND parent process is active
  const parentGatedActiveRuns = useMemo(
    () => allRuns.filter(r => isActiveRun(r) && isRunParentActive(r)),
    [allRuns]
  )

  // Orphan detection: runs that are active but parent is NOT active
  const orphanActiveRuns = useMemo(
    () => allRuns.filter(r => isActiveRun(r) && !isRunParentActive(r)),
    [allRuns]
  )

  // Client-side filter based on selected view
  const filteredRuns = useMemo(() => {
    switch (viewFilter) {
      case 'active':
        // Parent-gated: only show runs whose parent process is also active
        return parentGatedActiveRuns
      case 'ended':
        return allRuns.filter(r => isEndedRun(r))
      case 'archived':
        return allRuns.filter(r => isArchivedRun(r))
      case 'all':
      default:
        return allRuns
    }
  }, [allRuns, viewFilter, parentGatedActiveRuns])

  // Count for each filter tab
  const activeCount = parentGatedActiveRuns.length
  const endedCount = useMemo(() => allRuns.filter(r => isEndedRun(r)).length, [allRuns])
  const archivedCount = useMemo(() => allRuns.filter(r => isArchivedRun(r)).length, [allRuns])

  // ─── Attention chips (computed from existing data) ───────────

  // Not started: active runs with 0 total items
  const notStartedCount = useMemo(
    () => parentGatedActiveRuns.filter(r => (r.total_items ?? r.total_assets) === 0).length,
    [parentGatedActiveRuns]
  )

  // Multiple runs: processes with >1 active run
  const multipleRunsCount = useMemo(() => {
    if (parentGatedActiveRuns.length === 0) return 0
    const groups = groupRunsByProcess(parentGatedActiveRuns)
    return groups.filter(g => g.duplicates.length > 0).length
  }, [parentGatedActiveRuns])

  // Catalog list: active processes + optionally archived
  const catalogProcesses = useMemo(() => {
    if (showArchived && archivedWorkflows.length > 0) {
      return [...workflows, ...archivedWorkflows]
    }
    return workflows
  }, [workflows, archivedWorkflows, showArchived])

  // Upcoming cycles from automation rules
  const { data: upcomingCycles = [] } = useQuery({
    queryKey: ['upcoming-runs', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workflow_automation_rules')
        .select(`
          id,
          workflow_id,
          rule_name,
          next_run_at,
          condition_type,
          workflow:workflow_id (
            name,
            color,
            cadence_timeframe,
            archived,
            status,
            deleted
          )
        `)
        .eq('is_active', true)
        .eq('condition_type', 'time_interval')
        .not('next_run_at', 'is', null)
        .gt('next_run_at', new Date().toISOString())
        .order('next_run_at', { ascending: true })
        .limit(10)

      if (error) {
        console.error('Error fetching upcoming cycles:', error)
        return []
      }

      // Parent gating: only show upcoming cycles for active parent processes
      return (data || []).filter((rule: any) => {
        const wf = rule.workflow as any
        if (!wf) return false
        return isActiveProcess({
          archived: wf.archived ?? false,
          status: wf.status ?? null,
          deleted: wf.deleted ?? false,
        })
      })
    },
    enabled: !!userId,
    staleTime: 1000 * 60 * 5,
  })

  const filterTabs: { key: RunViewFilter; label: string; count: number }[] = [
    { key: 'active', label: 'Active', count: activeCount },
    { key: 'ended', label: 'Ended', count: endedCount },
    { key: 'archived', label: 'Archived', count: archivedCount },
    { key: 'all', label: 'All', count: allRuns.length },
  ]

  const hasAttention = notStartedCount > 0 || multipleRunsCount > 0 || orphanActiveRuns.length > 0

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* ═══ HOME HERO — completely different from process detail ═══ */}
      <div className="bg-gray-100 dark:bg-gray-900 px-6 py-6 border-b border-gray-200 dark:border-gray-700">
        {/* Large stat tiles — the dominant visual that says "you're at the hub" */}
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 px-5 py-4 shadow-sm">
            <div className={`text-3xl font-extrabold tabular-nums ${activeCount > 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-300 dark:text-gray-600'}`}>{activeCount}</div>
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mt-1">Active Runs</div>
            {activeCount > 0 && <div className="mt-2 h-1 rounded-full bg-green-500/20"><div className="h-1 rounded-full bg-green-500" style={{ width: '100%' }} /></div>}
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 px-5 py-4 shadow-sm">
            <div className="text-3xl font-extrabold tabular-nums text-gray-800 dark:text-gray-200">{workflows.length}</div>
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mt-1">Processes</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 px-5 py-4 shadow-sm">
            <div className={`text-3xl font-extrabold tabular-nums ${upcomingCycles.length > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-gray-300 dark:text-gray-600'}`}>{upcomingCycles.length}</div>
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mt-1">Upcoming Cycles</div>
          </div>
          {hasAttention ? (
            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800 px-5 py-4 shadow-sm">
              <div className="text-3xl font-extrabold tabular-nums text-amber-600 dark:text-amber-400">{notStartedCount + multipleRunsCount + orphanActiveRuns.length}</div>
              <div className="text-xs font-medium text-amber-700 dark:text-amber-400 mt-1">Need Attention</div>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 px-5 py-4 shadow-sm flex items-center justify-center">
              <Button size="sm" onClick={onCreateWorkflow}>
                <Plus className="w-4 h-4 mr-1.5" />
                New Process
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 p-6 bg-gray-100 dark:bg-gray-900 overflow-y-auto space-y-6">
        {/* ─── Data integrity banner: orphan active runs ─── */}
        {orphanActiveRuns.length > 0 && (
          <div className="flex items-start space-x-2 text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5">
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <span className="font-medium">Data issue:</span>
              {' '}
              {orphanActiveRuns.length} active {orphanActiveRuns.length === 1 ? 'run belongs' : 'runs belong'} to
              an archived or ended process. End {orphanActiveRuns.length === 1 ? 'the run' : 'these runs'} or restore the process.
              <span className="block text-red-500 text-xs mt-0.5">
                Legacy data — archiving a process now ends its active runs automatically.
              </span>
            </div>
          </div>
        )}

        {/* ─── Attention chips ─── */}
        {hasAttention && viewFilter === 'active' && (
          <div className="flex items-center flex-wrap gap-2">
            {notStartedCount > 0 && (
              <span className="inline-flex items-center space-x-1 text-xs font-medium text-gray-600 bg-gray-100 border border-gray-200 rounded-full px-3 py-1">
                <Eye className="w-3 h-3 text-gray-400" />
                <span>Not started ({notStartedCount})</span>
              </span>
            )}
            {multipleRunsCount > 0 && (
              <span className="inline-flex items-center space-x-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1">
                <AlertTriangle className="w-3 h-3" />
                <span>Multiple active runs ({multipleRunsCount})</span>
              </span>
            )}
          </div>
        )}

        {/* ─── A) Active Runs — dominant section ─── */}
        <Card>
          <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Activity className="w-4 h-4 text-blue-500" />
              <h3 className="text-sm font-semibold text-gray-900">Active Runs</h3>
              {activeCount > 0 && (
                <Badge variant="default" className="text-xs">{activeCount}</Badge>
              )}
            </div>
          </div>

          {/* View filter pills */}
          <div className="px-5 pt-3 pb-1 flex items-center space-x-1">
            {filterTabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setViewFilter(tab.key)}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                  viewFilter === tab.key
                    ? 'bg-blue-100 text-blue-800 font-medium'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                }`}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className={`ml-1 ${viewFilter === tab.key ? 'text-blue-600' : 'text-gray-400'}`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="p-4">
            <ActiveRunsTable
              runs={filteredRuns}
              isLoading={isLoadingRuns}
              onSelectRun={onSelectRun}
              grouped={viewFilter === 'active'}
              onEndRun={onEndRun}
              onArchiveRun={onArchiveRun}
            />
          </div>
        </Card>

        {/* ─── B + C: Two-column layout ─── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* C) Upcoming Cycles */}
          <Card>
            <div className="px-5 py-3 border-b border-gray-200 flex items-center space-x-2">
              <Calendar className="w-4 h-4 text-indigo-500" />
              <h3 className="text-sm font-semibold text-gray-900">Upcoming Cycles</h3>
            </div>
            <div className="p-4">
              {upcomingCycles.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">No upcoming cycles scheduled.</p>
              ) : (
                <div className="space-y-1">
                  {upcomingCycles.map((rule: any) => {
                    const wf = rule.workflow as any
                    const cadenceLabel = wf?.cadence_timeframe && wf.cadence_timeframe !== 'persistent'
                      ? wf.cadence_timeframe.charAt(0).toUpperCase() + wf.cadence_timeframe.slice(1)
                      : null
                    return (
                      <div
                        key={rule.id}
                        className="flex items-center justify-between py-2 px-2 rounded hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex items-center space-x-2 min-w-0">
                          <div
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: getScopeColor(wf?.scope_type) }}
                          />
                          <span className="text-sm text-gray-700 truncate">
                            {wf?.name || 'Unknown'}
                          </span>
                          {cadenceLabel && (
                            <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wider flex-shrink-0">
                              {cadenceLabel}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center space-x-1 text-xs text-gray-500 flex-shrink-0 ml-2">
                          <Clock className="w-3 h-3" />
                          <span>{safeFutureRelativeTime(rule.next_run_at)}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </Card>

          {/* D) Processes (catalog) */}
          <Card>
            <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <List className="w-4 h-4 text-gray-500" />
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Processes</h3>
                </div>
                {workflows.length > 0 && (
                  <span className="text-xs text-gray-400">
                    ({showArchived ? catalogProcesses.length : workflows.length})
                  </span>
                )}
              </div>
              {archivedWorkflows.length > 0 && (
                <button
                  onClick={() => setShowArchived(!showArchived)}
                  className={`text-xs px-2 py-0.5 rounded transition-colors ${
                    showArchived
                      ? 'bg-gray-200 text-gray-700 font-medium'
                      : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {showArchived ? 'Hide archived' : 'Show archived'}
                </button>
              )}
            </div>
            <div className="p-4">
              {isLoadingWorkflows ? (
                <div className="space-y-2 opacity-40">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="h-6 bg-gray-100 rounded w-3/4" />
                  ))}
                </div>
              ) : catalogProcesses.length === 0 ? (
                <div className="text-center py-4">
                  <p className="text-sm text-gray-400">No processes defined yet.</p>
                  <Button size="sm" variant="outline" className="mt-2" onClick={onCreateWorkflow}>
                    <Plus className="w-3 h-3 mr-1" />
                    Create Process
                  </Button>
                </div>
              ) : (
                <div className="space-y-0.5 max-h-[280px] overflow-y-auto">
                  {catalogProcesses.map(workflow => {
                    // Determine if this is an archived workflow
                    const isArchived = archivedWorkflows.some(aw => aw.id === workflow.id)
                    return (
                      <button
                        key={workflow.id}
                        onClick={() => onSelectWorkflow(workflow)}
                        className="w-full flex items-center justify-between py-2 px-2 rounded hover:bg-gray-50 transition-colors text-left group"
                      >
                        <div className="flex items-center space-x-2 min-w-0">
                          <div
                            className={`w-2 h-2 rounded-full flex-shrink-0 ${isArchived ? 'opacity-40' : ''}`}
                            style={{ backgroundColor: getScopeColor(workflow.scope_type) }}
                          />
                          <span className={`text-sm truncate ${isArchived ? 'text-gray-400' : 'text-gray-700'}`}>
                            {workflow.name}
                          </span>
                          {isArchived && (
                            <span className="text-[10px] text-gray-400 font-medium">Archived</span>
                          )}
                        </div>
                        <div className="flex items-center space-x-2">
                          {getScopeBadgeLabel(workflow.scope_type) && (
                            <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">
                              {getScopeBadgeLabel(workflow.scope_type)}
                            </span>
                          )}
                          <Badge variant="outline" className={`text-xs py-0 px-1.5 ${isArchived ? 'opacity-50' : ''}`}>
                            {getCadenceBadge(workflow)}
                          </Badge>
                          <ChevronRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-500 transition-colors" />
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

// ─── Stat Tile ─────────────────────────────────────────────────────────

function StatTile({ value, label, color, bg }: { value: number; label: string; color: string; bg: string }) {
  return (
    <div className={`flex-1 rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-3 ${bg}`}>
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{value}</div>
      <div className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mt-0.5">{label}</div>
    </div>
  )
}
