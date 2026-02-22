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
import { Play, Archive, Eye, AlertCircle } from 'lucide-react'
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
}

export function RunHistoryTable({
  branches,
  isLoading,
  canEdit,
  onViewRun,
  onEndBranch,
  onArchiveBranch,
}: RunHistoryTableProps) {
  // Separate active vs past runs
  // Branch data uses is_active/is_archived/is_deleted (mapped from DB status/archived/deleted)
  const activeBranches = useMemo(
    () => branches.filter(b => !b.is_placeholder && b.is_active && !b.is_archived && !b.is_deleted),
    [branches]
  )
  const pastBranches = useMemo(
    () => branches.filter(b => !b.is_placeholder && (b.is_archived || b.is_deleted || !b.is_active)),
    [branches]
  )

  const activeRun = activeBranches.length > 0 ? activeBranches[0] : null
  const hasMultipleActive = activeBranches.length > 1

  if (isLoading) {
    return (
      <div className="p-6 space-y-6 animate-pulse">
        <Card>
          <div className="p-6 space-y-3">
            <div className="h-6 bg-gray-200 rounded w-1/3" />
            <div className="h-4 bg-gray-200 rounded w-2/3" />
            <div className="h-8 bg-gray-200 rounded w-24 mt-4" />
          </div>
        </Card>
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 bg-gray-200 rounded" />
          ))}
        </div>
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
                <span
                  className="inline-flex items-center px-1.5 py-0 text-[10px] font-medium rounded bg-gray-100 text-gray-500 leading-4"
                  title={getRunVersionTooltip(activeRun)}
                >
                  {getRunVersionLabel(activeRun)}
                </span>
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
            <div className="text-sm text-gray-600">
              Started {safeRelativeTime(activeRun.branched_at || activeRun.created_at)}
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
      {pastBranches.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">
            Past Runs ({pastBranches.length})
          </h4>
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
                        <span
                          className="text-gray-500 text-xs"
                          title={getRunVersionTooltip(branch)}
                        >
                          {getRunVersionLabel(branch)}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-gray-500">
                        {safeFormatDate(branch.branched_at || branch.created_at)}
                      </td>
                      <td className="py-2.5 px-4 text-gray-500">
                        {safeFormatDate(branch.archived_at || branch.deleted_at || branch.updated_at)}
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
