/**
 * Access Matrix — pure logic for the Permissions view.
 *
 * Derives per-user access rows from org membership, org chart,
 * team, and portfolio data. Computes governance risk flags,
 * summary stats, and provides combinable filters.
 *
 * No React, no side effects.
 */

import type { OrgGraph, RawNodeMember } from './org-graph'

// ─── Types ───────────────────────────────────────────────────────────────

export type AuthorityRoleChip = 'Org Admin' | 'Coverage Admin' | 'PM' | 'Analyst' | string

export interface CoverageScope {
  type: 'global' | 'node'
  nodeId?: string
  nodeName?: string
  nodePath?: string[]   // ancestor names for breadcrumb
}

export interface TeamAssignment {
  nodeId: string
  nodeName: string
  role: string
  nodePath: string[]    // ancestor names
  isCoverageAdmin: boolean
  coverageAdminBlocked: boolean
}

export interface PortfolioAssignment {
  nodeId: string
  nodeName: string
  role: string
  parentTeamName?: string
}

export type UserRiskFlagType =
  | 'single_point_of_failure'
  | 'over_broad_access'
  | 'missing_required_admin'

export interface UserRiskFlag {
  type: UserRiskFlagType
  severity: 'low' | 'medium' | 'high'
  label: string
  detail: string
  /** Node ID the risk is anchored to (for highlighting in team/portfolio lists) */
  anchorNodeId?: string
}

export interface AuthorityRow {
  userId: string
  fullName: string
  email: string
  avatarUrl?: string | null

  isOrgAdmin: boolean
  isGlobalCoverageAdmin: boolean

  status: 'active' | 'suspended'

  roleChips: AuthorityRoleChip[]
  scopeSummary: string

  coverageScopes: CoverageScope[]
  teams: TeamAssignment[]
  portfolios: PortfolioAssignment[]

  riskFlags: UserRiskFlag[]
  riskSeverity: 'high' | 'medium' | 'low' | null
}

export type AuthorityFilter = 'all' | 'org_admin' | 'coverage_admin' | 'pm' | 'flagged'

export interface AuthoritySummary {
  totalUsers: number
  orgAdminCount: number
  globalCoverageAdminCount: number
  nodeCoverageAdminCount: number
  pmCount: number
  flaggedUserCount: number
  riskBySeverity: { high: number; medium: number; low: number }
}

// ─── Input shape for buildAuthorityRows ──────────────────────────────────

export interface BuildAuthorityRowsInput {
  orgMembers: Array<{
    user_id: string
    is_org_admin: boolean
    status?: string
    user?: {
      id: string
      email: string
      full_name: string | null
      avatar_url?: string | null
      coverage_admin?: boolean
    } | null
  }>
  orgChartNodeMembers: Array<{
    id: string
    node_id: string
    user_id: string
    role: string
    is_coverage_admin?: boolean
    coverage_admin_blocked?: boolean
  }>
  orgGraph: OrgGraph
  teamMemberships: Array<{
    team_id: string
    user_id: string
    team?: { id: string; name: string } | null
  }>
  portfolioTeamMembers: Array<{
    portfolio_id: string
    user_id: string
    role: string
  }>
  portfolios: Array<{
    id: string
    name: string
    team_id: string | null
  }>
  globalCoverageAdminUserIds: Set<string>
}

// ─── Role normalization ──────────────────────────────────────────────────

const PM_PATTERNS = [/\bpm\b/i, /portfolio\s*manager/i]

function isPmRole(role: string): boolean {
  return PM_PATTERNS.some(p => p.test(role))
}

/**
 * Canonical role map: lowercased input → display label.
 * Handles casing inconsistencies (analyst / Analyst / ANALYST → "Analyst").
 */
const CANONICAL_ROLES: Record<string, string> = {
  'analyst': 'Analyst',
  'pm': 'PM',
  'portfolio manager': 'PM',
  'member': 'Member',
  'lead': 'Lead',
  'head': 'Head',
  'director': 'Director',
  'associate': 'Associate',
  'senior analyst': 'Senior Analyst',
  'junior analyst': 'Junior Analyst',
  'research analyst': 'Research Analyst',
  'trader': 'Trader',
  'strategist': 'Strategist',
}

/** Normalize a role string to its canonical display label. */
export function normalizeRole(role: string): string {
  const key = role.trim().toLowerCase()
  if (CANONICAL_ROLES[key]) return CANONICAL_ROLES[key]
  if (isPmRole(role)) return 'PM'
  // Title-case unknown roles: "some role" → "Some Role"
  return role.trim().replace(/\b\w/g, c => c.toUpperCase())
}

// ─── buildAuthorityRows ──────────────────────────────────────────────────

export function buildAuthorityRows(input: BuildAuthorityRowsInput): AuthorityRow[] {
  const {
    orgMembers,
    orgChartNodeMembers,
    orgGraph,
    teamMemberships,
    portfolioTeamMembers,
    portfolios,
    globalCoverageAdminUserIds,
  } = input

  // Index node members by userId
  const nodeMemsByUser = new Map<string, typeof orgChartNodeMembers>()
  for (const nm of orgChartNodeMembers) {
    if (!nodeMemsByUser.has(nm.user_id)) nodeMemsByUser.set(nm.user_id, [])
    nodeMemsByUser.get(nm.user_id)!.push(nm)
  }

  // Index team memberships by userId
  const teamMemsByUser = new Map<string, typeof teamMemberships>()
  for (const tm of teamMemberships) {
    if (!teamMemsByUser.has(tm.user_id)) teamMemsByUser.set(tm.user_id, [])
    teamMemsByUser.get(tm.user_id)!.push(tm)
  }

  // Index portfolio team members by userId
  const portfolioMemsByUser = new Map<string, typeof portfolioTeamMembers>()
  for (const pm of portfolioTeamMembers) {
    if (!portfolioMemsByUser.has(pm.user_id)) portfolioMemsByUser.set(pm.user_id, [])
    portfolioMemsByUser.get(pm.user_id)!.push(pm)
  }

  // Index portfolios by id
  const portfolioById = new Map(portfolios.map(p => [p.id, p]))

  // Index teams by id (from teamMemberships)
  const teamNameById = new Map<string, string>()
  for (const tm of teamMemberships) {
    if (tm.team?.id && tm.team.name) {
      teamNameById.set(tm.team.id, tm.team.name)
    }
  }

  // Helper: get node path as names
  function getNodePathNames(nodeId: string): string[] {
    const node = orgGraph.nodes.get(nodeId)
    if (!node) return []
    return node.path
      .map(id => orgGraph.nodes.get(id)?.name)
      .filter((n): n is string => !!n)
  }

  const rows: AuthorityRow[] = []

  for (const member of orgMembers) {
    const userId = member.user_id
    const fullName = member.user?.full_name || 'Unknown'
    const email = member.user?.email || ''
    const avatarUrl = member.user?.avatar_url ?? null

    const isOrgAdmin = member.is_org_admin
    const isGlobalCoverageAdmin = globalCoverageAdminUserIds.has(userId)
    const status: 'active' | 'suspended' = member.status === 'inactive' ? 'suspended' : 'active'

    // Coverage scopes
    const coverageScopes: CoverageScope[] = []
    if (isGlobalCoverageAdmin) {
      coverageScopes.push({ type: 'global' })
    }

    const userNodeMems = nodeMemsByUser.get(userId) || []
    for (const nm of userNodeMems) {
      if (nm.is_coverage_admin && !nm.coverage_admin_blocked) {
        const node = orgGraph.nodes.get(nm.node_id)
        coverageScopes.push({
          type: 'node',
          nodeId: nm.node_id,
          nodeName: node?.name,
          nodePath: node ? getNodePathNames(nm.node_id) : [],
        })
      }
    }

    // Team assignments (from org chart node members where node is team-type)
    const teams: TeamAssignment[] = []
    for (const nm of userNodeMems) {
      const node = orgGraph.nodes.get(nm.node_id)
      if (!node) continue
      // Include all node types — the org chart IS the team structure
      teams.push({
        nodeId: nm.node_id,
        nodeName: node.name,
        role: normalizeRole(nm.role),
        nodePath: getNodePathNames(nm.node_id),
        isCoverageAdmin: nm.is_coverage_admin || false,
        coverageAdminBlocked: nm.coverage_admin_blocked || false,
      })
    }

    // Portfolio assignments (from portfolio_team)
    const userPortfolioMems = portfolioMemsByUser.get(userId) || []
    const portfolioAssignments: PortfolioAssignment[] = []
    for (const pm of userPortfolioMems) {
      const portfolio = portfolioById.get(pm.portfolio_id)
      if (!portfolio) continue
      const parentTeamName = portfolio.team_id ? teamNameById.get(portfolio.team_id) : undefined
      portfolioAssignments.push({
        nodeId: pm.portfolio_id,
        nodeName: portfolio.name,
        role: normalizeRole(pm.role),
        parentTeamName,
      })
    }

    // Deduplicated role chips (normalized)
    const chipSet = new Set<string>()
    if (isOrgAdmin) chipSet.add('Org Admin')
    if (isGlobalCoverageAdmin || coverageScopes.some(cs => cs.type === 'node')) {
      chipSet.add('Coverage Admin')
    }
    for (const t of teams) {
      chipSet.add(t.role) // already normalized above
    }
    for (const p of portfolioAssignments) {
      chipSet.add(p.role) // already normalized above
    }
    const roleChips = Array.from(chipSet) as AuthorityRoleChip[]

    // Scope summary — structured "Label: Value" format
    const scopeParts: string[] = []
    if (isGlobalCoverageAdmin) scopeParts.push('Coverage: Global')
    const nodeScopeCount = coverageScopes.filter(cs => cs.type === 'node').length
    if (nodeScopeCount > 0 && !isGlobalCoverageAdmin) {
      scopeParts.push(`Coverage: ${nodeScopeCount} node${nodeScopeCount !== 1 ? 's' : ''}`)
    }
    if (teams.length > 0) scopeParts.push(`Teams: ${teams.length}`)
    if (portfolioAssignments.length > 0) {
      scopeParts.push(`Portfolios: ${portfolioAssignments.length}`)
    }
    const scopeSummary = scopeParts.join(' \u00b7 ') || 'No assignments'

    // Risk flags (computed below)
    const riskFlags = computeUserRiskFlags(
      { userId, fullName, isOrgAdmin, isGlobalCoverageAdmin, coverageScopes, teams },
      orgGraph,
      orgChartNodeMembers,
    )
    const riskSeverity = getWorstSeverity(riskFlags)

    rows.push({
      userId,
      fullName,
      email,
      avatarUrl,
      isOrgAdmin,
      isGlobalCoverageAdmin,
      status,
      roleChips,
      scopeSummary,
      coverageScopes,
      teams,
      portfolios: portfolioAssignments,
      riskFlags,
      riskSeverity,
    })
  }

  // Sort: flagged first (by worst severity desc), then org admins, then alphabetical
  rows.sort((a, b) => {
    const sevOrder = severityOrdinal(b.riskSeverity) - severityOrdinal(a.riskSeverity)
    if (sevOrder !== 0) return sevOrder
    if (a.isOrgAdmin !== b.isOrgAdmin) return a.isOrgAdmin ? -1 : 1
    return a.fullName.localeCompare(b.fullName)
  })

  return rows
}

// ─── computeUserRiskFlags ────────────────────────────────────────────────

export function computeUserRiskFlags(
  user: {
    userId: string
    fullName: string
    isOrgAdmin: boolean
    isGlobalCoverageAdmin: boolean
    coverageScopes: CoverageScope[]
    teams: TeamAssignment[]
  },
  orgGraph: OrgGraph,
  allNodeMembers: Array<{ node_id: string; user_id: string; is_coverage_admin?: boolean; coverage_admin_blocked?: boolean }>,
): UserRiskFlag[] {
  const flags: UserRiskFlag[] = []
  const name = user.fullName || 'This user'

  // single_point_of_failure — only member on a team node
  for (const team of user.teams) {
    const graphNode = orgGraph.nodes.get(team.nodeId)
    if (graphNode && graphNode.effectiveMemberCount === 1) {
      flags.push({
        type: 'single_point_of_failure',
        severity: 'high',
        label: `Single point of coverage on ${team.nodeName}`,
        detail: `${name} is the only assigned member on ${team.nodeName}. If unavailable, this team would have no active coverage.`,
        anchorNodeId: team.nodeId,
      })
    }
  }

  // over_broad_access — org admin AND (global coverage admin OR >3 nodes) AND >5 teams
  if (user.isOrgAdmin) {
    const hasWideCoverage = user.isGlobalCoverageAdmin ||
      user.coverageScopes.filter(cs => cs.type === 'node').length > 3
    if (hasWideCoverage && user.teams.length > 5) {
      flags.push({
        type: 'over_broad_access',
        severity: 'medium',
        label: 'Concentrated access across multiple roles',
        detail: `${name} holds Organization Admin, ${user.isGlobalCoverageAdmin ? 'global' : 'broad'} coverage, and ${user.teams.length} team assignments. Consider distributing access responsibilities.`,
      })
    }
  }

  // missing_required_admin — team they're on has no coverage admin
  for (const team of user.teams) {
    const graphNode = orgGraph.nodes.get(team.nodeId)
    if (graphNode && graphNode.riskFlags.some(f => f.type === 'missing_coverage_admin')) {
      flags.push({
        type: 'missing_required_admin',
        severity: 'low',
        label: `${team.nodeName} has no coverage admin`,
        detail: `No one is designated as coverage admin for ${team.nodeName}. Assign a coverage admin to enable coverage workflows.`,
        anchorNodeId: team.nodeId,
      })
    }
  }

  return flags
}

// ─── computeAuthoritySummary ─────────────────────────────────────────────

export function computeAuthoritySummary(rows: AuthorityRow[]): AuthoritySummary {
  let orgAdminCount = 0
  let globalCoverageAdminCount = 0
  const nodeCoverageAdminUserIds = new Set<string>()
  let pmCount = 0
  let flaggedUserCount = 0
  const riskBySeverity = { high: 0, medium: 0, low: 0 }

  for (const row of rows) {
    if (row.isOrgAdmin) orgAdminCount++
    if (row.isGlobalCoverageAdmin) globalCoverageAdminCount++
    if (row.coverageScopes.some(cs => cs.type === 'node')) {
      nodeCoverageAdminUserIds.add(row.userId)
    }
    if (row.roleChips.includes('PM')) pmCount++
    if (row.riskFlags.length > 0) {
      flaggedUserCount++
      for (const f of row.riskFlags) {
        riskBySeverity[f.severity]++
      }
    }
  }

  return {
    totalUsers: rows.length,
    orgAdminCount,
    globalCoverageAdminCount,
    nodeCoverageAdminCount: nodeCoverageAdminUserIds.size,
    pmCount,
    flaggedUserCount,
    riskBySeverity,
  }
}

// ─── filterAuthorityRows ─────────────────────────────────────────────────

export function filterAuthorityRows(
  rows: AuthorityRow[],
  filter: AuthorityFilter,
  search: string,
  scopeNodeId?: string,
  statusFilter?: 'all' | 'active' | 'suspended',
  teamNodeId?: string,
  portfolioNodeId?: string,
): AuthorityRow[] {
  let result = rows

  // Text search
  const q = search.trim().toLowerCase()
  if (q) {
    result = result.filter(r =>
      r.fullName.toLowerCase().includes(q) ||
      r.email.toLowerCase().includes(q),
    )
  }

  // Role/status filter
  if (filter === 'org_admin') {
    result = result.filter(r => r.isOrgAdmin)
  } else if (filter === 'coverage_admin') {
    result = result.filter(r => r.isGlobalCoverageAdmin || r.coverageScopes.some(cs => cs.type === 'node'))
  } else if (filter === 'pm') {
    result = result.filter(r => r.roleChips.includes('PM'))
  } else if (filter === 'flagged') {
    result = result.filter(r => r.riskFlags.length > 0)
  }

  // Status filter
  if (statusFilter && statusFilter !== 'all') {
    result = result.filter(r => r.status === statusFilter)
  }

  // Team filter
  if (teamNodeId) {
    result = result.filter(r =>
      r.teams.some(t => t.nodeId === teamNodeId),
    )
  }

  // Portfolio filter
  if (portfolioNodeId) {
    result = result.filter(r =>
      r.portfolios.some(p => p.nodeId === portfolioNodeId),
    )
  }

  // Scope filter — filter to users with authority over a specific node or its descendants
  if (scopeNodeId) {
    result = result.filter(r =>
      r.teams.some(t => t.nodeId === scopeNodeId) ||
      r.portfolios.some(p => p.nodeId === scopeNodeId),
    )
  }

  return result
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function severityOrdinal(sev: 'high' | 'medium' | 'low' | null): number {
  if (sev === 'high') return 3
  if (sev === 'medium') return 2
  if (sev === 'low') return 1
  return 0
}

function getWorstSeverity(flags: UserRiskFlag[]): 'high' | 'medium' | 'low' | null {
  if (flags.length === 0) return null
  if (flags.some(f => f.severity === 'high')) return 'high'
  if (flags.some(f => f.severity === 'medium')) return 'medium'
  return 'low'
}
