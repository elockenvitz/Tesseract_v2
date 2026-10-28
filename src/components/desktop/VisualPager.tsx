/**
 * The control that pages a card between its pictures.
 *
 * ── Why this is a component and not three words ──────────────────────────
 *
 * Today's first version of this was three labels in the same 10px
 * letter-spaced uppercase as every caption and axis label on the card. On a
 * surface made of small uppercase strings, one more small uppercase string
 * is a label: nothing about it said "press me", and the carousel went
 * unused.
 *
 * A segmented control says it -- a filled track, a raised thumb on the
 * selection, sentence case at a readable size, and arrows either side so the
 * gesture is obvious even if the segments are not.
 *
 * ── Why it is shared ─────────────────────────────────────────────────────
 *
 * The Ideas gallery had its own: mobile's `CarouselControls`, two 4px dots
 * under the picture. Measured on the live field, a reader could not tell
 * those cards had a second panel at all. Two surfaces, one gesture, two
 * vocabularies -- so the control moves here and both read it the same way.
 *
 * It draws nothing for a single panel: a pager over one page is furniture.
 */

import { clsx } from 'clsx'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export interface VisualPagerProps {
  /** One short, sentence-case word per panel. "Price", "Cases", "Age". */
  labels: readonly string[]
  /**
   * The panel's own identity, emitted as `data-archetype`.
   *
   * Separate from the label because the label is a word for a reader and
   * this is a handle for a test or a later transition. Defaults to the
   * label, which is right wherever the two are the same.
   */
  keys?: readonly string[]
  index: number
  onChange: (next: number) => void
  /** Read aloud on each segment, where the short label is not enough. */
  describe?: (index: number) => string
  className?: string
}

export function VisualPager({
  labels, keys, index, onChange, describe, className,
}: VisualPagerProps) {
  if (labels.length < 2) return null

  const active = Math.min(Math.max(index, 0), labels.length - 1)
  const step = (by: number) =>
    onChange(((active + by) % labels.length + labels.length) % labels.length)

  return (
    <div
      data-testid="visual-pager"
      className={clsx('flex shrink-0 items-center gap-1', className)}
      onKeyDown={e => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
        // The card itself is clickable and listens for keys; a pager that let
        // them through would open the object while the reader was paging it.
        e.stopPropagation()
        e.preventDefault()
        step(e.key === 'ArrowLeft' ? -1 : 1)
      }}
    >
      <PagerArrow dir={-1} onClick={() => step(-1)} />
      <div className="flex items-center gap-0.5 rounded-full bg-gray-100 p-0.5 dark:bg-white/[0.07]">
        {labels.map((label, i) => (
          <button
            key={`${label}-${i}`}
            type="button"
            data-testid="visual-pager-tab"
            data-archetype={keys?.[i] ?? label}
            aria-pressed={i === active}
            aria-label={describe?.(i)}
            onClick={e => { e.stopPropagation(); onChange(i) }}
            className={clsx(
              'rounded-full px-2.5 py-[3px] text-[11px] font-semibold transition-colors',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600',
              i === active
                ? 'bg-white text-gray-900 shadow-sm dark:bg-[#2a3447] dark:text-white'
                : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <PagerArrow dir={1} onClick={() => step(1)} />
    </div>
  )
}

function PagerArrow({ dir, onClick }: { dir: -1 | 1; onClick: () => void }) {
  const Icon = dir === -1 ? ChevronLeft : ChevronRight
  return (
    <button
      type="button"
      data-testid="visual-pager-arrow"
      data-dir={dir}
      aria-label={dir === -1 ? 'Previous chart' : 'Next chart'}
      onClick={e => { e.stopPropagation(); onClick() }}
      className="grid h-5 w-5 place-items-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 dark:hover:bg-white/10 dark:hover:text-gray-100"
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  )
}
