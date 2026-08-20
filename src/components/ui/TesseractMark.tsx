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
  className?: string
}

export function TesseractMark({
  size, periodMs, animate, weight = 2.6, showNodes = true, className,
}: TesseractMarkProps) {
  const lineRefs = useRef<(SVGLineElement | null)[]>([])
  const dotRefs = useRef<(SVGCircleElement | null)[]>([])

  useEffect(() => {
    const draw = (t: number, spin: number) => {
      const p = project(t, spin)
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
    let start: number | null = null
    const step = (now: number) => {
      if (start == null) start = now
      const u = ((now - start) % periodMs) / periodMs
      draw(morphSchedule(u) * Math.PI * 2, spinSchedule(u) * Math.PI * 2)
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [animate, periodMs, showNodes])

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
          x1={RESTING[a].x}
          y1={RESTING[a].y}
          x2={RESTING[b].x}
          y2={RESTING[b].y}
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
          cx={v.x}
          cy={v.y}
          r={1.4}
          fill="#fbbf24"
        />
      ))}
    </svg>
  )
}
