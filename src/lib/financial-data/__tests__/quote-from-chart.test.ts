import { describe, it, expect } from 'vitest'

import { financialDataService } from '../browser-client'

/**
 * Yahoo pads the in-progress trading day with a null close.
 *
 * ── The defect, as observed in the running app ────────────────────────────
 *
 * `quoteFromChart` read `prices[prices.length - 1]`. During an open session
 * that element is `null` — the current day's bar has not settled — so
 * `Number.isFinite(null)` was false and the parser returned null for a payload
 * that states the live price on the line above:
 *
 *   close: [262.07, 261.06, 260.28, 256.26, null]
 *   meta.regularMarketPrice: 266.43
 *
 * Every symbol reaching the Yahoo path during market hours got no quote. Since
 * `getQuote` tries Alpha Vantage first and its free tier answers only a couple
 * of symbols before rate-limiting the rest, whichever names won that race got a
 * card and the rest were suppressed `quote_unavailable`. That is why Case vs
 * Price appeared once and then never again, and why Review Cases — which needs
 * no quote — kept working the whole time.
 *
 * Traced end to end before the fix:
 *   AMZN av-try -> av-null -> yahoo-try -> Y-http200
 *        -> price=266.43 time=1787947201 ind=true -> Y-parsed-NULL -> ALL-NULL
 */

/** The parser is private; this is the seam the app actually calls through. */
const parse = (data: unknown) =>
  (financialDataService as unknown as {
    quoteFromChart(symbol: string, data: unknown): { price: number; timestamp: string } | null
  }).quoteFromChart('AMZN', data)

const chart = (o: {
  close: (number | null)[]
  regularMarketPrice?: number | null
  regularMarketTime?: number | null
}) => ({
  chart: {
    result: [{
      meta: {
        symbol: 'AMZN',
        regularMarketPrice: o.regularMarketPrice,
        regularMarketTime: 'regularMarketTime' in o ? o.regularMarketTime : 1787947201,
        previousClose: 256.26,
      },
      indicators: {
        quote: [{
          close: o.close,
          open: o.close, high: o.close, low: o.close,
        }],
      },
    }],
  },
})

/** The exact payload captured from the running preview. */
const OBSERVED = chart({
  close: [262.07000732421875, 261.05999755859375, 260.2799987792969, 256.260009765625, null],
  regularMarketPrice: 266.43,
})

describe('a padded final bar does not lose the quote', () => {
  /** THE regression. */
  it('reads the live price when the last close is null', () => {
    const q = parse(OBSERVED)
    expect(q).not.toBeNull()
    expect(q!.price).toBe(266.43)
  })

  it('timestamps it with regularMarketTime, which is what that price is', () => {
    expect(parse(OBSERVED)!.timestamp).toBe(new Date(1787947201 * 1000).toISOString())
  })

  /** A settled session: the live price still wins, and they agree anyway. */
  it('still resolves when every bar is present', () => {
    const q = parse(chart({ close: [262.07, 261.06, 260.28, 256.26], regularMarketPrice: 256.26 }))
    expect(q!.price).toBe(256.26)
  })

  /**
   * Falls back to the last FINITE close, never a blind index into the tail.
   * A payload with no `regularMarketPrice` used to work by accident whenever
   * the final bar happened to be settled.
   */
  it('falls back to the last finite close when no live price is quoted', () => {
    const q = parse(chart({ close: [262.07, 261.06, 260.28, 256.26, null], regularMarketPrice: null }))
    expect(q!.price).toBe(256.26)
  })

  it('skips several trailing nulls, not just one', () => {
    const q = parse(chart({ close: [262.07, 256.26, null, null], regularMarketPrice: null }))
    expect(q!.price).toBe(256.26)
  })

  /** A genuinely unusable payload must still be null — never a made-up price. */
  it('returns null when there is no usable price at all', () => {
    expect(parse(chart({ close: [null, null], regularMarketPrice: null }))).toBeNull()
    expect(parse(chart({ close: [], regularMarketPrice: null }))).toBeNull()
    expect(parse(chart({ close: [100], regularMarketPrice: 0 }))).not.toBeNull()
    expect(parse(chart({ close: [0], regularMarketPrice: null }))).toBeNull()
  })

  it('returns null without a market time, so nothing is dated by guess', () => {
    expect(parse(chart({ close: [256.26], regularMarketPrice: 266.43, regularMarketTime: null })))
      .toBeNull()
  })

  it('returns null on a malformed payload', () => {
    expect(parse({})).toBeNull()
    expect(parse({ chart: { result: [] } })).toBeNull()
    expect(parse({ chart: { result: [{ meta: {} }] } })).toBeNull()
  })
})
