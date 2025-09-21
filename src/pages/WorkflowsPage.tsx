import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Filter, Workflow, Users, Star, Clock, BarChart3, Settings, Trash2, Edit3, Copy, Eye, TrendingUp, StarOff } from 'lucide-react'
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
  usage_count: number
  active_assets: number
  completed_assets: number
  creator_name?: string
  is_favorited?: boolean
}

interface WorkflowsPageProps {
  className?: string
}

export function WorkflowsPage({ className = '' }: WorkflowsPageProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [filterBy, setFilterBy] = useState<'all' | 'my' | 'public' | 'shared' | 'favorites'>('all')
  const [sortBy, setSortBy] = useState<'name' | 'usage' | 'created' | 'updated'>('usage')
  const [showWorkflowManager, setShowWorkflowManager] = useState(false)
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null)
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

      // Calculate statistics for each workflow
      const workflowsWithStats: WorkflowWithStats[] = (workflowData || []).map(workflow => {
        const workflowUsage = usageStats?.filter(stat => stat.workflow_id === workflow.id) || []
        const activeAssets = workflowUsage.filter(stat => stat.is_started && !stat.completed_at).length
        const completedAssets = workflowUsage.filter(stat => stat.completed_at).length
        const totalUsage = workflowUsage.length

        const creator = workflow.users
        const creatorName = creator ? `${creator.first_name || ''} ${creator.last_name || ''}`.trim() || creator.email : ''

        return {
          ...workflow,
          usage_count: totalUsage,
          active_assets: activeAssets,
          completed_assets: completedAssets,
          creator_name: creatorName,
          is_favorited: favoritedWorkflowIds.has(workflow.id)
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

  const handleEditWorkflow = (workflowId: string) => {
    setSelectedWorkflow(workflowId)
    setShowWorkflowManager(true)
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
      <div className={`space-y-6 ${className}`}>
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-48 mb-6"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="h-64 bg-gray-200 rounded-lg"></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Workflows</h1>
          <p className="text-gray-600 mt-1">Manage and organize your investment research workflows</p>
        </div>
        <Button onClick={handleCreateWorkflow} className="flex items-center space-x-2">
          <Plus className="w-4 h-4" />
          <span>Create Workflow</span>
        </Button>
      </div>

      {/* Filters and Search */}
      <Card>
        <div className="flex flex-col sm:flex-row gap-4">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search workflows..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 w-full border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Filter */}
          <select
            value={filterBy}
            onChange={(e) => setFilterBy(e.target.value as any)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="all">All Workflows</option>
            <option value="favorites">⭐ Favorites</option>
            <option value="my">My Workflows</option>
            <option value="public">Public Workflows</option>
            <option value="shared">Shared with Me</option>
          </select>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="usage">Most Used</option>
            <option value="name">Name</option>
            <option value="created">Recently Created</option>
            <option value="updated">Recently Updated</option>
          </select>
        </div>
      </Card>

      {/* Workflows Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredWorkflows.map((workflow) => (
          <Card key={workflow.id} className="hover:shadow-lg transition-shadow">
            <div className="space-y-4">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-3">
                  <div
                    className="w-4 h-4 rounded-full"
                    style={{ backgroundColor: workflow.color }}
                  />
                  <div>
                    <h3 className="font-semibold text-gray-900">{workflow.name}</h3>
                    {workflow.description && (
                      <p className="text-sm text-gray-600 mt-1">{workflow.description}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center space-x-1">
                  <button
                    onClick={() => toggleFavoriteMutation.mutate({
                      workflowId: workflow.id,
                      isFavorited: workflow.is_favorited || false
                    })}
                    className={`p-1 rounded-full hover:bg-gray-100 transition-colors ${
                      workflow.is_favorited ? 'text-yellow-500' : 'text-gray-400'
                    }`}
                    title={workflow.is_favorited ? 'Remove from favorites' : 'Add to favorites'}
                    disabled={toggleFavoriteMutation.isPending}
                  >
                    {workflow.is_favorited ? (
                      <Star className="w-4 h-4 fill-current" />
                    ) : (
                      <Star className="w-4 h-4" />
                    )}
                  </button>
                  {workflow.is_default && (
                    <Badge variant="secondary" size="sm">Default</Badge>
                  )}
                  {workflow.is_public && (
                    <Badge variant="success" size="sm">Public</Badge>
                  )}
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">{workflow.usage_count}</div>
                  <div className="text-xs text-gray-500">Total Uses</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-600">{workflow.active_assets}</div>
                  <div className="text-xs text-gray-500">Active</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{workflow.completed_assets}</div>
                  <div className="text-xs text-gray-500">Completed</div>
                </div>
              </div>

              {/* Creator and Date */}
              <div className="text-xs text-gray-500 space-y-1">
                {workflow.creator_name && (
                  <div className="flex items-center space-x-1">
                    <Users className="w-3 h-3" />
                    <span>Created by {workflow.creator_name}</span>
                  </div>
                )}
                <div className="flex items-center space-x-1">
                  <Clock className="w-3 h-3" />
                  <span>Updated {new Date(workflow.updated_at).toLocaleDateString()}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between pt-2 border-t border-gray-200">
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handleEditWorkflow(workflow.id)}
                    className="p-1 text-gray-400 hover:text-blue-600 rounded"
                    title="Edit workflow"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => duplicateWorkflowMutation.mutate(workflow.id)}
                    className="p-1 text-gray-400 hover:text-green-600 rounded"
                    title="Duplicate workflow"
                    disabled={duplicateWorkflowMutation.isPending}
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  {!workflow.is_default && (
                    <button
                      onClick={() => handleDeleteWorkflow(workflow.id, workflow.name)}
                      className="p-1 text-gray-400 hover:text-red-600 rounded"
                      title="Delete workflow"
                      disabled={deleteWorkflowMutation.isPending}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleEditWorkflow(workflow.id)}
                >
                  <Eye className="w-3 h-3 mr-1" />
                  View Details
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Empty State */}
      {filteredWorkflows.length === 0 && !isLoading && (
        <div className="text-center py-12">
          <Workflow className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {searchTerm ? 'No workflows found' : 'No workflows yet'}
          </h3>
          <p className="text-gray-500 mb-6">
            {searchTerm
              ? 'Try adjusting your search terms or filters'
              : 'Get started by creating your first workflow to organize your investment research process'
            }
          </p>
          {!searchTerm && (
            <Button onClick={handleCreateWorkflow}>
              <Plus className="w-4 h-4 mr-2" />
              Create Your First Workflow
            </Button>
          )}
        </div>
      )}

      {/* Workflow Manager Modal */}
      {showWorkflowManager && (
        <WorkflowManager
          isOpen={true}
          onClose={() => {
            setShowWorkflowManager(false)
            setSelectedWorkflow(null)
          }}
          selectedWorkflowId={selectedWorkflow}
          onWorkflowSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['workflows-full'] })
          }}
        />
      )}
    </div>
  )
}