import React, { useState, useEffect } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import {
  FolderKanban,
  Calendar,
  Users,
  CheckCircle,
  Circle,
  Clock,
  AlertCircle,
  Ban,
  Plus,
  Trash2,
  User,
  MessageSquare,
  Edit,
  X,
  Activity
} from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { Input } from '../ui/Input'
import { TextArea } from '../ui/TextArea'
import { Select } from '../ui/Select'
import { supabase } from '../../lib/supabase'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'
import type { ProjectWithAssignments, ProjectStatus, ProjectPriority } from '../../types/project'
import { useAuth } from '../../hooks/useAuth'
import { ProjectActivityFeed } from '../projects/ProjectActivityFeed'

// Project detail tab component

interface ProjectDetailTabProps {
  project: ProjectWithAssignments
  onNavigate?: (tab: { id: string; title: string; type: string; data?: any }) => void
}

export function ProjectDetailTab({ project, onNavigate }: ProjectDetailTabProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'overview' | 'deliverables' | 'team' | 'comments' | 'activity'>('overview')
  const [newDeliverable, setNewDeliverable] = useState('')
  const [newComment, setNewComment] = useState('')
  const [editingProject, setEditingProject] = useState(false)
  const [editedTitle, setEditedTitle] = useState(project.title)
  const [editedDescription, setEditedDescription] = useState(project.description || '')
  const [editedStatus, setEditedStatus] = useState(project.status)
  const [editedPriority, setEditedPriority] = useState(project.priority)
  const [editedDueDate, setEditedDueDate] = useState(project.due_date || '')

  // Fetch deliverables
  const { data: deliverables } = useQuery({
    queryKey: ['project-deliverables', project.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_deliverables')
        .select('*')
        .eq('project_id', project.id)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data || []
    }
  })

  // Fetch comments
  const { data: comments } = useQuery({
    queryKey: ['project-comments', project.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_comments')
        .select(`
          *,
          user:users(id, first_name, last_name, email)
        `)
        .eq('project_id', project.id)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data || []
    }
  })

  // Fetch team members with user details
  const { data: teamMembers } = useQuery({
    queryKey: ['project-team', project.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_assignments')
        .select(`
          *,
          user:users(id, first_name, last_name, email),
          assigner:assigned_by(id, first_name, last_name, email)
        `)
        .eq('project_id', project.id)

      if (error) throw error
      return data || []
    }
  })

  // Update project mutation
  const updateProjectMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('projects')
        .update({
          title: editedTitle,
          description: editedDescription,
          status: editedStatus,
          priority: editedPriority,
          due_date: editedDueDate || null
        })
        .eq('id', project.id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setEditingProject(false)
    }
  })

  // Add deliverable mutation
  const addDeliverableMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('project_deliverables')
        .insert({
          project_id: project.id,
          title: newDeliverable,
          completed: false
        })

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-deliverables', project.id] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setNewDeliverable('')
    }
  })

  // Toggle deliverable completion mutation
  const toggleDeliverableMutation = useMutation({
    mutationFn: async ({ id, completed }: { id: string, completed: boolean }) => {
      const { error } = await supabase
        .from('project_deliverables')
        .update({ completed: !completed })
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-deliverables', project.id] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    }
  })

  // Delete deliverable mutation
  const deleteDeliverableMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('project_deliverables')
        .delete()
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-deliverables', project.id] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    }
  })

  // Add comment mutation
  const addCommentMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error('Not authenticated')

      const { error } = await supabase
        .from('project_comments')
        .insert({
          project_id: project.id,
          user_id: user.id,
          content: newComment
        })

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-comments', project.id] })
      setNewComment('')
    }
  })

  const getStatusIcon = (status: ProjectStatus) => {
    switch (status) {
      case 'planning':
        return <Circle className="w-4 h-4" />
      case 'in_progress':
        return <Clock className="w-4 h-4" />
      case 'blocked':
        return <AlertCircle className="w-4 h-4" />
      case 'completed':
        return <CheckCircle className="w-4 h-4" />
      case 'cancelled':
        return <Ban className="w-4 h-4" />
    }
  }

  const getStatusColor = (status: ProjectStatus) => {
    switch (status) {
      case 'planning':
        return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
      case 'in_progress':
        return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
      case 'blocked':
        return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
      case 'completed':
        return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
      case 'cancelled':
        return 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500'
    }
  }

  const getPriorityColor = (priority: ProjectPriority) => {
    switch (priority) {
      case 'urgent':
        return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
      case 'high':
        return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
      case 'medium':
        return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
      case 'low':
        return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
    }
  }

  const isOverdue = project.due_date && new Date(project.due_date) < new Date() && project.status !== 'completed'
  const totalDeliverables = deliverables?.length || 0
  const completedDeliverables = deliverables?.filter(d => d.completed).length || 0
  const completionPercentage = totalDeliverables > 0 ? (completedDeliverables / totalDeliverables) * 100 : 0

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="px-6 py-4">
          {editingProject ? (
            <div className="space-y-4">
              <Input
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                className="text-2xl font-bold"
                placeholder="Project title"
              />
              <TextArea
                value={editedDescription}
                onChange={(e) => setEditedDescription(e.target.value)}
                rows={3}
                placeholder="Project description"
              />
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Status
                  </label>
                  <Select
                    value={editedStatus}
                    onChange={(e) => setEditedStatus(e.target.value as ProjectStatus)}
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
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Priority
                  </label>
                  <Select
                    value={editedPriority}
                    onChange={(e) => setEditedPriority(e.target.value as ProjectPriority)}
                    options={[
                      { value: 'urgent', label: 'Urgent' },
                      { value: 'high', label: 'High' },
                      { value: 'medium', label: 'Medium' },
                      { value: 'low', label: 'Low' }
                    ]}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Due Date
                  </label>
                  <Input
                    type="date"
                    value={editedDueDate}
                    onChange={(e) => setEditedDueDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => updateProjectMutation.mutate()}>
                  Save Changes
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditingProject(false)
                    setEditedTitle(project.title)
                    setEditedDescription(project.description || '')
                    setEditedStatus(project.status)
                    setEditedPriority(project.priority)
                    setEditedDueDate(project.due_date || '')
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center">
                    <FolderKanban className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{project.title}</h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {project.created_at ? `Created ${formatDistanceToNow(new Date(project.created_at), { addSuffix: true })}` : 'Recently created'}
                    </p>
                  </div>
                </div>
                {project.created_by === user?.id && (
                  <Button variant="outline" onClick={() => setEditingProject(true)}>
                    <Edit className="w-4 h-4 mr-2" />
                    Edit Project
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-3 mb-4">
                {project.status && (
                  <Badge className={clsx('flex items-center gap-1', getStatusColor(project.status))}>
                    {getStatusIcon(project.status)}
                    <span className="capitalize">{project.status.replace('_', ' ')}</span>
                  </Badge>
                )}
                {project.priority && (
                  <Badge className={getPriorityColor(project.priority)}>
                    <span className="capitalize">{project.priority}</span>
                  </Badge>
                )}
                {project.due_date && (
                  <Badge className={clsx(
                    'flex items-center gap-1',
                    isOverdue ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                  )}>
                    <Calendar className="w-4 h-4" />
                    Due {formatDistanceToNow(new Date(project.due_date), { addSuffix: true })}
                  </Badge>
                )}
              </div>

              {project.description && (
                <p className="text-gray-600 dark:text-gray-400 mb-4">
                  {project.description}
                </p>
              )}

              {/* Progress Bar */}
              {totalDeliverables > 0 && (
                <div>
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className="text-gray-600 dark:text-gray-400">
                      {completedDeliverables} of {totalDeliverables} deliverables completed
                    </span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      {Math.round(completionPercentage)}%
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-primary-500 h-2 rounded-full transition-all"
                      style={{ width: `${completionPercentage}%` }}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Tabs */}
        {!editingProject && (
          <div className="flex border-t border-gray-200 dark:border-gray-700">
            {[
              { id: 'overview', label: 'Overview', icon: FolderKanban },
              { id: 'deliverables', label: 'Deliverables', icon: CheckCircle },
              { id: 'team', label: 'Team', icon: Users },
              { id: 'comments', label: 'Comments', icon: MessageSquare },
              { id: 'activity', label: 'Activity', icon: Activity }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={clsx(
                  'flex items-center gap-2 px-6 py-3 border-b-2 transition-colors',
                  activeTab === tab.id
                    ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                    : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                )}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      {!editingProject && (
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'overview' && (
            <div className="grid grid-cols-2 gap-6">
              <Card className="p-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  Project Details
                </h3>
                <dl className="space-y-3">
                  <div>
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Status</dt>
                    <dd className="mt-1">
                      {project.status ? (
                        <Badge className={clsx('flex items-center gap-1 w-fit', getStatusColor(project.status))}>
                          {getStatusIcon(project.status)}
                          <span className="capitalize">{project.status.replace('_', ' ')}</span>
                        </Badge>
                      ) : (
                        <span className="text-sm text-gray-500">Not set</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Priority</dt>
                    <dd className="mt-1">
                      {project.priority ? (
                        <Badge className={clsx('w-fit', getPriorityColor(project.priority))}>
                          <span className="capitalize">{project.priority}</span>
                        </Badge>
                      ) : (
                        <span className="text-sm text-gray-500">Not set</span>
                      )}
                    </dd>
                  </div>
                  {project.due_date && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Due Date</dt>
                      <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                        {new Date(project.due_date).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric'
                        })}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Created</dt>
                    <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                      {project.created_at ? formatDistanceToNow(new Date(project.created_at), { addSuffix: true }) : 'Unknown'}
                    </dd>
                  </div>
                </dl>
              </Card>

              <Card className="p-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  Progress
                </h3>
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between text-sm mb-2">
                      <span className="text-gray-600 dark:text-gray-400">Deliverables</span>
                      <span className="font-medium text-gray-900 dark:text-white">
                        {completedDeliverables}/{totalDeliverables}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                      <div
                        className="bg-primary-500 h-2 rounded-full transition-all"
                        style={{ width: `${completionPercentage}%` }}
                      />
                    </div>
                  </div>
                  <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">Team Members</span>
                      <span className="font-medium text-gray-900 dark:text-white">
                        {teamMembers?.length || 0}
                      </span>
                    </div>
                  </div>
                  <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">Comments</span>
                      <span className="font-medium text-gray-900 dark:text-white">
                        {comments?.length || 0}
                      </span>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          )}

          {activeTab === 'deliverables' && (
            <div>
              <Card className="p-6 mb-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  Add Deliverable
                </h3>
                <div className="flex gap-2">
                  <Input
                    value={newDeliverable}
                    onChange={(e) => setNewDeliverable(e.target.value)}
                    placeholder="Enter deliverable title..."
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newDeliverable.trim()) {
                        addDeliverableMutation.mutate()
                      }
                    }}
                  />
                  <Button
                    onClick={() => addDeliverableMutation.mutate()}
                    disabled={!newDeliverable.trim()}
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add
                  </Button>
                </div>
              </Card>

              <div className="space-y-3">
                {deliverables?.map((deliverable) => (
                  <Card key={deliverable.id} className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-1">
                        <button
                          onClick={() => toggleDeliverableMutation.mutate({
                            id: deliverable.id,
                            completed: deliverable.completed
                          })}
                          className={clsx(
                            'w-5 h-5 rounded border-2 flex items-center justify-center transition-colors',
                            deliverable.completed
                              ? 'bg-primary-500 border-primary-500'
                              : 'border-gray-300 dark:border-gray-600 hover:border-primary-500'
                          )}
                        >
                          {deliverable.completed && (
                            <CheckCircle className="w-4 h-4 text-white" />
                          )}
                        </button>
                        <span className={clsx(
                          'text-gray-900 dark:text-white',
                          deliverable.completed && 'line-through text-gray-500'
                        )}>
                          {deliverable.title}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (window.confirm('Are you sure you want to delete this deliverable?')) {
                            deleteDeliverableMutation.mutate(deliverable.id)
                          }
                        }}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </Card>
                ))}

                {(!deliverables || deliverables.length === 0) && (
                  <div className="text-center py-12">
                    <CheckCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-500 dark:text-gray-400">
                      No deliverables yet. Add your first one above.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'team' && (
            <div className="space-y-4">
              {teamMembers?.map((member: any) => (
                <Card key={member.id} className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center">
                        <User className="w-5 h-5 text-primary-600 dark:text-primary-400" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">
                          {member.user?.first_name && member.user?.last_name
                            ? `${member.user.first_name} ${member.user.last_name}`
                            : member.user?.email || 'Unknown User'}
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          <span className="capitalize">{member.role}</span>
                          {member.assigned_at && (
                            <>
                              {' • '}
                              Added {formatDistanceToNow(new Date(member.assigned_at), { addSuffix: true })}
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                    <Badge className="capitalize">
                      {member.role}
                    </Badge>
                  </div>
                </Card>
              ))}

              {(!teamMembers || teamMembers.length === 0) && (
                <div className="text-center py-12">
                  <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-500 dark:text-gray-400">
                    No team members assigned yet.
                  </p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'comments' && (
            <div>
              <Card className="p-6 mb-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  Add Comment
                </h3>
                <div className="space-y-3">
                  <TextArea
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="Write a comment..."
                    rows={3}
                  />
                  <Button
                    onClick={() => addCommentMutation.mutate()}
                    disabled={!newComment.trim()}
                  >
                    <MessageSquare className="w-4 h-4 mr-2" />
                    Post Comment
                  </Button>
                </div>
              </Card>

              <div className="space-y-4">
                {comments?.map((comment: any) => (
                  <Card key={comment.id} className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center flex-shrink-0">
                        <User className="w-4 h-4 text-primary-600 dark:text-primary-400" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-2">
                          <p className="font-medium text-gray-900 dark:text-white">
                            {comment.user?.first_name && comment.user?.last_name
                              ? `${comment.user.first_name} ${comment.user.last_name}`
                              : comment.user?.email || 'Unknown User'}
                          </p>
                          <span className="text-sm text-gray-500 dark:text-gray-400">
                            {comment.created_at ? formatDistanceToNow(new Date(comment.created_at), { addSuffix: true }) : ''}
                          </span>
                        </div>
                        <p className="text-gray-600 dark:text-gray-400">
                          {comment.content}
                        </p>
                      </div>
                    </div>
                  </Card>
                ))}

                {(!comments || comments.length === 0) && (
                  <div className="text-center py-12">
                    <MessageSquare className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-500 dark:text-gray-400">
                      No comments yet. Start a conversation above.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Activity Tab */}
          {activeTab === 'activity' && (
            <div className="p-6">
              <ProjectActivityFeed projectId={project.id} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
