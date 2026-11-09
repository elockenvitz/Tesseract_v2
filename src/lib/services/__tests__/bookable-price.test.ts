/**
 * The last line before a price becomes a position.
 *
 * `price_at_acceptance` is written from `computed.price_used`, and
 * `apply_trade_to_holdings` then puts that number into
 * `portfolio_holdings.price`, `.cost` and the portfolio's CASH line. This
 * guard is the only thing between the two, so these cases are the production
 * rows it exists to stop:
 *
 *   price_used 100, no provenance   eleven accepted_trades; ABT booked 16,550
 *                                   shares at 100 and left Campbell Capital's
 *                                   cash at -$310,763
 *   a 2026-05-29 close at 310.92    a lab_variant still sitting in production
 *                                   today, holding a price from five months ago
 *   a 2026-10-01 close              what every stored price was during the
 *                                   35-day ingestion outage
 *
 * The refusal is per-trade: `executeSimVariants` wraps each commit in its own
 * try/catch and reports the reason against that symbol, so one unverifiable
 * price does not fail a whole batch.
 */
import { describe, it, expect, vi } from 'vitest'

// The module reaches for a Supabase client at import time. Nothing in these
// tests touches the network -- the guard under test is pure -- so the client
// is stubbed rather than configured.
vi.mock('../../supabase', () => ({ supabase: {} }))

import { assertVariantPriceIsBookable } from '../execute-sim-variants-service'

const variant = (computed: Record<string, unknown> | null, symbol = 'TEST') => ({
  id: 'v1',
  asset_id: 'asset-1',
  asset: { symbol },
  sizing_input: '-0.5',
  computed,
}) as never

const priced = (over: Record<string, unknown>) => ({
  direction: 'sell',
  target_shares: 9890,
  target_weight: 2.343,
  delta_shares: -2110,
  delta_weight: -0.5,
  shares_change: -2110,
  notional_value: 173897,
  price_timestamp: new Date().toISOString(),
  ...over,
})

describe('a variant that cannot be booked', () => {
  it('refuses the literal 100 with no provenance', () => {
    expect(() => assertVariantPriceIsBookable(variant(priced({ price_used: 100 }), 'META')))
      .toThrow(/Refusing to book META/)
  })

  it('refuses a price whose basis was never recorded, however plausible', () => {
    expect(() => assertVariantPriceIsBookable(
      variant(priced({ price_used: 284.78, price_as_of: '2026-11-06' })),
    )).toThrow(/no recorded source/)
  })

  it('refuses a sourced price with no date', () => {
    expect(() => assertVariantPriceIsBookable(
      variant(priced({ price_used: 142.8, price_as_of: null, price_basis: 'stored_close' })),
    )).toThrow(/no date/)
  })

  it('refuses an outage-era close, and does not accept a stale basis here', () => {
    // Unlike `accept-sizing`, this path never gates: an old number on the
    // Trade Lab ladder is just the newest one the pipeline managed to store.
    expect(() => assertVariantPriceIsBookable(
      variant(priced({ price_used: 330.32, price_as_of: '2026-10-01', price_basis: 'stored_close' })),
    )).toThrow(/days old/)
  })

  it('refuses the five-month-old book mark a live variant is still holding', () => {
    /*
     * The refusal is unchanged; the REASON changed, and that is the fix.
     * These two cases used to assert /days old/, an age derived from the
     * holdings snapshot date. A book mark has no knowable age: nothing in
     * `portfolio_holdings` records when its price was last a market price,
     * and `apply_trade_to_holdings` copies prices forward onto today. So
     * asserting an age here was asserting the defect.
     */
    expect(() => assertVariantPriceIsBookable(
      variant(priced({ price_used: 310.92, price_as_of: '2026-05-29', price_basis: 'book_mark' })),
    )).toThrow(/nothing records when it was last a market price/)
  })

  it('refuses a stale price even when the variant claims it was gated upstream', () => {
    // `price_gated` is a record of what happened, not permission. A gate set
    // by whatever wrote the variant cannot authorize the write it precedes.
    expect(() => assertVariantPriceIsBookable(
      variant(priced({
        price_used: 228.5, price_as_of: '2026-09-28', price_basis: 'book_mark', price_gated: true,
      })),
    )).toThrow(/nothing records when it was last a market price/)
  })

  it('refuses a book mark dated TODAY, which the age-based rule let straight through', () => {
    /*
     * The case the old assertion could not make, and the hole it left open.
     * A book traded this morning has every one of its marks re-dated to
     * today, so an age-based rule reports a current price for a mark that may
     * be 12x away from market. 388 production marks sit 50% or more off.
     */
    const today = new Date().toISOString().slice(0, 10)
    expect(() => assertVariantPriceIsBookable(
      variant(priced({ price_used: 780.2, price_as_of: today, price_basis: 'book_mark' }), 'NFLX'),
    )).toThrow(/Refusing to book NFLX/)
  })

  it('still refuses a stale MARKET close with its age, so that path is intact', () => {
    // `stale` and its age message still exist and still fire for a dated
    // market price. Kept here so the book-mark change above cannot be
    // mistaken for having removed them.
    expect(() => assertVariantPriceIsBookable(
      variant(priced({ price_used: 330.32, price_as_of: '2026-10-01', price_basis: 'stored_close' })),
    )).toThrow(/days old/)
  })
})

describe('a variant that can', () => {
  it('allows a close inside the daily-close window', () => {
    const asOf = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10)
    expect(() => assertVariantPriceIsBookable(
      variant(priced({ price_used: 284.78, price_as_of: asOf, price_basis: 'stored_close' })),
    )).not.toThrow()
  })

  it('allows a live quote', () => {
    expect(() => assertVariantPriceIsBookable(
      variant(priced({
        price_used: 449.04, price_as_of: new Date().toISOString(), price_basis: 'live_quote',
      })),
    )).not.toThrow()
  })

  it('stays silent on a variant with no sizing, which the caller already refuses', () => {
    expect(() => assertVariantPriceIsBookable(variant(null))).not.toThrow()
  })
})
