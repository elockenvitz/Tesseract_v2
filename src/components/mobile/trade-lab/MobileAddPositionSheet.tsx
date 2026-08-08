import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { Plus, Search, X } from 'lucide-react'
import { BottomSheet } from '../BottomSheet'

export interface AddableAsset {
  id: string
  symbol: string
  company_name: string
  sector: string | null
}

interface MobileAddPositionSheetProps {
  open: boolean
  onClose: () => void
  /** Raw query text; the page owns the debounce and the search itself. */
  search: string
  onSearchChange: (v: string) => void
  results: AddableAsset[]
  /** Assets already in the simulation, so they can be marked rather than re-added. */
  existingAssetIds: Set<string>
  onAdd: (asset: AddableAsset) => void
}

/**
 * Add a position the portfolio does not hold.
 *
 * Every other way into the simulation starts from something that already
 * exists — a holding in the book, or an idea in the drawer. This is the path
 * for a name that is in neither: a ticker someone raises in a meeting that you
 * want to size against the book before the conversation moves on. That is
 * precisely the case the phone exists to serve, and until now it was the one
 * thing the phone could not do.
 *
 * The search runs against the full asset universe rather than the portfolio,
 * which is the point — but assets already in the simulation are marked as such,
 * because searching for a name you added a minute ago and being offered "Add"
 * again invites a duplicate the sync layer then has to resolve.
 */
export function MobileAddPositionSheet({
  open,
  onClose,
  search,
  onSearchChange,
  results,
  existingAssetIds,
  onAdd,
}: MobileAddPositionSheetProps) {
  const [touched, setTouched] = useState(false)

  // Reopening should not show the last search's results.
  useEffect(() => {
    if (open) {
      onSearchChange('')
      setTouched(false)
    }
    // onSearchChange is stable enough here; re-running on identity changes would
    // clear the field while the user is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <BottomSheet open={open} onClose={onClose} title="Add a position" snapPoints={[0.7, 0.95]}>
      <div className="px-4 pb-4">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            autoFocus
            value={search}
            onChange={e => { onSearchChange(e.target.value); setTouched(true) }}
            placeholder="Ticker or company name"
            className="w-full h-11 pl-8 pr-8 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-[15px] text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7 w-7 flex items-center justify-center rounded-full text-gray-400"
              aria-label="Clear"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <p className="mt-2 text-[11px] text-gray-400">
          Searches every asset, not just this portfolio's holdings.
        </p>

        <div className="mt-3 space-y-1">
          {!touched || !search.trim() ? (
            <p className="py-10 text-center text-sm text-gray-400">
              Start typing to find a name.
            </p>
          ) : results.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-400">
              Nothing matches “{search.trim()}”.
            </p>
          ) : (
            results.map(asset => {
              const already = existingAssetIds.has(asset.id)
              return (
                <button
                  key={asset.id}
                  type="button"
                  disabled={already}
                  onClick={() => { onAdd(asset); onClose() }}
                  className={clsx(
                    'w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left no-touch-target',
                    already
                      ? 'bg-gray-50 dark:bg-gray-800/60'
                      : 'active:bg-gray-50 dark:active:bg-gray-800'
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-gray-900 dark:text-white">
                      {asset.symbol}
                    </span>
                    <span className="block truncate text-[11px] text-gray-500 dark:text-gray-400">
                      {asset.company_name}
                      {asset.sector ? ` · ${asset.sector}` : ''}
                    </span>
                  </span>
                  {already ? (
                    <span className="shrink-0 text-[11px] font-medium text-gray-400">In simulation</span>
                  ) : (
                    <Plus className="h-4 w-4 shrink-0 text-primary-600 dark:text-primary-400" />
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>
    </BottomSheet>
  )
}
