import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import { ArrowLeft, Search, X } from 'lucide-react'
import { useObjectSearch, type SearchResult } from '../../hooks/useObjectSearch'
import { ExploreResults } from './ExploreResults'
import { ObjectResultRow } from './ObjectResultRow'

interface MobileSearchOverlayProps {
  open: boolean
  onClose: () => void
  onSelectResult: (result: any) => void
}

/**
 * Full-screen search for phones.
 *
 * Everything renders in one scrolling column: the field at the top, then
 * matches by name, then matches by topic. There is no floating panel.
 *
 * The previous version embedded GlobalSearch, which draws its results in an
 * `absolute … z-50` dropdown. On desktop that panel hangs below a bar with
 * page content behind it, which is right. On a phone it covered the keyword
 * results underneath — so a topic search rendered its answer and then hid it,
 * and the visible dropdown said "no results" because no *object* was named
 * that. Search looked broken while working correctly.
 *
 * Splitting the query into useObjectSearch let both result sets become plain
 * content in the same scroller. The header still cannot host the field —
 * an `<input>` carries an intrinsic min-content width that no `min-w-0` can
 * shrink past — but at full width on its own surface that constraint is gone.
 */
export function MobileSearchOverlay({ open, onClose, onSelectResult }: MobileSearchOverlayProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')

  const { results: objectResults, isFetching } = useObjectSearch(debounced)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  // Clear the term on close so reopening starts fresh rather than showing the
  // previous search's results under an empty-looking field.
  useEffect(() => {
    if (!open) { setQuery(''); setDebounced('') }
  }, [open])

  // Focus at the first frame the field exists rather than after a fixed delay.
  // iOS only raises the keyboard for a focus() it can attribute to the tap that
  // caused it, and a timeout long enough for React to paint is already too
  // late — the field took focus but no keyboard appeared.
  useEffect(() => {
    if (!open) return
    let frames = 0
    let cancelled = false
    const tryFocus = () => {
      if (cancelled) return
      const input = inputRef.current
      if (input) {
        input.focus()
        const end = input.value.length
        try { input.setSelectionRange(end, end) } catch { /* not all inputs support it */ }
        return
      }
      if (frames++ < 60) requestAnimationFrame(tryFocus)
    }
    tryFocus()
    return () => { cancelled = true }
  }, [open])

  const handleSelect = (result: SearchResult | { id: string; title: string; type: string; data: any }) => {
    onClose()
    onSelectResult(result)
  }

  const trimmed = debounced.trim()
  const typing = query.trim() !== trimmed
  const showObjects = trimmed.length > 1 && objectResults.length > 0

  const heading = useMemo(() => {
    if (trimmed.length < 2) return null
    return `${objectResults.length} named match${objectResults.length === 1 ? '' : 'es'}`
  }, [trimmed, objectResults.length])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      className={clsx('fixed inset-0 z-[80] flex flex-col', 'bg-white dark:bg-gray-900')}
    >
      <div className="flex-shrink-0 flex items-center gap-1.5 px-2 h-16 pt-safe border-b border-gray-200 dark:border-gray-700">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center justify-center h-11 w-11 flex-shrink-0 rounded-full text-gray-600 dark:text-gray-300 active:bg-gray-100 dark:active:bg-gray-800"
          aria-label="Close search"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        <div className="relative flex-1 min-w-0">
          <Search
            className={clsx(
              'pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 transition-colors',
              isFetching ? 'text-primary-500' : 'text-gray-400',
            )}
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search or explore a topic…"
            // A phone keyboard that autocapitalises and autocorrects fights
            // ticker entry: "nvda" becomes "Nvda" and "GLP-1" gets rewritten.
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            // `size` is what gives an input its intrinsic min-content width.
            // Left alone it holds this row wider than the viewport.
            size={1}
            className="block w-full min-w-0 pl-9 pr-9 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-base text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(''); inputRef.current?.focus() }}
              aria-label="Clear search"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 flex items-center justify-center rounded-full text-gray-400 active:bg-gray-200 dark:active:bg-gray-700 no-touch-target"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* One scroller for both result kinds. Nothing floats over anything. */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        {showObjects && (
          <>
            <div className="px-4 pt-3 pb-1.5 flex items-baseline gap-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                {heading}
              </h2>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {objectResults.map(result => (
                <ObjectResultRow
                  key={`${result.type}-${result.id}`}
                  result={result}
                  onSelect={() => handleSelect(result)}
                />
              ))}
            </div>
            <div className="h-2 bg-gray-50 dark:bg-gray-800/40 border-y border-gray-100 dark:border-gray-800" />
          </>
        )}

        {/* Topic matches: the same term against prose rather than names, so a
            keyword with no matching object still leads somewhere. */}
        <ExploreResults
          query={debounced}
          pending={typing}
          onSelect={result => handleSelect(result)}
        />
      </div>
    </div>,
    document.body
  )
}
