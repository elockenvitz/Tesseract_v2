import React, { useState } from 'react'
import { ChevronDown, Workflow, AlertTriangle, Zap, Target, Clock } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

interface AssetWorkflowSelectorProps {
  assetId: string
  currentWorkflowId?: string
  currentPriority: string
  onWorkflowChange: (workflowId: string) => void
  onPriorityChange: (priority: string) => void
  className?: string
}

interface WorkflowWithProgress {
  id: string
  name: string
  description: string
  color: string
  is_default: boolean
  current_stage?: string
  has_progress: boolean
}

export function AssetWorkflowSelector({
  assetId,
  currentWorkflowId,
  currentPriority,
  onWorkflowChange,
  onPriorityChange,
  className = ''
}: AssetWorkflowSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [showPriorityDropdown, setShowPriorityDropdown] = useState(false)

  // Query to get workflows with progress for this asset
  const { data: workflows, isLoading } = useQuery({
    queryKey: ['asset-workflows-progress', assetId],
    queryFn: async () => {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id

      if (!userId) return []

      // Get all accessible workflows
      const { data: allWorkflows, error: workflowError } = await supabase
        .from('workflows')
        .select('*')
        .or(`is_public.eq.true,created_by.eq.${userId}`)
        .order('is_default', { ascending: false })
        .order('name')

      if (workflowError) throw workflowError

      // Get workflow-specific progress for this asset (indicates active workflows)
      const { data: workflowProgress, error: progressError } = await supabase
        .from('asset_workflow_progress')
        .select('workflow_id, is_started')
        .eq('asset_id', assetId)
        .eq('is_started', true)

      if (progressError && progressError.code !== 'PGRST116') throw progressError

      const activeWorkflowIds = new Set(workflowProgress?.map(p => p.workflow_id) || [])

      // Mark workflows with progress (only those that are actually started)
      const workflowsWithProgress: WorkflowWithProgress[] = allWorkflows.filter(workflow =>
        activeWorkflowIds.has(workflow.id)
      ).map(workflow => ({
        ...workflow,
        has_progress: true
      }))

      // Return only workflows that are actually started
      return workflowsWithProgress
    },
    enabled: !!assetId
  })

  const currentWorkflow = workflows?.find(w => w.id === currentWorkflowId)
  const workflowCount = workflows?.length || 0

  const handleWorkflowSelect = (workflowId: string) => {
    onWorkflowChange(workflowId)
    setIsOpen(false)
  }

  // Priority configuration
  const priorityConfig = {
    'critical': { color: 'bg-red-600 text-white', icon: AlertTriangle, label: 'Critical' },
    'high': { color: 'bg-orange-500 text-white', icon: Zap, label: 'High' },
    'medium': { color: 'bg-blue-500 text-white', icon: Target, label: 'Medium' },
    'low': { color: 'bg-green-500 text-white', icon: Clock, label: 'Low' }
  }
  const currentPriorityConfig = priorityConfig[currentPriority as keyof typeof priorityConfig] || priorityConfig['medium']

  if (isLoading) {
    return (
      <div className={`flex items-center space-x-2 ${className}`}>
        <div className="animate-pulse">
          <div className="h-10 bg-gray-200 rounded-xl w-64"></div>
        </div>
      </div>
    )
  }

  return (
    <div className={`relative ${className}`}>
      <div className="flex items-center space-x-3">
        {/* Priority Indicator */}
        <div className="relative">
          <button
            onClick={() => setShowPriorityDropdown(!showPriorityDropdown)}
            className={`px-2 py-1 rounded-lg text-xs font-medium ${currentPriorityConfig.color} flex items-center space-x-1 hover:opacity-90 transition-opacity`}
          >
            <currentPriorityConfig.icon className="w-3 h-3" />
            <span>{currentPriorityConfig.label}</span>
            <ChevronDown className="w-3 h-3" />
          </button>

          {showPriorityDropdown && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowPriorityDropdown(false)}
              />
              <div className="absolute top-full right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 overflow-hidden">
                <div className="p-2">
                  {Object.entries(priorityConfig).map(([value, config]) => (
                    <button
                      key={value}
                      onClick={() => {
                        onPriorityChange(value)
                        setShowPriorityDropdown(false)
                      }}
                      className={`w-full px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                        value === currentPriority
                          ? config.color + ' ring-2 ring-offset-1 ring-blue-300'
                          : config.color + ' opacity-70 hover:opacity-100'
                      } flex items-center space-x-1 mb-1 last:mb-0`}
                    >
                      <config.icon className="w-3 h-3" />
                      <span>{config.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Workflows Selector */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center space-x-4 px-6 py-4 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 hover:shadow-md transition-all duration-200 min-w-[200px]"
        >
          {/* Workflow Indicator */}
          <div className="flex items-center space-x-3">
            <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center shadow-sm">
              <Workflow className="w-3 h-3 text-white" />
            </div>
            <div className="text-left">
              <div className="text-sm font-semibold text-gray-800">
                Workflows in Progress
              </div>
              <div className="text-xs text-gray-500">
                {workflowCount} active workflow{workflowCount !== 1 ? 's' : ''}
              </div>
            </div>
          </div>

          <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Dropdown */}
      {isOpen && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />

          {/* Dropdown Content */}
          <div className="absolute top-full right-0 mt-2 w-80 bg-white border border-gray-200 rounded-xl shadow-xl z-20 overflow-hidden">
            <div className="p-4">
              <div className="text-sm font-medium text-gray-700 mb-3">Active Workflows:</div>

              <div className="space-y-1">
                {workflows?.map((workflow) => (
                  <button
                    key={workflow.id}
                    onClick={() => handleWorkflowSelect(workflow.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                      workflow.id === currentWorkflowId
                        ? 'bg-blue-50 text-blue-900 border border-blue-200'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: workflow.color }}
                        />
                        <span className="font-medium text-sm">{workflow.name}</span>
                        {workflow.is_default && (
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                            Default
                          </span>
                        )}
                      </div>
                      {workflow.id === currentWorkflowId && (
                        <div className="text-xs text-blue-600 font-medium">Current</div>
                      )}
                    </div>
                    {workflow.description && (
                      <p className="text-xs text-gray-500 mt-1 ml-5">
                        {workflow.description}
                      </p>
                    )}
                  </button>
                ))}
              </div>

              {(!workflows || workflows.length === 0) && (
                <div className="text-center py-4">
                  <div className="text-sm text-gray-500">No workflows in progress</div>
                  <div className="text-xs text-gray-400 mt-1">Start working on this asset to see workflows here</div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}