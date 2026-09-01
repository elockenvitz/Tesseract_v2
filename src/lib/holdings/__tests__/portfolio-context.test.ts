import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  currentBook, portfolioIssueKey, primaryBookFor, MIN_POSITIONS_FOR_WEIGHT,
  type HoldingRow,
} from '../portfolio-context'

/**
 * The rule every capital claim will rest on.
 *
 * ── Why these tests and not others ────────────────────────────────────────
 *
 * Each one pins a defect this codebase has already shipped. Summing across
 * snapshot dates inflated denominators 36x and made every conviction card emit
 * nothing rather than something visibly wrong. Taking the newest row per ASSET
 * resurrected positions the desk had exited. Rendering an unknown weight as 0%
 * turned "we cannot tell" into "it is nothing". None of the three was caught by
 * a test, because the rule only existed inside a query closure.
 */

const row = (over: Partial<HoldingRow> & { portfolio_id: string; asset_id: string }): HoldingRow => ({
  shares: 100, price: 10, date: '2026-08-01',
  portfolios: { id: over.portfolio_id, name: `Book ${over.portfolio_id}` },
  assets: { symbol: 'AAA', asset_type: 'equity' },
  ...over,
})

/** A book big enough for a weight claim: five priced positions. */
const book = (portfolioId: string, date: string, n = MIN_POSITIONS_FOR_WEIGHT): HoldingRow[] =>
  Array.from({ length: n }, (_, i) => row({
    portfolio_id: portfolioId, asset_id: `a${i}`, date,
    shares: 100, price: 10,
    assets: { symbol: `S${i}`, asset_type: 'equity' },
  }))

describe('the current book is one snapshot per portfolio', () => {
  it('never sums a position across its own history', () => {
    /**
     * The 36x defect. `portfolio_holdings` is a series of dated snapshots, so
     * a book uploaded ten times has ten rows for one position — and summing
     * them treats ten snapshots as ten positions.
     */
    const rows = [...book('p1', '2026-08-01'), ...book('p1', '2026-01-01')]
    const b = currentBook(rows)

    expect(b.byPortfolio.get('p1')!.positionCount).toBe(5)
    expect(b.byPortfolio.get('p1')!.totalValue).toBe(5000)
    expect(b.byPortfolio.get('p1')!.asOf).toBe('2026-08-01')
    // Each of five equal positions is a fifth of the book, not a tenth.
    expect(b.byKey.get('p1:a0')!.weightPct).toBeCloseTo(20, 5)
  })

  it('drops a name the desk exited, rather than resurrecting it', () => {
    // The newest row per (asset, portfolio) would keep July's position in an
    // August book. The newest row per PORTFOLIO does not.
    const rows = [
      ...book('p1', '2026-08-01'),
      row({ portfolio_id: 'p1', asset_id: 'gone', date: '2026-07-01' }),
    ]
    const b = currentBook(rows)
    expect(b.byKey.has('p1:gone')).toBe(false)
    expect(b.byAsset.has('gone')).toBe(false)
  })

  it('keeps each book on its own date, because uploads are not synchronised', () => {
    const rows = [...book('p1', '2026-08-01'), ...book('p2', '2026-03-01')]
    const b = currentBook(rows)
    expect(b.byPortfolio.get('p1')!.asOf).toBe('2026-08-01')
    expect(b.byPortfolio.get('p2')!.asOf).toBe('2026-03-01')
    // A single global max date would have emptied p2 entirely.
    expect(b.byPortfolio.get('p2')!.positionCount).toBe(5)
  })

  it('counts a name listed twice on one date once', () => {
    // The date filter removes other snapshots; this is the remaining way a
    // position could enter its own denominator twice.
    const rows = [
      ...book('p1', '2026-08-01'),
      row({ portfolio_id: 'p1', asset_id: 'a0', date: '2026-08-01' }),
    ]
    expect(currentBook(rows).byPortfolio.get('p1')!.positionCount).toBe(5)
  })
})

describe('weight is derived, and only where it means something', () => {
  it('divides market value by the book, not by a stored percentage', () => {
    const rows = [
      ...book('p1', '2026-08-01'),
      row({ portfolio_id: 'p1', asset_id: 'big', date: '2026-08-01', shares: 500, price: 10 }),
    ]
    const b = currentBook(rows)
    // 5000 of a 10000 book.
    expect(b.byKey.get('p1:big')!.weightPct).toBeCloseTo(50, 5)
    expect(b.byKey.get('p1:big')!.marketValue).toBe(5000)
  })

  it('refuses a precise share from a book too small to carry one', () => {
    /**
     * A two-position portfolio makes every position look enormous, so the size
     * that would justify a card is an artifact of the list length. Measured:
     * Vision Fund 10K's latest snapshot holds 2 positions.
     */
    const rows = book('p1', '2026-08-01', 2)
    const b = currentBook(rows)
    const pos = b.byKey.get('p1:a0')!
    expect(pos.held).toBe(true)
    expect(pos.weightIsMeaningful).toBe(false)
    // Null, and emphatically not 0 — see `materialityBand`, which gives
    // held-and-unweighted its own band rather than the bottom one.
    expect(pos.weightPct).toBeNull()
    expect(pos.weightPct).not.toBe(0)
    // And the reason is legible, so a caller can say why rather than guess.
    expect(pos.positionCount).toBe(2)
  })

  it('keeps three states distinguishable: measured, unknowable, absent', () => {
    const rows = [
      ...book('p1', '2026-08-01'),
      row({ portfolio_id: 'p1', asset_id: 'unpriced', date: '2026-08-01', price: null }),
    ]
    const b = currentBook(rows)

    // A — measured.
    expect(typeof b.byKey.get('p1:a0')!.weightPct).toBe('number')
    // B — held, but its share is not knowable. Never zero, never false.
    const unpriced = b.byKey.get('p1:unpriced')!
    expect(unpriced.held).toBe(true)
    expect(unpriced.weightPct).toBeNull()
    expect(unpriced.marketValue).toBeNull()
    // C — absent. There is no record at all, because a falsy record is what
    // gets rendered as "0.0%" by the next person to touch it.
    expect(b.byKey.has('p1:never-held')).toBe(false)
    expect(b.byAsset.get('never-held')).toBeUndefined()
  })
})

describe('cash is capital, not a position to write about', () => {
  it('counts cash in the denominator', () => {
    /**
     * Excluding it would inflate every other weight in the book. `isCashLine`
     * says cash is a legitimate subject for claims about SIZE and is excluded
     * only from claims that presuppose a price — which is the caller's
     * decision, so this flags rather than filters.
     */
    const rows = [
      ...book('p1', '2026-08-01'),
      row({
        portfolio_id: 'p1', asset_id: 'cash', date: '2026-08-01',
        shares: 5000, price: 1, assets: { symbol: 'CASH_USD', asset_type: 'cash' },
      }),
    ]
    const b = currentBook(rows)
    expect(b.byPortfolio.get('p1')!.totalValue).toBe(10000)
    expect(b.byKey.get('p1:a0')!.weightPct).toBeCloseTo(10, 5)
  })

  it('marks it, using the one existing classifier', () => {
    const rows = [
      ...book('p1', '2026-08-01'),
      row({
        portfolio_id: 'p1', asset_id: 'cash', date: '2026-08-01',
        assets: { symbol: 'CASH_USD', asset_type: 'cash' },
      }),
    ]
    const b = currentBook(rows)
    expect(b.byKey.get('p1:cash')!.isCash).toBe(true)
    expect(b.byKey.get('p1:a0')!.isCash).toBe(false)
    // No second cash classifier: the module imports `isCashLine`.
    const src = readFileSync(resolve(__dirname, '../portfolio-context.ts'), 'utf8')
    expect(src).toContain("import { isCashLine } from '../signals/instruments'")
    expect(src).not.toMatch(/CASH_|money_market/)
  })
})

describe('as-of is the book\'s date, never now', () => {
  it('carries the snapshot date the numbers came from', () => {
    /**
     * Stamping a card with the current time claimed a freshness the number
     * never had — it rendered as "book Aug 18" on weights from an April
     * snapshot.
     */
    const b = currentBook(book('p1', '2026-04-30'))
    expect(b.byKey.get('p1:a0')!.asOf).toBe('2026-04-30')
    expect(b.asOf).toBe('2026-04-30')
  })
})

describe('capital identity is a pair, not an asset', () => {
  it('gives the same asset in two books two contexts', () => {
    /**
     * AAPL at 15% of one book and 0.4% of another are two situations with two
     * answers. An asset-keyed derivation can only describe one of them, and
     * would collapse them into whichever was ranked first.
     */
    const rows = [
      ...book('p1', '2026-08-01'),
      row({ portfolio_id: 'p1', asset_id: 'aapl', date: '2026-08-01', shares: 500, price: 10 }),
      ...book('p2', '2026-08-01'),
      row({ portfolio_id: 'p2', asset_id: 'aapl', date: '2026-08-01', shares: 1, price: 10 }),
    ]
    const b = currentBook(rows)
    const both = b.byAsset.get('aapl')!
    expect(both).toHaveLength(2)
    expect(new Set(both.map(p => p.key)).size).toBe(2)
    expect(both[0].portfolioId).not.toBe(both[1].portfolioId)
    // Heaviest first, so `[0]` is the book the position matters most in rather
    // than whichever row arrived first.
    expect(both[0].weightPct!).toBeGreaterThan(both[1].weightPct!)
  })

  it('never sums a name across books into a number no portfolio has', () => {
    const rows = [
      ...book('p1', '2026-08-01'),
      row({ portfolio_id: 'p1', asset_id: 'aapl', date: '2026-08-01', shares: 500, price: 10 }),
      ...book('p2', '2026-08-01'),
      row({ portfolio_id: 'p2', asset_id: 'aapl', date: '2026-08-01', shares: 500, price: 10 }),
    ]
    const b = currentBook(rows)
    const primary = primaryBookFor(b, 'aapl')!
    // 50% in each book. Not 100% of anything.
    expect(primary.weightPct).toBeCloseTo(50, 5)
    expect(primary.portfolioName).toMatch(/^Book p[12]$/)
    for (const p of b.byAsset.get('aapl')!) expect(p.weightPct).toBeLessThanOrEqual(100)
  })

  it('keys an issue by book, asset AND kind', () => {
    // One pair can carry more than one capital problem, and a precedence rule
    // has to be able to tell them apart before it collapses them.
    expect(portfolioIssueKey('p1', 'aapl', 'framework_break'))
      .not.toBe(portfolioIssueKey('p1', 'aapl', 'no_thesis'))
    expect(portfolioIssueKey('p1', 'aapl', 'framework_break'))
      .not.toBe(portfolioIssueKey('p2', 'aapl', 'framework_break'))
  })

  it('leaves the asset-global Research identity alone', () => {
    // `holdings-context` answers a different question — the largest exposure
    // an asset has anywhere — and Research still asks it. Two derivations, two
    // questions, and this one does not touch that one.
    const src = readFileSync(
      resolve(__dirname, '../../research/holdings-context.ts'), 'utf8',
    )
    expect(src).not.toContain('portfolio-context')
    expect(src).toContain('export function exposureByAsset')
  })
})

describe('the seams this foundation was built for', () => {
  it('gives the scenario gap a real position instead of a regex', () => {
    /**
     * `held` was true when any context chip's label contained the word
     * "portfolio", and `weightPct` was hard-null — so the one card that says
     * the price has left the range you underwrote could not tell a 15%
     * position from a watchlist name.
     */
    const src = readFileSync(
      resolve(__dirname, '../../../components/mobile/MobileDashboard.tsx'), 'utf8',
    )
    expect(src).toContain('primaryBookFor(lenses.book')
    expect(src).not.toMatch(/\/portfolio\/i\.test\(String\(chip/)
  })

  it('does not make an unheld framework state a capital issue', () => {
    // `primaryBookFor` returns null for a name nobody owns, so `held` is false
    // and no weight is invented. A watchlist name below its bear case is still
    // a Research/scenario finding and never a capital one.
    const b = currentBook(book('p1', '2026-08-01'))
    expect(primaryBookFor(b, 'not-held')).toBeNull()
  })

  it('scopes active risk to the organisation, and to every active book', () => {
    /**
     * Two defects found by audit rather than by anything failing: the
     * portfolios read carried no `organization_id` predicate and relied
     * entirely on RLS, and `.order('name').limit(1)` meant active risk
     * described whichever book sorted first alphabetically, unlabelled.
     */
    const src = readFileSync(
      resolve(__dirname, '../../../components/mobile/MobileDashboard.tsx'), 'utf8',
    )
    const query = src.slice(src.indexOf("'feed-active-risk'"), src.indexOf("const activeRiskRows"))
    expect(query).toContain(".eq('status', 'active')")
    expect(query).toContain(".eq('organization_id', currentOrgId!)")
    // The gate as well as the predicate: no org, no query.
    expect(query).toContain('enabled: !!userId && !!currentOrgId')
    expect(query).toContain('currentOrgId')
    // No single-book assumption survives, and book identity travels per row.
    // Matched on code lines only: the comment above the query still names the
    // old `.limit(1)`, which is the record of why it went.
    const code = query.split(String.fromCharCode(10))
      .filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
    expect(code.join(' ')).not.toContain('.limit(1)')
    expect(query).toContain('portfolioId: pos.portfolioId')
    expect(query).toContain('benchByBook')
  })
})
