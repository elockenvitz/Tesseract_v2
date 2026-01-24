import React, { useState, useMemo, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Plus, Trash2, Search, Eye, Edit3, Crown, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { useAuth } from '../../hooks/useAuth'
import { clsx } from 'clsx'

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

interface PendingUser {
  id: string
  email: string
  first_name?: string
  last_name?: string
  permission: 'read' | 'write'
}

// Debounce hook
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debouncedValue
}

export function ShareListDialog({ isOpen, onClose, list }: ShareListDialogProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [invitePermission, setInvitePermission] = useState<'read' | 'write'>('read')
  const [pendingAdditions, setPendingAdditions] = useState<PendingUser[]>([])
  const [pendingRemovals, setPendingRemovals] = useState<Set<string>>(new Set())
  const [pendingPermissionChanges, setPendingPermissionChanges] = useState<Map<string, 'read' | 'write'>>(new Map())
  const [isSaving, setIsSaving] = useState(false)

  const queryClient = useQueryClient()
  const { user } = useAuth()

  // Debounce search query
  const debouncedSearchQuery = useDebounce(searchQuery, 300)

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (isOpen) {
      setPendingAdditions([])
      setPendingRemovals(new Set())
      setPendingPermissionChanges(new Map())
      setSearchQuery('')
    }
  }, [isOpen])

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
  const { data: collaborators, refetch: refetchCollaborators } = useQuery({
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

  // Search for users to invite (using debounced query)
  const { data: searchResults, isFetching: isSearching } = useQuery({
    queryKey: ['user-search', debouncedSearchQuery],
    queryFn: async () => {
      if (!debouncedSearchQuery.trim() || debouncedSearchQuery.length < 2) return []

      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .or(`email.ilike.%${debouncedSearchQuery.toLowerCase()}%,first_name.ilike.%${debouncedSearchQuery.toLowerCase()}%,last_name.ilike.%${debouncedSearchQuery.toLowerCase()}%`)
        .neq('id', user?.id)
        .limit(10)

      if (error) throw error

      // Filter out existing collaborators, owner, and pending additions
      const existingUserIds = new Set(collaborators?.map(c => c.user_id) || [])
      existingUserIds.add(list.created_by)
      pendingAdditions.forEach(p => existingUserIds.add(p.id))

      return data?.filter(u => !existingUserIds.has(u.id)) || []
    },
    enabled: isOpen && debouncedSearchQuery.length >= 2
  })

  const getUserDisplayName = (userData: any) => {
    if (!userData) return 'Unknown User'

    if (userData.first_name && userData.last_name) {
      return `${userData.first_name} ${userData.last_name}`
    }

    return userData.email?.split('@')[0] || 'Unknown User'
  }

  const getUserInitials = (userData: any) => {
    if (!userData) return '?'

    if (userData.first_name && userData.last_name) {
      return `${userData.first_name.charAt(0)}${userData.last_name.charAt(0)}`.toUpperCase()
    }

    return userData.email?.charAt(0).toUpperCase() || '?'
  }

  // Add user to pending additions
  const handleAddUser = (userToAdd: any) => {
    setPendingAdditions(prev => [...prev, {
      id: userToAdd.id,
      email: userToAdd.email,
      first_name: userToAdd.first_name,
      last_name: userToAdd.last_name,
      permission: invitePermission
    }])
    setSearchQuery('')
  }

  // Remove from pending additions
  const handleRemovePendingAddition = (userId: string) => {
    setPendingAdditions(prev => prev.filter(p => p.id !== userId))
  }

  // Mark existing collaborator for removal
  const handleRemoveCollaborator = (collaborationId: string) => {
    setPendingRemovals(prev => new Set([...prev, collaborationId]))
  }

  // Undo removal
  const handleUndoRemoval = (collaborationId: string) => {
    setPendingRemovals(prev => {
      const next = new Set(prev)
      next.delete(collaborationId)
      return next
    })
  }

  // Update permission (pending)
  const handleUpdatePermission = (collaborationId: string, permission: 'read' | 'write') => {
    setPendingPermissionChanges(prev => new Map(prev).set(collaborationId, permission))
  }

  // Update pending addition permission
  const handleUpdatePendingPermission = (userId: string, permission: 'read' | 'write') => {
    setPendingAdditions(prev => prev.map(p =>
      p.id === userId ? { ...p, permission } : p
    ))
  }

  // Get effective permission for a collaborator
  const getEffectivePermission = (collaboration: Collaborator): 'read' | 'write' => {
    return pendingPermissionChanges.get(collaboration.id) || collaboration.permission
  }

  // Check if there are any pending changes
  const hasChanges = pendingAdditions.length > 0 ||
    pendingRemovals.size > 0 ||
    pendingPermissionChanges.size > 0

  // Save all changes
  const handleSave = async () => {
    setIsSaving(true)
    try {
      // Process additions
      if (pendingAdditions.length > 0) {
        const { error: addError } = await supabase
          .from('asset_list_collaborations')
          .insert(pendingAdditions.map(p => ({
            list_id: list.id,
            user_id: p.id,
            permission: p.permission,
            invited_by: user?.id
          })))

        if (addError) throw addError
      }

      // Process removals
      if (pendingRemovals.size > 0) {
        const { error: removeError } = await supabase
          .from('asset_list_collaborations')
          .delete()
          .in('id', Array.from(pendingRemovals))

        if (removeError) throw removeError
      }

      // Process permission changes
      for (const [collaborationId, permission] of pendingPermissionChanges) {
        if (!pendingRemovals.has(collaborationId)) {
          const { error: updateError } = await supabase
            .from('asset_list_collaborations')
            .update({ permission })
            .eq('id', collaborationId)

          if (updateError) throw updateError
        }
      }

      // Invalidate queries and close
      await refetchCollaborators()
      queryClient.invalidateQueries({ queryKey: ['asset-list-collaborators', list.id] })
      queryClient.invalidateQueries({ queryKey: ['asset-lists'] })
      onClose()
    } catch (error) {
      console.error('Failed to save changes:', error)
    } finally {
      setIsSaving(false)
    }
  }

  // Handle cancel
  const handleCancel = () => {
    setPendingAdditions([])
    setPendingRemovals(new Set())
    setPendingPermissionChanges(new Map())
    onClose()
  }

  if (!isOpen) return null

  const filteredCollaborators = collaborators?.filter(c => c.user_id !== list.created_by) || []

  // Permission toggle component
  const PermissionToggle = ({
    permission,
    onChange,
    disabled = false,
    size = 'normal'
  }: {
    permission: 'read' | 'write'
    onChange: (p: 'read' | 'write') => void
    disabled?: boolean
    size?: 'small' | 'normal'
  }) => (
    <div className={clsx(
      "inline-flex rounded-lg border border-gray-200 bg-gray-50",
      size === 'small' ? 'p-0.5' : 'p-0.5'
    )}>
      <button
        type="button"
        onClick={() => onChange('read')}
        disabled={disabled}
        className={clsx(
          'flex items-center gap-1 rounded-md font-medium transition-all',
          size === 'small' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
          permission === 'read'
            ? 'bg-white text-gray-900 shadow-sm'
            : 'text-gray-500 hover:text-gray-700',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        <Eye className={size === 'small' ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
        View
      </button>
      <button
        type="button"
        onClick={() => onChange('write')}
        disabled={disabled}
        className={clsx(
          'flex items-center gap-1 rounded-md font-medium transition-all',
          size === 'small' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
          permission === 'write'
            ? 'bg-white text-gray-900 shadow-sm'
            : 'text-gray-500 hover:text-gray-700',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        <Edit3 className={size === 'small' ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
        Edit
      </button>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={handleCancel}
      />

      {/* Dialog */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg mx-auto transform transition-all">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Share List</h3>
              <p className="text-sm text-gray-500 mt-0.5">{list.name}</p>
            </div>
            <button
              onClick={handleCancel}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Content - Fixed height */}
          <div className="p-5 h-[420px] flex flex-col">
            {/* Search Section */}
            <div className="flex-shrink-0">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Add people
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search by name..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  {isSearching && (
                    <Loader2 className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 animate-spin" />
                  )}
                </div>
                <PermissionToggle
                  permission={invitePermission}
                  onChange={setInvitePermission}
                />
              </div>

              {/* Search Results - Fixed height */}
              <div className="mt-2 h-28 border border-gray-200 rounded-lg overflow-hidden bg-gray-50/50">
                {(() => {
                  // Determine what to show based on debounced state
                  const isTyping = searchQuery !== debouncedSearchQuery && searchQuery.length >= 2
                  const hasQuery = debouncedSearchQuery.length >= 2

                  if (!hasQuery && !isTyping) {
                    return (
                      <div className="h-full flex items-center justify-center text-sm text-gray-400">
                        Type to search for users
                      </div>
                    )
                  }

                  if (isTyping || isSearching) {
                    return (
                      <div className="h-full flex items-center justify-center">
                        <Loader2 className="h-5 w-5 text-gray-400 animate-spin" />
                      </div>
                    )
                  }

                  if (searchResults && searchResults.length > 0) {
                    return (
                      <div className="h-full overflow-y-auto">
                        {searchResults.map((searchUser) => (
                          <div
                            key={searchUser.id}
                            className="flex items-center justify-between px-3 py-2 hover:bg-white border-b border-gray-100 last:border-b-0"
                          >
                            <div className="flex items-center gap-2.5">
                              <div className="w-7 h-7 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center">
                                <span className="text-white text-[10px] font-medium">
                                  {getUserInitials(searchUser)}
                                </span>
                              </div>
                              <span className="text-sm font-medium text-gray-900">
                                {getUserDisplayName(searchUser)}
                              </span>
                            </div>
                            <button
                              onClick={() => handleAddUser(searchUser)}
                              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              Add
                            </button>
                          </div>
                        ))}
                      </div>
                    )
                  }

                  return (
                    <div className="h-full flex items-center justify-center text-sm text-gray-500">
                      No users found
                    </div>
                  )
                })()}
              </div>
            </div>

            {/* People with access - Scrollable */}
            <div className="flex-1 mt-5 min-h-0 flex flex-col">
              <div className="flex items-center justify-between mb-2 flex-shrink-0">
                <h4 className="text-sm font-medium text-gray-700">People with access</h4>
                <span className="text-xs text-gray-400">
                  {filteredCollaborators.filter(c => !pendingRemovals.has(c.id)).length + pendingAdditions.length + 1} people
                </span>
              </div>

              <div className="flex-1 overflow-y-auto space-y-0.5 pr-1">
                {/* Owner */}
                <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 bg-gradient-to-br from-amber-500 to-orange-500 rounded-full flex items-center justify-center">
                      <span className="text-white text-[10px] font-medium">
                        {getUserInitials(ownerDetails)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-gray-900">
                        {getUserDisplayName(ownerDetails)}
                      </span>
                      {ownerDetails?.id === user?.id && (
                        <span className="text-[10px] text-gray-400">(you)</span>
                      )}
                    </div>
                  </div>
                  <Badge variant="warning" size="sm" className="gap-1 text-[10px]">
                    <Crown className="h-2.5 w-2.5" />
                    Owner
                  </Badge>
                </div>

                {/* Pending additions */}
                {pendingAdditions.map((pending) => (
                  <div
                    key={pending.id}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-green-50 border border-green-200"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 bg-gradient-to-br from-green-500 to-green-600 rounded-full flex items-center justify-center">
                        <span className="text-white text-[10px] font-medium">
                          {getUserInitials(pending)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-gray-900">
                          {getUserDisplayName(pending)}
                        </span>
                        <span className="text-[10px] text-green-600 font-medium">New</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleRemovePendingAddition(pending.id)}
                        className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                      <PermissionToggle
                        permission={pending.permission}
                        onChange={(p) => handleUpdatePendingPermission(pending.id, p)}
                        size="small"
                      />
                    </div>
                  </div>
                ))}

                {/* Existing collaborators */}
                {filteredCollaborators
                  .filter((collaboration) => !pendingRemovals.has(collaboration.id))
                  .map((collaboration) => (
                    <div
                      key={collaboration.id}
                      className="flex items-center justify-between px-3 py-2 rounded-lg transition-all hover:bg-gray-50 group"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center bg-gradient-to-br from-gray-400 to-gray-500">
                          <span className="text-white text-[10px] font-medium">
                            {getUserInitials(collaboration.user)}
                          </span>
                        </div>
                        <span className="text-sm font-medium text-gray-900">
                          {getUserDisplayName(collaboration.user)}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleRemoveCollaborator(collaboration.id)}
                          className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                        <PermissionToggle
                          permission={getEffectivePermission(collaboration)}
                          onChange={(p) => handleUpdatePermission(collaboration.id, p)}
                          size="small"
                        />
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-5 py-4 border-t border-gray-100 bg-gray-50 rounded-b-xl">
            <div className="text-xs text-gray-500">
              {hasChanges && (
                <span className="text-amber-600 font-medium">Unsaved changes</span>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={handleCancel}>
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={!hasChanges}
                loading={isSaving}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
