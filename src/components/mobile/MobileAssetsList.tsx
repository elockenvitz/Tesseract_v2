import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { Search, TrendingUp, X } from 'lucide-react'

interface MobileAssetsListProps {
  assets: any[]
  isLoading?: boolean
  onAssetSelect?: (asset: any) => void
}

type Sort = 'symbol' | 'company' | 'sector' | 'recent'

const SORTS: { key: Sort; label: string }[] = [
  { key: 'symbol', label: 'Symbol' },
  { key: 'company', label: 'Name' },
  { key: 'sector', label: 'Sector' },
  { key: 'recent', label: 'Recent' },
]

const PRIORITY_TONE: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  medium: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  low: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
}

/**
 * The asset universe on a phone.
 *
 * AssetTableView is a 6,000-line spreadsheet: configurable columns, AI columns,
 * virtualisation, spreadsheet keyboard navigation, three row densities. None of
 * that survives 390px — the columns are user-chosen and can number a dozen, so
 * there is no fixed subset to freeze and no arrangement that stays legible.
 *
 * A list is the honest answer here rather than a compromise. Unlike the
 * simulation table, this grid is not read for cross-row numeric comparison; it
 * is read to find a name and open it. That is a list's job, and a list can
 * carry the identifying fields at a readable size instead of eleven columns at
 * an unreadable one.
 *
 * There is one density, deliberately. Choosing between three row heights is a
 * desk affordance — on a phone the only sensible height is the one where the
 * text can be read and the row can be hit.
 */
export function MobileAssetsList({ assets, isLoading, onAssetSelect }: MobileAssetsListProps) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<Sort>('symbol')

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = (assets ?? []).filter(a => {
      if (!q) return true
      return `${a.symbol ?? ''} ${a.company_name ?? ''} ${a.sector ?? ''}`.toLowerCase().includes(q)
    })
    return list.sort((a, b) => {
      switch (sort) {
        case 'company':
          return (a.company_name ?? '').localeCompare(b.company_name ?? '')
        case 'sector':
          // Unclassified names sink rather than clustering at the top under an
          // empty heading.
          return (a.sector || '￿').localeCompare(b.sector || '￿')
        case 'recent':
          return new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime()
        default:
          return (a.symbol ?? '').localeCompare(b.symbol ?? '')
      }
    })
  }, [assets, search, sort])

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-950">
      <div className="flex-shrink-0 px-3 pt-3 pb-2 space-y-2 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search symbol, company or sector"
            className="w-full h-10 pl-8 pr-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7 w-7 flex items-center justify-center rounded-full text-gray-400"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1">
          {SORTS.map(s => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSort(s.key)}
              aria-current={sort === s.key}
              className={clsx(
                'flex-1 h-8 rounded-lg text-[12px] font-medium transition-colors no-touch-target',
                sort === s.key
                  ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                  : 'text-gray-500 dark:text-gray-400 active:bg-gray-100 dark:active:bg-gray-800'
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-safe">
        {isLoading ? (
          <div className="p-3 space-y-2">
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className="h-14 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-gray-400">
            <TrendingUp className="h-8 w-8 opacity-50" />
            <p className="text-sm">{search ? 'No asset matches that.' : 'No assets yet.'}</p>
          </div>
        ) : (
          <>
            <p className="px-3 py-1.5 text-[11px] text-gray-400">
              {visible.length.toLocaleString()} {visible.length === 1 ? 'asset' : 'assets'}
            </p>
            <div className="divide-y divide-gray-100 dark:divide-gray-800 bg-white dark:bg-gray-900">
              {visible.map(asset => (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => onAssetSelect?.(asset)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left active:bg-gray-50 dark:active:bg-gray-800"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="text-sm font-bold text-gray-900 dark:text-white">
                        {asset.symbol}
                      </span>
                      {asset.priority && PRIORITY_TONE[String(asset.priority).toLowerCase()] && (
                        <span
                          className={clsx(
                            'px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide',
                            PRIORITY_TONE[String(asset.priority).toLowerCase()]
                          )}
                        >
                          {asset.priority}
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-[12px] text-gray-500 dark:text-gray-400">
                      {asset.company_name}
                    </span>
                    {asset.sector && (
                      <span className="block truncate text-[11px] text-gray-400">{asset.sector}</span>
                    )}
                  </span>

                  {asset.current_price != null && (
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
                      ${Number(asset.current_price).toFixed(2)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
