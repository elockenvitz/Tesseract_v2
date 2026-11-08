/**
 * A price may not size, book or apply a trade unless it can say when it was
 * true and where it came from.
 *
 * ── Why these assert numbers and dates, not shapes ───────────────────────
 *
 * Every case below is a real production row. A test that only checked
 * "returns a verdict" would pass against a gate that let all of them
 * through, and all of them moved a real book:
 *
 *   price 100, no basis        eleven accepted_trades, incl. ABT 16,550
 *                              shares that left a portfolio at -$310,763
 *   228.50 as of 2026-09-28    an approval on 2026-10-05 that bought 743
 *                              shares where the real close of 332.89 makes
 *                              it ~510, and moved $169,776 of cash instead
 *                              of $247,337
 *   a close dated 2026-10-01   what every price in the product was during
 *                              the 35-day ingestion outage
 *
 * ── The non-vacuous proof ────────────────────────────────────────────────
 *
 * CLAUDE.md Standing Rule 3: a gate that cannot observe its own failure mode
 * is decoration. `describe('the gate is not vacuous')` at the foot of this
 * file feeds the gate the exact defect it exists to catch and asserts that it
 * REFUSES -- and then feeds it a good price and asserts it does not. Both
 * directions, because a gate that refuses everything is as useless as one
 * that refuses nothing.
 */
import { describe, it, expect } from 'vitest'
import {
  assessSizingPrice,
  assertBookablePrice,
  describePriceBasis,
  UnusablePriceError,
} from '../sizing-price'

/** A fixed "now" so every age in this file is exact rather than drifting. */
const NOW = Date.parse('2026-11-07T12:00:00Z')

describe('a price with nothing to vouch for it', () => {
  it('refuses an absent price', () => {
    const v = assessSizingPrice(null, { now: NOW })
    expect(v.usable).toBe(false)
    expect(v.code).toBe('absent')
    expect(v.price).toBeNull()
  })

  it('refuses the literal placeholder, because it carries no basis', () => {
    // The exact shape of the eleven contaminated trades: a plausible number
    // and no answer to "where did this come from".
    const v = assessSizingPrice({ price: 100, asOf: null, basis: null }, { now: NOW })
    expect(v.usable).toBe(false)
    expect(v.code).toBe('unsourced')
    expect(v.reason).toContain('no recorded source')
  })

  it('refuses a dated price with no basis', () => {
    const v = assessSizingPrice({ price: 332.89, asOf: '2026-11-06', basis: null }, { now: NOW })
    expect(v.usable).toBe(false)
    expect(v.code).toBe('unsourced')
  })

  it('refuses a sourced price with no date', () => {
    // `assets.current_price` has no `as of` anywhere in the schema. During the
    // outage this was the value every surface fell through to.
    const v = assessSizingPrice({ price: 142.8, asOf: null, basis: 'stored_close' }, { now: NOW })
    expect(v.usable).toBe(false)
    expect(v.code).toBe('undated')
    expect(v.reason).toContain('no date')
  })

  it('refuses a date it cannot parse rather than treating it as now', () => {
    const v = assessSizingPrice({ price: 100, asOf: 'yesterday', basis: 'stored_close' }, { now: NOW })
    expect(v.usable).toBe(false)
    expect(v.code).toBe('undated')
  })

  it('refuses zero and negative prices', () => {
    // Zero is the sentinel the sizing ladder uses for "we do not know", and
    // both the normalizer and `apply_trade_to_holdings` already reject it.
    expect(assessSizingPrice({ price: 0, asOf: '2026-11-06', basis: 'stored_close' }, { now: NOW }).code)
      .toBe('nonpositive')
    expect(assessSizingPrice({ price: -5, asOf: '2026-11-06', basis: 'stored_close' }, { now: NOW }).code)
      .toBe('nonpositive')
    expect(assessSizingPrice({ price: null, asOf: '2026-11-06', basis: 'stored_close' }, { now: NOW }).code)
      .toBe('absent')
  })
})

describe('a dated, sourced price', () => {
  it('accepts the latest close', () => {
    // GOOGL's real 2026-11-06 close, read on the 7th.
    const v = assessSizingPrice({ price: 284.78, asOf: '2026-11-06', basis: 'stored_close' }, { now: NOW })
    expect(v.usable).toBe(true)
    expect(v.gated).toBe(false)
    expect(v.code).toBe('ok')
    expect(v.price).toBe(284.78)
    expect(v.asOf).toBe('2026-11-06')
    expect(v.ageDays).toBe(1)
  })

  it('accepts a Friday close read on the following Tuesday', () => {
    // The long-weekend case DAILY_CLOSE_POLICY's five days exists for. A
    // narrower window reports every public holiday as a data outage.
    const v = assessSizingPrice(
      { price: 284.78, asOf: '2026-11-02', basis: 'stored_close' },
      { now: Date.parse('2026-11-06T21:59:00Z') },
    )
    expect(v.usable).toBe(true)
    expect(v.code).toBe('ok')
  })

  it('accepts a live quote stamped at the instant it was observed', () => {
    const v = assessSizingPrice(
      { price: 449.04, asOf: '2026-11-07T11:59:00Z', basis: 'live_quote' },
      { now: NOW },
    )
    expect(v.usable).toBe(true)
    expect(v.ageDays).toBe(0)
  })
})

describe('a dated price that is too old', () => {
  const OUTAGE_CLOSE = { price: 330.32, asOf: '2026-10-01', basis: 'stored_close' as const }

  it('refuses it by default, and says how old it is', () => {
    const v = assessSizingPrice(OUTAGE_CLOSE, { now: NOW })
    expect(v.usable).toBe(false)
    expect(v.code).toBe('stale')
    expect(v.ageDays).toBe(37)
    expect(v.reason).toBe('the price is 37 days old (as of 2026-10-01)')
    // No price comes back on a refusal. A caller that ignores `usable` and
    // reads `price` still gets nothing to size with.
    expect(v.price).toBeNull()
  })

  it('accepts it only when the caller explicitly allows a stale basis, and marks it gated', () => {
    const v = assessSizingPrice(OUTAGE_CLOSE, { now: NOW, allowStaleBasis: true })
    expect(v.usable).toBe(true)
    expect(v.gated).toBe(true)
    expect(v.price).toBe(330.32)
    expect(v.reason).toContain('37 days old')
  })

  it('gates the 2026-10-05 book mark rather than silently sizing against it', () => {
    /*
     * The approval that bought 743 shares instead of ~510.
     *
     * REWRITTEN, with the reason recorded. This case originally asserted
     * `ageDays === 7`, derived from the holdings snapshot date passed in as
     * the price's `asOf`. That was the defect, not the measurement: the
     * snapshot date is the day the row is filed under, and
     * `apply_trade_to_holdings` copies the previous snapshot's price forward
     * onto today, so one trade in a book re-dates every mark in it. A mark
     * has no knowable age, so `ageDays` is now null and the verdict says
     * why. The next case is the one the old assertion could never have made.
     */
    const v = assessSizingPrice(
      { price: 228.5, asOf: '2026-09-28', basis: 'book_mark' },
      { now: Date.parse('2026-10-05T21:38:00Z'), allowStaleBasis: true },
    )
    expect(v.usable).toBe(true)
    expect(v.gated).toBe(true)
    expect(v.basis).toBe('book_mark')
    expect(v.code).toBe('undated_book_mark')
    expect(v.ageDays).toBeNull()
    expect(v.asOf).toBeNull()
    expect(v.reason).toContain('nothing records when it was last a market price')
  })
})

/**
 * The hole the first version of this gate left open.
 *
 * Measured against production: 388 holdings marks sit 50% or more away from
 * market. Under the old rule every one of them was caught ONLY because the
 * snapshot date was old. `apply_trade_to_holdings` carries a book's prices
 * forward onto today the first time anything in it trades, so a single trade
 * would have made all of that book's marks report `ok` with `gated: false`
 * and no warning at all. The safeguard disarmed itself on exactly the books
 * in active use.
 */
describe('a book mark is undated by construction', () => {
  const MARK = { price: 780.2, basis: 'book_mark' as const }

  it('is gated even when its date is TODAY, which is the self-disarm case', () => {
    // NFLX marked at 780.20 against a 63.41 close: 12.3x off, and dated
    // today because the book was traded this morning.
    const today = new Date(NOW).toISOString().slice(0, 10)
    const v = assessSizingPrice({ ...MARK, asOf: today }, { now: NOW, allowStaleBasis: true })

    expect(v.code).toBe('undated_book_mark')
    expect(v.gated).toBe(true)
    expect(v.usable).toBe(true)
    expect(v.price).toBe(780.2)
  })

  it('is never `ok`, at any date the snapshot could carry', () => {
    // No snapshot date anywhere makes a mark read as a current market price.
    for (const asOf of ['2024-01-01', '2026-09-28', '2026-11-06', '2026-11-07', null]) {
      const v = assessSizingPrice({ ...MARK, asOf }, { now: NOW, allowStaleBasis: true })
      expect(v.code, `asOf=${asOf}`).toBe('undated_book_mark')
      expect(v.gated, `asOf=${asOf}`).toBe(true)
    }
  })

  it('is refused outright where the caller has not allowed a stale basis', () => {
    // Trade Lab's execute path. An old number there is just the newest one
    // the pipeline managed to store, not a deliberate basis.
    const v = assessSizingPrice({ ...MARK, asOf: '2026-11-07' }, { now: NOW })
    expect(v.usable).toBe(false)
    expect(v.price).toBeNull()
    expect(v.gated).toBe(true)
  })

  it('still refuses a non-positive or absent mark before anything else', () => {
    // The book-mark branch must not become a way past the earlier checks.
    expect(assessSizingPrice({ price: 0, asOf: null, basis: 'book_mark' }, { allowStaleBasis: true }).code)
      .toBe('nonpositive')
    expect(assessSizingPrice({ price: null, asOf: null, basis: 'book_mark' }, { allowStaleBasis: true }).code)
      .toBe('absent')
  })
})

describe('assertBookablePrice', () => {
  it('throws on an unsourced price and names the instrument', () => {
    expect(() => assertBookablePrice('META', { price: 100, asOf: null, basis: null }, { now: NOW }))
      .toThrow(/Refusing to book META/)
  })

  it('throws UnusablePriceError and carries the verdict', () => {
    try {
      assertBookablePrice('AAPL', { price: 142.8, asOf: null, basis: 'stored_close' }, { now: NOW })
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(UnusablePriceError)
      expect((e as UnusablePriceError).verdict.code).toBe('undated')
    }
  })

  it('returns the verdict for a good price instead of throwing', () => {
    const v = assertBookablePrice(
      'GOOGL',
      { price: 284.78, asOf: '2026-11-06', basis: 'stored_close' },
      { now: NOW },
    )
    expect(v.usable).toBe(true)
    expect(v.price).toBe(284.78)
  })
})

describe('describePriceBasis', () => {
  it('names every basis, and says so when none was recorded', () => {
    expect(describePriceBasis('live_quote')).toBe('Live quote')
    expect(describePriceBasis('stored_close')).toBe('Last close')
    expect(describePriceBasis('book_mark')).toBe("Portfolio's carrying price (undated)")
    expect(describePriceBasis(undefined)).toBe('Source not recorded')
  })

  it('no longer advertises a manual basis, because nothing produces one', () => {
    /*
     * `'manual'` was removed from `PriceBasis`. It was declared and labelled
     * "Entered by hand", and nothing in the codebase ever set it:
     * `decision-snapshot-service`'s `overridePrice` parameter has zero
     * callers and its `price_source` output is never read back. A price a
     * person really typed would therefore have arrived with a null basis and
     * been refused as `unsourced`, so the label promised a workflow that did
     * not exist and would not have worked.
     *
     * Asserted through a cast because the type now makes the member
     * unrepresentable, which is the real guarantee. The docblock in
     * `sizing-price.ts` records what implementing it properly would need.
     */
    expect(describePriceBasis('manual' as never)).toBe('Source not recorded')
  })
})

/**
 * CLAUDE.md Standing Rule 3. Each case injects the specific defect and
 * asserts the gate catches it; the last case proves the gate is not simply
 * refusing everything.
 */
describe('the gate is not vacuous', () => {
  const inject = [
    { name: 'the literal 100 with no provenance', price: { price: 100, asOf: null, basis: null } },
    { name: 'an undated assets.current_price', price: { price: 142.8, asOf: null, basis: 'stored_close' as const } },
    { name: 'an outage-era close', price: { price: 330.32, asOf: '2026-10-01', basis: 'stored_close' as const } },
    { name: 'a close from six months ago', price: { price: 310.92, asOf: '2026-05-29', basis: 'stored_close' as const } },
    { name: 'a price of zero', price: { price: 0, asOf: '2026-11-06', basis: 'stored_close' as const } },
    { name: 'a target price masquerading as a cost', price: { price: 420, asOf: null, basis: null } },
  ]

  for (const { name, price } of inject) {
    it(`refuses ${name}`, () => {
      expect(assessSizingPrice(price, { now: NOW }).usable).toBe(false)
      expect(() => assertBookablePrice('TEST', price, { now: NOW })).toThrow()
    })
  }

  it('and still lets a current, sourced close through', () => {
    const good = { price: 284.78, asOf: '2026-11-06', basis: 'stored_close' as const }
    expect(assessSizingPrice(good, { now: NOW }).usable).toBe(true)
    expect(() => assertBookablePrice('GOOGL', good, { now: NOW })).not.toThrow()
  })
})
