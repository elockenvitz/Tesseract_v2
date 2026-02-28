/**
 * OrgAuthorityMap — Access Matrix component for the Access hub.
 *
 * Displays a table of org members with expandable access breakdowns.
 * View mode is clean and read-only. Edit mode (ORG_ADMIN only) provides
 * controlled mutations with explicit confirmation dialogs.
 */

import React, { useState, useCallback, useMemo } from 'react'
import {
  Search,
  ChevronRight,
  ChevronDown,
  Shield,
  AlertTriangle,
  AlertCircle,
  Info,
  Pencil,
  X,
  UserX,
  UserCheck,
} from 'lucide-react'
import type { OrgGraph } from '../../lib/org-graph'
import type { OrgPermissions } from '../../lib/permissions/orgGovernance'
import {
  filterAuthorityRows,
  type AuthorityRow,
  type AuthoritySummary,
  type AuthorityFilter,
  type UserRiskFlag,
} from '../../lib/authority-map'

// ─── Props ───────────────────────────────────────────────────────────────

interface OrgAuthorityMapProps {
  rows: AuthorityRow[]
  summary: AuthoritySummary
  orgPerms: OrgPermissions
  orgGraph: OrgGraph
  orgMembers: any[]
  onToggleOrgAdmin?: (userId: string, newValue: boolean) => void
  onToggleGlobalCoverageAdmin?: (userId: string, newValue: boolean) => void
  onToggleNodeCoverageAdmin?: (memberId: string, newValue: boolean) => void
  isMutating?: boolean
  onOpenNodeModal?: (nodeId: string) => void
  // Initial filter state (for deep-linking)
  initialFilter?: AuthorityFilter
  initialSearch?: string
  initialTeamNodeId?: string
  // Seat meter counts
  invitedCount?: number
  suspendedCount?: number
  // Suspend/reactivate callbacks
  onSuspendUser?: (userId: string) => void
  onReactivateUser?: (userId: string) => void
}

// ─── Role chip colors ────────────────────────────────────────────────────

/** Administrative roles get strong styling; functional roles get muted styling. */
const AUTHORITY_CHIPS: Record<string, string> = {
  'Org Admin': 'bg-indigo-100 text-indigo-700 font-semibold',
  'Coverage Admin': 'bg-purple-100 text-purple-700 font-semibold',
  'PM': 'bg-blue-100 text-blue-700 font-semibold',
}

function getChipColor(chip: string): string {
  return AUTHORITY_CHIPS[chip] || 'bg-gray-100 text-gray-500'
}

// ─── Collapsible Section ─────────────────────────────────────────────────

function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-xs font-medium text-gray-700 hover:text-gray-900 w-full text-left py-0.5"
      >
        <Chevron className="w-3 h-3 text-gray-400 flex-shrink-0" />
        {title}
      </button>
      {open && <div className="ml-4.5 mt-1.5">{children}</div>}
    </div>
  )
}

// ─── Confirmation Dialog (inline) ────────────────────────────────────────

function ConfirmationBanner({
  message,
  onConfirm,
  onCancel,
  destructive = false,
}: {
  message: string
  onConfirm: () => void
  onCancel: () => void
  destructive?: boolean
}) {
  return (
    <div className={`flex items-center gap-3 px-3 py-2 rounded-md border text-xs ${
      destructive
        ? 'bg-red-50 border-red-200 text-red-800'
        : 'bg-amber-50 border-amber-200 text-amber-800'
    }`}>
      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="flex-1">{message}</span>
      <button
        onClick={onConfirm}
        className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors ${
          destructive
            ? 'bg-red-600 text-white border-red-600 hover:bg-red-700'
            : 'bg-amber-600 text-white border-amber-600 hover:bg-amber-700'
        }`}
      >
        Confirm
      </button>
      <button
        onClick={onCancel}
        className="px-2.5 py-1 rounded text-[11px] font-medium border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
      >
        Cancel
      </button>
    </div>
  )
}

// ─── Role summary helpers ────────────────────────────────────────────────

function summarizeRoles(items: Array<{ role: string }>): string {
  const counts = new Map<string, number>()
  for (const item of items) {
    counts.set(item.role, (counts.get(item.role) || 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([role, count]) => `${count} ${role}`)
    .join(' \u00b7 ')
}

// ─── Admin vs functional role sets ───────────────────────────────────────

const ADMIN_ROLES = new Set(['Org Admin', 'Coverage Admin'])

/** Short display labels for admin roles in the Admin Roles column. */
const ADMIN_SHORT_LABEL: Record<string, string> = {
  'Org Admin': 'Org',
  'Coverage Admin': 'Coverage',
}

/** Roles to hide from the Portfolio Roles column. */
const HIDDEN_FUNCTIONAL_ROLES = new Set(['Member'])

/** Sort order for functional role chips — lower = first. */
const FUNCTIONAL_ROLE_ORDER: Record<string, number> = {
  'PM': 0,
  'Analyst': 1,
}

function sortFunctionalRoles(a: string, b: string): number {
  return (FUNCTIONAL_ROLE_ORDER[a] ?? 99) - (FUNCTIONAL_ROLE_ORDER[b] ?? 99)
}

// ─── Risk severity icon ─────────────────────────────────────────────────

function SeverityIcon({ severity, className = 'w-3 h-3' }: { severity: string; className?: string }) {
  if (severity === 'high') return <AlertTriangle className={`${className} text-red-500`} />
  if (severity === 'medium') return <AlertCircle className={`${className} text-amber-500`} />
  return <Info className={`${className} text-gray-400`} />
}

// ─── Seat Meter ──────────────────────────────────────────────────────────

function SeatMeter({
  activeCount,
  invitedCount,
  suspendedCount,
}: {
  activeCount: number
  invitedCount: number
  suspendedCount: number
}) {
  const stats = [
    { label: 'Active', value: activeCount, color: 'text-emerald-700' },
    { label: 'Invited', value: invitedCount, color: 'text-blue-600' },
    { label: 'Suspended', value: suspendedCount, color: 'text-amber-600' },
  ]

  return (
    <div className="flex items-center gap-4 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
      <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">Seats</span>
      {stats.map(s => (
        <div key={s.label} className="flex items-baseline gap-1">
          <span className={`text-sm font-semibold ${s.color}`}>{s.value}</span>
          <span className="text-[10px] text-gray-400">{s.label}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Summary Strip ───────────────────────────────────────────────────────

function AuthoritySummaryStrip({ summary }: { summary: AuthoritySummary }) {
  const stats = [
    { label: 'Organization Admins', value: summary.orgAdminCount },
    {
      label: 'Coverage Admins',
      value: summary.globalCoverageAdminCount + summary.nodeCoverageAdminCount,
      sub: `${summary.globalCoverageAdminCount} Global, ${summary.nodeCoverageAdminCount} Scoped`,
    },
    { label: 'Portfolio Managers', value: summary.pmCount },
    {
      label: 'Governance Flags',
      value: summary.flaggedUserCount,
      sub: summary.flaggedUserCount > 0
        ? `${summary.riskBySeverity.high}H ${summary.riskBySeverity.medium}M ${summary.riskBySeverity.low}L`
        : undefined,
    },
  ]

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex flex-wrap gap-3">
      {stats.map(s => (
        <div key={s.label} className="bg-white border border-gray-200 rounded-md px-3 py-1.5 min-w-[100px]">
          <div className="text-gray-500 text-[11px] font-medium">{s.label}</div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-semibold text-gray-900">{s.value}</span>
            {s.sub && <span className="text-[10px] text-gray-400">({s.sub})</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Filter Bar ──────────────────────────────────────────────────────────

const FILTER_OPTIONS: { key: AuthorityFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'org_admin', label: 'Org Admin' },
  { key: 'coverage_admin', label: 'Coverage Admin' },
  { key: 'pm', label: 'PM' },
  { key: 'flagged', label: 'Flagged' },
]

function AuthorityFilterBar({
  search,
  onSearchChange,
  filter,
  onFilterChange,
  filteredCount,
  totalCount,
  statusFilter,
  onStatusFilterChange,
  teamFilter,
  onTeamFilterChange,
  teamOptions,
  portfolioFilter,
  onPortfolioFilterChange,
  portfolioOptions,
}: {
  search: string
  onSearchChange: (v: string) => void
  filter: AuthorityFilter
  onFilterChange: (v: AuthorityFilter) => void
  filteredCount: number
  totalCount: number
  statusFilter: 'all' | 'active' | 'suspended'
  onStatusFilterChange: (v: 'all' | 'active' | 'suspended') => void
  teamFilter: string
  onTeamFilterChange: (v: string) => void
  teamOptions: { id: string; name: string }[]
  portfolioFilter: string
  onPortfolioFilterChange: (v: string) => void
  portfolioOptions: { id: string; name: string }[]
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
          />
        </div>
        <div className="flex items-center gap-1">
          {FILTER_OPTIONS.map(f => (
            <button
              key={f.key}
              onClick={() => onFilterChange(f.key)}
              className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors ${
                filter === f.key
                  ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 border border-transparent'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-400 ml-auto">
          {filteredCount} of {totalCount} members
        </span>
      </div>
      {/* Dropdown filters row */}
      <div className="flex items-center gap-2">
        <select
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value as 'all' | 'active' | 'suspended')}
          className="text-xs border border-gray-200 rounded px-2 py-1 bg-white text-gray-600 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        {teamOptions.length > 0 && (
          <select
            value={teamFilter}
            onChange={(e) => onTeamFilterChange(e.target.value)}
            className="text-xs border border-gray-200 rounded px-2 py-1 bg-white text-gray-600 focus:ring-2 focus:ring-indigo-500 focus:border-transparent max-w-[180px]"
          >
            <option value="">All teams</option>
            {teamOptions.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}
        {portfolioOptions.length > 0 && (
          <select
            value={portfolioFilter}
            onChange={(e) => onPortfolioFilterChange(e.target.value)}
            className="text-xs border border-gray-200 rounded px-2 py-1 bg-white text-gray-600 focus:ring-2 focus:ring-indigo-500 focus:border-transparent max-w-[180px]"
          >
            <option value="">All portfolios</option>
            {portfolioOptions.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  )
}

// ─── Expanded Panel (View Mode) ──────────────────────────────────────────

function AuthorityExpandedPanel({
  row,
  orgPerms,
  orgMembers,
  onToggleOrgAdmin,
  onToggleGlobalCoverageAdmin,
  onToggleNodeCoverageAdmin,
  isMutating,
  onOpenNodeModal,
  onSuspendUser,
  onReactivateUser,
}: {
  row: AuthorityRow
  orgPerms: OrgPermissions
  orgMembers: any[]
  onToggleOrgAdmin?: (userId: string, newValue: boolean) => void
  onToggleGlobalCoverageAdmin?: (userId: string, newValue: boolean) => void
  onToggleNodeCoverageAdmin?: (memberId: string, newValue: boolean) => void
  isMutating?: boolean
  onOpenNodeModal?: (nodeId: string) => void
  onSuspendUser?: (userId: string) => void
  onReactivateUser?: (userId: string) => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<{
    key: string
    message: string
    destructive: boolean
    execute: () => void
  } | null>(null)

  const canEdit = orgPerms.canManageOrgStructure && (
    !!onToggleOrgAdmin || !!onToggleGlobalCoverageAdmin || !!onToggleNodeCoverageAdmin
  )
  const activeOrgAdminCount = orgMembers.filter((m: any) => m.is_org_admin).length
  const isLastAdmin = row.isOrgAdmin && activeOrgAdminCount <= 1

  // Set of nodeIds that have anchored risk flags
  const flaggedNodeIds = useMemo(() => {
    const ids = new Set<string>()
    for (const f of row.riskFlags) {
      if (f.anchorNodeId) ids.add(f.anchorNodeId)
    }
    return ids
  }, [row.riskFlags])

  // Coverage scope summary for the organization-level access section
  const coverageScopeSummary = useMemo(() => {
    const nodeScopes = row.coverageScopes.filter(cs => cs.type === 'node')
    if (row.isGlobalCoverageAdmin) return 'Global'
    if (nodeScopes.length === 0) return 'None'
    return `Subtree (${nodeScopes.length})`
  }, [row.coverageScopes, row.isGlobalCoverageAdmin])

  const nodeScopes = row.coverageScopes.filter(cs => cs.type === 'node')

  const handleRequestConfirm = useCallback((
    key: string,
    message: string,
    execute: () => void,
    destructive = true,
  ) => {
    setPendingConfirm({ key, message, destructive, execute })
  }, [])

  const handleConfirmExecute = useCallback(() => {
    pendingConfirm?.execute()
    setPendingConfirm(null)
  }, [pendingConfirm])

  const handleCancelConfirm = useCallback(() => {
    setPendingConfirm(null)
  }, [])

  const handleExitEdit = useCallback(() => {
    setIsEditing(false)
    setPendingConfirm(null)
  }, [])

  return (
    <div className="bg-gray-50/50 border-l-2 border-indigo-300 px-5 py-4 space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
            Access Breakdown
          </div>
          {row.status === 'suspended' && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-100 text-amber-700 border border-amber-200">
              Suspended
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Suspend / Reactivate buttons */}
          {canEdit && row.status === 'active' && onSuspendUser && (
            <button
              onClick={() => onSuspendUser(row.userId)}
              className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-amber-600 hover:text-amber-700 hover:bg-amber-50 rounded transition-colors"
            >
              <UserX className="w-3 h-3" />
              Suspend
            </button>
          )}
          {canEdit && row.status === 'suspended' && onReactivateUser && (
            <button
              onClick={() => onReactivateUser(row.userId)}
              className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded transition-colors"
            >
              <UserCheck className="w-3 h-3" />
              Reactivate
            </button>
          )}
          {canEdit && !isEditing && (
            <button
              onClick={() => setIsEditing(true)}
              className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded transition-colors"
            >
              <Pencil className="w-3 h-3" />
              Edit access
            </button>
          )}
          {isEditing && (
            <button
              onClick={handleExitEdit}
              className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
            >
              <X className="w-3 h-3" />
              Done editing
            </button>
          )}
        </div>
      </div>

      {/* ── Confirmation banner (if pending) ── */}
      {pendingConfirm && (
        <ConfirmationBanner
          message={pendingConfirm.message}
          onConfirm={handleConfirmExecute}
          onCancel={handleCancelConfirm}
          destructive={pendingConfirm.destructive}
        />
      )}

      {/* ── Section 1: ORGANIZATION-LEVEL ACCESS ── */}
      <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 space-y-2">
        <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
          Organization-Level Access
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Org Admin</span>
            <span className="flex items-center gap-1.5">
              {row.isOrgAdmin ? (
                <span className="font-medium text-indigo-700">Yes</span>
              ) : (
                <span className="text-gray-400">No</span>
              )}
              {isEditing && onToggleOrgAdmin && (
                row.isOrgAdmin ? (
                  <button
                    onClick={() => handleRequestConfirm(
                      'revoke-org-admin',
                      `Confirm removal of Organization Admin access from ${row.fullName}?`,
                      () => onToggleOrgAdmin(row.userId, false),
                    )}
                    disabled={isLastAdmin || isMutating}
                    className={`ml-1 px-1.5 py-0.5 text-[10px] rounded border transition-colors ${
                      isLastAdmin
                        ? 'text-gray-300 border-gray-200 cursor-not-allowed'
                        : 'text-red-600 border-red-200 hover:bg-red-50'
                    }`}
                    title={isLastAdmin ? 'Cannot remove the last organization admin' : undefined}
                  >
                    Remove
                  </button>
                ) : (
                  <button
                    onClick={() => handleRequestConfirm(
                      'grant-org-admin',
                      `Grant Organization Admin access to ${row.fullName}? This provides organization-wide administrative privileges.`,
                      () => onToggleOrgAdmin(row.userId, true),
                      false,
                    )}
                    disabled={isMutating}
                    className="ml-1 px-1.5 py-0.5 text-[10px] rounded border text-indigo-600 border-indigo-200 hover:bg-indigo-50 transition-colors"
                  >
                    Grant
                  </button>
                )
              )}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Coverage Admin</span>
            <span className="flex items-center gap-1.5">
              <span className={`font-medium ${
                coverageScopeSummary === 'Global' ? 'text-purple-700'
                  : coverageScopeSummary === 'None' ? 'text-gray-400'
                  : 'text-purple-600'
              }`}>
                {coverageScopeSummary}
              </span>
              {isEditing && onToggleGlobalCoverageAdmin && (
                row.isGlobalCoverageAdmin ? (
                  <button
                    onClick={() => handleRequestConfirm(
                      'revoke-global-ca',
                      `Confirm removal of Global Coverage access from ${row.fullName}?`,
                      () => onToggleGlobalCoverageAdmin(row.userId, false),
                    )}
                    disabled={isMutating}
                    className="ml-1 px-1.5 py-0.5 text-[10px] rounded border text-red-600 border-red-200 hover:bg-red-50 transition-colors"
                  >
                    Remove
                  </button>
                ) : (
                  <button
                    onClick={() => handleRequestConfirm(
                      'grant-global-ca',
                      `Grant Global Coverage access to ${row.fullName}? This provides organization-wide coverage oversight.`,
                      () => onToggleGlobalCoverageAdmin(row.userId, true),
                      false,
                    )}
                    disabled={isMutating}
                    className="ml-1 px-1.5 py-0.5 text-[10px] rounded border text-purple-600 border-purple-200 hover:bg-purple-50 transition-colors"
                  >
                    Grant
                  </button>
                )
              )}
            </span>
          </div>
        </div>
        {/* Coverage scope — only show detail if node-scoped */}
        {nodeScopes.length > 0 && (
          <div className="pt-1.5 border-t border-gray-100 mt-1">
            <div className="text-[10px] text-gray-400 mb-1">Coverage Scope</div>
            <div className="flex flex-wrap gap-1.5">
              {nodeScopes.map((scope, i) => (
                <span
                  key={i}
                  className={`text-[11px] text-gray-600 ${
                    onOpenNodeModal && scope.nodeId ? 'cursor-pointer hover:text-indigo-600' : ''
                  }`}
                  onClick={() => scope.nodeId && onOpenNodeModal?.(scope.nodeId)}
                >
                  {scope.nodePath && scope.nodePath.length > 0 && (
                    <span className="text-gray-400">
                      {scope.nodePath.join(' \u2192 ')} \u2192{' '}
                    </span>
                  )}
                  <span className="font-medium">{scope.nodeName || 'Unknown'}</span>
                  {i < nodeScopes.length - 1 && <span className="text-gray-300 ml-1.5">;</span>}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Section 2: TEAMS ── */}
      {row.teams.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
          <CollapsibleSection
            defaultOpen={row.teams.length <= 5}
            title={
              <span className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                  Teams ({row.teams.length})
                </span>
                <span className="text-[11px] text-gray-400 normal-case font-normal">
                  {summarizeRoles(row.teams)}
                </span>
              </span>
            }
          >
            <div className="space-y-1 mt-1">
              {row.teams.map(team => {
                const hasRisk = flaggedNodeIds.has(team.nodeId)
                return (
                  <div
                    key={team.nodeId}
                    className={`flex items-center gap-2 text-xs py-0.5 rounded ${
                      hasRisk ? 'bg-red-50/60 -mx-1 px-1' : ''
                    } ${onOpenNodeModal ? 'cursor-pointer hover:text-indigo-600' : 'text-gray-600'}`}
                    onClick={() => onOpenNodeModal?.(team.nodeId)}
                  >
                    {hasRisk && <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0" />}
                    <span className="font-medium">{team.nodeName}</span>
                    <span className={`px-1.5 py-0.5 text-[10px] rounded ${getChipColor(team.role)}`}>
                      {team.role}
                    </span>
                    {team.isCoverageAdmin && !team.coverageAdminBlocked && (
                      <span className="px-1 py-0.5 text-[10px] font-medium bg-purple-50 text-purple-600 rounded">
                        Coverage Admin
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </CollapsibleSection>
        </div>
      )}

      {/* ── Section 3: PORTFOLIOS ── */}
      {row.portfolios.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
          <CollapsibleSection
            defaultOpen={false}
            title={
              <span className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                  Portfolios ({row.portfolios.length})
                </span>
                <span className="text-[11px] text-gray-400 normal-case font-normal">
                  {summarizeRoles(row.portfolios)}
                </span>
              </span>
            }
          >
            <div className="space-y-1 mt-1">
              {row.portfolios.map(port => {
                const hasRisk = flaggedNodeIds.has(port.nodeId)
                return (
                  <div
                    key={port.nodeId}
                    className={`flex items-center gap-2 text-xs py-0.5 rounded ${
                      hasRisk ? 'bg-red-50/60 -mx-1 px-1' : ''
                    } text-gray-600`}
                  >
                    {hasRisk && <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0" />}
                    <span className="font-medium">{port.nodeName}</span>
                    <span className={`px-1.5 py-0.5 text-[10px] rounded ${getChipColor(port.role)}`}>
                      {port.role}
                    </span>
                    {port.parentTeamName && (
                      <span className="text-[10px] text-gray-400">via {port.parentTeamName}</span>
                    )}
                  </div>
                )
              })}
            </div>
          </CollapsibleSection>
        </div>
      )}

      {/* ── Section 4: GOVERNANCE RISKS ── */}
      {row.riskFlags.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
            Governance Risks
          </div>
          {row.riskFlags.map((flag, i) => (
            <RiskFlagBanner key={i} flag={flag} onOpenNodeModal={onOpenNodeModal} />
          ))}
        </div>
      ) : (
        <div className="text-[11px] text-gray-400 italic">No governance risks detected</div>
      )}
    </div>
  )
}

// ─── Risk flag banner ────────────────────────────────────────────────────

function RiskFlagBanner({
  flag,
  onOpenNodeModal,
}: {
  flag: UserRiskFlag
  onOpenNodeModal?: (nodeId: string) => void
}) {
  const colors = {
    high: 'bg-red-50 border-red-200 text-red-800',
    medium: 'bg-amber-50 border-amber-200 text-amber-800',
    low: 'bg-gray-50 border-gray-200 text-gray-600',
  }

  return (
    <div
      className={`flex items-start gap-2 px-3 py-2 rounded-md border text-xs ${colors[flag.severity]} ${
        flag.anchorNodeId && onOpenNodeModal ? 'cursor-pointer hover:opacity-90' : ''
      }`}
      onClick={() => flag.anchorNodeId && onOpenNodeModal?.(flag.anchorNodeId)}
    >
      <SeverityIcon severity={flag.severity} className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
      <div className="min-w-0">
        <div className="font-medium">{flag.label}</div>
        <div className="text-[11px] mt-0.5 opacity-80 leading-relaxed">{flag.detail}</div>
      </div>
    </div>
  )
}

// ─── Risk count badge (row-level) ────────────────────────────────────────

function RiskCountBadge({ flags }: { flags: UserRiskFlag[] }) {
  if (flags.length === 0) return null

  const worstSeverity = flags.some(f => f.severity === 'high')
    ? 'high'
    : flags.some(f => f.severity === 'medium')
    ? 'medium'
    : 'low'

  const styles = {
    high: 'bg-red-100 text-red-700 border-red-200',
    medium: 'bg-amber-100 text-amber-700 border-amber-200',
    low: 'bg-gray-100 text-gray-600 border-gray-200',
  }

  const topRisks = flags.slice(0, 3).map(f => f.label).join('\n')

  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded border ${styles[worstSeverity]}`}
      title={topRisks}
    >
      <SeverityIcon severity={worstSeverity} className="w-2.5 h-2.5" />
      {flags.length}
    </span>
  )
}

// ─── Authority Row ───────────────────────────────────────────────────────

function AuthorityRowComponent({
  row,
  isExpanded,
  onToggle,
}: {
  row: AuthorityRow
  isExpanded: boolean
  onToggle: () => void
}) {
  const Chevron = isExpanded ? ChevronDown : ChevronRight

  return (
    <tr
      className={`hover:bg-gray-50/50 cursor-pointer transition-colors ${
        row.status === 'suspended' ? 'opacity-60' : ''
      }`}
      onClick={onToggle}
    >
      {/* User */}
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Chevron className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-gray-900 truncate">{row.fullName}</span>
              {row.status === 'suspended' && (
                <span className="px-1 py-0.5 text-[9px] font-medium rounded bg-amber-100 text-amber-700">
                  Suspended
                </span>
              )}
            </div>
            <div className="text-xs text-gray-400 truncate">{row.email}</div>
          </div>
        </div>
      </td>
      {/* Admin Roles */}
      <td className="px-4 py-2.5">
        <div className="flex flex-wrap gap-1">
          {row.roleChips.filter(c => ADMIN_ROLES.has(c)).map(chip => (
            <span key={chip} className={`px-1.5 py-0.5 text-[11px] font-medium rounded ${getChipColor(chip)}`}>
              {ADMIN_SHORT_LABEL[chip] || chip}
            </span>
          ))}
          {!row.roleChips.some(c => ADMIN_ROLES.has(c)) && (
            <span className="text-gray-300">&mdash;</span>
          )}
        </div>
      </td>
      {/* Portfolio Roles */}
      <td className="px-4 py-2.5">
        {(() => {
          const visible = row.roleChips
            .filter(c => !ADMIN_ROLES.has(c) && !HIDDEN_FUNCTIONAL_ROLES.has(c))
            .sort(sortFunctionalRoles)
          const capped = visible.slice(0, 4)
          const overflow = visible.length - capped.length
          return (
            <div className="flex flex-wrap gap-1">
              {capped.map(chip => (
                <span key={chip} className={`px-1.5 py-0.5 text-[11px] font-medium rounded ${getChipColor(chip)}`}>
                  {chip}
                </span>
              ))}
              {overflow > 0 && (
                <span className="px-1.5 py-0.5 text-[11px] font-medium rounded bg-gray-100 text-gray-500">
                  +{overflow}
                </span>
              )}
              {capped.length === 0 && (
                <span className="text-gray-300">&mdash;</span>
              )}
            </div>
          )
        })()}
      </td>
      {/* Teams count */}
      <td className="px-4 py-2.5 text-center">
        {row.teams.length > 0 ? (
          <span className="text-sm font-medium text-gray-700">{row.teams.length}</span>
        ) : (
          <span className="text-gray-300">&mdash;</span>
        )}
      </td>
      {/* Portfolios count */}
      <td className="px-4 py-2.5 text-center">
        {row.portfolios.length > 0 ? (
          <span className="text-sm font-medium text-gray-700">{row.portfolios.length}</span>
        ) : (
          <span className="text-gray-300">&mdash;</span>
        )}
      </td>
      {/* Risk — count badge instead of dots */}
      <td className="px-4 py-2.5 text-center">
        <RiskCountBadge flags={row.riskFlags} />
      </td>
    </tr>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────

export function OrgAuthorityMap({
  rows,
  summary,
  orgPerms,
  orgGraph,
  orgMembers,
  onToggleOrgAdmin,
  onToggleGlobalCoverageAdmin,
  onToggleNodeCoverageAdmin,
  isMutating,
  onOpenNodeModal,
  initialFilter,
  initialSearch,
  initialTeamNodeId,
  invitedCount,
  suspendedCount,
  onSuspendUser,
  onReactivateUser,
}: OrgAuthorityMapProps) {
  const [search, setSearch] = useState(initialSearch || '')
  const [filter, setFilter] = useState<AuthorityFilter>(initialFilter || 'all')
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all')
  const [teamFilter, setTeamFilter] = useState(initialTeamNodeId || '')
  const [portfolioFilter, setPortfolioFilter] = useState('')

  // Compute unique team options from rows
  const teamOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of rows) {
      for (const t of row.teams) {
        if (!map.has(t.nodeId)) map.set(t.nodeId, t.nodeName)
      }
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [rows])

  // Compute unique portfolio options from rows
  const portfolioOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of rows) {
      for (const p of row.portfolios) {
        if (!map.has(p.nodeId)) map.set(p.nodeId, p.nodeName)
      }
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [rows])

  const filtered = filterAuthorityRows(
    rows,
    filter,
    search,
    undefined,
    statusFilter,
    teamFilter || undefined,
    portfolioFilter || undefined,
  )

  const handleToggleExpand = useCallback((userId: string) => {
    setExpandedUserId(prev => prev === userId ? null : userId)
  }, [])

  const showSeatMeter = invitedCount != null || suspendedCount != null

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-md bg-indigo-50 border border-indigo-200 flex items-center justify-center">
          <Shield className="w-4 h-4 text-indigo-600" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Access Matrix</h3>
          <p className="text-xs text-gray-500">Role assignments and access scope across the organization</p>
        </div>
      </div>

      {/* Seat Meter */}
      {showSeatMeter && (
        <SeatMeter
          activeCount={summary.totalUsers}
          invitedCount={invitedCount ?? 0}
          suspendedCount={suspendedCount ?? 0}
        />
      )}

      {/* Summary Strip */}
      <AuthoritySummaryStrip summary={summary} />

      {/* Filter Bar */}
      <AuthorityFilterBar
        search={search}
        onSearchChange={setSearch}
        filter={filter}
        onFilterChange={setFilter}
        filteredCount={filtered.length}
        totalCount={rows.length}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        teamFilter={teamFilter}
        onTeamFilterChange={setTeamFilter}
        teamOptions={teamOptions}
        portfolioFilter={portfolioFilter}
        onPortfolioFilterChange={setPortfolioFilter}
        portfolioOptions={portfolioOptions}
      />

      {/* Table */}
      <div className="border border-gray-200 rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50/80 border-b border-gray-200">
              <th className="px-4 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider min-w-[200px]">User</th>
              <th className="px-4 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider min-w-[140px]">Admin Roles</th>
              <th className="px-4 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider min-w-[140px]">Portfolio Roles</th>
              <th className="px-4 py-2 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wider w-[70px]">Teams</th>
              <th className="px-4 py-2 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wider w-[70px]">Portfolios</th>
              <th className="px-4 py-2 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wider w-[80px]">Gov. Risk</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map(row => (
              <React.Fragment key={row.userId}>
                <AuthorityRowComponent
                  row={row}
                  isExpanded={expandedUserId === row.userId}
                  onToggle={() => handleToggleExpand(row.userId)}
                />
                {expandedUserId === row.userId && (
                  <tr>
                    <td colSpan={6} className="p-0">
                      <AuthorityExpandedPanel
                        row={row}
                        orgPerms={orgPerms}
                        orgMembers={orgMembers}
                        onToggleOrgAdmin={onToggleOrgAdmin}
                        onToggleGlobalCoverageAdmin={onToggleGlobalCoverageAdmin}
                        onToggleNodeCoverageAdmin={onToggleNodeCoverageAdmin}
                        isMutating={isMutating}
                        onOpenNodeModal={onOpenNodeModal}
                        onSuspendUser={onSuspendUser}
                        onReactivateUser={onReactivateUser}
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">
                  {search ? 'No members match your search' : 'No members found'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
