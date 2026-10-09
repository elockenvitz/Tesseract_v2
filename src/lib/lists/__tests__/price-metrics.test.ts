import { describe, it, expect } from 'vitest'
import {
  windowReturn, latestClose, closeAgeDays, hasDiscontinuity, returnPath, localDomain, clean,
} from '../price-metrics'

/** `n` daily closes ending today, moving `pct` in total, linearly. */
const series = (n: number, from: number, pct: number, endDaysAgo = 0) => {
  const to = from * (1 + pct / 100)
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.now() - (n - 1 - i + endDaysAgo) * 86_400_000)
    return { date: d.toISOString().slice(0, 10), close: from + (to - from) * (i / (n - 1)) }
  })
}

describe('a window return is refused unless the series can support it', () => {
  it('computes the move when the lookback is there', () => {
    const r = windowReturn(series(200, 100, 20), '6M')
    expect(r.refused).toBeNull()
    // The 6M slice is the last 186 days of a 200-day series, so it is a
    // portion of the total move rather than all of it.
    expect(r.pct).toBeGreaterThan(0)
    expect(r.pct).toBeLessThan(20)
  })

  /**
   * The refusal that matters most.
   *
   * Six weeks of closes divided first-by-last produces a number. It is not a
   * six-month return, and rendering it as one is the kind of figure a reader
   * cannot audit.
   */
  it('refuses a 6M return over six weeks of history', () => {
    const r = windowReturn(series(30, 100, 12), '6M')
    expect(r.pct).toBeNull()
    expect(r.refused).toBe('short-lookback')
  })

  it('still answers 1M over that same short series', () => {
    const r = windowReturn(series(30, 100, 12), '1M')
    expect(r.refused).toBeNull()
    expect(r.pct).not.toBeNull()
  })

  it('says nothing at all with fewer than two closes', () => {
    expect(windowReturn([], '1M').refused).toBe('no-series')
    expect(windowReturn([{ date: '2026-10-01', close: 10 }], '1M').refused).toBe('no-series')
  })
})

describe('a break in the series is not a return', () => {
  /**
   * `price_history_cache` stores no split factor and no adjustment flag, so
   * two closes spanning one are genuinely incomparable. The refusal says that
   * — it does not claim a corporate action, because a 50% gap is equally
   * consistent with a collapse.
   */
  it('refuses a window containing a halving', () => {
    const s = series(60, 100, 4)
    for (let i = 30; i < s.length; i++) s[i].close = s[i].close / 2
    expect(hasDiscontinuity(s)).toBe(true)
    const r = windowReturn(s, '1M')
    expect(r.pct).toBeNull()
    expect(r.refused).toBe('not-comparable')
  })

  it('leaves an ordinary earnings gap alone', () => {
    const s = series(60, 100, 4)
    for (let i = 30; i < s.length; i++) s[i].close = s[i].close * 1.18
    expect(hasDiscontinuity(s)).toBe(false)
    expect(windowReturn(s, '1M').refused).toBeNull()
  })
})

describe('a close carries its date', () => {
  it('reports the last close and its day', () => {
    const s = series(10, 100, 5)
    const l = latestClose(s)!
    expect(l.close).toBeCloseTo(105, 6)
    expect(l.date).toBe(s[s.length - 1].date)
  })

  it('ages a close in whole days', () => {
    const d = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10)
    expect(closeAgeDays(d)).toBeGreaterThanOrEqual(2)
    expect(closeAgeDays(null)).toBeNull()
  })

  it('sorts a reversed series rather than pricing off its oldest close', () => {
    const s = [...series(10, 100, 5)].reverse()
    expect(latestClose(s)!.close).toBeCloseTo(105, 6)
  })
})

describe('sparklines are scaled per security, with a floor', () => {
  /**
   * The path is in return space so the zero line is real and the drawn range
   * can be stated. The RANGE is per security; the cross-security comparison
   * lives in the 1M and 6M numbers beside the line.
   */
  it('indexes to the first close, so height means percent', () => {
    const p = returnPath(series(40, 400, 10), 31)
    expect(p[0]).toBeCloseTo(0, 6)
    expect(p[p.length - 1]).toBeGreaterThan(0)
  })

  /*
   * The scaling the Trend column now uses, and the two failures it sits
   * between. A range shared across rows was set by the loudest name and drew
   * everything else flat; a range fitted tight to each path draws a 0.2%
   * wobble as a mountain. `localDomain` fits the path but never narrows past
   * ±MIN_RANGE, and always contains zero.
   */
  it('fills the box for a security that actually moved', () => {
    const loud = returnPath(series(40, 100, 30), 31)
    const d = localDomain(loud)
    const amp = Math.max(...loud.map(Math.abs)) / Math.max(d.hi, -d.lo)
    expect(amp).toBeGreaterThan(0.6)
  })

  it('does not amplify a flat security to full scale', () => {
    // 0.2% of drift must not draw like a trend. The floored range is what
    // keeps it small; without it this amplitude would be ~0.85.
    const flat = [0, 0.1, -0.05, 0.2]
    const d = localDomain(flat)
    const amp = Math.max(...flat.map(Math.abs)) / Math.max(d.hi, -d.lo)
    expect(amp).toBeLessThan(0.2)
  })

  it('always contains zero, so the baseline is on the chart', () => {
    // A path that only ever rose still needs the line it rose from.
    const up = localDomain([0, 4, 9, 14])
    expect(up.lo).toBeLessThan(0)
    const down = localDomain([0, -4, -9, -14])
    expect(down.hi).toBeGreaterThan(0)
  })

  it('does not scale a quiet name to a loud one, by construction', () => {
    // The whole point of the change: one row's range cannot depend on another.
    const quiet = returnPath(series(40, 100, 2), 31)
    const loud = returnPath(series(40, 100, 180), 31)
    const before = localDomain(quiet)
    expect(localDomain(quiet)).toEqual(before)
    expect(localDomain(loud).hi).toBeGreaterThan(before.hi * 5)
  })

  it('survives an empty or non-finite path', () => {
    expect(localDomain([]).hi).toBeGreaterThan(0)
    expect(Number.isFinite(localDomain([NaN, Infinity]).lo)).toBe(true)
  })
})

describe('input is never trusted', () => {
  it('drops zero, negative and unparseable closes', () => {
    const s = clean([
      { date: '2026-10-01', close: 10 },
      { date: '2026-10-02', close: 0 },
      { date: '2026-10-03', close: -4 },
      { date: 'not-a-date', close: 12 },
      { date: '2026-10-04', close: 11 },
    ])
    expect(s.map(p => p.close)).toEqual([10, 11])
  })
})
