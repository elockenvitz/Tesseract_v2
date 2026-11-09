/**
 * One control for "which book am I looking at", shared.
 *
 * ── Why this is lifted rather than copied ────────────────────────────────
 *
 * This was written for Decisions and is now also the Investment Snapshot's
 * portfolio selector. The repo already carries a dozen portfolio pickers —
 * `PortfolioWorkspace`'s title combobox, Lists' grouped tri-state tree, four
 * native `<select>`s, and several modal-local ones — and the cost of that is
 * not duplication, it is DISAGREEMENT: each one decides for itself whether
 * "no selection" means every book, the first book, or nothing, and whether a
 * single-book org gets a control at all.
 *
 * The Snapshot needs the same three answers Decisions needed, so it takes the
 * same component rather than becoming the thirteenth opinion.
 *
 * ── The contract ─────────────────────────────────────────────────────────
 *
 *   null  means ALL BOOKS, and is a real, selectable state — not "unset".
 *         Organization-wide is the Snapshot's default context, so the null
 *         option is the default, not a fallback.
 *
 *   <= 1 book renders NOTHING. A choice of one is not a choice, and a control
 *         that cannot change anything is furniture that reads as a filter.
 *
 *   `count` is whatever the caller is counting — decisions on that book, or
 *         for the Snapshot, whether this asset is held in it. The component
 *         does not compute it and does not know what it means.
 */
import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { ChevronDown } from 'lucide-react'

export interface BookOption {
  id: string
  name: string
  /** Caller-defined. Rendered verbatim; omit to render no badge. */
  count?: number
  /**
   * A short word instead of a number.
   *
   * The Snapshot's per-book fact is "does this book hold the asset", which is
   * a yes/no. Rendering it through `count` printed a bare `1` or `0` beside
   * every book name — it reads as a quantity, and `0` reads as a count of
   * zero somethings rather than "not held". A word says what it means.
   */
  badge?: string
}

export function BookFilter({
  books, portfolioId, onSelect, compact, allLabel = 'All portfolios', testId = 'book-filter',
}: {
  books: BookOption[]
  portfolioId: string | null
  onSelect: (id: string | null) => void
  compact?: boolean
  /** Decisions says "All portfolios"; a held/unheld surface may want "Organization-wide". */
  allLabel?: string
  testId?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  /*
   * One book is not a choice, and it is not a page label either.
   *
   * This used to fall back to printing the book's NAME in the corner of the
   * page: passive text dressed as a filter, saying what every card on the
   * page already says about itself. The book belongs to the decision, so the
   * card names it and this renders nothing.
   */
  if (books.length <= 1) return null

  const current = books.find(b => b.id === portfolioId)

  return (
    <div ref={ref} data-testid={testId} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={clsx(
          'flex min-w-0 items-center gap-1 rounded-md border border-gray-300 hover:bg-gray-100 dark:border-white/15 dark:hover:bg-white/[0.06]',
          compact ? 'px-1.5 py-0.5 text-[11px] font-semibold' : 'px-2 py-1 text-[11px]',
        )}
      >
        <span className="min-w-0 truncate">{current?.name ?? allLabel}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-gray-500" />
      </button>
      {open && (
        <div role="listbox"
             className="absolute left-0 top-full z-20 mt-1 max-h-viewport-60 w-60 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-white/10 dark:bg-[#141a25]">
          <button type="button" role="option" aria-selected={!portfolioId}
                  onClick={() => { onSelect(null); setOpen(false) }}
                  className={clsx('block w-full px-3 py-1.5 text-left text-[12px]',
                    !portfolioId ? 'bg-blue-50 font-semibold text-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
                                 : 'hover:bg-gray-100 dark:hover:bg-white/[0.06]')}>
            {allLabel}
          </button>
          {books.map(b => (
            <button key={b.id} type="button" role="option" aria-selected={b.id === portfolioId}
                    onClick={() => { onSelect(b.id); setOpen(false) }}
                    className={clsx('flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-[12px]',
                      b.id === portfolioId ? 'bg-blue-50 font-semibold text-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
                                           : 'hover:bg-gray-100 dark:hover:bg-white/[0.06]')}>
              <span className="min-w-0 flex-1 truncate">{b.name}</span>
              {b.badge != null ? (
                <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                  {b.badge}
                </span>
              ) : b.count != null ? (
                <span className="font-mono text-[10px] text-gray-500">{b.count}</span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
