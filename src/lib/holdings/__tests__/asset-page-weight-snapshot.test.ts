/**
 * A weight divides by its own book, or it is not a weight.
 *
 * ── The defect this file exists to keep out ───────────────────────────────
 *
 * The Asset page took its NUMERATOR from `currentRows` — the newest row per
 * (portfolio, asset) — and its DENOMINATOR from `latestSnapshotRows` — the
 * portfolio's newest upload DATE. Both reductions are correct. They are
 * answers to different questions, and dividing one by the other compares a
 * position in one book against the value of another.
 *
 * It is silent whenever a portfolio has a single upload date, which 32 of 37
 * production portfolios do, so the page looked right for years. On the five
 * with a history it produced 27 wrong weights, 25 of them above 100%, and
 * the two below 100% were wrong without saying so.
 *
 * ── Why these tests are not source assertions ────────────────────────────
 *
 * The guard that already existed asserted which EXPRESSION the component
 * used (`not.toContain('(totalCost / ptotal)')`). It passed against this
 * defect from the day the defect shipped, because the defect used a
 * different expression. So the rule is stated here as arithmetic instead:
 * `mixedDateWeight` below is the original implementation, kept executable so
 * every test can be run against it and seen to fail.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildBook, currentRows, weightsByAsset, type HoldingRow,
} from '../../portfolio/holdings'
import { latestSnapshotRows } from '../latest-snapshot'

const src = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8')

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

const row = (o: Partial<HoldingRow> & { portfolio_id: string; asset_id: string }): HoldingRow => ({
  shares: 100, price: 10, cost: 10, date: '2026-08-01', ...o,
})

/**
 * The original implementation, verbatim in behaviour.
 *
 * `AssetTab.tsx` built its numerator from `currentRows(...)` and its
 * denominator from `latestSnapshotRows(...)` summed at the book price. Every
 * `it()` in this file is run against this as well as against the fix, and
 * must distinguish them — that is the non-vacuity proof required by
 * CLAUDE.md standing rule 3.
 */
function mixedDateWeight(
  portfolioId: string,
  assetId: string,
  rows: readonly HoldingRow[],
): number | null {
  const position = currentRows(rows)
    .find(r => r.portfolio_id === portfolioId && r.asset_id === assetId)
  if (!position) return null
  const denominator = latestSnapshotRows(rows.filter(r => r.portfolio_id === portfolioId))
    .reduce((sum, r) => sum + num(r.shares) * num(r.price ?? r.cost), 0)
  if (!(denominator > 0)) return null
  return (num(position.shares) * num(position.price ?? position.cost)) / denominator * 100
}

/** What the fixed page computes: the line's weight inside its own book. */
function bookWeight(
  portfolioId: string,
  assetId: string,
  rows: readonly HoldingRow[],
): number | null {
  const book = buildBook(portfolioId, rows)
  const position = book.positions.find(p => p.assetId === assetId)
  if (!position) return null
  if (!(book.totalValue > 0)) return null
  return position.weightPct
}

/**
 * Vision Fund 10K, to the cent.
 *
 * Its real uploads: 2026-04-13 holds 26 rows worth $95,393,456.36 and is the
 * only book AMZN appears in; 2026-04-24 holds 2 rows worth $2,068,233.88.
 * The other 24 lines of the 04-13 book are collapsed into one row here —
 * what matters is the book's value, not how many names carry it.
 */
const AMZN_MARKET_VALUE = 16947 * 232.99          // 3,948,481.53
const BOOK_0413 = 95_393_456.36
const BOOK_0424 = 2_068_233.88

const visionFund = (): HoldingRow[] => [
  row({ portfolio_id: 'vf10k', asset_id: 'amzn', shares: 16947, price: 232.99, date: '2026-04-13' }),
  row({
    portfolio_id: 'vf10k', asset_id: 'rest-of-0413',
    shares: 1, price: BOOK_0413 - AMZN_MARKET_VALUE, date: '2026-04-13',
  }),
  // The later, much smaller upload. Two names, neither of them AMZN.
  row({ portfolio_id: 'vf10k', asset_id: 'late-a', shares: 1, price: BOOK_0424 / 2, date: '2026-04-24' }),
  row({ portfolio_id: 'vf10k', asset_id: 'late-b', shares: 1, price: BOOK_0424 / 2, date: '2026-04-24' }),
]

describe('the reported defect, reproduced and then absent', () => {
  it('reproduces 190.91% from the original implementation', () => {
    // The number the founder saw on screen. If this stops reproducing, the
    // fixture has drifted and the rest of this file proves nothing.
    const shown = mixedDateWeight('vf10k', 'amzn', visionFund())
    expect(shown).not.toBeNull()
    expect(shown!.toFixed(2)).toBe('190.91')
  })

  it('divides AMZN by a book it was never part of', () => {
    // Why it is 190.91: the numerator is the 04-13 book's AMZN line and the
    // denominator is the whole of a two-name 04-24 upload.
    expect(AMZN_MARKET_VALUE / BOOK_0424 * 100).toBeCloseTo(190.91, 2)
    expect(AMZN_MARKET_VALUE).toBeGreaterThan(BOOK_0424)
  })

  it('reports a weight below 100% once the book is coherent', () => {
    const fixed = bookWeight('vf10k', 'amzn', visionFund())
    expect(fixed).not.toBeNull()
    expect(fixed!).toBeLessThan(100)
    // AMZN over the union of every line's newest row: 97,461,690.24.
    expect(fixed!).toBeCloseTo(AMZN_MARKET_VALUE / (BOOK_0413 + BOOK_0424) * 100, 6)
  })
})

describe('the invariant: numerator and denominator come from one book', () => {
  /**
   * Stated as a property rather than a number, because the property is what
   * must hold for books this fixture does not describe: if every line of a
   * book is weighed against the same denominator, the weights total 100%.
   * The mixed-date implementation cannot satisfy this and that is the whole
   * defect — the test below runs both and requires them to differ.
   */
  const sumOfWeights = (portfolioId: string, rows: readonly HoldingRow[], f: typeof bookWeight) => {
    const assetIds = [...new Set(
      currentRows(rows).filter(r => r.portfolio_id === portfolioId).map(r => r.asset_id),
    )]
    return assetIds.reduce((s, id) => s + (f(portfolioId, id, rows) ?? 0), 0)
  }

  it('totals 100% across the book under the fix', () => {
    expect(sumOfWeights('vf10k', visionFund(), bookWeight)).toBeCloseTo(100, 6)
  })

  it('does NOT total 100% under the original implementation', () => {
    // 4,712% on this book. A weight set that does not sum to 100 is not a
    // weight set, and nothing in the product noticed for the life of the bug.
    const total = sumOfWeights('vf10k', visionFund(), mixedDateWeight)
    expect(total).toBeGreaterThan(1000)
    expect(Math.abs(total - 100)).toBeGreaterThan(1)
  })
})

describe('a single coherent snapshot', () => {
  const oneUpload = (): HoldingRow[] => [
    row({ portfolio_id: 'p1', asset_id: 'a', shares: 100, price: 25, date: '2026-08-01' }),
    row({ portfolio_id: 'p1', asset_id: 'b', shares: 100, price: 75, date: '2026-08-01' }),
  ]

  it('agrees with the original implementation, which is why this went unseen', () => {
    // Both reductions see the same rows when there is only one date, so the
    // defect is invisible on 32 of 37 production portfolios. Pinned so a
    // future change cannot "fix" the bug by moving the correct case.
    expect(bookWeight('p1', 'a', oneUpload())).toBeCloseTo(25, 6)
    expect(mixedDateWeight('p1', 'a', oneUpload())).toBeCloseTo(25, 6)
  })
})

describe('multiple snapshot dates', () => {
  const reUploaded = (): HoldingRow[] => [
    row({ portfolio_id: 'p1', asset_id: 'a', shares: 100, price: 25, date: '2026-06-01' }),
    row({ portfolio_id: 'p1', asset_id: 'b', shares: 100, price: 75, date: '2026-06-01' }),
    row({ portfolio_id: 'p1', asset_id: 'a', shares: 100, price: 50, date: '2026-08-01' }),
    row({ portfolio_id: 'p1', asset_id: 'b', shares: 100, price: 50, date: '2026-08-01' }),
  ]

  it('reads the newest upload and does not double-count the older one', () => {
    const book = buildBook('p1', reUploaded())
    expect(book.totalValue).toBe(10_000)
    expect(book.positionCount).toBe(2)
    expect(bookWeight('p1', 'a', reUploaded())).toBeCloseTo(50, 6)
  })
})

describe('an asset missing from the latest portfolio snapshot', () => {
  it('keeps the position instead of dropping it', () => {
    // This is the AMZN case. `latestSnapshotRows` would delete the line
    // entirely; `currentRows` keeps the newest row it has. A position that
    // was not in this week's upload is still held.
    const book = buildBook('vf10k', visionFund())
    expect(book.positions.map(p => p.assetId)).toContain('amzn')
  })

  it('dates the weight to the upload the position came from, not the book', () => {
    const book = buildBook('vf10k', visionFund())
    const amzn = book.positions.find(p => p.assetId === 'amzn')!
    expect(amzn.asOf).toBe('2026-04-13')
    // The book's own asOf is the newest upload across it, which is NOT the
    // date of this line. Both are true and the UI must show the line's.
    expect(book.asOf).toBe('2026-04-24')
  })
})

describe('a partial newer snapshot', () => {
  it('does not let a two-name upload become the whole denominator', () => {
    const denominatorUsed = AMZN_MARKET_VALUE / (bookWeight('vf10k', 'amzn', visionFund())! / 100)
    expect(denominatorUsed).toBeCloseTo(BOOK_0413 + BOOK_0424, 2)
    expect(denominatorUsed).toBeGreaterThan(BOOK_0424 * 40)
  })

  it('and the original implementation did exactly that', () => {
    const denominatorUsed = AMZN_MARKET_VALUE / (mixedDateWeight('vf10k', 'amzn', visionFund())! / 100)
    expect(denominatorUsed).toBeCloseTo(BOOK_0424, 2)
  })
})

describe('a legitimate weight above 100%', () => {
  const levered = (): HoldingRow[] => [
    row({ portfolio_id: 'p1', asset_id: 'long', shares: 150, price: 10, date: '2026-08-01' }),
    // A short. Negative market value is a real book line, not bad data.
    row({ portfolio_id: 'p1', asset_id: 'short', shares: -50, price: 10, date: '2026-08-01' }),
  ]

  it('is reported, not clamped', () => {
    const book = buildBook('p1', levered())
    expect(book.totalValue).toBe(1_000)
    expect(bookWeight('p1', 'long', levered())).toBeCloseTo(150, 6)
    expect(bookWeight('p1', 'short', levered())).toBeCloseTo(-50, 6)
  })

  it('still totals 100% across the book', () => {
    // The point of keeping this case: the fix must not "solve" >100% by
    // capping it, because then a real levered book reads as a bug.
    const book = buildBook('p1', levered())
    expect(book.positions.reduce((s, p) => s + p.weightPct, 0)).toBeCloseTo(100, 6)
  })
})

describe('a missing or zero denominator', () => {
  it('is zero, never Infinity or NaN', () => {
    const unpriced = [
      row({ portfolio_id: 'p1', asset_id: 'a', shares: 100, price: 0, cost: 0, date: '2026-08-01' }),
    ]
    const book = buildBook('p1', unpriced)
    expect(book.totalValue).toBe(0)
    expect(book.positions[0].weightPct).toBe(0)
    expect(Number.isFinite(book.positions[0].weightPct)).toBe(true)
    // And the accessor the page reads refuses to answer at all, so the cell
    // shows an em dash rather than "0.00%" of an unknown book.
    expect(bookWeight('p1', 'a', unpriced)).toBeNull()
  })

  it('is null for an asset the book does not hold', () => {
    expect(bookWeight('vf10k', 'never-held', visionFund())).toBeNull()
  })
})

describe('portfolio and organization isolation', () => {
  const twoBooks = (): HoldingRow[] => [
    row({ portfolio_id: 'p1', asset_id: 'a', shares: 100, price: 10, date: '2026-08-01' }),
    row({ portfolio_id: 'p1', asset_id: 'b', shares: 300, price: 10, date: '2026-08-01' }),
    // The same name, a very different stake, in another book.
    row({ portfolio_id: 'p2', asset_id: 'a', shares: 100, price: 10, date: '2026-08-01' }),
  ]

  it('never mixes another portfolio into the denominator', () => {
    expect(bookWeight('p1', 'a', twoBooks())).toBeCloseTo(25, 6)
    expect(bookWeight('p2', 'a', twoBooks())).toBeCloseTo(100, 6)
    expect(buildBook('p1', twoBooks()).totalValue).toBe(4_000)
    expect(buildBook('p2', twoBooks()).totalValue).toBe(1_000)
  })

  it('scopes the page query to one portfolio per book', () => {
    /*
     * Organisation isolation on this path is enforced by RLS on
     * `portfolio_holdings` (org-scoped on all four verbs), so the rows handed
     * to `buildBook` are already siloed and a pure function cannot be the
     * place that check lives. What IS checkable here is that the query asks
     * for one portfolio at a time: a book-wide read with no portfolio filter
     * would put another portfolio's lines in this denominator, which is the
     * same class of defect one level up.
     */
    const body = src('components/tabs/AssetTab.tsx')
    const query = body.slice(body.indexOf("const { data: portfolioBooks }"))
      .slice(0, 1_600)
    expect(query).toContain(".eq('portfolio_id', portfolioId)")
    expect(query).toContain('buildBook(portfolioId')
  })
})

describe('the Asset page and the Portfolio workspace agree', () => {
  it('returns the same weight through both entry points', () => {
    // `weightsByAsset` is what Portfolio, Research and Ideas read;
    // `buildBook(...).positions` is what the Asset page now reads. Same rows
    // in, same number out, or the surfaces have forked again.
    const rows = visionFund()
    const viaWorkspace = weightsByAsset(rows).get('amzn')!.get('vf10k')!
    const viaAssetPage = bookWeight('vf10k', 'amzn', rows)!
    expect(viaAssetPage).toBeCloseTo(viaWorkspace, 10)
  })

  it('and the original implementation disagreed with it by 187 points', () => {
    const rows = visionFund()
    const viaWorkspace = weightsByAsset(rows).get('amzn')!.get('vf10k')!
    const viaOldAssetPage = mixedDateWeight('vf10k', 'amzn', rows)!
    expect(Math.abs(viaOldAssetPage - viaWorkspace)).toBeGreaterThan(150)
  })
})

describe('the component no longer carries the defective arithmetic', () => {
  /*
   * Secondary to the arithmetic above, and deliberately so: this is the check
   * the previous guard got wrong by making it the ONLY check. It is here to
   * catch a reintroduction by copy-paste, not to stand in for the numbers.
   */
  it('has no weight divided by a separately-fetched portfolio total', () => {
    const body = src('components/tabs/AssetTab.tsx')
    expect(body).not.toContain('portfolioTotals?.[')
    expect(body).not.toMatch(/\/\s*ptotal\s*\*\s*100/)
    expect(body).not.toMatch(/\/\s*portfolioTotal\s*\)\s*\*\s*100/)
  })

  it('reads every exposure figure through the one accessor', () => {
    const body = src('components/tabs/AssetTab.tsx')
    /*
     * A lower bound, not an exact count.
     *
     * This demanded exactly 3 — the Work sidebar, the exposure tiles and the
     * holdings table. A fourth surface was then added and correctly routed
     * through the accessor, and the test failed for the rule being FOLLOWED.
     * Counting call sites measures how many surfaces exist, which is not the
     * invariant; the invariant is that none of them does the arithmetic
     * itself, and the sibling test above is what enforces that.
     */
    expect(body.match(/exposureIn\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
    expect(body).toContain('const exposureIn = useCallback(')
  })
})
