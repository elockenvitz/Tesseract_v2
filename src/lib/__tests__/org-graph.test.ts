import { describe, it, expect } from 'vitest'
import {
  buildOrgGraph,
  computeRiskFlags,
  computeNodeHealth,
  computeGovernanceSummary,
  getSubtree,
  getAncestors,
  getDescendants,
  getChildren,
  findNodes,
  getNodesWithRisks,
  getNodesByType,
  flattenTree,
  getRiskCountsBySeverity,
  OVERLOADED_ASSET_THRESHOLD,
  OVERLOADED_PORTFOLIO_THRESHOLD,
  ADMIN_SPF_HIGH_MEMBERS,
  ADMIN_SPF_HIGH_TEAMS,
  ADMIN_SPF_MED_MEMBERS,
  ADMIN_SPF_MED_TEAMS,
  type RawOrgNode,
  type RawNodeMember,
  type RawNodeLink,
  type CoverageRecord,
  type AnalystStats,
} from '../org-graph'

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
    ...extra,
  }
}

// ─── buildOrgGraph ──────────────────────────────────────────────────────

describe('buildOrgGraph', () => {
  it('builds an empty graph from empty input', () => {
    const graph = buildOrgGraph({ nodes: [], members: [], links: [], coverage: [] })
    expect(graph.totalNodes).toBe(0)
    expect(graph.rootIds).toEqual([])
    expect(graph.overallHealth).toBe(100)
  })

  it('builds a single root node', () => {
    const nodes = [makeNode({ id: 'A', node_type: 'division' })]
    const graph = buildOrgGraph({ nodes, members: [], links: [], coverage: [] })
    expect(graph.totalNodes).toBe(1)
    expect(graph.rootIds).toEqual(['A'])
    const a = graph.nodes.get('A')!
    expect(a.depth).toBe(0)
    expect(a.path).toEqual([])
    expect(a.childIds).toEqual([])
  })

  it('builds a tree with correct depth and path', () => {
    const nodes = [
      makeNode({ id: 'root', node_type: 'division', sort_order: 0 }),
      makeNode({ id: 'dept', parent_id: 'root', node_type: 'department', sort_order: 0 }),
      makeNode({ id: 'team', parent_id: 'dept', node_type: 'team', sort_order: 0 }),
    ]
    const graph = buildOrgGraph({ nodes, members: [], links: [], coverage: [] })

    const root = graph.nodes.get('root')!
    expect(root.depth).toBe(0)
    expect(root.path).toEqual([])
    expect(root.childIds).toEqual(['dept'])

    const dept = graph.nodes.get('dept')!
    expect(dept.depth).toBe(1)
    expect(dept.path).toEqual(['root'])

    const team = graph.nodes.get('team')!
    expect(team.depth).toBe(2)
    expect(team.path).toEqual(['root', 'dept'])
  })

  it('counts members correctly', () => {
    const nodes = [
      makeNode({ id: 'team1', node_type: 'team' }),
    ]
    const members = [
      makeMember('team1', 'user-a'),
      makeMember('team1', 'user-b'),
    ]
    const graph = buildOrgGraph({ nodes, members, links: [], coverage: [] })
    const t = graph.nodes.get('team1')!
    expect(t.memberCount).toBe(2)
    expect(graph.totalMembers).toBe(2)
  })

  it('deduplicates members by user_id', () => {
    const nodes = [makeNode({ id: 't', node_type: 'team' })]
    const members = [
      makeMember('t', 'user-a'),
      { ...makeMember('t', 'user-a'), id: 't-user-a-dupe' }, // same user, different membership record
    ]
    const graph = buildOrgGraph({ nodes, members, links: [], coverage: [] })
    expect(graph.nodes.get('t')!.memberCount).toBe(1)
  })

  it('computes recursive aggregates', () => {
    const nodes = [
      makeNode({ id: 'div', node_type: 'division' }),
      makeNode({ id: 'team', parent_id: 'div', node_type: 'team' }),
      makeNode({ id: 'port', parent_id: 'team', node_type: 'portfolio' }),
    ]
    const members = [
      makeMember('team', 'u1'),
      makeMember('port', 'u2'),
    ]
    const graph = buildOrgGraph({ nodes, members, links: [], coverage: [] })

    const div = graph.nodes.get('div')!
    expect(div.totalNodeCount).toBe(3)
    expect(div.totalMemberCount).toBe(2) // u1 + u2
    expect(div.totalPortfolioCount).toBe(1)

    const team = graph.nodes.get('team')!
    expect(team.portfolioCount).toBe(1) // direct portfolio child
    expect(team.totalPortfolioCount).toBe(1)
  })

  it('deduplicates totalMemberCount across subtree levels', () => {
    const nodes = [
      makeNode({ id: 'div', node_type: 'division' }),
      makeNode({ id: 'team', parent_id: 'div', node_type: 'team' }),
      makeNode({ id: 'port', parent_id: 'team', node_type: 'portfolio' }),
    ]
    // u1 appears at both team and portfolio level
    const members = [
      makeMember('team', 'u1'),
      makeMember('port', 'u1'),
      makeMember('port', 'u2'),
    ]
    const graph = buildOrgGraph({ nodes, members, links: [], coverage: [] })

    const team = graph.nodes.get('team')!
    expect(team.totalMemberCount).toBe(2) // u1 + u2, not 3

    const div = graph.nodes.get('div')!
    expect(div.totalMemberCount).toBe(2) // same two unique users
  })

  it('includes linked portfolio members in totalMemberCount', () => {
    const nodes = [
      makeNode({ id: 'div', node_type: 'division' }),
      makeNode({ id: 'team', parent_id: 'div', node_type: 'team' }),
      makeNode({ id: 'port', parent_id: 'div', node_type: 'portfolio' }), // portfolio is sibling, NOT child of team
    ]
    const members = [
      makeMember('team', 'u1'),
      makeMember('team', 'u2'),
      makeMember('port', 'u3'),
      makeMember('port', 'u4'),
    ]
    const links: RawNodeLink[] = [
      { id: 'link1', node_id: 'port', linked_node_id: 'team' },
    ]
    const graph = buildOrgGraph({ nodes, members, links, coverage: [] })

    const team = graph.nodes.get('team')!
    // Team has 2 direct + 2 from linked portfolio = 4 unique users
    expect(team.totalMemberCount).toBe(4)

    // Division sees all 4 via its two children (team subtree + portfolio subtree)
    const div = graph.nodes.get('div')!
    expect(div.totalMemberCount).toBe(4)
  })

  it('deduplicates linked portfolio members already counted as direct', () => {
    const nodes = [
      makeNode({ id: 'team', node_type: 'team' }),
      makeNode({ id: 'port', node_type: 'portfolio' }),
    ]
    const members = [
      makeMember('team', 'u1'),
      makeMember('port', 'u1'), // same user in both
      makeMember('port', 'u2'),
    ]
    const links: RawNodeLink[] = [
      { id: 'link1', node_id: 'port', linked_node_id: 'team' },
    ]
    const graph = buildOrgGraph({ nodes, members, links, coverage: [] })

    const team = graph.nodes.get('team')!
    expect(team.totalMemberCount).toBe(2) // u1 + u2, deduplicated
  })

  it('computes coverage stats for team nodes', () => {
    const nodes = [
      makeNode({ id: 'team', node_type: 'team' }),
      makeNode({ id: 'port', parent_id: 'team', node_type: 'portfolio' }),
    ]
    const members = [
      makeMember('port', 'analyst1'),
      makeMember('port', 'analyst2'),
    ]
    const coverage: CoverageRecord[] = [
      { asset_id: 'AAPL', user_id: 'analyst1' },
      { asset_id: 'MSFT', user_id: 'analyst1' },
      { asset_id: 'GOOG', user_id: 'analyst2' },
    ]
    const graph = buildOrgGraph({ nodes, members, links: [], coverage })
    const team = graph.nodes.get('team')!
    expect(team.coverageAssetCount).toBe(3)
    expect(team.coverageAnalystCount).toBe(2)
  })

  it('handles links for shared portfolios', () => {
    const nodes = [
      makeNode({ id: 'teamA', node_type: 'team' }),
      makeNode({ id: 'teamB', node_type: 'team' }),
      makeNode({ id: 'port', parent_id: 'teamA', node_type: 'portfolio' }),
    ]
    const links: RawNodeLink[] = [
      { id: 'link1', node_id: 'port', linked_node_id: 'teamB' },
    ]
    const members = [makeMember('port', 'u1')]
    const coverage: CoverageRecord[] = [
      { asset_id: 'AAPL', user_id: 'u1' },
    ]
    const graph = buildOrgGraph({ nodes, members, links, coverage })

    // teamA owns the portfolio directly
    expect(graph.nodes.get('teamA')!.coverageAssetCount).toBe(1)
    // teamB gets coverage via link
    expect(graph.nodes.get('teamB')!.coverageAssetCount).toBe(1)
    // portfolio has link reference
    expect(graph.nodes.get('port')!.linkedNodeIds).toContain('teamB')
  })

  it('sorts root and child IDs by sort_order', () => {
    const nodes = [
      makeNode({ id: 'b', sort_order: 2 }),
      makeNode({ id: 'a', sort_order: 1 }),
      makeNode({ id: 'c', sort_order: 0 }),
    ]
    const graph = buildOrgGraph({ nodes, members: [], links: [], coverage: [] })
    expect(graph.rootIds).toEqual(['c', 'a', 'b'])
  })
})

// ─── computeRiskFlags ───────────────────────────────────────────────────

describe('computeRiskFlags', () => {
  it('flags empty team', () => {
    const node = makeNode({ id: 't', node_type: 'team' })
    const flags = computeRiskFlags(node, [], 0, { assetCount: 0, analystCount: 0 }, [])
    expect(flags.some(f => f.type === 'empty_team')).toBe(true)
  })

  it('flags no portfolios for team', () => {
    const node = makeNode({ id: 't', node_type: 'team' })
    const members = [makeMember('t', 'u1')]
    const flags = computeRiskFlags(node, members, 0, { assetCount: 0, analystCount: 0 }, [])
    expect(flags.some(f => f.type === 'no_portfolios')).toBe(true)
  })

  it('flags single point of failure', () => {
    const node = makeNode({ id: 't', node_type: 'team' })
    const members = [makeMember('t', 'u1')]
    const flags = computeRiskFlags(node, members, 1, { assetCount: 5, analystCount: 1 }, [])
    expect(flags.some(f => f.type === 'single_point_failure')).toBe(true)
  })

  it('does not flag single point with <= 3 assets', () => {
    const node = makeNode({ id: 't', node_type: 'team' })
    const members = [makeMember('t', 'u1')]
    const flags = computeRiskFlags(node, members, 1, { assetCount: 3, analystCount: 1 }, [])
    expect(flags.some(f => f.type === 'single_point_failure')).toBe(false)
  })

  it('flags missing coverage admin', () => {
    const node = makeNode({ id: 't', node_type: 'team' })
    const members = [makeMember('t', 'u1')]
    const flags = computeRiskFlags(node, members, 1, { assetCount: 5, analystCount: 2 }, [])
    expect(flags.some(f => f.type === 'missing_coverage_admin')).toBe(true)
  })

  it('does not flag missing coverage admin when one exists', () => {
    const node = makeNode({ id: 't', node_type: 'team' })
    const members = [makeMember('t', 'u1', { is_coverage_admin: true })]
    const flags = computeRiskFlags(node, members, 1, { assetCount: 5, analystCount: 2 }, [])
    expect(flags.some(f => f.type === 'missing_coverage_admin')).toBe(false)
  })

  it('does not flag non-team nodes (divisions)', () => {
    const node = makeNode({ id: 'd', node_type: 'division' })
    const flags = computeRiskFlags(node, [], 0, { assetCount: 0, analystCount: 0 }, [])
    expect(flags).toEqual([])
  })

  // ── orphaned_portfolio ──

  it('flags orphaned portfolio (no members)', () => {
    const node = makeNode({ id: 'p', node_type: 'portfolio' })
    const flags = computeRiskFlags(node, [], 0, { assetCount: 0, analystCount: 0 }, [])
    expect(flags.some(f => f.type === 'orphaned_portfolio')).toBe(true)
    expect(flags.find(f => f.type === 'orphaned_portfolio')!.severity).toBe('high')
  })

  it('does not flag portfolio with members', () => {
    const node = makeNode({ id: 'p', node_type: 'portfolio' })
    const members = [makeMember('p', 'u1')]
    const flags = computeRiskFlags(node, members, 0, { assetCount: 0, analystCount: 0 }, [])
    expect(flags.some(f => f.type === 'orphaned_portfolio')).toBe(false)
  })

  // ── no_pm_assigned ──

  it('flags team with no PM role', () => {
    const node = makeNode({ id: 't', node_type: 'team' })
    const members = [
      makeMember('t', 'u1', { role: 'Analyst' }),
      makeMember('t', 'u2', { role: 'Research Associate' }),
    ]
    const flags = computeRiskFlags(node, members, 1, { assetCount: 5, analystCount: 2 }, [])
    expect(flags.some(f => f.type === 'no_pm_assigned')).toBe(true)
    expect(flags.find(f => f.type === 'no_pm_assigned')!.severity).toBe('high')
  })

  it('does not flag when PM role exists', () => {
    const node = makeNode({ id: 't', node_type: 'team' })
    const members = [
      makeMember('t', 'u1', { role: 'Portfolio Manager' }),
      makeMember('t', 'u2', { role: 'Analyst' }),
    ]
    const flags = computeRiskFlags(node, members, 1, { assetCount: 5, analystCount: 2 }, [])
    expect(flags.some(f => f.type === 'no_pm_assigned')).toBe(false)
  })

  it('recognizes PM abbreviation in role', () => {
    const node = makeNode({ id: 't', node_type: 'team' })
    const members = [makeMember('t', 'u1', { role: 'PM' })]
    const flags = computeRiskFlags(node, members, 1, { assetCount: 5, analystCount: 1 }, [])
    expect(flags.some(f => f.type === 'no_pm_assigned')).toBe(false)
  })

  it('does not flag no_pm for empty team', () => {
    const node = makeNode({ id: 't', node_type: 'team' })
    const flags = computeRiskFlags(node, [], 0, { assetCount: 0, analystCount: 0 }, [])
    expect(flags.some(f => f.type === 'no_pm_assigned')).toBe(false)
  })

  // ── overloaded_analyst ──

  it('flags overloaded analyst exceeding asset threshold', () => {
    const node = makeNode({ id: 't', node_type: 'team' })
    const members = [makeMember('t', 'u1')]
    const stats = new Map<string, AnalystStats>([
      ['u1', { assetCount: OVERLOADED_ASSET_THRESHOLD + 1, portfolioMembershipCount: 1 }],
    ])
    const flags = computeRiskFlags(node, members, 1, { assetCount: 10, analystCount: 1 }, [], stats)
    expect(flags.some(f => f.type === 'overloaded_analyst')).toBe(true)
    expect(flags.find(f => f.type === 'overloaded_analyst')!.severity).toBe('medium')
  })

  it('flags overloaded analyst exceeding portfolio threshold', () => {
    const node = makeNode({ id: 't', node_type: 'team' })
    const members = [makeMember('t', 'u1')]
    const stats = new Map<string, AnalystStats>([
      ['u1', { assetCount: 5, portfolioMembershipCount: OVERLOADED_PORTFOLIO_THRESHOLD + 1 }],
    ])
    const flags = computeRiskFlags(node, members, 1, { assetCount: 5, analystCount: 1 }, [], stats)
    expect(flags.some(f => f.type === 'overloaded_analyst')).toBe(true)
  })

  it('does not flag when analyst is within thresholds', () => {
    const node = makeNode({ id: 't', node_type: 'team' })
    const members = [makeMember('t', 'u1')]
    const stats = new Map<string, AnalystStats>([
      ['u1', { assetCount: OVERLOADED_ASSET_THRESHOLD, portfolioMembershipCount: OVERLOADED_PORTFOLIO_THRESHOLD }],
    ])
    const flags = computeRiskFlags(node, members, 1, { assetCount: 10, analystCount: 1 }, [], stats)
    expect(flags.some(f => f.type === 'overloaded_analyst')).toBe(false)
  })

  it('does not flag overloaded when no stats provided', () => {
    const node = makeNode({ id: 't', node_type: 'team' })
    const members = [makeMember('t', 'u1')]
    const flags = computeRiskFlags(node, members, 1, { assetCount: 10, analystCount: 1 }, [])
    expect(flags.some(f => f.type === 'overloaded_analyst')).toBe(false)
  })
})

// ─── admin_single_point_failure (post-processing in buildOrgGraph) ─────

describe('admin_single_point_failure risk flag', () => {
  /**
   * Helper: builds a subtree with N teams under a department, each with members.
   * membersPerTeam controls how many members each team gets.
   * adminUserIds are the user IDs that should be marked as is_org_admin.
   */
  function buildAdminTestGraph(opts: {
    teamCount: number
    membersPerTeam: number
    adminUserIds: string[]
  }) {
    const nodes = [
      makeNode({ id: 'root', node_type: 'division' }),
      makeNode({ id: 'dept', parent_id: 'root', node_type: 'department' }),
    ]
    const members: RawNodeMember[] = []
    const adminSet = new Set(opts.adminUserIds)

    for (let t = 0; t < opts.teamCount; t++) {
      const teamId = `team-${t}`
      nodes.push(makeNode({ id: teamId, parent_id: 'dept', node_type: 'team' }))
      for (let m = 0; m < opts.membersPerTeam; m++) {
        const userId = `u-${t}-${m}`
        members.push(makeMember(teamId, userId, {
          role: 'PM',
          is_org_admin: adminSet.has(userId),
        }))
      }
    }
    // Place org admins explicitly if they aren't already in teams
    for (const adminId of opts.adminUserIds) {
      if (!members.some(m => m.user_id === adminId)) {
        members.push(makeMember('team-0', adminId, { role: 'PM', is_org_admin: true }))
      }
    }

    return buildOrgGraph({ nodes, members, links: [], coverage: [] })
  }

  it('flags HIGH when 0 admins in subtree with ≥8 members', () => {
    // 2 teams × 4 members each = 8 members, 0 admins
    const graph = buildAdminTestGraph({ teamCount: 2, membersPerTeam: 4, adminUserIds: [] })
    const dept = graph.nodes.get('dept')!
    const flag = dept.riskFlags.find(f => f.type === 'admin_single_point_failure')
    expect(flag).toBeDefined()
    expect(flag!.severity).toBe('high')
    expect(flag!.label).toContain('No org admin')
  })

  it('flags HIGH when 1 admin in subtree with ≥2 teams', () => {
    // 2 teams, 2 members each, 1 admin
    const graph = buildAdminTestGraph({ teamCount: 2, membersPerTeam: 2, adminUserIds: ['u-0-0'] })
    const dept = graph.nodes.get('dept')!
    const flag = dept.riskFlags.find(f => f.type === 'admin_single_point_failure')
    expect(flag).toBeDefined()
    expect(flag!.severity).toBe('high')
    expect(flag!.label).toContain('Only 1 org admin')
  })

  it('flags MED when 2 admins in subtree with ≥12 members', () => {
    // 3 teams × 4 members each = 12 members, 2 admins
    const graph = buildAdminTestGraph({ teamCount: 3, membersPerTeam: 4, adminUserIds: ['u-0-0', 'u-1-0'] })
    const dept = graph.nodes.get('dept')!
    const flag = dept.riskFlags.find(f => f.type === 'admin_single_point_failure')
    expect(flag).toBeDefined()
    expect(flag!.severity).toBe('medium')
    expect(flag!.label).toContain('Only 2 org admins')
  })

  it('flags MED when 2 admins in subtree with ≥3 teams', () => {
    // 3 teams × 2 members each = 6 members, 2 admins
    const graph = buildAdminTestGraph({ teamCount: 3, membersPerTeam: 2, adminUserIds: ['u-0-0', 'u-1-0'] })
    const dept = graph.nodes.get('dept')!
    const flag = dept.riskFlags.find(f => f.type === 'admin_single_point_failure')
    expect(flag).toBeDefined()
    expect(flag!.severity).toBe('medium')
  })

  it('does NOT flag when subtree is too small', () => {
    // 1 team × 3 members = 3 members, 0 admins → subtree too small
    const graph = buildAdminTestGraph({ teamCount: 1, membersPerTeam: 3, adminUserIds: [] })
    const dept = graph.nodes.get('dept')!
    expect(dept.riskFlags.some(f => f.type === 'admin_single_point_failure')).toBe(false)
  })

  it('does NOT flag when enough admins for the subtree size', () => {
    // 2 teams × 4 members = 8 members, 2 admins → enough for HIGH threshold
    const graph = buildAdminTestGraph({ teamCount: 2, membersPerTeam: 4, adminUserIds: ['u-0-0', 'u-1-0'] })
    const dept = graph.nodes.get('dept')!
    expect(dept.riskFlags.some(f => f.type === 'admin_single_point_failure')).toBe(false)
  })

  it('does NOT flag 2-admin subtree below MED thresholds', () => {
    // 2 teams × 5 members = 10 members (< 12), 2 teams (< 3), 2 admins → no flag
    const graph = buildAdminTestGraph({ teamCount: 2, membersPerTeam: 5, adminUserIds: ['u-0-0', 'u-1-0'] })
    const dept = graph.nodes.get('dept')!
    expect(dept.riskFlags.some(f => f.type === 'admin_single_point_failure')).toBe(false)
  })

  it('does NOT flag leaf nodes (no children)', () => {
    const nodes = [
      makeNode({ id: 'team', node_type: 'team' }),
    ]
    const members = Array.from({ length: 10 }, (_, i) =>
      makeMember('team', `u-${i}`, { role: 'PM' }),
    )
    const graph = buildOrgGraph({ nodes, members, links: [], coverage: [] })
    const team = graph.nodes.get('team')!
    expect(team.riskFlags.some(f => f.type === 'admin_single_point_failure')).toBe(false)
  })

  it('exports threshold constants', () => {
    expect(ADMIN_SPF_HIGH_MEMBERS).toBe(8)
    expect(ADMIN_SPF_HIGH_TEAMS).toBe(2)
    expect(ADMIN_SPF_MED_MEMBERS).toBe(12)
    expect(ADMIN_SPF_MED_TEAMS).toBe(3)
  })
})

// ─── getRiskCountsBySeverity ────────────────────────────────────────────

describe('getRiskCountsBySeverity', () => {
  it('returns zeros for empty graph', () => {
    const graph = buildOrgGraph({ nodes: [], members: [], links: [], coverage: [] })
    const counts = getRiskCountsBySeverity(graph)
    expect(counts).toEqual({ high: 0, medium: 0, low: 0, total: 0 })
  })

  it('counts risks by severity across graph', () => {
    const nodes = [
      makeNode({ id: 'team1', node_type: 'team' }),
      makeNode({ id: 'team2', node_type: 'team' }),
      makeNode({ id: 'port', parent_id: 'team1', node_type: 'portfolio' }),
    ]
    // team1: has a member but no PM → high (no_pm), has portfolio → ok
    // team2: empty → high (empty_team), no portfolios → medium (no_portfolios)
    // port: orphaned → high (orphaned_portfolio)
    const members = [makeMember('team1', 'u1')]
    const graph = buildOrgGraph({ nodes, members, links: [], coverage: [] })
    const counts = getRiskCountsBySeverity(graph)
    expect(counts.high).toBeGreaterThan(0)
    expect(counts.total).toBeGreaterThan(0)
  })

  it('integrates with buildOrgGraph for overloaded analyst', () => {
    const nodes = [
      makeNode({ id: 'team', node_type: 'team' }),
      makeNode({ id: 'port', parent_id: 'team', node_type: 'portfolio' }),
    ]
    // Create an analyst in the portfolio with lots of coverage
    const members = [
      makeMember('team', 'overloaded-user', { role: 'PM' }),
      makeMember('port', 'overloaded-user'),
    ]
    // Give them 61+ assets
    const coverage: CoverageRecord[] = Array.from({ length: OVERLOADED_ASSET_THRESHOLD + 1 }, (_, i) => ({
      asset_id: `ASSET-${i}`,
      user_id: 'overloaded-user',
    }))
    const graph = buildOrgGraph({ nodes, members, links: [], coverage })
    const teamNode = graph.nodes.get('team')!
    expect(teamNode.riskFlags.some(f => f.type === 'overloaded_analyst')).toBe(true)
  })
})

// ─── computeNodeHealth ──────────────────────────────────────────────────

describe('computeNodeHealth', () => {
  it('returns 100 for non-investment nodes', () => {
    const node = makeNode({ id: 't', is_non_investment: true })
    expect(computeNodeHealth(node, [], 0, 0, { assetCount: 0, analystCount: 0 })).toBe(100)
  })

  it('returns 100 for perfect team node', () => {
    const node = makeNode({ id: 't', node_type: 'team' })
    expect(computeNodeHealth(node, [], 3, 2, { assetCount: 10, analystCount: 3 })).toBe(100)
  })

  it('deducts for empty team (no members, no portfolios, no coverage)', () => {
    const node = makeNode({ id: 't', node_type: 'team' })
    const flags = computeRiskFlags(node, [], 0, { assetCount: 0, analystCount: 0 }, [])
    const score = computeNodeHealth(node, flags, 0, 0, { assetCount: 0, analystCount: 0 })
    // Gets 0 (no members) + 0 (no portfolios) + 0 (no coverage) + 0 (high risk) + 0 (medium risk) = 0
    expect(score).toBe(0)
  })

  it('non-team nodes get portfolio and coverage points for free', () => {
    const node = makeNode({ id: 'd', node_type: 'division' })
    // Has members, no risks → 25 + 20 + 25 + 20 + 10 = 100
    expect(computeNodeHealth(node, [], 1, 0, { assetCount: 0, analystCount: 0 })).toBe(100)
  })
})

// ─── Traversal helpers ──────────────────────────────────────────────────

describe('traversal helpers', () => {
  function buildTestGraph() {
    const nodes = [
      makeNode({ id: 'root', node_type: 'division', sort_order: 0 }),
      makeNode({ id: 'dept', parent_id: 'root', node_type: 'department', sort_order: 0 }),
      makeNode({ id: 'team1', parent_id: 'dept', node_type: 'team', sort_order: 0 }),
      makeNode({ id: 'team2', parent_id: 'dept', node_type: 'team', sort_order: 1 }),
      makeNode({ id: 'port', parent_id: 'team1', node_type: 'portfolio', sort_order: 0 }),
    ]
    return buildOrgGraph({ nodes, members: [], links: [], coverage: [] })
  }

  it('getSubtree returns node and all descendants', () => {
    const graph = buildTestGraph()
    const subtree = getSubtree(graph, 'dept')
    const ids = subtree.map(n => n.id)
    expect(ids).toEqual(['dept', 'team1', 'port', 'team2'])
  })

  it('getAncestors returns path from root', () => {
    const graph = buildTestGraph()
    const ancestors = getAncestors(graph, 'team1')
    expect(ancestors.map(n => n.id)).toEqual(['root', 'dept'])
  })

  it('getDescendants excludes self', () => {
    const graph = buildTestGraph()
    const descs = getDescendants(graph, 'dept')
    expect(descs.map(n => n.id)).toEqual(['team1', 'port', 'team2'])
  })

  it('getChildren returns direct children', () => {
    const graph = buildTestGraph()
    const children = getChildren(graph, 'dept')
    expect(children.map(n => n.id)).toEqual(['team1', 'team2'])
  })

  it('findNodes with predicate', () => {
    const graph = buildTestGraph()
    const teams = findNodes(graph, n => n.nodeType === 'team')
    expect(teams.map(n => n.id).sort()).toEqual(['team1', 'team2'])
  })

  it('getNodesWithRisks finds flagged nodes', () => {
    const nodes = [
      makeNode({ id: 'team', node_type: 'team' }),
    ]
    const graph = buildOrgGraph({ nodes, members: [], links: [], coverage: [] })
    const risky = getNodesWithRisks(graph)
    expect(risky.length).toBe(1)
    expect(risky[0].id).toBe('team')
  })

  it('getNodesByType filters correctly', () => {
    const graph = buildTestGraph()
    expect(getNodesByType(graph, 'portfolio').length).toBe(1)
    expect(getNodesByType(graph, 'team').length).toBe(2)
    expect(getNodesByType(graph, 'division').length).toBe(1)
  })

  it('flattenTree returns all nodes in DFS order', () => {
    const graph = buildTestGraph()
    const flat = flattenTree(graph)
    expect(flat.map(n => n.id)).toEqual(['root', 'dept', 'team1', 'port', 'team2'])
  })
})

// ─── Membership semantics (direct / derived / total) ─────────────────────

describe('membership semantics', () => {
  it('computes directMemberCount and derivedMemberCount for team with portfolios', () => {
    // Team has 2 direct members. Portfolio child has 3 members, 1 overlapping.
    const nodes = [
      makeNode({ id: 'team1', node_type: 'team' }),
      makeNode({ id: 'port1', node_type: 'portfolio', parent_id: 'team1' }),
    ]
    const members = [
      makeMember('team1', 'u1'),
      makeMember('team1', 'u2'),
      makeMember('port1', 'u1'), // overlaps with direct
      makeMember('port1', 'u3'),
      makeMember('port1', 'u4'),
    ]
    const graph = buildOrgGraph({ nodes, members, links: [], coverage: [] })
    const team = graph.nodes.get('team1')!

    expect(team.directMemberCount).toBe(2) // u1, u2
    expect(team.derivedMemberCount).toBe(2) // u3, u4 (u1 excluded — already direct)
    expect(team.effectiveMemberCount).toBe(4) // directMemberCount + derivedMemberCount
    expect(team.memberCount).toBe(2) // same as directMemberCount
  })

  it('team with 0 direct but derived members does NOT get empty_team risk', () => {
    const nodes = [
      makeNode({ id: 'team1', node_type: 'team' }),
      makeNode({ id: 'port1', node_type: 'portfolio', parent_id: 'team1' }),
    ]
    const members = [
      makeMember('port1', 'u1'),
      makeMember('port1', 'u2'),
      makeMember('port1', 'u3'),
    ]
    const graph = buildOrgGraph({ nodes, members, links: [], coverage: [] })
    const team = graph.nodes.get('team1')!

    expect(team.directMemberCount).toBe(0)
    expect(team.derivedMemberCount).toBe(3)
    expect(team.effectiveMemberCount).toBe(3)

    expect(team.riskFlags.find(f => f.type === 'empty_team')).toBeUndefined()
  })

  it('team with 0 direct and 0 derived gets HIGH empty_team risk', () => {
    const nodes = [makeNode({ id: 'team1', node_type: 'team' })]
    const graph = buildOrgGraph({ nodes, members: [], links: [], coverage: [] })
    const team = graph.nodes.get('team1')!

    expect(team.directMemberCount).toBe(0)
    expect(team.derivedMemberCount).toBe(0)
    expect(team.effectiveMemberCount).toBe(0)

    const emptyTeam = team.riskFlags.find(f => f.type === 'empty_team')
    expect(emptyTeam).toBeDefined()
    expect(emptyTeam!.severity).toBe('high')
  })

  it('team with direct members has no empty_team risk', () => {
    const nodes = [makeNode({ id: 'team1', node_type: 'team' })]
    const members = [makeMember('team1', 'u1'), makeMember('team1', 'u2')]
    const graph = buildOrgGraph({ nodes, members, links: [], coverage: [] })
    const team = graph.nodes.get('team1')!

    expect(team.directMemberCount).toBe(2)
    expect(team.effectiveMemberCount).toBe(2)
    expect(team.riskFlags.find(f => f.type === 'empty_team')).toBeUndefined()
  })

  it('non-team nodes have derivedMemberCount of 0', () => {
    const nodes = [makeNode({ id: 'div1', node_type: 'division' })]
    const members = [makeMember('div1', 'u1')]
    const graph = buildOrgGraph({ nodes, members, links: [], coverage: [] })
    const div = graph.nodes.get('div1')!

    expect(div.directMemberCount).toBe(1)
    expect(div.derivedMemberCount).toBe(0)
  })
})

// ─── computeGovernanceSummary ────────────────────────────────────────────

describe('computeGovernanceSummary', () => {
  it('memberUniqueCount dedupes same user across multiple nodes', () => {
    const nodes = [
      makeNode({ id: 'team1', node_type: 'team' }),
      makeNode({ id: 'team2', node_type: 'team' }),
    ]
    const members = [
      makeMember('team1', 'u1'),
      makeMember('team1', 'u2'),
      makeMember('team2', 'u1'), // same user in second team
      makeMember('team2', 'u3'),
    ]
    const graph = buildOrgGraph({ nodes, members, links: [], coverage: [] })
    const summary = computeGovernanceSummary(
      graph,
      members,
      [{ user_id: 'u1', is_org_admin: false }, { user_id: 'u2', is_org_admin: false }, { user_id: 'u3', is_org_admin: false }],
    )

    expect(summary.memberUniqueCount).toBe(3) // u1, u2, u3
    expect(summary.teamCount).toBe(2)
    expect(summary.nodeCount).toBe(2)
  })

  it('orgAdminCount dedupes admins by user_id', () => {
    const nodes = [makeNode({ id: 'team1', node_type: 'team' })]
    const members = [makeMember('team1', 'u1')]
    const graph = buildOrgGraph({ nodes, members, links: [], coverage: [] })
    // Even if someone provides duplicate membership entries, should still dedupe
    const summary = computeGovernanceSummary(
      graph,
      members,
      [
        { user_id: 'u1', is_org_admin: true },
        { user_id: 'u2', is_org_admin: true },
        { user_id: 'u3', is_org_admin: false },
      ],
    )

    expect(summary.orgAdminCount).toBe(2) // u1, u2
  })

  it('coverageAdminCount includes global + scoped, deduped', () => {
    const nodes = [
      makeNode({ id: 'team1', node_type: 'team' }),
      makeNode({ id: 'team2', node_type: 'team' }),
    ]
    const members = [
      makeMember('team1', 'u1', { is_coverage_admin: true }),
      makeMember('team2', 'u1', { is_coverage_admin: true }), // same user, scoped to second node
      makeMember('team1', 'u2'),
      makeMember('team2', 'u3', { is_coverage_admin: true }),
    ]
    const globalCovAdmins = new Set(['u4', 'u1']) // u4 is global-only, u1 overlaps with scoped

    const graph = buildOrgGraph({ nodes, members, links: [], coverage: [] })
    const summary = computeGovernanceSummary(
      graph,
      members,
      [{ user_id: 'u1', is_org_admin: false }, { user_id: 'u2', is_org_admin: false }, { user_id: 'u3', is_org_admin: false }, { user_id: 'u4', is_org_admin: false }],
      globalCovAdmins,
    )

    // u1 (global + scoped), u3 (scoped), u4 (global) = 3 unique
    expect(summary.coverageAdminCount).toBe(3)
  })

  it('coverageAdminCount excludes blocked coverage admins', () => {
    const nodes = [makeNode({ id: 'team1', node_type: 'team' })]
    const members = [
      makeMember('team1', 'u1', { is_coverage_admin: true }),
      makeMember('team1', 'u2', { is_coverage_admin: true, coverage_admin_blocked: true }),
    ]
    const graph = buildOrgGraph({ nodes, members, links: [], coverage: [] })
    const summary = computeGovernanceSummary(
      graph,
      members,
      [{ user_id: 'u1', is_org_admin: false }, { user_id: 'u2', is_org_admin: false }],
    )

    expect(summary.coverageAdminCount).toBe(1) // u2 is blocked
  })

  it('riskFlagCount reflects total flags across graph', () => {
    const nodes = [
      makeNode({ id: 'team1', node_type: 'team' }),
      makeNode({ id: 'team2', node_type: 'team' }),
    ]
    // Both teams are empty → each gets empty_team risk (HIGH)
    const graph = buildOrgGraph({ nodes, members: [], links: [], coverage: [] })
    const summary = computeGovernanceSummary(graph, [], [], new Set())

    // Each empty team has at least empty_team risk
    expect(summary.riskFlagCount).toBeGreaterThanOrEqual(2)
    expect(summary.riskBySeverity.high).toBeGreaterThanOrEqual(2)
  })

  it('counts are stable regardless of which members are in which node', () => {
    // Same users distributed differently — summary should yield same member count
    const nodes = [
      makeNode({ id: 'team1', node_type: 'team' }),
      makeNode({ id: 'team2', node_type: 'team' }),
    ]
    const members1 = [
      makeMember('team1', 'u1'),
      makeMember('team1', 'u2'),
      makeMember('team1', 'u3'),
    ]
    const members2 = [
      makeMember('team1', 'u1'),
      makeMember('team2', 'u2'),
      makeMember('team2', 'u3'),
    ]

    const graph1 = buildOrgGraph({ nodes, members: members1, links: [], coverage: [] })
    const graph2 = buildOrgGraph({ nodes, members: members2, links: [], coverage: [] })

    const orgs = [{ user_id: 'u1', is_org_admin: false }, { user_id: 'u2', is_org_admin: false }, { user_id: 'u3', is_org_admin: false }]
    const s1 = computeGovernanceSummary(graph1, members1, orgs)
    const s2 = computeGovernanceSummary(graph2, members2, orgs)

    expect(s1.memberUniqueCount).toBe(3)
    expect(s2.memberUniqueCount).toBe(3)
  })
})
