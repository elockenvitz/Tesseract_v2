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
import {
  OBSERVED_PROOFS, EXECUTION_PROOF_LABELS, EXECUTION_PROOF_PLAIN,
  DECISION_RECORD_TYPES,
} from '../../types/decision-timeline'
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

/**
 * One line for the state of play, in words a reader already has.
 *
 * ── Why these are not the old strings ────────────────────────────────────
 *
 * They read as instrument panel, not as English. "2 executed · 1 observed, 1
 * not" packs three numbers and a distinction the reader has never been taught
 * into seven words with a middle dot in them, and the first thing it is
 * counting — executions — is not even named as trades. "Early work only" and
 * "1 decided, none executed" have the same problem in smaller doses.
 *
 * What the old wording was protecting still holds and is kept: an execution
 * nobody observed must never be summed into a plain "2 trades executed". It
 * is said as a clause instead of as a ratio.
 */
export function decisionMemoryHeadline(s: DecisionMemoryStats): string | null {
  if (s.total === 0) return null
  if (s.unfilled > 0) {
    return s.unfilled === 1
      ? '1 trade approved and not yet executed'
      : `${s.unfilled} trades approved and not yet executed`
  }
  if (s.executed > 0) {
    const unobserved = s.executed - s.executedObserved
    const traded = `${s.executed} ${s.executed === 1 ? 'trade' : 'trades'} executed`
    if (unobserved > 0) {
      // The honest version. Saying "3 trades executed" when only 1 fill was
      // observed asserts two fills nobody watched.
      return unobserved === s.executed
        ? `${traded}, with no record of the ${s.executed === 1 ? 'fill' : 'fills'}`
        : `${traded}, ${unobserved} with no record of the fill`
    }
    return traded
  }
  if (s.decided > 0) {
    return s.decided === 1
      ? '1 decision made, no trade yet'
      : `${s.decided} decisions made, no trade yet`
  }
  if (s.recommended > 0) {
    return s.recommended === 1
      ? '1 recommendation waiting on a decision'
      : `${s.recommended} recommendations waiting on a decision`
  }
  return 'Ideas raised, nothing recommended yet'
}

interface Props {
  assetId: string
  portfolioId?: string | null
  symbol?: string | null
  /**
   * The books this asset is HELD in, as the position read returns them.
   *
   * Used only to detect and disclose an authorization gap — see
   * `coverageNote` below. Optional: when absent, no claim is made either way.
   */
  heldBookIds?: string[]
  /** Rendered denser on a phone. */
  compact?: boolean
  /**
   * Draw the most recent events as rows, under the headline.
   *
   * Opt-in, because the two phone callers differ: `MobileDecisionMemory`
   * already renders the full event list directly beneath this component, and
   * turning rows on there would print the same three events twice.
   *
   * It is NOT a return to "a timeline, truncated". The argument at the top of
   * this file still holds — four executions in a row say nothing about what
   * is waiting — which is why the headline above them stays and leads. The
   * rows are what a section called "Decision history" owes the reader after
   * the state of play: what actually happened, and when.
   */
  showRecent?: boolean
  onOpenTimeline?: () => void
  className?: string
}

/** How many events a `showRecent` caller draws before deferring to the link. */
const RECENT_ROWS = 3

export function DecisionMemorySummary({
  assetId, portfolioId = null, symbol, heldBookIds, compact, showRecent,
  onOpenTimeline, className,
}: Props) {
  const { allEvents: everything, isLoading, isError } = useAssetDecisionTimeline({ assetId, portfolioId })
  /*
   * Decision memory is the decision record, not the whole timeline.
   *
   * The filter is applied ONCE, here, before anything counts or renders —
   * counts and rows drawn from different sets is how a block comes to
   * disagree with itself. `DECISION_RECORD_TYPES` is the vocabulary and it
   * lives beside the event types, not here.
   *
   * The History page still shows everything. Nothing is hidden; it is shown
   * where it belongs.
   */
  const allEvents = everything.filter(e => DECISION_RECORD_TYPES.includes(e.type))
  const s = summariseDecisionMemory(allEvents)
  const headline = decisionMemoryHeadline(s)

  /*
   * A failed read is NOT an empty history.
   *
   * Without this branch a dropped request rendered "No decision has been
   * recorded against AAPL yet" — which is a factual claim about the data, made
   * on the basis of not having any. On a surface whose whole purpose is to say
   * what was decided, that is the worst available failure mode.
   */
  if (isError) {
    return (
      <p
        className="text-[12px] text-amber-800 dark:text-amber-300"
        data-testid="decision-memory-summary-error"
      >
        Decision history could not be loaded. This is not a statement that there
        is none. Try again.
      </p>
    )
  }

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

      {/*
        * The chips are the counts, and they are what the ROWS replace.
        *
        * Beside three real events they were a second, worse account of the
        * same thing: "1 Recommended · 1 Decided · 2 Executed · 3 Reviewed" is
        * four numbers in a vocabulary the reader has to be taught, and on a
        * name with more reviews than executions it reads as an arithmetic
        * mistake. The headline keeps the one count that is a state of play;
        * the rows carry the rest as facts with dates on them.
        */}
      {!showRecent && (
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
      )}

      {/*
        * What actually happened, newest first.
        *
        * This section is called "Decision history" and, before this, drew no
        * history: a headline, a chip row, two caveats and one event in 11px
        * grey at the bottom — six lines ABOUT a record, and one line OF it.
        *
        * An execution carries its proof grade on the row, in amber when the
        * fill was never observed, so the qualification sits on the claim it
        * qualifies instead of being a sentence underneath. The separate
        * caveat below survives for the executions that are NOT on screen.
        */}
      {showRecent && (
        <ul className="divide-y divide-gray-100 dark:divide-white/[0.06]" data-testid="decision-memory-recent">
          {allEvents.slice(0, RECENT_ROWS).map(e => {
            const unseen = e.type === 'trade_executed' && e.executionProof
              && !OBSERVED_PROOFS.includes(e.executionProof)
            return (
              <li key={e.id} className="flex items-baseline gap-2 py-1.5">
                <span className="min-w-0 flex-1 text-[12px] text-gray-800 dark:text-gray-200">
                  {e.title}
                  {/* Plain words, and only when there is something to say.
                      A verified fill is the expectation, so it is silent —
                      labelling the normal case puts a badge on every row. */}
                  {e.executionProof && EXECUTION_PROOF_PLAIN[e.executionProof] && (
                    <span
                      title={`Evidence for this fill: ${EXECUTION_PROOF_LABELS[e.executionProof]}`}
                      className={clsx(
                        'ml-1.5 cursor-help text-[11px]',
                        unseen ? 'text-amber-700 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500',
                      )}
                    >
                      ({EXECUTION_PROOF_PLAIN[e.executionProof]})
                    </span>
                  )}
                  {/* Which book, when the reader can see more than one. */}
                  {!portfolioId && e.portfolio?.name && (
                    <span className="ml-1.5 text-[11px] text-gray-400 dark:text-gray-500">
                      {e.portfolio.name}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-gray-400 dark:text-gray-500">
                  {parseTimelineDate(e.timestamp).toLocaleDateString()}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {/*
        * The caveat, where it belongs: beside the number it qualifies. An
        * execution count that silently mixes observed fills with assumed ones
        * is the specific overstatement this whole increment exists to avoid.
        */}
      {/*
        * Gone from the rows view entirely.
        *
        * "1 of 2 execution is not evidenced by an observed fill
        * (backfilled)." is a sentence written for whoever built the
        * execution-proof model, printed on an investor's landing surface. It
        * is also broken English on the singular, and it is the THIRD
        * statement of one fact: the headline's clause says it, the row says
        * it in amber beside the trade it concerns, and then this said it
        * again in the grammar of the data model.
        *
        * The fact is not lost — the headline carries the count and the row
        * carries the grade. The paragraph stays for the no-rows callers,
        * which have no row to put it on.
        */}
      {unobserved > 0 && !showRecent && (
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

      {/*
        * The authorization gap, disclosed rather than hidden.
        *
        * Holdings are ORG-scoped: the position read returns every book in the
        * organization that holds this name. Decisions, commitments and
        * executions are PORTFOLIO-TEAM scoped — `decision_requests`,
        * `accepted_trades` and `portfolio_trade_events` all require
        * `user_is_portfolio_member(portfolio_id)`.
        *
        * Measured in production: a Tesseract analyst sees AAPL held in 3
        * books and, depending on their team memberships, between 0 and 2 of
        * its executions. Rendering "2 executed" beside "held in 3 books" with
        * no note reads as a complete history, and it is not.
        *
        * This says so WITHOUT fabricating the missing rows or naming books
        * the reader cannot see. It is computed from data already in hand — no
        * extra query — and only shown when the gap actually exists.
        *
        * ── Why it is now four words ─────────────────────────────────────
        *
        * It read "Held in 2 books; this history covers the 1 you have
        * decision access to." — a sentence about permissions, in a box about
        * trades, explaining a model the reader does not have. But it cannot
        * simply go: without it the block shows a short record and lets the
        * reader believe it is the whole one, which is the one thing this
        * surface must not do. So it says the scope and nothing else, and the
        * explanation moves to the tooltip for the reader who wants it.
        */}
      {(() => {
        if (!heldBookIds || heldBookIds.length === 0) return null
        if (portfolioId) return null // scoped deliberately; not a gap
        const covered = new Set(
          allEvents.map(e => e.portfolio?.id).filter((x): x is string => !!x),
        )
        const uncovered = heldBookIds.filter(id => !covered.has(id)).length
        if (uncovered === 0) return null
        const seen = heldBookIds.length - uncovered
        return (
          <p
            className="cursor-help text-[11px] text-gray-400 dark:text-gray-500"
            data-testid="decision-memory-coverage-note"
            title={
              `This name is held in ${heldBookIds.length} books. Decisions and trades `
              + 'are visible only to the teams on each book, so '
              + `${uncovered === 1 ? 'one of them is' : `${uncovered} of them are`} not shown here. `
              + 'That is a limit on what you can see, not a sign that nothing happened in them.'
            }
          >
            {seen} of {heldBookIds.length} books
          </p>
        )
      })()}

      {/*
        * `furthest` is by PHASE, not by date — that is deliberate and
        * documented in `summariseDecisionMemory`. The label said "Latest:",
        * which is a different fact, and on a name where a recommendation was
        * filed after a trade executed the two are different events. A label
        * that names the wrong fact is worse than no label, so it now says
        * what the value is.
        *
        * Suppressed entirely under `showRecent`: the rows above are the
        * dated record, and this line beside them invited exactly the
        * latest-versus-furthest confusion it was already causing alone.
        */}
      {s.furthest && !showRecent && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          Furthest reached: {s.furthest.title}
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
