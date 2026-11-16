/**
 * The price-safety invariants, pinned as regression tests.
 *
 * These behaviours already exist and already work. They are pinned here
 * because the stabilization package is about to add a second provider behind
 * `market-data-entitlement.ts`, and a new adapter is exactly the kind of
 * change that reintroduces a zero price or an undated fallback by accident.
 *
 * The production damage these prevent, from `sizing-price.ts`:
 *
 *   - Eleven accepted trades sized at the literal 100. ABT booked 16,550
 *     shares at 100 against a real close of 90.62, leaving that portfolio's
 *     cash at -$310,763.
 *   - One trade sized at a 228.50 book mark while AAPL closed at 332.89 that
 *     day, moving $169,776 instead of $247,337.
 *
 * Nothing here is new behaviour. If one of these fails, something removed a
 * guard rather than something failing to add one.
 */
import { describe, it, expect } from 'vitest'
import {
  assessSizingPrice,
  assertBookablePrice,
  type SizingPriceInput,
} from '../sizing-price'
import { DAILY_CLOSE_POLICY, INTRADAY_QUOTE_POLICY } from '../freshness'
import { mayPersistToSharedCache } from '../../../../supabase/functions/_shared/market-data-entitlement'

const NOW = Date.parse('2026-11-16T15:00:00.000Z')
const opts = { now: NOW }

/** A good price: dated today, sourced, positive. */
const good: SizingPriceInput = {
  price: 332.89,
  asOf: '2026-11-16',
  basis: 'stored_close',
  currency: 'USD',
}

describe('a failed provider request never becomes a zero price', () => {
  it.each([0, -1, '0', '0.00', -0.0001])('refuses %p', price => {
    const v = assessSizingPrice({ ...good, price }, opts)
    expect(v.usable).toBe(false)
    expect(v.code).toBe('nonpositive')
    expect(v.price).toBeNull()
  })

  it('refuses an absent price rather than substituting anything', () => {
    for (const price of [null, undefined, '', 'NaN']) {
      const v = assessSizingPrice({ ...good, price: price as never }, opts)
      expect(v.usable).toBe(false)
      expect(v.price).toBeNull()
    }
  })

  it('cannot be talked into a zero price by allowing a stale basis', () => {
    const v = assessSizingPrice({ ...good, price: 0 }, { ...opts, allowStaleBasis: true })
    expect(v.usable).toBe(false)
  })
})

describe('an undated price is refused, never stamped with now', () => {
  /*
   * This is the `assets.current_price` case. That column has no `as of`
   * anywhere in the schema, and during the October outage every price fell
   * through to it. Defaulting its timestamp to the present is what made a
   * month-old number read as a live one.
   */
  it('refuses an undated price', () => {
    const v = assessSizingPrice({ ...good, asOf: null }, opts)
    expect(v.usable).toBe(false)
    expect(v.asOf).toBeNull()
  })

  it('refuses an undated price even when a stale basis is allowed', () => {
    const v = assessSizingPrice(
      { ...good, asOf: null },
      { ...opts, allowStaleBasis: true },
    )
    expect(v.usable).toBe(false)
  })

  it('refuses a price with no recorded basis', () => {
    const v = assessSizingPrice({ ...good, basis: null }, opts)
    expect(v.usable).toBe(false)
    expect(v.code).toBe('unsourced')
  })
})

describe('previous close is not silently a current quote', () => {
  /*
   * The orphaned `fetch-stock-prices` v9 does exactly this —
   * `meta?.regularMarketPrice || meta?.previousClose` — and returns the result
   * under the name `price`. It is being retired. The structural defence is
   * that a close carries its own date, so substituting yesterday's cannot be
   * invisible: it ages, and the age is what the verdict is computed from.
   */
  it('judges a stale close as stale rather than current', () => {
    const v = assessSizingPrice({ ...good, asOf: '2026-10-01' }, opts)
    expect(v.code).toBe('stale')
    expect(v.usable).toBe(false)
    expect(v.ageDays).toBeGreaterThan(0)
  })

  it('reports the real age, so a substituted close cannot pass as today', () => {
    const v = assessSizingPrice({ ...good, asOf: '2026-11-13' }, opts)
    expect(v.ageDays).toBe(3)
  })

  it('never accepts a future-dated price, gated or not', () => {
    for (const allowStaleBasis of [false, true]) {
      const v = assessSizingPrice(
        { ...good, asOf: '2026-12-25' },
        { ...opts, allowStaleBasis },
      )
      expect(v.code).toBe('future_dated')
      expect(v.usable).toBe(false)
    }
  })
})

describe('missing and stale are distinguishable from valid and current', () => {
  it('gives a distinct code to each failure shape', () => {
    const codes = new Set([
      assessSizingPrice(good, opts).code,
      assessSizingPrice({ ...good, price: null }, opts).code,
      assessSizingPrice({ ...good, price: 0 }, opts).code,
      assessSizingPrice({ ...good, asOf: null }, opts).code,
      assessSizingPrice({ ...good, basis: null }, opts).code,
      assessSizingPrice({ ...good, asOf: '2026-01-01' }, opts).code,
      assessSizingPrice({ ...good, asOf: '2026-12-25' }, opts).code,
    ])
    // Seven inputs, seven different verdicts: a consumer can tell them apart
    // rather than seeing one undifferentiated falsy.
    expect(codes.size).toBe(7)
  })

  it('accepts a good price and returns it as a number', () => {
    const v = assessSizingPrice(good, opts)
    expect(v.usable).toBe(true)
    expect(v.code).toBe('ok')
    expect(v.price).toBe(332.89)
    expect(v.gated).toBe(false)
  })
})

describe('a fallback basis is only used when the caller explicitly allows it', () => {
  it('refuses a stale price by default', () => {
    expect(assessSizingPrice({ ...good, asOf: '2026-10-01' }, opts).usable).toBe(false)
  })

  it('accepts it when gated, and records that it was gated', () => {
    const v = assessSizingPrice(
      { ...good, asOf: '2026-10-01' },
      { ...opts, allowStaleBasis: true },
    )
    expect(v.usable).toBe(true)
    expect(v.gated).toBe(true)
  })

  it('always gates a book mark, whose age cannot be established', () => {
    const v = assessSizingPrice(
      { ...good, basis: 'book_mark', asOf: null },
      { ...opts, allowStaleBasis: true },
    )
    expect(v.gated).toBe(true)
  })

  it('refuses a cross-provider fallback at the entitlement layer too', () => {
    // `fallback` is a redistributing use, so a per-seat provider cannot serve
    // one. Proven in entitlement.test.ts; asserted here so the price path and
    // the licence path are pinned by the same suite.
    expect(mayPersistToSharedCache('eodhd')).toBe(false)
  })
})

describe('daily history and intraday quotes are not conflated', () => {
  it('judges the same age differently under each policy', () => {
    // A two-day-old number is an ordinary close and a uselessly old quote.
    const twoDaysOld = { ...good, asOf: '2026-11-14' }
    const asClose = assessSizingPrice(twoDaysOld, { ...opts, policy: DAILY_CLOSE_POLICY })
    const asQuote = assessSizingPrice(twoDaysOld, { ...opts, policy: INTRADAY_QUOTE_POLICY })
    expect(asClose.usable).toBe(true)
    expect(asQuote.usable).toBe(false)
  })
})

describe('assertBookablePrice still throws rather than returning', () => {
  it('throws on every unusable shape', () => {
    const bad: SizingPriceInput[] = [
      { ...good, price: 0 },
      { ...good, price: null },
      { ...good, asOf: null },
      { ...good, basis: null },
      { ...good, asOf: '2026-12-25' },
      { ...good, asOf: '2026-01-01' },
    ]
    for (const input of bad) {
      expect(() => assertBookablePrice('AAPL', input, opts)).toThrow()
    }
  })

  it('names the subject, so the refusal says which trade it stopped', () => {
    expect(() => assertBookablePrice('ABT', { ...good, price: 0 }, opts)).toThrow(/ABT/)
  })

  it('returns the verdict for a good price', () => {
    expect(assertBookablePrice('AAPL', good, opts).price).toBe(332.89)
  })

  it('throws on a null input, rather than treating absence as permission', () => {
    expect(() => assertBookablePrice('AAPL', null, opts)).toThrow()
    expect(() => assertBookablePrice('AAPL', undefined, opts)).toThrow()
  })
})
