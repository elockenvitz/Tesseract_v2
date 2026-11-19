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
  type SeriesMeta,
} from '../series-meta'
// The whole module, so the last test can assert what it does NOT export.
import * as meta from '../series-meta'

const base: SeriesMeta = {
  symbol: 'AAPL',
  last: 100,
  previous: 80,
  lastBarTime: 1_760_000_000,
  observedAt: 1_760_000_000,
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

describe('freshness says how old the DATA is, coarsely', () => {
  const now = 1_760_000_000_000 // ms

  it('an answer from a minute ago is now', () => {
    expect(freshnessLabel(now / 1000 - 30, now)).toBe('just now')
  })

  it('minutes, hours and days each get their own shape', () => {
    expect(freshnessLabel(now / 1000 - 600, now)).toBe('10m ago')
    expect(freshnessLabel(now / 1000 - 7200, now)).toBe('2h ago')
    expect(freshnessLabel(now / 1000 - 86_400, now)).toBe('1 day ago')
    expect(freshnessLabel(now / 1000 - 86_400 * 4, now)).toBe('4 days ago')
  })

  it('a missing observation is reported as missing, not as fresh', () => {
    /* The dangerous default: treating null as 0 seconds old, which labels a
       series with no data "just now". */
    expect(freshnessLabel(null, now)).toBe('no data')
    expect(freshnessLabel(Number.NaN, now)).toBe('no data')
  })

  it('an unobserved series (0) is not the epoch, it is unknown', () => {
    /*
     * `getChartDataResult` returns `observedAt: 0` when nothing was observed.
     * Taken as a timestamp that is 1 January 1970, and the header would have
     * announced the chart as about twenty thousand days old rather than
     * saying it does not know.
     */
    expect(freshnessLabel(0, now)).toBe('no data')
  })

  it('an answer timestamped in the future does not read as negative', () => {
    expect(freshnessLabel(now / 1000 + 600, now)).toBe('just now')
  })
})

describe('freshness is NOT read off the last bar', () => {
  /*
   * THE DEFECT THIS PINS.
   *
   * The header took `meta.lastBarTime`, and a bar is stamped at the START of
   * the period it covers. On a monthly series the newest bar carries the
   * first of the month, so on the 19th a perfectly current chart announced
   * itself as "18 days ago" -- and the error grew with the bar size, which
   * is backwards: a coarse interval is the one a reader can least check by
   * eye.
   *
   * These two cases are the same instant in the same series. Only the
   * argument differs, and that is the whole fix.
   */
  const nowMs = Date.parse('2026-11-19T15:00:00Z')
  const monthlyBarOpensAt = Date.parse('2026-11-01T00:00:00Z') / 1000
  const providerAnsweredAt = Date.parse('2026-11-19T14:59:00Z') / 1000

  it('the monthly bucket boundary is the figure that read 18 days old', () => {
    // Not an assertion about what the header SHOULD say -- it is the proof
    // that the old argument produced the reported label.
    expect(freshnessLabel(monthlyBarOpensAt, nowMs)).toBe('18 days ago')
  })

  it('the observation time says the chart is current, which it is', () => {
    expect(freshnessLabel(providerAnsweredAt, nowMs)).toBe('just now')
  })

  it('a cached answer still reads as old, so staleness is not hidden', () => {
    /*
     * The other half. Stamping a cache hit `Date.now()` would make every
     * stale series look new -- the opposite failure, and the one that
     * actually costs money.
     */
    const observedTwoHoursAgo = nowMs / 1000 - 7200
    expect(freshnessLabel(observedTwoHoursAgo, nowMs)).toBe('2h ago')
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

  it('an unknown basis is flagged to the reader just as raw is', () => {
    // So answering 'unknown' when nothing can be measured costs the reader
    // nothing: an unmeasurable series is warned about either way.
    expect(adjustmentIsHazardous('unknown')).toBe(true)
  })

  it('this module does not decide the basis from a provider’s name', () => {
    /*
     * ── The defect this guards ─────────────────────────────────────────
     *
     * This module used to export `adjustmentForProvider`, mapping a feed's
     * NAME to a basis. It returned 'raw' for yahoo. Yahoo's chart series is
     * split-adjusted -- measured against the live endpoint on 2026-11-18,
     * AAPL's closes run 23.06 to 23.42 straight through a 7:1 split -- so
     * the header warned "raw prices · not split-adjusted" over an adjusted
     * series, and the feed that IS raw was described identically.
     *
     * The basis now arrives on the series, measured from the provider's
     * published corporate actions. A name cannot be evidence, so nothing
     * here may turn one into a basis again.
     */
    const exported = Object.keys(meta)
    expect(exported).not.toContain('adjustmentForProvider')
    for (const name of exported) {
      expect(name, `${name} looks like a provider-to-basis table`)
        .not.toMatch(/ForProvider$|ByProvider$/)
    }
  })
})
