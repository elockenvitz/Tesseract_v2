/**
 * BatchListView — Batch grouping view for the Trade Book.
 *
 * Batches are about UNDERSTANDING, not operations. Selecting a batch
 * should tell a story: what was the PM's intent, what trades made it
 * up, and where did they end up. The full operational table (filter,
 * sort, dropdowns, correction flow) lives in the Trades view for
 * detailed drilling — this view is a reading surface.
 *
 * Layout is a split: batch cards rail on the left, detail panel on the
 * right. The detail panel surfaces the batch rationale prominently,
 * shows a phase-rollup strip computed from the batch's trades, and
 * lists the trades inline in a compact read-only table. No flipping to
 * another tab, no dropdowns, no sort/filter.
 */

import React, { useMemo, useState } from 'react'
import { formatDistanceToNow, format } from 'date-fns'
import {
  Layers,
  Inbox,
  FlaskConical,
  Plus,
  ArrowRight,
  DollarSign,
  CalendarDays,
  FileText,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { clsx } from 'clsx'
import {
  tradeLifecyclePhase,
  PHASE_META,
  type LifecyclePhase,
} from '../../lib/trade-book/lifecycle'
import { ReasonBlock } from './AcceptedTradesTable'
import type {
  TradeBatch,
  AcceptedTradeWithJoins,
} from '../../types/trading'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOURCE_CONFIG: Record<string, { icon: React.ElementType; label: string; pillClass: string }> = {
  inbox: {
    icon: Inbox,
    label: 'Inbox',
    pillClass:
      'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  },
  simulation: {
    icon: FlaskConical,
    label: 'Simulation',
    pillClass:
      'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  },
  adhoc: {
    icon: Plus,
    label: 'Ad-hoc',
    pillClass:
      'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  },
  mixed: {
    icon: Layers,
    label: 'Mixed',
    pillClass:
      'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  },
}

// Per-trade source order used for stable rendering in source-mix pills.
const SOURCE_ORDER: Array<'inbox' | 'simulation' | 'adhoc'> = ['inbox', 'simulation', 'adhoc']

/**
 * Compute the per-source breakdown for a collection of trades. Returns
 * a map from source value to count (omitting zeros). Canonical source
 * lives on `accepted_trades.source` (per-trade), NOT on
 * `trade_batches.source_type` — the batch column is a derived rollup
 * that collapses heterogeneous batches to "mixed" and loses the
 * underlying breakdown. Read from the trades themselves so a batch
 * containing 3 inbox + 2 ad-hoc commits renders as "3 Inbox · 2 Ad-hoc"
 * instead of a vague "Mixed" badge.
 */
function computeSourceMix(trades: AcceptedTradeWithJoins[]): Map<string, number> {
  const mix = new Map<string, number>()
  for (const t of trades) {
    const s = t.source || 'adhoc'
    mix.set(s, (mix.get(s) || 0) + 1)
  }
  return mix
}

const ACTION_COLORS: Record<string, string> = {
  buy: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  add: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  sell: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  trim: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface BatchListViewProps {
  batches: TradeBatch[]
  trades: AcceptedTradeWithJoins[]
  selectedBatchId: string | null
  onSelectBatch: (batchId: string | null) => void
  /**
   * Optional escape hatch: "Open in Trades view" link inside the
   * detail panel for users who want operational controls (filter,
   * sort, dropdowns, corrections) scoped to a single batch. This is
   * intentionally a secondary action — the default flow keeps the
   * user on this screen.
   */
  onViewBatchTrades: (batchId: string) => void
}

// ---------------------------------------------------------------------------
// Batch card (left rail)
// ---------------------------------------------------------------------------

function BatchCard({
  batch,
  stats,
  sourceMix,
  isSelected,
  onSelect,
}: {
  batch: TradeBatch
  stats: { count: number; notional: number }
  sourceMix: Map<string, number>
  isSelected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={clsx(
        'w-full text-left rounded-lg border transition-all px-3.5 py-3',
        isSelected
          ? 'border-blue-400 dark:border-blue-600 bg-blue-50/50 dark:bg-blue-950/20 shadow-sm'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800/80',
      )}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className={clsx(
            'w-2 h-2 rounded-full flex-shrink-0',
            isSelected ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600',
          )}
        />
        <span className="text-sm font-semibold text-gray-900 dark:text-white truncate flex-1">
          {batch.name || 'Untitled batch'}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400 mb-1.5">
        <span>{stats.count} trade{stats.count !== 1 ? 's' : ''}</span>
        {stats.notional !== 0 && (
          <>
            <span className="text-gray-300 dark:text-gray-600">·</span>
            <span>${Math.abs(stats.notional).toLocaleString()}</span>
          </>
        )}
      </div>
      {/* Source mix — one pill per distinct provenance, showing the
          actual per-trade breakdown rather than the misleading
          batch-level rollup. Heterogeneous batches get multiple pills
          side by side instead of a single "Mixed" badge. */}
      <div className="flex items-center flex-wrap gap-1 mb-1">
        {SOURCE_ORDER.map((src) => {
          const count = sourceMix.get(src) || 0
          if (count === 0) return null
          const cfg = SOURCE_CONFIG[src]
          const Icon = cfg.icon
          return (
            <span
              key={src}
              className={clsx(
                'inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded',
                cfg.pillClass,
              )}
            >
              <Icon className="w-2.5 h-2.5" />
              {count} {cfg.label}
            </span>
          )
        })}
      </div>
      <div className="text-[10px] text-gray-400 dark:text-gray-500">
        {formatDistanceToNow(new Date(batch.created_at), { addSuffix: true })}
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Phase rollup strip — read-only version of the pipeline strip, scoped
// to the selected batch. Surfaces phase counts so the PM can tell at a
// glance whether the batch is still in flight or fully done.
// ---------------------------------------------------------------------------

function PhaseRollup({ counts }: { counts: Record<LifecyclePhase, number> }) {
  // Only render phases that have at least one trade in them — this is a
  // summary, not a pipeline strip. Hide empty buckets to keep it dense.
  const order: LifecyclePhase[] = [
    'queued',
    'working',
    'awaiting_recon',
    'needs_review',
    'settled',
    'cancelled',
  ]
  const present = order.filter((p) => counts[p] > 0)
  if (present.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      {present.map((phase) => {
        const meta = PHASE_META[phase]
        return (
          <span
            key={phase}
            className={clsx(
              'inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold',
              meta.pillClass,
            )}
          >
            <span className={clsx('w-1.5 h-1.5 rounded-full', meta.dotClass)} />
            <span>{meta.label}</span>
            <span className="tabular-nums opacity-70">{counts[phase]}</span>
          </span>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline trades list — compact, read-only rendering of the batch's
// trades. Deliberately lighter than AcceptedTradesTable: no sort, no
// filter, no dropdowns. The goal is "here's what's in this batch."
// ---------------------------------------------------------------------------

function BatchTradesList({
  trades,
  batchDescription,
}: {
  trades: AcceptedTradeWithJoins[]
  batchDescription: string | null
}) {
  // Expand-state is local to this component so clicking a row toggles
  // a reveal row beneath it without needing a parent callback.
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (trades.length === 0) {
    return (
      <p className="text-xs text-gray-400 dark:text-gray-500 italic">
        No trades in this batch.
      </p>
    )
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 dark:bg-gray-800/60">
          <tr className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            <th className="w-6" />
            <th className="text-left px-3 py-2">Symbol</th>
            <th className="text-left px-3 py-2">Action</th>
            <th className="text-right px-3 py-2">Tgt Wt</th>
            <th className="text-right px-3 py-2">Δ Wt</th>
            <th className="text-right px-3 py-2">Δ Shrs</th>
            <th className="text-right px-3 py-2">Notional</th>
            <th className="text-left px-3 py-2">Source</th>
            <th className="text-left px-3 py-2">State</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((trade, i) => {
            const result = tradeLifecyclePhase(trade as any)
            const meta = PHASE_META[result.phase]
            const src = (trade.source || 'adhoc') as 'inbox' | 'simulation' | 'adhoc'
            const srcCfg = SOURCE_CONFIG[src]
            const SourceIcon = srcCfg.icon
            const isExpanded = expandedId === trade.id
            const rowBg = i % 2 === 0 ? 'bg-gray-50/40 dark:bg-gray-800/20' : ''
            return (
              <React.Fragment key={trade.id}>
                <tr
                  onClick={() => setExpandedId(isExpanded ? null : trade.id)}
                  className={clsx(
                    'border-t border-gray-100 dark:border-gray-800 cursor-pointer hover:bg-gray-100/70 dark:hover:bg-gray-800/40 transition-colors',
                    rowBg,
                  )}
                >
                  <td className="pl-2 py-2">
                    {isExpanded ? (
                      <ChevronDown className="w-3 h-3 text-gray-400" />
                    ) : (
                      <ChevronRight className="w-3 h-3 text-gray-400" />
                    )}
                  </td>
                  <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">
                    {trade.asset?.symbol || 'Unknown'}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={clsx(
                        'inline-block px-1.5 py-0.5 text-[10px] font-semibold uppercase rounded',
                        ACTION_COLORS[trade.action] || 'bg-gray-100 text-gray-600',
                      )}
                    >
                      {trade.action}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-gray-600 dark:text-gray-300">
                    {trade.target_weight != null ? `${trade.target_weight.toFixed(2)}%` : '—'}
                  </td>
                  {/* Δ Wt — directional color. */}
                  <td className="px-3 py-2 text-right font-mono">
                    {trade.delta_weight != null ? (
                      <span
                        className={clsx(
                          'font-semibold',
                          trade.delta_weight > 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : trade.delta_weight < 0
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-gray-500 dark:text-gray-400',
                        )}
                      >
                        {trade.delta_weight > 0 ? '+' : ''}
                        {trade.delta_weight.toFixed(2)}%
                      </span>
                    ) : (
                      <span className="text-gray-400 dark:text-gray-500">—</span>
                    )}
                  </td>
                  {/* Δ Shrs — directional color. */}
                  <td className="px-3 py-2 text-right font-mono">
                    {trade.delta_shares != null ? (
                      <span
                        className={clsx(
                          trade.delta_shares > 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : trade.delta_shares < 0
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-gray-500 dark:text-gray-400',
                        )}
                      >
                        {trade.delta_shares > 0 ? '+' : ''}
                        {trade.delta_shares.toLocaleString()}
                      </span>
                    ) : (
                      <span className="text-gray-400 dark:text-gray-500">—</span>
                    )}
                  </td>
                  {/* Notional — signed by action. Sells/trims render
                      negative with a leading minus so reductions are
                      visually distinct from adds. */}
                  <td className={clsx(
                    'px-3 py-2 text-right font-mono',
                    trade.action === 'sell' || trade.action === 'trim'
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-gray-600 dark:text-gray-300',
                  )}>
                    {trade.notional_value != null
                      ? (() => {
                          const mag = Math.abs(trade.notional_value).toLocaleString()
                          const isNeg = trade.action === 'sell' || trade.action === 'trim'
                          return isNeg ? `-$${mag}` : `$${mag}`
                        })()
                      : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={clsx(
                        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider',
                        srcCfg.pillClass,
                      )}
                    >
                      <SourceIcon className="w-2.5 h-2.5" />
                      {srcCfg.label}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={clsx(
                        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold',
                        meta.pillClass,
                      )}
                    >
                      <span className={clsx('w-1 h-1 rounded-full', meta.dotClass)} />
                      {meta.label}
                    </span>
                  </td>
                </tr>
                {isExpanded && (
                  <tr className={rowBg}>
                    <td />
                    <td colSpan={8} className="px-3 py-2">
                      <ReasonBlock
                        acceptanceNote={trade.acceptance_note}
                        batchDescription={batchDescription}
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Detail panel (right side) — the primary reading surface.
// ---------------------------------------------------------------------------

function BatchDetailPanel({
  batch,
  trades,
  onViewInTradesView,
}: {
  batch: TradeBatch
  trades: AcceptedTradeWithJoins[]
  onViewInTradesView: () => void
}) {
  const sourceMix = useMemo(() => computeSourceMix(trades), [trades])

  // Net notional — sum with directional sign applied. Buys/adds
  // contribute positive, sells/trims contribute negative. This shows
  // the batch's net capital flow: positive means net buy pressure,
  // negative means net reduction. Zero means it was a pure rebalance.
  // Gross magnitude is shown alongside so the PM can see total size.
  const { netNotional, grossNotional } = useMemo(() => {
    let net = 0
    let gross = 0
    for (const t of trades) {
      const mag = Math.abs(t.notional_value ?? 0)
      gross += mag
      const signed = t.action === 'sell' || t.action === 'trim' ? -mag : mag
      net += signed
    }
    return { netNotional: net, grossNotional: gross }
  }, [trades])

  // Compute phase counts inline — cheap, batch trades are typically < 50 rows.
  const phaseCounts = useMemo(() => {
    const counts: Record<LifecyclePhase, number> = {
      queued: 0,
      working: 0,
      awaiting_recon: 0,
      needs_review: 0,
      settled: 0,
      cancelled: 0,
    }
    for (const t of trades) {
      counts[tradeLifecyclePhase(t as any).phase]++
    }
    return counts
  }, [trades])

  return (
    <div className="h-full overflow-auto">
      <div className="px-8 py-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0">
              <Layers className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                {batch.name || 'Untitled batch'}
              </h2>
              <div className="mt-1 flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="w-3 h-3" />
                  {format(new Date(batch.created_at), 'MMM d, yyyy')}
                </span>
                <span className="text-gray-300 dark:text-gray-600">·</span>
                <span>{formatDistanceToNow(new Date(batch.created_at), { addSuffix: true })}</span>
              </div>
              {/* Source mix pills — derived from per-trade sources,
                  not the rolled-up batch.source_type which collapses
                  heterogeneous batches into "mixed" and loses the
                  breakdown. */}
              <div className="mt-2 flex items-center flex-wrap gap-1.5">
                {SOURCE_ORDER.map((src) => {
                  const count = sourceMix.get(src) || 0
                  if (count === 0) return null
                  const cfg = SOURCE_CONFIG[src]
                  const Icon = cfg.icon
                  return (
                    <span
                      key={src}
                      className={clsx(
                        'inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded',
                        cfg.pillClass,
                      )}
                    >
                      <Icon className="w-2.5 h-2.5" />
                      {count} {cfg.label}
                    </span>
                  )
                })}
              </div>
            </div>
          </div>
          <button
            onClick={onViewInTradesView}
            className="flex-shrink-0 inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
            title="Open this batch in the full Trades view (for filtering, sorting, corrections)"
          >
            Open in Trades
            <ArrowUpRight className="w-3 h-3" />
          </button>
        </div>

        {/* Rationale — the most important element of the panel. This is
            why the batch exists. If the PM didn't write one, show a
            muted placeholder so it's obvious the context is missing. */}
        <section className="mb-5">
          <div className="flex items-center gap-1.5 mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            <FileText className="w-3 h-3" />
            Rationale
          </div>
          {batch.description && batch.description.trim() ? (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/30 px-4 py-3 text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">
              {batch.description}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 px-4 py-3 text-xs text-gray-400 dark:text-gray-500 italic">
              No rationale was captured for this batch.
            </div>
          )}
        </section>

        {/* Quick stats — compact summary row. Deliberately short so the
            eye continues down to the trades list without getting stuck
            on pills. */}
        <section className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
          <div>
            <span className="text-gray-500 dark:text-gray-400">Trades</span>
            <span className="ml-1.5 font-semibold text-gray-900 dark:text-white">
              {trades.length}
            </span>
          </div>
          {grossNotional !== 0 && (
            <>
              <div className="inline-flex items-center">
                <DollarSign className="w-3 h-3 text-gray-400" />
                <span className="text-gray-500 dark:text-gray-400">Gross</span>
                <span className="ml-1.5 font-semibold text-gray-900 dark:text-white">
                  ${grossNotional.toLocaleString()}
                </span>
              </div>
              <div className="inline-flex items-center">
                <span className="text-gray-500 dark:text-gray-400">Net</span>
                <span
                  className={clsx(
                    'ml-1.5 font-semibold',
                    netNotional > 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : netNotional < 0
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-gray-900 dark:text-white',
                  )}
                >
                  {netNotional < 0 ? '-' : netNotional > 0 ? '+' : ''}$
                  {Math.abs(netNotional).toLocaleString()}
                </span>
              </div>
            </>
          )}
        </section>

        {/* Phase rollup */}
        <section className="mb-5">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Status
          </div>
          <PhaseRollup counts={phaseCounts} />
        </section>

        {/* Trades inline */}
        <section>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Trades in this batch
          </div>
          <BatchTradesList trades={trades} batchDescription={batch.description} />
        </section>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty state (no batch selected on the right)
// ---------------------------------------------------------------------------

function EmptyDetail() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-8">
      <div className="w-12 h-12 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
        <Layers className="w-6 h-6 text-gray-400" />
      </div>
      <p className="text-sm font-medium text-gray-600 dark:text-gray-300">
        Select a batch
      </p>
      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 max-w-xs leading-relaxed">
        Pick a batch on the left to see its rationale, status rollup, and
        the trades it contains.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function BatchListView({
  batches,
  trades,
  selectedBatchId,
  onSelectBatch,
  onViewBatchTrades,
}: BatchListViewProps) {
  // Pre-compute per-batch stats AND per-batch source mix. Both
  // iterate the trades array once each; keeping them separate is
  // cheap and keeps the shapes isolated.
  const batchStats = useMemo(() => {
    const map = new Map<string, { count: number; notional: number }>()
    for (const t of trades) {
      if (!t.batch_id) continue
      const prev = map.get(t.batch_id) || { count: 0, notional: 0 }
      map.set(t.batch_id, {
        count: prev.count + 1,
        notional: prev.notional + (t.notional_value ?? 0),
      })
    }
    return map
  }, [trades])

  const batchSourceMixes = useMemo(() => {
    const map = new Map<string, Map<string, number>>()
    for (const t of trades) {
      if (!t.batch_id) continue
      const prev = map.get(t.batch_id) || new Map<string, number>()
      const s = t.source || 'adhoc'
      prev.set(s, (prev.get(s) || 0) + 1)
      map.set(t.batch_id, prev)
    }
    return map
  }, [trades])

  // Trades for the currently-selected batch. Memoed so the detail
  // panel doesn't re-filter on unrelated parent re-renders.
  const selectedBatchTrades = useMemo(() => {
    if (!selectedBatchId) return []
    return trades.filter((t) => t.batch_id === selectedBatchId)
  }, [trades, selectedBatchId])

  const selectedBatch = batches.find((b) => b.id === selectedBatchId) || null

  // Auto-select the most recent batch on first mount so the detail
  // panel isn't empty for a user landing on the Batches view. Also
  // kicks in if the persisted `selectedBatchId` points at a batch
  // that no longer exists (deleted while the user was on another
  // tab) — we fall back to the first available batch instead of
  // showing an empty right panel.
  React.useEffect(() => {
    if (batches.length === 0) return
    const stillExists = selectedBatchId
      ? batches.some((b) => b.id === selectedBatchId)
      : false
    if (!stillExists) {
      onSelectBatch(batches[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batches.length, selectedBatchId])

  if (batches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-14 h-14 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
          <Layers className="w-7 h-7 text-gray-400" />
        </div>
        <p className="text-sm font-semibold text-gray-600 dark:text-gray-300">No batches yet</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5 max-w-sm leading-relaxed">
          Batches group trades that were committed together. Promote trades
          from the Trade Lab simulation to create your first batch.
        </p>
      </div>
    )
  }

  return (
    <div className="h-full grid grid-cols-[320px_1fr] min-h-0">
      {/* Left rail: batch cards */}
      <div className="border-r border-gray-200 dark:border-gray-700 overflow-auto bg-gray-50/30 dark:bg-gray-900/30">
        <div className="px-4 py-4 space-y-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Batches
            </span>
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              {batches.length}
            </span>
          </div>
          {batches.map((batch) => (
            <BatchCard
              key={batch.id}
              batch={batch}
              stats={batchStats.get(batch.id) || { count: 0, notional: 0 }}
              sourceMix={batchSourceMixes.get(batch.id) || new Map()}
              isSelected={selectedBatchId === batch.id}
              onSelect={() => onSelectBatch(batch.id)}
            />
          ))}
        </div>
      </div>

      {/* Right: detail panel */}
      {selectedBatch ? (
        <BatchDetailPanel
          batch={selectedBatch}
          trades={selectedBatchTrades}
          onViewInTradesView={() => onViewBatchTrades(selectedBatch.id)}
        />
      ) : (
        <EmptyDetail />
      )}
    </div>
  )
}
