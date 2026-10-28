/**
 * An element's own width in CSS pixels.
 *
 * ── Why a chart needs this at all ─────────────────────────────────────────
 *
 * The alternative is what every plot on this product used to do: draw into a
 * fixed `viewBox` and set `preserveAspectRatio="none"`, letting the browser
 * stretch those units to whatever width the column happens to be. Measured on
 * Today's lead tile that was 2.26x horizontally against 1x vertically, and on
 * the Research detail 1.61x.
 *
 * Under that stretch nothing round stays round: end-of-series dots render as
 * flat ellipses, a 3px dash becomes 6.8px while the vertical dashes beside it
 * stay 3px, and stroke widths survive only because every single one carries
 * `vectorEffect="non-scaling-stroke"` -- a patch over the same wound. It is
 * the difference between a chart and a picture of a chart.
 *
 * Measure the box and draw 1:1 instead. Then a circle of r=3.5 is 7px across,
 * a 3px dash is 3px long, and a gridline placed on a half pixel lands on a
 * device pixel rather than straddling two and rendering as a grey smudge.
 *
 * `useLayoutEffect`, not `useEffect`: layout is complete by then and the
 * measurement is applied before paint, so the plot is never drawn once at the
 * fallback width and then again at the real one.
 */

import { useLayoutEffect, useRef, useState } from 'react'

export function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T | null>(null)
  const [w, setW] = useState(0)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const apply = (next: number) => setW(prev => (Math.abs(prev - next) < 0.5 ? prev : next))
    apply(el.getBoundingClientRect().width)
    // jsdom has no ResizeObserver, and a chart that throws in a unit test is
    // a chart nobody can test. Measured once there, which is all a test has.
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(entries => {
      for (const e of entries) apply(e.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return [ref, w > 0 ? w : fallback] as const
}
