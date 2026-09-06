import { describe, expect, it } from 'vitest'

import { exposureByAsset, latestSnapshotIds, UNHELD } from '../holdings-context'

/**
 * The snapshot bug, made expressible.
 *
 * It survived because it was only expressible as a chained Supabase query —
 * `.order('weight_pct', {ascending: false})` followed by a client-side dedupe —
 * so nothing could assert against it. The production shape that proves it is
 * here as `VISION_FUND`: one portfolio, three snapshots, and an asset whose
 * weight fell between the oldest and the newest.
 */

const snap = (id: string, portfolio: string, date: string | null) =>
  ({ id, portfolio_id: portfolio, snapshot_date: date })

const pos = (
  snapshot: string | null, portfolio: string | null, asset: string,
  weight: number | null, created: string, name = 'Vision Fund 10K',
) => ({
  snapshot_id: snapshot, portfolio_id: portfolio, asset_id: asset,
  weight_pct: weight, created_at: created, portfolios: { name },
})

/** The real production shape: one book, three uploads, no ledger rows. */
const VISION_FUND = [
  pos('s3', 'p1', 'aapl', 5.0, '2026-04-15T01:02:26Z'),
  pos('s3', 'p1', 'msft', 5.1, '2026-04-15T01:02:26Z'),
  pos('s1', 'p1', 'aapl', 19.0, '2026-03-31T00:15:42Z'),
  pos('s2', 'p1', 'aapl', 12.0, '2026-03-31T00:15:42Z'),
]

describe('latest snapshot', () => {
  it('uses snapshot_date when the ledger knows the snapshot', () => {
    const ids = latestSnapshotIds(
      [snap('s1', 'p1', '2026-01-01'), snap('s2', 'p1', '2026-06-01')],
      VISION_FUND,
    )
    expect([...ids]).toEqual(['s2'])
  })

  it('falls back to the newest position when the ledger has no row', () => {
    /**
     * The case that decides whether this feature works at all.
     *
     * The one organisation with real research carries three seeded snapshot ids
     * with no matching `portfolio_holdings_snapshots` row. A derivation that
     * only consulted that table would return an empty set here and silently
     * drop every position — so the org whose research the family exists to
     * surface would lose all of its exposure context.
     */
    const ids = latestSnapshotIds([], VISION_FUND)
    expect([...ids]).toEqual(['s3'])
  })

  it('lets a ledger-known snapshot beat an orphan whatever the row dates say', () => {
    // A real upload must not be outranked by a fixture that happens to have
    // newer rows.
    const ids = latestSnapshotIds(
      [snap('s1', 'p1', '2026-01-01')],
      [...VISION_FUND],
    )
    expect([...ids]).toEqual(['s1'])
  })

  it('picks one per portfolio, not one overall', () => {
    const ids = latestSnapshotIds([], [
      pos('a1', 'p1', 'x', 1, '2026-05-01T00:00:00Z'),
      pos('a2', 'p1', 'x', 1, '2026-06-01T00:00:00Z'),
      pos('b1', 'p2', 'y', 1, '2026-02-01T00:00:00Z'),
    ])
    expect([...ids].sort()).toEqual(['a2', 'b1'])
  })

  it('is reproducible when everything ties, rather than row-order dependent', () => {
    // PostgREST does not guarantee row order without a total sort, so a tie
    // resolved by "whichever came first" would flip between refreshes.
    const rows = [
      pos('z', 'p1', 'x', 1, '2026-05-01T00:00:00Z'),
      pos('a', 'p1', 'x', 1, '2026-05-01T00:00:00Z'),
    ]
    expect([...latestSnapshotIds([], rows)]).toEqual([...latestSnapshotIds([], [...rows].reverse())])
  })
})

describe('exposure', () => {
  it('takes the current weight, not the largest one ever held', () => {
    /**
     * The bug, stated as the assertion that would have caught it. Ordering the
     * whole history by weight and deduping returns AAPL at 19% — a figure from
     * a March upload superseded twice over — beside a case written in April.
     */
    const e = exposureByAsset(VISION_FUND, latestSnapshotIds([], VISION_FUND))
    expect(e.get('aapl')?.weightPct).toBe(5.0)
    expect(e.get('aapl')?.portfolioName).toBe('Vision Fund 10K')
  })

  it('drops assets that only exist in a superseded snapshot', () => {
    // A name sold out of the book is not currently held, and a card claiming
    // it is would be describing a position that no longer exists.
    const rows = [...VISION_FUND, pos('s1', 'p1', 'sold', 4, '2026-03-31T00:15:42Z')]
    const e = exposureByAsset(rows, latestSnapshotIds([], rows))
    expect(e.has('sold')).toBe(false)
  })

  it('keeps a held name whose weight is absent, without inventing one', () => {
    // 26 of 36 rows in the current production snapshot have no weight.
    const rows = [pos('s1', 'p1', 'nvda', null, '2026-04-15T00:00:00Z')]
    const e = exposureByAsset(rows, latestSnapshotIds([], rows))
    expect(e.get('nvda')).toMatchObject({ held: true, weightPct: null, portfolioName: 'Vision Fund 10K' })
  })

  it('names the largest weight and counts the books when a name sits in several', () => {
    const rows = [
      pos('s1', 'p1', 'x', 2.0, '2026-04-01T00:00:00Z', 'Core'),
      pos('s2', 'p2', 'x', 7.5, '2026-04-01T00:00:00Z', 'Growth'),
    ]
    const e = exposureByAsset(rows, latestSnapshotIds([], rows))
    expect(e.get('x')).toMatchObject({ weightPct: 7.5, portfolioName: 'Growth', portfolioCount: 2 })
  })

  it('keeps unsnapshotted rows, which are the only record of themselves', () => {
    const rows = [pos(null, 'p1', 'x', 3, '2026-04-01T00:00:00Z')]
    expect(exposureByAsset(rows, new Set()).get('x')?.held).toBe(true)
  })

  it('reports an unheld name as unheld rather than as a zero', () => {
    expect(UNHELD).toMatchObject({ held: false, weightPct: null, portfolioCount: 0 })
  })
})
