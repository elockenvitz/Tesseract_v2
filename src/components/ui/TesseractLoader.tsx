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
 * ── Why the rotation is XW, and why the camera is tilted ─────────────────
 *
 * The XW rotation is the whole illusion. It swings each vertex through the W
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
 * `Z_EYE` is deliberately much further away. The 3D perspective only has to
 * keep the oblique view legible; a second strong perspective would fight the
 * first and the projection would read as noise.
 */
const W_EYE = 2.5
const Z_EYE = 5.0

/**
 * Sized and centred by measurement, not by eye.
 *
 * Sampling the projection at 200 angles gives a widest extent of 4.9..88.0 at
 * this scale — 83% of the viewBox, so the dimensional change is legible at the
 * 80-120px this is drawn at, with margin left at every angle of the loop.
 *
 * The centre is offset because the projection is not symmetric about the
 * origin: the oblique camera and the W perspective together push the figure up
 * and left. 53.5 puts equal margin on both sides; leaving it at 50 drew the
 * mark noticeably off-centre in its box.
 */
const SCALE = 34
const CENTER = 53.5

/**
 * The fixed oblique camera, in radians. See the header: face-on, the swap is
 * invisible. Modest enough that the mark still reads as a cube within a cube.
 */
const TILT_X = 22 * Math.PI / 180
const TILT_Y = 28 * Math.PI / 180

/**
 * One full turn, 12s — which is 3s per PERCEIVED inversion.
 *
 * A hypercube maps onto itself every quarter turn, so the projected picture
 * repeats four times per revolution and what the viewer experiences as one
 * loop is 90 degrees of rotation. The animation still runs the full 2*pi
 * because the depth shading follows W, which only returns at the full turn —
 * ending at a quarter turn would put a visible flicker at the seam.
 */
const PERIOD_MS = 12000

interface Projected { x: number; y: number; depth: number }

/**
 * Project the hypercube at rotation angle `t` (radians).
 *
 * Exported so a test can assert the properties that make it a tesseract rather
 * than a spinning square — that the inner and outer frames genuinely exchange
 * size, and that the loop returns to its starting geometry.
 */
export function projectTesseract(t: number): Projected[] {
  const c = Math.cos(t)
  const s = Math.sin(t)
  const cx = Math.cos(TILT_X)
  const sx = Math.sin(TILT_X)
  const cy = Math.cos(TILT_Y)
  const sy = Math.sin(TILT_Y)

  return VERTICES.map(([x0, y0, z0, w0]) => {
    // The four-dimensional rotation, and the entire illusion.
    const xr = x0 * c - w0 * s
    const w = x0 * s + w0 * c

    // Fixed camera tilt. Static — see the header.
    const y1 = y0 * cx - z0 * sx
    const z1 = y0 * sx + z0 * cx
    const x2 = xr * cy + z1 * sy
    const z2 = -xr * sy + z1 * cy

    // 4D -> 3D. Dividing by distance in W is what makes one cube large and the
    // other small, and what makes them trade places as W changes sign.
    const kw = 1 / (W_EYE - w)
    const x3 = x2 * kw
    const y3 = y1 * kw
    const z3 = z2 * kw

    // 3D -> 2D.
    const kz = 1 / (Z_EYE - z3)
    return {
      x: CENTER + x3 * kz * SCALE * Z_EYE,
      y: CENTER + y3 * kz * SCALE * Z_EYE,
      // How near the viewer, 0..1, for a restrained depth cue.
      depth: (w + 1.5) / 3,
    }
  })
}

export function TesseractLoader({
  size = 80,
  className = '',
  showText = true,
  text = 'Loading...',
  compact = false,
}: TesseractLoaderProps) {
  const lineRefs = useRef<(SVGLineElement | null)[]>([])

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

    const draw = (t: number) => {
      const p = projectTesseract(t)
      EDGES.forEach(([a, b], i) => {
        const el = lineRefs.current[i]
        if (!el) return
        el.setAttribute('x1', p[a].x.toFixed(2))
        el.setAttribute('y1', p[a].y.toFixed(2))
        el.setAttribute('x2', p[b].x.toFixed(2))
        el.setAttribute('y2', p[b].y.toFixed(2))
        // Nearer edges very slightly stronger. Restrained on purpose: this is a
        // line mark, not a rendered solid.
        const d = (p[a].depth + p[b].depth) / 2
        el.setAttribute('opacity', (0.4 + d * 0.6).toFixed(2))
      })
    }

    if (reduced) {
      draw(0)
      return
    }

    let frame = 0
    let start: number | null = null
    const step = (now: number) => {
      if (start == null) start = now
      // Constant angular velocity. No easing at the boundary — an ease would
      // put a visible hesitation at the loop seam, which is exactly what makes
      // a loop look like a loop.
      draw(((now - start) % PERIOD_MS) / PERIOD_MS * Math.PI * 2)
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
        {EDGES.map(([a, b], i) => (
          <line
            key={`${a}-${b}`}
            ref={el => { lineRefs.current[i] = el }}
            // The starting projection, so the first painted frame is the
            // recognisable mark rather than an empty box waiting for rAF.
            x1={projectTesseract(0)[a].x}
            y1={projectTesseract(0)[a].y}
            x2={projectTesseract(0)[b].x}
            y2={projectTesseract(0)[b].y}
            stroke="#f59e0b"
            strokeWidth={1.3}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
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
