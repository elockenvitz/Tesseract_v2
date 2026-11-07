/**
 * The two places a price is judged on the way to a real position change.
 *
 * `assessSizingPrice` is unit-tested in `market-data/__tests__/
 * sizing-price.test.ts`. This file tests the WIRING -- that the normalizer
 * carries provenance through into `computed`, that enforcement is off by
 * default and on where it is set, and that `assetPriceForVariant` reports the
 * rung that actually answered instead of claiming a live quote.
 *
 * Both halves matter independently. A gate wired to a field nobody populates
 * is the `auth_rls_initplan` of market data: it reads as protection and
 * measures nothing.
 */
import { describe, it, expect } from 'vitest'
import { normalizeSizing, type NormalizationContext } from '../normalize-sizing'
import { assetPriceForVariant } from '../variant-price'
import type { AssetPrice } from '../../../types/trading'

/** A $34.78m book holding 12,000 SHOP marked at $82.40, as production had it. */
const ctx = (price: AssetPrice, extra: Partial<NormalizationContext> = {}): NormalizationContext => ({
  action: 'sell',
  sizing_input: '-0.5',
  current_position: { shares: 12000, weight: 2.8430576072247433, cost_basis: null, active_weight: null },
  portfolio_total_value: 34779457.0707,
  price,
  rounding_config: { lot_size: 1, min_lot_behavior: 'round', round_direction: 'toward_zero' },
  active_weight_config: null,
  has_benchmark: false,
  ...extra,
})

const dated = (p: number, asOf: string): AssetPrice => ({
  asset_id: 'a', price: p, timestamp: new Date().toISOString(), source: 'close', as_of: asOf, basis: 'stored_close',
})

describe('the normalizer carries provenance into computed', () => {
  it('copies as_of and basis onto the computed values', () => {
    const r = normalizeSizing(ctx(dated(82.4, '2026-11-06')))
    expect(r.is_valid).toBe(true)
    expect(r.computed?.price_as_of).toBe('2026-11-06')
    expect(r.computed?.price_basis).toBe('stored_close')
    expect(r.computed?.price_gated).toBe(false)
  })

  it('records nulls rather than inventing provenance a caller did not give', () => {
    const r = normalizeSizing(ctx({
      asset_id: 'a', price: 82.4, timestamp: new Date().toISOString(), source: 'realtime',
    }))
    expect(r.is_valid).toBe(true)
    expect(r.computed?.price_as_of).toBeNull()
    expect(r.computed?.price_basis).toBeUndefined()
  })

  it('still produces the right share count -- the gate changes no arithmetic', () => {
    // 0.5% of $34,779,457.07 = $173,897.29 / 82.40 = 2,110.4 -> 2,110.
    const r = normalizeSizing(ctx(dated(82.4, '2026-11-06')))
    expect(Math.round(r.computed!.delta_shares)).toBe(-2110)
    expect(Math.round(r.computed!.target_shares)).toBe(9890)
  })
})

describe('enforcement', () => {
  const stale = dated(82.4, '2026-01-01')

  it('is off by default, so a preview still renders and reports the verdict', () => {
    const r = normalizeSizing(ctx(stale))
    expect(r.is_valid).toBe(true)
    expect(r.price_verdict?.usable).toBe(false)
    expect(r.price_verdict?.code).toBe('stale')
  })

  it('refuses a stale price when enforced, and says why', () => {
    const r = normalizeSizing(ctx(stale, { price_enforcement: 'enforce' }))
    expect(r.is_valid).toBe(false)
    expect(r.error).toMatch(/cannot be sized/)
    expect(r.error).toMatch(/days old/)
    expect(r.computed).toBeUndefined()
  })

  it('refuses an undated BOOK MARK when enforced', () => {
    /*
     * The expected code changed from `undated` to `undated_book_mark`, and
     * that is the fix rather than a cosmetic rename. A book mark no longer
     * reaches the date check at all: nothing in `portfolio_holdings` records
     * when a mark was last a market price, and `apply_trade_to_holdings`
     * copies prices forward onto today, so a mark is treated as undated
     * whatever date it arrives with. The refusal here is unchanged.
     */
    const r = normalizeSizing(ctx(
      { asset_id: 'a', price: 228.5, timestamp: new Date().toISOString(), source: 'close', as_of: null, basis: 'book_mark' },
      { price_enforcement: 'enforce' },
    ))
    expect(r.is_valid).toBe(false)
    expect(r.price_verdict?.code).toBe('undated_book_mark')
  })

  it('refuses an undated price whose basis is a real market source', () => {
    // `undated` still exists and still fires: this is the
    // `assets.current_price` fall-through, which has no `as of` anywhere in
    // the schema. Kept as a separate case so the book-mark branch above
    // cannot be mistaken for having replaced it.
    const r = normalizeSizing(ctx(
      { asset_id: 'a', price: 228.5, timestamp: new Date().toISOString(), source: 'close', as_of: null, basis: 'stored_close' },
      { price_enforcement: 'enforce' },
    ))
    expect(r.is_valid).toBe(false)
    expect(r.price_verdict?.code).toBe('undated')
  })

  it('accepts a stale price when enforced AND the caller allows the basis, and marks it gated', () => {
    // The accept-sizing rule: the book's own carrying price is the money the
    // approved weight was expressed in.
    const r = normalizeSizing(ctx(
      { asset_id: 'a', price: 82.4, timestamp: new Date().toISOString(), source: 'close', as_of: '2026-09-29', basis: 'book_mark' },
      { price_enforcement: 'enforce', allow_stale_basis: true },
    ))
    expect(r.is_valid).toBe(true)
    expect(r.computed?.price_gated).toBe(true)
    expect(r.price_verdict?.gated).toBe(true)
  })

  it('refuses a non-positive price in either mode', () => {
    for (const mode of ['advisory', 'enforce'] as const) {
      const r = normalizeSizing(ctx(dated(0, '2026-11-06'), { price_enforcement: mode }))
      expect(r.is_valid).toBe(false)
      expect(r.error).toMatch(/Invalid price/)
    }
  })
})

describe('assetPriceForVariant reports the rung that answered', () => {
  const PROV = {
    'live-asset': { asOf: '2026-11-07T11:00:00Z', basis: 'live_quote' as const },
    'close-asset': { asOf: '2026-11-06', basis: 'stored_close' as const },
  }
  const MAP = { 'live-asset': 449.04, 'close-asset': 284.78 }

  it('passes a live quote through with its instant', () => {
    const p = assetPriceForVariant({ assetId: 'live-asset', priceMap: MAP, priceProvenance: PROV })
    expect(p.price).toBe(449.04)
    expect(p.basis).toBe('live_quote')
    expect(p.as_of).toBe('2026-11-07T11:00:00Z')
  })

  it("passes a stored close through with the close's own date, not now", () => {
    const p = assetPriceForVariant({ assetId: 'close-asset', priceMap: MAP, priceProvenance: PROV })
    expect(p.as_of).toBe('2026-11-06')
    expect(p.source).toBe('close')
  })

  it('falls back to the book mark and labels it as one', () => {
    const p = assetPriceForVariant({
      assetId: 'unpriced', priceMap: MAP, priceProvenance: PROV,
      bookPrice: 228.5, bookAsOf: '2026-09-28',
    })
    expect(p.price).toBe(228.5)
    expect(p.basis).toBe('book_mark')
    expect(p.as_of).toBe('2026-09-28')
  })

  it('returns zero with no basis when nothing can price the asset', () => {
    const p = assetPriceForVariant({ assetId: 'unpriced', priceMap: MAP, priceProvenance: PROV })
    expect(p.price).toBe(0)
    expect(p.basis).toBeUndefined()
    expect(p.as_of).toBeNull()
    // And the normalizer refuses it, so nothing gets sized.
    expect(normalizeSizing(ctx(p)).is_valid).toBe(false)
  })

  it('does not claim a basis the price map could not supply', () => {
    // A price with no provenance entry is reported as unsourced rather than
    // assumed live -- which is what sixteen hand-built literals used to do.
    const p = assetPriceForVariant({ assetId: 'orphan', priceMap: { orphan: 500 }, priceProvenance: {} })
    expect(p.price).toBe(500)
    expect(p.basis).toBeUndefined()
    expect(normalizeSizing(ctx(p), ).price_verdict?.code).toBe('unsourced')
  })
})
