import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { Search, TrendingUp, X } from 'lucide-react'
import { useMarketData } from '../../hooks/useMarketData'
import { MobileAssetPreview } from './MobileAssetPreview'

interface MobileAssetsListProps {
  assets: any[]
  isLoading?: boolean
  onAssetSelect?: (asset: any) => void
}

type Sort = 'symbol' | 'company' | 'change' | 'recent'

const SORTS: { key: Sort; label: string }[] = [
  { key: 'symbol', label: 'Symbol' },
  { key: 'company', label: 'Name' },
  { key: 'change', label: 'Change' },
  { key: 'recent', label: 'Recent' },
]

/**
 * How many rows get a live quote.
 *
 * useMarketData fetches per symbol, so quoting a thousand-name universe on
 * mount would fire a thousand requests for rows nobody has scrolled to. The
 * visible window is roughly a dozen; this covers several screens of scrolling
 * without turning the list into a load test, and rows past it fall back to the
 * stored price rather than showing nothing.
 */
const QUOTE_LIMIT = 60

/**
 * The asset universe as a watchlist.
 *
 * Laid out like a phone brokerage watchlist because that is the shape the
 * information already has: an identifier, a name, a price and a move. Symbol
 * and company on the left, last price right-aligned with the day's change as a
 * filled pill beneath it — the pill rather than coloured text because on a
 * small screen a tinted number reads as decoration until you look twice, and
 * the sign of the move is the thing being scanned for.
 *
 * There is no sparkline, deliberately. The MiniChart component this could have
 * reused builds its series with ChartDataAdapter.generateHistoricalData — a
 * seeded random walk anchored to the current quote, not price history. A drawn
 * line beside a real price reads as real, and inventing one in a finance
 * product is worse than leaving the space empty. A real sparkline needs a
 * candle request per symbol, which is a different piece of work.
 *
 * One density. Row height that trades legibility for row count is a desk
 * affordance; here the only sensible height is the one that can be read and hit.
 */
export function MobileAssetsList({ assets, isLoading, onAssetSelect }: MobileAssetsListProps) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<Sort>('symbol')
  // A tap opens the name full screen first; the asset page is a second,
  // deliberate step from there.
  const [previewing, setPreviewing] = useState<any | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return assets ?? []
    return (assets ?? []).filter(a =>
      `${a.symbol ?? ''} ${a.company_name ?? ''} ${a.sector ?? ''}`.toLowerCase().includes(q)
    )
  }, [assets, search])

  // Quote only the head of the list, and re-quote as the user narrows it —
  // a search that surfaces a name should price it.
  const quotedSymbols = useMemo(
    () => filtered.slice(0, QUOTE_LIMIT).map(a => a.symbol).filter(Boolean),
    [filtered]
  )
  const { quotes } = useMarketData(quotedSymbols, { refreshInterval: 60_000 })

  const visible = useMemo(() => {
    const list = [...filtered]
    const changeOf = (a: any) => quotes.get(String(a.symbol).toUpperCase())?.changePercent ?? null
    return list.sort((a, b) => {
      switch (sort) {
        case 'company':
          return (a.company_name ?? '').localeCompare(b.company_name ?? '')
        case 'change': {
          // Unquoted rows sink rather than sorting as zero, which would scatter
          // them through the middle of the list as if they were flat.
          const av = changeOf(a)
          const bv = changeOf(b)
          if (av == null && bv == null) return 0
          if (av == null) return 1
          if (bv == null) return -1
          return bv - av
        }
        case 'recent':
          return new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime()
        default:
          return (a.symbol ?? '').localeCompare(b.symbol ?? '')
      }
    })
  }, [filtered, sort, quotes])

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-950">
      <div className="flex-shrink-0 px-3 pt-3 pb-2 space-y-2 border-b border-gray-100 dark:border-gray-800">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search symbol or company"
            className="w-full h-10 pl-8 pr-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
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
                  ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
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
            {[0, 1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-14 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-gray-400">
            <TrendingUp className="h-8 w-8 opacity-50" />
            <p className="text-sm">{search ? 'No asset matches that.' : 'No assets yet.'}</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {visible.map(asset => (
              <WatchRow
                key={asset.id}
                asset={asset}
                quote={quotes.get(String(asset.symbol).toUpperCase())}
                onSelect={() => setPreviewing(asset)}
              />
            ))}
          </div>
        )}
      </div>

      {previewing && (
        <MobileAssetPreview
          asset={previewing}
          onClose={() => setPreviewing(null)}
          onOpenAssetPage={() => {
            const asset = previewing
            setPreviewing(null)
            // The shape DashboardPage.handleSearchResult expects. Passing the
            // bare row leaves result.type undefined, which falls through to the
            // unregistered-surface default and renders "desktop only".
            onAssetSelect?.({ id: asset.id, title: asset.symbol, type: 'asset', data: asset })
          }}
        />
      )}
    </div>
  )
}

function WatchRow({
  asset,
  quote,
  onSelect,
}: {
  asset: any
  quote?: { price?: number; change?: number; changePercent?: number }
  onSelect: () => void
}) {
  // The stored price is the fallback so a row never renders blank; it is a
  // cached figure rather than a live one, which is why the change pill only
  // appears when there is a real quote behind it.
  const price = quote?.price ?? (asset.current_price != null ? Number(asset.current_price) : null)
  const pct = quote?.changePercent
  const up = (pct ?? 0) >= 0

  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-gray-50 dark:active:bg-gray-900"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-bold leading-tight text-gray-900 dark:text-white">
          {asset.symbol}
        </span>
        <span className="block truncate text-[12px] leading-tight text-gray-500 dark:text-gray-400">
          {asset.company_name}
        </span>
      </span>

      <span className="shrink-0 flex flex-col items-end gap-1">
        <span className="text-[15px] font-semibold tabular-nums leading-tight text-gray-900 dark:text-white">
          {price != null ? price.toFixed(2) : '—'}
        </span>
        {pct != null ? (
          <span
            className={clsx(
              'min-w-[4.25rem] text-center px-2 py-0.5 rounded-md text-[12px] font-semibold tabular-nums text-white',
              up ? 'bg-emerald-500' : 'bg-red-500'
            )}
          >
            {up ? '+' : ''}
            {pct.toFixed(2)}%
          </span>
        ) : (
          // Fixed width so the price column does not shift as quotes land.
          <span className="min-w-[4.25rem] text-center px-2 py-0.5 rounded-md text-[12px] font-semibold text-gray-400 bg-gray-100 dark:bg-gray-800">
            —
          </span>
        )}
      </span>
    </button>
  )
}
