import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { TrendingUp, ChevronUp, ChevronDown, ArrowRight } from 'lucide-react'
import { useMarketData } from '../../../hooks/useMarketData'
import type { PortfolioHolding, NavigateHandler } from './portfolio-tab-types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtPnl(val: number): string {
  const abs = Math.abs(val)
  const sign = val >= 0 ? '+' : '-'
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 10_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`
  return `${sign}$${abs.toFixed(0)}`
}

function fmtDollar(val: number, decimals = 0): string {
  return '$' + val.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function freshnessInfo(daysAgo: number | null) {
  if (daysAgo === null) return { label: '—', cls: 'text-gray-400', dotCls: 'bg-gray-300' }
  if (daysAgo <= 7)  return { label: `${daysAgo}d`, cls: 'text-gray-700', dotCls: 'bg-emerald-500' }
  if (daysAgo <= 30) return { label: `${daysAgo}d`, cls: 'text-gray-500', dotCls: 'bg-gray-400' }
  if (daysAgo <= 90) return { label: `${daysAgo}d`, cls: 'text-amber-600', dotCls: 'bg-amber-400' }
  return { label: `${daysAgo}d`, cls: 'text-red-600', dotCls: 'bg-red-500' }
}

function clr(v: number) { return v > 0 ? 'text-green-600' : v < 0 ? 'text-red-600' : 'text-gray-500' }

// ---------------------------------------------------------------------------
// View presets & grouping
// ---------------------------------------------------------------------------

type ViewPreset = 'all' | 'contributors' | 'detractors' | 'largest' | 'big-movers' | 'gainers-losers' | 'stale'
type GroupBy = 'none' | 'sector' | 'industry' | 'sector-industry'

const VIEW_PRESETS: { key: ViewPreset; label: string }[] = [
  { key: 'all',             label: 'All' },
  { key: 'contributors',    label: 'Contributors' },
  { key: 'detractors',      label: 'Detractors' },
  { key: 'largest',         label: 'Largest' },
  { key: 'big-movers',      label: 'Big Movers' },
  { key: 'gainers-losers',  label: 'Gainers / Losers' },
  { key: 'stale',           label: 'Stale Research' },
]

function rowGroupKey(row: EnrichedRow, groupBy: GroupBy): string | null {
  if (groupBy === 'sector') return row.sector
  if (groupBy === 'industry') return row.industry
  if (groupBy === 'sector-industry') return `${row.sector} \u00b7 ${row.industry}`
  return null
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

type ColKey = 'asset' | 'weight' | 'dailyPnl' | 'price' | 'unrealizedPnl' | 'returnPct' | 'shares' | 'avgCost' | 'sector' | 'updated'

const COLUMNS: { key: ColKey; label: string; align: 'left' | 'right'; sortKey?: string; secondary?: boolean }[] = [
  { key: 'asset',         label: 'Asset',           align: 'left',  sortKey: 'symbol' },
  { key: 'weight',        label: 'Wt %',            align: 'right', sortKey: 'weight' },
  { key: 'dailyPnl',      label: 'Today P&L',        align: 'right' },
  { key: 'price',         label: 'Price',            align: 'right' },
  { key: 'unrealizedPnl', label: 'Unreal P&L',      align: 'right', sortKey: 'gainLoss' },
  { key: 'returnPct',     label: 'Return',           align: 'right', sortKey: 'returnPercent' },
  { key: 'shares',        label: 'Shares',           align: 'right', sortKey: 'shares', secondary: true },
  { key: 'avgCost',       label: 'Avg Cost',         align: 'right', sortKey: 'avgCost', secondary: true },
  { key: 'sector',        label: 'Sector',           align: 'left',  sortKey: 'sector', secondary: true },
  { key: 'updated',       label: 'Updated',          align: 'right', sortKey: 'updated', secondary: true },
]

// Split-view navigable fields (maps to ColKey for inspector reuse)
const SPLIT_COL_KEYS: ColKey[] = ['asset', 'price', 'dailyPnl', 'weight']

// ---------------------------------------------------------------------------
// Enriched row
// ---------------------------------------------------------------------------

interface EnrichedRow {
  holding: PortfolioHolding
  symbol: string
  companyName: string
  sector: string
  industry: string
  shares: number
  price: number
  avgCost: number
  costBasis: number
  marketValue: number
  gainLoss: number
  returnPct: number
  weightPct: number
  dayChange: number
  dayChangePct: number
  dailyPnl: number
  daysAgo: number | null
  processStage: string | null
  priority: string | null
}

// ---------------------------------------------------------------------------
// Sort header
// ---------------------------------------------------------------------------

function SortHeader({ label, column, sortColumn, sortDirection, onSort, align = 'left' }: {
  label: string; column: string; sortColumn: string; sortDirection: 'asc' | 'desc'
  onSort: (col: string) => void; align?: 'left' | 'right'
}) {
  const isActive = sortColumn === column
  return (
    <th
      className={`px-3 py-2 text-[10px] font-semibold uppercase tracking-wider cursor-pointer select-none group transition-colors hover:bg-gray-100/80 ${
        isActive ? 'text-gray-700' : 'text-gray-500'
      }`}
      style={{ textAlign: align }}
      onClick={() => onSort(column)}
    >
      <div className={`flex items-center gap-0.5 ${align === 'right' ? 'justify-end' : ''}`}>
        {label}
        {isActive ? (
          sortDirection === 'asc'
            ? <ChevronUp className="h-3 w-3 text-primary-600" />
            : <ChevronDown className="h-3 w-3 text-primary-600" />
        ) : (
          <ChevronUp className="h-2.5 w-2.5 text-gray-300 group-hover:text-gray-400 transition-colors" />
        )}
      </div>
    </th>
  )
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PositionsTabProps {
  portfolioId: string
  holdings: PortfolioHolding[] | undefined
  sortedHoldings: PortfolioHolding[]
  totalValue: number
  sortColumn: string
  sortDirection: 'asc' | 'desc'
  onSort: (column: string) => void
  onNavigate?: NavigateHandler
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PositionsTab({
  portfolioId,
  holdings,
  sortedHoldings,
  totalValue,
  sortColumn,
  sortDirection,
  onSort,
  onNavigate,
}: PositionsTabProps) {
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
  const [selectedCol, setSelectedCol] = useState(0)
  const [expandedAssetId, setExpandedAssetId] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<ViewPreset>('all')
  const [groupBy, setGroupBy] = useState<GroupBy>('none')
  const containerRef = useRef<HTMLDivElement>(null)

  const isSplitView = activeView === 'gainers-losers'

  // ── Market data ────────────────────────────────────────────
  const symbols = useMemo(
    () => (sortedHoldings || []).map(h => h.assets?.symbol).filter(Boolean) as string[],
    [sortedHoldings],
  )
  const { quotes } = useMarketData(symbols, { enabled: symbols.length > 0 })
  const hasQuotes = quotes.size > 0

  // ── Enriched rows ─────────────────────────────────────────
  const enrichedRows = useMemo<EnrichedRow[]>(() => {
    if (!sortedHoldings.length) return []
    return sortedHoldings.map(h => {
      const symbol = h.assets?.symbol || '?'
      const shares = parseFloat(h.shares) || 0
      const price = parseFloat(h.price) || 0
      const avgCost = parseFloat(h.cost) || 0
      const costBasis = shares * avgCost
      const marketValue = shares * price
      const gainLoss = marketValue - costBasis
      const returnPct = costBasis > 0 ? (gainLoss / costBasis) * 100 : 0
      const weightPct = totalValue > 0 ? (marketValue / totalValue) * 100 : 0
      const q = quotes.get(symbol)
      const dayChange = q?.change ?? 0
      const dayChangePct = q?.changePercent ?? 0
      const dailyPnl = shares * dayChange
      let daysAgo: number | null = null
      if (h.assets?.updated_at) {
        daysAgo = Math.floor((Date.now() - new Date(h.assets.updated_at).getTime()) / 86400000)
      }
      return {
        holding: h, symbol,
        companyName: h.assets?.company_name || '',
        sector: h.assets?.sector || 'Unknown',
        industry: h.assets?.industry || 'Unknown',
        shares, price, avgCost, costBasis, marketValue,
        gainLoss, returnPct, weightPct,
        dayChange, dayChangePct, dailyPnl, daysAgo,
        processStage: h.assets?.process_stage || null,
        priority: h.assets?.priority || null,
      }
    })
  }, [sortedHoldings, quotes, totalValue])

  // ── Session summary ────────────────────────────────────────
  const totalDailyPnl = useMemo(() => enrichedRows.reduce((s, r) => s + r.dailyPnl, 0), [enrichedRows])
  const totalDailyReturnPct = useMemo(() => {
    const prevNav = totalValue - totalDailyPnl
    return prevNav > 0 ? (totalDailyPnl / prevNav) * 100 : 0
  }, [totalValue, totalDailyPnl])

  // ── Display rows (filtered/sorted by active view, then grouped) ──
  const displayRows = useMemo<EnrichedRow[]>(() => {
    let rows: EnrichedRow[]
    switch (activeView) {
      case 'contributors':
        rows = [...enrichedRows].filter(r => r.dailyPnl > 0).sort((a, b) => b.dailyPnl - a.dailyPnl)
        break
      case 'detractors':
        rows = [...enrichedRows].filter(r => r.dailyPnl < 0).sort((a, b) => a.dailyPnl - b.dailyPnl)
        break
      case 'largest':
        rows = [...enrichedRows].sort((a, b) => b.weightPct - a.weightPct)
        break
      case 'big-movers':
        rows = [...enrichedRows].sort((a, b) => Math.abs(b.dailyPnl) - Math.abs(a.dailyPnl))
        break
      case 'gainers-losers':
        // Split view handles rendering; flat list ordered gainers-first for keyboard nav
        rows = [...enrichedRows].sort((a, b) => b.dayChangePct - a.dayChangePct)
        break
      case 'stale':
        rows = [...enrichedRows]
          .filter(r => r.daysAgo !== null && r.daysAgo > 30)
          .sort((a, b) => (b.daysAgo || 0) - (a.daysAgo || 0))
        break
      default:
        rows = enrichedRows
    }

    // Apply group ordering (not for split view — it has its own layout)
    if (!isSplitView && groupBy !== 'none' && rows.length > 0) {
      const groups = new Map<string, EnrichedRow[]>()
      for (const row of rows) {
        const key = rowGroupKey(row, groupBy)!
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(row)
      }
      rows = [...groups.entries()]
        .sort((a, b) => {
          const wtA = a[1].reduce((s, r) => s + r.weightPct, 0)
          const wtB = b[1].reduce((s, r) => s + r.weightPct, 0)
          return wtB - wtA
        })
        .flatMap(([, r]) => r)
    }

    return rows
  }, [enrichedRows, activeView, groupBy, isSplitView])

  // ── Group metadata for section headers ──────────────────────
  interface GroupMeta {
    count: number; weight: number; dailyPnl: number
    marketValue: number; costBasis: number; unrealizedPnl: number
    shares: number; returnPct: number; dailyReturnPct: number
  }
  const groupMeta = useMemo(() => {
    if (isSplitView || groupBy === 'none') return new Map<string, GroupMeta>()
    const meta = new Map<string, GroupMeta>()
    for (const row of displayRows) {
      const key = rowGroupKey(row, groupBy)
      if (key === null) continue
      const g = meta.get(key) || { count: 0, weight: 0, dailyPnl: 0, marketValue: 0, costBasis: 0, unrealizedPnl: 0, shares: 0, returnPct: 0, dailyReturnPct: 0 }
      g.count++
      g.weight += row.weightPct
      g.dailyPnl += row.dailyPnl
      g.marketValue += row.marketValue
      g.costBasis += row.costBasis
      g.unrealizedPnl += row.gainLoss
      g.shares += row.shares
      meta.set(key, g)
    }
    // Compute proper group-level returns
    for (const g of meta.values()) {
      g.returnPct = g.costBasis > 0 ? (g.unrealizedPnl / g.costBasis) * 100 : 0
      const prevNav = g.marketValue - g.dailyPnl
      g.dailyReturnPct = prevNav > 0 ? (g.dailyPnl / prevNav) * 100 : 0
    }
    return meta
  }, [displayRows, groupBy, isSplitView])

  // ── Selection ──────────────────────────────────────────────
  const selectedRowIdx = useMemo(() => {
    if (!selectedAssetId) return null
    const idx = displayRows.findIndex(r => r.holding.asset_id === selectedAssetId)
    return idx >= 0 ? idx : null
  }, [selectedAssetId, displayRows])

  const selectedRow = selectedRowIdx !== null ? displayRows[selectedRowIdx] : null

  useEffect(() => {
    if (selectedAssetId && selectedRowIdx === null) setSelectedAssetId(null)
  }, [selectedAssetId, selectedRowIdx])

  useEffect(() => {
    if (expandedAssetId && selectedAssetId !== expandedAssetId) setExpandedAssetId(null)
  }, [selectedAssetId, expandedAssetId])

  // ── Inspector context (full set) ──────────────────────────
  const maxWeight = useMemo(() => {
    if (!enrichedRows.length) return 0
    return Math.max(...enrichedRows.map(r => r.weightPct))
  }, [enrichedRows])

  const inspectorCtx = useMemo(() => {
    if (!selectedRow) return null
    const sorted = [...enrichedRows].sort((a, b) => b.weightPct - a.weightPct)
    const rank = sorted.findIndex(r => r.symbol === selectedRow.symbol) + 1
    const top3Wt = sorted.slice(0, 3).reduce((s, r) => s + r.weightPct, 0)
    const contributionPct = totalDailyPnl !== 0 ? (selectedRow.dailyPnl / totalDailyPnl) * 100 : 0
    const sectorPeers = enrichedRows.filter(r => r.sector === selectedRow.sector)
    const sectorWt = sectorPeers.reduce((s, r) => s + r.weightPct, 0)
    const byAbsDailyPnl = [...enrichedRows].sort((a, b) => Math.abs(b.dailyPnl) - Math.abs(a.dailyPnl))
    const dailyImpactRank = byAbsDailyPnl.findIndex(r => r.symbol === selectedRow.symbol) + 1
    return { rank, top3Wt, totalDailyPnl, contributionPct, sectorPeers, sectorWt, totalPositions: enrichedRows.length, dailyImpactRank }
  }, [selectedRow, enrichedRows, totalDailyPnl])

  // ── Interaction ────────────────────────────────────────────
  const handleCellClick = useCallback((assetId: string, colIdx: number) => {
    if (selectedAssetId === assetId && selectedCol === colIdx) {
      setSelectedAssetId(null)
    } else {
      setSelectedAssetId(assetId)
      setSelectedCol(colIdx)
    }
    containerRef.current?.focus()
  }, [selectedAssetId, selectedCol])

  const navigateToAsset = useCallback((h: PortfolioHolding) => {
    if (onNavigate && h.assets) {
      onNavigate({ id: h.assets.id || h.asset_id, title: h.assets.symbol || 'Unknown', type: 'asset', data: h.assets })
    }
  }, [onNavigate])

  const handleSort = useCallback((col: string) => {
    setActiveView('all')
    onSort(col)
  }, [onSort])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!displayRows.length) return
    const maxRow = displayRows.length - 1
    const maxCol = isSplitView ? SPLIT_COL_KEYS.length - 1 : COLUMNS.length - 1
    switch (e.key) {
      case 'ArrowDown': case 'j':
        e.preventDefault()
        setSelectedAssetId(displayRows[selectedRowIdx === null ? 0 : Math.min(selectedRowIdx + 1, maxRow)]?.holding.asset_id || null)
        break
      case 'ArrowUp': case 'k':
        e.preventDefault()
        setSelectedAssetId(displayRows[selectedRowIdx === null ? 0 : Math.max(selectedRowIdx - 1, 0)]?.holding.asset_id || null)
        break
      case 'ArrowRight': case 'l':
        e.preventDefault(); setSelectedCol(c => Math.min(c + 1, maxCol)); break
      case 'ArrowLeft': case 'h':
        e.preventDefault(); setSelectedCol(c => Math.max(c - 1, 0)); break
      case 'Escape':
        expandedAssetId ? setExpandedAssetId(null) : setSelectedAssetId(null); break
      case 'Enter':
        e.preventDefault()
        if (selectedAssetId) setExpandedAssetId(prev => prev === selectedAssetId ? null : selectedAssetId)
        break
    }
  }, [displayRows, selectedRowIdx, selectedAssetId, expandedAssetId, isSplitView])

  useEffect(() => {
    if (selectedAssetId) {
      containerRef.current?.querySelector(`[data-asset-id="${selectedAssetId}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [selectedAssetId])

  // ── Empty state ────────────────────────────────────────────
  if (!holdings || holdings.length === 0) {
    return (
      <div className="text-center py-12">
        <TrendingUp className="h-12 w-12 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">No positions in this portfolio</h3>
        <p className="text-gray-500">Add holdings to track your portfolio performance.</p>
      </div>
    )
  }

  const cellCls = (rowIdx: number, colIdx: number) => {
    const isCell = selectedRowIdx === rowIdx && selectedCol === colIdx
    return isCell ? 'outline outline-2 -outline-offset-2 outline-primary-500/70 bg-primary-50/60' : ''
  }

  // ================================================================
  // RENDER
  // ================================================================
  return (
    <div ref={containerRef} tabIndex={0} onKeyDown={handleKeyDown} className="outline-none flex flex-col">

      {/* ─── VIEW BAR ─────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100">
        <div className="flex items-center gap-0.5">
          {VIEW_PRESETS.map(v => (
            <button
              key={v.key}
              onClick={() => setActiveView(v.key)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                activeView === v.key ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {/* Group by */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-gray-400">Group</span>
            <select
              value={groupBy}
              onChange={e => setGroupBy(e.target.value as GroupBy)}
              className="text-[10px] font-medium text-gray-600 bg-transparent border border-gray-200 rounded px-1.5 py-0.5 cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary-300 appearance-none pr-4"
              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 8 8'%3E%3Cpath fill='%239ca3af' d='M2 3l2 2 2-2z'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 4px center' }}
            >
              <option value="none">None</option>
              <option value="sector">Sector</option>
              <option value="industry">Industry</option>
              <option value="sector-industry">Sector → Industry</option>
            </select>
          </div>

          {/* Session P&L */}
          {hasQuotes && (
            <div className="flex items-center gap-1.5 pl-3 border-l border-gray-200">
              <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Today</span>
              <span className={`text-[11px] font-semibold tabular-nums ${clr(totalDailyPnl)}`}>
                {fmtPnl(totalDailyPnl)}
              </span>
              <span className={`text-[10px] tabular-nums ${clr(totalDailyReturnPct)}`}>
                {totalDailyReturnPct >= 0 ? '+' : ''}{totalDailyReturnPct.toFixed(2)}%
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ─── SPLIT VIEW: GAINERS / LOSERS ─────────────────── */}
      {isSplitView ? (
        <GainersLosersView
          rows={displayRows}
          hasQuotes={hasQuotes}
          selectedAssetId={selectedAssetId}
          selectedCol={Math.min(selectedCol, SPLIT_COL_KEYS.length - 1)}
          expandedAssetId={expandedAssetId}
          onCellClick={handleCellClick}
          inspectorCtx={inspectorCtx}
          quotes={quotes}
          onNavigate={onNavigate}
        />
      ) : (
      /* ─── TABLE ─────────────────────────────────────────── */
      <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50/80">
              <tr>
                {COLUMNS.map((col) =>
                  col.sortKey ? (
                    <SortHeader
                      key={col.key}
                      label={col.label}
                      column={col.sortKey}
                      sortColumn={activeView === 'all' ? sortColumn : ''}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                      align={col.align}
                    />
                  ) : (
                    <th key={col.key} className="px-3 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider" style={{ textAlign: col.align }}>
                      {col.label}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {displayRows.length > 0 ? displayRows.map((row, ri) => {
                const isSelected = selectedRowIdx === ri
                const isExpanded = expandedAssetId === row.holding.asset_id
                const fresh = freshnessInfo(row.daysAgo)
                const q = quotes.get(row.symbol)

                // Group header insertion
                const gKey = rowGroupKey(row, groupBy)
                const prevGKey = ri > 0 ? rowGroupKey(displayRows[ri - 1], groupBy) : null
                const showGroupHeader = gKey !== null && (ri === 0 || gKey !== prevGKey)
                const gMeta = showGroupHeader ? groupMeta.get(gKey!) : null

                return (
                  <React.Fragment key={row.holding.id}>
                    {showGroupHeader && gMeta && (
                      <tr className="bg-gray-100/70 border-t border-gray-200">
                        {/* Asset: group name + count */}
                        <td className="pl-3 pr-2 py-1.5 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-bold text-gray-600 uppercase tracking-wide">{gKey}</span>
                            <span className="text-[9px] text-gray-400 tabular-nums">{gMeta.count}</span>
                          </div>
                        </td>
                        {/* Weight % */}
                        <td className="px-3 py-1.5 whitespace-nowrap text-right">
                          <span className="text-[11px] font-semibold text-gray-700 tabular-nums">{gMeta.weight.toFixed(1)}%</span>
                        </td>
                        {/* Today P&L */}
                        <td className="px-3 py-1.5 whitespace-nowrap text-right">
                          {hasQuotes ? (
                            <div className="leading-tight">
                              <span className={`text-[11px] font-semibold tabular-nums ${clr(gMeta.dailyPnl)}`}>{fmtPnl(gMeta.dailyPnl)}</span>
                              <span className={`text-[9px] tabular-nums ml-0.5 ${clr(gMeta.dailyReturnPct)}`}>
                                {gMeta.dailyReturnPct >= 0 ? '+' : ''}{gMeta.dailyReturnPct.toFixed(1)}%
                              </span>
                            </div>
                          ) : (
                            <span className="text-[11px] text-gray-300">&mdash;</span>
                          )}
                        </td>
                        {/* Price: n/a */}
                        <td className="px-3 py-1.5" />
                        {/* Unrealized P&L */}
                        <td className="px-3 py-1.5 whitespace-nowrap text-right">
                          <span className={`text-[11px] font-semibold tabular-nums ${clr(gMeta.unrealizedPnl)}`}>
                            {gMeta.unrealizedPnl >= 0 ? '+' : '-'}${Math.abs(gMeta.unrealizedPnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </span>
                        </td>
                        {/* Return % (proper group return) */}
                        <td className="px-3 py-1.5 whitespace-nowrap text-right">
                          <span className={`text-[11px] font-semibold tabular-nums ${clr(gMeta.returnPct)}`}>
                            {gMeta.returnPct >= 0 ? '+' : ''}{gMeta.returnPct.toFixed(1)}%
                          </span>
                        </td>
                        {/* Shares */}
                        <td className="px-3 py-1.5 whitespace-nowrap text-right">
                          <span className="text-[11px] text-gray-500 tabular-nums">{gMeta.shares.toLocaleString()}</span>
                        </td>
                        {/* Avg Cost: n/a */}
                        <td className="px-3 py-1.5" />
                        {/* Sector: n/a */}
                        <td className="px-3 py-1.5" />
                        {/* Updated: n/a */}
                        <td className="px-3 py-1.5" />
                      </tr>
                    )}
                    <tr
                      data-asset-id={row.holding.asset_id}
                      className={`transition-colors cursor-pointer ${isSelected ? 'bg-primary-50/40' : 'hover:bg-gray-50/60'}`}
                    >
                      {/* Asset */}
                      <td className={`pl-3 pr-2 py-2 whitespace-nowrap ${cellCls(ri, 0)}`} onClick={() => handleCellClick(row.holding.asset_id, 0)}>
                        <div className="flex items-center gap-1.5">
                          <div className={`w-1 h-1 rounded-full shrink-0 ${isSelected ? 'bg-primary-500' : 'bg-transparent'}`} />
                          <div className="min-w-0">
                            <div className="text-[13px] font-bold text-gray-900 tracking-wide leading-tight">{row.symbol}</div>
                            <div className="text-[10px] text-gray-400 truncate max-w-[140px] leading-tight">{row.companyName}</div>
                          </div>
                        </div>
                      </td>
                      {/* Weight % */}
                      <td className={`px-3 py-2 whitespace-nowrap ${cellCls(ri, 1)}`} onClick={() => handleCellClick(row.holding.asset_id, 1)}>
                        <div className="flex items-center justify-end">
                          <div className="relative h-4 w-16">
                            <div className="absolute inset-y-0 left-0 bg-primary-500/[0.12] rounded-sm" style={{ width: `${maxWeight > 0 ? (row.weightPct / maxWeight) * 100 : 0}%` }} />
                            <span className="absolute inset-0 flex items-center justify-end text-[13px] font-medium text-gray-900 tabular-nums">{row.weightPct.toFixed(1)}%</span>
                          </div>
                        </div>
                      </td>
                      {/* Daily P&L */}
                      <td className={`px-3 py-2 whitespace-nowrap text-right ${cellCls(ri, 2)}`} onClick={() => handleCellClick(row.holding.asset_id, 2)}>
                        {q ? (
                          <div className="leading-tight">
                            <span className={`text-[13px] font-medium tabular-nums ${clr(row.dailyPnl)}`}>{fmtPnl(row.dailyPnl)}</span>
                            <span className={`text-[10px] tabular-nums ml-0.5 ${row.dayChangePct >= 0 ? 'text-green-500/60' : 'text-red-500/60'}`}>
                              {row.dayChangePct >= 0 ? '+' : ''}{row.dayChangePct.toFixed(1)}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-[13px] text-gray-300">&mdash;</span>
                        )}
                      </td>
                      {/* Price */}
                      <td className={`px-3 py-2 whitespace-nowrap text-right ${cellCls(ri, 3)}`} onClick={() => handleCellClick(row.holding.asset_id, 3)}>
                        <span className="text-[13px] text-gray-900 tabular-nums">${(q?.price ?? row.price).toFixed(2)}</span>
                      </td>
                      {/* Unrealized P&L */}
                      <td className={`px-3 py-2 whitespace-nowrap text-right ${cellCls(ri, 4)}`} onClick={() => handleCellClick(row.holding.asset_id, 4)}>
                        <span className={`text-[13px] font-medium tabular-nums ${clr(row.gainLoss)}`}>
                          {row.gainLoss >= 0 ? '+' : '-'}${Math.abs(row.gainLoss).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </span>
                      </td>
                      {/* Return % */}
                      <td className={`px-3 py-2 whitespace-nowrap text-right ${cellCls(ri, 5)}`} onClick={() => handleCellClick(row.holding.asset_id, 5)}>
                        <span className={`text-[13px] font-medium tabular-nums ${clr(row.returnPct)}`}>
                          {row.returnPct >= 0 ? '+' : ''}{row.returnPct.toFixed(1)}%
                        </span>
                      </td>
                      {/* Shares */}
                      <td className={`px-3 py-2 whitespace-nowrap text-right ${cellCls(ri, 6)}`} onClick={() => handleCellClick(row.holding.asset_id, 6)}>
                        <span className="text-[13px] text-gray-500 tabular-nums">{row.shares.toLocaleString()}</span>
                      </td>
                      {/* Avg Cost */}
                      <td className={`px-3 py-2 whitespace-nowrap text-right ${cellCls(ri, 7)}`} onClick={() => handleCellClick(row.holding.asset_id, 7)}>
                        <span className="text-[13px] text-gray-500 tabular-nums">${row.avgCost.toFixed(2)}</span>
                      </td>
                      {/* Sector */}
                      <td className={`px-3 py-2 whitespace-nowrap ${cellCls(ri, 8)}`} onClick={() => handleCellClick(row.holding.asset_id, 8)}>
                        <span className="text-[12px] text-gray-400">{row.sector}</span>
                      </td>
                      {/* Updated */}
                      <td className={`px-3 py-2 whitespace-nowrap text-right ${cellCls(ri, 9)}`} onClick={() => handleCellClick(row.holding.asset_id, 9)}>
                        {row.daysAgo !== null ? (
                          <span className="inline-flex items-center gap-1 justify-end">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${fresh.dotCls}`} />
                            <span className={`text-[12px] tabular-nums ${fresh.cls}`}>{fresh.label}</span>
                          </span>
                        ) : (
                          <span className="text-[12px] text-gray-300">&mdash;</span>
                        )}
                      </td>
                    </tr>

                    {/* Expanded detail row */}
                    {isExpanded && inspectorCtx && (
                      <tr className="bg-gray-50/60">
                        <td colSpan={COLUMNS.length} className="px-4 py-2">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex items-baseline gap-2 min-w-0 flex-1">
                              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider shrink-0">
                                {COLUMNS[selectedCol].label}
                              </span>
                              <div className="min-w-0 flex-1">
                                {renderFieldDetail(COLUMNS[selectedCol].key, row, inspectorCtx, quotes.get(row.symbol))}
                              </div>
                            </div>
                            <button
                              onClick={() => navigateToAsset(row.holding)}
                              className="text-[11px] text-primary-600 hover:text-primary-700 font-medium flex items-center gap-0.5 shrink-0"
                            >
                              Open <ArrowRight className="w-3 h-3" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              }) : (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-6 text-center">
                    <p className="text-[11px] text-gray-400">
                      {(activeView === 'contributors' || activeView === 'detractors' || activeView === 'big-movers' || activeView === 'gainers-losers') && !hasQuotes
                        ? 'Loading market data...'
                        : activeView === 'contributors' ? 'No contributors today'
                        : activeView === 'detractors' ? 'No detractors today'
                        : activeView === 'big-movers' ? 'No movers today'
                        : activeView === 'gainers-losers' ? 'No market movement today'
                        : activeView === 'stale' ? 'No stale research — coverage is current'
                        : 'No positions'}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
      </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Gainers / Losers split view
// ---------------------------------------------------------------------------

function GainersLosersView({ rows, hasQuotes, selectedAssetId, selectedCol, expandedAssetId, onCellClick, inspectorCtx, quotes, onNavigate }: {
  rows: EnrichedRow[]
  hasQuotes: boolean
  selectedAssetId: string | null
  selectedCol: number
  expandedAssetId: string | null
  onCellClick: (assetId: string, colIdx: number) => void
  inspectorCtx: InspectorCtx | null
  quotes: Map<string, any>
  onNavigate?: NavigateHandler
}) {
  const gainers = useMemo(
    () => rows.filter(r => r.dailyPnl > 0),
    [rows],
  )
  const losers = useMemo(
    () => rows.filter(r => r.dailyPnl < 0),
    [rows],
  )
  const unchanged = useMemo(() => rows.filter(r => r.dailyPnl === 0).length, [rows])

  const gainersPnl = useMemo(() => gainers.reduce((s, r) => s + r.dailyPnl, 0), [gainers])
  const losersPnl = useMemo(() => losers.reduce((s, r) => s + r.dailyPnl, 0), [losers])

  if (!hasQuotes) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-[11px] text-gray-400">Loading market data...</p>
      </div>
    )
  }

  const renderPanel = (items: EnrichedRow[], variant: 'gainer' | 'loser') => {
    if (items.length === 0) {
      return <div className="px-2.5 py-6 text-center text-[10px] text-gray-400">No {variant === 'gainer' ? 'gainers' : 'losers'} today</div>
    }
    return (
      <div>
        {items.map(row => {
          const isSelected = selectedAssetId === row.holding.asset_id
          const isExpanded = expandedAssetId === row.holding.asset_id
          return (
            <React.Fragment key={row.holding.id}>
              <SplitRow
                row={row}
                variant={variant}
                isSelected={isSelected}
                selectedCol={selectedCol}
                onCellClick={onCellClick}
              />
              {isExpanded && isSelected && inspectorCtx && (
                <div className="bg-gray-50/60 px-2.5 py-1.5 border-b border-gray-100">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-baseline gap-2 min-w-0 flex-1">
                      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider shrink-0">
                        {SPLIT_COL_KEYS[selectedCol] === 'asset' ? 'Asset'
                          : SPLIT_COL_KEYS[selectedCol] === 'price' ? 'Price'
                          : SPLIT_COL_KEYS[selectedCol] === 'dailyPnl' ? 'Today P&L'
                          : 'Weight'}
                      </span>
                      <div className="min-w-0 flex-1">
                        {renderFieldDetail(SPLIT_COL_KEYS[selectedCol], row, inspectorCtx, quotes.get(row.symbol))}
                      </div>
                    </div>
                    {onNavigate && row.holding.assets && (
                      <button
                        onClick={() => onNavigate({ id: row.holding.assets!.id || row.holding.asset_id, title: row.holding.assets!.symbol || 'Unknown', type: 'asset', data: row.holding.assets })}
                        className="text-[11px] text-primary-600 hover:text-primary-700 font-medium flex items-center gap-0.5 shrink-0"
                      >
                        Open <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </React.Fragment>
          )
        })}
      </div>
    )
  }

  return (
    <div>
      <div className="grid grid-cols-2 divide-x divide-gray-200">
        {/* Gainers */}
        <div>
          <div className="flex items-center justify-between px-2.5 py-1.5 bg-emerald-50/50 border-b border-gray-200">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Gainers</span>
              <span className="text-[10px] text-emerald-500/60 tabular-nums">{gainers.length}</span>
            </div>
            <span className="text-[10px] font-semibold text-emerald-600 tabular-nums">{fmtPnl(gainersPnl)}</span>
          </div>
          <SplitColumnHeaders />
          {renderPanel(gainers, 'gainer')}
        </div>

        {/* Losers */}
        <div>
          <div className="flex items-center justify-between px-2.5 py-1.5 bg-red-50/50 border-b border-gray-200">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-red-500">Losers</span>
              <span className="text-[10px] text-red-400/60 tabular-nums">{losers.length}</span>
            </div>
            <span className="text-[10px] font-semibold text-red-500 tabular-nums">{fmtPnl(losersPnl)}</span>
          </div>
          <SplitColumnHeaders />
          {renderPanel(losers, 'loser')}
        </div>
      </div>

      {/* Unchanged footer */}
      {unchanged > 0 && (
        <div className="px-2.5 py-1 border-t border-gray-200 text-center">
          <span className="text-[9px] text-gray-400">{unchanged} position{unchanged !== 1 ? 's' : ''} unchanged</span>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Split view column headers
// ---------------------------------------------------------------------------

function SplitColumnHeaders() {
  const hCls = 'text-[9px] font-semibold text-gray-400 uppercase tracking-wider'
  return (
    <div className="flex items-center gap-2 px-2.5 py-1 border-b border-gray-100 bg-gray-50/40">
      <span className={`${hCls} min-w-0 flex-1`}>Asset</span>
      <span className={hCls}>Change</span>
      <span className={`${hCls} w-16 text-right`}>P&L</span>
      <span className={`${hCls} w-10 text-right`}>Wt %</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Split view row
// ---------------------------------------------------------------------------

function SplitRow({ row, variant, isSelected, selectedCol, onCellClick }: {
  row: EnrichedRow
  variant: 'gainer' | 'loser'
  isSelected: boolean
  selectedCol: number
  onCellClick: (assetId: string, colIdx: number) => void
}) {
  const colorCls = variant === 'gainer' ? 'text-emerald-600' : 'text-red-600'

  const splitCellCls = (colIdx: number) =>
    isSelected && selectedCol === colIdx
      ? 'outline outline-2 -outline-offset-2 outline-primary-500/70 bg-primary-50/60 rounded-sm'
      : ''

  return (
    <div
      data-asset-id={row.holding.asset_id}
      className={`flex items-center gap-2 px-2.5 py-[5px] cursor-pointer border-b border-gray-50 transition-colors ${
        isSelected ? 'bg-primary-50/40' : 'hover:bg-gray-50/60'
      }`}
    >
      {/* Cell 0: Asset */}
      <div
        className={`min-w-0 flex-1 px-0.5 ${splitCellCls(0)}`}
        onClick={() => onCellClick(row.holding.asset_id, 0)}
      >
        <span className="text-[12px] font-bold text-gray-900">{row.symbol}</span>
        <span className="text-[10px] text-gray-400 ml-1.5 truncate">{row.companyName}</span>
      </div>
      {/* Cell 1: Change % */}
      <span
        className={`text-[11px] font-semibold tabular-nums px-0.5 ${colorCls} ${splitCellCls(1)}`}
        onClick={() => onCellClick(row.holding.asset_id, 1)}
      >
        {row.dayChangePct >= 0 ? '+' : ''}{row.dayChangePct.toFixed(1)}%
      </span>
      {/* Cell 2: Daily P&L */}
      <span
        className={`text-[11px] font-medium tabular-nums w-16 text-right px-0.5 ${colorCls} ${splitCellCls(2)}`}
        onClick={() => onCellClick(row.holding.asset_id, 2)}
      >
        {fmtPnl(row.dailyPnl)}
      </span>
      {/* Cell 3: Weight */}
      <span
        className={`text-[10px] text-gray-400 tabular-nums w-10 text-right px-0.5 ${splitCellCls(3)}`}
        onClick={() => onCellClick(row.holding.asset_id, 3)}
      >
        {row.weightPct.toFixed(1)}%
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Field-specific inspector detail
// ---------------------------------------------------------------------------

interface InspectorCtx {
  rank: number; top3Wt: number; totalDailyPnl: number; contributionPct: number
  sectorPeers: EnrichedRow[]; sectorWt: number; totalPositions: number; dailyImpactRank: number
}

function renderFieldDetail(col: ColKey, row: EnrichedRow, ctx: InspectorCtx, q: any): React.ReactNode {
  const kvCls = 'text-[12px]'
  const labelCls = 'text-gray-400'
  const valCls = 'text-gray-700 font-medium'
  const sep = <span className="text-gray-200 mx-1.5">&middot;</span>

  switch (col) {
    case 'asset': {
      const thesis = row.holding.assets?.thesis
      return (
        <div className="space-y-0.5">
          <p className={`${kvCls} text-gray-600 line-clamp-2`}>{thesis || 'No thesis on file.'}</p>
          <p className={`${kvCls} ${labelCls}`}>
            {row.priority && <span className="capitalize">{row.priority} priority</span>}
            {row.priority && row.processStage && <>{sep}</>}
            {row.processStage && <span className="capitalize">{row.processStage.replace(/_/g, ' ')}</span>}
            {(row.priority || row.processStage) && row.daysAgo !== null && <>{sep}</>}
            {row.daysAgo !== null && `Updated ${row.daysAgo}d ago`}
            {q && row.dailyPnl !== 0 && (
              <>
                {(row.priority || row.processStage || row.daysAgo !== null) && <>{sep}</>}
                <span className={clr(row.dailyPnl)}>
                  Today {fmtPnl(row.dailyPnl)} ({row.dayChangePct >= 0 ? '+' : ''}{row.dayChangePct.toFixed(1)}%)
                </span>
              </>
            )}
          </p>
        </div>
      )
    }
    case 'weight':
      return (
        <p className={kvCls}>
          <span className={valCls}>{row.weightPct.toFixed(2)}%</span>{sep}
          <span className={labelCls}>Rank</span> <span className={valCls}>#{ctx.rank}</span> <span className={labelCls}>of {ctx.totalPositions}</span>{sep}
          <span className={labelCls}>Top 3 =</span> <span className={valCls}>{ctx.top3Wt.toFixed(1)}%</span>{sep}
          <span className={labelCls}>MV</span> <span className={valCls}>{fmtDollar(row.marketValue)}</span>
        </p>
      )
    case 'dailyPnl':
      return (
        <p className={kvCls}>
          <span className={`font-medium ${clr(row.dailyPnl)}`}>{fmtPnl(row.dailyPnl)}</span>
          <span className={`${labelCls} ml-1`}>({row.dayChangePct >= 0 ? '+' : ''}{row.dayChangePct.toFixed(2)}%)</span>
          {q && q.previousClose > 0 && (<>{sep}<span className={labelCls}>Prev</span> <span className={valCls}>${q.previousClose.toFixed(2)}</span></>)}
          {ctx.totalDailyPnl !== 0 && (
            <>
              {sep}<span className={labelCls}>{Math.abs(ctx.contributionPct).toFixed(0)}% of book P&L</span>
              {sep}<span className={row.dailyPnl > 0 ? 'text-green-600' : row.dailyPnl < 0 ? 'text-red-600' : labelCls}>
                {row.dailyPnl > 0 ? 'Contributor' : row.dailyPnl < 0 ? 'Detractor' : 'Flat'}
              </span>
              {sep}<span className={labelCls}>#{ctx.dailyImpactRank}</span> <span className={labelCls}>by daily impact</span>
            </>
          )}
        </p>
      )
    case 'price':
      return (
        <p className={kvCls}>
          <span className={valCls}>${row.price.toFixed(2)}</span>
          {q && q.previousClose > 0 && (<>{sep}<span className={labelCls}>Prev Close</span> <span className={valCls}>${q.previousClose.toFixed(2)}</span></>)}
          {q && q.dayLow > 0 && q.dayHigh > 0 && (<>{sep}<span className={labelCls}>Range</span> <span className={valCls}>${q.dayLow.toFixed(2)} – ${q.dayHigh.toFixed(2)}</span></>)}
          {q && q.open > 0 && (<>{sep}<span className={labelCls}>Open</span> <span className={valCls}>${q.open.toFixed(2)}</span></>)}
        </p>
      )
    case 'unrealizedPnl':
      return (
        <p className={kvCls}>
          <span className={`font-medium ${clr(row.gainLoss)}`}>{row.gainLoss >= 0 ? '+' : '-'}{fmtDollar(Math.abs(row.gainLoss), 2)}</span>
          {sep}<span className={labelCls}>Cost Basis</span> <span className={valCls}>{fmtDollar(row.costBasis)}</span>
          {sep}<span className={labelCls}>MV</span> <span className={valCls}>{fmtDollar(row.marketValue)}</span>
          {sep}<span className={labelCls}>{row.shares.toLocaleString()} × ${row.avgCost.toFixed(2)}</span>
        </p>
      )
    case 'returnPct':
      return (
        <p className={kvCls}>
          <span className={`font-medium ${clr(row.returnPct)}`}>{row.returnPct >= 0 ? '+' : ''}{row.returnPct.toFixed(2)}%</span>
          {sep}<span className={labelCls}>${row.avgCost.toFixed(2)}</span><span className={labelCls}> → </span><span className={valCls}>${row.price.toFixed(2)}</span>
          {sep}<span className={`${clr(row.price - row.avgCost)}`}>{row.price >= row.avgCost ? '+' : '-'}${Math.abs(row.price - row.avgCost).toFixed(2)}/sh</span>
        </p>
      )
    case 'shares':
      return (
        <p className={kvCls}>
          <span className={valCls}>{row.shares.toLocaleString()}</span> <span className={labelCls}>shares</span>
          {sep}<span className={labelCls}>MV</span> <span className={valCls}>{fmtDollar(row.marketValue)}</span>
          {sep}<span className={labelCls}>Wt</span> <span className={valCls}>{row.weightPct.toFixed(1)}%</span>
          {sep}<span className={labelCls}>Unreal</span> <span className={`font-medium ${clr(row.gainLoss)}`}>{fmtPnl(row.gainLoss)}</span>
        </p>
      )
    case 'avgCost':
      return (
        <p className={kvCls}>
          <span className={valCls}>${row.avgCost.toFixed(2)}</span>
          {sep}<span className={labelCls}>Cost Basis</span> <span className={valCls}>{fmtDollar(row.costBasis)}</span>
          {sep}<span className={labelCls}>Current</span> <span className={valCls}>${row.price.toFixed(2)}</span>
          <span className={`ml-1 ${clr(row.returnPct)}`}>({row.returnPct >= 0 ? '+' : ''}{row.returnPct.toFixed(1)}%)</span>
        </p>
      )
    case 'sector':
      return (
        <p className={kvCls}>
          <span className={valCls}>{row.sector}</span>
          {sep}<span className={labelCls}>{ctx.sectorPeers.length} position{ctx.sectorPeers.length !== 1 ? 's' : ''}</span>
          {sep}<span className={valCls}>{ctx.sectorWt.toFixed(1)}%</span> <span className={labelCls}>of portfolio</span>
          {ctx.sectorPeers.length > 1 && (<>{sep}<span className={labelCls}>{ctx.sectorPeers.map(p => p.symbol).join(', ')}</span></>)}
        </p>
      )
    case 'updated': {
      const fresh = freshnessInfo(row.daysAgo)
      const whereDiff = row.holding.assets?.where_different
      return (
        <div className="space-y-0.5">
          <p className={kvCls}>
            {row.daysAgo !== null ? (
              <span className={`inline-flex items-center gap-1 ${fresh.cls}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${fresh.dotCls}`} />
                {row.daysAgo === 0 ? 'Today' : row.daysAgo === 1 ? 'Yesterday' : `${row.daysAgo} days ago`}
              </span>
            ) : (
              <span className={labelCls}>No update date</span>
            )}
            {row.processStage && (<>{sep}<span className={labelCls}>Stage:</span> <span className={`${valCls} capitalize`}>{row.processStage.replace(/_/g, ' ')}</span></>)}
            {row.priority && (<>{sep}<span className={labelCls}>Priority:</span> <span className={`${valCls} capitalize`}>{row.priority}</span></>)}
          </p>
          {whereDiff && <p className={`text-[11px] ${labelCls} truncate`}>Where Different: {whereDiff}</p>}
        </div>
      )
    }
    default: return null
  }
}
