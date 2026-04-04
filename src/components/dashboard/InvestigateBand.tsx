/**
 * InvestigateBand — Proactive opportunity/discovery section.
 *
 * Distinct visual treatment: violet-tinged, exploratory feel.
 * Shows system flags, team prompts, anomalies, and items worth
 * examining that don't yet require action.
 *
 * When empty, shows an aspirational empty state rather than
 * a broken-looking void.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { clsx } from 'clsx'
import { ChevronDown, ChevronRight, Compass, ArrowRight, TrendingDown, Clock, FileText, Activity } from 'lucide-react'
import type { CockpitBandData, CockpitStack, CockpitViewModel } from '../../types/cockpit'
import type { DashboardItem } from '../../types/dashboard-item'

// ---------------------------------------------------------------------------
// LocalStorage
// ---------------------------------------------------------------------------

function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    if (v !== null) return v === 'true'
  } catch { /* noop */ }
  return fallback
}

function writeBool(key: string, value: boolean) {
  try { localStorage.setItem(key, String(value)) } catch { /* noop */ }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface InvestigateBandProps {
  id?: string
  bandData: CockpitBandData
  viewModel?: CockpitViewModel
  onItemClick?: (item: DashboardItem) => void
  onScrollToBand?: (band: string) => void
}

// ---------------------------------------------------------------------------
// Synthetic insight — derived from viewModel when no real items exist
// ---------------------------------------------------------------------------

interface SyntheticInsight {
  id: string
  icon: React.FC<{ className?: string }>
  title: string
  detail: string
  onClick?: () => void
}

function buildSyntheticInsights(
  viewModel: CockpitViewModel | undefined,
  onScrollToBand?: (band: string) => void,
): SyntheticInsight[] {
  if (!viewModel) return []
  const insights: SyntheticInsight[] = []

  // 1. Stale thesis coverage — positions with outdated research
  const thesisStack = viewModel.advance.stacks.find(s => s.kind === 'thesis')
  if (thesisStack && thesisStack.count > 0) {
    const critical = thesisStack.itemsAll.filter(i => i.severity === 'HIGH')
    const tickers = critical.slice(0, 3).map(i => i.asset?.ticker).filter(Boolean).join(', ')
    insights.push({
      id: 'stale-coverage',
      icon: FileText,
      title: `${thesisStack.count} thesis${thesisStack.count !== 1 ? 'es' : ''} beyond review window`,
      detail: tickers ? `Blind spot risk: ${tickers}${critical.length > 3 ? ` +${critical.length - 3}` : ''}` : `Oldest: ${thesisStack.oldestAgeDays}d without review`,
      onClick: () => onScrollToBand?.('ADVANCE'),
    })
  }

  // 2. Decisions aging toward threshold — items between 5-9d (not yet in DECIDE red zone)
  const allDecideItems = viewModel.decide.stacks.flatMap(s => s.itemsAll)
  const nearThreshold = allDecideItems.filter(i => {
    const age = i.ageDays ?? 0
    return age >= 5 && age < 10 && i.severity !== 'HIGH'
  })
  if (nearThreshold.length > 0) {
    const tickers = nearThreshold.slice(0, 3).map(i => i.asset?.ticker || i.title).filter(Boolean).join(', ')
    insights.push({
      id: 'aging-watch',
      icon: Clock,
      title: `${nearThreshold.length} decision${nearThreshold.length !== 1 ? 's' : ''} approaching aging threshold`,
      detail: tickers,
      onClick: () => onScrollToBand?.('DECIDE'),
    })
  }

  // 3. Ideas sitting in pipeline without progress
  const simStack = viewModel.advance.stacks.find(s => s.kind === 'simulation')
  if (simStack && simStack.count > 0 && simStack.oldestAgeDays > 5) {
    insights.push({
      id: 'pipeline-ideas',
      icon: Activity,
      title: `${simStack.count} idea${simStack.count !== 1 ? 's' : ''} idle in pipeline`,
      detail: `Oldest: ${simStack.oldestAgeDays}d — advance or discard`,
    })
  }

  // 4. Overdue deliverables as research risk
  const delivStack = viewModel.advance.stacks.find(s => s.kind === 'deliverable')
  const overdueDelivs = delivStack?.itemsAll.filter(i => i.meta?.overdueDays != null && i.meta.overdueDays > 7) ?? []
  if (overdueDelivs.length > 0) {
    insights.push({
      id: 'research-lag',
      icon: TrendingDown,
      title: `${overdueDelivs.length} deliverable${overdueDelivs.length !== 1 ? 's' : ''} significantly overdue`,
      detail: 'Research process may be degrading decision quality',
      onClick: () => onScrollToBand?.('ADVANCE'),
    })
  }

  // 5. High concentration of decisions in one portfolio
  const portfolioCounts = new Map<string, number>()
  for (const item of allDecideItems) {
    if (item.portfolio?.name) {
      portfolioCounts.set(item.portfolio.name, (portfolioCounts.get(item.portfolio.name) ?? 0) + 1)
    }
  }
  const topPortfolio = [...portfolioCounts.entries()].sort((a, b) => b[1] - a[1])[0]
  if (topPortfolio && topPortfolio[1] >= 3 && allDecideItems.length >= 4) {
    insights.push({
      id: 'concentration',
      icon: TrendingDown,
      title: `${topPortfolio[1]} of ${allDecideItems.length} decisions concentrated in ${topPortfolio[0]}`,
      detail: 'Decision bottleneck may be portfolio-specific',
    })
  }

  return insights
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InvestigateBand({ id, bandData, viewModel, onItemClick, onScrollToBand }: InvestigateBandProps) {
  const storageKey = 'cockpit-band-INVESTIGATE'
  const [expanded, setExpanded] = useState(() => readBool(storageKey, false))

  useEffect(() => { writeBool(storageKey, expanded) }, [expanded])

  const toggleExpanded = useCallback(() => setExpanded(e => !e), [])

  // Generate synthetic insights when no real investigate items exist
  const syntheticInsights = useMemo(
    () => bandData.stacks.length === 0 ? buildSyntheticInsights(viewModel, onScrollToBand) : [],
    [bandData.stacks.length, viewModel, onScrollToBand],
  )

  const hasRealItems = bandData.stacks.length > 0
  const hasSynthetics = syntheticInsights.length > 0
  const totalCount = hasRealItems ? bandData.totalItems : syntheticInsights.length

  // Truly empty — no real items and no synthetic insights
  if (!hasRealItems && !hasSynthetics) {
    return (
      <div id={id} className="rounded-lg border border-violet-100/60 dark:border-violet-900/20 bg-violet-50/10 dark:bg-violet-950/5 overflow-hidden">
        <div className="flex items-center gap-2 px-3.5 py-2">
          <Compass className="w-3.5 h-3.5 text-violet-300 dark:text-violet-600" />
          <span className="text-[12px] font-semibold text-violet-500/70 dark:text-violet-400/60">
            INVESTIGATE
          </span>
          <div className="flex-1" />
          <span className="text-[10px] text-violet-400/60 dark:text-violet-500/50 italic">
            No anomalies surfaced. System monitoring.
          </span>
        </div>
      </div>
    )
  }

  return (
    <div id={id} className="rounded-lg border border-violet-100/60 dark:border-violet-900/20 bg-violet-50/10 dark:bg-violet-950/5 overflow-hidden">
      {/* Header */}
      <button
        onClick={toggleExpanded}
        className="w-full flex items-center gap-2 px-3.5 py-2 text-left hover:bg-violet-50/20 dark:hover:bg-violet-900/10 transition-colors"
      >
        {expanded
          ? <ChevronDown className="w-3 h-3 text-violet-400 dark:text-violet-500" />
          : <ChevronRight className="w-3 h-3 text-violet-400 dark:text-violet-500" />
        }
        <Compass className="w-3.5 h-3.5 text-violet-400 dark:text-violet-500" />
        <span className="text-[12px] font-semibold text-violet-600 dark:text-violet-300">
          INVESTIGATE
        </span>
        <span className="text-[10px] text-violet-400 dark:text-violet-500">
          Worth Looking Into
        </span>
        <span className="text-[10px] font-bold text-violet-500 dark:text-violet-400 tabular-nums bg-violet-100/50 dark:bg-violet-900/30 px-1.5 py-px rounded-full">
          {totalCount}
        </span>

        {/* Inline summary when collapsed */}
        {!expanded && hasRealItems && (
          <span className="flex-1 text-[10px] text-violet-400 dark:text-violet-500 text-right truncate">
            {bandData.stacks.map(s => `${s.count} ${s.title.toLowerCase()}`).join(' \u00B7 ')}
          </span>
        )}
        {!expanded && !hasRealItems && hasSynthetics && (
          <span className="flex-1 text-[10px] text-violet-400 dark:text-violet-500 text-right truncate">
            {syntheticInsights.length} system insight{syntheticInsights.length !== 1 ? 's' : ''}
          </span>
        )}
      </button>

      {/* Content — real items */}
      {expanded && hasRealItems && (
        <div className="border-t border-violet-100/40 dark:border-violet-900/20">
          {bandData.stacks.map(stack => (
            <InvestigateStack key={stack.stackKey} stack={stack} onItemClick={onItemClick} />
          ))}
        </div>
      )}

      {/* Content — synthetic insights (when no real items) */}
      {expanded && !hasRealItems && hasSynthetics && (
        <div className="border-t border-violet-100/40 dark:border-violet-900/20 divide-y divide-violet-50/40 dark:divide-violet-900/10">
          {syntheticInsights.map(insight => (
            <SyntheticInsightRow key={insight.id} insight={insight} />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SyntheticInsightRow — System-derived insight
// ---------------------------------------------------------------------------

function SyntheticInsightRow({ insight }: { insight: SyntheticInsight }) {
  const Icon = insight.icon

  return (
    <div
      onClick={insight.onClick}
      className={clsx(
        'flex items-start gap-2.5 px-3.5 py-2 group',
        insight.onClick && 'cursor-pointer',
        'hover:bg-violet-50/20 dark:hover:bg-violet-900/10 transition-colors',
      )}
    >
      <Icon className="w-3.5 h-3.5 mt-[1px] shrink-0 text-violet-400 dark:text-violet-500" />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-medium text-violet-700 dark:text-violet-300">
          {insight.title}
        </div>
        <div className="text-[10px] text-violet-400 dark:text-violet-500 mt-0.5">
          {insight.detail}
        </div>
      </div>
      {insight.onClick && (
        <ArrowRight className="w-3 h-3 mt-[2px] shrink-0 text-violet-300 dark:text-violet-600 opacity-0 group-hover:opacity-100 transition-opacity" />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// InvestigateStack
// ---------------------------------------------------------------------------

function InvestigateStack({
  stack,
  onItemClick,
}: {
  stack: CockpitStack
  onItemClick?: (item: DashboardItem) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const previewCount = 3
  const visible = showAll ? stack.itemsAll : stack.itemsAll.slice(0, previewCount)

  return (
    <div className="border-b border-violet-50/60 dark:border-violet-900/10 last:border-b-0">
      {/* Stack label */}
      <div className="flex items-center gap-2 px-3.5 py-1.5">
        <span className="text-[10px] font-semibold text-violet-400 dark:text-violet-500 uppercase tracking-wider">
          {stack.title}
        </span>
        <span className="text-[10px] font-bold text-violet-400 dark:text-violet-500 tabular-nums">
          {stack.count}
        </span>
        <div className="flex-1" />
        <button
          onClick={(e) => {
            e.stopPropagation()
            stack.primaryCTA.onClick()
          }}
          className="flex items-center gap-0.5 text-[10px] font-medium text-violet-500 dark:text-violet-400 hover:text-violet-600 dark:hover:text-violet-300 transition-colors"
        >
          {stack.primaryCTA.label}
          <ArrowRight className="w-2.5 h-2.5" />
        </button>
      </div>

      {/* Items */}
      <div className="divide-y divide-violet-50/40 dark:divide-violet-900/10">
        {visible.map(item => (
          <InvestigateItemRow key={item.id} item={item} onItemClick={onItemClick} />
        ))}
      </div>

      {stack.count > previewCount && (
        <button
          onClick={() => setShowAll(e => !e)}
          className="w-full text-center py-1 text-[10px] text-violet-400 dark:text-violet-500 hover:text-violet-600 dark:hover:text-violet-300 transition-colors"
        >
          {showAll ? 'Show less' : `+${stack.count - previewCount} more`}
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// InvestigateItemRow
// ---------------------------------------------------------------------------

function InvestigateItemRow({
  item,
  onItemClick,
}: {
  item: DashboardItem
  onItemClick?: (item: DashboardItem) => void
}) {
  const handleClick = useCallback(() => {
    onItemClick?.(item)
  }, [item, onItemClick])

  return (
    <div
      onClick={handleClick}
      className={clsx(
        'flex items-center gap-2 px-3.5 py-[5px] group',
        onItemClick && 'cursor-pointer',
        'hover:bg-violet-50/20 dark:hover:bg-violet-900/10 transition-colors',
      )}
    >
      {/* Violet dot */}
      <div className="w-1.5 h-1.5 rounded-full bg-violet-300 dark:bg-violet-600 shrink-0" />

      {item.asset?.ticker && (
        <span className="shrink-0 text-[11px] font-semibold text-violet-600 dark:text-violet-400">
          {item.asset.ticker}
        </span>
      )}

      <span className="flex-1 min-w-0 text-[10px] text-gray-500 dark:text-gray-400 truncate">
        {item.title}
      </span>

      {item.portfolio?.name && (
        <span className="shrink-0 text-[9px] text-violet-400 dark:text-violet-500 whitespace-nowrap">
          {item.portfolio.name}
        </span>
      )}

      {item.ageDays != null && (
        <span className="shrink-0 text-[9px] text-violet-400 dark:text-violet-500 tabular-nums">
          {item.ageDays}d
        </span>
      )}
    </div>
  )
}
