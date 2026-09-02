import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  MATERIAL_NO_THESIS, MATERIAL_POSITION_MIN_PCT, PORTFOLIO_FILTER_OPTIONS,
  materialCapitalFor, materialPositionCandidates,
  portfolioFilterKey, portfolioIssueFromFilterKey,
} from '../portfolio-issues'
import { buildInsightCard } from '../builders/legacy-kinds'
import {
  caseCoverageFrom, researchCopy, researchIssueFor, researchSignalTypeFor, reviewClocks,
} from '../../research/case-state'
import { currentBook, type HoldingRow } from '../../holdings/portfolio-context'
import { categoryOf } from '../../mobile/feed-categories'
import type { CardResult, SignalCard } from '../contract'

/**
 * Meaningful capital with no written view behind it.
 *
 * ── What makes this a Portfolio issue and not a Research one ──────────────
 *
 * The same underlying fact — nothing on file states a view — is a
 * documentation gap on a watchlist name and an unjustified allocation once
 * money is committed. Which one the reader is shown depends on whether the
 * desk owns enough of it for the silence to be a decision, so this reframes
 * the card the product already builds rather than emitting a second one.
 *
 * The interesting assertions are the two ways it must NOT fire.
 */

const NOW = Date.parse('2026-09-01T00:00:00.000Z')

const holding = (
  portfolioId: string, assetId: string, shares: number,
  over: Partial<HoldingRow> = {},
): HoldingRow => ({
  portfolio_id: portfolioId, asset_id: assetId, shares, price: 10, date: '2026-08-01',
  portfolios: { id: portfolioId, name: 'Large Cap Core' },
  assets: { symbol: assetId.toUpperCase(), asset_type: 'equity' },
  ...over,
})

/** A book of four filler positions plus the subject. */
const bookWith = (assetId: string, shares: number, portfolioId = 'p1') =>
  currentBook([
    ...Array.from({ length: 4 }, (_, i) => holding(portfolioId, `pad${i}`, 100)),
    holding(portfolioId, assetId, shares),
  ])

/** A Research insight through the real rule. `written` decides the framing. */
function insight(symbol: string, assetId: string, written: string[]) {
  const coverage = caseCoverageFrom(
    written.map(section => ({
      section, hasContent: true, updated_at: '2026-02-01T00:00:00.000Z',
    })) as never,
  )
  const clocks = reviewClocks(coverage, null)
  const issue = researchIssueFor({ clocks, coverage, evidence: [], movePct: null, now: NOW })!
  const copy = researchCopy({
    symbol, issue, portfolioName: 'Large Cap Core', weightPct: null, held: true,
  })
  return {
    id: `i-${assetId}`,
    kind: researchSignalTypeFor(issue.framing) === 'no_research' ? 'no_thesis' : 'stale_research',
    headline: copy.headline, body: copy.body, prompt: copy.prompt,
    assetId, symbol, companyName: symbol,
    portfolioName: 'Large Cap Core', portfolioId: 'p1', weightPct: null,
    held: true, portfolioCount: 1, liveIdeas: [], coverageOwners: [],
    evidenceCount: 0, issue,
    caseWrittenAt: clocks.caseWrittenAt, researchReviewAt: null,
    reviewAnchor: clocks.effectiveAnchor, anchoredOn: clocks.anchoredOn,
    daysSinceReview: issue.daysSinceReview, daysSinceWritten: issue.daysSinceWritten,
    score: 1,
  } as never
}

const unwrap = (r: CardResult): SignalCard => {
  if (!r.ok) throw new Error(`suppressed: ${r.reason}`)
  return r.card
}

/** 250 shares against four 100-share positions: 38.5% of the book. */
const MATERIAL = 250
/** 4 shares: under 1%. */
const IMMATERIAL = 4

describe('meaningful capital with nothing written is a Portfolio issue', () => {
  const card = unwrap(buildInsightCard(
    insight('JNJ', 'jnj', []),
    materialCapitalFor(bookWith('jnj', MATERIAL), 'jnj'),
  ))

  it('leads with the capital, not with the missing document', () => {
    // "JNJ has no investment thesis" is a statement about a record. The
    // finding is that money is already committed to it.
    expect(card.headline).toBe('JNJ is a position without a written view')
    expect(card.body).toBe('Nothing on file states the view this capital is backing.')
    expect(card.headline).not.toMatch(/missing|needs research|review position/i)
  })

  it('makes the size the hero number', () => {
    /**
     * `insightMetric` returns null for `no_case` deliberately, arguing that the
     * position size "would make the card look like it is about the size". Right
     * for a Research card, and inverted here: this card IS about the size.
     */
    expect(card.metric?.value).toBe('38.5%')
    expect(card.metric?.label).toBe('of Large Cap Core')
    // Neutral: a large unwritten position is more important than a small one
    // and no more severe.
    expect(card.metric?.direction).toBe('neutral')
    // Dated from the book, so the number can say when the book was true.
    expect(card.metric?.asOf).toBe('2026-08-01')
  })

  it('stamps the book, so the card can be found and deduped', () => {
    expect(card.capital).toEqual({
      issueKey: `p1:jnj:${MATERIAL_NO_THESIS}`,
      issueType: MATERIAL_NO_THESIS,
      portfolioId: 'p1',
      portfolioName: 'Large Cap Core',
    })
    expect(categoryOf({ kind: 'insight', card })).toBe('portfolio')
  })
})

describe('the two ways it must not fire', () => {
  it('leaves a rounding-error stake as a Research card', () => {
    /**
     * Starter positions and residual tails routinely have nothing written, and
     * flagging them would produce a card per name on a long book — the filler
     * problem the feed has already been through once.
     */
    const card = unwrap(buildInsightCard(
      insight('SNAP', 'snap', []),
      materialCapitalFor(bookWith('snap', IMMATERIAL), 'snap'),
    ))
    expect(card.capital).toBeUndefined()
    expect(card.headline).toBe('SNAP has no investment thesis')
    expect(categoryOf({ kind: 'insight', card })).toBe('research')
  })

  it('leaves a material position that HAS a view alone', () => {
    // A written case is not `no_case`, so the reframe cannot reach it however
    // large the position is.
    const written = ['thesis', 'where_different', 'risks_to_thesis']
    const card = unwrap(buildInsightCard(
      insight('MSFT', 'msft', written),
      materialCapitalFor(bookWith('msft', MATERIAL), 'msft'),
    ))
    expect(card.capital).toBeUndefined()
    expect(categoryOf({ kind: 'insight', card })).toBe('research')
  })

  it('leaves a PARTIAL view alone too', () => {
    /**
     * `incomplete_case` is deliberately excluded. Telling somebody their
     * capital has no thesis when two thirds of one is written would be false,
     * and "some of it is missing" is a different, weaker finding that the
     * Research card already makes.
     */
    const card = unwrap(buildInsightCard(
      insight('NKE', 'nke', ['thesis']),
      materialCapitalFor(bookWith('nke', MATERIAL), 'nke'),
    ))
    expect(card.capital).toBeUndefined()
    expect(card.metric?.value).toBe('1 of 3')
  })

  it('produces no capital for a name nobody owns', () => {
    const book = bookWith('other', MATERIAL)
    expect(materialCapitalFor(book, 'jnj')).toBeNull()
    expect(materialPositionCandidates(book, 'jnj')).toEqual([])
  })

  it('produces no capital where the weight cannot be measured', () => {
    /**
     * The one asymmetry with a framework break, and it is deliberate. A break
     * is real whatever the size — the price has left the range either way — so
     * being held is enough. This issue IS the size, so an unmeasurable weight
     * cannot establish it: a position whose share is unknowable is not KNOWN to
     * be material.
     */
    const twoNameBook = currentBook([
      holding('p1', 'other', 100), holding('p1', 'jnj', 250),
    ])
    expect(materialCapitalFor(twoNameBook, 'jnj')).toBeNull()
  })

  it('never fires on cash', () => {
    // Cash has no thesis and never will. It sits in 29 of this org's
    // portfolios, so this would otherwise be the largest single category of
    // card in the feed — true, unanswerable, and repeated 29 times.
    const book = currentBook([
      ...Array.from({ length: 4 }, (_, i) => holding('p1', `pad${i}`, 100)),
      holding('p1', 'cash', 250, { assets: { symbol: 'CASH_USD', asset_type: 'cash' } }),
    ])
    expect(materialCapitalFor(book, 'cash')).toBeNull()
  })
})

describe('the threshold, at its boundary', () => {
  /**
   * 2%, from `UNTARGETED_MIN_PCT` — the product's existing rule for the same
   * shape of claim, a sized position missing a piece of decision structure.
   * Not a new number invented inside an implementation.
   */
  it('is the existing one, not a new one', () => {
    expect(MATERIAL_POSITION_MIN_PCT).toBe(2)
    const lens = readFileSync(
      resolve(__dirname, '../../../hooks/mobile/usePortfolioLenses.ts'), 'utf8',
    )
    expect(lens).toContain('const UNTARGETED_MIN_PCT = 2')
  })

  /**
   * A book of `total` where the subject is `subject`, so the weight is exact.
   * 99 filler units + 1 subject unit is 1%; 98 + 2 is 2%.
   */
  const atPct = (pct: number) => {
    const filler = 100 - pct
    return currentBook([
      ...Array.from({ length: 4 }, (_, i) => holding('p1', `pad${i}`, filler / 4)),
      holding('p1', 'jnj', pct),
    ])
  }

  it('fires exactly at the bar and not a hair below it', () => {
    expect(materialCapitalFor(atPct(2), 'jnj')?.weightPct).toBeCloseTo(2, 6)
    expect(materialCapitalFor(atPct(1.99), 'jnj')).toBeNull()
    expect(materialCapitalFor(atPct(2.01), 'jnj')?.weightPct).toBeCloseTo(2.01, 6)
  })
})

describe('several books', () => {
  it('names the heaviest and counts the rest, never a sum', () => {
    const book = currentBook([
      ...Array.from({ length: 4 }, (_, i) => holding('p1', `a${i}`, 100)),
      holding('p1', 'jnj', 250),
      ...Array.from({ length: 4 }, (_, i) => holding('p2', `b${i}`, 100, {
        portfolios: { id: 'p2', name: 'Vision Fund' },
      })),
      holding('p2', 'jnj', 20, { portfolios: { id: 'p2', name: 'Vision Fund' } }),
    ])
    const candidates = materialPositionCandidates(book, 'jnj')
    expect(candidates).toHaveLength(2)
    // Distinct identities, so a future precedence rule can tell them apart.
    expect(new Set(candidates.map(c => c.key)).size).toBe(2)

    const capital = materialCapitalFor(book, 'jnj')!
    expect(capital.portfolioName).toBe('Large Cap Core')
    expect(capital.weightPct!).toBeCloseTo(38.5, 1)
    expect(capital.bookCount).toBe(2)
    // Not 38.5 + 4.8.
    expect(capital.weightPct!).toBeLessThan(100)
  })

  it('drops the books where the stake is immaterial', () => {
    const book = currentBook([
      ...Array.from({ length: 4 }, (_, i) => holding('p1', `a${i}`, 100)),
      holding('p1', 'jnj', 250),
      ...Array.from({ length: 4 }, (_, i) => holding('p2', `b${i}`, 100, {
        portfolios: { id: 'p2', name: 'Vision Fund' },
      })),
      holding('p2', 'jnj', 1, { portfolios: { id: 'p2', name: 'Vision Fund' } }),
    ])
    // Held in two, but only one of them is an allocation worth explaining.
    expect(materialPositionCandidates(book, 'jnj')).toHaveLength(1)
    expect(materialCapitalFor(book, 'jnj')!.bookCount).toBe(1)
  })
})

describe('the taxonomy grew by one row and nothing else', () => {
  it('adds no SignalType', () => {
    const contract = readFileSync(resolve(__dirname, '../contract.ts'), 'utf8')
    const rows = contract.split(String.fromCharCode(10))
    const start = rows.findIndex(l => l.startsWith('export type SignalType'))
    const union: string[] = []
    for (let i = start; i < rows.length; i++) {
      union.push(rows[i])
      if (rows[i].trim() === '') break
    }
    expect(union.join(' ')).not.toContain('material_no_thesis')
  })

  it('round-trips its filter key', () => {
    expect(portfolioFilterKey(MATERIAL_NO_THESIS)).toBe('portfolio:material_no_thesis')
    expect(portfolioIssueFromFilterKey('portfolio:material_no_thesis'))
      .toBe(MATERIAL_NO_THESIS)
  })

  it('offers exactly the rows that can be produced', () => {
    expect(PORTFOLIO_FILTER_OPTIONS).toEqual([
      { key: 'portfolio:framework_break', label: 'Framework break' },
      { key: 'portfolio:material_no_thesis', label: 'Unwritten position' },
    ])
    for (const o of PORTFOLIO_FILTER_OPTIONS) {
      expect(o.label).not.toMatch(/material_no_thesis|scenario|thesis presence|issue/i)
    }
  })

  it('keeps the two Portfolio rows and Case vs price mutually exclusive', () => {
    const matches = (card: SignalCard, selected: string[]) => {
      const issues = selected.map(portfolioIssueFromFilterKey).filter((i): i is string => i != null)
      const types = selected.filter(k => !portfolioIssueFromFilterKey(k))
      const issue = card.capital?.issueType
      return (!!issue && issues.includes(issue)) || (types.includes(card.type) && !issue)
    }
    const unwritten = unwrap(buildInsightCard(
      insight('JNJ', 'jnj', []), materialCapitalFor(bookWith('jnj', MATERIAL), 'jnj'),
    ))
    const research = unwrap(buildInsightCard(
      insight('SNAP', 'snap', []), materialCapitalFor(bookWith('snap', IMMATERIAL), 'snap'),
    ))

    expect(matches(unwritten, ['portfolio:material_no_thesis'])).toBe(true)
    expect(matches(unwritten, ['portfolio:framework_break'])).toBe(false)
    expect(matches(unwritten, ['scenario_gap'])).toBe(false)
    expect(matches(unwritten, ['no_research'])).toBe(false)
    expect(matches(unwritten, ['research:no_case'])).toBe(false)
    // The Research card stays on the Research rows.
    expect(matches(research, ['portfolio:material_no_thesis'])).toBe(false)
    expect(matches(research, ['no_research'])).toBe(true)
    // Both Portfolio rows together show both kinds.
    expect(matches(unwritten, ['portfolio:framework_break', 'portfolio:material_no_thesis']))
      .toBe(true)
  })
})

describe('the review fixtures use the real path', () => {
  const src = readFileSync(resolve(__dirname, '../../../../gallery/main.tsx'), 'utf8')

  it('builds all three through the real derivation', () => {
    expect(src).toContain("slug: 'portfolio-unwritten-position'")
    expect(src).toContain("slug: 'portfolio-unwritten-immaterial'")
    expect(src).toContain("slug: 'portfolio-written-material'")
    // The rule decides the framing and the capital; the fixture supplies rows.
    expect(src).toContain('researchIssueFor({')
    expect(src).toContain('materialCapitalFor(bookWith(')
  })

  it('hand-authors no copy, no weight and no headline', () => {
    const block = src.slice(src.indexOf('function unwrittenInsight'), src.indexOf('const amzn ='))
    expect(block).not.toContain('without a written view')
    expect(block).not.toContain('Nothing on file states')
    expect(block).not.toMatch(/\d+\.\d+% of/)
  })

  it('stays out of the application bundle', () => {
    const app = readFileSync(
      resolve(__dirname, '../../../components/mobile/MobileDashboard.tsx'), 'utf8',
    )
    expect(app).not.toContain('gallery/')
  })
})

describe('the default visual explains the issue', () => {
  const card = unwrap(buildInsightCard(
    insight('JNJ', 'jnj', []),
    materialCapitalFor(bookWith('jnj', MATERIAL), 'jnj'),
  ))

  it('says the book once, not three times', () => {
    /**
     * The hero already reads "38.5% / of Large Cap Core" and the disclosure
     * chip already names the book, so the exposure chip beside them was a
     * third copy of one fact in a row a reader scans in a glance. On every
     * Research framing the metric is a date or a count, so the same chip is
     * genuinely new information there and stays.
     */
    const labels = card.context.map(c => c.label)
    expect(labels.filter(l => /Large Cap Core/.test(l))).toHaveLength(1)
    expect(labels).not.toContain('Held in Large Cap Core')
    expect(labels).not.toContain('38.5% of Large Cap Core')
    // The metric is where the number lives now.
    expect(card.metric!.value).toBe('38.5%')
    expect(card.metric!.label).toBe('of Large Cap Core')
  })

  it('keeps the exposure chip on an ordinary Research card', () => {
    const research = unwrap(buildInsightCard(
      insight('SNAP', 'snap', []),
      materialCapitalFor(bookWith('snap', IMMATERIAL), 'snap'),
    ))
    expect(research.context.map(c => c.label)).toContain('Held in Large Cap Core')
  })

  it('opens on the Case pane, not on the tape', () => {
    /**
     * Nothing happened to the price — the finding is that a real share of a
     * real book has no view behind it — so opening onto a chart answers a
     * question the reader did not ask. The order lives in the feed, and this
     * pins the condition it keys on so an ordinary Research card cannot be
     * reordered with it.
     */
    const src = readFileSync(
      resolve(__dirname, '../../../components/mobile/MobileDashboard.tsx'), 'utf8',
    )
    expect(src).toContain('...(insightCapital ? [casePane] : []),')
    expect(src).toContain('...(insightCapital ? [] : [casePane]),')
  })

  it('states absence rather than dashing it, on the capital card only', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../components/signals/CasePane.tsx'), 'utf8',
    )
    expect(src).toContain("{written ? '✓' : absenceEmphasis ? 'Missing' : '—'}")
    // No progress semantics: a section is written or it is not.
    expect(src).not.toMatch(/present\.length\s*\/\s*CORE_THESIS_SECTIONS\.length/)
    const dash = readFileSync(
      resolve(__dirname, '../../../components/mobile/MobileDashboard.tsx'), 'utf8',
    )
    expect(dash).toContain('absenceEmphasis={!!insightCapital}')
  })
})
