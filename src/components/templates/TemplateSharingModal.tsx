import { useState, useEffect } from 'react'
import { X, Search, Users, Building2, User, Loader2, Check, Trash2, ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'
import {
  useTemplateCollaborations,
  useSearchUsers,
  useTeams,
  Collaborator
} from '../../hooks/useTemplateCollaborations'
import { Template } from '../../hooks/useTemplates'
import { Button } from '../ui/Button'

interface TemplateSharingModalProps {
  template: Template
  onClose: () => void
}

type PermissionLevel = 'view' | 'edit' | 'admin'

const PERMISSION_LABELS: Record<PermissionLevel, { label: string; description: string }> = {
  view: { label: 'Can view', description: 'Can use this template' },
  edit: { label: 'Can edit', description: 'Can modify the template' },
  admin: { label: 'Admin', description: 'Can edit and manage sharing' }
}

export function TemplateSharingModal({ template, onClose }: TemplateSharingModalProps) {
  const {
    collaborations,
    userCollaborations,
    teamCollaborations,
    isSharedWithOrg,
    orgCollaboration,
    isLoading,
    addCollaborator,
    updateCollaborator,
    removeCollaborator,
    shareWithOrganization,
    removeOrganizationSharing,
    isAdding,
    isUpdating,
    isRemoving
  } = useTemplateCollaborations(template.id)

  const { data: teams = [] } = useTeams()

  const [searchQuery, setSearchQuery] = useState('')
  const [orgPermission, setOrgPermission] = useState<PermissionLevel>(
    orgCollaboration?.permission || 'view'
  )
  const [showUserSearch, setShowUserSearch] = useState(false)
  const [showTeamSelect, setShowTeamSelect] = useState(false)
  const [selectedPermission, setSelectedPermission] = useState<PermissionLevel>('view')

  const { data: searchResults = [], isLoading: isSearching } = useSearchUsers(searchQuery)

  // Filter out already added users
  const availableUsers = searchResults.filter(
    user => !userCollaborations.some(c => c.user_id === user.id)
  )

  // Filter out already added teams
  const availableTeams = teams.filter(
    team => !teamCollaborations.some(c => c.team_id === team.id)
  )

  useEffect(() => {
    if (orgCollaboration?.permission) {
      setOrgPermission(orgCollaboration.permission)
    }
  }, [orgCollaboration])

  const handleAddUser = async (userId: string) => {
    try {
      await addCollaborator({
        template_id: template.id,
        user_id: userId,
        permission: selectedPermission
      })
      setSearchQuery('')
      setShowUserSearch(false)
    } catch (error) {
      console.error('Failed to add user:', error)
    }
  }

  const handleAddTeam = async (teamId: string) => {
    try {
      await addCollaborator({
        template_id: template.id,
        team_id: teamId,
        permission: selectedPermission
      })
      setShowTeamSelect(false)
    } catch (error) {
      console.error('Failed to add team:', error)
    }
  }

  const handleUpdatePermission = async (collaborator: Collaborator, permission: PermissionLevel) => {
    try {
      await updateCollaborator(collaborator.id, { permission })
    } catch (error) {
      console.error('Failed to update permission:', error)
    }
  }

  const handleRemoveCollaborator = async (collaboratorId: string) => {
    try {
      await removeCollaborator(collaboratorId)
    } catch (error) {
      console.error('Failed to remove collaborator:', error)
    }
  }

  const handleToggleOrgSharing = async () => {
    try {
      if (isSharedWithOrg) {
        await removeOrganizationSharing(template.id)
      } else {
        await shareWithOrganization({ template_id: template.id, permission: orgPermission })
      }
    } catch (error) {
      console.error('Failed to toggle org sharing:', error)
    }
  }

  const handleUpdateOrgPermission = async (permission: PermissionLevel) => {
    setOrgPermission(permission)
    if (isSharedWithOrg) {
      try {
        await shareWithOrganization({ template_id: template.id, permission })
      } catch (error) {
        console.error('Failed to update org permission:', error)
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="text-lg font-medium text-gray-900">Share Template</h3>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Organization Sharing */}
          <div className="p-4 border border-gray-200 rounded-lg bg-gray-50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h4 className="font-medium text-gray-900">Organization</h4>
                  <p className="text-sm text-gray-500">Share with everyone</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <PermissionSelect
                  value={orgPermission}
                  onChange={handleUpdateOrgPermission}
                  disabled={!isSharedWithOrg}
                />
                <button
                  onClick={handleToggleOrgSharing}
                  className={clsx(
                    'relative w-12 h-6 rounded-full transition-colors',
                    isSharedWithOrg ? 'bg-primary-600' : 'bg-gray-300'
                  )}
                >
                  <span
                    className={clsx(
                      'absolute top-1 w-4 h-4 bg-white rounded-full transition-transform shadow',
                      isSharedWithOrg ? 'translate-x-7' : 'translate-x-1'
                    )}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* Teams */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-gray-700 flex items-center gap-2">
                <Users className="w-4 h-4" />
                Teams
              </h4>
              <button
                onClick={() => setShowTeamSelect(!showTeamSelect)}
                className="text-sm text-primary-600 hover:text-primary-700"
                disabled={availableTeams.length === 0}
              >
                + Add Team
              </button>
            </div>

            {showTeamSelect && availableTeams.length > 0 && (
              <div className="mb-3 p-3 border border-primary-200 bg-primary-50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <select
                    className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg"
                    onChange={(e) => {
                      if (e.target.value) handleAddTeam(e.target.value)
                    }}
                    defaultValue=""
                  >
                    <option value="" disabled>Select a team...</option>
                    {availableTeams.map(team => (
                      <option key={team.id} value={team.id}>{team.name}</option>
                    ))}
                  </select>
                  <PermissionSelect
                    value={selectedPermission}
                    onChange={setSelectedPermission}
                  />
                </div>
              </div>
            )}

            {teamCollaborations.length === 0 ? (
              <p className="text-sm text-gray-500 py-2">No teams added</p>
            ) : (
              <div className="space-y-2">
                {teamCollaborations.map(collab => (
                  <CollaboratorRow
                    key={collab.id}
                    collaborator={collab}
                    onUpdatePermission={(p) => handleUpdatePermission(collab, p)}
                    onRemove={() => handleRemoveCollaborator(collab.id)}
                    isUpdating={isUpdating}
                    isRemoving={isRemoving}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Users */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-gray-700 flex items-center gap-2">
                <User className="w-4 h-4" />
                People
              </h4>
              <button
                onClick={() => setShowUserSearch(!showUserSearch)}
                className="text-sm text-primary-600 hover:text-primary-700"
              >
                + Add Person
              </button>
            </div>

            {showUserSearch && (
              <div className="mb-3 p-3 border border-primary-200 bg-primary-50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex-1 relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search by name or email..."
                      className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg"
                      autoFocus
                    />
                  </div>
                  <PermissionSelect
                    value={selectedPermission}
                    onChange={setSelectedPermission}
                  />
                </div>

                {isSearching ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                  </div>
                ) : searchQuery.length >= 2 && availableUsers.length === 0 ? (
                  <p className="text-sm text-gray-500 py-2">No users found</p>
                ) : (
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {availableUsers.map(user => (
                      <button
                        key={user.id}
                        onClick={() => handleAddUser(user.id)}
                        disabled={isAdding}
                        className="w-full flex items-center gap-3 p-2 text-left hover:bg-primary-100 rounded-lg transition-colors"
                      >
                        <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium text-gray-600">
                          {user.first_name?.[0] || user.email[0].toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {user.first_name && user.last_name
                              ? `${user.first_name} ${user.last_name}`
                              : user.email}
                          </p>
                          {user.first_name && (
                            <p className="text-xs text-gray-500 truncate">{user.email}</p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {userCollaborations.length === 0 ? (
              <p className="text-sm text-gray-500 py-2">No people added</p>
            ) : (
              <div className="space-y-2">
                {userCollaborations.map(collab => (
                  <CollaboratorRow
                    key={collab.id}
                    collaborator={collab}
                    onUpdatePermission={(p) => handleUpdatePermission(collab, p)}
                    onRemove={() => handleRemoveCollaborator(collab.id)}
                    isUpdating={isUpdating}
                    isRemoving={isRemoving}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <Button onClick={onClose} className="w-full">
            Done
          </Button>
        </div>
      </div>
    </div>
  )
}

interface PermissionSelectProps {
  value: PermissionLevel
  onChange: (value: PermissionLevel) => void
  disabled?: boolean
}

function PermissionSelect({ value, onChange, disabled }: PermissionSelectProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={clsx(
          'flex items-center gap-1 px-2 py-1 text-sm rounded border transition-colors',
          disabled
            ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
            : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
        )}
      >
        {PERMISSION_LABELS[value].label}
        <ChevronDown className="w-3 h-3" />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-10">
            {(Object.entries(PERMISSION_LABELS) as [PermissionLevel, { label: string; description: string }][]).map(
              ([level, { label, description }]) => (
                <button
                  key={level}
                  onClick={() => {
                    onChange(level)
                    setIsOpen(false)
                  }}
                  className={clsx(
                    'w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-50',
                    value === level && 'bg-primary-50'
                  )}
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">{label}</p>
                    <p className="text-xs text-gray-500">{description}</p>
                  </div>
                  {value === level && <Check className="w-4 h-4 text-primary-600" />}
                </button>
              )
            )}
          </div>
        </>
      )}
    </div>
  )
}

interface CollaboratorRowProps {
  collaborator: Collaborator
  onUpdatePermission: (permission: PermissionLevel) => void
  onRemove: () => void
  isUpdating: boolean
  isRemoving: boolean
}

function CollaboratorRow({
  collaborator,
  onUpdatePermission,
  onRemove,
  isUpdating,
  isRemoving
}: CollaboratorRowProps) {
  const name = collaborator.user
    ? collaborator.user.first_name && collaborator.user.last_name
      ? `${collaborator.user.first_name} ${collaborator.user.last_name}`
      : collaborator.user.email
    : collaborator.team?.name || 'Unknown'

  const subtitle = collaborator.user?.first_name ? collaborator.user.email : undefined

  const initials = collaborator.user
    ? collaborator.user.first_name?.[0] || collaborator.user.email[0].toUpperCase()
    : collaborator.team?.name[0] || '?'

  return (
    <div className="flex items-center justify-between p-2 border border-gray-200 rounded-lg">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium text-gray-600">
          {collaborator.team ? (
            <Users className="w-4 h-4 text-gray-500" />
          ) : (
            initials
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
          {subtitle && <p className="text-xs text-gray-500 truncate">{subtitle}</p>}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <PermissionSelect
          value={collaborator.permission}
          onChange={onUpdatePermission}
          disabled={isUpdating}
        />
        <button
          onClick={onRemove}
          disabled={isRemoving}
          className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
        >
          {isRemoving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Trash2 className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  )
}
