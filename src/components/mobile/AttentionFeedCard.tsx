import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import {
  AlertTriangle, ArrowRight, BellOff, Check, Gavel, Info, Users,
} from 'lucide-react'
import { ReelsChartPanel } from '../feed/ReelsChartPanel'
import type { AttentionItem, AttentionType } from '../../types/attention'

interface AttentionFeedCardProps {
  item: AttentionItem
  /** Ticker for the linked asset, resolved by the caller in one batched query
   *  rather than a lookup per card. Absent for non-asset items (projects,
   *  lists), which correctly render without a chart. */
  symbol?: string | null
  companyName?: string | null
  onOpen?: (item: AttentionItem) => void
  onSnooze?: (item: AttentionItem) => void
  onAcknowledge?: (item: AttentionItem) => void
}

const TYPE_CONFIG: Record<AttentionType, { icon: typeof Info; label: string; chip: string; accent: string }> = {
  decision_required: {
    icon: Gavel,
    label: 'Decision needed',
    chip: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800',
    accent: 'border-l-red-500',
  },
  action_required: {
    icon: AlertTriangle,
    label: 'Action needed',
    chip: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
    accent: 'border-l-amber-500',
  },
  alignment: {
    icon: Users,
    label: 'Needs alignment',
    chip: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800',
    accent: 'border-l-purple-500',
  },
  informational: {
    icon: Info,
    label: 'For information',
    chip: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800',
    accent: 'border-l-blue-500',
  },
}

/**
 * A full-screen feed card for something awaiting the user — a decision, an
 * approval, a blocked deliverable.
 *
 * These are the highest-consequence items in the feed, so they are given the
 * same one-per-screen treatment as ideas rather than being compressed into a
 * list. `reason_text` is shown prominently: on a ranked feed the user must be
 * able to see *why* something reached them, and for a decision that is not a
 * nicety — "the algorithm deprioritised it" is not an acceptable explanation
 * for a missed approval.
 */
export function AttentionFeedCard({
  item,
  symbol,
  companyName,
  onOpen,
  onSnooze,
  onAcknowledge,
}: AttentionFeedCardProps) {
  const config = TYPE_CONFIG[item.attention_type] ?? TYPE_CONFIG.informational
  const TypeIcon = config.icon
  const isOverdue = !!item.due_at && new Date(item.due_at).getTime() < Date.now()

  return (
    <div className="relative w-full h-full flex flex-col bg-white dark:bg-gray-900">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <span className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border', config.chip)}>
          <TypeIcon className="h-4 w-4" />
          {config.label}
        </span>
        <span className="ml-auto text-xs text-gray-400 whitespace-nowrap">
          {formatDistanceToNow(new Date(item.last_activity_at || item.created_at), { addSuffix: true })}
        </span>
      </div>

      {/* A decision about a position is hard to judge without seeing the
          price. Same chart component as the idea cards, so the two read as
          one feed rather than two systems. */}
      {/* Explicit min/max, not a bare percentage: with a chart, reason text,
          next action and an action bar competing for the same column, a
          percentage alone collapses the chart to an unreadable strip. */}
      {symbol && (
        <div className="flex-shrink-0 h-[32%] min-h-[200px] max-h-[300px] px-4 pt-3">
          <ReelsChartPanel symbol={symbol} companyName={companyName ?? undefined} />
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className={clsx('border-l-4 pl-3', config.accent)}>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white leading-snug">
            {item.title}
          </h2>
          {item.subtitle && (
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{item.subtitle}</p>
          )}
        </div>

        {/* Why this reached you — the explainability the feed owes the user. */}
        {item.reason_text && (
          <div className="mt-4 rounded-xl bg-gray-50 dark:bg-gray-800 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
              Why you're seeing this
            </div>
            <p className="text-sm text-gray-700 dark:text-gray-300">{item.reason_text}</p>
          </div>
        )}

        {item.preview && (
          <p className="mt-4 text-[15px] leading-relaxed text-gray-800 dark:text-gray-200">
            {item.preview}
          </p>
        )}

        {item.next_action && (
          <div className="mt-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
              Next action
            </div>
            <p className="text-sm text-gray-700 dark:text-gray-300">{item.next_action}</p>
          </div>
        )}

        {item.due_at && (
          <p className={clsx(
            'mt-4 text-sm font-medium',
            isOverdue ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'
          )}>
            {isOverdue ? 'Overdue — due ' : 'Due '}
            {formatDistanceToNow(new Date(item.due_at), { addSuffix: true })}
          </p>
        )}

        {item.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-4">
            {item.tags.slice(0, 3).map(tag => (
              <span key={tag} className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[11px] dark:bg-gray-800 dark:text-gray-400">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Actions differ from an idea card: reacting bullish to a pending
          approval is meaningless. Open / snooze / acknowledge are the verbs. */}
      <div className="flex-shrink-0 flex items-stretch gap-2 px-3 py-3 pb-safe border-t border-gray-200 dark:border-gray-700">
        {onSnooze && (
          <button
            type="button"
            onClick={() => onSnooze(item)}
            className="flex flex-col items-center justify-center gap-0.5 w-16 rounded-xl text-gray-500 dark:text-gray-400 active:bg-gray-100 dark:active:bg-gray-800 no-touch-target"
            aria-label="Snooze"
          >
            <BellOff className="h-5 w-5" />
            <span className="text-[10px] font-medium leading-none">Snooze</span>
          </button>
        )}
        {onAcknowledge && (
          <button
            type="button"
            onClick={() => onAcknowledge(item)}
            className="flex flex-col items-center justify-center gap-0.5 w-16 rounded-xl text-gray-500 dark:text-gray-400 active:bg-gray-100 dark:active:bg-gray-800 no-touch-target"
            aria-label="Acknowledge"
          >
            <Check className="h-5 w-5" />
            <span className="text-[10px] font-medium leading-none">Got it</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => onOpen?.(item)}
          className="flex-1 flex items-center justify-center gap-2 h-12 rounded-xl bg-primary-600 text-white font-semibold no-touch-target"
        >
          Open
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
