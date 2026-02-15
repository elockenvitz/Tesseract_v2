/**
 * DecisionReviewSection — Lightweight top-3 decision summary.
 *
 * Shows pending trade decisions with a link to Trade Queue.
 * No inline Approve/Reject — those actions happen in Trade Queue.
 */

import { Scale, ArrowRight } from 'lucide-react'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import type { AttentionItem } from '../../types/attention'

interface DecisionReviewSectionProps {
  items: AttentionItem[]
  onOpenTradeQueue: (selectedTradeId?: string) => void
}

const ACTION_BADGE: Record<string, string> = {
  buy: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  sell: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  add: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  trim: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
}

export function DecisionReviewSection({
  items,
  onOpenTradeQueue,
}: DecisionReviewSectionProps) {
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800/60 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 dark:border-gray-700">
        <Scale className="w-4 h-4 text-violet-500 dark:text-violet-400" />
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
          Decision Review
        </h2>
        {items.length > 0 && (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full tabular-nums bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
            {items.length}
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={() => onOpenTradeQueue()}
          className="flex items-center gap-1 text-[11px] font-medium text-violet-600 dark:text-violet-400 hover:text-violet-800 dark:hover:text-violet-200 transition-colors"
        >
          Trade Queue
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      {/* Items */}
      {items.length > 0 ? (
        <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
          {items.map(item => {
            const action = extractAction(item)
            const ticker = extractTicker(item)
            const portfolio = item.subtitle || ''
            const age = formatDistanceToNow(new Date(item.created_at), { addSuffix: false })

            return (
              <div
                key={item.attention_id}
                className="flex items-center gap-2.5 px-4 py-2.5"
              >
                {/* Ticker */}
                <span className="text-[12px] font-semibold text-gray-800 dark:text-gray-100 w-16 shrink-0 truncate">
                  {ticker}
                </span>

                {/* Action badge */}
                {action && (
                  <span className={clsx(
                    'text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded shrink-0',
                    ACTION_BADGE[action.toLowerCase()] ?? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
                  )}>
                    {action}
                  </span>
                )}

                {/* Title + portfolio */}
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-gray-600 dark:text-gray-300 truncate">
                    {item.title}
                  </div>
                  {portfolio && (
                    <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                      {portfolio}
                    </div>
                  )}
                </div>

                {/* Age */}
                <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0 tabular-nums">
                  {age}
                </span>

                {/* Open CTA */}
                <button
                  onClick={() => onOpenTradeQueue(item.source_id)}
                  className="text-[11px] font-medium text-violet-600 dark:text-violet-400 hover:text-violet-800 dark:hover:text-violet-200 transition-colors shrink-0"
                >
                  Open
                </button>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="px-4 py-3 text-[11px] text-gray-400 dark:text-gray-500">
          No pending decisions.
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractTicker(item: AttentionItem): string {
  // Try tags first (often contains ticker)
  const tickerTag = item.tags.find(t => /^[A-Z]{1,5}$/.test(t))
  if (tickerTag) return tickerTag
  // Fallback: first word of title if it looks like a ticker
  const firstWord = item.title.split(/[\s:–—]/)[0]
  if (/^[A-Z]{1,5}$/.test(firstWord)) return firstWord
  return item.title.slice(0, 8)
}

function extractAction(item: AttentionItem): string | null {
  const actionTag = item.tags.find(t =>
    ['buy', 'sell', 'add', 'trim'].includes(t.toLowerCase()),
  )
  return actionTag || null
}
