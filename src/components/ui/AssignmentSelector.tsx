import React, { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { UserPlus, X, Calendar, Check, Search } from 'lucide-react'
import { Button } from './Button'

interface User {
  id: string
  email: string
  first_name?: string
  last_name?: string
}

interface Assignment {
  id: string
  assigned_user_id: string
  assigned_by: string
  due_date?: string
  notes?: string
  user?: User
}

interface AssignmentSelectorProps {
  checklistItemId?: string
  assetId?: string
  workflowId?: string
  stageId?: string
  type: 'task' | 'stage'
  onAssignmentChange?: () => void
  autoOpenModal?: boolean
  onModalClose?: () => void
}

export function AssignmentSelector({
  checklistItemId,
  assetId,
  workflowId,
  stageId,
  type,
  onAssignmentChange,
  autoOpenModal = false,
  onModalClose
}: AssignmentSelectorProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [showAssignModal, setShowAssignModal] = useState(autoOpenModal)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [userSearchQuery, setUserSearchQuery] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')

  // Auto-open modal if autoOpenModal prop is true
  useEffect(() => {
    if (autoOpenModal) {
      setShowAssignModal(true)
    }
  }, [autoOpenModal])

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

  // Fetch existing assignments
  const { data: assignments } = useQuery({
    queryKey: type === 'task'
      ? ['task-assignments', checklistItemId]
      : ['stage-assignments', assetId, workflowId, stageId],
    queryFn: async () => {
      if (type === 'task' && checklistItemId) {
        const { data, error } = await supabase
          .from('checklist_task_assignments')
          .select(`
            *,
            user:users!checklist_task_assignments_assigned_user_id_fkey(id, email, first_name, last_name)
          `)
          .eq('checklist_item_id', checklistItemId)
        if (error) throw error
        return data as Assignment[]
      } else if (type === 'stage' && assetId && workflowId && stageId) {
        const { data, error } = await supabase
          .from('stage_assignments')
          .select(`
            *,
            user:users!stage_assignments_assigned_user_id_fkey(id, email, first_name, last_name)
          `)
          .eq('asset_id', assetId)
          .eq('workflow_id', workflowId)
          .eq('stage_id', stageId)
        if (error) throw error
        return data as Assignment[]
      }
      return []
    },
    enabled: (type === 'task' && !!checklistItemId) || (type === 'stage' && !!assetId && !!workflowId && !!stageId)
  })

  // Create assignment mutation
  const createAssignment = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('User not authenticated')

      if (type === 'task' && checklistItemId) {
        // Create task assignment
        const { error: assignmentError } = await supabase
          .from('checklist_task_assignments')
          .insert({
            checklist_item_id: checklistItemId,
            assigned_user_id: selectedUserId,
            assigned_by: user.id,
            due_date: dueDate || null,
            notes: notes || null
          })

        if (assignmentError) throw assignmentError
      } else if (type === 'stage' && assetId && workflowId && stageId) {
        // Create stage assignment
        const { error: assignmentError } = await supabase
          .from('stage_assignments')
          .insert({
            asset_id: assetId,
            workflow_id: workflowId,
            stage_id: stageId,
            assigned_user_id: selectedUserId,
            assigned_by: user.id,
            due_date: dueDate || null,
            notes: notes || null
          })

        if (assignmentError) throw assignmentError
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: type === 'task' ? ['task-assignments'] : ['stage-assignments'] })
      setShowAssignModal(false)
      setSelectedUserId('')
      setUserSearchQuery('')
      setDueDate('')
      setNotes('')
      onAssignmentChange?.()
      onModalClose?.()
    }
  })

  // Delete assignment mutation
  const deleteAssignment = useMutation({
    mutationFn: async (assignmentId: string) => {
      const table = type === 'task' ? 'checklist_task_assignments' : 'stage_assignments'
      const { error } = await supabase
        .from(table)
        .delete()
        .eq('id', assignmentId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: type === 'task' ? ['task-assignments'] : ['stage-assignments'] })
      onAssignmentChange?.()
    }
  })

  const getUserName = (user?: User) => {
    if (!user) return 'Unknown'
    if (user.first_name && user.last_name) {
      return `${user.first_name} ${user.last_name}`
    }
    return user.email
  }

  // Filter users based on search query
  const filteredUsers = useMemo(() => {
    if (!users) return []
    if (!userSearchQuery.trim()) return users

    const query = userSearchQuery.toLowerCase()
    return users.filter(user => {
      const name = getUserName(user).toLowerCase()
      return name.includes(query) || user.email.toLowerCase().includes(query)
    })
  }, [users, userSearchQuery])

  return (
    <div className="space-y-2">
      {/* Show existing assignments */}
      {assignments && assignments.length > 0 && (
        <div className="space-y-1">
          {assignments.map((assignment) => (
            <div
              key={assignment.id}
              className="flex items-center justify-between p-2 bg-blue-50 rounded-lg text-sm"
            >
              <div className="flex items-center space-x-2 flex-1 min-w-0">
                <UserPlus className="w-4 h-4 text-blue-600 flex-shrink-0" />
                <span className="text-gray-900 truncate">
                  {getUserName(assignment.user)}
                </span>
                {assignment.due_date && (
                  <span className="text-gray-500 text-xs flex items-center">
                    <Calendar className="w-3 h-3 mr-1" />
                    {new Date(assignment.due_date).toLocaleDateString()}
                  </span>
                )}
              </div>
              <button
                onClick={() => deleteAssignment.mutate(assignment.id)}
                className="ml-2 text-gray-400 hover:text-gray-600 flex-shrink-0"
                title="Remove assignment"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Assign button - only show if not auto-opening */}
      {!autoOpenModal && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowAssignModal(true)}
          className="w-full text-gray-600 hover:text-gray-900"
        >
          <UserPlus className="w-4 h-4 mr-2" />
          Assign {type === 'task' ? 'Task' : 'Stage'}
        </Button>
      )}

      {/* Assignment modal */}
      {showAssignModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                Assign {type === 'task' ? 'Task' : 'Stage'}
              </h3>
              <button
                onClick={() => {
                  setShowAssignModal(false)
                  onModalClose?.()
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* User selection with type-ahead search */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Assign to
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search for a user..."
                    value={userSearchQuery}
                    onChange={(e) => setUserSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* User list */}
                <div className="mt-2 max-h-48 overflow-y-auto border border-gray-300 rounded-lg">
                  {filteredUsers.length > 0 ? (
                    filteredUsers.map((user) => (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => setSelectedUserId(user.id)}
                        className={`w-full px-3 py-2 text-left hover:bg-gray-100 transition-colors ${
                          selectedUserId === user.id ? 'bg-blue-50 border-l-4 border-blue-500' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-gray-900">{getUserName(user)}</p>
                            {user.first_name && user.last_name && (
                              <p className="text-xs text-gray-500">{user.email}</p>
                            )}
                          </div>
                          {selectedUserId === user.id && (
                            <Check className="w-4 h-4 text-blue-600" />
                          )}
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-4 text-center text-sm text-gray-500">
                      No users found
                    </div>
                  )}
                </div>
              </div>

              {/* Due date */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Due date (optional)
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notes (optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add any notes about this assignment..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  rows={3}
                />
              </div>

              {/* Action buttons */}
              <div className="flex space-x-2">
                <Button
                  onClick={() => createAssignment.mutate()}
                  disabled={!selectedUserId || createAssignment.isPending}
                  className="flex-1"
                >
                  <Check className="w-4 h-4 mr-2" />
                  Assign
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowAssignModal(false)
                    onModalClose?.()
                  }}
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
