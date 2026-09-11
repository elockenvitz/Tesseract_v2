import { useEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Search, X } from 'lucide-react'
import {
  EMPTY_FILTER, filterCount, useFeedFacets, type FeedFilter,
} from '../../hooks/mobile/useFeedFacets'

/**
 * Curate, for a wide screen.
 *
 * The mobile control is a bottom sheet with one facet visible at a time,
 * because a phone has room for one. The SEMANTICS are the thing to preserve,
 * not the sheet:
 *
 *   multi-select within a facet widens it
 *   facets intersect, so adding one narrows
 *   edits are STAGED while open; Apply commits, Cancel discards
 *
 * The staging is the part that matters most and the part a desktop build is
 * most tempted to drop. `FeedFilterSheet` applies on close and says why:
 * editing five facets against a feed that re-shuffles under each tap is
 * unusable, and the draft is what makes Cancel mean something. A wide screen
 * does not change that — it makes it worse, because more of the feed is
 * visible to re-shuffle.
 *
 * ── Why a popover rather than a rail ──────────────────────────────────────
 *
 * The feed has a fixed measure so that Stage 5 can open a work region beside
 * it without reflowing every card. A permanent filter rail would spend that
 * width on controls that are used occasionally, and would have to give it back
 * later. A popover borrows the space only while it is open.
 *
 * Facets come from `useFeedFacets`, the same hook the sheet uses. The list is
 * one query, cached for thirty minutes, and only fetched while the panel is
 * open.
 */

type FacetKey = 'kinds' | 'signalTypes' | 'sectors' | 'countries' | 'exchanges' | 'symbols'

const FACETS: { key: FacetKey; label: string }[] = [
  { key: 'kinds', label: 'Category' },
  { key: 'signalTypes', label: 'Signal' },
  { key: 'sectors', label: 'Sector' },
  { key: 'countries', label: 'Country' },
  { key: 'exchanges', label: 'Exchange' },
  { key: 'symbols', label: 'Ticker' },
]

export function CuratePanel({
  open, value, onApply, onClose, kindLabels = {}, signalTypeLabels = {},
}: {
  open: boolean
  /** The APPLIED filter. The draft below is seeded from it on each open. */
  value: FeedFilter
  onApply: (next: FeedFilter) => void
  onClose: () => void
  kindLabels?: Record<string, string>
  signalTypeLabels?: Record<string, string>
}) {
  const { data: facets } = useFeedFacets({ enabled: open })
  const [tab, setTab] = useState<FacetKey>('kinds')
  const [draft, setDraft] = useState<FeedFilter>(value)
  const [symbolQuery, setSymbolQuery] = useState('')
  const ref = useRef<HTMLDivElement | null>(null)

  /*
   * Re-seed on each open, so a cancelled edit does not survive into the next
   * visit. Same reason the sheet does it.
   */
  useEffect(() => {
    if (open) { setDraft(value); setSymbolQuery('') }
  }, [open, value])

  /*
   * Clicking away CANCELS rather than applies.
   *
   * The sheet applies on close because a phone sheet is dismissed
   * deliberately. A popover is dismissed by looking somewhere else, and
   * committing a half-built filter because the reader glanced at the feed
   * would be a change they never asked for. Apply is the only commit.
   */
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  const options = useMemo(() => {
    if (!facets) return [] as { value: string; label: string }[]
    if (tab === 'sectors') return facets.sectors.map(v => ({ value: v, label: v }))
    if (tab === 'countries') return facets.countries.map(v => ({ value: v, label: v }))
    if (tab === 'exchanges') return facets.exchanges.map(v => ({ value: v, label: v }))
    if (tab === 'kinds') return Object.entries(kindLabels).map(([value, label]) => ({ value, label }))
    if (tab === 'signalTypes') return Object.entries(signalTypeLabels).map(([value, label]) => ({ value, label }))
    // Tickers are the one facet that can run to thousands, so it searches.
    const q = symbolQuery.trim().toUpperCase()
    const all = facets.symbols.map(s => ({ value: s.symbol, label: s.name ? `${s.symbol} · ${s.name}` : s.symbol }))
    const picked = all.filter(o => draft.symbols.includes(o.value))
    if (!q) return picked.length ? picked : all.slice(0, 40)
    return all.filter(o => o.label.toUpperCase().includes(q)).slice(0, 40)
  }, [facets, tab, kindLabels, signalTypeLabels, symbolQuery, draft.symbols])

  if (!open) return null

  const selected = draft[tab]
  const toggle = (v: string) => setDraft(d => ({
    ...d,
    [tab]: d[tab].includes(v) ? d[tab].filter(x => x !== v) : [...d[tab], v],
  }))

  const staged = filterCount(draft)

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Curate feed"
      className="absolute left-0 top-full z-40 mt-2 w-[34rem] rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800"
    >
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5 dark:border-gray-700">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Curate feed</h2>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            Several values widen a facet. Facets combine to narrow.
          </p>
        </div>
        <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex">
        {/* Facets as a column, not a tab strip: desktop has the width, and a
            reader building a view wants to see which facets they have already
            touched without cycling through them. */}
        <div className="w-36 shrink-0 border-r border-gray-100 py-2 dark:border-gray-700">
          {FACETS.map(f => {
            const n = draft[f.key].length
            return (
              <button
                key={f.key}
                onClick={() => setTab(f.key)}
                className={clsx(
                  'flex w-full items-center justify-between px-3 py-1.5 text-left text-[13px]',
                  tab === f.key
                    ? 'bg-gray-100 font-semibold text-gray-900 dark:bg-gray-700 dark:text-white'
                    : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/60',
                )}
              >
                {f.label}
                {n > 0 && (
                  <span className="rounded-full bg-primary-600 px-1.5 text-[10px] font-bold text-white">{n}</span>
                )}
              </button>
            )
          })}
        </div>

        <div className="min-w-0 flex-1 p-3">
          {tab === 'symbols' && (
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <input
                value={symbolQuery}
                onChange={e => setSymbolQuery(e.target.value)}
                placeholder="Search tickers…"
                className="w-full rounded-lg border border-gray-200 py-1.5 pl-8 pr-2 text-sm dark:border-gray-600 dark:bg-gray-900"
              />
            </div>
          )}
          <div className="max-h-64 overflow-y-auto">
            {options.length === 0 && (
              <p className="px-1 py-6 text-center text-xs text-gray-400">Nothing to choose from here.</p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {options.map(o => {
                const on = selected.includes(o.value)
                return (
                  <button
                    key={o.value}
                    onClick={() => toggle(o.value)}
                    className={clsx(
                      'rounded-full px-2.5 py-1 text-[13px] font-medium transition-colors',
                      on
                        ? 'bg-primary-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600',
                    )}
                  >
                    {o.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2.5 dark:border-gray-700">
        <button
          onClick={() => setDraft(EMPTY_FILTER)}
          disabled={staged === 0}
          className="text-[13px] font-medium text-gray-500 hover:text-gray-700 disabled:opacity-40 dark:text-gray-400"
        >
          Clear all
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={() => { onApply(draft); onClose() }}
            className="rounded-lg bg-gray-900 px-3 py-1.5 text-[13px] font-bold text-white dark:bg-white dark:text-gray-900"
          >
            {staged > 0 ? `Apply ${staged}` : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  )
}
