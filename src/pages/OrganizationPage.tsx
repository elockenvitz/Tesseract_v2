/**
 * OrganizationPage Component
 *
 * Page for viewing and managing organization structure including:
 * - Teams and their members
 * - People across the organization
 * - Portfolios within teams
 * - Access requests (admin only)
 *
 * Non-admins can view but not edit. They can submit access requests.
 */

import React, { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import {
  Building2,
  Users,
  UserCircle,
  Briefcase,
  Bell,
  Settings,
  Plus,
  Edit3,
  Trash2,
  ChevronRight,
  ChevronDown,
  Crown,
  Search,
  UserPlus,
  Mail,
  Check,
  X,
  XCircle,
  Clock,
  FolderOpen,
  MoreHorizontal,
  GripVertical,
  UserX,
  AlertTriangle,
  Shield,
  Phone,
  AtSign,
  ExternalLink,
  LogIn,
  Send
} from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'

interface Organization {
  id: string
  name: string
  slug: string
  description: string | null
  logo_url: string | null
  settings: any
}

interface Team {
  id: string
  organization_id: string
  name: string
  slug: string
  description: string | null
  color: string
  icon: string
  is_active: boolean
  member_count?: number
  portfolio_count?: number
}

interface UserProfile {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
}

interface OrganizationMembership {
  id: string
  organization_id: string
  user_id: string
  is_org_admin: boolean
  title: string | null
  status: string
  user?: UserProfile
}

interface TeamMembership {
  id: string
  team_id: string
  user_id: string
  is_team_admin: boolean
  title: string | null
  user?: UserProfile
  team?: Team
}

interface Portfolio {
  id: string
  name: string
  team_id: string | null
  description: string | null
  portfolio_type: string
  is_active: boolean
}

interface PortfolioMembership {
  id: string
  portfolio_id: string
  user_id: string
  is_portfolio_manager: boolean
  title: string | null
  access_permissions: any
  user?: UserProfile
  portfolio?: Portfolio
}

interface AccessRequest {
  id: string
  organization_id: string
  requester_id: string
  request_type: string
  target_team_id: string | null
  target_portfolio_id: string | null
  requested_title: string | null
  reason: string | null
  status: string
  created_at: string
  requester?: UserProfile
  target_team?: Team
  target_portfolio?: Portfolio
}

interface OrganizationContact {
  id: string
  organization_id: string
  full_name: string
  email: string | null
  phone: string | null
  title: string | null
  department: string | null
  company: string | null
  notes: string | null
  contact_type: 'external' | 'consultant' | 'vendor' | 'client' | 'other'
  receives_reports: boolean
  is_active: boolean
  created_at: string
}

interface RemovalRequest {
  id: string
  organization_id: string
  target_user_id: string
  requested_by: string
  reason: string | null
  status: string
  created_at: string
  target_user?: UserProfile
  requester?: UserProfile
}

type OrgNodeType = 'division' | 'department' | 'team' | 'portfolio' | 'custom'

interface OrgChartNode {
  id: string
  organization_id: string
  parent_id: string | null
  node_type: OrgNodeType
  custom_type_label?: string
  name: string
  description?: string
  color: string
  icon: string
  sort_order: number
  settings: any
  is_active: boolean
  created_at: string
  children?: OrgChartNode[]
}

interface OrgChartNodeMember {
  id: string
  node_id: string
  user_id: string
  role: string
  focus: string | null
  created_at: string
  user?: UserProfile
}

type TabType = 'teams' | 'people' | 'portfolios' | 'requests' | 'settings'

// Loading screen component
function LoadingScreen() {
  return (
    <div className="h-full flex flex-col bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex-shrink-0">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center">
            <Building2 className="w-6 h-6 text-indigo-600" />
          </div>
          <div>
            <div className="h-6 w-32 bg-gray-200 rounded animate-pulse" />
            <div className="h-4 w-48 bg-gray-100 rounded animate-pulse mt-1" />
          </div>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center space-y-3">
          <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-gray-600">Loading organization...</span>
        </div>
      </div>
    </div>
  )
}

// Main content component - only rendered after loading is complete
function OrganizationContent({ isOrgAdmin }: { isOrgAdmin: boolean }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<TabType>('teams')
  const [searchTerm, setSearchTerm] = useState('')
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set())
  const [showAddMemberModal, setShowAddMemberModal] = useState(false)
  const [showRequestModal, setShowRequestModal] = useState(false)
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null)
  const [editingTeam, setEditingTeam] = useState<Team | null>(null)
  // Inline team creation state
  const [isCreatingTeam, setIsCreatingTeam] = useState(false)
  const [newTeamName, setNewTeamName] = useState('')
  const [newTeamDescription, setNewTeamDescription] = useState('')
  const [newTeamColor, setNewTeamColor] = useState('#6366f1')
  const newTeamInputRef = useRef<HTMLInputElement>(null)

  // People tab state
  const [peopleView, setPeopleView] = useState<'users' | 'contacts'>('users')
  const [showAddContactModal, setShowAddContactModal] = useState(false)
  const [showSuspendModal, setShowSuspendModal] = useState<OrganizationMembership | null>(null)
  const [showRemovalRequestModal, setShowRemovalRequestModal] = useState<OrganizationMembership | null>(null)

  // Org chart node state
  const [showAddNodeModal, setShowAddNodeModal] = useState(false)
  const [addNodeParentId, setAddNodeParentId] = useState<string | null>(null)
  const [editingNode, setEditingNode] = useState<OrgChartNode | null>(null)
  const [showAddNodeMemberModal, setShowAddNodeMemberModal] = useState<OrgChartNode | null>(null)

  // Fetch organization data
  const { data: organization } = useQuery({
    queryKey: ['organization'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('*')
        .limit(1)
        .single()

      if (error && error.code !== 'PGRST116') throw error
      return data as Organization | null
    }
  })

  // Fetch teams
  const { data: teams = [] } = useQuery({
    queryKey: ['teams'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teams')
        .select('*')
        .eq('is_active', true)
        .order('name')

      if (error) throw error
      return data as Team[]
    }
  })

  // Fetch all organization members with user profiles (including suspended)
  const { data: orgMembers = [] } = useQuery({
    queryKey: ['organization-members'],
    queryFn: async () => {
      // Fetch memberships
      const { data: memberships, error: membershipsError } = await supabase
        .from('organization_memberships')
        .select('*')
        .in('status', ['active', 'inactive'])

      if (membershipsError) throw membershipsError
      if (!memberships || memberships.length === 0) return []

      // Fetch users for these memberships
      const userIds = memberships.map(m => m.user_id).filter(Boolean)
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .in('id', userIds)

      if (usersError) throw usersError

      // Create a map for quick lookup
      const userMap = new Map((users || []).map(u => [u.id, u]))

      // Join memberships with users
      return memberships.map((m: any) => {
        const user = userMap.get(m.user_id)
        return {
          ...m,
          user: {
            id: user?.id || m.user_id,
            email: user?.email || '',
            full_name: user?.first_name && user?.last_name
              ? `${user.first_name} ${user.last_name}`
              : user?.email?.split('@')[0] || 'Unknown'
          }
        }
      }) as OrganizationMembership[]
    }
  })

  // Fetch team memberships
  const { data: teamMemberships = [] } = useQuery({
    queryKey: ['team-memberships'],
    queryFn: async () => {
      // Fetch team memberships with team data
      const { data: memberships, error: membershipsError } = await supabase
        .from('team_memberships')
        .select(`
          *,
          team:team_id (*)
        `)

      if (membershipsError) throw membershipsError
      if (!memberships || memberships.length === 0) return []

      // Fetch users for these memberships
      const userIds = memberships.map(m => m.user_id).filter(Boolean)
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .in('id', userIds)

      if (usersError) throw usersError

      // Create a map for quick lookup
      const userMap = new Map((users || []).map(u => [u.id, u]))

      // Join memberships with users
      return memberships.map((m: any) => {
        const user = userMap.get(m.user_id)
        return {
          ...m,
          user: {
            id: user?.id || m.user_id,
            email: user?.email || '',
            full_name: user?.first_name && user?.last_name
              ? `${user.first_name} ${user.last_name}`
              : user?.email?.split('@')[0] || 'Unknown'
          }
        }
      }) as TeamMembership[]
    }
  })

  // Fetch portfolios
  const { data: portfolios = [] } = useQuery({
    queryKey: ['portfolios-org'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolios')
        .select('*')
        .order('name')

      if (error) throw error
      return data as Portfolio[]
    }
  })

  // Fetch portfolio memberships
  const { data: portfolioMemberships = [] } = useQuery({
    queryKey: ['portfolio-memberships'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_memberships')
        .select(`
          *,
          user:user_id (
            id,
            email,
            raw_user_meta_data
          ),
          portfolio:portfolio_id (*)
        `)

      if (error) throw error
      return data.map((m: any) => ({
        ...m,
        user: {
          id: m.user?.id,
          email: m.user?.email,
          full_name: m.user?.raw_user_meta_data?.full_name || m.user?.email?.split('@')[0],
          avatar_url: m.user?.raw_user_meta_data?.avatar_url
        }
      })) as PortfolioMembership[]
    }
  })

  // Fetch access requests (admin only)
  const { data: accessRequests = [] } = useQuery({
    queryKey: ['access-requests'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('access_requests')
        .select(`
          *,
          requester:requester_id (
            id,
            email,
            raw_user_meta_data
          ),
          target_team:target_team_id (*),
          target_portfolio:target_portfolio_id (*)
        `)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })

      if (error) throw error
      return data.map((r: any) => ({
        ...r,
        requester: {
          id: r.requester?.id,
          email: r.requester?.email,
          full_name: r.requester?.raw_user_meta_data?.full_name || r.requester?.email?.split('@')[0],
          avatar_url: r.requester?.raw_user_meta_data?.avatar_url
        }
      })) as AccessRequest[]
    },
    enabled: isOrgAdmin
  })

  // Fetch organization contacts (non-login personnel)
  const { data: contacts = [] } = useQuery({
    queryKey: ['organization-contacts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_contacts')
        .select('*')
        .eq('is_active', true)
        .order('full_name')

      if (error) throw error
      return data as OrganizationContact[]
    }
  })

  // Fetch org chart nodes
  const { data: orgChartNodes = [] } = useQuery({
    queryKey: ['org-chart-nodes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_chart_nodes')
        .select('*')
        .eq('is_active', true)
        .order('sort_order')

      if (error) throw error
      return data as OrgChartNode[]
    }
  })

  // Fetch org chart node members
  const { data: orgChartNodeMembers = [] } = useQuery({
    queryKey: ['org-chart-node-members'],
    queryFn: async () => {
      const { data: members, error: membersError } = await supabase
        .from('org_chart_node_members')
        .select('*')

      if (membersError) throw membersError
      if (!members || members.length === 0) return []

      // Fetch user profiles for members
      const userIds = [...new Set(members.map(m => m.user_id))]
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .in('id', userIds)

      if (usersError) throw usersError

      const userMap = new Map((users || []).map(u => [u.id, {
        id: u.id,
        email: u.email,
        full_name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email,
        avatar_url: null
      }]))

      return members.map(m => ({
        ...m,
        user: userMap.get(m.user_id)
      })) as OrgChartNodeMember[]
    }
  })

  // Get members for a specific node
  const getNodeMembers = (nodeId: string) => {
    return orgChartNodeMembers.filter(m => m.node_id === nodeId)
  }

  // Build tree structure from flat nodes
  const buildNodeTree = (nodes: OrgChartNode[], parentId: string | null = null): OrgChartNode[] => {
    return nodes
      .filter(node => node.parent_id === parentId)
      .map(node => ({
        ...node,
        children: buildNodeTree(nodes, node.id)
      }))
      .sort((a, b) => a.sort_order - b.sort_order)
  }

  const nodeTree = buildNodeTree(orgChartNodes)

  // Focus the input when creating a new team
  useEffect(() => {
    if (isCreatingTeam && newTeamInputRef.current) {
      newTeamInputRef.current.focus()
    }
  }, [isCreatingTeam])

  // Mutations
  const createTeamMutation = useMutation({
    mutationFn: async (teamData: { name: string; description: string; color: string }) => {
      if (!organization) throw new Error('No organization found')
      const slug = teamData.name.toLowerCase().replace(/\s+/g, '-')
      const { data, error } = await supabase
        .from('teams')
        .insert({
          organization_id: organization.id,
          name: teamData.name,
          slug,
          description: teamData.description,
          color: teamData.color,
          created_by: user?.id
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      // Reset inline form
      setIsCreatingTeam(false)
      setNewTeamName('')
      setNewTeamDescription('')
      setNewTeamColor('#6366f1')
      // Auto-expand the new team
      if (data?.id) {
        setExpandedTeams(prev => new Set([...prev, data.id]))
      }
    }
  })

  const updateTeamMutation = useMutation({
    mutationFn: async (teamData: { id: string; name: string; description: string; color: string }) => {
      const { data, error } = await supabase
        .from('teams')
        .update({
          name: teamData.name,
          description: teamData.description,
          color: teamData.color
        })
        .eq('id', teamData.id)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      setEditingTeam(null)
    }
  })

  const deleteTeamMutation = useMutation({
    mutationFn: async (teamId: string) => {
      const { error } = await supabase
        .from('teams')
        .update({ is_active: false })
        .eq('id', teamId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] })
    }
  })

  const addTeamMemberMutation = useMutation({
    mutationFn: async ({ teamId, userId, isAdmin }: { teamId: string; userId: string; isAdmin: boolean }) => {
      const { data, error } = await supabase
        .from('team_memberships')
        .insert({
          team_id: teamId,
          user_id: userId,
          is_team_admin: isAdmin
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-memberships'] })
    }
  })

  const removeTeamMemberMutation = useMutation({
    mutationFn: async (membershipId: string) => {
      const { error } = await supabase
        .from('team_memberships')
        .delete()
        .eq('id', membershipId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-memberships'] })
    }
  })

  const handleAccessRequestMutation = useMutation({
    mutationFn: async ({ requestId, status, notes }: { requestId: string; status: 'approved' | 'rejected'; notes?: string }) => {
      const { error } = await supabase
        .from('access_requests')
        .update({
          status,
          reviewed_by: user?.id,
          reviewed_at: new Date().toISOString(),
          review_notes: notes
        })
        .eq('id', requestId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['access-requests'] })
    }
  })

  const submitAccessRequestMutation = useMutation({
    mutationFn: async (requestData: {
      request_type: string
      target_team_id?: string
      target_portfolio_id?: string
      requested_title?: string
      reason?: string
    }) => {
      if (!organization) throw new Error('No organization found')
      const { data, error } = await supabase
        .from('access_requests')
        .insert({
          organization_id: organization.id,
          requester_id: user?.id,
          ...requestData
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      setShowRequestModal(false)
    }
  })

  // Create organization contact mutation
  const createContactMutation = useMutation({
    mutationFn: async (contactData: {
      full_name: string
      email?: string
      phone?: string
      title?: string
      department?: string
      company?: string
      notes?: string
      contact_type: string
      receives_reports: boolean
    }) => {
      if (!organization) throw new Error('No organization found')
      const { data, error } = await supabase
        .from('organization_contacts')
        .insert({
          organization_id: organization.id,
          ...contactData,
          created_by: user?.id
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-contacts'] })
      setShowAddContactModal(false)
    }
  })

  // Suspend user mutation
  const suspendUserMutation = useMutation({
    mutationFn: async ({ membershipId, reason }: { membershipId: string; reason: string }) => {
      const { error } = await supabase
        .from('organization_memberships')
        .update({
          status: 'inactive',
          suspended_at: new Date().toISOString(),
          suspended_by: user?.id,
          suspension_reason: reason
        })
        .eq('id', membershipId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-members'] })
      setShowSuspendModal(null)
    }
  })

  // Unsuspend user mutation
  const unsuspendUserMutation = useMutation({
    mutationFn: async (membershipId: string) => {
      const { error } = await supabase
        .from('organization_memberships')
        .update({
          status: 'active',
          suspended_at: null,
          suspended_by: null,
          suspension_reason: null
        })
        .eq('id', membershipId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-members'] })
    }
  })

  // Submit removal request mutation (sends email to account team)
  const submitRemovalRequestMutation = useMutation({
    mutationFn: async ({ targetUserId, reason }: { targetUserId: string; reason: string }) => {
      if (!organization) throw new Error('No organization found')
      const { data, error } = await supabase
        .from('removal_requests')
        .insert({
          organization_id: organization.id,
          target_user_id: targetUserId,
          requested_by: user?.id,
          reason
        })
        .select()
        .single()

      if (error) throw error

      // TODO: Trigger email to account team via edge function
      return data
    },
    onSuccess: () => {
      setShowRemovalRequestModal(null)
    }
  })

  // Delete contact mutation
  const deleteContactMutation = useMutation({
    mutationFn: async (contactId: string) => {
      const { error } = await supabase
        .from('organization_contacts')
        .update({ is_active: false })
        .eq('id', contactId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-contacts'] })
    }
  })

  // Create org chart node mutation
  const createNodeMutation = useMutation({
    mutationFn: async (nodeData: {
      parent_id: string | null
      node_type: OrgNodeType
      custom_type_label?: string
      name: string
      description?: string
      color: string
      icon: string
      portfolio_id?: string
    }) => {
      if (!organization) throw new Error('No organization found')

      // Get max sort_order for siblings
      let siblingsQuery = supabase
        .from('org_chart_nodes')
        .select('sort_order')
        .eq('organization_id', organization.id)

      // Handle null parent_id correctly
      if (nodeData.parent_id === null) {
        siblingsQuery = siblingsQuery.is('parent_id', null)
      } else {
        siblingsQuery = siblingsQuery.eq('parent_id', nodeData.parent_id)
      }

      const { data: siblings } = await siblingsQuery
        .order('sort_order', { ascending: false })
        .limit(1)

      const nextSortOrder = siblings && siblings.length > 0 ? siblings[0].sort_order + 1 : 0

      // Check if parent_id is a team reference (format: "team:uuid")
      let actualParentId: string | null = null
      let teamId: string | null = null

      if (nodeData.parent_id && typeof nodeData.parent_id === 'string' && nodeData.parent_id.startsWith('team:')) {
        // This is a team reference - store team_id in settings, not as parent_id
        teamId = nodeData.parent_id.replace('team:', '')
      } else if (nodeData.parent_id) {
        actualParentId = nodeData.parent_id
      }

      // Build the insert data
      const insertData: any = {
        organization_id: organization.id,
        node_type: nodeData.node_type,
        name: nodeData.name,
        color: nodeData.color,
        icon: nodeData.icon,
        sort_order: nextSortOrder,
        created_by: user?.id
      }

      // Only include parent_id if it's a valid org_chart_node reference
      if (actualParentId) {
        insertData.parent_id = actualParentId
      }

      // Only include optional fields if they have values
      if (nodeData.custom_type_label) {
        insertData.custom_type_label = nodeData.custom_type_label
      }
      if (nodeData.description) {
        insertData.description = nodeData.description
      }

      // Build settings object
      const settings: any = {}
      if (nodeData.portfolio_id) {
        settings.portfolio_id = nodeData.portfolio_id
      }
      if (teamId) {
        settings.team_id = teamId
      }
      if (Object.keys(settings).length > 0) {
        insertData.settings = settings
      }

      const { data, error } = await supabase
        .from('org_chart_nodes')
        .insert(insertData)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-chart-nodes'] })
      setShowAddNodeModal(false)
      setAddNodeParentId(null)
    },
    onError: (error) => {
      console.error('Error creating org chart node:', error)
      alert(`Failed to create node: ${error.message}`)
    }
  })

  // Update org chart node mutation
  const updateNodeMutation = useMutation({
    mutationFn: async (nodeData: {
      id: string
      name: string
      description?: string
      color: string
      icon: string
      custom_type_label?: string
    }) => {
      const { data, error } = await supabase
        .from('org_chart_nodes')
        .update({
          name: nodeData.name,
          description: nodeData.description,
          color: nodeData.color,
          icon: nodeData.icon,
          custom_type_label: nodeData.custom_type_label,
          updated_at: new Date().toISOString()
        })
        .eq('id', nodeData.id)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-chart-nodes'] })
      setEditingNode(null)
    }
  })

  // Delete org chart node mutation
  const deleteNodeMutation = useMutation({
    mutationFn: async (nodeId: string) => {
      const { error } = await supabase
        .from('org_chart_nodes')
        .update({ is_active: false })
        .eq('id', nodeId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-chart-nodes'] })
    }
  })

  // Add member to org chart node mutation
  const addNodeMemberMutation = useMutation({
    mutationFn: async (memberData: { node_id: string; user_id: string; role: string; focus?: string }) => {
      const { data, error } = await supabase
        .from('org_chart_node_members')
        .insert({
          node_id: memberData.node_id,
          user_id: memberData.user_id,
          role: memberData.role,
          focus: memberData.focus || null,
          created_by: user?.id
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-chart-node-members'] })
    },
    onError: (error: any) => {
      alert(`Failed to add member: ${error.message}`)
    }
  })

  // Remove member from org chart node mutation
  const removeNodeMemberMutation = useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await supabase
        .from('org_chart_node_members')
        .delete()
        .eq('id', memberId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-chart-node-members'] })
    }
  })

  const toggleTeamExpanded = (teamId: string) => {
    setExpandedTeams(prev => {
      const next = new Set(prev)
      if (next.has(teamId)) {
        next.delete(teamId)
      } else {
        next.add(teamId)
      }
      return next
    })
  }

  const getTeamMembers = (teamId: string) => {
    return teamMemberships.filter(tm => tm.team_id === teamId)
  }

  const getTeamPortfolios = (teamId: string) => {
    return portfolios.filter(p => p.team_id === teamId)
  }

  // Get org chart nodes that belong to a specific team (stored in settings.team_id)
  const getTeamChildNodes = (teamId: string) => {
    return orgChartNodes.filter(node =>
      node.settings?.team_id === teamId && node.is_active
    )
  }

  const getPortfolioMembers = (portfolioId: string) => {
    return portfolioMemberships.filter(pm => pm.portfolio_id === portfolioId)
  }

  const getUserTeams = (userId: string) => {
    return teamMemberships.filter(tm => tm.user_id === userId)
  }

  const getUserPortfolios = (userId: string) => {
    return portfolioMemberships.filter(pm => pm.user_id === userId)
  }

  const filteredTeams = teams.filter(t =>
    t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.description?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const filteredMembers = orgMembers.filter(m =>
    m.user?.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    m.user?.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    m.title?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const filteredPortfolios = portfolios.filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.description?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const filteredContacts = contacts.filter(c =>
    c.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.company?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.title?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  // Separate active and suspended members
  const activeMembers = filteredMembers.filter(m => m.status === 'active')
  const suspendedMembers = filteredMembers.filter(m => m.status === 'inactive')

  const tabs: { id: TabType; label: string; icon: React.ReactNode; adminOnly?: boolean }[] = [
    { id: 'teams', label: 'Teams', icon: <Users className="w-4 h-4" /> },
    { id: 'people', label: 'People', icon: <UserCircle className="w-4 h-4" /> },
    { id: 'portfolios', label: 'Portfolios', icon: <Briefcase className="w-4 h-4" /> },
    { id: 'requests', label: 'Requests', icon: <Bell className="w-4 h-4" />, adminOnly: true },
    { id: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4" />, adminOnly: true }
  ]

  const visibleTabs = tabs.filter(t => !t.adminOnly || isOrgAdmin)

  const handleCreateInlineTeam = () => {
    if (!newTeamName.trim()) return
    createTeamMutation.mutate({
      name: newTeamName.trim(),
      description: newTeamDescription.trim(),
      color: newTeamColor
    })
  }

  const cancelInlineTeamCreation = () => {
    setIsCreatingTeam(false)
    setNewTeamName('')
    setNewTeamDescription('')
    setNewTeamColor('#6366f1')
  }

  const teamColors = ['#3b82f6', '#10b981', '#8b5cf6', '#ef4444', '#f97316', '#ec4899', '#6366f1', '#14b8a6']

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center">
              <Building2 className="w-6 h-6 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">
                {organization?.name || 'Organization'}
              </h1>
              <p className="text-sm text-gray-500">
                {orgMembers.length} members · {teams.length} teams · {portfolios.length} portfolios
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            {isOrgAdmin && activeTab === 'people' && (
              <Button onClick={() => setShowAddContactModal(true)}>
                <UserPlus className="w-4 h-4 mr-2" />
                Add Person
              </Button>
            )}
            {!isOrgAdmin && (
              <Button
                variant="outline"
                onClick={() => setShowRequestModal(true)}
              >
                <Mail className="w-4 h-4 mr-2" />
                Request Access
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 px-6 flex-shrink-0">
        <div className="flex space-x-1">
          {visibleTabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center space-x-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {tab.id === 'requests' && accessRequests.length > 0 && (
                <span className="ml-1 px-2 py-0.5 text-xs bg-red-100 text-red-600 rounded-full">
                  {accessRequests.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Search Bar */}
      {['people', 'portfolios'].includes(activeTab) && (
        <div className="bg-white px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder={`Search ${activeTab}...`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
            />
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className={activeTab === 'people' ? '' : 'max-w-5xl mx-auto'}>
          {/* Teams Tab - Interactive Org Chart */}
          {activeTab === 'teams' && (
            <div>
              {/* Org Chart Header - Organization Root Node */}
              <div className="flex flex-col items-center">
                <div className="relative group/org">
                  {/* Hover overlay for admin - Add button */}
                  {isOrgAdmin && (
                    <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 opacity-0 group-hover/org:opacity-100 transition-all duration-200 z-10">
                      <button
                        onClick={() => {
                          setAddNodeParentId(null)
                          setShowAddNodeModal(true)
                        }}
                        className="flex items-center space-x-1 px-2.5 py-1 bg-indigo-600 text-white text-xs font-medium rounded-full shadow-lg hover:bg-indigo-700 transition-colors whitespace-nowrap"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Add</span>
                      </button>
                    </div>
                  )}

                  {/* Root Node Card */}
                  <div className="bg-white border-2 border-indigo-300 rounded-xl shadow-sm px-6 py-4 text-center min-w-[200px]">
                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-100 mb-2">
                      <Building2 className="w-6 h-6 text-indigo-600" />
                    </div>
                    <h3 className="font-semibold text-gray-900">{organization?.name || 'Organization'}</h3>
                    <p className="text-xs text-gray-500 mt-0.5">{orgMembers.length} members · {teams.length} teams</p>
                  </div>
                </div>

                {/* Vertical connector from root to horizontal line */}
                {(filteredTeams.length > 0 || nodeTree.length > 0 || isCreatingTeam) && (
                  <div className="w-0.5 h-8 bg-gray-300" />
                )}
              </div>

              {/* Children container with proper connectors */}
              {(filteredTeams.length > 0 || nodeTree.length > 0 || isCreatingTeam) && (
                <div className="flex flex-col items-center">
                  {/* Horizontal connector line - calculate based on actual children */}
                  {(() => {
                    const childCount = filteredTeams.length + nodeTree.length + (isCreatingTeam ? 1 : 0)
                    if (childCount <= 1) return null
                    return (
                      <div
                        className="h-0.5 bg-gray-300"
                        style={{
                          width: `${(childCount - 1) * 240}px`,
                          maxWidth: '90vw'
                        }}
                      />
                    )
                  })()}

                  {/* Children nodes with vertical connectors */}
                  <div className="flex flex-wrap justify-center gap-x-5">
                    {/* Inline Team Creation Card */}
                    {isCreatingTeam && (
                      <div className="flex flex-col items-center">
                        {/* Vertical connector from horizontal line */}
                        <div className="w-0.5 h-8 bg-gray-300" />
                        <div className="bg-white border-2 border-indigo-300 rounded-xl shadow-md p-4 w-[220px]">
                          <div className="flex items-center space-x-2 mb-3">
                            <div
                              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                              style={{ backgroundColor: `${newTeamColor}20` }}
                            >
                              <Users className="w-4 h-4" style={{ color: newTeamColor }} />
                            </div>
                            <input
                              ref={newTeamInputRef}
                              type="text"
                              value={newTeamName}
                              onChange={(e) => setNewTeamName(e.target.value)}
                              placeholder="Team name"
                              className="flex-1 px-2 py-1 text-sm font-medium border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleCreateInlineTeam()
                                if (e.key === 'Escape') cancelInlineTeamCreation()
                              }}
                            />
                          </div>
                          <textarea
                            value={newTeamDescription}
                            onChange={(e) => setNewTeamDescription(e.target.value)}
                            placeholder="Description (optional)"
                            className="w-full px-2 py-1 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent mb-3"
                            rows={2}
                          />
                          <div className="mb-3">
                            <div className="flex flex-wrap gap-1.5 justify-center">
                              {teamColors.map(c => (
                                <button
                                  key={c}
                                  onClick={() => setNewTeamColor(c)}
                                  className={`w-5 h-5 rounded-full border-2 transition-transform ${
                                    newTeamColor === c ? 'border-gray-800 scale-110' : 'border-transparent hover:scale-105'
                                  }`}
                                  style={{ backgroundColor: c }}
                                />
                              ))}
                            </div>
                          </div>
                          <div className="flex items-center justify-end space-x-2">
                            <button
                              onClick={cancelInlineTeamCreation}
                              className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={handleCreateInlineTeam}
                              disabled={!newTeamName.trim() || createTeamMutation.isPending}
                              className="px-3 py-1 text-xs font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                            >
                              {createTeamMutation.isPending ? 'Creating...' : 'Create'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Team Cards */}
                    {filteredTeams.map(team => {
                      const members = getTeamMembers(team.id)
                      const teamPortfolios = getTeamPortfolios(team.id)
                      const isExpanded = expandedTeams.has(team.id)
                      const teamAdmins = members.filter(m => m.is_team_admin)

                      return (
                        <div key={team.id} className="flex flex-col items-center group/card">
                          {/* Vertical connector from horizontal line */}
                          <div className="w-0.5 h-8 bg-gray-300" />
                          <div className="relative">
                            {/* Hover overlay actions for admins */}
                            {isOrgAdmin && (
                              <div className="absolute top-2 right-2 opacity-0 group-hover/card:opacity-100 transition-all duration-200 z-10 flex items-center space-x-1">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setEditingTeam(team)
                                  }}
                                  className="p-1.5 bg-white rounded-md shadow-sm hover:bg-gray-50 transition-colors"
                                  title="Edit team"
                                >
                                  <Edit3 className="w-3.5 h-3.5 text-gray-500" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    // Use team's org_chart_node_id if available, otherwise pass team_id specially
                                    setAddNodeParentId(team.org_chart_node_id || `team:${team.id}`)
                                    setShowAddNodeModal(true)
                                  }}
                                  className="p-1.5 bg-white rounded-md shadow-sm hover:bg-gray-50 transition-colors"
                                  title="Add child node"
                                >
                                  <Plus className="w-3.5 h-3.5 text-gray-500" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    if (confirm(`Are you sure you want to delete "${team.name}"?`)) {
                                      deleteTeamMutation.mutate(team.id)
                                    }
                                  }}
                                  className="p-1.5 bg-white rounded-md shadow-sm hover:bg-red-50 transition-colors"
                                  title="Delete team"
                                >
                                  <Trash2 className="w-3.5 h-3.5 text-red-400" />
                                </button>
                              </div>
                            )}

                            {/* Team Node Card */}
                            <div
                              className={`bg-white border-2 rounded-xl shadow-sm cursor-pointer transition-all hover:shadow-md w-[220px] ${
                                isExpanded ? 'border-gray-300' : 'border-gray-200'
                              }`}
                              style={{ borderTopColor: team.color, borderTopWidth: '3px' }}
                              onClick={() => toggleTeamExpanded(team.id)}
                            >
                              <div className="p-4 text-center">
                                {/* Icon */}
                                <div
                                  className="inline-flex items-center justify-center w-10 h-10 rounded-xl mb-2"
                                  style={{ backgroundColor: `${team.color}20` }}
                                >
                                  <Users className="w-5 h-5" style={{ color: team.color }} />
                                </div>

                                {/* Name */}
                                <h4 className="font-semibold text-gray-900 text-sm">{team.name}</h4>
                                <p className="text-xs text-gray-500 mt-0.5">
                                  {members.length} member{members.length !== 1 ? 's' : ''} · {teamPortfolios.length} portfolio{teamPortfolios.length !== 1 ? 's' : ''}
                                </p>

                                {/* Expand indicator */}
                                <div className="mt-2">
                                  {isExpanded ? (
                                    <ChevronDown className="w-4 h-4 text-gray-400 mx-auto" />
                                  ) : (
                                    <ChevronRight className="w-4 h-4 text-gray-400 mx-auto" />
                                  )}
                                </div>
                              </div>

                              {/* Expanded Content */}
                              {isExpanded && (
                                <div className="border-t border-gray-100 p-3 bg-gray-50 rounded-b-xl">
                                  {/* Description */}
                                  {team.description && (
                                    <p className="text-xs text-gray-600 mb-3">{team.description}</p>
                                  )}

                                  {/* Members Section */}
                                  <div>
                                    <div className="flex items-center justify-between mb-2">
                                      <span className="text-xs font-medium text-gray-500">Members</span>
                                      {isOrgAdmin && (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            setSelectedTeam(team)
                                            setShowAddMemberModal(true)
                                          }}
                                          className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center"
                                        >
                                          <UserPlus className="w-3 h-3 mr-0.5" />
                                          Add
                                        </button>
                                      )}
                                    </div>

                                    {members.length === 0 ? (
                                      <p className="text-xs text-gray-400 italic">No members yet</p>
                                    ) : (
                                      <div className="flex flex-wrap gap-1">
                                        {members.map(member => (
                                          <div
                                            key={member.id}
                                            className="flex items-center space-x-1 px-2 py-1 bg-white rounded text-xs group/member"
                                          >
                                            <div
                                              className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-medium text-white flex-shrink-0"
                                              style={{ backgroundColor: team.color }}
                                            >
                                              {member.user?.full_name?.charAt(0) || '?'}
                                            </div>
                                            <span className="text-gray-700 truncate max-w-[60px]">
                                              {member.user?.full_name}
                                            </span>
                                            {member.is_team_admin && (
                                              <Crown className="w-2.5 h-2.5 text-amber-500 flex-shrink-0" />
                                            )}
                                            {isOrgAdmin && (
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  removeTeamMemberMutation.mutate(member.id)
                                                }}
                                                className="opacity-0 group-hover/member:opacity-100 hover:text-red-500 transition-opacity"
                                              >
                                                <X className="w-2.5 h-2.5" />
                                              </button>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>

                                  {/* Portfolios Section */}
                                  {teamPortfolios.length > 0 && (
                                    <div className="mt-3 pt-3 border-t border-gray-200">
                                      <span className="text-xs font-medium text-gray-500 mb-1.5 block">Portfolios</span>
                                      <div className="flex flex-wrap gap-1">
                                        {teamPortfolios.map(portfolio => (
                                          <div
                                            key={portfolio.id}
                                            className="flex items-center space-x-1 px-2 py-1 bg-white rounded text-xs"
                                          >
                                            <FolderOpen className="w-3 h-3 text-green-500" />
                                            <span className="text-gray-700">{portfolio.name}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Child nodes for this team */}
                          {(() => {
                            const teamChildNodes = getTeamChildNodes(team.id)
                            if (teamChildNodes.length === 0) return null

                            return (
                              <div className="flex flex-col items-center mt-0">
                                {/* Vertical connector down from team */}
                                <div className="w-0.5 h-8 bg-gray-300" />

                                {/* Horizontal connector spanning children */}
                                {teamChildNodes.length > 1 && (
                                  <div
                                    className="h-0.5 bg-gray-300"
                                    style={{ width: `${(teamChildNodes.length - 1) * 240}px`, maxWidth: '90vw' }}
                                  />
                                )}

                                {/* Child nodes with vertical connectors */}
                                <div className="flex flex-wrap gap-x-5 justify-center">
                                  {teamChildNodes.map(childNode => (
                                    <div key={childNode.id} className="flex flex-col items-center">
                                      {/* Vertical connector from horizontal line */}
                                      <div className="w-0.5 h-8 bg-gray-300" />
                                      <OrgChartNodeCard
                                        node={childNode}
                                        isOrgAdmin={isOrgAdmin}
                                        onEdit={(n) => setEditingNode(n)}
                                        onAddChild={(parentId) => {
                                          setAddNodeParentId(parentId)
                                          setShowAddNodeModal(true)
                                        }}
                                        onDelete={(nodeId) => {
                                          if (confirm(`Are you sure you want to delete this node?`)) {
                                            deleteNodeMutation.mutate(nodeId)
                                          }
                                        }}
                                        onAddMember={(n) => setShowAddNodeMemberModal(n)}
                                        onRemoveMember={(memberId) => removeNodeMemberMutation.mutate(memberId)}
                                        getNodeMembers={getNodeMembers}
                                      />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )
                          })()}
                        </div>
                      )
                    })}

                    {/* Org Chart Nodes - hierarchical structure */}
                    {nodeTree.map(node => (
                      <div key={node.id} className="flex flex-col items-center">
                        {/* Vertical connector from horizontal line */}
                        <div className="w-0.5 h-8 bg-gray-300" />
                        <OrgChartNodeCard
                          node={node}
                          isOrgAdmin={isOrgAdmin}
                          onEdit={(n) => setEditingNode(n)}
                          onAddChild={(parentId) => {
                            setAddNodeParentId(parentId)
                            setShowAddNodeModal(true)
                          }}
                          onDelete={(nodeId) => {
                            if (confirm(`Are you sure you want to delete this ${node.node_type}?`)) {
                              deleteNodeMutation.mutate(nodeId)
                            }
                          }}
                          onAddMember={(n) => setShowAddNodeMemberModal(n)}
                          onRemoveMember={(memberId) => removeNodeMemberMutation.mutate(memberId)}
                          getNodeMembers={getNodeMembers}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Empty State - shown when no teams and not creating */}
              {filteredTeams.length === 0 && !isCreatingTeam && nodeTree.length === 0 && (
                <div className="flex justify-center mt-8">
                  <div className="text-center py-8 px-12 bg-white rounded-lg border border-dashed border-gray-300">
                    <Users className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                    <h3 className="text-sm font-medium text-gray-900 mb-1">No teams yet</h3>
                    <p className="text-xs text-gray-500 mb-3">
                      {isOrgAdmin ? 'Create your first team or organization node' : 'No teams have been created yet'}
                    </p>
                    {isOrgAdmin && (
                      <button
                        onClick={() => setIsCreatingTeam(true)}
                        className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                      >
                        <Plus className="w-3 h-3 inline mr-1" />
                        Create Team
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* People Tab */}
          {activeTab === 'people' && (
            <div className="space-y-6">
              {/* View Toggle */}
              <div className="flex items-center space-x-2 justify-start">
                <button
                  onClick={() => setPeopleView('users')}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                    peopleView === 'users'
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    <LogIn className="w-4 h-4" />
                    <span>Tesseract Users</span>
                    <span className="px-1.5 py-0.5 text-xs bg-white rounded-full">
                      {activeMembers.length}
                    </span>
                  </div>
                </button>
                <button
                  onClick={() => setPeopleView('contacts')}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                    peopleView === 'contacts'
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    <AtSign className="w-4 h-4" />
                    <span>Contacts</span>
                    <span className="px-1.5 py-0.5 text-xs bg-white rounded-full">
                      {filteredContacts.length}
                    </span>
                  </div>
                </button>
              </div>

              {/* Users View */}
              {peopleView === 'users' && (
                <div className="space-y-6">
                  {/* Active Users */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium text-gray-700 flex items-center">
                      <Shield className="w-4 h-4 mr-1.5 text-green-500" />
                      Active Users ({activeMembers.length})
                    </h3>
                    {activeMembers.length === 0 ? (
                      <div className="text-center py-8 bg-gray-50 rounded-lg">
                        <UserCircle className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                        <p className="text-sm text-gray-500">No active users match your search</p>
                      </div>
                    ) : (
                      <div className="grid gap-3">
                        {activeMembers.map(member => {
                          const userTeams = getUserTeams(member.user_id)
                          const userPortfolios = getUserPortfolios(member.user_id)

                          return (
                            <Card key={member.id} className="p-4">
                              <div className="flex items-start justify-between">
                                <div className="flex items-start space-x-3">
                                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-400 to-indigo-600 flex items-center justify-center text-sm font-medium text-white">
                                    {member.user?.full_name?.charAt(0) || '?'}
                                  </div>
                                  <div className="flex-1">
                                    <div className="flex items-center space-x-2 flex-wrap">
                                      <span className="font-medium text-gray-900">{member.user?.full_name}</span>
                                      {member.is_org_admin && (
                                        <span className="px-2 py-0.5 text-xs bg-indigo-100 text-indigo-700 rounded-full flex items-center">
                                          <Crown className="w-3 h-3 mr-1" />
                                          Org Admin
                                        </span>
                                      )}
                                      <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-full flex items-center">
                                        <LogIn className="w-3 h-3 mr-1" />
                                        Platform Access
                                      </span>
                                    </div>
                                    <p className="text-sm text-gray-500">{member.user?.email}</p>
                                    {member.title && (
                                      <p className="text-sm text-gray-600 mt-1">{member.title}</p>
                                    )}

                                    {/* Team Roles */}
                                    {userTeams.length > 0 && (
                                      <div className="mt-3">
                                        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Team Roles</span>
                                        <div className="flex flex-wrap gap-1 mt-1">
                                          {userTeams.map(tm => (
                                            <span
                                              key={tm.id}
                                              className="px-2 py-1 text-xs rounded-md flex items-center"
                                              style={{
                                                backgroundColor: `${tm.team?.color || '#6366f1'}15`,
                                                color: tm.team?.color || '#6366f1'
                                              }}
                                            >
                                              <Users className="w-3 h-3 mr-1" />
                                              {tm.team?.name}
                                              {tm.is_team_admin && (
                                                <Crown className="w-3 h-3 ml-1 text-amber-500" />
                                              )}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                    {/* Portfolio Access */}
                                    {userPortfolios.length > 0 && (
                                      <div className="mt-2">
                                        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Portfolios</span>
                                        <div className="flex flex-wrap gap-1 mt-1">
                                          {userPortfolios.map(pm => (
                                            <span
                                              key={pm.id}
                                              className="px-2 py-0.5 text-xs bg-green-50 text-green-700 rounded-md flex items-center"
                                            >
                                              <Briefcase className="w-3 h-3 mr-1" />
                                              {pm.portfolio?.name}
                                              {pm.is_portfolio_manager && ' (PM)'}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* Admin Actions */}
                                {isOrgAdmin && member.user_id !== user?.id && (
                                  <div className="flex items-center space-x-1">
                                    <button
                                      onClick={() => setShowSuspendModal(member)}
                                      className="p-2 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                                      title="Suspend access"
                                    >
                                      <UserX className="w-4 h-4" />
                                    </button>
                                    <button
                                      onClick={() => setShowRemovalRequestModal(member)}
                                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                      title="Request removal"
                                    >
                                      <Send className="w-4 h-4" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            </Card>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {/* Suspended Users */}
                  {suspendedMembers.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-sm font-medium text-gray-700 flex items-center">
                        <AlertTriangle className="w-4 h-4 mr-1.5 text-amber-500" />
                        Suspended Users ({suspendedMembers.length})
                      </h3>
                      <div className="grid gap-3">
                        {suspendedMembers.map(member => (
                          <Card key={member.id} className="p-4 bg-amber-50 border-amber-200">
                            <div className="flex items-start justify-between">
                              <div className="flex items-start space-x-3">
                                <div className="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center text-sm font-medium text-gray-500">
                                  {member.user?.full_name?.charAt(0) || '?'}
                                </div>
                                <div>
                                  <div className="flex items-center space-x-2">
                                    <span className="font-medium text-gray-700">{member.user?.full_name}</span>
                                    <span className="px-2 py-0.5 text-xs bg-amber-200 text-amber-800 rounded-full">
                                      Suspended
                                    </span>
                                  </div>
                                  <p className="text-sm text-gray-500">{member.user?.email}</p>
                                </div>
                              </div>
                              {isOrgAdmin && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => unsuspendUserMutation.mutate(member.id)}
                                  disabled={unsuspendUserMutation.isPending}
                                >
                                  <Shield className="w-3 h-3 mr-1" />
                                  Restore
                                </Button>
                              )}
                            </div>
                          </Card>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Contacts View */}
              {peopleView === 'contacts' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-gray-700 flex items-center">
                      <AtSign className="w-4 h-4 mr-1.5 text-indigo-500" />
                      Organization Contacts
                    </h3>
                    {isOrgAdmin && (
                      <Button size="sm" onClick={() => setShowAddContactModal(true)}>
                        <Plus className="w-3 h-3 mr-1" />
                        Add Contact
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">
                    People who don't have platform access but receive reports or communications.
                  </p>

                  {filteredContacts.length === 0 ? (
                    <div className="text-center py-12 bg-gray-50 rounded-lg">
                      <AtSign className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                      <h3 className="text-lg font-medium text-gray-900 mb-2">No contacts yet</h3>
                      <p className="text-sm text-gray-500 mb-4">
                        Add external contacts who need to receive reports or communications
                      </p>
                      {isOrgAdmin && (
                        <Button onClick={() => setShowAddContactModal(true)}>
                          <Plus className="w-4 h-4 mr-2" />
                          Add First Contact
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="grid gap-3">
                      {filteredContacts.map(contact => (
                        <Card key={contact.id} className="p-4">
                          <div className="flex items-start justify-between">
                            <div className="flex items-start space-x-3">
                              <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-sm font-medium text-gray-500">
                                {contact.full_name.charAt(0)}
                              </div>
                              <div>
                                <div className="flex items-center space-x-2">
                                  <span className="font-medium text-gray-900">{contact.full_name}</span>
                                  <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full capitalize">
                                    {contact.contact_type}
                                  </span>
                                  {contact.receives_reports && (
                                    <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full flex items-center">
                                      <Mail className="w-3 h-3 mr-1" />
                                      Receives Reports
                                    </span>
                                  )}
                                </div>
                                {contact.title && contact.company && (
                                  <p className="text-sm text-gray-600">{contact.title} at {contact.company}</p>
                                )}
                                {contact.title && !contact.company && (
                                  <p className="text-sm text-gray-600">{contact.title}</p>
                                )}
                                <div className="flex items-center space-x-4 mt-2 text-sm text-gray-500">
                                  {contact.email && (
                                    <span className="flex items-center">
                                      <Mail className="w-3 h-3 mr-1" />
                                      {contact.email}
                                    </span>
                                  )}
                                  {contact.phone && (
                                    <span className="flex items-center">
                                      <Phone className="w-3 h-3 mr-1" />
                                      {contact.phone}
                                    </span>
                                  )}
                                </div>
                                {contact.notes && (
                                  <p className="text-sm text-gray-500 mt-2 italic">"{contact.notes}"</p>
                                )}
                              </div>
                            </div>
                            {isOrgAdmin && (
                              <button
                                onClick={() => {
                                  if (confirm(`Remove ${contact.full_name} from contacts?`)) {
                                    deleteContactMutation.mutate(contact.id)
                                  }
                                }}
                                className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                title="Remove contact"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Portfolios Tab */}
          {activeTab === 'portfolios' && (
            <div className="space-y-3">
              {filteredPortfolios.length === 0 ? (
                <div className="text-center py-12">
                  <Briefcase className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No portfolios found</h3>
                  <p className="text-sm text-gray-500">No portfolios match your search</p>
                </div>
              ) : (
                filteredPortfolios.map(portfolio => {
                  const members = getPortfolioMembers(portfolio.id)
                  const team = teams.find(t => t.id === portfolio.team_id)

                  return (
                    <Card key={portfolio.id} className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-start space-x-3">
                          <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                            <Briefcase className="w-5 h-5 text-green-600" />
                          </div>
                          <div>
                            <h3 className="font-medium text-gray-900">{portfolio.name}</h3>
                            {portfolio.description && (
                              <p className="text-sm text-gray-500">{portfolio.description}</p>
                            )}
                            <div className="flex items-center space-x-2 mt-2">
                              {team && (
                                <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full">
                                  {team.name}
                                </span>
                              )}
                              <span className="text-xs text-gray-500">
                                {members.length} members
                              </span>
                            </div>
                            {members.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {members.map(m => (
                                  <span
                                    key={m.id}
                                    className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full"
                                  >
                                    {m.user?.full_name}
                                    {m.is_portfolio_manager && ' (PM)'}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </Card>
                  )
                })
              )}
            </div>
          )}

          {/* Access Requests Tab (Admin Only) */}
          {activeTab === 'requests' && isOrgAdmin && (
            <div className="space-y-3">
              {accessRequests.length === 0 ? (
                <div className="text-center py-12">
                  <Bell className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No pending requests</h3>
                  <p className="text-sm text-gray-500">All access requests have been handled</p>
                </div>
              ) : (
                accessRequests.map(request => (
                  <Card key={request.id} className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start space-x-3">
                        <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                          <Clock className="w-5 h-5 text-amber-600" />
                        </div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="font-medium text-gray-900">
                              {request.requester?.full_name}
                            </span>
                            <span className="text-sm text-gray-500">
                              requested {request.request_type.replace(/_/g, ' ')}
                            </span>
                          </div>
                          {request.target_team && (
                            <p className="text-sm text-gray-600">
                              Team: {request.target_team.name}
                            </p>
                          )}
                          {request.target_portfolio && (
                            <p className="text-sm text-gray-600">
                              Portfolio: {request.target_portfolio.name}
                            </p>
                          )}
                          {request.reason && (
                            <p className="text-sm text-gray-500 mt-1 italic">"{request.reason}"</p>
                          )}
                          <p className="text-xs text-gray-400 mt-1">
                            {new Date(request.created_at).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleAccessRequestMutation.mutate({
                            requestId: request.id,
                            status: 'rejected'
                          })}
                          className="text-red-600 hover:bg-red-50"
                        >
                          <XCircle className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleAccessRequestMutation.mutate({
                            requestId: request.id,
                            status: 'approved'
                          })}
                        >
                          <Check className="w-4 h-4 mr-1" />
                          Approve
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))
              )}
            </div>
          )}

          {/* Settings Tab (Admin Only) */}
          {activeTab === 'settings' && isOrgAdmin && (
            <div className="space-y-6">
              <Card className="p-6">
                <h3 className="font-medium text-gray-900 mb-4">Organization Settings</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Organization Name
                    </label>
                    <input
                      type="text"
                      value={organization?.name || ''}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      disabled
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Description
                    </label>
                    <textarea
                      value={organization?.description || ''}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      rows={3}
                      disabled
                    />
                  </div>
                </div>
              </Card>

              <Card className="p-6">
                <h3 className="font-medium text-gray-900 mb-4">Org Admins</h3>
                <div className="space-y-2">
                  {orgMembers.filter(m => m.is_org_admin).map(admin => (
                    <div key={admin.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center">
                          <Crown className="w-4 h-4 text-indigo-600" />
                        </div>
                        <div>
                          <span className="text-sm font-medium text-gray-900">{admin.user?.full_name}</span>
                          <p className="text-xs text-gray-500">{admin.user?.email}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>

      {/* Edit Team Modal */}
      {editingTeam && (
        <AddTeamModal
          team={editingTeam}
          onClose={() => setEditingTeam(null)}
          onSave={(data) => updateTeamMutation.mutate({ id: editingTeam.id, ...data })}
          isLoading={updateTeamMutation.isPending}
        />
      )}

      {/* Add Member Modal */}
      {showAddMemberModal && selectedTeam && (
        <AddMemberModal
          team={selectedTeam}
          existingMembers={getTeamMembers(selectedTeam.id).map(m => m.user_id)}
          availableUsers={orgMembers}
          onClose={() => {
            setShowAddMemberModal(false)
            setSelectedTeam(null)
          }}
          onSave={(userId, isAdmin) => {
            addTeamMemberMutation.mutate({
              teamId: selectedTeam.id,
              userId,
              isAdmin
            })
            setShowAddMemberModal(false)
            setSelectedTeam(null)
          }}
        />
      )}

      {/* Request Access Modal */}
      {showRequestModal && (
        <RequestAccessModal
          teams={teams}
          portfolios={portfolios}
          onClose={() => setShowRequestModal(false)}
          onSubmit={(data) => submitAccessRequestMutation.mutate(data)}
          isLoading={submitAccessRequestMutation.isPending}
        />
      )}

      {/* Add Contact Modal */}
      {showAddContactModal && (
        <AddContactModal
          onClose={() => setShowAddContactModal(false)}
          onSave={(data) => createContactMutation.mutate(data)}
          isLoading={createContactMutation.isPending}
        />
      )}

      {/* Suspend User Modal */}
      {showSuspendModal && (
        <SuspendUserModal
          member={showSuspendModal}
          onClose={() => setShowSuspendModal(null)}
          onSuspend={(reason) => suspendUserMutation.mutate({
            membershipId: showSuspendModal.id,
            reason
          })}
          isLoading={suspendUserMutation.isPending}
        />
      )}

      {/* Removal Request Modal */}
      {showRemovalRequestModal && (
        <RemovalRequestModal
          member={showRemovalRequestModal}
          onClose={() => setShowRemovalRequestModal(null)}
          onSubmit={(reason) => submitRemovalRequestMutation.mutate({
            targetUserId: showRemovalRequestModal.user_id,
            reason
          })}
          isLoading={submitRemovalRequestMutation.isPending}
        />
      )}

      {/* Add Node Modal */}
      {showAddNodeModal && (
        <AddNodeModal
          parentId={addNodeParentId}
          portfolios={portfolios}
          onClose={() => {
            setShowAddNodeModal(false)
            setAddNodeParentId(null)
          }}
          onSave={(data) => createNodeMutation.mutate(data)}
          isLoading={createNodeMutation.isPending}
        />
      )}

      {/* Edit Node Modal */}
      {editingNode && (
        <EditNodeModal
          node={editingNode}
          onClose={() => setEditingNode(null)}
          onSave={(data) => updateNodeMutation.mutate(data)}
          isLoading={updateNodeMutation.isPending}
        />
      )}

      {/* Add Node Member Modal */}
      {showAddNodeMemberModal && (
        <AddNodeMemberModal
          node={showAddNodeMemberModal}
          existingMembers={getNodeMembers(showAddNodeMemberModal.id)}
          availableUsers={orgMembers}
          onClose={() => setShowAddNodeMemberModal(null)}
          onSave={(userId, role, focus) => {
            addNodeMemberMutation.mutate({
              node_id: showAddNodeMemberModal.id,
              user_id: userId,
              role,
              focus
            }, {
              onSuccess: () => setShowAddNodeMemberModal(null)
            })
          }}
          isLoading={addNodeMemberMutation.isPending}
        />
      )}
    </div>
  )
}

// Main exported component - handles loading state
export function OrganizationPage() {
  const { user } = useAuth()

  // Single query to determine admin status - this controls the loading state
  const { data: adminStatus, isLoading } = useQuery({
    queryKey: ['org-admin-status', user?.id],
    queryFn: async () => {
      if (!user?.id) return { isAdmin: false }

      const { data, error } = await supabase
        .from('organization_memberships')
        .select('is_org_admin')
        .eq('user_id', user.id)
        .maybeSingle()

      if (error) {
        console.error('Error fetching org membership:', error)
        return { isAdmin: false }
      }

      return { isAdmin: data?.is_org_admin === true }
    },
    enabled: !!user?.id
  })

  // Show loading screen until we know the user's admin status
  if (isLoading || adminStatus === undefined) {
    return <LoadingScreen />
  }

  // Once loaded, render the content with the correct admin status
  return <OrganizationContent isOrgAdmin={adminStatus.isAdmin} />
}

// Sub-components

// OrgChartNodeCard - renders a single org chart node with its children
interface OrgChartNodeCardProps {
  node: OrgChartNode
  isOrgAdmin: boolean
  onEdit: (node: OrgChartNode) => void
  onAddChild: (parentId: string) => void
  onDelete: (nodeId: string) => void
  onAddMember: (node: OrgChartNode) => void
  onRemoveMember: (memberId: string) => void
  getNodeMembers: (nodeId: string) => OrgChartNodeMember[]
  depth?: number
}

function OrgChartNodeCard({ node, isOrgAdmin, onEdit, onAddChild, onDelete, onAddMember, onRemoveMember, getNodeMembers, depth = 0 }: OrgChartNodeCardProps) {
  const members = getNodeMembers(node.id)
  const [isExpanded, setIsExpanded] = useState(true)
  const [showMembers, setShowMembers] = useState(false)
  const hasChildren = node.children && node.children.length > 0

  // Get icon based on node type
  const getNodeIcon = () => {
    switch (node.node_type) {
      case 'division': return <Building2 className="w-5 h-5" style={{ color: node.color }} />
      case 'department': return <FolderOpen className="w-5 h-5" style={{ color: node.color }} />
      case 'team': return <Users className="w-5 h-5" style={{ color: node.color }} />
      case 'portfolio': return <Briefcase className="w-5 h-5" style={{ color: node.color }} />
      default: return <FolderOpen className="w-5 h-5" style={{ color: node.color }} />
    }
  }

  // Get type label
  const getTypeLabel = () => {
    if (node.node_type === 'custom' && node.custom_type_label) {
      return node.custom_type_label
    }
    return node.node_type.charAt(0).toUpperCase() + node.node_type.slice(1)
  }

  return (
    <div className="relative group/node">
      {/* Hover overlay actions for admins */}
      {isOrgAdmin && (
        <div className="absolute top-2 right-2 opacity-0 group-hover/node:opacity-100 transition-all duration-200 z-10 flex items-center space-x-1">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onAddMember(node)
            }}
            className="p-1.5 bg-white rounded-md shadow-sm hover:bg-gray-50 transition-colors"
            title="Add member"
          >
            <UserPlus className="w-3.5 h-3.5 text-gray-500" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onEdit(node)
            }}
            className="p-1.5 bg-white rounded-md shadow-sm hover:bg-gray-50 transition-colors"
            title={`Edit ${getTypeLabel()}`}
          >
            <Edit3 className="w-3.5 h-3.5 text-gray-500" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onAddChild(node.id)
            }}
            className="p-1.5 bg-white rounded-md shadow-sm hover:bg-gray-50 transition-colors"
            title="Add child"
          >
            <Plus className="w-3.5 h-3.5 text-gray-500" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete(node.id)
            }}
            className="p-1.5 bg-white rounded-md shadow-sm hover:bg-red-50 transition-colors"
            title={`Delete ${getTypeLabel()}`}
          >
            <Trash2 className="w-3.5 h-3.5 text-red-400" />
          </button>
        </div>
      )}

      {/* Node Card */}
      <div
        className={`bg-white border-2 rounded-xl shadow-sm cursor-pointer transition-all hover:shadow-md w-[220px] ${
          isExpanded && hasChildren ? 'border-gray-300' : 'border-gray-200'
        }`}
        style={{ borderTopColor: node.color, borderTopWidth: '3px' }}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="p-4 text-center">
          {/* Icon */}
          <div
            className="inline-flex items-center justify-center w-10 h-10 rounded-xl mb-2"
            style={{ backgroundColor: `${node.color}20` }}
          >
            {getNodeIcon()}
          </div>

          {/* Name */}
          <h4 className="font-semibold text-gray-900 text-sm">{node.name}</h4>
          <p className="text-xs text-gray-500 mt-0.5">
            {getTypeLabel()}
            {hasChildren && ` · ${node.children!.length} item${node.children!.length !== 1 ? 's' : ''}`}
            {members.length > 0 && ` · ${members.length} member${members.length !== 1 ? 's' : ''}`}
          </p>

          {/* Members toggle button */}
          {members.length > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowMembers(!showMembers)
              }}
              className="mt-2 flex items-center justify-center space-x-1 text-xs text-indigo-600 hover:text-indigo-800 mx-auto"
            >
              <Users className="w-3 h-3" />
              <span>{showMembers ? 'Hide' : 'Show'} members</span>
            </button>
          )}

          {/* Members list */}
          {showMembers && members.length > 0 && (
            <div className="mt-3 text-left border-t border-gray-100 pt-2">
              {members.map(member => (
                <div key={member.id} className="flex items-center justify-between py-1 group/member">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-700 truncate">{member.user?.full_name || member.user?.email}</p>
                    <p className="text-xs text-gray-500">{member.role}{member.focus ? ` · ${member.focus}` : ''}</p>
                  </div>
                  {isOrgAdmin && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (confirm(`Remove ${member.user?.full_name || member.user?.email} from this node?`)) {
                          onRemoveMember(member.id)
                        }
                      }}
                      className="p-1 opacity-0 group-hover/member:opacity-100 hover:bg-red-50 rounded transition-all"
                      title="Remove member"
                    >
                      <X className="w-3 h-3 text-red-400" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Expand indicator for nodes with children */}
          {hasChildren && (
            <div className="mt-2">
              {isExpanded ? (
                <ChevronDown className="w-4 h-4 text-gray-400 mx-auto" />
              ) : (
                <ChevronRight className="w-4 h-4 text-gray-400 mx-auto" />
              )}
            </div>
          )}

          {/* Description if present */}
          {node.description && !hasChildren && !showMembers && (
            <p className="text-xs text-gray-500 mt-2 line-clamp-2">{node.description}</p>
          )}
        </div>
      </div>

      {/* Expanded Children */}
      {isExpanded && hasChildren && (
        <div className="flex flex-col items-center mt-0">
          {/* Vertical connector down from this node */}
          <div className="w-0.5 h-8 bg-gray-300" />

          {/* Horizontal connector spanning children */}
          {node.children!.length > 1 && (
            <div
              className="h-0.5 bg-gray-300"
              style={{ width: `${(node.children!.length - 1) * 240}px`, maxWidth: '90vw' }}
            />
          )}

          {/* Child nodes with vertical connectors */}
          <div className="flex flex-wrap gap-x-5 justify-center">
            {node.children!.map(childNode => (
              <div key={childNode.id} className="flex flex-col items-center">
                {/* Vertical connector from horizontal line */}
                <div className="w-0.5 h-8 bg-gray-300" />
                <OrgChartNodeCard
                  node={childNode}
                  isOrgAdmin={isOrgAdmin}
                  onEdit={onEdit}
                  onAddChild={onAddChild}
                  onDelete={onDelete}
                  onAddMember={onAddMember}
                  onRemoveMember={onRemoveMember}
                  getNodeMembers={getNodeMembers}
                  depth={depth + 1}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

interface AddTeamModalProps {
  team?: Team
  onClose: () => void
  onSave: (data: { name: string; description: string; color: string }) => void
  isLoading: boolean
}

function AddTeamModal({ team, onClose, onSave, isLoading }: AddTeamModalProps) {
  const [name, setName] = useState(team?.name || '')
  const [description, setDescription] = useState(team?.description || '')
  const [color, setColor] = useState(team?.color || '#6366f1')

  const colors = ['#3b82f6', '#10b981', '#8b5cf6', '#ef4444', '#f97316', '#ec4899', '#6366f1', '#14b8a6']

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          {team ? 'Edit Team' : 'Add Team'}
        </h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Team Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
              placeholder="e.g., Tech Sector"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
              rows={3}
              placeholder="What does this team focus on?"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Color</label>
            <div className="flex space-x-2">
              {colors.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-full border-2 ${
                    color === c ? 'border-gray-900' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end space-x-3 mt-6">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => onSave({ name, description, color })}
            disabled={!name.trim() || isLoading}
          >
            {isLoading ? 'Saving...' : team ? 'Update' : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  )
}

interface AddMemberModalProps {
  team: Team
  existingMembers: string[]
  availableUsers: OrganizationMembership[]
  onClose: () => void
  onSave: (userId: string, isAdmin: boolean) => void
}

function AddMemberModal({ team, existingMembers, availableUsers, onClose, onSave }: AddMemberModalProps) {
  const [selectedUserId, setSelectedUserId] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)

  const filteredUsers = availableUsers.filter(u => !existingMembers.includes(u.user_id))

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Add Member to {team.name}
        </h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Select User</label>
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Choose a user...</option>
              {filteredUsers.map(u => (
                <option key={u.user_id} value={u.user_id}>
                  {u.user?.full_name} ({u.user?.email})
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="isAdmin"
              checked={isAdmin}
              onChange={(e) => setIsAdmin(e.target.checked)}
              className="rounded text-indigo-600"
            />
            <label htmlFor="isAdmin" className="text-sm text-gray-700">
              Make team admin
            </label>
          </div>
        </div>
        <div className="flex justify-end space-x-3 mt-6">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => onSave(selectedUserId, isAdmin)}
            disabled={!selectedUserId}
          >
            Add Member
          </Button>
        </div>
      </div>
    </div>
  )
}

interface AddNodeMemberModalProps {
  node: OrgChartNode
  existingMembers: OrgChartNodeMember[]
  availableUsers: OrganizationMembership[]
  onClose: () => void
  onSave: (userId: string, role: string, focus?: string) => void
  isLoading?: boolean
}

function AddNodeMemberModal({ node, existingMembers, availableUsers, onClose, onSave, isLoading }: AddNodeMemberModalProps) {
  const [selectedUserId, setSelectedUserId] = useState('')
  const [role, setRole] = useState('')
  const [focus, setFocus] = useState('')

  const roleOptions = [
    { value: 'Portfolio Manager', label: 'Portfolio Manager' },
    { value: 'Analyst', label: 'Analyst' },
    { value: 'Trader', label: 'Trader' },
    { value: 'Lead', label: 'Lead' },
    { value: 'Member', label: 'Member' },
  ]

  const focusOptions = [
    { value: '', label: 'No Focus (Optional)' },
    { value: 'Generalist', label: 'Generalist' },
    { value: 'Technology', label: 'Technology' },
    { value: 'Healthcare', label: 'Healthcare' },
    { value: 'Energy', label: 'Energy' },
    { value: 'Financials', label: 'Financials' },
    { value: 'Consumer', label: 'Consumer' },
    { value: 'Industrials', label: 'Industrials' },
    { value: 'Utilities', label: 'Utilities' },
    { value: 'Materials', label: 'Materials' },
    { value: 'Real Estate', label: 'Real Estate' },
    { value: 'Quant', label: 'Quant' },
    { value: 'Technical', label: 'Technical' },
  ]

  // Filter out users who already have this exact role+focus combination
  const existingCombinations = new Set(
    existingMembers.map(m => `${m.user_id}-${m.role}-${m.focus || ''}`)
  )
  const filteredUsers = availableUsers.filter(u => {
    if (!role) return true // Show all users if no role selected yet
    const combination = `${u.user_id}-${role}-${focus}`
    return !existingCombinations.has(combination)
  })

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Add Member to {node.name}
        </h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Select User *</label>
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Choose a user...</option>
              {filteredUsers.map(u => (
                <option key={u.user_id} value={u.user_id}>
                  {u.user?.full_name} ({u.user?.email})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role *</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Select a role...</option>
              {roleOptions.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Focus</label>
            <select
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
            >
              {focusOptions.map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>

          {/* Show existing members */}
          {existingMembers.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Current Members</label>
              <div className="max-h-32 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                {existingMembers.map(m => (
                  <div key={m.id} className="px-3 py-2 text-sm flex items-center justify-between">
                    <span className="text-gray-700">{m.user?.full_name || m.user?.email}</span>
                    <span className="text-xs text-gray-500">{m.role}{m.focus ? ` · ${m.focus}` : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end space-x-3 mt-6">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => onSave(selectedUserId, role, focus || undefined)}
            disabled={!selectedUserId || !role || isLoading}
            loading={isLoading}
          >
            Add Member
          </Button>
        </div>
      </div>
    </div>
  )
}

interface RequestAccessModalProps {
  teams: Team[]
  portfolios: Portfolio[]
  onClose: () => void
  onSubmit: (data: any) => void
  isLoading: boolean
}

function RequestAccessModal({ teams, portfolios, onClose, onSubmit, isLoading }: RequestAccessModalProps) {
  const [requestType, setRequestType] = useState('join_team')
  const [targetTeamId, setTargetTeamId] = useState('')
  const [targetPortfolioId, setTargetPortfolioId] = useState('')
  const [reason, setReason] = useState('')

  const requestTypes = [
    { value: 'join_team', label: 'Join a Team' },
    { value: 'join_portfolio', label: 'Access a Portfolio' },
    { value: 'role_change', label: 'Request Role Change' },
    { value: 'team_admin', label: 'Request Team Admin' },
    { value: 'other', label: 'Other Request' }
  ]

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Request Access</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Request Type</label>
            <select
              value={requestType}
              onChange={(e) => setRequestType(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
            >
              {requestTypes.map(rt => (
                <option key={rt.value} value={rt.value}>{rt.label}</option>
              ))}
            </select>
          </div>

          {(requestType === 'join_team' || requestType === 'team_admin') && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Team</label>
              <select
                value={targetTeamId}
                onChange={(e) => setTargetTeamId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">Select a team...</option>
                {teams.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}

          {requestType === 'join_portfolio' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Portfolio</label>
              <select
                value={targetPortfolioId}
                onChange={(e) => setTargetPortfolioId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">Select a portfolio...</option>
                {portfolios.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reason (optional)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
              rows={3}
              placeholder="Why do you need this access?"
            />
          </div>
        </div>
        <div className="flex justify-end space-x-3 mt-6">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => onSubmit({
              request_type: requestType,
              target_team_id: targetTeamId || undefined,
              target_portfolio_id: targetPortfolioId || undefined,
              reason: reason || undefined
            })}
            disabled={isLoading}
          >
            {isLoading ? 'Submitting...' : 'Submit Request'}
          </Button>
        </div>
      </div>
    </div>
  )
}

interface AddContactModalProps {
  onClose: () => void
  onSave: (data: {
    full_name: string
    email?: string
    phone?: string
    title?: string
    department?: string
    company?: string
    notes?: string
    contact_type: string
    receives_reports: boolean
  }) => void
  isLoading: boolean
}

function AddContactModal({ onClose, onSave, isLoading }: AddContactModalProps) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [title, setTitle] = useState('')
  const [company, setCompany] = useState('')
  const [notes, setNotes] = useState('')
  const [contactType, setContactType] = useState('external')
  const [receivesReports, setReceivesReports] = useState(false)

  const contactTypes = [
    { value: 'external', label: 'External Contact' },
    { value: 'consultant', label: 'Consultant' },
    { value: 'vendor', label: 'Vendor' },
    { value: 'client', label: 'Client' },
    { value: 'other', label: 'Other' }
  ]

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Add Contact</h3>
        <p className="text-sm text-gray-500 mb-4">
          Add a person who doesn't have platform access but may need to receive reports or communications.
        </p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
              placeholder="John Smith"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                placeholder="john@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                placeholder="+1 (555) 000-0000"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                placeholder="CEO"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Company</label>
              <input
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                placeholder="Acme Corp"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Contact Type</label>
            <select
              value={contactType}
              onChange={(e) => setContactType(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
            >
              {contactTypes.map(ct => (
                <option key={ct.value} value={ct.value}>{ct.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
              rows={2}
              placeholder="Any additional notes about this contact..."
            />
          </div>
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="receivesReports"
              checked={receivesReports}
              onChange={(e) => setReceivesReports(e.target.checked)}
              className="rounded text-indigo-600"
            />
            <label htmlFor="receivesReports" className="text-sm text-gray-700">
              Receives reports and communications
            </label>
          </div>
        </div>
        <div className="flex justify-end space-x-3 mt-6">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => onSave({
              full_name: fullName,
              email: email || undefined,
              phone: phone || undefined,
              title: title || undefined,
              company: company || undefined,
              notes: notes || undefined,
              contact_type: contactType,
              receives_reports: receivesReports
            })}
            disabled={!fullName.trim() || isLoading}
          >
            {isLoading ? 'Adding...' : 'Add Contact'}
          </Button>
        </div>
      </div>
    </div>
  )
}

interface SuspendUserModalProps {
  member: OrganizationMembership
  onClose: () => void
  onSuspend: (reason: string) => void
  isLoading: boolean
}

function SuspendUserModal({ member, onClose, onSuspend, isLoading }: SuspendUserModalProps) {
  const [reason, setReason] = useState('')
  const [showConfirmation, setShowConfirmation] = useState(false)

  if (showConfirmation) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
          <div className="flex items-center space-x-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900">Are you sure?</h3>
          </div>
          <p className="text-sm text-gray-600 mb-4">
            You are about to suspend <span className="font-semibold text-gray-900">{member.user?.full_name}</span>'s access to the platform.
          </p>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
            <p className="text-sm text-amber-800">
              <strong>This action will:</strong>
            </p>
            <ul className="text-sm text-amber-700 list-disc list-inside mt-1">
              <li>Immediately revoke their platform access</li>
              <li>Prevent them from logging in</li>
              <li>This can be undone by restoring the user</li>
            </ul>
          </div>
          <div className="flex justify-end space-x-3">
            <Button variant="outline" onClick={() => setShowConfirmation(false)}>Go Back</Button>
            <Button
              onClick={() => onSuspend(reason)}
              disabled={isLoading}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {isLoading ? 'Suspending...' : 'Yes, Suspend Access'}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center space-x-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
            <UserX className="w-5 h-5 text-amber-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900">Suspend User Access</h3>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          Suspending <span className="font-medium">{member.user?.full_name}</span> will immediately revoke their access to the platform. They can be restored later.
        </p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reason for suspension *</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
              rows={3}
              placeholder="Please provide a reason for suspending this user..."
            />
          </div>
        </div>
        <div className="flex justify-end space-x-3 mt-6">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => setShowConfirmation(true)}
            disabled={!reason.trim()}
            className="bg-amber-600 hover:bg-amber-700"
          >
            Continue
          </Button>
        </div>
      </div>
    </div>
  )
}

interface RemovalRequestModalProps {
  member: OrganizationMembership
  onClose: () => void
  onSubmit: (reason: string) => void
  isLoading: boolean
}

function RemovalRequestModal({ member, onClose, onSubmit, isLoading }: RemovalRequestModalProps) {
  const [reason, setReason] = useState('')
  const [showConfirmation, setShowConfirmation] = useState(false)

  if (showConfirmation) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
          <div className="flex items-center space-x-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900">Are you sure?</h3>
          </div>
          <p className="text-sm text-gray-600 mb-4">
            You are about to request removal of <span className="font-semibold text-gray-900">{member.user?.full_name}</span> from the organization.
          </p>
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
            <p className="text-sm text-red-800">
              <strong>This action will:</strong>
            </p>
            <ul className="text-sm text-red-700 list-disc list-inside mt-1">
              <li>Send a removal request to the account team</li>
              <li>The request will be reviewed and processed</li>
              <li>Once removed, user data may be permanently deleted</li>
            </ul>
          </div>
          <div className="flex justify-end space-x-3">
            <Button variant="outline" onClick={() => setShowConfirmation(false)}>Go Back</Button>
            <Button
              onClick={() => onSubmit(reason)}
              disabled={isLoading}
              className="bg-red-600 hover:bg-red-700"
            >
              {isLoading ? 'Sending...' : 'Yes, Request Removal'}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center space-x-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
            <Send className="w-5 h-5 text-red-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900">Request User Removal</h3>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          This will send a removal request to the account team for <span className="font-medium">{member.user?.full_name}</span>.
          The account team will review and process this request.
        </p>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
          <p className="text-xs text-amber-800">
            <strong>Note:</strong> For immediate action, consider suspending the user's access while awaiting removal processing.
          </p>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reason for removal request *</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500"
              rows={3}
              placeholder="Please explain why this user should be removed..."
            />
          </div>
        </div>
        <div className="flex justify-end space-x-3 mt-6">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => setShowConfirmation(true)}
            disabled={!reason.trim()}
            className="bg-red-600 hover:bg-red-700"
          >
            Continue
          </Button>
        </div>
      </div>
    </div>
  )
}

// Add Node Modal - for creating org chart nodes
interface AddNodeModalProps {
  parentId: string | null
  portfolios: Portfolio[]
  onClose: () => void
  onSave: (data: {
    parent_id: string | null
    node_type: OrgNodeType
    custom_type_label?: string
    name: string
    description?: string
    color: string
    icon: string
    portfolio_id?: string
  }) => void
  isLoading: boolean
}

const NODE_TYPE_OPTIONS: { value: OrgNodeType; label: string; description: string; icon: string }[] = [
  { value: 'division', label: 'Division', description: 'A major organizational division', icon: 'building' },
  { value: 'department', label: 'Department', description: 'A department within a division', icon: 'layers' },
  { value: 'team', label: 'Team', description: 'A functional team with members', icon: 'users' },
  { value: 'portfolio', label: 'Portfolio', description: 'An investment portfolio', icon: 'briefcase' },
  { value: 'custom', label: 'Custom', description: 'Define your own type', icon: 'folder' }
]

const NODE_COLORS = ['#6366f1', '#3b82f6', '#10b981', '#8b5cf6', '#ef4444', '#f97316', '#ec4899', '#14b8a6']

function AddNodeModal({ parentId, portfolios, onClose, onSave, isLoading }: AddNodeModalProps) {
  const [nodeType, setNodeType] = useState<OrgNodeType>('team')
  const [customTypeLabel, setCustomTypeLabel] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('#6366f1')
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string>('')
  const [portfolioSearch, setPortfolioSearch] = useState('')

  // Filter portfolios based on search
  const filteredPortfolios = portfolios.filter(p =>
    p.name.toLowerCase().includes(portfolioSearch.toLowerCase())
  )

  const handleSubmit = () => {
    // For portfolio type, require a selected portfolio
    if (nodeType === 'portfolio') {
      if (!selectedPortfolioId) return
      const selectedPortfolio = portfolios.find(p => p.id === selectedPortfolioId)
      if (!selectedPortfolio) return

      onSave({
        parent_id: parentId,
        node_type: nodeType,
        name: selectedPortfolio.name,
        description: selectedPortfolio.description || undefined,
        color: '#10b981', // Green for portfolios
        icon: 'briefcase',
        portfolio_id: selectedPortfolioId
      })
      return
    }

    if (!name.trim()) return
    if (nodeType === 'custom' && !customTypeLabel.trim()) return

    onSave({
      parent_id: parentId,
      node_type: nodeType,
      custom_type_label: nodeType === 'custom' ? customTypeLabel.trim() : undefined,
      name: name.trim(),
      description: description.trim() || undefined,
      color,
      icon: NODE_TYPE_OPTIONS.find(o => o.value === nodeType)?.icon || 'folder'
    })
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6">
        <div className="flex items-center space-x-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
            <Plus className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Add to Organization</h3>
            <p className="text-sm text-gray-500">
              {parentId ? 'Add a child node' : 'Add to the root level'}
            </p>
          </div>
        </div>

        <div className="space-y-5">
          {/* Node Type Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Type</label>
            <div className="grid grid-cols-2 gap-2">
              {NODE_TYPE_OPTIONS.map(option => (
                <button
                  key={option.value}
                  onClick={() => setNodeType(option.value)}
                  className={`flex items-center space-x-2 p-3 rounded-lg border-2 text-left transition-colors ${
                    nodeType === option.value
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-gray-200 hover:border-gray-300 text-gray-700'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    nodeType === option.value ? 'bg-indigo-100' : 'bg-gray-100'
                  }`}>
                    {option.value === 'division' && <Building2 className="w-4 h-4" />}
                    {option.value === 'department' && <FolderOpen className="w-4 h-4" />}
                    {option.value === 'team' && <Users className="w-4 h-4" />}
                    {option.value === 'portfolio' && <Briefcase className="w-4 h-4" />}
                    {option.value === 'custom' && <Settings className="w-4 h-4" />}
                  </div>
                  <div>
                    <div className="text-sm font-medium">{option.label}</div>
                    <div className="text-xs text-gray-500">{option.description}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Custom Type Label (only for custom type) */}
          {nodeType === 'custom' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Custom Type Label *</label>
              <input
                type="text"
                value={customTypeLabel}
                onChange={(e) => setCustomTypeLabel(e.target.value)}
                placeholder="e.g., Business Unit, Region, Practice Area"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
          )}

          {/* Portfolio Selection (only for portfolio type) */}
          {nodeType === 'portfolio' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Select Portfolio *</label>
              {/* Search input */}
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={portfolioSearch}
                  onChange={(e) => setPortfolioSearch(e.target.value)}
                  placeholder="Search portfolios..."
                  className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                />
              </div>
              {/* Portfolio list */}
              <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg">
                {filteredPortfolios.length === 0 ? (
                  <div className="p-4 text-center text-sm text-gray-500">
                    {portfolioSearch ? 'No portfolios match your search' : 'No portfolios available'}
                  </div>
                ) : (
                  filteredPortfolios.map(portfolio => (
                    <button
                      key={portfolio.id}
                      onClick={() => setSelectedPortfolioId(portfolio.id)}
                      className={`w-full flex items-center space-x-3 p-3 text-left transition-colors border-b border-gray-100 last:border-b-0 ${
                        selectedPortfolioId === portfolio.id
                          ? 'bg-green-50 text-green-700'
                          : 'hover:bg-gray-50 text-gray-700'
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        selectedPortfolioId === portfolio.id ? 'bg-green-100' : 'bg-gray-100'
                      }`}>
                        <Briefcase className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{portfolio.name}</div>
                        {portfolio.description && (
                          <div className="text-xs text-gray-500 truncate">{portfolio.description}</div>
                        )}
                      </div>
                      {selectedPortfolioId === portfolio.id && (
                        <Check className="w-4 h-4 text-green-600 flex-shrink-0" />
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Name (not shown for portfolio type) */}
          {nodeType !== 'portfolio' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`Enter ${nodeType === 'custom' ? customTypeLabel || 'node' : nodeType} name`}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
          )}

          {/* Description (not shown for portfolio type) */}
          {nodeType !== 'portfolio' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                rows={2}
              />
            </div>
          )}

          {/* Color (not shown for portfolio type) */}
          {nodeType !== 'portfolio' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Color</label>
              <div className="flex flex-wrap gap-2">
                {NODE_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={`w-8 h-8 rounded-full border-2 transition-transform ${
                      color === c ? 'border-gray-800 scale-110' : 'border-transparent hover:scale-105'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end space-x-3 mt-6">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={
              (nodeType === 'portfolio' && !selectedPortfolioId) ||
              (nodeType !== 'portfolio' && !name.trim()) ||
              (nodeType === 'custom' && !customTypeLabel.trim()) ||
              isLoading
            }
          >
            {isLoading ? 'Adding...' : 'Add'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// Edit Node Modal - for editing existing org chart nodes
interface EditNodeModalProps {
  node: OrgChartNode
  onClose: () => void
  onSave: (data: {
    id: string
    name: string
    description?: string
    color: string
    icon: string
    custom_type_label?: string
  }) => void
  isLoading: boolean
}

function EditNodeModal({ node, onClose, onSave, isLoading }: EditNodeModalProps) {
  const [customTypeLabel, setCustomTypeLabel] = useState(node.custom_type_label || '')
  const [name, setName] = useState(node.name)
  const [description, setDescription] = useState(node.description || '')
  const [color, setColor] = useState(node.color)

  const handleSubmit = () => {
    if (!name.trim()) return
    if (node.node_type === 'custom' && !customTypeLabel.trim()) return

    onSave({
      id: node.id,
      name: name.trim(),
      description: description.trim() || undefined,
      color,
      icon: node.icon,
      custom_type_label: node.node_type === 'custom' ? customTypeLabel.trim() : undefined
    })
  }

  // Get type label
  const getTypeLabel = () => {
    if (node.node_type === 'custom' && node.custom_type_label) {
      return node.custom_type_label
    }
    return node.node_type.charAt(0).toUpperCase() + node.node_type.slice(1)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6">
        <div className="flex items-center space-x-3 mb-6">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: `${node.color}20` }}
          >
            <Edit3 className="w-5 h-5" style={{ color: node.color }} />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Edit {getTypeLabel()}</h3>
            <p className="text-sm text-gray-500">{node.name}</p>
          </div>
        </div>

        <div className="space-y-5">
          {/* Custom Type Label (only for custom type) */}
          {node.node_type === 'custom' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type Label *</label>
              <input
                type="text"
                value={customTypeLabel}
                onChange={(e) => setCustomTypeLabel(e.target.value)}
                placeholder="e.g., Business Unit, Region"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter name"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              rows={2}
            />
          </div>

          {/* Color */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Color</label>
            <div className="flex flex-wrap gap-2">
              {NODE_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-full border-2 transition-transform ${
                    color === c ? 'border-gray-800 scale-110' : 'border-transparent hover:scale-105'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end space-x-3 mt-6">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={!name.trim() || (node.node_type === 'custom' && !customTypeLabel.trim()) || isLoading}
          >
            {isLoading ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  )
}
