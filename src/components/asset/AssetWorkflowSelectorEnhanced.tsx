import React, { useState } from 'react'
import { Check, ChevronDown, Clock, GitBranch, Play, CheckCircle, Plus, CalendarClock, XCircle } from 'lucide-react'
import { formatVersion } from '../../lib/versionUtils'
import { formatDistanceToNow } from 'date-fns'

interface WorkflowProgress {
  id: string
  asset_id: string
  workflow_id: string
  current_stage_key: string | null
  is_started: boolean
  is_completed: boolean
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
  workflows: {
    id: string
    name: string
    branch_suffix: string | null
    description: string | null
    status: 'active' | 'ended'
    template_version_id: string | null
    template_version_number: number | null
    created_at: string
    archived: boolean
    deleted?: boolean
  } | null
  // Optional stats for progress calculation
  total_tasks?: number
  completed_tasks?: number
  total_stages?: number
  current_stage_index?: number
}

interface AvailableWorkflow {
  id: string
  name: string
  branch_suffix: string | null
  description: string | null
  status: 'active' | 'ended'
  template_version_id: string | null
  template_version_number: number | null
  created_by: string
  is_public: boolean
  archived: boolean
}

interface UpcomingBranch {
  workflowId: string
  workflowName: string
  estimatedStartDate: Date
  branchName: string
  versionNumber: number | null
}

interface AssetWorkflowSelectorEnhancedProps {
  mode: 'header' | 'stage-tab'
  selectedWorkflowId: string | null
  allAssetWorkflows: WorkflowProgress[]
  availableWorkflows: AvailableWorkflow[]
  upcomingBranches?: UpcomingBranch[]
  onSelectWorkflow: (workflowId: string) => void
  onJoinWorkflow?: (workflowId: string) => void
  onRemoveWorkflow?: (workflowId: string) => void
  className?: string
}

export function AssetWorkflowSelectorEnhanced({
  mode,
  selectedWorkflowId,
  allAssetWorkflows,
  availableWorkflows,
  upcomingBranches = [],
  onSelectWorkflow,
  onJoinWorkflow,
  onRemoveWorkflow,
  className = ''
}: AssetWorkflowSelectorEnhancedProps) {
  const [isOpen, setIsOpen] = useState(false)

  // Categorize workflows
  // Active workflows are all workflows in active branches that aren't completed
  // (is_started is automatically true when added to active branch via trigger)
  const activeWorkflows = allAssetWorkflows.filter(aw =>
    !aw.is_completed &&
    aw.workflows?.status === 'active'
  )

  const completedWorkflows = allAssetWorkflows.filter(aw =>
    aw.is_completed
  )

  const inactiveWorkflows = allAssetWorkflows.filter(aw =>
    !aw.is_started &&
    !aw.is_completed &&
    aw.workflows?.status === 'active'
  )

  const endedWorkflows = allAssetWorkflows.filter(aw =>
    aw.workflows?.status === 'ended' && !aw.is_completed
  )

  // For header mode, only show active workflows
  const displayWorkflows = mode === 'header' ? activeWorkflows : allAssetWorkflows

  // Find selected workflow
  const selectedWorkflow = allAssetWorkflows.find(aw => aw.workflow_id === selectedWorkflowId)
  const selectedWorkflowData = selectedWorkflow?.workflows

  // Calculate progress for a workflow
  const calculateProgress = (workflow: WorkflowProgress): number => {
    if (workflow.is_completed) return 100
    if (!workflow.is_started) return 0

    // Hybrid approach: 60% weight on task completion, 40% weight on stage advancement
    let taskProgress = 0
    let stageProgress = 0

    // Calculate task-based progress
    if (workflow.total_tasks && workflow.total_tasks > 0) {
      taskProgress = (workflow.completed_tasks || 0) / workflow.total_tasks
    }

    // Calculate stage-based progress
    if (workflow.total_stages && workflow.total_stages > 0 && workflow.current_stage_index !== undefined) {
      stageProgress = workflow.current_stage_index / workflow.total_stages
    }

    // Combine with weighting (60% tasks, 40% stages)
    const combinedProgress = (taskProgress * 0.6) + (stageProgress * 0.4)

    // Return as percentage, rounded to nearest integer
    return Math.round(combinedProgress * 100)
  }

  const handleSelect = (workflowId: string) => {
    onSelectWorkflow(workflowId)
    setIsOpen(false)
  }

  const handleJoin = (workflowId: string, e: React.MouseEvent) => {
    console.log('🔘 Add button clicked!', { workflowId, hasOnJoinWorkflow: !!onJoinWorkflow })
    e.stopPropagation()
    onJoinWorkflow?.(workflowId)
    console.log('✅ onJoinWorkflow called')
    // Don't close dropdown - let user add multiple workflows
  }

  const handleRemove = (workflowId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    onRemoveWorkflow?.(workflowId)
    // Don't close dropdown - let user see the workflow move to "Available to Add"
  }

  return (
    <div className={`relative ${className}`}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center space-x-2 px-3 py-1.5 border rounded-lg hover:bg-gray-50 transition-colors text-sm ${
          mode === 'header' && activeWorkflows.length === 0
            ? 'bg-blue-50 border-blue-200 hover:bg-blue-100'
            : 'bg-white border-gray-300'
        }`}
      >
        {mode === 'header' && activeWorkflows.length === 0 ? (
          <Plus className="w-4 h-4 text-blue-600" />
        ) : (
          <GitBranch className="w-4 h-4 text-gray-500" />
        )}
        <span className={`font-medium ${mode === 'header' && activeWorkflows.length === 0 ? 'text-blue-600' : 'text-gray-900'}`}>
          {mode === 'header'
            ? activeWorkflows.length === 0
              ? 'Add to Workflow'
              : `Active Workflows (${activeWorkflows.length})`
            : selectedWorkflowData
              ? `${selectedWorkflowData.name}${selectedWorkflowData.branch_suffix ? ` (${selectedWorkflowData.branch_suffix})` : ''}`
              : 'Select Workflow'
          }
        </span>
        {mode !== 'header' && selectedWorkflow && selectedWorkflowData && (
          <span className="text-xs text-gray-500">
            {formatVersion(
              selectedWorkflowData.template_version_number || 1,
              null,
              null
            )}
          </span>
        )}
        <ChevronDown className={`w-4 h-4 ${mode === 'header' && activeWorkflows.length === 0 ? 'text-blue-600' : 'text-gray-500'} transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-[100]"
            onClick={() => setIsOpen(false)}
          />

          {/* Dropdown Menu */}
          <div className={`absolute top-full mt-2 w-96 bg-white border border-gray-200 rounded-lg shadow-xl z-[101] max-h-[500px] overflow-y-auto ${
            mode === 'header' ? 'right-0' : 'left-0'
          }`}>
            {mode === 'header' ? (
              /* Header Mode - Active workflows + Available to add */
              <div className="divide-y divide-gray-100">
                {/* Active Workflows Section */}
                {activeWorkflows.length > 0 && (
                  <div className="p-2">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 py-1.5 mb-1">
                      Active Workflows ({activeWorkflows.length})
                    </div>
                    {activeWorkflows.map(aw => (
                      <div
                        key={aw.id}
                        className="flex items-center justify-between px-3 py-2 rounded hover:bg-gray-50 transition-all duration-200 ease-in-out group animate-in fade-in slide-in-from-top-2"
                      >
                        <button
                          onClick={() => handleSelect(aw.workflow_id)}
                          className="flex-1 text-left min-w-0"
                        >
                          <div className="flex items-center space-x-2">
                            <Play className="w-3 h-3 text-green-600 flex-shrink-0" />
                            <span className="font-medium text-gray-900 truncate text-sm">
                              {aw.workflows?.name}
                              {aw.workflows?.branch_suffix && ` (${aw.workflows.branch_suffix})`}
                            </span>
                            {aw.workflow_id === selectedWorkflowId && (
                              <Check className="w-4 h-4 text-green-600 flex-shrink-0" />
                            )}
                          </div>
                          <div className="flex items-center space-x-2 mt-1 ml-5">
                            <span className="text-xs text-gray-500">
                              {formatVersion(aw.workflows?.template_version_number || 1, null, null)}
                            </span>
                            <span className="text-xs text-gray-500">•</span>
                            <span className="text-xs text-gray-500">
                              {calculateProgress(aw)}% complete
                            </span>
                          </div>
                        </button>
                        {!aw.is_completed && (
                          <button
                            onClick={(e) => handleRemove(aw.workflow_id, e)}
                            className="ml-2 p-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                            title="Remove from workflow"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Available to Add Section */}
                {availableWorkflows.length > 0 && (
                  <div className="p-2">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 py-1.5 mb-1">
                      Available Workflows ({availableWorkflows.length})
                    </div>
                    {availableWorkflows.map(workflow => (
                      <div
                        key={workflow.id}
                        className="flex items-center justify-between px-3 py-2 rounded hover:bg-gray-50 transition-all duration-200 ease-in-out animate-in fade-in slide-in-from-top-2"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2">
                            <Plus className="w-3 h-3 text-blue-600 flex-shrink-0" />
                            <span className="font-medium text-gray-900 truncate text-sm">
                              {workflow.name}
                              {workflow.branch_suffix && ` (${workflow.branch_suffix})`}
                            </span>
                          </div>
                          <div className="flex items-center space-x-2 mt-1 ml-5">
                            <span className="text-xs text-gray-500">
                              {formatVersion(workflow.template_version_number || 1, null, null)}
                            </span>
                            {workflow.description && (
                              <>
                                <span className="text-xs text-gray-500">•</span>
                                <span className="text-xs text-gray-500 truncate max-w-[200px]">
                                  {workflow.description}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={(e) => handleJoin(workflow.id, e)}
                          className="ml-2 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
                        >
                          Add
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Empty State */}
                {activeWorkflows.length === 0 && availableWorkflows.length === 0 && (
                  <div className="px-3 py-8 text-center text-gray-500 text-sm">
                    No workflows available
                  </div>
                )}
              </div>
            ) : (
              /* Stage Tab Mode - Comprehensive */
              <div className="divide-y divide-gray-100">
                {/* Active Workflows */}
                {activeWorkflows.length > 0 && (
                  <div className="p-3">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      Active Workflows ({activeWorkflows.length})
                    </div>
                    <div className="space-y-1">
                      {activeWorkflows.map(aw => (
                        <div
                          key={aw.id}
                          className="flex items-center justify-between px-3 py-2 rounded hover:bg-gray-50 transition-all duration-200 ease-in-out group animate-in fade-in slide-in-from-top-2"
                        >
                          <button
                            onClick={() => handleSelect(aw.workflow_id)}
                            className="flex-1 text-left min-w-0"
                          >
                            <div className="flex items-center space-x-2">
                              <Play className="w-3 h-3 text-green-600 flex-shrink-0" />
                              <span className="font-medium text-gray-900 truncate text-sm">
                                {aw.workflows?.name}
                                {aw.workflows?.branch_suffix && ` (${aw.workflows.branch_suffix})`}
                              </span>
                              {aw.workflow_id === selectedWorkflowId && (
                                <Check className="w-4 h-4 text-blue-600 flex-shrink-0" />
                              )}
                            </div>
                            <div className="flex items-center space-x-2 mt-1 ml-5">
                              <span className="text-xs text-gray-500">
                                {formatVersion(aw.workflows?.template_version_number || 1, null, null)}
                              </span>
                              <span className="text-xs text-gray-500">•</span>
                              <span className="text-xs text-gray-500">
                                {calculateProgress(aw)}% complete
                              </span>
                            </div>
                          </button>
                          {!aw.is_completed && (
                            <button
                              onClick={(e) => handleRemove(aw.workflow_id, e)}
                              className="ml-2 p-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                              title="Remove from workflow"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Completed Workflows */}
                {completedWorkflows.length > 0 && (
                  <div className="p-3">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      Completed ({completedWorkflows.length})
                    </div>
                    <div className="space-y-1">
                      {completedWorkflows.map(aw => (
                        <button
                          key={aw.id}
                          onClick={() => handleSelect(aw.workflow_id)}
                          className="w-full text-left px-3 py-2 rounded hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center space-x-2">
                                <CheckCircle className="w-3 h-3 text-gray-400 flex-shrink-0" />
                                <span className="font-medium text-gray-700 truncate text-sm">
                                  {aw.workflows?.name}
                                  {aw.workflows?.branch_suffix && ` (${aw.workflows.branch_suffix})`}
                                </span>
                                {aw.workflow_id === selectedWorkflowId && (
                                  <Check className="w-4 h-4 text-blue-600 flex-shrink-0" />
                                )}
                              </div>
                              <div className="flex items-center space-x-2 mt-1 ml-5">
                                <span className="text-xs text-gray-500">
                                  {formatVersion(aw.workflows?.template_version_number || 1, null, null)}
                                </span>
                                <span className="text-xs text-gray-500">•</span>
                                <span className="text-xs text-green-600">100% complete</span>
                              </div>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Inactive Workflows section removed - Assets added to active branches are automatically started */}

                {/* Available to Add */}
                {availableWorkflows.length > 0 && (
                  <div className="p-3">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      Available to Add ({availableWorkflows.length})
                    </div>
                    <div className="space-y-1">
                      {availableWorkflows.map(workflow => (
                        <div
                          key={workflow.id}
                          className="flex items-center justify-between px-3 py-2 rounded hover:bg-gray-50 transition-all duration-200 ease-in-out animate-in fade-in slide-in-from-top-2"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center space-x-2">
                              <Plus className="w-3 h-3 text-blue-600 flex-shrink-0" />
                              <span className="font-medium text-gray-900 truncate text-sm">
                                {workflow.name}
                                {workflow.branch_suffix && ` (${workflow.branch_suffix})`}
                              </span>
                            </div>
                            <div className="flex items-center space-x-2 mt-1 ml-5">
                              <span className="text-xs text-gray-500">
                                {formatVersion(workflow.template_version_number || 1, null, null)}
                              </span>
                            </div>
                          </div>
                          <button
                            onClick={(e) => handleJoin(workflow.id, e)}
                            className="ml-2 px-2 py-1 text-xs font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors"
                          >
                            Add
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Upcoming Branches */}
                {upcomingBranches.length > 0 && (
                  <div className="p-3">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      Upcoming Branches ({upcomingBranches.length})
                    </div>
                    <div className="space-y-1">
                      {upcomingBranches.map((branch, idx) => (
                        <div
                          key={`${branch.workflowId}-${idx}`}
                          className="px-3 py-2 rounded bg-purple-50 border border-purple-200"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center space-x-2">
                              <CalendarClock className="w-3 h-3 text-purple-600 flex-shrink-0" />
                              <span className="font-medium text-purple-900 truncate text-sm">
                                {branch.branchName}
                              </span>
                            </div>
                            <div className="flex items-center space-x-2 mt-1 ml-5">
                              <span className="text-xs text-purple-600">
                                {formatVersion(branch.versionNumber || 1, null, null)}
                              </span>
                              <span className="text-xs text-purple-600">•</span>
                              <span className="text-xs text-purple-600">
                                Starting {formatDistanceToNow(branch.estimatedStartDate, { addSuffix: true })}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Empty State */}
                {displayWorkflows.length === 0 && availableWorkflows.length === 0 && upcomingBranches.length === 0 && (
                  <div className="px-3 py-8 text-center text-gray-500 text-sm">
                    No workflows available
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
