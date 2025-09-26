import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Filter, Workflow, Users, Star, Clock, BarChart3, Settings, Trash2, Edit3, Copy, Eye, TrendingUp, StarOff, Calendar, Target, CheckSquare, UserCog, Shield } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { WorkflowManager } from '../components/ui/WorkflowManager'

interface WorkflowWithStats {
  id: string
  name: string
  description: string
  color: string
  is_default: boolean
  is_public: boolean
  created_by: string
  created_at: string
  updated_at: string
  cadence_days: number
  usage_count: number
  active_assets: number
  completed_assets: number
  creator_name?: string
  is_favorited?: boolean
  user_permission?: 'read' | 'write' | 'admin' | 'owner'
  collaborators?: WorkflowCollaborator[]
  stages?: WorkflowStage[]
}

interface WorkflowCollaborator {
  id: string
  user_id: string
  permission: 'read' | 'write' | 'admin'
  user_name: string
  user_email: string
}

interface WorkflowStage {
  id: string
  stage_key: string
  stage_label: string
  stage_description: string
  sort_order: number
  standard_deadline_days: number
  checklist_templates?: WorkflowChecklistTemplate[]
}

interface WorkflowChecklistTemplate {
  id: string
  stage_id: string
  item_id: string
  item_text: string
  sort_order: number
  is_required: boolean
}

interface WorkflowsPageProps {
  className?: string
}

export function WorkflowsPage({ className = '' }: WorkflowsPageProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [filterBy, setFilterBy] = useState<'all' | 'my' | 'public' | 'shared' | 'favorites'>('all')
  const [sortBy, setSortBy] = useState<'name' | 'usage' | 'created' | 'updated'>('usage')
  const [showWorkflowManager, setShowWorkflowManager] = useState(false)
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowWithStats | null>(null)
  const [activeView, setActiveView] = useState<'overview' | 'stages' | 'checklist' | 'admins' | 'cadence'>('overview')
  const queryClient = useQueryClient()

  // Query to get all workflows with statistics
  const { data: workflows, isLoading } = useQuery({
    queryKey: ['workflows-full', filterBy, sortBy],
    queryFn: async () => {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id

      if (!userId) return []

      // Get workflows based on filter
      let workflowQuery = supabase.from('workflows').select(`
        *,
        users:created_by (
          first_name,
          last_name,
          email
        )
      `)

      switch (filterBy) {
        case 'my':
          workflowQuery = workflowQuery.eq('created_by', userId)
          break
        case 'public':
          workflowQuery = workflowQuery.eq('is_public', true)
          break
        case 'shared':
          // Get shared workflow IDs first
          const { data: sharedIds } = await supabase
            .from('workflow_collaborations')
            .select('workflow_id')
            .eq('user_id', userId)

          const ids = sharedIds?.map(s => s.workflow_id) || []
          if (ids.length === 0) return []
          workflowQuery = workflowQuery.in('id', ids)
          break
        case 'favorites':
          // Get favorited workflow IDs first
          const { data: favoriteIds } = await supabase
            .from('workflow_favorites')
            .select('workflow_id')
            .eq('user_id', userId)

          const favIds = favoriteIds?.map(f => f.workflow_id) || []
          if (favIds.length === 0) return []
          workflowQuery = workflowQuery.in('id', favIds)
          break
        case 'all':
        default:
          // Get shared workflow IDs
          const { data: allSharedIds } = await supabase
            .from('workflow_collaborations')
            .select('workflow_id')
            .eq('user_id', userId)

          const allIds = allSharedIds?.map(s => s.workflow_id) || []
          const sharedFilter = allIds.length > 0 ? `,id.in.(${allIds.join(',')})` : ''
          workflowQuery = workflowQuery.or(`is_public.eq.true,created_by.eq.${userId}${sharedFilter}`)
          break
      }

      const { data: workflowData, error } = await workflowQuery

      if (error) throw error

      // Get usage statistics
      const { data: usageStats } = await supabase
        .from('asset_workflow_progress')
        .select('workflow_id, is_started, completed_at')

      // Get user's favorited workflows
      const { data: userFavorites } = await supabase
        .from('workflow_favorites')
        .select('workflow_id')
        .eq('user_id', userId)

      const favoritedWorkflowIds = new Set(userFavorites?.map(f => f.workflow_id) || [])

      // Get collaborator information
      const { data: collaborators } = await supabase
        .from('workflow_collaborations')
        .select(`
          *,
          users (
            first_name,
            last_name,
            email
          )
        `)

      // Get stages information
      const { data: stages } = await supabase
        .from('workflow_stages')
        .select('*')
        .order('sort_order')

      // Calculate statistics for each workflow
      const workflowsWithStats: WorkflowWithStats[] = (workflowData || []).map(workflow => {
        const workflowUsage = usageStats?.filter(stat => stat.workflow_id === workflow.id) || []
        const activeAssets = workflowUsage.filter(stat => stat.is_started && !stat.completed_at).length
        const completedAssets = workflowUsage.filter(stat => stat.completed_at).length
        const totalUsage = workflowUsage.length

        const creator = workflow.users
        const creatorName = creator ? `${creator.first_name || ''} ${creator.last_name || ''}`.trim() || creator.email : ''

        // Get collaborators for this workflow
        const workflowCollaborators = (collaborators || []).filter(c => c.workflow_id === workflow.id).map(c => ({
          id: c.id,
          user_id: c.user_id,
          permission: c.permission,
          user_name: c.users ? `${c.users.first_name || ''} ${c.users.last_name || ''}`.trim() || c.users.email : '',
          user_email: c.users?.email || ''
        }))

        // Get stages for this workflow
        const workflowStages = (stages || []).filter(s => s.workflow_id === workflow.id)

        // Determine user permission
        let userPermission: 'read' | 'write' | 'admin' | 'owner' = 'read'
        if (workflow.created_by === userId) {
          userPermission = 'owner'
        } else {
          const userCollab = workflowCollaborators.find(c => c.user_id === userId)
          if (userCollab) {
            userPermission = userCollab.permission as 'read' | 'write' | 'admin'
          }
        }

        return {
          ...workflow,
          usage_count: totalUsage,
          active_assets: activeAssets,
          completed_assets: completedAssets,
          creator_name: creatorName,
          is_favorited: favoritedWorkflowIds.has(workflow.id),
          user_permission: userPermission,
          collaborators: workflowCollaborators,
          stages: workflowStages
        }
      })

      // Sort workflows (favorites always first)
      workflowsWithStats.sort((a, b) => {
        // Always show favorites first
        if (a.is_favorited && !b.is_favorited) return -1
        if (!a.is_favorited && b.is_favorited) return 1

        // Then sort by the selected criteria
        switch (sortBy) {
          case 'usage':
            if (a.usage_count !== b.usage_count) return b.usage_count - a.usage_count
            return a.name.localeCompare(b.name)
          case 'created':
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          case 'updated':
            return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
          case 'name':
          default:
            return a.name.localeCompare(b.name)
        }
      })

      return workflowsWithStats
    }
  })

  // Filter workflows by search term
  const filteredWorkflows = workflows?.filter(workflow =>
    workflow.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    workflow.description.toLowerCase().includes(searchTerm.toLowerCase())
  ) || []

  const handleCreateWorkflow = () => {
    setSelectedWorkflow(null)
    setShowWorkflowManager(true)
  }

  const handleSelectWorkflow = (workflow: WorkflowWithStats) => {
    setSelectedWorkflow(workflow)
    setActiveView('overview')
  }

  const handleEditWorkflow = (workflowId: string) => {
    const workflow = workflows?.find(w => w.id === workflowId)
    if (workflow) {
      setSelectedWorkflow(workflow)
      setShowWorkflowManager(true)
    }
  }

  const duplicateWorkflowMutation = useMutation({
    mutationFn: async (workflowId: string) => {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id

      if (!userId) throw new Error('Not authenticated')

      // Get the original workflow
      const { data: originalWorkflow, error: fetchError } = await supabase
        .from('workflows')
        .select('*')
        .eq('id', workflowId)
        .single()

      if (fetchError) throw fetchError

      // Create duplicate workflow
      const { data: newWorkflow, error: createError } = await supabase
        .from('workflows')
        .insert({
          name: `${originalWorkflow.name} (Copy)`,
          description: originalWorkflow.description,
          color: originalWorkflow.color,
          is_public: false,
          is_default: false,
          created_by: userId
        })
        .select()
        .single()

      if (createError) throw createError

      // Get and duplicate workflow stages
      const { data: originalStages, error: stagesError } = await supabase
        .from('workflow_stages')
        .select('*')
        .eq('workflow_id', workflowId)
        .order('sort_order')

      if (stagesError) throw stagesError

      if (originalStages && originalStages.length > 0) {
        const newStages = originalStages.map(stage => ({
          workflow_id: newWorkflow.id,
          stage_key: stage.stage_key,
          stage_label: stage.stage_label,
          stage_description: stage.stage_description,
          sort_order: stage.sort_order,
          created_by: userId
        }))

        const { error: insertStagesError } = await supabase
          .from('workflow_stages')
          .insert(newStages)

        if (insertStagesError) throw insertStagesError
      }

      return newWorkflow
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows-full'] })
    },
    onError: (error) => {
      console.error('Error duplicating workflow:', error)
      alert('Failed to duplicate workflow. Please try again.')
    }
  })

  const deleteWorkflowMutation = useMutation({
    mutationFn: async (workflowId: string) => {
      // First delete workflow stages
      const { error: stagesError } = await supabase
        .from('workflow_stages')
        .delete()
        .eq('workflow_id', workflowId)

      if (stagesError) throw stagesError

      // Then delete the workflow
      const { error: workflowError } = await supabase
        .from('workflows')
        .delete()
        .eq('id', workflowId)

      if (workflowError) throw workflowError
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows-full'] })
    },
    onError: (error) => {
      console.error('Error deleting workflow:', error)
      alert('Failed to delete workflow. Please try again.')
    }
  })

  const toggleFavoriteMutation = useMutation({
    mutationFn: async ({ workflowId, isFavorited }: { workflowId: string, isFavorited: boolean }) => {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id

      if (!userId) throw new Error('Not authenticated')

      if (isFavorited) {
        // Remove from favorites
        const { error } = await supabase
          .from('workflow_favorites')
          .delete()
          .eq('workflow_id', workflowId)
          .eq('user_id', userId)

        if (error) throw error
      } else {
        // Add to favorites
        const { error } = await supabase
          .from('workflow_favorites')
          .insert({
            workflow_id: workflowId,
            user_id: userId
          })

        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows-full'] })
    },
    onError: (error) => {
      console.error('Error toggling favorite:', error)
      alert('Failed to update favorite. Please try again.')
    }
  })

  const handleDeleteWorkflow = (workflowId: string, workflowName: string) => {
    if (confirm(`Are you sure you want to delete "${workflowName}"? This action cannot be undone.`)) {
      deleteWorkflowMutation.mutate(workflowId)
    }
  }

  if (isLoading) {
    return (
      <div className={`flex h-full ${className}`}>
        <div className="w-80 border-r border-gray-200 animate-pulse">
          <div className="p-4">
            <div className="h-8 bg-gray-200 rounded w-32 mb-4"></div>
            <div className="space-y-2">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-16 bg-gray-200 rounded"></div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex-1 p-6 animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-64 mb-6"></div>
          <div className="h-96 bg-gray-200 rounded"></div>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex h-full ${className}`}>
      {/* Left Sidebar - Workflow List */}
      <div className="w-80 border-r border-gray-200 bg-gray-50 overflow-y-auto">
        <div className="p-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Workflows</h2>
            <Button size="sm" onClick={handleCreateWorkflow}>
              <Plus className="w-4 h-4" />
            </Button>
          </div>

          {/* Search */}
          <div className="relative mb-4">
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
          <div className="grid grid-cols-2 gap-2 mb-4">
            <button
              onClick={() => setFilterBy('all')}
              className={`text-xs px-2 py-1 rounded ${filterBy === 'all' ? 'bg-blue-100 text-blue-700' : 'bg-white text-gray-600 hover:bg-gray-100'}`}
            >
              All
            </button>
            <button
              onClick={() => setFilterBy('favorites')}
              className={`text-xs px-2 py-1 rounded ${filterBy === 'favorites' ? 'bg-blue-100 text-blue-700' : 'bg-white text-gray-600 hover:bg-gray-100'}`}
            >
              ⭐ Favorites
            </button>
            <button
              onClick={() => setFilterBy('my')}
              className={`text-xs px-2 py-1 rounded ${filterBy === 'my' ? 'bg-blue-100 text-blue-700' : 'bg-white text-gray-600 hover:bg-gray-100'}`}
            >
              My Workflows
            </button>
            <button
              onClick={() => setFilterBy('shared')}
              className={`text-xs px-2 py-1 rounded ${filterBy === 'shared' ? 'bg-blue-100 text-blue-700' : 'bg-white text-gray-600 hover:bg-gray-100'}`}
            >
              Shared
            </button>
          </div>

          {/* Workflow List */}
          <div className="space-y-2">
            {filteredWorkflows.map((workflow) => (
              <div
                key={workflow.id}
                onClick={() => handleSelectWorkflow(workflow)}
                className={`p-3 rounded-lg cursor-pointer transition-colors ${
                  selectedWorkflow?.id === workflow.id
                    ? 'bg-blue-50 border border-blue-200'
                    : 'bg-white hover:bg-gray-50 border border-gray-200'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: workflow.color }}
                    />
                    <h3 className="font-medium text-sm text-gray-900 truncate">{workflow.name}</h3>
                  </div>
                  <div className="flex items-center space-x-1">
                    {workflow.is_favorited && (
                      <Star className="w-3 h-3 text-yellow-500 fill-current" />
                    )}
                    {workflow.is_default && (
                      <Badge variant="secondary" size="xs">Default</Badge>
                    )}
                  </div>
                </div>

                {workflow.description && (
                  <p className="text-xs text-gray-600 mb-2 line-clamp-2">{workflow.description}</p>
                )}

                <div className="flex justify-between text-xs text-gray-500">
                  <span>{workflow.usage_count} uses</span>
                  <span>{workflow.active_assets} active</span>
                </div>

                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center space-x-1">
                    {(workflow.user_permission === 'admin' || workflow.user_permission === 'owner') && (
                      <Shield className="w-3 h-3 text-blue-500" title="Admin access" />
                    )}
                    <Users className="w-3 h-3" />
                    <span className="text-xs">{(workflow.collaborators?.length || 0) + 1}</span>
                  </div>
                  <div className="flex space-x-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleFavoriteMutation.mutate({
                          workflowId: workflow.id,
                          isFavorited: workflow.is_favorited || false
                        })
                      }}
                      className="p-1 hover:bg-gray-200 rounded"
                    >
                      <Star className={`w-3 h-3 ${
                        workflow.is_favorited ? 'text-yellow-500 fill-current' : 'text-gray-400'
                      }`} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleEditWorkflow(workflow.id)
                      }}
                      className="p-1 hover:bg-gray-200 rounded"
                    >
                      <Settings className="w-3 h-3 text-gray-400" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto">
        {selectedWorkflow ? (
          <div className="p-6">
            {/* Workflow Header */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-4">
                <div
                  className="w-6 h-6 rounded-full"
                  style={{ backgroundColor: selectedWorkflow.color }}
                />
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">{selectedWorkflow.name}</h1>
                  <p className="text-gray-600">{selectedWorkflow.description}</p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <Button variant="outline" onClick={() => handleEditWorkflow(selectedWorkflow.id)}>
                  <Edit3 className="w-4 h-4 mr-2" />
                  Edit
                </Button>
                <Button onClick={() => duplicateWorkflowMutation.mutate(selectedWorkflow.id)}>
                  <Copy className="w-4 h-4 mr-2" />
                  Duplicate
                </Button>
              </div>
            </div>

            {/* View Tabs */}
            <div className="border-b border-gray-200 mb-6">
              <nav className="flex space-x-8">
                {[
                  { id: 'overview', label: 'Overview', icon: BarChart3 },
                  { id: 'stages', label: 'Stages', icon: Target },
                  { id: 'checklist', label: 'Checklist Templates', icon: CheckSquare },
                  { id: 'admins', label: 'Team & Admins', icon: UserCog },
                  { id: 'cadence', label: 'Cadence', icon: Calendar }
                ].map((tab) => {
                  const Icon = tab.icon
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveView(tab.id as any)}
                      className={`flex items-center space-x-2 py-2 px-1 border-b-2 font-medium text-sm ${
                        activeView === tab.id
                          ? 'border-blue-500 text-blue-600'
                          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{tab.label}</span>
                    </button>
                  )
                })}
              </nav>
            </div>

            {/* Content based on active view */}
            {activeView === 'overview' && (
              <div className="space-y-6">
                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                  <Card>
                    <div className="text-center">
                      <div className="text-3xl font-bold text-blue-600">{selectedWorkflow.usage_count}</div>
                      <div className="text-sm text-gray-500">Total Uses</div>
                    </div>
                  </Card>
                  <Card>
                    <div className="text-center">
                      <div className="text-3xl font-bold text-orange-600">{selectedWorkflow.active_assets}</div>
                      <div className="text-sm text-gray-500">Active Assets</div>
                    </div>
                  </Card>
                  <Card>
                    <div className="text-center">
                      <div className="text-3xl font-bold text-green-600">{selectedWorkflow.completed_assets}</div>
                      <div className="text-sm text-gray-500">Completed</div>
                    </div>
                  </Card>
                  <Card>
                    <div className="text-center">
                      <div className="text-3xl font-bold text-purple-600">{selectedWorkflow.cadence_days}</div>
                      <div className="text-sm text-gray-500">Day Cadence</div>
                    </div>
                  </Card>
                </div>

                {/* Workflow Details */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Card>
                    <h3 className="text-lg font-semibold mb-4">Workflow Details</h3>
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Created by:</span>
                        <span className="font-medium">{selectedWorkflow.creator_name}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Created:</span>
                        <span>{new Date(selectedWorkflow.created_at).toLocaleDateString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Last updated:</span>
                        <span>{new Date(selectedWorkflow.updated_at).toLocaleDateString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Visibility:</span>
                        <div className="space-x-2">
                          {selectedWorkflow.is_public && (
                            <Badge variant="success">Public</Badge>
                          )}
                          {selectedWorkflow.is_default && (
                            <Badge variant="secondary">Default</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </Card>

                  <Card>
                    <h3 className="text-lg font-semibold mb-4">Stages Overview</h3>
                    <div className="space-y-2">
                      {selectedWorkflow.stages?.map((stage, index) => (
                        <div key={stage.id} className="flex items-center space-x-3 p-2 rounded-lg bg-gray-50">
                          <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-xs font-medium text-blue-600">
                            {index + 1}
                          </div>
                          <div className="flex-1">
                            <div className="font-medium text-sm">{stage.stage_label}</div>
                            <div className="text-xs text-gray-600">{stage.stage_description}</div>
                          </div>
                          <div className="text-xs text-gray-500">
                            {stage.standard_deadline_days}d
                          </div>
                        </div>
                      )) || (
                        <div className="text-center py-4 text-gray-500">
                          No stages defined
                        </div>
                      )}
                    </div>
                  </Card>
                </div>
              </div>
            )}

            {/* Placeholder for other views */}
            {activeView !== 'overview' && (
              <div className="text-center py-12">
                <div className="text-gray-500">
                  {activeView === 'stages' && 'Stages management coming soon...'}
                  {activeView === 'checklist' && 'Checklist template management coming soon...'}
                  {activeView === 'admins' && 'Team and admin management coming soon...'}
                  {activeView === 'cadence' && 'Cadence settings coming soon...'}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Workflow className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                {filteredWorkflows.length === 0 ? 'No workflows found' : 'Select a workflow'}
              </h3>
              <p className="text-gray-500 mb-6">
                {filteredWorkflows.length === 0
                  ? 'Create your first workflow to get started'
                  : 'Choose a workflow from the sidebar to view details, manage stages, and configure settings'
                }
              </p>
              {filteredWorkflows.length === 0 && (
                <Button onClick={handleCreateWorkflow}>
                  <Plus className="w-4 h-4 mr-2" />
                  Create Your First Workflow
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Workflow Manager Modal */}
      {showWorkflowManager && (
        <WorkflowManager
          isOpen={true}
          onClose={() => {
            setShowWorkflowManager(false)
            setSelectedWorkflow(null)
          }}
          selectedWorkflowId={selectedWorkflow?.id || null}
          onWorkflowSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['workflows-full'] })
          }}
        />
      )}
    </div>
  )
}