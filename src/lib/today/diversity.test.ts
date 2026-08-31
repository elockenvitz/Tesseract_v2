/**
 * Focused tests for Today's diversity rule and enrichment honesty.
 *
 * The safety property under test throughout: variety may never promote a less
 * material finding over a more material one.
 */

import { describe, it, expect } from 'vitest'
import type { DecisionItem, DecisionSeverity } from '../../engine/decisionEngine/types'
import { adaptDecisionItem } from './adapt'
import { compareTodayItems, TODAY_LIMIT } from './tiers'
import { diversify } from './diversity'
import { applyEnrichment, priceWindowSince, windowLabel } from './enrich'
import type { TodayItem } from './types'

function make(id: string, titleKey: string, over: Partial<DecisionItem> = {}): TodayItem {
  return adaptDecisionItem({
    id, surface: 'action', severity: (over.severity ?? 'orange') as DecisionSeverity,
    category: 'risk', title: over.title ?? titleKey, titleKey,
    description: 'x',
    chips: over.chips ?? [{ label: 'Ticker', value: id.toUpperCase() }, { label: 'Age', value: '200d' }],
    context: over.context ?? { assetId: `a-${id}`, assetTicker: id.toUpperCase() },
    ctas: [], sortScore: 0, ...over,
  } as DecisionItem)
}

const ranked = (items: TodayItem[]) => [...items].sort(compareTodayItems)

describe('diversity', () => {
  it('never moves #1 — the lead is the highest-ranked item', () => {
    const items = ranked([
      make('tgt', 'THESIS_STALE', { severity: 'red' }),
      make('lly', 'THESIS_STALE'), make('amzn', 'THESIS_STALE'), make('wmt', 'THESIS_STALE'),
      make('clov', 'PROPOSAL_AWAITING_DECISION', {
        severity: 'red', context: { assetId: 'c', assetTicker: 'CLOV', tradeIdeaId: 't' },
        chips: [{ label: 'Ticker', value: 'CLOV' }, { label: 'Open', value: '62d' }],
      }),
    ])
    const out = diversify(items, TODAY_LIMIT)
    expect(out[0].id).toBe(items[0].id)
  })

  it('breaks a saturated set when a materially comparable alternative exists', () => {
    // The exact real-data failure: four stale theses with a waiting decision
    // sitting just below the cut.
    const items = ranked([
      make('tgt', 'THESIS_STALE', { severity: 'red' }),
      make('lly', 'THESIS_STALE'), make('amzn', 'THESIS_STALE'), make('wmt', 'THESIS_STALE'),
      make('clov', 'PROPOSAL_AWAITING_DECISION', {
        severity: 'red', context: { assetId: 'c', assetTicker: 'CLOV', tradeIdeaId: 't' },
        chips: [{ label: 'Ticker', value: 'CLOV' }, { label: 'Open', value: '62d' }],
      }),
    ])
    const keys = diversify(items, TODAY_LIMIT).slice(0, TODAY_LIMIT)
      .map(i => i.source.titleKey)
    // One alternative exists, so one slot changes hands. The cap cannot force
    // a second swap out of a pool that has nothing else to swap in -- 3 + 1 is
    // the best achievable set, not a partial failure.
    expect(keys).toContain('PROPOSAL_AWAITING_DECISION')
    expect(keys.filter(k => k === 'THESIS_STALE')).toHaveLength(3)
  })

  it('reaches the cap when the pool actually offers two alternatives', () => {
    const items = ranked([
      make('tgt', 'THESIS_STALE', { severity: 'red' }),
      make('lly', 'THESIS_STALE'), make('amzn', 'THESIS_STALE'), make('wmt', 'THESIS_STALE'),
      make('clov', 'PROPOSAL_AWAITING_DECISION', {
        severity: 'red', context: { assetId: 'c', assetTicker: 'CLOV', tradeIdeaId: 't' },
        chips: [{ label: 'Ticker', value: 'CLOV' }, { label: 'Open', value: '62d' }],
      }),
      make('nvda', 'RATING_NO_FOLLOWUP', {
        severity: 'orange',
        chips: [{ label: 'Ticker', value: 'NVDA' }, { label: 'From', value: 'B' }, { label: 'To', value: 'D' }],
      }),
    ])
    const keys = diversify(items, TODAY_LIMIT).slice(0, TODAY_LIMIT).map(i => i.source.titleKey)
    expect(keys.filter(k => k === 'THESIS_STALE')).toHaveLength(2)
    expect(new Set(keys).size).toBe(3)
  })

  it('does not spend two slots on the same object when an alternative exists', () => {
    // The real-data case: two COIN proposals in two portfolios. Both genuine,
    // but two tiles headed COIN tell the reader about one name twice.
    const coin = (n: string) => make(n, 'PROPOSAL_AWAITING_DECISION', {
      severity: 'red',
      context: { assetId: 'a-coin', assetTicker: 'COIN', tradeIdeaId: `t${n}` },
      chips: [{ label: 'Ticker', value: 'COIN' }, { label: 'Open', value: '88d' }],
    })
    const items = ranked([
      coin('c1'), coin('c2'),
      make('lly', 'THESIS_STALE'), make('tgt', 'THESIS_STALE'),
      make('nvda', 'RATING_NO_FOLLOWUP', {
        chips: [{ label: 'Ticker', value: 'NVDA' }, { label: 'From', value: 'B' }, { label: 'To', value: 'D' }],
      }),
    ])
    const surfaced = diversify(items, TODAY_LIMIT).slice(0, TODAY_LIMIT)
    const objects = surfaced.map(i => i.source.context.assetId)
    expect(new Set(objects).size).toBe(objects.length)
  })

  it('still surfaces a repeated object when nothing else qualifies', () => {
    const coin = (n: string) => make(n, 'PROPOSAL_AWAITING_DECISION', {
      severity: 'red',
      context: { assetId: 'a-coin', assetTicker: 'COIN', tradeIdeaId: `t${n}` },
      chips: [{ label: 'Ticker', value: 'COIN' }, { label: 'Open', value: '88d' }],
    })
    const items = ranked([coin('c1'), coin('c2'), coin('c3')])
    // Nothing else exists, so the honest answer is to show them.
    expect(diversify(items, TODAY_LIMIT).slice(0, TODAY_LIMIT)).toHaveLength(3)
  })

  it('does NOT promote a trivial workflow item over material findings', () => {
    // OVERDUE_DELIVERABLE is tier 3; THESIS_STALE is tier 1. The tier reach of
    // one disqualifies it, so the set stays saturated rather than getting
    // variety it has not earned.
    const items = ranked([
      make('a', 'THESIS_STALE'), make('b', 'THESIS_STALE'),
      make('c', 'THESIS_STALE'), make('d', 'THESIS_STALE'),
      make('chore', 'OVERDUE_DELIVERABLE'),
    ])
    const keys = diversify(items, TODAY_LIMIT).slice(0, TODAY_LIMIT).map(i => i.source.titleKey)
    expect(keys.every(k => k === 'THESIS_STALE')).toBe(true)
  })

  it('leaves a set alone when it is already diverse', () => {
    const items = ranked([
      make('a', 'EXECUTION_NOT_CONFIRMED'), make('b', 'THESIS_STALE'),
      make('c', 'PROPOSAL_AWAITING_DECISION', { context: { assetId: 'c', tradeIdeaId: 't' } }),
      make('d', 'RATING_NO_FOLLOWUP'),
    ])
    expect(diversify(items, TODAY_LIMIT).map(i => i.id)).toEqual(items.map(i => i.id))
  })

  it('is a permutation — nothing is added or lost', () => {
    const items = ranked(['a', 'b', 'c', 'd', 'e', 'f'].map(i => make(i, 'THESIS_STALE')))
    const out = diversify(items, TODAY_LIMIT)
    expect(out).toHaveLength(items.length)
    expect(out.map(i => i.id).sort()).toEqual(items.map(i => i.id).sort())
  })

  it('keeps the unsurfaced tail in ranked order for Also watching', () => {
    const items = ranked(['a', 'b', 'c', 'd', 'e', 'f'].map(i => make(i, 'THESIS_STALE')))
    const out = diversify(items, TODAY_LIMIT)
    expect(out.slice(TODAY_LIMIT)).toEqual(items.slice(TODAY_LIMIT))
  })

  it('does nothing to a set too small to saturate', () => {
    const items = ranked([make('a', 'THESIS_STALE'), make('b', 'THESIS_STALE')])
    expect(diversify(items, TODAY_LIMIT)).toEqual(items)
  })
})

describe('enrichment honesty', () => {
  const hist = (from: string, closes: number[]) =>
    closes.map((close, i) => ({
      date: new Date(Date.parse(from) + i * 86_400_000).toISOString().slice(0, 10),
      close,
    }))

  it('measures from the review anchor when history reaches it', () => {
    const w = priceWindowSince(hist('2026-01-01', [100, 110, 120, 125]), '2026-01-02')!
    expect(w.reachesAnchor).toBe(true)
    expect(w.changePct).toBeCloseTo(13.6, 0)   // 110 → 125
  })

  it('refuses to call it "since review" when history starts later', () => {
    const w = priceWindowSince(hist('2026-06-01', [100, 120]), '2026-01-01')!
    expect(w.reachesAnchor).toBe(false)
    expect(windowLabel(w, 246)).not.toMatch(/since review/)
    expect(windowLabel(w, 246)).toMatch(/of history/)
    // The move itself is still real -- it is the WINDOW that is not claimed.
    expect(w.changePct).toBeCloseTo(20, 5)
  })

  it('names the window as since-review only when it truly is', () => {
    const w = priceWindowSince(hist('2026-01-01', [100, 125]), '2026-01-01')!
    expect(windowLabel(w, 246)).toBe('since review · 246d')
  })

  it('returns nothing rather than a window from one point', () => {
    expect(priceWindowSince(hist('2026-01-01', [100]), '2026-01-01')).toBeNull()
    expect(priceWindowSince(undefined, '2026-01-01')).toBeNull()
  })

  it('leaves an item untouched when there is no enrichment', () => {
    const item = make('tgt', 'THESIS_STALE')
    expect(applyEnrichment(item, undefined)).toBe(item)
  })

  it('renders the scenario visual only with a real ladder AND a real spot', () => {
    const item = make('tgt', 'THESIS_STALE')
    const ladder = {
      assetId: 'a-tgt', symbol: 'TGT', companyName: null, updatedAt: '2026-02-01',
      valid: true, reason: '',
      cases: [{ name: 'Bear', price: 90 }, { name: 'Base', price: 120 }, { name: 'Bull', price: 150 }],
    } as any

    // Ladder but no spot → no scenario visual.
    expect(applyEnrichment(item, { ladder }).visual.archetype).not.toBe('scenario')
    // Spot but no ladder → no scenario visual.
    expect(applyEnrichment(item, { spot: 180 }).visual.archetype).not.toBe('scenario')
    // Both → scenario, and the note names the breach.
    const v = applyEnrichment(item, { ladder, spot: 180 }).visual
    expect(v.archetype).toBe('scenario')
    expect(v.note).toMatch(/above the bull case/)
  })

  it('never draws a policy threshold on exposure', () => {
    const item = make('idea', 'IDEA_NOT_SIMULATED', {
      context: { assetId: 'a', proposedWeight: 4.2 },
    })
    const out = applyEnrichment(item, { weightPct: 4.2 })
    expect(JSON.stringify(out.visual)).not.toMatch(/policy/i)
  })

  it('makes the claim object-specific once real numbers exist', () => {
    const item = make('tgt', 'THESIS_STALE')
    const generic = item.claim
    const out = applyEnrichment(item, {
      history: hist('2026-01-01', [100, 125]), weightPct: 8.2,
    })
    expect(out.claim).not.toBe(generic)
    expect(out.claim).toMatch(/8\.2% of the book/)
    expect(out.claim).toMatch(/200 days/)
  })

  it('gives the D1 target richer context without changing its identity', () => {
    const item = make('tgt', 'THESIS_STALE')
    const out = applyEnrichment(item, {
      history: hist('2026-01-01', [100, 125]), weightPct: 8.2, researchCount: 3,
      portfolioName: 'Growth Composite',
    })
    // Identity is untouched — this is the D1 contract.
    expect(out.target!.objectType).toBe(item.target!.objectType)
    expect(out.target!.objectId).toBe(item.target!.objectId)
    expect(out.target!.issue).toEqual(item.target!.issue)

    const labels = out.target!.contextChips!.map(c => c.label)
    expect(labels).toContain('Portfolio weight')
    expect(labels).toContain('Linked research')
    expect(labels).toContain('Portfolio')
  })
})
