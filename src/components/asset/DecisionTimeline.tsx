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

import { useState, useCallback } from 'react'
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
import type {
  DecisionTimelineEvent,
  TimelineEventType,
  TimelinePhase,
  TimelineFilter,
  TimelineDisposition,
} from '../../types/decision-timeline'

// ============================================================
// Visual config per event type
// ============================================================

const EVENT_ICON: Record<TimelineEventType, React.ElementType> = {
  idea_created: Lightbulb,
  idea_escalated: Escalate,
  proposal_submitted: FileText,
  decision_accepted: CheckCircle2,
  decision_rejected: XCircle,
  decision_deferred: Clock,
  trade_executed: ArrowUpDown,
  outcome_evaluated: Target,
}

const EVENT_DOT_COLOR: Record<TimelineEventType, string> = {
  idea_created: 'bg-blue-500',
  idea_escalated: 'bg-blue-400',
  proposal_submitted: 'bg-violet-500',
  decision_accepted: 'bg-emerald-500',
  decision_rejected: 'bg-red-500',
  decision_deferred: 'bg-gray-400',
  trade_executed: 'bg-emerald-600',
  outcome_evaluated: 'bg-amber-500',
}

const EVENT_ICON_COLOR: Record<TimelineEventType, string> = {
  idea_created: 'text-blue-600 dark:text-blue-400',
  idea_escalated: 'text-blue-500 dark:text-blue-400',
  proposal_submitted: 'text-violet-600 dark:text-violet-400',
  decision_accepted: 'text-emerald-600 dark:text-emerald-400',
  decision_rejected: 'text-red-600 dark:text-red-400',
  decision_deferred: 'text-gray-500 dark:text-gray-400',
  trade_executed: 'text-emerald-700 dark:text-emerald-400',
  outcome_evaluated: 'text-amber-600 dark:text-amber-400',
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
  onNavigate?: (tab: { id: string; title: string; type: string; data?: any }) => void
  className?: string
}

export function DecisionTimeline({
  assetId,
  onNavigate,
  className,
}: DecisionTimelineProps) {
  const [filter, setFilter] = useState<TimelineFilter>('all')
  const [visibleCount, setVisibleCount] = useState(DEFAULT_VISIBLE)

  const {
    events,
    phaseCounts,
    isLoading,
  } = useAssetDecisionTimeline({ assetId, filter })

  const visibleEvents = events.slice(0, visibleCount)
  const hasMore = events.length > visibleCount

  const handleLoadMore = useCallback(() => {
    setVisibleCount(prev => prev + DEFAULT_VISIBLE)
  }, [])

  const handleEventClick = useCallback((event: DecisionTimelineEvent) => {
    if (!onNavigate) return

    if (event.sourceRef.type === 'trade_idea' || event.sourceRef.type === 'decision') {
      onNavigate({
        id: 'trade-queue',
        title: 'Trade Queue',
        type: 'trade-queue',
        data: { selectedTradeId: event.sourceRef.id },
      })
    }
    // Trade events and outcomes stay in context — no navigation for now
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
          <span className="text-[13px] text-gray-400 dark:text-gray-500">No decision history yet.</span>
          <span className="text-[11px] text-gray-400 dark:text-gray-500 block mt-1">
            Trade ideas, decisions, and executed trades will appear here.
          </span>
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
          <div className="absolute left-[19px] top-0 bottom-0 w-px bg-gray-200 dark:bg-gray-700" />

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

  const formattedDate = (() => {
    try {
      const d = new Date(event.timestamp)
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
      return format(new Date(event.timestamp), 'MMM d')
    } catch {
      return '—'
    }
  })()

  const isClickable = event.sourceRef.type === 'trade_idea' || event.sourceRef.type === 'decision'

  return (
    <button
      onClick={isClickable ? onClick : undefined}
      disabled={!isClickable}
      className={clsx(
        'w-full flex items-start gap-3 pl-3 pr-4 py-2.5 text-left transition-colors relative',
        'border-l-[3px]',
        accentBorder,
        isClickable && 'hover:bg-gray-50/80 dark:hover:bg-gray-700/30 cursor-pointer group',
        !isClickable && 'cursor-default',
      )}
    >
      {/* ─── Dot / Icon ───────────────────────────────── */}
      <div className="relative z-10 flex-shrink-0 mt-0.5">
        <div className={clsx(
          'w-6 h-6 rounded-full flex items-center justify-center',
          'bg-white dark:bg-gray-800 ring-2 ring-white dark:ring-gray-800',
        )}>
          <Icon className={clsx('w-3.5 h-3.5', iconColor)} />
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
            {event.type === 'idea_created' ? 'Idea'
              : event.type === 'idea_escalated' ? 'Escalated'
              : event.type === 'proposal_submitted' ? 'Recommendation'
              : event.type === 'decision_accepted' ? 'Accepted'
              : event.type === 'decision_rejected' ? 'Rejected'
              : event.type === 'decision_deferred' ? 'Deferred'
              : event.type === 'trade_executed' ? 'Executed'
              : 'Outcome'}
          </span>
          <span className="text-[12px] font-semibold text-gray-900 dark:text-gray-100 truncate">
            {event.title}
          </span>
        </div>

        {/* Subtitle / rationale */}
        {(event.subtitle || event.rationale) && (
          <div className="mt-0.5 ml-[60px]">
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
        <div className="mt-0.5 ml-[60px] flex items-center gap-2 text-[10px] text-gray-400 dark:text-gray-500">
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
