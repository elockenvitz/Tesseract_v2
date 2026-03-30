/**
 * RunHistoryTable
 *
 * Shows the active run card + past runs history for a workflow.
 * Replaces BranchesView rendering in the "Runs" tab.
 *
 * "Create Run" CTA lives exclusively in the page header.
 * Empty states reference it via focus-assist link.
 */

import React, { useMemo } from 'react'
import { Play, Archive, Eye, AlertCircle, Trash2 } from 'lucide-react'
import { Card } from '../../ui/Card'
import { Button } from '../../ui/Button'
import { Badge } from '../../ui/Badge'
import { safeRelativeTime, safeFormatDate, getRunVersionLabel, getRunVersionTooltip, getScopeBadgeLabel } from '../../../utils/workflow/runHelpers'

export interface RunHistoryTableProps {
  branches: any[]
  isLoading: boolean
  canEdit: boolean
  onViewRun: (branch: any) => void
  onEndBranch: (branch: any) => void
  onArchiveBranch: (branch: any) => void
  onDeleteBranch?: (branch: any) => void
  onRestoreBranch?: (branch: any) => void
  onFilterChange?: (filter: 'all' | 'archived' | 'deleted') => void
  currentFilter?: 'all' | 'archived' | 'deleted'
  endCondition?: string | null
}

export function RunHistoryTable({
  branches,
  isLoading,
  canEdit,
  onViewRun,
  onEndBranch,
  onArchiveBranch,
  onDeleteBranch,
  onRestoreBranch,
  onFilterChange,
  currentFilter = 'all',
  endCondition,
}: RunHistoryTableProps) {
  // Separate active vs past runs
  // Branch data uses is_active/is_archived/is_deleted (mapped from DB status/archived/deleted)
  const activeBranches = useMemo(
    () => branches.filter(b => !b.is_placeholder && b.is_active && !b.is_archived && !b.is_deleted),
    [branches]
  )
  // Client-side filter for past runs based on selected tab
  const pastBranches = useMemo(() => {
    const nonPlaceholder = branches.filter(b => !b.is_placeholder && !b.is_active)
    switch (currentFilter) {
      case 'archived':
        return nonPlaceholder.filter(b => b.is_archived && !b.is_deleted)
      case 'deleted':
        return nonPlaceholder.filter(b => b.is_deleted)
      default: // 'all' = ended (not archived, not deleted)
        return nonPlaceholder.filter(b => !b.is_archived && !b.is_deleted)
    }
  }, [branches, currentFilter])
  // Check if there are any non-active branches at all (for showing the section)
  const hasAnyPastBranches = branches.some(b => !b.is_placeholder && !b.is_active)

  const activeRun = activeBranches.length > 0 ? activeBranches[0] : null
  const hasMultipleActive = activeBranches.length > 1

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <h3 className="text-lg font-semibold text-gray-900">Runs</h3>

      {/* Active Run Card */}
      {activeRun ? (
        <Card className="border-blue-200 bg-blue-50/30">
          <div className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-3">
                <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
                <h4 className="font-semibold text-gray-900">
                  {activeRun.branch_suffix || activeRun.name}
                </h4>
                {activeRun.template_version_number && (
                  <span
                    className="inline-flex items-center px-1.5 py-0 text-[10px] font-medium rounded bg-gray-100 text-gray-500 leading-4"
                    title={getRunVersionTooltip(activeRun)}
                  >
                    {getRunVersionLabel(activeRun)}
                  </span>
                )}
                <Badge variant="default" className="text-xs">Active</Badge>
                {getScopeBadgeLabel(activeRun.scope_type) && (
                  <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">
                    {getScopeBadgeLabel(activeRun.scope_type)}
                  </span>
                )}
              </div>
              <div className="flex items-center space-x-2">
                <Button size="sm" variant="outline" onClick={() => onViewRun(activeRun)}>
                  <Eye className="w-3.5 h-3.5 mr-1" />
                  View Run
                </Button>
                {canEdit && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => onEndBranch(activeRun)}>
                      End
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => onArchiveBranch(activeRun)}>
                      <Archive className="w-3.5 h-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 text-sm text-gray-600">
              <span>Started {safeRelativeTime(activeRun.branched_at || activeRun.created_at)}</span>
              {endCondition && (
                <>
                  <span className="text-gray-300">·</span>
                  <span className="text-gray-500">{endCondition}</span>
                </>
              )}
            </div>
          </div>
        </Card>
      ) : (
        <Card className="border-dashed">
          <div className="p-6 text-center">
            <Play className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500 mb-1">No active run for this process.</p>
            <p className="text-xs text-gray-400">Use the Start Run button in the header to begin a new cycle.</p>
          </div>
        </Card>
      )}

      {/* Warning if multiple active */}
      {hasMultipleActive && (
        <div className="flex items-center space-x-2 text-amber-600 text-sm bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>Multiple active runs detected ({activeBranches.length}). Consider ending older runs.</span>
        </div>
      )}

      {/* Additional active runs (if multiple) */}
      {hasMultipleActive && activeBranches.slice(1).map(branch => (
        <Card key={branch.id} className="border-amber-200">
          <div className="p-4 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-2 h-2 rounded-full bg-amber-500" />
              <span className="font-medium text-gray-900 text-sm">
                {branch.branch_suffix || branch.name}
              </span>
              <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">Active</Badge>
            </div>
            <div className="flex items-center space-x-2">
              <Button size="sm" variant="outline" onClick={() => onViewRun(branch)}>
                <Eye className="w-3.5 h-3.5 mr-1" />
                View
              </Button>
              {canEdit && (
                <Button size="sm" variant="outline" onClick={() => onEndBranch(branch)}>
                  End
                </Button>
              )}
            </div>
          </div>
        </Card>
      ))}

      {/* Past Runs Table */}
      {(hasAnyPastBranches || currentFilter !== 'all') && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-gray-500 uppercase tracking-wider">
              Past Runs {pastBranches.length > 0 && `(${pastBranches.length})`}
            </h4>
            {onFilterChange && (
              <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5 text-xs">
                {(['all', 'archived', 'deleted'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => onFilterChange(f)}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors capitalize ${
                      currentFilter === f
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {f === 'all' ? 'Ended' : f}
                  </button>
                ))}
              </div>
            )}
          </div>
          {pastBranches.length === 0 ? (
            <div className="text-center py-8 text-sm text-gray-400">
              No {currentFilter === 'all' ? 'ended' : currentFilter} runs
            </div>
          ) : (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/50">
                    <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">Run</th>
                    <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">Version</th>
                    <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">Started</th>
                    <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">Ended</th>
                    <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    {canEdit && <th className="py-2.5 px-4 w-20" />}
                  </tr>
                </thead>
                <tbody>
                  {pastBranches.map(branch => (
                    <tr
                      key={branch.id}
                      className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer group"
                      onClick={() => onViewRun(branch)}
                    >
                      <td className="py-2.5 px-4 font-medium text-gray-900">
                        {branch.branch_suffix || branch.name}
                      </td>
                      <td className="py-2.5 px-4">
                        {branch.template_version_number ? (
                          <span
                            className="text-gray-500 text-xs"
                            title={getRunVersionTooltip(branch)}
                          >
                            {getRunVersionLabel(branch)}
                          </span>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-gray-500">
                        {safeFormatDate(branch.branched_at || branch.created_at)}
                      </td>
                      <td className="py-2.5 px-4 text-gray-500">
                        {safeFormatDate(branch.ended_at || branch.archived_at || branch.deleted_at || branch.updated_at)}
                      </td>
                      <td className="py-2.5 px-4">
                        {branch.is_deleted ? (
                          <Badge variant="outline" className="text-xs text-red-600 border-red-200">Deleted</Badge>
                        ) : branch.is_archived ? (
                          <Badge variant="outline" className="text-xs text-gray-500">Archived</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs text-blue-500 border-blue-200">Ended</Badge>
                        )}
                      </td>
                      {canEdit && (
                        <td className="py-2.5 px-4">
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {!branch.is_archived && !branch.is_deleted && (
                              <button
                                onClick={(e) => { e.stopPropagation(); onArchiveBranch(branch) }}
                                className="p-1 hover:bg-amber-100 rounded transition-colors"
                                title="Archive"
                              >
                                <Archive className="w-3.5 h-3.5 text-amber-600" />
                              </button>
                            )}
                            {!branch.is_deleted && onDeleteBranch && (
                              <button
                                onClick={(e) => { e.stopPropagation(); onDeleteBranch(branch) }}
                                className="p-1 hover:bg-red-100 rounded transition-colors"
                                title="Delete"
                              >
                                <Trash2 className="w-3.5 h-3.5 text-red-600" />
                              </button>
                            )}
                            {branch.is_deleted && onRestoreBranch && (
                              <button
                                onClick={(e) => { e.stopPropagation(); onRestoreBranch(branch) }}
                                className="p-1 hover:bg-green-100 rounded transition-colors"
                                title="Restore"
                              >
                                <Play className="w-3.5 h-3.5 text-green-600" />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          )}
        </div>
      )}
    </div>
  )
}
