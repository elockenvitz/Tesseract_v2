import { describe, it, expect } from 'vitest'

import { sumDayPnl, dayReturnPct } from '../day-pnl'

/**
 * The investor-facing defect this encodes.
 *
 * Both portfolio tabs computed `dayChange = quote?.change ?? 0` and summed
 * it. The quote layer returned `change: 0` for every symbol (it read a field
 * name Yahoo does not send on a daily range — see
 * `quote-change-derivation.test.ts`), so a whole book of unpriced holdings
 * summed to a clean $0.00 and the header rendered it as today's result. Not
 * a blank cell: a confident, wrong, aggregate figure.
 *
 * The distinction these tests defend is "nothing moved" versus "we cannot
 * say", which `?? 0` destroys and only null preserves.
 */

describe('a day total never invents the holdings it could not price', () => {
  it('sums what is priced and counts what is not', () => {
    const r = sumDayPnl([100, null, -40, null, 5])
    expect(r.total).toBe(65)
    expect(r.pricedCount).toBe(3)
    expect(r.unpricedCount).toBe(2)
  })

  /** THE regression. This is the exact shape the running app produced. */
  it('reports NO total when nothing could be priced, not zero', () => {
    const r = sumDayPnl([null, null, null])
    expect(r.total).toBeNull()
    expect(r.unpricedCount).toBe(3)
    // The old code produced 0 here and rendered it as the day's P&L.
    expect(r.total).not.toBe(0)
  })

  it('still reports zero when zero is what was actually measured', () => {
    // A book of cash, or a day everything closed flat. The difference from
    // the case above is that something was observed.
    const r = sumDayPnl([0, 0, 0])
    expect(r.total).toBe(0)
    expect(r.pricedCount).toBe(3)
    expect(r.unpricedCount).toBe(0)
  })

  it('counts a genuine zero as priced, so cash does not read as unknown', () => {
    const r = sumDayPnl([0, 250, null])
    expect(r.total).toBe(250)
    expect(r.pricedCount).toBe(2)
    expect(r.unpricedCount).toBe(1)
  })

  it('treats a non-finite value as unknown rather than poisoning the total', () => {
    // NaN would otherwise make the whole book's P&L NaN, which renders as
    // "$NaN" — visibly broken, but only after it has already been summed.
    const r = sumDayPnl([10, NaN, Infinity, undefined, 5])
    expect(r.total).toBe(15)
    expect(r.unpricedCount).toBe(3)
  })

  it('has no total for an empty book', () => {
    const r = sumDayPnl([])
    expect(r.total).toBeNull()
    expect(r.pricedCount).toBe(0)
  })
})

describe('the day return refuses what it cannot divide', () => {
  it('computes against the NAV the day opened from', () => {
    // Closed at 1,100 having made 100, so it opened at 1,000 — +10%.
    expect(dayReturnPct(100, 1100)).toBeCloseTo(10, 10)
  })

  it('is null when there is no total', () => {
    expect(dayReturnPct(null, 1100)).toBeNull()
  })

  it('is null rather than dividing by a non-positive opening NAV', () => {
    // The whole NAV is today's gain — arithmetically possible, financially
    // meaningless, and previously a division by zero dressed as a percentage.
    expect(dayReturnPct(1000, 1000)).toBeNull()
    expect(dayReturnPct(1500, 1000)).toBeNull()
  })

  it('reports a real zero return on a flat day', () => {
    expect(dayReturnPct(0, 1000)).toBe(0)
  })
})
