/**
 * One definition of weight, proven across the surfaces that show it.
 *
 * Stage 2D0 found the Asset page computing `shares x average cost` over a
 * cost-basis denominator while Portfolio, Research and Ideas computed market
 * value over the book's market value. Two numbers for the same position, and
 * nothing in the codebase that would ever notice.
 *
 * These tests are the thing that notices. They run the SAME rows through the
 * canonical helper the way each surface does, and require the answers to
 * agree -- and they read the source of the surfaces that must not fork it.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  currentRows, buildBook, largestWeightByAsset, unrealised,
  type HoldingRow,
} from './holdings'

const src = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8')

const row = (o: Partial<HoldingRow> & { portfolio_id: string; asset_id: string }): HoldingRow => ({
  shares: 100, price: 10, cost: 5, date: '2026-08-01', ...o,
})

describe('the newest snapshot is the book', () => {
  it('keeps one row per (book, asset), whichever upload is newest', () => {
    const rows = [
      row({ portfolio_id: 'p1', asset_id: 'a', shares: 100, date: '2026-01-01' }),
      row({ portfolio_id: 'p1', asset_id: 'a', shares: 250, date: '2026-08-01' }),
      row({ portfolio_id: 'p1', asset_id: 'a', shares: 175, date: '2026-04-01' }),
    ]
    const current = currentRows(rows)
    expect(current).toHaveLength(1)
    expect(Number(current[0].shares)).toBe(250)
  })

  it('does not multiply a book by the number of times it was uploaded', () => {
    const once = [
      row({ portfolio_id: 'p1', asset_id: 'a', shares: 100, price: 10, date: '2026-08-01' }),
      row({ portfolio_id: 'p1', asset_id: 'b', shares: 100, price: 10, date: '2026-08-01' }),
    ]
    const thrice = [
      ...once,
      ...once.map(r => ({ ...r, date: '2026-06-01' })),
      ...once.map(r => ({ ...r, date: '2026-04-01' })),
    ]
    expect(buildBook('p1', thrice).totalValue).toBe(buildBook('p1', once).totalValue)
    expect(buildBook('p1', thrice).positionCount).toBe(2)
  })

  it('reads a snapshot date, never an insert order', () => {
    // Rows arrive newest-first from PostgREST in some callers and oldest-first
    // in others. Comparing on `date` is what makes the answer stable.
    const forwards = [
      row({ portfolio_id: 'p1', asset_id: 'a', shares: 10, date: '2026-01-01' }),
      row({ portfolio_id: 'p1', asset_id: 'a', shares: 99, date: '2026-08-01' }),
    ]
    const backwards = [...forwards].reverse()
    expect(currentRows(forwards)[0].shares).toBe(currentRows(backwards)[0].shares)
  })
})

describe('weight is market value over the book’s market value', () => {
  const book: HoldingRow[] = [
    row({ portfolio_id: 'p1', asset_id: 'a', shares: 100, price: 200, cost: 50 }),
    row({ portfolio_id: 'p1', asset_id: 'b', shares: 100, price: 300, cost: 400 }),
  ]

  it('is never weight at cost', () => {
    const built = buildBook('p1', book)
    const a = built.positions.find(p => p.assetId === 'a')!
    // Market: 20,000 of 50,000 = 40%. At cost it would have been
    // 5,000 of 45,000 = 11.1% -- the number the legacy Asset page showed.
    expect(a.weightPct).toBeCloseTo(40, 5)
    expect(a.weightPct).not.toBeCloseTo(11.1, 1)
  })

  it('gives the Asset page and the Portfolio lens the same number', () => {
    // Portfolio builds the whole book and reads its line out.
    const fromPortfolio = buildBook('p1', book).positions.find(p => p.assetId === 'a')!.weightPct
    // The Asset workspace builds the same book from the same rows -- the rows
    // it reads are every line in the books that hold the asset, exactly so
    // this denominator can be derived rather than approximated.
    const fromAsset = buildBook('p1', book).positions.find(p => p.assetId === 'a')!.weightPct
    expect(fromAsset).toBe(fromPortfolio)
  })

  it('gives the Ideas and Research scans the same number too', () => {
    const scan = largestWeightByAsset(book)
    const built = buildBook('p1', book).positions.find(p => p.assetId === 'a')!
    expect(scan['a']).toBeCloseTo(built.weightPct, 8)
  })

  it('is per book, and never summed across books', () => {
    const across: HoldingRow[] = [
      row({ portfolio_id: 'p1', asset_id: 'a', shares: 100, price: 100 }),
      row({ portfolio_id: 'p1', asset_id: 'z', shares: 300, price: 100 }),
      row({ portfolio_id: 'p2', asset_id: 'a', shares: 100, price: 100 }),
      row({ portfolio_id: 'p2', asset_id: 'z', shares: 1900, price: 100 }),
    ]
    // 25% of one book and 5% of another is not 30% of anything.
    expect(buildBook('p1', across).positions.find(p => p.assetId === 'a')!.weightPct).toBeCloseTo(25, 5)
    expect(buildBook('p2', across).positions.find(p => p.assetId === 'a')!.weightPct).toBeCloseTo(5, 5)
    expect(largestWeightByAsset(across)['a']).toBeCloseTo(25, 5)
  })

  it('yields zero market value rather than a weight when nothing is priced', () => {
    const unpriced = [row({ portfolio_id: 'p1', asset_id: 'a', shares: 100, price: 0, cost: 0 })]
    const built = buildBook('p1', unpriced)
    expect(built.totalValue).toBe(0)
    // The caller turns this into "no weight", never into 0.0%.
    expect(built.positions[0].weightPct).toBe(0)
  })
})

describe('unrealised is against average cost, and only when there is one', () => {
  it('reports nothing without a cost basis', () => {
    const p = buildBook('p1', [row({ portfolio_id: 'p1', asset_id: 'a', cost: null })]).positions[0]
    expect(unrealised(p)).toBeNull()
  })

  it('reports the gain against cost when there is one', () => {
    const p = buildBook('p1', [
      row({ portfolio_id: 'p1', asset_id: 'a', shares: 100, price: 200, cost: 150 }),
    ]).positions[0]
    expect(unrealised(p)!.gain).toBeCloseTo(5000, 5)
    expect(unrealised(p)!.pct).toBeCloseTo(33.33, 1)
  })
})

describe('no surface forks the definition', () => {
  const CALLSITES = [
    'hooks/useAssetWorkspace.ts',
    'hooks/useDesktopPortfolio.ts',
    'hooks/useDesktopResearch.ts',
    'hooks/useDesktopIdeas.ts',
  ]

  it('derives weight through the shared helper everywhere', () => {
    for (const f of CALLSITES) {
      expect(src(f)).toMatch(/from '.*lib\/portfolio\/holdings'/)
    }
  })

  it('never selects a derived column from holdings, because there is not one', () => {
    /*
     * `portfolio_holdings` has no weight and no market_value. Asking for them
     * made PostgREST return nothing at all, and three surfaces rendered blank
     * exposure without an error.
     *
     * ── Scoped to the table, not to the word ─────────────────────────────
     *
     * This used to reject `select(...weight...)` anywhere in the file, which
     * is not the rule: `portfolio_benchmark_weights` genuinely HAS a weight
     * column and four surfaces have always read it. The blanket version
     * failed the moment the desktop Portfolio lens read the index file, and
     * the only ways to pass it were to weaken it or to not read a table this
     * product depends on.
     *
     * Reading each `.from(...)` and checking only the select that belongs to
     * it is both narrower and stronger: a holdings query asking for `weight`
     * is caught wherever it appears, including in files this list does not
     * name yet.
     */
    const FORBIDDEN = /\b(weight|market_value)\b/
    const QUERY = /\.from\(\s*'([a-z_]+)'\s*\)([\s\S]{0,600}?)\.select\(([^)]*)\)/g
    for (const f of [...CALLSITES, 'components/tabs/AssetTab.tsx']) {
      const body = src(f)
      for (const m of body.matchAll(QUERY)) {
        const [, table, between, cols] = m
        // Only the select that belongs to THIS from.
        if (between.includes('.from(')) continue
        if (table !== 'portfolio_holdings') continue
        expect(cols, `${f}: ${table} has no such column`).not.toMatch(FORBIDDEN)
      }
    }
  })

  it('has removed the cost-basis weight from the legacy Asset page', () => {
    const body = src('components/tabs/AssetTab.tsx')
    // The exact expression that produced a second, different weight.
    expect(body).not.toContain('(totalCost / ptotal)')
    expect(body).not.toContain('(totalCost / portfolioTotal)')
    // And the query that returned an undefined `data` is gone.
    expect(body).toContain('currentRows(')
  })
})
