import React from 'react'
import { Sparkles, ArrowUpRight } from 'lucide-react'

interface ListEmptyStateProps {
  canAdd: boolean
  listName: string
}

/**
 * Hero empty state for a list with no assets. Replaces the generic
 * "No assets" table empty state with a greeting that invites the user
 * to add their first ticker.
 */
export function ListEmptyState({ canAdd, listName }: ListEmptyStateProps) {
  return (
    <div className="flex items-center justify-center h-full w-full px-6 py-12">
      <div className="max-w-md w-full text-center">
        {/* Decorative stacked tickers — abstract, not illustrative */}
        <div className="relative mx-auto mb-6 h-28 w-28 flex items-center justify-center">
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary-100/60 via-primary-50/40 to-transparent dark:from-primary-900/30 dark:via-primary-950/20 blur-2xl" />
          <div className="relative flex flex-col items-center gap-1.5">
            <div className="flex gap-1.5">
              <TickerChip faded>NVDA</TickerChip>
              <TickerChip>AVGO</TickerChip>
            </div>
            <div className="flex gap-1.5">
              <TickerChip primary>AAPL</TickerChip>
              <TickerChip faded>MSFT</TickerChip>
              <TickerChip faded>GOOGL</TickerChip>
            </div>
            <div className="flex gap-1.5">
              <TickerChip faded>TSM</TickerChip>
              <TickerChip>AMD</TickerChip>
            </div>
          </div>
          <div className="absolute -top-1 -right-1 text-primary-500 dark:text-primary-400 animate-pulse-slow">
            <Sparkles className="h-4 w-4" />
          </div>
        </div>

        {/* Heading */}
        <h2 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100 mb-2">
          Start building out {listName ? `"${listName}"` : 'this list'}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed mb-6">
          {canAdd
            ? 'Add a ticker the team should track. Paste a comma-separated list and we\u2019ll parse it. You can always adjust status, owners and tags per row once it\u2019s in.'
            : 'The list owner hasn\u2019t added any tickers yet. You\u2019ll see the workspace come to life once they do.'}
        </p>

        {canAdd && (
          <div className="inline-flex flex-col items-center gap-2">
            <div className="inline-flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500">
              <kbd className="px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-[10px] font-semibold text-gray-600 dark:text-gray-300">
                Add Asset
              </kbd>
              <span>is in the top-right of this page</span>
              <ArrowUpRight className="h-3 w-3" />
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes listEmptyPulseSlow { 0%, 100% { opacity: 0.5; transform: scale(1); } 50% { opacity: 1; transform: scale(1.1); } }
        .animate-pulse-slow { animation: listEmptyPulseSlow 2.4s ease-in-out infinite; }
      `}</style>
    </div>
  )
}

function TickerChip({
  children,
  faded,
  primary
}: {
  children: React.ReactNode
  faded?: boolean
  primary?: boolean
}) {
  const base = 'inline-flex items-center justify-center px-2 py-0.5 rounded-md text-[10px] font-semibold tabular-nums border transition-all'
  if (primary) {
    return (
      <span className={`${base} bg-primary-500 text-white border-primary-500 shadow-sm shadow-primary-500/30`}>
        {children}
      </span>
    )
  }
  if (faded) {
    return (
      <span className={`${base} bg-gray-50 text-gray-400 border-gray-200 dark:bg-gray-800/60 dark:text-gray-500 dark:border-gray-700/60`}>
        {children}
      </span>
    )
  }
  return (
    <span className={`${base} bg-white text-gray-700 border-gray-200 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700`}>
      {children}
    </span>
  )
}
