/**
 * OrgAccessTab — Governance Report: "who has access to what?"
 *
 * Read-only audit report with filters, timestamp, and CSV export.
 * When `authorityRows` is provided, enriches display with admin role chips,
 * portfolio roles, and risk flag detail from the access matrix data.
 */

import React, { useState, useMemo, useCallback } from 'react'
import { clsx } from 'clsx'
import { FileText, Search, Download, UserCircle, AlertTriangle } from 'lucide-react'
import { Button } from '../ui/Button'
import { format } from 'date-fns'
import { csvSanitizeCell } from '../../lib/csv-sanitize'
import { StatusPill, RoleBadge } from './OrgBadges'
import type { AuthorityRow } from '../../lib/authority-map'

// ─── Truncated badge list (stable row height) ─────────────────────────

function TruncatedBadges({
  items,
  maxVisible = 2,
  style,
  icon,
}: {
  items: string[]
  maxVisible?: number
  style: string
  icon?: React.ReactNode
}) {
  if (items.length === 0) return <span className="text-gray-300">&mdash;</span>
  const visible = items.slice(0, maxVisible)
  const overflow = items.length - visible.length
  return (
    <div className="flex flex-wrap gap-1 max-w-[220px]">
      {visible.map((item) => (
        <span
          key={item}
          className={clsx('px-1.5 py-0.5 text-[10px] rounded whitespace-nowrap inline-flex items-center gap-0.5', style)}
        >
          {icon}
          <span className="truncate max-w-[140px]">{item}</span>
        </span>
      ))}
      {overflow > 0 && (
        <span
          className="px-1.5 py-0.5 text-[10px] rounded bg-gray-100 text-gray-500 cursor-default"
          title={items.slice(maxVisible).join('\n')}
        >
          +{overflow} more
        </span>
      )}
    </div>
  )
}

interface UserProfile {
  id: string
  email: string
  full_name: string | null
  avatar_url?: string | null
  coverage_admin?: boolean
}

interface OrgMember {
  id: string
  user_id: string
  is_org_admin: boolean
  status: string
  user?: UserProfile
}

interface Team {
  id: string
  name: string
}

interface TeamMembership {
  id: string
  team_id: string
  user_id: string
  is_team_admin: boolean
  team?: Team
}

interface Portfolio {
  id: string
  name: string
}

interface PortfolioMembership {
  id: string
  portfolio_id: string
  user_id: string
  is_portfolio_manager: boolean
  portfolio?: Portfolio
}

interface OrgAccessTabProps {
  orgMembers: OrgMember[]
  teams: Team[]
  teamMemberships: TeamMembership[]
  portfolios: Portfolio[]
  portfolioMemberships: PortfolioMembership[]
  authorityRows?: AuthorityRow[]
}

interface AccessRow {
  userId: string
  name: string
  email: string
  status: 'active' | 'suspended'
  orgRole: string
  adminRoles: string[]
  teamNames: string[]
  portfolioNames: string[]
  riskFlags: string[]
}

export function OrgAccessTab({
  orgMembers,
  teamMemberships,
  portfolioMemberships,
  authorityRows,
}: OrgAccessTabProps) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all')
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'member' | 'flagged'>('all')

  const generatedAt = useMemo(() => format(new Date(), 'MMM d, yyyy h:mm a'), [])

  // Build flat access rows, enriched from authorityRows when available
  const rows = useMemo<AccessRow[]>(() => {
    if (authorityRows && authorityRows.length > 0) {
      const authorityByUser = new Map(authorityRows.map(r => [r.userId, r]))

      return orgMembers
        .map((m) => {
          const auth = authorityByUser.get(m.user_id)
          const adminRoles: string[] = []
          if (auth) {
            if (auth.isOrgAdmin) adminRoles.push('Org Admin')
            if (auth.isGlobalCoverageAdmin) adminRoles.push('Coverage Admin (Global)')
            if (auth.coverageScopes.some(cs => cs.type === 'node')) adminRoles.push('Coverage Admin (Scoped)')
          } else if (m.is_org_admin) {
            adminRoles.push('Org Admin')
          }

          return {
            userId: m.user_id,
            name: m.user?.full_name || 'Unknown',
            email: m.user?.email || '',
            status: (auth?.status || (m.status === 'inactive' ? 'suspended' : 'active')) as 'active' | 'suspended',
            orgRole: m.is_org_admin ? 'Admin' : 'Member',
            adminRoles,
            teamNames: auth
              ? auth.teams.map(t => `${t.nodeName} (${t.role})`)
              : [],
            portfolioNames: auth
              ? auth.portfolios.map(p => `${p.nodeName} (${p.role})`)
              : [],
            riskFlags: auth
              ? auth.riskFlags.map(f => f.label)
              : [],
          }
        })
        .sort((a, b) => a.name.localeCompare(b.name))
    }

    // Fallback: build from raw membership data
    const userTeams = new Map<string, string[]>()
    for (const tm of teamMemberships) {
      const teamName = tm.team?.name
      if (!teamName) continue
      const arr = userTeams.get(tm.user_id) || []
      arr.push(tm.is_team_admin ? `${teamName} (admin)` : teamName)
      userTeams.set(tm.user_id, arr)
    }

    const userPortfolios = new Map<string, string[]>()
    for (const pm of portfolioMemberships) {
      const name = pm.portfolio?.name
      if (!name) continue
      const arr = userPortfolios.get(pm.user_id) || []
      arr.push(pm.is_portfolio_manager ? `${name} (PM)` : name)
      userPortfolios.set(pm.user_id, arr)
    }

    return orgMembers
      .filter((m) => m.status === 'active')
      .map((m) => ({
        userId: m.user_id,
        name: m.user?.full_name || 'Unknown',
        email: m.user?.email || '',
        status: 'active' as const,
        orgRole: m.is_org_admin ? 'Admin' : 'Member',
        adminRoles: m.is_org_admin ? ['Org Admin'] : [],
        teamNames: userTeams.get(m.user_id) || [],
        portfolioNames: userPortfolios.get(m.user_id) || [],
        riskFlags: [],
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [orgMembers, teamMemberships, portfolioMemberships, authorityRows])

  // Filter
  const filtered = useMemo(() => {
    let result = rows

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter(r => r.status === statusFilter)
    }

    // Role filter
    if (roleFilter === 'admin') {
      result = result.filter(r => r.adminRoles.length > 0)
    } else if (roleFilter === 'member') {
      result = result.filter(r => r.adminRoles.length === 0)
    } else if (roleFilter === 'flagged') {
      result = result.filter(r => r.riskFlags.length > 0)
    }

    // Text search
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.email.toLowerCase().includes(q) ||
          r.teamNames.some((t) => t.toLowerCase().includes(q)) ||
          r.portfolioNames.some((p) => p.toLowerCase().includes(q))
      )
    }

    return result
  }, [rows, search, statusFilter, roleFilter])

  // CSV export
  const handleExport = useCallback(() => {
    if (!filtered.length) return
    const csv = [
      ['Name', 'Email', 'Status', 'Org Role', 'Admin Roles', 'Teams', 'Portfolios', 'Risk Flags'].join(','),
      ...filtered.map((r) =>
        [
          r.name,
          r.email,
          r.status,
          r.orgRole,
          r.adminRoles.join('; '),
          r.teamNames.join('; '),
          r.portfolioNames.join('; '),
          r.riskFlags.join('; '),
        ]
          .map(csvSanitizeCell)
          .join(',')
      ),
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `governance-report-${format(new Date(), 'yyyy-MM-dd')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [filtered])

  return (
    <div className="space-y-4">
      {/* Report Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-md bg-gray-100 border border-gray-200 flex items-center justify-center">
            <FileText className="w-4 h-4 text-gray-500" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Governance Report</h3>
            <p className="text-[11px] text-gray-400">
              Generated {generatedAt}
              <span className="mx-1.5 text-gray-300">|</span>
              {filtered.length} of {rows.length} members
            </p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={handleExport} disabled={!filtered.length}>
          <Download className="w-3.5 h-3.5 mr-1" />
          Export CSV
        </Button>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name, email, team, portfolio..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'suspended')}
          className="text-xs border border-gray-200 rounded px-2 py-1.5 bg-white text-gray-600 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as 'all' | 'admin' | 'member' | 'flagged')}
          className="text-xs border border-gray-200 rounded px-2 py-1.5 bg-white text-gray-600 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        >
          <option value="all">All roles</option>
          <option value="admin">Admins only</option>
          <option value="member">Members only</option>
          {authorityRows && <option value="flagged">Flagged only</option>}
        </select>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg border border-gray-200">
          <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">
            {search || statusFilter !== 'all' || roleFilter !== 'all'
              ? 'No members match filters'
              : 'No active members'}
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50/80 border-b border-gray-200">
                <th className="text-left px-4 py-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Person</th>
                <th className="text-left px-4 py-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Org Role</th>
                {authorityRows && (
                  <th className="text-left px-4 py-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Admin Roles</th>
                )}
                <th className="text-left px-4 py-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Teams</th>
                <th className="text-left px-4 py-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Portfolios</th>
                {authorityRows && (
                  <th className="text-left px-4 py-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Risk Flags</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((row) => (
                <tr key={row.userId} className={`hover:bg-gray-50/50 ${row.status === 'suspended' ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <UserCircle className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="font-medium text-gray-900 truncate max-w-[180px]">{row.name}</div>
                        <div className="text-[11px] text-gray-400 truncate">{row.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusPill status={row.status} />
                  </td>
                  <td className="px-4 py-2.5">
                    <RoleBadge role={row.orgRole === 'Admin' ? 'org-admin' : 'member'} compact />
                  </td>
                  {authorityRows && (
                    <td className="px-4 py-2.5">
                      {row.adminRoles.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {row.adminRoles.map((r) => (
                            <span
                              key={r}
                              className="px-1.5 py-0.5 text-[10px] bg-purple-50 text-purple-700 rounded whitespace-nowrap"
                            >
                              {r}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-gray-300">&mdash;</span>
                      )}
                    </td>
                  )}
                  <td className="px-4 py-2.5">
                    <TruncatedBadges items={row.teamNames} maxVisible={3} style="bg-blue-50 text-blue-700" />
                  </td>
                  <td className="px-4 py-2.5">
                    <TruncatedBadges items={row.portfolioNames} maxVisible={3} style="bg-emerald-50 text-emerald-700" />
                  </td>
                  {authorityRows && (
                    <td className="px-4 py-2.5">
                      <TruncatedBadges
                        items={row.riskFlags}
                        maxVisible={2}
                        style="bg-red-50 text-red-700"
                        icon={<AlertTriangle className="w-2.5 h-2.5 flex-shrink-0" />}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
