import React, { useState, useRef, useEffect, useMemo } from 'react'
import { clsx } from 'clsx'
import {
  Users, X, ChevronDown, AlertCircle, Grid3X3, Minimize2, Maximize2
} from 'lucide-react'
import { Card } from '../../ui/Card'
import type { CoverageRecord } from '../../../lib/coverage/coverage-types'
import { formatAnalystShortName, detectConflicts } from '../../../lib/coverage/coverage-utils'

// ─── Coverage Indicator Helper ──────────────────────────────────────

function renderCoverageIndicator(
  coverage: CoverageRecord | undefined,
  hasOverlap: boolean,
  analystName?: string,
) {
  if (!coverage) return null

  const isLead = coverage.is_lead
  const role = coverage.role || 'n/a'
  const title = `${analystName || 'Analyst'} · Role: ${role}${isLead ? ' · Lead' : hasOverlap ? ' · Shared' : ''}`

  if (isLead) {
    return (
      <div className="flex justify-center" title={title}>
        <div className="w-4 h-4 rounded-full bg-primary-600 text-white flex items-center justify-center">
          <span className="text-[8px] font-bold leading-none">L</span>
        </div>
      </div>
    )
  }

  if (hasOverlap) {
    return (
      <div className="flex justify-center" title={title}>
        <div className="w-4 h-4 rounded-full border-2 border-primary-300 bg-primary-50" />
      </div>
    )
  }

  return (
    <div className="flex justify-center" title={title}>
      <div className="w-4 h-4 rounded-full bg-primary-400" />
    </div>
  )
}

// ─── Props ────────────────────────────────────────────────────────────

export interface CoverageMatrixViewProps {
  // Data
  filteredCoverage: CoverageRecord[]
  allUncoveredAssets: Array<{ id: string; symbol: string; company_name: string; sector?: string }>
  viewerNodeIds: string[]

  // Org data for grouping
  userTeamMemberships: Map<string, Array<{ id: string; name: string; type: string; role?: string; nodeId?: string }>> | undefined
  portfolioTeamMemberships: Map<string, string[]> | undefined
  allOrgChartNodes: { nodes: any[]; allNodes: any[]; nodeLinks: any[] } | undefined
  portfolioUniverseAssets: Map<string, Array<{ id: string; symbol: string; name: string; sector: string }>> | undefined
  portfolioHoldings: Map<string, Array<{ id: string; symbol: string; name: string; sector: string }>> | undefined

  // State
  matrixGroupBy: 'sector' | 'analyst' | 'portfolio' | 'team' | 'holdings'
  setMatrixGroupBy: React.Dispatch<React.SetStateAction<'sector' | 'analyst' | 'portfolio' | 'team' | 'holdings'>>
  matrixSelectedAnalysts: Set<string>
  setMatrixSelectedAnalysts: React.Dispatch<React.SetStateAction<Set<string>>>
  collapsedGroups: Set<string>
  setCollapsedGroups: React.Dispatch<React.SetStateAction<Set<string>>>

  // Settings
  coverageSettings: { enable_hierarchy?: boolean } | undefined
  userId: string | undefined
}

// ─── Component ────────────────────────────────────────────────────────

export function CoverageMatrixView(props: CoverageMatrixViewProps) {
  const {
    filteredCoverage, allUncoveredAssets, viewerNodeIds,
    userTeamMemberships, portfolioTeamMemberships,
    allOrgChartNodes, portfolioUniverseAssets, portfolioHoldings,
    matrixGroupBy, setMatrixGroupBy,
    matrixSelectedAnalysts, setMatrixSelectedAnalysts,
    collapsedGroups, setCollapsedGroups,
    coverageSettings, userId,
  } = props

  const [showAnalystPicker, setShowAnalystPicker] = useState(false)
  const [showConflictsOnly, setShowConflictsOnly] = useState(false)
  const [showMyTeamOnly, setShowMyTeamOnly] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const analystPickerRef = useRef<HTMLDivElement>(null)

  // Close picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (analystPickerRef.current && !analystPickerRef.current.contains(e.target as Node)) setShowAnalystPicker(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ── Derived data ─────────────────────────────────────────────────
  const allAnalysts = useMemo(() => [...new Set(filteredCoverage.map(c => c.analyst_name))].sort(), [filteredCoverage])

  // My team analysts
  const myTeamAnalysts = useMemo(() => {
    if (!userId || !userTeamMemberships) return new Set<string>()
    const myNodes = userTeamMemberships.get(userId) || []
    const myTeamIds = new Set(myNodes.map(n => n.id))
    const result = new Set<string>()
    // Find analysts whose team memberships overlap with viewer's
    userTeamMemberships.forEach((memberships, uid) => {
      if (memberships.some(m => myTeamIds.has(m.id))) {
        const rec = filteredCoverage.find(c => c.user_id === uid)
        if (rec) result.add(rec.analyst_name)
      }
    })
    return result
  }, [userId, userTeamMemberships, filteredCoverage])

  const analysts = useMemo(() => {
    let list = matrixSelectedAnalysts.size === 0 ? allAnalysts : allAnalysts.filter(a => matrixSelectedAnalysts.has(a))
    if (showMyTeamOnly) list = list.filter(a => myTeamAnalysts.has(a))
    return list
  }, [allAnalysts, matrixSelectedAnalysts, showMyTeamOnly, myTeamAnalysts])

  // Conflicts for the visible data
  const matrixConflicts = useMemo(() => detectConflicts(filteredCoverage), [filteredCoverage])

  // Helper functions for grouping
  const getAnalystTeamsForMatrix = (uid: string): string[] => {
    const allNodes = allOrgChartNodes?.allNodes || []
    const teamNodes = allNodes.filter(n => n.node_type === 'team')
    const result: string[] = []
    const userPortfolioNames = portfolioTeamMemberships?.get(uid) || []

    teamNodes.forEach(teamNode => {
      const directMembers = userTeamMemberships?.get(uid) || []
      const isDirectMember = directMembers.some((m: any) => m.nodeId === teamNode.id || m.id === teamNode.id)
      const childPortfolios = allNodes
        .filter(n => n.node_type === 'portfolio' && n.parent_id === teamNode.id)
        .map(n => n.name)
      const isViaParent = childPortfolios.some(pName => userPortfolioNames.includes(pName))
      const nodeLinks = allOrgChartNodes?.nodeLinks || []
      const linkedPortfolios = nodeLinks
        .filter(link => link.linked_node_id === teamNode.id)
        .map(link => allNodes.find(n => n.id === link.node_id && n.node_type === 'portfolio')?.name)
        .filter(Boolean) as string[]
      const isViaLink = linkedPortfolios.some(pName => userPortfolioNames.includes(pName))
      if (isDirectMember || isViaParent || isViaLink) result.push(teamNode.name)
    })
    return result
  }

  // Build groups
  const { sortedGroups, overlapAssets } = useMemo(() => {
    const groups = new Map<string, {
      assets: { id: string; symbol: string; name: string; sector: string; analyst?: string; role?: string }[]
      coveredCount: number
      totalCount: number
    }>()

    const coveredAssetIds = new Set<string>()
    filteredCoverage.forEach(c => { if (c.assets?.id) coveredAssetIds.add(c.assets.id) })

    if (matrixGroupBy === 'team') {
      filteredCoverage.forEach(c => {
        if (!c.assets) return
        const analystTeams = getAnalystTeamsForMatrix(c.user_id)
        const teams = analystTeams.length > 0 ? analystTeams : ['Firm-wide']
        teams.forEach(teamName => {
          if (!groups.has(teamName)) groups.set(teamName, { assets: [], coveredCount: 0, totalCount: 0 })
          const g = groups.get(teamName)!
          if (!g.assets.find(a => a.id === c.assets!.id)) {
            g.assets.push({ id: c.assets!.id, symbol: c.assets!.symbol, name: c.assets!.company_name, sector: c.assets!.sector || 'Uncategorized', analyst: c.analyst_name, role: c.role || undefined })
            g.coveredCount++
            g.totalCount++
          }
        })
      })
    } else if (matrixGroupBy === 'portfolio') {
      portfolioUniverseAssets?.forEach((universeAssets, portfolioName) => {
        if (universeAssets.length === 0) return
        if (!groups.has(portfolioName)) groups.set(portfolioName, { assets: [], coveredCount: 0, totalCount: 0 })
        const g = groups.get(portfolioName)!
        universeAssets.forEach(asset => {
          if (!g.assets.find(a => a.id === asset.id)) {
            const isCovered = coveredAssetIds.has(asset.id)
            const coveringRecord = isCovered ? filteredCoverage.find(c => c.assets?.id === asset.id) : null
            g.assets.push({ id: asset.id, symbol: asset.symbol, name: asset.name, sector: asset.sector, analyst: coveringRecord?.analyst_name, role: coveringRecord?.role || undefined })
            g.totalCount++
            if (isCovered) g.coveredCount++
          }
        })
      })
    } else if (matrixGroupBy === 'holdings') {
      const relevantPortfolios = new Set<string>()
      const selectedAnalystIds = new Set<string>()
      filteredCoverage.forEach(c => selectedAnalystIds.add(c.user_id))
      selectedAnalystIds.forEach(uid => {
        const p = portfolioTeamMemberships?.get(uid) || []
        p.forEach(pn => relevantPortfolios.add(pn))
      })
      relevantPortfolios.forEach(portfolioName => {
        const holdings = portfolioHoldings?.get(portfolioName) || []
        if (holdings.length === 0) return
        if (!groups.has(portfolioName)) groups.set(portfolioName, { assets: [], coveredCount: 0, totalCount: 0 })
        const g = groups.get(portfolioName)!
        holdings.forEach(holding => {
          if (!g.assets.find(a => a.id === holding.id)) {
            const isCovered = coveredAssetIds.has(holding.id)
            const coveringRecord = isCovered ? filteredCoverage.find(c => c.assets?.id === holding.id) : null
            g.assets.push({ id: holding.id, symbol: holding.symbol, name: holding.name, sector: holding.sector, analyst: coveringRecord?.analyst_name, role: coveringRecord?.role || undefined })
            g.totalCount++
            if (isCovered) g.coveredCount++
          }
        })
      })
    } else {
      // Sector / Analyst
      filteredCoverage.forEach(c => {
        if (!c.assets) return
        const groupKey = matrixGroupBy === 'analyst' ? c.analyst_name : (c.assets.sector || 'Uncategorized')
        if (!groups.has(groupKey)) groups.set(groupKey, { assets: [], coveredCount: 0, totalCount: 0 })
        const g = groups.get(groupKey)!
        if (!g.assets.find(a => a.id === c.assets!.id)) {
          g.assets.push({ id: c.assets.id, symbol: c.assets.symbol, name: c.assets.company_name, sector: c.assets.sector || 'Uncategorized', analyst: c.analyst_name, role: c.role || undefined })
          g.coveredCount++
          g.totalCount++
        }
      })
      if (matrixGroupBy === 'sector') {
        allUncoveredAssets.forEach(asset => {
          const gk = asset.sector || 'Uncategorized'
          if (!groups.has(gk)) groups.set(gk, { assets: [], coveredCount: 0, totalCount: 0 })
          const g = groups.get(gk)!
          if (!g.assets.find(a => a.id === asset.id)) {
            g.assets.push({ id: asset.id, symbol: asset.symbol, name: asset.company_name, sector: asset.sector || 'Uncategorized' })
            g.totalCount++
          }
        })
      }
    }

    const sorted = Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]))

    // Overlap stats
    const assetCoverageCount = new Map<string, { count: number; symbol: string; analysts: string[] }>()
    filteredCoverage.forEach(c => {
      if (!c.assets || !analysts.includes(c.analyst_name)) return
      const existing = assetCoverageCount.get(c.assets.id)
      if (existing) { existing.count++; if (!existing.analysts.includes(c.analyst_name)) existing.analysts.push(c.analyst_name) }
      else assetCoverageCount.set(c.assets.id, { count: 1, symbol: c.assets.symbol, analysts: [c.analyst_name] })
    })
    const overlapAssets = Array.from(assetCoverageCount.entries())
      .filter(([_, data]) => data.analysts.length > 1)
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.analysts.length - a.analysts.length)

    return { sortedGroups: sorted, overlapAssets }
  }, [filteredCoverage, allUncoveredAssets, matrixGroupBy, analysts, portfolioUniverseAssets, portfolioHoldings, portfolioTeamMemberships, userTeamMemberships, allOrgChartNodes])

  const toggleGroup = (key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Conflict assets for filter
  const conflictAssetIds = useMemo(() => new Set(matrixConflicts.map(c => c.assetId)), [matrixConflicts])

  if (sortedGroups.length === 0) {
    return (
      <div className="space-y-4">
        <Card className="p-8 text-center">
          <Grid3X3 className="h-12 w-12 mx-auto mb-4 text-gray-300" />
          <p className="text-gray-500">Select analysts to display.</p>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Controls Row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        {/* Grouping Selector */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">Group by:</span>
          <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
            {[
              { value: 'sector' as const, label: 'Sector' },
              { value: 'analyst' as const, label: 'Analyst' },
              { value: 'portfolio' as const, label: 'Portfolio' },
              { value: 'team' as const, label: 'Team' },
              { value: 'holdings' as const, label: 'Holdings' },
            ].map(option => (
              <button
                key={option.value}
                onClick={() => { setMatrixGroupBy(option.value); setCollapsedGroups(new Set()) }}
                className={clsx(
                  'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                  matrixGroupBy === option.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Right-side controls */}
        <div className="flex items-center gap-2">
          {/* My Team toggle */}
          <button
            onClick={() => setShowMyTeamOnly(!showMyTeamOnly)}
            className={clsx(
              'px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors',
              showMyTeamOnly ? 'bg-primary-50 text-primary-700 border-primary-200' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50',
            )}
          >
            My Team
          </button>

          {/* Conflicts filter */}
          {matrixConflicts.length > 0 && (
            <button
              onClick={() => setShowConflictsOnly(!showConflictsOnly)}
              className={clsx(
                'px-2 py-1.5 text-xs font-medium rounded-md border transition-colors',
                showConflictsOnly ? 'bg-red-50 text-red-700 border-red-200' : 'bg-white text-red-600 border-gray-200 hover:border-red-200',
              )}
            >
              Conflicts: {matrixConflicts.length}
            </button>
          )}

          {/* Analyst Selector */}
          <div className="relative" ref={analystPickerRef}>
            <button
              onClick={() => setShowAnalystPicker(!showAnalystPicker)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              <Users className="h-4 w-4 text-gray-500" />
              <span className="text-gray-700">
                {matrixSelectedAnalysts.size === 0 ? 'All Analysts' : `${matrixSelectedAnalysts.size} Selected`}
              </span>
              <ChevronDown className="h-4 w-4 text-gray-400" />
            </button>
            {showAnalystPicker && (
              <div className="absolute right-0 top-full mt-1 w-64 bg-white rounded-lg shadow-lg border border-gray-200 z-50 max-h-80 overflow-auto">
                <div className="p-2 border-b border-gray-100">
                  <button onClick={() => setMatrixSelectedAnalysts(new Set())} className="text-xs text-primary-600 hover:text-primary-700 font-medium">
                    Show All Analysts
                  </button>
                </div>
                <div className="p-1">
                  {allAnalysts.map(analyst => {
                    const isSelected = matrixSelectedAnalysts.size === 0 || matrixSelectedAnalysts.has(analyst)
                    return (
                      <label key={analyst} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 rounded cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {
                            const newSelected = new Set(matrixSelectedAnalysts)
                            if (matrixSelectedAnalysts.size === 0) {
                              allAnalysts.forEach(a => { if (a !== analyst) newSelected.add(a) })
                            } else if (newSelected.has(analyst)) {
                              newSelected.delete(analyst)
                              if (newSelected.size === 0) { setMatrixSelectedAnalysts(new Set()); return }
                            } else {
                              newSelected.add(analyst)
                            }
                            setMatrixSelectedAnalysts(newSelected)
                          }}
                          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        <span className="text-sm text-gray-700">{analyst}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Conflicts Banner (replaces overlap banner) */}
      {matrixConflicts.length > 0 && !showConflictsOnly && (
        <button
          onClick={() => setShowConflictsOnly(true)}
          className="w-full p-4 rounded-lg border text-left transition-all bg-red-50 border-red-200 hover:bg-red-100 hover:border-red-300"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-red-100">
                <AlertCircle className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-red-900">Coverage Conflicts Detected</h3>
                <p className="text-xs text-red-700">
                  {matrixConflicts.length} {matrixConflicts.length === 1 ? 'asset has' : 'assets have'} conflicting assignments (multiple leads or ambiguous primaries)
                </p>
              </div>
            </div>
            <span className="text-xs text-red-600">Click to filter</span>
          </div>
        </button>
      )}

      {showConflictsOnly && (
        <button
          onClick={() => setShowConflictsOnly(false)}
          className="w-full p-4 rounded-lg border text-left transition-all bg-red-100 border-red-400 ring-2 ring-red-400"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-red-200">
                <AlertCircle className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-red-900">Showing Conflicts Only</h3>
                <p className="text-xs text-red-700">{matrixConflicts.length} conflict{matrixConflicts.length !== 1 ? 's' : ''}</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-200 text-red-800 rounded text-xs font-medium">
              <X className="h-3 w-3" /> Clear Filter
            </span>
          </div>
        </button>
      )}

      {/* Overlap banner (shared coverage, non-conflicting) */}
      {overlapAssets.length > 0 && !showConflictsOnly && matrixConflicts.length === 0 && (
        <div className="p-3 rounded-lg border bg-violet-50/60 border-violet-200">
          <div className="flex items-center gap-3">
            <Users className="h-4 w-4 text-violet-600" />
            <p className="text-xs text-violet-700">
              {overlapAssets.length} {overlapAssets.length === 1 ? 'asset is' : 'assets are'} covered by multiple analysts
            </p>
          </div>
        </div>
      )}

      {/* Matrix groups */}
      {sortedGroups.map(([groupKey, group]) => {
        const isCollapsed = collapsedGroups.has(groupKey)
        const coveragePercent = group.totalCount > 0 ? Math.round((group.coveredCount / group.totalCount) * 100) : 0
        const groupUncoveredCount = group.totalCount - group.coveredCount
        const groupSharedCount = group.assets.filter(a => {
          const coveringAnalysts = filteredCoverage.filter(c => c.assets?.id === a.id && analysts.includes(c.analyst_name))
          return coveringAnalysts.length > 1
        }).length

        // Filter to conflicts only if active
        const displayedAssets = showConflictsOnly
          ? group.assets.filter(asset => conflictAssetIds.has(asset.id))
          : group.assets
        if (showConflictsOnly && displayedAssets.length === 0) return null

        // Conflicts count for this group
        const groupConflictCount = group.assets.filter(a => conflictAssetIds.has(a.id)).length

        return (
          <Card key={groupKey} className="overflow-hidden">
            {/* Group Header */}
            <button
              onClick={() => toggleGroup(groupKey)}
              onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY }) }}
              className="w-full px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between hover:bg-gray-100 transition-colors"
            >
              <div className="flex items-center gap-3">
                <ChevronDown className={clsx('h-4 w-4 text-gray-500 transition-transform', isCollapsed && '-rotate-90')} />
                <h3 className="text-sm font-semibold text-gray-900">{groupKey}</h3>
                <span className="text-xs text-gray-500">
                  {displayedAssets.length} {displayedAssets.length === 1 ? 'asset' : 'assets'}
                  {showConflictsOnly && <span className="text-red-600 ml-1">(conflicts)</span>}
                </span>
                {groupConflictCount > 0 && !showConflictsOnly && (
                  <span className="text-[10px] font-medium text-red-600">{groupConflictCount} conflict{groupConflictCount !== 1 ? 's' : ''}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-700">
                  {group.coveredCount} of {group.totalCount} covered
                </span>
                {groupSharedCount > 0 && (
                  <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-violet-100 text-violet-700">
                    {groupSharedCount} shared
                  </span>
                )}
                {groupUncoveredCount > 0 && (
                  <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-red-100 text-red-700">
                    {groupUncoveredCount} uncovered
                  </span>
                )}
                <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={clsx(
                      'h-full rounded-full',
                      coveragePercent === 100 ? 'bg-green-500' : coveragePercent >= 75 ? 'bg-blue-500' : coveragePercent >= 50 ? 'bg-yellow-500' : 'bg-red-500',
                    )}
                    style={{ width: `${coveragePercent}%` }}
                  />
                </div>
              </div>
            </button>

            {/* Matrix Table */}
            {!isCollapsed && matrixGroupBy === 'analyst' ? (
              /* Analyst grouping: simplified 3-column table */
              <div className="overflow-auto max-h-[600px]">
                <table className="min-w-full border-collapse">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase tracking-wider bg-gray-50 min-w-[180px]">
                        Asset
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase tracking-wider bg-gray-50 min-w-[100px]">
                        Role
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase tracking-wider bg-gray-50">
                        Also Covered By
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {displayedAssets
                      .sort((a, b) => a.symbol.localeCompare(b.symbol))
                      .map((asset, idx) => {
                        const assetCoverage = filteredCoverage.filter(c => c.assets?.id === asset.id)
                        const groupAnalystCoverage = assetCoverage.find(c => c.analyst_name === groupKey)
                        const otherAnalysts = assetCoverage.filter(c => c.analyst_name !== groupKey && analysts.includes(c.analyst_name))
                        const hasConflict = conflictAssetIds.has(asset.id)
                        const isEven = idx % 2 === 0

                        return (
                          <tr key={asset.id} className={clsx(
                            'hover:bg-gray-100/70 transition-colors',
                            hasConflict && 'bg-red-50/40',
                            !hasConflict && isEven && 'bg-gray-50/50',
                          )}>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <div className="flex flex-col min-w-0">
                                  <button
                                    onClick={() => window.dispatchEvent(new CustomEvent('navigate-to-asset', { detail: { type: 'asset', id: asset.id, title: asset.symbol, data: { id: asset.id, symbol: asset.symbol, company_name: asset.name } } }))}
                                    className="text-sm font-medium text-primary-600 hover:text-primary-700 hover:underline cursor-pointer text-left"
                                  >
                                    {asset.symbol}
                                  </button>
                                  <span className="text-xs text-gray-500 truncate max-w-[140px]" title={asset.name}>{asset.name}</span>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                {renderCoverageIndicator(groupAnalystCoverage, otherAnalysts.length > 0, groupKey)}
                                <span className="text-xs text-gray-700">
                                  {groupAnalystCoverage?.is_lead ? 'Lead' : groupAnalystCoverage?.role
                                  ? groupAnalystCoverage.role.charAt(0).toUpperCase() + groupAnalystCoverage.role.slice(1)
                                  : 'Covered'}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              {otherAnalysts.length > 0 ? (
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {otherAnalysts.map(c => (
                                    <span key={c.analyst_name} className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-gray-100 text-gray-700">
                                      {formatAnalystShortName(c.analyst_name)}
                                      {c.is_lead && <span className="text-primary-600">(Lead)</span>}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-xs text-gray-400">Sole coverage</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>
            ) : !isCollapsed ? (
              /* Standard matrix for non-analyst groupings */
              <div className="overflow-auto max-h-[600px]">
                <table className="min-w-full border-collapse">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase tracking-wider sticky left-0 z-30 bg-gray-50 min-w-[180px]">
                        Asset
                      </th>
                      {analysts.map(analyst => (
                        <th key={analyst} className="px-2 py-2 text-center text-xs font-medium text-gray-600 uppercase tracking-wider bg-gray-50 min-w-[56px]">
                          <div className="truncate max-w-[50px] mx-auto" title={analyst}>
                            {formatAnalystShortName(analyst)}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {displayedAssets
                      .sort((a, b) => a.symbol.localeCompare(b.symbol))
                      .map((asset, idx) => {
                        const assetCoverage = filteredCoverage.filter(c => c.assets?.id === asset.id)
                        const isUncovered = assetCoverage.length === 0
                        const displayedAnalystsCovering = assetCoverage.filter(c => analysts.includes(c.analyst_name))
                        const hasOverlap = displayedAnalystsCovering.length > 1
                        const hasConflict = conflictAssetIds.has(asset.id)
                        const isEven = idx % 2 === 0

                        const rowBg = isUncovered ? 'bg-red-50/50'
                          : hasConflict ? 'bg-red-50/40'
                          : hasOverlap ? 'bg-violet-50/40'
                          : isEven ? 'bg-gray-50/50'
                          : undefined

                        const stickyBg = isUncovered ? 'bg-red-50/50'
                          : hasConflict ? 'bg-red-50/40'
                          : hasOverlap ? 'bg-violet-50/40'
                          : isEven ? 'bg-gray-50/50'
                          : 'bg-white'

                        return (
                          <tr key={asset.id} className={clsx('hover:bg-gray-100/70 transition-colors', rowBg)}>
                            <td className={clsx('px-3 py-2 sticky left-0', stickyBg)}>
                              <div className="flex items-center gap-2">
                                {isUncovered && <AlertCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />}
                                <div className="flex flex-col min-w-0">
                                  <button
                                    onClick={() => window.dispatchEvent(new CustomEvent('navigate-to-asset', { detail: { type: 'asset', id: asset.id, title: asset.symbol, data: { id: asset.id, symbol: asset.symbol, company_name: asset.name } } }))}
                                    className="text-sm font-medium text-primary-600 hover:text-primary-700 hover:underline cursor-pointer text-left"
                                  >
                                    {asset.symbol}
                                  </button>
                                  <span className="text-xs text-gray-500 truncate max-w-[140px]" title={asset.name}>{asset.name}</span>
                                </div>
                              </div>
                            </td>
                            {analysts.map(analyst => {
                              const coverage = assetCoverage.find(c => c.analyst_name === analyst)
                              return (
                                <td key={analyst} className={clsx('px-2 py-2 text-center', coverage && hasOverlap && 'bg-violet-100/30')}>
                                  {renderCoverageIndicator(coverage, hasOverlap, analyst)}
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Card>
        )
      })}

      {/* Legend */}
      <div className="flex items-center justify-center gap-5 py-2 border-t border-gray-100 mt-2">
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 rounded-full bg-primary-600 text-white flex items-center justify-center">
            <span className="text-[8px] font-bold leading-none">L</span>
          </div>
          <span className="text-xs text-gray-600">Lead</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 rounded-full bg-primary-400" />
          <span className="text-xs text-gray-600">Primary</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 rounded-full border-2 border-primary-300 bg-primary-50" />
          <span className="text-xs text-gray-600">Shared</span>
        </div>
        <div className="flex items-center gap-1.5">
          <AlertCircle className="h-4 w-4 text-red-500" />
          <span className="text-xs text-gray-600">Uncovered Asset</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-3 rounded-sm bg-violet-100 border border-violet-200" />
          <span className="text-xs text-gray-600">Shared coverage row</span>
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
          <div className="fixed z-50 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[160px]" style={{ left: contextMenu.x, top: contextMenu.y }}>
            <button
              onClick={() => { setCollapsedGroups(new Set()); setContextMenu(null) }}
              className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
            >
              <Maximize2 className="h-4 w-4 text-gray-400" />
              <span className="text-gray-700">Expand All</span>
            </button>
            <button
              onClick={() => {
                const allKeys = new Set(sortedGroups.map(([k]) => k))
                setCollapsedGroups(allKeys)
                setContextMenu(null)
              }}
              className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
            >
              <Minimize2 className="h-4 w-4 text-gray-400" />
              <span className="text-gray-700">Collapse All</span>
            </button>
          </div>
        </>
      )}
    </div>
  )
}
