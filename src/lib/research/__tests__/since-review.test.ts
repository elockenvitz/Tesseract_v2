import { describe, expect, it } from 'vitest'

import { formatSinceReview, horizonContaining, sinceReview } from '../since-review'

/**
 * The anchored metric, and the four ways it must decline to answer.
 *
 * The number this produces is a fact about the CASE, not about the chart, and
 * the tests below are mostly about the cases where there is no honest number to
 * produce — which is the majority of the book, since only 134 of 912 assets
 * have any cached history at all.
 */

/** A daily series, ascending, starting at `from` and stepping by `step`. */
function series(from: string, closes: number[]): { date: string; close: number }[] {
  const start = new Date(from).getTime()
  return closes.map((close, i) => ({
    date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    close,
  }))
}

describe('since review', () => {
  const s = series('2026-01-01', [100, 101, 102, 103, 110, 120, 125])

  it('measures from the close at or before the anchor', () => {
    // Anchor on day 3 (close 103) → last close 125.
    const v = sinceReview(s, '2026-01-04T12:00:00Z')
    expect(v?.fromDate).toBe('2026-01-04')
    expect(v?.fromPrice).toBe(103)
    expect(v?.toPrice).toBe(125)
    expect(v?.changePct).toBeCloseTo(((125 - 103) / 103) * 100, 6)
  })

  it('carries the sign, and formats it without grading it', () => {
    const down = sinceReview(series('2026-01-01', [200, 190, 150]), '2026-01-01T00:00:00Z')
    expect(down?.changePct).toBeLessThan(0)
    // A minus sign, not a colour and not a word. NKE at −30.5% and PLTR at
    // +37.7% are the same finding and must render the same way.
    expect(formatSinceReview(down!)).toMatch(/^−\d/)
    expect(formatSinceReview(sinceReview(s, '2026-01-01T00:00:00Z')!)).toMatch(/^\+\d/)
  })

  it('refuses when there is no anchor', () => {
    // A case that has never been written has nothing to measure from.
    expect(sinceReview(s, null)).toBeNull()
    expect(sinceReview(s, undefined)).toBeNull()
    expect(sinceReview(s, 'not a date')).toBeNull()
  })

  it('refuses when there is no series', () => {
    // COIN and TGT: both anchored, neither with a single cached close. The
    // pane says so; it does not draw somebody else's chart.
    expect(sinceReview([], '2026-01-04T00:00:00Z')).toBeNull()
    expect(sinceReview(null, '2026-01-04T00:00:00Z')).toBeNull()
    expect(sinceReview([{ date: '2026-01-01', close: 100 }], '2026-01-04T00:00:00Z')).toBeNull()
  })

  it('refuses when the cache does not reach back to the anchor', () => {
    /**
     * The failure this exists to prevent, and the reason `seriesCoversAnchor` is
     * shared with the Ideas family rather than re-implemented: a review anchor
     * can be any age at all, and `price_history_cache` holds about 260 trading
     * days. Without this the card would draw whatever the cache happens to hold
     * and print the return under the words "since the case was written".
     */
    expect(sinceReview(s, '2024-06-01T00:00:00Z')).toBeNull()
  })

  it('refuses a baseline from long before the anchor', () => {
    // A close 90 days before the anchor is not a baseline FOR the anchor, even
    // though it is technically "at or before" it.
    const gappy = [
      { date: '2026-01-01', close: 100 },
      { date: '2026-06-01', close: 180 },
    ]
    expect(sinceReview(gappy, '2026-04-01T00:00:00Z')).toBeNull()
  })

  it('accepts an anchor a few days ahead of the first close', () => {
    // A case saved on a Friday evening has its first close on the Monday. Five
    // days of grace covers a weekend plus a holiday either side.
    const v = sinceReview(series('2026-01-05', [100, 105, 110]), '2026-01-05T20:00:00Z')
    expect(v?.fromDate).toBe('2026-01-05')
  })

  it('does not mutate the series the chart is drawing', () => {
    const original = series('2026-01-01', [100, 110, 120])
    const copy = original.map(p => ({ ...p }))
    sinceReview(original, '2026-01-01T00:00:00Z')
    expect(original).toEqual(copy)
  })

  it('is independent of any chart horizon, because it never sees one', () => {
    /**
     * The separation stated as a type-level fact rather than as a hope: this
     * function takes a series and an anchor and nothing else. There is no range
     * parameter, so tapping 1M on `PriceContext` cannot reach it — which is
     * exactly why the metric lives here and not on the chart.
     */
    expect(sinceReview.length).toBe(2)
    const full = sinceReview(s, '2026-01-04T12:00:00Z')
    // The same anchor over the same data gives the same answer no matter what
    // window a caller might separately choose to draw.
    expect(sinceReview(s, '2026-01-04T12:00:00Z')).toEqual(full)
  })
})

describe('the horizon a Research price pane opens on', () => {
  const NOW = new Date('2026-08-31T00:00:00.000Z').getTime()
  const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString()

  it('picks the smallest ladder rung that contains the anchor', () => {
    /**
     * `PriceContext` defaults to 6M. PLTR's thesis was written 192 days ago —
     * ten days outside it — so the marker this pane exists for had nothing to
     * attach to, and before the snap tolerance was tightened it drew against
     * the left edge pointing at the wrong close.
     */
    expect(horizonContaining(ago(192), NOW)).toBe('1Y')
    expect(horizonContaining(ago(20), NOW)).toBe('1M')
    expect(horizonContaining(ago(100), NOW)).toBe('6M')
    expect(horizonContaining(ago(400), NOW)).toBe('5Y')
  })

  it('holds the line exactly at each rung', () => {
    expect(horizonContaining(ago(30), NOW)).toBe('1M')
    expect(horizonContaining(ago(31), NOW)).toBe('3M')
    expect(horizonContaining(ago(182), NOW)).toBe('6M')
    expect(horizonContaining(ago(183), NOW)).toBe('1Y')
  })

  it('leaves the default alone when there is no anchor to contain', () => {
    // A case that has never been written has no anchor, so no window is
    // better than another and the pane keeps its own default.
    expect(horizonContaining(null, NOW)).toBeNull()
    expect(horizonContaining(undefined, NOW)).toBeNull()
    expect(horizonContaining('not a date', NOW)).toBeNull()
  })

  it('never widens for an anchor in the future', () => {
    expect(horizonContaining(ago(-10), NOW)).toBeNull()
  })
})
