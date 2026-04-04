/**
 * PortfolioCommandCenter — Opinionated portfolio command center.
 *
 * Leads with POV, not data:
 *   1. Narrative bar — what matters and what to do
 *   2. Top priorities — ranked actions
 *   3. Attention clusters — at-risk / stale / opportunity
 *   4. Workstreams — decisions / pipeline / research
 *   5. Holdings table — with status + "why it matters"
 *   6. Quick actions
 */

import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  Clock,
  TrendingUp,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  ExternalLink,
  FlaskConical,
  Scale,
  Lightbulb,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { CockpitViewModel } from '../../types/cockpit'
import type { DashboardItem } from '../../types/dashboard-item'
import {
  classifyAllHoldings,
  getPortfolioAttentionGroups,
  getPortfolioWorkItems,
  generatePortfolioNarrative,
  getPortfolioTopPriorities,
  type ClassifiedHolding,
  type PortfolioAttentionGroup,
  type PortfolioWorkItem,
  type PortfolioPriority,
  type PortfolioNarrative,
  type HoldingStatus,
} from '../../lib/dashboard/portfolioIntelligence'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PortfolioCommandCenterProps {
  portfolioId: string
  portfolioName: string
  viewModel: CockpitViewModel
  onItemClick?: (item: DashboardItem) => void
  onNavigate?: (detail: any) => void
}

// ---------------------------------------------------------------------------
// Status colors
// ---------------------------------------------------------------------------

const STATUS_STYLE: Record<HoldingStatus, { text: string; bg: string; label: string }> = {
  'at-risk': { text: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/20', label: 'At Risk' },
  stale: { text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20', label: 'Stale' },
  opportunity: { text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20', label: 'Opportunity' },
  ok: { text: 'text-gray-500 dark:text-gray-400', bg: '', label: 'OK' },
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PortfolioCommandCenter({
  portfolioId,
  portfolioName,
  viewModel,
  onItemClick,
  onNavigate,
}: PortfolioCommandCenterProps) {
  const { data: rawHoldings, isLoading } = useQuery({
    queryKey: ['portfolio-holdings', portfolioId],
    enabled: !!portfolioId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_holdings')
        .select(`*, assets(id, symbol, company_name, sector, industry, thesis, process_stage, updated_at)`)
        .eq('portfolio_id', portfolioId)
        .order('date', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  const portfolioItems = useMemo(() => {
    const all = [
      ...viewModel.decide.stacks.flatMap(s => s.itemsAll),
      ...viewModel.advance.stacks.flatMap(s => s.itemsAll),
      ...viewModel.aware.stacks.flatMap(s => s.itemsAll),
    ]
    return all.filter(i => i.portfolio?.id === portfolioId)
  }, [viewModel, portfolioId])

  const classified = useMemo(() => {
    if (!rawHoldings || rawHoldings.length === 0) return []
    return classifyAllHoldings(rawHoldings, portfolioItems)
  }, [rawHoldings, portfolioItems])

  const attentionGroups = useMemo(() => getPortfolioAttentionGroups(classified), [classified])
  const workItems = useMemo(() => getPortfolioWorkItems(viewModel, portfolioId), [viewModel, portfolioId])
  const narrative = useMemo(() => generatePortfolioNarrative(classified, workItems), [classified, workItems])
  const priorities = useMemo(() => getPortfolioTopPriorities(classified, workItems), [classified, workItems])

  const stats = useMemo(() => {
    const totalValue = classified.reduce((s, h) => s + h.marketValue, 0)
    // Exclude cash-like from return calc (they have returnPct = 0 and unrealizedPnl = 0)
    const nonCash = classified.filter(h => h.returnPct !== 0 || h.unrealizedPnl !== 0 || (h.cost > 0 && h.price > 0))
    const totalCost = nonCash.reduce((s, h) => s + h.shares * h.cost, 0)
    const nonCashValue = nonCash.reduce((s, h) => s + h.marketValue, 0)
    const rawReturn = totalCost > 0 && nonCashValue > 0 ? ((nonCashValue - totalCost) / totalCost) * 100 : 0
    const returnPct = rawReturn <= -99.9 ? 0 : rawReturn
    const atRiskCount = classified.filter(h => h.status === 'at-risk').length
    const staleCount = classified.filter(h => h.status === 'stale').length
    return { totalValue, returnPct, holdingsCount: classified.length, atRiskCount, staleCount }
  }, [classified])

  if (isLoading) {
    return (
      <div className="space-y-2">
        <div className="h-[52px] bg-gray-50 dark:bg-gray-800/40 rounded-lg animate-pulse" />
        <div className="h-[80px] bg-gray-50 dark:bg-gray-800/40 rounded-lg animate-pulse" />
      </div>
    )
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
      {/* 1. Snapshot + Narrative — combined header */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden">
        {/* Snapshot row */}
        <div className="px-4 py-2.5 flex items-center justify-between border-b border-gray-100 dark:border-gray-700/40">
          <div className="flex items-center gap-3">
            <h2 className="text-[15px] font-bold text-gray-900 dark:text-gray-50">{portfolioName}</h2>
            <span className="text-[11px] text-gray-400 dark:text-gray-500 tabular-nums">{stats.holdingsCount} positions</span>
            <span className="text-[12px] font-medium text-gray-600 dark:text-gray-300 tabular-nums">
              {stats.totalValue >= 1_000_000 ? `$${(stats.totalValue / 1_000_000).toFixed(1)}M` : `$${(stats.totalValue / 1000).toFixed(0)}k`}
            </span>
            <span className={clsx('text-[12px] font-bold tabular-nums', stats.returnPct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
              {stats.returnPct >= 0 ? '+' : ''}{stats.returnPct.toFixed(1)}%
            </span>
            {stats.atRiskCount > 0 && <span className="text-[10px] font-bold text-red-600 dark:text-red-400">{stats.atRiskCount} at risk</span>}
            {stats.staleCount > 0 && <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400">{stats.staleCount} stale</span>}
          </div>
          <button onClick={() => onNavigate?.({ id: portfolioId, title: portfolioName, type: 'portfolio', data: { id: portfolioId, name: portfolioName } })} className="flex items-center gap-1 text-[10px] font-medium text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            Full view <ExternalLink className="w-3 h-3" />
          </button>
        </div>

        {/* Narrative bar */}
        <div className="px-4 py-2.5">
          <p className="text-[12px] font-medium text-gray-800 dark:text-gray-100 leading-snug">
            {narrative.summary}
          </p>
          {narrative.callout && (
            <p className="text-[11px] text-red-600/80 dark:text-red-400/70 leading-snug mt-0.5">
              {narrative.callout}
            </p>
          )}
          {narrative.focus && (
            <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug mt-0.5 italic">
              {narrative.focus}
            </p>
          )}
        </div>
      </div>

      {/* 2. Top Priorities */}
      {priorities.length > 0 && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden">
          <div className="px-3.5 py-2 border-b border-gray-100 dark:border-gray-700/40 flex items-center gap-2">
            <Lightbulb className="w-3 h-3 text-amber-500" />
            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Top Priorities
            </span>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-gray-700/30">
            {priorities.map(p => (
              <div
                key={p.id}
                onClick={p.onClick}
                className={clsx(
                  'flex items-center gap-2.5 px-3.5 py-[6px] group transition-colors',
                  p.onClick && 'cursor-pointer',
                  'hover:bg-gray-50/60 dark:hover:bg-gray-700/30',
                )}
              >
                <span className={clsx(
                  'shrink-0 text-[12px] font-bold tabular-nums w-[16px]',
                  p.severity === 'critical' ? 'text-red-500 dark:text-red-400'
                    : p.severity === 'warning' ? 'text-amber-500 dark:text-amber-400'
                      : 'text-gray-400 dark:text-gray-500',
                )}>
                  {p.rank}
                </span>
                <span className="text-[12px] font-semibold text-gray-800 dark:text-gray-100 truncate">
                  {p.action}
                </span>
                <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                  {p.reason}
                </span>
                {p.onClick && (
                  <ArrowRight className="w-3 h-3 text-gray-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 shrink-0 ml-auto" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. Attention Clusters + Workstreams — side by side */}
      <div className={clsx(
        'grid gap-2',
        attentionGroups.length > 0 && workItems.length > 0 ? 'lg:grid-cols-[1fr_300px]' : 'grid-cols-1',
      )}>
        {/* Attention clusters */}
        {attentionGroups.length > 0 && (
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden">
            <div className="px-3.5 py-2 border-b border-gray-100 dark:border-gray-700/40">
              <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Needs Attention
              </span>
            </div>
            <div className="divide-y divide-gray-50 dark:divide-gray-700/30">
              {attentionGroups.map(group => (
                <div key={group.status}>
                  <div className="flex items-center gap-2 px-3.5 py-1.5 bg-gray-50/40 dark:bg-gray-800/30">
                    {group.status === 'at-risk' && <AlertTriangle className="w-3 h-3 text-red-500" />}
                    {group.status === 'stale' && <Clock className="w-3 h-3 text-amber-500" />}
                    {group.status === 'opportunity' && <TrendingUp className="w-3 h-3 text-emerald-500" />}
                    <span className={clsx('text-[10px] font-bold uppercase tracking-wider', STATUS_STYLE[group.status].text)}>
                      {group.label}
                    </span>
                    <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 tabular-nums">{group.holdings.length}</span>
                  </div>
                  {group.holdings.map(h => (
                    <div
                      key={h.assetId}
                      onClick={() => onNavigate?.({ id: h.assetId, title: h.symbol, type: 'asset', data: { id: h.assetId, symbol: h.symbol } })}
                      className="flex items-center gap-2 px-3.5 py-[5px] cursor-pointer hover:bg-gray-50/60 dark:hover:bg-gray-700/30 transition-colors"
                    >
                      <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400 w-[44px] shrink-0">{h.symbol}</span>
                      <span className="text-[10px] text-gray-400 tabular-nums w-[36px] shrink-0">{h.weight.toFixed(1)}%</span>
                      <span className={clsx('text-[10px] font-bold tabular-nums w-[40px] shrink-0', h.returnPct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                        {h.returnPct >= 0 ? '+' : ''}{h.returnPct.toFixed(0)}%
                      </span>
                      <span className="flex-1 text-[10px] text-gray-500 dark:text-gray-400 truncate">{h.statusReason}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Workstreams */}
        {workItems.length > 0 && (
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden flex flex-col">
            <div className="px-3.5 py-2 border-b border-gray-100 dark:border-gray-700/40">
              <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Active Work
              </span>
            </div>
            <div className="divide-y divide-gray-50 dark:divide-gray-700/30 flex-1">
              {/* Group by type */}
              {(['decision', 'idea', 'research'] as const).map(type => {
                const typeItems = workItems.filter(w => w.type === type)
                if (typeItems.length === 0) return null
                const typeLabel = type === 'decision' ? 'Decisions' : type === 'idea' ? 'Pipeline' : 'Research'
                const Icon = type === 'decision' ? Scale : type === 'idea' ? FlaskConical : Clock
                return (
                  <div key={type}>
                    <div className="flex items-center gap-1.5 px-3.5 py-1 bg-gray-50/30 dark:bg-gray-800/20">
                      <Icon className="w-3 h-3 text-gray-400 dark:text-gray-500" />
                      <span className="text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{typeLabel}</span>
                    </div>
                    {typeItems.map(w => (
                      <div
                        key={w.id}
                        onClick={w.onClick}
                        className="flex items-center gap-2 px-3.5 py-[4px] cursor-pointer hover:bg-gray-50/60 dark:hover:bg-gray-700/30 transition-colors group"
                      >
                        <span className="text-[11px] font-medium text-gray-700 dark:text-gray-200 truncate">{w.title}</span>
                        <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0">{w.reason}</span>
                        <span className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums shrink-0">{w.age}d</span>
                        <ArrowRight className="w-3 h-3 text-gray-300 opacity-0 group-hover:opacity-100 shrink-0" />
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* 4. Holdings Table */}
      <HoldingsTable holdings={classified} onNavigate={onNavigate} />

      {/* 5. Quick Actions */}
      <div className="flex items-center gap-1.5">
        {[
          { label: 'Full portfolio', onClick: () => onNavigate?.({ id: portfolioId, title: portfolioName, type: 'portfolio', data: { id: portfolioId, name: portfolioName } }) },
          { label: 'Idea pipeline', onClick: () => onNavigate?.({ id: 'trade-queue', title: 'Idea Pipeline', type: 'trade-queue' }) },
          { label: 'Trade lab', onClick: () => window.dispatchEvent(new CustomEvent('openTradeLab', { detail: { portfolioId } })) },
        ].map(a => (
          <button key={a.label} onClick={a.onClick} className="text-[10px] font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 px-2.5 py-1 rounded-md border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
            {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// HoldingsTable
// ---------------------------------------------------------------------------

function HoldingsTable({ holdings, onNavigate }: { holdings: ClassifiedHolding[]; onNavigate?: (d: any) => void }) {
  const [expanded, setExpanded] = useState(false)
  const PREVIEW = 10
  const visible = expanded ? holdings : holdings.slice(0, PREVIEW)
  const hasMore = holdings.length > PREVIEW

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden">
      <div className="px-3.5 py-2 border-b border-gray-100 dark:border-gray-700/40 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Holdings</span>
        <span className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">{holdings.length} positions</span>
      </div>

      {/* Header */}
      <div className="flex items-center gap-2 px-3.5 py-1.5 border-b border-gray-100 dark:border-gray-700/40 text-[9px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
        <span className="w-[44px]">Ticker</span>
        <span className="w-[36px] text-right">Wt%</span>
        <span className="w-[48px] text-right">Return</span>
        <span className="w-[52px]">Status</span>
        <span className="flex-1">Why it matters</span>
      </div>

      <div className="divide-y divide-gray-50 dark:divide-gray-700/20">
        {visible.map(h => {
          const style = STATUS_STYLE[h.status]
          // Build "why it matters" from status + related items
          let whyMatters = ''
          if (h.status === 'at-risk') {
            whyMatters = h.statusReason
          } else if (h.status === 'stale') {
            whyMatters = h.statusReason
          } else if (h.status === 'opportunity') {
            whyMatters = h.statusReason
          } else if (h.relatedItems.length > 0) {
            whyMatters = `${h.relatedItems.length} active item${h.relatedItems.length !== 1 ? 's' : ''}`
          }

          return (
            <div
              key={h.assetId}
              onClick={() => onNavigate?.({ id: h.assetId, title: h.symbol, type: 'asset', data: { id: h.assetId, symbol: h.symbol } })}
              className="flex items-center gap-2 px-3.5 py-[4px] cursor-pointer hover:bg-gray-50/60 dark:hover:bg-gray-700/30 transition-colors"
            >
              <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400 w-[44px] shrink-0">{h.symbol}</span>
              <span className="text-[10px] text-gray-500 tabular-nums w-[36px] text-right shrink-0">{h.weight.toFixed(1)}</span>
              <span className={clsx('text-[10px] font-bold tabular-nums w-[48px] text-right shrink-0', h.returnPct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                {h.returnPct >= 0 ? '+' : ''}{h.returnPct.toFixed(1)}%
              </span>
              <span className="w-[52px] shrink-0">
                {h.status !== 'ok' && (
                  <span className={clsx('text-[8px] font-bold uppercase tracking-wider px-1 py-px rounded', style.text, style.bg)}>
                    {style.label}
                  </span>
                )}
              </span>
              <span className="flex-1 text-[10px] text-gray-400 dark:text-gray-500 truncate">{whyMatters}</span>
            </div>
          )
        })}
      </div>

      {hasMore && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-[10px] text-gray-400 hover:text-gray-600 border-t border-gray-100 dark:border-gray-700/40 transition-colors"
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          {expanded ? 'Show less' : `+${holdings.length - PREVIEW} more`}
        </button>
      )}
    </div>
  )
}
