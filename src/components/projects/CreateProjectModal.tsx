import { useState } from 'react'
import { X, Plus, Trash2, Search, Check, Users } from 'lucide-react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Select } from '../ui/Select'
import type { ProjectStatus, ProjectPriority, ProjectContextType, ProjectAssignmentRole } from '../../types/project'

interface CreateProjectModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: (projectId: string) => void
}

interface DeliverableInput {
  id: string
  title: string
}

interface User {
  id: string
  email: string
  first_name?: string | null
  last_name?: string | null
}

interface TeamMemberInput {
  userId: string
  role: ProjectAssignmentRole
}

export function CreateProjectModal({ isOpen, onClose, onSuccess }: CreateProjectModalProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<ProjectStatus>('planning')
  const [priority, setPriority] = useState<ProjectPriority>('medium')
  const [dueDate, setDueDate] = useState('')
  const [contextType, setContextType] = useState<ProjectContextType | ''>('')
  const [contextId, setContextId] = useState<string>('')
  const [contextSearchQuery, setContextSearchQuery] = useState('')
  const [deliverables, setDeliverables] = useState<DeliverableInput[]>([])
  const [newDeliverable, setNewDeliverable] = useState('')
  const [teamMembers, setTeamMembers] = useState<TeamMemberInput[]>([])
  const [userSearchQuery, setUserSearchQuery] = useState('')
  const [showTeamSection, setShowTeamSection] = useState(false)

  // Fetch all users
  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .order('email')
      if (error) throw error
      return data as User[]
    }
  })

  // Fetch assets when context type is 'asset'
  const { data: assets } = useQuery({
    queryKey: ['assets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name')
        .order('symbol')
      if (error) throw error
      return data
    },
    enabled: contextType === 'asset'
  })

  // Fetch portfolios when context type is 'portfolio'
  const { data: portfolios } = useQuery({
    queryKey: ['portfolios'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolios')
        .select('id, name')
        .order('name')
      if (error) throw error
      return data
    },
    enabled: contextType === 'portfolio'
  })

  // Fetch themes when context type is 'theme'
  const { data: themes } = useQuery({
    queryKey: ['themes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('themes')
        .select('id, name')
        .order('name')
      if (error) throw error
      return data
    },
    enabled: contextType === 'theme'
  })

  // Fetch workflows when context type is 'workflow'
  const { data: workflows } = useQuery({
    queryKey: ['workflows'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workflows')
        .select('id, name')
        .order('name')
      if (error) throw error
      return data
    },
    enabled: contextType === 'workflow'
  })

  const createProjectMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error('User not authenticated')
      if (!title.trim()) throw new Error('Title is required')

      console.log('Creating project with data:', {
        title: title.trim(),
        description: description.trim() || null,
        created_by: user.id,
        status,
        priority,
        due_date: dueDate || null,
        context_type: contextType || null,
        context_id: contextId || null
      })

      // Create the project
      const { data: project, error: projectError } = await supabase
        .from('projects')
        .insert({
          title: title.trim(),
          description: description.trim() || null,
          created_by: user.id,
          status,
          priority,
          due_date: dueDate || null,
          context_type: contextType || null,
          context_id: contextId || null
        })
        .select()
        .single()

      if (projectError) {
        console.error('Project creation error:', projectError)
        throw projectError
      }

      console.log('Project created:', project)

      // Create assignments (owner + team members)
      const assignments = [
        {
          project_id: project.id,
          assigned_to: user.id,
          assigned_by: user.id,
          role: 'owner' as ProjectAssignmentRole
        },
        ...teamMembers.map(tm => ({
          project_id: project.id,
          assigned_to: tm.userId,
          assigned_by: user.id,
          role: tm.role
        }))
      ]

      console.log('Creating assignments:', assignments)

      const { error: assignmentError } = await supabase
        .from('project_assignments')
        .insert(assignments)

      if (assignmentError) {
        console.error('Assignment creation error:', assignmentError)
        throw assignmentError
      }

      console.log('Assignments created successfully')

      // Create deliverables if any
      if (deliverables.length > 0) {
        const deliverablesData = deliverables.map((d, index) => ({
          project_id: project.id,
          title: d.title,
          display_order: index
        }))

        console.log('Creating deliverables:', deliverablesData)

        const { error: deliverablesError } = await supabase
          .from('project_deliverables')
          .insert(deliverablesData)

        if (deliverablesError) {
          console.error('Deliverable creation error:', deliverablesError)
          throw deliverablesError
        }

        console.log('Deliverables created successfully')
      }

      console.log('Project creation complete:', project.id)
      return project.id
    },
    onSuccess: (projectId) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      resetForm()
      onClose()
      onSuccess?.(projectId)
    }
  })

  const resetForm = () => {
    setTitle('')
    setDescription('')
    setStatus('planning')
    setPriority('medium')
    setDueDate('')
    setContextType('')
    setContextId('')
    setContextSearchQuery('')
    setDeliverables([])
    setNewDeliverable('')
    setTeamMembers([])
    setUserSearchQuery('')
  }

  const getUserName = (user?: User) => {
    if (!user) return 'Unknown'
    if (user.first_name && user.last_name) {
      return `${user.first_name} ${user.last_name}`
    }
    return user.email
  }

  const getUserInitials = (user?: User) => {
    if (!user) return '??'
    if (user.first_name && user.last_name) {
      return `${user.first_name[0]}${user.last_name[0]}`.toUpperCase()
    }
    return user.email.substring(0, 2).toUpperCase()
  }

  const filteredUsers = users?.filter(u => {
    if (!userSearchQuery.trim()) return true
    const query = userSearchQuery.toLowerCase()
    const name = getUserName(u).toLowerCase()
    return name.includes(query) || u.email.toLowerCase().includes(query)
  })

  // Get filtered context entities based on selected context type
  const getFilteredContextEntities = () => {
    if (!contextType || contextType === 'general') return []

    const query = contextSearchQuery.toLowerCase()

    if (contextType === 'asset') {
      return assets?.filter(a =>
        a.symbol.toLowerCase().includes(query) ||
        a.company_name?.toLowerCase().includes(query)
      ) || []
    }

    if (contextType === 'portfolio') {
      return portfolios?.filter(p => p.name.toLowerCase().includes(query)) || []
    }

    if (contextType === 'theme') {
      return themes?.filter(t => t.name.toLowerCase().includes(query)) || []
    }

    if (contextType === 'workflow') {
      return workflows?.filter(w => w.name.toLowerCase().includes(query)) || []
    }

    return []
  }

  const filteredContextEntities = getFilteredContextEntities()

  // Get display name for context entity
  const getContextEntityName = (entityId: string) => {
    if (!contextType || !entityId) return ''

    if (contextType === 'asset') {
      const asset = assets?.find(a => a.id === entityId)
      return asset ? `${asset.symbol} - ${asset.company_name}` : ''
    }

    if (contextType === 'portfolio') {
      return portfolios?.find(p => p.id === entityId)?.name || ''
    }

    if (contextType === 'theme') {
      return themes?.find(t => t.id === entityId)?.name || ''
    }

    if (contextType === 'workflow') {
      return workflows?.find(w => w.id === entityId)?.name || ''
    }

    return ''
  }

  const handleAddTeamMember = (userId: string, role: ProjectAssignmentRole) => {
    if (!teamMembers.some(tm => tm.userId === userId)) {
      setTeamMembers([...teamMembers, { userId, role }])
    }
  }

  const handleRemoveTeamMember = (userId: string) => {
    setTeamMembers(teamMembers.filter(tm => tm.userId !== userId))
  }

  const handleUpdateTeamMemberRole = (userId: string, role: ProjectAssignmentRole) => {
    setTeamMembers(teamMembers.map(tm =>
      tm.userId === userId ? { ...tm, role } : tm
    ))
  }

  const handleAddDeliverable = () => {
    if (newDeliverable.trim()) {
      setDeliverables([...deliverables, { id: crypto.randomUUID(), title: newDeliverable.trim() }])
      setNewDeliverable('')
    }
  }

  const handleRemoveDeliverable = (id: string) => {
    setDeliverables(deliverables.filter(d => d.id !== id))
  }

  const handleContextTypeChange = (newContextType: ProjectContextType | '') => {
    setContextType(newContextType)
    setContextId('')
    setContextSearchQuery('')
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    createProjectMutation.mutate()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-2xl w-full mx-auto transform transition-all">
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors z-10"
            disabled={createProjectMutation.isPending}
          >
            <X className="h-5 w-5" />
          </button>

          <form onSubmit={handleSubmit} className="p-6">
            {/* Header */}
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                Create New Project
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Create a project to organize one-off initiatives and deliverables
              </p>
            </div>

            {/* Form Fields */}
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Title <span className="text-error-600">*</span>
                </label>
                <Input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Q4 Market Research Initiative"
                  required
                  disabled={createProjectMutation.isPending}
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the project goals and scope..."
                  rows={3}
                  disabled={createProjectMutation.isPending}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-700 dark:text-white resize-none"
                />
              </div>

              {/* Status and Priority */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Status
                  </label>
                  <Select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as ProjectStatus)}
                    disabled={createProjectMutation.isPending}
                    options={[
                      { value: 'planning', label: 'Planning' },
                      { value: 'in_progress', label: 'In Progress' },
                      { value: 'blocked', label: 'Blocked' },
                      { value: 'completed', label: 'Completed' },
                      { value: 'cancelled', label: 'Cancelled' }
                    ]}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Priority
                  </label>
                  <Select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as ProjectPriority)}
                    disabled={createProjectMutation.isPending}
                    options={[
                      { value: 'low', label: 'Low' },
                      { value: 'medium', label: 'Medium' },
                      { value: 'high', label: 'High' },
                      { value: 'urgent', label: 'Urgent' }
                    ]}
                  />
                </div>
              </div>

              {/* Due Date and Context Type */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Due Date
                  </label>
                  <Input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    disabled={createProjectMutation.isPending}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Context Type
                  </label>
                  <Select
                    value={contextType}
                    onChange={(e) => handleContextTypeChange(e.target.value as ProjectContextType | '')}
                    disabled={createProjectMutation.isPending}
                    options={[
                      { value: '', label: 'None' },
                      { value: 'asset', label: 'Asset' },
                      { value: 'portfolio', label: 'Portfolio' },
                      { value: 'theme', label: 'Theme' },
                      { value: 'workflow', label: 'Workflow' },
                      { value: 'general', label: 'General' }
                    ]}
                  />
                </div>
              </div>

              {/* Context Entity Selection */}
              {contextType && contextType !== 'general' && contextType !== '' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Select {contextType.charAt(0).toUpperCase() + contextType.slice(1)}
                  </label>

                  {/* Selected Entity Display */}
                  {contextId && (
                    <div className="mb-2 p-2 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-lg flex items-center justify-between">
                      <span className="text-sm text-gray-900 dark:text-white">
                        {getContextEntityName(contextId)}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setContextId('')
                          setContextSearchQuery('')
                        }}
                        className="text-gray-400 hover:text-error-600 transition-colors"
                        disabled={createProjectMutation.isPending}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}

                  {/* Entity Search and Selection */}
                  {!contextId && (
                    <div className="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
                      {/* Search */}
                      <div className="p-3 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                          <input
                            type="text"
                            placeholder={`Search ${contextType}s...`}
                            value={contextSearchQuery}
                            onChange={(e) => setContextSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:text-white"
                          />
                        </div>
                      </div>

                      {/* Entity List */}
                      <div className="max-h-48 overflow-y-auto">
                        {filteredContextEntities.length > 0 ? (
                          filteredContextEntities.map((entity: any) => (
                            <button
                              key={entity.id}
                              type="button"
                              onClick={() => {
                                setContextId(entity.id)
                                setContextSearchQuery('')
                              }}
                              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left"
                            >
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                  {contextType === 'asset'
                                    ? `${entity.symbol} - ${entity.company_name}`
                                    : entity.name}
                                </p>
                              </div>
                            </button>
                          ))
                        ) : (
                          <div className="px-4 py-6 text-center">
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                              No {contextType}s found
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Team Members */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Team Members {teamMembers.length > 0 && `(${teamMembers.length})`}
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowTeamSection(!showTeamSection)}
                    className="text-sm text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                  >
                    {showTeamSection ? 'Hide' : 'Add Members'}
                  </button>
                </div>

                {/* Selected Team Members */}
                {teamMembers.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {teamMembers.map((tm) => {
                      const member = users?.find(u => u.id === tm.userId)
                      return (
                        <div key={tm.userId} className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-700 rounded-lg">
                          <div className="w-7 h-7 rounded-full bg-primary-600 flex items-center justify-center flex-shrink-0">
                            <span className="text-white text-xs font-semibold">
                              {getUserInitials(member)}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                              {getUserName(member)}
                            </div>
                          </div>
                          <select
                            value={tm.role}
                            onChange={(e) => handleUpdateTeamMemberRole(tm.userId, e.target.value as ProjectAssignmentRole)}
                            disabled={createProjectMutation.isPending}
                            className="text-xs px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                          >
                            <option value="contributor">Contributor</option>
                            <option value="reviewer">Reviewer</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => handleRemoveTeamMember(tm.userId)}
                            className="text-gray-400 hover:text-error-600 transition-colors"
                            disabled={createProjectMutation.isPending}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Inline Team Member Selector */}
                {showTeamSection && (
                  <div className="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
                    {/* Search */}
                    <div className="p-3 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                        <input
                          type="text"
                          placeholder="Search users..."
                          value={userSearchQuery}
                          onChange={(e) => setUserSearchQuery(e.target.value)}
                          className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:text-white"
                        />
                      </div>
                    </div>

                    {/* User List */}
                    <div className="max-h-48 overflow-y-auto">
                      {filteredUsers && filteredUsers.length > 0 ? (
                        filteredUsers
                          .filter(u => u.id !== user?.id) // Exclude current user
                          .map((u) => {
                            const isAdded = teamMembers.some(tm => tm.userId === u.id)
                            return (
                              <label
                                key={u.id}
                                className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors"
                              >
                                <input
                                  type="checkbox"
                                  checked={isAdded}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      handleAddTeamMember(u.id, 'contributor')
                                    } else {
                                      handleRemoveTeamMember(u.id)
                                    }
                                  }}
                                  className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                                />
                                <div className="w-7 h-7 rounded-full bg-primary-600 flex items-center justify-center flex-shrink-0">
                                  <span className="text-white text-xs font-semibold">
                                    {getUserInitials(u)}
                                  </span>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                    {getUserName(u)}
                                  </p>
                                  {u.first_name && u.last_name && (
                                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                      {u.email}
                                    </p>
                                  )}
                                </div>
                              </label>
                            )
                          })
                      ) : (
                        <div className="px-4 py-6 text-center">
                          <p className="text-sm text-gray-500 dark:text-gray-400">No users found</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Deliverables */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Deliverables
                </label>

                {/* Deliverables List */}
                {deliverables.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {deliverables.map((deliverable, index) => (
                      <div key={deliverable.id} className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-700 rounded-lg">
                        <span className="text-sm text-gray-500 dark:text-gray-400 w-6">{index + 1}.</span>
                        <span className="flex-1 text-sm text-gray-900 dark:text-white">{deliverable.title}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveDeliverable(deliverable.id)}
                          className="text-gray-400 hover:text-error-600 transition-colors"
                          disabled={createProjectMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add Deliverable Input */}
                <div className="flex gap-2">
                  <Input
                    type="text"
                    value={newDeliverable}
                    onChange={(e) => setNewDeliverable(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleAddDeliverable()
                      }
                    }}
                    placeholder="Add a deliverable..."
                    disabled={createProjectMutation.isPending}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleAddDeliverable}
                    disabled={!newDeliverable.trim() || createProjectMutation.isPending}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Error Message */}
              {createProjectMutation.isError && (
                <div className="p-3 bg-error-50 dark:bg-error-900/20 border border-error-200 dark:border-error-800 rounded-lg">
                  <p className="text-sm text-error-600 dark:text-error-400">
                    {createProjectMutation.error instanceof Error
                      ? createProjectMutation.error.message
                      : 'Failed to create project'}
                  </p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  resetForm()
                  onClose()
                }}
                className="flex-1"
                disabled={createProjectMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                className="flex-1"
                loading={createProjectMutation.isPending}
                disabled={!title.trim() || createProjectMutation.isPending}
              >
                Create Project
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
