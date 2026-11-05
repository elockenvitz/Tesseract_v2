import { describe, it, expect } from 'vitest'
import { heldNames } from '../held-positions'
import { largestWeightByAsset, type HoldingRow } from '../../portfolio/holdings'

/**
 * The theme Overview's "names held in portfolios" band.
 *
 * Every assertion here is numeric on purpose. `portfolio_holdings` is a dated
 * table and double-counting a re-uploaded book is a documented recurring
 * defect in this codebase: the wrong answer has the right shape, reads as a
 * plausible exposure, and nothing fails.
 */

const row = (
  portfolio_id: string,
  asset_id: string,
  shares: number,
  price: number,
  date: string,
  name?: string,
): HoldingRow => ({
  portfolio_id, asset_id, shares, price, cost: null, date,
  ...(name ? { portfolios: { name } } : {}),
})

describe('a book uploaded twice is still one book', () => {
  /* Two uploads of the same two-line book, and the book CHANGED between
     them: b was bought up. Current book is 100k of a and 300k of b, so a is
     25%.

     The second upload deliberately differs from the first. A uniform
     re-upload is invisible to a ratio check -- doubling both lines leaves
     50/50 either way -- which is exactly how a double-count survives a test
     that looks like it covers this. Summing raw rows here gives a = 200k of
     600k = 33.3%, which this catches. */
  const twice: HoldingRow[] = [
    row('p1', 'a', 1000, 100, '2026-01-01', 'Growth'),
    row('p1', 'b', 1000, 100, '2026-01-01', 'Growth'),
    row('p1', 'a', 1000, 100, '2026-02-01', 'Growth'),
    row('p1', 'b', 3000, 100, '2026-02-01', 'Growth'),
  ]

  it('weights each line against the current book, not every upload', () => {
    const { names } = heldNames(twice, ['a', 'b'])
    expect(names).toHaveLength(2)

    const byId = new Map(names.map(n => [n.assetId, n.topWeightPct]))
    expect(byId.get('a')).toBeCloseTo(25, 6)
    expect(byId.get('b')).toBeCloseTo(75, 6)
    // 33.3 / 66.7 is the raw-sum answer across both uploads.
    expect(byId.get('a')).not.toBeCloseTo(33.33, 1)
  })

  it('lists the book once, not once per upload', () => {
    const { names, bookCount } = heldNames(twice, ['a', 'b'])
    expect(bookCount).toBe(1)
    expect(names[0].books).toHaveLength(1)
  })
})

describe('a back-dated upload does not become the current position', () => {
  it('reads the newest DATE, not the last row seen', () => {
    /* The stale row arrives after the current one, which is what an
       out-of-order insert looks like. Current book: a is 2000 of 3000. */
    const rows = [
      row('p1', 'a', 2000, 1, '2026-03-01'),
      row('p1', 'b', 1000, 1, '2026-03-01'),
      row('p1', 'a', 1, 1, '2025-01-01'),
    ]
    const { names } = heldNames(rows, ['a'])
    expect(names[0].topWeightPct).toBeCloseTo((2000 / 3000) * 100, 6)
  })
})

describe('the same name in two books is two stakes, never one', () => {
  const rows = [
    // Book 1: a is 25% of 400k.
    row('p1', 'a', 1000, 100, '2026-01-01', 'Large Cap Growth'),
    row('p1', 'x', 3000, 100, '2026-01-01', 'Large Cap Growth'),
    // Book 2: a is 4% of 2.5m.
    row('p2', 'a', 1000, 100, '2026-01-01', 'Vision Fund'),
    row('p2', 'y', 24000, 100, '2026-01-01', 'Vision Fund'),
  ]

  it('reports the largest single-book stake and never the total', () => {
    const { names } = heldNames(rows, ['a'])
    expect(names[0].topWeightPct).toBeCloseTo(25, 6)
    // The sum would be 29, which is 29% of nothing: different denominators.
    expect(names[0].topWeightPct).not.toBeCloseTo(29, 1)
  })

  it('keeps both books, heaviest first, each with its own name', () => {
    const { names, bookCount } = heldNames(rows, ['a'])
    expect(bookCount).toBe(2)
    expect(names[0].books.map(b => [b.name, Math.round(b.weightPct)]))
      .toEqual([['Large Cap Growth', 25], ['Vision Fund', 4]])
  })

  it('agrees with largestWeightByAsset, which states the same rule', () => {
    /* Two places could drift. They cannot differ, because this is the max
       over the same per-book map the other function maxes over. */
    const { names } = heldNames(rows, ['a'])
    expect(names[0].topWeightPct).toBeCloseTo(largestWeightByAsset(rows).a, 6)
  })
})

describe('only the theme\'s names come back', () => {
  it('ignores the rest of the book it had to read to get a denominator', () => {
    /* `useHoldingsForAssets` returns whole books on purpose: a weight's
       denominator is the book. Those other lines must not be presented as
       part of the theme. */
    const rows = [
      row('p1', 'theme-name', 1000, 100, '2026-01-01'),
      row('p1', 'something-else', 9000, 100, '2026-01-01'),
    ]
    const { names } = heldNames(rows, ['theme-name'])
    expect(names.map(n => n.assetId)).toEqual(['theme-name'])
  })
})

describe('what the firm does not own', () => {
  it('separates unheld names rather than dropping them', () => {
    const rows = [row('p1', 'held', 1000, 100, '2026-01-01')]
    const { names, unheldAssetIds } = heldNames(rows, ['held', 'watched', 'also-watched'])
    expect(names.map(n => n.assetId)).toEqual(['held'])
    expect(unheldAssetIds).toEqual(['also-watched', 'watched'])
  })

  it('treats a position sold to zero as unheld', () => {
    /* buildBook derives weight from market value, so a zero-share line comes
       through at 0% rather than vanishing. Listing it would claim a position
       that no longer exists. */
    const rows = [
      row('p1', 'sold', 0, 100, '2026-02-01'),
      row('p1', 'kept', 1000, 100, '2026-02-01'),
    ]
    const { names, unheldAssetIds } = heldNames(rows, ['sold', 'kept'])
    expect(names.map(n => n.assetId)).toEqual(['kept'])
    expect(unheldAssetIds).toEqual(['sold'])
  })

  it('reports everything unheld when there are no rows at all', () => {
    const { names, unheldAssetIds, bookCount } = heldNames([], ['a', 'b'])
    expect(names).toEqual([])
    expect(unheldAssetIds).toEqual(['a', 'b'])
    expect(bookCount).toBe(0)
  })

  it('returns nothing at all for a theme with no assets', () => {
    const rows = [row('p1', 'a', 1000, 100, '2026-01-01')]
    expect(heldNames(rows, [])).toEqual({ names: [], unheldAssetIds: [], bookCount: 0 })
  })
})

describe('a book the reader cannot name', () => {
  it('still counts the position, with a null name', () => {
    /* `portfolios` is joined by the caller and can come back null for a book
       the reader cannot see by name. The exposure is real either way, so it
       renders nameless rather than disappearing. */
    const rows = [row('p1', 'a', 1000, 100, '2026-01-01')]
    const { names } = heldNames(rows, ['a'])
    expect(names[0].books[0].name).toBeNull()
    expect(names[0].topWeightPct).toBeCloseTo(100, 6)
  })
})
