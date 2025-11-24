/**
 * BranchesView Component
 *
 * Complete Branches tab view for workflows.
 * Displays hierarchical tree of workflow branches organized by template version.
 *
 * Extracted from WorkflowsPage.tsx during Phase 3 refactoring.
 */

import React from 'react'
import { GitBranch, Plus, ChevronRight, ChevronDown, Eye, Play, Pause, Archive, ArchiveX, Trash2, RotateCcw, Edit3, Orbit, Copy, Network, PenLine } from 'lucide-react'
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
  template_version_number?: number | string

  // Statistics
  total_assets?: number
  active_assets?: number
  completed_assets?: number

  // Flag for placeholder entries (template versions with no branches)
  is_placeholder?: boolean
}

export interface BranchesViewProps {
  /** All branches for this workflow */
  branches?: WorkflowBranch[]

  /** Status filter ('all', 'archived', 'deleted') */
  statusFilter?: 'all' | 'archived' | 'deleted'

  /** Set of collapsed branch IDs for tree display */
  collapsedBranches?: Set<string>

  /** Set of collapsed template version IDs */
  collapsedTemplateVersions?: Set<string>

  /** Whether user has admin permission */
  canEdit?: boolean

  /** Loading state */
  isLoading?: boolean

  /** Callbacks for filter changes */
  onStatusFilterChange?: (filter: 'all' | 'archived' | 'deleted') => void

  /** Callbacks for tree operations */
  onToggleCollapse?: (branchId: string) => void
  onToggleTemplateCollapse?: (versionNumber: string) => void

  /** Callbacks for branch operations */
  onCreateBranch?: (parentBranchId?: string, templateVersion?: string) => void
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
  collapsedTemplateVersions = new Set(),
  canEdit = false,
  isLoading = false,
  onStatusFilterChange,
  onToggleCollapse,
  onToggleTemplateCollapse,
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
  // Group branches by template version
  const branchesByVersion = React.useMemo(() => {
    const versionMap = new Map<string, WorkflowBranch[]>()

    branches.forEach(branch => {
      // Use '1.0' as default version for branches without a version number
      const version = branch.template_version_number?.toString() || '1.0'
      if (!versionMap.has(version)) {
        versionMap.set(version, [])
      }
      versionMap.get(version)!.push(branch)
    })

    // Filter out versions with no branches
    const filteredVersions = Array.from(versionMap.entries())
      .filter(([version, versionBranches]) => {
        // Must have at least one branch
        return versionBranches.length > 0
      })

    // Sort versions descending (handle decimal versions like 1.2, 1.1, 1.0)
    return filteredVersions.sort(([a], [b]) => {
      const numA = parseFloat(a)
      const numB = parseFloat(b)
      return numB - numA
    })
  }, [branches])

  // Build hierarchy for a set of branches
  const buildBranchTree = (branches: WorkflowBranch[]) => {
    // Filter out placeholder entries - they're only for showing template versions
    const realBranches = branches.filter(b => !b.is_placeholder)

    // Create a set of all branch IDs in this filtered set
    const branchIds = new Set(realBranches.map(b => b.id))

    // A branch is "root" if it has no parent OR if its parent is not in this filtered set
    const rootBranches = realBranches.filter(b =>
      !b.parent_branch_id || !branchIds.has(b.parent_branch_id)
    )
    const childMap = new Map<string, WorkflowBranch[]>()

    realBranches.forEach(branch => {
      if (branch.parent_branch_id && branchIds.has(branch.parent_branch_id)) {
        const siblings = childMap.get(branch.parent_branch_id) || []
        siblings.push(branch)
        childMap.set(branch.parent_branch_id, siblings)
      }
    })

    return { rootBranches, childMap }
  }

  // Render tree connection lines
  const renderTreeLines = (level: number, isLast: boolean, hasChildren: boolean) => {
    if (level === 0) return null

    return (
      <div className="flex items-center mr-3">
        <div className="w-6 relative"></div>
        <div className="relative w-6 h-6">
          {/* Vertical line from top */}
          <div className="absolute left-3 top-0 h-3 w-0.5 bg-gray-300"></div>
          {/* Horizontal line to branch */}
          <div className="absolute left-3 top-3 w-6 h-0.5 bg-gray-300"></div>
          {/* Vertical line continuing down (if not last) */}
          {!isLast && (
            <div
              className="absolute left-3 top-3 bottom-0 w-0.5 bg-gray-300"
              style={{ height: 'calc(100% + 1rem)' }}
            ></div>
          )}
        </div>
      </div>
    )
  }

  // Render branch card
  const renderBranchCard = (branch: WorkflowBranch, level: number = 0, isLast: boolean = false) => {
    const hasChildren = branches.some(b => b.parent_branch_id === branch.id)
    const isCollapsed = collapsedBranches.has(branch.id)
    const children = branches.filter(b => b.parent_branch_id === branch.id)

    // Get icon based on branch type
    const BranchIcon = branch.parent_branch_id ? Copy : Network

    // Only show collapse button for clean branches (not copied branches)
    const showCollapseButton = hasChildren && !branch.parent_branch_id && onToggleCollapse

    return (
      <div key={branch.id}>
        <div className="flex items-start">
          {/* Tree lines for hierarchy */}
          {level > 0 && renderTreeLines(level, isLast, hasChildren)}

          {/* Collapse button - only for clean branches with children */}
          {showCollapseButton ? (
            <button
              onClick={() => onToggleCollapse(branch.id)}
              className="flex-shrink-0 mr-2 mt-3 p-1 hover:bg-gray-100 rounded transition-colors"
              title={isCollapsed ? 'Expand branch' : 'Collapse branch'}
            >
              {isCollapsed ? (
                <ChevronRight className="w-4 h-4 text-gray-500" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-500" />
              )}
            </button>
          ) : (
            <div className="w-6 mr-2"></div>
          )}

          {/* Branch card */}
          <div className="flex-1 mb-4">
            <div className="rounded-lg p-3 hover:shadow-md transition-shadow bg-gray-50 border-2 border-gray-300">
              <div className="flex items-start justify-between">
                {/* Branch info */}
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <BranchIcon className={`w-4 h-4 flex-shrink-0 ${branch.parent_branch_id ? 'text-blue-600' : 'text-purple-600'}`} />

                    <button
                      className="text-sm font-semibold hover:text-indigo-600 transition-colors cursor-pointer text-gray-600"
                      onClick={() => onViewBranch?.(branch)}
                    >
                      {branch.branch_name.replace(/\s*-\s*$/, '')}
                    </button>

                    {/* Suffix with edit button */}
                    <div className="flex items-center space-x-1 group">
                      <span className="text-xs text-gray-500 font-normal">
                        ({branch.branch_suffix || 'No suffix'})
                      </span>
                      {canEdit && !branch.is_archived && !branch.is_deleted && onEditSuffix && (
                        <button
                          onClick={() => onEditSuffix(branch.id, branch.branch_suffix || '')}
                          className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-gray-200 rounded transition-opacity"
                        >
                          <PenLine className="w-3 h-3 text-gray-400" />
                        </button>
                      )}
                    </div>

                    {/* Status badge */}
                    <span className={`px-2 py-0.5 rounded-full text-xs flex items-center space-x-1 ${
                      branch.is_active
                        ? 'bg-green-100 text-green-600 border-green-300'
                        : 'bg-gray-100 text-gray-600 border-gray-300'
                    }`}>
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                        <path d="m9 11 3 3L22 4"></path>
                      </svg>
                      <span className="capitalize">{branch.is_active ? 'active' : 'inactive'}</span>
                    </span>
                  </div>

                  {/* Branch details */}
                  <div className="space-y-1 ml-6">
                    {/* Copied branch indicator */}
                    {branch.parent_branch_id && (
                      <div className="flex items-center space-x-1.5 text-xs text-blue-600">
                        <Copy className="w-3 h-3" />
                        <span className="font-medium">Copied branch with data from parent</span>
                      </div>
                    )}

                    {/* Created date */}
                    <div className="flex items-center gap-3 text-xs text-gray-600">
                      <span>Created {new Date(branch.created_at).toLocaleDateString()}</span>
                    </div>

                    {/* Asset statistics */}
                    {branch.total_assets !== undefined && (
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-gray-600">{branch.total_assets} total assets:</span>
                        {branch.active_assets !== undefined && branch.active_assets > 0 && (
                          <span className="text-green-600 font-medium">{branch.active_assets} active</span>
                        )}
                        {branch.completed_assets !== undefined && (
                          <span className="text-blue-600 font-medium">{branch.completed_assets} completed</span>
                        )}
                      </div>
                    )}

                    {/* Archived/deleted info */}
                    {branch.is_archived && branch.archived_at && (
                      <p className="text-xs text-orange-600">
                        Archived {new Date(branch.archived_at).toLocaleDateString()}
                      </p>
                    )}
                    {branch.is_deleted && branch.deleted_at && (
                      <p className="text-xs text-red-600">
                        Deleted {new Date(branch.deleted_at).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>

                {/* Action buttons */}
                {canEdit && (
                  <div className="flex items-center space-x-1">
                    {/* Create sub-branch */}
                    {!branch.is_deleted && !branch.is_archived && onCreateBranch && branch.branch_level < 2 && (
                      <button
                        onClick={() => onCreateBranch(branch.id)}
                        className="p-1.5 hover:bg-gray-100 rounded transition-colors"
                        title="Create branch from this workflow"
                      >
                        <GitBranch className="w-4 h-4 text-gray-600" />
                      </button>
                    )}

                    {/* Continue (activate) */}
                    {!branch.is_deleted && !branch.is_archived && !branch.is_active && onContinueBranch && (
                      <button
                        onClick={() => onContinueBranch(branch)}
                        className="p-1.5 hover:bg-green-100 rounded transition-colors"
                        title="Continue this branch"
                      >
                        <Play className="w-4 h-4 text-green-600" />
                      </button>
                    )}

                    {/* End (deactivate) */}
                    {!branch.is_deleted && !branch.is_archived && branch.is_active && onEndBranch && (
                      <button
                        onClick={() => onEndBranch(branch)}
                        className="p-1.5 hover:bg-gray-100 rounded transition-colors"
                        title="End this branch"
                      >
                        <Pause className="w-4 h-4 text-gray-600" />
                      </button>
                    )}

                    {/* Archive */}
                    {!branch.is_deleted && !branch.is_archived && onArchiveBranch && (
                      <button
                        onClick={() => onArchiveBranch(branch)}
                        className="p-1.5 hover:bg-amber-100 rounded transition-colors"
                        title="Archive this branch"
                      >
                        <Archive className="w-4 h-4 text-amber-600" />
                      </button>
                    )}

                    {/* Unarchive */}
                    {!branch.is_deleted && branch.is_archived && onUnarchiveBranch && (
                      <button
                        onClick={() => onUnarchiveBranch(branch)}
                        className="p-1.5 hover:bg-blue-100 rounded transition-colors"
                        title="Unarchive this branch"
                      >
                        <ArchiveX className="w-4 h-4 text-blue-600" />
                      </button>
                    )}

                    {/* Delete */}
                    {!branch.is_deleted && onDeleteBranch && (
                      <button
                        onClick={() => onDeleteBranch(branch)}
                        className="p-1.5 hover:bg-red-100 rounded transition-colors"
                        title="Delete this branch"
                      >
                        <Trash2 className="w-4 h-4 text-red-600" />
                      </button>
                    )}

                    {/* Restore */}
                    {branch.is_deleted && onRestoreBranch && (
                      <button
                        onClick={() => onRestoreBranch(branch)}
                        className="p-1.5 hover:bg-green-100 rounded transition-colors"
                        title="Restore this branch"
                      >
                        <RotateCcw className="w-4 h-4 text-green-600" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Render children if not collapsed */}
        {hasChildren && !isCollapsed && (
          <div>
            {children.map((child, idx) =>
              renderBranchCard(child, level + 1, idx === children.length - 1)
            )}
          </div>
        )}
      </div>
    )
  }

  // Render template version section
  const renderTemplateVersion = (versionNumber: string, versionBranches: WorkflowBranch[]) => {
    const isCollapsed = collapsedTemplateVersions.has(versionNumber)
    const { rootBranches } = buildBranchTree(versionBranches)
    // Don't count placeholder entries as branches
    const branchCount = versionBranches.filter(b => !b.is_placeholder).length

    return (
      <div key={versionNumber} className="mb-3">
        <div className="bg-indigo-50 border-2 border-indigo-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 flex-1">
              {/* Collapse button */}
              {onToggleTemplateCollapse && (
                <button
                  onClick={() => onToggleTemplateCollapse(versionNumber)}
                  className="flex-shrink-0 p-1 hover:bg-indigo-200 rounded transition-colors"
                >
                  {isCollapsed ? (
                    <ChevronRight className="w-4 h-4 text-indigo-600" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-indigo-600" />
                  )}
                </button>
              )}

              <Orbit className="w-5 h-5 text-indigo-600" />
              <h3 className="text-base font-semibold text-indigo-900">
                {versionBranches[0]?.branch_name?.split(' - ')[0] || 'Workflow'}
              </h3>
              <span className="px-2 py-0.5 rounded-full text-xs bg-indigo-200 text-indigo-800">
                Template v{versionNumber}
              </span>
              {versionBranches[0]?.is_active && (
                <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 border border-green-300">
                  Active
                </span>
              )}
            </div>

            {/* Branch from template button */}
            {canEdit && onCreateBranch && (
              <button
                onClick={() => onCreateBranch(undefined, versionNumber)}
                className="inline-flex items-center justify-center font-medium rounded-lg transition-colors px-3 py-1.5 text-sm border border-indigo-300 bg-white text-indigo-700 hover:bg-indigo-100"
              >
                <GitBranch className="w-3 h-3 mr-1" />
                Branch
              </button>
            )}
          </div>
          <p className="text-xs text-indigo-700 mt-2 ml-11">
            Template version • {branchCount} {branchCount === 1 ? 'branch' : 'branches'}
          </p>
        </div>

        {/* Render branches for this version */}
        {!isCollapsed && branchCount > 0 && (
          <div className="ml-4 mt-2">
            {rootBranches.length > 0 ? (
              rootBranches.map((branch, idx) =>
                renderBranchCard(branch, 0, idx === rootBranches.length - 1)
              )
            ) : (
              <div className="text-sm text-gray-500 italic ml-6">
                No branches to display
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <h3 className="text-lg font-semibold text-gray-900">Workflow Branches</h3>

      {/* Status Filter */}
      {onStatusFilterChange && (
        <div className="flex items-center space-x-2 border-b border-gray-200">
          {(['all', 'archived', 'deleted'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => onStatusFilterChange(filter)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                statusFilter === filter
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {filter === 'all' ? 'All' : filter.charAt(0).toUpperCase() + filter.slice(1)}
            </button>
          ))}
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="text-sm text-gray-500 mt-2">Loading branches...</p>
        </div>
      )}

      {/* Branches organized by template version */}
      {!isLoading && branchesByVersion.length > 0 && (
        <Card>
          <div className="p-4">
            <div className="space-y-2">
              {branchesByVersion.map(([versionNumber, versionBranches]) =>
                renderTemplateVersion(versionNumber, versionBranches)
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Empty State */}
      {!isLoading && branchesByVersion.length === 0 && (
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
