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
  hideAssignedSection?: boolean
  children?: React.ReactNode
}

export function AssignmentSelector({
  checklistItemId,
  assetId,
  workflowId,
  stageId,
  type,
  onAssignmentChange,
  autoOpenModal = false,
  onModalClose,
  hideAssignedSection = false,
  children
}: AssignmentSelectorProps) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])
  const [userSearchQuery, setUserSearchQuery] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [hoveredUserId, setHoveredUserId] = useState<string | null>(null)
  const [assignmentsToRemove, setAssignmentsToRemove] = useState<string[]>([])

  // Auto-open modal if autoOpenModal prop is true
  useEffect(() => {
    console.log('🔔 AssignmentSelector: useEffect triggered, autoOpenModal =', autoOpenModal)
    if (autoOpenModal) {
      console.log('🔔 AssignmentSelector: autoOpenModal is true, opening modal')
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

      // First, execute any pending deletions
      const table = type === 'task' ? 'checklist_task_assignments' : 'stage_assignments'
      if (assignmentsToRemove.length > 0) {
        const { error: deleteError } = await supabase
          .from(table)
          .delete()
          .in('id', assignmentsToRemove)

        if (deleteError) throw deleteError
      }

      // Then create new assignments for all selected users
      if (selectedUserIds.length > 0) {
        if (type === 'task' && checklistItemId) {
          // Create task assignments for all selected users
          const assignments = selectedUserIds.map(userId => ({
            checklist_item_id: checklistItemId,
            assigned_user_id: userId,
            assigned_by: user.id,
            due_date: dueDate || null,
            notes: notes || null
          }))

          console.log('🔄 AssignmentSelector: Attempting to upsert task assignments:', assignments)

          const { data: upsertData, error: assignmentError } = await supabase
            .from('checklist_task_assignments')
            .upsert(assignments, {
              onConflict: 'checklist_item_id,assigned_user_id',
              ignoreDuplicates: false
            })

          if (assignmentError) {
            console.error('❌ AssignmentSelector: Task assignment upsert error:', assignmentError)
            throw assignmentError
          }

          console.log('✅ AssignmentSelector: Task assignments upserted successfully:', upsertData)

          // Create notifications for all assigned users
          if (assetId) {
            const notifications = selectedUserIds.map(userId => ({
              user_id: userId,
              type: 'task_assigned' as const,
              title: 'New Task Assignment',
              message: `You have been assigned to a task`,
              context_type: 'asset' as const,
              context_id: assetId,
              context_data: {
                checklist_item_id: checklistItemId,
                assigned_by: user.id
              }
            }))

            await supabase.from('notifications').insert(notifications)
          }
        } else if (type === 'stage' && assetId && workflowId && stageId) {
          // Create stage assignments for all selected users
          const assignments = selectedUserIds.map(userId => ({
            asset_id: assetId,
            workflow_id: workflowId,
            stage_id: stageId,
            assigned_user_id: userId,
            assigned_by: user.id,
            due_date: dueDate || null,
            notes: notes || null
          }))

          console.log('🔄 AssignmentSelector: Attempting to upsert stage assignments:', assignments)

          const { data: upsertData, error: assignmentError } = await supabase
            .from('stage_assignments')
            .upsert(assignments, {
              onConflict: 'asset_id,workflow_id,stage_id,assigned_user_id',
              ignoreDuplicates: false
            })

          if (assignmentError) {
            console.error('❌ AssignmentSelector: Stage assignment upsert error:', assignmentError)
            throw assignmentError
          }

          console.log('✅ AssignmentSelector: Stage assignments upserted successfully:', upsertData)

          // Create notifications for all assigned users
          const notifications = selectedUserIds.map(userId => ({
            user_id: userId,
            type: 'task_assigned' as const,
            title: 'New Stage Assignment',
            message: `You have been assigned to a workflow stage`,
            context_type: 'asset' as const,
            context_id: assetId,
            context_data: {
              workflow_id: workflowId,
              stage_id: stageId,
              assigned_by: user.id
            }
          }))

          await supabase.from('notifications').insert(notifications)
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: type === 'task' ? ['task-assignments'] : ['stage-assignments'] })
      setShowAssignModal(false)
      setSelectedUserIds([])
      setUserSearchQuery('')
      setDueDate('')
      setNotes('')
      setAssignmentsToRemove([])
      onAssignmentChange?.()
      onModalClose?.()
    }
  })

  // Delete assignment mutation
  const deleteAssignment = useMutation({
    mutationFn: async (assignmentId: string) => {
      const table = type === 'task' ? 'checklist_task_assignments' : 'stage_assignments'
      console.log(`🗑️ Attempting to delete assignment ${assignmentId} from ${table}`)

      const { error } = await supabase
        .from(table)
        .delete()
        .eq('id', assignmentId)

      if (error) {
        console.error('❌ Error deleting assignment:', error)
        throw error
      }

      console.log(`✅ Successfully deleted assignment ${assignmentId}`)
    },
    onSuccess: () => {
      console.log('🔄 Invalidating queries after successful deletion')
      queryClient.invalidateQueries({ queryKey: type === 'task' ? ['task-assignments'] : ['stage-assignments'] })
      onAssignmentChange?.()
    },
    onError: (error) => {
      console.error('❌ Delete assignment mutation error:', error)
      alert(`Failed to remove assignment: ${error.message}`)
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

  // Handle removing assignment (staged for deletion, will execute on Save)
  const handleRemoveAssignment = (assignmentId: string, userName: string) => {
    setAssignmentsToRemove(prev => [...prev, assignmentId])
  }

  return (
    <div className="space-y-2">
      {/* Only show assigned section if not auto-opening modal and not hidden */}
      {!autoOpenModal && !hideAssignedSection && (
        <div className="space-y-2">
          {/* Header with badges and Assign Button */}
          <div className="flex items-center gap-2">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Assigned to
            </div>

            {/* Show existing assignments inline */}
            {assignments && assignments.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {assignments.map((assignment) => (
                <div
                  key={assignment.id}
                  className="relative group"
                  onMouseEnter={() => setHoveredUserId(assignment.assigned_user_id)}
                  onMouseLeave={() => setHoveredUserId(null)}
                >
                  <div
                    className="w-7 h-7 rounded-full bg-blue-600 hover:bg-blue-700 flex items-center justify-center flex-shrink-0 transition-colors cursor-pointer"
                    onClick={async () => {
                      await handleOpenConversation(assignment.assigned_user_id)
                    }}
                    title={`Assigned to ${getUserName(assignment.user)}. Click to message.`}
                  >
                    <span className="text-white text-[10px] font-semibold">
                      {getUserName(assignment.user).split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                    </span>
                  </div>

                  {/* Hover tooltip */}
                  {hoveredUserId !== assignment.assigned_user_id && (
                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 z-50 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                      <div className="bg-gray-900 text-white text-xs px-2 py-1.5 rounded shadow-lg whitespace-nowrap">
                        <div className="font-medium">{getUserName(assignment.user)}</div>
                        {assignment.due_date && (
                          <div className="text-gray-300 text-[10px] mt-0.5">
                            Due {new Date(assignment.due_date).toLocaleDateString()}
                          </div>
                        )}
                        <div className="text-gray-400 text-[10px] mt-0.5">Click to message</div>
                        <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-4 border-transparent border-t-gray-900"></div>
                      </div>
                    </div>
                  )}
                </div>
                ))}
              </div>
            )}

            <button
              onClick={() => setShowAssignModal(true)}
              className="w-6 h-6 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center transition-colors"
              title={`Assign ${type === 'task' ? 'Task' : 'Stage'}`}
            >
              <UserPlus className="w-3.5 h-3.5 text-gray-600" />
            </button>
          </div>

          {/* Set Deadline section - only for stage type */}
          {type === 'stage' && children}
        </div>
      )}

      {/* Assignment modal */}
      {showAssignModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg sm:max-w-xl md:max-w-2xl lg:max-w-3xl max-h-[85vh] sm:max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex-shrink-0 bg-white border-b border-gray-200 px-4 sm:px-6 py-3 sm:py-4 rounded-t-xl">
              <div className="flex items-center justify-between">
                <h3 className="text-lg sm:text-xl font-semibold text-gray-900">
                  Assign {type === 'task' ? 'Task' : 'Stage'}
                </h3>
                <button
                  onClick={() => {
                    setShowAssignModal(false)
                    setSelectedUserId('')
                    setUserSearchQuery('')
                    setDueDate('')
                    setNotes('')
                    onModalClose?.()
                  }}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Show existing assignments at top of modal */}
            {assignments && assignments.length > 0 && (
              <div className="flex-shrink-0 px-4 sm:px-6 py-3 sm:py-4 bg-gray-50 border-b border-gray-200">
                <div className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">
                  Currently Assigned
                </div>
                <div className="flex flex-wrap gap-2">
                  {assignments.filter(a => !assignmentsToRemove.includes(a.id)).map((assignment) => (
                    <div
                      key={assignment.id}
                      className="relative group"
                      onMouseEnter={() => setHoveredUserId(assignment.assigned_user_id)}
                      onMouseLeave={() => setHoveredUserId(null)}
                    >
                      <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0 transition-colors relative">
                        <span className="text-white text-xs font-semibold">
                          {getUserName(assignment.user).split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                        </span>

                        {/* X button overlay on hover */}
                        {hoveredUserId === assignment.assigned_user_id && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleRemoveAssignment(assignment.id, getUserName(assignment.user))
                            }}
                            className="absolute inset-0 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center transition-all"
                            title="Remove assignment"
                          >
                            <X className="w-5 h-5 text-white" />
                          </button>
                        )}
                      </div>

                      {/* Tooltip showing user name */}
                      {hoveredUserId !== assignment.assigned_user_id && (
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 z-50 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150">
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
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Content - Scrollable */}
            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-5">
              {/* User selection with type-ahead search */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Select User *
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search by name or email..."
                    value={userSearchQuery}
                    onChange={(e) => setUserSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                    autoFocus
                  />
                </div>

                {/* User list */}
                <div className="mt-3 max-h-60 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                  {filteredUsers.length > 0 ? (
                    filteredUsers.map((user) => {
                      const isSelected = selectedUserIds.includes(user.id)
                      return (
                        <button
                          key={user.id}
                          type="button"
                          onClick={() => {
                            setSelectedUserIds(prev =>
                              prev.includes(user.id)
                                ? prev.filter(id => id !== user.id)
                                : [...prev, user.id]
                            )
                          }}
                          className={`w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors ${
                            isSelected ? 'bg-blue-50' : ''
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-5 h-5 flex items-center justify-center border-2 rounded ${
                              isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-300'
                            }`}>
                              {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{getUserName(user)}</p>
                              {user.first_name && user.last_name && (
                                <p className="text-xs text-gray-500 truncate mt-0.5">{user.email}</p>
                              )}
                            </div>
                          </div>
                        </button>
                      )
                    })
                  ) : (
                    <div className="px-4 py-8 text-center">
                      <p className="text-sm text-gray-500">No users found</p>
                      <p className="text-xs text-gray-400 mt-1">Try adjusting your search</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Due date */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Due Date <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Notes <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add any notes or context about this assignment..."
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-sm"
                  rows={4}
                />
              </div>
            </div>

            {/* Footer with action buttons */}
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-4 sm:px-6 py-3 sm:py-4 rounded-b-xl flex flex-col sm:flex-row gap-2 sm:gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setShowAssignModal(false)
                  setSelectedUserIds([])
                  setUserSearchQuery('')
                  setDueDate('')
                  setNotes('')
                  setAssignmentsToRemove([])
                  onModalClose?.()
                }}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={() => createAssignment.mutate()}
                disabled={(selectedUserIds.length === 0 && assignmentsToRemove.length === 0) || createAssignment.isPending}
                className="flex-1"
              >
                {createAssignment.isPending ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Save
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
