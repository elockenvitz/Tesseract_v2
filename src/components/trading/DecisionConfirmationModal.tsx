/**
 * DecisionConfirmationModal — the "Decision Recorded" moment in Trade Lab.
 *
 * Product principle: this is the single most important transition in the
 * entire product. It must feel like a system-level event, not a toast:
 *   1. Communicate what happened (and that the portfolio actually moved)
 *   2. For multi-trade batches: lead with aggregate impact before the list
 *   3. Show the decision receipt (clean, scannable, grouped by action)
 *   4. Show the captured context (thesis, why-now, sizing logic — as cards)
 *   5. Bridge to Trade Book with a dominant primary CTA
 *
 * This component is intentionally dominant (full-screen overlay, generous
 * type), and deliberately not a toast. Keep it clean but weighty.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2, ArrowRight, BookOpen, X, TrendingUp, TrendingDown,
  FileText, Target, Briefcase, Clock, Sparkles, Zap, Layers,
  ChevronDown, ChevronRight,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'
import { Button } from '../ui/Button'
import { logPilotEvent } from '../../lib/pilot/pilot-telemetry'

// ─── Types ────────────────────────────────────────────────────────────

export interface RecordedDecision {
  /** accepted_trades.id — used for highlight-on-navigate */
  tradeId: string
  symbol: string
  companyName?: string | null
  /** buy / sell / add / trim / reduce / close / swap */
  action: string
  deltaWeight: number | null
  targetWeight: number | null
  deltaShares: number | null
  notional: number | null
  priceAtAcceptance: number | null
  sizingInput: string | null
  /** Best-available decision context: acceptance note > variant notes > null */
  acceptanceNote: string | null
  /** Best-available thesis: trade_queue_item.rationale > null */
  thesis: string | null
  /** Best-available "why now" — split from rationale when the "Why now:" marker is present. */
  whyNow?: string | null
  /** Current weight before the trade (from variant.current_position.weight). */
  beforeWeight: number | null
  /** Computed weight after fold (beforeWeight + deltaWeight), rounded. */
  afterWeight: number | null
}

export interface DecisionRecord {
  decisions: RecordedDecision[]
  portfolioName: string
  portfolioId: string
  /** ISO timestamp when the commit returned. */
  recordedAt: string
  /** trade_batches.id of the batch these trades landed in. Used by
   *  the "View in Trade Book" CTA so the destination page can pre-
   *  select the same batch in the left rail. */
  batchId?: string | null
  /** Optional batch name for multi-trade commits. */
  batchName?: string | null
  /** Optional batch-level rationale / thesis for multi-trade commits.
   *  Shown above per-trade context; null when not captured. */
  batchDescription?: string | null
}

interface DecisionConfirmationModalProps {
  record: DecisionRecord | null
  onClose: () => void
  /** Hands off to the Trade Book with both `tradeIds` (for the row
   *  highlight in the Trades view) and the parent batch id (for the
   *  Batches view selection). The parent dispatches a navigation
   *  event with both pieces. */
  onViewTradeBook: (args: { tradeIds: string[]; batchId: string | null }) => void
}

// ─── Helpers ──────────────────────────────────────────────────────────

function fmtPct(n: number | null | undefined, opts: { signed?: boolean } = {}): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (opts.signed) return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)}%`
  return `${n.toFixed(2)}%`
}

function fmtUsd(n: number | null | undefined, opts: { signed?: boolean } = {}): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  const sign = n < 0 ? '−' : opts.signed && n > 0 ? '+' : ''
  let body: string
  if (abs >= 1_000_000) body = `$${(abs / 1_000_000).toFixed(2)}M`
  else if (abs >= 1_000) body = `$${(abs / 1_000).toFixed(1)}K`
  else body = `$${abs.toFixed(0)}`
  return `${sign}${body}`
}

function fmtShares(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  return `${sign}${Math.abs(n).toLocaleString()}`
}

function actionColorClasses(action: string): string {
  const a = action.toLowerCase()
  if (a === 'buy' || a === 'add') return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800'
  if (a === 'sell' || a === 'trim' || a === 'reduce' || a === 'close') return 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800'
  return 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:border-sky-800'
}

function actionIcon(action: string) {
  const a = action.toLowerCase()
  if (a === 'buy' || a === 'add')    return TrendingUp
  if (a === 'sell' || a === 'trim' || a === 'reduce' || a === 'close') return TrendingDown
  return Target
}

type ActionBucket = 'adds' | 'trims' | 'sells' | 'other'

// Map an action verb to one of four semantic buckets. Grouping keeps the
// multi-trade list scannable — "here are the increases, here are the
// reductions" — instead of the raw accept_trades.action order.
function bucketForAction(action: string): ActionBucket {
  const a = action.toLowerCase()
  if (a === 'buy' || a === 'add') return 'adds'
  if (a === 'trim' || a === 'reduce') return 'trims'
  if (a === 'sell' || a === 'close') return 'sells'
  return 'other'
}

const BUCKET_META: Record<ActionBucket, { label: string; accent: string; icon: typeof TrendingUp }> = {
  adds:   { label: 'Adds',         accent: 'text-emerald-700 dark:text-emerald-300', icon: TrendingUp },
  trims:  { label: 'Trims',        accent: 'text-rose-700 dark:text-rose-300',       icon: TrendingDown },
  sells:  { label: 'Sells & Exits', accent: 'text-rose-700 dark:text-rose-300',      icon: TrendingDown },
  other:  { label: 'Other',        accent: 'text-sky-700 dark:text-sky-300',         icon: Target },
}
const BUCKET_ORDER: ActionBucket[] = ['adds', 'trims', 'sells', 'other']

// Sizing-logic summary: short, human-readable, only includes fields we have.
// Starts with the target weight so the reader sees "what" before "how much".
function buildSizingLogic(d: RecordedDecision): string | null {
  const parts: string[] = []
  if (d.targetWeight != null) parts.push(`target ${fmtPct(d.targetWeight)}`)
  if (d.deltaShares != null) parts.push(`${fmtShares(d.deltaShares)} shares`)
  if (d.notional != null) parts.push(`notional ${fmtUsd(d.notional)}`)
  if (d.priceAtAcceptance != null) parts.push(`@ $${d.priceAtAcceptance.toFixed(2)}`)
  if (parts.length === 0) return null
  return parts.join(' · ')
}

// Aggregate impact across the whole record. All fields are "best-available":
// anything that can't be computed reliably from the data on hand is omitted
// by the summary component rather than rendered as "—".
interface AggregateImpact {
  count: number
  adds: number
  trims: number
  sells: number
  other: number
  buyNotional: number        // sum of positive-delta / buy-side notionals
  sellNotional: number       // sum of negative-delta / sell-side notionals (absolute)
  netNotional: number        // buyNotional - sellNotional
  buyDeltaWeight: number     // sum of Δ weight on buy-side rows (positive number)
  sellDeltaWeight: number    // sum of |Δ weight| on sell-side rows (positive number)
  grossDeltaWeight: number   // buy + sell magnitude
  netDeltaWeight: number     // buy - sell (can be negative)
}

function computeAggregate(decisions: RecordedDecision[]): AggregateImpact {
  let adds = 0, trims = 0, sells = 0, other = 0
  let buyNotional = 0, sellNotional = 0
  let buyDeltaWeight = 0, sellDeltaWeight = 0

  for (const d of decisions) {
    const bucket = bucketForAction(d.action)
    if (bucket === 'adds') adds++
    else if (bucket === 'trims') trims++
    else if (bucket === 'sells') sells++
    else other++

    // Prefer the sign of notional_value. Fall back to action bucket when
    // notional is missing. Accumulate absolute magnitudes into buy/sell
    // buckets so the summary shows "how much went in, how much came out".
    const n = d.notional
    if (n != null && Number.isFinite(n)) {
      if (n >= 0) buyNotional += n
      else sellNotional += Math.abs(n)
    }

    const dw = d.deltaWeight
    if (dw != null && Number.isFinite(dw)) {
      if (dw >= 0) buyDeltaWeight += dw
      else sellDeltaWeight += Math.abs(dw)
    }
  }

  return {
    count: decisions.length,
    adds, trims, sells, other,
    buyNotional,
    sellNotional,
    netNotional: buyNotional - sellNotional,
    buyDeltaWeight,
    sellDeltaWeight,
    grossDeltaWeight: buyDeltaWeight + sellDeltaWeight,
    netDeltaWeight: buyDeltaWeight - sellDeltaWeight,
  }
}

// ─── Component ────────────────────────────────────────────────────────

export function DecisionConfirmationModal({
  record, onClose, onViewTradeBook,
}: DecisionConfirmationModalProps) {
  // Close on Escape — but not on backdrop click (too easy to dismiss
  // accidentally; we want the user to take an explicit action).
  useEffect(() => {
    if (!record) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [record, onClose])

  // Telemetry: fire exactly once per distinct record.
  const loggedRecordKey = useRef<string | null>(null)
  useEffect(() => {
    if (!record || record.decisions.length === 0) return
    const key = record.decisions.map(d => d.tradeId).sort().join(',')
    if (loggedRecordKey.current === key) return
    loggedRecordKey.current = key
    logPilotEvent({
      eventType: 'decision_recorded_modal_opened',
      metadata: {
        tradeCount: record.decisions.length,
        portfolioId: record.portfolioId,
        tradeIds: record.decisions.map(d => d.tradeId),
      },
    })
  }, [record])

  const ids = useMemo(() => (record?.decisions ?? []).map(d => d.tradeId), [record])

  // For multi-trade records, collapse the long list of trades after 3.
  // "Expanded" is opt-in so the PM can keep the modal tight on first view
  // and expand only if they want to inspect each leg.
  const [tradesExpanded, setTradesExpanded] = useState(false)
  // Reset the expand state whenever the record changes (new execute).
  const prevRecordKey = useRef<string | null>(null)
  useEffect(() => {
    const key = record?.decisions.map(d => d.tradeId).sort().join(',') ?? null
    if (key !== prevRecordKey.current) {
      prevRecordKey.current = key
      setTradesExpanded(false)
    }
  }, [record])

  // Group decisions by action bucket. Computed before the early-return
  // guard so the hook count stays stable whether or not we have a record —
  // putting useMemo calls below `if (!record) return null` would trip React
  // with "Rendered fewer hooks than expected".
  const decisions = record?.decisions ?? []
  const buckets = useMemo(() => {
    const by: Record<ActionBucket, RecordedDecision[]> = { adds: [], trims: [], sells: [], other: [] }
    for (const d of decisions) {
      by[bucketForAction(d.action)].push(d)
    }
    return by
  }, [decisions])

  // Flat ordered list for collapsed / single-trade rendering (adds → trims
  // → sells → other, preserving within-bucket order).
  const orderedDecisions = useMemo(() => {
    const out: RecordedDecision[] = []
    for (const b of BUCKET_ORDER) out.push(...buckets[b])
    return out
  }, [buckets])

  if (!record || record.decisions.length === 0) return null

  const handleStay = () => {
    logPilotEvent({
      eventType: 'decision_recorded_stay_in_trade_lab_clicked',
      metadata: { tradeIds: ids, tradeCount: ids.length },
    })
    onClose()
  }

  const handleViewTradeBook = () => {
    logPilotEvent({
      eventType: 'decision_recorded_view_trade_book_clicked',
      metadata: { tradeIds: ids, tradeCount: ids.length },
    })
    onViewTradeBook({ tradeIds: ids, batchId: record?.batchId ?? null })
  }

  const isMulti = record.decisions.length > 1
  const primary = record.decisions[0]
  const aggregate = computeAggregate(record.decisions)

  // Collapsed display: first 3 only when multi-trade and not expanded.
  const HIDE_THRESHOLD = 3
  const showingAll = !isMulti || tradesExpanded || record.decisions.length <= HIDE_THRESHOLD
  const visibleOrdered = showingAll ? orderedDecisions : orderedDecisions.slice(0, HIDE_THRESHOLD)
  const hiddenCount = orderedDecisions.length - visibleOrdered.length

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto">
      {/* Backdrop — note: no onClick, user must use a button to dismiss. */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity" />

      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-2xl w-full mx-auto transform transition-all flex flex-col overflow-hidden">

          {/* ─── Hero header ────────────────────────────────────── */}
          <div className="relative bg-gradient-to-br from-emerald-50 via-white to-primary-50 dark:from-emerald-900/20 dark:via-gray-900 dark:to-primary-900/20 px-6 py-5 border-b border-gray-200 dark:border-gray-700">
            <button
              onClick={handleStay}
              className="absolute top-3 right-3 p-1.5 text-gray-400 hover:text-gray-600 hover:bg-white/60 rounded-lg"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-xl bg-white shadow-md flex items-center justify-center shrink-0 ring-1 ring-emerald-100 dark:ring-emerald-900/50">
                {isMulti
                  ? <Layers className="w-7 h-7 text-emerald-500" />
                  : <CheckCircle2 className="w-7 h-7 text-emerald-500" />}
              </div>
              <div className="min-w-0 flex-1 pr-8">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                    {isMulti ? 'Batch Decision Recorded' : 'Decision Recorded'}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-500">
                    <Clock className="w-2.5 h-2.5" />
                    {formatDistanceToNow(new Date(record.recordedAt), { addSuffix: true })}
                  </span>
                </div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white leading-tight">
                  {isMulti
                    ? `${record.decisions.length} trades committed to Trade Book`
                    : `${primary.symbol} ${primary.action} — committed to Trade Book`}
                </h2>
                <p className="text-sm text-gray-700 dark:text-gray-300 mt-1.5 font-medium">
                  {isMulti
                    ? 'This batch decision updated multiple positions in your portfolio.'
                    : 'Your portfolio now reflects this decision.'}
                </p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                  {record.portfolioName}{record.batchName ? ` · Batch: ${record.batchName}` : ''}
                </p>
              </div>
            </div>
          </div>

          {/* ─── Scrollable body ────────────────────────────────── */}
          <div className="overflow-y-auto px-6 py-5 space-y-5 max-h-[60vh]">

            {/* Aggregate summary — multi-trade only. Leads with the
                numbers so the PM understands the size of the move before
                scanning individual legs. */}
            {isMulti && <AggregateSummary aggregate={aggregate} />}

            {/* Batch context — multi-trade only. Shown above per-trade
                context so the shared "why this basket" story reads first. */}
            {isMulti && <BatchContextSection description={record.batchDescription ?? null} />}

            {/* What was executed */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <SectionHeading icon={Briefcase} label="What was executed" />
                {!showingAll && hiddenCount > 0 && (
                  <span className="text-[10px] text-gray-400 dark:text-gray-500">
                    Showing {visibleOrdered.length} of {orderedDecisions.length}
                  </span>
                )}
              </div>

              {isMulti ? (
                // Grouped rendering: each bucket gets a lightweight label row
                // plus its decision cards. Hidden buckets in the collapsed
                // state show a short count next to the label.
                <GroupedDecisions
                  buckets={buckets}
                  showingAll={showingAll}
                  hideThreshold={HIDE_THRESHOLD}
                />
              ) : (
                <div className="space-y-2">
                  <DecisionRow decision={primary} />
                </div>
              )}

              {isMulti && orderedDecisions.length > HIDE_THRESHOLD && (
                <div className="mt-3">
                  <button
                    onClick={() => setTradesExpanded(v => !v)}
                    className="inline-flex items-center gap-1 text-[12px] font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300"
                  >
                    {tradesExpanded
                      ? <><ChevronDown className="w-3.5 h-3.5" /> Show fewer</>
                      : <><ChevronRight className="w-3.5 h-3.5" /> View all {orderedDecisions.length} trades</>}
                  </button>
                </div>
              )}
            </section>

            {/* What was captured — per-trade */}
            <section>
              <SectionHeading
                icon={FileText}
                label={isMulti ? 'Per-trade context' : 'What was captured'}
              />
              <div className="space-y-2">
                {(showingAll ? orderedDecisions : visibleOrdered).map(d =>
                  <CapturedBlock key={d.tradeId} decision={d} isMulti={isMulti} />,
                )}
              </div>
              {isMulti && !showingAll && hiddenCount > 0 && (
                <p className="text-[11px] text-gray-400 dark:text-gray-500 italic mt-2">
                  + {hiddenCount} more trade{hiddenCount !== 1 ? 's' : ''} — expand to view their context.
                </p>
              )}
            </section>

            {/* Trade Book bridge */}
            <section className="rounded-xl border-2 border-indigo-200 dark:border-indigo-800/60 bg-gradient-to-br from-indigo-50 via-white to-blue-50 dark:from-indigo-900/20 dark:via-gray-900 dark:to-blue-900/20 p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-white dark:bg-gray-900 shadow-md flex items-center justify-center shrink-0 ring-1 ring-indigo-100 dark:ring-indigo-800/50">
                  <BookOpen className="w-5 h-5 text-indigo-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Zap className="w-3 h-3 text-indigo-500" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                      Now tracked in your Trade Book
                    </span>
                  </div>
                  <p className="text-sm text-gray-800 dark:text-gray-200 leading-snug">
                    {isMulti
                      ? 'Every trade in this batch is preserved alongside its sizing and context. Outcomes will evaluate each leg, and the batch decision as a whole, over time.'
                      : 'Your Trade Book now preserves the decision, sizing, and context from this moment. Outcomes will use this record to evaluate whether the thesis played out.'}
                  </p>
                </div>
              </div>
            </section>
          </div>

          {/* ─── Footer CTAs ─────────────────────────────────────
              Sticky inside the flex container — stays visible even if the
              scrollable body is long (important for multi-trade records). */}
          <div className="px-6 pt-4 pb-5 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shrink-0 sticky bottom-0">
            <p className="text-[11px] text-center text-gray-500 dark:text-gray-400 mb-3">
              See how {isMulti ? 'this batch' : 'this decision'} is tracked.
            </p>
            <Button
              onClick={handleViewTradeBook}
              size="lg"
              className="w-full !py-3.5 text-base font-semibold bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 shadow-lg hover:shadow-xl transition-shadow"
            >
              <BookOpen className="w-5 h-5 mr-2" />
              View in Trade Book
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
            <div className="mt-2.5 text-center">
              <button
                onClick={handleStay}
                className="inline-flex items-center gap-1 text-[12px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                Stay in Trade Lab
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────

function SectionHeading({ icon: Icon, label }: { icon: typeof FileText; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="w-3.5 h-3.5 text-gray-400" />
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {label}
      </h3>
    </div>
  )
}

// Top-of-body aggregate summary for multi-trade records. Compact grid with
// only the stats we can compute reliably from the record. Counts row
// shows "N adds · M trims · K sells" omitting any bucket that's empty.
function AggregateSummary({ aggregate: a }: { aggregate: AggregateImpact }) {
  const countParts: string[] = []
  if (a.adds > 0) countParts.push(`${a.adds} add${a.adds !== 1 ? 's' : ''}`)
  if (a.trims > 0) countParts.push(`${a.trims} trim${a.trims !== 1 ? 's' : ''}`)
  if (a.sells > 0) countParts.push(`${a.sells} sell${a.sells !== 1 ? 's' : ''}`)
  if (a.other > 0) countParts.push(`${a.other} other`)

  const hasNotional = a.buyNotional > 0 || a.sellNotional > 0
  const hasWeight = a.buyDeltaWeight > 0 || a.sellDeltaWeight > 0

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gradient-to-br from-gray-50 to-white dark:from-gray-800/60 dark:to-gray-900/40 p-4">
      <div className="flex items-center gap-1.5 mb-3">
        <Layers className="w-3.5 h-3.5 text-indigo-500" />
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Batch impact
        </h3>
      </div>

      {/* Stat grid. Each cell is optional — cells for unavailable data
          are omitted so we never show "—" placeholders. */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCell
          label={`Trade${a.count !== 1 ? 's' : ''}`}
          value={a.count.toLocaleString()}
          sub={countParts.length > 0 ? countParts.join(' · ') : null}
        />

        {hasNotional && (
          <StatCell
            label="Net cash"
            value={fmtUsd(-a.netNotional, { signed: true })}
            sub={
              a.buyNotional > 0 && a.sellNotional > 0
                ? `${fmtUsd(a.buyNotional)} in · ${fmtUsd(a.sellNotional)} out`
                : a.buyNotional > 0
                  ? `${fmtUsd(a.buyNotional)} deployed`
                  : `${fmtUsd(a.sellNotional)} released`
            }
            valueTone={a.netNotional > 0 ? 'buy' : a.netNotional < 0 ? 'sell' : 'neutral'}
          />
        )}

        {hasNotional && (
          <StatCell
            label="Gross traded"
            value={fmtUsd(a.buyNotional + a.sellNotional)}
            sub={null}
          />
        )}

        {hasWeight && (
          <StatCell
            label="Net Δ weight"
            value={fmtPct(a.netDeltaWeight, { signed: true })}
            sub={
              a.buyDeltaWeight > 0 && a.sellDeltaWeight > 0
                ? `${fmtPct(a.buyDeltaWeight, { signed: true })} / −${a.sellDeltaWeight.toFixed(2)}%`
                : null
            }
            valueTone={a.netDeltaWeight > 0 ? 'buy' : a.netDeltaWeight < 0 ? 'sell' : 'neutral'}
          />
        )}

        {hasWeight && (
          <StatCell
            label="Gross Δ weight"
            value={fmtPct(a.grossDeltaWeight)}
            sub="total portfolio churn"
          />
        )}
      </div>
    </section>
  )
}

function StatCell({ label, value, sub, valueTone = 'neutral' }: {
  label: string
  value: React.ReactNode
  sub: React.ReactNode | null
  valueTone?: 'buy' | 'sell' | 'neutral'
}) {
  const toneClass =
    valueTone === 'buy'  ? 'text-emerald-600 dark:text-emerald-400' :
    valueTone === 'sell' ? 'text-rose-600 dark:text-rose-400' :
    'text-gray-900 dark:text-white'
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-0.5">
        {label}
      </div>
      <div className={clsx('text-base font-semibold tabular-nums leading-tight', toneClass)}>
        {value}
      </div>
      {sub && (
        <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 truncate">
          {sub}
        </div>
      )}
    </div>
  )
}

// Batch-level rationale ("why this whole basket?"). Shown for multi-trade
// records. When no description was captured we still render a muted
// placeholder so the section isn't missing entirely — the absence is
// visible, and the copy hints that it can be added later from Trade Book.
function BatchContextSection({ description }: { description: string | null }) {
  if (description) {
    return (
      <section>
        <SectionHeading icon={Sparkles} label="Batch context" />
        <div className="mt-2 rounded-lg border-l-2 border-amber-400 bg-amber-50/40 dark:bg-amber-900/10 border-t border-r border-b border-amber-200/70 dark:border-amber-800/40 px-3 py-2.5">
          <p className="text-[12px] text-gray-700 dark:text-gray-200 leading-snug whitespace-pre-wrap">
            {description}
          </p>
        </div>
      </section>
    )
  }
  return (
    <section>
      <SectionHeading icon={Sparkles} label="Batch context" />
      <div className="mt-2 rounded-lg border border-dashed border-gray-200 dark:border-gray-700 px-3 py-2 text-[12px] text-gray-500 dark:text-gray-400 italic">
        No shared rationale captured for this batch. You can add one from the Trade Book batch panel.
      </div>
    </section>
  )
}

// Grouped multi-trade decision rendering. Each bucket gets a small colored
// header (count + label) above its cards. Buckets with zero trades are
// omitted. In the collapsed state we slice from the flat ordered list —
// bucketing here is purely visual and respects the ordering already
// computed by the parent.
function GroupedDecisions({
  buckets,
  showingAll,
  hideThreshold,
}: {
  buckets: Record<ActionBucket, RecordedDecision[]>
  showingAll: boolean
  hideThreshold: number
}) {
  // For the collapsed path, walk buckets in canonical order and stop after
  // `hideThreshold`. This keeps grouping consistent with the "ordered
  // list" used in the parent's hidden-count math.
  let remaining = showingAll ? Infinity : hideThreshold

  return (
    <div className="space-y-3">
      {BUCKET_ORDER.map(bucket => {
        const rows = buckets[bucket]
        if (rows.length === 0) return null
        if (remaining <= 0) return null
        const visible = rows.slice(0, remaining)
        remaining -= visible.length
        const meta = BUCKET_META[bucket]
        const Icon = meta.icon
        return (
          <div key={bucket}>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Icon className={clsx('w-3 h-3', meta.accent)} />
              <span className={clsx('text-[10px] font-bold uppercase tracking-wider', meta.accent)}>
                {meta.label}
              </span>
              <span className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">
                · {rows.length}
              </span>
            </div>
            <div className="space-y-2">
              {visible.map(d => <DecisionRow key={d.tradeId} decision={d} />)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function DecisionRow({ decision: d }: { decision: RecordedDecision }) {
  const Icon = actionIcon(d.action)
  const hasWeightMove = d.beforeWeight != null && d.afterWeight != null
  const hasDelta = d.deltaWeight != null
  const hasNotional = d.notional != null && d.notional !== 0

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
      <div className="flex items-center gap-3">
        <div className="shrink-0 w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
          <span className="text-[11px] font-bold text-gray-700 dark:text-gray-200">{d.symbol.slice(0, 5)}</span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900 dark:text-white">{d.symbol}</span>
            <span
              className={clsx('inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium capitalize', actionColorClasses(d.action))}
            >
              <Icon className="w-2.5 h-2.5" />
              {d.action}
            </span>
          </div>
          {d.companyName && (
            <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate mt-0.5">{d.companyName}</div>
          )}
        </div>

        {hasDelta && (
          <div className="shrink-0 text-right">
            <div className={clsx(
              'text-lg font-semibold tabular-nums leading-none',
              d.deltaWeight! > 0 ? 'text-emerald-600 dark:text-emerald-400' :
              d.deltaWeight! < 0 ? 'text-rose-600 dark:text-rose-400' :
              'text-gray-700 dark:text-gray-300'
            )}>
              {fmtPct(d.deltaWeight, { signed: true })}
            </div>
            <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">Δ weight</div>
          </div>
        )}
      </div>

      {(hasWeightMove || hasNotional) && (
        <div className="mt-2.5 pt-2.5 border-t border-gray-100 dark:border-gray-700/60 flex items-center gap-4 text-[11px] tabular-nums">
          {hasWeightMove && (
            <div className="flex items-center gap-1.5">
              <span className="text-gray-400 dark:text-gray-500">Weight</span>
              <span className="text-gray-500 dark:text-gray-400">{fmtPct(d.beforeWeight)}</span>
              <ArrowRight className="w-3 h-3 text-gray-400" />
              <span className="font-semibold text-gray-900 dark:text-white">{fmtPct(d.afterWeight)}</span>
            </div>
          )}
          {hasNotional && (
            <div className="flex items-center gap-1.5 ml-auto">
              <span className="text-gray-400 dark:text-gray-500">Notional</span>
              <span className={clsx(
                'font-semibold',
                d.notional! > 0 ? 'text-emerald-600 dark:text-emerald-400' :
                d.notional! < 0 ? 'text-rose-600 dark:text-rose-400' :
                'text-gray-700 dark:text-gray-300',
              )}>
                {fmtUsd(d.notional)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CapturedBlock({ decision: d, isMulti }: { decision: RecordedDecision; isMulti: boolean }) {
  const thesis = d.thesis?.trim() || null
  const whyNow = d.whyNow?.trim() || null
  const note = d.acceptanceNote?.trim() || null
  const sizingLogic = buildSizingLogic(d)

  const hasAny = !!(thesis || whyNow || note || sizingLogic)

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 p-3">
      {isMulti && (
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-200">{d.symbol}</span>
          <span className="text-[10px] text-gray-500 capitalize">{d.action}</span>
        </div>
      )}

      {!hasAny && (
        <p className="text-[12px] text-gray-500 dark:text-gray-400 italic leading-snug">
          No rationale captured yet — you can add it later from Trade Book.
        </p>
      )}

      <div className="grid grid-cols-1 gap-2">
        {thesis && <CaptureCard icon={Sparkles} label="Thesis" body={thesis} tone="amber" />}
        {whyNow && <CaptureCard icon={Zap} label="Why now" body={whyNow} tone="indigo" />}
        {sizingLogic && <CaptureCard icon={Target} label="Sizing logic" body={sizingLogic} tone="emerald" mono />}
        {note && <CaptureCard icon={FileText} label="Decision note" body={note} tone="slate" />}
      </div>
    </div>
  )
}

type CaptureTone = 'amber' | 'indigo' | 'emerald' | 'slate'
const CAPTURE_TONES: Record<CaptureTone, {
  rail: string
  labelText: string
  iconColor: string
  bodyBg: string
  border: string
}> = {
  amber: {
    rail: 'before:bg-amber-400',
    labelText: 'text-amber-700 dark:text-amber-300',
    iconColor: 'text-amber-500',
    bodyBg: 'bg-amber-50/40 dark:bg-amber-900/10',
    border: 'border-amber-200/70 dark:border-amber-800/40',
  },
  indigo: {
    rail: 'before:bg-indigo-400',
    labelText: 'text-indigo-700 dark:text-indigo-300',
    iconColor: 'text-indigo-500',
    bodyBg: 'bg-indigo-50/40 dark:bg-indigo-900/10',
    border: 'border-indigo-200/70 dark:border-indigo-800/40',
  },
  emerald: {
    rail: 'before:bg-emerald-400',
    labelText: 'text-emerald-700 dark:text-emerald-300',
    iconColor: 'text-emerald-500',
    bodyBg: 'bg-emerald-50/40 dark:bg-emerald-900/10',
    border: 'border-emerald-200/70 dark:border-emerald-800/40',
  },
  slate: {
    rail: 'before:bg-slate-400',
    labelText: 'text-slate-600 dark:text-slate-300',
    iconColor: 'text-slate-500',
    bodyBg: 'bg-slate-50/60 dark:bg-slate-800/40',
    border: 'border-slate-200/70 dark:border-slate-700/50',
  },
}

function CaptureCard({ icon: Icon, label, body, tone, mono }: {
  icon: typeof Sparkles
  label: string
  body: string
  tone: CaptureTone
  mono?: boolean
}) {
  const t = CAPTURE_TONES[tone]
  return (
    <div
      className={clsx(
        'relative rounded-md border pl-3 pr-2.5 py-2.5',
        'before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:rounded-l-md',
        t.bodyBg,
        t.border,
        t.rail,
      )}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={clsx('w-3 h-3', t.iconColor)} />
        <span className={clsx('text-[10px] font-bold uppercase tracking-wider', t.labelText)}>
          {label}
        </span>
      </div>
      <p className={clsx(
        'text-[12px] leading-snug text-gray-700 dark:text-gray-200 whitespace-pre-wrap line-clamp-4',
        mono && 'font-mono text-[11px]',
      )}>
        {body}
      </p>
    </div>
  )
}
