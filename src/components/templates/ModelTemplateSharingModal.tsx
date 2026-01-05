import { useState, useEffect } from 'react'
import { X, Search, Users, Building2, User, Loader2, Check, Trash2, ChevronDown, ChevronRight, Layers, Briefcase, PieChart } from 'lucide-react'
import { clsx } from 'clsx'
import { useQuery } from '@tanstack/react-query'
import {
  useModelTemplateCollaborations,
  ModelTemplateCollaborator
} from '../../hooks/useModelTemplateCollaborations'
import { useSearchUsers } from '../../hooks/useTemplateCollaborations'
import { ModelTemplate } from '../../hooks/useModelTemplates'
import { Button } from '../ui/Button'
import { supabase } from '../../lib/supabase'

interface ModelTemplateSharingModalProps {
  template: ModelTemplate
  onClose: () => void
}

type PermissionLevel = 'view' | 'edit' | 'admin'

interface OrgNode {
  id: string
  name: string
  node_type: 'division' | 'department' | 'team' | 'portfolio'
  parent_id: string | null
}

const PERMISSION_LABELS: Record<PermissionLevel, { label: string; description: string }> = {
  view: { label: 'Can view', description: 'Can use this template' },
  edit: { label: 'Can edit', description: 'Can modify the template' },
  admin: { label: 'Admin', description: 'Can edit and manage sharing' }
}

const NODE_TYPE_ICONS: Record<string, React.ReactNode> = {
  division: <Building2 className="w-3.5 h-3.5 text-blue-500" />,
  department: <Layers className="w-3.5 h-3.5 text-purple-500" />,
  team: <Users className="w-3.5 h-3.5 text-green-500" />,
  portfolio: <Briefcase className="w-3.5 h-3.5 text-amber-500" />
}

export function ModelTemplateSharingModal({ template, onClose }: ModelTemplateSharingModalProps) {
  const {
    collaborations,
    userCollaborations,
    teamCollaborations,
    nodeCollaborations,
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
  } = useModelTemplateCollaborations(template.id)

  // Fetch org chart nodes
  const { data: orgNodes = [] } = useQuery({
    queryKey: ['org-chart-nodes-for-sharing'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_chart_nodes')
        .select('id, name, node_type, parent_id')
        .eq('is_active', true)
        .order('node_type')
        .order('name')
      if (error) throw error
      return (data || []) as OrgNode[]
    }
  })

  // Group org nodes by type
  const divisions = orgNodes.filter(n => n.node_type === 'division')
  const departments = orgNodes.filter(n => n.node_type === 'department')
  const teams = orgNodes.filter(n => n.node_type === 'team')
  const portfolios = orgNodes.filter(n => n.node_type === 'portfolio')

  const [searchQuery, setSearchQuery] = useState('')
  const [showUserSearch, setShowUserSearch] = useState(false)
  const [showOrgDropdown, setShowOrgDropdown] = useState(false)
  const [selectedPermission, setSelectedPermission] = useState<PermissionLevel>('view')
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set(['division', 'department', 'team', 'portfolio']))

  const { data: searchResults = [], isLoading: isSearching } = useSearchUsers(searchQuery)

  // Filter out already added users
  const availableUsers = searchResults.filter(
    user => !userCollaborations.some(c => c.user_id === user.id)
  )

  // Get set of already shared node IDs
  const sharedNodeIds = new Set(nodeCollaborations?.map(c => c.org_node_id) || [])

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

  const handleAddOrgNode = async (nodeId: string) => {
    try {
      await addCollaborator({
        template_id: template.id,
        org_node_id: nodeId,
        permission: selectedPermission
      })
    } catch (error) {
      console.error('Failed to add org node:', error)
    }
  }

  const handleToggleOrgSharing = async () => {
    try {
      if (isSharedWithOrg) {
        await removeOrganizationSharing(template.id)
      } else {
        await shareWithOrganization({ template_id: template.id, permission: selectedPermission })
      }
    } catch (error) {
      console.error('Failed to toggle org sharing:', error)
    }
  }

  const handleUpdatePermission = async (collaborator: ModelTemplateCollaborator, permission: PermissionLevel) => {
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

  const toggleTypeExpanded = (type: string) => {
    setExpandedTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) {
        next.delete(type)
      } else {
        next.add(type)
      }
      return next
    })
  }

  const renderNodeGroup = (nodes: OrgNode[], type: string, label: string) => {
    if (nodes.length === 0) return null
    const isExpanded = expandedTypes.has(type)

    return (
      <div key={type}>
        <button
          type="button"
          onClick={() => toggleTypeExpanded(type)}
          className="w-full flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50"
        >
          {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          {label} ({nodes.length})
        </button>
        {isExpanded && nodes.map(node => {
          const isSelected = sharedNodeIds.has(node.id)
          return (
            <button
              key={node.id}
              type="button"
              onClick={() => !isSelected && handleAddOrgNode(node.id)}
              disabled={isSelected || isAdding}
              className={clsx(
                'w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50',
                isSelected && 'bg-primary-50 opacity-60'
              )}
            >
              <div className={clsx(
                'w-4 h-4 border rounded flex items-center justify-center shrink-0',
                isSelected ? 'bg-primary-600 border-primary-600' : 'border-gray-300'
              )}>
                {isSelected && <Check className="w-3 h-3 text-white" />}
              </div>
              {NODE_TYPE_ICONS[node.node_type]}
              <span className="truncate">{node.name}</span>
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 min-h-[500px] max-h-[75vh] flex flex-col">
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
          {/* Groups/Org Nodes Section */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm text-gray-600">
                <span className="font-medium">Share with groups</span>
                <span className="text-gray-400"> — divisions, departments, teams</span>
              </label>
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => setShowOrgDropdown(!showOrgDropdown)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:border-gray-400 bg-white"
              >
                <div className="flex items-center gap-2 text-gray-500">
                  <Building2 className="w-4 h-4" />
                  <span>Select groups to share with...</span>
                </div>
                <ChevronDown className={clsx('w-4 h-4 text-gray-400 transition-transform', showOrgDropdown && 'rotate-180')} />
              </button>

              {showOrgDropdown && (
                <>
                  <div className="fixed inset-0 z-[60]" onClick={() => setShowOrgDropdown(false)} />
                  <div className="absolute left-0 right-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 max-h-64 overflow-y-auto z-[61]">
                    {/* Entire Organization option */}
                    <button
                      type="button"
                      onClick={() => {
                        handleToggleOrgSharing()
                      }}
                      className={clsx(
                        'w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 border-b border-gray-100',
                        isSharedWithOrg && 'bg-primary-50'
                      )}
                    >
                      <div className={clsx(
                        'w-4 h-4 border rounded flex items-center justify-center shrink-0',
                        isSharedWithOrg ? 'bg-primary-600 border-primary-600' : 'border-gray-300'
                      )}>
                        {isSharedWithOrg && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <Building2 className="w-3.5 h-3.5 text-blue-600" />
                      <span className="font-medium">Entire Organization</span>
                    </button>

                    {/* Org nodes by type */}
                    {renderNodeGroup(divisions, 'division', 'Divisions')}
                    {renderNodeGroup(departments, 'department', 'Departments')}
                    {renderNodeGroup(teams, 'team', 'Teams')}
                    {renderNodeGroup(portfolios, 'portfolio', 'Portfolios')}

                    {orgNodes.length === 0 && !isSharedWithOrg && (
                      <div className="px-3 py-4 text-sm text-gray-500 text-center">
                        No groups available
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Show selected groups */}
            {(isSharedWithOrg || (nodeCollaborations && nodeCollaborations.length > 0)) && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {isSharedWithOrg && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full border bg-blue-100 text-blue-700 border-blue-200">
                    <Building2 className="w-3 h-3" />
                    Entire Org
                    <button
                      type="button"
                      onClick={() => removeOrganizationSharing(template.id)}
                      className="hover:bg-black/10 rounded-full ml-1"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )}
                {nodeCollaborations?.map(collab => (
                  <span
                    key={collab.id}
                    className="inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-full border bg-gray-100 text-gray-700 border-gray-200"
                  >
                    {collab.org_node && NODE_TYPE_ICONS[collab.org_node.node_type]}
                    <span>{collab.org_node?.name || 'Unknown'}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveCollaborator(collab.id)}
                      className="hover:bg-black/10 rounded-full"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Users */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm text-gray-600">
                <span className="font-medium">Share with people</span>
                <span className="text-gray-400"> — search by name or email</span>
              </label>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setShowUserSearch(true)
                }}
                onFocus={() => setShowUserSearch(true)}
                placeholder="Search by name or email..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg"
              />

              {showUserSearch && searchQuery.length >= 2 && (
                <>
                  <div className="fixed inset-0 z-[60]" onClick={() => setShowUserSearch(false)} />
                  <div className="absolute left-0 right-0 bottom-full mb-1 bg-white rounded-lg shadow-lg border border-gray-200 max-h-48 overflow-y-auto z-[61]">
                    {isSearching ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                      </div>
                    ) : availableUsers.length === 0 ? (
                      <p className="text-sm text-gray-500 py-3 px-3">No users found</p>
                    ) : (
                      availableUsers.map(user => (
                        <button
                          key={user.id}
                          onClick={() => handleAddUser(user.id)}
                          disabled={isAdding}
                          className="w-full flex items-center gap-3 p-2 text-left hover:bg-gray-50"
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
                      ))
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Show added users */}
            {userCollaborations.length > 0 && (
              <div className="space-y-2 mt-3">
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
          <div className="fixed inset-0 z-[70]" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 bottom-full mb-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-[71]">
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
  collaborator: ModelTemplateCollaborator
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
