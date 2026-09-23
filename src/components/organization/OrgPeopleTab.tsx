/**
 * OrgPeopleTab — "Members" directory tab.
 *
 * Lightweight member directory focused on identity + seats + status + basic
 * admin actions. Role / access changes live in Governance tab.
 *
 * Layout:
 *   Header: subtitle + search + seat counts + Invite button
 *
 * Invitation authority is NOT org-admin status. During Professional Early
 * Access only platform administrators may invite, so the Invite control is
 * gated on can_invite_members() while everything else on this tab stays gated
 * on isOrgAdmin. An org admin still sees who is pending; they just cannot add
 * to the list or take anyone off it.
 *   Table: name/email, status pill, role pill, mini metrics, actions
 *   Contacts sub-view (toggle)
 */

import React, { useState } from 'react'
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { logOrgActivity } from '../../lib/org-activity-log'
import { useAuth } from '../../hooks/useAuth'
import { useCanInviteMembers } from '../../hooks/useCanInviteMembers'
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
  MoreHorizontal,
  X,
} from 'lucide-react'
import { useIsMobile } from '../../hooks/useMediaQuery'
import { FilterSelect } from './FilterSelect'

/*
  The status filter's options, in one place.

  The phone renders them as a sheet and the desktop as a native `<select>`;
  defining the labels once means the two cannot drift into saying different
  things for the same filter.
*/
type StatusFilter = 'all' | 'active' | 'invited' | 'suspended'
const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: 'All statuses',
  active: 'Active',
  invited: 'Invited',
  suspended: 'Suspended',
}
/*
  Only these three are offered, on both form factors.

  `invited` is a valid filter value the type allows but the control has never
  offered — adding it here because the map happened to contain it would be a
  behaviour change smuggled in behind a styling fix.
*/
const STATUS_FILTER_OPTIONS: StatusFilter[] = ['all', 'active', 'suspended']
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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const { canInvite } = useCanInviteMembers()
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteSelectedNodes, setInviteSelectedNodes] = useState<string[]>([])
  const [inviteSelectedPortfolios, setInviteSelectedPortfolios] = useState<string[]>([])
  const [reactivateTarget, setReactivateTarget] = useState<OrganizationMembership | null>(null)
  const [reactivateReason, setReactivateReason] = useState('')
  const isMobile = useIsMobile()
  /** Phone only: the member whose action sheet is open. */
  const [actionMenuMember, setActionMenuMember] = useState<OrganizationMembership | null>(null)
  const [suspendTarget, setSuspendTarget] = useState<OrganizationMembership | null>(null)
  const [suspendReason, setSuspendReason] = useState('')

  // ─── Pending invites query (admin only) ───────────────────────
  const { data: pendingInvites = [] } = useQuery({
    queryKey: ['organization-invites', organization?.id],
    queryFn: async () => {
      // Explicit columns: `token` is not readable by any client role, so
      // `select('*')` is a permission error now.
      const { data, error } = await supabase
        .from('organization_invites')
        .select('id, organization_id, email, status, created_at, expires_at, invited_is_org_admin')
        .eq('organization_id', organization!.id)
        .in('status', ['pending', 'sent'])
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as OrganizationInvite[]
    },
    enabled: isOrgAdmin && !!organization?.id,
  })

  const createInviteMutation = useMutation({
    mutationFn: async ({ email, nodeIds, portfolioIds }: { email: string; nodeIds: string[]; portfolioIds: string[] }) => {
      // Build preassignments JSONB
      const preassignments: any = {}
      if (nodeIds.length > 0) {
        preassignments.org_nodes = nodeIds.map(id => ({ node_id: id, role: 'member' }))
      }
      if (portfolioIds.length > 0) {
        preassignments.portfolios = portfolioIds.map(id => ({ portfolio_id: id, role: 'analyst' }))
      }

      // Preassignments travel with the create call. They used to be applied by
      // a follow-up UPDATE from here, which keyed off `data.id` while the RPC
      // returns `invite_id` — so they were silently dropped on every invite.
      // The browser also no longer holds UPDATE on the table.
      const { data, error } = await supabase.rpc('create_org_invite', {
        p_organization_id: organization!.id,
        p_email: email.trim().toLowerCase(),
        p_is_org_admin: false,
        p_preassignments: Object.keys(preassignments).length > 0 ? preassignments : null,
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
          details: { email: inviteEmail.trim().toLowerCase(), preassignments: { nodeIds: inviteSelectedNodes, portfolioIds: inviteSelectedPortfolios } },
        })
      }
      setInviteEmail('')
      setInviteSelectedNodes([])
      setInviteSelectedPortfolios([])
      setShowInviteModal(false)
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to send invite')
    },
  })

  const cancelInviteMutation = useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await supabase.rpc('revoke_org_invite', { p_invite_id: inviteId })
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
    <div className="max-w-5xl mx-auto space-y-2.5 sm:space-y-4">
      {/* ── Header: subtitle + search + seats + invite ── */}
      <div className="space-y-2 sm:space-y-3">
        {/* Title and the one primary action share the top row; the seat
            counts drop below it on a phone, where they were competing with
            Invite for a width neither could have. */}
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-semibold leading-tight text-gray-900 dark:text-white">Members</h2>
            <p className="hidden sm:block text-xs text-gray-500 mt-0.5 dark:text-gray-400">Invite, suspend, and manage organization membership</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:contents">
              <SeatSummaryBar seats={{ active: activeCount, invited: invitedCount, suspended: suspendedCount }} />
            </span>
            {canInvite && (
              /* `no-touch-target tap-pad`: the global coarse-pointer rule in
                 index.css gives every button a 44px *box*, which is what made
                 this read as a thick slab and set the height of the whole
                 title row. The drawn button goes back to its own size; the
                 44px stays as an invisible hit region around it. */
              <Button
                size="sm"
                onClick={() => setShowInviteModal(true)}
                className="no-touch-target tap-pad shrink-0 max-sm:py-1"
              >
                <Send className="w-3.5 h-3.5 mr-1.5" />
                Invite
              </Button>
            )}
          </div>
        </div>

        {/* Seat counts, on their own quiet line below the title. */}
        <div className="sm:hidden">
          <SeatSummaryBar seats={{ active: activeCount, invited: invitedCount, suspended: suspendedCount }} />
        </div>

        {/* Search + filters.

            One row put a search input, a status select and a two-button mode
            switch into ~326px, which is how the search ended up a square.
            Search takes its own row on a phone; the filter and the mode
            switch share the next one. */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:flex-1 sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search members..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-1.5 sm:py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm dark:border-gray-600"
            />
          </div>

          {/* Status filter.

              A button on a phone rather than a native `select`, so it can
              match the Members/Contacts pills beside it. It cannot as a
              select: index.css forces every select to `16px !important`
              below 768px to stop iOS zooming the page on focus, and that
              guard is worth more than the typography. A button is outside
              that rule, opens our own sheet, and never triggers the zoom.

              Desktop keeps the native select, where the rule does not apply
              and a select is the right control. */}
          <FilterSelect
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as StatusFilter)}
            options={STATUS_FILTER_OPTIONS.map(key => ({ value: key, label: STATUS_FILTER_LABELS[key] }))}
            ariaLabel="Filter members by status"
            sheetTitle="Filter by status"
            className="min-w-0 shrink rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-indigo-500 dark:border-gray-600"
          />

          {/* View toggle: Members / Contacts */}
          <div className="inline-flex shrink-0 items-center bg-gray-100 rounded p-0.5 ml-auto dark:bg-gray-800">
            <button
              onClick={() => setPeopleView('users')}
              className={`no-touch-target tap-pad whitespace-nowrap px-2.5 sm:px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                peopleView === 'users'
                  ? 'bg-white text-gray-900 shadow-sm dark:text-white dark:bg-gray-800'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 dark:text-gray-400'
              }`}
            >
              Members
              <span className="ml-1 text-gray-400">{totalCount}</span>
            </button>
            <button
              onClick={() => setPeopleView('contacts')}
              className={`no-touch-target tap-pad whitespace-nowrap px-2.5 sm:px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                peopleView === 'contacts'
                  ? 'bg-white text-gray-900 shadow-sm dark:text-white dark:bg-gray-800'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 dark:text-gray-400'
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
                      <p className="text-sm font-medium text-gray-900 truncate dark:text-white">{invite.email}</p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">
                        Sent {new Date(invite.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusPill status="invited" />
                    {canInvite && (
                      <button
                        onClick={() => cancelInviteMutation.mutate(invite.id)}
                        disabled={cancelInviteMutation.isPending}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                        title="Revoke invite"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Member rows */}
          {displayMembers.length > 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden dark:border-gray-700 dark:bg-gray-800">
              {/* One person, one row.

                  Collapsing columns got the table to fit, but it was still a
                  table: the actions cell sat past the right edge, so Manage
                  roles and Suspend were reachable only by expanding a row
                  into a full-width band that detached them from the person
                  they belonged to. A list row carries the same data and puts
                  the actions behind one ⋯ beside the name. Desktop keeps the
                  table, where the analytical columns earn their place. */}
              {isMobile ? (
                <div data-slot="member-list" className="divide-y divide-gray-100 dark:divide-gray-800">
                  {displayMembers.map((member) => {
                    const isSuspended = member.status === 'suspended'
                    const canAct = isOrgAdmin && member.user_id !== user?.id
                    return (
                      <div key={member.id} className="flex items-center gap-2 px-3">
                        <button
                          type="button"
                          onClick={() => member.user_id && onUserClick?.({
                            id: member.user_id,
                            full_name: member.user?.full_name || 'Unknown',
                          })}
                          disabled={!onUserClick || !member.user_id}
                          className="flex min-h-[56px] min-w-0 flex-1 items-center gap-2.5 py-2 text-left active:bg-gray-50 disabled:active:bg-transparent dark:active:bg-gray-900"
                        >
                          <span
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                              isSuspended ? 'bg-gray-400' : member.is_org_admin ? 'bg-indigo-600' : 'bg-gray-500'
                            }`}
                          >
                            <span className="text-[11px] font-semibold text-white">
                              {(member.user?.full_name || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                            </span>
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-medium text-gray-900 dark:text-white">
                                {member.user?.full_name}
                              </span>
                              <StatusPill status={isSuspended ? 'suspended' : 'active'} />
                            </span>
                            <span className="block truncate text-[11px] text-gray-400">{member.user?.email}</span>
                          </span>
                        </button>

                        {/* Actions live beside the person, not in a band
                            below them. Opening the menu is a different
                            intent from opening the person, so it is its own
                            control rather than part of the row. */}
                        {canAct && (
                          <button
                            type="button"
                            onClick={() => setActionMenuMember(member)}
                            aria-label={`Actions for ${member.user?.full_name || 'member'}`}
                            className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg text-gray-400 active:bg-gray-100 dark:active:bg-gray-700"
                          >
                            <MoreHorizontal className="h-5 w-5" />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
              <div className="sm:mobile-scroll-x sm:show-scrollbar">
              <table className="w-full min-w-0">
                <thead>
                  <tr className="bg-gray-50/80 border-b border-gray-200 dark:border-gray-700">
                    <th className="px-3 sm:px-4 py-1.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider sm:w-[40%]">Name</th>
                    <th className="px-2 sm:px-3 py-1.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Status</th>
                    <th className="hidden sm:table-cell px-3 py-1.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Org Role</th>
                    <th className="hidden sm:table-cell px-3 py-1.5 text-center text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Teams</th>
                    <th className="hidden sm:table-cell px-3 py-1.5 text-center text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Portfolios</th>
                    <th className="hidden sm:table-cell px-3 py-1.5 text-center text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Risk</th>
                    <th className="px-4 py-1.5 text-right text-[10px] font-semibold text-gray-400 uppercase tracking-wider"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
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
              </div>
              )}

              {hasNextPage && (
                <button
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="w-full px-4 py-2.5 text-sm text-indigo-600 hover:bg-indigo-50 transition-colors font-medium border-t border-gray-100 dark:border-gray-800"
                >
                  {isFetchingNextPage
                    ? 'Loading...'
                    : `Show more (${totalCount - allMembers.length} remaining)`}
                </button>
              )}
            </div>
          ) : (
            <div className="text-center py-12 bg-gray-50 rounded-lg dark:bg-gray-900">
              <UserCircle className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400">No members match your search</p>
            </div>
          )}
        </div>
      )}

      {/* ── Contacts sub-view ── */}
      {peopleView === 'contacts' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500 dark:text-gray-400">
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
            <div className="text-center py-12 bg-gray-50 rounded-lg dark:bg-gray-900">
              <AtSign className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2 dark:text-white">No contacts yet</h3>
              <p className="text-sm text-gray-500 mb-4 dark:text-gray-400">
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
                          <span className="font-medium text-gray-900 dark:text-white">{contact.full_name}</span>
                          <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full capitalize dark:text-gray-400 dark:bg-gray-800">
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
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            {contact.title}{contact.company ? ` at ${contact.company}` : ''}
                          </p>
                        )}
                        <div className="flex items-center space-x-4 mt-2 text-sm text-gray-500 dark:text-gray-400">
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
                          <p className="text-sm text-gray-500 mt-2 italic dark:text-gray-400">"{contact.notes}"</p>
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

      {/* ── Member action sheet (phone) ──

          The same actions the desktop row carries, as a sheet rather than a
          full-width band inserted under the person. Nothing new is offered
          here; the destructive one keeps its own styling and still routes to
          the existing confirmation rather than acting on tap. */}
      {actionMenuMember && isMobile && (() => {
        const target = actionMenuMember
        const isSuspended = target.status === 'suspended'
        const close = () => setActionMenuMember(null)
        return (
          <div className="fixed inset-0 z-[70] flex items-end" role="dialog" aria-modal="true" aria-label="Member actions">
            <div className="absolute inset-0 bg-black/40" onClick={close} />
            <div className="relative w-full rounded-t-xl bg-white pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] shadow-2xl dark:bg-gray-800">
              <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-gray-900 dark:text-white">
                    {target.user?.full_name}
                  </span>
                  <span className="block truncate text-[11px] text-gray-400">{target.user?.email}</span>
                </span>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close"
                  className="no-touch-target tap-pad rounded p-1 text-gray-400"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="py-1">
                {onNavigateToGovernance && !isSuspended && (
                  <button
                    type="button"
                    onClick={() => { close(); onNavigateToGovernance(target.user_id) }}
                    className="flex w-full min-h-[48px] items-center gap-2.5 px-4 text-left text-sm text-gray-700 active:bg-gray-50 dark:text-gray-200 dark:active:bg-gray-700"
                  >
                    <UserCircle className="h-4 w-4 shrink-0 text-gray-400" />
                    Manage roles
                  </button>
                )}
                {isSuspended ? (
                  <button
                    type="button"
                    onClick={() => { close(); setReactivateTarget(target) }}
                    className="flex w-full min-h-[48px] items-center gap-2.5 px-4 text-left text-sm text-emerald-700 active:bg-emerald-50"
                  >
                    <Check className="h-4 w-4 shrink-0" />
                    Reactivate access
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => { close(); setSuspendTarget(target) }}
                    className="flex w-full min-h-[48px] items-center gap-2.5 px-4 text-left text-sm text-amber-700 active:bg-amber-50"
                  >
                    <UserX className="h-4 w-4 shrink-0" />
                    Suspend access
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Suspend Access Confirmation ── */}
      {suspendTarget && (() => {
        const isLastAdmin = suspendTarget.is_org_admin && activeOrgAdminCount <= 1
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40" onClick={() => { setSuspendTarget(null); setSuspendReason('') }} />
            <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6 mx-4 dark:bg-gray-800">
              <h3 className="text-lg font-semibold text-gray-900 mb-1 dark:text-white">
                Suspend access for {suspendTarget.user?.full_name}?
              </h3>
              <p className="text-sm text-gray-500 mb-4 dark:text-gray-400">
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

              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">
                Reason <span className="text-gray-400">(optional)</span>
              </label>
              <textarea
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
                placeholder="e.g. Left the team, compliance review..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent text-sm dark:border-gray-600"
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
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6 mx-4 dark:bg-gray-800">
            <h3 className="text-lg font-semibold text-gray-900 mb-1 dark:text-white">
              Reactivate access for {reactivateTarget.user?.full_name}?
            </h3>
            <p className="text-sm text-gray-500 mb-4 dark:text-gray-400">
              They will regain access to the organization and their previous role assignments.
            </p>
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">
              Reason <span className="text-gray-400">(optional)</span>
            </label>
            <input
              type="text"
              value={reactivateReason}
              onChange={(e) => setReactivateReason(e.target.value)}
              placeholder="e.g. Suspension reviewed, access restored"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm dark:border-gray-600"
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
        <InviteModal
          orgName={organization?.name || 'the organization'}
          orgId={organization?.id || ''}
          email={inviteEmail}
          setEmail={setInviteEmail}
          selectedNodes={inviteSelectedNodes}
          setSelectedNodes={setInviteSelectedNodes}
          selectedPortfolios={inviteSelectedPortfolios}
          setSelectedPortfolios={setInviteSelectedPortfolios}
          isPending={createInviteMutation.isPending}
          onSubmit={() => {
            if (inviteEmail.trim()) createInviteMutation.mutate({ email: inviteEmail, nodeIds: inviteSelectedNodes, portfolioIds: inviteSelectedPortfolios })
          }}
          onClose={() => { setShowInviteModal(false); setInviteEmail(''); setInviteSelectedNodes([]); setInviteSelectedPortfolios([]) }}
        />
      )}
    </div>
  )
}

// ─── InviteModal — enhanced invite with org node + portfolio preassignment ──

import { Building2, Briefcase, Check } from 'lucide-react'

function InviteModal({ orgName, orgId, email, setEmail, selectedNodes, setSelectedNodes, selectedPortfolios, setSelectedPortfolios, isPending, onSubmit, onClose }: {
  orgName: string; orgId: string
  email: string; setEmail: (v: string) => void
  selectedNodes: string[]; setSelectedNodes: (v: string[]) => void
  selectedPortfolios: string[]; setSelectedPortfolios: (v: string[]) => void
  isPending: boolean; onSubmit: () => void; onClose: () => void
}) {
  // Fetch org chart nodes
  const { data: orgNodes = [] } = useQuery({
    queryKey: ['invite-org-nodes', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_chart_nodes')
        .select('id, name, node_type, parent_id, color')
        .eq('organization_id', orgId)
        .order('name')
      if (error) throw error
      return data || []
    },
    enabled: !!orgId,
  })

  // Fetch portfolios
  const { data: portfolios = [] } = useQuery({
    queryKey: ['invite-portfolios', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolios')
        .select('id, name, portfolio_id')
        .order('name')
      if (error) throw error
      return data || []
    },
    enabled: !!orgId,
  })

  const toggleNode = (id: string) => {
    setSelectedNodes(selectedNodes.includes(id) ? selectedNodes.filter(n => n !== id) : [...selectedNodes, id])
  }

  const togglePortfolio = (id: string) => {
    setSelectedPortfolios(selectedPortfolios.includes(id) ? selectedPortfolios.filter(p => p !== id) : [...selectedPortfolios, id])
  }

  // Group nodes by type
  const nodesByType: Record<string, typeof orgNodes> = {}
  for (const n of orgNodes) {
    const type = n.node_type || 'other'
    if (!nodesByType[type]) nodesByType[type] = []
    nodesByType[type].push(n)
  }

  const nodeTypeLabel: Record<string, string> = { division: 'Divisions', department: 'Departments', team: 'Teams', portfolio: 'Portfolios' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-viewport-85 flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Invite User</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Send an invitation to join {orgName}. Optionally pre-assign teams and portfolios.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
              autoFocus
              required
            />
          </div>

          {/* Org Structure */}
          {orgNodes.length > 0 && (
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                <Building2 className="w-4 h-4" />
                Teams & Structure
                <span className="text-xs text-gray-400 font-normal ml-1">(optional)</span>
              </label>
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg max-h-48 overflow-y-auto">
                {Object.entries(nodesByType).map(([type, nodes]) => (
                  <div key={type}>
                    <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-700/50 text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 sticky top-0">
                      {nodeTypeLabel[type] || type}
                    </div>
                    {nodes.map(node => {
                      const selected = selectedNodes.includes(node.id)
                      return (
                        <button
                          key={node.id}
                          type="button"
                          onClick={() => toggleNode(node.id)}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${selected ? 'bg-indigo-50 dark:bg-indigo-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'}`}
                        >
                          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${selected ? 'bg-indigo-500 border-indigo-500' : 'border-gray-300 dark:border-gray-600'}`}>
                            {selected && <Check className="w-3 h-3 text-white" />}
                          </div>
                          {node.color && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: node.color }} />}
                          <span className="text-gray-900 dark:text-white truncate">{node.name}</span>
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
              {selectedNodes.length > 0 && (
                <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-1">{selectedNodes.length} selected</p>
              )}
            </div>
          )}

          {/* Portfolios */}
          {portfolios.length > 0 && (
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                <Briefcase className="w-4 h-4" />
                Portfolio Access
                <span className="text-xs text-gray-400 font-normal ml-1">(optional)</span>
              </label>
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg max-h-48 overflow-y-auto">
                {portfolios.map(p => {
                  const selected = selectedPortfolios.includes(p.id)
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => togglePortfolio(p.id)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${selected ? 'bg-indigo-50 dark:bg-indigo-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'}`}
                    >
                      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${selected ? 'bg-indigo-500 border-indigo-500' : 'border-gray-300 dark:border-gray-600'}`}>
                        {selected && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <Briefcase className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                      <span className="text-gray-900 dark:text-white truncate">{p.name}</span>
                      {p.portfolio_id && <span className="text-xs text-gray-400 ml-auto shrink-0">{p.portfolio_id}</span>}
                    </button>
                  )
                })}
              </div>
              {selectedPortfolios.length > 0 && (
                <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-1">{selectedPortfolios.length} selected</p>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onSubmit} disabled={!email.trim() || isPending}>
            <Send className="w-3.5 h-3.5 mr-1.5" />
            {isPending ? 'Sending...' : 'Send Invite'}
          </Button>
        </div>
      </div>
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
  low: 'bg-gray-100 text-gray-600 border-gray-200 dark:border-gray-700 dark:text-gray-400 dark:bg-gray-800',
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
        <td className="px-3 sm:px-4 py-2.5">
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
                <span className="text-sm font-medium text-gray-900 truncate dark:text-white">{member.user?.full_name}</span>
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

        {/* Org Role. These four columns are desktop-only — see the header. */}
        <td className="hidden sm:table-cell px-3 py-2.5">
          {member.is_org_admin ? (
            <RoleBadge role="org-admin" compact />
          ) : member.user?.coverage_admin ? (
            <RoleBadge role="coverage-admin" compact />
          ) : (
            <RoleBadge role="member" compact />
          )}
        </td>

        {/* Teams */}
        <td className="hidden sm:table-cell px-3 py-2.5 text-center">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{teamCount}</span>
        </td>

        {/* Portfolios */}
        <td className="hidden sm:table-cell px-3 py-2.5 text-center">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{portfolioCount}</span>
        </td>

        {/* Risk */}
        <td className="hidden sm:table-cell px-3 py-2.5 text-center">
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
            <div className="px-4 pb-3 pt-2 ml-[52px] border-t border-gray-100 space-y-2 bg-gray-50/30 dark:border-gray-800">
              {/* Profile tags */}
              {(member.title || member.profile) && (
                <div className="flex flex-wrap gap-2 text-xs">
                  {member.title && (
                    <div className="flex items-center gap-1">
                      <span className="text-gray-500 dark:text-gray-400">Title:</span>
                      <span className="text-gray-700 dark:text-gray-300">{member.title}</span>
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
        <span className="text-gray-500 dark:text-gray-400">{label}:</span>
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
