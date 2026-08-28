import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import {
  GESTURE, advanceGesture, beginGesture, holdStillPossible, type GestureState,
} from '../../lib/mobile/gesture-intent'

/**
 * One touch contract for every Recharts chart in the product.
 *
 * ── The bug this exists to delete ─────────────────────────────────────────
 *
 * Recharts wires touch by forwarding it to its own mouse handlers:
 * `handleTouchStart → handleMouseDown`, `handleTouchMove → handleMouseMove`,
 * `handleTouchEnd → handleMouseUp`. The first two work. The third does not,
 * because the thing that clears a tooltip is `handleMouseLeave`, not
 * `handleMouseUp` — and `mouseleave` never fires for a finger.
 *
 * So on every touch device, on every Recharts chart we ship, lifting the
 * finger left the tooltip, the cursor line and the `activeDot` frozen on
 * whatever point was last touched. The chart then read as showing the current
 * price when it was showing a day in April. That is the same defect
 * `PriceContext` documents at length and fixed for itself, reproduced six
 * times over on the surfaces that use Recharts instead: the Ideas feed, the
 * reels panel, the chart modal, the mobile asset chart, the desktop asset
 * expansion panel, and the messaging embed.
 *
 * Each of those either did nothing about it or invented a partial fix of its
 * own. `ReelsChartPanel` cleared its OWN read-out on `touchend` while leaving
 * Recharts' crosshair stuck, so the line said one day and the price said
 * another. Six screens, six behaviours, one library bug.
 *
 * ── Why an adapter rather than a patch per chart ──────────────────────────
 *
 * The charts differ in chrome, axes, series and layout, and consolidating
 * those would be a redesign. What they must NOT differ in is what a finger
 * does. That is exactly one concern, it is not visible in any of their
 * markup, and it is the one thing all six got wrong — so it is the thing that
 * moves into a shared layer.
 *
 * ── How it works ──────────────────────────────────────────────────────────
 *
 * Touch never reaches Recharts. The surface arbitrates the gesture with the
 * same `gesture-intent` module `PriceContext` uses, and once — and only once —
 * a deliberate press-and-hold engages, it drives Recharts with SYNTHETIC MOUSE
 * EVENTS at the finger's position. Recharts' own touch path is bypassed
 * entirely, which is what makes the release reliable: we send the `mouseout`
 * React turns into `onMouseLeave`, and Recharts resets.
 *
 * Mouse is left alone. A pointer that hovers has no scroll to compete with and
 * no ambiguity to resolve, so Recharts' hover tooltip is already the right
 * behaviour and stays exactly as it was.
 *
 * ── Why stopPropagation is conditional ────────────────────────────────────
 *
 * React 18 delegates events at the root, so stopping a touch event here stops
 * it for Recharts AND for every ancestor — including the carousel's `useSwipe`
 * and anything else listening above. That is right while the gesture is
 * undecided (nobody should act on an ambiguous drag) and while the chart owns
 * it (nobody else should). It is wrong the moment the gesture is classified as
 * a page or a scroll, so at that point the surface stops interfering
 * completely and hands the rest of the touch over untouched.
 *
 * Native scrolling is unaffected by propagation — only by `preventDefault`,
 * which is called solely while the chart owns the gesture.
 */

export interface ChartScrubSurfaceProps {
  children: ReactNode
  className?: string
  style?: CSSProperties
  /**
   * Any active inspection is dropped when this changes.
   *
   * Pass the timeframe, the symbol, anything that reframes the plot. A
   * read-out is a claim about a point in a particular window, and a window
   * change makes it a claim about a point that is no longer on the chart —
   * which is how a dot ends up on the wrong day.
   */
  resetKey?: string | number
  /**
   * Called whenever inspection ends, for callers holding a read-out of their
   * own. Idempotent by contract: it fires on every gesture end, engaged or
   * not, because a touch that turned into a scroll must leave nothing behind
   * either.
   */
  onRelease?: () => void
  /** Called with the client position each time the engaged crosshair moves. */
  onScrub?: (at: { clientX: number; clientY: number }) => void
  testId?: string
}

/** Recharts' own outer element, and the node its React handlers sit on. */
const RECHARTS_ROOT = '.recharts-wrapper'

export function ChartScrubSurface({
  children, className, style, resetKey, onRelease, onScrub, testId,
}: ChartScrubSurfaceProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<GestureState | null>(null)
  const holdTimer = useRef<number | null>(null)
  const startedAt = useRef(0)
  const engaged = useRef(false)
  const [scrubbing, setScrubbing] = useState(false)

  // Held in refs so the listener effect binds once per node rather than on
  // every parent render — re-attaching a non-passive touchmove listener mid
  // gesture drops the gesture.
  const cb = useRef({ onRelease, onScrub })
  cb.current = { onRelease, onScrub }

  const surface = useCallback(
    () => hostRef.current?.querySelector<HTMLElement>(RECHARTS_ROOT) ?? null,
    [],
  )

  const sendMouseMove = useCallback((clientX: number, clientY: number) => {
    const el = surface()
    if (!el) return
    const ev = new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX, clientY })
    /**
     * Recharts reads `pageX`/`pageY`, not `clientX`/`clientY`.
     *
     * `MouseEventInit` has no page coordinates, and while browsers derive them
     * from the client ones, jsdom leaves both at zero — which would put every
     * synthetic crosshair at the left edge of the plot in a test and make this
     * look like it worked. Stated explicitly so the value is the same
     * everywhere.
     */
    Object.defineProperty(ev, 'pageX', { value: clientX + window.scrollX })
    Object.defineProperty(ev, 'pageY', { value: clientY + window.scrollY })
    el.dispatchEvent(ev)
  }, [surface])

  /**
   * Put the chart back to rest.
   *
   * `mouseout`, not `mouseleave`. React does not listen for `mouseleave` — it
   * synthesises it from a bubbling `mouseout` by comparing the target with
   * `relatedTarget`, and a null `relatedTarget` means "left for nowhere", which
   * produces a leave for the target and every ancestor. Dispatching
   * `mouseleave` directly would be ignored, which is the trap that makes this
   * fix look like it does not work.
   */
  const release = useCallback((notify = true) => {
    if (holdTimer.current != null) {
      window.clearTimeout(holdTimer.current)
      holdTimer.current = null
    }
    gesture.current = null
    if (engaged.current) {
      engaged.current = false
      surface()?.dispatchEvent(new MouseEvent('mouseout', {
        bubbles: true, cancelable: true, relatedTarget: null,
      }))
    }
    setScrubbing(false)
    if (notify) cb.current.onRelease?.()
  }, [surface])

  const engage = useCallback((clientX: number, clientY: number) => {
    engaged.current = true
    setScrubbing(true)
    /**
     * A tick when inspection engages. The hold is invisible until the
     * crosshair appears, so without a cue a press that armed is
     * indistinguishable from one that did not. Android only, honestly — iOS
     * Safari implements no Vibration API — and optional-called so a missing
     * one is a no-op rather than a crash.
     */
    navigator.vibrate?.(10)
    sendMouseMove(clientX, clientY)
    cb.current.onScrub?.({ clientX, clientY })
  }, [sendMouseMove])

  useEffect(() => {
    const el = hostRef.current
    if (!el) return

    const onTouchStart = (e: TouchEvent) => {
      // A second finger is a pinch or a stray palm, never an inspection.
      if (e.touches.length !== 1) { release(); return }
      const t = e.touches[0]
      const x = t.clientX
      const y = t.clientY
      gesture.current = beginGesture({ x, y }, 'chart')
      startedAt.current = Date.now()
      holdTimer.current = window.setTimeout(() => {
        holdTimer.current = null
        const g = gesture.current
        // Still there, and still still.
        if (!g || g.owner !== 'undecided') return
        gesture.current = { ...g, owner: 'chart' }
        engage(x, y)
      }, GESTURE.CHART_HOLD_MS)
    }

    const onTouchMove = (e: TouchEvent) => {
      const g = gesture.current
      if (!g) return
      const t = e.touches[0]
      if (!t) return
      const at = { x: t.clientX, y: t.clientY }
      const next = advanceGesture(g, at, Date.now() - startedAt.current)
      gesture.current = next

      // Abandon the hold the moment it can no longer fire, rather than letting
      // it expire into a gesture that has already gone somewhere else.
      if (next.owner !== 'chart' && holdTimer.current != null && !holdStillPossible(g, at)) {
        window.clearTimeout(holdTimer.current)
        holdTimer.current = null
      }

      if (next.owner === 'chart') {
        // The only place the browser's pan is taken away, and only after a
        // deliberate press has already been made.
        if (e.cancelable) e.preventDefault()
        e.stopPropagation()
        if (!engaged.current) engage(at.x, at.y)
        else {
          sendMouseMove(at.x, at.y)
          cb.current.onScrub?.({ clientX: at.x, clientY: at.y })
        }
        return
      }

      if (next.owner === 'undecided') {
        // Nobody has earned it yet. Keep Recharts out of it — an ambiguous
        // drag must not scrub — but leave native scrolling alone.
        e.stopPropagation()
        return
      }

      // Classified as a page or a scroll. Let go of everything, including the
      // preventDefault that would otherwise keep the surface stuck.
      release()
    }

    const onTouchEnd = () => { release() }

    /**
     * A scroll that started elsewhere still ends the inspection.
     *
     * The chart can be engaged and then carried off-screen by a scroll the
     * surface never saw — a momentum fling begun above it, a programmatic
     * scroll, a keyboard. Capture-phase and passive, so this observes every
     * scroller on the way up without claiming any of them.
     */
    const onAnyScroll = () => { if (engaged.current) release() }
    const onBlur = () => { if (engaged.current) release() }
    const onVisibility = () => { if (document.hidden && engaged.current) release() }
    /**
     * A rotation reflows the plot under a finger that has not moved, so the
     * point the crosshair marks is no longer the point it is over.
     */
    const onOrientation = () => { if (engaged.current) release() }

    const captured = { capture: true } as EventListenerOptions

    el.addEventListener('touchstart', onTouchStart, { capture: true, passive: true })
    el.addEventListener('touchmove', onTouchMove, { capture: true, passive: false })
    el.addEventListener('touchend', onTouchEnd, { capture: true, passive: true })
    el.addEventListener('touchcancel', onTouchEnd, { capture: true, passive: true })
    window.addEventListener('scroll', onAnyScroll, { capture: true, passive: true })
    window.addEventListener('blur', onBlur)
    window.addEventListener('orientationchange', onOrientation)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      el.removeEventListener('touchstart', onTouchStart, captured)
      el.removeEventListener('touchmove', onTouchMove, captured)
      el.removeEventListener('touchend', onTouchEnd, captured)
      el.removeEventListener('touchcancel', onTouchEnd, captured)
      window.removeEventListener('scroll', onAnyScroll, captured)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('orientationchange', onOrientation)
      document.removeEventListener('visibilitychange', onVisibility)
      // Never leave a timer to fire into an unmounted tree.
      if (holdTimer.current != null) window.clearTimeout(holdTimer.current)
      holdTimer.current = null
      gesture.current = null
      engaged.current = false
    }
  }, [engage, release, sendMouseMove])

  /**
   * A new window is a new chart. Whatever was being inspected is not on it.
   *
   * Deliberately skipped on first render: there is nothing to reset, and
   * firing `onRelease` before any interaction makes the callback fire in an
   * order callers cannot reason about.
   */
  const seen = useRef(resetKey)
  useEffect(() => {
    if (seen.current === resetKey) return
    seen.current = resetKey
    release()
  }, [resetKey, release])

  return (
    <div
      ref={hostRef}
      className={className}
      /**
       * Both axes stay with the browser until a hold engages, so a swipe pages
       * the carousel and a drag scrolls the feed without any code running.
       * `PriceContext` makes the same declaration for the same reason.
       */
      style={{ touchAction: 'pan-x pan-y', ...style }}
      data-testid={testId}
      data-chart-surface=""
      data-scrubbing={scrubbing ? 'true' : 'false'}
    >
      {children}
    </div>
  )
}
