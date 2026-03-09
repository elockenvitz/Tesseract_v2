import React, { useMemo } from 'react'
import { ArrowRight, ChevronRight, AlertTriangle, FileText, FolderKanban, Activity } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { useMarketData, useMarketStatus } from '../../../hooks/useMarketData'
import { supabase } from '../../../lib/supabase'
import type { PortfolioHolding, CombinedUniverse, NavigateHandler } from './portfolio-tab-types'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface OverviewTabProps {
  portfolio: any
  holdings: PortfolioHolding[] | undefined
  notes: any[] | undefined
  totalValue: number
  totalReturn: number
  returnPercentage: number
  teamCount: number
  combinedUniverseAssets: CombinedUniverse
  onNavigate?: NavigateHandler
  onNavigateToTab: (tab: string) => void
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function fmtCcy(value: number, opts?: { compact?: boolean; sign?: boolean }) {
  const abs = Math.abs(value)
  const prefix = opts?.sign ? (value >= 0 ? '+' : '') : (value < 0 ? '-' : '')
  if (opts?.compact && abs >= 1_000_000) return `${prefix}$${(abs / 1_000_000).toFixed(1)}M`
  if (opts?.compact && abs >= 1_000) return `${prefix}$${(abs / 1_000).toFixed(0)}K`
  if (abs >= 1_000) return `${prefix}$${abs.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
  return `${prefix}$${abs.toFixed(2)}`
}

function fmtPct(value: number, opts?: { sign?: boolean }) {
  const prefix = opts?.sign ? (value >= 0 ? '+' : '') : ''
  return `${prefix}${value.toFixed(2)}%`
}

function clr(v: number) {
  if (v > 0) return 'text-emerald-600'
  if (v < 0) return 'text-red-600'
  return 'text-gray-500'
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Holding {
  symbol: string
  companyName: string
  sector: string
  shares: number
  price: number
  cost: number
  marketValue: number
  weight: number
  gainLoss: number
  returnPct: number
  dayChange: number
  dayChangePct: number
  dayPnl: number
  processStage?: string
  thesisAge?: number
}

interface Signal {
  id: string
  title: string
  detail: string
  severity: 'high' | 'medium' | 'low'
  tag: string
}

// ---------------------------------------------------------------------------
// Note type → portfolio-log labels
// ---------------------------------------------------------------------------

const LOG_LABEL: Record<string, string> = {
  thesis: 'Portfolio Thesis', thesis_update: 'Portfolio Thesis',
  earnings: 'Earnings', earnings_prep: 'Earnings',
  meeting: 'Meeting Notes', meeting_notes: 'Meeting Notes',
  risk: 'Risk Log', risk_review: 'Risk Log',
  trade_rationale: 'Trade Idea', idea: 'Trade Idea',
  market_commentary: 'Macro View', analysis: 'Macro View',
  performance: 'Performance', performance_review: 'Performance',
  research: 'Decision', general: 'Log Entry',
}

function workLabel(t: string | null | undefined): string {
  if (!t) return 'Log Entry'
  return LOG_LABEL[t] || t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ---------------------------------------------------------------------------
// Sector bar colors
// ---------------------------------------------------------------------------

const SEC_CLR = [
  'bg-indigo-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500',
  'bg-sky-500', 'bg-violet-500', 'bg-teal-500', 'bg-orange-500',
  'bg-cyan-500', 'bg-fuchsia-500', 'bg-lime-500', 'bg-pink-500',
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OverviewTab({
  portfolio,
  holdings,
  notes,
  totalValue,
  totalReturn,
  returnPercentage,
  teamCount,
  combinedUniverseAssets,
  onNavigate,
  onNavigateToTab,
}: OverviewTabProps) {
  // ── Market data ──────────────────────────────────────────
  const symbols = useMemo(
    () => (holdings || []).map(h => h.assets?.symbol).filter(Boolean) as string[],
    [holdings],
  )
  const { quotes } = useMarketData(symbols, { enabled: symbols.length > 0 })
  const marketStatus = useMarketStatus()

  // ── Projects ─────────────────────────────────────────────
  const { data: relatedProjects } = useQuery({
    queryKey: ['entity-projects', 'portfolio', portfolio.id],
    enabled: !!portfolio.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_contexts')
        .select(`
          project:projects!inner(
            id, title, status, priority, due_date, updated_at,
            project_deliverables(id, completed)
          )
        `)
        .eq('context_type', 'portfolio')
        .eq('context_id', portfolio.id)
      if (error) throw error
      return (data || []).map((row: any) => row.project).filter(Boolean)
    },
  })

  // ── Enriched holdings ────────────────────────────────────
  const enriched = useMemo<Holding[]>(() => {
    if (!holdings?.length) return []
    return holdings.map(h => {
      const symbol = h.assets?.symbol || '?'
      const shares = parseFloat(h.shares) || 0
      const price = parseFloat(h.price) || 0
      const cost = parseFloat(h.cost) || 0
      const mv = shares * price
      const cb = shares * cost
      const gl = mv - cb
      const ret = cb > 0 ? (gl / cb) * 100 : 0
      const q = quotes.get(symbol)
      const dc = q?.change ?? 0
      const dcp = q?.changePercent ?? 0
      let thesisAge: number | undefined
      if (h.assets?.updated_at) thesisAge = Math.floor((Date.now() - new Date(h.assets.updated_at).getTime()) / 86400000)
      return {
        symbol, companyName: h.assets?.company_name || '',
        sector: h.assets?.sector || 'Unknown',
        shares, price, cost, marketValue: mv,
        weight: totalValue > 0 ? (mv / totalValue) * 100 : 0,
        gainLoss: gl, returnPct: ret,
        dayChange: dc, dayChangePct: dcp, dayPnl: shares * dc,
        processStage: h.assets?.process_stage, thesisAge,
      }
    }).sort((a, b) => b.weight - a.weight)
  }, [holdings, quotes, totalValue])

  // ── YTD metrics ──────────────────────────────────────────
  // TODO: Wire to portfolio_nav_history for true YTD (Jan 1 NAV snapshot).
  // Currently uses inception-to-date P&L as fallback.
  const ytdPnl = totalReturn
  const ytdReturnPct = returnPercentage

  // ── Today ────────────────────────────────────────────────
  const todayPnl = useMemo(() => enriched.reduce((s, h) => s + h.dayPnl, 0), [enriched])
  const todayReturnPct = totalValue > 0 ? (todayPnl / (totalValue - todayPnl || 1)) * 100 : 0
  const hasQuotes = quotes.size > 0

  // ── Movers ───────────────────────────────────────────────
  const contributors = useMemo(() =>
    [...enriched].sort((a, b) => b.dayPnl - a.dayPnl).filter(h => h.dayPnl > 0).slice(0, 3),
    [enriched],
  )
  const detractors = useMemo(() =>
    [...enriched].sort((a, b) => a.dayPnl - b.dayPnl).filter(h => h.dayPnl < 0).slice(0, 3),
    [enriched],
  )
  const hasMovers = contributors.length > 0 || detractors.length > 0

  // ── Sectors ──────────────────────────────────────────────
  const sectors = useMemo(() => {
    if (!enriched.length) return []
    const m: Record<string, number> = {}
    for (const h of enriched) m[h.sector] = (m[h.sector] || 0) + h.weight
    return Object.entries(m).map(([s, w]) => ({ sector: s, weight: w })).sort((a, b) => b.weight - a.weight)
  }, [enriched])

  // ── Concentration ────────────────────────────────────────
  const top5Wt = useMemo(() => enriched.slice(0, 5).reduce((s, h) => s + h.weight, 0), [enriched])
  const posCount = holdings?.length || 0

  // ── Portfolio Signals ────────────────────────────────────
  // Single unified signal system. Portfolio-level risks first,
  // position-specific issues second. No separate "Needs Attention."
  const signals = useMemo<Signal[]>(() => {
    const items: Signal[] = []

    // --- Portfolio-level signals (show first) ---

    // Top-N concentration
    if (posCount > 0 && posCount <= 5) {
      items.push({
        id: 'concentration', tag: 'Exposure', severity: 'medium',
        title: 'High concentration',
        detail: `Portfolio concentrated in ${posCount} names`,
      })
    } else if (posCount > 5 && top5Wt > 75) {
      items.push({
        id: 'concentration', tag: 'Exposure',
        severity: top5Wt > 90 ? 'high' : 'medium',
        title: 'High concentration',
        detail: `Top 5 positions = ${top5Wt.toFixed(0)}% of portfolio`,
      })
    }

    // Sector overweight
    if (sectors.length > 0 && sectors[0].weight > 50) {
      items.push({
        id: 'sector', tag: 'Exposure',
        severity: sectors[0].weight > 70 ? 'high' : 'medium',
        title: `${sectors[0].sector} overweight`,
        detail: `${sectors[0].weight.toFixed(1)}% of portfolio in one sector`,
      })
    }

    // --- Position-level signals (show after portfolio-level) ---

    // Drawdowns
    for (const h of enriched) {
      if (h.returnPct < -10) {
        items.push({
          id: `dd-${h.symbol}`, tag: 'Position',
          severity: h.returnPct < -20 ? 'high' : 'medium',
          title: `${h.symbol} down ${Math.abs(h.returnPct).toFixed(1)}%`,
          detail: `${fmtCcy(Math.abs(h.gainLoss))} loss on ${h.shares.toLocaleString()} shares`,
        })
      }
    }

    // Stale thesis
    for (const h of enriched) {
      if (h.thesisAge !== undefined && h.thesisAge > 90) {
        items.push({
          id: `stale-${h.symbol}`, tag: 'Coverage',
          severity: h.thesisAge > 180 ? 'medium' : 'low',
          title: `${h.symbol} thesis ${h.thesisAge}d stale`,
          detail: `Last updated ${h.thesisAge} days ago`,
        })
      }
    }

    return items.slice(0, 5)
  }, [enriched, top5Wt, posCount, sectors])

  // Concentrated names — supporting detail for the concentration signal,
  // shown as compact inline text, not counted as individual signals.
  const concentratedNames = useMemo(
    () => enriched.filter(h => h.weight > 15).slice(0, 5),
    [enriched],
  )

  // ── Active work ──────────────────────────────────────────
  const recentNotes = useMemo(() => (notes || []).slice(0, 4), [notes])
  const activeWorkflows = useMemo(() =>
    (relatedProjects || [])
      .filter((p: any) => p.status !== 'completed' && p.status !== 'cancelled')
      .sort((a: any, b: any) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, 3),
    [relatedProjects],
  )

  // ── Market badge ─────────────────────────────────────────
  const isLive = marketStatus.status === 'open'
  const mktLabel = marketStatus.status === 'open' ? 'Live'
    : marketStatus.status === 'pre-market' ? 'Pre'
    : marketStatus.status === 'after-hours' ? 'After'
    : 'Closed'

  // ================================================================
  // RENDER
  // ================================================================
  return (
    <div className="space-y-2.5">

      {/* ─── KPI STRIP ─────────────────────────────────────── */}
      <div className="grid grid-cols-5 gap-px bg-gray-200 rounded-lg overflow-hidden border border-gray-200">

        {/* NAV */}
        <div className="bg-white px-3.5 py-2">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider leading-none">NAV</p>
          <p className="text-[17px] font-semibold text-gray-900 mt-1 tabular-nums leading-none">
            {fmtCcy(totalValue, { compact: true })}
          </p>
        </div>

        {/* TODAY */}
        <div className={`px-3.5 py-2 ${isLive ? 'bg-gray-50/80' : 'bg-white'}`}>
          <div className="flex items-center gap-1">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider leading-none">Today</p>
            <span className={`text-[7px] font-bold uppercase tracking-wide px-[5px] py-px rounded leading-none ${
              isLive ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-400'
            }`}>{mktLabel}</span>
          </div>
          {hasQuotes ? (
            <>
              <p className={`text-[17px] font-bold mt-1 tabular-nums leading-none ${clr(todayPnl)}`}>
                {fmtCcy(todayPnl, { sign: true, compact: true })}
              </p>
              <p className={`text-[9px] font-medium mt-0.5 tabular-nums leading-none ${clr(todayReturnPct)}`}>
                {fmtPct(todayReturnPct, { sign: true })}
              </p>
            </>
          ) : (
            <p className="text-[17px] font-semibold text-gray-300 mt-1 tabular-nums leading-none">&mdash;</p>
          )}
        </div>

        {/* YTD P&L */}
        <div className="bg-white px-3.5 py-2">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider leading-none">YTD P&L</p>
          <p className={`text-[17px] font-semibold mt-1 tabular-nums leading-none ${clr(ytdPnl)}`}>
            {fmtCcy(ytdPnl, { sign: true, compact: true })}
          </p>
        </div>

        {/* YTD Return */}
        <div className="bg-white px-3.5 py-2">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider leading-none">YTD Return</p>
          <p className={`text-[17px] font-semibold mt-1 tabular-nums leading-none ${clr(ytdReturnPct)}`}>
            {fmtPct(ytdReturnPct, { sign: true })}
          </p>
        </div>

        {/* Positions */}
        <div className="bg-white px-3.5 py-2">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider leading-none">Positions</p>
          <div className="flex items-baseline gap-1.5 mt-1">
            <p className="text-[17px] font-semibold text-gray-900 tabular-nums leading-none">{posCount}</p>
            {portfolio.benchmark && (
              <p className="text-[9px] text-gray-400 truncate leading-none">vs {portfolio.benchmark}</p>
            )}
          </div>
        </div>
      </div>

      {/* ─── SIGNALS + MOVERS ──────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-2.5">

        {/* Portfolio Signals — single unified system, 3 cols */}
        <div className="lg:col-span-3">
          {signals.length > 0 ? (
            <div className="border border-gray-200 rounded overflow-hidden">
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-50 border-b border-gray-200">
                <AlertTriangle className="w-3 h-3 text-amber-500" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Portfolio Signals</span>
                <span className="text-[9px] font-bold px-1.5 py-px rounded-full tabular-nums bg-amber-100 text-amber-700">
                  {signals.length}
                </span>
              </div>

              {/* Signal rows */}
              <div className="divide-y divide-gray-100">
                {signals.map(s => (
                  <div
                    key={s.id}
                    className={`flex items-start gap-2 px-2.5 py-1.5 border-l-[3px] ${
                      s.severity === 'high' ? 'border-l-red-500 bg-red-50/30' :
                      s.severity === 'medium' ? 'border-l-amber-400' :
                      'border-l-gray-300'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className={`text-[11px] font-semibold leading-tight ${s.severity === 'high' ? 'text-red-800' : 'text-gray-800'}`}>
                        {s.title}
                      </p>
                      <p className="text-[10px] text-gray-500 leading-snug">{s.detail}</p>
                    </div>
                    <span className="shrink-0 text-[8px] font-bold uppercase px-1.5 py-0.5 rounded bg-gray-100 text-gray-400 mt-px">
                      {s.tag}
                    </span>
                  </div>
                ))}
              </div>

              {/* Concentration detail — compact supporting row */}
              {concentratedNames.length > 1 && (
                <div className="px-2.5 py-0.5 border-t border-gray-100">
                  <p className="text-[8px] text-gray-400/80 leading-snug">
                    <span className="font-medium">Largest weights:</span>
                    {' '}{concentratedNames.map(h => `${h.symbol} ${h.weight.toFixed(1)}%`).join(' · ')}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 border border-gray-200 rounded h-full">
              <Activity className="w-3 h-3 text-emerald-500" />
              <span className="text-[10px] text-gray-500">No signals — portfolio looks healthy</span>
            </div>
          )}
        </div>

        {/* Today's Movers — 2 cols */}
        <div className="lg:col-span-2">
          <div className="border border-gray-200 rounded overflow-hidden h-full flex flex-col">
            <div className="px-2.5 py-1 bg-gray-50 border-b border-gray-200">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Today's Movers</span>
            </div>
            {hasQuotes && enriched.length > 0 ? (
              <div className="flex-1 grid grid-cols-2 divide-x divide-gray-100">
                <div className="px-2.5 py-1.5">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-emerald-500 mb-0.5">Contributors</p>
                  {contributors.length > 0 && (
                    <div className="flex items-center py-px mb-px">
                      <span className="text-[8px] font-medium text-gray-400 uppercase w-12">Ticker</span>
                      <span className="text-[8px] font-medium text-gray-400 uppercase ml-auto">Chg%</span>
                      <span className="text-[8px] font-medium text-gray-400 uppercase w-16 text-right">P&L</span>
                    </div>
                  )}
                  {contributors.length > 0 ? contributors.map(h => (
                    <div key={h.symbol} className="flex items-center py-px">
                      <span className="text-[11px] font-semibold text-gray-900 w-12 tabular-nums">{h.symbol}</span>
                      <span className="text-[10px] text-emerald-600 tabular-nums ml-auto">{fmtPct(h.dayChangePct, { sign: true })}</span>
                      <span className="text-[10px] font-semibold text-emerald-600 tabular-nums w-16 text-right">{fmtCcy(h.dayPnl, { sign: true, compact: true })}</span>
                    </div>
                  )) : (
                    <p className="text-[10px] text-gray-400 py-px">None</p>
                  )}
                </div>
                <div className="px-2.5 py-1.5">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-red-400 mb-0.5">Detractors</p>
                  {detractors.length > 0 && (
                    <div className="flex items-center py-px mb-px">
                      <span className="text-[8px] font-medium text-gray-400 uppercase w-12">Ticker</span>
                      <span className="text-[8px] font-medium text-gray-400 uppercase ml-auto">Chg%</span>
                      <span className="text-[8px] font-medium text-gray-400 uppercase w-16 text-right">P&L</span>
                    </div>
                  )}
                  {detractors.length > 0 ? detractors.map(h => (
                    <div key={h.symbol} className="flex items-center py-px">
                      <span className="text-[11px] font-semibold text-gray-900 w-12 tabular-nums">{h.symbol}</span>
                      <span className="text-[10px] text-red-500 tabular-nums ml-auto">{fmtPct(h.dayChangePct, { sign: true })}</span>
                      <span className="text-[10px] font-semibold text-red-500 tabular-nums w-16 text-right">{fmtCcy(h.dayPnl, { sign: true, compact: true })}</span>
                    </div>
                  )) : (
                    <p className="text-[10px] text-gray-400 py-px">None</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center py-3">
                <p className="text-[10px] text-gray-400">
                  {!hasQuotes ? 'Loading market data...' : 'No positions to track'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── COMPOSITION ───────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">

        {/* Largest Positions */}
        <div className="border border-gray-200 rounded overflow-hidden">
          <div className="flex items-center justify-between px-2.5 py-1 bg-gray-50 border-b border-gray-200">
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Largest Positions</span>
            <button
              onClick={() => onNavigateToTab('positions')}
              className="text-[10px] font-medium text-primary-600 hover:text-primary-700 flex items-center gap-0.5"
            >
              All <ArrowRight className="w-2.5 h-2.5" />
            </button>
          </div>
          {enriched.length > 0 ? (
            <div>
              {enriched.slice(0, 5).map(h => (
                <div key={h.symbol} className="flex items-center gap-2 px-2.5 py-[5px]">
                  <span className="text-[11px] font-semibold text-gray-900 w-12">{h.symbol}</span>
                  <div className="flex-1 h-[3px] bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary-500/70 rounded-full"
                      style={{ width: `${Math.min(h.weight * 2, 100)}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-medium text-gray-700 w-10 text-right tabular-nums shrink-0">
                    {h.weight.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-3 py-4 text-center text-[10px] text-gray-400">No positions</div>
          )}
        </div>

        {/* Sector Allocation */}
        <div className="border border-gray-200 rounded overflow-hidden">
          <div className="px-2.5 py-1 bg-gray-50 border-b border-gray-200">
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Sector Allocation</span>
          </div>
          {sectors.length > 0 ? (
            <div>
              {sectors.map((s, i) => (
                <div key={s.sector} className="flex items-center gap-1.5 px-2.5 py-[5px]">
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${SEC_CLR[i % SEC_CLR.length]}`} />
                  <span className="text-[11px] text-gray-700 truncate flex-1 min-w-0">{s.sector}</span>
                  <div className="w-14 h-[3px] bg-gray-100 rounded-full overflow-hidden shrink-0">
                    <div
                      className={`h-full rounded-full ${SEC_CLR[i % SEC_CLR.length]}`}
                      style={{ width: `${Math.min(s.weight, 100)}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-medium text-gray-700 w-10 text-right tabular-nums shrink-0">
                    {s.weight.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-3 py-4 text-center text-[10px] text-gray-400">No positions</div>
          )}
        </div>
      </div>

      {/* ─── ACTIVE WORK ───────────────────────────────────── */}
      {(recentNotes.length > 0 || activeWorkflows.length > 0) && (
        <div className="border border-gray-200 rounded overflow-hidden">
          <div className="flex items-center justify-between px-2.5 py-1 bg-gray-50 border-b border-gray-200">
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Active Work</span>
            <div className="flex items-center gap-1.5">
              {recentNotes.length > 0 && (
                <button onClick={() => onNavigateToTab('log')} className="text-[9px] font-medium text-primary-600 hover:text-primary-700">
                  View Log
                </button>
              )}
              {activeWorkflows.length > 0 && (
                <button onClick={() => onNavigateToTab('processes')} className="text-[9px] font-medium text-primary-600 hover:text-primary-700">
                  All Processes
                </button>
              )}
            </div>
          </div>

          <div className="divide-y divide-gray-100">
            {activeWorkflows.map((proj: any) => {
              const dels = proj.project_deliverables || []
              const done = dels.filter((d: any) => d.completed).length
              const total = dels.length
              const overdue = proj.due_date && new Date(proj.due_date) < new Date() && proj.status !== 'completed'
              const pct = total > 0 ? Math.round((done / total) * 100) : 0

              return (
                <div
                  key={proj.id}
                  className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-gray-50/80 cursor-pointer"
                  onClick={() => onNavigateToTab('processes')}
                >
                  <FolderKanban className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-[11px] font-semibold text-gray-900 truncate">{proj.title}</p>
                      <span className={`text-[8px] font-bold uppercase px-1 py-px rounded leading-none ${
                        proj.status === 'in_progress' ? 'bg-blue-50 text-blue-600' :
                        proj.status === 'review' ? 'bg-amber-50 text-amber-600' :
                        'bg-gray-100 text-gray-500'
                      }`}>{(proj.status || '').replace('_', ' ')}</span>
                    </div>
                    {total > 0 && (
                      <div className="flex items-center gap-1.5 mt-px">
                        <div className="w-14 h-[2px] bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-violet-400 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[9px] text-gray-400 tabular-nums">{done}/{total}</span>
                      </div>
                    )}
                  </div>
                  {overdue && (
                    <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-red-50 text-red-600 uppercase shrink-0">Overdue</span>
                  )}
                  {!overdue && proj.due_date && (
                    <span className="text-[9px] text-gray-400 shrink-0">{formatDistanceToNow(new Date(proj.due_date), { addSuffix: true })}</span>
                  )}
                </div>
              )
            })}

            {recentNotes.map((note: any) => (
              <div
                key={note.id}
                className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-gray-50/80 cursor-pointer"
                onClick={() => onNavigateToTab('log')}
              >
                <FileText className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-[11px] font-semibold text-gray-900 truncate">{note.title}</p>
                    <span className="text-[8px] font-bold uppercase px-1 py-px rounded bg-gray-100 text-gray-500 leading-none">
                      {workLabel(note.note_type)}
                    </span>
                  </div>
                  <p className="text-[9px] text-gray-400 mt-px leading-none">
                    {formatDistanceToNow(new Date(note.updated_at || 0), { addSuffix: true })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {recentNotes.length === 0 && activeWorkflows.length === 0 && (
        <div className="flex items-center justify-between px-2.5 py-1.5 border border-dashed border-gray-200 rounded">
          <span className="text-[10px] text-gray-400">No recent log entries or processes</span>
          <div className="flex items-center gap-1.5">
            <button onClick={() => onNavigateToTab('log')} className="text-[10px] font-medium text-primary-600 hover:text-primary-700">New Entry</button>
            <span className="text-gray-300">&middot;</span>
            <button onClick={() => onNavigateToTab('processes')} className="text-[10px] font-medium text-primary-600 hover:text-primary-700">New Process</button>
          </div>
        </div>
      )}

      {/* ─── INVESTABLE UNIVERSE ───────────────────────────── */}
      {combinedUniverseAssets.total > 0 && (
        <button
          onClick={() => onNavigateToTab('universe')}
          className="flex items-center gap-1 w-full px-2.5 py-1 text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
        >
          <span>Investable Universe</span>
          <span className="text-gray-300">&middot;</span>
          <span className="tabular-nums">{combinedUniverseAssets.total} assets</span>
          <span className="text-gray-300">&middot;</span>
          <span className="font-medium text-gray-500">Manage</span>
          <ChevronRight className="w-2.5 h-2.5 ml-auto" />
        </button>
      )}
    </div>
  )
}
