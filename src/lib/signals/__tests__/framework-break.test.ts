import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  capitalLine, frameworkBreakCandidates, frameworkCapitalFor, FRAMEWORK_BREAK,
} from '../framework-break'
import { buildScenarioGapCard } from '../builders/scenarioGap'
import { currentBook, type HoldingRow } from '../../holdings/portfolio-context'
import type { CardResult, SignalCard } from '../contract'

/**
 * A price outside the written framework, on capital somebody owns.
 *
 * ── What is under test and what deliberately is not ───────────────────────
 *
 * Not the classifier. `deriveScenarioState` decides `below_all` / `above_all`
 * and `buildScenarioGapCard` owns every validity gate, and both are unchanged —
 * a second framework classifier is how two surfaces come to disagree about
 * what "outside the range" means. What is new is the other half of the
 * sentence: which book, how much of it, and whether that number may be printed
 * at all.
 */

const NOW = new Date('2026-08-31T00:00:00.000Z')

/**
 * The clock is pinned to the fixture, not the fixture to the clock.
 *
 * `buildScenarioGapCard` reads `Date.now()` to age the quote, and refuses one
 * older than four days — correctly, since beyond a long weekend a price is a
 * data fault rather than a close. The fixture's `priceAsOf` was a wall-clock
 * instant, so the suite passed until the real date walked past it: on
 * 2026-09-03 these tests began failing with `suppressed: quote_stale`, three
 * days after the date they were written against.
 *
 * Freezing the system clock to the same instant the fixture uses fixes it
 * without touching the rule. The production policy is unchanged, the allowed
 * age is unchanged, and the test is now deterministic in both directions: it
 * cannot rot with the calendar, and it cannot pass by being run soon enough.
 */
beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-31T00:00:00.000Z')) })
afterAll(() => { vi.useRealTimers() })
const ISO = NOW.toISOString()

const holding = (
  portfolioId: string, assetId: string, shares: number, name = `Book ${portfolioId}`,
): HoldingRow => ({
  portfolio_id: portfolioId, asset_id: assetId, shares, price: 10, date: '2026-08-01',
  portfolios: { id: portfolioId, name },
  assets: { symbol: assetId.toUpperCase(), asset_type: 'equity' },
})

/** A book of `n` filler positions, so weights are meaningful. */
const filler = (portfolioId: string, n: number, name?: string): HoldingRow[] =>
  Array.from({ length: n }, (_, i) => holding(portfolioId, `f${portfolioId}${i}`, 100, name))

/** Bear 200 / Base 300 / Bull 400. */
const LADDER = [
  { id: 'c1', name: 'Bear', price: 200, probability: 20, timeframe: '12m' },
  { id: 'c2', name: 'Base', price: 300, probability: 55, timeframe: '12m' },
  { id: 'c3', name: 'Bull', price: 400, probability: 25, timeframe: '12m' },
]

const unwrap = (r: CardResult): SignalCard => {
  if (!r.ok) throw new Error(`suppressed: ${r.reason}`)
  return r.card
}

function card(price: number, rows: HoldingRow[], assetId = 'aapl'): CardResult {
  const book = currentBook(rows)
  return buildScenarioGapCard({
    assetId, symbol: 'AAPL', companyName: 'Apple',
    price, priceAsOf: ISO, cases: LADDER, statedAt: '2026-02-01T00:00:00.000Z',
    heldIn: book.byAsset.get(assetId)?.map(p => ({
      id: p.portfolioId, name: p.portfolioName ?? 'Book',
    })) ?? [],
    capital: frameworkCapitalFor(book, assetId),
  })
}

describe('held and outside the framework is a capital issue', () => {
  const rows = [...filler('p1', 4), holding('p1', 'aapl', 500)]

  it('leads with the capital, and names the boundary the ladder gives', () => {
    // 5000 of a 9000 book: 55.6%, below a bear case of 200.
    const c = unwrap(card(150, rows))
    expect(c.headline).toBe('AAPL has fallen below your bear case')
    expect(c.metric!.label).toMatch(/^55\.6% of Book p1$/)
    // The DISTANCE is a property of the ladder and is unchanged by ownership.
    expect(c.metric!.value).toBe('25%')
  })

  it('says the same about the upside break', () => {
    const c = unwrap(card(500, rows))
    expect(c.headline).toBe('AAPL has passed every case you wrote')
    expect(c.body).toContain('capital you are still holding')
    expect(c.metric!.label).toMatch(/% of Book p1$/)
  })

  it('does not repeat the distance or the book in the description', () => {
    // The metric already states both; two lines are all the card reserves.
    const c = unwrap(card(150, rows))
    expect(c.body).not.toContain('55.6')
    expect(c.body).not.toContain('Book p1')
    expect(c.body.length).toBeLessThan(120)
  })
})

describe('unheld is not a capital issue, and is not reframed', () => {
  it('keeps the research observation exactly as it was', () => {
    /**
     * An unheld price outside a written range is a real finding about a name
     * somebody covers. It is not a capital issue, because there is no capital,
     * and inventing an exposure for it is the one thing this family must not
     * do.
     */
    const held = unwrap(card(150, [...filler('p1', 4), holding('p1', 'aapl', 500)]))
    const unheld = unwrap(card(150, filler('p1', 5)))

    expect(unheld.headline).toBe('AAPL is trading below every case you modelled')
    expect(unheld.metric!.label).toBe('Below your lowest case of $200')
    expect(unheld.headline).not.toBe(held.headline)
    expect(unheld.metric!.label).not.toMatch(/%\sof/)
    // And no book is named anywhere on it.
    expect(JSON.stringify(unheld)).not.toContain('Book p1')
  })

  it('returns no capital at all for a name nobody owns', () => {
    const book = currentBook(filler('p1', 5))
    expect(frameworkCapitalFor(book, 'aapl')).toBeNull()
    expect(frameworkBreakCandidates(book, 'aapl')).toEqual([])
  })
})

describe('several books, one card, the right book', () => {
  const rows = [
    ...filler('p1', 4, 'Large Cap Core'), holding('p1', 'aapl', 500, 'Large Cap Core'),
    ...filler('p2', 4, 'Vision Fund'), holding('p2', 'aapl', 10, 'Vision Fund'),
  ]

  it('treats every book as a legitimate candidate, most material first', () => {
    const book = currentBook(rows)
    const candidates = frameworkBreakCandidates(book, 'aapl')
    expect(candidates).toHaveLength(2)
    expect(candidates[0].portfolioName).toBe('Large Cap Core')
    expect(candidates[0].weightPct!).toBeGreaterThan(candidates[1].weightPct!)
    // Distinct identities, so a future precedence rule can tell them apart.
    expect(new Set(candidates.map(c => c.key)).size).toBe(2)
  })

  it('renders ONE card, anchored to the most material book', () => {
    /**
     * The same asset-level event in three books is one event. Rendering it
     * three times would flood the opening of the feed with visually identical
     * consecutive AAPL cards, which is what the run rule in `rankFeed` exists
     * to prevent and what this family must not create in the first place.
     *
     * The collapse is structural rather than a filter: the card id is
     * `scenario_gap:${assetId}` and the hook builds one per asset, so a second
     * book cannot produce a second card.
     */
    const c = unwrap(card(150, rows))
    expect(c.id).toBe('scenario_gap:aapl')
    expect(c.metric!.label).toContain('Large Cap Core')
    expect(c.metric!.label).not.toContain('Vision Fund')
  })

  it('shows a weight that belongs to the book it names, never a sum', () => {
    // 5000 of a 9000 book, not 5100 of anything, and not 55.6 + 1.1.
    const c = unwrap(card(150, rows))
    const pct = Number(/([\d.]+)% of/.exec(c.metric!.label ?? '')![1])
    expect(pct).toBeCloseTo(55.6, 1)
    const capital = frameworkCapitalFor(currentBook(rows), 'aapl')!
    expect(capital.portfolioName).toBe('Large Cap Core')
    expect(capital.weightPct!).toBeCloseTo(55.6, 1)
    // The other book is carried as quiet context, not merged into the number.
    expect(capital.bookCount).toBe(2)
  })

  it('still discloses the other books through the existing chip', () => {
    // `SignalCardView` turns a chip carrying `portfolios` into an in-card
    // disclosure. That pattern is reused rather than duplicated.
    const c = unwrap(card(150, rows))
    const chip = c.context.find(x => (x as any).portfolios)
    expect((chip as any).portfolios).toHaveLength(2)
  })
})

describe('a weight that cannot be trusted is not printed', () => {
  it('says the book instead of a number', () => {
    /**
     * A two-name book makes every position look enormous, so the size that
     * would justify the card is an artifact of the list length. The break is
     * still real — being held is what makes it a capital issue — so the card
     * exists and simply does not claim a percentage.
     */
    const rows = [holding('p1', 'other', 100, 'Small Book'), holding('p1', 'aapl', 500, 'Small Book')]
    const c = unwrap(card(150, rows))
    expect(c.headline).toBe('AAPL has fallen below your bear case')
    expect(c.metric!.label).toBe('Held in Small Book')
    // Not zero, not an em dash, not "0.0%".
    expect(c.metric!.label).not.toMatch(/0\.0%|—|0%/)
  })

  it('leaves ranking to the held-but-unweighted band', () => {
    const capital = frameworkCapitalFor(
      currentBook([holding('p1', 'other', 100), holding('p1', 'aapl', 500)]),
      'aapl',
    )!
    expect(capital.weightPct).toBeNull()
    expect(capital.weightIsMeaningful).toBe(false)
    // The reason is legible rather than guessed at.
    expect(capital.positionCount).toBe(2)
  })

  it('formats both honest forms and no third one', () => {
    const measured = { weightPct: 15.2, weightIsMeaningful: true, portfolioName: 'Large Cap Core' }
    const unknown = { weightPct: null, weightIsMeaningful: false, portfolioName: 'Large Cap Core' }
    expect(capitalLine(measured as any)).toBe('15.2% of Large Cap Core')
    expect(capitalLine(unknown as any)).toBe('Held in Large Cap Core')
  })
})

describe('the existing guards still decide whether there is a card at all', () => {
  const rows = [...filler('p1', 4), holding('p1', 'aapl', 500)]

  it('never reframes a price INSIDE the range', () => {
    /**
     * `below_middle` and `above_middle` are the normal state of every
     * position, and ownership does not make an ordinary price a framework
     * break. Two ways an inside price ends up here, both asserted:
     *
     * 250 is simply between the cases, and the builder suppresses it.
     * 300 is within the band of this ladder's own probability-weighted
     * expectation, so the existing `at_expected` card builds — an informational
     * claim about agreement, which must NOT take capital framing.
     */
    const inside = card(250, rows)
    expect(inside.ok).toBe(false)
    if (!inside.ok) expect(inside.reason).toBe('resolved')

    const atExpected = unwrap(card(300, rows))
    expect(atExpected.severity).toBe('informational')
    expect(atExpected.headline).toBe('AAPL is priced at your expected value')
    expect(atExpected.metric!.label).not.toMatch(/% of|Held in/)
  })

  it('cannot manufacture a break from a ladder that is not one', () => {
    const book = currentBook(rows)
    const r = buildScenarioGapCard({
      assetId: 'aapl', symbol: 'AAPL', price: 150, priceAsOf: ISO,
      cases: [LADDER[0]], statedAt: '2026-02-01T00:00:00.000Z',
      heldIn: [], capital: frameworkCapitalFor(book, 'aapl'),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('insufficient_coverage')
  })

  it('still refuses an implausible price, held or not', () => {
    const book = currentBook(rows)
    const r = buildScenarioGapCard({
      assetId: 'aapl', symbol: 'AAPL', price: 5, priceAsOf: ISO,
      cases: LADDER, statedAt: '2026-02-01T00:00:00.000Z',
      heldIn: [], capital: frameworkCapitalFor(book, 'aapl'),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('inconsistent_numbers')
  })

  it('still refuses a genuinely old quote', () => {
    const book = currentBook(rows)
    const r = buildScenarioGapCard({
      assetId: 'aapl', symbol: 'AAPL', price: 150,
      priceAsOf: '2020-01-01T00:00:00.000Z',
      cases: LADDER, statedAt: '2026-02-01T00:00:00.000Z',
      heldIn: [], capital: frameworkCapitalFor(book, 'aapl'),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('quote_stale')
  })
})

describe('the as-of, and what the builder is not allowed to do', () => {
  it('carries the holdings snapshot date, not now', () => {
    const capital = frameworkCapitalFor(
      currentBook([...filler('p1', 4), holding('p1', 'aapl', 500)]), 'aapl',
    )!
    expect(capital.asOf).toBe('2026-08-01')
  })

  it('does no weight math of its own', () => {
    /**
     * The last three defects in this area were a second implementation of the
     * same arithmetic. The builder receives a derived context and formats it.
     */
    const src = readFileSync(resolve(__dirname, '../builders/scenarioGap.ts'), 'utf8')
    expect(src).not.toContain('weight_pct')
    expect(src).not.toMatch(/shares\s*\*\s*price/)
    expect(src).toContain('frameworkBreakCopy')
  })

  it('keys the issue by book and by kind', () => {
    const capital = frameworkCapitalFor(
      currentBook([...filler('p1', 4), holding('p1', 'aapl', 500)]), 'aapl',
    )!
    expect(capital.issueKey).toBe(`p1:aapl:${FRAMEWORK_BREAK}`)
  })

  it('reuses the one classifier rather than adding another', () => {
    const src = readFileSync(resolve(__dirname, '../framework-break.ts'), 'utf8')
    // It reads a `ScenarioState`; it never decides one.
    expect(src).toContain("import type { ScenarioState } from './scenario-state'")
    expect(src).not.toContain('deriveScenarioState(')
    // And it only speaks about the two genuinely outside-framework states.
    expect(src).toContain("state.position !== 'below_all' && state.position !== 'above_all'")
  })
})
