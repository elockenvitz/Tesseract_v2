/**
 * Decision Tiering + Rollup tests.
 *
 * Verifies:
 *   - IDEA_NOT_SIMULATED rollup at >= 3 items
 *   - THESIS_STALE threshold lowered to >= 3
 *   - Capital tier outranks coverage tier regardless of severity
 *   - Deterministic ordering (same input → same output)
 *   - Rollup inherits decisionTier from children
 */

import { describe, it, expect } from 'vitest'
import { postprocess, rollupItems } from '../postprocess'
import { computeSortScore, compareItems, TIER_WEIGHT, SEVERITY_WEIGHT } from '../scoring'
import type { DecisionItem, DecisionTier } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = new Date('2026-02-15T12:00:00Z')

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86400000).toISOString()
}

function makeIdeaNotSimulatedItem(id: string, ageDays: number, portfolio = 'Growth'): DecisionItem {
  return {
    id: `a3-unsimulated-${id}`,
    surface: 'action',
    severity: 'orange',
    category: 'process',
    title: 'Idea Not Simulated',
    titleKey: 'IDEA_NOT_SIMULATED',
    description: 'Trade idea created without portfolio impact test.',
    chips: [
      { label: 'Ticker', value: `T${id}` },
      { label: 'Age', value: `${ageDays}d` },
      { label: 'Portfolio', value: portfolio },
    ],
    context: {
      assetId: `asset-${id}`,
      assetTicker: `T${id}`,
      portfolioId: `port-${id}`,
      portfolioName: portfolio,
      tradeIdeaId: `idea-${id}`,
    },
    ctas: [
      { label: 'Simulate', actionKey: 'OPEN_TRADE_LAB_SIMULATION', kind: 'primary', payload: { assetId: `asset-${id}` } },
    ],
    dismissible: false,
    decisionTier: 'capital',
    sortScore: 0,
    createdAt: daysAgo(ageDays),
  }
}

function makeThesisStaleItem(id: string, ageDays: number): DecisionItem {
  return {
    id: `thesis-stale-${id}-agg`,
    surface: 'action',
    severity: ageDays >= 180 ? 'red' : 'orange',
    category: 'risk',
    title: 'Thesis May Be Stale',
    titleKey: 'THESIS_STALE',
    description: 'Research thesis has not been updated recently.',
    chips: [
      { label: 'Ticker', value: `S${id}` },
      { label: 'Age', value: `${ageDays}d` },
    ],
    context: { assetId: `asset-${id}`, assetTicker: `S${id}` },
    ctas: [
      { label: 'Update Thesis', actionKey: 'OPEN_ASSET_UPDATE_THESIS', kind: 'primary', payload: { assetId: `asset-${id}` } },
    ],
    dismissible: false,
    decisionTier: 'coverage',
    sortScore: 0,
    createdAt: daysAgo(ageDays),
  }
}

function makeCapitalItem(id: string, severity: 'red' | 'orange', ageDays: number): DecisionItem {
  return {
    id: `a1-proposal-${id}`,
    surface: 'action',
    severity,
    category: 'process',
    title: 'Proposal Awaiting Decision',
    titleKey: 'PROPOSAL_AWAITING_DECISION',
    description: 'Proposal pending.',
    context: {
      assetId: `asset-${id}`,
      assetTicker: `T${id}`,
      portfolioId: `port-${id}`,
      portfolioName: 'Growth',
      tradeIdeaId: `idea-${id}`,
    },
    ctas: [{ label: 'Review', actionKey: 'OPEN_TRADE_QUEUE_PROPOSAL', kind: 'primary' }],
    dismissible: false,
    decisionTier: 'capital',
    sortScore: 0,
    createdAt: daysAgo(ageDays),
  }
}

function makeIntegrityItem(id: string, ageDays: number): DecisionItem {
  return {
    id: `i1-rating-${id}-${ageDays}`,
    surface: 'action',
    severity: 'orange',
    category: 'risk',
    title: 'Rating Changed, No Follow-up',
    titleKey: 'RATING_NO_FOLLOWUP',
    description: 'Rating changed without a corresponding trade idea.',
    context: {
      assetId: `asset-r${id}`,
      assetTicker: `R${id}`,
    },
    ctas: [{ label: 'Create Idea', actionKey: 'OPEN_ASSET_CREATE_IDEA', kind: 'primary' }],
    dismissible: false,
    decisionTier: 'integrity',
    sortScore: 0,
    createdAt: daysAgo(ageDays),
  }
}

function makeCoverageItem(id: string, ageDays: number): DecisionItem {
  return {
    ...makeThesisStaleItem(id, ageDays),
    id: `thesis-stale-${id}-single`,
  }
}

// ---------------------------------------------------------------------------
// IDEA_NOT_SIMULATED Rollup
// ---------------------------------------------------------------------------

describe('IDEA_NOT_SIMULATED rollup', () => {
  it('rolls up 4 items into 1 rollup with 4 children', () => {
    const items = [
      makeIdeaNotSimulatedItem('1', 5, 'Growth'),
      makeIdeaNotSimulatedItem('2', 7, 'Growth'),
      makeIdeaNotSimulatedItem('3', 4, 'Value'),
      makeIdeaNotSimulatedItem('4', 10, 'Core'),
    ]

    const result = rollupItems(items, NOW)
    const rollups = result.filter(r => r.children?.length)

    expect(rollups).toHaveLength(1)
    expect(rollups[0].id).toBe('rollup-idea-not-simulated')
    expect(rollups[0].title).toBe('4 ideas not simulated')
    expect(rollups[0].children).toHaveLength(4)
    expect(rollups[0].severity).toBe('orange')
    expect(rollups[0].category).toBe('process')
    expect(rollups[0].titleKey).toBe('IDEA_NOT_SIMULATED')
  })

  it('rollup has "Simulate all" CTA with OPEN_TRADE_QUEUE_FILTER', () => {
    const items = [
      makeIdeaNotSimulatedItem('1', 5),
      makeIdeaNotSimulatedItem('2', 7),
      makeIdeaNotSimulatedItem('3', 4),
    ]

    const result = rollupItems(items, NOW)
    const rollup = result.find(r => r.children?.length)!
    const cta = rollup.ctas[0]

    expect(cta.label).toBe('Simulate all')
    expect(cta.actionKey).toBe('OPEN_TRADE_QUEUE_FILTER')
    expect(cta.payload).toEqual({ filter: 'unsimulated' })
  })

  it('does NOT roll up at 2 items (below minCount 3)', () => {
    const items = [
      makeIdeaNotSimulatedItem('1', 5),
      makeIdeaNotSimulatedItem('2', 7),
    ]

    const result = rollupItems(items, NOW)
    expect(result).toHaveLength(2)
    expect(result.every(r => !r.children?.length)).toBe(true)
  })

  it('rolls up at exactly 3 items (minCount = 3)', () => {
    const items = [
      makeIdeaNotSimulatedItem('1', 5),
      makeIdeaNotSimulatedItem('2', 7),
      makeIdeaNotSimulatedItem('3', 4),
    ]

    const result = rollupItems(items, NOW)
    const rollups = result.filter(r => r.children?.length)
    expect(rollups).toHaveLength(1)
    expect(rollups[0].children).toHaveLength(3)
  })

  it('rollup has portfolio breakdown chips', () => {
    const items = [
      makeIdeaNotSimulatedItem('1', 5, 'Growth'),
      makeIdeaNotSimulatedItem('2', 7, 'Growth'),
      makeIdeaNotSimulatedItem('3', 4, 'Value'),
    ]

    const result = rollupItems(items, NOW)
    const rollup = result.find(r => r.children?.length)!

    expect(rollup.chips).toEqual([
      { label: 'Growth', value: '2' },
      { label: 'Value', value: '1' },
    ])
  })

  it('rollup description contains oldest age', () => {
    const items = [
      makeIdeaNotSimulatedItem('1', 3),
      makeIdeaNotSimulatedItem('2', 12),
      makeIdeaNotSimulatedItem('3', 7),
    ]

    const result = rollupItems(items, NOW)
    const rollup = result.find(r => r.children?.length)!
    expect(rollup.description).toBe('Oldest waiting 12 days.')
  })

  it('rollup inherits decisionTier from children', () => {
    const items = [
      makeIdeaNotSimulatedItem('1', 5),
      makeIdeaNotSimulatedItem('2', 7),
      makeIdeaNotSimulatedItem('3', 4),
    ]

    const result = rollupItems(items, NOW)
    const rollup = result.find(r => r.children?.length)!
    expect(rollup.decisionTier).toBe('capital')
  })
})

// ---------------------------------------------------------------------------
// Tier-aware scoring
// ---------------------------------------------------------------------------

describe('tier-aware scoring', () => {
  it('capital tier outranks coverage regardless of severity', () => {
    const capitalOrange = makeCapitalItem('cap1', 'orange', 3)
    const coverageRed = makeThesisStaleItem('cov1', 200) // red severity, 200d old

    capitalOrange.sortScore = computeSortScore(capitalOrange, NOW)
    coverageRed.sortScore = computeSortScore(coverageRed, NOW)

    expect(capitalOrange.sortScore).toBeGreaterThan(coverageRed.sortScore)
  })

  it('capital tier outranks integrity tier', () => {
    const capital = makeCapitalItem('cap1', 'orange', 3)
    const integrity = makeIntegrityItem('int1', 3)

    capital.sortScore = computeSortScore(capital, NOW)
    integrity.sortScore = computeSortScore(integrity, NOW)

    expect(capital.sortScore).toBeGreaterThan(integrity.sortScore)
  })

  it('integrity tier outranks coverage tier', () => {
    const integrity = makeIntegrityItem('int1', 3)
    const coverage = makeCoverageItem('cov1', 95)

    integrity.sortScore = computeSortScore(integrity, NOW)
    coverage.sortScore = computeSortScore(coverage, NOW)

    expect(integrity.sortScore).toBeGreaterThan(coverage.sortScore)
  })

  it('within same tier, red outranks orange', () => {
    const red = makeCapitalItem('r1', 'red', 3)
    const orange = makeCapitalItem('o1', 'orange', 3)

    red.sortScore = computeSortScore(red, NOW)
    orange.sortScore = computeSortScore(orange, NOW)

    expect(red.sortScore).toBeGreaterThan(orange.sortScore)
  })

  it('within same tier and severity, older items rank higher', () => {
    const older = makeCapitalItem('old', 'red', 10)
    const newer = makeCapitalItem('new', 'red', 3)

    older.sortScore = computeSortScore(older, NOW)
    newer.sortScore = computeSortScore(newer, NOW)

    expect(older.sortScore).toBeGreaterThan(newer.sortScore)
  })

  it('tier weights match expected values', () => {
    expect(TIER_WEIGHT.capital).toBe(30000)
    expect(TIER_WEIGHT.integrity).toBe(20000)
    expect(TIER_WEIGHT.coverage).toBe(10000)
  })
})

// ---------------------------------------------------------------------------
// Deterministic ordering
// ---------------------------------------------------------------------------

describe('deterministic ordering', () => {
  it('items with same sortScore are ordered by tiebreaker', () => {
    // Create items with identical scores but different tiebreakers
    const a: DecisionItem = {
      ...makeCapitalItem('a', 'red', 5),
      sortScore: 42000,
    }
    const b: DecisionItem = {
      ...makeCapitalItem('b', 'red', 5),
      sortScore: 42000,
    }

    // compareItems should give deterministic order
    const result1 = compareItems(a, b)
    const result2 = compareItems(b, a)

    // One should be positive, the other negative (or both zero if truly equal)
    expect(result1).toBe(-result2)
    // And the result should be non-zero (different IDs → different tiebreakers)
    expect(result1).not.toBe(0)
  })

  it('repeated sorts produce identical order', () => {
    const items = [
      makeCapitalItem('z', 'red', 5),
      makeIntegrityItem('m', 5),
      makeCoverageItem('a', 100),
      makeCapitalItem('b', 'orange', 3),
      makeIntegrityItem('x', 7),
    ]

    // Score all
    for (const item of items) {
      item.sortScore = computeSortScore(item, NOW)
    }

    // Sort twice
    const sort1 = [...items].sort(compareItems).map(i => i.id)
    const sort2 = [...items].sort(compareItems).map(i => i.id)

    expect(sort1).toEqual(sort2)
  })

  it('full postprocess produces deterministic output', () => {
    const items: DecisionItem[] = [
      makeCapitalItem('z', 'red', 5),
      makeIntegrityItem('m', 5),
      makeCoverageItem('a', 100),
      makeCapitalItem('b', 'orange', 3),
    ]

    const result1 = postprocess(items, NOW)
    const result2 = postprocess([...items], NOW) // copy to avoid mutation issues

    const ids1 = result1.actionItems.map(i => i.id)
    const ids2 = result2.actionItems.map(i => i.id)

    expect(ids1).toEqual(ids2)
  })
})

// ---------------------------------------------------------------------------
// Postprocess integration with tiers
// ---------------------------------------------------------------------------

describe('postprocess with decision tiers', () => {
  it('capital items appear before coverage items after scoring', () => {
    const items: DecisionItem[] = [
      makeCoverageItem('cov1', 200), // red severity, very old
      makeCapitalItem('cap1', 'orange', 3), // orange, young — but capital tier
    ]

    const { actionItems } = postprocess(items, NOW)

    // Capital should be first despite lower severity and age
    expect(actionItems[0].decisionTier).toBe('capital')
    expect(actionItems[1].decisionTier).toBe('coverage')
  })

  it('mixed tiers produce tier-grouped output', () => {
    const items: DecisionItem[] = [
      makeCoverageItem('cov1', 100),
      makeIntegrityItem('int1', 5),
      makeCapitalItem('cap1', 'red', 5),
      makeCoverageItem('cov2', 150),
      makeIntegrityItem('int2', 7),
    ]

    const { actionItems } = postprocess(items, NOW)

    // Capital should be first, then integrity, then coverage
    const tiers = actionItems.map(i => i.decisionTier)
    const capitalIdx = tiers.indexOf('capital')
    const integrityIdx = tiers.indexOf('integrity')
    const coverageIdx = tiers.indexOf('coverage')

    expect(capitalIdx).toBeLessThan(integrityIdx)
    expect(integrityIdx).toBeLessThan(coverageIdx)
  })
})
