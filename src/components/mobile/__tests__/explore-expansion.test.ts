import { describe, it, expect } from 'vitest'
import { bezierAt, inverseKeyframes, DURATION_MS } from '../ExploreExpansion'

/**
 * Does the counter-scale actually cancel the shell's scale — at every instant?
 *
 * ── The bug this exists to catch ──────────────────────────────────────────
 *
 * The transition was reported as not smooth. It was not dropping frames: the
 * shell's scale is non-uniform by nature — a tile is ~190x130 and the sheet is
 * the viewport, so opening is `scale(0.47, 0.23)` — and applied to the shell
 * alone it squashes the content to half width and a quarter height for the
 * first stretch of the move. A 2:1 aspect distortion resolving in front of the
 * reader, which is what "not smooth" looked like.
 *
 * The obvious fix — give the content `scale(1/sx) -> scale(1)` with the same
 * easing — cancels at the two ENDS and nowhere in between, because
 * interpolating a value and interpolating its reciprocal are different curves.
 * At the midpoint of a 0.226 -> 1 shell scale the content still runs 66%
 * oversize. That is the version this suite would have passed silently if it
 * only checked the endpoints, so it checks the middle.
 */

/**
 * The shell's own scale at a given progress, which the content must undo.
 *
 * Direction matters: opening eases `from -> 1`, closing eases `1 -> from`.
 * A version of this that ignored `fade` is what let the close keyframes ship
 * running backwards.
 */
const shellScaleAt = (from: number, offset: number, fade: 'in' | 'out' = 'in') => {
  const p = fade === 'in' ? bezierAt(offset) : 1 - bezierAt(offset)
  return from + (1 - from) * p
}

/** A square-ish scale, where the two axes are not the point of the test. */
const SXY = 0.4

/** Mirrors `INVERSE_SAMPLES` in the component. */
const INVERSE_SAMPLE_COUNT = 48

const scaleOf = (frame: Keyframe): [number, number] => {
  const m = String(frame.transform).match(/scale\(([-\d.]+),\s*([-\d.]+)\)/)
  if (!m) throw new Error(`no scale in ${frame.transform}`)
  return [Number(m[1]), Number(m[2])]
}

describe('the content undoes the shell, not just at the ends', () => {
  /** A real tile against a real phone: 190x130 opening to 400x578. */
  const SX = 190 / 400
  const SY = 130 / 578

  it('cancels within half a percent at every sampled offset', () => {
    for (const frame of inverseKeyframes(SX, SY, 'in')) {
      const [ix, iy] = scaleOf(frame)
      const offset = frame.offset as number
      const effX = shellScaleAt(SX, offset) * ix
      const effY = shellScaleAt(SY, offset) * iy
      expect(effX, `x at offset ${offset}`).toBeCloseTo(1, 2)
      expect(effY, `y at offset ${offset}`).toBeCloseTo(1, 2)
    }
  })

  it('cancels BETWEEN samples too, where the linear interpolation lives', () => {
    /**
     * The residual this design accepts. Between two sampled keyframes the
     * content interpolates linearly while the shell keeps easing, so the
     * cancellation is approximate — the whole question is whether the error is
     * small enough to be invisible. Measured on this tile: 12 samples leaves
     * 5.75%, 24 leaves 1.71%, 48 leaves 0.47%. A regression that thinned the
     * sampling shows up here first, which is what it is for — the first
     * version of this shipped at 12 and this assertion is what caught it.
     */
    const frames = inverseKeyframes(SX, SY, 'in')
    let worst = 0
    for (let i = 0; i < frames.length - 1; i++) {
      const a = scaleOf(frames[i])
      const b = scaleOf(frames[i + 1])
      const oa = frames[i].offset as number
      const ob = frames[i + 1].offset as number
      for (const f of [0.25, 0.5, 0.75]) {
        const offset = oa + (ob - oa) * f
        const ix = a[0] + (b[0] - a[0]) * f
        const iy = a[1] + (b[1] - a[1]) * f
        worst = Math.max(
          worst,
          Math.abs(shellScaleAt(SX, offset) * ix - 1),
          Math.abs(shellScaleAt(SY, offset) * iy - 1),
        )
      }
    }
    expect(worst, `worst mid-sample error ${(worst * 100).toFixed(2)}%`).toBeLessThan(0.01)
  })

  it('would have failed the naive two-keyframe version', () => {
    /**
     * Guards the reasoning, not the code. If somebody replaces the sampled
     * keyframes with `scale(1/sx) -> scale(1)` because it reads more simply,
     * this states what that costs: two thirds of a distortion, at the exact
     * moment the reader is looking at it.
     */
    const naive = (from: number, offset: number) =>
      (1 / from) + (1 - 1 / from) * bezierAt(offset)
    /**
     * Scanned across the timeline rather than sampled at the midpoint. The
     * worst of it is at offset ~0.16, not 0.5 — this curve is fast off the
     * mark, so the reciprocal's error peaks early, which is also the moment
     * the reader's eye is still on the tile they tapped.
     */
    let worst = 0
    for (let i = 0; i <= 100; i++) {
      const offset = i / 100
      worst = Math.max(worst, shellScaleAt(SY, offset) * naive(SY, offset))
    }
    expect(worst, `naive version peaks at ${worst.toFixed(2)}x`).toBeGreaterThan(1.6)
  })
})

describe('the curve and the frames are well formed', () => {
  it('is a real easing curve, monotonic from 0 to 1', () => {
    expect(bezierAt(0)).toBeCloseTo(0, 3)
    expect(bezierAt(1)).toBeCloseTo(1, 3)
    let prev = -1
    for (let i = 0; i <= 20; i++) {
      const v = bezierAt(i / 20)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })

  it('starts and ends at identity, so nothing is left transformed', () => {
    const frames = inverseKeyframes(SXY, SXY, 'in')
    expect(scaleOf(frames[frames.length - 1])).toEqual([1, 1])
  })

  it('fades content in on open and out on close', () => {
    const open = inverseKeyframes(SXY, SXY, 'in')
    const close = inverseKeyframes(SXY, SXY, 'out')
    expect(Number(open[0].opacity)).toBe(0)
    expect(Number(open[open.length - 1].opacity)).toBe(1)
    expect(Number(close[0].opacity)).toBe(1)
    expect(Number(close[close.length - 1].opacity)).toBe(0)
  })

  it('runs inside the brief\u2019s motion window', () => {
    expect(DURATION_MS).toBeGreaterThanOrEqual(220)
    expect(DURATION_MS).toBeLessThanOrEqual(320)
  })
})

describe('the content is never visible while it is being resampled', () => {
  const SX = 190 / 400
  const SY = 130 / 578

  /**
   * The rule that keeps text sharp, and the one a future tweak will break.
   *
   * The counter-scale fixes the GEOMETRY — the content is exactly the right
   * size at every instant. It cannot fix the PIXELS: a scaled layer is a
   * rasterised one, so while the wrapper is at `scale(4.4)` the glyphs are a
   * blown-up texture. Right size, wrong pixels, and that is what "weird
   * smushing text" was after the squash itself had gone.
   *
   * There is no way to make a large scale resample cleanly mid-animation, so
   * the content simply must not be visible while the factor is large. Anyone
   * moving the fade earlier to make the transition feel livelier reintroduces
   * the artifact, and this is where they find out.
   */
  /**
   * How visible a resample is, as one number.
   *
   * Neither opacity nor scale alone says it: a 1.3x stretch at 20% opacity is
   * not something an eye catches, and a 1.05x stretch at full opacity is not
   * either. The product of the two is what governs, so that is what is
   * bounded — a raw scale cap would either forbid a harmless faint frame or
   * permit a loud one.
   */
  const budget = (frame: Keyframe) => {
    const [ix, iy] = scaleOf(frame)
    return Number(frame.opacity) * (Math.max(ix, iy) - 1)
  }

  it('never shows the content while it is being resampled, opening', () => {
    for (const frame of inverseKeyframes(SX, SY, 'in')) {
      expect(
        budget(frame),
        `offset ${frame.offset}: opacity ${frame.opacity} at ${scaleOf(frame)[1].toFixed(2)}x`,
      ).toBeLessThan(0.1)
    }
  })

  it('never shows the content while it is being resampled, closing', () => {
    /**
     * The direction that was wrong twice over — running the curve forwards
     * against a shell running it backwards, and then fading out far too
     * slowly for a front-loaded curve. Closing left the content visible at
     * 2.7x before the ramp was measured.
     */
    for (const frame of inverseKeyframes(SX, SY, 'out')) {
      expect(
        budget(frame),
        `offset ${frame.offset}: opacity ${frame.opacity} at ${scaleOf(frame)[1].toFixed(2)}x`,
      ).toBeLessThan(0.1)
    }
  })

  it('undoes the shell on the way out too, not just on the way in', () => {
    // The close keyframes ran the curve forwards while the shell ran it
    // backwards, so they cancelled at neither end nor anywhere between.
    for (const frame of inverseKeyframes(SX, SY, 'out')) {
      const [ix, iy] = scaleOf(frame)
      const offset = frame.offset as number
      expect(shellScaleAt(SX, offset, 'out') * ix, `x at ${offset}`).toBeCloseTo(1, 2)
      expect(shellScaleAt(SY, offset, 'out') * iy, `y at ${offset}`).toBeCloseTo(1, 2)
    }
  })

  it('still shows the content for a usable share of the move', () => {
    // The other side of the same dial. Fade too late and the card arrives as a
    // pop at the end, which reads as a missing frame rather than a transition.
    const visible = inverseKeyframes(SX, SY, 'in').filter(f => Number(f.opacity) > 0.5)
    expect(visible.length / (INVERSE_SAMPLE_COUNT + 1)).toBeGreaterThan(0.25)
  })
})
