import { describe, expect, it } from 'vitest'
import { projectTesseract } from '../../../components/ui/TesseractLoader'

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
    // A spin preserves every distance. Here the projected edge lengths must
    // change, which is what makes the connectors stretch and skew.
    const edge = (t: number) => {
      const p = projectTesseract(t)
      return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y)
    }
    expect(Math.abs(edge(0) - edge(Math.PI / 2))).toBeGreaterThan(4)
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
