import React, { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { UserPlus, X, Calendar, Check, Search, MessageSquare, Trash2 } from 'lucide-react'
import { Button } from './Button'
import { useNavigate } from 'react-router-dom'

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
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showAssignModal, setShowAssignModal] = useState(autoOpenModal)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [userSearchQuery, setUserSearchQuery] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [hoveredUserId, setHoveredUserId] = useState<string | null>(null)
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null)

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

  // Handle opening conversation with user
  const handleOpenConversation = async (userId: string) => {
    if (!user) return

    try {
      // Find existing direct message conversation between the two users
      const { data: existingParticipants, error: fetchError } = await supabase
        .from('conversation_participants')
        .select('conversation_id, conversations!inner(is_group)')
        .eq('user_id', user.id)

      if (fetchError) {
        console.error('Error fetching conversations:', fetchError)
        throw fetchError
      }

      // Check each conversation to see if it's a DM with the target user
      let conversationId: string | null = null
      if (existingParticipants) {
        for (const participant of existingParticipants) {
          // Only check non-group conversations
          if (!(participant.conversations as any).is_group) {
            const { data: otherParticipants, error: otherError } = await supabase
              .from('conversation_participants')
              .select('user_id')
              .eq('conversation_id', participant.conversation_id)
              .neq('user_id', user.id)

            if (otherError) continue

            // If this conversation has exactly one other participant and it's our target user
            if (otherParticipants && otherParticipants.length === 1 && otherParticipants[0].user_id === userId) {
              conversationId = participant.conversation_id
              break
            }
          }
        }
      }

      if (conversationId) {
        // Dispatch custom event to open direct messages pane with conversation
        window.dispatchEvent(new CustomEvent('openDirectMessage', {
          detail: { conversationId }
        }))
      } else {
        // Create new conversation
        const { data: newConversation, error: createError } = await supabase
          .from('conversations')
          .insert({
            is_group: false,
            created_by: user.id
          })
          .select('id')
          .single()

        if (createError) {
          console.error('Error creating conversation:', createError)
          throw createError
        }

        // Add both participants
        const { error: participantsError } = await supabase
          .from('conversation_participants')
          .insert([
            { conversation_id: newConversation.id, user_id: user.id, is_admin: true },
            { conversation_id: newConversation.id, user_id: userId, is_admin: false }
          ])

        if (participantsError) {
          console.error('Error adding participants:', participantsError)
          throw participantsError
        }

        // Dispatch custom event to open direct messages pane with new conversation
        window.dispatchEvent(new CustomEvent('openDirectMessage', {
          detail: { conversationId: newConversation.id }
        }))
      }
    } catch (error) {
      console.error('Error opening conversation:', error)
    }
  }

  // Handle removing assignment with confirmation
  const handleRemoveAssignment = (assignmentId: string, userName: string) => {
    if (confirm(`Are you sure you want to remove ${userName} from this ${type === 'task' ? 'task' : 'stage'}?`)) {
      deleteAssignment.mutate(assignmentId)
      setOpenDropdownId(null)
    }
  }

  return (
    <div className="space-y-2">
      <div>
        {/* Header with Assign Button */}
        <div className="flex items-center gap-2 mb-2">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            Assigned to
          </div>
          {!autoOpenModal && (
            <button
              onClick={() => setShowAssignModal(true)}
              className="w-6 h-6 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center transition-colors"
              title={`Assign ${type === 'task' ? 'Task' : 'Stage'}`}
            >
              <UserPlus className="w-3.5 h-3.5 text-gray-600" />
            </button>
          )}
        </div>

        {/* Show existing assignments */}
        {assignments && assignments.length > 0 && (
          <div className="flex flex-wrap gap-2 justify-end">
            {assignments.map((assignment) => (
              <div
                key={assignment.id}
                className="relative"
                onMouseEnter={() => {
                  if (openDropdownId !== assignment.id) {
                    setHoveredUserId(assignment.assigned_user_id)
                  }
                }}
                onMouseLeave={() => setHoveredUserId(null)}
              >
                <button
                  onClick={() => {
                    setHoveredUserId(null) // Hide tooltip when clicking
                    setOpenDropdownId(openDropdownId === assignment.id ? null : assignment.id)
                  }}
                  className="w-9 h-9 rounded-full bg-blue-600 hover:bg-blue-700 flex items-center justify-center flex-shrink-0 transition-colors cursor-pointer"
                >
                  <span className="text-white text-xs font-semibold">
                    {getUserName(assignment.user).split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                  </span>
                </button>

                {/* Hover tooltip - only show when dropdown is closed and hovering */}
                {hoveredUserId === assignment.assigned_user_id && openDropdownId !== assignment.id && (
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 z-50 pointer-events-none animate-in fade-in slide-in-from-bottom-1 duration-150">
                    <div className="bg-gray-900 text-white text-xs px-2 py-1.5 rounded shadow-lg whitespace-nowrap">
                      <div className="font-medium">{getUserName(assignment.user)}</div>
                      {assignment.due_date && (
                        <div className="text-gray-300 text-[10px] mt-0.5">
                          Due {new Date(assignment.due_date).toLocaleDateString()}
                        </div>
                      )}
                      <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-4 border-transparent border-t-gray-900"></div>
                    </div>
                  </div>
                )}

                {/* Dropdown menu */}
                {openDropdownId === assignment.id && (
                  <>
                    {/* Backdrop to close dropdown */}
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setOpenDropdownId(null)}
                    />

                    <div className="absolute top-full left-0 mt-1 z-50 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[160px]">
                      <button
                        onClick={async () => {
                          setOpenDropdownId(null)
                          await handleOpenConversation(assignment.assigned_user_id)
                        }}
                        className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center space-x-2"
                      >
                        <MessageSquare className="w-4 h-4" />
                        <span>Message</span>
                      </button>
                      <button
                        onClick={() => handleRemoveAssignment(assignment.id, getUserName(assignment.user))}
                        className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center space-x-2"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>Remove</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

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
