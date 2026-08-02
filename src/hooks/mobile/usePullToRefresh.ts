import { useCallback, useEffect, useRef, useState } from 'react'

interface UsePullToRefreshOptions {
  /**
   * The scrolling element itself, not a ref. Passing a ref meant the binding
   * effect ran once on mount — before the feed had loaded and the scroller
   * existed — bound to nothing, and never re-ran, so the gesture was dead.
   * Taking the element makes its arrival a dependency.
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

/**
 * Pull-to-refresh for the feed.
 *
 * This does not fight the browser's own pull-to-refresh, because that gesture
 * only fires when the *document* scrolls, and the mobile shell pins
 * html/body at `overflow: hidden` so it never does. The gesture is therefore
 * unclaimed, and handling it here means a refresh can refetch and reshuffle
 * the feed rather than reloading the page — which would lose scroll position
 * and re-deal the deck as a side effect.
 *
 * Only engages at scrollTop 0 and only on a downward drag, so it never steals
 * an ordinary scroll. `touchmove` is bound non-passively purely so the pull
 * can suppress the scroller's own handling once committed; until then events
 * pass through untouched.
 */
export function usePullToRefresh({
  scroller,
  onRefresh,
  threshold = 72,
  enabled = true,
}: UsePullToRefreshOptions) {
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const startY = useRef<number | null>(null)
  const active = useRef(false)
  const refreshing = useRef(false)

  const finish = useCallback(async (distance: number) => {
    startY.current = null
    active.current = false

    if (distance < threshold || refreshing.current) {
      setPullDistance(0)
      return
    }

    refreshing.current = true
    setIsRefreshing(true)
    // Hold the indicator at the threshold while work happens, so the spinner
    // does not snap back before anything visibly changes.
    setPullDistance(threshold)
    try {
      await onRefresh()
    } finally {
      refreshing.current = false
      setIsRefreshing(false)
      setPullDistance(0)
    }
  }, [onRefresh, threshold])

  useEffect(() => {
    const el = scroller
    if (!el || !enabled) return

    const onTouchStart = (e: TouchEvent) => {
      if (refreshing.current) return
      // Record a candidate only at the very top; anywhere else this is a
      // normal scroll and must be left alone.
      if (el.scrollTop > 0) {
        startY.current = null
        return
      }
      startY.current = e.touches[0].clientY
      active.current = false
    }

    const onTouchMove = (e: TouchEvent) => {
      if (startY.current == null || refreshing.current) return

      const delta = e.touches[0].clientY - startY.current
      if (delta <= 0) {
        // Upward drag — hand it back to the scroller.
        if (active.current) {
          active.current = false
          setPullDistance(0)
        }
        return
      }
      // Scrolled away from the top mid-gesture; abandon the pull.
      if (el.scrollTop > 0) {
        startY.current = null
        if (active.current) {
          active.current = false
          setPullDistance(0)
        }
        return
      }

      active.current = true
      // Stop the scroller reacting to the same gesture.
      if (e.cancelable) e.preventDefault()
      setPullDistance(Math.min(delta * RESISTANCE, MAX_PULL))
    }

    const onTouchEnd = () => {
      if (startY.current == null) return
      const distance = pullDistanceRef.current
      if (!active.current) {
        startY.current = null
        return
      }
      void finish(distance)
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
    }
  }, [scroller, enabled, finish])

  // Mirror into a ref so touchend reads the current distance without the
  // listener having to be re-bound on every pixel of travel.
  const pullDistanceRef = useRef(0)
  pullDistanceRef.current = pullDistance

  return { pullDistance, isRefreshing, threshold }
}
