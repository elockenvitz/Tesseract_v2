import { describe, it, expect } from 'vitest'
import { presentQuote, provenanceCaption, STALE_AFTER_MS } from '../quote-provenance'
import type { RoutedQuote } from '../routed-quote'

/**
 * The header's price, and the three things it is not allowed to invent.
 *
 * The band previously formatted with a local `'$' + n.toLocaleString()` and
 * showed `change` whenever it was non-null. That produced, on one screen:
 * a dollar sign on a pence quote, a magnitude wrong by 100, and a day change
 * measured against a `previousClose` of 0. Each case below is one of those.
 */

const base: RoutedQuote = {
  symbol: 'AAPL',
  price: 232.5,
  change: 1.5,
  changePercent: 0.65,
  dayHigh: 233,
  dayLow: 230,
  volume: 1_000_000,
  previousClose: 231,
  open: 231.2,
  high: 233,
  low: 230,
  timestamp: '2026-11-19T20:00:00Z',
  provider: 'eodhd',
}

const NOW = new Date('2026-11-19T21:00:00Z').getTime()

describe('the currency is the provider\'s, never the formatter\'s', () => {
  it('renders a USD quote with a dollar sign because the quote says USD', () => {
    const p = presentQuote({ ...base, currency: 'USD' }, null, NOW)
    expect(p.priceText).toContain('232.50')
    expect(p.currencyCode).toBe('USD')
  })

  it('converts a pence quote to pounds instead of prefixing a dollar sign', () => {
    // The GBX case. 18,500 pence is £185.00. The old header printed
    // "$18,500.00" for this, which is wrong in symbol AND in magnitude.
    const p = presentQuote(
      {
        ...base,
        symbol: 'SHEL.LON',
        price: 18_500,
        change: 120,
        previousClose: 18_380,
        currency: 'GBX',
        currencyUnit: { code: 'GBX', majorCode: 'GBP', minorPerMajor: 100 },
      },
      null,
      NOW,
    )
    expect(p.converted).toBe(true)
    expect(p.currencyCode).toBe('GBP')
    expect(p.priceText).toContain('185.00')
    expect(p.priceText).not.toContain('18,500')
    expect(p.priceText).not.toContain('$')
    // The change is converted on the SAME basis, or the two numbers on the
    // line disagree by a factor of 100.
    expect(p.changeText).toContain('1.20')
  })

  it('renders a bare number when nothing states a currency', () => {
    // No guess, and specifically not a dollar sign.
    const p = presentQuote({ ...base, currency: undefined }, null, NOW)
    expect(p.priceText).toBe('232.50')
    expect(p.currencyCode).toBeUndefined()
  })

  it('falls back to the assets row currency only when the quote is silent', () => {
    const p = presentQuote({ ...base, currency: undefined }, 'EUR', NOW)
    expect(p.currencyCode).toBe('EUR')
  })

  it('prefers the quote currency over the assets row', () => {
    // The quote describes THIS observation; the column describes the
    // instrument. On a disagreement the observation wins.
    const p = presentQuote({ ...base, currency: 'USD' }, 'EUR', NOW)
    expect(p.currencyCode).toBe('USD')
  })
})

describe('a day change is refused rather than fabricated', () => {
  it('shows no change when previousClose is zero', () => {
    // Absence rendered as a value. 0 is the provider declining to answer,
    // not yesterday's price.
    const p = presentQuote({ ...base, previousClose: 0 }, null, NOW)
    expect(p.priceText).toContain('232.50')
    expect(p.changeText).toBeNull()
    expect(p.changePercentText).toBeNull()
    expect(p.direction).toBeNull()
  })

  it('shows no change when previousClose is null', () => {
    // `null` is the contract's way of saying "not known" — see the note on
    // `Quote.previousClose`. It must not be coalesced to a number here.
    const p = presentQuote({ ...base, previousClose: null, change: null }, null, NOW)
    expect(p.changeText).toBeNull()
  })

  it('shows no change when the previous close is null but a change arrived anyway', () => {
    // Defensive: some path produced a change without the observation behind
    // it. The change is still refused, because it cannot be verified.
    const p = presentQuote({ ...base, previousClose: null }, null, NOW)
    expect(p.changeText).toBeNull()
  })

  it('shows no change when previousClose is negative', () => {
    const p = presentQuote({ ...base, previousClose: -1 }, null, NOW)
    expect(p.changeText).toBeNull()
  })

  it('still shows the price when the change is refused', () => {
    // The refusal must cost the change only. Dropping the price too would
    // make a usable observation unavailable.
    const p = presentQuote({ ...base, previousClose: 0 }, 'USD', NOW)
    expect(p.unavailable).toBeNull()
    expect(p.priceText).toBeTruthy()
  })

  it('signs a decline and reports direction', () => {
    const p = presentQuote({ ...base, change: -2.25, changePercent: -0.96 }, 'USD', NOW)
    expect(p.direction).toBe('down')
    expect(p.changeText).toMatch(/^-/)
    expect(p.changePercentText).toBe('(-0.96%)')
  })

  it('reports a flat day as flat, not as a rise', () => {
    const p = presentQuote({ ...base, change: 0, changePercent: 0 }, 'USD', NOW)
    expect(p.direction).toBe('flat')
  })
})

describe('an absent price is an absent price', () => {
  it('reports unavailable for a null quote', () => {
    const p = presentQuote(null, 'USD', NOW)
    expect(p.unavailable).toBe('No price observation')
    expect(p.priceText).toBeNull()
  })

  it('reports unavailable rather than rendering NaN', () => {
    const p = presentQuote({ ...base, price: Number.NaN }, 'USD', NOW)
    expect(p.unavailable).toBeTruthy()
    expect(p.priceText).toBeNull()
  })

  /**
   * The specific thing a trading screen must never do: show 0.00 as a
   * price. A zero is not an observation.
   */
  it('does not present a zero price as a traded price', () => {
    const p = presentQuote({ ...base, price: 0 }, 'USD', NOW)
    // Not "$0.00" — nothing at all, and the unavailable state instead.
    expect(p.priceText).toBeNull()
    expect(p.unavailable).toBe('No price observation')
  })
})

describe('delivery and as-of are reported, never inferred', () => {
  it('maps only the three terms a provider states', () => {
    expect(presentQuote({ ...base, delivery: 'realtime' }, null, NOW).deliveryLabel).toBe('Real time')
    expect(presentQuote({ ...base, delivery: 'delayed' }, null, NOW).deliveryLabel).toBe('Delayed')
    expect(presentQuote({ ...base, delivery: 'eod' }, null, NOW).deliveryLabel).toBe('End of day')
  })

  it('refuses to label an unstated delivery', () => {
    expect(presentQuote(base, null, NOW).deliveryLabel).toBeNull()
    // And an unrecognised provider token is not passed through as a claim.
    expect(presentQuote({ ...base, delivery: 'live-ish' }, null, NOW).deliveryLabel).toBeNull()
  })

  it('says so in the caption rather than implying the price is live', () => {
    const caption = provenanceCaption(presentQuote(base, null, NOW))
    expect(caption).toContain('Delivery unstated')
    expect(caption).not.toContain('Real time')
  })

  it('uses effectiveAt, the instant the price was true', () => {
    const p = presentQuote(
      { ...base, effectiveAt: '2026-11-19T20:45:00Z', observedAt: '2026-11-19T21:00:00Z' },
      null,
      NOW,
    )
    expect(p.asOfISO).toBe('2026-11-19T20:45:00.000Z')
  })

  it('never reports when we asked as when the price was true', () => {
    // `observedAt` alone is not an as-of. It is a different claim.
    const p = presentQuote({ ...base, timestamp: '', observedAt: '2026-11-19T21:00:00Z' }, null, NOW)
    expect(p.asOfISO).toBeNull()
  })

  it('flags a price older than the display threshold', () => {
    const old = new Date(NOW - STALE_AFTER_MS - 1).toISOString()
    expect(presentQuote({ ...base, effectiveAt: old }, null, NOW).isStale).toBe(true)
    const recent = new Date(NOW - STALE_AFTER_MS + 60_000).toISOString()
    expect(presentQuote({ ...base, effectiveAt: recent }, null, NOW).isStale).toBe(false)
  })

  it('still shows a stale price, flagged rather than withheld', () => {
    const old = new Date(NOW - STALE_AFTER_MS * 10).toISOString()
    const p = presentQuote({ ...base, effectiveAt: old, delivery: 'eod' }, 'USD', NOW)
    expect(p.isStale).toBe(true)
    expect(p.priceText).toBeTruthy()
    expect(p.unavailable).toBeNull()
  })

  it('has nothing to caption when there is nothing to say', () => {
    expect(provenanceCaption(presentQuote(null, null, NOW))).toBeNull()
  })
})
