import { describe, it, expect } from 'vitest'

import {
  exploreDrawsSparkline, exploreVisualFor, exploreVisualKind, visualNeedsWidth,
} from '../explore-visual'
import { exploreCardHeight, exploreCardSize, packExplore } from '../explore-layout'
import type { ComposedExploreItem, ExploreItem } from '../explore-item'

/**
 * The ten cards from the brief, which must not resolve into ten of one card.
 *
 * Each case below is a real shape an adapter produces, and the assertion is
 * that its PICTURE explains its own finding — not that a picture exists.
 */

const base = {
  id: 'x', dedupeKey: 'k:x', signalType: null as string | null,
  category: 'decisions' as const, subtype: 'signal' as const,
  title: 'A finding', destination: { kind: 'filter' as const, category: 'decisions' as const },
}
const item = (over: Partial<ExploreItem> = {}) => ({ ...base, ...over }) as ExploreItem
const entry = (i: ExploreItem): ComposedExploreItem => ({ item: i, emphasis: 'standard', score: 0.5 })

describe('the visual explains why the item matters', () => {
  it('draws the modelled range when the price escaped it', () => {
    const v = exploreVisualFor(item({
      signalType: 'scenario_gap', symbol: 'AMZN',
      visual: {
        currentPrice: 261,
        cases: [{ label: 'Bear', price: 120 }, { label: 'Base', price: 150 }, { label: 'Bull', price: 180 }],
      },
    }))
    expect(v.kind).toBe('scenario_range')
    if (v.kind !== 'scenario_range') throw new Error('narrow')
    expect(v.low).toBe(120)
    expect(v.high).toBe(180)
    expect(v.current).toBe(261)
    // The card's whole claim is that the price is outside the band.
    expect(v.current).toBeGreaterThan(v.high)
    expect(v.breachedLabel).toBe('Bull')
  })

  it('draws the same range downward for a breach below every case', () => {
    const v = exploreVisualFor(item({
      signalType: 'scenario_gap', symbol: 'CEG',
      visual: { currentPrice: 80, cases: [{ label: 'Bear', price: 120 }, { label: 'Bull', price: 180 }] },
    }))
    if (v.kind !== 'scenario_range') throw new Error('narrow')
    expect(v.current).toBeLessThan(v.low)
    expect(v.breachedLabel).toBe('Bear')
  })

  it('draws exposure, not a chart, for a position with no research', () => {
    const v = exploreVisualFor(item({
      signalType: 'no_research', subtype: 'research', symbol: 'MSFT',
      portfolio: { weightPct: 5.1, name: 'Vision Fund' },
    }))
    expect(v.kind).toBe('exposure')
    if (v.kind !== 'exposure') throw new Error('narrow')
    expect(v.weightPct).toBe(5.1)
  })

  it('draws the move from the last look, not a year of closes', () => {
    const v = exploreVisualFor(item({
      signalType: 'research_stale', subtype: 'research', symbol: 'AAPL',
      visual: { movePct: 21, lastLookAt: '2025-11-01T00:00:00.000Z' },
    }))
    expect(v.kind).toBe('last_look')
    if (v.kind !== 'last_look') throw new Error('narrow')
    expect(v.movePct).toBe(21)
  })

  it('draws a dashed empty slot where no target exists', () => {
    const v = exploreVisualFor(item({
      signalType: 'no_target', symbol: 'JNJ',
      visual: { currentPrice: 348, target: null },
    }))
    expect(v.kind).toBe('target_compare')
    if (v.kind !== 'target_compare') throw new Error('narrow')
    expect(v.current).toBe(348)
    // Null, not zero and not a guess. Implying precision here is the one thing
    // a no-target card must not do.
    expect(v.target).toBeNull()
  })

  it('compares position against the index weight when a book has one', () => {
    const v = exploreVisualFor(item({
      signalType: 'conviction_oversized', symbol: 'AMZN',
      portfolio: { weightPct: 14.2, name: 'Large Cap Growth' },
      visual: { benchmarkPct: 8.0 },
    }))
    expect(v.kind).toBe('comparison')
    if (v.kind !== 'comparison') throw new Error('narrow')
    expect(v.rows.map(r => r.pct)).toEqual([14.2, 8.0])
    expect(v.deltaLabel).toContain('6.2')
  })

  it('falls back to exposure when the book has no benchmark file', () => {
    // Conviction is stored as a WORD. With no index weight there is no second
    // number, and drawing a Position-vs-Conviction pair would invent one.
    const v = exploreVisualFor(item({
      signalType: 'conviction_oversized', symbol: 'AMZN',
      portfolio: { weightPct: 14.2, name: 'Large Cap Growth' },
      visual: { benchmarkPct: null },
    }))
    expect(v.kind).toBe('exposure')
  })

  it('draws a horizon timeline for an expired target', () => {
    const v = exploreVisualFor(item({
      signalType: 'target_expired', symbol: 'GOOGL',
      visual: { statedAt: '2025-06-01T00:00:00.000Z', dueAt: '2025-12-01T00:00:00.000Z' },
    }))
    expect(v.kind).toBe('timeline')
  })

  it('gives a trade idea a stage rail and a direction, not a chart', () => {
    const v = exploreVisualFor(item({
      signalType: 'trade_idea', subtype: 'idea', category: 'ideas', symbol: 'CROX',
      visual: { direction: 'sell', stages: ['Idea', 'Modeling', 'Deciding', 'Done'], activeStage: 1 },
    }))
    expect(v.kind).toBe('workflow')
    if (v.kind !== 'workflow') throw new Error('narrow')
    expect(v.direction).toBe('sell')
    expect(v.activeIndex).toBe(1)
  })

  it('lets a thought be its own words', () => {
    const v = exploreVisualFor(item({
      signalType: 'thought', subtype: 'idea', category: 'ideas', symbol: 'MCD',
      visual: { quote: 'People want cheap food.' },
    }))
    expect(v.kind).toBe('quote')
    if (v.kind !== 'quote') throw new Error('narrow')
    expect(v.text).toBe('People want cheap food.')
  })

  it('gives news no chart at all', () => {
    const v = exploreVisualFor(item({
      signalType: 'news', subtype: 'news', category: 'news', symbol: 'AAPL',
      source: { kind: 'market', label: 'CNBC' },
    }))
    expect(v.kind).toBe('none')
    expect(exploreDrawsSparkline(item({ signalType: 'news', subtype: 'news', symbol: 'AAPL' }))).toBe(false)
  })
})

describe('the sparkline is earned, not assumed', () => {
  it('draws one where the trajectory is the story', () => {
    expect(exploreDrawsSparkline(item({ signalType: 'unusual_move', symbol: 'NVDA' }))).toBe(true)
  })

  it('never draws one on news, ideas or workflow, whatever ticker they name', () => {
    // These have their own content; a price line under them asserts the price
    // explains them. That is the rule the whole module exists to enforce.
    for (const [t, sub] of [
      ['news', 'news'], ['trade_idea', 'idea'], ['thought', 'idea'], ['project_overdue', 'workflow'],
    ] as const) {
      expect(exploreDrawsSparkline(item({ signalType: t, subtype: sub, symbol: 'NVDA' })), t).toBe(false)
    }
  })

  it('yields to a more specific archetype whenever one applies', () => {
    // The sparkline is no longer the DEFAULT — it is what remains when nothing
    // explains the finding better. A card with a range, a target pair, a clock
    // or a weight draws that instead.
    expect(exploreDrawsSparkline(item({
      signalType: 'scenario_gap', symbol: 'NVDA',
      visual: { currentPrice: 261, cases: [{ label: 'Bear', price: 120 }, { label: 'Bull', price: 180 }] },
    }))).toBe(false)
    expect(exploreDrawsSparkline(item({
      signalType: 'no_research', subtype: 'research', symbol: 'NVDA',
      portfolio: { weightPct: 5.1 },
    }))).toBe(false)
    expect(exploreDrawsSparkline(item({
      signalType: 'target_expired', symbol: 'NVDA',
      visual: { statedAt: '2025-06-01T00:00:00.000Z', dueAt: '2025-12-01T00:00:00.000Z' },
    }))).toBe(false)
  })
})

describe('nothing is fabricated when the data is missing', () => {
  it('falls back rather than drawing an empty visual', () => {
    // A signal about a NAME with no better evidence still has the tape, which
    // is genuinely relevant to a claim about a security. What it must never do
    // is render a range with no cases or a timeline with no dates.
    expect(exploreVisualFor(item({ signalType: 'scenario_gap', symbol: 'AMZN' })).kind).toBe('price_trend')
    expect(exploreVisualFor(item({ signalType: 'target_expired', symbol: 'GOOGL' })).kind).toBe('price_trend')
    // No name, or a type whose content is its own: typography.
    expect(exploreVisualFor(item({ signalType: 'scenario_gap' })).kind).toBe('none')
    expect(exploreVisualFor(item({ signalType: 'news', subtype: 'news', symbol: 'AAPL' })).kind).toBe('none')
  })

  it('refuses a scenario range with only one distinct case', () => {
    // A band with no width is not a range, and drawing one would imply the
    // analyst modelled a spread they did not.
    const v = exploreVisualFor(item({
      signalType: 'scenario_gap',
      visual: { currentPrice: 100, cases: [{ label: 'Base', price: 150 }, { label: 'Bull', price: 150 }] },
    }))
    expect(v.kind).not.toBe('scenario_range')
  })

  it('refuses a timeline whose dates do not make a span', () => {
    expect(exploreVisualFor(item({
      signalType: 'target_expired',
      visual: { statedAt: '2025-06-01T00:00:00.000Z', dueAt: null },
    })).kind).toBe('none')
  })
})

describe('size and rhythm follow the visual', () => {
  it('gives width to a visual that cannot be read narrow', () => {
    const ranged = item({
      signalType: 'scenario_gap', symbol: 'AMZN',
      visual: { currentPrice: 261, cases: [{ label: 'Bear', price: 120 }, { label: 'Bull', price: 180 }] },
    })
    expect(visualNeedsWidth(exploreVisualKind(ranged))).toBe(true)
    expect(exploreCardSize(ranged).size).toBe('feature')
  })

  it('leaves a quote and an exposure bar narrow', () => {
    expect(exploreCardSize(item({
      subtype: 'idea', category: 'ideas', visual: { quote: 'People want cheap food.' },
    })).size).toBe('compact')
    expect(exploreCardSize(item({
      signalType: 'no_research', subtype: 'research', portfolio: { weightPct: 4.1 },
    })).size).toBe('compact')
  })

  it('is deterministic — the same item is the same size wherever it lands', () => {
    const i = item({
      signalType: 'no_research', subtype: 'research', portfolio: { weightPct: 4.1 },
    })
    const a = exploreCardSize(i)
    const b = exploreCardSize(i)
    expect(a).toEqual(b)
    expect(exploreCardHeight(i, a.size)).toBe(exploreCardHeight(i, b.size))
  })

  it('breaks a run of three identical pictures when something near by differs', () => {
    const exposure = (id: string) => item({
      id, signalType: 'no_research', subtype: 'research', portfolio: { weightPct: 4 },
    })
    const quote = item({
      id: 'q', subtype: 'idea', category: 'ideas', visual: { quote: 'A thought.' },
    })
    const cards = packExplore([exposure('a'), exposure('b'), exposure('c'), quote].map(entry))
    const kinds = cards.map(c => exploreVisualKind(c.entry.item))
    // No three in a row share one archetype.
    for (let i = 2; i < kinds.length; i++) {
      expect(new Set(kinds.slice(i - 2, i + 1)).size, `run at ${i}`).toBeGreaterThan(1)
    }
  })

  it('lets a genuine run stand when nothing in reach differs', () => {
    // A page that really does hold six exposure findings shows six. The rule is
    // a presentation nudge, not a re-ranker.
    const only = ['a', 'b', 'c', 'd'].map(id => item({
      id, signalType: 'no_research', subtype: 'research', portfolio: { weightPct: 4 },
    }))
    const cards = packExplore(only.map(entry))
    expect(cards).toHaveLength(4)
    expect(cards.map(c => c.entry.item.id).sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('does not reorder beyond the existing lookahead window', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => item({
      id, signalType: 'no_research', subtype: 'research', portfolio: { weightPct: 4 },
    }))
    const cards = packExplore(ids.map(entry))
    // Every input still present, exactly once: rhythm never drops a finding.
    expect(cards.map(c => c.entry.item.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })
})
