import { useEffect, useRef, useState } from 'react'

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
 * ## Why this attaches listeners itself instead of returning JSX props
 *
 * React registers `touchstart` and `touchmove` at the root as **passive**
 * listeners. Inside a React `onTouchMove` handler `event.cancelable` is
 * therefore `false` and `preventDefault()` does nothing — so the first version
 * of this hook, which spread `{...swipe}` onto a div, could detect a swipe but
 * could never claim it. The browser kept panning and a chart underneath kept
 * tracking its crosshair through the same drag.
 *
 * Attaching to the node directly with `{ passive: false }` is the only way to
 * get a cancelable touchmove. `touch-action: pan-y` is set alongside it, which
 * tells the compositor up front that horizontal panning belongs to us —
 * declarative, applied before any JS runs, and it keeps vertical scrolling on
 * the fast path.
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
  // State rather than a ref, so mounting the node re-runs the effect below.
  // With a plain ref the effect fires once on mount and never learns about a
  // node that appears later or is swapped out by a conditional render.
  const [node, setNode] = useState<HTMLElement | null>(null)
  const gesture = useRef<{
    startX: number
    startY: number
    axis: 'undecided' | 'horizontal' | 'vertical'
    fired: boolean
  } | null>(null)

  // Held in refs so re-registering listeners is not required every time a
  // parent re-renders with new closures — the listeners are attached once per
  // node and read the current callbacks when they fire.
  const opts = useRef({ onNext, onPrevious, threshold, axisRatio, enabled })
  opts.current = { onNext, onPrevious, threshold, axisRatio, enabled }

  useEffect(() => {
    const el = node
    if (!el) return

    const onTouchStart = (e: TouchEvent) => {
      if (!opts.current.enabled || e.touches.length !== 1) return
      const t = e.touches[0]
      gesture.current = { startX: t.clientX, startY: t.clientY, axis: 'undecided', fired: false }
    }

    const onTouchMove = (e: TouchEvent) => {
      const s = gesture.current
      if (!s || e.touches.length !== 1) return
      const { threshold, axisRatio, onNext, onPrevious } = opts.current
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

      // Claimed: stop the page (and any chart crosshair) from also acting on
      // it. Reachable only because the listener is registered non-passive.
      if (e.cancelable) e.preventDefault()

      if (!s.fired && Math.abs(dx) >= threshold) {
        s.fired = true
        if (dx < 0) onNext()
        else onPrevious()
      }
    }

    const onTouchEnd = () => { gesture.current = null }

    const previousTouchAction = el.style.touchAction
    // Vertical scrolling stays on the browser's fast path; horizontal is ours.
    el.style.touchAction = 'pan-y'

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchEnd, { passive: true })

    return () => {
      el.style.touchAction = previousTouchAction
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
    // Re-attach when the node identity changes, not when callbacks do.
  }, [node])

  return { ref: setNode }
}
