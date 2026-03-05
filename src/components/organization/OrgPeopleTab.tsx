/**
 * OrgPeopleTab — "Members" directory tab.
 *
 * Lightweight member directory focused on identity + seats + status + basic
 * admin actions. Role / access changes live in Governance tab.
 *
 * Layout:
 *   Header: subtitle + search + seat counts + Invite button
 *   Table: name/email, status pill, role pill, mini metrics, actions
 *   Contacts sub-view (toggle)
 */

import React, { useState } from 'react'
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { logOrgActivity } from '../../lib/org-activity-log'
import { useAuth } from '../../hooks/useAuth'
import {
  UserCircle,
  Search,
  Mail,
  Phone,
  Plus,
  Trash2,
  AtSign,
  ExternalLink,
  UserX,
  Send,
  XCircle,
  Clock,
  ArrowRight,
  AlertTriangle,
  AlertCircle,
  Info,
} from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { useToast } from '../common/Toast'
import { StatusPill, RoleBadge, SeatSummaryBar } from './OrgBadges'
import type { AuthorityRow } from '../../lib/authority-map'
import type {
  Organization,
  OrganizationMembership,
  OrganizationContact,
  OrganizationInvite,
  UserProfileData,
} from '../../types/organization'

const PAGE_SIZE = 25

interface OrgPeopleTabProps {
  organization: Organization | null
  isOrgAdmin: boolean
  /** Authority rows from the same source as Governance — used for consistent team/portfolio/risk counts */
  authorityRows: AuthorityRow[]
  /** Number of currently active org admins — used for last-admin guardrail */
  activeOrgAdminCount: number
  onUserClick?: (user: { id: string; full_name: string }) => void
  /** Render the suspend modal (kept in parent to share with other tabs) */
  onSuspendUser: (member: OrganizationMembership, reason: string) => void
  /** Render the add-contact modal */
  onAddContact: () => void
  /** Contacts list (fetched in parent, shared with other features) */
  contacts: OrganizationContact[]
  /** Delete contact handler */
  onDeleteContact: (contactId: string) => void
  /** Cross-nav: navigate to Governance → Manage, focused on a user */
  onNavigateToGovernance?: (userId: string) => void
  /** Cross-nav: navigate to Governance → Manage, focused on a user with flagged filter */
  onNavigateToGovernanceFlagged?: (userId: string) => void
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
  authorityRows,
  activeOrgAdminCount,
  onUserClick,
  onSuspendUser,
  onAddContact,
  contacts,
  onDeleteContact,
  onNavigateToGovernance,
  onNavigateToGovernanceFlagged,
}: OrgPeopleTabProps) {
  const { user } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()

  const [searchTerm, setSearchTerm] = useState('')
  const [peopleView, setPeopleView] = useState<'users' | 'contacts'>('users')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'invited' | 'suspended'>('all')
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [reactivateTarget, setReactivateTarget] = useState<OrganizationMembership | null>(null)
  const [reactivateReason, setReactivateReason] = useState('')
  const [suspendTarget, setSuspendTarget] = useState<OrganizationMembership | null>(null)
  const [suspendReason, setSuspendReason] = useState('')

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
      if (organization?.id) {
        logOrgActivity({
          organizationId: organization.id,
          action: 'invite.created',
          targetType: 'invite',
          entityType: 'invite',
          actionType: 'created',
          details: { email: inviteEmail.trim().toLowerCase() },
        })
      }
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
    onSuccess: (_, inviteId) => {
      queryClient.invalidateQueries({ queryKey: ['organization-invites'] })
      toast.info('Invite cancelled')
      if (organization?.id) {
        logOrgActivity({
          organizationId: organization.id,
          action: 'invite.cancelled',
          targetType: 'invite',
          targetId: inviteId,
          entityType: 'invite',
          actionType: 'deleted',
        })
      }
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

  // ─── Derived counts ───────────────────────────────────────────
  const activeCount = allMembers.filter((m) => m.status === 'active').length
  const suspendedCount = allMembers.filter((m) => m.status === 'inactive').length
  const invitedCount = pendingInvites.length

  // ─── Filtered + sorted member list ────────────────────────────
  const displayMembers = React.useMemo(() => {
    let list = [...allMembers]

    // Status filter
    if (statusFilter === 'active') list = list.filter((m) => m.status === 'active')
    else if (statusFilter === 'suspended') list = list.filter((m) => m.status === 'inactive')

    return list
  }, [allMembers, statusFilter])

  // Filtered contacts (client-side, list is small)
  const filteredContacts = contacts.filter(
    (c) =>
      c.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.company?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.title?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  // ─── Mutations ────────────────────────────────────────────────
  const reactivateMemberMutation = useMutation({
    mutationFn: async ({ userId, reason }: { userId: string; reason?: string }) => {
      const { data, error } = await supabase.rpc('reactivate_org_member', {
        p_target_user_id: userId,
        p_reason: reason || null,
      })
      if (error) throw error
      return data
    },
    onSuccess: (_, { userId, reason }) => {
      queryClient.invalidateQueries({ queryKey: ['organization-members-paged'] })
      queryClient.invalidateQueries({ queryKey: ['organization-members'] })
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
          details: { reason: reason || undefined },
        })
      }
      setReactivateTarget(null)
      setReactivateReason('')
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to reactivate member')
    },
  })

  // ─── Authority row lookup (single source of truth for counts) ─
  const authorityByUser = React.useMemo(() => {
    const map = new Map<string, AuthorityRow>()
    for (const row of authorityRows) map.set(row.userId, row)
    return map
  }, [authorityRows])

  const formatProfileValue = (value: string) =>
    value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

  const getInitials = (name: string | null | undefined) =>
    (name || '?').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()

  // ─── Render ───────────────────────────────────────────────────
  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {/* ── Header: subtitle + search + seats + invite ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Members</h2>
            <p className="text-xs text-gray-500 mt-0.5">Invite, suspend, and manage organization membership</p>
          </div>
          <div className="flex items-center gap-3">
            <SeatSummaryBar seats={{ active: activeCount, invited: invitedCount, suspended: suspendedCount }} />
            {isOrgAdmin && (
              <Button size="sm" onClick={() => setShowInviteModal(true)}>
                <Send className="w-3.5 h-3.5 mr-1.5" />
                Invite
              </Button>
            )}
          </div>
        </div>

        {/* Search + filters */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search members..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
            />
          </div>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>

          {/* View toggle: Members / Contacts */}
          <div className="inline-flex items-center bg-gray-100 rounded p-0.5 ml-auto">
            <button
              onClick={() => setPeopleView('users')}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                peopleView === 'users'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Members
              <span className="ml-1 text-gray-400">{totalCount}</span>
            </button>
            <button
              onClick={() => setPeopleView('contacts')}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                peopleView === 'contacts'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Contacts
              <span className="ml-1 text-gray-400">{contacts.length}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Members table ── */}
      {peopleView === 'users' && (
        <div className="space-y-3">
          {/* Pending invites row (admin only) */}
          {isOrgAdmin && pendingInvites.length > 0 && statusFilter !== 'suspended' && (
            <div className="bg-amber-50 rounded-lg border border-amber-200 divide-y divide-amber-100">
              {pendingInvites.map((invite) => (
                <div key={invite.id} className="px-4 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-amber-200 flex items-center justify-center shrink-0">
                      <Mail className="w-4 h-4 text-amber-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{invite.email}</p>
                      <p className="text-[11px] text-gray-500">
                        Sent {new Date(invite.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusPill status="invited" />
                    <button
                      onClick={() => cancelInviteMutation.mutate(invite.id)}
                      disabled={cancelInviteMutation.isPending}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                      title="Cancel invite"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Member rows */}
          {displayMembers.length > 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50/80 border-b border-gray-200">
                    <th className="px-4 py-1.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider w-[40%]">Name</th>
                    <th className="px-3 py-1.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Status</th>
                    <th className="px-3 py-1.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Org Role</th>
                    <th className="px-3 py-1.5 text-center text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Teams</th>
                    <th className="px-3 py-1.5 text-center text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Portfolios</th>
                    <th className="px-3 py-1.5 text-center text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Risk</th>
                    <th className="px-4 py-1.5 text-right text-[10px] font-semibold text-gray-400 uppercase tracking-wider"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {displayMembers.map((member) => {
                    const auth = authorityByUser.get(member.user_id)
                    return (
                      <MemberRow
                        key={member.id}
                        member={member}
                        isCurrentUser={member.user_id === user?.id}
                        isOrgAdmin={isOrgAdmin}
                        teamCount={auth?.teams.length ?? 0}
                        portfolioCount={auth?.portfolios.length ?? 0}
                        riskFlags={auth?.riskFlags ?? []}
                        isExpanded={expandedUserId === member.user_id}
                        onToggleExpand={() => setExpandedUserId(expandedUserId === member.user_id ? null : member.user_id)}
                        onUserClick={onUserClick}
                        onSuspend={() => setSuspendTarget(member)}
                        onReactivate={() => setReactivateTarget(member)}
                        onManageRoles={onNavigateToGovernance ? () => onNavigateToGovernance(member.user_id) : undefined}
                        onRiskClick={onNavigateToGovernanceFlagged ? () => onNavigateToGovernanceFlagged(member.user_id) : undefined}
                        formatProfileValue={formatProfileValue}
                      />
                    )
                  })}
                </tbody>
              </table>

              {hasNextPage && (
                <button
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="w-full px-4 py-2.5 text-sm text-indigo-600 hover:bg-indigo-50 transition-colors font-medium border-t border-gray-100"
                >
                  {isFetchingNextPage
                    ? 'Loading...'
                    : `Show more (${totalCount - allMembers.length} remaining)`}
                </button>
              )}
            </div>
          ) : (
            <div className="text-center py-12 bg-gray-50 rounded-lg">
              <UserCircle className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-500">No members match your search</p>
            </div>
          )}
        </div>
      )}

      {/* ── Contacts sub-view ── */}
      {peopleView === 'contacts' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              People who don't have platform access but receive reports or communications.
            </p>
            {isOrgAdmin && (
              <Button size="sm" onClick={onAddContact}>
                <Plus className="w-3 h-3 mr-1" />
                Add Contact
              </Button>
            )}
          </div>

          {filteredContacts.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-lg">
              <AtSign className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No contacts yet</h3>
              <p className="text-sm text-gray-500 mb-4">
                Add external contacts who need to receive reports or communications
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
                      <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
                        <span className="text-primary-600 text-sm font-semibold">
                          {getInitials(contact.full_name)}
                        </span>
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
                        {contact.title && (
                          <p className="text-sm text-gray-600">
                            {contact.title}{contact.company ? ` at ${contact.company}` : ''}
                          </p>
                        )}
                        <div className="flex items-center space-x-4 mt-2 text-sm text-gray-500">
                          {contact.email && (
                            <span className="flex items-center">
                              <Mail className="w-3 h-3 mr-1" />{contact.email}
                            </span>
                          )}
                          {contact.phone && (
                            <span className="flex items-center">
                              <Phone className="w-3 h-3 mr-1" />{contact.phone}
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

      {/* ── Suspend Access Confirmation ── */}
      {suspendTarget && (() => {
        const isLastAdmin = suspendTarget.is_org_admin && activeOrgAdminCount <= 1
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40" onClick={() => { setSuspendTarget(null); setSuspendReason('') }} />
            <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6 mx-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-1">
                Suspend access for {suspendTarget.user?.full_name}?
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                They will immediately lose access to the organization and all portfolios.
              </p>

              {isLastAdmin && (
                <div className="flex items-start gap-2 p-3 mb-4 rounded-lg bg-red-50 border border-red-200">
                  <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-red-700">
                    You can't suspend the last active org admin. Promote another member to org admin first.
                  </p>
                </div>
              )}

              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reason <span className="text-gray-400">(optional)</span>
              </label>
              <textarea
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
                placeholder="e.g. Left the team, compliance review..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent text-sm"
                rows={2}
                autoFocus
              />

              <div className="flex justify-end space-x-3 mt-5">
                <Button variant="outline" onClick={() => { setSuspendTarget(null); setSuspendReason('') }}>
                  Cancel
                </Button>
                <Button
                  className="bg-amber-600 hover:bg-amber-700"
                  disabled={isLastAdmin}
                  onClick={() => {
                    onSuspendUser(suspendTarget, suspendReason)
                    setSuspendTarget(null)
                    setSuspendReason('')
                  }}
                >
                  <UserX className="w-3.5 h-3.5 mr-1.5" />
                  Suspend access
                </Button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Reactivate Access Confirmation ── */}
      {reactivateTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => { setReactivateTarget(null); setReactivateReason('') }} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6 mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">
              Reactivate access for {reactivateTarget.user?.full_name}?
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              They will regain access to the organization and their previous role assignments.
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
                {reactivateMemberMutation.isPending ? 'Reactivating...' : 'Reactivate access'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Invite Modal ── */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowInviteModal(false)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6 mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Invite User</h3>
            <p className="text-sm text-gray-500 mb-4">
              Send an invitation to join {organization?.name || 'the organization'}.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (inviteEmail.trim()) createInviteMutation.mutate(inviteEmail)
              }}
            >
              <label className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
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
                <Button type="button" variant="outline" onClick={() => { setShowInviteModal(false); setInviteEmail('') }}>
                  Cancel
                </Button>
                <Button type="submit" disabled={!inviteEmail.trim() || createInviteMutation.isPending}>
                  <Send className="w-3.5 h-3.5 mr-1.5" />
                  {createInviteMutation.isPending ? 'Sending...' : 'Send Invite'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── RiskPill — severity-aware, clickable risk indicator ────────────────

const SEVERITY_ICON: Record<string, React.ReactNode> = {
  high: <AlertTriangle className="w-3 h-3" />,
  medium: <AlertCircle className="w-3 h-3" />,
  low: <Info className="w-3 h-3" />,
}

const SEVERITY_STYLE: Record<string, string> = {
  high: 'bg-red-50 text-red-700 border-red-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-gray-100 text-gray-600 border-gray-200',
}

function RiskPill({
  flags,
  onClick,
}: {
  flags: Array<{ severity: 'high' | 'medium' | 'low'; label: string }>
  onClick?: () => void
}) {
  if (flags.length === 0) return null
  const worst = flags.some(f => f.severity === 'high')
    ? 'high'
    : flags.some(f => f.severity === 'medium')
    ? 'medium'
    : 'low'

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium rounded-full border transition-colors ${SEVERITY_STYLE[worst]} ${
        onClick ? 'cursor-pointer hover:opacity-80' : 'cursor-default'
      }`}
      title={flags.map(f => f.label).join('\n')}
    >
      {SEVERITY_ICON[worst]}
      {flags.length}
    </button>
  )
}

// ─── MemberRow ──────────────────────────────────────────────────────────

function MemberRow({
  member,
  isCurrentUser,
  isOrgAdmin,
  teamCount,
  portfolioCount,
  riskFlags,
  isExpanded,
  onToggleExpand,
  onUserClick,
  onSuspend,
  onReactivate,
  onManageRoles,
  onRiskClick,
  formatProfileValue,
}: {
  member: OrganizationMembership
  isCurrentUser: boolean
  isOrgAdmin: boolean
  teamCount: number
  portfolioCount: number
  riskFlags: Array<{ severity: 'high' | 'medium' | 'low'; label: string }>
  isExpanded: boolean
  onToggleExpand: () => void
  onUserClick?: (user: { id: string; full_name: string }) => void
  onSuspend: () => void
  onReactivate: () => void
  onManageRoles?: () => void
  onRiskClick?: () => void
  formatProfileValue: (v: string) => string
}) {
  const isSuspended = member.status === 'inactive'

  return (
    <React.Fragment>
      <tr
        className={`hover:bg-gray-50/50 cursor-pointer transition-colors ${isSuspended ? 'opacity-60' : ''}`}
        onClick={onToggleExpand}
      >
        {/* Name + avatar */}
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                isSuspended ? 'bg-gray-400' : member.is_org_admin ? 'bg-indigo-600' : 'bg-gray-500'
              }`}
            >
              <span className="text-white text-xs font-semibold">
                {(member.user?.full_name || '?').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
              </span>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium text-gray-900 truncate">{member.user?.full_name}</span>
                {onUserClick && member.user_id && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onUserClick({ id: member.user_id, full_name: member.user?.full_name || 'Unknown' })
                    }}
                    className="p-0.5 text-gray-400 hover:text-indigo-600 transition-colors shrink-0"
                    title="Open user profile"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </button>
                )}
              </div>
              <p className="text-[11px] text-gray-400 truncate">{member.user?.email}</p>
            </div>
          </div>
        </td>

        {/* Status */}
        <td className="px-3 py-2.5">
          <StatusPill status={isSuspended ? 'suspended' : 'active'} />
        </td>

        {/* Org Role */}
        <td className="px-3 py-2.5">
          {member.is_org_admin ? (
            <RoleBadge role="org-admin" compact />
          ) : member.user?.coverage_admin ? (
            <RoleBadge role="coverage-admin" compact />
          ) : (
            <RoleBadge role="member" compact />
          )}
        </td>

        {/* Teams */}
        <td className="px-3 py-2.5 text-center">
          <span className="text-sm font-medium text-gray-700">{teamCount}</span>
        </td>

        {/* Portfolios */}
        <td className="px-3 py-2.5 text-center">
          <span className="text-sm font-medium text-gray-700">{portfolioCount}</span>
        </td>

        {/* Risk */}
        <td className="px-3 py-2.5 text-center">
          {riskFlags.length > 0 ? (
            <RiskPill flags={riskFlags} onClick={onRiskClick} />
          ) : (
            <span className="text-gray-300">&mdash;</span>
          )}
        </td>

        {/* Actions */}
        <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1 justify-end">
            {isOrgAdmin && !isCurrentUser && (
              <>
                {onManageRoles && !isSuspended && (
                  <button
                    onClick={onManageRoles}
                    className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 rounded transition-colors whitespace-nowrap"
                  >
                    Manage roles
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}
                {isSuspended ? (
                  <button
                    onClick={onReactivate}
                    className="px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 rounded transition-colors whitespace-nowrap"
                  >
                    Reactivate access
                  </button>
                ) : (
                  <button
                    onClick={onSuspend}
                    className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors whitespace-nowrap"
                  >
                    <UserX className="w-3 h-3" />
                    Suspend access
                  </button>
                )}
              </>
            )}
          </div>
        </td>
      </tr>

      {/* Expanded detail row */}
      {isExpanded && (
        <tr>
          <td colSpan={7} className="px-0 py-0">
            <div className="px-4 pb-3 pt-2 ml-[52px] border-t border-gray-100 space-y-2 bg-gray-50/30">
              {/* Profile tags */}
              {(member.title || member.profile) && (
                <div className="flex flex-wrap gap-2 text-xs">
                  {member.title && (
                    <div className="flex items-center gap-1">
                      <span className="text-gray-500">Title:</span>
                      <span className="text-gray-700">{member.title}</span>
                    </div>
                  )}
                  {member.profile && renderProfileTags(member.profile, formatProfileValue)}
                </div>
              )}

              {/* Suspension info */}
              {isSuspended && member.suspended_at && (
                <div className="flex items-center gap-1 text-xs text-amber-600">
                  <Clock className="w-3 h-3" />
                  <span>Suspended {new Date(member.suspended_at).toLocaleDateString()}</span>
                  {member.suspension_reason && (
                    <span className="italic">— {member.suspension_reason}</span>
                  )}
                </div>
              )}

              {/* Actions row */}
              {isOrgAdmin && !isCurrentUser && (
                <div className="flex items-center gap-2 pt-1">
                  {onManageRoles && !isSuspended && (
                    <button
                      onClick={onManageRoles}
                      className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded transition-colors"
                    >
                      Manage roles
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                  {isSuspended ? (
                    <button
                      onClick={onReactivate}
                      className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded transition-colors"
                    >
                      Reactivate access
                    </button>
                  ) : (
                    <button
                      onClick={onSuspend}
                      className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-amber-600 bg-amber-50 hover:bg-amber-100 rounded transition-colors"
                    >
                      <UserX className="w-3 h-3" />
                      Suspend access
                    </button>
                  )}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  )
}

// ─── Profile tag renderer ────────────────────────────────────────────────

function renderProfileTags(profileInfo: UserProfileData, format: (v: string) => string) {
  const tags: React.ReactNode[] = []

  const addTag = (key: string, label: string, values: string[], style: string) => {
    if (values.length === 0) return
    tags.push(
      <div key={key} className="flex items-center gap-1 flex-wrap">
        <span className="text-gray-500">{label}:</span>
        {values.map((v) => (
          <span key={v} className={`px-1.5 py-0.5 rounded ${style}`}>{format(v)}</span>
        ))}
      </div>
    )
  }

  if (profileInfo.user_type === 'investor') {
    addTag('sectors', 'Sectors', profileInfo.sector_focus || [], 'bg-emerald-50 text-emerald-600')
    addTag('style', 'Style', profileInfo.investment_style || [], 'bg-indigo-50 text-indigo-600')
    addTag('mcap', 'Market Cap', profileInfo.market_cap_focus || [], 'bg-cyan-50 text-cyan-600')
    addTag('geo', 'Geography', profileInfo.geography_focus || [], 'bg-orange-50 text-orange-600')
    addTag('horizon', 'Horizon', profileInfo.time_horizon || [], 'bg-violet-50 text-violet-600')
  }
  if (profileInfo.user_type === 'operations') {
    addTag('depts', 'Departments', profileInfo.ops_departments || [], 'bg-blue-50 text-blue-600')
  }
  if (profileInfo.user_type === 'compliance') {
    addTag('areas', 'Areas', profileInfo.compliance_areas || [], 'bg-amber-50 text-amber-600')
  }

  return tags
}
