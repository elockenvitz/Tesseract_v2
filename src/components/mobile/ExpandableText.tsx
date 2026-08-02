import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { ChevronDown, ChevronUp } from 'lucide-react'

interface ExpandableTextProps {
  text: string
  /** Lines shown before clamping. */
  lines?: 2 | 3 | 4 | 5 | 6
  className?: string
}

// Tailwind needs the full class name present at build time, so the clamp
// classes cannot be interpolated.
const CLAMP: Record<number, string> = {
  2: 'line-clamp-2',
  3: 'line-clamp-3',
  4: 'line-clamp-4',
  5: 'line-clamp-5',
  6: 'line-clamp-6',
}

/**
 * Body text that clamps instead of scrolling.
 *
 * A scrollable region inside a vertically-snapping feed is a trap: the same
 * upward drag either scrolls the text or advances the card depending on where
 * the finger lands, so the card feels unpredictable. Clamping removes the
 * inner scroll entirely — the gesture always pages the feed — and "See more"
 * makes reading the rest an explicit choice.
 *
 * The toggle only appears when the text is actually cut off, measured from the
 * rendered element rather than guessed from character count, which is wrong at
 * any width but the one it was tuned for.
 */
export function ExpandableText({ text, lines = 4, className }: ExpandableTextProps) {
  const [expanded, setExpanded] = useState(false)
  const [isTruncated, setIsTruncated] = useState(false)
  const ref = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || expanded) return
    // +1 absorbs sub-pixel rounding, which otherwise reports a one-line
    // paragraph as clipped on some zoom levels.
    setIsTruncated(el.scrollHeight > el.clientHeight + 1)
  }, [text, lines, expanded])

  return (
    <div className={className}>
      <p
        ref={ref}
        className={clsx(
          'text-[15px] leading-relaxed text-gray-800 dark:text-gray-200',
          !expanded && CLAMP[lines]
        )}
      >
        {text}
      </p>

      {(isTruncated || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-primary-600 dark:text-primary-400 no-touch-target"
        >
          {expanded ? (
            <>
              See less <ChevronUp className="h-4 w-4" />
            </>
          ) : (
            <>
              See more <ChevronDown className="h-4 w-4" />
            </>
          )}
        </button>
      )}
    </div>
  )
}
