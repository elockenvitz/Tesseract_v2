import React, { useState } from 'react'
import { Check, ChevronDown, Clock, GitBranch, Play, CheckCircle, Plus } from 'lucide-react'
import { formatVersion } from '../../lib/versionUtils'

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
    description: string | null
    status: 'active' | 'ended'
    template_version_id: string | null
    template_version_number: number | null
    created_at: string
    is_archived: boolean
  } | null
}

interface AvailableWorkflow {
  id: string
  name: string
  description: string | null
  status: 'active' | 'ended'
  template_version_id: string | null
  template_version_number: number | null
  created_by: string
  is_public: boolean
  is_archived: boolean
}

interface AssetWorkflowSelectorEnhancedProps {
  mode: 'header' | 'stage-tab'
  selectedWorkflowId: string | null
  allAssetWorkflows: WorkflowProgress[]
  availableWorkflows: AvailableWorkflow[]
  onSelectWorkflow: (workflowId: string) => void
  onJoinWorkflow?: (workflowId: string) => void
  className?: string
}

export function AssetWorkflowSelectorEnhanced({
  mode,
  selectedWorkflowId,
  allAssetWorkflows,
  availableWorkflows,
  onSelectWorkflow,
  onJoinWorkflow,
  className = ''
}: AssetWorkflowSelectorEnhancedProps) {
  const [isOpen, setIsOpen] = useState(false)

  // Categorize workflows
  const activeWorkflows = allAssetWorkflows.filter(aw =>
    aw.is_started &&
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
    // TODO: Calculate based on checklist completion
    return 50 // Placeholder
  }

  const handleSelect = (workflowId: string) => {
    onSelectWorkflow(workflowId)
    setIsOpen(false)
  }

  const handleJoin = (workflowId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    onJoinWorkflow?.(workflowId)
    setIsOpen(false)
  }

  return (
    <div className={`relative ${className}`}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-2 px-3 py-1.5 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm"
      >
        <GitBranch className="w-4 h-4 text-gray-500" />
        <span className="font-medium text-gray-900">
          {mode === 'header'
            ? (selectedWorkflowData?.name || 'Active Workflows')
            : (selectedWorkflowData?.name || 'Select Workflow')
          }
        </span>
        {selectedWorkflow && selectedWorkflowData && (
          <span className="text-xs text-gray-500">
            {formatVersion(
              selectedWorkflowData.template_version_number || 1,
              null,
              null
            )}
          </span>
        )}
        <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
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
              /* Header Mode - Simple Active Only */
              <div className="p-2">
                {activeWorkflows.length === 0 ? (
                  <div className="px-3 py-8 text-center text-gray-500 text-sm">
                    No active workflows
                  </div>
                ) : (
                  activeWorkflows.map(aw => (
                    <button
                      key={aw.id}
                      onClick={() => handleSelect(aw.workflow_id)}
                      className="w-full text-left px-3 py-2 rounded hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2">
                            <span className="font-medium text-gray-900 truncate">
                              {aw.workflows?.name}
                            </span>
                            {aw.workflow_id === selectedWorkflowId && (
                              <Check className="w-4 h-4 text-green-600 flex-shrink-0" />
                            )}
                          </div>
                          <div className="flex items-center space-x-2 mt-1">
                            <span className="text-xs text-gray-500">
                              {formatVersion(aw.workflows?.template_version_number || 1, null, null)}
                            </span>
                            <span className="text-xs text-gray-500">•</span>
                            <span className="text-xs text-gray-500">
                              {calculateProgress(aw)}% complete
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  ))
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
                        <button
                          key={aw.id}
                          onClick={() => handleSelect(aw.workflow_id)}
                          className="w-full text-left px-3 py-2 rounded hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center space-x-2">
                                <Play className="w-3 h-3 text-green-600 flex-shrink-0" />
                                <span className="font-medium text-gray-900 truncate text-sm">
                                  {aw.workflows?.name}
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
                            </div>
                          </div>
                        </button>
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

                {/* Inactive Workflows */}
                {inactiveWorkflows.length > 0 && (
                  <div className="p-3">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      Not Started ({inactiveWorkflows.length})
                    </div>
                    <div className="space-y-1">
                      {inactiveWorkflows.map(aw => (
                        <button
                          key={aw.id}
                          onClick={() => handleSelect(aw.workflow_id)}
                          className="w-full text-left px-3 py-2 rounded hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center space-x-2">
                                <Clock className="w-3 h-3 text-gray-400 flex-shrink-0" />
                                <span className="font-medium text-gray-700 truncate text-sm">
                                  {aw.workflows?.name}
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
                                <span className="text-xs text-gray-500">Not started</span>
                              </div>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Available to Join */}
                {availableWorkflows.length > 0 && (
                  <div className="p-3">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      Available to Join ({availableWorkflows.length})
                    </div>
                    <div className="space-y-1">
                      {availableWorkflows.map(workflow => (
                        <div
                          key={workflow.id}
                          className="flex items-center justify-between px-3 py-2 rounded hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center space-x-2">
                              <Plus className="w-3 h-3 text-blue-600 flex-shrink-0" />
                              <span className="font-medium text-gray-900 truncate text-sm">
                                {workflow.name}
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
                            Join
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Empty State */}
                {displayWorkflows.length === 0 && availableWorkflows.length === 0 && (
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
