/**
 * Coverage utility functions — grouping, conflict detection, formatting.
 *
 * Conflict detection and resolver logic lives here
 * (delegating the actual resolver to resolveCoverage.ts).
 */

import type { CoverageRecord, AssetCoverageGroup, CoverageConflict, CoverageTarget } from './coverage-types'
import { resolveCoverageForViewer, type CoverageRow } from './resolveCoverage'

// ─── Tenure & formatting ──────────────────────────────────────────────

export function calculateTenure(startDate: string | null): { days: number; label: string } {
  if (!startDate) return { days: 0, label: '—' }
  const start = new Date(startDate)
  const now = new Date()
  const diffTime = now.getTime() - start.getTime()
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
  if (diffDays < 30) return { days: diffDays, label: `${diffDays}d` }
  if (diffDays < 365) return { days: diffDays, label: `${Math.floor(diffDays / 30)}mo` }
  const years = Math.floor(diffDays / 365)
  const months = Math.floor((diffDays % 365) / 30)
  return { days: diffDays, label: months > 0 ? `${years}y ${months}mo` : `${years}y` }
}

export function formatMarketCap(marketCap: number | null | undefined): string {
  if (!marketCap) return '—'
  if (marketCap >= 1e12) return `$${(marketCap / 1e12).toFixed(1)}T`
  if (marketCap >= 1e9) return `$${(marketCap / 1e9).toFixed(1)}B`
  if (marketCap >= 1e6) return `$${(marketCap / 1e6).toFixed(1)}M`
  return `$${marketCap.toLocaleString()}`
}

/** "Dan Lastname" → "Dan L." */
export function formatAnalystShortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  if (parts.length <= 1) return fullName
  return `${parts[0]} ${parts[parts.length - 1][0]}.`
}

// ─── Conflict detection ───────────────────────────────────────────────

/**
 * Detect true coverage conflicts (not just shared coverage).
 *
 * Multiple people covering the same asset+group is NORMAL and NOT a conflict.
 *
 * Conflicts:
 * - `multiple_leads`: >1 analyst marked `is_lead` for the same asset+scope
 * - `no_lead_multiple_primaries`: 0 leads AND >1 primaries for the same asset+scope
 */
export function detectConflicts(records: CoverageRecord[]): CoverageConflict[] {
  // Group by (asset_id, targetKey) — uses canonical group identity
  const groups = new Map<string, CoverageRecord[]>()
  for (const r of records) {
    if (!r.is_active || !r.assets) continue
    const key = `${r.asset_id}:${deriveTargetKey(r)}`
    const arr = groups.get(key)
    if (arr) arr.push(r)
    else groups.set(key, [r])
  }

  const conflicts: CoverageConflict[] = []

  for (const [, group] of groups) {
    if (group.length < 2) continue

    const leads = group.filter(r => r.is_lead)
    const primaries = group.filter(r => r.role === 'primary')

    if (leads.length > 1) {
      conflicts.push({
        assetId: group[0].asset_id,
        assetSymbol: group[0].assets?.symbol || '??',
        scope: deriveTargetKey(group[0]),
        type: 'multiple_leads',
        records: group,
      })
    } else if (leads.length === 0 && primaries.length > 1) {
      conflicts.push({
        assetId: group[0].asset_id,
        assetSymbol: group[0].assets?.symbol || '??',
        scope: deriveTargetKey(group[0]),
        type: 'no_lead_multiple_primaries',
        records: group,
      })
    }
  }

  return conflicts
}

// ─── Helpers ─────────────────────────────────────────────────────────

/** Internal reason key for the resolver (not user-facing). */
function deriveResolverReason(row: CoverageRow): string {
  if (row.is_lead) return 'is_lead'
  switch (row.role) {
    case 'primary':   return 'primary'
    case 'secondary': return 'secondary'
    case 'tertiary':  return 'tertiary'
    default:          return 'fallback'
  }
}

// ─── Coverage target derivation ─────────────────────────────────────

/** Org graph used for breadcrumb computation. Maps node id → { name, parent_id }. */
export type OrgNodeMap = Map<string, { id: string; name: string; node_type?: string; parent_id?: string | null }>

/**
 * Derive a canonical CoverageTarget from a coverage record.
 *
 * Priority:
 *   1) If joined org_chart_node exists (teams?.id) → kind='org_node'
 *   2) If visibility='firm' → kind='firm'
 *   3) Else → kind='unknown'
 *
 * Breadcrumb is built when orgNodeMap is provided.
 */
export function deriveCoverageTarget(record: CoverageRecord, orgNodeMap?: OrgNodeMap): CoverageTarget {
  // Firm-wide: visibility flag OR no team_id with firm visibility
  if (record.visibility === 'firm') {
    return { kind: 'firm', id: null, name: 'Firm' }
  }

  // Org node via joined teams data (team_id → org_chart_nodes)
  if (record.teams?.id) {
    const breadcrumb = orgNodeMap ? buildBreadcrumb(record.teams.id, orgNodeMap) : undefined
    return {
      kind: 'org_node',
      id: record.teams.id,
      name: record.teams.name,
      nodeType: record.teams.node_type,
      breadcrumb,
    }
  }

  // team_id exists but join didn't resolve (shouldn't happen with correct query)
  if (record.team_id) {
    const node = orgNodeMap?.get(record.team_id)
    if (node) {
      const breadcrumb = buildBreadcrumb(record.team_id, orgNodeMap!)
      return {
        kind: 'org_node',
        id: record.team_id,
        name: node.name,
        nodeType: node.node_type,
        breadcrumb,
      }
    }
  }

  // Unknown — no org node data available
  return { kind: 'unknown', id: null, name: 'No scope' }
}

/** Build ancestor breadcrumb: ["Firm", "Equities", "Tech", "Value Team"] */
function buildBreadcrumb(nodeId: string, orgNodeMap: OrgNodeMap): string[] {
  const chain: string[] = []
  let currentId: string | null | undefined = nodeId
  const visited = new Set<string>()
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    const node = orgNodeMap.get(currentId)
    if (!node) break
    chain.unshift(node.name)
    currentId = node.parent_id
  }
  return chain
}

/**
 * Derive a stable identity key for a coverage target.
 * Used to scope conflict detection to the same group.
 *
 * Returns: "firm" | "node:<id>" | "unknown"
 */
export function deriveTargetKey(record: CoverageRecord): string {
  if (record.visibility === 'firm') return 'firm'
  // Use team_id (which is org_chart_nodes.id) as canonical group identity
  if (record.team_id) return `node:${record.team_id}`
  // Fallback — shouldn't happen for valid data
  return 'unknown'
}

// ─── Group coverage by asset ──────────────────────────────────────────

/**
 * Group coverage records by asset, computing resolver result and conflicts per group.
 *
 * @param orgNodeMap  Optional org node map for breadcrumb computation.
 */
export function groupCoverageByAsset(
  records: CoverageRecord[],
  viewerNodeIds: string[],
  orgNodeMap?: OrgNodeMap,
): AssetCoverageGroup[] {
  const byAsset = new Map<string, CoverageRecord[]>()

  for (const r of records) {
    if (!r.assets) continue
    const arr = byAsset.get(r.asset_id)
    if (arr) arr.push(r)
    else byAsset.set(r.asset_id, [r])
  }

  const groups: AssetCoverageGroup[] = []

  for (const [assetId, assignments] of byAsset) {
    const first = assignments[0]
    const asset = first.assets!

    // Internal resolver — picks a single row for system routing, not surfaced as business truth
    const asRows: CoverageRow[] = assignments.map(a => ({
      id: a.id,
      asset_id: a.asset_id,
      user_id: a.user_id,
      analyst_name: a.analyst_name,
      role: a.role,
      is_lead: a.is_lead,
      team_id: a.team_id,
      visibility: a.visibility,
      portfolio_id: a.portfolio_id,
      updated_at: a.updated_at,
    }))
    const resolved = resolveCoverageForViewer(asRows, viewerNodeIds)
    const chosen = resolved.chosenDefault

    // Detect conflicts
    const assetConflicts = detectConflicts(assignments)

    // Derive canonical coverage targets for each assignment
    const targetMap = new Map<string, CoverageTarget>()
    for (const a of assignments) {
      const target = deriveCoverageTarget(a, orgNodeMap)
      const key = target.kind === 'org_node' && target.id ? `node:${target.id}` : target.kind
      if (!targetMap.has(key)) targetMap.set(key, target)
    }
    const coverageTargets = [...targetMap.values()]

    // Derive resolved row's target (internal — for system routing)
    const chosenRecord = chosen ? assignments.find(a => a.id === chosen.id) : null
    const chosenTarget = chosenRecord ? deriveCoverageTarget(chosenRecord, orgNodeMap) : null

    // Collect all analyst names for "Covered By" display
    const coveredByNames = [...new Set(assignments.map(a => a.analyst_name))]

    // Build scoped summaries for richer "Covered By" column
    // Priority: Lead > Primary > Secondary > Tertiary > (none)
    const rolePriority = (r: CoverageRecord) => {
      if (r.is_lead) return 0
      switch (r.role) {
        case 'primary': return 1
        case 'secondary': return 2
        case 'tertiary': return 3
        default: return 4
      }
    }
    const sortedAssignments = [...assignments].sort((a, b) => rolePriority(a) - rolePriority(b))
    const coveredBySummary = sortedAssignments.map(a => {
      const t = deriveCoverageTarget(a, orgNodeMap)
      return {
        analystName: a.analyst_name,
        shortName: formatAnalystShortName(a.analyst_name),
        role: a.role ?? null,
        isLead: a.is_lead ?? false,
        scopeName: t.name,
      }
    })

    groups.push({
      assetId,
      symbol: asset.symbol,
      companyName: asset.company_name,
      sector: asset.sector || 'Uncategorized',
      assignments,
      resolvedRow: chosen && chosenTarget
        ? {
            coverageId: chosen.id || '',
            analystName: chosen.analyst_name || 'Unknown',
            userId: chosen.user_id,
            role: chosen.role ?? null,
            isLead: chosen.is_lead ?? false,
            reason: deriveResolverReason(chosen),
            groupName: chosenTarget.name,
            target: chosenTarget,
          }
        : null,
      coveredByNames,
      coveredBySummary,
      conflicts: assetConflicts,
      coverageTargets,
      groupNames: coverageTargets.map(t => t.name),
    })
  }

  // Sort by symbol
  groups.sort((a, b) => a.symbol.localeCompare(b.symbol))
  return groups
}
