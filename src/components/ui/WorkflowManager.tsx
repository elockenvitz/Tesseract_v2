import React, { useState } from 'react'
import { X, Plus, Edit, Trash2, Save, ArrowUp, ArrowDown, Palette, Eye, Workflow, Settings2, Users, UserPlus, UserMinus, Search } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from './Button'
import { Badge } from './Badge'
import { Card } from './Card'

interface WorkflowManagerProps {
  isOpen: boolean
  onClose: () => void
  mode?: 'full' | 'selection' // full = complete editor, selection = enhanced for asset page
  currentWorkflowId?: string // for asset page integration
  onWorkflowSelect?: (workflowId: string) => void // callback for asset page
}

interface Workflow {
  id: string
  name: string
  description: string
  color: string
  is_default: boolean
  is_public: boolean
  created_by: string
  cadence_days: number
  cadence_timeframe?: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'semi-annually' | 'annually'
  kickoff_cadence?: 'immediate' | 'month-start' | 'quarter-start' | 'year-start' | 'custom-date'
  kickoff_custom_date?: string
}

interface WorkflowStage {
  id: string
  workflow_id: string
  stage_key: string
  stage_label: string
  stage_description: string
  stage_color: string
  stage_icon: string
  sort_order: number
  standard_deadline_days: number
  suggested_priorities: string[]
}

interface WorkflowCollaboration {
  id: string
  workflow_id: string
  user_id: string
  permission: 'read' | 'write' | 'admin'
  invited_by: string
  created_at: string
  user?: {
    email: string
    first_name?: string
    last_name?: string
  }
}

interface User {
  id: string
  email: string
  first_name?: string
  last_name?: string
}

const ICON_OPTIONS = [
  'clock', 'alert-triangle', 'zap', 'trending-up', 'target', 'check-circle',
  'play', 'pause', 'stop', 'fast-forward', 'rewind', 'flag', 'star',
  'activity', 'bar-chart', 'pie-chart', 'eye', 'search', 'filter'
]

const COLOR_OPTIONS = [
  'gray-600', 'red-600', 'orange-600', 'yellow-500', 'green-400', 'green-700',
  'blue-500', 'blue-600', 'indigo-600', 'purple-600', 'pink-600', 'teal-500'
]

export function WorkflowManager({
  isOpen,
  onClose,
  mode = 'full',
  currentWorkflowId,
  onWorkflowSelect
}: WorkflowManagerProps) {
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(currentWorkflowId || null)
  const [editingWorkflow, setEditingWorkflow] = useState<Partial<Workflow> | null>(null)
  const [editingStages, setEditingStages] = useState<WorkflowStage[]>([])
  const [isCreatingNew, setIsCreatingNew] = useState(false)
  const [showCollaborators, setShowCollaborators] = useState(false)
  const [newCollaboratorEmail, setNewCollaboratorEmail] = useState('')
  const [newCollaboratorPermission, setNewCollaboratorPermission] = useState<'read' | 'write' | 'admin'>('read')
  const [showUserDropdown, setShowUserDropdown] = useState(false)
  const [filteredUsers, setFilteredUsers] = useState<User[]>([])
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean
    collaborationId: string | null
    userEmail: string
  }>({
    isOpen: false,
    collaborationId: null,
    userEmail: ''
  })
  const queryClient = useQueryClient()
  const { user } = useAuth()

  // Enhanced state for selection mode
  const [viewMode, setViewMode] = useState<'list' | 'details' | 'create'>('list')
  const [searchTerm, setSearchTerm] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'my' | 'shared' | 'public'>('all')

  const { data: workflows, isLoading } = useQuery({
    queryKey: ['workflows'],
    queryFn: async () => {
      console.log('Fetching workflows...')
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id
      console.log('User ID:', userId)

      let query = supabase
        .from('workflows')
        .select('*')

      if (userId) {
        // Get shared workflow IDs first
        const sharedIds = await getSharedWorkflowIds(userId)
        console.log('Shared workflow IDs:', sharedIds)

        // Build the OR condition based on what we have
        if (sharedIds.length > 0) {
          // Get workflows the user owns, public workflows, or workflows shared with them
          query = query.or(`is_public.eq.true,created_by.eq.${userId},id.in.(${sharedIds.join(',')})`)
        } else {
          // Get workflows the user owns or public workflows
          query = query.or(`is_public.eq.true,created_by.eq.${userId}`)
        }
      } else {
        // If no user, only show public workflows
        console.log('No user ID, showing only public workflows')
        query = query.eq('is_public', true)
      }

      const { data, error } = await query
        .order('is_default', { ascending: false })
        .order('name')

      console.log('Workflows query result:', { data, error })

      if (error) {
        console.error('Workflows fetch error:', error)
        throw error
      }

      console.log('Returning workflows:', data)
      return data as Workflow[]
    },
    enabled: isOpen
  })

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

  const { data: workflowStages } = useQuery({
    queryKey: ['workflow-stages', selectedWorkflow],
    queryFn: async () => {
      if (!selectedWorkflow) return []

      const { data, error } = await supabase
        .from('workflow_stages')
        .select('*')
        .eq('workflow_id', selectedWorkflow)
        .order('sort_order')

      if (error) throw error
      return data as WorkflowStage[]
    },
    enabled: !!selectedWorkflow
  })

  //  Fetch workflow owner details (for both editing and viewing)
  const currentWorkflow = editingWorkflow || workflows?.find(w => w.id === selectedWorkflow)
  const { data: workflowOwner } = useQuery({
    queryKey: ['workflow-owner', currentWorkflow?.created_by],
    queryFn: async () => {
      if (!currentWorkflow?.created_by) return null

      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .eq('id', currentWorkflow.created_by)
        .single()

      if (error) throw error
      return data
    },
    enabled: !!currentWorkflow?.created_by
  })

  // Get current user's permission level for the editing workflow
  const currentUserPermission = (() => {
    if (!editingWorkflow || !user?.id) return null
    if (editingWorkflow.created_by === user.id) return 'admin'

    const userCollab = collaborations?.find(c => c.user_id === user.id)
    return userCollab?.permission || null
  })()

  const { data: collaborations } = useQuery({
    queryKey: ['workflow-collaborations', selectedWorkflow],
    queryFn: async () => {
      if (!selectedWorkflow) return []

      const { data, error } = await supabase
        .from('workflow_collaborations')
        .select(`
          *,
          user:users(email, first_name, last_name)
        `)
        .eq('workflow_id', selectedWorkflow)
        .order('created_at')

      if (error) throw error
      return data as WorkflowCollaboration[]
    },
    enabled: !!selectedWorkflow
  })

  const { data: allUsers } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .order('email')

      if (error) throw error
      return data as User[]
    },
    enabled: isOpen
  })

  const createWorkflowMutation = useMutation({
    mutationFn: async (workflowData: { workflow: Partial<Workflow>, stages: Partial<WorkflowStage>[] }) => {
      console.log('Creating workflow:', workflowData)

      // Get current user
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('User not authenticated')

      // Create workflow with created_by field
      const workflowToInsert = {
        ...workflowData.workflow,
        created_by: user.id
      }

      const { data: newWorkflow, error: workflowError } = await supabase
        .from('workflows')
        .insert([workflowToInsert])
        .select()
        .single()

      if (workflowError) {
        console.error('Workflow creation error:', workflowError)
        throw workflowError
      }

      console.log('Created workflow:', newWorkflow)

      // Create stages
      const stagesWithWorkflowId = workflowData.stages.map(stage => ({
        ...stage,
        workflow_id: newWorkflow.id
      }))

      console.log('Creating stages:', stagesWithWorkflowId)

      const { error: stagesError } = await supabase
        .from('workflow_stages')
        .insert(stagesWithWorkflowId)

      if (stagesError) {
        console.error('Stages creation error:', stagesError)
        throw stagesError
      }

      return newWorkflow
    },
    onSuccess: () => {
      console.log('Workflow created successfully')
      // Force refresh the workflows list with multiple invalidation strategies
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      queryClient.invalidateQueries({ queryKey: ['workflow-stages'] })
      // Also force an immediate refetch
      setTimeout(() => {
        queryClient.refetchQueries({ queryKey: ['workflows'] })
      }, 100)
      setIsCreatingNew(false)
      setEditingWorkflow(null)
      setEditingStages([])
    },
    onError: (error) => {
      console.error('Create workflow mutation error:', error)
      alert(`Failed to create workflow: ${error.message}`)
    }
  })

  const updateWorkflowMutation = useMutation({
    mutationFn: async (workflowData: { workflow: Partial<Workflow>, stages: WorkflowStage[] }) => {
      console.log('Updating workflow:', workflowData)
      console.log('Workflow cadence_days being saved:', workflowData.workflow.cadence_days)

      // Update workflow
      const { error: workflowError } = await supabase
        .from('workflows')
        .update(workflowData.workflow)
        .eq('id', workflowData.workflow.id)

      if (workflowError) {
        console.error('Workflow update error:', workflowError)
        throw workflowError
      }

      console.log('Updated workflow')

      // Delete existing stages
      const { error: deleteError } = await supabase
        .from('workflow_stages')
        .delete()
        .eq('workflow_id', workflowData.workflow.id)

      if (deleteError) {
        console.error('Stage deletion error:', deleteError)
        throw deleteError
      }

      console.log('Deleted existing stages')

      // Insert updated stages
      const { error: stagesError } = await supabase
        .from('workflow_stages')
        .insert(workflowData.stages)

      if (stagesError) {
        console.error('Stage insertion error:', stagesError)
        throw stagesError
      }

      console.log('Inserted updated stages')
    },
    onSuccess: () => {
      console.log('Workflow updated successfully')
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      queryClient.invalidateQueries({ queryKey: ['workflow-stages'] })
      setEditingWorkflow(null)
      setEditingStages([])
    },
    onError: (error) => {
      console.error('Update workflow mutation error:', error)
      alert(`Failed to update workflow: ${error.message}`)
    }
  })

  const deleteWorkflowMutation = useMutation({
    mutationFn: async (workflowId: string) => {
      const { error } = await supabase
        .from('workflows')
        .delete()
        .eq('id', workflowId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      setSelectedWorkflow(null)
      setEditingWorkflow(null)
      setEditingStages([])
      setIsCreatingNew(false)
    }
  })

  const addCollaboratorMutation = useMutation({
    mutationFn: async ({ workflowId, userId, permission }: { workflowId: string, userId: string, permission: string }) => {
      // Add collaboration
      const { error } = await supabase
        .from('workflow_collaborations')
        .insert([{
          workflow_id: workflowId,
          user_id: userId,
          permission,
          invited_by: user?.id
        }])

      if (error) throw error

      // Create notification for the invited user
      const workflow = workflows?.find(w => w.id === workflowId)
      if (workflow) {
        await supabase
          .from('notifications')
          .insert({
            user_id: userId,
            type: 'workflow_shared',
            title: 'Workflow Shared With You',
            message: `${user?.first_name || user?.email?.split('@')[0] || 'Someone'} shared the workflow "${workflow.name}" with you`,
            context_type: 'workflow',
            context_id: workflowId,
            context_data: {
              workflow_name: workflow.name,
              workflow_id: workflowId,
              shared_by: user?.id,
              permission
            }
          })
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-collaborations'] })
      setNewCollaboratorEmail('')
      setSelectedUser(null)
      setShowUserDropdown(false)
      setFilteredUsers([])
    }
  })

  const removeCollaboratorMutation = useMutation({
    mutationFn: async (collaborationId: string) => {
      const { error } = await supabase
        .from('workflow_collaborations')
        .delete()
        .eq('id', collaborationId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-collaborations'] })
    }
  })

  const updateCollaboratorMutation = useMutation({
    mutationFn: async ({ collaborationId, permission }: { collaborationId: string, permission: string }) => {
      const { error } = await supabase
        .from('workflow_collaborations')
        .update({ permission })
        .eq('id', collaborationId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-collaborations'] })
    }
  })

  const handleCreateNew = () => {
    setIsCreatingNew(true)
    setEditingWorkflow({
      name: '',
      description: '',
      color: '#3b82f6',
      is_default: false,
      is_public: false,
      cadence_days: 365,
      cadence_timeframe: 'annually',
      kickoff_cadence: 'immediate'
    })
    setEditingStages([
      {
        id: crypto.randomUUID(),
        workflow_id: '',
        stage_key: 'stage_1',
        stage_label: 'Stage 1',
        stage_description: '',
        stage_color: 'blue-500',
        stage_icon: 'clock',
        sort_order: 1,
        standard_deadline_days: 7,
        suggested_priorities: ['medium']
      }
    ])
  }

  const handleEditWorkflow = (workflow: Workflow) => {
    setEditingWorkflow(workflow)
    setEditingStages(workflowStages || [])
    setIsCreatingNew(false)
  }

  const handleSaveWorkflow = () => {
    console.log('handleSaveWorkflow called')
    console.log('editingWorkflow:', editingWorkflow)
    console.log('editingStages:', editingStages)
    console.log('isCreatingNew:', isCreatingNew)

    if (!editingWorkflow) {
      console.log('No editing workflow, returning')
      return
    }

    if (isCreatingNew) {
      console.log('Creating new workflow')
      createWorkflowMutation.mutate({
        workflow: editingWorkflow,
        stages: editingStages
      })
    } else {
      console.log('Updating existing workflow')
      updateWorkflowMutation.mutate({
        workflow: editingWorkflow,
        stages: editingStages
      })
    }
  }

  const addStage = () => {
    const newStage: WorkflowStage = {
      id: crypto.randomUUID(),
      workflow_id: editingWorkflow?.id || '',
      stage_key: `stage_${editingStages.length + 1}`,
      stage_label: `Stage ${editingStages.length + 1}`,
      stage_description: '',
      stage_color: 'gray-500',
      stage_icon: 'clock',
      sort_order: editingStages.length + 1,
      standard_deadline_days: 7,
      suggested_priorities: ['medium']
    }
    setEditingStages([...editingStages, newStage])
  }

  const updateStage = (index: number, updates: Partial<WorkflowStage>) => {
    const updated = [...editingStages]
    updated[index] = { ...updated[index], ...updates }
    setEditingStages(updated)
  }

  const removeStage = (index: number) => {
    const updated = editingStages.filter((_, i) => i !== index)
    // Reorder sort_order
    updated.forEach((stage, i) => {
      stage.sort_order = i + 1
    })
    setEditingStages(updated)
  }

  const moveStage = (index: number, direction: 'up' | 'down') => {
    const updated = [...editingStages]
    const newIndex = direction === 'up' ? index - 1 : index + 1

    if (newIndex < 0 || newIndex >= updated.length) return

    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]]

    // Update sort_order
    updated.forEach((stage, i) => {
      stage.sort_order = i + 1
    })

    setEditingStages(updated)
  }

  const handleUserSearch = (searchTerm: string) => {
    setNewCollaboratorEmail(searchTerm)
    setSelectedUser(null)

    if (searchTerm.trim().length < 2) {
      setFilteredUsers([])
      setShowUserDropdown(false)
      return
    }

    if (allUsers) {
      const filtered = allUsers.filter(user => {
        const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim().toLowerCase()
        const email = user.email.toLowerCase()
        const search = searchTerm.toLowerCase()

        return fullName.includes(search) || email.includes(search)
      }).slice(0, 5) // Limit to 5 results

      setFilteredUsers(filtered)
      setShowUserDropdown(filtered.length > 0)
    }
  }

  const handleUserSelect = (user: User) => {
    setSelectedUser(user)
    setNewCollaboratorEmail(`${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email)
    setShowUserDropdown(false)
    setFilteredUsers([])
  }

  const handleRemoveCollaboration = (collaborationId: string, userEmail: string) => {
    setDeleteConfirm({
      isOpen: true,
      collaborationId,
      userEmail
    })
  }

  const confirmRemoveCollaboration = () => {
    if (deleteConfirm.collaborationId) {
      removeCollaboratorMutation.mutate(deleteConfirm.collaborationId)
      setDeleteConfirm({ isOpen: false, collaborationId: null, userEmail: '' })
    }
  }

  const getUserDisplayName = (user: any) => {
    if (!user) return 'Unknown User'
    if (user.first_name && user.last_name) {
      return `${user.first_name} ${user.last_name}`
    }
    return user.email?.split('@')[0] || 'Unknown User'
  }

  const getPermissionColor = (permission: string) => {
    switch (permission) {
      case 'admin': return 'error'
      case 'write': return 'warning'
      case 'read': return 'success'
      default: return 'default'
    }
  }

  // Helper functions for selection mode
  const filteredWorkflows = workflows?.filter(workflow => {
    // Filter by search term
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase()
      if (!workflow.name.toLowerCase().includes(searchLower) &&
          !workflow.description?.toLowerCase().includes(searchLower)) {
        return false
      }
    }

    // Filter by type
    if (filterType === 'my') {
      return workflow.created_by === (async () => await supabase.auth.getUser())
    }
    if (filterType === 'public') {
      return workflow.is_public
    }
    if (filterType === 'shared') {
      // This would need to be enhanced with collaboration data
      return true // For now, show all
    }

    return true
  })

  const handleWorkflowSelectClick = (workflowId: string) => {
    if (mode === 'selection' && onWorkflowSelect) {
      onWorkflowSelect(workflowId)
      onClose()
    } else {
      setSelectedWorkflow(workflowId)
      if (mode === 'selection') {
        setViewMode('details')
      }
    }
  }

  const getWorkflowUsageStats = (workflow: Workflow) => {
    // This would be enhanced with real usage data
    return {
      activeAssets: Math.floor(Math.random() * 20),
      completedAssets: Math.floor(Math.random() * 100),
      averageCompletionTime: Math.floor(Math.random() * 30) + ' days'
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className={`bg-white rounded-xl shadow-xl w-full max-h-[90vh] overflow-hidden ${
        mode === 'selection' ? 'max-w-5xl' : 'max-w-6xl'
      }`}>
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <Settings2 className="w-6 h-6 text-blue-600" />
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                {mode === 'selection' ? 'Select Workflow' : 'Workflow Management'}
              </h2>
              <p className="text-sm text-gray-500">
                {mode === 'selection'
                  ? 'Choose a workflow for your asset or create a new one'
                  : 'Create and customize workflows for your team'
                }
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {mode === 'selection' ? (
          /* Enhanced Selection Mode */
          <div className="h-[calc(90vh-120px)]">
            {/* Search and Filter Bar */}
            <div className="p-4 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center space-x-4">
                <div className="flex-1 relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-4 w-4 text-gray-400" />
                  </div>
                  <input
                    type="text"
                    placeholder="Search workflows..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value as any)}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="all">All Workflows</option>
                  <option value="my">My Workflows</option>
                  <option value="shared">Shared with Me</option>
                  <option value="public">Public</option>
                </select>
                <Button
                  size="sm"
                  onClick={() => setViewMode('create')}
                  className="flex items-center space-x-2"
                >
                  <Plus className="w-4 h-4" />
                  <span>New</span>
                </Button>
              </div>
            </div>

            {viewMode === 'list' && (
              /* Workflow Grid */
              <div className="p-6 overflow-y-auto h-full">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredWorkflows?.map((workflow) => {
                    const stats = getWorkflowUsageStats(workflow)
                    const isSelected = workflow.id === currentWorkflowId

                    return (
                      <div
                        key={workflow.id}
                        className={`relative p-4 border-2 rounded-xl cursor-pointer transition-all hover:shadow-md ${
                          isSelected
                            ? 'border-blue-500 bg-blue-50 shadow-md'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                        onClick={() => handleWorkflowSelectClick(workflow.id)}
                      >
                        {isSelected && (
                          <div className="absolute top-2 right-2">
                            <Badge variant="primary" size="sm">Current</Badge>
                          </div>
                        )}

                        <div className="flex items-start space-x-3 mb-3">
                          <div
                            className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold"
                            style={{ backgroundColor: workflow.color }}
                          >
                            <Workflow className="w-5 h-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-gray-900 truncate">{workflow.name}</h4>
                            <p className="text-sm text-gray-600 line-clamp-2">{workflow.description}</p>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-gray-500">Active</span>
                            <span className="font-medium">{stats.activeAssets}</span>
                          </div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-gray-500">Completed</span>
                            <span className="font-medium">{stats.completedAssets}</span>
                          </div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-gray-500">Avg. Time</span>
                            <span className="font-medium">{stats.averageCompletionTime}</span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-200">
                          <div className="flex items-center space-x-2">
                            {workflow.is_default && (
                              <Badge variant="secondary" size="xs">Default</Badge>
                            )}
                            {workflow.is_public && (
                              <Badge variant="success" size="xs">Public</Badge>
                            )}
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedWorkflow(workflow.id)
                              setViewMode('details')
                            }}
                            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                          >
                            View Details →
                          </button>
                        </div>
                      </div>
                    )
                  })}

                  {(!filteredWorkflows || filteredWorkflows.length === 0) && (
                    <div className="col-span-full text-center py-12">
                      <Workflow className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                      <p className="text-gray-500">No workflows found</p>
                      <Button
                        size="sm"
                        onClick={() => setViewMode('create')}
                        className="mt-3"
                      >
                        Create New Workflow
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {viewMode === 'details' && selectedWorkflow && (
              /* Detailed View */
              <div className="p-6 overflow-y-auto h-full">
                <div className="max-w-3xl mx-auto">
                  <div className="flex items-center space-x-3 mb-6">
                    <button
                      onClick={() => setViewMode('list')}
                      className="p-2 text-gray-400 hover:text-gray-600 rounded-lg"
                    >
                      ← Back to List
                    </button>
                    <h3 className="text-lg font-semibold text-gray-900">Workflow Details</h3>
                  </div>

                  {/* Enhanced workflow details would go here */}
                  <div className="space-y-6">
                    {/* Workflow info, stages, collaboration, etc. */}
                    <div className="bg-gray-50 rounded-lg p-4">
                      <p className="text-sm text-gray-600">
                        Detailed workflow view with stages, permissions, usage analytics, etc.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {viewMode === 'create' && (
              /* Inline Creation */
              <div className="p-6 overflow-y-auto h-full">
                <div className="max-w-3xl mx-auto">
                  <div className="flex items-center space-x-3 mb-6">
                    <button
                      onClick={() => setViewMode('list')}
                      className="p-2 text-gray-400 hover:text-gray-600 rounded-lg"
                    >
                      ← Back to List
                    </button>
                    <h3 className="text-lg font-semibold text-gray-900">Create New Workflow</h3>
                  </div>

                  {/* Inline creation form would go here */}
                  <div className="space-y-6">
                    <div className="bg-gray-50 rounded-lg p-4">
                      <p className="text-sm text-gray-600">
                        Inline workflow creation form with all the necessary fields.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Full Management Mode - Original Content */
          <div className="flex h-[calc(90vh-120px)]">
            {/* Workflow List */}
          <div className="w-1/3 border-r border-gray-200 p-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-gray-900">Workflows</h3>
              <Button
                size="sm"
                onClick={handleCreateNew}
                className="flex items-center space-x-1"
              >
                <Plus className="w-4 h-4" />
                <span>New</span>
              </Button>
            </div>

            <div className="space-y-2">
              {workflows?.map((workflow) => (
                <div
                  key={workflow.id}
                  className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedWorkflow === workflow.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                  onClick={() => setSelectedWorkflow(workflow.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: workflow.color }}
                      />
                      <span className="font-medium text-sm">{workflow.name}</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      {workflow.is_default && (
                        <Badge variant="secondary" size="sm">Default</Badge>
                      )}
                      {workflow.is_public && (
                        <Badge variant="success" size="sm">Public</Badge>
                      )}
                    </div>
                  </div>
                  {workflow.description && (
                    <p className="text-xs text-gray-500 mt-1">{workflow.description}</p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Workflow Editor */}
          <div className="flex-1 p-6 overflow-y-auto">
            {editingWorkflow ? (
              <div className="space-y-6">
                {/* Workflow Details */}
                <div>
                  <h4 className="font-medium text-gray-900 mb-4">
                    {isCreatingNew ? 'Create New Workflow' : 'Edit Workflow'}
                  </h4>

                  <div className="grid grid-cols-3 gap-4 mb-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Workflow Name
                      </label>
                      <input
                        type="text"
                        value={editingWorkflow.name || ''}
                        onChange={(e) => setEditingWorkflow({ ...editingWorkflow, name: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Enter workflow name"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Color
                      </label>
                      <div className="flex items-center space-x-2">
                        <input
                          type="color"
                          value={editingWorkflow.color || '#3b82f6'}
                          onChange={(e) => setEditingWorkflow({ ...editingWorkflow, color: e.target.value })}
                          className="w-10 h-10 rounded-lg border border-gray-300"
                        />
                        <input
                          type="text"
                          value={editingWorkflow.color || '#3b82f6'}
                          onChange={(e) => setEditingWorkflow({ ...editingWorkflow, color: e.target.value })}
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Cadence Timeframe
                      </label>
                      <select
                        value={editingWorkflow.cadence_timeframe || 'annually'}
                        onChange={(e) => {
                          const timeframe = e.target.value as 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'semi-annually' | 'annually'
                          const daysMap = {
                            'daily': 1,
                            'weekly': 7,
                            'monthly': 30,
                            'quarterly': 90,
                            'semi-annually': 180,
                            'annually': 365
                          }
                          setEditingWorkflow({
                            ...editingWorkflow,
                            cadence_timeframe: timeframe,
                            cadence_days: daysMap[timeframe]
                          })
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                        <option value="quarterly">Quarterly</option>
                        <option value="semi-annually">Semi-Annually</option>
                        <option value="annually">Annually</option>
                      </select>
                    </div>
                  </div>

                  <div className="mb-6">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Kickoff Cadence
                    </label>
                    <p className="text-xs text-gray-500 mb-2">When should this workflow start for each asset?</p>
                    <select
                      value={editingWorkflow.kickoff_cadence || 'immediate'}
                      onChange={(e) => setEditingWorkflow({
                        ...editingWorkflow,
                        kickoff_cadence: e.target.value as 'immediate' | 'month-start' | 'quarter-start' | 'year-start' | 'custom-date'
                      })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="immediate">Immediate (when asset is added)</option>
                      <option value="month-start">Start of Month</option>
                      <option value="quarter-start">Start of Quarter</option>
                      <option value="year-start">Start of Year</option>
                      <option value="custom-date">Custom Date</option>
                    </select>

                    {editingWorkflow.kickoff_cadence === 'custom-date' && (
                      <input
                        type="date"
                        value={editingWorkflow.kickoff_custom_date || ''}
                        onChange={(e) => setEditingWorkflow({ ...editingWorkflow, kickoff_custom_date: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mt-2"
                      />
                    )}
                  </div>

                  <div className="mb-6">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Description
                    </label>
                    <textarea
                      value={editingWorkflow.description || ''}
                      onChange={(e) => setEditingWorkflow({ ...editingWorkflow, description: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      rows={3}
                      placeholder="Describe this workflow..."
                    />
                  </div>

                </div>

                {/* Tabs */}
                <div>
                  <div className="border-b border-gray-200 mb-6">
                    <nav className="-mb-px flex space-x-8">
                      <button
                        onClick={() => setShowCollaborators(false)}
                        className={`py-2 px-1 border-b-2 font-medium text-sm ${
                          !showCollaborators
                            ? 'border-blue-500 text-blue-600'
                            : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                        }`}
                      >
                        <Settings2 className="w-4 h-4 mr-1 inline" />
                        Stages
                      </button>
                      <button
                        onClick={() => setShowCollaborators(true)}
                        className={`py-2 px-1 border-b-2 font-medium text-sm ${
                          showCollaborators
                            ? 'border-blue-500 text-blue-600'
                            : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                        }`}
                      >
                        <Users className="w-4 h-4 mr-1 inline" />
                        Team & Admins
                      </button>
                    </nav>
                  </div>

                  {!showCollaborators ? (
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="font-medium text-gray-900">Workflow Stages</h4>
                        <Button size="sm" onClick={addStage}>
                          <Plus className="w-4 h-4 mr-1" />
                          Add Stage
                        </Button>
                      </div>

                  <div className="space-y-4">
                    {editingStages.map((stage, index) => (
                      <div key={stage.id} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3">
                          <span className="font-medium text-sm text-gray-700">Stage {index + 1}</span>
                          <div className="flex items-center space-x-2">
                            <button
                              onClick={() => moveStage(index, 'up')}
                              disabled={index === 0}
                              className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-50"
                            >
                              <ArrowUp className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => moveStage(index, 'down')}
                              disabled={index === editingStages.length - 1}
                              className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-50"
                            >
                              <ArrowDown className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => removeStage(index)}
                              className="p-1 text-red-400 hover:text-red-600"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">
                              Stage Key
                            </label>
                            <input
                              type="text"
                              value={stage.stage_key}
                              onChange={(e) => updateStage(index, { stage_key: e.target.value })}
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">
                              Display Label
                            </label>
                            <input
                              type="text"
                              value={stage.stage_label}
                              onChange={(e) => updateStage(index, { stage_label: e.target.value })}
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">
                              Standard Deadline (Days)
                            </label>
                            <input
                              type="number"
                              min="1"
                              max="365"
                              value={stage.standard_deadline_days}
                              onChange={(e) => updateStage(index, { standard_deadline_days: parseInt(e.target.value) || 7 })}
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                              placeholder="Days to complete this stage"
                            />
                          </div>
                        </div>

                        <div className="mt-3">
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Description
                          </label>
                          <input
                            type="text"
                            value={stage.stage_description}
                            onChange={(e) => updateStage(index, { stage_description: e.target.value })}
                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                            placeholder="Brief description of this stage..."
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-3 mt-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">
                              Color
                            </label>
                            <select
                              value={stage.stage_color}
                              onChange={(e) => updateStage(index, { stage_color: e.target.value })}
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                            >
                              {COLOR_OPTIONS.map(color => (
                                <option key={color} value={color}>{color}</option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">
                              Icon
                            </label>
                            <select
                              value={stage.stage_icon}
                              onChange={(e) => updateStage(index, { stage_icon: e.target.value })}
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                            >
                              {ICON_OPTIONS.map(icon => (
                                <option key={icon} value={icon}>{icon}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                  ) : (
                    <div className="space-y-6">
                      {/* Admin Status Notice */}
                      {currentUserPermission === 'admin' ? (
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                          <div className="flex items-start space-x-3">
                            <div className="flex-shrink-0">
                              <Badge variant="primary" size="sm">Admin Access</Badge>
                            </div>
                            <div className="flex-1">
                              <p className="text-sm text-blue-900">
                                You have full admin control over this workflow. You can manage visibility, invite collaborators, and adjust team member permissions.
                              </p>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                          <div className="flex items-start space-x-3">
                            <div className="flex-shrink-0">
                              <Badge variant={getPermissionColor(currentUserPermission || 'read')} size="sm">
                                {currentUserPermission || 'View Only'}
                              </Badge>
                            </div>
                            <div className="flex-1">
                              <p className="text-sm text-gray-700">
                                You have {currentUserPermission || 'view-only'} access to this workflow. Contact the workflow owner for permission changes.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Workflow Owner */}
                      {workflowOwner && (
                        <Card>
                          <div className="p-4">
                            <h4 className="text-sm font-medium text-gray-700 mb-3">Workflow Owner</h4>
                            <div className="flex items-center space-x-3">
                              <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                                <Users className="w-5 h-5 text-primary-600" />
                              </div>
                              <div className="flex-1">
                                <p className="text-sm font-medium text-gray-900">
                                  {getUserDisplayName(workflowOwner)}
                                </p>
                                <p className="text-xs text-gray-500">{workflowOwner.email}</p>
                              </div>
                              <Badge variant="error" size="sm">Owner</Badge>
                            </div>
                          </div>
                        </Card>
                      )}

                      {/* Public/Private Toggle */}
                      <Card>
                        <div className="p-4">
                          <h4 className="text-sm font-medium text-gray-700 mb-3">Visibility</h4>
                          <label className={`flex items-center ${currentUserPermission === 'admin' ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                            <input
                              type="checkbox"
                              checked={editingWorkflow.is_public || false}
                              onChange={async (e) => {
                                if (currentUserPermission === 'admin' && editingWorkflow.id) {
                                  const newValue = e.target.checked
                                  // Update local state immediately
                                  setEditingWorkflow({ ...editingWorkflow, is_public: newValue })

                                  // Save to database immediately
                                  const { error } = await supabase
                                    .from('workflows')
                                    .update({ is_public: newValue })
                                    .eq('id', editingWorkflow.id)

                                  if (error) {
                                    console.error('Failed to update workflow visibility:', error)
                                    // Revert on error
                                    setEditingWorkflow({ ...editingWorkflow, is_public: !newValue })
                                  } else {
                                    // Refresh the workflows list
                                    queryClient.invalidateQueries({ queryKey: ['workflows'] })
                                  }
                                }
                              }}
                              disabled={currentUserPermission !== 'admin' || !editingWorkflow.id}
                              className="mr-3 rounded"
                            />
                            <div className="flex-1">
                              <span className="text-sm font-medium text-gray-900">Public Workflow</span>
                              <p className="text-xs text-gray-500 mt-0.5">
                                {currentUserPermission === 'admin'
                                  ? 'When enabled, all users can view and use this workflow. Changes save automatically.'
                                  : 'Only workflow admins can change visibility settings'
                                }
                              </p>
                            </div>
                          </label>
                        </div>
                      </Card>

                      {/* Invite New Collaborator */}
                      {!editingWorkflow.is_public && currentUserPermission === 'admin' && (
                        <Card>
                          <div className="p-4">
                            <h4 className="text-sm font-medium text-gray-700 mb-3">Invite Collaborator</h4>
                            <div className="flex items-center space-x-2">
                              <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input
                                  type="text"
                                  placeholder="Search by name or email"
                                  value={newCollaboratorEmail}
                                  onChange={(e) => handleUserSearch(e.target.value)}
                                  onFocus={() => {
                                    if (filteredUsers.length > 0) setShowUserDropdown(true)
                                  }}
                                  onBlur={() => {
                                    setTimeout(() => setShowUserDropdown(false), 200)
                                  }}
                                  className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                                />
                                {showUserDropdown && filteredUsers.length > 0 && (
                                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto">
                                    {filteredUsers.map((user) => (
                                      <button
                                        key={user.id}
                                        onClick={() => handleUserSelect(user)}
                                        className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                                      >
                                        <div className="text-sm font-medium text-gray-900">
                                          {user.first_name && user.last_name
                                            ? `${user.first_name} ${user.last_name}`
                                            : user.email}
                                        </div>
                                        <div className="text-xs text-gray-500">{user.email}</div>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <select
                                value={newCollaboratorPermission}
                                onChange={(e) => setNewCollaboratorPermission(e.target.value as 'read' | 'write' | 'admin')}
                                className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                              >
                                <option value="read">Read</option>
                                <option value="write">Write</option>
                                <option value="admin">Admin</option>
                              </select>
                              <Button
                                size="sm"
                                onClick={() => {
                                  if (selectedUser) {
                                    addCollaboratorMutation.mutate({
                                      workflowId: editingWorkflow.id!,
                                      userId: selectedUser.id,
                                      permission: newCollaboratorPermission
                                    })
                                  }
                                }}
                                disabled={!selectedUser || !editingWorkflow.id}
                              >
                                <UserPlus className="w-4 h-4 mr-1" />
                                Invite
                              </Button>
                            </div>
                          </div>
                        </Card>
                      )}

                      {/* Current Collaborators */}
                      {!editingWorkflow.is_public && (
                        <Card>
                          <div className="p-4">
                            <h4 className="text-sm font-medium text-gray-700 mb-3">
                              Team Members ({collaborations?.length || 0})
                            </h4>
                            <div className="space-y-2">
                              {collaborations?.map((collab) => (
                                <div
                                  key={collab.id}
                                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                                >
                                  <div className="flex items-center space-x-3 flex-1 min-w-0">
                                    <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center flex-shrink-0">
                                      <Users className="w-4 h-4 text-gray-600" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium text-gray-900 truncate">
                                        {getUserDisplayName(collab.user)}
                                      </p>
                                      <p className="text-xs text-gray-500 truncate">{collab.user?.email}</p>
                                    </div>
                                  </div>
                                  <div className="flex items-center space-x-2 flex-shrink-0 ml-4">
                                    {currentUserPermission === 'admin' ? (
                                      <>
                                        <select
                                          value={collab.permission}
                                          onChange={(e) => updateCollaboratorMutation.mutate({
                                            collaborationId: collab.id,
                                            permission: e.target.value
                                          })}
                                          className="px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-primary-500"
                                        >
                                          <option value="read">Read</option>
                                          <option value="write">Write</option>
                                          <option value="admin">Admin</option>
                                        </select>
                                        <button
                                          onClick={() => handleRemoveCollaboration(collab.id, collab.user?.email || '')}
                                          className="p-1.5 text-gray-400 hover:text-red-600 transition-colors"
                                          title="Remove collaborator"
                                        >
                                          <Trash2 className="w-4 h-4" />
                                        </button>
                                      </>
                                    ) : (
                                      <Badge variant={getPermissionColor(collab.permission)} size="sm">
                                        {collab.permission}
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                              ))}

                              {(!collaborations || collaborations.length === 0) && (
                                <div className="text-center py-8 text-gray-500">
                                  <Users className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                                  <p className="text-sm font-medium">No team members yet</p>
                                  <p className="text-xs mt-1">Invite users above to collaborate on this workflow</p>
                                </div>
                              )}
                            </div>
                          </div>
                        </Card>
                      )}

                      {editingWorkflow.is_public && (
                        <Card>
                          <div className="p-4 text-center">
                            <Eye className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                            <p className="text-sm font-medium text-gray-700">Public Workflow</p>
                            <p className="text-xs text-gray-500 mt-1">
                              This workflow is visible to all users. Disable public access to manage team members.
                            </p>
                          </div>
                        </Card>
                      )}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between pt-6 border-t border-gray-200">
                  <div>
                    {!isCreatingNew && !editingWorkflow.is_default && (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => {
                          if (editingWorkflow.id && confirm('Are you sure you want to delete this workflow?')) {
                            deleteWorkflowMutation.mutate(editingWorkflow.id)
                          }
                        }}
                      >
                        <Trash2 className="w-4 h-4 mr-1" />
                        Delete Workflow
                      </Button>
                    )}
                  </div>

                  <div className="flex items-center space-x-3">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setEditingWorkflow(null)
                        setEditingStages([])
                        setIsCreatingNew(false)
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleSaveWorkflow}
                      disabled={!editingWorkflow.name || editingStages.length === 0}
                    >
                      <Save className="w-4 h-4 mr-1" />
                      Save Workflow
                    </Button>
                  </div>
                </div>
              </div>
            ) : selectedWorkflow && workflowStages ? (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium text-gray-900">Workflow Details</h4>
                  <Button
                    size="sm"
                    onClick={() => {
                      const workflow = workflows?.find(w => w.id === selectedWorkflow)
                      if (workflow) handleEditWorkflow(workflow)
                    }}
                  >
                    <Edit className="w-4 h-4 mr-1" />
                    Edit Stages
                  </Button>
                </div>

                {/* Tabs for view mode */}
                <div>
                  <div className="border-b border-gray-200 mb-6">
                    <nav className="-mb-px flex space-x-8">
                      <button
                        onClick={() => setShowCollaborators(false)}
                        className={`py-2 px-1 border-b-2 font-medium text-sm ${
                          !showCollaborators
                            ? 'border-blue-500 text-blue-600'
                            : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                        }`}
                      >
                        <Settings2 className="w-4 h-4 mr-1 inline" />
                        Overview
                      </button>
                      <button
                        onClick={() => setShowCollaborators(true)}
                        className={`py-2 px-1 border-b-2 font-medium text-sm ${
                          showCollaborators
                            ? 'border-blue-500 text-blue-600'
                            : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                        }`}
                      >
                        <Users className="w-4 h-4 mr-1 inline" />
                        Team & Admins
                      </button>
                    </nav>
                  </div>

                  {!showCollaborators ? (
                    // Overview Tab
                    <div className="space-y-6">

                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-sm font-medium text-gray-700">Name:</span>
                      <p className="text-sm text-gray-900">{workflows?.find(w => w.id === selectedWorkflow)?.name}</p>
                    </div>
                    <div>
                      <span className="text-sm font-medium text-gray-700">Stages:</span>
                      <p className="text-sm text-gray-900">{workflowStages.length} stages</p>
                    </div>
                  </div>
                  {workflows?.find(w => w.id === selectedWorkflow)?.description && (
                    <div className="mt-3">
                      <span className="text-sm font-medium text-gray-700">Description:</span>
                      <p className="text-sm text-gray-900">{workflows?.find(w => w.id === selectedWorkflow)?.description}</p>
                    </div>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h5 className="font-medium text-gray-900">Stages</h5>
                    <Button
                      size="sm"
                      onClick={() => {
                        const workflow = workflows?.find(w => w.id === selectedWorkflow)
                        if (workflow) handleEditWorkflow(workflow)
                      }}
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      Add Stage
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {workflowStages.map((stage, index) => (
                      <div key={stage.id} className="flex items-center space-x-4 p-3 border border-gray-200 rounded-lg">
                        <div className="flex items-center justify-center w-8 h-8 bg-gray-100 rounded-full text-sm font-medium text-gray-600">
                          {index + 1}
                        </div>
                        <div className={`w-4 h-4 rounded-full bg-${stage.stage_color}`}></div>
                        <div className="flex-1">
                          <div className="font-medium text-sm text-gray-900">{stage.stage_label}</div>
                          {stage.stage_description && (
                            <div className="text-xs text-gray-500">{stage.stage_description}</div>
                          )}
                        </div>
                        <div className="text-xs text-gray-500">
                          Deadline: {stage.standard_deadline_days} days
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                    </div>
                  ) : (
                    // Team & Admins Tab in view mode
                    <div className="space-y-6">
                      {(() => {
                        const workflow = workflows?.find(w => w.id === selectedWorkflow)
                        if (!workflow) return null

                        const isOwner = workflow.created_by === user?.id
                        const userCollab = collaborations?.find(c => c.user_id === user?.id)
                        const viewPermission = isOwner ? 'admin' : (userCollab?.permission || null)

                        return (
                          <>
                            {/* Admin Status Notice */}
                            {viewPermission === 'admin' ? (
                              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                <div className="flex items-start space-x-3">
                                  <div className="flex-shrink-0">
                                    <Badge variant="primary" size="sm">Admin Access</Badge>
                                  </div>
                                  <div className="flex-1">
                                    <p className="text-sm text-blue-900">
                                      You have full admin control over this workflow. You can manage visibility, invite collaborators, and adjust team member permissions.
                                    </p>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                                <div className="flex items-start space-x-3">
                                  <div className="flex-shrink-0">
                                    <Badge variant={getPermissionColor(viewPermission || 'read')} size="sm">
                                      {viewPermission || 'View Only'}
                                    </Badge>
                                  </div>
                                  <div className="flex-1">
                                    <p className="text-sm text-gray-700">
                                      You have {viewPermission || 'view-only'} access to this workflow. Contact the workflow owner for permission changes.
                                    </p>
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Workflow Owner */}
                            {workflowOwner && (
                              <Card>
                                <div className="p-4">
                                  <h4 className="text-sm font-medium text-gray-700 mb-3">Workflow Owner</h4>
                                  <div className="flex items-center space-x-3">
                                    <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                                      <Users className="w-5 h-5 text-primary-600" />
                                    </div>
                                    <div className="flex-1">
                                      <p className="text-sm font-medium text-gray-900">
                                        {getUserDisplayName(workflowOwner)}
                                      </p>
                                      <p className="text-xs text-gray-500">{workflowOwner.email}</p>
                                    </div>
                                    <Badge variant="error" size="sm">Owner</Badge>
                                  </div>
                                </div>
                              </Card>
                            )}

                            {/* Public/Private Toggle */}
                            <Card>
                              <div className="p-4">
                                <h4 className="text-sm font-medium text-gray-700 mb-3">Visibility</h4>
                                <label className={`flex items-center ${viewPermission === 'admin' ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                                  <input
                                    type="checkbox"
                                    checked={workflow.is_public || false}
                                    onChange={async (e) => {
                                      if (viewPermission === 'admin') {
                                        const newValue = e.target.checked

                                        // Save to database immediately
                                        const { error } = await supabase
                                          .from('workflows')
                                          .update({ is_public: newValue })
                                          .eq('id', workflow.id)

                                        if (error) {
                                          console.error('Failed to update workflow visibility:', error)
                                        } else {
                                          // Refresh the workflows list
                                          queryClient.invalidateQueries({ queryKey: ['workflows'] })
                                        }
                                      }
                                    }}
                                    disabled={viewPermission !== 'admin'}
                                    className="mr-3 rounded"
                                  />
                                  <div className="flex-1">
                                    <span className="text-sm font-medium text-gray-900">Public Workflow</span>
                                    <p className="text-xs text-gray-500 mt-0.5">
                                      {viewPermission === 'admin'
                                        ? 'When enabled, all users can view and use this workflow. Changes save automatically.'
                                        : 'Only workflow admins can change visibility settings'
                                      }
                                    </p>
                                  </div>
                                </label>
                              </div>
                            </Card>

                            {/* Invite New Collaborator */}
                            {!workflow.is_public && viewPermission === 'admin' && (
                              <Card>
                                <div className="p-4">
                                  <h4 className="text-sm font-medium text-gray-700 mb-3">Invite Collaborator</h4>
                                  <div className="flex items-center space-x-2">
                                    <div className="relative flex-1">
                                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                                      <input
                                        type="text"
                                        placeholder="Search by name or email"
                                        value={newCollaboratorEmail}
                                        onChange={(e) => handleUserSearch(e.target.value)}
                                        onFocus={() => {
                                          if (filteredUsers.length > 0) setShowUserDropdown(true)
                                        }}
                                        onBlur={() => {
                                          setTimeout(() => setShowUserDropdown(false), 200)
                                        }}
                                        className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                                      />
                                      {showUserDropdown && filteredUsers.length > 0 && (
                                        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto">
                                          {filteredUsers.map((user) => (
                                            <button
                                              key={user.id}
                                              onClick={() => handleUserSelect(user)}
                                              className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                                            >
                                              <div className="text-sm font-medium text-gray-900">
                                                {user.first_name && user.last_name
                                                  ? `${user.first_name} ${user.last_name}`
                                                  : user.email}
                                              </div>
                                              <div className="text-xs text-gray-500">{user.email}</div>
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                    <select
                                      value={newCollaboratorPermission}
                                      onChange={(e) => setNewCollaboratorPermission(e.target.value as 'read' | 'write' | 'admin')}
                                      className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                                    >
                                      <option value="read">Read</option>
                                      <option value="write">Write</option>
                                      <option value="admin">Admin</option>
                                    </select>
                                    <Button
                                      size="sm"
                                      onClick={() => {
                                        if (selectedUser) {
                                          addCollaboratorMutation.mutate({
                                            workflowId: workflow.id,
                                            userId: selectedUser.id,
                                            permission: newCollaboratorPermission
                                          })
                                        }
                                      }}
                                      disabled={!selectedUser}
                                    >
                                      <UserPlus className="w-4 h-4 mr-1" />
                                      Invite
                                    </Button>
                                  </div>
                                </div>
                              </Card>
                            )}

                            {/* Current Collaborators */}
                            {!workflow.is_public && (
                              <Card>
                                <div className="p-4">
                                  <h4 className="text-sm font-medium text-gray-700 mb-3">
                                    Team Members ({collaborations?.length || 0})
                                  </h4>
                                  <div className="space-y-2">
                                    {collaborations?.map((collab) => (
                                      <div
                                        key={collab.id}
                                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                                      >
                                        <div className="flex items-center space-x-3 flex-1 min-w-0">
                                          <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center flex-shrink-0">
                                            <Users className="w-4 h-4 text-gray-600" />
                                          </div>
                                          <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-gray-900 truncate">
                                              {getUserDisplayName(collab.user)}
                                            </p>
                                            <p className="text-xs text-gray-500 truncate">{collab.user?.email}</p>
                                          </div>
                                        </div>
                                        <div className="flex items-center space-x-2 flex-shrink-0 ml-4">
                                          {viewPermission === 'admin' ? (
                                            <>
                                              <select
                                                value={collab.permission}
                                                onChange={(e) => updateCollaboratorMutation.mutate({
                                                  collaborationId: collab.id,
                                                  permission: e.target.value
                                                })}
                                                className="px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-primary-500"
                                              >
                                                <option value="read">Read</option>
                                                <option value="write">Write</option>
                                                <option value="admin">Admin</option>
                                              </select>
                                              <button
                                                onClick={() => handleRemoveCollaboration(collab.id, collab.user?.email || '')}
                                                className="p-1.5 text-gray-400 hover:text-red-600 transition-colors"
                                                title="Remove collaborator"
                                              >
                                                <Trash2 className="w-4 h-4" />
                                              </button>
                                            </>
                                          ) : (
                                            <Badge variant={getPermissionColor(collab.permission)} size="sm">
                                              {collab.permission}
                                            </Badge>
                                          )}
                                        </div>
                                      </div>
                                    ))}

                                    {(!collaborations || collaborations.length === 0) && (
                                      <div className="text-center py-8 text-gray-500">
                                        <Users className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                                        <p className="text-sm font-medium">No team members yet</p>
                                        <p className="text-xs mt-1">Invite users above to collaborate on this workflow</p>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </Card>
                            )}

                            {workflow.is_public && (
                              <Card>
                                <div className="p-4 text-center">
                                  <Eye className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                                  <p className="text-sm font-medium text-gray-700">Public Workflow</p>
                                  <p className="text-xs text-gray-500 mt-1">
                                    This workflow is visible to all users. Disable public access to manage team members.
                                  </p>
                                </div>
                              </Card>
                            )}
                          </>
                        )
                      })()}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">
                <div className="text-center">
                  <Workflow className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                  <p>Select a workflow to view details or create a new one</p>
                </div>
              </div>
            )}
          </div>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <Card>
            <div className="p-6 max-w-md">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Remove Collaborator</h3>
              <p className="text-sm text-gray-600 mb-4">
                Are you sure you want to remove <strong>{deleteConfirm.userEmail}</strong> from this workflow?
                They will no longer have access.
              </p>
              <div className="flex justify-end space-x-3">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setDeleteConfirm({ isOpen: false, collaborationId: null, userEmail: '' })}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={confirmRemoveCollaboration}
                >
                  Remove
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}