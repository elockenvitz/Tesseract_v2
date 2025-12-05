/**
 * OrganizationModal Component
 *
 * Modal for viewing and managing organization structure including:
 * - Teams and their members
 * - People across the organization
 * - Portfolios within teams
 * - Access requests (admin only)
 *
 * Non-admins can view but not edit. They can submit access requests.
 */

import React, { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import {
  X,
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
  Shield,
  ShieldCheck,
  Crown,
  Search,
  MoreVertical,
  UserPlus,
  Mail,
  Check,
  XCircle,
  Clock,
  FolderOpen
} from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'

interface OrganizationModalProps {
  isOpen: boolean
  onClose: () => void
}

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

type TabType = 'teams' | 'people' | 'portfolios' | 'requests' | 'settings'

export function OrganizationModal({ isOpen, onClose }: OrganizationModalProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<TabType>('teams')
  const [searchTerm, setSearchTerm] = useState('')
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set())
  const [showAddTeamModal, setShowAddTeamModal] = useState(false)
  const [showAddMemberModal, setShowAddMemberModal] = useState(false)
  const [showRequestModal, setShowRequestModal] = useState(false)
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null)
  const [editingTeam, setEditingTeam] = useState<Team | null>(null)

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
    },
    enabled: isOpen
  })

  // Check if current user is org admin
  const { data: currentUserMembership } = useQuery({
    queryKey: ['current-user-membership', user?.id],
    queryFn: async () => {
      if (!user?.id) return null
      const { data, error } = await supabase
        .from('organization_memberships')
        .select('*')
        .eq('user_id', user.id)
        .limit(1)
        .single()

      if (error && error.code !== 'PGRST116') throw error
      return data as OrganizationMembership | null
    },
    enabled: isOpen && !!user?.id
  })

  const isOrgAdmin = currentUserMembership?.is_org_admin ?? false

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
    },
    enabled: isOpen
  })

  // Fetch all organization members with user profiles
  const { data: orgMembers = [] } = useQuery({
    queryKey: ['organization-members'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_memberships')
        .select(`
          *,
          user:user_id (
            id,
            email,
            raw_user_meta_data
          )
        `)
        .eq('status', 'active')

      if (error) throw error
      return data.map((m: any) => ({
        ...m,
        user: {
          id: m.user?.id,
          email: m.user?.email,
          full_name: m.user?.raw_user_meta_data?.full_name || m.user?.email?.split('@')[0],
          avatar_url: m.user?.raw_user_meta_data?.avatar_url
        }
      })) as OrganizationMembership[]
    },
    enabled: isOpen
  })

  // Fetch team memberships
  const { data: teamMemberships = [] } = useQuery({
    queryKey: ['team-memberships'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_memberships')
        .select(`
          *,
          user:user_id (
            id,
            email,
            raw_user_meta_data
          ),
          team:team_id (*)
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
      })) as TeamMembership[]
    },
    enabled: isOpen
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
    },
    enabled: isOpen
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
    },
    enabled: isOpen
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
    enabled: isOpen && isOrgAdmin
  })

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      setShowAddTeamModal(false)
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

  if (!isOpen) return null

  const tabs: { id: TabType; label: string; icon: React.ReactNode; adminOnly?: boolean }[] = [
    { id: 'teams', label: 'Teams', icon: <Users className="w-4 h-4" /> },
    { id: 'people', label: 'People', icon: <UserCircle className="w-4 h-4" /> },
    { id: 'portfolios', label: 'Portfolios', icon: <Briefcase className="w-4 h-4" /> },
    { id: 'requests', label: 'Requests', icon: <Bell className="w-4 h-4" />, adminOnly: true },
    { id: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4" />, adminOnly: true }
  ]

  const visibleTabs = tabs.filter(t => !t.adminOnly || isOrgAdmin)

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center">
              <Building2 className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {organization?.name || 'Organization'}
              </h2>
              <p className="text-sm text-gray-500">
                {orgMembers.length} members · {teams.length} teams · {portfolios.length} portfolios
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {!isOrgAdmin && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowRequestModal(true)}
              >
                <Mail className="w-4 h-4 mr-1" />
                Request Access
              </Button>
            )}
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors p-2"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 px-4 flex-shrink-0">
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
        {['teams', 'people', 'portfolios'].includes(activeTab) && (
          <div className="p-4 border-b border-gray-100 flex-shrink-0">
            <div className="relative">
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
        <div className="flex-1 overflow-y-auto p-4">
          {/* Teams Tab */}
          {activeTab === 'teams' && (
            <div className="space-y-3">
              {isOrgAdmin && (
                <div className="flex justify-end mb-4">
                  <Button size="sm" onClick={() => setShowAddTeamModal(true)}>
                    <Plus className="w-4 h-4 mr-1" />
                    Add Team
                  </Button>
                </div>
              )}

              {filteredTeams.length === 0 ? (
                <div className="text-center py-12">
                  <Users className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No teams yet</h3>
                  <p className="text-sm text-gray-500">
                    {isOrgAdmin ? 'Create your first team to get started' : 'No teams have been created yet'}
                  </p>
                </div>
              ) : (
                filteredTeams.map(team => {
                  const members = getTeamMembers(team.id)
                  const teamPortfolios = getTeamPortfolios(team.id)
                  const isExpanded = expandedTeams.has(team.id)

                  return (
                    <Card key={team.id} className="overflow-hidden">
                      <div
                        className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                        onClick={() => toggleTeamExpanded(team.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            {isExpanded ? (
                              <ChevronDown className="w-5 h-5 text-gray-400" />
                            ) : (
                              <ChevronRight className="w-5 h-5 text-gray-400" />
                            )}
                            <div
                              className="w-8 h-8 rounded-lg flex items-center justify-center"
                              style={{ backgroundColor: `var(--${team.color}, #6366f1)20` }}
                            >
                              <Users className="w-4 h-4" style={{ color: `var(--${team.color}, #6366f1)` }} />
                            </div>
                            <div>
                              <h3 className="font-medium text-gray-900">{team.name}</h3>
                              <p className="text-sm text-gray-500">
                                {members.length} members · {teamPortfolios.length} portfolios
                              </p>
                            </div>
                          </div>
                          {isOrgAdmin && (
                            <div className="flex items-center space-x-2" onClick={e => e.stopPropagation()}>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setEditingTeam(team)}
                              >
                                <Edit3 className="w-3 h-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  if (confirm('Are you sure you want to delete this team?')) {
                                    deleteTeamMutation.mutate(team.id)
                                  }
                                }}
                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="border-t border-gray-100 bg-gray-50 p-4">
                          {team.description && (
                            <p className="text-sm text-gray-600 mb-4">{team.description}</p>
                          )}

                          {/* Team Members */}
                          <div className="mb-4">
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="text-sm font-medium text-gray-700">Members</h4>
                              {isOrgAdmin && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setSelectedTeam(team)
                                    setShowAddMemberModal(true)
                                  }}
                                >
                                  <UserPlus className="w-3 h-3 mr-1" />
                                  Add
                                </Button>
                              )}
                            </div>
                            {members.length === 0 ? (
                              <p className="text-sm text-gray-500 italic">No members yet</p>
                            ) : (
                              <div className="space-y-2">
                                {members.map(member => (
                                  <div
                                    key={member.id}
                                    className="flex items-center justify-between p-2 bg-white rounded-lg"
                                  >
                                    <div className="flex items-center space-x-3">
                                      <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium text-gray-600">
                                        {member.user?.full_name?.charAt(0) || '?'}
                                      </div>
                                      <div>
                                        <div className="flex items-center space-x-2">
                                          <span className="text-sm font-medium text-gray-900">
                                            {member.user?.full_name}
                                          </span>
                                          {member.is_team_admin && (
                                            <span className="px-1.5 py-0.5 text-xs bg-amber-100 text-amber-700 rounded">
                                              Admin
                                            </span>
                                          )}
                                        </div>
                                        {member.title && (
                                          <span className="text-xs text-gray-500">{member.title}</span>
                                        )}
                                      </div>
                                    </div>
                                    {isOrgAdmin && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => removeTeamMemberMutation.mutate(member.id)}
                                        className="text-red-600 hover:text-red-700"
                                      >
                                        <X className="w-3 h-3" />
                                      </Button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Team Portfolios */}
                          <div>
                            <h4 className="text-sm font-medium text-gray-700 mb-2">Portfolios</h4>
                            {teamPortfolios.length === 0 ? (
                              <p className="text-sm text-gray-500 italic">No portfolios assigned</p>
                            ) : (
                              <div className="space-y-2">
                                {teamPortfolios.map(portfolio => {
                                  const portfolioMembers = getPortfolioMembers(portfolio.id)
                                  return (
                                    <div
                                      key={portfolio.id}
                                      className="p-2 bg-white rounded-lg"
                                    >
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center space-x-2">
                                          <FolderOpen className="w-4 h-4 text-gray-400" />
                                          <span className="text-sm font-medium text-gray-900">{portfolio.name}</span>
                                        </div>
                                        <span className="text-xs text-gray-500">
                                          {portfolioMembers.length} members
                                        </span>
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </Card>
                  )
                })
              )}
            </div>
          )}

          {/* People Tab */}
          {activeTab === 'people' && (
            <div className="space-y-3">
              {filteredMembers.length === 0 ? (
                <div className="text-center py-12">
                  <UserCircle className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No people found</h3>
                  <p className="text-sm text-gray-500">No members match your search</p>
                </div>
              ) : (
                filteredMembers.map(member => {
                  const userTeams = getUserTeams(member.user_id)
                  const userPortfolios = getUserPortfolios(member.user_id)

                  return (
                    <Card key={member.id} className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-start space-x-3">
                          <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium text-gray-600">
                            {member.user?.full_name?.charAt(0) || '?'}
                          </div>
                          <div>
                            <div className="flex items-center space-x-2">
                              <span className="font-medium text-gray-900">{member.user?.full_name}</span>
                              {member.is_org_admin && (
                                <span className="px-2 py-0.5 text-xs bg-indigo-100 text-indigo-700 rounded-full flex items-center">
                                  <Crown className="w-3 h-3 mr-1" />
                                  Org Admin
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-gray-500">{member.user?.email}</p>
                            {member.title && (
                              <p className="text-sm text-gray-600 mt-1">{member.title}</p>
                            )}
                            <div className="flex flex-wrap gap-1 mt-2">
                              {userTeams.map(tm => (
                                <span
                                  key={tm.id}
                                  className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full"
                                >
                                  {tm.team?.name}
                                  {tm.is_team_admin && ' (Admin)'}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </Card>
                  )
                })
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
              <Card className="p-4">
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

              <Card className="p-4">
                <h3 className="font-medium text-gray-900 mb-4">Org Admins</h3>
                <div className="space-y-2">
                  {orgMembers.filter(m => m.is_org_admin).map(admin => (
                    <div key={admin.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
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

        {/* Add Team Modal */}
        {showAddTeamModal && (
          <AddTeamModal
            onClose={() => setShowAddTeamModal(false)}
            onSave={(data) => createTeamMutation.mutate(data)}
            isLoading={createTeamMutation.isPending}
          />
        )}

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
      </div>
    </div>
  )
}

// Sub-components

interface AddTeamModalProps {
  team?: Team
  onClose: () => void
  onSave: (data: { name: string; description: string; color: string }) => void
  isLoading: boolean
}

function AddTeamModal({ team, onClose, onSave, isLoading }: AddTeamModalProps) {
  const [name, setName] = useState(team?.name || '')
  const [description, setDescription] = useState(team?.description || '')
  const [color, setColor] = useState(team?.color || 'blue')

  const colors = ['blue', 'green', 'purple', 'red', 'orange', 'pink', 'indigo', 'teal']

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
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
                  style={{ backgroundColor: `var(--${c}-500, #6366f1)` }}
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
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
