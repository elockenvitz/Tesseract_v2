import { describe, expect, it } from 'vitest'
import { morphSchedule, project as projectTesseract, spinSchedule } from '../tesseract-geometry'

/**
 * The properties that make this a tesseract rather than a spinning logo.
 *
 * A visual cannot be fully asserted in a test, but the three things that were
 * wrong in the versions before it can be: a spin keeps every distance fixed, a
 * pulse scales everything about one centre, and a ping-pong reverses. All three
 * are ruled out below by measuring the projected geometry.
 */

/** Widest extent of the eight vertices on one side of the W axis. */
const span = (t: number, side: 1 | -1) => {
  const p = projectTesseract(t)
  const picked = p.filter((_, i) => (i & 8 ? 1 : -1) === side)
  const xs = picked.map(q => q.x)
  const ys = picked.map(q => q.y)
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
}

describe('tesseract projection', () => {
  it('starts as a frame nested inside another frame', () => {
    // The brand-recognition moment: one cube clearly inside the other.
    expect(span(0, 1) / span(0, -1)).toBeGreaterThan(2)
  })

  it('exchanges the inner and outer frames', () => {
    /**
     * The defining property. Whichever group starts outside must end up inside
     * and vice versa — not merely shrink and grow back, which is a pulse.
     */
    // Measured: the frames cross near a quarter turn and are fully exchanged
    // by nine-tenths of a half turn.
    expect(span(0, 1)).toBeGreaterThan(span(0, -1) * 2)
    expect(span(Math.PI * 0.9, 1)).toBeLessThan(span(Math.PI * 0.9, -1) * 0.5)
  })

  it('passes the two frames through one another', () => {
    // Midway they are close to the same size, which is the moment the
    // structures cross rather than one simply swelling around the other.
    const mid = Math.PI / 2
    const ratio = span(mid, 1) / span(mid, -1)
    expect(ratio).toBeGreaterThan(0.7)
    expect(ratio).toBeLessThan(1.4)
  })

  it('is not a rigid rotation', () => {
    /**
     * A rigid body under one projection changes every edge by the SAME factor.
     * Here the factors must scatter, because the vertices are moving relative
     * to one another — that scatter is what makes the connectors stretch and
     * skew, and it is the difference between a hypercube and a spinning box.
     *
     * Measured across all thirty-two edges rather than one, which was the flaw
     * in the first version of this test: it happened to sample an x-edge, which
     * a ZW rotation barely touches, and reported 1.07.
     */
    const len = (t: number, a: number, b: number) => {
      const p = projectTesseract(t)
      return Math.hypot(p[a].x - p[b].x, p[a].y - p[b].y)
    }
    const ratios: number[] = []
    for (let i = 0; i < 16; i++) {
      for (let j = i + 1; j < 16; j++) {
        const d = i ^ j
        if ((d & (d - 1)) !== 0) continue
        ratios.push(len(Math.PI / 2, i, j) / len(0, i, j))
      }
    }
    expect(Math.max(...ratios) / Math.min(...ratios)).toBeGreaterThan(2)
  })

  it('is not a scale about one centre', () => {
    // A pulse moves every vertex the same way. These must diverge: one group
    // heads outward while the other comes in.
    const d = (t: number, side: 1 | -1) => span(t, side) - span(0, side)
    expect(Math.sign(d(Math.PI * 0.75, 1))).toBe(-1)
    expect(Math.sign(d(Math.PI * 0.75, -1))).toBe(1)
  })

  it('closes the loop exactly, with no rewind', () => {
    // Start and end frames identical, so there is no seam and no ping-pong.
    const a = projectTesseract(0)
    const b = projectTesseract(Math.PI * 2)
    a.forEach((v, i) => {
      expect(v.x).toBeCloseTo(b[i].x, 6)
      expect(v.y).toBeCloseTo(b[i].y, 6)
      expect(v.depth).toBeCloseTo(b[i].depth, 6)
    })
  })

  it('stays inside the viewBox at every angle', () => {
    for (let i = 0; i < 48; i++) {
      for (const v of projectTesseract((i / 48) * Math.PI * 2)) {
        expect(v.x).toBeGreaterThan(2)
        expect(v.x).toBeLessThan(98)
        expect(v.y).toBeGreaterThan(2)
        expect(v.y).toBeLessThan(98)
      }
    }
  })
})

describe('loop phrasing', () => {
  /**
   * Invert, turn, invert — rather than one constant rotation.
   *
   * The properties worth pinning are the ones that make the seam invisible and
   * the beats distinct; the aesthetic judgement is not testable and is not
   * attempted here.
   */
  it('completes whole turns, so the loop closes exactly', () => {
    expect(morphSchedule(0)).toBeCloseTo(0, 6)
    expect(morphSchedule(1)).toBeCloseTo(1, 6)
    expect(spinSchedule(0)).toBeCloseTo(0, 6)
    expect(spinSchedule(1)).toBeCloseTo(1, 6)
  })

  it('arrives at the seam with zero velocity', () => {
    // A non-zero velocity at the wrap is a visible jolt once a second.
    const v = (f: (u: number) => number, u: number) => (f(u + 1e-4) - f(u)) / 1e-4
    expect(Math.abs(v(morphSchedule, 0))).toBeLessThan(0.01)
    expect(Math.abs(v(morphSchedule, 1 - 1e-4))).toBeLessThan(0.01)
    expect(Math.abs(v(spinSchedule, 0))).toBeLessThan(0.01)
    expect(Math.abs(v(spinSchedule, 1 - 1e-4))).toBeLessThan(0.01)
  })

  it('separates the beats: the cube inverts, then turns, then inverts', () => {
    // Half a turn of the 4D rotation is one full inversion, so the schedule
    // must reach 0.5 before the spin starts and finish after it ends.
    expect(morphSchedule(0.40)).toBeCloseTo(0.5, 2)
    expect(spinSchedule(0.40)).toBeCloseTo(0, 3)
    // Through the middle the inversion holds while the spin runs.
    expect(morphSchedule(0.5)).toBeCloseTo(0.5, 2)
    expect(spinSchedule(0.5)).toBeGreaterThan(0.3)
    // Then the spin is spent and the second inversion runs.
    expect(spinSchedule(0.62)).toBeCloseTo(1, 2)
    expect(morphSchedule(0.62)).toBeGreaterThan(0.5)
  })

  it('never runs backwards', () => {
    // Monotonic, or the motion reads as a rewind rather than a loop.
    let m = -1
    let sp = -1
    for (let i = 0; i <= 200; i++) {
      const u = i / 200
      expect(morphSchedule(u)).toBeGreaterThanOrEqual(m - 1e-9)
      expect(spinSchedule(u)).toBeGreaterThanOrEqual(sp - 1e-9)
      m = morphSchedule(u)
      sp = spinSchedule(u)
    }
  })

  it('stays inside the viewBox through the spin as well', () => {
    for (let i = 0; i <= 120; i++) {
      const u = i / 120
      for (const v of projectTesseract(morphSchedule(u) * Math.PI * 2, spinSchedule(u) * Math.PI * 2)) {
        expect(v.x).toBeGreaterThan(2)
        expect(v.x).toBeLessThan(98)
        expect(v.y).toBeGreaterThan(2)
        expect(v.y).toBeLessThan(98)
      }
    }
  })
})
