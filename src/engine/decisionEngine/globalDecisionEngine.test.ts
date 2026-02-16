/**
 * Global Decision Engine — Unit Tests
 *
 * Tests for:
 *   - Evaluator trigger conditions
 *   - Conflict prevention / dedup
 *   - Sort ordering
 *   - Surface splitting (action vs intel)
 *   - Edge cases (empty data, no coverage)
 */

import { describe, it, expect } from 'vitest'
import { runGlobalDecisionEngine, type EngineArgs } from './globalDecisionEngine'
import { postprocess } from './postprocess'
import type { DecisionItem } from './types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = new Date('2026-02-15T12:00:00Z')

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86400000).toISOString()
}

function baseArgs(overrides: Partial<EngineArgs['data']> = {}): EngineArgs {
  return {
    userId: 'u1',
    role: 'analyst',
    coverage: { assetIds: ['a1', 'a2'], portfolioIds: ['p1'] },
    data: {
      tradeIdeas: [],
      proposals: [],
      ratingChanges: [],
      thesisUpdates: [],
      projects: [],
      ...overrides,
    },
    now: NOW,
  }
}

function makeIdea(id: string, overrides: Record<string, any> = {}): any {
  return {
    id,
    asset_id: 'a1',
    portfolio_id: 'p1',
    stage: 'active',
    action: 'buy',
    decision_outcome: null,
    outcome: null,
    visibility_tier: 'active',
    created_at: daysAgo(5),
    updated_at: daysAgo(5),
    asset_symbol: 'AAPL',
    portfolio_name: 'Growth',
    ...overrides,
  }
}

function makeProject(id: string, deliverables: any[] = []): any {
  return { id, name: 'Alpha Research', status: 'in_progress', priority: 'high', deliverables }
}

function makeDeliverable(id: string, overrides: Record<string, any> = {}): any {
  return {
    id,
    title: 'Weekly Report',
    due_date: daysAgo(5),
    completed: false,
    status: 'pending',
    created_at: daysAgo(10),
    ...overrides,
  }
}

function makeRatingChange(id: string, overrides: Record<string, any> = {}): any {
  return {
    id,
    rating_id: `r-${id}`,
    asset_id: 'a1',
    asset_symbol: 'AAPL',
    field_name: 'rating_value',
    old_value: 'Hold',
    new_value: 'Buy',
    changed_at: daysAgo(2),
    changed_by: 'u2',
    ...overrides,
  }
}

function makeThesisUpdate(assetId: string, overrides: Record<string, any> = {}): any {
  return {
    asset_id: assetId,
    section: 'thesis',
    updated_at: daysAgo(100),
    created_by: 'u1',
    asset_symbol: 'AAPL',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// A1: Proposal Awaiting Decision
// ---------------------------------------------------------------------------

describe('A1: Proposal Awaiting Decision', () => {
  it('fires RED (stale) for proposal 10+ days old', () => {
    const result = runGlobalDecisionEngine(baseArgs({
      tradeIdeas: [makeIdea('t1', { stage: 'deciding', updated_at: daysAgo(12) })],
    }))
    const a1 = result.actionItems.find(i => i.id === 'a1-proposal-t1')
    expect(a1).toBeDefined()
    expect(a1!.severity).toBe('red')
    expect(a1!.surface).toBe('action')
    expect(a1!.category).toBe('process')
  })

  it('fires ORANGE (aging) for proposal 5-9 days old', () => {
    const result = runGlobalDecisionEngine(baseArgs({
      tradeIdeas: [makeIdea('t1', { stage: 'deciding', updated_at: daysAgo(7) })],
    }))
    const a1 = result.actionItems.find(i => i.id === 'a1-proposal-t1')
    expect(a1).toBeDefined()
    expect(a1!.severity).toBe('orange')
  })

  it('fires BLUE (waiting) for proposal < 5 days old', () => {
    const result = runGlobalDecisionEngine(baseArgs({
      tradeIdeas: [makeIdea('t1', { stage: 'deciding', updated_at: daysAgo(2) })],
    }))
    const a1 = result.actionItems.find(i => i.id === 'a1-proposal-t1')
    expect(a1).toBeDefined()
    expect(a1!.severity).toBe('blue')
  })

  it('fires even for brand new proposals (no age gate)', () => {
    const result = runGlobalDecisionEngine(baseArgs({
      tradeIdeas: [makeIdea('t1', { stage: 'deciding', updated_at: daysAgo(0) })],
    }))
    const a1 = result.actionItems.find(i => i.id === 'a1-proposal-t1')
    expect(a1).toBeDefined()
    expect(a1!.severity).toBe('blue')
  })

  it('does NOT fire if decision_outcome is set', () => {
    const result = runGlobalDecisionEngine(baseArgs({
      tradeIdeas: [makeIdea('t1', { stage: 'deciding', decision_outcome: 'accepted', updated_at: daysAgo(5) })],
    }))
    expect(result.actionItems.find(i => i.id === 'a1-proposal-t1')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// A2: Execution Not Confirmed
// ---------------------------------------------------------------------------

describe('A2: Execution Not Confirmed', () => {
  it('fires RED for accepted trade with no outcome after 2+ days', () => {
    const result = runGlobalDecisionEngine(baseArgs({
      tradeIdeas: [makeIdea('t1', {
        decision_outcome: 'accepted',
        decided_at: daysAgo(3),
        outcome: null,
      })],
    }))
    const a2 = result.actionItems.find(i => i.id === 'a2-execution-t1')
    expect(a2).toBeDefined()
    expect(a2!.severity).toBe('red')
    expect(a2!.ctas[0].actionKey).toBe('OPEN_TRADE_QUEUE_EXECUTION')
  })

  it('does NOT fire if outcome already logged', () => {
    const result = runGlobalDecisionEngine(baseArgs({
      tradeIdeas: [makeIdea('t1', {
        decision_outcome: 'accepted',
        decided_at: daysAgo(3),
        outcome: 'executed',
      })],
    }))
    expect(result.actionItems.find(i => i.id === 'a2-execution-t1')).toBeUndefined()
  })

  it('does NOT fire if < 2 days since decision', () => {
    const result = runGlobalDecisionEngine(baseArgs({
      tradeIdeas: [makeIdea('t1', {
        decision_outcome: 'accepted',
        decided_at: daysAgo(1),
        outcome: null,
      })],
    }))
    expect(result.actionItems.find(i => i.id === 'a2-execution-t1')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// A3: Idea Not Simulated
// ---------------------------------------------------------------------------

describe('A3: Ideas Being Worked On', () => {
  it('fires ORANGE for idea in "idea" stage', () => {
    const result = runGlobalDecisionEngine(baseArgs({
      tradeIdeas: [makeIdea('t1', { stage: 'idea', created_at: daysAgo(5) })],
      proposals: [],
    }))
    const a3 = result.actionItems.find(i => i.id === 'a3-unsimulated-t1')
    expect(a3).toBeDefined()
    expect(a3!.severity).toBe('orange')
    expect(a3!.ctas[0].actionKey).toBe('OPEN_TRADE_LAB_SIMULATION')
    expect(a3!.context.stage).toBe('idea')
  })

  it('fires ORANGE for idea in "simulating" stage', () => {
    const result = runGlobalDecisionEngine(baseArgs({
      tradeIdeas: [makeIdea('t1', { stage: 'simulating', created_at: daysAgo(2) })],
    }))
    const a3 = result.actionItems.find(i => i.id === 'a3-unsimulated-t1')
    expect(a3).toBeDefined()
    expect(a3!.severity).toBe('orange')
    expect(a3!.context.stage).toBe('simulating')
  })

  it('fires even for recently created ideas (no age threshold)', () => {
    const result = runGlobalDecisionEngine(baseArgs({
      tradeIdeas: [makeIdea('t1', { stage: 'idea', created_at: daysAgo(0) })],
    }))
    const a3 = result.actionItems.find(i => i.id === 'a3-unsimulated-t1')
    expect(a3).toBeDefined()
  })

  it('does NOT fire if idea is in deciding stage', () => {
    const result = runGlobalDecisionEngine(baseArgs({
      tradeIdeas: [makeIdea('t1', { stage: 'deciding', created_at: daysAgo(5) })],
    }))
    // This should fire A1 instead, not A3
    expect(result.actionItems.find(i => i.id === 'a3-unsimulated-t1')).toBeUndefined()
  })

  it('does NOT fire if idea has an outcome', () => {
    const result = runGlobalDecisionEngine(baseArgs({
      tradeIdeas: [makeIdea('t1', { stage: 'idea', outcome: 'executed' })],
    }))
    expect(result.actionItems.find(i => i.id === 'a3-unsimulated-t1')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// A4: Overdue Deliverable
// ---------------------------------------------------------------------------

describe('A4: Overdue Deliverable', () => {
  it('fires ORANGE for recently overdue deliverable', () => {
    const result = runGlobalDecisionEngine(baseArgs({
      projects: [makeProject('proj1', [makeDeliverable('d1', { due_date: daysAgo(2) })])],
    }))
    const a4 = result.actionItems.find(i => i.id === 'a4-deliverable-d1')
    expect(a4).toBeDefined()
    expect(a4!.severity).toBe('orange')
  })

  it('fires RED for deliverable 3+ days overdue', () => {
    const result = runGlobalDecisionEngine(baseArgs({
      projects: [makeProject('proj1', [makeDeliverable('d1', { due_date: daysAgo(5) })])],
    }))
    const a4 = result.actionItems.find(i => i.id === 'a4-deliverable-d1')
    expect(a4).toBeDefined()
    expect(a4!.severity).toBe('red')
  })

  it('does NOT fire for completed deliverable', () => {
    const result = runGlobalDecisionEngine(baseArgs({
      projects: [makeProject('proj1', [makeDeliverable('d1', { completed: true })])],
    }))
    expect(result.actionItems.find(i => i.id === 'a4-deliverable-d1')).toBeUndefined()
  })

  it('limits to 4 deliverables', () => {
    const deliverables = Array.from({ length: 6 }, (_, i) =>
      makeDeliverable(`d${i}`, { due_date: daysAgo(i + 1) }),
    )
    const result = runGlobalDecisionEngine(baseArgs({
      projects: [makeProject('proj1', deliverables)],
    }))
    const a4Items = result.actionItems.filter(i => i.id.startsWith('a4-'))
    expect(a4Items.length).toBeLessThanOrEqual(4)
  })
})

// ---------------------------------------------------------------------------
// I1: Rating Changed, No Follow-up
// ---------------------------------------------------------------------------

describe('Rating Changed, No Follow-up', () => {
  it('fires BLUE action for minor rating change with no idea', () => {
    const result = runGlobalDecisionEngine(baseArgs({
      ratingChanges: [makeRatingChange('rc1', { old_value: 'Hold', new_value: 'Buy' })],
      tradeIdeas: [],
    }))
    const i1 = result.actionItems.find(i => i.id.startsWith('i1-rating-'))
    expect(i1).toBeDefined()
    expect(i1!.severity).toBe('blue')
    expect(i1!.surface).toBe('action')
    expect(i1!.category).toBe('risk')
    expect(i1!.dismissible).toBe(false)
  })

  it('fires ORANGE action for significant swing (BUY→SELL)', () => {
    const result = runGlobalDecisionEngine(baseArgs({
      ratingChanges: [makeRatingChange('rc1', { old_value: 'BUY', new_value: 'SELL' })],
      tradeIdeas: [],
    }))
    const i1 = result.actionItems.find(i => i.id.startsWith('i1-rating-'))
    expect(i1).toBeDefined()
    expect(i1!.severity).toBe('orange')
  })

  it('does NOT fire if idea was created after rating change', () => {
    const result = runGlobalDecisionEngine(baseArgs({
      ratingChanges: [makeRatingChange('rc1', { changed_at: daysAgo(3) })],
      tradeIdeas: [makeIdea('t1', { asset_id: 'a1', created_at: daysAgo(1) })],
    }))
    const i1 = result.actionItems.find(i => i.id.startsWith('i1-rating-'))
    expect(i1).toBeUndefined()
  })

  it('does NOT fire for changes older than 14 days', () => {
    const result = runGlobalDecisionEngine(baseArgs({
      ratingChanges: [makeRatingChange('rc1', { changed_at: daysAgo(16) })],
    }))
    expect(result.actionItems.find(i => i.id.startsWith('i1-rating-'))).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Thesis Stale
// ---------------------------------------------------------------------------

describe('Thesis Stale', () => {
  it('fires YELLOW action for thesis 90+ days old', () => {
    const result = runGlobalDecisionEngine(baseArgs({
      thesisUpdates: [makeThesisUpdate('a1', { updated_at: daysAgo(100) })],
    }))
    const thesis = result.actionItems.find(i => i.id.startsWith('thesis-stale-'))
    expect(thesis).toBeDefined()
    expect(thesis!.severity).toBe('yellow')
    expect(thesis!.surface).toBe('action')
    expect(thesis!.category).toBe('risk')
    expect(thesis!.dismissible).toBe(false)
  })

  it('fires ORANGE action for thesis 135+ days old', () => {
    const result = runGlobalDecisionEngine(baseArgs({
      thesisUpdates: [makeThesisUpdate('a1', { updated_at: daysAgo(150) })],
    }))
    const thesis = result.actionItems.find(i => i.id.startsWith('thesis-stale-'))
    expect(thesis).toBeDefined()
    expect(thesis!.severity).toBe('orange')
    expect(thesis!.surface).toBe('action')
    expect(thesis!.dismissible).toBe(false)
  })

  it('fires RED action for thesis 180+ days old', () => {
    const result = runGlobalDecisionEngine(baseArgs({
      thesisUpdates: [makeThesisUpdate('a1', { updated_at: daysAgo(200) })],
    }))
    const thesis = result.actionItems.find(i => i.id.startsWith('thesis-stale-'))
    expect(thesis).toBeDefined()
    expect(thesis!.severity).toBe('red')
    expect(thesis!.surface).toBe('action')
    expect(thesis!.dismissible).toBe(false)
  })

  it('does NOT fire for thesis < 90 days old', () => {
    const result = runGlobalDecisionEngine(baseArgs({
      thesisUpdates: [makeThesisUpdate('a1', { updated_at: daysAgo(50) })],
    }))
    const thesis = result.actionItems.find(i => i.id.startsWith('thesis-stale-'))
    expect(thesis).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Conflict Prevention (postprocess)
// ---------------------------------------------------------------------------

describe('Conflict Prevention', () => {
  it('suppresses "no active idea" (I3) when idea/proposal exists for same asset', () => {
    const items: DecisionItem[] = [
      {
        id: 'a3-unsimulated-t1',
        surface: 'action', severity: 'orange', category: 'process',
        title: 'Idea Not Simulated', description: 'test',
        context: { assetId: 'a1' }, ctas: [], sortScore: 0,
      },
      {
        id: 'i3-ev-a1',
        surface: 'intel', severity: 'blue', category: 'alpha',
        title: 'High EV', description: 'test',
        context: { assetId: 'a1' }, ctas: [], dismissible: true, sortScore: 0,
      },
    ]
    const result = postprocess(items, NOW)
    expect(result.intelItems.find(i => i.id === 'i3-ev-a1')).toBeUndefined()
  })

  it('suppresses A1 when A2 exists for same trade idea', () => {
    // Note: A1 and A2 share the same category + context fields, causing dedup
    // to keep whichever has higher severity (equal here, so first wins).
    // In practice, A1 (stage=deciding, no outcome) and A2 (decision_outcome=accepted)
    // are mutually exclusive stages, so both can't fire for the same trade idea.
    // Test the conflict removal with different proposalIds to bypass dedup.
    const items: DecisionItem[] = [
      {
        id: 'a1-proposal-t1',
        surface: 'action', severity: 'red', category: 'process',
        title: 'Proposal Awaiting', description: 'test',
        context: { assetId: 'a1', tradeIdeaId: 't1', proposalId: 'prop1' }, ctas: [], sortScore: 0,
      },
      {
        id: 'a2-execution-t1',
        surface: 'action', severity: 'red', category: 'process',
        title: 'Execution Pending', description: 'test',
        context: { assetId: 'a1', tradeIdeaId: 't1', proposalId: 'prop2' }, ctas: [], sortScore: 0,
      },
    ]
    const result = postprocess(items, NOW)
    expect(result.actionItems.find(i => i.id === 'a1-proposal-t1')).toBeUndefined()
    expect(result.actionItems.find(i => i.id === 'a2-execution-t1')).toBeDefined()
  })

  it('does NOT suppress A1 when A2 is for a different trade idea', () => {
    const items: DecisionItem[] = [
      {
        id: 'a1-proposal-t1',
        surface: 'action', severity: 'red', category: 'process',
        title: 'Proposal Awaiting', description: 'test',
        context: { assetId: 'a1', tradeIdeaId: 't1' }, ctas: [], sortScore: 0,
      },
      {
        id: 'a2-execution-t2',
        surface: 'action', severity: 'red', category: 'process',
        title: 'Execution Pending', description: 'test',
        context: { assetId: 'a1', tradeIdeaId: 't2' }, ctas: [], sortScore: 0,
      },
    ]
    const result = postprocess(items, NOW)
    expect(result.actionItems.find(i => i.id === 'a1-proposal-t1')).toBeDefined()
    expect(result.actionItems.find(i => i.id === 'a2-execution-t2')).toBeDefined()
  })

  it('does NOT suppress rating-no-followup when A1 exists (independent signals)', () => {
    const items: DecisionItem[] = [
      {
        id: 'a1-proposal-t1',
        surface: 'action', severity: 'red', category: 'process',
        title: 'Proposal Awaiting', description: 'test',
        context: { assetId: 'a1', tradeIdeaId: 't1' }, ctas: [], sortScore: 0,
      },
      {
        id: 'i1-rating-rc1-2',
        surface: 'action', severity: 'blue', category: 'risk',
        title: 'Rating Changed', description: 'test',
        context: { assetId: 'a1' }, ctas: [], dismissible: false, sortScore: 0,
      },
    ]
    const result = postprocess(items, NOW)
    // Both should be present — they are independent signals
    expect(result.actionItems.find(i => i.id === 'a1-proposal-t1')).toBeDefined()
    expect(result.actionItems.find(i => i.id === 'i1-rating-rc1-2')).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

describe('Deduplication', () => {
  it('keeps higher severity when duplicates exist', () => {
    const items: DecisionItem[] = [
      {
        id: 'thesis-stale-a1-u1',
        surface: 'action', severity: 'orange', category: 'risk',
        title: 'Thesis Stale', description: 'test',
        context: { assetId: 'a1' }, ctas: [], sortScore: 0,
      },
      {
        id: 'thesis-stale-a1-u2',
        surface: 'action', severity: 'red', category: 'risk',
        title: 'Thesis Stale', description: 'test',
        context: { assetId: 'a1' }, ctas: [], sortScore: 0,
      },
    ]
    const result = postprocess(items, NOW)
    const allItems = [...result.actionItems, ...result.intelItems]
    expect(allItems.filter(i => i.id.startsWith('thesis-stale-a1'))).toHaveLength(1)
    expect(allItems[0].severity).toBe('red')
  })
})

// ---------------------------------------------------------------------------
// Sort Ordering
// ---------------------------------------------------------------------------

describe('Sort Ordering', () => {
  it('sorts RED items before ORANGE before BLUE', () => {
    const items: DecisionItem[] = [
      {
        id: 'blue-item',
        surface: 'intel', severity: 'blue', category: 'alpha',
        title: 'Blue', description: '', context: { assetId: 'a3' }, ctas: [], sortScore: 0,
      },
      {
        id: 'red-item',
        surface: 'action', severity: 'red', category: 'process',
        title: 'Red', description: '', context: { assetId: 'a1' }, ctas: [], sortScore: 0,
      },
      {
        id: 'orange-item',
        surface: 'action', severity: 'orange', category: 'process',
        title: 'Orange', description: '', context: { assetId: 'a2' }, ctas: [], sortScore: 0,
      },
    ]
    const result = postprocess(items, NOW)
    // Action items: red (12000) > orange (9000), Intel items: blue (3000)
    expect(result.actionItems[0].id).toBe('red-item')
    expect(result.actionItems[1].id).toBe('orange-item')
    expect(result.intelItems[0].id).toBe('blue-item')
    // Combined ordering: action first, then intel
    expect(result.actionItems[0].sortScore).toBeGreaterThan(result.actionItems[1].sortScore)
    expect(result.actionItems[1].sortScore).toBeGreaterThan(result.intelItems[0].sortScore)
  })

  it('adds age factor: older items score higher', () => {
    const items: DecisionItem[] = [
      {
        id: 'newer',
        surface: 'action', severity: 'orange', category: 'process',
        title: 'Newer', description: '', context: { assetId: 'a1' }, ctas: [],
        sortScore: 0, createdAt: daysAgo(1),
      },
      {
        id: 'older',
        surface: 'action', severity: 'orange', category: 'process',
        title: 'Older', description: '', context: { assetId: 'a2' }, ctas: [],
        sortScore: 0, createdAt: daysAgo(10),
      },
    ]
    const result = postprocess(items, NOW)
    expect(result.actionItems[0].id).toBe('older')
    expect(result.actionItems[0].sortScore).toBeGreaterThan(result.actionItems[1].sortScore)
  })

  it('action items get category weight bonus', () => {
    const actionItem: DecisionItem = {
      id: 'action-process',
      surface: 'action', severity: 'orange', category: 'process',
      title: 'Action', description: '', context: {}, ctas: [], sortScore: 0,
    }
    const intelItem: DecisionItem = {
      id: 'intel-risk',
      surface: 'intel', severity: 'orange', category: 'risk',
      title: 'Intel', description: '', context: {}, ctas: [], sortScore: 0,
    }
    const result = postprocess([actionItem, intelItem], NOW)
    const a = [...result.actionItems, ...result.intelItems].find(i => i.id === 'action-process')!
    const b = [...result.actionItems, ...result.intelItems].find(i => i.id === 'intel-risk')!
    // Action gets +2000 (process), intel gets +0 (no category weight)
    expect(a.sortScore).toBeGreaterThan(b.sortScore)
  })
})

// ---------------------------------------------------------------------------
// Surface Splitting
// ---------------------------------------------------------------------------

describe('Surface Splitting', () => {
  it('splits items into actionItems and intelItems correctly', () => {
    const result = runGlobalDecisionEngine(baseArgs({
      tradeIdeas: [makeIdea('t1', { stage: 'deciding', updated_at: daysAgo(4) })],
      ratingChanges: [makeRatingChange('rc1', { asset_id: 'a2' })],
      assets: [{ id: 'a2', symbol: 'MSFT', expectedReturn: 0.35 }],
    }))
    // A1 (proposal awaiting) + rating-no-followup are action items
    expect(result.actionItems.length).toBeGreaterThan(0)
    expect(result.actionItems.every(i => i.surface === 'action')).toBe(true)
    // I3 (high EV) is intel — note: I1 suppressed for a2 because A1 proposal exists for a1 only,
    // but a2 rating change is not suppressed. I3 for a2 has no active idea (t1 is for a1).
    expect(result.intelItems.every(i => i.surface === 'intel')).toBe(true)
  })

  it('includes meta with counts and timestamp', () => {
    const result = runGlobalDecisionEngine(baseArgs())
    expect(result.meta).toBeDefined()
    expect(result.meta.generatedAt).toBe(NOW.toISOString())
    expect(result.meta.counts.action).toBe(result.actionItems.length)
    expect(result.meta.counts.intel).toBe(result.intelItems.length)
  })
})

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe('Edge Cases', () => {
  it('returns empty results for no data', () => {
    const result = runGlobalDecisionEngine(baseArgs())
    expect(result.actionItems).toEqual([])
    expect(result.intelItems).toEqual([])
    expect(result.meta.counts.action).toBe(0)
    expect(result.meta.counts.intel).toBe(0)
  })

  it('handles undefined data arrays gracefully', () => {
    const result = runGlobalDecisionEngine({
      userId: 'u1',
      role: 'analyst',
      coverage: { assetIds: [], portfolioIds: [] },
      data: {},
      now: NOW,
    })
    expect(result.actionItems).toEqual([])
    expect(result.intelItems).toEqual([])
  })

  it('handles mix of all evaluators concurrently', () => {
    const result = runGlobalDecisionEngine(baseArgs({
      tradeIdeas: [
        makeIdea('t1', { stage: 'deciding', updated_at: daysAgo(5) }),
        makeIdea('t2', { decision_outcome: 'accepted', decided_at: daysAgo(4), outcome: null }),
        makeIdea('t3', { stage: 'idea', created_at: daysAgo(6) }),
      ],
      proposals: [],
      ratingChanges: [makeRatingChange('rc1', { asset_id: 'a2' })],
      thesisUpdates: [makeThesisUpdate('a2', { updated_at: daysAgo(100) })],
      projects: [makeProject('proj1', [makeDeliverable('d1', { due_date: daysAgo(4) })])],
    }))

    // Should have action items from A1, A2, A3, A4, thesis stale, rating-no-followup
    expect(result.actionItems.length).toBeGreaterThanOrEqual(4)
    // Rating change is now an action item (risk category)
    expect(result.actionItems.some(i => i.id.startsWith('i1-rating-'))).toBe(true)
    // All should have computed sort scores
    const all = [...result.actionItems, ...result.intelItems]
    expect(all.every(i => i.sortScore > 0)).toBe(true)
  })
})
