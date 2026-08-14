import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import { Check, Search, X } from 'lucide-react'
import { useFeedFacets, type FeedFilter, EMPTY_FILTER, filterCount } from '../../hooks/mobile/useFeedFacets'

interface FeedFilterSheetProps {
  open: boolean
  onClose: () => void
  value: FeedFilter
  onChange: (next: FeedFilter) => void
  /** Human names for the feed's internal kind keys. */
  kindLabels: Record<string, string>
}

type Facet = 'kinds' | 'sectors' | 'countries' | 'exchanges' | 'symbols'

const TABS: { key: Facet; label: string }[] = [
  { key: 'kinds', label: 'Type' },
  { key: 'sectors', label: 'Sector' },
  { key: 'countries', label: 'Country' },
  { key: 'exchanges', label: 'Exchange' },
  { key: 'symbols', label: 'Ticker' },
]

/**
 * Curate the feed across several facets at once.
 *
 * The category chip on a tile answers "more like this" and sets exactly one
 * kind, which is the right control for a glance and useless for building a
 * view — you cannot say "European industrials, news and decisions only" by
 * tapping a chip.
 *
 * Multi-select within a facet, intersected across facets: picking two sectors
 * widens, adding a country narrows. That is the combination people expect from
 * faceted filters and the opposite of what OR-ing everything would do.
 *
 * Applied on close rather than live. Editing five facets against a feed that
 * re-shuffles under each tap is unusable, and the draft also makes Cancel mean
 * something.
 *
 * Index membership is absent on purpose — nothing in the schema models index
 * constituents, and guessing from exchange would be wrong often enough to
 * mislead.
 */
export function FeedFilterSheet({ open, onClose, value, onChange, kindLabels }: FeedFilterSheetProps) {
  const { data: facets } = useFeedFacets({ enabled: open })
  const [tab, setTab] = useState<Facet>('kinds')
  const [draft, setDraft] = useState<FeedFilter>(value)
  const [symbolQuery, setSymbolQuery] = useState('')

  // Re-seed the draft each time it opens, so a cancelled edit does not persist
  // into the next one.
  const [seenOpen, setSeenOpen] = useState(false)
  if (open && !seenOpen) { setSeenOpen(true); setDraft(value); setSymbolQuery('') }
  if (!open && seenOpen) setSeenOpen(false)

  const options = useMemo(() => {
    if (tab === 'kinds') return Object.keys(kindLabels)
    if (tab === 'sectors') return facets?.sectors ?? []
    if (tab === 'countries') return facets?.countries ?? []
    if (tab === 'exchanges') return facets?.exchanges ?? []
    const q = symbolQuery.trim().toLowerCase()
    const all = facets?.symbols ?? []
    // 900 tickers is a scroll, not a list. Selected ones stay pinned at the top
    // so they can always be removed without searching for them again.
    const selected = all.filter(s => draft.symbols.includes(s.symbol))
    const rest = q
      ? all.filter(s =>
          !draft.symbols.includes(s.symbol) &&
          (s.symbol.toLowerCase().includes(q) || (s.name ?? '').toLowerCase().includes(q)))
      : []
    return [...selected.map(s => s.symbol), ...rest.slice(0, 40).map(s => s.symbol)]
  }, [tab, facets, kindLabels, symbolQuery, draft.symbols])

  const labelFor = (opt: string) =>
    tab === 'kinds' ? (kindLabels[opt] ?? opt) : opt

  const toggle = (opt: string) => {
    const current = draft[tab]
    setDraft({
      ...draft,
      [tab]: current.includes(opt) ? current.filter(v => v !== opt) : [...current, opt],
    })
  }

  const apply = () => { onChange(draft); onClose() }

  if (!open) return null
  const count = filterCount(draft)

  return createPortal(
    <div className="fixed inset-0 z-[95] flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close filters"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />

      {/* Tall enough to browse a facet without becoming a full-screen page —
          the feed staying visible behind it is what makes this read as
          adjusting a view rather than navigating away. */}
      <div className="relative w-full h-[78dvh] flex flex-col rounded-t-3xl bg-white dark:bg-gray-900 shadow-2xl">
        <div className="flex-shrink-0 flex items-center gap-2 px-4 pt-3 pb-2 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-[17px] font-bold text-gray-900 dark:text-white">Curate feed</h2>
          {count > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-primary-600 text-white text-[11px] font-bold">
              {count}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto flex items-center justify-center h-9 w-9 rounded-full text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Facet tabs carry their own counts, so a narrowing set two tabs away
            is visible without opening it — the commonest way a faceted filter
            confuses people is a selection they have forgotten about. */}
        <div className="flex-shrink-0 flex gap-1 px-3 py-2 overflow-x-auto border-b border-gray-200 dark:border-gray-800">
          {TABS.map(t => {
            const n = draft[t.key].length
            const active = tab === t.key
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={clsx(
                  'flex items-center gap-1.5 shrink-0 px-3 py-1.5 rounded-full text-[13px] font-semibold transition-colors no-touch-target',
                  active
                    ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
                )}
              >
                {t.label}
                {n > 0 && (
                  <span className={clsx(
                    'px-1.5 rounded-full text-[10px] font-bold',
                    active ? 'bg-white/25' : 'bg-primary-600 text-white',
                  )}>
                    {n}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {tab === 'symbols' && (
          <div className="flex-shrink-0 px-4 py-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                value={symbolQuery}
                onChange={e => setSymbolQuery(e.target.value)}
                placeholder="Search ticker or company"
                className="w-full h-10 pl-9 pr-3 rounded-xl bg-gray-100 dark:bg-gray-800 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none"
              />
            </div>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 pb-2">
          {options.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-gray-400">
              {tab === 'symbols' && !symbolQuery
                ? 'Search for a ticker to add it.'
                : 'Nothing to filter by here.'}
            </p>
          ) : (
            options.map(opt => {
              const on = draft[tab].includes(opt)
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => toggle(opt)}
                  className="w-full flex items-center gap-3 min-h-[46px] px-3 rounded-xl text-left hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <span className={clsx(
                    'flex items-center justify-center h-5 w-5 rounded-md border-2 shrink-0 transition-colors',
                    on
                      ? 'bg-primary-600 border-primary-600'
                      : 'border-gray-300 dark:border-gray-600',
                  )}>
                    {on && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                  </span>
                  <span className={clsx(
                    'flex-1 min-w-0 truncate text-[15px]',
                    on ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300',
                  )}>
                    {labelFor(opt)}
                  </span>
                </button>
              )
            })
          )}
        </div>

        <div className="flex-shrink-0 flex items-center gap-2 px-4 pt-3 [padding-bottom:calc(0.75rem+env(safe-area-inset-bottom))] border-t border-gray-200 dark:border-gray-800">
          <button
            type="button"
            onClick={() => setDraft(EMPTY_FILTER)}
            disabled={count === 0}
            className="h-11 px-4 rounded-xl text-[15px] font-semibold text-gray-600 dark:text-gray-300 disabled:opacity-40"
          >
            Clear all
          </button>
          <button
            type="button"
            onClick={apply}
            className="flex-1 h-11 rounded-xl bg-primary-600 text-white text-[15px] font-bold"
          >
            {count === 0 ? 'Show everything' : `Apply ${count} filter${count === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
