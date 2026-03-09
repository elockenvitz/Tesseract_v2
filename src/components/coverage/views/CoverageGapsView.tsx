import React, { useState, useMemo } from 'react'
import { clsx } from 'clsx'
import {
  ChevronDown, ChevronRight, AlertCircle, Search, RefreshCw,
  CheckCircle, Briefcase, Info, X, Check
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabase'
import { Card } from '../../ui/Card'
import { formatMarketCap } from '../../../lib/coverage/coverage-utils'
import type { CoverageRecord, ListGroupByLevel } from '../../../lib/coverage/coverage-types'

// ─── Props ────────────────────────────────────────────────────────────

export interface CoverageGapsViewProps {
  // Data
  gapsData: any[] | undefined
  gapsLoading: boolean
  searchQuery: string
  allAssetsWithStatus: any[] | undefined
  portfolioUniverseData: Array<{
    portfolio: { id: string; name: string }
    assets: Array<{ id: string; symbol: string; company_name: string; sector?: string; industry?: string; market_cap?: number }>
    universeSize: number
    hasUniverseDefinition: boolean
  }> | undefined
  portfolioHoldings: Map<string, Array<{ id: string; symbol: string; name: string; sector: string }>> | undefined
  filteredCoverage: CoverageRecord[]

  // State
  listGroupByLevels: ListGroupByLevel[]
  collapsedGapsGroups: Set<string>
  setCollapsedGapsGroups: React.Dispatch<React.SetStateAction<Set<string>>>

  // Actions
  setAddingCoverage: (coverage: any) => void
  setAssetSearchQuery: (query: string) => void
  hasAnyCoverageAdminRights: boolean
  coverageSettings: { default_visibility?: string } | undefined
  userTeams: Array<{ id: string }> | undefined
  getLocalDateString: () => string

  // Bulk assign mutation (legacy — kept for compat)
  addCoverageMutation: { mutate: (args: any) => void; isPending?: boolean }

  // New props for bulk assign modal
  users: Array<{ id: string; email: string | null; first_name: string | null; last_name: string | null }> | undefined
  allOrgChartNodes: { nodes: any[]; allNodes: any[] } | undefined
  currentUserId: string | undefined
}

// ─── Sort types ──────────────────────────────────────────────────────

type SortDir = 'asc' | 'desc'
type ColumnSortKey = 'symbol' | 'priority' | 'portfolios' | 'sector' | 'marketCap'

const NODE_TYPE_SECTIONS: Array<{ type: string; label: string }> = [
  { type: 'division',   label: 'Divisions' },
  { type: 'department', label: 'Departments' },
  { type: 'team',       label: 'Teams' },
  { type: 'portfolio',  label: 'Portfolios' },
]

// ─── Priority score ──────────────────────────────────────────────────

// Tiers: 0=Critical (holding+largeCap), 1=Critical (holding), 2=High (largeCap), 3=Medium (watchlist), 4=Low
function priorityScore(asset: any, holdingIds: Set<string>): number {
  const isHolding = holdingIds.has(asset.id)
  const isLargeCap = asset.market_cap != null && asset.market_cap >= 10e9
  if (isHolding && isLargeCap) return 0
  if (isHolding) return 1
  if (isLargeCap) return 2
  if (asset.is_watchlisted) return 3
  return 4
}

function sortAssetsByColumn(
  assets: any[],
  sort: { key: ColumnSortKey; dir: SortDir },
  holdingIds: Set<string>,
  portfoliosByAsset?: Map<string, string[]>,
): any[] {
  const sorted = [...assets]
  const dir = sort.dir === 'asc' ? 1 : -1
  switch (sort.key) {
    case 'symbol':
      sorted.sort((a, b) => dir * (a.symbol || '').localeCompare(b.symbol || ''))
      break
    case 'priority':
      sorted.sort((a, b) => {
        const pa = priorityScore(a, holdingIds)
        const pb = priorityScore(b, holdingIds)
        if (pa !== pb) return dir * (pa - pb)
        return (b.market_cap || 0) - (a.market_cap || 0)
      })
      break
    case 'portfolios':
      sorted.sort((a, b) => {
        const aN = portfoliosByAsset?.get(a.id)?.length || 0
        const bN = portfoliosByAsset?.get(b.id)?.length || 0
        if (aN !== bN) return dir * (aN - bN)
        return (a.symbol || '').localeCompare(b.symbol || '')
      })
      break
    case 'sector':
      sorted.sort((a, b) => {
        const sa = (a.sector || 'zzz').toLowerCase()
        const sb = (b.sector || 'zzz').toLowerCase()
        if (sa !== sb) return dir * sa.localeCompare(sb)
        return (a.symbol || '').localeCompare(b.symbol || '')
      })
      break
    case 'marketCap':
      sorted.sort((a, b) => dir * ((a.market_cap || 0) - (b.market_cap || 0)))
      break
  }
  return sorted
}

// ─── Component ────────────────────────────────────────────────────────

export function CoverageGapsView(props: CoverageGapsViewProps) {
  const {
    gapsData, gapsLoading, searchQuery, allAssetsWithStatus,
    portfolioUniverseData, portfolioHoldings, filteredCoverage,
    listGroupByLevels,
    collapsedGapsGroups, setCollapsedGapsGroups,
    setAddingCoverage, setAssetSearchQuery,
    hasAnyCoverageAdminRights,
    coverageSettings, userTeams, getLocalDateString,
    users, allOrgChartNodes, currentUserId,
  } = props

  const queryClient = useQueryClient()

  // ── Local state ────────────────────────────────────────────────
  const [selectedGapAssets, setSelectedGapAssets] = useState<Set<string>>(new Set())
  const [colSort, setColSort] = useState<{ key: ColumnSortKey; dir: SortDir }>({ key: 'priority', dir: 'asc' })
  const [gapGroupBy, setGapGroupBy] = useState<'none' | 'sector' | 'industry' | 'portfolio'>('none')

  // Bulk assign modal state
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false)
  const [bulkAnalystId, setBulkAnalystId] = useState('')
  const [bulkAnalystSearch, setBulkAnalystSearch] = useState('')
  const [bulkAnalystDropdownOpen, setBulkAnalystDropdownOpen] = useState(false)
  const [bulkGroupId, setBulkGroupId] = useState<string | null>(null)
  const [bulkCoversForOpen, setBulkCoversForOpen] = useState(false)
  const [bulkCoversForExpanded, setBulkCoversForExpanded] = useState<Set<string>>(new Set())
  const [bulkAssigning, setBulkAssigning] = useState(false)
  const [bulkAssetsExpanded, setBulkAssetsExpanded] = useState(false)

  const showPortfolioView = gapGroupBy === 'portfolio' || listGroupByLevels.includes('portfolio')

  // ── Gap urgency — check if asset is in portfolio holdings ──────
  const holdingAssetIds = useMemo(() => {
    if (!portfolioHoldings) return new Set<string>()
    const ids = new Set<string>()
    portfolioHoldings.forEach(assets => assets.forEach(a => ids.add(a.id)))
    return ids
  }, [portfolioHoldings])

  // Invert portfolioHoldings: assetId → portfolio names
  const portfoliosByAsset = useMemo(() => {
    const map = new Map<string, string[]>()
    if (!portfolioHoldings) return map
    portfolioHoldings.forEach((assets, portfolioName) => {
      for (const a of assets) {
        const existing = map.get(a.id)
        if (existing) existing.push(portfolioName)
        else map.set(a.id, [portfolioName])
      }
    })
    return map
  }, [portfolioHoldings])

  // ── Derived data ───────────────────────────────────────────────
  const gapsGrouping: 'sector' | 'industry' | null = (gapGroupBy === 'sector' || gapGroupBy === 'industry') ? gapGroupBy : null

  const filteredGapsData = useMemo(() => {
    let data = gapsData || []
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      data = data.filter((asset: any) =>
        asset.symbol.toLowerCase().includes(q) ||
        asset.company_name.toLowerCase().includes(q) ||
        (asset.sector && asset.sector.toLowerCase().includes(q)) ||
        (asset.industry && asset.industry.toLowerCase().includes(q))
      )
    }
    return sortAssetsByColumn(data, colSort, holdingAssetIds, portfoliosByAsset)
  }, [gapsData, searchQuery, colSort, holdingAssetIds, portfoliosByAsset])

  const matchingCoveredAssets = useMemo(() => {
    if (!searchQuery || !allAssetsWithStatus) return []
    return allAssetsWithStatus.filter((asset: any) =>
      asset.isCovered && (
        asset.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        asset.company_name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    )
  }, [searchQuery, allAssetsWithStatus])

  // Effective gap count for header
  const effectiveGapCount = useMemo(() => {
    if (showPortfolioView) {
      if (searchQuery && portfolioUniverseData) {
        const q = searchQuery.toLowerCase()
        return portfolioUniverseData.reduce((sum, p) =>
          sum + p.assets.filter(a =>
            a.symbol.toLowerCase().includes(q) ||
            a.company_name.toLowerCase().includes(q) ||
            (a.sector && a.sector.toLowerCase().includes(q)) ||
            (a.industry && a.industry.toLowerCase().includes(q))
          ).length
        , 0)
      }
      return portfolioUniverseData?.reduce((sum, p) => sum + p.assets.length, 0) || 0
    }
    return filteredGapsData.length
  }, [showPortfolioView, portfolioUniverseData, filteredGapsData, searchQuery])

  const totalGapCount = useMemo(() => {
    if (showPortfolioView) return portfolioUniverseData?.reduce((sum, p) => sum + p.assets.length, 0) || 0
    return gapsData?.length || 0
  }, [showPortfolioView, portfolioUniverseData, gapsData])

  // Market cap visibility
  const hasAnyMarketCap = useMemo(() =>
    filteredGapsData.some((a: any) => a.market_cap != null && a.market_cap > 0),
    [filteredGapsData]
  )

  // ── Actions ────────────────────────────────────────────────────
  const addAsset = (asset: any) => {
    setAddingCoverage({
      assetId: asset.id, analystId: '', startDate: getLocalDateString(), endDate: '',
      role: '', portfolioIds: [], notes: '',
      teamId: null,
      visibility: null,
      isLead: false,
    })
    setAssetSearchQuery(asset.symbol)
  }

  const toggleGapSelect = (assetId: string) => {
    setSelectedGapAssets(prev => {
      const next = new Set(prev)
      if (next.has(assetId)) next.delete(assetId)
      else next.add(assetId)
      return next
    })
  }

  // ── Bulk assign ────────────────────────────────────────────────
  const selectedUser = useMemo(() => {
    if (!bulkAnalystId || !users) return null
    return users.find(u => u.id === bulkAnalystId) || null
  }, [bulkAnalystId, users])

  const bulkGroupLabel = useMemo(() => {
    if (bulkGroupId === '__firm__') return 'Firm-wide'
    if (!bulkGroupId || !allOrgChartNodes) return null
    const node = allOrgChartNodes.nodes.find((n: any) => n.id === bulkGroupId)
    return node?.displayName || node?.name || null
  }, [bulkGroupId, allOrgChartNodes])

  const openBulkAssign = () => {
    setBulkAnalystId('')
    setBulkAnalystSearch('')
    setBulkGroupId(null)
    setBulkAssigning(false)
    setBulkCoversForExpanded(new Set())
    setBulkAssetsExpanded(false)
    setBulkAssignOpen(true)
  }

  const handleBulkAssign = async () => {
    if (!bulkAnalystId || !bulkGroupId || !selectedUser) return
    setBulkAssigning(true)

    const isFirm = bulkGroupId === '__firm__'
    const node = !isFirm ? allOrgChartNodes?.nodes.find((n: any) => n.id === bulkGroupId) : null
    const analystName = selectedUser.first_name && selectedUser.last_name
      ? `${selectedUser.first_name} ${selectedUser.last_name}`
      : selectedUser.email?.split('@')[0] || 'Unknown'

    const selectedAssetIds = Array.from(selectedGapAssets)
    const records = selectedAssetIds.map(assetId => ({
      asset_id: assetId,
      user_id: bulkAnalystId,
      analyst_name: analystName,
      team_id: isFirm ? null : bulkGroupId,
      visibility: isFirm ? 'firm' : (node?.node_type === 'division' || node?.node_type === 'department' ? 'division' : 'team'),
      start_date: getLocalDateString(),
      changed_by: currentUserId,
    }))

    try {
      const { error } = await supabase.from('coverage').insert(records)
      if (error) throw error
      queryClient.invalidateQueries({ queryKey: ['all-coverage'] })
      queryClient.invalidateQueries({ queryKey: ['coverage'] })
      queryClient.invalidateQueries({ queryKey: ['coverage-gaps'] })
      setSelectedGapAssets(new Set())
      setBulkAssignOpen(false)
    } catch (err) {
      console.error('Bulk assign failed:', err)
    } finally {
      setBulkAssigning(false)
    }
  }

  // Analyst workload: count unique active assets per user_id
  const analystWorkload = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const r of filteredCoverage) {
      if (!r.is_active) continue
      const set = map.get(r.user_id)
      if (set) set.add(r.asset_id)
      else map.set(r.user_id, new Set([r.asset_id]))
    }
    const counts = new Map<string, number>()
    map.forEach((assets, userId) => counts.set(userId, assets.size))
    return counts
  }, [filteredCoverage])

  // All selected asset objects (for modal preview)
  const selectedAssetObjects = useMemo(() => {
    const allAssets = showPortfolioView
      ? portfolioUniverseData?.flatMap(p => p.assets) || []
      : filteredGapsData
    return allAssets.filter((a: any) => selectedGapAssets.has(a.id))
  }, [selectedGapAssets, filteredGapsData, showPortfolioView, portfolioUniverseData])

  // ── Risk summary stats (contextual to selected universe) ────────
  const riskStats = useMemo(() => {
    const data = showPortfolioView
      ? (portfolioUniverseData?.flatMap(p => p.assets) || [])
      : filteredGapsData
    const holdingCount = data.filter((a: any) => holdingAssetIds.has(a.id)).length
    const largeCapCount = data.filter((a: any) => a.market_cap != null && a.market_cap >= 10e9).length
    const watchlistCount = data.filter((a: any) => a.is_watchlisted).length
    return { holdingCount, largeCapCount, watchlistCount, total: data.length }
  }, [filteredGapsData, holdingAssetIds, showPortfolioView, portfolioUniverseData])

  // ── Priority tier (separate column) ─────────────────────────────
  // Critical = portfolio holding | High = large cap | Medium = watchlist | Low = (default)
  const getAssetTier = (asset: any): { label: string; cls: string } => {
    const isHolding = holdingAssetIds.has(asset.id)
    const isLargeCap = asset.market_cap != null && asset.market_cap >= 10e9
    const isWatchlisted = asset.is_watchlisted
    if (isHolding) return { label: 'Critical', cls: 'bg-red-50 text-red-700 border-red-200' }
    if (isLargeCap) return { label: 'High', cls: 'bg-amber-50 text-amber-700 border-amber-200' }
    if (isWatchlisted) return { label: 'Medium', cls: 'bg-blue-50 text-blue-600 border-blue-200' }
    return { label: 'Low', cls: 'bg-gray-50 text-gray-400 border-gray-200' }
  }

  const renderPriorityBadge = (asset: any) => {
    const tier = getAssetTier(asset)
    return (
      <span className={clsx('px-1.5 py-0.5 text-[9px] font-semibold rounded-full border whitespace-nowrap', tier.cls)}>
        {tier.label}
      </span>
    )
  }

  const renderPortfolioCell = (asset: any) => {
    const names = portfoliosByAsset.get(asset.id)
    if (!names || names.length === 0) return <span className="text-[11px] text-gray-300">—</span>
    if (names.length === 1) return <span className="text-[11px] text-gray-600 truncate">{names[0]}</span>
    return (
      <span className="text-[11px] text-gray-600 truncate" title={names.join(', ')}>
        {names[0]} <span className="text-gray-400">+{names.length - 1}</span>
      </span>
    )
  }

  // ── Coverage % color coding ────────────────────────────────────
  const coverageColor = (pct: number) => {
    if (pct >= 90) return { text: 'text-green-700', bg: 'bg-green-50', border: 'border-green-200', bar: 'bg-green-500' }
    if (pct >= 70) return { text: 'text-yellow-700', bg: 'bg-yellow-50', border: 'border-yellow-200', bar: 'bg-yellow-500' }
    if (pct >= 40) return { text: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-200', bar: 'bg-orange-500' }
    return { text: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200', bar: 'bg-red-500' }
  }

  // ── Portfolio risk summary (sorted worst-first) ──────────────
  const portfolioRiskSummary = useMemo(() => {
    if (!portfolioUniverseData) return []
    return portfolioUniverseData
      .filter(p => p.hasUniverseDefinition)
      .map(p => {
        const pct = p.universeSize > 0 ? Math.round(((p.universeSize - p.assets.length) / p.universeSize) * 100) : 100
        return { name: p.portfolio.name, id: p.portfolio.id, pct, gaps: p.assets.length, universeSize: p.universeSize }
      })
      .sort((a, b) => a.pct - b.pct)
  }, [portfolioUniverseData])

  // ── Column sort ───────────────────────────────────────────────
  const handleColumnSort = (key: ColumnSortKey) => {
    setColSort(prev =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'marketCap' ? 'desc' : 'asc' }
    )
  }
  const sortIndicator = (key: ColumnSortKey) =>
    colSort.key === key ? (colSort.dir === 'asc' ? ' ↑' : ' ↓') : ''

  // ── Grid template ──────────────────────────────────────────────
  // Columns: [checkbox] | Asset | Priority | Portfolios | Sector | [Market Cap] | Action
  const gridStyle = (opts: { checkbox: boolean; mcap: boolean }): React.CSSProperties => ({
    display: 'grid',
    gridTemplateColumns: [
      opts.checkbox ? '28px' : '',
      'minmax(120px, 220px)',     // Asset (capped)
      '85px',                    // Priority
      '180px',                   // Portfolios
      '150px',                   // Sector
      opts.mcap ? '110px' : '',  // Market Cap
      '1fr',                     // Action (right-aligned, absorbs remaining space)
    ].filter(Boolean).join(' '),
    alignItems: 'center',
    columnGap: '2px',
  })

  // ── Loading ────────────────────────────────────────────────────
  if (gapsLoading) {
    return (
      <Card padding="none" className="h-[calc(90vh-280px)] flex flex-col overflow-hidden">
        <div className="flex-1 flex items-center justify-center">
          <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      </Card>
    )
  }

  // ── Render ─────────────────────────────────────────────────────
  return (
    <Card padding="none" className="h-[calc(90vh-280px)] flex flex-col overflow-hidden relative">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 space-y-2">
        {/* Row 1: Title + count + tooltip */}
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900">Coverage Gaps</h3>
          <span className="text-[11px] text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full">
            {effectiveGapCount !== totalGapCount
              ? `${effectiveGapCount}/${totalGapCount} assets without analyst coverage`
              : `${totalGapCount} asset${totalGapCount !== 1 ? 's' : ''} without analyst coverage`}
            {showPortfolioView && ' across portfolios'}
          </span>
          <div className="relative ml-0.5 group/tip">
            <Info className="h-3.5 w-3.5 text-gray-400 cursor-help" />
            <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 w-56 px-2.5 py-1.5 rounded-md bg-gray-900 text-[10px] leading-relaxed text-gray-100 shadow-lg opacity-0 pointer-events-none group-hover/tip:opacity-100 transition-opacity z-30">
              Coverage gaps are assets in the selected universe with no analyst coverage assignments.
            </div>
          </div>
        </div>

        {/* Row 2: Group by */}
        <div className="flex items-center gap-2">
          <select
            value={gapGroupBy}
            onChange={(e) => setGapGroupBy(e.target.value as 'none' | 'sector' | 'industry' | 'portfolio')}
            className="text-[11px] bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-primary-400"
          >
            <option value="none">Group by: None</option>
            <option value="portfolio">Group by: Portfolio</option>
            <option value="sector">Group by: Sector</option>
            <option value="industry">Group by: Industry</option>
          </select>
        </div>

        {/* Risk summary cards — contextual to selected universe */}
        {riskStats.total > 0 && (riskStats.holdingCount > 0 || riskStats.largeCapCount > 0 || riskStats.watchlistCount > 0) && (
          <div className="flex items-center gap-3 pt-0.5">
            {riskStats.holdingCount > 0 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-50 border border-red-200">
                <Briefcase className="h-3 w-3 text-red-400" />
                <span className="text-[11px] font-medium text-red-700">{riskStats.holdingCount}</span>
                <span className="text-[10px] text-red-600">critical — holdings uncovered</span>
              </div>
            )}
            {riskStats.largeCapCount > 0 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 border border-amber-200">
                <AlertCircle className="h-3 w-3 text-amber-400" />
                <span className="text-[11px] font-medium text-amber-700">{riskStats.largeCapCount}</span>
                <span className="text-[10px] text-amber-600">high — large cap uncovered</span>
              </div>
            )}
            {riskStats.watchlistCount > 0 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-50 border border-blue-200">
                <AlertCircle className="h-3 w-3 text-blue-400" />
                <span className="text-[11px] font-medium text-blue-600">{riskStats.watchlistCount}</span>
                <span className="text-[10px] text-blue-500">medium — watchlist uncovered</span>
              </div>
            )}
          </div>
        )}

      </div>

      {/* ── Bulk action bar (floating overlay) ───────────────── */}
      {selectedGapAssets.size > 0 && hasAnyCoverageAdminRights && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 py-2 px-4 bg-primary-600 rounded-full shadow-lg">
          <span className="text-xs font-medium text-white">
            {selectedGapAssets.size} selected
          </span>
          <button
            onClick={openBulkAssign}
            className="px-3 py-1 text-xs font-medium text-primary-700 bg-white hover:bg-primary-50 rounded-full transition-colors"
          >
            Assign Coverage
          </button>
          <button
            onClick={() => setSelectedGapAssets(new Set())}
            className="text-xs text-primary-200 hover:text-white"
          >
            Clear
          </button>
        </div>
      )}

      {/* ── Portfolio-based gaps view ─────────────────────────── */}
      {showPortfolioView ? (
        <div className="flex-1 overflow-y-auto">
          {!portfolioUniverseData || portfolioUniverseData.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <Briefcase className="h-12 w-12 text-gray-300 mb-3" />
              <p className="text-sm font-medium">No portfolio universes defined</p>
              <p className="text-xs text-gray-400 mt-1">Define investable universes in portfolios to see coverage gaps.</p>
            </div>
          ) : (
            <div>
              {/* ── Portfolio risk overview strip ────────────────── */}
              {portfolioRiskSummary.length > 0 && (
                <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Coverage Risk Across Portfolios</p>
                  <div className="flex flex-wrap gap-2">
                    {portfolioRiskSummary.map(p => {
                      const c = coverageColor(p.pct)
                      return (
                        <button
                          key={p.id}
                          onClick={() => {
                            // Scroll to and expand this portfolio
                            setCollapsedGapsGroups(prev => { const next = new Set(prev); next.delete(p.id); return next })
                            document.getElementById(`portfolio-${p.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                          }}
                          className={clsx('flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-left transition-colors hover:shadow-sm', c.bg, c.border)}
                        >
                          <div className="min-w-0">
                            <p className="text-[11px] font-medium text-gray-900 truncate">{p.name}</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className={clsx('text-[11px] font-bold', c.text)}>{p.pct}%</span>
                              <span className="text-[10px] text-gray-500">{p.gaps} gap{p.gaps !== 1 ? 's' : ''}</span>
                            </div>
                          </div>
                          {/* Mini progress bar */}
                          <div className="w-10 h-1.5 bg-gray-200 rounded-full overflow-hidden flex-shrink-0">
                            <div className={clsx('h-full rounded-full', c.bar)} style={{ width: `${p.pct}%` }} />
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* ── Portfolio sections ────────────────────────────── */}
              {portfolioUniverseData.map(portfolioData => {
                const q = searchQuery?.toLowerCase() || ''
                const baseAssets = q
                  ? portfolioData.assets.filter(a =>
                      a.symbol.toLowerCase().includes(q) ||
                      a.company_name.toLowerCase().includes(q) ||
                      (a.sector && a.sector.toLowerCase().includes(q)) ||
                      (a.industry && a.industry.toLowerCase().includes(q))
                    )
                  : portfolioData.assets
                const filteredAssets = sortAssetsByColumn(baseAssets, colSort, holdingAssetIds, portfoliosByAsset)
                const isCollapsed = collapsedGapsGroups.has(portfolioData.portfolio.id)
                const gapCount = filteredAssets.length
                const totalGapCt = portfolioData.assets.length
                const hasUniverse = portfolioData.hasUniverseDefinition
                const coveragePercent = hasUniverse && portfolioData.universeSize > 0
                  ? Math.round(((portfolioData.universeSize - totalGapCt) / portfolioData.universeSize) * 100)
                  : null
                const portHasAnyMcap = filteredAssets.some(a => a.market_cap != null && a.market_cap > 0)
                const cc = coveragePercent != null ? coverageColor(coveragePercent) : null

                return (
                  <div key={portfolioData.portfolio.id} id={`portfolio-${portfolioData.portfolio.id}`} className="border-b border-gray-200 last:border-b-0">
                    {/* Portfolio header */}
                    <button
                      onClick={() => {
                        setCollapsedGapsGroups(prev => {
                          const next = new Set(prev)
                          if (next.has(portfolioData.portfolio.id)) next.delete(portfolioData.portfolio.id)
                          else next.add(portfolioData.portfolio.id)
                          return next
                        })
                      }}
                      className="w-full px-4 py-2 bg-gray-50/80 hover:bg-gray-100 flex items-center gap-3 text-left"
                    >
                      {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-gray-400" /> : <ChevronDown className="h-3.5 w-3.5 text-gray-400" />}
                      <Briefcase className="h-3.5 w-3.5 text-gray-500" />
                      <span className="text-[12px] font-semibold text-gray-900">{portfolioData.portfolio.name}</span>

                      {!hasUniverse ? (
                        <span className="text-[10px] text-gray-400 italic">No investable universe defined</span>
                      ) : coveragePercent != null && totalGapCt === 0 ? (
                        <span className="text-[10px] text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full flex items-center gap-1 font-medium">
                          <CheckCircle className="h-3 w-3" /> 100% covered
                        </span>
                      ) : coveragePercent != null ? (
                        <div className="flex items-center gap-2">
                          {/* Coverage % badge */}
                          <span className={clsx('text-[10px] font-bold px-2 py-0.5 rounded-full border', cc!.bg, cc!.text, cc!.border)}>
                            {coveragePercent}% covered
                          </span>
                          {/* Gap count */}
                          <span className="text-[10px] text-gray-500">
                            {searchQuery && gapCount !== totalGapCt ? `${gapCount}/${totalGapCt}` : totalGapCt} gap{(searchQuery && gapCount !== totalGapCt ? gapCount : totalGapCt) !== 1 ? 's' : ''}
                          </span>
                          {/* Mini progress bar */}
                          <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                            <div className={clsx('h-full rounded-full transition-all', cc!.bar)} style={{ width: `${coveragePercent}%` }} />
                          </div>
                          <span className="text-[10px] text-gray-400">{portfolioData.universeSize} in universe</span>
                        </div>
                      ) : null}
                    </button>

                    {/* Portfolio body */}
                    {!isCollapsed && (
                      !hasUniverse ? (
                        <div className="px-4 py-3 text-center">
                          <p className="text-[12px] text-gray-400">No investable universe defined for this portfolio.</p>
                          <p className="text-[10px] text-gray-400 mt-0.5">Define an investable universe to track coverage gaps.</p>
                        </div>
                      ) : gapCount === 0 ? (
                        <div className="px-4 py-3 text-center">
                          <p className="text-[12px] text-green-600">
                            {searchQuery ? `No gaps matching "${searchQuery}"` : `All ${portfolioData.universeSize} assets in the investable universe are covered.`}
                          </p>
                        </div>
                      ) : (
                        <div className="divide-y divide-gray-100">
                          {filteredAssets.map(asset => {
                            const tier = getAssetTier(asset)
                            return (
                              <div key={asset.id} className="px-4 py-1.5 hover:bg-gray-50" style={gridStyle({ checkbox: hasAnyCoverageAdminRights, mcap: portHasAnyMcap })}>
                                {hasAnyCoverageAdminRights && (
                                  <div className="flex items-center">
                                    <input
                                      type="checkbox"
                                      checked={selectedGapAssets.has(asset.id)}
                                      onChange={() => toggleGapSelect(asset.id)}
                                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 h-3.5 w-3.5"
                                    />
                                  </div>
                                )}
                                <div className="min-w-0 px-2">
                                  <p className="text-[12px] font-semibold text-gray-900">{asset.symbol}</p>
                                  <p className="text-[11px] text-gray-500 truncate">{asset.company_name}</p>
                                </div>
                                <div>
                                  <span className={clsx('inline-flex px-1.5 py-0.5 text-[9px] font-bold rounded border whitespace-nowrap', tier.cls)}>
                                    {tier.label}
                                  </span>
                                </div>
                                <div className="pl-3 pr-2 min-w-0">{renderPortfolioCell(asset)}</div>
                                <div className="px-2"><span className="text-[12px] text-gray-600">{asset.sector || '—'}</span></div>
                                {portHasAnyMcap && (
                                  <div className="px-2 text-right"><span className="text-[12px] text-gray-600">{formatMarketCap(asset.market_cap)}</span></div>
                                )}
                                <div className="flex justify-end">
                                  {hasAnyCoverageAdminRights && (
                                    <button
                                      onClick={() => addAsset(asset)}
                                      className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-primary-600 hover:text-white hover:bg-primary-600 border border-primary-200 hover:border-primary-600 rounded-md transition-colors"
                                    >
                                      <span className="text-[10px]">+</span> Assign
                                    </button>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* ── Firm universe column header ────────────────────── */}
          {!gapsGrouping && (
            <div className="px-4 py-1.5 bg-gray-50 border-b border-gray-200"
              style={gridStyle({ checkbox: hasAnyCoverageAdminRights, mcap: hasAnyMarketCap })}
            >
              {hasAnyCoverageAdminRights && <div />}
              <div onDoubleClick={() => handleColumnSort('symbol')} className="px-2 text-[10px] font-semibold text-gray-600 uppercase tracking-wider cursor-pointer select-none hover:text-gray-900">Asset{sortIndicator('symbol')}</div>
              <div onDoubleClick={() => handleColumnSort('priority')} className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider cursor-pointer select-none hover:text-gray-900">Priority{sortIndicator('priority')}</div>
              <div onDoubleClick={() => handleColumnSort('portfolios')} className="pl-3 pr-2 text-[10px] font-semibold text-gray-600 uppercase tracking-wider cursor-pointer select-none hover:text-gray-900">Portfolios{sortIndicator('portfolios')}</div>
              <div onDoubleClick={() => handleColumnSort('sector')} className="px-2 text-[10px] font-semibold text-gray-600 uppercase tracking-wider cursor-pointer select-none hover:text-gray-900">Sector{sortIndicator('sector')}</div>
              {hasAnyMarketCap && (
                <div onDoubleClick={() => handleColumnSort('marketCap')} className="px-2 text-[10px] font-semibold text-gray-600 uppercase tracking-wider text-right cursor-pointer select-none hover:text-gray-900">Mkt Cap{sortIndicator('marketCap')}</div>
              )}
              <div />
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {!gapsData || gapsData.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <CheckCircle className="h-12 w-12 text-green-400 mb-3" />
                <p className="text-sm font-medium">No uncovered assets in this universe.</p>
                <p className="text-xs text-gray-400 mt-1">Every asset in the system has active coverage.</p>
              </div>
            ) : filteredGapsData.length === 0 && matchingCoveredAssets.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <Search className="h-12 w-12 text-gray-300 mb-3" />
                <p className="text-sm font-medium">No assets matching &ldquo;{searchQuery}&rdquo;</p>
                <p className="text-xs text-gray-400 mt-1">Try a different search term.</p>
              </div>
            ) : !gapsGrouping ? (
              <div className="divide-y divide-gray-100">
                {/* Select all */}
                {hasAnyCoverageAdminRights && filteredGapsData.length > 0 && (
                  <div className="px-4 py-1 bg-gray-50/50">
                    <label className="flex items-center gap-2 text-[11px] text-gray-500 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filteredGapsData.length > 0 && filteredGapsData.every((a: any) => selectedGapAssets.has(a.id))}
                        onChange={() => {
                          const allIds = filteredGapsData.map((a: any) => a.id)
                          const allSelected = allIds.every(id => selectedGapAssets.has(id))
                          if (allSelected) setSelectedGapAssets(new Set())
                          else setSelectedGapAssets(new Set(allIds))
                        }}
                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 h-3.5 w-3.5"
                      />
                      Select all
                    </label>
                  </div>
                )}
                {filteredGapsData.map((asset: any) => (
                  <div key={asset.id} className="px-4 py-1.5 hover:bg-gray-50"
                    style={gridStyle({ checkbox: hasAnyCoverageAdminRights, mcap: hasAnyMarketCap })}
                  >
                    {hasAnyCoverageAdminRights && (
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          checked={selectedGapAssets.has(asset.id)}
                          onChange={() => toggleGapSelect(asset.id)}
                          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 h-3.5 w-3.5"
                        />
                      </div>
                    )}
                    <div className="min-w-0 px-2">
                      <p className="text-[12px] font-semibold text-gray-900">{asset.symbol}</p>
                      <p className="text-[11px] text-gray-500 truncate">{asset.company_name}</p>
                    </div>
                    <div>
                      {(() => { const tier = getAssetTier(asset); return (
                        <span className={clsx('inline-flex px-1.5 py-0.5 text-[9px] font-bold rounded border whitespace-nowrap', tier.cls)}>{tier.label}</span>
                      ) })()}
                    </div>
                    <div className="pl-3 pr-2 min-w-0">{renderPortfolioCell(asset)}</div>
                    <div className="px-2"><span className="text-[12px] text-gray-600">{asset.sector || '—'}</span></div>
                    {hasAnyMarketCap && (
                      <div className="px-2 text-right"><span className="text-[12px] text-gray-600">{formatMarketCap(asset.market_cap)}</span></div>
                    )}
                    <div className="flex justify-end">
                      {hasAnyCoverageAdminRights && (
                        <button
                          onClick={() => addAsset(asset)}
                          className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-primary-600 hover:text-white hover:bg-primary-600 border border-primary-200 hover:border-primary-600 rounded-md transition-colors"
                        >
                          <span className="text-[10px]">+</span> Assign
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {matchingCoveredAssets.map((asset: any) => (
                  <div key={asset.id} className="px-4 py-1.5 hover:bg-gray-50 bg-green-50/50"
                    style={gridStyle({ checkbox: hasAnyCoverageAdminRights, mcap: hasAnyMarketCap })}
                  >
                    {hasAnyCoverageAdminRights && <div />}
                    <div className="min-w-0 px-2">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                        <div>
                          <p className="text-[12px] font-medium text-gray-900">{asset.symbol}</p>
                          <p className="text-[11px] text-gray-500 truncate">{asset.company_name}</p>
                        </div>
                      </div>
                    </div>
                    <div />
                    <div className="pl-3 pr-2 min-w-0">{renderPortfolioCell(asset)}</div>
                    <div className="px-2"><span className="text-[12px] text-gray-600">{asset.sector || '—'}</span></div>
                    {hasAnyMarketCap && (
                      <div className="px-2 text-right"><span className="text-[12px] text-gray-600">{formatMarketCap(asset.market_cap)}</span></div>
                    )}
                    <div className="flex justify-end">
                      <span className="text-[10px] text-green-600 bg-green-100 px-2 py-0.5 rounded-full">Covered</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* ── Grouped view ───────────────────────────────── */
              <div>
                {(() => {
                  const grouped = new Map<string, typeof filteredGapsData>()
                  filteredGapsData.forEach((asset: any) => {
                    const key = asset[gapsGrouping!] || `Unknown ${gapsGrouping!.charAt(0).toUpperCase() + gapsGrouping!.slice(1)}`
                    if (!grouped.has(key)) grouped.set(key, [])
                    grouped.get(key)!.push(asset)
                  })
                  const sortedGroups = Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]))
                  const grpHasMcap = filteredGapsData.some((a: any) => a.market_cap != null && a.market_cap > 0)

                  return sortedGroups.map(([groupName, groupAssets]) => {
                    const isCollapsed = collapsedGapsGroups.has(groupName)
                    return (
                      <div key={groupName} className="border-b border-gray-200 last:border-b-0">
                        <button
                          onClick={() => {
                            setCollapsedGapsGroups(prev => {
                              const next = new Set(prev)
                              if (next.has(groupName)) next.delete(groupName)
                              else next.add(groupName)
                              return next
                            })
                          }}
                          className="w-full px-4 py-2 bg-gray-50 hover:bg-gray-100 flex items-center gap-2 text-left border-b border-gray-100"
                        >
                          {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-gray-400" /> : <ChevronDown className="h-3.5 w-3.5 text-gray-400" />}
                          <span className="text-[11px] font-semibold text-gray-700 uppercase tracking-wider">{groupName}</span>
                          <span className="text-[10px] text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full font-medium">{groupAssets.length}</span>
                        </button>
                        {!isCollapsed && (
                          <div className="divide-y divide-gray-100">
                            {groupAssets.map((asset: any) => (
                              <div key={asset.id} className="px-4 py-1.5 hover:bg-gray-50"
                                style={gridStyle({ checkbox: hasAnyCoverageAdminRights, mcap: grpHasMcap })}
                              >
                                {hasAnyCoverageAdminRights && (
                                  <div className="flex items-center">
                                    <input
                                      type="checkbox"
                                      checked={selectedGapAssets.has(asset.id)}
                                      onChange={() => toggleGapSelect(asset.id)}
                                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 h-3.5 w-3.5"
                                    />
                                  </div>
                                )}
                                <div className="min-w-0 px-2">
                                  <p className="text-[12px] font-semibold text-gray-900">{asset.symbol}</p>
                                  <p className="text-[11px] text-gray-500 truncate">{asset.company_name}</p>
                                </div>
                                <div>
                                  {(() => { const tier = getAssetTier(asset); return (
                                    <span className={clsx('inline-flex px-1.5 py-0.5 text-[9px] font-bold rounded border whitespace-nowrap', tier.cls)}>{tier.label}</span>
                                  ) })()}
                                </div>
                                <div className="pl-3 pr-2 min-w-0">{renderPortfolioCell(asset)}</div>
                                <div className="px-2">
                                  <span className="text-[12px] text-gray-600">
                                    {gapsGrouping === 'sector' ? (asset.industry || '—') : (asset.sector || '—')}
                                  </span>
                                </div>
                                {grpHasMcap && (
                                  <div className="px-2 text-right"><span className="text-[12px] text-gray-600">{formatMarketCap(asset.market_cap)}</span></div>
                                )}
                                <div className="flex justify-end">
                                  {hasAnyCoverageAdminRights && (
                                    <button
                                      onClick={() => addAsset(asset)}
                                      className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-primary-600 hover:text-white hover:bg-primary-600 border border-primary-200 hover:border-primary-600 rounded-md transition-colors"
                                    >
                                      <span className="text-[10px]">+</span> Assign
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })
                })()}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Bulk Assign Modal ──────────────────────────────────── */}
      {bulkAssignOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/30" onClick={() => setBulkAssignOpen(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setBulkAssignOpen(false)}>
            <div
              className="bg-white rounded-xl shadow-2xl w-full max-w-md border border-gray-200"
              onClick={e => e.stopPropagation()}
            >
              {/* Modal header */}
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200">
                <h3 className="text-sm font-semibold text-gray-900">Assign Coverage</h3>
                <button onClick={() => setBulkAssignOpen(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Modal body */}
              <div className="px-5 py-4 space-y-4">
                {/* 1. Selected Assets */}
                <div>
                  <label className="block text-[11px] font-medium text-gray-700 mb-1">
                    Selected Assets{selectedGapAssets.size > 1 ? ` (${selectedGapAssets.size})` : ''}
                  </label>
                  <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                    {(() => {
                      const PREVIEW_LIMIT = 3
                      const assets = selectedAssetObjects
                      const showAll = bulkAssetsExpanded || assets.length <= PREVIEW_LIMIT
                      const visible = showAll ? assets : assets.slice(0, PREVIEW_LIMIT)
                      return (
                        <>
                          {visible.map((a: any) => (
                            <div key={a.id} className="px-3 py-1.5">
                              <div className="flex items-baseline gap-1.5">
                                <span className="text-[12px] font-semibold text-gray-900">{a.symbol}</span>
                                <span className="text-[11px] text-gray-500 truncate">{a.company_name}</span>
                              </div>
                              {a.sector && <p className="text-[10px] text-gray-400">{a.sector}</p>}
                            </div>
                          ))}
                          {!showAll && (
                            <button
                              type="button"
                              onClick={() => setBulkAssetsExpanded(true)}
                              className="w-full px-3 py-1.5 text-[11px] text-primary-600 hover:bg-primary-50 transition-colors text-left font-medium"
                            >
                              +{assets.length - PREVIEW_LIMIT} more
                            </button>
                          )}
                          {bulkAssetsExpanded && assets.length > PREVIEW_LIMIT && (
                            <button
                              type="button"
                              onClick={() => setBulkAssetsExpanded(false)}
                              className="w-full px-3 py-1 text-[10px] text-gray-500 hover:bg-gray-50 transition-colors text-left"
                            >
                              Show less
                            </button>
                          )}
                        </>
                      )
                    })()}
                  </div>
                </div>

                {/* 2. Analyst dropdown */}
                <div className="relative">
                  <label className="block text-[11px] font-medium text-gray-700 mb-1">Analyst</label>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                    <input
                      type="text"
                      value={bulkAnalystSearch}
                      onChange={e => { setBulkAnalystSearch(e.target.value); setBulkAnalystDropdownOpen(true) }}
                      onFocus={() => setBulkAnalystDropdownOpen(true)}
                      placeholder="Search or select analyst"
                      className="w-full pl-8 pr-3 py-1.5 text-[12px] border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  {bulkAnalystDropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setBulkAnalystDropdownOpen(false)} />
                      <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {(() => {
                          const q = bulkAnalystSearch.toLowerCase()
                          const filtered = (users || []).filter(u => {
                            const name = u.first_name && u.last_name ? `${u.first_name} ${u.last_name}` : u.email?.split('@')[0] || ''
                            return name.toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q)
                          })
                          if (filtered.length === 0) return <div className="px-3 py-2 text-[11px] text-gray-500">No analysts found</div>
                          return filtered.map(u => {
                            const name = u.first_name && u.last_name ? `${u.first_name} ${u.last_name}` : u.email?.split('@')[0] || 'Unknown'
                            const assetCount = analystWorkload.get(u.id) || 0
                            return (
                              <button
                                key={u.id}
                                type="button"
                                onClick={() => {
                                  setBulkAnalystId(u.id)
                                  setBulkAnalystSearch(name)
                                  setBulkAnalystDropdownOpen(false)
                                }}
                                className={clsx(
                                  'w-full px-3 py-1.5 text-left hover:bg-gray-50 transition-colors flex items-center justify-between',
                                  bulkAnalystId === u.id && 'bg-primary-50',
                                )}
                              >
                                <div>
                                  <div className="text-[12px] font-medium text-gray-900">{name}</div>
                                  {u.email && <div className="text-[10px] text-gray-500">{u.email}</div>}
                                </div>
                                <span className="text-[10px] text-gray-400 whitespace-nowrap ml-2">{assetCount} asset{assetCount !== 1 ? 's' : ''}</span>
                              </button>
                            )
                          })
                        })()}
                      </div>
                    </>
                  )}
                </div>

                {/* 3. Coverage Group dropdown */}
                <div className="relative">
                  <label className="block text-[11px] font-medium text-gray-700 mb-1">Coverage Group</label>
                  <button
                    type="button"
                    onClick={() => setBulkCoversForOpen(prev => !prev)}
                    className={clsx(
                      'w-full flex items-center justify-between px-3 py-1.5 border rounded-lg text-[12px] text-left',
                      'focus:outline-none focus:ring-2 focus:ring-primary-500',
                      bulkCoversForOpen ? 'border-primary-400 ring-2 ring-primary-500/20' : 'border-gray-300',
                    )}
                  >
                    <span className={bulkGroupId ? 'text-gray-900' : 'text-gray-400'}>
                      {bulkGroupLabel || 'Select group'}
                    </span>
                    <ChevronDown size={13} className={clsx('text-gray-400 transition-transform', bulkCoversForOpen && 'rotate-180')} />
                  </button>

                  {bulkCoversForOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setBulkCoversForOpen(false)} />
                      <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {/* Firm-wide */}
                        <button
                          type="button"
                          onClick={() => { setBulkGroupId('__firm__'); setBulkCoversForOpen(false) }}
                          className={clsx(
                            'w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left hover:bg-gray-50 transition-colors',
                            bulkGroupId === '__firm__' && 'bg-primary-50 text-primary-700 font-medium',
                          )}
                        >
                          Firm-wide
                          {bulkGroupId === '__firm__' && <Check size={12} className="ml-auto text-primary-500" />}
                        </button>
                        <div className="border-t border-gray-100" />

                        {NODE_TYPE_SECTIONS.map(section => {
                          const nodes = (allOrgChartNodes?.nodes || []).filter((n: any) => n.node_type === section.type)
                          if (nodes.length === 0) return null
                          const isExpanded = bulkCoversForExpanded.has(section.type)
                          return (
                            <div key={section.type}>
                              <button
                                type="button"
                                onClick={() => setBulkCoversForExpanded(prev => {
                                  const next = new Set(prev)
                                  if (next.has(section.type)) next.delete(section.type)
                                  else next.add(section.type)
                                  return next
                                })}
                                className="w-full flex items-center gap-1.5 px-3 py-1 text-[10px] font-medium text-gray-500 hover:bg-gray-50 transition-colors"
                              >
                                {isExpanded
                                  ? <ChevronDown size={11} className="text-gray-400" />
                                  : <ChevronRight size={11} className="text-gray-400" />}
                                {section.label}
                                <span className="ml-auto text-[9px] text-gray-400">{nodes.length}</span>
                              </button>
                              {isExpanded && nodes.map((n: any) => (
                                <button
                                  key={n.id}
                                  type="button"
                                  onClick={() => { setBulkGroupId(n.id); setBulkCoversForOpen(false) }}
                                  className={clsx(
                                    'w-full flex items-center gap-2 pl-7 pr-3 py-1 text-[12px] text-left hover:bg-gray-50 transition-colors',
                                    bulkGroupId === n.id && 'bg-primary-50 text-primary-700 font-medium',
                                  )}
                                >
                                  {n.displayName || n.name}
                                  {bulkGroupId === n.id && <Check size={12} className="ml-auto text-primary-500 shrink-0" />}
                                </button>
                              ))}
                            </div>
                          )
                        })}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Modal footer */}
              <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200">
                <button
                  onClick={() => setBulkAssignOpen(false)}
                  className="px-3 py-1.5 text-[12px] font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleBulkAssign}
                  disabled={!bulkAnalystId || !bulkGroupId || bulkAssigning}
                  className={clsx(
                    'px-4 py-1.5 text-[12px] font-medium text-white rounded-lg transition-colors',
                    !bulkAnalystId || !bulkGroupId || bulkAssigning
                      ? 'bg-primary-300 cursor-not-allowed'
                      : 'bg-primary-600 hover:bg-primary-700',
                  )}
                >
                  {bulkAssigning ? 'Assigning…' : selectedGapAssets.size > 1 ? `Assign Coverage (${selectedGapAssets.size})` : 'Assign Coverage'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </Card>
  )
}
