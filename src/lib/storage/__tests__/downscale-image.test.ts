/**
 * The org switcher's 1.44 MB logo.
 *
 * Exactly one organization logo exists in the database: 1,513,770 bytes of
 * PNG, painted by the switcher into a 24x24 CSS box. Signing was already
 * cached and shared; the bytes were what was left.
 *
 * The arithmetic and the refusals are tested here. The canvas work itself is
 * not reachable in this environment, and a test that mocked a canvas would
 * assert the mock -- so what IS tested is that every path without a canvas
 * returns the original file rather than nothing, which is the property that
 * keeps a logo upload working.
 */
import { describe, expect, it } from 'vitest'
import {
  DOWNSCALE_MIN_BYTES,
  LOGO_MAX_EDGE,
  downscaleImage,
  fitWithin,
  shouldDownscale,
} from '../downscale-image'

const fakeFile = (name: string, type: string, size: number): File => {
  // A File whose `size` is the thing under test; the bytes are irrelevant.
  const f = new File([new Uint8Array(1)], name, { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

/* ─────────────────────────────── the maths ────────────────────────────── */

describe('fitting within a maximum edge', () => {
  it('scales the long edge down to the cap and keeps the aspect ratio', () => {
    expect(fitWithin(2048, 1024, 256)).toEqual({ width: 256, height: 128 })
    expect(fitWithin(1024, 2048, 256)).toEqual({ width: 128, height: 256 })
  })

  it('never enlarges an image that is already small enough', () => {
    // Enlarging would add bytes to fix a byte problem.
    expect(fitWithin(64, 64, 256)).toEqual({ width: 64, height: 64 })
    expect(fitWithin(256, 120, 256)).toEqual({ width: 256, height: 120 })
  })

  it('keeps a very wide image at least one pixel tall', () => {
    // A 4000x3 banner must not round to a zero-height canvas, which throws.
    const out = fitWithin(4000, 3, 256)
    expect(out.width).toBe(256)
    expect(out.height).toBeGreaterThanOrEqual(1)
  })

  it('does not divide by zero on a degenerate image', () => {
    expect(fitWithin(0, 0, 256)).toEqual({ width: 0, height: 0 })
  })

  it('shrinks the real logo to something a 24px box can justify', () => {
    // The actual stored asset's shape is unknown, but any square source
    // lands on the cap, and 256px covers a 24px box at 4x density.
    const out = fitWithin(1200, 1200, LOGO_MAX_EDGE)
    expect(out).toEqual({ width: 256, height: 256 })
  })
})

/* ──────────────────────────── what is worth doing ─────────────────────── */

describe('deciding whether to resize at all', () => {
  it('takes on a large raster logo', () => {
    // The one that is actually in the database.
    expect(shouldDownscale({ type: 'image/png', size: 1_513_770 })).toBe(true)
    expect(shouldDownscale({ type: 'image/jpeg', size: 400_000 })).toBe(true)
  })

  it('leaves a small file alone', () => {
    // Re-encoding a well-optimised PNG can make it bigger.
    expect(shouldDownscale({ type: 'image/png', size: DOWNSCALE_MIN_BYTES })).toBe(false)
    expect(shouldDownscale({ type: 'image/png', size: 2_000 })).toBe(false)
  })

  it('leaves SVG alone whatever its size', () => {
    /*
     * An SVG is already resolution-independent. Rasterising it to a 256px PNG
     * would make it worse at every size except that one.
     */
    expect(shouldDownscale({ type: 'image/svg+xml', size: 900_000 })).toBe(false)
  })

  it('does not touch a non-image', () => {
    expect(shouldDownscale({ type: 'application/pdf', size: 900_000 })).toBe(false)
    expect(shouldDownscale({ type: '', size: 900_000 })).toBe(false)
  })
})

/* ──────────────────── the upload must never be broken ─────────────────── */

describe('a logo upload still succeeds when resizing cannot happen', () => {
  it('returns the ORIGINAL file, not null, for an SVG', async () => {
    const svg = fakeFile('logo.svg', 'image/svg+xml', 900_000)
    const out = await downscaleImage(svg)
    expect(out.file).toBe(svg)
    expect(out.outcome).toBe('unsupported')
    expect(out.finalBytes).toBe(900_000)
  })

  it('returns the original file for a non-image', async () => {
    const pdf = fakeFile('brand.pdf', 'application/pdf', 900_000)
    const out = await downscaleImage(pdf)
    expect(out.file).toBe(pdf)
    expect(out.outcome).toBe('not-an-image')
  })

  it('returns the original file for something already small', async () => {
    const small = fakeFile('logo.png', 'image/png', 1_000)
    const out = await downscaleImage(small)
    expect(out.file).toBe(small)
    expect(out.outcome).toBe('already-small')
  })

  it('returns the original file when the environment has no canvas', async () => {
    /*
     * THE property that matters. If this returned null, undefined or threw,
     * the caller would upload nothing or crash -- so a browser that cannot
     * decode the image would stop an organization setting its logo. The old
     * behaviour (store it as it is) is the correct fallback.
     */
    const big = fakeFile('logo.png', 'image/png', 1_513_770)
    const out = await downscaleImage(big)
    expect(out.file).toBe(big)
    expect(out.finalBytes).toBe(1_513_770)
    expect(['unsupported', 'failed']).toContain(out.outcome)
  })

  it('always reports both sizes, so a caller can tell what happened', async () => {
    for (const f of [
      fakeFile('a.svg', 'image/svg+xml', 500_000),
      fakeFile('b.png', 'image/png', 1_000),
      fakeFile('c.png', 'image/png', 1_513_770),
    ]) {
      const out = await downscaleImage(f)
      expect(Number.isFinite(out.originalBytes)).toBe(true)
      expect(Number.isFinite(out.finalBytes)).toBe(true)
      expect(out.finalBytes).toBeLessThanOrEqual(out.originalBytes)
    }
  })
})
