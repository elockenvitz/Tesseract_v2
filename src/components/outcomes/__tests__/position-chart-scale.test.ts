/**
 * Chart domain invariants.
 *
 * These are asserted as functions rather than as pixels deliberately: the
 * defect was never "the chart looks wrong at some width", it was that a
 * reference price decided the scale of the price history, and that zero
 * decided the scale of a position. Both are arithmetic, and arithmetic is
 * what a domain function can be held to.
 *
 * No test here encodes a particular asset. The off-scale rule is a named,
 * symmetric tolerance; the cases below exercise it from both sides.
 */
import { describe, it, expect } from 'vitest'
import {
  priceScale,
  metricScale,
  ENTRY_SPAN_TOLERANCE,
  METRIC_BAND,
} from '../position-chart-scale'
import { METRICS } from '../position-chart-model'

/** A price history that runs 500 → 700, as a large-cap might over a year. */
const WIDE = [500, 560, 620, 590, 700, 660]
const span = (d: [number, number]) => d[1] - d[0]

describe('price domain', () => {
  it('describes the visible history and does not force a zero baseline', () => {
    const s = priceScale(WIDE)!
    expect(s.domain[0]).toBeGreaterThan(0)
    // Padded off the data, not anchored anywhere arbitrary.
    expect(s.domain[0]).toBeLessThan(500)
    expect(s.domain[1]).toBeGreaterThan(700)
    expect(s.entryPlacement).toBe('none')
  })

  it('draws an average entry that sits inside the range', () => {
    const s = priceScale(WIDE, 610)!
    expect(s.entryPlacement).toBe('in-range')
    expect(s.domain[0]).toBeLessThanOrEqual(610)
    expect(s.domain[1]).toBeGreaterThanOrEqual(610)
  })

  it('admits an entry just outside the range, where it costs little', () => {
    // 200 span, so the allowance reaches 100 beyond either end.
    const s = priceScale(WIDE, 450)!
    expect(s.entryPlacement).toBe('in-range')
    expect(s.domain[0]).toBeLessThanOrEqual(450)
  })

  it('does not let an entry far below flatten the history', () => {
    const withEntry = priceScale(WIDE, 100.81)!
    const without = priceScale(WIDE)!

    expect(withEntry.entryPlacement).toBe('below')
    // The scale is the price history's, exactly as if no entry existed.
    expect(withEntry.domain).toEqual(without.domain)
    // And the entry is nowhere near it — which is why it is not drawn.
    expect(withEntry.domain[0]).toBeGreaterThan(100.81)
  })

  it('does not let an entry far above flatten the history', () => {
    const withEntry = priceScale(WIDE, 4000)!
    const without = priceScale(WIDE)!

    expect(withEntry.entryPlacement).toBe('above')
    expect(withEntry.domain).toEqual(without.domain)
    expect(withEntry.domain[1]).toBeLessThan(4000)
  })

  it('applies the tolerance symmetrically', () => {
    const lo = Math.min(...WIDE)
    const hi = Math.max(...WIDE)
    const allowance = (hi - lo) * ENTRY_SPAN_TOLERANCE

    // Just inside the allowance on each side.
    expect(priceScale(WIDE, lo - allowance * 0.9)!.entryPlacement).toBe('in-range')
    expect(priceScale(WIDE, hi + allowance * 0.9)!.entryPlacement).toBe('in-range')
    // Just outside it on each side.
    expect(priceScale(WIDE, lo - allowance * 1.1)!.entryPlacement).toBe('below')
    expect(priceScale(WIDE, hi + allowance * 1.1)!.entryPlacement).toBe('above')
  })

  it('keeps a narrow history readable without exaggerating it', () => {
    // A quiet week: 100.00 → 100.40.
    const narrow = [100, 100.1, 100.25, 100.4, 100.2]
    const s = priceScale(narrow)!
    // The pane is used — the domain is not hundreds of dollars wide...
    expect(span(s.domain)).toBeLessThan(1)
    // ...but it is padded, so a 40c move does not fill the pane edge to edge.
    expect(s.domain[0]).toBeLessThan(100)
    expect(s.domain[1]).toBeGreaterThan(100.4)
    expect(s.ticks.length).toBeGreaterThan(0)
  })

  it('does not collapse when the tolerance would otherwise be zero', () => {
    // A perfectly flat history has no span, so the allowance falls back to a
    // fraction of the level rather than to nothing.
    const flat = [200, 200, 200]
    expect(priceScale(flat, 200.5)!.entryPlacement).toBe('in-range')
    expect(priceScale(flat, 20)!.entryPlacement).toBe('below')
    expect(span(priceScale(flat)!.domain)).toBeGreaterThan(0)
  })

  it('handles a volatile history', () => {
    const volatile = [50, 180, 32, 210, 75, 240, 40]
    const s = priceScale(volatile)!
    expect(s.domain[0]).toBeLessThan(32)
    expect(s.domain[1]).toBeGreaterThan(240)
    expect(s.ticks.length).toBeGreaterThanOrEqual(1)
  })

  it('returns nothing when there is no price to scale', () => {
    expect(priceScale([])).toBeNull()
    expect(priceScale([Number.NaN, Number.POSITIVE_INFINITY])).toBeNull()
  })

  it('ignores a non-finite entry rather than corrupting the domain', () => {
    const s = priceScale(WIDE, Number.NaN)!
    expect(s.entryPlacement).toBe('none')
    expect(s.domain).toEqual(priceScale(WIDE)!.domain)
  })

  it('keeps every tick inside the drawn domain', () => {
    for (const prices of [WIDE, [100, 100.4], [50, 240]]) {
      const s = priceScale(prices)!
      for (const t of s.ticks) {
        expect(t).toBeGreaterThan(s.domain[0])
        expect(t).toBeLessThan(s.domain[1])
      }
    }
  })
})

describe('selected horizon', () => {
  it('recomputes from its own observations, inheriting nothing from All', () => {
    // An old spike to $2,000 that a 3M window excludes.
    const allTime = [2000, 1200, 700, 620, 590, 610]
    const recent = allTime.slice(3)

    const all = priceScale(allTime)!
    const threeMonth = priceScale(recent)!

    expect(all.domain[1]).toBeGreaterThan(1500)
    // The short horizon must not be scaled by the extreme it excludes.
    expect(threeMonth.domain[1]).toBeLessThan(700)
    expect(span(threeMonth.domain)).toBeLessThan(span(all.domain))
  })

  it('reclassifies the entry per horizon, because the range moved', () => {
    const allTime = [100, 300, 600, 650]
    const recent = [600, 650]
    // Entry $100 is the low of the full history, but far below the recent one.
    expect(priceScale(allTime, 100)!.entryPlacement).toBe('in-range')
    expect(priceScale(recent, 100)!.entryPlacement).toBe('below')
  })
})

describe('position metric domain', () => {
  it('does not anchor a constant share count at zero', () => {
    const s = metricScale([10_000, 10_000, 10_000], 'shares')!
    // The old rule gave [0, 23809] and a filled block from the baseline.
    expect(s.domain[0]).toBeGreaterThan(0)
    expect(s.domain[0]).toBeLessThan(10_000)
    expect(s.flat).toBe(true)
  })

  it('reports a changing share count as not flat', () => {
    const s = metricScale([4_000, 6_000, 10_000], 'shares')!
    expect(s.flat).toBe(false)
    expect(s.domain[0]).toBeLessThanOrEqual(4_000)
    expect(s.ticks).toContain(10_000)
  })

  it('keeps the series inside the lower band of the plot', () => {
    const s = metricScale([4_000, 10_000], 'shares')!
    // The domain is inflated so the data occupies roughly METRIC_BAND of it.
    const occupied = (10_000 - s.domain[0]) / span(s.domain)
    expect(occupied).toBeLessThanOrEqual(METRIC_BAND + 0.01)
  })

  it('anchors active weight at zero, where the sign is the reading', () => {
    const s = metricScale([1.2, 1.4, 1.1], 'active_weight')!
    expect(s.domain[0]).toBe(0)
  })

  it('spans the zero crossing for an active weight that changes sign', () => {
    const s = metricScale([-0.8, 0.4], 'active_weight')!
    expect(s.domain[0]).toBeLessThanOrEqual(-0.8)
    expect(s.ticks).toContain(0)
  })

  it('does not anchor plain weight at zero', () => {
    const s = metricScale([2.5, 2.5, 2.5], 'weight')!
    expect(s.domain[0]).toBeGreaterThan(0)
    expect(s.flat).toBe(true)
  })

  it('survives a genuinely zero series', () => {
    const s = metricScale([0, 0], 'shares')!
    expect(Number.isFinite(s.domain[0])).toBe(true)
    expect(span(s.domain)).toBeGreaterThan(0)
  })

  it('returns nothing when there is no series', () => {
    expect(metricScale([], 'shares')).toBeNull()
  })
})

describe('metric units and formatting', () => {
  it('formats shares as a share count, compactly on the axis', () => {
    expect(METRICS.shares.format(10_000)).toBe('10,000 shs')
    expect(METRICS.shares.tick(10_000)).not.toContain('%')
  })

  it('formats weight as a percentage', () => {
    expect(METRICS.weight.format(2.5)).toBe('2.50%')
    expect(METRICS.weight.tick(2.5)).toBe('2.5%')
  })

  it('formats active weight as signed percentage points', () => {
    expect(METRICS.active_weight.format(1.2)).toBe('+1.20%')
    expect(METRICS.active_weight.format(-0.8)).toBe('-0.80%')
    expect(METRICS.active_weight.tick(1.2)).toBe('+1.2%')
  })

  it('never reuses the shares formatter for a percentage metric', () => {
    // The units are different; a share-count axis under a weight series is
    // the bug this guards.
    expect(METRICS.weight.tick).not.toBe(METRICS.shares.tick)
    expect(METRICS.active_weight.tick).not.toBe(METRICS.shares.tick)
  })
})
