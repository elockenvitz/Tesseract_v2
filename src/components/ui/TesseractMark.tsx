import { useEffect, useRef } from 'react'

import {
  EDGES, EDGE_KIND, RESTING, morphSchedule, project, spinSchedule,
} from '../../lib/brand/tesseract-geometry'

/**
 * The animated mark, drawn once and driven by whoever mounts it.
 *
 * ── Why one component for two very different uses ─────────────────────────
 *
 * The loader runs the loop continuously at 4.5s; the app launcher holds the
 * resting frame and turns slowly only while a pointer is over it. Those are
 * different behaviours and the same drawing, so what varies is a period and a
 * boolean, not a second copy of the geometry.
 *
 * ── Why it drives the DOM directly ────────────────────────────────────────
 *
 * Thirty-two lines and sixteen nodes at 60fps through React state would be 60
 * reconciliations a second to animate an icon. The vertices are computed in a
 * rAF callback and written straight onto the elements through refs, so React
 * renders this once and never again while it moves.
 */

interface TesseractMarkProps {
  size: number
  /** Milliseconds for one full loop. Larger is slower. */
  periodMs: number
  /** When false the mark holds its resting frame. */
  animate: boolean
  /** Stroke weight for the twenty-four cube edges; links are drawn lighter. */
  weight?: number
  /** Vertex nodes. Off at small sizes, where they close up the line work. */
  showNodes?: boolean
  /**
   * How much of the frame the figure occupies, relative to the loader's.
   *
   * The geometry is sized for the loader, where air around the mark is what
   * makes it read as precise. An icon has the opposite problem: at 24px, 56% of
   * the box is a 13px glyph, and the margin that reads as restraint at 96px
   * reads as illegible at a quarter of that. Scaling about the centre keeps one
   * geometry and lets each use pick its own presence.
   */
  fill?: number
  className?: string
}

/**
 * One clock for every mark, for the whole session.
 *
 * ── Why the phase cannot belong to the component ──────────────────────────
 *
 * Each mount used to start its own timer, so the loop began at zero wherever a
 * loader appeared. A cold boot passes through three of them — the pre-JS
 * splash, the route gate, then the feed's own — and each handover restarted the
 * inversion from the top. The result reads as three loading screens rather than
 * one wait, which is the exact jank the boot loader was moved outside `#root`
 * to avoid, reappearing one layer up.
 *
 * A module-level epoch fixes it for free: the phase is a function of wall-clock
 * time, so a mark mounting at t=3.2s draws frame 3.2s. Unmount one loader and
 * mount another and the figure carries on turning through the swap, because
 * neither of them owns where it is in the loop.
 *
 * It also means two marks on screen at once are in step rather than beating
 * against each other.
 */
const EPOCH = typeof performance !== 'undefined' ? performance.now() : 0

export function TesseractMark({
  size, periodMs, animate, weight = 2.6, showNodes = true, fill = 1, className,
}: TesseractMarkProps) {
  const lineRefs = useRef<(SVGLineElement | null)[]>([])
  const dotRefs = useRef<(SVGCircleElement | null)[]>([])

  useEffect(() => {
    const draw = (t: number, spin: number) => {
      const p = project(t, spin).map(v => ({
        ...v,
        x: 50 + (v.x - 50) * fill,
        y: 50 + (v.y - 50) * fill,
      }))
      EDGES.forEach(([a, b], i) => {
        const el = lineRefs.current[i]
        if (!el) return
        el.setAttribute('x1', p[a].x.toFixed(2))
        el.setAttribute('y1', p[a].y.toFixed(2))
        el.setAttribute('x2', p[b].x.toFixed(2))
        el.setAttribute('y2', p[b].y.toFixed(2))
        // Depth, with the links held further back still. A wide opacity range
        // is what separates the near frame from the far one; a narrow one
        // flattens the projection into a single tangle.
        const d = (p[a].depth + p[b].depth) / 2
        const base = 0.2 + d * 0.8
        el.setAttribute('opacity', (EDGE_KIND[i] === 'link' ? base * 0.5 : base).toFixed(2))
      })
      if (!showNodes) return
      p.forEach((v, i) => {
        const el = dotRefs.current[i]
        if (!el) return
        el.setAttribute('cx', v.x.toFixed(2))
        el.setAttribute('cy', v.y.toFixed(2))
        // Nodes scale as well as fade, so the near frame reads as nearer rather
        // than merely brighter.
        el.setAttribute('r', (0.7 + v.depth * 1.2).toFixed(2))
        el.setAttribute('opacity', (0.25 + v.depth * 0.75).toFixed(2))
      })
    }

    /**
     * Reduced motion: the mark, held still.
     *
     * A continuously inverting hypercube is close to the worst thing this
     * setting exists to suppress. The resting frame is the recognisable
     * projection, so the brand still lands.
     */
    const reduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    if (!animate || reduced) {
      draw(0, 0)
      return
    }

    let frame = 0
    // Phase from the shared epoch, never from this mount. See `EPOCH`.
    const step = (now: number) => {
      const u = (((now - EPOCH) % periodMs) + periodMs) % periodMs / periodMs
      draw(morphSchedule(u) * Math.PI * 2, spinSchedule(u) * Math.PI * 2)
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [animate, periodMs, showNodes, fill])

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      data-testid="tesseract-mark"
      className={className}
      role="img"
      aria-label="Tesseract"
    >
      {EDGES.map(([a, b], i) => (
        <line
          key={`${a}-${b}`}
          ref={el => { lineRefs.current[i] = el }}
          x1={50 + (RESTING[a].x - 50) * fill}
          y1={50 + (RESTING[a].y - 50) * fill}
          x2={50 + (RESTING[b].x - 50) * fill}
          y2={50 + (RESTING[b].y - 50) * fill}
          stroke="#f59e0b"
          // The eight links lighter than the twenty-four cube edges. Equal
          // weight made them read as filled faces.
          strokeWidth={EDGE_KIND[i] === 'link' ? weight * 0.6 : weight}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {showNodes && RESTING.map((v, i) => (
        <circle
          key={`v${i}`}
          ref={el => { dotRefs.current[i] = el }}
          cx={50 + (v.x - 50) * fill}
          cy={50 + (v.y - 50) * fill}
          r={1.4}
          fill="#fbbf24"
        />
      ))}
    </svg>
  )
}
