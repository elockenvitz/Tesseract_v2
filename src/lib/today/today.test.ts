/**
 * Focused tests for the Today domain layer.
 *
 * Scope: tier-first ordering, evaluator → item adaptation, archetype selection
 * and its degradation, and finite composition. Pure — no React, no network.
 */

import { describe, it, expect } from 'vitest'
import type { DecisionItem, DecisionSeverity } from '../../engine/decisionEngine/types'
import { adaptDecisionItem, visualFor, targetFor } from './adapt'
import { tierFor, compareTodayItems, selectToday, TODAY_LIMIT } from './tiers'
import { expandToObjects, isAggregate } from './expand'

function item(over: Partial<DecisionItem> & { titleKey?: string }): DecisionItem {
  return {
    id: over.id ?? 'x-1',
    surface: 'action',
    severity: (over.severity ?? 'orange') as DecisionSeverity,
    category: 'risk',
    title: over.title ?? 'Thesis May Be Stale',
    titleKey: over.titleKey,
    description: over.description ?? 'Research thesis has not been updated recently.',
    chips: over.chips,
    context: over.context ?? { assetId: 'a-amzn', assetTicker: 'AMZN' },
    ctas: over.ctas ?? [],
    sortScore: 0,
    createdAt: over.createdAt,
    ...over,
  } as DecisionItem
}

const stale = () => item({
  id: 'thesis-stale-a-amzn', titleKey: 'THESIS_STALE', severity: 'red',
  chips: [{ label: 'Ticker', value: 'AMZN' }, { label: 'Age', value: '210d' }],
  ctas: [{ label: 'Update Thesis', actionKey: 'OPEN_ASSET_UPDATE_THESIS', kind: 'primary' }],
})

describe('tier assignment', () => {
  it('puts an unconfirmed execution above everything', () => {
    expect(tierFor(item({ titleKey: 'EXECUTION_NOT_CONFIRMED' })).tier).toBe(0)
  })

  it('groups framework decay together regardless of age', () => {
    expect(tierFor(item({ titleKey: 'THESIS_STALE' })).tier).toBe(1)
    expect(tierFor(item({ titleKey: 'RATING_NO_FOLLOWUP' })).tier).toBe(1)
  })

  it('puts a blocked colleague above workflow but below framework', () => {
    expect(tierFor(item({ titleKey: 'PROPOSAL_AWAITING_DECISION' })).tier).toBe(2)
    expect(tierFor(item({ titleKey: 'OVERDUE_DELIVERABLE' })).tier).toBe(3)
  })

  it('ranks an unmapped evaluator as informational rather than dropping it', () => {
    expect(tierFor(item({ titleKey: 'SOMETHING_NEW' })).tier).toBe(4)
  })

  it('lets severity move the score but never the tier', () => {
    const red = tierFor(item({ titleKey: 'THESIS_STALE', severity: 'red' }))
    const blue = tierFor(item({ titleKey: 'THESIS_STALE', severity: 'blue' }))
    expect(red.tier).toBe(blue.tier)
    expect(red.base).toBeGreaterThan(blue.base)
  })
})

describe('ordering', () => {
  it('never lets a newer low-tier item outrank a high-tier one', () => {
    // The exact regression the flat sortScore allowed.
    const workflow = adaptDecisionItem(item({
      id: 'w', titleKey: 'OVERDUE_DELIVERABLE', severity: 'red',
      createdAt: new Date().toISOString(),
    }))
    const framework = adaptDecisionItem(item({
      id: 'f', titleKey: 'THESIS_STALE', severity: 'yellow',
      createdAt: '2020-01-01T00:00:00.000Z',
    }))
    expect([workflow, framework].sort(compareTodayItems)[0].id).toBe('f')
  })

  it('is stable — equal tier and score break by id, not by chance', () => {
    const a = adaptDecisionItem(item({ id: 'aaa', titleKey: 'THESIS_STALE' }))
    const b = adaptDecisionItem(item({ id: 'bbb', titleKey: 'THESIS_STALE' }))
    expect([b, a].sort(compareTodayItems).map(i => i.id)).toEqual(['aaa', 'bbb'])
    expect([a, b].sort(compareTodayItems).map(i => i.id)).toEqual(['aaa', 'bbb'])
  })
})

describe('composition', () => {
  const many = Array.from({ length: 9 }, (_, i) =>
    adaptDecisionItem(item({ id: `i${i}`, titleKey: 'THESIS_STALE' })))

  it('surfaces a finite set and reports the rest rather than hiding them', () => {
    const sel = selectToday(many)
    expect(sel.surfaced).toHaveLength(TODAY_LIMIT)
    expect(sel.alsoWatching).toHaveLength(5)
    expect(sel.evaluated).toBe(9)
  })

  it('handles a single item without inventing supporting priorities', () => {
    const sel = selectToday([many[0]])
    expect(sel.surfaced).toHaveLength(1)
    expect(sel.alsoWatching).toHaveLength(0)
  })

  it('handles zero items', () => {
    expect(selectToday([])).toEqual({ surfaced: [], alsoWatching: [], evaluated: 0 })
  })
})

describe('adaptation', () => {
  it('answers what happened, why it matters and what next from real output', () => {
    const t = adaptDecisionItem(stale())
    expect(t.ticker).toBe('AMZN')
    expect(t.state).toBe('Thesis May Be Stale')
    // The verb is Today's; the actionKey is always the engine's.
    expect(t.nextAction).toBe('Review thesis')
    expect(t.primary).toMatchObject({ label: 'Review thesis', actionKey: 'OPEN_ASSET_UPDATE_THESIS' })
  })

  it('makes the claim an investment statement, not the engine description', () => {
    const t = adaptDecisionItem(stale())
    expect(t.claim).toMatch(/six months/)
    // The engine's queue-facing wording must not reach the tile.
    expect(t.claim).not.toBe('Research thesis has not been updated recently.')
    // the metric strip carries "210d"; the claim says what it means
    expect(t.metrics.some(m => m.value === '210d')).toBe(true)
  })

  it('names metrics semantically and drops any it cannot name', () => {
    const t = adaptDecisionItem(stale())
    expect(t.metrics.map(m => m.label)).toEqual(['Since review'])
    expect(t.metrics.map(m => m.label)).not.toContain('Age')
  })

  it('never renders an UNKNOWN metric, whatever chips arrive', () => {
    const t = adaptDecisionItem(item({
      titleKey: 'THESIS_STALE',
      chips: [{ label: 'Unknown', value: '7' }, { label: 'Growth Composite', value: '3' }],
    }))
    expect(t.metrics).toEqual([])
  })

  it('refuses a generic batch verb rather than showing it', () => {
    const t = adaptDecisionItem(item({
      titleKey: undefined,
      ctas: [{ label: 'Review all', actionKey: 'OPEN_TRADE_QUEUE_FILTERED', kind: 'primary' }],
    }))
    expect(t.primary).toBeNull()
    expect(t.nextAction).toBeNull()
  })

  it('keeps the ticker out of the metric strip — it is identity, not a metric', () => {
    expect(adaptDecisionItem(stale()).metrics.map(m => m.label)).not.toContain('Ticker')
  })

  it('carries a per-evaluator seed prompt naming the actual problem', () => {
    const t = adaptDecisionItem(stale())
    expect(t.seedPrompt).toMatch(/AMZN/)
    expect(t.seedPrompt).toMatch(/210d|stale/)
  })

  it('binds an engagement target carrying the issue and its origin', () => {
    const target = targetFor(stale())!
    expect(target).toMatchObject({ objectType: 'asset', objectId: 'a-amzn' })
    expect(target.issue).toMatchObject({ reason: 'THESIS_STALE' })
    expect(target.origin).toMatchObject({ itemId: 'thesis-stale-a-amzn', surface: 'today' })
  })

  it('returns no target when the evaluator named no object', () => {
    expect(targetFor(item({ titleKey: 'OVERDUE_DELIVERABLE', context: {} }))).toBeNull()
  })

  it('produces no primary when the evaluator offered no CTA', () => {
    expect(adaptDecisionItem(item({ titleKey: 'THESIS_STALE', ctas: [] })).primary).toBeNull()
  })
})

describe('object-level expansion', () => {
  const kids = [
    item({ id: 'k1', titleKey: 'THESIS_STALE', chips: [{ label: 'Ticker', value: 'AMZN' }, { label: 'Age', value: '210d' }], context: { assetId: 'a1', assetTicker: 'AMZN' }, ctas: [{ label: 'Update Thesis', actionKey: 'OPEN_ASSET_UPDATE_THESIS', kind: 'primary' }] }),
    item({ id: 'k2', titleKey: 'THESIS_STALE', chips: [{ label: 'Ticker', value: 'NVDA' }, { label: 'Age', value: '150d' }], context: { assetId: 'a2', assetTicker: 'NVDA' }, ctas: [{ label: 'Update Thesis', actionKey: 'OPEN_ASSET_UPDATE_THESIS', kind: 'primary' }] }),
    item({ id: 'k3', titleKey: 'THESIS_STALE', chips: [{ label: 'Ticker', value: 'MSFT' }, { label: 'Age', value: '120d' }], context: { assetId: 'a3', assetTicker: 'MSFT' }, ctas: [{ label: 'Update Thesis', actionKey: 'OPEN_ASSET_UPDATE_THESIS', kind: 'primary' }] }),
  ]

  // A faithful copy of what postprocess.ts actually emits: empty context,
  // count-shaped chips, a batch CTA, and the objects hidden underneath.
  const rollup = (children: DecisionItem[]): DecisionItem => item({
    id: 'rollup-thesis-stale',
    titleKey: 'THESIS_STALE',
    title: `${children.length} theses may be stale`,
    description: 'Oldest 315 days since update.',
    chips: [{ label: 'Unknown', value: String(children.length) }],
    context: {},
    ctas: [{ label: 'Review', actionKey: 'OPEN_ASSET_REVIEW_SEQUENCE', kind: 'primary' }],
    children,
  })

  it('replaces an aggregate with the objects it describes', () => {
    expect(expandToObjects([rollup(kids)]).items.map(i => i.id)).toEqual(['k1', 'k2', 'k3'])
  })

  it('never lets an aggregate occupy a Today slot', () => {
    const { items } = expandToObjects([rollup(kids)])
    expect(items.some(isAggregate)).toBe(false)
    expect(items.some(i => i.id.startsWith('rollup-'))).toBe(false)
    expect(selectToday(items.map(adaptDecisionItem)).surfaced.some(s => /^\d+\s/.test(s.state))).toBe(false)
  })

  it('keeps the aggregate only as provenance', () => {
    expect(expandToObjects([rollup(kids)]).aggregates).toEqual([
      { titleKey: 'THESIS_STALE', title: '3 theses may be stale', count: 3 },
    ])
  })

  it('leaves already-object-level items untouched', () => {
    const { items, aggregates } = expandToObjects([kids[0]])
    expect(items).toEqual([kids[0]])
    expect(aggregates).toEqual([])
  })

  it('expands at any depth', () => {
    expect(expandToObjects([rollup([rollup(kids)])]).items.map(i => i.id)).toEqual(['k1', 'k2', 'k3'])
  })

  it('gives every expanded object real identity, verb and engagement target', () => {
    const adapted = expandToObjects([rollup(kids)]).items.map(adaptDecisionItem)
    expect(adapted.map(a => a.ticker)).toEqual(['AMZN', 'NVDA', 'MSFT'])
    expect(adapted.every(a => a.primary?.label === 'Review thesis')).toBe(true)
    // The target an aggregate could never carry — this is why Ask AI vanished.
    expect(adapted.every(a => a.target?.objectType === 'asset')).toBe(true)
    expect(adapted[0].target?.issue).toMatchObject({ reason: 'THESIS_STALE' })
  })

  it('cuts finitely AFTER expansion, so objects compete individually', () => {
    const waiting = item({
      id: 'clov', titleKey: 'PROPOSAL_AWAITING_DECISION', severity: 'red',
      chips: [{ label: 'Ticker', value: 'CLOV' }, { label: 'Open', value: '62d' }],
      context: { assetId: 'c1', assetTicker: 'CLOV', tradeIdeaId: 't1' },
    })
    const sel = selectToday(expandToObjects([rollup(kids), waiting]).items.map(adaptDecisionItem))

    expect(sel.evaluated).toBe(4)
    expect(sel.surfaced.map(s => s.ticker)).toContain('CLOV')
    expect(sel.surfaced[0].tier).toBe(1)   // framework leads someone-waiting
  })
})

describe('visual-per-problem', () => {
  it('gives a decaying thesis a staleness meter', () => {
    expect(visualFor(stale())).toMatchObject({ archetype: 'staleness' })
  })

  it('gives an unresolved proposal an aging line', () => {
    const v = visualFor(item({
      titleKey: 'PROPOSAL_AWAITING_DECISION',
      chips: [{ label: 'Open', value: '62d' }],
    }))
    expect(v.archetype).toBe('aging')
    expect(v.aging?.days).toBe(62)
  })

  it('gives a rating change a transition, not a chart', () => {
    const v = visualFor(item({
      titleKey: 'RATING_NO_FOLLOWUP',
      chips: [{ label: 'From', value: 'B' }, { label: 'To', value: 'D' }],
    }))
    expect(v).toMatchObject({ archetype: 'transition', transition: { from: 'B', to: 'D' } })
  })

  it('gives an unsimulated idea an exposure bar when a weight exists', () => {
    const v = visualFor(item({
      titleKey: 'IDEA_NOT_SIMULATED', context: { assetId: 'a', proposedWeight: 4.2 },
    }))
    expect(v).toMatchObject({ archetype: 'exposure', exposure: { weightPct: 4.2 } })
  })

  it('gives high EV a modelled-upside treatment', () => {
    const v = visualFor(item({
      titleKey: 'HIGH_EV_NO_IDEA', chips: [{ label: 'EV', value: '32% upside' }],
    }))
    expect(v).toMatchObject({ archetype: 'expected-return', expectedReturn: { evPct: 32 } })
  })

  it('every visual names its window', () => {
    // Mobile's rule: an unlabelled graphic beside a metric reads as a
    // contradiction and the reader distrusts the number.
    for (const k of ['THESIS_STALE', 'RATING_NO_FOLLOWUP', 'HIGH_EV_NO_IDEA', 'NOPE']) {
      const v = visualFor(item({
        titleKey: k,
        chips: [{ label: 'Age', value: '99d' }, { label: 'From', value: 'B' },
                { label: 'To', value: 'C' }, { label: 'EV', value: '10%' }],
      }))
      expect(v.window).toBeTruthy()
      expect(v.caption).toBeTruthy()
    }
  })

  describe('degradation', () => {
    it('falls back to metrics rather than drawing a chart with no data', () => {
      expect(visualFor(item({ titleKey: 'THESIS_STALE', chips: [] })).archetype).toBe('metrics')
      expect(visualFor(item({ titleKey: 'RATING_NO_FOLLOWUP', chips: [{ label: 'From', value: 'B' }] })).archetype).toBe('metrics')
      expect(visualFor(item({ titleKey: 'IDEA_NOT_SIMULATED', context: { assetId: 'a' } })).archetype).toBe('metrics')
      expect(visualFor(item({ titleKey: 'HIGH_EV_NO_IDEA', chips: [] })).archetype).toBe('metrics')
    })

    it('falls back for an evaluator it has never seen', () => {
      expect(visualFor(item({ titleKey: 'BRAND_NEW' })).archetype).toBe('metrics')
    })

    it('adapts an item with no chips, no ctas and no context at all', () => {
      const t = adaptDecisionItem(item({ titleKey: undefined, chips: undefined, ctas: [], context: {} }))
      expect(t.metrics).toEqual([])
      expect(t.primary).toBeNull()
      expect(t.target).toBeNull()
      expect(t.visual.archetype).toBe('metrics')
      expect(t.claim).toBeTruthy()
    })
  })
})
