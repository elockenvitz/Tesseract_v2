import { describe, it, expect } from 'vitest'
import {
  lensesToExplore, scenarioCardsToExplore, templatesToExplore,
  attentionToExplore, aggregatesFor, withRegistryCategory,
} from '../explore-adapters'
import { CONTENT_REGISTRY, categoryForType } from '../../signals/content-registry'
import { FEED_CATEGORIES } from '../feed-categories'
import type { SignalType } from '../../signals/contract'

/**
 * One taxonomy, applied once.
 *
 * ── What was wrong ────────────────────────────────────────────────────────
 *
 * `CONTENT_REGISTRY` is the single answer to "where does this card belong",
 * and `categoryOf` defers to it on every surface that has a built card. The
 * Explore adapters never consulted it: each typed a category literal beside
 * its signal type, and three of them disagreed with the registry.
 *
 *   signal type     adapter said   registry says
 *   no_target       decisions      PORTFOLIO
 *   crowding        decisions      PORTFOLIO
 *   active_risk     news           PORTFOLIO
 *
 * Each has a comment in the registry explaining WHY it is Portfolio, and
 * `active_risk` filed under News is recorded there as having been reported
 * from a phone and called "correctly, nonsense". The registry was that fix.
 * Explore re-made the same mistake one layer up.
 *
 * What a reader saw: Portfolio was a category with its own filter row, its
 * own colour and three declared members that NO Explore tile could ever
 * belong to, while every crowding and no-target tile wore "Decisions".
 *
 * ── How these cases are written ───────────────────────────────────────────
 *
 * Against `categoryForType`, not against the literal 'portfolio'. A test that
 * restated the literal would pass if someone edited the registry and left the
 * adapter behind, which is the exact failure being fixed.
 */

const LENSES = {
  breaches: [{
    assetId: 'a1', symbol: 'AAPL', companyName: 'Apple', target: 180,
    overshootPct: 0.2, heldIn: ['Core'], asOf: '2026-10-01',
  }],
  stale: [{
    assetId: 'a2', symbol: 'MSFT', companyName: 'Microsoft', target: 400,
    overdueMonths: 3, timeframe: '6m', heldIn: ['Core'],
    statedAt: '2026-01-01', expiredAt: '2026-07-01',
  }],
  untargeted: [{
    assetId: 'a3', symbol: 'JNJ', companyName: 'J&J', weightPct: 4.2,
    portfolioName: 'Core', heldIn: ['Core'], price: 150, asOf: '2026-10-01',
  }],
  conviction: [{
    assetId: 'a4', symbol: 'AMZN', companyName: 'Amazon', direction: 'overweight',
    weightPct: 6.1, portfolioName: 'Core', conviction: 'medium', tension: 0.5,
  }],
  crowded: [{
    assetId: 'a5', symbol: 'GOOGL', companyName: 'Alphabet', portfolioCount: 3,
    maxWeightPct: 3.2,
    weightsByPortfolio: [{ name: 'Core', weightPct: 3.2 }, { name: 'Growth', weightPct: 1.1 }],
  }],
}

const byType = (items: { signalType: string | null; category: string }[]) => {
  const m = new Map<string, string>()
  for (const i of items) if (i.signalType) m.set(i.signalType, i.category)
  return m
}

describe('a lens tile wears the category the registry declares', () => {
  const cats = byType(lensesToExplore(LENSES))

  /** THE case. Both were 'decisions' and the registry says Portfolio. */
  it('files a sized position with no target under Portfolio', () => {
    expect(categoryForType('no_target')).toBe('portfolio')
    expect(cats.get('no_target')).toBe(categoryForType('no_target'))
  })

  it('files one name across several books under Portfolio', () => {
    expect(categoryForType('crowding')).toBe('portfolio')
    expect(cats.get('crowding')).toBe(categoryForType('crowding'))
  })

  /**
   * THE opposite injection. A change that moved every lens family to Portfolio
   * would satisfy the two cases above; these three are the half that must not
   * move, because the registry keeps them on Decisions deliberately -- a price
   * against a written framework is a question about the name, not the book.
   */
  it('leaves the price-against-framework families on Decisions', () => {
    for (const t of ['target_hit', 'target_expired', 'conviction_oversized'] as SignalType[]) {
      expect(categoryForType(t)).toBe('decisions')
      expect(cats.get(t)).toBe('decisions')
    }
  })

  it('agrees with the registry on every type it emits', () => {
    for (const [type, category] of cats) {
      expect(category, type).toBe(categoryForType(type as SignalType))
    }
  })
})

describe('a template tile does too, which is why the registry entry exists', () => {
  const tpl = (kind: string, id: string) => ({
    id, kind, symbol: 'AAPL', assetId: 'a1', headline: `${kind} on AAPL`,
    body: 'something happened', occurredAt: '2026-10-01',
  })

  it('files active risk under Portfolio and not under News', () => {
    const [item] = templatesToExplore([tpl('active_risk', 't1')])
    expect(item.signalType).toBe('active_risk')
    expect(categoryForType('active_risk')).toBe('portfolio')
    expect(item.category).toBe(categoryForType('active_risk'))
  })

  it('leaves an actual market event on News', () => {
    const [item] = templatesToExplore([tpl('earnings', 't2')])
    expect(item.category).toBe('news')
  })
})

describe('a scenario break earns Portfolio per card, not per type', () => {
  /**
   * `scenario_gap` is ONE signal type covering two findings -- a held position
   * outside its modelled range and an unheld name outside the same range -- so
   * the registry can only say Decisions and the BUILDER settles it by stamping
   * `capital`. `portfolio-taxonomy.test.ts` pins this rule for Curate; this
   * asserts Explore applies the same one rather than a second.
   */
  const card = (capital: unknown) => ({
    id: 'c1', entity: { id: 'a1', ticker: 'AAPL', name: 'Apple' },
    headline: 'AAPL is trading below every case you modelled',
    metric: { value: '-20%', label: 'below bear', direction: 'bad' },
    evidence: { data: { price: 150, cases: [{ name: 'Bear', price: 200 }] } },
    severity: 'critical', capital,
  })

  it('files a held break under Portfolio', () => {
    const [item] = scenarioCardsToExplore([card({ issueType: 'framework_break' })])
    expect(item.category).toBe('portfolio')
  })

  it('leaves an unheld break exactly where the registry puts it', () => {
    const [item] = scenarioCardsToExplore([card(undefined)])
    expect(item.category).toBe(categoryForType('scenario_gap'))
    expect(item.category).toBe('decisions')
  })

  /** The stamp is read per card, so a mixed batch does not take one answer. */
  it('does not let one held break relabel the batch', () => {
    const items = scenarioCardsToExplore([
      card(undefined),
      { ...card({ issueType: 'framework_break' }), id: 'c2', entity: { id: 'a2', ticker: 'MSFT' } },
      { ...card(undefined), id: 'c3', entity: { id: 'a3', ticker: 'JNJ' } },
    ])
    expect(items.map(i => i.category)).toEqual(['decisions', 'portfolio', 'decisions'])
  })
})

describe('the Workflow family reaches its own category', () => {
  it('files a project and a review request under Workflow', () => {
    const items = attentionToExplore([
      { attention_id: 'w1', source_type: 'project', title: 'Q3 review', due_at: '2026-10-05', created_at: '2026-09-01' },
      { attention_id: 'w2', source_type: 'coverage', title: 'Please review', due_at: '2026-10-09', created_at: '2026-09-02' },
    ], Date.parse('2026-10-07T00:00:00Z'))
    for (const i of items) {
      expect(i.category).toBe(categoryForType(i.signalType as SignalType))
      expect(i.category).toBe('workflow')
    }
  })

  it('keeps a trade-queue item on Decisions, because it is not a clock', () => {
    const [item] = attentionToExplore([{
      attention_id: 'w3', source_type: 'trade_queue_item', title: 'BUY AAPL',
      created_at: '2026-09-01',
    }])
    expect(item.signalType).toBe('recommendation')
    expect(item.category).toBe('decisions')
  })
})

describe('what the pass must NOT touch', () => {
  it('leaves an aggregate alone, because it stands for many cards', () => {
    const base = lensesToExplore(LENSES)
    const ideas = Array.from({ length: 4 }, (_, i) => ({
      id: `p${i}`, dedupeKey: `post:${i}`, signalType: 'trade_idea',
      category: 'ideas' as const, subtype: 'idea' as const, title: `Idea ${i}`,
      symbol: 'AAPL', occurredAt: new Date().toISOString(),
      destination: { kind: 'filter' as const, category: 'ideas' as const },
    }))
    const aggs = aggregatesFor([...base, ...ideas], Date.now())
    for (const a of aggs) {
      // Null by design: there is no single card behind it to look up.
      expect(a.signalType).toBeNull()
      expect(FEED_CATEGORIES.map(c => c.key)).toContain(a.category)
    }
  })

  it('leaves a type the registry does not hold on the adapter fallback', () => {
    const [item] = withRegistryCategory([{
      id: 'x', dedupeKey: 'x', signalType: 'not_a_registered_type',
      category: 'research', subtype: 'research', title: 'Something',
      destination: { kind: 'filter', category: 'research' },
    }])
    expect('not_a_registered_type' in CONTENT_REGISTRY).toBe(false)
    expect(item.category).toBe('research')
  })

  it('returns the very same object when the category already agrees', () => {
    const input = {
      id: 'y', dedupeKey: 'y', signalType: 'target_hit',
      category: 'decisions' as const, subtype: 'signal' as const, title: 'AAPL passed its target',
      destination: { kind: 'filter' as const, category: 'decisions' as const },
    }
    // Identity, not equality: a pass that reallocated every item would churn
    // every memo downstream of it for no change.
    expect(withRegistryCategory([input])[0]).toBe(input)
  })
})
