import { useRef, useCallback } from 'react'

/**
 * Horizontal swipe paging that coexists with a vertically-paged feed.
 *
 * The carousels here previously paged by arrow tap, for two documented
 * reasons: a horizontal scroll-snap container is a scroll container, so
 * vertical drags starting inside it were absorbed rather than passed up to the
 * feed; and on charts a horizontal drag belongs to the crosshair.
 *
 * Both are solvable without a scroll container. This locks to an axis on the
 * first few pixels of movement and then commits: past the threshold a gesture
 * is either a page or a scroll, never both, and a vertical gesture is left
 * entirely alone so the feed still pages under the finger.
 *
 * `preventDefault` is only called once the gesture has been claimed as
 * horizontal — calling it earlier would kill vertical scrolling started inside
 * the carousel, which is the exact bug the arrows were working around.
 */

export interface UseSwipeOptions {
  onNext: () => void
  onPrevious: () => void
  /** Minimum horizontal travel to count as a swipe. */
  threshold?: number
  /**
   * How much more horizontal than vertical the movement must be before the
   * gesture is claimed. 1.2 is deliberately forgiving — thumbs arc, and a
   * strict 1:1 makes honest side-swipes register as vertical.
   */
  axisRatio?: number
  enabled?: boolean
}

export function useSwipe({
  onNext,
  onPrevious,
  threshold = 45,
  axisRatio = 1.2,
  enabled = true,
}: UseSwipeOptions) {
  const state = useRef<{
    startX: number
    startY: number
    axis: 'undecided' | 'horizontal' | 'vertical'
    fired: boolean
  } | null>(null)

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (!enabled || e.touches.length !== 1) return
    const t = e.touches[0]
    state.current = { startX: t.clientX, startY: t.clientY, axis: 'undecided', fired: false }
  }, [enabled])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const s = state.current
    if (!s || e.touches.length !== 1) return
    const t = e.touches[0]
    const dx = t.clientX - s.startX
    const dy = t.clientY - s.startY

    if (s.axis === 'undecided') {
      // Wait for enough travel to tell the axes apart. Deciding on the first
      // pixel makes the lock a coin flip.
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return
      s.axis = Math.abs(dx) > Math.abs(dy) * axisRatio ? 'horizontal' : 'vertical'
    }

    if (s.axis !== 'horizontal') return

    // Claimed: stop the page (and any chart crosshair) from also acting on it.
    if (e.cancelable) e.preventDefault()

    if (!s.fired && Math.abs(dx) >= threshold) {
      s.fired = true
      if (dx < 0) onNext()
      else onPrevious()
    }
  }, [axisRatio, threshold, onNext, onPrevious])

  const onTouchEnd = useCallback(() => {
    state.current = null
  }, [])

  if (!enabled) return {}

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd }
}
