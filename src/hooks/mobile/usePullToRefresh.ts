import { useCallback, useEffect, useRef, useState } from 'react'

interface UsePullToRefreshOptions {
  /**
   * The scrolling element itself, not a ref. Passing a ref meant the binding
   * effect ran once on mount — before the feed had loaded and the scroller
   * existed — bound to nothing, and never re-ran, so the gesture was dead.
   */
  scroller: HTMLElement | null
  onRefresh: () => Promise<void> | void
  /** Drag distance, after resistance, that commits the refresh. */
  threshold?: number
  enabled?: boolean
}

/** Fraction of finger travel the indicator actually moves. */
const RESISTANCE = 0.45
/** Indicator never travels further than this, regardless of drag. */
const MAX_PULL = 96
/** Vertical travel before a pull begins. Deliberately generous: a pull is a
 *  deliberate gesture, and starting one by accident mid-scroll is worse than
 *  needing a slightly longer drag. */
const START_SLOP = 16
/** Movement needed before the gesture's axis is decided. */
const AXIS_SLOP = 6
const RELEASE_EASE = 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)'

/**
 * Pull-to-refresh for the feed.
 *
 * This does not fight the browser's own pull-to-refresh: that gesture only
 * fires when the *document* scrolls, and the mobile shell pins html/body at
 * `overflow: hidden` so it never does. Handling it here means a pull can
 * refetch and re-deal the feed rather than reloading the page.
 *
 * Movement is applied straight to the DOM rather than through React state.
 * Driving the transform from state re-rendered the whole feed — every tile and
 * every mounted chart — on each touchmove, which is what made the gesture
 * stutter. React is now told only about the things that change once or twice
 * per gesture: whether the pull is armed, and whether a refresh is running.
 */
export function usePullToRefresh({
  scroller,
  onRefresh,
  threshold = 72,
  enabled = true,
}: UsePullToRefreshOptions) {
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [armed, setArmed] = useState(false)

  const indicatorRef = useRef<HTMLElement | null>(null)
  const startY = useRef<number | null>(null)
  const startX = useRef(0)
  /** Set once a gesture is judged horizontal; it can then never become a pull. */
  const horizontal = useRef(false)
  const distance = useRef(0)
  const dragging = useRef(false)
  const refreshing = useRef(false)
  const armedRef = useRef(false)

  /** Write the current distance to both elements. No React involved. */
  const paint = useCallback((d: number, animate: boolean) => {
    const el = scroller
    if (el) {
      el.style.transition = animate ? RELEASE_EASE : 'none'
      el.style.transform = d > 0 ? `translate3d(0, ${d}px, 0)` : ''
    }
    const ind = indicatorRef.current
    if (ind) {
      ind.style.transition = animate ? RELEASE_EASE + ', opacity 160ms linear' : 'none'
      ind.style.transform = `translate3d(0, ${Math.max(d - 40, 0)}px, 0)`
      ind.style.opacity = d <= 0 ? '0' : String(Math.min(d / threshold + 0.2, 1))
    }
  }, [scroller, threshold])

  const settle = useCallback(async () => {
    const committed = distance.current >= threshold
    dragging.current = false
    startY.current = null

    if (!committed || refreshing.current) {
      distance.current = 0
      armedRef.current = false
      setArmed(false)
      paint(0, true)
      return
    }

    refreshing.current = true
    setIsRefreshing(true)
    // Hold at the threshold while the work runs, so the spinner does not snap
    // away before anything visibly changes.
    distance.current = threshold
    paint(threshold, true)
    try {
      await onRefresh()
    } finally {
      refreshing.current = false
      armedRef.current = false
      setIsRefreshing(false)
      setArmed(false)
      distance.current = 0
      paint(0, true)
    }
  }, [onRefresh, paint, threshold])

  useEffect(() => {
    const el = scroller
    if (!el || !enabled) return

    el.style.willChange = 'transform'

    const onTouchStart = (e: TouchEvent) => {
      if (refreshing.current || e.touches.length !== 1) return
      if (el.scrollTop > 0) {
        startY.current = null
        return
      }
      startY.current = e.touches[0].clientY
      startX.current = e.touches[0].clientX
      horizontal.current = false
      dragging.current = false
    }

    const onTouchMove = (e: TouchEvent) => {
      if (startY.current == null || refreshing.current) return

      const raw = e.touches[0].clientY - startY.current
      const dx = Math.abs(e.touches[0].clientX - startX.current)

      // Decide the axis once, and stick to it. Swiping a pair-trade carousel
      // drifts vertically by a few pixels, which was enough to start a pull.
      if (!dragging.current && !horizontal.current && (dx > AXIS_SLOP || raw > AXIS_SLOP)) {
        horizontal.current = dx > raw
      }
      if (horizontal.current) return

      if (raw <= START_SLOP) {
        if (dragging.current) {
          dragging.current = false
          distance.current = 0
          paint(0, true)
        }
        return
      }
      if (el.scrollTop > 0) {
        startY.current = null
        if (dragging.current) {
          dragging.current = false
          distance.current = 0
          paint(0, true)
        }
        return
      }

      dragging.current = true
      if (e.cancelable) e.preventDefault()

      const d = Math.min((raw - START_SLOP) * RESISTANCE, MAX_PULL)
      distance.current = d
      paint(d, false)

      // The only state change during a drag, and only when it flips.
      const nowArmed = d >= threshold
      if (nowArmed !== armedRef.current) {
        armedRef.current = nowArmed
        setArmed(nowArmed)
      }
    }

    const onTouchEnd = () => {
      if (startY.current == null && !dragging.current) return
      if (!dragging.current) {
        startY.current = null
        return
      }
      void settle()
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchEnd, { passive: true })

    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
      el.style.willChange = ''
      el.style.transition = ''
      el.style.transform = ''
    }
  }, [scroller, enabled, paint, settle, threshold])

  return { indicatorRef, isRefreshing, armed, threshold }
}
