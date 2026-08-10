import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { ChevronDown, Flag, Search, X } from 'lucide-react'
import { ListRowExpansion } from './ListRowExpansion'
import type { ListPermissions } from '../../hooks/lists/useListPermissions'

interface MobileListRowsProps {
  listId: string
  assets: any[]
  isLoading?: boolean
  permissions: ListPermissions
  onAssetSelect?: (asset: any) => void
  /** Screens compute their rows from criteria, so list-scoped fields don't apply. */
  hideListColumns?: boolean
}

/**
 * A list's rows on a phone.
 *
 * AssetTableView is not used here for the same reason it is not used on the
 * Assets page or in a theme: a configurable multi-column grid does not resolve
 * to 390px. But a list is not a watchlist either, so MobileAssetsList is the
 * wrong substitute — it shows price and a sparkline, and drops the three
 * things that make a row belong to a list rather than to the market: who owns
 * it, what state it is in, and how it is tagged.
 *
 * So the row carries identity plus exactly those list-scoped fields, and
 * tapping it expands the full context in place rather than navigating away —
 * the same expandable-row contract the desktop table honours.
 */
export function MobileListRows({
  listId,
  assets,
  isLoading,
  permissions,
  onAssetSelect,
  hideListColumns,
}: MobileListRowsProps) {
  const [query, setQuery] = useState('')
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return assets
    return assets.filter(a =>
      (a.symbol || '').toLowerCase().includes(q) ||
      (a.company_name || '').toLowerCase().includes(q)
    )
  }, [assets, query])

  if (isLoading) {
    return (
      <div className="space-y-1.5 py-2">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-14 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-0">
      {/* Search stays out of the filter sheet: finding one known ticker in a
          list is the common act, and it should not cost two taps. */}
      <div className="relative py-2 shrink-0">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${assets.length} asset${assets.length === 1 ? '' : 's'}…`}
          className="w-full pl-8 pr-8 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="no-touch-target absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain divide-y divide-gray-100 dark:divide-gray-800">
        {filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-400">
            {query ? `No assets match “${query}”` : 'No assets in this list'}
          </p>
        ) : (
          filtered.map(asset => {
            const rowId: string = asset._rowId || asset.id
            const isExpanded = expandedRowId === rowId
            const status = !hideListColumns ? asset._status : null
            const assignee = !hideListColumns ? asset._assignee : null
            const tags: any[] = !hideListColumns ? (asset._tags ?? []) : []
            const isFlagged = !hideListColumns && !!asset._isFlagged

            const assigneeLabel = assignee
              ? (assignee.first_name || assignee.email || '?')
              : null

            return (
              <div key={rowId}>
                <button
                  onClick={() => setExpandedRowId(isExpanded ? null : rowId)}
                  aria-expanded={isExpanded}
                  className="w-full text-left px-1 py-2.5 flex items-start gap-2.5 active:bg-gray-50 dark:active:bg-gray-800/60"
                >
                  {/* Status accent — the same signal the desktop row carries
                      as a left border. */}
                  <span
                    className="mt-1.5 w-1 h-8 rounded-full shrink-0"
                    style={{ backgroundColor: status?.color || 'transparent' }}
                  />

                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="text-[15px] font-semibold text-gray-900 dark:text-white shrink-0">
                        {asset.symbol}
                      </span>
                      <span className="text-xs text-gray-400 truncate min-w-0">
                        {asset.company_name}
                      </span>
                      {isFlagged && <Flag className="h-3 w-3 text-amber-500 fill-current shrink-0" />}
                    </span>

                    {(status || assigneeLabel || tags.length > 0) && (
                      <span className="flex items-center gap-1.5 mt-1 min-w-0">
                        {status && (
                          <span
                            className="shrink-0 px-1.5 py-px rounded text-[10px] font-medium"
                            style={{
                              backgroundColor: `${status.color}1a`,
                              color: status.color || undefined,
                            }}
                          >
                            {status.name}
                          </span>
                        )}
                        {assigneeLabel && (
                          <span className="shrink-0 text-[10px] text-gray-500 dark:text-gray-400">
                            {assigneeLabel}
                          </span>
                        )}
                        {tags.slice(0, 2).map((t: any) => (
                          <span
                            key={t.id}
                            className="shrink-0 px-1.5 py-px rounded text-[10px] bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                          >
                            {t.name}
                          </span>
                        ))}
                        {tags.length > 2 && (
                          <span className="shrink-0 text-[10px] text-gray-400">+{tags.length - 2}</span>
                        )}
                      </span>
                    )}
                  </span>

                  <ChevronDown className={clsx(
                    'h-4 w-4 shrink-0 mt-1 text-gray-400 transition-transform',
                    isExpanded && 'rotate-180',
                  )} />
                </button>

                {isExpanded && (
                  <div className="px-1 pb-3">
                    <ListRowExpansion
                      listId={listId}
                      rowId={rowId}
                      asset={asset}
                      canEdit={!hideListColumns && permissions.canEditItemNotes({ added_by: asset._addedBy ?? null })}
                      onOpenAsset={onAssetSelect ? () => onAssetSelect(asset) : undefined}
                    />
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
