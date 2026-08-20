/**
 * The Tesseract mark, as geometry rather than as a drawing.
 *
 * Shared by the loader and the app-launcher icon so there is exactly one
 * definition of what the mark IS. They differ only in timing and weight: the
 * loader runs the loop continuously, the launcher holds the resting frame and
 * turns slowly while a pointer is over it.
 *
 * Pure — no React, no DOM, no clock. `t` and `spin` come from the caller, which
 * is what lets both components drive it at different speeds from one source.
 */

/** The sixteen vertices of a 4-cube, one per sign combination. */
export const VERTICES: [number, number, number, number][] = Array.from(
  { length: 16 },
  (_, i) => [i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, i & 8 ? 1 : -1],
)

/**
 * The thirty-two edges: every pair of vertices differing in exactly one
 * coordinate. As bit patterns that is a one-bit difference, which `d & (d - 1)`
 * tests in one step.
 */
export const EDGES: [number, number][] = (() => {
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
 * Which structure an edge belongs to.
 *
 * The eight LINKS join the two cubes, and they are the clutter: at the same
 * weight as everything else they read as filled faces rather than as
 * connections. Holding them back is most of what makes the projection legible
 * as two frames rather than one tangle.
 */
export const EDGE_KIND: ('cube' | 'link')[] = EDGES.map(([a, b]) =>
  (a & 8) === (b & 8) ? 'cube' : 'link')

/**
 * Distance to the viewer in W.
 *
 * This is the number that matters. A vertex reaches at most sqrt(2) in W once
 * the rotation is running, so the divisor ranges over roughly 1.1 to 3.9 — a
 * scale ratio near 3.6:1 between the near and far cubes, which is the visible
 * difference between "inner frame" and "outer frame". Raise it and the two
 * converge into one flat cube; lower it and the near cube explodes off the
 * canvas as its divisor approaches zero.
 *
 * There is no Z_EYE. The 3D step is orthographic on purpose — see `project`.
 */
const W_EYE = 2.5

/**
 * The ISOMETRIC camera — looking straight down the cube's body diagonal.
 *
 * Not an arbitrary pleasing angle. At an arbitrary tilt a cube's twelve edges
 * project to twelve different lengths with no two faces agreeing, and the
 * figure reads as skewed rather than drawn. Down the (1,1,1) diagonal a cube
 * projects to a REGULAR HEXAGON with a Y at its centre: every edge the same
 * length, every angle 120 degrees. That is the mark.
 *
 * 45 degrees about Y then atan(1/sqrt(2)) about X is the standard construction.
 */
const TILT_Y = Math.PI / 4
const TILT_X = Math.atan(1 / Math.SQRT2)

/**
 * Sized and centred by measurement.
 *
 * Down the body diagonal the projection is symmetric about the origin — the
 * measured extent is -1.199..1.199 across the whole loop — so the centre is
 * exactly 50 and needs no fudge. That symmetry is itself the check that the
 * camera is truly isometric.
 *
 * 23.4 puts the figure in the middle ~56% of the frame. Air around a precise
 * line drawing is most of what makes it look precise.
 */
const SCALE = 23.4
const CENTER = 50

export interface Projected { x: number; y: number; depth: number }

/**
 * Project the hypercube at 4D rotation `t` and spatial rotation `spin`.
 *
 * The rotation is in the ZW plane, which is what produces the inversion: it
 * swings each vertex through W, and since the 4D->3D step divides by distance
 * in W, a vertex moving toward +W swells and one moving toward -W shrinks. Half
 * a turn later the cubes have exchanged roles.
 *
 * ZW rather than XW because of HOW the two separate on the way. XW slides them
 * apart across the screen, so partway through they sit side by side joined by
 * the eight links, and that band reads as a solid face — an extra plane that is
 * not there. ZW separates them in depth, so they stay concentric and genuinely
 * pass through one another.
 */
export function project(t: number, spin = 0): Projected[] {
  const c = Math.cos(t)
  const s = Math.sin(t)
  const cs = Math.cos(spin)
  const ss = Math.sin(spin)
  const cx = Math.cos(TILT_X)
  const sx = Math.sin(TILT_X)
  const cy = Math.cos(TILT_Y)
  const sy = Math.sin(TILT_Y)

  return VERTICES.map(([x0, y0, z0, w0]) => {
    const zr = z0 * c - w0 * s
    const w = z0 * s + w0 * c

    // The spatial turn, in XZ so it reads as the object rotating in space
    // rather than the picture spinning on the screen.
    const xs = x0 * cs - zr * ss
    const zs = x0 * ss + zr * cs

    const y1 = y0 * cx - zs * sx
    const z1 = y0 * sx + zs * cx
    const x2 = xs * cy + z1 * sy
    const z2 = -xs * sy + z1 * cy

    const kw = 1 / (W_EYE - w)
    const x3 = x2 * kw
    const y3 = y1 * kw

    // 3D -> 2D, ORTHOGRAPHIC. A perspective divide here would pull the near
    // corners of the hexagon out and the far ones in, and the regularity of
    // that hexagon is the mark. Depth still reads, from the W perspective above
    // and from the opacity ramp — it does not need a second, competing one.
    void z2
    return {
      x: CENTER + x3 * SCALE,
      y: CENTER + y3 * SCALE,
      depth: (w + 1.5) / 3,
    }
  })
}

/** Hermite smoothstep, clamped. Zero velocity at both ends. */
export function smoothstep(a: number, b: number, u: number): number {
  const t = Math.min(1, Math.max(0, (u - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * The loop has three beats: invert, turn, invert.
 *
 * Constant angular motion is right for a physics demonstration and dull as a
 * loading state. `morphSchedule` advances the 4D rotation over the opening and
 * closing stretches and holds through the middle; `spinSchedule` does the
 * opposite. Each is a smoothstep, so velocity is zero wherever a phase begins
 * or ends — which makes the handover read as a beat rather than a stutter, and
 * keeps the loop seam invisible: both arrive at the wrap with zero velocity and
 * a whole number of turns.
 *
 * Half a turn of the 4D rotation IS one complete inversion, so the cube passes
 * through itself once before the spin and once after.
 */
export const morphSchedule = (u: number): number =>
  0.5 * smoothstep(0, 0.40, u) + 0.5 * smoothstep(0.60, 1, u)

/** The spatial turn, which happens entirely between the two inversions. */
export const spinSchedule = (u: number): number => smoothstep(0.42, 0.58, u)

/** The frame at rest — the recognisable mark, and the reduced-motion state. */
export const RESTING = project(0)
