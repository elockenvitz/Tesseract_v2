/**
 * Decision Memory, summarised.
 *
 * The full narrative is `DecisionTimeline` on the Decisions sub-page. This is
 * the Snapshot's and the phone's version of the same truth: how far the most
 * recent thread actually got, and how well the execution claim is supported.
 *
 * ── Why a summary rather than a shorter timeline ─────────────────────────
 *
 * A landing surface answers "where does this stand", not "what happened in
 * order". Truncating the timeline to four rows answers neither: the newest
 * four events on an active name are often four executions, which says nothing
 * about whether anything is waiting on a decision.
 *
 * So this counts the states instead, and names the furthest one reached. It
 * reads the SAME hook as the timeline — no second query, no second rule for
 * what counts as executed — and it never upgrades a weaker proof grade into a
 * stronger one.
 */

import { clsx } from 'clsx'
import { CheckCircle2, Clock, FileText, Scale, AlertTriangle } from 'lucide-react'
import { useAssetDecisionTimeline } from '../../hooks/useAssetDecisionTimeline'
import { parseTimelineDate } from '../../lib/asset-decisions/timeline'
import { OBSERVED_PROOFS, EXECUTION_PROOF_LABELS } from '../../types/decision-timeline'
import type { DecisionTimelineEvent } from '../../types/decision-timeline'

export interface DecisionMemoryStats {
  recommended: number
  decided: number
  committed: number
  /** Committed and NOT executed. The state most worth surfacing. */
  unfilled: number
  executed: number
  /** Of the executions, how many were actually observed. */
  executedObserved: number
  reviewed: number
  /** The furthest state this name has reached, newest-first. */
  furthest: DecisionTimelineEvent | null
  total: number
}

/**
 * Count the states. Exported and pure so the same numbers can be asserted
 * without rendering, and so the phone and the Snapshot cannot drift.
 */
export function summariseDecisionMemory(events: DecisionTimelineEvent[]): DecisionMemoryStats {
  const s: DecisionMemoryStats = {
    recommended: 0, decided: 0, committed: 0, unfilled: 0,
    executed: 0, executedObserved: 0, reviewed: 0, furthest: null, total: events.length,
  }
  for (const e of events) {
    switch (e.type) {
      case 'proposal_submitted': s.recommended++; break
      case 'decision_accepted':
      case 'decision_rejected':
      case 'decision_deferred': s.decided++; break
      case 'trade_committed': s.committed++; break
      case 'execution_pending': s.unfilled++; break
      case 'trade_executed':
        s.executed++
        if (e.executionProof && OBSERVED_PROOFS.includes(e.executionProof)) s.executedObserved++
        break
      case 'review_recorded':
      case 'outcome_evaluated': s.reviewed++; break
    }
  }
  /*
   * "Furthest" is by PHASE, not by date. The newest event on a name can be a
   * recommendation filed after a trade already executed, and reporting that
   * as the state of play would walk the reader backwards.
   */
  const rank: Record<string, number> = { exploratory: 0, formal: 1, execution: 2, review: 3 }
  for (const e of events) {
    if (!s.furthest || rank[e.phase] > rank[s.furthest.phase]) s.furthest = e
  }
  return s
}

/** One line of plain English for the state of play. Null when there is none. */
export function decisionMemoryHeadline(s: DecisionMemoryStats): string | null {
  if (s.total === 0) return null
  if (s.unfilled > 0) {
    return `${s.unfilled} ${s.unfilled === 1 ? 'trade' : 'trades'} committed and not yet executed`
  }
  if (s.executed > 0) {
    const unobserved = s.executed - s.executedObserved
    if (unobserved > 0) {
      // The honest version. Saying "3 executed" when only 1 was observed
      // asserts two fills nobody watched.
      return `${s.executed} executed · ${s.executedObserved} observed, ${unobserved} not`
    }
    return `${s.executed} executed, all observed`
  }
  if (s.decided > 0) return `${s.decided} decided, none executed`
  if (s.recommended > 0) return `${s.recommended} recommended, awaiting a decision`
  return 'Early work only'
}

interface Props {
  assetId: string
  portfolioId?: string | null
  symbol?: string | null
  /** Rendered denser on a phone. */
  compact?: boolean
  onOpenTimeline?: () => void
  className?: string
}

export function DecisionMemorySummary({
  assetId, portfolioId = null, symbol, compact, onOpenTimeline, className,
}: Props) {
  const { allEvents, isLoading } = useAssetDecisionTimeline({ assetId, portfolioId })
  const s = summariseDecisionMemory(allEvents)
  const headline = decisionMemoryHeadline(s)

  if (isLoading) {
    return (
      <div className={clsx('space-y-2', className)} data-testid="decision-memory-summary-loading">
        <div className="h-3 w-2/3 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
        <div className="h-3 w-1/2 rounded bg-gray-50 dark:bg-gray-800/60 animate-pulse" />
      </div>
    )
  }

  if (s.total === 0) {
    return (
      <p
        className="text-[12px] text-gray-600 dark:text-gray-400"
        data-testid="decision-memory-summary-empty"
      >
        No decision has been recorded against {symbol ?? 'this name'} yet.
      </p>
    )
  }

  const chips: { key: string; label: string; n: number; icon: typeof FileText; tone: string }[] = [
    { key: 'recommended', label: 'Recommended', n: s.recommended, icon: FileText, tone: 'text-violet-700 bg-violet-50 dark:bg-violet-900/30 dark:text-violet-300' },
    { key: 'decided', label: 'Decided', n: s.decided, icon: Scale, tone: 'text-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-300' },
    { key: 'unfilled', label: 'Unfilled', n: s.unfilled, icon: Clock, tone: 'text-amber-800 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-300' },
    { key: 'executed', label: 'Executed', n: s.executed, icon: CheckCircle2, tone: 'text-emerald-800 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-300' },
    { key: 'reviewed', label: 'Reviewed', n: s.reviewed, icon: Scale, tone: 'text-indigo-700 bg-indigo-50 dark:bg-indigo-900/30 dark:text-indigo-300' },
  ].filter(c => c.n > 0)

  const unobserved = s.executed - s.executedObserved

  return (
    <div className={clsx('space-y-2', className)} data-testid="decision-memory-summary">
      {headline && (
        <p className={clsx(
          'font-medium text-gray-900 dark:text-gray-100',
          compact ? 'text-[13px]' : 'text-[12px]',
        )}>
          {headline}
        </p>
      )}

      <div className="flex flex-wrap gap-1">
        {chips.map(c => {
          const Icon = c.icon
          return (
            <span
              key={c.key}
              data-testid={`memory-chip-${c.key}`}
              className={clsx(
                'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold',
                compact ? 'text-[11px]' : 'text-[10px]',
                c.tone,
              )}
            >
              <Icon className={compact ? 'h-3.5 w-3.5' : 'h-3 w-3'} />
              {c.n} {c.label}
            </span>
          )
        })}
      </div>

      {/*
        * The caveat, where it belongs: beside the number it qualifies. An
        * execution count that silently mixes observed fills with assumed ones
        * is the specific overstatement this whole increment exists to avoid.
        */}
      {unobserved > 0 && (
        <p
          className="flex items-start gap-1 text-[11px] text-amber-800 dark:text-amber-300"
          data-testid="decision-memory-unobserved-caveat"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
          <span>
            {unobserved} of {s.executed} {unobserved === 1 ? 'execution is' : 'executions are'} not
            evidenced by an observed fill
            {(() => {
              const grades = [...new Set(
                allEvents
                  .filter(e => e.type === 'trade_executed' && e.executionProof
                    && !OBSERVED_PROOFS.includes(e.executionProof))
                  .map(e => EXECUTION_PROOF_LABELS[e.executionProof!]),
              )]
              return grades.length ? ` (${grades.join(', ').toLowerCase()})` : ''
            })()}.
          </span>
        </p>
      )}

      {s.furthest && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          Latest: {s.furthest.title}
          {' · '}
          {parseTimelineDate(s.furthest.timestamp).toLocaleDateString()}
        </p>
      )}

      {onOpenTimeline && (
        <button
          type="button"
          onClick={onOpenTimeline}
          data-testid="decision-memory-open-timeline"
          className={clsx(
            'text-primary-600 dark:text-primary-400 font-medium hover:underline',
            compact ? 'text-[12px] py-1' : 'text-[11px]',
          )}
        >
          See the full history →
        </button>
      )}
    </div>
  )
}
