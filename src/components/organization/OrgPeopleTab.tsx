/**
 * OrgPeopleTab — People tab extracted from OrganizationPage.
 * Server-side paginated member list with search, admin toggles,
 * suspend/unsuspend, and contacts sub-view.
 */

import React, { useState } from 'react'
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import {
  UserCircle,
  Briefcase,
  Crown,
  Search,
  Mail,
  Phone,
  Plus,
  Trash2,
  AtSign,
  ExternalLink,
  LogIn,
  UserX,
  AlertTriangle,
  Shield,
  Users,
  Send,
  XCircle,
  Clock,
} from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { useToast } from '../common/Toast'
import type {
  Organization,
  OrganizationMembership,
  OrganizationContact,
  OrganizationInvite,
  TeamMembership,
  PortfolioMembership,
  UserProfileData,
} from '../../types/organization'

const PAGE_SIZE = 25

interface OrgPeopleTabProps {
  organization: Organization | null
  isOrgAdmin: boolean
  teamMemberships: TeamMembership[]
  portfolioMemberships: PortfolioMembership[]
  onUserClick?: (user: { id: string; full_name: string }) => void
  /** Render the suspend modal (kept in parent to share with other tabs) */
  onSuspendUser: (member: OrganizationMembership) => void
  /** Render the add-contact modal */
  onAddContact: () => void
  /** Contacts list (fetched in parent, shared with other features) */
  contacts: OrganizationContact[]
  /** Delete contact handler */
  onDeleteContact: (contactId: string) => void
}

// Transform a view row into OrganizationMembership
function mapViewRow(row: any): OrganizationMembership {
  return {
    id: row.id,
    user_id: row.user_id,
    organization_id: row.organization_id,
    status: row.status,
    is_org_admin: row.is_org_admin,
    title: row.profile_title,
    suspended_at: row.suspended_at || null,
    suspended_by: row.suspended_by || null,
    suspension_reason: row.suspension_reason || null,
    user: {
      id: row.user_id,
      email: row.user_email || '',
      full_name: row.user_full_name || 'Unknown',
      coverage_admin: row.user_coverage_admin || false,
    },
    profile: row.profile_user_type
      ? {
          user_type: row.profile_user_type,
          sector_focus: row.sector_focus || [],
          investment_style: row.investment_style || [],
          market_cap_focus: row.market_cap_focus || [],
          geography_focus: row.geography_focus || [],
          time_horizon: row.time_horizon || [],
          ops_departments: row.ops_departments || [],
          compliance_areas: row.compliance_areas || [],
        }
      : null,
  }
}

export function OrgPeopleTab({
  organization,
  isOrgAdmin,
  teamMemberships,
  portfolioMemberships,
  onUserClick,
  onSuspendUser,
  onAddContact,
  contacts,
  onDeleteContact,
}: OrgPeopleTabProps) {
  const { user } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()

  const [searchTerm, setSearchTerm] = useState('')
  const [peopleView, setPeopleView] = useState<'users' | 'contacts'>('users')
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [reactivateTarget, setReactivateTarget] = useState<OrganizationMembership | null>(null)
  const [reactivateReason, setReactivateReason] = useState('')

  // ─── Pending invites query (admin only) ───────────────────────
  const { data: pendingInvites = [] } = useQuery({
    queryKey: ['organization-invites', organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_invites')
        .select('*')
        .eq('organization_id', organization!.id)
        .in('status', ['pending', 'sent'])
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as OrganizationInvite[]
    },
    enabled: isOrgAdmin && !!organization?.id,
  })

  const createInviteMutation = useMutation({
    mutationFn: async (email: string) => {
      const { data, error } = await supabase.rpc('create_org_invite', {
        p_organization_id: organization!.id,
        p_email: email.trim().toLowerCase(),
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-invites'] })
      queryClient.invalidateQueries({ queryKey: ['organization-members-paged'] })
      queryClient.invalidateQueries({ queryKey: ['organization-members'] })
      toast.success('Invite sent', `Invitation sent to ${inviteEmail}`)
      setInviteEmail('')
      setShowInviteModal(false)
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to send invite')
    },
  })

  const cancelInviteMutation = useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await supabase
        .from('organization_invites')
        .update({ status: 'cancelled' })
        .eq('id', inviteId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-invites'] })
      toast.info('Invite cancelled')
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to cancel invite')
    },
  })

  // ─── Server-side paginated members query ──────────────────────
  const {
    data: membersData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['organization-members-paged', organization?.id, searchTerm],
    queryFn: async ({ pageParam = 0 }) => {
      let query = supabase
        .from('organization_members_v')
        .select('*', { count: 'exact' })
        .eq('organization_id', organization!.id)
        .order('user_first_name', { ascending: true })
        .range(pageParam, pageParam + PAGE_SIZE - 1)

      if (searchTerm.trim()) {
        const term = `%${searchTerm.trim()}%`
        query = query.or(
          `user_full_name.ilike.${term},user_email.ilike.${term},profile_title.ilike.${term}`
        )
      }

      const { data, error, count } = await query
      if (error) throw error
      return {
        rows: (data || []).map(mapViewRow) as OrganizationMembership[],
        totalCount: count ?? 0,
        nextOffset: pageParam + PAGE_SIZE,
      }
    },
    getNextPageParam: (lastPage) => {
      if (lastPage.nextOffset >= lastPage.totalCount) return undefined
      return lastPage.nextOffset
    },
    initialPageParam: 0,
  })

  const allMembers = membersData?.pages.flatMap((p) => p.rows) ?? []
  const totalCount = membersData?.pages[0]?.totalCount ?? 0

  // Derived lists
  const activeMembers = allMembers.filter((m) => m.status === 'active')
  const suspendedMembers = allMembers.filter((m) => m.status === 'inactive')
  const adminMembers = activeMembers.filter(
    (m) => m.is_org_admin || m.user?.coverage_admin
  )
  const regularMembers = activeMembers.filter(
    (m) => !m.is_org_admin && !m.user?.coverage_admin
  )

  // Filtered contacts (client-side, list is small)
  const filteredContacts = contacts.filter(
    (c) =>
      c.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.company?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.title?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  // ─── Mutations ───────────────────────────────────────────────
  const reactivateMemberMutation = useMutation({
    mutationFn: async ({ userId, reason }: { userId: string; reason?: string }) => {
      const { data, error } = await supabase.rpc('reactivate_org_member', {
        p_target_user_id: userId,
        p_reason: reason || null,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-members-paged'] })
      queryClient.invalidateQueries({ queryKey: ['organization-members'] })
      queryClient.invalidateQueries({ queryKey: ['org-admin-status'] })
      toast.success('Member reactivated')
      setReactivateTarget(null)
      setReactivateReason('')
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to reactivate member')
    },
  })

  const updateUserPermissionsMutation = useMutation({
    mutationFn: async ({
      userId,
      permissions,
    }: {
      userId: string
      permissions: { coverage_admin?: boolean; is_org_admin?: boolean }
    }) => {
      // Frontend guard: prevent last-admin demotion
      if (permissions.is_org_admin === false) {
        const activeAdminCount = allMembers.filter(
          (m) => m.is_org_admin && m.status === 'active'
        ).length
        if (activeAdminCount <= 1) {
          throw new Error(
            'Cannot remove the last org admin. Promote another user first.'
          )
        }
      }

      if (permissions.coverage_admin !== undefined) {
        const { error: userError } = await supabase
          .from('users')
          .update({ coverage_admin: permissions.coverage_admin })
          .eq('id', userId)
        if (userError) throw userError
      }

      if (permissions.is_org_admin !== undefined && organization) {
        const { error: membershipError } = await supabase
          .from('organization_memberships')
          .update({ is_org_admin: permissions.is_org_admin })
          .eq('user_id', userId)
          .eq('organization_id', organization.id)
        if (membershipError) throw membershipError
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-members-paged'] })
      queryClient.invalidateQueries({ queryKey: ['organization-members'] })
      queryClient.invalidateQueries({ queryKey: ['org-admin-status'] })
      toast.success('Permissions updated')
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to update permissions')
    },
  })

  // ─── Helpers ─────────────────────────────────────────────────
  const getUserTeams = (userId: string) =>
    teamMemberships.filter((tm) => tm.user_id === userId)
  const getUserPortfolios = (userId: string) =>
    portfolioMemberships.filter((pm) => pm.user_id === userId)

  const formatProfileValue = (value: string) =>
    value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

  const userTypeColors: Record<string, string> = {
    investor: 'bg-emerald-100 text-emerald-700',
    operations: 'bg-blue-100 text-blue-700',
    compliance: 'bg-amber-100 text-amber-700',
  }

  // ─── Shared member card renderer (admin + regular) ───────────
  function renderMemberCard(
    member: OrganizationMembership,
    variant: 'admin' | 'regular'
  ) {
    const userTeams = getUserTeams(member.user_id)
    const userPortfolios = getUserPortfolios(member.user_id)
    const profileInfo = member.profile
    const isExpanded = expandedUserId === member.user_id

    const avatarBg =
      variant === 'admin'
        ? 'bg-indigo-600'
        : 'bg-primary-600'

    return (
      <div
        key={member.id}
        className={`${
          variant === 'admin'
            ? 'hover:bg-indigo-50/50'
            : 'hover:bg-gray-50'
        } transition-colors`}
      >
        <div className="px-4 py-3 flex items-center justify-between">
          {/* Left: User info */}
          <div className="flex items-center space-x-3 min-w-0 flex-1">
            <div
              className={`w-8 h-8 rounded-full ${avatarBg} flex items-center justify-center flex-shrink-0`}
            >
              <span className="text-white text-sm font-semibold">
                {member.user?.full_name
                  ?.split(' ')
                  .map((n) => n[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase() || '?'}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center space-x-2">
                <button
                  onClick={() =>
                    setExpandedUserId(isExpanded ? null : member.user_id)
                  }
                  className={`font-medium text-gray-900 text-sm truncate ${
                    variant === 'admin'
                      ? 'hover:text-indigo-600'
                      : 'hover:text-primary-600'
                  } transition-colors text-left`}
                >
                  {member.user?.full_name}
                </button>
                {onUserClick && member.user_id && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onUserClick({
                        id: member.user_id,
                        full_name: member.user?.full_name || 'Unknown',
                      })
                    }}
                    className={`p-0.5 text-gray-400 ${
                      variant === 'admin'
                        ? 'hover:text-indigo-600'
                        : 'hover:text-primary-600'
                    } transition-colors`}
                    title="Open user profile"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </button>
                )}
                {profileInfo?.user_type && (
                  <span
                    className={`px-1.5 py-0.5 text-[10px] rounded ${
                      userTypeColors[profileInfo.user_type] ||
                      'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {formatProfileValue(profileInfo.user_type)}
                  </span>
                )}
                <span className="text-xs text-gray-400 truncate hidden sm:inline">
                  {member.user?.email}
                </span>
              </div>
            </div>
          </div>

          {/* Center: Team / Portfolio badges */}
          <div className="hidden md:flex items-center space-x-1.5 flex-shrink-0 mx-4">
            {userTeams.slice(0, 2).map((tm) => (
              <span
                key={tm.id}
                className="px-1.5 py-0.5 text-[10px] rounded flex items-center"
                style={{
                  backgroundColor: `${tm.team?.color || '#6366f1'}15`,
                  color: tm.team?.color || '#6366f1',
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
            {variant === 'regular' && (
              <>
                {userPortfolios.slice(0, 2).map((pm) => (
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
              </>
            )}
          </div>

          {/* Right: Permission toggles & Actions */}
          <div className="flex items-center space-x-2 flex-shrink-0">
            {member.user_id === user?.id ? (
              <div className="flex items-center space-x-1">
                {member.is_org_admin && (
                  <span
                    className="p-1.5 bg-indigo-100 text-indigo-700 rounded"
                    title="Org Admin"
                  >
                    <Crown className="w-4 h-4" />
                  </span>
                )}
                {member.user?.coverage_admin && (
                  <span
                    className="p-1.5 bg-purple-100 text-purple-700 rounded"
                    title="Coverage Admin"
                  >
                    <Shield className="w-4 h-4" />
                  </span>
                )}
              </div>
            ) : isOrgAdmin ? (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    updateUserPermissionsMutation.mutate({
                      userId: member.user_id,
                      permissions: { is_org_admin: !member.is_org_admin },
                    })
                  }}
                  disabled={updateUserPermissionsMutation.isPending}
                  className={`p-1.5 rounded transition-colors ${
                    member.is_org_admin
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'text-gray-300 hover:text-indigo-600 hover:bg-indigo-50'
                  }`}
                  title={
                    member.is_org_admin
                      ? 'Remove Org Admin'
                      : 'Make Org Admin'
                  }
                >
                  <Crown className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    updateUserPermissionsMutation.mutate({
                      userId: member.user_id,
                      permissions: {
                        coverage_admin: !member.user?.coverage_admin,
                      },
                    })
                  }}
                  disabled={updateUserPermissionsMutation.isPending}
                  className={`p-1.5 rounded transition-colors ${
                    member.user?.coverage_admin
                      ? 'bg-purple-100 text-purple-700'
                      : 'text-gray-300 hover:text-purple-600 hover:bg-purple-50'
                  }`}
                  title={
                    member.user?.coverage_admin
                      ? 'Remove Coverage Admin'
                      : 'Make Coverage Admin'
                  }
                >
                  <Shield className="w-4 h-4" />
                </button>
                <div className="w-px h-5 bg-gray-200" />
                <button
                  onClick={() => onSuspendUser(member)}
                  className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors"
                  title="Suspend access"
                >
                  <UserX className="w-4 h-4" />
                </button>
              </>
            ) : variant === 'admin' ? (
              <div className="flex items-center space-x-1">
                {member.is_org_admin && (
                  <span
                    className="p-1.5 bg-indigo-100 text-indigo-700 rounded"
                    title="Org Admin"
                  >
                    <Crown className="w-4 h-4" />
                  </span>
                )}
                {member.user?.coverage_admin && (
                  <span
                    className="p-1.5 bg-purple-100 text-purple-700 rounded"
                    title="Coverage Admin"
                  >
                    <Shield className="w-4 h-4" />
                  </span>
                )}
              </div>
            ) : null}
          </div>
        </div>

        {/* Expanded Profile Details */}
        {isExpanded && profileInfo && (
          <div
            className={`px-4 pb-3 pt-1 ml-11 border-t ${
              variant === 'admin' ? 'border-indigo-100' : 'border-gray-100'
            }`}
          >
            <div className="flex flex-wrap gap-2 text-xs">
              {member.title && (
                <div className="flex items-center gap-1">
                  <span className="text-gray-500">Title:</span>
                  <span className="text-gray-700">{member.title}</span>
                </div>
              )}
              {renderProfileTags(profileInfo)}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ─── Profile tag renderer ────────────────────────────────────
  function renderProfileTags(profileInfo: UserProfileData) {
    const tags: React.ReactNode[] = []

    if (profileInfo.user_type === 'investor') {
      if (profileInfo.sector_focus?.length > 0) {
        tags.push(
          <div key="sectors" className="flex items-center gap-1 flex-wrap">
            <span className="text-gray-500">Sectors:</span>
            {profileInfo.sector_focus.map((s: string) => (
              <span key={s} className="px-1.5 py-0.5 bg-emerald-50 text-emerald-600 rounded">
                {formatProfileValue(s)}
              </span>
            ))}
          </div>
        )
      }
      if (profileInfo.investment_style?.length > 0) {
        tags.push(
          <div key="style" className="flex items-center gap-1 flex-wrap">
            <span className="text-gray-500">Style:</span>
            {profileInfo.investment_style.map((s: string) => (
              <span key={s} className="px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded">
                {formatProfileValue(s)}
              </span>
            ))}
          </div>
        )
      }
      if (profileInfo.market_cap_focus?.length > 0) {
        tags.push(
          <div key="mcap" className="flex items-center gap-1 flex-wrap">
            <span className="text-gray-500">Market Cap:</span>
            {profileInfo.market_cap_focus.map((m: string) => (
              <span key={m} className="px-1.5 py-0.5 bg-cyan-50 text-cyan-600 rounded">
                {formatProfileValue(m)}
              </span>
            ))}
          </div>
        )
      }
      if (profileInfo.geography_focus?.length > 0) {
        tags.push(
          <div key="geo" className="flex items-center gap-1 flex-wrap">
            <span className="text-gray-500">Geography:</span>
            {profileInfo.geography_focus.map((g: string) => (
              <span key={g} className="px-1.5 py-0.5 bg-orange-50 text-orange-600 rounded">
                {formatProfileValue(g)}
              </span>
            ))}
          </div>
        )
      }
      if (profileInfo.time_horizon?.length > 0) {
        tags.push(
          <div key="horizon" className="flex items-center gap-1 flex-wrap">
            <span className="text-gray-500">Horizon:</span>
            {profileInfo.time_horizon.map((t: string) => (
              <span key={t} className="px-1.5 py-0.5 bg-violet-50 text-violet-600 rounded">
                {formatProfileValue(t)}
              </span>
            ))}
          </div>
        )
      }
    }

    if (
      profileInfo.user_type === 'operations' &&
      profileInfo.ops_departments?.length > 0
    ) {
      tags.push(
        <div key="depts" className="flex items-center gap-1 flex-wrap">
          <span className="text-gray-500">Departments:</span>
          {profileInfo.ops_departments.map((d: string) => (
            <span key={d} className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">
              {formatProfileValue(d)}
            </span>
          ))}
        </div>
      )
    }

    if (
      profileInfo.user_type === 'compliance' &&
      profileInfo.compliance_areas?.length > 0
    ) {
      tags.push(
        <div key="areas" className="flex items-center gap-1 flex-wrap">
          <span className="text-gray-500">Areas:</span>
          {profileInfo.compliance_areas.map((a: string) => (
            <span key={a} className="px-1.5 py-0.5 bg-amber-50 text-amber-600 rounded">
              {formatProfileValue(a)}
            </span>
          ))}
        </div>
      )
    }

    return tags
  }

  // ─── Render ──────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Search Bar + Invite Button */}
      <div className="flex items-center space-x-3">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search people..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
          />
        </div>
        {isOrgAdmin && (
          <Button size="sm" onClick={() => setShowInviteModal(true)}>
            <Send className="w-3.5 h-3.5 mr-1.5" />
            Invite User
          </Button>
        )}
      </div>

      {/* My Access Summary (for non-admins) */}
      {!isOrgAdmin && user && (
        <Card className="bg-gradient-to-r from-indigo-50 to-purple-50 border-indigo-200">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-semibold text-indigo-900 flex items-center">
                <Shield className="w-4 h-4 mr-2" />
                My Access
              </h3>
              <p className="text-xs text-indigo-700 mt-1">
                Your current permissions and memberships
              </p>
            </div>
            {(() => {
              const myMembership = allMembers.find(
                (m) => m.user_id === user.id
              )
              return (
                myMembership?.user?.coverage_admin && (
                  <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-purple-100 text-purple-800">
                    <Shield className="w-3 h-3 mr-1" />
                    Coverage Admin
                  </span>
                )
              )
            })()}
          </div>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Teams */}
            <div className="bg-white rounded-lg p-3 border border-indigo-100">
              <div className="flex items-center space-x-2 mb-2">
                <Users className="w-4 h-4 text-indigo-600" />
                <span className="text-xs font-medium text-gray-700">
                  Teams
                </span>
              </div>
              {(() => {
                const myTeams = teamMemberships.filter(
                  (tm) => tm.user_id === user.id
                )
                return myTeams.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {myTeams.map((tm) => (
                      <span
                        key={tm.id}
                        className="inline-flex items-center px-2 py-0.5 rounded text-xs"
                        style={{
                          backgroundColor: `${
                            tm.team?.color || '#6366f1'
                          }15`,
                          color: tm.team?.color || '#6366f1',
                        }}
                      >
                        {tm.team?.name}
                        {tm.is_team_admin && (
                          <Crown className="w-2.5 h-2.5 ml-1" />
                        )}
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
                <span className="text-xs font-medium text-gray-700">
                  Portfolios
                </span>
              </div>
              {(() => {
                const myPortfolios = portfolioMemberships.filter(
                  (pm) => pm.user_id === user.id
                )
                return myPortfolios.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {myPortfolios.map((pm) => (
                      <span
                        key={pm.id}
                        className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-purple-100 text-purple-700"
                      >
                        {pm.portfolio?.name}
                        {pm.is_portfolio_manager && (
                          <Crown className="w-2.5 h-2.5 ml-1" />
                        )}
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
                <span className="text-xs font-medium text-gray-700">
                  Your Role
                </span>
              </div>
              {(() => {
                const myMembership = allMembers.find(
                  (m) => m.user_id === user.id
                )
                return (
                  <div className="space-y-1">
                    <p className="text-xs text-gray-900 font-medium">
                      {myMembership?.title || 'Member'}
                    </p>
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
              {totalCount}
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
          {/* Pending Invites (admin only) */}
          {isOrgAdmin && pendingInvites.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-gray-700 flex items-center">
                <Send className="w-4 h-4 mr-1.5 text-blue-500" />
                Pending Invites ({pendingInvites.length})
              </h3>
              <div className="bg-blue-50 rounded-lg border border-blue-200 divide-y divide-blue-100">
                {pendingInvites.map((invite) => (
                  <div
                    key={invite.id}
                    className="px-4 py-3 flex items-center justify-between"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 rounded-full bg-blue-200 flex items-center justify-center flex-shrink-0">
                        <Mail className="w-4 h-4 text-blue-600" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {invite.email}
                        </p>
                        <div className="flex items-center space-x-2 text-xs text-gray-500">
                          <Clock className="w-3 h-3" />
                          <span>
                            Sent {new Date(invite.created_at).toLocaleDateString()}
                          </span>
                          <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded capitalize">
                            {invite.status}
                          </span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => cancelInviteMutation.mutate(invite.id)}
                      disabled={cancelInviteMutation.isPending}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                      title="Cancel invite"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Admins Section */}
          {adminMembers.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-gray-700 flex items-center">
                <Crown className="w-4 h-4 mr-1.5 text-indigo-500" />
                Admins ({adminMembers.length})
              </h3>
              <div className="bg-white rounded-lg border border-indigo-200 divide-y divide-indigo-100">
                {adminMembers.map((member) =>
                  renderMemberCard(member, 'admin')
                )}
              </div>
            </div>
          )}

          {/* Regular Users */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-700 flex items-center">
              <UserCircle className="w-4 h-4 mr-1.5 text-green-500" />
              Users ({regularMembers.length})
            </h3>
            {regularMembers.length === 0 ? (
              <div className="text-center py-8 bg-gray-50 rounded-lg">
                <UserCircle className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-500">
                  No users match your search
                </p>
              </div>
            ) : (
              <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
                {regularMembers.map((member) =>
                  renderMemberCard(member, 'regular')
                )}
                {hasNextPage && (
                  <button
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                    className="w-full px-4 py-2.5 text-sm text-primary-600 hover:bg-primary-50 transition-colors font-medium"
                  >
                    {isFetchingNextPage
                      ? 'Loading...'
                      : `Show more (${totalCount - allMembers.length} remaining)`}
                  </button>
                )}
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
                {suspendedMembers.map((member) => {
                  const suspenderName = member.suspended_by
                    ? allMembers.find((m) => m.user_id === member.suspended_by)?.user?.full_name || 'Unknown'
                    : null
                  return (
                    <div
                      key={member.id}
                      className="px-4 py-3 flex items-center justify-between"
                    >
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 rounded-full bg-gray-400 flex items-center justify-center flex-shrink-0">
                          <span className="text-white text-sm font-semibold">
                            {member.user?.full_name
                              ?.split(' ')
                              .map((n) => n[0])
                              .join('')
                              .slice(0, 2)
                              .toUpperCase() || '?'}
                          </span>
                        </div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="font-medium text-gray-700 text-sm">
                              {member.user?.full_name}
                            </span>
                            {onUserClick && member.user_id && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onUserClick({
                                    id: member.user_id,
                                    full_name:
                                      member.user?.full_name || 'Unknown',
                                  })
                                }}
                                className="p-0.5 text-gray-400 hover:text-primary-600 transition-colors"
                                title="Open user profile"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </button>
                            )}
                            <span className="px-1.5 py-0.5 text-[10px] bg-amber-200 text-amber-800 rounded">
                              Suspended
                            </span>
                          </div>
                          <p className="text-xs text-gray-500">
                            {member.user?.email}
                          </p>
                          {/* Suspension details */}
                          <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-500">
                            {member.suspended_at && (
                              <span className="flex items-center">
                                <Clock className="w-3 h-3 mr-0.5" />
                                {new Date(member.suspended_at).toLocaleDateString()}
                              </span>
                            )}
                            {suspenderName && (
                              <span>by {suspenderName}</span>
                            )}
                            {member.suspension_reason && (
                              <span className="text-amber-700 italic truncate max-w-[200px]" title={member.suspension_reason}>
                                — {member.suspension_reason}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => setReactivateTarget(member)}
                        disabled={reactivateMemberMutation.isPending}
                        className="px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 rounded transition-colors flex items-center flex-shrink-0"
                      >
                        <Shield className="w-3 h-3 mr-1" />
                        Restore
                      </button>
                    </div>
                  )
                })}
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
              <Button size="sm" onClick={onAddContact}>
                <Plus className="w-3 h-3 mr-1" />
                Add Contact
              </Button>
            )}
          </div>
          <p className="text-xs text-gray-500">
            People who don't have platform access but receive reports or
            communications.
          </p>

          {filteredContacts.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-lg">
              <AtSign className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                No contacts yet
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                Add external contacts who need to receive reports or
                communications
              </p>
              {isOrgAdmin && (
                <Button onClick={onAddContact}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add First Contact
                </Button>
              )}
            </div>
          ) : (
            <div className="grid gap-3">
              {filteredContacts.map((contact) => (
                <Card key={contact.id} className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start space-x-3">
                      <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-primary-600 text-sm font-semibold">
                          {contact.full_name
                            .split(' ')
                            .map((n) => n[0])
                            .join('')
                            .slice(0, 2)
                            .toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-medium text-gray-900">
                            {contact.full_name}
                          </span>
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
                          <p className="text-sm text-gray-600">
                            {contact.title} at {contact.company}
                          </p>
                        )}
                        {contact.title && !contact.company && (
                          <p className="text-sm text-gray-600">
                            {contact.title}
                          </p>
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
                          <p className="text-sm text-gray-500 mt-2 italic">
                            "{contact.notes}"
                          </p>
                        )}
                      </div>
                    </div>
                    {isOrgAdmin && (
                      <button
                        onClick={() => {
                          if (
                            confirm(
                              `Remove ${contact.full_name} from contacts?`
                            )
                          ) {
                            onDeleteContact(contact.id)
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

      {/* Reactivate Confirmation Modal */}
      {reactivateTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => { setReactivateTarget(null); setReactivateReason('') }} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6 mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Reactivate Member</h3>
            <p className="text-sm text-gray-500 mb-4">
              Restore access for <span className="font-medium text-gray-700">{reactivateTarget.user?.full_name}</span> ({reactivateTarget.user?.email}).
            </p>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Reason <span className="text-gray-400">(optional)</span>
            </label>
            <input
              type="text"
              value={reactivateReason}
              onChange={(e) => setReactivateReason(e.target.value)}
              placeholder="e.g. Suspension reviewed, access restored"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
              autoFocus
            />
            <div className="flex justify-end space-x-3 mt-5">
              <Button variant="outline" onClick={() => { setReactivateTarget(null); setReactivateReason('') }}>
                Cancel
              </Button>
              <Button
                onClick={() => reactivateMemberMutation.mutate({ userId: reactivateTarget.user_id, reason: reactivateReason })}
                disabled={reactivateMemberMutation.isPending}
              >
                {reactivateMemberMutation.isPending ? 'Restoring...' : 'Restore Access'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowInviteModal(false)}
          />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6 mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">
              Invite User
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Send an invitation to join {organization?.name || 'the organization'}.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (inviteEmail.trim()) {
                  createInviteMutation.mutate(inviteEmail)
                }
              }}
            >
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email address
              </label>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="user@example.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                autoFocus
                required
              />
              <div className="flex justify-end space-x-3 mt-5">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowInviteModal(false)
                    setInviteEmail('')
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    !inviteEmail.trim() || createInviteMutation.isPending
                  }
                >
                  <Send className="w-3.5 h-3.5 mr-1.5" />
                  {createInviteMutation.isPending
                    ? 'Sending...'
                    : 'Send Invite'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
