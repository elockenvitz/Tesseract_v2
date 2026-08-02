import { useCallback, useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { ChevronDown, ChevronUp } from 'lucide-react'

interface ExpandablePanelProps {
  children: React.ReactNode
  /** Reset back to collapsed when this changes — e.g. the visible panel index. */
  resetKey?: string | number
}

/**
 * A fixed-height region that reveals the rest of its content on request.
 *
 * The feed gives each tile exactly one screen, so the space under the chart is
 * whatever is left — and it shrinks further when a pair trade's title wraps to
 * two lines. Content simply overflowed and was unreachable: the region did not
 * scroll, because a scrollable box inside a vertically-paged feed steals the
 * paging gesture.
 *
 * Scrolling is therefore off until the reader asks for it. Collapsed, the
 * region clips and vertical drags page the feed as normal. Expanded, it grows
 * and scrolls internally — the reader has said this is what they want the
 * gesture to do.
 *
 * "Show more" only appears when something is actually clipped, so a short
 * rationale carries no control at all.
 */
export function ExpandablePanel({ children, resetKey }: ExpandablePanelProps) {
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  const measure = useCallback(() => {
    const el = contentRef.current
    if (!el) return
    // A pixel of tolerance: sub-pixel layout rounding otherwise reports
    // overflow on content that visibly fits.
    setOverflows(el.scrollHeight > el.clientHeight + 1)
  }, [])

  useEffect(() => {
    setExpanded(false)
  }, [resetKey])

  useEffect(() => {
    measure()
    const el = contentRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    // Content arrives asynchronously (quotes, rationale) and the tile itself
    // resizes with the keyboard, so a one-off measurement goes stale.
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [measure, children])

  return (
    <div className="h-full flex flex-col min-h-0">
      <div
        ref={contentRef}
        className={clsx(
          'flex-1 min-h-0',
          expanded
            ? 'overflow-y-auto overscroll-contain'
            : 'overflow-hidden'
        )}
        // Once expanded the region owns vertical drags; collapsed it must not
        // capture them, or the feed cannot be paged from this part of the tile.
        style={{ touchAction: expanded ? 'pan-y' : 'none' }}
      >
        {children}
      </div>

      {(overflows || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="flex-shrink-0 self-start inline-flex items-center gap-1 pt-1 text-xs font-semibold text-primary-600 dark:text-primary-400 no-touch-target"
        >
          {expanded ? (
            <>
              Show less <ChevronUp className="h-3.5 w-3.5" />
            </>
          ) : (
            <>
              Show more <ChevronDown className="h-3.5 w-3.5" />
            </>
          )}
        </button>
      )}
    </div>
  )
}
