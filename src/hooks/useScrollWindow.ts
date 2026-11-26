/**
 * How much of a long gallery is worth FETCHING yet.
 *
 * ── What this does not do ────────────────────────────────────────────────
 *
 * It does not unmount anything. Every tile stays in the DOM, in order, at
 * its own height. Card ordering, scroll position, filtering, navigation,
 * keyboard focus and every click handler are untouched, because nothing
 * about the rendered tree changes -- only the SET OF SYMBOLS handed to the
 * batched market-data read.
 *
 * That is deliberate. Virtualization was the obvious guess and the
 * measurement rejected it: on a 142-tile Dashboard the whole page cost 4
 * long tasks and 440ms of total blocking, worst 170ms, none over 200ms.
 * There is no main-thread problem to solve. Unmounting tiles would have
 * risked height jumps, lost scroll anchoring and blank cards to reclaim
 * time that was never being spent.
 *
 * The cost was NETWORK. The gallery passed all 142 symbols to
 * `useGalleryCloses`, which chunks at `floor(1000/180)` = 5 symbols per
 * request -- about 28 requests for the sparklines and as many again for the
 * year ranges, 60 measured, while only nine tiles were on screen.
 *
 * ── Why a scroll fraction rather than per-tile observers ─────────────────
 *
 * One listener on the scroll container, not 142 IntersectionObservers. The
 * window is derived from how far down the reader has got, which needs no
 * knowledge of tile heights and cannot drift out of step with a grid whose
 * column count changes with width.
 *
 * ── Monotonic, which is what makes it safe ───────────────────────────────
 *
 * The count only ever GROWS. Each symbol list is therefore a superset of
 * the last, which is the precondition for `useGalleryCloses`'s
 * `placeholderData: prev => prev` to be correct: the previous result is a
 * valid partial answer for the new key, so already-drawn sparklines stay on
 * screen while the larger request is in flight. Shrinking the window on
 * scroll-up would break that -- and would also mean a tile losing its chart
 * because the reader scrolled past it, which is the "blank card during
 * ordinary scrolling" this must not cause.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

/** Tiles fetched before any scrolling. Roughly three screens of a dense grid. */
export const DEFAULT_INITIAL_WINDOW = 24

/** How many more to admit each time the reader approaches the edge. */
export const DEFAULT_WINDOW_STEP = 24

/**
 * How many screens ahead of the reader to keep fetched.
 *
 * One full screen of lead time: far enough that a sparkline has normally
 * landed before its tile is reached, near enough that an idle reader is not
 * paying for the whole field.
 */
export const WINDOW_LOOKAHEAD_SCREENS = 1

/** The nearest ancestor that actually scrolls, or null. */
function findScroller(start: HTMLElement | null): HTMLElement | null {
  let el: HTMLElement | null = start
  while (el) {
    const style = window.getComputedStyle(el)
    if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight) return el
    el = el.parentElement
  }
  return null
}

export interface ScrollWindow {
  /** How many items of the list are currently worth fetching. */
  count: number
  /** Attach to any element inside the scrolling region. */
  containerRef: (el: HTMLElement | null) => void
  /** True once the whole list is admitted. */
  complete: boolean
}

export function useScrollWindow(
  total: number,
  options?: { initial?: number; step?: number },
): ScrollWindow {
  const initial = options?.initial ?? DEFAULT_INITIAL_WINDOW
  const step = options?.step ?? DEFAULT_WINDOW_STEP

  const [count, setCount] = useState(initial)
  const scrollerRef = useRef<HTMLElement | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  /*
   * Recomputed from scratch on every scroll rather than incremented, so a
   * jump -- a scrollbar drag, a keyboard End, a restored position -- admits
   * everything up to where the reader actually is instead of one step.
   */
  const recompute = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const { scrollTop, clientHeight, scrollHeight } = el
    if (scrollHeight <= 0) return
    const reach = scrollTop + clientHeight * (1 + WINDOW_LOOKAHEAD_SCREENS)
    const fraction = Math.min(1, reach / scrollHeight)
    const wanted = Math.ceil(fraction * total)
    setCount(prev => {
      if (prev >= total) return prev
      /* `step` rounding keeps the query key from changing on every pixel of
         scroll: a new key is a new request, and a request per scroll frame
         is the storm this is meant to prevent. */
      const stepped = Math.ceil(Math.max(wanted, initial) / step) * step
      const next = Math.min(total, Math.max(prev, stepped))
      return next === prev ? prev : next
    })
  }, [total, step, initial])

  const containerRef = useCallback((node: HTMLElement | null) => {
    cleanupRef.current?.()
    cleanupRef.current = null
    scrollerRef.current = null
    if (!node) return

    const scroller = findScroller(node)
    if (!scroller) return
    scrollerRef.current = scroller

    /* Passive: this listener never calls preventDefault, and saying so lets
       the browser keep scrolling off the main thread. */
    const onScroll = () => recompute()
    scroller.addEventListener('scroll', onScroll, { passive: true })

    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      /* A resize changes how many tiles a screen holds, and a grid reflow
         changes scrollHeight, so the window has to be re-derived. */
      ro = new ResizeObserver(() => recompute())
      ro.observe(scroller)
    }

    recompute()
    cleanupRef.current = () => {
      scroller.removeEventListener('scroll', onScroll)
      ro?.disconnect()
    }
  }, [recompute])

  useEffect(() => () => { cleanupRef.current?.() }, [])

  /*
   * A shorter list must not leave the window stranded above it -- after a
   * filter narrows the field, `count` greater than `total` would ask for
   * symbols that are no longer shown.
   */
  useEffect(() => {
    setCount(prev => (prev > total ? Math.max(Math.min(total, initial), total) : prev))
  }, [total, initial])

  return { count: Math.min(count, total), containerRef, complete: count >= total }
}
