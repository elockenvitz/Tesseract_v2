import { useEffect, useRef } from 'react'

/**
 * A tesseract actually rotating through 4-space, projected down to the screen.
 *
 * ── Why this is real geometry and not a CSS transform ─────────────────────
 *
 * The effect being reproduced is the one thing a CSS transform cannot do. A
 * `rotate3d` moves a rigid body: every vertex keeps its distance from every
 * other, so the shape can spin but the inner frame can never pass through the
 * outer one. What makes a hypercube read as four-dimensional is precisely that
 * the projected vertices move RELATIVE to each other — the inner frame swells
 * outward while the outer contracts, they trade places, and the connecting
 * edges stretch and skew because their endpoints are going different ways.
 *
 * You get that for free from the actual projection and essentially no other
 * way, so this computes it: sixteen vertices at (±1,±1,±1,±1), thirty-two
 * edges between vertices differing in exactly one coordinate, a continuous
 * rotation, a fixed oblique camera, then 4D→3D and 3D→2D perspective.
 *
 * ── Why the rotation is ZW, and why the camera is tilted ─────────────────
 *
 * ── Why ZW and not XW ────────────────────────────────────────────────────
 *
 * Both invert the cube; they separate it differently while doing so, and that
 * difference is the whole readability of the thing.
 *
 * XW slides the two cubes apart ALONG THE SCREEN. Partway through the
 * inversion they sit side by side, joined by the eight connecting edges, and
 * that band of connectors reads as a solid face — an extra plane that is not
 * there. Reported from a phone as exactly that.
 *
 * ZW separates them in DEPTH instead. One cube moves toward the viewer while
 * the other recedes, so under perspective they stay concentric and genuinely
 * pass through one another. Same inversion, no phantom plane.
 *
 * The rotation is the whole illusion. It swings each vertex through the W
 * axis, and since the 4D->3D projection divides by distance in W, a vertex
 * moving toward +W swells and one moving toward -W shrinks. Measured on the
 * projection: the outer frame spans 54 units and the inner 23; a quarter turn
 * later the outer has contracted to 23 and the inner has grown to 60. They
 * cross at the halfway point, which is the moment the structures pass through
 * one another. That is "inside becomes outside" as arithmetic rather than as
 * something tweened.
 *
 * The fixed camera tilt is what makes it VISIBLE, and getting there took three
 * attempts. Face-on, every projection of a hypercube is symmetric, so the swap
 * happens and looks like nothing: the picture at the end of the inversion is
 * the same picture you started with. Adding an animated 3D rotation only made
 * it read as spinning, and an orthogonal double rotation (XY+ZW) read as
 * pulsing — both of which are the wrong answers. Viewing the tesseract from an
 * oblique angle breaks the symmetry, so the cubes are distinguishable and the
 * passage between them is motion you can follow. The tilt is static: a camera
 * angle, not an animation.
 *
 * ── Why it drives the DOM directly ────────────────────────────────────────
 *
 * Thirty-two lines at 60fps through React state would be 60 reconciliations a
 * second to animate a loading indicator. The vertices are computed in a rAF
 * callback and written straight onto the `<line>` elements through refs, so
 * React renders this component once.
 */

interface TesseractLoaderProps {
  size?: number
  className?: string
  showText?: boolean
  text?: string
  /**
   * Smaller type for in-surface use. The default is the app-boot treatment,
   * where the loader IS the screen and a large heading is right.
   */
  compact?: boolean
}

/** The sixteen vertices of a 4-cube, one per sign combination. */
const VERTICES: [number, number, number, number][] = Array.from(
  { length: 16 },
  (_, i) => [
    i & 1 ? 1 : -1,
    i & 2 ? 1 : -1,
    i & 4 ? 1 : -1,
    i & 8 ? 1 : -1,
  ],
)

/**
 * The thirty-two edges: every pair of vertices differing in exactly one
 * coordinate. As bit patterns that is a one-bit difference, which `d & (d-1)`
 * tests in one step.
 */
const EDGES: [number, number][] = (() => {
  const out: [number, number][] = []
  for (let i = 0; i < 16; i++) {
    for (let j = i + 1; j < 16; j++) {
      const d = i ^ j
      if ((d & (d - 1)) === 0) out.push([i, j])
    }
  }
  return out
})()

/**
 * Viewer distances for the two projections.
 *
 * `W_EYE` is the one that matters. A vertex reaches at most √2 ≈ 1.415 in W
 * once the XW rotation is running, so the divisor ranges over roughly 1.0 to
 * 3.8 — a scale ratio near 3.8:1 between the near and far cubes. That ratio is
 * the visible difference between "inner frame" and "outer frame"; push `W_EYE`
 * up and the two converge into one flat cube, pull it down and the near cube
 * explodes off the canvas as its divisor approaches zero.
 *
 * There is no Z_EYE. The 3D step is orthographic on purpose — see the
 * projection — because a perspective divide there would pull the near corners
 * of the hexagon out and the far ones in, and the regularity of that hexagon is
 * the mark.
 */
const W_EYE = 2.5

/**
 * The ISOMETRIC camera — looking straight down the cube's body diagonal.
 *
 * Not an arbitrary pleasing angle, which is what 22/28 degrees was and why the
 * mark read as off-kilter: at an arbitrary tilt the twelve edges project to
 * twelve different lengths and no two faces agree, so the figure looks skewed
 * rather than drawn.
 *
 * Down the (1,1,1) diagonal a cube projects to a REGULAR HEXAGON with a Y at
 * its centre — every edge the same length, every angle 120 degrees. That is the
 * Tesseract mark, and it is the shape the loop returns to at rest. 45 degrees
 * about Y then atan(1/sqrt(2)) about X is the standard construction.
 */
const TILT_Y = Math.PI / 4
const TILT_X = Math.atan(1 / Math.SQRT2)

/**
 * The loop has three beats: invert, turn, invert.
 *
 * Constant angular motion is right for a physics demonstration and dull as a
 * loading state. Phrasing makes the inversion feel deliberate: the cube turns
 * through itself, settles, swings round on a spatial axis, and turns through
 * again.
 *
 * `morphSchedule` advances the 4D rotation over the opening and closing
 * stretches and holds through the middle; `spinSchedule` does the opposite.
 * Each is a smoothstep, so velocity is zero wherever a phase begins or ends —
 * which makes the handover read as a beat rather than a stutter, and keeps the
 * loop seam invisible: both arrive at the wrap with zero velocity and a whole
 * number of turns.
 */
const PERIOD_MS = 4500

/** Hermite smoothstep, clamped. Zero velocity at both ends. */
function smoothstep(a: number, b: number, u: number): number {
  const t = Math.min(1, Math.max(0, (u - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * How far through its full turn the 4D rotation is, 0..1 across the loop.
 *
 * Half the turn in the opening stretch and half in the closing one — and half a
 * turn IS one complete inversion, so the cube passes through itself once before
 * the spin and once after.
 */
export const morphSchedule = (u: number): number =>
  0.5 * smoothstep(0, 0.40, u) + 0.5 * smoothstep(0.60, 1, u)

/** The spatial turn, which happens entirely between the two inversions. */
export const spinSchedule = (u: number): number => smoothstep(0.42, 0.58, u)

/**
 * Sized and centred by measurement.
 *
 * Down the body diagonal the projection is symmetric about the origin — the
 * measured extent is -1.199..1.199 across the whole loop — so the centre is
 * exactly 50 and needs no fudge. That symmetry is itself the check that the
 * camera is truly isometric; the previous arbitrary tilt measured
 * 17.6..92.7 about a centre of 55, which is what "off kilter" looked like as
 * numbers.
 *
 * 23.4 puts the figure in the middle ~56% of the frame. Air around a precise
 * line drawing is most of what makes it look precise.
 */
const SCALE = 23.4
const CENTER = 50

/**
 * Which structure an edge belongs to.
 *
 * The eight CONNECTORS are the edges joining the two cubes, and they are the
 * clutter: drawn at the same weight as everything else they read as filled
 * faces rather than as links. Holding them back is most of what makes the
 * projection legible as two frames rather than one tangle.
 */
const EDGE_KIND: ('cube' | 'link')[] = EDGES.map(([a, b]) =>
  (a & 8) === (b & 8) ? 'cube' : 'link')

interface Projected { x: number; y: number; depth: number }



/**
 * Project the hypercube at rotation angle `t` (radians).
 *
 * Exported so a test can assert the properties that make it a tesseract rather
 * than a spinning square — that the inner and outer frames genuinely exchange
 * size, and that the loop returns to its starting geometry.
 */
export function projectTesseract(t: number, spin = 0): Projected[] {
  const c = Math.cos(t)
  const s = Math.sin(t)
  const cs = Math.cos(spin)
  const ss = Math.sin(spin)
  const cx = Math.cos(TILT_X)
  const sx = Math.sin(TILT_X)
  const cy = Math.cos(TILT_Y)
  const sy = Math.sin(TILT_Y)

  return VERTICES.map(([x0, y0, z0, w0]) => {
    // The four-dimensional rotation, in the ZW plane so the two cubes separate
    // in depth rather than across the screen. See the header.
    const zr = z0 * c - w0 * s
    const w = z0 * s + w0 * c

    // The spatial turn, in XZ so it reads as the object rotating in space
    // rather than the picture spinning on the screen.
    const xs2 = x0 * cs - zr * ss
    const zs2 = x0 * ss + zr * cs

    // Fixed camera tilt. Static — see the header.
    const y1 = y0 * cx - zs2 * sx
    const z1 = y0 * sx + zs2 * cx
    const x2 = xs2 * cy + z1 * sy
    const z2 = -xs2 * sy + z1 * cy

    // 4D -> 3D. Dividing by distance in W is what makes one cube large and the
    // other small, and what makes them trade places as W changes sign.
    const kw = 1 / (W_EYE - w)
    const x3 = x2 * kw
    const y3 = y1 * kw
    const z3 = z2 * kw

    // 3D -> 2D, ORTHOGRAPHIC.
    //
    // A perspective divide here would pull the near corners of the hexagon
    // outward and the far ones in, and the regularity is the whole point of the
    // isometric view. Depth still reads, from the W perspective above and from
    // the opacity ramp — it does not need a second, competing one.
    void z3
    return {
      x: CENTER + x3 * SCALE,
      y: CENTER + y3 * SCALE,
      // How near the viewer, 0..1, for a restrained depth cue.
      depth: (w + 1.5) / 3,
    }
  })
}

/**
 * The frame at rest, computed once.
 *
 * Used for the initial render so the first paint is the recognisable mark
 * rather than an empty box waiting on the first animation frame, and reused as
 * the whole picture under reduced motion.
 */
const START = projectTesseract(0)

export function TesseractLoader({
  size = 80,
  className = '',
  showText = true,
  text = 'Loading...',
  compact = false,
}: TesseractLoaderProps) {
  const lineRefs = useRef<(SVGLineElement | null)[]>([])
  const dotRefs = useRef<(SVGCircleElement | null)[]>([])

  useEffect(() => {
    /**
     * Reduced motion: the mark, held still.
     *
     * A continuously inverting hypercube is close to the worst thing this
     * setting exists to suppress, and it appears at the one moment a reader
     * cannot look away because nothing else has rendered. The static frame is
     * the recognisable projection, so the brand still lands.
     */
    const reduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    const draw = (t: number, spin: number) => {
      const p = projectTesseract(t, spin)
      EDGES.forEach(([a, b], i) => {
        const el = lineRefs.current[i]
        if (!el) return
        el.setAttribute('x1', p[a].x.toFixed(2))
        el.setAttribute('y1', p[a].y.toFixed(2))
        el.setAttribute('x2', p[b].x.toFixed(2))
        el.setAttribute('y2', p[b].y.toFixed(2))
        // Depth, and the link edges held further back still. A wide opacity
        // range is what separates the near frame from the far one; a narrow one
        // flattens the projection into a single tangle of lines.
        const d = (p[a].depth + p[b].depth) / 2
        const base = 0.2 + d * 0.8
        el.setAttribute('opacity', (EDGE_KIND[i] === 'link' ? base * 0.5 : base).toFixed(2))
      })
      p.forEach((v, i) => {
        const el = dotRefs.current[i]
        if (!el) return
        el.setAttribute('cx', v.x.toFixed(2))
        el.setAttribute('cy', v.y.toFixed(2))
        // Nodes scale with depth as well as fade, so the near frame reads as
        // nearer rather than merely brighter.
        el.setAttribute('r', (0.7 + v.depth * 1.2).toFixed(2))
        el.setAttribute('opacity', (0.25 + v.depth * 0.75).toFixed(2))
      })
    }

    if (reduced) {
      draw(0, 0)
      return
    }

    let frame = 0
    let start: number | null = null
    const step = (now: number) => {
      if (start == null) start = now
      // Phrased, not constant — see PERIOD_MS.
      const u = ((now - start) % PERIOD_MS) / PERIOD_MS
      draw(morphSchedule(u) * Math.PI * 2, spinSchedule(u) * Math.PI * 2)
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <div className={`flex flex-col items-center justify-center ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        data-testid="tesseract-loader"
        role="img"
        aria-label="Loading"
      >
        {/* Edges first, vertices over them, so the nodes read as joints rather
            than as beads threaded on a line. */}
        {EDGES.map(([a, b], i) => (
          <line
            key={`${a}-${b}`}
            ref={el => { lineRefs.current[i] = el }}
            x1={START[a].x}
            y1={START[a].y}
            x2={START[b].x}
            y2={START[b].y}
            stroke="#f59e0b"
            // The eight links are drawn lighter than the twenty-four cube
            // edges. Equal weight made them read as filled faces.
            // Heavy, like the mark. The logo is a bold line drawing and a
            // hairline version of it reads as a wireframe diagram instead.
            strokeWidth={EDGE_KIND[i] === 'link' ? 1.6 : 2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {START.map((v, i) => (
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

      {showText && (
        <p className={compact
          ? 'mt-4 text-[13px] font-medium text-gray-500 dark:text-gray-400'
          : 'mt-6 text-2xl font-bold text-gray-900 dark:text-white'}>
          {text}
        </p>
      )}
    </div>
  )
}
