/**
 * Postprocess rollup + dashboard selector tests.
 *
 * Verifies:
 *   - 6 proposal-awaiting items → 1 rollup parent with 6 children
 *   - Rollup parent has correct oldestAge + portfolio breakdown chips
 *   - No loss: all child IDs preserved
 *   - Thesis stale rollup fires at threshold >= 3
 *   - Dashboard selector returns max 8 rows with category diversity
 */

import { describe, it, expect } from 'vitest'
import { postprocess, rollupItems } from '../postprocess'
import { selectTopForDashboard } from '../selectors'
import type { DecisionItem } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = new Date('2026-02-15T12:00:00Z')

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86400000).toISOString()
}

function makeProposalItem(id: string, portfolioName: string, ageDays: number): DecisionItem {
  return {
    id: `a1-proposal-${id}`,
    surface: 'action',
    severity: 'red',
    category: 'process',
    title: 'Proposal Awaiting Decision',
    titleKey: 'PROPOSAL_AWAITING_DECISION',
    description: 'Proposal pending longer than expected.',
    chips: [
      { label: 'Portfolio', value: portfolioName },
      { label: 'Ticker', value: `T${id}` },
      { label: 'Age', value: `${ageDays}d` },
    ],
    context: {
      assetId: `asset-${id}`,
      assetTicker: `T${id}`,
      portfolioId: `port-${id}`,
      portfolioName,
      tradeIdeaId: `idea-${id}`,
    },
    ctas: [
      { label: 'Review', actionKey: 'OPEN_TRADE_QUEUE_PROPOSAL', kind: 'primary', payload: { tradeIdeaId: `idea-${id}` } },
    ],
    dismissible: false,
    sortScore: 12500, // pre-computed for test
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
    sortScore: 8200 + ageDays * 50,
    createdAt: daysAgo(ageDays),
  }
}

function makeDeliverableItem(id: string, overdueDays: number): DecisionItem {
  return {
    id: `a4-deliverable-${id}`,
    surface: 'action',
    severity: overdueDays >= 3 ? 'red' : 'orange',
    category: 'project',
    title: `Task ${id}`,
    titleKey: 'OVERDUE_DELIVERABLE',
    description: `Due ${overdueDays}d ago.`,
    chips: [
      { label: 'Project', value: 'TestProject' },
      { label: 'Overdue', value: `${overdueDays}d` },
    ],
    context: { projectId: `proj-${id}` },
    ctas: [
      { label: 'Open', actionKey: 'OPEN_PROJECT', kind: 'primary', payload: { projectId: `proj-${id}` } },
    ],
    dismissible: false,
    sortScore: 11500 + overdueDays * 50,
    createdAt: daysAgo(overdueDays + 5),
  }
}

function makeRatingItem(id: string, daysSince: number): DecisionItem {
  return {
    id: `i1-rating-${id}-${daysSince}`,
    surface: 'action',
    severity: 'orange',
    category: 'risk',
    title: 'Rating Changed, No Follow-up',
    titleKey: 'RATING_NO_FOLLOWUP',
    description: 'Rating changed without a corresponding trade idea.',
    chips: [
      { label: 'Ticker', value: `R${id}` },
      { label: 'Changed', value: `${daysSince}d ago` },
    ],
    context: { assetId: `asset-r${id}`, assetTicker: `R${id}` },
    ctas: [
      { label: 'Create Idea', actionKey: 'OPEN_ASSET_CREATE_IDEA', kind: 'primary', payload: { assetId: `asset-r${id}` } },
    ],
    dismissible: false,
    sortScore: 9200 + daysSince * 50,
    createdAt: daysAgo(daysSince),
  }
}

// ---------------------------------------------------------------------------
// Rollup Tests
// ---------------------------------------------------------------------------

describe('rollupItems', () => {
  it('groups 6 proposal-awaiting items into 1 rollup with 6 children', () => {
    const items = [
      makeProposalItem('1', 'Growth', 5),
      makeProposalItem('2', 'Growth', 7),
      makeProposalItem('3', 'Growth', 3),
      makeProposalItem('4', 'Value', 10),
      makeProposalItem('5', 'Value', 4),
      makeProposalItem('6', 'Core', 6),
    ]

    const result = rollupItems(items, NOW)

    // Should have exactly 1 rollup row
    const rollups = result.filter(r => r.children && r.children.length > 0)
    expect(rollups).toHaveLength(1)

    const rollup = rollups[0]
    expect(rollup.id).toBe('rollup-proposal-awaiting-decision')
    expect(rollup.title).toBe('6 proposals awaiting decision')
    expect(rollup.children).toHaveLength(6)
    expect(rollup.severity).toBe('red')
    expect(rollup.category).toBe('process')
    expect(rollup.titleKey).toBe('PROPOSAL_AWAITING_DECISION')
  })

  it('rollup parent has correct oldestAge in description', () => {
    const items = [
      makeProposalItem('1', 'Growth', 3),
      makeProposalItem('2', 'Value', 10),
      makeProposalItem('3', 'Core', 5),
    ]

    const result = rollupItems(items, NOW)
    const rollup = result.find(r => r.children?.length)!
    expect(rollup.description).toBe('Oldest waiting 10 days.')
  })

  it('rollup chips contain portfolio breakdown', () => {
    const items = [
      makeProposalItem('1', 'Growth', 5),
      makeProposalItem('2', 'Growth', 7),
      makeProposalItem('3', 'Growth', 3),
      makeProposalItem('4', 'Value', 10),
      makeProposalItem('5', 'Core', 6),
    ]

    const result = rollupItems(items, NOW)
    const rollup = result.find(r => r.children?.length)!

    // Chips should be portfolio breakdown sorted by count desc
    expect(rollup.chips).toEqual([
      { label: 'Growth', value: '3' },
      { label: 'Value', value: '1' },
      { label: 'Core', value: '1' },
    ])
  })

  it('preserves all child IDs — no data loss', () => {
    const items = [
      makeProposalItem('1', 'Growth', 5),
      makeProposalItem('2', 'Value', 7),
      makeProposalItem('3', 'Core', 3),
    ]
    const originalIds = items.map(i => i.id)

    const result = rollupItems(items, NOW)
    const rollup = result.find(r => r.children?.length)!
    const childIds = rollup.children!.map(c => c.id)

    // All original IDs preserved as children
    expect(childIds).toEqual(expect.arrayContaining(originalIds))
    expect(childIds).toHaveLength(originalIds.length)
  })

  it('rollup CTA is "Review all" with OPEN_TRADE_QUEUE_FILTERED', () => {
    const items = [
      makeProposalItem('1', 'Growth', 5),
      makeProposalItem('2', 'Value', 7),
    ]

    const result = rollupItems(items, NOW)
    const rollup = result.find(r => r.children?.length)!
    const cta = rollup.ctas[0]

    expect(cta.label).toBe('Review all')
    expect(cta.actionKey).toBe('OPEN_TRADE_QUEUE_FILTERED')
    expect(cta.payload).toEqual({ filter: 'awaiting_decision' })
  })

  it('does NOT roll up proposals when count < minCount (1 item)', () => {
    const items = [makeProposalItem('1', 'Growth', 5)]

    const result = rollupItems(items, NOW)
    expect(result).toHaveLength(1)
    expect(result[0].children).toBeUndefined()
    expect(result[0].id).toBe('a1-proposal-1')
  })

  it('thesis stale rollup triggers at >= 3 items', () => {
    const items = [
      makeThesisStaleItem('a', 95),
      makeThesisStaleItem('b', 120),
      makeThesisStaleItem('c', 100),
      makeThesisStaleItem('d', 200),
    ]

    const result = rollupItems(items, NOW)
    const rollups = result.filter(r => r.children?.length)
    expect(rollups).toHaveLength(1)
    expect(rollups[0].title).toBe('4 theses may be stale')
    expect(rollups[0].description).toBe('Oldest 200 days since update.')
    expect(rollups[0].severity).toBe('red') // d is ≥180
  })

  it('thesis stale DOES roll up at exactly 3 items (minCount = 3)', () => {
    const items = [
      makeThesisStaleItem('a', 95),
      makeThesisStaleItem('b', 120),
      makeThesisStaleItem('c', 100),
    ]

    const result = rollupItems(items, NOW)
    const rollups = result.filter(r => r.children?.length)
    expect(rollups).toHaveLength(1)
    expect(rollups[0].title).toBe('3 theses may be stale')
    expect(rollups[0].children).toHaveLength(3)
  })

  it('thesis stale does NOT roll up at 2 items', () => {
    const items = [
      makeThesisStaleItem('a', 95),
      makeThesisStaleItem('b', 120),
    ]

    const result = rollupItems(items, NOW)
    const rollups = result.filter(r => r.children?.length)
    expect(rollups).toHaveLength(0)
    expect(result).toHaveLength(2)
  })

  it('unconsumed items preserved alongside rollups', () => {
    const items = [
      makeProposalItem('1', 'Growth', 5),
      makeProposalItem('2', 'Value', 7),
      makeDeliverableItem('d1', 4),
      makeRatingItem('r1', 5),
    ]

    const result = rollupItems(items, NOW)
    // 1 rollup (2 proposals) + 1 deliverable + 1 rating = 3
    expect(result).toHaveLength(3)
    expect(result.some(r => r.children?.length === 2)).toBe(true)
    expect(result.some(r => r.id === 'a4-deliverable-d1')).toBe(true)
    expect(result.some(r => r.id.startsWith('i1-rating-'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Postprocess integration (rollup inside full pipeline)
// ---------------------------------------------------------------------------

describe('postprocess with rollups', () => {
  it('full pipeline: 6 proposals → 1 rollup row in action items', () => {
    const items: DecisionItem[] = Array.from({ length: 6 }, (_, i) =>
      makeProposalItem(String(i + 1), i < 3 ? 'Growth' : 'Value', 5 + i),
    )

    const { actionItems } = postprocess(items, NOW)

    const rollups = actionItems.filter(i => i.children?.length)
    expect(rollups).toHaveLength(1)
    expect(rollups[0].children).toHaveLength(6)

    // Total action items should be 1 (just the rollup)
    expect(actionItems).toHaveLength(1)
  })

  it('intel items are NOT rolled up', () => {
    const intel: DecisionItem[] = Array.from({ length: 5 }, (_, i) => ({
      id: `i3-ev-asset${i}`,
      surface: 'intel' as const,
      severity: 'blue' as const,
      category: 'alpha' as const,
      title: 'High EV, No Idea',
      titleKey: 'HIGH_EV_NO_IDEA',
      description: 'Test',
      context: { assetId: `asset${i}` },
      ctas: [{ label: 'Create Idea', actionKey: 'OPEN_ASSET_CREATE_IDEA', kind: 'primary' as const }],
      dismissible: true,
      sortScore: 0,
    }))

    const { intelItems } = postprocess(intel, NOW)
    // All 5 should remain flat — no rollup for intel
    expect(intelItems).toHaveLength(5)
    expect(intelItems.every(i => !i.children?.length)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// selectTopForDashboard
// ---------------------------------------------------------------------------

describe('selectTopForDashboard', () => {
  it('returns max 8 items', () => {
    const items = Array.from({ length: 15 }, (_, i) =>
      makeProposalItem(String(i), 'Growth', 5 + i),
    )
    // These won't be rolled up since they have the same titleKey
    // but let's test with diverse items
    const diverse = [
      ...Array.from({ length: 5 }, (_, i) => makeProposalItem(String(i), 'G', 5 + i)),
      ...Array.from({ length: 3 }, (_, i) => makeDeliverableItem(`d${i}`, 4 + i)),
      ...Array.from({ length: 3 }, (_, i) => makeRatingItem(`r${i}`, 5 + i)),
      ...Array.from({ length: 2 }, (_, i) => makeThesisStaleItem(`t${i}`, 100 + i)),
    ]

    const result = selectTopForDashboard(diverse)
    expect(result.length).toBeLessThanOrEqual(8)
  })

  it('includes at least 2 categories when available', () => {
    const items = [
      // 5 process items
      ...Array.from({ length: 5 }, (_, i) => makeProposalItem(String(i), 'G', 5 + i)),
      // 2 project items
      makeDeliverableItem('d1', 4),
      makeDeliverableItem('d2', 5),
      // 2 risk items
      makeRatingItem('r1', 5),
      makeThesisStaleItem('t1', 100),
    ]

    const result = selectTopForDashboard(items)
    const categories = new Set(result.map(r => r.category))
    expect(categories.size).toBeGreaterThanOrEqual(2)
  })

  it('returns all items if fewer than 8', () => {
    const items = [
      makeProposalItem('1', 'Growth', 5),
      makeDeliverableItem('d1', 4),
    ]

    const result = selectTopForDashboard(items)
    expect(result).toHaveLength(2)
  })

  it('preserves sort order (desc by sortScore) when curation is needed', () => {
    // Need > 8 items for curation to kick in (otherwise returns as-is)
    const items = [
      ...Array.from({ length: 6 }, (_, i) => ({
        ...makeProposalItem(String(i), 'G', 5 + i),
        sortScore: 15000 - i * 100,
      })),
      makeDeliverableItem('d1', 10),
      makeRatingItem('r1', 3),
      makeThesisStaleItem('t1', 100),
    ]

    const result = selectTopForDashboard(items)
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].sortScore).toBeGreaterThanOrEqual(result[i].sortScore)
    }
  })

  it('ensures process category is represented', () => {
    // Put process items at the bottom by score
    const processItem: DecisionItem = {
      ...makeProposalItem('1', 'Growth', 3),
      sortScore: 100, // very low
    }

    const items = [
      ...Array.from({ length: 8 }, (_, i) => ({
        ...makeDeliverableItem(`d${i}`, 10 + i),
        sortScore: 15000 + i * 100,
      })),
      processItem,
    ]

    const result = selectTopForDashboard(items)
    expect(result.some(r => r.category === 'process')).toBe(true)
  })

  it('ensures risk category is represented', () => {
    const riskItem: DecisionItem = {
      ...makeRatingItem('r1', 3),
      sortScore: 100,
    }

    const items = [
      ...Array.from({ length: 8 }, (_, i) => ({
        ...makeProposalItem(String(i), 'G', 5 + i),
        sortScore: 15000 + i * 100,
      })),
      riskItem,
    ]

    const result = selectTopForDashboard(items)
    expect(result.some(r => r.category === 'risk')).toBe(true)
  })
})
