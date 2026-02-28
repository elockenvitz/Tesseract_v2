/**
 * OrgAccessTab — Access report: "who has access to what?"
 * Table: Person | Email | Status | Org Role | Admin Roles | Teams | Portfolios | Risk Flags
 * Search filter + CSV export.
 *
 * When `authorityRows` is provided, enriches display with admin role chips,
 * portfolio roles, and risk flag detail from the access matrix data.
 */

import React, { useState, useMemo, useCallback } from 'react'
import { Shield, Search, Download, UserCircle, AlertTriangle } from 'lucide-react'
import { Button } from '../ui/Button'
import { format } from 'date-fns'
import { csvSanitizeCell } from '../../lib/csv-sanitize'
import type { AuthorityRow } from '../../lib/authority-map'

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

  // Build flat access rows, enriched from authorityRows when available
  const rows = useMemo<AccessRow[]>(() => {
    // If we have authority rows, use those for richer data
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
    if (!search.trim()) return rows
    const q = search.toLowerCase()
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        r.teamNames.some((t) => t.toLowerCase().includes(q)) ||
        r.portfolioNames.some((p) => p.toLowerCase().includes(q))
    )
  }, [rows, search])

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
    a.download = `access-report-${format(new Date(), 'yyyy-MM-dd')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [filtered])

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700 flex items-center">
          <Shield className="w-4 h-4 mr-1.5 text-indigo-500" />
          Access Report
          <span className="ml-2 px-1.5 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
            {filtered.length}
          </span>
        </h3>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              placeholder="Search people..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="text-xs border border-gray-300 rounded-lg pl-8 pr-3 py-1.5 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent w-48"
            />
          </div>
          <Button size="sm" variant="outline" onClick={handleExport} disabled={!filtered.length}>
            <Download className="w-3.5 h-3.5 mr-1" />
            CSV
          </Button>
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <Shield className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">
            {search ? 'No matching members' : 'No active members'}
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">Person</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">Email</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">Org Role</th>
                {authorityRows && (
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Admin Roles</th>
                )}
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">Teams</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">Portfolios</th>
                {authorityRows && (
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Risk Flags</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((row) => (
                <tr key={row.userId} className={`hover:bg-gray-50/50 ${row.status === 'suspended' ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <UserCircle className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      <span className="font-medium text-gray-900 truncate max-w-[180px]">
                        {row.name}
                      </span>
                      {row.status === 'suspended' && (
                        <span className="px-1 py-0.5 text-[9px] font-medium rounded bg-amber-100 text-amber-700">
                          Suspended
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 truncate max-w-[200px]">{row.email}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`px-1.5 py-0.5 text-xs rounded font-medium ${
                        row.orgRole === 'Admin'
                          ? 'bg-indigo-50 text-indigo-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {row.orgRole}
                    </span>
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
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </td>
                  )}
                  <td className="px-4 py-2.5">
                    {row.teamNames.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {row.teamNames.map((t) => (
                          <span
                            key={t}
                            className="px-1.5 py-0.5 text-[10px] bg-blue-50 text-blue-700 rounded whitespace-nowrap"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {row.portfolioNames.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {row.portfolioNames.map((p) => (
                          <span
                            key={p}
                            className="px-1.5 py-0.5 text-[10px] bg-emerald-50 text-emerald-700 rounded whitespace-nowrap"
                          >
                            {p}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">-</span>
                    )}
                  </td>
                  {authorityRows && (
                    <td className="px-4 py-2.5">
                      {row.riskFlags.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {row.riskFlags.map((f) => (
                            <span
                              key={f}
                              className="px-1.5 py-0.5 text-[10px] bg-red-50 text-red-700 rounded whitespace-nowrap flex items-center gap-0.5"
                            >
                              <AlertTriangle className="w-2.5 h-2.5" />
                              {f}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
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
