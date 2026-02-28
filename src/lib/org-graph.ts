/**
 * OrgGraph — selector layer for the Organization tab.
 *
 * Transforms raw org chart nodes, members, and coverage data into
 * an adjacency-list graph with derived stats, risk flags, and health scores.
 * Pure functions — no React, no side effects.
 */

// ─── Raw input types (match DB shapes from OrganizationPage) ────────────

export type OrgNodeType = 'division' | 'department' | 'team' | 'portfolio' | 'custom'

export interface RawOrgNode {
  id: string
  organization_id: string
  parent_id: string | null
  node_type: OrgNodeType
  custom_type_label?: string
  name: string
  description?: string
  color: string
  icon: string
  sort_order: number
  settings: Record<string, any> | null
  is_active: boolean
  is_non_investment?: boolean
  coverage_admin_override?: boolean
  created_at: string
}

export interface RawNodeMember {
  id: string
  node_id: string
  user_id: string
  role: string
  focus: string | null
  is_coverage_admin?: boolean
  coverage_admin_blocked?: boolean
  is_org_admin?: boolean
  created_at: string
  _source?: 'org_chart' | 'portfolio_team'
  user?: {
    id: string
    email: string
    full_name: string
    avatar_url?: string | null
  }
}

export interface RawNodeLink {
  id: string
  node_id: string
  linked_node_id: string
}

export interface CoverageRecord {
  asset_id: string
  user_id: string
}

// ─── Derived types ──────────────────────────────────────────────────────

export type RiskFlagType =
  | 'empty_team'           // team node with zero members
  | 'single_point_failure' // node where a single person holds all coverage
  | 'uncovered_assets'     // team with no coverage records at all
  | 'missing_coverage_admin' // team with no coverage admin assigned
  | 'no_portfolios'        // team node with no linked portfolios
  | 'orphaned_portfolio'   // portfolio node with zero members
  | 'no_pm_assigned'       // team node with no Portfolio Manager role
  | 'overloaded_analyst'   // team has an analyst covering >60 assets or in >8 portfolios
  | 'admin_single_point_failure' // subtree has too few org admins for its size

export interface RiskFlag {
  type: RiskFlagType
  severity: 'low' | 'medium' | 'high'
  label: string
}

export interface OrgGraphNode {
  // Identity (passthrough from raw)
  id: string
  parentId: string | null
  nodeType: OrgNodeType
  customTypeLabel?: string
  name: string
  description?: string
  color: string
  icon: string
  sortOrder: number
  settings: Record<string, any> | null
  isNonInvestment: boolean
  coverageAdminOverride: boolean
  createdAt: string

  // Graph structure
  childIds: string[]
  linkedNodeIds: string[]   // portfolio ↔ team links
  depth: number             // 0 = root-level
  path: string[]            // ancestor IDs from root → this node (exclusive)

  // Derived counts (this node only, not recursive)
  memberCount: number
  directMemberCount: number   // unique members assigned directly to this node
  derivedMemberCount: number  // unique members from portfolio children NOT also direct
  effectiveMemberCount: number // directMemberCount + derivedMemberCount
  portfolioCount: number      // direct portfolio children (for team nodes)

  // Recursive aggregates (this node + all descendants)
  totalMemberCount: number
  totalPortfolioCount: number
  totalNodeCount: number    // descendant count including self

  // Coverage (for team nodes)
  coverageAssetCount: number
  coverageAnalystCount: number

  // Risk & health
  riskFlags: RiskFlag[]
  healthScore: number       // 0–100, higher = healthier
}

export interface OrgGraph {
  /** All nodes keyed by id */
  nodes: Map<string, OrgGraphNode>
  /** Root-level node ids (parentId = null) */
  rootIds: string[]
  /** Overall health score (average of all non-leaf nodes, or 100 if empty) */
  overallHealth: number
  /** Summary counts */
  totalNodes: number
  totalMembers: number       // unique users across all nodes
  totalPortfolios: number    // nodes of type 'portfolio'
  totalTeams: number         // nodes of type 'team'
  totalRiskFlags: number
}

// ─── Thresholds (configurable) ──────────────────────────────────────────

/** Maximum assets an analyst can cover before being flagged as overloaded. */
export const OVERLOADED_ASSET_THRESHOLD = 60

/** Maximum portfolios an analyst can belong to before being flagged as overloaded. */
export const OVERLOADED_PORTFOLIO_THRESHOLD = 8

/** Subtree size thresholds for admin_single_point_failure (HIGH severity). */
export const ADMIN_SPF_HIGH_MEMBERS = 8
export const ADMIN_SPF_HIGH_TEAMS = 2

/** Subtree size thresholds for admin_single_point_failure (MEDIUM severity). */
export const ADMIN_SPF_MED_MEMBERS = 12
export const ADMIN_SPF_MED_TEAMS = 3

/** Roles considered "Portfolio Manager" for the no_pm_assigned risk flag. */
const PM_ROLE_PATTERNS = [/\bpm\b/i, /portfolio\s*manager/i]

function isPmRole(role: string): boolean {
  return PM_ROLE_PATTERNS.some(p => p.test(role))
}

// ─── Per-analyst stats (computed at graph level) ────────────────────────

export interface AnalystStats {
  /** Total assets this user covers across the entire org */
  assetCount: number
  /** Total portfolio node memberships across the entire org */
  portfolioMembershipCount: number
}

// ─── Graph builder ──────────────────────────────────────────────────────

export interface BuildOrgGraphInput {
  nodes: RawOrgNode[]
  members: RawNodeMember[]
  links: RawNodeLink[]
  coverage: CoverageRecord[]
}

export function buildOrgGraph(input: BuildOrgGraphInput): OrgGraph {
  const { nodes: rawNodes, members, links, coverage } = input

  // 1. Index raw data
  const membersByNode = new Map<string, RawNodeMember[]>()
  for (const m of members) {
    if (!membersByNode.has(m.node_id)) membersByNode.set(m.node_id, [])
    membersByNode.get(m.node_id)!.push(m)
  }

  const linksByNode = new Map<string, string[]>()
  const linksByLinked = new Map<string, string[]>()
  for (const l of links) {
    if (!linksByNode.has(l.node_id)) linksByNode.set(l.node_id, [])
    linksByNode.get(l.node_id)!.push(l.linked_node_id)
    if (!linksByLinked.has(l.linked_node_id)) linksByLinked.set(l.linked_node_id, [])
    linksByLinked.get(l.linked_node_id)!.push(l.node_id)
  }

  // User → covered asset IDs
  const userCoverage = new Map<string, Set<string>>()
  for (const c of coverage) {
    if (!c.user_id || !c.asset_id) continue
    if (!userCoverage.has(c.user_id)) userCoverage.set(c.user_id, new Set())
    userCoverage.get(c.user_id)!.add(c.asset_id)
  }

  // 2. Build parent → children index
  const childrenOf = new Map<string | null, string[]>()
  for (const n of rawNodes) {
    const parentKey = n.parent_id
    if (!childrenOf.has(parentKey)) childrenOf.set(parentKey, [])
    childrenOf.get(parentKey)!.push(n.id)
  }

  // Raw node lookup
  const rawMap = new Map(rawNodes.map(n => [n.id, n]))

  // 3. Compute depth + path for every node
  const depthOf = new Map<string, number>()
  const pathOf = new Map<string, string[]>()

  function computeDepthPath(nodeId: string): void {
    if (depthOf.has(nodeId)) return
    const raw = rawMap.get(nodeId)
    if (!raw) return
    if (!raw.parent_id || !rawMap.has(raw.parent_id)) {
      depthOf.set(nodeId, 0)
      pathOf.set(nodeId, [])
    } else {
      computeDepthPath(raw.parent_id)
      const parentPath = pathOf.get(raw.parent_id) || []
      depthOf.set(nodeId, (depthOf.get(raw.parent_id) || 0) + 1)
      pathOf.set(nodeId, [...parentPath, raw.parent_id])
    }
  }

  for (const n of rawNodes) computeDepthPath(n.id)

  // 4. Get portfolio node IDs under a team (direct children + linked)
  function getTeamPortfolioNodeIds(teamId: string): string[] {
    const ids: string[] = []
    const children = childrenOf.get(teamId) || []
    for (const cid of children) {
      const child = rawMap.get(cid)
      if (child?.node_type === 'portfolio') ids.push(cid)
    }
    // Linked portfolios
    const linkedIds = linksByLinked.get(teamId) || []
    for (const lid of linkedIds) {
      const linked = rawMap.get(lid)
      if (linked?.node_type === 'portfolio') ids.push(lid)
    }
    return ids
  }

  // 5. Compute coverage stats for team nodes
  function computeCoverageStats(teamId: string): { assetCount: number; analystCount: number } {
    const assets = new Set<string>()
    const analysts = new Set<string>()
    const portfolioNodeIds = getTeamPortfolioNodeIds(teamId)

    for (const pnid of portfolioNodeIds) {
      const nodeMembers = membersByNode.get(pnid) || []
      for (const m of nodeMembers) {
        const userAssets = userCoverage.get(m.user_id)
        if (userAssets && userAssets.size > 0) {
          analysts.add(m.user_id)
          for (const a of userAssets) assets.add(a)
        }
      }
    }
    return { assetCount: assets.size, analystCount: analysts.size }
  }

  // 6. Recursive aggregates (bottom-up)
  const totalMemberUserIdsOf = new Map<string, Set<string>>()
  const totalMemberCountOf = new Map<string, number>()
  const totalPortfolioCountOf = new Map<string, number>()
  const totalNodeCountOf = new Map<string, number>()

  function computeAggregates(nodeId: string): void {
    if (totalNodeCountOf.has(nodeId)) return
    const children = childrenOf.get(nodeId) || []
    for (const cid of children) computeAggregates(cid)

    const directMembers = membersByNode.get(nodeId) || []
    const directPortfolios = (childrenOf.get(nodeId) || [])
      .filter(cid => rawMap.get(cid)?.node_type === 'portfolio').length

    // Collect unique user IDs across the entire subtree to avoid double-counting
    const userIds = new Set(directMembers.map(m => m.user_id))
    let totalPortfolios = directPortfolios
    let totalNodes = 1

    for (const cid of children) {
      const childUserIds = totalMemberUserIdsOf.get(cid)
      if (childUserIds) for (const uid of childUserIds) userIds.add(uid)
      totalPortfolios += totalPortfolioCountOf.get(cid) || 0
      totalNodes += totalNodeCountOf.get(cid) || 0
    }

    // For team nodes, also include members from linked portfolios (not already children)
    const raw = rawMap.get(nodeId)
    if (raw?.node_type === 'team') {
      const childIdSet = new Set(children)
      const linkedPortIds = [
        ...(linksByNode.get(nodeId) || []),
        ...(linksByLinked.get(nodeId) || []),
      ].filter(lid => !childIdSet.has(lid) && rawMap.get(lid)?.node_type === 'portfolio')
      for (const lpid of linkedPortIds) {
        const lpMembers = membersByNode.get(lpid) || []
        for (const m of lpMembers) userIds.add(m.user_id)
      }
    }

    totalMemberUserIdsOf.set(nodeId, userIds)
    totalMemberCountOf.set(nodeId, userIds.size)
    totalPortfolioCountOf.set(nodeId, totalPortfolios)
    totalNodeCountOf.set(nodeId, totalNodes)
  }

  for (const n of rawNodes) computeAggregates(n.id)

  // 6b. Compute per-user analyst stats
  const analystStatsMap = new Map<string, AnalystStats>()
  // Portfolio membership count
  const userPortfolioCount = new Map<string, number>()
  for (const m of members) {
    const raw = rawMap.get(m.node_id)
    if (raw?.node_type === 'portfolio') {
      userPortfolioCount.set(m.user_id, (userPortfolioCount.get(m.user_id) || 0) + 1)
    }
  }
  // Build stats map
  const allUserIds = new Set(members.map(m => m.user_id))
  for (const userId of allUserIds) {
    const userAssets = userCoverage.get(userId)
    analystStatsMap.set(userId, {
      assetCount: userAssets?.size || 0,
      portfolioMembershipCount: userPortfolioCount.get(userId) || 0,
    })
  }

  // 7. Build OrgGraphNode for every raw node
  const graphNodes = new Map<string, OrgGraphNode>()

  for (const raw of rawNodes) {
    const nodeMembers = membersByNode.get(raw.id) || []
    const directUserIds = new Set(nodeMembers.map(m => m.user_id))
    const uniqueMembers = directUserIds.size
    const directPortfolioCount = (childrenOf.get(raw.id) || [])
      .filter(cid => rawMap.get(cid)?.node_type === 'portfolio').length
    const linkedIds = [
      ...(linksByNode.get(raw.id) || []),
      ...(linksByLinked.get(raw.id) || []),
    ]

    // Compute derived members: users from portfolio children NOT also direct members
    let derivedMemberCount = 0
    if (raw.node_type === 'team') {
      const portfolioNodeIds = getTeamPortfolioNodeIds(raw.id)
      const derivedUserIds = new Set<string>()
      for (const pnid of portfolioNodeIds) {
        const pMembers = membersByNode.get(pnid) || []
        for (const m of pMembers) {
          if (!directUserIds.has(m.user_id)) derivedUserIds.add(m.user_id)
        }
      }
      derivedMemberCount = derivedUserIds.size
    }

    const isTeam = raw.node_type === 'team'
    const coverageStats = isTeam ? computeCoverageStats(raw.id) : { assetCount: 0, analystCount: 0 }

    const riskFlags = computeRiskFlags(
      raw,
      nodeMembers,
      directPortfolioCount,
      coverageStats,
      linkedIds,
      analystStatsMap,
      derivedMemberCount,
    )
    const healthScore = computeNodeHealth(raw, riskFlags, uniqueMembers + derivedMemberCount, directPortfolioCount, coverageStats)

    graphNodes.set(raw.id, {
      id: raw.id,
      parentId: raw.parent_id,
      nodeType: raw.node_type,
      customTypeLabel: raw.custom_type_label,
      name: raw.name,
      description: raw.description,
      color: raw.color,
      icon: raw.icon,
      sortOrder: raw.sort_order,
      settings: raw.settings,
      isNonInvestment: raw.is_non_investment || false,
      coverageAdminOverride: raw.coverage_admin_override || false,
      createdAt: raw.created_at,

      childIds: (childrenOf.get(raw.id) || []).sort((a, b) => {
        const na = rawMap.get(a)
        const nb = rawMap.get(b)
        return (na?.sort_order ?? 0) - (nb?.sort_order ?? 0)
      }),
      linkedNodeIds: linkedIds,
      depth: depthOf.get(raw.id) || 0,
      path: pathOf.get(raw.id) || [],

      memberCount: uniqueMembers,
      directMemberCount: uniqueMembers,
      derivedMemberCount,
      effectiveMemberCount: uniqueMembers + derivedMemberCount,
      portfolioCount: directPortfolioCount,
      totalMemberCount: totalMemberCountOf.get(raw.id) || 0,
      totalPortfolioCount: totalPortfolioCountOf.get(raw.id) || 0,
      totalNodeCount: totalNodeCountOf.get(raw.id) || 0,

      coverageAssetCount: coverageStats.assetCount,
      coverageAnalystCount: coverageStats.analystCount,

      riskFlags,
      healthScore,
    })
  }

  // 7b. Post-processing: admin_single_point_failure flag
  // Flags subtrees that are large enough to warrant multiple org admins but have too few.
  const orgAdminUserIds = new Set(members.filter(m => m.is_org_admin).map(m => m.user_id))
  for (const gn of graphNodes.values()) {
    // Only check nodes that have children (subtrees worth governing)
    if (gn.childIds.length === 0) continue

    // Count unique org admins in this subtree
    const subtreeAdmins = new Set<string>()
    const stack = [gn.id]
    while (stack.length > 0) {
      const nid = stack.pop()!
      const nodeMembers = membersByNode.get(nid) || []
      for (const m of nodeMembers) {
        if (orgAdminUserIds.has(m.user_id)) subtreeAdmins.add(m.user_id)
      }
      const ch = childrenOf.get(nid) || []
      for (const cid of ch) stack.push(cid)
    }

    // Count team-type descendants (for team threshold)
    const subtreeTeams = (function countTeams(nodeId: string): number {
      let count = 0
      const children = childrenOf.get(nodeId) || []
      for (const cid of children) {
        if (rawMap.get(cid)?.node_type === 'team') count++
        count += countTeams(cid)
      }
      return count
    })(gn.id)

    const subtreeMembers = totalMemberCountOf.get(gn.id) || 0

    // HIGH: ≤1 admin for a large subtree
    if (subtreeAdmins.size <= 1 && (subtreeMembers >= ADMIN_SPF_HIGH_MEMBERS || subtreeTeams >= ADMIN_SPF_HIGH_TEAMS)) {
      gn.riskFlags.push({
        type: 'admin_single_point_failure',
        severity: 'high',
        label: subtreeAdmins.size === 0
          ? 'No org admin in subtree'
          : 'Only 1 org admin for subtree',
      })
    }
    // MED: exactly 2 admins for a very large subtree
    else if (subtreeAdmins.size === 2 && (subtreeMembers >= ADMIN_SPF_MED_MEMBERS || subtreeTeams >= ADMIN_SPF_MED_TEAMS)) {
      gn.riskFlags.push({
        type: 'admin_single_point_failure',
        severity: 'medium',
        label: 'Only 2 org admins for large subtree',
      })
    }
  }

  // 8. Overall stats
  const rootIds = (childrenOf.get(null) || []).sort((a, b) => {
    const na = rawMap.get(a)
    const nb = rawMap.get(b)
    return (na?.sort_order ?? 0) - (nb?.sort_order ?? 0)
  })

  const allMemberUserIds = new Set<string>()
  for (const m of members) allMemberUserIds.add(m.user_id)

  const totalPortfolios = rawNodes.filter(n => n.node_type === 'portfolio').length
  const totalTeams = rawNodes.filter(n => n.node_type === 'team').length

  let totalRiskFlags = 0
  const healthScores: number[] = []
  for (const gn of graphNodes.values()) {
    totalRiskFlags += gn.riskFlags.length
    // Include non-leaf and team nodes in overall health
    if (gn.childIds.length > 0 || gn.nodeType === 'team') {
      healthScores.push(gn.healthScore)
    }
  }

  const overallHealth = healthScores.length > 0
    ? Math.round(healthScores.reduce((sum, s) => sum + s, 0) / healthScores.length)
    : 100

  return {
    nodes: graphNodes,
    rootIds,
    overallHealth,
    totalNodes: rawNodes.length,
    totalMembers: allMemberUserIds.size,
    totalPortfolios,
    totalTeams,
    totalRiskFlags,
  }
}

// ─── Risk flag computation ──────────────────────────────────────────────

export function computeRiskFlags(
  node: RawOrgNode,
  nodeMembers: RawNodeMember[],
  directPortfolioCount: number,
  coverageStats: { assetCount: number; analystCount: number },
  linkedNodeIds: string[],
  analystStats?: Map<string, AnalystStats>,
  derivedMemberCount = 0,
): RiskFlag[] {
  const flags: RiskFlag[] = []

  // ── Portfolio-level risks ──
  if (node.node_type === 'portfolio') {
    if (nodeMembers.length === 0) {
      flags.push({ type: 'orphaned_portfolio', severity: 'high', label: 'No members assigned to portfolio' })
    }
  }

  // ── Team-level risks ──
  if (node.node_type === 'team') {
    // Empty team — no effective members (direct + portfolio-derived)
    const effectiveCount = nodeMembers.length + derivedMemberCount
    if (effectiveCount === 0) {
      flags.push({ type: 'empty_team', severity: 'high', label: 'No members assigned' })
    }

    // No portfolios under this team
    if (directPortfolioCount === 0 && linkedNodeIds.length === 0) {
      flags.push({ type: 'no_portfolios', severity: 'medium', label: 'No portfolios linked' })
    }

    // No coverage at all
    if (coverageStats.assetCount === 0 && nodeMembers.length > 0) {
      flags.push({ type: 'uncovered_assets', severity: 'medium', label: 'No coverage assigned' })
    }

    // Single point of failure — only one analyst covering everything
    if (coverageStats.analystCount === 1 && coverageStats.assetCount > 3) {
      flags.push({
        type: 'single_point_failure',
        severity: 'high',
        label: 'Single analyst covers all assets',
      })
    }

    // No coverage admin
    const hasCoverageAdmin = nodeMembers.some(
      m => m.is_coverage_admin && !m.coverage_admin_blocked,
    )
    if (!hasCoverageAdmin && nodeMembers.length > 0) {
      flags.push({
        type: 'missing_coverage_admin',
        severity: 'low',
        label: 'No coverage admin assigned',
      })
    }

    // No Portfolio Manager assigned
    if (nodeMembers.length > 0) {
      const hasPm = nodeMembers.some(m => isPmRole(m.role))
      if (!hasPm) {
        flags.push({ type: 'no_pm_assigned', severity: 'high', label: 'No Portfolio Manager assigned' })
      }
    }

    // Overloaded analyst — any member exceeds asset or portfolio thresholds
    if (analystStats && nodeMembers.length > 0) {
      const overloaded = nodeMembers.some(m => {
        const stats = analystStats.get(m.user_id)
        if (!stats) return false
        return stats.assetCount > OVERLOADED_ASSET_THRESHOLD ||
          stats.portfolioMembershipCount > OVERLOADED_PORTFOLIO_THRESHOLD
      })
      if (overloaded) {
        flags.push({
          type: 'overloaded_analyst',
          severity: 'medium',
          label: 'Analyst exceeds capacity thresholds',
        })
      }
    }
  }

  return flags
}

// ─── Health score computation ───────────────────────────────────────────

/**
 * Computes a 0–100 health score for a node.
 *
 * Weights (sum to 100):
 *   - Has members: 25
 *   - Has portfolios (team only): 20
 *   - Has coverage (team only): 25
 *   - No high-severity risks: 20
 *   - No medium-severity risks: 10
 */
export function computeNodeHealth(
  node: RawOrgNode,
  riskFlags: RiskFlag[],
  memberCount: number,
  portfolioCount: number,
  coverageStats: { assetCount: number; analystCount: number },
): number {
  if (node.is_non_investment) return 100 // non-investment nodes are always "healthy"

  let score = 0

  const isTeam = node.node_type === 'team'

  // Has members (25 pts)
  if (memberCount > 0) score += 25

  // Has portfolios — team-specific (20 pts), non-team gets it free
  if (isTeam) {
    if (portfolioCount > 0) score += 20
  } else {
    score += 20
  }

  // Has coverage — team-specific (25 pts), non-team gets it free
  if (isTeam) {
    if (coverageStats.assetCount > 0) score += 25
  } else {
    score += 25
  }

  // No high-severity risks (20 pts)
  const highCount = riskFlags.filter(f => f.severity === 'high').length
  if (highCount === 0) score += 20

  // No medium-severity risks (10 pts)
  const medCount = riskFlags.filter(f => f.severity === 'medium').length
  if (medCount === 0) score += 10

  return score
}

// ─── Traversal helpers ──────────────────────────────────────────────────

/** Returns the subtree rooted at `nodeId` (inclusive), as a flat array. */
export function getSubtree(graph: OrgGraph, nodeId: string): OrgGraphNode[] {
  const result: OrgGraphNode[] = []
  const stack = [nodeId]
  while (stack.length > 0) {
    const id = stack.pop()!
    const node = graph.nodes.get(id)
    if (!node) continue
    result.push(node)
    // Push children in reverse so they come out in sort order
    for (let i = node.childIds.length - 1; i >= 0; i--) {
      stack.push(node.childIds[i])
    }
  }
  return result
}

/** Returns ancestor nodes from root down to (but not including) `nodeId`. */
export function getAncestors(graph: OrgGraph, nodeId: string): OrgGraphNode[] {
  const node = graph.nodes.get(nodeId)
  if (!node) return []
  return node.path
    .map(id => graph.nodes.get(id))
    .filter((n): n is OrgGraphNode => !!n)
}

/** Returns all descendant nodes (excluding self). */
export function getDescendants(graph: OrgGraph, nodeId: string): OrgGraphNode[] {
  return getSubtree(graph, nodeId).slice(1)
}

/** Returns direct children, sorted by sortOrder. */
export function getChildren(graph: OrgGraph, nodeId: string): OrgGraphNode[] {
  const node = graph.nodes.get(nodeId)
  if (!node) return []
  return node.childIds
    .map(id => graph.nodes.get(id))
    .filter((n): n is OrgGraphNode => !!n)
}

/** Finds all nodes matching a predicate (flat search). */
export function findNodes(
  graph: OrgGraph,
  predicate: (node: OrgGraphNode) => boolean,
): OrgGraphNode[] {
  const result: OrgGraphNode[] = []
  for (const node of graph.nodes.values()) {
    if (predicate(node)) result.push(node)
  }
  return result
}

/** Returns all nodes with at least one risk flag. */
export function getNodesWithRisks(graph: OrgGraph): OrgGraphNode[] {
  return findNodes(graph, n => n.riskFlags.length > 0)
}

/** Returns all nodes of a given type. */
export function getNodesByType(graph: OrgGraph, nodeType: OrgNodeType): OrgGraphNode[] {
  return findNodes(graph, n => n.nodeType === nodeType)
}

/** Returns a flattened array of all nodes in tree order (DFS). */
export function flattenTree(graph: OrgGraph): OrgGraphNode[] {
  const result: OrgGraphNode[] = []
  for (const rootId of graph.rootIds) {
    result.push(...getSubtree(graph, rootId))
  }
  return result
}

// ─── Risk aggregation helpers ───────────────────────────────────────────

export interface RiskCounts {
  high: number
  medium: number
  low: number
  total: number
}

/** Counts risk flags across the entire graph, grouped by severity. */
export function getRiskCountsBySeverity(graph: OrgGraph): RiskCounts {
  const counts: RiskCounts = { high: 0, medium: 0, low: 0, total: 0 }
  for (const node of graph.nodes.values()) {
    for (const flag of node.riskFlags) {
      counts[flag.severity]++
      counts.total++
    }
  }
  return counts
}

// ─── Governance summary (feeds the header) ───────────────────────────────

export interface GovernanceSummary {
  nodeCount: number
  teamCount: number
  portfolioCount: number
  /** Unique people across all nodes (direct + portfolio members, deduped) */
  memberUniqueCount: number
  /** Unique org admins (deduped by user_id) */
  orgAdminCount: number
  /** Unique coverage admins — global + scoped, deduped by user_id */
  coverageAdminCount: number
  /** Total risk flag count across the graph */
  riskFlagCount: number
  riskBySeverity: RiskCounts
}

/**
 * Computes governance-header summary stats from the graph + raw membership data.
 *
 * This is the single authoritative source for header counts.
 * Counts are org-wide and do NOT change with search/filter/focus state.
 *
 * @param graph        The built OrgGraph
 * @param nodeMembers  Raw node-member records (orgChartNodeMembers from DB)
 * @param orgMemberships  Org-level memberships (for org-admin detection).
 *                        Each entry has { user_id, is_org_admin }.
 * @param globalCoverageAdminUserIds  User IDs that have global coverage_admin flag
 *                                    (from user profile, not node-scoped).
 */
export function computeGovernanceSummary(
  graph: OrgGraph,
  nodeMembers: RawNodeMember[],
  orgMemberships: { user_id: string; is_org_admin: boolean }[],
  globalCoverageAdminUserIds: Set<string> = new Set(),
): GovernanceSummary {
  const riskBySeverity = getRiskCountsBySeverity(graph)

  // Unique org admins (deduped by user_id)
  const orgAdminIds = new Set<string>()
  for (const m of orgMemberships) {
    if (m.is_org_admin) orgAdminIds.add(m.user_id)
  }

  // Unique coverage admins: global + node-scoped, deduped
  const coverageAdminIds = new Set<string>(globalCoverageAdminUserIds)
  for (const m of nodeMembers) {
    if (m.is_coverage_admin && !m.coverage_admin_blocked) {
      coverageAdminIds.add(m.user_id)
    }
  }

  return {
    nodeCount: graph.totalNodes,
    teamCount: graph.totalTeams,
    portfolioCount: graph.totalPortfolios,
    memberUniqueCount: graph.totalMembers,
    orgAdminCount: orgAdminIds.size,
    coverageAdminCount: coverageAdminIds.size,
    riskFlagCount: riskBySeverity.total,
    riskBySeverity,
  }
}
