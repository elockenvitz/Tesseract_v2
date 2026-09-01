import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { CATEGORY_DOT, CATEGORY_KINDS, FEED_CATEGORIES, categoryOf } from '../feed-categories'
import {
  FRAMEWORK_BREAK, PORTFOLIO_FILTER_OPTIONS, frameworkCapitalFor,
  portfolioFilterKey, portfolioIssueFromFilterKey,
} from '../../signals/framework-break'
import { buildScenarioGapCard } from '../../signals/builders/scenarioGap'
import { currentBook, type HoldingRow } from '../../holdings/portfolio-context'
import type { CardResult, SignalCard } from '../../signals/contract'

/**
 * Portfolio, as something a reader can find and switch off.
 *
 * ── The gap this closes ───────────────────────────────────────────────────
 *
 * A held framework break and an unheld one are the same `SignalType`, and the
 * registry can give a type only one category — so both were filed under
 * Decisions and Curate offered one row, "Case vs price", for two different
 * findings. There was no way to ask for the capital cards, no way to turn them
 * off, and no way to learn that Portfolio signals existed at all. That is a
 * taxonomy gap, not a derivation one: none of the semantics change here.
 */

const ISO = new Date('2026-08-31T00:00:00.000Z').toISOString()

const holding = (portfolioId: string, assetId: string, shares: number): HoldingRow => ({
  portfolio_id: portfolioId, asset_id: assetId, shares, price: 10, date: '2026-08-01',
  portfolios: { id: portfolioId, name: 'Large Cap Core' },
  assets: { symbol: assetId.toUpperCase(), asset_type: 'equity' },
})

const LADDER = [
  { name: 'Bear', price: 200, probability: 20, timeframe: '12m' },
  { name: 'Base', price: 300, probability: 55, timeframe: '12m' },
  { name: 'Bull', price: 400, probability: 25, timeframe: '12m' },
]

const unwrap = (r: CardResult): SignalCard => {
  if (!r.ok) throw new Error(`suppressed: ${r.reason}`)
  return r.card
}

/** A held break: five priced positions, so the weight is meaningful. */
function heldBreak(): SignalCard {
  const rows = [
    ...Array.from({ length: 4 }, (_, i) => holding('p1', `f${i}`, 100)),
    holding('p1', 'aapl', 500),
  ]
  return unwrap(buildScenarioGapCard({
    assetId: 'aapl', symbol: 'AAPL', price: 150, priceAsOf: ISO,
    cases: LADDER, statedAt: '2026-02-01T00:00:00.000Z', heldIn: [],
    capital: frameworkCapitalFor(currentBook(rows), 'aapl'),
  }))
}

/** The same price and ladder on a name nobody owns. */
function unheldBreak(): SignalCard {
  return unwrap(buildScenarioGapCard({
    assetId: 'aapl', symbol: 'AAPL', price: 150, priceAsOf: ISO,
    cases: LADDER, statedAt: '2026-02-01T00:00:00.000Z', heldIn: [],
    capital: null,
  }))
}

describe('Curate offers Portfolio as a family', () => {
  it('lists it beside Decisions, in the reader\'s words', () => {
    const keys = FEED_CATEGORIES.map(c => c.key)
    expect(keys).toContain('portfolio')
    // Adjacent, because it is the same question asked of capital rather than
    // of a name.
    expect(keys.indexOf('portfolio')).toBe(keys.indexOf('decisions') + 1)
    expect(FEED_CATEGORIES.find(c => c.key === 'portfolio')!.label).toBe('Portfolio')
    // Every category has to have something behind it, or it renders as a
    // filter that is always empty.
    expect(CATEGORY_KINDS.portfolio.length).toBeGreaterThan(0)
    expect(CATEGORY_DOT.portfolio).toBeTruthy()
  })

  it('offers Framework break as its signal row, named naturally', () => {
    expect(PORTFOLIO_FILTER_OPTIONS[0])
      .toEqual({ key: 'portfolio:framework_break', label: 'Framework break' })
    // No internal vocabulary reaches the reader.
    for (const o of PORTFOLIO_FILTER_OPTIONS) {
      expect(o.label).not.toMatch(/scenario|below_all|above_all|gap|capital/i)
    }
  })

  it('adds no SignalType to say any of it', () => {
    /**
     * A second type would mean a new tier to place, a new judgment scope, a new
     * registry entry and a second derivation — all to express a distinction the
     * same card already makes in its own words. `research:<framing>` reached
     * this conclusion first; this is parity with it.
     */
    const contract = readFileSync(
      resolve(__dirname, '../../signals/contract.ts'), 'utf8',
    )
    // Line-scanned, not sliced on a blank line: the file has CRLF endings, so
    // a two-newline search matches nothing and silently takes the whole file.
    const rows = contract.split(String.fromCharCode(10))
    const start = rows.findIndex(l => l.startsWith('export type SignalType'))
    const union: string[] = []
    for (let i = start; i < rows.length; i++) {
      union.push(rows[i])
      if (rows[i].trim() === '') break
    }
    expect(union.join(' ')).not.toContain('framework_break')
    expect(portfolioFilterKey(FRAMEWORK_BREAK)).toBe('portfolio:framework_break')
    expect(portfolioIssueFromFilterKey('portfolio:framework_break')).toBe(FRAMEWORK_BREAK)
    // A key that is not ours resolves to nothing rather than to a guess.
    expect(portfolioIssueFromFilterKey('scenario_gap')).toBeNull()
    expect(portfolioIssueFromFilterKey('research:no_case')).toBeNull()
  })
})

describe('only a held break is a Portfolio card', () => {
  it('files the held one under Portfolio', () => {
    const card = heldBreak()
    expect(card.capital?.issueType).toBe(FRAMEWORK_BREAK)
    expect(card.capital?.portfolioName).toBe('Large Cap Core')
    expect(categoryOf({ kind: 'scenario', card })).toBe('portfolio')
  })

  it('leaves the unheld one exactly where it was', () => {
    const card = unheldBreak()
    expect(card.capital).toBeUndefined()
    expect(categoryOf({ kind: 'scenario', card })).toBe('decisions')
    // And its copy is untouched, which is the point: it is a real research
    // observation about a covered name, not a capital issue.
    expect(card.headline).toBe('AAPL is trading below every case you modelled')
  })

  it('does not relabel every scenario card as Portfolio', () => {
    // An inside-range card carries no capital either, whoever holds it.
    const rows = [
      ...Array.from({ length: 4 }, (_, i) => holding('p1', `f${i}`, 100)),
      holding('p1', 'aapl', 500),
    ]
    const atExpected = unwrap(buildScenarioGapCard({
      assetId: 'aapl', symbol: 'AAPL', price: 300, priceAsOf: ISO,
      cases: LADDER, statedAt: '2026-02-01T00:00:00.000Z', heldIn: [],
      capital: frameworkCapitalFor(currentBook(rows), 'aapl'),
    }))
    expect(atExpected.capital).toBeUndefined()
    expect(categoryOf({ kind: 'scenario', card: atExpected })).toBe('decisions')
  })
})

describe('the two rows select exactly their own half', () => {
  /**
   * The filter reads the card's own stamp, so the two rows cannot overlap. This
   * asserts the rule the dashboard applies rather than mounting the feed: the
   * predicate is three lines of `MobileDashboard` and mounting it needs an org,
   * a session and eight hooks.
   */
  const matches = (card: SignalCard, selected: string[]) => {
    const issues = selected.map(portfolioIssueFromFilterKey).filter((i): i is string => i != null)
    const types = selected.filter(k => !portfolioIssueFromFilterKey(k))
    const capitalIssue = card.capital?.issueType
    const issueHit = !!capitalIssue && issues.includes(capitalIssue)
    const typeHit = types.includes(card.type) && !capitalIssue
    return issueHit || typeHit
  }

  it('shows held breaks when Framework break is selected', () => {
    expect(matches(heldBreak(), ['portfolio:framework_break'])).toBe(true)
    expect(matches(unheldBreak(), ['portfolio:framework_break'])).toBe(false)
  })

  it('hides held breaks when it is not', () => {
    // Turning the row off has to actually remove them. Before this they were
    // reachable under "Case vs price" whatever the reader chose.
    expect(matches(heldBreak(), ['scenario_gap'])).toBe(false)
    expect(matches(heldBreak(), ['research:no_case'])).toBe(false)
  })

  it('leaves unheld scenario observations on their existing row', () => {
    expect(matches(unheldBreak(), ['scenario_gap'])).toBe(true)
  })

  it('shows both when both rows are selected', () => {
    const both = ['scenario_gap', 'portfolio:framework_break']
    expect(matches(heldBreak(), both)).toBe(true)
    expect(matches(unheldBreak(), both)).toBe(true)
  })
})

describe('the next Portfolio family fits without a rewrite', () => {
  it('keys on an issue type, so a second one is one entry', () => {
    /**
     * A material position with nothing written about it stamps its own
     * `issueType` and appends one row to `PORTFOLIO_FILTER_OPTIONS`. Nothing
     * about the category, the filter predicate or the scenario taxonomy has to
     * move for it.
     */
    expect(portfolioFilterKey('material_no_thesis')).toBe('portfolio:material_no_thesis')
    expect(portfolioIssueFromFilterKey('portfolio:material_no_thesis'))
      .toBe('material_no_thesis')
  })

  it('lists only signals that can actually be produced', () => {
    /**
     * No placeholder rows: an option that never matches anything teaches a
     * reader to distrust the sheet. Two now, because the second issue exists —
     * see `material-no-thesis`, which pins the exact list. Asserted here as a
     * property rather than a literal so this file does not have to be edited
     * every time the family grows.
     */
    expect(PORTFOLIO_FILTER_OPTIONS.length).toBeGreaterThan(0)
    for (const o of PORTFOLIO_FILTER_OPTIONS) {
      expect(portfolioIssueFromFilterKey(o.key)).toBeTruthy()
      expect(o.label).toMatch(/^[A-Z]/)
    }
  })
})

describe('the review fixtures use the real path', () => {
  const src = readFileSync(resolve(__dirname, '../../../../gallery/main.tsx'), 'utf8')

  it('builds them through the builder and the canonical context', () => {
    // Not hand-written card literals: if the rule changes these change with
    // it, and if they were literals they would render the old copy forever.
    expect(src).toContain("slug: 'portfolio-framework-break'")
    expect(src).toContain("slug: 'portfolio-framework-break-unweighted'")
    expect(src).toContain('capital: frameworkCapitalFor(bigBook')
    expect(src).toContain('capital: frameworkCapitalFor(smallBook')
    expect(src).toContain('currentBook([')
  })

  it('writes no weight or copy by hand', () => {
    const block = src.slice(src.indexOf('const bigBook'), src.indexOf('const amzn ='))
    expect(block).not.toMatch(/% of /)
    expect(block).not.toContain('Held in')
    expect(block).not.toContain('has fallen below')
  })

  it('stays out of the application bundle', () => {
    // `gallery/` is its own Vite entry with its own output. No fixture data
    // reaches production, and nothing in `src/` imports this file.
    const app = readFileSync(
      resolve(__dirname, '../../../components/mobile/MobileDashboard.tsx'), 'utf8',
    )
    expect(app).not.toContain('gallery/')
    expect(src).toContain("from '../src/lib/signals/framework-break'")
  })
})
