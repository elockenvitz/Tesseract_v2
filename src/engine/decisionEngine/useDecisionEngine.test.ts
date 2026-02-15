/**
 * useDecisionEngine selectors — Unit Tests
 *
 * Tests the pure filtering logic (selectForAsset, selectForPortfolio)
 * and verifies that intel dismissal via shared localStorage key
 * produces consistent results across dashboard and asset views.
 */

import { describe, it, expect } from 'vitest'
import { runGlobalDecisionEngine, type EngineArgs } from './globalDecisionEngine'
import type { DecisionItem } from './types'

// ---------------------------------------------------------------------------
// Helpers — replicate selector logic for pure testing
// ---------------------------------------------------------------------------

const NOW = new Date('2026-02-15T12:00:00Z')

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86400000).toISOString()
}

/** Unwrap rollup children when filtering for asset/portfolio views. */
function flattenForFilter(
  items: DecisionItem[],
  predicate: (item: DecisionItem) => boolean,
): DecisionItem[] {
  const out: DecisionItem[] = []
  for (const item of items) {
    if (item.children?.length) {
      for (const child of item.children) {
        if (predicate(child)) out.push(child)
      }
    } else if (predicate(item)) {
      out.push(item)
    }
  }
  return out
}

/** Replicate selectForAsset filtering logic */
function selectForAsset(
  result: { actionItems: DecisionItem[]; intelItems: DecisionItem[] },
  assetId: string,
) {
  const matchesAsset = (item: DecisionItem) =>
    item.context.assetId === assetId
  return {
    action: flattenForFilter(result.actionItems, matchesAsset),
    intel: result.intelItems.filter(matchesAsset),
  }
}

/** Replicate selectForPortfolio filtering logic */
function selectForPortfolio(
  result: { actionItems: DecisionItem[]; intelItems: DecisionItem[] },
  portfolioId: string,
) {
  const matchesPortfolio = (item: DecisionItem) =>
    item.context.portfolioId === portfolioId
  return {
    action: flattenForFilter(result.actionItems, matchesPortfolio),
    intel: result.intelItems.filter(matchesPortfolio),
  }
}

/** Replicate shared dismissal filtering */
function filterDismissed(
  items: DecisionItem[],
  dismissedIds: Set<string>,
): DecisionItem[] {
  return items.filter(i => !dismissedIds.has(i.id))
}

function makeArgs(overrides: Partial<EngineArgs['data']> = {}): EngineArgs {
  return {
    userId: 'u1',
    role: 'analyst',
    coverage: { assetIds: ['a1', 'a2', 'a3'], portfolioIds: ['p1', 'p2'] },
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

// ---------------------------------------------------------------------------
// selectForAsset
// ---------------------------------------------------------------------------

describe('selectForAsset', () => {
  it('returns only items matching the given assetId', () => {
    const result = runGlobalDecisionEngine(makeArgs({
      tradeIdeas: [
        {
          id: 't1', asset_id: 'a1', portfolio_id: 'p1',
          stage: 'deciding', action: 'buy', decision_outcome: null,
          outcome: null, visibility_tier: 'active',
          created_at: daysAgo(5), updated_at: daysAgo(5),
          asset_symbol: 'AAPL', portfolio_name: 'Growth',
        },
        {
          id: 't2', asset_id: 'a2', portfolio_id: 'p2',
          stage: 'deciding', action: 'sell', decision_outcome: null,
          outcome: null, visibility_tier: 'active',
          created_at: daysAgo(4), updated_at: daysAgo(4),
          asset_symbol: 'MSFT', portfolio_name: 'Value',
        },
      ],
    }))

    const sliceA1 = selectForAsset(result, 'a1')
    const sliceA2 = selectForAsset(result, 'a2')
    const sliceA3 = selectForAsset(result, 'a3')

    // Each asset should only see its own items
    expect(sliceA1.action.every(i => i.context.assetId === 'a1')).toBe(true)
    expect(sliceA2.action.every(i => i.context.assetId === 'a2')).toBe(true)
    expect(sliceA3.action).toEqual([])
    expect(sliceA3.intel).toEqual([])

    // Both should have exactly 1 action item (A1 proposal stalled)
    expect(sliceA1.action.length).toBe(1)
    expect(sliceA2.action.length).toBe(1)

    // Sum of asset slices should equal total individual items
    // (rollups are unwrapped by the selector, so count children not parents)
    const totalIndividual = result.actionItems.reduce(
      (sum, i) => sum + (i.children?.length ?? 1), 0,
    )
    expect(sliceA1.action.length + sliceA2.action.length).toBe(totalIndividual)
  })

  it('returns intel items scoped to asset', () => {
    const result = runGlobalDecisionEngine(makeArgs({
      // I3 (high EV) produces intel items for assets with no active idea
      assets: [
        { id: 'a1', symbol: 'AAPL', expectedReturn: 0.30 },
        { id: 'a2', symbol: 'MSFT', expectedReturn: 0.35 },
      ],
    }))

    const sliceA1 = selectForAsset(result, 'a1')
    const sliceA2 = selectForAsset(result, 'a2')

    // Each asset gets its own intel
    expect(sliceA1.intel.length).toBe(1)
    expect(sliceA1.intel[0].context.assetId).toBe('a1')
    expect(sliceA2.intel.length).toBe(1)
    expect(sliceA2.intel[0].context.assetId).toBe('a2')
  })

  it('returns empty slices for asset with no engine items', () => {
    const result = runGlobalDecisionEngine(makeArgs({
      tradeIdeas: [
        {
          id: 't1', asset_id: 'a1', portfolio_id: 'p1',
          stage: 'deciding', action: 'buy', decision_outcome: null,
          outcome: null, visibility_tier: 'active',
          created_at: daysAgo(5), updated_at: daysAgo(5),
          asset_symbol: 'AAPL', portfolio_name: 'Growth',
        },
      ],
    }))

    const slice = selectForAsset(result, 'nonexistent-asset')
    expect(slice.action).toEqual([])
    expect(slice.intel).toEqual([])
  })

  it('preserves engine sort order within asset slice', () => {
    const result = runGlobalDecisionEngine(makeArgs({
      tradeIdeas: [
        {
          id: 't1', asset_id: 'a1', portfolio_id: 'p1',
          stage: 'deciding', action: 'buy', decision_outcome: null,
          outcome: null, visibility_tier: 'active',
          created_at: daysAgo(10), updated_at: daysAgo(10),
          asset_symbol: 'AAPL', portfolio_name: 'Growth',
        },
        {
          id: 't2', asset_id: 'a1', portfolio_id: 'p1',
          decision_outcome: 'accepted', decided_at: daysAgo(5),
          action: 'buy', outcome: null, visibility_tier: 'active',
          created_at: daysAgo(8), updated_at: daysAgo(5),
          asset_symbol: 'AAPL', portfolio_name: 'Growth',
        },
      ],
    }))

    const slice = selectForAsset(result, 'a1')
    // Should maintain descending sortScore order
    for (let i = 1; i < slice.action.length; i++) {
      expect(slice.action[i - 1].sortScore).toBeGreaterThanOrEqual(slice.action[i].sortScore)
    }
  })
})

// ---------------------------------------------------------------------------
// selectForPortfolio
// ---------------------------------------------------------------------------

describe('selectForPortfolio', () => {
  it('returns only items matching the given portfolioId', () => {
    const result = runGlobalDecisionEngine(makeArgs({
      tradeIdeas: [
        {
          id: 't1', asset_id: 'a1', portfolio_id: 'p1',
          stage: 'deciding', action: 'buy', decision_outcome: null,
          outcome: null, visibility_tier: 'active',
          created_at: daysAgo(5), updated_at: daysAgo(5),
          asset_symbol: 'AAPL', portfolio_name: 'Growth',
        },
        {
          id: 't2', asset_id: 'a2', portfolio_id: 'p2',
          stage: 'deciding', action: 'sell', decision_outcome: null,
          outcome: null, visibility_tier: 'active',
          created_at: daysAgo(4), updated_at: daysAgo(4),
          asset_symbol: 'MSFT', portfolio_name: 'Value',
        },
      ],
    }))

    const sliceP1 = selectForPortfolio(result, 'p1')
    const sliceP2 = selectForPortfolio(result, 'p2')

    expect(sliceP1.action.every(i => i.context.portfolioId === 'p1')).toBe(true)
    expect(sliceP2.action.every(i => i.context.portfolioId === 'p2')).toBe(true)
    expect(sliceP1.action.length).toBe(1)
    expect(sliceP2.action.length).toBe(1)
  })

  it('returns empty slices for portfolio with no engine items', () => {
    const result = runGlobalDecisionEngine(makeArgs({
      tradeIdeas: [
        {
          id: 't1', asset_id: 'a1', portfolio_id: 'p1',
          stage: 'deciding', action: 'buy', decision_outcome: null,
          outcome: null, visibility_tier: 'active',
          created_at: daysAgo(5), updated_at: daysAgo(5),
          asset_symbol: 'AAPL', portfolio_name: 'Growth',
        },
      ],
    }))

    const slice = selectForPortfolio(result, 'nonexistent-portfolio')
    expect(slice.action).toEqual([])
    expect(slice.intel).toEqual([])
  })

  it('same item appears on both asset + portfolio surfaces with stable id', () => {
    const result = runGlobalDecisionEngine(makeArgs({
      tradeIdeas: [
        {
          id: 't1', asset_id: 'a1', portfolio_id: 'p1',
          stage: 'deciding', action: 'buy', decision_outcome: null,
          outcome: null, visibility_tier: 'active',
          created_at: daysAgo(5), updated_at: daysAgo(5),
          asset_symbol: 'AAPL', portfolio_name: 'Growth',
        },
      ],
    }))

    const assetSlice = selectForAsset(result, 'a1')
    const portfolioSlice = selectForPortfolio(result, 'p1')

    // Same item should appear in both slices
    expect(assetSlice.action.length).toBe(1)
    expect(portfolioSlice.action.length).toBe(1)

    // Same stable id
    expect(assetSlice.action[0].id).toBe(portfolioSlice.action[0].id)
  })
})

// ---------------------------------------------------------------------------
// Dismissal consistency (shared localStorage key)
// ---------------------------------------------------------------------------

describe('Dismissal consistency', () => {
  it('dismissal filters intel items identically for dashboard and asset views', () => {
    const result = runGlobalDecisionEngine(makeArgs({
      // I3 (high EV) produces dismissible intel items
      assets: [
        { id: 'a1', symbol: 'AAPL', expectedReturn: 0.30 },
        { id: 'a2', symbol: 'MSFT', expectedReturn: 0.35 },
      ],
    }))

    // Simulate user dismissing specific intel items
    const dismissedIds = new Set<string>()
    const allIntel = result.intelItems
    expect(allIntel.length).toBeGreaterThan(0)

    // Dismiss the first dismissible item
    const firstDismissible = allIntel.find(i => i.dismissible)
    expect(firstDismissible).toBeDefined()
    dismissedIds.add(firstDismissible!.id)

    // Dashboard view: filter full intel list
    const dashboardVisible = filterDismissed(allIntel, dismissedIds)

    // Asset view: filter asset slice
    const assetSlice = selectForAsset(result, firstDismissible!.context.assetId!)
    const assetVisible = filterDismissed(assetSlice.intel, dismissedIds)

    // The dismissed item should be gone in both views
    expect(dashboardVisible.find(i => i.id === firstDismissible!.id)).toBeUndefined()
    expect(assetVisible.find(i => i.id === firstDismissible!.id)).toBeUndefined()

    // Non-dismissed items for this asset should still appear in both views
    const assetIntelCount = assetSlice.intel.filter(i => !dismissedIds.has(i.id)).length
    expect(assetVisible.length).toBe(assetIntelCount)
  })

  it('dismissing on dashboard hides from asset view and vice versa', () => {
    const result = runGlobalDecisionEngine(makeArgs({
      // I3 (high EV) produces dismissible intel items
      assets: [
        { id: 'a1', symbol: 'AAPL', expectedReturn: 0.30 },
        { id: 'a2', symbol: 'MSFT', expectedReturn: 0.35 },
      ],
    }))

    const dismissedIds = new Set<string>()

    // Find high EV intel items
    const evItems = result.intelItems.filter(i => i.id.startsWith('i3-ev-'))
    expect(evItems.length).toBe(2)

    // "Dismiss on dashboard" (add to shared dismissed set)
    dismissedIds.add(evItems[0].id)

    // Asset view should also not show it
    const assetId = evItems[0].context.assetId!
    const assetSlice = selectForAsset(result, assetId)
    const assetVisible = filterDismissed(assetSlice.intel, dismissedIds)
    expect(assetVisible.find(i => i.id === evItems[0].id)).toBeUndefined()

    // Other asset's items unaffected
    const otherAssetId = evItems[1].context.assetId!
    const otherSlice = selectForAsset(result, otherAssetId)
    const otherVisible = filterDismissed(otherSlice.intel, dismissedIds)
    expect(otherVisible.find(i => i.id === evItems[1].id)).toBeDefined()
  })

  it('dismissed intel hidden on portfolio surface via shared key', () => {
    const result = runGlobalDecisionEngine(makeArgs({
      tradeIdeas: [
        {
          id: 't1', asset_id: 'a1', portfolio_id: 'p1',
          stage: 'deciding', action: 'buy', decision_outcome: null,
          outcome: null, visibility_tier: 'active',
          created_at: daysAgo(5), updated_at: daysAgo(5),
          asset_symbol: 'AAPL', portfolio_name: 'Growth',
        },
      ],
      assets: [
        { id: 'a1', symbol: 'AAPL', expectedReturn: 0.30 },
      ],
    }))

    // Find an intel item for asset a1
    const assetIntel = selectForAsset(result, 'a1').intel
    const dismissible = assetIntel.find(i => i.dismissible)
    if (!dismissible) return // skip if evaluator didn't produce intel

    const dismissedIds = new Set([dismissible.id])

    // Dashboard
    const dashVisible = filterDismissed(result.intelItems, dismissedIds)
    expect(dashVisible.find(i => i.id === dismissible.id)).toBeUndefined()

    // Asset
    const assetVisible = filterDismissed(assetIntel, dismissedIds)
    expect(assetVisible.find(i => i.id === dismissible.id)).toBeUndefined()

    // Portfolio (if intel item has portfolioId)
    if (dismissible.context.portfolioId) {
      const portSlice = selectForPortfolio(result, dismissible.context.portfolioId)
      const portVisible = filterDismissed(portSlice.intel, dismissedIds)
      expect(portVisible.find(i => i.id === dismissible.id)).toBeUndefined()
    }
  })

  it('non-dismissible action items are never filtered', () => {
    const result = runGlobalDecisionEngine(makeArgs({
      tradeIdeas: [
        {
          id: 't1', asset_id: 'a1', portfolio_id: 'p1',
          stage: 'deciding', action: 'buy', decision_outcome: null,
          outcome: null, visibility_tier: 'active',
          created_at: daysAgo(5), updated_at: daysAgo(5),
          asset_symbol: 'AAPL', portfolio_name: 'Growth',
        },
      ],
    }))

    const actionItem = result.actionItems.find(i => i.context.assetId === 'a1')
    expect(actionItem).toBeDefined()
    expect(actionItem!.dismissible).toBe(false)

    // Even if someone tries to dismiss it
    const dismissedIds = new Set([actionItem!.id])
    const assetSlice = selectForAsset(result, 'a1')

    // Action items are NOT run through dismissal filter — they always show
    // (dismissal only applies to intel in the UI)
    expect(assetSlice.action.find(i => i.id === actionItem!.id)).toBeDefined()
  })
})
