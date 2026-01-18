import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Folder,
  Plus,
  X,
  Star,
  Tag,
  Briefcase,
  Archive,
  Circle,
  Clock,
  AlertCircle,
  CheckCircle,
  Settings,
  Edit,
  Filter,
  ChevronDown,
  ChevronRight,
  Users,
  Building2
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { clsx } from 'clsx'
import type { ProjectStatus, ProjectPriority } from '../../types/project'
import { CreateCollectionModal } from './CreateCollectionModal'
import { CreateTeamModal } from './CreateTeamModal'
import { CreateTagModal } from './CreateTagModal'

interface CollectionFilters {
  statuses?: ProjectStatus[]
  priorities?: ProjectPriority[]
  tagIds?: string[]
  userIds?: string[]
  orgGroupId?: string
}

interface Collection {
  id: string
  name: string
  color: string
  icon: string
  is_pinned: boolean
  filters: CollectionFilters
}

interface ProjectCollectionsSidebarProps {
  activeCollectionId: string | null
  onSelectCollection: (collectionId: string | null, filters?: CollectionFilters) => void
  onSelectView: (view: 'active' | 'archived') => void
  activeView: 'active' | 'archived'
}

export function ProjectCollectionsSidebar({
  activeCollectionId,
  onSelectCollection,
  onSelectView,
  activeView
}: ProjectCollectionsSidebarProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null)
  const [newCollectionName, setNewCollectionName] = useState('')
  const [selectedColor, setSelectedColor] = useState('#6366f1')
  const [selectedStatuses, setSelectedStatuses] = useState<ProjectStatus[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [tagsExpanded, setTagsExpanded] = useState(true)
  const [filteredExpanded, setFilteredExpanded] = useState(true)
  const [teamsExpanded, setTeamsExpanded] = useState(true)
  const [orgGroupsExpanded, setOrgGroupsExpanded] = useState(true)
  const [orgDivisionsExpanded, setOrgDivisionsExpanded] = useState(false)
  const [orgDepartmentsExpanded, setOrgDepartmentsExpanded] = useState(false)
  const [orgTeamsExpanded, setOrgTeamsExpanded] = useState(true)
  const [orgPortfoliosExpanded, setOrgPortfoliosExpanded] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingCollectionForModal, setEditingCollectionForModal] = useState<any>(null)
  const [showCreateTeamModal, setShowCreateTeamModal] = useState(false)
  const [editingTeam, setEditingTeam] = useState<any>(null)
  const [showCreateTagModal, setShowCreateTagModal] = useState(false)

  const COLORS = [
    '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
    '#f97316', '#eab308', '#22c55e', '#14b8a6'
  ]

  const STATUS_OPTIONS: { value: ProjectStatus; label: string; icon: any; color: string }[] = [
    { value: 'planning', label: 'Planning', icon: Circle, color: 'text-gray-500' },
    { value: 'in_progress', label: 'In Progress', icon: Clock, color: 'text-blue-500' },
    { value: 'blocked', label: 'Blocked', icon: AlertCircle, color: 'text-red-500' },
    { value: 'completed', label: 'Completed', icon: CheckCircle, color: 'text-green-500' }
  ]

  // Fetch teams (project-specific teams created by user)
  const { data: allTeams } = useQuery({
    queryKey: ['project-teams', user?.id],
    queryFn: async () => {
      if (!user?.id) return []

      const { data, error } = await supabase
        .from('project_teams')
        .select('*')
        .eq('created_by', user.id)
        .order('name')

      if (error) throw error
      return data || []
    },
    enabled: !!user?.id
  })

  // Fetch org groups that the current user is a member of (including parent nodes)
  const { data: orgGroups } = useQuery({
    queryKey: ['org-chart-groups-user', user?.id],
    queryFn: async () => {
      if (!user?.id) return []

      // Fetch all org nodes with their members, settings, and parent info
      const { data, error } = await supabase
        .from('org_chart_nodes')
        .select(`
          id,
          name,
          node_type,
          parent_id,
          settings,
          org_chart_node_members(user_id)
        `)
        .order('name')

      if (error) throw error
      if (!data) return []

      // Also fetch team_memberships for team nodes that use settings.team_id
      const teamIds = data
        .filter(n => n.node_type === 'team' && n.settings?.team_id)
        .map(n => n.settings.team_id)

      let teamMembershipsMap = new Map<string, string[]>()
      if (teamIds.length > 0) {
        const { data: teamMemberships } = await supabase
          .from('team_memberships')
          .select('team_id, user_id')
          .in('team_id', teamIds)

        if (teamMemberships) {
          for (const tm of teamMemberships) {
            const existing = teamMembershipsMap.get(tm.team_id) || []
            existing.push(tm.user_id)
            teamMembershipsMap.set(tm.team_id, existing)
          }
        }
      }

      // Build a map of all nodes
      const nodeMap = new Map(data.map(n => [n.id, n]))

      // Build a map of parent -> children for descendant lookup
      const childrenMap = new Map<string, typeof data>()
      for (const node of data) {
        if (node.parent_id) {
          const siblings = childrenMap.get(node.parent_id) || []
          siblings.push(node)
          childrenMap.set(node.parent_id, siblings)
        }
      }

      // Helper to get all members of a single node (including team_memberships)
      const getNodeMembers = (node: any): string[] => {
        const members = new Set<string>(
          node.org_chart_node_members?.map((m: any) => m.user_id) || []
        )
        // For team nodes, also include members from team_memberships
        if (node.node_type === 'team' && node.settings?.team_id) {
          const teamMembers = teamMembershipsMap.get(node.settings.team_id) || []
          for (const userId of teamMembers) {
            members.add(userId)
          }
        }
        return Array.from(members)
      }

      // Helper to get all descendant member IDs for a node (including the node itself)
      const getAllDescendantMembers = (nodeId: string): string[] => {
        const node = nodeMap.get(nodeId)
        if (!node) return []

        // Start with this node's members
        const members = new Set<string>(getNodeMembers(node))

        // Recursively add members from all children
        const children = childrenMap.get(nodeId) || []
        for (const child of children) {
          const childMembers = getAllDescendantMembers(child.id)
          for (const memberId of childMembers) {
            members.add(memberId)
          }
        }

        return Array.from(members)
      }

      // Find nodes where user is a direct member (via org_chart_node_members OR team_memberships)
      const directMemberNodes = data.filter(node => {
        const nodeMembers = getNodeMembers(node)
        return nodeMembers.includes(user.id)
      })

      // Collect all ancestor nodes for each direct membership
      const userNodeIds = new Set<string>()

      for (const node of directMemberNodes) {
        // Add the direct membership node
        userNodeIds.add(node.id)

        // Walk up the parent chain
        let currentNode = node
        while (currentNode.parent_id) {
          userNodeIds.add(currentNode.parent_id)
          const parentNode = nodeMap.get(currentNode.parent_id)
          if (!parentNode) break
          currentNode = parentNode
        }
      }

      // Return all nodes the user belongs to (directly or via hierarchy)
      return data
        .filter(node => userNodeIds.has(node.id))
        .map(node => ({
          ...node,
          member_ids: getAllDescendantMembers(node.id)
        }))
    },
    enabled: !!user?.id
  })

  // Fetch tags
  const { data: allTags } = useQuery({
    queryKey: ['project-tags', user?.id],
    queryFn: async () => {
      if (!user?.id) return []

      const { data, error } = await supabase
        .from('project_tags')
        .select('*')
        .eq('created_by', user.id)
        .order('name')

      if (error) throw error
      return data || []
    },
    enabled: !!user?.id
  })

  // Fetch collections
  const { data: collections } = useQuery({
    queryKey: ['project-collections', user?.id],
    queryFn: async () => {
      if (!user?.id) return []

      const { data, error } = await supabase
        .from('project_collections')
        .select('*')
        .eq('created_by', user.id)
        .order('is_pinned', { ascending: false })
        .order('name')

      if (error) throw error
      return (data || []).map(c => ({
        ...c,
        filters: c.filter_criteria || {}
      })) as Collection[]
    },
    enabled: !!user?.id
  })

  // Create collection mutation
  const createCollectionMutation = useMutation({
    mutationFn: async (data: { name: string; color: string; filters: CollectionFilters }) => {
      const { error } = await supabase
        .from('project_collections')
        .insert({
          name: data.name,
          color: data.color,
          icon: 'folder',
          filter_criteria: data.filters,
          created_by: user?.id
        })

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-collections'] })
      setShowCreateForm(false)
      setNewCollectionName('')
      setSelectedColor('#6366f1')
      setSelectedStatuses([])
      setSelectedTags([])
    }
  })

  // Update collection mutation
  const updateCollectionMutation = useMutation({
    mutationFn: async (data: { id: string; filters: CollectionFilters }) => {
      const { error } = await supabase
        .from('project_collections')
        .update({ filter_criteria: data.filters })
        .eq('id', data.id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-collections'] })
      setEditingCollectionId(null)
      setSelectedStatuses([])
      setSelectedTags([])
    }
  })

  // Toggle pin mutation
  const togglePinMutation = useMutation({
    mutationFn: async ({ collectionId, isPinned }: { collectionId: string; isPinned: boolean }) => {
      const { error } = await supabase
        .from('project_collections')
        .update({ is_pinned: !isPinned })
        .eq('id', collectionId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-collections'] })
    }
  })

  // Delete collection mutation
  const deleteCollectionMutation = useMutation({
    mutationFn: async (collectionId: string) => {
      const { error } = await supabase
        .from('project_collections')
        .delete()
        .eq('id', collectionId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-collections'] })
      if (activeCollectionId) {
        onSelectCollection(null)
      }
    }
  })

  const handleCreateCollection = () => {
    if (newCollectionName.trim()) {
      createCollectionMutation.mutate({
        name: newCollectionName.trim(),
        color: selectedColor,
        filters: {
          statuses: selectedStatuses.length > 0 ? selectedStatuses : undefined,
          tagIds: selectedTags.length > 0 ? selectedTags : undefined
        }
      })
    }
  }

  const handleStartEdit = (collection: Collection) => {
    setEditingCollectionId(collection.id)
    setSelectedStatuses(collection.filters?.statuses || [])
    setSelectedTags(collection.filters?.tagIds || [])
  }

  const handleSaveEdit = (collectionId: string) => {
    updateCollectionMutation.mutate({
      id: collectionId,
      filters: {
        statuses: selectedStatuses.length > 0 ? selectedStatuses : undefined,
        tagIds: selectedTags.length > 0 ? selectedTags : undefined
      }
    })
  }

  const toggleStatus = (status: ProjectStatus) => {
    setSelectedStatuses(prev =>
      prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status]
    )
  }

  const toggleTag = (tagId: string) => {
    setSelectedTags(prev =>
      prev.includes(tagId) ? prev.filter(t => t !== tagId) : [...prev, tagId]
    )
  }

  return (
    <div className="w-64 flex-shrink-0 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Collections</h3>
      </div>

      {/* Collections list */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="space-y-1">
          {/* All Projects */}
          <button
            onClick={() => {
              onSelectCollection(null)
              onSelectView('active')
            }}
            className={clsx(
              'w-full flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors',
              !activeCollectionId && activeView === 'active'
                ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
            )}
          >
            <Briefcase className="w-4 h-4" />
            <span className="flex-1 text-left">All Projects</span>
          </button>

          {/* Teams Section */}
          <div className="flex items-center justify-between mt-4">
            <button
              onClick={() => setTeamsExpanded(!teamsExpanded)}
              className="flex-1 px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            >
              {teamsExpanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
              <Users className="w-3.5 h-3.5" />
              <span>Teams</span>
            </button>
            <button
              onClick={() => {
                setEditingTeam(null)
                setShowCreateTeamModal(true)
              }}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
              title="Create new team"
            >
              <Plus className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
            </button>
          </div>
          {teamsExpanded && (
            <>
              {allTeams && allTeams.length > 0 ? (
                allTeams.map(team => (
                  <div key={team.id} className="group relative">
                    <button
                      onClick={() => {
                        // Create a virtual collection with this team's members
                        onSelectCollection(`team-${team.id}`, { userIds: team.member_ids })
                        onSelectView('active')
                      }}
                      className={clsx(
                        'w-full flex items-center gap-2 pl-8 pr-3 py-2 rounded text-sm transition-colors',
                        activeCollectionId === `team-${team.id}`
                          ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                      )}
                    >
                      <Users className="w-3 h-3 flex-shrink-0" />
                      <span className="flex-1 text-left truncate">{team.name}</span>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingTeam(team)
                        setShowCreateTeamModal(true)
                      }}
                      className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 opacity-0 group-hover:opacity-100 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-all"
                      title="Edit team"
                    >
                      <Edit className="w-3 h-3 text-gray-600 dark:text-gray-400" />
                    </button>
                  </div>
                ))
              ) : (
                <div className="pl-8 pr-3 py-2 text-xs text-gray-500 dark:text-gray-400 italic">
                  No teams yet
                </div>
              )}
            </>
          )}

          {/* Org Groups Section */}
          <div className="flex items-center justify-between mt-4">
            <button
              onClick={() => setOrgGroupsExpanded(!orgGroupsExpanded)}
              className="flex-1 px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            >
              {orgGroupsExpanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
              <Building2 className="w-3.5 h-3.5" />
              <span>Org Groups</span>
            </button>
          </div>
          {orgGroupsExpanded && (
            <>
              {orgGroups && orgGroups.length > 0 ? (
                <>
                  {/* Divisions */}
                  {orgGroups.filter(g => g.node_type === 'division').length > 0 && (
                    <>
                      <button
                        onClick={() => setOrgDivisionsExpanded(!orgDivisionsExpanded)}
                        className="w-full flex items-center gap-2 pl-6 pr-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                      >
                        {orgDivisionsExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        <div className="w-2 h-2 rounded" style={{ backgroundColor: '#ef4444' }} />
                        <span>Divisions</span>
                        <span className="ml-auto text-gray-400">({orgGroups.filter(g => g.node_type === 'division').length})</span>
                      </button>
                      {orgDivisionsExpanded && orgGroups.filter(g => g.node_type === 'division').map(group => (
                        <button
                          key={group.id}
                          onClick={() => {
                            onSelectCollection(`org-group-${group.id}`, { orgGroupId: group.id })
                            onSelectView('active')
                          }}
                          className={clsx(
                            'w-full flex items-center gap-2 pl-12 pr-3 py-1.5 rounded text-sm transition-colors',
                            activeCollectionId === `org-group-${group.id}`
                              ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                          )}
                        >
                          <span className="flex-1 text-left truncate">{group.name}</span>
                        </button>
                      ))}
                    </>
                  )}

                  {/* Departments */}
                  {orgGroups.filter(g => g.node_type === 'department').length > 0 && (
                    <>
                      <button
                        onClick={() => setOrgDepartmentsExpanded(!orgDepartmentsExpanded)}
                        className="w-full flex items-center gap-2 pl-6 pr-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                      >
                        {orgDepartmentsExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        <div className="w-2 h-2 rounded" style={{ backgroundColor: '#6366f1' }} />
                        <span>Departments</span>
                        <span className="ml-auto text-gray-400">({orgGroups.filter(g => g.node_type === 'department').length})</span>
                      </button>
                      {orgDepartmentsExpanded && orgGroups.filter(g => g.node_type === 'department').map(group => (
                        <button
                          key={group.id}
                          onClick={() => {
                                                        onSelectCollection(`org-group-${group.id}`, { orgGroupId: group.id })
                            onSelectView('active')
                          }}
                          className={clsx(
                            'w-full flex items-center gap-2 pl-12 pr-3 py-1.5 rounded text-sm transition-colors',
                            activeCollectionId === `org-group-${group.id}`
                              ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                          )}
                        >
                          <span className="flex-1 text-left truncate">{group.name}</span>
                        </button>
                      ))}
                    </>
                  )}

                  {/* Teams */}
                  {orgGroups.filter(g => g.node_type === 'team').length > 0 && (
                    <>
                      <button
                        onClick={() => setOrgTeamsExpanded(!orgTeamsExpanded)}
                        className="w-full flex items-center gap-2 pl-6 pr-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                      >
                        {orgTeamsExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        <div className="w-2 h-2 rounded" style={{ backgroundColor: '#22c55e' }} />
                        <span>Teams</span>
                        <span className="ml-auto text-gray-400">({orgGroups.filter(g => g.node_type === 'team').length})</span>
                      </button>
                      {orgTeamsExpanded && orgGroups.filter(g => g.node_type === 'team').map(group => (
                        <button
                          key={group.id}
                          onClick={() => {
                                                        onSelectCollection(`org-group-${group.id}`, { orgGroupId: group.id })
                            onSelectView('active')
                          }}
                          className={clsx(
                            'w-full flex items-center gap-2 pl-12 pr-3 py-1.5 rounded text-sm transition-colors',
                            activeCollectionId === `org-group-${group.id}`
                              ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                          )}
                        >
                          <span className="flex-1 text-left truncate">{group.name}</span>
                        </button>
                      ))}
                    </>
                  )}

                  {/* Portfolios */}
                  {orgGroups.filter(g => g.node_type === 'portfolio').length > 0 && (
                    <>
                      <button
                        onClick={() => setOrgPortfoliosExpanded(!orgPortfoliosExpanded)}
                        className="w-full flex items-center gap-2 pl-6 pr-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                      >
                        {orgPortfoliosExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        <div className="w-2 h-2 rounded" style={{ backgroundColor: '#f59e0b' }} />
                        <span>Portfolios</span>
                        <span className="ml-auto text-gray-400">({orgGroups.filter(g => g.node_type === 'portfolio').length})</span>
                      </button>
                      {orgPortfoliosExpanded && orgGroups.filter(g => g.node_type === 'portfolio').map(group => (
                        <button
                          key={group.id}
                          onClick={() => {
                                                        onSelectCollection(`org-group-${group.id}`, { orgGroupId: group.id })
                            onSelectView('active')
                          }}
                          className={clsx(
                            'w-full flex items-center gap-2 pl-12 pr-3 py-1.5 rounded text-sm transition-colors',
                            activeCollectionId === `org-group-${group.id}`
                              ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                          )}
                        >
                          <span className="flex-1 text-left truncate">{group.name}</span>
                        </button>
                      ))}
                    </>
                  )}
                </>
              ) : (
                <div className="pl-8 pr-3 py-2 text-xs text-gray-500 dark:text-gray-400 italic">
                  No org groups found
                </div>
              )}
            </>
          )}

          {/* Tags - Auto-generated from all tags */}
          <div className="flex items-center justify-between mt-4">
            <button
              onClick={() => setTagsExpanded(!tagsExpanded)}
              className="flex-1 px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            >
              {tagsExpanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
              <Tag className="w-3.5 h-3.5" />
              <span>Tags</span>
            </button>
            <button
              onClick={() => setShowCreateTagModal(true)}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
              title="Create new tag"
            >
              <Plus className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
            </button>
          </div>
          {tagsExpanded && (
            <>
              {allTags && allTags.length > 0 ? (
                allTags.map(tag => (
                  <button
                    key={tag.id}
                    onClick={() => {
                      // Create a virtual collection with just this tag
                      onSelectCollection(`tag-${tag.id}`, { tagIds: [tag.id] })
                      onSelectView('active')
                    }}
                    className={clsx(
                      'w-full flex items-center gap-2 pl-8 pr-3 py-2 rounded text-sm transition-colors',
                      activeCollectionId === `tag-${tag.id}`
                        ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                    )}
                  >
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="flex-1 text-left truncate">{tag.name}</span>
                  </button>
                ))
              ) : (
                <div className="pl-8 pr-3 py-2 text-xs text-gray-500 dark:text-gray-400 italic">
                  No tags yet
                </div>
              )}
            </>
          )}

          {/* Filtered Collections (custom collections with status filters) */}
          <div className="flex items-center justify-between mt-4">
            <button
              onClick={() => setFilteredExpanded(!filteredExpanded)}
              className="flex-1 px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            >
              {filteredExpanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
              <Filter className="w-3.5 h-3.5" />
              <span>Filtered</span>
            </button>
            <button
              onClick={() => {
                setEditingCollectionForModal(null)
                setShowCreateModal(true)
              }}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
              title="Create new collection"
            >
              <Plus className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
            </button>
          </div>
          {filteredExpanded && (
            <>
              {collections && collections.length > 0 ? (
                collections.map(collection => (
                  <div key={collection.id} className="space-y-1">
                      <div className="group relative">
                        <button
                          onClick={() => {
                            onSelectCollection(collection.id, collection.filters)
                            onSelectView('active')
                          }}
                          className={clsx(
                            'w-full flex items-center gap-2 pl-8 pr-3 py-2 rounded text-sm transition-colors',
                            activeCollectionId === collection.id
                              ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                          )}
                        >
                        <div
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: collection.color }}
                        />
                        <span className="flex-1 text-left truncate">{collection.name}</span>
                        {collection.is_pinned && (
                          <Star className="w-3 h-3 fill-current text-yellow-500" />
                        )}
                      </button>

                      {/* Actions */}
                      <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditingCollectionForModal(collection)
                            setShowCreateModal(true)
                          }}
                          className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
                          title="Edit filters"
                        >
                          <Edit className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            togglePinMutation.mutate({
                              collectionId: collection.id,
                              isPinned: collection.is_pinned
                            })
                          }}
                          className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
                          title={collection.is_pinned ? 'Unpin' : 'Pin'}
                        >
                          <Star className={clsx('w-3 h-3', collection.is_pinned && 'fill-current text-yellow-500')} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            if (confirm(`Delete collection "${collection.name}"?`)) {
                              deleteCollectionMutation.mutate(collection.id)
                            }
                          }}
                          className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded text-red-600 dark:text-red-400"
                          title="Delete collection"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* Edit filters form */}
                    {editingCollectionId === collection.id && (
                      <div className="ml-5 p-2 bg-gray-50 dark:bg-gray-900 rounded space-y-2">
                        <div>
                          <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Status</div>
                          <div className="flex flex-wrap gap-1">
                            {STATUS_OPTIONS.map(status => {
                              const Icon = status.icon
                              return (
                                <button
                                  key={status.value}
                                  onClick={() => toggleStatus(status.value)}
                                  className={clsx(
                                    'px-1.5 py-0.5 rounded text-xs font-medium transition-all flex items-center gap-0.5',
                                    selectedStatuses.includes(status.value)
                                      ? 'bg-primary-600 text-white'
                                      : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                                  )}
                                >
                                  <Icon className="w-2.5 h-2.5" />
                                  <span className="text-[10px]">{status.label}</span>
                                </button>
                              )
                            })}
                          </div>
                        </div>

                        {allTags && allTags.length > 0 && (
                          <div>
                            <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Tags</div>
                            <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                              {allTags.map(tag => (
                                <button
                                  key={tag.id}
                                  onClick={() => toggleTag(tag.id)}
                                  className="px-1.5 py-0.5 rounded text-[10px] font-medium transition-all"
                                  style={{
                                    backgroundColor: selectedTags.includes(tag.id) ? tag.color : tag.color + '30',
                                    color: selectedTags.includes(tag.id) ? '#fff' : tag.color
                                  }}
                                >
                                  {tag.name}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="flex gap-1.5">
                          <Button size="sm" onClick={() => handleSaveEdit(collection.id)} className="flex-1 text-xs py-1">
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingCollectionId(null)
                              setSelectedStatuses([])
                              setSelectedTags([])
                            }}
                            className="flex-1 text-xs py-1"
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                </div>
                ))
              ) : (
                <div className="pl-8 pr-3 py-2 text-xs text-gray-500 dark:text-gray-400 italic">
                  No filtered collections yet
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Create/Edit Collection Modal */}
      <CreateCollectionModal
        isOpen={showCreateModal}
        onClose={() => {
          setShowCreateModal(false)
          setEditingCollectionForModal(null)
        }}
        editingCollection={editingCollectionForModal}
      />

      {/* Create/Edit Team Modal */}
      <CreateTeamModal
        isOpen={showCreateTeamModal}
        onClose={() => {
          setShowCreateTeamModal(false)
          setEditingTeam(null)
        }}
        editingTeam={editingTeam}
      />

      {/* Create Tag Modal */}
      <CreateTagModal
        isOpen={showCreateTagModal}
        onClose={() => setShowCreateTagModal(false)}
      />
    </div>
  )
}
