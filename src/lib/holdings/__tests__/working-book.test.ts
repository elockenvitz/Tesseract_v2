import { describe, expect, it } from 'vitest'
import { workingBookRows } from '../working-book'

/**
 * The contract this file pins was INVERTED by the working-book migration,
 * and the inversion is the point.
 *
 * `workingBookRows` used to keep every row on a portfolio's newest date,
 * which was correct while `portfolio_holdings` was UNIQUE on
 * (portfolio_id, asset_id, date). The table is now the current working book:
 * one row per (portfolio_id, asset_id), and `date` records when that single
 * line last changed.
 *
 * Under the new schema the old rule is not conservative, it is destructive.
 * A book whose AAPL moved today and whose other 34 names last moved in May
 * has 35 different dates in it and all 35 positions are current; filtering
 * to the newest would show a one-name book. That is precisely the failure
 * this helper was written to prevent, arrived at from the other direction —
 * and it was live, on four production books in four organizations, because
 * a single accepted trade wrote one asset at today's date.
 *
 * So the tests below assert the opposite of the ones they replace. The
 * clearest of them is "every dated row survives": it passes now and failed
 * before, which is the only honest way to show a contract changed.
 */

type Row = { portfolio_id?: string; asset_id?: string; date?: string; shares: number; price: number }
const row = (o: Partial<Row>): Row => ({ shares: 10, price: 100, ...o })

describe('the working book is every row, whatever its date', () => {
  it('keeps positions that last moved on different dates', () => {
    // The shape a trade leaves behind: one name touched today, the rest of
    // the book untouched since May. The old rule returned only `aapl`.
    const rows = [
      row({ portfolio_id: 'p1', asset_id: 'aapl', date: '2026-06-16' }),
      row({ portfolio_id: 'p1', asset_id: 'msft', date: '2026-05-21' }),
      row({ portfolio_id: 'p1', asset_id: 'nvda', date: '2026-05-21' }),
    ]
    const out = workingBookRows(rows)
    expect(out).toHaveLength(3)
    expect(out.map(r => r.asset_id).sort()).toEqual(['aapl', 'msft', 'nvda'])
  })

  it('does not shrink a book to whatever a trade touched most recently', () => {
    // Vision Fund 10K as it actually stood on 2026-09-06: 29 positions, of
    // which 2 carried the newest date. The old rule valued the book at
    // $2.07m against a real $101.5m.
    const rows = [
      ...Array.from({ length: 27 }, (_, i) => row({
        portfolio_id: 'vf', asset_id: `a${i}`, date: '2026-04-13', shares: 10, price: 100,
      })),
      row({ portfolio_id: 'vf', asset_id: 'traded1', date: '2026-04-24', shares: 10, price: 100 }),
      row({ portfolio_id: 'vf', asset_id: 'traded2', date: '2026-04-24', shares: 10, price: 100 }),
    ]
    const total = workingBookRows(rows).reduce((n, r) => n + r.shares * r.price, 0)
    expect(workingBookRows(rows)).toHaveLength(29)
    expect(total).toBe(29_000)
  })

  it('is a no-op on data the database already guarantees', () => {
    const book = [
      row({ portfolio_id: 'p1', asset_id: 'a', date: '2026-08-01' }),
      row({ portfolio_id: 'p1', asset_id: 'b', date: '2026-08-01' }),
    ]
    expect(workingBookRows(book)).toEqual(book)
    expect(workingBookRows([])).toEqual([])
  })
})

describe('a duplicate is still counted once', () => {
  it('keeps the later state when the same position appears twice', () => {
    // Unreachable through the unique key, reachable through a fixture or a
    // merged result set — and a duplicate in a denominator is the failure
    // this module exists to prevent.
    const rows = [
      row({ portfolio_id: 'p1', asset_id: 'a', date: '2026-01-01', shares: 100 }),
      row({ portfolio_id: 'p1', asset_id: 'a', date: '2026-08-01', shares: 250 }),
    ]
    const out = workingBookRows(rows)
    expect(out).toHaveLength(1)
    expect(out[0].shares).toBe(250)
  })

  it('does not merge the same name held in two books', () => {
    // AAPL is 25.3% of one book and 4.0% of another. Keying on asset alone
    // would collapse them into whichever arrived first.
    const rows = [
      row({ portfolio_id: 'p1', asset_id: 'aapl', shares: 100, date: '2026-08-01' }),
      row({ portfolio_id: 'p2', asset_id: 'aapl', shares: 4, date: '2026-08-01' }),
    ]
    expect(workingBookRows(rows)).toHaveLength(2)
  })

  it('passes through rows selected without an asset id', () => {
    // Several callers select only `portfolio_id` to answer "which books hold
    // this name". Dropping those would turn a membership question into an
    // empty answer.
    const rows = [
      { portfolio_id: 'p1', date: '2026-08-01' },
      { portfolio_id: 'p2', date: '2026-03-01' },
    ]
    expect(workingBookRows(rows)).toHaveLength(2)
  })
})
