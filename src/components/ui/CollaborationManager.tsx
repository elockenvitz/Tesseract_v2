import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Users, Plus, X, Trash2, Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Card } from './Card'
import { Button } from './Button'
import { Badge } from './Badge'
import { Select } from './Select'

interface CollaborationManagerProps {
  noteId: string
  noteType: 'asset' | 'portfolio' | 'theme' | 'custom'
  noteTitle: string
  isOpen: boolean
  onClose: () => void
}

interface Collaboration {
  id: string
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

export function CollaborationManager({ 
  noteId, 
  noteType, 
  noteTitle, 
  isOpen, 
  onClose 
}: CollaborationManagerProps) {
  const [inviteEmail, setInviteEmail] = useState('')
  const [invitePermission, setInvitePermission] = useState<'read' | 'write'>('read')
  const [searchQuery, setSearchQuery] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean
    collaborationId: string | null
    userEmail: string
  }>({
    isOpen: false,
    collaborationId: null,
    userEmail: ''
  })
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch existing collaborations
  const { data: collaborations, isLoading } = useQuery({
    queryKey: ['note-collaborations', noteId, noteType],
    queryFn: async () => {
      // First get collaborations
      const { data: collaborationsData, error: collaborationsError } = await supabase
        .from('note_collaborations')
        .select('*')
        .eq('note_id', noteId)
        .eq('note_type', noteType)
        .order('created_at', { ascending: false })
      
      if (collaborationsError) throw collaborationsError
      if (!collaborationsData || collaborationsData.length === 0) return []

      // Get unique user IDs
      const userIds = [...new Set(collaborationsData.map(c => c.user_id))]
      
      // Fetch user details separately
      const { data: usersData, error: usersError } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .in('id', userIds)
      
      if (usersError) throw usersError
      
      // Combine the data
      const usersMap = new Map(usersData?.map(u => [u.id, u]) || [])
      
      return collaborationsData.map(collaboration => ({
        ...collaboration,
        user: usersMap.get(collaboration.user_id)
      })) as Collaboration[]
    },
    enabled: isOpen
  })

  // Search for users to invite
  const { data: searchResults } = useQuery({
    queryKey: ['user-search', searchQuery],
    queryFn: async () => {
      if (!searchQuery.trim() || searchQuery.length < 2) return []
      
      console.log('🔍 Searching for users with query:', searchQuery)
      
      // First, let's check if there are any users at all
      const { data: allUsers, error: allUsersError } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .neq('id', user?.id) // Exclude current user
      
      console.log('👥 Total users in database (excluding current user):', allUsers?.length || 0)
      console.log('📋 All users:', allUsers)
      
      if (allUsersError) {
        console.error('❌ Failed to fetch all users:', allUsersError)
        throw allUsersError
      }
      
      // If no users exist, return empty array
      if (!allUsers || allUsers.length === 0) {
        console.log('⚠️ No other users found in the database')
        return []
      }
      
      // Now perform the search
      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .or(`email.ilike.%${searchQuery.toLowerCase()}%,first_name.ilike.%${searchQuery.toLowerCase()}%,last_name.ilike.%${searchQuery.toLowerCase()}%`)
        .neq('id', user?.id) // Exclude current user
        .limit(10)
      
      if (error) {
        console.error('❌ User search failed:', error)
        throw error
      }
      
      console.log('✅ User search results:', data?.length || 0, 'users found')
      console.log('📋 Search results:', data)
      
      // Filter out users who are already collaborators
      const existingUserIds = new Set(collaborations?.map(c => c.user_id) || [])
      console.log('🚫 Existing collaborator user IDs:', Array.from(existingUserIds))
      const filteredResults = data?.filter(u => !existingUserIds.has(u.id)) || []
      console.log('🔍 After filtering existing collaborators:', filteredResults.length, 'users available')
      
      return filteredResults
    },
    enabled: isOpen && searchQuery.length >= 2
  })

  // Invite user mutation
  const inviteUserMutation = useMutation({
    mutationFn: async ({ userId, permission }: { userId: string; permission: 'read' | 'write' }) => {
      const { error } = await supabase
        .from('note_collaborations')
        .insert({
          note_id: noteId,
          note_type: noteType,
          user_id: userId,
          permission,
          invited_by: user?.id
        })
      
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['note-collaborations', noteId, noteType] })
      setInviteEmail('')
      setSearchQuery('')
    }
  })

  // Update permission mutation
  const updatePermissionMutation = useMutation({
    mutationFn: async ({ collaborationId, permission }: { collaborationId: string; permission: 'read' | 'write' | 'admin' }) => {
      const { error } = await supabase
        .from('note_collaborations')
        .update({ permission, updated_at: new Date().toISOString() })
        .eq('id', collaborationId)
      
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['note-collaborations', noteId, noteType] })
    }
  })

  // Remove collaboration mutation
  const removeCollaborationMutation = useMutation({
    mutationFn: async (collaborationId: string) => {
      const { error } = await supabase
        .from('note_collaborations')
        .delete()
        .eq('id', collaborationId)
      
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['note-collaborations', noteId, noteType] })
      setDeleteConfirm({ isOpen: false, collaborationId: null, userEmail: '' })
    }
  })

  const handleInviteUser = (userId: string) => {
    inviteUserMutation.mutate({ userId, permission: invitePermission })
  }

  const handleUpdatePermission = (collaborationId: string, permission: 'read' | 'write' | 'admin') => {
    updatePermissionMutation.mutate({ collaborationId, permission })
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
      removeCollaborationMutation.mutate(deleteConfirm.collaborationId)
    }
  }

  const getPermissionColor = (permission: string) => {
    switch (permission) {
      case 'admin': return 'error'
      case 'write': return 'warning'
      case 'read': return 'success'
      default: return 'default'
    }
  }

  const getUserDisplayName = (collaboration: Collaboration) => {
    const user = collaboration.user
    if (!user) return 'Unknown User'
    
    if (user.first_name && user.last_name) {
      return `${user.first_name} ${user.last_name}`
    }
    
    return user.email?.split('@')[0] || 'Unknown User'
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      />
      
      {/* Dialog */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-2xl w-full mx-auto transform transition-all">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Manage Collaborators</h3>
              <p className="text-sm text-gray-600 mt-1">Share "{noteTitle}" with other users</p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-6 space-y-6">
            {/* Invite New User */}
            <Card>
              <h4 className="text-sm font-semibold text-gray-900 mb-4">Invite New Collaborator</h4>
              
              <div className="space-y-4">
                {/* Search for users */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search by email or name..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>
                {searchQuery.length >= 2 && (
                  <div className="border border-gray-200 rounded-lg max-h-48 overflow-y-auto">
                    {searchResults && searchResults.length > 0 ? (
                      searchResults.map((searchUser) => (
                        <div
                          key={searchUser.id}
                          className="flex items-center justify-between p-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                        >
                          <div>
                            <p className="text-sm font-medium text-gray-900">
                              {searchUser.first_name && searchUser.last_name 
                                ? `${searchUser.first_name} ${searchUser.last_name}`
                                : searchUser.email?.split('@')[0]
                              }
                            </p>
                            <p className="text-xs text-gray-500">{searchUser.email}</p>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Select
                              value={invitePermission}
                              onChange={(e) => setInvitePermission(e.target.value as 'read' | 'write')}
                              options={[
                                { value: 'read', label: 'Read Only' },
                                { value: 'write', label: 'Read & Write' }
                              ]}
                              className="text-xs"
                            />
                            <Button
                              size="sm"
                              onClick={() => handleInviteUser(searchUser.id)}
                              disabled={inviteUserMutation.isPending}
                            >
                              <Plus className="h-3 w-3 mr-1" />
                              Invite
                            </Button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="flex items-center justify-center py-8 text-center text-gray-500 text-sm">
                        No users found matching "{searchQuery}"
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Card>

            {/* Current Collaborators */}
            <Card>
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-semibold text-gray-900">Current Collaborators</h4>
                {collaborations && (
                  <Badge variant="default" size="sm">
                    {collaborations.length} collaborator{collaborations.length !== 1 ? 's' : ''}
                  </Badge>
                )}
              </div>

              {isLoading ? (
                <div className="space-y-3">
                  {[...Array(2)].map((_, i) => (
                    <div key={i} className="animate-pulse flex items-center space-x-3">
                      <div className="w-8 h-8 bg-gray-200 rounded-full"></div>
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-gray-200 rounded w-1/3"></div>
                        <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : collaborations && collaborations.length > 0 ? (
                <div className="space-y-3">
                  {collaborations.map((collaboration) => (
                    <div
                      key={collaboration.id}
                      className="flex items-center justify-between p-3 border border-gray-200 rounded-lg"
                    >
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
                          <Users className="h-4 w-4 text-primary-600" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {getUserDisplayName(collaboration)}
                          </p>
                          <p className="text-xs text-gray-500">{collaboration.user?.email}</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-2">
                        <Select
                          value={collaboration.permission}
                          onChange={(e) => handleUpdatePermission(collaboration.id, e.target.value as any)}
                          options={[
                            { value: 'read', label: 'Read Only' },
                            { value: 'write', label: 'Read & Write' },
                            { value: 'admin', label: 'Admin' }
                          ]}
                          className="text-xs"
                          disabled={updatePermissionMutation.isPending}
                        />
                        
                        <Badge variant={getPermissionColor(collaboration.permission)} size="sm">
                          {collaboration.permission}
                        </Badge>
                        
                        <button
                          onClick={() => handleRemoveCollaboration(collaboration.id, collaboration.user?.email || 'Unknown')}
                          className="p-1 text-gray-400 hover:text-error-600 transition-colors"
                          disabled={removeCollaborationMutation.isPending}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <Users className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm">No collaborators yet</p>
                  <p className="text-xs">Search for users above to start collaborating</p>
                </div>
              )}
            </Card>
          </div>

          {/* Footer */}
          <div className="flex justify-end space-x-3 p-6 border-t border-gray-200">
            <Button variant="outline" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation */}
      {deleteConfirm.isOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setDeleteConfirm({ isOpen: false, collaborationId: null, userEmail: '' })} />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Remove Collaborator</h3>
              <p className="text-gray-600 mb-4">
                Are you sure you want to remove {deleteConfirm.userEmail} from this note? They will no longer be able to access it.
              </p>
              <div className="flex space-x-3">
                <Button
                  variant="outline"
                  onClick={() => setDeleteConfirm({ isOpen: false, collaborationId: null, userEmail: '' })}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onClick={confirmRemoveCollaboration}
                  className="flex-1"
                  loading={removeCollaborationMutation.isPending}
                >
                  Remove
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}