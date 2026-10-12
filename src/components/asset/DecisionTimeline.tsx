/**
 * DecisionTimeline — Asset-level decision narrative.
 *
 * Vertical timeline of meaningful decision milestones derived from
 * existing objects (ideas, proposals, decisions, trades, outcomes).
 *
 * Layout: filter bar → timeline events → load-more.
 * This is the canonical asset decision narrative surface.
 * Trade Journal remains the portfolio-level action ledger.
 */

import { useState, useCallback, useEffect } from 'react'
import { clsx } from 'clsx'
import {
  Lightbulb,
  ArrowUpRight as Escalate,
  FileText,
  Scale,
  ArrowUpDown,
  Target,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronRight,
  Filter,
} from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'
import { useAssetDecisionTimeline } from '../../hooks/useAssetDecisionTimeline'
/* From the pure module, not the hook: the desktop harness stubs the hook. */
import { parseTimelineDate } from '../../lib/asset-decisions/timeline'
import type {
  DecisionTimelineEvent,
  TimelineEventType,
  TimelinePhase,
  TimelineFilter,
  TimelineDisposition,
  ExecutionProof,
} from '../../types/decision-timeline'
import { ideasTabFor } from '../../lib/desktop-ideas/navigate'
import { openOutcomesFor, openTradeBookFor } from '../../lib/desktop-decisions/navigate'

// ============================================================
// Visual config per event type
// ============================================================

const EVENT_ICON: Record<TimelineEventType, React.ElementType> = {
  idea_created: Lightbulb,
  idea_escalated: Escalate,
  thesis_changed: Scale,
  proposal_submitted: FileText,
  decision_accepted: CheckCircle2,
  decision_rejected: XCircle,
  decision_deferred: Clock,
  decision_withdrawn: XCircle,
  trade_committed: CheckCircle2,
  execution_pending: Clock,
  trade_executed: ArrowUpDown,
  outcome_evaluated: Target,
  review_recorded: Scale,
}

const EVENT_DOT_COLOR: Record<TimelineEventType, string> = {
  idea_created: 'bg-blue-500',
  idea_escalated: 'bg-blue-400',
  thesis_changed: 'bg-sky-500',
  proposal_submitted: 'bg-violet-500',
  decision_accepted: 'bg-emerald-500',
  decision_rejected: 'bg-red-500',
  decision_deferred: 'bg-gray-400',
  decision_withdrawn: 'bg-gray-300',
  trade_committed: 'bg-emerald-500',
  // Amber, not green: a commitment with no fill is unfinished business.
  execution_pending: 'bg-amber-500',
  trade_executed: 'bg-emerald-600',
  outcome_evaluated: 'bg-amber-500',
  review_recorded: 'bg-indigo-500',
}

const EVENT_ICON_COLOR: Record<TimelineEventType, string> = {
  idea_created: 'text-blue-600 dark:text-blue-400',
  idea_escalated: 'text-blue-500 dark:text-blue-400',
  thesis_changed: 'text-sky-600 dark:text-sky-400',
  proposal_submitted: 'text-violet-600 dark:text-violet-400',
  decision_accepted: 'text-emerald-600 dark:text-emerald-400',
  decision_rejected: 'text-red-600 dark:text-red-400',
  decision_deferred: 'text-gray-500 dark:text-gray-400',
  decision_withdrawn: 'text-gray-400 dark:text-gray-500',
  trade_committed: 'text-emerald-600 dark:text-emerald-400',
  execution_pending: 'text-amber-600 dark:text-amber-400',
  trade_executed: 'text-emerald-700 dark:text-emerald-400',
  outcome_evaluated: 'text-amber-600 dark:text-amber-400',
  review_recorded: 'text-indigo-600 dark:text-indigo-400',
}

/**
 * How each proof grade reads, and how loudly.
 *
 * Only `verified` is styled as settled. `assumed` is deliberately amber and
 * spelled out: it means a PM's approval was treated as a fill that nobody
 * observed, and a reader who cannot see that difference is being misled
 * about their own book.
 */
/**
 * The short chip on each row. Separate from `EVENT_LABELS` because the chip
 * has to fit in ~12 characters; the long label is used in the title.
 *
 * `Committed` and `Executed` are deliberately different words: one means a
 * PM signed off, the other means the book moved.
 */
const EVENT_CHIP: Record<TimelineEventType, string> = {
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

const PROOF_STYLE: Record<ExecutionProof, { label: string; className: string; title: string }> = {
  verified: {
    label: 'Verified',
    className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    title: 'The app applied this trade and watched the position change.',
  },
  attested: {
    label: 'Attested',
    className: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    title: 'A person states this executed away from the app. Not observed here.',
  },
  assumed: {
    label: 'Assumed',
    className: 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    title:
      'Pilot policy: a PM approved, so a fill was assumed. No system and no person observed one.',
  },
  backfilled: {
    label: 'Backfilled',
    className: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
    title: 'Written by a migration, not by a live execution.',
  },
  unattributed: {
    label: 'Unattributed',
    className: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
    title: 'This row predates execution provenance. How it executed is not recorded.',
  },
}

const DISPOSITION_ACCENT: Record<TimelineDisposition, string> = {
  positive: 'border-l-emerald-400 dark:border-l-emerald-600',
  negative: 'border-l-red-400 dark:border-l-red-500',
  neutral: 'border-l-gray-300 dark:border-l-gray-600',
  deferred: 'border-l-amber-300 dark:border-l-amber-600',
}

const PHASE_CONFIG: Record<TimelinePhase, { label: string; color: string }> = {
  exploratory: { label: 'Ideas', color: 'text-blue-700 bg-blue-50 dark:text-blue-300 dark:bg-blue-900/30' },
  formal: { label: 'Decisions', color: 'text-violet-700 bg-violet-50 dark:text-violet-300 dark:bg-violet-900/30' },
  execution: { label: 'Trades', color: 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-900/30' },
  review: { label: 'Review', color: 'text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-900/30' },
}

const FILTER_OPTIONS: { key: TimelineFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'exploratory', label: 'Ideas' },
  { key: 'formal', label: 'Decisions' },
  { key: 'execution', label: 'Trades' },
  { key: 'review', label: 'Review' },
]

// ============================================================
// Max items before "load more"
// ============================================================

const DEFAULT_VISIBLE = 15

// ============================================================
// Main component
// ============================================================

interface DecisionTimelineProps {
  assetId: string
  /**
   * Scope the narrative to one book. Null means every book the reader is
   * authorized to see — which is the org-scoped set the RLS policies already
   * return, not a wider one this component assembles.
   *
   * Events with no portfolio (a thesis change, a scored price target) survive
   * the filter: they are facts about the ASSET, not about a book, and hiding
   * them when a book is selected would make the asset's own history look
   * like it belonged to whichever portfolio happened to be chosen.
   */
  portfolioId?: string | null
  onNavigate?: (tab: { id: string; title: string; type: string; data?: any }) => void
  className?: string
}

export function DecisionTimeline({
  assetId,
  portfolioId = null,
  onNavigate,
  className,
}: DecisionTimelineProps) {
  const [filter, setFilter] = useState<TimelineFilter>('all')
  const [visibleCount, setVisibleCount] = useState(DEFAULT_VISIBLE)

  const {
    events,
    phaseCounts,
    isLoading,
    isError,
  } = useAssetDecisionTimeline({ assetId, filter, portfolioId })

  /*
   * Reset paging when the scope changes. Without this, switching book or
   * phase keeps the previous "show 30 more" count and the reader sees a
   * partial list with no indication that it is partial.
   */
  useEffect(() => {
    setVisibleCount(DEFAULT_VISIBLE)
  }, [assetId, portfolioId, filter])

  const visibleEvents = events.slice(0, visibleCount)
  const hasMore = events.length > visibleCount

  const handleLoadMore = useCallback(() => {
    setVisibleCount(prev => prev + DEFAULT_VISIBLE)
  }, [])

  /**
   * Send the reader to the record that owns the fact.
   *
   * Every destination here is an existing route with an existing opener —
   * nothing new is routed and no descriptor is hand-rolled. The previous
   * version dispatched a hardcoded `'trade-queue'` tab, which is not the
   * surface ideas live on any more; `ideasTabFor` is what the rest of the
   * app uses and it reuses the tab rather than duplicating it.
   *
   * `openOutcomesFor` and `openTradeBookFor` dispatch the shell's
   * `decision-engine-action` event directly and return false when the target
   * is missing, so a click with nothing to open is inert rather than opening
   * an empty tab.
   */
  const handleEventClick = useCallback((event: DecisionTimelineEvent) => {
    const { provenance, sourceRef } = event

    switch (sourceRef.type) {
      // An idea, a recommendation or a ruling all resolve to the idea they
      // belong to: that is where the thread is readable end to end.
      case 'trade_idea':
      case 'proposal':
      case 'decision':
      case 'decision_request': {
        const ideaId = provenance.ideaId ?? (sourceRef.type === 'trade_idea' ? sourceRef.id : null)
        if (!ideaId || !onNavigate) return
        onNavigate(ideasTabFor({ ideaId, origin: 'asset-decision-timeline' }))
        return
      }

      // A committed trade and an execution both belong to the Trade Book,
      // on the batch if there is one and the trade otherwise.
      case 'accepted_trade':
      case 'trade_event': {
        const opened = openTradeBookFor({
          portfolioId: provenance.portfolioId ?? '',
          execution: provenance.acceptedTradeId ? { id: provenance.acceptedTradeId } : null,
          batch: provenance.batchId ? { id: provenance.batchId } : null,
        } as Parameters<typeof openTradeBookFor>[0])
        // Nothing to highlight — fall back to the idea thread if we have one.
        if (!opened && provenance.ideaId && onNavigate) {
          onNavigate(ideasTabFor({ ideaId: provenance.ideaId, origin: 'asset-decision-timeline' }))
        }
        return
      }

      // Reviews and scored targets are Outcomes' subject.
      case 'review':
      case 'outcome': {
        if (!provenance.ideaId) return
        openOutcomesFor({ ideaId: provenance.ideaId })
        return
      }

      // A thesis change has no destination of its own: the asset page the
      // reader is already on IS the record. Clicking it does nothing rather
      // than opening something unrelated.
      case 'memory_event':
        return
    }
  }, [onNavigate])

  // Empty state
  if (!isLoading && events.length === 0 && filter === 'all') {
    return (
      <div className={clsx(
        'bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700',
        className,
      )}>
        <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700">
          <h4 className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">Decision Timeline</h4>
        </div>
        <div className="px-4 py-6 text-center">
          {isError ? (
            <>
              <span
                className="text-[13px] text-amber-800 dark:text-amber-300"
                data-testid="decision-timeline-error"
              >
                Decision history could not be loaded.
              </span>
              <span className="text-[11px] text-gray-500 dark:text-gray-400 block mt-1">
                This is not a statement that there is none.
              </span>
            </>
          ) : (
            <>
              <span className="text-[13px] text-gray-400 dark:text-gray-500">No decision history yet.</span>
              <span className="text-[11px] text-gray-400 dark:text-gray-500 block mt-1">
                Trade ideas, decisions, and executed trades will appear here.
              </span>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={clsx(
      'bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden',
      className,
    )}>
      {/* ─── Header + Filters ─────────────────────────────── */}
      <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700 flex items-center gap-3">
        <h4 className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">Decision Timeline</h4>
        <span className="text-[10px] font-medium text-gray-400 tabular-nums">
          {events.length} event{events.length !== 1 ? 's' : ''}
        </span>

        <div className="flex items-center gap-1 ml-auto">
          {FILTER_OPTIONS.map(({ key, label }) => {
            const count = phaseCounts[key]
            if (key !== 'all' && count === 0) return null
            return (
              <button
                key={key}
                onClick={() => { setFilter(key); setVisibleCount(DEFAULT_VISIBLE) }}
                className={clsx(
                  'px-2 py-0.5 rounded text-[10px] font-semibold transition-colors',
                  filter === key
                    ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 shadow-sm'
                    : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-700',
                )}
              >
                {label}
                {key !== 'all' && count > 0 && (
                  <span className="ml-1 tabular-nums">{count}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ─── Loading ──────────────────────────────────────── */}
      {isLoading && (
        <div className="px-4 py-4 space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex gap-3">
              <div className="w-2 h-2 rounded-full bg-gray-200 dark:bg-gray-700 mt-1.5 animate-pulse" />
              <div className="flex-1 space-y-1">
                <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-1/3 animate-pulse" />
                <div className="h-2.5 bg-gray-50 dark:bg-gray-700/50 rounded w-2/3 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── Timeline ─────────────────────────────────────── */}
      {!isLoading && visibleEvents.length > 0 && (
        <div className="relative">
          {/* Vertical connector line */}
          <div className="absolute left-[21px] top-0 bottom-0 w-px bg-gray-200 dark:bg-gray-700" />

          <div className="divide-y divide-gray-50 dark:divide-gray-800">
            {visibleEvents.map((event, idx) => (
              <TimelineEventRow
                key={event.id}
                event={event}
                isLast={idx === visibleEvents.length - 1}
                onClick={() => handleEventClick(event)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ─── Load More ────────────────────────────────────── */}
      {hasMore && (
        <button
          onClick={handleLoadMore}
          className="w-full text-center text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 py-2.5 border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/20 transition-colors"
        >
          Show {Math.min(DEFAULT_VISIBLE, events.length - visibleCount)} more events
        </button>
      )}

      {/* Empty filter state */}
      {!isLoading && visibleEvents.length === 0 && filter !== 'all' && (
        <div className="px-4 py-4 text-center">
          <span className="text-[12px] text-gray-400 dark:text-gray-500">
            No {PHASE_CONFIG[filter as TimelinePhase]?.label.toLowerCase()} events.
          </span>
        </div>
      )}
    </div>
  )
}

// ============================================================
// Individual timeline event row
// ============================================================

function TimelineEventRow({
  event,
  isLast,
  onClick,
}: {
  event: DecisionTimelineEvent
  isLast: boolean
  onClick: () => void
}) {
  const Icon = EVENT_ICON[event.type]
  const dotColor = EVENT_DOT_COLOR[event.type]
  const iconColor = EVENT_ICON_COLOR[event.type]
  const accentBorder = DISPOSITION_ACCENT[event.disposition]
  const phaseConf = PHASE_CONFIG[event.phase]

  /*
   * `parseTimelineDate`, not `new Date`. `portfolio_trade_events.event_date`
   * is a bare DATE, which `new Date()` reads as UTC midnight — so every
   * execution rendered a day early for anyone west of UTC. See the helper.
   */
  const formattedDate = (() => {
    try {
      const d = parseTimelineDate(event.timestamp)
      const now = new Date()
      const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24))
      if (diffDays <= 7) return formatDistanceToNow(d, { addSuffix: false })
      return format(d, 'MMM d, yyyy')
    } catch {
      return '—'
    }
  })()

  const shortDate = (() => {
    try {
      return format(parseTimelineDate(event.timestamp), 'MMM d')
    } catch {
      return '—'
    }
  })()

  /*
   * Clickable only when there is somewhere real to go. A thesis change has
   * no destination, and a trade with neither a batch nor a linked idea has
   * nothing to highlight — those render inert rather than offering a click
   * that does nothing.
   */
  const isClickable = (() => {
    switch (event.sourceRef.type) {
      case 'trade_idea':
        return true
      case 'proposal':
      case 'decision':
      case 'decision_request':
        return !!event.provenance.ideaId
      case 'accepted_trade':
      case 'trade_event':
        return !!(event.provenance.batchId || event.provenance.acceptedTradeId || event.provenance.ideaId)
      case 'review':
      case 'outcome':
        return !!event.provenance.ideaId
      case 'memory_event':
        return false
      default:
        return false
    }
  })()

  const proof = event.executionProof ? PROOF_STYLE[event.executionProof] : null

  return (
    <button
      onClick={isClickable ? onClick : undefined}
      disabled={!isClickable}
      // Addressable, so a probe can assert per-row claims — in particular that
      // no row states one fact twice, which is how the duplicated book name
      // went unnoticed until somebody looked at a screenshot.
      data-timeline-event={event.type}
      className={clsx(
        'w-full flex items-start gap-2.5 pl-3 pr-4 py-1.5 text-left transition-colors relative',
        'border-l-[3px]',
        accentBorder,
        isClickable && 'hover:bg-gray-50/80 dark:hover:bg-gray-700/30 cursor-pointer group',
        !isClickable && 'cursor-default',
      )}
    >
      {/* ─── Dot / Icon ───────────────────────────────── */}
      <div className="relative z-10 flex-shrink-0 mt-0.5">
        <div className={clsx(
          'w-5 h-5 rounded-full flex items-center justify-center',
          'bg-white dark:bg-gray-800 ring-2 ring-white dark:ring-gray-800',
        )}>
          <Icon className={clsx('w-3 h-3', iconColor)} />
        </div>
      </div>

      {/* ─── Content ──────────────────────────────────── */}
      <div className="flex-1 min-w-0 py-px">
        {/* Top line: date + title */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 tabular-nums shrink-0 w-[52px]">
            {shortDate}
          </span>
          <span className={clsx(
            'text-[10px] font-semibold uppercase tracking-wider px-1.5 py-px rounded shrink-0',
            phaseConf.color,
          )}>
            {EVENT_CHIP[event.type]}
          </span>
          <span className="text-[12px] font-semibold text-gray-900 dark:text-gray-100 truncate">
            {event.title}
          </span>
          {/*
            * The proof grade sits on the title line, not buried in the meta
            * row, because "executed" and "assumed to have executed" are
            * different claims and the difference has to be visible at a
            * glance. Only trade_executed carries one.
            */}
          {proof && (
            <span
              title={proof.title}
              className={clsx(
                'text-[9px] font-semibold uppercase tracking-wide px-1.5 py-px rounded shrink-0',
                proof.className,
              )}
            >
              {proof.label}
            </span>
          )}
        </div>

        {/* Subtitle / rationale */}
        {(event.subtitle || event.rationale) && (
          <div className="ml-[58px]">
            {event.subtitle && (
              <span className="text-[11px] text-gray-500 dark:text-gray-400 block truncate leading-snug">
                {event.subtitle}
              </span>
            )}
            {event.rationale && (
              <span className="text-[11px] text-gray-500 dark:text-gray-400 italic block truncate leading-snug mt-0.5">
                &ldquo;{event.rationale}&rdquo;
              </span>
            )}
          </div>
        )}

        {/* Meta line: actor + portfolio */}
        <div className="ml-[58px] flex items-center gap-2 text-[10px] text-gray-400 dark:text-gray-500">
          {event.actor && (
            <span className="flex items-center gap-1">
              <span className="w-4 h-4 rounded-full bg-gray-100 dark:bg-gray-700 text-[8px] font-semibold text-gray-500 dark:text-gray-400 flex items-center justify-center shrink-0">
                {event.actor.initials}
              </span>
              <span>{event.actor.name}</span>
            </span>
          )}
          {event.actor && event.portfolio && (
            <span className="text-gray-200 dark:text-gray-700">&middot;</span>
          )}
          {event.portfolio && (
            <span className="truncate max-w-[140px]">{event.portfolio.name}</span>
          )}
          {(event.actor || event.portfolio) && (
            <span className="text-gray-200 dark:text-gray-700">&middot;</span>
          )}
          <span className="tabular-nums">{formattedDate}</span>
        </div>
      </div>

      {/* ─── Navigation arrow ─────────────────────────── */}
      {isClickable && (
        <ChevronRight className="w-3.5 h-3.5 text-gray-200 dark:text-gray-700 group-hover:text-gray-400 shrink-0 mt-1 transition-colors" />
      )}
    </button>
  )
}
