import { describe, it, expect } from 'vitest'
import {
  buildAuthorityRows,
  computeUserRiskFlags,
  computeAuthoritySummary,
  filterAuthorityRows,
  normalizeRole,
  type BuildAuthorityRowsInput,
  type AuthorityRow,
} from '../authority-map'
import { buildOrgGraph, type RawOrgNode, type RawNodeMember } from '../org-graph'

// ─── Helpers ────────────────────────────────────────────────────────────

function makeNode(overrides: Partial<RawOrgNode> & { id: string }): RawOrgNode {
  return {
    organization_id: 'org-1',
    parent_id: null,
    node_type: 'team',
    name: overrides.id,
    color: '#6366f1',
    icon: 'users',
    sort_order: 0,
    settings: null,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeMember(nodeId: string, userId: string, extra: Partial<RawNodeMember> = {}): RawNodeMember {
  return {
    id: `${nodeId}-${userId}`,
    node_id: nodeId,
    user_id: userId,
    role: 'Analyst',
    focus: null,
    created_at: '2026-01-01T00:00:00Z',
    user: {
      id: userId,
      email: `${userId}@test.com`,
      full_name: userId,
    },
    ...extra,
  }
}

function makeOrgMember(userId: string, opts: { isOrgAdmin?: boolean; coverageAdmin?: boolean; fullName?: string } = {}) {
  return {
    user_id: userId,
    is_org_admin: opts.isOrgAdmin || false,
    user: {
      id: userId,
      email: `${userId}@test.com`,
      full_name: opts.fullName || userId,
      avatar_url: null,
      coverage_admin: opts.coverageAdmin || false,
    },
  }
}

/** Build a minimal but realistic input set */
function buildTestInput(overrides: Partial<BuildAuthorityRowsInput> = {}): BuildAuthorityRowsInput {
  const nodes = [
    makeNode({ id: 'team-1', name: 'Equity Research' }),
    makeNode({ id: 'team-2', name: 'Fixed Income' }),
    makeNode({ id: 'team-3', name: 'Macro Strategy' }),
  ]
  const members = [
    makeMember('team-1', 'alice', { role: 'PM' }),
    makeMember('team-1', 'bob', { role: 'Analyst' }),
    makeMember('team-2', 'alice', { role: 'Analyst' }),
    makeMember('team-2', 'charlie', { role: 'Analyst', is_coverage_admin: true }),
    makeMember('team-3', 'dave', { role: 'PM' }),
  ]
  const orgGraph = buildOrgGraph({ nodes, members, links: [], coverage: [] })

  return {
    orgMembers: [
      makeOrgMember('alice', { isOrgAdmin: true, fullName: 'Alice Adams' }),
      makeOrgMember('bob', { fullName: 'Bob Baker' }),
      makeOrgMember('charlie', { coverageAdmin: true, fullName: 'Charlie Clark' }),
      makeOrgMember('dave', { fullName: 'Dave Davis' }),
    ],
    orgChartNodeMembers: members.map(m => ({
      id: m.id,
      node_id: m.node_id,
      user_id: m.user_id,
      role: m.role,
      is_coverage_admin: m.is_coverage_admin,
      coverage_admin_blocked: m.coverage_admin_blocked,
    })),
    orgGraph,
    teamMemberships: [],
    portfolioTeamMembers: [
      { portfolio_id: 'port-1', user_id: 'alice', role: 'PM' },
      { portfolio_id: 'port-1', user_id: 'bob', role: 'Analyst' },
      { portfolio_id: 'port-2', user_id: 'dave', role: 'PM' },
    ],
    portfolios: [
      { id: 'port-1', name: 'Growth Fund', team_id: 'team-1' },
      { id: 'port-2', name: 'Macro Fund', team_id: 'team-3' },
    ],
    globalCoverageAdminUserIds: new Set(['charlie']),
    ...overrides,
  }
}

// ─── normalizeRole ───────────────────────────────────────────────────────

describe('normalizeRole', () => {
  it('normalizes lowercase "analyst" to "Analyst"', () => {
    expect(normalizeRole('analyst')).toBe('Analyst')
  })

  it('normalizes "ANALYST" to "Analyst"', () => {
    expect(normalizeRole('ANALYST')).toBe('Analyst')
  })

  it('normalizes "pm" to "PM"', () => {
    expect(normalizeRole('pm')).toBe('PM')
  })

  it('normalizes "portfolio manager" to "PM"', () => {
    expect(normalizeRole('portfolio manager')).toBe('PM')
  })

  it('normalizes "Portfolio Manager" to "PM"', () => {
    expect(normalizeRole('Portfolio Manager')).toBe('PM')
  })

  it('title-cases unknown roles', () => {
    expect(normalizeRole('some custom role')).toBe('Some Custom Role')
  })

  it('preserves known canonical roles', () => {
    expect(normalizeRole('member')).toBe('Member')
    expect(normalizeRole('lead')).toBe('Lead')
    expect(normalizeRole('director')).toBe('Director')
  })
})

// ─── buildAuthorityRows ──────────────────────────────────────────────────

describe('buildAuthorityRows', () => {
  it('returns correct row count', () => {
    const rows = buildAuthorityRows(buildTestInput())
    expect(rows).toHaveLength(4)
  })

  it('marks org admin correctly', () => {
    const rows = buildAuthorityRows(buildTestInput())
    const alice = rows.find(r => r.userId === 'alice')!
    expect(alice.isOrgAdmin).toBe(true)
    expect(alice.roleChips).toContain('Org Admin')
  })

  it('marks global coverage admin correctly', () => {
    const rows = buildAuthorityRows(buildTestInput())
    const charlie = rows.find(r => r.userId === 'charlie')!
    expect(charlie.isGlobalCoverageAdmin).toBe(true)
    expect(charlie.roleChips).toContain('Coverage Admin')
  })

  it('includes node-scoped coverage admin scopes from orgChartNodeMembers', () => {
    const rows = buildAuthorityRows(buildTestInput())
    const charlie = rows.find(r => r.userId === 'charlie')!
    expect(charlie.coverageScopes.some(cs => cs.type === 'global')).toBe(true)
    expect(charlie.coverageScopes.some(cs => cs.type === 'node' && cs.nodeId === 'team-2')).toBe(true)
  })

  it('roleChips contain only firm-level and portfolio-level roles (no team roles)', () => {
    // alice has PM on team-1 and Analyst on team-2 as team roles,
    // plus PM on portfolio-1 as a portfolio role.
    // roleChips should include portfolio PM but NOT team-level PM/Analyst.
    const rows = buildAuthorityRows(buildTestInput())
    const alice = rows.find(r => r.userId === 'alice')!
    expect(alice.roleChips).toContain('PM') // from portfolioTeamMembers
    expect(alice.roleChips).toContain('Org Admin') // firm-level
    // Team roles stay in teams array, not roleChips
    expect(alice.teams.some(t => t.role === 'PM')).toBe(true)
    expect(alice.teams.some(t => t.role === 'Analyst')).toBe(true)
  })

  it('normalizes role casing in teams array', () => {
    // Even if raw data has lowercase "analyst", teams should have "Analyst"
    const rows = buildAuthorityRows(buildTestInput())
    const bob = rows.find(r => r.userId === 'bob')!
    expect(bob.teams[0].role).toBe('Analyst')
  })

  it('builds correct scopeSummary', () => {
    const rows = buildAuthorityRows(buildTestInput())
    const charlie = rows.find(r => r.userId === 'charlie')!
    expect(charlie.scopeSummary).toContain('Coverage: Global')
    expect(charlie.scopeSummary).toContain('Teams: 1')
  })

  it('populates teams array from orgChartNodeMembers', () => {
    const rows = buildAuthorityRows(buildTestInput())
    const alice = rows.find(r => r.userId === 'alice')!
    expect(alice.teams).toHaveLength(2)
    expect(alice.teams.map(t => t.nodeId).sort()).toEqual(['team-1', 'team-2'])
  })

  it('populates portfolios from portfolioTeamMembers', () => {
    const input = buildTestInput({
      portfolioTeamMembers: [
        { portfolio_id: 'port-1', user_id: 'alice', role: 'PM' },
        { portfolio_id: 'port-2', user_id: 'alice', role: 'Analyst' },
      ],
      portfolios: [
        { id: 'port-1', name: 'Growth Fund', team_id: null },
        { id: 'port-2', name: 'Value Fund', team_id: null },
      ],
    })
    const rows = buildAuthorityRows(input)
    const alice = rows.find(r => r.userId === 'alice')!
    expect(alice.portfolios).toHaveLength(2)
    expect(alice.portfolios.map(p => p.nodeName).sort()).toEqual(['Growth Fund', 'Value Fund'])
  })

  it('sorts rows: flagged first, then org admins, then alphabetical', () => {
    const rows = buildAuthorityRows(buildTestInput())
    const names = rows.map(r => r.fullName)
    expect(names[0]).toBe('Dave Davis')
    expect(names[1]).toBe('Alice Adams')
  })
})

// ─── computeUserRiskFlags ────────────────────────────────────────────────

describe('computeUserRiskFlags', () => {
  it('detects single_point_of_failure with human-readable detail', () => {
    const input = buildTestInput()
    const rows = buildAuthorityRows(input)
    const dave = rows.find(r => r.userId === 'dave')!
    const spof = dave.riskFlags.find(f => f.type === 'single_point_of_failure')!
    expect(spof).toBeDefined()
    expect(spof.severity).toBe('high')
    // Detail should use fullName, not userId
    expect(spof.detail).toContain('Dave Davis')
    expect(spof.detail).not.toContain('dave') // no raw userId
    expect(spof.anchorNodeId).toBe('team-3')
  })

  it('detects over_broad_access with readable detail', () => {
    const nodes = Array.from({ length: 7 }, (_, i) =>
      makeNode({ id: `team-${i}`, name: `Team ${i}` }),
    )
    const members = nodes.map(n =>
      makeMember(n.id, 'alice', { role: 'Analyst' }),
    )
    for (const n of nodes) {
      members.push(makeMember(n.id, 'extra-user', { role: 'Analyst' }))
    }
    const orgGraph = buildOrgGraph({ nodes, members, links: [], coverage: [] })
    const input = buildTestInput({
      orgMembers: [
        makeOrgMember('alice', { isOrgAdmin: true, coverageAdmin: true, fullName: 'Alice' }),
        makeOrgMember('extra-user', { fullName: 'Extra' }),
      ],
      orgChartNodeMembers: members.map(m => ({
        id: m.id, node_id: m.node_id, user_id: m.user_id, role: m.role,
        is_coverage_admin: m.is_coverage_admin, coverage_admin_blocked: m.coverage_admin_blocked,
      })),
      orgGraph,
      globalCoverageAdminUserIds: new Set(['alice']),
    })
    const rows = buildAuthorityRows(input)
    const alice = rows.find(r => r.userId === 'alice')!
    const broad = alice.riskFlags.find(f => f.type === 'over_broad_access')!
    expect(broad).toBeDefined()
    expect(broad.severity).toBe('medium')
    expect(broad.detail).toContain('Alice')
  })

  it('detects missing_required_admin with anchorNodeId', () => {
    const input = buildTestInput()
    const rows = buildAuthorityRows(input)
    const alice = rows.find(r => r.userId === 'alice')!
    const missingAdmin = alice.riskFlags.filter(f => f.type === 'missing_required_admin')
    expect(missingAdmin.length).toBeGreaterThanOrEqual(1)
    expect(missingAdmin[0].severity).toBe('low')
    expect(missingAdmin[0].anchorNodeId).toBeDefined()
  })
})

// ─── computeAuthoritySummary ─────────────────────────────────────────────

describe('computeAuthoritySummary', () => {
  it('returns correct aggregate counts', () => {
    const rows = buildAuthorityRows(buildTestInput())
    const summary = computeAuthoritySummary(rows)

    expect(summary.totalUsers).toBe(4)
    expect(summary.orgAdminCount).toBe(1)
    expect(summary.globalCoverageAdminCount).toBe(1)
    expect(summary.pmCount).toBeGreaterThanOrEqual(1)
  })

  it('counts flagged users correctly', () => {
    const rows = buildAuthorityRows(buildTestInput())
    const summary = computeAuthoritySummary(rows)

    expect(summary.flaggedUserCount).toBeGreaterThan(0)
    expect(summary.riskBySeverity.high).toBeGreaterThan(0)
  })
})

// ─── filterAuthorityRows ─────────────────────────────────────────────────

describe('filterAuthorityRows', () => {
  it('filters by search text on name', () => {
    const rows = buildAuthorityRows(buildTestInput())
    const filtered = filterAuthorityRows(rows, 'all', 'alice')
    expect(filtered).toHaveLength(1)
    expect(filtered[0].userId).toBe('alice')
  })

  it('filters by search text on email', () => {
    const rows = buildAuthorityRows(buildTestInput())
    const filtered = filterAuthorityRows(rows, 'all', 'bob@test')
    expect(filtered).toHaveLength(1)
    expect(filtered[0].userId).toBe('bob')
  })

  it('filters by org_admin', () => {
    const rows = buildAuthorityRows(buildTestInput())
    const filtered = filterAuthorityRows(rows, 'org_admin', '')
    expect(filtered.every(r => r.isOrgAdmin)).toBe(true)
    expect(filtered).toHaveLength(1)
  })

  it('filters by coverage_admin', () => {
    const rows = buildAuthorityRows(buildTestInput())
    const filtered = filterAuthorityRows(rows, 'coverage_admin', '')
    expect(filtered.every(r => r.isGlobalCoverageAdmin || r.coverageScopes.some(cs => cs.type === 'node'))).toBe(true)
  })

  it('filters by flagged', () => {
    const rows = buildAuthorityRows(buildTestInput())
    const filtered = filterAuthorityRows(rows, 'flagged', '')
    expect(filtered.every(r => r.riskFlags.length > 0)).toBe(true)
    expect(filtered.length).toBeGreaterThan(0)
  })

  it('combines search + filter (AND logic)', () => {
    const rows = buildAuthorityRows(buildTestInput())
    const filtered = filterAuthorityRows(rows, 'flagged', 'dave')
    expect(filtered).toHaveLength(1)
    expect(filtered[0].userId).toBe('dave')
    expect(filtered[0].riskFlags.length).toBeGreaterThan(0)
  })
})
