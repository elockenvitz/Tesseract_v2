import { describe, it, expect } from 'vitest'

import { deriveChange, financialDataService, type Quote } from '../browser-client'

/**
 * The product showed `+0.00%` on every row, and it was never the failure path.
 *
 * ── What was actually wrong ───────────────────────────────────────────────
 *
 * `getQuote` has returned null correctly since `createPlaceholderQuote` was
 * deleted, and `quote-unavailable.test.ts` proves it. The zeros came from a
 * SUCCESSFUL parse: `quoteFromChart` read `meta.previousClose`, but the
 * request it parses asks for `range=5d&interval=1d`, and on a daily interval
 * Yahoo's chart meta carries `chartPreviousClose`. The field was permanently
 * undefined, `|| currentPrice` made the previous close equal the price, and
 * the derived change was exactly 0 — with a real price and an honest
 * timestamp, so no freshness or null guard downstream could catch it.
 *
 * The repo already knew the right field name in another lane:
 * `usePriceHistory.ts` parses the same payload and reads `chartPreviousClose`.
 *
 * ── What these tests pin ──────────────────────────────────────────────────
 *
 * 1. the daily field is read, so a real change comes out;
 * 2. no previous close yields NULL, never 0;
 * 3. a genuine flat day still yields 0, because that is a measurement;
 * 4. a zero or negative previous close is refused rather than divided by.
 *
 * `quote-from-chart.test.ts` covers the padded-bar defect and deliberately
 * hard-codes a `previousClose` into every fixture — which is exactly why this
 * one was never caught there.
 */

/** The parser is private; this is the seam the app actually calls through. */
const parse = (data: unknown) =>
  (financialDataService as unknown as {
    quoteFromChart(symbol: string, data: unknown): Quote | null
  }).quoteFromChart('AMZN', data)

/** A Yahoo daily payload, with whichever previous-close fields are given. */
const daily = (meta: Record<string, unknown>) => ({
  chart: {
    result: [{
      meta: {
        symbol: 'AMZN',
        regularMarketPrice: 266.43,
        regularMarketTime: 1787947201,
        ...meta,
      },
      indicators: { quote: [{ close: [260, 262, 264], open: [1, 2, 3], high: [1, 2, 3], low: [1, 2, 3] }] },
    }],
  },
})

describe('deriveChange is the one rule all three providers use', () => {
  it('computes the move when the previous close is known', () => {
    const d = deriveChange(110, 100)
    expect(d.previousClose).toBe(100)
    expect(d.change).toBeCloseTo(10, 10)
    expect(d.changePercent).toBeCloseTo(10, 10)
  })

  it('reports a genuine flat day as zero, because that IS the measurement', () => {
    const d = deriveChange(100, 100)
    expect(d.change).toBe(0)
    expect(d.changePercent).toBe(0)
    expect(d.previousClose).toBe(100)
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty string', ''],
    ['a non-numeric string', 'n/a'],
    ['NaN', NaN],
  ])('returns null, never zero, when the previous close is %s', (_label, prev) => {
    const d = deriveChange(266.43, prev)
    expect(d.change).toBeNull()
    expect(d.changePercent).toBeNull()
    expect(d.previousClose).toBeNull()
  })

  it('refuses a zero or negative previous close rather than dividing by it', () => {
    // 0 is not a price. `|| currentPrice` used to swallow this case, and the
    // alternative — dividing — turns a provider gap into an infinite return.
    for (const prev of [0, -1]) {
      const d = deriveChange(266.43, prev)
      expect(d.changePercent).toBeNull()
      expect(d.previousClose).toBeNull()
    }
  })
})

describe('the Yahoo daily payload is parsed with the field it actually sends', () => {
  /** THE regression. This fails against the old `meta.previousClose` read. */
  it('reads chartPreviousClose and produces a real change', () => {
    const q = parse(daily({ chartPreviousClose: 256.26 }))
    expect(q).not.toBeNull()
    expect(q!.previousClose).toBe(256.26)
    expect(q!.change).toBeCloseTo(266.43 - 256.26, 6)
    expect(q!.changePercent).toBeGreaterThan(3)
  })

  it('still honours previousClose when a payload carries that instead', () => {
    // Intraday ranges do send `previousClose`. Supporting both is why the
    // read is `??` over two fields rather than a swap of one for the other.
    const q = parse(daily({ previousClose: 250 }))
    expect(q!.previousClose).toBe(250)
    expect(q!.changePercent).toBeGreaterThan(6)
  })

  it('prefers chartPreviousClose when a payload carries both', () => {
    const q = parse(daily({ chartPreviousClose: 256.26, previousClose: 250 }))
    expect(q!.previousClose).toBe(256.26)
  })

  it('yields a quote with a price and a NULL change when neither is present', () => {
    /*
     * The shape the whole product was rendering as `+0.00%`. The quote is
     * still returned — the price is real and worth showing — but it makes no
     * claim about a move it cannot compute.
     */
    const q = parse(daily({}))
    expect(q).not.toBeNull()
    expect(q!.price).toBe(266.43)
    expect(q!.change).toBeNull()
    expect(q!.changePercent).toBeNull()
    expect(q!.previousClose).toBeNull()
  })

  it('never reports previousClose equal to price, which was the tell', () => {
    // `previousClose === price` with `changePercent === 0` is the exact
    // signature Lists had to defend against downstream. It must now be
    // unproducible at the source.
    for (const meta of [{}, { chartPreviousClose: null }, { previousClose: 0 }]) {
      const q = parse(daily(meta))
      expect(q!.previousClose).not.toBe(q!.price)
    }
  })
})

describe('Finnhub derives its change through the same rule', () => {
  /*
   * `quoteData.pc || currentPrice` had the identical defect to the Yahoo
   * path and no test at all. Driven through the real method with `fetch`
   * stubbed, so the assertion is about the provider path and not about the
   * helper it happens to call.
   */
  const callFinnhub = async (quoteBody: Record<string, unknown>) => {
    const real = globalThis.fetch
    globalThis.fetch = (async (url: unknown) =>
      String(url).includes('/quote')
        ? { ok: true, json: async () => quoteBody }
        : { ok: false }) as unknown as typeof fetch
    try {
      return await (financialDataService as unknown as {
        fetchFromFinnhub(symbol: string): Promise<Quote | null>
      }).fetchFromFinnhub('AMZN')
    } finally {
      globalThis.fetch = real
    }
  }

  const T = 1787947201

  it('returns null change when `pc` is missing', async () => {
    const q = await callFinnhub({ c: 100, o: 99, h: 101, l: 98, t: T })
    expect(q).not.toBeNull()
    expect(q!.price).toBe(100)
    expect(q!.change).toBeNull()
    expect(q!.changePercent).toBeNull()
    expect(q!.previousClose).toBeNull()
  })

  it('returns null change when `pc` is zero rather than dividing by it', async () => {
    const q = await callFinnhub({ c: 100, pc: 0, o: 99, h: 101, l: 98, t: T })
    expect(q!.changePercent).toBeNull()
  })

  it('computes a real change when `pc` is present', async () => {
    const q = await callFinnhub({ c: 100, pc: 95, o: 99, h: 101, l: 98, t: T })
    expect(q!.previousClose).toBe(95)
    expect(q!.changePercent).toBeCloseTo((100 - 95) / 95 * 100, 10)
  })
})
