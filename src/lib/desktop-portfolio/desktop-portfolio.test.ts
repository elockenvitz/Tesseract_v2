/**
 * Focused tests for the Portfolio domain layer.
 *
 * Scope: the holdings model (dated rows, derived weight, cash, multi-book
 * identity), the framework-gap state machine, ranking, and EngagementTarget
 * construction. Pure — no React, no network.
 */

import { describe, it, expect } from 'vitest'
import {
  buildBook, currentRows, weightsByAsset, largestWeightByAsset, unrealised,
  type HoldingRow,
} from '../portfolio/holdings'
import {
  gapOf, breakPct, whyItMatters, primaryActionFor, issueFor, seedPromptFor,
  targetFor, tierOf, scoreOf, comparePositions, GAP_LABEL, EMPTY_FRAME,
  type PositionFrame,
} from './index'
import type { CurrentLadder } from '../signals/current-ladder'

const DAY = 86_400_000
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString()

const row = (over: Partial<HoldingRow> & { symbol?: string } = {}): HoldingRow => ({
  portfolio_id: 'p1', asset_id: 'a-aapl',
  shares: 100, price: 200, cost: 150, date: '2026-01-01',
  assets: { symbol: over.symbol ?? 'AAPL', company_name: 'Apple Inc.', sector: 'Technology' },
  ...over,
})

const ladder = (cases: [string, number][]): CurrentLadder => ({
  assetId: 'a-aapl', symbol: 'AAPL', companyName: 'Apple Inc.',
  cases: cases.map(([name, price], i) => ({
    scenarioId: `s${i}`, name, price, probability: null, timeframe: null,
    reasoning: null, id: `t${i}`, userId: null,
  })),
  updatedAt: daysAgo(30), valid: cases.length >= 2, reason: '',
})

const frame = (over: Partial<PositionFrame> = {}): PositionFrame => ({ ...EMPTY_FRAME, ...over })

/* ------------------------------------------------------------- the model */

describe('portfolio_holdings is a dated table, not a position list', () => {
  it('keeps only the newest row per (portfolio, asset)', () => {
    const rows = [
      row({ date: '2026-01-01', shares: 100 }),
      row({ date: '2026-06-01', shares: 250 }),
      row({ date: '2025-01-01', shares: 10 }),
    ]
    const book = buildBook('p1', rows)
    expect(book.positions).toHaveLength(1)
    expect(book.positions[0].shares).toBe(250)
  })

  it('does not double the book when it was uploaded twice', () => {
    const twice = [
      row({ asset_id: 'a-1', symbol: 'AAA', date: '2026-01-01' }),
      row({ asset_id: 'a-1', symbol: 'AAA', date: '2026-06-01' }),
      row({ asset_id: 'a-2', symbol: 'BBB', date: '2026-01-01' }),
      row({ asset_id: 'a-2', symbol: 'BBB', date: '2026-06-01' }),
    ]
    // Two assets at 100 x 200 = 40,000, not 80,000.
    expect(buildBook('p1', twice).totalValue).toBe(40_000)
  })

  it('compares on date, not on arrival order', () => {
    // A back-dated upload inserted last must not become current.
    const rows = [row({ date: '2026-06-01', shares: 250 }), row({ date: '2025-01-01', shares: 9 })]
    expect(currentRows(rows)[0].shares).toBe(250)
  })

  it('reports the book date rather than implying live marks', () => {
    expect(buildBook('p1', [row({ date: '2026-06-01' })]).asOf).toBe('2026-06-01')
  })
})

describe('weight is derived, because there is no weight column', () => {
  it('divides market value by the book, not by a stored field', () => {
    const book = buildBook('p1', [
      row({ asset_id: 'a-1', symbol: 'AAA', shares: 100, price: 300 }), // 30,000
      row({ asset_id: 'a-2', symbol: 'BBB', shares: 100, price: 100 }), // 10,000
    ])
    expect(book.totalValue).toBe(40_000)
    expect(book.positions[0].weightPct).toBeCloseTo(75, 5)
    expect(book.positions[1].weightPct).toBeCloseTo(25, 5)
  })

  it('never divides by zero', () => {
    const book = buildBook('p1', [row({ shares: 0, price: 0 })])
    expect(book.totalValue).toBe(0)
    expect(book.positions[0].weightPct).toBe(0)
  })

  it('ignores rows belonging to another book', () => {
    const book = buildBook('p1', [
      row({ portfolio_id: 'p1', asset_id: 'a-1', shares: 100, price: 100 }),
      row({ portfolio_id: 'p2', asset_id: 'a-2', shares: 999, price: 999 }),
    ])
    expect(book.positions).toHaveLength(1)
    expect(book.positions[0].weightPct).toBe(100)
  })

  it('sorts the book by weight, with a total order', () => {
    const book = buildBook('p1', [
      row({ asset_id: 'a-z', symbol: 'ZZZ', shares: 1, price: 100 }),
      row({ asset_id: 'a-a', symbol: 'AAA', shares: 5, price: 100 }),
    ])
    expect(book.positions.map(p => p.symbol)).toEqual(['AAA', 'ZZZ'])
  })
})

describe('the same asset in two books is two positions', () => {
  const both: HoldingRow[] = [
    // Book 1: AAPL is 3/4 of it.
    row({ portfolio_id: 'p1', asset_id: 'a-aapl', shares: 100, price: 300 }),
    row({ portfolio_id: 'p1', asset_id: 'a-x', symbol: 'XXX', shares: 100, price: 100 }),
    // Book 2: AAPL is 1/10 of it.
    row({ portfolio_id: 'p2', asset_id: 'a-aapl', shares: 100, price: 300 }),
    row({ portfolio_id: 'p2', asset_id: 'a-y', symbol: 'YYY', shares: 2700, price: 100 }),
  ]

  it('gives each book its own weight for the same asset', () => {
    const w = weightsByAsset(both).get('a-aapl')!
    expect(w.get('p1')).toBeCloseTo(75, 5)
    expect(w.get('p2')).toBeCloseTo(10, 5)
  })

  it('does not leak one book’s weight into the other', () => {
    expect(buildBook('p1', both).positions.find(p => p.assetId === 'a-aapl')!.weightPct)
      .toBeCloseTo(75, 5)
    expect(buildBook('p2', both).positions.find(p => p.assetId === 'a-aapl')!.weightPct)
      .toBeCloseTo(10, 5)
  })

  it('reports the largest single stake, never a sum across books', () => {
    // 75% + 10% is not 85% of anything.
    expect(largestWeightByAsset(both)['a-aapl']).toBeCloseTo(75, 5)
  })
})

describe('cash is a book line, not a position', () => {
  const withCash = [
    row({ asset_id: 'a-cash', symbol: 'CASH_USD', shares: 250_000, price: 1, cost: 250_000 }),
    row({ asset_id: 'a-1', symbol: 'AAA', shares: 7500, price: 100 }),
  ]

  it('counts positions excluding cash, and reports cash separately', () => {
    const book = buildBook('p1', withCash)
    expect(book.positionCount).toBe(1)
    expect(book.cashValue).toBe(250_000)
    expect(book.cashPct).toBeCloseTo(25, 5)
    expect(book.totalValue).toBe(1_000_000)
  })

  it('refuses a cost basis on cash rather than reporting a nonsense one', () => {
    // `cost` on a real cash line is the whole balance, not a per-share figure.
    const cash = buildBook('p1', withCash).positions.find(p => p.isCash)!
    expect(cash.avgCost).toBeNull()
    expect(unrealised(cash)).toBeNull()
  })

  it('makes no framework claim about cash', () => {
    const cash = buildBook('p1', withCash).positions.find(p => p.isCash)!
    expect(gapOf(cash, frame({ thesisUpdatedAt: null }))).toBe('large-cash')
    expect(whyItMatters(cash)).toBe('25.0% of the book is in cash.')
    expect(primaryActionFor(cash).route).toBeNull()
    // No thesis verb is ever offered for a line that cannot have one.
    expect(primaryActionFor(cash).label).not.toMatch(/thesis|case|evidence/i)
  })

  it('does not call a small cash line a finding', () => {
    const small = buildBook('p1', [
      row({ asset_id: 'a-cash', symbol: 'CASH_USD', shares: 100, price: 1 }),
      row({ asset_id: 'a-1', symbol: 'AAA', shares: 9900, price: 1 }),
    ]).positions.find(p => p.isCash)!
    expect(gapOf(small)).toBe('aligned')
  })
})

describe('unrealised is stated only where cost is real', () => {
  it('computes against average cost', () => {
    const p = buildBook('p1', [row({ shares: 100, price: 200, cost: 150 })]).positions[0]
    expect(unrealised(p)).toEqual({ gain: 5000, pct: expect.closeTo(33.33, 1) })
  })

  it('omits it entirely when no cost is on record', () => {
    const p = buildBook('p1', [row({ cost: null })]).positions[0]
    expect(unrealised(p)).toBeNull()
  })
})

/* -------------------------------------------------------------- the gaps */

describe('framework gaps are proved, never inferred', () => {
  const pos = (over: Partial<HoldingRow> = {}) => buildBook('p1', [row(over)]).positions[0]

  it('names a break when spot has passed the bull case', () => {
    const p = pos({ price: 400 })
    const f = frame({ thesisUpdatedAt: daysAgo(10), daysSinceReview: 10, ladder: ladder([['Bear', 100], ['Bull', 300]]) })
    expect(gapOf(p, f)).toBe('above-bull')
    expect(breakPct(p, f)).toBeCloseTo(33.33, 1)
    expect(whyItMatters(p, f)).toContain('33.3% above')
  })

  it('names a break when spot has fallen through the bear case', () => {
    const p = pos({ price: 50 })
    const f = frame({ thesisUpdatedAt: daysAgo(10), daysSinceReview: 10, ladder: ladder([['Bear', 100], ['Bull', 300]]) })
    expect(gapOf(p, f)).toBe('below-bear')
    expect(breakPct(p, f)).toBeCloseTo(-50, 1)
  })

  it('makes no framework claim without a valid ladder', () => {
    const p = pos({ price: 999_999 })
    // One rung is not a range.
    const f = frame({ thesisUpdatedAt: daysAgo(10), daysSinceReview: 10, ladder: ladder([['Bull', 300]]) })
    expect(gapOf(p, f)).not.toBe('above-bull')
    expect(breakPct(p, f)).toBeNull()
  })

  it('makes no framework claim when there is no ladder at all', () => {
    const p = pos({ price: 400 })
    expect(breakPct(p, frame({ ladder: null }))).toBeNull()
    expect(gapOf(p, frame({ thesisUpdatedAt: daysAgo(10), daysSinceReview: 10 }))).toBe('aligned')
  })

  it('says the case is missing only where the position is material', () => {
    const big = buildBook('p1', [
      row({ asset_id: 'a-1', symbol: 'AAA', shares: 100, price: 100 }),
      row({ asset_id: 'a-2', symbol: 'BBB', shares: 1, price: 1 }),
    ]).positions
    expect(gapOf(big[0], frame())).toBe('no-framework')
    // A hundredth of a percent with no thesis is not worth anyone's morning.
    expect(gapOf(big[1], frame())).toBe('aligned')
  })

  it('puts an open decision above every document problem', () => {
    const p = pos({ price: 400 })
    const f = frame({
      ladder: ladder([['Bear', 100], ['Bull', 300]]),
      liveIdea: { id: 'i1', action: 'sell', stage: 'deciding', awaitingDecision: true },
    })
    expect(gapOf(p, f)).toBe('decision-open')
    expect(primaryActionFor(p, f)).toEqual({ label: 'Review the decision', route: 'ideas' })
  })

  it('does not treat a decided or executed idea as open', () => {
    const p = pos()
    const f = frame({
      thesisUpdatedAt: daysAgo(10), daysSinceReview: 10,
      liveIdea: { id: 'i1', action: 'sell', stage: 'deciding', awaitingDecision: false },
    })
    // stage still says 'deciding' -- liveness is outcome/status, not stage.
    expect(gapOf(p, f)).toBe('aligned')
  })

  it('uses ninety days as the review horizon', () => {
    const p = pos()
    expect(gapOf(p, frame({ thesisUpdatedAt: daysAgo(89), daysSinceReview: 89 }))).toBe('aligned')
    expect(gapOf(p, frame({ thesisUpdatedAt: daysAgo(90), daysSinceReview: 90 }))).toBe('stale-thesis')
  })

  it('leads with new evidence over a stale date', () => {
    const p = pos()
    const f = frame({ thesisUpdatedAt: daysAgo(300), daysSinceReview: 300, newEvidence: 2 })
    expect(gapOf(p, f)).toBe('evidence-since')
  })

  it('always puts the position size in the reason', () => {
    const p = pos()
    for (const f of [
      frame(),
      frame({ thesisUpdatedAt: daysAgo(300), daysSinceReview: 300 }),
      frame({ thesisUpdatedAt: daysAgo(300), daysSinceReview: 300, newEvidence: 1 }),
      frame({ liveIdea: { id: 'i', action: 'trim', stage: null, awaitingDecision: true } }),
    ]) {
      expect(whyItMatters(p, f)).toContain('100.0%')
      expect(GAP_LABEL[gapOf(p, f)]).toBeTruthy()
      expect(issueFor(p, f)).toBeTruthy()
      expect(seedPromptFor(p, f).length).toBeGreaterThan(30)
    }
  })
})

describe('ranking is tier-first, size only within a tier', () => {
  const mk = (assetId: string, shares: number, f: PositionFrame) => {
    const rows = [
      row({ asset_id: assetId, shares, price: 100 }),
      row({ asset_id: 'a-filler', symbol: 'FILL', shares: 10_000 - shares, price: 100 }),
    ]
    return { position: buildBook('p1', rows).positions.find(p => p.assetId === assetId)!, frame: f }
  }

  it('never lets a large aligned position outrank a small broken one', () => {
    const bigAligned = mk('a-1', 8000, frame({ thesisUpdatedAt: daysAgo(5), daysSinceReview: 5 }))
    const smallOpen = mk('a-2', 30, frame({ liveIdea: { id: 'i', action: 'sell', stage: null, awaitingDecision: true } }))
    expect([bigAligned, smallOpen].sort(comparePositions)[0].position.assetId).toBe('a-2')
  })

  it('uses size to order two positions with the same problem', () => {
    const big = mk('a-1', 5000, frame())
    const small = mk('a-2', 200, frame())
    expect(scoreOf(big.position)).toBeGreaterThan(scoreOf(small.position))
    expect([small, big].sort(comparePositions)[0].position.assetId).toBe('a-1')
  })

  it('orders the tiers by investment consequence', () => {
    const p = buildBook('p1', [row()]).positions[0]
    expect(tierOf(p, frame({ liveIdea: { id: 'i', action: 'x', stage: null, awaitingDecision: true } }))).toBe(0)
    expect(tierOf(p, frame())).toBe(1)
    expect(tierOf(p, frame({ thesisUpdatedAt: daysAgo(300), daysSinceReview: 300 }))).toBe(2)
    expect(tierOf(p, frame({ thesisUpdatedAt: daysAgo(5), daysSinceReview: 5 }))).toBe(3)
  })

  it('is a total order', () => {
    const a = mk('a-aaa', 100, frame()), b = mk('a-bbb', 100, frame())
    expect(comparePositions(a, b)).toBeLessThan(0)
    expect(comparePositions(b, a)).toBeGreaterThan(0)
    expect(comparePositions(a, a)).toBe(0)
  })
})

describe('the engagement target carries the book, not just the name', () => {
  const p = buildBook('p1', [row({ shares: 100, price: 200 })]).positions[0]

  it('targets the asset, which Discuss already supports', () => {
    const t = targetFor(p, frame(), 'Large Cap Growth')!
    expect(t.objectType).toBe('asset')
    expect(t.objectId).toBe('a-aapl')
    expect(t.origin?.surface).toBe('portfolio')
  })

  it('scopes the context to the position, not the asset in general', () => {
    const t = targetFor(p, frame(), 'Large Cap Growth')!
    expect(t.portfolioId).toBe('p1')
    expect(t.portfolioName).toBe('Large Cap Growth')
    // The origin distinguishes the same asset in two books.
    expect(t.origin?.itemId).toBe('p1:a-aapl')
  })

  it('carries the issue and the numbers behind it', () => {
    const f = frame({
      thesisUpdatedAt: daysAgo(300), daysSinceReview: 300,
      evidenceCount: 4, ladder: ladder([['Bear', 100], ['Bull', 300]]),
    })
    const t = targetFor(p, f, 'Growth')!
    expect(t.issue?.reason).toBe('portfolio:stale-thesis')
    const labels = (t.contextChips ?? []).map(c => c.label)
    expect(labels).toContain('Weight')
    expect(labels).toContain('Framework')
    expect(labels).toContain('Last review')
  })

  it('only builds chips from values that exist', () => {
    const labels = (targetFor(p, frame())!.contextChips ?? []).map(c => c.label)
    expect(labels).not.toContain('Framework')
    expect(labels).not.toContain('Last review')
    expect(labels).not.toContain('Live idea')
    expect(labels).toContain('Weight')
  })
})

describe('nothing invents a mandate', () => {
  it('exposes no policy max, target weight or risk budget', async () => {
    const model = await import('./model')
    const names = Object.keys(model).join(' ').toLowerCase()
    for (const forbidden of ['policymax', 'maxposition', 'riskbudget', 'targetweight', 'positionlimit']) {
      expect(names).not.toContain(forbidden)
    }
  })

  it('has no gap state that asserts a limit was breached', () => {
    const labels = Object.values(GAP_LABEL).join(' ').toLowerCase()
    expect(labels).not.toMatch(/limit|max|budget|breach|over.?weight/)
  })
})
