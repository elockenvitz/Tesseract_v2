import { EDGES, EDGE_KIND, project } from './tesseract-geometry'
import { morphSchedule, spinSchedule } from './tesseract-geometry'

/**
 * Driving the mark: one loop, one clock, two very different hosts.
 *
 * ── Why this is not inside `TesseractMark` ────────────────────────────────
 *
 * The pre-JS boot element in `index.html` is not a React component and never
 * becomes one. It is painted by the browser before the bundle has parsed, it
 * lives outside `#root` so React's mount cannot tear it down, and it stays on
 * screen across the whole cold boot — the auth check, the organisation
 * resolve, the pilot gate.
 *
 * Which meant that for the entire time anybody actually watches a loading
 * screen, the figure they were watching was the static frame. The animated
 * component existed and was mounted underneath, covered by a z-index of
 * 2147483647. Reported, correctly, as "the icon is not animating".
 *
 * The fix is not to hand over sooner. It is to animate the element that is
 * already there: same geometry, same schedules, same clock, driven the moment
 * the bundle runs. There is then no handover to be seamless about, because
 * nothing is ever swapped.
 *
 * ── One clock for every mark, for the whole session ───────────────────────
 *
 * Each React mount used to start its own timer, so the loop began at zero
 * wherever a loader appeared, and a cold boot passes through several. A
 * module-level epoch makes the phase a function of wall-clock time instead: a
 * mark mounting at t=3.2s draws frame 3.2s. Unmount one loader and mount
 * another and the figure carries on turning, because neither owns where it is
 * in the loop — and the boot element, driven by the same epoch, is in step
 * with both.
 */
export const EPOCH = typeof performance !== 'undefined' ? performance.now() : 0

/** Phase through the loop, 0–1, for a given timestamp. */
export function phaseAt(now: number, periodMs: number): number {
  return ((((now - EPOCH) % periodMs) + periodMs) % periodMs) / periodMs
}

export interface MarkNodes {
  /** One per entry in `EDGES`, in order. */
  lines: (SVGLineElement | null)[]
  /** One per vertex, in order. Empty where the host draws no nodes. */
  dots: (SVGCircleElement | null)[]
}

/**
 * Write one frame onto the elements.
 *
 * Attributes rather than React state: thirty-two lines and sixteen nodes at
 * 60fps through a render would be sixty reconciliations a second to animate an
 * icon, and the boot element has no React to reconcile with at all.
 */
export function drawFrame(
  nodes: MarkNodes, t: number, spin: number, fill = 1,
): void {
  const p = project(t, spin).map(v => ({
    ...v,
    x: 50 + (v.x - 50) * fill,
    y: 50 + (v.y - 50) * fill,
  }))

  EDGES.forEach(([a, b], i) => {
    const el = nodes.lines[i]
    if (!el) return
    el.setAttribute('x1', p[a].x.toFixed(2))
    el.setAttribute('y1', p[a].y.toFixed(2))
    el.setAttribute('x2', p[b].x.toFixed(2))
    el.setAttribute('y2', p[b].y.toFixed(2))
    // Depth, with the links held further back still. A wide opacity range is
    // what separates the near frame from the far one; a narrow one flattens the
    // projection into a single tangle.
    const d = (p[a].depth + p[b].depth) / 2
    const base = 0.2 + d * 0.8
    el.setAttribute('opacity', (EDGE_KIND[i] === 'link' ? base * 0.5 : base).toFixed(2))
  })

  p.forEach((v, i) => {
    const el = nodes.dots[i]
    if (!el) return
    // Nodes scale as well as fade, so the near frame reads as nearer rather
    // than merely brighter.
    el.setAttribute('cx', v.x.toFixed(2))
    el.setAttribute('cy', v.y.toFixed(2))
    el.setAttribute('r', (0.7 + v.depth * 1.2).toFixed(2))
    el.setAttribute('opacity', (0.25 + v.depth * 0.75).toFixed(2))
  })
}

/**
 * Reduced motion, read once per loop start.
 *
 * A continuously inverting hypercube is close to the worst thing this setting
 * exists to suppress. The resting frame is the recognisable projection, so the
 * brand still lands when it is held still.
 */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/**
 * Run the loop until the returned function is called.
 *
 * Returns a stopper even when nothing was started, so callers never have to
 * branch on whether motion was allowed.
 */
export function runLoop(
  nodes: MarkNodes, periodMs: number, fill = 1,
): () => void {
  if (prefersReducedMotion()) {
    drawFrame(nodes, 0, 0, fill)
    return () => {}
  }
  let frame = 0
  const step = (now: number) => {
    const u = phaseAt(now, periodMs)
    drawFrame(nodes, morphSchedule(u) * Math.PI * 2, spinSchedule(u) * Math.PI * 2, fill)
    frame = requestAnimationFrame(step)
  }
  frame = requestAnimationFrame(step)
  return () => cancelAnimationFrame(frame)
}
