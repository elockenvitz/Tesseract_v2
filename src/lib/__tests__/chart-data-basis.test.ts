/**
 * What basis the chart's series actually arrives on, end to end.
 *
 * The unit tests in `market-data/__tests__/price-adjustment.test.ts` prove
 * the arithmetic. These prove the arithmetic is WIRED: that a raw Yahoo
 * payload reaches a caller adjusted, that an adjusted one is left alone, and
 * that the basis a caller is handed describes the candles it is handed
 * beside it.
 *
 * Driven through the real `chartDataService`, with only the transport
 * mocked, because the defect this guards is a path that forgets to apply or
 * forgets to report -- and a test of the pure function cannot see either.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

/** The one thing mocked: the edge-function call. */
const invoke = vi.fn()
vi.mock('../supabase', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }))

/** EODHD's transport, for the one test that needs that branch. */
const eodhdBars = vi.fn()
vi.mock('../market-data/eodhd-client', () => ({ eodhdBars: (...a: unknown[]) => eodhdBars(...a) }))
vi.mock('../market-data/eodhd-symbol', () => ({
  resolveEodhdSymbol: async () => ({ ok: true, symbol: 'AAPL.US' }),
}))

const { chartDataService } = await import('../chartData')

/** AAPL's 7:1, as Yahoo files it: keyed by bucket, dated by event. */
const SPLIT_7_1 = { date: 1402320600, numerator: 7, denominator: 1, splitRatio: '7:1' }

const at = (date: string) => Math.floor(Date.parse(`${date}T13:30:00Z`) / 1000)

/**
 * A Yahoo chart payload in the live shape.
 *
 * `closes` are given in the order of `dates`; open/high/low are derived from
 * the close so each candle is well formed whatever basis it is on.
 */
function yahooPayload(dates: string[], closes: number[], splits?: Record<string, unknown>) {
  return {
    chart: {
      result: [{
        timestamp: dates.map(at),
        events: splits ? { splits } : undefined,
        indicators: {
          quote: [{
            open: closes.map(c => c * 0.995),
            high: closes.map(c => c * 1.01),
            low: closes.map(c => c * 0.99),
            close: closes,
            volume: closes.map(() => 1_000_000),
          }],
          // Present and deliberately ignored: an adjusted close is adjusted
          // for dividends too, so it cannot be paired with a raw open.
          adjclose: [{ adjclose: closes.map(c => c * 0.88) }],
        },
      }],
    },
  }
}

beforeEach(() => {
  invoke.mockReset()
  eodhdBars.mockReset()
  chartDataService.clearCache()
})

describe('a raw series reaching the chart', () => {
  /** AAPL's real published closes across the 7:1, unadjusted. */
  const dates = ['2014-06-05', '2014-06-06', '2014-06-09', '2014-06-10']
  const rawCloses = [647.35, 645.57, 93.7, 94.25]

  it('is adjusted before the caller sees it, so the split is not drawn as a collapse', async () => {
    invoke.mockResolvedValue({ data: yahooPayload(dates, rawCloses, { '1401595200': SPLIT_7_1 }), error: null })

    const result = await chartDataService.getChartDataResult({ symbol: 'AAPL', interval: '1d', range: '1y' })

    expect(result.candles).toHaveLength(4)
    // The step across the boundary is an ordinary day's move, not a 7x fall.
    const step = result.candles[2].close / result.candles[1].close
    expect(step).toBeGreaterThan(0.95)
    expect(step).toBeLessThan(1.05)
    // And the pre-split bars are restated in current shares.
    expect(result.candles[1].close).toBeCloseTo(645.57 / 7, 6)
    expect(result.candles[3].close).toBeCloseTo(94.25, 6)
  })

  it('says what it did, rather than reporting the basis it received', async () => {
    invoke.mockResolvedValue({ data: yahooPayload(dates, rawCloses, { '1401595200': SPLIT_7_1 }), error: null })

    const { basis } = await chartDataService.getChartDataResult({ symbol: 'AAPL', interval: '1d', range: '1y' })

    expect(basis.basis).toBe('split_adjusted')
    expect(basis.adjustedHere).toBe(true)
    expect(basis.splits.map(s => s.ratio)).toEqual(['7:1'])
    expect(basis.evidence).toContain('7:1')
  })

  it('keeps every candle well formed through the adjustment', async () => {
    invoke.mockResolvedValue({ data: yahooPayload(dates, rawCloses, { '1401595200': SPLIT_7_1 }), error: null })

    const { candles } = await chartDataService.getChartDataResult({ symbol: 'AAPL', interval: '1d', range: '1y' })
    for (const c of candles) {
      expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close))
      expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close))
    }
  })

  it('multiplies volume, so the volume pane does not inherit the cliff', async () => {
    invoke.mockResolvedValue({ data: yahooPayload(dates, rawCloses, { '1401595200': SPLIT_7_1 }), error: null })

    const { candles } = await chartDataService.getChartDataResult({ symbol: 'AAPL', interval: '1d', range: '1y' })
    expect(candles[1].volume).toBe(7_000_000)
    expect(candles[2].volume).toBe(1_000_000)
  })
})

describe('the series Yahoo actually sends', () => {
  /*
   * Captured from the live endpoint on 2026-11-18. Continuous through the
   * 7:1, which is why the provider table that called Yahoo 'raw' was wrong
   * and why this is measured rather than looked up.
   */
  const dates = ['2014-06-06', '2014-06-09']
  const delivered = [23.06, 23.42]

  it('is reported split-adjusted and left exactly as it arrived', async () => {
    invoke.mockResolvedValue({ data: yahooPayload(dates, delivered, { '1401595200': SPLIT_7_1 }), error: null })

    const { candles, basis } = await chartDataService.getChartDataResult({
      symbol: 'AAPL', interval: '1d', range: '1y',
    })

    expect(basis.basis).toBe('split_adjusted')
    expect(basis.adjustedHere).toBe(false)
    // Untouched: adjusting an already-adjusted series would divide it twice
    // and invent a collapse where there was none.
    expect(candles.map(c => c.close)).toEqual([23.06, 23.42])
  })
})

describe('a window with no corporate action in it', () => {
  it('is reported split-adjusted on the measured provider default, and says so', async () => {
    invoke.mockResolvedValue({ data: yahooPayload(['2026-11-16', '2026-11-17'], [350, 351]), error: null })

    const { basis, candles } = await chartDataService.getChartDataResult({
      symbol: 'AAPL', interval: '1d', range: '1mo',
    })

    expect(basis.basis).toBe('split_adjusted')
    expect(basis.splits).toEqual([])
    // The evidence names the fallback as a fallback, so nothing reads as a
    // measurement that was not taken.
    expect(basis.evidence).toContain('no split in this window')
    expect(candles.map(c => c.close)).toEqual([350, 351])
  })
})

describe('a series that never arrived', () => {
  it('has an unknown basis, not a provider default', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'upstream down' } })

    const { candles, basis } = await chartDataService.getChartDataResult({
      symbol: 'AAPL', interval: '1d', range: '1mo',
    })

    expect(candles).toEqual([])
    // 'unknown' is flagged to the reader; a cheerful 'split_adjusted' on an
    // empty chart would be a claim about data that does not exist.
    expect(basis.basis).toBe('unknown')
  })
})

describe('the cached answer', () => {
  it('carries the basis that was measured from it', async () => {
    /*
     * The basis is cached WITH the candles. Recomputing it on a hit, or
     * defaulting it, would let a cached series be described by a basis that
     * was never measured from it -- and a cache hit is the common case.
     */
    invoke.mockResolvedValue({
      data: yahooPayload(['2014-06-06', '2014-06-09'], [645.57, 93.7], { '1401595200': SPLIT_7_1 }),
      error: null,
    })

    const first = await chartDataService.getChartDataResult({ symbol: 'AAPL', interval: '1d', range: '1y' })
    invoke.mockReset() // A second request must not reach the transport.
    const second = await chartDataService.getChartDataResult({ symbol: 'AAPL', interval: '1d', range: '1y' })

    expect(invoke).not.toHaveBeenCalled()
    expect(second.basis).toEqual(first.basis)
    expect(second.basis.basis).toBe('split_adjusted')
    expect(second.candles.map(c => c.close)).toEqual(first.candles.map(c => c.close))
  })
})

describe('EODHD', () => {
  it('is reported raw and flagged, because no adjustment can be applied to it', async () => {
    /*
     * `supabase/functions/_shared/eodhd.ts` maps the RAW close and forwards
     * no corporate actions, so the browser has neither an adjusted series
     * nor the factors to build one. Stated as raw rather than relabelled:
     * `adjustmentIsHazardous('raw')` is what makes the header warn.
     *
     * Lifting this needs the edge function to forward the ratios or
     * `adjusted_close`, which is a deploy and a separate approved change.
     */
    eodhdBars.mockResolvedValue({
      ok: true,
      data: { value: [
        { date: '2014-06-06', open: 649.9, high: 651, low: 644.5, close: 645.57, volume: 49_900_000 },
        { date: '2014-06-09', open: 92.7, high: 93.88, low: 91.75, close: 93.7, volume: 301_660_000 },
      ] },
    })

    const { candles, basis } = await chartDataService.getChartDataResult({
      symbol: 'AAPL', interval: '1d', range: '1y', provider: 'eodhd',
    })

    expect(candles).toHaveLength(2)
    expect(basis.basis).toBe('raw')
    expect(basis.adjustedHere).toBe(false)
    // Untouched: inventing a factor for a feed that published none is the
    // fabrication this must never do.
    expect(candles.map(c => c.close)).toEqual([645.57, 93.7])
    expect(basis.evidence).toContain('no corporate actions')
  })

  it('is never handed Yahoo’s split factors, because the bases are not comparable', async () => {
    /*
     * The tempting shortcut: EODHD has no ratios, Yahoo does, so borrow
     * them. It would mean a series whose prices come from one feed and whose
     * corporate actions come from another, with the provenance badge naming
     * only the first. The two feeds also differ on venue and currency.
     */
    eodhdBars.mockResolvedValue({
      ok: true,
      data: { value: [{ date: '2014-06-06', open: 649.9, high: 651, low: 644.5, close: 645.57, volume: 1 }] },
    })

    const { basis } = await chartDataService.getChartDataResult({
      symbol: 'AAPL', interval: '1d', range: '1y', provider: 'eodhd',
    })

    expect(basis.splits).toEqual([])
    expect(invoke).not.toHaveBeenCalled()
  })
})
