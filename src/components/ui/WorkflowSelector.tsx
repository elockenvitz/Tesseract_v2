import React, { useState } from 'react'
import { ChevronDown, Settings, Plus, Workflow, MoreHorizontal, Search } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

interface WorkflowSelectorProps {
  currentWorkflowId?: string
  onWorkflowChange: (workflowId: string) => void
  onManageWorkflows?: () => void
  onViewAllWorkflows?: () => void
  className?: string
}

interface Workflow {
  id: string
  name: string
  description: string
  color: string
  is_default: boolean
  is_public: boolean
  created_by: string
  last_used?: string
}

export function WorkflowSelector({
  currentWorkflowId,
  onWorkflowChange,
  onManageWorkflows,
  onViewAllWorkflows,
  className = ''
}: WorkflowSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const queryClient = useQueryClient()

  // Single query for all workflows
  const { data: allWorkflows, isLoading, error } = useQuery({
    queryKey: ['workflows-all'],
    queryFn: async () => {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id

      if (!userId) return []

      // Helper function to get workflow IDs shared with the user
      const getSharedWorkflowIds = async (userId: string | undefined) => {
        if (!userId) return []

        const { data, error } = await supabase
          .from('workflow_collaborations')
          .select('workflow_id')
          .eq('user_id', userId)

        if (error) return []

        return data.map(collab => collab.workflow_id)
      }

      // Get workflows the user owns, public workflows, or workflows shared with them
      const sharedIds = await getSharedWorkflowIds(userId)

      let query = supabase
        .from('workflows')
        .select('*')

      if (sharedIds.length > 0) {
        query = query.or(`is_public.eq.true,created_by.eq.${userId},id.in.(${sharedIds.join(',')})`)
      } else {
        query = query.or(`is_public.eq.true,created_by.eq.${userId}`)
      }

      const { data: workflows, error } = await query
        .order('is_default', { ascending: false })
        .order('name')

      if (error) throw error

      // Get most recent usage for each workflow
      const { data: recentUsage, error: usageError } = await supabase
        .from('asset_workflow_progress')
        .select('workflow_id, updated_at')
        .eq('is_started', true)
        .order('updated_at', { ascending: false })

      if (usageError) {
        console.error('Error fetching usage stats:', usageError)
      }

      // Get most recent usage date for each workflow
      const lastUsedDates = (recentUsage || []).reduce((acc, { workflow_id, updated_at }) => {
        if (!acc[workflow_id]) {
          acc[workflow_id] = updated_at
        }
        return acc
      }, {} as Record<string, string>)

      // Add last used dates to workflows
      const workflowsWithUsage = (workflows || []).map(workflow => ({
        ...workflow,
        last_used: lastUsedDates[workflow.id] || null
      }))

      return workflowsWithUsage
    }
  })

  // Find current workflow, fallback to default, then first available
  const currentWorkflow = allWorkflows?.find(w => w.id === currentWorkflowId) ||
                         allWorkflows?.find(w => w.is_default) ||
                         allWorkflows?.[0]


  // Determine which workflows to show in dropdown
  const isSearching = searchTerm.length > 0

  // Get recent workflows (top 4)
  const getRecentWorkflows = () => {
    if (!allWorkflows) return []

    // Sort by: 1) default first, 2) most recently used, 3) name
    const sortedWorkflows = [...allWorkflows].sort((a, b) => {
      if (a.is_default && !b.is_default) return -1
      if (!a.is_default && b.is_default) return 1

      // Sort by most recent usage
      if (a.last_used && b.last_used) {
        return new Date(b.last_used).getTime() - new Date(a.last_used).getTime()
      }
      if (a.last_used && !b.last_used) return -1
      if (!a.last_used && b.last_used) return 1

      return a.name.localeCompare(b.name)
    })

    // Ensure default workflow is always included
    const defaultWorkflow = sortedWorkflows.find(w => w.is_default)
    const nonDefaultWorkflows = sortedWorkflows.filter(w => !w.is_default)

    // Start with default workflow if it exists
    const result = defaultWorkflow ? [defaultWorkflow] : []

    // Add up to 3 more workflows (to make total of 4)
    const remainingSlots = 4 - result.length
    result.push(...nonDefaultWorkflows.slice(0, remainingSlots))

    // Ensure current workflow is included if not already in the list
    if (currentWorkflow && !result.find(w => w.id === currentWorkflow.id)) {
      // Remove the last workflow if we're at capacity
      if (result.length >= 4) {
        result.pop()
      }
      result.push(currentWorkflow)
    }

    return result
  }

  // Filter workflows based on search term
  const workflowsToShow = isSearching
    ? (allWorkflows?.filter(workflow =>
        workflow.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        workflow.description?.toLowerCase().includes(searchTerm.toLowerCase())
      ) || [])
    : getRecentWorkflows()

  const handleWorkflowSelect = (workflowId: string) => {
    onWorkflowChange(workflowId)
    setIsOpen(false)
    setSearchTerm('') // Clear search when selecting
  }

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value)
  }

  // Show button immediately with loading state for name only
  const displayName = currentWorkflow?.name || (isLoading ? 'Loading...' : 'Select Workflow')

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-2 px-3 py-2 text-gray-700 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors"
      >
        <Workflow className="w-5 h-5" />
        <span className="font-medium text-lg">
          {displayName}
        </span>
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => {
              setIsOpen(false)
              setSearchTerm('')
            }}
          />

          {/* Dropdown */}
          <div className="absolute top-full left-0 mt-2 w-80 bg-white border border-gray-200 rounded-xl shadow-lg z-20 overflow-hidden">
            <div className="p-2">
              {/* Search Input */}
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder="Search workflows..."
                  value={searchTerm}
                  onChange={handleSearchChange}
                  className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  autoFocus={isOpen}
                />
              </div>

              <div className="text-xs font-medium text-gray-500 px-3 py-2 uppercase tracking-wider">
                {isSearching ? `Search Results (${workflowsToShow.length})` : 'Recent Workflows'}
              </div>

              <div className="space-y-1 max-h-64 overflow-y-auto">
                {workflowsToShow.map((workflow) => (
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
                      <div className="flex-1">
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
                          {workflow.is_public && !workflow.is_default && (
                            <span className="text-xs bg-green-100 text-green-600 px-2 py-0.5 rounded">
                              Public
                            </span>
                          )}
                          {workflow.last_used && (
                            <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded">
                              {new Date(workflow.last_used).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                        {workflow.description && (
                          <p className="text-xs text-gray-500 mt-1 ml-5">
                            {workflow.description}
                          </p>
                        )}
                      </div>
                      {workflow.id === currentWorkflowId && (
                        <div className="text-xs text-blue-600 font-medium">Current</div>
                      )}
                    </div>
                  </button>
                ))}

                {/* Empty State */}
                {workflowsToShow.length === 0 && !isLoading && (
                  <div className="text-center py-4">
                    <div className="text-sm text-gray-500">
                      {isSearching ? 'No workflows found' : 'No workflows available'}
                    </div>
                    {isSearching && (
                      <div className="text-xs text-gray-400 mt-1">
                        Try adjusting your search terms
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="border-t border-gray-200 my-2" />

              {onViewAllWorkflows && (
                <button
                  onClick={() => {
                    onViewAllWorkflows()
                    setIsOpen(false)
                    setSearchTerm('')
                  }}
                  className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-50 rounded-lg transition-colors"
                >
                  <MoreHorizontal className="w-4 h-4" />
                  <span>See All Workflows</span>
                </button>
              )}

              {onManageWorkflows && (
                <button
                  onClick={() => {
                    onManageWorkflows()
                    setIsOpen(false)
                    setSearchTerm('')
                  }}
                  className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-50 rounded-lg transition-colors"
                >
                  <Settings className="w-4 h-4" />
                  <span>Manage Workflows</span>
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}