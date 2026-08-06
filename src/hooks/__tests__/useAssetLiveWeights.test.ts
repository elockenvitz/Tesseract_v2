import { describe, expect, it } from 'vitest'
import { computeWeights, pickPrice, type PositionRow } from '../useAssetLiveWeights'

const AAPL = 'asset-aapl'
const MSFT = 'asset-msft'

function position(over: Partial<PositionRow> = {}): PositionRow {
  return {
    portfolioId: 'p1',
    portfolioName: 'Global Equity',
    assetId: AAPL,
    symbol: 'AAPL',
    shares: 100,
    asOf: '2026-07-31',
    ...over,
  }
}

describe('computeWeights', () => {
  it('weighs the position against the whole repriced book', () => {
    const positions = [
      position({ assetId: AAPL, symbol: 'AAPL', shares: 100 }),
      position({ assetId: MSFT, symbol: 'MSFT', shares: 100 }),
    ]
    const prices = new Map([['AAPL', 30], ['MSFT', 70]])

    const [result] = computeWeights(positions, prices, AAPL)

    expect(result.marketValue).toBe(3_000)
    expect(result.weight).toBeCloseTo(30, 10)
    expect(result.unpricedCount).toBe(0)
    expect(result.holdingsCount).toBe(2)
  })

  it('sums multiple lots of the same asset in one portfolio', () => {
    const positions = [
      position({ symbol: 'AAPL', shares: 60 }),
      position({ symbol: 'AAPL', shares: 40 }),
      position({ assetId: MSFT, symbol: 'MSFT', shares: 100 }),
    ]
    const prices = new Map([['AAPL', 30], ['MSFT', 70]])

    const [result] = computeWeights(positions, prices, AAPL)

    // Two lots of the same name are one position, not the last row seen.
    expect(result.shares).toBe(100)
    expect(result.marketValue).toBe(3_000)
    expect(result.weight).toBeCloseTo(30, 10)
  })

  it('counts unpriced holdings instead of dropping them silently', () => {
    // The dangerous case: a missing price shrinks the denominator, so the
    // weight comes out too large while still looking entirely plausible.
    const positions = [
      position({ assetId: AAPL, symbol: 'AAPL', shares: 100 }),
      position({ assetId: MSFT, symbol: 'MSFT', shares: 100 }),
      position({ assetId: 'asset-x', symbol: 'XXX', shares: 100 }),
    ]
    const prices = new Map([['AAPL', 30], ['MSFT', 70]])

    const [result] = computeWeights(positions, prices, AAPL)

    expect(result.unpricedCount).toBe(1)
    expect(result.holdingsCount).toBe(3)
    // The figure is still reported, but the caller can see it is incomplete
    // and that the true weight is lower than this.
    expect(result.weight).toBeCloseTo(30, 10)
  })

  it('reports no weight when the asset itself cannot be priced', () => {
    const positions = [
      position({ assetId: AAPL, symbol: 'AAPL', shares: 100 }),
      position({ assetId: MSFT, symbol: 'MSFT', shares: 100 }),
    ]
    const prices = new Map([['MSFT', 70]])

    const [result] = computeWeights(positions, prices, AAPL)

    // Better to say nothing than to imply a weight of zero.
    expect(result.marketValue).toBeNull()
    expect(result.weight).toBeNull()
    expect(result.unpricedCount).toBe(1)
  })

  it('reports no weight when nothing in the portfolio could be priced', () => {
    const positions = [position({ symbol: 'AAPL' })]

    const [result] = computeWeights(positions, new Map(), AAPL)

    expect(result.weight).toBeNull()
  })

  it('separates portfolios and orders heaviest first', () => {
    const positions = [
      position({ portfolioId: 'p1', portfolioName: 'Small', shares: 10 }),
      position({ portfolioId: 'p1', assetId: MSFT, symbol: 'MSFT', shares: 990 }),
      position({ portfolioId: 'p2', portfolioName: 'Concentrated', shares: 900 }),
      position({ portfolioId: 'p2', assetId: MSFT, symbol: 'MSFT', shares: 100 }),
    ]
    const prices = new Map([['AAPL', 1], ['MSFT', 1]])

    const results = computeWeights(positions, prices, AAPL)

    expect(results.map(r => r.portfolioId)).toEqual(['p2', 'p1'])
    expect(results[0].weight).toBeCloseTo(90, 10)
    expect(results[1].weight).toBeCloseTo(1, 10)
  })

  it('omits portfolios that do not hold the asset', () => {
    const positions = [
      position({ portfolioId: 'p1' }),
      position({ portfolioId: 'p2', assetId: MSFT, symbol: 'MSFT' }),
    ]
    const prices = new Map([['AAPL', 10], ['MSFT', 10]])

    expect(computeWeights(positions, prices, AAPL).map(r => r.portfolioId)).toEqual(['p1'])
  })
})

describe('pickPrice', () => {
  it('prefers the live mark', () => {
    expect(pickPrice({ price: 412.3, previousClose: 408.1 })).toBe(412.3)
  })

  it('falls back to the previous close', () => {
    expect(pickPrice({ price: 0, previousClose: 408.1 })).toBe(408.1)
  })

  it('rejects the all-zero placeholder quote', () => {
    // getQuote never fails — it returns zeros. Reading that as a real price of
    // zero is what would corrupt the denominator.
    expect(pickPrice({ price: 0, previousClose: 0 })).toBeNull()
    expect(pickPrice(null)).toBeNull()
  })
})
