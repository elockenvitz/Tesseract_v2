import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { ChevronDown, ChevronUp } from 'lucide-react'
import ReactMarkdown from 'react-markdown'

interface ExpandableTextProps {
  text: string
  /** Lines shown before clamping. */
  lines?: 2 | 3 | 4 | 5 | 6
  /** Render as markdown. Contribution prose is authored in it, so raw text
   *  shows literal ** and - where bold and bullets belong. Off by default:
   *  feed rationales and thoughts are plain text, and running them through a
   *  parser would reformat anything that merely looks like markup. */
  markdown?: boolean
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
export function ExpandableText({ text, lines = 4, markdown = false, className }: ExpandableTextProps) {
  const [expanded, setExpanded] = useState(false)
  const [isTruncated, setIsTruncated] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || expanded) return
    // +1 absorbs sub-pixel rounding, which otherwise reports a one-line
    // paragraph as clipped on some zoom levels.
    setIsTruncated(el.scrollHeight > el.clientHeight + 1)
  }, [text, lines, expanded])

  return (
    <div className={className}>
      <div
        ref={ref}
        className={clsx(
          'text-[15px] leading-relaxed text-gray-800 dark:text-gray-200',
          // Styled explicitly rather than with `prose`: @tailwindcss/typography
          // is not installed (tailwind.config.js has `plugins: []`), so those
          // classes emit nothing. Preflight also strips list markers and
          // padding from ul/ol, so bullets have to be restored by hand or
          // markdown lists render as unmarked lines.
          markdown && [
            '[&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
            '[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-1',
            '[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-1',
            '[&_li]:my-0.5 [&_li]:pl-0.5',
            '[&_strong]:font-semibold [&_strong]:text-gray-900 dark:[&_strong]:text-white',
            '[&_em]:italic',
            '[&_h1]:text-base [&_h2]:text-base [&_h3]:text-[15px] [&_h1]:font-bold [&_h2]:font-bold [&_h3]:font-semibold [&_h1]:my-1 [&_h2]:my-1 [&_h3]:my-1',
            '[&_a]:text-primary-600 [&_a]:underline dark:[&_a]:text-primary-400',
            '[&_code]:rounded [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:text-[13px] dark:[&_code]:bg-gray-800',
            '[&_blockquote]:border-l-2 [&_blockquote]:border-gray-300 [&_blockquote]:pl-3 [&_blockquote]:text-gray-600 dark:[&_blockquote]:border-gray-600 dark:[&_blockquote]:text-gray-400',
          ],
          !expanded && CLAMP[lines]
        )}
      >
        {markdown ? <ReactMarkdown>{text}</ReactMarkdown> : text}
      </div>

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
