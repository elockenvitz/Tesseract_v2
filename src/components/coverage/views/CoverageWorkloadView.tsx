import React, { useState, useMemo } from 'react'
import { clsx } from 'clsx'
import { Users, BarChart3, Scale, ArrowRight, AlertTriangle } from 'lucide-react'
import { Card } from '../../ui/Card'
import { formatAnalystShortName, calculateTenure } from '../../../lib/coverage/coverage-utils'

// ─── Types ────────────────────────────────────────────────────────────

interface CoverageRecord {
  id: string
  asset_id: string
  user_id: string
  analyst_name: string
  created_at: string
  updated_at: string
  start_date: string
  end_date: string | null
  is_active: boolean
  changed_by: string | null
  role?: string | null
  notes?: string | null
  portfolio_id?: string | null
  team_id?: string | null
  visibility?: 'team' | 'division' | 'firm'
  is_lead?: boolean
  assets: {
    id: string
    symbol: string
    company_name: string
    sector?: string
  } | null
  portfolios?: {
    id: string
    name: string
    team_id?: string | null
  } | null
  teams?: {
    id: string
    name: string
    node_type: string
    parent_id?: string | null
  } | null
}

/** Per-analyst portfolio or team bucket with asset-level metrics. */
interface BucketMetrics {
  name: string
  /** Entity ID (portfolio or org_chart_node) for navigation */
  entityId?: string
  /** Coverage assignments by this analyst scoped here */
  assignmentCount: number
  /** Unique asset IDs covered by this analyst in this bucket */
  assetIds: Set<string>
  /** How many of the portfolio's actual holdings this analyst covers (intersection) */
  holdingsCoveredCount?: number
}

/** Aggregate totals for a portfolio or team across all analysts. */
interface BucketTotals {
  name: string
  /** Total assignments across all analysts */
  totalAssignments: number
  /** Unique asset IDs covered by any analyst */
  assetIds: Set<string>
  /** Distinct analyst IDs */
  analystIds: Set<string>
}

interface AnalystWorkload {
  id: string
  name: string
  count: number
  primaryCount: number
  secondaryCount: number
  tertiaryCount: number
  portfolios: Map<string, BucketMetrics>
  teams: Map<string, BucketMetrics>
  sectors: string[]
}

type WorkloadLevel = {
  level: 'available' | 'balanced' | 'watch' | 'stretched'
  color: string
  label: string
  textColor: string
  bgColor: string
}

type StatCard = 'analysts' | 'average' | 'capacity' | null
type DetailTab = 'assets' | 'portfolios' | 'teams'

// ─── Props ────────────────────────────────────────────────────────────

export interface CoverageWorkloadViewProps {
  filteredCoverage: CoverageRecord[]
  portfolioTeamMemberships: Map<string, string[]> | undefined
  /** Portfolio name → portfolio ID (for navigation) */
  portfolioNameToIdMap: Map<string, string> | undefined
  userTeamMemberships: Map<string, Array<{ id: string; name: string; type: string; role?: string }>> | undefined
  allOrgChartNodes: { nodes: any[]; allNodes: any[]; nodeLinks?: any[] } | undefined
  /** Portfolio name → assets held in that portfolio (from portfolio_holdings table) */
  portfolioHoldings: Map<string, Array<{ id: string; symbol: string; name: string; sector: string }>> | undefined
  userProfilesExtended: Map<string, string[]> | undefined
  selectedAnalystId: string | null
  setSelectedAnalystId: (id: string | null) => void
  selectedStatCard: string | null
  setSelectedStatCard: (card: string | null) => void
  selectedOrgGroup: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────

function getWorkloadLevel(count: number, avgCoverage: number): WorkloadLevel {
  if (avgCoverage === 0) return { level: 'balanced', color: 'bg-green-500', label: 'Balanced', textColor: 'text-green-700', bgColor: 'bg-green-50' }
  const ratio = count / avgCoverage
  if (ratio <= 0.7) return { level: 'available', color: 'bg-blue-400', label: 'Available', textColor: 'text-blue-700', bgColor: 'bg-blue-50' }
  if (ratio <= 1.2) return { level: 'balanced', color: 'bg-green-500', label: 'Balanced', textColor: 'text-green-700', bgColor: 'bg-green-50' }
  if (ratio <= 1.5) return { level: 'watch', color: 'bg-amber-500', label: 'Overloaded', textColor: 'text-amber-700', bgColor: 'bg-amber-50' }
  return { level: 'stretched', color: 'bg-red-500', label: 'Overloaded', textColor: 'text-red-700', bgColor: 'bg-red-50' }
}

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2)
}

/** Collect all descendant node ids (children, grandchildren, etc.) */
function getDescendantIds(nodeId: string, allNodes: any[]): Set<string> {
  const descendants = new Set<string>()
  const queue = [nodeId]
  while (queue.length > 0) {
    const current = queue.shift()!
    const children = allNodes.filter((n: any) => n.parent_id === current)
    for (const child of children) {
      descendants.add(child.id)
      queue.push(child.id)
    }
  }
  return descendants
}

// ─── Component ────────────────────────────────────────────────────────

export function CoverageWorkloadView({
  filteredCoverage,
  portfolioTeamMemberships,
  portfolioNameToIdMap,
  userTeamMemberships,
  allOrgChartNodes,
  portfolioHoldings,
  userProfilesExtended,
  selectedAnalystId,
  setSelectedAnalystId,
  selectedStatCard: rawSelectedStatCard,
  setSelectedStatCard,
  selectedOrgGroup,
}: CoverageWorkloadViewProps) {
  const [detailTab, setDetailTab] = useState<DetailTab>('assets')

  // Coerce legacy stat card values
  const selectedStatCard: StatCard = (
    rawSelectedStatCard === 'analysts' || rawSelectedStatCard === 'average' ||
    rawSelectedStatCard === 'capacity'
  ) ? rawSelectedStatCard : null

  // ─── Core workload computation ────────────────────────────────────
  const { analystWorkload, totalByPortfolio, totalByTeam } = useMemo(() => {
    const workload = new Map<string, AnalystWorkload>()
    const tbt = new Map<string, BucketTotals>()

    // Build lookups from org chart
    const allNodes = allOrgChartNodes?.allNodes || []
    const nodeById = new Map<string, any>(allNodes.map((n: any) => [n.id, n]))

    // Map: portfolio name → parent team node (walk up org tree)
    const portfolioNameToTeam = new Map<string, { id: string; name: string }>()
    for (const n of allNodes) {
      if (n.node_type === 'portfolio' && n.parent_id) {
        let current = nodeById.get(n.parent_id)
        while (current) {
          if (current.node_type === 'team') {
            portfolioNameToTeam.set(n.name, { id: current.id, name: current.name })
            break
          }
          current = current.parent_id ? nodeById.get(current.parent_id) : null
        }
      }
    }

    // Helper: ensure team bucket exists
    const ensureTeam = (analyst: AnalystWorkload, key: string, name: string): BucketMetrics => {
      let b = analyst.teams.get(key)
      if (!b) { b = { name, assignmentCount: 0, assetIds: new Set() }; analyst.teams.set(key, b) }
      return b
    }
    const ensureTotalTeam = (key: string, name: string): BucketTotals => {
      let b = tbt.get(key)
      if (!b) { b = { name, totalAssignments: 0, assetIds: new Set(), analystIds: new Set() }; tbt.set(key, b) }
      return b
    }

    // Collect each analyst's full set of covered asset IDs + record-scoped portfolio assignments
    const analystCoveredAssets = new Map<string, Set<string>>()
    // Map: analystId → portfolioName → Set of asset IDs scoped to that portfolio via coverage records
    const analystRecordScopedPortfolios = new Map<string, Map<string, Set<string>>>()
    // Map: portfolioName → portfolio ID (for navigation)
    const portfolioNameToId = new Map<string, string>()

    // Step 1: Iterate coverage records — build workload + team buckets + collect per-analyst data
    filteredCoverage.forEach(coverage => {
      const analystId = coverage.user_id || 'unknown'
      const assetId = coverage.asset_id
      const role = coverage.role || null

      // Track all covered assets per analyst
      let coveredSet = analystCoveredAssets.get(analystId)
      if (!coveredSet) { coveredSet = new Set(); analystCoveredAssets.set(analystId, coveredSet) }
      coveredSet.add(assetId)

      // Track record-scoped portfolio assignments
      const recordPortfolioName = coverage.portfolios?.name || null
      if (recordPortfolioName && coverage.portfolio_id) {
        portfolioNameToId.set(recordPortfolioName, coverage.portfolio_id)
      }
      if (recordPortfolioName) {
        let byPortfolio = analystRecordScopedPortfolios.get(analystId)
        if (!byPortfolio) { byPortfolio = new Map(); analystRecordScopedPortfolios.set(analystId, byPortfolio) }
        let pSet = byPortfolio.get(recordPortfolioName)
        if (!pSet) { pSet = new Set(); byPortfolio.set(recordPortfolioName, pSet) }
        pSet.add(assetId)
      }

      // Derive team from record scoping or portfolio's parent team
      let recordTeam: { id: string; name: string } | null = null
      if (coverage.teams?.id) {
        recordTeam = { id: coverage.teams.id, name: coverage.teams.name }
      } else if (recordPortfolioName) {
        recordTeam = portfolioNameToTeam.get(recordPortfolioName) || null
      }

      // Ensure analyst entry
      let analyst = workload.get(analystId)
      if (!analyst) {
        analyst = {
          id: analystId,
          name: coverage.analyst_name,
          count: 0,
          primaryCount: 0,
          secondaryCount: 0,
          tertiaryCount: 0,
          portfolios: new Map(),
          teams: new Map(),
          sectors: userProfilesExtended?.get(analystId) || [],
        }
        workload.set(analystId, analyst)
      }

      analyst.count++
      if (role === 'primary') analyst.primaryCount++
      else if (role === 'secondary') analyst.secondaryCount++
      else if (role === 'tertiary') analyst.tertiaryCount++

      // Per-analyst team bucket (record-scoped)
      if (recordTeam) {
        const tb = ensureTeam(analyst, recordTeam.id, recordTeam.name)
        tb.assignmentCount++
        tb.assetIds.add(assetId)
        const tt = ensureTotalTeam(recordTeam.id, recordTeam.name)
        tt.totalAssignments++
        tt.assetIds.add(assetId)
        tt.analystIds.add(analystId)
      }
    })

    // Step 2: Compute portfolio buckets
    // Union of: (a) record-scoped assets (coverage.portfolio_id → portfolio)
    //           (b) holdings intersection (analyst covers asset held in portfolio)
    const tbp = new Map<string, BucketTotals>()
    for (const [analystId, analyst] of workload) {
      const allCovered = analystCoveredAssets.get(analystId) || new Set<string>()
      const recordScoped = analystRecordScopedPortfolios.get(analystId) || new Map<string, Set<string>>()
      const memberPortfolios = portfolioTeamMemberships?.get(analystId) || []

      // Also include portfolios from record scoping even if not in membership list
      const allPortfolioNames = new Set(memberPortfolios)
      for (const pName of recordScoped.keys()) allPortfolioNames.add(pName)

      for (const pName of allPortfolioNames) {
        const holdings = portfolioHoldings?.get(pName)
        const holdingAssetIds = holdings ? new Set(holdings.map(h => h.id)) : new Set<string>()

        // (a) Assets from record scoping
        const fromRecords = recordScoped.get(pName) || new Set<string>()
        // (b) Assets from holdings intersection
        const fromHoldings = new Set<string>()
        for (const assetId of allCovered) {
          if (holdingAssetIds.has(assetId)) fromHoldings.add(assetId)
        }
        // Union (total covered assets relevant to this portfolio)
        const covered = new Set<string>([...fromRecords, ...fromHoldings])
        // Intersection with holdings (how many of the portfolio's holdings the analyst covers)
        const holdingsCovered = new Set<string>()
        for (const aid of covered) {
          if (holdingAssetIds.has(aid)) holdingsCovered.add(aid)
        }

        const pId = portfolioNameToIdMap?.get(pName) || portfolioNameToId.get(pName)
        analyst.portfolios.set(pName, { name: pName, entityId: pId, assignmentCount: covered.size, assetIds: covered, holdingsCoveredCount: holdingsCovered.size })

        // Update global portfolio totals
        let tp = tbp.get(pName)
        if (!tp) { tp = { name: pName, totalAssignments: 0, assetIds: new Set(), analystIds: new Set() }; tbp.set(pName, tp) }
        if (covered.size > 0) tp.analystIds.add(analystId)
        for (const aid of holdingAssetIds) tp.assetIds.add(aid)
        tp.totalAssignments += covered.size
      }
    }

    // Step 3: Ensure team memberships appear (even with 0 coverage)
    for (const [analystId, analyst] of workload) {
      const memberTeams = userTeamMemberships?.get(analystId) || []
      for (const t of memberTeams) {
        ensureTeam(analyst, t.id, t.name)
      }
    }

    return { analystWorkload: workload, totalByPortfolio: tbp, totalByTeam: tbt }
  }, [filteredCoverage, allOrgChartNodes, portfolioTeamMemberships, portfolioNameToIdMap, userTeamMemberships, portfolioHoldings, userProfilesExtended])

  // ─── Filter analysts by org group ──────────────────────────────────
  const allAnalystEntries = useMemo(() => Array.from(analystWorkload.entries()), [analystWorkload])

  const filteredAnalystEntries = useMemo(() => {
    if (!selectedOrgGroup) return allAnalystEntries

    const allNodes = allOrgChartNodes?.allNodes || []
    const node = allNodes.find((n: any) => n.id === selectedOrgGroup)
    if (!node) return allAnalystEntries

    if (node.node_type === 'team') {
      return allAnalystEntries.filter(([, a]) => a.teams.has(selectedOrgGroup!))
    }
    if (node.node_type === 'portfolio') {
      return allAnalystEntries.filter(([, a]) => a.portfolios.has(selectedOrgGroup!))
    }
    // Department or division — include self + all descendants
    const descendantIds = getDescendantIds(selectedOrgGroup!, allNodes)
    descendantIds.add(selectedOrgGroup!)
    return allAnalystEntries.filter(([, a]) => {
      for (const teamId of a.teams.keys()) {
        if (descendantIds.has(teamId)) return true
      }
      for (const portfolioId of a.portfolios.keys()) {
        if (descendantIds.has(portfolioId)) return true
      }
      return false
    })
  }, [selectedOrgGroup, allAnalystEntries, allOrgChartNodes])

  // ─── Derived stats (scoped to filtered group) ──────────────────────
  const totalAnalysts = filteredAnalystEntries.length

  const { avgCoverage, medianCoverage, maxCoverage, minCoverage } = useMemo(() => {
    if (totalAnalysts === 0) return { avgCoverage: 0, medianCoverage: 0, maxCoverage: 0, minCoverage: 0 }
    const counts = filteredAnalystEntries.map(([, a]) => a.count).sort((a, b) => a - b)
    const sum = counts.reduce((s, c) => s + c, 0)
    const mid = Math.floor(counts.length / 2)
    const median = counts.length % 2 ? counts[mid] : (counts[mid - 1] + counts[mid]) / 2
    return {
      avgCoverage: sum / totalAnalysts,
      medianCoverage: median,
      maxCoverage: counts[counts.length - 1],
      minCoverage: counts[0],
    }
  }, [filteredAnalystEntries, totalAnalysts])

  const sortedAnalysts = useMemo(
    () => [...filteredAnalystEntries].sort((a, b) => b[1].count - a[1].count),
    [filteredAnalystEntries]
  )

  // ─── Workload categories ──────────────────────────────────────────
  const workloadCounts = useMemo(() => {
    const counts = { available: 0, balanced: 0, watch: 0, stretched: 0 }
    filteredAnalystEntries.forEach(([, a]) => {
      const wl = getWorkloadLevel(a.count, avgCoverage)
      counts[wl.level]++
    })
    return counts
  }, [filteredAnalystEntries, avgCoverage])

  const analystsByCategory = useMemo(() => ({
    available: sortedAnalysts.filter(([, a]) => getWorkloadLevel(a.count, avgCoverage).level === 'available'),
    balanced: sortedAnalysts.filter(([, a]) => getWorkloadLevel(a.count, avgCoverage).level === 'balanced'),
    watch: sortedAnalysts.filter(([, a]) => getWorkloadLevel(a.count, avgCoverage).level === 'watch'),
    stretched: sortedAnalysts.filter(([, a]) => getWorkloadLevel(a.count, avgCoverage).level === 'stretched'),
  }), [sortedAnalysts, avgCoverage])

  // ─── Rebalance recommendations ─────────────────────────────────────
  const rebalanceRecommendations = useMemo(() => {
    if (totalAnalysts < 2 || avgCoverage === 0) return []
    const roundedAvg = Math.round(avgCoverage)

    const overloaded = sortedAnalysts
      .filter(([, a]) => {
        const wl = getWorkloadLevel(a.count, avgCoverage)
        return wl.level === 'watch' || wl.level === 'stretched'
      })
      .map(([id, a]) => ({ id, name: a.name, count: a.count, delta: a.count - roundedAvg }))
      .sort((a, b) => b.delta - a.delta)

    const available = sortedAnalysts
      .filter(([, a]) => getWorkloadLevel(a.count, avgCoverage).level === 'available')
      .map(([id, a]) => ({ id, name: a.name, count: a.count, capacity: roundedAvg - a.count }))
      .sort((a, b) => b.capacity - a.capacity)

    if (overloaded.length === 0 || available.length === 0) return []

    const recs: Array<{
      source: { name: string; count: number; delta: number }
      targets: Array<{ name: string; suggested: string }>
    }> = []

    for (const source of overloaded) {
      let remaining = source.delta
      const targets: Array<{ name: string; suggested: string }> = []

      for (const target of available) {
        if (remaining <= 0) break
        const moveMin = Math.min(remaining, Math.max(1, Math.floor(target.capacity * 0.5)))
        const moveMax = Math.min(remaining, target.capacity)
        if (moveMax <= 0) continue

        targets.push({ name: target.name, suggested: moveMin === moveMax ? `${moveMax}` : `${moveMin}\u2013${moveMax}` })
        remaining -= moveMax
      }

      if (targets.length > 0) {
        recs.push({ source: { name: source.name, count: source.count, delta: source.delta }, targets })
      }
    }

    return recs
  }, [sortedAnalysts, avgCoverage, totalAnalysts])

  // ─── Click handlers ───────────────────────────────────────────────
  const selectAnalyst = (id: string) => {
    setSelectedAnalystId(selectedAnalystId === id ? null : id)
    setSelectedStatCard(null as any)
    setDetailTab('assets')
  }

  const selectStatCard = (card: StatCard) => {
    setSelectedAnalystId(null)
    setSelectedStatCard((selectedStatCard === card ? null : card) as any)
  }

  // ─── Render ───────────────────────────────────────────────────────
  const overloadedCount = workloadCounts.watch + workloadCounts.stretched
  const highestAnalyst = sortedAnalysts.length > 0 ? sortedAnalysts[0] : null
  const lowestAnalyst = sortedAnalysts.length > 0 ? sortedAnalysts[sortedAnalysts.length - 1] : null

  return (
    <div className="grid grid-cols-12 gap-4 flex-1 min-h-0 mt-4">
      {/* ── Left Sidebar: Team Health ──────────────────────────────── */}
      <div className="col-span-12 lg:col-span-2 flex flex-col min-h-0">
        <Card className="flex flex-col h-full overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-200 flex-shrink-0 bg-gray-50">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Team Health</p>
          </div>

          <div className="flex-1 overflow-y-auto">
            {totalAnalysts > 0 ? (
              <>
                {/* Key metrics */}
                <div className="px-3 py-3 space-y-2.5 border-b border-gray-100">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-gray-500">Coverage Spread</span>
                    <span className="text-[12px] font-bold text-gray-900">{maxCoverage - minCoverage}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-gray-500">Overloaded Analysts</span>
                    <span className={clsx('text-[12px] font-bold', overloadedCount > 0 ? 'text-amber-600' : 'text-gray-400')}>
                      {overloadedCount}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-gray-500">Underutilized Analysts</span>
                    <span className={clsx('text-[12px] font-bold', workloadCounts.available > 0 ? 'text-blue-600' : 'text-gray-400')}>
                      {workloadCounts.available}
                    </span>
                  </div>
                </div>

                {/* Extremes */}
                <div className="px-3 py-3 space-y-3 border-b border-gray-100">
                  {highestAnalyst && (
                    <div>
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Largest Coverage</p>
                      <button
                        onClick={() => selectAnalyst(highestAnalyst[0])}
                        className="text-[12px] text-gray-700 hover:text-primary-600 transition-colors"
                      >
                        {highestAnalyst[1].name} <span className="font-bold text-gray-900">({highestAnalyst[1].count})</span>
                      </button>
                    </div>
                  )}
                  {lowestAnalyst && (
                    <div>
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Smallest Coverage</p>
                      <button
                        onClick={() => selectAnalyst(lowestAnalyst[0])}
                        className="text-[12px] text-gray-700 hover:text-primary-600 transition-colors"
                      >
                        {lowestAnalyst[1].name} <span className="font-bold text-gray-900">({lowestAnalyst[1].count})</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Future risk signals placeholder */}
                <div className="px-3 py-3 space-y-2">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Risk Signals</p>
                  <p className="text-[10px] text-gray-300 italic">Sector concentration, portfolio risk, and single-analyst coverage risk coming soon.</p>
                </div>
              </>
            ) : (
              <div className="text-center py-6 text-gray-400 text-[11px]">
                {filteredCoverage.length === 0 ? 'No data' : 'No analysts in this group'}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* ── Right Panel ──────────────────────────────────────────────── */}
      <div className="col-span-12 lg:col-span-10 flex flex-col min-h-0 gap-4">
        {/* ── Summary Cards ───────────────────────────────────────── */}
        <div className="flex flex-col gap-3 flex-shrink-0">
          {/* Summary Cards: Capacity primary, Analysts + Avg secondary */}
          <div className="grid grid-cols-6 gap-3">
            {/* Capacity — PRIMARY card (wider, more prominent) */}
            <Card
              className={clsx(
                'p-3.5 cursor-pointer transition-all hover:shadow-md col-span-3',
                selectedStatCard === 'capacity' && !selectedAnalystId
                  ? 'ring-2 ring-purple-500 bg-purple-50'
                  : 'border-l-4 border-l-purple-400'
              )}
              onClick={() => selectStatCard('capacity')}
            >
              <div className="flex items-baseline justify-between mb-2">
                <p className="text-[13px] font-semibold text-gray-900">Capacity</p>
                <span className="text-[11px] text-gray-400">Target: ~{Math.round(avgCoverage)} names</span>
              </div>
              <div className="flex items-center gap-5">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-400 flex-shrink-0" />
                  <span className="text-lg font-bold text-blue-600">{workloadCounts.available}</span>
                  <span className="text-[11px] text-gray-500">Available</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-green-500 flex-shrink-0" />
                  <span className="text-lg font-bold text-green-600">{workloadCounts.balanced}</span>
                  <span className="text-[11px] text-gray-500">Balanced</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500 flex-shrink-0" />
                  <span className="text-lg font-bold text-amber-600">{overloadedCount}</span>
                  <span className="text-[11px] text-gray-500">Overloaded</span>
                </div>
              </div>
            </Card>

            {/* Analysts — secondary */}
            <Card
              className={clsx(
                'p-2.5 cursor-pointer transition-all hover:shadow-sm col-span-1',
                selectedStatCard === 'analysts' && !selectedAnalystId && 'ring-1 ring-gray-400 bg-gray-50'
              )}
              onClick={() => selectStatCard('analysts')}
            >
              <p className="text-xl font-bold text-gray-500">{totalAnalysts}</p>
              <p className="text-[10px] text-gray-400">Analysts</p>
            </Card>

            {/* Avg Names — secondary */}
            <Card
              className={clsx(
                'p-2.5 cursor-pointer transition-all hover:shadow-sm col-span-2',
                selectedStatCard === 'average' && !selectedAnalystId && 'ring-1 ring-gray-400 bg-gray-50'
              )}
              onClick={() => selectStatCard('average')}
            >
              <p className="text-xl font-bold text-gray-500">{avgCoverage.toFixed(1)}</p>
              <p className="text-[10px] text-gray-400">
                Avg Names / Analyst{medianCoverage !== Math.round(avgCoverage) ? ` · Median ${medianCoverage}` : ''}
              </p>
            </Card>
          </div>
        </div>

        {/* ── Detail Panel ────────────────────────────────────────────── */}
        {selectedAnalystId ? (
          <AnalystDetailPanel
            analystWorkload={analystWorkload}
            selectedAnalystId={selectedAnalystId}
            avgCoverage={avgCoverage}
            filteredCoverage={filteredCoverage}
            totalByPortfolio={totalByPortfolio}
            totalByTeam={totalByTeam}
            portfolioHoldings={portfolioHoldings}
            detailTab={detailTab}
            setDetailTab={setDetailTab}
            selectAnalyst={selectAnalyst}
          />
        ) : selectedStatCard === 'analysts' ? (
          <AnalystsTablePanel
            sortedAnalysts={sortedAnalysts}
            avgCoverage={avgCoverage}
            totalAnalysts={totalAnalysts}
            selectAnalyst={selectAnalyst}
          />
        ) : selectedStatCard === 'average' ? (
          <DistributionPanel
            sortedAnalysts={sortedAnalysts}
            avgCoverage={avgCoverage}
            maxCoverage={maxCoverage}
            minCoverage={minCoverage}
            medianCoverage={medianCoverage}
            selectAnalyst={selectAnalyst}
          />
        ) : selectedStatCard === 'capacity' ? (
          <CapacityPanel
            analystsByCategory={analystsByCategory}
            workloadCounts={workloadCounts}
            avgCoverage={avgCoverage}
            selectAnalyst={selectAnalyst}
            rebalanceRecommendations={rebalanceRecommendations}
          />
        ) : (
          <DefaultOverviewPanel
            sortedAnalysts={sortedAnalysts}
            avgCoverage={avgCoverage}
            maxCoverage={maxCoverage}
            totalAnalysts={totalAnalysts}
            analystsByCategory={analystsByCategory}
            workloadCounts={workloadCounts}
            selectAnalyst={selectAnalyst}
            rebalanceRecommendations={rebalanceRecommendations}
          />
        )}
      </div>
    </div>
  )
}

// ─── Sub-panels ───────────────────────────────────────────────────────

/** Analyst Detail View — header + tabbed body */
function AnalystDetailPanel({
  analystWorkload,
  selectedAnalystId,
  avgCoverage,
  filteredCoverage,
  totalByPortfolio,
  totalByTeam,
  portfolioHoldings,
  detailTab,
  setDetailTab,
  selectAnalyst,
}: {
  analystWorkload: Map<string, AnalystWorkload>
  selectedAnalystId: string
  avgCoverage: number
  filteredCoverage: CoverageRecord[]
  totalByPortfolio: Map<string, BucketTotals>
  totalByTeam: Map<string, BucketTotals>
  portfolioHoldings: Map<string, Array<{ id: string; symbol: string; name: string; sector: string }>> | undefined
  detailTab: DetailTab
  setDetailTab: (tab: DetailTab) => void
  selectAnalyst: (id: string) => void
}) {
  const analyst = analystWorkload.get(selectedAnalystId)
  if (!analyst) return null

  const workload = getWorkloadLevel(analyst.count, avgCoverage)
  const diff = analyst.count - avgCoverage
  const analystCoverage = filteredCoverage.filter(c => c.user_id === selectedAnalystId)
  const sortedPortfolios = Array.from(analyst.portfolios.entries()).sort((a, b) => b[1].assetIds.size - a[1].assetIds.size)
  const sortedTeams = Array.from(analyst.teams.entries()).sort((a, b) => b[1].assetIds.size - a[1].assetIds.size)

  // Capacity gauge
  const gaugePercent = avgCoverage > 0 ? Math.min((analyst.count / (avgCoverage * 2)) * 100, 100) : 50
  const avgLinePercent = avgCoverage > 0 ? Math.min((avgCoverage / (avgCoverage * 2)) * 100, 100) : 50
  const capacityDiff = Math.round(avgCoverage - analyst.count)

  return (
    <Card className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Compact header */}
      <div className="px-4 py-3 border-b border-gray-200 flex-shrink-0 bg-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={clsx('w-9 h-9 rounded-full flex items-center justify-center', workload.bgColor)}>
              <span className={clsx('text-[12px] font-bold', workload.textColor)}>
                {getInitials(analyst.name)}
              </span>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">{analyst.name}</h3>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[12px] text-gray-600">
                  <span className="font-bold text-gray-900">{analyst.count}</span> names
                </span>
                <span className={clsx('px-1.5 py-0.5 text-[10px] font-medium rounded-full', workload.bgColor, workload.textColor)}>
                  {workload.label}
                </span>
                {diff !== 0 && (
                  <span className={clsx('text-[11px]', diff > 0 ? 'text-amber-600' : 'text-blue-600')}>
                    ({diff > 0 ? '+' : ''}{diff.toFixed(1)} vs avg)
                  </span>
                )}
                {/* Role breakdown pills */}
                <span className="text-[10px] text-gray-400 flex items-center gap-1">
                  {analyst.primaryCount > 0 && <span className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">{analyst.primaryCount} primary</span>}
                  {analyst.secondaryCount > 0 && <span className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">{analyst.secondaryCount} secondary</span>}
                  {analyst.tertiaryCount > 0 && <span className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">{analyst.tertiaryCount} tertiary</span>}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Body: 2 sections */}
      <div className="flex-1 overflow-auto flex min-h-0">
        {/* Section A: Coverage Breakdown (left, wider) */}
        <div className="flex-1 flex flex-col min-h-0 border-r border-gray-100">
          {/* Tab strip */}
          <div className="px-4 py-2 border-b border-gray-100 flex gap-1 flex-shrink-0">
            {(['assets', 'portfolios', 'teams'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setDetailTab(tab)}
                className={clsx(
                  'px-3 py-1 text-[11px] font-medium rounded transition-colors capitalize',
                  detailTab === tab
                    ? 'bg-primary-100 text-primary-700'
                    : 'text-gray-500 hover:bg-gray-100'
                )}
              >
                {tab === 'assets' ? `Assets (${analystCoverage.length})` : tab === 'portfolios' ? `Portfolios (${sortedPortfolios.length})` : `Teams (${sortedTeams.length})`}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-auto p-3">
            {/* Assets tab */}
            {detailTab === 'assets' && (
              <div className="space-y-0.5">
                {analystCoverage.length === 0 && (
                  <div className="text-center py-4 text-gray-400 text-[12px]">No assets covered</div>
                )}
                {analystCoverage.map(c => {
                  const tenure = calculateTenure(c.start_date)
                  return (
                    <div key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 group">
                      <span className="text-[12px] font-semibold text-gray-900 w-16 flex-shrink-0">{c.assets?.symbol || '??'}</span>
                      <span className="text-[11px] text-gray-500 truncate flex-1">{c.assets?.company_name || 'Unknown'}</span>
                      {c.role && (
                        <span className={clsx(
                          'text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0',
                          c.role === 'primary' ? 'bg-indigo-50 text-indigo-600'
                            : c.role === 'secondary' ? 'bg-purple-50 text-purple-600'
                            : 'bg-gray-100 text-gray-500'
                        )}>
                          {c.role}
                        </span>
                      )}
                      <span className="text-[10px] text-gray-400 flex-shrink-0 w-10 text-right">{tenure.label}</span>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Portfolios tab */}
            {detailTab === 'portfolios' && (
              <div className="space-y-2.5">
                {sortedPortfolios.length === 0 && (
                  <div className="text-center py-6 text-gray-400 text-[12px]">No portfolio memberships</div>
                )}
                {sortedPortfolios.map(([key, bucket]) => {
                  const coveredAssets = bucket.assetIds.size
                  // Holdings intersection: how many of the portfolio's holdings does the analyst cover
                  const holdingsCovered = bucket.holdingsCoveredCount ?? 0
                  const holdings = portfolioHoldings?.get(key)
                  const totalHoldings = holdings ? holdings.length : 0
                  const hasHoldings = totalHoldings > 0
                  const totals = totalByPortfolio.get(key)
                  const analystCount = totals ? totals.analystIds.size : (coveredAssets > 0 ? 1 : 0)
                  // Percentage: holdings covered / total holdings (always ≤ 100%)
                  const pct = hasHoldings ? Math.min((holdingsCovered / totalHoldings) * 100, 100) : 0
                  // Extra assets: record-scoped coverage beyond current holdings (research names, etc.)
                  const extraAssets = coveredAssets - holdingsCovered
                  // Insight badge
                  const insight = holdingsCovered === 0 && coveredAssets === 0 ? null
                    : hasHoldings && analystCount === 1 && holdingsCovered >= totalHoldings ? { label: 'Sole analyst', color: 'text-amber-600 bg-amber-50' }
                    : hasHoldings && holdingsCovered >= totalHoldings ? { label: 'Full coverage', color: 'text-green-700 bg-green-50' }
                    : hasHoldings && pct >= 70 ? { label: 'Primary coverage', color: 'text-indigo-600 bg-indigo-50' }
                    : null
                  return (
                    <div key={key} className={clsx('rounded-lg p-3 border', coveredAssets > 0 ? 'bg-white border-gray-200' : 'bg-gray-50/50 border-gray-100')}>
                      {/* Row 1: Name + insight badge */}
                      <div className="flex items-center gap-2 mb-1.5">
                        <span
                          className={clsx('text-[12px] font-semibold truncate', bucket.entityId ? 'text-primary-600 hover:text-primary-700 cursor-pointer hover:underline' : 'text-gray-900')}
                          title={bucket.name}
                          onClick={bucket.entityId ? () => {
                            window.dispatchEvent(new CustomEvent('open-portfolio', { detail: { id: bucket.entityId, name: bucket.name } }))
                          } : undefined}
                        >{bucket.name}</span>
                        {insight && (
                          <span className={clsx('text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded', insight.color)}>{insight.label}</span>
                        )}
                      </div>
                      {coveredAssets > 0 ? (
                        <>
                          {/* Row 2: Count label + percentage */}
                          <div className="flex items-baseline justify-between mb-1.5">
                            <span className="text-[11px] text-gray-600">
                              {hasHoldings ? (
                                <>
                                  <span className="font-semibold text-gray-900">{holdingsCovered}</span>
                                  <span className="text-gray-400"> of </span>
                                  <span className="font-medium">{totalHoldings}</span>
                                  <span className="text-gray-400"> holdings covered</span>
                                </>
                              ) : (
                                <>
                                  <span className="font-semibold text-gray-900">{coveredAssets}</span>
                                  <span className="text-gray-400"> asset{coveredAssets !== 1 ? 's' : ''} covered</span>
                                </>
                              )}
                            </span>
                            {hasHoldings && (
                              <span className="text-[12px] font-bold text-gray-900 tabular-nums">{pct.toFixed(0)}%</span>
                            )}
                          </div>
                          {/* Row 3: Progress bar — represents analyst's coverage of portfolio holdings */}
                          {hasHoldings && (
                            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-1.5">
                              <div className="h-full bg-purple-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                            </div>
                          )}
                          {/* Row 4: Secondary context */}
                          <p className="text-[10px] text-gray-400">
                            {hasHoldings && extraAssets > 0 && holdingsCovered > 0
                              ? `+${extraAssets} additional name${extraAssets !== 1 ? 's' : ''} beyond current holdings`
                              : hasHoldings
                                ? analystCount === 1
                                  ? 'Sole analyst on this portfolio'
                                  : `${analystCount} analysts covering this portfolio`
                                : 'Coverage assigned to this portfolio'}
                          </p>
                        </>
                      ) : (
                        <p className="text-[11px] text-gray-400">Member — no covered assets in this portfolio</p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Teams tab */}
            {detailTab === 'teams' && (
              <div className="space-y-2.5">
                {sortedTeams.length === 0 && (
                  <div className="text-center py-6 text-gray-400 text-[12px]">No team memberships</div>
                )}
                {sortedTeams.map(([id, bucket]) => {
                  const coveredAssets = bucket.assetIds.size
                  const totals = totalByTeam.get(id)
                  const totalAssets = totals ? totals.assetIds.size : coveredAssets
                  const analystCount = totals ? totals.analystIds.size : (coveredAssets > 0 ? 1 : 0)
                  const pct = totalAssets > 0 ? (coveredAssets / totalAssets) * 100 : 0
                  // Insight badge
                  const insight = coveredAssets === 0 ? null
                    : analystCount === 1 && coveredAssets === totalAssets ? { label: 'Sole analyst', color: 'text-amber-600 bg-amber-50' }
                    : coveredAssets === totalAssets ? { label: 'Full coverage', color: 'text-green-700 bg-green-50' }
                    : pct >= 70 ? { label: 'Primary coverage', color: 'text-indigo-600 bg-indigo-50' }
                    : null
                  return (
                    <div key={id} className={clsx('rounded-lg p-3 border', coveredAssets > 0 ? 'bg-white border-gray-200' : 'bg-gray-50/50 border-gray-100')}>
                      {/* Row 1: Name + insight badge */}
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-[12px] font-semibold text-gray-900 truncate" title={bucket.name}>{bucket.name}</span>
                        {insight && (
                          <span className={clsx('text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded', insight.color)}>{insight.label}</span>
                        )}
                      </div>
                      {coveredAssets > 0 ? (
                        <>
                          {/* Row 2: Count label + percentage */}
                          <div className="flex items-baseline justify-between mb-1.5">
                            <span className="text-[11px] text-gray-600">
                              <span className="font-semibold text-gray-900">{coveredAssets}</span>
                              <span className="text-gray-400"> of </span>
                              <span className="font-medium">{totalAssets}</span>
                              <span className="text-gray-400"> assets covered</span>
                            </span>
                            <span className="text-[12px] font-bold text-gray-900 tabular-nums">{pct.toFixed(0)}%</span>
                          </div>
                          {/* Row 3: Progress bar — represents analyst's share of team coverage universe */}
                          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-1.5">
                            <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
                          </div>
                          {/* Row 4: Secondary context */}
                          <p className="text-[10px] text-gray-400">
                            {analystCount === 1
                              ? 'Sole analyst on this team'
                              : `${analystCount} analysts covering this team`}
                          </p>
                        </>
                      ) : (
                        <p className="text-[11px] text-gray-400">Member — no active coverage assignments</p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Section B: Profile & Capacity (right, narrower) */}
        <div className="w-64 flex-shrink-0 p-3 space-y-4 overflow-auto">
          {/* Sector expertise */}
          <div>
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Sector Expertise</p>
            {analyst.sectors.length === 0 && <p className="text-[11px] text-gray-400">No sectors set</p>}
            <div className="flex flex-wrap gap-1">
              {analyst.sectors.map(s => (
                <span key={s} className="text-[10px] px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded font-medium">{s}</span>
              ))}
            </div>
          </div>

          {/* Capacity gauge */}
          <div>
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Capacity</p>
            <div className="relative h-4 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={clsx('h-full rounded-full transition-all', workload.color)}
                style={{ width: `${gaugePercent}%` }}
              />
              {/* Average line */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-gray-600 z-10"
                style={{ left: `${avgLinePercent}%` }}
              />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-gray-400">0</span>
              <span className="text-[10px] text-gray-500 font-medium">
                avg: {avgCoverage.toFixed(1)}
              </span>
              <span className="text-[10px] text-gray-400">{Math.round(avgCoverage * 2)}</span>
            </div>
          </div>

          {/* Suggestion */}
          {capacityDiff > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded p-2">
              <p className="text-[11px] text-blue-700">
                Can take on <span className="font-bold">{capacityDiff}</span> more names to reach average
              </p>
            </div>
          )}
          {capacityDiff < -2 && (
            <div className="bg-amber-50 border border-amber-200 rounded p-2">
              <p className="text-[11px] text-amber-700">
                Offload <span className="font-bold">{Math.abs(capacityDiff)}</span> names to reach average
              </p>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

/** All Analysts table view */
function AnalystsTablePanel({
  sortedAnalysts,
  avgCoverage,
  totalAnalysts,
  selectAnalyst,
}: {
  sortedAnalysts: Array<[string, AnalystWorkload]>
  avgCoverage: number
  totalAnalysts: number
  selectAnalyst: (id: string) => void
}) {
  return (
    <Card className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-200 flex-shrink-0 bg-gray-50">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-gray-600" />
          <h3 className="text-[12px] font-semibold text-gray-900">All Analysts ({totalAnalysts})</h3>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
            <tr>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-600 uppercase">Analyst</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-600 uppercase">Coverage</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-600 uppercase">Status</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-600 uppercase">Sectors</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sortedAnalysts.map(([id, analyst]) => {
              const workload = getWorkloadLevel(analyst.count, avgCoverage)
              const diff = analyst.count - avgCoverage
              return (
                <tr key={id} className="hover:bg-gray-50 cursor-pointer" onClick={() => selectAnalyst(id)}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className={clsx('w-7 h-7 rounded-full flex items-center justify-center', workload.bgColor)}>
                        <span className={clsx('text-[10px] font-semibold', workload.textColor)}>{getInitials(analyst.name)}</span>
                      </div>
                      <span className="text-[12px] font-medium text-gray-900">{analyst.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold text-gray-900">{analyst.count}</span>
                      {diff !== 0 && (
                        <span className={clsx('text-[12px]', diff > 0 ? 'text-amber-600' : 'text-blue-600')}>
                          ({diff > 0 ? '+' : ''}{diff.toFixed(1)})
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={clsx('px-2 py-0.5 text-[10px] font-semibold rounded-full', workload.bgColor, workload.textColor)}>
                      {workload.label}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-[12px] text-gray-500">
                    {analyst.sectors.slice(0, 2).join(', ')}{analyst.sectors.length > 2 ? '...' : ''}{analyst.sectors.length === 0 && '\u2014'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

/** Coverage Distribution chart */
function DistributionPanel({
  sortedAnalysts,
  avgCoverage,
  maxCoverage,
  minCoverage,
  medianCoverage,
  selectAnalyst,
}: {
  sortedAnalysts: Array<[string, AnalystWorkload]>
  avgCoverage: number
  maxCoverage: number
  minCoverage: number
  medianCoverage: number
  selectAnalyst: (id: string) => void
}) {
  return (
    <Card className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-200 flex-shrink-0 bg-primary-50">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary-600" />
          <h3 className="text-[12px] font-semibold text-gray-900">Coverage Distribution</h3>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {/* Stats row */}
        <div className="grid grid-cols-4 gap-3 mb-5">
          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <p className="text-2xl font-bold text-gray-900">{avgCoverage.toFixed(1)}</p>
            <p className="text-[11px] text-gray-500">Average</p>
          </div>
          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <p className="text-2xl font-bold text-gray-700">{medianCoverage}</p>
            <p className="text-[11px] text-gray-500">Median</p>
          </div>
          <div className="text-center p-3 bg-green-50 rounded-lg">
            <p className="text-2xl font-bold text-green-700">{maxCoverage}</p>
            <p className="text-[11px] text-gray-500">Highest</p>
          </div>
          <div className="text-center p-3 bg-blue-50 rounded-lg">
            <p className="text-2xl font-bold text-blue-700">{minCoverage}</p>
            <p className="text-[11px] text-gray-500">Lowest</p>
          </div>
        </div>

        {/* Distribution bars with role segments */}
        <h4 className="text-[12px] font-semibold text-gray-700 mb-3">Coverage by Analyst</h4>
        <div className="space-y-2">
          {sortedAnalysts.map(([id, analyst]) => {
            const workload = getWorkloadLevel(analyst.count, avgCoverage)
            const primaryPct = maxCoverage > 0 ? (analyst.primaryCount / maxCoverage) * 100 : 0
            const secondaryPct = maxCoverage > 0 ? (analyst.secondaryCount / maxCoverage) * 100 : 0
            const tertiaryPct = maxCoverage > 0 ? (analyst.tertiaryCount / maxCoverage) * 100 : 0
            const otherCount = analyst.count - analyst.primaryCount - analyst.secondaryCount - analyst.tertiaryCount
            const otherPct = maxCoverage > 0 ? (otherCount / maxCoverage) * 100 : 0
            const avgPosition = maxCoverage > 0 ? (avgCoverage / maxCoverage) * 100 : 50

            return (
              <div
                key={id}
                className="flex items-center gap-3 cursor-pointer hover:bg-gray-50 p-1.5 rounded-lg"
                onClick={() => selectAnalyst(id)}
              >
                <span className="text-[12px] text-gray-700 w-32 truncate">{analyst.name}</span>
                <div className="flex-1 h-6 bg-gray-100 rounded relative overflow-hidden">
                  {/* Average line */}
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-gray-600 z-10"
                    style={{ left: `${avgPosition}%` }}
                  />
                  {/* Stacked segments */}
                  <div className="flex h-full">
                    {primaryPct > 0 && (
                      <div
                        className={clsx('h-full', workload.color)}
                        style={{ width: `${primaryPct}%` }}
                      />
                    )}
                    {secondaryPct > 0 && (
                      <div
                        className={clsx('h-full opacity-60', workload.color)}
                        style={{ width: `${secondaryPct}%` }}
                      />
                    )}
                    {tertiaryPct > 0 && (
                      <div
                        className={clsx('h-full opacity-30', workload.color)}
                        style={{ width: `${tertiaryPct}%` }}
                      />
                    )}
                    {otherPct > 0 && (
                      <div
                        className={clsx('h-full opacity-40', workload.color)}
                        style={{ width: `${otherPct}%` }}
                      />
                    )}
                  </div>
                </div>
                <span className="text-[12px] font-bold text-gray-700 w-6 text-right">{analyst.count}</span>
                <span className={clsx('text-[10px] w-20 text-right flex-shrink-0', (analyst.count - avgCoverage) > 0 ? 'text-amber-600' : (analyst.count - avgCoverage) < 0 ? 'text-blue-600' : 'text-gray-400')}>
                  ({(analyst.count - avgCoverage) > 0 ? '+' : ''}{(analyst.count - avgCoverage).toFixed(1)} vs avg)
                </span>
              </div>
            )
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-4 mt-4 pt-3 border-t border-gray-100">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-green-500" />
            <span className="text-[11px] text-gray-500">Primary</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-green-500 opacity-60" />
            <span className="text-[11px] text-gray-500">Secondary</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-green-500 opacity-30" />
            <span className="text-[11px] text-gray-500">Tertiary</span>
          </div>
          <div className="flex items-center gap-1 ml-3">
            <div className="w-0.5 h-4 bg-gray-600" />
            <span className="text-[11px] text-gray-500">Avg ({avgCoverage.toFixed(1)})</span>
          </div>
        </div>
      </div>
    </Card>
  )
}

/** Capacity (action zones) panel */
function CapacityPanel({
  analystsByCategory,
  workloadCounts,
  avgCoverage,
  selectAnalyst,
  rebalanceRecommendations,
}: {
  analystsByCategory: {
    available: Array<[string, AnalystWorkload]>
    balanced: Array<[string, AnalystWorkload]>
    watch: Array<[string, AnalystWorkload]>
    stretched: Array<[string, AnalystWorkload]>
  }
  workloadCounts: { available: number; balanced: number; watch: number; stretched: number }
  avgCoverage: number
  selectAnalyst: (id: string) => void
  rebalanceRecommendations: Array<{
    source: { name: string; count: number; delta: number }
    targets: Array<{ name: string; suggested: string }>
  }>
}) {
  const stretchedTotal = workloadCounts.watch + workloadCounts.stretched

  return (
    <Card className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-200 flex-shrink-0 bg-purple-50">
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4 text-purple-600" />
          <h3 className="text-[12px] font-semibold text-gray-900">Capacity Planning</h3>
        </div>
        {(workloadCounts.available > 0 || stretchedTotal > 0) && (
          <p className="text-[11px] text-gray-500 mt-0.5">
            {workloadCounts.available > 0 && <>{workloadCounts.available} analyst{workloadCounts.available > 1 ? 's have' : ' has'} available capacity</>}
            {workloadCounts.available > 0 && stretchedTotal > 0 && ', '}
            {stretchedTotal > 0 && <>{stretchedTotal} {stretchedTotal > 1 ? 'are' : 'is'} overloaded</>}
          </p>
        )}
      </div>
      <div className="flex-1 overflow-auto p-4 space-y-5">
        {/* Suggested Rebalance */}
        {rebalanceRecommendations.length > 0 && (
          <div className="bg-amber-50/60 border border-amber-200 rounded-lg p-3 space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
              <h4 className="text-[12px] font-semibold text-gray-800">Suggested Rebalance</h4>
            </div>
            {rebalanceRecommendations.map((rec, i) => (
              <div key={i} className="space-y-1">
                <p className="text-[12px] text-gray-800">
                  <span className="font-semibold">{rec.source.name}</span> is{' '}
                  <span className="font-bold text-amber-700">+{rec.source.delta} names</span> above average.
                </p>
                <p className="text-[11px] text-gray-500">Recommended redistribution:</p>
                {rec.targets.map((t, j) => (
                  <div key={j} className="flex items-center gap-1.5 text-[11px] text-gray-700 ml-2">
                    <ArrowRight className="h-3 w-3 text-blue-400 flex-shrink-0" />
                    <span>Move <span className="font-medium">{t.suggested}</span> assets to <span className="font-medium">{t.name}</span></span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        {/* Available Capacity (blue) */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2.5 h-2.5 rounded bg-blue-400" />
            <h4 className="text-[12px] font-semibold text-gray-700">Available Capacity ({workloadCounts.available})</h4>
            <span className="text-[10px] text-gray-400">These analysts can take on more names</span>
          </div>
          {analystsByCategory.available.length > 0 ? (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
              {analystsByCategory.available.map(([id, analyst]) => {
                const capacity = Math.round(avgCoverage - analyst.count)
                return (
                  <div
                    key={id}
                    className="p-2.5 bg-blue-50 rounded-lg border border-blue-200 cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => selectAnalyst(id)}
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-[10px] font-bold text-blue-700">{getInitials(analyst.name)}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-medium text-gray-900 truncate">{analyst.name}</p>
                        <p className="text-[11px] text-gray-500">
                          {analyst.count} names <span className="text-blue-600 font-medium">+{capacity} available</span>
                        </p>
                      </div>
                    </div>
                    {analyst.sectors.length > 0 && (
                      <div className="flex flex-wrap gap-0.5 mt-1.5">
                        {analyst.sectors.slice(0, 2).map(s => (
                          <span key={s} className="text-[9px] px-1 py-0.5 bg-blue-100 text-blue-600 rounded">{s}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-[11px] text-gray-400 italic">No analysts with available capacity</p>
          )}
        </div>

        {/* At Capacity (green) */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2.5 h-2.5 rounded bg-green-500" />
            <h4 className="text-[12px] font-semibold text-gray-700">At Capacity ({workloadCounts.balanced})</h4>
            <span className="text-[10px] text-gray-400">At target workload</span>
          </div>
          {analystsByCategory.balanced.length > 0 ? (
            <div className="grid grid-cols-3 lg:grid-cols-4 gap-1.5">
              {analystsByCategory.balanced.map(([id, analyst]) => {
                const diff = analyst.count - avgCoverage
                return (
                  <div
                    key={id}
                    className="p-2 bg-green-50/50 rounded border border-green-100 cursor-pointer hover:bg-green-50 transition-colors"
                    onClick={() => selectAnalyst(id)}
                  >
                    <p className="text-[11px] font-medium text-gray-900 truncate">{formatAnalystShortName(analyst.name)}</p>
                    <p className="text-[10px] text-gray-500">
                      {analyst.count} {diff !== 0 && <span className="text-green-600">({diff > 0 ? '+' : ''}{diff.toFixed(1)})</span>}
                    </p>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-[11px] text-gray-400 italic">No analysts at capacity</p>
          )}
        </div>

        {/* Overloaded (amber/red) */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2.5 h-2.5 rounded bg-amber-500" />
            <h4 className="text-[12px] font-semibold text-gray-700">Overloaded ({stretchedTotal})</h4>
            <span className="text-[10px] text-gray-400">May need workload relief</span>
          </div>
          {(analystsByCategory.watch.length > 0 || analystsByCategory.stretched.length > 0) ? (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
              {[...analystsByCategory.stretched, ...analystsByCategory.watch].map(([id, analyst]) => {
                const wl = getWorkloadLevel(analyst.count, avgCoverage)
                const overload = Math.round(analyst.count - avgCoverage)
                return (
                  <div
                    key={id}
                    className={clsx(
                      'p-2.5 rounded-lg cursor-pointer hover:shadow-md transition-shadow',
                      wl.level === 'stretched'
                        ? 'bg-red-50 border-2 border-red-300'
                        : 'bg-amber-50 border border-amber-200'
                    )}
                    onClick={() => selectAnalyst(id)}
                  >
                    <div className="flex items-center gap-2">
                      <div className={clsx('w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0', wl.bgColor)}>
                        <span className={clsx('text-[10px] font-bold', wl.textColor)}>{getInitials(analyst.name)}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-medium text-gray-900 truncate">{analyst.name}</p>
                        <p className="text-[11px] text-gray-500">
                          {analyst.count} names <span className={wl.textColor}>+{overload} over</span>
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-[11px] text-gray-400 italic">No analysts overloaded</p>
          )}
        </div>
      </div>
    </Card>
  )
}

/** Default overview — coverage distribution grouped by status */
function DefaultOverviewPanel({
  sortedAnalysts,
  avgCoverage,
  maxCoverage,
  totalAnalysts,
  analystsByCategory,
  workloadCounts,
  selectAnalyst,
  rebalanceRecommendations,
}: {
  sortedAnalysts: Array<[string, AnalystWorkload]>
  avgCoverage: number
  maxCoverage: number
  totalAnalysts: number
  analystsByCategory: {
    available: Array<[string, AnalystWorkload]>
    balanced: Array<[string, AnalystWorkload]>
    watch: Array<[string, AnalystWorkload]>
    stretched: Array<[string, AnalystWorkload]>
  }
  workloadCounts: { available: number; balanced: number; watch: number; stretched: number }
  selectAnalyst: (id: string) => void
  rebalanceRecommendations: Array<{
    source: { name: string; count: number; delta: number }
    targets: Array<{ name: string; suggested: string }>
  }>
}) {
  const overloadedAnalysts = [...analystsByCategory.stretched, ...analystsByCategory.watch]
  const overloadedCount = workloadCounts.watch + workloadCounts.stretched
  const avgPosition = maxCoverage > 0 ? (avgCoverage / maxCoverage) * 100 : 50

  const renderBar = (analystId: string, analyst: AnalystWorkload) => {
    const workload = getWorkloadLevel(analyst.count, avgCoverage)
    const barWidth = maxCoverage > 0 ? (analyst.count / maxCoverage) * 100 : 0
    const diff = analyst.count - avgCoverage

    return (
      <div
        key={analystId}
        onClick={() => selectAnalyst(analystId)}
        className="flex items-center gap-3 p-1.5 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors group"
      >
        <div className="w-28 flex-shrink-0">
          <p className="text-[12px] font-medium text-gray-900 truncate group-hover:text-primary-600">{analyst.name}</p>
        </div>
        <div className="flex-1 relative">
          <div className="h-6 bg-gray-100 rounded relative overflow-hidden">
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-gray-600 z-10"
              style={{ left: `${avgPosition}%` }}
            />
            <div
              className={clsx('h-full rounded transition-all', workload.color)}
              style={{ width: `${barWidth}%` }}
            />
          </div>
        </div>
        <span className="text-[12px] font-bold text-gray-700 w-6 text-right flex-shrink-0">{analyst.count}</span>
        <span className={clsx(
          'text-[10px] w-20 text-right flex-shrink-0',
          diff > 0 ? 'text-amber-600' : diff < 0 ? 'text-blue-600' : 'text-gray-400'
        )}>
          ({diff > 0 ? '+' : ''}{diff.toFixed(1)} vs avg)
        </span>
      </div>
    )
  }

  return (
    <Card className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center justify-between">
          <h3 className="text-[12px] font-semibold text-gray-900">Coverage Distribution</h3>
          <span className="text-[11px] text-gray-500">Click a metric above or an analyst to see details</span>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {/* Overloaded group */}
        {overloadedCount > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-2.5 h-2.5 rounded bg-amber-500" />
              <h4 className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
                Overloaded ({overloadedCount})
              </h4>
            </div>
            <div className="space-y-0.5">
              {overloadedAnalysts.map(([id, analyst]) => renderBar(id, analyst))}
            </div>
          </div>
        )}

        {/* Balanced group */}
        {workloadCounts.balanced > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-2.5 h-2.5 rounded bg-green-500" />
              <h4 className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
                Balanced ({workloadCounts.balanced})
              </h4>
            </div>
            <div className="space-y-0.5">
              {analystsByCategory.balanced.map(([id, analyst]) => renderBar(id, analyst))}
            </div>
          </div>
        )}

        {/* Available group */}
        {workloadCounts.available > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-2.5 h-2.5 rounded bg-blue-400" />
              <h4 className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
                Available ({workloadCounts.available})
              </h4>
            </div>
            <div className="space-y-0.5">
              {analystsByCategory.available.map(([id, analyst]) => renderBar(id, analyst))}
            </div>
          </div>
        )}

        {totalAnalysts === 0 && (
          <div className="text-center py-12 text-gray-500">
            <Users className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p className="text-[12px]">No coverage data available</p>
          </div>
        )}

        {/* Rebalance Recommendations */}
        {rebalanceRecommendations.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="bg-amber-50/60 border border-amber-200 rounded-lg p-3 space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                <h4 className="text-[12px] font-semibold text-gray-800">Suggested Rebalance</h4>
              </div>
              {rebalanceRecommendations.map((rec, i) => (
                <div key={i} className="space-y-1">
                  <p className="text-[12px] text-gray-800">
                    <span className="font-semibold">{rec.source.name}</span> is{' '}
                    <span className="font-bold text-amber-700">+{rec.source.delta} names</span> above average.
                  </p>
                  <p className="text-[11px] text-gray-500">Recommended redistribution:</p>
                  {rec.targets.map((t, j) => (
                    <div key={j} className="flex items-center gap-1.5 text-[11px] text-gray-700 ml-2">
                      <ArrowRight className="h-3 w-3 text-blue-400 flex-shrink-0" />
                      <span>Move <span className="font-medium">{t.suggested}</span> assets to <span className="font-medium">{t.name}</span></span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="px-4 py-2 border-t border-gray-200 bg-gray-50 flex-shrink-0">
        <div className="flex items-center justify-center gap-4">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-blue-400" />
            <span className="text-[11px] text-gray-600">Available</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-green-500" />
            <span className="text-[11px] text-gray-600">Balanced</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-amber-500" />
            <span className="text-[11px] text-gray-600">Overloaded</span>
          </div>
          <div className="flex items-center gap-1 ml-3">
            <div className="w-0.5 h-4 bg-gray-600" />
            <span className="text-[11px] text-gray-600">Avg ({avgCoverage.toFixed(1)})</span>
          </div>
        </div>
      </div>
    </Card>
  )
}
