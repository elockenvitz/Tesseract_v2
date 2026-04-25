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
  PenLine,
  ArrowRight,
  DollarSign,
  CalendarDays,
  FileText,
  ArrowUpRight,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Pencil,
  Check as CheckIcon,
  X as XIcon,
  Loader2,
  Sparkles,
  Archive,
  Search,
} from 'lucide-react'
import { clsx } from 'clsx'
import {
  tradeLifecyclePhase,
  PHASE_META,
  type LifecyclePhase,
} from '../../lib/trade-book/lifecycle'
import { TradeRationaleLog } from './AcceptedTradesTable'
import { supabase } from '../../lib/supabase'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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
    icon: PenLine,
    label: 'Manual',
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
 * Empty phase-count record used to seed reducers that aggregate trades
 * into phase buckets.
 */
const EMPTY_PHASE_COUNTS: Record<LifecyclePhase, number> = {
  queued: 0,
  working: 0,
  awaiting_recon: 0,
  needs_review: 0,
  settled: 0,
  cancelled: 0,
}

/**
 * Collapse a phase-count record into a single triage-signal pill for the
 * left-rail tile. Priority reflects PM attention:
 *   needs_review > working > awaiting_recon > queued > settled > cancelled.
 * Returns null when there are no trades.
 */
function batchStatusPill(counts: Record<LifecyclePhase, number>): {
  label: string
  pillClass: string
  dotClass: string
} | null {
  const order: LifecyclePhase[] = [
    'needs_review',
    'working',
    'awaiting_recon',
    'queued',
    'settled',
    'cancelled',
  ]
  for (const phase of order) {
    if (counts[phase] > 0) {
      const meta = PHASE_META[phase]
      // For active phases include the count; for terminal we just show the label.
      const label = meta.isActive
        ? `${counts[phase]} ${meta.label.toLowerCase()}`
        : meta.label
      return { label, pillClass: meta.pillClass, dotClass: meta.dotClass }
    }
  }
  return null
}

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
  /**
   * Optional: append a new comment to an accepted trade. When provided,
   * each row in the batch's trades table gets an expandable pane with a
   * comment thread + input so a PM can add context after the trade
   * landed without switching to the full Trades view.
   */
  onAddComment?: (tradeId: string, content: string) => void
}

// ---------------------------------------------------------------------------
// Batch card (left rail)
// ---------------------------------------------------------------------------

function BatchCard({
  batch,
  stats,
  sourceMix,
  phaseCounts,
  needsRationale,
  isSelected,
  onSelect,
}: {
  batch: TradeBatch
  stats: { count: number; notional: number }
  sourceMix: Map<string, number>
  phaseCounts: Record<LifecyclePhase, number>
  needsRationale: boolean
  isSelected: boolean
  onSelect: () => void
}) {
  const statusPill = batchStatusPill(phaseCounts)
  const isCancelledBatch = batch.status === 'cancelled'
  // Icon-only source summary: one small icon per distinct source present
  // in the batch's trades. Lets the tile signal "Inbox + Simulation" at a
  // glance without the multi-row pill stack from before.
  const sourcesPresent = SOURCE_ORDER.filter((src) => (sourceMix.get(src) || 0) > 0)
  // Gross sum magnitude. `stats.notional` aggregates unsigned notional
  // values from each trade, so this is the "size of the move" — not
  // directional net. Shown as a compact magnitude (K/M) to keep the tile
  // scannable even for $50M+ batches.
  const grossAbs = Math.abs(stats.notional)

  return (
    <button
      type="button"
      onClick={onSelect}
      className={clsx(
        'w-full text-left rounded-lg border transition-all px-3 py-2.5',
        isCancelledBatch && 'opacity-60',
        isSelected
          ? 'border-blue-400 dark:border-blue-600 bg-blue-50/50 dark:bg-blue-950/20 shadow-sm'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800/80',
      )}
    >
      {/* Row 1 — identity: selection dot + name (truncate) + notional
          (right-aligned, prominent). Notional gets its own slot on this
          row rather than being buried in a comma-separated meta line —
          the PM needs "how big is this?" at a glance. */}
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className={clsx(
            'w-1.5 h-1.5 rounded-full flex-shrink-0',
            isSelected ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600',
          )}
        />
        <span
          className={clsx(
            'text-[13px] font-semibold text-gray-900 dark:text-white truncate flex-1',
            isCancelledBatch && 'line-through',
          )}
        >
          {batch.name || 'Untitled batch'}
        </span>
        {grossAbs > 0 && (
          <span
            className="text-[12px] font-semibold text-gray-700 dark:text-gray-200 tabular-nums flex-shrink-0"
            title={`Gross notional: $${grossAbs.toLocaleString()}`}
          >
            {compactCurrency(grossAbs)}
          </span>
        )}
      </div>

      {/* Row 2 — status + facts on one line: triage pill, trade count,
          source breakdown, with age right-aligned. Single-source batches
          fold their source into the trade count ("1 Manual trade"). */}
      <div className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400 flex-wrap">
        {statusPill && (
          <span
            className={clsx(
              'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold flex-shrink-0',
              statusPill.pillClass,
            )}
          >
            <span className={clsx('w-1 h-1 rounded-full', statusPill.dotClass)} />
            {statusPill.label}
          </span>
        )}
        {sourcesPresent.length === 1 ? (
          <span className="tabular-nums">
            {stats.count} {SOURCE_CONFIG[sourcesPresent[0]].label} trade
            {stats.count !== 1 ? 's' : ''}
          </span>
        ) : (
          <>
            <span className="tabular-nums">
              {stats.count} trade{stats.count !== 1 ? 's' : ''}
            </span>
            {sourcesPresent.map((src) => (
              <React.Fragment key={src}>
                <span className="text-gray-300 dark:text-gray-600">·</span>
                <span className="tabular-nums">
                  {sourceMix.get(src) || 0} {SOURCE_CONFIG[src].label}
                </span>
              </React.Fragment>
            ))}
          </>
        )}
        <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0">
          {formatDistanceToNow(new Date(batch.created_at), { addSuffix: true })}
        </span>
      </div>

      {/* Row 3 (conditional) — rationale nudge. Framed as an optional
          invitation rather than an error so PMs don't feel like something
          is broken. Shown when the batch has no description AND no trade
          inside it has an acceptance_note. */}
      {needsRationale && (
        <div className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-amber-700 dark:text-amber-300">
          <Pencil className="w-3 h-3" />
          <span>Add rationale to explain this decision</span>
        </div>
      )}
    </button>
  )
}

/** Join a list of strings with commas and a trailing "and" for the final
 *  item. Used to build the readable continuity summary for a just-committed
 *  batch: `['AAPL', 'META']` → `"AAPL and META"`. */
function joinList(items: string[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

/** Build a short, human-readable summary of what happened in the batch —
 *  used in the continuity section when the user lands in Trade Book via
 *  the Decision Recorded modal. Examples:
 *    - "Added AAPL"
 *    - "Trimmed AAPL and META"
 *    - "Added CRM, trimmed AMZN"
 *  Buys/adds are folded into "Added"; sells/trims into "Trimmed" — the
 *  pilot's mental model is the verb pair, not the four action codes. */
function buildReadableSummary(trades: AcceptedTradeWithJoins[]): string {
  const buys: string[] = []
  const sells: string[] = []
  for (const t of trades) {
    const sym = t.asset?.symbol || '?'
    if (t.action === 'buy' || t.action === 'add') buys.push(sym)
    else sells.push(sym)
  }
  const parts: string[] = []
  if (buys.length) parts.push(`Added ${joinList(buys)}`)
  if (sells.length) parts.push(`${parts.length ? 'trimmed' : 'Trimmed'} ${joinList(sells)}`)
  return parts.join(', ')
}

/** Compact currency: 1234 → "$1.2K", 12_345_678 → "$12.3M". Used on the
 *  batch tile so the notional stays inside its slot even for large
 *  portfolios. Full value is available via the tile's title attribute. */
function compactCurrency(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${Math.round(n).toLocaleString()}`
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
  onAddComment,
}: {
  trades: AcceptedTradeWithJoins[]
  batchDescription: string | null
  onAddComment?: (tradeId: string, content: string) => void
}) {
  // Group trades by side — buys (buy, add) first, then sells (everything
  // else). A batch's buys and sells are meaningfully different: they're
  // funded differently, reviewed differently, and narrated differently.
  // Splitting them in the table lets the PM scan one side at a time.
  const { buyTrades, sellTrades } = useMemo(() => {
    const buys: AcceptedTradeWithJoins[] = []
    const sells: AcceptedTradeWithJoins[] = []
    for (const t of trades) {
      if (t.action === 'buy' || t.action === 'add') buys.push(t)
      else sells.push(t)
    }
    return { buyTrades: buys, sellTrades: sells }
  }, [trades])

  if (trades.length === 0) {
    return (
      <p className="text-xs text-gray-400 dark:text-gray-500 italic">
        No trades in this batch.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 dark:bg-gray-800/60">
            <tr className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              <th className="text-left px-3 py-2">Symbol</th>
              <th className="text-left px-3 py-2">Action</th>
              <th className="text-right px-3 py-2">Tgt Wt</th>
              <th className="text-right px-3 py-2">Δ Wt</th>
              <th className="text-right px-3 py-2">Δ Shrs</th>
              <th className="text-right px-3 py-2">Notional</th>
              <th className="text-left px-3 py-2">Source</th>
              <th className="text-left px-3 py-2">State</th>
              <th className="w-8" aria-label="Expand" />
            </tr>
          </thead>
          {buyTrades.length > 0 && (
            <TradeGroup
              label={buyTrades.length === 1 ? 'Buy' : 'Buys'}
              count={buyTrades.length}
              accent="emerald"
              trades={buyTrades}
              batchDescription={batchDescription}
              onAddComment={onAddComment}
            />
          )}
          {sellTrades.length > 0 && (
            <TradeGroup
              label={sellTrades.length === 1 ? 'Sell' : 'Sells'}
              count={sellTrades.length}
              accent="red"
              trades={sellTrades}
              batchDescription={batchDescription}
              onAddComment={onAddComment}
            />
          )}
        </table>
      </div>
    </div>
  )
}

/** One side of the buys/sells split — renders a colored group header row
 *  followed by the trades for that side. Rendered as a separate <tbody>
 *  so the group heading is structurally distinct from the trade rows. */
function TradeGroup({
  label,
  count,
  accent,
  trades,
  batchDescription,
  onAddComment,
}: {
  label: string
  count: number
  accent: 'emerald' | 'red'
  trades: AcceptedTradeWithJoins[]
  batchDescription: string | null
  onAddComment?: (tradeId: string, content: string) => void
}) {
  const dotClass =
    accent === 'emerald'
      ? 'bg-emerald-500 dark:bg-emerald-400'
      : 'bg-red-500 dark:bg-red-400'
  const labelClass =
    accent === 'emerald'
      ? 'text-emerald-700 dark:text-emerald-400'
      : 'text-red-700 dark:text-red-400'
  const chipClass =
    accent === 'emerald'
      ? 'bg-emerald-100/70 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
      : 'bg-red-100/70 text-red-700 dark:bg-red-900/30 dark:text-red-400'

  return (
    <tbody>
      {/* Group header — quiet grouping marker: colored dot + label +
          compact count chip on a subtle divider background. Avoids the
          "banner across the whole row" heaviness while still giving the
          group a clear visual boundary. */}
      <tr className="border-t-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40">
        <td colSpan={9} className="px-3 py-1.5">
          <div className="flex items-center gap-2">
            <span className={clsx('w-1.5 h-1.5 rounded-full', dotClass)} />
            <span className={clsx('text-[10px] font-semibold uppercase tracking-wider', labelClass)}>
              {label}
            </span>
            <span className={clsx('text-[10px] font-semibold tabular-nums px-1.5 py-px rounded', chipClass)}>
              {count}
            </span>
          </div>
        </td>
      </tr>
      {trades.map((trade, i) => (
        <TradeRow
          key={trade.id}
          trade={trade}
          rowIndex={i}
          batchDescription={batchDescription}
          onAddComment={onAddComment}
        />
      ))}
    </tbody>
  )
}

/** Single row in the batch trades table. Each row is clickable to
 *  expand a detail drawer beneath it showing the trade's rationale
 *  via TradeRationaleLog — the unified "initial reason + added notes"
 *  surface that also powers the Trades view's detail pane. */
function TradeRow({
  trade,
  rowIndex,
  batchDescription,
  onAddComment,
}: {
  trade: AcceptedTradeWithJoins
  rowIndex: number
  batchDescription: string | null
  onAddComment?: (tradeId: string, content: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const result = tradeLifecyclePhase(trade as any)
  const meta = PHASE_META[result.phase]
  const src = (trade.source || 'adhoc') as 'inbox' | 'simulation' | 'adhoc'
  const srcCfg = SOURCE_CONFIG[src]
  const SourceIcon = srcCfg.icon
  const rowBg = rowIndex % 2 === 0 ? 'bg-gray-50/40 dark:bg-gray-800/20' : ''

  const hasNote = !!(trade.acceptance_note && trade.acceptance_note.trim())
  const canExpand = hasNote || !!onAddComment

  return (
    <React.Fragment>
    <tr
      className={clsx(
        'border-t border-gray-100 dark:border-gray-800',
        rowBg,
        canExpand && 'cursor-pointer hover:bg-gray-100/70 dark:hover:bg-gray-800/40',
      )}
      onClick={canExpand ? () => setExpanded((v) => !v) : undefined}
    >
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
      <td
        className={clsx(
          'px-3 py-2 text-right font-mono',
          trade.action === 'sell' || trade.action === 'trim'
            ? 'text-red-600 dark:text-red-400'
            : 'text-gray-600 dark:text-gray-300',
        )}
      >
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
      {/* Expand affordance — chevron toggles, message icon indicates the
          row has a rationale or comment thread available. Kept at the
          end of the row so the numeric columns stay tightly packed. */}
      <td className="px-2 py-2 w-8">
        {canExpand && (
          <div className="flex items-center justify-end gap-1 text-gray-400 dark:text-gray-500">
            {hasNote && (
              <MessageSquare className="w-3 h-3" aria-label="Has rationale" />
            )}
            {expanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </div>
        )}
      </td>
    </tr>
    {expanded && (
      <tr className={rowBg}>
        <td colSpan={9} className="px-6 py-3 border-t border-gray-100 dark:border-gray-800">
          {/* Unified rationale log: initial commit reason + any
              follow-on rationale notes, with a single input to add
              more. Matches the Trades view's detail pane so users
              see the same rationale surface on both tabs. */}
          <TradeRationaleLog
            tradeId={trade.id}
            acceptanceNote={trade.acceptance_note}
            batchDescription={batchDescription}
            onAddComment={onAddComment}
          />
        </td>
      </tr>
    )}
    </React.Fragment>
  )
}

// ---------------------------------------------------------------------------
// Detail panel (right side) — the primary reading surface.
// ---------------------------------------------------------------------------

/** Thin vertical rule used between logical groups in the stats row
 *  (trades count | directional split | notional | pills). Height is
 *  matched to the text so the line aligns with the cap height rather
 *  than stretching the row. */
function StatDivider() {
  return (
    <span
      aria-hidden
      className="h-4 w-px bg-gray-200 dark:bg-gray-700"
    />
  )
}

/** How recently a batch must have been committed (in ms) for the
 *  "You just committed this decision" continuity card to render in the
 *  detail panel. Short enough that the card represents a moment, not a
 *  sticky label — a PM who comes back tomorrow shouldn't still see it. */
const JUST_COMMITTED_WINDOW_MS = 5 * 60 * 1000

function BatchDetailPanel({
  batch,
  trades,
  onViewInTradesView,
  onAddComment,
}: {
  batch: TradeBatch
  trades: AcceptedTradeWithJoins[]
  onViewInTradesView: () => void
  onAddComment?: (tradeId: string, content: string) => void
}) {
  // Derive "just committed" purely from batch.created_at. No prop
  // threading, no sticky flag — the continuity card appears for any
  // batch committed in the last JUST_COMMITTED_WINDOW_MS and quietly
  // disappears once the window passes.
  const isJustCommitted = useMemo(() => {
    const t = new Date(batch.created_at).getTime()
    if (!Number.isFinite(t)) return false
    return Date.now() - t < JUST_COMMITTED_WINDOW_MS
  }, [batch.created_at])
  const sourceMix = useMemo(() => computeSourceMix(trades), [trades])

  // Net notional — sum with directional sign applied. Buys/adds
  // contribute positive, sells/trims contribute negative. This shows
  // the batch's net capital flow: positive means net buy pressure,
  // negative means net reduction. Zero means it was a pure rebalance.
  // Gross magnitude is shown alongside so the PM can see total size.
  // buyCount/sellCount surface the directional split on the stats row
  // so you can tell "6 buys · 3 sells" at a glance without counting
  // rows in the trades table.
  const { netNotional, grossNotional, buyCount, sellCount } = useMemo(() => {
    let net = 0
    let gross = 0
    let buys = 0
    let sells = 0
    for (const t of trades) {
      const mag = Math.abs(t.notional_value ?? 0)
      gross += mag
      const isBuy = t.action === 'buy' || t.action === 'add'
      if (isBuy) {
        buys++
        net += mag
      } else {
        sells++
        net -= mag
      }
    }
    return { netNotional: net, grossNotional: gross, buyCount: buys, sellCount: sells }
  }, [trades])

  // Compute phase counts inline — cheap, batch trades are typically < 50 rows.
  const phaseCounts = useMemo(() => {
    const counts: Record<LifecyclePhase, number> = { ...EMPTY_PHASE_COUNTS }
    for (const t of trades) {
      counts[tradeLifecyclePhase(t as any).phase]++
    }
    return counts
  }, [trades])

  const isCancelledBatch = batch.status === 'cancelled'

  return (
    <div className="h-full overflow-auto">
      <div className="px-6 py-4 space-y-4">
        {/* Header — compact: title + cancellation chip + escape hatch. Date
            and source breakdown moved into the stats row so the header is
            purely identity + primary action. */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Layers className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
              <BatchNameEditor batch={batch} isCancelledBatch={isCancelledBatch} />
              {isCancelledBatch && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500">
                  Cancelled
                </span>
              )}
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

        {/* Continuity line — rendered only when the user lands here from
            the Decision Recorded modal's "View in Trade Book" CTA. Carries
            the emotional weight of the commit forward so the user
            recognises Trade Book as the home for their just-made decision,
            not a separate system. Short readable summary (e.g. "Trimmed
            AAPL and META") reinforces what they just did. */}
        {isJustCommitted && (
          <section
            className="rounded-lg border-l-2 border-emerald-500 bg-emerald-50/60 dark:bg-emerald-900/15 px-4 py-3"
            aria-label="Just committed"
          >
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 mb-1">
              <Sparkles className="w-3 h-3" />
              You just committed this decision
            </div>
            <p className="text-[13px] font-medium text-gray-800 dark:text-gray-100">
              {buildReadableSummary(trades) || 'Your decision is now recorded.'}
            </p>
          </section>
        )}

        {/* Status + stats — a single consolidated row. Phase rollup sits
            next to the batch's quick stats so the PM can correlate "N
            needs review" with the trade count / notional without
            scrolling. Source mix and date live here too so the header
            above can stay purely identity-focused. */}
        <section className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40 p-3">
          {/* Single consolidated line: headline stats (trades, gross, net)
              side-by-side with the triage pills (phase rollup) and source
              breakdown. Everything a PM needs to assess the batch lives
              on one eye-sweep row rather than three stacked sections. */}
          <div className="flex items-center flex-wrap gap-x-4 gap-y-2 text-xs">
            <div>
              <span className="text-gray-500 dark:text-gray-400">Trades</span>
              <span className="ml-1.5 font-semibold text-gray-900 dark:text-white tabular-nums">
                {trades.length}
              </span>
            </div>

            {/* Divider between trade count and the directional split. */}
            {(buyCount > 0 || sellCount > 0) && <StatDivider />}

            {/* Directional split — green for buys, red for sells. Omitted
                when zero so an all-buy (or all-sell) batch doesn't waste
                space on a 0-count pill. */}
            {buyCount > 0 && (
              <span className="inline-flex items-center text-emerald-600 dark:text-emerald-400 font-semibold tabular-nums">
                {buyCount} {buyCount === 1 ? 'buy' : 'buys'}
              </span>
            )}
            {sellCount > 0 && (
              <span className="inline-flex items-center text-red-600 dark:text-red-400 font-semibold tabular-nums">
                {sellCount} {sellCount === 1 ? 'sell' : 'sells'}
              </span>
            )}

            {/* Divider between the directional split and the notional. */}
            {grossNotional !== 0 && <StatDivider />}

            {grossNotional !== 0 && (
              <>
                <div className="inline-flex items-center">
                  <DollarSign className="w-3 h-3 text-gray-400" />
                  <span className="text-gray-500 dark:text-gray-400">Gross</span>
                  <span className="ml-1.5 font-semibold text-gray-900 dark:text-white tabular-nums">
                    ${grossNotional.toLocaleString()}
                  </span>
                </div>
                <div className="inline-flex items-center">
                  <span className="text-gray-500 dark:text-gray-400">Net</span>
                  <span
                    className={clsx(
                      'ml-1.5 font-semibold tabular-nums',
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

            {/* Divider before the pills block (phase rollup + source mix). */}
            {(trades.length > 0 ||
              Array.from(sourceMix.entries()).some(([, c]) => c > 0)) && (
              <StatDivider />
            )}

            {/* Phase pills — one entry per phase that has trades. Inline
                with the stats so the PM sees "Settled 3" right next to
                "Trades 3" instead of scanning down. */}
            <PhaseRollup counts={phaseCounts} />

            {/* Source pills — same row. Derived from per-trade sources,
                not the lossy batch.source_type rollup. */}
            {SOURCE_ORDER.map((src) => {
              const count = sourceMix.get(src) || 0
              if (count === 0) return null
              const cfg = SOURCE_CONFIG[src]
              const Icon = cfg.icon
              return (
                <span
                  key={src}
                  className={clsx(
                    'inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded',
                    cfg.pillClass,
                  )}
                >
                  <Icon className="w-2.5 h-2.5" />
                  {count} {cfg.label}
                </span>
              )
            })}

            {/* Date pinned to the right end of the row */}
            <div className="ml-auto inline-flex items-center gap-1 text-gray-500 dark:text-gray-400">
              <CalendarDays className="w-3 h-3" />
              <span title={formatDistanceToNow(new Date(batch.created_at), { addSuffix: true })}>
                {format(new Date(batch.created_at), 'MMM d, yyyy')}
              </span>
            </div>
          </div>
        </section>

        {/* Rationale — below stats so triage signals are seen first.
            Editable in-place: if empty, clicking the placeholder opens
            a textarea; if present, hovering reveals an Edit button.
            Saves back to trade_batches.description. */}
        <section>
          <div className="flex items-center gap-1.5 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            <FileText className="w-3 h-3" />
            Rationale
          </div>
          <BatchRationaleEditor batch={batch} />
        </section>

        {/* Trades inline */}
        <section>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Trades in this batch
          </div>
          <BatchTradesList
            trades={trades}
            batchDescription={batch.description}
            onAddComment={onAddComment}
          />
        </section>

        {/* System-of-record reinforcement — a quiet footnote that
            reframes Trade Book from "a list of trades" into "the
            archive of every decision, ever". Kept muted so it feels
            like a truth the product holds, not a marketing line. */}
        <div className="pt-1 flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500">
          <Archive className="w-3 h-3" />
          <span>Every decision in Trade Book is preserved for future review.</span>
        </div>
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
  onAddComment,
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

  // Per-batch phase counts — drives the triage-signal pill on each tile.
  const batchPhaseCounts = useMemo(() => {
    const map = new Map<string, Record<LifecyclePhase, number>>()
    for (const t of trades) {
      if (!t.batch_id) continue
      const prev = map.get(t.batch_id) || { ...EMPTY_PHASE_COUNTS }
      prev[tradeLifecyclePhase(t as any).phase]++
      map.set(t.batch_id, prev)
    }
    return map
  }, [trades])

  // Per-batch set of trade symbols. Powers the left-rail search so a PM
  // can type "AAPL" and see every batch that touched AAPL, not just
  // batches whose name or rationale mention it. Uppercased so the search
  // can compare case-insensitively against a single uppercase query.
  const batchSymbols = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const t of trades) {
      if (!t.batch_id) continue
      const sym = t.asset?.symbol?.toUpperCase()
      if (!sym) continue
      const prev = map.get(t.batch_id) || []
      if (!prev.includes(sym)) prev.push(sym)
      map.set(t.batch_id, prev)
    }
    return map
  }, [trades])

  // Per-batch: does ANY trade carry a rationale (acceptance_note)? Combined
  // with the batch's own description, this drives the "Needs rationale"
  // flag on the left-rail card — prompts PMs to fill in context on a
  // batch they committed without narration.
  const batchHasTradeRationale = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const t of trades) {
      if (!t.batch_id) continue
      const has = !!(t.acceptance_note && t.acceptance_note.trim())
      if (has || !map.has(t.batch_id)) {
        map.set(t.batch_id, has || (map.get(t.batch_id) ?? false))
      }
    }
    return map
  }, [trades])

  // Left-rail search. Matches case-insensitively against batch name,
  // batch description (rationale), and any trade symbol in the batch.
  // Debouncing isn't necessary — the batch list is in memory and the
  // filter pass is O(batches × tokens). Cleared via the in-input × icon.
  const [search, setSearch] = useState('')
  const filteredBatches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return batches
    const qUpper = q.toUpperCase()
    return batches.filter((b) => {
      if ((b.name || '').toLowerCase().includes(q)) return true
      if ((b.description || '').toLowerCase().includes(q)) return true
      const syms = batchSymbols.get(b.id)
      if (syms && syms.some((s) => s.includes(qUpper))) return true
      return false
    })
  }, [batches, batchSymbols, search])

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
            <span className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">
              {search.trim() ? `${filteredBatches.length} of ${batches.length}` : batches.length}
            </span>
          </div>
          {/* Search — matches name, rationale, and ticker symbols. */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, rationale, symbol…"
              className="w-full pl-8 pr-7 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600"
                aria-label="Clear search"
              >
                <XIcon className="h-3 w-3" />
              </button>
            )}
          </div>
          {filteredBatches.length === 0 && (
            <div className="px-3 py-6 text-center text-[11px] text-gray-400 dark:text-gray-500">
              No batches match "{search}"
            </div>
          )}
          {filteredBatches.map((batch) => {
            const descTrimmed = (batch.description || '').trim()
            const needsRationale =
              !descTrimmed && !(batchHasTradeRationale.get(batch.id) ?? false)
            return (
              <BatchCard
                key={batch.id}
                batch={batch}
                stats={batchStats.get(batch.id) || { count: 0, notional: 0 }}
                sourceMix={batchSourceMixes.get(batch.id) || new Map()}
                phaseCounts={batchPhaseCounts.get(batch.id) || EMPTY_PHASE_COUNTS}
                needsRationale={needsRationale}
                isSelected={selectedBatchId === batch.id}
                onSelect={() => onSelectBatch(batch.id)}
              />
            )
          })}
        </div>
      </div>

      {/* Right: detail panel */}
      {selectedBatch ? (
        <BatchDetailPanel
          batch={selectedBatch}
          trades={selectedBatchTrades}
          onViewInTradesView={() => onViewBatchTrades(selectedBatch.id)}
          onAddComment={onAddComment}
        />
      ) : (
        <EmptyDetail />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline editor for a batch's name (trade_batches.name). Shows the name as
// an h2; hovering reveals a small Edit affordance that swaps in a text
// input. Enter / blur saves, Escape cancels. Empty saves null so the card
// falls back to "Untitled batch".
// ---------------------------------------------------------------------------

function BatchNameEditor({
  batch,
  isCancelledBatch,
}: {
  batch: TradeBatch
  isCancelledBatch: boolean
}) {
  const queryClient = useQueryClient()
  const current = batch.name || ''
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(current)

  React.useEffect(() => {
    setDraft(current)
    setEditing(false)
  }, [batch.id, current])

  const saveM = useMutation({
    mutationFn: async (nextName: string) => {
      const trimmed = nextName.trim()
      // Only write when the value actually changed — avoids a pointless
      // UPDATE round-trip (and query invalidation) on Enter-to-cancel.
      if (trimmed === current.trim()) return trimmed
      const { error } = await supabase
        .from('trade_batches')
        .update({
          name: trimmed || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', batch.id)
      if (error) throw error
      return trimmed
    },
    onSuccess: () => {
      setEditing(false)
      queryClient.invalidateQueries({ queryKey: ['trade-batches'] })
    },
  })

  if (editing) {
    const commit = () => {
      if (saveM.isPending) return
      saveM.mutate(draft)
    }
    const cancel = () => {
      if (saveM.isPending) return
      setDraft(current)
      setEditing(false)
    }
    return (
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            ;(e.target as HTMLInputElement).blur()
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            cancel()
          }
        }}
        autoFocus
        placeholder="Untitled batch"
        disabled={saveM.isPending}
        className="flex-1 min-w-0 text-lg font-semibold text-gray-900 dark:text-white bg-white dark:bg-gray-900 rounded-md border border-amber-300 dark:border-amber-600 px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-amber-400"
      />
    )
  }

  return (
    <div className="group inline-flex items-center gap-1.5 min-w-0">
      <h2
        className={clsx(
          'text-lg font-semibold text-gray-900 dark:text-white truncate',
          isCancelledBatch && 'line-through text-gray-400 dark:text-gray-500',
          !batch.name && 'text-gray-400 dark:text-gray-500 italic',
        )}
      >
        {batch.name || 'Untitled batch'}
      </h2>
      <button
        onClick={() => setEditing(true)}
        className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 bg-white/80 dark:bg-gray-900/80 rounded-md border border-gray-200 dark:border-gray-700 px-1.5 py-0.5"
        title="Rename batch"
      >
        <Pencil className="w-3 h-3" />
        Rename
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline editor for a batch's rationale (trade_batches.description). Renders
// a read-only block with an "Edit" affordance when a rationale exists, and
// a dashed "Add rationale" placeholder when empty. Clicking either opens a
// textarea; saving writes back to trade_batches.description and invalidates
// the trade-batches query so every surface picks up the new text.
// ---------------------------------------------------------------------------

function BatchRationaleEditor({ batch }: { batch: TradeBatch }) {
  const queryClient = useQueryClient()
  const existing = (batch.description || '').trim()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(existing)

  // Reset draft whenever the selected batch changes or its persisted
  // description updates — otherwise the textarea keeps the previous
  // batch's text after switching in the left rail.
  React.useEffect(() => {
    setDraft(existing)
    setEditing(false)
  }, [batch.id, existing])

  const saveM = useMutation({
    mutationFn: async (nextDescription: string) => {
      const trimmed = nextDescription.trim()
      const { error } = await supabase
        .from('trade_batches')
        .update({
          description: trimmed || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', batch.id)
      if (error) throw error
      return trimmed
    },
    onSuccess: () => {
      setEditing(false)
      queryClient.invalidateQueries({ queryKey: ['trade-batches'] })
    },
  })

  if (editing) {
    const handleSave = () => {
      if (saveM.isPending) return
      saveM.mutate(draft)
    }
    const handleCancel = () => {
      if (saveM.isPending) return
      setDraft(existing)
      setEditing(false)
    }
    return (
      <div className="rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50/30 dark:bg-amber-900/10 px-3 py-2.5">
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          rows={3}
          autoFocus
          placeholder="Why these trades? What's the thesis for the batch?"
          className="w-full text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-900 rounded-md border border-gray-200 dark:border-gray-700 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 leading-relaxed"
          onKeyDown={e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleSave()
            if (e.key === 'Escape') handleCancel()
          }}
        />
        <div className="flex items-center justify-end gap-2 mt-2">
          <button
            onClick={handleCancel}
            disabled={saveM.isPending}
            className="text-[11px] font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 inline-flex items-center gap-1"
          >
            <XIcon className="w-3 h-3" /> Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saveM.isPending || draft.trim() === existing}
            className="text-[11px] font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:text-gray-500 rounded-md px-2.5 py-1 inline-flex items-center gap-1"
          >
            {saveM.isPending
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <CheckIcon className="w-3 h-3" />}
            Save rationale
          </button>
        </div>
        {saveM.isError && (
          <p className="text-[11px] text-red-600 mt-1.5">
            {(saveM.error as any)?.message || 'Failed to save rationale'}
          </p>
        )}
      </div>
    )
  }

  if (existing) {
    return (
      <div className="group relative rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/30 px-4 py-3 text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">
        {existing}
        <button
          onClick={() => setEditing(true)}
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 bg-white/80 dark:bg-gray-900/80 rounded-md border border-gray-200 dark:border-gray-700 px-1.5 py-0.5"
        >
          <Pencil className="w-3 h-3" />
          Edit
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="w-full text-left rounded-lg border border-dashed border-amber-300 dark:border-amber-700/60 bg-amber-50/30 dark:bg-amber-900/10 hover:bg-amber-50 dark:hover:bg-amber-900/20 px-4 py-3 transition-colors"
    >
      <div className="flex items-start gap-2">
        <Pencil className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-semibold text-amber-800 dark:text-amber-300">
            Add rationale to explain this decision
          </div>
          <div className="text-[11px] text-amber-700/80 dark:text-amber-300/70 mt-0.5 leading-relaxed">
            Capture your thinking now, or revisit it later in Outcomes.
          </div>
        </div>
      </div>
    </button>
  )
}
