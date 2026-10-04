/**
 * Turning an approved weight into a share count.
 *
 * The arithmetic here is pinned against a REAL production decision: SHOP in
 * Tech & Consumer Growth, approved 2026-10-04. The book held 12,000 shares
 * marked at $82.40 — $988,800 of a $34,779,457.07 book, which is the
 * 2.8430576% the PM was shown. The analyst entered −0.5, so the approved
 * target was 2.3430576%.
 *
 * That decision produced an `accepted_trades` row with every numeric column
 * null, because nothing on the accept path ever called the sizing engine.
 * Holdings did not move. These tests are the arithmetic that was missing.
 *
 * They assert NUMBERS, not shapes. A test that only checked "delta_shares is
 * not null" would have passed on a wrong quantity, and a wrong quantity is
 * the one failure that silently moves a real book.
 */
import { describe, it, expect } from 'vitest'
import { computeAcceptSizing, basisFromBook, isRefusal, type AcceptSizingBasis } from '../accept-sizing'

/** The live SHOP position, to the precision production carried. */
const SHOP: AcceptSizingBasis = {
  currentShares: 12000,
  currentWeight: 2.8430576072247433,
  price: 82.4,
  portfolioTotalValue: 34779457.0707,
  asOf: '2026-09-29',
  isNewPosition: false,
}

const ASSET = '26003bd1-aff7-48ce-962a-068ad092298b'

describe('the SHOP decision that did not execute', () => {
  it('sells 2,110 shares for a 50bp trim', () => {
    const r = computeAcceptSizing(SHOP, '-0.5', 'sell', ASSET)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // 0.5% of $34,779,457.07 = $173,897.29 → /82.40 = 2,110.4 → 2,110.
    expect(Math.round(r.computed.delta_shares!)).toBe(-2110)
    expect(Math.round(r.computed.target_shares!)).toBe(9890)
  })

  it('lands on the weight the PM approved, within one share', () => {
    const r = computeAcceptSizing(SHOP, '-0.5', 'sell', ASSET)
    if (!r.ok) throw new Error('expected sizing')
    // The engine lot-rounds the DELTA and recomputes the weight from it, so
    // the realised target differs from the requested one by the value of the
    // rounded fraction of a share — here 0.4 shares, ~0.0001% of the book.
    // Asserting exact equality would be asserting that lot rounding does not
    // happen. One share's worth of weight is the honest tolerance.
    const oneShareInPct = (100 * SHOP.price) / SHOP.portfolioTotalValue
    expect(Math.abs(r.computed.target_weight! - 2.3430576)).toBeLessThan(oneShareInPct)
    expect(Math.abs(r.computed.delta_weight! - -0.5)).toBeLessThan(oneShareInPct)
  })

  it('rounds the delta toward zero, then derives the target from it', () => {
    // The order matters and is not arbitrary: you trade whole shares, so the
    // DELTA is the thing that must be an integer. Rounding the target
    // instead would produce a delta that no one could execute.
    const r = computeAcceptSizing(SHOP, '-0.5', 'sell', ASSET)
    if (!r.ok) throw new Error('expected sizing')
    // −2,110.4 → −2,110 (toward zero), so target = 12,000 − 2,110 = 9,890.
    expect(Math.round(r.computed.delta_shares!)).toBe(-2110)
    expect(Math.round(r.computed.target_shares!)).toBe(SHOP.currentShares - 2110)
  })

  it('prices the trade at the book, not at some other number', () => {
    // Production carried three prices for SHOP: book $82.40, newest close
    // $149.09, assets.current_price $78.90. Sizing the same instruction at
    // $149.09 sells ~6,534 shares instead of 2,110 — a 3x different trade
    // from one word of input. The book is the basis the PM's weight came
    // from, so the book is the basis the trade uses.
    const r = computeAcceptSizing(SHOP, '-0.5', 'sell', ASSET)
    if (!r.ok) throw new Error('expected sizing')
    expect(r.computed.price_used).toBe(82.4)
    expect(r.computed.notional_value).toBeCloseTo(173864, 0) // 2110 × 82.40
  })

  it('stamps the price with the book date, never with now', () => {
    const r = computeAcceptSizing(SHOP, '-0.5', 'sell', ASSET)
    if (!r.ok) throw new Error('expected sizing')
    expect(r.computed.price_timestamp).toBe('2026-09-29')
  })
})

describe('direction and sign', () => {
  it('an add increases shares', () => {
    const r = computeAcceptSizing(SHOP, '+0.5', 'buy', ASSET)
    if (!r.ok) throw new Error('expected sizing')
    expect(r.computed.delta_shares!).toBeGreaterThan(0)
    expect(Math.round(r.computed.target_shares!)).toBe(14110)
  })

  it('a trim decreases shares', () => {
    const r = computeAcceptSizing(SHOP, '-0.5', 'trim', ASSET)
    if (!r.ok) throw new Error('expected sizing')
    expect(r.computed.delta_shares!).toBeLessThan(0)
  })

  it('an absolute target resolves against the live position, not from zero', () => {
    // 2% of the book = $695,589 → 8,441.6 shares. Against a 12,000-share
    // holding that is a SALE: delta −3,558.4 → −3,558 toward zero → target
    // 8,442. Sized from a zero baseline the same input would read as an
    // 8,442-share BUY — the sign would invert.
    const r = computeAcceptSizing(SHOP, '2', 'sell', ASSET)
    if (!r.ok) throw new Error('expected sizing')
    expect(Math.round(r.computed.delta_shares!)).toBe(-3558)
    expect(Math.round(r.computed.target_shares!)).toBe(8442)
  })

  it('the same target weight scales with the size of the book', () => {
    /*
     * The basis must be SELF-CONSISTENT: shares × price / totalValue is the
     * weight, and the three cannot be varied independently. Doubling the
     * book while holding the same 12,000 shares at the same price halves
     * the position's weight — stating otherwise describes a book that
     * cannot exist, and the engine faithfully produces nonsense from it
     * (a negative share target). That is correct behaviour, and the reason
     * this fixture derives the weight rather than asserting one.
     */
    const doubledTotal = SHOP.portfolioTotalValue * 2
    const doubled = {
      ...SHOP,
      portfolioTotalValue: doubledTotal,
      currentWeight: (100 * SHOP.currentShares * SHOP.price) / doubledTotal,
    }
    const a = computeAcceptSizing(SHOP, '1', 'sell', ASSET)
    const b = computeAcceptSizing(doubled, '1', 'sell', ASSET)
    if (!a.ok || !b.ok) throw new Error('expected sizing')
    // 1% of twice the money is twice the shares.
    expect(Math.round(a.computed.target_shares!)).toBe(4221)
    expect(Math.round(b.computed.target_shares!)).toBe(8442)
  })
})

describe('refusal, never invention', () => {
  it('refuses an empty instruction', () => {
    const r = computeAcceptSizing(SHOP, '   ', 'sell', ASSET)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/no sizing/i)
  })

  it('refuses the pair-leg placeholder rather than executing it', () => {
    // The pair accept path passes the literal 'pair' when a leg has no
    // weight. It is not an instruction and must never be sized.
    const r = computeAcceptSizing(SHOP, 'pair', 'buy', ASSET)
    expect(r.ok).toBe(false)
  })

  it('refuses an active-weight instruction it cannot price', () => {
    // @t / @d need a benchmark this path does not load. Refusing is right;
    // silently treating it as a plain weight would not be.
    const r = computeAcceptSizing(SHOP, '2@t', 'buy', ASSET)
    expect(r.ok).toBe(false)
  })

  it('never substitutes a fabricated price', () => {
    // `proposal-sizing.ts` falls back to a price of 100 when it has none.
    // That path must not be reachable from here: a zero price refuses.
    const noPrice = { ...SHOP, price: 0 }
    const r = computeAcceptSizing(noPrice, '-0.5', 'sell', ASSET)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).not.toMatch(/100/)
  })
})

describe('basisFromBook — the preview uses the commit’s inputs', () => {
  const book = {
    byKey: new Map([[`p1:${ASSET}`, { shares: 12000, price: 82.4, weightPct: 2.8430576072247433 }]]),
    byPortfolio: new Map([['p1', { totalValue: 34779457.0707, asOf: '2026-09-29' }]]),
  }

  it('produces the same basis the service would', () => {
    const b = basisFromBook(book, 'p1', ASSET)
    expect(isRefusal(b)).toBe(false)
    if (isRefusal(b)) return
    expect(b).toEqual(SHOP)
  })

  it('previewing and committing agree on the share count', () => {
    const b = basisFromBook(book, 'p1', ASSET)
    if (isRefusal(b)) throw new Error('expected basis')
    const preview = computeAcceptSizing(b, '-0.5', 'sell', ASSET)
    const commit = computeAcceptSizing(SHOP, '-0.5', 'sell', ASSET)
    if (!preview.ok || !commit.ok) throw new Error('expected sizing')
    expect(preview.computed.delta_shares).toBe(commit.computed.delta_shares)
  })

  it('declines to preview an unheld asset rather than guessing', () => {
    const b = basisFromBook(book, 'p1', 'not-held')
    expect(isRefusal(b)).toBe(true)
    if (!isRefusal(b)) return
    expect(b.reason).toMatch(/not currently held/i)
  })

  it('declines when the book has no value', () => {
    const empty = { byKey: new Map(), byPortfolio: new Map([['p1', { totalValue: 0, asOf: null }]]) }
    expect(isRefusal(basisFromBook(empty, 'p1', ASSET))).toBe(true)
  })

  it('declines before the book has loaded, rather than sizing against nothing', () => {
    expect(isRefusal(basisFromBook(undefined, 'p1', ASSET))).toBe(true)
  })
})
