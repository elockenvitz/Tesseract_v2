import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Users, UserPlus, Shield, Eye, MessageSquare, Edit2, Crown, Trash2, Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import type { SimulationPermission, SimulationCollaboratorWithUser } from '../../types/trading'
import { clsx } from 'clsx'

interface SimulationCollaboratorsModalProps {
  isOpen: boolean
  onClose: () => void
  simulationId: string
  simulationName: string
  isOwner: boolean
  currentUserPermission?: SimulationPermission
}

const PERMISSION_CONFIG: Record<SimulationPermission, {
  label: string
  description: string
  icon: React.ElementType
  color: string
}> = {
  view: {
    label: 'View',
    description: 'Can see the trade lab and results',
    icon: Eye,
    color: 'text-gray-500'
  },
  comment: {
    label: 'Comment',
    description: 'Can view and add comments',
    icon: MessageSquare,
    color: 'text-blue-500'
  },
  edit: {
    label: 'Edit',
    description: 'Can modify trades and run analysis',
    icon: Edit2,
    color: 'text-green-500'
  },
  admin: {
    label: 'Admin',
    description: 'Full access including managing collaborators',
    icon: Shield,
    color: 'text-purple-500'
  },
}

export function SimulationCollaboratorsModal({
  isOpen,
  onClose,
  simulationId,
  simulationName,
  isOwner,
  currentUserPermission
}: SimulationCollaboratorsModalProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const [searchEmail, setSearchEmail] = useState('')
  const [selectedPermission, setSelectedPermission] = useState<SimulationPermission>('view')
  const [showAddForm, setShowAddForm] = useState(false)

  // Fetch current collaborators
  const { data: collaborators, isLoading } = useQuery({
    queryKey: ['simulation-collaborators', simulationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('simulation_collaborators')
        .select(`
          *,
          users:user_id (id, email, first_name, last_name)
        `)
        .eq('simulation_id', simulationId)
        .order('created_at', { ascending: true })

      if (error) throw error
      return data as SimulationCollaboratorWithUser[]
    },
    enabled: isOpen,
  })

  // Search for users
  const { data: searchResults } = useQuery({
    queryKey: ['users-search', searchEmail],
    queryFn: async () => {
      if (!searchEmail || searchEmail.length < 2) return []

      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .or(`email.ilike.%${searchEmail}%,first_name.ilike.%${searchEmail}%,last_name.ilike.%${searchEmail}%`)
        .limit(5)

      if (error) throw error

      // Filter out existing collaborators and current user
      const existingUserIds = new Set(collaborators?.map(c => c.user_id) || [])
      existingUserIds.add(user?.id || '')

      return data.filter(u => !existingUserIds.has(u.id))
    },
    enabled: isOpen && searchEmail.length >= 2,
  })

  // Add collaborator mutation
  const addCollaboratorMutation = useMutation({
    mutationFn: async ({ userId, permission }: { userId: string; permission: SimulationPermission }) => {
      const { error } = await supabase
        .from('simulation_collaborators')
        .insert({
          simulation_id: simulationId,
          user_id: userId,
          permission,
          invited_by: user?.id,
        })

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['simulation-collaborators', simulationId] })
      queryClient.invalidateQueries({ queryKey: ['simulation', simulationId] })
      setSearchEmail('')
      setShowAddForm(false)
    },
  })

  // Update permission mutation
  const updatePermissionMutation = useMutation({
    mutationFn: async ({ collaboratorId, permission }: { collaboratorId: string; permission: SimulationPermission }) => {
      const { error } = await supabase
        .from('simulation_collaborators')
        .update({ permission })
        .eq('id', collaboratorId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['simulation-collaborators', simulationId] })
    },
  })

  // Remove collaborator mutation
  const removeCollaboratorMutation = useMutation({
    mutationFn: async (collaboratorId: string) => {
      const { error } = await supabase
        .from('simulation_collaborators')
        .delete()
        .eq('id', collaboratorId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['simulation-collaborators', simulationId] })
      queryClient.invalidateQueries({ queryKey: ['simulation', simulationId] })
    },
  })

  const canManageCollaborators = isOwner || currentUserPermission === 'admin'

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Users className="h-5 w-5" />
              Collaborators
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {simulationName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Add Collaborator Section */}
          {canManageCollaborators && (
            <div className="mb-4">
              {showAddForm ? (
                <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg space-y-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      placeholder="Search by email or name..."
                      value={searchEmail}
                      onChange={(e) => setSearchEmail(e.target.value)}
                      className="pl-10"
                      autoFocus
                    />
                  </div>

                  {/* Search Results */}
                  {searchResults && searchResults.length > 0 && (
                    <div className="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
                      {searchResults.map(foundUser => (
                        <div
                          key={foundUser.id}
                          className="flex items-center justify-between p-2 hover:bg-gray-100 dark:hover:bg-gray-600"
                        >
                          <div>
                            <div className="font-medium text-gray-900 dark:text-white text-sm">
                              {foundUser.first_name} {foundUser.last_name}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              {foundUser.email}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <select
                              value={selectedPermission}
                              onChange={(e) => setSelectedPermission(e.target.value as SimulationPermission)}
                              className="text-xs px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                            >
                              <option value="view">View</option>
                              <option value="comment">Comment</option>
                              <option value="edit">Edit</option>
                              <option value="admin">Admin</option>
                            </select>
                            <Button
                              size="sm"
                              onClick={() => addCollaboratorMutation.mutate({
                                userId: foundUser.id,
                                permission: selectedPermission
                              })}
                              disabled={addCollaboratorMutation.isPending}
                            >
                              Add
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {searchEmail.length >= 2 && searchResults?.length === 0 && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-2">
                      No users found
                    </p>
                  )}

                  <button
                    onClick={() => {
                      setShowAddForm(false)
                      setSearchEmail('')
                    }}
                    className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => setShowAddForm(true)}
                  className="w-full"
                >
                  <UserPlus className="h-4 w-4 mr-2" />
                  Add Collaborator
                </Button>
              )}
            </div>
          )}

          {/* Permission Legend */}
          <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <h4 className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Permission Levels</h4>
            <div className="grid grid-cols-2 gap-2">
              {(Object.entries(PERMISSION_CONFIG) as [SimulationPermission, typeof PERMISSION_CONFIG[SimulationPermission]][]).map(([key, config]) => {
                const Icon = config.icon
                return (
                  <div key={key} className="flex items-center gap-2 text-xs">
                    <Icon className={clsx("h-3.5 w-3.5", config.color)} />
                    <span className="text-gray-600 dark:text-gray-400">{config.label}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Collaborators List */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
              People with access ({(collaborators?.length || 0) + 1})
            </h4>

            {/* Owner (always shown) */}
            <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center">
                  <Crown className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <div className="font-medium text-gray-900 dark:text-white text-sm">
                    {isOwner ? 'You' : 'Owner'}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Owner
                  </div>
                </div>
              </div>
              <span className="text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-2 py-1 rounded">
                Owner
              </span>
            </div>

            {/* Collaborators */}
            {isLoading ? (
              <div className="text-center py-4 text-gray-500">Loading...</div>
            ) : collaborators?.length === 0 ? (
              <div className="text-center py-4 text-gray-500 dark:text-gray-400 text-sm">
                No collaborators yet
              </div>
            ) : (
              collaborators?.map(collab => {
                const config = PERMISSION_CONFIG[collab.permission]
                const Icon = config.icon
                const isCurrentUser = collab.user_id === user?.id

                return (
                  <div
                    key={collab.id}
                    className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg group"
                  >
                    <div className="flex items-center gap-3">
                      <div className={clsx(
                        "w-8 h-8 rounded-full flex items-center justify-center",
                        collab.permission === 'admin' ? "bg-purple-100 dark:bg-purple-900/30" :
                        collab.permission === 'edit' ? "bg-green-100 dark:bg-green-900/30" :
                        collab.permission === 'comment' ? "bg-blue-100 dark:bg-blue-900/30" :
                        "bg-gray-100 dark:bg-gray-600"
                      )}>
                        <Icon className={clsx("h-4 w-4", config.color)} />
                      </div>
                      <div>
                        <div className="font-medium text-gray-900 dark:text-white text-sm">
                          {collab.users.first_name} {collab.users.last_name}
                          {isCurrentUser && <span className="text-gray-500 ml-1">(you)</span>}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {collab.users.email}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {canManageCollaborators && !isCurrentUser ? (
                        <>
                          <select
                            value={collab.permission}
                            onChange={(e) => updatePermissionMutation.mutate({
                              collaboratorId: collab.id,
                              permission: e.target.value as SimulationPermission
                            })}
                            className="text-xs px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          >
                            <option value="view">View</option>
                            <option value="comment">Comment</option>
                            <option value="edit">Edit</option>
                            <option value="admin">Admin</option>
                          </select>
                          <button
                            onClick={() => removeCollaboratorMutation.mutate(collab.id)}
                            className="p-1 opacity-0 group-hover:opacity-100 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-opacity"
                            title="Remove"
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </button>
                        </>
                      ) : (
                        <span className={clsx(
                          "text-xs px-2 py-1 rounded",
                          collab.permission === 'admin' ? "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300" :
                          collab.permission === 'edit' ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300" :
                          collab.permission === 'comment' ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300" :
                          "bg-gray-100 dark:bg-gray-600 text-gray-700 dark:text-gray-300"
                        )}>
                          {config.label}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700">
          <Button variant="secondary" onClick={onClose} className="w-full">
            Done
          </Button>
        </div>
      </div>
    </div>
  )
}
