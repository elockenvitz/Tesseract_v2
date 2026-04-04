/**
 * DecideBand — Decision Command Center.
 *
 * Layout:
 *   [Pressure bar — total / median / oldest / pressure level]
 *   [Decision Spotlight — #1 decision with impact + context + CTA]
 *   [Decision Stack — tiered by Critical / High / Standard]
 *   [Pipeline + Concentration — side panels]
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import { clsx } from 'clsx'
import { ChevronDown, ChevronRight, ChevronUp, ArrowDown, ArrowRight, AlertTriangle } from 'lucide-react'
import {
  rankDecisionItems,
  summarizeBottleneck,
  getDecisionContext,
  computeDecisionPressure,
  detectDecisionConcentration,
  groupByTier,
  type RankedDecisionItem,
  type DecisionPressure,
  type DecisionConcentration,
} from '../../lib/dashboard/dashboardIntelligence'
import type { CockpitViewModel } from '../../types/cockpit'
import type { ExecutionStats } from './ExecutionSnapshotCard'
import type { DashboardItem } from '../../types/dashboard-item'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readBool(key: string, fallback: boolean): boolean {
  try { const v = localStorage.getItem(key); if (v !== null) return v === 'true' } catch { /* noop */ }
  return fallback
}
function writeBool(key: string, value: boolean) {
  try { localStorage.setItem(key, String(value)) } catch { /* noop */ }
}

const ACTION_COLOR: Record<string, string> = {
  Buy: 'text-emerald-600 dark:text-emerald-400', Add: 'text-emerald-600 dark:text-emerald-400',
  Sell: 'text-red-600 dark:text-red-400', Trim: 'text-red-600 dark:text-red-400',
}
function ageColor(d: number) { return d >= 10 ? 'text-red-600 dark:text-red-400' : d >= 5 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500' }

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DecideBandProps {
  id?: string
  viewModel: CockpitViewModel
  pipelineStats: ExecutionStats
  isLoading?: boolean
  onItemClick?: (item: DashboardItem) => void
  onSnooze?: (itemId: string, hours: number) => void
  onOpenTradeQueue?: (filter?: string) => void
  onExpandedChange?: (expanded: boolean) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DecideBand({
  id, viewModel, pipelineStats, isLoading, onItemClick, onSnooze, onOpenTradeQueue, onExpandedChange,
}: DecideBandProps) {
  const storageKey = 'cockpit-band-DECIDE'
  const [expanded, setExpanded] = useState(() => readBool(storageKey, true))
  useEffect(() => { writeBool(storageKey, expanded) }, [expanded])
  useEffect(() => { onExpandedChange?.(expanded) }, [expanded, onExpandedChange])

  const ranked = useMemo(() => rankDecisionItems(viewModel), [viewModel])
  const bottleneck = useMemo(() => summarizeBottleneck(pipelineStats), [pipelineStats])
  const pressure = useMemo(() => computeDecisionPressure(viewModel), [viewModel])
  const concentration = useMemo(() => detectDecisionConcentration(viewModel), [viewModel])

  // Full queue — all items including hero (FocusStack already shows hero separately)
  const tiers = useMemo(() => groupByTier(ranked), [ranked])
  const totalCount = viewModel.decide.totalItems

  if (totalCount === 0 && !isLoading) {
    return (
      <div id={id} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden">
        <div className="flex items-center gap-2 px-3.5 py-2.5">
          <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
          <h2 className="text-[13px] font-semibold text-gray-900 dark:text-gray-50">DECIDE</h2>
          <div className="flex-1" />
          <span className="text-[11px] text-emerald-600/70 dark:text-emerald-400/60 italic">Decision queue clear.</span>
        </div>
      </div>
    )
  }

  return (
    <div id={id} className="space-y-2">
      {/* Header with pressure bar */}
      <div className="flex items-center gap-2 px-1">
        <button onClick={() => setExpanded(e => !e)} className="flex items-center gap-2 hover:bg-gray-50/50 dark:hover:bg-gray-700/20 rounded-lg px-2.5 py-1.5 transition-colors">
          {expanded ? <ChevronDown className="w-3.5 h-3.5 text-red-400" /> : <ChevronRight className="w-3.5 h-3.5 text-red-400" />}
          <h2 className="text-[13px] font-bold text-gray-900 dark:text-gray-50">DECIDE</h2>
          <span className={clsx('text-[11px] font-bold px-1.5 py-px rounded-full tabular-nums min-w-[20px] text-center', 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300')}>
            {totalCount}
          </span>
        </button>
        <div className="flex-1" />
        {/* Pressure indicators */}
        <PressureBar pressure={pressure} />
      </div>

      {expanded && (
        <div className="space-y-2">
          {/* Tiered queue + side panels */}
          <div className={clsx('grid grid-cols-1 gap-2', (ranked.length > 0) && 'lg:grid-cols-[1fr_260px]')}>
            {/* Decision stack — full queue grouped by tier */}
            {ranked.length > 0 && (
              <DecisionStack tiers={tiers} onItemClick={onItemClick} onSnooze={onSnooze} />
            )}

            {/* Side: Pipeline + Concentration */}
            <div className="flex flex-col gap-2">
              <BottleneckPanel pipelineStats={pipelineStats} bottleneck={bottleneck} onOpenTradeQueue={onOpenTradeQueue} />
              {concentration?.isConcentrated && <ConcentrationInsight concentration={concentration} />}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// PressureBar — Compact decision queue pressure
// ---------------------------------------------------------------------------

const PRESSURE_STYLE: Record<DecisionPressure['level'], { text: string; bg: string }> = {
  critical: { text: 'text-red-600 dark:text-red-400', bg: 'bg-red-100 dark:bg-red-900/30' },
  elevated: { text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-100 dark:bg-amber-900/30' },
  normal: { text: 'text-gray-500 dark:text-gray-400', bg: 'bg-gray-100 dark:bg-gray-700/40' },
  clear: { text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-100 dark:bg-emerald-900/30' },
}

function PressureBar({ pressure }: { pressure: DecisionPressure }) {
  const style = PRESSURE_STYLE[pressure.level]
  return (
    <div className="flex items-center gap-3">
      {pressure.total > 0 && (
        <>
          <span className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">
            median {pressure.medianAge}d
          </span>
          <span className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">
            oldest {pressure.oldestAge}d
          </span>
          {pressure.criticalCount > 0 && (
            <span className="text-[10px] font-bold text-red-600 dark:text-red-400 tabular-nums">
              {pressure.criticalCount} critical
            </span>
          )}
        </>
      )}
      <span className={clsx('text-[9px] font-bold uppercase tracking-wider px-1.5 py-px rounded', style.text, style.bg)}>
        {pressure.label}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DecisionStack — Tiered decision list
// ---------------------------------------------------------------------------

function DecisionStack({
  tiers, onItemClick, onSnooze,
}: {
  tiers: { critical: RankedDecisionItem[]; high: RankedDecisionItem[]; standard: RankedDecisionItem[] }
  onItemClick?: (item: DashboardItem) => void
  onSnooze?: (id: string, h: number) => void
}) {
  const [showStandard, setShowStandard] = useState(false)
  const hasCritical = tiers.critical.length > 0
  const hasHigh = tiers.high.length > 0
  const hasStandard = tiers.standard.length > 0
  const total = tiers.critical.length + tiers.high.length + tiers.standard.length

  if (total === 0) return null

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden">
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-gray-100 dark:border-gray-700/40">
        <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Decision queue</span>
        <span className="text-[11px] font-bold text-gray-400 dark:text-gray-500 tabular-nums">{total}</span>
      </div>

      {/* Critical tier */}
      {hasCritical && (
        <TierSection label="Critical" accent="text-red-600 dark:text-red-400" items={tiers.critical} onItemClick={onItemClick} onSnooze={onSnooze} />
      )}

      {/* High tier */}
      {hasHigh && (
        <TierSection label="High impact" accent="text-amber-600 dark:text-amber-400" items={tiers.high} onItemClick={onItemClick} onSnooze={onSnooze} />
      )}

      {/* Standard tier — collapsed by default */}
      {hasStandard && (
        <>
          {showStandard ? (
            <TierSection label="Standard" accent="text-gray-500 dark:text-gray-400" items={tiers.standard} onItemClick={onItemClick} onSnooze={onSnooze} />
          ) : null}
          <button
            onClick={() => setShowStandard(e => !e)}
            className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-[10px] font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 border-t border-gray-100 dark:border-gray-700/40 transition-colors"
          >
            {showStandard ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {showStandard ? 'Hide standard' : `+${tiers.standard.length} standard priority`}
          </button>
        </>
      )}
    </div>
  )
}

function TierSection({
  label, accent, items, onItemClick, onSnooze,
}: {
  label: string; accent: string; items: RankedDecisionItem[]
  onItemClick?: (item: DashboardItem) => void; onSnooze?: (id: string, h: number) => void
}) {
  return (
    <div>
      <div className="flex items-center gap-2 px-3.5 py-1 bg-gray-50/40 dark:bg-gray-800/30">
        <span className={clsx('text-[9px] font-bold uppercase tracking-wider', accent)}>{label}</span>
        <span className="text-[9px] font-bold text-gray-400 dark:text-gray-500 tabular-nums">{items.length}</span>
      </div>
      <div className="divide-y divide-gray-50 dark:divide-gray-700/20">
        {items.map(r => <DecisionRow key={r.item.id} ranked={r} onItemClick={onItemClick} onSnooze={onSnooze} />)}
      </div>
    </div>
  )
}

function DecisionRow({ ranked, onItemClick, onSnooze }: {
  ranked: RankedDecisionItem; onItemClick?: (item: DashboardItem) => void; onSnooze?: (id: string, h: number) => void
}) {
  const { item, priorityReason } = ranked
  const age = item.ageDays ?? 0
  const action = item.meta?.action
  const ticker = item.asset?.ticker
  const ctx = useMemo(() => getDecisionContext(item), [item])

  return (
    <div onClick={() => onItemClick?.(item)} className={clsx('flex items-center gap-2.5 px-3.5 py-[6px] group transition-colors', onItemClick && 'cursor-pointer', 'hover:bg-gray-50/60 dark:hover:bg-gray-700/30')}>
      <span className={clsx('shrink-0 text-[11px] font-bold tabular-nums w-[22px] text-right', ageColor(age))}>{age}d</span>
      {action && !item.meta?.isPairTrade && <span className={clsx('shrink-0 text-[12px] font-bold', ACTION_COLOR[action] ?? 'text-gray-500')}>{action}</span>}
      {ticker && !item.meta?.isPairTrade && <span className="shrink-0 text-[12px] font-bold text-blue-600 dark:text-blue-400">{ticker}</span>}
      {item.meta?.isPairTrade && action && <span className="shrink-0 text-[12px] font-bold text-gray-700 dark:text-gray-200 truncate max-w-[160px]">{action}</span>}
      {item.meta?.proposedWeight != null && <span className="shrink-0 text-[10px] font-bold tabular-nums text-violet-600 dark:text-violet-400">{item.meta.proposedWeight.toFixed(1)}%</span>}
      <span className="flex-1 min-w-0 text-[10px] text-gray-400 dark:text-gray-500 truncate">{ctx.whyNow}</span>
      <button onClick={(e) => { e.stopPropagation(); item.primaryAction.onClick() }} className="shrink-0 text-[10px] font-medium px-2 py-[2px] rounded bg-gray-100 dark:bg-gray-700/50 text-gray-500 hover:bg-gray-200 opacity-0 group-hover:opacity-100 transition-all">{item.primaryAction.label}</button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ConcentrationInsight
// ---------------------------------------------------------------------------

function ConcentrationInsight({ concentration }: { concentration: DecisionConcentration }) {
  return (
    <div className="rounded-lg border border-amber-200/60 dark:border-amber-800/30 bg-amber-50/20 dark:bg-amber-950/10 px-3 py-2.5">
      <div className="flex items-center gap-1.5 mb-1">
        <AlertTriangle className="w-3 h-3 text-amber-500" />
        <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">Concentration</span>
      </div>
      <p className="text-[11px] text-amber-700/80 dark:text-amber-300/70 leading-snug">
        {concentration.count} of {concentration.total} decisions in {concentration.portfolioName} — coordinate priorities.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// BottleneckPanel
// ---------------------------------------------------------------------------

const STAGE_META = {
  deciding: { label: 'Deciding', color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50/50 dark:bg-red-950/10', bar: 'bg-red-500' },
  modeling: { label: 'Modeling', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50/50 dark:bg-amber-950/10', bar: 'bg-amber-500' },
  executing: { label: 'Executing', color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50/50 dark:bg-blue-950/10', bar: 'bg-blue-500' },
} as const

function BottleneckPanel({ pipelineStats, bottleneck, onOpenTradeQueue }: {
  pipelineStats: ExecutionStats; bottleneck: ReturnType<typeof summarizeBottleneck>; onOpenTradeQueue?: (f?: string) => void
}) {
  const total = bottleneck.total
  const maxCount = Math.max(pipelineStats.stages.deciding.count, pipelineStats.stages.modeling.count, pipelineStats.stages.executing.count, 1)

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-gray-100 dark:border-gray-700/40">
        <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Pipeline</span>
        <span className="text-[11px] font-bold text-gray-400 dark:text-gray-500 tabular-nums">{total} active</span>
      </div>
      {total === 0 ? (
        <div className="flex-1 flex items-center justify-center px-3 py-4 text-[11px] text-gray-400">Pipeline clear</div>
      ) : (
        <div className="flex-1 p-2.5 space-y-0.5">
          {(['modeling', 'deciding', 'executing'] as const).map((stage, idx) => {
            const detail = pipelineStats.stages[stage]
            const meta = STAGE_META[stage]
            const isBn = bottleneck.stage === stage
            const bw = detail.count > 0 ? Math.max((detail.count / maxCount) * 100, 8) : 0
            return (
              <div key={stage}>
                <button onClick={() => onOpenTradeQueue?.(stage)} className={clsx('w-full text-left px-2.5 py-1.5 rounded-md transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/30', isBn && !bottleneck.isHealthy && meta.bg)}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className={clsx('text-[12px] font-semibold', detail.count > 0 ? meta.color : 'text-gray-400')}>{meta.label}</span>
                      {isBn && !bottleneck.isHealthy && <span className="text-[8px] font-bold uppercase tracking-wider text-red-500">Bottleneck</span>}
                    </div>
                    <span className={clsx('text-[14px] font-bold tabular-nums', detail.count > 0 ? meta.color : 'text-gray-300 dark:text-gray-600')}>{detail.count}</span>
                  </div>
                  <div className="h-1 bg-gray-100 dark:bg-gray-700/50 rounded-full overflow-hidden">
                    <div className={clsx('h-full rounded-full transition-all', meta.bar)} style={{ width: `${bw}%` }} />
                  </div>
                  {detail.medianDays != null && detail.count > 0 && (
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[9px] text-gray-400 tabular-nums">Median {detail.medianDays}d</span>
                      {detail.oldestDays != null && detail.oldestDays > 0 && (
                        <span className={clsx('text-[9px] tabular-nums', detail.oldestDays >= 7 ? 'text-amber-500 font-semibold' : 'text-gray-400')}>Oldest {detail.oldestDays}d</span>
                      )}
                    </div>
                  )}
                </button>
                {idx < 2 && <div className="flex justify-center py-0.5"><ArrowDown className="w-3 h-3 text-gray-300 dark:text-gray-600" /></div>}
              </div>
            )
          })}
        </div>
      )}
      <div className="border-t border-gray-100 dark:border-gray-700/40 px-3 py-1.5 flex items-center justify-between">
        <span className={clsx('text-[10px] font-medium italic', !bottleneck.isHealthy ? 'text-red-500/80' : 'text-gray-400')}>
          {!bottleneck.isHealthy ? `${bottleneck.label} is the bottleneck` : total > 0 ? 'Flow healthy' : 'Pipeline clear'}
        </span>
        <button onClick={() => onOpenTradeQueue?.()} className="text-[10px] font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 transition-colors">Open queue &rarr;</button>
      </div>
    </div>
  )
}
