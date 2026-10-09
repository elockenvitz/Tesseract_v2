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

/** Shorthand for a book of holdings with no market values worth stating. */
const pnls = (...vs: Array<number | null | undefined>) => vs.map(pnl => ({ pnl }))

describe('a day total never invents the holdings it could not price', () => {
  it('sums what is priced and counts what is not', () => {
    const r = sumDayPnl(pnls(100, null, -40, null, 5))
    expect(r.total).toBe(65)
    expect(r.pricedCount).toBe(3)
    expect(r.unpricedCount).toBe(2)
  })

  /** THE regression. This is the exact shape the running app produced. */
  it('reports NO total when nothing could be priced, not zero', () => {
    const r = sumDayPnl(pnls(null, null, null))
    expect(r.total).toBeNull()
    expect(r.unpricedCount).toBe(3)
    // The old code produced 0 here and rendered it as the day's P&L.
    expect(r.total).not.toBe(0)
  })

  it('still reports zero when zero is what was actually measured', () => {
    // A book of cash, or a day everything closed flat. The difference from
    // the case above is that something was observed.
    const r = sumDayPnl(pnls(0, 0, 0))
    expect(r.total).toBe(0)
    expect(r.pricedCount).toBe(3)
    expect(r.unpricedCount).toBe(0)
  })

  it('counts a genuine zero as priced, so cash does not read as unknown', () => {
    const r = sumDayPnl(pnls(0, 250, null))
    expect(r.total).toBe(250)
    expect(r.pricedCount).toBe(2)
    expect(r.unpricedCount).toBe(1)
  })

  it('treats a non-finite value as unknown rather than poisoning the total', () => {
    // NaN would otherwise make the whole book's P&L NaN, which renders as
    // "$NaN" — visibly broken, but only after it has already been summed.
    const r = sumDayPnl(pnls(10, NaN, Infinity, undefined, 5))
    expect(r.total).toBe(15)
    expect(r.unpricedCount).toBe(3)
  })

  it('has no total for an empty book', () => {
    const r = sumDayPnl([])
    expect(r.total).toBeNull()
    expect(r.pricedCount).toBe(0)
  })
})

describe('the numerator and the denominator cover the same holdings', () => {
  /*
   * The second defect in this arithmetic, and a quieter one than the zeros.
   * The sum covered priced holdings; the percentage divided it by the WHOLE
   * book. A subset over a superset understates the return by the share of
   * the book that is unpriced — a figure that looks measured and is not.
   */
  const BOOK = [
    { pnl: 1200, marketValue: 40_000 },
    { pnl: 1800, marketValue: 60_000 },
    { pnl: null, marketValue: 15_000 },   // unpriced, and worth real money
  ]

  it('accumulates market value only for the holdings it could price', () => {
    const r = sumDayPnl(BOOK)
    expect(r.total).toBe(3000)
    expect(r.pricedMarketValue).toBe(100_000)
    expect(r.unpricedCount).toBe(1)
    // Emphatically NOT the book's $115,000.
    expect(r.pricedMarketValue).not.toBe(115_000)
  })

  /** THE regression for the denominator. */
  it('returns the priced holdings\' own return, not a diluted one', () => {
    const r = sumDayPnl(BOOK)
    const correct = dayReturnPct(r.total, r.pricedMarketValue)
    const diluted = dayReturnPct(r.total, 115_000)
    // 3000 on an opening 97,000 is +3.09%. Against the whole book it reads
    // +2.68% — the same dollars, understated by a fifth.
    expect(correct).toBeCloseTo(3000 / 97_000 * 100, 8)
    expect(diluted).toBeCloseTo(3000 / 112_000 * 100, 8)
    expect(correct).toBeGreaterThan(diluted!)
  })

  it('is unaffected when every holding is priced', () => {
    // The two denominators coincide exactly when nothing is missing, which
    // is why this went unnoticed on a fully priced book.
    const all = [{ pnl: 1200, marketValue: 40_000 }, { pnl: 1800, marketValue: 60_000 }]
    const r = sumDayPnl(all)
    expect(r.pricedMarketValue).toBe(100_000)
    expect(dayReturnPct(r.total, r.pricedMarketValue))
      .toBeCloseTo(dayReturnPct(r.total, 100_000)!, 10)
  })

  it('ignores a missing market value rather than counting it as zero', () => {
    const r = sumDayPnl([{ pnl: 100, marketValue: 5_000 }, { pnl: 50 }])
    expect(r.total).toBe(150)
    expect(r.pricedMarketValue).toBe(5_000)
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
