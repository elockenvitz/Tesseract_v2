import { useState, useMemo } from 'react'
import { X, Search, Users, Building2, Loader2, Check, Trash2, ChevronDown, Layers, Briefcase, User, Globe } from 'lucide-react'
import { clsx } from 'clsx'
import { useQuery } from '@tanstack/react-query'
import {
  useLayoutCollaborations,
  LayoutCollaborator
} from '../../hooks/useLayoutCollaborations'
import { useSearchUsers } from '../../hooks/useTemplateCollaborations'
import { SavedLayout } from '../../hooks/useUserAssetPagePreferences'
import { Button } from '../ui/Button'
import { supabase } from '../../lib/supabase'

interface LayoutSharingModalProps {
  layout: SavedLayout
  onClose: () => void
}

type PermissionLevel = 'view' | 'edit' | 'admin'

interface OrgNode {
  id: string
  name: string
  node_type: 'division' | 'department' | 'team' | 'portfolio'
  parent_id: string | null
}

interface SearchableEntity {
  id: string
  type: 'user' | 'division' | 'department' | 'team' | 'portfolio' | 'organization'
  name: string
  subtitle?: string
  initials: string
}

const PERMISSION_LABELS: Record<PermissionLevel, { label: string; description: string }> = {
  view: { label: 'Can view', description: 'Can use this layout' },
  edit: { label: 'Can edit', description: 'Can modify the layout' },
  admin: { label: 'Admin', description: 'Can edit and manage sharing' }
}

const NODE_TYPE_ICONS: Record<string, React.ReactNode> = {
  organization: <Globe className="w-4 h-4 text-blue-600" />,
  division: <Building2 className="w-4 h-4 text-blue-500" />,
  department: <Layers className="w-4 h-4 text-purple-500" />,
  team: <Users className="w-4 h-4 text-green-500" />,
  portfolio: <Briefcase className="w-4 h-4 text-amber-500" />,
  user: <User className="w-4 h-4 text-gray-500" />
}

const NODE_TYPE_LABELS: Record<string, string> = {
  organization: 'Organization',
  division: 'Division',
  department: 'Department',
  team: 'Team',
  portfolio: 'Portfolio',
  user: 'Person'
}

export function LayoutSharingModal({ layout, onClose }: LayoutSharingModalProps) {
  const {
    collaborations,
    userCollaborations,
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
  } = useLayoutCollaborations(layout.id)

  const [searchQuery, setSearchQuery] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)

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

  // Search users
  const { data: searchResults = [], isLoading: isSearching } = useSearchUsers(searchQuery)

  // Get set of already shared entity IDs
  const sharedUserIds = new Set(userCollaborations?.map(c => c.user_id) || [])
  const sharedNodeIds = new Set(nodeCollaborations?.map(c => c.org_node_id) || [])

  // Build searchable entities list
  const allEntities: SearchableEntity[] = useMemo(() => {
    const entities: SearchableEntity[] = []

    // Add "Entire Organization" option
    entities.push({
      id: 'org',
      type: 'organization',
      name: 'Entire Organization',
      subtitle: 'Everyone in your organization',
      initials: 'ORG'
    })

    // Add org nodes
    orgNodes.forEach(node => {
      entities.push({
        id: node.id,
        type: node.node_type,
        name: node.name,
        subtitle: NODE_TYPE_LABELS[node.node_type],
        initials: node.name.substring(0, 2).toUpperCase()
      })
    })

    // Add users from search
    searchResults.forEach(user => {
      const fullName = user.first_name && user.last_name
        ? `${user.first_name} ${user.last_name}`
        : user.email
      entities.push({
        id: user.id,
        type: 'user',
        name: fullName,
        subtitle: user.first_name ? user.email : undefined,
        initials: user.first_name?.[0]?.toUpperCase() || user.email[0].toUpperCase()
      })
    })

    return entities
  }, [orgNodes, searchResults])

  // Filter entities based on search and exclude already added
  const filteredEntities = useMemo(() => {
    const query = searchQuery.toLowerCase().trim()

    return allEntities.filter(entity => {
      // Check if already added
      if (entity.type === 'organization' && isSharedWithOrg) return false
      if (entity.type === 'user' && sharedUserIds.has(entity.id)) return false
      if (['division', 'department', 'team', 'portfolio'].includes(entity.type) && sharedNodeIds.has(entity.id)) return false

      // Filter by search query
      if (!query) return true
      return (
        entity.name.toLowerCase().includes(query) ||
        entity.subtitle?.toLowerCase().includes(query)
      )
    })
  }, [allEntities, searchQuery, isSharedWithOrg, sharedUserIds, sharedNodeIds])

  // Group filtered entities by type for display
  const groupedEntities = useMemo(() => {
    const groups: Record<string, SearchableEntity[]> = {
      organization: [],
      division: [],
      department: [],
      team: [],
      portfolio: [],
      user: []
    }

    filteredEntities.forEach(entity => {
      groups[entity.type].push(entity)
    })

    return groups
  }, [filteredEntities])

  const handleAddEntity = async (entity: SearchableEntity) => {
    try {
      if (entity.type === 'organization') {
        await shareWithOrganization({ layout_id: layout.id, permission: 'view' })
      } else if (entity.type === 'user') {
        await addCollaborator({
          layout_id: layout.id,
          user_id: entity.id,
          permission: 'view'
        })
      } else {
        await addCollaborator({
          layout_id: layout.id,
          org_node_id: entity.id,
          permission: 'view'
        })
      }
      setSearchQuery('')
      setShowDropdown(false)
    } catch (error) {
      console.error('Failed to add:', error)
    }
  }

  const handleUpdatePermission = async (collaborator: LayoutCollaborator | 'org', permission: PermissionLevel) => {
    try {
      if (collaborator === 'org') {
        await shareWithOrganization({ layout_id: layout.id, permission })
      } else {
        await updateCollaborator(collaborator.id, { permission })
      }
    } catch (error) {
      console.error('Failed to update permission:', error)
    }
  }

  const handleRemoveCollaborator = async (collaboratorId: string | 'org') => {
    try {
      if (collaboratorId === 'org') {
        await removeOrganizationSharing(layout.id)
      } else {
        await removeCollaborator(collaboratorId)
      }
    } catch (error) {
      console.error('Failed to remove:', error)
    }
  }

  const hasCollaborators = isSharedWithOrg || userCollaborations.length > 0 || (nodeCollaborations?.length || 0) > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Share Layout</h3>
            <p className="text-sm text-gray-500 mt-0.5">{layout.name}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Search Input */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setShowDropdown(true)
              }}
              onFocus={() => setShowDropdown(true)}
              placeholder="Search people, teams, or groups..."
              className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />

            {/* Search Dropdown */}
            {showDropdown && (
              <>
                <div className="fixed inset-0 z-[60]" onClick={() => setShowDropdown(false)} />
                <div className="absolute left-0 right-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 max-h-80 overflow-y-auto z-[61]">
                  {isSearching && searchQuery.length >= 2 ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                    </div>
                  ) : filteredEntities.length === 0 ? (
                    <p className="text-sm text-gray-500 py-4 px-4 text-center">
                      {searchQuery ? 'No results found' : 'Start typing to search...'}
                    </p>
                  ) : (
                    <div className="py-1">
                      {/* Organization */}
                      {groupedEntities.organization.length > 0 && (
                        <div>
                          <div className="px-3 py-1.5 text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">
                            Organization
                          </div>
                          {groupedEntities.organization.map(entity => (
                            <EntitySearchRow
                              key={entity.id}
                              entity={entity}
                              onSelect={() => handleAddEntity(entity)}
                              isAdding={isAdding}
                            />
                          ))}
                        </div>
                      )}

                      {/* Groups */}
                      {(groupedEntities.division.length > 0 ||
                        groupedEntities.department.length > 0 ||
                        groupedEntities.team.length > 0 ||
                        groupedEntities.portfolio.length > 0) && (
                        <div>
                          <div className="px-3 py-1.5 text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">
                            Groups
                          </div>
                          {[...groupedEntities.division, ...groupedEntities.department, ...groupedEntities.team, ...groupedEntities.portfolio].map(entity => (
                            <EntitySearchRow
                              key={entity.id}
                              entity={entity}
                              onSelect={() => handleAddEntity(entity)}
                              isAdding={isAdding}
                            />
                          ))}
                        </div>
                      )}

                      {/* People */}
                      {groupedEntities.user.length > 0 && (
                        <div>
                          <div className="px-3 py-1.5 text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">
                            People
                          </div>
                          {groupedEntities.user.map(entity => (
                            <EntitySearchRow
                              key={entity.id}
                              entity={entity}
                              onSelect={() => handleAddEntity(entity)}
                              isAdding={isAdding}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Collaborators List */}
          {hasCollaborators && (
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                Shared with
              </h4>

              <div className="space-y-2">
                {/* Organization-wide sharing */}
                {isSharedWithOrg && orgCollaboration && (
                  <CollaboratorRow
                    icon={NODE_TYPE_ICONS.organization}
                    name="Entire Organization"
                    subtitle="Everyone in your organization"
                    permission={orgCollaboration.permission}
                    onUpdatePermission={(p) => handleUpdatePermission('org', p)}
                    onRemove={() => handleRemoveCollaborator('org')}
                    isUpdating={isUpdating}
                    isRemoving={isRemoving}
                  />
                )}

                {/* Org node collaborations */}
                {nodeCollaborations?.map(collab => (
                  <CollaboratorRow
                    key={collab.id}
                    icon={collab.org_node ? NODE_TYPE_ICONS[collab.org_node.node_type] : NODE_TYPE_ICONS.team}
                    name={collab.org_node?.name || 'Unknown'}
                    subtitle={collab.org_node ? NODE_TYPE_LABELS[collab.org_node.node_type] : undefined}
                    permission={collab.permission}
                    onUpdatePermission={(p) => handleUpdatePermission(collab, p)}
                    onRemove={() => handleRemoveCollaborator(collab.id)}
                    isUpdating={isUpdating}
                    isRemoving={isRemoving}
                  />
                ))}

                {/* User collaborations */}
                {userCollaborations.map(collab => {
                  const userName = collab.user?.first_name && collab.user?.last_name
                    ? `${collab.user.first_name} ${collab.user.last_name}`
                    : collab.user?.email || 'Unknown'
                  const userSubtitle = collab.user?.first_name ? collab.user.email : undefined

                  return (
                    <CollaboratorRow
                      key={collab.id}
                      icon={NODE_TYPE_ICONS.user}
                      name={userName}
                      subtitle={userSubtitle}
                      permission={collab.permission}
                      onUpdatePermission={(p) => handleUpdatePermission(collab, p)}
                      onRemove={() => handleRemoveCollaborator(collab.id)}
                      isUpdating={isUpdating}
                      isRemoving={isRemoving}
                      initials={collab.user?.first_name?.[0] || collab.user?.email?.[0]?.toUpperCase()}
                    />
                  )
                })}
              </div>
            </div>
          )}

          {!hasCollaborators && (
            <div className="text-center py-6 text-gray-500">
              <Users className="w-10 h-10 mx-auto mb-2 text-gray-300" />
              <p className="text-sm">This layout is private</p>
              <p className="text-xs mt-1">Search above to share with people or groups</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <Button onClick={onClose} className="w-full">
            Done
          </Button>
        </div>
      </div>
    </div>
  )
}

interface EntitySearchRowProps {
  entity: SearchableEntity
  onSelect: () => void
  isAdding: boolean
}

function EntitySearchRow({ entity, onSelect, isAdding }: EntitySearchRowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={isAdding}
      className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors"
    >
      <div className={clsx(
        'w-8 h-8 rounded-full flex items-center justify-center shrink-0',
        entity.type === 'user' ? 'bg-gray-100' : 'bg-blue-50'
      )}>
        {entity.type === 'user' ? (
          <span className="text-sm font-medium text-gray-600">{entity.initials}</span>
        ) : (
          NODE_TYPE_ICONS[entity.type]
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{entity.name}</p>
        {entity.subtitle && (
          <p className="text-xs text-gray-500 truncate">{entity.subtitle}</p>
        )}
      </div>
    </button>
  )
}

interface CollaboratorRowProps {
  icon: React.ReactNode
  name: string
  subtitle?: string
  permission: PermissionLevel
  onUpdatePermission: (permission: PermissionLevel) => void
  onRemove: () => void
  isUpdating: boolean
  isRemoving: boolean
  initials?: string
}

function CollaboratorRow({
  icon,
  name,
  subtitle,
  permission,
  onUpdatePermission,
  onRemove,
  isUpdating,
  isRemoving,
  initials
}: CollaboratorRowProps) {
  const [showPermissionDropdown, setShowPermissionDropdown] = useState(false)

  return (
    <div className="flex items-center gap-3 p-2.5 bg-gray-50 rounded-lg border border-gray-200">
      <div className="w-8 h-8 rounded-full bg-white border border-gray-200 flex items-center justify-center shrink-0">
        {initials ? (
          <span className="text-sm font-medium text-gray-600">{initials}</span>
        ) : (
          icon
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
        {subtitle && <p className="text-xs text-gray-500 truncate">{subtitle}</p>}
      </div>

      {/* Permission Dropdown */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setShowPermissionDropdown(!showPermissionDropdown)}
          disabled={isUpdating}
          className={clsx(
            'flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors',
            isUpdating
              ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
              : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400 hover:bg-gray-50'
          )}
        >
          {PERMISSION_LABELS[permission].label}
          <ChevronDown className="w-3 h-3" />
        </button>

        {showPermissionDropdown && (
          <>
            <div className="fixed inset-0 z-[70]" onClick={() => setShowPermissionDropdown(false)} />
            <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-[71]">
              {(Object.entries(PERMISSION_LABELS) as [PermissionLevel, { label: string; description: string }][]).map(
                ([level, { label, description }]) => (
                  <button
                    key={level}
                    onClick={() => {
                      onUpdatePermission(level)
                      setShowPermissionDropdown(false)
                    }}
                    className={clsx(
                      'w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-50',
                      permission === level && 'bg-primary-50'
                    )}
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-900">{label}</p>
                      <p className="text-xs text-gray-500">{description}</p>
                    </div>
                    {permission === level && <Check className="w-4 h-4 text-primary-600" />}
                  </button>
                )
              )}
            </div>
          </>
        )}
      </div>

      {/* Remove Button */}
      <button
        type="button"
        onClick={onRemove}
        disabled={isRemoving}
        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
      >
        {isRemoving ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Trash2 className="w-4 h-4" />
        )}
      </button>
    </div>
  )
}
