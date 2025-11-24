/**
 * BranchesView Component
 *
 * Complete Branches tab view for workflows.
 * Displays hierarchical tree of workflow branches with management controls.
 *
 * Extracted from WorkflowsPage.tsx during Phase 3 refactoring.
 */

import React from 'react'
import { GitBranch, Plus, ChevronRight, ChevronDown, Eye, Play, Pause, Archive, ArchiveX, Trash2, RotateCcw, Edit3 } from 'lucide-react'
import { Card } from '../../ui/Card'
import { Button } from '../../ui/Button'

export type BranchStatus = 'active' | 'inactive' | 'archived' | 'deleted'

export interface WorkflowBranch {
  id: string
  workflow_id: string
  branch_name: string
  branch_suffix?: string
  parent_branch_id?: string
  branch_level: number
  is_active: boolean
  is_clean: boolean
  is_archived: boolean
  is_deleted: boolean
  created_at: string
  created_by: string
  archived_at?: string
  archived_by?: string
  deleted_at?: string
  deleted_by?: string
  template_version_number?: number

  // Statistics
  total_assets?: number
  active_assets?: number
  completed_assets?: number
}

export interface BranchesViewProps {
  /** All branches for this workflow */
  branches?: WorkflowBranch[]

  /** Status filter ('all', 'archived', 'deleted') */
  statusFilter?: 'all' | 'archived' | 'deleted'

  /** Set of collapsed branch IDs for tree display */
  collapsedBranches?: Set<string>

  /** Whether user has admin permission */
  canEdit?: boolean

  /** Loading state */
  isLoading?: boolean

  /** Callbacks for filter changes */
  onStatusFilterChange?: (filter: 'all' | 'archived' | 'deleted') => void

  /** Callbacks for tree operations */
  onToggleCollapse?: (branchId: string) => void

  /** Callbacks for branch operations */
  onCreateBranch?: (parentBranchId?: string) => void
  onViewBranch?: (branch: WorkflowBranch) => void
  onEditSuffix?: (branchId: string, currentSuffix: string) => void
  onEndBranch?: (branch: WorkflowBranch) => void
  onContinueBranch?: (branch: WorkflowBranch) => void
  onArchiveBranch?: (branch: WorkflowBranch) => void
  onUnarchiveBranch?: (branch: WorkflowBranch) => void
  onDeleteBranch?: (branch: WorkflowBranch) => void
  onRestoreBranch?: (branch: WorkflowBranch) => void
}

export function BranchesView({
  branches = [],
  statusFilter = 'all',
  collapsedBranches = new Set(),
  canEdit = false,
  isLoading = false,
  onStatusFilterChange,
  onToggleCollapse,
  onCreateBranch,
  onViewBranch,
  onEditSuffix,
  onEndBranch,
  onContinueBranch,
  onArchiveBranch,
  onUnarchiveBranch,
  onDeleteBranch,
  onRestoreBranch
}: BranchesViewProps) {
  // Build hierarchy
  const buildBranchTree = (branches: WorkflowBranch[]) => {
    const rootBranches = branches.filter(b => !b.parent_branch_id)
    const childMap = new Map<string, WorkflowBranch[]>()

    branches.forEach(branch => {
      if (branch.parent_branch_id) {
        const siblings = childMap.get(branch.parent_branch_id) || []
        siblings.push(branch)
        childMap.set(branch.parent_branch_id, siblings)
      }
    })

    return { rootBranches, childMap }
  }

  const { rootBranches, childMap } = buildBranchTree(branches)

  // Render branch card
  const renderBranchCard = (branch: WorkflowBranch, level: number = 0) => {
    const hasChildren = childMap.has(branch.id)
    const isCollapsed = collapsedBranches.has(branch.id)
    const children = childMap.get(branch.id) || []

    return (
      <div key={branch.id} style={{ marginLeft: level * 24 }}>
        <Card className="mb-2">
          <div className="p-4">
            <div className="flex items-start justify-between">
              {/* Branch Info */}
              <div className="flex items-start space-x-3 flex-1">
                {/* Collapse Toggle */}
                {hasChildren && onToggleCollapse && (
                  <button
                    onClick={() => onToggleCollapse(branch.id)}
                    className="mt-1 text-gray-400 hover:text-gray-600"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </button>
                )}
                {!hasChildren && <div className="w-4" />}

                {/* Branch Icon */}
                <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-0.5 ${
                  branch.is_active ? 'bg-green-100' : 'bg-gray-100'
                }`}>
                  <GitBranch className={`w-4 h-4 ${branch.is_active ? 'text-green-600' : 'text-gray-400'}`} />
                </div>

                {/* Branch Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2 mb-1">
                    <h5 className="text-sm font-medium text-gray-900">
                      {branch.branch_name}
                      {branch.branch_suffix && ` - ${branch.branch_suffix}`}
                    </h5>

                    {/* Status Badges */}
                    {branch.is_active ? (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 border border-green-300">
                        Active
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700 border border-gray-300">
                        Inactive
                      </span>
                    )}

                    {branch.is_clean && (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700 border border-blue-300">
                        Clean
                      </span>
                    )}

                    {branch.is_archived && (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-orange-100 text-orange-700 border border-orange-300">
                        Archived
                      </span>
                    )}

                    {branch.is_deleted && (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700 border border-red-300">
                        Deleted
                      </span>
                    )}
                  </div>

                  {/* Statistics */}
                  <div className="flex items-center space-x-4 text-xs text-gray-500">
                    <span>Created {new Date(branch.created_at).toLocaleDateString()}</span>
                    {branch.total_assets !== undefined && (
                      <>
                        <span>•</span>
                        <span>{branch.total_assets} assets</span>
                      </>
                    )}
                    {branch.active_assets !== undefined && branch.active_assets > 0 && (
                      <>
                        <span>•</span>
                        <span className="text-orange-600">{branch.active_assets} active</span>
                      </>
                    )}
                    {branch.template_version_number && (
                      <>
                        <span>•</span>
                        <span>v{branch.template_version_number}</span>
                      </>
                    )}
                  </div>

                  {branch.is_archived && branch.archived_at && (
                    <p className="text-xs text-orange-600 mt-1">
                      Archived {new Date(branch.archived_at).toLocaleDateString()}
                    </p>
                  )}

                  {branch.is_deleted && branch.deleted_at && (
                    <p className="text-xs text-red-600 mt-1">
                      Deleted {new Date(branch.deleted_at).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>

              {/* Actions */}
              {canEdit && (
                <div className="flex items-center space-x-1 ml-2">
                  {onViewBranch && (
                    <Button
                      size="xs"
                      variant="outline"
                      title="View Details"
                      onClick={() => onViewBranch(branch)}
                    >
                      <Eye className="w-3 h-3" />
                    </Button>
                  )}

                  {!branch.is_deleted && !branch.is_archived && onCreateBranch && branch.branch_level < 2 && (
                    <Button
                      size="xs"
                      variant="outline"
                      title="Create Sub-Branch"
                      onClick={() => onCreateBranch(branch.id)}
                    >
                      <Plus className="w-3 h-3" />
                    </Button>
                  )}

                  {!branch.is_deleted && !branch.is_archived && branch.branch_suffix && onEditSuffix && (
                    <Button
                      size="xs"
                      variant="outline"
                      title="Edit Suffix"
                      onClick={() => onEditSuffix(branch.id, branch.branch_suffix || '')}
                    >
                      <Edit3 className="w-3 h-3" />
                    </Button>
                  )}

                  {!branch.is_deleted && !branch.is_archived && branch.is_active && onEndBranch && (
                    <Button
                      size="xs"
                      variant="outline"
                      title="End (Deactivate)"
                      onClick={() => onEndBranch(branch)}
                    >
                      <Pause className="w-3 h-3" />
                    </Button>
                  )}

                  {!branch.is_deleted && !branch.is_archived && !branch.is_active && onContinueBranch && (
                    <Button
                      size="xs"
                      variant="outline"
                      title="Continue (Reactivate)"
                      onClick={() => onContinueBranch(branch)}
                    >
                      <Play className="w-3 h-3" />
                    </Button>
                  )}

                  {!branch.is_deleted && !branch.is_archived && onArchiveBranch && (
                    <Button
                      size="xs"
                      variant="outline"
                      title="Archive"
                      onClick={() => onArchiveBranch(branch)}
                    >
                      <Archive className="w-3 h-3" />
                    </Button>
                  )}

                  {!branch.is_deleted && branch.is_archived && onUnarchiveBranch && (
                    <Button
                      size="xs"
                      variant="outline"
                      title="Unarchive"
                      onClick={() => onUnarchiveBranch(branch)}
                    >
                      <ArchiveX className="w-3 h-3" />
                    </Button>
                  )}

                  {!branch.is_deleted && onDeleteBranch && (
                    <Button
                      size="xs"
                      variant="outline"
                      title="Delete"
                      onClick={() => onDeleteBranch(branch)}
                    >
                      <Trash2 className="w-3 h-3 text-red-600" />
                    </Button>
                  )}

                  {branch.is_deleted && onRestoreBranch && (
                    <Button
                      size="xs"
                      variant="outline"
                      title="Restore"
                      onClick={() => onRestoreBranch(branch)}
                    >
                      <RotateCcw className="w-3 h-3 text-green-600" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* Render children if not collapsed */}
        {hasChildren && !isCollapsed && children.map(child => renderBranchCard(child, level + 1))}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Workflow Branches</h3>
          <p className="text-sm text-gray-500 mt-1">
            Manage branch hierarchy and versions
          </p>
        </div>
        {canEdit && onCreateBranch && (
          <Button onClick={() => onCreateBranch()}>
            <Plus className="w-4 h-4 mr-2" />
            Create Branch
          </Button>
        )}
      </div>

      {/* Status Filter */}
      {onStatusFilterChange && (
        <div className="flex items-center space-x-2">
          <span className="text-sm text-gray-700 font-medium">Show:</span>
          <div className="flex space-x-1">
            {(['all', 'archived', 'deleted'] as const).map((filter) => (
              <button
                key={filter}
                onClick={() => onStatusFilterChange(filter)}
                className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                  statusFilter === filter
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {filter === 'all' ? 'All' : filter.charAt(0).toUpperCase() + filter.slice(1)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="text-sm text-gray-500 mt-2">Loading branches...</p>
        </div>
      )}

      {/* Branch Tree */}
      {!isLoading && rootBranches.length > 0 && (
        <div>
          {rootBranches.map(branch => renderBranchCard(branch, 0))}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && rootBranches.length === 0 && (
        <div className="text-center py-12 bg-gray-50 rounded-lg border border-dashed border-gray-300">
          <div className="max-w-md mx-auto">
            <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <GitBranch className="w-6 h-6 text-gray-400" />
            </div>
            <h4 className="text-lg font-medium text-gray-900 mb-2">No branches yet</h4>
            <p className="text-sm text-gray-500 mb-4">
              {statusFilter === 'all'
                ? 'Create your first workflow branch to start managing versions and variations.'
                : `No ${statusFilter} branches found.`}
            </p>
            {canEdit && onCreateBranch && statusFilter === 'all' && (
              <Button onClick={() => onCreateBranch()}>
                <Plus className="w-4 h-4 mr-2" />
                Create First Branch
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
