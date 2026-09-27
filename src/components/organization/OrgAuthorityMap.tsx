/**
 * OrgAuthorityMap — "Access & Roles" component for the Governance hub.
 *
 * Displays a table of org members with expandable access details.
 * View mode is clean and read-only. Edit mode (ORG_ADMIN only) provides
 * controlled mutations with explicit confirmation dialogs.
 *
 * Lifecycle actions (suspend/reactivate) live in the Members tab only.
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react'
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
} from 'lucide-react'
import { FilterSelect } from './FilterSelect'
import { useIsMobile } from '../../hooks/useMediaQuery'
import { GovernanceListRow } from './OrgGovernanceList'
import type { OrgGraph } from '../../lib/org-graph'
import type { OrgPermissions } from '../../lib/permissions/orgGovernance'
import {
  filterAuthorityRows,
  type AuthorityRow,
  type AuthoritySummary,
  type AuthorityFilter,
  type UserRiskFlag,
} from '../../lib/authority-map'
import { GovernanceSummaryStrip, SeatSummaryBar, type SeatCounts } from './OrgBadges'

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
  // Cross-navigation: auto-expand a user from Members tab
  focusUserId?: string | null
  /** Optional filter to apply alongside focus (e.g. 'flagged') */
  focusFilter?: string | null
  onFocusUserHandled?: () => void
}

// ─── Role chip colors ────────────────────────────────────────────────────

/** Administrative roles get strong styling; functional roles get muted styling. */
const AUTHORITY_CHIPS: Record<string, string> = {
  'Org Admin': 'bg-indigo-100 text-indigo-700 font-semibold',
  'Coverage Admin': 'bg-purple-100 text-purple-700 font-semibold',
  'PM': 'bg-blue-100 text-blue-700 font-semibold',
}

function getChipColor(chip: string): string {
  return AUTHORITY_CHIPS[chip] || 'bg-gray-100 text-gray-500 dark:text-gray-400 dark:bg-gray-800'
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
        className="flex items-center gap-1.5 text-xs font-medium text-gray-700 hover:text-gray-900 w-full text-left py-0.5 dark:hover:text-white dark:text-gray-300"
      >
        <Chevron className="w-3 h-3 text-gray-400 flex-shrink-0" />
        {title}
      </button>
      {open && <div className="ml-4.5 mt-1">{children}</div>}
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
        className="px-2.5 py-1 rounded text-[11px] font-medium border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 dark:border-gray-600 dark:text-gray-400 dark:bg-gray-800"
      >
        Cancel
      </button>
    </div>
  )
}

// ─── Role summary helpers ────────────────────────────────────────────────

/** Summarize roles as "N Role · M Role", hiding default "Member" role. */
function summarizeRoles(items: Array<{ role: string }>): string {
  const counts = new Map<string, number>()
  for (const item of items) {
    if (item.role === 'Member') continue // default role — omit from summary
    counts.set(item.role, (counts.get(item.role) || 0) + 1)
  }
  if (counts.size === 0) return ''
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

// ─── Compact governance summary (phone) ─────────────────────────────────

/**
 * The seat counts and the four role chips, as two quiet lines.
 *
 * Desktop affords a title block, a seat bar and four pill buttons before the
 * list begins. At 390px that same furniture filled most of the first screen,
 * so the people — what the screen is actually for — started below the fold.
 * The information is unchanged and every role segment still drives the same
 * filter; it is simply stated rather than displayed.
 */
function GovernanceSummaryCompact({
  seats,
  orgAdminCount,
  coverageAdminCount,
  pmCount,
  riskFlagCount,
  activeFilter,
  onFilterClick,
}: {
  seats: SeatCounts
  orgAdminCount: number
  coverageAdminCount: number
  pmCount: number
  riskFlagCount: number
  activeFilter: string
  onFilterClick: (filter: string) => void
}) {
  const segments = [
    { key: 'org-admin', count: orgAdminCount, label: orgAdminCount === 1 ? 'Org Admin' : 'Org Admins' },
    { key: 'coverage-admin', count: coverageAdminCount, label: coverageAdminCount === 1 ? 'Coverage Admin' : 'Coverage Admins' },
    { key: 'pm', count: pmCount, label: pmCount === 1 ? 'PM' : 'PMs' },
  ]

  return (
    <div data-slot="governance-summary-compact" className="space-y-1">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        <span className="font-semibold text-gray-900 dark:text-white">{seats.active}</span> active
        {seats.invited > 0 && <> &middot; <span className="font-semibold text-gray-900 dark:text-white">{seats.invited}</span> invited</>}
        {seats.suspended > 0 && <> &middot; <span className="font-semibold text-gray-900 dark:text-white">{seats.suspended}</span> suspended</>}
      </p>
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs">
        {segments.map((s, i) => (
          <React.Fragment key={s.key}>
            {i > 0 && <span className="text-gray-300">&middot;</span>}
            <button
              type="button"
              onClick={() => onFilterClick(activeFilter === s.key ? 'all' : s.key)}
              className={`no-touch-target tap-pad rounded px-0.5 ${
                activeFilter === s.key
                  ? 'font-semibold text-indigo-700 underline underline-offset-2 dark:text-indigo-300'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              <span className="font-semibold text-gray-900 dark:text-white">{s.count}</span> {s.label}
            </button>
          </React.Fragment>
        ))}
        {/* Risk stays visually distinct — it is the one segment that means
            something is wrong, and it should not read as another count. */}
        {riskFlagCount > 0 && (
          <>
            <span className="text-gray-300">&middot;</span>
            <button
              type="button"
              onClick={() => onFilterClick(activeFilter === 'flagged' ? 'all' : 'flagged')}
              className={`no-touch-target tap-pad inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 font-medium text-red-600 ${
                activeFilter === 'flagged' ? 'ring-1 ring-red-400' : ''
              }`}
            >
              <AlertTriangle className="h-3 w-3" />
              {riskFlagCount} {riskFlagCount === 1 ? 'risk' : 'risks'}
            </button>
          </>
        )}
      </div>
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
      {/* Search owns the full width on a phone. Sharing a row with five role
          filters collapsed it to roughly its own magnifier, which is not a
          search field — and search is how you find a person in a long list. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="relative w-full sm:flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white dark:border-gray-700 dark:bg-gray-800"
          />
        </div>
        {/* A deliberate rail on a phone rather than a squeezed row: the
            negative margin lets it scroll edge to edge while the inset keeps
            the first and last label clear of the screen edge, so no label is
            ever half-cut. `sm:` returns it to a plain inline group. */}
        <div className="mobile-scroll-x -mx-3 flex items-center gap-1 px-3 sm:mx-0 sm:overflow-visible sm:px-0">
          {FILTER_OPTIONS.map(f => (
            <button
              key={f.key}
              onClick={() => onFilterChange(filter === f.key ? 'all' : f.key)}
              className={`shrink-0 whitespace-nowrap px-2.5 py-1 text-[11px] font-medium rounded-md cursor-pointer transition-all ${
                filter === f.key
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-500 bg-white border border-gray-200 hover:text-gray-700 hover:bg-gray-50 hover:shadow-sm dark:hover:text-gray-200 dark:hover:bg-gray-800 dark:border-gray-700 dark:text-gray-400 dark:bg-gray-800'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {/* One element, repositioned — its own quiet line under the filters
            on a phone, the right edge of the row on desktop. A second copy
            behind `hidden` would read the count twice to a screen reader. */}
        <span className="text-[11px] text-gray-400 sm:ml-auto sm:text-xs">
          {filteredCount} of {totalCount} members
        </span>
      </div>
      {/* Dropdown filters. Two columns on a phone with status spanning both —
          three of these never fit one line, and the third was pushed past the
          right edge. `sm:` restores the original inline row. */}
      <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
        <FilterSelect
          value={statusFilter}
          onChange={(v) => onStatusFilterChange(v as 'all' | 'active' | 'suspended')}
          ariaLabel="Filter by status"
          sheetTitle="Filter by status"
          options={[
            { value: 'all', label: 'All statuses' },
            { value: 'active', label: 'Active' },
            { value: 'suspended', label: 'Suspended' },
          ]}
          className="text-xs border border-gray-200 rounded px-2 py-1 bg-white text-gray-600 focus:ring-2 focus:ring-indigo-500 focus:border-transparent dark:border-gray-700 dark:text-gray-400 dark:bg-gray-800"
          buttonClassName="col-span-2 w-full justify-between sm:col-auto sm:w-auto"
        />
        {teamOptions.length > 0 && (
          <FilterSelect
            value={teamFilter}
            onChange={onTeamFilterChange}
            ariaLabel="Filter by team"
            sheetTitle="Filter by team"
            options={[{ value: '', label: 'All teams' }, ...teamOptions.map(t => ({ value: t.id, label: t.name }))]}
            className="text-xs border border-gray-200 rounded px-2 py-1 bg-white text-gray-600 focus:ring-2 focus:ring-indigo-500 focus:border-transparent max-w-[180px] dark:border-gray-700 dark:text-gray-400 dark:bg-gray-800"
            buttonClassName="w-full justify-between sm:w-auto sm:max-w-[180px]"
          />
        )}
        {portfolioOptions.length > 0 && (
          <FilterSelect
            value={portfolioFilter}
            onChange={onPortfolioFilterChange}
            ariaLabel="Filter by portfolio"
            sheetTitle="Filter by portfolio"
            options={[{ value: '', label: 'All portfolios' }, ...portfolioOptions.map(p => ({ value: p.id, label: p.name }))]}
            className="text-xs border border-gray-200 rounded px-2 py-1 bg-white text-gray-600 focus:ring-2 focus:ring-indigo-500 focus:border-transparent max-w-[180px] dark:border-gray-700 dark:text-gray-400 dark:bg-gray-800"
            buttonClassName="w-full justify-between sm:w-auto sm:max-w-[180px]"
          />
        )}
      </div>
    </div>
  )
}

// ─── Expanded Panel ─────────────────────────────────────────────────────

function AccessSummaryPanel({
  row,
  orgPerms,
  orgMembers,
  onToggleOrgAdmin,
  onToggleGlobalCoverageAdmin,
  onToggleNodeCoverageAdmin,
  isMutating,
  onOpenNodeModal,
}: {
  row: AuthorityRow
  orgPerms: OrgPermissions
  orgMembers: any[]
  onToggleOrgAdmin?: (userId: string, newValue: boolean) => void
  onToggleGlobalCoverageAdmin?: (userId: string, newValue: boolean) => void
  onToggleNodeCoverageAdmin?: (memberId: string, newValue: boolean) => void
  isMutating?: boolean
  onOpenNodeModal?: (nodeId: string) => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const hasHighRisk = row.riskFlags.some(f => f.severity === 'high')
  const [risksExpanded, setRisksExpanded] = useState(hasHighRisk)
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

  const flaggedNodeIds = useMemo(() => {
    const ids = new Set<string>()
    for (const f of row.riskFlags) {
      if (f.anchorNodeId) ids.add(f.anchorNodeId)
    }
    return ids
  }, [row.riskFlags])

  const coverageScopeSummary = useMemo(() => {
    const nodeScopes = row.coverageScopes.filter(cs => cs.type === 'node')
    if (row.isGlobalCoverageAdmin) return 'Global'
    if (nodeScopes.length === 0) return 'None'
    return `Subtree (${nodeScopes.length})`
  }, [row.coverageScopes, row.isGlobalCoverageAdmin])

  const nodeScopes = row.coverageScopes.filter(cs => cs.type === 'node')

  // Risk severity breakdown
  const riskSeverityCounts = useMemo(() => {
    const counts = { high: 0, medium: 0, low: 0 }
    for (const f of row.riskFlags) counts[f.severity]++
    return counts
  }, [row.riskFlags])

  // Group portfolios by role
  const portfoliosByRole = useMemo(() => {
    const grouped = new Map<string, typeof row.portfolios>()
    for (const p of row.portfolios) {
      const arr = grouped.get(p.role) || []
      arr.push(p)
      grouped.set(p.role, arr)
    }
    // Sort groups by functional role order
    return Array.from(grouped.entries()).sort(
      (a, b) => (FUNCTIONAL_ROLE_ORDER[a[0]] ?? 99) - (FUNCTIONAL_ROLE_ORDER[b[0]] ?? 99)
    )
  }, [row.portfolios])

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
    <div className="bg-indigo-50/30 border-l-2 border-indigo-400 px-3 py-2 space-y-2 sm:px-5">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold text-gray-600 uppercase tracking-wider dark:text-gray-400">
            Access Summary
          </span>
          {row.status === 'suspended' && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-100 text-amber-700 border border-amber-200">
              Suspended
            </span>
          )}
          {/* TODO: derive from latest membership change timestamp when available */}
          <span className="text-[10px] text-gray-400 font-normal normal-case">&middot; Last updated: &mdash;</span>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && !isEditing && (
            <button
              onClick={() => setIsEditing(true)}
              className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-700 hover:bg-indigo-100 rounded transition-colors"
            >
              <Pencil className="w-3 h-3" />
              Manage roles
            </button>
          )}
          {isEditing && (
            <button
              onClick={handleExitEdit}
              className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors dark:hover:text-gray-200 dark:hover:bg-gray-700 dark:text-gray-400"
            >
              <X className="w-3 h-3" />
              Done
            </button>
          )}
        </div>
      </div>

      {/* ── Confirmation banner ── */}
      {pendingConfirm && (
        <ConfirmationBanner
          message={pendingConfirm.message}
          onConfirm={handleConfirmExecute}
          onCancel={handleCancelConfirm}
          destructive={pendingConfirm.destructive}
        />
      )}

      {/* ── Section 1: Firm-Level Permissions ── */}
      <div className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 space-y-1 dark:border-gray-700 dark:bg-gray-800">
        <div className="text-[11px] font-bold text-gray-600 uppercase tracking-wider dark:text-gray-400">
          Firm-Level Permissions
        </div>
        {/* One column on a phone. Two label/value pairs side by side at 390px
            left neither enough width, and the Grant/Remove control beside the
            value pushed the value out of its own cell. */}
        <div className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
          <div className="flex items-center justify-between">
            <span className="text-gray-500 dark:text-gray-400">Org Admin</span>
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
                      `Remove Organization Admin from ${row.fullName}?`,
                      () => onToggleOrgAdmin(row.userId, false),
                    )}
                    disabled={isLastAdmin || isMutating}
                    className={`ml-1 px-1.5 py-0.5 text-[10px] rounded border transition-colors ${
                      isLastAdmin
                        ? 'text-gray-300 border-gray-200 cursor-not-allowed dark:border-gray-700'
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
                      `Grant Organization Admin to ${row.fullName}? This provides organization-wide administrative privileges.`,
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
            <span className="text-gray-500 dark:text-gray-400">Coverage Admin</span>
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
                      `Remove Global Coverage from ${row.fullName}?`,
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
                      `Grant Global Coverage to ${row.fullName}? This provides organization-wide coverage oversight.`,
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
        {nodeScopes.length > 0 && (
          <div className="pt-1 border-t border-gray-100 dark:border-gray-800">
            <div className="text-[10px] text-gray-400 mb-0.5">Coverage Scope</div>
            <div className="flex flex-wrap gap-1.5">
              {nodeScopes.map((scope, i) => (
                <span
                  key={i}
                  className={`text-[11px] text-gray-600 break-words ${
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

      {/* ── Section 2: Teams ── */}
      {row.teams.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 dark:border-gray-700 dark:bg-gray-800">
          <CollapsibleSection
            defaultOpen={row.teams.length <= 4}
            title={
              <span className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-gray-600 uppercase tracking-wider dark:text-gray-400">
                  Teams ({row.teams.length})
                </span>
                <span className="text-[11px] text-gray-400 normal-case font-normal">
                  {summarizeRoles(row.teams)}
                </span>
              </span>
            }
          >
            <div className="space-y-px mt-1">
              {row.teams.map(team => {
                const hasRisk = flaggedNodeIds.has(team.nodeId)
                return (
                  <div
                    key={team.nodeId}
                    className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs py-px rounded ${
                      hasRisk ? 'bg-red-50/60 -mx-1 px-1' : ''
                    } ${onOpenNodeModal ? 'cursor-pointer hover:text-indigo-600' : 'text-gray-600 dark:text-gray-400'}`}
                    onClick={() => onOpenNodeModal?.(team.nodeId)}
                  >
                    {hasRisk && <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0" />}
                    <span className="font-medium break-words">{team.nodeName}</span>
                    {team.role !== 'Member' && (
                      <span className={`px-1.5 py-0.5 text-[10px] rounded ${getChipColor(team.role)}`}>
                        {team.role}
                      </span>
                    )}
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

      {/* ── Section 3: Portfolios (grouped by role) ── */}
      {row.portfolios.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 dark:border-gray-700 dark:bg-gray-800">
          <CollapsibleSection
            defaultOpen={row.portfolios.length <= 4}
            title={
              <span className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-gray-600 uppercase tracking-wider dark:text-gray-400">
                  Portfolios ({row.portfolios.length})
                </span>
                <span className="text-[11px] text-gray-400 normal-case font-normal">
                  {summarizeRoles(row.portfolios)}
                </span>
              </span>
            }
          >
            <div className="space-y-1.5 mt-1">
              {portfoliosByRole.map(([role, ports]) => (
                <div key={role}>
                  <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-px">
                    {role} ({ports.length})
                  </div>
                  <div className="space-y-px">
                    {ports.map(port => {
                      const hasRisk = flaggedNodeIds.has(port.nodeId)
                      return (
                        <div
                          key={port.nodeId}
                          className={`flex items-start gap-2 text-xs py-px rounded ${
                            hasRisk ? 'bg-red-50/60 -mx-1 px-1' : ''
                          } text-gray-600`}
                        >
                          {hasRisk && <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0 mt-0.5" />}
                          <span className="font-medium break-words">{port.nodeName}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        </div>
      )}

      {/* ── Section 4: Governance Risks (summary-first) ── */}
      {row.riskFlags.length > 0 ? (
        <div className="bg-amber-50/50 border border-amber-200/70 rounded-lg px-3 py-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
              <span className="text-[11px] font-bold text-gray-700 dark:text-gray-300">
                {row.riskFlags.length} Governance Risk{row.riskFlags.length !== 1 ? 's' : ''}
              </span>
              <span className="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-400">
                {riskSeverityCounts.high > 0 && (
                  <span className="text-red-600 font-medium">{riskSeverityCounts.high} High</span>
                )}
                {riskSeverityCounts.medium > 0 && (
                  <span className="text-amber-600 font-medium">{riskSeverityCounts.medium} Medium</span>
                )}
                {riskSeverityCounts.low > 0 && (
                  <span className="text-gray-500 font-medium dark:text-gray-400">{riskSeverityCounts.low} Low</span>
                )}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setRisksExpanded(o => !o)}
              className="text-[11px] font-medium text-indigo-600 hover:text-indigo-700 transition-colors"
            >
              {risksExpanded ? 'Hide details' : 'View details'}
            </button>
          </div>
          {risksExpanded && (
            <div className="mt-1 space-y-0.5">
              {row.riskFlags.map((flag, i) => (
                <RiskFlagRow key={i} flag={flag} onOpenNodeModal={onOpenNodeModal} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="text-[11px] text-gray-400 italic">No governance risks detected</div>
      )}
    </div>
  )
}

// ─── Risk action mapping (frontend-only) ─────────────────────────────────

const RISK_ACTION_MAP: Record<string, string> = {
  single_point_of_failure: 'Assign backup',
  over_broad_access: 'Review access',
  missing_required_admin: 'Assign admin',
}

// ─── Risk flag row (compact, inside summary) ────────────────────────────

function RiskFlagRow({
  flag,
  onOpenNodeModal,
}: {
  flag: UserRiskFlag
  onOpenNodeModal?: (nodeId: string) => void
}) {
  const actionLabel = RISK_ACTION_MAP[flag.type]
  return (
    /*
      The risk copy wraps rather than truncating.

      Laid out as a single centred row, the label and its detail ran on one
      line with a `whitespace-nowrap` action button holding the end, so at
      390px the sentence was cut mid-word — "Single point of coverage on The
      BEST Team Eric Loc…". A governance risk that cannot be read in full is
      not a warning, and this is the text someone reads before deciding
      whether the access is safe. So: top-aligned, detail on its own line,
      and the action drops below the copy on a phone instead of competing
      with it for the same line.
    */
    <div
      className={`flex flex-wrap items-start gap-x-2 gap-y-0.5 px-2.5 py-1 rounded text-xs text-gray-700 ${
        flag.anchorNodeId && onOpenNodeModal ? 'cursor-pointer hover:bg-amber-100/50' : ''
      }`}
      onClick={() => flag.anchorNodeId && onOpenNodeModal?.(flag.anchorNodeId)}
    >
      <SeverityIcon severity={flag.severity} className="w-3 h-3 flex-shrink-0 mt-0.5" />
      {/* `max-sm:basis-[calc(100%-1.25rem)]` makes the copy claim the rest of
          the line, so the action wraps beneath it rather than squeezing it.
          One button, repositioned — not a second copy hidden at the other
          breakpoint. */}
      <div className="min-w-0 flex-1 max-sm:basis-[calc(100%-1.25rem)]">
        <div className="font-medium break-words">{flag.label}</div>
        <div className="text-[11px] text-gray-500 break-words dark:text-gray-400">{flag.detail}</div>
      </div>
      {actionLabel && flag.anchorNodeId && onOpenNodeModal && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpenNodeModal(flag.anchorNodeId!) }}
          className="no-touch-target tap-pad flex-shrink-0 text-[10px] font-medium text-indigo-600 hover:text-indigo-700 whitespace-nowrap max-sm:ml-5"
        >
          {actionLabel} &rarr;
        </button>
      )}
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
    low: 'bg-gray-100 text-gray-600 border-gray-200 dark:border-gray-700 dark:text-gray-400 dark:bg-gray-800',
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
  rowRef,
}: {
  row: AuthorityRow
  isExpanded: boolean
  onToggle: () => void
  rowRef?: React.Ref<HTMLTableRowElement>
}) {
  const Chevron = isExpanded ? ChevronDown : ChevronRight

  return (
    <tr
      ref={rowRef}
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
              <span className="text-sm font-medium text-gray-900 truncate dark:text-white">{row.fullName}</span>
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
      {/* Portfolio Roles — derived from row.portfolios (not roleChips) to prevent team-role leakage */}
      <td className="px-4 py-2.5">
        {(() => {
          const visible = Array.from(
            new Set(row.portfolios.map(p => p.role).filter(r => !HIDDEN_FUNCTIONAL_ROLES.has(r)))
          ).sort(sortFunctionalRoles)
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
                <span className="px-1.5 py-0.5 text-[11px] font-medium rounded bg-gray-100 text-gray-500 dark:text-gray-400 dark:bg-gray-800">
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
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{row.teams.length}</span>
        ) : (
          <span className="text-gray-300">&mdash;</span>
        )}
      </td>
      {/* Portfolios count */}
      <td className="px-4 py-2.5 text-center">
        {row.portfolios.length > 0 ? (
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{row.portfolios.length}</span>
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

// ─── Mobile person row ───────────────────────────────────────────────────

/**
 * One person as a governance row rather than six table cells.
 *
 * The collapsed row answers "who is this and what can they do": name, status,
 * risk, and the roles. Teams and portfolios become counts here — their names
 * are in the expansion, where there is width to read them.
 */
function AuthorityPersonRow({
  row,
  isExpanded,
  onToggle,
  rowRef,
  children,
}: {
  row: AuthorityRow
  isExpanded: boolean
  onToggle: () => void
  rowRef?: React.Ref<HTMLDivElement>
  children: React.ReactNode
}) {
  const adminChips = row.roleChips.filter(c => ADMIN_ROLES.has(c))
  const portfolioRoles = Array.from(
    new Set(row.portfolios.map(p => p.role).filter(r => !HIDDEN_FUNCTIONAL_ROLES.has(r)))
  ).sort(sortFunctionalRoles)
  const roleChips = [...adminChips, ...portfolioRoles]

  const counts: string[] = []
  if (row.teams.length > 0) counts.push(`${row.teams.length} ${row.teams.length === 1 ? 'team' : 'teams'}`)
  if (row.portfolios.length > 0) counts.push(`${row.portfolios.length} ${row.portfolios.length === 1 ? 'portfolio' : 'portfolios'}`)

  return (
    <GovernanceListRow
      rowRef={rowRef}
      name={row.fullName}
      email={row.email}
      dimmed={row.status === 'suspended'}
      status={
        row.status === 'suspended' ? (
          <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
            Suspended
          </span>
        ) : (
          <span className="shrink-0 text-[10px] font-medium text-emerald-600">Active</span>
        )
      }
      badge={<RiskCountBadge flags={row.riskFlags} />}
      meta={
        roleChips.length > 0 ? (
          roleChips.map(chip => (
            <span key={chip} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${getChipColor(chip)}`}>
              {chip}
            </span>
          ))
        ) : (
          <span className="text-[11px] text-gray-400">No admin or portfolio roles</span>
        )
      }
      secondaryMeta={counts.length > 0 ? counts.join(' · ') : undefined}
      expanded={isExpanded}
      onToggle={onToggle}
    >
      {children}
    </GovernanceListRow>
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
  focusUserId,
  focusFilter,
  onFocusUserHandled,
}: OrgAuthorityMapProps) {
  const isMobile = useIsMobile()
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

  // Cross-navigation: auto-expand focused user from Members tab.
  // Typed as the shared base so the same ref can hold the desktop `<tr>` or
  // the mobile row `<div>` — only one of the two is mounted at a time.
  const focusRowRef = React.useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!focusUserId) return
    // Apply optional filter (e.g. 'flagged') or clear filters
    const filterMapping: Record<string, AuthorityFilter> = {
      'flagged': 'flagged',
      'org_admin': 'org_admin',
      'coverage_admin': 'coverage_admin',
      'pm': 'pm',
    }
    setFilter(focusFilter ? filterMapping[focusFilter] || 'all' : 'all')
    setSearch('')
    setStatusFilter('all')
    setTeamFilter('')
    setPortfolioFilter('')
    setExpandedUserId(focusUserId)
    onFocusUserHandled?.()
    // Scroll to focused row after render
    requestAnimationFrame(() => {
      focusRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [focusUserId, focusFilter, onFocusUserHandled])

  // Map GovernanceSummaryStrip filter keys to AuthorityFilter keys
  const handleSummaryFilter = useCallback((chipFilter: string) => {
    const mapping: Record<string, AuthorityFilter> = {
      'org-admin': 'org_admin',
      'coverage-admin': 'coverage_admin',
      'pm': 'pm',
      'flagged': 'flagged',
      'all': 'all',
    }
    setFilter(mapping[chipFilter] || 'all')
  }, [])

  // Reverse mapping for GovernanceSummaryStrip active filter display
  const summaryActiveFilter = useMemo(() => {
    const reverseMapping: Record<AuthorityFilter, string> = {
      'org_admin': 'org-admin',
      'coverage_admin': 'coverage-admin',
      'pm': 'pm',
      'flagged': 'flagged',
      'all': '',
    }
    return reverseMapping[filter] || ''
  }, [filter])

  const seatCounts: SeatCounts = useMemo(() => ({
    active: summary.totalUsers,
    invited: invitedCount ?? 0,
    suspended: suspendedCount ?? 0,
  }), [summary.totalUsers, invitedCount, suspendedCount])

  const showSeatMeter = invitedCount != null || suspendedCount != null

  return (
    <div className="space-y-4">
      {/* On a phone the title block, the seat bar and the four role pills
          collapse into one compact summary — the page already says
          "Governance" directly above. Desktop keeps all three. */}
      {isMobile ? (
        <GovernanceSummaryCompact
          seats={seatCounts}
          orgAdminCount={summary.orgAdminCount}
          coverageAdminCount={summary.globalCoverageAdminCount + summary.nodeCoverageAdminCount}
          pmCount={summary.pmCount}
          riskFlagCount={summary.flaggedUserCount}
          activeFilter={summaryActiveFilter}
          onFilterClick={handleSummaryFilter}
        />
      ) : (
        <>
          {/* Header row: title + seat counts */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-md bg-indigo-50 border border-indigo-200 flex items-center justify-center">
                <Shield className="w-4 h-4 text-indigo-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Access & Roles</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">Role assignments, access scope, and governance risk</p>
              </div>
            </div>
            {showSeatMeter && <SeatSummaryBar seats={seatCounts} />}
          </div>

          {/* Governance Summary — clickable chips drive the filter */}
          <GovernanceSummaryStrip
            orgAdminCount={summary.orgAdminCount}
            coverageAdminCount={summary.globalCoverageAdminCount + summary.nodeCoverageAdminCount}
            pmCount={summary.pmCount}
            riskFlagCount={summary.flaggedUserCount}
            activeFilter={summaryActiveFilter}
            onFilterClick={handleSummaryFilter}
          />
        </>
      )}

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

      {/* People.

          A phone gets rows, not a 720px table behind a sideways scroller —
          and the expansion then sits in a full-width div instead of a
          `colSpan` cell, which is what was clipping the governance detail.
          One branch or the other renders, never both: duplicating the list
          behind `hidden`/`sm:hidden` would announce every person twice. */}
      {isMobile ? (
        <div
          data-slot="governance-people"
          className="divide-y divide-gray-100 rounded border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-700 dark:bg-gray-800"
        >
          {filtered.map(row => (
            <AuthorityPersonRow
              key={row.userId}
              row={row}
              isExpanded={expandedUserId === row.userId}
              onToggle={() => handleToggleExpand(row.userId)}
              rowRef={expandedUserId === row.userId ? (el => { focusRowRef.current = el }) : undefined}
            >
              <AccessSummaryPanel
                row={row}
                orgPerms={orgPerms}
                orgMembers={orgMembers}
                onToggleOrgAdmin={onToggleOrgAdmin}
                onToggleGlobalCoverageAdmin={onToggleGlobalCoverageAdmin}
                onToggleNodeCoverageAdmin={onToggleNodeCoverageAdmin}
                isMutating={isMutating}
                onOpenNodeModal={onOpenNodeModal}
              />
            </AuthorityPersonRow>
          ))}
          {filtered.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-gray-400">
              {search ? 'No members match your search' : 'No members found'}
            </p>
          )}
        </div>
      ) : (
      <div className="border border-gray-200 rounded overflow-hidden dark:border-gray-700">
        {/* The phone shell clips horizontal overflow, so a table this wide is unreachable without its own scroller. `sm:min-w-0` returns it to the container from 640px up, leaving desktop unchanged. */}
        <div className="mobile-scroll-x show-scrollbar">
        <table className="w-full text-sm min-w-[720px] sm:min-w-0">
          <thead>
            <tr className="bg-gray-50/80 border-b border-gray-200 dark:border-gray-700">
              <th className="px-4 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider min-w-[200px] dark:text-gray-400">User</th>
              <th className="px-4 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider min-w-[140px] dark:text-gray-400">Admin Roles</th>
              <th className="px-4 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider min-w-[140px] dark:text-gray-400">Portfolio Roles</th>
              <th className="px-4 py-2 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wider w-[70px] dark:text-gray-400">Teams</th>
              <th className="px-4 py-2 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wider w-[70px] dark:text-gray-400">Portfolios</th>
              <th className="px-4 py-2 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wider w-[80px] dark:text-gray-400">Risk</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {filtered.map(row => (
              <React.Fragment key={row.userId}>
                <AuthorityRowComponent
                  row={row}
                  isExpanded={expandedUserId === row.userId}
                  onToggle={() => handleToggleExpand(row.userId)}
                  rowRef={expandedUserId === row.userId ? (el => { focusRowRef.current = el }) : undefined}
                />
                {expandedUserId === row.userId && (
                  <tr>
                    <td colSpan={6} className="p-0">
                      <AccessSummaryPanel
                        row={row}
                        orgPerms={orgPerms}
                        orgMembers={orgMembers}
                        onToggleOrgAdmin={onToggleOrgAdmin}
                        onToggleGlobalCoverageAdmin={onToggleGlobalCoverageAdmin}
                        onToggleNodeCoverageAdmin={onToggleNodeCoverageAdmin}
                        isMutating={isMutating}
                        onOpenNodeModal={onOpenNodeModal}
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
      )}
    </div>
  )
}
