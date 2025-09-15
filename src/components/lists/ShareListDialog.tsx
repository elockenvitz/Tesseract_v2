import React, { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Plus, Users, Trash2, Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { Card } from '../ui/Card'
import { Select } from '../ui/Select'
import { useAuth } from '../../hooks/useAuth'

interface ShareListDialogProps {
  isOpen: boolean
  onClose: () => void
  list: any
}

interface Collaborator {
  id: string
  list_id: string
  user_id: string
  permission: 'read' | 'write'
  invited_by: string
  created_at: string
  user?: {
    id: string
    email: string
    first_name?: string
    last_name?: string
  }
}

export function ShareListDialog({ isOpen, onClose, list }: ShareListDialogProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [invitePermission, setInvitePermission] = useState<'read' | 'write'>('read')
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

  // Fetch owner details
  const { data: ownerDetails } = useQuery({
    queryKey: ['list-owner', list.created_by],
    queryFn: async () => {
      if (!list.created_by) return null

      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .eq('id', list.created_by)
        .single()

      if (error) throw error
      return data
    },
    enabled: isOpen && !!list.created_by
  })

  // Fetch collaborators with user details
  const { data: collaborators, isLoading, refetch: refetchCollaborators } = useQuery({
    queryKey: ['list-collaborators-detailed', list.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_list_collaborations')
        .select(`
          *,
          user:users!asset_list_collaborations_user_id_fkey(id, email, first_name, last_name)
        `)
        .eq('list_id', list.id)
        .order('created_at', { ascending: false })

      if (error) throw error
      return (data || []) as Collaborator[]
    },
    enabled: isOpen
  })

  // Search for users to invite
  const { data: searchResults } = useQuery({
    queryKey: ['user-search', searchQuery],
    queryFn: async () => {
      if (!searchQuery.trim() || searchQuery.length < 2) return []

      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .or(`email.ilike.%${searchQuery.toLowerCase()}%,first_name.ilike.%${searchQuery.toLowerCase()}%,last_name.ilike.%${searchQuery.toLowerCase()}%`)
        .neq('id', user?.id) // Exclude current user
        .limit(10)

      if (error) throw error

      // Filter out users who are already collaborators or the owner
      const existingUserIds = new Set(collaborators?.map(c => c.user_id) || [])
      existingUserIds.add(list.created_by) // Exclude the owner

      const filteredResults = data?.filter(u => !existingUserIds.has(u.id)) || []

      return filteredResults
    },
    enabled: isOpen && searchQuery.length >= 2
  })

  // Invite user mutation
  const inviteUserMutation = useMutation({
    mutationFn: async ({ userId, permission }: { userId: string; permission: 'read' | 'write' }) => {
      const { error } = await supabase
        .from('asset_list_collaborations')
        .insert({
          list_id: list.id,
          user_id: userId,
          permission,
          invited_by: user?.id
        })

      if (error) throw error
    },
    onSuccess: () => {
      refetchCollaborators()
      queryClient.invalidateQueries({ queryKey: ['asset-list-collaborators', list.id] })
      setSearchQuery('')
    }
  })

  // Update permission mutation
  const updatePermissionMutation = useMutation({
    mutationFn: async ({ collaborationId, newPermission }: { collaborationId: string, newPermission: 'read' | 'write' }) => {
      const { error } = await supabase
        .from('asset_list_collaborations')
        .update({ permission: newPermission })
        .eq('id', collaborationId)

      if (error) throw error
    },
    onSuccess: () => {
      refetchCollaborators()
      queryClient.invalidateQueries({ queryKey: ['asset-list-collaborators', list.id] })
    }
  })

  // Remove collaborator mutation
  const removeCollaboratorMutation = useMutation({
    mutationFn: async (collaborationId: string) => {
      const { error } = await supabase
        .from('asset_list_collaborations')
        .delete()
        .eq('id', collaborationId)

      if (error) throw error
    },
    onSuccess: () => {
      refetchCollaborators()
      queryClient.invalidateQueries({ queryKey: ['asset-list-collaborators', list.id] })
      setDeleteConfirm({ isOpen: false, collaborationId: null, userEmail: '' })
    }
  })

  const handleInviteUser = (userId: string) => {
    inviteUserMutation.mutate({ userId, permission: invitePermission })
  }

  const handleUpdatePermission = (collaborationId: string, permission: 'read' | 'write') => {
    updatePermissionMutation.mutate({ collaborationId, newPermission: permission })
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
    }
  }

  const getPermissionColor = (permission: string) => {
    switch (permission) {
      case 'write': return 'warning'
      case 'read': return 'success'
      default: return 'default'
    }
  }

  const getUserDisplayName = (user: any) => {
    if (!user) return 'Unknown User'

    if (user.first_name && user.last_name) {
      return `${user.first_name} ${user.last_name}`
    }

    return user.email?.split('@')[0] || 'Unknown User'
  }

  if (!isOpen) return null

  // Filter out the owner from the collaborators list
  const filteredCollaborators = collaborators?.filter(c => c.user_id !== list.created_by) || []

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
              <p className="text-sm text-gray-600 mt-1">Share "{list.name}" with other users</p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-6 space-y-6">
            {/* List Owner */}
            <Card>
              <h4 className="text-sm font-semibold text-gray-900 mb-4">List Owner</h4>
              <div className="flex items-center space-x-3 p-3 border border-gray-200 rounded-lg bg-gray-50">
                <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
                  <Users className="h-4 w-4 text-primary-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {getUserDisplayName(ownerDetails)}
                  </p>
                  <p className="text-xs text-gray-500">
                    {ownerDetails?.email}
                  </p>
                </div>
                <Badge variant="primary" size="sm" className="ml-auto">Owner</Badge>
              </div>
            </Card>

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
                                : getUserDisplayName(searchUser)
                              }
                            </p>
                            <p className="text-xs text-gray-500">{searchUser.email}</p>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Select
                              value={invitePermission}
                              onChange={(e) => setInvitePermission(e.target.value as 'read' | 'write')}
                              options={[
                                { value: 'read', label: 'Can view' },
                                { value: 'write', label: 'Can edit' }
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
                {filteredCollaborators && (
                  <Badge variant="default" size="sm">
                    {filteredCollaborators.length} collaborator{filteredCollaborators.length !== 1 ? 's' : ''}
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
              ) : filteredCollaborators.length > 0 ? (
                <div className="space-y-3">
                  {filteredCollaborators.map((collaboration) => (
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
                            {getUserDisplayName(collaboration.user)}
                          </p>
                          <p className="text-xs text-gray-500">{collaboration.user?.email}</p>
                        </div>
                      </div>

                      <div className="flex items-center space-x-2">
                        <Select
                          value={collaboration.permission}
                          onChange={(e) => handleUpdatePermission(collaboration.id, e.target.value as 'read' | 'write')}
                          options={[
                            { value: 'read', label: 'Can view' },
                            { value: 'write', label: 'Can edit' }
                          ]}
                          className="text-xs"
                          disabled={updatePermissionMutation.isPending}
                        />

                        <Badge variant={getPermissionColor(collaboration.permission)} size="sm">
                          {collaboration.permission === 'read' ? 'View' : 'Edit'}
                        </Badge>

                        <button
                          onClick={() => handleRemoveCollaboration(collaboration.id, collaboration.user?.email || 'Unknown')}
                          className="p-1 text-gray-400 hover:text-error-600 transition-colors"
                          disabled={removeCollaboratorMutation.isPending}
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
                Are you sure you want to remove {deleteConfirm.userEmail} from this list? They will no longer be able to access it.
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
                  loading={removeCollaboratorMutation.isPending}
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