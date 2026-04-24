/**
 * DecisionConfirmationModal — the "Decision Recorded" moment in Trade Lab.
 *
 * Product principle: this is the single most important transition in the
 * entire product. It must feel like a system-level event, not a toast:
 *   1. Communicate what happened
 *   2. Show what was captured
 *   3. Introduce Trade Book as the natural next step
 *   4. Drive the user into Trade Book with a strong CTA
 *
 * This component is intentionally dominant (full-screen overlay, large type),
 * and deliberately not a toast. Keep it clean but weighty.
 */

import { useEffect, useMemo } from 'react'
import {
  CheckCircle2, ArrowRight, BookOpen, X, TrendingUp, TrendingDown,
  FileText, Target, Briefcase, Clock, Sparkles,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'
import { Button } from '../ui/Button'

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
  /** Best-available "why now" — for v1 we pull from the same rationale field
   *  if it's available; can be extended once tqi has a distinct column. */
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
  /** Optional batch name for multi-trade commits. */
  batchName?: string | null
}

interface DecisionConfirmationModalProps {
  record: DecisionRecord | null
  onClose: () => void
  onViewTradeBook: (tradeIds: string[]) => void
}

// ─── Helpers ──────────────────────────────────────────────────────────

function fmtPct(n: number | null | undefined, opts: { signed?: boolean } = {}): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const val = n.toFixed(2)
  if (opts.signed) return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)}%`
  return `${val}%`
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

function fmtShares(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  return `${sign}${Math.abs(n).toLocaleString()}`
}

function actionColorClasses(action: string): string {
  const a = action.toLowerCase()
  if (a === 'buy' || a === 'add') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (a === 'sell' || a === 'trim' || a === 'reduce' || a === 'close') return 'bg-rose-50 text-rose-700 border-rose-200'
  return 'bg-sky-50 text-sky-700 border-sky-200'
}

function actionIcon(action: string) {
  const a = action.toLowerCase()
  if (a === 'buy' || a === 'add')    return TrendingUp
  if (a === 'sell' || a === 'trim' || a === 'reduce' || a === 'close') return TrendingDown
  return Target
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

  const ids = useMemo(() => (record?.decisions ?? []).map(d => d.tradeId), [record])

  if (!record || record.decisions.length === 0) return null

  const isMulti = record.decisions.length > 1
  const primary = record.decisions[0]

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto">
      {/* Backdrop — note: no onClick, user must use a button to dismiss. */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity" />

      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-2xl w-full mx-auto transform transition-all flex flex-col overflow-hidden">

          {/* ─── Hero header ────────────────────────────────────── */}
          <div className="relative bg-gradient-to-br from-emerald-50 via-white to-primary-50 dark:from-emerald-900/20 dark:via-gray-900 dark:to-primary-900/20 px-6 py-5 border-b border-gray-200 dark:border-gray-700">
            <button
              onClick={onClose}
              className="absolute top-3 right-3 p-1.5 text-gray-400 hover:text-gray-600 hover:bg-white/60 rounded-lg"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-xl bg-white shadow-md flex items-center justify-center shrink-0 ring-1 ring-emerald-100">
                <CheckCircle2 className="w-7 h-7 text-emerald-500" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                    Decision Recorded
                  </span>
                  <span className="inline-flex items-center gap-1 text-[10px] text-gray-500">
                    <Clock className="w-2.5 h-2.5" />
                    {formatDistanceToNow(new Date(record.recordedAt), { addSuffix: true })}
                  </span>
                </div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white leading-tight">
                  {isMulti
                    ? `${record.decisions.length} trades committed`
                    : `${primary.symbol} ${primary.action} — committed to Trade Book`}
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                  Your decision is now the system of record for {record.portfolioName}.
                  {record.batchName ? ` Batch: ${record.batchName}.` : ''}
                </p>
              </div>
            </div>
          </div>

          {/* ─── Scrollable body ────────────────────────────────── */}
          <div className="overflow-y-auto px-6 py-5 space-y-5 max-h-[60vh]">

            {/* Summary of action(s) */}
            <section>
              <SectionHeading icon={Briefcase} label="What was executed" />
              <div className="space-y-2">
                {record.decisions.map(d => <DecisionRow key={d.tradeId} decision={d} />)}
              </div>
            </section>

            {/* What was captured */}
            <section>
              <SectionHeading icon={FileText} label="What was captured" />
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700 bg-gray-50/50 dark:bg-gray-800/50">
                {record.decisions.map(d => <CapturedRow key={d.tradeId} decision={d} isMulti={isMulti} />)}
              </div>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2 italic">
                Thesis, sizing logic, and portfolio context are preserved with the trade. This is what
                Outcomes will use later to evaluate whether the thesis played out.
              </p>
            </section>

            {/* System impact */}
            <section className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50/70 to-blue-50/70 dark:from-indigo-900/20 dark:to-blue-900/20 p-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-white dark:bg-gray-900 shadow-sm flex items-center justify-center shrink-0">
                  <BookOpen className="w-4 h-4 text-indigo-500" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                    This decision is now tracked in your Trade Book
                  </h3>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                    {record.portfolioName} holdings have been updated. Every piece of context from this
                    moment — thesis, sizing, and portfolio state — is preserved and will be evaluated over
                    time in Outcomes.
                  </p>
                </div>
              </div>
            </section>
          </div>

          {/* ─── Footer CTAs ────────────────────────────────────── */}
          {/* Primary is visually dominant: lg size + emphasis gradient + icon on both sides.
              Secondary is a subdued text link so the eye goes to the primary. */}
          <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex items-center justify-between gap-3 shrink-0">
            <button
              onClick={onClose}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              Stay in Trade Lab
            </button>
            <Button onClick={() => onViewTradeBook(ids)} size="lg" className="shadow-md hover:shadow-lg">
              <BookOpen className="w-5 h-5 mr-2" />
              View in Trade Book
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </div>

        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────

function SectionHeading({ icon: Icon, label }: { icon: typeof FileText; label: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      <Icon className="w-3.5 h-3.5 text-gray-400" />
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {label}
      </h3>
    </div>
  )
}

function DecisionRow({ decision: d }: { decision: RecordedDecision }) {
  const Icon = actionIcon(d.action)
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      {/* Symbol block */}
      <div className="shrink-0">
        <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
          <span className="text-sm font-bold text-gray-700 dark:text-gray-200">{d.symbol.slice(0, 4)}</span>
        </div>
      </div>

      {/* Identity */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-900 dark:text-white">{d.symbol}</span>
          <span
            className={clsx('inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium capitalize', actionColorClasses(d.action))}
          >
            <Icon className="w-2.5 h-2.5" />
            {d.action}
          </span>
          {d.sizingInput && (
            <span className="text-[10px] text-gray-500 dark:text-gray-400 font-mono bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
              {d.sizingInput}
            </span>
          )}
        </div>
        {d.companyName && <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{d.companyName}</div>}
      </div>

      {/* Weight change */}
      <div className="shrink-0 text-right">
        {d.deltaWeight != null ? (
          <>
            <div className={clsx(
              'text-sm font-semibold tabular-nums',
              d.deltaWeight > 0 ? 'text-emerald-600 dark:text-emerald-400' :
              d.deltaWeight < 0 ? 'text-rose-600 dark:text-rose-400' :
              'text-gray-700 dark:text-gray-300'
            )}>
              {fmtPct(d.deltaWeight, { signed: true })}
            </div>
            <div className="text-[10px] text-gray-500 dark:text-gray-400">
              Δ weight
            </div>
          </>
        ) : (
          <div className="text-xs text-gray-400">—</div>
        )}
      </div>

      {/* Before → After weight */}
      {d.beforeWeight != null && d.afterWeight != null && (
        <div className="shrink-0 min-w-[7rem] text-right border-l border-gray-100 dark:border-gray-700 pl-3">
          <div className="flex items-center justify-end gap-1 text-xs tabular-nums">
            <span className="text-gray-500 dark:text-gray-400">{fmtPct(d.beforeWeight)}</span>
            <ArrowRight className="w-3 h-3 text-gray-400" />
            <span className="font-semibold text-gray-900 dark:text-white">{fmtPct(d.afterWeight)}</span>
          </div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400">weight</div>
        </div>
      )}
    </div>
  )
}

function CapturedRow({ decision: d, isMulti }: { decision: RecordedDecision; isMulti: boolean }) {
  const hasThesis    = !!d.thesis?.trim()
  const hasNote      = !!d.acceptanceNote?.trim()
  const hasSizing    = !!d.sizingInput?.trim()
  const hasNotional  = d.notional != null
  const nothingExtra = !hasThesis && !hasNote && !hasSizing && !hasNotional

  return (
    <div className="p-3 space-y-2">
      {isMulti && (
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-200">{d.symbol}</span>
          <span className="text-[10px] text-gray-500 capitalize">{d.action}</span>
        </div>
      )}
      {hasThesis && (
        <CaptureField icon={Sparkles} label="Thesis">
          <p className="text-xs text-gray-700 dark:text-gray-300 leading-snug whitespace-pre-wrap">{d.thesis}</p>
        </CaptureField>
      )}
      {hasNote && (
        <CaptureField icon={FileText} label="Decision note">
          <p className="text-xs text-gray-700 dark:text-gray-300 leading-snug whitespace-pre-wrap">{d.acceptanceNote}</p>
        </CaptureField>
      )}
      {hasSizing && (
        <CaptureField icon={Target} label="Sizing logic">
          <p className="text-xs text-gray-700 dark:text-gray-300 leading-snug font-mono">
            {d.sizingInput}
            {d.targetWeight != null && ` · target ${fmtPct(d.targetWeight)}`}
            {d.deltaShares != null && ` · ${fmtShares(d.deltaShares)} shares`}
            {hasNotional && ` · notional ${fmtUsd(d.notional)}`}
            {d.priceAtAcceptance != null && ` @ $${d.priceAtAcceptance.toFixed(2)}`}
          </p>
        </CaptureField>
      )}
      {nothingExtra && (
        <p className="text-xs text-gray-500 dark:text-gray-400 italic">
          Context not captured for this trade — you can add rationale any time from the Trade Book.
        </p>
      )}
    </div>
  )
}

function CaptureField({ icon: Icon, label, children }: { icon: typeof Sparkles; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="w-3.5 h-3.5 text-primary-500 mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">{label}</div>
        {children}
      </div>
    </div>
  )
}
