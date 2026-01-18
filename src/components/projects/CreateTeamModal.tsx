import { useState, useEffect, useMemo, useRef } from 'react'
import { X, Search, Users, Building2, ChevronDown, ChevronRight, Check, Filter, Info } from 'lucide-react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { clsx } from 'clsx'

interface CreateTeamModalProps {
  isOpen: boolean
  onClose: () => void
  editingTeam?: {
    id: string
    name: string
    member_ids: string[]
  } | null
}

interface OrgNode {
  id: string
  name: string
  node_type: string
  parent_id: string | null
  color: string
  direct_member_ids: string[]
  all_member_ids: string[] // includes children
}

const NODE_TYPE_CONFIG: Record<string, { label: string; color: string; order: number }> = {
  division: { label: 'Divisions', color: '#ef4444', order: 1 },
  department: { label: 'Departments', color: '#6366f1', order: 2 },
  team: { label: 'Teams', color: '#22c55e', order: 3 },
  portfolio: { label: 'Portfolios', color: '#f59e0b', order: 4 },
}

export function CreateTeamModal({ isOpen, onClose, editingTeam }: CreateTeamModalProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const [name, setName] = useState('')
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedOrgFilters, setSelectedOrgFilters] = useState<string[]>([])
  const [expandedTypes, setExpandedTypes] = useState<string[]>(['team', 'department'])
  const [viewingUserOrgs, setViewingUserOrgs] = useState<string | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Fetch all users
  const { data: allUsers } = useQuery({
    queryKey: ['users-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, first_name, last_name, email')
        .eq('is_active', true)
        .order('first_name')

      if (error) throw error
      return (data || []).map(u => ({
        ...u,
        full_name: u.first_name && u.last_name
          ? `${u.first_name} ${u.last_name}`.trim()
          : u.first_name || u.last_name || null
      }))
    }
  })

  // Fetch all org nodes
  const { data: rawOrgNodes } = useQuery({
    queryKey: ['org-chart-nodes-basic'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_chart_nodes')
        .select('id, name, node_type, parent_id')
        .order('name')

      if (error) throw error
      return data || []
    }
  })

  // Fetch org chart memberships to know which org groups users belong to
  const { data: orgMemberships } = useQuery({
    queryKey: ['org-chart-memberships-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_chart_node_members')
        .select(`
          user_id,
          node_id,
          node:org_chart_nodes(id, name, node_type)
        `)

      if (error) throw error
      return data || []
    }
  })

  // Create a map of user_id -> org group ids
  const userOrgMap = useMemo(() => {
    const map = new Map<string, string[]>()
    orgMemberships?.forEach(membership => {
      if (membership.node) {
        const existing = map.get(membership.user_id) || []
        existing.push(membership.node_id)
        map.set(membership.user_id, existing)
      }
    })
    return map
  }, [orgMemberships])

  // Create a map of node_id -> direct member user_ids
  const nodeDirectMembersMap = useMemo(() => {
    const map = new Map<string, string[]>()
    orgMemberships?.forEach(membership => {
      const existing = map.get(membership.node_id) || []
      existing.push(membership.user_id)
      map.set(membership.node_id, existing)
    })
    return map
  }, [orgMemberships])

  // Build allOrgNodes with hierarchical member counts
  const allOrgNodes = useMemo(() => {
    if (!rawOrgNodes) return []

    // Build parent-child map
    const childrenMap = new Map<string, string[]>()
    rawOrgNodes.forEach(node => {
      if (node.parent_id) {
        const children = childrenMap.get(node.parent_id) || []
        children.push(node.id)
        childrenMap.set(node.parent_id, children)
      }
    })

    // Recursively collect all members (including children)
    const getAllMembers = (nodeId: string, visited = new Set<string>()): string[] => {
      if (visited.has(nodeId)) return []
      visited.add(nodeId)

      const directMembers = nodeDirectMembersMap.get(nodeId) || []
      const members = new Set(directMembers)

      const children = childrenMap.get(nodeId) || []
      children.forEach(childId => {
        getAllMembers(childId, visited).forEach(m => members.add(m))
      })

      return Array.from(members)
    }

    // Build the final nodes array with all member counts
    return rawOrgNodes.map(node => ({
      id: node.id,
      name: node.name,
      node_type: node.node_type,
      parent_id: node.parent_id,
      color: NODE_TYPE_CONFIG[node.node_type]?.color || '#8b5cf6',
      direct_member_ids: nodeDirectMembersMap.get(node.id) || [],
      all_member_ids: getAllMembers(node.id)
    })) as OrgNode[]
  }, [rawOrgNodes, nodeDirectMembersMap])

  // Group org nodes by type
  const orgNodesByType = useMemo(() => {
    if (!allOrgNodes) return {}
    const grouped: Record<string, OrgNode[]> = {}
    allOrgNodes.forEach(node => {
      if (!grouped[node.node_type]) {
        grouped[node.node_type] = []
      }
      grouped[node.node_type].push(node)
    })
    return grouped
  }, [allOrgNodes])

  // Create a map for quick node lookup by id
  const nodeById = useMemo(() => {
    const map = new Map<string, OrgNode>()
    allOrgNodes.forEach(node => map.set(node.id, node))
    return map
  }, [allOrgNodes])

  // Get full hierarchy for a user (direct memberships + all ancestors)
  const getUserFullHierarchy = (userId: string): OrgNode[] => {
    const directOrgs = userOrgMap.get(userId) || []
    const allNodes = new Set<string>()

    // For each direct membership, traverse up to get all ancestors
    directOrgs.forEach(nodeId => {
      let currentId: string | null = nodeId
      while (currentId) {
        allNodes.add(currentId)
        const node = nodeById.get(currentId)
        currentId = node?.parent_id || null
      }
    })

    // Return nodes sorted by type order (division → department → team → portfolio)
    return Array.from(allNodes)
      .map(id => nodeById.get(id))
      .filter((n): n is OrgNode => !!n)
      .sort((a, b) => (NODE_TYPE_CONFIG[a.node_type]?.order || 99) - (NODE_TYPE_CONFIG[b.node_type]?.order || 99))
  }

  // Get sorted node types
  const sortedNodeTypes = useMemo(() => {
    return Object.keys(orgNodesByType).sort((a, b) =>
      (NODE_TYPE_CONFIG[a]?.order || 99) - (NODE_TYPE_CONFIG[b]?.order || 99)
    )
  }, [orgNodesByType])

  // Filter users based on search query AND org filters
  const filteredUsers = useMemo(() => {
    if (!allUsers) return []

    return allUsers.filter(u => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        const matchesSearch = (
          u.full_name?.toLowerCase().includes(query) ||
          u.first_name?.toLowerCase().includes(query) ||
          u.last_name?.toLowerCase().includes(query) ||
          u.email?.toLowerCase().includes(query)
        )
        if (!matchesSearch) return false
      }

      // Org filter - if any filters selected, user must be in at least one (including child orgs)
      if (selectedOrgFilters.length > 0) {
        const matchesOrg = selectedOrgFilters.some(filterId => {
          const orgNode = allOrgNodes.find(n => n.id === filterId)
          // Check if user is in the org's all_member_ids (includes children)
          return orgNode?.all_member_ids?.includes(u.id) || false
        })
        if (!matchesOrg) return false
      }

      return true
    })
  }, [allUsers, searchQuery, selectedOrgFilters, allOrgNodes])

  // Load existing team data when editing
  useEffect(() => {
    if (editingTeam) {
      setName(editingTeam.name)
      setSelectedUserIds(editingTeam.member_ids || [])
    } else {
      setName('')
      setSelectedUserIds([])
    }
    setSearchQuery('')
    setSelectedOrgFilters([])
  }, [editingTeam, isOpen])

  // Toggle org filter
  const toggleOrgFilter = (nodeId: string) => {
    setSelectedOrgFilters(prev =>
      prev.includes(nodeId)
        ? prev.filter(id => id !== nodeId)
        : [...prev, nodeId]
    )
  }

  // Select all members from an org node (including child nodes)
  const selectAllFromOrg = (node: OrgNode) => {
    setSelectedUserIds(prev => {
      const newIds = new Set(prev)
      ;(node.all_member_ids || []).forEach(id => newIds.add(id))
      return Array.from(newIds)
    })
  }

  // Toggle type expansion
  const toggleTypeExpanded = (nodeType: string) => {
    setExpandedTypes(prev =>
      prev.includes(nodeType)
        ? prev.filter(t => t !== nodeType)
        : [...prev, nodeType]
    )
  }

  // Create/Update team mutation
  const saveTeamMutation = useMutation({
    mutationFn: async () => {
      if (editingTeam) {
        const { error } = await supabase
          .from('project_teams')
          .update({ name, member_ids: selectedUserIds })
          .eq('id', editingTeam.id)

        if (error) throw error
      } else {
        const { error } = await supabase
          .from('project_teams')
          .insert({
            name,
            member_ids: selectedUserIds,
            created_by: user?.id
          })

        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-teams'] })
      onClose()
    }
  })

  const toggleUser = (userId: string) => {
    setSelectedUserIds(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    )
  }

  // Get display name for user
  const getDisplayName = (userId: string) => {
    const u = allUsers?.find(u => u.id === userId)
    if (!u) return 'Unknown'
    return u.full_name || u.email.split('@')[0]
  }

  // Clear all filters
  const clearFilters = () => {
    setSelectedOrgFilters([])
    setSearchQuery('')
  }

  if (!isOpen) return null

  const hasActiveFilters = selectedOrgFilters.length > 0 || searchQuery.length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setViewingUserOrgs(null)}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-3xl h-[600px] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary-100 dark:bg-primary-900/30 rounded-lg">
              <Users className="w-5 h-5 text-primary-600 dark:text-primary-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {editingTeam ? 'Edit Team' : 'Create Team'}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {selectedUserIds.length} {selectedUserIds.length === 1 ? 'member' : 'members'} selected
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Team Name */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter team name..."
            className="text-base font-medium"
            required
          />
        </div>

        {/* Main Content - Two Column Layout */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Panel - Org Filters */}
          <div className="w-80 flex-shrink-0 border-r border-gray-200 dark:border-gray-700 flex flex-col bg-gray-50 dark:bg-gray-900/50 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  <Filter className="w-4 h-4" />
                  <span>Filter by Org</span>
                </div>
                {selectedOrgFilters.length > 0 && (
                  <button
                    onClick={() => setSelectedOrgFilters([])}
                    className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto overflow-x-hidden py-2">
              {sortedNodeTypes.map(nodeType => {
                const config = NODE_TYPE_CONFIG[nodeType]
                const nodes = orgNodesByType[nodeType] || []
                const isExpanded = expandedTypes.includes(nodeType)
                const selectedInType = nodes.filter(n => selectedOrgFilters.includes(n.id)).length

                return (
                  <div key={nodeType} className="mb-1">
                    <button
                      onClick={() => toggleTypeExpanded(nodeType)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors min-w-0"
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 flex-shrink-0" />
                      ) : (
                        <ChevronRight className="w-4 h-4 flex-shrink-0" />
                      )}
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: config?.color }}
                      />
                      <span className="flex-1 text-left truncate">{config?.label || nodeType}</span>
                      {selectedInType > 0 && (
                        <span className="text-xs bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300 px-1.5 py-0.5 rounded flex-shrink-0">
                          {selectedInType}
                        </span>
                      )}
                    </button>

                    {isExpanded && (
                      <div className="ml-2 border-l-2 border-gray-200 dark:border-gray-700">
                        {nodes.map(node => {
                          const isSelected = selectedOrgFilters.includes(node.id)
                          const memberCount = node.all_member_ids?.length || 0
                          return (
                            <button
                              key={node.id}
                              onClick={() => toggleOrgFilter(node.id)}
                              className={clsx(
                                'w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors text-left min-w-0',
                                isSelected
                                  ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                              )}
                            >
                              <span
                                className={clsx(
                                  'w-3.5 h-3.5 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0',
                                  isSelected
                                    ? 'border-primary-600 bg-primary-600'
                                    : 'border-gray-300 dark:border-gray-600'
                                )}
                              >
                                {isSelected && <Check className="w-2 h-2 text-white" />}
                              </span>
                              <span className="flex-1 truncate min-w-0">{node.name}</span>
                              <span className="text-xs text-gray-400 flex-shrink-0">
                                ({memberCount})
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Right Panel - User Selection */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            {/* Search */}
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search people..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                />
              </div>
              {hasActiveFilters && (
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs text-gray-500">
                    Showing {filteredUsers.length} of {allUsers?.length || 0}
                  </span>
                  <button
                    onClick={clearFilters}
                    className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
                  >
                    Clear all filters
                  </button>
                </div>
              )}
            </div>

            {/* User List */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden">
              {filteredUsers.length > 0 ? (
                filteredUsers.map((u) => {
                  const displayName = u.full_name || u.email.split('@')[0]
                  const isSelected = selectedUserIds.includes(u.id)
                  const userHierarchy = getUserFullHierarchy(u.id)
                  const isViewingOrgs = viewingUserOrgs === u.id

                  // Group hierarchy by type for display
                  const hierarchyByType: Record<string, OrgNode[]> = {}
                  userHierarchy.forEach(node => {
                    if (!hierarchyByType[node.node_type]) {
                      hierarchyByType[node.node_type] = []
                    }
                    hierarchyByType[node.node_type].push(node)
                  })

                  return (
                    <div key={u.id} className="relative">
                      <div
                        className={clsx(
                          'flex items-center gap-2 px-3 py-1.5 border-b border-gray-100 dark:border-gray-700/50 transition-colors',
                          isSelected
                            ? 'bg-primary-50 dark:bg-primary-900/20'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleUser(u.id)}
                          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer flex-shrink-0"
                        />
                        <button
                          type="button"
                          onClick={() => toggleUser(u.id)}
                          className={clsx(
                            'flex-1 text-left text-sm transition-colors truncate',
                            isSelected
                              ? 'text-primary-700 dark:text-primary-300 font-medium'
                              : 'text-gray-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400'
                          )}
                        >
                          {displayName}
                        </button>
                        {userHierarchy.length > 0 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setViewingUserOrgs(isViewingOrgs ? null : u.id)
                            }}
                            className={clsx(
                              'p-1 rounded transition-colors flex-shrink-0',
                              isViewingOrgs
                                ? 'bg-primary-100 dark:bg-primary-900/50 text-primary-600 dark:text-primary-400'
                                : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                            )}
                            title="View org memberships"
                          >
                            <Building2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      {/* Org memberships - grouped by type */}
                      {isViewingOrgs && (
                        <div
                          className="mx-3 mb-2 mt-1 p-3 rounded-lg bg-gray-100 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {userHierarchy.length > 0 ? (
                            <div className="space-y-2">
                              {Object.entries(hierarchyByType).map(([type, nodes]) => (
                                <div key={type}>
                                  <div className="flex items-center gap-1.5 mb-1">
                                    <span
                                      className="w-2 h-2 rounded-full flex-shrink-0"
                                      style={{ backgroundColor: NODE_TYPE_CONFIG[type]?.color }}
                                    />
                                    <span
                                      className="text-[10px] font-semibold uppercase tracking-wide"
                                      style={{ color: NODE_TYPE_CONFIG[type]?.color }}
                                    >
                                      {NODE_TYPE_CONFIG[type]?.label || type}
                                    </span>
                                  </div>
                                  <div className="ml-3.5 flex flex-wrap gap-1">
                                    {nodes.map(org => (
                                      <span
                                        key={org.id}
                                        className="inline-block px-2 py-0.5 text-xs rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600"
                                      >
                                        {org.name}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400 italic">No org memberships</span>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-gray-500 dark:text-gray-400">
                  <Users className="w-10 h-10 mb-3 opacity-50" />
                  <p className="text-sm">
                    {hasActiveFilters ? 'No users match your filters' : 'No users found'}
                  </p>
                  {hasActiveFilters && (
                    <button
                      onClick={clearFilters}
                      className="mt-2 text-sm text-primary-600 dark:text-primary-400 hover:underline"
                    >
                      Clear filters
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
          {/* Selected Members */}
          {selectedUserIds.length > 0 && (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-sm text-gray-600 dark:text-gray-400 truncate">
                {selectedUserIds.length} selected
              </span>
              <button
                onClick={() => setSelectedUserIds([])}
                className="text-xs text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
              >
                Clear
              </button>
            </div>
          )}
          {selectedUserIds.length === 0 && <div className="flex-1" />}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => saveTeamMutation.mutate()}
            disabled={!name.trim() || saveTeamMutation.isPending}
          >
            {editingTeam ? 'Save Changes' : 'Create Team'}
          </Button>
        </div>
      </div>
    </div>
  )
}
