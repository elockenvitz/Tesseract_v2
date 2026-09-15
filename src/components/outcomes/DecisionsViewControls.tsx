import { clsx } from 'clsx'
import { Search, X } from 'lucide-react'

export type DecisionsView = 'batches' | 'trades'

/**
 * Batches | Trades, and one search across batch name, ticker and company.
 *
 * Shared by the phone header and the desktop header; `compact` is the desktop
 * size. The search applies to whichever view is showing.
 */
export function DecisionsViewControls({
  view,
  onViewChange,
  query,
  onQueryChange,
  compact = false,
}: {
  view: DecisionsView
  onViewChange: (view: DecisionsView) => void
  query: string
  onQueryChange: (query: string) => void
  compact?: boolean
}) {
  return (
    <div data-slot="decisions-view-controls" className={clsx('flex min-w-0 items-center', compact ? 'gap-2' : 'gap-1.5')}>
      <div role="tablist" aria-label="Group decisions" className="inline-flex shrink-0 items-center p-0.5 rounded-lg bg-gray-100 dark:bg-gray-900">
        {(['batches', 'trades'] as const).map(v => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => onViewChange(v)}
            className={clsx(
              'no-touch-target tap-pad rounded-md font-medium transition-colors',
              compact ? 'h-6 px-2.5 text-[11px]' : 'h-8 px-3 text-[13px]',
              view === v ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white' : 'text-gray-500 dark:text-gray-400',
            )}
          >
            {v === 'batches' ? 'Batches' : 'Trades'}
          </button>
        ))}
      </div>
      <label className={clsx('relative flex min-w-0 flex-1 items-center', compact && 'max-w-[240px]')}>
        <Search aria-hidden className={clsx('pointer-events-none absolute left-2 text-gray-400', compact ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
        <input
          type="search"
          aria-label="Search batches, tickers and companies"
          // Short enough for the phone field: 143px of text at the forced 16px
          // mobile input size. Company names match too (see the aria-label).
          placeholder="Batches or tickers"
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          className={clsx(
            'w-full min-w-0 rounded-lg border border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white',
            compact ? 'h-7 pl-7 pr-6 text-[11px]' : 'h-9 pl-8 pr-8 text-[14px]',
          )}
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => onQueryChange('')}
            className="no-touch-target absolute right-1.5 flex h-6 w-6 items-center justify-center rounded text-gray-400"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </label>
    </div>
  )
}
