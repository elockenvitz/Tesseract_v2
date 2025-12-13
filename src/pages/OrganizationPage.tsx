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
  Folder,
  MoreHorizontal,
  GripVertical,
  UserX,
  AlertTriangle,
  Shield,
  ShieldOff,
  Phone,
  AtSign,
  ExternalLink,
  LogIn,
  Send,
  Link2,
  Info,
  Calendar,
  FileText,
  Lock,
  Unlock
} from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { AddTeamMemberModal } from '../components/portfolios/AddTeamMemberModal'

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
  coverage_admin?: boolean
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

interface PortfolioTeamMember {
  id: string
  portfolio_id: string
  user_id: string
  role: string
  focus: string | null
  created_at: string
  user?: {
    id: string
    email: string
    first_name?: string
    last_name?: string
  }
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
  is_non_investment?: boolean
  coverage_admin_override?: boolean
  created_at: string
  children?: OrgChartNode[]
  isLinkedInstance?: boolean // True if this node appears as a linked portfolio under another team
}

interface OrgChartNodeMember {
  id: string
  node_id: string
  user_id: string
  role: string
  focus: string | null
  is_coverage_admin?: boolean
  coverage_admin_blocked?: boolean
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
  const [insertBetweenChildIds, setInsertBetweenChildIds] = useState<string[] | null>(null) // Children to re-parent when inserting
  const [editingNode, setEditingNode] = useState<OrgChartNode | null>(null)
  const [showAddNodeMemberModal, setShowAddNodeMemberModal] = useState<OrgChartNode | null>(null)
  const [viewingNodeDetails, setViewingNodeDetails] = useState<OrgChartNode | null>(null)
  const [viewingTeamCoverage, setViewingTeamCoverage] = useState<{ teamId: string; teamName: string } | null>(null)
  const [deleteNodeConfirm, setDeleteNodeConfirm] = useState<{ isOpen: boolean; node: OrgChartNode | null }>({ isOpen: false, node: null })

  // Org chart panning state
  const orgChartContainerRef = useRef<HTMLDivElement>(null)
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
  const [scrollStart, setScrollStart] = useState({ x: 0, y: 0 })

  // Admin badge dropdown state
  const [showAdminBadgeDropdown, setShowAdminBadgeDropdown] = useState(false)
  const adminBadgeRef = useRef<HTMLDivElement>(null)

  // Portfolio team member state
  const [showAddPortfolioTeamMemberModal, setShowAddPortfolioTeamMemberModal] = useState(false)
  const [selectedPortfolioForTeam, setSelectedPortfolioForTeam] = useState<Portfolio | null>(null)
  const [editingPortfolioTeamMember, setEditingPortfolioTeamMember] = useState<PortfolioTeamMember | null>(null)
  const [deletePortfolioTeamConfirm, setDeletePortfolioTeamConfirm] = useState<{isOpen: boolean, member: PortfolioTeamMember | null}>({ isOpen: false, member: null })

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
  const { data: orgMembers = [], isLoading: isLoadingOrgMembers } = useQuery({
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
        .select('id, email, first_name, last_name, coverage_admin')
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
              : user?.email?.split('@')[0] || 'Unknown',
            coverage_admin: user?.coverage_admin || false
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

  // Fetch portfolio team members (unified with Portfolio Tab)
  const { data: portfolioTeamMembers = [], refetch: refetchPortfolioTeamMembers } = useQuery({
    queryKey: ['portfolio-team-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_team')
        .select(`
          id,
          portfolio_id,
          user_id,
          role,
          focus,
          created_at,
          user:users!inner (
            id,
            email,
            first_name,
            last_name
          )
        `)
        .order('created_at', { ascending: true })

      if (error) throw error
      return (data || []).filter((r: any) => r.user !== null) as PortfolioTeamMember[]
    }
  })

  // Delete portfolio team member mutation
  const deletePortfolioTeamMemberMutation = useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await supabase
        .from('portfolio_team')
        .delete()
        .eq('id', memberId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio-team-all'] })
      // Also invalidate portfolio-specific queries used by Portfolio Tab
      if (deletePortfolioTeamConfirm.member?.portfolio_id) {
        queryClient.invalidateQueries({ queryKey: ['portfolio-team-with-users', deletePortfolioTeamConfirm.member.portfolio_id] })
        queryClient.invalidateQueries({ queryKey: ['portfolio-team', deletePortfolioTeamConfirm.member.portfolio_id] })
      }
      setDeletePortfolioTeamConfirm({ isOpen: false, member: null })
    },
    onError: (error) => {
      console.error('Failed to delete team member:', error)
    }
  })

  // Update portfolio team member mutation
  const updatePortfolioTeamMemberMutation = useMutation({
    mutationFn: async ({ memberId, role, focus }: { memberId: string; role: string; focus: string | null }) => {
      const { error } = await supabase
        .from('portfolio_team')
        .update({ role, focus })
        .eq('id', memberId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio-team-all'] })
    },
    onError: (error) => {
      console.error('Failed to update team member:', error)
    }
  })

  // Add portfolio team member mutation
  const addPortfolioTeamMemberMutation = useMutation({
    mutationFn: async ({ portfolioId, userId, role, focus }: { portfolioId: string; userId: string; role?: string; focus?: string }) => {
      const { data, error } = await supabase
        .from('portfolio_team')
        .insert({
          portfolio_id: portfolioId,
          user_id: userId,
          role: role || 'Analyst',
          focus: focus || null
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio-team-all'] })
    },
    onError: (error: any) => {
      alert(`Failed to add team member: ${error.message}`)
    }
  })

  // Fetch access requests (admin only - all pending requests)
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

  // Fetch user's own access requests (for non-admins to track their requests)
  const { data: myAccessRequests = [] } = useQuery({
    queryKey: ['my-access-requests', user?.id],
    queryFn: async () => {
      if (!user?.id) return []
      const { data, error } = await supabase
        .from('access_requests')
        .select(`
          *,
          target_team:target_team_id (*),
          target_portfolio:target_portfolio_id (*)
        `)
        .eq('requester_id', user.id)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data as AccessRequest[]
    },
    enabled: !isOrgAdmin && !!user?.id
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

  // Fetch org chart node links (for portfolios linked to multiple teams)
  const { data: orgChartNodeLinks = [] } = useQuery({
    queryKey: ['org-chart-node-links'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_chart_node_links')
        .select('*')

      if (error) throw error
      return data || []
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

  // Fetch user's node-level coverage admin memberships (excluding blocked)
  const { data: userCoverageAdminNodes = [] } = useQuery({
    queryKey: ['user-coverage-admin-nodes', user?.id],
    queryFn: async () => {
      if (!user?.id) return []
      const { data, error } = await supabase
        .from('org_chart_node_members')
        .select('node_id')
        .eq('user_id', user.id)
        .eq('is_coverage_admin', true)
        .or('coverage_admin_blocked.is.null,coverage_admin_blocked.eq.false')

      if (error) throw error
      return (data || []).map(d => d.node_id)
    },
    enabled: !!user?.id
  })

  // Fetch coverage settings for the organization
  const { data: coverageSettings, refetch: refetchCoverageSettings } = useQuery({
    queryKey: ['coverage-settings', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return null
      const { data, error } = await supabase
        .from('coverage_settings')
        .select('*')
        .eq('organization_id', organization.id)
        .single()

      if (error && error.code !== 'PGRST116') throw error // PGRST116 = no rows found
      return data
    },
    enabled: !!organization?.id
  })

  // Fetch coverage stats grouped by team_id for displaying on org nodes
  // Coverage flows through USER MEMBERSHIP - a user's coverage counts for all portfolios they're a member of
  const { data: coverageStatsByTeam = {} } = useQuery({
    queryKey: ['coverage-stats-by-team', orgChartNodes, orgChartNodeLinks, orgChartNodeMembers],
    queryFn: async () => {
      // Get all coverage records
      const { data: coverageData, error: coverageError } = await supabase
        .from('coverage')
        .select('asset_id, user_id')
        .eq('is_active', true)

      if (coverageError) {
        console.error('Error fetching coverage stats:', coverageError)
        throw coverageError
      }

      // Build a map of user_id -> their coverage (assets they cover)
      const userCoverage = new Map<string, Set<string>>()
      coverageData?.forEach(record => {
        if (record.user_id && record.asset_id) {
          if (!userCoverage.has(record.user_id)) {
            userCoverage.set(record.user_id, new Set())
          }
          userCoverage.get(record.user_id)!.add(record.asset_id)
        }
      })

      // Build a map of node_id -> member user_ids (from org_chart_node_members)
      const nodeMemberIds = new Map<string, Set<string>>()
      orgChartNodeMembers.forEach(member => {
        if (!nodeMemberIds.has(member.node_id)) {
          nodeMemberIds.set(member.node_id, new Set())
        }
        nodeMemberIds.get(member.node_id)!.add(member.user_id)
      })

      // Helper to get all portfolio node IDs under a team (direct children + linked)
      const getTeamPortfolioNodeIds = (teamId: string): string[] => {
        const portfolioNodeIds: string[] = []

        // Direct portfolio children
        orgChartNodes
          .filter(n => n.node_type === 'portfolio' && n.parent_id === teamId)
          .forEach(p => portfolioNodeIds.push(p.id))

        // Linked portfolios (portfolios linked to this team via org_chart_node_links)
        orgChartNodeLinks
          .filter(link => link.linked_node_id === teamId)
          .forEach(link => {
            const linkedNode = orgChartNodes.find(n => n.id === link.node_id)
            if (linkedNode?.node_type === 'portfolio') {
              portfolioNodeIds.push(linkedNode.id)
            }
          })

        return portfolioNodeIds
      }

      // Calculate coverage stats for each team based on member coverage
      const stats: Record<string, { assetCount: number; analystCount: number }> = {}

      if (orgChartNodes) {
        const teamNodes = orgChartNodes.filter(n => n.node_type === 'team')

        teamNodes.forEach(team => {
          const assets = new Set<string>()
          const analysts = new Set<string>()

          // Get all portfolio node IDs under this team
          const portfolioNodeIds = getTeamPortfolioNodeIds(team.id)

          // For each portfolio, get its members and their coverage
          portfolioNodeIds.forEach(portfolioNodeId => {
            const memberIds = nodeMemberIds.get(portfolioNodeId) || new Set()
            memberIds.forEach(userId => {
              const userAssets = userCoverage.get(userId)
              if (userAssets && userAssets.size > 0) {
                analysts.add(userId)
                userAssets.forEach(assetId => assets.add(assetId))
              }
            })
          })

          if (assets.size > 0 || analysts.size > 0) {
            stats[team.id] = {
              assetCount: assets.size,
              analystCount: analysts.size
            }
          }
        })
      }

      console.log('Coverage stats by team (membership-based):', stats)
      return stats
    },
    enabled: !!orgChartNodes && orgChartNodes.length > 0
  })

  // Helper to get portfolio IDs for a given team
  const getPortfolioIdsForTeam = (teamId: string): string[] => {
    if (!orgChartNodes) return []

    const portfolioNodes = orgChartNodes.filter(n => n.node_type === 'portfolio' && n.settings?.portfolio_id)
    const teamPortfolios = portfolioNodes.filter(p => p.parent_id === teamId)

    return teamPortfolios
      .map(p => p.settings?.portfolio_id)
      .filter((id): id is string => !!id)
  }

  // Coverage settings state for editing
  const [editingCoverageSettings, setEditingCoverageSettings] = useState<{
    default_visibility: 'team' | 'division' | 'firm'
    enable_hierarchy: boolean
    hierarchy_levels: Array<{ name: string; exclusive: boolean }>
    visibility_change_permission: 'anyone' | 'team_lead' | 'coverage_admin'
    allow_multiple_coverage: boolean
  } | null>(null)
  const [showCoverageSettingsConfirm, setShowCoverageSettingsConfirm] = useState(false)
  const [isCoverageSettingsLocked, setIsCoverageSettingsLocked] = useState(true)

  // Helper to convert old string[] format to new object format
  const normalizeHierarchyLevels = (levels: any): Array<{ name: string; exclusive: boolean }> => {
    if (!levels || !Array.isArray(levels)) {
      return [{ name: 'Lead Analyst', exclusive: true }, { name: 'Analyst', exclusive: false }]
    }
    // Check if already in object format
    if (levels.length > 0 && typeof levels[0] === 'object' && 'name' in levels[0]) {
      return levels
    }
    // Convert from string array to object array
    return levels.map((name: string, index: number) => ({
      name: name || '',
      exclusive: index === 0 // First level is exclusive by default
    }))
  }

  // Initialize editing state when coverage settings are loaded
  useEffect(() => {
    if (coverageSettings && !editingCoverageSettings) {
      setEditingCoverageSettings({
        default_visibility: coverageSettings.default_visibility || 'team',
        enable_hierarchy: coverageSettings.enable_hierarchy || false,
        hierarchy_levels: normalizeHierarchyLevels(coverageSettings.hierarchy_levels),
        visibility_change_permission: coverageSettings.visibility_change_permission || 'coverage_admin',
        allow_multiple_coverage: coverageSettings.allow_multiple_coverage !== false // default true
      })
    }
  }, [coverageSettings])

  // Get members for a specific node
  const getNodeMembers = (nodeId: string) => {
    return orgChartNodeMembers.filter(m => m.node_id === nodeId)
  }

  // Compute shared portfolios - portfolios that are linked to multiple teams via org_chart_node_links
  // Returns a map of node_id -> array of team names that share it
  const sharedPortfoliosMap = React.useMemo(() => {
    const shared = new Map<string, string[]>()

    // Group links by node_id to find all teams a portfolio is linked to
    const linksByNode = new Map<string, string[]>()
    orgChartNodeLinks.forEach(link => {
      if (!linksByNode.has(link.node_id)) {
        linksByNode.set(link.node_id, [])
      }
      linksByNode.get(link.node_id)!.push(link.linked_node_id)
    })

    // For each linked portfolio, get the names of all linked teams
    linksByNode.forEach((linkedNodeIds, nodeId) => {
      const teamNames = linkedNodeIds
        .map(linkedId => orgChartNodes.find(n => n.id === linkedId)?.name)
        .filter((name): name is string => !!name)
      if (teamNames.length > 0) {
        shared.set(nodeId, teamNames)
      }
    })

    return shared
  }, [orgChartNodes, orgChartNodeLinks])

  // Get shared teams for a node (returns array of team names this portfolio is shared with)
  const getSharedTeams = (nodeId: string): string[] => {
    return sharedPortfoliosMap.get(nodeId) || []
  }

  // Build tree structure from flat nodes, including linked portfolios
  const buildNodeTree = (nodes: OrgChartNode[], parentId: string | null = null): OrgChartNode[] => {
    // Get direct children (by parent_id)
    const directChildren = nodes
      .filter(node => node.parent_id === parentId)
      .map(node => ({
        ...node,
        isLinkedInstance: false,
        children: buildNodeTree(nodes, node.id)
      }))

    // Get linked portfolios (portfolios linked to this node via org_chart_node_links)
    // Only add linked portfolios if parentId is not null (we're building children of a team/division)
    const linkedChildren: OrgChartNode[] = []
    if (parentId) {
      // Find all links where linked_node_id === parentId (this team has portfolios linked to it)
      const linksToThisTeam = orgChartNodeLinks.filter(link => link.linked_node_id === parentId)

      linksToThisTeam.forEach(link => {
        const linkedNode = nodes.find(n => n.id === link.node_id)
        // Only include if this is not already a direct child (parent_id !== parentId)
        if (linkedNode && linkedNode.parent_id !== parentId) {
          linkedChildren.push({
            ...linkedNode,
            isLinkedInstance: true, // Mark this as a linked instance
            children: [] // Linked instances don't show their own children to avoid duplication
          } as OrgChartNode)
        }
      })
    }

    return [...directChildren, ...linkedChildren].sort((a, b) => a.sort_order - b.sort_order)
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

  // Update user permissions mutation
  const updateUserPermissionsMutation = useMutation({
    mutationFn: async ({ userId, permissions }: { userId: string; permissions: { coverage_admin?: boolean; is_org_admin?: boolean } }) => {
      console.log('Updating permissions for user:', userId, permissions)

      // Update user-level permissions (coverage_admin) in users table
      if (permissions.coverage_admin !== undefined) {
        const { error: userError } = await supabase
          .from('users')
          .update({ coverage_admin: permissions.coverage_admin })
          .eq('id', userId)

        if (userError) {
          console.error('Error updating coverage_admin:', userError)
          throw userError
        }
      }

      // Update org-level permissions (is_org_admin) in organization_memberships table
      if (permissions.is_org_admin !== undefined && organization) {
        const { error: membershipError } = await supabase
          .from('organization_memberships')
          .update({ is_org_admin: permissions.is_org_admin })
          .eq('user_id', userId)
          .eq('organization_id', organization.id)

        if (membershipError) {
          console.error('Error updating is_org_admin:', membershipError)
          throw membershipError
        }
      }
    },
    onSuccess: () => {
      console.log('Permissions updated successfully')
      queryClient.invalidateQueries({ queryKey: ['organization-members'] })
    },
    onError: (error: any) => {
      console.error('Failed to update permissions:', error)
      alert(`Failed to update permissions: ${error?.message || 'Unknown error'}`)
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
      childIdsToReparent?: string[] // For inserting between nodes
      is_non_investment?: boolean
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
        // This is a team reference - we need to create/find an org_chart_node for this team
        teamId = nodeData.parent_id.replace('team:', '')

        // First check if an org_chart_node already exists for this team
        const { data: existingNode } = await supabase
          .from('org_chart_nodes')
          .select('id')
          .eq('organization_id', organization.id)
          .eq('node_type', 'team')
          .contains('settings', { team_id: teamId })
          .single()

        if (existingNode) {
          // Use existing node as parent
          actualParentId = existingNode.id
        } else {
          // Get the team details to create a node for it
          const { data: team } = await supabase
            .from('teams')
            .select('id, name')
            .eq('id', teamId)
            .single()

          if (team) {
            // Create an org_chart_node for this team first
            const { data: newTeamNode, error: teamNodeError } = await supabase
              .from('org_chart_nodes')
              .insert({
                organization_id: organization.id,
                node_type: 'team',
                name: team.name,
                color: '#6366f1',
                icon: 'users',
                sort_order: 0,
                settings: { team_id: teamId },
                created_by: user?.id
              })
              .select()
              .single()

            if (teamNodeError) throw teamNodeError

            // Update the team to reference this org_chart_node
            await supabase
              .from('teams')
              .update({ org_chart_node_id: newTeamNode.id })
              .eq('id', teamId)

            actualParentId = newTeamNode.id
          }
        }
        // Clear teamId since we've handled it by creating/finding the parent node
        teamId = null
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
        created_by: user?.id,
        is_non_investment: nodeData.is_non_investment || false
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
      return { newNode: data, childIdsToReparent: nodeData.childIdsToReparent }
    },
    onSuccess: async (result) => {
      // If we're inserting between nodes, re-parent the children to the new node
      if (result.childIdsToReparent && result.childIdsToReparent.length > 0) {
        const { error } = await supabase
          .from('org_chart_nodes')
          .update({ parent_id: result.newNode.id })
          .in('id', result.childIdsToReparent)

        if (error) {
          console.error('Error re-parenting children:', error)
        }
      }

      queryClient.invalidateQueries({ queryKey: ['org-chart-nodes'] })
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      setShowAddNodeModal(false)
      setAddNodeParentId(null)
      setInsertBetweenChildIds(null)
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
      is_non_investment?: boolean
    }) => {
      const { data, error } = await supabase
        .from('org_chart_nodes')
        .update({
          name: nodeData.name,
          description: nodeData.description,
          color: nodeData.color,
          icon: nodeData.icon,
          custom_type_label: nodeData.custom_type_label,
          is_non_investment: nodeData.is_non_investment || false,
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
      // First, get the node to find its parent_id
      const { data: nodeToDelete, error: fetchError } = await supabase
        .from('org_chart_nodes')
        .select('parent_id')
        .eq('id', nodeId)
        .single()

      if (fetchError) throw fetchError

      // Re-parent any child nodes to the deleted node's parent
      const { error: reparentError } = await supabase
        .from('org_chart_nodes')
        .update({ parent_id: nodeToDelete.parent_id })
        .eq('parent_id', nodeId)
        .eq('is_active', true)

      if (reparentError) throw reparentError

      // Now soft-delete the node
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
    mutationFn: async (memberData: { node_id: string; user_id: string; role: string; focus?: string; is_coverage_admin?: boolean }) => {
      const { data, error } = await supabase
        .from('org_chart_node_members')
        .insert({
          node_id: memberData.node_id,
          user_id: memberData.user_id,
          role: memberData.role,
          focus: memberData.focus || null,
          is_coverage_admin: memberData.is_coverage_admin || false,
          created_by: user?.id
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-chart-node-members'] })
      queryClient.invalidateQueries({ queryKey: ['user-coverage-admin-nodes'] })
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

  // Toggle coverage admin status for a node member
  const toggleNodeMemberCoverageAdminMutation = useMutation({
    mutationFn: async ({ memberId, isCoverageAdmin }: { memberId: string; isCoverageAdmin: boolean }) => {
      const { error } = await supabase
        .from('org_chart_node_members')
        .update({ is_coverage_admin: isCoverageAdmin })
        .eq('id', memberId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-chart-node-members'] })
      queryClient.invalidateQueries({ queryKey: ['user-coverage-admin-nodes'] })
    }
  })

  // Toggle coverage admin blocked status for a node member
  const toggleNodeMemberCoverageAdminBlockedMutation = useMutation({
    mutationFn: async ({ memberId, isBlocked }: { memberId: string; isBlocked: boolean }) => {
      const { error } = await supabase
        .from('org_chart_node_members')
        .update({ coverage_admin_blocked: isBlocked })
        .eq('id', memberId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-chart-node-members'] })
    }
  })

  // Toggle coverage admin override for a node
  const toggleNodeCoverageOverrideMutation = useMutation({
    mutationFn: async ({ nodeId, hasOverride }: { nodeId: string; hasOverride: boolean }) => {
      const { error } = await supabase
        .from('org_chart_nodes')
        .update({ coverage_admin_override: hasOverride })
        .eq('id', nodeId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-chart-nodes'] })
      queryClient.invalidateQueries({ queryKey: ['coverage-admin-override-nodes'] })
    }
  })

  // Save coverage settings mutation
  const saveCoverageSettingsMutation = useMutation({
    mutationFn: async (settings: {
      default_visibility: 'team' | 'division' | 'firm'
      enable_hierarchy: boolean
      hierarchy_levels: Array<{ name: string; exclusive: boolean }>
      visibility_change_permission: 'anyone' | 'team_lead' | 'coverage_admin'
      allow_multiple_coverage: boolean
    }) => {
      if (!organization?.id) throw new Error('No organization found')

      const { data: existing } = await supabase
        .from('coverage_settings')
        .select('id')
        .eq('organization_id', organization.id)
        .single()

      if (existing) {
        // Update existing settings
        const { error } = await supabase
          .from('coverage_settings')
          .update({
            ...settings,
            updated_at: new Date().toISOString(),
            updated_by: user?.id
          })
          .eq('organization_id', organization.id)

        if (error) throw error
      } else {
        // Insert new settings
        const { error } = await supabase
          .from('coverage_settings')
          .insert({
            organization_id: organization.id,
            ...settings,
            updated_by: user?.id
          })

        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['coverage-settings'] })
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

  // Get portfolio team members (from portfolio_team table - unified with Portfolio Tab)
  const getPortfolioTeamMembers = (portfolioId: string) => {
    return portfolioTeamMembers.filter(ptm => ptm.portfolio_id === portfolioId)
  }

  // Recursively collect all portfolio team members from a node and its descendants
  const getAllPortfolioTeamMembersForNode = (node: OrgChartNode): PortfolioTeamMember[] => {
    const result: PortfolioTeamMember[] = []

    // If this is a portfolio node, get its portfolio_team members
    const linkedPortfolioId = node.node_type === 'portfolio' ? node.settings?.portfolio_id : null
    if (linkedPortfolioId) {
      const members = getPortfolioTeamMembers(linkedPortfolioId)
      result.push(...members)
    }

    // Recursively collect from children
    if (node.children && node.children.length > 0) {
      node.children.forEach(child => {
        result.push(...getAllPortfolioTeamMembersForNode(child))
      })
    }

    return result
  }

  // Helper to get display name from portfolio team member
  const getTeamMemberDisplayName = (member: PortfolioTeamMember) => {
    if (member.user?.first_name || member.user?.last_name) {
      return `${member.user.first_name || ''} ${member.user.last_name || ''}`.trim()
    }
    return member.user?.email?.split('@')[0] || 'Unknown'
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

  // Helper to check if current user is a member of an org chart node (team)
  const isUserMemberOfNode = (nodeId: string): boolean => {
    if (!user?.id) return false
    // Check org_chart_node_members
    const nodeMembers = orgChartNodeMembers.filter(m => m.node_id === nodeId)
    if (nodeMembers.some(m => m.user_id === user.id)) return true
    // For team nodes, also check team_memberships via settings.team_id
    const node = orgChartNodes.find(n => n.id === nodeId)
    if (node?.node_type === 'team' && node.settings?.team_id) {
      return teamMemberships.some(tm => tm.team_id === node.settings.team_id && tm.user_id === user.id)
    }
    return false
  }

  // State for node join request
  const [nodeJoinRequest, setNodeJoinRequest] = useState<OrgChartNode | null>(null)

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

  // Org chart panning handlers
  const handlePanStart = (e: React.MouseEvent) => {
    // Only start panning on left-click and if clicking on the background
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    // Don't start panning if clicking on interactive elements
    if (target.closest('button') || target.closest('input') || target.closest('[data-no-pan]')) return

    const container = orgChartContainerRef.current
    if (!container) return

    setIsPanning(true)
    setPanStart({ x: e.clientX, y: e.clientY })
    setScrollStart({ x: container.scrollLeft, y: container.scrollTop })
    e.preventDefault()
  }

  const handlePanMove = (e: React.MouseEvent) => {
    if (!isPanning) return
    const container = orgChartContainerRef.current
    if (!container) return

    const deltaX = e.clientX - panStart.x
    const deltaY = e.clientY - panStart.y

    container.scrollLeft = scrollStart.x - deltaX
    container.scrollTop = scrollStart.y - deltaY
  }

  const handlePanEnd = () => {
    setIsPanning(false)
  }

  // Handle mouse leaving the container
  useEffect(() => {
    const handleMouseUp = () => {
      if (isPanning) {
        setIsPanning(false)
      }
    }

    window.addEventListener('mouseup', handleMouseUp)
    return () => window.removeEventListener('mouseup', handleMouseUp)
  }, [isPanning])

  // Close admin badge dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (adminBadgeRef.current && !adminBadgeRef.current.contains(event.target as Node)) {
        setShowAdminBadgeDropdown(false)
      }
    }

    if (showAdminBadgeDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showAdminBadgeDropdown])

  // Determine current user's coverage admin status
  const currentUserMembership = orgMembers.find(m => m.user_id === user?.id)
  const hasGlobalCoverageAdmin = currentUserMembership?.user?.coverage_admin || false
  const hasNodeLevelCoverageAdmin = userCoverageAdminNodes.length > 0
  const isCoverageAdmin = hasGlobalCoverageAdmin || hasNodeLevelCoverageAdmin
  const isAdminBadgeReady = !isLoadingOrgMembers && (orgMembers.length === 0 || currentUserMembership !== undefined)

  // Helper function to check if user can manage coverage admins for a specific node
  // Returns true if:
  // 1. User is org admin, OR
  // 2. User has global coverage_admin and node doesn't have override, OR
  // 3. User is coverage admin for this node, OR
  // 4. User is coverage admin for an ancestor node (respecting overrides)
  const canManageCoverageAdminsForNode = (nodeId: string): boolean => {
    // Org admins can always manage
    if (isOrgAdmin) return true

    const node = orgChartNodes.find(n => n.id === nodeId)
    const hasOverride = node?.coverage_admin_override || false

    // Global coverage admin can manage unless node has override
    if (isCoverageAdmin && !hasOverride) return true

    // Check if user is explicitly a coverage admin for this node
    if (userCoverageAdminNodes.includes(nodeId)) return true

    // Check if user is coverage admin for any ancestor (cascading)
    // But stop if we hit an override node
    const nodeMap = new Map(orgChartNodes.map(n => [n.id, n]))
    let currentNode = nodeMap.get(nodeId)

    while (currentNode?.parent_id) {
      // If current node has override, stop checking ancestors
      if (currentNode.coverage_admin_override) break

      // Check if user is coverage admin for this ancestor
      if (userCoverageAdminNodes.includes(currentNode.parent_id)) return true

      currentNode = nodeMap.get(currentNode.parent_id)
    }

    return false
  }

  return (
    <div className={`h-full flex flex-col ${activeTab === 'teams' ? 'bg-white' : 'bg-gray-50'}`}>
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center">
              <Building2 className="w-6 h-6 text-indigo-600" />
            </div>
            <div className="flex items-center space-x-3">
              <h1 className="text-xl font-semibold text-gray-900">
                {organization?.name || 'Organization'}
              </h1>
              {/* Admin Badge */}
              <div className="relative" ref={adminBadgeRef}>
                <button
                  onClick={() => isAdminBadgeReady && setShowAdminBadgeDropdown(!showAdminBadgeDropdown)}
                  disabled={!isAdminBadgeReady}
                  className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium transition-all cursor-pointer ${
                    !isAdminBadgeReady
                      ? 'blur-sm opacity-50 bg-gray-100 text-gray-600'
                      : isOrgAdmin || isCoverageAdmin
                      ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <Shield className="w-3 h-3 mr-1" />
                  {!isAdminBadgeReady
                    ? 'Permissions'
                    : isOrgAdmin && hasGlobalCoverageAdmin
                    ? 'Full Admin'
                    : isOrgAdmin
                    ? 'Org Admin'
                    : hasGlobalCoverageAdmin
                    ? 'Coverage Admin'
                    : hasNodeLevelCoverageAdmin
                    ? 'Coverage Admin (Limited)'
                    : 'Read Access'}
                </button>

                {/* Dropdown */}
                {showAdminBadgeDropdown && (
                  <div className="absolute left-0 top-full mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
                    <div className="p-3 border-b border-gray-100">
                      <h3 className="text-sm font-medium text-gray-900">Your Permissions</h3>
                    </div>
                    <div className="p-3 space-y-3">
                      {/* Org Admin Status */}
                      <div className="flex items-start space-x-3">
                        <div className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center ${
                          isOrgAdmin ? 'bg-green-100' : 'bg-gray-100'
                        }`}>
                          {isOrgAdmin ? (
                            <Check className="w-3 h-3 text-green-600" />
                          ) : (
                            <X className="w-3 h-3 text-gray-400" />
                          )}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-900">Organization Admin</p>
                          <p className="text-xs text-gray-500">
                            {isOrgAdmin
                              ? 'Can manage teams, members, and settings'
                              : 'Cannot modify organization structure'}
                          </p>
                        </div>
                      </div>

                      {/* Coverage Admin Status */}
                      <div className="flex items-start space-x-3">
                        <div className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center ${
                          isCoverageAdmin ? 'bg-green-100' : 'bg-gray-100'
                        }`}>
                          {isCoverageAdmin ? (
                            <Check className="w-3 h-3 text-green-600" />
                          ) : (
                            <X className="w-3 h-3 text-gray-400" />
                          )}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-900">
                            Coverage Admin
                            {hasGlobalCoverageAdmin && hasNodeLevelCoverageAdmin ? '' :
                             hasNodeLevelCoverageAdmin ? ' (Limited)' : ''}
                          </p>
                          <p className="text-xs text-gray-500">
                            {hasGlobalCoverageAdmin
                              ? 'Can manage coverage assignments globally'
                              : hasNodeLevelCoverageAdmin
                              ? `Admin for ${userCoverageAdminNodes.length} node${userCoverageAdminNodes.length > 1 ? 's' : ''}`
                              : 'Can only manage own coverage assignments'}
                          </p>
                        </div>
                      </div>

                      {/* Node-level coverage admin details */}
                      {hasNodeLevelCoverageAdmin && !hasGlobalCoverageAdmin && (
                        <div className="pt-2 border-t border-gray-100">
                          <p className="text-xs font-medium text-gray-500 mb-2">Coverage admin for:</p>
                          <div className="space-y-1 max-h-24 overflow-y-auto">
                            {userCoverageAdminNodes.slice(0, 5).map(nodeId => {
                              const node = orgChartNodes.find(n => n.id === nodeId)
                              return node ? (
                                <div key={nodeId} className="flex items-center space-x-2 text-xs">
                                  <div
                                    className="w-2 h-2 rounded-full"
                                    style={{ backgroundColor: node.color }}
                                  />
                                  <span className="text-gray-700">{node.name}</span>
                                </div>
                              ) : null
                            })}
                            {userCoverageAdminNodes.length > 5 && (
                              <p className="text-xs text-gray-400">
                                +{userCoverageAdminNodes.length - 5} more
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Read Access (shown when no admin permissions) */}
                      {!isOrgAdmin && !isCoverageAdmin && (
                        <div className="flex items-start space-x-3 pt-2 border-t border-gray-100">
                          <div className="mt-0.5 w-5 h-5 rounded-full flex items-center justify-center bg-blue-100">
                            <Check className="w-3 h-3 text-blue-600" />
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-900">Read Access</p>
                            <p className="text-xs text-gray-500">
                              Can view organization structure and team information
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            {isOrgAdmin && activeTab === 'people' && (
              <Button onClick={() => setShowAddContactModal(true)}>
                <UserPlus className="w-4 h-4 mr-2" />
                Add Person
              </Button>
            )}
            {!isOrgAdmin && (() => {
              const pendingCount = myAccessRequests.filter(r => r.status === 'pending').length
              const myTeamIds = teamMemberships.filter(tm => tm.user_id === user?.id).map(tm => tm.team_id)
              const teamsNotJoined = teams.filter(t => !myTeamIds.includes(t.id))

              // Show button if there are teams to join or pending requests
              if (teamsNotJoined.length > 0 || pendingCount > 0) {
                return (
                  <Button
                    variant="outline"
                    onClick={() => setShowRequestModal(true)}
                  >
                    {pendingCount > 0 ? (
                      <>
                        <Clock className="w-4 h-4 mr-2" />
                        {pendingCount} Pending
                      </>
                    ) : (
                      <>
                        <Mail className="w-4 h-4 mr-2" />
                        Request Access
                      </>
                    )}
                  </Button>
                )
              }
              return null
            })()}
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

      {/* My Requests Banner (for non-admins) */}
      {!isOrgAdmin && myAccessRequests.length > 0 && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-amber-100">
                <Clock className="w-4 h-4 text-amber-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-amber-900">
                  You have {myAccessRequests.filter(r => r.status === 'pending').length} pending request{myAccessRequests.filter(r => r.status === 'pending').length !== 1 ? 's' : ''}
                </p>
                <p className="text-xs text-amber-700">
                  {myAccessRequests.filter(r => r.status === 'pending').length > 0
                    ? 'Waiting for admin approval'
                    : `${myAccessRequests.length} total request${myAccessRequests.length !== 1 ? 's' : ''}`}
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              {myAccessRequests.slice(0, 3).map(request => (
                <span
                  key={request.id}
                  className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                    request.status === 'pending'
                      ? 'bg-amber-100 text-amber-800'
                      : request.status === 'approved'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-red-100 text-red-800'
                  }`}
                >
                  {request.target_team?.name || request.target_portfolio?.name || request.request_type}
                  {request.status === 'pending' && <Clock className="w-3 h-3 ml-1" />}
                  {request.status === 'approved' && <Check className="w-3 h-3 ml-1" />}
                  {request.status === 'denied' && <X className="w-3 h-3 ml-1" />}
                </span>
              ))}
              {myAccessRequests.length > 3 && (
                <span className="text-xs text-amber-600">+{myAccessRequests.length - 3} more</span>
              )}
            </div>
          </div>
        </div>
      )}

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
      <div
        ref={activeTab === 'teams' ? orgChartContainerRef : undefined}
        className={`flex-1 overflow-auto ${activeTab === 'teams' ? 'p-0 bg-white scrollbar-hide select-none' : 'p-6'}`}
        style={activeTab === 'teams' ? { cursor: isPanning ? 'grabbing' : 'grab' } : undefined}
        onMouseDown={activeTab === 'teams' ? handlePanStart : undefined}
        onMouseMove={activeTab === 'teams' ? handlePanMove : undefined}
        onMouseUp={activeTab === 'teams' ? handlePanEnd : undefined}
        onMouseLeave={activeTab === 'teams' ? handlePanEnd : undefined}
        onClick={activeTab === 'teams' ? () => setExpandedMembersNodeId(null) : undefined}
      >
        <div className={activeTab === 'people' ? '' : activeTab === 'teams' ? 'min-w-max p-6' : activeTab === 'portfolios' ? 'max-w-7xl mx-auto' : 'max-w-5xl mx-auto'}>
          {/* Teams Tab - Interactive Org Chart */}
          {activeTab === 'teams' && (
            <div>
              {/* Org Chart Header - Organization Root Node */}
              <div className="flex flex-col items-center">
                <div className="relative group/org">
                  {/* Hover overlay for admin - Add button (only show when no nodes exist) */}
                  {isOrgAdmin && nodeTree.length === 0 && (
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
                    <p className="text-xs text-gray-500 mt-0.5">{orgMembers.length} members</p>
                  </div>
                </div>

                {/* Vertical connector from root to horizontal line - with insert button */}
                {nodeTree.length > 0 && (
                  <div className="relative group/connector">
                    <div className="w-0.5 h-8 bg-gray-300" />
                    {/* Insert button - appears on hover */}
                    {isOrgAdmin && (
                      <button
                        onClick={() => {
                          setAddNodeParentId(null)
                          setInsertBetweenChildIds(nodeTree.map(n => n.id))
                          setShowAddNodeModal(true)
                        }}
                        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-5 bg-indigo-500 hover:bg-indigo-600 rounded-full flex items-center justify-center opacity-0 group-hover/connector:opacity-100 transition-opacity shadow-md z-10"
                        title="Insert node between"
                      >
                        <Plus className="w-3 h-3 text-white" />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Children container with proper connectors */}
              {nodeTree.length > 0 && (
                <div className="flex flex-col items-center">
                  {/* Children nodes with T-connectors */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
                    {/* Org Chart Nodes - hierarchical structure */}
                    {nodeTree.map((node, nodeIndex) => {
                      const isFirstNode = nodeIndex === 0
                      const isLastNode = nodeIndex === nodeTree.length - 1

                      return (
                        <div key={node.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '220px', flexShrink: 0, marginLeft: nodeIndex > 0 ? '20px' : '0' }}>
                          {/* T-connector with overlapping lines */}
                          <div style={{ position: 'relative', width: '100%', height: '24px', overflow: 'visible' }}>
                            {/* Left horizontal segment - extends into the margin gap */}
                            {!isFirstNode && (
                              <div style={{
                                position: 'absolute',
                                top: '0',
                                left: '-20px',
                                width: 'calc(50% + 21px)',
                                height: '2px',
                                backgroundColor: '#d1d5db'
                              }} />
                            )}
                            {/* Right horizontal segment - extends into the margin gap */}
                            {!isLastNode && (
                              <div style={{
                                position: 'absolute',
                                top: '0',
                                right: '-20px',
                                width: 'calc(50% + 21px)',
                                height: '2px',
                                backgroundColor: '#d1d5db'
                              }} />
                            )}
                            {/* Center vertical drop */}
                            <div style={{
                              position: 'absolute',
                              top: '0',
                              left: '50%',
                              transform: 'translateX(-50%)',
                              width: '2px',
                              height: '100%',
                              backgroundColor: '#d1d5db'
                            }} />
                          </div>
                          <OrgChartNodeCard
                            node={node}
                            isOrgAdmin={isOrgAdmin}
                            onEdit={(n) => setEditingNode(n)}
                            onAddChild={(parentId) => {
                              setAddNodeParentId(parentId)
                              setShowAddNodeModal(true)
                            }}
                            onAddSibling={(parentId) => {
                              setAddNodeParentId(parentId)
                              setShowAddNodeModal(true)
                            }}
                            onDelete={() => {
                              setDeleteNodeConfirm({ isOpen: true, node })
                            }}
                            onAddMember={(n) => setShowAddNodeMemberModal(n)}
                            onRemoveMember={(memberId) => removeNodeMemberMutation.mutate(memberId)}
                            getNodeMembers={getNodeMembers}
                            getSharedTeams={getSharedTeams}
                            getTeamMembers={getTeamMembers}
                            getTeamPortfolios={getTeamPortfolios}
                            getPortfolioTeamMembers={getPortfolioTeamMembers}
                            onAddTeamMember={(teamId) => {
                              const team = teams.find(t => t.id === teamId)
                              if (team) {
                                setSelectedTeam(team)
                                setShowAddMemberModal(true)
                              }
                            }}
                            onRemoveTeamMember={(memberId) => removeTeamMemberMutation.mutate(memberId)}
                            onInsertBetween={(parentId, childIds) => {
                              setAddNodeParentId(parentId)
                              setInsertBetweenChildIds(childIds)
                              setShowAddNodeModal(true)
                            }}
                            onViewDetails={(n) => setViewingNodeDetails(n)}
                            getCoverageStats={(teamId) => coverageStatsByTeam[teamId]}
                            onViewTeamCoverage={(teamId, teamName) => setViewingTeamCoverage({ teamId, teamName })}
                            parentId={null}
                            onRequestToJoin={(n) => setNodeJoinRequest(n)}
                            isUserMember={isUserMemberOfNode}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Empty State - shown when no nodes exist */}
              {nodeTree.length === 0 && (
                <div className="flex justify-center mt-8">
                  <div className="text-center py-8 px-12 bg-white rounded-lg border border-dashed border-gray-300">
                    <Users className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                    <h3 className="text-sm font-medium text-gray-900 mb-1">No nodes yet</h3>
                    <p className="text-xs text-gray-500 mb-3">
                      {isOrgAdmin ? 'Create your first organization node' : 'No organization nodes have been created yet'}
                    </p>
                    {isOrgAdmin && (
                      <button
                        onClick={() => {
                          setAddNodeParentId(null)
                          setShowAddNodeModal(true)
                        }}
                        className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                      >
                        <Plus className="w-3 h-3 inline mr-1" />
                        Add Node
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
              {/* My Access Summary (for non-admins) */}
              {!isOrgAdmin && user && (
                <Card className="bg-gradient-to-r from-indigo-50 to-purple-50 border-indigo-200">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-indigo-900 flex items-center">
                        <Shield className="w-4 h-4 mr-2" />
                        My Access
                      </h3>
                      <p className="text-xs text-indigo-700 mt-1">Your current permissions and memberships</p>
                    </div>
                    {(() => {
                      const myMembership = orgMembers.find(m => m.user_id === user.id)
                      return myMembership?.user?.coverage_admin && (
                        <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-purple-100 text-purple-800">
                          <Shield className="w-3 h-3 mr-1" />
                          Coverage Admin
                        </span>
                      )
                    })()}
                  </div>
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Teams */}
                    <div className="bg-white rounded-lg p-3 border border-indigo-100">
                      <div className="flex items-center space-x-2 mb-2">
                        <Users className="w-4 h-4 text-indigo-600" />
                        <span className="text-xs font-medium text-gray-700">Teams</span>
                      </div>
                      {(() => {
                        const myTeams = teamMemberships.filter(tm => tm.user_id === user.id)
                        return myTeams.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {myTeams.map(tm => (
                              <span
                                key={tm.id}
                                className="inline-flex items-center px-2 py-0.5 rounded text-xs"
                                style={{
                                  backgroundColor: `${tm.team?.color || '#6366f1'}15`,
                                  color: tm.team?.color || '#6366f1'
                                }}
                              >
                                {tm.team?.name}
                                {tm.is_team_admin && <Crown className="w-2.5 h-2.5 ml-1" />}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-500">No team memberships</p>
                        )
                      })()}
                    </div>
                    {/* Portfolios */}
                    <div className="bg-white rounded-lg p-3 border border-indigo-100">
                      <div className="flex items-center space-x-2 mb-2">
                        <Briefcase className="w-4 h-4 text-purple-600" />
                        <span className="text-xs font-medium text-gray-700">Portfolios</span>
                      </div>
                      {(() => {
                        const myPortfolios = portfolioMemberships.filter(pm => pm.user_id === user.id)
                        return myPortfolios.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {myPortfolios.map(pm => (
                              <span
                                key={pm.id}
                                className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-purple-100 text-purple-700"
                              >
                                {pm.portfolio?.name}
                                {pm.is_portfolio_manager && <Crown className="w-2.5 h-2.5 ml-1" />}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-500">No portfolio access</p>
                        )
                      })()}
                    </div>
                    {/* Role */}
                    <div className="bg-white rounded-lg p-3 border border-indigo-100">
                      <div className="flex items-center space-x-2 mb-2">
                        <UserCircle className="w-4 h-4 text-gray-600" />
                        <span className="text-xs font-medium text-gray-700">Your Role</span>
                      </div>
                      {(() => {
                        const myMembership = orgMembers.find(m => m.user_id === user.id)
                        return (
                          <div className="space-y-1">
                            <p className="text-xs text-gray-900 font-medium">{myMembership?.title || 'Member'}</p>
                            <p className="text-xs text-gray-500">{user.email}</p>
                          </div>
                        )
                      })()}
                    </div>
                  </div>
                </Card>
              )}

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
                      <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
                        {activeMembers.map(member => {
                          const userTeams = getUserTeams(member.user_id)
                          const userPortfolios = getUserPortfolios(member.user_id)

                          return (
                            <div key={member.id} className="px-4 py-3 hover:bg-gray-50 transition-colors">
                              <div className="flex items-center justify-between">
                                {/* Left: User info */}
                                <div className="flex items-center space-x-3 min-w-0 flex-1">
                                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-indigo-600 flex items-center justify-center text-xs font-medium text-white flex-shrink-0">
                                    {member.user?.full_name?.charAt(0) || '?'}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center space-x-2">
                                      <span className="font-medium text-gray-900 text-sm truncate">{member.user?.full_name}</span>
                                      <span className="text-xs text-gray-400 truncate hidden sm:inline">{member.user?.email}</span>
                                    </div>
                                    {member.title && (
                                      <p className="text-xs text-gray-500 truncate">{member.title}</p>
                                    )}
                                  </div>
                                </div>

                                {/* Center: Badges */}
                                <div className="hidden md:flex items-center space-x-1.5 flex-shrink-0 mx-4">
                                  {member.is_org_admin && (
                                    <span className="px-1.5 py-0.5 text-[10px] bg-indigo-100 text-indigo-700 rounded flex items-center">
                                      <Crown className="w-2.5 h-2.5 mr-0.5" />
                                      Admin
                                    </span>
                                  )}
                                  {member.user?.coverage_admin && (
                                    <span className="px-1.5 py-0.5 text-[10px] bg-purple-100 text-purple-700 rounded flex items-center">
                                      <Shield className="w-2.5 h-2.5 mr-0.5" />
                                      Coverage
                                    </span>
                                  )}
                                  {userTeams.slice(0, 2).map(tm => (
                                    <span
                                      key={tm.id}
                                      className="px-1.5 py-0.5 text-[10px] rounded flex items-center"
                                      style={{
                                        backgroundColor: `${tm.team?.color || '#6366f1'}15`,
                                        color: tm.team?.color || '#6366f1'
                                      }}
                                    >
                                      {tm.team?.name}
                                    </span>
                                  ))}
                                  {userTeams.length > 2 && (
                                    <span className="px-1.5 py-0.5 text-[10px] bg-gray-100 text-gray-600 rounded">
                                      +{userTeams.length - 2}
                                    </span>
                                  )}
                                  {userPortfolios.slice(0, 2).map(pm => (
                                    <span
                                      key={pm.id}
                                      className="px-1.5 py-0.5 text-[10px] bg-green-50 text-green-700 rounded flex items-center"
                                    >
                                      {pm.portfolio?.name}
                                    </span>
                                  ))}
                                  {userPortfolios.length > 2 && (
                                    <span className="px-1.5 py-0.5 text-[10px] bg-gray-100 text-gray-600 rounded">
                                      +{userPortfolios.length - 2}
                                    </span>
                                  )}
                                </div>

                                {/* Right: Permission toggles & Actions */}
                                <div className="flex items-center space-x-2 flex-shrink-0">
                                  {/* Permission toggles for org admins */}
                                  {isOrgAdmin && member.user_id !== user?.id ? (
                                    <>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.preventDefault()
                                          e.stopPropagation()
                                          console.log('Org Admin button clicked for user:', member.user_id, 'current value:', member.is_org_admin)
                                          updateUserPermissionsMutation.mutate({
                                            userId: member.user_id,
                                            permissions: { is_org_admin: !member.is_org_admin }
                                          })
                                        }}
                                        disabled={updateUserPermissionsMutation.isPending}
                                        className={`p-1.5 rounded transition-colors ${
                                          member.is_org_admin
                                            ? 'bg-indigo-100 text-indigo-700'
                                            : 'text-gray-300 hover:text-indigo-600 hover:bg-indigo-50'
                                        }`}
                                        title={member.is_org_admin ? 'Remove Org Admin' : 'Make Org Admin'}
                                      >
                                        <Crown className="w-4 h-4" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.preventDefault()
                                          e.stopPropagation()
                                          console.log('Coverage Admin button clicked for user:', member.user_id, 'current value:', member.user?.coverage_admin)
                                          updateUserPermissionsMutation.mutate({
                                            userId: member.user_id,
                                            permissions: { coverage_admin: !member.user?.coverage_admin }
                                          })
                                        }}
                                        disabled={updateUserPermissionsMutation.isPending}
                                        className={`p-1.5 rounded transition-colors ${
                                          member.user?.coverage_admin
                                            ? 'bg-purple-100 text-purple-700'
                                            : 'text-gray-300 hover:text-purple-600 hover:bg-purple-50'
                                        }`}
                                        title={member.user?.coverage_admin ? 'Remove Coverage Admin' : 'Make Coverage Admin'}
                                      >
                                        <Shield className="w-4 h-4" />
                                      </button>
                                      <div className="w-px h-5 bg-gray-200" />
                                      <button
                                        onClick={() => setShowSuspendModal(member)}
                                        className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors"
                                        title="Suspend access"
                                      >
                                        <UserX className="w-4 h-4" />
                                      </button>
                                    </>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {/* Suspended Users (admin only) */}
                  {isOrgAdmin && suspendedMembers.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-sm font-medium text-gray-700 flex items-center">
                        <AlertTriangle className="w-4 h-4 mr-1.5 text-amber-500" />
                        Suspended Users ({suspendedMembers.length})
                      </h3>
                      <div className="bg-amber-50 rounded-lg border border-amber-200 divide-y divide-amber-100">
                        {suspendedMembers.map(member => (
                          <div key={member.id} className="px-4 py-3 flex items-center justify-between">
                            <div className="flex items-center space-x-3">
                              <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center text-xs font-medium text-gray-500">
                                {member.user?.full_name?.charAt(0) || '?'}
                              </div>
                              <div>
                                <div className="flex items-center space-x-2">
                                  <span className="font-medium text-gray-700 text-sm">{member.user?.full_name}</span>
                                  <span className="px-1.5 py-0.5 text-[10px] bg-amber-200 text-amber-800 rounded">
                                    Suspended
                                  </span>
                                </div>
                                <p className="text-xs text-gray-500">{member.user?.email}</p>
                              </div>
                            </div>
                            <button
                              onClick={() => unsuspendUserMutation.mutate(member.id)}
                              disabled={unsuspendUserMutation.isPending}
                              className="px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 rounded transition-colors flex items-center"
                            >
                              <Shield className="w-3 h-3 mr-1" />
                              Restore
                            </button>
                          </div>
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
                  const teamMembers = getPortfolioTeamMembers(portfolio.id)
                  const team = teams.find(t => t.id === portfolio.team_id)

                  // Group members by role
                  const membersByRole: { [role: string]: PortfolioTeamMember[] } = {}
                  teamMembers.forEach(m => {
                    if (!membersByRole[m.role]) membersByRole[m.role] = []
                    membersByRole[m.role].push(m)
                  })

                  return (
                    <Card key={portfolio.id} className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-start space-x-3 flex-1">
                          <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0">
                            <Briefcase className="w-5 h-5 text-green-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <h3 className="font-medium text-gray-900">{portfolio.name}</h3>
                              {isOrgAdmin && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setSelectedPortfolioForTeam(portfolio)
                                    setEditingPortfolioTeamMember(null)
                                    setShowAddPortfolioTeamMemberModal(true)
                                  }}
                                >
                                  <UserPlus className="w-3.5 h-3.5 mr-1" />
                                  Add Member
                                </Button>
                              )}
                            </div>
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
                                {teamMembers.length} team member{teamMembers.length !== 1 ? 's' : ''}
                              </span>
                            </div>

                            {/* Team Members by Role */}
                            {Object.keys(membersByRole).length > 0 && (
                              <div className="mt-3 space-y-2">
                                {Object.entries(membersByRole).map(([role, members]) => (
                                  <div key={role}>
                                    <div className="text-xs font-medium text-gray-500 mb-1">{role}</div>
                                    <div className="flex flex-wrap gap-1">
                                      {members.map(m => (
                                        <div
                                          key={m.id}
                                          className="group inline-flex items-center px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded-full"
                                        >
                                          <span>{getTeamMemberDisplayName(m)}</span>
                                          {m.focus && (
                                            <span className="ml-1 text-gray-400">({m.focus})</span>
                                          )}
                                          {isOrgAdmin && (
                                            <div className="hidden group-hover:flex items-center ml-1 space-x-0.5">
                                              <button
                                                onClick={() => {
                                                  setSelectedPortfolioForTeam(portfolio)
                                                  setEditingPortfolioTeamMember(m)
                                                  setShowAddPortfolioTeamMemberModal(true)
                                                }}
                                                className="p-0.5 hover:bg-gray-200 rounded"
                                                title="Edit"
                                              >
                                                <Edit3 className="w-3 h-3 text-gray-500" />
                                              </button>
                                              <button
                                                onClick={() => setDeletePortfolioTeamConfirm({ isOpen: true, member: m })}
                                                className="p-0.5 hover:bg-red-100 rounded"
                                                title="Remove"
                                              >
                                                <X className="w-3 h-3 text-red-500" />
                                              </button>
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}

                            {teamMembers.length === 0 && (
                              <p className="mt-2 text-xs text-gray-400 italic">No team members assigned</p>
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

              {/* Coverage Settings - Only for coverage admins */}
              {user?.coverage_admin && (
                <Card className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-gray-900">Coverage Settings</h3>
                        {isCoverageSettingsLocked && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-full">
                            <Lock className="h-3 w-3" />
                            Locked
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 mt-1">Configure how coverage works across your organization</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {editingCoverageSettings && (
                        <>
                          {isCoverageSettingsLocked ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setIsCoverageSettingsLocked(false)}
                              className="flex items-center gap-2"
                            >
                              <Lock className="h-4 w-4" />
                              Unlock to Edit
                            </Button>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  // Reset to original settings and lock
                                  if (coverageSettings) {
                                    setEditingCoverageSettings({
                                      default_visibility: coverageSettings.default_visibility || 'team',
                                      enable_hierarchy: coverageSettings.enable_hierarchy || false,
                                      hierarchy_levels: normalizeHierarchyLevels(coverageSettings.hierarchy_levels),
                                      visibility_change_permission: coverageSettings.visibility_change_permission || 'coverage_admin',
                                      allow_multiple_coverage: coverageSettings.allow_multiple_coverage !== false
                                    })
                                  }
                                  setIsCoverageSettingsLocked(true)
                                }}
                                className="flex items-center gap-2"
                              >
                                <X className="h-4 w-4" />
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => setShowCoverageSettingsConfirm(true)}
                                loading={saveCoverageSettingsMutation.isPending}
                              >
                                Save Changes
                              </Button>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {editingCoverageSettings && (
                    <div className="space-y-6">
                      {/* Default Visibility */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Default Coverage Visibility
                        </label>
                        <p className="text-xs text-gray-500 mb-3">
                          When a user adds new coverage, this is the default visibility level
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {[
                            { value: 'team', label: 'Team Only', desc: 'Only team members can see coverage' },
                            { value: 'division', label: 'Division', desc: 'All teams in the division can see' },
                            { value: 'firm', label: 'Firm-wide', desc: 'Everyone in the organization can see' }
                          ].map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              disabled={isCoverageSettingsLocked}
                              onClick={() => setEditingCoverageSettings({
                                ...editingCoverageSettings,
                                default_visibility: option.value as 'team' | 'division' | 'firm'
                              })}
                              className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${
                                editingCoverageSettings.default_visibility === option.value
                                  ? 'bg-indigo-100 border-indigo-500 text-indigo-700'
                                  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                              } ${isCoverageSettingsLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
                              title={option.desc}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Enable Hierarchy */}
                      <div className={isCoverageSettingsLocked ? 'opacity-60' : ''}>
                        <label className={`flex items-center gap-3 ${isCoverageSettingsLocked ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                          <input
                            type="checkbox"
                            checked={editingCoverageSettings.enable_hierarchy}
                            disabled={isCoverageSettingsLocked}
                            onChange={(e) => setEditingCoverageSettings({
                              ...editingCoverageSettings,
                              enable_hierarchy: e.target.checked
                            })}
                            className="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                          />
                          <div>
                            <span className="text-sm font-medium text-gray-700">Enable Coverage Hierarchy</span>
                            <p className="text-xs text-gray-500">Allow defining analyst roles/levels for coverage (e.g., Lead Analyst, Analyst)</p>
                          </div>
                        </label>
                      </div>

                      {/* When hierarchy is DISABLED - show single coverage option */}
                      {!editingCoverageSettings.enable_hierarchy && (
                        <div className={isCoverageSettingsLocked ? 'opacity-60' : ''}>
                          <label className={`flex items-center gap-3 ${isCoverageSettingsLocked ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                            <input
                              type="checkbox"
                              checked={!editingCoverageSettings.allow_multiple_coverage}
                              disabled={isCoverageSettingsLocked}
                              onChange={(e) => setEditingCoverageSettings({
                                ...editingCoverageSettings,
                                allow_multiple_coverage: !e.target.checked
                              })}
                              className="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                            />
                            <div>
                              <span className="text-sm font-medium text-gray-700">Single Analyst Per Security</span>
                              <p className="text-xs text-gray-500">Only one analyst can cover each security at a time (within visibility level)</p>
                            </div>
                          </label>
                        </div>
                      )}

                      {/* Hierarchy Levels - Only show if hierarchy is enabled */}
                      {editingCoverageSettings.enable_hierarchy && (
                        <div className={isCoverageSettingsLocked ? 'opacity-60' : ''}>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Coverage Hierarchy Levels
                          </label>
                          <p className="text-xs text-gray-500 mb-3">
                            Define the hierarchy levels for coverage roles (first level is highest). Mark levels as "exclusive" if only one analyst can hold that role per security.
                          </p>
                          <div className="space-y-2">
                            {editingCoverageSettings.hierarchy_levels.map((level, index) => (
                              <div key={index} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                                <span className="text-xs text-gray-400 w-6">{index + 1}.</span>
                                <input
                                  type="text"
                                  value={level.name}
                                  disabled={isCoverageSettingsLocked}
                                  onChange={(e) => {
                                    const newLevels = [...editingCoverageSettings.hierarchy_levels]
                                    newLevels[index] = { ...newLevels[index], name: e.target.value }
                                    setEditingCoverageSettings({
                                      ...editingCoverageSettings,
                                      hierarchy_levels: newLevels
                                    })
                                  }}
                                  className={`flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${isCoverageSettingsLocked ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                                  placeholder="Role name..."
                                />
                                <label className={`flex items-center gap-1.5 whitespace-nowrap ${isCoverageSettingsLocked ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                                  <input
                                    type="checkbox"
                                    checked={level.exclusive}
                                    disabled={isCoverageSettingsLocked}
                                    onChange={(e) => {
                                      const newLevels = [...editingCoverageSettings.hierarchy_levels]
                                      newLevels[index] = { ...newLevels[index], exclusive: e.target.checked }
                                      setEditingCoverageSettings({
                                        ...editingCoverageSettings,
                                        hierarchy_levels: newLevels
                                      })
                                    }}
                                    className="h-3.5 w-3.5 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                                  />
                                  <span className="text-xs text-gray-600">Exclusive</span>
                                </label>
                                {editingCoverageSettings.hierarchy_levels.length > 1 && !isCoverageSettingsLocked && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const newLevels = editingCoverageSettings.hierarchy_levels.filter((_, i) => i !== index)
                                      setEditingCoverageSettings({
                                        ...editingCoverageSettings,
                                        hierarchy_levels: newLevels
                                      })
                                    }}
                                    className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                            ))}
                            {!isCoverageSettingsLocked && (
                              <button
                                type="button"
                                onClick={() => setEditingCoverageSettings({
                                  ...editingCoverageSettings,
                                  hierarchy_levels: [...editingCoverageSettings.hierarchy_levels, { name: '', exclusive: false }]
                                })}
                                className="flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700 mt-2"
                              >
                                <Plus className="w-4 h-4" />
                                Add Level
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Visibility Change Permission */}
                      <div className={isCoverageSettingsLocked ? 'opacity-60' : ''}>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Who Can Change Visibility
                        </label>
                        <p className="text-xs text-gray-500 mb-3">
                          Control who can modify the visibility of coverage records
                        </p>
                        <select
                          value={editingCoverageSettings.visibility_change_permission}
                          disabled={isCoverageSettingsLocked}
                          onChange={(e) => setEditingCoverageSettings({
                            ...editingCoverageSettings,
                            visibility_change_permission: e.target.value as 'anyone' | 'team_lead' | 'coverage_admin'
                          })}
                          className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${isCoverageSettingsLocked ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                        >
                          <option value="anyone">Anyone (all users can change visibility)</option>
                          <option value="team_lead">Team Leads & Admins</option>
                          <option value="coverage_admin">Coverage Admins Only</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {!editingCoverageSettings && (
                    <div className="text-center py-4 text-gray-500">
                      Loading coverage settings...
                    </div>
                  )}
                </Card>
              )}
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

      {/* Node Join Request Modal */}
      {nodeJoinRequest && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">Request to Join</h3>
              <p className="text-sm text-gray-500 mt-1">
                Request access to <span className="font-medium text-gray-700">{nodeJoinRequest.name}</span>
              </p>
            </div>
            <div className="px-6 py-4">
              <div className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg mb-4">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-white`} style={{ backgroundColor: nodeJoinRequest.color || '#6366f1' }}>
                  {nodeJoinRequest.icon === 'users' && <Users className="w-5 h-5" />}
                  {nodeJoinRequest.icon === 'building' && <Building2 className="w-5 h-5" />}
                  {nodeJoinRequest.icon === 'briefcase' && <Briefcase className="w-5 h-5" />}
                  {nodeJoinRequest.icon === 'folder' && <Folder className="w-5 h-5" />}
                  {!['users', 'building', 'briefcase', 'folder'].includes(nodeJoinRequest.icon) && <Users className="w-5 h-5" />}
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{nodeJoinRequest.name}</p>
                  <p className="text-xs text-gray-500 capitalize">{nodeJoinRequest.node_type}</p>
                </div>
              </div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reason (optional)
              </label>
              <textarea
                id="node-join-reason"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                rows={3}
                placeholder="Why would you like to join this group?"
              />
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end space-x-3">
              <button
                onClick={() => setNodeJoinRequest(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const reason = (document.getElementById('node-join-reason') as HTMLTextAreaElement)?.value
                  submitAccessRequestMutation.mutate({
                    request_type: 'join_node',
                    reason: reason || undefined,
                    // Store node info in reason since we don't have a dedicated column
                    requested_title: `Join ${nodeJoinRequest.node_type}: ${nodeJoinRequest.name} (ID: ${nodeJoinRequest.id})`
                  })
                  setNodeJoinRequest(null)
                }}
                disabled={submitAccessRequestMutation.isPending}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50"
              >
                {submitAccessRequestMutation.isPending ? 'Submitting...' : 'Submit Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Coverage Settings Confirmation Modal */}
      {showCoverageSettingsConfirm && editingCoverageSettings && coverageSettings && (() => {
        // Calculate what actually changed
        const originalSettings = {
          default_visibility: coverageSettings.default_visibility || 'team',
          enable_hierarchy: coverageSettings.enable_hierarchy || false,
          hierarchy_levels: normalizeHierarchyLevels(coverageSettings.hierarchy_levels),
          visibility_change_permission: coverageSettings.visibility_change_permission || 'coverage_admin',
          allow_multiple_coverage: coverageSettings.allow_multiple_coverage !== false
        }

        const changes: Array<{ label: string; from: string; to: string }> = []

        if (editingCoverageSettings.default_visibility !== originalSettings.default_visibility) {
          changes.push({
            label: 'Default Visibility',
            from: originalSettings.default_visibility,
            to: editingCoverageSettings.default_visibility
          })
        }

        if (editingCoverageSettings.enable_hierarchy !== originalSettings.enable_hierarchy) {
          changes.push({
            label: 'Coverage Hierarchy',
            from: originalSettings.enable_hierarchy ? 'Enabled' : 'Disabled',
            to: editingCoverageSettings.enable_hierarchy ? 'Enabled' : 'Disabled'
          })
        }

        if (editingCoverageSettings.allow_multiple_coverage !== originalSettings.allow_multiple_coverage) {
          changes.push({
            label: 'Single Analyst Per Security',
            from: !originalSettings.allow_multiple_coverage ? 'Yes' : 'No',
            to: !editingCoverageSettings.allow_multiple_coverage ? 'Yes' : 'No'
          })
        }

        if (editingCoverageSettings.visibility_change_permission !== originalSettings.visibility_change_permission) {
          const formatPermission = (p: string) => p.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
          changes.push({
            label: 'Visibility Change Permission',
            from: formatPermission(originalSettings.visibility_change_permission),
            to: formatPermission(editingCoverageSettings.visibility_change_permission)
          })
        }

        // Check if hierarchy levels changed
        const origLevels = JSON.stringify(originalSettings.hierarchy_levels)
        const newLevels = JSON.stringify(editingCoverageSettings.hierarchy_levels)
        if (origLevels !== newLevels) {
          changes.push({
            label: 'Hierarchy Levels',
            from: originalSettings.hierarchy_levels.map(l => l.name).join(', ') || 'None',
            to: editingCoverageSettings.hierarchy_levels.map(l => l.name).join(', ') || 'None'
          })
        }

        return (
          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="fixed inset-0 bg-black bg-opacity-50 transition-opacity" onClick={() => setShowCoverageSettingsConfirm(false)} />
            <div className="flex min-h-full items-center justify-center p-4">
              <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full mx-auto p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                    <AlertTriangle className="h-5 w-5 text-amber-600" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Confirm Coverage Settings Change</h3>
                  </div>
                </div>

                <div className="mb-6">
                  <p className="text-sm text-gray-600 mb-4">
                    You are about to change organization-wide coverage settings. These changes will affect how all users interact with coverage data.
                  </p>

                  {changes.length > 0 ? (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                      <p className="text-sm font-medium text-amber-800 mb-3">The following will change:</p>
                      <div className="space-y-2">
                        {changes.map((change, idx) => (
                          <div key={idx} className="text-sm">
                            <span className="font-medium text-gray-700">{change.label}:</span>
                            <div className="flex items-center gap-2 mt-0.5 ml-2">
                              <span className="text-red-600 line-through">{change.from}</span>
                              <span className="text-gray-400">→</span>
                              <span className="text-green-600 font-medium">{change.to}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                      <p className="text-sm text-gray-600">No changes detected.</p>
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-3">
                  <Button
                    variant="outline"
                    onClick={() => setShowCoverageSettingsConfirm(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    disabled={changes.length === 0}
                    onClick={() => {
                      saveCoverageSettingsMutation.mutate(editingCoverageSettings)
                      setShowCoverageSettingsConfirm(false)
                      setIsCoverageSettingsLocked(true)
                    }}
                    loading={saveCoverageSettingsMutation.isPending}
                  >
                    Confirm Changes
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

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
          onRequestRemoval={(reason) => submitRemovalRequestMutation.mutate({
            targetUserId: showSuspendModal.user_id,
            reason
          })}
          isLoading={suspendUserMutation.isPending}
          isRemovalLoading={submitRemovalRequestMutation.isPending}
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
          childIdsToReparent={insertBetweenChildIds}
          insertMode={!!insertBetweenChildIds}
          onClose={() => {
            setShowAddNodeModal(false)
            setAddNodeParentId(null)
            setInsertBetweenChildIds(null)
          }}
          onSave={(data) => createNodeMutation.mutate(data)}
          isLoading={createNodeMutation.isPending}
        />
      )}

      {/* Add Node Member Modal */}
      {showAddNodeMemberModal && (
        <AddNodeMemberModal
          node={showAddNodeMemberModal}
          existingMembers={getNodeMembers(showAddNodeMemberModal.id)}
          availableUsers={orgMembers}
          onClose={() => setShowAddNodeMemberModal(null)}
          onSave={(userId, role, focus, isCoverageAdmin) => {
            addNodeMemberMutation.mutate({
              node_id: showAddNodeMemberModal.id,
              user_id: userId,
              role,
              focus,
              is_coverage_admin: isCoverageAdmin
            }, {
              onSuccess: () => setShowAddNodeMemberModal(null)
            })
          }}
          isLoading={addNodeMemberMutation.isPending}
        />
      )}

      {/* Node Detail Modal */}
      {viewingNodeDetails && (
        <NodeDetailModal
          node={viewingNodeDetails}
          members={getNodeMembers(viewingNodeDetails.id)}
          portfolioTeamMembers={getAllPortfolioTeamMembersForNode(viewingNodeDetails)}
          onClose={() => setViewingNodeDetails(null)}
          isAdmin={isOrgAdmin}
          availableUsers={orgMembers}
          onSaveNode={(data) => updateNodeMutation.mutate(data)}
          onAddMember={(nodeId, userId, role, focus) => {
            // For portfolio nodes, add to portfolio_team table
            if (viewingNodeDetails.node_type === 'portfolio' && viewingNodeDetails.settings?.portfolio_id) {
              addPortfolioTeamMemberMutation.mutate({
                portfolioId: viewingNodeDetails.settings.portfolio_id,
                userId,
                role,
                focus
              })
            } else {
              // For other nodes, add to org_chart_node_members
              addNodeMemberMutation.mutate({
                node_id: nodeId,
                user_id: userId,
                role,
                focus
              })
            }
          }}
          onUpdateMember={(memberId, role, focus) => {
            updatePortfolioTeamMemberMutation.mutate({ memberId, role, focus })
          }}
          onRemoveMember={(memberId) => {
            // For portfolio nodes, remove from portfolio_team table
            if (viewingNodeDetails.node_type === 'portfolio') {
              deletePortfolioTeamMemberMutation.mutate(memberId)
            } else {
              removeNodeMemberMutation.mutate(memberId)
            }
          }}
          onToggleCoverageAdmin={(memberId, isCoverageAdmin) => {
            toggleNodeMemberCoverageAdminMutation.mutate({ memberId, isCoverageAdmin })
          }}
          onToggleCoverageAdminBlocked={(memberId, isBlocked) => {
            toggleNodeMemberCoverageAdminBlockedMutation.mutate({ memberId, isBlocked })
          }}
          canManageCoverageAdmins={canManageCoverageAdminsForNode(viewingNodeDetails.id)}
          allOrgChartNodes={orgChartNodes}
          allNodeMembers={orgChartNodeMembers}
          globalCoverageAdminUserIds={new Set(orgMembers.filter(m => m.user?.coverage_admin).map(m => m.user_id))}
          isSaving={updateNodeMutation.isPending}
        />
      )}

      {/* Team Coverage Panel */}
      {viewingTeamCoverage && (
        <TeamCoveragePanel
          teamId={viewingTeamCoverage.teamId}
          teamName={viewingTeamCoverage.teamName}
          portfolioIds={getPortfolioIdsForTeam(viewingTeamCoverage.teamId)}
          onClose={() => setViewingTeamCoverage(null)}
        />
      )}

      {/* Delete Node Confirmation Modal */}
      {deleteNodeConfirm.isOpen && deleteNodeConfirm.node && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4">
            {/* Header */}
            <div className="p-6 border-b border-gray-100">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Delete {deleteNodeConfirm.node.node_type.charAt(0).toUpperCase() + deleteNodeConfirm.node.node_type.slice(1)}</h3>
                  <p className="text-sm text-gray-500">This action cannot be undone</p>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="p-6">
              <p className="text-gray-600 mb-4">
                Are you sure you want to delete <span className="font-semibold text-gray-900">"{deleteNodeConfirm.node.name}"</span>?
              </p>
              {deleteNodeConfirm.node.children && deleteNodeConfirm.node.children.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                  <p className="text-sm text-amber-800">
                    <span className="font-medium">Note:</span> This {deleteNodeConfirm.node.node_type} has {deleteNodeConfirm.node.children.length} child node{deleteNodeConfirm.node.children.length !== 1 ? 's' : ''}.
                    They will be moved up to the parent level and will not be deleted.
                  </p>
                </div>
              )}
              <p className="text-sm text-gray-500">
                The {deleteNodeConfirm.node.node_type} will be removed from the organization structure.
              </p>
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-gray-100 flex justify-end space-x-3">
              <Button
                variant="outline"
                onClick={() => setDeleteNodeConfirm({ isOpen: false, node: null })}
              >
                Cancel
              </Button>
              <Button
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={() => {
                  if (deleteNodeConfirm.node) {
                    deleteNodeMutation.mutate(deleteNodeConfirm.node.id)
                  }
                  setDeleteNodeConfirm({ isOpen: false, node: null })
                }}
                loading={deleteNodeMutation.isPending}
              >
                Delete {deleteNodeConfirm.node.node_type.charAt(0).toUpperCase() + deleteNodeConfirm.node.node_type.slice(1)}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Portfolio Team Member Modal */}
      {showAddPortfolioTeamMemberModal && selectedPortfolioForTeam && (
        <AddTeamMemberModal
          isOpen={showAddPortfolioTeamMemberModal}
          onClose={() => {
            setShowAddPortfolioTeamMemberModal(false)
            setSelectedPortfolioForTeam(null)
            setEditingPortfolioTeamMember(null)
          }}
          portfolioId={selectedPortfolioForTeam.id}
          portfolioName={selectedPortfolioForTeam.name}
          editingMember={editingPortfolioTeamMember ? {
            id: editingPortfolioTeamMember.id,
            user_id: editingPortfolioTeamMember.user_id,
            role: editingPortfolioTeamMember.role,
            focus: editingPortfolioTeamMember.focus
          } : null}
          onMemberAdded={() => {
            // Invalidate both the org-wide query and the portfolio-specific queries
            queryClient.invalidateQueries({ queryKey: ['portfolio-team-all'] })
            if (selectedPortfolioForTeam) {
              queryClient.invalidateQueries({ queryKey: ['portfolio-team-with-users', selectedPortfolioForTeam.id] })
              queryClient.invalidateQueries({ queryKey: ['portfolio-team', selectedPortfolioForTeam.id] })
            }
          }}
        />
      )}

      {/* Delete Portfolio Team Member Confirmation */}
      {deletePortfolioTeamConfirm.isOpen && deletePortfolioTeamConfirm.member && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black bg-opacity-50 transition-opacity" onClick={() => setDeletePortfolioTeamConfirm({ isOpen: false, member: null })} />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full mx-auto transform transition-all p-6">
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900">Remove Team Member</h3>
              </div>
              <p className="text-gray-600 mb-6">
                Are you sure you want to remove <strong>{getTeamMemberDisplayName(deletePortfolioTeamConfirm.member)}</strong> ({deletePortfolioTeamConfirm.member.role}) from this portfolio?
              </p>
              <div className="flex justify-end space-x-3">
                <Button variant="outline" onClick={() => setDeletePortfolioTeamConfirm({ isOpen: false, member: null })}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onClick={() => deletePortfolioTeamMemberMutation.mutate(deletePortfolioTeamConfirm.member!.id)}
                  loading={deletePortfolioTeamMemberMutation.isPending}
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
        .eq('status', 'active')
        .maybeSingle()

      if (error) {
        console.error('Error fetching org membership:', error)
        return { isAdmin: false }
      }

      return { isAdmin: data?.is_org_admin === true }
    },
    enabled: !!user?.id,
    staleTime: 0
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
  onAddSibling?: (parentId: string | null) => void
  onDelete: (nodeId: string) => void
  onAddMember: (node: OrgChartNode) => void
  onRemoveMember: (memberId: string) => void
  getNodeMembers: (nodeId: string) => OrgChartNodeMember[]
  getSharedTeams?: (nodeId: string) => string[]
  getTeamMembers?: (teamId: string) => TeamMember[]
  getTeamPortfolios?: (teamId: string) => Portfolio[]
  getPortfolioTeamMembers?: (portfolioId: string) => PortfolioTeamMember[]
  onAddTeamMember?: (teamId: string) => void
  onRemoveTeamMember?: (memberId: string) => void
  onInsertBetween?: (parentId: string, childIds: string[]) => void
  onViewDetails: (node: OrgChartNode) => void
  getCoverageStats?: (teamId: string) => { assetCount: number; analystCount: number } | undefined
  onViewTeamCoverage?: (teamId: string, teamName: string) => void
  depth?: number
  parentId?: string | null
  onRequestToJoin?: (node: OrgChartNode) => void
  isUserMember?: (nodeId: string) => boolean
}

function OrgChartNodeCard({ node, isOrgAdmin, onEdit, onAddChild, onAddSibling, onDelete, onAddMember, onRemoveMember, getNodeMembers, getSharedTeams, getTeamMembers, getTeamPortfolios, getPortfolioTeamMembers, onAddTeamMember, onRemoveTeamMember, onInsertBetween, onViewDetails, getCoverageStats, onViewTeamCoverage, depth = 0, parentId, onRequestToJoin, isUserMember }: OrgChartNodeCardProps) {
  const [showAddMenu, setShowAddMenu] = useState(false)
  const addMenuRef = useRef<HTMLDivElement>(null)

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(event.target as Node)) {
        setShowAddMenu(false)
      }
    }
    if (showAddMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showAddMenu])

  // For portfolio nodes, get members from portfolio_team table
  const linkedPortfolioId = node.node_type === 'portfolio' ? node.settings?.portfolio_id : null
  const portfolioMembers = linkedPortfolioId && getPortfolioTeamMembers ? getPortfolioTeamMembers(linkedPortfolioId) : []
  const [isExpanded, setIsExpanded] = useState(true)
  const [showSharedTooltip, setShowSharedTooltip] = useState(false)
  const hasChildren = node.children && node.children.length > 0
  const sharedTeams = getSharedTeams?.(node.id) || []
  const isSharedPortfolio = node.node_type === 'portfolio' && sharedTeams.length > 0

  // For team nodes linked to teams table
  // Note: linkedTeamId uses settings.team_id for legacy team lookups
  // but for coverage stats, we use the node.id directly since coverage.team_id references org_chart_nodes.id
  const linkedTeamId = node.node_type === 'team' ? node.settings?.team_id : null
  const coverageTeamId = node.node_type === 'team' ? node.id : null // Use node.id for coverage lookups
  const teamPortfolios = linkedTeamId && getTeamPortfolios ? getTeamPortfolios(linkedTeamId) : []

  // Recursively collect all portfolio team members from this node and all descendants
  const collectAllPortfolioMembers = (n: OrgChartNode): PortfolioTeamMember[] => {
    const result: PortfolioTeamMember[] = []

    // If this is a portfolio node, get its portfolio_team members
    const nodeLinkedPortfolioId = n.node_type === 'portfolio' ? n.settings?.portfolio_id : null
    if (nodeLinkedPortfolioId && getPortfolioTeamMembers) {
      const members = getPortfolioTeamMembers(nodeLinkedPortfolioId)
      result.push(...members)
    }

    // Recursively collect from children
    if (n.children && n.children.length > 0) {
      n.children.forEach(child => {
        result.push(...collectAllPortfolioMembers(child))
      })
    }

    return result
  }

  // Get all portfolio team members from this node and descendants
  const allPortfolioMembers = collectAllPortfolioMembers(node)

  // Calculate total unique member count (by user_id to avoid duplicates)
  const uniqueUserIds = new Set<string>()
  allPortfolioMembers.forEach(m => {
    if (m.user_id) uniqueUserIds.add(m.user_id)
  })
  const totalMemberCount = uniqueUserIds.size

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
    <div className="inline-flex flex-col items-center">
      {/* Node Card Container */}
      <div className="relative group/node">
        {/* Hover overlay actions for admins */}
        {isOrgAdmin && (
          <div className="absolute -top-1 -right-1 opacity-0 group-hover/node:opacity-100 transition-all duration-200 z-20 flex items-center space-x-0.5 bg-white rounded-lg shadow-md p-1">
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDelete(node.id)
              }}
              className="p-1.5 hover:bg-red-50 rounded transition-colors"
              title={`Delete ${getTypeLabel()}`}
            >
              <Trash2 className="w-3.5 h-3.5 text-red-400" />
            </button>
          </div>
        )}

        {/* Request to Join button for non-admins (team nodes only) */}
        {!isOrgAdmin && node.node_type === 'team' && onRequestToJoin && isUserMember && !isUserMember(node.id) && (
          <div className="absolute -top-1 -right-1 opacity-0 group-hover/node:opacity-100 transition-all duration-200 z-20">
            <button
              onClick={(e) => {
                e.stopPropagation()
                onRequestToJoin(node)
              }}
              className="flex items-center space-x-1 px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg shadow-md transition-colors"
              title={`Request to join ${node.name}`}
            >
              <UserPlus className="w-3 h-3" />
              <span>Join</span>
            </button>
          </div>
        )}

        {/* Member indicator for non-admins */}
        {!isOrgAdmin && node.node_type === 'team' && isUserMember && isUserMember(node.id) && (
          <div className="absolute -top-1 -right-1 z-20">
            <span className="inline-flex items-center px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full">
              <Check className="w-3 h-3 mr-0.5" />
              Member
            </span>
          </div>
        )}

        {/* Node Card */}
        <div
          className={`relative border-2 rounded-xl shadow-sm cursor-pointer transition-all hover:shadow-md ${
            node.is_non_investment
              ? 'bg-gray-100 border-gray-300 border-dashed'
              : `bg-white ${isExpanded && hasChildren ? 'border-gray-300' : 'border-gray-200'}`
          }`}
          style={{
            borderTopColor: node.is_non_investment ? '#9ca3af' : node.color,
            borderTopWidth: '3px',
            borderTopStyle: 'solid',
            width: '220px',
            minHeight: '120px'
          }}
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {/* Non-investment indicator */}
          {node.is_non_investment && (
            <div className="absolute top-2 left-2 z-10">
              <span className="inline-flex items-center px-1.5 py-0.5 bg-gray-200 text-gray-600 text-[10px] font-medium rounded">
                Non-Investment
              </span>
            </div>
          )}

          {/* Collaborative/Linked portfolio indicator - positioned in upper-left corner */}
          {(isSharedPortfolio || node.isLinkedInstance) && !node.is_non_investment && (
            <div
              className="absolute top-2 left-2 z-10"
              onMouseEnter={() => setShowSharedTooltip(true)}
              onMouseLeave={() => setShowSharedTooltip(false)}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-center w-5 h-5 rounded-full bg-indigo-100 text-indigo-600">
                <Link2 className="w-3 h-3" />
              </div>
              {/* Tooltip */}
              {showSharedTooltip && (
                <div className="absolute z-30 top-full left-0 mt-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg whitespace-nowrap">
                  <div className="font-medium mb-1">{node.isLinkedInstance ? 'Linked portfolio' : 'Shared with:'}</div>
                  {node.isLinkedInstance ? (
                    <div className="text-gray-300">Primary location: {orgChartNodes.find(n => n.id === node.parent_id)?.name || 'Unknown'}</div>
                  ) : sharedTeams.map((teamName, idx) => (
                    <div key={idx} className="text-gray-300">{teamName}</div>
                  ))}
                  {/* Arrow */}
                  <div className="absolute bottom-full left-2 border-4 border-transparent border-b-gray-900" />
                </div>
              )}
            </div>
          )}
          <div className="p-4 text-center">
            {/* Icon */}
            <div
              className="inline-flex items-center justify-center w-10 h-10 rounded-xl mb-3"
              style={{ backgroundColor: `${node.color}20` }}
            >
              {getNodeIcon()}
            </div>

            {/* Name */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                onViewDetails(node)
              }}
              className="block w-full font-semibold text-gray-900 text-sm hover:text-indigo-600 hover:underline"
            >
              {node.name}
            </button>
            <p className="text-xs text-gray-500 mt-0.5">
              {getTypeLabel()}
              {totalMemberCount > 0 && ` · ${totalMemberCount} member${totalMemberCount !== 1 ? 's' : ''}`}
              {linkedTeamId && teamPortfolios.length > 0 && ` · ${teamPortfolios.length} portfolio${teamPortfolios.length !== 1 ? 's' : ''}`}
            </p>

            {/* Coverage stats for team nodes - always show container for consistent sizing */}
            {coverageTeamId && getCoverageStats && (
              <div className="mt-1.5 text-xs h-[52px] flex flex-col justify-center">
                {(() => {
                  const stats = getCoverageStats(coverageTeamId)
                  if (stats && (stats.assetCount > 0 || stats.analystCount > 0)) {
                    return (
                      <>
                        <div className="flex items-center justify-center gap-2">
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">
                            <Briefcase className="w-3 h-3 mr-1" />
                            {stats.assetCount} asset{stats.assetCount !== 1 ? 's' : ''}
                          </span>
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">
                            <UserCircle className="w-3 h-3 mr-1" />
                            {stats.analystCount} analyst{stats.analystCount !== 1 ? 's' : ''}
                          </span>
                        </div>
                        {onViewTeamCoverage && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              onViewTeamCoverage(coverageTeamId, node.name)
                            }}
                            className="mt-1 text-indigo-600 hover:text-indigo-800 hover:underline text-xs flex items-center justify-center gap-1 w-full"
                          >
                            <ExternalLink className="w-3 h-3" />
                            View Coverage
                          </button>
                        )}
                      </>
                    )
                  }
                  // Show placeholder for empty coverage
                  return (
                    <div className="text-gray-400 text-center">
                      No coverage assigned
                    </div>
                  )
                })()}
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
          </div>
        </div>
      </div>

      {/* Add button below node - always visible on hover for admins */}
      {isOrgAdmin && (
        <div className="relative group/addbutton" style={{ width: '24px', height: hasChildren && isExpanded ? '24px' : '32px', display: 'flex', justifyContent: 'center' }}>
          {/* Vertical connector line */}
          {hasChildren && isExpanded && (
            <div style={{ width: '2px', height: '100%', backgroundColor: '#d1d5db' }} />
          )}
          {/* Add button */}
          <div ref={addMenuRef} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowAddMenu(!showAddMenu)
              }}
              className={`w-5 h-5 bg-indigo-500 hover:bg-indigo-600 rounded-full flex items-center justify-center shadow-md transition-opacity ${showAddMenu ? 'opacity-100' : 'opacity-0 group-hover/addbutton:opacity-100'}`}
              title="Add node"
            >
              <Plus className="w-3 h-3 text-white" />
            </button>
            {/* Dropdown menu */}
            {showAddMenu && (
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[160px] z-30">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onAddChild(node.id)
                    setShowAddMenu(false)
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center space-x-2"
                >
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                  <span>Add child below</span>
                </button>
                {onAddSibling && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onAddSibling(parentId || null)
                      setShowAddMenu(false)
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center space-x-2"
                  >
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                    <span>Add sibling</span>
                  </button>
                )}
                {hasChildren && onInsertBetween && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onInsertBetween(node.id, node.children!.map(c => c.id))
                      setShowAddMenu(false)
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center space-x-2"
                  >
                    <MoreHorizontal className="w-4 h-4 text-gray-400" />
                    <span>Insert between</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Expanded Children with connectors */}
      {isExpanded && hasChildren && (
        <>

          {/* Children wrapper */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
            {node.children!.map((childNode, index) => (
              <div key={childNode.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '220px', flexShrink: 0, marginLeft: index > 0 ? '20px' : '0' }}>
                {/* T-connector with overlapping lines */}
                <div style={{ position: 'relative', width: '100%', height: '24px', overflow: 'visible' }}>
                  {/* Left horizontal segment - extends into the margin gap */}
                  {index > 0 && (
                    <div style={{
                      position: 'absolute',
                      top: '0',
                      left: '-20px',
                      width: 'calc(50% + 21px)',
                      height: '2px',
                      backgroundColor: '#d1d5db'
                    }} />
                  )}
                  {/* Right horizontal segment - extends into the margin gap */}
                  {index < node.children!.length - 1 && (
                    <div style={{
                      position: 'absolute',
                      top: '0',
                      right: '-20px',
                      width: 'calc(50% + 21px)',
                      height: '2px',
                      backgroundColor: '#d1d5db'
                    }} />
                  )}
                  {/* Center vertical drop */}
                  <div style={{
                    position: 'absolute',
                    top: '0',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: '2px',
                    height: '100%',
                    backgroundColor: '#d1d5db'
                  }} />
                </div>
                {/* Child node */}
                <OrgChartNodeCard
                  node={childNode}
                  isOrgAdmin={isOrgAdmin}
                  onEdit={onEdit}
                  onAddChild={onAddChild}
                  onAddSibling={onAddSibling}
                  onDelete={onDelete}
                  onAddMember={onAddMember}
                  onRemoveMember={onRemoveMember}
                  getNodeMembers={getNodeMembers}
                  getSharedTeams={getSharedTeams}
                  getTeamMembers={getTeamMembers}
                  getTeamPortfolios={getTeamPortfolios}
                  getPortfolioTeamMembers={getPortfolioTeamMembers}
                  onAddTeamMember={onAddTeamMember}
                  onRemoveTeamMember={onRemoveTeamMember}
                  onInsertBetween={onInsertBetween}
                  onViewDetails={onViewDetails}
                  getCoverageStats={getCoverageStats}
                  onViewTeamCoverage={onViewTeamCoverage}
                  depth={depth + 1}
                  parentId={node.id}
                  onRequestToJoin={onRequestToJoin}
                  isUserMember={isUserMember}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// TeamCoveragePanel - shows coverage details for a specific team
interface TeamCoveragePanelProps {
  teamId: string
  teamName: string
  portfolioIds: string[] // Portfolio IDs associated with this team
  onClose: () => void
}

function TeamCoveragePanel({ teamId, teamName, portfolioIds, onClose }: TeamCoveragePanelProps) {
  // Fetch coverage records for this team's portfolios (via membership)
  const { data: coverageRecords = [], isLoading } = useQuery({
    queryKey: ['team-coverage', teamId, portfolioIds],
    queryFn: async () => {
      if (portfolioIds.length === 0) return []

      // Find org_chart_nodes for these portfolios
      const { data: portfolioNodes } = await supabase
        .from('org_chart_nodes')
        .select('id, settings')
        .eq('node_type', 'portfolio')

      const portfolioNodeIds = (portfolioNodes || [])
        .filter(n => n.settings?.portfolio_id && portfolioIds.includes(n.settings.portfolio_id))
        .map(n => n.id)

      if (portfolioNodeIds.length === 0) return []

      // Get members of these portfolio nodes
      const { data: members } = await supabase
        .from('org_chart_node_members')
        .select('user_id')
        .in('node_id', portfolioNodeIds)

      const memberUserIds = [...new Set((members || []).map(m => m.user_id))]
      if (memberUserIds.length === 0) return []

      // Get coverage by these users
      const { data: coverageData, error: coverageError } = await supabase
        .from('coverage')
        .select('id, asset_id, user_id, visibility, role, is_lead, created_at')
        .in('user_id', memberUserIds)
        .eq('is_active', true)
        .order('created_at', { ascending: false })

      if (coverageError) throw coverageError
      if (!coverageData || coverageData.length === 0) return []

      // Get unique asset IDs and fetch asset info
      const assetIds = [...new Set(coverageData.map(c => c.asset_id).filter(Boolean))]
      const { data: assetsData } = await supabase
        .from('assets')
        .select('id, symbol, company_name, sector')
        .in('id', assetIds)

      const assetsMap = new Map(assetsData?.map(a => [a.id, a]) || [])

      // Get unique user IDs and fetch user info
      const userIds = [...new Set(coverageData.map(c => c.user_id).filter(Boolean))]
      const { data: usersData } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .in('id', userIds)

      const usersMap = new Map(usersData?.map(u => [u.id, u]) || [])

      // Combine coverage with asset and user info
      return coverageData.map(c => {
        const asset = assetsMap.get(c.asset_id)
        return {
          ...c,
          asset: asset ? { id: asset.id, ticker: asset.symbol, name: asset.company_name } : null,
          user: usersMap.get(c.user_id) || null
        }
      })
    }
  })

  // Count unique assets (not duplicate coverage records)
  const uniqueAssetCount = new Set(coverageRecords.map(r => r.asset_id)).size

  // Count overlapping assets (covered by multiple analysts)
  const assetAnalystCount = coverageRecords.reduce((acc, record) => {
    if (record.asset_id) {
      if (!acc[record.asset_id]) acc[record.asset_id] = new Set()
      if (record.user_id) acc[record.asset_id].add(record.user_id)
    }
    return acc
  }, {} as Record<string, Set<string>>)

  const overlapCount = Object.values(assetAnalystCount).filter(analysts => analysts.size > 1).length

  // Group by visibility for display
  const coverageByVisibility = coverageRecords.reduce((acc, record) => {
    const vis = record.visibility || 'team'
    if (!acc[vis]) acc[vis] = []
    acc[vis].push(record)
    return acc
  }, {} as Record<string, typeof coverageRecords>)

  const getVisibilityColor = (visibility: string) => {
    switch (visibility) {
      case 'firm': return 'bg-purple-100 text-purple-800'
      case 'division': return 'bg-blue-100 text-blue-800'
      default: return 'bg-green-100 text-green-800'
    }
  }

  const getVisibilityIcon = (visibility: string) => {
    switch (visibility) {
      case 'firm': return <Building2 className="w-3 h-3" />
      case 'division': return <FolderOpen className="w-3 h-3" />
      default: return <Users className="w-3 h-3" />
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-end z-50">
      <div className="bg-white h-full w-full max-w-xl shadow-2xl flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
              <Briefcase className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{teamName} Coverage</h2>
              <p className="text-sm text-gray-500">
                {uniqueAssetCount} asset{uniqueAssetCount !== 1 ? 's' : ''} covered
                {overlapCount > 0 && (
                  <span className="ml-2 text-amber-600">
                    ({overlapCount} overlap{overlapCount !== 1 ? 's' : ''})
                  </span>
                )}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            </div>
          ) : coverageRecords.length === 0 ? (
            <div className="text-center py-12">
              <Briefcase className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No coverage assigned</h3>
              <p className="text-sm text-gray-500">
                This team doesn't have any coverage assignments yet.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Summary stats */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-green-50 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-green-700">
                    {coverageByVisibility['team']?.length || 0}
                  </div>
                  <div className="text-xs text-green-600 flex items-center justify-center gap-1">
                    <Users className="w-3 h-3" /> Team Only
                  </div>
                </div>
                <div className="bg-blue-50 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-blue-700">
                    {coverageByVisibility['division']?.length || 0}
                  </div>
                  <div className="text-xs text-blue-600 flex items-center justify-center gap-1">
                    <FolderOpen className="w-3 h-3" /> Division
                  </div>
                </div>
                <div className="bg-purple-50 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-purple-700">
                    {coverageByVisibility['firm']?.length || 0}
                  </div>
                  <div className="text-xs text-purple-600 flex items-center justify-center gap-1">
                    <Building2 className="w-3 h-3" /> Firm-wide
                  </div>
                </div>
              </div>

              {/* Coverage list */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-gray-900 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-gray-400" />
                  Coverage Assignments
                </h3>
                <div className="space-y-2">
                  {coverageRecords.map((record) => (
                    <div
                      key={record.id}
                      className="bg-white border border-gray-200 rounded-lg p-3 hover:border-gray-300 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900">
                              {(record.asset as any)?.ticker || 'Unknown'}
                            </span>
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${getVisibilityColor(record.visibility || 'team')}`}>
                              {getVisibilityIcon(record.visibility || 'team')}
                              {record.visibility || 'team'}
                            </span>
                            {record.role && (
                              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                                {record.role}
                              </span>
                            )}
                            {record.is_lead && (
                              <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded font-medium">
                                Lead
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-500 mt-0.5">
                            {(record.asset as any)?.name || 'Unknown Asset'}
                          </p>
                        </div>
                        <div className="text-right">
                          <div className="text-sm text-gray-900">
                            {(record.user as any)?.first_name || ''} {(record.user as any)?.last_name || (record.user as any)?.email?.split('@')[0] || 'Unknown'}
                          </div>
                          <div className="text-xs text-gray-400">
                            {new Date(record.created_at).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <Info className="w-3 h-3" />
              Visibility determines who can see each coverage assignment
            </span>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium text-gray-700 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
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
  onSave: (userId: string, role: string, focus?: string, isCoverageAdmin?: boolean) => void
  isLoading?: boolean
}

function AddNodeMemberModal({ node, existingMembers, availableUsers, onClose, onSave, isLoading }: AddNodeMemberModalProps) {
  const [selectedUserId, setSelectedUserId] = useState('')
  const [role, setRole] = useState('')
  const [focus, setFocus] = useState('')
  const [isCoverageAdmin, setIsCoverageAdmin] = useState(false)

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

          {/* Coverage Admin Checkbox */}
          <div className="flex items-center space-x-3 pt-2 border-t border-gray-100">
            <input
              type="checkbox"
              id="coverage-admin"
              checked={isCoverageAdmin}
              onChange={(e) => setIsCoverageAdmin(e.target.checked)}
              className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
            />
            <div>
              <label htmlFor="coverage-admin" className="text-sm font-medium text-gray-700">
                Coverage Admin
              </label>
              <p className="text-xs text-gray-500">
                Can manage coverage assignments for this {node.node_type} and all children
              </p>
            </div>
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
            onClick={() => onSave(selectedUserId, role, focus || undefined, isCoverageAdmin)}
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
  onRequestRemoval: (reason: string) => void
  isLoading: boolean
  isRemovalLoading: boolean
}

function SuspendUserModal({ member, onClose, onSuspend, onRequestRemoval, isLoading, isRemovalLoading }: SuspendUserModalProps) {
  const [reason, setReason] = useState('')
  const [actionType, setActionType] = useState<'suspend' | 'remove'>('suspend')
  const [showConfirmation, setShowConfirmation] = useState(false)

  const currentLoading = actionType === 'suspend' ? isLoading : isRemovalLoading

  if (showConfirmation) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
          <div className="flex items-center space-x-3 mb-4">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
              actionType === 'suspend' ? 'bg-amber-100' : 'bg-red-100'
            }`}>
              <AlertTriangle className={`w-5 h-5 ${actionType === 'suspend' ? 'text-amber-600' : 'text-red-600'}`} />
            </div>
            <h3 className="text-lg font-semibold text-gray-900">Are you sure?</h3>
          </div>

          {actionType === 'suspend' ? (
            <>
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
            </>
          ) : (
            <>
              <p className="text-sm text-gray-600 mb-4">
                You are about to request permanent removal of <span className="font-semibold text-gray-900">{member.user?.full_name}</span> from the platform.
              </p>
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                <p className="text-sm text-red-800">
                  <strong>This will send a request to platform administrators to:</strong>
                </p>
                <ul className="text-sm text-red-700 list-disc list-inside mt-1">
                  <li>Permanently delete the user's account</li>
                  <li>Remove all their data and access</li>
                  <li>This action cannot be undone once approved</li>
                </ul>
              </div>
            </>
          )}

          <div className="flex justify-end space-x-3">
            <Button variant="outline" onClick={() => setShowConfirmation(false)}>Go Back</Button>
            <Button
              onClick={() => actionType === 'suspend' ? onSuspend(reason) : onRequestRemoval(reason)}
              disabled={currentLoading}
              className={actionType === 'suspend' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-red-600 hover:bg-red-700'}
            >
              {currentLoading
                ? (actionType === 'suspend' ? 'Suspending...' : 'Submitting...')
                : (actionType === 'suspend' ? 'Yes, Suspend Access' : 'Yes, Request Removal')}
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
          <h3 className="text-lg font-semibold text-gray-900">Manage User Access</h3>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          Choose an action for <span className="font-medium">{member.user?.full_name}</span>
        </p>

        {/* Action Type Toggle */}
        <div className="space-y-2 mb-4">
          <label className="block text-sm font-medium text-gray-700">Action</label>
          <div className="flex rounded-lg border border-gray-200 p-1 bg-gray-50">
            <button
              type="button"
              onClick={() => setActionType('suspend')}
              className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                actionType === 'suspend'
                  ? 'bg-white text-amber-700 shadow-sm border border-amber-200'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <UserX className="w-4 h-4 inline mr-1.5" />
              Suspend Access
            </button>
            <button
              type="button"
              onClick={() => setActionType('remove')}
              className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                actionType === 'remove'
                  ? 'bg-white text-red-700 shadow-sm border border-red-200'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Trash2 className="w-4 h-4 inline mr-1.5" />
              Request Removal
            </button>
          </div>
        </div>

        {/* Description based on action type */}
        <div className={`rounded-lg p-3 mb-4 ${
          actionType === 'suspend' ? 'bg-amber-50 border border-amber-100' : 'bg-red-50 border border-red-100'
        }`}>
          <p className={`text-xs ${actionType === 'suspend' ? 'text-amber-700' : 'text-red-700'}`}>
            {actionType === 'suspend'
              ? 'Suspending will immediately revoke platform access. This can be undone later by restoring the user.'
              : 'This will send a request to platform administrators to permanently delete this user. This action cannot be undone once approved.'}
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {actionType === 'suspend' ? 'Reason for suspension' : 'Reason for removal request'} *
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 ${
                actionType === 'suspend'
                  ? 'border-gray-300 focus:ring-amber-500 focus:border-amber-500'
                  : 'border-gray-300 focus:ring-red-500 focus:border-red-500'
              }`}
              rows={3}
              placeholder={actionType === 'suspend'
                ? 'Please provide a reason for suspending this user...'
                : 'Please explain why this user should be permanently removed...'}
            />
          </div>
        </div>
        <div className="flex justify-end space-x-3 mt-6">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => setShowConfirmation(true)}
            disabled={!reason.trim()}
            className={actionType === 'suspend' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-red-600 hover:bg-red-700'}
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
  childIdsToReparent?: string[] | null // For inserting between nodes
  insertMode?: boolean // True when inserting between nodes
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
    childIdsToReparent?: string[]
    is_non_investment?: boolean
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

function AddNodeModal({ parentId, portfolios, childIdsToReparent, insertMode, onClose, onSave, isLoading }: AddNodeModalProps) {
  const [nodeType, setNodeType] = useState<OrgNodeType>(insertMode ? 'department' : 'team')
  const [customTypeLabel, setCustomTypeLabel] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('#6366f1')
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string>('')
  const [portfolioSearch, setPortfolioSearch] = useState('')
  const [isNonInvestment, setIsNonInvestment] = useState(false)

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
        portfolio_id: selectedPortfolioId,
        childIdsToReparent: childIdsToReparent || undefined,
        is_non_investment: isNonInvestment
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
      icon: NODE_TYPE_OPTIONS.find(o => o.value === nodeType)?.icon || 'folder',
      childIdsToReparent: childIdsToReparent || undefined,
      is_non_investment: isNonInvestment
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
            <h3 className="text-lg font-semibold text-gray-900">
              {insertMode ? 'Insert Node Between' : 'Add to Organization'}
            </h3>
            <p className="text-sm text-gray-500">
              {insertMode
                ? 'Insert a new parent node above existing nodes'
                : parentId ? 'Add a child node' : 'Add to the root level'}
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

          {/* Non-Investment Checkbox */}
          <div className="flex items-center space-x-3 pt-2 border-t border-gray-100">
            <input
              type="checkbox"
              id="isNonInvestment"
              checked={isNonInvestment}
              onChange={(e) => setIsNonInvestment(e.target.checked)}
              className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
            />
            <label htmlFor="isNonInvestment" className="text-sm text-gray-700">
              <span className="font-medium">Non-investment team</span>
              <p className="text-xs text-gray-500">Exclude from coverage filters (e.g., Operations, HR, IT)</p>
            </label>
          </div>
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
    is_non_investment?: boolean
  }) => void
  isLoading: boolean
}

function EditNodeModal({ node, onClose, onSave, isLoading }: EditNodeModalProps) {
  const [customTypeLabel, setCustomTypeLabel] = useState(node.custom_type_label || '')
  const [name, setName] = useState(node.name)
  const [description, setDescription] = useState(node.description || '')
  const [color, setColor] = useState(node.color)
  const [isNonInvestment, setIsNonInvestment] = useState(node.is_non_investment || false)

  const handleSubmit = () => {
    if (!name.trim()) return
    if (node.node_type === 'custom' && !customTypeLabel.trim()) return

    onSave({
      id: node.id,
      name: name.trim(),
      description: description.trim() || undefined,
      color,
      icon: node.icon,
      custom_type_label: node.node_type === 'custom' ? customTypeLabel.trim() : undefined,
      is_non_investment: isNonInvestment
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

          {/* Non-Investment Checkbox */}
          <div className="flex items-center space-x-3 pt-2 border-t border-gray-100">
            <input
              type="checkbox"
              id="editIsNonInvestment"
              checked={isNonInvestment}
              onChange={(e) => setIsNonInvestment(e.target.checked)}
              className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
            />
            <label htmlFor="editIsNonInvestment" className="text-sm text-gray-700">
              <span className="font-medium">Non-investment team</span>
              <p className="text-xs text-gray-500">Exclude from coverage filters (e.g., Operations, HR, IT)</p>
            </label>
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

// Node Detail Modal - shows detailed information about a node with integrated edit mode
interface NodeDetailModalProps {
  node: OrgChartNode
  members: OrgChartNodeMember[]
  portfolioTeamMembers: PortfolioTeamMember[]
  onClose: () => void
  isAdmin: boolean
  availableUsers: any[]
  onSaveNode: (data: { id: string; name: string; description?: string; color: string; icon: string; custom_type_label?: string; is_non_investment?: boolean }) => void
  onAddMember: (nodeId: string, userId: string, role?: string, focus?: string) => void
  onUpdateMember: (memberId: string, role: string, focus: string | null) => void
  onRemoveMember: (memberId: string) => void
  onToggleCoverageAdmin?: (memberId: string, isCoverageAdmin: boolean) => void
  onToggleCoverageAdminBlocked?: (memberId: string, isBlocked: boolean) => void
  canManageCoverageAdmins?: boolean
  allOrgChartNodes?: OrgChartNode[]
  allNodeMembers?: OrgChartNodeMember[]
  globalCoverageAdminUserIds?: Set<string>
  isSaving: boolean
}

function NodeDetailModal({
  node,
  members,
  portfolioTeamMembers,
  onClose,
  isAdmin,
  availableUsers,
  onSaveNode,
  onAddMember,
  onUpdateMember,
  onRemoveMember,
  onToggleCoverageAdmin,
  onToggleCoverageAdminBlocked,
  canManageCoverageAdmins,
  allOrgChartNodes = [],
  allNodeMembers = [],
  globalCoverageAdminUserIds = new Set(),
  isSaving
}: NodeDetailModalProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(node.name)
  const [editDescription, setEditDescription] = useState(node.description || '')
  const [editColor, setEditColor] = useState(node.color)
  const [editCustomTypeLabel, setEditCustomTypeLabel] = useState(node.custom_type_label || '')
  const [editIsNonInvestment, setEditIsNonInvestment] = useState(node.is_non_investment || false)
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null)
  const [editMemberRole, setEditMemberRole] = useState('')
  const [editMemberFocus, setEditMemberFocus] = useState('')
  const [showAddMember, setShowAddMember] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [memberRole, setMemberRole] = useState('')
  const [memberFocus, setMemberFocus] = useState('')

  // For portfolio nodes, show all member entries (a user can have multiple roles/focuses)
  // For non-portfolio nodes, dedupe by user_id
  const displayMembers = React.useMemo(() => {
    if (node.node_type === 'portfolio') {
      // Show all entries - same user can have multiple roles/focuses
      return portfolioTeamMembers
    } else {
      // For non-portfolio nodes, dedupe by user_id
      const memberMap = new Map<string, PortfolioTeamMember>()
      portfolioTeamMembers.forEach(m => {
        if (m.user_id && !memberMap.has(m.user_id)) {
          memberMap.set(m.user_id, m)
        }
      })
      return Array.from(memberMap.values())
    }
  }, [portfolioTeamMembers, node.node_type])

  // All users are available - same user can be added with different role/focus
  const availableUsersFiltered = availableUsers

  // Get all members from this node and all descendant nodes (for coverage admin display)
  const allDescendantNodeIds = React.useMemo(() => {
    const ids = new Set<string>([node.id])

    // Helper to recursively get all descendant node IDs
    const addDescendants = (parentId: string) => {
      allOrgChartNodes
        .filter(n => n.parent_id === parentId)
        .forEach(child => {
          ids.add(child.id)
          addDescendants(child.id)
        })
    }

    addDescendants(node.id)
    return ids
  }, [node.id, allOrgChartNodes])

  // Get unique members from this node and all descendants (dedupe by user_id)
  const membersWithDescendants = React.useMemo(() => {
    const memberMap = new Map<string, OrgChartNodeMember>()

    allNodeMembers
      .filter(m => allDescendantNodeIds.has(m.node_id))
      .forEach(m => {
        // Keep the first occurrence (or one with is_coverage_admin if applicable)
        if (!memberMap.has(m.user_id)) {
          memberMap.set(m.user_id, m)
        } else if (m.is_coverage_admin && !memberMap.get(m.user_id)?.is_coverage_admin) {
          // Prefer the one with coverage admin status
          memberMap.set(m.user_id, m)
        }
      })

    return Array.from(memberMap.values())
  }, [allNodeMembers, allDescendantNodeIds])

  // Helper to determine a member's effective admin status for this node
  type AdminStatus = 'explicit' | 'inherited' | 'global' | 'blocked' | 'none'

  const getMemberAdminStatus = (member: OrgChartNodeMember): { status: AdminStatus; source?: string } => {
    // If explicitly blocked for this node, show blocked
    if (member.coverage_admin_blocked) {
      return { status: 'blocked' }
    }

    // If explicitly set as admin for this node
    if (member.is_coverage_admin) {
      return { status: 'explicit' }
    }

    // Check if user has global coverage admin
    if (globalCoverageAdminUserIds.has(member.user_id)) {
      return { status: 'global' }
    }

    // Check if user has admin rights from parent nodes (inherited)
    const nodeMap = new Map(allOrgChartNodes.map(n => [n.id, n]))
    let currentNode = nodeMap.get(node.parent_id || '')

    while (currentNode) {
      // Check if user is admin at this parent node
      const parentMember = allNodeMembers.find(m =>
        m.node_id === currentNode!.id &&
        m.user_id === member.user_id &&
        m.is_coverage_admin &&
        !m.coverage_admin_blocked
      )
      if (parentMember) {
        return { status: 'inherited', source: currentNode.name }
      }

      // Move up the tree, but stop if the parent node has override set
      if (currentNode.coverage_admin_override) {
        break
      }
      currentNode = currentNode.parent_id ? nodeMap.get(currentNode.parent_id) : undefined
    }

    return { status: 'none' }
  }

  // Get icon based on node type
  const getNodeIcon = () => {
    const iconColor = isEditing ? editColor : node.color
    switch (node.node_type) {
      case 'division': return <Building2 className="w-6 h-6" style={{ color: iconColor }} />
      case 'department': return <FolderOpen className="w-6 h-6" style={{ color: iconColor }} />
      case 'team': return <Users className="w-6 h-6" style={{ color: iconColor }} />
      case 'portfolio': return <Briefcase className="w-6 h-6" style={{ color: iconColor }} />
      default: return <FolderOpen className="w-6 h-6" style={{ color: iconColor }} />
    }
  }

  // Get type label
  const getTypeLabel = () => {
    if (node.node_type === 'custom' && node.custom_type_label) {
      return node.custom_type_label
    }
    return node.node_type.charAt(0).toUpperCase() + node.node_type.slice(1)
  }

  const handleSave = () => {
    if (!editName.trim()) return
    if (node.node_type === 'custom' && !editCustomTypeLabel.trim()) return

    onSaveNode({
      id: node.id,
      name: editName.trim(),
      description: editDescription.trim() || undefined,
      color: editColor,
      icon: node.icon,
      custom_type_label: node.node_type === 'custom' ? editCustomTypeLabel.trim() : undefined,
      is_non_investment: editIsNonInvestment
    })
    setIsEditing(false)
  }

  const handleAddMember = () => {
    if (!selectedUserId) return
    onAddMember(node.id, selectedUserId, memberRole || undefined, memberFocus || undefined)
    setSelectedUserId('')
    setMemberRole('')
    setMemberFocus('')
    setShowAddMember(false)
  }

  const handleCancelEdit = () => {
    setEditName(node.name)
    setEditDescription(node.description || '')
    setEditColor(node.color)
    setEditCustomTypeLabel(node.custom_type_label || '')
    setIsEditing(false)
  }

  const currentColor = isEditing ? editColor : node.color
  const isPortfolioNode = node.node_type === 'portfolio'

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div
          className="p-5 border-b border-gray-100"
          style={{ backgroundColor: `${currentColor}08` }}
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-4 flex-1 min-w-0">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: `${currentColor}20` }}
              >
                {getNodeIcon()}
              </div>
              <div className="flex-1 min-w-0">
                {isEditing ? (
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="text-lg font-semibold text-gray-900 w-full px-2 py-1 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="Enter name"
                    autoFocus
                  />
                ) : (
                  <h3 className="text-lg font-semibold text-gray-900 truncate">{node.name}</h3>
                )}
                <div className="flex items-center space-x-2 mt-0.5">
                  <span
                    className="text-xs font-medium px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: `${currentColor}20`, color: currentColor }}
                  >
                    {getTypeLabel()}
                  </span>
                  {node.is_non_investment && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                      Non-Investment
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-1 ml-3">
              {isAdmin && !isEditing && (
                <button
                  onClick={() => setIsEditing(true)}
                  className="p-2 hover:bg-white hover:shadow-sm rounded-lg transition-all text-gray-500 hover:text-indigo-600"
                  title="Edit"
                >
                  <Edit3 className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={isEditing ? handleCancelEdit : onClose}
                className="p-2 hover:bg-white hover:shadow-sm rounded-lg transition-all"
                title={isEditing ? "Cancel editing" : "Close"}
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 p-5 overflow-y-auto">
          {/* Custom Type Label (only for custom type in edit mode) */}
          {isEditing && node.node_type === 'custom' && (
            <div className="mb-6">
              <h4 className="text-sm font-medium text-gray-700 mb-2">Type Label *</h4>
              <input
                type="text"
                value={editCustomTypeLabel}
                onChange={(e) => setEditCustomTypeLabel(e.target.value)}
                placeholder="e.g., Business Unit, Region"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
          )}

          {/* Description - only show in edit mode or if there's content */}
          {(isEditing || node.description) && (
            <div className="mb-5">
              {isEditing ? (
                <>
                  <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Description</h4>
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    placeholder="Add a description..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                    rows={2}
                  />
                </>
              ) : (
                <p className="text-sm text-gray-600">{node.description}</p>
              )}
            </div>
          )}

          {/* Edit-only settings */}
          {isEditing && (
            <div className="mb-5 p-4 bg-gray-50 rounded-lg space-y-4">
              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide">Settings</h4>

              {/* Color */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">Color</label>
                <div className="flex flex-wrap gap-2">
                  {NODE_COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setEditColor(c)}
                      className={`w-7 h-7 rounded-full border-2 transition-all ${
                        editColor === c ? 'border-gray-800 scale-110 shadow-sm' : 'border-transparent hover:scale-105'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              {/* Non-Investment Checkbox */}
              <div className="flex items-center space-x-3 pt-2 border-t border-gray-200">
                <input
                  type="checkbox"
                  id="detailIsNonInvestment"
                  checked={editIsNonInvestment}
                  onChange={(e) => setEditIsNonInvestment(e.target.checked)}
                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                />
                <label htmlFor="detailIsNonInvestment" className="text-sm text-gray-700">
                  <span className="font-medium">Non-investment team</span>
                  <p className="text-xs text-gray-500">Exclude from coverage filters (e.g., Operations, HR, IT)</p>
                </label>
              </div>
            </div>
          )}

          {/* Members */}
          <div className="mb-5">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center">
                <Users className="w-3.5 h-3.5 mr-1.5" />
                Members ({displayMembers.length})
              </h4>
              {isEditing && isAdmin && (
                <button
                  onClick={() => setShowAddMember(!showAddMember)}
                  className="text-xs text-indigo-600 hover:text-indigo-700 font-medium flex items-center"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Add
                </button>
              )}
            </div>

            {/* Add Member Form */}
            {isEditing && showAddMember && (
              <div className="bg-indigo-50 rounded-lg p-3 mb-3 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Select User</label>
                  <select
                    value={selectedUserId}
                    onChange={(e) => setSelectedUserId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  >
                    <option value="">Choose a user...</option>
                    {availableUsersFiltered.map(user => {
                      const displayName = user.user?.full_name || user.user?.email?.split('@')[0] || 'Unknown'
                      return (
                        <option key={user.user_id} value={user.user_id}>{displayName}</option>
                      )
                    })}
                  </select>
                </div>
                {isPortfolioNode && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Role (optional)</label>
                      <select
                        value={memberRole}
                        onChange={(e) => setMemberRole(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      >
                        <option value="">Select role...</option>
                        <option value="Portfolio Manager">Portfolio Manager</option>
                        <option value="Analyst">Analyst</option>
                        <option value="Trader">Trader</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-2">Focus (select multiple)</label>
                      <div className="flex flex-wrap gap-1.5">
                        {['Generalist', 'Technology', 'Healthcare', 'Energy', 'Financials', 'Consumer', 'Industrials', 'Utilities', 'Materials', 'Real Estate', 'Quant', 'Technical'].map(focus => {
                          const currentFocuses = memberFocus ? memberFocus.split(', ').filter(Boolean) : []
                          const isSelected = currentFocuses.includes(focus)
                          return (
                            <button
                              key={focus}
                              type="button"
                              onClick={() => {
                                let newFocuses: string[]
                                if (isSelected) {
                                  newFocuses = currentFocuses.filter(f => f !== focus)
                                } else {
                                  newFocuses = [...currentFocuses, focus]
                                }
                                setMemberFocus(newFocuses.join(', '))
                              }}
                              className={`px-2 py-1 text-xs rounded-full border transition-colors ${
                                isSelected
                                  ? 'bg-indigo-100 border-indigo-300 text-indigo-700'
                                  : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                              }`}
                            >
                              {focus}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </>
                )}
                <div className="flex justify-end space-x-2">
                  <button
                    onClick={() => setShowAddMember(false)}
                    className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddMember}
                    disabled={!selectedUserId}
                    className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Add
                  </button>
                </div>
              </div>
            )}

            {displayMembers.length > 0 ? (
              <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                {displayMembers.map(member => {
                  const displayName = member.user?.first_name || member.user?.last_name
                    ? `${member.user.first_name || ''} ${member.user.last_name || ''}`.trim()
                    : member.user?.email?.split('@')[0] || 'Unknown'
                  const initial = displayName.charAt(0).toUpperCase()
                  const isEditingThisMember = editingMemberId === member.id

                  // If editing this member, show inline edit form with auto-save
                  if (isEditingThisMember && isEditing && isPortfolioNode) {
                    const focusOptions = ['Generalist', 'Technology', 'Healthcare', 'Energy', 'Financials', 'Consumer', 'Industrials', 'Utilities', 'Materials', 'Real Estate', 'Quant', 'Technical']
                    const currentFocuses = editMemberFocus ? editMemberFocus.split(', ').filter(Boolean) : []

                    const toggleFocus = (focus: string) => {
                      let newFocuses: string[]
                      if (currentFocuses.includes(focus)) {
                        newFocuses = currentFocuses.filter(f => f !== focus)
                      } else {
                        newFocuses = [...currentFocuses, focus]
                      }
                      const newFocusString = newFocuses.join(', ')
                      setEditMemberFocus(newFocusString)
                      // Auto-save on focus change
                      onUpdateMember(member.id, editMemberRole, newFocusString || null)
                    }

                    return (
                      <div key={member.id} className="bg-white border border-indigo-200 rounded-lg p-3 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <div
                              className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium text-white"
                              style={{ backgroundColor: currentColor }}
                            >
                              {initial}
                            </div>
                            <p className="text-sm font-medium text-gray-900">{displayName}</p>
                          </div>
                          <button
                            onClick={() => {
                              setEditingMemberId(null)
                              setEditMemberRole('')
                              setEditMemberFocus('')
                            }}
                            className="p-1 text-gray-400 hover:text-gray-600 rounded"
                            title="Done editing"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Role dropdown - auto-saves */}
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
                          <select
                            value={editMemberRole}
                            onChange={(e) => {
                              const newRole = e.target.value
                              setEditMemberRole(newRole)
                              // Auto-save on role change
                              onUpdateMember(member.id, newRole, editMemberFocus || null)
                            }}
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          >
                            <option value="">Select role...</option>
                            <option value="Portfolio Manager">Portfolio Manager</option>
                            <option value="Analyst">Analyst</option>
                            <option value="Trader">Trader</option>
                          </select>
                        </div>

                        {/* Focus multi-select checkboxes - auto-saves */}
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-2">Focus (select multiple)</label>
                          <div className="flex flex-wrap gap-1.5">
                            {focusOptions.map(focus => (
                              <button
                                key={focus}
                                onClick={() => toggleFocus(focus)}
                                className={`px-2 py-1 text-xs rounded-full border transition-colors ${
                                  currentFocuses.includes(focus)
                                    ? 'bg-indigo-100 border-indigo-300 text-indigo-700'
                                    : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                                }`}
                              >
                                {focus}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )
                  }

                  return (
                    <div key={member.id} className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium text-white"
                          style={{ backgroundColor: currentColor }}
                        >
                          {initial}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{displayName}</p>
                          {isPortfolioNode && member.role && <p className="text-xs text-gray-500">{member.role}</p>}
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        {isPortfolioNode && member.focus && (
                          <div className="flex flex-wrap gap-1">
                            {member.focus.split(', ').map((f, idx) => (
                              <span key={idx} className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded">{f}</span>
                            ))}
                          </div>
                        )}
                        {isEditing && isAdmin && isPortfolioNode && (
                          <button
                            onClick={() => {
                              setEditingMemberId(member.id)
                              setEditMemberRole(member.role || '')
                              setEditMemberFocus(member.focus || '')
                            }}
                            className="p-1 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded"
                            title="Edit member"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                        )}
                        {isEditing && isAdmin && (
                          <button
                            onClick={() => onRemoveMember(member.id)}
                            className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"
                            title="Remove member"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-sm text-gray-500 bg-gray-50 rounded-lg p-3">No members assigned yet</p>
            )}
          </div>

          {/* Coverage Admin Section - shows members from this node and all descendants (only for investment-related nodes) */}
          {!(isEditing ? editIsNonInvestment : node.is_non_investment) && (canManageCoverageAdmins || membersWithDescendants.some(m => m.is_coverage_admin || globalCoverageAdminUserIds.has(m.user_id))) && (
            <div className="pt-4 border-t border-gray-100">
              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center mb-3">
                <Shield className="w-3.5 h-3.5 mr-1.5" />
                Coverage Admin Rights
              </h4>

              {/* List of members from this node and descendants with per-member admin controls */}
              <div className="bg-gray-50 rounded-lg divide-y divide-gray-100">
                {membersWithDescendants.length > 0 ? (
                  membersWithDescendants.map(member => {
                    const displayName = member.user?.full_name || member.user?.email || 'Unknown'
                    const initial = displayName.charAt(0).toUpperCase()
                    const adminStatus = getMemberAdminStatus(member)

                    // Determine if this user has inherited or global admin that can be blocked
                    const hasInheritedOrGlobalAdmin =
                      adminStatus.status === 'global' ||
                      adminStatus.status === 'inherited' ||
                      (adminStatus.status === 'blocked' && (globalCoverageAdminUserIds.has(member.user_id) || allNodeMembers.some(m =>
                        m.user_id === member.user_id &&
                        m.node_id !== node.id &&
                        m.is_coverage_admin &&
                        !m.coverage_admin_blocked
                      )))

                    return (
                      <div key={member.id} className="px-3 py-2 flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <div
                            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium text-white"
                            style={{ backgroundColor: node.color }}
                          >
                            {initial}
                          </div>
                          <p className="text-sm font-medium text-gray-900">{displayName}</p>
                        </div>
                        <div className="flex items-center space-x-2">
                          {/* Admin Status Badge */}
                          {adminStatus.status === 'explicit' && (
                            <span className="px-2 py-0.5 text-xs bg-indigo-100 text-indigo-700 rounded-full flex items-center">
                              <Shield className="w-3 h-3 mr-1" />
                              Admin
                            </span>
                          )}
                          {adminStatus.status === 'global' && (
                            <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded-full flex items-center" title="Has global coverage admin rights">
                              <Shield className="w-3 h-3 mr-1" />
                              Global
                            </span>
                          )}
                          {adminStatus.status === 'inherited' && (
                            <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full flex items-center" title={`Inherited from ${adminStatus.source}`}>
                              <Shield className="w-3 h-3 mr-1" />
                              Inherited
                            </span>
                          )}
                          {adminStatus.status === 'blocked' && (
                            <span className="px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded-full flex items-center" title="Admin access blocked for this node">
                              <ShieldOff className="w-3 h-3 mr-1" />
                              Blocked
                            </span>
                          )}

                          {/* Admin Control Buttons */}
                          {canManageCoverageAdmins && (
                            <div className="flex items-center space-x-1">
                              {/* Toggle explicit admin (only for 'none' or 'explicit' status - global/inherited just need block option) */}
                              {(adminStatus.status === 'none' || adminStatus.status === 'explicit') && onToggleCoverageAdmin && (
                                <button
                                  onClick={() => onToggleCoverageAdmin(member.id, !member.is_coverage_admin)}
                                  className={`p-1.5 rounded transition-colors ${
                                    adminStatus.status === 'explicit'
                                      ? 'text-indigo-600 hover:bg-indigo-50'
                                      : 'text-gray-400 hover:bg-gray-100 hover:text-indigo-600'
                                  }`}
                                  title={adminStatus.status === 'explicit' ? 'Remove explicit admin' : 'Grant explicit admin'}
                                >
                                  <Shield className="w-4 h-4" />
                                </button>
                              )}

                              {/* Block/Unblock inherited or global admin */}
                              {hasInheritedOrGlobalAdmin && onToggleCoverageAdminBlocked && (
                                <button
                                  onClick={() => onToggleCoverageAdminBlocked(member.id, !member.coverage_admin_blocked)}
                                  className={`p-1.5 rounded transition-colors ${
                                    member.coverage_admin_blocked
                                      ? 'text-amber-600 hover:bg-amber-50'
                                      : 'text-gray-400 hover:bg-gray-100 hover:text-amber-600'
                                  }`}
                                  title={member.coverage_admin_blocked ? 'Unblock admin access' : 'Block inherited/global admin'}
                                >
                                  <ShieldOff className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })
                ) : (
                  <p className="px-3 py-2 text-sm text-gray-500">No node members. Add members to manage coverage admin rights.</p>
                )}
              </div>
            </div>
          )}

        </div>

        {/* Footer - only shows when editing */}
        {isEditing && (
          <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end space-x-3">
            <Button variant="outline" onClick={handleCancelEdit}>Cancel</Button>
            <Button
              onClick={handleSave}
              disabled={!editName.trim() || (node.node_type === 'custom' && !editCustomTypeLabel.trim()) || isSaving}
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
