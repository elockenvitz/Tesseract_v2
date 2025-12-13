/**
 * BranchesView Component
 *
 * Complete Branches tab view for workflows.
 * Displays hierarchical tree of workflow branches organized by template version.
 *
 * Extracted from WorkflowsPage.tsx during Phase 3 refactoring.
 */

import React, { useState, useMemo } from 'react'
import { GitBranch, Plus, ChevronRight, ChevronDown, Eye, Play, Pause, Archive, ArchiveX, Trash2, RotateCcw, Edit3, Orbit, Copy, Network, PenLine, Check, X, Loader2, Clock, GitCompare } from 'lucide-react'
import { Card } from '../../ui/Card'
import { Button } from '../../ui/Button'
import { formatVersion } from '../../../lib/versionUtils'
import { VersionComparisonModal } from '../../modals/VersionComparisonModal'

/** Generate a high-level change summary comparing a version with the previous one */
function generateChangeSummary(
  currentVersion: TemplateVersion,
  previousVersion: TemplateVersion | null
): string {
  // Only show "Initial version" for the actual first version
  if (!previousVersion && currentVersion.version_number === 1) {
    const stageCount = currentVersion.stages?.length || 0
    const checklistCount = currentVersion.checklist_templates?.length || 0
    return `Initial version with ${stageCount} stages and ${checklistCount} checklist items`
  }

  // If no previous version found but not version 1, fall back to description
  if (!previousVersion) {
    return currentVersion.description || 'New major version'
  }

  const changes: string[] = []

  // Compare stages (handle both property naming conventions)
  const oldStages = previousVersion.stages || []
  const newStages = currentVersion.stages || []

  const getStageKey = (s: any) => s.stage_key || s.key || s.id
  const getStageName = (s: any) => s.stage_label || s.name
  const getStageColor = (s: any) => s.stage_color || s.color
  const getStageOrder = (s: any) => s.sort_order ?? s.order_index

  const oldStageKeys = new Set(oldStages.map((s: any) => getStageKey(s)))
  const newStageKeys = new Set(newStages.map((s: any) => getStageKey(s)))

  const addedStages = newStages.filter((s: any) => !oldStageKeys.has(getStageKey(s))).length
  const removedStages = oldStages.filter((s: any) => !newStageKeys.has(getStageKey(s))).length
  const modifiedStages = newStages.filter((s: any) => {
    const key = getStageKey(s)
    const oldStage = oldStages.find((os: any) => getStageKey(os) === key)
    if (!oldStage) return false
    return getStageName(oldStage) !== getStageName(s) ||
           getStageColor(oldStage) !== getStageColor(s) ||
           getStageOrder(oldStage) !== getStageOrder(s)
  }).length

  if (addedStages > 0) changes.push(`+${addedStages} stage${addedStages > 1 ? 's' : ''}`)
  if (removedStages > 0) changes.push(`-${removedStages} stage${removedStages > 1 ? 's' : ''}`)
  if (modifiedStages > 0) changes.push(`${modifiedStages} stage${modifiedStages > 1 ? 's' : ''} modified`)

  // Compare checklists
  const oldChecklists = previousVersion.checklist_templates || []
  const newChecklists = currentVersion.checklist_templates || []

  const getChecklistKey = (c: any) => c.item_id || `${c.item_text}-${c.stage_id}`
  const oldChecklistMap = new Map(oldChecklists.map((c: any) => [getChecklistKey(c), c]))
  const newChecklistMap = new Map(newChecklists.map((c: any) => [getChecklistKey(c), c]))

  const addedChecklists = newChecklists.filter((c: any) => !oldChecklistMap.has(getChecklistKey(c))).length
  const removedChecklists = oldChecklists.filter((c: any) => !newChecklistMap.has(getChecklistKey(c))).length

  // Check for modified checklists (reordered, moved to different stage, text changed, etc.)
  const modifiedChecklists = newChecklists.filter((newItem: any) => {
    const key = getChecklistKey(newItem)
    const oldItem = oldChecklistMap.get(key)
    if (!oldItem) return false
    return oldItem.sort_order !== newItem.sort_order ||
           oldItem.stage_id !== newItem.stage_id ||
           oldItem.item_text !== newItem.item_text ||
           oldItem.is_required !== newItem.is_required
  }).length

  if (addedChecklists > 0) changes.push(`+${addedChecklists} checklist item${addedChecklists > 1 ? 's' : ''}`)
  if (removedChecklists > 0) changes.push(`-${removedChecklists} checklist item${removedChecklists > 1 ? 's' : ''}`)
  if (modifiedChecklists > 0) changes.push(`${modifiedChecklists} checklist item${modifiedChecklists > 1 ? 's' : ''} updated`)

  // Compare automation rules
  const oldRules = previousVersion.automation_rules || []
  const newRules = currentVersion.automation_rules || []
  if (oldRules.length !== newRules.length || JSON.stringify(oldRules) !== JSON.stringify(newRules)) {
    const diff = newRules.length - oldRules.length
    if (diff > 0) changes.push(`+${diff} automation rule${diff > 1 ? 's' : ''}`)
    else if (diff < 0) changes.push(`${diff} automation rule${Math.abs(diff) > 1 ? 's' : ''}`)
    else changes.push('automation rules updated')
  }

  // Compare universe rules
  const oldUniverse = (previousVersion as any).universe_rules || []
  const newUniverse = (currentVersion as any).universe_rules || []
  if (oldUniverse.length !== newUniverse.length || JSON.stringify(oldUniverse) !== JSON.stringify(newUniverse)) {
    const diff = newUniverse.length - oldUniverse.length
    if (diff > 0) changes.push(`+${diff} universe rule${diff > 1 ? 's' : ''}`)
    else if (diff < 0) changes.push(`${diff} universe rule${Math.abs(diff) > 1 ? 's' : ''}`)
    else changes.push('universe rules updated')
  }

  // Compare cadence settings
  const oldCadence = (previousVersion as any).cadence_timeframe
  const newCadence = (currentVersion as any).cadence_timeframe
  const oldKickoff = (previousVersion as any).kickoff_cadence
  const newKickoff = (currentVersion as any).kickoff_cadence
  if (oldCadence !== newCadence || oldKickoff !== newKickoff) {
    changes.push('cadence updated')
  }

  if (changes.length === 0) {
    // Truly no detected changes - describe current state
    const stageCount = currentVersion.stages?.length || 0
    const checklistCount = currentVersion.checklist_templates?.length || 0
    return `${stageCount} stages, ${checklistCount} checklists`
  }

  return changes.join(', ')
}

export type BranchStatus = 'active' | 'inactive' | 'archived' | 'deleted'

export interface TemplateVersion {
  id: string
  workflow_id: string
  version_number: number
  major_version?: number | null
  minor_version?: number | null
  version_name: string | null
  version_type?: 'major' | 'minor'
  description: string | null
  is_active: boolean
  created_at: string
  created_by: string
  stages: any[]
  checklist_templates: any[]
  automation_rules: any[]
}

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

  /** The current workflow name - used for display instead of extracting from branch names */
  workflowName?: string

  /** Status filter ('all', 'archived', 'deleted', 'history') */
  statusFilter?: 'all' | 'archived' | 'deleted' | 'history'

  /** Template versions for history view */
  templateVersions?: TemplateVersion[]

  /** Set of collapsed branch IDs for tree display */
  collapsedBranches?: Set<string>

  /** Set of collapsed template version IDs */
  collapsedTemplateVersions?: Set<string>

  /** Whether user has admin permission */
  canEdit?: boolean

  /** Loading state */
  isLoading?: boolean

  /** Callbacks for filter changes */
  onStatusFilterChange?: (filter: 'all' | 'archived' | 'deleted' | 'history') => void

  /** History view callbacks */
  onViewVersion?: (versionId: string) => void
  onActivateVersion?: (versionId: string) => void
  onCreateVersion?: () => void
  canActivateVersion?: boolean

  /** Callbacks for tree operations */
  onToggleCollapse?: (branchId: string) => void
  onToggleTemplateCollapse?: (versionNumber: string) => void

  /** Callbacks for branch operations */
  onCreateBranch?: (parentBranchId?: string, templateVersion?: string) => void
  onViewBranch?: (branch: WorkflowBranch) => void
  onEndBranch?: (branch: WorkflowBranch) => void
  onContinueBranch?: (branch: WorkflowBranch) => void
  onArchiveBranch?: (branch: WorkflowBranch) => void
  onUnarchiveBranch?: (branch: WorkflowBranch) => void
  onDeleteBranch?: (branch: WorkflowBranch) => void
  onRestoreBranch?: (branch: WorkflowBranch) => void

  /** Inline editing state - controlled from parent */
  editingSuffixBranchId?: string | null
  editingSuffixValue?: string
  onStartEditSuffix?: (branchId: string, currentSuffix: string) => void
  onSuffixValueChange?: (value: string) => void
  onSaveSuffix?: (branchId: string, newSuffix: string) => void
  onCancelEditSuffix?: () => void
  suffixSaveError?: string | null
  isSavingSuffix?: boolean
}

export function BranchesView({
  branches = [],
  workflowName,
  statusFilter = 'all',
  templateVersions = [],
  collapsedBranches = new Set(),
  collapsedTemplateVersions = new Set(),
  canEdit = false,
  isLoading = false,
  onStatusFilterChange,
  // History view callbacks
  onViewVersion,
  onActivateVersion,
  onCreateVersion,
  canActivateVersion = false,
  onToggleCollapse,
  onToggleTemplateCollapse,
  onCreateBranch,
  onViewBranch,
  onEndBranch,
  onContinueBranch,
  onArchiveBranch,
  onUnarchiveBranch,
  onDeleteBranch,
  onRestoreBranch,
  // Inline editing props
  editingSuffixBranchId,
  editingSuffixValue = '',
  onStartEditSuffix,
  onSuffixValueChange,
  onSaveSuffix,
  onCancelEditSuffix,
  suffixSaveError,
  isSavingSuffix = false
}: BranchesViewProps) {
  // Compare mode state for History view
  const [compareMode, setCompareMode] = useState(false)
  const [selectedVersions, setSelectedVersions] = useState<string[]>([])
  const [showComparison, setShowComparison] = useState(false)

  // Collapsed major version groups - initialize with all collapsed except most recent
  const [collapsedMajorVersions, setCollapsedMajorVersions] = useState<Set<number>>(() => {
    const majors = new Set<number>()
    templateVersions.forEach(v => {
      if (v.major_version != null) majors.add(v.major_version)
    })
    // Find the highest major version
    const sortedMajors = Array.from(majors).sort((a, b) => b - a)
    // Collapse all except the first (highest) major version
    return new Set(sortedMajors.slice(1))
  })

  const toggleMajorVersionCollapse = (majorVersion: number) => {
    setCollapsedMajorVersions(prev => {
      const newSet = new Set(prev)
      if (newSet.has(majorVersion)) {
        newSet.delete(majorVersion)
      } else {
        newSet.add(majorVersion)
      }
      return newSet
    })
  }

  const toggleVersionSelection = (versionId: string) => {
    setSelectedVersions(prev => {
      if (prev.includes(versionId)) {
        return prev.filter(id => id !== versionId)
      } else if (prev.length < 2) {
        return [...prev, versionId]
      } else {
        // Replace the first selected version
        return [prev[1], versionId]
      }
    })
  }

  const handleCompare = () => {
    if (selectedVersions.length === 2) {
      setShowComparison(true)
    }
  }

  const handleCancelCompare = () => {
    setCompareMode(false)
    setSelectedVersions([])
  }

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

                    {/* Suffix with inline edit */}
                    {editingSuffixBranchId === branch.id ? (
                      // Inline editing mode
                      <div className="flex items-center space-x-1">
                        <span className="text-xs text-gray-500">(</span>
                        <input
                          type="text"
                          value={editingSuffixValue}
                          onChange={(e) => onSuffixValueChange?.(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              onSaveSuffix?.(branch.id, editingSuffixValue)
                            } else if (e.key === 'Escape') {
                              onCancelEditSuffix?.()
                            }
                          }}
                          className="text-xs px-1.5 py-0.5 border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 w-32"
                          placeholder="e.g., Nov 2025"
                          autoFocus
                          disabled={isSavingSuffix}
                        />
                        <span className="text-xs text-gray-500">)</span>
                        {isSavingSuffix ? (
                          <Loader2 className="w-3 h-3 text-blue-500 animate-spin" />
                        ) : (
                          <>
                            <button
                              onClick={() => onSaveSuffix?.(branch.id, editingSuffixValue)}
                              className="p-0.5 hover:bg-green-100 rounded transition-colors"
                              title="Save"
                            >
                              <Check className="w-3.5 h-3.5 text-green-600" />
                            </button>
                            <button
                              onClick={() => onCancelEditSuffix?.()}
                              className="p-0.5 hover:bg-red-100 rounded transition-colors"
                              title="Cancel"
                            >
                              <X className="w-3.5 h-3.5 text-red-500" />
                            </button>
                          </>
                        )}
                        {suffixSaveError && (
                          <span className="text-xs text-red-500 ml-1">{suffixSaveError}</span>
                        )}
                      </div>
                    ) : (
                      // Display mode with hover-to-edit
                      <div className="flex items-center space-x-1 group">
                        <span className="text-xs text-gray-500 font-normal">
                          ({branch.branch_suffix || new Date(branch.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })})
                        </span>
                        {canEdit && !branch.is_archived && !branch.is_deleted && onStartEditSuffix && (
                          <button
                            onClick={() => onStartEditSuffix(branch.id, branch.branch_suffix || '')}
                            className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-gray-200 rounded transition-opacity"
                            title="Edit suffix"
                          >
                            <PenLine className="w-3 h-3 text-gray-400" />
                          </button>
                        )}
                      </div>
                    )}

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

                    {/* Created date and archived/deleted info */}
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-gray-600">Created {new Date(branch.created_at).toLocaleDateString()}</span>
                      {branch.is_archived && branch.archived_at && (
                        <span className="text-orange-600">
                          Archived {new Date(branch.archived_at).toLocaleDateString()}
                        </span>
                      )}
                      {branch.is_deleted && branch.deleted_at && (
                        <span className="text-red-600">
                          Deleted {new Date(branch.deleted_at).toLocaleDateString()}
                        </span>
                      )}
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

  // Find the active/latest template version number
  const activeTemplateVersion = React.useMemo(() => {
    // First try to find the explicitly active version from templateVersions
    const activeVersion = templateVersions.find(v => v.is_active)
    if (activeVersion) {
      return activeVersion.major_version && activeVersion.minor_version
        ? `${activeVersion.major_version}.${activeVersion.minor_version}`
        : activeVersion.version_number.toString()
    }
    // Fall back to the highest version number from branchesByVersion
    if (branchesByVersion.length > 0) {
      return branchesByVersion[0][0]
    }
    return null
  }, [templateVersions, branchesByVersion])

  // Render template version section
  const renderTemplateVersion = (versionNumber: string, versionBranches: WorkflowBranch[]) => {
    const isCollapsed = collapsedTemplateVersions.has(versionNumber)
    const { rootBranches } = buildBranchTree(versionBranches)
    // Don't count placeholder entries as branches
    const branchCount = versionBranches.filter(b => !b.is_placeholder).length
    // Count active branches for this template version
    const activeBranchCount = versionBranches.filter(b =>
      !b.is_placeholder &&
      !b.is_archived &&
      !b.is_deleted &&
      b.is_active
    ).length
    // Check if this is the latest active template
    const isLatestActive = versionNumber === activeTemplateVersion

    return (
      <div key={versionNumber} className="mb-3">
        <div className={`rounded-lg p-4 ${
          isLatestActive
            ? 'bg-indigo-50 border-2 border-indigo-500 ring-2 ring-indigo-200'
            : 'bg-indigo-50 border-2 border-indigo-200'
        }`}>
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
                {workflowName || 'Workflow'} v{versionNumber}
              </h3>
              <span className="text-xs text-indigo-600">
                {branchCount} {branchCount === 1 ? 'branch' : 'branches'}
              </span>
              {activeBranchCount > 0 && (
                <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 border border-green-300 flex items-center space-x-1">
                  <GitBranch className="w-3 h-3" />
                  <span>{activeBranchCount} active</span>
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
          {(['all', 'history', 'archived', 'deleted'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => onStatusFilterChange(filter)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                statusFilter === filter
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {filter === 'all' ? 'All' : filter === 'history' ? 'History' : filter.charAt(0).toUpperCase() + filter.slice(1)}
            </button>
          ))}
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="text-sm text-gray-500 mt-2">Loading...</p>
        </div>
      )}

      {/* History View - Template Versions */}
      {!isLoading && statusFilter === 'history' && (
        <Card>
          <div className="p-4">
            {/* Compare Mode Header */}
            {templateVersions.length >= 2 && (
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-200">
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-600">
                    {compareMode
                      ? `Select 2 versions to compare (${selectedVersions.length}/2 selected)`
                      : `${templateVersions.length} versions`
                    }
                  </span>
                  {compareMode && (
                    <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded">
                      Compare Mode
                    </span>
                  )}
                </div>
                <div className="flex items-center space-x-2">
                  {compareMode ? (
                    <>
                      <Button size="sm" variant="outline" onClick={handleCancelCompare}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleCompare}
                        disabled={selectedVersions.length !== 2}
                      >
                        <GitCompare className="w-3 h-3 mr-1" />
                        Compare Selected
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setCompareMode(true)}>
                      <GitCompare className="w-3 h-3 mr-1" />
                      Compare Versions
                    </Button>
                  )}
                </div>
              </div>
            )}

            {templateVersions.length === 0 ? (
              <div className="text-center py-8">
                <GitBranch className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No versions yet</h3>
                <p className="text-sm text-gray-500 mb-4">
                  Create your first template version to start tracking changes
                </p>
                {canEdit && onCreateVersion && (
                  <Button onClick={onCreateVersion}>
                    <Plus className="w-4 h-4 mr-2" />
                    Create Version 1
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {(() => {
                  // Group versions by major version
                  const sortedVersions = [...templateVersions].sort((a, b) => b.version_number - a.version_number)
                  const groupedByMajor = new Map<number, typeof templateVersions>()

                  sortedVersions.forEach(version => {
                    const majorVersion = version.major_version ?? version.version_number
                    if (!groupedByMajor.has(majorVersion)) {
                      groupedByMajor.set(majorVersion, [])
                    }
                    groupedByMajor.get(majorVersion)!.push(version)
                  })

                  // Sort major versions descending
                  const sortedMajorVersions = Array.from(groupedByMajor.keys()).sort((a, b) => b - a)
                  const latestVersionId = sortedVersions[0]?.id

                  return sortedMajorVersions.map((majorVersion, groupIndex) => {
                    const versions = groupedByMajor.get(majorVersion)!
                    const isCollapsed = collapsedMajorVersions.has(majorVersion)
                    const isLatestGroup = groupIndex === 0
                    const totalBranchesInGroup = versions.reduce((sum, version) => {
                      const versionStr = version.major_version && version.minor_version
                        ? `${version.major_version}.${version.minor_version}`
                        : version.version_number.toString()
                      return sum + branches.filter(b =>
                        !b.is_archived &&
                        !b.is_deleted &&
                        b.is_active &&
                        (b.template_version_number?.toString() === versionStr ||
                         b.template_version_number?.toString() === version.version_number.toString())
                      ).length
                    }, 0)

                    return (
                      <div key={majorVersion} className="border border-gray-200 rounded-lg overflow-hidden">
                        {/* Major version header */}
                        <button
                          onClick={() => toggleMajorVersionCollapse(majorVersion)}
                          className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors ${
                            isLatestGroup
                              ? 'bg-indigo-50 hover:bg-indigo-100'
                              : 'bg-gray-50 hover:bg-gray-100'
                          }`}
                        >
                          <div className="flex items-center space-x-3">
                            {isCollapsed ? (
                              <ChevronRight className="w-4 h-4 text-gray-500" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-gray-500" />
                            )}
                            <span className={`font-semibold ${isLatestGroup ? 'text-indigo-900' : 'text-gray-900'}`}>
                              Version {majorVersion}
                            </span>
                            <span className="text-sm text-gray-500">
                              ({versions.length} {versions.length === 1 ? 'release' : 'releases'})
                            </span>
                          </div>
                          {totalBranchesInGroup > 0 && (
                            <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 border border-green-300 flex items-center space-x-1">
                              <GitBranch className="w-3 h-3" />
                              <span>{totalBranchesInGroup} active</span>
                            </span>
                          )}
                        </button>

                        {/* Versions within this major version */}
                        {!isCollapsed && (
                          <div className="divide-y divide-gray-100">
                            {versions.map((version, versionIndex) => {
                              const stageCount = version.stages?.length || 0
                              const checklistCount = version.checklist_templates?.length || 0

                              const versionStr = version.major_version && version.minor_version
                                ? `${version.major_version}.${version.minor_version}`
                                : version.version_number.toString()
                              const activeBranchCount = branches.filter(b =>
                                !b.is_archived &&
                                !b.is_deleted &&
                                b.is_active &&
                                (b.template_version_number?.toString() === versionStr ||
                                 b.template_version_number?.toString() === version.version_number.toString())
                              ).length

                              const isLatest = version.id === latestVersionId
                              const isSelected = selectedVersions.includes(version.id)

                              // Find previous version for change summary (highest version_number less than current)
                              const previousVersion = sortedVersions
                                .filter(v => v.version_number < version.version_number)
                                .sort((a, b) => b.version_number - a.version_number)[0] || null
                              const changeSummary = generateChangeSummary(version, previousVersion)

                              return (
                                <div
                                  key={version.id}
                                  className={`p-4 ${
                                    compareMode && isSelected
                                      ? 'ring-2 ring-inset ring-blue-500 bg-blue-50'
                                      : isLatest
                                        ? 'bg-indigo-50/50'
                                        : 'bg-white hover:bg-gray-50'
                                  }`}
                                >
                                  <div className="flex items-start justify-between">
                                    <div className="flex items-start space-x-3 flex-1">
                                      {compareMode && (
                                        <input
                                          type="checkbox"
                                          checked={isSelected}
                                          onChange={() => toggleVersionSelection(version.id)}
                                          className="mt-1.5 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                        />
                                      )}
                                      <div className="flex-1">
                                        <div className="flex items-center justify-between mb-1">
                                          <div className="flex items-center space-x-3">
                                            <h3 className="text-base font-semibold text-gray-900">
                                              {formatVersion(version.version_number, version.major_version, version.minor_version)}
                                            </h3>
                                            <span className="text-xs text-gray-400">
                                              {new Date(version.created_at).toLocaleDateString()}
                                            </span>
                                            <span className="text-xs text-gray-400">•</span>
                                            <span className="text-xs text-gray-400">{stageCount} stages</span>
                                            <span className="text-xs text-gray-400">•</span>
                                            <span className="text-xs text-gray-400">{checklistCount} checklists</span>
                                            {activeBranchCount > 0 && (
                                              <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 border border-green-300 flex items-center space-x-1">
                                                <GitBranch className="w-3 h-3" />
                                                <span>{activeBranchCount} active</span>
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                        <p className="text-sm text-gray-600">{changeSummary}</p>
                                      </div>
                                    </div>
                                    {!compareMode && (
                                      <div className="flex items-center space-x-2 ml-4">
                                        {onViewVersion && (
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => onViewVersion(version.id)}
                                          >
                                            <Eye className="w-3 h-3 mr-1" />
                                            View
                                          </Button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })
                })()}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Comparison Modal */}
      {showComparison && selectedVersions.length === 2 && (
        <VersionComparisonModal
          isOpen={showComparison}
          onClose={() => {
            setShowComparison(false)
            setCompareMode(false)
            setSelectedVersions([])
          }}
          version1={templateVersions.find(v => v.id === selectedVersions[0])!}
          version2={templateVersions.find(v => v.id === selectedVersions[1])!}
          workflowName={workflowName || 'Workflow'}
        />
      )}

      {/* Branches organized by template version */}
      {!isLoading && statusFilter !== 'history' && branchesByVersion.length > 0 && (
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
      {!isLoading && statusFilter !== 'history' && branchesByVersion.length === 0 && (
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
