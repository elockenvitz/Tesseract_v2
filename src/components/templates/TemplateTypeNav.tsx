import { useCallback, useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { FileSpreadsheet, FileText, LayoutGrid, Zap } from 'lucide-react'
import { useIsMobile } from '../../hooks/useMediaQuery'

/**
 * Choosing which of the four template types you are working on.
 *
 * ── The problem this replaces ──────────────────────────────────────────────
 *
 * Four underline tabs — "Quick Text", "Excel Extraction", "Research Layout",
 * "Investment Case PDF" — total far more than 390px. The strip scrolled, but
 * nothing said so: the scrollbar is hidden, the last tab ended flush at the
 * screen edge with no hint of more, and labels arrived clipped mid-word
 * ("Research La…", "Investment Cas…"). A reader could not tell there were
 * four types, let alone reach the fourth.
 *
 * ── What changed ───────────────────────────────────────────────────────────
 *
 * On a phone these are pills in a snap-scrolling row, not underline tabs.
 * Three reasons:
 *
 *   * A pill has a background, so the active one is unmistakable at a glance.
 *     A 2px underline under a partly-scrolled tab is not.
 *   * `flex-none` plus `whitespace-nowrap` on the pill itself means a label
 *     can never be clipped by its own container — the row scrolls instead.
 *   * Scroll snapping makes a swipe land on a pill boundary rather than
 *     halfway through one, so movement feels deliberate.
 *
 * A fade at the right edge shows there is more, and the active pill is
 * scrolled into view on mount — so arriving on a section that is off-screen
 * still shows you where you are.
 *
 * Text is not shrunk to make this fit. The labels are full and legible; the
 * row scrolls. Desktop keeps the underline tabs exactly as they were.
 */

export type TemplateSection = 'text' | 'excel' | 'research' | 'pdf'

const TYPES: { id: TemplateSection; label: string; Icon: typeof Zap }[] = [
  { id: 'text', label: 'Quick Text', Icon: Zap },
  { id: 'excel', label: 'Excel Extraction', Icon: FileSpreadsheet },
  { id: 'research', label: 'Research Layout', Icon: LayoutGrid },
  { id: 'pdf', label: 'Investment Case PDF', Icon: FileText },
]

interface Props {
  active: TemplateSection
  onSelect: (s: TemplateSection) => void
}

export function TemplateTypeNav({ active, onSelect }: Props) {
  const activeRef = useRef<HTMLButtonElement | null>(null)
  const scrollerRef = useRef<HTMLElement | null>(null)
  // Which edges actually have more content. A fade that is always on lies
  // about the last pill: it dims a label the reader has already reached.
  const [overflow, setOverflow] = useState({ start: false, end: false })
  // One nav is RENDERED, not two hidden by CSS. `sm:hidden` on one and
  // `hidden sm:flex` on the other leaves both in the DOM: eight buttons for
  // four types, every label announced twice, and every query by role
  // ambiguous. The same reason the Templates editors never render both
  // chromes.
  const isMobile = useIsMobile()

  // Bring the current type into view on arrival. Without this, landing on
  // Investment Case PDF shows a row that appears to start at Quick Text.
  //
  // Feature-detected rather than called: `scrollIntoView` is absent in jsdom
  // and can be missing in other non-browser hosts, and a nav that throws on
  // mount takes the whole Templates surface down. Scrolling is a nicety; the
  // tabs work without it.
  useEffect(() => {
    const el = activeRef.current
    if (typeof el?.scrollIntoView !== 'function') return
    // `nearest` with scroll-padding leaves the inset either side, so the
    // active pill lands clear of the edge rather than flush against it.
    // `center` would drag the first and last pills into the middle, which
    // reads as the strip jumping for no reason.
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  /**
   * Recompute which edges have more content.
   *
   * The 1px tolerance is for fractional scroll positions: a strip scrolled
   * fully right can report scrollLeft 0.5px short and keep a fade lit over
   * nothing.
   */
  const measure = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    setOverflow({ start: el.scrollLeft > 1, end: el.scrollLeft < max - 1 })
  }, [])

  useEffect(() => {
    measure()
    const el = scrollerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure, active])

  return (
    <div className="flex-shrink-0 border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      {/* ── Phone: snap-scrolling pills ───────────────────────────────── */}
      {isMobile ? (
      <div className="relative">
        <nav
          ref={scrollerRef}
          onScroll={measure}
          aria-label="Template type"
          /* `px-3` matches the content below, so the first pill lines up with
             the cards rather than starting 12px off from them.
             `scroll-p-3` is the same inset for SCROLLING: without it a
             snapped or auto-scrolled pill lands flush against the edge, which
             reads as clipped even though the whole label is there. */
          className="no-scrollbar flex snap-x snap-mandatory gap-1.5 overflow-x-auto scroll-p-3 px-3 py-2"
        >
          {TYPES.map(({ id, label, Icon }) => {
            const isActive = id === active
            return (
              <button
                key={id}
                ref={isActive ? activeRef : undefined}
                type="button"
                onClick={() => onSelect(id)}
                aria-current={isActive ? 'page' : undefined}
                className={clsx(
                  // `flex-none` + `whitespace-nowrap`: the pill is as wide as
                  // its label needs, and the ROW scrolls. Nothing truncates.
                  'no-touch-target flex flex-none snap-start items-center gap-1.5 whitespace-nowrap',
                  'rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors',
                  isActive
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {label}
              </button>
            )
          })}
        </nav>

        {/* Edge treatment, shown only where there IS more.
            A permanent fade dims the last pill once you have reached it,
            which says "there is more" when there is not — and the reader
            stops trusting it. Non-interactive, so neither ever eats a tap. */}
        {overflow.start && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-white to-transparent dark:from-gray-800"
          />
        )}
        {overflow.end && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-white to-transparent dark:from-gray-800"
          />
        )}
      </div>
      ) : (
      /* ── Desktop: unchanged underline tabs ─────────────────────────── */
      <nav className="flex gap-4 px-6" aria-label="Tabs">
        {TYPES.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => onSelect(id)}
            className={clsx(
              'shrink-0 whitespace-nowrap py-3 px-1 border-b-2 text-sm font-medium transition-colors flex items-center gap-2',
              id === active
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:hover:text-gray-200 dark:text-gray-400',
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </nav>
      )}
    </div>
  )
}
