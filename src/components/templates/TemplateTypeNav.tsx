import { useEffect, useRef } from 'react'
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
    el.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [active])

  return (
    <div className="flex-shrink-0 border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      {/* ── Phone: snap-scrolling pills ───────────────────────────────── */}
      {isMobile ? (
      <div className="relative">
        <nav
          aria-label="Template type"
          className="no-scrollbar flex snap-x snap-mandatory gap-1.5 overflow-x-auto px-3 py-2"
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
          {/* Trailing spacer so the last pill can clear the fade below. */}
          <span className="w-4 flex-none" aria-hidden="true" />
        </nav>

        {/* The edge treatment: says "there is more this way" without adding a
            control. Non-interactive, so it never eats a tap on the pill under
            it. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white to-transparent dark:from-gray-800"
        />
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
