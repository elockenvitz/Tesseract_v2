/**
 * ActiveRunsTable
 *
 * Displays a table of runs (workflow branches) with progress metrics.
 * Supports two modes:
 *  - Flat: renders all runs as rows (used for Ended/Archived/All filters)
 *  - Grouped: one canonical run per process, expandable duplicates with
 *    End/Archive actions (used for Active filter)
 */

import React, { useState, useMemo } from 'react'
import {
  Activity,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  Square,
  Archive,
} from 'lucide-react'
import type { ActiveRun } from '../../../hooks/workflow/useActiveRuns'
import {
  safeRelativeTime,
  getRunVersionLabel,
  getRunVersionTooltip,
  groupRunsByProcess,
  getScopeRemainingLabel,
  getScopeBadgeLabel,
  type ProcessRunGroup,
} from '../../../utils/workflow/runHelpers'

export interface ActiveRunsTableProps {
  runs: ActiveRun[]
  isLoading: boolean
  onSelectRun: (run: ActiveRun) => void
  /** When true, groups runs by process (one canonical + expandable duplicates) */
  grouped?: boolean
  /** Called when admin clicks "End" on a duplicate run */
  onEndRun?: (run: ActiveRun) => void
  /** Called when admin clicks "Archive" on a duplicate run */
  onArchiveRun?: (run: ActiveRun) => void
}

/** Render progress content — truthful for 0/0, scope-aware */
function ProgressCell({ run }: { run: ActiveRun }) {
  const total = run.total_items ?? run.total_assets
  const completed = run.completed_items ?? run.completed_assets

  if (total === 0) {
    const label = getScopeRemainingLabel(run)
    return (
      <span className="text-xs text-gray-400" title="No items assigned to this run yet.">
        {label}
      </span>
    )
  }
  const pct = Math.round((completed / total) * 100)
  return (
    <div className="flex items-center space-x-2">
      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-gray-500 w-12 text-right">
        {completed}/{total}
      </span>
    </div>
  )
}

/** Render remaining cell — scope-aware label */
function RemainingCell({ run }: { run: ActiveRun }) {
  const total = run.total_items ?? run.total_assets
  const remaining = run.items_remaining ?? run.assets_remaining

  if (total === 0) {
    return <span className="text-gray-400" title="No items assigned to this run yet">—</span>
  }

  // For general scope, show "In progress" / "Complete" instead of a number
  if (run.scope_type === 'general') {
    return (
      <span className={`text-xs font-medium ${remaining > 0 ? 'text-amber-600' : 'text-green-600'}`}>
        {remaining > 0 ? 'In progress' : 'Complete'}
      </span>
    )
  }

  return (
    <span className={`font-semibold ${remaining > 0 ? 'text-amber-600' : 'text-green-600'}`}>
      {remaining}
    </span>
  )
}

/** Subtle version chip displayed next to run name */
function VersionChip({ run }: { run: ActiveRun }) {
  if (!run.template_version_number) return null
  const label = getRunVersionLabel(run)
  const tooltip = getRunVersionTooltip(run)
  return (
    <span
      className="ml-1.5 inline-flex items-center px-1.5 py-0 text-[10px] font-medium rounded bg-gray-100 text-gray-500 leading-4"
      title={tooltip}
    >
      {label}
    </span>
  )
}

/** Shared table header row */
function TableHead() {
  return (
    <thead>
      <tr className="border-b border-gray-200">
        <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Process</th>
        <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Run</th>
        <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Remaining</th>
        <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[120px]">Progress</th>
        <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Started</th>
        <th className="w-8"></th>
      </tr>
    </thead>
  )
}

/** Flat row for a single run */
function RunRow({
  run,
  onSelectRun,
  showWarning,
  indent,
  onEndRun,
  onArchiveRun,
}: {
  run: ActiveRun
  onSelectRun: (run: ActiveRun) => void
  showWarning?: boolean
  indent?: boolean
  onEndRun?: (run: ActiveRun) => void
  onArchiveRun?: (run: ActiveRun) => void
}) {
  return (
    <tr
      onClick={() => onSelectRun(run)}
      className={`border-b border-gray-100 hover:bg-blue-50/40 cursor-pointer transition-colors group ${indent ? 'bg-amber-50/30' : ''}`}
    >
      {/* Process (parent) */}
      <td className="py-2.5 px-3">
        <div className="flex items-center space-x-2">
          {indent ? (
            <div className="w-2.5 h-2.5 flex-shrink-0" /> /* spacer for indent */
          ) : (
            <div
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: run.parent_color || '#6b7280' }}
            />
          )}
          {!indent && (
            <span className="text-gray-700 truncate max-w-[160px]">{run.parent_name}</span>
          )}
          {indent && (
            <span className="text-gray-400 text-xs truncate max-w-[160px]">{run.parent_name}</span>
          )}
          {!indent && getScopeBadgeLabel(run.scope_type) && (
            <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">
              {getScopeBadgeLabel(run.scope_type)}
            </span>
          )}
          {showWarning && (
            <span
              className="inline-flex items-center text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded"
              title="Multiple active runs for this process"
            >
              <AlertTriangle className="w-3 h-3" />
            </span>
          )}
        </div>
      </td>

      {/* Run name/suffix + version chip */}
      <td className="py-2.5 px-3">
        <div className="flex items-center">
          <span className={`font-medium ${indent ? 'text-gray-500 text-xs' : 'text-gray-900'}`}>
            {run.branch_suffix || run.name}
          </span>
          {!indent && <VersionChip run={run} />}
        </div>
      </td>

      {/* Remaining */}
      <td className="py-2.5 px-3 text-right">
        <RemainingCell run={run} />
      </td>

      {/* Progress bar */}
      <td className="py-2.5 px-3">
        <ProgressCell run={run} />
      </td>

      {/* Started */}
      <td className="py-2.5 px-3 text-gray-500 text-sm">
        {safeRelativeTime(run.started_at_display)}
      </td>

      {/* Actions or chevron */}
      <td className="py-2.5 px-1">
        {indent && (onEndRun || onArchiveRun) ? (
          <div className="flex items-center space-x-1" onClick={e => e.stopPropagation()}>
            {onEndRun && (
              <button
                onClick={() => onEndRun(run)}
                className="p-1 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors"
                title="End this run"
              >
                <Square className="w-3.5 h-3.5" />
              </button>
            )}
            {onArchiveRun && (
              <button
                onClick={() => onArchiveRun(run)}
                className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                title="Archive this run"
              >
                <Archive className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors" />
        )}
      </td>
    </tr>
  )
}

/** A grouped row: canonical + expandable duplicates */
function GroupedProcessRow({
  group,
  onSelectRun,
  onEndRun,
  onArchiveRun,
}: {
  group: ProcessRunGroup
  onSelectRun: (run: ActiveRun) => void
  onEndRun?: (run: ActiveRun) => void
  onArchiveRun?: (run: ActiveRun) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const canonical = group.canonical as ActiveRun
  const duplicates = group.duplicates as ActiveRun[]
  const hasDuplicates = duplicates.length > 0

  return (
    <>
      {/* Canonical row */}
      <tr
        onClick={() => onSelectRun(canonical)}
        className="border-b border-gray-100 hover:bg-blue-50/40 cursor-pointer transition-colors group"
      >
        {/* Process (parent) */}
        <td className="py-2.5 px-3">
          <div className="flex items-center space-x-2">
            {hasDuplicates ? (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setExpanded(!expanded)
                }}
                className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-600 -ml-1 flex-shrink-0"
              >
                {expanded ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
              </button>
            ) : (
              <div className="w-4 h-4 flex-shrink-0 -ml-1" />
            )}
            <div
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: group.parentColor || '#6b7280' }}
            />
            <span className="text-gray-700 truncate max-w-[140px]">{group.parentName}</span>
            {getScopeBadgeLabel((canonical as any).scope_type) && (
              <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">
                {getScopeBadgeLabel((canonical as any).scope_type)}
              </span>
            )}
            {hasDuplicates && (
              <span
                className="inline-flex items-center space-x-1 text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded"
                title={`${duplicates.length + 1} active runs — consider ending older ones`}
              >
                <AlertTriangle className="w-3 h-3" />
                <span>{duplicates.length + 1}</span>
              </span>
            )}
          </div>
        </td>

        {/* Run name/suffix + version chip */}
        <td className="py-2.5 px-3">
          <div className="flex items-center">
            <span className="font-medium text-gray-900">
              {canonical.branch_suffix || canonical.name}
            </span>
            <VersionChip run={canonical} />
          </div>
        </td>

        {/* Remaining */}
        <td className="py-2.5 px-3 text-right">
          <RemainingCell run={canonical} />
        </td>

        {/* Progress bar */}
        <td className="py-2.5 px-3">
          <ProgressCell run={canonical} />
        </td>

        {/* Started */}
        <td className="py-2.5 px-3 text-gray-500 text-sm">
          {safeRelativeTime(canonical.started_at_display)}
        </td>

        {/* Chevron */}
        <td className="py-2.5 px-1">
          <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors" />
        </td>
      </tr>

      {/* Expanded duplicate rows */}
      {expanded && duplicates.map(dup => (
        <RunRow
          key={dup.id}
          run={dup}
          onSelectRun={onSelectRun}
          indent
          onEndRun={onEndRun}
          onArchiveRun={onArchiveRun}
        />
      ))}
    </>
  )
}

export function ActiveRunsTable({
  runs,
  isLoading,
  onSelectRun,
  grouped = false,
  onEndRun,
  onArchiveRun,
}: ActiveRunsTableProps) {
  const groups = useMemo(() => {
    if (!grouped) return []
    return groupRunsByProcess(runs)
  }, [runs, grouped])

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex items-center space-x-4 p-3">
            <div className="w-3 h-3 bg-gray-200 rounded-full" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-gray-200 rounded w-1/3" />
              <div className="h-3 bg-gray-200 rounded w-1/2" />
            </div>
            <div className="h-4 bg-gray-200 rounded w-16" />
          </div>
        ))}
      </div>
    )
  }

  if (runs.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <Activity className="w-8 h-8 mx-auto mb-2 text-gray-300" />
        <p className="text-sm font-medium text-gray-600">No active runs</p>
        <p className="text-xs text-gray-400 mt-1">Start a run from a process to begin a new cycle.</p>
      </div>
    )
  }

  // Grouped mode: one canonical row per process, expandable duplicates
  if (grouped) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <TableHead />
          <tbody>
            {groups.map(group => (
              <GroupedProcessRow
                key={group.parentWorkflowId}
                group={group}
                onSelectRun={onSelectRun}
                onEndRun={onEndRun}
                onArchiveRun={onArchiveRun}
              />
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  // Flat mode: one row per run
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <TableHead />
        <tbody>
          {runs.map(run => (
            <RunRow
              key={run.id}
              run={run}
              onSelectRun={onSelectRun}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
