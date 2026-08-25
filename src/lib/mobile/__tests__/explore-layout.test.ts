import { describe, expect, it } from 'vitest'

import { composeExplore } from '../explore-compose'
import {
  LOOKAHEAD, MAX_FEATURES, exploreCardHeight, exploreCardSize, exploreChartEligible,
  layoutExplore, packExplore,
} from '../explore-layout'
import type { ComposedExploreItem, ExploreItem } from '../explore-item'
import { EXPLORE_FIXTURE, NOW } from './explore-fixture'

/**
 * How big each card is, and how the cards fill the grid.
 *
 * The property under test throughout is that a page's shape is EXPLAINABLE. The
 * rules it replaced were not: width came from an OR over three conditions gated
 * on an item's index in the composed order, so the same signal was wide on one
 * page and narrow on the next, and a wide card landing on an odd column offset
 * left half a row of page showing with nothing to say why.
 *
 * So sizing is tested with no order at all — a function of one item — and
 * packing is tested with no content, on cards reduced to their sizes.
 */

const item = (over: Partial<ExploreItem> = {}): ExploreItem => ({
  id: 'x', dedupeKey: 'k', signalType: 'conviction_oversized',
  category: 'decisions', subtype: 'signal',
  title: 'A finding',
  destination: { kind: 'action', action: 'open_asset', assetId: 'a', symbol: 'X' },
  ...over,
})

const entry = (i: ExploreItem): ComposedExploreItem => ({ item: i, emphasis: 'standard', score: 0.5 })
const sizes = (items: ExploreItem[]) => packExplore(items.map(entry)).map(c => c.size)
const spans = (items: ExploreItem[]) => packExplore(items.map(entry)).map(c => c.span)

/** A card that earns width on its own: a material position with a number. */
const material = (over: Partial<ExploreItem> = {}) => item({
  metric: { value: '14.2%', label: 'position' },
  portfolio: { weightPct: 14.2, name: 'Large Cap Growth' },
  ...over,
})

describe('card size is a property of the item', () => {
  it('features a high-priority signal about a material position', () => {
    expect(exploreCardSize(material()).size).toBe('feature')
  })

  it('features a high-priority decision even on a small position', () => {
    // §17: a genuine breach must not be buried under an article purely because
    // the holding is small. The ranker already knows it matters.
    const small = item({ importance: 0.9, portfolio: { weightPct: 1.2 } })
    expect(exploreCardSize(small).size).toBe('feature')
  })

  it('keeps an idea compact', () => {
    const idea = item({
      category: 'ideas', subtype: 'idea', title: 'Trade idea',
      state: 'Buy · Discussing', importance: 0.9,
      // Even with a material position and a metric attached, which is the
      // combination that features a signal.
      metric: { value: '9.0%', label: 'position' }, portfolio: { weightPct: 9 },
    })
    expect(exploreCardSize(idea).size).toBe('compact')
  })

  it('keeps external news compact', () => {
    const news = item({
      category: 'news', subtype: 'news', importance: 1,
      metric: { value: '-6.2%', label: 'today' }, portfolio: { weightPct: 12 },
    })
    expect(exploreCardSize(news).size).toBe('compact')
  })

  it('keeps a workflow item compact', () => {
    expect(exploreCardSize(item({ category: 'workflow', subtype: 'workflow' })).size).toBe('compact')
  })

  it('will not feature a material position that has no number to show', () => {
    // Width is for something to put in it. The old rule's most common wide card
    // was a bare headline over a 6% holding.
    expect(exploreCardSize(material({ metric: undefined })).size).toBe('compact')
  })

  it('does not depend on the ticker', () => {
    for (const symbol of ['AMZN', 'MSFT', 'JNJ', 'TGT', 'PG']) {
      expect(exploreCardSize(material({ symbol })).size).toBe('feature')
      expect(exploreCardSize(item({ symbol, category: 'news', subtype: 'news' })).size).toBe('compact')
    }
  })

  it('does not depend on where the item sits in the page', () => {
    // The whole defect: `assignEmphasis` read the index, so reordering the page
    // resized its cards. Every permutation of the same four items must produce
    // the same four sizes, keyed to the items rather than to the positions.
    const items = [
      material({ id: 'a', symbol: 'AMZN' }),
      item({ id: 'b', symbol: 'MSFT', category: 'research', subtype: 'research' }),
      item({ id: 'c', symbol: 'JNJ', category: 'news', subtype: 'news' }),
      item({ id: 'd', symbol: 'TGT', category: 'ideas', subtype: 'idea' }),
    ]
    const expected = new Map(items.map(i => [i.id, exploreCardSize(i).size]))
    for (const order of [items, [...items].reverse(), [items[2], items[0], items[3], items[1]]]) {
      for (const i of order) expect(exploreCardSize(i).size).toBe(expected.get(i.id))
    }
  })

  it('explains itself', () => {
    // The reason is not rendered anywhere. It exists so that "why is this card
    // wide" is answerable in review without re-deriving the rule.
    expect(exploreCardSize(material()).reason).toMatch(/material position/)
    expect(exploreCardSize(item({ subtype: 'aggregate' })).reason).toMatch(/aggregate/)
  })
})

describe('a chart appears where price is context for the finding', () => {
  it('draws one for a signal, a research finding and a story', () => {
    for (const subtype of ['signal', 'research', 'news'] as const) {
      expect(exploreChartEligible(item({ subtype, symbol: 'NVDA' }))).toBe(true)
    }
  })

  it('draws none for an idea, a workflow item or an aggregate', () => {
    // §11: an idea's content is its argument and a task's is its deadline. A
    // year of closes under either implies the price explains the card.
    for (const subtype of ['idea', 'workflow', 'aggregate'] as const) {
      expect(exploreChartEligible(item({ subtype, symbol: 'TGT' }))).toBe(false)
    }
  })

  it('draws none without a symbol', () => {
    expect(exploreChartEligible(item({ symbol: null }))).toBe(false)
  })

  it('has exactly three height variants, one per shape of content', () => {
    const heights = new Set([
      exploreCardHeight(item({ symbol: 'NVDA' }), 'compact'),
      exploreCardHeight(item({ subtype: 'workflow' }), 'compact'),
      exploreCardHeight(material(), 'feature'),
    ])
    expect(heights).toEqual(new Set(['compact-chart', 'compact', 'feature']))
  })
})

describe('packing leaves no holes', () => {
  it('pairs two adjacent compact cards', () => {
    const two = [item({ id: 'a' }), item({ id: 'b' })]
    expect(spans(two)).toEqual(['half', 'half'])
  })

  it('gives a featured card the whole row', () => {
    const cards = packExplore([material({ id: 'f' }), item({ id: 'a' }), item({ id: 'b' })].map(entry))
    expect(cards[0].span).toBe('full')
    expect(cards[0].size).toBe('feature')
    expect(cards.slice(1).map(c => c.span)).toEqual(['half', 'half'])
  })

  it('reaches past a featured card rather than orphaning a compact one', () => {
    /**
     * The reported hole, exactly. TGT sat alone in the left column because the
     * next card was wide, so the right column was simply page — and an empty
     * cell is indistinguishable from a card that failed to render.
     */
    const page = [
      item({ id: 'tgt', symbol: 'TGT', category: 'ideas', subtype: 'idea' }),
      material({ id: 'pg', symbol: 'PG' }),
      item({ id: 'jnj', symbol: 'JNJ', category: 'news', subtype: 'news' }),
    ]
    const cards = packExplore(page.map(entry))
    expect(cards.map(c => c.entry.item.id)).toEqual(['tgt', 'jnj', 'pg'])
    expect(cards.map(c => c.span)).toEqual(['half', 'half', 'full'])
  })

  it('prefers a partner of the same shape, within the same reach', () => {
    // A row whose two halves have the same content shape reads as one row. The
    // chart-bearing card is second in the queue and the chartless one third;
    // the chartless head takes the chartless partner.
    const page = [
      item({ id: 'flat-a', subtype: 'workflow', category: 'workflow' }),
      item({ id: 'charted', symbol: 'NVDA' }),
      item({ id: 'flat-b', subtype: 'workflow', category: 'workflow' }),
    ]
    const cards = packExplore(page.map(entry))
    expect(cards.map(c => c.entry.item.id)).toEqual(['flat-a', 'flat-b', 'charted'])
    expect(cards[0].height).toBe(cards[1].height)
  })

  it('spans a compact card rather than pairing it with a hole', () => {
    const cards = packExplore([item({ id: 'lonely' })].map(entry))
    expect(cards).toHaveLength(1)
    expect(cards[0].span).toBe('full')
    // Still a compact card. Width to avoid a hole is not the same as emphasis.
    expect(cards[0].size).toBe('compact')
    expect(cards[0].height).not.toBe('feature')
  })

  it('never emits an odd number of halves before a full-width card', () => {
    // The invariant behind "no holes", asserted on the real page rather than on
    // a constructed case: a `col-span-full` card landing on an odd column
    // offset is what leaves the empty cell, so the count of halves before every
    // full must be even.
    const cards = layoutExplore(composeExplore(EXPLORE_FIXTURE, { now: NOW }))
    let halves = 0
    for (const c of cards) {
      if (c.span === 'full') {
        expect(halves % 2, `${c.entry.item.id} follows ${halves} halves`).toBe(0)
        continue
      }
      halves += 1
    }
    expect(halves % 2).toBe(0)
  })
})

describe('packing respects the ranking it was given', () => {
  it('moves a card forward by no more than the documented reach', () => {
    const cards = layoutExplore(composeExplore(EXPLORE_FIXTURE, { now: NOW }))
    for (const c of cards) {
      expect(c.promotedBy, `${c.entry.item.id} jumped ${c.promotedBy}`).toBeLessThanOrEqual(LOOKAHEAD)
    }
  })

  it('does not reshuffle a page that already packs cleanly', () => {
    const page = Array.from({ length: 8 }, (_, i) => item({ id: `c${i}` }))
    expect(packExplore(page.map(entry)).map(c => c.entry.item.id))
      .toEqual(page.map(i => i.id))
    expect(packExplore(page.map(entry)).every(c => c.promotedBy === 0)).toBe(true)
  })

  it('drops nothing and duplicates nothing', () => {
    const composed = composeExplore(EXPLORE_FIXTURE, { now: NOW })
    const packed = layoutExplore(composed)
    expect(packed).toHaveLength(composed.length)
    expect(new Set(packed.map(c => c.entry.item.id)).size).toBe(composed.length)
  })

  it('is deterministic', () => {
    const composed = composeExplore(EXPLORE_FIXTURE, { now: NOW })
    const once = layoutExplore(composed).map(c => `${c.entry.item.id}:${c.span}:${c.height}`)
    for (let i = 0; i < 10; i++) {
      expect(layoutExplore(composed).map(c => `${c.entry.item.id}:${c.span}:${c.height}`)).toEqual(once)
    }
  })
})

describe('the page budget keeps emphasis meaning something', () => {
  it('spends no more than the budget however many cards earn width', () => {
    const many = Array.from({ length: 12 }, (_, i) => material({ id: `m${i}`, symbol: `S${i}` }))
    expect(sizes(many).filter(s => s === 'feature').length).toBeLessThanOrEqual(MAX_FEATURES)
  })

  it('never stacks two featured rows', () => {
    const cards = packExplore([material({ id: 'a' }), material({ id: 'b' })].map(entry))
    expect(cards.map(c => c.size)).toEqual(['feature', 'compact'])
  })

  it('demotes without reordering', () => {
    // A demotion is a page constraint, not a ranking one. The item stays where
    // the composition put it and keeps the size it earned.
    const a = material({ id: 'a' })
    const b = material({ id: 'b' })
    const cards = packExplore([a, b].map(entry))
    expect(cards.map(c => c.entry.item.id)).toEqual(['a', 'b'])
    expect(exploreCardSize(b).size).toBe('feature')
  })

  it('carries the size through to the emphasis the DOM reports', () => {
    for (const c of layoutExplore(composeExplore(EXPLORE_FIXTURE, { now: NOW }))) {
      expect(c.entry.emphasis).toBe(c.size === 'feature' ? 'feature' : 'standard')
    }
  })
})
