/**
 * Corporate-action adjustment.
 *
 * The factors and dates here are AAPL's real ones, and the payload shape is
 * the live one -- captured from
 * `query1.finance.yahoo.com/v8/finance/chart/AAPL?events=div|split` on
 * 2026-11-18, which is the same URL `yahoo-chart-proxy` builds.
 */
import { describe, it, expect } from 'vitest'
import {
  applySplitAdjustment,
  barDate,
  cumulativeSplitFactor,
  detectSplitBasis,
  parseYahooSplits,
  type AdjustableBar,
  type SplitEvent,
} from '../price-adjustment'

/** AAPL's splits, as Yahoo publishes them. */
const AAPL_SPLITS: SplitEvent[] = [
  { date: '1987-06-16', factor: 2, ratio: '2:1' },
  { date: '2000-06-21', factor: 2, ratio: '2:1' },
  { date: '2005-02-28', factor: 2, ratio: '2:1' },
  { date: '2014-06-09', factor: 7, ratio: '7:1' },
  { date: '2020-08-31', factor: 4, ratio: '4:1' },
]

const bar = (time: string, o: number, h: number, l: number, c: number, v = 1_000_000): AdjustableBar =>
  ({ time, open: o, high: h, low: l, close: c, volume: v })

describe('reading a bar’s date', () => {
  it('takes a daily bar’s own calendar date', () => {
    expect(barDate('2014-06-09')).toBe('2014-06-09')
  })

  it('reads an intraday bar’s unix seconds in UTC', () => {
    // The daily form IS a UTC date, so the intraday form is read the same way
    // rather than in the host zone. Formatting a bar in the host zone is the
    // defect already fixed in lib/charting/bar-format.ts.
    expect(barDate(String(Math.floor(Date.UTC(2014, 5, 9, 13, 30) / 1000)))).toBe('2014-06-09')
  })

  it('refuses a time it cannot read, rather than guessing one', () => {
    expect(barDate('')).toBeNull()
    expect(barDate('not-a-time')).toBeNull()
    expect(barDate('0')).toBeNull()
    expect(barDate('-5')).toBeNull()
  })
})

describe('parsing Yahoo’s split events', () => {
  /** The live payload's exact shape, with the key and `date` deliberately
      different -- which is how Yahoo sends it on a monthly series. */
  const payload = {
    chart: {
      result: [{
        events: {
          splits: {
            '1401595200': { date: 1402320600, numerator: 7, denominator: 1, splitRatio: '7:1' },
            '1590984000': { date: 1598880600, numerator: 4, denominator: 1, splitRatio: '4:1' },
          },
        },
      }],
    },
  }

  it('reads the real ratios and ex-dates', () => {
    const splits = parseYahooSplits(payload)
    expect(splits).toEqual([
      { date: '2014-06-09', factor: 7, ratio: '7:1' },
      { date: '2020-08-31', factor: 4, ratio: '4:1' },
    ])
  })

  it('takes the event’s own date, not the bucket key it is filed under', () => {
    /*
     * On a monthly series Yahoo files the 7:1 under 1401595200, which is
     * 2014-06-01, while the split took effect on the 9th. Keying off the
     * bucket would treat the first six sessions of June as pre-split and
     * divide them by seven -- replacing one cliff with another.
     */
    const [first] = parseYahooSplits(payload)
    expect(first.date).toBe('2014-06-09')
    expect(first.date).not.toBe('2014-06-01')
  })

  it('reports no splits for a payload that carries none', () => {
    expect(parseYahooSplits({ chart: { result: [{ events: { dividends: {} } }] } })).toEqual([])
    expect(parseYahooSplits({ chart: { result: [{}] } })).toEqual([])
    expect(parseYahooSplits({})).toEqual([])
    expect(parseYahooSplits(null)).toEqual([])
  })

  it('drops an unusable row instead of defaulting it to a no-op factor', () => {
    // A factor of 1 adjusts nothing while claiming a split was handled.
    const splits = parseYahooSplits({
      chart: { result: [{ events: { splits: {
        a: { date: 1402320600, numerator: 0, denominator: 1 },
        b: { date: 1402320600, numerator: 7, denominator: 0 },
        c: { date: 0, numerator: 7, denominator: 1 },
        d: { date: 1402320600, numerator: 1, denominator: 1 },
        e: { date: 1402320600, numerator: 'x', denominator: 1 },
      } } }] },
    })
    expect(splits).toEqual([])
  })

  it('keeps a reverse split, which is a real event with a factor below one', () => {
    const [split] = parseYahooSplits({
      chart: { result: [{ events: { splits: {
        a: { date: 1402320600, numerator: 1, denominator: 10, splitRatio: '1:10' },
      } } }] },
    })
    expect(split.factor).toBeCloseTo(0.1, 10)
    expect(split.ratio).toBe('1:10')
  })

  it('returns them in date order whatever order they arrived in', () => {
    const splits = parseYahooSplits({
      chart: { result: [{ events: { splits: {
        later: { date: 1598880600, numerator: 4, denominator: 1 },
        earlier: { date: 1402320600, numerator: 7, denominator: 1 },
      } } }] },
    })
    expect(splits.map(s => s.date)).toEqual(['2014-06-09', '2020-08-31'])
  })
})

describe('the cumulative factor', () => {
  it('compounds every split after the bar', () => {
    // A 2012 bar is seven then four times restated: 28.
    expect(cumulativeSplitFactor(AAPL_SPLITS, '2012-01-03')).toBe(28)
    // Between the two: four only.
    expect(cumulativeSplitFactor(AAPL_SPLITS, '2016-01-04')).toBe(4)
    // After both: itself.
    expect(cumulativeSplitFactor(AAPL_SPLITS, '2026-11-18')).toBe(1)
  })

  it('leaves the ex-date’s own session alone', () => {
    /*
     * The ex-date is already quoted post-split. Including it would divide
     * the first post-split bar a second time, planting a fresh cliff one
     * session after the one being removed -- the same defect, moved.
     */
    expect(cumulativeSplitFactor(AAPL_SPLITS, '2014-06-09')).toBe(4)
    expect(cumulativeSplitFactor(AAPL_SPLITS, '2014-06-06')).toBe(28)
  })

  it('is 1 when there are no splits', () => {
    expect(cumulativeSplitFactor([], '2014-06-06')).toBe(1)
  })
})

describe('adjusting a series', () => {
  /** AAPL's real closes across the 7:1, as published unadjusted. */
  const rawAcross2014: AdjustableBar[] = [
    bar('2014-06-05', 647.0, 648.1, 645.0, 647.35, 43_400_000),
    bar('2014-06-06', 649.9, 651.0, 644.5, 645.57, 49_900_000),
    bar('2014-06-09', 92.7, 93.88, 91.75, 93.7, 301_660_000),
    bar('2014-06-10', 94.73, 95.05, 93.57, 94.25, 251_108_000),
  ]

  it('removes the cliff a split draws', () => {
    const splits = AAPL_SPLITS.filter(s => s.date === '2014-06-09')
    const adjusted = applySplitAdjustment(rawAcross2014, splits)

    // Before: the close drops 85% in one session.
    expect(rawAcross2014[2].close / rawAcross2014[1].close).toBeLessThan(0.2)
    // After: an ordinary day's move.
    const step = adjusted[2].close / adjusted[1].close
    expect(step).toBeGreaterThan(0.95)
    expect(step).toBeLessThan(1.05)
  })

  it('divides open, high, low and close by the same factor', () => {
    const adjusted = applySplitAdjustment(rawAcross2014, [AAPL_SPLITS[3]])
    const before = rawAcross2014[1]
    const after = adjusted[1]
    expect(after.open).toBeCloseTo(before.open / 7, 10)
    expect(after.high).toBeCloseTo(before.high / 7, 10)
    expect(after.low).toBeCloseTo(before.low / 7, 10)
    expect(after.close).toBeCloseTo(before.close / 7, 10)
  })

  it('keeps every candle well formed, which the adjusted-close shortcut does not', () => {
    /*
     * This is the assertion that rules out the tempting shortcut. Putting a
     * provider's adjusted close into `close` and leaving the open, high and
     * low as published would give each pre-split bar a close at a seventh of
     * its own low -- a candle that cannot be drawn and cannot be read.
     */
    const adjusted = applySplitAdjustment(rawAcross2014, [AAPL_SPLITS[3]])
    for (const candle of adjusted) {
      expect(candle.low).toBeLessThanOrEqual(candle.close)
      expect(candle.close).toBeLessThanOrEqual(candle.high)
      expect(candle.low).toBeLessThanOrEqual(candle.open)
      expect(candle.open).toBeLessThanOrEqual(candle.high)
    }
  })

  it('multiplies volume, because a split creates shares', () => {
    /*
     * Seven times the shares exist, so a pre-split million is seven million
     * in today's terms. Leaving volume alone would redraw the price cliff in
     * the volume pane.
     */
    const adjusted = applySplitAdjustment(rawAcross2014, [AAPL_SPLITS[3]])
    expect(adjusted[1].volume).toBe(49_900_000 * 7)
    expect(adjusted[2].volume).toBe(301_660_000)
  })

  it('compounds across two splits, so the oldest bar is restated once', () => {
    const series = [bar('2012-01-03', 409.4, 412.5, 409.0, 411.23), bar('2026-11-17', 350, 352, 349, 351)]
    const adjusted = applySplitAdjustment(series, AAPL_SPLITS)
    expect(adjusted[0].close).toBeCloseTo(411.23 / 28, 10)
    expect(adjusted[1].close).toBe(351)
  })

  it('returns the series unchanged when the provider published no splits', () => {
    const adjusted = applySplitAdjustment(rawAcross2014, [])
    expect(adjusted).toEqual(rawAcross2014)
  })

  it('leaves a bar it cannot date alone rather than adjusting it by a guess', () => {
    const adjusted = applySplitAdjustment([bar('nonsense', 10, 11, 9, 10.5)], AAPL_SPLITS)
    expect(adjusted[0].close).toBe(10.5)
  })

  it('preserves order and length', () => {
    const adjusted = applySplitAdjustment(rawAcross2014, AAPL_SPLITS)
    expect(adjusted).toHaveLength(rawAcross2014.length)
    expect(adjusted.map(b => b.time)).toEqual(rawAcross2014.map(b => b.time))
  })

  it('adjusts an intraday bar by its UTC date too', () => {
    const t = (y: number, m: number, d: number) => String(Math.floor(Date.UTC(y, m, d, 14, 30) / 1000))
    const adjusted = applySplitAdjustment(
      [bar(t(2014, 5, 6), 649.9, 651, 644.5, 645.57), bar(t(2014, 5, 9), 92.7, 93.88, 91.75, 93.7)],
      [AAPL_SPLITS[3]],
    )
    expect(adjusted[0].close).toBeCloseTo(645.57 / 7, 10)
    expect(adjusted[1].close).toBe(93.7)
  })
})

describe('measuring which basis a series arrived on', () => {
  /** AAPL's real published closes, unadjusted, across the 7:1. */
  const raw = [
    bar('2014-06-06', 649.9, 651.0, 644.5, 645.57),
    bar('2014-06-09', 92.7, 93.88, 91.75, 93.7),
  ]

  /**
   * AAPL's real closes as Yahoo's chart endpoint actually delivers them,
   * captured 2026-11-18. Continuous straight through the split, which is
   * what makes the provider table that called Yahoo `raw` wrong.
   */
  const yahooDelivered = [
    bar('2014-06-06', 23.21, 23.26, 23.02, 23.06),
    bar('2014-06-09', 23.17, 23.47, 22.94, 23.42),
  ]

  it('calls a series with the cliff in it raw', () => {
    const reading = detectSplitBasis(raw, [AAPL_SPLITS[3]])
    expect(reading.basis).toBe('raw')
    expect(reading.across?.ratio).toBe('7:1')
  })

  it('calls the series Yahoo actually sends split-adjusted', () => {
    /*
     * The finding this function exists for. `adjustmentForProvider` returned
     * 'raw' for yahoo, so the header told every reader "raw prices · not
     * split-adjusted" above a series that is adjusted. Measured against the
     * live payload: 23.06 to 23.42 straight through a 7:1.
     */
    expect(detectSplitBasis(yahooDelivered, [AAPL_SPLITS[3]]).basis).toBe('split_adjusted')
  })

  it('is not fooled by an ordinary bad day at the boundary', () => {
    // A 9% fall on the ex-date is nothing like a 7x step.
    const gapped = [bar('2014-06-06', 23.2, 23.3, 23.0, 23.06), bar('2014-06-09', 21.5, 21.6, 20.9, 21.0)]
    expect(detectSplitBasis(gapped, [AAPL_SPLITS[3]]).basis).toBe('split_adjusted')
  })

  it('measures across the largest split available', () => {
    const reading = detectSplitBasis(
      [bar('2014-06-06', 649.9, 651, 644.5, 645.57), bar('2020-09-01', 132.76, 134.8, 130.5, 134.18)],
      AAPL_SPLITS,
    )
    expect(reading.across?.ratio).toBe('7:1')
  })

  it('says unknown rather than guessing when there is nothing to measure', () => {
    /*
     * Each of these is a window the measurement cannot see a boundary in.
     * 'unknown' is flagged to the reader exactly as 'raw' is, so an
     * unmeasurable series is never quietly presented as a safe one.
     */
    expect(detectSplitBasis(raw, []).basis).toBe('unknown')
    // Only bars after the split: no 'before' side.
    expect(detectSplitBasis([bar('2020-09-01', 132, 134, 130, 134)], [AAPL_SPLITS[3]]).basis).toBe('unknown')
    // Only bars before it: no 'after' side.
    expect(detectSplitBasis([bar('2014-06-06', 649, 651, 644, 645)], [AAPL_SPLITS[3]]).basis).toBe('unknown')
    expect(detectSplitBasis([], AAPL_SPLITS).basis).toBe('unknown')
  })

  it('refuses to read a split too small to separate from a day’s move', () => {
    const tiny: SplitEvent = { date: '2014-06-09', factor: 1.1, ratio: '11:10' }
    expect(detectSplitBasis(raw, [tiny]).basis).toBe('unknown')
  })

  it('ignores a bar with no usable close when picking the boundary pair', () => {
    const withHole = [
      bar('2014-06-05', 647, 648, 645, 0),
      bar('2014-06-06', 649.9, 651.0, 644.5, 645.57),
      bar('2014-06-09', 92.7, 93.88, 91.75, 93.7),
    ]
    expect(detectSplitBasis(withHole, [AAPL_SPLITS[3]]).basis).toBe('raw')
  })

  it('states what it measured, so the conclusion can be checked', () => {
    const reading = detectSplitBasis(raw, [AAPL_SPLITS[3]])
    expect(reading.evidence).toContain('7:1')
    expect(reading.evidence).toContain('2014-06-09')
  })
})

describe('adjusting a series the measurement called raw', () => {
  it('turns the cliff into a continuous series the measurement then accepts', () => {
    /*
     * End to end: a raw series is measured raw, adjusted, and measured again.
     * The second reading must be split_adjusted -- otherwise the adjustment
     * did not do what the label after it would claim.
     */
    const splits = [AAPL_SPLITS[3]]
    const raw = [
      bar('2014-06-06', 649.9, 651.0, 644.5, 645.57),
      bar('2014-06-09', 92.7, 93.88, 91.75, 93.7),
    ]
    expect(detectSplitBasis(raw, splits).basis).toBe('raw')
    expect(detectSplitBasis(applySplitAdjustment(raw, splits), splits).basis).toBe('split_adjusted')
  })
})
