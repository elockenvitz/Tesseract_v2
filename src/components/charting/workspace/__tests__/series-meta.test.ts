/**
 * What the instrument header is allowed to say.
 *
 * Three of these guard a claim rather than a calculation. A header that
 * prints a change of 0.00% when it has nothing to compare against, or one
 * instrument's last price beside another instrument's name, or a raw series
 * with no word saying so, is stating something false -- and all three are
 * cheap to introduce by accident, because each one looks like a reasonable
 * default.
 */
import { describe, it, expect } from 'vitest'
import {
  readChange, freshnessLabel, adjustmentLabel, adjustmentIsHazardous,
  adjustmentForProvider, type SeriesMeta,
} from '../series-meta'

const base: SeriesMeta = {
  symbol: 'AAPL',
  last: 100,
  previous: 80,
  lastBarTime: 1_760_000_000,
  bars: 30,
  interval: '1d',
  provider: 'yahoo',
  adjustment: 'raw',
}

describe('the change is computed, or it is withheld', () => {
  it('reads a rise as a rise', () => {
    const c = readChange(base)!
    expect(c.absolute).toBe(20)
    expect(c.percent).toBeCloseTo(25)
    expect(c.direction).toBe('up')
  })

  it('reads a fall as a fall', () => {
    const c = readChange({ ...base, last: 60, previous: 80 })!
    expect(c.absolute).toBe(-20)
    expect(c.percent).toBeCloseTo(-25)
    expect(c.direction).toBe('down')
  })

  it('a single bar has no change, and says nothing rather than 0.00%', () => {
    /* The failure this stops: a one-bar series printing "0.00 (0.00%)",
       which states the price did not move. It did not fail to move -- there
       is nothing to compare it to, and those are different claims. */
    expect(readChange({ ...base, previous: null })).toBeNull()
  })

  it('withholds the change when the previous close is zero', () => {
    expect(readChange({ ...base, previous: 0 })).toBeNull()
  })

  it('withholds the change when either close is not a number', () => {
    expect(readChange({ ...base, last: Number.NaN })).toBeNull()
    expect(readChange({ ...base, previous: Number.POSITIVE_INFINITY })).toBeNull()
  })

  it('a genuinely unchanged price is flat, not withheld', () => {
    const c = readChange({ ...base, last: 80, previous: 80 })!
    expect(c.direction).toBe('flat')
    expect(c.percent).toBe(0)
  })

  it('a percent against a negative previous close uses its magnitude', () => {
    // Not reachable for an equity price, but a sign flip here would invert
    // the direction of every reading on a spread or a rate series.
    const c = readChange({ ...base, last: -5, previous: -10 })!
    expect(c.absolute).toBe(5)
    expect(c.percent).toBeCloseTo(50)
    expect(c.direction).toBe('up')
  })
})

describe('freshness says how old, coarsely', () => {
  const now = 1_760_000_000_000 // ms

  it('a bar from a minute ago is now', () => {
    expect(freshnessLabel(now / 1000 - 30, now)).toBe('just now')
  })

  it('minutes, hours and days each get their own shape', () => {
    expect(freshnessLabel(now / 1000 - 600, now)).toBe('10m ago')
    expect(freshnessLabel(now / 1000 - 7200, now)).toBe('2h ago')
    expect(freshnessLabel(now / 1000 - 86_400, now)).toBe('1 day ago')
    expect(freshnessLabel(now / 1000 - 86_400 * 4, now)).toBe('4 days ago')
  })

  it('a missing bar time is reported as missing, not as fresh', () => {
    /* The dangerous default: treating null as 0 seconds old, which labels a
       series with no data "just now". */
    expect(freshnessLabel(null, now)).toBe('no data')
    expect(freshnessLabel(Number.NaN, now)).toBe('no data')
  })

  it('a bar timestamped in the future does not read as negative', () => {
    expect(freshnessLabel(now / 1000 + 600, now)).toBe('just now')
  })
})

describe('the adjustment basis is stated, and raw is flagged', () => {
  it('raw says it is not split-adjusted, in words', () => {
    /* The reason this is not just a short code: on the ALL view AAPL falls
       from about 650 to about 93 across its 2014 split. A reader needs the
       phrase, not a two-letter tag they have to look up. */
    expect(adjustmentLabel('raw')).toContain('not split-adjusted')
  })

  it('raw and unknown are hazardous; an adjusted series is not', () => {
    expect(adjustmentIsHazardous('raw')).toBe(true)
    expect(adjustmentIsHazardous('unknown')).toBe(true)
    expect(adjustmentIsHazardous('split_adjusted')).toBe(false)
    expect(adjustmentIsHazardous('split_and_dividend_adjusted')).toBe(false)
  })

  it('every basis has a label, so none can render as empty', () => {
    for (const a of ['raw', 'split_adjusted', 'split_and_dividend_adjusted', 'unknown'] as const) {
      expect(adjustmentLabel(a).length).toBeGreaterThan(0)
    }
  })

  it('both live feeds are raw, because both map the unadjusted close', () => {
    /* Checked against the mapping sites, not assumed: `chartData.ts` reads
       `indicators.quote[0].close` and `eodhd-series.ts` reads `bar.close`.
       Both responses also carry an adjusted close that nothing reads. */
    expect(adjustmentForProvider('yahoo')).toBe('raw')
    expect(adjustmentForProvider('eodhd')).toBe('raw')
    expect(adjustmentForProvider('EODHD')).toBe('raw')
  })

  it('an unchecked feed is unknown, not raw', () => {
    /* The tempting default is 'raw', since both current feeds are. It would
       put a specific claim on screen for a mapping nobody has read. */
    expect(adjustmentForProvider('polygon')).toBe('unknown')
    expect(adjustmentForProvider('')).toBe('unknown')
  })

  it('an unknown basis is flagged to the reader just as raw is', () => {
    // So choosing honesty above costs the reader nothing.
    expect(adjustmentIsHazardous(adjustmentForProvider('polygon'))).toBe(true)
  })
})
