/**
 * WorkflowSidebar Component
 *
 * Left sidebar navigation for workflows.
 * Displays search, filters, and categorized workflow lists.
 *
 * Extracted from WorkflowsPage.tsx during Phase 2 refactoring.
 */

import React, { useState, useRef, useEffect } from 'react'
import { Plus, Search, Star, ChevronDown, Home, Archive, ArchiveRestore, Copy, Trash2 } from 'lucide-react'
import { Button } from '../../ui/Button'
import { WorkflowWithStats } from '../../../types/workflow/workflow.types'

export interface WorkflowSidebarProps {
  // Search and filter
  searchTerm: string
  setSearchTerm: (value: string) => void
  filterBy: 'all' | 'my' | 'public' | 'shared' | 'favorites'
  setFilterBy: (value: 'all' | 'my' | 'public' | 'shared' | 'favorites') => void

  // Workflows data
  isLoading: boolean
  persistentWorkflows: WorkflowWithStats[]
  cadenceWorkflows: WorkflowWithStats[]
  archivedWorkflows?: WorkflowWithStats[]

  // Selected workflow
  selectedWorkflow: WorkflowWithStats | null
  onSelectWorkflow: (workflow: WorkflowWithStats | null) => void

  // Expansion states
  isPersistentExpanded: boolean
  setIsPersistentExpanded: (value: boolean) => void
  isCadenceExpanded: boolean
  setIsCadenceExpanded: (value: boolean) => void
  isArchivedExpanded: boolean
  setIsArchivedExpanded: (value: boolean) => void

  // Actions
  onCreateWorkflow: () => void
  onArchiveWorkflow?: (workflowId: string) => void
  onUnarchiveWorkflow?: (workflowId: string) => void
  onDuplicateWorkflow?: (workflowId: string) => void
  onDeleteWorkflow?: (workflowId: string) => void
}

// Context menu state interface
interface ContextMenuState {
  isOpen: boolean
  x: number
  y: number
  workflow: WorkflowWithStats | null
  isArchived: boolean
}

export function WorkflowSidebar({
  searchTerm,
  setSearchTerm,
  filterBy,
  setFilterBy,
  isLoading,
  persistentWorkflows,
  cadenceWorkflows,
  archivedWorkflows,
  selectedWorkflow,
  onSelectWorkflow,
  isPersistentExpanded,
  setIsPersistentExpanded,
  isCadenceExpanded,
  setIsCadenceExpanded,
  isArchivedExpanded,
  setIsArchivedExpanded,
  onCreateWorkflow,
  onArchiveWorkflow,
  onUnarchiveWorkflow,
  onDuplicateWorkflow,
  onDeleteWorkflow
}: WorkflowSidebarProps) {
  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    isOpen: false,
    x: 0,
    y: 0,
    workflow: null,
    isArchived: false
  })
  const contextMenuRef = useRef<HTMLDivElement>(null)

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        setContextMenu(prev => ({ ...prev, isOpen: false }))
      }
    }

    if (contextMenu.isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [contextMenu.isOpen])

  // Handle right-click on workflow
  const handleContextMenu = (event: React.MouseEvent, workflow: WorkflowWithStats, isArchived: boolean = false) => {
    event.preventDefault()
    setContextMenu({
      isOpen: true,
      x: event.clientX,
      y: event.clientY,
      workflow,
      isArchived
    })
  }

  // Handle context menu actions
  const handleArchive = () => {
    if (contextMenu.workflow && onArchiveWorkflow) {
      onArchiveWorkflow(contextMenu.workflow.id)
    }
    setContextMenu(prev => ({ ...prev, isOpen: false }))
  }

  const handleUnarchive = () => {
    if (contextMenu.workflow && onUnarchiveWorkflow) {
      onUnarchiveWorkflow(contextMenu.workflow.id)
    }
    setContextMenu(prev => ({ ...prev, isOpen: false }))
  }

  const handleDuplicate = () => {
    if (contextMenu.workflow && onDuplicateWorkflow) {
      onDuplicateWorkflow(contextMenu.workflow.id)
    }
    setContextMenu(prev => ({ ...prev, isOpen: false }))
  }

  const handleDelete = () => {
    if (contextMenu.workflow && onDeleteWorkflow) {
      onDeleteWorkflow(contextMenu.workflow.id)
    }
    setContextMenu(prev => ({ ...prev, isOpen: false }))
  }

  return (
    <div className="w-80 bg-white border-r border-gray-200 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-gray-900">Workflows</h1>
          <div className="flex items-center space-x-2">
            <Button
              onClick={() => onSelectWorkflow(null)}
              size="sm"
              variant="outline"
              title="Workflow Dashboard"
            >
              <Home className="w-4 h-4" />
            </Button>
            <Button onClick={onCreateWorkflow} size="sm">
              <Plus className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input
            type="text"
            placeholder="Search workflows..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 pr-4 py-2 w-full border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
          />
        </div>

        {/* Filter Buttons */}
        <div className="flex flex-wrap gap-2 mt-3">
          <button
            onClick={() => setFilterBy('all')}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              filterBy === 'all' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilterBy('my')}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              filterBy === 'my' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Mine
          </button>
          <button
            onClick={() => setFilterBy('shared')}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              filterBy === 'shared' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Shared
          </button>
        </div>
      </div>

      {/* Workflow List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          /* Loading skeleton */
          <div className="p-4 space-y-3 animate-pulse">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="p-3 border border-gray-200 rounded-lg">
                <div className="flex items-center space-x-3">
                  <div className="w-3 h-3 bg-gray-300 rounded-full"></div>
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                    <div className="h-3 bg-gray-200 rounded w-full"></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* Persistent Workflows Section */}
            {persistentWorkflows.length > 0 && (
              <div>
                <button
                  onClick={() => setIsPersistentExpanded(!isPersistentExpanded)}
                  className="w-full px-3 py-2 flex items-center justify-between hover:bg-gray-50 transition-colors border-b border-gray-200"
                >
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Persistent Workflows ({persistentWorkflows.length})
                  </h3>
                  <ChevronDown
                    className={`w-4 h-4 text-gray-400 transition-transform ${
                      isPersistentExpanded ? 'transform rotate-180' : ''
                    }`}
                  />
                </button>
                {isPersistentExpanded && (
                  <div className="border-b border-gray-200">
                    {persistentWorkflows.map((workflow) => (
                      <button
                        key={workflow.id}
                        onClick={() => onSelectWorkflow(workflow)}
                        onContextMenu={(e) => handleContextMenu(e, workflow, false)}
                        className={`w-full text-left p-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                          selectedWorkflow?.id === workflow.id ? 'bg-blue-50 border-blue-200' : ''
                        }`}
                      >
                        <div className="flex items-center space-x-3">
                          <div
                            className="w-3 h-3 rounded-full flex-shrink-0"
                            style={{ backgroundColor: workflow.color }}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center space-x-2">
                              <h3 className="font-medium text-sm text-gray-900 truncate">{workflow.name}</h3>
                              {workflow.is_favorited && (
                                <Star className="w-3 h-3 text-yellow-500 fill-current flex-shrink-0" />
                              )}
                            </div>
                            <p className="text-xs text-gray-500 truncate mt-1">{workflow.description}</p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Cadence Workflows Section */}
            {cadenceWorkflows.length > 0 && (
              <div>
                <button
                  onClick={() => setIsCadenceExpanded(!isCadenceExpanded)}
                  className="w-full px-3 py-2 flex items-center justify-between hover:bg-gray-50 transition-colors border-b border-gray-200"
                >
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Cadence Workflows ({cadenceWorkflows.length})
                  </h3>
                  <ChevronDown
                    className={`w-4 h-4 text-gray-400 transition-transform ${
                      isCadenceExpanded ? 'transform rotate-180' : ''
                    }`}
                  />
                </button>
                {isCadenceExpanded && (
                  <div className="border-b border-gray-200">
                    {cadenceWorkflows.map((workflow) => (
                      <button
                        key={workflow.id}
                        onClick={() => onSelectWorkflow(workflow)}
                        onContextMenu={(e) => handleContextMenu(e, workflow, false)}
                        className={`w-full text-left p-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                          selectedWorkflow?.id === workflow.id ? 'bg-blue-50 border-blue-200' : ''
                        }`}
                      >
                        <div className="flex items-center space-x-3">
                          <div
                            className="w-3 h-3 rounded-full flex-shrink-0"
                            style={{ backgroundColor: workflow.color }}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center space-x-2">
                              <h3 className="font-medium text-sm text-gray-900 truncate">{workflow.name}</h3>
                              {workflow.is_favorited && (
                                <Star className="w-3 h-3 text-yellow-500 fill-current flex-shrink-0" />
                              )}
                            </div>
                            <p className="text-xs text-gray-500 truncate mt-1">{workflow.description}</p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {persistentWorkflows.length === 0 && cadenceWorkflows.length === 0 && (
              <div className="p-4 text-center text-gray-500 text-sm">
                {searchTerm ? 'No workflows found' : 'No workflows available'}
              </div>
            )}

            {/* Archived Workflows Section */}
            {archivedWorkflows && archivedWorkflows.length > 0 && (
              <div className="mt-6 pt-4 border-t border-gray-200">
                <button
                  onClick={() => setIsArchivedExpanded(!isArchivedExpanded)}
                  className="w-full px-3 pb-2 flex items-center justify-between hover:bg-gray-50 transition-colors"
                >
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Archived ({archivedWorkflows.length})
                  </h3>
                  <ChevronDown
                    className={`w-4 h-4 text-gray-400 transition-transform ${
                      isArchivedExpanded ? 'transform rotate-180' : ''
                    }`}
                  />
                </button>
                {isArchivedExpanded && (
                  <div className="space-y-1 pt-2">
                    {archivedWorkflows.map((workflow) => (
                      <button
                        key={workflow.id}
                        onClick={() => onSelectWorkflow(workflow)}
                        onContextMenu={(e) => handleContextMenu(e, workflow, true)}
                        className={`w-full text-left p-3 rounded-lg hover:bg-gray-50 transition-colors ${
                          selectedWorkflow?.id === workflow.id ? 'bg-blue-50' : ''
                        }`}
                      >
                        <div className="flex items-center space-x-3">
                          <div
                            className="w-3 h-3 rounded-full flex-shrink-0 opacity-50"
                            style={{ backgroundColor: workflow.color }}
                          />
                          <div className="flex-1 min-w-0">
                            <h3 className="font-medium text-sm text-gray-500 truncate">{workflow.name}</h3>
                            <p className="text-xs text-gray-400 truncate mt-1">{workflow.description}</p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu.isOpen && (
        <div
          ref={contextMenuRef}
          className="fixed bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 min-w-[160px]"
          style={{
            left: contextMenu.x,
            top: contextMenu.y
          }}
        >
          {contextMenu.isArchived ? (
            // Unarchive option for archived workflows
            <button
              onClick={handleUnarchive}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center space-x-2"
            >
              <ArchiveRestore className="w-4 h-4" />
              <span>Restore</span>
            </button>
          ) : (
            // Archive option for active workflows
            <button
              onClick={handleArchive}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center space-x-2"
            >
              <Archive className="w-4 h-4" />
              <span>Archive</span>
            </button>
          )}

          {onDuplicateWorkflow && (
            <button
              onClick={handleDuplicate}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center space-x-2"
            >
              <Copy className="w-4 h-4" />
              <span>Duplicate</span>
            </button>
          )}

          {onDeleteWorkflow && (
            <>
              <div className="border-t border-gray-100 my-1" />
              <button
                onClick={handleDelete}
                className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center space-x-2"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
