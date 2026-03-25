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
  ExternalLink,
  Send,
  Link2,
  Info,
  Calendar,
  FileText,
  Lock,
  Unlock,
  Upload,
  Image,
  LayoutGrid,
  Table2,
  Eye,
  Heart,
  AlertCircle,
  Minimize2,
  Maximize2,
  Home,
  Archive,
  ArchiveRestore,
  Ban,
  RotateCcw
} from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { AddTeamMemberModal } from '../components/portfolios/AddTeamMemberModal'
import { OrgRequestsTab } from '../components/organization/OrgRequestsTab'
import { OrgDomainsSection } from '../components/organization/OrgDomainsSection'
import { OrgIdentityProviderSection } from '../components/organization/OrgIdentityProviderSection'
import { OrgGovernanceSection } from '../components/organization/OrgGovernanceSection'
import { OrgPeopleTab } from '../components/organization/OrgPeopleTab'
import { OrgActivityTab } from '../components/organization/OrgActivityTab'
import { OrgAccessTab } from '../components/organization/OrgAccessTab'
import { useOrganization } from '../contexts/OrganizationContext'
import { useToast } from '../components/common/Toast'
import { OrgBadge } from '../components/common/OrgBadge'
import { useOrgWriteEnabled } from '../hooks/useOrgWriteEnabled'
import { mapMutationError } from '../lib/archived-org-errors'
import { useOrgGraph } from '../hooks/useOrgGraph'
import { getRiskCountsBySeverity, computeGovernanceSummary } from '../lib/org-graph'
import type { CoverageRecord, OrgGraphNode } from '../lib/org-graph'
import { ROLE_OPTIONS, getFocusOptionsForRole, TEAM_ROLE_OPTIONS, TEAM_FUNCTION_OPTIONS } from '../lib/roles-config'
import { OrganizationGovernanceHeader } from '../components/organization/OrganizationGovernanceHeader'
import { HealthPill } from '../components/organization/HealthPill'
import { OrgChartNodeCard } from '../components/organization/OrgChartNodeCard'
import { resolveOrgPermissions } from '../lib/permissions/orgGovernance'
import { RiskFlagBadge } from '../components/organization/RiskBadge'
import { OrgNodeDetailsModal } from '../components/organization/OrgNodeDetailsModal'
import { OrgAuthorityMap } from '../components/organization/OrgAuthorityMap'
import { buildAuthorityRows, computeAuthoritySummary } from '../lib/authority-map'
import { AssignPortfolioRolesModal } from '../components/organization/AssignPortfolioRolesModal'
import type { LinkedPortfolio, PortfolioRoleAssignment } from '../components/organization/AssignPortfolioRolesModal'
import { DiscardPortfolioModal } from '../components/portfolios/DiscardPortfolioModal'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { logOrgActivity, logOrgActivityBatch } from '../lib/org-activity-log'

interface Organization {
  id: string
  name: string
  slug: string
  description: string | null
  logo_url: string | null
  settings: any
  onboarding_policy?: 'open' | 'approval_required' | 'invite_only'
  updated_at?: string
}

/** Lightweight relative-time formatter (avoids pulling in a full i18n library) */
function formatTimeAgo(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
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

interface UserProfileData {
  user_type: string | null
  sector_focus: string[]
  investment_style: string[]
  market_cap_focus: string[]
  geography_focus: string[]
  time_horizon: string[]
  ops_departments: string[]
  compliance_areas: string[]
}

interface OrganizationMembership {
  id: string
  organization_id: string
  user_id: string
  is_org_admin: boolean
  title: string | null
  status: string
  user?: UserProfile
  profile?: UserProfileData | null
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
  portfolio_id: string
  name: string
  team_id: string | null
  description: string | null
  portfolio_type: string
  is_active: boolean
  status?: 'active' | 'archived' | 'discarded'
  archived_at?: string | null
  archived_by?: string | null
  discarded_at?: string | null
  discarded_by?: string | null
  lifecycle_reason?: string | null
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
  _source?: 'org_chart' | 'portfolio_team'
  user?: UserProfile
}

type TabType = 'teams' | 'people' | 'portfolios' | 'requests' | 'access' | 'activity' | 'settings'

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

interface OrganizationContentProps {
  isOrgAdmin: boolean
  onUserClick?: (user: { id: string; full_name: string }) => void
  initialTab?: TabType
  initialAccessSubTab?: 'manage' | 'report'
  initialAccessFilter?: { teamNodeId?: string }
}

// Main content component - only rendered after loading is complete
function OrganizationContent({ isOrgAdmin, onUserClick, initialTab, initialAccessSubTab, initialAccessFilter }: OrganizationContentProps) {
  const { user } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const { currentOrgId } = useOrganization()
  const { canWrite, reason: archivedReason } = useOrgWriteEnabled()

  // Org-scoped localStorage key helper
  const orgKey = (key: string) => currentOrgId ? `${key}:${currentOrgId}` : key

  const [activeTab, setActiveTab] = useState<TabType>(() => {
    if (initialTab) return initialTab
    const savedTab = localStorage.getItem(currentOrgId ? `organization-active-tab:${currentOrgId}` : 'organization-active-tab')
    if (savedTab && ['teams', 'people', 'portfolios', 'requests', 'access', 'activity', 'settings'].includes(savedTab)) {
      return savedTab as TabType
    }
    return 'teams'
  })
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

  // People tab state (modals remain in parent for cross-tab sharing)
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
  const [modalNodeId, setModalNodeId] = useState<string | null>(null)
  const [modalInitialPage, setModalInitialPage] = useState<'profile' | 'manage'>('profile')
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

  // Portfolio lifecycle state
  const [portfolioStatusFilter, setPortfolioStatusFilter] = useState<'active' | 'archived' | 'discarded' | 'all'>('active')
  const [portfolioArchiveConfirm, setPortfolioArchiveConfirm] = useState<{ isOpen: boolean; portfolio: Portfolio | null; action: 'archive' | 'unarchive' }>({ isOpen: false, portfolio: null, action: 'archive' })
  const [portfolioDiscardTarget, setPortfolioDiscardTarget] = useState<{ id: string; name: string } | null>(null)

  // Portfolio role assignment flow (when adding member to team node)
  const [pendingTeamMemberAdd, setPendingTeamMemberAdd] = useState<{
    nodeId: string
    nodeName: string
    userId: string
    userName: string
    role: string
    focus?: string
    isCoverageAdmin?: boolean
    linkedPortfolios: LinkedPortfolio[]
  } | null>(null)

  // Team removal confirmation (shows which portfolios will be affected)
  const [teamRemovalConfirm, setTeamRemovalConfirm] = useState<{
    isOpen: boolean
    memberId: string
    memberName: string
    teamNodeId: string
    teamNodeName: string
    userId: string
    affectedPortfolios: string[]
  } | null>(null)

  // Teams sub-view mode: structure (org chart), coverage
  type TeamsViewMode = 'structure' | 'coverage'
  const [teamsViewMode, setTeamsViewMode] = useState<TeamsViewMode>(() => {
    const saved = localStorage.getItem(currentOrgId ? `organization-teams-view:${currentOrgId}` : 'organization-teams-view')
    if (saved === 'coverage') return saved
    return 'structure'
  })

  // Access sub-tab state
  type AccessSubTab = 'manage' | 'report'
  const [accessSubTab, setAccessSubTab] = useState<AccessSubTab>(() => {
    if (initialAccessSubTab) return initialAccessSubTab
    const saved = localStorage.getItem(currentOrgId ? `organization-access-subtab:${currentOrgId}` : 'organization-access-subtab')
    if (saved === 'manage' || saved === 'report') return saved
    return 'manage'
  })

  // Cross-navigation: Members → Governance focus user (cleared after handoff)
  const [governanceFocusUserId, setGovernanceFocusUserId] = useState<string | null>(null)
  const [governanceFocusFilter, setGovernanceFocusFilter] = useState<string | null>(null)

  // Org chart search & filter state
  const [orgChartSearch, setOrgChartSearch] = useState('')
  const [debouncedOrgChartSearch, setDebouncedOrgChartSearch] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedOrgChartSearch(orgChartSearch), 150)
    return () => clearTimeout(timer)
  }, [orgChartSearch])
  const [orgChartTypeFilter, setOrgChartTypeFilter] = useState<OrgNodeType | 'all'>('all')
  // Persistent expansion state map — keys are node IDs, values are collapsed state
  // Hydrate from localStorage on mount
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(currentOrgId ? `org-collapsed-nodes:${currentOrgId}` : 'org-collapsed-nodes')
      if (saved) return new Set(JSON.parse(saved))
    } catch { /* ignore */ }
    return new Set()
  })
  // Persist collapsed state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(orgKey('org-collapsed-nodes'), JSON.stringify([...collapsedNodes]))
    } catch { /* ignore */ }
  }, [collapsedNodes])
  const toggleNodeCollapsed = React.useCallback((nodeId: string) => {
    setCollapsedNodes(prev => {
      const next = new Set(prev)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }, [])
  const orgChartNodesRef = useRef<OrgChartNode[]>([])
  const collapseAll = React.useCallback(() => {
    const allIds = new Set(orgChartNodesRef.current.map(n => n.id))
    setCollapsedNodes(allIds)
  }, [])
  const expandAll = React.useCallback(() => {
    setCollapsedNodes(new Set())
  }, [])
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null)

  // Risk severity filter (from governance header click)
  const [riskSeverityFilter, setRiskSeverityFilter] = useState<'high' | 'medium' | 'low' | null>(null)

  // (permissionsRedirectNotice removed — permissions view merged into Access tab)

  // Show empty branches toggle (default: ON for admins, OFF for non-admins)
  const [showEmptyBranches, setShowEmptyBranches] = useState(isOrgAdmin)

  // (Permissions view state moved into Access Matrix component)

  // Persist active tab to localStorage (org-scoped)
  useEffect(() => {
    localStorage.setItem(orgKey('organization-active-tab'), activeTab)
  }, [activeTab, currentOrgId])

  // Persist teams view mode (org-scoped, only for permitted users)
  useEffect(() => {
    localStorage.setItem(orgKey('organization-teams-view'), teamsViewMode)
  }, [teamsViewMode, currentOrgId])

  // Persist access sub-tab
  useEffect(() => {
    localStorage.setItem(orgKey('organization-access-subtab'), accessSubTab)
  }, [accessSubTab, currentOrgId])

  // Fetch organization data by explicit ID
  const { data: organization } = useQuery({
    queryKey: ['organization', currentOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', currentOrgId!)
        .single()

      if (error && error.code !== 'PGRST116') throw error
      return data as Organization | null
    },
    enabled: !!currentOrgId,
  })

  // Fetch teams scoped to current org
  const { data: teams = [] } = useQuery({
    queryKey: ['teams', currentOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teams')
        .select('*')
        .eq('is_active', true)
        .order('name')

      if (error) throw error
      return data as Team[]
    },
    enabled: !!currentOrgId,
  })

  // Fetch org members via denormalized view scoped to current org
  const { data: orgMembers = [], isLoading: isLoadingOrgMembers } = useQuery({
    queryKey: ['organization-members', currentOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_members_v')
        .select('*')
        .eq('organization_id', currentOrgId!)
        .order('user_first_name', { ascending: true })

      if (error) throw error
      if (!data || data.length === 0) return []

      return data.map((row: any) => ({
        id: row.id,
        user_id: row.user_id,
        organization_id: row.organization_id,
        status: row.status,
        is_org_admin: row.is_org_admin,
        title: row.profile_title,
        user: {
          id: row.user_id,
          email: row.user_email || '',
          full_name: row.user_full_name || 'Unknown',
          coverage_admin: row.user_coverage_admin || false
        },
        profile: row.profile_user_type ? {
          user_type: row.profile_user_type,
          sector_focus: row.sector_focus || [],
          investment_style: row.investment_style || [],
          market_cap_focus: row.market_cap_focus || [],
          geography_focus: row.geography_focus || [],
          time_horizon: row.time_horizon || [],
          ops_departments: row.ops_departments || [],
          compliance_areas: row.compliance_areas || []
        } : null
      })) as OrganizationMembership[]
    }
  })

  // Fetch team memberships
  const { data: teamMemberships = [] } = useQuery({
    queryKey: ['team-memberships', currentOrgId],
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

  // Fetch portfolios (RLS scopes to current org via team_id or null team_id fallback)
  const { data: portfolios = [] } = useQuery({
    queryKey: ['portfolios-org', currentOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolios')
        .select('*')
        .order('name')

      if (error) throw error
      return data as Portfolio[]
    },
    enabled: !!currentOrgId,
  })

  // Fetch portfolio memberships
  const { data: portfolioMemberships = [] } = useQuery({
    queryKey: ['portfolio-memberships', currentOrgId],
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
    queryKey: ['portfolio-team-all', currentOrgId],
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
      const member = deletePortfolioTeamConfirm.member
      if (member?.portfolio_id) {
        queryClient.invalidateQueries({ queryKey: ['portfolio-team-with-users', member.portfolio_id] })
        queryClient.invalidateQueries({ queryKey: ['portfolio-team', member.portfolio_id] })
      }
      if (organization?.id && member) {
        logOrgActivity({
          organizationId: organization.id,
          action: 'portfolio_team.removed',
          targetType: 'portfolio',
          targetId: member.portfolio_id,
          entityType: 'portfolio_membership',
          actionType: 'removed',
          targetUserId: member.user_id,
          details: { role: member.role, portfolio_id: member.portfolio_id },
        })
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
    onSuccess: (_, { memberId, role }) => {
      queryClient.invalidateQueries({ queryKey: ['portfolio-team-all'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio-team-with-users'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio-team'] })
      const member = editingPortfolioTeamMember
      if (organization?.id && member) {
        logOrgActivity({
          organizationId: organization.id,
          action: 'portfolio_team.role_changed',
          targetType: 'portfolio',
          targetId: member.portfolio_id,
          entityType: 'portfolio_membership',
          actionType: 'role_changed',
          targetUserId: member.user_id,
          details: { old_role: member.role, new_role: role, portfolio_id: member.portfolio_id },
        })
      }
    },
    onError: (error) => {
      console.error('Failed to update team member:', error)
    }
  })

  // Update org_chart_node_members role/focus
  const updateNodeMemberMutation = useMutation({
    mutationFn: async ({ memberId, role, focus, nodeId, userId, oldRole }: { memberId: string; role: string; focus: string | null; nodeId?: string; userId?: string; oldRole?: string }) => {
      const { error } = await supabase
        .from('org_chart_node_members')
        .update({ role, focus })
        .eq('id', memberId)

      if (error) throw error
    },
    onSuccess: (_, { role, nodeId, userId, oldRole }) => {
      queryClient.invalidateQueries({ queryKey: ['org-chart-node-members'] })
      if (organization?.id && nodeId && userId) {
        logOrgActivity({
          organizationId: organization.id,
          action: 'team_node_member.role_changed',
          targetType: 'team_node',
          targetId: nodeId,
          entityType: 'team_membership',
          actionType: 'role_changed',
          targetUserId: userId,
          details: { old_role: oldRole, new_role: role },
        })
      }
    },
    onError: (error) => {
      console.error('Failed to update node member:', error)
    }
  })

  // Add portfolio team member mutation (direct assignment — no team provenance)
  const addPortfolioTeamMemberMutation = useMutation({
    mutationFn: async ({ portfolioId, userId, role, focus, sourceTeamNodeId }: { portfolioId: string; userId: string; role: string; focus?: string; sourceTeamNodeId?: string | null }) => {
      if (!role) throw new Error('Portfolio role is required')
      const { data, error } = await supabase
        .from('portfolio_team')
        .insert({
          portfolio_id: portfolioId,
          user_id: userId,
          role,
          focus: focus || null,
          ...(sourceTeamNodeId ? { source_team_node_id: sourceTeamNodeId } : {}),
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: (_, { portfolioId, userId, role, sourceTeamNodeId }) => {
      queryClient.invalidateQueries({ queryKey: ['portfolio-team-all'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio-team-with-users'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio-team'] })
      if (organization?.id) {
        logOrgActivity({
          organizationId: organization.id,
          action: 'portfolio_team.added',
          targetType: 'portfolio',
          targetId: portfolioId,
          entityType: 'portfolio_membership',
          actionType: 'role_granted',
          targetUserId: userId,
          sourceType: sourceTeamNodeId ? 'via_team' : 'direct',
          sourceId: sourceTeamNodeId || undefined,
          details: { role, portfolio_id: portfolioId },
        })
      }
    },
    onError: (error: any) => {
      alert(`Failed to add team member: ${error.message}`)
    }
  })

  // Archive / Unarchive portfolio mutation
  const archivePortfolioMutation = useMutation({
    mutationFn: async ({ portfolioId, action }: { portfolioId: string; action: 'archive' | 'unarchive' }) => {
      const rpc = action === 'archive' ? 'archive_portfolio' : 'unarchive_portfolio'
      const { error } = await supabase.rpc(rpc, { p_portfolio_id: portfolioId })
      if (error) throw error
    },
    onSuccess: (_, { portfolioId, action }) => {
      toast.success(action === 'archive' ? 'Portfolio archived' : 'Portfolio unarchived')
      queryClient.invalidateQueries({ queryKey: ['portfolios-org'] })
      queryClient.invalidateQueries({ queryKey: ['all-portfolios'] })
      setPortfolioArchiveConfirm({ isOpen: false, portfolio: null, action: 'archive' })
      if (organization?.id) {
        logOrgActivity({
          organizationId: organization.id,
          action: action === 'archive' ? 'portfolio.archived' : 'portfolio.restored',
          targetType: 'portfolio',
          targetId: portfolioId,
          entityType: 'portfolio',
          actionType: action === 'archive' ? 'archived' : 'restored',
        })
      }
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Operation failed')
    },
  })

  // Restore portfolio mutation (discarded → active)
  const restorePortfolioMutation = useMutation({
    mutationFn: async (portfolioId: string) => {
      const { error } = await supabase.rpc('restore_portfolio', { p_portfolio_id: portfolioId })
      if (error) throw error
    },
    onSuccess: (_, portfolioId) => {
      toast.success('Portfolio restored')
      queryClient.invalidateQueries({ queryKey: ['portfolios-org'] })
      queryClient.invalidateQueries({ queryKey: ['all-portfolios'] })
      if (organization?.id) {
        logOrgActivity({
          organizationId: organization.id,
          action: 'portfolio.restored',
          targetType: 'portfolio',
          targetId: portfolioId,
          entityType: 'portfolio',
          actionType: 'restored',
        })
      }
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to restore portfolio')
    },
  })

  // Fetch access requests (admin only - all pending requests)
  const { data: accessRequests = [] } = useQuery({
    queryKey: ['access-requests', currentOrgId],
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

  // Fetch organization contacts (non-login personnel) — deferred to People tab
  const { data: contacts = [] } = useQuery({
    queryKey: ['organization-contacts', currentOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_contacts')
        .select('*')
        .eq('is_active', true)
        .order('full_name')

      if (error) throw error
      return data as OrganizationContact[]
    },
    enabled: activeTab === 'people'
  })

  // Fetch org chart nodes
  const { data: orgChartNodes = [] } = useQuery({
    queryKey: ['org-chart-nodes', currentOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_org_chart_nodes_v')
        .select('*')
        .eq('is_active', true)
        .order('sort_order')

      if (error) throw error
      return data as OrgChartNode[]
    }
  })

  // Keep ref in sync for collapseAll callback (declared before query to avoid TDZ)
  orgChartNodesRef.current = orgChartNodes

  // Fetch org chart node links (for portfolios linked to multiple teams)
  const { data: orgChartNodeLinks = [] } = useQuery({
    queryKey: ['org-chart-node-links', currentOrgId],
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
    queryKey: ['org-chart-node-members', currentOrgId],
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

  // Unified node members: merge portfolio_team entries into org_chart_node_members
  // so every downstream consumer (graph, cards, modals) sees the complete picture.
  // Dedup by node_id:user_id:role to prevent the same membership appearing from both tables.
  const unifiedNodeMembers = React.useMemo(() => {
    // Build a set of node_ids that are portfolio nodes with a linked portfolio_id,
    // so we can prefer portfolio_team entries for those nodes (matches portfolio page).
    const portfolioNodeMap = new Map<string, string>() // node_id -> portfolio_id
    for (const node of orgChartNodes) {
      if (node.node_type === 'portfolio' && node.settings?.portfolio_id) {
        portfolioNodeMap.set(node.id, node.settings.portfolio_id)
      }
    }

    const unified: OrgChartNodeMember[] = []
    const seen = new Set<string>() // composite key: node_id:user_id:role

    // Build a lookup of org_chart_node_members by node_id:user_id so we can
    // merge coverage admin fields onto portfolio_team entries.
    const orgMemberByNodeUser = new Map<string, OrgChartNodeMember>()
    for (const m of orgChartNodeMembers) {
      orgMemberByNodeUser.set(`${m.node_id}:${m.user_id}`, m)
    }

    // First pass: add portfolio_team entries for portfolio nodes (authoritative source).
    for (const node of orgChartNodes) {
      if (node.node_type !== 'portfolio') continue
      const portfolioId = node.settings?.portfolio_id
      if (!portfolioId) continue

      const ptMembers = portfolioTeamMembers.filter(ptm => ptm.portfolio_id === portfolioId)
      for (const ptm of ptMembers) {
        const key = `${node.id}:${ptm.user_id}:${ptm.role}`
        if (seen.has(key)) continue
        seen.add(key)

        // Merge coverage admin fields from org_chart_node_members if present
        const orgEntry = orgMemberByNodeUser.get(`${node.id}:${ptm.user_id}`)

        unified.push({
          id: ptm.id,
          node_id: node.id,
          user_id: ptm.user_id,
          role: ptm.role,
          focus: ptm.focus,
          created_at: ptm.created_at,
          is_coverage_admin: orgEntry?.is_coverage_admin,
          coverage_admin_blocked: orgEntry?.coverage_admin_blocked,
          _source: 'portfolio_team' as const,
          user: ptm.user ? {
            id: ptm.user.id,
            email: ptm.user.email,
            full_name: [ptm.user.first_name, ptm.user.last_name].filter(Boolean).join(' ') || ptm.user.email,
            avatar_url: null,
          } : undefined,
        })
      }
    }

    // Second pass: add org_chart_node_members, but skip entries for portfolio
    // nodes that have a linked portfolio — portfolio_team is the sole source
    // of truth for those nodes (ensures org page matches portfolio page).
    for (const m of orgChartNodeMembers) {
      if (portfolioNodeMap.has(m.node_id)) continue

      const key = `${m.node_id}:${m.user_id}:${m.role}`
      if (seen.has(key)) continue
      seen.add(key)

      unified.push({
        ...m,
        _source: 'org_chart' as const,
      })
    }

    return unified
  }, [orgChartNodeMembers, orgChartNodes, portfolioTeamMembers])

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
    enabled: activeTab === 'settings' && !!organization?.id
  })

  // Fetch verified domain count (for onboarding policy warning)
  const { data: verifiedDomainCount = 0 } = useQuery({
    queryKey: ['organization-domains-count', organization?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('organization_domains')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'verified')
      if (error) throw error
      return count ?? 0
    },
    enabled: activeTab === 'settings' && !!organization?.id,
    staleTime: 60_000,
  })

  // Fetch coverage stats grouped by team_id for displaying on org nodes
  // Coverage flows through USER MEMBERSHIP - a user's coverage counts for all portfolios they're a member of
  const { data: coverageStatsByTeam = {} } = useQuery({
    queryKey: ['coverage-stats-by-team', orgChartNodes, orgChartNodeLinks, unifiedNodeMembers],
    queryFn: async () => {
      // Get all coverage records (ordered for stable aggregation)
      const { data: coverageData, error: coverageError } = await supabase
        .from('coverage')
        .select('asset_id, user_id')
        .eq('is_active', true)
        .order('user_id', { ascending: true })

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

      // Build a map of node_id -> member user_ids (from unified node members)
      const nodeMemberIds = new Map<string, Set<string>>()
      unifiedNodeMembers.forEach(member => {
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
    enabled: activeTab === 'teams' && !!orgChartNodes && orgChartNodes.length > 0
  })

  // Raw coverage records for OrgGraph (reuses the same query the coverage stats use)
  const { data: rawCoverageRecords = [] } = useQuery<CoverageRecord[]>({
    queryKey: ['coverage-records-raw', currentOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coverage')
        .select('asset_id, user_id')
        .eq('is_active', true)
        .order('user_id', { ascending: true })
      if (error) throw error
      return (data || []) as CoverageRecord[]
    },
    enabled: activeTab === 'teams' && !!currentOrgId,
  })

  // OrgGraph — derived selector layer
  const orgGraph = useOrgGraph({
    nodes: orgChartNodes,
    members: unifiedNodeMembers,
    links: orgChartNodeLinks,
    coverage: rawCoverageRecords,
  })

  // Risk counts by severity
  const riskCounts = React.useMemo(() => getRiskCountsBySeverity(orgGraph), [orgGraph])

  // Global coverage admin user IDs (from user profile, not node-scoped)
  const globalCoverageAdminUserIds = React.useMemo(() => {
    return new Set((orgMembers || []).filter((m: any) => m.user?.coverage_admin).map((m: any) => m.user_id as string))
  }, [orgMembers])

  // Governance summary — single authoritative source for header counts
  const govSummary = React.useMemo(() => {
    return computeGovernanceSummary(
      orgGraph,
      unifiedNodeMembers,
      (orgMembers || []).map((m: any) => ({ user_id: m.user_id, is_org_admin: m.is_org_admin })),
      globalCoverageAdminUserIds,
    )
  }, [orgGraph, unifiedNodeMembers, orgMembers, globalCoverageAdminUserIds])

  // Convenience aliases for header
  const adminCount = govSummary.orgAdminCount
  const coverageAdminCount = govSummary.coverageAdminCount

  // Access Matrix rows (replaces old filteredPermissionsMembers)
  const authorityRows = React.useMemo(() =>
    buildAuthorityRows({
      orgMembers: orgMembers || [],
      orgChartNodeMembers: unifiedNodeMembers,
      orgGraph,
      teamMemberships,
      portfolioTeamMembers,
      portfolios,
      globalCoverageAdminUserIds,
    }),
    [orgMembers, unifiedNodeMembers, orgGraph, teamMemberships, portfolioTeamMembers, portfolios, globalCoverageAdminUserIds],
  )

  const authoritySummary = React.useMemo(() =>
    computeAuthoritySummary(authorityRows),
    [authorityRows],
  )

  // Pending invites count (for seat meter)
  const { data: pendingInviteCount = 0 } = useQuery({
    queryKey: ['organization-invite-count', currentOrgId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('organization_invites')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', currentOrgId!)
        .in('status', ['pending', 'sent'])
      if (error) throw error
      return count ?? 0
    },
    enabled: !!currentOrgId && isOrgAdmin,
  })

  // Suspended member count (for seat meter)
  const suspendedCount = React.useMemo(
    () => (orgMembers || []).filter((m: any) => m.status === 'inactive').length,
    [orgMembers],
  )

  // Search-matching node IDs (empty set = no filter active)
  // Uses debounced search value to avoid re-computing on every keystroke
  const searchMatchIds = React.useMemo<Set<string>>(() => {
    const q = debouncedOrgChartSearch.trim().toLowerCase()
    if (!q) return new Set<string>()
    const matches = new Set<string>()
    for (const node of orgGraph.nodes.values()) {
      if (
        node.name.toLowerCase().includes(q) ||
        node.nodeType.includes(q) ||
        (node.customTypeLabel && node.customTypeLabel.toLowerCase().includes(q))
      ) {
        matches.add(node.id)
        // Also include all ancestors so they remain visible in the tree
        for (const ancestorId of node.path) matches.add(ancestorId)
      }
    }
    return matches
  }, [debouncedOrgChartSearch, orgGraph])

  // Type-filtered node IDs (empty set = no filter active)
  const typeFilterIds = React.useMemo<Set<string>>(() => {
    if (orgChartTypeFilter === 'all') return new Set<string>()
    const matches = new Set<string>()
    for (const node of orgGraph.nodes.values()) {
      if (node.nodeType === orgChartTypeFilter) {
        matches.add(node.id)
        for (const ancestorId of node.path) matches.add(ancestorId)
      }
    }
    return matches
  }, [orgChartTypeFilter, orgGraph])

  // Risk-severity-filtered node IDs (from governance header click)
  const riskFilterIds = React.useMemo<Set<string>>(() => {
    if (!riskSeverityFilter) return new Set<string>()
    const matches = new Set<string>()
    for (const node of orgGraph.nodes.values()) {
      if (node.riskFlags.some(f => f.severity === riskSeverityFilter)) {
        matches.add(node.id)
        for (const ancestorId of node.path) matches.add(ancestorId)
      }
    }
    return matches
  }, [riskSeverityFilter, orgGraph])

  // Breadcrumb path for focused node
  const focusedBreadcrumb = React.useMemo(() => {
    if (!focusedNodeId) return []
    const node = orgGraph.nodes.get(focusedNodeId)
    if (!node) return []
    const ancestors = node.path.map(id => orgGraph.nodes.get(id)).filter(Boolean) as { id: string; name: string }[]
    return [...ancestors, { id: node.id, name: node.name }]
  }, [focusedNodeId, orgGraph])

  // Helper to get portfolio IDs for a given team
  const getPortfolioIdsForTeam = (teamId: string): string[] => {
    if (!orgChartNodes) return []

    const portfolioNodes = orgChartNodes.filter(n => n.node_type === 'portfolio' && n.settings?.portfolio_id)
    const teamPortfolios = portfolioNodes.filter(p => p.parent_id === teamId)

    return teamPortfolios
      .map(p => p.settings?.portfolio_id)
      .filter((id): id is string => !!id)
  }

  /** Get all portfolios linked to a team node (direct children + org_chart_node_links). */
  const getLinkedPortfoliosForTeamNode = (teamNodeId: string): LinkedPortfolio[] => {
    const results: LinkedPortfolio[] = []
    const seen = new Set<string>()

    // Direct portfolio children
    for (const n of orgChartNodes) {
      if (n.node_type === 'portfolio' && n.parent_id === teamNodeId && n.settings?.portfolio_id) {
        if (!seen.has(n.id)) {
          seen.add(n.id)
          results.push({ nodeId: n.id, portfolioId: n.settings.portfolio_id, name: n.name })
        }
      }
    }

    // Linked via org_chart_node_links
    for (const link of orgChartNodeLinks) {
      if (link.linked_node_id === teamNodeId) {
        const linkedNode = orgChartNodes.find(nd => nd.id === link.node_id)
        if (linkedNode?.node_type === 'portfolio' && linkedNode.settings?.portfolio_id && !seen.has(linkedNode.id)) {
          seen.add(linkedNode.id)
          results.push({ nodeId: linkedNode.id, portfolioId: linkedNode.settings.portfolio_id, name: linkedNode.name })
        }
      }
    }

    return results
  }

  /** Get portfolio names that will be affected by removing a user from a team node. */
  const getAffectedPortfoliosForRemoval = (userId: string, teamNodeId: string): string[] => {
    return portfolioTeamMembers
      .filter((ptm) => ptm.user_id === userId && ptm.source_team_node_id === teamNodeId)
      .map((ptm) => {
        const portfolio = portfolios.find((p) => p.id === ptm.portfolio_id)
        return portfolio?.name || 'Unknown Portfolio'
      })
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

  // Branding & Compliance settings state (includes org name/description)
  const [editingBranding, setEditingBranding] = useState<{
    org_name: string
    org_description: string
    firm_name: string
    tagline: string
    default_disclaimer: string
  } | null>(null)
  const [isBrandingLocked, setIsBrandingLocked] = useState(true)
  const [brandingLogoFile, setBrandingLogoFile] = useState<File | null>(null)
  const [brandingLogoPreview, setBrandingLogoPreview] = useState<string | null>(null)
  const brandingLogoInputRef = useRef<HTMLInputElement>(null)

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

  // Initialize branding state from organization settings
  useEffect(() => {
    if (organization && !editingBranding) {
      const branding = organization.settings?.branding || {}
      setEditingBranding({
        org_name: organization.name || '',
        org_description: organization.description || '',
        firm_name: branding.firm_name || '',
        tagline: branding.tagline || '',
        default_disclaimer: branding.default_disclaimer || '',
      })
      // Set logo preview from existing logo_url (bucket is private, use signed URL)
      if (organization.logo_url) {
        supabase.storage.from('template-branding')
          .createSignedUrl(organization.logo_url, 3600)
          .then(({ data }) => {
            if (data?.signedUrl) setBrandingLogoPreview(data.signedUrl)
          })
      }
    }
  }, [organization])

  // Get members for a specific node
  const getNodeMembers = (nodeId: string) => {
    return unifiedNodeMembers.filter(m => m.node_id === nodeId)
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

  // Get node name by ID (for tooltip display)
  const getNodeName = (nodeId: string): string | undefined => {
    return orgChartNodes.find(n => n.id === nodeId)?.name
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

  // Effective tree based on focused subtree + empty branch filtering
  const displayTree = React.useMemo(() => {
    let tree = nodeTree

    // Focus on subtree if a node is focused
    if (focusedNodeId) {
      function findNode(nodes: OrgChartNode[]): OrgChartNode | null {
        for (const n of nodes) {
          if (n.id === focusedNodeId) return n
          if (n.children) {
            const found = findNode(n.children)
            if (found) return found
          }
        }
        return null
      }
      const found = findNode(nodeTree)
      tree = found ? [found] : nodeTree
    }

    // Filter out empty leaf nodes when showEmptyBranches is OFF
    if (!showEmptyBranches) {
      function filterEmpty(nodes: OrgChartNode[]): OrgChartNode[] {
        return nodes
          .map(n => ({
            ...n,
            children: n.children ? filterEmpty(n.children) : undefined
          }))
          .filter(n => {
            const hasChildren = n.children && n.children.length > 0
            const hasMembers = (getNodeMembers(n.id).length > 0)
            // Keep if it has children or has members
            return hasChildren || hasMembers
          })
      }
      tree = filterEmpty(tree)
    }

    return tree
  }, [nodeTree, focusedNodeId, showEmptyBranches, unifiedNodeMembers])

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

  // handleAccessRequestMutation moved to OrgRequestsTab component

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

  // Suspend user mutation (via deactivate_org_member RPC)
  const suspendUserMutation = useMutation({
    mutationFn: async ({ membershipId, reason }: { membershipId: string; reason: string }) => {
      // Find user_id from the modal target
      const targetUserId = showSuspendModal?.user_id
      if (!targetUserId) throw new Error('No target user')
      const { data, error } = await supabase.rpc('deactivate_org_member', {
        p_target_user_id: targetUserId,
        p_reason: reason || null,
      })
      if (error) throw error
      return { data, targetUserId, reason }
    },
    onSuccess: ({ targetUserId, reason }) => {
      queryClient.invalidateQueries({ queryKey: ['organization-members'] })
      queryClient.invalidateQueries({ queryKey: ['organization-members-paged'] })
      queryClient.invalidateQueries({ queryKey: ['org-admin-status'] })
      if (organization?.id) {
        logOrgActivity({
          organizationId: organization.id,
          action: 'member.deactivated',
          targetType: 'org_member',
          entityType: 'org_member',
          actionType: 'updated',
          targetUserId,
          details: { reason: reason || undefined },
        })
      }
      setShowSuspendModal(null)
    }
  })

  // Reactivate user mutation (via reactivate_org_member RPC)
  const reactivateMemberMutation = useMutation({
    mutationFn: async ({ userId }: { userId: string }) => {
      const { data, error } = await supabase.rpc('reactivate_org_member', {
        p_target_user_id: userId,
        p_reason: null,
      })
      if (error) throw error
      return data
    },
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ['organization-members'] })
      queryClient.invalidateQueries({ queryKey: ['organization-members-paged'] })
      queryClient.invalidateQueries({ queryKey: ['org-admin-status'] })
      toast.success('Member reactivated')
      if (organization?.id) {
        logOrgActivity({
          organizationId: organization.id,
          action: 'member.reactivated',
          targetType: 'org_member',
          entityType: 'org_member',
          actionType: 'updated',
          targetUserId: userId,
        })
      }
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to reactivate member')
    },
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
      if (organization?.id) {
        logOrgActivity({
          organizationId: organization.id,
          action: 'team_node.created',
          targetType: 'org_chart_node',
          targetId: result.newNode.id,
          details: { name: result.newNode.name, node_type: result.newNode.node_type },
          entityType: 'team_node',
          actionType: 'created',
        })
      }
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
      portfolio_id?: string
    }) => {
      // Build update payload
      const updatePayload: Record<string, any> = {
        name: nodeData.name,
        description: nodeData.description,
        color: nodeData.color,
        icon: nodeData.icon,
        custom_type_label: nodeData.custom_type_label,
        is_non_investment: nodeData.is_non_investment || false,
        updated_at: new Date().toISOString(),
      }

      // If portfolio_id is provided, merge it into settings
      if (nodeData.portfolio_id !== undefined) {
        // Fetch existing settings to merge
        const { data: existing } = await supabase
          .from('org_chart_nodes')
          .select('settings')
          .eq('id', nodeData.id)
          .single()
        const currentSettings = existing?.settings || {}
        updatePayload.settings = {
          ...currentSettings,
          portfolio_id: nodeData.portfolio_id || null,
        }
      }

      const { data, error } = await supabase
        .from('org_chart_nodes')
        .update(updatePayload)
        .eq('id', nodeData.id)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: (data, nodeData) => {
      queryClient.invalidateQueries({ queryKey: ['org-chart-nodes'] })
      setEditingNode(null)
      if (organization?.id) {
        logOrgActivity({
          organizationId: organization.id,
          action: 'team_node.updated',
          targetType: 'org_chart_node',
          targetId: nodeData.id,
          details: { name: nodeData.name },
          entityType: 'team_node',
          actionType: 'updated',
        })
      }
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
    onSuccess: (_, nodeId) => {
      queryClient.invalidateQueries({ queryKey: ['org-chart-nodes'] })
      if (organization?.id) {
        logOrgActivity({
          organizationId: organization.id,
          action: 'team_node.deleted',
          targetType: 'org_chart_node',
          targetId: nodeId,
          entityType: 'team_node',
          actionType: 'deleted',
        })
      }
    }
  })

  // Add member to org chart node mutation
  const addNodeMemberMutation = useMutation({
    mutationFn: async (memberData: { node_id: string; user_id: string; role: string; focus?: string; is_coverage_admin?: boolean; node_name?: string }) => {
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
    onSuccess: (_, { node_id, user_id, role, node_name }) => {
      queryClient.invalidateQueries({ queryKey: ['org-chart-node-members'] })
      queryClient.invalidateQueries({ queryKey: ['user-coverage-admin-nodes'] })
      if (organization?.id) {
        logOrgActivity({
          organizationId: organization.id,
          action: 'team_node_member.added',
          targetType: 'team_node',
          targetId: node_id,
          entityType: 'team_membership',
          actionType: 'added',
          targetUserId: user_id,
          details: { role, node_name },
        })
      }
    },
    onError: (error: any) => {
      alert(`Failed to add member: ${error.message}`)
    }
  })

  // Remove member from org chart node mutation
  const removeNodeMemberMutation = useMutation({
    mutationFn: async ({ memberId, nodeId, userId, nodeName }: { memberId: string; nodeId?: string; userId?: string; nodeName?: string }) => {
      const { error } = await supabase
        .from('org_chart_node_members')
        .delete()
        .eq('id', memberId)

      if (error) throw error
    },
    onSuccess: (_, { nodeId, userId, nodeName }) => {
      queryClient.invalidateQueries({ queryKey: ['org-chart-node-members'] })
      if (organization?.id && nodeId && userId) {
        logOrgActivity({
          organizationId: organization.id,
          action: 'team_node_member.removed',
          targetType: 'team_node',
          targetId: nodeId,
          entityType: 'team_membership',
          actionType: 'removed',
          targetUserId: userId,
          details: { node_name: nodeName },
        })
      }
    }
  })

  // ── Compound mutation: add member to team node + assign portfolio roles ──
  const addTeamMemberWithPortfoliosMutation = useMutation({
    mutationFn: async ({
      nodeId,
      userId,
      role,
      focus,
      isCoverageAdmin,
      portfolioAssignments,
    }: {
      nodeId: string
      userId: string
      role: string
      focus?: string
      isCoverageAdmin?: boolean
      portfolioAssignments: PortfolioRoleAssignment[]
    }) => {
      // 1. Insert org_chart_node_members with team role + function
      const { error: nodeErr } = await supabase
        .from('org_chart_node_members')
        .insert({
          node_id: nodeId,
          user_id: userId,
          role,
          focus: focus || null,
          is_coverage_admin: isCoverageAdmin || false,
        })

      if (nodeErr) {
        throw new Error(`Failed to add node member: ${nodeErr.message}`)
      }

      // 2. Insert portfolio_team rows for each linked portfolio with source tracking
      const portfolioInserts = portfolioAssignments.map((a) => ({
        portfolio_id: a.portfolioId,
        user_id: userId,
        role: a.role,
        focus: a.focus || null,
        source_team_node_id: nodeId,
      }))

      if (portfolioInserts.length > 0) {
        const { error: ptErr } = await supabase
          .from('portfolio_team')
          .insert(portfolioInserts)

        if (ptErr) {
          throw new Error(`Failed to assign portfolio roles: ${ptErr.message}`)
        }
      }
    },
    onSuccess: (_, { nodeId, userId, role, portfolioAssignments }) => {
      queryClient.invalidateQueries({ queryKey: ['org-chart-node-members'] })
      queryClient.invalidateQueries({ queryKey: ['user-coverage-admin-nodes'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio-team-all'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio-team-with-users'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio-team'] })
      if (organization?.id) {
        const nodeName = orgChartNodes.find(n => n.id === nodeId)?.name
        const initiator = user?.id
        const events: import('../types/organization').LogOrgActivityParams[] = [
          {
            organizationId: organization.id,
            action: 'team_node_member.added',
            targetType: 'team_node',
            targetId: nodeId,
            entityType: 'team_membership',
            actionType: 'added',
            targetUserId: userId,
            initiatorUserId: initiator,
            details: { role, node_name: nodeName },
          },
          ...portfolioAssignments.map((a) => ({
            organizationId: organization!.id,
            action: 'portfolio_team.added' as const,
            targetType: 'portfolio' as const,
            targetId: a.portfolioId,
            entityType: 'portfolio_membership' as const,
            actionType: 'role_granted' as const,
            targetUserId: userId,
            sourceType: 'via_team' as const,
            sourceId: nodeId,
            initiatorUserId: initiator,
            actorOverride: null as string | null,
            details: { role: a.role, portfolio_id: a.portfolioId, node_name: nodeName },
          })),
        ]
        logOrgActivityBatch(events)
      }
      setPendingTeamMemberAdd(null)
    },
    onError: (error: any) => {
      alert(`Failed to add team member: ${error.message}`)
    },
  })

  // ── Compound mutation: remove member from team node + cascade portfolio_team ──
  const removeTeamMemberWithCascadeMutation = useMutation({
    mutationFn: async ({
      memberId,
      userId,
      teamNodeId,
    }: {
      memberId: string
      userId: string
      teamNodeId: string
    }) => {
      // 1. Try to delete portfolio_team rows where source_team_node_id matches
      // (gracefully skip if source_team_node_id column doesn't exist yet — migration pending)
      try {
        await supabase
          .from('portfolio_team')
          .delete()
          .eq('user_id', userId)
          .eq('source_team_node_id', teamNodeId)
      } catch {
        // Column may not exist yet; cascade delete is a no-op until migration is applied
      }

      // 2. Delete the org_chart_node_members row
      const { error: nodeErr } = await supabase
        .from('org_chart_node_members')
        .delete()
        .eq('id', memberId)

      if (nodeErr) throw nodeErr
    },
    onSuccess: (_, { userId, teamNodeId }) => {
      queryClient.invalidateQueries({ queryKey: ['org-chart-node-members'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio-team-all'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio-team-with-users'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio-team'] })
      if (organization?.id) {
        const confirm = teamRemovalConfirm
        const nodeName = confirm?.teamNodeName || orgChartNodes.find(n => n.id === teamNodeId)?.name
        const initiator = user?.id
        const events: import('../types/organization').LogOrgActivityParams[] = [
          {
            organizationId: organization.id,
            action: 'team_node_member.removed',
            targetType: 'team_node',
            targetId: teamNodeId,
            entityType: 'team_membership',
            actionType: 'removed',
            targetUserId: userId,
            initiatorUserId: initiator,
            details: { node_name: nodeName },
          },
          ...(confirm?.affectedPortfolios || []).map((portfolioId) => ({
            organizationId: organization!.id,
            action: 'portfolio_team.removed' as const,
            targetType: 'portfolio' as const,
            targetId: portfolioId,
            entityType: 'portfolio_membership' as const,
            actionType: 'role_revoked' as const,
            targetUserId: userId,
            sourceType: 'via_team' as const,
            sourceId: teamNodeId,
            initiatorUserId: initiator,
            actorOverride: null as string | null,
            details: { node_name: nodeName, cascade: true },
          })),
        ]
        logOrgActivityBatch(events)
      }
      setTeamRemovalConfirm(null)
    },
    onError: (error: any) => {
      alert(`Failed to remove team member: ${error.message}`)
    },
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
    onSuccess: (_, { memberId, isCoverageAdmin }) => {
      queryClient.invalidateQueries({ queryKey: ['org-chart-node-members'] })
      queryClient.invalidateQueries({ queryKey: ['user-coverage-admin-nodes'] })
      const member = unifiedNodeMembers.find(m => m.id === memberId)
      if (organization?.id && member) {
        logOrgActivity({
          organizationId: organization.id,
          action: isCoverageAdmin ? 'team_node_member.coverage_admin_granted' : 'team_node_member.coverage_admin_revoked',
          targetType: 'team_node',
          targetId: member.node_id,
          entityType: 'team_membership',
          actionType: isCoverageAdmin ? 'role_granted' : 'role_revoked',
          targetUserId: member.user_id,
          details: { is_coverage_admin: isCoverageAdmin },
        })
      }
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
    onSuccess: (_, { memberId, isBlocked }) => {
      queryClient.invalidateQueries({ queryKey: ['org-chart-node-members'] })
      if (organization?.id) {
        logOrgActivity({
          organizationId: organization.id,
          action: 'team_node_member.coverage_admin_blocked',
          targetType: 'org_chart_node_member',
          targetId: memberId,
          details: { is_blocked: isBlocked },
          entityType: 'team_membership',
          actionType: isBlocked ? 'role_revoked' : 'role_granted',
        })
      }
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
    onSuccess: (_, { nodeId, hasOverride }) => {
      queryClient.invalidateQueries({ queryKey: ['org-chart-nodes'] })
      queryClient.invalidateQueries({ queryKey: ['coverage-admin-override-nodes'] })
      if (organization?.id) {
        logOrgActivity({
          organizationId: organization.id,
          action: 'team_node.coverage_override_changed',
          targetType: 'org_chart_node',
          targetId: nodeId,
          details: { coverage_admin_override: hasOverride },
          entityType: 'team_node',
          actionType: 'updated',
        })
      }
    }
  })

  // Toggle org admin status (for Access Matrix)
  const toggleOrgAdminMutation = useMutation({
    mutationFn: async ({ userId, isOrgAdmin }: { userId: string; isOrgAdmin: boolean }) => {
      if (!isOrgAdmin) {
        const activeAdminCount = (orgMembers || []).filter((m: any) => m.is_org_admin).length
        if (activeAdminCount <= 1) throw new Error('Cannot remove the last org admin.')
      }
      const { error } = await supabase
        .from('organization_memberships')
        .update({ is_org_admin: isOrgAdmin })
        .eq('user_id', userId)
        .eq('organization_id', currentOrgId!)
      if (error) throw error
    },
    onSuccess: (_, { userId, isOrgAdmin }) => {
      queryClient.invalidateQueries({ queryKey: ['organization-members'] })
      queryClient.invalidateQueries({ queryKey: ['org-admin-status'] })
      toast.success('Org admin status updated')
      if (organization?.id) {
        logOrgActivity({
          organizationId: organization.id,
          action: 'membership.admin_changed',
          targetType: 'org_member',
          entityType: 'org_member',
          actionType: isOrgAdmin ? 'role_granted' : 'role_revoked',
          targetUserId: userId,
          details: { old_is_org_admin: !isOrgAdmin, new_is_org_admin: isOrgAdmin },
        })
      }
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to update'),
  })

  // Toggle global coverage admin status (for Access Matrix)
  const toggleGlobalCoverageAdminMutation = useMutation({
    mutationFn: async ({ userId, isCoverageAdmin }: { userId: string; isCoverageAdmin: boolean }) => {
      const { error } = await supabase
        .from('users')
        .update({ coverage_admin: isCoverageAdmin })
        .eq('id', userId)
      if (error) throw error
    },
    onSuccess: (_, { userId, isCoverageAdmin }) => {
      queryClient.invalidateQueries({ queryKey: ['organization-members'] })
      toast.success('Coverage admin status updated')
      if (organization?.id) {
        logOrgActivity({
          organizationId: organization.id,
          action: 'user.coverage_admin_changed',
          targetType: 'org_member',
          entityType: 'org_member',
          actionType: isCoverageAdmin ? 'role_granted' : 'role_revoked',
          targetUserId: userId,
          details: { old_coverage_admin: !isCoverageAdmin, new_coverage_admin: isCoverageAdmin },
        })
      }
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to update'),
  })

  // Update onboarding policy mutation
  const updateOnboardingPolicyMutation = useMutation({
    mutationFn: async (policy: 'open' | 'approval_required' | 'invite_only') => {
      if (!organization?.id) throw new Error('No organization found')
      const { error } = await supabase
        .from('organizations')
        .update({ onboarding_policy: policy })
        .eq('id', organization.id)
      if (error) throw error
    },
    onSuccess: (_, policy) => {
      queryClient.invalidateQueries({ queryKey: ['organization'] })
      toast.success('Onboarding policy updated')
      if (organization?.id) {
        logOrgActivity({
          organizationId: organization.id,
          action: 'settings.onboarding_policy_changed',
          targetType: 'organization',
          targetId: organization.id,
          details: { new_policy: policy },
          entityType: 'settings',
          actionType: 'updated',
        })
      }
    },
    onError: (error: any) => {
      toast.error(mapMutationError(error))
    },
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
      if (organization?.id) {
        logOrgActivity({
          organizationId: organization.id,
          action: 'settings.coverage_changed',
          targetType: 'organization',
          targetId: organization.id,
          entityType: 'settings',
          actionType: 'updated',
        })
      }
    }
  })

  // Save branding settings mutation (includes org name/description)
  const saveBrandingMutation = useMutation({
    mutationFn: async (branding: {
      org_name: string
      org_description: string
      firm_name: string
      tagline: string
      default_disclaimer: string
      logoFile?: File | null
      removeLogo?: boolean
    }) => {
      if (!organization?.id) throw new Error('No organization found')
      const trimmedName = branding.org_name.trim()
      if (!trimmedName) throw new Error('Organization name is required')

      let logoUrl = organization.logo_url

      // Handle logo upload
      if (branding.logoFile) {
        const randomId = Math.random().toString(36).substring(2, 10)
        const extension = branding.logoFile.name.split('.').pop() || 'png'
        const storagePath = `org/${organization.id}/${randomId}.${extension}`

        // Remove old logo if exists
        if (organization.logo_url) {
          await supabase.storage.from('template-branding').remove([organization.logo_url])
        }

        const { error: uploadError } = await supabase.storage
          .from('template-branding')
          .upload(storagePath, branding.logoFile)

        if (uploadError) throw uploadError
        logoUrl = storagePath
      } else if (branding.removeLogo && organization.logo_url) {
        await supabase.storage.from('template-branding').remove([organization.logo_url])
        logoUrl = null
      }

      // Merge branding into existing settings JSONB
      const existingSettings = organization.settings || {}
      const newSettings = {
        ...existingSettings,
        branding: {
          firm_name: branding.firm_name,
          tagline: branding.tagline,
          default_disclaimer: branding.default_disclaimer,
        }
      }

      const { error } = await supabase
        .from('organizations')
        .update({
          name: trimmedName,
          description: branding.org_description.trim() || null,
          settings: newSettings,
          logo_url: logoUrl,
          updated_at: new Date().toISOString(),
        })
        .eq('id', organization.id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization'] })
      queryClient.invalidateQueries({ queryKey: ['user-organizations'] })
      setBrandingLogoFile(null)
      setIsBrandingLocked(true)
      toast({ title: 'Settings saved', variant: 'success' })
      if (organization?.id) {
        logOrgActivity({
          organizationId: organization.id,
          action: 'settings.branding_changed',
          targetType: 'organization',
          targetId: organization.id,
          entityType: 'settings',
          actionType: 'updated',
        })
      }
    },
    onError: (err: any) => {
      toast({ title: mapMutationError(err, 'update'), variant: 'error' })
    },
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

  // Helper to get display name from portfolio team member
  const getTeamMemberDisplayName = (member: PortfolioTeamMember) => {
    if (member.user?.first_name || member.user?.last_name) {
      return `${member.user.first_name || ''} ${member.user.last_name || ''}`.trim()
    }
    return member.user?.email?.split('@')[0] || 'Unknown'
  }

  const filteredTeams = teams.filter(t =>
    t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.description?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const filteredPortfolios = portfolios.filter(p => {
    const pStatus = p.status || (p.archived_at ? 'archived' : 'active')
    if (portfolioStatusFilter === 'active' && pStatus !== 'active') return false
    if (portfolioStatusFilter === 'archived' && pStatus !== 'archived') return false
    if (portfolioStatusFilter === 'discarded' && pStatus !== 'discarded') return false
    return (
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.description?.toLowerCase().includes(searchTerm.toLowerCase())
    )
  })

  const portfolioStatusCounts = {
    active: portfolios.filter(p => (p.status || (p.archived_at ? 'archived' : 'active')) === 'active').length,
    archived: portfolios.filter(p => (p.status || (p.archived_at ? 'archived' : 'active')) === 'archived').length,
    discarded: portfolios.filter(p => p.status === 'discarded').length,
    all: portfolios.length,
  }

  // Helper to check if current user is a member of an org chart node (team)
  const isUserMemberOfNode = (nodeId: string): boolean => {
    if (!user?.id) return false
    // Check unified node members (org_chart + portfolio_team)
    const nodeMembers = unifiedNodeMembers.filter(m => m.node_id === nodeId)
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
    { id: 'people', label: 'Members', icon: <UserCircle className="w-4 h-4" /> },
    { id: 'portfolios', label: 'Portfolios', icon: <Briefcase className="w-4 h-4" /> },
    { id: 'requests', label: 'Requests', icon: <Bell className="w-4 h-4" />, adminOnly: true },
    { id: 'access', label: 'Governance', icon: <Shield className="w-4 h-4" />, adminOnly: true },
    { id: 'activity', label: 'Activity', icon: <Clock className="w-4 h-4" />, adminOnly: true },
    { id: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4" />, adminOnly: true }
  ]

  // Note: Access tab visibility is refined below after orgPerms is computed
  const _baseTabs = tabs.filter(t => !t.adminOnly || isOrgAdmin)

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

  // Centralized governance permissions
  const orgPerms = resolveOrgPermissions({
    isOrgAdmin,
    isCoverageAdmin,
    profile: currentUserMembership?.profile,
  })

  // Compute visible tabs — Access tab is visible for canViewAccessSection (includes COMPLIANCE role)
  const visibleTabs = _baseTabs.filter(t => {
    if (t.id === 'access') return orgPerms.canViewAccessSection
    return true
  })

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
    <div className={`h-full flex flex-col ${activeTab === 'teams' ? 'bg-white' : 'bg-gray-50'} relative`}>
      {/* Loading overlay with blur */}
      {isLoadingOrgMembers && (
        <div className="absolute inset-0 bg-white/70 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        </div>
      )}
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
              <OrgBadge />
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
                              : 'Read-only — contact a coverage admin to make changes'}
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

      {/* Search Bar (portfolios only — people tab has its own search) */}
      {activeTab === 'portfolios' && (
        <div className="bg-white px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search portfolios..."
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
        style={activeTab === 'teams' && teamsViewMode === 'structure' ? { cursor: isPanning ? 'grabbing' : 'grab' } : undefined}
        onMouseDown={activeTab === 'teams' && teamsViewMode === 'structure' ? handlePanStart : undefined}
        onMouseMove={activeTab === 'teams' && teamsViewMode === 'structure' ? handlePanMove : undefined}
        onMouseUp={activeTab === 'teams' && teamsViewMode === 'structure' ? handlePanEnd : undefined}
        onMouseLeave={activeTab === 'teams' && teamsViewMode === 'structure' ? handlePanEnd : undefined}
      >
        <div className={activeTab === 'people' ? '' : activeTab === 'teams' && teamsViewMode === 'structure' ? 'min-w-max p-6' : activeTab === 'teams' ? 'p-6' : activeTab === 'portfolios' ? 'max-w-7xl mx-auto' : 'max-w-5xl mx-auto'}>
          {/* Teams Tab - Interactive Org Chart */}
          {activeTab === 'teams' && (
            <div>
              {/* ── View Switcher Toolbar + Org Summary ── */}
              <div className="flex items-center justify-between mb-5" data-no-pan>
                {/* View switcher */}
                <div className="inline-flex items-center bg-gray-100 rounded p-0.5">
                  {([
                    { mode: 'structure' as TeamsViewMode, label: 'Structure', icon: <LayoutGrid className="w-3.5 h-3.5" /> },
                    { mode: 'coverage' as TeamsViewMode, label: 'Coverage', icon: <Eye className="w-3.5 h-3.5" /> },
                  ]).map(v => (
                    <button
                      key={v.mode}
                      onClick={() => setTeamsViewMode(v.mode)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                        teamsViewMode === v.mode
                          ? 'bg-white text-gray-900 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {v.icon}
                      {v.label}
                    </button>
                  ))}
                </div>
                {orgPerms.canViewAccessSection && (
                  <button
                    onClick={() => { setActiveTab('access'); setAccessSubTab('manage') }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded transition-colors border border-indigo-200"
                  >
                    <Shield className="w-3.5 h-3.5" />
                    Governance
                  </button>
                )}
              </div>

              {/* (Permissions redirect notice removed — merged into Access tab) */}

              {/* Governance Header — only for admin/ops/compliance */}
              {orgPerms.canViewGovernance && (
                <OrganizationGovernanceHeader
                  orgGraph={orgGraph}
                  riskCounts={riskCounts}
                  adminCount={adminCount}
                  coverageAdminCount={coverageAdminCount}
                  isOrgAdmin={isOrgAdmin}
                  activeRiskFilter={riskSeverityFilter}
                  onRiskFilterClick={(severity) => {
                    setRiskSeverityFilter(prev => prev === severity ? null : severity)
                  }}
                />
              )}

              {/* ── Structure View (Org Chart) ── */}
              {teamsViewMode === 'structure' && (
              <div>
              {/* Search + Filters + Controls bar */}
              <div className="flex items-center gap-3 mb-4" data-no-pan>
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search nodes..."
                    value={orgChartSearch}
                    onChange={(e) => setOrgChartSearch(e.target.value)}
                    className="w-48 pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
                  />
                  {orgChartSearch && (
                    <button
                      onClick={() => setOrgChartSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* Type filter chips */}
                <div className="flex items-center gap-1">
                  {([
                    { type: 'all' as const, label: 'All' },
                    { type: 'division' as const, label: 'Divisions' },
                    { type: 'department' as const, label: 'Departments' },
                    { type: 'team' as const, label: 'Teams' },
                    { type: 'portfolio' as const, label: 'Portfolios' },
                  ]).map(chip => (
                    <button
                      key={chip.type}
                      onClick={() => setOrgChartTypeFilter(chip.type)}
                      className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                        orgChartTypeFilter === chip.type
                          ? 'bg-indigo-50 text-indigo-700 font-medium border border-indigo-200'
                          : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700 border border-transparent'
                      }`}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>

                <div className="flex-1" />

                {/* Collapse / Expand all */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={collapseAll}
                    className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                    title="Collapse all"
                  >
                    <Minimize2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={expandAll}
                    className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                    title="Expand all"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Show empty branches toggle */}
                <button
                  onClick={() => setShowEmptyBranches(prev => !prev)}
                  className={`px-2 py-0.5 text-[11px] rounded border transition-colors ${
                    showEmptyBranches
                      ? 'bg-gray-100 text-gray-700 border-gray-200'
                      : 'text-gray-400 border-transparent hover:bg-gray-50'
                  }`}
                  title={showEmptyBranches ? 'Showing empty branches' : 'Empty branches hidden'}
                >
                  {showEmptyBranches ? 'Hide empty' : 'Show empty'}
                </button>

                {/* Search result count */}
                {orgChartSearch && (
                  <span className="text-xs text-gray-400">
                    {searchMatchIds.size > 0
                      ? `${searchMatchIds.size} match${searchMatchIds.size !== 1 ? 'es' : ''}`
                      : 'No matches'}
                  </span>
                )}

                {/* Active risk filter indicator */}
                {riskSeverityFilter && (
                  <button
                    onClick={() => setRiskSeverityFilter(null)}
                    className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border transition-colors ${
                      riskSeverityFilter === 'high'
                        ? 'bg-red-50 text-red-700 border-red-200'
                        : riskSeverityFilter === 'medium'
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-gray-100 text-gray-600 border-gray-200'
                    }`}
                    title="Clear risk filter"
                  >
                    <AlertTriangle className="w-3 h-3" />
                    {riskSeverityFilter.charAt(0).toUpperCase() + riskSeverityFilter.slice(1)} risks
                    <X className="w-3 h-3 ml-0.5" />
                  </button>
                )}
              </div>

              {/* Breadcrumb trail (when focused on a subtree) */}
              {focusedNodeId && focusedBreadcrumb.length > 0 && (
                <div className="flex items-center justify-between mb-3 px-3 py-1.5 bg-indigo-50/50 border border-indigo-100 rounded-md" data-no-pan>
                  <div className="flex items-center gap-1 text-xs">
                    <button
                      onClick={() => setFocusedNodeId(null)}
                      className="flex items-center gap-1 px-2 py-1 text-gray-500 hover:text-indigo-600 hover:bg-indigo-100 rounded transition-colors"
                    >
                      <Home className="w-3 h-3" />
                      <span>Organization</span>
                    </button>
                    {focusedBreadcrumb.map((crumb, i) => (
                      <React.Fragment key={crumb.id}>
                        <ChevronRight className="w-3 h-3 text-gray-400" />
                        <button
                          onClick={() => i < focusedBreadcrumb.length - 1 ? setFocusedNodeId(crumb.id) : undefined}
                          className={`px-2 py-1 rounded transition-colors ${
                            i === focusedBreadcrumb.length - 1
                              ? 'font-medium text-gray-900 bg-white shadow-sm border border-gray-200'
                              : 'text-gray-500 hover:text-indigo-600 hover:bg-indigo-100'
                          }`}
                        >
                          {crumb.name}
                        </button>
                      </React.Fragment>
                    ))}
                  </div>
                  <button
                    onClick={() => setFocusedNodeId(null)}
                    className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-indigo-700 bg-white border border-indigo-200 hover:bg-indigo-50 rounded shadow-sm transition-colors"
                  >
                    <X className="w-3 h-3" />
                    Exit focus
                  </button>
                </div>
              )}

              {/* Org Chart Header - Organization Root Node (hidden when focused on subtree) */}
              {!focusedNodeId && (
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
                {displayTree.length > 0 && !focusedNodeId && (
                  <div className="relative group/connector">
                    <div className="w-0.5 h-8 bg-gray-300" />
                    {/* Insert button - appears on hover */}
                    {isOrgAdmin && (
                      <button
                        onClick={() => {
                          setAddNodeParentId(null)
                          setInsertBetweenChildIds(displayTree.map(n => n.id))
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
              )}

              {/* Children container with proper connectors */}
              {displayTree.length > 0 && (
                <div className="flex flex-col items-center">
                  {/* Children nodes with T-connectors */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
                    {/* Org Chart Nodes - hierarchical structure */}
                    {displayTree.map((node, nodeIndex) => {
                      const isFirstNode = nodeIndex === 0
                      const isLastNode = nodeIndex === displayTree.length - 1

                      return (
                        <div key={node.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '216px', flexShrink: 0, marginLeft: nodeIndex > 0 ? '16px' : '0' }}>
                          {/* T-connector with overlapping lines */}
                          <div style={{ position: 'relative', width: '100%', height: '18px', overflow: 'visible' }}>
                            {/* Left horizontal segment - extends into the margin gap */}
                            {!isFirstNode && (
                              <div style={{
                                position: 'absolute',
                                top: '0',
                                left: '-16px',
                                width: 'calc(50% + 17px)',
                                height: '2px',
                                backgroundColor: '#9ca3af'
                              }} />
                            )}
                            {/* Right horizontal segment - extends into the margin gap */}
                            {!isLastNode && (
                              <div style={{
                                position: 'absolute',
                                top: '0',
                                right: '-16px',
                                width: 'calc(50% + 17px)',
                                height: '2px',
                                backgroundColor: '#9ca3af'
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
                              backgroundColor: '#9ca3af'
                            }} />
                          </div>
                          <OrgChartNodeCard
                            node={node}
                            isOrgAdmin={isOrgAdmin}
                            onEdit={(n) => { setModalInitialPage('manage'); setModalNodeId(n.id) }}
                            onAddChild={(parentId) => {
                              setAddNodeParentId(parentId)
                              setShowAddNodeModal(true)
                            }}
                            onAddSibling={(parentId) => {
                              setAddNodeParentId(parentId)
                              setShowAddNodeModal(true)
                            }}
                            onDelete={(nodeId) => {
                              const target = orgChartNodes.find(n => n.id === nodeId)
                              if (target) setDeleteNodeConfirm({ isOpen: true, node: target })
                            }}
                            onAddMember={(n) => setShowAddNodeMemberModal(n)}
                            onRemoveMember={(memberId) => {
                              const member = unifiedNodeMembers.find(m => m.id === memberId)
                              if (member) {
                                const affected = getAffectedPortfoliosForRemoval(member.user_id, member.node_id)
                                const memberName = member.user?.full_name || member.user?.email || 'Unknown'
                                const nodeName = orgChartNodes.find(n => n.id === member.node_id)?.name || 'this node'

                                if (affected.length > 0) {
                                  setTeamRemovalConfirm({
                                    isOpen: true,
                                    memberId,
                                    memberName,
                                    teamNodeId: member.node_id,
                                    teamNodeName: nodeName,
                                    userId: member.user_id,
                                    affectedPortfolios: affected,
                                  })
                                } else {
                                  if (window.confirm(`Remove ${memberName} from ${nodeName}?`)) {
                                    removeNodeMemberMutation.mutate({ memberId, nodeId: member.node_id, userId: member.user_id, nodeName })
                                  }
                                }
                              } else {
                                if (window.confirm('Remove this member from the node?')) {
                                  removeNodeMemberMutation.mutate({ memberId })
                                }
                              }
                            }}
                            getNodeMembers={getNodeMembers}
                            getSharedTeams={getSharedTeams}
                            getTeamMembers={getTeamMembers}
                            getTeamPortfolios={getTeamPortfolios}
                            onAddTeamMember={(teamId) => {
                              const team = teams.find(t => t.id === teamId)
                              if (team) {
                                setSelectedTeam(team)
                                setShowAddMemberModal(true)
                              }
                            }}
                            onRemoveTeamMember={(memberId) => {
                              if (window.confirm('Remove this member from the team?')) {
                                removeTeamMemberMutation.mutate(memberId)
                              }
                            }}
                            onInsertBetween={(parentId, childIds) => {
                              setAddNodeParentId(parentId)
                              setInsertBetweenChildIds(childIds)
                              setShowAddNodeModal(true)
                            }}
                            onViewDetails={(n) => { setModalInitialPage('profile'); setModalNodeId(n.id) }}
                            getCoverageStats={(teamId) => coverageStatsByTeam[teamId]}
                            onViewTeamCoverage={(teamId, teamName) => setViewingTeamCoverage({ teamId, teamName })}
                            parentId={null}
                            onRequestToJoin={(n) => setNodeJoinRequest(n)}
                            isUserMember={isUserMemberOfNode}
                            getNodeName={getNodeName}
                            collapsedNodes={collapsedNodes}
                            onToggleCollapsed={toggleNodeCollapsed}
                            searchHighlightIds={searchMatchIds.size > 0 ? searchMatchIds : typeFilterIds.size > 0 ? typeFilterIds : riskFilterIds.size > 0 ? riskFilterIds : undefined}
                            onFocusNode={setFocusedNodeId}
                            getGraphNode={(id) => orgGraph.nodes.get(id)}
                            showGovernanceSignals={orgPerms.canViewGovernance}
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

              {/* (Permissions view removed — merged into Access tab) */}

              {/* ── Coverage View ── */}
              {teamsViewMode === 'coverage' && (
                <div className="max-w-5xl mx-auto" data-no-pan>
                  <Card className="p-5">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-9 h-9 rounded-md bg-emerald-50 border border-emerald-200 flex items-center justify-center">
                        <Eye className="w-4 h-4 text-emerald-600" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900">Coverage Overview</h3>
                        <p className="text-xs text-gray-500">Asset coverage by team and portfolio</p>
                      </div>
                    </div>
                    <div className="border border-gray-200 rounded overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50/80 border-b border-gray-200">
                            <th className="px-4 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Team</th>
                            <th className="px-4 py-2 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Members</th>
                            <th className="px-4 py-2 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Portfolios</th>
                            <th className="px-4 py-2 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Assets</th>
                            <th className="px-4 py-2 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Analysts</th>
                            {orgPerms.canViewGovernance && <th className="px-4 py-2 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Health</th>}
                            {orgPerms.canViewGovernance && <th className="px-4 py-2 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Risks</th>}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {Array.from(orgGraph.nodes.values())
                            .filter(n => n.nodeType === 'team')
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map(teamNode => (
                              <tr
                                key={teamNode.id}
                                className="hover:bg-gray-50/50 cursor-pointer"
                                onClick={() => { setModalInitialPage('profile'); setModalNodeId(teamNode.id) }}
                                title="Click to view team details"
                              >
                                <td className="px-4 py-2.5">
                                  <div className="flex items-center gap-2">
                                    <div
                                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                      style={{ backgroundColor: teamNode.color }}
                                    />
                                    <div>
                                      <button
                                        onClick={() => {
                                          setViewingTeamCoverage({ teamId: teamNode.id, teamName: teamNode.name })
                                        }}
                                        className="text-sm font-medium text-gray-900 hover:text-indigo-600 hover:underline"
                                      >
                                        {teamNode.name}
                                      </button>
                                      {teamNode.isNonInvestment && (
                                        <span className="ml-1.5 text-[10px] text-gray-400 bg-gray-100 px-1 py-0.5 rounded">Non-Inv</span>
                                      )}
                                    </div>
                                  </div>
                                </td>
                                <td className="px-4 py-2.5 text-center text-sm text-gray-700">
                                  {teamNode.totalMemberCount || <span className="text-gray-300">&mdash;</span>}
                                </td>
                                <td className="px-4 py-2.5 text-center text-sm text-gray-700">
                                  {teamNode.portfolioCount || <span className="text-gray-300">&mdash;</span>}
                                </td>
                                <td className="px-4 py-2.5 text-center text-sm text-gray-700">
                                  {teamNode.coverageAssetCount || <span className="text-gray-300">&mdash;</span>}
                                </td>
                                <td className="px-4 py-2.5 text-center text-sm text-gray-700">
                                  {teamNode.coverageAnalystCount || <span className="text-gray-300">&mdash;</span>}
                                </td>
                                {orgPerms.canViewGovernance && (
                                <td className="px-4 py-2.5 text-center">
                                  <HealthPill score={teamNode.healthScore} />
                                </td>
                                )}
                                {orgPerms.canViewGovernance && (
                                <td className="px-4 py-2.5 text-center">
                                  {teamNode.riskFlags.length > 0 ? (
                                    <div className="flex items-center justify-center gap-1">
                                      {teamNode.riskFlags.map((flag, i) => (
                                        <RiskFlagBadge key={i} flag={flag} showLabel={false} />
                                      ))}
                                    </div>
                                  ) : (
                                    <Check className="w-4 h-4 text-green-500 mx-auto" />
                                  )}
                                </td>
                                )}
                              </tr>
                            ))}
                          {orgGraph.totalTeams === 0 && (
                            <tr>
                              <td colSpan={orgPerms.canViewGovernance ? 7 : 5} className="px-4 py-8 text-center text-sm text-gray-400">
                                No teams in the organization chart yet
                              </td>
                            </tr>
                          )}
                        </tbody>
                        {orgGraph.totalTeams > 0 && (
                          <tfoot>
                            <tr className="bg-gray-50 border-t border-gray-200">
                              <td className="px-4 py-2 text-xs font-medium text-gray-500">{orgGraph.totalTeams} team{orgGraph.totalTeams !== 1 ? 's' : ''}</td>
                              <td className="px-4 py-2 text-center text-xs font-medium text-gray-500">{orgGraph.totalMembers}</td>
                              <td className="px-4 py-2 text-center text-xs font-medium text-gray-500">{orgGraph.totalPortfolios}</td>
                              <td className="px-4 py-2 text-center text-xs font-medium text-gray-500" colSpan={2} />
                              {orgPerms.canViewGovernance && (
                              <td className="px-4 py-2 text-center">
                                <HealthPill score={orgGraph.overallHealth} showLabel />
                              </td>
                              )}
                              {orgPerms.canViewGovernance && (
                              <td className="px-4 py-2 text-center text-xs text-gray-500">
                                {orgGraph.totalRiskFlags > 0 ? `${orgGraph.totalRiskFlags} total` : 'None'}
                              </td>
                              )}
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  </Card>
                </div>
              )}
            </div>
          )}

          {/* Members Tab */}
          {activeTab === 'people' && (
            <OrgPeopleTab
              organization={organization}
              isOrgAdmin={isOrgAdmin}
              authorityRows={authorityRows}
              activeOrgAdminCount={authoritySummary.orgAdminCount}
              onUserClick={onUserClick}
              onSuspendUser={(member, reason) => suspendUserMutation.mutate({
                membershipId: member.id,
                reason,
              })}
              onAddContact={() => setShowAddContactModal(true)}
              contacts={contacts}
              onDeleteContact={(id) => deleteContactMutation.mutate(id)}
              onNavigateToGovernance={(userId) => {
                setActiveTab('access')
                setAccessSubTab('manage')
                setGovernanceFocusUserId(userId)
              }}
              onNavigateToGovernanceFlagged={(userId) => {
                setActiveTab('access')
                setAccessSubTab('manage')
                setGovernanceFocusUserId(userId)
                setGovernanceFocusFilter('flagged')
              }}
            />
          )}

          {/* Portfolios Tab */}
          {activeTab === 'portfolios' && (
            <div className="space-y-3">
              {/* Status filter pills */}
              {(portfolioStatusCounts.archived > 0 || portfolioStatusCounts.discarded > 0) && (
                <div className="flex items-center gap-2">
                  {(['active', 'archived', ...(isOrgAdmin && portfolioStatusCounts.discarded > 0 ? ['discarded'] as const : []), 'all'] as const).map((filter) => {
                    const count = portfolioStatusCounts[filter]
                    const isSelected = portfolioStatusFilter === filter
                    return (
                      <button
                        key={filter}
                        onClick={() => setPortfolioStatusFilter(filter)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                          isSelected
                            ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {filter === 'active' && 'Active'}
                        {filter === 'archived' && 'Archived'}
                        {filter === 'discarded' && 'Discarded'}
                        {filter === 'all' && 'All'}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                          isSelected ? 'bg-indigo-200/70 text-indigo-800' : 'bg-gray-200 text-gray-500'
                        }`}>
                          {count}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}

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
                  const pStatus = portfolio.status || (portfolio.archived_at ? 'archived' : 'active')
                  const isArchived = pStatus === 'archived'
                  const isDiscarded = pStatus === 'discarded'
                  const isInactive = isArchived || isDiscarded

                  // Group members by role
                  const membersByRole: { [role: string]: PortfolioTeamMember[] } = {}
                  teamMembers.forEach(m => {
                    if (!membersByRole[m.role]) membersByRole[m.role] = []
                    membersByRole[m.role].push(m)
                  })

                  return (
                    <Card key={portfolio.id} className={isInactive ? 'p-4 opacity-70 border-dashed' : 'p-4'}>
                      <div className="flex items-start justify-between">
                        <div className="flex items-start space-x-3 flex-1">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${isInactive ? 'bg-gray-200' : 'bg-green-100'}`}>
                            {isDiscarded
                              ? <Ban className="w-5 h-5 text-gray-400" />
                              : isArchived
                                ? <Archive className="w-5 h-5 text-gray-400" />
                                : <Briefcase className="w-5 h-5 text-green-600" />
                            }
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <h3 className={`font-medium ${isInactive ? 'text-gray-500' : 'text-gray-900'}`}>{portfolio.name}</h3>
                                {isDiscarded && (
                                  <span className="px-1.5 py-0.5 text-[10px] font-medium bg-red-100 text-red-700 rounded">
                                    Discarded
                                  </span>
                                )}
                                {isArchived && (
                                  <span className="px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700 rounded">
                                    Archived
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1">
                                {/* Add Member — blocked for non-active portfolios */}
                                {isOrgAdmin && !isInactive && (
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
                                {/* Lifecycle actions */}
                                {isOrgAdmin && (
                                  <>
                                    {isDiscarded ? (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => restorePortfolioMutation.mutate(portfolio.id)}
                                        title="Restore"
                                      >
                                        <RotateCcw className="w-3.5 h-3.5" />
                                      </Button>
                                    ) : (
                                      <>
                                        {isArchived ? (
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setPortfolioArchiveConfirm({ isOpen: true, portfolio, action: 'unarchive' })}
                                            title="Unarchive"
                                          >
                                            <ArchiveRestore className="w-3.5 h-3.5" />
                                          </Button>
                                        ) : (
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setPortfolioArchiveConfirm({ isOpen: true, portfolio, action: 'archive' })}
                                            title="Archive"
                                          >
                                            <Archive className="w-3.5 h-3.5" />
                                          </Button>
                                        )}
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => setPortfolioDiscardTarget({ id: portfolio.id, name: portfolio.name })}
                                          title="Discard"
                                          className="text-red-500 hover:text-red-700 hover:border-red-300"
                                        >
                                          <Ban className="w-3.5 h-3.5" />
                                        </Button>
                                      </>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                            {portfolio.description && (
                              <p className={`text-sm ${isInactive ? 'text-gray-400' : 'text-gray-500'}`}>{portfolio.description}</p>
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
                                          {isOrgAdmin && !isArchived && (
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

          {/* Access Requests Tab (Admin Only) — extracted component with provisioning */}
          {activeTab === 'requests' && <OrgRequestsTab isOrgAdmin={isOrgAdmin} organizationId={currentOrgId || undefined} />}

          {/* Access Hub (Manage Access + Access Report) */}
          {activeTab === 'access' && orgPerms.canViewAccessSection && (
            <div className="max-w-6xl mx-auto space-y-4">
              {/* Governance header + sub-tab switcher */}
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Governance</h2>
                  <p className="text-xs text-gray-500 mt-0.5">Manage roles, access scope, and governance risk</p>
                </div>
                <div className="inline-flex items-center bg-gray-100 rounded p-0.5">
                  {([
                    { key: 'manage' as AccessSubTab, label: 'Manage' },
                    { key: 'report' as AccessSubTab, label: 'Report' },
                  ]).map(v => (
                    <button
                      key={v.key}
                      onClick={() => setAccessSubTab(v.key)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                        accessSubTab === v.key
                          ? 'bg-white text-gray-900 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Manage sub-tab — Access & Roles */}
              {accessSubTab === 'manage' && (
                <OrgAuthorityMap
                  rows={authorityRows}
                  summary={authoritySummary}
                  orgPerms={orgPerms}
                  orgGraph={orgGraph}
                  orgMembers={orgMembers || []}
                  onToggleOrgAdmin={orgPerms.canManageOrgStructure ? (userId, newValue) => {
                    toggleOrgAdminMutation.mutate({ userId, isOrgAdmin: newValue })
                  } : undefined}
                  onToggleGlobalCoverageAdmin={orgPerms.canManageOrgStructure ? (userId, newValue) => {
                    toggleGlobalCoverageAdminMutation.mutate({ userId, isCoverageAdmin: newValue })
                  } : undefined}
                  onToggleNodeCoverageAdmin={orgPerms.canManageOrgStructure ? (memberId, newValue) => {
                    toggleNodeMemberCoverageAdminMutation.mutate({ memberId, isCoverageAdmin: newValue })
                  } : undefined}
                  isMutating={toggleOrgAdminMutation.isPending || toggleGlobalCoverageAdminMutation.isPending || toggleNodeMemberCoverageAdminMutation.isPending}
                  onOpenNodeModal={(nodeId) => {
                    setModalInitialPage('profile')
                    setModalNodeId(nodeId)
                  }}
                  initialTeamNodeId={initialAccessFilter?.teamNodeId}
                  focusUserId={governanceFocusUserId}
                  focusFilter={governanceFocusFilter}
                  onFocusUserHandled={() => { setGovernanceFocusUserId(null); setGovernanceFocusFilter(null) }}
                  invitedCount={pendingInviteCount}
                  suspendedCount={suspendedCount}
                />
              )}

              {/* Report sub-tab — read-only governance report with CSV export */}
              {accessSubTab === 'report' && (
                <OrgAccessTab
                  orgMembers={orgMembers}
                  teams={teams}
                  teamMemberships={teamMemberships}
                  portfolios={portfolios}
                  portfolioMemberships={portfolioMemberships}
                  authorityRows={authorityRows}
                />
              )}
            </div>
          )}

          {/* Activity Tab (Admin Only) */}
          {activeTab === 'activity' && organization && (
            <OrgActivityTab
              organizationId={organization.id}
              isOrgAdmin={isOrgAdmin}
              userNameMap={new Map(orgMembers.map(m => [m.user_id, m.user?.full_name || m.user?.email || 'Unknown']))}
            />
          )}

          {/* Settings Tab (Admin Only) */}
          {activeTab === 'settings' && isOrgAdmin && (
            <div className="space-y-6">

              {/* ── Identity & Access ── */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Shield className="w-3.5 h-3.5 text-gray-400" />
                  <h2 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Identity & Access</h2>
                </div>
                <div className="space-y-3">

              <Card className="p-4">
                <h3 className="text-sm font-medium text-gray-900 mb-2">Org Admins</h3>
                <div className="space-y-2">
                  {orgMembers.filter(m => m.is_org_admin).map(admin => (
                    <div key={admin.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center">
                          <Crown className="w-4 h-4 text-indigo-600" />
                        </div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="text-sm font-medium text-gray-900">{admin.user?.full_name}</span>
                            {onUserClick && admin.user_id && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onUserClick({ id: admin.user_id, full_name: admin.user?.full_name || 'Unknown' })
                                }}
                                className="p-0.5 text-gray-400 hover:text-indigo-600 transition-colors"
                                title="Open user profile"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                          <p className="text-xs text-gray-500">{admin.user?.email}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Verified Domains */}
              {organization?.id && (
                <OrgDomainsSection organizationId={organization.id} />
              )}

              {/* Onboarding Policy */}
              {isOrgAdmin && organization && (
                <Card className="p-4">
                  <div className="mb-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-medium text-gray-900">Onboarding Policy</h3>
                      {(() => {
                        const policy = organization.onboarding_policy || 'invite_only'
                        const pillConfig = policy === 'open'
                          ? { label: 'Open — Auto-Join Enabled', className: 'bg-amber-100 text-amber-700' }
                          : policy === 'approval_required'
                            ? { label: 'Approval Required', className: 'bg-blue-100 text-blue-700' }
                            : { label: 'Invite Only', className: 'bg-gray-100 text-gray-600' }
                        return (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${pillConfig.className}`}>
                            {pillConfig.label}
                          </span>
                        )
                      })()}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Control how users with a matching email domain can join your organization
                    </p>
                    {organization.updated_at && (
                      <p className="text-[10px] text-gray-400 mt-1">Updated {formatTimeAgo(organization.updated_at)}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    {([
                      { value: 'invite_only' as const, label: 'Invite Only', icon: Lock, desc: 'Users can only join via direct invitation from an admin.' },
                      { value: 'approval_required' as const, label: 'Approval Required', icon: Clock, desc: 'Users with a matching email domain can request to join. An admin must approve.' },
                      { value: 'open' as const, label: 'Open (Domain Auto-Join)', icon: Unlock, desc: 'Users with a matching verified email domain are automatically added.' },
                    ] as const).map(opt => {
                      const isActive = (organization.onboarding_policy || 'invite_only') === opt.value
                      const Icon = opt.icon
                      return (
                        <label
                          key={opt.value}
                          className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                            isActive
                              ? 'border-indigo-300 bg-indigo-50/50'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <input
                            type="radio"
                            name="onboarding-policy"
                            value={opt.value}
                            checked={isActive}
                            onChange={() => updateOnboardingPolicyMutation.mutate(opt.value)}
                            disabled={updateOnboardingPolicyMutation.isPending || !canWrite}
                            className="mt-1 text-indigo-600 focus:ring-indigo-500"
                          />
                          <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${isActive ? 'text-indigo-600' : 'text-gray-400'}`} />
                          <div className="min-w-0">
                            <div className={`text-sm font-medium ${isActive ? 'text-indigo-900' : 'text-gray-900'}`}>
                              {opt.label}
                            </div>
                            <div className="text-xs text-gray-500 mt-0.5">{opt.desc}</div>
                          </div>
                        </label>
                      )
                    })}
                  </div>

                  {/* Warning: Open policy with zero verified domains */}
                  {(organization.onboarding_policy || 'invite_only') === 'open' && verifiedDomainCount === 0 && (
                    <div className="flex items-start gap-2 mt-3 p-2.5 rounded-lg bg-amber-50 border border-amber-200">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-amber-800">
                        <strong>No verified domains.</strong> Add a verified domain to enable auto-join. Users won't be auto-routed until a domain is verified.
                      </p>
                    </div>
                  )}
                </Card>
              )}

              {/* SSO / Identity Provider */}
              {isOrgAdmin && organization?.id && (
                <OrgIdentityProviderSection organizationId={organization.id} verifiedDomainCount={verifiedDomainCount} />
              )}

                </div>
              </div>

              {/* ── Governance & Compliance ── */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <FileText className="w-3.5 h-3.5 text-gray-400" />
                  <h2 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Governance & Compliance</h2>
                </div>
                <div className="space-y-3">

              {/* Branding & Compliance */}
              <Card className={`p-4 transition-colors ${!isBrandingLocked ? 'ring-1 ring-indigo-200 bg-indigo-50/20' : ''}`}>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium text-gray-900">Branding & Compliance</h3>
                      {isBrandingLocked ? (
                        <span className="text-[10px] font-medium text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">Read-Only</span>
                      ) : (
                        <span className="text-[10px] font-medium text-indigo-600 bg-indigo-100 px-1.5 py-0.5 rounded">Editing</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Organization identity, logo, and default disclaimer for reports</p>
                    {organization?.updated_at && (
                      <p className="text-[10px] text-gray-400 mt-0.5">Updated {formatTimeAgo(organization.updated_at)}</p>
                    )}
                  </div>
                  {isBrandingLocked && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setIsBrandingLocked(false)}
                      className="flex items-center gap-2"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      Enable Editing
                    </Button>
                  )}
                </div>

                {editingBranding && (
                  <div className="space-y-4">
                    {/* Organization Name */}
                    <div className={isBrandingLocked ? 'opacity-60' : ''}>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Organization Name
                      </label>
                      <input
                        type="text"
                        value={editingBranding.org_name}
                        disabled={isBrandingLocked}
                        onChange={(e) => setEditingBranding({ ...editingBranding, org_name: e.target.value })}
                        placeholder="Organization name"
                        className={`w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${isBrandingLocked ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                      />
                    </div>

                    {/* Description */}
                    <div className={isBrandingLocked ? 'opacity-60' : ''}>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Description
                      </label>
                      <textarea
                        value={editingBranding.org_description}
                        disabled={isBrandingLocked}
                        onChange={(e) => setEditingBranding({ ...editingBranding, org_description: e.target.value })}
                        rows={2}
                        placeholder="Describe your organization"
                        className={`w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${isBrandingLocked ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                      />
                    </div>

                    {/* Logo */}
                    <div className={isBrandingLocked ? 'opacity-60' : ''}>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Organization Logo
                      </label>
                      <p className="text-xs text-gray-500 mb-2">
                        Used on investment case reports and shared documents when &ldquo;Use org branding&rdquo; is enabled
                      </p>
                      <div className="flex items-start gap-4">
                        <div className="w-24 h-16 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0">
                          {brandingLogoPreview ? (
                            <img
                              src={brandingLogoPreview}
                              alt="Org logo"
                              className="max-w-full max-h-full object-contain"
                            />
                          ) : (
                            <Image className="w-6 h-6 text-gray-300" />
                          )}
                        </div>
                        {!isBrandingLocked && (
                          <div className="flex flex-col gap-2">
                            <input
                              ref={brandingLogoInputRef}
                              type="file"
                              accept="image/png,image/jpeg,image/svg+xml"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0]
                                if (file) {
                                  setBrandingLogoFile(file)
                                  setBrandingLogoPreview(URL.createObjectURL(file))
                                }
                                e.target.value = ''
                              }}
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => brandingLogoInputRef.current?.click()}
                              className="flex items-center gap-2"
                            >
                              <Upload className="h-3.5 w-3.5" />
                              {brandingLogoPreview ? 'Replace' : 'Upload'}
                            </Button>
                            {brandingLogoPreview && (
                              <button
                                type="button"
                                onClick={() => {
                                  setBrandingLogoFile(null)
                                  setBrandingLogoPreview(null)
                                }}
                                className="text-xs text-red-600 hover:text-red-700"
                              >
                                Remove logo
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Firm Name */}
                    <div className={isBrandingLocked ? 'opacity-60' : ''}>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Firm Name
                      </label>
                      <p className="text-xs text-gray-500 mb-1">
                        Displayed on report covers and headers
                      </p>
                      <input
                        type="text"
                        value={editingBranding.firm_name}
                        disabled={isBrandingLocked}
                        onChange={(e) => setEditingBranding({ ...editingBranding, firm_name: e.target.value })}
                        placeholder="e.g. Acme Capital"
                        className={`w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${isBrandingLocked ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                      />
                    </div>

                    {/* Tagline */}
                    <div className={isBrandingLocked ? 'opacity-60' : ''}>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Tagline
                      </label>
                      <input
                        type="text"
                        value={editingBranding.tagline}
                        disabled={isBrandingLocked}
                        onChange={(e) => setEditingBranding({ ...editingBranding, tagline: e.target.value })}
                        placeholder="e.g. Investing in tomorrow"
                        className={`w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${isBrandingLocked ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                      />
                    </div>

                    {/* Default Disclaimer */}
                    <div className={isBrandingLocked ? 'opacity-60' : ''}>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Default Disclaimer
                      </label>
                      <p className="text-xs text-gray-500 mb-1">
                        Used as the default on investment case reports when &ldquo;Use org default disclaimer&rdquo; is enabled
                      </p>
                      <textarea
                        value={editingBranding.default_disclaimer}
                        disabled={isBrandingLocked}
                        onChange={(e) => setEditingBranding({ ...editingBranding, default_disclaimer: e.target.value })}
                        rows={3}
                        placeholder="This document is for informational purposes only and does not constitute investment advice..."
                        className={`w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${isBrandingLocked ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                      />
                    </div>

                    {/* Footer: Save / Cancel (editing mode only) */}
                    {!isBrandingLocked && (
                      <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-200">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const branding = organization?.settings?.branding || {}
                            setEditingBranding({
                              org_name: organization?.name || '',
                              org_description: organization?.description || '',
                              firm_name: branding.firm_name || '',
                              tagline: branding.tagline || '',
                              default_disclaimer: branding.default_disclaimer || '',
                            })
                            setBrandingLogoFile(null)
                            if (organization?.logo_url) {
                              supabase.storage.from('template-branding')
                                .createSignedUrl(organization.logo_url, 3600)
                                .then(({ data }) => {
                                  if (data?.signedUrl) setBrandingLogoPreview(data.signedUrl)
                                })
                            } else {
                              setBrandingLogoPreview(null)
                            }
                            setIsBrandingLocked(true)
                          }}
                          className="flex items-center gap-1.5"
                        >
                          <X className="h-3.5 w-3.5" />
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            if (!editingBranding) return
                            saveBrandingMutation.mutate({
                              ...editingBranding,
                              logoFile: brandingLogoFile,
                              removeLogo: !brandingLogoPreview && !!organization?.logo_url,
                            })
                          }}
                          disabled={!editingBranding?.org_name?.trim()}
                          loading={saveBrandingMutation.isPending}
                        >
                          Save Changes
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </Card>

              {/* Data Governance */}
              {isOrgAdmin && organization?.id && (
                <OrgGovernanceSection organizationId={organization.id} />
              )}

                </div>
              </div>

              {/* ── Operations ── */}
              {user?.coverage_admin && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Users className="w-3.5 h-3.5 text-gray-400" />
                  <h2 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Operations</h2>
                </div>
                <div className="space-y-3">

              {/* Coverage Settings - Only for coverage admins */}
                <Card className={`p-4 transition-colors ${!isCoverageSettingsLocked ? 'ring-1 ring-indigo-200 bg-indigo-50/20' : ''}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-medium text-gray-900">Coverage Settings</h3>
                        {isCoverageSettingsLocked ? (
                          <span className="text-[10px] font-medium text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">Read-Only</span>
                        ) : (
                          <span className="text-[10px] font-medium text-indigo-600 bg-indigo-100 px-1.5 py-0.5 rounded">Editing</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Configure how coverage works across your organization</p>
                      {coverageSettings?.updated_at && (
                        <p className="text-[10px] text-gray-400 mt-0.5">Updated {formatTimeAgo(coverageSettings.updated_at)}</p>
                      )}
                    </div>
                    {editingCoverageSettings && isCoverageSettingsLocked && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setIsCoverageSettingsLocked(false)}
                        className="flex items-center gap-2"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        Enable Editing
                      </Button>
                    )}
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

                      {/* Footer: Save / Cancel (editing mode only) */}
                      {!isCoverageSettingsLocked && (
                        <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-200">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
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
                            className="flex items-center gap-1.5"
                          >
                            <X className="h-3.5 w-3.5" />
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => setShowCoverageSettingsConfirm(true)}
                            loading={saveCoverageSettingsMutation.isPending}
                          >
                            Save Changes
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {!editingCoverageSettings && (
                    <div className="text-center py-4 text-gray-500">
                      Loading coverage settings...
                    </div>
                  )}
                </Card>

                </div>
              </div>
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
            // For team-type nodes, check if there are linked portfolios
            const linked = isTeamLikeNode(showAddNodeMemberModal)
              ? getLinkedPortfoliosForTeamNode(showAddNodeMemberModal.id)
              : []

            if (linked.length > 0) {
              // Show portfolio role assignment modal
              const member = orgMembers.find(m => m.user_id === userId)
              setPendingTeamMemberAdd({
                nodeId: showAddNodeMemberModal.id,
                nodeName: showAddNodeMemberModal.name,
                userId,
                userName: member?.user?.full_name || member?.user?.email || 'Unknown',
                role,
                focus,
                isCoverageAdmin,
                linkedPortfolios: linked,
              })
              setShowAddNodeMemberModal(null)
            } else {
              // No linked portfolios — add directly
              addNodeMemberMutation.mutate({
                node_id: showAddNodeMemberModal.id,
                user_id: userId,
                role,
                focus,
                is_coverage_admin: isCoverageAdmin,
              }, {
                onSuccess: () => setShowAddNodeMemberModal(null)
              })
            }
          }}
          isLoading={addNodeMemberMutation.isPending}
        />
      )}

      {/* Portfolio Role Assignment Modal (team member add flow) */}
      {pendingTeamMemberAdd && (
        <AssignPortfolioRolesModal
          teamName={pendingTeamMemberAdd.nodeName}
          userName={pendingTeamMemberAdd.userName}
          linkedPortfolios={pendingTeamMemberAdd.linkedPortfolios}
          onConfirm={(assignments) => {
            addTeamMemberWithPortfoliosMutation.mutate({
              nodeId: pendingTeamMemberAdd.nodeId,
              userId: pendingTeamMemberAdd.userId,
              role: pendingTeamMemberAdd.role,
              focus: pendingTeamMemberAdd.focus,
              isCoverageAdmin: pendingTeamMemberAdd.isCoverageAdmin,
              portfolioAssignments: assignments,
            })
          }}
          onCancel={() => setPendingTeamMemberAdd(null)}
          isLoading={addTeamMemberWithPortfoliosMutation.isPending}
        />
      )}

      {/* Team Removal Confirmation Modal */}
      {teamRemovalConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4">
            <div className="p-6 border-b border-gray-100">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900">Remove from {teamRemovalConfirm.teamNodeName}</h3>
              </div>
            </div>
            <div className="p-6 space-y-3">
              <p className="text-sm text-gray-600">
                Removing <strong>{teamRemovalConfirm.memberName}</strong> from this team
                {teamRemovalConfirm.affectedPortfolios.length > 0 ? ' will also remove access to:' : '.'}
              </p>
              {teamRemovalConfirm.affectedPortfolios.length > 0 && (
                <ul className="space-y-1 ml-4">
                  {teamRemovalConfirm.affectedPortfolios.map((name) => (
                    <li key={name} className="flex items-center gap-2 text-sm text-gray-700">
                      <Briefcase className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                      {name}
                    </li>
                  ))}
                </ul>
              )}
              {teamRemovalConfirm.affectedPortfolios.length > 0 && (
                <p className="text-xs text-gray-500 mt-2">
                  Access to other portfolios will remain unchanged.
                </p>
              )}
            </div>
            <div className="p-6 pt-0 flex justify-end space-x-3">
              <Button
                variant="outline"
                onClick={() => setTeamRemovalConfirm(null)}
                disabled={removeTeamMemberWithCascadeMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  removeTeamMemberWithCascadeMutation.mutate({
                    memberId: teamRemovalConfirm.memberId,
                    userId: teamRemovalConfirm.userId,
                    teamNodeId: teamRemovalConfirm.teamNodeId,
                  })
                }}
                loading={removeTeamMemberWithCascadeMutation.isPending}
              >
                Remove
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Node Detail Modal — replaced by ManageNodeDrawer.
         NodeDetailModal component retained in codebase but no longer rendered from here. */}

      {/* Node Inspector Modal */}
      {modalNodeId && orgGraph.nodes.has(modalNodeId) && (() => {
        const graphNode = orgGraph.nodes.get(modalNodeId)!
        const modalBreadcrumb = graphNode.path
          .map(id => orgGraph.nodes.get(id))
          .filter((n): n is OrgGraphNode => !!n)
          .map(n => ({ id: n.id, name: n.name }))
        const raw = orgChartNodes.find(n => n.id === modalNodeId)

        // Collect members for the modal: direct members + portfolio descendants' + linked portfolios' members (deduped by membership id)
        const modalMembers = (() => {
          const direct = getNodeMembers(modalNodeId)
          if (graphNode.nodeType === 'portfolio') return direct

          const seen = new Set(direct.map(m => m.id))
          const result = [...direct]

          const addPortfolioMembers = (portfolioNodeId: string) => {
            for (const m of getNodeMembers(portfolioNodeId)) {
              if (!seen.has(m.id)) {
                seen.add(m.id)
                result.push(m)
              }
            }
          }

          // Recurse children and also follow linked portfolios at each level
          const collectFromSubtree = (nodeId: string) => {
            const gn = orgGraph.nodes.get(nodeId)
            if (!gn) return
            // Linked portfolios (not in childIds)
            for (const linkedId of gn.linkedNodeIds) {
              const linked = orgGraph.nodes.get(linkedId)
              if (linked?.nodeType === 'portfolio') addPortfolioMembers(linkedId)
            }
            // Child nodes
            for (const childId of gn.childIds) {
              const child = orgGraph.nodes.get(childId)
              if (!child) continue
              if (child.nodeType === 'portfolio') addPortfolioMembers(childId)
              collectFromSubtree(childId)
            }
          }
          collectFromSubtree(modalNodeId)
          return result
        })()

        return (
          <OrgNodeDetailsModal
            node={graphNode}
            members={modalMembers}
            breadcrumb={modalBreadcrumb}
            onClose={() => setModalNodeId(null)}
            onNavigateNode={(id) => setModalNodeId(id)}
            canManageOrgStructure={orgPerms.canManageOrgStructure}
            showGovernanceSignals={orgPerms.canViewGovernance}
            initialPage={modalInitialPage}
            availableUsers={orgMembers}
            availablePortfolios={portfolios.map(p => ({ id: p.id, portfolio_id: p.portfolio_id, name: p.name }))}
            onSaveNode={(data) => updateNodeMutation.mutate(data)}
            onAddMember={(nodeId, userId, role, focus) => {
              if (raw?.node_type === 'portfolio' && raw.settings?.portfolio_id) {
                if (!role) { alert('A role is required for portfolio members.'); return }
                addPortfolioTeamMemberMutation.mutate({ portfolioId: raw.settings.portfolio_id, userId, role, focus })
              } else {
                // Check for linked portfolios on team-type nodes
                const linked = raw && isTeamLikeNode(raw)
                  ? getLinkedPortfoliosForTeamNode(nodeId)
                  : []

                if (linked.length > 0) {
                  const member = orgMembers.find(m => m.user_id === userId)
                  setPendingTeamMemberAdd({
                    nodeId,
                    nodeName: raw?.name || graphNode.name,
                    userId,
                    userName: member?.user?.full_name || member?.user?.email || 'Unknown',
                    role: role || '',
                    focus,
                    isCoverageAdmin: false,
                    linkedPortfolios: linked,
                  })
                  setModalNodeId(null)
                } else {
                  addNodeMemberMutation.mutate({ node_id: nodeId, user_id: userId, role: role || '', focus })
                }
              }
            }}
            onRemoveMember={(memberId) => {
              if (raw?.node_type === 'portfolio') {
                deletePortfolioTeamMemberMutation.mutate(memberId)
              } else {
                // For team nodes, use cascade removal
                const member = unifiedNodeMembers.find(m => m.id === memberId)
                if (member) {
                  const affected = getAffectedPortfoliosForRemoval(member.user_id, member.node_id)
                  const memberName = member.user?.full_name || member.user?.email || 'Unknown'
                  const nodeName = orgChartNodes.find(n => n.id === member.node_id)?.name || 'this team'

                  if (affected.length > 0) {
                    setTeamRemovalConfirm({
                      isOpen: true,
                      memberId,
                      memberName,
                      teamNodeId: member.node_id,
                      teamNodeName: nodeName,
                      userId: member.user_id,
                      affectedPortfolios: affected,
                    })
                    setModalNodeId(null)
                  } else {
                    if (window.confirm(`Remove ${memberName} from ${nodeName}?`)) {
                      removeNodeMemberMutation.mutate({ memberId, nodeId: member.node_id, userId: member.user_id, nodeName })
                    }
                  }
                } else {
                  removeNodeMemberMutation.mutate({ memberId })
                }
              }
            }}
            onUpdateMember={(memberId, role, focus) => {
              const member = unifiedNodeMembers.find(m => m.id === memberId)
              if (member && (member as any)._source === 'org_chart') {
                updateNodeMemberMutation.mutate({ memberId, role, focus, nodeId: member.node_id, userId: member.user_id, oldRole: member.role })
              } else {
                updatePortfolioTeamMemberMutation.mutate({ memberId, role, focus })
              }
            }}
            onToggleCoverageAdmin={(memberId, isCoverageAdmin) => {
              toggleNodeMemberCoverageAdminMutation.mutate({ memberId, isCoverageAdmin })
            }}
            onToggleCoverageAdminBlocked={(memberId, isBlocked) => {
              toggleNodeMemberCoverageAdminBlockedMutation.mutate({ memberId, isBlocked })
            }}
            canManageCoverageAdmins={canManageCoverageAdminsForNode(modalNodeId)}
            allOrgChartNodes={orgChartNodes}
            allNodeMembers={unifiedNodeMembers}
            globalCoverageAdminUserIds={globalCoverageAdminUserIds}
            isSaving={updateNodeMutation.isPending}
          />
        )
      })()}

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
              {(() => {
                const childCount = orgChartNodes.filter(n => n.parent_id === deleteNodeConfirm.node!.id).length
                return childCount > 0 ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                    <p className="text-sm text-amber-800">
                      <span className="font-medium">Note:</span> This {deleteNodeConfirm.node.node_type} has {childCount} child node{childCount !== 1 ? 's' : ''}.
                      They will be moved up to the parent level and will not be deleted.
                    </p>
                  </div>
                ) : null
              })()}
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

      {/* Portfolio Archive / Unarchive Confirmation */}
      <ConfirmDialog
        isOpen={portfolioArchiveConfirm.isOpen}
        onClose={() => setPortfolioArchiveConfirm({ isOpen: false, portfolio: null, action: 'archive' })}
        onConfirm={() => {
          if (portfolioArchiveConfirm.portfolio) {
            archivePortfolioMutation.mutate({
              portfolioId: portfolioArchiveConfirm.portfolio.id,
              action: portfolioArchiveConfirm.action,
            })
          }
        }}
        title={portfolioArchiveConfirm.action === 'archive' ? 'Archive Portfolio' : 'Unarchive Portfolio'}
        message={
          portfolioArchiveConfirm.action === 'archive'
            ? `"${portfolioArchiveConfirm.portfolio?.name}" will be hidden from active views and become read-only. You can unarchive it later.`
            : `"${portfolioArchiveConfirm.portfolio?.name}" will be restored to active status.`
        }
        confirmText={portfolioArchiveConfirm.action === 'archive' ? 'Archive' : 'Unarchive'}
        variant={portfolioArchiveConfirm.action === 'archive' ? 'warning' : 'info'}
        isLoading={archivePortfolioMutation.isPending}
      />

      {/* Portfolio Discard Modal */}
      <DiscardPortfolioModal
        isOpen={!!portfolioDiscardTarget}
        onClose={() => setPortfolioDiscardTarget(null)}
        portfolio={portfolioDiscardTarget}
        organizationId={organization?.id}
        onArchiveInstead={portfolioDiscardTarget ? () => {
          const p = portfolios.find(pp => pp.id === portfolioDiscardTarget.id)
          if (p) setPortfolioArchiveConfirm({ isOpen: true, portfolio: p, action: 'archive' })
        } : undefined}
      />
    </div>
  )
}

interface OrganizationPageProps {
  onUserClick?: (user: { id: string; full_name: string }) => void
  initialTab?: TabType
  initialAccessSubTab?: 'manage' | 'report'
  initialAccessFilter?: { teamNodeId?: string }
}

// Main exported component - handles loading state
export function OrganizationPage({ onUserClick, initialTab, initialAccessSubTab, initialAccessFilter }: OrganizationPageProps = {}) {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()

  // Single query to determine admin status for the current org
  const { data: adminStatus, isLoading } = useQuery({
    queryKey: ['org-admin-status', user?.id, currentOrgId],
    queryFn: async () => {
      if (!user?.id || !currentOrgId) return { isAdmin: false }

      const { data, error } = await supabase
        .from('organization_memberships')
        .select('is_org_admin')
        .eq('user_id', user.id)
        .eq('organization_id', currentOrgId)
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
  return <OrganizationContent
    isOrgAdmin={adminStatus.isAdmin}
    onUserClick={onUserClick}
    initialTab={initialTab}
    initialAccessSubTab={initialAccessSubTab}
    initialAccessFilter={initialAccessFilter}
  />
}

// Sub-components

// OrgChartNodeCard — extracted to src/components/organization/OrgChartNodeCard.tsx
// (kept as comment for navigation reference)

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
        .from('org_org_chart_nodes_v')
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

/** Team-like nodes auto-assign "Member" role and skip the role selector — portfolio roles are set in AssignPortfolioRolesModal. */
function isTeamLikeNode(node: OrgChartNode): boolean {
  return node.node_type === 'team' || node.node_type === 'division' || node.node_type === 'department'
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
  const teamLike = isTeamLikeNode(node)
  const [role, setRole] = useState(teamLike ? 'Member' : '')
  const [teamFunction, setTeamFunction] = useState('')
  const [focus, setFocus] = useState('')
  const [isCoverageAdmin, setIsCoverageAdmin] = useState(false)

  const roleOptions = ROLE_OPTIONS.map(r => ({ value: r, label: r }))

  const focusOptions = [
    { value: '', label: 'No Focus (Optional)' },
    ...getFocusOptionsForRole(role).map(f => ({ value: f, label: f })),
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

          {teamLike ? (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Team Role *</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                >
                  {TEAM_ROLE_OPTIONS.map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Function</label>
                <select
                  value={teamFunction}
                  onChange={(e) => setTeamFunction(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">None (optional)</option>
                  {TEAM_FUNCTION_OPTIONS.map(f => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role *</label>
                <select
                  value={role}
                  onChange={(e) => {
                    setRole(e.target.value)
                    setFocus('')
                  }}
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
            </>
          )}

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
            onClick={() => onSave(selectedUserId, role, (teamLike ? teamFunction : focus) || undefined, isCoverageAdmin)}
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
  const isTeamLike = isTeamLikeNode(node)

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
                {isTeamLike ? (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Team Role</label>
                      <select
                        value={memberRole}
                        onChange={(e) => setMemberRole(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      >
                        {TEAM_ROLE_OPTIONS.map(r => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Function</label>
                      <select
                        value={memberFocus}
                        onChange={(e) => setMemberFocus(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      >
                        <option value="">None (optional)</option>
                        {TEAM_FUNCTION_OPTIONS.map(f => (
                          <option key={f} value={f}>{f}</option>
                        ))}
                      </select>
                    </div>
                  </>
                ) : isPortfolioNode ? (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Role (optional)</label>
                      <select
                        value={memberRole}
                        onChange={(e) => {
                          setMemberRole(e.target.value)
                          setMemberFocus('')
                        }}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      >
                        <option value="">Select role...</option>
                        {ROLE_OPTIONS.map(r => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </div>
                    {memberRole && getFocusOptionsForRole(memberRole).length > 0 && (
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-2">Focus (select multiple)</label>
                        <div className="flex flex-wrap gap-1.5">
                          {getFocusOptionsForRole(memberRole).map(focus => {
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
                    )}
                  </>
                ) : null}
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
                  if (isEditingThisMember && isEditing && (isPortfolioNode || isTeamLike)) {
                    const roleFocusOptions = getFocusOptionsForRole(editMemberRole)
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

                        {isTeamLike ? (
                          <>
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">Team Role</label>
                              <select
                                value={editMemberRole}
                                onChange={(e) => {
                                  const newRole = e.target.value
                                  setEditMemberRole(newRole)
                                  onUpdateMember(member.id, newRole, editMemberFocus || null)
                                }}
                                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                              >
                                {TEAM_ROLE_OPTIONS.map(r => (
                                  <option key={r} value={r}>{r}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">Function</label>
                              <select
                                value={editMemberFocus}
                                onChange={(e) => {
                                  const newFunc = e.target.value
                                  setEditMemberFocus(newFunc)
                                  onUpdateMember(member.id, editMemberRole, newFunc || null)
                                }}
                                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                              >
                                <option value="">None</option>
                                {TEAM_FUNCTION_OPTIONS.map(f => (
                                  <option key={f} value={f}>{f}</option>
                                ))}
                              </select>
                            </div>
                          </>
                        ) : (
                          <>
                            {/* Role dropdown - auto-saves */}
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
                              <select
                                value={editMemberRole}
                                onChange={(e) => {
                                  const newRole = e.target.value
                                  setEditMemberRole(newRole)
                                  setEditMemberFocus('')
                                  // Auto-save on role change (clear focus since options differ per role)
                                  onUpdateMember(member.id, newRole, null)
                                }}
                                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                              >
                                <option value="">Select role...</option>
                                {ROLE_OPTIONS.map(r => (
                                  <option key={r} value={r}>{r}</option>
                                ))}
                              </select>
                            </div>

                            {/* Focus multi-select pills - auto-saves */}
                            {roleFocusOptions.length > 0 && (
                              <div>
                                <label className="block text-xs font-medium text-gray-600 mb-2">Focus (select multiple)</label>
                                <div className="flex flex-wrap gap-1.5">
                                  {roleFocusOptions.map(focus => (
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
                            )}
                          </>
                        )}
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
                          {(isPortfolioNode || isTeamLike) && member.role && <p className="text-xs text-gray-500">{member.role}{member.focus ? ` · ${member.focus}` : ''}</p>}
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        {isPortfolioNode && !isTeamLike && member.focus && (
                          <div className="flex flex-wrap gap-1">
                            {member.focus.split(', ').map((f, idx) => (
                              <span key={idx} className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded">{f}</span>
                            ))}
                          </div>
                        )}
                        {isEditing && isAdmin && (isPortfolioNode || isTeamLike) && (
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
