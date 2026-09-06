import { describe, expect, it } from 'vitest'

import {
  buildCrowdingCard, buildInsightCard, buildNoTargetCard, buildStaleTargetCard,
} from '../builders/legacy-kinds'
import { buildNewsCard } from '../builders/news'
import { buildScenarioGapCard } from '../builders/scenarioGap'
import type { CardResult, SignalCard } from '../contract'

/**
 * One way to disclose more than one book, on every card that has more than one.
 *
 * ── The row this protects ─────────────────────────────────────────────────
 *
 * The collapsed metadata row is scanned for "is any of this mine", and it
 * shares 390px with `Your view`. Crowding spent it on `Max 25.3% · Vision Fund
 * 5K · Large Cap Growth` — three chips, two of them inert names, on the one
 * card whose finding is HOW MANY books hold the name, and it silently dropped
 * every book after the second.
 *
 * The rule: one book gets its name, several get a count, and the count opens
 * the shared disclosure `SignalCardView` already renders from
 * `CardContextChip.portfolios`. No new drawer, no per-card wording.
 */

const unwrap = (r: CardResult): SignalCard => {
  if (!r.ok) throw new Error(`suppressed: ${r.reason}`)
  return r.card
}

/** Every chip label on the collapsed row. */
const labels = (c: SignalCard) => c.context.map(x => x.label)
/** The chip that opens the books, if any. */
const booksChip = (c: SignalCard) => c.context.find(x => x.portfolios?.length)

const ISO = new Date().toISOString()

const crowded = (names: string[]) => unwrap(buildCrowdingCard({
  asOf: '2026-08-01T00:00:00.000Z',
  assetId: 'a1', symbol: 'AAPL', companyName: 'Apple',
  portfolioCount: names.length,
  totalValue: 1_000_000,
  maxWeightPct: 25.3,
  portfolioNames: names,
  weightsByPortfolio: names.map((name, i) => ({
    id: `p${i + 1}`, name, weightPct: 25.3 - i * 4, valueUsd: 500_000 - i * 100_000,
  })),
} as never))

describe('crowding discloses its books instead of naming two of them', () => {
  const card = crowded(['Vision Fund 5K', 'Large Cap Growth', 'Core Equity'])

  it('renders a count, not a list', () => {
    expect(labels(card)).toContain('3 portfolios')
    for (const name of ['Vision Fund 5K', 'Large Cap Growth', 'Core Equity']) {
      expect(labels(card)).not.toContain(name)
    }
  })

  it('keeps the row short enough to sit beside Your view', () => {
    // Not a truncation rule — the count is what makes the row short. Measured
    // against the widest realistic case: three long book names.
    const row = labels(card).join(' · ')
    expect(row.length).toBeLessThan(40)
  })

  it('hands every book to the shared drawer, not just the first two', () => {
    const chip = booksChip(card)!
    expect(chip.label).toBe('3 portfolios')
    expect(chip.portfolios).toHaveLength(3)
    expect(chip.portfolios!.map(p => p.name)).toEqual([
      'Vision Fund 5K', 'Large Cap Growth', 'Core Equity',
    ])
  })

  it('gives every row a way into the book it names', () => {
    // The lens keys its accumulator BY portfolio id and was dropping it on the
    // way out, so the drawer named three books and offered a route to none.
    expect(booksChip(card)!.portfolios!.map(p => p.id)).toEqual(['p1', 'p2', 'p3'])
  })

  it('gives the drawer the spread the card is built from', () => {
    // Crowding is a claim about the firm's money: a 25% weight in a small book
    // can be a fraction of a 4% weight in a large one, so the drawer needs
    // both figures to be readable.
    const [first] = booksChip(card)!.portfolios!
    expect(first.weightPct).toBeCloseTo(25.3, 1)
    expect(first.valueUsd).toBe(500_000)
  })

  it('names the book when there is only one', () => {
    // A count of one tells the reader nothing.
    const single = crowded(['Vision Fund 5K'])
    expect(labels(single)).toContain('Vision Fund 5K')
    expect(labels(single)).not.toContain('1 portfolio')
  })
})

describe('the same wording on every family that counts books', () => {
  it('drops the preposition the scenario card had already dropped', () => {
    // `In 2 portfolios` and `2 portfolios` carry the same fact in a row whose
    // separator is already a middot.
    for (const c of [crowded(['A', 'B'])]) {
      expect(labels(c)).toContain('2 portfolios')
      expect(labels(c)).not.toContain('In 2 portfolios')
    }
  })

  it('uses it on a stale-target card', () => {
    const card = unwrap(buildStaleTargetCard({
      assetId: 'a1', symbol: 'AAPL', companyName: 'Apple',
      target: 245, price: 212, timeframe: '12 months',
      ageMonths: 18, overdueMonths: 6,
      heldIn: ['Core Equity', 'Large Cap Growth'], heldInIds: ['p1', 'p2'],
      statedAt: '2025-02-14T00:00:00Z', expiredAt: '2026-02-13T00:00:00Z',
      asOf: ISO,
    }))
    expect(labels(card)).toContain('2 portfolios')
    expect(booksChip(card)!.portfolios).toHaveLength(2)
  })

  it('uses it on a news card, which had a number nobody could open', () => {
    const card = unwrap(buildNewsCard({
      id: 'n1', headline: 'Apple beats on services revenue',
      summary: 'A summary.', url: 'https://example.com/a', source: 'Reuters',
      publishedAt: ISO,
      asset: { id: 'a1', symbol: 'AAPL', companyName: 'Apple' },
      heldIn: ['Core Equity', 'Large Cap Growth', 'Vision Fund'],
    } as never))
    expect(labels(card)).toContain('3 portfolios')
    expect(labels(card)).not.toContain('In 3 portfolios')
    // And it opens now.
    expect(booksChip(card)!.portfolios).toHaveLength(3)
  })

  it('uses it on a scenario card, which set the wording', () => {
    const card = unwrap(buildScenarioGapCard({
      assetId: 'a1', symbol: 'AAPL', companyName: 'Apple',
      price: 150, priceAsOf: ISO,
      cases: [
        { name: 'Bear', price: 200, probability: 20, timeframe: '12m' },
        { name: 'Base', price: 300, probability: 55, timeframe: '12m' },
        { name: 'Bull', price: 400, probability: 25, timeframe: '12m' },
      ],
      heldIn: [{ id: 'p1', name: 'Core Equity' }, { id: 'p2', name: 'Large Cap Growth' }],
      statedAt: '2026-02-01T00:00:00.000Z',
    }))
    expect(labels(card)).toContain('2 portfolios')
    expect(booksChip(card)!.portfolios).toHaveLength(2)
  })
})

describe('the one family whose drawer cannot be complete yet', () => {
  const insight = (portfolioCount: number) => unwrap(buildInsightCard({
    id: 'i1', kind: 'no_thesis',
    headline: 'JNJ has no investment thesis',
    body: 'None of investment thesis, where we differ, risks to thesis has been written.',
    prompt: 'What best describes this position?',
    assetId: 'a1', symbol: 'JNJ', companyName: 'Johnson & Johnson',
    portfolioName: 'Vision Fund 10K', portfolioId: 'p1', weightPct: 8.1,
    held: true, portfolioCount, liveIdeas: [], coverageOwners: [], evidenceCount: 0,
    issue: {
      framing: 'no_case', daysSinceReview: null, daysSinceWritten: null,
      anchoredOn: null, present: [], missing: ['thesis', 'where_different', 'risks_to_thesis'],
      supporting: [],
    },
    caseWrittenAt: null, researchReviewAt: null, reviewAnchor: null, anchoredOn: null,
    daysSinceReview: null, daysSinceWritten: null, score: 1,
  } as never))

  it('counts rather than printing a name and an arithmetic expression', () => {
    // It read `Vision Fund 10K +2`, which is a shape no other card uses and
    // the longest thing on the row.
    const card = insight(3)
    expect(labels(card)).toContain('3 portfolios')
    expect(labels(card).join(' ')).not.toContain('+2')
  })

  it('does not offer a drawer it can only half fill', () => {
    /**
     * `DerivedInsight` carries ONE book — `exposureByAsset` returns the
     * largest current weight and the count beside it, because summing across
     * books would invent an exposure no portfolio has. A `3 portfolios`
     * trigger opening a one-row drawer is a smaller version of the lie this
     * stage removed, so the chip stays inert until the scan carries the books.
     */
    expect(booksChip(insight(3))).toBeUndefined()
  })

  it('still discloses the single book it does know', () => {
    const card = insight(1)
    expect(labels(card)).toContain('Vision Fund 10K')
    expect(booksChip(card)!.portfolios).toHaveLength(1)
  })
})

describe('a no-target position, which is the family that holds a weight', () => {
  const noTarget = (heldIn: string[]) => unwrap(buildNoTargetCard({
    assetId: 'a1', symbol: 'NVO', companyName: 'Novo Nordisk',
    price: 104.2, weightPct: 6.4, conviction: 'high',
    portfolioName: heldIn[0], portfolioId: 'p1',
    heldIn, heldInIds: heldIn.map((_, i) => `p${i + 1}`),
    asOf: ISO,
  } as never))

  it('counts, and keeps room for the chip that is not a book', () => {
    const card = noTarget(['Core Equity', 'Large Cap Growth', 'Vision Fund 5K'])
    // The row deliberately carries at most two chips on this card — it also
    // has a chart and a slider — so the books have to cost ONE of them.
    expect(labels(card)).toEqual(['3 portfolios', 'Conviction high'])
  })

  it('carries the weight it knows and leaves the rest unstated', () => {
    // The lens knows this position's weight in its PRIMARY book only. The
    // other rows get a name and no figure, which is the honest output: a zero
    // would read as "not held there".
    const pfs = booksChip(noTarget(['Core Equity', 'Large Cap Growth']))!.portfolios!
    expect(pfs[0]).toMatchObject({ name: 'Core Equity', weightPct: 6.4 })
    expect(pfs[1].weightPct).toBeUndefined()
  })

  it('names the single book, where the weight and the name agree', () => {
    expect(labels(noTarget(['Core Equity']))).toEqual(['Core Equity', 'Conviction high'])
  })
})

describe('the collapsed row does not depend on what is inside the drawer', () => {
  /**
   * The whole point of moving names off the row. A book called "Global
   * Sustainable Equity Income (Institutional)" used to be 45 characters of
   * collapsed metadata; now it is inside a sheet that scrolls, and the row
   * says the same thing it says for a book called "A".
   */
  const long = [
    'Global Sustainable Equity Income (Institutional)',
    'Tesseract Concentrated Large Cap Growth Composite',
    'EAFE ex-Japan Small Cap Value',
  ]
  const short = ['A', 'B', 'C']

  it('renders the identical row for short and very long book names', () => {
    expect(labels(crowded(long))).toEqual(labels(crowded(short)))
  })

  it('hands the long names through to the drawer intact', () => {
    // Not truncated at the source: the sheet is what decides how to render
    // them, and it has the width and the scroll to do it.
    expect(booksChip(crowded(long))!.portfolios!.map(p => p.name)).toEqual(long)
  })
})
