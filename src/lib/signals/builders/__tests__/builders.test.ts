import { describe, it, expect, beforeEach } from 'vitest'
import { buildActiveRiskCard, selectActiveRisk, type ActiveRiskInput } from '../activeRisk'
import { buildRecommendationCard, type RecommendationInput } from '../recommendation'
import { buildNewsCard, type NewsInput } from '../news'
import { readSuppressionLog } from '../../suppression'
import type { CardResult, SignalCard } from '../../contract'

/**
 * These tests exist to hold one line: no card renders a null or contradictory
 * value. Each builder is checked against the specific bad data that reached
 * production — mash rationales, zero-price placeholders, unit-confused
 * weights — rather than against invented edge cases.
 *
 * The invariant block at the bottom runs over every card all three builders
 * can emit, so a fourth builder added later cannot quietly ship a card with no
 * primary action or a metric with no date.
 */

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString()

const card = (r: CardResult): SignalCard => {
  if (!r.ok) throw new Error(`expected a card, got suppression: ${r.reason} (${r.detail})`)
  return r.card
}
const reason = (r: CardResult): string => {
  if (r.ok) throw new Error('expected suppression, got a card')
  return r.reason
}

beforeEach(() => localStorage.clear())

// ── active risk ────────────────────────────────────────────────────────────

const RISK: ActiveRiskInput = {
  assetId: 'a1',
  symbol: 'MSFT',
  companyName: 'Microsoft',
  weightPct: 6.2,
  benchmarkWeightPct: 3.1,
  portfolioId: 'p1',
  portfolioName: 'Core Equity',
  asOf: '2026-07-31T00:00:00.000Z',
}

describe('active risk', () => {
  it('states the difference from the benchmark, not the position size', () => {
    const c = card(buildActiveRiskCard(RISK))
    // The claim, not the number. The number is the metric block's job.
    expect(c.headline).toBe('MSFT is an active overweight in Core Equity')
    expect(c.headline).not.toMatch(/[0-9]/)
    expect(c.metric?.value).toBe('+3.1%')
    expect(c.metric?.label).toBe('Active weight')
  })

  it('marks the number as coming from the book, not a live quote', () => {
    // The eyebrow renders "book 31 Jul" off this. A weight from a snapshot and
    // a live one must not look identical on screen.
    expect(card(buildActiveRiskCard(RISK)).metric?.source).toBe('holdings')
    expect(card(buildActiveRiskCard(RISK)).metric?.asOf).toBe('2026-07-31T00:00:00.000Z')
  })

  it('treats an absent benchmark weight as a genuine zero, not missing data', () => {
    const c = card(buildActiveRiskCard({ ...RISK, benchmarkWeightPct: null }))
    expect(c.metric?.value).toBe('+6.2%')
    expect(c.headline).toBe('MSFT is an off-benchmark overweight in Core Equity')
    expect(c.body).toContain('the benchmark does not hold it')
    expect(c.context.some(x => x.label === 'Off benchmark')).toBe(true)
  })

  it('escalates an off-benchmark position that has nothing offsetting it', () => {
    expect(card(buildActiveRiskCard({ ...RISK, weightPct: 3.5, benchmarkWeightPct: null })).severity)
      .toBe('critical')
    // Same active size, but half of it is offset by the index.
    expect(card(buildActiveRiskCard({ ...RISK, weightPct: 6.6, benchmarkWeightPct: 3.1 })).severity)
      .toBe('attention')
  })

  it('never colours an overweight as good or bad', () => {
    expect(card(buildActiveRiskCard(RISK)).metric?.direction).toBe('neutral')
    expect(card(buildActiveRiskCard({ ...RISK, weightPct: 1 })).metric?.direction).toBe('neutral')
  })

  it('suppresses a weight outside 0-100 rather than rendering a unit error', () => {
    // 0.062 stored where 6.2 was expected is the shape this catches.
    expect(reason(buildActiveRiskCard({ ...RISK, weightPct: 620 }))).toBe('inconsistent_numbers')
  })

  it('suppresses a zero weight — that is an unheld name, not a 0% bet', () => {
    expect(reason(buildActiveRiskCard({ ...RISK, weightPct: 0 }))).toBe('missing_number')
  })

  it('suppresses an unusable snapshot date', () => {
    expect(reason(buildActiveRiskCard({ ...RISK, asOf: '' }))).toBe('missing_number')
  })

  it('re-fires on a new snapshot but not within one', () => {
    const a = card(buildActiveRiskCard(RISK)).dedupeKey
    const b = card(buildActiveRiskCard({ ...RISK, weightPct: 6.3 })).dedupeKey
    const c = card(buildActiveRiskCard({ ...RISK, asOf: '2026-08-31T00:00:00.000Z' })).dedupeKey
    expect(b).toBe(a)
    expect(c).not.toBe(a)
  })

  describe('selection', () => {
    const rows: ActiveRiskInput[] = [
      { ...RISK, assetId: 'x', symbol: 'AAA', weightPct: 2.0, benchmarkWeightPct: 1.9 },
      { ...RISK, assetId: 'y', symbol: 'BBB', weightPct: 8.0, benchmarkWeightPct: 1.0 },
      { ...RISK, assetId: 'z', symbol: 'CCC', weightPct: 0.2, benchmarkWeightPct: 4.0 },
    ]

    it('ranks by size of the bet in either direction', () => {
      const picked = selectActiveRisk(rows, { limit: 2 }).map(r => r.symbol)
      expect(picked).toEqual(['BBB', 'CCC'])
    })

    it('does not log below-threshold rows as suppressions', () => {
      selectActiveRisk(rows)
      // Thresholding is selection, not suppression. Logging it would bury the
      // genuine data faults under thousands of routine lines.
      expect(readSuppressionLog()).toHaveLength(0)
    })
  })
})

// ── recommendation ─────────────────────────────────────────────────────────

const REC: RecommendationInput = {
  id: 'r1',
  assetId: 'a2',
  symbol: 'DASH',
  action: 'trim',
  proposedWeightPct: 1.5,
  currentWeightPct: 4.0,
  currentWeightAsOf: '2026-07-31T00:00:00.000Z',
  rationale: 'Multiple has re-rated past our bull case and the delivery margin story is now consensus.',
  recommendedBy: 'Priya Raman',
  portfolioId: 'p1',
  portfolioName: 'Core Equity',
  createdAt: iso(1),
}

describe('recommendation', () => {
  it('leads with the size change, not the verb', () => {
    const c = card(buildRecommendationCard(REC))
    expect(c.headline).toBe('Priya Raman wants DASH reduced in Core Equity')
    expect(c.headline).not.toMatch(/[0-9]/)
    expect(c.metric?.value).toBe('-2.50%')
    expect(c.metric?.label).toBe('4.0% → 1.5%')
  })

  it('dates the delta by its stalest input, not by the recommendation', () => {
    // The delta mixes a stated weight with one read off a snapshot. Stamping
    // it with today would claim a freshness it does not have.
    const c = card(buildRecommendationCard(REC))
    expect(c.metric?.source).toBe('computed')
    // ...and it inherits the vintage of its stalest input, so the eyebrow
    // still calls it a book number.
    expect(c.metric?.vintage).toBe('holdings')
    expect(c.metric?.asOf).toBe('2026-07-31T00:00:00.000Z')
  })

  it('suppresses a proposal that contradicts its own verb', () => {
    expect(reason(buildRecommendationCard({ ...REC, action: 'add' })))
      .toBe('inconsistent_numbers')
    expect(reason(buildRecommendationCard({ ...REC, action: 'buy', proposedWeightPct: 1.5 })))
      .toBe('inconsistent_numbers')
  })

  it('suppresses a change that changes nothing', () => {
    expect(reason(buildRecommendationCard({ ...REC, proposedWeightPct: 4.0 })))
      .toBe('inconsistent_numbers')
  })

  it('allows hold to propose the current weight', () => {
    const c = card(buildRecommendationCard({ ...REC, action: 'hold', proposedWeightPct: 4.0 }))
    expect(c.type).toBe('recommendation')
  })

  it('suppresses a mash rationale', () => {
    // Both of these reached production.
    expect(reason(buildRecommendationCard({ ...REC, rationale: 'NDDFKJSDNFKJ' }))).toBe('content_quality')
    expect(reason(buildRecommendationCard({ ...REC, rationale: 'ksadjfnskdjn' }))).toBe('content_quality')
    expect(reason(buildRecommendationCard({ ...REC, rationale: 'test' }))).toBe('content_quality')
    expect(reason(buildRecommendationCard({ ...REC, rationale: null }))).toBe('content_quality')
  })

  it('distinguishes a new position from a failed lookup', () => {
    // currentWeightPct 0 — we hold none of it. A real buy.
    const fresh = card(buildRecommendationCard({
      ...REC, action: 'buy', currentWeightPct: 0, proposedWeightPct: 2,
    }))
    expect(fresh.metric?.value).toBe('+2.00%')

    // currentWeightPct null — we could not look it up. Falls back to the
    // proposal alone rather than inventing a 0% position.
    const unknown = card(buildRecommendationCard({
      ...REC, action: 'buy', currentWeightPct: null, currentWeightAsOf: null, proposedWeightPct: 2,
    }))
    expect(unknown.metric?.label).toBe('Proposed weight')
    expect(unknown.metric?.source).toBe('stated')
  })

  it('renders a recommendation carrying no weights at all', () => {
    const c = card(buildRecommendationCard({
      ...REC, proposedWeightPct: null, currentWeightPct: null, currentWeightAsOf: null,
    }))
    expect(c.metric).toBeNull()
    expect(c.headline).toBe('Priya Raman recommends you trim DASH in Core Equity')
  })

  it('gets louder rather than expiring while it waits', () => {
    expect(card(buildRecommendationCard(REC)).severity).toBe('attention')
    const old = card(buildRecommendationCard({ ...REC, createdAt: iso(9) }))
    expect(old.severity).toBe('critical')
    expect(old.context.some(x => x.label === 'Waiting 9 days')).toBe(true)
  })

  it('can be answered without leaving the feed', () => {
    const c = card(buildRecommendationCard(REC))
    expect(c.actions.primary).toEqual({ id: 'approve', label: 'Approve', inline: true })
    expect(c.actions.quick.some(a => a.id === 'reject')).toBe(true)
    // ...and "not useful" is absent: on a colleague's proposal that is a
    // decline that avoids telling them so.
    expect(c.actions.menu.some(a => a.id === 'dismiss')).toBe(false)
  })
})

// ── news ───────────────────────────────────────────────────────────────────

const NEWS: NewsInput = {
  id: 'n1',
  headline: 'Microsoft raises quarterly dividend and expands buyback authorisation',
  summary: 'The company lifted its payout by 10% and added $60bn to its repurchase programme.',
  url: 'https://example.com/story',
  source: 'Reuters',
  publishedAt: iso(0.2),
  primarySymbol: 'MSFT',
  symbols: ['MSFT'],
  asset: { id: 'a1', symbol: 'MSFT', companyName: 'Microsoft' },
  heldIn: ['Core Equity', 'Growth'],
  maxWeightPct: 6.2,
}

describe('news', () => {
  it('adds the stake to the story', () => {
    const c = card(buildNewsCard(NEWS))
    expect(c.headline).toBe(NEWS.headline)
    expect(c.body).toContain('You hold it in 2 portfolios, up to 6.2% in Core Equity.')
    expect(c.severity).toBe('attention')
  })

  it('is informational when the org does not own it', () => {
    const c = card(buildNewsCard({ ...NEWS, heldIn: [], maxWeightPct: null }))
    expect(c.severity).toBe('informational')
  })

  it('is never critical', () => {
    for (const held of [[], ['Core Equity'], ['a', 'b', 'c']]) {
      expect(card(buildNewsCard({ ...NEWS, heldIn: held })).severity).not.toBe('critical')
    }
  })

  it('drops a stale price move without dropping the story', () => {
    const stale = card(buildNewsCard({
      ...NEWS,
      quote: { changePercent: -4.2, asOf: new Date(Date.now() - 60 * 60_000).toISOString() },
    }))
    // The story is still news; only the number is gone.
    expect(stale.metric).toBeNull()
    expect(stale.headline).toBe(NEWS.headline)

    const fresh = card(buildNewsCard({
      ...NEWS,
      quote: { changePercent: -4.2, asOf: new Date().toISOString() },
    }))
    expect(fresh.metric?.value).toBe('-4.2%')
    expect(fresh.metric?.source).toBe('quote')
    expect(fresh.metric?.direction).toBe('bad')
  })

  it('shows a flat tape as flat rather than suppressing it', () => {
    const c = card(buildNewsCard({
      ...NEWS, quote: { changePercent: 0, asOf: new Date().toISOString() },
    }))
    expect(c.metric?.value).toBe('+0.0%')
  })

  it('carries a macro story with no asset behind it', () => {
    const c = card(buildNewsCard({
      ...NEWS,
      primarySymbol: null,
      asset: null,
      heldIn: [],
      headline: 'US CPI rises 0.3% in July, above expectations',
      summary: 'Core inflation held at 3.2% year on year.',
    }))
    expect(c.entity.kind).toBe('market')
    expect(c.entity.id).toBe('market')
    expect(c.actions.open.href).toBe('https://example.com/story')
  })

  it('suppresses a headline-only story nobody holds', () => {
    // The old tile repeated the headline underneath itself when the provider
    // gave no summary. Entire batches of thirty arrived that way.
    expect(reason(buildNewsCard({ ...NEWS, summary: null, heldIn: [] }))).toBe('content_quality')
  })

  it('keeps a headline-only story about a name you hold', () => {
    const c = card(buildNewsCard({ ...NEWS, summary: null }))
    expect(c.body).toBe('You hold it in 2 portfolios, up to 6.2% in Core Equity.')
  })

  it('suppresses a story it cannot place in time or open', () => {
    expect(reason(buildNewsCard({ ...NEWS, publishedAt: 'not a date' }))).toBe('content_quality')
    expect(reason(buildNewsCard({ ...NEWS, url: '' }))).toBe('content_quality')
  })

  it('drops history', () => {
    expect(reason(buildNewsCard({ ...NEWS, publishedAt: iso(9) }))).toBe('resolved')
  })

  it('treats two stories about one name on one day as two claims', () => {
    const a = card(buildNewsCard(NEWS)).dedupeKey
    const b = card(buildNewsCard({ ...NEWS, id: 'n2' })).dedupeKey
    expect(b).not.toBe(a)
  })
})

// ── every suppression is logged, and every card is well-formed ─────────────

describe('the gate', () => {
  it('logs each suppression with its reason, type and entity', () => {
    buildActiveRiskCard({ ...RISK, weightPct: 0 })
    buildRecommendationCard({ ...REC, rationale: 'asdfgh' })
    buildNewsCard({ ...NEWS, url: '' })

    const log = readSuppressionLog()
    expect(log.map(e => e.type)).toEqual(['active_risk', 'recommendation', 'news'])
    expect(log.map(e => e.reason)).toEqual(['missing_number', 'content_quality', 'content_quality'])
    expect(log.every(e => !!e.entity && !!e.detail && !!e.at)).toBe(true)
  })
})

describe('contract invariants', () => {
  const all: SignalCard[] = [
    card(buildActiveRiskCard(RISK)),
    card(buildActiveRiskCard({ ...RISK, benchmarkWeightPct: null })),
    card(buildRecommendationCard(REC)),
    card(buildRecommendationCard({ ...REC, proposedWeightPct: null, currentWeightPct: null, currentWeightAsOf: null })),
    card(buildNewsCard(NEWS)),
    card(buildNewsCard({ ...NEWS, asset: null, primarySymbol: null })),
  ]

  it('every card has exactly one primary action and a way out', () => {
    for (const c of all) {
      expect(c.actions.primary.id).toBeTruthy()
      expect(c.actions.open.href).toBeTruthy()
      // Housekeeping moved to the menu, so `quick` is legitimately empty on
      // most types. What must never be empty is the menu — a card you cannot
      // get rid of teaches people to scroll past the surface.
      expect(c.actions.quick.length).toBeLessThanOrEqual(2)
      expect(c.actions.quick.every(a => a.inline)).toBe(true)
      expect(c.actions.menu.length).toBeGreaterThan(0)
      expect(c.actions.menu.some(a => a.id === 'why')).toBe(true)
    }
  })

  it('every displayed number carries a source and a date', () => {
    for (const c of all) {
      if (!c.metric) continue
      expect(c.metric.source).toBeTruthy()
      expect(Number.isNaN(new Date(c.metric.asOf).getTime())).toBe(false)
      expect(c.metric.value).not.toMatch(/NaN|undefined|null/)
    }
  })

  it('no headline is a category label', () => {
    for (const c of all) {
      // The old cards led with "ACTIVE RISK" in a coloured badge. A headline
      // is a sentence about a thing, so it contains a space and is not the
      // type in disguise.
      expect(c.headline).toContain(' ')
      expect(c.headline.toLowerCase()).not.toBe(c.type.replace('_', ' '))
      // A number appears once per card. The headline states the claim; the
      // metric block carries the figure. News is exempt — its headline comes
      // from the publisher and rewriting it would be editorialising.
      if (c.type !== 'news' && c.metric) {
        expect(c.headline).not.toContain(c.metric.value)
      }
    }
  })

  it('every card can explain itself', () => {
    for (const c of all) {
      expect(c.provenance.reason.length).toBeGreaterThan(20)
      expect(Number.isNaN(new Date(c.provenance.occurredAt).getTime())).toBe(false)
      expect(c.expiry.staleAfterDays).toBeGreaterThan(0)
      expect(c.dedupeKey.startsWith(c.type)).toBe(true)
    }
  })

  it('evidence appears only where there is an argument for it', () => {
    // Charts need a reason to appear, not a reason to suppress.
    //
    // active_risk earned one by measurement: rendered as a bare claim against
    // real SPY weights it left 486px of dead space on a 390px screen, because a
    // single active weight cannot be judged without the others. The ranked peer
    // list closed that to -147px. news and recommendation still have no such
    // argument and carry nothing.
    for (const c of all) {
      if (c.type === 'active_risk') {
        expect(c.evidence?.kind).toBe('peer_bar')
      } else {
        expect(c.evidence == null || c.evidence.kind === 'none').toBe(true)
      }
    }
  })
})
