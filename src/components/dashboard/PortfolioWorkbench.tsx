/**
 * PortfolioWorkbench — Portfolio-anchored operating surface.
 *
 * Sections:
 *   1. Movers & Gaps — two sub-panes: large price movers | benchmark weight gaps
 *   2. Upcoming Catalysts — earnings, events for portfolio holdings
 *   3. Investigate — sector concentration, stale thesis, exposure gaps (per-portfolio)
 *
 * All data is grouped by portfolio when multiple are selected.
 * Holdings table only shows for single-portfolio view.
 */

import { useState, useMemo, useCallback } from 'react'
import { clsx } from 'clsx'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Calendar,
  Compass,
  BarChart3,
  AlertTriangle,
  FileText,
  ExternalLink,
  RotateCw,
  Check,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useActiveRuns, type ActiveRun } from '../../hooks/workflow/useActiveRuns'
import type { CockpitViewModel } from '../../types/cockpit'
import type { DashboardItem } from '../../types/dashboard-item'
import {
  classifyAllHoldings,
  generatePortfolioNarrative,
  getPortfolioWorkItems,
  type ClassifiedHolding,
} from '../../lib/dashboard/portfolioIntelligence'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BenchmarkWeight { asset_id: string; weight: number }

interface CalendarEvent {
  id: string; title: string; event_type: string; start_time: string
  context_type?: string; context_id?: string; asset_symbol?: string
}

// ---------------------------------------------------------------------------
// Section config
// ---------------------------------------------------------------------------

interface SectionConfig {
  id: string; title: string; icon: React.FC<{ className?: string }>
  emptyLabel: string; accentBg: string; accentText: string
}

const SECTIONS: SectionConfig[] = [
  { id: 'aware', title: 'Movers & Gaps', icon: TrendingUp, emptyLabel: 'No notable moves or gaps', accentBg: 'bg-blue-50 dark:bg-blue-950/20', accentText: 'text-blue-700 dark:text-blue-400' },
  { id: 'catalysts', title: 'Upcoming Catalysts', icon: Calendar, emptyLabel: 'No upcoming catalysts', accentBg: 'bg-amber-50 dark:bg-amber-950/20', accentText: 'text-amber-700 dark:text-amber-400' },
  { id: 'processes', title: 'Processes', icon: RotateCw, emptyLabel: 'No active processes', accentBg: 'bg-teal-50 dark:bg-teal-950/20', accentText: 'text-teal-700 dark:text-teal-400' },
  { id: 'investigate', title: 'Investigate', icon: Compass, emptyLabel: 'No issues surfaced', accentBg: 'bg-violet-50 dark:bg-violet-950/20', accentText: 'text-violet-700 dark:text-violet-400' },
]

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PortfolioWorkbenchProps {
  portfolioId?: string
  portfolioIds?: string[]
  portfolioName: string
  viewModel: CockpitViewModel
  onItemClick?: (item: DashboardItem) => void
  onNavigate?: (detail: any) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PortfolioWorkbench({
  portfolioId, portfolioIds, portfolioName, viewModel, onItemClick, onNavigate,
}: PortfolioWorkbenchProps) {
  const { user } = useAuth()
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    () => new Set(['aware', 'catalysts', 'processes', 'investigate']),
  )

  const queryIds = useMemo(() => portfolioId ? [portfolioId] : portfolioIds ?? [], [portfolioId, portfolioIds])
  const isSingle = queryIds.length === 1
  const queryKey = queryIds.join(',')

  // ---- Holdings ----
  const { data: rawHoldings, isLoading } = useQuery({
    queryKey: ['portfolio-holdings-multi', queryKey],
    enabled: queryIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_holdings')
        .select(`*, portfolio_id, assets(id, symbol, company_name, sector, industry, thesis, process_stage, updated_at)`)
        .in('portfolio_id', queryIds)
        .order('date', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  // ---- Portfolio names map ----
  const { data: portfolioNames } = useQuery({
    queryKey: ['portfolio-names', queryKey],
    enabled: queryIds.length > 1,
    staleTime: 300_000,
    queryFn: async () => {
      const { data } = await supabase.from('portfolios').select('id, name').in('id', queryIds)
      const map = new Map<string, string>()
      for (const p of data ?? []) map.set(p.id, p.name)
      return map
    },
  })

  // ---- Benchmark weights ----
  const { data: benchmarkWeights } = useQuery({
    queryKey: ['portfolio-benchmark-weights-multi', queryKey],
    enabled: queryIds.length > 0,
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_benchmark_weights')
        .select('asset_id, weight, portfolio_id')
        .in('portfolio_id', queryIds)
      if (error) throw error
      return (data || []) as (BenchmarkWeight & { portfolio_id: string })[]
    },
  })

  // ---- Catalysts ----
  const { data: catalysts } = useQuery({
    queryKey: ['portfolio-catalysts', queryKey],
    enabled: queryIds.length > 0 && (rawHoldings?.length ?? 0) > 0,
    staleTime: 300_000,
    queryFn: async () => {
      if (!rawHoldings || rawHoldings.length === 0) return []
      const assetIds = [...new Set(rawHoldings.map((h: any) => h.asset_id).filter(Boolean))]
      if (assetIds.length === 0) return []
      const now = new Date().toISOString()
      const thirtyDays = new Date(Date.now() + 30 * 86400000).toISOString()
      const { data, error } = await supabase
        .from('calendar_events')
        .select('id, title, event_type, start_time, context_type, context_id')
        .gte('start_time', now).lte('start_time', thirtyDays)
        .order('start_time', { ascending: true }).limit(50)
      if (error) throw error
      const assetIdSet = new Set(assetIds)
      const assetMap = new Map<string, string>()
      for (const h of rawHoldings) {
        const asset = (h as any).assets
        if (asset?.id && asset?.symbol) assetMap.set(asset.id, asset.symbol)
      }
      return (data || [])
        .filter((e: any) => e.context_type === 'asset' && assetIdSet.has(e.context_id))
        .map((e: any) => ({ ...e, asset_symbol: assetMap.get(e.context_id) || '' })) as CalendarEvent[]
    },
  })

  // ---- Classify per portfolio ----
  const perPortfolio = useMemo(() => {
    if (!rawHoldings || rawHoldings.length === 0) return new Map<string, ClassifiedHolding[]>()
    const byPortfolio = new Map<string, any[]>()
    for (const h of rawHoldings) {
      const pid = (h as any).portfolio_id
      if (!pid) continue
      if (!byPortfolio.has(pid)) byPortfolio.set(pid, [])
      byPortfolio.get(pid)!.push(h)
    }
    const allItems = [
      ...viewModel.decide.stacks.flatMap(s => s.itemsAll),
      ...viewModel.advance.stacks.flatMap(s => s.itemsAll),
      ...viewModel.aware.stacks.flatMap(s => s.itemsAll),
    ]
    const result = new Map<string, ClassifiedHolding[]>()
    for (const [pid, holdings] of byPortfolio) {
      const relItems = allItems.filter(i => i.portfolio?.id === pid)
      result.set(pid, classifyAllHoldings(holdings, relItems))
    }
    return result
  }, [rawHoldings, viewModel])

  const allClassified = useMemo(() => [...perPortfolio.values()].flat(), [perPortfolio])

  // ---- Benchmark map per portfolio ----
  const benchmarkByPortfolio = useMemo(() => {
    const map = new Map<string, Map<string, number>>()
    for (const b of benchmarkWeights ?? []) {
      if (!map.has(b.portfolio_id)) map.set(b.portfolio_id, new Map())
      map.get(b.portfolio_id)!.set(b.asset_id, b.weight)
    }
    return map
  }, [benchmarkWeights])

  // ---- Stats ----
  const stats = useMemo(() => {
    const totalValue = allClassified.reduce((s, h) => s + h.marketValue, 0)
    // Exclude cash-like holdings from return calc
    const nonCash = allClassified.filter(h => h.returnPct !== 0 || h.unrealizedPnl !== 0 || (h.cost > 0 && h.price > 0))
    const totalCost = nonCash.reduce((s, h) => s + h.shares * h.cost, 0)
    const nonCashValue = nonCash.reduce((s, h) => s + h.marketValue, 0)
    const rawReturn = totalCost > 0 && nonCashValue > 0 ? ((nonCashValue - totalCost) / totalCost) * 100 : 0
    const returnPct = rawReturn <= -99.9 ? 0 : rawReturn
    return { totalValue, returnPct, holdingsCount: allClassified.length }
  }, [allClassified])

  // ---- Narrative (single only) ----
  const narrative = useMemo(() => {
    if (!isSingle) return { summary: `${allClassified.length} positions across ${queryIds.length} portfolios`, callout: null, focus: null }
    const workItems = getPortfolioWorkItems(viewModel, queryIds[0])
    return generatePortfolioNarrative(allClassified, workItems)
  }, [allClassified, viewModel, queryIds, isSingle])

  // ---- MOVERS — grouped by asset, with per-portfolio breakdown ----
  interface PortfolioExposure { portfolioName: string; weight: number; benchWeight: number; active: number }
  interface MoverItem { symbol: string; assetId: string; returnPct: number; portfolios: PortfolioExposure[] }
  interface GapItem { symbol: string; assetId: string; portfolios: PortfolioExposure[]; maxAbsGap: number }

  const movers = useMemo((): MoverItem[] => {
    // Group by assetId across portfolios
    const byAsset = new Map<string, MoverItem>()
    for (const [pid, holdings] of perPortfolio) {
      const pName = portfolioNames?.get(pid) ?? (isSingle ? portfolioName : pid.slice(0, 8))
      const bm = benchmarkByPortfolio.get(pid) ?? new Map<string, number>()
      for (const h of holdings) {
        if (Math.abs(h.returnPct) <= 3) continue
        const bench = bm.get(h.assetId) ?? 0
        if (!byAsset.has(h.assetId)) {
          byAsset.set(h.assetId, { symbol: h.symbol, assetId: h.assetId, returnPct: h.returnPct, portfolios: [] })
        }
        byAsset.get(h.assetId)!.portfolios.push({ portfolioName: pName, weight: h.weight, benchWeight: bench, active: h.weight - bench })
      }
    }
    return [...byAsset.values()].sort((a, b) => Math.abs(b.returnPct) - Math.abs(a.returnPct)).slice(0, 8)
  }, [perPortfolio, benchmarkByPortfolio, portfolioNames, isSingle, portfolioName])

  // ---- GAPS — grouped by asset, with per-portfolio breakdown ----
  const gaps = useMemo((): GapItem[] => {
    const byAsset = new Map<string, GapItem>()
    for (const [pid, holdings] of perPortfolio) {
      const bm = benchmarkByPortfolio.get(pid)
      if (!bm || bm.size === 0) continue
      const pName = portfolioNames?.get(pid) ?? (isSingle ? portfolioName : pid.slice(0, 8))
      for (const h of holdings) {
        const bench = bm.get(h.assetId) ?? 0
        const gap = h.weight - bench
        if (Math.abs(gap) <= 1) continue
        if (!byAsset.has(h.assetId)) {
          byAsset.set(h.assetId, { symbol: h.symbol, assetId: h.assetId, portfolios: [], maxAbsGap: 0 })
        }
        const entry = byAsset.get(h.assetId)!
        entry.portfolios.push({ portfolioName: pName, weight: h.weight, benchWeight: bench, active: gap })
        entry.maxAbsGap = Math.max(entry.maxAbsGap, Math.abs(gap))
      }
      // Benchmark names not held
      for (const [assetId, bWeight] of bm) {
        if (bWeight < 1 || holdings.some(h => h.assetId === assetId)) continue
        if (!byAsset.has(assetId)) {
          byAsset.set(assetId, { symbol: '?', assetId, portfolios: [], maxAbsGap: 0 })
        }
        const entry = byAsset.get(assetId)!
        entry.portfolios.push({ portfolioName: pName, weight: 0, benchWeight: bWeight, active: -bWeight })
        entry.maxAbsGap = Math.max(entry.maxAbsGap, bWeight)
      }
    }
    return [...byAsset.values()].sort((a, b) => b.maxAbsGap - a.maxAbsGap).slice(0, 8)
  }, [perPortfolio, benchmarkByPortfolio, portfolioNames, isSingle, portfolioName])

  // ---- INVESTIGATE: per-portfolio items ----
  const investigateItems = useMemo(() => {
    const items: { id: string; portfolioId: string; portfolioName: string; title: string; detail: string; severity: 'high' | 'med' | 'low' }[] = []

    for (const [pid, holdings] of perPortfolio) {
      const pName = portfolioNames?.get(pid) ?? (isSingle ? portfolioName : pid.slice(0, 8))
      const bm = benchmarkByPortfolio.get(pid) ?? new Map<string, number>()

      // Sector concentration
      const sectorWeights = new Map<string, number>()
      for (const h of holdings) sectorWeights.set(h.sector || 'Unknown', (sectorWeights.get(h.sector || 'Unknown') ?? 0) + h.weight)
      for (const [sector, weight] of sectorWeights) {
        if (weight > 30) {
          items.push({ id: `sector-${pid}-${sector}`, portfolioId: pid, portfolioName: pName, title: `${sector} at ${weight.toFixed(0)}%`, detail: 'Sector concentration', severity: weight > 40 ? 'high' : 'med' })
        }
      }

      // Stale thesis
      const stale = holdings.filter(h => h.thesisAgeDays != null && h.thesisAgeDays > 90)
      if (stale.length > 0) {
        const tickers = stale.slice(0, 3).map(h => h.symbol).join(', ')
        items.push({ id: `stale-${pid}`, portfolioId: pid, portfolioName: pName, title: `${stale.length} stale thesis`, detail: tickers, severity: stale.some(h => h.thesisAgeDays != null && h.thesisAgeDays > 180) ? 'high' : 'med' })
      }

      // At-risk holdings
      const atRisk = holdings.filter(h => h.status === 'at-risk')
      if (atRisk.length > 0) {
        const tickers = atRisk.slice(0, 3).map(h => h.symbol).join(', ')
        items.push({ id: `risk-${pid}`, portfolioId: pid, portfolioName: pName, title: `${atRisk.length} at risk`, detail: tickers, severity: atRisk.length >= 3 ? 'high' : 'med' })
      }

      // No thesis on big positions
      const noThesis = holdings.filter(h => h.weight > 2 && !h.thesisAgeDays)
      if (noThesis.length > 0) {
        items.push({ id: `nothesis-${pid}`, portfolioId: pid, portfolioName: pName, title: `${noThesis.length} positions no thesis`, detail: noThesis.slice(0, 3).map(h => h.symbol).join(', '), severity: 'med' })
      }

      // Tracking error
      const totalGap = holdings.reduce((s, h) => s + Math.abs(h.weight - (bm.get(h.assetId) ?? 0)), 0)
      if (totalGap > 20 && bm.size > 0) {
        items.push({ id: `te-${pid}`, portfolioId: pid, portfolioName: pName, title: `${totalGap.toFixed(0)}% active share`, detail: 'High deviation from benchmark', severity: totalGap > 40 ? 'high' : 'med' })
      }
    }

    // Sort: high first, then med
    items.sort((a, b) => (a.severity === 'high' ? 0 : 1) - (b.severity === 'high' ? 0 : 1))
    return items
  }, [perPortfolio, benchmarkByPortfolio, portfolioNames, isSingle, portfolioName])

  // ---- Portfolio Processes ----
  const { data: allRuns = [] } = useActiveRuns(user?.id)
  const portfolioProcesses = useMemo(() => {
    return allRuns.filter(r =>
      r.scope_type === 'portfolio' &&
      r.status === 'active' &&
      !r.archived &&
      !r.parent_archived &&
      !r.parent_deleted
    )
  }, [allRuns])

  const awareCount = movers.length + gaps.length
  const toggleSection = useCallback((id: string) => {
    setExpandedSections(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }, [])

  if (isLoading) {
    return <div className="h-[200px] bg-gray-50 dark:bg-gray-800/40 rounded-lg animate-pulse" />
  }

  if (!rawHoldings || rawHoldings.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 px-4 py-6 text-center">
        <p className="text-[12px] text-gray-500 dark:text-gray-400">No holdings for {portfolioName}.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden">
        <div className="px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-[15px] font-bold text-gray-900 dark:text-gray-50">{portfolioName}</h2>
            <span className="text-[11px] text-gray-400 dark:text-gray-500 tabular-nums">{stats.holdingsCount} positions</span>
            <span className="text-[12px] font-medium text-gray-600 dark:text-gray-300 tabular-nums">
              {stats.totalValue >= 1_000_000 ? `$${(stats.totalValue / 1_000_000).toFixed(1)}M` : `$${(stats.totalValue / 1000).toFixed(0)}k`}
            </span>
            <span className={clsx('text-[12px] font-bold tabular-nums', stats.returnPct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
              {stats.returnPct >= 0 ? '+' : ''}{stats.returnPct.toFixed(1)}%
            </span>
          </div>
          {isSingle && (
            <button onClick={() => onNavigate?.({ id: queryIds[0], title: portfolioName, type: 'portfolio', data: { id: queryIds[0], name: portfolioName } })} className="flex items-center gap-1 text-[10px] font-medium text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
              Full view <ExternalLink className="w-3 h-3" />
            </button>
          )}
        </div>
        {narrative.summary && (
          <div className="px-4 pb-2.5">
            <p className="text-[12px] text-gray-600 dark:text-gray-300 leading-snug">{narrative.summary}</p>
            {narrative.callout && <p className="text-[11px] text-red-600/80 dark:text-red-400/70 leading-snug mt-0.5">{narrative.callout}</p>}
          </div>
        )}
      </div>

      {/* Accordion */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden">

        {/* MOVERS & GAPS — side-by-side tiles */}
        <SectionHeader config={SECTIONS[0]} count={awareCount} isExpanded={expandedSections.has('aware')} onToggle={() => toggleSection('aware')} isFirst />
        {expandedSections.has('aware') && (
          <div className="grid grid-cols-2 gap-px bg-gray-100 dark:bg-gray-700/40 border-t border-gray-100 dark:border-gray-700/40">
            {/* Left tile: Price Movers */}
            <div className="bg-white dark:bg-gray-800/60">
              <div className="flex items-center gap-2 px-3.5 py-1.5 bg-gray-50/40 dark:bg-gray-800/20">
                <TrendingUp className="w-3 h-3 text-blue-400" />
                <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Price Movers</span>
                <span className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">{movers.length}</span>
              </div>
              {movers.length > 0 ? movers.map(m => (
                <ExpandableAssetRow
                  key={`m-${m.assetId}`}
                  symbol={m.symbol}
                  assetId={m.assetId}
                  summary={<>
                    <span className={clsx('w-[50px] shrink-0 text-[11px] font-bold tabular-nums', m.returnPct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                      {m.returnPct >= 0 ? '+' : ''}{m.returnPct.toFixed(1)}%
                    </span>
                    {m.portfolios.length > 1 ? (
                      <span className="text-[9px] text-gray-400 dark:text-gray-500">{m.portfolios.length} portfolios</span>
                    ) : (
                      <span className="text-[10px] text-gray-400 dark:text-gray-500">{m.portfolios[0].portfolioName}</span>
                    )}
                  </>}
                  portfolios={m.portfolios}
                  isSingle={isSingle}
                  onNavigate={onNavigate}
                />
              )) : (
                <div className="px-3.5 py-3 text-[11px] text-gray-400 dark:text-gray-500 italic">No notable movers</div>
              )}
            </div>

            {/* Right tile: Benchmark Gaps */}
            <div className="bg-white dark:bg-gray-800/60">
              <div className="flex items-center gap-2 px-3.5 py-1.5 bg-gray-50/40 dark:bg-gray-800/20">
                <BarChart3 className="w-3 h-3 text-violet-400" />
                <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Benchmark Gaps</span>
                <span className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">{gaps.length}</span>
              </div>
              {gaps.length > 0 ? gaps.map(g => (
                <ExpandableAssetRow
                  key={`g-${g.assetId}`}
                  symbol={g.symbol}
                  assetId={g.assetId}
                  summary={<>
                    {g.portfolios.length === 1 ? (
                      <>
                        <span className="text-[10px] tabular-nums text-gray-500 dark:text-gray-400">
                          {g.portfolios[0].weight.toFixed(1)}% <span className="text-gray-300 dark:text-gray-600">vs</span> {g.portfolios[0].benchWeight.toFixed(1)}%
                        </span>
                        <span className={clsx('text-[10px] font-bold tabular-nums', g.portfolios[0].active > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                          {g.portfolios[0].active > 0 ? '+' : ''}{g.portfolios[0].active.toFixed(1)}%
                        </span>
                      </>
                    ) : (
                      <span className="text-[9px] text-gray-400 dark:text-gray-500">{g.portfolios.length} portfolios</span>
                    )}
                    {g.portfolios.some(p => p.weight === 0) && (
                      <span className="text-[9px] text-amber-600 dark:text-amber-400 font-medium">Not held</span>
                    )}
                  </>}
                  portfolios={g.portfolios}
                  isSingle={isSingle}
                  onNavigate={onNavigate}
                />
              )) : (
                <div className="px-3.5 py-3 text-[11px] text-gray-400 dark:text-gray-500 italic">No benchmark data</div>
              )}
            </div>
          </div>
        )}

        {/* CATALYSTS */}
        <SectionHeader config={SECTIONS[1]} count={catalysts?.length ?? 0} isExpanded={expandedSections.has('catalysts')} onToggle={() => toggleSection('catalysts')} />
        {expandedSections.has('catalysts') && (catalysts?.length ?? 0) > 0 && (
          <div>
            {catalysts!.map(event => {
              const d = new Date(event.start_time)
              const days = Math.ceil((d.getTime() - Date.now()) / 86400000)
              return (
                <div key={event.id} className="flex items-center gap-2 pl-8 pr-3.5 py-[5px] border-t border-t-gray-50 dark:border-t-gray-700/20">
                  <span className={clsx('w-[28px] shrink-0 text-[11px] font-bold tabular-nums text-right', days <= 3 ? 'text-red-600 dark:text-red-400' : days <= 7 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500')}>{days}d</span>
                  <span className="w-[50px] shrink-0 text-[12px] font-bold text-blue-600 dark:text-blue-400">{event.asset_symbol}</span>
                  <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-[1px] rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 shrink-0">{event.event_type?.replace(/_/g, ' ') || 'event'}</span>
                  <span className="flex-1 text-[11px] text-gray-500 dark:text-gray-400 truncate">{event.title}</span>
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0">{d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                </div>
              )
            })}
          </div>
        )}

        {/* PROCESSES */}
        <SectionHeader config={SECTIONS[2]} count={portfolioProcesses.length} isExpanded={expandedSections.has('processes')} onToggle={() => toggleSection('processes')} />
        {expandedSections.has('processes') && portfolioProcesses.length > 0 && (
          <div>
            {portfolioProcesses.map(run => {
              const pct = run.total_items > 0 ? Math.round((run.completed_items / run.total_items) * 100) : 0
              return (
                <div key={run.id} className="flex items-center gap-2 pl-8 pr-3.5 py-[5px] border-t border-t-gray-50 dark:border-t-gray-700/20">
                  <span className="w-[26px] shrink-0 text-center">
                    {pct === 100
                      ? <Check className="w-3.5 h-3.5 text-emerald-500 inline-block" />
                      : <RotateCw className="w-3 h-3 text-teal-500 inline-block" />
                    }
                  </span>
                  <span className="text-[12px] font-medium text-gray-700 dark:text-gray-200 truncate flex-1">
                    {run.parent_name}
                  </span>
                  <span className="text-[10px] tabular-nums text-gray-400 dark:text-gray-500 shrink-0">
                    {run.completed_items}/{run.total_items}
                  </span>
                  {run.total_items > 0 && (
                    <div className="w-[40px] h-[4px] rounded-full bg-gray-200 dark:bg-gray-700 shrink-0 overflow-hidden">
                      <div className={clsx('h-full rounded-full', pct === 100 ? 'bg-emerald-500' : 'bg-teal-500')} style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* INVESTIGATE — per-portfolio */}
        <SectionHeader config={SECTIONS[3]} count={investigateItems.length} isExpanded={expandedSections.has('investigate')} onToggle={() => toggleSection('investigate')} />
        {expandedSections.has('investigate') && investigateItems.length > 0 && (
          <div>
            {investigateItems.map(item => (
              <div key={item.id} className="flex items-center gap-2 pl-8 pr-3.5 py-[5px] border-t border-t-gray-50 dark:border-t-gray-700/20">
                <span className="w-[26px] shrink-0 text-center">
                  <span className={clsx('inline-block w-1.5 h-1.5 rounded-full', item.severity === 'high' ? 'bg-red-500' : item.severity === 'med' ? 'bg-amber-500' : 'bg-gray-300 dark:bg-gray-600')} />
                </span>
                {!isSingle && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onNavigate?.({ id: item.portfolioId, title: item.portfolioName, type: 'portfolio', data: { id: item.portfolioId, name: item.portfolioName } }) }}
                    className="shrink-0 text-[10px] font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline transition-colors"
                  >
                    {item.portfolioName}
                  </button>
                )}
                <span className={clsx('text-[12px] truncate', item.severity === 'high' ? 'text-gray-700 dark:text-gray-200 font-medium' : 'text-gray-500 dark:text-gray-400')}>
                  {item.title}
                </span>
                <span className="flex-1 min-w-0 text-[10px] text-gray-400 dark:text-gray-500 truncate ml-2">{item.detail}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Holdings table — single portfolio only */}
      {isSingle && <HoldingsTable holdings={allClassified} onNavigate={onNavigate} benchmarkMap={benchmarkByPortfolio.get(queryIds[0]) ?? new Map()} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SectionHeader
// ---------------------------------------------------------------------------

function SectionHeader({ config, count, isExpanded, onToggle, isFirst }: {
  config: SectionConfig; count: number; isExpanded: boolean; onToggle: () => void; isFirst?: boolean
}) {
  const Icon = config.icon
  const isEmpty = count === 0
  return (
    <button onClick={onToggle} className={clsx(
      'w-full flex items-center gap-2 px-3.5 py-2.5 text-left transition-colors',
      isEmpty ? 'bg-gray-50/30 dark:bg-gray-800/20' : clsx(config.accentBg, 'hover:brightness-95 dark:hover:brightness-110'),
      !isFirst && 'border-t border-gray-100 dark:border-gray-700/40',
    )}>
      {isExpanded && !isEmpty ? <ChevronDown className={clsx('w-3 h-3 shrink-0', config.accentText)} /> : <ChevronRight className="w-3 h-3 shrink-0 text-gray-400 dark:text-gray-500" />}
      <Icon className={clsx('w-3.5 h-3.5 shrink-0', isEmpty ? 'text-gray-300 dark:text-gray-600' : config.accentText)} />
      <span className={clsx('text-[12px] font-semibold', isEmpty ? 'text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-200')}>{config.title}</span>
      {!isEmpty && <span className={clsx('text-[11px] font-bold tabular-nums px-1.5 py-px rounded-full min-w-[20px] text-center', config.accentBg, config.accentText)}>{count}</span>}
      {isEmpty && <span className="text-[11px] text-gray-400 dark:text-gray-500 italic ml-auto">{config.emptyLabel}</span>}
    </button>
  )
}

// ---------------------------------------------------------------------------
// ExpandableAssetRow — click "X portfolios" to see per-portfolio detail
// ---------------------------------------------------------------------------

function ExpandableAssetRow({
  symbol, assetId, summary, portfolios, isSingle, onNavigate,
}: {
  symbol: string
  assetId: string
  summary: React.ReactNode
  portfolios: { portfolioName: string; weight: number; benchWeight: number; active: number }[]
  isSingle: boolean
  onNavigate?: (detail: any) => void
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="border-t border-t-gray-50 dark:border-t-gray-700/20">
      <div
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-2 px-3.5 py-[5px] cursor-pointer hover:bg-gray-50/40 dark:hover:bg-gray-700/20"
      >
        <span className="w-[50px] shrink-0 text-[12px] font-bold text-blue-600 dark:text-blue-400">{symbol}</span>
        {summary}
        {expanded
            ? <ChevronDown className="w-3 h-3 text-gray-400 shrink-0 ml-auto" />
            : <ChevronRight className="w-3 h-3 text-gray-400 shrink-0 ml-auto" />
        }
      </div>

      {/* Per-portfolio breakdown */}
      {expanded && (
        <div className="bg-gray-50/30 dark:bg-gray-800/20">
          {/* Column labels */}
          <div className="flex items-center gap-2 px-3.5 pl-[62px] py-[3px] text-[8px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
            <span className="w-[70px]">Portfolio</span>
            <span className="w-[40px] text-right">Wt%</span>
            <span className="w-[40px] text-right">Bench</span>
            <span className="w-[44px] text-right">Active</span>
          </div>
          {portfolios.map((p, i) => (
            <div key={i} className="flex items-center gap-2 px-3.5 pl-[62px] py-[3px] border-t border-t-gray-100/50 dark:border-t-gray-700/20">
              <span className="w-[70px] shrink-0 text-[10px] text-gray-500 dark:text-gray-400 truncate">{p.portfolioName}</span>
              <span className="w-[40px] shrink-0 text-[10px] tabular-nums text-gray-600 dark:text-gray-300 text-right">{p.weight.toFixed(1)}%</span>
              <span className="w-[40px] shrink-0 text-[10px] tabular-nums text-gray-400 dark:text-gray-500 text-right">{p.benchWeight > 0 ? `${p.benchWeight.toFixed(1)}%` : '—'}</span>
              <span className={clsx('w-[44px] shrink-0 text-[10px] font-bold tabular-nums text-right',
                p.active > 0.5 ? 'text-emerald-600 dark:text-emerald-400' : p.active < -0.5 ? 'text-red-600 dark:text-red-400' : 'text-gray-400',
              )}>
                {p.benchWeight > 0 ? `${p.active > 0 ? '+' : ''}${p.active.toFixed(1)}%` : '—'}
              </span>
            </div>
          ))}
        </div>
      )}

    </div>
  )
}

// ---------------------------------------------------------------------------
// HoldingsTable
// ---------------------------------------------------------------------------

function HoldingsTable({ holdings, onNavigate, benchmarkMap }: {
  holdings: ClassifiedHolding[]; onNavigate?: (d: any) => void; benchmarkMap: Map<string, number>
}) {
  const [expanded, setExpanded] = useState(false)
  const PREVIEW = 10
  const visible = expanded ? holdings : holdings.slice(0, PREVIEW)

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden">
      <div className="px-3.5 py-2 border-b border-gray-100 dark:border-gray-700/40 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Holdings</span>
        <span className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">{holdings.length} positions</span>
      </div>
      <div className="flex items-center gap-2 px-3.5 py-1.5 border-b border-gray-100 dark:border-gray-700/40 text-[9px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
        <span className="w-[44px]">Ticker</span>
        <span className="w-[40px] text-right">Wt%</span>
        <span className="w-[40px] text-right">Bench</span>
        <span className="w-[40px] text-right">Gap</span>
        <span className="w-[48px] text-right">Return</span>
        <span className="w-[52px]">Status</span>
        <span className="flex-1">Note</span>
      </div>
      <div className="divide-y divide-gray-50 dark:divide-gray-700/20">
        {visible.map(h => {
          const bw = benchmarkMap.get(h.assetId) ?? 0
          const gap = h.weight - bw
          const sl = h.status === 'at-risk' ? 'text-red-600 dark:text-red-400' : h.status === 'stale' ? 'text-amber-600 dark:text-amber-400' : h.status === 'opportunity' ? 'text-emerald-600 dark:text-emerald-400' : ''
          const label = h.status !== 'ok' ? (h.status === 'at-risk' ? 'At Risk' : h.status === 'stale' ? 'Stale' : 'Opp') : ''
          return (
            <div key={h.assetId} onClick={() => onNavigate?.({ id: h.assetId, title: h.symbol, type: 'asset', data: { id: h.assetId, symbol: h.symbol } })}
              className="flex items-center gap-2 px-3.5 py-[4px] cursor-pointer hover:bg-gray-50/60 dark:hover:bg-gray-700/30 transition-colors">
              <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400 w-[44px] shrink-0">{h.symbol}</span>
              <span className="text-[10px] text-gray-500 tabular-nums w-[40px] text-right shrink-0">{h.weight.toFixed(1)}</span>
              <span className="text-[10px] text-gray-400 tabular-nums w-[40px] text-right shrink-0">{bw > 0 ? bw.toFixed(1) : '—'}</span>
              <span className={clsx('text-[10px] font-bold tabular-nums w-[40px] text-right shrink-0', gap > 0.5 ? 'text-emerald-600 dark:text-emerald-400' : gap < -0.5 ? 'text-red-600 dark:text-red-400' : 'text-gray-400')}>
                {bw > 0 ? `${gap > 0 ? '+' : ''}${gap.toFixed(1)}` : '—'}
              </span>
              <span className={clsx('text-[10px] font-bold tabular-nums w-[48px] text-right shrink-0', h.returnPct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                {h.returnPct >= 0 ? '+' : ''}{h.returnPct.toFixed(1)}%
              </span>
              <span className="w-[52px] shrink-0">{label && <span className={clsx('text-[8px] font-bold uppercase tracking-wider', sl)}>{label}</span>}</span>
              <span className="flex-1 text-[10px] text-gray-400 dark:text-gray-500 truncate">{h.statusReason !== 'On track' ? h.statusReason : ''}</span>
            </div>
          )
        })}
      </div>
      {holdings.length > PREVIEW && (
        <button onClick={() => setExpanded(e => !e)} className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-[10px] text-gray-400 hover:text-gray-600 border-t border-gray-100 dark:border-gray-700/40 transition-colors">
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          {expanded ? 'Show less' : `+${holdings.length - PREVIEW} more`}
        </button>
      )}
    </div>
  )
}
