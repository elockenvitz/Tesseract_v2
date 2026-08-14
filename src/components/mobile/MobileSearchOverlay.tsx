import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import { ArrowLeft, Loader2, Search, X } from 'lucide-react'
import { useObjectSearch } from '../../hooks/useObjectSearch'
import { useExploreSearch } from '../../hooks/useExploreSearch'
import { SearchResultRow, type UnifiedResult } from './SearchResultRow'

interface MobileSearchOverlayProps {
  open: boolean
  onClose: () => void
  onSelectResult: (result: any) => void
}

/**
 * Full-screen search for phones.
 *
 * One scrolling column: the field, then every result. Apps, objects and topic
 * mentions rank against each other in a single list rather than sitting in
 * separate sections — the question being asked is "where is the thing I mean",
 * and which subsystem happens to hold the answer is not the user's problem.
 *
 * There is no floating panel. The previous version embedded GlobalSearch, which
 * draws its results in an `absolute … z-50` dropdown. On desktop that hangs
 * below a bar with page content behind it, which is right. On a phone it
 * covered the keyword results underneath, so a topic search rendered its answer
 * and then hid it, while the visible dropdown read "no results" because no
 * *object* was named that. Search looked broken while working correctly.
 *
 * The overlay owns its own input, which is safe here for the reason the header
 * never was: `size={1}` plus full width removes the intrinsic min-content width
 * that pushed the header row off-screen.
 */

/** Named matches carry no score of their own, so they get one here. */
const SCORE_APP = 150
const SCORE_NAMED = 120

export function MobileSearchOverlay({ open, onClose, onSelectResult }: MobileSearchOverlayProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')

  const { results: objectResults, isFetching } = useObjectSearch(debounced)
  const { data: exploreResults = [], isLoading: exploreLoading } = useExploreSearch(debounced)

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

  // Clear on close so reopening starts fresh rather than showing the previous
  // search's results under an empty-looking field.
  useEffect(() => {
    if (!open) { setQuery(''); setDebounced('') }
  }, [open])

  // Focus at the first frame the field exists rather than after a fixed delay.
  // iOS only raises the keyboard for a focus() it can attribute to the tap that
  // caused it, and a timeout long enough for React to paint is already too late.
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

  const trimmed = debounced.trim()
  const typing = query.trim() !== trimmed
  const loading = isFetching || exploreLoading || typing

  const results = useMemo<UnifiedResult[]>(() => {
    if (trimmed.length < 2) return []
    const byKey = new Map<string, UnifiedResult>()

    // Named matches first, so a later prose hit on the same object enriches the
    // existing row rather than adding a second one for the same thing.
    for (const r of objectResults) {
      const key = `${r.type}:${r.id}`
      byKey.set(key, {
        key,
        kind: r.type,
        title: r.title,
        subtitle: r.subtitle,
        score: r.type === 'page' ? SCORE_APP : SCORE_NAMED,
        select: () => { onClose(); onSelectResult(r) },
      })
    }

    for (const r of exploreResults) {
      // An idea's row navigates to the trade queue, but it is still an idea for
      // dedupe and iconography — the tab type is a destination, not an identity.
      const key = `${r.kind}:${r.id}`
      const existing = byKey.get(key)
      if (existing) {
        // Same object, found both ways. Keep the higher rank and take the
        // explanation from whichever half has one.
        existing.score = Math.max(existing.score, r.score)
        existing.matchedIn = existing.matchedIn ?? r.matchedIn
        existing.excerpt = existing.excerpt ?? r.excerpt
        continue
      }
      byKey.set(key, {
        key,
        kind: r.kind,
        title: r.title,
        // A relaxed hit says so. It matched some of the query, not all of it,
        // and the row has to admit that or a suggestion reads as an answer.
        matchedIn: r.related ? `related — ${r.matchedIn}` : r.matchedIn,
        excerpt: r.excerpt,
        score: r.score,
        select: () => {
          onClose()
          onSelectResult({
            id: r.id,
            title: r.title,
            type: r.kind === 'idea' ? 'trade-queue' : r.kind,
            data: r.data,
          })
        },
      })
    }

    return [...byKey.values()].sort((a, b) => b.score - a.score)
  }, [trimmed, objectResults, exploreResults, onClose, onSelectResult])

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
              loading ? 'text-primary-500' : 'text-gray-400',
            )}
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search apps, names, or a topic…"
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

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        {trimmed.length < 2 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm text-gray-400">
              Search an app, a ticker, a name, or a topic — "Trade Book", "NVDA",
              "GLP-1", "margin pressure".
            </p>
          </div>
        ) : loading && results.length === 0 ? (
          <div className="py-10 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          </div>
        ) : results.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Nothing written up on “{trimmed}” yet.
            </p>
            <p className="mt-1 text-xs text-gray-400">
              Assets, themes, lists, research notes, captured thoughts and trade
              rationales were all searched, for any word in that phrase.
            </p>
            {/* An empty result is itself information: nobody has written this
                up. That is a prompt to start, not a dead end — and telling the
                reader where the gap is, is the whole point of a search meant
                to help decide what to work on next. */}
            <p className="mt-5 text-xs font-semibold uppercase tracking-wider text-gray-400">
              That might be the opportunity
            </p>
            <p className="mt-1.5 text-[13px] text-gray-500 dark:text-gray-400">
              Capture a thought on it, or start a theme — a gap in the book is
              worth more than another note on something already covered.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800 pb-safe">
            {results.map(r => (
              <SearchResultRow key={r.key} result={r} />
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
