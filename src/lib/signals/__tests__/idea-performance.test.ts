import { describe, it, expect } from 'vitest'
import { ideaPerformance, targetGapPct, targetProgress } from '../idea-performance'

/** A close series ending today, `n` daily points back. */
function series(n: number, from: number, to: number, endIso = '2026-08-30') {
  const end = new Date(`${endIso}T00:00:00Z`).getTime()
  return Array.from({ length: n }, (_, k) => ({
    date: new Date(end - (n - 1 - k) * 86_400_000).toISOString().slice(0, 10),
    close: from + ((to - from) * k) / Math.max(1, n - 1),
  }))
}

describe('ideaPerformance — the window and the number cannot disagree', () => {
  it('computes the delta from the very points it returns', () => {
    const p = ideaPerformance(series(40, 100, 120), '2026-08-01')
    expect(p.anchored).toBe(true)
    expect(p.sinceIdea).not.toBeNull()
    const { points } = p
    const expected = ((points[points.length - 1].close - points[0].close) / points[0].close) * 100
    expect(p.sinceIdea!.changePct).toBeCloseTo(expected, 10)
    expect(p.sinceIdea!.fromDate).toBe(points[0].date)
  })

  /**
   * The Explore news defect, in its Ideas form. A series that does not reach
   * the idea must not produce a "since this idea" number.
   */
  it('refuses the claim when the cache does not reach the idea date', () => {
    // 10 cached days; the idea is a year old.
    const p = ideaPerformance(series(10, 100, 110), '2025-08-01')
    expect(p.anchored).toBe(false)
    expect(p.sinceIdea).toBeNull()
    expect(p.windowLabel).toBe('Recent')
  })

  it('still returns a drawable recent path when it falls back', () => {
    const p = ideaPerformance(series(10, 100, 110), '2025-08-01')
    expect(p.points.length).toBe(10)
  })

  it('makes an unanchored delta unrepresentable rather than merely discouraged', () => {
    const p = ideaPerformance(series(10, 100, 110), '2025-08-01')
    // There is no field to render a wrong number from.
    expect(Object.prototype.hasOwnProperty.call(p, 'sinceIdea')).toBe(true)
    expect(p.sinceIdea).toBeNull()
  })

  /**
   * A long cache reaching well behind a RECENT idea: the anchor is genuinely
   * covered, but only three closes fall inside the window. Drawable, and not
   * enough to put a percentage on.
   */
  it('draws but does not quantify a window too thin to be a return', () => {
    const p = ideaPerformance(series(40, 100, 105), '2026-08-28')
    expect(p.anchored).toBe(true)
    expect(p.sinceIdea).toBeNull()
    expect(p.windowLabel).toBe('Since this idea')
  })

  it('handles an empty or single-point series without inventing anything', () => {
    expect(ideaPerformance([], '2026-08-01').sinceIdea).toBeNull()
    expect(ideaPerformance(null, '2026-08-01').points).toEqual([])
    expect(ideaPerformance(series(1, 100, 100), '2026-08-01').sinceIdea).toBeNull()
  })

  it('treats a missing creation date as no anchor', () => {
    const p = ideaPerformance(series(40, 100, 120), null)
    expect(p.anchored).toBe(false)
    expect(p.sinceIdea).toBeNull()
  })

  it('carries the sign — a fallen price is a negative return', () => {
    const p = ideaPerformance(series(40, 120, 100), '2026-08-01')
    expect(p.sinceIdea!.changePct).toBeLessThan(0)
  })
})

describe('targetGapPct — signed against the stance, not the arithmetic', () => {
  it('is positive when a buy target sits above the price', () => {
    expect(targetGapPct(100, 130, 'increase')).toBeCloseTo(30)
  })

  /** A sell whose target is below the price is the thesis working. */
  it('is positive when a sell/trim target sits below the price', () => {
    expect(targetGapPct(100, 80, 'decrease')).toBeCloseTo(20)
  })

  it('goes negative once the price has passed the target in the stated direction', () => {
    expect(targetGapPct(140, 130, 'increase')).toBeLessThan(0)
    expect(targetGapPct(70, 80, 'decrease')).toBeLessThan(0)
  })

  it('returns null rather than a zero for missing or nonsense inputs', () => {
    expect(targetGapPct(null, 130, 'increase')).toBeNull()
    expect(targetGapPct(100, null, 'increase')).toBeNull()
    expect(targetGapPct(0, 130, 'increase')).toBeNull()
    expect(targetGapPct(100, -5, 'increase')).toBeNull()
  })
})

describe('targetProgress', () => {
  it('reports the fraction of the journey already travelled', () => {
    expect(targetProgress(100, 110, 120)).toBeCloseTo(0.5)
  })

  it('clamps a price through its target to a full bar', () => {
    expect(targetProgress(100, 130, 120)).toBe(1)
  })

  it('clamps a price that went the wrong way to an empty bar, never negative', () => {
    expect(targetProgress(100, 90, 120)).toBe(0)
  })

  it('is undefined without a starting price, rather than measuring from today', () => {
    expect(targetProgress(null, 110, 120)).toBeNull()
  })

  it('refuses a zero-width journey', () => {
    expect(targetProgress(120, 120, 120)).toBeNull()
  })
})
