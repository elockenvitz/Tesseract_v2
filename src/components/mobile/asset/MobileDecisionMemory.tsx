/**
 * Decision Memory, on a phone.
 *
 * ── Why not `DecisionTimeline` at 390px ──────────────────────────────────
 *
 * The desktop row is a four-line composition: a 52px fixed date gutter, a
 * phase chip, a title, a proof badge, then a subtitle and a meta line both
 * indented 60px to clear the gutter. At 390px the title truncates to about
 * eight characters and the indented lines have ~90px of usable width — the
 * row renders, and says nothing.
 *
 * So this is the same DATA through a phone layout: date and chips on their
 * own line, title full width beneath, detail behind a tap. It reads the same
 * hook, applies no filter of its own, and renders the same proof grades with
 * the same words.
 *
 * ── What it deliberately does not do ─────────────────────────────────────
 *
 * No phase filter bar. Four more tap targets to narrow a list that is usually
 * under twenty rows is a worse trade on a phone than scrolling, and the
 * desktop filter exists because the desktop list is denser and longer.
 */

import { useState } from 'react'
import { clsx } from 'clsx'
import { ChevronDown } from 'lucide-react'
import { useAssetDecisionTimeline } from '../../../hooks/useAssetDecisionTimeline'
import { parseTimelineDate } from '../../../lib/asset-decisions/timeline'
import { EXECUTION_PROOF_LABELS } from '../../../types/decision-timeline'
import type { DecisionTimelineEvent, TimelineEventType, ExecutionProof } from '../../../types/decision-timeline'
import { DecisionMemorySummary } from '../../asset/DecisionMemorySummary'

/** Same words as desktop. Divergence here is how two surfaces start lying. */
const CHIP: Record<TimelineEventType, string> = {
  idea_created: 'Idea',
  idea_escalated: 'Escalated',
  thesis_changed: 'Thesis',
  proposal_submitted: 'Recommended',
  decision_accepted: 'Decided',
  decision_rejected: 'Decided',
  decision_deferred: 'Deferred',
  decision_withdrawn: 'Withdrawn',
  trade_committed: 'Committed',
  execution_pending: 'Unfilled',
  trade_executed: 'Executed',
  outcome_evaluated: 'Outcome',
  review_recorded: 'Reviewed',
}

const CHIP_TONE: Record<TimelineEventType, string> = {
  idea_created: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  idea_escalated: 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300',
  thesis_changed: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  proposal_submitted: 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  decision_accepted: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  decision_rejected: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  decision_deferred: 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  decision_withdrawn: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  trade_committed: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  execution_pending: 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  trade_executed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  outcome_evaluated: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  review_recorded: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
}

/** Only `verified` reads as settled. See `ExecutionProof`. */
const PROOF_TONE: Record<ExecutionProof, string> = {
  verified: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  attested: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  assumed: 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  backfilled: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  unattributed: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
}

const PAGE = 8

function EventCard({ e }: { e: DecisionTimelineEvent }) {
  const date = (() => {
    try { return parseTimelineDate(e.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }
    catch { return '—' }
  })()

  return (
    <li
      data-testid={`mobile-memory-row-${e.type}`}
      className="rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 px-2.5 py-2"
    >
      {/* Chips and date on their own line, so the title gets the full width. */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] font-medium text-gray-400 tabular-nums">{date}</span>
        <span className={clsx(
          'text-[10px] font-semibold uppercase tracking-wide px-1.5 py-px rounded',
          CHIP_TONE[e.type],
        )}>
          {CHIP[e.type]}
        </span>
        {e.executionProof && (
          <span
            data-testid={`mobile-proof-${e.executionProof}`}
            className={clsx(
              'text-[10px] font-semibold uppercase tracking-wide px-1.5 py-px rounded',
              PROOF_TONE[e.executionProof],
            )}
          >
            {EXECUTION_PROOF_LABELS[e.executionProof]}
          </span>
        )}
      </div>

      <p className="mt-1 text-[13px] font-semibold text-gray-900 dark:text-gray-100">
        {e.title}
      </p>

      {e.subtitle && (
        <p className="mt-0.5 text-[12px] text-gray-600 dark:text-gray-400">{e.subtitle}</p>
      )}
      {e.rationale && (
        <p className="mt-0.5 text-[12px] italic text-gray-500 dark:text-gray-400">
          &ldquo;{e.rationale}&rdquo;
        </p>
      )}

      {(e.actor || e.portfolio) && (
        <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500 truncate">
          {[e.actor?.name, e.portfolio?.name].filter(Boolean).join(' · ')}
        </p>
      )}
    </li>
  )
}

export function MobileDecisionMemory({
  assetId, portfolioId, symbol,
}: {
  assetId: string
  portfolioId: string | null
  symbol: string
  onNavigate?: (result: any) => void
}) {
  const { allEvents, isLoading } = useAssetDecisionTimeline({ assetId, portfolioId })
  const [shown, setShown] = useState(PAGE)

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="mobile-memory-loading">
        {[0, 1, 2].map(i => (
          <div key={i} className="rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 px-2.5 py-2">
            <div className="h-2.5 w-24 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
            <div className="mt-2 h-3 w-2/3 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
          </div>
        ))}
      </div>
    )
  }

  const visible = allEvents.slice(0, shown)
  const more = allEvents.length - visible.length

  return (
    <section data-testid="mobile-decision-memory" className="space-y-2">
      <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 px-3 py-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Decision memory
        </h2>
        <div className="mt-1.5">
          <DecisionMemorySummary
            assetId={assetId}
            portfolioId={portfolioId}
            symbol={symbol}
            compact
          />
        </div>
      </div>

      {allEvents.length > 0 && (
        <>
          <ul className="space-y-1.5">
            {visible.map(e => <EventCard key={e.id} e={e} />)}
          </ul>
          {more > 0 && (
            <button
              type="button"
              onClick={() => setShown(n => n + PAGE)}
              data-testid="mobile-memory-more"
              className="w-full h-11 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-[13px] font-medium text-gray-600 dark:text-gray-300 active:bg-gray-50 dark:active:bg-gray-800 flex items-center justify-center gap-1"
            >
              Show {Math.min(PAGE, more)} more
              <ChevronDown className="h-4 w-4" />
            </button>
          )}
        </>
      )}
    </section>
  )
}
